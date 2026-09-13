# Workflow

## 新規記事

1. 一次情報を優先して調査し、事実・第三者評価・Aqshの判断を分ける。
2. `articles/_template/`から記事ディレクトリを作る。
3. 原稿、CTA、画像、出典を整える。
4. ブラウザ操作の直前に`aqsh-note dry-run`を実行し、`git_verified: true`を確認する。
5. 既存Chrome接続モードで`/settings/account/note_id`の単一入力欄からnote ID `aqsh`と現行UI契約を確認できた場合だけ`draft`へ進む。
6. 保存後verifyでtitle、本文長、H2/H3、画像数、指紋、重複、URLを確認する。
7. note上の公開はユーザーが手動で行う。

## 既存記事

1. `note.url`が`https://note.com/aqsh/n/<key>`であることを確認する。
2. note現状をinspectし、beforeバックアップとfingerprintを作る。
3. 前回同期後の手修正があれば停止して差分を提示する。
4. ローカル原稿を編集し、ブラウザ操作の直前にdry-runして`git_verified: true`を確認する。
5. 公開状態を変えずに保存できることが実機確認済みの場合だけupdateする。
6. verify不一致なら再試行せず停止する。

現時点では手順2のread-only `inspect`と、ローカル原稿を変更しない`verify`まで実行できる。手順3以降で競合がない場合でも、既存noteへの`update`は未実装のため自動実行しない。

## 成功報告

成功報告には、記事ID、下書きURL、title/body/headings/images/duplicationの検証結果、`published: false`を含める。ブラウザ操作を開始していない場合は、ローカル検証とnote実機検証を区別する。
