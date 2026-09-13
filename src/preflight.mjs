import path from "node:path";
import { access, open } from "node:fs/promises";
import { parseManagedNoteUrl, validateNoteKey } from "./note-url.mjs";
import { isPathWithinRoot } from "./path-safety.mjs";

const ALLOWED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);

function finding(code, message, details = undefined) {
  return details === undefined ? { code, message } : { code, message, details };
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function imageSignatureMatches(filePath, extension) {
  let handle;
  try {
    handle = await open(filePath, "r");
    const buffer = Buffer.alloc(12);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (extension === ".png") {
      return bytesRead >= 8 && buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
    }
    if (extension === ".jpg" || extension === ".jpeg") {
      return bytesRead >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    }
    return false;
  } catch {
    return false;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

function validateUpdateTarget(note, accountId, errors) {
  const errorCountBefore = errors.length;
  let urlTarget = null;
  let keyTarget = null;

  try {
    if (note?.url) urlTarget = parseManagedNoteUrl(note.url, accountId);
  } catch (error) {
    errors.push(finding(error.code ?? "NOTE_URL_INVALID", error.message));
  }

  try {
    if (note?.key) keyTarget = validateNoteKey(note.key);
  } catch (error) {
    errors.push(finding(error.code ?? "NOTE_KEY_INVALID", error.message));
  }

  if (urlTarget && keyTarget && urlTarget.key !== keyTarget) {
    errors.push(finding("NOTE_TARGET_MISMATCH", "note.urlとnote.keyが一致しません。"));
  }

  return {
    hasTarget: Boolean(note?.url || note?.key),
    valid: Boolean(urlTarget || keyTarget) && errors.length === errorCountBefore
  };
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every(key => allowedKeys.has(key));
}

function validateFrontmatter(frontmatter, errors) {
  let valid = true;
  const allowedArticleKeys = new Set([
    "id", "title", "status", "note", "content", "seo", "cta", "assets", "review"
  ]);
  if (!isPlainObject(frontmatter) || !hasOnlyKeys(frontmatter, allowedArticleKeys)) {
    errors.push(finding("ARTICLE_FIELD_UNSUPPORTED", "frontmatterに未対応の項目があります。"));
    valid = false;
  }
  if (typeof frontmatter.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(frontmatter.id)) {
    errors.push(finding("ARTICLE_ID_INVALID", "frontmatter.idには英数字から始まる固定IDが必要です。"));
    valid = false;
  }
  if (frontmatter.status !== "draft") {
    errors.push(finding("ARTICLE_STATUS_INVALID", "frontmatter.statusはdraftで固定してください。"));
    valid = false;
  }
  if (hasOwn(frontmatter, "title") && (typeof frontmatter.title !== "string" || !frontmatter.title.trim())) {
    errors.push(finding("ARTICLE_TITLE_INVALID", "frontmatter.titleは空でない文字列にしてください。"));
    valid = false;
  }

  const mappingSchemas = {
    content: new Set(["type", "audience", "purpose"]),
    seo: new Set(["primary_keyword", "secondary_keywords", "search_intent", "target_questions"]),
    cta: new Set(["enabled", "destination", "utm_campaign"]),
    assets: new Set(["eyecatch"]),
    review: new Set(["last_reviewed_at", "next_review_at"])
  };
  for (const [section, allowedKeys] of Object.entries(mappingSchemas)) {
    if (!hasOwn(frontmatter, section) || frontmatter[section] == null) continue;
    if (!isPlainObject(frontmatter[section]) || !hasOnlyKeys(frontmatter[section], allowedKeys)) {
      errors.push(finding("ARTICLE_SECTION_INVALID", `frontmatter.${section}の構造が不正です。`));
      valid = false;
    }
  }

  if (isPlainObject(frontmatter.seo)) {
    let seoTypesValid = true;
    for (const key of ["primary_keyword", "search_intent"]) {
      if (hasOwn(frontmatter.seo, key) && typeof frontmatter.seo[key] !== "string") seoTypesValid = false;
    }
    for (const key of ["secondary_keywords", "target_questions"]) {
      if (hasOwn(frontmatter.seo, key) && (
        !Array.isArray(frontmatter.seo[key]) ||
        frontmatter.seo[key].some(value => typeof value !== "string")
      )) seoTypesValid = false;
    }
    if (!seoTypesValid) {
      errors.push(finding("ARTICLE_SECTION_INVALID", "frontmatter.seoの値の型が不正です。"));
      valid = false;
    }
  }
  if (isPlainObject(frontmatter.content) && Object.values(frontmatter.content).some(value => typeof value !== "string")) {
    errors.push(finding("ARTICLE_SECTION_INVALID", "frontmatter.contentの値の型が不正です。"));
    valid = false;
  }
  if (isPlainObject(frontmatter.cta) && (
    (hasOwn(frontmatter.cta, "enabled") && typeof frontmatter.cta.enabled !== "boolean") ||
    ["destination", "utm_campaign"].some(key => (
      hasOwn(frontmatter.cta, key) && typeof frontmatter.cta[key] !== "string"
    ))
  )) {
    errors.push(finding("ARTICLE_SECTION_INVALID", "frontmatter.ctaの値の型が不正です。"));
    valid = false;
  }
  if (isPlainObject(frontmatter.review) && Object.values(frontmatter.review).some(value => (
    value !== null && typeof value !== "string"
  ))) {
    errors.push(finding("ARTICLE_SECTION_INVALID", "frontmatter.reviewの値は文字列またはnullで指定してください。"));
    valid = false;
  }
  if (isPlainObject(frontmatter.assets) && hasOwn(frontmatter.assets, "eyecatch") && (
    frontmatter.assets.eyecatch !== null && typeof frontmatter.assets.eyecatch !== "string"
  )) {
    errors.push(finding("ARTICLE_SECTION_INVALID", "frontmatter.assets.eyecatchは文字列またはnullで指定してください。"));
    valid = false;
  }

  if (frontmatter.note == null) return { valid, note: {}, hasDeclaredTarget: false };
  if (!isPlainObject(frontmatter.note)) {
    errors.push(finding("NOTE_SCHEMA_INVALID", "frontmatter.noteはmappingまたはnullで指定してください。"));
    return { valid: false, note: {}, hasDeclaredTarget: true };
  }

  const note = frontmatter.note;
  const allowedKeys = new Set(["url", "key", "last_synced_at"]);
  if (Object.keys(note).some(key => !allowedKeys.has(key))) {
    errors.push(finding("NOTE_FIELD_UNSUPPORTED", "frontmatter.noteに未対応の項目があります。"));
    valid = false;
  }
  for (const key of ["url", "key", "last_synced_at"]) {
    if (hasOwn(note, key) && note[key] !== null && typeof note[key] !== "string") {
      errors.push(finding("NOTE_FIELD_INVALID", `frontmatter.note.${key}は文字列またはnullで指定してください。`));
      valid = false;
    }
  }
  const hasDeclaredTarget = (
    (hasOwn(note, "url") && note.url !== null) ||
    (hasOwn(note, "key") && note.key !== null)
  );
  return { valid, note, hasDeclaredTarget };
}

export async function preflightArticle(article, options = {}) {
  const mode = options.mode ?? "dry-run";
  const accountId = options.accountId ?? "aqsh";
  const shortBodyCharacters = options.shortBodyCharacters ?? 400;
  const externalLinkWarning = options.externalLinkWarning ?? 20;
  const contentRoot = path.resolve(options.contentRoot ?? article.directory);
  const errors = [];
  const warnings = [];
  const frontmatterValidation = validateFrontmatter(article.frontmatter, errors);
  const note = frontmatterValidation.note;
  const hasDeclaredTarget = frontmatterValidation.hasDeclaredTarget;
  const targetValidation = hasDeclaredTarget && frontmatterValidation.valid
    ? validateUpdateTarget(note, accountId, errors)
    : { hasTarget: false, valid: false };
  const intendedAction = !frontmatterValidation.valid
    ? null
    : !hasDeclaredTarget
    ? "draft"
    : targetValidation.valid
      ? "update"
      : null;

  if (!(await isPathWithinRoot(article.sourcePath, contentRoot))) {
    errors.push(finding("ARTICLE_OUTSIDE_CONTENT_ROOT", "記事ファイルが設定されたcontent rootの外にあります。"));
  }

  if (mode === "draft" && (note.url || note.key)) {
    errors.push(
      finding("DRAFT_ALREADY_BOUND", "note.urlまたはnote.keyがあるため、新規下書きとして実行できません。")
    );
  }

  if (mode === "update") {
    if (!targetValidation.valid) {
      errors.push(finding("UPDATE_TARGET_REQUIRED", "更新にはnote.urlまたはnote.keyが必要です。"));
    }
  }

  for (const image of article.images) {
    if (image.remote) {
      errors.push(finding("REMOTE_IMAGE_NOT_ALLOWED", "本文画像はローカルファイルを正本にしてください。"));
    } else if (!image.exists) {
      errors.push(finding("IMAGE_NOT_FOUND", "本文画像が見つかりません。", { source: image.source }));
    } else if (!(await isPathWithinRoot(image.absolutePath, contentRoot))) {
      errors.push(finding("IMAGE_OUTSIDE_CONTENT_ROOT", "本文画像が設定されたcontent rootの外にあります。", {
        source: image.source
      }));
    } else if (!ALLOWED_IMAGE_EXTENSIONS.has(image.extension)) {
      errors.push(finding("IMAGE_FORMAT_UNSUPPORTED", "MVPではPNG/JPG/JPEG画像だけを使用できます。", {
        source: image.source,
        extension: image.extension
      }));
    } else if (!(await imageSignatureMatches(image.absolutePath, image.extension))) {
      errors.push(finding("IMAGE_FILE_INVALID", "本文画像の内容が拡張子と一致しないか、破損しています。", {
        source: image.source
      }));
    }
  }

  const eyecatch = article.frontmatter.assets?.eyecatch;
  if (!eyecatch) {
    warnings.push(finding("EYECATCH_MISSING", "アイキャッチが指定されていません。"));
  } else if (/^https?:\/\//i.test(eyecatch)) {
    errors.push(finding("EYECATCH_REMOTE_NOT_ALLOWED", "アイキャッチはローカルファイルを指定してください。"));
  } else {
    const eyecatchPath = path.resolve(article.directory, eyecatch);
    const extension = path.extname(eyecatchPath).toLowerCase();
    if (!(await pathExists(eyecatchPath))) {
      errors.push(finding("EYECATCH_NOT_FOUND", "アイキャッチ画像が見つかりません。", { source: eyecatch }));
    } else if (!(await isPathWithinRoot(eyecatchPath, contentRoot))) {
      errors.push(finding("EYECATCH_OUTSIDE_CONTENT_ROOT", "アイキャッチ画像が設定されたcontent rootの外にあります。"));
    } else if (!ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
      errors.push(finding("EYECATCH_FORMAT_UNSUPPORTED", "MVPではPNG/JPG/JPEGのアイキャッチだけを使用できます。"));
    } else if (!(await imageSignatureMatches(eyecatchPath, extension))) {
      errors.push(finding("EYECATCH_FILE_INVALID", "アイキャッチ画像の内容が拡張子と一致しないか、破損しています。"));
    }
  }

  if (!article.frontmatter.seo?.primary_keyword) {
    warnings.push(finding("SEO_KEYWORD_MISSING", "primary_keywordが指定されていません。"));
  }
  if (article.frontmatter.cta == null) {
    warnings.push(finding("CTA_MISSING", "CTA方針が指定されていません。"));
  }
  if (article.stats.images === 0) {
    warnings.push(finding("INLINE_IMAGES_MISSING", "本文画像がありません。"));
  }
  if (article.stats.bodyCharacters < shortBodyCharacters) {
    warnings.push(finding("BODY_SHORT", "本文が短いため、意図した原稿か確認してください。", {
      actual: article.stats.bodyCharacters,
      threshold: shortBodyCharacters
    }));
  }
  if (article.stats.externalLinks > externalLinkWarning) {
    warnings.push(finding("EXTERNAL_LINKS_MANY", "外部リンクが多いため確認してください。", {
      actual: article.stats.externalLinks,
      threshold: externalLinkWarning
    }));
  }

  return {
    ok: errors.length === 0,
    mode,
    intendedAction,
    errors,
    warnings
  };
}
