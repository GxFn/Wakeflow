import { types } from "node:util";

import {
  WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_RESULT_SCHEMA,
  type WakeflowTargetHostEffectClaimResultV1 as ClaimResultWire,
} from "../../contracts/generated/entrypoints/wakeflow-target-host-effect-claim-result.generated.js";
import {
  canonicalizeJson,
  encodeCanonicalJson,
} from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonObject,
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
import {
  parseTargetHostEffectClaimPublicRequest,
  TargetHostEffectClaimPublicContractError,
  WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME,
} from "./target-host-effect-claim-public-contract.js";
import {
  TargetHostEffectClaimService,
  TargetHostEffectClaimServiceError,
  type TargetHostEffectClaimAuthorityState,
} from "./target-host-effect-claim-service.js";
import type { TargetHostEffectClaimOptions } from "./target-host-effect-claim-input.js";
import type { WindowWorkClaim } from "./window-work-claim.js";
import { windowWorkClaimRef } from "./window-work-claim-resource-catalog.js";

/**
 * Wakeflow Governance / Delivery：共享Claim公共入口的固定Host与一次性Action边界。
 *
 * Coordinator不解释Claim准入，也不执行宿主效果。它只固定当前Host Profile、调用现有
 * Service、投影最小回执，并保证raw handle不进入结果。canonical workspace root只允许
 * 出现在首次issued Action的最终prompt后缀。
 */

export type TargetHostEffectClaimPublicResult = Readonly<ClaimResultWire>;

interface TargetHostEffectClaimPublicHostFacade {
  readonly hostId: WakeflowWorkspaceHostId;
  readonly resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly identityProfile: Readonly<WakeflowWindowHostIdentityProfile>;
}

export interface TargetHostEffectClaimPublicCoordinatorOptions {
  readonly claim?: TargetHostEffectClaimOptions;
}

export type TargetHostEffectClaimPublicCoordinatorErrorReason =
  "host" | "root" | "claim" | "output";

const ERROR_MESSAGES = {
  host: "Target Host Effect Claim public host composition is invalid.",
  root: "Target Host Effect Claim public workspace root is invalid.",
  claim: "Target Host Effect Claim public operation failed.",
  output:
    "Target Host Effect Claim public result violated its one-shot boundary.",
} as const satisfies Readonly<
  Record<TargetHostEffectClaimPublicCoordinatorErrorReason, string>
>;

/** 公共Claim编排失败时保留Claim/Event双权威状态，但不回显私密输入。 */
export class TargetHostEffectClaimPublicCoordinatorError extends Error {
  override readonly name = "TargetHostEffectClaimPublicCoordinatorError";
  readonly code =
    "wakeflow-target-host-effect-claim-public-coordinator" as const;
  readonly reason: TargetHostEffectClaimPublicCoordinatorErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly claimAuthority: TargetHostEffectClaimAuthorityState;
  readonly eventAuthority: TargetHostEffectClaimAuthorityState;

  constructor(
    reason: TargetHostEffectClaimPublicCoordinatorErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    claimAuthority: TargetHostEffectClaimAuthorityState = "unchanged",
    eventAuthority: TargetHostEffectClaimAuthorityState = "unchanged",
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
    this.claimAuthority = claimAuthority;
    this.eventAuthority = eventAuthority;
  }
}

const TARGET_HOST_EFFECT_CLAIM_PUBLIC_MAXIMUM_RESULT_BYTES = 512 * 1024;
const validateResult = createRuntimeJsonSchemaValidator<ClaimResultWire>(
  WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_RESULT_SCHEMA,
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
  reason: TargetHostEffectClaimPublicCoordinatorErrorReason,
  cause?: unknown,
  claimAuthority: TargetHostEffectClaimAuthorityState = cause instanceof
  TargetHostEffectClaimServiceError
    ? cause.claimAuthority
    : "unchanged",
  eventAuthority: TargetHostEffectClaimAuthorityState = cause instanceof
  TargetHostEffectClaimServiceError
    ? cause.eventAuthority
    : "unchanged",
): never {
  throw new TargetHostEffectClaimPublicCoordinatorError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    claimAuthority,
    eventAuthority,
  );
}

function assertFacade(
  facade: Readonly<TargetHostEffectClaimPublicHostFacade>,
): Readonly<TargetHostEffectClaimPublicHostFacade> {
  try {
    if (
      typeof facade !== "object" ||
      facade === null ||
      types.isProxy(facade) ||
      !Object.isFrozen(facade)
    ) {
      fail("host");
    }
    const resourceProfile = parseWakeflowWorkspaceHostResourceProfile(
      facade.resourceProfile,
    );
    const identityProfile = parseWakeflowWindowHostIdentityProfile(
      facade.identityProfile,
    );
    if (
      facade.hostId !== resourceProfile.hostId ||
      facade.hostId !== identityProfile.hostId ||
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
    if (error instanceof TargetHostEffectClaimPublicCoordinatorError) {
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

function claimSummary(claim: Readonly<WindowWorkClaim>) {
  const target =
    claim.target.workType === "test"
      ? {
          workType: "test" as const,
          demandId: claim.target.demandId,
          targetTaskId: claim.target.targetTaskId,
          targetDeliveryId: claim.target.targetDeliveryId,
          intentDigest: claim.target.intentDigest,
          testAttemptId: claim.target.testAttemptId,
          testDispatchPacketDigest: claim.target.testDispatchPacketDigest,
        }
      : {
          workType: "implementation" as const,
          demandId: claim.target.demandId,
          targetTaskId: claim.target.targetTaskId,
          targetDeliveryId: claim.target.targetDeliveryId,
          intentDigest: claim.target.intentDigest,
        };
  return {
    claimId: claim.claimId,
    claimRef: windowWorkClaimRef(claim.route.windowId),
    claimDigest: claim.claimDigest,
    claimedAt: claim.claimedAt,
    target,
    route: claim.route,
  };
}

function actionMatchesClaim(
  result: Awaited<ReturnType<TargetHostEffectClaimService["claim"]>>,
  event: Readonly<(typeof result.commandResult.commit.events)[number]>,
): boolean {
  const { action, claim } = result;
  if (result.status === "already-claimed") return action === null;
  if (action === null) return false;
  const common =
    action.actionId === claim.claimId &&
    action.hostId === claim.route.hostId &&
    action.windowId === claim.route.windowId &&
    action.bindingId === claim.route.bindingId &&
    action.targetDeliveryId === claim.target.targetDeliveryId &&
    action.intentDigest === claim.target.intentDigest &&
    action.workClaim.claimId === claim.claimId &&
    action.workClaim.claimRef === windowWorkClaimRef(claim.route.windowId) &&
    action.workClaim.claimDigest === claim.claimDigest &&
    action.workClaim.expectedStateDigest ===
      claim.claimTransition.expectedStateDigest &&
    action.workClaim.claimCommitId === claim.claimTransition.commitId &&
    action.issuedAt === claim.claimedAt &&
    action.claimEvent.eventId === event.eventId &&
    action.claimEvent.streamRevision === event.streamRevision &&
    action.claimEvent.stateDigest === event.resultingStateDigest;
  if (!common) return false;
  if (claim.target.workType === "test") {
    return (
      action.kind === "WakeflowTestDeliveryAgentHostAction" &&
      action.testAttemptId === claim.target.testAttemptId &&
      action.testDispatchPacket.digest === claim.target.testDispatchPacketDigest
    );
  }
  return action.kind === "WakeflowTargetDeliveryAgentHostAction";
}

function projectClaimResult(
  result: Awaited<ReturnType<TargetHostEffectClaimService["claim"]>>,
) {
  const { claim, commandResult } = result;
  const event = commandResult.commit.events.find(
    (entry) => entry.eventId === claim.claimTransition.eventId,
  );
  if (
    event === undefined ||
    commandResult.commit.events.length !== 1 ||
    commandResult.commit.commitId !== claim.claimTransition.commitId ||
    commandResult.commit.demandId !== claim.target.demandId ||
    commandResult.commit.commandDigest !== result.commandDigest ||
    commandResult.commit.expectedStreamRevision !==
      claim.claimTransition.expectedStreamRevision ||
    commandResult.commit.firstStreamRevision !== event.streamRevision ||
    commandResult.commit.lastStreamRevision !== event.streamRevision ||
    event.demandId !== claim.target.demandId ||
    event.streamRevision !== claim.claimTransition.expectedStreamRevision + 1 ||
    event.eventType !== "delivery.target-host-effect-claimed" ||
    canonicalizeJson(event.data.claim, "$eventClaim") !==
      canonicalizeJson(claim, "$claim") ||
    (result.status === "issued") !== (result.disposition === "committed") ||
    !actionMatchesClaim(result, event)
  ) {
    fail("output", undefined, "current", "current");
  }
  return {
    kind: "WakeflowTargetHostEffectClaimResult" as const,
    schemaVersion: WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME,
    status: result.status,
    disposition: result.disposition,
    claimAuthority: "current" as const,
    eventAuthority: "current" as const,
    claim: claimSummary(claim),
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
    action: result.action,
  };
}

function privateBoundaryValid(
  value: JsonValue,
  path: string,
  requestRoot: string,
  canonicalRoot: string,
  rawHandle: string,
  issued: boolean,
): boolean {
  if (typeof value === "string") {
    if (value.includes(rawHandle)) return false;
    const isIssuedPrompt = issued && path === "$/action/prompt";
    if (!isIssuedPrompt) {
      return (
        !value.includes(requestRoot) &&
        !value.includes(JSON.stringify(requestRoot)) &&
        !value.includes(canonicalRoot) &&
        !value.includes(JSON.stringify(canonicalRoot))
      );
    }
    const encodedRoot = JSON.stringify(canonicalRoot);
    const englishSuffix = `\n\nWakeflow workspace root (JSON string): ${encodedRoot}`;
    const chineseSuffix = `\n\nWakeflow workspace 根目录（JSON 字符串）：${encodedRoot}`;
    const suffix = value.endsWith(englishSuffix)
      ? englishSuffix
      : value.endsWith(chineseSuffix)
        ? chineseSuffix
        : null;
    if (suffix === null) return false;
    const prefix = value.slice(0, -suffix.length);
    return (
      !prefix.includes(canonicalRoot) &&
      !prefix.includes(encodedRoot) &&
      !prefix.includes(requestRoot) &&
      !prefix.includes(JSON.stringify(requestRoot))
    );
  }
  if (value === null || typeof value !== "object") return true;
  return Object.entries(value).every(([key, entry]) =>
    privateBoundaryValid(
      entry,
      `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
      requestRoot,
      canonicalRoot,
      rawHandle,
      issued,
    ),
  );
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function publicResult(
  value: unknown,
  requestRoot: string,
  canonicalRoot: string,
  rawHandle: string,
): TargetHostEffectClaimPublicResult {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$result");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) {
      fail("output", error, "current", "current");
    }
    throw error;
  }
  const validated = validateResult(json);
  const resultObject = isJsonObject(json) ? json : null;
  const issued = resultObject?.status === "issued";
  if (
    encodeCanonicalJson(json, "$result").byteLength >
      TARGET_HOST_EFFECT_CLAIM_PUBLIC_MAXIMUM_RESULT_BYTES ||
    !validated.ok ||
    !privateBoundaryValid(
      json,
      "$",
      requestRoot,
      canonicalRoot,
      rawHandle,
      issued,
    )
  ) {
    fail("output", undefined, "current", "current");
  }
  return json as unknown as TargetHostEffectClaimPublicResult;
}

/** 执行一次固定当前宿主、严格一次性Action语义的公共Target Host Effect Claim。 */
export async function executeTargetHostEffectClaimPublicRequest(
  facadeValue: Readonly<TargetHostEffectClaimPublicHostFacade>,
  value: unknown,
  options: TargetHostEffectClaimPublicCoordinatorOptions = {},
): Promise<TargetHostEffectClaimPublicResult> {
  const facade = assertFacade(facadeValue);
  const request = parseTargetHostEffectClaimPublicRequest(value);
  if (request.observation.hostId !== facade.hostId) fail("host");
  let root: RootedDirectory;
  try {
    root = await RootedDirectory.open(request.root, "$request.root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root", error);
    throw error;
  }

  let claimAuthority: TargetHostEffectClaimAuthorityState = "unchanged";
  let eventAuthority: TargetHostEffectClaimAuthorityState = "unchanged";
  let result: TargetHostEffectClaimPublicResult | undefined;
  let failure: unknown;
  try {
    let claimed;
    try {
      claimed = await new TargetHostEffectClaimService(
        root,
        facade.resourceProfile,
        facade.identityProfile,
      ).claim(
        request.workType === "test"
          ? {
              workType: "test",
              demandId: request.demandId,
              targetTaskId: request.targetTaskId,
              targetDeliveryId: request.targetDeliveryId,
              intentDigest: request.intentDigest,
              testDispatchPacketDigest: request.testDispatchPacketDigest,
              observation: request.observation,
            }
          : {
              workType: "implementation",
              demandId: request.demandId,
              targetTaskId: request.targetTaskId,
              targetDeliveryId: request.targetDeliveryId,
              intentDigest: request.intentDigest,
              observation: request.observation,
            },
        options.claim,
      );
      claimAuthority = "current";
      eventAuthority = "current";
    } catch (error: unknown) {
      if (error instanceof TargetHostEffectClaimServiceError) {
        fail("claim", error);
      }
      throw error;
    }
    result = publicResult(
      projectClaimResult(claimed),
      request.root,
      root.absolutePath,
      request.observation.handle.value,
    );
  } catch (error: unknown) {
    if (error instanceof TargetHostEffectClaimPublicCoordinatorError) {
      claimAuthority = error.claimAuthority;
      eventAuthority = error.eventAuthority;
    }
    failure = error;
  }

  try {
    await root.close();
  } catch (error: unknown) {
    if (failure === undefined && result === undefined) {
      fail("root", error, claimAuthority, eventAuthority);
    }
    if (failure === undefined && result?.status !== "issued") {
      failure = new TargetHostEffectClaimPublicCoordinatorError(
        "root",
        ownString(error, "code"),
        ownString(error, "reason"),
        claimAuthority,
        eventAuthority,
      );
    }
    // 已形成issued结果时，关闭读取句柄失败不得吞掉唯一一次Action。
  }
  if (failure !== undefined) throw failure;
  if (result === undefined) {
    fail("output", undefined, claimAuthority, eventAuthority);
  }
  return result;
}

export { TargetHostEffectClaimPublicContractError };
