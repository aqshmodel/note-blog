import { AqshNoteError } from "../errors.mjs";
import { assertSafeUiActionPlan } from "./safety.mjs";

export function buildDraftPlan(article, config) {
  if (config?.security?.allowPublish !== false) {
    throw new AqshNoteError("PUBLISH_FORBIDDEN", "公開禁止設定を確認できないため停止しました。");
  }
  if (!article?.title || !article?.html) {
    throw new AqshNoteError("ARTICLE_INVALID", "タイトルと変換済み本文が必要です。");
  }
  if (config.editor?.inlineImageStrategy !== "unverified") {
    throw new AqshNoteError(
      "INLINE_IMAGE_STRATEGY_INVALID",
      "本文画像方式はE2E選定前のためunverifiedで固定してください。"
    );
  }
  if ((article.images?.length ?? 0) > 0) {
    throw new AqshNoteError(
      "INLINE_IMAGE_STRATEGY_UNVERIFIED",
      "本文画像の配置方式は既存Chrome向けbrowser executorのE2E検証前のため停止しました。"
    );
  }
  if (article.frontmatter?.assets?.eyecatch) {
    throw new AqshNoteError(
      "EYECATCH_UI_UNVERIFIED",
      "アイキャッチ操作は現行note UIでの検証前のため停止しました。"
    );
  }

  const actions = [
    { kind: "open_new_editor", url: config.editor?.newUrl },
    { kind: "fill_title", value: article.title },
    { kind: "insert_body_html", html: article.html, plainText: article.text },
    { kind: "save_draft", accessibleName: "下書き保存" },
    { kind: "verify" }
  ];

  return {
    actions: assertSafeUiActionPlan(actions),
    published: false
  };
}
