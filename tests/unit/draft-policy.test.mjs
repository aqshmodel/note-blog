import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadSut() {
  try {
    return await import(pathToFileURL(path.resolve("src/browser/draft-policy.mjs")));
  } catch {
    return {};
  }
}

function article(overrides = {}) {
  return {
    title: "Aqshテスト記事",
    html: "<h2>概要</h2><p>本文です。</p>",
    text: "概要 本文です。",
    images: [],
    frontmatter: {},
    ...overrides
  };
}

const config = {
  editor: { inlineImageStrategy: "unverified", newUrl: "https://note.com/notes/new" },
  security: { allowPublish: false }
};

test("builds a text-only plan ending in draft save and verification", async () => {
  const { buildDraftPlan } = await loadSut();
  const { assertSafeUiAction } = await import(pathToFileURL(path.resolve("src/browser/safety.mjs")));
  assert.equal(typeof buildDraftPlan, "function", "buildDraftPlan must exist");

  const plan = buildDraftPlan(article(), config);

  assert.deepEqual(plan.actions.map(action => action.kind), [
    "open_new_editor",
    "fill_title",
    "insert_body_html",
    "save_draft",
    "verify"
  ]);
  assert.equal(plan.published, false);
  assert.equal(plan.actions[0].url, "https://note.com/notes/new");
  assert.ok(plan.actions.every(action => !/公開|投稿|publish|post/i.test(action.accessibleName ?? "")));
  assert.doesNotThrow(() => plan.actions.forEach(action => assertSafeUiAction(action)));
});

test("blocks inline images until an E2E-proven placement strategy is selected", async () => {
  const { buildDraftPlan } = await loadSut();
  assert.equal(typeof buildDraftPlan, "function", "buildDraftPlan must exist");

  assert.throws(
    () => buildDraftPlan(article({ images: [{ source: "./images/one.png" }] }), config),
    error => error?.code === "INLINE_IMAGE_STRATEGY_UNVERIFIED"
  );
});

test("fails closed when the inline image strategy is misspelled", async () => {
  const { buildDraftPlan } = await loadSut();
  assert.equal(typeof buildDraftPlan, "function", "buildDraftPlan must exist");

  assert.throws(
    () => buildDraftPlan(
      article({ images: [{ source: "./images/one.png" }] }),
      { ...config, editor: { inlineImageStrategy: "unverifed" } }
    ),
    error => error?.code === "INLINE_IMAGE_STRATEGY_INVALID"
  );
});

test("blocks eyecatch automation until its UI contract is verified", async () => {
  const { buildDraftPlan } = await loadSut();
  assert.equal(typeof buildDraftPlan, "function", "buildDraftPlan must exist");

  assert.throws(
    () => buildDraftPlan(article({ frontmatter: { assets: { eyecatch: "./cover.png" } } }), config),
    error => error?.code === "EYECATCH_UI_UNVERIFIED"
  );
});

test("refuses to build any browser plan when publishing is enabled", async () => {
  const { buildDraftPlan } = await loadSut();
  assert.equal(typeof buildDraftPlan, "function", "buildDraftPlan must exist");

  assert.throws(
    () => buildDraftPlan(article(), { ...config, security: { allowPublish: true } }),
    error => error?.code === "PUBLISH_FORBIDDEN"
  );
});
