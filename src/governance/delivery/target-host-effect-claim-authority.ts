import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import type { WakeflowWorkspaceHostResourceProfile } from "../../workspace/workspace-host-resource-profile.js";
import type { WakeflowWindowHostBinding } from "../../workspace/window-runtime/wakeflow-window-host-binding.js";
import type { WakeflowWindowHostIdentityProfile } from "../../workspace/window-runtime/wakeflow-window-host-identity-profile.js";
import {
  compileWakeflowAgentHostWindowObservationAuthority,
  WakeflowAgentHostWindowObservationAuthorityError,
  type WakeflowAgentHostWindowObservationAuthority,
} from "../../workspace/window-runtime/wakeflow-agent-host-window-observation-authority.js";
import type { DemandOperationAuthorityContext } from "../demand/demand-operation-authority-context.js";
import {
  DemandEventSourcingRepository,
  DemandEventSourcingRepositoryError,
} from "../demand/event-sourcing/demand-event-sourcing-repository.js";
import type { TargetDeliveryIntent } from "./target-delivery-intent.js";
import type { TargetHostEffectClaimRequest } from "./target-host-effect-claim-input.js";
import {
  loadCurrentTargetDeliveryBinding,
  TargetDeliveryBindingAuthorityError,
} from "./target-delivery-binding-authority.js";

/** Claim Service 对 prepared Intent、当前 Aggregate、Binding 与 Agent observation 的组合准入。 */

export interface TargetHostEffectClaimSources {
  readonly workType: "implementation";
  readonly intent: Readonly<TargetDeliveryIntent>;
  readonly binding: Readonly<WakeflowWindowHostBinding>;
  readonly observationAuthority: Readonly<WakeflowAgentHostWindowObservationAuthority>;
}

export type TargetHostEffectClaimAuthorityErrorReason =
  | "config"
  | "demand-authority"
  | "intent"
  | "state"
  | "binding"
  | "observation"
  | "aborted";

const ERROR_MESSAGES = {
  config: "Target Host Effect Claim Config authority is invalid.",
  "demand-authority": "Target Host Effect Claim Demand authority is invalid.",
  intent: "Target Host Effect Claim prepared Intent authority is invalid.",
  state: "Target Host Effect Claim Aggregate state is not prepared.",
  binding: "Target Host Effect Claim current Binding authority is invalid.",
  observation: "Target Host Effect Claim Agent observation is invalid.",
  aborted: "Target Host Effect Claim authority loading was aborted.",
} as const satisfies Readonly<
  Record<TargetHostEffectClaimAuthorityErrorReason, string>
>;

/** Claim 业务来源无法闭合时的稳定、脱敏错误。 */
export class TargetHostEffectClaimAuthorityError extends Error {
  override readonly name = "TargetHostEffectClaimAuthorityError";
  readonly code = "wakeflow-target-host-effect-claim-authority" as const;
  readonly reason: TargetHostEffectClaimAuthorityErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;

  constructor(
    reason: TargetHostEffectClaimAuthorityErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
  }
}

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
  reason: TargetHostEffectClaimAuthorityErrorReason,
  cause?: unknown,
): never {
  throw new TargetHostEffectClaimAuthorityError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
  );
}

/** 从完整事件历史定位并复验请求指向的唯一 prepared Intent。 */
export async function loadTargetHostEffectClaimIntent(
  repository: DemandEventSourcingRepository,
  request: Readonly<TargetHostEffectClaimRequest>,
  signal: AbortSignal | undefined,
): Promise<Readonly<TargetDeliveryIntent>> {
  if (request.workType !== "implementation") fail("intent");
  try {
    const located = await repository.findTargetDeliveryPreparedEvent(
      request.targetDeliveryId,
      signal === undefined ? undefined : { signal },
    );
    if (located === null) fail("intent");
    const intent = located.event.data.intent;
    if (
      intent.demandId !== request.demandId ||
      intent.target.targetTaskId !== request.targetTaskId ||
      intent.intentDigest !== request.intentDigest
    ) {
      fail("intent");
    }
    return intent;
  } catch (error: unknown) {
    if (error instanceof TargetHostEffectClaimAuthorityError) throw error;
    if (error instanceof DemandEventSourcingRepositoryError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("intent", error);
    }
    throw error;
  }
}

/** 为仍处于 `delivery-prepared` 的 Target 加载完整 Claim 准入来源。 */
export async function loadTargetHostEffectClaimSources(
  workspaceRoot: RootedDirectory,
  context: Readonly<DemandOperationAuthorityContext>,
  request: Readonly<TargetHostEffectClaimRequest>,
  resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  identityProfile: Readonly<WakeflowWindowHostIdentityProfile>,
  signal: AbortSignal | undefined,
): Promise<Readonly<TargetHostEffectClaimSources>> {
  const repository = new DemandEventSourcingRepository(context.demandRoot);
  const intent = await loadTargetHostEffectClaimIntent(
    repository,
    request,
    signal,
  );
  const target = context.loaded.aggregate.state.targetTasks.find(
    (entry) => entry.targetTaskId === request.targetTaskId,
  );
  if (
    context.loaded.identity.demandId !== request.demandId ||
    context.loaded.identity.programId !== intent.programId
  ) {
    fail("demand-authority");
  }
  if (
    context.config.configDigest !== intent.configDigest ||
    context.config.model.program.programId !== intent.programId
  ) {
    fail("config");
  }
  if (
    target === undefined ||
    target.phase !== "delivery-prepared" ||
    target.currentDelivery.targetDeliveryId !== intent.targetDeliveryId ||
    target.currentDelivery.intentDigest !== intent.intentDigest ||
    target.currentDelivery.hostId !== intent.route.hostId ||
    target.currentDelivery.bindingId !== intent.route.bindingId
  ) {
    fail("state");
  }
  let binding: Readonly<WakeflowWindowHostBinding>;
  try {
    binding = await loadCurrentTargetDeliveryBinding(
      workspaceRoot,
      context.config.model,
      resourceProfile,
      identityProfile,
      intent,
      signal,
    );
  } catch (error: unknown) {
    if (error instanceof TargetDeliveryBindingAuthorityError) {
      fail(error.reason, error);
    }
    throw error;
  }
  let observationAuthority;
  try {
    observationAuthority = compileWakeflowAgentHostWindowObservationAuthority({
      config: context.config.model,
      resourceProfile,
      identityProfile,
      binding,
      observation: request.observation,
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowAgentHostWindowObservationAuthorityError) {
      fail("observation", error);
    }
    throw error;
  }
  if (
    observationAuthority.windowId !== intent.route.windowId ||
    observationAuthority.binding.bindingId !== intent.route.bindingId ||
    observationAuthority.sourceFingerprints.configDigest !== intent.configDigest
  ) {
    fail("observation");
  }
  return Object.freeze({
    workType: "implementation" as const,
    intent,
    binding,
    observationAuthority,
  });
}
