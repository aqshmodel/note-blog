import path from "node:path";
import { chromium } from "playwright";
import { acquireRunLock } from "../lock.mjs";
import { ensureDedicatedRuntimeDirectory } from "../runtime-paths.mjs";
import { assertBrowserRuntime } from "../doctor.mjs";

async function safeScreenshot(page, filePath) {
  if (!page || page.isClosed()) return null;
  try {
    await page.screenshot({ path: filePath, fullPage: false });
    return filePath;
  } catch {
    return null;
  }
}

export function browserArtifactPolicy(action) {
  const contentAction = new Set(["draft", "update", "verify", "inspect"]).has(action);
  return {
    trace: false,
    failureScreenshot: contentAction,
    successScreenshot: contentAction
  };
}

function isNoteKey(value) {
  return /^n[a-z0-9]{8,32}$/i.test(value);
}

export function mayCaptureNoteScreenshot({ action, identityVerified, url, accountId = "aqsh" }) {
  if (!identityVerified || !new Set(["draft", "update", "verify", "inspect"]).has(action)) return false;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (
    parsed.origin !== "https://note.com" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) return false;

  const editMatch = parsed.pathname.match(/^\/notes\/(n[a-z0-9]{8,32})\/edit$/i);
  const publicMatch = parsed.pathname.match(/^\/([^/]+)\/n\/(n[a-z0-9]{8,32})$/i);
  const isNewEditor = parsed.pathname === "/notes/new";
  const isEditPage = Boolean(editMatch && isNoteKey(editMatch[1]));
  const isManagedPublicPage = Boolean(
    publicMatch && publicMatch[1] === accountId && isNoteKey(publicMatch[2])
  );

  if (action === "draft") return isNewEditor || isEditPage;
  if (action === "update") return isEditPage;
  return isEditPage || isManagedPublicPage;
}

export async function withNoteBrowser(config, run, callback) {
  await assertBrowserRuntime(config);
  const lock = await acquireRunLock({ stateDir: config.paths.stateDir, name: "chrome-profile" });
  let context;
  let page;
  let thrownError;
  let identityVerified = false;
  const artifacts = {
    screenshot: null,
    trace: null
  };
  const artifactPolicy = browserArtifactPolicy(run.action);

  try {
    await ensureDedicatedRuntimeDirectory(config.paths.profileDir, "profile");
    const launchOptions = {
      headless: false,
      acceptDownloads: false,
      locale: "ja-JP",
      timezoneId: "Asia/Tokyo"
    };
    if (config.editor.browserChannel === "chrome") launchOptions.channel = "chrome";

    context = await chromium.launchPersistentContext(config.paths.profileDir, launchOptions);
    context.setDefaultTimeout(config.timeouts.actionMs);
    context.setDefaultNavigationTimeout(config.timeouts.navigationMs);
    page = context.pages()[0] ?? await context.newPage();
    for (const candidate of context.pages()) {
      candidate.on("download", download => download.cancel().catch(() => {}));
    }
    context.on("page", candidate => {
      candidate.on("download", download => download.cancel().catch(() => {}));
    });

    const value = await callback({
      context,
      page,
      artifacts,
      markAccountIdentityVerified() {
        identityVerified = true;
      }
    });
    return { value, artifacts };
  } catch (error) {
    if (artifactPolicy.failureScreenshot && mayCaptureNoteScreenshot({
      action: run.action,
      identityVerified,
      url: page && !page.isClosed() ? page.url() : "",
      accountId: config.account.id
    })) {
      artifacts.screenshot = await safeScreenshot(page, path.join(run.directory, "failure.png"));
    }
    thrownError = error;
    throw error;
  } finally {
    if (context) await context.close().catch(() => {});
    await lock.release();
    if (thrownError) thrownError.artifacts = { ...artifacts };
  }
}
