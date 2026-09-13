import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { AqshNoteError } from "../errors.mjs";
import { parseManagedNoteUrl, parseNoteEditorUrl } from "../note-url.mjs";
import { textEditorContract } from "./editor-contract.mjs";
import { assertSafeReadUiActionPlan } from "./safety.mjs";

const PLAN_TTL_MS = 10 * 60 * 1000;
const MODES = new Set(["inspect", "verify"]);
const PLAN_KEYS = new Set([
  "version",
  "type",
  "mode",
  "runId",
  "createdAt",
  "expiresAt",
  "accountId",
  "target",
  "source",
  "expected",
  "actions",
  "browserStateChanged",
  "sha256"
]);

function invalidPlan() {
  return new AqshNoteError("BROWSER_PLAN_INVALID", "既存Chrome用の読み取り計画が不正です。");
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

function assertTarget(target, accountId) {
  if (!hasExactKeys(target, new Set(["key", "publicUrl", "editorUrl"]))) throw invalidPlan();
  let publicTarget;
  let editorTarget;
  try {
    publicTarget = parseManagedNoteUrl(target.publicUrl, accountId);
    editorTarget = parseNoteEditorUrl(target.editorUrl);
  } catch {
    throw invalidPlan();
  }
  if (
    target.publicUrl !== publicTarget.canonicalUrl ||
    target.editorUrl !== editorTarget.canonicalUrl ||
    target.key !== publicTarget.key ||
    target.key !== editorTarget.key
  ) throw invalidPlan();
}

function buildActions({ accountId, target, mode }) {
  return [
    {
      kind: "verify_account",
      url: "https://note.com/settings/account/note_id",
      accountId,
      field: {
        name: "urlname",
        ariaLabel: "note ID",
        expectedValue: accountId,
        count: 1
      }
    },
    { kind: "open_existing_editor", key: target.key, url: target.editorUrl },
    { kind: "verify_editor_contract", contract: textEditorContract() },
    { kind: mode }
  ];
}

export function assertReadBridgePlan(plan, options = {}) {
  if (!hasExactKeys(plan, PLAN_KEYS)) throw invalidPlan();
  if (
    plan.version !== 1 ||
    plan.type !== "aqsh-note-existing-chrome-read" ||
    !MODES.has(plan.mode) ||
    plan.accountId !== "aqsh" ||
    typeof plan.runId !== "string" || !plan.runId ||
    plan.browserStateChanged !== false ||
    !/^[a-f0-9]{64}$/.test(plan.sha256)
  ) throw invalidPlan();
  if (options.expectedRunId && plan.runId !== options.expectedRunId) throw invalidPlan();
  if (options.expectedMode && plan.mode !== options.expectedMode) throw invalidPlan();

  assertTarget(plan.target, plan.accountId);
  if (plan.mode === "inspect") {
    if (plan.source !== null || plan.expected !== null) throw invalidPlan();
  } else {
    if (
      !hasExactKeys(plan.source, new Set(["path", "sha256"])) ||
      typeof plan.source.path !== "string" || !path.isAbsolute(plan.source.path) ||
      !/^[a-f0-9]{64}$/.test(plan.source.sha256)
    ) throw invalidPlan();
    assertExpectedSnapshot(plan.expected);
  }
  assertSafeReadUiActionPlan(plan.actions, { mode: plan.mode, key: plan.target.key });

  const createdAt = Date.parse(plan.createdAt);
  const expiresAt = Date.parse(plan.expiresAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt - createdAt !== PLAN_TTL_MS) {
    throw invalidPlan();
  }
  if (options.now !== null) {
    const now = (options.now ?? new Date()).getTime();
    if (now >= expiresAt) {
      throw new AqshNoteError("BROWSER_PLAN_EXPIRED", "既存Chrome用の読み取り計画は期限切れです。再作成してください。");
    }
    if (now < createdAt - 30_000) throw invalidPlan();
  }
  if (digestPayload(payloadWithoutDigest(plan)) !== plan.sha256) throw invalidPlan();
  return plan;
}

export function createReadBridgePlan({ run, config, target, mode, article = null, now = new Date() }) {
  if (!run?.runId || run.action !== mode || !MODES.has(mode) || config?.security?.allowPublish !== false) {
    throw invalidPlan();
  }
  if (config.account?.id !== "aqsh") throw invalidPlan();
  if (mode === "verify" && (!article?.sourceSha256 || !article?.sourcePath)) throw invalidPlan();
  const createdAt = new Date(now);
  if (!Number.isFinite(createdAt.getTime())) throw invalidPlan();
  const source = mode === "verify"
    ? { path: article.sourcePath, sha256: article.sourceSha256 }
    : null;
  const expected = mode === "verify"
    ? {
        title: article.title,
        text: article.text,
        headings: article.headings,
        stats: article.stats
      }
    : null;
  const payload = {
    version: 1,
    type: "aqsh-note-existing-chrome-read",
    mode,
    runId: run.runId,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + PLAN_TTL_MS).toISOString(),
    accountId: config.account.id,
    target,
    source,
    expected,
    actions: buildActions({ accountId: config.account.id, target, mode }),
    browserStateChanged: false
  };
  const plan = { ...payload, sha256: digestPayload(payload) };
  return assertReadBridgePlan(plan, { expectedRunId: run.runId, expectedMode: mode, now: createdAt });
}

export async function writeReadBridgePlan(run, plan) {
  assertReadBridgePlan(plan, {
    expectedRunId: run?.runId,
    expectedMode: run?.action,
    now: null
  });
  const destination = path.join(run.directory, "browser-plan.json");
  await writeFile(destination, `${JSON.stringify(plan, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  return destination;
}
