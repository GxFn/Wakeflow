import { types } from "node:util";
import {
  parseSha256Digest,
  type Sha256Digest,
  Sha256Error,
} from "../../foundation/crypto/sha256.js";
import { PassiveOwnDataError, parsePlainRecord } from "../../foundation/data/passive-own-data.js";
import {
  DurableDirectoryMaterializationError,
  materializeDirectoryPath,
} from "../../foundation/filesystem/durable-directory-materialization.js";
import {
  type RootedDirectory,
  isRootedDirectory,
} from "../../foundation/filesystem/rooted-directory.js";
import { KernelFileLockError } from "../../foundation/filesystem/kernel-file-lock.js";
import type { UuidV4Factory } from "../../foundation/identity/uuid-v4.js";
import { throwIfAborted } from "../../foundation/node/abort-signal.js";
import { materializeWorkspaceLocksRoot, withWorkspaceLock } from "../../kernel/workspace-locks.js";
import { withWorkspaceOperationScope } from "../../kernel/workspace-operation-scope.js";
import { retireWakeflowFileLockResidue } from "./wakeflow-file-lock-residue.js";
import {
  createWakeflowMaintenanceOperationId,
  parseWakeflowMaintenanceOperationId,
  type WakeflowMaintenanceOperationId,
  WakeflowMaintenanceOperationIdError,
} from "./wakeflow-maintenance-operation-id.js";
import { WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF } from "./wakeflow-maintenance-resource-catalog.js";
import {
  inspectWakeflowWorkspaceCoreLayout,
  type WakeflowWorkspaceCoreLayoutInspection,
  WakeflowWorkspaceCoreLayoutInspectionError,
} from "./wakeflow-workspace-core-layout-inspection.js";

/**
 * Wakeflow Workspace / Maintenance：bootstrap 后的唯一 maintenance gate scope。
 *
 * 本模块只建立 `.wakeflow-local/runtime/locks` 这一段空协议前缀、取得唯一 gate，并在 gate 内补齐
 * `maintenance/transactions`。gate 是一把内核咨询锁（ADR-0033）：它只表示"此刻有一次维护在跑"，持有者
 * 死掉时什么都不留下；"维护没做完"的记号是事务目录里的 intent。它不创建intent、不执行领域step，也不
 * 决定action。gate 取得后会重验Active与Local bootstrap边界，并把pre-gate Core观察仅绑定到
 * 当前callback context，供Intent发布前的完整plan再次推导。
 *
 * Local bootstrap是唯一允许发生在intent之前的效果；只创建`0700`私有目录，失败
 * 后保留的 exact 空前缀仍由 strict fresh inspection 安全识别。
 */

export interface WakeflowMaintenanceGateContext {
  readonly operationId: WakeflowMaintenanceOperationId;
}

export interface WakeflowMaintenanceGateOptions {
  readonly expectedCoreLayoutInspectionDigest: Sha256Digest;
  readonly acquireTimeoutMilliseconds?: number;
  readonly retryDelayMilliseconds?: number;
  readonly signal?: AbortSignal;
  readonly uuidFactory?: UuidV4Factory;
  /** prepared transaction 的继续/取消路径必须重用原operation ID。 */
  readonly operationId?: WakeflowMaintenanceOperationId;
  /**
   * fresh 只接受空的或 fresh-compatible 的协议前缀；repair（reconcile / reconfigure）还接受协议根缺失
   * 而其他 Wakeflow 目录仍在（§13.114 D2）。busy / recovery-required / conflict 两种模式都拒绝。
   */
  readonly bootstrap?: "fresh" | "repair";
}

export interface WakeflowExistingMaintenanceGateOptions {
  readonly acquireTimeoutMilliseconds?: number;
  readonly retryDelayMilliseconds?: number;
  readonly signal?: AbortSignal;
}

export type WakeflowMaintenanceGateErrorReason =
  | "input"
  | "stale-preview"
  | "bootstrap-conflict"
  | "busy"
  | "recovery-required"
  | "effect-failure";

const ERROR_MESSAGES = {
  input: "Wakeflow maintenance gate input is invalid.",
  "stale-preview": "Wakeflow maintenance core layout differs from preview.",
  "bootstrap-conflict": "Wakeflow maintenance bootstrap prefix is unsafe.",
  busy: "Another Wakeflow maintenance operation holds the gate.",
  "recovery-required": "Wakeflow maintenance gate requires explicit recovery.",
  "effect-failure": "Wakeflow maintenance gate could not be established safely.",
} as const satisfies Readonly<Record<WakeflowMaintenanceGateErrorReason, string>>;

/** Maintenance gate/bootstrap 失败的稳定、脱敏错误。 */
export class WakeflowMaintenanceGateError extends Error {
  override readonly name = "WakeflowMaintenanceGateError";
  readonly code = "wakeflow-maintenance-gate" as const;
  readonly reason: WakeflowMaintenanceGateErrorReason;
  readonly path: string;

  constructor(reason: WakeflowMaintenanceGateErrorReason, path: string, options?: ErrorOptions) {
    super(ERROR_MESSAGES[reason], options);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedOptions {
  readonly expectedCoreLayoutInspectionDigest: Sha256Digest;
  readonly acquireTimeoutMilliseconds: number | undefined;
  readonly retryDelayMilliseconds: number | undefined;
  readonly signal: AbortSignal | undefined;
  readonly uuidFactory: UuidV4Factory | undefined;
  readonly operationId: WakeflowMaintenanceOperationId | undefined;
  readonly bootstrap: "fresh" | "repair";
}

const ACTIVE_CONTEXTS = new WeakSet<object>();
const CONTEXT_ROOTS = new WeakMap<object, RootedDirectory>();
const CONTEXT_CORE_INSPECTIONS = new WeakMap<
  object,
  Readonly<WakeflowWorkspaceCoreLayoutInspection>
>();

function fail(reason: WakeflowMaintenanceGateErrorReason, path: string, cause?: unknown): never {
  throw new WakeflowMaintenanceGateError(reason, path, cause === undefined ? undefined : { cause });
}

function admittedOperationId(value: unknown, path: string): WakeflowMaintenanceOperationId {
  try {
    return parseWakeflowMaintenanceOperationId(value, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceOperationIdError) {
      fail("input", path, error);
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
      fail("input", "$options.uuidFactory", error);
    }
    throw error;
  }
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
    if (error instanceof PassiveOwnDataError) fail("input", "$options", error);
    throw error;
  }
  const allowed = new Set([
    "acquireTimeoutMilliseconds",
    "bootstrap",
    "expectedCoreLayoutInspectionDigest",
    "operationId",
    "retryDelayMilliseconds",
    "signal",
    "uuidFactory",
  ]);
  if (
    !Object.hasOwn(record, "expectedCoreLayoutInspectionDigest") ||
    Object.keys(record).some((key) => !allowed.has(key)) ||
    (record.signal !== undefined &&
      (typeof record.signal !== "object" ||
        record.signal === null ||
        types.isProxy(record.signal) ||
        !(record.signal instanceof AbortSignal))) ||
    (record.uuidFactory !== undefined &&
      (typeof record.uuidFactory !== "function" || types.isProxy(record.uuidFactory))) ||
    (record.operationId !== undefined && record.uuidFactory !== undefined)
  ) {
    fail("input", "$options");
  }
  if (
    record.bootstrap !== undefined &&
    record.bootstrap !== "fresh" &&
    record.bootstrap !== "repair"
  ) {
    fail("input", "$options.bootstrap");
  }
  let expectedCoreLayoutInspectionDigest: Sha256Digest;
  try {
    expectedCoreLayoutInspectionDigest = parseSha256Digest(
      record.expectedCoreLayoutInspectionDigest,
      "$options.expectedCoreLayoutInspectionDigest",
    );
  } catch (error: unknown) {
    if (error instanceof Sha256Error) {
      fail("input", "$options.expectedCoreLayoutInspectionDigest", error);
    }
    throw error;
  }
  return Object.freeze({
    expectedCoreLayoutInspectionDigest,
    bootstrap: record.bootstrap === "repair" ? ("repair" as const) : ("fresh" as const),
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
    operationId:
      record.operationId === undefined
        ? undefined
        : admittedOperationId(record.operationId, "$options.operationId"),
  });
}

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (!isRootedDirectory(value)) fail("input", "$root");
}

function assertOperation<Result>(
  value: unknown,
): asserts value is (
  context: Readonly<WakeflowMaintenanceGateContext>,
) => Result | Promise<Result> {
  if (typeof value !== "function" || types.isProxy(value)) {
    fail("input", "$operation");
  }
}

/** 自举的一步：建出一段 0700 私有目录，或（`locks`）锁目录连同它的锁文件。 */
async function materialize(
  root: RootedDirectory,
  target: typeof WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF | "locks",
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    if (target === "locks") {
      await materializeWorkspaceLocksRoot(root, signal);
      return;
    }
    await materializeDirectoryPath(root, target, {
      mode: 0o700,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryMaterializationError) {
      fail("effect-failure", "$bootstrap", error);
    }
    if (error instanceof KernelFileLockError) fail("effect-failure", "$bootstrap", error);
    throw error;
  }
}

function mapLockError(error: KernelFileLockError): never {
  if (error.reason === "timeout") fail("busy", "$gate", error);
  if (error.reason === "input") fail("input", error.path, error);
  if (error.reason === "unsafe-lock" || error.reason === "parent") {
    fail("bootstrap-conflict", "$gate", error);
  }
  fail("effect-failure", "$gate", error);
}

/**
 * 解析一个仍在当前 gate callback 内有效的 context，并验证它属于指定 Workspace 根。
 */
export function assertWakeflowMaintenanceGateContext(
  value: unknown,
  root: RootedDirectory,
): asserts value is Readonly<WakeflowMaintenanceGateContext> {
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    !ACTIVE_CONTEXTS.has(value) ||
    CONTEXT_ROOTS.get(value) !== root
  ) {
    fail("input", "$context");
  }
}

/** 返回normal gate在取得exact lock后重验过的pre-gate Core Layout观察。 */
export function wakeflowMaintenanceCoreInspectionForGateContext(
  value: unknown,
  root: RootedDirectory,
): Readonly<WakeflowWorkspaceCoreLayoutInspection> {
  assertWakeflowMaintenanceGateContext(value, root);
  const inspection = CONTEXT_CORE_INSPECTIONS.get(value);
  if (inspection === undefined) fail("input", "$context");
  return inspection;
}

async function runCorrelatedGate<Result>(
  root: RootedDirectory,
  operationId: WakeflowMaintenanceOperationId,
  options: Readonly<{
    readonly acquireTimeoutMilliseconds: number | undefined;
    readonly retryDelayMilliseconds: number | undefined;
    readonly signal: AbortSignal | undefined;
  }>,
  operation: (context: Readonly<WakeflowMaintenanceGateContext>) => Result | Promise<Result>,
  prepare?: () => Promise<Readonly<WakeflowWorkspaceCoreLayoutInspection> | undefined>,
): Promise<Result> {
  try {
    return await withWorkspaceLock(
      root,
      "maintenance-gate",
      async () => {
        const admittedCoreInspection = await prepare?.();
        const context = Object.freeze({
          operationId,
        });
        ACTIVE_CONTEXTS.add(context);
        CONTEXT_ROOTS.set(context, root);
        if (admittedCoreInspection !== undefined) {
          CONTEXT_CORE_INSPECTIONS.set(context, admittedCoreInspection);
        }
        try {
          return await withWorkspaceOperationScope(
            root,
            "exclusive",
            async () => {
              const result = await operation(context);
              // 做成了的维护顺手删掉文件锁版本留下的锁目录；放在最后，计划核对的任何观察都在它之前。
              await retireWakeflowFileLockResidue(root, options.signal);
              return result;
            },
            {
              ...(options.signal === undefined ? {} : { signal: options.signal }),
              // 门在这个回调结束之前一直由本进程持有；活着的 context 就是持有它的凭证。
              maintenanceGuard: async () => assertWakeflowMaintenanceGateContext(context, root),
            },
          );
        } finally {
          ACTIVE_CONTEXTS.delete(context);
          CONTEXT_ROOTS.delete(context);
          CONTEXT_CORE_INSPECTIONS.delete(context);
        }
      },
      {
        ...(options.acquireTimeoutMilliseconds === undefined
          ? {}
          : { acquireTimeoutMilliseconds: options.acquireTimeoutMilliseconds }),
        ...(options.retryDelayMilliseconds === undefined
          ? {}
          : { retryDelayMilliseconds: options.retryDelayMilliseconds }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceGateError) throw error;
    if (error instanceof KernelFileLockError) mapLockError(error);
    throw error;
  }
}

/**
 * 在调用方已经验证磁盘上的 intent（恢复依据）之后，以原 operation ID 取得 gate。
 */
function parseWakeflowExistingMaintenanceGateOptions(
  value: unknown,
): Readonly<WakeflowExistingMaintenanceGateOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options", error);
    throw error;
  }
  if (
    Object.keys(record).some(
      (key) =>
        key !== "acquireTimeoutMilliseconds" &&
        key !== "retryDelayMilliseconds" &&
        key !== "signal",
    )
  ) {
    fail("input", "$options");
  }
  const signal = record.signal;
  if (
    signal !== undefined &&
    (typeof signal !== "object" ||
      signal === null ||
      types.isProxy(signal) ||
      !(signal instanceof AbortSignal))
  ) {
    fail("input", "$options.signal");
  }
  const acquireTimeoutMilliseconds = positiveMilliseconds(
    record.acquireTimeoutMilliseconds,
    "$options.acquireTimeoutMilliseconds",
  );
  const retryDelayMilliseconds = positiveMilliseconds(
    record.retryDelayMilliseconds,
    "$options.retryDelayMilliseconds",
  );
  return Object.freeze({
    ...(acquireTimeoutMilliseconds === undefined ? {} : { acquireTimeoutMilliseconds }),
    ...(retryDelayMilliseconds === undefined ? {} : { retryDelayMilliseconds }),
    ...(signal === undefined ? {} : { signal: signal as AbortSignal }),
  });
}

export async function withExistingWakeflowMaintenanceGate<Result>(
  rootValue: RootedDirectory,
  operationIdValue: unknown,
  operationValue: (context: Readonly<WakeflowMaintenanceGateContext>) => Result | Promise<Result>,
  optionsValue: WakeflowExistingMaintenanceGateOptions = {},
): Promise<Result> {
  assertRoot(rootValue);
  assertOperation<Result>(operationValue);
  const operationId = admittedOperationId(operationIdValue, "$operationId");
  const options = parseWakeflowExistingMaintenanceGateOptions(optionsValue);
  return runCorrelatedGate(
    rootValue,
    operationId,
    {
      acquireTimeoutMilliseconds: options.acquireTimeoutMilliseconds,
      retryDelayMilliseconds: options.retryDelayMilliseconds,
      signal: options.signal,
    },
    operationValue,
  );
}

/** 门已经拿到：重新检查核心布局，确认预览时看到的活动布局没有变、协议目录齐全且没有残留。 */
async function admitLockedCoreInspection(
  root: RootedDirectory,
  before: Readonly<WakeflowWorkspaceCoreLayoutInspection>,
  signal: AbortSignal | undefined,
): Promise<Readonly<WakeflowWorkspaceCoreLayoutInspection>> {
  let after: Readonly<WakeflowWorkspaceCoreLayoutInspection>;
  try {
    after = await inspectWakeflowWorkspaceCoreLayout(root, signal === undefined ? {} : { signal });
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceCoreLayoutInspectionError) {
      fail("bootstrap-conflict", "$bootstrap", error);
    }
    throw error;
  }
  if (
    after.active.status !== before.active.status ||
    after.active.nodeDigest !== before.active.nodeDigest
  ) {
    fail("stale-preview", "$activeLayout");
  }
  if (
    after.local.status !== "busy" ||
    !after.local.protocolComplete ||
    after.issueCodes.length !== 0
  ) {
    fail(
      after.issueCodes.includes("maintenance-transaction-residue")
        ? "recovery-required"
        : "bootstrap-conflict",
      "$bootstrap",
    );
  }
  return before;
}

/** 在关联 operation ID 的唯一 maintenance gate 内执行一个有界临界区。 */
export async function withWakeflowMaintenanceGate<Result>(
  rootValue: RootedDirectory,
  optionsValue: WakeflowMaintenanceGateOptions,
  operationValue: (context: Readonly<WakeflowMaintenanceGateContext>) => Result | Promise<Result>,
): Promise<Result> {
  assertRoot(rootValue);
  assertOperation<Result>(operationValue);
  const options = parseOptions(optionsValue);
  throwIfAborted(options.signal);
  const operationId = options.operationId ?? createOperationId(options.uuidFactory);
  let inspection: Readonly<WakeflowWorkspaceCoreLayoutInspection>;
  try {
    inspection = await inspectWakeflowWorkspaceCoreLayout(
      rootValue,
      options.signal === undefined ? {} : { signal: options.signal },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceCoreLayoutInspectionError) {
      fail("bootstrap-conflict", "$bootstrap", error);
    }
    throw error;
  }
  if (inspection.inspectionDigest !== options.expectedCoreLayoutInspectionDigest) {
    fail("stale-preview", "$options.expectedCoreLayoutInspectionDigest");
  }
  if (
    inspection.local.status !== "absent" &&
    inspection.local.status !== "bootstrap-prefix" &&
    inspection.local.status !== "idle"
  ) {
    fail(
      inspection.local.status === "busy"
        ? "busy"
        : inspection.local.status === "recovery-required"
          ? "recovery-required"
          : "bootstrap-conflict",
      "$bootstrap",
    );
  }
  if (
    inspection.local.status !== "idle" &&
    !inspection.local.freshCompatible &&
    options.bootstrap !== "repair"
  ) {
    fail("bootstrap-conflict", "$bootstrap");
  }
  await materialize(rootValue, "locks", options.signal);
  return runCorrelatedGate(rootValue, operationId, options, operationValue, async () => {
    await materialize(rootValue, WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF, options.signal);
    return admitLockedCoreInspection(rootValue, inspection, options.signal);
  });
}
