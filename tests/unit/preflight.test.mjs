import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadModule(relativePath) {
  try {
    return await import(pathToFileURL(path.resolve(relativePath)));
  } catch {
    return {};
  }
}

async function fixture(frontmatter = "") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aqsh-note-preflight-"));
  await mkdir(path.join(directory, "images"));
  await writeFile(path.join(directory, "images", "cover.png"), Buffer.from("89504e470d0a1a0a", "hex"));
  const articlePath = path.join(directory, "article.md");
  await writeFile(articlePath, `---\nid: aqsh-test\ntitle: Test\nstatus: draft\n${frontmatter}---\n# Test\n\n本文です。\n`, "utf8");
  return articlePath;
}

test("draft rejects an article already bound to a note URL", async () => {
  const { loadArticle } = await loadModule("src/article.mjs");
  const { preflightArticle } = await loadModule("src/preflight.mjs");
  assert.equal(typeof loadArticle, "function", "loadArticle must exist");
  assert.equal(typeof preflightArticle, "function", "preflightArticle must exist");
  const article = await loadArticle(await fixture("note:\n  url: https://note.com/aqsh/n/n9b5c6afb2521\n  key: n9b5c6afb2521\n"));

  const result = await preflightArticle(article, { mode: "draft", accountId: "aqsh" });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some(item => item.code === "DRAFT_ALREADY_BOUND"));
});

test("update requires a note key or managed article URL", async () => {
  const { loadArticle } = await loadModule("src/article.mjs");
  const { preflightArticle } = await loadModule("src/preflight.mjs");
  assert.equal(typeof loadArticle, "function", "loadArticle must exist");
  assert.equal(typeof preflightArticle, "function", "preflightArticle must exist");
  const article = await loadArticle(await fixture());

  const result = await preflightArticle(article, { mode: "update", accountId: "aqsh" });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some(item => item.code === "UPDATE_TARGET_REQUIRED"));
});

test("missing local images are critical and editorial omissions are warnings", async () => {
  const { loadArticle } = await loadModule("src/article.mjs");
  const { preflightArticle } = await loadModule("src/preflight.mjs");
  assert.equal(typeof loadArticle, "function", "loadArticle must exist");
  assert.equal(typeof preflightArticle, "function", "preflightArticle must exist");
  const articlePath = await fixture("assets:\n  eyecatch: ./images/missing.png\n");
  const article = await loadArticle(articlePath);

  const result = await preflightArticle(article, { mode: "dry-run", accountId: "aqsh" });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some(item => item.code === "EYECATCH_NOT_FOUND"));
  assert.ok(result.warnings.some(item => item.code === "SEO_KEYWORD_MISSING"));
  assert.ok(result.warnings.some(item => item.code === "CTA_MISSING"));
  assert.ok(result.warnings.some(item => item.code === "BODY_SHORT"));
});

test("dry-run succeeds for a minimal valid article while retaining warnings", async () => {
  const { loadArticle } = await loadModule("src/article.mjs");
  const { preflightArticle } = await loadModule("src/preflight.mjs");
  assert.equal(typeof loadArticle, "function", "loadArticle must exist");
  assert.equal(typeof preflightArticle, "function", "preflightArticle must exist");
  const article = await loadArticle(await fixture("seo:\n  primary_keyword: note 自動化\ncta:\n  enabled: false\n"));

  const result = await preflightArticle(article, { mode: "dry-run", accountId: "aqsh" });

  assert.equal(result.ok, true);
  assert.equal(result.intendedAction, "draft");
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some(item => item.code === "EYECATCH_MISSING"));
});

test("dry-run rejects an invalid note key even when note URL is absent", async () => {
  const { loadArticle } = await loadModule("src/article.mjs");
  const { preflightArticle } = await loadModule("src/preflight.mjs");
  assert.equal(typeof loadArticle, "function", "loadArticle must exist");
  assert.equal(typeof preflightArticle, "function", "preflightArticle must exist");
  const article = await loadArticle(await fixture("note:\n  key: ../../settings\n"));

  const result = await preflightArticle(article, { mode: "dry-run", accountId: "aqsh" });

  assert.equal(result.ok, false);
  assert.equal(result.intendedAction, null);
  assert.ok(result.errors.some(item => item.code === "NOTE_KEY_INVALID"));
});

test("dry-run identifies a valid managed note target as an update", async () => {
  const { loadArticle } = await loadModule("src/article.mjs");
  const { preflightArticle } = await loadModule("src/preflight.mjs");
  assert.equal(typeof loadArticle, "function", "loadArticle must exist");
  assert.equal(typeof preflightArticle, "function", "preflightArticle must exist");
  const article = await loadArticle(await fixture("note:\n  key: n9b5c6afb2521\n"));

  const result = await preflightArticle(article, { mode: "dry-run", accountId: "aqsh" });

  assert.equal(result.ok, true);
  assert.equal(result.intendedAction, "update");
});

test("malformed or misspelled note metadata never falls back to a new draft", async () => {
  const { loadArticle } = await loadModule("src/article.mjs");
  const { preflightArticle } = await loadModule("src/preflight.mjs");
  assert.equal(typeof loadArticle, "function", "loadArticle must exist");
  assert.equal(typeof preflightArticle, "function", "preflightArticle must exist");

  for (const [metadata, expectedCode] of [
    ["note: https://note.com/aqsh/n/n9b5c6afb2521\n", "NOTE_SCHEMA_INVALID"],
    ["note:\n  ur1: https://note.com/aqsh/n/n9b5c6afb2521\n", "NOTE_FIELD_UNSUPPORTED"],
    ["note:\n  key: 12345\n", "NOTE_FIELD_INVALID"],
    ["note_url: https://note.com/aqsh/n/n9b5c6afb2521\n", "ARTICLE_FIELD_UNSUPPORTED"]
  ]) {
    const article = await loadArticle(await fixture(metadata));
    const result = await preflightArticle(article, { mode: "dry-run", accountId: "aqsh" });
    assert.equal(result.ok, false);
    assert.equal(result.intendedAction, null);
    assert.ok(result.errors.some(item => item.code === expectedCode));
  }
});

test("requires a fixed article id and draft status", async () => {
  const { loadArticle } = await loadModule("src/article.mjs");
  const { preflightArticle } = await loadModule("src/preflight.mjs");
  assert.equal(typeof loadArticle, "function", "loadArticle must exist");
  assert.equal(typeof preflightArticle, "function", "preflightArticle must exist");
  const article = await loadArticle(await fixture());
  article.frontmatter.id = null;
  article.frontmatter.status = "published";

  const result = await preflightArticle(article, { mode: "dry-run", accountId: "aqsh" });

  assert.equal(result.ok, false);
  assert.equal(result.intendedAction, null);
  assert.ok(result.errors.some(item => item.code === "ARTICLE_ID_INVALID"));
  assert.ok(result.errors.some(item => item.code === "ARTICLE_STATUS_INVALID"));
});

test("rejects an image whose bytes do not match its allowed extension", async () => {
  const { loadArticle } = await loadModule("src/article.mjs");
  const { preflightArticle } = await loadModule("src/preflight.mjs");
  assert.equal(typeof loadArticle, "function", "loadArticle must exist");
  assert.equal(typeof preflightArticle, "function", "preflightArticle must exist");
  const articlePath = await fixture("seo:\n  primary_keyword: note 自動化\ncta:\n  enabled: false\n");
  const invalidImage = path.join(path.dirname(articlePath), "images", "invalid.png");
  await writeFile(invalidImage, "this is not a png", "utf8");
  await writeFile(articlePath, `---
id: aqsh-invalid-image
title: Broken
status: draft
---
# Broken

本文です。

![broken](./images/invalid.png)
`, "utf8");
  const article = await loadArticle(articlePath);

  const result = await preflightArticle(article, { mode: "dry-run", accountId: "aqsh" });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some(item => item.code === "IMAGE_FILE_INVALID"));
});

test("rejects article assets that escape the configured content root", async () => {
  const { loadArticle } = await loadModule("src/article.mjs");
  const { preflightArticle } = await loadModule("src/preflight.mjs");
  assert.equal(typeof loadArticle, "function", "loadArticle must exist");
  assert.equal(typeof preflightArticle, "function", "preflightArticle must exist");
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aqsh-note-root-"));
  const articleDirectory = path.join(projectRoot, "articles", "one");
  await mkdir(articleDirectory, { recursive: true });
  const outsideImage = path.join(projectRoot, "outside.png");
  await writeFile(outsideImage, Buffer.from("89504e470d0a1a0a", "hex"));
  const articlePath = path.join(articleDirectory, "article.md");
  await writeFile(articlePath, `---
id: aqsh-outside
title: Outside
status: draft
---
# Outside

本文です。

![outside](../../outside.png)
`, "utf8");
  const article = await loadArticle(articlePath);

  const result = await preflightArticle(article, {
    mode: "dry-run",
    accountId: "aqsh",
    contentRoot: path.join(projectRoot, "articles")
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some(item => item.code === "IMAGE_OUTSIDE_CONTENT_ROOT"));
});
