---
id: aqsh-e2e-text-only-20260913-001
title: "Aqsh note運用基盤：非公開下書きテスト"
status: draft

note:
  url: null
  key: nfd501185b9d2
  last_synced_at: "2026-09-13T14:23:59.603Z"

content:
  type: test
  audience: "Aqsh運用担当者"
  purpose: "既存Chrome経由のtext-only下書き保存と検証"

seo:
  primary_keyword: "Aqsh note 運用テスト"
  secondary_keywords: []
  search_intent: ""
  target_questions: []

cta:
  enabled: false
  destination: ""
  utm_campaign: ""

review:
  last_reviewed_at: null
  next_review_at: null
---

# Aqsh note運用基盤：非公開下書きテスト

この原稿は、Aqshのnote運用基盤が正しく動くかを確認するための非公開下書きです。公開記事として使うことは想定していません。MarkdownとGitに保存した内容を正本とし、既存Chromeのログイン状態を利用して、タイトルと本文が一度だけ反映されることを確認します。

## 今回確認すること

最初に、操作対象のnote IDがaqshであることを専用設定画面から確認します。その後、期限付きの実行計画に含まれる操作だけを順番に実施します。Cookie、パスワード、Chromeプロファイル、storageStateは取得も保存もしません。

- タイトルが原稿と完全一致する
- 本文が欠落せず、二重に挿入されない
- H2とH3が指定した順序で残る
- 下書き保存後も公開状態へ進まない

## 保存後の検証

下書き保存後は同じ編集URLを再読み込みし、サーバーから復元された内容を読み取ります。画面上の文字数だけでは成功とせず、可視テキスト全文、見出し、画像数、冒頭・中央・末尾の指紋をローカル原稿と比較します。不一致が一つでもあれば成功扱いにはしません。

### 完了条件

検証結果には記事keyと編集URLを残し、saved: trueとpublished: falseを明記します。外部公開につながる「公開に進む」は識別だけ行い、クリックしません。この下書きが安定して保存・再読込できた場合に限り、次の段階で通常の記事制作へ適用します。

以上でtext-onlyの新規下書き作成と既存下書き更新の接続試験を終えます。画像、アイキャッチ、既存公開記事の更新は別フェーズで検証します。
