import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadArticle } from "./article.mjs";
import { loadConfig } from "./config.mjs";
import { assertManagedGitSource, runDoctor } from "./doctor.mjs";
import { AqshNoteError, toPublicError } from "./errors.mjs";
import { preflightArticle } from "./preflight.mjs";
import { isPathWithinRoot } from "./path-safety.mjs";
import { createRunContext, listRecoveryRuns, redactSecrets, writeRunResult } from "./state.mjs";
import { runLogin } from "./commands/login.mjs";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const defaultConfigPath = path.join(projectRoot, "config/note.yaml");
const reservedBrowserCommands = new Set(["draft", "update", "verify", "inspect"]);
const supportedCommands = new Set([
  "doctor",
  "login",
  "dry-run",
  "recover",
  "help",
  ...reservedBrowserCommands
]);

function parseArguments(argv) {
  const positionals = [];
  const options = { json: false, config: defaultConfigPath, timeoutMinutes: 5 };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") {
      options.json = true;
    } else if (value === "--config") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new AqshNoteError("OPTION_VALUE_REQUIRED", "--configにはパスが必要です。");
      options.config = path.resolve(next);
      index += 1;
    } else if (value === "--timeout-minutes") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new AqshNoteError("OPTION_VALUE_REQUIRED", "--timeout-minutesには数値が必要です。");
      const timeoutMinutes = Number(next);
      if (!Number.isInteger(timeoutMinutes) || timeoutMinutes < 1 || timeoutMinutes > 30) {
        throw new AqshNoteError("OPTION_VALUE_INVALID", "--timeout-minutesは1〜30の整数で指定してください。");
      }
      options.timeoutMinutes = timeoutMinutes;
      index += 1;
    } else if (value.startsWith("--")) {
      throw new AqshNoteError("UNKNOWN_OPTION", `未対応のオプションです: ${value}`);
    } else {
      positionals.push(value);
    }
  }
  return { positionals, options };
}

function printHuman(result) {
  if (result.action === "doctor") {
    console.log(`Aqsh note doctor: ${result.status}`);
    for (const item of result.checks) console.log(`[${item.status}] ${item.id}: ${item.message}`);
    return;
  }
  if (result.action === "dry-run") {
    console.log(`dry-run: ${result.status}`);
    console.log(`intended action: ${result.intended_action ?? "unresolved"}`);
    console.log(`title: ${result.article.title}`);
    console.log(`body: ${result.article.stats.bodyCharacters} characters`);
    console.log(`H2/H3: ${result.article.stats.h2}/${result.article.stats.h3}`);
    console.log(`images: ${result.article.stats.images}`);
    console.log("browser: not launched");
    console.log("published: false");
    for (const error of result.errors) console.log(`[error] ${error.code}: ${error.message}`);
    for (const warning of result.warnings) console.log(`[warning] ${warning.code}: ${warning.message}`);
    return;
  }
  if (result.action === "login") {
    console.log(`login: ${result.status}`);
    console.log(result.message);
    console.log("published: false");
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

function emit(result, json) {
  const safeResult = redactSecrets(result);
  if (json) console.log(JSON.stringify(safeResult, null, 2));
  else printHuman(safeResult);
}

function failure(error, json) {
  const publicError = toPublicError(error);
  const result = redactSecrets({
    status: "failed",
    code: publicError.code,
    message: publicError.message,
    published: false
  });
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.error(`${result.code}: ${result.message}`);
  return result.code === "UNKNOWN_COMMAND" || result.code === "PREFLIGHT_FAILED" ? 2 : 1;
}

async function handleDoctor(config, json) {
  const report = await runDoctor(config);
  const result = {
    status: report.status,
    action: "doctor",
    account: config.account.id,
    checks: report.checks,
    published: false
  };
  emit(result, json);
  return report.status === "blocked" ? 1 : 0;
}

async function handleDryRun(config, articlePath, json) {
  if (!articlePath) throw new AqshNoteError("ARTICLE_PATH_REQUIRED", "dry-runにはarticle.mdが必要です。");
  await assertManagedGitSource(config);
  if (!(await isPathWithinRoot(articlePath, config.paths.contentRoot))) {
    throw new AqshNoteError(
      "ARTICLE_OUTSIDE_CONTENT_ROOT",
      "記事ファイルは設定されたcontent root内に置いてください。"
    );
  }
  const article = await loadArticle(articlePath);
  const preflight = await preflightArticle(article, {
    mode: "dry-run",
    accountId: config.account.id,
    contentRoot: config.paths.contentRoot,
    shortBodyCharacters: config.warnings.shortBodyCharacters,
    externalLinkWarning: config.warnings.externalLinks
  });
  const run = await createRunContext({
    stateDir: config.paths.stateDir,
    action: "dry-run",
    articleId: article.id ?? path.basename(article.sourcePath, path.extname(article.sourcePath))
  });
  const result = {
    status: preflight.ok ? "success" : "failed",
    action: "dry-run",
    intended_action: preflight.intendedAction,
    run_id: run.runId,
    account: config.account.id,
    article: {
      id: article.id,
      title: article.title,
      source_path: article.sourcePath,
      stats: article.stats
    },
    errors: preflight.errors,
    warnings: preflight.warnings,
    browser_launched: false,
    git_verified: true,
    published: false
  };
  await writeRunResult(run, result);
  emit(result, json);
  return preflight.ok ? 0 : 2;
}

async function handleRecover(config, requestedRunId, json) {
  const runs = await listRecoveryRuns(config.paths.stateDir);
  const selected = requestedRunId ? runs.filter(run => run.runId === requestedRunId) : runs;
  const result = {
    status: "success",
    action: "recover",
    runs: selected,
    automatic_retry: false,
    published: false
  };
  emit(result, json);
  return 0;
}

async function handleLogin(config, options) {
  const progress = status => {
    const message = status.message ?? `ログイン待機中: ${status.reason}`;
    if (options.json) console.error(message);
    else console.log(message);
  };
  const outcome = await runLogin(config, {
    timeoutMinutes: options.timeoutMinutes,
    onProgress: progress
  });
  emit(outcome.result, options.json);
  return outcome.exitCode;
}

function handleUnverifiedBrowserCommand(command, json) {
  const result = {
    status: "blocked",
    action: command,
    code: "UI_CONTRACT_UNVERIFIED",
    message: "既存Chrome接続で現行note UIのE2E検証が完了するまで、この操作はfail-closedです。",
    browser_launched: false,
    published: false
  };
  emit(result, json);
  return 1;
}

function help(json) {
  const result = {
    status: "success",
    action: "help",
    commands: ["doctor", "login", "dry-run", "draft", "update", "verify", "inspect", "recover"],
    available_commands: ["doctor", "login", "dry-run", "recover"],
    blocked_until_e2e: ["draft", "update", "verify", "inspect"],
    note: "公開コマンドはありません。",
    published: false
  };
  emit(result, json);
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  let options = { json: argv.includes("--json"), config: defaultConfigPath, timeoutMinutes: 5 };
  try {
    const parsed = parseArguments(argv);
    options = parsed.options;
    const [command = "help", target] = parsed.positionals;
    if (!supportedCommands.has(command)) {
      throw new AqshNoteError("UNKNOWN_COMMAND", `未対応のコマンドです: ${command}`);
    }
    if (command === "help") return help(options.json);
    const config = await loadConfig(options.config);
    if (command === "doctor") return await handleDoctor(config, options.json);
    if (command === "login") return await handleLogin(config, options);
    if (command === "dry-run") return await handleDryRun(config, target, options.json);
    if (command === "recover") return await handleRecover(config, target, options.json);
    if (reservedBrowserCommands.has(command)) return handleUnverifiedBrowserCommand(command, options.json);
    return 1;
  } catch (error) {
    return failure(error, options.json);
  }
}
