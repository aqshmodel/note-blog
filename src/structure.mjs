import { createHash } from "node:crypto";
import { AqshNoteError } from "./errors.mjs";

const ALLOWED_TAGS = new Set([
  "p", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "blockquote",
  "strong", "em", "s", "u", "mark", "a",
  "br", "hr", "pre", "code", "img", "figure", "figcaption"
]);
const VOID_TAGS = new Set(["br", "hr", "img"]);
const MAX_DEPTH = 32;
const MAX_NODES = 50_000;
const MAX_VALUE_LENGTH = 500_000;

function invalidStructure() {
  return new AqshNoteError(
    "ARTICLE_STRUCTURE_INVALID",
    "記事の正規化構造を安全に確認できないため停止しました。"
  );
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isPlainObject(value) &&
    Object.keys(value).length === keys.size &&
    Object.keys(value).every(key => keys.has(key));
}

function safeString(value, { allowEmpty = true } = {}) {
  if (typeof value !== "string" || value.length > MAX_VALUE_LENGTH || (!allowEmpty && !value)) {
    throw invalidStructure();
  }
  if (/\0/.test(value)) throw invalidStructure();
  return value;
}

function normalizeText(value, preserveWhitespace) {
  const text = safeString(value).replace(/\r\n?/g, "\n");
  return preserveWhitespace ? text : text.replace(/\s+/g, " ");
}

function canonicalAttrs(tag, attrs) {
  if (!isPlainObject(attrs)) throw invalidStructure();
  const allowed = tag === "a"
    ? new Set(["href", "title"])
    : tag === "img"
      ? new Set(["src", "alt", "title"])
      : tag === "ol"
        ? new Set(["start"])
        : tag === "pre" || tag === "code"
          ? new Set(["language"])
          : new Set();
  if (Object.keys(attrs).some(key => !allowed.has(key))) throw invalidStructure();

  const canonical = {};
  if (tag === "a") {
    canonical.href = safeString(attrs.href, { allowEmpty: false }).trim();
    if (!canonical.href || /[\u0000-\u001f\u007f]/.test(canonical.href)) throw invalidStructure();
    if (Object.hasOwn(attrs, "title")) canonical.title = safeString(attrs.title);
  } else if (tag === "img") {
    canonical.src = safeString(attrs.src, { allowEmpty: false }).trim();
    canonical.alt = safeString(attrs.alt ?? "");
    if (!canonical.src || /[\u0000-\u001f\u007f]/.test(canonical.src)) throw invalidStructure();
    if (Object.hasOwn(attrs, "title")) canonical.title = safeString(attrs.title);
  } else if (tag === "ol") {
    const start = attrs.start ?? "1";
    if (!/^\d+$/.test(String(start)) || Number(start) < 1) throw invalidStructure();
    canonical.start = String(start);
  } else if (tag === "pre" || tag === "code") {
    canonical.language = safeString(attrs.language ?? "").trim();
  }
  return canonical;
}

function trimBoundaryText(children) {
  if (children[0]?.type === "text") children[0] = { ...children[0], value: children[0].value.trimStart() };
  if (children.at(-1)?.type === "text") {
    children[children.length - 1] = { ...children.at(-1), value: children.at(-1).value.trimEnd() };
  }
  return children.filter(child => child.type !== "text" || child.value !== "");
}

function canonicalChildren(children, context) {
  if (!Array.isArray(children)) throw invalidStructure();
  const result = [];
  for (const child of children) {
    const canonical = canonicalNode(child, context);
    if (!canonical) continue;
    const previous = result.at(-1);
    if (canonical.type === "text" && previous?.type === "text") {
      previous.value += canonical.value;
    } else {
      result.push(canonical);
    }
  }
  return context.trimBoundaries ? trimBoundaryText(result) : result;
}

function canonicalNode(node, context) {
  context.nodes.count += 1;
  if (context.nodes.count > MAX_NODES || context.depth > MAX_DEPTH) throw invalidStructure();
  if (!isPlainObject(node)) throw invalidStructure();
  if (node.type === "text") {
    if (!hasExactKeys(node, new Set(["type", "value"]))) throw invalidStructure();
    const value = normalizeText(node.value, context.preserveWhitespace);
    return value === "" ? null : { type: "text", value };
  }
  if (!hasExactKeys(node, new Set(["type", "tag", "attrs", "children"]))) {
    throw invalidStructure();
  }
  if (node.type !== "element" || !ALLOWED_TAGS.has(node.tag)) throw invalidStructure();
  const attrs = canonicalAttrs(node.tag, node.attrs);
  if (VOID_TAGS.has(node.tag) && (!Array.isArray(node.children) || node.children.length !== 0)) {
    throw invalidStructure();
  }
  const trimBoundaries = new Set([
    "p", "h2", "h3", "h4", "h5", "h6", "li", "blockquote",
    "strong", "em", "s", "u", "mark", "a", "figcaption"
  ]).has(node.tag);
  const children = canonicalChildren(node.children, {
    depth: context.depth + 1,
    nodes: context.nodes,
    preserveWhitespace: context.preserveWhitespace || node.tag === "pre" || node.tag === "code",
    trimBoundaries
  });
  return { type: "element", tag: node.tag, attrs, children };
}

export function assertCanonicalStructure(value) {
  if (!Array.isArray(value)) throw invalidStructure();
  return canonicalChildren(value, {
    depth: 0,
    nodes: { count: 0 },
    preserveWhitespace: false,
    trimBoundaries: false
  }).filter(node => node.type !== "text" || node.value.trim() !== "");
}

function element(tag, attrs = {}) {
  return { type: "element", tag, attrs, children: [] };
}

function appendInline(tokens, destination) {
  const stack = [{ tag: null, children: destination }];
  const opens = {
    strong_open: "strong",
    em_open: "em",
    s_open: "s",
    link_open: "a"
  };
  const closes = {
    strong_close: "strong",
    em_close: "em",
    s_close: "s",
    link_close: "a"
  };
  for (const token of tokens ?? []) {
    const current = stack.at(-1).children;
    if (token.type === "text" || token.type === "code_inline") {
      current.push({ type: "text", value: token.content });
    } else if (token.type === "softbreak") {
      current.push({ type: "text", value: " " });
    } else if (token.type === "hardbreak") {
      current.push(element("br"));
    } else if (token.type === "image") {
      const attrs = { src: token.attrGet("src") ?? "", alt: token.content ?? "" };
      const title = token.attrGet("title");
      if (title != null) attrs.title = title;
      current.push(element("img", attrs));
    } else if (opens[token.type]) {
      const attrs = {};
      if (token.type === "link_open") {
        attrs.href = token.attrGet("href") ?? "";
        const title = token.attrGet("title");
        if (title != null) attrs.title = title;
      }
      const node = element(opens[token.type], attrs);
      current.push(node);
      stack.push({ tag: opens[token.type], children: node.children });
    } else if (closes[token.type]) {
      if (stack.length < 2 || stack.at(-1).tag !== closes[token.type]) throw invalidStructure();
      stack.pop();
    } else {
      throw invalidStructure();
    }
  }
  if (stack.length !== 1) throw invalidStructure();
}

export function structureFromMarkdownTokens(tokens) {
  if (!Array.isArray(tokens)) throw invalidStructure();
  const root = [];
  const stack = [{ tag: null, children: root }];
  const openTags = {
    paragraph_open: "p",
    heading_open: null,
    bullet_list_open: "ul",
    ordered_list_open: "ol",
    list_item_open: "li",
    blockquote_open: "blockquote"
  };
  const closeTags = {
    paragraph_close: "p",
    heading_close: null,
    bullet_list_close: "ul",
    ordered_list_close: "ol",
    list_item_close: "li",
    blockquote_close: "blockquote"
  };

  for (const token of tokens) {
    const current = stack.at(-1).children;
    if (Object.hasOwn(openTags, token.type)) {
      const tag = token.type === "heading_open" ? token.tag : openTags[token.type];
      const attrs = tag === "ol" ? { start: token.attrGet("start") ?? "1" } : {};
      const node = element(tag, attrs);
      current.push(node);
      stack.push({ tag, children: node.children });
    } else if (Object.hasOwn(closeTags, token.type)) {
      const tag = token.type === "heading_close" ? token.tag : closeTags[token.type];
      if (stack.length < 2 || stack.at(-1).tag !== tag) throw invalidStructure();
      stack.pop();
    } else if (token.type === "inline") {
      appendInline(token.children, current);
    } else if (token.type === "hr") {
      current.push(element("hr"));
    } else if (token.type === "fence" || token.type === "code_block") {
      const language = token.type === "fence" ? String(token.info ?? "").trim().split(/\s+/, 1)[0] : "";
      const node = element("pre", { language });
      node.children.push({ type: "text", value: token.content });
      current.push(node);
    } else {
      throw invalidStructure();
    }
  }
  if (stack.length !== 1) throw invalidStructure();
  return assertCanonicalStructure(root);
}

export function structureSha256(structure) {
  const canonical = assertCanonicalStructure(structure);
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

export function renderedContentSha256({ title, structure }) {
  if (typeof title !== "string") throw invalidStructure();
  const payload = {
    title: title.replace(/\s+/g, " ").trim(),
    structure: assertCanonicalStructure(structure)
  };
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}
