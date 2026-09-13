import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { renderedContentSha256 } from "../../src/structure.mjs";

async function loadSut() {
  try {
    return await import(pathToFileURL(path.resolve("src/conflict.mjs")));
  } catch {
    return {};
  }
}

const target = {
  key: "n9b5c6afb2521",
  publicUrl: "https://note.com/aqsh/n/n9b5c6afb2521",
  editorUrl: "https://editor.note.com/notes/n9b5c6afb2521/edit/"
};
const config = { account: { id: "aqsh" }, security: { allowPublish: false } };

function bodyStructure(body = "本文です。") {
  return [
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
      children: [{ type: "text", value: body }]
    }
  ];
}

function article(overrides = {}) {
  const value = {
    id: "aqsh-conflict-test",
    title: "同期テスト",
    text: "概要 本文です。",
    structure: bodyStructure(),
    headings: { h2: ["概要"], h3: [] },
    stats: { bodyCharacters: 8, h2: 1, h3: 0, images: 0, links: 0, externalLinks: 0 },
    sourcePath: "/repo/articles/aqsh-conflict-test/article.md",
    sourceSha256: "a".repeat(64),
    frontmatter: {
      note: {
        key: target.key,
        last_synced_at: "2026-09-13T11:00:00.000Z"
      }
    },
    ...overrides
  };
  return {
    ...value,
    renderedContentSha256: overrides.renderedContentSha256 ?? renderedContentSha256(value)
  };
}

async function readArtifacts({
  baselineStructure = bodyStructure(),
  currentText = "概要\n\n本文です。",
  currentStructure = baselineStructure,
  currentObservedAt = "2026-09-13T11:06:00.000Z"
} = {}) {
  const { createReadBridgePlan } = await import(pathToFileURL(path.resolve("src/browser/read-plan.mjs")));
  const { createReadResult } = await import(pathToFileURL(path.resolve("src/browser/read-result.mjs")));
  const sourceArticle = article({ structure: baselineStructure });
  const baselinePlan = createReadBridgePlan({
    run: { runId: "20260913-200100-aqsh-baseline", directory: "/tmp/baseline", action: "verify" },
    config,
    target,
    mode: "verify",
    article: sourceArticle,
    now: new Date("2026-09-13T11:01:00.000Z")
  });
  const baselineObservation = {
    accountId: "aqsh",
    url: target.editorUrl,
    title: "同期テスト",
    text: "概要\n\n本文です。",
    structure: baselineStructure,
    h2: ["概要"],
    h3: [],
    imageCount: 0,
    saveControlName: "下書き保存",
    publishControlName: "公開に進む",
    mutated: false
  };
  const baseline = createReadResult(baselinePlan, baselineObservation, {
    validatePlan: value => value,
    observedAt: new Date("2026-09-13T11:02:00.000Z")
  });
  const currentPlan = createReadBridgePlan({
    run: { runId: "20260913-200500-aqsh-current", directory: "/tmp/current", action: "inspect" },
    config,
    target,
    mode: "inspect",
    now: new Date("2026-09-13T11:05:00.000Z")
  });
  const current = createReadResult(currentPlan, {
    ...baselineObservation,
    text: currentText,
    structure: currentStructure
  }, {
    validatePlan: value => value,
    observedAt: new Date(currentObservedAt)
  });
  return {
    baselinePlan,
    baselineSnapshot: baseline.snapshot,
    currentPlan,
    currentSnapshot: current.snapshot
  };
}

test("allows an update only when note still matches the verified baseline and local changed", async () => {
  const { assessSyncConflict } = await loadSut();
  assert.equal(typeof assessSyncConflict, "function", "assessSyncConflict must exist");
  const artifacts = await readArtifacts();

  const output = assessSyncConflict({
    article: article({
      sourceSha256: "c".repeat(64),
      text: "概要 更新予定です。",
      structure: bodyStructure("更新予定です。")
    }),
    ...artifacts,
    now: new Date("2026-09-13T11:07:00.000Z")
  });

  assert.equal(output.result.status, "clear");
  assert.equal(output.result.conflict.detected, false);
  assert.equal(output.result.article.local_changed_since_baseline, true);
  assert.equal(output.result.article.source_changed_since_baseline, true);
  assert.equal(output.result.article.rendered_content_changed_since_baseline, true);
  assert.equal(output.result.update_needed, true);
  assert.equal(output.result.update_allowed, true);
  assert.equal(output.result.browser_state_changed, false);
  assert.equal(output.result.published, false);
  assert.doesNotMatch(JSON.stringify(output.result), /本文です/);
  assert.equal(output.report.baseline.text, "概要\n\n本文です。");
});

test("blocks an update when the current note differs from the verified baseline", async () => {
  const { assessSyncConflict } = await loadSut();
  const artifacts = await readArtifacts({ currentText: "概要\n\nnote側で手修正されました。" });

  const output = assessSyncConflict({
    article: article({ sourceSha256: "c".repeat(64), text: "概要 更新予定です。" }),
    ...artifacts,
    now: new Date("2026-09-13T11:07:00.000Z")
  });

  assert.equal(output.result.status, "conflict");
  assert.equal(output.result.conflict.detected, true);
  assert.ok(output.result.conflict.reasons.includes("body_text_mismatch"));
  assert.equal(output.result.update_allowed, false);
  assert.equal(output.result.published, false);
});

test("blocks an update when identical link text points to a different href", async () => {
  const { assessSyncConflict } = await loadSut();
  const linkStructure = href => [{
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
  const artifacts = await readArtifacts({
    baselineStructure: linkStructure("https://example.com/before"),
    currentText: "概要\n\n本文です。",
    currentStructure: linkStructure("https://example.com/after")
  });

  const output = assessSyncConflict({
    article: article({
      sourceSha256: "c".repeat(64),
      text: "更新予定です。",
      structure: bodyStructure("更新予定です。")
    }),
    ...artifacts,
    now: new Date("2026-09-13T11:07:00.000Z")
  });

  assert.equal(output.result.status, "conflict");
  assert.equal(output.result.conflict.detected, true);
  assert.ok(output.result.conflict.reasons.includes("structure_mismatch"));
  assert.equal(output.result.update_allowed, false);
});

test("does not request a note update for a raw-source-only frontmatter change", async () => {
  const { assessSyncConflict } = await loadSut();
  const artifacts = await readArtifacts();

  const output = assessSyncConflict({
    article: article({ sourceSha256: "c".repeat(64) }),
    ...artifacts,
    now: new Date("2026-09-13T11:07:00.000Z")
  });

  assert.equal(output.result.status, "clear");
  assert.equal(output.result.article.source_changed_since_baseline, true);
  assert.equal(output.result.article.rendered_content_changed_since_baseline, false);
  assert.equal(output.result.article.local_changed_since_baseline, false);
  assert.equal(output.result.update_needed, false);
  assert.equal(output.result.update_allowed, false);
});

test("rejects a baseline that was not verified against its source", async () => {
  const { assessSyncConflict } = await loadSut();
  const artifacts = await readArtifacts();
  const tamperedBaseline = {
    ...artifacts.baselineSnapshot,
    text: "別の本文"
  };

  assert.throws(
    () => assessSyncConflict({
      article: article(),
      ...artifacts,
      baselineSnapshot: tamperedBaseline,
      now: new Date("2026-09-13T11:07:00.000Z")
    }),
    error => error?.code === "READ_SNAPSHOT_INVALID" || error?.code === "SYNC_BASELINE_INVALID"
  );
});

test("rejects a stale current inspection", async () => {
  const { assessSyncConflict } = await loadSut();
  const artifacts = await readArtifacts();

  assert.throws(
    () => assessSyncConflict({
      article: article(),
      ...artifacts,
      now: new Date("2026-09-13T11:16:00.001Z")
    }),
    error => error?.code === "CURRENT_INSPECTION_EXPIRED"
  );
});

test("rejects an ambiguous or non-UTC last_synced_at baseline", async () => {
  const { assessSyncConflict } = await loadSut();
  const artifacts = await readArtifacts();

  for (const lastSyncedAt of [null, "09/13/2026 11:00", "2026-09-13T20:00:00+09:00"] ) {
    const sourceArticle = article();
    sourceArticle.frontmatter = {
      note: { key: target.key, last_synced_at: lastSyncedAt }
    };
    assert.throws(
      () => assessSyncConflict({
        article: sourceArticle,
        ...artifacts,
        now: new Date("2026-09-13T11:07:00.000Z")
      }),
      error => error?.code === "SYNC_BASELINE_INVALID"
    );
  }
});

test("writes a private conflict report containing the full before/current snapshots", async () => {
  const { assessSyncConflict, writeConflictReport } = await loadSut();
  assert.equal(typeof writeConflictReport, "function", "writeConflictReport must exist");
  const artifacts = await readArtifacts();
  const output = assessSyncConflict({
    article: article({ sourceSha256: "c".repeat(64) }),
    ...artifacts,
    now: new Date("2026-09-13T11:07:00.000Z")
  });
  const directory = await mkdtemp(path.join(os.tmpdir(), "aqsh-note-conflict-"));
  const run = { runId: output.report.runId, directory, action: "conflict-check" };

  const destination = await writeConflictReport(run, output.report);

  assert.equal(destination, path.join(directory, "conflict-report.json"));
  assert.deepEqual(JSON.parse(await readFile(destination, "utf8")), output.report);
  assert.equal((await stat(destination)).mode & 0o777, 0o600);
});
