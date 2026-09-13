---
name: aqsh-note-editor
description: Aqshのnote記事をMarkdownとGitを正本として制作し、安全に新規下書き、更新前検査、保存後検証する。Aqshのnote記事の企画、執筆、改善、下書き、同期を依頼された場合に使用する。
---

# Aqsh note editor

ユーザーの指示を最優先し、対象は`https://note.com/aqsh`だけとする。原稿と画像はこのリポジトリを正本にする。

## 現在のhard stop

`draft`は、既存Chrome向けの期限10分・改ざん検知付き実行計画を作る。現行のtext-only新規エディタ契約は`note-text-editor-2026-09-v1`としてコードとテストへ固定済みである。ユーザーが対象原稿と実行タイミングを確認した1件の初回E2Eに限り、期限内planの固定順序でタイトル・本文を入力し、`下書き保存`して再読込検証できる。画像、アイキャッチ、既存記事更新、`update / verify / inspect`は引き続き停止する。

## 必須手順

1. `README.md`と`docs/IMPLEMENTATION_STATUS.md`を読み、現在有効な操作を確認する。
2. 記事を作成・編集し、frontmatterとローカル画像を整える。
3. ブラウザ操作の直前に`npm run aqsh-note -- dry-run <article.md> --json`を実行し、`git_verified: true`を確認する。
4. Criticalがあれば修正して停止し、Warningはユーザーへ明示する。
5. 新規/更新を`note.url`と`note.key`で判定する。曖昧なら書き込まない。
6. UI操作前に [references/existing-browser.md](references/existing-browser.md) を読み、`validate-plan`で`draft`が発行した期限内plan、対象run、現在の原稿SHA-256を再検査する。初回E2Eでは対象原稿と実行タイミングについて操作直前の確認を得る。
7. Codexの既存Chrome executorは、CLIが検証した固定plan以外を直接操作しない。下書き操作後は再読込観測を`record-draft`へ渡し、verify結果が成功するまで完了と報告しない。

## 安全原則

- 公開ボタン、投稿ボタン、`公開に進む`、公開済み記事の`更新する`を押さない。
- `publish`コマンドを追加・代用しない。
- 既存ChromeにはCodexのブラウザ連携から接続し、Chrome profile、Cookie、storageState、パスワードを取得・表示・コピー・Git保存しない。
- 操作のたびに既存Chromeのnote専用タブで`https://note.com/settings/account/note_id`を直接開き、`note ID`入力欄が1件だけで値が`aqsh`と確認できなければ書き込まない。
- note以外の既存タブ、ブラウザ履歴、他サービスの画面を調査しない。
- preflight前にnoteエディタを開かない。
- 認証済み状態で`/notes/new`を開くと、入力前でも編集URLと空の下書き枠が生成され得る。エディタを開く操作自体を外部状態変更として扱う。
- selector不一致、URL不明、保存状態不明、verify不一致では推測して続行せず停止する。
- note側の手修正が疑われる場合は上書きせず、inspect、backup、差分確認へ戻す。

## 参照

- 記事仕様は [references/article-schema.md](references/article-schema.md) を読む。
- 下書き運用時は [references/workflow.md](references/workflow.md) を読む。
- 既存Chromeで操作するときは [references/existing-browser.md](references/existing-browser.md) を読む。
- 実装詳細と安全境界はリポジトリ直下の`ARCHITECTURE.md`に従う。
