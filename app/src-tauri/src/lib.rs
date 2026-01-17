//! SecureBackup - 差分・暗号化バックアップツール
//!
//! 大切なデータを安全に自動バックアップするTauriアプリケーション。
//! - AES-256-GCM暗号化
//! - BLAKE3ハッシュによる差分検出
//! - Zstd圧縮
//! - クロスプラットフォーム対応

mod backup;
mod crypto;
mod commands;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::scan_directory,
            commands::execute_backup,
            commands::get_progress,
            commands::check_password,
            commands::format_file_size,
        ])
        .run(tauri::generate_context!())
        .expect("SecureBackupの起動に失敗しました");
}
