import { constants as fileSystemConstants } from "node:fs";

import { PassiveOwnDataError, pickOwnDataProperties } from "../data/passive-own-data.js";
import { type Fail, failWith, ModuleError } from "../error/module-error.js";
import { type ByteCount, ByteCountError, byteCountFromBigInt } from "../numeric/byte-count.js";

/**
 * Wakeflow Foundation / Filesystem：Node.js 文件系统节点的物理快照。
 *
 * 本模块把一次 `bigint` Stats 观察转换为冻结、无行为的节点事实，并分别提供
 * “同一设备号和 inode”与“完整观察未变化”两种比较。它不执行 `stat`、`lstat`
 * 或 `open`，不证明输入确实来自 Node.js，也不判断路径、所有者、权限位、链接数
 * 或节点类型是否满足某个领域策略。
 *
 * 访问时间会因读取而变化，创建时间的跨平台语义也不适合作为 Wakeflow 稳定性边界，
 * 因此二者不进入快照；`mtimeNs` 与 `ctimeNs` 继续保留精确的 `bigint` 值。
 *
 * 快照只在进程内存在、从不持久化，比较直接读字段：调用方给的预期是本模块签发的类型化快照，
 * 不再复验（1.4.5 层次计划 A：运行时校验只留在信任边界）。跨一次硬链接变化的比较也写在这里，
 * 要哪个链接数仍由调用方说。
 */

/** Wakeflow 需要显式观察的本地文件系统节点类型。 */
export type FileNodeKind =
  | "file"
  | "directory"
  | "symbolic-link"
  | "fifo"
  | "socket"
  | "character-device"
  | "block-device"
  | "unknown";

/** 一次 Node 文件系统节点观察的冻结物理事实。 */
export interface FileNodeSnapshot {
  readonly kind: FileNodeKind;
  readonly deviceId: bigint;
  readonly inodeId: bigint;
  readonly rawMode: bigint;
  readonly permissionBits: number;
  readonly linkCount: bigint;
  readonly userId: bigint;
  readonly groupId: bigint;
  readonly specialDeviceId: bigint;
  readonly byteCount: ByteCount;
  readonly modifiedAtNanoseconds: bigint;
  readonly changedAtNanoseconds: bigint;
}

/** 文件系统节点快照失败的稳定分类。 */
export type FileNodeSnapshotErrorReason = "stat-shape" | "stat-field" | "stat-size";

/**
 * 节点 Stats 准入失败的稳定错误。
 *
 * 错误不回显设备号、inode、所有者、权限位、大小或时间值。
 */
export class FileNodeSnapshotError extends ModuleError<FileNodeSnapshotErrorReason> {
  static override readonly code = "wakeflow-file-node-snapshot";
}

const STAT_FIELDS = Object.freeze([
  "dev",
  "ino",
  "mode",
  "nlink",
  "uid",
  "gid",
  "rdev",
  "size",
  "mtimeNs",
  "ctimeNs",
] as const);

const FILE_TYPE_MASK = BigInt(fileSystemConstants.S_IFMT);
const PERMISSION_MASK = 0o777n;

const FILE_NODE_KIND_BY_MODE: ReadonlyMap<bigint, FileNodeKind> = new Map([
  [BigInt(fileSystemConstants.S_IFREG), "file"],
  [BigInt(fileSystemConstants.S_IFDIR), "directory"],
  [BigInt(fileSystemConstants.S_IFLNK), "symbolic-link"],
  [BigInt(fileSystemConstants.S_IFIFO), "fifo"],
  [BigInt(fileSystemConstants.S_IFSOCK), "socket"],
  [BigInt(fileSystemConstants.S_IFCHR), "character-device"],
  [BigInt(fileSystemConstants.S_IFBLK), "block-device"],
]);

function normalizeErrorPath(path: unknown): string {
  return typeof path === "string" && path.length > 0 ? path : "$stat";
}

function fieldPath(basePath: string, field: string): string {
  return `${basePath}.${field}`;
}

const fail: Fail<FileNodeSnapshotErrorReason> = failWith(FileNodeSnapshotError);

function readBigIntField(
  record: Readonly<Record<string, unknown>>,
  field: string,
  basePath: string,
  nonNegative = false,
): bigint {
  const value = record[field];
  if (typeof value !== "bigint" || (nonNegative && value < 0n)) {
    fail("stat-field", fieldPath(basePath, field));
  }
  return value;
}

function fileNodeKind(rawMode: bigint): FileNodeKind {
  return FILE_NODE_KIND_BY_MODE.get(rawMode & FILE_TYPE_MASK) ?? "unknown";
}

function permissionBits(rawMode: bigint): number {
  return Number(rawMode & PERMISSION_MASK);
}

/**
 * 从一次 bigint Stats 观察创建冻结节点快照。
 *
 * 只通过自有 data descriptor 读取必需字段，不调用 Stats 原型方法。额外 Stats
 * 字段会被忽略；来源真实性仍由执行 lstat/fstat 的上层能力负责。
 */
export function createFileNodeSnapshot(
  value: unknown,
  errorPath?: string,
): Readonly<FileNodeSnapshot> {
  const path = normalizeErrorPath(errorPath);
  let record: Readonly<Record<string, unknown>>;
  try {
    record = pickOwnDataProperties(value, STAT_FIELDS, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("stat-shape", path, error);
    throw error;
  }

  const deviceId = readBigIntField(record, "dev", path, true);
  const inodeId = readBigIntField(record, "ino", path, true);
  const rawMode = readBigIntField(record, "mode", path, true);
  const linkCount = readBigIntField(record, "nlink", path, true);
  const userId = readBigIntField(record, "uid", path);
  const groupId = readBigIntField(record, "gid", path);
  const specialDeviceId = readBigIntField(record, "rdev", path, true);
  const size = readBigIntField(record, "size", path, true);
  const modifiedAtNanoseconds = readBigIntField(record, "mtimeNs", path);
  const changedAtNanoseconds = readBigIntField(record, "ctimeNs", path);

  let byteCount: ByteCount;
  try {
    byteCount = byteCountFromBigInt(size, fieldPath(path, "size"));
  } catch (error: unknown) {
    if (error instanceof ByteCountError) {
      fail("stat-size", fieldPath(path, "size"), error);
    }
    throw error;
  }

  return Object.freeze({
    kind: fileNodeKind(rawMode),
    deviceId,
    inodeId,
    rawMode,
    permissionBits: permissionBits(rawMode),
    linkCount,
    userId,
    groupId,
    specialDeviceId,
    byteCount,
    modifiedAtNanoseconds,
    changedAtNanoseconds,
  });
}

/**
 * 判断两个快照是否仍指向同一物理节点，仅比较 `deviceId` 与 `inodeId`。
 *
 * 相同结果不证明内容、权限位或时间未变化，也无法排除节点删除后的 inode 复用。
 */
export function sameFileNodeIdentity(left: FileNodeSnapshot, right: FileNodeSnapshot): boolean {
  return left.deviceId === right.deviceId && left.inodeId === right.inodeId;
}

/** 判断两个节点快照的全部稳定物理事实是否逐项相同。 */
export function sameFileNodeSnapshot(left: FileNodeSnapshot, right: FileNodeSnapshot): boolean {
  return (
    left.kind === right.kind &&
    left.deviceId === right.deviceId &&
    left.inodeId === right.inodeId &&
    left.rawMode === right.rawMode &&
    left.permissionBits === right.permissionBits &&
    left.linkCount === right.linkCount &&
    left.userId === right.userId &&
    left.groupId === right.groupId &&
    left.specialDeviceId === right.specialDeviceId &&
    left.byteCount === right.byteCount &&
    left.modifiedAtNanoseconds === right.modifiedAtNanoseconds &&
    left.changedAtNanoseconds === right.changedAtNanoseconds
  );
}

/**
 * 跨一次硬链接变化（多链接一个名字或删掉一个名字）仍是同一个普通文件：身份、权限、属主、大小与
 * 修改时间都未变，链接数变成 `linkCount`。状态变更时间随链接数变化，不比较。
 */
export function sameFileAfterLinkChange(
  before: FileNodeSnapshot,
  after: FileNodeSnapshot,
  linkCount: bigint,
): boolean {
  return (
    sameFileNodeIdentity(before, after) &&
    before.kind === "file" &&
    after.kind === "file" &&
    before.rawMode === after.rawMode &&
    before.permissionBits === after.permissionBits &&
    after.linkCount === linkCount &&
    before.userId === after.userId &&
    before.groupId === after.groupId &&
    before.specialDeviceId === after.specialDeviceId &&
    before.byteCount === after.byteCount &&
    before.modifiedAtNanoseconds === after.modifiedAtNanoseconds
  );
}
