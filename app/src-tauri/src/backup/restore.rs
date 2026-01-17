//! 復元モジュール - バックアップからファイルを復元
//!
//! 暗号化・圧縮されたバックアップファイルを元の形式に復元する機能を提供。

use super::{BackupManifest, ManifestEntry};
use crate::crypto::{CryptoError, Encryptor};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;
use chrono::{DateTime, Utc};
use thiserror::Error;

/// 復元エラー
#[derive(Error, Debug)]
pub enum RestoreError {
    #[error("IOエラー: {0}")]
    Io(#[from] std::io::Error),

    #[error("復号化エラー: {0}")]
    Crypto(#[from] CryptoError),

    #[error("マニフェストが見つかりません: {0}")]
    ManifestNotFound(PathBuf),

    #[error("マニフェストの解析に失敗しました: {0}")]
    ManifestParse(#[from] serde_json::Error),

    #[error("バックアップファイルが見つかりません: {0}")]
    BackupFileNotFound(PathBuf),

    #[error("解凍エラー")]
    Decompression,

    #[error("パスワードが正しくありません")]
    WrongPassword,
}

/// 復元設定
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreConfig {
    /// バックアップディレクトリ
    pub backup_dir: PathBuf,

    /// 復元先ディレクトリ
    pub restore_dir: PathBuf,

    /// 復元するファイル（空の場合は全ファイル）
    pub files: Vec<String>,

    /// 既存ファイルを上書きするか
    pub overwrite: bool,
}

/// 復元進捗
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreProgress {
    /// 処理済みファイル数
    pub processed_files: usize,

    /// 総ファイル数
    pub total_files: usize,

    /// 処理済みバイト数
    pub processed_bytes: u64,

    /// 総バイト数
    pub total_bytes: u64,

    /// 現在処理中のファイル
    pub current_file: Option<String>,

    /// 状態
    pub status: RestoreStatus,

    /// エラーメッセージ
    pub error: Option<String>,
}

/// 復元状態
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RestoreStatus {
    /// 待機中
    Idle,
    /// マニフェスト読み込み中
    LoadingManifest,
    /// 復元中
    Restoring,
    /// 完了
    Completed,
    /// エラー
    Failed,
}

/// 復元結果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreResult {
    /// 開始日時
    pub started_at: DateTime<Utc>,

    /// 終了日時
    pub finished_at: DateTime<Utc>,

    /// 復元したファイル数
    pub restored_files: usize,

    /// 復元したバイト数
    pub restored_bytes: u64,

    /// スキップしたファイル数（上書きなし設定で既存ファイル）
    pub skipped_files: usize,

    /// エラーが発生したファイル
    pub failed_files: Vec<String>,

    /// 成功したか
    pub success: bool,
}

/// 復元実行エンジン
pub struct RestoreExecutor {
    config: RestoreConfig,
    encryptor: Option<Encryptor>,
    progress_callback: Option<Box<dyn Fn(RestoreProgress) + Send + Sync>>,
}

impl RestoreExecutor {
    /// 新しいエグゼキューターを作成
    pub fn new(config: RestoreConfig) -> Self {
        Self {
            config,
            encryptor: None,
            progress_callback: None,
        }
    }

    /// 復号化用のパスワードを設定
    pub fn with_password(mut self, password: &str) -> Self {
        self.encryptor = Some(Encryptor::new(password));
        self
    }

    /// 進捗コールバックを設定
    pub fn with_progress_callback<F>(mut self, callback: F) -> Self
    where
        F: Fn(RestoreProgress) + Send + Sync + 'static,
    {
        self.progress_callback = Some(Box::new(callback));
        self
    }

    /// 復元を実行
    pub fn execute(&self) -> Result<RestoreResult, RestoreError> {
        let started_at = Utc::now();

        // 進捗を報告
        self.report_progress(RestoreProgress {
            processed_files: 0,
            total_files: 0,
            processed_bytes: 0,
            total_bytes: 0,
            current_file: None,
            status: RestoreStatus::LoadingManifest,
            error: None,
        });

        // マニフェストを読み込み
        let manifest = self.load_manifest()?;

        // 復元対象ファイルを決定
        let files_to_restore = if self.config.files.is_empty() {
            // 全ファイル復元
            manifest.files.values().cloned().collect::<Vec<_>>()
        } else {
            // 指定ファイルのみ復元
            self.config.files.iter()
                .filter_map(|path| manifest.files.get(path).cloned())
                .collect::<Vec<_>>()
        };

        let total_bytes: u64 = files_to_restore.iter()
            .map(|f| f.original_size)
            .sum();

        // 復元先ディレクトリを作成
        fs::create_dir_all(&self.config.restore_dir)?;

        // 復元実行
        let mut restored_files = 0usize;
        let mut restored_bytes = 0u64;
        let mut skipped_files = 0usize;
        let mut failed_files = Vec::new();

        for (idx, entry) in files_to_restore.iter().enumerate() {
            self.report_progress(RestoreProgress {
                processed_files: idx,
                total_files: files_to_restore.len(),
                processed_bytes: restored_bytes,
                total_bytes,
                current_file: Some(entry.path.clone()),
                status: RestoreStatus::Restoring,
                error: None,
            });

            match self.restore_file(entry, &manifest) {
                Ok(RestoreFileResult::Restored(size)) => {
                    restored_files += 1;
                    restored_bytes += size;
                }
                Ok(RestoreFileResult::Skipped) => {
                    skipped_files += 1;
                }
                Err(e) => {
                    failed_files.push(format!("{}: {}", entry.path, e));
                }
            }
        }

        let finished_at = Utc::now();

        self.report_progress(RestoreProgress {
            processed_files: restored_files,
            total_files: files_to_restore.len(),
            processed_bytes: restored_bytes,
            total_bytes,
            current_file: None,
            status: if failed_files.is_empty() {
                RestoreStatus::Completed
            } else {
                RestoreStatus::Failed
            },
            error: if failed_files.is_empty() {
                None
            } else {
                Some(format!("{}個のファイルでエラー", failed_files.len()))
            },
        });

        let success = failed_files.is_empty();

        Ok(RestoreResult {
            started_at,
            finished_at,
            restored_files,
            restored_bytes,
            skipped_files,
            failed_files,
            success,
        })
    }

    /// マニフェストを読み込み
    fn load_manifest(&self) -> Result<BackupManifest, RestoreError> {
        let manifest_path = self.config.backup_dir.join("manifest.json");

        if !manifest_path.exists() {
            return Err(RestoreError::ManifestNotFound(manifest_path));
        }

        let manifest_data = fs::read_to_string(&manifest_path)?;
        let manifest: BackupManifest = serde_json::from_str(&manifest_data)?;

        Ok(manifest)
    }

    /// 単一ファイルを復元
    fn restore_file(&self, entry: &ManifestEntry, manifest: &BackupManifest) -> Result<RestoreFileResult, RestoreError> {
        let restore_path = self.config.restore_dir.join(&entry.path);

        // 上書きチェック
        if restore_path.exists() && !self.config.overwrite {
            return Ok(RestoreFileResult::Skipped);
        }

        // バックアップファイルのパスを構築
        let backup_file_path = if entry.encrypted {
            // 暗号化されている場合は.enc拡張子
            let mut path = self.config.backup_dir.join("data").join(&entry.path);
            let extension = path.extension()
                .map(|e| format!("{}.enc", e.to_string_lossy()))
                .unwrap_or_else(|| "enc".to_string());
            path.set_extension(extension);
            path
        } else {
            self.config.backup_dir.join("data").join(&entry.path)
        };

        if !backup_file_path.exists() {
            return Err(RestoreError::BackupFileNotFound(backup_file_path));
        }

        // ファイルを読み込み
        let mut data = Vec::new();
        File::open(&backup_file_path)?.read_to_end(&mut data)?;

        // 復号化
        let data = if entry.encrypted {
            if let Some(ref encryptor) = self.encryptor {
                encryptor.decrypt(&data)
                    .map_err(|_| RestoreError::WrongPassword)?
            } else {
                return Err(RestoreError::WrongPassword);
            }
        } else {
            data
        };

        // 解凍
        let data = if entry.compressed || manifest.config.compress {
            zstd::decode_all(data.as_slice())
                .map_err(|_| RestoreError::Decompression)?
        } else {
            data
        };

        // 親ディレクトリを作成
        if let Some(parent) = restore_path.parent() {
            fs::create_dir_all(parent)?;
        }

        // ファイルを書き込み
        let mut file = File::create(&restore_path)?;
        file.write_all(&data)?;

        Ok(RestoreFileResult::Restored(entry.original_size))
    }

    /// 進捗を報告
    fn report_progress(&self, progress: RestoreProgress) {
        if let Some(ref callback) = self.progress_callback {
            callback(progress);
        }
    }
}

/// 復元ファイル結果
enum RestoreFileResult {
    /// 復元成功（バイト数）
    Restored(u64),
    /// スキップ（既存ファイルあり）
    Skipped,
}

/// バックアップマニフェストを読み込み
pub fn load_backup_manifest(backup_dir: &PathBuf) -> Result<BackupManifest, RestoreError> {
    let manifest_path = backup_dir.join("manifest.json");

    if !manifest_path.exists() {
        return Err(RestoreError::ManifestNotFound(manifest_path));
    }

    let manifest_data = fs::read_to_string(&manifest_path)?;
    let manifest: BackupManifest = serde_json::from_str(&manifest_data)?;

    Ok(manifest)
}

/// バックアップ情報
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupInfo {
    /// マニフェストバージョン
    pub version: String,

    /// 作成日時
    pub created_at: DateTime<Utc>,

    /// 最終更新日時
    pub updated_at: DateTime<Utc>,

    /// ソースディレクトリ
    pub source_dir: String,

    /// 総ファイル数
    pub total_files: usize,

    /// オリジナルサイズ
    pub total_original_size: u64,

    /// バックアップサイズ
    pub total_backed_up_size: u64,

    /// 暗号化されているか
    pub encrypted: bool,

    /// 圧縮されているか
    pub compressed: bool,

    /// バックアップ回数
    pub backup_count: u32,
}

impl From<&BackupManifest> for BackupInfo {
    fn from(manifest: &BackupManifest) -> Self {
        Self {
            version: manifest.version.clone(),
            created_at: manifest.created_at,
            updated_at: manifest.updated_at,
            source_dir: manifest.source_dir.clone(),
            total_files: manifest.stats.total_files,
            total_original_size: manifest.stats.total_original_size,
            total_backed_up_size: manifest.stats.total_backed_up_size,
            encrypted: manifest.config.encrypt,
            compressed: manifest.config.compress,
            backup_count: manifest.stats.backup_count,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::io::Write as IoWrite;
    use crate::backup::{BackupConfig, BackupExecutor};

    #[test]
    fn test_restore_unencrypted() {
        // テスト用ディレクトリを作成
        let source = TempDir::new().unwrap();
        let backup = TempDir::new().unwrap();
        let restore = TempDir::new().unwrap();

        // テストファイルを作成
        let test_file = source.path().join("test.txt");
        let mut file = File::create(&test_file).unwrap();
        writeln!(file, "Hello, Restore!").unwrap();

        // バックアップを実行
        let backup_config = BackupConfig {
            source_dir: source.path().to_path_buf(),
            dest_dir: backup.path().to_path_buf(),
            encrypt: false,
            compress: true,
            incremental: false,
            exclude_patterns: vec![],
        };

        let executor = BackupExecutor::new(backup_config);
        let backup_result = executor.execute().unwrap();
        assert!(backup_result.success);

        // 復元を実行
        let restore_config = RestoreConfig {
            backup_dir: backup.path().to_path_buf(),
            restore_dir: restore.path().to_path_buf(),
            files: vec![],
            overwrite: true,
        };

        let restore_executor = RestoreExecutor::new(restore_config);
        let restore_result = restore_executor.execute().unwrap();

        assert!(restore_result.success);
        assert_eq!(restore_result.restored_files, 1);

        // 復元されたファイルを確認
        let restored_file = restore.path().join("test.txt");
        assert!(restored_file.exists());

        let content = fs::read_to_string(&restored_file).unwrap();
        assert!(content.contains("Hello, Restore!"));
    }

    #[test]
    fn test_restore_encrypted() {
        // テスト用ディレクトリを作成
        let source = TempDir::new().unwrap();
        let backup = TempDir::new().unwrap();
        let restore = TempDir::new().unwrap();

        // テストファイルを作成
        let test_file = source.path().join("secret.txt");
        let mut file = File::create(&test_file).unwrap();
        writeln!(file, "Secret Data!").unwrap();

        // 暗号化バックアップを実行
        let backup_config = BackupConfig {
            source_dir: source.path().to_path_buf(),
            dest_dir: backup.path().to_path_buf(),
            encrypt: true,
            compress: true,
            incremental: false,
            exclude_patterns: vec![],
        };

        let executor = BackupExecutor::new(backup_config)
            .with_encryption("test_password_123");
        let backup_result = executor.execute().unwrap();
        assert!(backup_result.success);

        // 復元を実行
        let restore_config = RestoreConfig {
            backup_dir: backup.path().to_path_buf(),
            restore_dir: restore.path().to_path_buf(),
            files: vec![],
            overwrite: true,
        };

        let restore_executor = RestoreExecutor::new(restore_config)
            .with_password("test_password_123");
        let restore_result = restore_executor.execute().unwrap();

        assert!(restore_result.success);
        assert_eq!(restore_result.restored_files, 1);

        // 復元されたファイルを確認
        let restored_file = restore.path().join("secret.txt");
        assert!(restored_file.exists());

        let content = fs::read_to_string(&restored_file).unwrap();
        assert!(content.contains("Secret Data!"));
    }

    #[test]
    fn test_restore_wrong_password() {
        // テスト用ディレクトリを作成
        let source = TempDir::new().unwrap();
        let backup = TempDir::new().unwrap();
        let restore = TempDir::new().unwrap();

        // テストファイルを作成
        let test_file = source.path().join("secret.txt");
        let mut file = File::create(&test_file).unwrap();
        writeln!(file, "Secret Data!").unwrap();

        // 暗号化バックアップを実行
        let backup_config = BackupConfig {
            source_dir: source.path().to_path_buf(),
            dest_dir: backup.path().to_path_buf(),
            encrypt: true,
            compress: true,
            incremental: false,
            exclude_patterns: vec![],
        };

        let executor = BackupExecutor::new(backup_config)
            .with_encryption("correct_password");
        let backup_result = executor.execute().unwrap();
        assert!(backup_result.success);

        // 間違ったパスワードで復元を試行
        let restore_config = RestoreConfig {
            backup_dir: backup.path().to_path_buf(),
            restore_dir: restore.path().to_path_buf(),
            files: vec![],
            overwrite: true,
        };

        let restore_executor = RestoreExecutor::new(restore_config)
            .with_password("wrong_password");
        let restore_result = restore_executor.execute().unwrap();

        // パスワードが間違っているのでエラーになるはず
        assert!(!restore_result.success);
        assert!(!restore_result.failed_files.is_empty());
    }
}
