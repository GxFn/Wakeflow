import { equal } from "node:assert/strict";
import { constants as fileSystemConstants } from "node:fs";
import { test } from "node:test";

import {
  createFileNodeSnapshot,
  type FileNodeSnapshot,
} from "../../../src/foundation/filesystem/file-node-snapshot.js";
import {
  isPrivateDirectory,
  isPrivateFile,
} from "../../../src/foundation/filesystem/private-node-policy.js";

/**
 * 级别 0（纯逻辑）：私有节点策略写一次（1.4.5 batch 3）。
 *
 * 每个事实单独违反一次：类型、权限位、属主、链接数（文件默认恰好 1，调用方可放宽到给定集合）。
 * 节点是内存里的 Stats 形状，不碰文件系统；属主用当前进程的有效用户，平台不提供 `geteuid` 时
 * 不核对属主。
 */

const USER = typeof process.geteuid === "function" ? BigInt(process.geteuid()) : 0n;

function node(
  type: number,
  permissionBits: number,
  overrides: Readonly<{ nlink?: bigint; uid?: bigint }> = {},
): Readonly<FileNodeSnapshot> {
  return createFileNodeSnapshot({
    dev: 1n,
    ino: 2n,
    mode: BigInt(type | permissionBits),
    nlink: overrides.nlink ?? 1n,
    uid: overrides.uid ?? USER,
    gid: 0n,
    rdev: 0n,
    size: 0n,
    mtimeNs: 0n,
    ctimeNs: 0n,
  });
}

const FILE = fileSystemConstants.S_IFREG;
const DIRECTORY = fileSystemConstants.S_IFDIR;

test("a single-link 0600 file of the current user is private; every other fact is not", () => {
  equal(isPrivateFile(node(FILE, 0o600)), true);
  equal(isPrivateFile(node(DIRECTORY, 0o600)), false);
  equal(isPrivateFile(node(FILE, 0o644)), false);
  equal(isPrivateFile(node(FILE, 0o600, { nlink: 2n })), false);
  equal(isPrivateFile(node(FILE, 0o600, { nlink: 0n })), false);
  if (typeof process.geteuid === "function") {
    equal(isPrivateFile(node(FILE, 0o600, { uid: USER + 1n })), false);
  }
});

test("allowed link counts replace the single link, never the other facts", () => {
  const tolerated = [1n, 2n] as const;
  equal(isPrivateFile(node(FILE, 0o600, { nlink: 2n }), tolerated), true);
  equal(isPrivateFile(node(FILE, 0o600, { nlink: 3n }), tolerated), false);
  equal(isPrivateFile(node(FILE, 0o640, { nlink: 2n }), tolerated), false);
  equal(isPrivateFile(node(DIRECTORY, 0o600, { nlink: 2n }), tolerated), false);
});

test("a 0700 directory of the current user is private whatever its link count", () => {
  equal(isPrivateDirectory(node(DIRECTORY, 0o700, { nlink: 5n })), true);
  equal(isPrivateDirectory(node(FILE, 0o700)), false);
  equal(isPrivateDirectory(node(DIRECTORY, 0o755)), false);
  if (typeof process.geteuid === "function") {
    equal(isPrivateDirectory(node(DIRECTORY, 0o700, { uid: USER + 1n })), false);
  }
});

test("without geteuid the owner is not checked", () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "geteuid");
  Object.defineProperty(process, "geteuid", { value: undefined, configurable: true });
  try {
    equal(isPrivateFile(node(FILE, 0o600, { uid: USER + 1n })), true);
    equal(isPrivateDirectory(node(DIRECTORY, 0o700, { uid: USER + 1n })), true);
  } finally {
    if (descriptor === undefined) Reflect.deleteProperty(process, "geteuid");
    else Object.defineProperty(process, "geteuid", descriptor);
  }
});
