import { types } from "node:util";

import {
  createWakeflowDurableId,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  createUuidV4,
  UuidV4Error,
  type UuidV4Factory,
} from "../../foundation/identity/uuid-v4.js";
import type { UtcWallClock } from "../../foundation/time/wall-clock.js";
import {
  ManagedEvidenceCapturePlanningService,
  ManagedEvidenceCapturePlanningServiceError,
} from "./managed-evidence-capture-planning-service.js";
import {
  computeManagedEvidencePublicationTransactionDigest,
  createManagedEvidencePublicationTransaction,
  ManagedEvidencePublicationTransactionError,
  type ManagedEvidencePublicationTransaction,
} from "./managed-evidence-publication-transaction.js";

/**
 * Wakeflow Governance / Evidence：公共层之下的零写Publication Planning。
 *
 * Capture Planning拥有Config/Demand/source读取与Evidence ID；本Service在capture成功后
 * 再分配Event/Commit ID并生成完整无phaseTransaction。它不创建journal、stage、final
 * 或Event，也不解释MCP root与结果脱敏。
 */

export interface ManagedEvidencePublicationPlanningOptions {
  readonly clock?: UtcWallClock;
  readonly uuidFactory?: UuidV4Factory;
  readonly signal?: AbortSignal;
}

export interface ManagedEvidencePublicationPlan {
  readonly plan: Readonly<ManagedEvidencePublicationTransaction>;
  readonly planDigest: Sha256Digest;
}

export type ManagedEvidencePublicationPlanningServiceErrorReason =
  | "input"
  | "capture"
  | "identity"
  | "transaction"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Managed evidence publication planning input is invalid.",
  capture: "Managed evidence publication capture planning failed.",
  identity: "Managed evidence publication planning could not allocate identity.",
  transaction: "Managed evidence publication planning could not build its transaction.",
  aborted: "Managed evidence publication planning was aborted.",
  "operation-failure": "Managed evidence publication planning failed.",
} as const satisfies Readonly<
  Record<ManagedEvidencePublicationPlanningServiceErrorReason, string>
>;

/** 零写Publication计划无法由当前Authority与source确定时的稳定错误。 */
export class ManagedEvidencePublicationPlanningServiceError extends Error {
  override readonly name = "ManagedEvidencePublicationPlanningServiceError";
  readonly code = "wakeflow-managed-evidence-publication-planning-service" as const;
  readonly reason: ManagedEvidencePublicationPlanningServiceErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;

  constructor(
    reason: ManagedEvidencePublicationPlanningServiceErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
  }
}

interface ParsedOptions {
  readonly clock: UtcWallClock | undefined;
  readonly uuidFactory: UuidV4Factory | undefined;
  readonly signal: AbortSignal | undefined;
}

function ownString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined &&
    Object.hasOwn(descriptor, "value") &&
    typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function fail(
  reason: ManagedEvidencePublicationPlanningServiceErrorReason,
  cause?: unknown,
): never {
  throw new ManagedEvidencePublicationPlanningServiceError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
  );
}

function parseOptions(value: unknown): Readonly<ParsedOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error);
    throw error;
  }
  if (
    Object.keys(record).some(
      (key) => key !== "clock" && key !== "signal" && key !== "uuidFactory",
    ) ||
    (record.clock !== undefined &&
      (typeof record.clock !== "function" || types.isProxy(record.clock))) ||
    (record.uuidFactory !== undefined &&
      (typeof record.uuidFactory !== "function" ||
        types.isProxy(record.uuidFactory))) ||
    (record.signal !== undefined &&
      (typeof record.signal !== "object" ||
        record.signal === null ||
        types.isProxy(record.signal) ||
        !(record.signal instanceof AbortSignal)))
  ) {
    fail("input");
  }
  return Object.freeze({
    clock: record.clock as UtcWallClock | undefined,
    uuidFactory: record.uuidFactory as UuidV4Factory | undefined,
    signal: record.signal as AbortSignal | undefined,
  });
}

function allocateId<K extends "demand-event" | "demand-event-commit">(
  kind: K,
  uuidFactory: UuidV4Factory | undefined,
): WakeflowDurableId<K> {
  try {
    return createWakeflowDurableId(
      kind,
      uuidFactory === undefined ? undefined : createUuidV4(uuidFactory),
    );
  } catch (error: unknown) {
    if (error instanceof UuidV4Error) fail("identity", error);
    throw error;
  }
}

export class ManagedEvidencePublicationPlanningService {
  readonly #workspaceRoot: RootedDirectory;

  constructor(workspaceRoot: RootedDirectory) {
    if (
      typeof workspaceRoot !== "object" ||
      workspaceRoot === null ||
      types.isProxy(workspaceRoot) ||
      !(workspaceRoot instanceof RootedDirectory)
    ) {
      fail("input");
    }
    this.#workspaceRoot = workspaceRoot;
  }

  /** 返回完整、可确认且零持久副作用的Publication Transaction。 */
  async preview(
    demandIdValue: unknown,
    selectionValue: unknown,
    optionsValue: ManagedEvidencePublicationPlanningOptions = {},
  ): Promise<Readonly<ManagedEvidencePublicationPlan>> {
    const options = parseOptions(optionsValue);
    let capturePlan;
    try {
      capturePlan = await new ManagedEvidenceCapturePlanningService(
        this.#workspaceRoot,
      ).preview(demandIdValue, selectionValue, {
        ...(options.clock === undefined ? {} : { clock: options.clock }),
        ...(options.uuidFactory === undefined
          ? {}
          : { uuidFactory: options.uuidFactory }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    } catch (error: unknown) {
      if (error instanceof ManagedEvidenceCapturePlanningServiceError) {
        if (error.reason === "aborted") fail("aborted", error);
        fail("capture", error);
      }
      throw error;
    }
    let plan: Readonly<ManagedEvidencePublicationTransaction>;
    try {
      plan = createManagedEvidencePublicationTransaction({
        capturePlan,
        eventId: allocateId("demand-event", options.uuidFactory),
        commitId: allocateId("demand-event-commit", options.uuidFactory),
      });
    } catch (error: unknown) {
      if (error instanceof ManagedEvidencePublicationPlanningServiceError) {
        throw error;
      }
      if (error instanceof ManagedEvidencePublicationTransactionError) {
        fail("transaction", error);
      }
      throw error;
    }
    return Object.freeze({
      plan,
      planDigest: computeManagedEvidencePublicationTransactionDigest(plan),
    });
  }
}
