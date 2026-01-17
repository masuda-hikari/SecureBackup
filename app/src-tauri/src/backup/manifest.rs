//! バックアップマニフェスト - バックアップの状態を記録

use super::{ScanResult, BackupConfig};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use chrono::{DateTime, Utc};

/// マニフェストエントリ（ファイルごとの情報）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestEntry {
    /// 相対パス
    pub path: String,

    /// オリジナルサイズ
    pub original_size: u64,

    /// バックアップ後サイズ
    pub backed_up_size: u64,

    /// BLAKE3ハッシュ
    pub hash: String,

    /// 最終更新日時
    pub modified: DateTime<Utc>,

    /// 暗号化されているか
    pub encrypted: bool,

    /// 圧縮されているか
    pub compressed: bool,
}

/// バックアップマニフェスト
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupManifest {
    /// マニフェストバージョン
    pub version: String,

    /// 作成日時
    pub created_at: DateTime<Utc>,

    /// 最終更新日時
    pub updated_at: DateTime<Utc>,

    /// ソースディレクトリ
    pub source_dir: String,

    /// バックアップ設定
    pub config: ManifestConfig,

    /// ファイル一覧（相対パスをキーとする）
    pub files: HashMap<String, ManifestEntry>,

    /// 統計情報
    pub stats: ManifestStats,
}

/// マニフェストに保存する設定
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestConfig {
    pub encrypt: bool,
    pub compress: bool,
    pub incremental: bool,
}

/// 統計情報
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestStats {
    /// 総ファイル数
    pub total_files: usize,

    /// オリジナル合計サイズ
    pub total_original_size: u64,

    /// バックアップ合計サイズ
    pub total_backed_up_size: u64,

    /// 最終バックアップ日時
    pub last_backup: DateTime<Utc>,

    /// バックアップ回数
    pub backup_count: u32,
}

impl BackupManifest {
    /// スキャン結果からマニフェストを作成
    pub fn from_scan(scan: &ScanResult, config: &BackupConfig) -> Self {
        let now = Utc::now();

        let files: HashMap<String, ManifestEntry> = scan.files.iter()
            .map(|(path, info)| {
                let entry = ManifestEntry {
                    path: path.clone(),
                    original_size: info.size,
                    backed_up_size: 0, // 実際のバックアップ後に更新
                    hash: info.hash.clone().unwrap_or_default(),
                    modified: info.modified,
                    encrypted: config.encrypt,
                    compressed: config.compress,
                };
                (path.clone(), entry)
            })
            .collect();

        Self {
            version: "1.0.0".to_string(),
            created_at: now,
            updated_at: now,
            source_dir: scan.source_dir.to_string_lossy().to_string(),
            config: ManifestConfig {
                encrypt: config.encrypt,
                compress: config.compress,
                incremental: config.incremental,
            },
            files,
            stats: ManifestStats {
                total_files: scan.total_files,
                total_original_size: scan.total_size,
                total_backed_up_size: 0,
                last_backup: now,
                backup_count: 1,
            },
        }
    }

    /// マニフェストを更新
    pub fn update(&mut self, scan: &ScanResult) {
        self.updated_at = Utc::now();
        self.stats.last_backup = Utc::now();
        self.stats.backup_count += 1;

        // 新規・更新ファイルを反映
        for (path, info) in &scan.files {
            self.files.entry(path.clone())
                .and_modify(|e| {
                    e.hash = info.hash.clone().unwrap_or_default();
                    e.original_size = info.size;
                    e.modified = info.modified;
                })
                .or_insert_with(|| ManifestEntry {
                    path: path.clone(),
                    original_size: info.size,
                    backed_up_size: 0,
                    hash: info.hash.clone().unwrap_or_default(),
                    modified: info.modified,
                    encrypted: self.config.encrypt,
                    compressed: self.config.compress,
                });
        }

        // 削除されたファイルを除去
        self.files.retain(|path, _| scan.files.contains_key(path));

        // 統計を更新
        self.stats.total_files = self.files.len();
        self.stats.total_original_size = self.files.values()
            .map(|e| e.original_size)
            .sum();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::collections::HashMap;
    use crate::backup::FileInfo;

    #[test]
    fn test_manifest_from_scan() {
        let mut files = HashMap::new();
        files.insert("test.txt".to_string(), FileInfo {
            relative_path: "test.txt".to_string(),
            size: 1000,
            modified: Utc::now(),
            hash: Some("abc123".to_string()),
        });

        let scan = ScanResult {
            source_dir: PathBuf::from("/test"),
            scanned_at: Utc::now(),
            files,
            total_files: 1,
            total_size: 1000,
        };

        let config = BackupConfig::default();
        let manifest = BackupManifest::from_scan(&scan, &config);

        assert_eq!(manifest.stats.total_files, 1);
        assert!(manifest.files.contains_key("test.txt"));
    }
}
