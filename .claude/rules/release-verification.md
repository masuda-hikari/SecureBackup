# リリース検証ルール

## 概要
「リリース完了」「公開完了」と報告する前に、必ず全項目を検証すること。
虚偽報告は許容されない。

## リリース前必須検証チェックリスト

### 1. リポジトリ公開状態
```bash
gh repo view {owner}/{repo} --json visibility
```
- [ ] `"visibility": "PUBLIC"` であること
- [ ] Private の場合、リリースURLは外部からアクセス不可

### 2. GitHub Releases 作成確認
```bash
gh release view {tag} --repo {owner}/{repo}
```
- [ ] リリースが存在すること
- [ ] タグのみプッシュではReleasesは作成されない

### 3. ダウンロードファイル確認
```bash
gh release view {tag} --json assets
```
- [ ] インストーラー（.exe/.msi/.dmg）がアップロードされていること
- [ ] ファイルサイズが正常であること（0バイトでない）

### 4. URL アクセス確認
```bash
curl -I https://github.com/{owner}/{repo}/releases/tag/{tag}
```
- [ ] HTTP 200 であること
- [ ] 404/403 でないこと

### 5. ダウンロード動作確認
- [ ] 実際にダウンロードできること
- [ ] ダウンロードしたファイルが破損していないこと

## 正しいリリース手順

### Step 1: ビルド
```bash
npm run tauri build
# または
cargo build --release
```

### Step 2: リリース作成（GitHub CLI）
```bash
gh release create v{VERSION} \
  --title "v{VERSION}" \
  --notes "リリースノート" \
  ./path/to/installer.exe \
  ./path/to/installer.msi
```

### Step 3: 検証
```bash
# リリース存在確認
gh release view v{VERSION}

# URL確認
curl -I https://github.com/{owner}/{repo}/releases/tag/v{VERSION}

# アセット確認
gh release view v{VERSION} --json assets
```

### Step 4: STATUS.md更新
**検証が全て完了してから**STATUS.mdに「リリース完了」と記載すること。

## 禁止事項

- [ ] 検証なしで「リリース完了」と報告
- [ ] Privateリポジトリで「公開完了」と報告
- [ ] タグプッシュのみでReleasesを作成したと報告
- [ ] ダウンロードURLを確認せずにSTATUS.mdにURL記載

## 違反時の対応

1. STATUS.mdの記載を修正（虚偽を削除）
2. 正しいリリース手順を実行
3. 検証完了後に再度STATUS.md更新

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-01-18 | 初版作成（SecureBackup虚偽報告問題を受けて） |
