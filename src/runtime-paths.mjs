import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AqshNoteError } from "./errors.mjs";

const RUNTIME_KINDS = {
  profile: {
    root: () => path.join(os.homedir(), ".cache/aqsh-note"),
    forbiddenRoots: () => [
      path.join(os.homedir(), "Library/Application Support/Google/Chrome"),
      path.join(os.homedir(), ".config/google-chrome"),
      path.join(os.homedir(), "AppData/Local/Google/Chrome/User Data")
    ],
    marker: ".aqsh-note-profile",
    errorCode: "PROFILE_PATH_UNSAFE",
    label: "Chromeプロファイル"
  },
  state: {
    root: () => path.join(os.homedir(), ".local/state/aqsh-note"),
    marker: ".aqsh-note-state",
    errorCode: "STATE_PATH_UNSAFE",
    label: "実行状態"
  }
};

function runtimeKind(kind) {
  const definition = RUNTIME_KINDS[kind];
  if (!definition) {
    throw new AqshNoteError("RUNTIME_KIND_INVALID", "runtime directoryの種別が不正です。");
  }
  return definition;
}

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function canonicalizeWithMissingTail(value) {
  let cursor = path.resolve(value);
  const missing = [];
  while (true) {
    try {
      return path.join(await realpath(cursor), ...missing);
    } catch (error) {
      if (error.code !== "ENOENT") return path.resolve(value);
      const parent = path.dirname(cursor);
      if (parent === cursor) return path.resolve(value);
      missing.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

async function pathDetails(directory) {
  try {
    const details = await stat(directory);
    return { exists: true, isDirectory: details.isDirectory() };
  } catch (error) {
    if (error.code === "ENOENT") return { exists: false, isDirectory: false };
    throw error;
  }
}

function markerContents(kind) {
  return `aqsh-note:${kind}:v1\n`;
}

async function hasValidMarker(directory, definition, kind) {
  try {
    return await readFile(path.join(directory, definition.marker), "utf8") === markerContents(kind);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function unsafePathError(definition) {
  return new AqshNoteError(
    definition.errorCode,
    `${definition.label}にはAqsh専用root、新規ディレクトリ、または所有marker付きディレクトリだけを使用できます。`
  );
}

export async function assertDedicatedRuntimePath(directory, kind) {
  const definition = runtimeKind(kind);
  const [canonical, trustedRoot, forbiddenRoots] = await Promise.all([
    canonicalizeWithMissingTail(directory),
    canonicalizeWithMissingTail(definition.root()),
    Promise.all((definition.forbiddenRoots?.() ?? []).map(canonicalizeWithMissingTail))
  ]);
  if (forbiddenRoots.some(root => isWithin(canonical, root))) {
    throw unsafePathError(definition);
  }
  const details = await pathDetails(canonical);
  if (details.exists && !details.isDirectory) throw unsafePathError(definition);

  const trusted = isWithin(canonical, trustedRoot);
  if (details.exists) {
    const markerPath = path.join(canonical, definition.marker);
    let markerExists = false;
    try {
      await stat(markerPath);
      markerExists = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (markerExists && !(await hasValidMarker(canonical, definition, kind))) {
      throw unsafePathError(definition);
    }
    if (!trusted && !markerExists) throw unsafePathError(definition);
  }

  return { directory: canonical, trusted, exists: details.exists };
}

export async function ensureDedicatedRuntimeDirectory(directory, kind) {
  const definition = runtimeKind(kind);
  const validated = await assertDedicatedRuntimePath(directory, kind);
  await mkdir(validated.directory, { recursive: true, mode: 0o700 });

  if (await hasValidMarker(validated.directory, definition, kind)) return validated.directory;
  const entries = await readdir(validated.directory);
  if (!validated.trusted && entries.length > 0) throw unsafePathError(definition);

  const markerPath = path.join(validated.directory, definition.marker);
  try {
    await writeFile(markerPath, markerContents(kind), { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST" || !(await hasValidMarker(validated.directory, definition, kind))) {
      throw unsafePathError(definition);
    }
  }
  return validated.directory;
}
