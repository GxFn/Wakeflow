import { types } from "node:util";

import {
  createFileAtomically,
  replaceFileAtomically,
  DurableAtomicFileWriteError,
  type DurableAtomicFileReplaceResult,
  type DurableAtomicFileWriteResult,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import {
  recoverDurableAtomicFileStagesForTargets,
  DurableAtomicFileStageRecoveryError,
} from "../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  inspectRootedExclusiveFileLock,
  retireRootedExclusiveFileLockResidue,
  withRootedExclusiveFileLock,
  RootedExclusiveFileLockError,
} from "../../foundation/filesystem/rooted-exclusive-file-lock.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  admitWakeflowResourceOperation,
  WakeflowResourceProcessingContractError,
} from "../../foundation/resource/resource-processing-contract.js";
import {
  WAKEFLOW_ACTIVE_PROJECTION_LOCK_RESOURCE_DECLARATION,
  WAKEFLOW_ACTIVE_WORKSPACE_INDEX_RESOURCE_DECLARATION,
  WAKEFLOW_ACTIVE_WORKSPACE_STATUS_RESOURCE_DECLARATION,
} from "./wakeflow-active-resource-catalog.js";
import {
  WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF,
  WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF,
  WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF,
} from "./wakeflow-active-paths.js";
import {
  WAKEFLOW_ACTIVE_WORKSPACE_PROJECTION_FILE_MODE,
} from "./wakeflow-active-workspace-fresh-projection-authority.js";
import {
  inspectWakeflowActiveWorkspaceProjection,
  WakeflowActiveWorkspaceProjectionInspectionError,
  type WakeflowActiveWorkspaceProjectionInspection,
  type WakeflowActiveWorkspaceProjectionInspectionRequest,
  type WakeflowActiveWorkspaceProjectionTargetInspection,
} from "./wakeflow-active-workspace-projection-inspection.js";

/**
 * Wakeflow Workspace / Active：Workspace级投影的锁内确定性发布。
 *
 * Owner先恢复明确affected的目标stage/短锁，再在专用lock内重做完整inspection和全目标
 * 预检。两份Markdown逐文件CAS；它们不是跨文件原子authority，崩溃可留下部分current
 * projection，maintenance journal只会重放同一个可重建step。
 */

export const WAKEFLOW_ACTIVE_WORKSPACE_PROJECTION_LOCK_TIMEOUT_MILLISECONDS =
  10_000;

export interface WakeflowActiveWorkspaceProjectionPublicationOptions {
  readonly recoveringAffectedPublication: boolean;
  readonly signal?: AbortSignal;
}

export type WakeflowActiveWorkspaceProjectionPublicationEffect =
  | Readonly<DurableAtomicFileWriteResult<"created">>
  | Readonly<DurableAtomicFileReplaceResult>;

export interface WakeflowActiveWorkspaceProjectionPublicationReceipt {
  readonly disposition: "current" | "created" | "updated";
  readonly effects:
    readonly Readonly<WakeflowActiveWorkspaceProjectionPublicationEffect>[];
  readonly inspection: Readonly<WakeflowActiveWorkspaceProjectionInspection>;
}

export type WakeflowActiveWorkspaceProjectionPublicationErrorReason =
  | "input"
  | "lock"
  | "source"
  | "conflict"
  | "recovery-required"
  | "root-scope"
  | "aborted"
  | "effect-failure"
  | "commit-uncertain";

const ERROR_MESSAGES = {
  input: "Active workspace projection publication input is invalid.",
  lock: "Active workspace projection publication lock is unsafe.",
  source: "Active workspace projection source authority is unavailable.",
  conflict: "Active workspace projection target changed before publication.",
  "recovery-required": "Active workspace projection publication requires recovery.",
  "root-scope": "Active workspace projection publication lost workspace scope.",
  aborted: "Active workspace projection publication was aborted.",
  "effect-failure": "Active workspace projection publication failed safely.",
  "commit-uncertain": "Active workspace projection publication commit could not be proven.",
} as const satisfies Readonly<Record<
  WakeflowActiveWorkspaceProjectionPublicationErrorReason,
  string
>>;

/** Active workspace projection publication 失败的稳定、脱敏错误。 */
export class WakeflowActiveWorkspaceProjectionPublicationError extends Error {
  override readonly name = "WakeflowActiveWorkspaceProjectionPublicationError";
  readonly code = "wakeflow-active-workspace-projection-publication" as const;
  readonly reason: WakeflowActiveWorkspaceProjectionPublicationErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowActiveWorkspaceProjectionPublicationErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedOptions {
  readonly recoveringAffectedPublication: boolean;
  readonly signal: AbortSignal | undefined;
}

function fail(
  reason: WakeflowActiveWorkspaceProjectionPublicationErrorReason,
  path: string,
): never {
  throw new WakeflowActiveWorkspaceProjectionPublicationError(reason, path);
}

function parseOptions(value: unknown): Readonly<ParsedOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error.path);
    throw error;
  }
  if (
    !Object.hasOwn(record, "recoveringAffectedPublication")
    || Object.keys(record).some((key) => (
      key !== "recoveringAffectedPublication" && key !== "signal"
    ))
    || typeof record.recoveringAffectedPublication !== "boolean"
    || (
      record.signal !== undefined
      && (
        typeof record.signal !== "object"
        || record.signal === null
        || types.isProxy(record.signal)
        || !(record.signal instanceof AbortSignal)
      )
    )
  ) {
    fail("input", "$options");
  }
  return Object.freeze({
    recoveringAffectedPublication: record.recoveringAffectedPublication,
    signal: record.signal as AbortSignal | undefined,
  });
}

function admitOperations(): void {
  try {
    for (const declaration of [
      WAKEFLOW_ACTIVE_WORKSPACE_INDEX_RESOURCE_DECLARATION,
      WAKEFLOW_ACTIVE_WORKSPACE_STATUS_RESOURCE_DECLARATION,
    ]) {
      admitWakeflowResourceOperation(
        declaration.processing,
        "deterministic-rewrite",
      );
    }
    admitWakeflowResourceOperation(
      WAKEFLOW_ACTIVE_PROJECTION_LOCK_RESOURCE_DECLARATION.processing,
      "exclusive-create",
    );
    admitWakeflowResourceOperation(
      WAKEFLOW_ACTIVE_PROJECTION_LOCK_RESOURCE_DECLARATION.processing,
      "exact-retire",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowResourceProcessingContractError) {
      fail("input", "$resourceDeclaration");
    }
    throw error;
  }
}

function mapInspectionError(
  error: WakeflowActiveWorkspaceProjectionInspectionError,
  afterCommit: boolean,
): never {
  if (afterCommit) fail("commit-uncertain", "$projection");
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "root-scope") fail("root-scope", "$root");
  if (error.reason === "target-conflict" || error.reason === "target-policy") {
    fail("conflict", error.path);
  }
  if (error.reason === "lock-present") fail("lock", "$lock");
  if (error.reason === "input") fail("input", error.path);
  fail("source", error.path);
}

async function inspect(
  root: RootedDirectory,
  request: WakeflowActiveWorkspaceProjectionInspectionRequest,
  signal: AbortSignal | undefined,
  afterCommit: boolean,
): Promise<Readonly<WakeflowActiveWorkspaceProjectionInspection>> {
  try {
    return await inspectWakeflowActiveWorkspaceProjection(
      root,
      {
        ...request,
        ...(signal === undefined ? {} : { signal }),
      },
      { allowLock: true },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowActiveWorkspaceProjectionInspectionError) {
      mapInspectionError(error, afterCommit);
    }
    throw error;
  }
}

function mapAtomicError(
  error: DurableAtomicFileWriteError,
  committed: boolean,
): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "root-scope" || error.reason === "parent-changed") {
    fail("root-scope", "$root");
  }
  if (
    error.reason === "target-exists"
    || error.reason === "expectation-changed"
    || error.reason === "expectation-read-failure"
  ) {
    fail(committed ? "commit-uncertain" : "conflict", "$projection");
  }
  if (error.reason === "stage-recovery-required") {
    fail("recovery-required", "$projection");
  }
  if (
    error.reason === "commit-uncertain"
    || error.reason === "durability-failure"
    || error.reason === "stage-cleanup-failure"
    || error.reason === "close-failure"
  ) {
    fail("commit-uncertain", "$projection");
  }
  fail(committed ? "commit-uncertain" : "effect-failure", "$projection");
}

async function publishTarget(
  root: RootedDirectory,
  inspection: Readonly<WakeflowActiveWorkspaceProjectionInspection>,
  target: Readonly<WakeflowActiveWorkspaceProjectionTargetInspection>,
  signal: AbortSignal | undefined,
  committed: boolean,
): Promise<Readonly<WakeflowActiveWorkspaceProjectionPublicationEffect> | null> {
  if (target.status === "current") return null;
  const expected = inspection.authority.files.find((entry) => (
    entry.resourcePath === target.resourcePath
  ));
  if (expected === undefined) fail("input", "$projection");
  try {
    if (target.status === "missing") {
      return await createFileAtomically(root, target.resourcePath, expected.bytes, {
        mode: WAKEFLOW_ACTIVE_WORKSPACE_PROJECTION_FILE_MODE,
        ...(signal === undefined ? {} : { signal }),
      });
    }
    if (target.source === null) fail("conflict", "$projection");
    return await replaceFileAtomically(root, target.resourcePath, expected.bytes, {
      mode: WAKEFLOW_ACTIVE_WORKSPACE_PROJECTION_FILE_MODE,
      expected: target.source,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) {
      mapAtomicError(error, committed);
    }
    fail(committed ? "commit-uncertain" : "effect-failure", "$projection");
  }
}

async function prepareAffectedRecovery(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<void> {
  let lock;
  try {
    lock = await inspectRootedExclusiveFileLock(
      root,
      WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF,
    );
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) fail("lock", "$lock");
    throw error;
  }
  if (lock.status === "held") {
    if (lock.ownerState !== "inactive") fail("lock", "$lock");
    try {
      await retireRootedExclusiveFileLockResidue(
        root,
        WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF,
        lock,
      );
    } catch (error: unknown) {
      if (error instanceof RootedExclusiveFileLockError) {
        fail("recovery-required", "$lock");
      }
      throw error;
    }
  }
  try {
    for (const target of [
      WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF,
      WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF,
    ]) {
      const recovery = await recoverDurableAtomicFileStagesForTargets(
        root,
        [target],
        signal === undefined ? undefined : { signal },
      );
      if (recovery.activeStageCount !== 0 || recovery.unknownStageCount !== 0) {
        fail("recovery-required", "$projectionStage");
      }
    }
  } catch (error: unknown) {
    if (error instanceof WakeflowActiveWorkspaceProjectionPublicationError) {
      throw error;
    }
    if (error instanceof DurableAtomicFileStageRecoveryError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("recovery-required", "$projectionStage");
    }
    throw error;
  }
}

function mapLockError(error: RootedExclusiveFileLockError): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "timeout") fail("lock", "$lock");
  if (
    error.reason === "unsafe-lock"
    || error.reason === "parent"
    || error.reason === "root-scope"
  ) {
    fail("lock", "$lock");
  }
  fail("recovery-required", "$lock");
}

/** 在专用lock内幂等发布Fresh workspace两份投影。 */
export async function publishWakeflowActiveWorkspaceProjection(
  rootValue: RootedDirectory,
  requestValue: WakeflowActiveWorkspaceProjectionInspectionRequest,
  optionsValue: WakeflowActiveWorkspaceProjectionPublicationOptions,
): Promise<Readonly<WakeflowActiveWorkspaceProjectionPublicationReceipt>> {
  if (
    typeof rootValue !== "object"
    || rootValue === null
    || types.isProxy(rootValue)
    || !(rootValue instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
  const options = parseOptions(optionsValue);
  if (options.signal?.aborted === true) fail("aborted", "$signal");
  admitOperations();
  if (options.recoveringAffectedPublication) {
    await prepareAffectedRecovery(rootValue, options.signal);
  }
  let committed = false;
  try {
    return await withRootedExclusiveFileLock(
      rootValue,
      WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF,
      async () => {
        const before = await inspect(
          rootValue,
          requestValue,
          options.signal,
          false,
        );
        if (before.status === "current") {
          return Object.freeze({
            disposition: "current" as const,
            effects: Object.freeze([]),
            inspection: before,
          });
        }
        const effects: WakeflowActiveWorkspaceProjectionPublicationEffect[] = [];
        for (const target of before.targets) {
          const effect = await publishTarget(
            rootValue,
            before,
            target,
            options.signal,
            committed,
          );
          if (effect !== null) {
            committed = true;
            effects.push(effect);
          }
        }
        const after = await inspect(
          rootValue,
          requestValue,
          options.signal,
          true,
        );
        if (
          after.status !== "current"
          || after.authority.authorityDigest
            !== before.authority.authorityDigest
        ) {
          fail("commit-uncertain", "$projection");
        }
        return Object.freeze({
          disposition: effects.some((entry) => entry.publication === "replaced")
            ? "updated" as const
            : "created" as const,
          effects: Object.freeze(effects),
          inspection: after,
        });
      },
      {
        acquireTimeoutMilliseconds:
          WAKEFLOW_ACTIVE_WORKSPACE_PROJECTION_LOCK_TIMEOUT_MILLISECONDS,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowActiveWorkspaceProjectionPublicationError) {
      throw error;
    }
    if (error instanceof RootedExclusiveFileLockError) mapLockError(error);
    fail(committed ? "commit-uncertain" : "effect-failure", "$projection");
  }
}
