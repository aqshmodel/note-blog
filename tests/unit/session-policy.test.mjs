import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadSut() {
  try {
    return await import(pathToFileURL(path.resolve("src/browser/session.mjs")));
  } catch {
    return {};
  }
}

test("never records a raw Playwright trace for authenticated note actions", async () => {
  const { browserArtifactPolicy } = await loadSut();
  assert.equal(typeof browserArtifactPolicy, "function", "browserArtifactPolicy must exist");

  assert.deepEqual(browserArtifactPolicy("login"), {
    trace: false,
    failureScreenshot: false,
    successScreenshot: false
  });
  assert.deepEqual(browserArtifactPolicy("draft"), {
    trace: false,
    failureScreenshot: true,
    successScreenshot: true
  });
  assert.deepEqual(browserArtifactPolicy("verify"), {
    trace: false,
    failureScreenshot: true,
    successScreenshot: true
  });
  assert.deepEqual(browserArtifactPolicy("unexpected"), {
    trace: false,
    failureScreenshot: false,
    successScreenshot: false
  });
});

test("screenshots require verified identity and an exact editor URL", async () => {
  const { mayCaptureNoteScreenshot } = await loadSut();
  assert.equal(typeof mayCaptureNoteScreenshot, "function", "mayCaptureNoteScreenshot must exist");

  assert.equal(mayCaptureNoteScreenshot({
    action: "draft",
    identityVerified: true,
    url: "https://note.com/notes/new"
  }), true);
  assert.equal(mayCaptureNoteScreenshot({
    action: "update",
    identityVerified: true,
    url: "https://note.com/notes/n9b5c6afb2521/edit"
  }), true);

  for (const unsafe of [
    { action: "draft", identityVerified: false, url: "https://note.com/notes/new" },
    { action: "draft", identityVerified: true, url: "https://note.com/login" },
    { action: "draft", identityVerified: true, url: "https://note.com/signup" },
    { action: "draft", identityVerified: true, url: "https://note.com/settings/account" },
    { action: "draft", identityVerified: true, url: "https://evil.example/notes/new" },
    { action: "draft", identityVerified: true, url: "https://note.com/notes/new?next=/login" },
    { action: "draft", identityVerified: true, url: "https://note.com/notes/new#login" },
    { action: "login", identityVerified: true, url: "https://note.com/notes/new" }
  ]) {
    assert.equal(mayCaptureNoteScreenshot(unsafe), false, JSON.stringify(unsafe));
  }
});
