import { types } from "node:util";

import {
  computeWakeflowConfigV3Digest,
  type WakeflowConfigV3Model,
} from "../../configuration/wakeflow-config-v3.js";
import {
  readWakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
  type WakeflowConfigAuthoritySnapshot,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  inspectRootedExclusiveFileLock,
  retireRootedExclusiveFileLockResidue,
  RootedExclusiveFileLockError,
} from "../../foundation/filesystem/rooted-exclusive-file-lock.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import type { UuidV4Factory } from "../../foundation/identity/uuid-v4.js";
import {
  withExistingWakeflowMaintenanceGate,
  withWakeflowMaintenanceGate,
  WakeflowMaintenanceGateError,
  type WakeflowMaintenanceGateContext,
} from "./wakeflow-maintenance-gate.js";
import {
  assertWakeflowHostMaintenanceCapability,
  assertWakeflowHostMaintenanceContributionCapability,
  WakeflowHostMaintenanceCapabilityError,
  type WakeflowHostMaintenanceCapability,
} from "./wakeflow-host-maintenance-capability.js";
import {
  beginWakeflowMaintenanceJournalStep,
  completeWakeflowMaintenanceJournalStep,
  terminalizeWakeflowMaintenanceJournal,
} from "./wakeflow-maintenance-journal.js";
import {
  assertWakeflowMaintenanceJournalIsOnlyTransaction,
  assertWakeflowPreparedMaintenanceJournalCapacity,
  checkpointWakeflowMaintenanceJournal,
  publishPreparedWakeflowMaintenanceJournal,
  readWakeflowMaintenanceJournal,
  readWakeflowMaintenanceJournalOrNull,
  recoverWakeflowMaintenanceJournalStages,
  retireTerminalWakeflowMaintenanceJournal,
  WakeflowMaintenanceJournalStoreError,
  type WakeflowMaintenanceJournalSource,
} from "./wakeflow-maintenance-journal-store.js";
import {
  computeWakeflowMaintenanceExecutionIntentDigest,
  createWakeflowMaintenanceExecutionIntent,
  reconstructWakeflowMaintenanceExecutionFromIntent,
  WakeflowMaintenanceExecutionIntentError,
} from "./wakeflow-maintenance-execution-intent.js";
import {
  assertWakeflowMaintenanceExecutionIntentCapacity,
  assertWakeflowMaintenanceIntentAndJournalAreOnlyTransaction,
  assertWakeflowMaintenanceIntentIsOnlyTransactionPrefix,
  publishWakeflowMaintenanceExecutionIntent,
  readWakeflowMaintenanceExecutionIntent,
  readWakeflowMaintenanceExecutionIntentOrNull,
  recoverWakeflowMaintenanceExecutionIntentStages,
  retireWakeflowMaintenanceExecutionIntent,
  WakeflowMaintenanceExecutionIntentStoreError,
  type WakeflowMaintenanceExecutionIntentSource,
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
  createWakeflowMaintenanceOperationId,
  parseWakeflowMaintenanceOperationId,
  WakeflowMaintenanceOperationIdError,
  wakeflowMaintenanceOperationUuid,
  type WakeflowMaintenanceOperationId,
} from "./wakeflow-maintenance-operation-id.js";
import { WAKEFLOW_MAINTENANCE_GATE_REF } from "./wakeflow-maintenance-resource-catalog.js";
import {
  executeWakeflowStaticMaterializationStep,
  WakeflowStaticMaterializationStepExecutionError,
} from "./wakeflow-static-materialization-step-executor.js";
import {
  parseWakeflowStaticMaterializationPreviewRequest,
  type WakeflowStaticMaterializationPreviewRequest,
} from "./wakeflow-static-materialization-preview-contract.js";
import {
  createWakeflowWorkspaceStaticResourceMatrix,
} from "../wakeflow-workspace-static-resource-matrix.js";

/**
 * Wakeflow Workspace / Maintenance：唯一 maintenance execution transaction。
 *
 * Normal execution 在gate前及取得exact gate后各重推一次完整聚合计划；gate内只存在
 * 一份 journal，并以 affected → exact owner effect → checkpoint 单调推进。shared step
 * 使用闭合 dispatcher，
 * host step 只能交给与计划身份一致的单个 capability。Recovery 消费 exact plan，不根据
 * 已受影响的宿主文件重建 source operation。
 */

export interface WakeflowMaintenanceExecutionTransactionOptions {
  readonly acquireTimeoutMilliseconds?: number;
  readonly retryDelayMilliseconds?: number;
  readonly signal?: AbortSignal;
  readonly uuidFactory?: UuidV4Factory;
}

export interface WakeflowMaintenanceExecutionStepReceipt {
  readonly stepId: string;
  readonly boundary: WakeflowMaintenanceExecutionStep["boundary"];
  readonly disposition: "current" | "created" | "updated";
  readonly observationDigest: Sha256Digest;
}

interface WakeflowMaintenanceExecutionTransactionReceiptBase {
  readonly planDigest: WakeflowMaintenanceExecutionPlan["planDigest"];
  readonly stepReceipts:
    readonly Readonly<WakeflowMaintenanceExecutionStepReceipt>[];
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
  | "journal"
  | "step"
  | "terminal-closure"
  | "aborted"
  | "recovery-required";

const ERROR_MESSAGES = {
  input: "Wakeflow maintenance execution transaction input is invalid.",
  "plan-blocked": "Wakeflow maintenance execution plan is blocked.",
  "plan-stale": "Wakeflow maintenance execution plan is stale.",
  "source-config": "Wakeflow maintenance execution source Config is invalid.",
  capability: "Wakeflow maintenance execution host capability is invalid.",
  gate: "Wakeflow maintenance execution gate failed.",
  intent: "Wakeflow maintenance execution recovery intent failed.",
  transaction: "Wakeflow maintenance execution transaction resources have an invalid shape.",
  journal: "Wakeflow maintenance execution journal failed.",
  step: "Wakeflow maintenance execution step failed.",
  "terminal-closure": "Wakeflow maintenance execution terminal closure failed.",
  aborted: "Wakeflow maintenance execution was aborted.",
  "recovery-required": "Wakeflow maintenance execution requires recovery.",
} as const satisfies Readonly<Record<
  WakeflowMaintenanceExecutionTransactionErrorReason,
  string
>>;

/** 聚合 maintenance transaction 失败的稳定、脱敏错误。 */
export class WakeflowMaintenanceExecutionTransactionError extends Error {
  override readonly name = "WakeflowMaintenanceExecutionTransactionError";
  readonly code = "wakeflow-maintenance-execution-transaction" as const;
  readonly reason: WakeflowMaintenanceExecutionTransactionErrorReason;
  readonly path: string;
  readonly operationId: WakeflowMaintenanceOperationId | null;

  constructor(
    reason: WakeflowMaintenanceExecutionTransactionErrorReason,
    path: string,
    operationId: WakeflowMaintenanceOperationId | null,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
    this.operationId = operationId;
  }
}

interface ParsedOptions {
  readonly acquireTimeoutMilliseconds: number | undefined;
  readonly retryDelayMilliseconds: number | undefined;
  readonly signal: AbortSignal | undefined;
  readonly uuidFactory: UuidV4Factory | undefined;
}

function fail(
  reason: WakeflowMaintenanceExecutionTransactionErrorReason,
  path: string,
  operationId: WakeflowMaintenanceOperationId | null = null,
): never {
  throw new WakeflowMaintenanceExecutionTransactionError(
    reason,
    path,
    operationId,
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

function createOperationId(
  factory: UuidV4Factory | undefined,
): WakeflowMaintenanceOperationId {
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
  if (
    requestSignal !== undefined
    && optionSignal !== undefined
    && requestSignal !== optionSignal
  ) {
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
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value <= 0
    || value > 300_000
  ) {
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
  if (Object.keys(record).some((key) => (
    key !== "acquireTimeoutMilliseconds"
    && key !== "retryDelayMilliseconds"
    && key !== "signal"
    && key !== "uuidFactory"
  ))) {
    fail("input", "$options");
  }
  if (
    record.signal !== undefined
    && (
      typeof record.signal !== "object"
      || record.signal === null
      || types.isProxy(record.signal)
      || !(record.signal instanceof AbortSignal)
    )
  ) {
    fail("input", "$options.signal");
  }
  if (
    record.uuidFactory !== undefined
    && (
      typeof record.uuidFactory !== "function"
      || types.isProxy(record.uuidFactory)
    )
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
    if (
      error instanceof WakeflowConfigAuthoritySnapshotError
      && error.reason === "source"
    ) {
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
    assertWakeflowHostMaintenanceContributionCapability(
      value,
      plan.hostContribution,
    );
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
    request.action !== plan.sharedPreview.action
    || request.currentHostProfile.hostId !== plan.hostId
    || createWakeflowWorkspaceStaticResourceMatrix(
      request.currentHostProfile,
    ).matrixDigest !== plan.sharedPreview.matrixDigest
  ) {
    fail("input", "$request");
  }
}

function validateJournalPlan(
  source: Readonly<WakeflowMaintenanceJournalSource>,
  intentSource: Readonly<WakeflowMaintenanceExecutionIntentSource>,
  plan: Readonly<WakeflowMaintenanceExecutionPlan>,
): void {
  const preview = plan.sharedPreview;
  if (
    source.journal.intentDigest !== intentSource.intentDigest
    || source.journal.planDigest !== plan.planDigest
    || source.journal.action !== preview.action
    || source.journal.matrixDigest !== preview.matrixDigest
    || source.journal.currentConfigDigest !== preview.currentConfigDigest
    || source.journal.desiredConfigDigest !== preview.desiredConfigDigest
    || source.journal.stepIds.length !== plan.steps.length
    || source.journal.stepIds.some((stepId, index) => (
      stepId !== plan.steps[index]?.stepId
    ))
  ) {
    fail("journal", "$journal", source.operationId);
  }
}

async function assertTerminalConfig(
  root: RootedDirectory,
  plan: Readonly<WakeflowMaintenanceExecutionPlan>,
  operationId: WakeflowMaintenanceOperationId,
): Promise<void> {
  const current = await currentConfigSnapshot(root, undefined, operationId);
  if (
    plan.sharedPreview.desiredConfigDigest === null
    || current?.configDigest !== plan.sharedPreview.desiredConfigDigest
  ) {
    fail("terminal-closure", "$config", operationId);
  }
}

function desiredConfigForExecution(
  request: ReturnType<typeof parseWakeflowStaticMaterializationPreviewRequest>,
  sourceConfig: WakeflowConfigV3Model | null,
): WakeflowConfigV3Model {
  const config = request.action === "reconcile"
    ? sourceConfig
    : request.desiredConfig;
  if (config === null) fail("source-config", "$config");
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
  sourceConfig: WakeflowConfigV3Model | null,
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
      return receipt(
        step,
        executed.disposition,
        executed.observationDigest,
      );
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
  const operation = plan.hostContribution?.operations.find((entry) => (
    entry.operationId === step.operationId
  ));
  if (
    operation === undefined
    || operation.payloadDigest !== step.payloadDigest
    || operation.targetDigest !== step.targetDigest
  ) {
    fail("step", `$step:${stepId}`, context.operationId);
  }
  try {
    const executed = await capability.executeOperation(root, context, {
      config: desiredConfigForExecution(request, sourceConfig),
      profile: request.currentHostProfile,
      operation,
      recoveringAffectedOperation,
      ...(signal === undefined ? {} : { signal }),
    });
    if (
      executed.operationId !== operation.operationId
      || executed.observationDigest !== operation.targetDigest
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

async function advanceJournal(
  root: RootedDirectory,
  context: Readonly<WakeflowMaintenanceGateContext>,
  intentSource: Readonly<WakeflowMaintenanceExecutionIntentSource>,
  sourceValue: Readonly<WakeflowMaintenanceJournalSource>,
  plan: Readonly<WakeflowMaintenanceExecutionPlan>,
  requestValue: WakeflowStaticMaterializationPreviewRequest,
  request: ReturnType<typeof parseWakeflowStaticMaterializationPreviewRequest>,
  sourceConfig: WakeflowConfigV3Model | null,
  capability: Readonly<WakeflowHostMaintenanceCapability> | undefined,
  recovery: boolean,
  signal: AbortSignal | undefined,
) {
  let source = sourceValue;
  const receipts: Readonly<WakeflowMaintenanceExecutionStepReceipt>[] = [];
  let replayingAffected = recovery && source.journal.affectedStepId !== null;
  while (source.journal.state !== "terminal") {
    assertNotAborted(signal, context.operationId);
    if (source.journal.affectedStepId === null) {
      if (source.journal.checkpoint === source.journal.stepIds.length) {
        source = await checkpointWakeflowMaintenanceJournal(
          root,
          context,
          intentSource,
          source,
          terminalizeWakeflowMaintenanceJournal(source.journal),
        );
        continue;
      }
      source = await checkpointWakeflowMaintenanceJournal(
        root,
        context,
        intentSource,
        source,
        beginWakeflowMaintenanceJournalStep(source.journal),
      );
      replayingAffected = false;
    }
    const stepId = source.journal.affectedStepId;
    if (stepId === null) fail("journal", "$journal", context.operationId);
    receipts.push(await executeStep(
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
    ));
    source = await checkpointWakeflowMaintenanceJournal(
      root,
      context,
      intentSource,
      source,
      completeWakeflowMaintenanceJournalStep(source.journal),
    );
    replayingAffected = false;
  }
  return Object.freeze({
    terminalSource: source,
    receipts: Object.freeze(receipts),
  });
}

async function retireInactiveCorrelatedGate(
  root: RootedDirectory,
  operationId: WakeflowMaintenanceOperationId,
): Promise<void> {
  let gate;
  try {
    gate = await inspectRootedExclusiveFileLock(
      root,
      WAKEFLOW_MAINTENANCE_GATE_REF,
    );
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
    await retireRootedExclusiveFileLockResidue(
      root,
      WAKEFLOW_MAINTENANCE_GATE_REF,
      gate,
    );
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
  return error.reason === "commit-uncertain"
    || error.reason === "recovery-required"
    ? "recovery-required"
    : "intent";
}

function journalStoreFailureReason(
  error: WakeflowMaintenanceJournalStoreError,
): "journal" | "recovery-required" | "transaction" {
  if (error.reason === "transactions-shape") return "transaction";
  return error.reason === "commit-uncertain"
    || error.reason === "recovery-required"
    ? "recovery-required"
    : "journal";
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
  let rederived: Awaited<ReturnType<
    typeof previewWakeflowMaintenanceExecution
  >>;
  try {
    rederived = await previewWakeflowMaintenanceExecution(
      root,
      executionRequestValue,
      capability,
    );
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
  const desiredConfig = request.action === "reconcile"
    ? current?.model ?? null
    : request.desiredConfig;
  if (
    desiredConfig === null
    || computeWakeflowConfigV3Digest(desiredConfig)
      !== plan.sharedPreview.desiredConfigDigest
  ) {
    fail("source-config", "$config");
  }
  const operationId = createOperationId(options.uuidFactory);
  let intent;
  try {
    intent = createWakeflowMaintenanceExecutionIntent(
      operationId,
      plan,
      executionRequestValue,
      desiredConfig,
    );
    assertWakeflowMaintenanceExecutionIntentCapacity(intent);
    assertWakeflowPreparedMaintenanceJournalCapacity(
      operationId,
      computeWakeflowMaintenanceExecutionIntentDigest(intent),
      plan,
    );
  } catch (error: unknown) {
    if (
      error instanceof WakeflowMaintenanceExecutionIntentError
      || error instanceof WakeflowMaintenanceExecutionIntentStoreError
    ) {
      fail("intent", "$intent", null);
    }
    if (error instanceof WakeflowMaintenanceJournalStoreError) {
      fail("journal", "$journal", null);
    }
    throw error;
  }
  const reconstructed = reconstructWakeflowMaintenanceExecutionFromIntent(
    intent,
  );
  const intentPlan = reconstructed.plan;
  const intentRequest = parseWakeflowStaticMaterializationPreviewRequest(
    reconstructed.request,
  );
  const intentRequestValue = requestWithSignal(intentRequest, signal);
  try {
    return await withWakeflowMaintenanceGate(
      root,
      {
        expectedCoreLayoutInspectionDigest:
          plan.sharedPreview.coreLayoutInspectionDigest,
        operationId,
        ...gateOptions(options, signal),
      },
      async (context) => {
        let lockedPlan: Awaited<ReturnType<
          typeof previewWakeflowMaintenanceExecution
        >>;
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
        const intentSource =
          await publishWakeflowMaintenanceExecutionIntent(
            root,
            context,
            intent,
          );
        const prepared = await publishPreparedWakeflowMaintenanceJournal(
          root,
          context,
          intentSource,
          intentPlan,
        );
        const advanced = await advanceJournal(
          root,
          context,
          intentSource,
          prepared,
          intentPlan,
          intentRequestValue,
          intentRequest,
          current?.model ?? null,
          capability,
          false,
          signal,
        );
        await assertTerminalConfig(root, intentPlan, operationId);
        await retireWakeflowMaintenanceExecutionIntent(
          root,
          context,
          intentSource,
        );
        await retireTerminalWakeflowMaintenanceJournal(
          root,
          context,
          advanced.terminalSource,
        );
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
      fail(
        reason,
        reason === "transaction" ? "$transactions" : "$intent",
        operationId,
      );
    }
    if (error instanceof WakeflowMaintenanceJournalStoreError) {
      const reason = journalStoreFailureReason(error);
      fail(
        reason,
        reason === "transaction" ? "$transactions" : "$journal",
        operationId,
      );
    }
    throw error;
  }
}

async function recoverTerminalJournalWithoutIntent(
  root: RootedDirectory,
  operationId: WakeflowMaintenanceOperationId,
  initial: Readonly<WakeflowMaintenanceJournalSource>,
  options: Readonly<ParsedOptions>,
): Promise<Readonly<WakeflowMaintenanceExecutionTransactionReceipt>> {
  if (
    initial.journal.state !== "terminal"
    || initial.journal.affectedStepId !== null
    || initial.journal.checkpoint !== initial.journal.stepIds.length
  ) {
    fail("intent", "$intent", operationId);
  }
  assertNotAborted(options.signal, operationId);
  const current = await currentConfigSnapshot(
    root,
    options.signal,
    operationId,
  );
  if (current?.configDigest !== initial.journal.desiredConfigDigest) {
    fail("terminal-closure", "$config", operationId);
  }
  await assertWakeflowMaintenanceJournalIsOnlyTransaction(root, initial);
  await retireInactiveCorrelatedGate(root, operationId);
  return withExistingWakeflowMaintenanceGate(
    root,
    operationId,
    async (context) => {
      const source = await readWakeflowMaintenanceJournal(root, operationId);
      if (
        source.digest !== initial.digest
        || source.journalDigest !== initial.journalDigest
        || source.node.deviceId !== initial.node.deviceId
        || source.node.inodeId !== initial.node.inodeId
      ) {
        fail("journal", "$journal", operationId);
      }
      await retireTerminalWakeflowMaintenanceJournal(root, context, source);
      return Object.freeze({
        status: "recovered" as const,
        operationId,
        planDigest: source.journal.planDigest,
        stepReceipts: Object.freeze([]),
      });
    },
    gateOptions(options),
  );
}

function assertRecoveryConfigState(
  plan: Readonly<WakeflowMaintenanceExecutionPlan>,
  journal: Readonly<WakeflowMaintenanceJournalSource> | null,
  current: Readonly<WakeflowConfigAuthoritySnapshot> | null,
  operationId: WakeflowMaintenanceOperationId,
): WakeflowConfigV3Model | null {
  if (journal === null) {
    if (
      (current?.configDigest ?? null)
        !== plan.sharedPreview.currentConfigDigest
    ) {
      fail("source-config", "$config", operationId);
    }
    return current?.model ?? null;
  }
  const configIndex = plan.steps.findIndex((entry) => (
    entry.boundary === "shared-static" && entry.stepKind === "publish-config"
  ));
  if (configIndex >= 0 && current?.configDigest === plan.sharedPreview.desiredConfigDigest) {
    const configStepId = plan.steps[configIndex]?.stepId;
    if (
      journal.journal.checkpoint <= configIndex
      && journal.journal.affectedStepId !== configStepId
    ) {
      fail("source-config", "$config", operationId);
    }
  }
  if (
    configIndex >= 0
    && current?.configDigest === plan.sharedPreview.currentConfigDigest
    && journal.journal.checkpoint > configIndex
  ) {
    fail("source-config", "$config", operationId);
  }
  if (plan.sharedPreview.currentConfigDigest === null) {
    if (
      current !== null
      && current.configDigest !== plan.sharedPreview.desiredConfigDigest
    ) {
      fail("source-config", "$config", operationId);
    }
    return null;
  }
  if (
    current?.configDigest === plan.sharedPreview.currentConfigDigest
    || current?.configDigest === plan.sharedPreview.desiredConfigDigest
  ) {
    return current.model;
  }
  fail("source-config", "$config", operationId);
}

/**
 * 只凭operation ID、磁盘intent/journal和固定宿主capability恢复同一事务。
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
    await recoverWakeflowMaintenanceExecutionIntentStages(root, operationId);
    await recoverWakeflowMaintenanceJournalStages(root, operationId);
    assertNotAborted(options.signal, operationId);
    const intentSource = await readWakeflowMaintenanceExecutionIntentOrNull(
      root,
      operationId,
    );
    const initialJournal = await readWakeflowMaintenanceJournalOrNull(
      root,
      operationId,
    );
    if (intentSource === null) {
      if (initialJournal === null) fail("intent", "$intent", operationId);
      return await recoverTerminalJournalWithoutIntent(
        root,
        operationId,
        initialJournal,
        options,
      );
    }
    const reconstructed = reconstructWakeflowMaintenanceExecutionFromIntent(
      intentSource.intent,
    );
    const plan = reconstructed.plan;
    const requestValue = reconstructed.request;
    const request = parseWakeflowStaticMaterializationPreviewRequest(requestValue);
    assertRequestMatchesPlan(plan, request);
    const capability = parseCapability(plan, capabilityValue);
    if (initialJournal === null) {
      await assertWakeflowMaintenanceIntentIsOnlyTransactionPrefix(
        root,
        intentSource,
      );
    } else {
      validateJournalPlan(initialJournal, intentSource, plan);
      await assertWakeflowMaintenanceIntentAndJournalAreOnlyTransaction(
        root,
        intentSource,
      );
    }
    const current = await currentConfigSnapshot(
      root,
      options.signal,
      operationId,
    );
    const sourceConfig = assertRecoveryConfigState(
      plan,
      initialJournal,
      current,
      operationId,
    );
    await retireInactiveCorrelatedGate(root, operationId);
    return await withExistingWakeflowMaintenanceGate(
      root,
      operationId,
      async (context) => {
        const currentIntent = await readWakeflowMaintenanceExecutionIntent(
          root,
          operationId,
        );
        if (
          currentIntent.intentDigest !== intentSource.intentDigest
          || currentIntent.digest !== intentSource.digest
          || currentIntent.node.deviceId !== intentSource.node.deviceId
          || currentIntent.node.inodeId !== intentSource.node.inodeId
        ) {
          fail("intent", "$intent", operationId);
        }
        const existingJournal = await readWakeflowMaintenanceJournalOrNull(
          root,
          operationId,
        );
        const source = existingJournal ?? (
          await publishPreparedWakeflowMaintenanceJournal(
            root,
            context,
            currentIntent,
            plan,
          )
        );
        validateJournalPlan(source, currentIntent, plan);
        const advanced = await advanceJournal(
          root,
          context,
          currentIntent,
          source,
          plan,
          requestValue,
          request,
          sourceConfig,
          capability,
          true,
          options.signal,
        );
        await assertTerminalConfig(root, plan, operationId);
        await retireWakeflowMaintenanceExecutionIntent(
          root,
          context,
          currentIntent,
        );
        await retireTerminalWakeflowMaintenanceJournal(
          root,
          context,
          advanced.terminalSource,
        );
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
      fail(
        reason,
        reason === "transaction" ? "$transactions" : "$intent",
        operationId,
      );
    }
    if (error instanceof WakeflowMaintenanceJournalStoreError) {
      const reason = journalStoreFailureReason(error);
      fail(
        reason,
        reason === "transaction" ? "$transactions" : "$journal",
        operationId,
      );
    }
    throw error;
  }
}
