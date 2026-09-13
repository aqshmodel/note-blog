import { AqshNoteError } from "../errors.mjs";
import { parseNoteEditorUrl } from "../note-url.mjs";
import { compareArticleSnapshots } from "../verify.mjs";
import { assertDraftBridgePlan } from "./bridge-plan.mjs";

const OBSERVATION_KEYS = new Set([
  "url",
  "title",
  "text",
  "h2",
  "h3",
  "imageCount",
  "saveControlName",
  "reloaded",
  "published"
]);

function invalidObservation() {
  return new AqshNoteError(
    "DRAFT_OBSERVATION_INVALID",
    "保存後のnote下書き観測を安全に確認できないため停止しました。"
  );
}

function strings(value) {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

export function verifyDraftObservation(plan, observation, options = {}) {
  const validatePlan = options.validatePlan ?? (value => assertDraftBridgePlan(value, { now: null }));
  const validatedPlan = validatePlan(plan);
  if (
    !observation || typeof observation !== "object" || Array.isArray(observation) ||
    Object.keys(observation).length !== OBSERVATION_KEYS.size ||
    Object.keys(observation).some(key => !OBSERVATION_KEYS.has(key)) ||
    typeof observation.title !== "string" ||
    typeof observation.text !== "string" ||
    !strings(observation.h2) ||
    !strings(observation.h3) ||
    !Number.isInteger(observation.imageCount) || observation.imageCount < 0 ||
    observation.saveControlName !== "下書き保存" ||
    observation.reloaded !== true ||
    observation.published !== false
  ) throw invalidObservation();

  let editor;
  try {
    editor = parseNoteEditorUrl(observation.url);
  } catch {
    throw invalidObservation();
  }

  const verification = compareArticleSnapshots({
    title: validatedPlan.expected.title,
    text: validatedPlan.expected.text,
    h2: validatedPlan.expected.headings.h2,
    h3: validatedPlan.expected.headings.h3,
    imageCount: validatedPlan.expected.stats.images
  }, {
    title: observation.title,
    text: observation.text,
    h2: observation.h2,
    h3: observation.h3,
    imageCount: observation.imageCount
  });

  return {
    status: verification.ok ? "success" : "failed",
    action: "draft",
    run_id: validatedPlan.runId,
    account: validatedPlan.accountId,
    article: {
      title: validatedPlan.expected.title,
      source_sha256: validatedPlan.source.sha256
    },
    note: {
      key: editor.key,
      editor_url: editor.canonicalUrl
    },
    ui_contract: "note-text-editor-2026-09-v1",
    verification,
    browser_connected: true,
    browser_state_changed: true,
    saved: true,
    published: false
  };
}
