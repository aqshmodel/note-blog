import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
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

test("reserved browser commands fail closed until their UI contract is verified", async () => {
  const project = await makeProject();
  for (const command of ["draft", "update", "verify", "inspect"]) {
    const target = command === "inspect" ? "https://note.com/aqsh/n/n9b5c6afb2521" : project.articlePath;
    const result = spawnSync(
      process.execPath,
      [cliPath, command, target, "--config", project.configPath, "--json"],
      { cwd: project.projectRoot, encoding: "utf8" }
    );

    assert.equal(result.status, 1);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked");
    assert.equal(output.action, command);
    assert.equal(output.code, "UI_CONTRACT_UNVERIFIED");
    assert.equal(output.browser_launched, false);
    assert.equal(output.published, false);
  }
});
