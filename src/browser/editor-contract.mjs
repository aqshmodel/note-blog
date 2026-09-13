import { AqshNoteError } from "../errors.mjs";
import { parseNoteEditorUrl } from "../note-url.mjs";

const CONTRACT = {
  version: "note-text-editor-2026-09-v1",
  title: {
    strategy: "placeholder",
    value: "記事タイトル",
    tag: "textarea",
    count: 1
  },
  body: {
    strategy: "role-and-attributes",
    role: "textbox",
    tag: "div",
    contentEditable: "true",
    ariaMultiline: "true",
    count: 1
  },
  save: {
    role: "button",
    name: "下書き保存",
    exact: true,
    count: 1
  },
  publish: {
    role: "button",
    name: "公開に進む",
    exact: true,
    count: 1,
    forbidden: true
  }
};

function mismatch() {
  return new AqshNoteError(
    "EDITOR_UI_CONTRACT_MISMATCH",
    "noteエディタの現行UI契約を一意に確認できないため停止しました。"
  );
}

export function textEditorContract() {
  return structuredClone(CONTRACT);
}

export function assertTextEditorContract(observation) {
  let editor;
  try {
    editor = parseNoteEditorUrl(observation?.url);
  } catch {
    throw mismatch();
  }

  const title = Array.isArray(observation?.title) ? observation.title : [];
  const body = Array.isArray(observation?.body) ? observation.body : [];
  if (
    title.length !== 1 ||
    title[0]?.tag !== CONTRACT.title.tag ||
    title[0]?.placeholder !== CONTRACT.title.value ||
    title[0]?.visible !== true ||
    body.length !== 1 ||
    body[0]?.tag !== CONTRACT.body.tag ||
    body[0]?.role !== CONTRACT.body.role ||
    body[0]?.contentEditable !== CONTRACT.body.contentEditable ||
    body[0]?.ariaMultiline !== CONTRACT.body.ariaMultiline ||
    body[0]?.visible !== true ||
    observation?.saveControlCount !== CONTRACT.save.count ||
    observation?.publishControlCount !== CONTRACT.publish.count
  ) throw mismatch();

  return {
    version: CONTRACT.version,
    key: editor.key,
    url: editor.canonicalUrl
  };
}
