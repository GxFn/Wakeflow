import type { WakeflowControllerTestReviewDecision as DecisionWire } from "../../contracts/generated/governance/review/controller-test-review-decision.generated.js";
import { WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_SCHEMA } from "../../contracts/generated/governance/review/controller-test-review-decision.generated.js";
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
} from "../demand/event-sourcing/demand-event-stream-position.js";
import type {
  ControllerIndependentReviewCheck,
  ControllerReviewedTargetResult,
} from "./controller-review-decision-contract.js";

/**
 * Controller对一份精确Test TargetResult作出的不可变审查决定。
 *
 * Decision记录Controller conclusion与后续授权，不执行下一attempt、产品修复或Demand
 * completion。Result的completed也不能替代本记录中的独立检查。
 */

const DECISION_KIND = "WakeflowControllerTestReviewDecision" as const;
const DECISION_SCHEMA_VERSION = 1 as const;
const DECISION_ID_PREFIX = "target-review-decision_";
const CHECK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;

export type ControllerTestReviewDecisionType =
  "accept" | "request-another-attempt" | "escalate-product-defect" | "blocked";

export type ControllerTestConclusion =
  "satisfied" | "defect-observed" | "inconclusive";

export type ControllerTestEvidenceSufficiency = "sufficient" | "insufficient";

export interface ControllerTestReviewJudgment {
  readonly decision: ControllerTestReviewDecisionType;
  readonly assessment: Readonly<{
    readonly conclusion: ControllerTestConclusion;
    readonly evidenceSufficiency: ControllerTestEvidenceSufficiency;
  }>;
  readonly independentChecks: readonly [
    Readonly<ControllerIndependentReviewCheck>,
    ...Readonly<ControllerIndependentReviewCheck>[],
  ];
  readonly rationale: string;
  readonly blockingReasons: readonly string[];
  readonly residualRisks: readonly string[];
}

export interface ControllerTestReviewDecision extends ControllerTestReviewJudgment {
  readonly kind: typeof DECISION_KIND;
  readonly schemaVersion: typeof DECISION_SCHEMA_VERSION;
  readonly targetReviewDecisionId: WakeflowDurableId<"target-review-decision">;
  readonly programId: WakeflowDurableId<"program">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly controllerWindowId: WakeflowDurableId<"window">;
  readonly reviewed: Readonly<ControllerReviewedTargetResult>;
  readonly testExecution: Readonly<{
    readonly testAttemptId: WakeflowDurableId<"test-attempt">;
    readonly testCard: Readonly<{
      readonly testCardId: WakeflowDurableId<"test-card">;
      readonly testCardDigest: Sha256Digest;
    }>;
    readonly testDispatchPacketDigest: Sha256Digest;
  }>;
  readonly decidedAt: UtcInstant;
  readonly decisionDigest: Sha256Digest;
}

export type CreateControllerTestReviewDecisionInput = Omit<
  ControllerTestReviewDecision,
  | "kind"
  | "schemaVersion"
  | "targetReviewDecisionId"
  | "decidedAt"
  | "decisionDigest"
>;

export interface CreateControllerTestReviewDecisionOptions {
  readonly clock?: UtcWallClock;
  readonly uuidFactory?: UuidV4Factory;
}

export type ControllerTestReviewDecisionErrorReason =
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
  json: "Controller Test Review Decision is not passive JSON data.",
  schema: "Controller Test Review Decision does not satisfy its Schema.",
  identifier: "Controller Test Review Decision contains an invalid identity.",
  digest:
    "Controller Test Review Decision contains an invalid or inconsistent digest.",
  position:
    "Controller Test Review Decision contains an invalid Event Stream position.",
  time: "Controller Test Review Decision contains an invalid decision time.",
  text: "Controller Test Review Decision contains invalid review text.",
  relation: "Controller Test Review Decision facts are inconsistent.",
  representation:
    "Controller Test Review Decision bytes are not deterministic.",
} as const satisfies Readonly<
  Record<ControllerTestReviewDecisionErrorReason, string>
>;

export class ControllerTestReviewDecisionError extends Error {
  override readonly name = "ControllerTestReviewDecisionError";
  readonly code = "wakeflow-controller-test-review-decision" as const;
  readonly reason: ControllerTestReviewDecisionErrorReason;
  readonly path: string;

  constructor(reason: ControllerTestReviewDecisionErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<DecisionWire>(
  WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_SCHEMA,
  [
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_TASK_PACKAGE_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
  ],
);

function fail(
  reason: ControllerTestReviewDecisionErrorReason,
  path: string,
): never {
  throw new ControllerTestReviewDecisionError(reason, path);
}

function id<
  Kind extends
    | "target-review-decision"
    | "program"
    | "demand"
    | "target-task"
    | "window"
    | "task-package"
    | "target-result"
    | "test-attempt"
    | "test-card",
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

function streamRevision(value: unknown, path: string) {
  try {
    return parseDemandEventStreamRevision(value, path);
  } catch (error: unknown) {
    if (error instanceof DemandEventStreamPositionError) fail("position", path);
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

export function assertControllerTestReviewJudgment(
  judgment: Readonly<ControllerTestReviewJudgment>,
  resultOutcome?: ControllerReviewedTargetResult["targetResultOutcome"],
): void {
  const {
    decision,
    assessment,
    independentChecks: checks,
    blockingReasons,
  } = judgment;
  if (
    (decision === "accept" &&
      ((resultOutcome !== undefined && resultOutcome !== "completed") ||
        assessment.conclusion !== "satisfied" ||
        assessment.evidenceSufficiency !== "sufficient" ||
        checks.some((check) => check.outcome !== "passed") ||
        blockingReasons.length !== 0)) ||
    (decision === "request-another-attempt" &&
      ((assessment.conclusion !== "inconclusive" &&
        assessment.evidenceSufficiency !== "insufficient") ||
        !checks.some(
          (check) =>
            check.outcome === "failed" || check.outcome === "inconclusive",
        ) ||
        blockingReasons.length !== 0)) ||
    (decision === "escalate-product-defect" &&
      (resultOutcome === "blocked" ||
        assessment.conclusion !== "defect-observed" ||
        assessment.evidenceSufficiency !== "sufficient" ||
        !checks.some((check) => check.outcome === "failed") ||
        blockingReasons.length !== 0)) ||
    (decision === "blocked" &&
      (blockingReasons.length === 0 ||
        (assessment.conclusion === "satisfied" &&
          assessment.evidenceSufficiency === "sufficient")))
  ) {
    fail("relation", "$/decision");
  }
}

function decisionBasis(
  value: Omit<ControllerTestReviewDecision, "decisionDigest">,
): Omit<ControllerTestReviewDecision, "decisionDigest"> {
  return {
    kind: DECISION_KIND,
    schemaVersion: DECISION_SCHEMA_VERSION,
    targetReviewDecisionId: value.targetReviewDecisionId,
    programId: value.programId,
    demandId: value.demandId,
    targetTaskId: value.targetTaskId,
    controllerWindowId: value.controllerWindowId,
    reviewed: value.reviewed,
    testExecution: value.testExecution,
    decision: value.decision,
    assessment: value.assessment,
    independentChecks: value.independentChecks,
    rationale: value.rationale,
    blockingReasons: value.blockingReasons,
    residualRisks: value.residualRisks,
    decidedAt: value.decidedAt,
  };
}

export function parseControllerTestReviewDecision(
  value: unknown,
): Readonly<ControllerTestReviewDecision> {
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
  const testExecution = Object.freeze({
    testAttemptId: id(
      wire.testExecution.testAttemptId,
      "test-attempt",
      "$/testExecution/testAttemptId",
    ),
    testCard: Object.freeze({
      testCardId: id(
        wire.testExecution.testCard.testCardId,
        "test-card",
        "$/testExecution/testCard/testCardId",
      ),
      testCardDigest: digest(
        wire.testExecution.testCard.testCardDigest,
        "$/testExecution/testCard/testCardDigest",
      ),
    }),
    testDispatchPacketDigest: digest(
      wire.testExecution.testDispatchPacketDigest,
      "$/testExecution/testDispatchPacketDigest",
    ),
  });
  const independentChecks = Object.freeze([
    firstCheck,
    ...checks.slice(1),
  ]) as ControllerTestReviewDecision["independentChecks"];
  const blockingReasons = textList(wire.blockingReasons, "$/blockingReasons");
  const decidedAt = instant(wire.decidedAt, "$/decidedAt");
  assertControllerTestReviewJudgment(
    {
      decision: wire.decision,
      assessment: wire.assessment,
      independentChecks,
      rationale: wire.rationale,
      blockingReasons,
      residualRisks: wire.residualRisks,
    },
    reviewed.targetResultOutcome,
  );
  // decidedAt只保存审计观察；因果顺序由reported Snapshot、stream revision和append CAS证明。
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
    testExecution,
    decision: wire.decision,
    assessment: Object.freeze({
      conclusion: wire.assessment.conclusion,
      evidenceSufficiency: wire.assessment.evidenceSufficiency,
    }),
    independentChecks,
    rationale: humanText(wire.rationale, "$/rationale"),
    blockingReasons,
    residualRisks: textList(wire.residualRisks, "$/residualRisks"),
    decidedAt,
  });
  const decisionDigest = digest(wire.decisionDigest, "$/decisionDigest");
  if (computeCanonicalJsonSha256Digest(basis) !== decisionDigest) {
    fail("digest", "$/decisionDigest");
  }
  return Object.freeze({ ...basis, decisionDigest });
}

export function createControllerTestReviewDecision(
  input: Readonly<CreateControllerTestReviewDecisionInput>,
  options: CreateControllerTestReviewDecisionOptions = {},
): Readonly<ControllerTestReviewDecision> {
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
    testExecution: input.testExecution,
    decision: input.decision,
    assessment: input.assessment,
    independentChecks: input.independentChecks,
    rationale: input.rationale,
    blockingReasons: input.blockingReasons,
    residualRisks: input.residualRisks,
    decidedAt,
  });
  return parseControllerTestReviewDecision({
    ...basis,
    decisionDigest: computeCanonicalJsonSha256Digest(basis),
  });
}

function uuidFromDecisionId(value: string) {
  return parseUuidV4(value.slice(DECISION_ID_PREFIX.length));
}

export function controllerTestReviewDecisionEventId(
  value: unknown,
): WakeflowDurableId<"demand-event"> {
  const decision = parseControllerTestReviewDecision(value);
  return createWakeflowDurableId(
    "demand-event",
    uuidFromDecisionId(decision.targetReviewDecisionId),
  );
}

export function controllerTestReviewDecisionCommitId(
  value: unknown,
): WakeflowDurableId<"demand-event-commit"> {
  const decision = parseControllerTestReviewDecision(value);
  return createWakeflowDurableId(
    "demand-event-commit",
    uuidFromDecisionId(decision.targetReviewDecisionId),
  );
}

export function renderControllerTestReviewDecision(value: unknown): string {
  return renderDeterministicJsonDocument(
    parseControllerTestReviewDecision(value),
    "$decision",
  );
}

export function parseControllerTestReviewDecisionDocument(
  text: unknown,
): Readonly<ControllerTestReviewDecision> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(text, "$decision");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", "$decision");
    }
    throw error;
  }
  const decision = parseControllerTestReviewDecision(json);
  if (renderControllerTestReviewDecision(decision) !== text) {
    fail("representation", "$decision");
  }
  return decision;
}
