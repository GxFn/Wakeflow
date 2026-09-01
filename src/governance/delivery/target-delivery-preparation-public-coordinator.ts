import { types } from "node:util";

import {
  WAKEFLOW_TARGET_DELIVERY_PREPARATION_RESULT_SCHEMA,
  type WakeflowTargetDeliveryPreparationResultV1 as PreparationResultWire,
} from "../../contracts/generated/entrypoints/wakeflow-target-delivery-preparation-result.generated.js";
import { encodeCanonicalJson } from "../../foundation/data/canonical-json.js";
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
import { targetDeliveryPurpose } from "./target-delivery-intent.js";
import {
  parseTargetDeliveryPreparationPublicRequest,
  TargetDeliveryPreparationPublicContractError,
  WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
} from "./target-delivery-preparation-public-contract.js";
import {
  TargetDeliveryPreparationService,
  TargetDeliveryPreparationServiceError,
  type TargetDeliveryPreparationApplyOptions,
  type TargetDeliveryPreparationEventAuthority,
  type TargetDeliveryPreparationPreviewOptions,
} from "./target-delivery-preparation-service.js";

/**
 * Wakeflow Governance / Delivery：公共Preparation的固定宿主、根目录与脱敏边界。
 *
 * Coordinator只选择preview/apply、固定当前Host Profile并投影结果。完整业务准入、
 * Event提交与幂等恢复仍由TargetDeliveryPreparationService拥有；本层不创建Claim、
 * 不读取raw handle、不生成Agent Host Action，也不执行任何宿主能力。
 */

export type TargetDeliveryPreparationPublicResult =
  Readonly<PreparationResultWire>;

interface TargetDeliveryPreparationPublicHostFacade {
  readonly hostId: WakeflowWorkspaceHostId;
  readonly resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly identityProfile: Readonly<WakeflowWindowHostIdentityProfile>;
}

export interface TargetDeliveryPreparationPublicCoordinatorOptions {
  readonly preview?: TargetDeliveryPreparationPreviewOptions;
  readonly apply?: TargetDeliveryPreparationApplyOptions;
}

export type TargetDeliveryPreparationPublicCoordinatorErrorReason =
  "host" | "root" | "preview" | "apply" | "output";

const ERROR_MESSAGES = {
  host: "Target Delivery Preparation public host composition is invalid.",
  root: "Target Delivery Preparation public workspace root is invalid.",
  preview: "Target Delivery Preparation public preview failed.",
  apply: "Target Delivery Preparation public apply failed.",
  output:
    "Target Delivery Preparation public result violated its redacted boundary.",
} as const satisfies Readonly<
  Record<TargetDeliveryPreparationPublicCoordinatorErrorReason, string>
>;

/** 公共Preparation编排失败时返回稳定、脱敏且带事件权威状态的错误。 */
export class TargetDeliveryPreparationPublicCoordinatorError extends Error {
  override readonly name = "TargetDeliveryPreparationPublicCoordinatorError";
  readonly code =
    "wakeflow-target-delivery-preparation-public-coordinator" as const;
  readonly reason: TargetDeliveryPreparationPublicCoordinatorErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly eventAuthority: TargetDeliveryPreparationEventAuthority;

  constructor(
    reason: TargetDeliveryPreparationPublicCoordinatorErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    eventAuthority: TargetDeliveryPreparationEventAuthority = "unchanged",
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
    this.eventAuthority = eventAuthority;
  }
}

const TARGET_DELIVERY_PREPARATION_PUBLIC_MAXIMUM_RESULT_BYTES = 512 * 1024;
const validateResult = createRuntimeJsonSchemaValidator<PreparationResultWire>(
  WAKEFLOW_TARGET_DELIVERY_PREPARATION_RESULT_SCHEMA,
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
  reason: TargetDeliveryPreparationPublicCoordinatorErrorReason,
  cause?: unknown,
  eventAuthority: TargetDeliveryPreparationEventAuthority = cause instanceof
  TargetDeliveryPreparationServiceError
    ? cause.eventAuthority
    : "unchanged",
): never {
  throw new TargetDeliveryPreparationPublicCoordinatorError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    eventAuthority,
  );
}

function assertFacade(
  facade: Readonly<TargetDeliveryPreparationPublicHostFacade>,
): Readonly<TargetDeliveryPreparationPublicHostFacade> {
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
    if (error instanceof TargetDeliveryPreparationPublicCoordinatorError) {
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

function containsPrivateText(
  value: JsonValue,
  privateValues: ReadonlySet<string>,
): boolean {
  if (typeof value === "string") {
    for (const privateValue of privateValues) {
      if (value.includes(privateValue)) return true;
    }
    return false;
  }
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some((entry) =>
    containsPrivateText(entry, privateValues),
  );
}

function publicResult(
  value: unknown,
  privateValues: ReadonlySet<string>,
  eventAuthority: TargetDeliveryPreparationEventAuthority,
): TargetDeliveryPreparationPublicResult {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$result");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) {
      fail("output", error, eventAuthority);
    }
    throw error;
  }
  if (
    encodeCanonicalJson(json, "$result").byteLength >
      TARGET_DELIVERY_PREPARATION_PUBLIC_MAXIMUM_RESULT_BYTES ||
    containsPrivateText(json, privateValues) ||
    !validateResult(json).ok
  ) {
    fail("output", undefined, eventAuthority);
  }
  return json as unknown as TargetDeliveryPreparationPublicResult;
}

function applyResult(
  result: Awaited<ReturnType<TargetDeliveryPreparationService["apply"]>>,
) {
  const event = result.commandResult.commit.events.find(
    (entry) => entry.eventId === result.plan.eventId,
  );
  const intent = result.plan.intent;
  if (
    event === undefined ||
    result.commandResult.commit.events.length !== 1 ||
    result.commandResult.commit.commitId !== result.plan.commitId ||
    result.commandResult.commit.demandId !== result.plan.demandId ||
    result.commandResult.commit.expectedStreamRevision !==
      result.plan.expectedStreamRevision ||
    result.commandResult.commit.firstStreamRevision !== event.streamRevision ||
    result.commandResult.commit.lastStreamRevision !== event.streamRevision ||
    event.demandId !== result.plan.demandId ||
    event.streamRevision !== result.plan.expectedStreamRevision + 1 ||
    event.eventType !== "delivery.target-delivery-prepared"
  ) {
    fail("output", undefined, "current");
  }
  return {
    kind: "WakeflowTargetDeliveryPreparationApplyResult" as const,
    schemaVersion: WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
    mode: "apply" as const,
    status: "completed" as const,
    disposition: result.disposition,
    eventAuthority: "current" as const,
    demandId: result.plan.demandId,
    planDigest: result.planDigest,
    commandDigest: result.commandDigest,
    event: {
      eventId: event.eventId,
      streamRevision: event.streamRevision,
    },
    commit: {
      commitId: result.commandResult.commit.commitId,
      commitSequence: result.commandResult.commit.commitSequence,
      commitDigest: result.commitDigest,
    },
    stateDigest: event.resultingStateDigest,
    targetDelivery: {
      purpose: targetDeliveryPurpose(intent),
      targetTaskId: intent.target.targetTaskId,
      taskPackageId: intent.target.taskPackageId,
      taskPackageDigest: intent.target.taskPackageDigest,
      targetDeliveryId: intent.targetDeliveryId,
      intentDigest: intent.intentDigest,
      hostId: intent.route.hostId,
      windowId: intent.route.windowId,
      bindingId: intent.route.bindingId,
      phase: "delivery-prepared" as const,
    },
  };
}

/** 执行一次固定当前宿主的公共Implementation Delivery Preparation请求。 */
export async function executeTargetDeliveryPreparationPublicRequest(
  facadeValue: Readonly<TargetDeliveryPreparationPublicHostFacade>,
  value: unknown,
  options: TargetDeliveryPreparationPublicCoordinatorOptions = {},
): Promise<TargetDeliveryPreparationPublicResult> {
  const facade = assertFacade(facadeValue);
  const request = parseTargetDeliveryPreparationPublicRequest(value);
  let root: RootedDirectory;
  try {
    root = await RootedDirectory.open(request.root, "$request.root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root", error);
    throw error;
  }
  const privateValues = new Set([request.root, root.absolutePath]);
  let eventAuthority: TargetDeliveryPreparationEventAuthority = "unchanged";
  let result: TargetDeliveryPreparationPublicResult | undefined;
  let failure: unknown;
  try {
    const service = new TargetDeliveryPreparationService(
      root,
      facade.resourceProfile,
      facade.identityProfile,
    );
    if (request.mode === "preview") {
      let preview;
      try {
        preview = await service.preview(
          {
            demandId: request.demandId,
            targetTaskId: request.targetTaskId,
          },
          options.preview,
        );
      } catch (error: unknown) {
        if (error instanceof TargetDeliveryPreparationServiceError) {
          fail("preview", error);
        }
        throw error;
      }
      result = publicResult(
        {
          kind: "WakeflowTargetDeliveryPreparationPreviewResult",
          schemaVersion:
            WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_SCHEMA_VERSION,
          tool: WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
          mode: "preview",
          status: "ready",
          plan: preview.plan,
          planDigest: preview.planDigest,
        },
        privateValues,
        eventAuthority,
      );
    } else {
      let applied;
      try {
        applied = await service.apply(
          request.plan,
          request.planDigest,
          options.apply,
        );
        eventAuthority = "current";
      } catch (error: unknown) {
        if (error instanceof TargetDeliveryPreparationServiceError) {
          fail("apply", error);
        }
        throw error;
      }
      result = publicResult(
        applyResult(applied),
        privateValues,
        eventAuthority,
      );
    }
  } catch (error: unknown) {
    failure = error;
  }
  try {
    await root.close();
  } catch (error: unknown) {
    if (failure === undefined) fail("root", error, eventAuthority);
  }
  if (failure !== undefined) throw failure;
  if (result === undefined) fail("output", undefined, eventAuthority);
  return result;
}

export { TargetDeliveryPreparationPublicContractError };
