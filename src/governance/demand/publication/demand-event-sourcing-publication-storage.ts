import nodePath from "node:path";
import { DeterministicJsonDocumentError } from "../../../foundation/data/deterministic-json-document.js";
import {
  type DeterministicJsonFileResult,
  readDeterministicJsonFile,
} from "../../../foundation/filesystem/deterministic-json-file.js";
import {
  DurableAtomicFileStageRecoveryError,
  recoverDurableAtomicFileStagesMatchingTargets,
} from "../../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
} from "../../../foundation/filesystem/durable-atomic-file-write.js";
import {
  DurableDirectoryMaterializationError,
  materializeDirectoryPath,
} from "../../../foundation/filesystem/durable-directory-materialization.js";
import {
  ExactRegularFileUnlinkError,
  unlinkRegularFileExactly,
} from "../../../foundation/filesystem/exact-regular-file-unlink.js";
import {
  type FileNodeSnapshot,
  sameFileNodeIdentity,
} from "../../../foundation/filesystem/file-node-snapshot.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
  splitPortableResourcePath,
} from "../../../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
} from "../../../foundation/filesystem/stable-directory-read.js";
import { StableFileReadError } from "../../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../../foundation/filesystem/strict-text-file.js";
import { ownedByAnotherUser } from "../../../foundation/node/current-user.js";
import { parseByteCount } from "../../../foundation/numeric/byte-count.js";
import {
  admitWakeflowResourceOperation,
  type WakeflowDirectoryContainerRecipe,
  type WakeflowResourceMutationRecipe,
  WakeflowResourceProcessingContractError,
} from "../../../foundation/resource/resource-processing-contract.js";
import { encodeUtf8 } from "../../../foundation/text/utf8.js";
import { assertActiveLayoutCurrent } from "../../../kernel/active-projection.js";
import { WakeflowError } from "../../../kernel/error.js";
import {
  createDemandEventSourcingResourceCatalog,
  WAKEFLOW_DEMAND_STATIC_RESOURCE_CATALOG,
} from "../demand-resource-catalog.js";
import { DEMAND_EVENT_SOURCING_TRANSACTIONS_ROOT_REF } from "../event-sourcing/demand-event-sourcing-paths.js";
import {
  classifyDemandStageDirectory,
  DemandStageDirectoryError,
} from "../event-sourcing/demand-stage-residue.js";
import {
  DEMAND_EVENT_SOURCING_PUBLICATION_DIRECTORY_MODE,
  DEMAND_EVENT_SOURCING_PUBLICATION_FILE_MODE,
  DemandEventSourcingPublicationServiceError,
  failDemandEventSourcingPublication as fail,
  type StoredDemandEventSourcingPublicationTransaction,
} from "./demand-event-sourcing-publication-contract.js";
import {
  type DemandEventSourcingPublicationTransaction,
  DemandEventSourcingPublicationTransactionError,
  parseDemandEventSourcingPublicationTransactionDocument,
  renderDemandEventSourcingPublicationTransaction,
} from "./demand-event-sourcing-publication-transaction.js";
import { DEMAND_PUBLICATION_MARKER_REF } from "./demand-publication-paths.js";

/** Demand 事件溯源发布流程的根作用域文件存储边界。 */

const TRANSACTION_MAXIMUM_BYTES = parseByteCount(24 * 1024 * 1024);

function admitProcessing(
  processing: Parameters<typeof admitWakeflowResourceOperation>[0],
  recipe: WakeflowResourceMutationRecipe | WakeflowDirectoryContainerRecipe,
): void {
  try {
    admitWakeflowResourceOperation(processing, recipe);
  } catch (error: unknown) {
    if (error instanceof WakeflowResourceProcessingContractError) {
      fail("operation-failure", "$catalog", "unknown", error);
    }
    throw error;
  }
}

export function admitDemandPublicationResourceOperation(
  transaction: Readonly<DemandEventSourcingPublicationTransaction>,
  ref: PortableResourcePath,
  recipe: WakeflowResourceMutationRecipe | WakeflowDirectoryContainerRecipe,
): void {
  const declaration = createDemandEventSourcingResourceCatalog(transaction.demandId).find(
    (entry) => entry.placement.relativePath === ref,
  );
  if (declaration === undefined) fail("operation-failure", "$catalog");
  admitProcessing(declaration.processing, recipe);
}

function mapPublicationReadError(error: unknown, path: string): never {
  if (error instanceof StableFileReadError) {
    if (error.reason === "aborted") fail("aborted", "$signal");
    if (error.reason === "root-scope" || error.reason === "unsupported-platform") {
      fail("root-scope", "$root");
    }
    fail("conflict", path);
  }
  if (error instanceof StrictTextFileError || error instanceof DeterministicJsonDocumentError) {
    fail("conflict", path);
  }
  throw error;
}

export async function publicationNodeOrNull(
  root: RootedDirectory,
  ref: PortableResourcePath,
): Promise<Readonly<FileNodeSnapshot> | null> {
  try {
    return (await root.inspectExistingResource(ref)).node;
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError && error.reason === "resource-not-found") {
      return null;
    }
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root");
    throw error;
  }
}

export function assertPrivatePublicationNode(
  node: Readonly<FileNodeSnapshot>,
  kind: "file" | "directory",
  path: string,
  admittedFileLinks: readonly bigint[] = [1n],
): void {
  if (
    node.kind !== kind ||
    node.permissionBits !==
      (kind === "file"
        ? DEMAND_EVENT_SOURCING_PUBLICATION_FILE_MODE
        : DEMAND_EVENT_SOURCING_PUBLICATION_DIRECTORY_MODE) ||
    (kind === "file" && !admittedFileLinks.includes(node.linkCount)) ||
    ownedByAnotherUser(node.userId)
  ) {
    fail("conflict", path);
  }
}

/** 标记所在的根相对 `root` 的位置；`ref` 就是根内的标记引用时为 null（`root` 本身就是那个根）。 */
function markerContainerRef(ref: PortableResourcePath): PortableResourcePath | null {
  if (ref === DEMAND_PUBLICATION_MARKER_REF) return null;
  const suffix = `/${DEMAND_PUBLICATION_MARKER_REF}`;
  if (!ref.endsWith(suffix)) fail("operation-failure", "$catalog");
  return parsePortableResourcePath(ref.slice(0, -suffix.length));
}

/** 在标记所在的根上执行；`root` 不是那个根时打开它，用完关上。 */
async function withMarkerContainer<Result>(
  root: RootedDirectory,
  ref: PortableResourcePath,
  operation: (container: RootedDirectory) => Promise<Result>,
): Promise<Result> {
  const containerRef = markerContainerRef(ref);
  if (containerRef === null) return operation(root);
  const container = await openDemandPublicationRoot(root, containerRef);
  let failure: { readonly error: unknown } | undefined;
  let result: Result | undefined;
  try {
    result = await operation(container);
  } catch (error: unknown) {
    failure = { error };
  }
  try {
    await container.close();
  } catch (error: unknown) {
    // 先发生的错误优先；关不掉句柄本身报成操作失败，不让基础层的错误原样漏出去。
    failure ??= {
      error: new DemandEventSourcingPublicationServiceError(
        "operation-failure",
        "$demandRoot/close",
        "unknown",
        { cause: error },
      ),
    };
  }
  if (failure !== undefined) throw failure.error;
  return result as Result;
}

/**
 * 标记有两个链接时它是不是一个死写者留下的那一对（1.4.1 段 1b）：标记经 `link(暂存, 标记)` 再
 * `unlink(暂存)` 建成，进程死在两步之间，标记与暂存共用一个节点。只读路径（同一个创建请求重发时先读
 * 标记、沿用它的时间）必须读得出这样的标记；以前它被当成冲突，那个请求从此一直被拒绝。判断用根清点的
 * 同一条规则；暂存名里的目标摘要按标记在它所在的根里的路径算，所以目录要经那个根来读。
 */
async function markerPairedWithDeadStage(
  root: RootedDirectory,
  ref: PortableResourcePath,
  node: Readonly<FileNodeSnapshot>,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  try {
    return await withMarkerContainer(root, ref, async (container) => {
      const listing = await readStableResourceDirectory(
        container,
        DEMAND_EVENT_SOURCING_TRANSACTIONS_ROOT_REF,
        { maximumEntries: 16, ...(signal === undefined ? {} : { signal }) },
      );
      const { residue } = classifyDemandStageDirectory(
        listing.entries,
        DEMAND_EVENT_SOURCING_PUBLICATION_FILE_MODE,
      );
      return residue.some(
        (stage) =>
          stage.member?.resourcePath === DEMAND_PUBLICATION_MARKER_REF &&
          sameFileNodeIdentity(stage.member.node, node),
      );
    });
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError && error.reason === "aborted") {
      fail("aborted", "$signal");
    }
    if (error instanceof StableDirectoryReadError || error instanceof DemandStageDirectoryError) {
      return false;
    }
    throw error;
  }
}

export async function readPublicationTransactionAt(
  root: RootedDirectory,
  ref: PortableResourcePath,
  node: Readonly<FileNodeSnapshot>,
  signal: AbortSignal | undefined,
): Promise<Readonly<StoredDemandEventSourcingPublicationTransaction>> {
  const paired =
    node.linkCount === 2n && (await markerPairedWithDeadStage(root, ref, node, signal));
  assertPrivatePublicationNode(node, "file", "$transaction", paired ? [1n, 2n] : [1n]);
  let read: Awaited<ReturnType<typeof readDeterministicJsonFile>>;
  try {
    read = await readDeterministicJsonFile(root, ref, {
      maximumBytes: TRANSACTION_MAXIMUM_BYTES,
      expectedNode: node,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    mapPublicationReadError(error, "$transaction");
  }
  let transaction: ReturnType<typeof parseDemandEventSourcingPublicationTransactionDocument>;
  try {
    transaction = parseDemandEventSourcingPublicationTransactionDocument(read.text);
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingPublicationTransactionError) {
      fail("conflict", "$transaction");
    }
    throw error;
  }
  return Object.freeze({ transaction, source: read });
}

export async function ensureExactPublicationTextFile(
  root: RootedDirectory,
  ref: PortableResourcePath,
  text: string,
  maximumBytes: number,
  signal: AbortSignal | undefined,
): Promise<Readonly<DeterministicJsonFileResult>> {
  const admittedMaximumBytes = parseByteCount(maximumBytes, "$maximumBytes");
  const bytes = encodeUtf8(text, "$text");
  if (bytes.byteLength > admittedMaximumBytes) fail("capacity", "$write");
  let node = await publicationNodeOrNull(root, ref);
  if (node === null) {
    try {
      const created = await createFileAtomically(root, ref, bytes, {
        mode: DEMAND_EVENT_SOURCING_PUBLICATION_FILE_MODE,
        ...(signal === undefined ? {} : { signal }),
      });
      node = created.node;
    } catch (error: unknown) {
      if (error instanceof DurableAtomicFileWriteError && error.reason === "target-exists") {
        node = await publicationNodeOrNull(root, ref);
      } else if (error instanceof DurableAtomicFileWriteError) {
        if (error.reason === "aborted") fail("aborted", "$signal");
        if (error.reason === "capacity") fail("capacity", "$write");
        if (error.reason === "root-scope") fail("root-scope", "$root");
        if (
          error.reason === "commit-uncertain" ||
          error.reason === "durability-failure" ||
          error.reason === "stage-cleanup-failure" ||
          error.reason === "stage-recovery-required" ||
          error.reason === "close-failure"
        ) {
          fail("recovery-required", "$write");
        }
        fail("operation-failure", "$write", "unknown", error);
      } else {
        throw error;
      }
    }
  }
  if (node === null) fail("operation-failure", "$write");
  assertPrivatePublicationNode(node, "file", "$write");
  let read: Awaited<ReturnType<typeof readDeterministicJsonFile>>;
  try {
    read = await readDeterministicJsonFile(root, ref, {
      maximumBytes: admittedMaximumBytes,
      expectedNode: node,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    mapPublicationReadError(error, "$write");
  }
  if (read.text !== text) fail("conflict", "$write");
  return read;
}

export async function ensurePublicationTransaction(
  root: RootedDirectory,
  ref: PortableResourcePath,
  transaction: Readonly<DemandEventSourcingPublicationTransaction>,
  signal: AbortSignal | undefined,
): Promise<Readonly<StoredDemandEventSourcingPublicationTransaction>> {
  // 事务只落成一份：暂存根（改名之后是 Demand 根）里的发布标记，引用相对那个根（5a 的 B 行，ADR-0031）。
  if (ref !== DEMAND_PUBLICATION_MARKER_REF) fail("operation-failure", "$catalog");
  const text = renderDemandEventSourcingPublicationTransaction(transaction);
  const source = await ensureExactPublicationTextFile(
    root,
    ref,
    text,
    TRANSACTION_MAXIMUM_BYTES,
    signal,
  );
  const stored = await readPublicationTransactionAt(root, ref, source.node, signal);
  if (!samePublicationTransaction(stored.transaction, transaction)) {
    fail("conflict", "$transaction");
  }
  return stored;
}

export async function retirePublicationFile(
  root: RootedDirectory,
  transaction: Readonly<DemandEventSourcingPublicationTransaction>,
  ref: PortableResourcePath,
  node: Readonly<FileNodeSnapshot>,
  signal: AbortSignal | undefined,
): Promise<void> {
  admitDemandPublicationResourceOperation(transaction, ref, "exact-retire");
  try {
    await unlinkRegularFileExactly(root, ref, {
      expectedNode: node,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof ExactRegularFileUnlinkError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("recovery-required", "$transaction");
    }
    throw error;
  }
}

function publicationPhysicalPath(root: RootedDirectory, ref: PortableResourcePath): string {
  return nodePath.join(root.absolutePath, ...splitPortableResourcePath(ref));
}

export function samePublicationTransaction(
  left: Readonly<DemandEventSourcingPublicationTransaction>,
  right: Readonly<DemandEventSourcingPublicationTransaction>,
): boolean {
  return (
    renderDemandEventSourcingPublicationTransaction(left) ===
    renderDemandEventSourcingPublicationTransaction(right)
  );
}

export async function initializePublicationStorage(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await assertActiveLayoutCurrent(root, signal === undefined ? {} : { signal });
    for (const declaration of WAKEFLOW_DEMAND_STATIC_RESOURCE_CATALOG) {
      const ref = declaration.placement.relativePath;
      if (ref === null) fail("operation-failure", "$catalog");
      admitProcessing(declaration.processing, "materialize-directory");
      const materialized = await materializeDirectoryPath(root, ref, {
        mode: DEMAND_EVENT_SOURCING_PUBLICATION_DIRECTORY_MODE,
        ...(signal === undefined ? {} : { signal }),
      });
      assertPrivatePublicationNode(materialized.node, "directory", `$${ref}`);
    }
  } catch (error: unknown) {
    if (error instanceof WakeflowError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "active-layout-root-scope") fail("root-scope", "$root");
      fail("conflict", "$activeLayout");
    }
    if (error instanceof DurableDirectoryMaterializationError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("operation-failure", "$initialize", "unknown", error);
    }
    throw error;
  }
}

/**
 * 回收发布标记自己的、写者已经不在的原子暂存文件。暂存名里记的目标摘要按写入时的路径算，而标记是经它
 * 所在的根（暂存根，改名之后是 Demand 根）写的，所以这里也经那个根去认；拿工作区相对路径去比，摘要
 * 永远对不上，什么都收不掉（1.4.1 段 1b 之前就是这样）。
 */
export async function recoverPublicationTransactionStages(
  root: RootedDirectory,
  transactionRef: PortableResourcePath,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    const receipt = await withMarkerContainer(root, transactionRef, (container) =>
      recoverDurableAtomicFileStagesMatchingTargets(
        container,
        Object.freeze([DEMAND_PUBLICATION_MARKER_REF]),
        signal === undefined ? undefined : { signal },
      ),
    );
    if (receipt.activeStageCount !== 0 || receipt.unknownStageCount !== 0) {
      fail("recovery-required", "$transaction/stage");
    }
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileStageRecoveryError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("recovery-required", "$transaction/stage");
    }
    throw error;
  }
}

export async function openDemandPublicationRoot(
  workspaceRoot: RootedDirectory,
  ref: PortableResourcePath,
  expectedNode?: Readonly<FileNodeSnapshot>,
): Promise<RootedDirectory> {
  let opened: RootedDirectory | undefined;
  try {
    opened = await RootedDirectory.open(publicationPhysicalPath(workspaceRoot, ref), undefined, {
      durability: workspaceRoot.durability,
    });
    const current = await opened.assertCurrent("$demandRoot");
    if (expectedNode !== undefined && !sameFileNodeIdentity(expectedNode, current)) {
      fail("conflict", "$demandRoot");
    }
    assertPrivatePublicationNode(current, "directory", "$demandRoot");
    return opened;
  } catch (error: unknown) {
    if (opened !== undefined) {
      try {
        await opened.close();
      } catch {
        // 打开失败的root没有交给调用方；保留首个准入错误。
      }
    }
    if (error instanceof DemandEventSourcingPublicationServiceError) {
      throw error;
    }
    if (error instanceof RootedDirectoryError) {
      fail("conflict", "$demandRoot");
    }
    throw error;
  }
}
