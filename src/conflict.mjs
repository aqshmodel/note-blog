import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { assertReadBridgePlan } from "./browser/read-plan.mjs";
import { assertReadSnapshot } from "./browser/read-result.mjs";
import { AqshNoteError } from "./errors.mjs";
import { parseManagedNoteUrl, validateNoteKey } from "./note-url.mjs";
import { assertCanonicalStructure, renderedContentSha256 } from "./structure.mjs";
import { compareArticleSnapshots } from "./verify.mjs";

const CURRENT_INSPECTION_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_MS = 30 * 1000;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const REPORT_KEYS = new Set([
  "version",
  "type",
  "runId",
  "assessedAt",
  "accountId",
  "article",
  "target",
  "baseline",
  "current",
  "comparison",
  "sourceChangedSinceBaseline",
  "renderedContentChangedSinceBaseline",
  "localChangedSinceBaseline",
  "conflictDetected",
  "updateNeeded",
  "updateAllowed",
  "browserStateChanged",
  "saved",
  "published",
  "sha256"
]);

function digestPayload(payload) {
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isPlainObject(value) &&
    Object.keys(value).length === keys.size &&
    Object.keys(value).every(key => keys.has(key));
}

function baselineInvalid() {
  return new AqshNoteError(
    "SYNC_BASELINE_INVALID",
    "検証済みの同期基準を安全に確認できないため停止しました。"
  );
}

function currentInvalid() {
  return new AqshNoteError(
    "CURRENT_INSPECTION_INVALID",
    "現在のnote読み取り結果を安全に確認できないため停止しました。"
  );
}

function reportInvalid() {
  return new AqshNoteError(
    "CONFLICT_REPORT_INVALID",
    "同期コンフリクト記録を安全に確認できないため停止しました。"
  );
}

function dateValue(value, invalid) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw invalid();
  return timestamp;
}

function utcTimestamp(value) {
  if (typeof value !== "string" || !UTC_TIMESTAMP_PATTERN.test(value)) throw baselineInvalid();
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw baselineInvalid();
  const canonical = new Date(timestamp).toISOString();
  if (value !== canonical && value !== canonical.replace(".000Z", "Z")) throw baselineInvalid();
  return timestamp;
}

function articleNoteKey(article) {
  const note = article?.frontmatter?.note;
  if (!isPlainObject(note)) throw baselineInvalid();
  let key = null;
  let urlKey = null;
  try {
    if (note.key) key = validateNoteKey(note.key);
    if (note.url) urlKey = parseManagedNoteUrl(note.url, "aqsh").key;
  } catch {
    throw baselineInvalid();
  }
  if (!key && !urlKey) throw baselineInvalid();
  if (key && urlKey && key !== urlKey) throw baselineInvalid();
  return key ?? urlKey;
}

function assertArticle(article) {
  if (
    !article ||
    typeof article.id !== "string" || !article.id ||
    typeof article.sourcePath !== "string" || !path.isAbsolute(article.sourcePath) ||
    typeof article.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(article.sourceSha256) ||
    typeof article.renderedContentSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(article.renderedContentSha256)
  ) throw baselineInvalid();
  let structure;
  try {
    structure = assertCanonicalStructure(article.structure);
  } catch {
    throw baselineInvalid();
  }
  if (renderedContentSha256({ title: article.title, structure }) !== article.renderedContentSha256) {
    throw baselineInvalid();
  }
  const lastSyncedAt = article.frontmatter?.note?.last_synced_at;
  const lastSyncedTime = utcTimestamp(lastSyncedAt);
  return {
    key: articleNoteKey(article),
    lastSyncedAt,
    lastSyncedTime
  };
}

function assertSnapshotMatchesPlan(snapshot, plan, invalid) {
  if (
    snapshot.accountId !== plan.accountId ||
    snapshot.note.key !== plan.target.key ||
    snapshot.note.publicUrl !== plan.target.publicUrl ||
    snapshot.note.editorUrl !== plan.target.editorUrl
  ) throw invalid();
  const observedAt = dateValue(snapshot.observedAt, invalid);
  const createdAt = dateValue(plan.createdAt, invalid);
  const expiresAt = dateValue(plan.expiresAt, invalid);
  if (observedAt < createdAt - CLOCK_SKEW_MS || observedAt > expiresAt) throw invalid();
  return observedAt;
}

function comparisonShape(snapshot) {
  return {
    title: snapshot.title,
    text: snapshot.text,
    structure: snapshot.structure,
    h2: snapshot.h2,
    h3: snapshot.h3,
    imageCount: snapshot.imageCount
  };
}

function expectedShape(plan) {
  return {
    title: plan.expected.title,
    text: plan.expected.text,
    structure: plan.expected.structure,
    h2: plan.expected.headings.h2,
    h3: plan.expected.headings.h3,
    imageCount: plan.expected.stats.images
  };
}

function assertSameTarget(articleKey, baselinePlan, currentPlan) {
  if (
    articleKey !== baselinePlan.target.key ||
    articleKey !== currentPlan.target.key ||
    baselinePlan.accountId !== currentPlan.accountId ||
    baselinePlan.target.publicUrl !== currentPlan.target.publicUrl ||
    baselinePlan.target.editorUrl !== currentPlan.target.editorUrl
  ) throw baselineInvalid();
}

function assertConflictReport(report, run) {
  if (
    !hasExactKeys(report, REPORT_KEYS) ||
    report.version !== 2 ||
    report.type !== "aqsh-note-conflict-report" ||
    typeof report.runId !== "string" || !report.runId ||
    report.runId !== run?.runId ||
    run?.action !== "conflict-check" ||
    report.accountId !== "aqsh" ||
    report.browserStateChanged !== false ||
    report.saved !== false ||
    report.published !== false ||
    !/^[a-f0-9]{64}$/.test(report.sha256)
  ) throw reportInvalid();
  const assessedAt = Date.parse(report.assessedAt);
  if (!Number.isFinite(assessedAt) || new Date(assessedAt).toISOString() !== report.assessedAt) {
    throw reportInvalid();
  }
  assertReadSnapshot(report.baseline, { expectedMode: "verify" });
  assertReadSnapshot(report.current, { expectedMode: "inspect" });
  const { sha256: _sha256, ...payload } = report;
  if (digestPayload(payload) !== report.sha256) throw reportInvalid();
  return report;
}

export function assessSyncConflict({
  article,
  baselinePlan,
  baselineSnapshot,
  currentPlan,
  currentSnapshot,
  now = new Date(),
  runId = null
}) {
  const articleTarget = assertArticle(article);
  const validatedBaselinePlan = assertReadBridgePlan(baselinePlan, {
    expectedMode: "verify",
    now: null
  });
  const validatedCurrentPlan = assertReadBridgePlan(currentPlan, {
    expectedMode: "inspect",
    now: null
  });
  const validatedBaseline = assertReadSnapshot(baselineSnapshot, {
    expectedRunId: validatedBaselinePlan.runId,
    expectedMode: "verify"
  });
  const validatedCurrent = assertReadSnapshot(currentSnapshot, {
    expectedRunId: validatedCurrentPlan.runId,
    expectedMode: "inspect"
  });

  if (
    path.resolve(validatedBaselinePlan.source.path) !== path.resolve(article.sourcePath) ||
    validatedBaselinePlan.accountId !== "aqsh"
  ) throw baselineInvalid();
  assertSameTarget(articleTarget.key, validatedBaselinePlan, validatedCurrentPlan);

  const baselineObservedAt = assertSnapshotMatchesPlan(
    validatedBaseline,
    validatedBaselinePlan,
    baselineInvalid
  );
  const currentObservedAt = assertSnapshotMatchesPlan(
    validatedCurrent,
    validatedCurrentPlan,
    currentInvalid
  );
  if (baselineObservedAt < articleTarget.lastSyncedTime || currentObservedAt < baselineObservedAt) {
    throw baselineInvalid();
  }

  const assessedAt = new Date(now);
  if (!Number.isFinite(assessedAt.getTime())) throw currentInvalid();
  const currentAge = assessedAt.getTime() - currentObservedAt;
  if (currentAge > CURRENT_INSPECTION_TTL_MS) {
    throw new AqshNoteError(
      "CURRENT_INSPECTION_EXPIRED",
      "現在のnote読み取り結果は期限切れです。inspectを再実行してください。"
    );
  }
  if (currentAge < -CLOCK_SKEW_MS) throw currentInvalid();

  const baselineAlignment = compareArticleSnapshots(
    expectedShape(validatedBaselinePlan),
    comparisonShape(validatedBaseline)
  );
  if (!baselineAlignment.ok) throw baselineInvalid();

  const comparison = compareArticleSnapshots(
    comparisonShape(validatedBaseline),
    comparisonShape(validatedCurrent)
  );
  const sourceChangedSinceBaseline = article.sourceSha256 !== validatedBaselinePlan.source.sha256;
  const renderedContentChangedSinceBaseline =
    article.renderedContentSha256 !== validatedBaselinePlan.source.renderedContentSha256;
  const localChangedSinceBaseline = renderedContentChangedSinceBaseline;
  const conflictDetected = !comparison.ok;
  const updateNeeded = renderedContentChangedSinceBaseline;
  const updateAllowed = updateNeeded && !conflictDetected;
  const effectiveRunId = runId ?? `conflict-${validatedCurrent.runId}`;
  if (typeof effectiveRunId !== "string" || !effectiveRunId) throw reportInvalid();

  const reportPayload = {
    version: 2,
    type: "aqsh-note-conflict-report",
    runId: effectiveRunId,
    assessedAt: assessedAt.toISOString(),
    accountId: "aqsh",
    article: {
      id: article.id,
      sourcePath: article.sourcePath,
      currentSourceSha256: article.sourceSha256,
      baselineSourceSha256: validatedBaselinePlan.source.sha256,
      currentRenderedContentSha256: article.renderedContentSha256,
      baselineRenderedContentSha256: validatedBaselinePlan.source.renderedContentSha256,
      lastSyncedAt: articleTarget.lastSyncedAt
    },
    target: { ...validatedBaseline.note },
    baseline: validatedBaseline,
    current: validatedCurrent,
    comparison,
    sourceChangedSinceBaseline,
    renderedContentChangedSinceBaseline,
    localChangedSinceBaseline,
    conflictDetected,
    updateNeeded,
    updateAllowed,
    browserStateChanged: false,
    saved: false,
    published: false
  };
  const report = { ...reportPayload, sha256: digestPayload(reportPayload) };
  const result = {
    status: conflictDetected ? "conflict" : "clear",
    action: "conflict-check",
    run_id: effectiveRunId,
    account: "aqsh",
    article: {
      id: article.id,
      source_path: article.sourcePath,
      current_source_sha256: article.sourceSha256,
      baseline_source_sha256: validatedBaselinePlan.source.sha256,
      current_rendered_content_sha256: article.renderedContentSha256,
      baseline_rendered_content_sha256: validatedBaselinePlan.source.renderedContentSha256,
      source_changed_since_baseline: sourceChangedSinceBaseline,
      rendered_content_changed_since_baseline: renderedContentChangedSinceBaseline,
      local_changed_since_baseline: localChangedSinceBaseline
    },
    note: {
      key: validatedBaseline.note.key,
      public_url: validatedBaseline.note.publicUrl,
      editor_url: validatedBaseline.note.editorUrl
    },
    baseline: {
      run_id: validatedBaseline.runId,
      observed_at: validatedBaseline.observedAt,
      snapshot_sha256: validatedBaseline.sha256
    },
    current: {
      run_id: validatedCurrent.runId,
      observed_at: validatedCurrent.observedAt,
      snapshot_sha256: validatedCurrent.sha256
    },
    conflict: {
      detected: conflictDetected,
      checks: comparison.checks,
      reasons: comparison.reasons,
      before: comparison.expected,
      current: comparison.actual
    },
    update_needed: updateNeeded,
    update_allowed: updateAllowed,
    report: { sha256: report.sha256 },
    browser_launched: false,
    browser_state_changed: false,
    saved: false,
    published: false
  };
  return { result, report };
}

export async function writeConflictReport(run, report) {
  assertConflictReport(report, run);
  const destination = path.join(run.directory, "conflict-report.json");
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  return destination;
}
