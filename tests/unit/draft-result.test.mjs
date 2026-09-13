import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadSut() {
  try {
    return await import(pathToFileURL(path.resolve("src/browser/draft-result.mjs")));
  } catch {
    return {};
  }
}

function plan() {
  return {
    version: 1,
    type: "aqsh-note-existing-chrome-draft",
    runId: "20260913-190000-aqsh-result-test",
    createdAt: "2026-09-13T10:00:00.000Z",
    expiresAt: "2026-09-13T10:10:00.000Z",
    accountId: "aqsh",
    source: { path: "/repo/articles/test/article.md", sha256: "a".repeat(64) },
    expected: {
      title: "保存後検証",
      text: "概要 本文です。 詳細 確認します。",
      headings: { h2: ["概要"], h3: ["詳細"] },
      stats: { bodyCharacters: 20, h2: 1, h3: 1, images: 0, links: 0, externalLinks: 0 }
    },
    actions: [],
    saved: false,
    published: false,
    sha256: "b".repeat(64)
  };
}

function observation(overrides = {}) {
  return {
    url: "https://editor.note.com/notes/n9b5c6afb2521/edit/",
    title: "保存後検証",
    text: "概要 本文です。 詳細 確認します。",
    h2: ["概要"],
    h3: ["詳細"],
    imageCount: 0,
    saveControlName: "下書き保存",
    reloaded: true,
    published: false,
    ...overrides
  };
}

test("accepts only a reloaded matching draft and returns its editor key", async () => {
  const { verifyDraftObservation } = await loadSut();
  assert.equal(typeof verifyDraftObservation, "function", "verifyDraftObservation must exist");

  const result = verifyDraftObservation(plan(), observation(), { validatePlan: value => value });

  assert.equal(result.status, "success");
  assert.equal(result.action, "draft");
  assert.equal(result.run_id, "20260913-190000-aqsh-result-test");
  assert.equal(result.account, "aqsh");
  assert.equal(result.note.key, "n9b5c6afb2521");
  assert.equal(result.note.editor_url, "https://editor.note.com/notes/n9b5c6afb2521/edit/");
  assert.equal(result.verification.ok, true);
  assert.equal(result.saved, true);
  assert.equal(result.published, false);
});

test("reports verification failure without hiding that a draft was saved", async () => {
  const { verifyDraftObservation } = await loadSut();

  const result = verifyDraftObservation(
    plan(),
    observation({ text: "異なる本文です。" }),
    { validatePlan: value => value }
  );

  assert.equal(result.status, "failed");
  assert.equal(result.saved, true);
  assert.equal(result.published, false);
  assert.ok(result.verification.reasons.includes("body_text_mismatch"));
});

test("rejects unpersisted, published, extended, and off-contract observations", async () => {
  const { verifyDraftObservation } = await loadSut();

  for (const invalid of [
    observation({ reloaded: false }),
    observation({ published: true }),
    observation({ saveControlName: "公開に進む" }),
    observation({ url: "https://note.com/aqsh/n/n9b5c6afb2521" }),
    { ...observation(), unexpected: true }
  ]) {
    assert.throws(
      () => verifyDraftObservation(plan(), invalid, { validatePlan: value => value }),
      error => error?.code === "DRAFT_OBSERVATION_INVALID"
    );
  }
});
