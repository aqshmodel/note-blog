import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadSut() {
  try {
    return await import(pathToFileURL(path.resolve("src/verify.mjs")));
  } catch {
    return {};
  }
}

const expected = {
  title: "検証記事",
  text: "冒頭の確認文です。 中央にある代表文です。 最後の確認文です。",
  h2: ["概要", "まとめ"],
  h3: ["詳細"],
  imageCount: 2
};

test("accepts an equivalent rendered snapshot", async () => {
  const { compareArticleSnapshots } = await loadSut();
  assert.equal(typeof compareArticleSnapshots, "function", "compareArticleSnapshots must exist");

  const result = compareArticleSnapshots(expected, {
    title: "検証記事",
    text: "  冒頭の確認文です。\n中央にある代表文です。 最後の確認文です。  ",
    h2: ["概要", "まとめ"],
    h3: ["詳細"],
    imageCount: 2
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.checks, {
    title: true,
    body: true,
    text: true,
    headings: true,
    images: true,
    fingerprint: true,
    duplication: false
  });
});

test("detects duplicated body content", async () => {
  const { compareArticleSnapshots } = await loadSut();
  assert.equal(typeof compareArticleSnapshots, "function", "compareArticleSnapshots must exist");
  const duplicated = `${expected.text} ${expected.text}`;

  const result = compareArticleSnapshots(expected, { ...expected, text: duplicated });

  assert.equal(result.ok, false);
  assert.equal(result.checks.duplication, true);
  assert.ok(result.reasons.includes("body_duplicated"));
});

test("fails when the body length differs by more than five percent", async () => {
  const { compareArticleSnapshots } = await loadSut();
  assert.equal(typeof compareArticleSnapshots, "function", "compareArticleSnapshots must exist");

  const result = compareArticleSnapshots(expected, { ...expected, text: "短い本文" });

  assert.equal(result.ok, false);
  assert.equal(result.checks.body, false);
  assert.ok(result.reasons.includes("body_length_mismatch"));
});

test("fails when large same-length sections differ outside sampled fingerprints", async () => {
  const { compareArticleSnapshots } = await loadSut();
  assert.equal(typeof compareArticleSnapshots, "function", "compareArticleSnapshots must exist");
  const expectedText = "A".repeat(3_000);
  const changedText = `${"A".repeat(100)}${"B".repeat(700)}${"A".repeat(1_300)}${"B".repeat(700)}${"A".repeat(200)}`;
  const expectedSnapshot = { ...expected, text: expectedText };

  const result = compareArticleSnapshots(expectedSnapshot, { ...expectedSnapshot, text: changedText });

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("body_text_mismatch"));
});
