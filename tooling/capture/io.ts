import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import canonicalize from "canonicalize";
import { type Node as JsonNode, parseTree } from "jsonc-parser";
import { assertCanonicalDirectory } from "../lab/inventory.js";
import { isRecord, sha256 } from "../verification/files.js";

export class CaptureError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export function requireCapture(condition: unknown, code: string): asserts condition {
  if (!condition) throw new CaptureError(code);
}

export function object(value: unknown): Record<string, unknown> {
  requireCapture(isRecord(value), "capture-invalid-object");
  return value;
}

export function closed(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const result = object(value);
  requireCapture(
    Object.keys(result).every((key) => keys.includes(key)),
    "capture-unknown-field",
  );
  return result;
}

export function textValue(value: unknown, maximum = 4096): string {
  requireCapture(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= maximum &&
      ![...value].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || (code >= 127 && code <= 159);
      }),
    "capture-invalid-text",
  );
  return value;
}

export function array(value: unknown, maximum = 64): readonly unknown[] {
  requireCapture(Array.isArray(value) && value.length <= maximum, "capture-invalid-array");
  return value;
}

export function relativeFile(value: unknown): string {
  const result = textValue(value, 1024);
  requireCapture(
    !path.isAbsolute(result) &&
      !result.includes("\\") &&
      result
        .split("/")
        .every((part) => part !== "" && part !== "." && part !== ".." && part !== ".git"),
    "capture-invalid-relative-file",
  );
  return result;
}

export function canonicalDigest(value: unknown): string {
  const encoded = canonicalize(value);
  requireCapture(typeof encoded === "string", "capture-invalid-json");
  return sha256(encoded);
}

export function selfDigest(value: Record<string, unknown>, key: string): void {
  const { [key]: actual, ...body } = value;
  requireCapture(actual === canonicalDigest(body), "capture-artifact-digest-mismatch");
}

function uniqueKeys(node: JsonNode): boolean {
  if (node.type === "object") {
    const names = (node.children ?? []).map((entry) => entry.children?.[0]?.value);
    if (new Set(names).size !== names.length) return false;
  }
  return (node.children ?? []).every(uniqueKeys);
}

export function decodeJson(bytes: Buffer): Record<string, unknown> {
  const source = bytes.toString("utf8");
  requireCapture(Buffer.from(source).equals(bytes), "capture-invalid-utf8");
  const errors: { error: number; offset: number; length: number }[] = [];
  const tree = parseTree(source, errors, { allowTrailingComma: false, disallowComments: true });
  requireCapture(
    tree !== undefined && errors.length === 0 && uniqueKeys(tree),
    "capture-invalid-json",
  );
  return object(JSON.parse(source));
}

export interface FileObservation {
  readonly digest: string;
  readonly bytes: number;
  readonly device: string;
  readonly inode: string;
  readonly mode: string;
  readonly modified: string;
}

/** Pin a real file while reading it; a same-byte replacement remains observable. */
export function readObservedFile(file: string, maximumBytes = 16 * 1024 * 1024) {
  assertCanonicalDirectory(path.dirname(file));
  const before = lstatSync(file, { bigint: true });
  requireCapture(
    before.isFile() &&
      !before.isSymbolicLink() &&
      before.nlink === 1n &&
      before.size <= maximumBytes,
    "capture-unsafe-or-large-file",
  );
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd, { bigint: true });
    requireCapture(opened.dev === before.dev && opened.ino === before.ino, "capture-file-changed");
    // A concurrently growing file cannot turn the bounded read into an unbounded allocation.
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, length);
      if (count === 0) break;
      length += count;
    }
    const bytes = buffer.subarray(0, length);
    const after = fstatSync(fd, { bigint: true });
    const named = lstatSync(file, { bigint: true });
    requireCapture(
      after.size === before.size &&
        after.mtimeNs === before.mtimeNs &&
        after.ctimeNs === before.ctimeNs &&
        after.nlink === 1n &&
        named.ino === before.ino &&
        named.dev === before.dev &&
        bytes.length === Number(before.size),
      "capture-file-changed",
    );
    const observation: FileObservation = {
      digest: sha256(bytes),
      bytes: bytes.length,
      device: String(before.dev),
      inode: String(before.ino),
      mode: String(before.mode),
      modified: String(before.mtimeNs),
    };
    return { bytes, observation };
  } finally {
    closeSync(fd);
  }
}

export function readJson(file: string) {
  return decodeJson(readObservedFile(file).bytes);
}

/** Never replace an existing record, including a partial record left by a crash. */
export function writeExclusive(file: string, bytes: Buffer | string): void {
  assertCanonicalDirectory(path.dirname(file));
  const fd = openSync(file, "wx", 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (process.platform !== "win32") {
    const directory = openSync(path.dirname(file), "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  }
}

export function writeExclusiveJson(file: string, value: unknown): void {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  requireCapture(bytes.length <= 16 * 1024 * 1024, "capture-json-budget");
  writeExclusive(file, bytes);
}

export function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}
