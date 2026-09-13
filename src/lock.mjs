import { open, mkdir, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AqshNoteError } from "./errors.mjs";
import { ensureDedicatedRuntimeDirectory } from "./runtime-paths.mjs";

function safeLockName(value) {
  const name = String(value ?? "").trim();
  if (!/^[a-z0-9._-]+$/i.test(name)) {
    throw new AqshNoteError("LOCK_NAME_INVALID", "ロック名の形式が不正です。");
  }
  return name;
}

function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

async function currentLock(lockPath) {
  try {
    return JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    return null;
  }
}

async function preserveStaleLock(lockPath) {
  const stalePath = `${lockPath}.stale-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  try {
    await rename(lockPath, stalePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function isRecentFile(filePath, thresholdMs = 30_000) {
  try {
    const details = await stat(filePath);
    return Date.now() - details.mtimeMs < thresholdMs;
  } catch {
    return false;
  }
}

export async function acquireRunLock({ stateDir, name }) {
  const normalizedName = safeLockName(name);
  const ownedStateDir = await ensureDedicatedRuntimeDirectory(stateDir, "state");
  const locksDirectory = path.join(ownedStateDir, "locks");
  const lockPath = path.join(locksDirectory, `${normalizedName}.lock`);
  await mkdir(locksDirectory, { recursive: true, mode: 0o700 });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = randomUUID();
    let handle;
    try {
      handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({
        pid: process.pid,
        token,
        started_at: new Date().toISOString()
      })}\n`, "utf8");
      await handle.close();
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      if (error.code !== "EEXIST") throw error;
      const owner = await currentLock(lockPath);
      if ((owner && isProcessAlive(owner.pid)) || (!owner && await isRecentFile(lockPath))) {
        throw new AqshNoteError(
          "PROFILE_IN_USE",
          "note専用Chromeプロファイルは別のaqsh-noteプロセスが使用中です。",
          { pid: owner?.pid ?? null, started_at: owner?.started_at ?? null }
        );
      }
      await preserveStaleLock(lockPath);
      continue;
    }

    let released = false;
    return {
      path: lockPath,
      async release() {
        if (released) return;
        released = true;
        const owner = await currentLock(lockPath);
        if (owner?.token !== token) return;
        try {
          await unlink(lockPath);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    };
  }

  throw new AqshNoteError("PROFILE_IN_USE", "note専用Chromeプロファイルのロックを取得できませんでした。");
}
