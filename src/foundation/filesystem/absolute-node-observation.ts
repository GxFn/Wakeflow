import type { BigIntStats } from "node:fs";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import nodePath from "node:path";

import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import { createFileNodeSnapshot, FileNodeSnapshotError, type FileNodeSnapshot } from "./file-node-snapshot.js";

/**
 * Wakeflow Foundation / Filesystem：工作区根之外一个绝对路径节点的只读观察。
 *
 * 宿主中立层要看产品仓库的检出、worktree 指针文件与会话报告的 cwd：它们不在任何 Wakeflow 根
 * 之下，`RootedDirectory` 管不到，之前各处直接 `stat`/`realpath`/`readFile`。本端口把这些读操作
 * 收进 foundation（§13.166 批次 1）：`ENOENT`/`ENOTDIR` 是"不在"，其余失败是带 errno 的
 * `inspection-failure` / `read-failure`，调用方自己决定把"没能检查"当成什么——它不替调用方把
 * 失败说成缺席（open-items G7 留给批次 2）。
 */

export type AbsoluteNodeObservation =
  | Readonly<{ state: "present"; node: Readonly<FileNodeSnapshot>; realPath: string }>
  | Readonly<{ state: "missing" }>;

export type AbsoluteNodeObservationErrorReason =
  | "input"
  | "inspection-failure"
  | "read-failure";

const ERROR_MESSAGES = {
  "input": "Absolute node observation input is invalid.",
  "inspection-failure": "Absolute node could not be inspected safely.",
  "read-failure": "Absolute regular file could not be read safely.",
} as const satisfies Readonly<Record<AbsoluteNodeObservationErrorReason, string>>;

/** 绝对路径节点观察失败时返回的稳定、脱敏错误；原始异常只留在 `cause` 上。 */
export class AbsoluteNodeObservationError extends Error {
  override readonly name = "AbsoluteNodeObservationError";
  readonly code = "wakeflow-absolute-node-observation" as const;
  readonly reason: AbsoluteNodeObservationErrorReason;
  readonly path: string;

  constructor(reason: AbsoluteNodeObservationErrorReason, path: string, cause?: unknown) {
    super(ERROR_MESSAGES[reason], cause === undefined ? undefined : { cause });
    this.reason = reason;
    this.path = path;
  }
}

const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

function fail(reason: AbsoluteNodeObservationErrorReason, path: string, cause?: unknown): never {
  throw new AbsoluteNodeObservationError(reason, path, cause);
}

function normalizeErrorPath(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function parseAbsolutePath(value: unknown, path: string): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value !== value.trim()
    || !value.isWellFormed()
    || CONTROL_PATTERN.test(value)
    || !nodePath.isAbsolute(value)
    || nodePath.resolve(value) !== value
  ) {
    fail("input", path);
  }
  return value;
}

function isAbsence(error: unknown): boolean {
  const code = readNodeSystemErrorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
}

function snapshot(stats: BigIntStats, path: string): Readonly<FileNodeSnapshot> {
  try {
    return createFileNodeSnapshot(stats, path);
  } catch (error: unknown) {
    if (error instanceof FileNodeSnapshotError) fail("inspection-failure", path, error);
    throw error;
  }
}

export interface AbsoluteNodeObservationOptions {
  /** `true` 跟随符号链接（`stat`）；缺省按链接本身观察（`lstat`）。 */
  readonly follow?: boolean;
  readonly errorPath?: string;
}

function parseOptions(
  value: AbsoluteNodeObservationOptions | undefined,
  fallbackPath: string,
): Readonly<{ follow: boolean; path: string }> {
  if (value === undefined) return Object.freeze({ follow: false, path: fallbackPath });
  if (typeof value !== "object" || value === null) fail("input", fallbackPath);
  const path = normalizeErrorPath(value.errorPath, fallbackPath);
  if (value.follow !== undefined && typeof value.follow !== "boolean") fail("input", path);
  return Object.freeze({ follow: value.follow === true, path });
}

/**
 * 观察一个绝对路径：节点快照加 `realpath`。路径不存在（含中途不是目录）为 `missing`；其余
 * 观察失败为 `inspection-failure`。缺省按链接本身观察（`lstat`，`kind` 为 `symbolic-link`），
 * `follow: true` 跟随链接观察目标（`stat`）；`realPath` 两种情况下都是规范路径。
 */
export async function observeAbsoluteNode(
  value: unknown,
  optionsValue?: AbsoluteNodeObservationOptions,
): Promise<AbsoluteNodeObservation> {
  const options = parseOptions(optionsValue, "$node");
  const path = options.path;
  const absolutePath = parseAbsolutePath(value, path);
  let stats: BigIntStats;
  try {
    stats = options.follow
      ? await stat(absolutePath, { bigint: true })
      : await lstat(absolutePath, { bigint: true });
  } catch (error: unknown) {
    if (isAbsence(error)) return Object.freeze({ state: "missing" as const });
    fail("inspection-failure", path, error);
  }
  const node = snapshot(stats, path);
  let realPath: string;
  try {
    realPath = await realpath(absolutePath);
  } catch (error: unknown) {
    if (isAbsence(error)) return Object.freeze({ state: "missing" as const });
    fail("inspection-failure", path, error);
  }
  return Object.freeze({ state: "present" as const, node, realPath });
}

/**
 * 读一个绝对路径上的小普通文件（UTF-8，跟随符号链接）。不存在、不是普通文件或超过
 * `maximumBytes` 返回 null；其余失败为 `read-failure`。
 */
export async function readAbsoluteRegularFileText(
  value: unknown,
  maximumBytes: number,
  errorPath?: string,
): Promise<string | null> {
  const path = normalizeErrorPath(errorPath, "$file");
  const absolutePath = parseAbsolutePath(value, path);
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) fail("input", path);
  const observed = await observeAbsoluteNode(absolutePath, { follow: true, errorPath: path });
  if (observed.state === "missing" || observed.node.kind !== "file") return null;
  if (observed.node.byteCount > maximumBytes) return null;
  try {
    return await readFile(absolutePath, "utf8");
  } catch (error: unknown) {
    if (isAbsence(error)) return null;
    fail("read-failure", path, error);
  }
}

/**
 * 列出一个绝对路径目录的条目名（不跟随链接、不读节点），按名字排序，至多 `maximumEntries` 个；超出的
 * 不返回、以 `truncated` 计数。目录不存在（含中途不是目录）为 null；其余失败为 `inspection-failure`。
 */
export async function listAbsoluteDirectoryEntryNames(
  value: unknown,
  maximumEntries: number,
  errorPath?: string,
): Promise<Readonly<{ readonly names: readonly string[]; readonly truncated: number }> | null> {
  const path = normalizeErrorPath(errorPath, "$directory");
  const absolutePath = parseAbsolutePath(value, path);
  if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1) fail("input", path);
  let names: string[];
  try {
    names = await readdir(absolutePath);
  } catch (error: unknown) {
    if (isAbsence(error)) return null;
    fail("inspection-failure", path, error);
  }
  names.sort();
  return Object.freeze({
    names: Object.freeze(names.slice(0, maximumEntries)),
    truncated: Math.max(0, names.length - maximumEntries),
  });
}
