//! Tauriコマンド - フロントエンドとのインターフェース

use crate::backup::{BackupConfig, BackupExecutor, BackupProgress, DirectoryScanner, ScanResult};
use crate::crypto::{Encryptor, PasswordStrength};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::State;

/// アプリケーション状態
pub struct AppState {
    /// 現在の進捗
    pub progress: Arc<Mutex<Option<BackupProgress>>>,

    /// 最後のスキャン結果
    pub last_scan: Arc<Mutex<Option<ScanResult>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            progress: Arc::new(Mutex::new(None)),
            last_scan: Arc::new(Mutex::new(None)),
        }
    }
}

/// スキャンリクエスト
#[derive(Debug, Deserialize)]
pub struct ScanRequest {
    pub path: String,
    pub compute_hash: bool,
}

/// スキャンレスポンス
#[derive(Debug, Serialize)]
pub struct ScanResponse {
    pub success: bool,
    pub total_files: usize,
    pub total_size: u64,
    pub error: Option<String>,
}

/// バックアップリクエスト
#[derive(Debug, Deserialize)]
pub struct BackupRequest {
    pub source_dir: String,
    pub dest_dir: String,
    pub encrypt: bool,
    pub password: Option<String>,
    pub compress: bool,
    pub incremental: bool,
}

/// バックアップレスポンス
#[derive(Debug, Serialize)]
pub struct BackupResponse {
    pub success: bool,
    pub backed_up_files: usize,
    pub backed_up_bytes: u64,
    pub skipped_files: usize,
    pub duration_secs: f64,
    pub error: Option<String>,
}

/// 進捗レスポンス
#[derive(Debug, Serialize)]
pub struct ProgressResponse {
    pub active: bool,
    pub processed_files: usize,
    pub total_files: usize,
    pub processed_bytes: u64,
    pub total_bytes: u64,
    pub current_file: Option<String>,
    pub status: String,
    pub percentage: f64,
}

/// パスワード強度チェックレスポンス
#[derive(Debug, Serialize)]
pub struct PasswordCheckResponse {
    pub strength: String,
    pub score: u8,
    pub suggestions: Vec<String>,
}

/// ディレクトリをスキャン
#[tauri::command]
pub async fn scan_directory(
    request: ScanRequest,
    state: State<'_, AppState>,
) -> Result<ScanResponse, String> {
    let path = PathBuf::from(&request.path);

    let mut scanner = DirectoryScanner::new(&path);
    if request.compute_hash {
        scanner = scanner.with_hash();
    }

    match scanner.scan() {
        Ok(result) => {
            let response = ScanResponse {
                success: true,
                total_files: result.total_files,
                total_size: result.total_size,
                error: None,
            };

            // 状態を保存
            *state.last_scan.lock().unwrap() = Some(result);

            Ok(response)
        }
        Err(e) => Ok(ScanResponse {
            success: false,
            total_files: 0,
            total_size: 0,
            error: Some(e.to_string()),
        }),
    }
}

/// バックアップを実行
#[tauri::command]
pub async fn execute_backup(
    request: BackupRequest,
    state: State<'_, AppState>,
) -> Result<BackupResponse, String> {
    let config = BackupConfig {
        source_dir: PathBuf::from(&request.source_dir),
        dest_dir: PathBuf::from(&request.dest_dir),
        encrypt: request.encrypt,
        compress: request.compress,
        incremental: request.incremental,
        exclude_patterns: vec![
            ".git".to_string(),
            "node_modules".to_string(),
            "target".to_string(),
        ],
    };

    let progress_state = state.progress.clone();

    let mut executor = BackupExecutor::new(config);

    // 暗号化が有効な場合
    if request.encrypt {
        if let Some(password) = &request.password {
            executor = executor.with_encryption(password);
        } else {
            return Ok(BackupResponse {
                success: false,
                backed_up_files: 0,
                backed_up_bytes: 0,
                skipped_files: 0,
                duration_secs: 0.0,
                error: Some("暗号化にはパスワードが必要です".to_string()),
            });
        }
    }

    // 進捗コールバックを設定
    executor = executor.with_progress_callback(move |progress| {
        *progress_state.lock().unwrap() = Some(progress);
    });

    let start = std::time::Instant::now();

    match executor.execute() {
        Ok(result) => {
            let duration = start.elapsed().as_secs_f64();

            // 進捗をクリア
            *state.progress.lock().unwrap() = None;

            Ok(BackupResponse {
                success: result.success,
                backed_up_files: result.backed_up_files,
                backed_up_bytes: result.backed_up_bytes,
                skipped_files: result.skipped_files,
                duration_secs: duration,
                error: if result.failed_files.is_empty() {
                    None
                } else {
                    Some(format!("{}個のファイルでエラー", result.failed_files.len()))
                },
            })
        }
        Err(e) => {
            *state.progress.lock().unwrap() = None;

            Ok(BackupResponse {
                success: false,
                backed_up_files: 0,
                backed_up_bytes: 0,
                skipped_files: 0,
                duration_secs: start.elapsed().as_secs_f64(),
                error: Some(e.to_string()),
            })
        }
    }
}

/// 現在の進捗を取得
#[tauri::command]
pub fn get_progress(state: State<'_, AppState>) -> ProgressResponse {
    let progress = state.progress.lock().unwrap();

    match &*progress {
        Some(p) => {
            let percentage = if p.total_files > 0 {
                (p.processed_files as f64 / p.total_files as f64) * 100.0
            } else {
                0.0
            };

            ProgressResponse {
                active: true,
                processed_files: p.processed_files,
                total_files: p.total_files,
                processed_bytes: p.processed_bytes,
                total_bytes: p.total_bytes,
                current_file: p.current_file.clone(),
                status: format!("{:?}", p.status),
                percentage,
            }
        }
        None => ProgressResponse {
            active: false,
            processed_files: 0,
            total_files: 0,
            processed_bytes: 0,
            total_bytes: 0,
            current_file: None,
            status: "Idle".to_string(),
            percentage: 0.0,
        },
    }
}

/// パスワード強度をチェック
#[tauri::command]
pub fn check_password(password: String) -> PasswordCheckResponse {
    let strength = Encryptor::check_password_strength(&password);

    let (strength_str, score) = match strength {
        PasswordStrength::Weak => ("弱い", 1),
        PasswordStrength::Medium => ("中程度", 2),
        PasswordStrength::Strong => ("強い", 3),
    };

    let mut suggestions = Vec::new();

    if password.len() < 8 {
        suggestions.push("8文字以上にしてください".to_string());
    }
    if password.len() < 12 {
        suggestions.push("12文字以上を推奨".to_string());
    }
    if !password.chars().any(|c| c.is_uppercase()) {
        suggestions.push("大文字を含めてください".to_string());
    }
    if !password.chars().any(|c| c.is_lowercase()) {
        suggestions.push("小文字を含めてください".to_string());
    }
    if !password.chars().any(|c| c.is_numeric()) {
        suggestions.push("数字を含めてください".to_string());
    }
    if !password.chars().any(|c| !c.is_alphanumeric()) {
        suggestions.push("記号を含めてください".to_string());
    }

    PasswordCheckResponse {
        strength: strength_str.to_string(),
        score,
        suggestions,
    }
}

/// ファイルサイズを人間が読みやすい形式に変換
#[tauri::command]
pub fn format_file_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    const TB: u64 = GB * 1024;

    if bytes >= TB {
        format!("{:.2} TB", bytes as f64 / TB as f64)
    } else if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} bytes", bytes)
    }
}
