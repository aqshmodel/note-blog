---
name: aqsh-note-editor
description: Aqshのnote記事をMarkdownとGitを正本として制作し、安全に新規下書き、更新前検査、保存後検証する。Aqshのnote記事の企画、執筆、改善、下書き、同期を依頼された場合に使用する。
---

# Aqsh note editor

ユーザーの指示を最優先し、対象は`https://note.com/aqsh`だけとする。原稿と画像はこのリポジトリを正本にする。

## 現在のhard stop

`docs/IMPLEMENTATION_STATUS.md`で現行note UI契約が未確認の間は、既存Chromeで許可されるのはnote ID専用画面の読み取り確認だけである。`/notes/new`や編集画面を開かず、入力、貼付、下書き保存、更新を直接実行しない。`draft / update / verify / inspect`がCLIで有効になり、CLIが生成・再検査したaction別schemaと固定順序のplanをbrowser executorへ渡せるようになるまで、この停止条件を解除しない。

## 必須手順

1. `README.md`と`docs/IMPLEMENTATION_STATUS.md`を読み、現在有効な操作を確認する。
2. 記事を作成・編集し、frontmatterとローカル画像を整える。
3. ブラウザ操作の直前に`npm run aqsh-note -- dry-run <article.md> --json`を実行し、`git_verified: true`を確認する。
4. Criticalがあれば修正して停止し、Warningはユーザーへ明示する。
5. 新規/更新を`note.url`と`note.key`で判定する。曖昧なら書き込まない。
6. UI操作前に [references/existing-browser.md](references/existing-browser.md) を読む。現在は上記hard stopに従い、既存Chromeでの本人確認までに留める。
7. 将来のbrowser executor有効化後も、CLIが検証した固定plan以外を直接操作しない。下書き操作後はverify結果が成功するまで完了と報告しない。

## 安全原則

- 公開ボタン、投稿ボタン、`公開に進む`、公開済み記事の`更新する`を押さない。
- `publish`コマンドを追加・代用しない。
- 既存ChromeにはCodexのブラウザ連携から接続し、Chrome profile、Cookie、storageState、パスワードを取得・表示・コピー・Git保存しない。
- 操作のたびに既存Chromeのnote専用タブで`https://note.com/settings/account/note_id`を直接開き、`note ID`入力欄が1件だけで値が`aqsh`と確認できなければ書き込まない。
- note以外の既存タブ、ブラウザ履歴、他サービスの画面を調査しない。
- preflight前にnoteエディタを開かない。
- selector不一致、URL不明、保存状態不明、verify不一致では推測して続行せず停止する。
- note側の手修正が疑われる場合は上書きせず、inspect、backup、差分確認へ戻す。

## 参照

- 記事仕様は [references/article-schema.md](references/article-schema.md) を読む。
- 下書き運用時は [references/workflow.md](references/workflow.md) を読む。
- 既存Chromeで操作するときは [references/existing-browser.md](references/existing-browser.md) を読む。
- 実装詳細と安全境界はリポジトリ直下の`ARCHITECTURE.md`に従う。
