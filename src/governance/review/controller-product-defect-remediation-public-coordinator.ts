import {
  WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_RESULT_SCHEMA,
  type WakeflowControllerProductDefectRemediationResultV1 as RemediationResultWire,
} from "../../contracts/generated/entrypoints/wakeflow-controller-product-defect-remediation-result.generated.js";
import {
  canonicalizeJson,
  encodeCanonicalJson,
} from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import { computeDemandEventStreamCommitDigest } from "../demand/event-sourcing/demand-event-stream-commit.js";
import {
  productDefectRemediationAuthorizedCommitId,
  productDefectRemediationAuthorizedEventId,
} from "./controller-product-defect-remediation-authorization.js";
import {
  parseControllerProductDefectRemediationPublicRequest,
  ControllerProductDefectRemediationPublicContractError,
  WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_TOOL_NAME,
} from "./controller-product-defect-remediation-public-contract.js";
import type { ControllerProductDefectRemediationOptions } from "./controller-product-defect-remediation-input.js";
import {
  ControllerProductDefectRemediationService,
  ControllerProductDefectRemediationServiceError,
} from "./controller-product-defect-remediation-service.js";

/**
 * Wakeflow Governance / Review：Controller Product Defect Remediation公共提交边界。
 *
 * Coordinator只记录Controller已经形成的产品返工授权。它不创建Delivery、不执行修复、
 * 不允许Test修改产品，也不创建下一TestCard或完成Demand。
 */

export type ControllerProductDefectRemediationPublicResult =
  Readonly<RemediationResultWire>;

export interface ControllerProductDefectRemediationPublicCoordinatorOptions {
  readonly remediation?: ControllerProductDefectRemediationOptions;
}

type EventAuthority =
  ControllerProductDefectRemediationServiceError["eventAuthority"];

export type ControllerProductDefectRemediationPublicCoordinatorErrorReason =
  "root" | "privacy" | "remediation" | "output";

const ERROR_MESSAGES = {
  root: "Controller Product Defect Remediation workspace root is invalid.",
  privacy:
    "Controller Product Defect Remediation contains a private workspace value.",
  remediation: "Controller Product Defect Remediation operation failed.",
  output: "Controller Product Defect Remediation result violated its boundary.",
} as const satisfies Readonly<
  Record<ControllerProductDefectRemediationPublicCoordinatorErrorReason, string>
>;

export class ControllerProductDefectRemediationPublicCoordinatorError extends Error {
  override readonly name =
    "ControllerProductDefectRemediationPublicCoordinatorError";
  readonly code =
    "wakeflow-controller-product-defect-remediation-public-coordinator" as const;
  readonly reason: ControllerProductDefectRemediationPublicCoordinatorErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly eventAuthority: EventAuthority;

  constructor(
    reason: ControllerProductDefectRemediationPublicCoordinatorErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    eventAuthority: EventAuthority = "unchanged",
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
    this.eventAuthority = eventAuthority;
  }
}

const CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_MAXIMUM_RESULT_BYTES =
  16 * 1024 * 1024;
const validateResult = createRuntimeJsonSchemaValidator<RemediationResultWire>(
  WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_RESULT_SCHEMA,
);

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
  reason: ControllerProductDefectRemediationPublicCoordinatorErrorReason,
  cause?: unknown,
  eventAuthority: EventAuthority = cause instanceof
  ControllerProductDefectRemediationServiceError
    ? cause.eventAuthority
    : "unchanged",
): never {
  throw new ControllerProductDefectRemediationPublicCoordinatorError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    eventAuthority,
  );
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function projectRemediationResult(
  result: Awaited<
    ReturnType<ControllerProductDefectRemediationService["authorize"]>
  >,
  request: ReturnType<
    typeof parseControllerProductDefectRemediationPublicRequest
  >,
) {
  const { authorization, commandResult } = result;
  const event = commandResult.commit.events.find(
    (entry) =>
      entry.eventType === "review.product-defect-remediation-authorized" &&
      entry.eventId ===
        productDefectRemediationAuthorizedEventId(authorization),
  );
  const affectedTargetsMatch = authorization.affectedTargets.every(
    (affected) => {
      const target = commandResult.aggregate.state.targetTasks.find(
        (entry) => entry.targetTaskId === affected.baseline.targetTaskId,
      );
      return (
        target?.phase === "product-defect-rework-requested" &&
        target.productDefectRemediation.productDefectRemediationId ===
          authorization.productDefectRemediationId &&
        target.productDefectRemediation.authorizationDigest ===
          authorization.authorizationDigest &&
        target.productDefectRemediation.testReviewDecisionId ===
          authorization.source.testReviewDecision.targetReviewDecisionId &&
        target.productDefectRemediation.testReviewDecisionDigest ===
          authorization.source.testReviewDecision.decisionDigest &&
        arraysEqual(
          target.productDefectRemediation.failedCheckIds,
          affected.failedCheckIds,
        ) &&
        target.productDefectRemediation.correctionObjective ===
          affected.correctionObjective &&
        target.productDefectRemediation.authorizedAt ===
          authorization.authorizedAt
      );
    },
  );
  const testTarget = commandResult.aggregate.state.targetTasks.find(
    (entry) => entry.targetTaskId === authorization.source.testTargetTaskId,
  );
  const pendingRetest = commandResult.aggregate.state.pendingTestRetest;
  const committedStateMatches =
    result.disposition === "idempotent" ||
    (event !== undefined &&
      affectedTargetsMatch &&
      testTarget?.workType === "test" &&
      testTarget.phase === "test-product-defect" &&
      commandResult.aggregate.state.currentTestCard === undefined &&
      pendingRetest?.previousTestCard.testCardId ===
        authorization.source.testCard.testCardId &&
      pendingRetest.previousTestCard.testCardDigest ===
        authorization.source.testCard.testCardDigest &&
      pendingRetest.testReviewDecision.targetReviewDecisionId ===
        authorization.source.testReviewDecision.targetReviewDecisionId &&
      pendingRetest.testReviewDecision.decisionDigest ===
        authorization.source.testReviewDecision.decisionDigest &&
      pendingRetest.productDefectRemediation.productDefectRemediationId ===
        authorization.productDefectRemediationId &&
      pendingRetest.productDefectRemediation.authorizationDigest ===
        authorization.authorizationDigest &&
      event.resultingStateDigest === commandResult.aggregate.stateDigest);
  if (
    event === undefined ||
    !committedStateMatches ||
    result.eventAuthority !== "current" ||
    authorization.demandId !== request.demandId ||
    authorization.source.testReviewDecision.targetReviewDecisionId !==
      request.testReviewDecisionId ||
    authorization.source.postAcceptanceRouteDigest !==
      request.postAcceptanceRouteDigest ||
    authorization.authorizationRationale !== request.authorizationRationale ||
    authorization.affectedTargets.length !== request.affectedTargets.length ||
    request.affectedTargets.some((target, index) => {
      const affected = authorization.affectedTargets[index];
      return (
        affected === undefined ||
        affected.baseline.targetTaskId !== target.targetTaskId ||
        !arraysEqual(affected.failedCheckIds, target.failedCheckIds) ||
        affected.correctionObjective !== target.correctionObjective
      );
    }) ||
    (result.status === "authorized") !== (result.disposition === "committed") ||
    commandResult.commit.events.length !== 1 ||
    commandResult.commit.commitId !==
      productDefectRemediationAuthorizedCommitId(authorization) ||
    commandResult.commit.demandId !== request.demandId ||
    commandResult.commit.commandDigest !== result.commandDigest ||
    commandResult.commit.expectedStreamRevision !==
      authorization.source.streamRevision ||
    commandResult.commit.firstStreamRevision !== event.streamRevision ||
    commandResult.commit.lastStreamRevision !== event.streamRevision ||
    event.streamRevision !== commandResult.commit.expectedStreamRevision + 1 ||
    event.demandId !== request.demandId ||
    event.eventType !== "review.product-defect-remediation-authorized" ||
    canonicalizeJson(event.data.authorization, "$eventAuthorization") !==
      canonicalizeJson(authorization, "$authorization") ||
    computeDemandEventStreamCommitDigest(commandResult.commit) !==
      result.commitDigest
  ) {
    fail("output", undefined, "current");
  }
  return {
    kind: "WakeflowControllerProductDefectRemediationResult" as const,
    schemaVersion:
      WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_TOOL_NAME,
    status: result.status,
    disposition: result.disposition,
    eventAuthority: "current" as const,
    authorization,
    event: {
      eventId: event.eventId,
      streamRevision: event.streamRevision,
    },
    commit: {
      commitId: commandResult.commit.commitId,
      commitSequence: commandResult.commit.commitSequence,
      commitDigest: result.commitDigest,
    },
    stateDigest: event.resultingStateDigest,
  };
}

function containsText(value: JsonValue, text: string): boolean {
  if (typeof value === "string") {
    return value.includes(text) || value.includes(JSON.stringify(text));
  }
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some((entry) => containsText(entry, text));
}

function publicResult(
  value: unknown,
  requestRoot: string,
  canonicalRoot: string,
): ControllerProductDefectRemediationPublicResult {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$result");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("output", error, "current");
    throw error;
  }
  const validated = validateResult(json);
  if (
    encodeCanonicalJson(json, "$result").byteLength >
      CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_MAXIMUM_RESULT_BYTES ||
    !validated.ok ||
    (requestRoot.length > 1 && containsText(json, requestRoot)) ||
    (canonicalRoot.length > 1 && containsText(json, canonicalRoot))
  ) {
    fail("output", undefined, "current");
  }
  return json as unknown as ControllerProductDefectRemediationPublicResult;
}

/** 授权Controller已经映射到既有TaskPackage边界的产品缺陷修复。 */
export async function executeControllerProductDefectRemediationPublicRequest(
  value: unknown,
  options: ControllerProductDefectRemediationPublicCoordinatorOptions = {},
): Promise<ControllerProductDefectRemediationPublicResult> {
  const request = parseControllerProductDefectRemediationPublicRequest(value);
  let root: RootedDirectory;
  try {
    root = await RootedDirectory.open(request.root, "$request.root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root", error);
    throw error;
  }

  let eventAuthority: EventAuthority = "unchanged";
  let result: ControllerProductDefectRemediationPublicResult | undefined;
  let failure: unknown;
  try {
    const { root: _root, ...remediationRequest } = request;
    if (
      root.absolutePath.length > 1 &&
      containsText(
        remediationRequest as unknown as JsonValue,
        root.absolutePath,
      )
    ) {
      fail("privacy");
    }
    let authorized;
    try {
      authorized = await new ControllerProductDefectRemediationService(
        root,
      ).authorize(remediationRequest, options.remediation);
      eventAuthority = "current";
    } catch (error: unknown) {
      if (error instanceof ControllerProductDefectRemediationServiceError) {
        fail("remediation", error);
      }
      throw error;
    }
    result = publicResult(
      projectRemediationResult(authorized, request),
      request.root,
      root.absolutePath,
    );
  } catch (error: unknown) {
    if (
      error instanceof ControllerProductDefectRemediationPublicCoordinatorError
    ) {
      eventAuthority = error.eventAuthority;
    }
    failure = error;
  }

  try {
    await root.close();
  } catch (error: unknown) {
    if (failure === undefined) {
      failure = new ControllerProductDefectRemediationPublicCoordinatorError(
        "root",
        ownString(error, "code"),
        ownString(error, "reason"),
        eventAuthority,
      );
    }
  }
  if (failure !== undefined) throw failure;
  if (result === undefined) fail("output", undefined, eventAuthority);
  return result;
}

export { ControllerProductDefectRemediationPublicContractError };
