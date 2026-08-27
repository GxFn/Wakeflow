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
 * Wakeflow Foundation / Filesystem：规范绝对目录位置的只读物理观察。
 *
 * 本能力从平台文件系统根开始，逐段对调用方提供的规范绝对路径执行 `lstat`。遇到
 * 缺失段时立即返回“缺失”，遇到符号链接或非目录节点时立即失败；完整路径存在时，
 * 返回真实路径和最终目录节点快照。它不创建目录、不解析配置相对路径、不判断多个
 * 根目录是否重叠，也不授予后续文件 I/O 权限。
 *
 * `RootedDirectory` 用于已经打开的根目录内的资源操作；本模块用于准入尚未创建，
 * 或可能位于 Workspace 同级位置的目录布局。Node.js 未暴露 `openat`，因此逐段检查
 * 仍是基于路径名的尽力验证，不能充当抵抗同权限恶意进程的操作系统沙箱。
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

/** 绝对目录位置观察失败时返回的稳定、脱敏错误。 */
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
 * 观察一个规范绝对目录位置。
 *
 * `missing` 表示首个不存在路径段之后的整个目标尚未创建；它不是错误。结果为
 * `present` 时，`spellingIsCanonical` 明确告诉领域层，调用方给出的路径拼写是否等于
 * 文件系统真实路径。
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
