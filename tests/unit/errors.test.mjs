import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadSut() {
  try {
    return await import(pathToFileURL(path.resolve("src/errors.mjs")));
  } catch {
    return {};
  }
}

test("keeps intentional Aqsh errors but hides unexpected browser logs", async () => {
  const { AqshNoteError, toPublicError } = await loadSut();
  assert.equal(typeof toPublicError, "function", "toPublicError must exist");

  assert.deepEqual(
    toPublicError(new AqshNoteError("KNOWN", "利用者向けメッセージ")),
    { code: "KNOWN", message: "利用者向けメッセージ" }
  );

  const unexpected = toPublicError(
    new Error("browser launch failed\nCookie: session-secret\nSet-Cookie: auth-secret"),
    { fallbackCode: "LOGIN_FAILED", fallbackMessage: "ログイン確認に失敗しました。" }
  );
  assert.deepEqual(unexpected, {
    code: "LOGIN_FAILED",
    message: "ログイン確認に失敗しました。"
  });
  assert.doesNotMatch(JSON.stringify(unexpected), /session-secret|auth-secret/);
});

test("maps a dedicated-profile collision to a concise recovery message", async () => {
  const { toPublicError } = await loadSut();
  assert.equal(typeof toPublicError, "function", "toPublicError must exist");
  const result = toPublicError(
    new Error("browserType.launchPersistentContext: 既存のブラウザ セッションで開いています\n<launching> lots of logs"),
    { fallbackCode: "LOGIN_FAILED", fallbackMessage: "ログイン確認に失敗しました。" }
  );

  assert.equal(result.code, "PROFILE_BROWSER_STILL_RUNNING");
  assert.doesNotMatch(result.message, /launchPersistentContext|<launching>/);
});
