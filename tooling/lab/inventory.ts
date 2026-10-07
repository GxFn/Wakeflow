import { spawnSync } from "node:child_process";
import type { Stats } from "node:fs";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { isRecord, sha256 } from "../verification/files.js";

export class LabError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export interface TreeEntry {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly dev: number;
  readonly ino: number;
  readonly mode: number;
  readonly digest: string | null;
}

export function assertCanonicalDirectory(root: string): void {
  if (!path.isAbsolute(root) || path.resolve(root) !== root || realpathSync(root) !== root)
    throw new LabError("lab-noncanonical-root");
  let current = path.parse(root).root;
  for (const segment of path.relative(current, root).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new LabError("lab-unsafe-directory");
  }
}

function stableFileDigest(absolute: string, before: Stats): string {
  const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1)
      throw new LabError("lab-tree-changed-during-read");
    const content = readFileSync(fd);
    const after = fstatSync(fd);
    if (
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      content.length !== before.size
    )
      throw new LabError("lab-tree-changed-during-read");
    return sha256(content);
  } finally {
    closeSync(fd);
  }
}

/** Bounded private inventory. Do not follow links, devices or multiply-linked files. */
export function snapshotLabTree(root: string): readonly TreeEntry[] {
  assertCanonicalDirectory(root);
  const entries: TreeEntry[] = [];
  let bytes = 0;
  function walk(relative: string): void {
    if (entries.length >= 20_000) throw new LabError("lab-inventory-limit");
    const absolute = path.join(root, relative);
    const before = lstatSync(absolute);
    if (before.dev !== entries[0]?.dev && entries.length > 0)
      throw new LabError("lab-mounted-resource");
    const common = { path: relative, dev: before.dev, ino: before.ino, mode: before.mode & 0o777 };
    if (before.isDirectory() && !before.isSymbolicLink()) {
      entries.push({ ...common, kind: "directory", digest: null });
      for (const name of readdirSync(absolute).sort())
        walk(relative ? `${relative}/${name}` : name);
      const after = lstatSync(absolute);
      if (before.dev !== after.dev || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs)
        throw new LabError("lab-tree-changed-during-read");
    } else {
      if (!before.isFile() || before.nlink !== 1 || before.size > 16 * 1024 * 1024)
        throw new LabError("lab-unsafe-file");
      bytes += before.size;
      if (bytes > 128 * 1024 * 1024) throw new LabError("lab-inventory-limit");
      entries.push({ ...common, kind: "file", digest: stableFileDigest(absolute, before) });
    }
  }
  walk("");
  return entries;
}

export function parseInventory(value: unknown): readonly TreeEntry[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20_000)
    throw new LabError("lab-invalid-inventory");
  const entries = value.map((entry: unknown): TreeEntry => {
    if (
      !isRecord(entry) ||
      typeof entry.path !== "string" ||
      (entry.path !== "" &&
        (entry.path.includes("\\") ||
          entry.path.split("/").some((part) => part === "" || part === "." || part === ".."))) ||
      (entry.kind !== "file" && entry.kind !== "directory") ||
      !Number.isSafeInteger(entry.dev) ||
      !Number.isSafeInteger(entry.ino) ||
      !Number.isSafeInteger(entry.mode) ||
      (entry.kind === "directory"
        ? entry.digest !== null
        : typeof entry.digest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(entry.digest))
    )
      throw new LabError("lab-invalid-inventory");
    return {
      path: entry.path,
      kind: entry.kind,
      dev: entry.dev as number,
      ino: entry.ino as number,
      mode: entry.mode as number,
      digest: entry.digest as string | null,
    };
  });
  if (
    entries[0]?.path !== "" ||
    entries[0].kind !== "directory" ||
    new Set(entries.map((entry) => entry.path)).size !== entries.length
  )
    throw new LabError("lab-invalid-inventory");
  return entries;
}

export function inventoryDigest(entries: readonly TreeEntry[]): string {
  return sha256(
    JSON.stringify(
      entries.map(({ path, kind, dev, ino, mode, digest }) => [path, kind, dev, ino, mode, digest]),
    ),
  );
}

export function assertSameInventory(
  expected: readonly TreeEntry[],
  actual: readonly TreeEntry[],
): void {
  if (inventoryDigest(expected) !== inventoryDigest(actual))
    throw new LabError("lab-resource-drift");
}

/** No recursive rm: newly introduced entries make rmdir fail, rather than being silently adopted. */
export function removeInventoriedTree(root: string, expected: readonly TreeEntry[]): void {
  assertSameInventory(expected, snapshotLabTree(root));
  const directories = new Map(
    expected.filter((entry) => entry.kind === "directory").map((entry) => [entry.path, entry]),
  );
  for (const entry of [...expected].reverse()) {
    assertCanonicalDirectory(root);
    let parent = entry.path;
    do {
      parent = parent === "" ? "" : path.posix.dirname(parent);
      if (parent === ".") parent = "";
      const owned = directories.get(parent);
      const stat = lstatSync(path.join(root, parent));
      if (
        owned === undefined ||
        !stat.isDirectory() ||
        stat.dev !== owned.dev ||
        stat.ino !== owned.ino
      )
        throw new LabError("lab-resource-drift");
    } while (parent !== "");
    const absolute = path.join(root, entry.path);
    const stat = lstatSync(absolute);
    if (
      stat.dev !== entry.dev ||
      stat.ino !== entry.ino ||
      (stat.mode & 0o777) !== entry.mode ||
      stat.isSymbolicLink()
    )
      throw new LabError("lab-resource-drift");
    if (entry.kind === "directory") rmdirSync(absolute);
    else {
      if (!stat.isFile() || stat.nlink !== 1 || stableFileDigest(absolute, stat) !== entry.digest)
        throw new LabError("lab-resource-drift");
      unlinkSync(absolute);
    }
  }
}

/** Fixed synthetic repos only; caller must validate the complete tree before invoking Git. */
export function labGit(cwd: string, args: readonly string[]): string {
  const result = spawnSync(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "commit.gpgSign=false",
      ...args,
    ],
    {
      cwd,
      encoding: "utf8",
      shell: false,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      env: {
        PATH: process.env.PATH ?? "",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
        GIT_OPTIONAL_LOCKS: "0",
      },
    },
  );
  if (result.error !== undefined || result.status !== 0) throw new LabError("lab-git-unavailable");
  return result.stdout.trim();
}
