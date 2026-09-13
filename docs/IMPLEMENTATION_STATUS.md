# Implementation status

最終更新: 2026-09-13

## 実装・ローカル検証済み

- [x] `https://note.com/aqsh` を管理対象として設定
- [x] `https://github.com/aqshmodel/note-blog` を`origin`へ設定
- [x] Node 24.19.0 / Playwright 1.63.0固定
- [x] Markdown/frontmatter解析とHTML変換
- [x] 新規/更新preflightと管理対象URL検証
- [x] `dry-run`の新規/更新意図（`intended_action`）確定
- [x] `doctor`
- [x] `dry-run`
- [x] `recover`
- [x] 専用Chrome profileと排他ロック
- [x] 手動`login`コマンド
- [x] 機密値redaction（署名URLの全query値・fragmentを含む）、run ID、`result.json`
- [x] 本文操作用screenshot取得基盤（本人確認後の許可URLのみ）、ログイン・登録・設定画面撮影とraw Playwright traceの全面禁止
- [x] 保存後QA比較ロジック（空白正規化後の全文一致を必須化）
- [x] 公開コマンドなし、公開系UI名の拒否
- [x] 専用profileのログインアカウントをnote ID `aqsh`へ固定する本人確認
- [x] 既存Chrome接続モードで`/settings/account/note_id`の単一入力欄からnote ID `aqsh`を一意確認（2026-09-13）
- [x] profile/stateをGit・content root外へ強制
- [x] profile/stateの専用root・所有marker検証（既存一般フォルダの転用拒否）
- [x] UI操作計画の全action許可リスト検査（generic click禁止）
- [x] browser actionの項目・値・URL・回数・順序を固定schemaで検査
- [x] browser入口の共通runtime gate（Node 24 / macOS / Chrome / Git / 公開禁止）
- [x] configの未知キー・認証情報キー混入を再帰的に拒否
- [x] frontmatterを安全なYAML parserへ固定し、`---js`等の言語タグを拒否
- [x] content rootを本プロジェクト配下、Git originを`aqshmodel/note-blog`へ固定
- [x] `dry-run`の実行ゲートでGit root/originを再確認し、成功時だけ`git_verified: true`
- [x] content root外の記事を読み込み前に拒否し、非同期失敗も単一のsanitized JSONへ変換
- [x] macOS + Google Chrome以外をfail-closed
- [x] リポジトリ内Codex Skill

## 外部環境で確認中

- [x] 既存ChromeでAqshアカウントへのログイン確認
- [!] 専用profile方式は手動ログイン後のセッション再利用に失敗するため診断用に保留
- [ ] 現行noteエディタのtitle/body locator
- [ ] HTML pasteの受理
- [ ] 明示的な下書き保存と自動保存の状態表示
- [ ] 保存後の編集URLと記事key
- [ ] text-only下書き1件の保存後QA

## 後続フェーズ

- [ ] `draft`の本番経路
- [ ] `inspect`
- [ ] `verify`
- [ ] 既存下書きの競合検知と`update`
- [ ] 本文画像3方式のPoCと10回連続E2E
- [ ] アイキャッチ
- [ ] 認証情報を記録しない診断形式（raw Playwright traceの代替）
- [ ] analytics改善ループ

## 現在のゲート

noteへの実書き込みは、既存Chrome接続モードのUI契約確認が終わるまで有効化しません。現在、既存Chromeで許可するのはnote ID専用設定画面の読み取りだけで、Codexからエディタを直接操作しません。解除後も書き込み直前にGit検証済みの`dry-run`と`aqsh`本人確認を行い、固定schema・固定順序planのbrowser executorだけを使います。最初のテスト下書きは外部状態を作るため、対象原稿と実行タイミングを確認してから行います。公開操作はゲート解除の対象外です。
