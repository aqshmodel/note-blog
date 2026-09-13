# Aqsh note AI編集・投稿基盤 実装前調査

調査日: 2026-09-13
対象アカウント: `https://note.com/aqsh`（note ID: `aqsh`）
対象リポジトリ: `https://github.com/aqshmodel/note-blog`

この文書は `Aqsh_note_Codex_Playwright_AI_editorial_implementation_guide.md` のPhase 0/1と「最初に提出する成果物」をまとめたものです。確認済み事項と、専用ブラウザでの実機確認が必要な事項を分けています。

## 1. 環境調査結果

| 項目 | 確認結果 | 採用判断 |
| --- | --- | --- |
| OS | macOS 26.1 (25B78) | 対応対象 |
| CPU architecture | `x86_64` | Chromium/Chromeのx86_64環境として扱う |
| 既定Node.js | v20.19.1 | 現行Playwright公式要件外のため不採用 |
| インストール済みNode.js | v24.19.0を確認 | `.nvmrc` でv24.19.0に固定 |
| npm | 10.8.2（既定Node環境） | Node 24同梱npmを実装時に使用 |
| pnpm | 10.11.0 | 今回は運用を単純にするためnpmへ統一 |
| Codex CLI | 0.154.0 | 利用可能 |
| Google Chrome | 152.0.7977.83 | Codexブラウザ連携で既存ログインタブを主経路にする |
| Python Playwright | 1.49.1 | 既存物には触れず、本プロジェクトではNode版を別管理 |
| Node版Playwright | 未導入 | `playwright@1.63.0` をプロジェクトへ固定導入する |
| Git | 2.51.1 | 利用可能 |
| `$CODEX_HOME` | 未設定 | Codex既定の `~/.codex` とリポジトリSkill探索を前提にする |
| `aqsh-note` | 未導入 | 本リポジトリの `bin/aqsh-note.mjs` を単一入口にする |
| PATH | `~/.local/bin` は含まれる。`~/bin` は含まれない | 検証後、必要なら `~/.local/bin/aqsh-note` へ安全にリンクする |
| GitHub remote | 空のリポジトリであることを確認 | ローカルを`main`で初期化し、`origin`へ登録済み |
| GitHub CLI認証 | `aqshmodel` の保存トークンが無効 | ローカル実装は継続。push前に再認証が必要 |

## 2. 現行公式仕様の確認結果

### Codex Skill

- `SKILL.md` には `name` と `description` が必須。
- リポジトリ固有Skillは、リポジトリ内の `.agents/skills/<skill-name>/` で検出される。
- 詳細手順は `references/`、決定論的な反復処理は `scripts/` または外部CLIへ分ける。
- `agents/openai.yaml` はUIメタデータや呼び出し方針に使える。
- 本実装では、Git管理できる `.agents/skills/aqsh-note-editor/` を正本にする。ユーザー全体へインストールする場合は、後で同じ正本へのリンクまたは配布手順を用意する。

公式資料: https://learn.chatgpt.com/docs/build-skills

### Playwright

- 2026-09-13確認時の現行公開版は `1.63.0`。
- 公式の現行システム要件はNode.js 22.x / 24.x / 26.x、macOS 14以降。
- `launchPersistentContext(userDataDir)` でCookieやlocal storageを専用ディレクトリに保持できる。
- Playwright公式は、普段使いのChrome User Dataディレクトリを自動化に使わず、別ディレクトリを作るよう明示している。
- 同じUser Data Directoryを複数ブラウザから同時に開けないため、プロファイルロックを事前確認し、並列実行しない。
- ロケータはrole/label/placeholderなど、利用者から見える属性を優先する。
- ファイル入力が存在する場合は `locator.setInputFiles()`、動的生成の場合は `filechooser` イベントを使える。
- ライブラリ直利用でも `browserContext.tracing` からtraceを取得できる。ただしtraceには画面・DOM・通信情報に加えCookieやSet-Cookieヘッダーが含まれ得る。元指示書の「認証情報は記録しない」を優先し、現段階では全操作でraw traceを生成しない。

公式資料:

- https://playwright.dev/docs/intro
- https://playwright.dev/docs/release-notes
- https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context
- https://playwright.dev/docs/locators
- https://playwright.dev/docs/input#upload-files
- https://playwright.dev/docs/trace-viewer

### note

- note公式ヘルプでは、一般開発者向けの公式公開APIは現在提供されていない。
- PCの新エディタには「下書き保存」があり、約10秒操作しない場合の自動保存もある。
- 本文画像は、挿入位置へカーソルを置いて画像メニューから追加するか、ドラッグ&ドロップで追加できる。
- 本文画像の公式対応形式はJPG、PNG、GIF、HEIC。MVPはJPG/JPEG/PNGだけを許可する。
- 挿入後の画像にはALTを設定できる。Markdownのaltをローカル正本として保持する。
- 公開済み記事の通常更新フローは「公開に進む」から「更新する」へ進むため、下書きだけの安全な更新可否は専用プロファイル上で別途検証が必要。
- 2026-09-08更新の公式ヘルプでは、アクセス状況にインプレッション、ページビュー、スキ、コメント、売上があり、記事の流入元も確認できる。これは投稿MVP後のPhase 7とする。

公式資料:

- https://www.help-note.com/hc/ja/articles/46643492548121
- https://www.help-note.com/hc/ja/articles/360012426133
- https://www.help-note.com/hc/ja/articles/360009035633
- https://www.help-note.com/hc/ja/articles/41639954222105
- https://www.help-note.com/hc/ja/articles/360010324194
- https://www.help-note.com/hc/ja/articles/61983634535449

### 参考実装

MOTOHA氏の実運用例は、Markdownの最初のH1をタイトルとして扱い、MarkdownをHTMLへ変換し、専用Chromeプロファイルを使ってPlaywrightからnoteの下書きまでを作成する。Skill、入口コマンド、ブラウザ実処理を分け、公開は人が行う構成である。本実装も責務分離と公開禁止を踏襲し、検証・画像・更新競合管理を追加する。

参考: https://note.com/mukumichan_scrt/n/n8a506c87d663

## 3. note現行UI調査

### 確認済み

- 公開プロフィール `https://note.com/aqsh` が「塚田 崇博 @ Aqsh」として表示される。
- `https://note.com/aqsh/all` に既存記事があり、少なくとも初期表示分に複数の公開済み記事と「もっとみる」がある。
- 代表確認記事: `https://note.com/aqsh/n/n9b5c6afb2521`
- 公開記事DOMでは、記事タイトルがH1、本文見出しがH2、本文リストがlistとして取得できる。
- 既存Chromeの`https://note.com/settings/account/note_id`を直接開き、可視の単一入力欄が`name=urlname`、`aria-label=note ID`、値`aqsh`であることを確認した。Codexのブラウザ連携経由に限定し、profileやCookieを取得せず主経路として利用する。
- 未認証状態で `https://note.com/notes/new` を開くと、`/login?redirectPath=/notes/new` へ遷移する。
- 専用ChromeからGoogleログインを選ぶと、既存Aqshアカウントへ自動連携されず「連携済みのアカウントがない」新規登録フローへ入ることを確認した。新規登録は行わず、既存のnote IDとnote用パスワードでログインする。
- 専用`userDataDir`は手動ログイン時に認証系Cookieが保存された形跡がある一方、Playwright再起動後のアカウント設定アクセスはログイン画面へ戻った。値は取得せず、専用profile方式は主経路から外した。
- 投稿コントロールは任意のログイン済みnoteユーザーにも表示されるため、認証成功条件には使えるがアカウント本人確認には使えない。最終成功条件はnote ID専用設定画面の単一入力欄が`aqsh`と一致することとする。
- 手動ログインランチャーはmacOSの`/usr/bin/open`とGoogle Chromeを使うため、MVPでは`browser_channel: chrome`およびmacOSホストに固定する。CI上のLinuxはテスト実行環境であり、doctorでは運用非対応としてfailを返す。
- Markdownと画像の正本はこのプロジェクト配下に限定し、doctorに加えて各`dry-run`でGit top-levelと`origin=https://github.com/aqshmodel/note-blog.git`を確認する。

### 既存Chrome接続モードで未確認

- 新規エディタのtitle/bodyロケータ
- HTMLリッチテキスト貼付の現在の受理挙動
- 「下書き保存」完了を示すDOMまたは通知
- 保存後の編集URL・note key取得方法
- アイキャッチUIと本文画像UIのロケータ
- 公開済み記事を外部公開せずに編集状態へ安全に保存できるか
- マーカー方式・セグメント方式・ドラッグ&ドロップ方式の連続成功率

これらは既存Chrome接続モードで、初回テスト下書きの実行前に調査する。通常ChromeのCookieやプロファイルはコピーしない。

## 4. リスク一覧

| リスク | 影響 | 初期対策 |
| --- | --- | --- |
| note UI変更 | 誤操作、保存失敗 | UI依存をdriver/selectorsへ局所化し、role優先、失敗時停止 |
| 公開・更新ボタンの曖昧さ | 意図しない外部公開 | `publish` コマンドを作らず、公開系文言をクリック対象にしない |
| 自動保存 | 空または途中の下書き生成 | preflight完了前はエディタを開かない。失敗を証跡化 |
| 既存Chrome利用 | 他タブ・認証情報の過剰取得 | note専用タブでnote ID専用URLを直接開き、対象入力欄だけを読み、profile/Cookie/履歴へアクセスしない |
| profile多重起動 | ブラウザ起動失敗・破損 | CLI全体のロックを取得し、並列投稿を禁止 |
| trace/スクリーンショット | 認証済みDOM、通信ヘッダー、Cookie等の漏えい | raw traceは全面無効。画像は本人確認後の許可済み編集・管理記事URLだけに限定し、Git外へ保存 |
| HTML貼付仕様変更 | 書式欠落、本文重複 | dry-runで期待値を固定し、保存後に可視テキスト・見出し・重複を検証 |
| 画像位置ずれ | 記事意味の毀損 | 戦略を設定で選び、実機10回試験前は画像付きdraftを合格扱いにしない |
| 既存記事の手修正 | 上書き・情報損失 | note現在値と前回fingerprintが不一致ならupdate停止 |
| Node/Playwrightのずれ | 起動不能・不安定 | Node 24.19.0、Playwright 1.63.0を固定 |
| Chrome/Playwrightの世代差 | 診断用persistent contextの不安定化 | 診断経路は停止し、主経路の既存Chrome連携へ影響させない。別ブラウザへ暗黙切替しない |
| GitHub認証失効 | push不能 | ローカル作業は保持し、認証回復後にpushする |

## 5. 採用ライブラリ

| 依存 | バージョン | 用途 |
| --- | --- | --- |
| Node.js | 24.19.0 | 実行基盤 |
| `playwright` | 1.63.0 | 安全契約のローカル検証と診断用persistent context。実運用UIはCodex browser bridgeのPlaywright locatorを使用 |
| `@playwright/test` | 1.63.0 | E2E・回帰テスト |
| `markdown-it` | 15.0.2 | MarkdownからHTMLへの決定論的変換 |
| `yaml` | 2.9.1 | `config/note.yaml`とMarkdown frontmatterの安全なYAML解析。言語タグ付きfrontmatterは事前拒否 |

CLI引数処理、ハッシュ、ロック、ファイル検査、JSON出力はNode標準機能を優先し、依存を増やさない。

## 6. ディレクトリ設計

```text
note-blog/
├── .agents/skills/aqsh-note-editor/
│   ├── SKILL.md
│   ├── agents/openai.yaml
│   └── references/
├── articles/
├── backups/                 # 内容はGit管理外、説明用.keepのみ置かない
├── bin/aqsh-note.mjs
├── config/note.yaml
├── research/
│   └── implementation-research.md
├── src/
│   ├── browser/
│   ├── commands/
│   └── *.mjs
├── tests/
│   ├── fixtures/
│   ├── unit/
│   └── e2e/
├── README.md
├── ARCHITECTURE.md
├── package.json
└── .gitignore
```

認証状態と実行証跡はリポジトリ外へ置く。

```text
~/.cache/aqsh-note/chrome-profile
~/.local/state/aqsh-note/runs
~/.local/state/aqsh-note/locks
```

## 7. CLI interface

```text
aqsh-note doctor [--json]
aqsh-note login [--timeout-minutes <n>]
aqsh-note dry-run <article.md> [--json]
aqsh-note draft <article.md> [--json]
aqsh-note update <article.md> [--json]
aqsh-note verify <article.md> [--json]
aqsh-note inspect <note-url> [--json]
aqsh-note recover [run-id] [--json]
```

- `dry-run` はブラウザを起動しない。
- `draft` は `note.key` または `note.url` がある原稿を拒否する。
- `update` は `note.key` または許可アカウント配下のURLがない原稿を拒否する。
- `verify` なしにブラウザ操作を成功扱いしない。
- `inspect` は `https://note.com/aqsh/...` のみを既定許可する。
- `recover` は証跡を列挙するだけで、投稿・公開・自動再実行をしない。
- 公開コマンドは実装しない。

## 8. MVP実装計画

1. プロジェクト設定、Git除外、account設定、Node 24固定を作る。
2. parser/renderer/preflightのテストを先に作り、期待どおり失敗することを確認する。
3. 最小実装で `dry-run` を完成させ、JSON結果を固定する。
4. doctor/logger/state/run-lockを同じくテスト先行で実装する。
5. `login` とtext-only `draft` の安全契約を実装する。公開系操作はコード上に持たない。
6. 既存Chrome接続モードでアカウントを都度確認し、現在のエディタDOMを最小限に調査してtext-only E2Eを行う。
7. 保存後QA、本文操作用screenshot、redaction済みresult.jsonを実装・確認する。raw traceは生成しない。
8. 画像3方式を別々にPoCし、10回連続試験に通った方式だけを採用する。
9. inspect/backup/conflict detection/updateを実装する。
10. CLIが安定した後、薄いCodex Skillとreferencesを確定する。

## 9. テスト計画

### Unit / integration（ネットワーク・note不要）

- frontmatter titleと先頭H1の解決、双方不一致時の停止
- H1を本文へ重複させない
- H2/H3、リスト、リンク、コードのHTML変換
- ローカル画像の相対パス解決、欠落・拡張子・破損チェック
- 記事文字数、見出し数、画像数、冒頭・中央・末尾fingerprint
- note URL/keyの形式とアカウントallowlist
- 新規/更新の誤判定防止
- 公開操作フラグを受理しない
- run ID、result.json、機密値redaction
- config未知キー・認証情報キーの拒否、`---js`等のfrontmatter言語タグの非実行
- duplicate本文検出
- profile/run lock

### E2E（既存Chrome接続と実行時アカウント確認が必須）

- text-only draft
- H2/H3、リスト、リンク、コード
- 5000文字以上
- eyecatch
- 本文画像1枚
- 別セクション本文画像3枚
- 画像方式の10回連続試験
- 既存下書きの競合検知と更新
- 公開済み記事の安全な更新可否（公開操作直前で必ず停止する設計を先に確認）
- UI変更時は、本人確認後の許可済み本文URLだけでスクリーンショットとredaction済みresult.jsonを残して停止（ログイン・設定画面とraw traceは生成しない）

## 10. 未確定事項とゲート

### 実装を進められる事項

- リポジトリ、設定、記事schema、parser、renderer、dry-run、doctor、ログ、証跡、Skill雛形
- `aqsh` アカウントへのURL制限
- 専用プロファイルでのloginコマンド（診断用）
- 既存Chrome接続モードのアカウント本人確認手順
- 公開機能を持たないbrowser driverの骨格

### 既存Chrome接続モードの実画面でなければ確定できない事項

- 実際のtitle/body/saveロケータ
- HTML貼付方式
- draft URL/keyの取得
- アイキャッチと本文画像の操作方式
- 公開済み記事を公開せず更新状態へ残す方法
- 保存後verifyの実DOM範囲

### 外部反映ゲート

- note公開: 対象外。実装しない。
- note下書き作成: preflight、既存Chrome上の実行時アカウント確認、text-only E2E準備後に初回テストの承認対象とする。
- GitHub push: ローカルテスト完了後。現在はGitHub CLI再認証が必要。
