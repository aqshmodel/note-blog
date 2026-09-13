import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import MarkdownIt from "markdown-it";

async function loadSut() {
  try {
    return await import(pathToFileURL(path.resolve("src/structure.mjs")));
  } catch {
    return {};
  }
}

const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });

test("canonicalizes Markdown blocks, inline formatting, links, and tight lists", async () => {
  const { structureFromMarkdownTokens } = await loadSut();
  assert.equal(typeof structureFromMarkdownTokens, "function", "structureFromMarkdownTokens must exist");
  const tokens = markdown.parse(
    "段落 **強調** [リンク](https://example.com/a)\n\n- 項目1\n- 項目2",
    {}
  );

  assert.deepEqual(structureFromMarkdownTokens(tokens), [
    {
      type: "element",
      tag: "p",
      attrs: {},
      children: [
        { type: "text", value: "段落 " },
        {
          type: "element",
          tag: "strong",
          attrs: {},
          children: [{ type: "text", value: "強調" }]
        },
        { type: "text", value: " " },
        {
          type: "element",
          tag: "a",
          attrs: { href: "https://example.com/a" },
          children: [{ type: "text", value: "リンク" }]
        }
      ]
    },
    {
      type: "element",
      tag: "ul",
      attrs: {},
      children: [
        {
          type: "element",
          tag: "li",
          attrs: {},
          children: [{
            type: "element",
            tag: "p",
            attrs: {},
            children: [{ type: "text", value: "項目1" }]
          }]
        },
        {
          type: "element",
          tag: "li",
          attrs: {},
          children: [{
            type: "element",
            tag: "p",
            attrs: {},
            children: [{ type: "text", value: "項目2" }]
          }]
        }
      ]
    }
  ]);
});

test("gives different structural hashes to identical anchor text with different hrefs", async () => {
  const { structureSha256 } = await loadSut();
  assert.equal(typeof structureSha256, "function", "structureSha256 must exist");
  const make = href => [{
    type: "element",
    tag: "p",
    attrs: {},
    children: [{
      type: "element",
      tag: "a",
      attrs: { href },
      children: [{ type: "text", value: "同じ文字" }]
    }]
  }];

  assert.notEqual(structureSha256(make("https://example.com/a")), structureSha256(make("https://example.com/b")));
});

test("detects image source and alt-text changes structurally", async () => {
  const { structureSha256 } = await loadSut();
  const make = (src, alt) => [{
    type: "element",
    tag: "p",
    attrs: {},
    children: [{ type: "element", tag: "img", attrs: { src, alt }, children: [] }]
  }];
  const baseline = structureSha256(make("./images/a.png", "図A"));

  assert.notEqual(baseline, structureSha256(make("./images/b.png", "図A")));
  assert.notEqual(baseline, structureSha256(make("./images/a.png", "別の説明")));
});

test("rejects unsupported elements and attributes instead of dropping them", async () => {
  const { assertCanonicalStructure } = await loadSut();
  assert.equal(typeof assertCanonicalStructure, "function", "assertCanonicalStructure must exist");

  assert.throws(
    () => assertCanonicalStructure([{ type: "element", tag: "script", attrs: {}, children: [] }]),
    error => error?.code === "ARTICLE_STRUCTURE_INVALID"
  );
  assert.throws(
    () => assertCanonicalStructure([{
      type: "element",
      tag: "a",
      attrs: { href: "https://example.com", onclick: "x" },
      children: [{ type: "text", value: "リンク" }]
    }]),
    error => error?.code === "ARTICLE_STRUCTURE_INVALID"
  );
});

test("rejects mismatched inline closing tokens", async () => {
  const { structureFromMarkdownTokens } = await loadSut();

  assert.throws(
    () => structureFromMarkdownTokens([
      { type: "paragraph_open" },
      {
        type: "inline",
        children: [
          { type: "strong_open" },
          { type: "text", content: "強調" },
          { type: "em_close" }
        ]
      },
      { type: "paragraph_close" }
    ]),
    error => error?.code === "ARTICLE_STRUCTURE_INVALID"
  );
});
