import { types } from "node:util";

import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  materializeDirectoryPath,
  DurableDirectoryMaterializationError,
} from "../../foundation/filesystem/durable-directory-materialization.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  withRootedExclusiveFileLock,
  RootedExclusiveFileLockError,
} from "../../foundation/filesystem/rooted-exclusive-file-lock.js";
import type { UuidV4Factory } from "../../foundation/identity/uuid-v4.js";
import {
  createWakeflowMaintenanceOperationId,
  parseWakeflowMaintenanceOperationId,
  wakeflowMaintenanceOperationUuid,
  type WakeflowMaintenanceOperationId,
} from "./wakeflow-maintenance-operation-id.js";
import {
  WAKEFLOW_MAINTENANCE_GATE_REF,
  WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF,
  WAKEFLOW_RUNTIME_ROOT_REF,
} from "./wakeflow-maintenance-resource-catalog.js";
import {
  inspectWakeflowWorkspaceCoreLayout,
  WakeflowWorkspaceCoreLayoutInspectionError,
} from "./wakeflow-workspace-core-layout-inspection.js";

/**
 * Wakeflow Workspace / Maintenance：bootstrap 后的唯一 maintenance gate scope。
 *
 * 本模块只建立 `.wakeflow-local/runtime` 空协议前缀、取得唯一 gate，并在 gate 内补齐
 * `maintenance/transactions`。operation ID与gate token复用同一UUID，使intent写入前的
 * 孤立gate仍可被精确关联。它不创建intent/journal、不执行领域step，也不决定action。
 *
 * Local bootstrap是唯一允许发生在intent之前的效果；只创建`0700`私有目录，失败
 * 后保留的 exact 空前缀仍由 strict fresh inspection 安全识别。
 */

export interface WakeflowMaintenanceGateContext {
  readonly kind: "WakeflowMaintenanceGateContext";
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
  | "aborted"
  | "effect-failure";

const ERROR_MESSAGES = {
  input: "Wakeflow maintenance gate input is invalid.",
  "stale-preview": "Wakeflow maintenance core layout differs from preview.",
  "bootstrap-conflict": "Wakeflow maintenance bootstrap prefix is unsafe.",
  busy: "Another Wakeflow maintenance operation holds the gate.",
  "recovery-required": "Wakeflow maintenance gate requires explicit recovery.",
  aborted: "Wakeflow maintenance gate acquisition was aborted.",
  "effect-failure": "Wakeflow maintenance gate could not be established safely.",
} as const satisfies Readonly<Record<
  WakeflowMaintenanceGateErrorReason,
  string
>>;

/** Maintenance gate/bootstrap 失败的稳定、脱敏错误。 */
export class WakeflowMaintenanceGateError extends Error {
  override readonly name = "WakeflowMaintenanceGateError";
  readonly code = "wakeflow-maintenance-gate" as const;
  readonly reason: WakeflowMaintenanceGateErrorReason;
  readonly path: string;

  constructor(reason: WakeflowMaintenanceGateErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
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
}

const ACTIVE_CONTEXTS = new WeakSet<object>();
const CONTEXT_ROOTS = new WeakMap<object, RootedDirectory>();

function fail(reason: WakeflowMaintenanceGateErrorReason, path: string): never {
  throw new WakeflowMaintenanceGateError(reason, path);
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
  const allowed = new Set([
    "acquireTimeoutMilliseconds",
    "expectedCoreLayoutInspectionDigest",
    "operationId",
    "retryDelayMilliseconds",
    "signal",
    "uuidFactory",
  ]);
  if (
    !Object.hasOwn(record, "expectedCoreLayoutInspectionDigest")
    || Object.keys(record).some((key) => !allowed.has(key))
    || (
      record.signal !== undefined
      && (
        typeof record.signal !== "object"
        || record.signal === null
        || types.isProxy(record.signal)
        || !(record.signal instanceof AbortSignal)
      )
    )
    || (
      record.uuidFactory !== undefined
      && (
        typeof record.uuidFactory !== "function"
        || types.isProxy(record.uuidFactory)
      )
    )
    || (record.operationId !== undefined && record.uuidFactory !== undefined)
  ) {
    fail("input", "$options");
  }
  let expectedCoreLayoutInspectionDigest: Sha256Digest;
  try {
    expectedCoreLayoutInspectionDigest = parseSha256Digest(
      record.expectedCoreLayoutInspectionDigest,
      "$options.expectedCoreLayoutInspectionDigest",
    );
  } catch (error: unknown) {
    if (error instanceof Sha256Error) {
      fail("input", "$options.expectedCoreLayoutInspectionDigest");
    }
    throw error;
  }
  return Object.freeze({
    expectedCoreLayoutInspectionDigest,
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
    operationId: record.operationId === undefined
      ? undefined
      : (() => {
          try {
            return parseWakeflowMaintenanceOperationId(
              record.operationId,
              "$options.operationId",
            );
          } catch {
            fail("input", "$options.operationId");
          }
        })(),
  });
}

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
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

async function materialize(
  root: RootedDirectory,
  resourcePath: typeof WAKEFLOW_RUNTIME_ROOT_REF,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await materializeDirectoryPath(root, resourcePath, {
      mode: 0o700,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryMaterializationError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("effect-failure", "$bootstrap");
    }
    throw error;
  }
}

function mapLockError(error: RootedExclusiveFileLockError): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "timeout") fail("busy", "$gate");
  if (
    error.reason === "owner-active"
    || error.reason === "residue-changed"
    || error.reason === "release-failure"
  ) {
    fail("recovery-required", "$gate");
  }
  if (error.reason === "input") fail("input", error.path);
  fail("bootstrap-conflict", "$gate");
}

/**
 * 解析一个仍在当前 gate callback 内有效的 context，并验证它属于指定 Workspace 根。
 */
export function assertWakeflowMaintenanceGateContext(
  value: unknown,
  root: RootedDirectory,
): asserts value is Readonly<WakeflowMaintenanceGateContext> {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !ACTIVE_CONTEXTS.has(value)
    || CONTEXT_ROOTS.get(value) !== root
  ) {
    fail("input", "$context");
  }
}

async function runCorrelatedGate<Result>(
  root: RootedDirectory,
  operationId: WakeflowMaintenanceOperationId,
  options: Readonly<{
    readonly acquireTimeoutMilliseconds: number | undefined;
    readonly retryDelayMilliseconds: number | undefined;
    readonly signal: AbortSignal | undefined;
  }>,
  operation: (
    context: Readonly<WakeflowMaintenanceGateContext>,
  ) => Result | Promise<Result>,
): Promise<Result> {
  const operationUuid = wakeflowMaintenanceOperationUuid(operationId);
  try {
    return await withRootedExclusiveFileLock(
      root,
      WAKEFLOW_MAINTENANCE_GATE_REF,
      async () => {
        const context = Object.freeze({
          kind: "WakeflowMaintenanceGateContext" as const,
          operationId,
        });
        ACTIVE_CONTEXTS.add(context);
        CONTEXT_ROOTS.set(context, root);
        try {
          return await operation(context);
        } finally {
          ACTIVE_CONTEXTS.delete(context);
          CONTEXT_ROOTS.delete(context);
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
        tokenUuidFactory: () => operationUuid,
      },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceGateError) throw error;
    if (error instanceof RootedExclusiveFileLockError) mapLockError(error);
    throw error;
  }
}

/**
 * 在调用方已经验证 prepared journal / recovery evidence 后，以原 operation ID 取得 gate。
 */
export async function withExistingWakeflowMaintenanceGate<Result>(
  rootValue: RootedDirectory,
  operationIdValue: unknown,
  operationValue: (
    context: Readonly<WakeflowMaintenanceGateContext>,
  ) => Result | Promise<Result>,
  optionsValue: WakeflowExistingMaintenanceGateOptions = {},
): Promise<Result> {
  assertRoot(rootValue);
  assertOperation<Result>(operationValue);
  let operationId: WakeflowMaintenanceOperationId;
  try {
    operationId = parseWakeflowMaintenanceOperationId(operationIdValue);
  } catch {
    fail("input", "$operationId");
  }
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(optionsValue, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (Object.keys(record).some((key) => (
    key !== "acquireTimeoutMilliseconds"
    && key !== "retryDelayMilliseconds"
    && key !== "signal"
  ))) {
    fail("input", "$options");
  }
  const signal = record.signal;
  if (
    signal !== undefined
    && (
      typeof signal !== "object"
      || signal === null
      || types.isProxy(signal)
      || !(signal instanceof AbortSignal)
    )
  ) {
    fail("input", "$options.signal");
  }
  return runCorrelatedGate(
    rootValue,
    operationId,
    {
      acquireTimeoutMilliseconds: positiveMilliseconds(
        record.acquireTimeoutMilliseconds,
        "$options.acquireTimeoutMilliseconds",
      ),
      retryDelayMilliseconds: positiveMilliseconds(
        record.retryDelayMilliseconds,
        "$options.retryDelayMilliseconds",
      ),
      signal: signal as AbortSignal | undefined,
    },
    operationValue,
  );
}

/** 在关联 operation ID 的唯一 maintenance gate 内执行一个有界临界区。 */
export async function withWakeflowMaintenanceGate<Result>(
  rootValue: RootedDirectory,
  optionsValue: WakeflowMaintenanceGateOptions,
  operationValue: (
    context: Readonly<WakeflowMaintenanceGateContext>,
  ) => Result | Promise<Result>,
): Promise<Result> {
  assertRoot(rootValue);
  assertOperation<Result>(operationValue);
  const options = parseOptions(optionsValue);
  if (options.signal?.aborted === true) fail("aborted", "$signal");
  let inspection;
  try {
    inspection = await inspectWakeflowWorkspaceCoreLayout(
      rootValue,
      options.signal === undefined ? {} : { signal: options.signal },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceCoreLayoutInspectionError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("bootstrap-conflict", "$bootstrap");
    }
    throw error;
  }
  if (inspection.inspectionDigest !== options.expectedCoreLayoutInspectionDigest) {
    fail("stale-preview", "$options.expectedCoreLayoutInspectionDigest");
  }
  if (
    inspection.local.status !== "absent"
    && inspection.local.status !== "bootstrap-prefix"
    && inspection.local.status !== "idle"
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
    inspection.local.status !== "idle"
    && !inspection.local.freshCompatible
  ) {
    fail("bootstrap-conflict", "$bootstrap");
  }
  await materialize(
    rootValue,
    WAKEFLOW_RUNTIME_ROOT_REF,
    options.signal,
  );
  const operationId = options.operationId
    ?? (options.uuidFactory === undefined
      ? createWakeflowMaintenanceOperationId()
      : createWakeflowMaintenanceOperationId(options.uuidFactory));
  return runCorrelatedGate(
    rootValue,
    operationId,
    options,
    async (context) => {
      await materialize(
        rootValue,
        WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF,
        options.signal,
      );
      return operationValue(context);
    },
  );
}
