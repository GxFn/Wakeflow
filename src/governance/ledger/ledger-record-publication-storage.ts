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
  RootedDirectoryTreeRemovalError,
  removeRootedDirectoryTree,
} from "../../foundation/filesystem/rooted-directory-tree-removal.js";
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
import { LEDGER_DURABLE_DIRECTORY_MODE } from "./ledger-authority-storage-policy.js";
import {
  throwLedgerAuthorityStoreError as fail,
  type LoadedLedgerAuthorityRecord,
} from "./ledger-authority-store-contract.js";
import { createLedgerAuthorityResourceCatalog } from "./ledger-resource-catalog.js";

/**
 * Wakeflow Governance / Ledger：逐记录发布流程的私有存储与协调边界。
 *
 * 本模块负责暂存目录和最终目标回读校验，不解析调用方提供的成员输入。发布之间的互斥不在这里：调用方
 * 持有工作区的账本记录锁（ADR-0033）——账本目录里不放锁文件。
 *
 * 发布不记日志（1.4 第 5 段 5a 的 A 行，ADR-0031）：需求包的身份由内容推出，同一个标识的暂存目录
 * 只可能装着同样的字节，所以被打断的发布由同一个请求再发一次续上——暂存补齐（补不了的崩溃残留删掉
 * 重建一次），改名生效。此前另有一份发布意图文件和一套不带原文档的恢复函数，现场里一次都没有用上，
 * 已经删掉。
 */

/** 一次发布在内存里的计划：记录、它的两个路径与目录树的精确清单。不落盘。 */
export interface LedgerRecordPublicationPlan {
  readonly record: Readonly<RequirementRecord>;
  readonly finalRootRef: PortableResourcePath;
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
    return (await root.inspectResourceOrNull(resourcePath))?.node ?? null;
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root", error);
    throw error;
  }
}

/**
 * 这条记录的暂存目录处在哪种状态。它只可能是同一份内容被打断的发布留下的。
 *
 * - `absent`：不在。
 * - `resumable`：当前用户的目录、权限位是持久目录的，交给补齐路径续做。
 * - `residue`：当前用户的目录，但权限位不对。进程 umask 把请求的权限位收窄时，mkdir 以收窄后的
 *   权限位出生、再经句柄 chmod：chmod 之前进程被杀，或者掉电时 chmod 没有落盘（第 1 段起建造期间
 *   不同步目录），都会留下它；发布器把它删掉重建。不被收窄时（常见的 umask 022）目录以请求的
 *   权限位出生，新的建造不会留下这种状态；1.4.0 的建造被打断留下的暂存（那时一律以 0700 出生）仍是它。
 *
 * 不是目录、或属于别的用户的节点不是本发布器造的，照旧报冲突。
 */
export async function ledgerRecordPublicationStageState(
  root: RootedDirectory,
  plan: Readonly<LedgerRecordPublicationPlan>,
): Promise<"absent" | "resumable" | "residue"> {
  const stageNode = await ledgerPublicationResourceNodeOrNull(root, plan.stageRef);
  if (stageNode === null) return "absent";
  const userId = currentUserIdOrNull();
  if (stageNode.kind !== "directory" || (userId !== null && stageNode.userId !== userId)) {
    fail("conflict", "$stage");
  }
  return stageNode.permissionBits === LEDGER_DURABLE_DIRECTORY_MODE ? "resumable" : "residue";
}

/**
 * 删掉这条记录的暂存目录整棵树，删除之后同步 `transactions/` 一次再返回。只由发布器在记录锁内、
 * final 不在时调用（安全论证在发布器里）。删不掉报 `recovery-required`：树可能删了一半，同一个
 * 请求再发一次会重新判断，续做或者再删。
 */
export async function retireLedgerRecordPublicationStage(
  root: RootedDirectory,
  plan: Readonly<LedgerRecordPublicationPlan>,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await removeRootedDirectoryTree(
      root,
      plan.stageRef,
      signal === undefined ? undefined : { signal },
      "$stage",
    );
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryTreeRemovalError) {
      fail("recovery-required", "$stage", error);
    }
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
      if (error.reason === "cross-device") fail("root-scope", "$stage", error);
      if (error.reason === "commit-uncertain" || error.reason === "durability-failure") {
        fail("recovery-required", "$stage", error);
      }
      fail("conflict", "$stage", error);
    }
    throw error;
  }
}
