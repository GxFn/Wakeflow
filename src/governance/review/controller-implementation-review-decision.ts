import type { WakeflowControllerImplementationReviewDecision as DecisionWire } from "../../contracts/generated/governance/review/controller-implementation-review-decision.generated.js";
import { WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_SCHEMA } from "../../contracts/generated/governance/review/controller-implementation-review-decision.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_TASK_PACKAGE_SCHEMA } from "../../contracts/generated/governance/tasking/task-package.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
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
  createUuidV4,
  parseUuidV4,
  UuidV4Error,
  type UuidV4Factory,
} from "../../foundation/identity/uuid-v4.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../foundation/time/utc-instant.js";
import {
  readUtcWallClock,
  UtcWallClockError,
  type UtcWallClock,
} from "../../foundation/time/wall-clock.js";
import {
  parseDemandEventStreamRevision,
  DemandEventStreamPositionError,
  type DemandEventStreamRevision,
} from "../demand/event-sourcing/demand-event-stream-position.js";
import type {
  ControllerIndependentReviewCheck,
  ControllerReviewedTargetResult,
} from "./controller-review-decision-contract.js";

/**
 * Wakeflow Governance / Review：Controller对一份精确TargetResult作出的审查决定。
 *
 * 本记录保存决定主体、被审查的Snapshot/Result并发基线、Controller独立检查和最终
 * 业务意图。它不保存ReviewCandidate，不把Target Report当成事实，也不执行后续重派、
 * Design路由、Demand完成或宿主效果。
 */

const DECISION_KIND = "WakeflowControllerImplementationReviewDecision" as const;
const DECISION_SCHEMA_VERSION = 1 as const;
const DECISION_ID_PREFIX = "target-review-decision_";
const CHECK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;

export type ControllerImplementationReviewDecisionType =
  "accept" | "blocked" | "redesign" | "rework";

export type ControllerRequirementAlignment =
  "aligned" | "mismatch" | "unresolved";

export type ControllerImplementationQuality =
  "satisfactory" | "defective" | "unverified";

/** 不含身份、Review基线和时间的Controller审查判断内容。 */
export interface ControllerImplementationReviewJudgment {
  readonly decision: ControllerImplementationReviewDecisionType;
  readonly assessment: Readonly<{
    readonly requirementAlignment: ControllerRequirementAlignment;
    readonly implementationQuality: ControllerImplementationQuality;
  }>;
  readonly independentChecks: readonly [
    Readonly<ControllerIndependentReviewCheck>,
    ...Readonly<ControllerIndependentReviewCheck>[],
  ];
  readonly rationale: string;
  readonly blockingReasons: readonly string[];
  readonly residualRisks: readonly string[];
}

export interface ControllerImplementationReviewDecision extends ControllerImplementationReviewJudgment {
  readonly kind: typeof DECISION_KIND;
  readonly schemaVersion: typeof DECISION_SCHEMA_VERSION;
  readonly targetReviewDecisionId: WakeflowDurableId<"target-review-decision">;
  readonly programId: WakeflowDurableId<"program">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly controllerWindowId: WakeflowDurableId<"window">;
  readonly reviewed: Readonly<ControllerReviewedTargetResult>;
  readonly decidedAt: UtcInstant;
  readonly decisionDigest: Sha256Digest;
}

export type CreateControllerImplementationReviewDecisionInput = Omit<
  ControllerImplementationReviewDecision,
  | "kind"
  | "schemaVersion"
  | "targetReviewDecisionId"
  | "decidedAt"
  | "decisionDigest"
>;

export interface CreateControllerImplementationReviewDecisionOptions {
  readonly clock?: UtcWallClock;
  readonly uuidFactory?: UuidV4Factory;
}

export type ControllerImplementationReviewDecisionErrorReason =
  | "json"
  | "schema"
  | "identifier"
  | "digest"
  | "position"
  | "time"
  | "text"
  | "relation"
  | "representation";

const ERROR_MESSAGES = {
  json: "Controller Implementation Review Decision is not passive JSON data.",
  schema:
    "Controller Implementation Review Decision does not satisfy its Schema.",
  identifier:
    "Controller Implementation Review Decision contains an invalid identity.",
  digest:
    "Controller Implementation Review Decision contains an invalid or inconsistent digest.",
  position:
    "Controller Implementation Review Decision contains an invalid Event Stream position.",
  time: "Controller Implementation Review Decision contains an invalid decision time.",
  text: "Controller Implementation Review Decision contains invalid review text.",
  relation: "Controller Implementation Review Decision facts are inconsistent.",
  representation:
    "Controller Implementation Review Decision bytes are not deterministic.",
} as const satisfies Readonly<
  Record<ControllerImplementationReviewDecisionErrorReason, string>
>;

/** Controller审查决定准入、创建或确定性表示失败时的稳定错误。 */
export class ControllerImplementationReviewDecisionError extends Error {
  override readonly name = "ControllerImplementationReviewDecisionError";
  readonly code = "wakeflow-controller-implementation-review-decision" as const;
  readonly reason: ControllerImplementationReviewDecisionErrorReason;
  readonly path: string;

  constructor(
    reason: ControllerImplementationReviewDecisionErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<DecisionWire>(
  WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_SCHEMA,
  [
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_TASK_PACKAGE_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
  ],
);

function fail(
  reason: ControllerImplementationReviewDecisionErrorReason,
  path: string,
): never {
  throw new ControllerImplementationReviewDecisionError(reason, path);
}

function id<
  Kind extends
    | "target-review-decision"
    | "program"
    | "demand"
    | "target-task"
    | "window"
    | "task-package"
    | "target-result",
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

function streamRevision(
  value: unknown,
  path: string,
): DemandEventStreamRevision {
  try {
    return parseDemandEventStreamRevision(value, path);
  } catch (error: unknown) {
    if (error instanceof DemandEventStreamPositionError) {
      fail("position", path);
    }
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

function humanText(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 8192 ||
    !value.isWellFormed() ||
    value.normalize("NFC") !== value ||
    value.trim() !== value ||
    CONTROL_EXCEPT_LF_PATTERN.test(value)
  ) {
    fail("text", path);
  }
  return value;
}

function checkId(value: unknown, path: string): string {
  if (typeof value !== "string" || !CHECK_ID_PATTERN.test(value)) {
    fail("text", path);
  }
  return value;
}

function textList(values: readonly unknown[], path: string): readonly string[] {
  const admitted = values.map((value, index) =>
    humanText(value, `${path}/${index}`),
  );
  if (new Set(admitted).size !== admitted.length) fail("relation", path);
  return Object.freeze(admitted);
}

function decisionBasis(
  value: Omit<ControllerImplementationReviewDecision, "decisionDigest">,
): Omit<ControllerImplementationReviewDecision, "decisionDigest"> {
  return {
    kind: DECISION_KIND,
    schemaVersion: DECISION_SCHEMA_VERSION,
    targetReviewDecisionId: value.targetReviewDecisionId,
    programId: value.programId,
    demandId: value.demandId,
    targetTaskId: value.targetTaskId,
    controllerWindowId: value.controllerWindowId,
    reviewed: value.reviewed,
    decision: value.decision,
    assessment: value.assessment,
    independentChecks: value.independentChecks,
    rationale: value.rationale,
    blockingReasons: value.blockingReasons,
    residualRisks: value.residualRisks,
    decidedAt: value.decidedAt,
  };
}

/** 严格解析并复验一份Controller单Target审查决定。 */
export function parseControllerImplementationReviewDecision(
  value: unknown,
): Readonly<ControllerImplementationReviewDecision> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$decision");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const validated = validateWire(json);
  if (!validated.ok) fail("schema", validated.path);
  const wire = validated.value;
  const checks = wire.independentChecks.map((check, index) =>
    Object.freeze({
      checkId: checkId(check.checkId, `$/independentChecks/${index}/checkId`),
      method: humanText(check.method, `$/independentChecks/${index}/method`),
      outcome: check.outcome,
      observation: humanText(
        check.observation,
        `$/independentChecks/${index}/observation`,
      ),
    }),
  );
  if (new Set(checks.map((check) => check.checkId)).size !== checks.length) {
    fail("relation", "$/independentChecks");
  }
  const firstCheck = checks[0];
  if (firstCheck === undefined) fail("schema", "$/independentChecks");
  const reviewed = Object.freeze({
    snapshotDigest: digest(
      wire.reviewed.snapshotDigest,
      "$/reviewed/snapshotDigest",
    ),
    reviewUnitDigest: digest(
      wire.reviewed.reviewUnitDigest,
      "$/reviewed/reviewUnitDigest",
    ),
    stateDigest: digest(wire.reviewed.stateDigest, "$/reviewed/stateDigest"),
    streamRevision: streamRevision(
      wire.reviewed.streamRevision,
      "$/reviewed/streamRevision",
    ),
    taskPackageId: id(
      wire.reviewed.taskPackageId,
      "task-package",
      "$/reviewed/taskPackageId",
    ),
    taskPackageDigest: digest(
      wire.reviewed.taskPackageDigest,
      "$/reviewed/taskPackageDigest",
    ),
    targetResultId: id(
      wire.reviewed.targetResultId,
      "target-result",
      "$/reviewed/targetResultId",
    ),
    targetResultDigest: digest(
      wire.reviewed.targetResultDigest,
      "$/reviewed/targetResultDigest",
    ),
    targetResultOutcome: wire.reviewed.targetResultOutcome,
    targetResultReportedAt: instant(
      wire.reviewed.targetResultReportedAt,
      "$/reviewed/targetResultReportedAt",
    ),
  });
  const basis = decisionBasis({
    kind: DECISION_KIND,
    schemaVersion: DECISION_SCHEMA_VERSION,
    targetReviewDecisionId: id(
      wire.targetReviewDecisionId,
      "target-review-decision",
      "$/targetReviewDecisionId",
    ),
    programId: id(wire.programId, "program", "$/programId"),
    demandId: id(wire.demandId, "demand", "$/demandId"),
    targetTaskId: id(wire.targetTaskId, "target-task", "$/targetTaskId"),
    controllerWindowId: id(
      wire.controllerWindowId,
      "window",
      "$/controllerWindowId",
    ),
    reviewed,
    decision: wire.decision,
    assessment: Object.freeze({
      requirementAlignment: wire.assessment.requirementAlignment,
      implementationQuality: wire.assessment.implementationQuality,
    }),
    independentChecks: Object.freeze([firstCheck, ...checks.slice(1)]),
    rationale: humanText(wire.rationale, "$/rationale"),
    blockingReasons: textList(wire.blockingReasons, "$/blockingReasons"),
    residualRisks: textList(wire.residualRisks, "$/residualRisks"),
    decidedAt: instant(wire.decidedAt, "$/decidedAt"),
  });
  const decisionDigest = digest(wire.decisionDigest, "$/decisionDigest");
  if (computeCanonicalJsonSha256Digest(basis) !== decisionDigest) {
    fail("digest", "$/decisionDigest");
  }
  return Object.freeze({ ...basis, decisionDigest });
}

/** 从Controller陈述、墙上时钟和单个新UUID创建审查决定。 */
export function createControllerImplementationReviewDecision(
  input: Readonly<CreateControllerImplementationReviewDecisionInput>,
  options: CreateControllerImplementationReviewDecisionOptions = {},
): Readonly<ControllerImplementationReviewDecision> {
  let targetReviewDecisionId: WakeflowDurableId<"target-review-decision">;
  try {
    targetReviewDecisionId = createWakeflowDurableId(
      "target-review-decision",
      createUuidV4(options.uuidFactory),
    );
  } catch (error: unknown) {
    if (
      error instanceof UuidV4Error ||
      error instanceof WakeflowDurableIdError
    ) {
      fail("identifier", "$uuidFactory");
    }
    throw error;
  }
  let decidedAt: UtcInstant;
  try {
    decidedAt =
      options.clock === undefined
        ? readUtcWallClock()
        : readUtcWallClock(options.clock);
  } catch (error: unknown) {
    if (error instanceof UtcWallClockError) fail("time", "$clock");
    throw error;
  }
  const basis = decisionBasis({
    kind: DECISION_KIND,
    schemaVersion: DECISION_SCHEMA_VERSION,
    targetReviewDecisionId,
    programId: input.programId,
    demandId: input.demandId,
    targetTaskId: input.targetTaskId,
    controllerWindowId: input.controllerWindowId,
    reviewed: input.reviewed,
    decision: input.decision,
    assessment: input.assessment,
    independentChecks: input.independentChecks,
    rationale: input.rationale,
    blockingReasons: input.blockingReasons,
    residualRisks: input.residualRisks,
    decidedAt,
  });
  return parseControllerImplementationReviewDecision({
    ...basis,
    decisionDigest: computeCanonicalJsonSha256Digest(basis),
  });
}

function uuidFromDecisionId(value: string) {
  return parseUuidV4(value.slice(DECISION_ID_PREFIX.length));
}

/** Decision Event与决定共享UUID，但保留独立typed namespace。 */
export function controllerImplementationReviewDecisionEventId(
  value: unknown,
): WakeflowDurableId<"demand-event"> {
  const decision = parseControllerImplementationReviewDecision(value);
  return createWakeflowDurableId(
    "demand-event",
    uuidFromDecisionId(decision.targetReviewDecisionId),
  );
}

/** Decision Commit与决定共享UUID，但保留独立typed namespace。 */
export function controllerImplementationReviewDecisionCommitId(
  value: unknown,
): WakeflowDurableId<"demand-event-commit"> {
  const decision = parseControllerImplementationReviewDecision(value);
  return createWakeflowDurableId(
    "demand-event-commit",
    uuidFromDecisionId(decision.targetReviewDecisionId),
  );
}

export function renderControllerImplementationReviewDecision(
  value: unknown,
): string {
  return renderDeterministicJsonDocument(
    parseControllerImplementationReviewDecision(value),
    "$decision",
  );
}

export function parseControllerImplementationReviewDecisionDocument(
  text: unknown,
): Readonly<ControllerImplementationReviewDecision> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(text, "$decision");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", "$decision");
    }
    throw error;
  }
  const decision = parseControllerImplementationReviewDecision(json);
  if (renderControllerImplementationReviewDecision(decision) !== text) {
    fail("representation", "$decision");
  }
  return decision;
}
