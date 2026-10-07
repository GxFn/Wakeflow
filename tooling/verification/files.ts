import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function readBoundedFile(file: string, maximumBytes = 16 * 1024 * 1024): Buffer {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maximumBytes)
    throw new Error("Expected one bounded regular file.");
  const bytes = readFileSync(file);
  if (bytes.length > maximumBytes) throw new Error("File exceeded its byte limit.");
  return bytes;
}

/** Only create directories below the caller's root; never follow an existing symlink. */
export function privateDirectory(root: string, relative: string): string {
  let current = root;
  for (const name of relative.split("/")) {
    if (name === "" || name === "." || name === "..") throw new Error("Invalid directory segment.");
    current = path.join(current, name);
    try {
      mkdirSync(current, { mode: 0o700 });
    } catch (error: unknown) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe directory.");
  }
  return current;
}

/** These are disposable tooling reports, never Wakeflow business records. */
export function writeReport(file: string, value: unknown): void {
  const temporary = `${file}.next`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  renameSync(temporary, file);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function safeErrorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === "string" && /^[a-zA-Z0-9-]{1,80}$/u.test(error.code))
    return error.code;
  return "inspection-unavailable";
}
