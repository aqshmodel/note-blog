import assert from "node:assert/strict";
import { mkdtemp, readdir, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadSut() {
  try {
    return await import(pathToFileURL(path.resolve("src/lock.mjs")));
  } catch {
    return {};
  }
}

async function newStateDirectory(prefix) {
  const parent = await mkdtemp(path.join(os.tmpdir(), prefix));
  return path.join(parent, "state");
}

async function claimStateDirectory(stateDir) {
  const { ensureDedicatedRuntimeDirectory } = await import(
    pathToFileURL(path.resolve("src/runtime-paths.mjs"))
  );
  await ensureDedicatedRuntimeDirectory(stateDir, "state");
}

test("prevents concurrent use of the dedicated Chrome profile", async () => {
  const { acquireRunLock } = await loadSut();
  assert.equal(typeof acquireRunLock, "function", "acquireRunLock must exist");
  const stateDir = await newStateDirectory("aqsh-note-lock-");
  const first = await acquireRunLock({ stateDir, name: "chrome-profile" });

  await assert.rejects(
    () => acquireRunLock({ stateDir, name: "chrome-profile" }),
    error => error?.code === "PROFILE_IN_USE"
  );

  await first.release();
  const second = await acquireRunLock({ stateDir, name: "chrome-profile" });
  await second.release();
});

test("preserves a stale lock as an audit artifact before recovering", async () => {
  const { acquireRunLock } = await loadSut();
  assert.equal(typeof acquireRunLock, "function", "acquireRunLock must exist");
  const stateDir = await newStateDirectory("aqsh-note-stale-lock-");
  await claimStateDirectory(stateDir);
  const locksDir = path.join(stateDir, "locks");
  await mkdir(locksDir, { recursive: true });
  await writeFile(
    path.join(locksDir, "chrome-profile.lock"),
    JSON.stringify({ pid: 2147483647, token: "stale", started_at: "2026-01-01T00:00:00.000Z" }),
    "utf8"
  );

  const lock = await acquireRunLock({ stateDir, name: "chrome-profile" });
  const entries = await readdir(locksDir);

  assert.ok(entries.some(name => name.startsWith("chrome-profile.lock.stale-")));
  await lock.release();
});

test("treats a newly-created incomplete lock as active instead of stealing it", async () => {
  const { acquireRunLock } = await loadSut();
  assert.equal(typeof acquireRunLock, "function", "acquireRunLock must exist");
  const stateDir = await newStateDirectory("aqsh-note-partial-lock-");
  await claimStateDirectory(stateDir);
  const locksDir = path.join(stateDir, "locks");
  await mkdir(locksDir, { recursive: true });
  await writeFile(path.join(locksDir, "chrome-profile.lock"), "", "utf8");

  await assert.rejects(
    () => acquireRunLock({ stateDir, name: "chrome-profile" }),
    error => error?.code === "PROFILE_IN_USE"
  );
});
