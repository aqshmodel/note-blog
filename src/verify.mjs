function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sameList(expected = [], actual = []) {
  return expected.length === actual.length && expected.every((item, index) => normalize(item) === normalize(actual[index]));
}

function bodyWithinTolerance(expected, actual, tolerance) {
  if (expected.length === 0) return actual.length === 0;
  return Math.abs(actual.length - expected.length) / expected.length <= tolerance;
}

function fingerprint(value) {
  const text = normalize(value);
  const size = Math.min(64, Math.max(12, Math.floor(text.length / 3)));
  const middleStart = Math.max(0, Math.floor((text.length - size) / 2));
  return {
    start: text.slice(0, size),
    middle: text.slice(middleStart, middleStart + size),
    end: text.slice(-size)
  };
}

function hasMatchingFingerprint(expected, actual) {
  if (!expected) return !actual;
  const parts = fingerprint(expected);
  return Object.values(parts).every(part => actual.includes(part));
}

function isDuplicated(expected, actual) {
  if (!expected || actual.length < expected.length * 1.8) return false;
  const withoutSeparator = actual.replace(/\s+/g, " ").trim();
  return withoutSeparator === `${expected} ${expected}` || withoutSeparator === `${expected}${expected}`;
}

export function compareArticleSnapshots(expectedSnapshot, actualSnapshot, options = {}) {
  const tolerance = options.bodyLengthTolerance ?? 0.05;
  const expectedText = normalize(expectedSnapshot.text);
  const actualText = normalize(actualSnapshot.text);
  const duplicated = isDuplicated(expectedText, actualText);
  const checks = {
    title: normalize(expectedSnapshot.title) === normalize(actualSnapshot.title),
    body: bodyWithinTolerance(expectedText, actualText, tolerance),
    text: expectedText === actualText,
    headings:
      sameList(expectedSnapshot.h2, actualSnapshot.h2) &&
      sameList(expectedSnapshot.h3, actualSnapshot.h3),
    images: Number(expectedSnapshot.imageCount) === Number(actualSnapshot.imageCount),
    fingerprint: hasMatchingFingerprint(expectedText, actualText),
    duplication: duplicated
  };

  const reasons = [];
  if (!checks.title) reasons.push("title_mismatch");
  if (!checks.body) reasons.push("body_length_mismatch");
  if (!checks.text) reasons.push("body_text_mismatch");
  if (!checks.headings) reasons.push("headings_mismatch");
  if (!checks.images) reasons.push("image_count_mismatch");
  if (!checks.fingerprint) reasons.push("text_fingerprint_mismatch");
  if (checks.duplication) reasons.push("body_duplicated");

  return {
    ok: reasons.length === 0,
    checks,
    reasons,
    expected: {
      bodyCharacters: expectedText.length,
      h2: expectedSnapshot.h2?.length ?? 0,
      h3: expectedSnapshot.h3?.length ?? 0,
      images: Number(expectedSnapshot.imageCount ?? 0)
    },
    actual: {
      bodyCharacters: actualText.length,
      h2: actualSnapshot.h2?.length ?? 0,
      h3: actualSnapshot.h3?.length ?? 0,
      images: Number(actualSnapshot.imageCount ?? 0)
    }
  };
}
