import { AqshNoteError } from "../errors.mjs";
import { parseNoteEditorUrl } from "../note-url.mjs";
import { assertCanonicalStructure } from "../structure.mjs";
import { compareArticleSnapshots } from "../verify.mjs";
import { assertUpdateBridgePlan } from "./update-plan.mjs";

const OBSERVATION_KEYS = new Set([
  "accountId",
  "url",
  "title",
  "text",
  "structure",
  "h2",
  "h3",
  "imageCount",
  "saveControlName",
  "publishControlName",
  "reloaded",
  "published"
]);

function invalidObservation() {
  return new AqshNoteError(
    "UPDATE_OBSERVATION_INVALID",
    "保存後のnote下書き更新結果を安全に確認できないため停止しました。"
  );
}

function strings(value) {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

export function verifyUpdateObservation(plan, observation, options = {}) {
  const validatePlan = options.validatePlan ?? (value => assertUpdateBridgePlan(value, { now: null }));
  const validatedPlan = validatePlan(plan);
  if (
    !observation || typeof observation !== "object" || Array.isArray(observation) ||
    Object.keys(observation).length !== OBSERVATION_KEYS.size ||
    Object.keys(observation).some(key => !OBSERVATION_KEYS.has(key)) ||
    observation.accountId !== validatedPlan.accountId ||
    typeof observation.title !== "string" || typeof observation.text !== "string" ||
    !strings(observation.h2) || !strings(observation.h3) ||
    !Number.isInteger(observation.imageCount) || observation.imageCount < 0 ||
    observation.saveControlName !== "下書き保存" ||
    observation.publishControlName !== "公開に進む" ||
    observation.reloaded !== true || observation.published !== false
  ) throw invalidObservation();

  let editor;
  let structure;
  try {
    editor = parseNoteEditorUrl(observation.url);
    structure = assertCanonicalStructure(observation.structure);
  } catch {
    throw invalidObservation();
  }
  if (editor.key !== validatedPlan.target.key || editor.canonicalUrl !== validatedPlan.target.editorUrl) {
    throw invalidObservation();
  }

  const verification = compareArticleSnapshots({
    title: validatedPlan.expected.title,
    text: validatedPlan.expected.text,
    structure: validatedPlan.expected.structure,
    h2: validatedPlan.expected.headings.h2,
    h3: validatedPlan.expected.headings.h3,
    imageCount: validatedPlan.expected.stats.images
  }, {
    title: observation.title,
    text: observation.text,
    structure,
    h2: observation.h2,
    h3: observation.h3,
    imageCount: observation.imageCount
  });

  return {
    status: verification.ok ? "success" : "failed",
    action: "update",
    run_id: validatedPlan.runId,
    account: validatedPlan.accountId,
    article: {
      title: validatedPlan.expected.title,
      source_sha256: validatedPlan.source.sha256,
      rendered_content_sha256: validatedPlan.source.renderedContentSha256
    },
    note: {
      key: editor.key,
      editor_url: editor.canonicalUrl,
      public_url: validatedPlan.target.publicUrl
    },
    approval: { conflict_report_sha256: validatedPlan.approval.conflictReportSha256 },
    ui_contract: "note-text-editor-2026-09-v1",
    verification,
    browser_connected: true,
    browser_state_changed: true,
    saved: true,
    published: false
  };
}
