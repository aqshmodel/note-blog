import { AqshNoteError } from "../errors.mjs";

export function classifyAuthentication(observation) {
  let url;
  try {
    url = new URL(observation?.url);
  } catch {
    throw new AqshNoteError("AUTH_ORIGIN_INVALID", "ログイン状態の確認先URLが不正です。");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "note.com" ||
    url.port ||
    url.username ||
    url.password
  ) {
    throw new AqshNoteError("AUTH_ORIGIN_INVALID", "note.com以外ではログイン状態を判定しません。");
  }

  if (url.pathname === "/login" || url.pathname.startsWith("/signup")) {
    return { authenticated: false, reason: "login_page" };
  }
  if (Number(observation.loginLinkCount ?? 0) > 0) {
    return { authenticated: false, reason: "login_control_present" };
  }
  if (Number(observation.postControlCount ?? 0) > 0) {
    return { authenticated: true, reason: "post_control_present" };
  }
  if (Number(observation.newArticleLinkCount ?? 0) > 0) {
    return { authenticated: true, reason: "new_article_control_present" };
  }
  return { authenticated: false, reason: "authentication_unconfirmed" };
}

export function nextLoginStep(authentication) {
  return authentication?.authenticated === true ? "complete" : "manual";
}

function normalizeUiText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function summarizeNoteIdFields(fields, expectedAccountId) {
  const noteIdFields = (Array.isArray(fields) ? fields : []).filter(field => (
    field?.name === "urlname" && normalizeUiText(field?.ariaLabel) === "note ID"
  ));
  return {
    noteIdFieldCount: noteIdFields.length,
    matchingNoteIdFieldCount: noteIdFields.filter(field => (
      normalizeUiText(field.value) === expectedAccountId
    )).length
  };
}

export function classifyAccountIdentity(observation) {
  let url;
  try {
    url = new URL(observation?.url);
  } catch {
    throw new AqshNoteError("AUTH_ORIGIN_INVALID", "アカウント確認先URLが不正です。");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "note.com" ||
    url.port ||
    url.username ||
    url.password
  ) {
    throw new AqshNoteError("AUTH_ORIGIN_INVALID", "note.com以外ではアカウントを判定しません。");
  }

  if (url.pathname === "/login" || url.pathname.startsWith("/signup")) {
    return { authenticated: false, reason: "account_settings_login_required" };
  }
  if (url.pathname !== "/settings/account/note_id" || url.search || url.hash) {
    return { authenticated: false, reason: "account_settings_unconfirmed" };
  }

  const noteIdFieldCount = Number(observation.noteIdFieldCount ?? 0);
  const matchingNoteIdFieldCount = Number(observation.matchingNoteIdFieldCount ?? 0);
  if (noteIdFieldCount === 1 && matchingNoteIdFieldCount === 1) {
    return { authenticated: true, reason: "account_identity_verified" };
  }
  if (noteIdFieldCount === 1) {
    return { authenticated: false, reason: "account_identity_mismatch" };
  }
  if (noteIdFieldCount > 1) {
    return { authenticated: false, reason: "account_identity_ambiguous" };
  }
  return { authenticated: false, reason: "account_identity_unconfirmed" };
}

export async function observeAuthentication(page) {
  const currentUrl = page.url();
  let origin;
  try {
    origin = new URL(currentUrl).origin;
  } catch {
    return { authenticated: false, reason: "navigation_in_progress" };
  }
  if (origin !== "https://note.com") {
    return { authenticated: false, reason: "external_auth_flow" };
  }

  const [newArticleLinkCount, postButtonCount, postLinkCount, loginLinkCount] = await Promise.all([
    page.locator('a[href="/notes/new"], a[href^="/notes/new?"]').count(),
    page.getByRole("button", { name: /^投稿(?:$|\s)/ }).count(),
    page.getByRole("link", { name: /^投稿(?:$|\s)/ }).count(),
    page.locator('a[href="/login"], a[href^="/login?"]').count()
  ]);
  return classifyAuthentication({
    url: currentUrl,
    newArticleLinkCount,
    postControlCount: postButtonCount + postLinkCount,
    loginLinkCount
  });
}

export async function observeAccountIdentity(page, { expectedAccountId }) {
  if (typeof expectedAccountId !== "string" || !/^[a-z0-9_-]+$/i.test(expectedAccountId)) {
    throw new AqshNoteError("ACCOUNT_ID_INVALID", "確認対象のnote IDが不正です。");
  }

  const currentUrl = page.url();
  let origin;
  try {
    origin = new URL(currentUrl).origin;
  } catch {
    return { authenticated: false, reason: "navigation_in_progress" };
  }
  if (origin !== "https://note.com") {
    return { authenticated: false, reason: "external_auth_flow" };
  }

  let observation;
  try {
    const fields = await page.evaluate(() => {
      const visible = element => {
        const style = globalThis.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      };
      return Array.from(document.querySelectorAll('input[name="urlname"][aria-label="note ID"]'))
        .filter(visible)
        .map(element => ({
          name: element.getAttribute("name"),
          ariaLabel: element.getAttribute("aria-label"),
          value: element.value
        }));
    });
    observation = summarizeNoteIdFields(fields, expectedAccountId);
  } catch (error) {
    if (/(Execution context was destroyed|most likely because of a navigation|Cannot find context with specified id)/i.test(String(error?.message ?? error))) {
      return { authenticated: false, reason: "navigation_in_progress" };
    }
    throw error;
  }

  return classifyAccountIdentity({ url: currentUrl, ...observation });
}

export async function waitForAuthenticationEvidence(page, options = {}) {
  const timeoutMs = Number(options.timeoutMs ?? 5_000);
  const pollMs = Number(options.pollMs ?? 250);
  const observe = options.observe ?? observeAuthentication;
  const pendingReasons = new Set(options.pendingReasons ?? [
    "navigation_in_progress",
    "authentication_unconfirmed",
    "account_identity_unconfirmed",
    "account_settings_unconfirmed"
  ]);
  const startedAt = Date.now();
  let state = { authenticated: false, reason: "not_checked" };

  while (Date.now() - startedAt < timeoutMs) {
    if (page.isClosed()) {
      throw new AqshNoteError("LOGIN_BROWSER_CLOSED", "ログイン確認前にブラウザが閉じられました。");
    }
    state = await observe(page);
    if (state.authenticated || !pendingReasons.has(state.reason)) return state;
    const remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) break;
    await page.waitForTimeout(Math.min(pollMs, remaining));
  }
  return state;
}

export async function waitForManualLogin(page, { timeoutMs, pollMs = 1_000, onProgress = () => {} }) {
  const startedAt = Date.now();
  let lastReason = "not_checked";
  while (Date.now() - startedAt < timeoutMs) {
    if (page.isClosed()) {
      throw new AqshNoteError("LOGIN_BROWSER_CLOSED", "ログイン確認前にブラウザが閉じられました。");
    }
    const state = await observeAuthentication(page);
    if (state.authenticated) return state;
    if (state.reason !== lastReason) {
      lastReason = state.reason;
      onProgress(state);
    }
    await page.waitForTimeout(Math.min(pollMs, Math.max(1, timeoutMs - (Date.now() - startedAt))));
  }
  throw new AqshNoteError("LOGIN_TIMEOUT", "制限時間内にnoteのログイン状態を確認できませんでした。", {
    lastReason
  });
}
