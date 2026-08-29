import type { BigIntStats } from "node:fs";
import { lstat } from "node:fs/promises";
import nodePath from "node:path";

import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import {
  createFileNodeSnapshot,
  FileNodeSnapshotError,
  type FileNodeSnapshot,
} from "./file-node-snapshot.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "./rooted-directory.js";

/**
 * Wakeflow Foundation / Filesystem：规范绝对目录位置的只读物理观察。
 *
 * 本能力从平台文件系统根开始，逐段对调用方提供的规范绝对路径执行 `lstat`。遇到
 * 缺失段时立即返回“缺失”，遇到符号链接或非目录节点时立即失败；完整路径存在时，
 * 返回真实路径和最终目录节点快照。缺失时还固定最近一个已存在的非文件系统根祖先，
 * 供上层判断规范拼写或建立后续RootedDirectory。它不创建目录、不解析配置相对路径、
 * 不判断多个根目录是否重叠，也不授予后续文件 I/O 权限。
 *
 * `RootedDirectory` 用于已经打开的根目录内的资源操作；本模块用于准入尚未创建，
 * 或可能位于 Workspace 同级位置的目录布局。Node.js 未暴露 `openat`，因此逐段检查
 * 仍是基于路径名的尽力验证，不能充当抵抗同权限恶意进程的操作系统沙箱。
 */

/** 缺失目标最近一个已存在、经过句柄复验的非文件系统根祖先。 */
interface AbsoluteDirectoryPlacementAncestorObservation {
  readonly absolutePath: string;
  readonly realPath: string;
  readonly spellingIsCanonical: boolean;
  readonly node: Readonly<FileNodeSnapshot>;
}

export interface AbsoluteDirectoryPlacementObservation {
  readonly absolutePath: string;
  readonly state: "present" | "missing";
  readonly realPath: string | null;
  readonly spellingIsCanonical: boolean | null;
  readonly node: Readonly<FileNodeSnapshot> | null;
  readonly nearestExistingAncestor:
    Readonly<AbsoluteDirectoryPlacementAncestorObservation> | null;
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

function mapRootError(
  error: RootedDirectoryError,
  path: string,
): never {
  if (error.reason === "root-input") fail("input", path);
  if (error.reason === "root-symlink") fail("symlink", path);
  if (error.reason === "root-type") fail("not-directory", path);
  fail("inspection-failure", path);
}

/**
 * 通过已打开目录句柄固定最终节点，并在关闭前复验路径名仍指向同一节点。
 *
 * 前面的逐段 `lstat` 负责拒绝路径链中的符号链接；这里复用 `RootedDirectory`，避免
 * 把一次较早的路径快照与另一次较晚的 `realpath` 结果拼成并不一致的观察。
 */
async function inspectStablePresentDirectory(
  absolutePath: string,
  path: string,
): Promise<Readonly<{
  realPath: string;
  node: Readonly<FileNodeSnapshot>;
}>> {
  let root: RootedDirectory;
  try {
    root = await RootedDirectory.open(absolutePath, path);
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) mapRootError(error, path);
    throw error;
  }

  let node: Readonly<FileNodeSnapshot> | undefined;
  let primaryError: unknown;
  try {
    node = await root.assertCurrent(path);
  } catch (error: unknown) {
    primaryError = error;
  }

  let closeError: unknown;
  try {
    await root.close();
  } catch (error: unknown) {
    closeError = error;
  }
  if (primaryError !== undefined) {
    if (primaryError instanceof RootedDirectoryError) {
      mapRootError(primaryError, path);
    }
    throw primaryError;
  }
  if (closeError !== undefined || node === undefined) {
    fail("inspection-failure", path);
  }
  return Object.freeze({ realPath: root.absolutePath, node });
}

/**
 * 观察一个规范绝对目录位置。
 *
 * `missing` 表示首个不存在路径段之后的整个目标尚未创建；它不是错误。结果为
 * `present` 时，`spellingIsCanonical` 明确告诉领域层，调用方给出的路径拼写是否等于
 * 文件系统真实路径；结果为`missing`时，最近已存在祖先提供同等的稳定拼写事实。
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
  let nearestExistingPath = parsed.root;
  let finalNode: Readonly<FileNodeSnapshot> | null = null;
  for (const segment of segments) {
    current = nodePath.join(current, segment);
    finalNode = await inspectOnePath(current, path);
    if (finalNode === null) {
      let nearestExistingAncestor:
        Readonly<AbsoluteDirectoryPlacementAncestorObservation> | null = null;
      if (nearestExistingPath !== parsed.root) {
        const stableAncestor = await inspectStablePresentDirectory(
          nearestExistingPath,
          path,
        );
        nearestExistingAncestor = Object.freeze({
          absolutePath: nearestExistingPath,
          realPath: stableAncestor.realPath,
          spellingIsCanonical:
            stableAncestor.realPath === nearestExistingPath,
          node: stableAncestor.node,
        });
      }
      return Object.freeze({
        absolutePath,
        state: "missing",
        realPath: null,
        spellingIsCanonical: null,
        node: null,
        nearestExistingAncestor,
      });
    }
    nearestExistingPath = current;
  }
  if (finalNode === null) fail("input", path);

  const stable = await inspectStablePresentDirectory(absolutePath, path);
  return Object.freeze({
    absolutePath,
    state: "present",
    realPath: stable.realPath,
    spellingIsCanonical: stable.realPath === absolutePath,
    node: stable.node,
    nearestExistingAncestor: null,
  });
}
