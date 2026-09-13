import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadSut() {
  try {
    return await import(pathToFileURL(path.resolve("src/runtime-paths.mjs")));
  } catch {
    return {};
  }
}

test("claims a new nonstandard runtime directory with an ownership marker", async () => {
  const { ensureDedicatedRuntimeDirectory } = await loadSut();
  assert.equal(
    typeof ensureDedicatedRuntimeDirectory,
    "function",
    "ensureDedicatedRuntimeDirectory must exist"
  );
  const parent = await mkdtemp(path.join(os.tmpdir(), "aqsh-note-runtime-parent-"));
  const target = path.join(parent, "new-profile");

  await ensureDedicatedRuntimeDirectory(target, "profile");

  assert.equal(
    await readFile(path.join(target, ".aqsh-note-profile"), "utf8"),
    "aqsh-note:profile:v1\n"
  );
});

test("accepts an existing nonstandard runtime directory only with its valid marker", async () => {
  const { assertDedicatedRuntimePath, ensureDedicatedRuntimeDirectory } = await loadSut();
  assert.equal(typeof assertDedicatedRuntimePath, "function", "assertDedicatedRuntimePath must exist");
  const parent = await mkdtemp(path.join(os.tmpdir(), "aqsh-note-runtime-marked-"));
  const target = path.join(parent, "state");

  await ensureDedicatedRuntimeDirectory(target, "state");

  await assert.doesNotReject(() => assertDedicatedRuntimePath(target, "state"));
});
