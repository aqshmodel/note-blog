import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadSut() {
  try {
    return await import(pathToFileURL(path.resolve("src/state.mjs")));
  } catch {
    return {};
  }
}

async function newStateDirectory(prefix) {
  const parent = await mkdtemp(path.join(os.tmpdir(), prefix));
  return path.join(parent, "state");
}

test("creates a deterministic run directory and writes redacted JSON", async () => {
  const { createRunContext, writeRunResult } = await loadSut();
  assert.equal(typeof createRunContext, "function", "createRunContext must exist");
  assert.equal(typeof writeRunResult, "function", "writeRunResult must exist");
  const stateDir = await newStateDirectory("aqsh-note-state-");
  const run = await createRunContext({
    stateDir,
    action: "dry-run",
    articleId: "aqsh test/01",
    now: new Date("2026-09-13T05:35:00.000Z")
  });

  await writeRunResult(run, {
    status: "success",
    password: "secret-password",
    nested: { cookie: "session-secret", title: "safe" }
  });

  assert.match(run.runId, /^20260913-143500-aqsh-test-01$/);
  const saved = await readFile(path.join(run.directory, "result.json"), "utf8");
  assert.doesNotMatch(saved, /secret-password|session-secret/);
  assert.match(saved, /\[REDACTED\]/);
  assert.match(saved, /"title": "safe"/);
});

test("recover lists runs and known artifacts without modifying them", async () => {
  const { createRunContext, listRecoveryRuns, writeRunResult } = await loadSut();
  assert.equal(typeof createRunContext, "function", "createRunContext must exist");
  assert.equal(typeof listRecoveryRuns, "function", "listRecoveryRuns must exist");
  const stateDir = await newStateDirectory("aqsh-note-recover-");
  const run = await createRunContext({ stateDir, action: "draft", articleId: "aqsh-001" });
  await writeRunResult(run, { status: "failed", published: false });

  const recovered = await listRecoveryRuns(stateDir);

  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].runId, run.runId);
  assert.deepEqual(recovered[0].artifacts, ["result.json"]);
});

test("does not reuse a run directory created in the same second", async () => {
  const { createRunContext } = await loadSut();
  assert.equal(typeof createRunContext, "function", "createRunContext must exist");
  const stateDir = await newStateDirectory("aqsh-note-run-collision-");
  const now = new Date("2026-09-13T05:35:00.000Z");

  const first = await createRunContext({ stateDir, action: "dry-run", articleId: "aqsh-001", now });
  const second = await createRunContext({ stateDir, action: "dry-run", articleId: "aqsh-001", now });

  assert.equal(first.runId, "20260913-143500-aqsh-001");
  assert.equal(second.runId, "20260913-143500-aqsh-001-02");
  assert.notEqual(first.directory, second.directory);
});

test("redacts credentials in URLs, query strings, and HTTP-style headers", async () => {
  const { redactSecrets } = await loadSut();
  assert.equal(typeof redactSecrets, "function", "redactSecrets must exist");
  const redacted = JSON.stringify(redactSecrets({
    url: "https://review-user:URL_SECRET@note.com/aqsh?api_key=QUERY_SECRET&safe=1",
    headers: "Authorization: Bearer AUTH_SECRET\nCookie: sid=COOKIE_SECRET\nSet-Cookie: sid=SET_COOKIE_SECRET",
    message: "api_key=INLINE_SECRET session=SESSION_SECRET"
  }));

  assert.doesNotMatch(
    redacted,
    /URL_SECRET|QUERY_SECRET|AUTH_SECRET|COOKIE_SECRET|SET_COOKIE_SECRET|INLINE_SECRET|SESSION_SECRET/
  );
  assert.match(redacted, /\[REDACTED\]/);
});

test("redacts every value and fragment in signed URLs plus colon-style secrets", async () => {
  const { redactSecrets } = await loadSut();
  assert.equal(typeof redactSecrets, "function", "redactSecrets must exist");
  const redacted = JSON.stringify(redactSecrets({
    source: "https://cdn.example/image.png?X-Amz-Signature=SIGNED_SECRET&X-Amz-Credential=CRED_SECRET#FRAG_SECRET",
    message: "password: COLON_SECRET"
  }));

  assert.doesNotMatch(redacted, /SIGNED_SECRET|CRED_SECRET|FRAG_SECRET|COLON_SECRET/);
  assert.match(redacted, /X-Amz-Signature=\[REDACTED\]/);
  assert.match(redacted, /password: \[REDACTED\]/);
});
