import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  computeDemandAuthorityDigest,
  parseDemandAuthority,
  DemandAuthorityError,
  type DemandAuthority,
} from "../demand/model/demand-authority.js";
import {
  parseDemandCompletion,
  DemandCompletionError,
  type DemandCompletion,
} from "./demand-completion.js";

/**
 * Wakeflow Governance / Lifecycle：Demand Completion preview/apply不可变计划。
 *
 * 计划冻结Completion、完整Demand Authority、Event/Commit身份和预期stream revision。
 * Authority进入计划是为了让已提交重试可重建原command digest，而不依赖后来Config、Ledger或TODO。
 */

const PLAN_KIND = "WakeflowDemandCompletionPlan" as const;
const PLAN_SCHEMA_VERSION = 1 as const;

export interface DemandCompletionPlan {
  readonly kind: typeof PLAN_KIND;
  readonly schemaVersion: typeof PLAN_SCHEMA_VERSION;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly expectedStreamRevision: number;
  readonly commitId: WakeflowDurableId<"demand-event-commit">;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly authority: Readonly<DemandAuthority>;
  readonly completion: Readonly<DemandCompletion>;
}

export type DemandCompletionPlanErrorReason =
  "input" | "identifier" | "position" | "authority" | "completion" | "relation";

const ERROR_MESSAGES = {
  input: "Demand Completion plan input is invalid.",
  identifier: "Demand Completion plan contains an invalid identity.",
  position: "Demand Completion plan contains an invalid stream position.",
  authority: "Demand Completion plan contains an invalid Demand Authority.",
  completion: "Demand Completion plan contains an invalid Completion.",
  relation: "Demand Completion plan fields do not close.",
} as const satisfies Readonly<Record<DemandCompletionPlanErrorReason, string>>;

/** Completion plan准入失败时返回的稳定、脱敏错误。 */
export class DemandCompletionPlanError extends Error {
  override readonly name = "DemandCompletionPlanError";
  readonly code = "wakeflow-demand-completion-plan" as const;
  readonly reason: DemandCompletionPlanErrorReason;
  readonly path: string;

  constructor(reason: DemandCompletionPlanErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const PLAN_FIELDS = Object.freeze([
  "authority",
  "commitId",
  "completion",
  "demandId",
  "eventId",
  "expectedStreamRevision",
  "kind",
  "schemaVersion",
] as const);
const DRAFT_FIELDS = Object.freeze([
  "authority",
  "commitId",
  "completion",
  "demandId",
  "eventId",
  "expectedStreamRevision",
] as const);

function fail(reason: DemandCompletionPlanErrorReason, path: string): never {
  throw new DemandCompletionPlanError(reason, path);
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
  path: string,
): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", path);
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== fields.length ||
    keys.some((key, index) => key !== fields[index])
  ) {
    fail("input", path);
  }
  return record;
}

function id<Kind extends "demand" | "demand-event" | "demand-event-commit">(
  value: unknown,
  kind: Kind,
  path: string,
): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
    throw error;
  }
}

/** 严格解析并闭合Completion、Authority和事件追加基线。 */
export function parseDemandCompletionPlan(
  value: unknown,
): Readonly<DemandCompletionPlan> {
  const record = exactRecord(value, PLAN_FIELDS, "$plan");
  if (
    record.kind !== PLAN_KIND ||
    record.schemaVersion !== PLAN_SCHEMA_VERSION
  ) {
    fail("input", "$plan");
  }
  if (
    !Number.isSafeInteger(record.expectedStreamRevision) ||
    (record.expectedStreamRevision as number) < 1
  ) {
    fail("position", "$/expectedStreamRevision");
  }
  let authority: Readonly<DemandAuthority>;
  let completion: Readonly<DemandCompletion>;
  try {
    authority = parseDemandAuthority(record.authority);
  } catch (error: unknown) {
    if (error instanceof DemandAuthorityError) fail("authority", "$/authority");
    throw error;
  }
  try {
    completion = parseDemandCompletion(record.completion);
  } catch (error: unknown) {
    if (error instanceof DemandCompletionError) {
      fail("completion", "$/completion");
    }
    throw error;
  }
  const demandId = id(record.demandId, "demand", "$/demandId");
  if (
    authority.demandId !== demandId ||
    (authority.testingDecision.mode !== "controller-only" &&
      authority.testingDecision.mode !== "real-environment") ||
    completion.testingMode !== authority.testingDecision.mode ||
    completion.demandId !== demandId ||
    completion.authorityDigest !== computeDemandAuthorityDigest(authority) ||
    completion.observedState.streamRevision !== record.expectedStreamRevision
  ) {
    fail("relation", "$plan");
  }
  return Object.freeze({
    kind: PLAN_KIND,
    schemaVersion: PLAN_SCHEMA_VERSION,
    demandId,
    expectedStreamRevision: record.expectedStreamRevision as number,
    commitId: id(record.commitId, "demand-event-commit", "$/commitId"),
    eventId: id(record.eventId, "demand-event", "$/eventId"),
    authority,
    completion,
  });
}

export function createDemandCompletionPlan(
  value: unknown,
): Readonly<DemandCompletionPlan> {
  const record = exactRecord(value, DRAFT_FIELDS, "$draft");
  return parseDemandCompletionPlan({
    kind: PLAN_KIND,
    schemaVersion: PLAN_SCHEMA_VERSION,
    demandId: record.demandId,
    expectedStreamRevision: record.expectedStreamRevision,
    commitId: record.commitId,
    eventId: record.eventId,
    authority: record.authority,
    completion: record.completion,
  });
}

export function computeDemandCompletionPlanDigest(
  value: unknown,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(parseDemandCompletionPlan(value));
}
