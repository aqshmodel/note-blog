export class AqshNoteError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "AqshNoteError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function toPublicError(error, options = {}) {
  if (error instanceof AqshNoteError) {
    return {
      code: error.code,
      message: error.message
    };
  }

  const rawMessage = String(error?.message ?? error ?? "");
  if (
    /launchPersistentContext/i.test(rawMessage) &&
    /(existing browser session|既存のブラウザ\s*セッション|ProcessSingleton|SingletonLock)/i.test(rawMessage)
  ) {
    return {
      code: "PROFILE_BROWSER_STILL_RUNNING",
      message: "note専用Chromeがまだ実行中です。専用Chromeを⌘Qで終了してから再実行してください。"
    };
  }

  return {
    code: options.fallbackCode ?? "UNEXPECTED_ERROR",
    message: options.fallbackMessage ?? "予期しないエラーが発生しました。詳細は保存せず停止しました。"
  };
}
