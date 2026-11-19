import {
  type DirectoryTreeCandidatePlan,
  type DirectoryTreeCandidateResult,
  DurableDirectoryTreeCandidateError,
  inspectDirectoryTreeCandidate,
} from "../../foundation/filesystem/durable-directory-tree-candidate.js";
import {
  DurableDirectoryTreePublicationError,
  publishDirectoryTreeCandidateDurably,
} from "../../foundation/filesystem/durable-directory-tree-publication.js";
import type { FileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import {
  type RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  inspectRootedExclusiveFileLock,
  RootedExclusiveFileLockError,
  retireRootedExclusiveFileLockResidue,
  withRootedExclusiveFileLock,
} from "../../foundation/filesystem/rooted-exclusive-file-lock.js";
import { currentUserIdOrNull } from "../../foundation/node/current-user.js";
import {
  admitWakeflowResourceOperation,
  type WakeflowDirectoryContainerRecipe,
  type WakeflowResourceMutationRecipe,
  WakeflowResourceProcessingContractError,
} from "../../foundation/resource/resource-processing-contract.js";
import { loadLedgerAuthorityRecord } from "./ledger-authority-reader.js";
import {
  computeLedgerAuthorityRecordDigest,
  type RequirementRecord,
} from "./ledger-authority-record.js";
import {
  LEDGER_DURABLE_DIRECTORY_MODE,
  LEDGER_RECORD_PUBLICATION_LOCK_TIMEOUT_MILLISECONDS,
} from "./ledger-authority-storage-policy.js";
import {
  throwLedgerAuthorityStoreError as fail,
  LedgerAuthorityStoreError,
  type LoadedLedgerAuthorityRecord,
} from "./ledger-authority-store-contract.js";
import { createLedgerAuthorityResourceCatalog } from "./ledger-resource-catalog.js";

/**
 * Wakeflow Governance / Ledger：逐记录发布流程的私有存储与协调边界。
 *
 * 本模块负责暂存目录、逐记录锁和最终目标回读校验，不解析调用方提供的成员输入。
 *
 * 发布不记日志（1.4 第 5 段 5a 的 A 行，ADR-0031）：需求包的身份由内容推出，同一个标识的暂存目录
 * 只可能装着同样的字节，所以被打断的发布由同一个请求再发一次续上——暂存补齐，改名生效。此前另有
 * 一份发布意图文件和一套不带原文档的恢复函数，现场里一次都没有用上，已经删掉。
 */

/** 一次发布在内存里的计划：记录、它的三个路径与目录树的精确清单。不落盘。 */
export interface LedgerRecordPublicationPlan {
  readonly record: Readonly<RequirementRecord>;
  readonly finalRootRef: PortableResourcePath;
  readonly lockRef: PortableResourcePath;
  readonly stageRef: PortableResourcePath;
  readonly treePlan: Readonly<DirectoryTreeCandidatePlan>;
}

function admitLedgerResourceOperation(
  plan: Readonly<LedgerRecordPublicationPlan>,
  resourcePath: PortableResourcePath,
  recipe: WakeflowResourceMutationRecipe | WakeflowDirectoryContainerRecipe,
): void {
  const declaration = createLedgerAuthorityResourceCatalog(plan.record).find(
    (entry) => entry.placement.relativePath === resourcePath,
  );
  if (declaration === undefined) fail("operation-failure", "$catalog");
  try {
    admitWakeflowResourceOperation(declaration.processing, recipe);
  } catch (error: unknown) {
    if (error instanceof WakeflowResourceProcessingContractError) {
      fail("operation-failure", "$catalog", error);
    }
    throw error;
  }
}

export async function ledgerPublicationResourceNodeOrNull(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
): Promise<Readonly<FileNodeSnapshot> | null> {
  try {
    return (await root.inspectExistingResource(resourcePath)).node;
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError && error.reason === "resource-not-found") {
      return null;
    }
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root", error);
    throw error;
  }
}

function assertTransactionStageNode(node: Readonly<FileNodeSnapshot>): void {
  const userId = currentUserIdOrNull();
  if (
    node.kind !== "directory" ||
    node.permissionBits !== LEDGER_DURABLE_DIRECTORY_MODE ||
    (userId !== null && node.userId !== userId)
  ) {
    fail("conflict", "$stage");
  }
}

/** 这条记录的暂存目录；不在即 null。它只可能是同一份内容被打断的发布留下的。 */
export async function ledgerRecordPublicationStageNodeOrNull(
  root: RootedDirectory,
  plan: Readonly<LedgerRecordPublicationPlan>,
): Promise<Readonly<FileNodeSnapshot> | null> {
  const stageNode = await ledgerPublicationResourceNodeOrNull(root, plan.stageRef);
  if (stageNode !== null) assertTransactionStageNode(stageNode);
  return stageNode;
}

export async function prepareLedgerRecordPublicationLockRecovery(
  root: RootedDirectory,
  lockRef: PortableResourcePath,
): Promise<void> {
  let observation: Awaited<ReturnType<typeof inspectRootedExclusiveFileLock>>;
  try {
    observation = await inspectRootedExclusiveFileLock(root, lockRef);
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) {
      fail("lock-unsafe", "$lock", error);
    }
    throw error;
  }
  if (observation.status !== "held" || observation.ownerState !== "inactive") {
    return;
  }
  try {
    await retireRootedExclusiveFileLockResidue(root, lockRef, observation);
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) {
      fail("recovery-required", "$lock", error);
    }
    throw error;
  }
}

function mapLockError(error: RootedExclusiveFileLockError): never {
  if (error.reason === "timeout") fail("lock-timeout", "$lock");
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (
    error.reason === "unsafe-lock" ||
    error.reason === "parent" ||
    error.reason === "root-scope"
  ) {
    fail("lock-unsafe", "$lock");
  }
  fail("recovery-required", "$lock");
}

export async function withLedgerRecordPublicationLock<Result>(
  root: RootedDirectory,
  lockRef: PortableResourcePath,
  signal: AbortSignal | undefined,
  action: () => Promise<Result>,
): Promise<Result> {
  try {
    return await withRootedExclusiveFileLock(root, lockRef, action, {
      acquireTimeoutMilliseconds: LEDGER_RECORD_PUBLICATION_LOCK_TIMEOUT_MILLISECONDS,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityStoreError) throw error;
    if (error instanceof RootedExclusiveFileLockError) mapLockError(error);
    throw error;
  }
}

export async function loadExactPublishedLedgerRecord(
  root: RootedDirectory,
  plan: Readonly<LedgerRecordPublicationPlan>,
  signal: AbortSignal | undefined,
): Promise<Readonly<LoadedLedgerAuthorityRecord>> {
  const finalNode = await ledgerPublicationResourceNodeOrNull(root, plan.finalRootRef);
  if (finalNode === null) fail("not-found", "$record");
  if (finalNode.kind !== "directory") fail("conflict", "$record");
  try {
    await inspectDirectoryTreeCandidate(root, plan.finalRootRef, plan.treePlan, {
      expectedRootNode: finalNode,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      if (error.reason === "aborted") fail("aborted", "$signal", error);
      fail("conflict", "$record", error);
    }
    throw error;
  }
  const loaded = await loadLedgerAuthorityRecord(root, plan.record.requirementId, signal);
  if (
    loaded.recordDigest !== computeLedgerAuthorityRecordDigest(plan.record) ||
    loaded.documents.length !== plan.record.documents.length ||
    loaded.documents.some(
      (document, index) => document.digest !== plan.record.documents[index]?.digest,
    )
  ) {
    fail("conflict", "$record");
  }
  return loaded;
}

export async function publishLedgerRecordStage(
  root: RootedDirectory,
  plan: Readonly<LedgerRecordPublicationPlan>,
  candidate: Readonly<DirectoryTreeCandidateResult>,
  signal: AbortSignal | undefined,
): Promise<void> {
  admitLedgerResourceOperation(plan, plan.finalRootRef, "exact-directory-publish");
  try {
    await publishDirectoryTreeCandidateDurably(
      root,
      candidate,
      plan.finalRootRef,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreePublicationError) {
      if (error.reason === "aborted") fail("aborted", "$signal", error);
      if (error.reason === "cross-device") fail("root-scope", "$stage", error);
      if (error.reason === "commit-uncertain" || error.reason === "durability-failure") {
        fail("recovery-required", "$stage", error);
      }
      fail("conflict", "$stage", error);
    }
    throw error;
  }
}
