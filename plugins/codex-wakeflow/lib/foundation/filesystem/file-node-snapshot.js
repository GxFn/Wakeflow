import { constants as fileSystemConstants } from "node:fs";
import { parsePlainRecord, pickOwnDataProperties, PassiveOwnDataError, } from "../data/passive-own-data.js";
import { byteCountFromBigInt, ByteCountError, parseByteCount, } from "../numeric/byte-count.js";
const ERROR_MESSAGES = {
    "stat-shape": "File node Stats must expose passive own bigint data fields.",
    "stat-field": "File node Stats contains an invalid physical field.",
    "stat-size": "File node size cannot be represented as a safe byte count.",
    "snapshot-shape": "File node snapshot must match its closed passive data shape.",
    "snapshot-field": "File node snapshot contains an inconsistent physical field.",
};
/**
 * 节点 Stats 准入或快照复验失败的稳定错误。
 *
 * 错误不回显设备号、inode、所有者、权限位、大小或时间值。
 */
export class FileNodeSnapshotError extends Error {
    name = "FileNodeSnapshotError";
    code = "wakeflow-file-node-snapshot";
    reason;
    path;
    constructor(reason, path) {
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
]);
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
]);
const FILE_NODE_KINDS = new Set([
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
const PERMISSION_MASK = 511n;
const FILE_NODE_KIND_BY_MODE = new Map([
    [BigInt(fileSystemConstants.S_IFREG), "file"],
    [BigInt(fileSystemConstants.S_IFDIR), "directory"],
    [BigInt(fileSystemConstants.S_IFLNK), "symbolic-link"],
    [BigInt(fileSystemConstants.S_IFIFO), "fifo"],
    [BigInt(fileSystemConstants.S_IFSOCK), "socket"],
    [BigInt(fileSystemConstants.S_IFCHR), "character-device"],
    [BigInt(fileSystemConstants.S_IFBLK), "block-device"],
]);
function normalizeErrorPath(path) {
    return typeof path === "string" && path.length > 0 ? path : "$stat";
}
function fieldPath(basePath, field) {
    return `${basePath}.${field}`;
}
function fail(reason, path) {
    throw new FileNodeSnapshotError(reason, path);
}
function readBigIntField(record, field, basePath, nonNegative = false) {
    const value = record[field];
    if (typeof value !== "bigint"
        || (nonNegative && value < 0n)) {
        fail("stat-field", fieldPath(basePath, field));
    }
    return value;
}
function fileNodeKind(rawMode) {
    return FILE_NODE_KIND_BY_MODE.get(rawMode & FILE_TYPE_MASK) ?? "unknown";
}
function permissionBits(rawMode) {
    return Number(rawMode & PERMISSION_MASK);
}
/**
 * 从一次 bigint Stats 观察创建冻结节点快照。
 *
 * 只通过自有 data descriptor 读取必需字段，不调用 Stats 原型方法。额外 Stats
 * 字段会被忽略；来源真实性仍由执行 lstat/fstat 的上层能力负责。
 */
export function createFileNodeSnapshot(value, errorPath) {
    const path = normalizeErrorPath(errorPath);
    let record;
    try {
        record = pickOwnDataProperties(value, STAT_FIELDS, path);
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("stat-shape", path);
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
    let byteCount;
    try {
        byteCount = byteCountFromBigInt(size, fieldPath(path, "size"));
    }
    catch (error) {
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
function readSnapshotBigInt(record, field, path, nonNegative = false) {
    const value = record[field];
    if (typeof value !== "bigint"
        || (nonNegative && value < 0n)) {
        fail("snapshot-field", fieldPath(path, field));
    }
    return value;
}
function parseFileNodeSnapshot(value, path) {
    let record;
    try {
        record = parsePlainRecord(value, path);
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("snapshot-shape", path);
        throw error;
    }
    const keys = Object.keys(record).sort();
    const expectedKeys = [...SNAPSHOT_FIELDS].sort();
    if (keys.length !== expectedKeys.length
        || keys.some((key, index) => key !== expectedKeys[index])) {
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
    const specialDeviceId = readSnapshotBigInt(record, "specialDeviceId", path, true);
    const modifiedAtNanoseconds = readSnapshotBigInt(record, "modifiedAtNanoseconds", path);
    const changedAtNanoseconds = readSnapshotBigInt(record, "changedAtNanoseconds", path);
    let admittedByteCount;
    try {
        admittedByteCount = parseByteCount(record.byteCount, fieldPath(path, "byteCount"));
    }
    catch (error) {
        if (error instanceof ByteCountError) {
            fail("snapshot-field", fieldPath(path, "byteCount"));
        }
        throw error;
    }
    const admittedPermissionBits = record.permissionBits;
    if (typeof admittedPermissionBits !== "number"
        || !Number.isSafeInteger(admittedPermissionBits)
        || admittedPermissionBits < 0
        || admittedPermissionBits > Number(PERMISSION_MASK)
        || admittedPermissionBits !== permissionBits(rawMode)) {
        fail("snapshot-field", fieldPath(path, "permissionBits"));
    }
    if (kind !== fileNodeKind(rawMode)) {
        fail("snapshot-field", fieldPath(path, "kind"));
    }
    return {
        kind: kind,
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
export function sameFileNodeIdentity(left, right) {
    const admittedLeft = parseFileNodeSnapshot(left, "$left");
    const admittedRight = parseFileNodeSnapshot(right, "$right");
    return (admittedLeft.deviceId === admittedRight.deviceId
        && admittedLeft.inodeId === admittedRight.inodeId);
}
/** 判断两个节点快照的全部稳定物理事实是否逐项相同。 */
export function sameFileNodeSnapshot(left, right) {
    const admittedLeft = parseFileNodeSnapshot(left, "$left");
    const admittedRight = parseFileNodeSnapshot(right, "$right");
    return (admittedLeft.kind === admittedRight.kind
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
            === admittedRight.changedAtNanoseconds);
}
