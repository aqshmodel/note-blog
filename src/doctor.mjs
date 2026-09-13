import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { AqshNoteError } from "./errors.mjs";
import { canonicalizePathWithMissingTail } from "./path-safety.mjs";

const execFileAsync = promisify(execFile);
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const EXPECTED_GIT_ORIGIN = "https://github.com/aqshmodel/note-blog.git";
const toolRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function check(id, status, message, details = undefined) {
  return details === undefined ? { id, status, message } : { id, status, message, details };
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writableOrCreatable(directory) {
  let candidate = path.resolve(directory);
  while (!(await exists(candidate))) {
    const parent = path.dirname(candidate);
    if (parent === candidate) return false;
    candidate = parent;
  }
  try {
    await access(candidate, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function commandVersion(command, args = []) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: 5_000 });
    return `${stdout}${stderr}`.trim();
  } catch {
    return null;
  }
}

export async function inspectManagedGitSource(config) {
  const gitVersion = await commandVersion("git", ["--version"]);
  const gitRoot = await commandVersion("git", ["-C", config.paths.contentRoot, "rev-parse", "--show-toplevel"]);
  const gitRootMatches = Boolean(gitRoot) && (
    await canonicalizePathWithMissingTail(gitRoot) === await canonicalizePathWithMissingTail(config.projectRoot)
  );
  const gitOrigin = await commandVersion("git", ["-C", config.projectRoot, "config", "--get", "remote.origin.url"]);
  const gitOriginMatches = gitOrigin === EXPECTED_GIT_ORIGIN;

  return {
    ok: Boolean(gitVersion) && gitRootMatches && gitOriginMatches,
    gitVersion,
    gitRoot,
    gitRootMatches,
    gitOriginMatches
  };
}

export async function assertManagedGitSource(config) {
  const source = await inspectManagedGitSource(config);
  if (!source.ok) {
    throw new AqshNoteError(
      "GIT_SOURCE_UNVERIFIED",
      `書き込み準備を停止しました。content rootがこのGitプロジェクトに属し、originが${EXPECTED_GIT_ORIGIN}であることを確認してください。`
    );
  }
  return source;
}

export async function assertBrowserRuntime(config, options = {}) {
  const nodeMajor = Number(options.nodeMajor ?? process.versions.node.split(".")[0]);
  const platform = options.platform ?? process.platform;
  const chromeExists = options.chromeExists ?? await exists(CHROME_PATH);
  const checkGit = options.checkGit ?? assertManagedGitSource;

  if (nodeMajor !== 24) {
    throw new AqshNoteError("NODE_UNSUPPORTED", "ブラウザ操作にはNode.js 24.xが必要です。");
  }
  if (config?.security?.allowPublish !== false) {
    throw new AqshNoteError("PUBLISH_FORBIDDEN", "公開禁止設定を確認できないため停止しました。");
  }
  if (config?.editor?.browserChannel !== "chrome") {
    throw new AqshNoteError("BROWSER_CHANNEL_UNSUPPORTED", "ブラウザ操作はGoogle Chromeに固定されています。");
  }
  if (platform !== "darwin") {
    throw new AqshNoteError("HOST_UNSUPPORTED", "note運用コマンドはmacOSホストで実行してください。");
  }
  if (!chromeExists) {
    throw new AqshNoteError("CHROME_NOT_FOUND", "Google Chromeが見つかりません。");
  }
  await checkGit(config);
  return { node: true, browser: true, git: true, publishGuard: true };
}

export function browserRequirementForPlatform({ platform, browserChannel, chromeExists }) {
  if (browserChannel !== "chrome") {
    return { status: "fail", message: "BROWSER_CHANNEL_UNSUPPORTED: Google Chromeだけを使用できます。" };
  }
  if (platform !== "darwin") {
    return { status: "fail", message: "HOST_UNSUPPORTED: note運用コマンドはmacOSホストで実行してください。" };
  }
  return chromeExists
    ? { status: "pass", message: CHROME_PATH }
    : { status: "fail", message: "Google Chromeが見つかりません。" };
}

export async function runDoctor(config) {
  const checks = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push(
    check(
      "node",
      nodeMajor === 24 ? "pass" : "fail",
      nodeMajor === 24 ? `Node.js ${process.versions.node}` : `Node.js 24.xが必要です（現在 ${process.versions.node}）。`
    )
  );

  checks.push(check("config", "pass", config.configPath));
  checks.push(check("account", "pass", config.account.profileUrl));
  checks.push(check("publish_guard", config.security.allowPublish === false ? "pass" : "fail", "公開操作は無効です。"));
  checks.push(
    check(
      "content_root",
      (await exists(config.paths.contentRoot)) && (await writableOrCreatable(config.paths.contentRoot)) ? "pass" : "fail",
      config.paths.contentRoot
    )
  );
  checks.push(
    check(
      "state_dir",
      (await writableOrCreatable(config.paths.stateDir)) ? "pass" : "fail",
      config.paths.stateDir
    )
  );

  const profileExists = await exists(config.paths.profileDir);
  checks.push(
    check(
      "chrome_profile",
      profileExists ? "pass" : "warn",
      profileExists
        ? `診断用profile: ${config.paths.profileDir}`
        : `診断用profileは未作成: ${config.paths.profileDir}`
    )
  );
  checks.push(
    check(
      "login",
      "warn",
      "既存Chrome接続モードでは、Codexが書き込み実行ごとにnote ID専用設定画面でaqshを確認します。"
    )
  );

  const browserRequirement = browserRequirementForPlatform({
    platform: process.platform,
    browserChannel: config.editor.browserChannel,
    chromeExists: await exists(CHROME_PATH)
  });
  checks.push(check("browser", browserRequirement.status, browserRequirement.message));

  try {
    const packageJson = JSON.parse(
      await (await import("node:fs/promises")).readFile(path.resolve(toolRoot, "node_modules/playwright/package.json"), "utf8")
    );
    checks.push(check("playwright", packageJson.version === "1.63.0" ? "pass" : "warn", `Playwright ${packageJson.version}`));
  } catch {
    checks.push(check("playwright", "fail", "Node版Playwrightが見つかりません。"));
  }

  const gitSource = await inspectManagedGitSource(config);
  checks.push(check("git", gitSource.gitVersion ? "pass" : "fail", gitSource.gitVersion ?? "Gitが見つかりません。"));
  checks.push(check(
    "git_repository",
    gitSource.gitRootMatches ? "pass" : "fail",
    gitSource.gitRootMatches ? gitSource.gitRoot : "content_rootはこのプロジェクトのGitリポジトリに属していません。"
  ));
  checks.push(check(
    "git_origin",
    gitSource.gitOriginMatches ? "pass" : "fail",
    gitSource.gitOriginMatches ? EXPECTED_GIT_ORIGIN : `originは${EXPECTED_GIT_ORIGIN}である必要があります。`
  ));

  const skillPath = path.join(config.projectRoot, ".agents/skills/aqsh-note-editor/SKILL.md");
  checks.push(check("codex_skill", (await exists(skillPath)) ? "pass" : "warn", (await exists(skillPath)) ? skillPath : "Skillは未作成です。"));

  const hasFailure = checks.some(item => item.status === "fail");
  const hasWarning = checks.some(item => item.status === "warn");
  return {
    status: hasFailure ? "blocked" : hasWarning ? "attention" : "ready",
    checks
  };
}
