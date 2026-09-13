import { spawn } from "node:child_process";
import path from "node:path";
import { AqshNoteError } from "../errors.mjs";
import { acquireRunLock } from "../lock.mjs";
import { ensureDedicatedRuntimeDirectory } from "../runtime-paths.mjs";

export function buildManualChromeLaunch({ profileDir, loginUrl }) {
  let url;
  try {
    url = new URL(loginUrl);
  } catch {
    throw new AqshNoteError("MANUAL_LOGIN_URL_FORBIDDEN", "手動ログイン先URLが不正です。");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "note.com" ||
    url.pathname !== "/login" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) {
    throw new AqshNoteError("MANUAL_LOGIN_URL_FORBIDDEN", "手動ログインはnote公式ログイン画面だけを開けます。");
  }
  const resolvedProfile = path.resolve(profileDir);
  return {
    command: "/usr/bin/open",
    args: [
      "-W",
      "-na",
      "Google Chrome",
      "--args",
      `--user-data-dir=${resolvedProfile}`,
      "--no-first-run",
      "--no-default-browser-check",
      url.toString()
    ]
  };
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      child.unref();
      reject(new AqshNoteError(
        "LOGIN_TIMEOUT",
        "手動ログインの待機時間を超えました。専用Chromeを閉じてから再実行してください。"
      ));
    }, timeoutMs);

    const onError = error => {
      cleanup();
      reject(new AqshNoteError("MANUAL_CHROME_LAUNCH_FAILED", "専用Chromeを起動できませんでした。", {
        cause: error.code ?? error.message
      }));
    };
    const onExit = (code, signal) => {
      cleanup();
      if (code === 0) resolve();
      else reject(new AqshNoteError("MANUAL_CHROME_EXITED", "専用Chromeが正常終了しませんでした。", {
        code,
        signal
      }));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("error", onError);
      child.off("exit", onExit);
    };

    child.once("error", onError);
    child.once("exit", onExit);
  });
}

export async function runManualChromeLogin(config, { loginUrl, timeoutMs, onProgress = () => {} }) {
  const lock = await acquireRunLock({ stateDir: config.paths.stateDir, name: "chrome-profile" });
  try {
    await ensureDedicatedRuntimeDirectory(config.paths.profileDir, "profile");
    const launch = buildManualChromeLaunch({ profileDir: config.paths.profileDir, loginUrl });
    onProgress({
      message: "通常モードの専用Chromeを開きました。ログイン完了後、専用Chromeを前面にして⌘Qで終了してください。"
    });
    const child = spawn(launch.command, launch.args, { stdio: "ignore", detached: false });
    await waitForExit(child, timeoutMs);
  } finally {
    await lock.release();
  }
}
