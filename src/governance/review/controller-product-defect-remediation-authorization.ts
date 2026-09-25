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
import type { TestImplementationBaseline } from "../tasking/task-package.js";
import {
  parseControllerTestReviewDecision,
  ControllerTestReviewDecisionError,
  type ControllerTestReviewDecision,
} from "./controller-test-review-decision.js";

/**
 * Wakeflow Governance / Review：Controller对Test产品缺陷作出的产品返工授权。
 *
 * Authorization把一份精确`escalate{product-defect}` Decision映射到原TaskPackage
 * 边界内的Implementation baseline和失败步骤。它不修改Aggregate、不创建Delivery，
 * 也不允许Test窗口修复产品；它由决定器在同一提交随决定事件派生（§13.87 D5）。
 */

const AUTHORIZATION_KIND =
  "WakeflowControllerProductDefectRemediationAuthorization" as const;
const AUTHORIZATION_SCHEMA_VERSION = 1 as const;
const AUTHORIZATION_ID_PREFIX = "product-defect-remediation_";
const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
const STEP_ID_PATTERN = /^ts-[1-9][0-9]?$/u;

export interface ProductDefectRemediationRouteSource {
  readonly reviewSnapshotDigest: Sha256Digest;
  readonly stateDigest: Sha256Digest;
  readonly streamRevision: DemandEventStreamRevision;
}

/** 测试结果里判定为 fail 的合同步骤引用（stepId 与 observed 原文）。 */
export interface ProductDefectRemediationFailedStep {
  readonly stepId: string;
  readonly observed: string;
}

export interface ProductDefectRemediationAffectedTarget {
  readonly baseline: Readonly<TestImplementationBaseline>;
  readonly failedStepIds: readonly [string, ...string[]];
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
    readonly reviewSnapshotDigest: Sha256Digest;
    readonly stateDigest: Sha256Digest;
    readonly streamRevision: DemandEventStreamRevision;
    readonly testTargetTaskId: WakeflowDurableId<"target-task">;
    readonly testTaskPackage: Readonly<{
      readonly taskPackageId: WakeflowDurableId<"task-package">;
      readonly taskPackageDigest: Sha256Digest;
    }>;
    readonly testAttemptId: WakeflowDurableId<"test-attempt">;
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
  readonly failedSteps: readonly [
    Readonly<ProductDefectRemediationFailedStep>,
    ...Readonly<ProductDefectRemediationFailedStep>[],
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

export interface CreateControllerProductDefectRemediationAuthorizationInput {
  readonly decision: Readonly<ControllerTestReviewDecision>;
  readonly routeSource: Readonly<ProductDefectRemediationRouteSource>;
  /** 被升级的 test 目标当前任务包（测试合同与实现基线的载体）。 */
  readonly testTaskPackage: Readonly<{
    readonly taskPackageId: WakeflowDurableId<"task-package">;
    readonly taskPackageDigest: Sha256Digest;
  }>;
  /** 被评审测试结果里 verdict 为 fail 的步骤；受影响目标的映射取自决定的 remediation。 */
  readonly failedSteps: readonly Readonly<ProductDefectRemediationFailedStep>[];
  /** 决定引用的每个产品目标的当前 approved 基线（读侧派生，§13.87 D6）。 */
  readonly baselines: readonly Readonly<TestImplementationBaseline>[];
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
    "Controller Product Defect Remediation Authorization requires an exact escalate{product-defect} Test Decision.",
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
    Array.from(value).length > 8192 ||
    !value.isWellFormed() ||
    value.normalize("NFC") !== value ||
    value.trim() !== value ||
    CONTROL_EXCEPT_LF_PATTERN.test(value)
  ) {
    fail("text", path);
  }
  return value;
}

function stepId(value: unknown, path: string): string {
  if (typeof value !== "string" || !STEP_ID_PATTERN.test(value)) {
    fail("text", path);
  }
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** 合同步骤按编号排序：ts-2 在 ts-10 之前。 */
function compareStepId(left: string, right: string): number {
  return Number(left.slice(3)) - Number(right.slice(3));
}

function admitStepIds(
  values: readonly string[],
  path: string,
): ProductDefectRemediationAffectedTarget["failedStepIds"] {
  const stepIds = values.map((value, index) => stepId(value, `${path}/${index}`));
  const first = stepIds[0];
  if (first === undefined) fail("relation", path);
  stepIds.forEach((value, index) => {
    if (index > 0 && compareStepId(stepIds[index - 1]!, value) >= 0) {
      fail("relation", `${path}/${index}`);
    }
  });
  return Object.freeze([first, ...stepIds.slice(1)]);
}

function parseBaseline(
  value: Readonly<AuthorizationWire["affectedTargets"][number]["baseline"]>,
  path: string,
): Readonly<TestImplementationBaseline> {
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
  return Object.freeze({
    baseline: parseBaseline(value.baseline, `${path}/baseline`),
    failedStepIds: admitStepIds(value.failedStepIds, `${path}/failedStepIds`),
    correctionObjective: text(
      value.correctionObjective,
      `${path}/correctionObjective`,
    ),
  });
}

function parseFailedSteps(
  values: readonly Readonly<ProductDefectRemediationFailedStep>[],
  path: string,
): ControllerProductDefectRemediationAuthorization["failedSteps"] {
  const steps = values.map((step, index) =>
    Object.freeze({
      stepId: stepId(step.stepId, `${path}/${index}/stepId`),
      observed: text(step.observed, `${path}/${index}/observed`),
    }),
  );
  const first = steps[0];
  if (first === undefined) fail("relation", path);
  steps.forEach((step, index) => {
    if (index > 0 && compareStepId(steps[index - 1]!.stepId, step.stepId) >= 0) {
      fail("relation", `${path}/${index}/stepId`);
    }
  });
  return Object.freeze([first, ...steps.slice(1)]);
}

function parseSource(
  value: Readonly<AuthorizationWire["source"]>,
): Readonly<ControllerProductDefectRemediationAuthorization["source"]> {
  return Object.freeze({
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
    testTaskPackage: Object.freeze({
      taskPackageId: id(
        value.testTaskPackage.taskPackageId,
        "task-package",
        "$/source/testTaskPackage/taskPackageId",
      ),
      taskPackageDigest: digest(
        value.testTaskPackage.taskPackageDigest,
        "$/source/testTaskPackage/taskPackageDigest",
      ),
    }),
    testAttemptId: id(
      value.testAttemptId,
      "test-attempt",
      "$/source/testAttemptId",
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
  failedSteps: ControllerProductDefectRemediationAuthorization["failedSteps"],
  affectedTargets: ControllerProductDefectRemediationAuthorization["affectedTargets"],
): void {
  const failedStepIds = new Set(failedSteps.map((step) => step.stepId));
  const mappedStepIds = new Set<string>();
  const targetTaskIds = new Set<string>();
  const taskPackageIds = new Set<string>();
  const repositoryIds = new Set<string>();
  const targetResultIds = new Set<string>();
  const targetReviewDecisionIds = new Set<string>();
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
      baseline.taskPackageId === source.testTaskPackage.taskPackageId ||
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
    target.failedStepIds.forEach((id) => {
      if (!failedStepIds.has(id)) fail("relation", `${path}/failedStepIds`);
      mappedStepIds.add(id);
    });
  });
  if (mappedStepIds.size !== failedStepIds.size) {
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
    failedSteps: value.failedSteps,
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
  const failedSteps = parseFailedSteps(wire.failedSteps, "$/failedSteps");
  const targets = wire.affectedTargets.map((target, index) =>
    parseAffectedTarget(target, `$/affectedTargets/${index}`),
  );
  const firstTarget = targets[0];
  if (firstTarget === undefined) fail("relation", "$/affectedTargets");
  const admittedTargets: ControllerProductDefectRemediationAuthorization["affectedTargets"] =
    Object.freeze([firstTarget, ...targets.slice(1)]);
  const authorizedAt = instant(wire.authorizedAt, "$/authorizedAt");
  assertRelations(source, failedSteps, admittedTargets);
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
    failedSteps,
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

function normalizeBaselines(
  values: readonly Readonly<TestImplementationBaseline>[],
): ReadonlyMap<string, Readonly<TestImplementationBaseline>> {
  const baselines = new Map<string, Readonly<TestImplementationBaseline>>();
  values.forEach((value, index) => {
    const baseline = parseBaseline(
      value as AuthorizationWire["affectedTargets"][number]["baseline"],
      `$input/baselines/${index}`,
    );
    if (baselines.has(baseline.targetTaskId)) {
      fail("relation", `$input/baselines/${index}/targetTaskId`);
    }
    baselines.set(baseline.targetTaskId, baseline);
  });
  return baselines;
}

/** 决定的 remediation 目标与读侧基线合成受影响目标；每个目标必须有基线。 */
function deriveAffectedTargets(
  decision: Readonly<ControllerTestReviewDecision>,
  baselines: ReadonlyMap<string, Readonly<TestImplementationBaseline>>,
): ControllerProductDefectRemediationAuthorization["affectedTargets"] {
  if (decision.escalation?.classification !== "product-defect") {
    fail("decision", "$input/decision/escalation");
  }
  const targets = decision.escalation.remediation.affectedTargets.map(
    (target, index) => {
      const path = `$input/decision/escalation/remediation/affectedTargets/${index}`;
      const baseline = baselines.get(target.targetTaskId);
      if (baseline === undefined) fail("relation", `${path}/targetTaskId`);
      return Object.freeze({
        baseline,
        failedStepIds: admitStepIds(
          [...target.failedStepIds].sort(compareStepId),
          `${path}/failedStepIds`,
        ),
        correctionObjective: target.correctionObjective,
      });
    },
  );
  const sorted = [...targets].sort((left, right) =>
    compareText(left.baseline.targetTaskId, right.baseline.targetTaskId),
  );
  const first = sorted[0];
  if (first === undefined) fail("decision", "$input/decision/escalation");
  return Object.freeze([first, ...sorted.slice(1)]);
}

/**
 * 从一份 `escalate{product-defect}` Test Decision 创建原 TaskPackage 边界内的授权。
 *
 * Decision、route source、失败步骤映射和文本会在读取UUID与时钟前完成准入。
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
  if (
    decision.decision !== "escalate" ||
    decision.escalation?.classification !== "product-defect"
  ) {
    fail("decision", "$input/decision/decision");
  }
  const routeSource = normalizeRouteSource(input.routeSource);
  if (
    routeSource.streamRevision !== decision.reviewed.streamRevision + 1 ||
    routeSource.reviewSnapshotDigest !== decision.reviewed.snapshotDigest
  ) {
    fail("relation", "$input/routeSource");
  }
  const failedSteps = parseFailedSteps(
    [...input.failedSteps].sort((left, right) =>
      compareStepId(String(left.stepId), String(right.stepId)),
    ),
    "$input/failedSteps",
  );
  const admittedTargets = deriveAffectedTargets(
    decision,
    normalizeBaselines(input.baselines),
  );
  const source = Object.freeze({
    ...routeSource,
    testTargetTaskId: decision.targetTaskId,
    testTaskPackage: Object.freeze({
      taskPackageId: id(
        input.testTaskPackage.taskPackageId,
        "task-package",
        "$input/testTaskPackage/taskPackageId",
      ),
      taskPackageDigest: digest(
        input.testTaskPackage.taskPackageDigest,
        "$input/testTaskPackage/taskPackageDigest",
      ),
    }),
    testAttemptId: decision.testExecution.testAttemptId,
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
  assertRelations(source, failedSteps, admittedTargets);
  const authorizationRationale =
    decision.escalation.remediation.authorizationRationale;

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
    failedSteps,
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
