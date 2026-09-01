import type { DemandTargetTaskState } from "../demand/model/demand-aggregate-state.js";
import type { DemandOperationAuthorityContext } from "../demand/demand-operation-authority-context.js";
import type { WakeflowWorkspaceHostId } from "../../workspace/workspace-host-resource-profile.js";
import {
  DemandEventSourcingRepository,
  DemandEventSourcingRepositoryError,
  type LocatedTargetHostEffectClaimedEvent,
} from "../demand/event-sourcing/demand-event-sourcing-repository.js";
import {
  createTargetDeliveryHostEffectObservation,
  targetDeliveryHostEffectDisposition,
  TargetDeliveryHostEffectObservationError,
  type TargetDeliveryHostEffectDisposition,
  type TargetDeliveryHostEffectObservation,
} from "./target-delivery-host-effect-observation.js";
import type { TargetHostEffectOutcomeRequest } from "./target-host-effect-outcome-input.js";
import type { WindowWorkClaim } from "./window-work-claim.js";

/** Claim Event、当前 Aggregate 与 Agent outcome 请求的组合准入。 */

export interface TargetHostEffectOutcomeSources {
  readonly target: Readonly<
    Extract<
      DemandTargetTaskState,
      {
        readonly phase:
          | "host-effect-claimed"
          | "host-effect-accepted"
          | "host-effect-indeterminate"
          | "host-effect-rejected"
          | "test-host-effect-claimed"
          | "test-host-effect-accepted"
          | "test-host-effect-indeterminate"
          | "test-host-effect-rejected";
      }
    >
  >;
  readonly claim: Readonly<WindowWorkClaim>;
  readonly claimEvent: Readonly<LocatedTargetHostEffectClaimedEvent>;
  readonly observation: Readonly<TargetDeliveryHostEffectObservation>;
  readonly disposition: TargetDeliveryHostEffectDisposition;
}

export type TargetHostEffectOutcomeAuthorityErrorReason =
  "claim-event" | "host" | "state" | "observation" | "aborted";

export type TargetHostEffectOutcomeAuthorityEventAuthority =
  "unchanged" | "current" | "unknown";

const ERROR_MESSAGES = {
  "claim-event": "Target Host Effect Outcome Claim Event authority is invalid.",
  host: "Target Host Effect Outcome Claim belongs to another Host.",
  state: "Target Host Effect Outcome Aggregate state is invalid.",
  observation: "Target Host Effect Outcome observation is invalid.",
  aborted: "Target Host Effect Outcome authority loading was aborted.",
} as const satisfies Readonly<
  Record<TargetHostEffectOutcomeAuthorityErrorReason, string>
>;

/** Outcome 来源无法形成闭合权威时的稳定、脱敏错误。 */
export class TargetHostEffectOutcomeAuthorityError extends Error {
  override readonly name = "TargetHostEffectOutcomeAuthorityError";
  readonly code = "wakeflow-target-host-effect-outcome-authority" as const;
  readonly reason: TargetHostEffectOutcomeAuthorityErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly eventAuthority: TargetHostEffectOutcomeAuthorityEventAuthority;

  constructor(
    reason: TargetHostEffectOutcomeAuthorityErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    eventAuthority: TargetHostEffectOutcomeAuthorityEventAuthority = "unchanged",
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
    this.eventAuthority = eventAuthority;
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
  reason: TargetHostEffectOutcomeAuthorityErrorReason,
  cause?: unknown,
  eventAuthority: TargetHostEffectOutcomeAuthorityEventAuthority = "unchanged",
): never {
  throw new TargetHostEffectOutcomeAuthorityError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    eventAuthority,
  );
}

function settledPhase(
  disposition: TargetDeliveryHostEffectDisposition,
  workType: "implementation" | "test",
): TargetHostEffectOutcomeSources["target"]["phase"] {
  if (workType === "test") {
    return disposition === "accepted"
      ? "test-host-effect-accepted"
      : disposition === "indeterminate"
        ? "test-host-effect-indeterminate"
        : "test-host-effect-rejected";
  }
  return disposition === "accepted"
    ? "host-effect-accepted"
    : disposition === "indeterminate"
      ? "host-effect-indeterminate"
      : "host-effect-rejected";
}

function isOutcomeTarget(
  target: Readonly<DemandTargetTaskState>,
): target is TargetHostEffectOutcomeSources["target"] {
  return (
    target.phase === "host-effect-claimed" ||
    target.phase === "host-effect-accepted" ||
    target.phase === "host-effect-indeterminate" ||
    target.phase === "host-effect-rejected" ||
    target.phase === "test-host-effect-claimed" ||
    target.phase === "test-host-effect-accepted" ||
    target.phase === "test-host-effect-indeterminate" ||
    target.phase === "test-host-effect-rejected"
  );
}

/** 从Claim Event恢复Action闭合字段，并将原始宿主结果脱敏为Observation。 */
export async function loadTargetHostEffectOutcomeSources(
  context: Readonly<DemandOperationAuthorityContext>,
  expectedHostId: WakeflowWorkspaceHostId,
  request: Readonly<TargetHostEffectOutcomeRequest>,
  signal: AbortSignal | undefined,
): Promise<Readonly<TargetHostEffectOutcomeSources>> {
  const repository = new DemandEventSourcingRepository(context.demandRoot);
  let located: Readonly<LocatedTargetHostEffectClaimedEvent> | null;
  try {
    located = await repository.findTargetHostEffectClaimedEvent(
      request.actionId,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingRepositoryError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("claim-event", error);
    }
    throw error;
  }
  if (located === null) fail("claim-event");
  const claim = located.event.data.claim;
  const target = context.loaded.aggregate.state.targetTasks.find(
    (entry) => entry.targetTaskId === claim.target.targetTaskId,
  );
  if (target === undefined || !isOutcomeTarget(target)) fail("state");
  const eventAuthority =
    target.phase === "host-effect-claimed" ||
    target.phase === "test-host-effect-claimed"
      ? ("unchanged" as const)
      : ("current" as const);
  if (claim.route.hostId !== expectedHostId) {
    fail("host", undefined, eventAuthority);
  }
  if (
    context.loaded.identity.demandId !== request.demandId ||
    claim.target.demandId !== request.demandId ||
    claim.claimDigest !== request.claimDigest ||
    target.currentDelivery.targetDeliveryId !== claim.target.targetDeliveryId ||
    target.currentDelivery.intentDigest !== claim.target.intentDigest ||
    target.currentDelivery.hostId !== claim.route.hostId ||
    target.currentDelivery.bindingId !== claim.route.bindingId ||
    target.windowId !== claim.route.windowId ||
    target.currentDelivery.workClaim.claimId !== claim.claimId ||
    target.currentDelivery.workClaim.claimDigest !== claim.claimDigest ||
    target.currentDelivery.workClaim.hostObservationAuthorityDigest !==
      claim.hostObservation.authorityDigest ||
    target.currentDelivery.workClaim.claimEventId !==
      located.storedEvent.eventId ||
    target.currentDelivery.workClaim.claimEventStreamRevision !==
      located.storedEvent.streamRevision
  ) {
    fail("state", undefined, eventAuthority);
  }
  if (target.workType === "test") {
    if (
      claim.target.workType !== "test" ||
      (target.phase !== "test-host-effect-claimed" &&
        target.phase !== "test-host-effect-accepted" &&
        target.phase !== "test-host-effect-indeterminate" &&
        target.phase !== "test-host-effect-rejected") ||
      target.currentDelivery.testAttemptId !== claim.target.testAttemptId ||
      target.currentDelivery.workClaim.testDispatchPacketDigest !==
        claim.target.testDispatchPacketDigest
    ) {
      fail("state", undefined, eventAuthority);
    }
  } else if (
    claim.target.workType === "test" ||
    (target.phase !== "host-effect-claimed" &&
      target.phase !== "host-effect-accepted" &&
      target.phase !== "host-effect-indeterminate" &&
      target.phase !== "host-effect-rejected")
  ) {
    fail("state", undefined, eventAuthority);
  }
  let observation: Readonly<TargetDeliveryHostEffectObservation>;
  try {
    const actionBase = {
      actionId: claim.claimId,
      targetDeliveryId: claim.target.targetDeliveryId,
      intentDigest: claim.target.intentDigest,
      hostId: claim.route.hostId,
      windowId: claim.route.windowId,
      bindingId: claim.route.bindingId,
      claimDigest: claim.claimDigest,
      hostObservationAuthorityDigest: claim.hostObservation.authorityDigest,
      claimEventId: located.storedEvent.eventId,
      claimCommitId: claim.claimTransition.commitId,
      claimEventStreamRevision: located.storedEvent.streamRevision,
      claimExpectedStateDigest: claim.claimTransition.expectedStateDigest,
      issuedAt: claim.claimedAt,
    } as const;
    const action =
      claim.target.workType === "test"
        ? {
            ...actionBase,
            workType: "test" as const,
            testAttemptId: claim.target.testAttemptId,
            testDispatchPacketDigest: claim.target.testDispatchPacketDigest,
          }
        : actionBase;
    observation = createTargetDeliveryHostEffectObservation({
      action,
      attempt: request.attempt,
      readback: request.readback,
      observedAt: request.observedAt,
    });
  } catch (error: unknown) {
    if (error instanceof TargetDeliveryHostEffectObservationError) {
      fail("observation", error, eventAuthority);
    }
    throw error;
  }
  const disposition = targetDeliveryHostEffectDisposition(observation);
  if (
    target.phase !== "host-effect-claimed" &&
    target.phase !== "test-host-effect-claimed" &&
    (target.phase !==
      settledPhase(
        disposition,
        target.workType === "test" ? "test" : "implementation",
      ) ||
      target.currentDelivery.hostEffect.observationDigest !==
        observation.observationDigest ||
      target.currentDelivery.hostEffect.disposition !== disposition ||
      target.currentDelivery.hostEffect.readbackStatus !==
        observation.readback.status)
  ) {
    fail("state", undefined, eventAuthority);
  }
  return Object.freeze({
    target,
    claim,
    claimEvent: located,
    observation,
    disposition,
  }) as Readonly<TargetHostEffectOutcomeSources>;
}
