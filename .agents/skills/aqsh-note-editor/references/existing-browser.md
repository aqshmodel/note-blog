# Existing Chrome mode

専用`userDataDir`ではnoteのログイン状態を再利用できなかったため、現在はCodex Desktopのブラウザ連携から、ユーザーがすでにログインしているChromeへ接続する。このモードはChromeの認証データを抽出せず、可視画面だけを操作する。

## 現在のhard stop

`draft`はaction別schemaと固定順序を持つ期限付きplanを生成する。text-only新規エディタの読み取り契約は`note-text-editor-2026-09-v1`として固定済みである。操作直前にユーザーが対象原稿と実行を確認した初回E2E 1件に限り、タイトル・本文入力、`下書き保存`、再読込検証を行える。画像、アイキャッチ、既存記事更新、`update / verify / inspect`は停止したままとする。

## 読み取り確認

1. ブラウザ一覧から、ユーザーが許可した既存Chromeだけを選ぶ。他タブの内容や履歴は調査しない。
2. 既存の設定一覧タブは取得せず、同じChromeにnote専用タブを新規作成して`https://note.com/settings/account/note_id`を直接開く。
3. URLがquery/hashなしの上記完全一致であり、`name=urlname`かつ`aria-label=note ID`の可視入力欄が1件だけで、値が`aqsh`であることを確認する。
4. URL不一致、0件、複数件、別ID、ログイン画面への転送では停止する。
5. ページ全体を取得せず、上記入力欄だけを読む。可視UIが一時的なツール文脈へ入る可能性はあるが、メールアドレス、パスワード、Cookie、storageStateを永続化・出力しない。

この本人確認は永続的なログイン証明として保存せず、書き込みを伴う実行ごとにやり直す。

## 固定済みのtext-only UI契約

- `https://note.com/notes/new`を開くと、`https://editor.note.com/notes/<key>/edit/`へ遷移する。query、hash、credentials、port、末尾slash欠落は拒否する。
- この遷移は入力前でも記事keyと空の下書き枠を生成し得るため、読み取りだけのナビゲーションも外部状態変更として扱う。
- タイトルは可視の`textarea` 1件、placeholderは`記事タイトル`。
- 本文は可視の`div[role=textbox][contenteditable=true][aria-multiline=true]` 1件。
- 保存はbutton名`下書き保存` 1件。公開系button名`公開に進む` 1件は識別だけ行い、常に操作禁止。

## 下書き計画とUI検査

1. `aqsh-note draft <article.md> --json`を実行し、`status: prepared`、`git_verified: true`、`saved: false`、`published: false`を確認する。
2. `aqsh-note validate-plan <browser-plan.json> --json`を実行し、SHA-256、期限、対象run、account ID、全action schema、現在の原稿SHA-256を再検査する。期限切れplanや生成後に原稿が変わったplanは再利用しない。
3. planの先頭actionどおりに本人確認を行う。
4. 同じChromeの新しいnote専用タブでplan記載の`https://note.com/notes/new`だけを開く。
5. 遷移先URLとtitle/body/save/publish要素を上記契約と比較する。記事keyの生成自体は既知の挙動だが、別URL、件数違い、非表示、属性不一致では停止する。

## 下書き操作

この節は初回のtext-only新規下書きE2E 1件だけに適用する。実行前に対象原稿名、非公開下書きが作られること、`下書き保存`を押すこと、`公開に進む`を押さないことをユーザーへ示し、確認を得る。

1. ユーザーが記事の下書き作成または更新を明示的に依頼していることを確認する。調査・監査だけなら読み取りで止める。
2. ブラウザ操作の直前にローカルで`aqsh-note draft <article.md> --json`を成功させ、期限内plan、`git_verified: true`、`intended_action`を確定する。別リポジトリへコピーした結果や古いplanを再利用しない。
3. 本人確認に使った既存設定タブは変更せず、同じChromeに`📝 Aqsh note`という短い作業セッション名でnote専用タブを作る。
4. UIはrole、label、placeholder、安定属性の順に特定する。直前にDOM/アクセシビリティ状態を再取得し、古いindexや座標を再利用しない。
5. Codexの既存Chrome executorは、CLIが検証した固定順序のactionだけを実行する。generic click、公開、投稿、`公開に進む`、公開済み記事の`更新する`は拒否する。
6. title入力後は自動保存が始まり得る。途中失敗でもブラウザ状態変更を隠さず、`saved: unknown`の監査結果を残して停止する。
7. `下書き保存`後に同じ編集URLを再読み込みし、title、全文、H2/H3、画像数、重複をローカル期待値と比較する。観測JSONは`record-draft`で検証・記録する。
8. locator、保存状態、編集URLのいずれかが曖昧なら停止し、再試行で別の操作を推測しない。

## 証跡と終了

- raw trace、Cookie、storageState、ログイン・登録・設定・外部画面のスクリーンショットを作らない。
- 結果にはアカウント一致の成否、記事ID、編集URL、検証項目、`published: false`だけを残す。
- ブラウザ連携が利用できない場合、通常ChromeのprofileをローカルPlaywrightへ直接渡す方法へフォールバックしない。
- 公開は常にユーザーがnote画面で手動実行する。
