import { type Fail, failWith, ModuleError } from "../error/module-error.js";
import { throwIfAborted } from "../node/abort-signal.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import { sourceTransitionSteps } from "./durable-source-transition-steps.js";
import {
  type FileNodeSnapshot,
  sameFileAfterLinkChange,
  sameFileNodeSnapshot,
} from "./file-node-snapshot.js";
import { filesystemMutation } from "./filesystem-mutation.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import type { RootedDirectory } from "./rooted-directory.js";
import {
  RootedExactResourceHandle,
  type RootedExactResourceHandleError,
  translateExactResourceHandleError,
} from "./rooted-exact-resource-handle.js";
import type { RootedResourceParentHandle } from "./rooted-resource-parent-handle.js";

/**
 * Wakeflow Foundation / Filesystem：普通文件的不替换目标持久化硬链接。
 *
 * 调用方必须提供冻结且完全一致的源节点预期。本模块打开并复验源、目标父目录和
 * 不跟随符号链接的源句柄，然后只跨越一次硬链接提交点。链接成功后，源路径与目标
 * 路径必须构成指向同一 inode 的精确链接对，链接数在原值上增加 1；随后只同步目标
 * 父目录（一次 fsync），并完成最终复验。
 *
 * 源内容不在这里再同步一次：调用方必须在链接之前已经同步源内容。唯一的调用方
 * Demand 事件追加以 `content-only` 创建候选，内容在链接前已经落盘（1.4.1 第 1 段，
 * 清单 2.1“事件追加”）；新的调用方同样必须先同步源内容，否则提交后的目标可能在
 * 掉电后指向未落盘的内容。
 *
 * 成功结果会有意保留两个路径名。本能力不删除或重命名源路径，也不把链接对描述为
 * 资源已经移动完成。后续暂存文件分离和精确删除必须由领域恢复意图分步编排；链接
 * 调用后的失败也不会猜测删除目标路径。
 *
 * 本层不接受目录、符号链接或特殊节点，不复制跨设备源资源、不创建父目录、不持有
 * 业务锁，也不拥有完整的移动或恢复状态机。Node.js 缺少基于文件描述符的 `linkat`，
 * 因此路径名竞态边界与 `RootedDirectory` 保持一致。
 */

export interface DurableRegularFileLinkOptions {
  readonly expectedSourceNode: Readonly<FileNodeSnapshot>;
  readonly signal?: AbortSignal;
}

/** 成功结果描述目标父目录已经同步的精确链接对（源内容由调用方在链接前同步）。 */
interface DurableRegularFileLinkResult {
  readonly sourceResourcePath: PortableResourcePath;
  readonly destinationResourcePath: PortableResourcePath;
  readonly sourceNode: Readonly<FileNodeSnapshot>;
  readonly destinationNode: Readonly<FileNodeSnapshot>;
}

/** 普通文件持久化链接失败的分类。 */
export type DurableRegularFileLinkErrorReason =
  | "input"
  | "root-scope"
  | "parent-not-found"
  | "parent-symlink"
  | "parent-not-directory"
  | "parent-open-failure"
  | "parent-changed"
  | "source-not-found"
  | "source-symlink"
  | "source-not-file"
  | "source-open-failure"
  | "source-changed"
  | "destination-exists"
  | "destination-inspection-failure"
  | "cross-device"
  | "link-failure"
  | "commit-uncertain"
  | "durability-failure"
  | "close-failure";

/**
 * 普通文件持久化链接失败时返回的稳定错误。
 *
 * 错误不回显物理路径、资源引用、节点元数据、链接数、取消原因、系统调用或底层原因。
 * `link` 调用后的错误不得被解释为目标路径一定不存在。
 */
export class DurableRegularFileLinkError extends ModuleError<DurableRegularFileLinkErrorReason> {
  static override readonly code = "wakeflow-durable-regular-file-link";
}

// 选项、父目录与源句柄的各步与重命名是同一份（durable-source-transition-steps.ts）。
const {
  parseResourcePath,
  openResourceParent,
  assertParentCurrent,
  inspectParentTarget,
  syncParent,
  closeParent,
  assertSourceCurrent,
  inspectCommittedSource,
  closeSource,
} = sourceTransitionSteps(DurableRegularFileLinkError);

const fail: Fail<DurableRegularFileLinkErrorReason> = failWith(DurableRegularFileLinkError);

function mapExactSourceOpenError(error: RootedExactResourceHandleError): never {
  if (error.reason === "input") fail("input", "$sourceResourcePath");
  if (error.reason === "root-scope") fail("root-scope", "$sourceResourcePath");
  if (error.reason === "resource-not-found") {
    fail("source-not-found", "$sourceResourcePath");
  }
  if (error.reason === "resource-symlink") {
    fail("source-symlink", "$sourceResourcePath");
  }
  if (error.reason === "resource-kind") {
    fail("source-not-file", "$sourceResourcePath");
  }
  if (error.reason === "resource-open-failure") {
    fail("source-open-failure", "$sourceResourcePath");
  }
  fail("source-changed", "$sourceResourcePath");
}

function openExactSource(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  expected: Readonly<FileNodeSnapshot>,
): Promise<RootedExactResourceHandle> {
  return translateExactResourceHandleError(
    () =>
      RootedExactResourceHandle.openRegularFile(
        root,
        resourcePath,
        expected,
        "$sourceResourcePath",
      ),
    mapExactSourceOpenError,
  );
}

async function inspectLinkedPair(
  source: RootedExactResourceHandle,
  sourceParent: RootedResourceParentHandle,
  destinationParent: RootedResourceParentHandle,
  linkedPairLinkCount: bigint,
): Promise<
  Readonly<{
    sourceNode: Readonly<FileNodeSnapshot>;
    destinationNode: Readonly<FileNodeSnapshot>;
  }>
> {
  const sourceNode = await inspectParentTarget(
    sourceParent,
    "$sourceResourcePath",
    "commit-uncertain",
  );
  if (sourceNode === null) {
    fail("commit-uncertain", "$sourceResourcePath");
  }
  const destinationNode = await inspectParentTarget(
    destinationParent,
    "$destinationResourcePath",
    "commit-uncertain",
  );
  if (destinationNode === null) {
    fail("commit-uncertain", "$destinationResourcePath");
  }
  const opened = await inspectCommittedSource(source);
  if (
    !sameFileAfterLinkChange(source.initialNodeSnapshot, opened, linkedPairLinkCount) ||
    !sameFileNodeSnapshot(opened, sourceNode) ||
    !sameFileNodeSnapshot(opened, destinationNode)
  ) {
    fail("commit-uncertain", "$destinationResourcePath");
  }
  return Object.freeze({
    sourceNode,
    destinationNode,
  });
}

/**
 * 为指定的源普通文件持久发布一个不替换目标的硬链接。
 *
 * 成功结果是可由恢复意图观察的链接对；调用方不得把它当成源资源已经移动。
 */
export async function linkRegularFileWithoutReplacement(
  root: RootedDirectory,
  sourceResourcePath: PortableResourcePath,
  destinationResourcePath: PortableResourcePath,
  options: DurableRegularFileLinkOptions,
): Promise<Readonly<DurableRegularFileLinkResult>> {
  const { expectedSourceNode, signal } = options;
  const sourcePath = parseResourcePath(sourceResourcePath, "$sourceResourcePath");
  const destinationPath = parseResourcePath(destinationResourcePath, "$destinationResourcePath");
  if (sourcePath === destinationPath) {
    fail("input", "$destinationResourcePath");
  }
  throwIfAborted(signal);

  const sourceParent = await openResourceParent(root, sourcePath, "$sourceResourcePath");
  let destinationParent: RootedResourceParentHandle | undefined;
  let source: RootedExactResourceHandle | undefined;
  let primaryError: unknown;
  let result: Readonly<DurableRegularFileLinkResult> | undefined;

  try {
    destinationParent = await openResourceParent(root, destinationPath, "$destinationResourcePath");

    source = await openExactSource(root, sourcePath, expectedSourceNode);
    if (source.resourceAbsolutePath !== sourceParent.resourceAbsolutePath) {
      fail("root-scope", "$sourceResourcePath");
    }
    if (source.initialNodeSnapshot.deviceId !== destinationParent.parentDeviceId) {
      fail("cross-device", "$destinationResourcePath");
    }
    if (
      (await inspectParentTarget(
        destinationParent,
        "$destinationResourcePath",
        "destination-inspection-failure",
      )) !== null
    ) {
      fail("destination-exists", "$destinationResourcePath");
    }

    await assertParentCurrent(sourceParent, "$sourceResourcePath");
    await assertParentCurrent(destinationParent, "$destinationResourcePath");
    await assertSourceCurrent(source);
    if (
      (await inspectParentTarget(
        destinationParent,
        "$destinationResourcePath",
        "destination-inspection-failure",
      )) !== null
    ) {
      fail("destination-exists", "$destinationResourcePath");
    }
    throwIfAborted(signal);

    try {
      await filesystemMutation.link(
        sourceParent.resourceAbsolutePath,
        destinationParent.resourceAbsolutePath,
      );
    } catch (error: unknown) {
      const code = readNodeSystemErrorCode(error);
      if (code === "EEXIST") fail("destination-exists", "$destinationResourcePath", error);
      if (code === "EXDEV") fail("cross-device", "$destinationResourcePath", error);
      fail("link-failure", "$destinationResourcePath", error);
    }
    const nodeBefore = source.initialNodeSnapshot;
    const linkedPairLinkCount = nodeBefore.linkCount + 1n;
    const linked = await inspectLinkedPair(
      source,
      sourceParent,
      destinationParent,
      linkedPairLinkCount,
    );
    // 源内容已由调用方在链接前同步；这里只让新目录项持久。
    await syncParent(destinationParent, "$destinationResourcePath");
    await assertParentCurrent(sourceParent, "$sourceResourcePath", true);
    await assertParentCurrent(destinationParent, "$destinationResourcePath", true);
    const final = await inspectLinkedPair(
      source,
      sourceParent,
      destinationParent,
      linkedPairLinkCount,
    );
    if (
      !sameFileNodeSnapshot(linked.sourceNode, final.sourceNode) ||
      !sameFileNodeSnapshot(linked.destinationNode, final.destinationNode)
    ) {
      fail("commit-uncertain", "$destinationResourcePath");
    }
    result = Object.freeze({
      sourceResourcePath: sourcePath,
      destinationResourcePath: destinationPath,
      sourceNode: final.sourceNode,
      destinationNode: final.destinationNode,
    });
  } catch (error: unknown) {
    primaryError = error;
  }

  if (source !== undefined) {
    const closeError = await closeSource(source);
    if (primaryError === undefined && closeError !== undefined) {
      primaryError = closeError;
    }
  }
  if (destinationParent !== undefined) {
    const closeError = await closeParent(destinationParent, "$destinationResourcePath");
    if (primaryError === undefined && closeError !== undefined) {
      primaryError = closeError;
    }
  }
  const sourceParentCloseError = await closeParent(sourceParent, "$sourceResourcePath");
  if (primaryError === undefined && sourceParentCloseError !== undefined) {
    primaryError = sourceParentCloseError;
  }

  if (primaryError !== undefined) throw primaryError;
  if (result === undefined) {
    fail("commit-uncertain", "$destinationResourcePath");
  }
  return result;
}
