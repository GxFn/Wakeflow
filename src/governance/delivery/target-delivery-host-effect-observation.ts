import type { WakeflowTargetDeliveryHostEffectObservation as ObservationWire } from "../../contracts/generated/governance/delivery/target-delivery-host-effect-observation.generated.js";
import { WAKEFLOW_TARGET_DELIVERY_HOST_EFFECT_OBSERVATION_SCHEMA } from "../../contracts/generated/governance/delivery/target-delivery-host-effect-observation.generated.js";
import { WAKEFLOW_TARGET_DELIVERY_INTENT_SCHEMA } from "../../contracts/generated/governance/delivery/target-delivery-intent.generated.js";
import { WAKEFLOW_TEST_CARD_SCHEMA } from "../../contracts/generated/governance/testing/test-card.generated.js";
import { WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA } from "../../contracts/generated/governance/testing/test-execution-attempt.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_TASK_PACKAGE_SCHEMA } from "../../contracts/generated/governance/tasking/task-package.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import { WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA } from "../../contracts/generated/workspace/window-host-binding.generated.js";
import {
  createWakeflowDurableId,
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  CanonicalJsonError,
  encodeCanonicalJson,
} from "../../foundation/data/canonical-json.js";
import {
  DeterministicJsonDocumentError,
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
} from "../../foundation/data/deterministic-json-document.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import { parseUuidV4 } from "../../foundation/identity/uuid-v4.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../foundation/time/utc-instant.js";
import type { WakeflowWorkspaceHostId } from "../../workspace/workspace-host-resource-profile.js";
import {
  parseWakeflowWindowHostBindingId,
  WakeflowWindowHostBindingIdError,
  type WakeflowWindowHostBindingId,
} from "../../workspace/window-runtime/wakeflow-window-host-binding-id.js";
import type { TargetDeliveryAgentHostAction } from "./target-delivery-agent-host-action.js";
import type { TestDeliveryAgentHostAction } from "../testing/test-delivery-agent-host-action.js";
import {
  parseWindowWorkClaimId,
  WindowWorkClaimError,
  type WindowWorkClaimId,
} from "./window-work-claim.js";

/**
 * Wakeflow Governance / Delivery：一次目标投递宿主效果的 Agent 脱敏观察。
 *
 * 创建入口短暂接收宿主调用与 readback 的原始 JSON 结果，只保存各自的 Canonical
 * SHA-256 摘要。attempt 与 readback 相互独立；`sent-unconfirmed` 只由上层从
 * `accepted + pending/unavailable` 派生，不进入本记录。
 */

const OBSERVATION_KIND = "WakeflowTargetDeliveryHostEffectObservation" as const;
const OBSERVATION_SCHEMA_VERSION = 1 as const;
const OBSERVATION_SOURCE = "agent-host-effect-observation" as const;
const MAXIMUM_EVIDENCE_BYTES = 128 * 1024;
const WINDOW_WORK_CLAIM_ID_PREFIX = "window_work_claim_";

export type TargetDeliveryHostEffectAttemptStatus =
  "accepted" | "indeterminate" | "rejected-before-effect";

export type TargetDeliveryHostEffectReadback =
  | Readonly<{ readonly status: "unavailable" }>
  | Readonly<{
      readonly status: "confirmed" | "pending";
      readonly evidenceDigest: Sha256Digest;
    }>;

export type TargetDeliveryHostEffectDisposition =
  TargetDeliveryHostEffectAttemptStatus;

interface TargetDeliveryHostEffectObservationActionBase {
  readonly actionId: WindowWorkClaimId;
  readonly targetDeliveryId: WakeflowDurableId<"target-delivery">;
  readonly intentDigest: Sha256Digest;
  readonly hostId: WakeflowWorkspaceHostId;
  readonly windowId: WakeflowDurableId<"window">;
  readonly bindingId: WakeflowWindowHostBindingId;
  readonly claimDigest: Sha256Digest;
  readonly hostObservationAuthorityDigest: Sha256Digest;
  readonly claimEventId: WakeflowDurableId<"demand-event">;
  readonly claimCommitId: WakeflowDurableId<"demand-event-commit">;
  readonly claimEventStreamRevision: number;
  readonly claimExpectedStateDigest: Sha256Digest;
  readonly issuedAt: UtcInstant;
}

export interface ImplementationHostEffectObservationAction extends TargetDeliveryHostEffectObservationActionBase {
  readonly workType?: never;
}

export interface TestHostEffectObservationAction extends TargetDeliveryHostEffectObservationActionBase {
  readonly workType: "test";
  readonly testAttemptId: WakeflowDurableId<"test-attempt">;
  readonly testDispatchPacketDigest: Sha256Digest;
}

export type TargetDeliveryHostEffectObservationAction =
  ImplementationHostEffectObservationAction | TestHostEffectObservationAction;

export interface TargetDeliveryHostEffectObservation {
  readonly kind: typeof OBSERVATION_KIND;
  readonly schemaVersion: typeof OBSERVATION_SCHEMA_VERSION;
  readonly source: typeof OBSERVATION_SOURCE;
  readonly action: Readonly<TargetDeliveryHostEffectObservationAction>;
  readonly attempt: Readonly<{
    readonly status: TargetDeliveryHostEffectAttemptStatus;
    readonly evidenceDigest: Sha256Digest;
  }>;
  readonly readback: TargetDeliveryHostEffectReadback;
  readonly observedAt: UtcInstant;
  readonly observationDigest: Sha256Digest;
}

type CreateHostEffectObservationActionBase = Readonly<
  Pick<
    TargetDeliveryAgentHostAction,
    | "actionId"
    | "bindingId"
    | "hostId"
    | "intentDigest"
    | "issuedAt"
    | "targetDeliveryId"
    | "windowId"
  > & {
    readonly claimDigest: Sha256Digest;
    readonly hostObservationAuthorityDigest: Sha256Digest;
    readonly claimEventId: WakeflowDurableId<"demand-event">;
    readonly claimCommitId: WakeflowDurableId<"demand-event-commit">;
    readonly claimEventStreamRevision: number;
    readonly claimExpectedStateDigest: Sha256Digest;
  }
>;

export type CreateHostEffectObservationAction =
  | Readonly<
      CreateHostEffectObservationActionBase & {
        readonly workType?: never;
      }
    >
  | Readonly<
      CreateHostEffectObservationActionBase &
        Pick<TestDeliveryAgentHostAction, "testAttemptId"> & {
          readonly workType: "test";
          readonly testDispatchPacketDigest: Sha256Digest;
        }
    >;

export interface CreateTargetDeliveryHostEffectObservationInput {
  readonly action: CreateHostEffectObservationAction;
  readonly attempt: Readonly<{
    readonly status: TargetDeliveryHostEffectAttemptStatus;
    readonly evidence: unknown;
  }>;
  readonly readback:
    | Readonly<{ readonly status: "unavailable" }>
    | Readonly<{
        readonly status: "confirmed" | "pending";
        readonly evidence: unknown;
      }>;
  readonly observedAt: unknown;
}

export type TargetDeliveryHostEffectObservationErrorReason =
  | "input"
  | "evidence"
  | "capacity"
  | "schema"
  | "identifier"
  | "digest"
  | "time"
  | "relation"
  | "representation";

const ERROR_MESSAGES = {
  input: "Target Delivery Host Effect observation input is invalid.",
  evidence: "Target Delivery Host Effect evidence is not passive JSON data.",
  capacity: "Target Delivery Host Effect evidence exceeds its capacity.",
  schema:
    "Target Delivery Host Effect observation does not satisfy its Schema.",
  identifier:
    "Target Delivery Host Effect observation contains an invalid identity.",
  digest:
    "Target Delivery Host Effect observation contains an invalid or inconsistent digest.",
  time: "Target Delivery Host Effect observation contains an invalid time.",
  relation: "Target Delivery Host Effect observation facts are inconsistent.",
  representation:
    "Target Delivery Host Effect observation bytes are not deterministic.",
} as const satisfies Readonly<
  Record<TargetDeliveryHostEffectObservationErrorReason, string>
>;

/** 目标投递宿主效果观察准入、创建或表示失败时的稳定错误。 */
export class TargetDeliveryHostEffectObservationError extends Error {
  override readonly name = "TargetDeliveryHostEffectObservationError";
  readonly code = "wakeflow-target-delivery-host-effect-observation" as const;
  readonly reason: TargetDeliveryHostEffectObservationErrorReason;
  readonly path: string;

  constructor(
    reason: TargetDeliveryHostEffectObservationErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<ObservationWire>(
  WAKEFLOW_TARGET_DELIVERY_HOST_EFFECT_OBSERVATION_SCHEMA,
  [
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_TARGET_DELIVERY_INTENT_SCHEMA,
    WAKEFLOW_TASK_PACKAGE_SCHEMA,
    WAKEFLOW_TEST_CARD_SCHEMA,
    WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
    WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA,
  ],
);

function fail(
  reason: TargetDeliveryHostEffectObservationErrorReason,
  path: string,
): never {
  throw new TargetDeliveryHostEffectObservationError(reason, path);
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
  path: string,
): Readonly<Record<string, unknown>> {
  const record = passiveRecord(value, path);
  const keys = Object.keys(record).sort();
  const expected = [...fields].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    fail("input", path);
  }
  return record;
}

function passiveRecord(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  try {
    return parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error.path);
    throw error;
  }
}

function durableId<
  Kind extends
    | "target-delivery"
    | "window"
    | "demand-event"
    | "demand-event-commit"
    | "test-attempt",
>(value: unknown, kind: Kind, path: string): WakeflowDurableId<Kind> {
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

function instant(value: unknown, path: string): UtcInstant {
  try {
    return parseUtcInstant(value, path);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", path);
    throw error;
  }
}

function bindingId(value: unknown, path: string): WakeflowWindowHostBindingId {
  try {
    return parseWakeflowWindowHostBindingId(value, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostBindingIdError) {
      fail("identifier", path);
    }
    throw error;
  }
}

function claimId(value: unknown, path: string): WindowWorkClaimId {
  try {
    return parseWindowWorkClaimId(value, path);
  } catch (error: unknown) {
    if (error instanceof WindowWorkClaimError) fail("identifier", path);
    throw error;
  }
}

function evidenceDigest(value: unknown, path: string): Sha256Digest {
  let evidence: JsonValue;
  try {
    evidence = parseJsonValue(value, path);
    if (
      encodeCanonicalJson(evidence, path).byteLength > MAXIMUM_EVIDENCE_BYTES
    ) {
      fail("capacity", path);
    }
    return computeCanonicalJsonSha256Digest(evidence, path);
  } catch (error: unknown) {
    if (error instanceof TargetDeliveryHostEffectObservationError) throw error;
    if (
      error instanceof JsonValueError ||
      error instanceof CanonicalJsonError
    ) {
      fail("evidence", path);
    }
    throw error;
  }
}

function observationBasis(
  value: Omit<TargetDeliveryHostEffectObservation, "observationDigest">,
): Omit<TargetDeliveryHostEffectObservation, "observationDigest"> {
  return {
    kind: OBSERVATION_KIND,
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    source: OBSERVATION_SOURCE,
    action: value.action,
    attempt: value.attempt,
    readback: value.readback,
    observedAt: value.observedAt,
  };
}

/** 严格解析脱敏观察，并复验时间、状态矩阵和不包含自身的摘要。 */
export function parseTargetDeliveryHostEffectObservation(
  value: unknown,
): Readonly<TargetDeliveryHostEffectObservation> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$observation");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("input", error.path);
    throw error;
  }
  const validated = validateWire(json);
  if (!validated.ok) fail("schema", validated.path);
  const wire = validated.value;
  const actionBase = {
    actionId: claimId(wire.action.actionId, "$/action/actionId"),
    targetDeliveryId: durableId(
      wire.action.targetDeliveryId,
      "target-delivery",
      "$/action/targetDeliveryId",
    ),
    intentDigest: digest(wire.action.intentDigest, "$/action/intentDigest"),
    hostId: wire.action.hostId,
    windowId: durableId(wire.action.windowId, "window", "$/action/windowId"),
    bindingId: bindingId(wire.action.bindingId, "$/action/bindingId"),
    claimDigest: digest(wire.action.claimDigest, "$/action/claimDigest"),
    hostObservationAuthorityDigest: digest(
      wire.action.hostObservationAuthorityDigest,
      "$/action/hostObservationAuthorityDigest",
    ),
    claimEventId: durableId(
      wire.action.claimEventId,
      "demand-event",
      "$/action/claimEventId",
    ),
    claimCommitId: durableId(
      wire.action.claimCommitId,
      "demand-event-commit",
      "$/action/claimCommitId",
    ),
    claimEventStreamRevision: wire.action.claimEventStreamRevision,
    claimExpectedStateDigest: digest(
      wire.action.claimExpectedStateDigest,
      "$/action/claimExpectedStateDigest",
    ),
    issuedAt: instant(wire.action.issuedAt, "$/action/issuedAt"),
  } as const;
  const action: Readonly<TargetDeliveryHostEffectObservationAction> =
    "workType" in wire.action
      ? Object.freeze({
          ...actionBase,
          workType: "test" as const,
          testAttemptId: durableId(
            wire.action.testAttemptId,
            "test-attempt",
            "$/action/testAttemptId",
          ),
          testDispatchPacketDigest: digest(
            wire.action.testDispatchPacketDigest,
            "$/action/testDispatchPacketDigest",
          ),
        })
      : Object.freeze(actionBase);
  const basis = observationBasis({
    kind: OBSERVATION_KIND,
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    source: OBSERVATION_SOURCE,
    action,
    attempt: Object.freeze({
      status: wire.attempt.status,
      evidenceDigest: digest(
        wire.attempt.evidenceDigest,
        "$/attempt/evidenceDigest",
      ),
    }),
    readback:
      wire.readback.status === "unavailable"
        ? Object.freeze({ status: "unavailable" as const })
        : Object.freeze({
            status: wire.readback.status,
            evidenceDigest: digest(
              wire.readback.evidenceDigest,
              "$/readback/evidenceDigest",
            ),
          }),
    observedAt: instant(wire.observedAt, "$/observedAt"),
  });
  // observedAt 是来源时钟给出的审计事实；Action、Claim 与 Observation 的因果关系
  // 由精确引用的身份、摘要、Event 修订和 CAS 状态建立，不能由跨来源墙钟排序推断。
  if (
    basis.attempt.status === "rejected-before-effect" &&
    basis.readback.status !== "unavailable"
  ) {
    fail("relation", "$observation");
  }
  const observationDigest = digest(
    wire.observationDigest,
    "$/observationDigest",
  );
  if (computeCanonicalJsonSha256Digest(basis) !== observationDigest) {
    fail("digest", "$/observationDigest");
  }
  return Object.freeze({ ...basis, observationDigest });
}

/**
 * 从瞬时宿主结果创建脱敏观察；原始 evidence 只参与容量检查和摘要计算。
 */
export function createTargetDeliveryHostEffectObservation(
  inputValue: unknown,
): Readonly<TargetDeliveryHostEffectObservation> {
  const input = exactRecord(
    inputValue,
    ["action", "attempt", "readback", "observedAt"],
    "$input",
  );
  const actionValue = passiveRecord(input.action, "$/action");
  const actionFields = [
    "actionId",
    "bindingId",
    "claimDigest",
    "claimEventId",
    "claimCommitId",
    "claimEventStreamRevision",
    "claimExpectedStateDigest",
    "hostId",
    "hostObservationAuthorityDigest",
    "intentDigest",
    "issuedAt",
    "targetDeliveryId",
    "windowId",
  ];
  const action = exactRecord(
    actionValue,
    actionValue.workType === "test"
      ? [
          ...actionFields,
          "testAttemptId",
          "testDispatchPacketDigest",
          "workType",
        ]
      : actionFields,
    "$/action",
  );
  const attempt = exactRecord(
    input.attempt,
    ["status", "evidence"],
    "$/attempt",
  );
  if (
    attempt.status !== "accepted" &&
    attempt.status !== "indeterminate" &&
    attempt.status !== "rejected-before-effect"
  ) {
    fail("input", "$/attempt/status");
  }
  if (action.hostId !== "codex" && action.hostId !== "claude-code") {
    fail("input", "$/action/hostId");
  }
  if (
    !Number.isSafeInteger(action.claimEventStreamRevision) ||
    (action.claimEventStreamRevision as number) < 4
  ) {
    fail("input", "$/action/claimEventStreamRevision");
  }
  const normalizedActionBase = {
    actionId: claimId(action.actionId, "$/action/actionId"),
    targetDeliveryId: durableId(
      action.targetDeliveryId,
      "target-delivery",
      "$/action/targetDeliveryId",
    ),
    intentDigest: digest(action.intentDigest, "$/action/intentDigest"),
    hostId: action.hostId,
    windowId: durableId(action.windowId, "window", "$/action/windowId"),
    bindingId: bindingId(action.bindingId, "$/action/bindingId"),
    claimDigest: digest(action.claimDigest, "$/action/claimDigest"),
    hostObservationAuthorityDigest: digest(
      action.hostObservationAuthorityDigest,
      "$/action/hostObservationAuthorityDigest",
    ),
    claimEventId: durableId(
      action.claimEventId,
      "demand-event",
      "$/action/claimEventId",
    ),
    claimCommitId: durableId(
      action.claimCommitId,
      "demand-event-commit",
      "$/action/claimCommitId",
    ),
    claimEventStreamRevision: action.claimEventStreamRevision as number,
    claimExpectedStateDigest: digest(
      action.claimExpectedStateDigest,
      "$/action/claimExpectedStateDigest",
    ),
    issuedAt: instant(action.issuedAt, "$/action/issuedAt"),
  } as const;
  const normalizedAction: Readonly<TargetDeliveryHostEffectObservationAction> =
    action.workType === "test"
      ? Object.freeze({
          ...normalizedActionBase,
          workType: "test" as const,
          testAttemptId: durableId(
            action.testAttemptId,
            "test-attempt",
            "$/action/testAttemptId",
          ),
          testDispatchPacketDigest: digest(
            action.testDispatchPacketDigest,
            "$/action/testDispatchPacketDigest",
          ),
        })
      : Object.freeze(normalizedActionBase);
  const readbackRecord = passiveRecord(input.readback, "$/readback");
  const readback =
    readbackRecord.status === "unavailable"
      ? (() => {
          exactRecord(readbackRecord, ["status"], "$/readback");
          return { status: "unavailable" as const };
        })()
      : (() => {
          const observed = exactRecord(
            readbackRecord,
            ["status", "evidence"],
            "$/readback",
          );
          if (
            observed.status !== "confirmed" &&
            observed.status !== "pending"
          ) {
            fail("input", "$/readback/status");
          }
          return {
            status: observed.status,
            evidenceDigest: evidenceDigest(
              observed.evidence,
              "$/readback/evidence",
            ),
          } as const;
        })();
  const basis = {
    kind: OBSERVATION_KIND,
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    source: OBSERVATION_SOURCE,
    action: normalizedAction,
    attempt: {
      status: attempt.status,
      evidenceDigest: evidenceDigest(attempt.evidence, "$/attempt/evidence"),
    },
    readback,
    observedAt: instant(input.observedAt, "$/observedAt"),
  };
  return parseTargetDeliveryHostEffectObservation({
    ...basis,
    observationDigest: computeCanonicalJsonSha256Digest(basis),
  });
}

/** readback confirmed 可以把无确定调用回执的 attempt 提升为 accepted。 */
export function targetDeliveryHostEffectDisposition(
  value: unknown,
): TargetDeliveryHostEffectDisposition {
  const observation = parseTargetDeliveryHostEffectObservation(value);
  return observation.readback.status === "confirmed"
    ? "accepted"
    : observation.attempt.status;
}

function observationUuid(value: unknown) {
  const parsed = claimId(value, "$actionId");
  return parseUuidV4(parsed.slice(WINDOW_WORK_CLAIM_ID_PREFIX.length));
}

/** 从唯一 Action/Claim 身份派生 outcome Event 的稳定幂等身份。 */
export function targetDeliveryHostEffectObservationEventId(
  actionId: unknown,
): WakeflowDurableId<"demand-event"> {
  return createWakeflowDurableId("demand-event", observationUuid(actionId));
}

/** 从唯一 Action/Claim 身份派生 outcome Commit 的稳定幂等身份。 */
export function targetDeliveryHostEffectObservationCommitId(
  actionId: unknown,
): WakeflowDurableId<"demand-event-commit"> {
  return createWakeflowDurableId(
    "demand-event-commit",
    observationUuid(actionId),
  );
}

/** 将脱敏观察渲染为唯一的确定性 JSON 文档。 */
export function renderTargetDeliveryHostEffectObservation(
  value: unknown,
): string {
  return renderDeterministicJsonDocument(
    parseTargetDeliveryHostEffectObservation(value),
    "$observation",
  );
}

/** 只接受与领域渲染逐字节相同的脱敏观察文档。 */
export function parseTargetDeliveryHostEffectObservationDocument(
  text: unknown,
): Readonly<TargetDeliveryHostEffectObservation> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(text, "$observation");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", "$observation");
    }
    throw error;
  }
  const observation = parseTargetDeliveryHostEffectObservation(json);
  if (renderTargetDeliveryHostEffectObservation(observation) !== text) {
    fail("representation", "$observation");
  }
  return observation;
}

/** 返回脱敏观察自身声明并复验过的 Canonical 摘要。 */
export function computeTargetDeliveryHostEffectObservationDigest(
  value: unknown,
): Sha256Digest {
  return parseTargetDeliveryHostEffectObservation(value).observationDigest;
}
