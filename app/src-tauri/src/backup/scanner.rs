//! ファイルスキャナー - ディレクトリ走査と差分検出

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use chrono::{DateTime, Utc};
use thiserror::Error;

/// スキャンエラー
#[derive(Error, Debug)]
pub enum ScanError {
    #[error("ディレクトリが存在しません: {0}")]
    DirectoryNotFound(PathBuf),

    #[error("IOエラー: {0}")]
    Io(#[from] std::io::Error),

    #[error("ファイル走査エラー: {0}")]
    WalkDir(#[from] walkdir::Error),
}

/// ファイル情報
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    /// 相対パス
    pub relative_path: String,

    /// ファイルサイズ（バイト）
    pub size: u64,

    /// 最終更新日時
    pub modified: DateTime<Utc>,

    /// BLAKE3ハッシュ（オプション）
    pub hash: Option<String>,
}

impl FileInfo {
    /// ファイルからFileInfoを生成
    pub fn from_path(base: &Path, path: &Path) -> Result<Self, ScanError> {
        let metadata = fs::metadata(path)?;
        let relative = path.strip_prefix(base)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");

        let modified = metadata.modified()?
            .into();

        Ok(Self {
            relative_path: relative,
            size: metadata.len(),
            modified,
            hash: None,
        })
    }

    /// ハッシュを計算して設定
    pub fn compute_hash(&mut self, base: &Path) -> Result<(), ScanError> {
        let full_path = base.join(&self.relative_path);
        let data = fs::read(&full_path)?;
        let hash = blake3::hash(&data);
        self.hash = Some(hash.to_hex().to_string());
        Ok(())
    }
}

/// スキャン結果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    /// ソースディレクトリ
    pub source_dir: PathBuf,

    /// スキャン日時
    pub scanned_at: DateTime<Utc>,

    /// ファイル一覧（相対パスをキーとする）
    pub files: HashMap<String, FileInfo>,

    /// 合計ファイル数
    pub total_files: usize,

    /// 合計サイズ（バイト）
    pub total_size: u64,
}

/// ディレクトリスキャナー
pub struct DirectoryScanner {
    /// スキャン対象ディレクトリ
    source: PathBuf,

    /// 除外パターン
    exclude_patterns: Vec<String>,

    /// ハッシュ計算を行うか
    compute_hash: bool,
}

impl DirectoryScanner {
    /// 新しいスキャナーを作成
    pub fn new(source: impl Into<PathBuf>) -> Self {
        Self {
            source: source.into(),
            exclude_patterns: vec![
                ".git".to_string(),
                "node_modules".to_string(),
                "target".to_string(),
                ".DS_Store".to_string(),
                "Thumbs.db".to_string(),
            ],
            compute_hash: false,
        }
    }

    /// ハッシュ計算を有効化
    pub fn with_hash(mut self) -> Self {
        self.compute_hash = true;
        self
    }

    /// 除外パターンを追加
    pub fn exclude(mut self, pattern: impl Into<String>) -> Self {
        self.exclude_patterns.push(pattern.into());
        self
    }

    /// ディレクトリをスキャン
    pub fn scan(&self) -> Result<ScanResult, ScanError> {
        if !self.source.exists() {
            return Err(ScanError::DirectoryNotFound(self.source.clone()));
        }

        let mut files = HashMap::new();
        let mut total_size = 0u64;

        for entry in WalkDir::new(&self.source)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| !self.is_excluded(e.path()))
        {
            let entry = entry?;
            if entry.file_type().is_file() {
                let mut file_info = FileInfo::from_path(&self.source, entry.path())?;

                if self.compute_hash {
                    file_info.compute_hash(&self.source)?;
                }

                total_size += file_info.size;
                files.insert(file_info.relative_path.clone(), file_info);
            }
        }

        Ok(ScanResult {
            source_dir: self.source.clone(),
            scanned_at: Utc::now(),
            total_files: files.len(),
            total_size,
            files,
        })
    }

    /// パスが除外対象かチェック
    fn is_excluded(&self, path: &Path) -> bool {
        path.components().any(|c| {
            if let std::path::Component::Normal(name) = c {
                let name_str = name.to_string_lossy();
                self.exclude_patterns.iter().any(|p| name_str.contains(p))
            } else {
                false
            }
        })
    }
}

/// 差分検出結果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffResult {
    /// 新規ファイル
    pub added: Vec<String>,

    /// 変更ファイル
    pub modified: Vec<String>,

    /// 削除ファイル
    pub deleted: Vec<String>,

    /// 変更なしファイル
    pub unchanged: Vec<String>,
}

impl DiffResult {
    /// 変更があるかチェック
    pub fn has_changes(&self) -> bool {
        !self.added.is_empty() || !self.modified.is_empty() || !self.deleted.is_empty()
    }

    /// 変更ファイル数の合計
    pub fn changed_count(&self) -> usize {
        self.added.len() + self.modified.len() + self.deleted.len()
    }
}

/// 2つのスキャン結果の差分を計算
pub fn compute_diff(old: &ScanResult, new: &ScanResult) -> DiffResult {
    let mut added = Vec::new();
    let mut modified = Vec::new();
    let mut deleted = Vec::new();
    let mut unchanged = Vec::new();

    // 新規・変更ファイルを検出
    for (path, new_info) in &new.files {
        if let Some(old_info) = old.files.get(path) {
            // ハッシュがある場合はハッシュで比較
            if let (Some(old_hash), Some(new_hash)) = (&old_info.hash, &new_info.hash) {
                if old_hash != new_hash {
                    modified.push(path.clone());
                } else {
                    unchanged.push(path.clone());
                }
            } else if old_info.size != new_info.size || old_info.modified != new_info.modified {
                // ハッシュがない場合はサイズと更新日時で比較
                modified.push(path.clone());
            } else {
                unchanged.push(path.clone());
            }
        } else {
            added.push(path.clone());
        }
    }

    // 削除ファイルを検出
    for path in old.files.keys() {
        if !new.files.contains_key(path) {
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
    use std::fs::File;
    use std::io::Write;
    use tempfile::TempDir;

    #[test]
    fn test_scan_directory() {
        let temp = TempDir::new().unwrap();
        let file_path = temp.path().join("test.txt");
        let mut file = File::create(&file_path).unwrap();
        writeln!(file, "Hello, World!").unwrap();

        let scanner = DirectoryScanner::new(temp.path());
        let result = scanner.scan().unwrap();

        assert_eq!(result.total_files, 1);
        assert!(result.files.contains_key("test.txt"));
    }

    #[test]
    fn test_compute_diff() {
        let mut old_files = HashMap::new();
        old_files.insert("a.txt".to_string(), FileInfo {
            relative_path: "a.txt".to_string(),
            size: 100,
            modified: Utc::now(),
            hash: Some("hash_a".to_string()),
        });
        old_files.insert("b.txt".to_string(), FileInfo {
            relative_path: "b.txt".to_string(),
            size: 200,
            modified: Utc::now(),
            hash: Some("hash_b".to_string()),
        });

        let old = ScanResult {
            source_dir: PathBuf::from("/test"),
            scanned_at: Utc::now(),
            files: old_files,
            total_files: 2,
            total_size: 300,
        };

        let mut new_files = HashMap::new();
        new_files.insert("a.txt".to_string(), FileInfo {
            relative_path: "a.txt".to_string(),
            size: 100,
            modified: Utc::now(),
            hash: Some("hash_a".to_string()), // 変更なし
        });
        new_files.insert("c.txt".to_string(), FileInfo {
            relative_path: "c.txt".to_string(),
            size: 300,
            modified: Utc::now(),
            hash: Some("hash_c".to_string()), // 新規
        });

        let new = ScanResult {
            source_dir: PathBuf::from("/test"),
            scanned_at: Utc::now(),
            files: new_files,
            total_files: 2,
            total_size: 400,
        };

        let diff = compute_diff(&old, &new);

        assert_eq!(diff.added, vec!["c.txt"]);
        assert_eq!(diff.deleted, vec!["b.txt"]);
        assert_eq!(diff.unchanged, vec!["a.txt"]);
        assert!(diff.modified.is_empty());
    }
}
