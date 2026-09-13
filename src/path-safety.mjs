import { realpath } from "node:fs/promises";
import path from "node:path";

export function isPathWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export async function canonicalizePathWithMissingTail(value) {
  let cursor = path.resolve(value);
  const missing = [];
  while (true) {
    try {
      return path.join(await realpath(cursor), ...missing);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) return path.resolve(value);
      missing.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

export async function isPathWithinRoot(candidate, root) {
  try {
    const [canonicalCandidate, canonicalRoot] = await Promise.all([
      canonicalizePathWithMissingTail(candidate),
      canonicalizePathWithMissingTail(root)
    ]);
    return isPathWithin(canonicalCandidate, canonicalRoot);
  } catch {
    return false;
  }
}
