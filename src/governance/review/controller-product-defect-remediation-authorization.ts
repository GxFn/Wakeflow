import type { WakeflowControllerProductDefectRemediationAuthorization as AuthorizationWire } from "../../contracts/generated/governance/review/controller-product-defect-remediation-authorization.generated.js";
import { WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_AUTHORIZATION_SCHEMA } from "../../contracts/generated/governance/review/controller-product-defect-remediation-authorization.generated.js";
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
import type { TestCardImplementationBaseline } from "../testing/test-card.js";
import {
  parseControllerTestReviewDecision,
  ControllerTestReviewDecisionError,
  type ControllerTestReviewDecision,
} from "./controller-test-review-decision.js";

/**
 * Wakeflow Governance / Review：Controller对Test产品缺陷作出的产品返工授权。
 *
 * Authorization把一份精确`escalate-product-defect` Decision映射到原TaskPackage
 * 边界内的Implementation baseline和失败检查。它不修改Aggregate、不创建Delivery，
 * 也不允许Test窗口修复产品；后续Event owner才有权提交状态转换。
 */

const AUTHORIZATION_KIND =
  "WakeflowControllerProductDefectRemediationAuthorization" as const;
const AUTHORIZATION_SCHEMA_VERSION = 1 as const;
const AUTHORIZATION_ID_PREFIX = "product-defect-remediation_";
const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
const CHECK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export interface ProductDefectRemediationRouteSource {
  readonly postAcceptanceRouteDigest: Sha256Digest;
  readonly reviewSnapshotDigest: Sha256Digest;
  readonly stateDigest: Sha256Digest;
  readonly streamRevision: DemandEventStreamRevision;
}

export interface ProductDefectRemediationFailedCheck {
  readonly checkId: string;
  readonly outcome: "failed";
  readonly method: string;
  readonly observation: string;
}

export interface ProductDefectRemediationAffectedTarget {
  readonly baseline: Readonly<TestCardImplementationBaseline>;
  readonly failedCheckIds: readonly [string, ...string[]];
  readonly correctionObjective: string;
}

export interface ControllerProductDefectRemediationAuthorization {
  readonly kind: typeof AUTHORIZATION_KIND;
  readonly schemaVersion: typeof AUTHORIZATION_SCHEMA_VERSION;
  readonly productDefectRemediationId: WakeflowDurableId<"product-defect-remediation">;
  readonly programId: WakeflowDurableId<"program">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly controllerWindowId: WakeflowDurableId<"window">;
  readonly source: Readonly<{
    readonly postAcceptanceRouteDigest: Sha256Digest;
    readonly reviewSnapshotDigest: Sha256Digest;
    readonly stateDigest: Sha256Digest;
    readonly streamRevision: DemandEventStreamRevision;
    readonly testTargetTaskId: WakeflowDurableId<"target-task">;
    readonly testCard: Readonly<{
      readonly testCardId: WakeflowDurableId<"test-card">;
      readonly testCardDigest: Sha256Digest;
    }>;
    readonly testAttemptId: WakeflowDurableId<"test-attempt">;
    readonly testDispatchPacketDigest: Sha256Digest;
    readonly targetResult: Readonly<{
      readonly targetResultId: WakeflowDurableId<"target-result">;
      readonly resultDigest: Sha256Digest;
    }>;
    readonly testReviewDecision: Readonly<{
      readonly targetReviewDecisionId: WakeflowDurableId<"target-review-decision">;
      readonly decisionDigest: Sha256Digest;
      readonly decidedAt: UtcInstant;
    }>;
  }>;
  readonly failedChecks: readonly [
    Readonly<ProductDefectRemediationFailedCheck>,
    ...Readonly<ProductDefectRemediationFailedCheck>[],
  ];
  readonly affectedTargets: readonly [
    Readonly<ProductDefectRemediationAffectedTarget>,
    ...Readonly<ProductDefectRemediationAffectedTarget>[],
  ];
  readonly boundary: "existing-task-packages-only";
  readonly authorizationRationale: string;
  /** Authorization记录的审计时间；Decision与baseline因果由精确引用和Event CAS建立。 */
  readonly authorizedAt: UtcInstant;
  readonly authorizationDigest: Sha256Digest;
}

export interface CreateProductDefectRemediationAffectedTargetInput {
  readonly baseline: Readonly<TestCardImplementationBaseline>;
  readonly failedCheckIds: readonly [string, ...string[]];
  readonly correctionObjective: string;
}

export interface CreateControllerProductDefectRemediationAuthorizationInput {
  readonly decision: Readonly<ControllerTestReviewDecision>;
  readonly routeSource: Readonly<ProductDefectRemediationRouteSource>;
  readonly affectedTargets: readonly [
    Readonly<CreateProductDefectRemediationAffectedTargetInput>,
    ...Readonly<CreateProductDefectRemediationAffectedTargetInput>[],
  ];
  readonly authorizationRationale: string;
}

export interface CreateControllerProductDefectRemediationAuthorizationOptions {
  readonly clock?: UtcWallClock;
  readonly uuidFactory?: UuidV4Factory;
}

export type ControllerProductDefectRemediationAuthorizationErrorReason =
  | "json"
  | "schema"
  | "identifier"
  | "digest"
  | "position"
  | "time"
  | "text"
  | "decision"
  | "relation"
  | "representation";

const ERROR_MESSAGES = {
  json: "Controller Product Defect Remediation Authorization is not passive JSON data.",
  schema:
    "Controller Product Defect Remediation Authorization does not satisfy its Schema.",
  identifier:
    "Controller Product Defect Remediation Authorization contains an invalid identity.",
  digest:
    "Controller Product Defect Remediation Authorization contains an invalid or inconsistent digest.",
  position:
    "Controller Product Defect Remediation Authorization contains an invalid Event Stream position.",
  time: "Controller Product Defect Remediation Authorization contains an invalid time.",
  text: "Controller Product Defect Remediation Authorization contains invalid text.",
  decision:
    "Controller Product Defect Remediation Authorization requires an exact product-defect Test Decision.",
  relation:
    "Controller Product Defect Remediation Authorization sources are inconsistent.",
  representation:
    "Controller Product Defect Remediation Authorization bytes are not deterministic.",
} as const satisfies Readonly<
  Record<ControllerProductDefectRemediationAuthorizationErrorReason, string>
>;

/** 产品缺陷修复授权无法形成严格领域值时的稳定错误。 */
export class ControllerProductDefectRemediationAuthorizationError extends Error {
  override readonly name =
    "ControllerProductDefectRemediationAuthorizationError";
  readonly code =
    "wakeflow-controller-product-defect-remediation-authorization" as const;
  readonly reason: ControllerProductDefectRemediationAuthorizationErrorReason;
  readonly path: string;

  constructor(
    reason: ControllerProductDefectRemediationAuthorizationErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<AuthorizationWire>(
  WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_AUTHORIZATION_SCHEMA,
  [WAKEFLOW_SHA256_DIGEST_SCHEMA, WAKEFLOW_UTC_INSTANT_SCHEMA],
);

function fail(
  reason: ControllerProductDefectRemediationAuthorizationErrorReason,
  path: string,
): never {
  throw new ControllerProductDefectRemediationAuthorizationError(reason, path);
}

function id<
  Kind extends
    | "product-defect-remediation"
    | "program"
    | "demand"
    | "window"
    | "target-task"
    | "test-card"
    | "test-attempt"
    | "target-result"
    | "target-review-decision"
    | "task-package"
    | "repository",
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

function text(value: unknown, path: string): string {
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

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseBaseline(
  value: Readonly<AuthorizationWire["affectedTargets"][number]["baseline"]>,
  path: string,
): Readonly<TestCardImplementationBaseline> {
  return Object.freeze({
    targetTaskId: id(value.targetTaskId, "target-task", `${path}/targetTaskId`),
    taskPackageId: id(
      value.taskPackageId,
      "task-package",
      `${path}/taskPackageId`,
    ),
    taskPackageDigest: digest(
      value.taskPackageDigest,
      `${path}/taskPackageDigest`,
    ),
    repositoryId: id(value.repositoryId, "repository", `${path}/repositoryId`),
    windowId: id(value.windowId, "window", `${path}/windowId`),
    targetResultId: id(
      value.targetResultId,
      "target-result",
      `${path}/targetResultId`,
    ),
    resultDigest: digest(value.resultDigest, `${path}/resultDigest`),
    targetReviewDecisionId: id(
      value.targetReviewDecisionId,
      "target-review-decision",
      `${path}/targetReviewDecisionId`,
    ),
    decisionDigest: digest(value.decisionDigest, `${path}/decisionDigest`),
  });
}

function parseAffectedTarget(
  value: Readonly<AuthorizationWire["affectedTargets"][number]>,
  path: string,
): Readonly<ProductDefectRemediationAffectedTarget> {
  const failedCheckIds = value.failedCheckIds.map((value, index) =>
    checkId(value, `${path}/failedCheckIds/${index}`),
  );
  const first = failedCheckIds[0];
  if (first === undefined) fail("relation", `${path}/failedCheckIds`);
  const admittedCheckIds: ProductDefectRemediationAffectedTarget["failedCheckIds"] =
    Object.freeze([first, ...failedCheckIds.slice(1)]);
  return Object.freeze({
    baseline: parseBaseline(value.baseline, `${path}/baseline`),
    failedCheckIds: admittedCheckIds,
    correctionObjective: text(
      value.correctionObjective,
      `${path}/correctionObjective`,
    ),
  });
}

function parseSource(
  value: Readonly<AuthorizationWire["source"]>,
): Readonly<ControllerProductDefectRemediationAuthorization["source"]> {
  return Object.freeze({
    postAcceptanceRouteDigest: digest(
      value.postAcceptanceRouteDigest,
      "$/source/postAcceptanceRouteDigest",
    ),
    reviewSnapshotDigest: digest(
      value.reviewSnapshotDigest,
      "$/source/reviewSnapshotDigest",
    ),
    stateDigest: digest(value.stateDigest, "$/source/stateDigest"),
    streamRevision: streamRevision(
      value.streamRevision,
      "$/source/streamRevision",
    ),
    testTargetTaskId: id(
      value.testTargetTaskId,
      "target-task",
      "$/source/testTargetTaskId",
    ),
    testCard: Object.freeze({
      testCardId: id(
        value.testCard.testCardId,
        "test-card",
        "$/source/testCard/testCardId",
      ),
      testCardDigest: digest(
        value.testCard.testCardDigest,
        "$/source/testCard/testCardDigest",
      ),
    }),
    testAttemptId: id(
      value.testAttemptId,
      "test-attempt",
      "$/source/testAttemptId",
    ),
    testDispatchPacketDigest: digest(
      value.testDispatchPacketDigest,
      "$/source/testDispatchPacketDigest",
    ),
    targetResult: Object.freeze({
      targetResultId: id(
        value.targetResult.targetResultId,
        "target-result",
        "$/source/targetResult/targetResultId",
      ),
      resultDigest: digest(
        value.targetResult.resultDigest,
        "$/source/targetResult/resultDigest",
      ),
    }),
    testReviewDecision: Object.freeze({
      targetReviewDecisionId: id(
        value.testReviewDecision.targetReviewDecisionId,
        "target-review-decision",
        "$/source/testReviewDecision/targetReviewDecisionId",
      ),
      decisionDigest: digest(
        value.testReviewDecision.decisionDigest,
        "$/source/testReviewDecision/decisionDigest",
      ),
      decidedAt: instant(
        value.testReviewDecision.decidedAt,
        "$/source/testReviewDecision/decidedAt",
      ),
    }),
  });
}

function assertRelations(
  source: Readonly<ControllerProductDefectRemediationAuthorization["source"]>,
  failedChecks: ControllerProductDefectRemediationAuthorization["failedChecks"],
  affectedTargets: ControllerProductDefectRemediationAuthorization["affectedTargets"],
): void {
  const failedCheckIds = new Set(failedChecks.map((check) => check.checkId));
  const mappedCheckIds = new Set<string>();
  const targetTaskIds = new Set<string>();
  const taskPackageIds = new Set<string>();
  const repositoryIds = new Set<string>();
  const targetResultIds = new Set<string>();
  const targetReviewDecisionIds = new Set<string>();
  if (failedCheckIds.size !== failedChecks.length) {
    fail("relation", "$/failedChecks");
  }
  affectedTargets.forEach((target, index) => {
    const path = `$/affectedTargets/${index}`;
    const baseline = target.baseline;
    if (
      (index > 0 &&
        compareText(
          affectedTargets[index - 1]!.baseline.targetTaskId,
          baseline.targetTaskId,
        ) >= 0) ||
      targetTaskIds.has(baseline.targetTaskId) ||
      taskPackageIds.has(baseline.taskPackageId) ||
      repositoryIds.has(baseline.repositoryId) ||
      targetResultIds.has(baseline.targetResultId) ||
      targetReviewDecisionIds.has(baseline.targetReviewDecisionId) ||
      baseline.targetTaskId === source.testTargetTaskId ||
      baseline.targetResultId === source.targetResult.targetResultId ||
      baseline.targetReviewDecisionId ===
        source.testReviewDecision.targetReviewDecisionId
    ) {
      fail("relation", `${path}/baseline`);
    }
    targetTaskIds.add(baseline.targetTaskId);
    taskPackageIds.add(baseline.taskPackageId);
    repositoryIds.add(baseline.repositoryId);
    targetResultIds.add(baseline.targetResultId);
    targetReviewDecisionIds.add(baseline.targetReviewDecisionId);
    const seen = new Set<string>();
    target.failedCheckIds.forEach((id, checkIndex) => {
      if (
        !failedCheckIds.has(id) ||
        seen.has(id) ||
        (checkIndex > 0 &&
          compareText(target.failedCheckIds[checkIndex - 1]!, id) >= 0)
      ) {
        fail("relation", `${path}/failedCheckIds`);
      }
      seen.add(id);
      mappedCheckIds.add(id);
    });
  });
  if (
    mappedCheckIds.size !== failedCheckIds.size ||
    [...failedCheckIds].some((id) => !mappedCheckIds.has(id))
  ) {
    fail("relation", "$/affectedTargets");
  }
}

function authorizationBasis(
  value: Omit<
    ControllerProductDefectRemediationAuthorization,
    "authorizationDigest"
  >,
): Omit<
  ControllerProductDefectRemediationAuthorization,
  "authorizationDigest"
> {
  return {
    kind: AUTHORIZATION_KIND,
    schemaVersion: AUTHORIZATION_SCHEMA_VERSION,
    productDefectRemediationId: value.productDefectRemediationId,
    programId: value.programId,
    demandId: value.demandId,
    controllerWindowId: value.controllerWindowId,
    source: value.source,
    failedChecks: value.failedChecks,
    affectedTargets: value.affectedTargets,
    boundary: "existing-task-packages-only",
    authorizationRationale: value.authorizationRationale,
    authorizedAt: value.authorizedAt,
  };
}

/** 严格解析一份已持久化或跨模块传递的产品缺陷修复授权。 */
export function parseControllerProductDefectRemediationAuthorization(
  value: unknown,
): Readonly<ControllerProductDefectRemediationAuthorization> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$authorization");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const validated = validateWire(json);
  if (!validated.ok) fail("schema", validated.path);
  const wire = validated.value;
  const source = parseSource(wire.source);
  const failedChecks = wire.failedChecks.map((check, index) =>
    Object.freeze({
      checkId: checkId(check.checkId, `$/failedChecks/${index}/checkId`),
      outcome: "failed" as const,
      method: text(check.method, `$/failedChecks/${index}/method`),
      observation: text(
        check.observation,
        `$/failedChecks/${index}/observation`,
      ),
    }),
  );
  const firstCheck = failedChecks[0];
  if (firstCheck === undefined) fail("relation", "$/failedChecks");
  const admittedChecks: ControllerProductDefectRemediationAuthorization["failedChecks"] =
    Object.freeze([firstCheck, ...failedChecks.slice(1)]);
  const targets = wire.affectedTargets.map((target, index) =>
    parseAffectedTarget(target, `$/affectedTargets/${index}`),
  );
  const firstTarget = targets[0];
  if (firstTarget === undefined) fail("relation", "$/affectedTargets");
  const admittedTargets: ControllerProductDefectRemediationAuthorization["affectedTargets"] =
    Object.freeze([firstTarget, ...targets.slice(1)]);
  const authorizedAt = instant(wire.authorizedAt, "$/authorizedAt");
  assertRelations(source, admittedChecks, admittedTargets);
  const basis = authorizationBasis({
    kind: AUTHORIZATION_KIND,
    schemaVersion: AUTHORIZATION_SCHEMA_VERSION,
    productDefectRemediationId: id(
      wire.productDefectRemediationId,
      "product-defect-remediation",
      "$/productDefectRemediationId",
    ),
    programId: id(wire.programId, "program", "$/programId"),
    demandId: id(wire.demandId, "demand", "$/demandId"),
    controllerWindowId: id(
      wire.controllerWindowId,
      "window",
      "$/controllerWindowId",
    ),
    source,
    failedChecks: admittedChecks,
    affectedTargets: admittedTargets,
    boundary: "existing-task-packages-only",
    authorizationRationale: text(
      wire.authorizationRationale,
      "$/authorizationRationale",
    ),
    authorizedAt,
  });
  const authorizationDigest = digest(
    wire.authorizationDigest,
    "$/authorizationDigest",
  );
  if (computeCanonicalJsonSha256Digest(basis) !== authorizationDigest) {
    fail("digest", "$/authorizationDigest");
  }
  return Object.freeze({ ...basis, authorizationDigest });
}

function normalizeRouteSource(
  value: Readonly<ProductDefectRemediationRouteSource>,
): Readonly<ProductDefectRemediationRouteSource> {
  return Object.freeze({
    postAcceptanceRouteDigest: digest(
      value.postAcceptanceRouteDigest,
      "$input/routeSource/postAcceptanceRouteDigest",
    ),
    reviewSnapshotDigest: digest(
      value.reviewSnapshotDigest,
      "$input/routeSource/reviewSnapshotDigest",
    ),
    stateDigest: digest(value.stateDigest, "$input/routeSource/stateDigest"),
    streamRevision: streamRevision(
      value.streamRevision,
      "$input/routeSource/streamRevision",
    ),
  });
}

function normalizeAffectedTargetInput(
  value: Readonly<CreateProductDefectRemediationAffectedTargetInput>,
  index: number,
): Readonly<ProductDefectRemediationAffectedTarget> {
  const path = `$input/affectedTargets/${index}`;
  const baseline = parseBaseline(
    value.baseline as AuthorizationWire["affectedTargets"][number]["baseline"],
    `${path}/baseline`,
  );
  const failedCheckIds = value.failedCheckIds
    .map((value, checkIndex) =>
      checkId(value, `${path}/failedCheckIds/${checkIndex}`),
    )
    .sort(compareText);
  const first = failedCheckIds[0];
  if (first === undefined) fail("relation", `${path}/failedCheckIds`);
  const admittedCheckIds: ProductDefectRemediationAffectedTarget["failedCheckIds"] =
    Object.freeze([first, ...failedCheckIds.slice(1)]);
  return Object.freeze({
    baseline,
    failedCheckIds: admittedCheckIds,
    correctionObjective: text(
      value.correctionObjective,
      `${path}/correctionObjective`,
    ),
  });
}

/**
 * 从一份产品缺陷Test Decision创建原TaskPackage边界内的Controller授权。
 *
 * Decision、route source、检查映射和文本会在读取UUID与时钟前完成准入。
 */
export function createControllerProductDefectRemediationAuthorization(
  input: Readonly<CreateControllerProductDefectRemediationAuthorizationInput>,
  options: CreateControllerProductDefectRemediationAuthorizationOptions = {},
): Readonly<ControllerProductDefectRemediationAuthorization> {
  let decision: Readonly<ControllerTestReviewDecision>;
  try {
    decision = parseControllerTestReviewDecision(input.decision);
  } catch (error: unknown) {
    if (error instanceof ControllerTestReviewDecisionError) {
      fail("decision", "$input/decision");
    }
    throw error;
  }
  if (decision.decision !== "escalate-product-defect") {
    fail("decision", "$input/decision/decision");
  }
  const routeSource = normalizeRouteSource(input.routeSource);
  if (routeSource.streamRevision !== decision.reviewed.streamRevision + 1) {
    fail("relation", "$input/routeSource/streamRevision");
  }
  const failedChecks = decision.independentChecks
    .filter((check) => check.outcome === "failed")
    .map((check) =>
      Object.freeze({
        checkId: check.checkId,
        outcome: "failed" as const,
        method: check.method,
        observation: check.observation,
      }),
    );
  const firstCheck = failedChecks[0];
  if (firstCheck === undefined) fail("decision", "$input/decision");
  const admittedChecks: ControllerProductDefectRemediationAuthorization["failedChecks"] =
    Object.freeze([firstCheck, ...failedChecks.slice(1)]);
  const affectedTargets = input.affectedTargets
    .map(normalizeAffectedTargetInput)
    .sort((left, right) =>
      compareText(left.baseline.targetTaskId, right.baseline.targetTaskId),
    );
  const firstTarget = affectedTargets[0];
  if (firstTarget === undefined) fail("relation", "$input/affectedTargets");
  const admittedTargets: ControllerProductDefectRemediationAuthorization["affectedTargets"] =
    Object.freeze([firstTarget, ...affectedTargets.slice(1)]);
  const source = Object.freeze({
    ...routeSource,
    testTargetTaskId: decision.targetTaskId,
    testCard: decision.testExecution.testCard,
    testAttemptId: decision.testExecution.testAttemptId,
    testDispatchPacketDigest: decision.testExecution.testDispatchPacketDigest,
    targetResult: Object.freeze({
      targetResultId: decision.reviewed.targetResultId,
      resultDigest: decision.reviewed.targetResultDigest,
    }),
    testReviewDecision: Object.freeze({
      targetReviewDecisionId: decision.targetReviewDecisionId,
      decisionDigest: decision.decisionDigest,
      decidedAt: decision.decidedAt,
    }),
  });
  assertRelations(source, admittedChecks, admittedTargets);
  const authorizationRationale = text(
    input.authorizationRationale,
    "$input/authorizationRationale",
  );

  let productDefectRemediationId: WakeflowDurableId<"product-defect-remediation">;
  try {
    productDefectRemediationId = createWakeflowDurableId(
      "product-defect-remediation",
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
  let authorizedAt: UtcInstant;
  try {
    authorizedAt =
      options.clock === undefined
        ? readUtcWallClock()
        : readUtcWallClock(options.clock);
  } catch (error: unknown) {
    if (error instanceof UtcWallClockError) fail("time", "$clock");
    throw error;
  }
  const basis = authorizationBasis({
    kind: AUTHORIZATION_KIND,
    schemaVersion: AUTHORIZATION_SCHEMA_VERSION,
    productDefectRemediationId,
    programId: decision.programId,
    demandId: decision.demandId,
    controllerWindowId: decision.controllerWindowId,
    source,
    failedChecks: admittedChecks,
    affectedTargets: admittedTargets,
    boundary: "existing-task-packages-only",
    authorizationRationale,
    authorizedAt,
  });
  return parseControllerProductDefectRemediationAuthorization({
    ...basis,
    authorizationDigest: computeCanonicalJsonSha256Digest(basis),
  });
}

function uuidFromAuthorizationId(value: string) {
  return parseUuidV4(value.slice(AUTHORIZATION_ID_PREFIX.length));
}

/** 同一Authorization UUID在Demand Event命名空间中的确定性身份。 */
export function productDefectRemediationAuthorizedEventId(
  value: unknown,
): WakeflowDurableId<"demand-event"> {
  const authorization =
    parseControllerProductDefectRemediationAuthorization(value);
  return createWakeflowDurableId(
    "demand-event",
    uuidFromAuthorizationId(authorization.productDefectRemediationId),
  );
}

/** 同一Authorization UUID在Demand Event Commit命名空间中的确定性身份。 */
export function productDefectRemediationAuthorizedCommitId(
  value: unknown,
): WakeflowDurableId<"demand-event-commit"> {
  const authorization =
    parseControllerProductDefectRemediationAuthorization(value);
  return createWakeflowDurableId(
    "demand-event-commit",
    uuidFromAuthorizationId(authorization.productDefectRemediationId),
  );
}

export function renderControllerProductDefectRemediationAuthorization(
  value: unknown,
): string {
  return renderDeterministicJsonDocument(
    parseControllerProductDefectRemediationAuthorization(value),
    "$authorization",
  );
}

export function parseControllerProductDefectRemediationAuthorizationDocument(
  textValue: unknown,
): Readonly<ControllerProductDefectRemediationAuthorization> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(textValue, "$authorization");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", "$authorization");
    }
    throw error;
  }
  const authorization =
    parseControllerProductDefectRemediationAuthorization(json);
  if (
    renderControllerProductDefectRemediationAuthorization(authorization) !==
    textValue
  ) {
    fail("representation", "$authorization");
  }
  return authorization;
}
