# Workflow

## 新規記事

1. 一次情報を優先して調査し、事実・第三者評価・Aqshの判断を分ける。
2. `articles/_template/`から記事ディレクトリを作る。
3. 原稿、CTA、画像、出典を整える。
4. ブラウザ操作の直前に`aqsh-note dry-run`を実行し、`git_verified: true`を確認する。
5. 既存Chrome接続モードで`/settings/account/note_id`の単一入力欄からnote ID `aqsh`と現行UI契約を確認できた場合だけ`draft`へ進む。
6. 保存後QAでtitle、本文長、H2/H3、画像数、指紋、重複、URLを確認する。既存noteとして同期基準に採用する前に、snapshot v2のstructural `verify`を別途成功させる。
7. note上の公開はユーザーが手動で行う。

## 既存記事

1. `note.url`が`https://note.com/aqsh/n/<key>`であることを確認する。
2. 前回同期後に成功した`verify` snapshotをbaselineとして保持する。baselineの観測時刻はfrontmatterの`last_synced_at`以後でなければならない。
3. ローカル原稿を編集し、`dry-run`で`git_verified: true`と更新対象を確認する。
4. note現状を`inspect`し、10分以内のcurrent snapshotを作る。
5. 編集後の原稿、baseline snapshot、current snapshotを`conflict-check`へ渡す。
6. noteの可視文字列またはリンク先・リスト・引用・強調を含む正規化DOM構造がbaselineから変わっていれば上書きせず停止し、Git外のprivate `conflict-report.json`でbefore/currentを確認する。
7. `update_allowed: true`であり、公開状態を変えずに保存できることが実機確認済みの場合だけupdateする。
8. verify不一致なら再試行せず停止する。

現時点ではread-only `inspect / verify`と手順5の`conflict-check`まで実行できる。`update_allowed: true`でも既存noteへの`update`は未実装のため自動実行しない。

## 成功報告

成功報告には、記事ID、下書きURL、title/body/headings/images/duplicationの検証結果、`published: false`を含める。ブラウザ操作を開始していない場合は、ローカル検証とnote実機検証を区別する。
