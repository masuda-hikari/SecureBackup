---
name: session-log
description: "セッション作業履歴をOrchestratorUI DBに記録。全プロジェクト共通の作業記録管理。"
allowed-tools: Bash, Read, Write
model: haiku
context: fork
user-invocable: true
---

# セッション作業記録スキル（DB版）

セッション作業履歴をOrchestratorUI DBに記録し、アプリケーションからリアルタイムで履歴確認可能にする。

## 概要

```
セッション中:
  作業完了 → DB (work_logs テーブル) に記録

確認方法:
  OrchestratorUI → 作業履歴タブ
  または API経由で取得
```

## DB構造

```sql
work_logs (
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,      -- セッション識別子
    project TEXT NOT NULL,         -- プロジェクト名
    bot_name TEXT,                 -- Bot名（該当する場合）
    work_date TEXT NOT NULL,       -- 作業日 (YYYY-MM-DD)
    summary TEXT NOT NULL,         -- 作業概要
    completed_items TEXT,          -- 完了項目 (JSON配列)
    changed_files TEXT,            -- 変更ファイル (JSON配列)
    next_tasks TEXT,               -- 次回作業 (JSON配列)
    duration_minutes INTEGER,      -- 作業時間（分）
    status TEXT DEFAULT 'completed',
    created_at TEXT,
    metadata TEXT                  -- 追加情報 (JSON)
)
```

## 使用方法

### PowerShell経由でDBに記録

```powershell
# 作業記録をDBに送信
$body = @{
    session_id = [guid]::NewGuid().ToString()
    project = "プロジェクト名"
    bot_name = $null  # Bot以外は省略可
    work_date = (Get-Date).ToString("yyyy-MM-dd")
    summary = "作業概要をここに記載"
    completed_items = @(
        "完了項目1",
        "完了項目2"
    )
    changed_files = @(
        "path/to/file1.rs",
        "path/to/file2.tsx"
    )
    next_tasks = @(
        "次回タスク1",
        "次回タスク2"
    )
    duration_minutes = 60
} | ConvertTo-Json -Depth 10

# OrchestratorUI HTTP Server APIを呼び出し
Invoke-RestMethod -Uri "http://localhost:9223/api/work_logs" -Method POST -Body $body -ContentType "application/json"
```

### cURL経由

```bash
curl -X POST http://localhost:9223/api/work_logs \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "unique-session-id",
    "project": "OrchestratorUI",
    "work_date": "2026-01-25",
    "summary": "作業概要",
    "completed_items": ["項目1", "項目2"],
    "changed_files": ["file1.rs", "file2.tsx"],
    "next_tasks": ["次回タスク1"]
  }'
```

## 作業記録の取得

### API経由

```bash
# 最新の作業記録を取得
curl "http://localhost:9223/api/work_logs?project=OrchestratorUI&limit=10"

# 日付範囲指定
curl "http://localhost:9223/api/work_logs?from_date=2026-01-01&to_date=2026-01-31"

# サマリー取得
curl "http://localhost:9223/api/work_log_summary?project=OrchestratorUI&days=30"
```

### Tauri Command（フロントエンドから）

```typescript
// 作業記録を取得
const logs = await invoke('get_work_logs', {
    project: 'OrchestratorUI',
    limit: 10
});

// 最新の作業記録を取得
const latest = await invoke('get_latest_work_log', {
    project: 'OrchestratorUI'
});

// サマリー取得（過去30日）
const summary = await invoke('get_work_log_summary', {
    project: 'OrchestratorUI',
    days: 30
});
```

## プロジェクト別設定

各プロジェクトは以下のように設定可能:

| プロジェクト | project名 | bot_name例 |
|-------------|-----------|-----------|
| OrchestratorUI | OrchestratorUI | - |
| crypt_bot | crypt_bot | hyperliquid-btc-perp, bitflyer-mean-reversion |
| その他 | プロジェクト名 | 必要に応じて設定 |

## セッション終了時の自動記録

AIセッション終了時に自動的に作業記録をDBに保存するには、hooksを設定:

```json
// .claude/hooks.json
{
  "stop": {
    "command": "powershell -File .claude/scripts/session-log-submit.ps1"
  }
}
```

## 注意事項

- OrchestratorUI（ポート9223）が起動している必要がある
- 作業記録はローカルSQLiteに保存（orchestration_logs.db）
- DEVELOPMENT_LOG.mdにはサマリーのみ記載（詳細はDB参照）
- 全プロジェクト共通のDBに統合されるため、履歴検索が容易
