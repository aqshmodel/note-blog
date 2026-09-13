import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRunContext, writeRunResult } from "../state.mjs";
import { assertAllowedNoteNavigation } from "../browser/safety.mjs";
import {
  nextLoginStep,
  observeAccountIdentity,
  waitForAuthenticationEvidence
} from "../browser/auth-state.mjs";
import { withNoteBrowser } from "../browser/session.mjs";
import { runManualChromeLogin } from "../browser/manual-login.mjs";
import { AqshNoteError, toPublicError } from "../errors.mjs";
import { ensureDedicatedRuntimeDirectory } from "../runtime-paths.mjs";
import { assertBrowserRuntime } from "../doctor.mjs";

function loginUrl(accountId) {
  return `https://note.com/login?redirectPath=%2F${encodeURIComponent(accountId)}`;
}

async function writeLoginObservation(config, result) {
  const stateDir = await ensureDedicatedRuntimeDirectory(config.paths.stateDir, "state");
  const target = path.join(stateDir, "login-confirmed.json");
  const temporary = path.join(stateDir, `.login-confirmed-${process.pid}.tmp`);
  await writeFile(temporary, `${JSON.stringify({
    account: config.account.id,
    profile_url: config.account.profileUrl,
    checked_at: result.checked_at
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

export async function runLogin(config, { timeoutMinutes = 5, onProgress = () => {} } = {}) {
  await assertBrowserRuntime(config);
  const run = await createRunContext({
    stateDir: config.paths.stateDir,
    action: "login",
    articleId: config.account.id
  });
  const targetUrl = assertAllowedNoteNavigation(loginUrl(config.account.id), {
    accountId: config.account.id,
    purpose: "login"
  });

  const verifyDedicatedProfile = () => withNoteBrowser(config, run, async ({ page }) => {
      const accountSettingsUrl = assertAllowedNoteNavigation("https://note.com/settings/account/note_id", {
        accountId: config.account.id,
        purpose: "account-settings"
      });
      await page.goto(accountSettingsUrl, { waitUntil: "domcontentloaded" });
      const confirmation = await waitForAuthenticationEvidence(page, {
        timeoutMs: config.timeouts.actionMs,
        observe: currentPage => observeAccountIdentity(currentPage, {
          expectedAccountId: config.account.id
        })
      });
      return confirmation;
    });

  const assertIdentityIsSafe = confirmation => {
    if (confirmation.reason === "account_identity_mismatch") {
      throw new AqshNoteError(
        "ACCOUNT_IDENTITY_MISMATCH",
        "note専用Chromeはaqsh以外のアカウントでログインしています。"
      );
    }
    if (confirmation.reason === "account_identity_ambiguous") {
      throw new AqshNoteError(
        "ACCOUNT_IDENTITY_AMBIGUOUS",
        "アカウント設定のnote IDを一意に確認できないため停止しました。"
      );
    }
  };

  try {
    onProgress({ message: "保存済みのnote専用プロファイルを確認しています。" });
    let browserRun = await verifyDedicatedProfile();
    assertIdentityIsSafe(browserRun.value);

    if (nextLoginStep(browserRun.value) === "manual") {
      onProgress({
        message: "初回ログインは自動操作フラグのない専用Chromeで行います。通常Chromeのprofileは使用しません。"
      });
      await runManualChromeLogin(config, {
        loginUrl: targetUrl,
        timeoutMs: timeoutMinutes * 60_000,
        onProgress
      });
      browserRun = await verifyDedicatedProfile();
    }
    assertIdentityIsSafe(browserRun.value);

    if (!browserRun.value.authenticated) {
      throw new AqshNoteError(
        "LOGIN_RECHECK_FAILED",
        "アカウント設定画面でAqshのログイン状態を再確認できませんでした。",
        { reason: browserRun.value.reason }
      );
    }

    const result = {
      status: "success",
      action: "login",
      run_id: run.runId,
      account: config.account.id,
      profile_url: config.account.profileUrl,
      checked_at: new Date().toISOString(),
      message: "Aqshのログイン状態を確認しました。Cookie値は表示・個別出力せず、Git外の専用profile内だけに保持します。",
      artifacts: browserRun.artifacts,
      published: false
    };
    await writeLoginObservation(config, result);
    await writeRunResult(run, result);
    return { exitCode: 0, result };
  } catch (error) {
    const publicError = toPublicError(error, {
      fallbackCode: "LOGIN_FAILED",
      fallbackMessage: "ログイン状態の確認に失敗しました。ブラウザの生ログは個別出力せず停止しました。"
    });
    const result = {
      status: "failed",
      action: "login",
      run_id: run.runId,
      account: config.account.id,
      code: publicError.code,
      message: publicError.message,
      reason: error instanceof AqshNoteError ? error.details?.reason : undefined,
      artifacts: error.artifacts ?? {},
      published: false
    };
    await writeRunResult(run, result);
    return { exitCode: 1, result };
  }
}
