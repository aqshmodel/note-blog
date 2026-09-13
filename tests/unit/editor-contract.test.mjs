import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadSut() {
  try {
    return await import(pathToFileURL(path.resolve("src/browser/editor-contract.mjs")));
  } catch {
    return {};
  }
}

function observation(overrides = {}) {
  return {
    url: "https://editor.note.com/notes/n9b5c6afb2521/edit/",
    title: [{ tag: "textarea", placeholder: "記事タイトル", visible: true }],
    body: [{
      tag: "div",
      role: "textbox",
      contentEditable: "true",
      ariaMultiline: "true",
      visible: true
    }],
    saveControlCount: 1,
    publishControlCount: 1,
    ...overrides
  };
}

test("accepts the observed text editor contract and extracts its draft key", async () => {
  const { assertTextEditorContract, textEditorContract } = await loadSut();
  assert.equal(typeof assertTextEditorContract, "function", "assertTextEditorContract must exist");
  assert.equal(typeof textEditorContract, "function", "textEditorContract must exist");

  const result = assertTextEditorContract(observation());

  assert.equal(result.key, "n9b5c6afb2521");
  assert.equal(result.url, "https://editor.note.com/notes/n9b5c6afb2521/edit/");
  assert.equal(result.version, "note-text-editor-2026-09-v1");
  assert.deepEqual(textEditorContract(), {
    version: "note-text-editor-2026-09-v1",
    title: { strategy: "placeholder", value: "記事タイトル", tag: "textarea", count: 1 },
    body: {
      strategy: "role-and-attributes",
      role: "textbox",
      tag: "div",
      contentEditable: "true",
      ariaMultiline: "true",
      count: 1
    },
    save: { role: "button", name: "下書き保存", exact: true, count: 1 },
    publish: { role: "button", name: "公開に進む", exact: true, count: 1, forbidden: true }
  });
});

test("fails closed when editor identity, fields, or controls differ", async () => {
  const { assertTextEditorContract } = await loadSut();

  for (const invalid of [
    observation({ url: "https://note.com/notes/n9b5c6afb2521/edit/" }),
    observation({ title: [] }),
    observation({ title: [observation().title[0], observation().title[0]] }),
    observation({ body: [{ ...observation().body[0], contentEditable: "false" }] }),
    observation({ saveControlCount: 0 }),
    observation({ publishControlCount: 2 })
  ]) {
    assert.throws(
      () => assertTextEditorContract(invalid),
      error => error?.code === "EDITOR_UI_CONTRACT_MISMATCH"
    );
  }
});
