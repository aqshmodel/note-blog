import path from "node:path";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadArticle } from "./article.mjs";
import { loadConfig } from "./config.mjs";
import { assertManagedGitSource, runDoctor } from "./doctor.mjs";
import { AqshNoteError, toPublicError } from "./errors.mjs";
import { preflightArticle } from "./preflight.mjs";
import { isPathWithinRoot } from "./path-safety.mjs";
import { createRunContext, listRecoveryRuns, redactSecrets, writeRunResult } from "./state.mjs";
import { runLogin } from "./commands/login.mjs";
import {
  assertDraftBridgePlan,
  createDraftBridgePlan,
  writeDraftBridgePlan
} from "./browser/bridge-plan.mjs";
import { verifyDraftObservation } from "./browser/draft-result.mjs";
import {
  assertReadBridgePlan,
  createReadBridgePlan,
  writeReadBridgePlan
} from "./browser/read-plan.mjs";
import { createReadResult, writeReadSnapshot } from "./browser/read-result.mjs";
import { assertAllowedNoteNavigation } from "./browser/safety.mjs";
import { parseManagedNoteUrl, validateNoteKey } from "./note-url.mjs";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const defaultConfigPath = path.join(projectRoot, "config/note.yaml");
const reservedBrowserCommands = new Set(["update"]);
const supportedCommands = new Set([
  "doctor",
  "login",
  "dry-run",
  "draft",
  "inspect",
  "verify",
  "validate-plan",
  "record-draft",
  "record-inspect",
  "record-verify",
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
  if (result.action === "draft" && result.status === "prepared") {
    console.log(`draft preparation: ${result.status}`);
    console.log(`title: ${result.article.title}`);
    console.log(`plan: ${result.plan?.path ?? "not created"}`);
    console.log("browser: not launched");
    console.log("saved: false");
    console.log("published: false");
    for (const error of result.errors ?? []) console.log(`[error] ${error.code}: ${error.message}`);
    for (const warning of result.warnings ?? []) console.log(`[warning] ${warning.code}: ${warning.message}`);
    return;
  }
  if (result.action === "draft") {
    console.log(`draft: ${result.status}`);
    console.log(`title: ${result.article?.title ?? "unknown"}`);
    console.log(`editor: ${result.note?.editor_url ?? "unknown"}`);
    console.log(`saved: ${String(result.saved)}`);
    console.log("published: false");
    return;
  }
  if (["inspect", "verify"].includes(result.action) && result.status === "prepared") {
    console.log(`${result.action} preparation: ${result.status}`);
    console.log(`note: ${result.note?.key ?? "unknown"}`);
    console.log(`plan: ${result.plan?.path ?? "not created"}`);
    console.log("browser: not launched");
    console.log("browser state changed: false");
    console.log("published: false");
    for (const error of result.errors ?? []) console.log(`[error] ${error.code}: ${error.message}`);
    for (const warning of result.warnings ?? []) console.log(`[warning] ${warning.code}: ${warning.message}`);
    return;
  }
  if (["inspect", "verify"].includes(result.action)) {
    console.log(`${result.action}: ${result.status}`);
    console.log(`note: ${result.note?.key ?? "unknown"}`);
    console.log(`snapshot: ${result.snapshot?.path ?? "not written"}`);
    if (result.verification) console.log(`matched: ${String(result.verification.ok)}`);
    console.log("browser state changed: false");
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

async function handleDraft(config, articlePath, json) {
  if (!articlePath) throw new AqshNoteError("ARTICLE_PATH_REQUIRED", "draftにはarticle.mdが必要です。");
  await assertManagedGitSource(config);
  if (!(await isPathWithinRoot(articlePath, config.paths.contentRoot))) {
    throw new AqshNoteError(
      "ARTICLE_OUTSIDE_CONTENT_ROOT",
      "記事ファイルは設定されたcontent root内に置いてください。"
    );
  }
  const article = await loadArticle(articlePath);
  const preflight = await preflightArticle(article, {
    mode: "draft",
    accountId: config.account.id,
    contentRoot: config.paths.contentRoot,
    shortBodyCharacters: config.warnings.shortBodyCharacters,
    externalLinkWarning: config.warnings.externalLinks
  });
  const run = await createRunContext({
    stateDir: config.paths.stateDir,
    action: "draft",
    articleId: article.id ?? path.basename(article.sourcePath, path.extname(article.sourcePath))
  });

  if (!preflight.ok) {
    const result = {
      status: "failed",
      action: "draft",
      intended_action: preflight.intendedAction,
      run_id: run.runId,
      account: config.account.id,
      article: { id: article.id, title: article.title, stats: article.stats },
      errors: preflight.errors,
      warnings: preflight.warnings,
      browser_launched: false,
      browser_state_changed: false,
      git_verified: true,
      saved: false,
      published: false
    };
    await writeRunResult(run, result);
    emit(result, json);
    return 2;
  }

  const plan = createDraftBridgePlan({ run, article, config });
  const planPath = await writeDraftBridgePlan(run, plan);
  const result = {
    status: "prepared",
    action: "draft",
    intended_action: "draft",
    run_id: run.runId,
    account: config.account.id,
    article: { id: article.id, title: article.title, stats: article.stats },
    errors: [],
    warnings: preflight.warnings,
    browser_executor: "codex-existing-chrome-v1",
    plan: { path: planPath, sha256: plan.sha256, expires_at: plan.expiresAt },
    requires_confirmation: true,
    browser_launched: false,
    browser_state_changed: false,
    git_verified: true,
    saved: false,
    published: false
  };
  await writeRunResult(run, result);
  emit(result, json);
  return 0;
}

function targetFromKey(key, accountId) {
  const validatedKey = validateNoteKey(key);
  return {
    key: validatedKey,
    publicUrl: `https://note.com/${accountId}/n/${validatedKey}`,
    editorUrl: `https://editor.note.com/notes/${validatedKey}/edit/`
  };
}

async function handleInspect(config, noteUrl, json) {
  if (!noteUrl) throw new AqshNoteError("NOTE_URL_REQUIRED", "inspectには管理対象のnote記事URLが必要です。");
  await assertManagedGitSource(config);
  const canonicalUrl = assertAllowedNoteNavigation(noteUrl, {
    accountId: config.account.id,
    purpose: "article"
  });
  const target = parseManagedNoteUrl(canonicalUrl, config.account.id);
  const noteTarget = targetFromKey(target.key, config.account.id);
  const run = await createRunContext({
    stateDir: config.paths.stateDir,
    action: "inspect",
    articleId: target.key
  });
  const plan = createReadBridgePlan({ run, config, target: noteTarget, mode: "inspect" });
  const planPath = await writeReadBridgePlan(run, plan);
  const result = {
    status: "prepared",
    action: "inspect",
    run_id: run.runId,
    account: config.account.id,
    note: {
      key: noteTarget.key,
      public_url: noteTarget.publicUrl,
      editor_url: noteTarget.editorUrl
    },
    errors: [],
    warnings: [],
    browser_executor: "codex-existing-chrome-v1",
    plan: { path: planPath, sha256: plan.sha256, expires_at: plan.expiresAt },
    requires_confirmation: false,
    browser_launched: false,
    browser_state_changed: false,
    git_verified: true,
    saved: false,
    published: false
  };
  await writeRunResult(run, result);
  emit(result, json);
  return 0;
}

async function handleVerify(config, articlePath, json) {
  if (!articlePath) throw new AqshNoteError("ARTICLE_PATH_REQUIRED", "verifyにはarticle.mdが必要です。");
  await assertManagedGitSource(config);
  if (!(await isPathWithinRoot(articlePath, config.paths.contentRoot))) {
    throw new AqshNoteError(
      "ARTICLE_OUTSIDE_CONTENT_ROOT",
      "記事ファイルは設定されたcontent root内に置いてください。"
    );
  }
  const article = await loadArticle(articlePath);
  const preflight = await preflightArticle(article, {
    mode: "update",
    accountId: config.account.id,
    contentRoot: config.paths.contentRoot,
    shortBodyCharacters: config.warnings.shortBodyCharacters,
    externalLinkWarning: config.warnings.externalLinks
  });
  const run = await createRunContext({
    stateDir: config.paths.stateDir,
    action: "verify",
    articleId: article.id ?? path.basename(article.sourcePath, path.extname(article.sourcePath))
  });

  if (!preflight.ok) {
    const result = {
      status: "failed",
      action: "verify",
      intended_action: preflight.intendedAction,
      run_id: run.runId,
      account: config.account.id,
      article: { id: article.id, title: article.title, stats: article.stats },
      errors: preflight.errors,
      warnings: preflight.warnings,
      browser_launched: false,
      browser_state_changed: false,
      git_verified: true,
      saved: false,
      published: false
    };
    await writeRunResult(run, result);
    emit(result, json);
    return 2;
  }

  const declaredNote = article.frontmatter.note;
  const key = declaredNote.key
    ? validateNoteKey(declaredNote.key)
    : parseManagedNoteUrl(declaredNote.url, config.account.id).key;
  const noteTarget = targetFromKey(key, config.account.id);
  const plan = createReadBridgePlan({
    run,
    config,
    target: noteTarget,
    mode: "verify",
    article
  });
  const planPath = await writeReadBridgePlan(run, plan);
  const result = {
    status: "prepared",
    action: "verify",
    intended_action: "verify",
    run_id: run.runId,
    account: config.account.id,
    article: { id: article.id, title: article.title, stats: article.stats },
    note: {
      key: noteTarget.key,
      public_url: noteTarget.publicUrl,
      editor_url: noteTarget.editorUrl
    },
    errors: [],
    warnings: preflight.warnings,
    browser_executor: "codex-existing-chrome-v1",
    plan: { path: planPath, sha256: plan.sha256, expires_at: plan.expiresAt },
    requires_confirmation: false,
    browser_launched: false,
    browser_state_changed: false,
    git_verified: true,
    saved: false,
    published: false
  };
  await writeRunResult(run, result);
  emit(result, json);
  return 0;
}

async function readObservationFromStdin(limit = 1_000_000, kind = "draft") {
  const invalid = () => kind === "read"
    ? new AqshNoteError("READ_OBSERVATION_INVALID", "noteの読み取り観測JSONを安全に解釈できません。")
    : new AqshNoteError("DRAFT_OBSERVATION_INVALID", "保存後の観測JSONを解釈できません。");
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input, "utf8") > limit) {
      throw invalid();
    }
  }
  try {
    return JSON.parse(input);
  } catch {
    throw invalid();
  }
}

async function loadManagedBrowserPlan(config, planPath, { requireFresh, expectedType = null, expectedMode = null }) {
  if (!planPath) {
    throw new AqshNoteError("BROWSER_PLAN_REQUIRED", "browser-plan.jsonを指定してください。");
  }
  await assertManagedGitSource(config);
  const absolutePlanPath = path.resolve(planPath);
  const runsRoot = path.join(config.paths.stateDir, "runs");
  if (
    path.basename(absolutePlanPath) !== "browser-plan.json" ||
    !(await isPathWithinRoot(absolutePlanPath, runsRoot))
  ) {
    throw new AqshNoteError(
      "BROWSER_PLAN_PATH_INVALID",
      "browser planは専用state root内のrunから指定してください。"
    );
  }

  let plan;
  try {
    plan = JSON.parse(await readFile(absolutePlanPath, "utf8"));
  } catch {
    throw new AqshNoteError("BROWSER_PLAN_INVALID", "browser planを安全に読み込めません。");
  }
  const runDirectory = path.dirname(absolutePlanPath);
  const runId = path.basename(runDirectory);
  let run;
  let validatedPlan;
  if (plan?.type === "aqsh-note-existing-chrome-draft") {
    if (expectedType && expectedType !== "draft") {
      throw new AqshNoteError("BROWSER_PLAN_INVALID", "browser planの種別がコマンドと一致しません。");
    }
    run = { runId, directory: runDirectory, action: "draft" };
    validatedPlan = assertDraftBridgePlan(plan, {
      expectedRunId: run.runId,
      now: requireFresh ? new Date() : null
    });
  } else if (plan?.type === "aqsh-note-existing-chrome-read") {
    if (expectedType && expectedType !== "read") {
      throw new AqshNoteError("BROWSER_PLAN_INVALID", "browser planの種別がコマンドと一致しません。");
    }
    run = { runId, directory: runDirectory, action: plan.mode };
    validatedPlan = assertReadBridgePlan(plan, {
      expectedRunId: run.runId,
      expectedMode,
      now: requireFresh ? new Date() : null
    });
  } else {
    throw new AqshNoteError("BROWSER_PLAN_INVALID", "browser planの種別を安全に確認できません。");
  }
  return { absolutePlanPath, run, plan: validatedPlan };
}

async function assertCurrentPlanSource(plan, config) {
  if (!plan.source) return;
  if (!(await isPathWithinRoot(plan.source.path, config.paths.contentRoot))) {
    throw new AqshNoteError(
      "BROWSER_PLAN_SOURCE_CHANGED",
      "browser planの元原稿を現在の正本として確認できません。planを再作成してください。"
    );
  }
  let source;
  try {
    source = await readFile(plan.source.path, "utf8");
  } catch {
    throw new AqshNoteError(
      "BROWSER_PLAN_SOURCE_CHANGED",
      "browser planの元原稿を現在の正本として確認できません。planを再作成してください。"
    );
  }
  const sourceSha256 = createHash("sha256").update(source, "utf8").digest("hex");
  if (sourceSha256 !== plan.source.sha256) {
    throw new AqshNoteError(
      "BROWSER_PLAN_SOURCE_CHANGED",
      "browser planの作成後に原稿が変更されました。planを再作成してください。"
    );
  }
}

async function handleValidatePlan(config, planPath, json) {
  const loaded = await loadManagedBrowserPlan(config, planPath, { requireFresh: true });
  await assertCurrentPlanSource(loaded.plan, config);
  const result = {
    status: "validated",
    action: "validate-plan",
    run_id: loaded.run.runId,
    account: loaded.plan.accountId,
    plan_mode: loaded.plan.mode ?? "draft",
    article: loaded.plan.expected && loaded.plan.source ? {
      title: loaded.plan.expected.title,
      source_sha256: loaded.plan.source.sha256
    } : null,
    note: loaded.plan.target ? {
      key: loaded.plan.target.key,
      public_url: loaded.plan.target.publicUrl,
      editor_url: loaded.plan.target.editorUrl
    } : null,
    plan: {
      path: loaded.absolutePlanPath,
      sha256: loaded.plan.sha256,
      expires_at: loaded.plan.expiresAt
    },
    browser_state_changed: false,
    saved: false,
    published: false
  };
  emit(result, json);
  return 0;
}

async function handleRecordDraft(config, planPath, json) {
  const loaded = await loadManagedBrowserPlan(config, planPath, {
    requireFresh: false,
    expectedType: "draft"
  });
  const { run, plan: validatedPlan } = loaded;
  let result;
  try {
    const observation = await readObservationFromStdin();
    result = verifyDraftObservation(validatedPlan, observation, { validatePlan: value => value });
  } catch (error) {
    const publicError = toPublicError(error);
    result = {
      status: "failed",
      action: "draft",
      run_id: run.runId,
      account: validatedPlan.accountId,
      article: {
        title: validatedPlan.expected.title,
        source_sha256: validatedPlan.source.sha256
      },
      errors: [publicError],
      browser_connected: true,
      browser_state_changed: true,
      saved: "unknown",
      published: false
    };
  }
  await writeRunResult(run, result);
  emit(result, json);
  return result.status === "success" ? 0 : 2;
}

async function handleRecordRead(config, planPath, mode, json) {
  const loaded = await loadManagedBrowserPlan(config, planPath, {
    requireFresh: true,
    expectedType: "read",
    expectedMode: mode
  });
  const { run, plan } = loaded;
  let result;
  try {
    const observation = await readObservationFromStdin(1_000_000, "read");
    await assertCurrentPlanSource(plan, config);
    const output = createReadResult(plan, observation);
    const snapshotPath = await writeReadSnapshot(run, output.snapshot);
    result = {
      ...output.result,
      snapshot: { ...output.result.snapshot, path: snapshotPath }
    };
  } catch (error) {
    const publicError = toPublicError(error);
    result = {
      status: "failed",
      action: mode,
      run_id: run.runId,
      account: plan.accountId,
      note: {
        key: plan.target.key,
        editor_url: plan.target.editorUrl,
        public_url: plan.target.publicUrl
      },
      errors: [publicError],
      browser_connected: "unknown",
      browser_state_changed: false,
      saved: false,
      published: false
    };
  }
  await writeRunResult(run, result);
  emit(result, json);
  return result.status === "success" ? 0 : 2;
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
    available_commands: ["doctor", "login", "dry-run", "draft", "verify", "inspect", "recover"],
    blocked_until_e2e: ["update"],
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
    if (command === "draft") return await handleDraft(config, target, options.json);
    if (command === "inspect") return await handleInspect(config, target, options.json);
    if (command === "verify") return await handleVerify(config, target, options.json);
    if (command === "validate-plan") return await handleValidatePlan(config, target, options.json);
    if (command === "record-draft") return await handleRecordDraft(config, target, options.json);
    if (command === "record-inspect") return await handleRecordRead(config, target, "inspect", options.json);
    if (command === "record-verify") return await handleRecordRead(config, target, "verify", options.json);
    if (command === "recover") return await handleRecover(config, target, options.json);
    if (reservedBrowserCommands.has(command)) return handleUnverifiedBrowserCommand(command, options.json);
    return 1;
  } catch (error) {
    return failure(error, options.json);
  }
}
