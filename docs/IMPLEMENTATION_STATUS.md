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
- [x] `draft`の非書き込み準備経路（期限10分・SHA-256改ざん検知付き既存Chrome plan）
- [x] planの先頭にnote ID `aqsh`の一意確認を固定
- [x] 現行text-onlyエディタのURL・title・body・保存・公開禁止コントロールを`note-text-editor-2026-09-v1`として固定
- [x] 保存後観測のrun ID拘束と、観測不能時の`saved: unknown`監査記録
- [x] `validate-plan`による操作直前の期限・run・plan改ざん・原稿SHA-256再検査
- [x] `inspect`の読み取り専用plan、private snapshot、本文非反射result
- [x] 読み取りplan / snapshot v2と、許可タグ・意味属性だけを保持するcanonical structure
- [x] `verify`のraw source SHA・描画内容SHA拘束planと、title・全文・H2/H3・画像数・構造・指紋・重複比較
- [x] `conflict-check`による検証済みbaseline・10分以内の最新inspect・raw source SHA・描画内容SHA・`last_synced_at`・対象keyの拘束
- [x] 同じ表示文字列のリンク先変更、リスト・引用・強調などを含むnote側構造差分のfail-closed判定
- [x] frontmatterだけのraw source変更とnote描画内容の変更を分離し、不要な本文更新を抑止
- [x] 全文・構造before/currentを含むGit外・権限`0600`の`conflict-report.json`

## 外部環境で確認中

- [x] 既存ChromeでAqshアカウントへのログイン確認
- [!] 専用profile方式は手動ログイン後のセッション再利用に失敗するため診断用に保留
- [x] 現行noteエディタのtitle/body locator
- [x] HTML pasteの受理（段落、H2、H3、箇条書きを確認。inline codeは文字を保持してプレーンテキスト化）
- [x] 明示的な`下書き保存`と「下書きを保存しました」表示
- [x] 保存後の`editor.note.com`編集URLと記事key
- [x] text-only下書き1件の保存後QA（全文662文字、H2×2、H3×1、画像0、重複なし）
- [x] 既存下書き1件のread-only `inspect` snapshot v2実アカウントE2E（run `20260913-212203-nfd501185b9d2`、全文662文字、H2×2、H3×1、画像0、構造9 block、ブラウザ変更なし）
- [x] 同下書きとGit正本のread-only `verify` snapshot v2実アカウントE2E（run `20260913-211223-aqsh-e2e-text-only-20260913-001`、構造を含む全比較一致、重複なし、ブラウザ変更なし）
- [x] 同下書きの更新前`conflict-check` report v2実アカウントE2E（run `20260913-212520-aqsh-e2e-text-only-20260913-001`、baseline/current構造hash一致、raw source・描画内容ともローカル変更なし、保存・公開なし）

## 後続フェーズ

- [ ] `draft`の本番経路
- [ ] 既存下書きの`update`（競合検知は完了、書き込みUI契約は未検証）
- [ ] 本文画像3方式のPoCと10回連続E2E
- [ ] アイキャッチ
- [ ] 認証情報を記録しない診断形式（raw Playwright traceの代替）
- [ ] analytics改善ループ

## 現在のゲート

text-only新規下書き、既存下書きのread-only `inspect / verify`、更新前`conflict-check`は、既存Chromeの実アカウントE2Eまで完了しました。`inspect / verify`は対象keyを固定し、入力・クリック・保存を含まない4 actionだけを許可します。snapshot v2は可視文字列とcanonical structureを別々に保持し、`conflict-check`は検証済みbaselineと10分以内の最新inspectを同一記事へ拘束して、リンク先やリスト・引用・強調を含むnote側差分があれば停止します。`update_allowed: true`は競合ゲートの通過だけを表し、書き込み許可ではありません。`/notes/new`への遷移だけでも編集URLと空の下書き枠が生成され得るため、ユーザーが新規下書きを依頼した対象原稿だけを扱い、期限内planの固定schema・固定順序以外は使いません。画像、アイキャッチ、既存記事更新、`update`は停止中で、公開操作はゲート解除の対象外です。
