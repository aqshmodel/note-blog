import { mkdir, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { AqshNoteError } from "./errors.mjs";
import { ensureDedicatedRuntimeDirectory } from "./runtime-paths.mjs";

const SENSITIVE_KEY = /(api.?key|authorization|cookie|password|secret|session|storage.?state|token)/i;

function redactUrlToken(token) {
  return token
    .replace(/^(https?:\/\/)[^/\s@]+@/i, "$1[REDACTED]@")
    .replace(/([?&][^=\s&#]+)=([^&#\s"'<>]*)/g, "$1=[REDACTED]")
    .replace(/#[^\s"'<>]*/g, "#[REDACTED]");
}

function redactUrlSecrets(value) {
  return value.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, token => redactUrlToken(token));
}

function timeParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  );
}

function safeSlug(value) {
  return String(value ?? "article")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "article";
}

export function redactSecrets(value, key = "") {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map(item => redactSecrets(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [childKey, redactSecrets(childValue, childKey)])
    );
  }
  if (typeof value === "string") {
    return redactUrlSecrets(value)
      .replace(/\b(Authorization|Cookie|Set-Cookie)\s*:\s*[^\r\n]*/gi, "$1: [REDACTED]")
      .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
      .replace(/\b(api[_-]?key|access[_-]?token|authorization|password|token|cookie|session|secret)=([^\s;&#]+)/gi, "$1=[REDACTED]")
      .replace(/\b(api[_-]?key|access[_-]?token|authorization|password|token|cookie|session|secret)\s*:\s*[^\s,;]+/gi, "$1: [REDACTED]");
  }
  return value;
}

export async function createRunContext({
  stateDir,
  action,
  articleId,
  now = new Date(),
  timeZone = "Asia/Tokyo"
}) {
  const parts = timeParts(now, timeZone);
  const timestamp = `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
  const baseRunId = `${timestamp}-${safeSlug(articleId)}`;
  const ownedStateDir = await ensureDedicatedRuntimeDirectory(stateDir, "state");
  const runsDirectory = path.join(ownedStateDir, "runs");
  await mkdir(runsDirectory, { recursive: true, mode: 0o700 });

  for (let attempt = 1; attempt <= 99; attempt += 1) {
    const runId = attempt === 1 ? baseRunId : `${baseRunId}-${String(attempt).padStart(2, "0")}`;
    const directory = path.join(runsDirectory, runId);
    try {
      await mkdir(directory, { mode: 0o700 });
      return { runId, directory, action };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }

  throw new AqshNoteError("RUN_ID_EXHAUSTED", "同一秒のrun IDを確保できませんでした。");
}

export async function writeRunResult(run, result) {
  const destination = path.join(run.directory, "result.json");
  const temporary = path.join(run.directory, `.result-${process.pid}.tmp`);
  const safeResult = redactSecrets({ run_id: run.runId, ...result });
  await writeFile(temporary, `${JSON.stringify(safeResult, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, destination);
  return destination;
}

export async function listRecoveryRuns(stateDir) {
  const runsDirectory = path.join(path.resolve(stateDir), "runs");
  let entries;
  try {
    entries = await readdir(runsDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const runs = await Promise.all(
    entries
      .filter(entry => entry.isDirectory())
      .map(async entry => {
        const directory = path.join(runsDirectory, entry.name);
        const artifacts = (await readdir(directory, { withFileTypes: true }))
          .filter(item => item.isFile() && !item.name.startsWith("."))
          .map(item => item.name)
          .sort();
        return { runId: entry.name, directory, artifacts };
      })
  );
  return runs.sort((left, right) => right.runId.localeCompare(left.runId));
}
