//! バックアップ実行エンジン

use super::{DiffResult, ScanResult, DirectoryScanner, BackupManifest};
use crate::crypto::Encryptor;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;
use chrono::{DateTime, Utc};
use thiserror::Error;

/// バックアップエラー
#[derive(Error, Debug)]
pub enum BackupError {
    #[error("IOエラー: {0}")]
    Io(#[from] std::io::Error),

    #[error("スキャンエラー: {0}")]
    Scan(#[from] super::ScanError),

    #[error("暗号化エラー: {0}")]
    Crypto(#[from] crate::crypto::CryptoError),

    #[error("シリアライズエラー: {0}")]
    Serialize(#[from] serde_json::Error),

    #[error("圧縮エラー")]
    Compression,

    #[error("バックアップ先が存在しません: {0}")]
    DestinationNotFound(PathBuf),
}

/// バックアップ設定
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupConfig {
    /// ソースディレクトリ
    pub source_dir: PathBuf,

    /// バックアップ先ディレクトリ
    pub dest_dir: PathBuf,

    /// 暗号化を有効にするか
    pub encrypt: bool,

    /// 圧縮を有効にするか
    pub compress: bool,

    /// 差分バックアップを行うか
    pub incremental: bool,

    /// 除外パターン
    pub exclude_patterns: Vec<String>,
}

impl Default for BackupConfig {
    fn default() -> Self {
        Self {
            source_dir: PathBuf::new(),
            dest_dir: PathBuf::new(),
            encrypt: false,
            compress: true,
            incremental: true,
            exclude_patterns: vec![
                ".git".to_string(),
                "node_modules".to_string(),
                "target".to_string(),
            ],
        }
    }
}

/// バックアップ進捗
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupProgress {
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
    pub status: BackupStatus,

    /// エラーメッセージ（あれば）
    pub error: Option<String>,
}

/// バックアップ状態
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum BackupStatus {
    /// 待機中
    Idle,
    /// スキャン中
    Scanning,
    /// 差分計算中
    ComputingDiff,
    /// バックアップ中
    Backing,
    /// 完了
    Completed,
    /// エラー
    Failed,
}

/// バックアップ結果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupResult {
    /// 開始日時
    pub started_at: DateTime<Utc>,

    /// 終了日時
    pub finished_at: DateTime<Utc>,

    /// バックアップしたファイル数
    pub backed_up_files: usize,

    /// バックアップしたバイト数
    pub backed_up_bytes: u64,

    /// スキップしたファイル数（差分バックアップで変更なし）
    pub skipped_files: usize,

    /// エラーが発生したファイル
    pub failed_files: Vec<String>,

    /// 成功したか
    pub success: bool,
}

/// バックアップ実行エンジン
pub struct BackupExecutor {
    config: BackupConfig,
    encryptor: Option<Encryptor>,
    progress_callback: Option<Box<dyn Fn(BackupProgress) + Send + Sync>>,
}

impl BackupExecutor {
    /// 新しいエグゼキューターを作成
    pub fn new(config: BackupConfig) -> Self {
        Self {
            config,
            encryptor: None,
            progress_callback: None,
        }
    }

    /// 暗号化を設定
    pub fn with_encryption(mut self, password: &str) -> Self {
        self.encryptor = Some(Encryptor::new(password));
        self.config.encrypt = true;
        self
    }

    /// 進捗コールバックを設定
    pub fn with_progress_callback<F>(mut self, callback: F) -> Self
    where
        F: Fn(BackupProgress) + Send + Sync + 'static,
    {
        self.progress_callback = Some(Box::new(callback));
        self
    }

    /// バックアップを実行
    pub fn execute(&self) -> Result<BackupResult, BackupError> {
        let started_at = Utc::now();

        // 進捗を報告
        self.report_progress(BackupProgress {
            processed_files: 0,
            total_files: 0,
            processed_bytes: 0,
            total_bytes: 0,
            current_file: None,
            status: BackupStatus::Scanning,
            error: None,
        });

        // ソースをスキャン
        let mut scanner = DirectoryScanner::new(&self.config.source_dir);
        for pattern in &self.config.exclude_patterns {
            scanner = scanner.exclude(pattern);
        }
        let current_scan = scanner.with_hash().scan()?;

        // バックアップ先ディレクトリを作成
        fs::create_dir_all(&self.config.dest_dir)?;

        // 差分計算
        self.report_progress(BackupProgress {
            processed_files: 0,
            total_files: current_scan.total_files,
            processed_bytes: 0,
            total_bytes: current_scan.total_size,
            current_file: None,
            status: BackupStatus::ComputingDiff,
            error: None,
        });

        let (files_to_backup, skipped_count) = if self.config.incremental {
            self.compute_incremental_files(&current_scan)?
        } else {
            (current_scan.files.keys().cloned().collect::<Vec<_>>(), 0)
        };

        // バックアップ実行
        let mut backed_up_files = 0usize;
        let mut backed_up_bytes = 0u64;
        let mut failed_files = Vec::new();

        for (idx, file_path) in files_to_backup.iter().enumerate() {
            self.report_progress(BackupProgress {
                processed_files: idx,
                total_files: files_to_backup.len(),
                processed_bytes: backed_up_bytes,
                total_bytes: current_scan.total_size,
                current_file: Some(file_path.clone()),
                status: BackupStatus::Backing,
                error: None,
            });

            match self.backup_file(file_path) {
                Ok(size) => {
                    backed_up_files += 1;
                    backed_up_bytes += size;
                }
                Err(e) => {
                    failed_files.push(format!("{}: {}", file_path, e));
                }
            }
        }

        // マニフェストを保存
        self.save_manifest(&current_scan)?;

        let finished_at = Utc::now();

        self.report_progress(BackupProgress {
            processed_files: backed_up_files,
            total_files: files_to_backup.len(),
            processed_bytes: backed_up_bytes,
            total_bytes: current_scan.total_size,
            current_file: None,
            status: if failed_files.is_empty() {
                BackupStatus::Completed
            } else {
                BackupStatus::Failed
            },
            error: if failed_files.is_empty() {
                None
            } else {
                Some(format!("{}個のファイルでエラー", failed_files.len()))
            },
        });

        let success = failed_files.is_empty();

        Ok(BackupResult {
            started_at,
            finished_at,
            backed_up_files,
            backed_up_bytes,
            skipped_files: skipped_count,
            failed_files,
            success,
        })
    }

    /// 差分バックアップ対象ファイルを計算
    fn compute_incremental_files(&self, current_scan: &ScanResult) -> Result<(Vec<String>, usize), BackupError> {
        let manifest_path = self.config.dest_dir.join("manifest.json");

        if manifest_path.exists() {
            let manifest_data = fs::read_to_string(&manifest_path)?;
            let manifest: BackupManifest = serde_json::from_str(&manifest_data)?;

            // 前回のスキャン結果と比較
            let diff = compute_diff_from_manifest(&manifest, current_scan);

            let files_to_backup: Vec<String> = diff.added.into_iter()
                .chain(diff.modified.into_iter())
                .collect();

            Ok((files_to_backup, diff.unchanged.len()))
        } else {
            // 初回バックアップ
            Ok((current_scan.files.keys().cloned().collect(), 0))
        }
    }

    /// 単一ファイルをバックアップ
    fn backup_file(&self, relative_path: &str) -> Result<u64, BackupError> {
        let source_path = self.config.source_dir.join(relative_path);
        let dest_path = self.config.dest_dir.join("data").join(relative_path);

        // 親ディレクトリを作成
        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent)?;
        }

        // ファイルを読み込み
        let mut data = Vec::new();
        File::open(&source_path)?.read_to_end(&mut data)?;
        let original_size = data.len() as u64;

        // 圧縮
        let data = if self.config.compress {
            zstd::encode_all(data.as_slice(), 3)
                .map_err(|_| BackupError::Compression)?
        } else {
            data
        };

        // 暗号化
        let (data, dest_path) = if self.config.encrypt {
            if let Some(ref encryptor) = self.encryptor {
                let encrypted = encryptor.encrypt(&data)?;
                let mut encrypted_path = dest_path;
                encrypted_path.set_extension(
                    encrypted_path.extension()
                        .map(|e| format!("{}.enc", e.to_string_lossy()))
                        .unwrap_or_else(|| "enc".to_string())
                );
                (encrypted, encrypted_path)
            } else {
                (data, dest_path)
            }
        } else {
            (data, dest_path)
        };

        // 書き込み
        let mut file = File::create(&dest_path)?;
        file.write_all(&data)?;

        Ok(original_size)
    }

    /// マニフェストを保存
    fn save_manifest(&self, scan: &ScanResult) -> Result<(), BackupError> {
        let manifest = BackupManifest::from_scan(scan, &self.config);
        let manifest_path = self.config.dest_dir.join("manifest.json");
        let data = serde_json::to_string_pretty(&manifest)?;
        fs::write(manifest_path, data)?;
        Ok(())
    }

    /// 進捗を報告
    fn report_progress(&self, progress: BackupProgress) {
        if let Some(ref callback) = self.progress_callback {
            callback(progress);
        }
    }
}

/// マニフェストから差分を計算
fn compute_diff_from_manifest(manifest: &BackupManifest, current: &ScanResult) -> DiffResult {
    let mut added = Vec::new();
    let mut modified = Vec::new();
    let mut deleted = Vec::new();
    let mut unchanged = Vec::new();

    // 新規・変更ファイルを検出
    for (path, file_info) in &current.files {
        if let Some(entry) = manifest.files.get(path) {
            if entry.hash != file_info.hash.clone().unwrap_or_default() {
                modified.push(path.clone());
            } else {
                unchanged.push(path.clone());
            }
        } else {
            added.push(path.clone());
        }
    }

    // 削除ファイルを検出
    for path in manifest.files.keys() {
        if !current.files.contains_key(path) {
            deleted.push(path.clone());
        }
    }

    DiffResult {
        added,
        modified,
        deleted,
        unchanged,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::io::Write;

    #[test]
    fn test_full_backup() {
        let source = TempDir::new().unwrap();
        let dest = TempDir::new().unwrap();

        // テストファイルを作成
        let test_file = source.path().join("test.txt");
        let mut file = File::create(&test_file).unwrap();
        writeln!(file, "Hello, Backup!").unwrap();

        let config = BackupConfig {
            source_dir: source.path().to_path_buf(),
            dest_dir: dest.path().to_path_buf(),
            encrypt: false,
            compress: true,
            incremental: false,
            exclude_patterns: vec![],
        };

        let executor = BackupExecutor::new(config);
        let result = executor.execute().unwrap();

        assert!(result.success);
        assert_eq!(result.backed_up_files, 1);
    }
}
