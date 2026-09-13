import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { renderedContentSha256 } from "../../src/structure.mjs";

async function loadSut() {
  try {
    return await import(pathToFileURL(path.resolve("src/browser/read-plan.mjs")));
  } catch {
    return {};
  }
}

const structure = [{
  type: "element",
  tag: "p",
  attrs: {},
  children: [{ type: "text", value: "概要 本文です。" }]
}];

function fixture() {
  return {
    run: {
      runId: "20260913-200000-aqsh-read-test",
      directory: "/private/tmp/aqsh-note-read-test",
      action: "inspect"
    },
    config: { account: { id: "aqsh" }, security: { allowPublish: false } },
    target: {
      key: "n9b5c6afb2521",
      publicUrl: "https://note.com/aqsh/n/n9b5c6afb2521",
      editorUrl: "https://editor.note.com/notes/n9b5c6afb2521/edit/"
    },
    article: {
      id: "aqsh-read-test",
      title: "読取テスト",
      sourcePath: "/repo/articles/aqsh-read-test/article.md",
      sourceSha256: "a".repeat(64),
      renderedContentSha256: renderedContentSha256({ title: "読取テスト", structure }),
      text: "概要 本文です。",
      structure,
      headings: { h2: ["概要"], h3: [] },
      stats: { bodyCharacters: 8, h2: 1, h3: 0, images: 0, links: 0, externalLinks: 0 }
    }
  };
}

test("creates a short-lived inspect plan without article content", async () => {
  const { createReadBridgePlan, assertReadBridgePlan } = await loadSut();
  assert.equal(typeof createReadBridgePlan, "function", "createReadBridgePlan must exist");
  assert.equal(typeof assertReadBridgePlan, "function", "assertReadBridgePlan must exist");
  const base = fixture();
  const now = new Date("2026-09-13T11:00:00.000Z");

  const plan = createReadBridgePlan({
    run: base.run,
    config: base.config,
    target: base.target,
    mode: "inspect",
    now
  });

  assert.equal(plan.type, "aqsh-note-existing-chrome-read");
  assert.equal(plan.version, 2);
  assert.equal(plan.mode, "inspect");
  assert.equal(plan.source, null);
  assert.equal(plan.expected, null);
  assert.equal(plan.target.key, "n9b5c6afb2521");
  assert.equal(plan.actions.at(-1).kind, "inspect");
  assert.equal(plan.browserStateChanged, false);
  assert.equal(plan.expiresAt, "2026-09-13T11:10:00.000Z");
  assert.deepEqual(assertReadBridgePlan(plan, { now }), plan);
});

test("creates a verify plan bound to the current article source", async () => {
  const { createReadBridgePlan } = await loadSut();
  const base = fixture();

  const plan = createReadBridgePlan({
    ...base,
    run: { ...base.run, action: "verify" },
    mode: "verify",
    now: new Date("2026-09-13T11:00:00.000Z")
  });

  assert.equal(plan.mode, "verify");
  assert.deepEqual(plan.source, {
    path: "/repo/articles/aqsh-read-test/article.md",
    sha256: "a".repeat(64),
    renderedContentSha256: renderedContentSha256({ title: "読取テスト", structure })
  });
  assert.equal(plan.expected.title, "読取テスト");
  assert.deepEqual(plan.expected.structure, structure);
  assert.equal(plan.actions.at(-1).kind, "verify");
  assert.match(plan.sha256, /^[a-f0-9]{64}$/);
});

test("rejects a verify plan whose rendered-content digest does not match its expectation", async () => {
  const { createReadBridgePlan } = await loadSut();
  const base = fixture();

  assert.throws(
    () => createReadBridgePlan({
      ...base,
      article: { ...base.article, renderedContentSha256: "b".repeat(64) },
      run: { ...base.run, action: "verify" },
      mode: "verify",
      now: new Date("2026-09-13T11:00:00.000Z")
    }),
    error => error?.code === "BROWSER_PLAN_INVALID"
  );
});

test("rejects expired, tampered, retargeted, and cross-mode read plans", async () => {
  const { createReadBridgePlan, assertReadBridgePlan } = await loadSut();
  const base = fixture();
  const plan = createReadBridgePlan({
    ...base,
    run: { ...base.run, action: "verify" },
    mode: "verify",
    now: new Date("2026-09-13T11:00:00.000Z")
  });

  assert.throws(
    () => assertReadBridgePlan(plan, { now: new Date("2026-09-13T11:10:00.001Z") }),
    error => error?.code === "BROWSER_PLAN_EXPIRED"
  );
  assert.throws(
    () => assertReadBridgePlan({ ...plan, accountId: "other" }),
    error => error?.code === "BROWSER_PLAN_INVALID"
  );
  assert.throws(
    () => assertReadBridgePlan({ ...plan, unexpected: true }),
    error => error?.code === "BROWSER_PLAN_INVALID"
  );
  assert.throws(
    () => assertReadBridgePlan(plan, { expectedMode: "inspect", now: null }),
    error => error?.code === "BROWSER_PLAN_INVALID"
  );
  assert.throws(
    () => assertReadBridgePlan({
      ...plan,
      target: { ...plan.target, key: "n111111111111" }
    }, { now: null }),
    error => error?.code === "BROWSER_PLAN_INVALID"
  );
});

test("writes read plans only to a private run artifact", async () => {
  const { createReadBridgePlan, writeReadBridgePlan } = await loadSut();
  assert.equal(typeof writeReadBridgePlan, "function", "writeReadBridgePlan must exist");
  const directory = await mkdtemp(path.join(os.tmpdir(), "aqsh-note-read-plan-"));
  const base = fixture();
  const run = { ...base.run, directory };
  const plan = createReadBridgePlan({
    run,
    config: base.config,
    target: base.target,
    mode: "inspect",
    now: new Date("2026-09-13T11:00:00.000Z")
  });

  const destination = await writeReadBridgePlan(run, plan);

  assert.equal(destination, path.join(directory, "browser-plan.json"));
  assert.deepEqual(JSON.parse(await readFile(destination, "utf8")), plan);
  assert.equal((await stat(destination)).mode & 0o777, 0o600);
});
