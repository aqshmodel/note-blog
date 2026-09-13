import { access, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import MarkdownIt from "markdown-it";
import YAML from "yaml";
import { AqshNoteError } from "./errors.mjs";
import { renderedContentSha256, structureFromMarkdownTokens } from "./structure.mjs";

const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false
});

function trimTitle(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseDocument(source) {
  const normalized = source.startsWith("\uFEFF") ? source.slice(1) : source;
  const firstLine = normalized.split(/\r?\n/, 1)[0];
  if (firstLine.startsWith("---") && firstLine !== "---") {
    throw new AqshNoteError(
      "FRONTMATTER_LANGUAGE_UNSUPPORTED",
      "frontmatterは言語タグなしのYAMLだけを使用できます。"
    );
  }
  if (firstLine !== "---") return { data: {}, content: normalized };

  const lines = normalized.split(/\r?\n/);
  const closingIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (closingIndex === -1) {
    throw new AqshNoteError("FRONTMATTER_INVALID", "frontmatterの終了区切りがありません。");
  }

  let data;
  try {
    data = YAML.parse(lines.slice(1, closingIndex).join("\n")) ?? {};
  } catch {
    throw new AqshNoteError("FRONTMATTER_INVALID", "frontmatterのYAMLを解釈できません。");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new AqshNoteError("FRONTMATTER_INVALID", "frontmatterはYAMLのmappingで記述してください。");
  }
  return { data, content: lines.slice(closingIndex + 1).join("\n") };
}

function findFirstH1(source) {
  const tokens = markdown.parse(source, {});
  const index = tokens.findIndex(token => token.type === "heading_open" && token.tag === "h1");
  if (index === -1) return null;
  const heading = tokens[index + 1];
  return {
    title: trimTitle(heading?.content),
    lineRange: tokens[index].map
  };
}

function removeLineRange(source, lineRange) {
  if (!lineRange) return source.trim();
  const lines = source.split(/\r?\n/);
  lines.splice(lineRange[0], lineRange[1] - lineRange[0]);
  return lines.join("\n").trim();
}

function inlineVisibleText(children = []) {
  let text = "";
  for (const token of children) {
    if (token.type === "text" || token.type === "code_inline") text += token.content;
    if (token.type === "softbreak" || token.type === "hardbreak") text += " ";
  }
  return text;
}

export function normalizeVisibleText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function inspectTokens(tokens) {
  const headings = { h2: [], h3: [] };
  const images = [];
  const links = [];
  const visibleBlocks = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === "heading_open" && (token.tag === "h2" || token.tag === "h3")) {
      headings[token.tag].push(trimTitle(tokens[index + 1]?.content));
    }

    if (token.type === "inline") {
      const blockText = inlineVisibleText(token.children);
      if (blockText) visibleBlocks.push(blockText);

      for (const child of token.children ?? []) {
        if (child.type === "image") {
          images.push({
            source: child.attrGet("src") ?? "",
            alt: child.content ?? "",
            title: child.attrGet("title") ?? null
          });
        }
        if (child.type === "link_open") {
          links.push(child.attrGet("href") ?? "");
        }
      }
    }

    if (token.type === "fence" || token.type === "code_block") {
      visibleBlocks.push(token.content);
    }
  }

  return {
    headings,
    images,
    links,
    text: normalizeVisibleText(visibleBlocks.join(" "))
  };
}

function isExternalLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function describeImage(image, articleDirectory) {
  const remote = /^https?:\/\//i.test(image.source);
  const absolutePath = remote ? null : path.resolve(articleDirectory, image.source);
  let exists = false;
  if (absolutePath) {
    try {
      await access(absolutePath);
      exists = true;
    } catch {
      exists = false;
    }
  }

  return {
    ...image,
    remote,
    absolutePath,
    extension: remote ? path.extname(new URL(image.source).pathname).toLowerCase() : path.extname(absolutePath).toLowerCase(),
    exists
  };
}

export async function loadArticle(filePath) {
  const absoluteFilePath = path.resolve(filePath);
  let source;
  try {
    source = await readFile(absoluteFilePath, "utf8");
  } catch (error) {
    throw new AqshNoteError("ARTICLE_NOT_FOUND", "Markdown記事を読み込めません。", {
      filePath: absoluteFilePath,
      cause: error.code
    });
  }

  const parsed = parseDocument(source);
  const h1 = findFirstH1(parsed.content);
  const frontmatterTitle = trimTitle(parsed.data.title);
  const h1Title = trimTitle(h1?.title);

  if (frontmatterTitle && h1Title && frontmatterTitle !== h1Title) {
    throw new AqshNoteError("TITLE_MISMATCH", "frontmatter titleと先頭H1が一致しません。", {
      frontmatterTitle,
      h1Title
    });
  }

  const title = frontmatterTitle || h1Title;
  if (!title) {
    throw new AqshNoteError("TITLE_REQUIRED", "frontmatter titleまたはH1タイトルが必要です。");
  }

  const bodyMarkdown = removeLineRange(parsed.content, h1?.lineRange);
  if (!bodyMarkdown) {
    throw new AqshNoteError("BODY_REQUIRED", "タイトル以外の本文が必要です。");
  }

  const tokens = markdown.parse(bodyMarkdown, {});
  const inspected = inspectTokens(tokens);
  const structure = structureFromMarkdownTokens(tokens);
  if (!inspected.text) {
    throw new AqshNoteError("BODY_REQUIRED", "可視テキストを含む本文が必要です。");
  }

  const articleDirectory = path.dirname(absoluteFilePath);
  const images = await Promise.all(
    inspected.images.map(image => describeImage(image, articleDirectory))
  );

  return {
    id: parsed.data.id ?? null,
    title,
    sourcePath: absoluteFilePath,
    sourceSha256: createHash("sha256").update(source, "utf8").digest("hex"),
    renderedContentSha256: renderedContentSha256({ title, structure }),
    directory: articleDirectory,
    frontmatter: parsed.data,
    bodyMarkdown,
    html: markdown.render(bodyMarkdown),
    structure,
    text: inspected.text,
    headings: inspected.headings,
    images,
    links: inspected.links,
    stats: {
      bodyCharacters: inspected.text.length,
      h2: inspected.headings.h2.length,
      h3: inspected.headings.h3.length,
      images: images.length,
      links: inspected.links.length,
      externalLinks: inspected.links.filter(isExternalLink).length
    }
  };
}
