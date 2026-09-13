import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadSut() {
  try {
    return await import(pathToFileURL(path.resolve("src/article.mjs")));
  } catch {
    return {};
  }
}

async function makeArticle(source) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aqsh-note-article-"));
  const articlePath = path.join(directory, "article.md");
  await mkdir(path.join(directory, "images"));
  await writeFile(path.join(directory, "images", "flow.png"), Buffer.from("89504e470d0a1a0a", "hex"));
  await writeFile(articlePath, source, "utf8");
  return articlePath;
}

test("loads frontmatter, removes the title H1, and reports article structure", async () => {
  const { loadArticle } = await loadSut();
  assert.equal(typeof loadArticle, "function", "loadArticle must exist");

  const articlePath = await makeArticle(`---
id: aqsh-2026-001
title: "Aqsh note運用"
status: draft
note:
  url: null
  key: null
assets:
  eyecatch: null
---
# Aqsh note運用

導入文です。

## 全体像

- 項目A
- 項目B

![運用フロー](./images/flow.png)

### 詳細

[Aqsh](https://aqsh.co.jp/)を確認します。
`);

  const article = await loadArticle(articlePath);

  assert.equal(article.id, "aqsh-2026-001");
  assert.equal(article.title, "Aqsh note運用");
  assert.doesNotMatch(article.bodyMarkdown, /^# Aqsh note運用/m);
  assert.match(article.html, /<h2>全体像<\/h2>/);
  assert.deepEqual(article.stats, {
    bodyCharacters: 33,
    h2: 1,
    h3: 1,
    images: 1,
    links: 1,
    externalLinks: 1
  });
  assert.equal(article.images[0].alt, "運用フロー");
  assert.equal(article.images[0].source, "./images/flow.png");
  assert.equal(article.images[0].exists, true);
  assert.match(article.sourceSha256, /^[a-f0-9]{64}$/);
  assert.match(article.renderedContentSha256, /^[a-f0-9]{64}$/);
  assert.equal(article.structure[0].tag, "p");
  assert.equal(article.structure[1].tag, "h2");
  assert.equal(article.structure[2].tag, "ul");
  assert.deepEqual(article.structure.at(-1), {
    type: "element",
    tag: "p",
    attrs: {},
    children: [
      {
        type: "element",
        tag: "a",
        attrs: { href: "https://aqsh.co.jp/" },
        children: [{ type: "text", value: "Aqsh" }]
      },
      { type: "text", value: "を確認します。" }
    ]
  });
});

test("uses the first H1 when frontmatter title is absent", async () => {
  const { loadArticle } = await loadSut();
  assert.equal(typeof loadArticle, "function", "loadArticle must exist");
  const articlePath = await makeArticle(`# H1タイトル\n\n本文です。\n`);

  const article = await loadArticle(articlePath);

  assert.equal(article.title, "H1タイトル");
  assert.equal(article.frontmatter.title, undefined);
});

test("rejects a frontmatter title that differs from the first H1", async () => {
  const { loadArticle } = await loadSut();
  assert.equal(typeof loadArticle, "function", "loadArticle must exist");
  const articlePath = await makeArticle(`---\ntitle: Frontmatter\n---\n# H1\n\n本文\n`);

  await assert.rejects(() => loadArticle(articlePath), error => error?.code === "TITLE_MISMATCH");
});

test("rejects an article without a title", async () => {
  const { loadArticle } = await loadSut();
  assert.equal(typeof loadArticle, "function", "loadArticle must exist");
  const articlePath = await makeArticle(`本文だけです。\n`);

  await assert.rejects(() => loadArticle(articlePath), error => error?.code === "TITLE_REQUIRED");
});

test("rejects an empty body", async () => {
  const { loadArticle } = await loadSut();
  assert.equal(typeof loadArticle, "function", "loadArticle must exist");
  const articlePath = await makeArticle(`# タイトルだけ\n`);

  await assert.rejects(() => loadArticle(articlePath), error => error?.code === "BODY_REQUIRED");
});

test("rejects language-tagged frontmatter without executing JavaScript", async () => {
  const { loadArticle } = await loadSut();
  assert.equal(typeof loadArticle, "function", "loadArticle must exist");
  globalThis.__AQSH_FRONTMATTER_EXECUTED__ = false;
  const articlePath = await makeArticle(`---js
(()=>{globalThis.__AQSH_FRONTMATTER_EXECUTED__=true; return {title:"unsafe"};})()
---
# Safe title

本文です。
`);

  await assert.rejects(
    () => loadArticle(articlePath),
    error => error?.code === "FRONTMATTER_LANGUAGE_UNSUPPORTED"
  );
  assert.equal(globalThis.__AQSH_FRONTMATTER_EXECUTED__, false);
  delete globalThis.__AQSH_FRONTMATTER_EXECUTED__;
});
