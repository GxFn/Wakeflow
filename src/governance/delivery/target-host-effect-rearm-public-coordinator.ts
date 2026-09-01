import { types } from "node:util";

import {
  WAKEFLOW_TARGET_HOST_EFFECT_REARM_RESULT_SCHEMA,
  type WakeflowTargetHostEffectRearmResultV1 as RearmResultWire,
} from "../../contracts/generated/entrypoints/wakeflow-target-host-effect-rearm-result.generated.js";
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
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
  type WakeflowWorkspaceHostId,
  type WakeflowWorkspaceHostResourceProfile,
} from "../../workspace/workspace-host-resource-profile.js";
import {
  parseWakeflowWindowHostIdentityProfile,
  WakeflowWindowHostIdentityProfileError,
  type WakeflowWindowHostIdentityProfile,
} from "../../workspace/window-runtime/wakeflow-window-host-identity-profile.js";
import { computeDemandEventStreamCommitDigest } from "../demand/event-sourcing/demand-event-stream-commit.js";
import type { TargetHostEffectRearmOptions } from "./target-host-effect-rearm-input.js";
import {
  targetHostEffectRearmCommitId,
  targetHostEffectRearmEventId,
} from "./target-host-effect-rearm.js";
import {
  parseTargetHostEffectRearmPublicRequest,
  TargetHostEffectRearmPublicContractError,
  WAKEFLOW_TARGET_HOST_EFFECT_REARM_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_TARGET_HOST_EFFECT_REARM_PUBLIC_TOOL_NAME,
} from "./target-host-effect-rearm-public-contract.js";
import {
  TargetHostEffectRearmService,
  TargetHostEffectRearmServiceError,
} from "./target-host-effect-rearm-service.js";

/**
 * Wakeflow Governance / Delivery：固定当前Host的Implementation Rearm公共边界。
 *
 * Coordinator只追加Rearm Event并投影严格回执。它不执行Host Effect、不创建Claim、
 * 不返回Agent Host Action，也不把Test replacement混入同一工具。
 */

export type TargetHostEffectRearmPublicResult = Readonly<RearmResultWire>;

export interface TargetHostEffectRearmPublicHostFacade {
  readonly hostId: WakeflowWorkspaceHostId;
  readonly resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly identityProfile: Readonly<WakeflowWindowHostIdentityProfile>;
}

export interface TargetHostEffectRearmPublicCoordinatorOptions {
  readonly rearm?: TargetHostEffectRearmOptions;
}

type EventAuthority = TargetHostEffectRearmServiceError["eventAuthority"];

export type TargetHostEffectRearmPublicCoordinatorErrorReason =
  "host" | "root" | "rearm" | "output";

const ERROR_MESSAGES = {
  host: "Target Host Effect Rearm public host composition is invalid.",
  root: "Target Host Effect Rearm public workspace root is invalid.",
  rearm: "Target Host Effect Rearm public operation failed.",
  output: "Target Host Effect Rearm public result violated its boundary.",
} as const satisfies Readonly<
  Record<TargetHostEffectRearmPublicCoordinatorErrorReason, string>
>;

/** 公共Rearm编排失败时保留Rearm Event权威，不回显workspace或Host私密值。 */
export class TargetHostEffectRearmPublicCoordinatorError extends Error {
  override readonly name = "TargetHostEffectRearmPublicCoordinatorError";
  readonly code =
    "wakeflow-target-host-effect-rearm-public-coordinator" as const;
  readonly reason: TargetHostEffectRearmPublicCoordinatorErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly eventAuthority: EventAuthority;

  constructor(
    reason: TargetHostEffectRearmPublicCoordinatorErrorReason,
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

const TARGET_HOST_EFFECT_REARM_PUBLIC_MAXIMUM_RESULT_BYTES = 256 * 1024;
const validateResult = createRuntimeJsonSchemaValidator<RearmResultWire>(
  WAKEFLOW_TARGET_HOST_EFFECT_REARM_RESULT_SCHEMA,
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
  reason: TargetHostEffectRearmPublicCoordinatorErrorReason,
  cause?: unknown,
  eventAuthority: EventAuthority = cause instanceof
  TargetHostEffectRearmServiceError
    ? cause.eventAuthority
    : "unchanged",
): never {
  throw new TargetHostEffectRearmPublicCoordinatorError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    eventAuthority,
  );
}

function assertFacade(
  value: Readonly<TargetHostEffectRearmPublicHostFacade>,
): Readonly<TargetHostEffectRearmPublicHostFacade> {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      types.isProxy(value) ||
      !Object.isFrozen(value) ||
      Object.keys(value).sort().join("\u0000") !==
        "hostId\u0000identityProfile\u0000resourceProfile"
    ) {
      fail("host");
    }
    const resourceProfile = parseWakeflowWorkspaceHostResourceProfile(
      value.resourceProfile,
    );
    const identityProfile = parseWakeflowWindowHostIdentityProfile(
      value.identityProfile,
    );
    if (
      value.hostId !== resourceProfile.hostId ||
      value.hostId !== identityProfile.hostId ||
      !resourceProfile.surfaces.windowIdentity
    ) {
      fail("host");
    }
    return Object.freeze({
      hostId: resourceProfile.hostId,
      resourceProfile,
      identityProfile,
    });
  } catch (error: unknown) {
    if (error instanceof TargetHostEffectRearmPublicCoordinatorError) {
      throw error;
    }
    if (
      error instanceof WakeflowWorkspaceHostResourceProfileError ||
      error instanceof WakeflowWindowHostIdentityProfileError
    ) {
      fail("host", error);
    }
    throw error;
  }
}

function projectRearmResult(
  result: Awaited<ReturnType<TargetHostEffectRearmService["rearm"]>>,
  request: ReturnType<typeof parseTargetHostEffectRearmPublicRequest>,
  hostId: WakeflowWorkspaceHostId,
) {
  const { claim, observation, rearm, commandResult } = result;
  const event = commandResult.commit.events.find(
    (entry) =>
      entry.eventType === "delivery.target-host-effect-rearmed" &&
      entry.eventId === targetHostEffectRearmEventId(rearm),
  );
  const target = commandResult.aggregate.state.targetTasks.find(
    (entry) => entry.targetTaskId === rearm.target.targetTaskId,
  );
  const action = observation.action;
  const committedStateMatches =
    result.disposition === "idempotent" ||
    (target !== undefined &&
      target.phase === "delivery-prepared" &&
      target.currentDelivery.targetDeliveryId ===
        rearm.target.targetDeliveryId &&
      target.currentDelivery.hostId === claim.route.hostId &&
      target.currentDelivery.bindingId === claim.route.bindingId &&
      event?.resultingStateDigest === commandResult.aggregate.stateDigest);
  if (
    event === undefined ||
    !committedStateMatches ||
    commandResult.commit.events.length !== 1 ||
    result.claimAuthority !== "released" ||
    result.eventAuthority !== "current" ||
    "workType" in claim.target ||
    "workType" in action ||
    claim.route.hostId !== hostId ||
    claim.target.demandId !== request.demandId ||
    claim.claimId !== request.actionId ||
    observation.observationDigest !== request.observationDigest ||
    observation.attempt.status !== "rejected-before-effect" ||
    observation.readback.status !== "unavailable" ||
    action.actionId !== claim.claimId ||
    action.targetDeliveryId !== claim.target.targetDeliveryId ||
    action.intentDigest !== claim.target.intentDigest ||
    action.hostId !== claim.route.hostId ||
    action.windowId !== claim.route.windowId ||
    action.bindingId !== claim.route.bindingId ||
    action.claimDigest !== claim.claimDigest ||
    action.hostObservationAuthorityDigest !==
      claim.hostObservation.authorityDigest ||
    action.claimEventId !== claim.claimTransition.eventId ||
    action.claimCommitId !== claim.claimTransition.commitId ||
    action.claimEventStreamRevision !==
      claim.claimTransition.expectedStreamRevision + 1 ||
    action.claimExpectedStateDigest !==
      claim.claimTransition.expectedStateDigest ||
    action.issuedAt !== claim.claimedAt ||
    rearm.target.demandId !== request.demandId ||
    rearm.target.targetTaskId !== claim.target.targetTaskId ||
    rearm.target.targetDeliveryId !== claim.target.targetDeliveryId ||
    rearm.rejectedAttempt.claimId !== claim.claimId ||
    rearm.rejectedAttempt.claimDigest !== claim.claimDigest ||
    rearm.rejectedAttempt.claimEventId !== claim.claimTransition.eventId ||
    rearm.rejectedAttempt.claimCommitId !== claim.claimTransition.commitId ||
    rearm.rejectedAttempt.observationDigest !== observation.observationDigest ||
    (result.status === "rearmed") !== (result.disposition === "committed") ||
    commandResult.commit.commitId !== targetHostEffectRearmCommitId(rearm) ||
    commandResult.commit.demandId !== request.demandId ||
    commandResult.commit.commandDigest !== result.commandDigest ||
    commandResult.commit.firstStreamRevision !== event.streamRevision ||
    commandResult.commit.lastStreamRevision !== event.streamRevision ||
    event.streamRevision !== commandResult.commit.expectedStreamRevision + 1 ||
    event.demandId !== request.demandId ||
    event.eventType !== "delivery.target-host-effect-rearmed" ||
    canonicalizeJson(event.data.rearm, "$eventRearm") !==
      canonicalizeJson(rearm, "$rearm") ||
    computeDemandEventStreamCommitDigest(commandResult.commit) !==
      result.commitDigest
  ) {
    fail("output", undefined, "current");
  }
  return {
    kind: "WakeflowTargetHostEffectRearmResult" as const,
    schemaVersion: WAKEFLOW_TARGET_HOST_EFFECT_REARM_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_TARGET_HOST_EFFECT_REARM_PUBLIC_TOOL_NAME,
    status: result.status,
    disposition: result.disposition,
    claimAuthority: "released" as const,
    eventAuthority: "current" as const,
    rearm,
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
): TargetHostEffectRearmPublicResult {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$result");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) {
      fail("output", error, "current");
    }
    throw error;
  }
  const validated = validateResult(json);
  if (
    encodeCanonicalJson(json, "$result").byteLength >
      TARGET_HOST_EFFECT_REARM_PUBLIC_MAXIMUM_RESULT_BYTES ||
    !validated.ok ||
    containsPrivateRoot(json, requestRoot, canonicalRoot)
  ) {
    fail("output", undefined, "current");
  }
  return json as unknown as TargetHostEffectRearmPublicResult;
}

/** 显式Rearm一个已证明未发生的当前Host效果；本函数不创建Claim或执行宿主能力。 */
export async function executeTargetHostEffectRearmPublicRequest(
  facadeValue: Readonly<TargetHostEffectRearmPublicHostFacade>,
  value: unknown,
  options: TargetHostEffectRearmPublicCoordinatorOptions = {},
): Promise<TargetHostEffectRearmPublicResult> {
  const facade = assertFacade(facadeValue);
  const request = parseTargetHostEffectRearmPublicRequest(value);
  let root: RootedDirectory;
  try {
    root = await RootedDirectory.open(request.root, "$request.root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root", error);
    throw error;
  }

  let eventAuthority: EventAuthority = "unchanged";
  let result: TargetHostEffectRearmPublicResult | undefined;
  let failure: unknown;
  try {
    let rearmed;
    try {
      rearmed = await new TargetHostEffectRearmService(
        root,
        facade.resourceProfile,
        facade.identityProfile,
      ).rearm(
        {
          demandId: request.demandId,
          actionId: request.actionId,
          observationDigest: request.observationDigest,
        },
        options.rearm,
      );
      eventAuthority = "current";
    } catch (error: unknown) {
      if (error instanceof TargetHostEffectRearmServiceError) {
        fail(error.reason === "host" ? "host" : "rearm", error);
      }
      throw error;
    }
    result = publicResult(
      projectRearmResult(rearmed, request, facade.hostId),
      request.root,
      root.absolutePath,
    );
  } catch (error: unknown) {
    if (error instanceof TargetHostEffectRearmPublicCoordinatorError) {
      eventAuthority = error.eventAuthority;
    }
    failure = error;
  }

  try {
    await root.close();
  } catch (error: unknown) {
    if (failure === undefined) {
      failure = new TargetHostEffectRearmPublicCoordinatorError(
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

export { TargetHostEffectRearmPublicContractError };
