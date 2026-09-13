import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeVisibleText } from "../article.mjs";
import { AqshNoteError } from "../errors.mjs";
import { parseManagedNoteUrl, parseNoteEditorUrl } from "../note-url.mjs";
import { assertCanonicalStructure, structureSha256 } from "../structure.mjs";
import { compareArticleSnapshots } from "../verify.mjs";
import { textEditorContract } from "./editor-contract.mjs";
import { assertReadBridgePlan } from "./read-plan.mjs";

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
  "mutated"
]);
const SNAPSHOT_KEYS = new Set([
  "version",
  "type",
  "mode",
  "runId",
  "observedAt",
  "accountId",
  "note",
  "title",
  "text",
  "structure",
  "h2",
  "h3",
  "imageCount",
  "mutated",
  "sha256"
]);

function invalidObservation() {
  return new AqshNoteError(
    "READ_OBSERVATION_INVALID",
    "noteの読み取り観測を安全に確認できないため停止しました。"
  );
}

function invalidSnapshot() {
  return new AqshNoteError(
    "READ_SNAPSHOT_INVALID",
    "noteの読み取りスナップショットを安全に確認できないため停止しました。"
  );
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isPlainObject(value) &&
    Object.keys(value).length === keys.size &&
    Object.keys(value).every(key => keys.has(key));
}

function strings(value) {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

function digestPayload(payload) {
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

function validateObservation(plan, observation) {
  const contract = textEditorContract();
  if (
    !hasExactKeys(observation, OBSERVATION_KEYS) ||
    observation.accountId !== plan.accountId ||
    typeof observation.title !== "string" ||
    typeof observation.text !== "string" ||
    !strings(observation.h2) ||
    !strings(observation.h3) ||
    !Number.isInteger(observation.imageCount) || observation.imageCount < 0 ||
    observation.saveControlName !== contract.save.name ||
    observation.publishControlName !== contract.publish.name ||
    observation.mutated !== false
  ) throw invalidObservation();

  let editor;
  try {
    editor = parseNoteEditorUrl(observation.url);
  } catch {
    throw invalidObservation();
  }
  if (editor.key !== plan.target.key || editor.canonicalUrl !== plan.target.editorUrl) {
    throw invalidObservation();
  }
  let structure;
  try {
    structure = assertCanonicalStructure(observation.structure);
  } catch {
    throw invalidObservation();
  }
  return { ...observation, url: editor.canonicalUrl, structure };
}

export function assertReadSnapshot(snapshot, options = {}) {
  if (
    !hasExactKeys(snapshot, SNAPSHOT_KEYS) ||
    snapshot.version !== 2 ||
    snapshot.type !== "aqsh-note-read-snapshot" ||
    !new Set(["inspect", "verify"]).has(snapshot.mode) ||
    typeof snapshot.runId !== "string" || !snapshot.runId ||
    snapshot.accountId !== "aqsh" ||
    typeof snapshot.observedAt !== "string" ||
    typeof snapshot.title !== "string" ||
    typeof snapshot.text !== "string" ||
    !strings(snapshot.h2) ||
    !strings(snapshot.h3) ||
    !Number.isInteger(snapshot.imageCount) || snapshot.imageCount < 0 ||
    snapshot.mutated !== false ||
    !/^[a-f0-9]{64}$/.test(snapshot.sha256)
  ) throw invalidSnapshot();
  if (options.expectedRunId && snapshot.runId !== options.expectedRunId) throw invalidSnapshot();
  if (options.expectedMode && snapshot.mode !== options.expectedMode) throw invalidSnapshot();

  const observedAt = Date.parse(snapshot.observedAt);
  if (!Number.isFinite(observedAt) || new Date(observedAt).toISOString() !== snapshot.observedAt) {
    throw invalidSnapshot();
  }
  if (!hasExactKeys(snapshot.note, new Set(["key", "editorUrl", "publicUrl"]))) {
    throw invalidSnapshot();
  }
  let publicTarget;
  let editorTarget;
  try {
    publicTarget = parseManagedNoteUrl(snapshot.note.publicUrl, snapshot.accountId);
    editorTarget = parseNoteEditorUrl(snapshot.note.editorUrl);
  } catch {
    throw invalidSnapshot();
  }
  if (
    snapshot.note.key !== publicTarget.key ||
    snapshot.note.key !== editorTarget.key ||
    snapshot.note.publicUrl !== publicTarget.canonicalUrl ||
    snapshot.note.editorUrl !== editorTarget.canonicalUrl
  ) throw invalidSnapshot();

  let canonicalStructure;
  try {
    canonicalStructure = assertCanonicalStructure(snapshot.structure);
  } catch {
    throw invalidSnapshot();
  }
  if (JSON.stringify(canonicalStructure) !== JSON.stringify(snapshot.structure)) throw invalidSnapshot();

  const { sha256: _sha256, ...payload } = snapshot;
  if (digestPayload(payload) !== snapshot.sha256) throw invalidSnapshot();
  return snapshot;
}

export function createReadResult(plan, observation, options = {}) {
  const validatePlan = options.validatePlan ?? (value => assertReadBridgePlan(value));
  const validatedPlan = validatePlan(plan);
  const validatedObservation = validateObservation(validatedPlan, observation);
  const observedAt = new Date(options.observedAt ?? new Date());
  if (!Number.isFinite(observedAt.getTime())) throw invalidObservation();

  const snapshotPayload = {
    version: 2,
    type: "aqsh-note-read-snapshot",
    mode: validatedPlan.mode,
    runId: validatedPlan.runId,
    observedAt: observedAt.toISOString(),
    accountId: validatedPlan.accountId,
    note: {
      key: validatedPlan.target.key,
      editorUrl: validatedPlan.target.editorUrl,
      publicUrl: validatedPlan.target.publicUrl
    },
    title: validatedObservation.title,
    text: validatedObservation.text,
    structure: validatedObservation.structure,
    h2: [...validatedObservation.h2],
    h3: [...validatedObservation.h3],
    imageCount: validatedObservation.imageCount,
    mutated: false
  };
  const snapshot = { ...snapshotPayload, sha256: digestPayload(snapshotPayload) };
  const normalizedText = normalizeVisibleText(validatedObservation.text);
  const verification = validatedPlan.mode === "verify"
    ? compareArticleSnapshots({
        title: validatedPlan.expected.title,
        text: validatedPlan.expected.text,
        structure: validatedPlan.expected.structure,
        h2: validatedPlan.expected.headings.h2,
        h3: validatedPlan.expected.headings.h3,
        imageCount: validatedPlan.expected.stats.images
      }, {
        title: validatedObservation.title,
        text: validatedObservation.text,
        structure: validatedObservation.structure,
        h2: validatedObservation.h2,
        h3: validatedObservation.h3,
        imageCount: validatedObservation.imageCount
      })
    : null;
  const success = verification?.ok ?? true;

  const result = {
    status: success ? "success" : "failed",
    action: validatedPlan.mode,
    run_id: validatedPlan.runId,
    account: validatedPlan.accountId,
    note: {
      key: validatedPlan.target.key,
      editor_url: validatedPlan.target.editorUrl,
      public_url: validatedPlan.target.publicUrl
    },
    ui_contract: textEditorContract().version,
    actual: {
      title: validatedObservation.title,
      text_sha256: createHash("sha256").update(normalizedText, "utf8").digest("hex"),
      structure_sha256: structureSha256(validatedObservation.structure),
      stats: {
        bodyCharacters: normalizedText.length,
        h2: validatedObservation.h2.length,
        h3: validatedObservation.h3.length,
        images: validatedObservation.imageCount
      }
    },
    snapshot: { sha256: snapshot.sha256 },
    verification,
    browser_connected: true,
    browser_state_changed: false,
    saved: false,
    published: false
  };
  return { result, snapshot };
}

export async function writeReadSnapshot(run, snapshot) {
  assertReadSnapshot(snapshot, {
    expectedRunId: run?.runId,
    expectedMode: run?.action
  });
  const destination = path.join(run.directory, "snapshot.json");
  await writeFile(destination, `${JSON.stringify(snapshot, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  return destination;
}
