import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { renderedContentSha256 } from "../../src/structure.mjs";

async function loadSut() {
  try {
    return await import(pathToFileURL(path.resolve("src/browser/update-plan.mjs")));
  } catch {
    return {};
  }
}

const target = {
  key: "n9b5c6afb2521",
  publicUrl: "https://note.com/aqsh/n/n9b5c6afb2521",
  editorUrl: "https://editor.note.com/notes/n9b5c6afb2521/edit/"
};
const structure = [{
  type: "element",
  tag: "p",
  attrs: {},
  children: [{ type: "text", value: "更新後本文" }]
}];

function fixture() {
  return {
    run: {
      runId: "20260913-220000-aqsh-update-test",
      directory: "/private/tmp/aqsh-note-update-plan-test",
      action: "update"
    },
    article: {
      id: "aqsh-update-test",
      title: "更新後タイトル",
      sourcePath: "/repo/articles/aqsh-update-test/article.md",
      sourceSha256: "a".repeat(64),
      renderedContentSha256: renderedContentSha256({ title: "更新後タイトル", structure }),
      html: "<p>更新後本文</p>",
      text: "更新後本文",
      structure,
      headings: { h2: [], h3: [] },
      images: [],
      stats: { bodyCharacters: 5, h2: 0, h3: 0, images: 0, links: 0, externalLinks: 0 },
      frontmatter: {}
    },
    config: {
      account: { id: "aqsh" },
      editor: { inlineImageStrategy: "unverified" },
      security: { allowPublish: false }
    },
    authorization: {
      reportPath: "/private/state/runs/conflict/conflict-report.json",
      reportSha256: "c".repeat(64),
      assessedAt: "2026-09-13T13:00:00.000Z",
      target,
      current: {
        snapshotSha256: "d".repeat(64),
        title: "更新前タイトル",
        text: "更新前本文",
        structure: [{
          type: "element",
          tag: "p",
          attrs: {},
          children: [{ type: "text", value: "更新前本文" }]
        }],
        h2: [],
        h3: [],
        imageCount: 0
      }
    }
  };
}

test("creates a short-lived update plan bound to the conflict report and existing draft", async () => {
  const { createUpdateBridgePlan, assertUpdateBridgePlan } = await loadSut();
  assert.equal(typeof createUpdateBridgePlan, "function", "createUpdateBridgePlan must exist");
  assert.equal(typeof assertUpdateBridgePlan, "function", "assertUpdateBridgePlan must exist");
  const now = new Date("2026-09-13T13:01:00.000Z");

  const plan = createUpdateBridgePlan({ ...fixture(), now });

  assert.equal(plan.version, 1);
  assert.equal(plan.type, "aqsh-note-existing-chrome-update");
  assert.equal(plan.target.key, target.key);
  assert.equal(plan.approval.conflictReportSha256, "c".repeat(64));
  assert.equal(plan.before.snapshotSha256, "d".repeat(64));
  assert.equal(plan.expected.title, "更新後タイトル");
  assert.equal(plan.confirmationRequired, true);
  assert.deepEqual(plan.actions.map(action => action.kind), [
    "verify_account",
    "open_existing_editor",
    "verify_editor_contract",
    "verify_current",
    "fill_title",
    "replace_body_html",
    "save_draft",
    "verify"
  ]);
  assert.equal(plan.actions[3].snapshotSha256, plan.before.snapshotSha256);
  assert.equal(plan.saved, false);
  assert.equal(plan.published, false);
  assert.match(plan.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    assertUpdateBridgePlan(plan, { now: new Date("2026-09-13T13:05:00.000Z") }),
    plan
  );
});

test("rejects an expired, retargeted, or image-bearing update plan", async () => {
  const { createUpdateBridgePlan, assertUpdateBridgePlan } = await loadSut();
  const base = fixture();
  const plan = createUpdateBridgePlan({ ...base, now: new Date("2026-09-13T13:01:00.000Z") });

  assert.throws(
    () => assertUpdateBridgePlan(plan, { now: new Date("2026-09-13T13:11:00.001Z") }),
    error => error?.code === "BROWSER_PLAN_EXPIRED"
  );
  assert.throws(
    () => assertUpdateBridgePlan({ ...plan, target: { ...plan.target, key: "n111111111111" } }),
    error => error?.code === "BROWSER_PLAN_INVALID"
  );
  assert.throws(
    () => createUpdateBridgePlan({
      ...base,
      article: { ...base.article, images: [{ source: "./images/one.png" }] }
    }),
    error => error?.code === "INLINE_IMAGE_STRATEGY_UNVERIFIED"
  );
});

test("writes the update plan only as a private run artifact", async () => {
  const { createUpdateBridgePlan, writeUpdateBridgePlan } = await loadSut();
  assert.equal(typeof writeUpdateBridgePlan, "function", "writeUpdateBridgePlan must exist");
  const directory = await mkdtemp(path.join(os.tmpdir(), "aqsh-note-update-plan-"));
  const base = fixture();
  const run = { ...base.run, directory };
  const plan = createUpdateBridgePlan({
    ...base,
    run,
    now: new Date("2026-09-13T13:01:00.000Z")
  });

  const destination = await writeUpdateBridgePlan(run, plan);

  assert.equal(destination, path.join(directory, "browser-plan.json"));
  assert.deepEqual(JSON.parse(await readFile(destination, "utf8")), plan);
  assert.equal((await stat(destination)).mode & 0o777, 0o600);
});
