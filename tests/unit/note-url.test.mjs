import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadSut() {
  try {
    return await import(pathToFileURL(path.resolve("src/note-url.mjs")));
  } catch {
    return {};
  }
}

test("parses an Aqsh note article URL and extracts its key", async () => {
  const { parseManagedNoteUrl } = await loadSut();
  assert.equal(typeof parseManagedNoteUrl, "function", "parseManagedNoteUrl must exist");

  const parsed = parseManagedNoteUrl("https://note.com/aqsh/n/n9b5c6afb2521?from=test#body", "aqsh");

  assert.equal(parsed.canonicalUrl, "https://note.com/aqsh/n/n9b5c6afb2521");
  assert.equal(parsed.key, "n9b5c6afb2521");
  assert.equal(parsed.accountId, "aqsh");
});

test("rejects URLs outside the configured account", async () => {
  const { parseManagedNoteUrl } = await loadSut();
  assert.equal(typeof parseManagedNoteUrl, "function", "parseManagedNoteUrl must exist");

  assert.throws(
    () => parseManagedNoteUrl("https://note.com/other/n/n9b5c6afb2521", "aqsh"),
    error => error?.code === "NOTE_ACCOUNT_MISMATCH"
  );
});

test("rejects non-HTTPS, lookalike hosts, and non-article paths", async () => {
  const { parseManagedNoteUrl } = await loadSut();
  assert.equal(typeof parseManagedNoteUrl, "function", "parseManagedNoteUrl must exist");

  assert.throws(() => parseManagedNoteUrl("http://note.com/aqsh/n/n9b5c6afb2521", "aqsh"));
  assert.throws(() => parseManagedNoteUrl("https://note.com.example/aqsh/n/n9b5c6afb2521", "aqsh"));
  assert.throws(() => parseManagedNoteUrl("https://note.com/aqsh", "aqsh"));
  assert.throws(() => parseManagedNoteUrl("https://user:pass@note.com/aqsh/n/n9b5c6afb2521", "aqsh"));
});

test("validates a key supplied without a URL", async () => {
  const { validateNoteKey } = await loadSut();
  assert.equal(typeof validateNoteKey, "function", "validateNoteKey must exist");

  assert.equal(validateNoteKey("n9b5c6afb2521"), "n9b5c6afb2521");
  assert.throws(() => validateNoteKey("../../settings"), error => error?.code === "NOTE_KEY_INVALID");
});
