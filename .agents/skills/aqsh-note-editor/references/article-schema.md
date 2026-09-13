# Article schema

記事は`articles/<article-id>/article.md`と`images/`で管理する。基本形は`articles/_template/article.md`を使う。

- `id`: 必須。英数字から始まる、リポジトリ内で一意の固定ID
- `title`: 最初のH1と完全一致させる
- `status`: 必須。MVPでは`draft`固定
- `note`: mappingまたはnull。許可キーは`url`、`key`、`last_synced_at`だけ
- `note.url` / `note.key`: 文字列またはnull。新規ではnull、既存記事だけ指定。型崩れや未知キーでは新規へ切り替えず停止
- `seo.primary_keyword`: 主軸検索語
- `cta`: CTAの有無と遷移先
- `assets.eyecatch`: 使用時だけローカル相対パス

本文画像もローカル相対パスにする。MVPで許可する拡張子は`.png`、`.jpg`、`.jpeg`。リモートURLを画像正本にしない。

最初のH1はnoteタイトルとして扱い、本文HTMLから除外する。H2/H3、段落、引用、箇条書き、番号付きリスト、リンク、コードを標準構文で記述する。
