# Architecture

## 1. 目的と境界

このシステムは、Aqshのnote記事について「ローカルで制作する」「noteへ下書き反映する」「保存結果を検証する」までを担当します。外部公開、課金設定、マガジン設定、コメントやスキなどの対外操作は担当しません。

```text
Codex Skill
    ↓ 意図判定・原稿編集
aqsh-note CLI
    ↓ 決定論的なpreflight・期待値・action別schema・固定順序plan
Codex browser bridge
    ↓ 既存Chromeのnote専用タブへPlaywright locatorで接続
ログイン済みChrome（認証データは抽出しない）
    ↓
note下書き
```

Markdown、画像、Git履歴が正本です。noteは配信先であり、note上の本文を唯一の原本にしません。

## 2. 責務

### Codex Skill

- ユーザーの意図と対象記事を確認する
- 調査、構成、編集、SEO、CTA、画像要否を判断する
- 新規と更新を判定し、CLIを呼ぶ
- CLI失敗時に推測でブラウザ操作を続けない

### CLI

- frontmatterとMarkdownを解析する
- URL・アカウント・画像・モードを検証する
- 診断用persistent profileは排他利用し、既存Chrome接続ではnote専用の作業タブを1実行につき1つだけ扱う
- UI操作を一箇所へ集約し、計画生成時と実行直前の両方で全操作を許可リスト検査する
- browser入口でNode 24、macOS、Google Chrome、Git root/origin、公開禁止を共通検査する
- 保存後スナップショットを比較し、検証済みbaselineと最新inspectから更新前競合を判定する
- 機密値を除外した証跡を残す

### Playwright

- Codexのブラウザ連携を介して、ユーザーが許可した既存Chromeのnoteタブだけへ接続する
- Chrome profile、Cookie、storageStateを取得・複製しない
- noteの許可済みURLへだけ直接移動する
- role、label、placeholder、安定属性の順に要素を探す
- 下書き保存以外の公開系コントロールを操作しない

## 3. 信頼境界

| 領域 | 扱い |
| --- | --- |
| Gitリポジトリ | 原稿・画像・コード・設定の正本 |
| 既存Chrome | 認証済みの実行面。Codexブラウザ連携だけで可視UIを操作し、profile/Cookieは取得しない |
| note専用profile | 診断用の代替経路。Git外。現環境ではセッション再利用不可のため主経路ではない |
| runtime state | redaction済み`result.json`、期限付き`browser-plan.json`、権限`0600`の完全本文`snapshot.json`と`conflict-report.json`、本人確認後の許可済み本文画面だけの証跡。Git外。ログイン・登録・設定・外部画面の撮影とraw Playwright traceは禁止 |
| note公開ページ | 読み取り対象。ただし管理対象URLを検証 |
| note編集画面 | 書き込み対象。既存Chrome内の専用作業タブと、同時実行禁止が必須 |
| 外部認証画面 | ユーザーによる手動操作のみ。DOMを収集しない |

## 4. 実行パイプライン

1. 設定を読み、Aqshアカウント、プロジェクト内content root、指定Git origin、公開禁止を検証する。`dry-run`成功時は`git_verified: true`を返す。
2. Markdownを読み、title、本文HTML、画像、見出し、リンク、可視文字数、正規化構造と描画内容SHA-256を決定する。
3. `preflight`でCriticalとWarningを分け、有効なnote URL/keyだけから新規`draft`か`update`かを確定する。
4. Criticalがあればブラウザを開かず終了する。
5. 既存Chromeのnote専用タブで`https://note.com/settings/account/note_id`を直接開き、`name=urlname`かつ`aria-label=note ID`の可視入力欄が1件だけで、値が`aqsh`であることを実行ごとに確認する。
6. 同じChromeにnote専用の作業タブを作り、許可URLへだけ移動する。
7. 下書き操作の各actionを実行直前にも再検査する。スクリーンショットは本人確認後かつquery/hashなしの許可済み編集・管理記事URLだけで取得できる。ログイン、登録、設定、外部URLでは拒否し、raw Playwright traceは全操作で無効化する。
8. 保存後の実画面を読み、ローカル期待値と比較する。
9. 読み取り専用の`inspect / verify`では本文DOMを許可タグ・意味属性だけのcanonical structureへ変換し、可視文字列と構造を別々に検証する。
10. 更新前は、原稿の`last_synced_at`以後に成功した`verify`をbaselineとし、同じ対象に対する10分以内の`inspect`と比較する。note側差分があれば停止する。
11. 競合がない場合だけ、private conflict report、現在原稿、記事key、更新直前snapshotに拘束した期限10分のupdate planを準備する。対象差分への明示承認前はブラウザ操作しない。
12. `result.json`へ結果を書き、必ず`published: false`を返す。

title/body/save/publish-controlのtext-only UI契約は`note-text-editor-2026-09-v1`として固定済みである。新規`draft`はタイトル・本文入力、`下書き保存`、再読込QAまで、既存noteの`inspect / verify`は入力・クリック・保存なしの読み取り、snapshot v2のcanonical structure、Git正本比較まで実アカウントで確認済みである。検証済みbaselineと最新inspectによるreport v2の`conflict-check`も実アカウントで確認済みである。既存の非公開text-only下書き`update`は単発E2Eで保存後構造QAと独立verifyまで成功したが、通常運用への昇格は別の安全ゲートとして保留する。画像とアイキャッチもCLIを迂回して操作しない。

認証は投稿ボタンの有無だけでは成立させません。note ID専用設定画面の単一入力欄が`aqsh`と一致した場合だけ、その実行中の管理対象セッションとして受理します。この確認を永続証明へ置き換えません。raw Playwright traceは通信情報を含み得るため生成しません。

## 5. UI変更への対応

UIの安全契約は`src/browser/`、既存Chrome接続の操作手順はSkillの`references/existing-browser.md`へ閉じ込めます。セレクタ不一致、保存状態不明、本文差異、URL不明のいずれかが起きた場合は失敗として停止します。座標クリックや「たぶん保存された」という判定は採用しません。

画像方式はマーカー、セグメント、ドラッグ&ドロップを別々にE2E評価し、本文欠落・順序・重複・ALT・画像数を含む10回連続成功を採用条件とします。

## 6. 更新競合

`conflict-check`は、前回同期後に成功した`verify` snapshotをbaselineとして、その原稿パス・raw source SHA-256・描画内容SHA-256・記事key・URL・run・plan digestを再検査します。現在状態には同じ記事を10分以内に取得した`inspect` snapshot v2を要求し、title、空白正規化後の全文、H2/H3、画像数、リンクURL・リスト・引用・強調を含むcanonical structure、指紋、重複をbaselineと比較します。

note側に差分があれば`status: conflict`、`update_allowed: false`で停止します。before/currentの本文と構造はGit外・権限`0600`の`conflict-report.json`だけへ保存し、標準出力と`result.json`にはhash、統計、理由だけを残します。noteがbaselineと一致し、ローカルの描画内容SHAだけが変わった場合は競合ゲートとして`update_allowed: true`を返します。frontmatterだけの変更はraw source変更として記録しますが、note本文の更新対象にはしません。`update`はこのreportと更新直前snapshotを再検証してplanを準備するだけで、明示承認前には操作しません。既存の非公開text-only下書きは単発E2E成功済みですが、次の実書き込みは通常運用ゲートが別途解除されるまで停止し、公開済み記事の更新UIはMVP対象外です。
