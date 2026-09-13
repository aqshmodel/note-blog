import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadSut() {
  try {
    return await import(pathToFileURL(path.resolve("src/config.mjs")));
  } catch {
    return {};
  }
}

async function writeConfig(body) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aqsh-note-config-"));
  const configDirectory = path.join(projectRoot, "config");
  await mkdir(configDirectory);
  const configPath = path.join(configDirectory, "note.yaml");
  await writeFile(configPath, body, "utf8");
  return { configPath, projectRoot };
}

function validConfig(overrides = "") {
  return `version: 1
account:
  id: aqsh
  profile_url: https://note.com/aqsh
editor:
  new_url: https://note.com/notes/new
  browser_channel: chrome
  headless: false
paths:
  content_root: .
  profile_dir: ~/.cache/aqsh-note/chrome-profile
  state_dir: ~/.local/state/aqsh-note
security:
  allow_publish: false
${overrides}`;
}

test("loads account configuration and resolves managed paths", async () => {
  const { loadConfig } = await loadSut();
  assert.equal(typeof loadConfig, "function", "loadConfig must exist");
  const { configPath, projectRoot } = await writeConfig(validConfig());

  const config = await loadConfig(configPath);

  assert.equal(config.account.id, "aqsh");
  assert.equal(config.account.profileUrl, "https://note.com/aqsh");
  assert.equal(config.paths.contentRoot, projectRoot);
  assert.equal(config.paths.profileDir, path.join(os.homedir(), ".cache/aqsh-note/chrome-profile"));
  assert.equal(config.security.allowPublish, false);
});

test("rejects any configuration that enables publishing", async () => {
  const { loadConfig } = await loadSut();
  assert.equal(typeof loadConfig, "function", "loadConfig must exist");
  const { configPath } = await writeConfig(validConfig().replace("allow_publish: false", "allow_publish: true"));

  await assert.rejects(() => loadConfig(configPath), error => error?.code === "PUBLISH_FORBIDDEN");
});

test("rejects a profile URL that does not match the account ID", async () => {
  const { loadConfig } = await loadSut();
  assert.equal(typeof loadConfig, "function", "loadConfig must exist");
  const { configPath } = await writeConfig(validConfig().replace("https://note.com/aqsh", "https://note.com/other"));

  await assert.rejects(() => loadConfig(configPath), error => error?.code === "ACCOUNT_PROFILE_MISMATCH");
});

test("cannot retarget this repository away from the Aqsh account", async () => {
  const { loadConfig } = await loadSut();
  assert.equal(typeof loadConfig, "function", "loadConfig must exist");
  const { configPath } = await writeConfig(
    validConfig()
      .replace("id: aqsh", "id: other")
      .replace("https://note.com/aqsh", "https://note.com/other")
  );

  await assert.rejects(() => loadConfig(configPath), error => error?.code === "MANAGED_ACCOUNT_INVALID");
});

test("rejects the daily Chrome user data directory", async () => {
  const { loadConfig } = await loadSut();
  assert.equal(typeof loadConfig, "function", "loadConfig must exist");
  const unsafe = path.join(os.homedir(), "Library/Application Support/Google/Chrome");
  const { configPath } = await writeConfig(
    validConfig().replace("~/.cache/aqsh-note/chrome-profile", unsafe)
  );

  await assert.rejects(() => loadConfig(configPath), error => error?.code === "PROFILE_PATH_UNSAFE");
});

test("rejects existing unrelated directories as runtime storage", async () => {
  const { loadConfig } = await loadSut();
  assert.equal(typeof loadConfig, "function", "loadConfig must exist");

  const unrelatedProfile = await mkdtemp(path.join(os.tmpdir(), "unrelated-profile-"));
  await writeFile(path.join(unrelatedProfile, "personal.txt"), "do not touch\n", "utf8");
  const profile = await writeConfig(
    validConfig().replace("~/.cache/aqsh-note/chrome-profile", unrelatedProfile)
  );
  await assert.rejects(
    () => loadConfig(profile.configPath),
    error => error?.code === "PROFILE_PATH_UNSAFE"
  );

  const unrelatedState = await mkdtemp(path.join(os.tmpdir(), "unrelated-state-"));
  await writeFile(path.join(unrelatedState, "personal.txt"), "do not touch\n", "utf8");
  const state = await writeConfig(
    validConfig().replace("~/.local/state/aqsh-note", unrelatedState)
  );
  await assert.rejects(
    () => loadConfig(state.configPath),
    error => error?.code === "STATE_PATH_UNSAFE"
  );
});

test("rejects account credentials and unexpected editor query data", async () => {
  const { loadConfig } = await loadSut();
  assert.equal(typeof loadConfig, "function", "loadConfig must exist");
  const profile = await writeConfig(
    validConfig().replace("https://note.com/aqsh", "https://user:pass@note.com/aqsh")
  );
  await assert.rejects(() => loadConfig(profile.configPath), error => error?.code === "ACCOUNT_PROFILE_MISMATCH");

  const editor = await writeConfig(
    validConfig().replace("https://note.com/notes/new", "https://note.com/notes/new?unexpected=1")
  );
  await assert.rejects(() => loadConfig(editor.configPath), error => error?.code === "EDITOR_URL_INVALID");
});

test("rejects unknown or credential-like configuration keys recursively", async () => {
  const { loadConfig } = await loadSut();
  assert.equal(typeof loadConfig, "function", "loadConfig must exist");
  const cases = [
    validConfig().replace("  profile_url: https://note.com/aqsh", "  profile_url: https://note.com/aqsh\n  password: CONFIG_PASSWORD_SECRET"),
    validConfig().replace("  headless: false", "  headless: false\n  storage_state: CONFIG_STORAGE_SECRET"),
    `${validConfig()}cookie: CONFIG_COOKIE_SECRET\n`,
    validConfig().replace("  allow_publish: false", "  allow_publish: false\n  unexpected_flag: true")
  ];

  for (const body of cases) {
    const { configPath } = await writeConfig(body);
    await assert.rejects(
      () => loadConfig(configPath),
      error => error?.code === "CONFIG_KEY_UNSUPPORTED" && !/CONFIG_.*_SECRET/.test(error.message)
    );
  }
});

test("rejects unknown inline image strategies instead of treating typos as verified", async () => {
  const { loadConfig } = await loadSut();
  assert.equal(typeof loadConfig, "function", "loadConfig must exist");
  const invalid = await writeConfig(
    validConfig().replace("headless: false", "headless: false\n  inline_image_strategy: unverifed")
  );

  await assert.rejects(
    () => loadConfig(invalid.configPath),
    error => error?.code === "INLINE_IMAGE_STRATEGY_INVALID"
  );
});

test("rejects Chromium until manual login and verification use the same browser", async () => {
  const { loadConfig } = await loadSut();
  assert.equal(typeof loadConfig, "function", "loadConfig must exist");
  const invalid = await writeConfig(validConfig().replace("browser_channel: chrome", "browser_channel: chromium"));

  await assert.rejects(
    () => loadConfig(invalid.configPath),
    error => error?.code === "BROWSER_CHANNEL_UNSUPPORTED"
  );
});

test("rejects runtime state and browser profiles stored inside the Git project", async () => {
  const { loadConfig } = await loadSut();
  assert.equal(typeof loadConfig, "function", "loadConfig must exist");

  const stateInside = await writeConfig(
    validConfig().replace("~/.local/state/aqsh-note", ".aqsh-note/state")
  );
  await assert.rejects(
    () => loadConfig(stateInside.configPath),
    error => error?.code === "RUNTIME_PATH_INSIDE_PROJECT"
  );

  const profileInside = await writeConfig(
    validConfig().replace("~/.cache/aqsh-note/chrome-profile", ".aqsh-note/chrome-profile")
  );
  await assert.rejects(
    () => loadConfig(profileInside.configPath),
    error => error?.code === "RUNTIME_PATH_INSIDE_PROJECT"
  );
});

test("rejects runtime paths that contain the project or overlap each other", async () => {
  const { loadConfig } = await loadSut();
  assert.equal(typeof loadConfig, "function", "loadConfig must exist");

  const ancestor = await writeConfig(validConfig());
  await writeFile(
    ancestor.configPath,
    validConfig().replace("~/.local/state/aqsh-note", path.dirname(ancestor.projectRoot)),
    "utf8"
  );
  await assert.rejects(
    () => loadConfig(ancestor.configPath),
    error => error?.code === "RUNTIME_PATH_OVERLAPS_PROJECT"
  );

  const shared = await writeConfig(
    validConfig().replace("~/.local/state/aqsh-note", "~/.cache/aqsh-note/chrome-profile")
  );
  await assert.rejects(
    () => loadConfig(shared.configPath),
    error => error?.code === "RUNTIME_PATH_OVERLAP"
  );
});

test("rejects a content root outside this project", async () => {
  const { loadConfig } = await loadSut();
  assert.equal(typeof loadConfig, "function", "loadConfig must exist");
  const fixture = await writeConfig(validConfig());
  const unrelated = await mkdtemp(path.join(os.tmpdir(), "aqsh-note-unrelated-content-"));
  await writeFile(
    fixture.configPath,
    validConfig().replace("content_root: .", `content_root: ${JSON.stringify(unrelated)}`),
    "utf8"
  );

  await assert.rejects(
    () => loadConfig(fixture.configPath),
    error => error?.code === "CONTENT_ROOT_OUTSIDE_PROJECT"
  );
});
