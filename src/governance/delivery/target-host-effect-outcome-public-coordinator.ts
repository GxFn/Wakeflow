import { types } from "node:util";

import {
  WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_RESULT_SCHEMA,
  type WakeflowTargetHostEffectOutcomeResultV1 as OutcomeResultWire,
} from "../../contracts/generated/entrypoints/wakeflow-target-host-effect-outcome-result.generated.js";
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
import {
  WAKEFLOW_WORKSPACE_HOST_IDS,
  type WakeflowWorkspaceHostId,
} from "../../workspace/workspace-host-resource-profile.js";
import { computeDemandEventStreamCommitDigest } from "../demand/event-sourcing/demand-event-stream-commit.js";
import {
  parseTargetHostEffectOutcomePublicRequest,
  TargetHostEffectOutcomePublicContractError,
  WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME,
} from "./target-host-effect-outcome-public-contract.js";
import {
  TargetHostEffectOutcomeService,
  TargetHostEffectOutcomeServiceError,
  type TargetHostEffectOutcomeClaimAuthority,
  type TargetHostEffectOutcomeEventAuthority,
} from "./target-host-effect-outcome-service.js";
import type { TargetHostEffectOutcomeOptions } from "./target-host-effect-outcome-input.js";
import {
  targetDeliveryHostEffectDisposition,
  targetDeliveryHostEffectObservationCommitId,
  targetDeliveryHostEffectObservationEventId,
} from "./target-delivery-host-effect-observation.js";
import type { WindowWorkClaim } from "./window-work-claim.js";

/**
 * Wakeflow Governance / Delivery：固定当前Host的Outcome公共投影边界。
 *
 * Coordinator不执行或重试宿主效果。它只把当前Host作为非请求权威注入内部Service，
 * 复验唯一Observed Event及Claim结算结果，并删除raw evidence、root、prompt和内部
 * Command/Aggregate表面。
 */

export type TargetHostEffectOutcomePublicResult = Readonly<OutcomeResultWire>;

export interface TargetHostEffectOutcomePublicHostFacade {
  readonly hostId: WakeflowWorkspaceHostId;
}

export interface TargetHostEffectOutcomePublicCoordinatorOptions {
  readonly outcome?: TargetHostEffectOutcomeOptions;
}

export type TargetHostEffectOutcomePublicCoordinatorErrorReason =
  "host" | "root" | "outcome" | "output";

const ERROR_MESSAGES = {
  host: "Target Host Effect Outcome public host composition is invalid.",
  root: "Target Host Effect Outcome public workspace root is invalid.",
  outcome: "Target Host Effect Outcome public operation failed.",
  output: "Target Host Effect Outcome public result violated its boundary.",
} as const satisfies Readonly<
  Record<TargetHostEffectOutcomePublicCoordinatorErrorReason, string>
>;

/** 公共Outcome编排失败时保留Claim/Event双权威状态，但不回显私密输入。 */
export class TargetHostEffectOutcomePublicCoordinatorError extends Error {
  override readonly name = "TargetHostEffectOutcomePublicCoordinatorError";
  readonly code =
    "wakeflow-target-host-effect-outcome-public-coordinator" as const;
  readonly reason: TargetHostEffectOutcomePublicCoordinatorErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly claimAuthority: TargetHostEffectOutcomeClaimAuthority;
  readonly eventAuthority: TargetHostEffectOutcomeEventAuthority;

  constructor(
    reason: TargetHostEffectOutcomePublicCoordinatorErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    claimAuthority: TargetHostEffectOutcomeClaimAuthority = "unknown",
    eventAuthority: TargetHostEffectOutcomeEventAuthority = "unchanged",
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
    this.claimAuthority = claimAuthority;
    this.eventAuthority = eventAuthority;
  }
}

const TARGET_HOST_EFFECT_OUTCOME_PUBLIC_MAXIMUM_RESULT_BYTES = 128 * 1024;
const validateResult = createRuntimeJsonSchemaValidator<OutcomeResultWire>(
  WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_RESULT_SCHEMA,
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
  reason: TargetHostEffectOutcomePublicCoordinatorErrorReason,
  cause?: unknown,
  claimAuthority: TargetHostEffectOutcomeClaimAuthority = cause instanceof
  TargetHostEffectOutcomeServiceError
    ? cause.claimAuthority
    : "unknown",
  eventAuthority: TargetHostEffectOutcomeEventAuthority = cause instanceof
  TargetHostEffectOutcomeServiceError
    ? cause.eventAuthority
    : "unchanged",
): never {
  throw new TargetHostEffectOutcomePublicCoordinatorError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    claimAuthority,
    eventAuthority,
  );
}

function assertFacade(
  value: Readonly<TargetHostEffectOutcomePublicHostFacade>,
): Readonly<TargetHostEffectOutcomePublicHostFacade> {
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    !Object.isFrozen(value) ||
    Object.keys(value).length !== 1
  ) {
    fail("host");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, "hostId");
  const hostId =
    descriptor !== undefined && Object.hasOwn(descriptor, "value")
      ? descriptor.value
      : undefined;
  if (
    typeof hostId !== "string" ||
    !WAKEFLOW_WORKSPACE_HOST_IDS.some((candidate) => candidate === hostId)
  ) {
    fail("host");
  }
  return Object.freeze({ hostId: hostId as WakeflowWorkspaceHostId });
}

function targetSummary(claim: Readonly<WindowWorkClaim>) {
  return claim.target.workType === "test"
    ? {
        workType: "test" as const,
        demandId: claim.target.demandId,
        targetTaskId: claim.target.targetTaskId,
        targetDeliveryId: claim.target.targetDeliveryId,
        testAttemptId: claim.target.testAttemptId,
        testDispatchPacketDigest: claim.target.testDispatchPacketDigest,
      }
    : {
        workType: "implementation" as const,
        demandId: claim.target.demandId,
        targetTaskId: claim.target.targetTaskId,
        targetDeliveryId: claim.target.targetDeliveryId,
      };
}

function observationSummary(
  observation: Awaited<
    ReturnType<TargetHostEffectOutcomeService["record"]>
  >["observation"],
) {
  return {
    kind: "WakeflowTargetHostEffectObservationSummary" as const,
    schemaVersion: 1 as const,
    source: "agent-host-effect-observation" as const,
    attempt: observation.attempt,
    readback: observation.readback,
    observedAt: observation.observedAt,
    observationDigest: observation.observationDigest,
  };
}

function projectOutcomeResult(
  result: Awaited<ReturnType<TargetHostEffectOutcomeService["record"]>>,
  request: ReturnType<typeof parseTargetHostEffectOutcomePublicRequest>,
  hostId: WakeflowWorkspaceHostId,
) {
  const { claim, observation, commandResult } = result;
  const event = commandResult.commit.events.find(
    (entry) =>
      entry.eventType === "delivery.target-host-effect-observed" &&
      entry.eventId ===
        targetDeliveryHostEffectObservationEventId(claim.claimId),
  );
  const action = observation.action;
  const commonActionMatches =
    action.actionId === claim.claimId &&
    action.targetDeliveryId === claim.target.targetDeliveryId &&
    action.intentDigest === claim.target.intentDigest &&
    action.hostId === claim.route.hostId &&
    action.windowId === claim.route.windowId &&
    action.bindingId === claim.route.bindingId &&
    action.claimDigest === claim.claimDigest &&
    action.hostObservationAuthorityDigest ===
      claim.hostObservation.authorityDigest &&
    action.claimEventId === claim.claimTransition.eventId &&
    action.claimCommitId === claim.claimTransition.commitId &&
    action.claimEventStreamRevision ===
      claim.claimTransition.expectedStreamRevision + 1 &&
    action.claimExpectedStateDigest ===
      claim.claimTransition.expectedStateDigest &&
    action.issuedAt === claim.claimedAt;
  const workTypeMatches =
    claim.target.workType === "test"
      ? action.workType === "test" &&
        action.testAttemptId === claim.target.testAttemptId &&
        action.testDispatchPacketDigest ===
          claim.target.testDispatchPacketDigest
      : action.workType === undefined;
  const expectedClaimHandling =
    result.effectDisposition === "rejected-before-effect"
      ? "release-authorized"
      : "retain";
  const expectedClaimAuthority =
    result.effectDisposition === "rejected-before-effect"
      ? "released"
      : "current";
  if (
    event === undefined ||
    commandResult.commit.events.length !== 1 ||
    claim.route.hostId !== hostId ||
    claim.target.demandId !== request.demandId ||
    claim.claimId !== request.actionId ||
    claim.claimDigest !== request.claimDigest ||
    !commonActionMatches ||
    !workTypeMatches ||
    result.eventAuthority !== "current" ||
    result.claimHandling !== expectedClaimHandling ||
    result.claimAuthority !== expectedClaimAuthority ||
    result.effectDisposition !==
      targetDeliveryHostEffectDisposition(observation) ||
    (result.status === "recorded") !== (result.disposition === "committed") ||
    commandResult.commit.commitId !==
      targetDeliveryHostEffectObservationCommitId(claim.claimId) ||
    commandResult.commit.demandId !== claim.target.demandId ||
    commandResult.commit.commandDigest !== result.commandDigest ||
    commandResult.commit.firstStreamRevision !== event.streamRevision ||
    commandResult.commit.lastStreamRevision !== event.streamRevision ||
    event.streamRevision !== commandResult.commit.expectedStreamRevision + 1 ||
    event.demandId !== claim.target.demandId ||
    event.eventType !== "delivery.target-host-effect-observed" ||
    canonicalizeJson(event.data.observation, "$eventObservation") !==
      canonicalizeJson(observation, "$observation") ||
    computeDemandEventStreamCommitDigest(commandResult.commit) !==
      result.commitDigest
  ) {
    fail("output", undefined, result.claimAuthority, "current");
  }
  return {
    kind: "WakeflowTargetHostEffectOutcomeResult" as const,
    schemaVersion: WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME,
    status: result.status,
    disposition: result.disposition,
    effectDisposition: result.effectDisposition,
    claimHandling: result.claimHandling,
    claimAuthority: result.claimAuthority,
    eventAuthority: "current" as const,
    target: targetSummary(claim),
    claim: {
      actionId: claim.claimId,
      claimDigest: claim.claimDigest,
    },
    observation: observationSummary(observation),
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

function containsPrivateRoot(
  value: JsonValue,
  requestRoot: string,
  canonicalRoot: string,
): boolean {
  if (typeof value === "string") {
    return (
      value.includes(requestRoot) ||
      value.includes(JSON.stringify(requestRoot)) ||
      value.includes(canonicalRoot) ||
      value.includes(JSON.stringify(canonicalRoot))
    );
  }
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some((entry) =>
    containsPrivateRoot(entry, requestRoot, canonicalRoot),
  );
}

function publicResult(
  value: unknown,
  requestRoot: string,
  canonicalRoot: string,
  claimAuthority: TargetHostEffectOutcomeClaimAuthority,
): TargetHostEffectOutcomePublicResult {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$result");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) {
      fail("output", error, claimAuthority, "current");
    }
    throw error;
  }
  const validated = validateResult(json);
  if (
    encodeCanonicalJson(json, "$result").byteLength >
      TARGET_HOST_EFFECT_OUTCOME_PUBLIC_MAXIMUM_RESULT_BYTES ||
    !validated.ok ||
    containsPrivateRoot(json, requestRoot, canonicalRoot)
  ) {
    fail("output", undefined, claimAuthority, "current");
  }
  return json as unknown as TargetHostEffectOutcomePublicResult;
}

/** 记录一次已经发生的当前Host目标效果观察；本函数不会调用或重试宿主能力。 */
export async function executeTargetHostEffectOutcomePublicRequest(
  facadeValue: Readonly<TargetHostEffectOutcomePublicHostFacade>,
  value: unknown,
  options: TargetHostEffectOutcomePublicCoordinatorOptions = {},
): Promise<TargetHostEffectOutcomePublicResult> {
  const facade = assertFacade(facadeValue);
  const request = parseTargetHostEffectOutcomePublicRequest(value);
  let root: RootedDirectory;
  try {
    root = await RootedDirectory.open(request.root, "$request.root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root", error);
    throw error;
  }

  let claimAuthority: TargetHostEffectOutcomeClaimAuthority = "unknown";
  let eventAuthority: TargetHostEffectOutcomeEventAuthority = "unchanged";
  let result: TargetHostEffectOutcomePublicResult | undefined;
  let failure: unknown;
  try {
    let recorded;
    try {
      recorded = await new TargetHostEffectOutcomeService(
        root,
        facade.hostId,
      ).record(
        {
          demandId: request.demandId,
          actionId: request.actionId,
          claimDigest: request.claimDigest,
          attempt: request.attempt,
          readback: request.readback,
          observedAt: request.observedAt,
        },
        options.outcome,
      );
      claimAuthority = recorded.claimAuthority;
      eventAuthority = "current";
    } catch (error: unknown) {
      if (error instanceof TargetHostEffectOutcomeServiceError) {
        fail(error.reason === "host" ? "host" : "outcome", error);
      }
      throw error;
    }
    result = publicResult(
      projectOutcomeResult(recorded, request, facade.hostId),
      request.root,
      root.absolutePath,
      recorded.claimAuthority,
    );
  } catch (error: unknown) {
    if (error instanceof TargetHostEffectOutcomePublicCoordinatorError) {
      claimAuthority = error.claimAuthority;
      eventAuthority = error.eventAuthority;
    }
    failure = error;
  }

  try {
    await root.close();
  } catch (error: unknown) {
    if (failure === undefined) {
      failure = new TargetHostEffectOutcomePublicCoordinatorError(
        "root",
        ownString(error, "code"),
        ownString(error, "reason"),
        claimAuthority,
        eventAuthority,
      );
    }
  }
  if (failure !== undefined) throw failure;
  if (result === undefined) {
    fail("output", undefined, claimAuthority, eventAuthority);
  }
  return result;
}

export { TargetHostEffectOutcomePublicContractError };
