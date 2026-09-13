import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadSut() {
  try {
    return await import(pathToFileURL(path.resolve("src/browser/manual-login.mjs")));
  } catch {
    return {};
  }
}

test("launches a normal Chrome instance with only the dedicated profile", async () => {
  const { buildManualChromeLaunch } = await loadSut();
  assert.equal(typeof buildManualChromeLaunch, "function", "buildManualChromeLaunch must exist");

  const launch = buildManualChromeLaunch({
    profileDir: "/tmp/aqsh-note-profile",
    loginUrl: "https://note.com/login?redirectPath=%2Faqsh"
  });

  assert.equal(launch.command, "/usr/bin/open");
  assert.deepEqual(launch.args.slice(0, 4), ["-W", "-na", "Google Chrome", "--args"]);
  assert.ok(launch.args.includes("--user-data-dir=/tmp/aqsh-note-profile"));
  assert.ok(launch.args.includes("https://note.com/login?redirectPath=%2Faqsh"));
  assert.ok(launch.args.every(value => !/remote-debugging|enable-automation/i.test(value)));
});

test("rejects non-note login destinations", async () => {
  const { buildManualChromeLaunch } = await loadSut();
  assert.equal(typeof buildManualChromeLaunch, "function", "buildManualChromeLaunch must exist");

  assert.throws(
    () => buildManualChromeLaunch({ profileDir: "/tmp/aqsh-note-profile", loginUrl: "https://evil.example/login" }),
    error => error?.code === "MANUAL_LOGIN_URL_FORBIDDEN"
  );
});
