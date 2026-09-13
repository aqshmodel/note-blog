import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { AqshNoteError } from "../errors.mjs";
import { buildDraftPlan } from "./draft-policy.mjs";
import { assertSafeUiActionPlan } from "./safety.mjs";

const PLAN_TTL_MS = 10 * 60 * 1000;
const PLAN_KEYS = new Set([
  "version",
  "type",
  "runId",
  "createdAt",
  "expiresAt",
  "accountId",
  "source",
  "expected",
  "actions",
  "saved",
  "published",
  "sha256"
]);

function invalidPlan() {
  return new AqshNoteError("BROWSER_PLAN_INVALID", "既存Chrome用の下書き計画が不正です。");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  return isPlainObject(value) &&
    Object.keys(value).length === expected.size &&
    Object.keys(value).every(key => expected.has(key));
}

function digestPayload(payload) {
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

function payloadWithoutDigest(plan) {
  const { sha256: _sha256, ...payload } = plan;
  return payload;
}

function assertExpectedSnapshot(expected) {
  if (!hasExactKeys(expected, new Set(["title", "text", "headings", "stats"]))) throw invalidPlan();
  if (typeof expected.title !== "string" || !expected.title.trim()) throw invalidPlan();
  if (typeof expected.text !== "string" || !expected.text.trim()) throw invalidPlan();
  if (!hasExactKeys(expected.headings, new Set(["h2", "h3"]))) throw invalidPlan();
  if (!Array.isArray(expected.headings.h2) || !Array.isArray(expected.headings.h3)) throw invalidPlan();
  if ([...expected.headings.h2, ...expected.headings.h3].some(value => typeof value !== "string")) {
    throw invalidPlan();
  }
  if (!hasExactKeys(expected.stats, new Set([
    "bodyCharacters", "h2", "h3", "images", "links", "externalLinks"
  ]))) throw invalidPlan();
  if (Object.values(expected.stats).some(value => !Number.isInteger(value) || value < 0)) throw invalidPlan();
}

export function assertDraftBridgePlan(plan, options = {}) {
  if (!hasExactKeys(plan, PLAN_KEYS)) throw invalidPlan();
  if (
    plan.version !== 1 ||
    plan.type !== "aqsh-note-existing-chrome-draft" ||
    plan.accountId !== "aqsh" ||
    typeof plan.runId !== "string" || !plan.runId ||
    plan.saved !== false ||
    plan.published !== false ||
    !hasExactKeys(plan.source, new Set(["path", "sha256"])) ||
    typeof plan.source.path !== "string" || !path.isAbsolute(plan.source.path) ||
    !/^[a-f0-9]{64}$/.test(plan.source.sha256) ||
    !/^[a-f0-9]{64}$/.test(plan.sha256)
  ) throw invalidPlan();
  if (options.expectedRunId && plan.runId !== options.expectedRunId) throw invalidPlan();

  assertExpectedSnapshot(plan.expected);
  assertSafeUiActionPlan(plan.actions);

  const createdAt = Date.parse(plan.createdAt);
  const expiresAt = Date.parse(plan.expiresAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt - createdAt !== PLAN_TTL_MS) {
    throw invalidPlan();
  }
  if (options.now !== null) {
    const now = (options.now ?? new Date()).getTime();
    if (now >= expiresAt) {
      throw new AqshNoteError("BROWSER_PLAN_EXPIRED", "既存Chrome用の下書き計画は期限切れです。再作成してください。");
    }
    if (now < createdAt - 30_000) throw invalidPlan();
  }
  if (digestPayload(payloadWithoutDigest(plan)) !== plan.sha256) throw invalidPlan();
  return plan;
}

export function createDraftBridgePlan({ run, article, config, now = new Date() }) {
  if (!run?.runId || !article?.sourceSha256) throw invalidPlan();
  const draft = buildDraftPlan(article, config);
  const createdAt = new Date(now);
  if (!Number.isFinite(createdAt.getTime())) throw invalidPlan();
  const payload = {
    version: 1,
    type: "aqsh-note-existing-chrome-draft",
    runId: run.runId,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + PLAN_TTL_MS).toISOString(),
    accountId: config.account?.id,
    source: {
      path: article.sourcePath,
      sha256: article.sourceSha256
    },
    expected: {
      title: article.title,
      text: article.text,
      headings: article.headings,
      stats: article.stats
    },
    actions: draft.actions,
    saved: false,
    published: false
  };
  const plan = { ...payload, sha256: digestPayload(payload) };
  return assertDraftBridgePlan(plan, { now: createdAt });
}

export async function writeDraftBridgePlan(run, plan) {
  assertDraftBridgePlan(plan, { expectedRunId: run?.runId, now: null });
  const destination = path.join(run.directory, "browser-plan.json");
  await writeFile(destination, `${JSON.stringify(plan, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  return destination;
}
