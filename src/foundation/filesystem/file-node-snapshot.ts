import { constants as fileSystemConstants } from "node:fs";

import {
  parsePlainRecord,
  pickOwnDataProperties,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import {
  byteCountFromBigInt,
  ByteCountError,
  parseByteCount,
  type ByteCount,
} from "../numeric/byte-count.js";

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
export type FileNodeSnapshotErrorReason =
  | "stat-shape"
  | "stat-field"
  | "stat-size"
  | "snapshot-shape"
  | "snapshot-field";

const ERROR_MESSAGES = {
  "stat-shape": "File node Stats must expose passive own bigint data fields.",
  "stat-field": "File node Stats contains an invalid physical field.",
  "stat-size": "File node size cannot be represented as a safe byte count.",
  "snapshot-shape": "File node snapshot must match its closed passive data shape.",
  "snapshot-field": "File node snapshot contains an inconsistent physical field.",
} as const satisfies Readonly<Record<FileNodeSnapshotErrorReason, string>>;

/**
 * 节点 Stats 准入或快照复验失败的稳定错误。
 *
 * 错误不回显设备号、inode、所有者、权限位、大小或时间值。
 */
export class FileNodeSnapshotError extends Error {
  override readonly name = "FileNodeSnapshotError";
  readonly code = "wakeflow-file-node-snapshot" as const;
  readonly reason: FileNodeSnapshotErrorReason;
  readonly path: string;

  constructor(reason: FileNodeSnapshotErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
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

const SNAPSHOT_FIELDS = Object.freeze([
  "kind",
  "deviceId",
  "inodeId",
  "rawMode",
  "permissionBits",
  "linkCount",
  "userId",
  "groupId",
  "specialDeviceId",
  "byteCount",
  "modifiedAtNanoseconds",
  "changedAtNanoseconds",
] as const);

const FILE_NODE_KINDS: ReadonlySet<string> = new Set<FileNodeKind>([
  "file",
  "directory",
  "symbolic-link",
  "fifo",
  "socket",
  "character-device",
  "block-device",
  "unknown",
]);

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

function fail(
  reason: FileNodeSnapshotErrorReason,
  path: string,
): never {
  throw new FileNodeSnapshotError(reason, path);
}

function readBigIntField(
  record: Readonly<Record<string, unknown>>,
  field: string,
  basePath: string,
  nonNegative = false,
): bigint {
  const value = record[field];
  if (
    typeof value !== "bigint"
    || (nonNegative && value < 0n)
  ) {
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
    if (error instanceof PassiveOwnDataError) fail("stat-shape", path);
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
      fail("stat-size", fieldPath(path, "size"));
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

function readSnapshotBigInt(
  record: Readonly<Record<string, unknown>>,
  field: string,
  path: string,
  nonNegative = false,
): bigint {
  const value = record[field];
  if (
    typeof value !== "bigint"
    || (nonNegative && value < 0n)
  ) {
    fail("snapshot-field", fieldPath(path, field));
  }
  return value;
}

function parseFileNodeSnapshot(
  value: unknown,
  path: string,
): FileNodeSnapshot {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("snapshot-shape", path);
    throw error;
  }

  const keys = Object.keys(record).sort();
  const expectedKeys = [...SNAPSHOT_FIELDS].sort();
  if (
    keys.length !== expectedKeys.length
    || keys.some((key, index) => key !== expectedKeys[index])
  ) {
    fail("snapshot-shape", path);
  }

  const kind = record.kind;
  if (typeof kind !== "string" || !FILE_NODE_KINDS.has(kind)) {
    fail("snapshot-field", fieldPath(path, "kind"));
  }
  const deviceId = readSnapshotBigInt(record, "deviceId", path, true);
  const inodeId = readSnapshotBigInt(record, "inodeId", path, true);
  const rawMode = readSnapshotBigInt(record, "rawMode", path, true);
  const linkCount = readSnapshotBigInt(record, "linkCount", path, true);
  const userId = readSnapshotBigInt(record, "userId", path);
  const groupId = readSnapshotBigInt(record, "groupId", path);
  const specialDeviceId = readSnapshotBigInt(
    record,
    "specialDeviceId",
    path,
    true,
  );
  const modifiedAtNanoseconds = readSnapshotBigInt(
    record,
    "modifiedAtNanoseconds",
    path,
  );
  const changedAtNanoseconds = readSnapshotBigInt(
    record,
    "changedAtNanoseconds",
    path,
  );

  let admittedByteCount: ByteCount;
  try {
    admittedByteCount = parseByteCount(
      record.byteCount,
      fieldPath(path, "byteCount"),
    );
  } catch (error: unknown) {
    if (error instanceof ByteCountError) {
      fail("snapshot-field", fieldPath(path, "byteCount"));
    }
    throw error;
  }
  const admittedPermissionBits = record.permissionBits;
  if (
    typeof admittedPermissionBits !== "number"
    || !Number.isSafeInteger(admittedPermissionBits)
    || admittedPermissionBits < 0
    || admittedPermissionBits > Number(PERMISSION_MASK)
    || admittedPermissionBits !== permissionBits(rawMode)
  ) {
    fail("snapshot-field", fieldPath(path, "permissionBits"));
  }
  if (kind !== fileNodeKind(rawMode)) {
    fail("snapshot-field", fieldPath(path, "kind"));
  }

  return {
    kind: kind as FileNodeKind,
    deviceId,
    inodeId,
    rawMode,
    permissionBits: admittedPermissionBits,
    linkCount,
    userId,
    groupId,
    specialDeviceId,
    byteCount: admittedByteCount,
    modifiedAtNanoseconds,
    changedAtNanoseconds,
  };
}

/**
 * 判断两个快照是否仍指向同一物理节点，仅比较 `deviceId` 与 `inodeId`。
 *
 * 相同结果不证明内容、权限位或时间未变化，也无法排除节点删除后的 inode 复用。
 */
export function sameFileNodeIdentity(
  left: FileNodeSnapshot,
  right: FileNodeSnapshot,
): boolean {
  const admittedLeft = parseFileNodeSnapshot(left, "$left");
  const admittedRight = parseFileNodeSnapshot(right, "$right");
  return (
    admittedLeft.deviceId === admittedRight.deviceId
    && admittedLeft.inodeId === admittedRight.inodeId
  );
}

/** 判断两个节点快照的全部稳定物理事实是否逐项相同。 */
export function sameFileNodeSnapshot(
  left: FileNodeSnapshot,
  right: FileNodeSnapshot,
): boolean {
  const admittedLeft = parseFileNodeSnapshot(left, "$left");
  const admittedRight = parseFileNodeSnapshot(right, "$right");
  return (
    admittedLeft.kind === admittedRight.kind
    && admittedLeft.deviceId === admittedRight.deviceId
    && admittedLeft.inodeId === admittedRight.inodeId
    && admittedLeft.rawMode === admittedRight.rawMode
    && admittedLeft.permissionBits === admittedRight.permissionBits
    && admittedLeft.linkCount === admittedRight.linkCount
    && admittedLeft.userId === admittedRight.userId
    && admittedLeft.groupId === admittedRight.groupId
    && admittedLeft.specialDeviceId === admittedRight.specialDeviceId
    && admittedLeft.byteCount === admittedRight.byteCount
    && admittedLeft.modifiedAtNanoseconds
      === admittedRight.modifiedAtNanoseconds
    && admittedLeft.changedAtNanoseconds
      === admittedRight.changedAtNanoseconds
  );
}
