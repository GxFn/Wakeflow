import {
  WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_RESULT_SCHEMA,
  type WakeflowControllerTestReviewDecisionResultV1 as DecisionResultWire,
} from "../../contracts/generated/entrypoints/wakeflow-controller-test-review-decision-result.generated.js";
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
  controllerTestReviewDecisionCommitId,
  controllerTestReviewDecisionEventId,
  type ControllerTestReviewDecision,
  type ControllerTestReviewJudgment,
} from "./controller-test-review-decision.js";
import {
  parseControllerTestReviewDecisionPublicRequest,
  ControllerTestReviewDecisionPublicContractError,
  WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME,
} from "./controller-test-review-decision-public-contract.js";
import type { ControllerTestReviewDecisionOptions } from "./controller-test-review-decision-input.js";
import {
  ControllerTestReviewDecisionService,
  ControllerTestReviewDecisionServiceError,
} from "./controller-test-review-decision-service.js";

/**
 * Wakeflow Governance / Review：Controller Test Decision公共提交边界。
 *
 * Coordinator只记录Controller已经形成的独立判断。它不运行检查、不从TargetResult
 * 自动推导Decision，也不创建另一attempt、产品修复授权、Delivery或Demand completion。
 */

export type ControllerTestReviewDecisionPublicResult =
  Readonly<DecisionResultWire>;

export interface ControllerTestReviewDecisionPublicCoordinatorOptions {
  readonly decision?: ControllerTestReviewDecisionOptions;
}

type EventAuthority =
  ControllerTestReviewDecisionServiceError["eventAuthority"];

export type ControllerTestReviewDecisionPublicCoordinatorErrorReason =
  "root" | "privacy" | "decision" | "output";

const ERROR_MESSAGES = {
  root: "Controller Test Review Decision workspace root is invalid.",
  privacy:
    "Controller Test Review Decision contains a private workspace value.",
  decision: "Controller Test Review Decision operation failed.",
  output: "Controller Test Review Decision result violated its boundary.",
} as const satisfies Readonly<
  Record<ControllerTestReviewDecisionPublicCoordinatorErrorReason, string>
>;

export class ControllerTestReviewDecisionPublicCoordinatorError extends Error {
  override readonly name = "ControllerTestReviewDecisionPublicCoordinatorError";
  readonly code =
    "wakeflow-controller-test-review-decision-public-coordinator" as const;
  readonly reason: ControllerTestReviewDecisionPublicCoordinatorErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly eventAuthority: EventAuthority;

  constructor(
    reason: ControllerTestReviewDecisionPublicCoordinatorErrorReason,
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

const CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_MAXIMUM_RESULT_BYTES =
  4 * 1024 * 1024;
const validateResult = createRuntimeJsonSchemaValidator<DecisionResultWire>(
  WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_RESULT_SCHEMA,
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
  reason: ControllerTestReviewDecisionPublicCoordinatorErrorReason,
  cause?: unknown,
  eventAuthority: EventAuthority = cause instanceof
  ControllerTestReviewDecisionServiceError
    ? cause.eventAuthority
    : "unchanged",
): never {
  throw new ControllerTestReviewDecisionPublicCoordinatorError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    eventAuthority,
  );
}

function judgment(
  value: Readonly<ControllerTestReviewJudgment>,
): Readonly<ControllerTestReviewJudgment> {
  return Object.freeze({
    decision: value.decision,
    assessment: value.assessment,
    independentChecks: value.independentChecks,
    rationale: value.rationale,
    blockingReasons: value.blockingReasons,
    residualRisks: value.residualRisks,
  });
}

function expectedPhase(decision: Readonly<ControllerTestReviewDecision>) {
  switch (decision.decision) {
    case "accept":
      return "test-accepted" as const;
    case "request-another-attempt":
      return "test-another-attempt-requested" as const;
    case "escalate-product-defect":
      return "test-product-defect" as const;
    case "blocked":
      return "test-review-blocked" as const;
  }
}

function projectDecisionResult(
  result: Awaited<ReturnType<ControllerTestReviewDecisionService["decide"]>>,
  request: ReturnType<typeof parseControllerTestReviewDecisionPublicRequest>,
) {
  const { decision, commandResult } = result;
  const event = commandResult.commit.events.find(
    (entry) =>
      entry.eventType === "review.target-result-decided" &&
      entry.eventId === controllerTestReviewDecisionEventId(decision),
  );
  const target = commandResult.aggregate.state.targetTasks.find(
    (entry) => entry.targetTaskId === decision.targetTaskId,
  );
  const committedStateMatches =
    result.disposition === "idempotent" ||
    (event !== undefined &&
      target !== undefined &&
      target.phase === expectedPhase(decision) &&
      target.currentDelivery.reviewDecision.targetReviewDecisionId ===
        decision.targetReviewDecisionId &&
      target.currentDelivery.reviewDecision.decisionDigest ===
        decision.decisionDigest &&
      event.resultingStateDigest === commandResult.aggregate.stateDigest);
  if (
    event === undefined ||
    !committedStateMatches ||
    result.eventAuthority !== "current" ||
    decision.demandId !== request.demandId ||
    decision.reviewed.targetResultId !== request.targetResultId ||
    decision.reviewed.snapshotDigest !== request.snapshotDigest ||
    decision.reviewed.reviewUnitDigest !== request.reviewUnitDigest ||
    canonicalizeJson(judgment(decision), "$decisionJudgment") !==
      canonicalizeJson(judgment(request), "$requestJudgment") ||
    (result.status === "decided") !== (result.disposition === "committed") ||
    commandResult.commit.events.length !== 1 ||
    commandResult.commit.commitId !==
      controllerTestReviewDecisionCommitId(decision) ||
    commandResult.commit.demandId !== request.demandId ||
    commandResult.commit.commandDigest !== result.commandDigest ||
    commandResult.commit.expectedStreamRevision !==
      decision.reviewed.streamRevision ||
    commandResult.commit.firstStreamRevision !== event.streamRevision ||
    commandResult.commit.lastStreamRevision !== event.streamRevision ||
    event.streamRevision !== commandResult.commit.expectedStreamRevision + 1 ||
    event.demandId !== request.demandId ||
    event.eventType !== "review.target-result-decided" ||
    canonicalizeJson(event.data.decision, "$eventDecision") !==
      canonicalizeJson(decision, "$decision") ||
    computeDemandEventStreamCommitDigest(commandResult.commit) !==
      result.commitDigest
  ) {
    fail("output", undefined, "current");
  }
  return {
    kind: "WakeflowControllerTestReviewDecisionResult" as const,
    schemaVersion:
      WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME,
    status: result.status,
    disposition: result.disposition,
    eventAuthority: "current" as const,
    decision,
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
): ControllerTestReviewDecisionPublicResult {
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
      CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_MAXIMUM_RESULT_BYTES ||
    !validated.ok ||
    (requestRoot.length > 1 && containsText(json, requestRoot)) ||
    (canonicalRoot.length > 1 && containsText(json, canonicalRoot))
  ) {
    fail("output", undefined, "current");
  }
  return json as unknown as ControllerTestReviewDecisionPublicResult;
}

/** 记录Controller已经独立形成的Test Review Decision。 */
export async function executeControllerTestReviewDecisionPublicRequest(
  value: unknown,
  options: ControllerTestReviewDecisionPublicCoordinatorOptions = {},
): Promise<ControllerTestReviewDecisionPublicResult> {
  const request = parseControllerTestReviewDecisionPublicRequest(value);
  let root: RootedDirectory;
  try {
    root = await RootedDirectory.open(request.root, "$request.root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root", error);
    throw error;
  }

  let eventAuthority: EventAuthority = "unchanged";
  let result: ControllerTestReviewDecisionPublicResult | undefined;
  let failure: unknown;
  try {
    const { root: _root, ...decisionRequest } = request;
    if (
      root.absolutePath.length > 1 &&
      containsText(decisionRequest as JsonValue, root.absolutePath)
    ) {
      fail("privacy");
    }
    let decided;
    try {
      decided = await new ControllerTestReviewDecisionService(root).decide(
        decisionRequest,
        options.decision,
      );
      eventAuthority = "current";
    } catch (error: unknown) {
      if (error instanceof ControllerTestReviewDecisionServiceError) {
        fail("decision", error);
      }
      throw error;
    }
    result = publicResult(
      projectDecisionResult(decided, request),
      request.root,
      root.absolutePath,
    );
  } catch (error: unknown) {
    if (error instanceof ControllerTestReviewDecisionPublicCoordinatorError) {
      eventAuthority = error.eventAuthority;
    }
    failure = error;
  }

  try {
    await root.close();
  } catch (error: unknown) {
    if (failure === undefined) {
      failure = new ControllerTestReviewDecisionPublicCoordinatorError(
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

export { ControllerTestReviewDecisionPublicContractError };
