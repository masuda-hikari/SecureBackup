import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";

// APIレスポンス型定義
interface ScanResponse {
  success: boolean;
  total_files: number;
  total_size: number;
  error: string | null;
}

interface BackupResponse {
  success: boolean;
  backed_up_files: number;
  backed_up_bytes: number;
  skipped_files: number;
  duration_secs: number;
  error: string | null;
}

interface RestoreResponse {
  success: boolean;
  restored_files: number;
  restored_bytes: number;
  skipped_files: number;
  duration_secs: number;
  error: string | null;
}

interface ProgressResponse {
  active: boolean;
  processed_files: number;
  total_files: number;
  processed_bytes: number;
  total_bytes: number;
  current_file: string | null;
  status: string;
  percentage: number;
}

interface PasswordCheckResponse {
  strength: string;
  score: number;
  suggestions: string[];
}

interface BackupFileInfo {
  path: string;
  original_size: number;
  backed_up_size: number;
  encrypted: boolean;
  modified: string;
}

interface BackupInfo {
  source_dir: string;
  created_at: string;
  total_files: number;
  total_size: number;
  encrypted: boolean;
  compressed: boolean;
}

interface BackupInfoResponse {
  success: boolean;
  info: BackupInfo | null;
  files: BackupFileInfo[];
  error: string | null;
}

// タブ種別
type TabType = "backup" | "restore";

function App() {
  // タブ状態
  const [activeTab, setActiveTab] = useState<TabType>("backup");

  // バックアップ設定
  const [sourceDir, setSourceDir] = useState("");
  const [destDir, setDestDir] = useState("");
  const [encrypt, setEncrypt] = useState(false);
  const [password, setPassword] = useState("");
  const [compress, setCompress] = useState(true);
  const [incremental, setIncremental] = useState(true);

  // 復元設定
  const [backupDir, setBackupDir] = useState("");
  const [restoreDir, setRestoreDir] = useState("");
  const [restorePassword, setRestorePassword] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [backupInfo, setBackupInfo] = useState<BackupInfoResponse | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);

  // スキャン結果
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null);
  const [scanning, setScanning] = useState(false);

  // バックアップ進捗
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [backing, setBacking] = useState(false);

  // 復元進捗
  const [restoreProgress, setRestoreProgress] = useState<ProgressResponse | null>(null);
  const [restoring, setRestoring] = useState(false);

  // パスワード強度
  const [passwordStrength, setPasswordStrength] = useState<PasswordCheckResponse | null>(null);

  // バックアップ結果
  const [backupResult, setBackupResult] = useState<BackupResponse | null>(null);

  // 復元結果
  const [restoreResult, setRestoreResult] = useState<RestoreResponse | null>(null);

  // エラー
  const [error, setError] = useState<string | null>(null);

  // フォルダ選択ダイアログ（バックアップ元）
  const selectSourceDir = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "バックアップ元フォルダを選択",
    });
    if (selected) {
      setSourceDir(selected as string);
      setScanResult(null);
    }
  };

  // フォルダ選択ダイアログ（バックアップ先）
  const selectDestDir = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "バックアップ先フォルダを選択",
    });
    if (selected) {
      setDestDir(selected as string);
    }
  };

  // フォルダ選択ダイアログ（バックアップフォルダ）
  const selectBackupDir = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "バックアップフォルダを選択",
    });
    if (selected) {
      setBackupDir(selected as string);
      setBackupInfo(null);
      setSelectedFiles([]);
    }
  };

  // フォルダ選択ダイアログ（復元先）
  const selectRestoreDir = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "復元先フォルダを選択",
    });
    if (selected) {
      setRestoreDir(selected as string);
    }
  };

  // バックアップ情報を読み込み
  const loadBackupInfo = async () => {
    if (!backupDir) {
      setError("バックアップフォルダを選択してください");
      return;
    }

    setLoadingInfo(true);
    setError(null);

    try {
      const result = await invoke<BackupInfoResponse>("get_backup_info", {
        backupDir: backupDir,
      });
      setBackupInfo(result);
      if (!result.success && result.error) {
        setError(result.error);
      }
    } catch (e) {
      setError(`バックアップ情報取得エラー: ${e}`);
    } finally {
      setLoadingInfo(false);
    }
  };

  // ディレクトリスキャン
  const handleScan = async () => {
    if (!sourceDir) {
      setError("バックアップ元フォルダを選択してください");
      return;
    }

    setScanning(true);
    setError(null);

    try {
      const result = await invoke<ScanResponse>("scan_directory", {
        request: {
          path: sourceDir,
          compute_hash: true,
        },
      });
      setScanResult(result);
      if (!result.success && result.error) {
        setError(result.error);
      }
    } catch (e) {
      setError(`スキャンエラー: ${e}`);
    } finally {
      setScanning(false);
    }
  };

  // バックアップ実行
  const handleBackup = async () => {
    if (!sourceDir || !destDir) {
      setError("バックアップ元とバックアップ先を選択してください");
      return;
    }

    if (encrypt && !password) {
      setError("暗号化を有効にする場合はパスワードを入力してください");
      return;
    }

    setBacking(true);
    setError(null);
    setBackupResult(null);

    try {
      const result = await invoke<BackupResponse>("execute_backup", {
        request: {
          source_dir: sourceDir,
          dest_dir: destDir,
          encrypt,
          password: encrypt ? password : null,
          compress,
          incremental,
        },
      });
      setBackupResult(result);
      if (!result.success && result.error) {
        setError(result.error);
      }
    } catch (e) {
      setError(`バックアップエラー: ${e}`);
    } finally {
      setBacking(false);
      setProgress(null);
    }
  };

  // 復元実行
  const handleRestore = async () => {
    if (!backupDir || !restoreDir) {
      setError("バックアップフォルダと復元先を選択してください");
      return;
    }

    if (backupInfo?.info?.encrypted && !restorePassword) {
      setError("暗号化されたバックアップにはパスワードが必要です");
      return;
    }

    setRestoring(true);
    setError(null);
    setRestoreResult(null);

    try {
      const result = await invoke<RestoreResponse>("execute_restore", {
        request: {
          backup_dir: backupDir,
          restore_dir: restoreDir,
          files: selectedFiles,
          password: restorePassword || null,
          overwrite,
        },
      });
      setRestoreResult(result);
      if (!result.success && result.error) {
        setError(result.error);
      }
    } catch (e) {
      setError(`復元エラー: ${e}`);
    } finally {
      setRestoring(false);
      setRestoreProgress(null);
    }
  };

  // バックアップ進捗を定期的に取得
  const pollBackupProgress = useCallback(async () => {
    if (backing) {
      try {
        const result = await invoke<ProgressResponse>("get_progress");
        setProgress(result);
      } catch (e) {
        console.error("進捗取得エラー:", e);
      }
    }
  }, [backing]);

  // 復元進捗を定期的に取得
  const pollRestoreProgress = useCallback(async () => {
    if (restoring) {
      try {
        const result = await invoke<ProgressResponse>("get_restore_progress");
        setRestoreProgress(result);
      } catch (e) {
        console.error("進捗取得エラー:", e);
      }
    }
  }, [restoring]);

  useEffect(() => {
    if (backing) {
      const interval = setInterval(pollBackupProgress, 500);
      return () => clearInterval(interval);
    }
  }, [backing, pollBackupProgress]);

  useEffect(() => {
    if (restoring) {
      const interval = setInterval(pollRestoreProgress, 500);
      return () => clearInterval(interval);
    }
  }, [restoring, pollRestoreProgress]);

  // パスワード強度チェック
  useEffect(() => {
    const checkPassword = async () => {
      if (password.length > 0) {
        const result = await invoke<PasswordCheckResponse>("check_password", {
          password,
        });
        setPasswordStrength(result);
      } else {
        setPasswordStrength(null);
      }
    };

    const timeout = setTimeout(checkPassword, 300);
    return () => clearTimeout(timeout);
  }, [password]);

  // ファイルサイズをフォーマット
  const formatSize = (bytes: number): string => {
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    } else if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    } else if (bytes >= 1024) {
      return `${(bytes / 1024).toFixed(2)} KB`;
    }
    return `${bytes} bytes`;
  };

  // 日付をフォーマット
  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleString("ja-JP");
  };

  // パスワード強度の色
  const getStrengthColor = (score: number): string => {
    switch (score) {
      case 1:
        return "#ef4444"; // 赤
      case 2:
        return "#f59e0b"; // 黄
      case 3:
        return "#10b981"; // 緑
      default:
        return "#6b7280"; // グレー
    }
  };

  // ファイル選択のトグル
  const toggleFileSelection = (path: string) => {
    setSelectedFiles((prev) =>
      prev.includes(path)
        ? prev.filter((p) => p !== path)
        : [...prev, path]
    );
  };

  // 全選択/全解除
  const toggleSelectAll = () => {
    if (backupInfo?.files) {
      if (selectedFiles.length === backupInfo.files.length) {
        setSelectedFiles([]);
      } else {
        setSelectedFiles(backupInfo.files.map((f) => f.path));
      }
    }
  };

  return (
    <main className="container">
      <h1>🔒 SecureBackup</h1>
      <p className="subtitle">差分・暗号化バックアップツール</p>

      {/* タブ切り替え */}
      <div className="tab-container">
        <button
          className={`tab-btn ${activeTab === "backup" ? "active" : ""}`}
          onClick={() => setActiveTab("backup")}
        >
          📦 バックアップ
        </button>
        <button
          className={`tab-btn ${activeTab === "restore" ? "active" : ""}`}
          onClick={() => setActiveTab("restore")}
        >
          🔄 復元
        </button>
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="error-box">
          ⚠️ {error}
          <button className="close-btn" onClick={() => setError(null)}>×</button>
        </div>
      )}

      {/* バックアップタブ */}
      {activeTab === "backup" && (
        <>
          {/* バックアップ設定 */}
          <section className="card">
            <h2>📁 フォルダ設定</h2>

            <div className="form-group">
              <label>バックアップ元</label>
              <div className="input-row">
                <input
                  type="text"
                  value={sourceDir}
                  readOnly
                  placeholder="フォルダを選択..."
                />
                <button onClick={selectSourceDir}>選択</button>
              </div>
            </div>

            <div className="form-group">
              <label>バックアップ先</label>
              <div className="input-row">
                <input
                  type="text"
                  value={destDir}
                  readOnly
                  placeholder="フォルダを選択..."
                />
                <button onClick={selectDestDir}>選択</button>
              </div>
            </div>
          </section>

          {/* オプション */}
          <section className="card">
            <h2>⚙️ オプション</h2>

            <div className="checkbox-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={encrypt}
                  onChange={(e) => setEncrypt(e.target.checked)}
                />
                <span>🔐 暗号化（AES-256-GCM）</span>
              </label>
            </div>

            {encrypt && (
              <div className="form-group password-group">
                <label>パスワード</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="暗号化パスワード"
                />
                {passwordStrength && (
                  <div className="password-strength">
                    <div
                      className="strength-bar"
                      style={{
                        width: `${(passwordStrength.score / 3) * 100}%`,
                        backgroundColor: getStrengthColor(passwordStrength.score),
                      }}
                    />
                    <span style={{ color: getStrengthColor(passwordStrength.score) }}>
                      {passwordStrength.strength}
                    </span>
                    {passwordStrength.suggestions.length > 0 && (
                      <ul className="suggestions">
                        {passwordStrength.suggestions.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="checkbox-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={compress}
                  onChange={(e) => setCompress(e.target.checked)}
                />
                <span>📦 圧縮（Zstd）</span>
              </label>
            </div>

            <div className="checkbox-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={incremental}
                  onChange={(e) => setIncremental(e.target.checked)}
                />
                <span>🔄 差分バックアップ（変更ファイルのみ）</span>
              </label>
            </div>
          </section>

          {/* スキャン結果 */}
          {scanResult && scanResult.success && (
            <section className="card scan-result">
              <h2>📊 スキャン結果</h2>
              <div className="stats-grid">
                <div className="stat-item">
                  <span className="stat-value">{scanResult.total_files.toLocaleString()}</span>
                  <span className="stat-label">ファイル</span>
                </div>
                <div className="stat-item">
                  <span className="stat-value">{formatSize(scanResult.total_size)}</span>
                  <span className="stat-label">合計サイズ</span>
                </div>
              </div>
            </section>
          )}

          {/* バックアップ進捗表示 */}
          {progress && progress.active && (
            <section className="card progress-section">
              <h2>⏳ バックアップ中...</h2>
              <div className="progress-bar-container">
                <div
                  className="progress-bar"
                  style={{ width: `${progress.percentage}%` }}
                />
              </div>
              <div className="progress-info">
                <span>{progress.processed_files} / {progress.total_files} ファイル</span>
                <span>{progress.percentage.toFixed(1)}%</span>
              </div>
              {progress.current_file && (
                <div className="current-file">
                  処理中: {progress.current_file}
                </div>
              )}
              <div className="status-badge">{progress.status}</div>
            </section>
          )}

          {/* バックアップ結果 */}
          {backupResult && (
            <section className={`card result-section ${backupResult.success ? 'success' : 'failed'}`}>
              <h2>{backupResult.success ? '✅ バックアップ完了' : '❌ バックアップ失敗'}</h2>
              {backupResult.success && (
                <div className="stats-grid">
                  <div className="stat-item">
                    <span className="stat-value">{backupResult.backed_up_files.toLocaleString()}</span>
                    <span className="stat-label">バックアップ済み</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-value">{backupResult.skipped_files.toLocaleString()}</span>
                    <span className="stat-label">スキップ（変更なし）</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-value">{formatSize(backupResult.backed_up_bytes)}</span>
                    <span className="stat-label">データ量</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-value">{backupResult.duration_secs.toFixed(1)}秒</span>
                    <span className="stat-label">所要時間</span>
                  </div>
                </div>
              )}
              {backupResult.error && (
                <div className="error-detail">{backupResult.error}</div>
              )}
            </section>
          )}

          {/* バックアップアクションボタン */}
          <section className="action-buttons">
            <button
              className="btn-secondary"
              onClick={handleScan}
              disabled={!sourceDir || scanning || backing}
            >
              {scanning ? '🔍 スキャン中...' : '🔍 スキャン'}
            </button>
            <button
              className="btn-primary"
              onClick={handleBackup}
              disabled={!sourceDir || !destDir || scanning || backing}
            >
              {backing ? '⏳ バックアップ中...' : '🚀 バックアップ開始'}
            </button>
          </section>
        </>
      )}

      {/* 復元タブ */}
      {activeTab === "restore" && (
        <>
          {/* 復元設定 */}
          <section className="card">
            <h2>📂 バックアップ選択</h2>

            <div className="form-group">
              <label>バックアップフォルダ</label>
              <div className="input-row">
                <input
                  type="text"
                  value={backupDir}
                  readOnly
                  placeholder="バックアップフォルダを選択..."
                />
                <button onClick={selectBackupDir}>選択</button>
              </div>
            </div>

            <div className="form-group">
              <label>復元先</label>
              <div className="input-row">
                <input
                  type="text"
                  value={restoreDir}
                  readOnly
                  placeholder="復元先フォルダを選択..."
                />
                <button onClick={selectRestoreDir}>選択</button>
              </div>
            </div>

            <button
              className="btn-secondary load-info-btn"
              onClick={loadBackupInfo}
              disabled={!backupDir || loadingInfo}
            >
              {loadingInfo ? "📖 読み込み中..." : "📖 バックアップ情報を読み込み"}
            </button>
          </section>

          {/* バックアップ情報 */}
          {backupInfo && backupInfo.success && backupInfo.info && (
            <>
              <section className="card backup-info">
                <h2>📋 バックアップ情報</h2>
                <div className="info-grid">
                  <div className="info-item">
                    <span className="info-label">元フォルダ</span>
                    <span className="info-value">{backupInfo.info.source_dir}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">作成日時</span>
                    <span className="info-value">{formatDate(backupInfo.info.created_at)}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">ファイル数</span>
                    <span className="info-value">{backupInfo.info.total_files.toLocaleString()}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">合計サイズ</span>
                    <span className="info-value">{formatSize(backupInfo.info.total_size)}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">暗号化</span>
                    <span className={`info-value ${backupInfo.info.encrypted ? 'encrypted' : ''}`}>
                      {backupInfo.info.encrypted ? "🔐 有効" : "🔓 なし"}
                    </span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">圧縮</span>
                    <span className="info-value">
                      {backupInfo.info.compressed ? "📦 有効" : "📄 なし"}
                    </span>
                  </div>
                </div>
              </section>

              {/* 暗号化パスワード */}
              {backupInfo.info.encrypted && (
                <section className="card">
                  <h2>🔐 復号パスワード</h2>
                  <div className="form-group">
                    <input
                      type="password"
                      value={restorePassword}
                      onChange={(e) => setRestorePassword(e.target.value)}
                      placeholder="暗号化時に設定したパスワード"
                    />
                  </div>
                </section>
              )}

              {/* オプション */}
              <section className="card">
                <h2>⚙️ 復元オプション</h2>
                <div className="checkbox-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={overwrite}
                      onChange={(e) => setOverwrite(e.target.checked)}
                    />
                    <span>📝 既存ファイルを上書き</span>
                  </label>
                </div>
              </section>

              {/* ファイル選択 */}
              <section className="card file-list-section">
                <h2>📄 復元するファイル</h2>
                <div className="file-list-header">
                  <button className="btn-link" onClick={toggleSelectAll}>
                    {selectedFiles.length === backupInfo.files.length
                      ? "全て解除"
                      : "全て選択"}
                  </button>
                  <span className="selected-count">
                    {selectedFiles.length} / {backupInfo.files.length} 選択中
                  </span>
                </div>
                <div className="file-list">
                  {backupInfo.files.map((file) => (
                    <div
                      key={file.path}
                      className={`file-item ${selectedFiles.includes(file.path) ? "selected" : ""}`}
                      onClick={() => toggleFileSelection(file.path)}
                    >
                      <input
                        type="checkbox"
                        checked={selectedFiles.includes(file.path)}
                        onChange={() => toggleFileSelection(file.path)}
                      />
                      <div className="file-info">
                        <span className="file-path">{file.path}</span>
                        <span className="file-meta">
                          {formatSize(file.original_size)}
                          {file.encrypted && " 🔐"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {/* 復元進捗表示 */}
          {restoreProgress && restoreProgress.active && (
            <section className="card progress-section restore-progress">
              <h2>⏳ 復元中...</h2>
              <div className="progress-bar-container">
                <div
                  className="progress-bar"
                  style={{ width: `${restoreProgress.percentage}%` }}
                />
              </div>
              <div className="progress-info">
                <span>{restoreProgress.processed_files} / {restoreProgress.total_files} ファイル</span>
                <span>{restoreProgress.percentage.toFixed(1)}%</span>
              </div>
              {restoreProgress.current_file && (
                <div className="current-file">
                  処理中: {restoreProgress.current_file}
                </div>
              )}
              <div className="status-badge">{restoreProgress.status}</div>
            </section>
          )}

          {/* 復元結果 */}
          {restoreResult && (
            <section className={`card result-section ${restoreResult.success ? 'success' : 'failed'}`}>
              <h2>{restoreResult.success ? '✅ 復元完了' : '❌ 復元失敗'}</h2>
              {restoreResult.success && (
                <div className="stats-grid">
                  <div className="stat-item">
                    <span className="stat-value">{restoreResult.restored_files.toLocaleString()}</span>
                    <span className="stat-label">復元済み</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-value">{restoreResult.skipped_files.toLocaleString()}</span>
                    <span className="stat-label">スキップ</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-value">{formatSize(restoreResult.restored_bytes)}</span>
                    <span className="stat-label">データ量</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-value">{restoreResult.duration_secs.toFixed(1)}秒</span>
                    <span className="stat-label">所要時間</span>
                  </div>
                </div>
              )}
              {restoreResult.error && (
                <div className="error-detail">{restoreResult.error}</div>
              )}
            </section>
          )}

          {/* 復元アクションボタン */}
          <section className="action-buttons">
            <button
              className="btn-primary"
              onClick={handleRestore}
              disabled={!backupDir || !restoreDir || restoring || !backupInfo?.success}
            >
              {restoring ? '⏳ 復元中...' : '🔄 復元開始'}
            </button>
          </section>
        </>
      )}

      {/* フッター */}
      <footer className="footer">
        <p>SecureBackup v0.1.0 | AES-256-GCM暗号化 | BLAKE3差分検出</p>
      </footer>
    </main>
  );
}

export default App;
