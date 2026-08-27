import { types } from "node:util";

import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import {
  FileNodeSnapshotError,
  sameFileNodeSnapshot,
  type FileNodeSnapshot,
} from "./file-node-snapshot.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import { RootedDirectory } from "./rooted-directory.js";
import {
  RootedExactResourceHandle,
  RootedExactResourceHandleError,
} from "./rooted-exact-resource-handle.js";
import {
  RootedResourceParentHandle,
  RootedResourceParentHandleError,
} from "./rooted-resource-parent-handle.js";

/**
 * Wakeflow Foundation / Filesystem：指定已有普通文件的持久性结算。
 *
 * 本能力用于目录项发布已经可见、但原发布调用尚未签发完整持久性回执的恢复边界。
 * 它根据冻结的预期节点打开不跟随符号链接的文件句柄和父目录句柄，先证明路径名、
 * 句柄和预期一致，再同步文件 inode 与父目录，最后重新证明指定目标没有漂移。
 *
 * 本函数不创建、写入、链接、重命名、删除或替换资源，也不推断目标由哪次操作创建。
 * 调用方必须先用自己的意图记录、内容和身份规则证明目标可以结算。成功结果只证明
 * 当前指定文件及其目录项已经完成本次同步。
 */

export interface DurableRegularFileSettlementOptions {
  readonly expectedNode: Readonly<FileNodeSnapshot>;
  readonly signal?: AbortSignal;
}

/** 成功结果描述文件和父目录同步后仍与预期一致的指定目标。 */
export interface DurableRegularFileSettlementResult {
  readonly resourcePath: PortableResourcePath;
  readonly node: Readonly<FileNodeSnapshot>;
  readonly parentNode: Readonly<FileNodeSnapshot>;
}

export type DurableRegularFileSettlementErrorReason =
  | "input"
  | "root-scope"
  | "parent-not-found"
  | "parent-symlink"
  | "parent-not-directory"
  | "parent-open-failure"
  | "parent-changed"
  | "resource-not-found"
  | "resource-symlink"
  | "resource-not-file"
  | "resource-open-failure"
  | "resource-changed"
  | "durability-failure"
  | "commit-uncertain"
  | "aborted"
  | "close-failure";

const ERROR_MESSAGES = {
  "input": "Durable regular file settlement input is invalid.",
  "root-scope": "Regular file settlement could not establish its rooted scope.",
  "parent-not-found": "Regular file settlement parent directory does not exist.",
  "parent-symlink": "Regular file settlement parent chain cannot contain a symbolic link.",
  "parent-not-directory": "Regular file settlement parent must be a directory.",
  "parent-open-failure": "Regular file settlement parent could not be opened safely.",
  "parent-changed": "Regular file settlement parent changed during the operation.",
  "resource-not-found": "Regular file settlement target does not exist.",
  "resource-symlink": "Regular file settlement target cannot be a symbolic link.",
  "resource-not-file": "Regular file settlement target must be a regular file.",
  "resource-open-failure": "Regular file settlement target could not be opened safely.",
  "resource-changed": "Regular file settlement target no longer matches its expectation.",
  "durability-failure": "Regular file and parent could not be synchronized safely.",
  "commit-uncertain": "Regular file settlement result could not be proven exact.",
  "aborted": "Regular file settlement was aborted before synchronization.",
  "close-failure": "A regular file settlement handle could not be closed safely.",
} as const satisfies Readonly<Record<
  DurableRegularFileSettlementErrorReason,
  string
>>;

/** 指定普通文件持久性结算失败时返回的稳定、脱敏错误。 */
export class DurableRegularFileSettlementError extends Error {
  override readonly name = "DurableRegularFileSettlementError";
  readonly code = "wakeflow-durable-regular-file-settlement" as const;
  readonly reason: DurableRegularFileSettlementErrorReason;
  readonly path: string;

  constructor(reason: DurableRegularFileSettlementErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedOptions {
  readonly expectedNode: Readonly<FileNodeSnapshot>;
  readonly signal: AbortSignal | undefined;
}

function fail(
  reason: DurableRegularFileSettlementErrorReason,
  path: string,
): never {
  throw new DurableRegularFileSettlementError(reason, path);
}

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof value === "object"
    && value !== null
    && !types.isProxy(value)
    && value instanceof AbortSignal;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted", "$signal");
}

function parseExpectedNode(value: unknown): Readonly<FileNodeSnapshot> {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !Object.isFrozen(value)
  ) {
    fail("input", "$options.expectedNode");
  }
  try {
    if (!sameFileNodeSnapshot(
      value as FileNodeSnapshot,
      value as FileNodeSnapshot,
    )) {
      fail("input", "$options.expectedNode");
    }
  } catch (error: unknown) {
    if (error instanceof FileNodeSnapshotError) {
      fail("input", "$options.expectedNode");
    }
    throw error;
  }
  const node = value as Readonly<FileNodeSnapshot>;
  if (node.kind === "file" && node.linkCount < 1n) {
    fail("input", "$options.expectedNode");
  }
  return node;
}

function parseOptions(value: unknown): Readonly<ParsedOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (
    !Object.hasOwn(record, "expectedNode")
    || Object.keys(record).some(
      (key) => key !== "expectedNode" && key !== "signal",
    )
  ) {
    fail("input", "$options");
  }
  if (record.signal !== undefined && !isAbortSignal(record.signal)) {
    fail("input", "$options.signal");
  }
  return Object.freeze({
    expectedNode: parseExpectedNode(record.expectedNode),
    signal: record.signal,
  });
}

function mapParentError(
  error: RootedResourceParentHandleError,
  operation: "open" | "current" | "sync",
): never {
  if (operation === "sync" && error.reason === "sync-failure") {
    fail("durability-failure", "$resourcePath");
  }
  if (operation === "open") {
    if (error.reason === "input") fail("input", "$resourcePath");
    if (error.reason === "root-scope") fail("root-scope", "$root");
    if (error.reason === "parent-not-found") {
      fail("parent-not-found", "$resourcePath");
    }
    if (error.reason === "parent-symlink") {
      fail("parent-symlink", "$resourcePath");
    }
    if (error.reason === "parent-not-directory") {
      fail("parent-not-directory", "$resourcePath");
    }
    if (error.reason === "parent-open-failure") {
      fail("parent-open-failure", "$resourcePath");
    }
  }
  fail("parent-changed", "$resourcePath");
}

async function openParent(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
): Promise<RootedResourceParentHandle> {
  try {
    return await RootedResourceParentHandle.open(
      root,
      resourcePath,
      "$resourcePath",
    );
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      mapParentError(error, "open");
    }
    throw error;
  }
}

async function assertParentCurrent(
  parent: RootedResourceParentHandle,
): Promise<void> {
  try {
    await parent.assertCurrent();
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      mapParentError(error, "current");
    }
    throw error;
  }
}

async function syncParent(
  parent: RootedResourceParentHandle,
): Promise<Readonly<FileNodeSnapshot>> {
  try {
    return await parent.sync();
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      mapParentError(error, "sync");
    }
    throw error;
  }
}

async function closeParent(
  parent: RootedResourceParentHandle,
): Promise<DurableRegularFileSettlementError | undefined> {
  try {
    await parent.close();
    return undefined;
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      return new DurableRegularFileSettlementError(
        "close-failure",
        "$resourcePath",
      );
    }
    throw error;
  }
}

function mapResourceError(
  error: RootedExactResourceHandleError,
  operation: "open" | "current" | "settled" | "sync",
): never {
  if (operation === "sync" && error.reason === "sync-failure") {
    fail("durability-failure", "$resourcePath");
  }
  if (operation === "settled" || operation === "sync") {
    fail("commit-uncertain", "$resourcePath");
  }
  if (operation === "current") fail("resource-changed", "$resourcePath");
  if (error.reason === "input") fail("input", "$resourcePath");
  if (error.reason === "root-scope") fail("root-scope", "$root");
  if (error.reason === "resource-not-found") {
    fail("resource-not-found", "$resourcePath");
  }
  if (error.reason === "resource-symlink") {
    fail("resource-symlink", "$resourcePath");
  }
  if (error.reason === "resource-kind") {
    fail("resource-not-file", "$resourcePath");
  }
  if (error.reason === "resource-open-failure") {
    fail("resource-open-failure", "$resourcePath");
  }
  fail("resource-changed", "$resourcePath");
}

async function openResource(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  expectedNode: Readonly<FileNodeSnapshot>,
): Promise<RootedExactResourceHandle> {
  try {
    return await RootedExactResourceHandle.openRegularFile(
      root,
      resourcePath,
      expectedNode,
      "$resourcePath",
    );
  } catch (error: unknown) {
    if (error instanceof RootedExactResourceHandleError) {
      mapResourceError(error, "open");
    }
    throw error;
  }
}

async function assertResourceCurrent(
  resource: RootedExactResourceHandle,
  operation: "current" | "settled",
): Promise<Readonly<FileNodeSnapshot>> {
  try {
    return await resource.assertPathCurrent();
  } catch (error: unknown) {
    if (error instanceof RootedExactResourceHandleError) {
      mapResourceError(error, operation);
    }
    throw error;
  }
}

async function syncResource(
  resource: RootedExactResourceHandle,
): Promise<Readonly<FileNodeSnapshot>> {
  try {
    return await resource.syncOpenedNode();
  } catch (error: unknown) {
    if (error instanceof RootedExactResourceHandleError) {
      mapResourceError(error, "sync");
    }
    throw error;
  }
}

async function closeResource(
  resource: RootedExactResourceHandle,
): Promise<DurableRegularFileSettlementError | undefined> {
  try {
    await resource.close();
    return undefined;
  } catch (error: unknown) {
    if (error instanceof RootedExactResourceHandleError) {
      return new DurableRegularFileSettlementError(
        "close-failure",
        "$resourcePath",
      );
    }
    throw error;
  }
}

/**
 * 为已经存在且仍与指定预期一致的普通文件补做持久性结算。
 *
 * 取消只在任何同步开始前生效；一旦开始同步文件，本函数会继续完成父目录同步与最终
 * 复验，避免向调用方返回“只同步了 inode、未同步目录项”的不完整成功结果。
 */
export async function settleRegularFileDurability(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  options: DurableRegularFileSettlementOptions,
): Promise<Readonly<DurableRegularFileSettlementResult>> {
  assertRoot(root);
  const parsed = parseOptions(options);
  assertNotAborted(parsed.signal);

  const parent = await openParent(root, resourcePath);
  let resource: RootedExactResourceHandle | undefined;
  let primaryError: unknown;
  let result: Readonly<DurableRegularFileSettlementResult> | undefined;

  try {
    resource = await openResource(root, resourcePath, parsed.expectedNode);
    if (resource.resourceAbsolutePath !== parent.resourceAbsolutePath) {
      fail("root-scope", "$resourcePath");
    }
    await assertParentCurrent(parent);
    await assertResourceCurrent(resource, "current");
    assertNotAborted(parsed.signal);

    const syncedNode = await syncResource(resource);
    if (!sameFileNodeSnapshot(parsed.expectedNode, syncedNode)) {
      fail("commit-uncertain", "$resourcePath");
    }
    const parentNode = await syncParent(parent);
    await assertParentCurrent(parent);
    const finalNode = await assertResourceCurrent(resource, "settled");
    if (
      !sameFileNodeSnapshot(parsed.expectedNode, finalNode)
      || !sameFileNodeSnapshot(syncedNode, finalNode)
    ) {
      fail("commit-uncertain", "$resourcePath");
    }
    result = Object.freeze({ resourcePath, node: finalNode, parentNode });
  } catch (error: unknown) {
    primaryError = error;
  }

  if (resource !== undefined) {
    const closeError = await closeResource(resource);
    if (primaryError === undefined && closeError !== undefined) {
      primaryError = closeError;
    }
  }
  const parentCloseError = await closeParent(parent);
  if (primaryError === undefined && parentCloseError !== undefined) {
    primaryError = parentCloseError;
  }

  if (primaryError !== undefined) throw primaryError;
  if (result === undefined) fail("commit-uncertain", "$resourcePath");
  return result;
}
