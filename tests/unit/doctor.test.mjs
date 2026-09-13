import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadSut() {
  try {
    return await import(pathToFileURL(path.resolve("src/doctor.mjs")));
  } catch {
    return {};
  }
}

test("fails closed on a host that cannot run the configured manual login", async () => {
  const { browserRequirementForPlatform } = await loadSut();
  assert.equal(typeof browserRequirementForPlatform, "function", "browserRequirementForPlatform must exist");

  assert.deepEqual(
    browserRequirementForPlatform({ platform: "linux", browserChannel: "chrome", chromeExists: false }),
    {
      status: "fail",
      message: "HOST_UNSUPPORTED: note運用コマンドはmacOSホストで実行してください。"
    }
  );
  assert.equal(
    browserRequirementForPlatform({ platform: "darwin", browserChannel: "chrome", chromeExists: false }).status,
    "fail"
  );
});

test("the shared browser runtime gate requires Node 24, macOS, Chrome, publishing off, and managed Git", async () => {
  const { assertBrowserRuntime } = await loadSut();
  assert.equal(typeof assertBrowserRuntime, "function", "assertBrowserRuntime must exist");
  const config = {
    editor: { browserChannel: "chrome" },
    security: { allowPublish: false }
  };
  let gitChecks = 0;
  const checkGit = async () => {
    gitChecks += 1;
    return { ok: true };
  };

  await assert.doesNotReject(() => assertBrowserRuntime(config, {
    nodeMajor: 24,
    platform: "darwin",
    chromeExists: true,
    checkGit
  }));
  assert.equal(gitChecks, 1);

  for (const [overrides, code] of [
    [{ nodeMajor: 20 }, "NODE_UNSUPPORTED"],
    [{ platform: "linux" }, "HOST_UNSUPPORTED"],
    [{ chromeExists: false }, "CHROME_NOT_FOUND"]
  ]) {
    await assert.rejects(
      () => assertBrowserRuntime(config, {
        nodeMajor: 24,
        platform: "darwin",
        chromeExists: true,
        checkGit,
        ...overrides
      }),
      error => error?.code === code
    );
  }

  await assert.rejects(
    () => assertBrowserRuntime({ ...config, security: { allowPublish: true } }, {
      nodeMajor: 24,
      platform: "darwin",
      chromeExists: true,
      checkGit
    }),
    error => error?.code === "PUBLISH_FORBIDDEN"
  );
});
