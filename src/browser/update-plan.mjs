import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { AqshNoteError } from "../errors.mjs";
import { parseManagedNoteUrl, parseNoteEditorUrl } from "../note-url.mjs";
import { assertCanonicalStructure, renderedContentSha256 } from "../structure.mjs";
import { textEditorContract } from "./editor-contract.mjs";
import { assertSafeUpdateUiActionPlan } from "./safety.mjs";

const PLAN_TTL_MS = 10 * 60 * 1000;
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
  "approval",
  "before",
  "expected",
  "actions",
  "confirmationRequired",
  "saved",
  "published",
  "sha256"
]);

function invalidPlan() {
  return new AqshNoteError("BROWSER_PLAN_INVALID", "既存Chrome用の下書き更新計画が不正です。");
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
    target.key !== publicTarget.key || target.key !== editorTarget.key ||
    target.publicUrl !== publicTarget.canonicalUrl || target.editorUrl !== editorTarget.canonicalUrl
  ) throw invalidPlan();
}

function assertHeadings(headings) {
  if (!hasExactKeys(headings, new Set(["h2", "h3"]))) throw invalidPlan();
  if (!Array.isArray(headings.h2) || !Array.isArray(headings.h3)) throw invalidPlan();
  if (![...headings.h2, ...headings.h3].every(value => typeof value === "string")) throw invalidPlan();
}

function assertStats(stats) {
  if (!hasExactKeys(stats, new Set([
    "bodyCharacters", "h2", "h3", "images", "links", "externalLinks"
  ]))) throw invalidPlan();
  if (Object.values(stats).some(value => !Number.isInteger(value) || value < 0)) throw invalidPlan();
}

function assertBefore(before) {
  if (!hasExactKeys(before, new Set([
    "snapshotSha256", "title", "text", "structure", "headings", "imageCount"
  ]))) throw invalidPlan();
  if (
    !/^[a-f0-9]{64}$/.test(before.snapshotSha256) ||
    typeof before.title !== "string" || typeof before.text !== "string" ||
    !Number.isInteger(before.imageCount) || before.imageCount < 0
  ) throw invalidPlan();
  assertHeadings(before.headings);
  assertCanonicalStructure(before.structure);
}

function assertExpected(expected) {
  if (!hasExactKeys(expected, new Set(["title", "text", "structure", "headings", "stats"]))) {
    throw invalidPlan();
  }
  if (typeof expected.title !== "string" || !expected.title.trim() || typeof expected.text !== "string" || !expected.text.trim()) {
    throw invalidPlan();
  }
  assertHeadings(expected.headings);
  assertStats(expected.stats);
  assertCanonicalStructure(expected.structure);
}

function buildActions({ accountId, target, article, beforeSnapshotSha256 }) {
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
    { kind: "verify_current", snapshotSha256: beforeSnapshotSha256 },
    { kind: "fill_title", value: article.title },
    { kind: "replace_body_html", html: article.html, plainText: article.text },
    { kind: "save_draft", accessibleName: "下書き保存" },
    { kind: "verify" }
  ];
}

export function assertUpdateBridgePlan(plan, options = {}) {
  if (!hasExactKeys(plan, PLAN_KEYS)) throw invalidPlan();
  if (
    plan.version !== 1 || plan.type !== "aqsh-note-existing-chrome-update" || plan.mode !== "update" ||
    plan.accountId !== "aqsh" || typeof plan.runId !== "string" || !plan.runId ||
    plan.confirmationRequired !== true || plan.saved !== false || plan.published !== false ||
    !/^[a-f0-9]{64}$/.test(plan.sha256)
  ) throw invalidPlan();
  if (options.expectedRunId && plan.runId !== options.expectedRunId) throw invalidPlan();

  assertTarget(plan.target, plan.accountId);
  if (
    !hasExactKeys(plan.source, new Set(["path", "sha256", "renderedContentSha256"])) ||
    typeof plan.source.path !== "string" || !path.isAbsolute(plan.source.path) ||
    !/^[a-f0-9]{64}$/.test(plan.source.sha256) ||
    !/^[a-f0-9]{64}$/.test(plan.source.renderedContentSha256) ||
    !hasExactKeys(plan.approval, new Set(["conflictReportPath", "conflictReportSha256", "assessedAt"])) ||
    typeof plan.approval.conflictReportPath !== "string" || !path.isAbsolute(plan.approval.conflictReportPath) ||
    !/^[a-f0-9]{64}$/.test(plan.approval.conflictReportSha256) ||
    !Number.isFinite(Date.parse(plan.approval.assessedAt))
  ) throw invalidPlan();
  assertBefore(plan.before);
  assertExpected(plan.expected);
  if (renderedContentSha256({ title: plan.expected.title, structure: plan.expected.structure }) !== plan.source.renderedContentSha256) {
    throw invalidPlan();
  }

  const actions = assertSafeUpdateUiActionPlan(plan.actions, { key: plan.target.key });
  if (
    actions[3].snapshotSha256 !== plan.before.snapshotSha256 ||
    actions[4].value !== plan.expected.title ||
    actions[5].plainText !== plan.expected.text
  ) throw invalidPlan();

  const createdAt = Date.parse(plan.createdAt);
  const expiresAt = Date.parse(plan.expiresAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt - createdAt !== PLAN_TTL_MS) {
    throw invalidPlan();
  }
  if (options.now !== null) {
    const now = (options.now ?? new Date()).getTime();
    if (now >= expiresAt) {
      throw new AqshNoteError("BROWSER_PLAN_EXPIRED", "既存Chrome用の下書き更新計画は期限切れです。再作成してください。");
    }
    if (now < createdAt - 30_000) throw invalidPlan();
  }
  if (digestPayload(payloadWithoutDigest(plan)) !== plan.sha256) throw invalidPlan();
  return plan;
}

export function createUpdateBridgePlan({ run, article, config, authorization, now = new Date() }) {
  if (!run?.runId || run.action !== "update" || config?.account?.id !== "aqsh" || config?.security?.allowPublish !== false) {
    throw invalidPlan();
  }
  if (config.editor?.inlineImageStrategy !== "unverified") {
    throw new AqshNoteError("INLINE_IMAGE_STRATEGY_INVALID", "本文画像方式はE2E選定前のためunverifiedで固定してください。");
  }
  if ((article?.images?.length ?? 0) > 0) {
    throw new AqshNoteError(
      "INLINE_IMAGE_STRATEGY_UNVERIFIED",
      "本文画像の配置方式は既存Chrome向けbrowser executorのE2E検証前のため停止しました。"
    );
  }
  if (article?.frontmatter?.assets?.eyecatch) {
    throw new AqshNoteError("EYECATCH_UI_UNVERIFIED", "アイキャッチ操作は現行note UIでの検証前のため停止しました。");
  }
  const createdAt = new Date(now);
  if (!Number.isFinite(createdAt.getTime())) throw invalidPlan();
  const before = {
    snapshotSha256: authorization.current.snapshotSha256,
    title: authorization.current.title,
    text: authorization.current.text,
    structure: authorization.current.structure,
    headings: { h2: authorization.current.h2, h3: authorization.current.h3 },
    imageCount: authorization.current.imageCount
  };
  const payload = {
    version: 1,
    type: "aqsh-note-existing-chrome-update",
    mode: "update",
    runId: run.runId,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + PLAN_TTL_MS).toISOString(),
    accountId: config.account.id,
    target: authorization.target,
    source: {
      path: article.sourcePath,
      sha256: article.sourceSha256,
      renderedContentSha256: article.renderedContentSha256
    },
    approval: {
      conflictReportPath: authorization.reportPath,
      conflictReportSha256: authorization.reportSha256,
      assessedAt: authorization.assessedAt
    },
    before,
    expected: {
      title: article.title,
      text: article.text,
      structure: article.structure,
      headings: article.headings,
      stats: article.stats
    },
    actions: buildActions({
      accountId: config.account.id,
      target: authorization.target,
      article,
      beforeSnapshotSha256: authorization.current.snapshotSha256
    }),
    confirmationRequired: true,
    saved: false,
    published: false
  };
  const plan = { ...payload, sha256: digestPayload(payload) };
  return assertUpdateBridgePlan(plan, { expectedRunId: run.runId, now: createdAt });
}

export async function writeUpdateBridgePlan(run, plan) {
  assertUpdateBridgePlan(plan, { expectedRunId: run?.runId, now: null });
  if (run?.action !== "update") throw invalidPlan();
  const destination = path.join(run.directory, "browser-plan.json");
  await writeFile(destination, `${JSON.stringify(plan, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  return destination;
}
