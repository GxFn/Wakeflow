import { types } from "node:util";

import {
  computeWakeflowConfigDigest,
  type WakeflowConfigModel,
} from "../../configuration/wakeflow-config.js";
import {
  readWakeflowConfigAuthoritySnapshot,
  readWakeflowDetachedConfigRecord,
  type WakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
  type WakeflowDetachedConfigRecord,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { PassiveOwnDataError, parsePlainRecord } from "../../foundation/data/passive-own-data.js";
import {
  DurableAtomicFileStageRecoveryError,
  recoverDurableAtomicFileStagesForTargets,
} from "../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  inspectRootedExclusiveFileLock,
  RootedExclusiveFileLockError,
  retireRootedExclusiveFileLockResidue,
} from "../../foundation/filesystem/rooted-exclusive-file-lock.js";
import type { UuidV4Factory } from "../../foundation/identity/uuid-v4.js";
import { createWakeflowWorkspaceStaticResourceMatrix } from "../wakeflow-workspace-static-resource-matrix.js";
import {
  assertWakeflowHostMaintenanceCapability,
  assertWakeflowHostMaintenanceContributionCapability,
  type WakeflowHostMaintenanceCapability,
  WakeflowHostMaintenanceCapabilityError,
} from "./wakeflow-host-maintenance-capability.js";
import {
  createWakeflowMaintenanceExecutionIntent,
  reconstructWakeflowMaintenanceExecutionFromIntent,
  WakeflowMaintenanceExecutionIntentError,
} from "./wakeflow-maintenance-execution-intent.js";
import {
  assertWakeflowMaintenanceExecutionIntentCapacity,
  assertWakeflowMaintenanceIntentIsOnlyTransaction,
  checkpointWakeflowMaintenanceExecutionIntent,
  peekWakeflowMaintenanceIntentWriter,
  publishWakeflowMaintenanceExecutionIntent,
  readWakeflowMaintenanceExecutionIntent,
  readWakeflowMaintenanceExecutionIntentOrNull,
  retireWakeflowMaintenanceExecutionIntent,
  type WakeflowMaintenanceExecutionIntentSource,
  WakeflowMaintenanceExecutionIntentStoreError,
} from "./wakeflow-maintenance-execution-intent-store.js";
import {
  parseWakeflowMaintenanceExecutionPlan,
  type WakeflowMaintenanceExecutionPlan,
  type WakeflowMaintenanceExecutionStep,
} from "./wakeflow-maintenance-execution-plan.js";
import {
  previewWakeflowMaintenanceExecution,
  WakeflowMaintenanceExecutionPreviewError,
} from "./wakeflow-maintenance-execution-preview.js";
import {
  type WakeflowMaintenanceGateContext,
  WakeflowMaintenanceGateError,
  withExistingWakeflowMaintenanceGate,
  withWakeflowMaintenanceGate,
} from "./wakeflow-maintenance-gate.js";
import {
  createWakeflowMaintenanceOperationId,
  parseWakeflowMaintenanceOperationId,
  type WakeflowMaintenanceOperationId,
  WakeflowMaintenanceOperationIdError,
  wakeflowMaintenanceIntentRef,
  wakeflowMaintenanceOperationUuid,
} from "./wakeflow-maintenance-operation-id.js";
import { WAKEFLOW_MAINTENANCE_GATE_REF } from "./wakeflow-maintenance-resource-catalog.js";
import {
  parseWakeflowMaintenanceWriter,
  type WakeflowMaintenanceWriter,
  WakeflowMaintenanceWriterError,
} from "./wakeflow-maintenance-writer.js";
import {
  isWakeflowDetachAction,
  parseWakeflowStaticMaterializationPreviewRequest,
  type WakeflowStaticMaterializationPreviewRequest,
  wakeflowStaticMaterializationActionUsesCurrentConfig,
} from "./wakeflow-static-materialization-preview-contract.js";
import {
  executeWakeflowStaticMaterializationStep,
  WakeflowStaticMaterializationStepExecutionError,
} from "./wakeflow-static-materialization-step-executor.js";

/**
 * Wakeflow Workspace / Maintenance：唯一 maintenance execution transaction。
 *
 * Normal execution 在gate前及取得exact gate后各重推一次完整聚合计划；gate内只存在
 * 一份 intent，每做完一步把它的 `completedSteps` 加一。shared step 使用闭合 dispatcher，
 * host step 只能交给与计划身份一致的单个 capability。Recovery 消费 exact plan，不根据
 * 已受影响的宿主文件重建 source operation：从计数指着的那一步接着做，并把那一步当作"可能
 * 只做了一半"来重做（步骤自己接受这个标记）。
 *
 * 1.4 第 5 段 5a 的 C 行（ADR-0031）：此前"做到哪了"记在另一个文件（检查点日志）里，每一步之前
 * 先记"要动它"、之后再记"做完了"，并与意图按摘要和文件节点互相印证。现在只有一个文件、每步之后
 * 记一次；少掉的是"下一步还没开始、目标却已经变了"与"下一步做了一半"的区分。
 */

export interface WakeflowMaintenanceExecutionTransactionOptions {
  readonly acquireTimeoutMilliseconds?: number;
  readonly retryDelayMilliseconds?: number;
  readonly signal?: AbortSignal;
  readonly uuidFactory?: UuidV4Factory;
  /**
   * 写者戳：本进程制品身份的发布版本与 manifest 摘要，由组合根注入，盖在本次事务写出的
   * intent 上。省略或 `null` 即不盖戳（测试构建没有 manifest）。
   */
  readonly writer?: Readonly<WakeflowMaintenanceWriter> | null;
}

export interface WakeflowMaintenanceExecutionStepReceipt {
  readonly stepId: string;
  readonly boundary: WakeflowMaintenanceExecutionStep["boundary"];
  readonly disposition: "current" | "created" | "updated";
  readonly observationDigest: Sha256Digest;
}

interface WakeflowMaintenanceExecutionTransactionReceiptBase {
  readonly planDigest: WakeflowMaintenanceExecutionPlan["planDigest"];
  readonly stepReceipts: readonly Readonly<WakeflowMaintenanceExecutionStepReceipt>[];
}

export interface WakeflowMaintenanceExecutionNoOpReceipt
  extends WakeflowMaintenanceExecutionTransactionReceiptBase {
  readonly status: "no-op";
  readonly operationId: null;
  readonly stepReceipts: readonly [];
}

export interface WakeflowMaintenanceExecutionCompletedReceipt
  extends WakeflowMaintenanceExecutionTransactionReceiptBase {
  readonly status: "completed";
  readonly operationId: WakeflowMaintenanceOperationId;
}

export interface WakeflowMaintenanceExecutionRecoveredReceipt
  extends WakeflowMaintenanceExecutionTransactionReceiptBase {
  readonly status: "recovered";
  readonly operationId: WakeflowMaintenanceOperationId;
}

export type WakeflowMaintenanceExecutionTransactionReceipt =
  | WakeflowMaintenanceExecutionNoOpReceipt
  | WakeflowMaintenanceExecutionCompletedReceipt
  | WakeflowMaintenanceExecutionRecoveredReceipt;

export type WakeflowMaintenanceExecutionTransactionErrorReason =
  | "input"
  | "plan-blocked"
  | "plan-stale"
  | "source-config"
  | "capability"
  | "gate"
  | "intent"
  | "transaction"
  | "step"
  | "terminal-closure"
  | "aborted"
  | "recovery-required"
  | "artifact-mismatch";

const ERROR_MESSAGES = {
  input: "Wakeflow maintenance execution transaction input is invalid.",
  "plan-blocked": "Wakeflow maintenance execution plan is blocked.",
  "plan-stale": "Wakeflow maintenance execution plan is stale.",
  "source-config": "Wakeflow maintenance execution source Config is invalid.",
  capability: "Wakeflow maintenance execution host capability is invalid.",
  gate: "Wakeflow maintenance execution gate failed.",
  intent: "Wakeflow maintenance execution recovery intent failed.",
  transaction: "Wakeflow maintenance execution transaction resources have an invalid shape.",
  step: "Wakeflow maintenance execution step failed.",
  "terminal-closure": "Wakeflow maintenance execution terminal closure failed.",
  aborted: "Wakeflow maintenance execution was aborted.",
  "recovery-required": "Wakeflow maintenance execution requires recovery.",
  "artifact-mismatch":
    "Wakeflow maintenance execution was interrupted under another plugin build; recover it with that build.",
} as const satisfies Readonly<Record<WakeflowMaintenanceExecutionTransactionErrorReason, string>>;

/** 聚合 maintenance transaction 失败的稳定、脱敏错误。 */
export class WakeflowMaintenanceExecutionTransactionError extends Error {
  override readonly name = "WakeflowMaintenanceExecutionTransactionError";
  readonly code = "wakeflow-maintenance-execution-transaction" as const;
  readonly reason: WakeflowMaintenanceExecutionTransactionErrorReason;
  readonly path: string;
  readonly operationId: WakeflowMaintenanceOperationId | null;
  /** `artifact-mismatch` 时写下被中断事务的那一版制品；其余原因为 null。 */
  readonly writerVersion: string | null;

  constructor(
    reason: WakeflowMaintenanceExecutionTransactionErrorReason,
    path: string,
    operationId: WakeflowMaintenanceOperationId | null,
    writerVersion: string | null = null,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
    this.operationId = operationId;
    this.writerVersion = writerVersion;
  }
}

interface ParsedOptions {
  readonly acquireTimeoutMilliseconds: number | undefined;
  readonly retryDelayMilliseconds: number | undefined;
  readonly signal: AbortSignal | undefined;
  readonly uuidFactory: UuidV4Factory | undefined;
  readonly writer: Readonly<WakeflowMaintenanceWriter> | null;
}

function fail(
  reason: WakeflowMaintenanceExecutionTransactionErrorReason,
  path: string,
  operationId: WakeflowMaintenanceOperationId | null = null,
): never {
  throw new WakeflowMaintenanceExecutionTransactionError(reason, path, operationId);
}

/**
 * 被中断的事务是另一版制品写下的，而本构建读不了它的意图、或按它重算不出同一份计划（open-items B8）：
 * 说出那一版，让用户用它去恢复。写者戳相同（或两边都没有戳）时不是这种情况，照原来的原因失败。
 */
function failIfWrittenByAnotherArtifact(
  written: Readonly<WakeflowMaintenanceWriter> | null,
  running: Readonly<WakeflowMaintenanceWriter> | null,
  operationId: WakeflowMaintenanceOperationId,
): void {
  if (written === null || written.manifestDigest === running?.manifestDigest) return;
  throw new WakeflowMaintenanceExecutionTransactionError(
    "artifact-mismatch",
    "$intent",
    operationId,
    written.version,
  );
}

function assertNotAborted(
  signal: AbortSignal | undefined,
  operationId: WakeflowMaintenanceOperationId | null = null,
): void {
  if (signal?.aborted === true) fail("aborted", "$signal", operationId);
}

function admittedOperationId(value: unknown): WakeflowMaintenanceOperationId {
  try {
    return parseWakeflowMaintenanceOperationId(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceOperationIdError) {
      fail("input", "$operationId");
    }
    throw error;
  }
}

function createOperationId(factory: UuidV4Factory | undefined): WakeflowMaintenanceOperationId {
  try {
    return factory === undefined
      ? createWakeflowMaintenanceOperationId()
      : createWakeflowMaintenanceOperationId(factory);
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceOperationIdError) {
      fail("input", "$options.uuidFactory");
    }
    throw error;
  }
}

function effectiveSignal(
  requestSignal: AbortSignal | undefined,
  optionSignal: AbortSignal | undefined,
): AbortSignal | undefined {
  if (requestSignal !== undefined && optionSignal !== undefined && requestSignal !== optionSignal) {
    fail("input", "$options.signal");
  }
  return optionSignal ?? requestSignal;
}

function requestWithSignal(
  request: ReturnType<typeof parseWakeflowStaticMaterializationPreviewRequest>,
  signal: AbortSignal | undefined,
): Readonly<WakeflowStaticMaterializationPreviewRequest> {
  return Object.freeze({
    action: request.action,
    desiredConfig: request.desiredConfig,
    currentHostProfile: request.currentHostProfile,
    hostProfiles: request.hostProfiles,
    ...(signal === undefined ? {} : { signal }),
  });
}

function positiveMilliseconds(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > 300_000) {
    fail("input", path);
  }
  return value;
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
    Object.keys(record).some(
      (key) =>
        key !== "acquireTimeoutMilliseconds" &&
        key !== "retryDelayMilliseconds" &&
        key !== "signal" &&
        key !== "uuidFactory" &&
        key !== "writer",
    )
  ) {
    fail("input", "$options");
  }
  let writer: Readonly<WakeflowMaintenanceWriter> | null;
  try {
    writer = parseWakeflowMaintenanceWriter(record.writer, "$options.writer");
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceWriterError) fail("input", error.path);
    throw error;
  }
  if (
    record.signal !== undefined &&
    (typeof record.signal !== "object" ||
      record.signal === null ||
      types.isProxy(record.signal) ||
      !(record.signal instanceof AbortSignal))
  ) {
    fail("input", "$options.signal");
  }
  if (
    record.uuidFactory !== undefined &&
    (typeof record.uuidFactory !== "function" || types.isProxy(record.uuidFactory))
  ) {
    fail("input", "$options.uuidFactory");
  }
  return Object.freeze({
    acquireTimeoutMilliseconds: positiveMilliseconds(
      record.acquireTimeoutMilliseconds,
      "$options.acquireTimeoutMilliseconds",
    ),
    retryDelayMilliseconds: positiveMilliseconds(
      record.retryDelayMilliseconds,
      "$options.retryDelayMilliseconds",
    ),
    signal: record.signal as AbortSignal | undefined,
    uuidFactory: record.uuidFactory as UuidV4Factory | undefined,
    writer,
  });
}

async function currentConfigSnapshot(
  root: RootedDirectory,
  signal?: AbortSignal,
  operationId: WakeflowMaintenanceOperationId | null = null,
): Promise<Readonly<WakeflowConfigAuthoritySnapshot> | null> {
  try {
    return await readWakeflowConfigAuthoritySnapshot(
      root,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthoritySnapshotError && error.reason === "source") {
      return null;
    }
    if (error instanceof WakeflowConfigAuthoritySnapshotError) {
      if (error.reason === "aborted") {
        fail("aborted", "$signal", operationId);
      }
      fail("source-config", "$config", operationId);
    }
    throw error;
  }
}

function parseCapability(
  plan: Readonly<WakeflowMaintenanceExecutionPlan>,
  value: Readonly<WakeflowHostMaintenanceCapability> | undefined,
): Readonly<WakeflowHostMaintenanceCapability> | undefined {
  if (plan.hostContribution === null) {
    if (value !== undefined) fail("capability", "$capability");
    return undefined;
  }
  if (value === undefined) fail("capability", "$capability");
  try {
    assertWakeflowHostMaintenanceCapability(value, plan.hostId);
    assertWakeflowHostMaintenanceContributionCapability(value, plan.hostContribution);
  } catch (error: unknown) {
    if (error instanceof WakeflowHostMaintenanceCapabilityError) {
      fail("capability", error.path);
    }
    throw error;
  }
  return value;
}

function assertRequestMatchesPlan(
  plan: Readonly<WakeflowMaintenanceExecutionPlan>,
  request: ReturnType<typeof parseWakeflowStaticMaterializationPreviewRequest>,
): void {
  if (
    request.action !== plan.sharedPreview.action ||
    request.currentHostProfile.hostId !== plan.hostId ||
    createWakeflowWorkspaceStaticResourceMatrix(request.currentHostProfile).matrixDigest !==
      plan.sharedPreview.matrixDigest
  ) {
    fail("input", "$request");
  }
}

/** 退役配置记录（ADR-0024 终态）：不在为 null；读不出即源 Config 不可信。 */
async function detachedConfigRecord(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
  operationId: WakeflowMaintenanceOperationId | null,
): Promise<Readonly<WakeflowDetachedConfigRecord> | null> {
  try {
    return await readWakeflowDetachedConfigRecord(
      root,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthoritySnapshotError) {
      if (error.reason === "aborted") fail("aborted", "$signal", operationId);
      fail("source-config", "$detached", operationId);
    }
    throw error;
  }
}

/**
 * 终态核对：publish-config 之后配置文件带期望摘要；detach-workspace 的 retire-config 之后配置文件
 * 不在而退役文件带同一摘要（ADR-0024）。
 */
async function assertTerminalConfig(
  root: RootedDirectory,
  plan: Readonly<WakeflowMaintenanceExecutionPlan>,
  operationId: WakeflowMaintenanceOperationId,
): Promise<void> {
  const expected = plan.sharedPreview.desiredConfigDigest;
  if (expected === null) fail("terminal-closure", "$config", operationId);
  const current = await currentConfigSnapshot(root, undefined, operationId);
  if (plan.sharedPreview.action === "detach-workspace") {
    const retired = await detachedConfigRecord(root, undefined, operationId);
    if (current !== null || retired?.configDigest !== expected) {
      fail("terminal-closure", "$config", operationId);
    }
    return;
  }
  if (current?.configDigest !== expected) {
    fail("terminal-closure", "$config", operationId);
  }
}

/**
 * 宿主操作拿到的 Config：退出路径一律是当前 Config——要清理的就是它声明的托管面（ADR-0024）；
 * reconcile 也是当前 Config；fresh 与 reconfigure 是期望 Config。
 */
function hostConfigForExecution(
  request: ReturnType<typeof parseWakeflowStaticMaterializationPreviewRequest>,
  sourceConfig: WakeflowConfigModel | null,
  operationId: WakeflowMaintenanceOperationId,
): WakeflowConfigModel {
  const config =
    isWakeflowDetachAction(request.action) ||
    wakeflowStaticMaterializationActionUsesCurrentConfig(request.action)
      ? sourceConfig
      : request.desiredConfig;
  if (config === null) fail("source-config", "$config", operationId);
  return config;
}

function receipt(
  step: Readonly<WakeflowMaintenanceExecutionStep>,
  disposition: WakeflowMaintenanceExecutionStepReceipt["disposition"],
  observationDigest: Sha256Digest,
): Readonly<WakeflowMaintenanceExecutionStepReceipt> {
  return Object.freeze({
    stepId: step.stepId,
    boundary: step.boundary,
    disposition,
    observationDigest,
  });
}

async function executeStep(
  root: RootedDirectory,
  context: Readonly<WakeflowMaintenanceGateContext>,
  plan: Readonly<WakeflowMaintenanceExecutionPlan>,
  requestValue: WakeflowStaticMaterializationPreviewRequest,
  request: ReturnType<typeof parseWakeflowStaticMaterializationPreviewRequest>,
  sourceConfig: WakeflowConfigModel | null,
  capability: Readonly<WakeflowHostMaintenanceCapability> | undefined,
  stepId: string,
  recoveringAffectedOperation: boolean,
  signal: AbortSignal | undefined,
): Promise<Readonly<WakeflowMaintenanceExecutionStepReceipt>> {
  const step = plan.steps.find((entry) => entry.stepId === stepId);
  if (step === undefined) fail("step", `$step:${stepId}`, context.operationId);
  if (step.boundary === "shared-static") {
    try {
      const executed = await executeWakeflowStaticMaterializationStep(
        root,
        context,
        plan.sharedPreview,
        requestValue,
        stepId,
        {
          sourceConfig,
          recoveringAffectedStep: recoveringAffectedOperation,
          ...(signal === undefined ? {} : { signal }),
        },
      );
      return receipt(step, executed.disposition, executed.observationDigest);
    } catch (error: unknown) {
      if (error instanceof WakeflowStaticMaterializationStepExecutionError) {
        if (error.reason === "aborted") {
          fail("aborted", "$signal", context.operationId);
        }
        fail("step", `$step:${stepId}`, context.operationId);
      }
      throw error;
    }
  }
  if (capability === undefined) {
    fail("capability", "$capability", context.operationId);
  }
  const operation = plan.hostContribution?.operations.find(
    (entry) => entry.operationId === step.operationId,
  );
  if (
    operation === undefined ||
    operation.payloadDigest !== step.payloadDigest ||
    operation.targetDigest !== step.targetDigest
  ) {
    fail("step", `$step:${stepId}`, context.operationId);
  }
  try {
    const executed = await capability.executeOperation(root, context, {
      config: hostConfigForExecution(request, sourceConfig, context.operationId),
      profile: request.currentHostProfile,
      operation,
      recoveringAffectedOperation,
      ...(signal === undefined ? {} : { signal }),
    });
    if (
      executed.operationId !== operation.operationId ||
      executed.observationDigest !== operation.targetDigest
    ) {
      fail("step", `$step:${stepId}`, context.operationId);
    }
    return receipt(step, executed.disposition, executed.observationDigest);
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceExecutionTransactionError) {
      throw error;
    }
    assertNotAborted(signal, context.operationId);
    fail("step", `$step:${stepId}`, context.operationId);
  }
}

/**
 * 从意图的计数接着把步骤做完：做一步、记一次。`recovery` 时计数指着的那一步可能已经开始，按
 * "可能只做了一半"重做；其后的步骤照常。
 */
async function advanceIntent(
  root: RootedDirectory,
  context: Readonly<WakeflowMaintenanceGateContext>,
  sourceValue: Readonly<WakeflowMaintenanceExecutionIntentSource>,
  plan: Readonly<WakeflowMaintenanceExecutionPlan>,
  requestValue: WakeflowStaticMaterializationPreviewRequest,
  request: ReturnType<typeof parseWakeflowStaticMaterializationPreviewRequest>,
  sourceConfig: WakeflowConfigModel | null,
  capability: Readonly<WakeflowHostMaintenanceCapability> | undefined,
  recovery: boolean,
  signal: AbortSignal | undefined,
) {
  let source = sourceValue;
  const receipts: Readonly<WakeflowMaintenanceExecutionStepReceipt>[] = [];
  let replayingAffected = recovery;
  while (source.intent.completedSteps < plan.steps.length) {
    assertNotAborted(signal, context.operationId);
    const stepId = plan.steps[source.intent.completedSteps]?.stepId;
    if (stepId === undefined) fail("intent", "$intent", context.operationId);
    receipts.push(
      await executeStep(
        root,
        context,
        plan,
        requestValue,
        request,
        sourceConfig,
        capability,
        stepId,
        replayingAffected,
        signal,
      ),
    );
    source = await checkpointWakeflowMaintenanceExecutionIntent(root, context, source);
    replayingAffected = false;
  }
  // 最后一步记下之后、收尾之前仍然认一次取消：与此前在"记为终态"之前认取消的位置相同，留下的是
  // 一份全部做完的 intent，由恢复退役。
  assertNotAborted(signal, context.operationId);
  return Object.freeze({
    terminalSource: source,
    receipts: Object.freeze(receipts),
  });
}

async function retireInactiveCorrelatedGate(
  root: RootedDirectory,
  operationId: WakeflowMaintenanceOperationId,
): Promise<void> {
  let gate: Awaited<ReturnType<typeof inspectRootedExclusiveFileLock>>;
  try {
    gate = await inspectRootedExclusiveFileLock(root, WAKEFLOW_MAINTENANCE_GATE_REF);
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) {
      fail("gate", "$gate", operationId);
    }
    throw error;
  }
  if (gate.status === "absent") return;
  if (gate.ownerState !== "inactive") fail("gate", "$gate", operationId);
  if (!gate.record.token.endsWith(`-${wakeflowMaintenanceOperationUuid(operationId)}`)) {
    fail("gate", "$operationId", operationId);
  }
  try {
    await retireRootedExclusiveFileLockResidue(root, WAKEFLOW_MAINTENANCE_GATE_REF, gate);
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) {
      fail("recovery-required", "$gate", operationId);
    }
    throw error;
  }
}

function gateOptions(
  options: Readonly<ParsedOptions>,
  signal: AbortSignal | undefined = options.signal,
) {
  return {
    ...(options.acquireTimeoutMilliseconds === undefined
      ? {}
      : { acquireTimeoutMilliseconds: options.acquireTimeoutMilliseconds }),
    ...(options.retryDelayMilliseconds === undefined
      ? {}
      : { retryDelayMilliseconds: options.retryDelayMilliseconds }),
    ...(signal === undefined ? {} : { signal }),
  };
}

function mapGateError(
  error: WakeflowMaintenanceGateError,
  operationId: WakeflowMaintenanceOperationId,
  persistentTransaction: boolean = false,
): never {
  const exposedOperationId = persistentTransaction ? operationId : null;
  if (error.reason === "aborted") {
    fail("aborted", "$signal", exposedOperationId);
  }
  if (error.reason === "stale-preview") {
    fail("plan-stale", "$plan", null);
  }
  if (error.reason === "recovery-required") {
    fail("recovery-required", "$gate", operationId);
  }
  fail("gate", "$gate", exposedOperationId);
}

function intentStoreFailureReason(
  error: WakeflowMaintenanceExecutionIntentStoreError,
): "intent" | "recovery-required" | "transaction" {
  if (error.reason === "transactions-shape") return "transaction";
  return error.reason === "commit-uncertain" || error.reason === "recovery-required"
    ? "recovery-required"
    : "intent";
}

/** 执行一份重新验证后的聚合维护计划；尚不暴露为公共 maintenance apply。 */
export async function executeWakeflowMaintenanceExecutionTransaction(
  root: RootedDirectory,
  planValue: unknown,
  requestValue: WakeflowStaticMaterializationPreviewRequest,
  capabilityValue?: Readonly<WakeflowHostMaintenanceCapability>,
  optionsValue: WakeflowMaintenanceExecutionTransactionOptions = {},
): Promise<Readonly<WakeflowMaintenanceExecutionTransactionReceipt>> {
  const options = parseOptions(optionsValue);
  const plan = parseWakeflowMaintenanceExecutionPlan(planValue);
  const request = parseWakeflowStaticMaterializationPreviewRequest(requestValue);
  const signal = effectiveSignal(request.signal, options.signal);
  assertNotAborted(signal);
  const executionRequestValue = requestWithSignal(request, signal);
  assertRequestMatchesPlan(plan, request);
  if (plan.status !== "ready") fail("plan-blocked", "$plan");
  const capability = parseCapability(plan, capabilityValue);
  let rederived: Awaited<ReturnType<typeof previewWakeflowMaintenanceExecution>>;
  try {
    rederived = await previewWakeflowMaintenanceExecution(root, executionRequestValue, capability);
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceExecutionPreviewError) {
      if (error.reason === "aborted") fail("aborted", "$signal", null);
      fail("plan-stale", "$plan", null);
    }
    throw error;
  }
  if (rederived.planDigest !== plan.planDigest) {
    fail("plan-stale", "$plan.planDigest");
  }
  if (plan.steps.length === 0) {
    return Object.freeze({
      status: "no-op",
      operationId: null,
      planDigest: plan.planDigest,
      stepReceipts: [] as const,
    });
  }
  const current = await currentConfigSnapshot(root, signal);
  const desiredConfig = wakeflowStaticMaterializationActionUsesCurrentConfig(request.action)
    ? (current?.model ?? null)
    : request.desiredConfig;
  if (
    desiredConfig === null ||
    computeWakeflowConfigDigest(desiredConfig) !== plan.sharedPreview.desiredConfigDigest
  ) {
    fail("source-config", "$config");
  }
  const operationId = createOperationId(options.uuidFactory);
  let intent: ReturnType<typeof createWakeflowMaintenanceExecutionIntent>;
  try {
    intent = createWakeflowMaintenanceExecutionIntent(
      operationId,
      plan,
      executionRequestValue,
      desiredConfig,
      options.writer,
    );
    assertWakeflowMaintenanceExecutionIntentCapacity(intent);
  } catch (error: unknown) {
    if (
      error instanceof WakeflowMaintenanceExecutionIntentError ||
      error instanceof WakeflowMaintenanceExecutionIntentStoreError
    ) {
      fail("intent", "$intent", null);
    }
    throw error;
  }
  const reconstructed = reconstructWakeflowMaintenanceExecutionFromIntent(intent);
  const intentPlan = reconstructed.plan;
  const intentRequest = parseWakeflowStaticMaterializationPreviewRequest(reconstructed.request);
  const intentRequestValue = requestWithSignal(intentRequest, signal);
  try {
    return await withWakeflowMaintenanceGate(
      root,
      {
        expectedCoreLayoutInspectionDigest: plan.sharedPreview.coreLayoutInspectionDigest,
        operationId,
        bootstrap: request.action === "fresh-initialize" ? "fresh" : "repair",
        ...gateOptions(options, signal),
      },
      async (context) => {
        let lockedPlan: Awaited<ReturnType<typeof previewWakeflowMaintenanceExecution>>;
        try {
          lockedPlan = await previewWakeflowMaintenanceExecution(
            root,
            executionRequestValue,
            capability,
            context,
          );
        } catch (error: unknown) {
          if (error instanceof WakeflowMaintenanceExecutionPreviewError) {
            if (error.reason === "aborted") fail("aborted", "$signal", null);
            fail("plan-stale", "$plan", null);
          }
          throw error;
        }
        if (lockedPlan.planDigest !== plan.planDigest) {
          fail("plan-stale", "$plan.planDigest", null);
        }
        const intentSource = await publishWakeflowMaintenanceExecutionIntent(root, context, intent);
        const advanced = await advanceIntent(
          root,
          context,
          intentSource,
          intentPlan,
          intentRequestValue,
          intentRequest,
          current?.model ?? null,
          capability,
          false,
          signal,
        );
        await assertTerminalConfig(root, intentPlan, operationId);
        await retireWakeflowMaintenanceExecutionIntent(root, context, advanced.terminalSource);
        return Object.freeze({
          status: "completed" as const,
          operationId,
          planDigest: intentPlan.planDigest,
          stepReceipts: advanced.receipts,
        });
      },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceExecutionTransactionError) throw error;
    if (error instanceof WakeflowMaintenanceGateError) {
      mapGateError(error, operationId);
    }
    if (error instanceof WakeflowMaintenanceExecutionIntentStoreError) {
      const reason = intentStoreFailureReason(error);
      fail(reason, reason === "transaction" ? "$transactions" : "$intent", operationId);
    }
    throw error;
  }
}

/**
 * detach-workspace 的恢复源 Config（ADR-0024）：配置文件还在即它（退役步必未做完）；配置文件不在则
 * 退役文件必须带同一摘要，并且退役步已经做完或正是计数指着的那一步，源 Config 就是退役文件里的那份。
 */
function detachRecoveryConfigState(
  plan: Readonly<WakeflowMaintenanceExecutionPlan>,
  completedSteps: number,
  current: Readonly<WakeflowConfigAuthoritySnapshot> | null,
  retired: Readonly<WakeflowDetachedConfigRecord> | null,
  operationId: WakeflowMaintenanceOperationId,
): WakeflowConfigModel {
  const expected = plan.sharedPreview.currentConfigDigest;
  if (expected === null) fail("source-config", "$config", operationId);
  const retireIndex = plan.steps.findIndex(
    (entry) => entry.boundary === "shared-static" && entry.stepKind === "retire-config",
  );
  if (current !== null) {
    if (current.configDigest !== expected || (retireIndex >= 0 && completedSteps > retireIndex)) {
      fail("source-config", "$config", operationId);
    }
    return current.model;
  }
  if (
    retired === null ||
    retired.configDigest !== expected ||
    (retireIndex >= 0 && completedSteps < retireIndex)
  ) {
    fail("source-config", "$config", operationId);
  }
  return retired.model;
}

/**
 * 恢复时磁盘上的 Config 必须与计数说得通：发布配置的那一步还没轮到，配置就不该已经是新的；那一步
 * 已经记为做完，配置就不该还是旧的。计数正指着那一步时两种都可能——它可能只做了一半。
 */
function assertRecoveryConfigState(
  plan: Readonly<WakeflowMaintenanceExecutionPlan>,
  completedSteps: number,
  current: Readonly<WakeflowConfigAuthoritySnapshot> | null,
  retired: Readonly<WakeflowDetachedConfigRecord> | null,
  operationId: WakeflowMaintenanceOperationId,
): WakeflowConfigModel | null {
  if (plan.sharedPreview.action === "detach-workspace") {
    return detachRecoveryConfigState(plan, completedSteps, current, retired, operationId);
  }
  const configIndex = plan.steps.findIndex(
    (entry) => entry.boundary === "shared-static" && entry.stepKind === "publish-config",
  );
  const currentDigest = current?.configDigest ?? null;
  if (
    configIndex >= 0 &&
    currentDigest === plan.sharedPreview.desiredConfigDigest &&
    completedSteps < configIndex
  ) {
    fail("source-config", "$config", operationId);
  }
  if (
    configIndex >= 0 &&
    currentDigest === plan.sharedPreview.currentConfigDigest &&
    completedSteps > configIndex
  ) {
    fail("source-config", "$config", operationId);
  }
  if (plan.sharedPreview.currentConfigDigest === null) {
    if (current !== null && current.configDigest !== plan.sharedPreview.desiredConfigDigest) {
      fail("source-config", "$config", operationId);
    }
    return null;
  }
  if (
    current !== null &&
    (current.configDigest === plan.sharedPreview.currentConfigDigest ||
      current.configDigest === plan.sharedPreview.desiredConfigDigest)
  ) {
    return current.model;
  }
  fail("source-config", "$config", operationId);
}

/** 回收这次操作的 intent 自己留下的、写者已经不在的原子写暂存；属主还活着或说不清的不动，恢复不往下走。 */
async function recoverOperationStages(
  root: RootedDirectory,
  operationId: WakeflowMaintenanceOperationId,
): Promise<void> {
  try {
    const receipt = await recoverDurableAtomicFileStagesForTargets(
      root,
      Object.freeze([wakeflowMaintenanceIntentRef(operationId)]),
    );
    if (receipt.activeStageCount === 0 && receipt.unknownStageCount === 0) return;
  } catch (error: unknown) {
    if (!(error instanceof DurableAtomicFileStageRecoveryError)) throw error;
  }
  fail("recovery-required", "$transactions", operationId);
}

/**
 * 只凭operation ID、磁盘intent和固定宿主capability恢复同一事务。
 */
export async function recoverWakeflowMaintenanceExecutionTransaction(
  root: RootedDirectory,
  operationIdValue: unknown,
  capabilityValue?: Readonly<WakeflowHostMaintenanceCapability>,
  optionsValue: Omit<WakeflowMaintenanceExecutionTransactionOptions, "uuidFactory"> = {},
): Promise<Readonly<WakeflowMaintenanceExecutionTransactionReceipt>> {
  const options = parseOptions(optionsValue);
  if (options.uuidFactory !== undefined) fail("input", "$options.uuidFactory");
  const operationId = admittedOperationId(operationIdValue);
  assertNotAborted(options.signal, operationId);
  try {
    await recoverOperationStages(root, operationId);
    assertNotAborted(options.signal, operationId);
    const intentSource = await readWakeflowMaintenanceExecutionIntentOrNull(root, operationId);
    if (intentSource === null) fail("intent", "$intent", operationId);
    let reconstructed: ReturnType<typeof reconstructWakeflowMaintenanceExecutionFromIntent>;
    try {
      reconstructed = reconstructWakeflowMaintenanceExecutionFromIntent(intentSource.intent);
    } catch (error: unknown) {
      if (!(error instanceof WakeflowMaintenanceExecutionIntentError)) throw error;
      // 意图读得进来，但本构建按它重算不出同一份计划：另一版制品写的就说出来，否则是意图本身坏了。
      failIfWrittenByAnotherArtifact(
        intentSource.intent.writer ?? null,
        options.writer,
        operationId,
      );
      fail("intent", "$intent", operationId);
    }
    const plan = reconstructed.plan;
    const requestValue = reconstructed.request;
    const request = parseWakeflowStaticMaterializationPreviewRequest(requestValue);
    assertRequestMatchesPlan(plan, request);
    const capability = parseCapability(plan, capabilityValue);
    await assertWakeflowMaintenanceIntentIsOnlyTransaction(root, intentSource);
    const current = await currentConfigSnapshot(root, options.signal, operationId);
    const retired =
      plan.sharedPreview.action === "detach-workspace"
        ? await detachedConfigRecord(root, options.signal, operationId)
        : null;
    const sourceConfig = assertRecoveryConfigState(
      plan,
      reconstructed.completedSteps,
      current,
      retired,
      operationId,
    );
    await retireInactiveCorrelatedGate(root, operationId);
    return await withExistingWakeflowMaintenanceGate(
      root,
      operationId,
      async (context) => {
        const currentIntent = await readWakeflowMaintenanceExecutionIntent(root, operationId);
        if (
          currentIntent.intentDigest !== intentSource.intentDigest ||
          currentIntent.digest !== intentSource.digest ||
          currentIntent.node.deviceId !== intentSource.node.deviceId ||
          currentIntent.node.inodeId !== intentSource.node.inodeId
        ) {
          fail("intent", "$intent", operationId);
        }
        const advanced = await advanceIntent(
          root,
          context,
          currentIntent,
          plan,
          requestValue,
          request,
          sourceConfig,
          capability,
          true,
          options.signal,
        );
        await assertTerminalConfig(root, plan, operationId);
        await retireWakeflowMaintenanceExecutionIntent(root, context, advanced.terminalSource);
        return Object.freeze({
          status: "recovered" as const,
          operationId,
          planDigest: plan.planDigest,
          stepReceipts: advanced.receipts,
        });
      },
      gateOptions(options),
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceExecutionTransactionError) throw error;
    if (error instanceof WakeflowMaintenanceGateError) {
      mapGateError(error, operationId, true);
    }
    if (error instanceof WakeflowMaintenanceExecutionIntentStoreError) {
      const reason = intentStoreFailureReason(error);
      if (reason === "intent") {
        // 本构建解析不了这份意图：先看它是不是另一版制品写的。
        failIfWrittenByAnotherArtifact(
          await peekWakeflowMaintenanceIntentWriter(root, operationId),
          options.writer,
          operationId,
        );
      }
      fail(reason, reason === "transaction" ? "$transactions" : "$intent", operationId);
    }
    throw error;
  }
}
