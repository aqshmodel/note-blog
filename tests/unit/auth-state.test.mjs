import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadSut() {
  try {
    return await import(pathToFileURL(path.resolve("src/browser/auth-state.mjs")));
  } catch {
    return {};
  }
}

test("recognizes an authenticated Aqsh page without exposing session data", async () => {
  const { classifyAuthentication } = await loadSut();
  assert.equal(typeof classifyAuthentication, "function", "classifyAuthentication must exist");

  assert.deepEqual(
    classifyAuthentication({
      url: "https://note.com/aqsh",
      newArticleLinkCount: 1,
      loginLinkCount: 0
    }),
    { authenticated: true, reason: "new_article_control_present" }
  );

  assert.deepEqual(
    classifyAuthentication({
      url: "https://note.com/aqsh",
      newArticleLinkCount: 0,
      postControlCount: 1,
      loginLinkCount: 0
    }),
    { authenticated: true, reason: "post_control_present" }
  );
});

test("does not treat the login page or a page with login controls as authenticated", async () => {
  const { classifyAuthentication } = await loadSut();
  assert.equal(typeof classifyAuthentication, "function", "classifyAuthentication must exist");

  assert.deepEqual(
    classifyAuthentication({
      url: "https://note.com/login?redirectPath=%2Faqsh",
      newArticleLinkCount: 0,
      loginLinkCount: 1
    }),
    { authenticated: false, reason: "login_page" }
  );
  assert.deepEqual(
    classifyAuthentication({
      url: "https://note.com/aqsh",
      newArticleLinkCount: 0,
      loginLinkCount: 1
    }),
    { authenticated: false, reason: "login_control_present" }
  );
});

test("rejects authentication observations from outside note.com", async () => {
  const { classifyAuthentication } = await loadSut();
  assert.equal(typeof classifyAuthentication, "function", "classifyAuthentication must exist");

  assert.throws(
    () => classifyAuthentication({ url: "https://note.com.example/aqsh", newArticleLinkCount: 1 }),
    error => error?.code === "AUTH_ORIGIN_INVALID"
  );
});

test("skips manual login when the dedicated profile is already authenticated", async () => {
  const { nextLoginStep } = await loadSut();
  assert.equal(typeof nextLoginStep, "function", "nextLoginStep must exist");

  assert.equal(nextLoginStep({ authenticated: true }), "complete");
  assert.equal(nextLoginStep({ authenticated: false }), "manual");
});

test("binds a login session to the configured note ID on the narrow note-ID page", async () => {
  const { classifyAccountIdentity } = await loadSut();
  assert.equal(typeof classifyAccountIdentity, "function", "classifyAccountIdentity must exist");

  assert.deepEqual(
    classifyAccountIdentity({
      url: "https://note.com/settings/account/note_id",
      noteIdFieldCount: 1,
      matchingNoteIdFieldCount: 1
    }),
    { authenticated: true, reason: "account_identity_verified" }
  );

  assert.deepEqual(
    classifyAccountIdentity({
      url: "https://note.com/settings/account/note_id",
      noteIdFieldCount: 1,
      matchingNoteIdFieldCount: 0
    }),
    { authenticated: false, reason: "account_identity_mismatch" }
  );

  assert.deepEqual(
    classifyAccountIdentity({
      url: "https://note.com/settings/account/note_id",
      noteIdFieldCount: 2,
      matchingNoteIdFieldCount: 1
    }),
    { authenticated: false, reason: "account_identity_ambiguous" }
  );
});

test("does not accept a login redirect as account identity evidence", async () => {
  const { classifyAccountIdentity } = await loadSut();
  assert.equal(typeof classifyAccountIdentity, "function", "classifyAccountIdentity must exist");

  assert.deepEqual(
    classifyAccountIdentity({
      url: "https://note.com/login?redirectPath=https%3A%2F%2Fnote.com%2Fsettings%2Faccount%2Fnote_id",
      noteIdFieldCount: 0,
      matchingNoteIdFieldCount: 0
    }),
    { authenticated: false, reason: "account_settings_login_required" }
  );
});

test("does not confuse unrelated aqsh text with the note ID field", async () => {
  const { summarizeNoteIdFields } = await loadSut();
  assert.equal(typeof summarizeNoteIdFields, "function", "summarizeNoteIdFields must exist");

  assert.deepEqual(
    summarizeNoteIdFields([
      { name: "urlname", ariaLabel: "note ID", value: "other" },
      { name: "unrelated", ariaLabel: "note ID", value: "aqsh" }
    ], "aqsh"),
    { noteIdFieldCount: 1, matchingNoteIdFieldCount: 0 }
  );
});

test("waits through client-side hydration until authentication evidence appears", async () => {
  const { waitForAuthenticationEvidence } = await loadSut();
  assert.equal(typeof waitForAuthenticationEvidence, "function", "waitForAuthenticationEvidence must exist");
  const states = [
    { authenticated: false, reason: "authentication_unconfirmed" },
    { authenticated: true, reason: "post_control_present" }
  ];
  const page = {
    isClosed: () => false,
    waitForTimeout: async () => {}
  };

  const result = await waitForAuthenticationEvidence(page, {
    timeoutMs: 100,
    pollMs: 1,
    observe: async () => states.shift() ?? states.at(-1)
  });

  assert.deepEqual(result, { authenticated: true, reason: "post_control_present" });
});

test("treats an account-settings redirect race as navigation in progress", async () => {
  const { observeAccountIdentity } = await loadSut();
  assert.equal(typeof observeAccountIdentity, "function", "observeAccountIdentity must exist");
  const page = {
    url: () => "https://note.com/settings/account/note_id",
    evaluate: async () => {
      throw new Error("page.evaluate: Execution context was destroyed, most likely because of a navigation");
    }
  };

  assert.deepEqual(
    await observeAccountIdentity(page, { expectedAccountId: "aqsh" }),
    { authenticated: false, reason: "navigation_in_progress" }
  );
});
