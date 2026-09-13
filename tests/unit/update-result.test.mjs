import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadSut() {
  try {
    return await import(pathToFileURL(path.resolve("src/browser/update-result.mjs")));
  } catch {
    return {};
  }
}

const structure = [{
  type: "element",
  tag: "p",
  attrs: {},
  children: [{ type: "text", value: "更新後本文" }]
}];

function plan() {
  return {
    runId: "20260913-220000-aqsh-update-test",
    accountId: "aqsh",
    target: {
      key: "n9b5c6afb2521",
      publicUrl: "https://note.com/aqsh/n/n9b5c6afb2521",
      editorUrl: "https://editor.note.com/notes/n9b5c6afb2521/edit/"
    },
    source: { sha256: "a".repeat(64), renderedContentSha256: "b".repeat(64) },
    approval: { conflictReportSha256: "c".repeat(64) },
    expected: {
      title: "更新後タイトル",
      text: "更新後本文",
      structure,
      headings: { h2: [], h3: [] },
      stats: { images: 0 }
    }
  };
}

function observation(overrides = {}) {
  return {
    accountId: "aqsh",
    url: "https://editor.note.com/notes/n9b5c6afb2521/edit/",
    title: "更新後タイトル",
    text: "更新後本文",
    structure,
    h2: [],
    h3: [],
    imageCount: 0,
    saveControlName: "下書き保存",
    publishControlName: "公開に進む",
    reloaded: true,
    published: false,
    ...overrides
  };
}

test("accepts a reloaded matching existing draft and keeps it unpublished", async () => {
  const { verifyUpdateObservation } = await loadSut();
  assert.equal(typeof verifyUpdateObservation, "function", "verifyUpdateObservation must exist");

  const result = verifyUpdateObservation(plan(), observation(), { validatePlan: value => value });

  assert.equal(result.status, "success");
  assert.equal(result.action, "update");
  assert.equal(result.note.key, "n9b5c6afb2521");
  assert.equal(result.verification.ok, true);
  assert.equal(result.browser_state_changed, true);
  assert.equal(result.saved, true);
  assert.equal(result.published, false);
});

test("rejects a different target or missing reload proof", async () => {
  const { verifyUpdateObservation } = await loadSut();

  for (const value of [
    observation({ url: "https://editor.note.com/notes/n111111111111/edit/" }),
    observation({ reloaded: false })
  ]) {
    assert.throws(
      () => verifyUpdateObservation(plan(), value, { validatePlan: input => input }),
      error => error?.code === "UPDATE_OBSERVATION_INVALID"
    );
  }
});
