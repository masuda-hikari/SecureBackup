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

function App() {
  // 状態
  const [sourceDir, setSourceDir] = useState("");
  const [destDir, setDestDir] = useState("");
  const [encrypt, setEncrypt] = useState(false);
  const [password, setPassword] = useState("");
  const [compress, setCompress] = useState(true);
  const [incremental, setIncremental] = useState(true);

  // スキャン結果
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null);
  const [scanning, setScanning] = useState(false);

  // バックアップ進捗
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [backing, setBacking] = useState(false);

  // パスワード強度
  const [passwordStrength, setPasswordStrength] = useState<PasswordCheckResponse | null>(null);

  // バックアップ結果
  const [backupResult, setBackupResult] = useState<BackupResponse | null>(null);

  // エラー
  const [error, setError] = useState<string | null>(null);

  // フォルダ選択ダイアログ
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

  // 進捗を定期的に取得
  const pollProgress = useCallback(async () => {
    if (backing) {
      try {
        const result = await invoke<ProgressResponse>("get_progress");
        setProgress(result);
      } catch (e) {
        console.error("進捗取得エラー:", e);
      }
    }
  }, [backing]);

  useEffect(() => {
    if (backing) {
      const interval = setInterval(pollProgress, 500);
      return () => clearInterval(interval);
    }
  }, [backing, pollProgress]);

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

  return (
    <main className="container">
      <h1>🔒 SecureBackup</h1>
      <p className="subtitle">差分・暗号化バックアップツール</p>

      {/* エラー表示 */}
      {error && (
        <div className="error-box">
          ⚠️ {error}
          <button className="close-btn" onClick={() => setError(null)}>×</button>
        </div>
      )}

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

      {/* 進捗表示 */}
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

      {/* アクションボタン */}
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

      {/* フッター */}
      <footer className="footer">
        <p>SecureBackup v0.1.0 | AES-256-GCM暗号化 | BLAKE3差分検出</p>
      </footer>
    </main>
  );
}

export default App;
