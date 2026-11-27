import { PassiveOwnDataError, parsePlainRecord } from "../data/passive-own-data.js";
import { type Fail, failWith, ModuleError } from "../error/module-error.js";
import {
  admitFrozenFileNodeSnapshot,
  type FileNodeSnapshot,
  sameFileNodeSnapshot,
} from "./file-node-snapshot.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import { type RootedDirectory, isRootedDirectory } from "./rooted-directory.js";
import {
  closeExactResourceHandle,
  RootedExactResourceHandle,
  type RootedExactResourceHandleError,
  translateExactResourceHandleError,
} from "./rooted-exact-resource-handle.js";
import {
  closeParentHandle,
  parentOpenRefusal,
  RootedResourceParentHandle,
  type RootedResourceParentHandleError,
  translateParentHandleError,
} from "./rooted-resource-parent-handle.js";
import { isAbortSignal, throwIfAborted } from "../node/abort-signal.js";

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
  | "close-failure";

/** 指定普通文件持久性结算失败时返回的稳定、脱敏错误。 */
export class DurableRegularFileSettlementError extends ModuleError<DurableRegularFileSettlementErrorReason> {
  static override readonly code = "wakeflow-durable-regular-file-settlement";
}

interface ParsedOptions {
  readonly expectedNode: Readonly<FileNodeSnapshot>;
  readonly signal: AbortSignal | undefined;
}

const fail: Fail<DurableRegularFileSettlementErrorReason> = failWith(
  DurableRegularFileSettlementError,
);

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (!isRootedDirectory(value)) fail("input", "$root");
}

function parseExpectedNode(value: unknown): Readonly<FileNodeSnapshot> {
  const node = admitFrozenFileNodeSnapshot(value, (cause) =>
    fail("input", "$options.expectedNode", cause),
  );
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
    if (error instanceof PassiveOwnDataError) fail("input", "$options", error);
    throw error;
  }
  if (
    !Object.hasOwn(record, "expectedNode") ||
    Object.keys(record).some((key) => key !== "expectedNode" && key !== "signal")
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
  const refusal = operation === "open" ? parentOpenRefusal(error) : undefined;
  if (refusal !== undefined) fail(refusal, refusal === "root-scope" ? "$root" : "$resourcePath");
  fail("parent-changed", "$resourcePath");
}

function openParent(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
): Promise<RootedResourceParentHandle> {
  return translateParentHandleError(
    () => RootedResourceParentHandle.open(root, resourcePath, "$resourcePath"),
    (error) => mapParentError(error, "open"),
  );
}

function assertParentCurrent(
  parent: RootedResourceParentHandle,
): Promise<Readonly<FileNodeSnapshot>> {
  return translateParentHandleError(
    () => parent.assertCurrent(),
    (error) => mapParentError(error, "current"),
  );
}

function syncParent(parent: RootedResourceParentHandle): Promise<Readonly<FileNodeSnapshot>> {
  return translateParentHandleError(
    () => parent.sync(),
    (error) => mapParentError(error, "sync"),
  );
}

function closeParent(
  parent: RootedResourceParentHandle,
): Promise<DurableRegularFileSettlementError | undefined> {
  return closeParentHandle(
    parent,
    () => new DurableRegularFileSettlementError("close-failure", "$resourcePath"),
  );
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

function openResource(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  expectedNode: Readonly<FileNodeSnapshot>,
): Promise<RootedExactResourceHandle> {
  return translateExactResourceHandleError(
    () =>
      RootedExactResourceHandle.openRegularFile(root, resourcePath, expectedNode, "$resourcePath"),
    (error) => mapResourceError(error, "open"),
  );
}

function assertResourceCurrent(
  resource: RootedExactResourceHandle,
  operation: "current" | "settled",
): Promise<Readonly<FileNodeSnapshot>> {
  return translateExactResourceHandleError(
    () => resource.assertPathCurrent(),
    (error) => mapResourceError(error, operation),
  );
}

function syncResource(resource: RootedExactResourceHandle): Promise<Readonly<FileNodeSnapshot>> {
  return translateExactResourceHandleError(
    () => resource.syncOpenedNode(),
    (error) => mapResourceError(error, "sync"),
  );
}

function closeResource(
  resource: RootedExactResourceHandle,
): Promise<DurableRegularFileSettlementError | undefined> {
  return closeExactResourceHandle(
    resource,
    () => new DurableRegularFileSettlementError("close-failure", "$resourcePath"),
  );
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
): Promise<void> {
  assertRoot(root);
  const parsed = parseOptions(options);
  throwIfAborted(parsed.signal);

  const parent = await openParent(root, resourcePath);
  let resource: RootedExactResourceHandle | undefined;
  let settled = false;
  let primaryError: unknown;

  try {
    resource = await openResource(root, resourcePath, parsed.expectedNode);
    if (resource.resourceAbsolutePath !== parent.resourceAbsolutePath) {
      fail("root-scope", "$resourcePath");
    }
    await assertParentCurrent(parent);
    await assertResourceCurrent(resource, "current");
    throwIfAborted(parsed.signal);

    const syncedNode = await syncResource(resource);
    if (!sameFileNodeSnapshot(parsed.expectedNode, syncedNode)) {
      fail("commit-uncertain", "$resourcePath");
    }
    await syncParent(parent);
    await assertParentCurrent(parent);
    const finalNode = await assertResourceCurrent(resource, "settled");
    if (
      !sameFileNodeSnapshot(parsed.expectedNode, finalNode) ||
      !sameFileNodeSnapshot(syncedNode, finalNode)
    ) {
      fail("commit-uncertain", "$resourcePath");
    }
    settled = true;
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
  if (!settled) fail("commit-uncertain", "$resourcePath");
}
