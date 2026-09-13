import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { AqshNoteError } from "./errors.mjs";
import { canonicalizePathWithMissingTail, isPathWithin } from "./path-safety.mjs";
import { assertDedicatedRuntimePath } from "./runtime-paths.mjs";

const CONFIG_SCHEMA = {
  version: true,
  account: { id: true, profile_url: true },
  editor: { new_url: true, browser_channel: true, headless: true, inline_image_strategy: true },
  paths: { content_root: true, profile_dir: true, state_dir: true },
  timeouts: { navigation_ms: true, action_ms: true, total_ms: true },
  warnings: { short_body_chars: true, external_links: true },
  security: { allow_publish: true }
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertKnownConfigKeys(value, schema = CONFIG_SCHEMA) {
  if (!isPlainObject(value)) {
    throw new AqshNoteError("CONFIG_STRUCTURE_INVALID", "設定ファイルの構造が不正です。");
  }
  for (const [key, childValue] of Object.entries(value)) {
    if (!Object.hasOwn(schema, key)) {
      throw new AqshNoteError("CONFIG_KEY_UNSUPPORTED", "設定ファイルに未対応の項目があります。");
    }
    const childSchema = schema[key];
    if (childSchema !== true && childValue != null) assertKnownConfigKeys(childValue, childSchema);
  }
}

function requiredString(value, code, message) {
  if (typeof value !== "string" || !value.trim()) throw new AqshNoteError(code, message);
  return value.trim();
}

function expandHome(value) {
  const input = requiredString(value, "CONFIG_PATH_REQUIRED", "設定パスが不足しています。");
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  if (input.startsWith("~")) {
    throw new AqshNoteError("CONFIG_PATH_INVALID", "~user形式のパスは使用できません。", { value });
  }
  return input;
}

function projectRootFor(configPath) {
  const directory = path.dirname(configPath);
  return path.basename(directory) === "config" ? path.dirname(directory) : process.cwd();
}

function resolveConfiguredPath(value, baseDirectory) {
  const expanded = expandHome(value);
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(baseDirectory, expanded);
}

async function assertRuntimePathsOutsideProject({ profileDir, stateDir, projectRoot, contentRoot }) {
  const [profile, state, project, content] = await Promise.all([
    canonicalizePathWithMissingTail(profileDir),
    canonicalizePathWithMissingTail(stateDir),
    canonicalizePathWithMissingTail(projectRoot),
    canonicalizePathWithMissingTail(contentRoot)
  ]);
  if (isPathWithin(profile, state) || isPathWithin(state, profile)) {
    throw new AqshNoteError(
      "RUNTIME_PATH_OVERLAP",
      "認証プロファイルと実行状態の保存先は分離してください。"
    );
  }
  if (
    isPathWithin(profile, project) ||
    isPathWithin(state, project) ||
    isPathWithin(profile, content) ||
    isPathWithin(state, content)
  ) {
    throw new AqshNoteError(
      "RUNTIME_PATH_INSIDE_PROJECT",
      "認証プロファイルと実行状態はGit/content rootの外へ保存してください。"
    );
  }
  if (
    isPathWithin(project, profile) ||
    isPathWithin(project, state) ||
    isPathWithin(content, profile) ||
    isPathWithin(content, state)
  ) {
    throw new AqshNoteError(
      "RUNTIME_PATH_OVERLAPS_PROJECT",
      "認証プロファイルと実行状態の保存先にGit/content rootを含めることはできません。"
    );
  }
}

async function assertContentRootWithinProject(contentRoot, projectRoot) {
  const [content, project] = await Promise.all([
    canonicalizePathWithMissingTail(contentRoot),
    canonicalizePathWithMissingTail(projectRoot)
  ]);
  if (!isPathWithin(content, project)) {
    throw new AqshNoteError(
      "CONTENT_ROOT_OUTSIDE_PROJECT",
      "content rootはこのGitプロジェクト内に置いてください。"
    );
  }
}

function validateNotePage(value, expectedPath, code) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AqshNoteError(code, "note URLを解釈できません。", { value });
  }
  if (
    url.origin !== "https://note.com" ||
    url.username ||
    url.password ||
    url.pathname !== expectedPath ||
    url.search ||
    url.hash
  ) {
    throw new AqshNoteError(code, `許可されたURLは https://note.com${expectedPath} です。`, { value });
  }
  return `https://note.com${expectedPath}`;
}

export async function loadConfig(configPath = path.resolve("config/note.yaml")) {
  const absoluteConfigPath = path.resolve(configPath);
  let raw;
  try {
    raw = YAML.parse(await readFile(absoluteConfigPath, "utf8"));
  } catch (error) {
    if (error instanceof AqshNoteError) throw error;
    throw new AqshNoteError("CONFIG_READ_FAILED", "設定ファイルを読み込めません。", {
      configPath: absoluteConfigPath,
      cause: error.code ?? error.message
    });
  }

  assertKnownConfigKeys(raw);

  if (raw?.version !== 1) {
    throw new AqshNoteError("CONFIG_VERSION_UNSUPPORTED", "config versionは1である必要があります。", {
      actual: raw?.version
    });
  }

  const accountId = requiredString(raw.account?.id, "ACCOUNT_ID_REQUIRED", "account.idが必要です。");
  if (!/^[a-z0-9_-]+$/i.test(accountId)) {
    throw new AqshNoteError("ACCOUNT_ID_INVALID", "account.idの形式が不正です。");
  }
  if (accountId !== "aqsh") {
    throw new AqshNoteError("MANAGED_ACCOUNT_INVALID", "このリポジトリの管理対象note IDはaqshで固定です。");
  }
  const profileUrl = validateNotePage(
    raw.account?.profile_url,
    `/${accountId}`,
    "ACCOUNT_PROFILE_MISMATCH"
  );

  if (raw.security?.allow_publish !== false) {
    throw new AqshNoteError("PUBLISH_FORBIDDEN", "security.allow_publishはfalseで固定してください。");
  }

  const browserChannel = raw.editor?.browser_channel ?? "chrome";
  if (!new Set(["chrome", "chromium"]).has(browserChannel)) {
    throw new AqshNoteError("BROWSER_CHANNEL_INVALID", "browser_channelはchromeまたはchromiumです。");
  }
  if (browserChannel !== "chrome") {
    throw new AqshNoteError(
      "BROWSER_CHANNEL_UNSUPPORTED",
      "MVPでは手動ログインとPlaywright検証を同じGoogle Chromeで行うため、browser_channelはchromeで固定です。"
    );
  }
  if (raw.editor?.headless === true) {
    throw new AqshNoteError("HEADLESS_NOT_APPROVED", "MVPではheadedブラウザだけを使用できます。");
  }
  const inlineImageStrategy = raw.editor?.inline_image_strategy ?? "unverified";
  if (inlineImageStrategy !== "unverified") {
    throw new AqshNoteError(
      "INLINE_IMAGE_STRATEGY_INVALID",
      "本文画像方式はE2E選定前のためunverifiedで固定してください。"
    );
  }

  const projectRoot = projectRootFor(absoluteConfigPath);
  const profileDir = resolveConfiguredPath(raw.paths?.profile_dir, projectRoot);
  const stateDir = resolveConfiguredPath(raw.paths?.state_dir, projectRoot);
  const contentRoot = resolveConfiguredPath(raw.paths?.content_root ?? ".", projectRoot);
  await assertContentRootWithinProject(contentRoot, projectRoot);
  await assertRuntimePathsOutsideProject({ profileDir, stateDir, projectRoot, contentRoot });
  await Promise.all([
    assertDedicatedRuntimePath(profileDir, "profile"),
    assertDedicatedRuntimePath(stateDir, "state")
  ]);

  return {
    version: 1,
    configPath: absoluteConfigPath,
    projectRoot,
    account: {
      id: accountId,
      profileUrl
    },
    editor: {
      newUrl: validateNotePage(raw.editor?.new_url, "/notes/new", "EDITOR_URL_INVALID"),
      browserChannel,
      headless: false,
      inlineImageStrategy
    },
    paths: {
      contentRoot,
      profileDir,
      stateDir
    },
    timeouts: {
      navigationMs: raw.timeouts?.navigation_ms ?? 30_000,
      actionMs: raw.timeouts?.action_ms ?? 10_000,
      totalMs: raw.timeouts?.total_ms ?? 300_000
    },
    warnings: {
      shortBodyCharacters: raw.warnings?.short_body_chars ?? 400,
      externalLinks: raw.warnings?.external_links ?? 20
    },
    security: {
      allowPublish: false
    }
  };
}
