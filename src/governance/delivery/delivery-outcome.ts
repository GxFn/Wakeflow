import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import {
  WAKEFLOW_DELIVERY_OUTCOME_SCHEMA,
  type WakeflowDeliveryOutcome as DeliveryOutcomeWire,
} from "../../contracts/generated/governance/delivery/delivery-outcome.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import { WAKEFLOW_TASK_PACKAGE_SCHEMA } from "../../contracts/generated/governance/tasking/task-package.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest, Sha256Error, type Sha256Digest } from "../../foundation/crypto/sha256.js";
import { parseJsonValue, JsonValueError, type JsonValue } from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import { parseUtcInstant, UtcInstantError, type UtcInstant } from "../../foundation/time/utc-instant.js";
import type { DeliveryFenceReference } from "./delivery-envelope.js";

/**
 * Wakeflow Governance / Delivery：一次投递代际的宿主效果处置记录（能力卡 6 修订）。
 *
 * 处置由 Wakeflow 按证据派生，不由 Agent 自称：accepted 只来自目标会话的
 * `user-prompt-submit` hook 记录、Codex 宿主发送调用的成功返回或 Controller 对
 * indeterminate 的显式解决；rejected-before-send 只用于发送调用本身失败且未触碰目标会话，
 * 立即释放声明；其余为 indeterminate，保留声明。回读是补充观察，缺失或超时不降级。
 */

const OUTCOME_KIND = "WakeflowDeliveryOutcome" as const;
const OUTCOME_SCHEMA_VERSION = 1 as const;

/** ambiguous 静默阈值：签发后十分钟无落地记录即 silent（ADR-0012 未决数值，先作常量；status 的 policy 段原样报告）。 */
export const DELIVERY_LANDING_SILENCE_MILLISECONDS = 10 * 60 * 1000;

export type DeliveryDisposition = "accepted" | "indeterminate" | "rejected-before-send";
export type DeliveryEvidenceKind =
  | "hook-record"
  | "host-send-return"
  | "agent-declaration"
  | "controller-resolution";
export type DeliveryAttemptStatus = "sent" | "failed-before-send" | "unknown";
export type DeliveryReadbackStatus = "confirmed" | "pending" | "unavailable";

export interface DeliveryOutcome {
  readonly kind: typeof OUTCOME_KIND;
  readonly schemaVersion: typeof OUTCOME_SCHEMA_VERSION;
  readonly deliveryId: WakeflowDurableId<"target-delivery">;
  readonly generation: number;
  readonly fence: Readonly<DeliveryFenceReference>;
  readonly disposition: DeliveryDisposition;
  readonly attempt: Readonly<{
    readonly status: DeliveryAttemptStatus;
    readonly evidenceDigest: Sha256Digest | null;
  }>;
  readonly readback: Readonly<{
    readonly status: DeliveryReadbackStatus;
    readonly evidenceDigest: Sha256Digest | null;
  }>;
  readonly evidence: Readonly<{
    readonly kind: DeliveryEvidenceKind;
    readonly hookRecordId: string | null;
    readonly rationale: string | null;
  }>;
  readonly claimHandling: "retain" | "release-authorized";
  readonly observedAt: UtcInstant;
  readonly outcomeDigest: Sha256Digest;
}

export type DeliveryOutcomeDraft = Omit<
  DeliveryOutcome,
  "kind" | "schemaVersion" | "claimHandling" | "outcomeDigest"
>;

export type DeliveryOutcomeErrorReason = "json" | "schema" | "identifier" | "digest" | "time";

const ERROR_MESSAGES = {
  json: "Delivery Outcome is not passive JSON data.",
  schema: "Delivery Outcome does not satisfy its Schema.",
  identifier: "Delivery Outcome contains an invalid identity.",
  digest: "Delivery Outcome contains an invalid or inconsistent digest.",
  time: "Delivery Outcome contains an invalid time.",
} as const satisfies Readonly<Record<DeliveryOutcomeErrorReason, string>>;

export class DeliveryOutcomeError extends Error {
  override readonly name = "DeliveryOutcomeError";
  readonly code = "wakeflow-delivery-outcome" as const;
  readonly reason: DeliveryOutcomeErrorReason;
  readonly path: string;

  constructor(reason: DeliveryOutcomeErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<DeliveryOutcomeWire>(
  WAKEFLOW_DELIVERY_OUTCOME_SCHEMA,
  [
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_TASK_PACKAGE_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
  ],
);

function fail(reason: DeliveryOutcomeErrorReason, path: string): never {
  throw new DeliveryOutcomeError(reason, path);
}

function id<Kind extends "target-delivery" | "work-claim">(
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

function digest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path);
    throw error;
  }
}

function optionalDigest(value: unknown, path: string): Sha256Digest | null {
  return value === null ? null : digest(value, path);
}

function instant(value: unknown, path: string): UtcInstant {
  try {
    return parseUtcInstant(value, path);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", path);
    throw error;
  }
}

/** 处置对声明的处理是派生事实：只有 rejected-before-send 释放声明。 */
export function deliveryClaimHandling(
  disposition: DeliveryDisposition,
): DeliveryOutcome["claimHandling"] {
  return disposition === "rejected-before-send" ? "release-authorized" : "retain";
}

function outcomeBasis(value: Omit<DeliveryOutcome, "outcomeDigest">): Omit<DeliveryOutcome, "outcomeDigest"> {
  return Object.freeze({
    kind: OUTCOME_KIND,
    schemaVersion: OUTCOME_SCHEMA_VERSION,
    deliveryId: value.deliveryId,
    generation: value.generation,
    fence: Object.freeze({ claimId: value.fence.claimId, claimDigest: value.fence.claimDigest }),
    disposition: value.disposition,
    attempt: Object.freeze({
      status: value.attempt.status,
      evidenceDigest: value.attempt.evidenceDigest,
    }),
    readback: Object.freeze({
      status: value.readback.status,
      evidenceDigest: value.readback.evidenceDigest,
    }),
    evidence: Object.freeze({
      kind: value.evidence.kind,
      hookRecordId: value.evidence.hookRecordId,
      rationale: value.evidence.rationale,
    }),
    claimHandling: value.claimHandling,
    observedAt: value.observedAt,
  });
}

export function parseDeliveryOutcome(value: unknown): Readonly<DeliveryOutcome> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$outcome");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const validated = validateWire(json);
  if (!validated.ok) fail("schema", validated.path);
  const wire = validated.value;
  const basis = outcomeBasis({
    kind: OUTCOME_KIND,
    schemaVersion: OUTCOME_SCHEMA_VERSION,
    deliveryId: id(wire.deliveryId, "target-delivery", "$/deliveryId"),
    generation: wire.generation,
    fence: {
      claimId: id(wire.fence.claimId, "work-claim", "$/fence/claimId"),
      claimDigest: digest(wire.fence.claimDigest, "$/fence/claimDigest"),
    },
    disposition: wire.disposition,
    attempt: {
      status: wire.attempt.status,
      evidenceDigest: optionalDigest(wire.attempt.evidenceDigest, "$/attempt/evidenceDigest"),
    },
    readback: {
      status: wire.readback.status,
      evidenceDigest: optionalDigest(wire.readback.evidenceDigest, "$/readback/evidenceDigest"),
    },
    evidence: {
      kind: wire.evidence.kind,
      hookRecordId: wire.evidence.hookRecordId,
      rationale: wire.evidence.rationale,
    },
    claimHandling: wire.claimHandling,
    observedAt: instant(wire.observedAt, "$/observedAt"),
  });
  const outcomeDigest = digest(wire.outcomeDigest, "$/outcomeDigest");
  if (computeCanonicalJsonSha256Digest(basis) !== outcomeDigest) fail("digest", "$/outcomeDigest");
  return Object.freeze({ ...basis, outcomeDigest });
}

/** 从草稿封一份处置记录；声明处理由处置派生。 */
export function createDeliveryOutcome(draft: Readonly<DeliveryOutcomeDraft>): Readonly<DeliveryOutcome> {
  const basis = outcomeBasis({
    ...draft,
    kind: OUTCOME_KIND,
    schemaVersion: OUTCOME_SCHEMA_VERSION,
    claimHandling: deliveryClaimHandling(draft.disposition),
  });
  return parseDeliveryOutcome({ ...basis, outcomeDigest: computeCanonicalJsonSha256Digest(basis) });
}
