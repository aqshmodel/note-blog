import { AqshNoteError } from "./errors.mjs";

const NOTE_KEY_PATTERN = /^n[a-z0-9]{8,32}$/i;

export function validateNoteKey(value) {
  const key = typeof value === "string" ? value.trim() : "";
  if (!NOTE_KEY_PATTERN.test(key)) {
    throw new AqshNoteError("NOTE_KEY_INVALID", "note keyの形式が不正です。", { value });
  }
  return key;
}

export function parseManagedNoteUrl(value, expectedAccountId) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AqshNoteError("NOTE_URL_INVALID", "note URLを解釈できません。", { value });
  }

  if (
    url.origin !== "https://note.com" ||
    url.username ||
    url.password
  ) {
    throw new AqshNoteError("NOTE_URL_NOT_ALLOWED", "https://note.com のURLだけを使用できます。", {
      value
    });
  }

  const match = url.pathname.match(/^\/([^/]+)\/n\/(n[a-z0-9]{8,32})\/?$/i);
  if (!match) {
    throw new AqshNoteError("NOTE_ARTICLE_URL_REQUIRED", "noteの記事URLが必要です。", { value });
  }

  const [, accountId, rawKey] = match;
  if (accountId !== expectedAccountId) {
    throw new AqshNoteError(
      "NOTE_ACCOUNT_MISMATCH",
      `管理対象は note.com/${expectedAccountId} です。`,
      { actual: accountId, expected: expectedAccountId }
    );
  }

  const key = validateNoteKey(rawKey);
  return {
    accountId,
    key,
    canonicalUrl: `https://note.com/${accountId}/n/${key}`
  };
}
