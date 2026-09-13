# Existing Chrome mode

専用`userDataDir`ではnoteのログイン状態を再利用できなかったため、現在はCodex Desktopのブラウザ連携から、ユーザーがすでにログインしているChromeへ接続する。このモードはChromeの認証データを抽出せず、可視画面だけを操作する。

## 現在のhard stop

`docs/IMPLEMENTATION_STATUS.md`でtitle/body/saveのUI契約が未確認の間は、以下の「読み取り確認」までだけを実行する。新規エディタ・既存編集画面を開くこと、入力、貼付、保存、更新をCodexブラウザ連携から直接行ってはならない。CLIの`draft / update / verify / inspect`が有効化され、action別schemaと固定順序を再検査するbrowser executorを経由できることが解除条件である。

## 読み取り確認

1. ブラウザ一覧から、ユーザーが許可した既存Chromeだけを選ぶ。他タブの内容や履歴は調査しない。
2. 既存の設定一覧タブは取得せず、同じChromeにnote専用タブを新規作成して`https://note.com/settings/account/note_id`を直接開く。
3. URLがquery/hashなしの上記完全一致であり、`name=urlname`かつ`aria-label=note ID`の可視入力欄が1件だけで、値が`aqsh`であることを確認する。
4. URL不一致、0件、複数件、別ID、ログイン画面への転送では停止する。
5. ページ全体を取得せず、上記入力欄だけを読む。可視UIが一時的なツール文脈へ入る可能性はあるが、メールアドレス、パスワード、Cookie、storageStateを永続化・出力しない。

この本人確認は永続的なログイン証明として保存せず、書き込みを伴う実行ごとにやり直す。

## 下書き操作

この節はhard stop解除後の手順であり、現在は実行しない。

1. ユーザーが記事の下書き作成または更新を明示的に依頼していることを確認する。調査・監査だけなら読み取りで止める。
2. ブラウザ操作の直前にローカルで`aqsh-note dry-run <article.md> --json`を成功させ、`git_verified: true`と`intended_action`を確定する。別リポジトリへコピーした結果や古いdry-runを再利用しない。
3. 本人確認に使った既存設定タブは変更せず、同じChromeに`📝 Aqsh note`という短い作業セッション名でnote専用タブを作る。
4. UIはrole、label、placeholder、安定属性の順に特定する。直前にDOM/アクセシビリティ状態を再取得し、古いindexや座標を再利用しない。
5. CLIのbrowser executorが検証した固定順序のactionだけを実行する。Codexから直接actionを組み立てない。generic click、公開、投稿、`公開に進む`、公開済み記事の`更新する`は拒否する。
6. locator、保存状態、編集URLのいずれかが曖昧なら停止し、再試行で別の操作を推測しない。
7. 保存後にtitle、全文、H2/H3、画像数、重複、管理対象URLをローカル期待値と比較する。

## 証跡と終了

- raw trace、Cookie、storageState、ログイン・登録・設定・外部画面のスクリーンショットを作らない。
- 結果にはアカウント一致の成否、記事ID、編集URL、検証項目、`published: false`だけを残す。
- ブラウザ連携が利用できない場合、通常ChromeのprofileをローカルPlaywrightへ直接渡す方法へフォールバックしない。
- 公開は常にユーザーがnote画面で手動実行する。
