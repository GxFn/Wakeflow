import type { BigIntStats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import nodePath from "node:path";

import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import {
  createFileNodeSnapshot,
  FileNodeSnapshotError,
  type FileNodeSnapshot,
} from "./file-node-snapshot.js";

/**
 * Wakeflow Foundation / Filesystem：一个规范绝对目录 placement 的只读物理观察。
 *
 * 本能力从平台文件系统根逐段 lstat 调用方给出的规范绝对路径；遇到缺失段立即返回
 * missing，遇到 symlink 或非目录立即失败，完整存在时返回 realpath 与最终目录节点
 * 快照。它不创建目录、不解析配置相对路径、不判断多个根是否重叠，也不授予后续
 * 文件 I/O 权限。
 *
 * RootedDirectory 用于一个已打开根内的资源操作；本文件则服务于“尚未物化或可能
 * 位于 workspace 兄弟位置”的布局 admission。Node 未暴露 openat，因此该逐段检查
 * 仍是 pathname-based best effort，不构成抵抗同权限恶意进程的 OS sandbox。
 */

export interface AbsoluteDirectoryPlacementObservation {
  readonly absolutePath: string;
  readonly state: "present" | "missing";
  readonly realPath: string | null;
  readonly spellingIsCanonical: boolean | null;
  readonly node: Readonly<FileNodeSnapshot> | null;
}

export type AbsoluteDirectoryPlacementErrorReason =
  | "input"
  | "symlink"
  | "not-directory"
  | "inspection-failure";

const ERROR_MESSAGES = {
  "input": "Absolute directory placement input is invalid.",
  "symlink": "Absolute directory placement contains a symbolic link.",
  "not-directory": "Absolute directory placement contains a non-directory node.",
  "inspection-failure": "Absolute directory placement could not be inspected safely.",
} as const satisfies Readonly<Record<
  AbsoluteDirectoryPlacementErrorReason,
  string
>>;

/** 绝对目录 placement 观察失败的稳定、脱敏错误。 */
export class AbsoluteDirectoryPlacementError extends Error {
  override readonly name = "AbsoluteDirectoryPlacementError";
  readonly code = "wakeflow-absolute-directory-placement" as const;
  readonly reason: AbsoluteDirectoryPlacementErrorReason;
  readonly path: string;

  constructor(reason: AbsoluteDirectoryPlacementErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

function fail(
  reason: AbsoluteDirectoryPlacementErrorReason,
  path: string,
): never {
  throw new AbsoluteDirectoryPlacementError(reason, path);
}

function normalizeErrorPath(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "$directory";
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
    || nodePath.parse(value).root === value
  ) {
    fail("input", path);
  }
  return value;
}

function snapshotDirectoryNode(
  stats: BigIntStats,
  path: string,
): Readonly<FileNodeSnapshot> {
  let node: Readonly<FileNodeSnapshot>;
  try {
    node = createFileNodeSnapshot(stats, path);
  } catch (error: unknown) {
    if (error instanceof FileNodeSnapshotError) {
      fail("inspection-failure", path);
    }
    throw error;
  }
  if (node.kind === "symbolic-link") fail("symlink", path);
  if (node.kind !== "directory") fail("not-directory", path);
  return node;
}

async function inspectOnePath(
  physicalPath: string,
  errorPath: string,
): Promise<Readonly<FileNodeSnapshot> | null> {
  let stats: BigIntStats;
  try {
    stats = await lstat(physicalPath, { bigint: true });
  } catch (error: unknown) {
    if (readNodeSystemErrorCode(error) === "ENOENT") return null;
    fail("inspection-failure", errorPath);
  }
  return snapshotDirectoryNode(stats, errorPath);
}

/**
 * 观察一个规范绝对目录 placement。
 *
 * `missing` 表示首个不存在段之后的整个目标尚未物化；它不是错误。present 时
 * `spellingIsCanonical` 明确告诉领域层，调用 spelling 是否等于文件系统 realpath。
 */
export async function inspectAbsoluteDirectoryPlacement(
  value: unknown,
  errorPath?: string,
): Promise<Readonly<AbsoluteDirectoryPlacementObservation>> {
  const path = normalizeErrorPath(errorPath);
  const absolutePath = parseAbsolutePath(value, path);
  const parsed = nodePath.parse(absolutePath);
  const relative = nodePath.relative(parsed.root, absolutePath);
  const segments = relative.split(nodePath.sep).filter((segment) => segment.length > 0);

  let current = parsed.root;
  let finalNode: Readonly<FileNodeSnapshot> | null = null;
  for (const segment of segments) {
    current = nodePath.join(current, segment);
    finalNode = await inspectOnePath(current, path);
    if (finalNode === null) {
      return Object.freeze({
        absolutePath,
        state: "missing",
        realPath: null,
        spellingIsCanonical: null,
        node: null,
      });
    }
  }
  if (finalNode === null) fail("input", path);

  let canonicalPath: string;
  try {
    canonicalPath = await realpath(absolutePath);
  } catch {
    fail("inspection-failure", path);
  }
  return Object.freeze({
    absolutePath,
    state: "present",
    realPath: canonicalPath,
    spellingIsCanonical: canonicalPath === absolutePath,
    node: finalNode,
  });
}
