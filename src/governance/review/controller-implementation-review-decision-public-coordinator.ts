import {
  WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_RESULT_SCHEMA,
  type WakeflowControllerImplementationReviewDecisionResultV1 as DecisionResultWire,
} from "../../contracts/generated/entrypoints/wakeflow-controller-implementation-review-decision-result.generated.js";
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
  controllerImplementationReviewDecisionCommitId,
  controllerImplementationReviewDecisionEventId,
  type ControllerImplementationReviewDecision,
  type ControllerImplementationReviewJudgment,
} from "./controller-implementation-review-decision.js";
import {
  parseControllerImplementationReviewDecisionPublicRequest,
  ControllerImplementationReviewDecisionPublicContractError,
  WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
} from "./controller-implementation-review-decision-public-contract.js";
import type { ControllerImplementationReviewDecisionOptions } from "./controller-implementation-review-decision-input.js";
import {
  ControllerImplementationReviewDecisionService,
  ControllerImplementationReviewDecisionServiceError,
} from "./controller-implementation-review-decision-service.js";

/**
 * Wakeflow Governance / Review：Controller Implementation Decision公共提交边界。
 *
 * Coordinator只记录Controller已经形成的独立判断。它不运行检查、不从TargetResult
 * 自动推导Decision，也不执行后续Delivery、Design、Test或Demand completion。
 */

export type ControllerImplementationReviewDecisionPublicResult =
  Readonly<DecisionResultWire>;

export interface ControllerImplementationReviewDecisionPublicCoordinatorOptions {
  readonly decision?: ControllerImplementationReviewDecisionOptions;
}

type EventAuthority =
  ControllerImplementationReviewDecisionServiceError["eventAuthority"];

export type ControllerImplementationReviewDecisionPublicCoordinatorErrorReason =
  "root" | "privacy" | "decision" | "output";

const ERROR_MESSAGES = {
  root: "Controller Implementation Review Decision workspace root is invalid.",
  privacy:
    "Controller Implementation Review Decision contains a private workspace value.",
  decision: "Controller Implementation Review Decision operation failed.",
  output:
    "Controller Implementation Review Decision result violated its boundary.",
} as const satisfies Readonly<
  Record<
    ControllerImplementationReviewDecisionPublicCoordinatorErrorReason,
    string
  >
>;

export class ControllerImplementationReviewDecisionPublicCoordinatorError extends Error {
  override readonly name =
    "ControllerImplementationReviewDecisionPublicCoordinatorError";
  readonly code =
    "wakeflow-controller-implementation-review-decision-public-coordinator" as const;
  readonly reason: ControllerImplementationReviewDecisionPublicCoordinatorErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly eventAuthority: EventAuthority;

  constructor(
    reason: ControllerImplementationReviewDecisionPublicCoordinatorErrorReason,
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

const CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_MAXIMUM_RESULT_BYTES =
  4 * 1024 * 1024;
const validateResult = createRuntimeJsonSchemaValidator<DecisionResultWire>(
  WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_RESULT_SCHEMA,
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
  reason: ControllerImplementationReviewDecisionPublicCoordinatorErrorReason,
  cause?: unknown,
  eventAuthority: EventAuthority = cause instanceof
  ControllerImplementationReviewDecisionServiceError
    ? cause.eventAuthority
    : "unchanged",
): never {
  throw new ControllerImplementationReviewDecisionPublicCoordinatorError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    eventAuthority,
  );
}

function judgment(
  value: Readonly<ControllerImplementationReviewJudgment>,
): Readonly<ControllerImplementationReviewJudgment> {
  return Object.freeze({
    decision: value.decision,
    assessment: value.assessment,
    independentChecks: value.independentChecks,
    rationale: value.rationale,
    blockingReasons: value.blockingReasons,
    residualRisks: value.residualRisks,
  });
}

function expectedPhase(
  decision: Readonly<ControllerImplementationReviewDecision>,
) {
  switch (decision.decision) {
    case "accept":
      return "accepted" as const;
    case "rework":
      return "rework-requested" as const;
    case "redesign":
      return "redesign-requested" as const;
    case "blocked":
      return "review-blocked" as const;
  }
}

function projectDecisionResult(
  result: Awaited<
    ReturnType<ControllerImplementationReviewDecisionService["decide"]>
  >,
  request: ReturnType<
    typeof parseControllerImplementationReviewDecisionPublicRequest
  >,
) {
  const { decision, commandResult } = result;
  const event = commandResult.commit.events.find(
    (entry) =>
      entry.eventType === "review.target-result-decided" &&
      entry.eventId === controllerImplementationReviewDecisionEventId(decision),
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
      controllerImplementationReviewDecisionCommitId(decision) ||
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
    kind: "WakeflowControllerImplementationReviewDecisionResult" as const,
    schemaVersion:
      WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
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
): ControllerImplementationReviewDecisionPublicResult {
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
      CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_MAXIMUM_RESULT_BYTES ||
    !validated.ok ||
    (requestRoot.length > 1 && containsText(json, requestRoot)) ||
    (canonicalRoot.length > 1 && containsText(json, canonicalRoot))
  ) {
    fail("output", undefined, "current");
  }
  return json as unknown as ControllerImplementationReviewDecisionPublicResult;
}

/** 记录Controller已经独立形成的Implementation Review Decision。 */
export async function executeControllerImplementationReviewDecisionPublicRequest(
  value: unknown,
  options: ControllerImplementationReviewDecisionPublicCoordinatorOptions = {},
): Promise<ControllerImplementationReviewDecisionPublicResult> {
  const request =
    parseControllerImplementationReviewDecisionPublicRequest(value);
  let root: RootedDirectory;
  try {
    root = await RootedDirectory.open(request.root, "$request.root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root", error);
    throw error;
  }

  let eventAuthority: EventAuthority = "unchanged";
  let result: ControllerImplementationReviewDecisionPublicResult | undefined;
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
      decided = await new ControllerImplementationReviewDecisionService(
        root,
      ).decide(decisionRequest, options.decision);
      eventAuthority = "current";
    } catch (error: unknown) {
      if (error instanceof ControllerImplementationReviewDecisionServiceError) {
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
    if (
      error instanceof
      ControllerImplementationReviewDecisionPublicCoordinatorError
    ) {
      eventAuthority = error.eventAuthority;
    }
    failure = error;
  }

  try {
    await root.close();
  } catch (error: unknown) {
    if (failure === undefined) {
      failure =
        new ControllerImplementationReviewDecisionPublicCoordinatorError(
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

export { ControllerImplementationReviewDecisionPublicContractError };
