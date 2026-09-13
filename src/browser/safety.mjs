import { AqshNoteError } from "../errors.mjs";
import { parseManagedNoteUrl } from "../note-url.mjs";
import { textEditorContract } from "./editor-contract.mjs";

const FORBIDDEN_CONTROL_JA = /(公開|投稿|更新する)/;
const FORBIDDEN_CONTROL_EN = /(publish|post|update)/i;
const ALLOWED_ACTION_KINDS = new Set([
  "verify_account",
  "verify_editor_contract",
  "save_draft",
  "open_new_editor",
  "fill_title",
  "insert_body_html",
  "verify"
]);
const DRAFT_ACTION_SEQUENCE = [
  "verify_account",
  "open_new_editor",
  "verify_editor_contract",
  "fill_title",
  "insert_body_html",
  "save_draft",
  "verify"
];
const ACTION_KEYS = {
  verify_account: new Set(["kind", "url", "accountId", "field"]),
  verify_editor_contract: new Set(["kind", "contract"]),
  open_new_editor: new Set(["kind", "url"]),
  fill_title: new Set(["kind", "value"]),
  insert_body_html: new Set(["kind", "html", "plainText"]),
  save_draft: new Set(["kind", "accessibleName"]),
  verify: new Set(["kind"])
};

function navigationError(value, purpose) {
  return new AqshNoteError(
    "NAVIGATION_FORBIDDEN",
    "管理対象外のnote URLへの移動を拒否しました。",
    { value, purpose }
  );
}

function baseUrl(value, purpose) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw navigationError(value, purpose);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "note.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw navigationError(value, purpose);
  }
  return url;
}

function hasNoQuery(url) {
  return [...url.searchParams].length === 0;
}

export function assertAllowedNoteNavigation(value, { accountId, purpose }) {
  const url = baseUrl(value, purpose);
  const accountPath = `/${accountId}`;

  if (purpose === "login") {
    const params = [...url.searchParams];
    if (
      url.pathname !== "/login" ||
      params.length !== 1 ||
      url.searchParams.get("redirectPath") !== accountPath
    ) {
      throw navigationError(value, purpose);
    }
    return url.toString();
  }

  if (purpose === "new-editor") {
    if (url.pathname !== "/notes/new" || !hasNoQuery(url)) throw navigationError(value, purpose);
    return "https://note.com/notes/new";
  }

  if (purpose === "profile") {
    if (url.pathname !== accountPath || !hasNoQuery(url)) throw navigationError(value, purpose);
    return `https://note.com${accountPath}`;
  }

  if (purpose === "account-settings") {
    if (url.pathname !== "/settings/account/note_id" || !hasNoQuery(url)) throw navigationError(value, purpose);
    return "https://note.com/settings/account/note_id";
  }

  if (purpose === "article") {
    if (!hasNoQuery(url)) throw navigationError(value, purpose);
    try {
      return parseManagedNoteUrl(url.toString(), accountId).canonicalUrl;
    } catch {
      throw navigationError(value, purpose);
    }
  }

  throw navigationError(value, purpose);
}

export function assertSafeUiAction(action) {
  if (!action || typeof action !== "object") {
    throw new AqshNoteError("UI_ACTION_INVALID", "UI操作の定義が不正です。");
  }
  const accessibleName = String(action.accessibleName ?? "").trim();
  const controlMetadata = [
    action.kind,
    action.selector,
    action.role,
    action.accessibleName,
    action.url
  ].map(value => String(value ?? "")).join(" ");
  if (FORBIDDEN_CONTROL_JA.test(controlMetadata) || FORBIDDEN_CONTROL_EN.test(controlMetadata)) {
    throw new AqshNoteError(
      "PUBLISH_CONTROL_FORBIDDEN",
      "公開・投稿・公開済み記事更新につながる操作を拒否しました。",
      { accessibleName }
    );
  }
  if (!ALLOWED_ACTION_KINDS.has(String(action.kind ?? ""))) {
    throw new AqshNoteError("UI_ACTION_INVALID", "許可されていないUI操作種別です。");
  }
  const kind = String(action.kind);
  if (Object.keys(action).some(key => !ACTION_KEYS[kind].has(key))) {
    throw new AqshNoteError("UI_ACTION_INVALID", "UI操作に許可されていない項目があります。");
  }

  if (kind === "verify_account") {
    const field = action.field;
    if (
      action.accountId !== "aqsh" ||
      !field || typeof field !== "object" || Array.isArray(field) ||
      Object.keys(field).length !== 4 ||
      !["name", "ariaLabel", "expectedValue", "count"].every(key => Object.hasOwn(field, key)) ||
      field.name !== "urlname" ||
      field.ariaLabel !== "note ID" ||
      field.expectedValue !== "aqsh" ||
      field.count !== 1
    ) {
      throw new AqshNoteError("UI_ACTION_INVALID", "Aqshアカウント本人確認の定義が不正です。");
    }
    const url = assertAllowedNoteNavigation(action.url, {
      accountId: action.accountId,
      purpose: "account-settings"
    });
    return {
      kind,
      url,
      accountId: action.accountId,
      field: { ...field }
    };
  }

  if (kind === "verify_editor_contract") {
    const expected = textEditorContract();
    if (JSON.stringify(action.contract) !== JSON.stringify(expected)) {
      throw new AqshNoteError("UI_ACTION_INVALID", "noteエディタ契約の定義が不正です。");
    }
    return { kind, contract: expected };
  }

  if (kind === "open_new_editor") {
    const url = assertAllowedNoteNavigation(action.url, { accountId: "aqsh", purpose: "new-editor" });
    return { kind, url };
  }
  if (kind === "fill_title") {
    if (typeof action.value !== "string" || !action.value.trim()) {
      throw new AqshNoteError("UI_ACTION_INVALID", "タイトル入力値が不正です。");
    }
    return { kind, value: action.value };
  }
  if (kind === "insert_body_html") {
    if (
      typeof action.html !== "string" || !action.html.trim() ||
      typeof action.plainText !== "string" || !action.plainText.trim()
    ) {
      throw new AqshNoteError("UI_ACTION_INVALID", "本文入力値が不正です。");
    }
    return { kind, html: action.html, plainText: action.plainText };
  }
  if (kind === "save_draft") {
    if (action.accessibleName !== "下書き保存") {
      throw new AqshNoteError("UI_ACTION_INVALID", "下書き保存の操作名が一致しません。");
    }
    return { kind, accessibleName: action.accessibleName };
  }
  return { kind };
}

export function assertSafeUiActionPlan(actions) {
  if (
    !Array.isArray(actions) ||
    actions.length !== DRAFT_ACTION_SEQUENCE.length ||
    actions.some((action, index) => action?.kind !== DRAFT_ACTION_SEQUENCE[index])
  ) {
    throw new AqshNoteError("UI_ACTION_PLAN_INVALID", "UI操作計画の順序または回数が不正です。");
  }
  return actions.map(action => assertSafeUiAction(action));
}
