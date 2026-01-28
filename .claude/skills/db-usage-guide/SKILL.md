---
name: db-usage-guide
description: "OrchestratorUI DB使用ガイドライン。プロジェクト分離とAPI使用方法。"
allowed-tools: Bash, Read
model: haiku
context: fork
user-invocable: false
---

# OrchestratorUI DB使用ガイドライン

全プロジェクト共通のDB（orchestration_logs.db）を使用する際のガイドライン。
**データ混在を防ぎ、各プロジェクトが安全にDBを使用できるようにする。**

## 重要原則

### 1. プロジェクト名の明示（必須）

すべてのDB操作で `project` フィールドを**必ず指定**する。

```json
{
  "project": "OrchestratorUI",  // ← 必須！省略禁止
  "summary": "作業内容",
  ...
}
```

**プロジェクト名の命名規則:**
- フォルダ名と一致させる（例: `OrchestratorUI`, `crypt_bot`, `LINEStickerFactory`）
- 大文字小文字を統一する
- スペースやハイフンは使わない（アンダースコアは可）

### 2. データ分離の仕組み

DBは単一ファイルだが、`project`カラムで論理的に分離:

```sql
-- 各プロジェクトは自分のデータのみ取得
SELECT * FROM work_logs WHERE project = 'OrchestratorUI';
SELECT * FROM active_tasks WHERE project = 'LINEStickerFactory';
```

**禁止事項:**
- `project` フィールドなしでのINSERT
- 他プロジェクトのデータの直接変更
- `project = NULL` でのクエリ

### 3. テーブル別ガイド

| テーブル | 用途 | project必須 | 注意事項 |
|---------|------|-------------|----------|
| work_logs | 作業記録 | ✅ | bot_nameでBot別にも分離可 |
| active_tasks | タスクキュー | ✅ | 他プロジェクトのタスク変更禁止 |
| orchestration_logs | システムログ | ✅ | category/levelも指定 |
| audit_logs | 監査ログ | ✅ | 自動記録、手動変更禁止 |
| human_inbox | 人間対応要求 | ✅ | source_projectで分離 |

## API使用方法

### 作業記録の保存

```bash
curl -X POST http://localhost:9223/api/work_logs \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "unique-session-id",
    "project": "YOUR_PROJECT_NAME",  # ← 必須
    "work_date": "2026-01-25",
    "summary": "作業概要",
    "completed_items": ["項目1", "項目2"],
    "changed_files": ["file1.rs", "file2.tsx"],
    "next_tasks": ["次回タスク1"]
  }'
```

### 自分のプロジェクトのデータ取得

```bash
# 自プロジェクトのみ取得（必ずproject指定）
curl "http://localhost:9223/api/work_logs?project=YOUR_PROJECT_NAME&limit=10"
```

### タスク追加

```bash
curl -X POST http://localhost:9223/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "project": "YOUR_PROJECT_NAME",  # ← 必須
    "title": "タスク名",
    "status": "pending",
    "priority": 5
  }'
```

## Bot専用の分離（crypt_bot向け）

crypt_botのようにBot単位で管理する場合:

```json
{
  "project": "crypt_bot",
  "bot_name": "hyperliquid-btc-perp",  // Bot別に分離
  "summary": "Bot固有の作業"
}
```

これにより:
- `project = crypt_bot` で全Bot共通のデータ
- `bot_name = hyperliquid-btc-perp` で特定Botのデータ

## 横断検索（OrchestratorUI専用）

全プロジェクト横断の検索はOrchestratorUIのみが実行:

```bash
# OrchestratorUIダッシュボード用（他プロジェクトからは使用禁止）
curl "http://localhost:9223/api/work_logs?limit=100"  # project指定なし = 全件
```

**他プロジェクトはこの横断検索を使用禁止。必ず自プロジェクトを指定。**

## エラー防止チェックリスト

- [ ] `project` フィールドを指定した
- [ ] プロジェクト名がフォルダ名と一致している
- [ ] 他プロジェクトのデータを直接変更していない
- [ ] OrchestratorUIが起動している（ポート9223）

## よくある問題

### Q: データが混ざって見える
A: `project` フィールドでフィルタしているか確認

### Q: OrchestratorUIが起動していない
A: スタンドアロンで動作する場合はローカルファイルにフォールバック（DEVELOPMENT_LOG.md）

### Q: プロジェクト名を間違えた
A: 間違ったproject名のデータはOrchestratorUI管理画面から削除可能
