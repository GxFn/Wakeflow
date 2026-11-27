import { lstat } from "node:fs/promises";

import { throwIfAborted } from "../node/abort-signal.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import {
  assertDurableAtomicFileStageCurrent,
  closeDurableAtomicFileStageHandle,
  createExclusiveDurableAtomicFileStage,
  type OpenDurableAtomicFileStage,
  type PreparedDurableAtomicFileStage,
  prepareDurableAtomicFileStage,
  recoverDurableAtomicFileStagesBeforeWrite,
  releaseDurableAtomicFileStage,
  unlinkOwnedDurableAtomicFileStage,
} from "./durable-atomic-file-stage-io.js";
import {
  assertDurableAtomicFileTargetAbsent,
  assertDurableAtomicFileTargetParentCurrent,
  assertExpectedDurableAtomicFileTarget,
  closeDurableAtomicFileTargetParent,
  inspectCommittedDurableAtomicFileTarget,
  openDurableAtomicFileTargetParent,
  syncDurableAtomicFileTargetParent,
} from "./durable-atomic-file-target-io.js";
import {
  type DurableAtomicFileCreateOptions,
  type DurableAtomicFileDurability,
  type DurableAtomicFileExpectation,
  type DurableAtomicFileInputBytes,
  type DurableAtomicFilePublication,
  type DurableAtomicFileReplaceOptions,
  type DurableAtomicFileReplaceResult,
  DurableAtomicFileWriteError,
  type DurableAtomicFileWriteResult,
  failDurableAtomicFileWrite as fail,
  snapshotDurableAtomicFileInputBytes,
} from "./durable-atomic-file-write-contract.js";
import {
  createFileNodeSnapshot,
  type FileNodeSnapshot,
  sameFileNodeSnapshot,
} from "./file-node-snapshot.js";
import { filesystemMutation } from "./filesystem-mutation.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import type { RootedDirectory } from "./rooted-directory.js";
import type { RootedResourceParentHandle } from "./rooted-resource-parent-handle.js";

/**
 * Wakeflow Foundation / Filesystem：单个完整字节文件的耐久原子发布门面。
 *
 * 本模块独占“创建时建立硬链接”和“替换时执行重命名”两个提交点，并编排相邻合同、
 * 自描述暂存文件 I/O、目标预期和父目录持久性。子模块不公开第二套写入器；调用方
 * 仍只使用本模块的创建和替换 API。
 *
 * 创建（`fsync` 级别）恰好三次同步，可见步骤与父目录同步的顺序固定：写暂存、同步暂存内容、
 * 硬链接到目标、同步父目录、删暂存、同步父目录。替换恰好两次：写暂存、同步暂存内容、
 * 在当前目标仍与调用方读到的预期一致时重命名、同步父目录。替换在建暂存之前先做一次廉价预检
 * （对目标一次 `lstat`，与预期里的节点快照比较，不读内容、不算摘要），过时的预期在这里失败时
 * 磁盘上什么都不留（拒绝之前先复验父目录，父目录被换走报 `parent-changed`）；完整的预期比较（摘要）只做一次，紧挨重命名，是唯一的发布条件。
 * 两者都不把写下的字节读回来比对，提交之后的复验只比较句柄、路径名与目标上的节点身份。
 * 必须守住的不变量：`fsync` 级别下，旁边没有暂存的目标，它的目录项已经同步过——暂存只在
 * 链接之后那次父目录同步完成以后才删。本层不创建父目录、不解释业务权威事实，也不替代
 * 领域互斥锁或恢复意图记录。
 *
 * `target-exists` 在 `fsync` 级别意味着“目标的目录项已经落盘”：有的调用方把它读作成功
 * （同一份记录已经在了）。目标旁边若还有另一个写入者的暂存（它链接之后、第一次父目录同步
 * 之前被杀，或仍在运行、或写入前的恢复因并发枚举报忙而跳过了它），这个目录项可能还没同步过。
 * 所以创建在三处报 `target-exists` 之前（第一次与第二次“目标不存在”检查、链接的 `EEXIST`）
 * 各先同步一次目标的父目录：目录同步让此前该目录里的全部目录项变化落盘，含对方的链接，而对方
 * 在链接之前已经同步过暂存内容。这次同步只在本次写入自己的有效级别会同步父目录时发生（`fsync`），
 * `none` 与 `none` 的根都不同步，那里的 `target-exists` 只说明“名字在”。保证的范围只是目标自己的
 * 父目录、且只对链接之前同步过内容的目标（`fsync` 的写入者）成立，不涉及任何祖先目录的目录项。
 * 这次同步失败时调用方拿不到 `target-exists`：同步调用失败报 `durability-failure`，同步前后父目录
 * 身份变了报 `parent-changed`，两者都按失败处理（读作成功的调用方因此报错重试）。成功路径不多同步：
 * 上面的三次与两次不变。
 *
 * 是否真正执行 `fsync` 的权威是根的持久化级别：`root.durability` 为 `none` 时，
 * 经由该根的创建与替换都不同步。创建的逐次选项 `durability` 只能往下收：`none` 一次都不同步
 * （供可重建的派生检查点使用）；两者取更弱的一档，逐次选项无法把一个 `none` 的根抬回 `fsync`。
 * 替换没有逐次选项，永远按 `fsync` 请求、只由根收窄。上面"旁边没有暂存的目标已经同步过目录项"的
 * 不变量只对 `fsync` 级别成立。（只同步内容、不同步父目录的中间一档随带属主记录的锁文件一起删掉了，
 * ADR-0033：它只被锁用过。）
 *
 * 逐次选项只管本次发布协议本身（暂存内容、链接、删暂存前后的父目录同步）。写入之前对同一
 * 目标遗留暂存的恢复不看逐次选项，只跟随根的级别：`fsync` 的根上，即使本次是 `none`，退役一个
 * 中断留下的暂存仍可能同步一次父目录；上面"零次"的计数只在旁边没有可退役的遗留暂存时成立。
 *
 * 失败时本次自己的暂存（尚未提交）会被删掉并同步父目录。清理再失败时，主错误优先（例如替换在
 * 暂存写好之后才发现预期已过时，调用方仍看到 `expectation-changed`）；唯一的例外是主错误为
 * `target-exists`：读作成功的调用方不能把一次没做成的清理当成功吞掉，所以调用方看到的是清理
 * 失败本身（`stage-cleanup-failure`，或清理那次父目录同步的 `durability-failure` / `parent-changed`）。
 */

/** 报 `target-exists` 之前，本次写入的有效级别会同步父目录时先同步一次；失败时抛同步自己的错误。 */
async function settleExistingTargetBeforeReport(
  parent: RootedResourceParentHandle,
  syncParent: boolean,
): Promise<void> {
  if (syncParent) await syncDurableAtomicFileTargetParent(parent);
}

/** 创建前的“目标不存在”检查；目标已在时先按级别同步父目录，再报 `target-exists`。 */
async function assertCreateTargetAbsent(
  parent: RootedResourceParentHandle,
  syncParent: boolean,
): Promise<void> {
  try {
    await assertDurableAtomicFileTargetAbsent(parent);
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError && error.reason === "target-exists") {
      await settleExistingTargetBeforeReport(parent, syncParent);
    }
    throw error;
  }
}

/**
 * 替换在建暂存之前的廉价预检：对目标一次 `lstat`，与预期里的节点快照比较。它只能拒绝、不能放行：
 * 通过之后紧挨重命名的完整比较仍会再读一遍目标并比较摘要。
 *
 * 裸 `lstat` 走路径名、不复验父目录；父目录被换走时它看见的是别处的节点（或 `ENOENT`、`ENOTDIR`）。
 * 所以拒绝之前先复验父目录：父目录已经不是打开的那一个时报 `parent-changed`，与其余各步一致；
 * 这次复验只发生在拒绝路径上。
 */
async function assertExpectedTargetNodeUnchanged(
  parent: RootedResourceParentHandle,
  expected: Readonly<DurableAtomicFileExpectation>,
): Promise<void> {
  let current: Readonly<FileNodeSnapshot> | null = null;
  let cause: unknown;
  try {
    current = createFileNodeSnapshot(
      await lstat(parent.resourceAbsolutePath, { bigint: true }),
      "$resourcePath",
    );
  } catch (error: unknown) {
    cause = error;
  }
  if (current !== null && sameFileNodeSnapshot(current, expected.node)) return;
  await assertDurableAtomicFileTargetParentCurrent(parent);
  if (current !== null || readNodeSystemErrorCode(cause) === "ENOENT") {
    fail("expectation-changed", "$resourcePath", cause);
  }
  fail("expectation-read-failure", "$resourcePath", cause);
}

async function performWrite<Publication extends DurableAtomicFilePublication>(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  input: Readonly<DurableAtomicFileInputBytes>,
  mode: number,
  signal: AbortSignal | undefined,
  publication: Publication,
  expected: Readonly<DurableAtomicFileExpectation> | null,
  requested: DurableAtomicFileDurability,
): Promise<Readonly<DurableAtomicFileWriteResult<Publication>>> {
  // 暂存内容与父目录要么都同步、要么都不同步；根为 `none` 时逐次选项抬不回来。
  const syncParent = root.durability !== "none" && requested === "fsync";
  const parent = await openDurableAtomicFileTargetParent(root, resourcePath);
  let openStage: Readonly<OpenDurableAtomicFileStage> | undefined;
  let stage: Readonly<PreparedDurableAtomicFileStage> | undefined;
  let stagePathOwned = false;
  let committed = false;
  let primaryError: unknown;
  let result: Readonly<DurableAtomicFileWriteResult<Publication>> | undefined;

  try {
    await recoverDurableAtomicFileStagesBeforeWrite(root, resourcePath, signal);
    throwIfAborted(signal);
    if (publication === "created") {
      await assertCreateTargetAbsent(parent, syncParent);
    } else if (expected !== null) {
      await assertExpectedTargetNodeUnchanged(parent, expected);
    }

    openStage = await createExclusiveDurableAtomicFileStage(
      parent,
      publication === "created" ? "create" : "replace",
      resourcePath,
      input.digest,
      mode,
    );
    stagePathOwned = true;
    stage = await prepareDurableAtomicFileStage(openStage, input, mode, signal, syncParent);
    await assertDurableAtomicFileTargetParentCurrent(parent);
    await assertDurableAtomicFileStageCurrent(stage);
    throwIfAborted(signal);

    if (publication === "created") {
      await assertCreateTargetAbsent(parent, syncParent);
    } else if (expected !== null) {
      // 替换唯一的一次完整比较：紧挨着重命名，当前目标仍是调用方读到的那一份才发布。
      await assertExpectedDurableAtomicFileTarget(root, resourcePath, expected, signal);
    }
    await assertDurableAtomicFileTargetParentCurrent(parent);
    await assertDurableAtomicFileStageCurrent(stage);
    throwIfAborted(signal);

    let finalNode: Readonly<FileNodeSnapshot>;
    if (publication === "created") {
      try {
        await filesystemMutation.link(stage.physicalPath, parent.resourceAbsolutePath);
      } catch (error: unknown) {
        if (readNodeSystemErrorCode(error) === "EEXIST") {
          await settleExistingTargetBeforeReport(parent, syncParent);
          fail("target-exists", "$resourcePath", error);
        }
        fail("publish-failure", "$resourcePath", error);
      }
      committed = true;
      const linkedNode = await inspectCommittedDurableAtomicFileTarget(
        parent,
        stage,
        input,
        mode,
        2n,
      );
      // 先让双链接对的目录项落盘，再删暂存：目标旁边没有暂存，就说明目标的目录项已经同步过；
      // 后续清理中断时，暂存文件恢复仍可前向结算。
      if (syncParent) await syncDurableAtomicFileTargetParent(parent);
      await assertDurableAtomicFileTargetParentCurrent(parent);
      const durableLinkedNode = await inspectCommittedDurableAtomicFileTarget(
        parent,
        stage,
        input,
        mode,
        2n,
      );
      if (!sameFileNodeSnapshot(linkedNode, durableLinkedNode)) {
        fail("commit-uncertain", "$resourcePath");
      }
      await unlinkOwnedDurableAtomicFileStage(stage);
      stagePathOwned = false;
      if (syncParent) await syncDurableAtomicFileTargetParent(parent);
      await assertDurableAtomicFileTargetParentCurrent(parent);
      finalNode = await inspectCommittedDurableAtomicFileTarget(parent, stage, input, mode, 1n);
    } else {
      try {
        await filesystemMutation.rename(stage.physicalPath, parent.resourceAbsolutePath);
      } catch (cause: unknown) {
        fail("publish-failure", "$resourcePath", cause);
      }
      committed = true;
      stagePathOwned = false;
      const committedNode = await inspectCommittedDurableAtomicFileTarget(
        parent,
        stage,
        input,
        mode,
        1n,
      );
      if (syncParent) await syncDurableAtomicFileTargetParent(parent);
      await assertDurableAtomicFileTargetParentCurrent(parent);
      finalNode = await inspectCommittedDurableAtomicFileTarget(parent, stage, input, mode, 1n);
      if (!sameFileNodeSnapshot(committedNode, finalNode)) {
        fail("commit-uncertain", "$resourcePath");
      }
    }
    result = Object.freeze({
      resourcePath,
      publication,
      node: finalNode,
      byteCount: input.byteCount,
      digest: input.digest,
    });
  } catch (error: unknown) {
    primaryError = error;
  }

  if (openStage !== undefined && stagePathOwned && !committed) {
    try {
      await unlinkOwnedDurableAtomicFileStage(openStage);
      if (syncParent) await syncDurableAtomicFileTargetParent(parent);
      stagePathOwned = false;
    } catch (error: unknown) {
      // 清理失败不得盖住更早的主错误（例如替换在暂存写好之后才发现预期已过时）；
      // 主错误是 `target-exists` 时例外：有的调用方把它读作成功，清理失败必须让它看见。
      if (
        primaryError === undefined ||
        (primaryError instanceof DurableAtomicFileWriteError &&
          primaryError.reason === "target-exists")
      ) {
        primaryError = error;
      }
    }
  }
  if (openStage !== undefined) {
    const closeError = await closeDurableAtomicFileStageHandle(openStage.handle);
    if (primaryError === undefined && closeError !== undefined) {
      primaryError = closeError;
    }
    const releaseError = releaseDurableAtomicFileStage(openStage);
    if (primaryError === undefined && releaseError !== undefined) {
      primaryError = releaseError;
    }
  }
  const parentCloseError = await closeDurableAtomicFileTargetParent(parent);
  if (primaryError === undefined && parentCloseError !== undefined) {
    primaryError = parentCloseError;
  }

  if (primaryError !== undefined) throw primaryError;
  if (committed !== true || result === undefined) {
    fail("commit-uncertain", "$resourcePath");
  }
  return result;
}

/** 耐久创建一个此前不存在的完整字节文件。 */
export async function createFileAtomically(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  bytes: Uint8Array,
  options: DurableAtomicFileCreateOptions,
): Promise<Readonly<DurableAtomicFileWriteResult<"created">>> {
  const { mode, durability = "fsync", signal } = options;
  const input = snapshotDurableAtomicFileInputBytes(bytes);
  throwIfAborted(signal);
  return performWrite(root, resourcePath, input, mode, signal, "created", null, durability);
}

/**
 * 耐久替换一个仍匹配完整前序 StableFileSource 的完整字节文件。
 *
 * 预期必须是同一个资源路径上读到的那一份：两个参数之间的这层关系类型表达不了，所以这里核对。
 */
export async function replaceFileAtomically(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  bytes: Uint8Array,
  options: DurableAtomicFileReplaceOptions,
): Promise<Readonly<DurableAtomicFileReplaceResult>> {
  const { mode, expected, signal } = options;
  if (expected.resourcePath !== resourcePath) {
    fail("input", "$options.expected.resourcePath");
  }
  const input = snapshotDurableAtomicFileInputBytes(bytes);
  throwIfAborted(signal);
  const result = await performWrite(
    root,
    resourcePath,
    input,
    mode,
    signal,
    "replaced",
    expected,
    // 替换永远按 `fsync` 请求，级别只由根收窄；这里没有可转发的逐次豁免。
    "fsync",
  );
  return Object.freeze({ ...result, previous: expected });
}

export {
  type DurableAtomicFileCreateOptions,
  type DurableAtomicFileReplaceOptions,
  type DurableAtomicFileReplaceResult,
  DurableAtomicFileWriteError,
  type DurableAtomicFileWriteResult,
} from "./durable-atomic-file-write-contract.js";
