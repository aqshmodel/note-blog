# Aqsh向け note AI編集・投稿基盤 実装指示書
## Codex Skill + Playwright CLI + Markdown/Git による「AI編集部」構築

**対象運用者:** Aqsh株式会社 塚田崇博
**対象環境:** macOS / Codex CLIを中心としたローカルAIエージェント運用
**文書目的:** AIエージェントに本書を渡し、noteの記事制作・下書き投稿・既存記事更新・画像配置・検証・改善運用までを、安全かつ再現可能な形で構築させる
**基本思想:** MOTOHA氏の実運用例を土台に、「Skillは薄く、決定論的な処理は専用CLI/スクリプトへ」「noteは配信先、Markdown/Gitを正本とする」「自動化はまず下書きまで」をAqsh向けに拡張する

---

# 0. この指示書を読むAIエージェントへの最重要指示

このプロジェクトの目的は、単なる「note自動投稿ツール」を作ることではない。

最終的に構築するのは、Aqsh株式会社が継続運用できる **note向けAI編集部基盤** である。

以下の原則を必ず守ること。

1. **noteを原稿の正本にしない。**
   - 原稿、画像、SEO情報、更新履歴はローカルのGit管理リポジトリを正本とする。
   - noteは「配信先」として扱う。

2. **Codexに毎回ブラウザ操作方法を考えさせない。**
   - Codex Skillは判断・ルーティング・安全制御を担当する。
   - note固有の反復操作は、専用CLI/Node.jsスクリプトに固定する。
   - 同じ操作を毎回AIが試行錯誤する構成は禁止。

3. **非公式note APIへの依存を基本方針としない。**
   - noteには一般開発者向けの公式公開APIがない。
   - 本システムの中心はPlaywrightによる実ブラウザ操作とする。
   - 内部APIやCookie抽出を直接使う方式は、通常ルートでは採用しない。

4. **公開は初期フェーズでは自動化しない。**
   - 原則として「下書き作成・下書き更新・検証」までを自動化する。
   - 公開は塚田がnote上で最終確認後に実施する。
   - 将来自動公開を検討する場合も、別フェーズ・別承認ルールとする。

5. **成功判定は「Playwrightがエラーを出さなかった」ではなく、note上の完成結果を検証して決める。**
   - タイトル
   - 本文文字数
   - 見出し
   - 画像数
   - 冒頭・末尾
   - 下書きURL
   を必ず確認する。

6. **noteのUI変更は必ず起きる前提で設計する。**
   - セレクタ変更、エディタ変更、画像アップロードUI変更に耐える構造にする。
   - UI依存コードを局所化する。
   - 異常時は自動停止し、スクリーンショット・ログ・状況を残す。

7. **塚田が使うときの操作を極端に簡単にする。**
   - 理想的な操作は以下。
   ```bash
   aqsh-note draft article.md
   aqsh-note update article.md
   aqsh-note verify article.md
   ```
   またはCodexに自然言語で、
   > この記事をnote向けに整えて、必要な画像を配置し、下書きまで作成して
   と依頼すれば動く状態をゴールとする。

---

# 1. 背景と採用理由

## 1.1 MOTOHA氏の実運用例から採用する考え方

参考とする実運用では、以下の分離が行われている。

```text
~/bin/post-note-draft.py
~/.ai-agent-shared/scripts/post-note-draft.mjs
~/.ai-agent-shared/skills/note-draft/SKILL.md
~/.codex/skills/note-draft/SKILL.md
```

重要なのは、Skill自体に大量のブラウザ操作手順を書かず、

```text
Codex
  ↓
Skill
  ↓
固定CLI / スクリプト
  ↓
Playwright
  ↓
note
```

という構造にしている点である。

Aqsh版では、この思想を踏襲しつつ以下を追加する。

- 記事単位のGit管理
- アイキャッチ
- 本文内の複数画像
- 指定セクションへの画像配置
- 新規記事だけでなく既存記事の更新
- 保存後の自動QA
- SEO/検索需要調査
- noteダッシュボードの数値保存
- 改善履歴管理
- 将来的なKeyword Planner / Ubersuggest / 自社GSCデータとの連携
- 失敗時の復旧・再実行設計

---

# 2. プロジェクトの最終ゴール

## Goal A：記事制作の正本をローカルにする

各記事は最低でも以下を持つ。

```text
article.md
images/
metadata.json または frontmatter
```

Gitで履歴を保持する。

note上で手修正した場合も、原則としてローカル原稿へ反映して同期状態を保つ。

---

## Goal B：Codexからnote下書きを作れる

塚田が以下のように依頼できる状態にする。

> `/path/article.md` をnote用に確認して、下書きにしてください。

Codexは内部で以下を実施する。

```text
原稿確認
↓
preflight
↓
Markdown変換
↓
画像確認
↓
専用Chromeプロファイル起動
↓
noteエディタ
↓
タイトル入力
↓
本文反映
↓
画像配置
↓
アイキャッチ設定
↓
下書き保存
↓
保存結果検証
↓
URL報告
```

---

## Goal C：既存記事を安全に更新できる

以下を可能にする。

> このnote記事を、最新情報を調査してSEO・可読性を改善してください。
> 元記事をバックアップし、差分を見せた上で下書き更新してください。
> 公開はしないでください。

更新前に必ず、

- note上の現状
- ローカル原稿
- 前回同期日時
- 記事URL / note key
- 変更予定箇所

を確認する。

既存記事を「新規記事」として重複作成しない。

---

## Goal D：画像を意図した場所へ配置できる

単に「画像をアップロード」するだけではなく、

```markdown
## AIエージェントとは

本文...

![AIエージェント全体像](./images/01-overview.png)

## 導入フロー

本文...

![導入フロー](./images/02-flow.png)
```

のような原稿をもとに、

- 対応するセクション
- 意図した順番
- alt相当の管理情報
- 必要に応じたキャプション

を維持してnoteへ配置する。

---

## Goal E：投稿後に自動検証する

最低限、以下を自動QAする。

```text
タイトル一致
本文文字数
H2数
H3数
画像数
冒頭テキスト
末尾テキスト
下書きURL
異常な重複本文の有無
空本文でないこと
```

異常時は成功扱いにしない。

---

## Goal F：将来「AI編集部」に拡張できる

最終的には以下のループを可能にする。

```text
テーマ候補
↓
検索需要調査
↓
記事企画
↓
Web調査
↓
原稿
↓
図解・画像
↓
note下書き
↓
人間が公開
↓
noteアクセス状況の取得
↓
評価
↓
改善候補
↓
既存記事更新
```

---

# 3. 非ゴール

初期実装では以下をやらない。

- 無確認の完全自動公開
- noteの非公式APIを主系統にする
- 普段使いのChromeプロファイルを自動操作する
- Cookieをテキストとして出力・コピー・共有する
- ログイン情報をGitへ保存する
- note画面だけを正本として記事を管理する
- 1つの巨大スクリプトに全責務を集約する
- DOM変更時に無限リトライする
- エラーを無視して次の記事を投稿する
- 既存記事更新で記事IDが不明なまま推測して実行する

---

# 4. 推奨システム全体像

```text
┌──────────────────────────────────────────────┐
│ Codex                                        │
│                                              │
│ 調査 / 編集 / SEO判断 / 画像判断 / 実行判断 │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│ ~/.codex/skills/aqsh-note-editor/            │
│ SKILL.md                                     │
│                                              │
│ ・何をいつ実行するか                         │
│ ・安全ルール                                 │
│ ・下書き / 更新 / 検証の振り分け             │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│ Aqsh Note CLI                                │
│ aqsh-note                                    │
│                                              │
│ doctor / login / dry-run / draft / update    │
│ verify / inspect / recover                   │
└──────────────────────┬───────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
       parser       validator     browser
          │            │            │
          └────────────┼────────────┘
                       ▼
┌──────────────────────────────────────────────┐
│ Playwright CLI / Playwright                  │
│ 専用Chromeプロファイル                       │
└──────────────────────┬───────────────────────┘
                       ▼
                  note.com
                       │
                       ▼
                  下書き保存
                       │
                       ▼
                自動QA / スクショ
                       │
                       ▼
                  塚田が確認
                       │
                       ▼
                    公開
```

別にコンテンツ正本を持つ。

```text
Aqsh Note Editorial Repository
│
├── articles/
├── assets/
├── research/
├── analytics/
└── logs metadata
```

---

# 5. 推奨ディレクトリ構成

実装前に既存環境を確認し、衝突がある場合は変更してよい。
ただし責務分離は維持すること。

## 5.1 AI共通基盤

```text
~/.aqsh-ai/
├── instructions.md
├── safety-rules.md
├── scripts/
│   └── note/
│       ├── cli.mjs
│       ├── browser.mjs
│       ├── parser.mjs
│       ├── renderer.mjs
│       ├── images.mjs
│       ├── verify.mjs
│       ├── state.mjs
│       └── logger.mjs
│
├── config/
│   └── note.yaml
│
└── state/
    └── note/
```

`state/` はGit管理しない。

---

## 5.2 Codex Skill

```text
~/.codex/skills/aqsh-note-editor/
├── SKILL.md
├── references/
│   ├── workflow.md
│   ├── article-schema.md
│   ├── note-editor.md
│   ├── troubleshooting.md
│   └── safety.md
└── scripts/
    └── optional helper only
```

OpenAIのSkill設計原則に従い、`SKILL.md`は肥大化させない。

詳細は `references/` に逃がす。

繰り返しロジックは `scripts/` または専用CLIへ置く。

---

## 5.3 CLI入口

```text
~/bin/aqsh-note
```

またはPATHが通ったNode packageとして実装する。

塚田が覚えるコマンドは `aqsh-note` 一つにする。

---

## 5.4 コンテンツリポジトリ

推奨例：

```text
~/AqshContent/note/
├── README.md
├── articles/
│   ├── 2026/
│   │   ├── codex-ssd/
│   │   │   ├── article.md
│   │   │   ├── images/
│   │   │   │   ├── cover.png
│   │   │   │   ├── 01-overview.png
│   │   │   │   └── 02-flow.png
│   │   │   ├── research/
│   │   │   │   ├── sources.md
│   │   │   │   └── notes.md
│   │   │   └── sync.json
│   │   │
│   │   └── astra-skill-audit/
│   │       └── ...
│
├── analytics/
│   ├── note/
│   └── external/
│
├── templates/
│   ├── article.md
│   └── research.md
│
└── .gitignore
```

---

# 6. 記事ファイル仕様

## 6.1 frontmatter

以下を基本形とする。

```yaml
---
id: aqsh-2026-001
title: "記事タイトル"
status: draft

note:
  url: null
  key: null
  last_synced_at: null

content:
  type: research
  audience: "経営者・マーケティング担当者"
  purpose: "専門性獲得・検索流入・Aqshへの相談導線"

seo:
  primary_keyword: ""
  secondary_keywords: []
  search_intent: ""
  target_questions: []

cta:
  enabled: true
  destination: "Aqshへの問い合わせまたは関連サービス"
  utm_campaign: ""

assets:
  eyecatch: "./images/cover.png"

review:
  last_reviewed_at: null
  next_review_at: null
---
```

不要なフィールドを無理に埋めない。

---

## 6.2 Markdown本文

```markdown
# タイトル

導入文。

## セクション1

本文。

![説明](./images/01-overview.png)

## セクション2

本文。

![フロー](./images/02-flow.png)

## まとめ

本文。
```

基本的に最初のH1はタイトルとして使い、note本文へは重複挿入しない。

---

# 7. Aqshのnote編集方針

記事を単なるSEO記事にしない。

塚田のnoteでは、以下の価値を優先する。

## 7.1 テーマ

優先テーマ例：

- AIエージェント
- Codex
- MCP / Plugins / Skills
- Webマーケティング
- SEO自動化
- AIによる業務改善
- 中小企業DX
- 採用・企業ブランディング
- 新規事業
- 地方企業×AI
- 実際にAqshが試した仕組み
- クライアント案件から一般化できる知見
- ツール比較 / 検証 / ファクトチェック

## 7.2 Aqshらしい記事の条件

単なるニュース要約ではなく、以下のいずれかを入れる。

- 実際に試した
- 複数方法を比較した
- 本当に効率的か検証した
- 中小企業ならどう使うか
- Aqshならどう実装するか
- 既存手法より良いか
- 費用対効果
- リスク
- 将来どう変わるか
- 具体的な構成・手順

「AIが書いた一般論」だけの記事は禁止。

---

# 8. 記事制作フロー

## 8.1 記事企画

AIは最初に以下を明確にする。

```text
誰が読むか
何を知りたいか
読み終わった後どうなるか
検索需要はあるか
SNSで読みたくなるか
Aqshの専門性とつながるか
既存記事との差別化は何か
```

---

## 8.2 調査

最低限、以下を使い分ける。

### 公式情報
最優先。

- OpenAI公式
- Google公式
- Microsoft / Playwright公式
- note公式
- 各サービス公式ドキュメント

### 実利用者
「本当に使えるか」を判断するために使用。

- GitHub Issues
- GitHub Discussions
- note
- Zenn
- Qiita
- Reddit
- X
- 開発者ブログ

### キーワード調査

利用可能なら：

- Ubersuggest
- Google Keyword Planner
- Google Trends
- Googleサジェスト
- 関連検索
- 競合SERP

### 自社データ

- AqshサイトのGSC
- GA4
- 過去記事データ
- 問い合わせ
- 商談で頻出する質問

**注意:** 通常のnote.com個人アカウントの記事をAqshのGoogle Search Consoleで直接計測できるとは限らない。GSCは主にAqsh所有サイト側の検索需要・既存流入・記事企画の材料として利用する。note側の実績評価はnoteダッシュボードを中心にする。

---

# 9. note側の計測データ

2026年9月時点のnoteダッシュボードでは、少なくとも以下を確認できる。

- インプレッション
- ページビュー
- スキ
- コメント
- 売上
- 流入元

可能な範囲でPlaywrightから取得し、履歴保存できる構造を検討する。

例：

```text
analytics/note/2026-09-13.json
```

またはCSV。

note proを利用している場合は、別途利用可能な分析機能を調査する。

**この機能は投稿自動化のMVP完成後に実装する。**

---

# 10. note専用Chromeプロファイル

普段使いのChromeは使わない。

専用プロファイルを作る。

推奨例：

```text
~/.cache/aqsh-note/chrome-profile
```

初回のみ、塚田が手動でnoteへログインする。

## 絶対禁止

- Cookieを画面へ出す
- CookieをMarkdownへ保存
- CookieをGitへ保存
- Gmail等の普段使いプロファイルを自動操作
- パスワードをスクリプトへハードコード

---

# 11. Playwright実装方針

## 11.1 Playwright CLI

公式Playwright CLIを利用する。

ただし本番運用では `latest` 任せにせず、動作確認済みバージョンを固定する。

例：

```text
@playwright/cli = 動作確認済みバージョン
playwright = 対応バージョン
```

バージョン更新時はE2Eテストを実施する。

---

## 11.2 headedを基本に検証する

noteはUI変更やブラウザ判定の影響を受ける可能性がある。

MVPでは、

```text
headless: false
```

または同等のheadedブラウザを使う。

画面外に置く方式でもよい。

十分な検証前に完全headlessへ移行しない。

---

## 11.3 セレクタ戦略

優先順位：

1. role
2. label
3. placeholder
4. stable data attribute
5. DOM構造
6. CSS位置依存

座標クリックを常用しない。

セレクタは一箇所に集約する。

例：

```javascript
const NOTE_SELECTORS = {
  title: ...,
  editor: ...,
  save: ...,
  imageButton: ...,
}
```

noteのUI変更時にここを中心に直せるようにする。

---

# 12. Markdown → note本文の変換

MOTOHA氏の実例に倣い、Markdownをそのままキーボード入力しない。

基本：

```text
Markdown
↓
markdown-it等でHTML
↓
note editorへリッチテキスト貼付
```

対応対象：

- paragraph
- H2
- H3
- bold
- lists
- numbered lists
- blockquote
- links
- code block
- inline code

初期段階ではnote固有の高度な装飾を無理に再現しない。

---

# 13. 本文画像の配置方式

ここは実装前に必ずE2E試験を行う。

## 13.1 要求

以下が成立すること。

```markdown
## セクションA
本文A
![A](./images/a.png)

## セクションB
本文B
![B](./images/b.png)
```

noteでも、

```text
セクションA
本文A
画像A

セクションB
本文B
画像B
```

となること。

---

## 13.2 検証すべき実装候補

### 方法A：画像マーカー方式

HTML貼付時に、

```text
[[AQSH_IMAGE:01-overview]]
```

を段落として残す。

その後、

1. マーカーを探す
2. カーソルを移動
3. note画像挿入UIを開く
4. ファイルをアップロード
5. 画像挿入
6. マーカー削除

を行う。

### 方法B：セグメント方式

Markdownを画像位置で分割。

```text
text segment 1
image 1
text segment 2
image 2
text segment 3
```

の順でエディタへ入力する。

### 方法C：ドラッグ&ドロップ方式

note公式が対応している本文への画像ドラッグ&ドロップをPlaywrightで再現できるか検証する。

---

## 13.3 採用基準

最低10回連続で以下が成功すること。

- 画像順序
- 画像位置
- 本文欠落なし
- 重複なし
- 保存後も位置維持
- 再編集時も維持

成功率が低い方式は採用しない。

---

# 14. アイキャッチ

`frontmatter.assets.eyecatch` を読む。

存在する場合のみ設定。

画像がない場合に勝手に別画像を選ばない。

初期対応形式：

- PNG
- JPEG

note公式上の本文画像対応形式と実ブラウザ挙動を確認してから追加形式を検討する。

---

# 15. CLI仕様

最低限、以下を実装する。

## 15.1 doctor

```bash
aqsh-note doctor
```

確認：

- Node
- Playwright
- browser
- Codex Skill
- 設定
- Chrome profile
- content repository
- 書き込み権限
- Git
- ログ出力先

---

## 15.2 login

```bash
aqsh-note login
```

専用Chromeプロファイルでnoteを開く。

ログインは塚田が手動。

成功後、

```text
ログイン状態を確認しました。
Cookieや認証情報は表示していません。
```

とする。

---

## 15.3 dry-run

```bash
aqsh-note dry-run article.md
```

ブラウザを起動しない。

確認：

- frontmatter
- title
- body
- Markdown→HTML
- 画像ファイル存在
- 画像数
- 文字数
- 見出し数
- リンク
- note URL/key
- 新規か更新か

---

## 15.4 draft

```bash
aqsh-note draft article.md
```

新規下書き。

既存 `note.key` が存在する記事では誤って新規作成しない。

---

## 15.5 update

```bash
aqsh-note update article.md
```

既存記事の下書き更新。

`note.key` / URLの確認必須。

---

## 15.6 verify

```bash
aqsh-note verify article.md
```

note下書きとローカル原稿を比較。

---

## 15.7 inspect

```bash
aqsh-note inspect <note-url>
```

note記事の現在状態を取得。

可能なら、

- title
- body text
- headings
- image count
- status
- URL

を返す。

---

## 15.8 recover

```bash
aqsh-note recover
```

前回失敗時の、

- screenshot
- log
- trace
- temp state

を表示・整理する。

自動的に公開操作はしない。

---

# 16. preflightチェック

実行前に必ず行う。

## Critical

一つでも失敗したら停止。

- Markdownが存在
- titleが存在
- bodyが空でない
- 画像ファイルが存在
- note更新時は記事識別子が存在
- Chrome profileが利用可能
- ログイン済み
- 公開操作フラグが無効

## Warning

続行可能だが報告。

- eyecatchなし
- SEOキーワードなし
- CTAなし
- 画像0
- 文字数が極端に短い
- 外部リンク多数

---

# 17. 保存後QA

下書き保存後に必ず取得する。

## title

完全一致。

## body length

HTMLではなく可視テキストで比較。

許容差を設ける場合も ±5%程度を初期目安とし、原因不明の差を成功扱いしない。

## headings

```text
H2 expected: 6
H2 actual: 6
```

## images

```text
expected: 4
actual: 4
```

## text fingerprint

以下を比較。

- 冒頭100〜200文字
- 中央の代表文
- 末尾100〜200文字

## duplication

本文が2回貼られていないか確認。

## URL

保存されたnote URL/keyを取得。

---

# 18. 成功レスポンス

Codexへ機械判読可能な結果も返す。

```json
{
  "status": "success",
  "action": "draft",
  "article_id": "aqsh-2026-001",
  "note_url": "https://note.com/...",
  "checks": {
    "title": true,
    "body": true,
    "headings": true,
    "images": true,
    "duplication": false
  },
  "published": false
}
```

---

# 19. 失敗レスポンス

```json
{
  "status": "failed",
  "phase": "verify",
  "reason": "body_length_mismatch",
  "expected": 5420,
  "actual": 0,
  "published": false,
  "artifacts": {
    "screenshot": "...",
    "trace": "...",
    "log": "..."
  }
}
```

失敗後に自動で次の記事へ進まない。

---

# 20. ログと証跡

1回の実行ごとにrun IDを発行。

```text
20260913-143500-aqsh-2026-001
```

保存：

```text
logs/
└── 20260913-143500-aqsh-2026-001/
    ├── execution.log
    ├── result.json
    ├── before.png
    ├── after.png
    └── trace.zip
```

認証情報は絶対に記録しない。

---

# 21. Git運用

記事変更はコミットできる状態にする。

例：

```text
article: initial research draft
article: add comparison section
assets: add workflow diagram
sync: note draft created
article: update after 14-day review
```

noteへ投稿する直前のGit commit hashを `sync.json` へ記録してもよい。

例：

```json
{
  "note_url": "...",
  "note_key": "...",
  "synced_commit": "abc123",
  "synced_at": "2026-09-13T14:30:00+09:00"
}
```

---

# 22. 新規記事ワークフロー

```text
1. テーマ決定
2. 読者設定
3. 検索意図
4. Keyword調査
5. Web調査
6. 一次資料優先
7. 体験談確認
8. 記事構成
9. 本文
10. ファクトチェック
11. 画像判断
12. 画像作成
13. article.md完成
14. aqsh-note dry-run
15. Git commit
16. aqsh-note draft
17. verify
18. 塚田へURL報告
19. 塚田確認
20. 手動公開
21. note URLをfrontmatterへ保存
```

---

# 23. 既存記事改善ワークフロー

```text
1. note URL確認
2. ローカル原稿確認
3. note現状をinspect
4. 差分確認
5. 元原稿バックアップ
6. 最新Web調査
7. 検索需要再調査
8. 競合更新確認
9. 改善案作成
10. article.md更新
11. 画像更新判断
12. diff生成
13. dry-run
14. Git commit
15. update
16. verify
17. 塚田へ変更点とURL報告
18. 人間が公開
```

---

# 24. SEO/コンテンツ改善判断

以下を一律ルールにしない。

「検索順位だけ」で記事を評価しない。

Aqshのnoteでは、

```text
専門性
信頼
独自性
検索需要
SNS拡散性
問い合わせへの寄与
事業との接続
```

を総合評価する。

---

# 25. 記事改善優先度スコア案

将来実装。

```text
Opportunity Score =
検索需要
× 現在の露出
× 改善余地
× Aqsh事業関連度
× 情報鮮度
```

例：

- すでにPVが多いが古い記事 → 高
- 新モデル名で検索需要急増 → 高
- Aqshサービスへつながる実務記事 → 高
- 競合が非常に強く事業関連が薄い → 低

---

# 26. noteダッシュボード改善ループ

2026年9月時点のnoteアクセス状況には、インプレッションとページビュー等がある。

将来、

```text
公開後7日
公開後28日
公開後90日
```

で数値を保存する。

見るポイント：

## インプレッション高 / PV低
タイトル・テーマ・冒頭訴求を見直す。

## PV高 / スキ低
内容満足度・独自性・読後感を見直す。

## PV高 / 問い合わせ導線弱い
CTA・プロフィール・関連記事導線を見直す。

## 検索流入が増えている
関連テーマを追加する。

---

# 27. 外部データ連携

## Ubersuggest

用途：

- キーワード候補
- 関連語
- 難易度
- 検索需要

## Google Keyword Planner

用途：

- 検索量
- 関連語
- 季節性
- 商用性の参考

## GSC

Aqsh管理サイトで：

- 実検索クエリ
- CTR
- 掲載順位
- impressions
- pages

note記事の直接計測と混同しない。

Aqshサイトで伸びているテーマをnote側のテーマ候補へ利用する。

---

# 28. 画像生成方針

画像を増やすこと自体を目的にしない。

以下の場合に作る。

- 概念が文章だけでは理解しづらい
- 比較
- フロー
- システム構成
- Before / After
- 数字の可視化
- 読者の離脱防止
- SNSシェア時の視認性

## 原則

```text
装飾だけのAI画像 < 内容理解を助ける図解
```

---

# 29. 画像ファイル命名

```text
cover.png
01-overview.png
02-architecture.png
03-comparison.png
04-workflow.png
```

日本語ファイル名は避ける。

---

# 30. 画像の安全チェック

投稿前に、

- 存在
- ファイルサイズ
- 対応形式
- 縦横比
- 読み込み可能
- 破損なし

を確認。

本文画像は当面PNG/JPEGを優先する。

---

# 31. Skill設計

`SKILL.md` に巨大な操作マニュアルを書かない。

SKILL.mdは、

```text
何をするSkillか
いつ使うか
安全原則
実行するCLI
どのreferenceを読むか
成功条件
```

に絞る。

---

# 32. SKILL.mdの想定内容

実装エージェントは以下をベースに実ファイルを作ること。

```yaml
---
name: aqsh-note-editor
description: Aqshのnote記事をMarkdown/Gitを正本として新規下書き作成、既存記事更新、画像配置、投稿前後検証する。note記事の作成・更新・改善・下書き・同期を依頼された場合に使用する。
---
```

本文では、

```text
- ユーザーの指示を最優先
- note公開は原則しない
- まずdry-run
- 新規/更新を判定
- aqsh-note CLIを利用
- ブラウザ操作をその場で再実装しない
- 失敗時は停止
- verifyなしで成功報告しない
```

を必須とする。

---

# 33. AIエージェントに持たせる判断

AIが担当：

- 調査
- 構成
- 編集
- 文章改善
- SEO判断
- 画像要否
- 更新要否
- 実行モード判定
- エラー原因分析

---

# 34. スクリプトに固定する処理

AIへ毎回考えさせない。

- Chrome起動
- profile指定
- note URL
- title locator
- editor locator
- paste処理
- image upload
- draft save
- verify
- screenshot
- trace
- retry回数
- timeout

---

# 35. リトライ方針

無限リトライ禁止。

例：

```text
navigation: 2回
UI element wait: 1回
upload: 2回
save: 1回
verify mismatch: 0回
```

verify mismatch時は人間確認へ回す。

---

# 36. タイムアウト

「数分間何も起きずにAIが試行錯誤」を防ぐ。

UI操作単位の短いtimeoutと、全体timeoutを分ける。

失敗した操作名を明示する。

悪い例：

```text
Timeout
```

良い例：

```text
eyecatch_upload_button_not_found
note editor DOM may have changed
```

---

# 37. UI変更検知

以下の基本E2Eを用意する。

```text
tests/fixtures/test-article.md
```

テスト：

1. 新規下書き
2. title
3. H2
4. list
5. link
6. 画像1枚
7. eyecatch
8. 保存
9. verify

Playwright/Chrome/note仕様変更後はまずこれを実行する。

---

# 38. 本番前の必須テスト

## Test 1
文章のみ。

## Test 2
H2/H3。

## Test 3
箇条書き。

## Test 4
外部リンク。

## Test 5
本文画像1枚。

## Test 6
本文画像3枚を別セクション。

## Test 7
アイキャッチ。

## Test 8
長文5000文字以上。

## Test 9
既存下書き更新。

## Test 10
公開済み既存記事の下書き更新。

各10回までは不要だが、画像位置方式だけは連続試験を強く推奨する。

---

# 39. 受入基準

MVPは以下をすべて満たして完成。

- [ ] 専用Chrome profileでnoteへログインできる
- [ ] `aqsh-note doctor`
- [ ] `aqsh-note dry-run`
- [ ] 新規下書き
- [ ] Markdown見出し維持
- [ ] リスト維持
- [ ] リンク維持
- [ ] アイキャッチ設定
- [ ] 本文画像
- [ ] 複数画像を意図した順序に配置
- [ ] 下書き保存
- [ ] title検証
- [ ] body検証
- [ ] image count検証
- [ ] duplicate検出
- [ ] screenshot保存
- [ ] result.json
- [ ] 失敗時停止
- [ ] 公開しない
- [ ] Cookieを出力しない
- [ ] Git正本
- [ ] 既存記事更新

---

# 40. 実装フェーズ

## Phase 0：調査

- 現在のmacOS
- Node
- npm/pnpm
- Codex
- Playwright
- Chrome
- 既存Skill
- 既存ディレクトリ
- noteログイン状態
- Git環境

---

## Phase 1：MOTOHA型MVP

まず、

```text
Markdown
↓
HTML
↓
Playwright
↓
title
↓
body
↓
下書き
```

だけ完成させる。

画像は後。

---

## Phase 2：QA

- screenshot
- verify
- result JSON
- logs

---

## Phase 3：画像

- eyecatch
- inline image
- multi image
- exact position

---

## Phase 4：既存記事更新

- inspect
- update
- backup
- diff
- verify

---

## Phase 5：Codex Skill

CLIが安定してからSkillを作る。

Skill先行で複雑化しない。

---

## Phase 6：SEO/調査連携

- Ubersuggest
- Keyword Planner
- Aqsh GSC
- Web research

---

## Phase 7：note analytics

- note dashboard
- PV
- impressions
- likes
- referrers
- history

---

# 41. 実装前に調査すべき項目

AIエージェントはコードを書く前に以下を確認すること。

## Codex

- 現在のSkill仕様
- `$CODEX_HOME`
- Skill探索場所
- frontmatter仕様
- validation方法
- scripts/references推奨構成

## Playwright CLI

- 現行バージョン
- macOS既知不具合
- session仕様
- profile/storage state
- attach
- screenshot
- trace
- upload
- clipboard
- current skill installation method

## note

- 現在のeditor URL
- title locator
- body locator
- draft save behavior
- autosave behavior
- image insertion
- eyecatch
- published article edit flow
- preview
- DOM
- file formats
- confirmation dialogs

**調査結果を `research/implementation-research.md` に保存してから実装する。**

---

# 42. 実装時に確認すべきnote仕様

公式ヘルプと実ブラウザの両方で確認。

特に、

- note本文は任意位置へ画像を挿入可能
- 対応画像形式
- editor変更
- 下書きの保存タイミング
- 公開済み記事の再編集
- 画像の拡大縮小
- 見出し画像
- リンク
- 埋め込み

を確認。

---

# 43. セキュリティ

## Gitに入れない

```text
cookies
storageState
Chrome profile
password
session
trace内の機密情報
個人データ
```

`.gitignore`を確実に設定。

---

# 44. 公開操作

初期Skillには明記する。

> 公開ボタンは押さない。

「投稿」など曖昧な文言がnote UIにある場合も、
下書き保存と外部公開を区別する。

外部公開につながるボタンは操作禁止。

---

# 45. 有料記事

MVP対象外。

将来実装する場合、

- 有料ライン
- 価格
- 無料範囲
- 公開
- 再編集時の保持

が事故要因となるため、別Skill/別コマンドを推奨。

---

# 46. バックアップ

既存記事更新時、

```text
backups/
<article-id>/
  before.md
  before.json
  screenshot.png
```

などを保存。

可能ならローカル原稿との差分を生成。

---

# 47. 手修正されたnoteへの対応

note側を人間が修正した可能性がある。

更新前に、

```text
last_synced_at
local hash
note current text
```

を比較。

差異があれば勝手に上書きしない。

Codexへ、

```text
note側にローカルにない変更があります。
差分:
...
```

と返し、マージする。

---

# 48. Aqsh向けCTA

すべての記事に営業CTAを付けない。

記事タイプによって変える。

## 技術記事
「AI活用・業務改善の相談」

## SEO/マーケ記事
「Webマーケティング・改善相談」

## 採用
「採用・企業ブランディング相談」

## 新規事業
「事業開発・AI活用相談」

CTAの有無は記事品質を優先する。

---

# 49. KPI

投稿本数だけをKPIにしない。

見るもの：

```text
記事数
PV
インプレッション
スキ
検索/SNS/note内流入
プロフィール遷移
外部サイトクリック
問い合わせ
商談
記事更新後の改善
```

---

# 50. 運用ルール

## 毎記事
- dry-run
- verify
- Git commit

## 週次
- 投稿結果確認
- エラー確認
- UI変更確認

## 月次
- 上位記事
- 低CTR相当記事
- 高PV記事
- 流入元
- 改善記事選定

## 四半期
- Playwright更新検討
- CLI更新
- Skill棚卸し
- 記事テーマ棚卸し

---

# 51. Aqsh向け将来完成形

```text
┌─────────────────────────────┐
│ Topic Discovery             │
│ ・Ubersuggest               │
│ ・Keyword Planner           │
│ ・Google Trends             │
│ ・Aqsh GSC                  │
│ ・ニュース                  │
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│ Research Agent              │
│ 公式 / GitHub / SNS / 記事 │
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│ Editorial Agent             │
│ Aqsh視点で構成・執筆        │
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│ Visual Agent                │
│ 図解・比較・フロー          │
└──────────────┬──────────────┘
               ▼
          article.md
          + images/
               │
               ▼
┌─────────────────────────────┐
│ aqsh-note CLI               │
│ Playwright                  │
└──────────────┬──────────────┘
               ▼
            note下書き
               │
               ▼
             Verify
               │
               ▼
           塚田レビュー
               │
               ▼
              公開
               │
               ▼
┌─────────────────────────────┐
│ Analytics Agent             │
│ note Dashboard              │
└──────────────┬──────────────┘
               ▼
        Improvement Queue
               │
               └────→ 再調査・更新
```

---

# 52. AIエージェント用Todo

## Priority 0：環境調査

- [ ] macOSバージョン
- [ ] CPU architecture
- [ ] Node/npm/pnpm
- [ ] Chrome
- [ ] Playwright
- [ ] Codex
- [ ] `$CODEX_HOME`
- [ ] 既存Skills
- [ ] Git
- [ ] content repo候補
- [ ] PATH
- [ ] note login

---

## Priority 1：技術調査

- [ ] Codex Skill公式仕様確認
- [ ] Playwright CLI公式仕様確認
- [ ] Playwright current issues確認
- [ ] note公式editor仕様確認
- [ ] MOTOHA構成との差異整理
- [ ] macOS固有注意点整理
- [ ] implementation-research.md作成

---

## Priority 2：MVP

- [ ] repo作成
- [ ] `aqsh-note` CLI作成
- [ ] doctor
- [ ] login
- [ ] Markdown parse
- [ ] HTML convert
- [ ] new draft
- [ ] no publish safeguard

---

## Priority 3：QA

- [ ] screenshot
- [ ] log
- [ ] result.json
- [ ] title check
- [ ] body length
- [ ] heading check
- [ ] duplicate check

---

## Priority 4：画像

- [ ] eyecatch
- [ ] inline 1 image
- [ ] exact position
- [ ] multi image
- [ ] 10-run reliability test
- [ ] image count verify

---

## Priority 5：update

- [ ] note key management
- [ ] inspect
- [ ] local/note diff
- [ ] backup
- [ ] update existing
- [ ] post-update verify

---

## Priority 6：Codex Skill

- [ ] `aqsh-note-editor`作成
- [ ] SKILL.md
- [ ] references
- [ ] validation
- [ ] natural-language test

---

## Priority 7：Editorial automation

- [ ] research template
- [ ] keyword template
- [ ] image manifest
- [ ] CTA rules
- [ ] Aqsh voice guide

---

## Priority 8：Analytics

- [ ] note dashboard調査
- [ ] data extraction PoC
- [ ] history format
- [ ] improvement score

---

# 53. AIエージェントが最初に提出する成果物

コードを書く前に以下を提出。

```text
1. 環境調査結果
2. 現行公式仕様の確認結果
3. note現行UI調査
4. リスク一覧
5. 採用ライブラリ
6. ディレクトリ設計
7. CLI interface
8. MVP実装計画
9. テスト計画
10. 未確定事項
```

ただし、通常は不必要な確認質問で作業を止めず、
安全に仮定できる部分は仮定して実装を進める。

---

# 54. 完成時にAIエージェントが提出するもの

```text
README.md
ARCHITECTURE.md
research/implementation-research.md
~/.codex/skills/aqsh-note-editor/SKILL.md
aqsh-note CLI
tests/
test fixtures
.gitignore
example article
doctor output
dry-run output
E2E result
troubleshooting guide
```

---

# 55. 完成時のデモシナリオ

次の操作が成功すること。

## Scenario A

Codexへ：

> このMarkdown記事をnoteの下書きにしてください。公開はしないでください。

結果：

```text
下書きを作成しました。
タイトル: ...
本文: OK
見出し: OK
画像: 3/3
URL: ...
公開: していません
```

---

## Scenario B

Codexへ：

> この既存note記事を最新情報に更新してください。
> Webで再調査し、元記事を壊さず、画像も必要なら更新してください。
> 下書き更新まで。公開はしないでください。

結果：

```text
調査
↓
ローカル更新
↓
diff
↓
note下書き更新
↓
verify
```

---

# 56. 実装上の最重要判断

**ブラウザ操作をAIエージェントの自由探索にしない。**

成功例の共通点は、

```text
AI
↓
安定したコマンド
↓
安定したブラウザ処理
```

である。

Skillは「判断」、
CLIは「実行」、
Playwrightは「操作」、
Gitは「正本」、
noteは「配信」。

この責務を崩さないこと。

---

# 57. 参考情報・検証元

実装時は必ず最新情報を再確認すること。

## MOTOHA氏の実運用例

- note.comの下書き作成をCodex / Claude Codeから自動化しました
- https://note.com/mukumichan_scrt/n/n8a506c87d663

採用ポイント：

- Codex / Claude Code共通Skill
- Python入口
- Node.js + Playwright実処理
- `--dry-run`
- Markdown → HTML
- 専用Chromeプロファイル
- 下書きまで
- 非公式APIを使わない
- 公開は人間
- 失敗時の状態保持

## OpenAI Codex Skills

- https://github.com/openai/codex
- https://github.com/openai/skills

確認ポイント：

- `SKILL.md`
- `scripts/`
- `references/`
- `assets/`
- Progressive Disclosure
- 繰り返し処理を決定論的スクリプトへ分離

## Playwright CLI

- https://playwright.dev/docs/getting-started-cli
- https://playwright.dev/agent-cli/skills

確認ポイント：

- Coding Agent向けCLI
- Skills
- sessions
- browser state
- snapshots
- upload
- screenshot
- trace
- current known issues

## note公式

### 公開API
https://www.help-note.com/hc/ja/articles/46643492548121

2026年時点で一般開発者向けの公式公開APIなし。

### エディタ
https://www.help-note.com/hc/ja/articles/360012426133

### テキスト記事への画像挿入
https://www.help-note.com/hc/ja/articles/36909557565337

本文中の任意位置へ画像を挿入可能。
実装時点の対応画像形式は必ず公式ヘルプで再確認する。

### アクセス状況
https://www.help-note.com/hc/ja/articles/360010324194

### 流入元
https://www.help-note.com/hc/ja/articles/61983634535449

---

# 58. 最終指示

このシステムは「一度動けば完成」ではない。

**壊れた時に直しやすいこと、誤投稿しないこと、原稿資産を失わないこと、塚田が簡単に使えること**を、投稿速度より優先する。

優先順位は次の通り。

```text
1. データ保全
2. 誤公開防止
3. 正確な下書き
4. 検証可能性
5. 修理しやすさ
6. 操作の簡単さ
7. 処理速度
```

最終的な成功状態は、

> 塚田が記事テーマや原稿をCodexへ渡すだけで、AIが調査・編集・画像判断を行い、Git管理された正本を更新し、noteの正しい位置へ本文と画像を下書き反映し、投稿結果を自動検証したうえでURLを返す。外部公開だけは塚田が最終確認して行う。

という状態である。
