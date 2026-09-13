import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadSut() {
  try {
    return await import(pathToFileURL(path.resolve("src/browser/read-result.mjs")));
  } catch {
    return {};
  }
}

const structure = [
  {
    type: "element",
    tag: "h2",
    attrs: {},
    children: [{ type: "text", value: "概要" }]
  },
  {
    type: "element",
    tag: "p",
    attrs: {},
    children: [{ type: "text", value: "本文です。" }]
  }
];

function plan(mode = "inspect") {
  return {
    version: 2,
    type: "aqsh-note-existing-chrome-read",
    mode,
    runId: `20260913-200000-aqsh-${mode}-test`,
    createdAt: "2026-09-13T11:00:00.000Z",
    expiresAt: "2026-09-13T11:10:00.000Z",
    accountId: "aqsh",
    target: {
      key: "n9b5c6afb2521",
      publicUrl: "https://note.com/aqsh/n/n9b5c6afb2521",
      editorUrl: "https://editor.note.com/notes/n9b5c6afb2521/edit/"
    },
    source: mode === "verify"
      ? {
          path: "/repo/articles/test/article.md",
          sha256: "a".repeat(64),
          renderedContentSha256: "c".repeat(64)
        }
      : null,
    expected: mode === "verify"
      ? {
          title: "読取テスト",
          text: "概要 本文です。",
          structure,
          headings: { h2: ["概要"], h3: [] },
          stats: { bodyCharacters: 8, h2: 1, h3: 0, images: 0, links: 0, externalLinks: 0 }
        }
      : null,
    actions: [],
    browserStateChanged: false,
    sha256: "b".repeat(64)
  };
}

function observation(overrides = {}) {
  return {
    accountId: "aqsh",
    url: "https://editor.note.com/notes/n9b5c6afb2521/edit/",
    title: "読取テスト",
    text: "概要\n\n本文です。",
    structure,
    h2: ["概要"],
    h3: [],
    imageCount: 0,
    saveControlName: "下書き保存",
    publishControlName: "公開に進む",
    mutated: false,
    ...overrides
  };
}

test("creates a private inspect snapshot without reflecting body text in the result", async () => {
  const { createReadResult } = await loadSut();
  assert.equal(typeof createReadResult, "function", "createReadResult must exist");

  const output = createReadResult(plan("inspect"), observation(), {
    validatePlan: value => value,
    observedAt: new Date("2026-09-13T11:03:00.000Z")
  });

  assert.equal(output.result.status, "success");
  assert.equal(output.result.action, "inspect");
  assert.equal(output.result.note.key, "n9b5c6afb2521");
  assert.equal(output.result.browser_state_changed, false);
  assert.equal(output.result.published, false);
  assert.match(output.result.snapshot.sha256, /^[a-f0-9]{64}$/);
  assert.match(output.result.actual.structure_sha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(output.result), /本文です/);
  assert.equal(output.snapshot.text, "概要\n\n本文です。");
  assert.equal(output.snapshot.sha256, output.result.snapshot.sha256);
});

test("verify compares the live snapshot to the plan expectation", async () => {
  const { createReadResult } = await loadSut();

  const matching = createReadResult(plan("verify"), observation(), { validatePlan: value => value });
  const mismatch = createReadResult(plan("verify"), observation({ text: "異なる本文です。" }), {
    validatePlan: value => value
  });

  assert.equal(matching.result.status, "success");
  assert.equal(matching.result.action, "verify");
  assert.equal(matching.result.verification.ok, true);
  assert.equal(mismatch.result.status, "failed");
  assert.ok(mismatch.result.verification.reasons.includes("body_text_mismatch"));
  assert.equal(mismatch.result.browser_state_changed, false);
});

test("rejects wrong accounts, keys, controls, mutation claims, and extra fields", async () => {
  const { createReadResult } = await loadSut();

  for (const invalid of [
    observation({ accountId: "other" }),
    observation({ url: "https://editor.note.com/notes/n111111111111/edit/" }),
    observation({ saveControlName: "保存中" }),
    observation({ publishControlName: "公開する" }),
    observation({ mutated: true }),
    { ...observation(), unexpected: true }
  ]) {
    assert.throws(
      () => createReadResult(plan("inspect"), invalid, { validatePlan: value => value }),
      error => error?.code === "READ_OBSERVATION_INVALID"
    );
  }
});

test("writes the full read snapshot with private permissions", async () => {
  const { createReadResult, writeReadSnapshot } = await loadSut();
  assert.equal(typeof writeReadSnapshot, "function", "writeReadSnapshot must exist");
  const directory = await mkdtemp(path.join(os.tmpdir(), "aqsh-note-read-snapshot-"));
  const run = { runId: "20260913-200000-aqsh-inspect-test", directory, action: "inspect" };
  const output = createReadResult(plan("inspect"), observation(), { validatePlan: value => value });

  const destination = await writeReadSnapshot(run, output.snapshot);

  assert.equal(destination, path.join(directory, "snapshot.json"));
  assert.deepEqual(JSON.parse(await readFile(destination, "utf8")), output.snapshot);
  assert.equal((await stat(destination)).mode & 0o777, 0o600);
});

test("the default result validator rejects an expired read plan", async () => {
  const { createReadResult } = await loadSut();
  const { createReadBridgePlan } = await import(
    pathToFileURL(path.resolve("src/browser/read-plan.mjs"))
  );
  const expiredPlan = createReadBridgePlan({
    run: {
      runId: "20200101-000000-aqsh-inspect-expired",
      directory: "/private/tmp/aqsh-note-expired",
      action: "inspect"
    },
    config: { account: { id: "aqsh" }, security: { allowPublish: false } },
    target: {
      key: "n9b5c6afb2521",
      publicUrl: "https://note.com/aqsh/n/n9b5c6afb2521",
      editorUrl: "https://editor.note.com/notes/n9b5c6afb2521/edit/"
    },
    mode: "inspect",
    now: new Date("2020-01-01T00:00:00.000Z")
  });

  assert.throws(
    () => createReadResult(expiredPlan, observation()),
    error => error?.code === "BROWSER_PLAN_EXPIRED"
  );
});

test("validates a read snapshot's digest, target, mode, and nested schema", async () => {
  const { assertReadSnapshot, createReadResult } = await loadSut();
  assert.equal(typeof assertReadSnapshot, "function", "assertReadSnapshot must exist");
  const output = createReadResult(plan("inspect"), observation(), { validatePlan: value => value });

  assert.deepEqual(assertReadSnapshot(output.snapshot, {
    expectedRunId: output.snapshot.runId,
    expectedMode: "inspect"
  }), output.snapshot);
  for (const invalid of [
    { ...output.snapshot, text: "tampered" },
    { ...output.snapshot, mode: "verify" },
    { ...output.snapshot, note: { ...output.snapshot.note, key: "n111111111111" } },
    { ...output.snapshot, structure: [{ type: "element", tag: "script", attrs: {}, children: [] }] },
    { ...output.snapshot, unexpected: true }
  ]) {
    assert.throws(
      () => assertReadSnapshot(invalid, { expectedRunId: output.snapshot.runId }),
      error => error?.code === "READ_SNAPSHOT_INVALID"
    );
  }
});
