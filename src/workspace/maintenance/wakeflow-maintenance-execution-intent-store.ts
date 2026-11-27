import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { DeterministicJsonDocumentError } from "../../foundation/data/deterministic-json-document.js";
import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import {
  createFileAtomically,
  type DurableAtomicFileReplaceResult,
  DurableAtomicFileWriteError,
  type DurableAtomicFileWriteResult,
  replaceFileAtomically,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import {
  ExactRegularFileUnlinkError,
  type ExactRegularFileUnlinkReceipt,
  unlinkRegularFileExactly,
} from "../../foundation/filesystem/exact-regular-file-unlink.js";
import type { FileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import {
  type RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
} from "../../foundation/filesystem/stable-directory-read.js";
import { StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../foundation/filesystem/strict-text-file.js";
import { requireCurrentUserId } from "../../foundation/node/current-user.js";
import { type ByteCount, parseByteCount } from "../../foundation/numeric/byte-count.js";
import {
  admitWakeflowResourceOperation,
  WakeflowResourceProcessingContractError,
} from "../../foundation/resource/resource-processing-contract.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  advanceWakeflowMaintenanceExecutionIntent,
  computeWakeflowMaintenanceExecutionIntentDigest,
  createWakeflowMaintenanceIntentResourceDeclaration,
  parseWakeflowMaintenanceExecutionIntent,
  renderWakeflowMaintenanceExecutionIntent,
  type WakeflowMaintenanceExecutionIntent,
  WakeflowMaintenanceExecutionIntentError,
} from "./wakeflow-maintenance-execution-intent.js";
import {
  assertWakeflowMaintenanceGateContext,
  type WakeflowMaintenanceGateContext,
  WakeflowMaintenanceGateError,
} from "./wakeflow-maintenance-gate.js";
import {
  type WakeflowMaintenanceOperationId,
  wakeflowMaintenanceIntentRef,
} from "./wakeflow-maintenance-operation-id.js";
import { WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF } from "../wakeflow-maintenance-resource-catalog.js";
import {
  parseWakeflowMaintenanceWriter,
  type WakeflowMaintenanceWriter,
} from "./wakeflow-maintenance-writer.js";

/**
 * Wakeflow Workspace / Maintenance：execution intent 的私有物理 store。
 *
 * Intent 以0600 absent-only原子发布一次；此后唯一的改写是做完一步之后把 `completedSteps` 加一
 *（按原文件的节点与摘要做精确替换，意图摘要必须不变）。它是一次维护在事务目录里唯一的文件：每次
 * 目录形状检查都只接受同operation的这一份（1.4 第 5 段 5a 的 C 行，ADR-0031；此前另有一份检查点日志）。
 */

const WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_MAXIMUM_BYTES = parseByteCount(
  2 * 1024 * 1024,
  "$maintenanceIntent.maximumBytes",
);

export interface WakeflowMaintenanceExecutionIntentSource {
  readonly operationId: WakeflowMaintenanceOperationId;
  readonly resourcePath: ReturnType<typeof wakeflowMaintenanceIntentRef>;
  readonly node: Readonly<FileNodeSnapshot>;
  readonly digest: Sha256Digest;
  readonly intentDigest: Sha256Digest;
  readonly intent: Readonly<WakeflowMaintenanceExecutionIntent>;
}

export interface WakeflowMaintenanceExecutionIntentRetirementReceipt {
  readonly disposition: "retired-intent";
  readonly operationId: WakeflowMaintenanceOperationId;
  readonly intentDigest: Sha256Digest;
  readonly retirement: Readonly<ExactRegularFileUnlinkReceipt>;
}

export type WakeflowMaintenanceExecutionIntentStoreErrorReason =
  | "input"
  | "gate"
  | "transactions-shape"
  | "source"
  | "source-policy"
  | "intent"
  | "capacity"
  | "conflict"
  | "recovery-required"
  | "effect-failure"
  | "commit-uncertain";

/** Maintenance execution intent store 失败的稳定、脱敏错误。 */
export class WakeflowMaintenanceExecutionIntentStoreError extends ModuleError<WakeflowMaintenanceExecutionIntentStoreErrorReason> {
  static override readonly code = "wakeflow-maintenance-execution-intent-store";
}

const fail: Fail<WakeflowMaintenanceExecutionIntentStoreErrorReason> = failWith(
  WakeflowMaintenanceExecutionIntentStoreError,
);

const ISSUED_SOURCES = new WeakSet<object>();

function admittedByteCount(bytes: Uint8Array): ByteCount {
  if (bytes.byteLength > WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_MAXIMUM_BYTES) {
    fail("capacity", "$intent");
  }
  return parseByteCount(bytes.byteLength, "$intent.byteCount");
}

/** 在任何bootstrap/gate效果前验证intent的确定性持久表示容量。 */
export function assertWakeflowMaintenanceExecutionIntentCapacity(
  intent: Readonly<WakeflowMaintenanceExecutionIntent>,
): ByteCount {
  return admittedByteCount(encodeUtf8(renderWakeflowMaintenanceExecutionIntent(intent)));
}

function currentUserId(): bigint {
  return requireCurrentUserId(() => fail("source-policy", "$intent"));
}

/** 只认本 store 签发的 source（ISSUED_SOURCES）。 */
function assertSource(value: Readonly<WakeflowMaintenanceExecutionIntentSource>): void {
  if (!ISSUED_SOURCES.has(value)) fail("input", "$intentSource");
}

function admitOperation(
  operationId: WakeflowMaintenanceOperationId,
  recipe: "exclusive-create" | "exact-source-replace" | "exact-retire",
): void {
  try {
    admitWakeflowResourceOperation(
      createWakeflowMaintenanceIntentResourceDeclaration(operationId).processing,
      recipe,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowResourceProcessingContractError) {
      fail("input", "$intent", error);
    }
    throw error;
  }
}

async function assertTransactionEntries(
  root: RootedDirectory,
  expected: readonly PortableResourcePath[],
): Promise<void> {
  let read: Awaited<ReturnType<typeof readStableResourceDirectory>>;
  try {
    read = await readStableResourceDirectory(root, WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF, {
      maximumEntries: expected.length,
    });
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError) {
      fail("transactions-shape", "$transactions", error);
    }
    throw error;
  }
  const actual = read.entries.map((entry) => entry.resourcePath).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((entry, index) => entry !== sortedExpected[index])
  ) {
    fail("transactions-shape", "$transactions");
  }
}

/** 证明transactions目录精确为空。 */
async function assertWakeflowMaintenanceTransactionsEmpty(root: RootedDirectory): Promise<void> {
  return assertTransactionEntries(root, []);
}

/** 证明transactions只含指定exact intent，并且它还是读到时的那一份。 */
export async function assertWakeflowMaintenanceIntentIsOnlyTransaction(
  root: RootedDirectory,
  source: Readonly<WakeflowMaintenanceExecutionIntentSource>,
): Promise<void> {
  assertSource(source);
  await assertTransactionEntries(root, [source.resourcePath]);
  await assertIntentSourceCurrent(root, source);
}

async function assertIntentSourceCurrent(
  root: RootedDirectory,
  source: Readonly<WakeflowMaintenanceExecutionIntentSource>,
): Promise<void> {
  const current = await readWakeflowMaintenanceExecutionIntent(root, source.operationId);
  if (
    current.digest !== source.digest ||
    current.intentDigest !== source.intentDigest ||
    current.node.deviceId !== source.node.deviceId ||
    current.node.inodeId !== source.node.inodeId
  ) {
    fail("conflict", "$intent");
  }
}

async function resourceNodeOrNull(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
): Promise<Readonly<FileNodeSnapshot> | null> {
  try {
    return (await root.inspectResourceOrNull(resourcePath))?.node ?? null;
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("source", "$intent", error);
    throw error;
  }
}

async function readIntentAtNode(
  root: RootedDirectory,
  operationId: WakeflowMaintenanceOperationId,
  node: Readonly<FileNodeSnapshot>,
): Promise<Readonly<WakeflowMaintenanceExecutionIntentSource>> {
  if (
    node.kind !== "file" ||
    node.permissionBits !== 0o600 ||
    node.linkCount !== 1n ||
    node.userId !== currentUserId()
  ) {
    fail("source-policy", "$intent");
  }
  const resourcePath = wakeflowMaintenanceIntentRef(operationId);
  let read: Awaited<ReturnType<typeof readDeterministicJsonFile>>;
  try {
    read = await readDeterministicJsonFile(root, resourcePath, {
      maximumBytes: WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_MAXIMUM_BYTES,
      expectedNode: node,
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      if (error.reason === "too-large") fail("capacity", "$intent", error);
      fail("source", "$intent", error);
    }
    if (error instanceof StrictTextFileError || error instanceof DeterministicJsonDocumentError) {
      fail("intent", "$intent", error);
    }
    throw error;
  }
  let intent: ReturnType<typeof parseWakeflowMaintenanceExecutionIntent>;
  try {
    intent = parseWakeflowMaintenanceExecutionIntent(read.value);
    if (renderWakeflowMaintenanceExecutionIntent(intent) !== read.text) {
      fail("intent", "$intent");
    }
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceExecutionIntentError) {
      fail("intent", error.path, error);
    }
    throw error;
  }
  if (intent.operationId !== operationId) fail("intent", "$/operationId");
  const intentDigest = computeWakeflowMaintenanceExecutionIntentDigest(intent);
  const source = Object.freeze({
    operationId,
    resourcePath,
    node: read.node,
    digest: read.digest,
    intentDigest,
    intent,
  });
  ISSUED_SOURCES.add(source);
  return source;
}

/** 读取并严格复验一个immutable execution intent。 */
export async function readWakeflowMaintenanceExecutionIntent(
  root: RootedDirectory,
  operationId: WakeflowMaintenanceOperationId,
): Promise<Readonly<WakeflowMaintenanceExecutionIntentSource>> {
  const node = await resourceNodeOrNull(root, wakeflowMaintenanceIntentRef(operationId));
  if (node === null) fail("source", "$intent");
  return readIntentAtNode(root, operationId, node);
}

/** 读取可选intent；absent与unsafe source严格区分。 */
/**
 * 只读出意图文件里的写者戳（open-items B8）。一份本构建解析不了的意图（Schema、配置或计划代码在两版制品之间
 * 变了）仍然说得出是哪一版制品写的：恢复据此告诉用户"用那一版去恢复"，而不是只报一个没有出口的 `intent`。
 * 节点政策与大小上限同正常读取；文件不在、读不出、没有戳或戳不合文法都是 null。它不解析意图的其余部分，
 * 也不授权任何执行。
 */
export async function peekWakeflowMaintenanceIntentWriter(
  root: RootedDirectory,
  operationId: WakeflowMaintenanceOperationId,
): Promise<Readonly<WakeflowMaintenanceWriter> | null> {
  try {
    const resourcePath = wakeflowMaintenanceIntentRef(operationId);
    const node = await resourceNodeOrNull(root, resourcePath);
    if (
      node === null ||
      node.kind !== "file" ||
      node.permissionBits !== 0o600 ||
      node.linkCount !== 1n ||
      node.userId !== currentUserId()
    ) {
      return null;
    }
    const read = await readDeterministicJsonFile(root, resourcePath, {
      maximumBytes: WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_MAXIMUM_BYTES,
      expectedNode: node,
    });
    const value = read.value;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    return parseWakeflowMaintenanceWriter(
      (value as Readonly<Record<string, unknown>>).writer,
      "$intent.writer",
    );
  } catch {
    return null;
  }
}

export async function readWakeflowMaintenanceExecutionIntentOrNull(
  root: RootedDirectory,
  operationId: WakeflowMaintenanceOperationId,
): Promise<Readonly<WakeflowMaintenanceExecutionIntentSource> | null> {
  const node = await resourceNodeOrNull(root, wakeflowMaintenanceIntentRef(operationId));
  return node === null ? null : readIntentAtNode(root, operationId, node);
}

/** 在有效gate内absent-only发布并重读一份immutable intent。 */
export async function publishWakeflowMaintenanceExecutionIntent(
  root: RootedDirectory,
  context: Readonly<WakeflowMaintenanceGateContext>,
  intent: Readonly<WakeflowMaintenanceExecutionIntent>,
): Promise<Readonly<WakeflowMaintenanceExecutionIntentSource>> {
  try {
    assertWakeflowMaintenanceGateContext(context, root);
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceGateError) {
      fail("gate", "$context", error);
    }
    throw error;
  }
  // 意图是本编解码签发的类型化值（创建时已经构造即读回），不再复验；与门的操作标识的关系仍核对。
  const text = renderWakeflowMaintenanceExecutionIntent(intent);
  if (intent.operationId !== context.operationId) {
    fail("input", "$/operationId");
  }
  admitOperation(context.operationId, "exclusive-create");
  await assertWakeflowMaintenanceTransactionsEmpty(root);
  const bytes = encodeUtf8(text);
  admittedByteCount(bytes);
  const intendedDigest = computeWakeflowMaintenanceExecutionIntentDigest(intent);
  let publication: Readonly<DurableAtomicFileWriteResult<"created">>;
  try {
    publication = await createFileAtomically(
      root,
      wakeflowMaintenanceIntentRef(context.operationId),
      bytes,
      { mode: 0o600 },
    );
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) {
      if (error.reason === "target-exists") fail("conflict", "$intent", error);
      if (error.reason === "stage-recovery-required") {
        fail("recovery-required", "$intent", error);
      }
      if (error.commitUncertain) fail("commit-uncertain", "$intent", error);
      fail("effect-failure", "$intent", error);
    }
    throw error;
  }
  let source: Readonly<WakeflowMaintenanceExecutionIntentSource>;
  try {
    source = await readWakeflowMaintenanceExecutionIntent(root, context.operationId);
  } catch (cause: unknown) {
    fail("commit-uncertain", "$intent", cause);
  }
  if (
    publication.resourcePath !== source.resourcePath ||
    publication.digest !== source.digest ||
    publication.byteCount !== source.node.byteCount ||
    publication.node.deviceId !== source.node.deviceId ||
    publication.node.inodeId !== source.node.inodeId ||
    source.intentDigest !== intendedDigest
  ) {
    fail("commit-uncertain", "$intent");
  }
  return source;
}

/**
 * 做完一步之后把 `completedSteps` 加一：按读到时的节点与摘要精确替换，重读并核对意图摘要没有变。
 * 替换提交与否说不清时报 `commit-uncertain`，由恢复按磁盘上的计数接着做。
 */
export async function checkpointWakeflowMaintenanceExecutionIntent(
  root: RootedDirectory,
  context: Readonly<WakeflowMaintenanceGateContext>,
  source: Readonly<WakeflowMaintenanceExecutionIntentSource>,
): Promise<Readonly<WakeflowMaintenanceExecutionIntentSource>> {
  try {
    assertWakeflowMaintenanceGateContext(context, root);
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceGateError) {
      fail("gate", "$context", error);
    }
    throw error;
  }
  assertSource(source);
  if (source.operationId !== context.operationId) {
    fail("input", "$intentSource");
  }
  let advanced: Readonly<WakeflowMaintenanceExecutionIntent>;
  try {
    advanced = advanceWakeflowMaintenanceExecutionIntent(source.intent);
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceExecutionIntentError) {
      fail("input", "$intentSource", error);
    }
    throw error;
  }
  admitOperation(context.operationId, "exact-source-replace");
  await assertWakeflowMaintenanceIntentIsOnlyTransaction(root, source);
  const bytes = encodeUtf8(renderWakeflowMaintenanceExecutionIntent(advanced));
  admittedByteCount(bytes);
  let replacement: Readonly<DurableAtomicFileReplaceResult>;
  try {
    replacement = await replaceFileAtomically(root, source.resourcePath, bytes, {
      mode: 0o600,
      expected: Object.freeze({
        resourcePath: source.resourcePath,
        node: source.node,
        byteCount: source.node.byteCount,
        digest: source.digest,
      }),
    });
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) {
      if (
        error.reason === "expectation-changed" ||
        error.reason === "expectation-read-failure" ||
        error.reason === "target-exists"
      ) {
        fail("conflict", "$intent", error);
      }
      if (error.reason === "stage-recovery-required") {
        fail("recovery-required", "$intent", error);
      }
      if (error.commitUncertain) fail("commit-uncertain", "$intent", error);
      fail("effect-failure", "$intent", error);
    }
    throw error;
  }
  let next: Readonly<WakeflowMaintenanceExecutionIntentSource>;
  try {
    next = await readWakeflowMaintenanceExecutionIntent(root, context.operationId);
  } catch (cause: unknown) {
    fail("commit-uncertain", "$intent", cause);
  }
  if (
    replacement.digest !== next.digest ||
    replacement.byteCount !== next.node.byteCount ||
    replacement.node.deviceId !== next.node.deviceId ||
    replacement.node.inodeId !== next.node.inodeId ||
    next.intentDigest !== source.intentDigest ||
    next.intent.completedSteps !== advanced.completedSteps
  ) {
    fail("commit-uncertain", "$intent");
  }
  return next;
}

/** 全部步骤做完之后精确退休 intent；退休之后事务目录必须是空的。 */
export async function retireWakeflowMaintenanceExecutionIntent(
  root: RootedDirectory,
  context: Readonly<WakeflowMaintenanceGateContext>,
  source: Readonly<WakeflowMaintenanceExecutionIntentSource>,
): Promise<Readonly<WakeflowMaintenanceExecutionIntentRetirementReceipt>> {
  try {
    assertWakeflowMaintenanceGateContext(context, root);
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceGateError) {
      fail("gate", "$context", error);
    }
    throw error;
  }
  assertSource(source);
  if (source.operationId !== context.operationId) {
    fail("input", "$intentSource");
  }
  admitOperation(context.operationId, "exact-retire");
  await assertWakeflowMaintenanceIntentIsOnlyTransaction(root, source);
  let retirement: Readonly<ExactRegularFileUnlinkReceipt>;
  try {
    retirement = await unlinkRegularFileExactly(root, source.resourcePath, {
      expectedNode: source.node,
    });
  } catch (error: unknown) {
    if (error instanceof ExactRegularFileUnlinkError) {
      if (error.reason === "source-changed" || error.reason === "source-not-found") {
        fail("conflict", "$intent", error);
      }
      if (error.commitUncertain) fail("commit-uncertain", "$intent", error);
      fail("effect-failure", "$intent", error);
    }
    throw error;
  }
  try {
    await assertWakeflowMaintenanceTransactionsEmpty(root);
  } catch (cause: unknown) {
    fail("commit-uncertain", "$intent", cause);
  }
  return Object.freeze({
    disposition: "retired-intent",
    operationId: context.operationId,
    intentDigest: source.intentDigest,
    retirement,
  });
}
