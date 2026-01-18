import { useState, useEffect, useCallback, useRef } from "react";
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

// 通知トースト型
interface Toast {
  id: number;
  type: "success" | "error" | "info" | "warning";
  message: string;
}

function App() {
  // タブ状態
  const [activeTab, setActiveTab] = useState<TabType>("backup");

  // バックアップ設定
  const [sourceDir, setSourceDir] = useState("");
  const [destDir, setDestDir] = useState("");
  const [encrypt, setEncrypt] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [compress, setCompress] = useState(true);
  const [incremental, setIncremental] = useState(true);

  // 復元設定
  const [backupDir, setBackupDir] = useState("");
  const [restoreDir, setRestoreDir] = useState("");
  const [restorePassword, setRestorePassword] = useState("");
  const [showRestorePassword, setShowRestorePassword] = useState(false);
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

  // 通知トースト
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);

  // ヘルプ表示
  const [showHelp, setShowHelp] = useState(false);

  // 確認ダイアログ
  const [confirmDialog, setConfirmDialog] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // トースト追加
  const addToast = useCallback((type: Toast["type"], message: string) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  // トースト削除
  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // フォルダ選択ダイアログ（バックアップ元）
  const selectSourceDir = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "バックアップ元フォルダを選択",
      });
      if (selected) {
        setSourceDir(selected as string);
        setScanResult(null);
        addToast("info", "バックアップ元フォルダを選択しました");
      }
    } catch (e) {
      addToast("error", `フォルダ選択エラー: ${e}`);
    }
  };

  // フォルダ選択ダイアログ（バックアップ先）
  const selectDestDir = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "バックアップ先フォルダを選択",
      });
      if (selected) {
        setDestDir(selected as string);
        addToast("info", "バックアップ先フォルダを選択しました");
      }
    } catch (e) {
      addToast("error", `フォルダ選択エラー: ${e}`);
    }
  };

  // フォルダ選択ダイアログ（バックアップフォルダ）
  const selectBackupDir = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "バックアップフォルダを選択",
      });
      if (selected) {
        setBackupDir(selected as string);
        setBackupInfo(null);
        setSelectedFiles([]);
        addToast("info", "バックアップフォルダを選択しました");
      }
    } catch (e) {
      addToast("error", `フォルダ選択エラー: ${e}`);
    }
  };

  // フォルダ選択ダイアログ（復元先）
  const selectRestoreDir = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "復元先フォルダを選択",
      });
      if (selected) {
        setRestoreDir(selected as string);
        addToast("info", "復元先フォルダを選択しました");
      }
    } catch (e) {
      addToast("error", `フォルダ選択エラー: ${e}`);
    }
  };

  // バックアップ情報を読み込み
  const loadBackupInfo = async () => {
    if (!backupDir) {
      addToast("warning", "バックアップフォルダを選択してください");
      return;
    }

    setLoadingInfo(true);

    try {
      const result = await invoke<BackupInfoResponse>("get_backup_info", {
        backupDir: backupDir,
      });
      setBackupInfo(result);
      if (result.success) {
        addToast("success", `${result.files.length}件のファイルを検出しました`);
      } else if (result.error) {
        addToast("error", result.error);
      }
    } catch (e) {
      addToast("error", `バックアップ情報取得エラー: ${e}`);
    } finally {
      setLoadingInfo(false);
    }
  };

  // ディレクトリスキャン
  const handleScan = async () => {
    if (!sourceDir) {
      addToast("warning", "バックアップ元フォルダを選択してください");
      return;
    }

    setScanning(true);

    try {
      const result = await invoke<ScanResponse>("scan_directory", {
        request: {
          path: sourceDir,
          compute_hash: true,
        },
      });
      setScanResult(result);
      if (result.success) {
        addToast("success", `${result.total_files}ファイル（${formatSize(result.total_size)}）を検出しました`);
      } else if (result.error) {
        addToast("error", result.error);
      }
    } catch (e) {
      addToast("error", `スキャンエラー: ${e}`);
    } finally {
      setScanning(false);
    }
  };

  // バックアップ実行（確認ダイアログ付き）
  const handleBackupClick = () => {
    if (!sourceDir || !destDir) {
      addToast("warning", "バックアップ元とバックアップ先を選択してください");
      return;
    }

    if (encrypt && !password) {
      addToast("warning", "暗号化を有効にする場合はパスワードを入力してください");
      return;
    }

    if (encrypt && passwordStrength && passwordStrength.score < 2) {
      addToast("warning", "パスワードが弱すぎます。より強いパスワードを設定してください");
      return;
    }

    setConfirmDialog({
      show: true,
      title: "バックアップの確認",
      message: `以下の設定でバックアップを開始しますか？\n\n📂 元: ${sourceDir}\n📁 先: ${destDir}\n🔐 暗号化: ${encrypt ? "有効" : "無効"}\n📦 圧縮: ${compress ? "有効" : "無効"}\n🔄 差分: ${incremental ? "有効" : "無効"}`,
      onConfirm: executeBackup,
    });
  };

  // バックアップ実行
  const executeBackup = async () => {
    setConfirmDialog(null);
    setBacking(true);
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
      if (result.success) {
        addToast("success", `バックアップ完了！ ${result.backed_up_files}ファイルを保存しました`);
      } else if (result.error) {
        addToast("error", result.error);
      }
    } catch (e) {
      addToast("error", `バックアップエラー: ${e}`);
    } finally {
      setBacking(false);
      setProgress(null);
    }
  };

  // 復元実行（確認ダイアログ付き）
  const handleRestoreClick = () => {
    if (!backupDir || !restoreDir) {
      addToast("warning", "バックアップフォルダと復元先を選択してください");
      return;
    }

    if (backupInfo?.info?.encrypted && !restorePassword) {
      addToast("warning", "暗号化されたバックアップにはパスワードが必要です");
      return;
    }

    const fileCount = selectedFiles.length || backupInfo?.files.length || 0;
    setConfirmDialog({
      show: true,
      title: "復元の確認",
      message: `以下の設定で復元を開始しますか？\n\n📂 元: ${backupDir}\n📁 先: ${restoreDir}\n📄 ファイル数: ${fileCount}件\n📝 上書き: ${overwrite ? "有効" : "無効"}`,
      onConfirm: executeRestore,
    });
  };

  // 復元実行
  const executeRestore = async () => {
    setConfirmDialog(null);
    setRestoring(true);
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
      if (result.success) {
        addToast("success", `復元完了！ ${result.restored_files}ファイルを復元しました`);
      } else if (result.error) {
        addToast("error", result.error);
      }
    } catch (e) {
      addToast("error", `復元エラー: ${e}`);
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

  // キーボードショートカット
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + キー
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case "b":
            e.preventDefault();
            if (activeTab === "backup" && sourceDir && destDir && !backing) {
              handleBackupClick();
            }
            break;
          case "r":
            e.preventDefault();
            if (activeTab === "restore" && backupDir && restoreDir && !restoring && backupInfo?.success) {
              handleRestoreClick();
            }
            break;
          case "s":
            e.preventDefault();
            if (activeTab === "backup" && sourceDir && !scanning && !backing) {
              handleScan();
            }
            break;
          case "1":
            e.preventDefault();
            setActiveTab("backup");
            break;
          case "2":
            e.preventDefault();
            setActiveTab("restore");
            break;
          case "/":
          case "?":
            e.preventDefault();
            setShowHelp(true);
            break;
        }
      }
      // Escキー
      if (e.key === "Escape") {
        setShowHelp(false);
        setConfirmDialog(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTab, sourceDir, destDir, backupDir, restoreDir, backing, restoring, scanning, backupInfo]);

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

  // パスワード強度のラベル
  const getStrengthLabel = (score: number): string => {
    switch (score) {
      case 1:
        return "弱い";
      case 2:
        return "普通";
      case 3:
        return "強い";
      default:
        return "";
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
    <main className="container" role="main">
      {/* ヘッダー */}
      <header className="header">
        <h1>
          <span className="logo-icon" aria-hidden="true">🔒</span>
          SecureBackup
        </h1>
        <p className="subtitle">安全・高速な差分暗号化バックアップ</p>
        <button
          className="help-btn"
          onClick={() => setShowHelp(true)}
          title="ヘルプを表示 (Ctrl+?)"
          aria-label="ヘルプを表示"
        >
          <span aria-hidden="true">?</span>
        </button>
      </header>

      {/* タブ切り替え */}
      <nav className="tab-container" role="tablist" aria-label="メイン機能">
        <button
          role="tab"
          aria-selected={activeTab === "backup"}
          aria-controls="backup-panel"
          className={`tab-btn ${activeTab === "backup" ? "active" : ""}`}
          onClick={() => setActiveTab("backup")}
        >
          <span aria-hidden="true">📦</span> バックアップ
          <span className="shortcut-hint">Ctrl+1</span>
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "restore"}
          aria-controls="restore-panel"
          className={`tab-btn ${activeTab === "restore" ? "active" : ""}`}
          onClick={() => setActiveTab("restore")}
        >
          <span aria-hidden="true">🔄</span> 復元
          <span className="shortcut-hint">Ctrl+2</span>
        </button>
      </nav>

      {/* トースト通知 */}
      <div className="toast-container" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast toast-${toast.type}`}
            role="alert"
          >
            <span className="toast-icon" aria-hidden="true">
              {toast.type === "success" && "✓"}
              {toast.type === "error" && "✕"}
              {toast.type === "warning" && "⚠"}
              {toast.type === "info" && "ℹ"}
            </span>
            <span className="toast-message">{toast.message}</span>
            <button
              className="toast-close"
              onClick={() => removeToast(toast.id)}
              aria-label="通知を閉じる"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* バックアップタブ */}
      {activeTab === "backup" && (
        <div id="backup-panel" role="tabpanel" aria-labelledby="backup-tab">
          {/* バックアップ設定 */}
          <section className="card" aria-labelledby="folder-settings">
            <h2 id="folder-settings">
              <span aria-hidden="true">📁</span> フォルダ設定
            </h2>

            <div className="form-group">
              <label htmlFor="source-dir">バックアップ元</label>
              <div className="input-row">
                <input
                  id="source-dir"
                  type="text"
                  value={sourceDir}
                  readOnly
                  placeholder="フォルダを選択..."
                  aria-describedby="source-dir-hint"
                />
                <button
                  onClick={selectSourceDir}
                  className="btn-secondary"
                  aria-label="バックアップ元フォルダを選択"
                >
                  選択
                </button>
              </div>
              <span id="source-dir-hint" className="input-hint">
                バックアップしたいファイルが含まれるフォルダを選択してください
              </span>
            </div>

            <div className="form-group">
              <label htmlFor="dest-dir">バックアップ先</label>
              <div className="input-row">
                <input
                  id="dest-dir"
                  type="text"
                  value={destDir}
                  readOnly
                  placeholder="フォルダを選択..."
                  aria-describedby="dest-dir-hint"
                />
                <button
                  onClick={selectDestDir}
                  className="btn-secondary"
                  aria-label="バックアップ先フォルダを選択"
                >
                  選択
                </button>
              </div>
              <span id="dest-dir-hint" className="input-hint">
                バックアップファイルを保存するフォルダを選択してください
              </span>
            </div>
          </section>

          {/* オプション */}
          <section className="card" aria-labelledby="options-heading">
            <h2 id="options-heading">
              <span aria-hidden="true">⚙️</span> オプション
            </h2>

            <div className="checkbox-group">
              <label className="checkbox-label" data-tooltip="AES-256-GCM暗号化でデータを保護します">
                <input
                  type="checkbox"
                  checked={encrypt}
                  onChange={(e) => setEncrypt(e.target.checked)}
                  aria-describedby="encrypt-desc"
                />
                <span className="checkbox-text">
                  <span aria-hidden="true">🔐</span> 暗号化（AES-256-GCM）
                </span>
              </label>
              <span id="encrypt-desc" className="option-desc">
                軍事レベルの暗号化でデータを保護
              </span>
            </div>

            {encrypt && (
              <div className="form-group password-group" aria-label="パスワード設定">
                <label htmlFor="backup-password">パスワード</label>
                <div className="password-input-row">
                  <input
                    id="backup-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="暗号化パスワード"
                    aria-describedby="password-strength-info"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "パスワードを隠す" : "パスワードを表示"}
                  >
                    {showPassword ? "🙈" : "👁️"}
                  </button>
                </div>
                {passwordStrength && (
                  <div id="password-strength-info" className="password-strength" role="status">
                    <div className="strength-bar-container">
                      <div
                        className="strength-bar"
                        style={{
                          width: `${(passwordStrength.score / 3) * 100}%`,
                          backgroundColor: getStrengthColor(passwordStrength.score),
                        }}
                        role="progressbar"
                        aria-valuenow={passwordStrength.score}
                        aria-valuemin={0}
                        aria-valuemax={3}
                        aria-label={`パスワード強度: ${getStrengthLabel(passwordStrength.score)}`}
                      />
                    </div>
                    <span
                      className="strength-label"
                      style={{ color: getStrengthColor(passwordStrength.score) }}
                    >
                      {getStrengthLabel(passwordStrength.score)}
                    </span>
                    {passwordStrength.suggestions.length > 0 && (
                      <ul className="suggestions" aria-label="パスワード改善の提案">
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
              <label className="checkbox-label" data-tooltip="Zstd圧縮でファイルサイズを削減します">
                <input
                  type="checkbox"
                  checked={compress}
                  onChange={(e) => setCompress(e.target.checked)}
                />
                <span className="checkbox-text">
                  <span aria-hidden="true">📦</span> 圧縮（Zstd）
                </span>
              </label>
              <span className="option-desc">高速圧縮でストレージを節約</span>
            </div>

            <div className="checkbox-group">
              <label className="checkbox-label" data-tooltip="変更されたファイルのみバックアップします">
                <input
                  type="checkbox"
                  checked={incremental}
                  onChange={(e) => setIncremental(e.target.checked)}
                />
                <span className="checkbox-text">
                  <span aria-hidden="true">🔄</span> 差分バックアップ
                </span>
              </label>
              <span className="option-desc">変更ファイルのみ保存して時間短縮</span>
            </div>
          </section>

          {/* スキャン結果 */}
          {scanResult && scanResult.success && (
            <section className="card scan-result" aria-labelledby="scan-result-heading">
              <h2 id="scan-result-heading">
                <span aria-hidden="true">📊</span> スキャン結果
              </h2>
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
            <section className="card progress-section" aria-labelledby="backup-progress-heading" aria-live="polite">
              <h2 id="backup-progress-heading">
                <span aria-hidden="true">⏳</span> バックアップ中...
              </h2>
              <div className="progress-bar-container">
                <div
                  className="progress-bar"
                  style={{ width: `${progress.percentage}%` }}
                  role="progressbar"
                  aria-valuenow={progress.percentage}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`バックアップ進捗: ${progress.percentage.toFixed(1)}%`}
                />
              </div>
              <div className="progress-info">
                <span>{progress.processed_files} / {progress.total_files} ファイル</span>
                <span>{progress.percentage.toFixed(1)}%</span>
              </div>
              {progress.current_file && (
                <div className="current-file" title={progress.current_file}>
                  処理中: {progress.current_file}
                </div>
              )}
              <div className="status-badge">{progress.status}</div>
            </section>
          )}

          {/* バックアップ結果 */}
          {backupResult && (
            <section
              className={`card result-section ${backupResult.success ? 'success' : 'failed'}`}
              aria-labelledby="backup-result-heading"
              role="status"
            >
              <h2 id="backup-result-heading">
                {backupResult.success ? '✅ バックアップ完了' : '❌ バックアップ失敗'}
              </h2>
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
                <div className="error-detail" role="alert">
                  <strong>エラー詳細:</strong> {backupResult.error}
                </div>
              )}
            </section>
          )}

          {/* バックアップアクションボタン */}
          <section className="action-buttons">
            <button
              className="btn-secondary"
              onClick={handleScan}
              disabled={!sourceDir || scanning || backing}
              aria-busy={scanning}
            >
              {scanning ? (
                <>
                  <span className="spinner" aria-hidden="true"></span>
                  スキャン中...
                </>
              ) : (
                <>
                  <span aria-hidden="true">🔍</span> スキャン
                  <span className="shortcut-hint">Ctrl+S</span>
                </>
              )}
            </button>
            <button
              className="btn-primary"
              onClick={handleBackupClick}
              disabled={!sourceDir || !destDir || scanning || backing}
              aria-busy={backing}
            >
              {backing ? (
                <>
                  <span className="spinner" aria-hidden="true"></span>
                  バックアップ中...
                </>
              ) : (
                <>
                  <span aria-hidden="true">🚀</span> バックアップ開始
                  <span className="shortcut-hint">Ctrl+B</span>
                </>
              )}
            </button>
          </section>
        </div>
      )}

      {/* 復元タブ */}
      {activeTab === "restore" && (
        <div id="restore-panel" role="tabpanel" aria-labelledby="restore-tab">
          {/* 復元設定 */}
          <section className="card" aria-labelledby="restore-folder-heading">
            <h2 id="restore-folder-heading">
              <span aria-hidden="true">📂</span> バックアップ選択
            </h2>

            <div className="form-group">
              <label htmlFor="backup-folder">バックアップフォルダ</label>
              <div className="input-row">
                <input
                  id="backup-folder"
                  type="text"
                  value={backupDir}
                  readOnly
                  placeholder="バックアップフォルダを選択..."
                  aria-describedby="backup-folder-hint"
                />
                <button
                  onClick={selectBackupDir}
                  className="btn-secondary"
                  aria-label="バックアップフォルダを選択"
                >
                  選択
                </button>
              </div>
              <span id="backup-folder-hint" className="input-hint">
                復元したいバックアップが保存されているフォルダを選択
              </span>
            </div>

            <div className="form-group">
              <label htmlFor="restore-folder">復元先</label>
              <div className="input-row">
                <input
                  id="restore-folder"
                  type="text"
                  value={restoreDir}
                  readOnly
                  placeholder="復元先フォルダを選択..."
                  aria-describedby="restore-folder-hint"
                />
                <button
                  onClick={selectRestoreDir}
                  className="btn-secondary"
                  aria-label="復元先フォルダを選択"
                >
                  選択
                </button>
              </div>
              <span id="restore-folder-hint" className="input-hint">
                ファイルを復元する場所を選択
              </span>
            </div>

            <button
              className="btn-secondary load-info-btn"
              onClick={loadBackupInfo}
              disabled={!backupDir || loadingInfo}
              aria-busy={loadingInfo}
            >
              {loadingInfo ? (
                <>
                  <span className="spinner" aria-hidden="true"></span>
                  読み込み中...
                </>
              ) : (
                <>
                  <span aria-hidden="true">📖</span> バックアップ情報を読み込み
                </>
              )}
            </button>
          </section>

          {/* バックアップ情報 */}
          {backupInfo && backupInfo.success && backupInfo.info && (
            <>
              <section className="card backup-info" aria-labelledby="backup-info-heading">
                <h2 id="backup-info-heading">
                  <span aria-hidden="true">📋</span> バックアップ情報
                </h2>
                <div className="info-grid">
                  <div className="info-item">
                    <span className="info-label">元フォルダ</span>
                    <span className="info-value" title={backupInfo.info.source_dir}>
                      {backupInfo.info.source_dir}
                    </span>
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
                <section className="card" aria-labelledby="decrypt-password-heading">
                  <h2 id="decrypt-password-heading">
                    <span aria-hidden="true">🔐</span> 復号パスワード
                  </h2>
                  <div className="form-group">
                    <div className="password-input-row">
                      <input
                        id="restore-password"
                        type={showRestorePassword ? "text" : "password"}
                        value={restorePassword}
                        onChange={(e) => setRestorePassword(e.target.value)}
                        placeholder="暗号化時に設定したパスワード"
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        className="password-toggle"
                        onClick={() => setShowRestorePassword(!showRestorePassword)}
                        aria-label={showRestorePassword ? "パスワードを隠す" : "パスワードを表示"}
                      >
                        {showRestorePassword ? "🙈" : "👁️"}
                      </button>
                    </div>
                    <span className="input-hint">
                      バックアップ作成時に設定したパスワードを入力してください
                    </span>
                  </div>
                </section>
              )}

              {/* オプション */}
              <section className="card" aria-labelledby="restore-options-heading">
                <h2 id="restore-options-heading">
                  <span aria-hidden="true">⚙️</span> 復元オプション
                </h2>
                <div className="checkbox-group">
                  <label className="checkbox-label" data-tooltip="既存ファイルがある場合に上書きします">
                    <input
                      type="checkbox"
                      checked={overwrite}
                      onChange={(e) => setOverwrite(e.target.checked)}
                    />
                    <span className="checkbox-text">
                      <span aria-hidden="true">📝</span> 既存ファイルを上書き
                    </span>
                  </label>
                  <span className="option-desc">
                    {overwrite
                      ? "⚠️ 既存ファイルは上書きされます"
                      : "既存ファイルはスキップされます"}
                  </span>
                </div>
              </section>

              {/* ファイル選択 */}
              <section className="card file-list-section" aria-labelledby="file-selection-heading">
                <h2 id="file-selection-heading">
                  <span aria-hidden="true">📄</span> 復元するファイル
                </h2>
                <div className="file-list-header">
                  <button
                    className="btn-link"
                    onClick={toggleSelectAll}
                    aria-label={selectedFiles.length === backupInfo.files.length ? "全て解除" : "全て選択"}
                  >
                    {selectedFiles.length === backupInfo.files.length
                      ? "全て解除"
                      : "全て選択"}
                  </button>
                  <span className="selected-count" aria-live="polite">
                    {selectedFiles.length} / {backupInfo.files.length} 選択中
                  </span>
                </div>
                <div className="file-list" role="listbox" aria-label="復元ファイル一覧">
                  {backupInfo.files.map((file) => (
                    <div
                      key={file.path}
                      className={`file-item ${selectedFiles.includes(file.path) ? "selected" : ""}`}
                      onClick={() => toggleFileSelection(file.path)}
                      role="option"
                      aria-selected={selectedFiles.includes(file.path)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleFileSelection(file.path);
                        }
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedFiles.includes(file.path)}
                        onChange={() => toggleFileSelection(file.path)}
                        tabIndex={-1}
                        aria-hidden="true"
                      />
                      <div className="file-info">
                        <span className="file-path" title={file.path}>{file.path}</span>
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
            <section className="card progress-section restore-progress" aria-labelledby="restore-progress-heading" aria-live="polite">
              <h2 id="restore-progress-heading">
                <span aria-hidden="true">⏳</span> 復元中...
              </h2>
              <div className="progress-bar-container">
                <div
                  className="progress-bar"
                  style={{ width: `${restoreProgress.percentage}%` }}
                  role="progressbar"
                  aria-valuenow={restoreProgress.percentage}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`復元進捗: ${restoreProgress.percentage.toFixed(1)}%`}
                />
              </div>
              <div className="progress-info">
                <span>{restoreProgress.processed_files} / {restoreProgress.total_files} ファイル</span>
                <span>{restoreProgress.percentage.toFixed(1)}%</span>
              </div>
              {restoreProgress.current_file && (
                <div className="current-file" title={restoreProgress.current_file}>
                  処理中: {restoreProgress.current_file}
                </div>
              )}
              <div className="status-badge">{restoreProgress.status}</div>
            </section>
          )}

          {/* 復元結果 */}
          {restoreResult && (
            <section
              className={`card result-section ${restoreResult.success ? 'success' : 'failed'}`}
              aria-labelledby="restore-result-heading"
              role="status"
            >
              <h2 id="restore-result-heading">
                {restoreResult.success ? '✅ 復元完了' : '❌ 復元失敗'}
              </h2>
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
                <div className="error-detail" role="alert">
                  <strong>エラー詳細:</strong> {restoreResult.error}
                </div>
              )}
            </section>
          )}

          {/* 復元アクションボタン */}
          <section className="action-buttons">
            <button
              className="btn-primary"
              onClick={handleRestoreClick}
              disabled={!backupDir || !restoreDir || restoring || !backupInfo?.success}
              aria-busy={restoring}
            >
              {restoring ? (
                <>
                  <span className="spinner" aria-hidden="true"></span>
                  復元中...
                </>
              ) : (
                <>
                  <span aria-hidden="true">🔄</span> 復元開始
                  <span className="shortcut-hint">Ctrl+R</span>
                </>
              )}
            </button>
          </section>
        </div>
      )}

      {/* 確認ダイアログ */}
      {confirmDialog?.show && (
        <div className="dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
          <div className="dialog">
            <h3 id="dialog-title">{confirmDialog.title}</h3>
            <p className="dialog-message">{confirmDialog.message}</p>
            <div className="dialog-actions">
              <button
                className="btn-secondary"
                onClick={() => setConfirmDialog(null)}
                autoFocus
              >
                キャンセル
              </button>
              <button
                className="btn-primary"
                onClick={confirmDialog.onConfirm}
              >
                実行
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ヘルプモーダル */}
      {showHelp && (
        <div className="dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="help-title">
          <div className="dialog help-dialog">
            <h3 id="help-title">
              <span aria-hidden="true">❓</span> ヘルプ
            </h3>
            <div className="help-content">
              <section>
                <h4>キーボードショートカット</h4>
                <ul className="shortcut-list">
                  <li><kbd>Ctrl</kbd>+<kbd>1</kbd> バックアップタブ</li>
                  <li><kbd>Ctrl</kbd>+<kbd>2</kbd> 復元タブ</li>
                  <li><kbd>Ctrl</kbd>+<kbd>S</kbd> スキャン実行</li>
                  <li><kbd>Ctrl</kbd>+<kbd>B</kbd> バックアップ開始</li>
                  <li><kbd>Ctrl</kbd>+<kbd>R</kbd> 復元開始</li>
                  <li><kbd>Ctrl</kbd>+<kbd>?</kbd> ヘルプ表示</li>
                  <li><kbd>Esc</kbd> ダイアログを閉じる</li>
                </ul>
              </section>
              <section>
                <h4>機能概要</h4>
                <ul>
                  <li><strong>差分バックアップ</strong>: BLAKE3ハッシュで変更ファイルのみ保存</li>
                  <li><strong>暗号化</strong>: AES-256-GCMで軍事レベルの暗号化</li>
                  <li><strong>圧縮</strong>: Zstdで高速かつ高圧縮率</li>
                </ul>
              </section>
              <section>
                <h4>バージョン情報</h4>
                <p>SecureBackup v0.1.0</p>
              </section>
            </div>
            <div className="dialog-actions">
              <button
                className="btn-primary"
                onClick={() => setShowHelp(false)}
                autoFocus
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* フッター */}
      <footer className="footer">
        <p>SecureBackup v0.1.0</p>
        <p className="footer-features">AES-256-GCM暗号化 | BLAKE3差分検出 | Zstd圧縮</p>
      </footer>
    </main>
  );
}

export default App;
