# プロジェクト名・サービス名 商標・重複チェック規則

## 適用対象
- 新規プロジェクト作成時（必須）
- 既存プロジェクトの公開前（必須）
- サービス名・アプリ名の決定時（必須）

## チェック項目（全項目PASSで公開可）

### 1. 商標データベース検索
| 地域 | 検索サイト | 必須 |
|------|-----------|------|
| 日本 | [J-PlatPat](https://www.j-platpat.inpit.go.jp/) | ✅ |
| 米国 | [USPTO TESS](https://tmsearch.uspto.gov/) | ✅ |
| EU | [EUIPO eSearch](https://euipo.europa.eu/eSearch/) | 推奨 |
| 国際 | [WIPO Global Brand Database](https://branddb.wipo.int/) | 推奨 |

### 2. アプリストア重複検索
| ストア | 検索方法 | 必須 |
|--------|---------|------|
| Google Play | `site:play.google.com "<名前>"` | ✅ |
| Apple App Store | `site:apps.apple.com "<名前>"` | ✅ |
| Microsoft Store | `site:apps.microsoft.com "<名前>"` | Windowsアプリの場合 |

### 3. ドメイン・SNS検索
| 項目 | 検索方法 | 必須 |
|------|---------|------|
| ドメイン | whois検索、namecheap等 | ✅ |
| GitHub | `site:github.com "<名前>"` | ✅ |
| npm | `npmjs.com/search?q=<名前>` | JSプロジェクトの場合 |
| crates.io | `crates.io/search?q=<名前>` | Rustプロジェクトの場合 |
| X/Twitter | `@<名前>` アカウント存在確認 | 推奨 |

### 4. 一般検索
| 検索 | 方法 | 必須 |
|------|------|------|
| Google | `"<名前>" software OR app OR service` | ✅ |
| 類似名 | スペル違い、ハイフン有無なども検索 | ✅ |

## リスク判定基準

### 🔴 NG（使用不可）
- 同一名の登録商標が存在
- 同一カテゴリの有名サービス/アプリが存在
- 大企業の製品名と同一または酷似

### 🟡 要注意（要検討）
- 類似名の商標が存在（別カテゴリ）
- 小規模な同名サービスが存在
- ドメインが取得済み

### 🟢 OK（使用可）
- 商標登録なし
- 同名サービス/アプリなし
- ドメイン取得可能

## チェック結果記録

各プロジェクトの `STATUS.md` に以下を記録:

```markdown
## 名称チェック結果
| チェック項目 | 結果 | 確認日 |
|-------------|------|--------|
| J-PlatPat商標検索 | ✅ 該当なし | 2026-01-19 |
| USPTO TESS | ✅ 該当なし | 2026-01-19 |
| Google Play検索 | ✅ 同名アプリなし | 2026-01-19 |
| App Store検索 | ✅ 同名アプリなし | 2026-01-19 |
| ドメイン確認 | ✅ 取得可能 | 2026-01-19 |
| 一般Google検索 | ✅ 競合なし | 2026-01-19 |

**総合判定**: 🟢 OK / 🟡 要注意 / 🔴 NG
```

## 名称変更が必要な場合

1. 代替名を3-5案作成
2. 各案について上記チェックを実施
3. 最もリスクの低い名前を選択
4. `human_request_required` で承認依頼

## 自動チェックスクリプト使用法

```powershell
# 単一名チェック
.\governance\check_naming.ps1 -Name "ProjectName"

# 全プロジェクト一括チェック
.\governance\check_naming.ps1 -All
```
