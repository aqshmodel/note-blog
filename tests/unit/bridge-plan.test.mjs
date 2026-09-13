import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadSut() {
  try {
    return await import(pathToFileURL(path.resolve("src/browser/bridge-plan.mjs")));
  } catch {
    return {};
  }
}

function fixture() {
  return {
    run: {
      runId: "20260913-190000-aqsh-bridge-test",
      directory: "/private/tmp/aqsh-note-plan-test",
      action: "draft"
    },
    article: {
      id: "aqsh-bridge-test",
      title: "既存Chrome下書きテスト",
      sourcePath: "/repo/articles/aqsh-bridge-test/article.md",
      sourceSha256: "a".repeat(64),
      html: "<h2>概要</h2><p>本文です。</p>",
      text: "概要 本文です。",
      headings: { h2: ["概要"], h3: [] },
      images: [],
      stats: { bodyCharacters: 8, h2: 1, h3: 0, images: 0, links: 0, externalLinks: 0 },
      frontmatter: {}
    },
    config: {
      account: { id: "aqsh" },
      editor: {
        inlineImageStrategy: "unverified",
        newUrl: "https://note.com/notes/new"
      },
      security: { allowPublish: false }
    }
  };
}

test("creates a short-lived existing-Chrome draft plan with integrity metadata", async () => {
  const { createDraftBridgePlan, assertDraftBridgePlan } = await loadSut();
  assert.equal(typeof createDraftBridgePlan, "function", "createDraftBridgePlan must exist");
  assert.equal(typeof assertDraftBridgePlan, "function", "assertDraftBridgePlan must exist");
  const now = new Date("2026-09-13T10:00:00.000Z");

  const plan = createDraftBridgePlan({ ...fixture(), now });

  assert.equal(plan.version, 1);
  assert.equal(plan.type, "aqsh-note-existing-chrome-draft");
  assert.equal(plan.accountId, "aqsh");
  assert.equal(plan.createdAt, "2026-09-13T10:00:00.000Z");
  assert.equal(plan.expiresAt, "2026-09-13T10:10:00.000Z");
  assert.match(plan.sha256, /^[a-f0-9]{64}$/);
  assert.equal(plan.source.sha256, "a".repeat(64));
  assert.equal(plan.expected.title, "既存Chrome下書きテスト");
  assert.equal(plan.saved, false);
  assert.equal(plan.published, false);
  assert.equal(plan.actions[0].kind, "verify_account");
  assert.deepEqual(
    assertDraftBridgePlan(plan, { now: new Date("2026-09-13T10:05:00.000Z") }),
    plan
  );
});

test("rejects expired, tampered, retargeted, or extended browser plans", async () => {
  const { createDraftBridgePlan, assertDraftBridgePlan } = await loadSut();
  const plan = createDraftBridgePlan({
    ...fixture(),
    now: new Date("2026-09-13T10:00:00.000Z")
  });

  assert.throws(
    () => assertDraftBridgePlan(plan, { now: new Date("2026-09-13T10:10:00.001Z") }),
    error => error?.code === "BROWSER_PLAN_EXPIRED"
  );
  assert.throws(
    () => assertDraftBridgePlan({ ...plan, accountId: "other" }),
    error => error?.code === "BROWSER_PLAN_INVALID"
  );
  assert.throws(
    () => assertDraftBridgePlan({ ...plan, unexpected: true }),
    error => error?.code === "BROWSER_PLAN_INVALID"
  );
  assert.throws(
    () => assertDraftBridgePlan({
      ...plan,
      actions: plan.actions.map(action => action.kind === "save_draft"
        ? { kind: "save_draft", accessibleName: "公開する" }
        : action)
    }),
    error => error?.code === "BROWSER_PLAN_INVALID" || error?.code === "PUBLISH_CONTROL_FORBIDDEN"
  );
});

test("writes the unredacted plan only to a private run artifact", async () => {
  const { createDraftBridgePlan, writeDraftBridgePlan } = await loadSut();
  assert.equal(typeof writeDraftBridgePlan, "function", "writeDraftBridgePlan must exist");
  const directory = await mkdtemp(path.join(os.tmpdir(), "aqsh-note-bridge-plan-"));
  const base = fixture();
  const run = { ...base.run, directory };
  const plan = createDraftBridgePlan({
    ...base,
    run,
    now: new Date("2026-09-13T10:00:00.000Z")
  });

  const destination = await writeDraftBridgePlan(run, plan);

  assert.equal(destination, path.join(directory, "browser-plan.json"));
  assert.deepEqual(JSON.parse(await readFile(destination, "utf8")), plan);
  assert.equal((await stat(destination)).mode & 0o777, 0o600);
});
