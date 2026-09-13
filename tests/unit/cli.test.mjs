import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const cliPath = path.resolve("bin/aqsh-note.mjs");

async function makeProject({ gitOrigin = "https://github.com/aqshmodel/note-blog.git" } = {}) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aqsh-note-cli-"));
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "aqsh-note-cli-runtime-"));
  await mkdir(path.join(projectRoot, "config"));
  await mkdir(path.join(projectRoot, "articles", "example"), { recursive: true });
  const stateDir = path.join(runtimeRoot, "state");
  const profileDir = path.join(runtimeRoot, "profile");
  const configPath = path.join(projectRoot, "config", "note.yaml");
  const articlePath = path.join(projectRoot, "articles", "example", "article.md");

  await writeFile(configPath, `version: 1
account:
  id: aqsh
  profile_url: https://note.com/aqsh
editor:
  new_url: https://note.com/notes/new
  browser_channel: chrome
  headless: false
paths:
  content_root: .
  profile_dir: ${JSON.stringify(profileDir)}
  state_dir: ${JSON.stringify(stateDir)}
security:
  allow_publish: false
`, "utf8");
  await writeFile(articlePath, `---
id: aqsh-example
title: "CLIテスト"
status: draft
seo:
  primary_keyword: "note 自動化"
cta:
  enabled: false
---
# CLIテスト

これはブラウザを起動しないdry-run用の記事です。
`, "utf8");
  if (gitOrigin !== null) {
    const init = spawnSync("git", ["init", "-q"], { cwd: projectRoot, encoding: "utf8" });
    assert.equal(init.status, 0, init.stderr);
    const remote = spawnSync("git", ["remote", "add", "origin", gitOrigin], {
      cwd: projectRoot,
      encoding: "utf8"
    });
    assert.equal(remote.status, 0, remote.stderr);
  }
  return { projectRoot, configPath, articlePath, stateDir };
}

async function bindArticle(project, key = "n9b5c6afb2521") {
  const source = await readFile(project.articlePath, "utf8");
  await writeFile(
    project.articlePath,
    source.replace(
      "status: draft",
      `status: draft\nnote:\n  key: ${key}\n  last_synced_at: "2020-01-01T00:00:00.000Z"`
    ),
    "utf8"
  );
}

function readObservation(overrides = {}) {
  return {
    accountId: "aqsh",
    url: "https://editor.note.com/notes/n9b5c6afb2521/edit/",
    title: "CLIテスト",
    text: "これはブラウザを起動しないdry-run用の記事です。",
    structure: [{
      type: "element",
      tag: "p",
      attrs: {},
      children: [{ type: "text", value: "これはブラウザを起動しないdry-run用の記事です。" }]
    }],
    h2: [],
    h3: [],
    imageCount: 0,
    saveControlName: "下書き保存",
    publishControlName: "公開に進む",
    mutated: false,
    ...overrides
  };
}

test("dry-run returns machine-readable results and never publishes", async () => {
  const project = await makeProject();
  const result = spawnSync(
    process.execPath,
    [cliPath, "dry-run", project.articlePath, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "success");
  assert.equal(output.action, "dry-run");
  assert.equal(output.intended_action, "draft");
  assert.equal(output.account, "aqsh");
  assert.equal(output.article.title, "CLIテスト");
  assert.equal(output.browser_launched, false);
  assert.equal(output.git_verified, true);
  assert.equal(output.published, false);
  assert.match(output.run_id, /^\d{8}-\d{6}-aqsh-example$/);
});

test("dry-run surfaces a validated update target", async () => {
  const project = await makeProject();
  const source = await (await import("node:fs/promises")).readFile(project.articlePath, "utf8");
  await writeFile(
    project.articlePath,
    source.replace("status: draft", "status: draft\nnote:\n  key: n9b5c6afb2521"),
    "utf8"
  );
  const result = spawnSync(
    process.execPath,
    [cliPath, "dry-run", project.articlePath, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.intended_action, "update");
});

test("doctor reports the account and hard publish safeguard", async () => {
  const project = await makeProject({ gitOrigin: null });
  const result = spawnSync(
    process.execPath,
    [cliPath, "doctor", "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 1, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.action, "doctor");
  assert.equal(output.account, "aqsh");
  assert.equal(output.published, false);
  assert.ok(output.checks.some(check => check.id === "publish_guard" && check.status === "pass"));
  assert.ok(output.checks.some(check => check.id === "node" && check.status === "pass"));
  assert.ok(output.checks.some(check => (
    check.id === "browser" && check.status === (process.platform === "darwin" ? "pass" : "fail")
  )));
  assert.ok(output.checks.some(check => check.id === "git_repository" && check.status === "fail"));
  assert.ok(output.checks.some(check => check.id === "git_origin" && check.status === "fail"));
});

test("dry-run blocks a project with the wrong Git origin", async () => {
  const project = await makeProject({ gitOrigin: "https://github.com/example/not-aqsh-note.git" });
  const result = spawnSync(
    process.execPath,
    [cliPath, "dry-run", project.articlePath, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 1, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.code, "GIT_SOURCE_UNVERIFIED");
  assert.equal(output.published, false);
});

test("dry-run rejects an outside article before reading or reflecting its contents", async () => {
  const project = await makeProject();
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "aqsh-note-outside-"));
  const outsidePath = path.join(outsideRoot, "OUTSIDE_PATH_SECRET.md");
  await writeFile(outsidePath, `---
id: outside-secret
title: "OUTSIDE_SECRET_TITLE"
status: draft
---
# OUTSIDE_SECRET_TITLE

OUTSIDE_SECRET_BODY
`, "utf8");

  const result = spawnSync(
    process.execPath,
    [cliPath, "dry-run", outsidePath, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 1, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.code, "ARTICLE_OUTSIDE_CONTENT_ROOT");
  assert.equal(output.published, false);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /OUTSIDE_PATH_SECRET|OUTSIDE_SECRET_TITLE|OUTSIDE_SECRET_BODY|at file:/);
});

test("dry-run rejects an in-root symlink to an outside article before reading it", async () => {
  const project = await makeProject();
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "aqsh-note-symlink-outside-"));
  const outsidePath = path.join(outsideRoot, "article.md");
  const linkedPath = path.join(project.projectRoot, "articles", "SYMLINK_PATH_SECRET.md");
  await writeFile(outsidePath, `---
id: symlink-secret
title: "SYMLINK_SECRET_TITLE"
status: draft
---
# SYMLINK_SECRET_TITLE

SYMLINK_SECRET_BODY
`, "utf8");
  await symlink(outsidePath, linkedPath);

  const result = spawnSync(
    process.execPath,
    [cliPath, "dry-run", linkedPath, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 1, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.code, "ARTICLE_OUTSIDE_CONTENT_ROOT");
  assert.equal(output.published, false);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /SYMLINK_PATH_SECRET|SYMLINK_SECRET_TITLE|SYMLINK_SECRET_BODY|at file:/);
});

test("missing articles return one sanitized JSON result without a stack", async () => {
  const project = await makeProject();
  const missingPath = path.join(project.projectRoot, "articles", "MISSING_PATH_SECRET.md");
  const result = spawnSync(
    process.execPath,
    [cliPath, "dry-run", missingPath, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 1, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.code, "ARTICLE_NOT_FOUND");
  assert.equal(output.published, false);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /MISSING_PATH_SECRET|AqshNoteError|at file:/);
});

test("recover I/O failures return one sanitized JSON result without a stack", async () => {
  const project = await makeProject();
  await mkdir(project.stateDir, { recursive: true });
  await writeFile(path.join(project.stateDir, ".aqsh-note-state"), "aqsh-note:state:v1\n", "utf8");
  await writeFile(path.join(project.stateDir, "runs"), "STATE_IO_SECRET", "utf8");
  const result = spawnSync(
    process.execPath,
    [cliPath, "recover", "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 1, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.code, "UNEXPECTED_ERROR");
  assert.equal(output.published, false);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /STATE_IO_SECRET|ENOTDIR|AqshNoteError|at file:/);
});

test("there is no publish command", async () => {
  const project = await makeProject();
  const result = spawnSync(
    process.execPath,
    [cliPath, "publish", project.articlePath, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );

  assert.notEqual(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.code, "UNKNOWN_COMMAND");
  assert.equal(output.published, false);
});

test("ordinary CLI failures redact credentials reflected in an invalid command", async () => {
  const cliResult = spawnSync(
    process.execPath,
    [cliPath, "https://review-user:COMMAND_SECRET@note.com/aqsh?api_key=QUERY_SECRET", "--json"],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.notEqual(cliResult.status, 0, cliResult.stderr);
  assert.doesNotMatch(cliResult.stdout, /COMMAND_SECRET|QUERY_SECRET/);
  const output = JSON.parse(cliResult.stdout);
  assert.equal(output.code, "UNKNOWN_COMMAND");
});

test("a failed dry-run emits exactly one machine-readable result", async () => {
  const project = await makeProject();
  await writeFile(project.articlePath, `---
id: aqsh-invalid
title: "不正画像テスト"
status: draft
---
# 不正画像テスト

本文です。

![remote](https://example.com/image.png)
`, "utf8");
  const result = spawnSync(
    process.execPath,
    [cliPath, "dry-run", project.articlePath, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 2);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "failed");
  assert.equal(output.action, "dry-run");
  assert.ok(output.errors.some(error => error.code === "REMOTE_IMAGE_NOT_ALLOWED"));
  assert.equal(output.published, false);
});

test("human dry-run output includes each critical error", async () => {
  const project = await makeProject();
  await writeFile(project.articlePath, `---
id: aqsh-human-error
title: "Human error"
status: draft
---
# Human error

本文です。

![remote](https://example.com/image.png)
`, "utf8");
  const result = spawnSync(
    process.execPath,
    [cliPath, "dry-run", project.articlePath, "--config", project.configPath],
    { cwd: project.projectRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stdout, /\[error\] REMOTE_IMAGE_NOT_ALLOWED:/);
});

test("remote-image failures never reflect signed URL values", async () => {
  const project = await makeProject();
  await writeFile(project.articlePath, `---
id: aqsh-signed-url-regression
title: "署名URLテスト"
status: draft
---
# 署名URLテスト

本文です。

![remote](https://cdn.example/image.png?X-Amz-Signature=SIGNED_SECRET&X-Amz-Credential=CRED_SECRET#FRAG_SECRET)
`, "utf8");
  const result = spawnSync(
    process.execPath,
    [cliPath, "dry-run", project.articlePath, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 2);
  assert.doesNotMatch(result.stdout, /SIGNED_SECRET|CRED_SECRET|FRAG_SECRET/);
  const output = JSON.parse(result.stdout);
  const saved = await readFile(path.join(project.stateDir, "runs", output.run_id, "result.json"), "utf8");
  assert.doesNotMatch(saved, /SIGNED_SECRET|CRED_SECRET|FRAG_SECRET/);
});

test("failed dry-run never reflects URL credentials to stdout or result.json", async () => {
  const project = await makeProject();
  await writeFile(project.articlePath, `---
id: aqsh-secret-regression
title: "秘密反射テスト"
status: draft
note:
  url: "https://review-user:REVIEW_SECRET@note.com/aqsh/n/n9b5c6afb2521?api_key=QUERY_SECRET"
---
# 秘密反射テスト

本文です。
`, "utf8");
  const result = spawnSync(
    process.execPath,
    [cliPath, "dry-run", project.articlePath, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 2);
  assert.doesNotMatch(result.stdout, /REVIEW_SECRET|QUERY_SECRET/);
  const output = JSON.parse(result.stdout);
  const saved = await readFile(path.join(project.stateDir, "runs", output.run_id, "result.json"), "utf8");
  assert.doesNotMatch(saved, /REVIEW_SECRET|QUERY_SECRET/);
});

test("login validates its manual-login timeout before launching a browser", async () => {
  const project = await makeProject();
  const result = spawnSync(
    process.execPath,
    [cliPath, "login", "--timeout-minutes", "0", "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );

  assert.notEqual(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.code, "OPTION_VALUE_INVALID");
  assert.equal(output.published, false);
});

test("draft prepares an expiring existing-Chrome plan without changing browser state", async () => {
  const project = await makeProject();
  const result = spawnSync(
    process.execPath,
    [cliPath, "draft", project.articlePath, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "prepared");
  assert.equal(output.action, "draft");
  assert.equal(output.intended_action, "draft");
  assert.equal(output.account, "aqsh");
  assert.equal(output.git_verified, true);
  assert.equal(output.browser_executor, "codex-existing-chrome-v1");
  assert.equal(output.browser_launched, false);
  assert.equal(output.browser_state_changed, false);
  assert.equal(output.saved, false);
  assert.equal(output.published, false);
  assert.equal(output.requires_confirmation, true);
  assert.match(output.plan.sha256, /^[a-f0-9]{64}$/);
  const plan = JSON.parse(await readFile(output.plan.path, "utf8"));
  assert.equal(plan.sha256, output.plan.sha256);
  assert.equal(plan.actions[0].kind, "verify_account");
  assert.equal(plan.actions.at(-1).kind, "verify");
  const saved = await readFile(path.join(project.stateDir, "runs", output.run_id, "result.json"), "utf8");
  assert.doesNotMatch(saved, /これはブラウザを起動しないdry-run用の記事です/);
});

test("draft preparation refuses an article already bound to note", async () => {
  const project = await makeProject();
  const source = await readFile(project.articlePath, "utf8");
  await writeFile(
    project.articlePath,
    source.replace("status: draft", "status: draft\nnote:\n  key: n9b5c6afb2521"),
    "utf8"
  );

  const result = spawnSync(
    process.execPath,
    [cliPath, "draft", project.articlePath, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 2, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "failed");
  assert.equal(output.action, "draft");
  assert.equal(output.saved, false);
  assert.equal(output.published, false);
  assert.ok(output.errors.some(error => error.code === "DRAFT_ALREADY_BOUND"));
});

test("record-draft verifies a reloaded browser snapshot and replaces the prepared result", async () => {
  const project = await makeProject();
  const preparedProcess = spawnSync(
    process.execPath,
    [cliPath, "draft", project.articlePath, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );
  assert.equal(preparedProcess.status, 0, preparedProcess.stderr);
  const prepared = JSON.parse(preparedProcess.stdout);
  const observation = {
    url: "https://editor.note.com/notes/n9b5c6afb2521/edit/",
    title: "CLIテスト",
    text: "これはブラウザを起動しないdry-run用の記事です。",
    h2: [],
    h3: [],
    imageCount: 0,
    saveControlName: "下書き保存",
    reloaded: true,
    published: false
  };

  const result = spawnSync(
    process.execPath,
    [cliPath, "record-draft", prepared.plan.path, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8", input: JSON.stringify(observation) }
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "success");
  assert.equal(output.action, "draft");
  assert.equal(output.note.key, "n9b5c6afb2521");
  assert.equal(output.saved, true);
  assert.equal(output.published, false);
  const saved = JSON.parse(await readFile(
    path.join(project.stateDir, "runs", output.run_id, "result.json"),
    "utf8"
  ));
  assert.equal(saved.status, "success");
  assert.equal(saved.saved, true);
  assert.doesNotMatch(JSON.stringify(saved), /これはブラウザを起動しないdry-run用の記事です/);
});

test("record-draft rejects plan paths outside the dedicated state root before reading", async () => {
  const project = await makeProject();
  const outside = await mkdtemp(path.join(os.tmpdir(), "aqsh-note-outside-plan-"));
  const planPath = path.join(outside, "BROWSER_PLAN_PATH_SECRET.json");
  await writeFile(planPath, "BROWSER_PLAN_CONTENT_SECRET", "utf8");

  const result = spawnSync(
    process.execPath,
    [cliPath, "record-draft", planPath, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8", input: "{}" }
  );

  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.code, "BROWSER_PLAN_PATH_INVALID");
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /BROWSER_PLAN_PATH_SECRET|BROWSER_PLAN_CONTENT_SECRET/);
});

test("record-draft binds a browser plan to its containing run directory", async () => {
  const project = await makeProject();
  const preparedProcess = spawnSync(
    process.execPath,
    [cliPath, "draft", project.articlePath, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );
  assert.equal(preparedProcess.status, 0, preparedProcess.stderr);
  const prepared = JSON.parse(preparedProcess.stdout);
  const copiedRun = path.join(project.stateDir, "runs", "20260913-190001-copied-plan");
  await mkdir(copiedRun, { recursive: true });
  const copiedPlan = path.join(copiedRun, "browser-plan.json");
  await writeFile(copiedPlan, await readFile(prepared.plan.path, "utf8"), "utf8");

  const result = spawnSync(
    process.execPath,
    [cliPath, "record-draft", copiedPlan, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8", input: "{}" }
  );

  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.code, "BROWSER_PLAN_INVALID");
  assert.equal(output.published, false);
});

test("validate-plan rechecks expiry, run binding, and current source before browser use", async () => {
  const project = await makeProject();
  const preparedProcess = spawnSync(
    process.execPath,
    [cliPath, "draft", project.articlePath, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );
  assert.equal(preparedProcess.status, 0, preparedProcess.stderr);
  const prepared = JSON.parse(preparedProcess.stdout);

  const result = spawnSync(
    process.execPath,
    [cliPath, "validate-plan", prepared.plan.path, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "validated");
  assert.equal(output.action, "validate-plan");
  assert.equal(output.run_id, prepared.run_id);
  assert.equal(output.account, "aqsh");
  assert.equal(output.plan.sha256, prepared.plan.sha256);
  assert.equal(output.browser_state_changed, false);
  assert.equal(output.saved, false);
  assert.equal(output.published, false);
});

test("validate-plan refuses a source changed after plan creation", async () => {
  const project = await makeProject();
  const preparedProcess = spawnSync(
    process.execPath,
    [cliPath, "draft", project.articlePath, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );
  assert.equal(preparedProcess.status, 0, preparedProcess.stderr);
  const prepared = JSON.parse(preparedProcess.stdout);
  await writeFile(project.articlePath, "---\nid: changed\ntitle: changed\nstatus: draft\n---\n# changed\nchanged\n", "utf8");

  const result = spawnSync(
    process.execPath,
    [cliPath, "validate-plan", prepared.plan.path, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.code, "BROWSER_PLAN_SOURCE_CHANGED");
  assert.equal(output.published, false);
});

test("record-draft preserves an audit result when the post-save observation is invalid", async () => {
  const project = await makeProject();
  const preparedProcess = spawnSync(
    process.execPath,
    [cliPath, "draft", project.articlePath, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );
  assert.equal(preparedProcess.status, 0, preparedProcess.stderr);
  const prepared = JSON.parse(preparedProcess.stdout);

  const result = spawnSync(
    process.execPath,
    [cliPath, "record-draft", prepared.plan.path, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8", input: JSON.stringify({ reloaded: false }) }
  );

  assert.equal(result.status, 2, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "failed");
  assert.equal(output.action, "draft");
  assert.equal(output.saved, "unknown");
  assert.equal(output.browser_state_changed, true);
  assert.equal(output.published, false);
  assert.ok(output.errors.some(error => error.code === "DRAFT_OBSERVATION_INVALID"));
  const saved = JSON.parse(await readFile(
    path.join(project.stateDir, "runs", prepared.run_id, "result.json"),
    "utf8"
  ));
  assert.equal(saved.status, "failed");
  assert.equal(saved.saved, "unknown");
  assert.equal(saved.browser_state_changed, true);
});

test("inspect prepares an expiring read-only plan for a managed note URL", async () => {
  const project = await makeProject();
  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      "inspect",
      "https://note.com/aqsh/n/n9b5c6afb2521",
      "--config",
      project.configPath,
      "--json"
    ],
    { cwd: project.projectRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "prepared");
  assert.equal(output.action, "inspect");
  assert.equal(output.account, "aqsh");
  assert.equal(output.note.key, "n9b5c6afb2521");
  assert.equal(output.browser_state_changed, false);
  assert.equal(output.requires_confirmation, false);
  assert.equal(output.published, false);
  const plan = JSON.parse(await readFile(output.plan.path, "utf8"));
  assert.equal(plan.mode, "inspect");
  assert.equal(plan.source, null);
  assert.equal(plan.actions.at(-1).kind, "inspect");
});

test("inspect rejects note URLs outside the Aqsh account", async () => {
  const project = await makeProject();
  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      "inspect",
      "https://note.com/other/n/n9b5c6afb2521",
      "--config",
      project.configPath,
      "--json"
    ],
    { cwd: project.projectRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.code, "NAVIGATION_FORBIDDEN");
  assert.equal(output.published, false);
});

test("verify prepares a source-bound read-only plan for an existing note article", async () => {
  const project = await makeProject();
  await bindArticle(project);
  const result = spawnSync(
    process.execPath,
    [cliPath, "verify", project.articlePath, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "prepared");
  assert.equal(output.action, "verify");
  assert.equal(output.note.key, "n9b5c6afb2521");
  assert.equal(output.browser_state_changed, false);
  assert.equal(output.published, false);
  const plan = JSON.parse(await readFile(output.plan.path, "utf8"));
  assert.equal(plan.mode, "verify");
  assert.equal(plan.source.path, project.articlePath);
  assert.match(plan.source.sha256, /^[a-f0-9]{64}$/);
  assert.equal(plan.actions.at(-1).kind, "verify");
});

test("verify refuses an article without a note target", async () => {
  const project = await makeProject();
  const result = spawnSync(
    process.execPath,
    [cliPath, "verify", project.articlePath, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 2, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "failed");
  assert.equal(output.action, "verify");
  assert.ok(output.errors.some(error => error.code === "UPDATE_TARGET_REQUIRED"));
  assert.equal(output.browser_state_changed, false);
  assert.equal(output.published, false);
});

test("record-inspect writes a private snapshot without reflecting the body", async () => {
  const project = await makeProject();
  const preparedProcess = spawnSync(
    process.execPath,
    [
      cliPath,
      "inspect",
      "https://note.com/aqsh/n/n9b5c6afb2521",
      "--config",
      project.configPath,
      "--json"
    ],
    { cwd: project.projectRoot, encoding: "utf8" }
  );
  assert.equal(preparedProcess.status, 0, preparedProcess.stderr);
  const prepared = JSON.parse(preparedProcess.stdout);

  const result = spawnSync(
    process.execPath,
    [cliPath, "record-inspect", prepared.plan.path, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8", input: JSON.stringify(readObservation()) }
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "success");
  assert.equal(output.action, "inspect");
  assert.equal(output.browser_state_changed, false);
  assert.equal(output.published, false);
  assert.doesNotMatch(result.stdout, /これはブラウザを起動しないdry-run用の記事です/);
  const snapshot = JSON.parse(await readFile(output.snapshot.path, "utf8"));
  assert.equal(snapshot.text, "これはブラウザを起動しないdry-run用の記事です。");
  assert.equal((await stat(output.snapshot.path)).mode & 0o777, 0o600);
});

test("record-verify compares a live read-only observation with the source-bound plan", async () => {
  const project = await makeProject();
  await bindArticle(project);
  const preparedProcess = spawnSync(
    process.execPath,
    [cliPath, "verify", project.articlePath, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );
  assert.equal(preparedProcess.status, 0, preparedProcess.stderr);
  const prepared = JSON.parse(preparedProcess.stdout);

  const result = spawnSync(
    process.execPath,
    [cliPath, "record-verify", prepared.plan.path, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8", input: JSON.stringify(readObservation()) }
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "success");
  assert.equal(output.action, "verify");
  assert.equal(output.verification.ok, true);
  assert.equal(output.browser_state_changed, false);
  assert.equal(output.published, false);
});

test("record-verify rechecks the source after waiting for its observation", async () => {
  const project = await makeProject();
  await bindArticle(project);
  const preparedProcess = spawnSync(
    process.execPath,
    [cliPath, "verify", project.articlePath, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );
  assert.equal(preparedProcess.status, 0, preparedProcess.stderr);
  const prepared = JSON.parse(preparedProcess.stdout);
  const child = spawn(
    process.execPath,
    [cliPath, "record-verify", prepared.plan.path, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, stdio: ["pipe", "pipe", "pipe"] }
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });

  await delay(2_000);
  const source = await readFile(project.articlePath, "utf8");
  await writeFile(project.articlePath, source.replace("dry-run用の記事です。", "変更後の記事です。"), "utf8");
  child.stdin.end(JSON.stringify(readObservation()));
  const status = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });

  assert.equal(status, 2, stderr);
  const output = JSON.parse(stdout);
  assert.equal(output.status, "failed");
  assert.ok(output.errors.some(error => error.code === "BROWSER_PLAN_SOURCE_CHANGED"));
  assert.equal(output.browser_connected, "unknown");
  assert.equal(output.published, false);
});

test("record-inspect rejects an expired plan even when its digest is valid", async () => {
  const project = await makeProject();
  const preparedProcess = spawnSync(
    process.execPath,
    [
      cliPath,
      "inspect",
      "https://note.com/aqsh/n/n9b5c6afb2521",
      "--config",
      project.configPath,
      "--json"
    ],
    { cwd: project.projectRoot, encoding: "utf8" }
  );
  assert.equal(preparedProcess.status, 0, preparedProcess.stderr);
  const prepared = JSON.parse(preparedProcess.stdout);
  const plan = JSON.parse(await readFile(prepared.plan.path, "utf8"));
  plan.createdAt = "2020-01-01T00:00:00.000Z";
  plan.expiresAt = "2020-01-01T00:10:00.000Z";
  const { sha256: _sha256, ...payload } = plan;
  plan.sha256 = createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
  await writeFile(prepared.plan.path, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  const result = spawnSync(
    process.execPath,
    [cliPath, "record-inspect", prepared.plan.path, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8", input: JSON.stringify(readObservation()) }
  );

  assert.equal(result.status, 1, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.code, "BROWSER_PLAN_EXPIRED");
  assert.equal(output.published, false);
});

test("record-inspect does not claim a browser connection for an invalid observation", async () => {
  const project = await makeProject();
  const preparedProcess = spawnSync(
    process.execPath,
    [
      cliPath,
      "inspect",
      "https://note.com/aqsh/n/n9b5c6afb2521",
      "--config",
      project.configPath,
      "--json"
    ],
    { cwd: project.projectRoot, encoding: "utf8" }
  );
  assert.equal(preparedProcess.status, 0, preparedProcess.stderr);
  const prepared = JSON.parse(preparedProcess.stdout);

  const result = spawnSync(
    process.execPath,
    [cliPath, "record-inspect", prepared.plan.path, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8", input: "{}" }
  );

  assert.equal(result.status, 2, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "failed");
  assert.equal(output.browser_connected, "unknown");
  assert.equal(output.browser_state_changed, false);
  assert.equal(output.published, false);
});

test("only the unimplemented update command remains fail-closed", async () => {
  const project = await makeProject();
  const result = spawnSync(
    process.execPath,
    [cliPath, "update", project.articlePath, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "blocked");
  assert.equal(output.action, "update");
  assert.equal(output.code, "UI_CONTRACT_UNVERIFIED");
  assert.equal(output.browser_launched, false);
  assert.equal(output.published, false);
});

test("conflict-check allows local edits only when note matches the verified baseline", async () => {
  const project = await makeProject();
  await bindArticle(project);
  const baselinePreparedProcess = spawnSync(
    process.execPath,
    [cliPath, "verify", project.articlePath, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8" }
  );
  assert.equal(baselinePreparedProcess.status, 0, baselinePreparedProcess.stderr);
  const baselinePrepared = JSON.parse(baselinePreparedProcess.stdout);
  const baselineRecordedProcess = spawnSync(
    process.execPath,
    [cliPath, "record-verify", baselinePrepared.plan.path, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8", input: JSON.stringify(readObservation()) }
  );
  assert.equal(baselineRecordedProcess.status, 0, baselineRecordedProcess.stderr);
  const baselineRecorded = JSON.parse(baselineRecordedProcess.stdout);

  const currentPreparedProcess = spawnSync(
    process.execPath,
    [
      cliPath,
      "inspect",
      "https://note.com/aqsh/n/n9b5c6afb2521",
      "--config",
      project.configPath,
      "--json"
    ],
    { cwd: project.projectRoot, encoding: "utf8" }
  );
  assert.equal(currentPreparedProcess.status, 0, currentPreparedProcess.stderr);
  const currentPrepared = JSON.parse(currentPreparedProcess.stdout);
  const currentRecordedProcess = spawnSync(
    process.execPath,
    [cliPath, "record-inspect", currentPrepared.plan.path, "--config", project.configPath, "--json"],
    { cwd: project.projectRoot, encoding: "utf8", input: JSON.stringify(readObservation()) }
  );
  assert.equal(currentRecordedProcess.status, 0, currentRecordedProcess.stderr);
  const currentRecorded = JSON.parse(currentRecordedProcess.stdout);

  const source = await readFile(project.articlePath, "utf8");
  await writeFile(
    project.articlePath,
    source.replace("dry-run用の記事です。", "更新予定の記事です。"),
    "utf8"
  );
  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      "conflict-check",
      project.articlePath,
      baselineRecorded.snapshot.path,
      currentRecorded.snapshot.path,
      "--config",
      project.configPath,
      "--json"
    ],
    { cwd: project.projectRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "clear");
  assert.equal(output.action, "conflict-check");
  assert.equal(output.conflict.detected, false);
  assert.equal(output.article.source_changed_since_baseline, true);
  assert.equal(output.article.rendered_content_changed_since_baseline, true);
  assert.equal(output.article.local_changed_since_baseline, true);
  assert.equal(output.update_needed, true);
  assert.equal(output.update_allowed, true);
  assert.equal(output.browser_launched, false);
  assert.equal(output.browser_state_changed, false);
  assert.equal(output.saved, false);
  assert.equal(output.published, false);
  assert.doesNotMatch(result.stdout, /dry-run用の記事です|更新予定の記事です/);
  assert.equal((await stat(output.report.path)).mode & 0o777, 0o600);
});

test("conflict-check does not leave an empty run when snapshot validation fails", async () => {
  const project = await makeProject();
  await bindArticle(project);
  const missingBaseline = path.join(project.stateDir, "runs", "missing-baseline", "snapshot.json");
  const missingCurrent = path.join(project.stateDir, "runs", "missing-current", "snapshot.json");

  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      "conflict-check",
      project.articlePath,
      missingBaseline,
      missingCurrent,
      "--config",
      project.configPath,
      "--json"
    ],
    { cwd: project.projectRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 1);
  const runs = await readdir(path.join(project.stateDir, "runs"), { withFileTypes: true }).catch(error => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  assert.deepEqual(runs.map(entry => entry.name), []);
});
