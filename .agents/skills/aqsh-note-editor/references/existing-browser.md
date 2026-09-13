# Existing Chrome mode

専用`userDataDir`ではnoteのログイン状態を再利用できなかったため、現在はCodex Desktopのブラウザ連携から、ユーザーがすでにログインしているChromeへ接続する。このモードはChromeの認証データを抽出せず、可視画面だけを操作する。

## 現在のhard stop

`draft / inspect / verify`はaction別schemaと固定順序を持つ期限付きplanを生成する。text-onlyエディタ契約は`note-text-editor-2026-09-v1`として固定し、実アカウントで新規下書きのHTML貼付・明示保存・再読込QAと、既存下書きのread-only検査・Git正本比較まで確認済みである。画像、アイキャッチ、既存記事更新、`update`は停止したままとする。

HTML貼付で確認済みの書式は段落、H2、H3、箇条書きである。インラインcode要素は文字を保ったままプレーンテキスト化されたため、記事原稿ではその装飾に依存しない。

## 読み取り確認

1. ブラウザ一覧から、ユーザーが許可した既存Chromeだけを選ぶ。他タブの内容や履歴は調査しない。
2. 既存の設定一覧タブは取得せず、同じChromeにnote専用タブを新規作成して`https://note.com/settings/account/note_id`を直接開く。
3. URLがquery/hashなしの上記完全一致であり、`name=urlname`かつ`aria-label=note ID`の可視入力欄が1件だけで、値が`aqsh`であることを確認する。
4. URL不一致、0件、複数件、別ID、ログイン画面への転送では停止する。
5. ページ全体を取得せず、上記入力欄だけを読む。可視UIが一時的なツール文脈へ入る可能性はあるが、メールアドレス、パスワード、Cookie、storageStateを永続化・出力しない。

この本人確認は永続的なログイン証明として保存せず、`draft / inspect / verify`の実行ごとにやり直す。

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

この節はtext-only新規下書きに適用する。ユーザーが対象原稿の下書き作成を依頼していることを確認し、公開は行わない。

1. ユーザーが記事の下書き作成または更新を明示的に依頼していることを確認する。調査・監査だけなら読み取りで止める。
2. ブラウザ操作の直前にローカルで`aqsh-note draft <article.md> --json`を成功させ、期限内plan、`git_verified: true`、`intended_action`を確定する。別リポジトリへコピーした結果や古いplanを再利用しない。
3. 本人確認に使った既存設定タブは変更せず、同じChromeに`📝 Aqsh note`という短い作業セッション名でnote専用タブを作る。
4. UIはrole、label、placeholder、安定属性の順に特定する。直前にDOM/アクセシビリティ状態を再取得し、古いindexや座標を再利用しない。
5. Codexの既存Chrome executorは、CLIが検証した固定順序のactionだけを実行する。generic click、公開、投稿、`公開に進む`、公開済み記事の`更新する`は拒否する。
6. title入力後は自動保存が始まり得る。途中失敗でもブラウザ状態変更を隠さず、`saved: unknown`の監査結果を残して停止する。
7. `下書き保存`後に同じ編集URLを再読み込みし、title、全文、H2/H3、画像数、重複をローカル期待値と比較する。観測JSONは`record-draft`で検証・記録する。
8. locator、保存状態、編集URLのいずれかが曖昧なら停止し、再試行で別の操作を推測しない。

## 読み取り専用のinspect / verify

1. `inspect https://note.com/aqsh/n/<key> --json`または、対象をfrontmatterへ結び付けた原稿で`verify <article.md> --json`を実行する。
2. `validate-plan <browser-plan.json> --json`で期限、run、改ざん、対象keyとURL、`verify`では現在の原稿SHA-256を再検査する。
3. planどおりにnote ID `aqsh`を確認し、同じChromeの新しいnote専用タブで固定された`https://editor.note.com/notes/<key>/edit/`だけを開く。
4. title/body/save/publish要素が固定済みUI契約どおりであることを確認し、タイトル、本文、H2/H3、本文画像数だけを読む。入力、貼付、クリック、保存、再読込は行わない。
5. exact schemaの観測JSONを`record-inspect`または`record-verify`へ渡す。完全な本文はGit外の`snapshot.json`へ権限`0600`で保存し、標準出力と`result.json`には本文のSHA-256と統計だけを残す。
6. `verify`で1項目でも不一致なら失敗として停止し、修正や再試行、`update`へ自動移行しない。

## 証跡と終了

- raw trace、Cookie、storageState、ログイン・登録・設定・外部画面のスクリーンショットを作らない。
- 結果にはアカウント一致の成否、記事ID、編集URL、検証項目、`published: false`だけを残す。
- ブラウザ連携が利用できない場合、通常ChromeのprofileをローカルPlaywrightへ直接渡す方法へフォールバックしない。
- 公開は常にユーザーがnote画面で手動実行する。
