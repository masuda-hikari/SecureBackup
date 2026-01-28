# DB操作必須ルール

## 適用対象
OrchestratorUIおよび連携する全プロジェクト

## 基本原則

### 1. 破壊的操作はDbManager経由必須
- DELETE操作: `db_delete_with_backup` を使用
- UPDATE操作: `db_update_with_backup` を使用（実装予定）
- 直接SQLでの破壊的操作は**禁止**

### 2. バックアップなし削除は禁止
全ての削除操作は事前にバックアップを作成すること。
DbManagerを使用すれば自動でバックアップが作成される。

### 3. 監査ログ記録
全DB操作は監査ログに記録される。
- 操作種別（INSERT/UPDATE/DELETE）
- 対象テーブル
- 影響行数
- 操作元（UI/API/Loop等）

## 使用方法

### フロントエンド（TypeScript）
```typescript
// バックアップ付き削除
const result = await invoke('db_delete_with_backup', {
  dbType: 'orchestration',
  table: 'active_tasks',
  whereClause: 'status = "completed"',
  source: 'UI',
  reason: '完了タスク削除'
});

// 復元
await invoke('db_restore_from_backup', {
  dbType: 'orchestration',
  backupId: result.backup_id
});
```

### バックエンド（Rust）
```rust
use crate::db_manager::{DbManager, DbType, OperationContext};

let manager = DbManager::instance().lock().unwrap();
let context = OperationContext::from_ui(Some("完了タスク削除"));
let result = manager.delete_with_backup(
    DbType::Orchestration,
    "active_tasks",
    "status = 'completed'",
    &context
)?;
```

## 禁止事項

1. **直接SQL禁止**
   ```rust
   // NG: 直接DELETE
   conn.execute("DELETE FROM active_tasks WHERE ...", [])?;

   // OK: DbManager経由
   manager.delete_with_backup(DbType::Orchestration, "active_tasks", "...", &context)?;
   ```

2. **バックアップスキップ禁止**
   ```rust
   // NG: バックアップなしで削除
   conn.execute("DELETE FROM ...", [])?;

   // OK: 必ずバックアップ付き
   manager.delete_with_backup(...)?;
   ```

## 例外

以下の場合のみ直接SQL操作を許可：
- テーブル作成（CREATE TABLE）
- インデックス作成（CREATE INDEX）
- SELECT操作

## 違反時の対応

1. コードレビューで検出された場合は修正必須
2. 本番環境でデータ損失が発生した場合はインシデント報告

## 関連

- [db-manager Skill](.claude/skills/db-manager/SKILL.md)
- [DbManagerモジュール](OrchestratorUI/src-tauri/src/db_manager/)
