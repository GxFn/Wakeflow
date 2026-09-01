import {
  WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_RESULT_SCHEMA,
  type WakeflowTargetResultReviewResumeResultV1 as ResumeResultWire,
} from "../../contracts/generated/entrypoints/wakeflow-target-result-review-resume-result.generated.js";
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
  controllerTargetReviewResumeCommitId,
  controllerTargetReviewResumeEventId,
} from "./controller-target-review-resume.js";
import type { ControllerTargetReviewResumeOptions } from "./controller-target-review-resume-input.js";
import {
  ControllerTargetReviewResumeService,
  ControllerTargetReviewResumeServiceError,
} from "./controller-target-review-resume-service.js";
import {
  parseTargetResultReviewResumePublicRequest,
  TargetResultReviewResumePublicContractError,
  type TargetResultReviewResumePublicRequest,
  WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_PUBLIC_TOOL_NAME,
} from "./target-result-review-resume-public-contract.js";

/**
 * Wakeflow Governance / Review：公共TargetResult Review Resume Event边界。
 *
 * Coordinator只记录Controller对一个精确blocked generation的外部解决陈述。它不运行检查、
 * 不判断阻断是否真实解决，也不accept、rework、redesign、创建Test attempt或执行宿主效果。
 */

export type TargetResultReviewResumePublicResult = Readonly<ResumeResultWire>;

export interface TargetResultReviewResumePublicCoordinatorOptions {
  readonly resume?: ControllerTargetReviewResumeOptions;
}

type EventAuthority =
  ControllerTargetReviewResumeServiceError["eventAuthority"];

export type TargetResultReviewResumePublicCoordinatorErrorReason =
  "root" | "privacy" | "resume" | "output";

const ERROR_MESSAGES = {
  root: "Target Result Review Resume workspace root is invalid.",
  privacy: "Target Result Review Resume contains a private workspace value.",
  resume: "Target Result Review Resume operation failed.",
  output: "Target Result Review Resume result violated its boundary.",
} as const satisfies Readonly<
  Record<TargetResultReviewResumePublicCoordinatorErrorReason, string>
>;

/** 公共Resume失败时保留稳定分类和Event authority。 */
export class TargetResultReviewResumePublicCoordinatorError extends Error {
  override readonly name = "TargetResultReviewResumePublicCoordinatorError";
  readonly code =
    "wakeflow-target-result-review-resume-public-coordinator" as const;
  readonly reason: TargetResultReviewResumePublicCoordinatorErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly eventAuthority: EventAuthority;

  constructor(
    reason: TargetResultReviewResumePublicCoordinatorErrorReason,
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

const TARGET_RESULT_REVIEW_RESUME_PUBLIC_MAXIMUM_RESULT_BYTES = 4 * 1024 * 1024;
const validateResult = createRuntimeJsonSchemaValidator<ResumeResultWire>(
  WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_RESULT_SCHEMA,
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
  reason: TargetResultReviewResumePublicCoordinatorErrorReason,
  cause?: unknown,
  eventAuthority: EventAuthority = cause instanceof
  ControllerTargetReviewResumeServiceError
    ? cause.eventAuthority
    : "unchanged",
): never {
  throw new TargetResultReviewResumePublicCoordinatorError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    eventAuthority,
  );
}

function projectResult(
  result: Awaited<ReturnType<ControllerTargetReviewResumeService["resume"]>>,
  request: Readonly<TargetResultReviewResumePublicRequest>,
) {
  const { commandResult, resume } = result;
  const event = commandResult.commit.events.find(
    (entry) =>
      entry.eventId === controllerTargetReviewResumeEventId(resume) &&
      entry.eventType === "review.target-result-resumed",
  );
  const target = commandResult.aggregate.state.targetTasks.find(
    (entry) => entry.targetTaskId === resume.targetTaskId,
  );
  const committedStateMatches =
    result.disposition === "idempotent" ||
    (event !== undefined &&
      target !== undefined &&
      target.phase ===
        (target.workType === "test"
          ? "test-result-reported"
          : "result-reported") &&
      commandResult.aggregate.streamRevision === event.streamRevision &&
      commandResult.aggregate.stateDigest === event.resultingStateDigest);
  if (
    event === undefined ||
    !committedStateMatches ||
    result.eventAuthority !== "current" ||
    resume.demandId !== request.demandId ||
    resume.targetTaskId !== request.targetTaskId ||
    resume.blockedSource.streamRevision !==
      request.expectedBlockedState.streamRevision ||
    resume.blockedSource.stateDigest !==
      request.expectedBlockedState.stateDigest ||
    resume.resolutionSummary !== request.resolutionSummary ||
    (result.status === "resumed") !== (result.disposition === "committed") ||
    commandResult.commit.events.length !== 1 ||
    commandResult.commit.commitId !==
      controllerTargetReviewResumeCommitId(resume) ||
    commandResult.commit.demandId !== request.demandId ||
    commandResult.commit.commandDigest !== result.commandDigest ||
    commandResult.commit.expectedStreamRevision !==
      resume.blockedSource.streamRevision ||
    commandResult.commit.firstStreamRevision !== event.streamRevision ||
    commandResult.commit.lastStreamRevision !== event.streamRevision ||
    event.streamRevision !== resume.blockedSource.streamRevision + 1 ||
    event.demandId !== request.demandId ||
    event.recordedAt !== resume.resumedAt ||
    canonicalizeJson(event.data.resume, "$eventResume") !==
      canonicalizeJson(resume, "$resume") ||
    computeDemandEventStreamCommitDigest(commandResult.commit) !==
      result.commitDigest
  ) {
    fail("output", undefined, "current");
  }
  return {
    kind: "WakeflowTargetResultReviewResumeResult" as const,
    schemaVersion: WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_PUBLIC_TOOL_NAME,
    status: result.status,
    disposition: result.disposition,
    eventAuthority: "current" as const,
    resume,
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

function containsPrivateText(value: JsonValue, privateText: string): boolean {
  if (typeof value === "string") {
    return (
      value.includes(privateText) || value.includes(JSON.stringify(privateText))
    );
  }
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some((entry) =>
    containsPrivateText(entry, privateText),
  );
}

function publicResult(
  value: unknown,
  requestRoot: string,
  canonicalRoot: string,
  eventAuthority: EventAuthority,
): TargetResultReviewResumePublicResult {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$result");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("output", error, eventAuthority);
    throw error;
  }
  const validated = validateResult(json);
  if (
    encodeCanonicalJson(json, "$result").byteLength >
      TARGET_RESULT_REVIEW_RESUME_PUBLIC_MAXIMUM_RESULT_BYTES ||
    !validated.ok ||
    (requestRoot.length > 1 && containsPrivateText(json, requestRoot)) ||
    (canonicalRoot.length > 1 && containsPrivateText(json, canonicalRoot))
  ) {
    fail("output", undefined, eventAuthority);
  }
  return json as unknown as TargetResultReviewResumePublicResult;
}

/** 记录一个精确blocked generation的Controller Resume陈述。 */
export async function executeTargetResultReviewResumePublicRequest(
  value: unknown,
  options: TargetResultReviewResumePublicCoordinatorOptions = {},
): Promise<TargetResultReviewResumePublicResult> {
  const request = parseTargetResultReviewResumePublicRequest(value);
  let root: RootedDirectory;
  try {
    root = await RootedDirectory.open(request.root, "$request.root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root", error);
    throw error;
  }

  let eventAuthority: EventAuthority = "unchanged";
  let result: TargetResultReviewResumePublicResult | undefined;
  let failure: unknown;
  try {
    if (
      (request.root.length > 1 &&
        containsPrivateText(request.resolutionSummary, request.root)) ||
      (root.absolutePath.length > 1 &&
        containsPrivateText(request.resolutionSummary, root.absolutePath))
    ) {
      fail("privacy");
    }
    const { root: _root, ...resumeRequest } = request;
    let resumed;
    try {
      resumed = await new ControllerTargetReviewResumeService(root).resume(
        resumeRequest,
        options.resume,
      );
      eventAuthority = "current";
    } catch (error: unknown) {
      if (error instanceof ControllerTargetReviewResumeServiceError) {
        eventAuthority = error.eventAuthority;
        fail("resume", error);
      }
      throw error;
    }
    result = publicResult(
      projectResult(resumed, request),
      request.root,
      root.absolutePath,
      eventAuthority,
    );
  } catch (error: unknown) {
    if (error instanceof TargetResultReviewResumePublicCoordinatorError) {
      eventAuthority = error.eventAuthority;
    }
    failure = error;
  }

  try {
    await root.close();
  } catch (error: unknown) {
    if (failure === undefined) {
      failure = new TargetResultReviewResumePublicCoordinatorError(
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

export { TargetResultReviewResumePublicContractError };
