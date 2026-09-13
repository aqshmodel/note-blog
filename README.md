# Aqsh note editorial system

Aqshのnoteアカウント [`note.com/aqsh`](https://note.com/aqsh) を、MarkdownとGitを正本として運用するためのローカル基盤です。現在の主経路は、Codex Desktopのブラウザ連携からログイン済みChromeのnoteタブだけへ接続する方式です。一般開発者向け公開APIやCookie抽出には依存しません。

対象GitHubリポジトリ: [`aqshmodel/note-blog`](https://github.com/aqshmodel/note-blog)

## 現在の到達点

Phase 0、Phase 1前半、Phase 4の更新前競合ゲートを実装済みです。

- `doctor`: Node、Playwright、Chrome、Git、設定、安全ガードを確認
- 既存Chrome接続: Cookieをコピーせず、`/settings/account/note_id`の単一入力欄が`aqsh`であることを実行ごとに確認
- `login`: 専用プロファイル方式の診断用コマンド。現環境ではnoteのログイン状態を再利用できないため主経路にはしない
- `dry-run`: Git root/origin、原稿・画像・URLをブラウザなしで検証し、`git_verified: true`と`intended_action`を確定
- `draft`: 既存Chrome用の期限10分・改ざん検知付き固定planを準備。単独ではブラウザを開かず、入力・保存もしない。固定済みtext-only UI契約で新規下書きを実行可能
- `inspect`: Aqsh配下の既存noteを変更せずに読み取り、本文全文と正規化DOM構造をGit外のprivate snapshot v2へ保存
- `verify`: `note.key`または`note.url`で結び付いたMarkdown正本と、既存noteのタイトル・本文・H2/H3・画像数・正規化DOM構造・重複を比較
- `conflict-check`: 前回の成功した`verify`を同期基準に、10分以内の`inspect`と比較して、同じ文字列のリンク先変更やリスト・引用・強調の変更を含むnote側の手修正を検知。本文と構造を含む差分根拠はGit外のprivate reportだけへ保存
- `update`: `update_allowed: true`のprivate conflict reportを現在原稿・記事key・更新直前snapshotへ拘束し、本文を出力しないbefore/after要約と期限10分の既存下書き更新planを準備。単独ではブラウザを開かず、書き込みもしない
- `validate-plan`: browser操作直前にplanの期限・run ID・改ざん・対象URL・現在の原稿SHA-256を再検査する内部ゲート。verify planはraw sourceと描画内容を別々のSHA-256へ拘束
- `recover`: リポジトリ外の実行証跡を読み取り専用で一覧化
- MarkdownのH1/title解決、HTML変換、見出し・画像・リンク・可視文字数・正規化構造の算出
- 保存後QA用のタイトル、本文長、見出し、画像数、指紋、重複比較
- profile排他ロック、機密値redaction、`result.json`、本文操作用screenshotの基盤（本人確認後かつ許可済み編集・記事URLだけ。ログイン・設定画面とraw Playwright traceは撮影禁止）
- 公開コマンドなし。公開・投稿・公開済み記事更新に相当するUI操作をコードで拒否
- ブラウザactionは項目、値、URL、回数、順序を固定schemaで検証。任意selectorや直接操作は許可しない
- 設定は既知キーだけを許可し、認証情報・未知キーの混入を拒否
- frontmatterは`yaml`パーサーへ固定し、`---js`等の実行可能な言語タグを読み込み前に拒否

現行noteエディタのtext-only UI契約は実画面から固定し、非公開下書きのHTML貼付、明示保存、再読込QA、snapshot v2の本文構造検証、既存下書きの更新前競合判定まで実アカウントで確認済みです。既存下書き更新は、承認された非公開スモーク下書き1件で保存・再読込・独立verifyまで成功しました。通常運用への昇格は別の安全ゲート変更として保留し、画像配置も停止しています。詳細は [実装状況](docs/IMPLEMENTATION_STATUS.md) を参照してください。

## セットアップ

```bash
nvm use
npm ci
npm test
```

Node.jsは `.nvmrc` の `24.19.0`、Playwrightは `1.63.0` に固定しています。運用ホストはmacOS、ブラウザはGoogle Chromeに固定し、異なる構成はdoctor/configで停止します。

## 基本操作

```bash
# 環境診断
npm run aqsh-note -- doctor

# 専用profile方式の診断（現在の主経路ではない）
npm run aqsh-note -- login --timeout-minutes 15

# ブラウザを起動せず原稿を検証
npm run aqsh-note -- dry-run articles/_template/article.md

# 機械判読用JSON
npm run aqsh-note -- dry-run articles/_template/article.md --json

# Aqsh配下の既存noteを読み取り専用で検査するplanを準備
npm run aqsh-note -- inspect https://note.com/aqsh/n/<key> --json

# note.keyまたはnote.urlを持つ原稿と既存noteを比較するplanを準備
npm run aqsh-note -- verify articles/<article-id>/article.md --json

# 検証済みbaselineと10分以内のinspect snapshotで更新前競合を判定
npm run aqsh-note -- conflict-check \
  articles/<article-id>/article.md \
  ~/.local/state/aqsh-note/runs/<baseline-verify-run>/snapshot.json \
  ~/.local/state/aqsh-note/runs/<current-inspect-run>/snapshot.json \
  --json

# 競合なしのprivate reportから既存下書き更新planだけを準備
npm run aqsh-note -- update \
  articles/<article-id>/article.md \
  ~/.local/state/aqsh-note/runs/<conflict-run>/conflict-report.json \
  --json

# 失敗時の証跡一覧
npm run aqsh-note -- recover
```

現在の運用では、ユーザーが許可した既存ChromeにCodexのブラウザ連携から接続します。メール欄のある設定一覧は本人確認に使わず、note専用タブで`https://note.com/settings/account/note_id`を直接開き、`note ID`入力欄が`aqsh`であることを実行ごとに一意確認します。Chromeのprofile、Cookie、storageStateは読み出し・コピーしません。手順は [Existing Chrome mode](.agents/skills/aqsh-note-editor/references/existing-browser.md) を参照してください。

専用profile方式を診断する場合は、専用Chromeを前面にして`⌘Q`で終了します。ただし2026-09-13時点のこの環境では、手動ログイン後もPlaywright再起動時にnoteが未ログインへ戻ることを確認したため、下書き運用には使用しません。

AqshアカウントではGoogleログインを選ぶと未連携アカウントとして新規登録画面へ進むため、`aqsh`または登録メールとnote用パスワードを使用します。新規登録は行いません。

リポジトリの`bin/aqsh-note`は`.nvmrc`と同じNodeを選ぶため、`~/.local/bin`へリンクした後は`aqsh-note doctor`の短い形でも実行できます。

`draft`、`inspect`、`verify`は既存Chrome用planを準備します。CLI単体ではブラウザを操作せず、Codexの既存Chrome executorがplanを検証してから固定手順を実行します。`inspect`と`verify`は入力・クリック・保存を行わない読み取り専用です。完全な本文と正規化DOM構造のsnapshotは権限`0600`でGit外へ保存し、標準出力と`result.json`には本文・構造本体を含めません。

`conflict-check`自体はブラウザを起動しません。原稿の`last_synced_at`以後に成功した`verify` snapshotと、同じアカウント・記事keyに対する10分以内の`inspect` snapshotを指定します。baselineと現在のnoteが違えば`status: conflict`で停止します。一致し、ローカルの描画内容がbaselineから変わっている場合だけ`update_allowed: true`になります。`update`はそのprivate report、原稿SHA-256、更新直前snapshot、記事keyに拘束したplanを作りますが、ブラウザ操作は開始しません。Git差分とreport SHA-256を確認したユーザーの明示承認が必要です。frontmatterだけの変更はraw source変更として記録しますが、本文更新は不要と判定します。

ユーザーが新規下書きを依頼したtext-only原稿は、固定済みUI契約で入力・下書き保存・再読込検証できます。`/notes/new`を開く時点で空の下書き枠が生成され得ます。既存下書きの`update`は非書き込みplan準備までを通常経路とし、単発E2Eは成功済みですが、恒久的な実行ゲート解除は別承認まで停止します。画像とアイキャッチも停止中です。`publish`コマンドは今後も作りません。

## 記事の作り方

`articles/_template/` を記事ごとのディレクトリへコピーし、`article.md` とローカル画像を一緒に管理します。

```text
articles/
└── aqsh-2026-001/
    ├── article.md
    └── images/
        ├── cover.png
        └── 01-overview.png
```

最初のH1とfrontmatterの`title`は同じ値にします。H1はnote本文へ二重挿入されません。既存記事を扱う場合だけ、管理対象アカウント配下の`note.url`または`note.key`を指定します。

`dry-run`は、このプロジェクトのGit rootと`https://github.com/aqshmodel/note-blog.git`というoriginを先に検証します。成功時だけ`git_verified: true`を返し、有効な`note.url`または`note.key`があれば`intended_action: update`、なければ`draft`を返します。不正・不一致の対象値がある場合は`null`として失敗し、推測で新規作成へ切り替えません。

## データの置き場所

Git管理するもの:

- Markdown原稿、ローカル画像、設定、コード、テスト、調査記録

Git管理しないもの:

- `~/.cache/aqsh-note/chrome-profile`: 診断用のnote専用Chromeプロファイル（現在は主経路で不使用）
- `~/.local/state/aqsh-note/runs`: `browser-plan.json`、`result.json`、private `snapshot.json`、private `conflict-report.json`、許可された本文操作のスクリーンショット
- Cookie、storageState、パスワード、セッション値

設定読み込み時に、Chromeプロファイルとruntime stateがGitリポジトリまたはcontent rootと重なる構成を拒否します。raw Playwright traceは通信ヘッダーやCookieを記録し得るため、全操作で無効です。将来、認証情報を記録しない診断形式を実装・検証するまで有効化しません。

標準保存先以外を指定する場合は、未作成の専用ディレクトリから開始するか、CLIが作成する`.aqsh-note-profile` / `.aqsh-note-state`所有markerが必要です。既存の一般フォルダをChromeや実行ログの保存先へ転用しません。

## 安全ルール

- 操作対象は`https://note.com/aqsh`に固定する
- 正本はこのプロジェクト配下に限定し、Git originを`https://github.com/aqshmodel/note-blog.git`に固定する
- 既存ChromeはCodexのブラウザ連携だけで操作し、通常ChromeのプロファイルやCookieをローカルへ取得・コピーしない
- 「ログイン中」だけでなく、`/settings/account/note_id`の単一入力欄が`aqsh`であることを確認する
- ブラウザ操作の直前に`dry-run --json`を再実行し、`git_verified: true`を確認する
- preflightが終わるまでnoteエディタを開かない
- `security.allow_publish: false`以外の設定を拒否する
- 公開、投稿、`更新する`に相当するコントロールをクリックしない
- UI操作計画の全要素を許可リストで検査し、将来のexecutorでも実行直前に同じ検査を必須とする
- browser入口ではNode 24、macOS、Google Chrome、Git root/origin、公開禁止を共通ゲートで再検査する
- verify不一致時は再試行せず停止する
- 更新前は、検証済みbaselineと10分以内のinspectを`conflict-check`へ渡し、note側に差分があれば上書きせず停止する
- 公開は塚田さんがnote画面で最終確認して手動実行する

## 開発・検証

```bash
npm test
npm run check
```

実装判断と未確定事項は [実装前調査](research/implementation-research.md)、責務分離は [アーキテクチャ](ARCHITECTURE.md)、ログイン問題は [トラブルシューティング](docs/TROUBLESHOOTING.md) に記録しています。
