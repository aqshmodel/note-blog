import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadSut() {
  try {
    return await import(pathToFileURL(path.resolve("src/browser/safety.mjs")));
  } catch {
    return {};
  }
}

test("allows only the Aqsh profile, login, editor, and managed article routes", async () => {
  const { assertAllowedNoteNavigation } = await loadSut();
  assert.equal(typeof assertAllowedNoteNavigation, "function", "assertAllowedNoteNavigation must exist");

  assert.equal(
    assertAllowedNoteNavigation("https://note.com/login?redirectPath=%2Faqsh", {
      accountId: "aqsh",
      purpose: "login"
    }),
    "https://note.com/login?redirectPath=%2Faqsh"
  );
  assert.equal(
    assertAllowedNoteNavigation("https://note.com/notes/new", { accountId: "aqsh", purpose: "new-editor" }),
    "https://note.com/notes/new"
  );
  assert.equal(
    assertAllowedNoteNavigation("https://note.com/settings/account/note_id", {
      accountId: "aqsh",
      purpose: "account-settings"
    }),
    "https://note.com/settings/account/note_id"
  );
  assert.equal(
    assertAllowedNoteNavigation("https://note.com/aqsh/n/n9b5c6afb2521", {
      accountId: "aqsh",
      purpose: "article"
    }),
    "https://note.com/aqsh/n/n9b5c6afb2521"
  );
});

test("rejects lookalike hosts, credentials, ports, and out-of-scope routes", async () => {
  const { assertAllowedNoteNavigation } = await loadSut();
  assert.equal(typeof assertAllowedNoteNavigation, "function", "assertAllowedNoteNavigation must exist");

  for (const [value, purpose] of [
    ["https://note.com.example/aqsh", "profile"],
    ["https://user:pass@note.com/aqsh", "profile"],
    ["https://note.com:444/aqsh", "profile"],
    ["https://note.com/settings", "profile"],
    ["https://note.com/settings/account", "account-settings"],
    ["https://note.com/settings/account?from=other", "account-settings"],
    ["https://note.com/settings/account/note_id?from=other", "account-settings"],
    ["https://note.com/login?redirectPath=https%3A%2F%2Fevil.example", "login"],
    ["https://note.com/other/n/n9b5c6afb2521", "article"]
  ]) {
    assert.throws(
      () => assertAllowedNoteNavigation(value, { accountId: "aqsh", purpose }),
      error => error?.code === "NAVIGATION_FORBIDDEN"
    );
  }
});

test("allows only explicit draft-plan actions and blocks generic clicks", async () => {
  const { assertSafeUiAction } = await loadSut();
  assert.equal(typeof assertSafeUiAction, "function", "assertSafeUiAction must exist");

  assert.deepEqual(assertSafeUiAction({ kind: "save_draft", accessibleName: "下書き保存" }), {
    kind: "save_draft",
    accessibleName: "下書き保存"
  });

  assert.throws(
    () => assertSafeUiAction({ kind: "click", accessibleName: "閉じる" }),
    error => error?.code === "UI_ACTION_INVALID"
  );

  for (const accessibleName of ["公開に進む", "公開する", "投稿", "更新する", "Publish", "Post now"]) {
    assert.throws(
      () => assertSafeUiAction({ kind: "click", accessibleName }),
      error => error?.code === "PUBLISH_CONTROL_FORBIDDEN"
    );
  }

  assert.throws(
    () => assertSafeUiAction({ kind: "save_draft", accessibleName: "公開する" }),
    error => error?.code === "PUBLISH_CONTROL_FORBIDDEN"
  );

  for (const action of [
    { kind: "save_draft", accessibleName: "閉じる" },
    { kind: "save_draft", accessibleName: "下書き保存", selector: "button:last-child" },
    { kind: "open_new_editor", url: "https://evil.example/notes/new" },
    { kind: "fill_title", value: "", selector: "textarea" },
    { kind: "insert_body_html", html: "<p>本文</p>", plainText: "本文", url: "https://note.com/login" },
    { kind: "verify", selector: "*" }
  ]) {
    assert.throws(
      () => assertSafeUiAction(action),
      error => error?.code === "UI_ACTION_INVALID" || error?.code === "NAVIGATION_FORBIDDEN"
    );
  }

  for (const action of [
    { kind: "publish", accessibleName: "Continue" },
    { kind: "click", selector: "#publish", accessibleName: "Continue" },
    { kind: "publish_now", accessibleName: "Continue" },
    { kind: "publishNow", accessibleName: "Continue" },
    { kind: "post_article", accessibleName: "Continue" },
    { kind: "update_draft", accessibleName: "Continue" }
  ]) {
    assert.throws(
      () => assertSafeUiAction(action),
      error => error?.code === "PUBLISH_CONTROL_FORBIDDEN"
    );
  }
});

test("validates every action in a plan before execution", async () => {
  const { assertSafeUiActionPlan } = await loadSut();
  assert.equal(typeof assertSafeUiActionPlan, "function", "assertSafeUiActionPlan must exist");

  assert.deepEqual(
    assertSafeUiActionPlan([
      { kind: "open_new_editor", url: "https://note.com/notes/new" },
      { kind: "fill_title", value: "タイトル" },
      { kind: "insert_body_html", html: "<p>本文</p>", plainText: "本文" },
      { kind: "save_draft", accessibleName: "下書き保存" },
      { kind: "verify" }
    ]).map(action => action.kind),
    ["open_new_editor", "fill_title", "insert_body_html", "save_draft", "verify"]
  );

  assert.throws(
    () => assertSafeUiActionPlan([
      { kind: "open_new_editor", url: "https://note.com/notes/new" },
      { kind: "click", accessibleName: "閉じる" }
    ]),
    error => error?.code === "UI_ACTION_PLAN_INVALID"
  );

  for (const actions of [
    [
      { kind: "save_draft", accessibleName: "下書き保存" },
      { kind: "open_new_editor", url: "https://note.com/notes/new" },
      { kind: "fill_title", value: "タイトル" },
      { kind: "insert_body_html", html: "<p>本文</p>", plainText: "本文" },
      { kind: "verify" }
    ],
    [
      { kind: "open_new_editor", url: "https://note.com/notes/new" },
      { kind: "fill_title", value: "タイトル" },
      { kind: "insert_body_html", html: "<p>本文</p>", plainText: "本文" },
      { kind: "save_draft", accessibleName: "下書き保存" },
      { kind: "save_draft", accessibleName: "下書き保存" },
      { kind: "verify" }
    ]
  ]) {
    assert.throws(
      () => assertSafeUiActionPlan(actions),
      error => error?.code === "UI_ACTION_PLAN_INVALID"
    );
  }
});
