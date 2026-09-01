import { computeDemandEventSourcingStoredEventDigest } from "../demand/event-sourcing/demand-event-sourcing-stored-event.js";
import {
  DemandEventSourcingRepository,
  DemandEventSourcingRepositoryError,
  type LocatedTargetResultRecordedEvent,
} from "../demand/event-sourcing/demand-event-sourcing-repository.js";
import type { WakeflowWorkspaceHostId } from "../../workspace/workspace-host-resource-profile.js";
import type { DemandOperationAuthorityContext } from "../demand/demand-operation-authority-context.js";
import type { TaskPackage } from "../tasking/task-package.js";
import type { TargetDeliveryIntent } from "../delivery/target-delivery-intent.js";
import type { TargetDeliveryHostEffectObservation } from "../delivery/target-delivery-host-effect-observation.js";
import type { WindowWorkClaim } from "../delivery/window-work-claim.js";
import type { TestCard } from "../testing/test-card.js";
import type { TestDeliveryIntent } from "../testing/test-delivery-intent.js";
import {
  createTestDispatchPacket,
  TestDispatchPacketError,
  type TestDispatchPacket,
} from "../testing/test-dispatch-packet.js";
import type { TargetResultImportRequest } from "./target-result-import-input.js";

/** Result Import从同一Demand Event Stream恢复的不可变来源闭包。 */

interface TargetResultImportSourceBase {
  readonly claim: Readonly<WindowWorkClaim>;
  readonly observation: Readonly<TargetDeliveryHostEffectObservation>;
  readonly existingResultEvent: Readonly<LocatedTargetResultRecordedEvent> | null;
}

export interface ImplementationTargetResultImportSources extends TargetResultImportSourceBase {
  readonly workType: "implementation";
  readonly taskPackage: Readonly<
    Extract<TaskPackage, { readonly workType: "implementation" }>
  >;
  readonly intent: Readonly<TargetDeliveryIntent>;
}

export interface TestTargetResultImportSources extends TargetResultImportSourceBase {
  readonly workType: "test";
  readonly taskPackage: Readonly<
    Extract<TaskPackage, { readonly workType: "test" }>
  >;
  readonly testCard: Readonly<TestCard>;
  readonly intent: Readonly<TestDeliveryIntent>;
  readonly packet: Readonly<TestDispatchPacket>;
}

export type TargetResultImportSources =
  ImplementationTargetResultImportSources | TestTargetResultImportSources;

export type TargetResultImportAuthorityErrorReason =
  | "task-package"
  | "intent"
  | "claim-event"
  | "host"
  | "observation"
  | "test-card"
  | "packet"
  | "state"
  | "aborted";

const ERROR_MESSAGES = {
  "task-package": "TargetResult Import TaskPackage authority is invalid.",
  intent: "TargetResult Import Delivery Intent authority is invalid.",
  "claim-event": "TargetResult Import Claim Event authority is invalid.",
  host: "TargetResult Import Claim belongs to another Host.",
  observation:
    "TargetResult Import Host Effect Observation authority is invalid.",
  "test-card": "TargetResult Import TestCard authority is invalid.",
  packet: "TargetResult Import TestDispatchPacket authority is invalid.",
  state: "TargetResult Import Event sources do not close.",
  aborted: "TargetResult Import authority loading was aborted.",
} as const satisfies Readonly<
  Record<TargetResultImportAuthorityErrorReason, string>
>;

export type TargetResultImportAuthorityEventAuthority =
  "unchanged" | "current" | "unknown";

export class TargetResultImportAuthorityError extends Error {
  override readonly name = "TargetResultImportAuthorityError";
  readonly code = "wakeflow-target-result-import-authority" as const;
  readonly reason: TargetResultImportAuthorityErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly eventAuthority: TargetResultImportAuthorityEventAuthority;

  constructor(
    reason: TargetResultImportAuthorityErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    eventAuthority: TargetResultImportAuthorityEventAuthority = "unchanged",
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
  reason: TargetResultImportAuthorityErrorReason,
  cause?: unknown,
  eventAuthority: TargetResultImportAuthorityEventAuthority = "unchanged",
): never {
  throw new TargetResultImportAuthorityError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    eventAuthority,
  );
}

function commonSourcesClose(
  context: Readonly<DemandOperationAuthorityContext>,
  expectedHostId: WakeflowWorkspaceHostId,
  request: Readonly<TargetResultImportRequest>,
  claim: Readonly<WindowWorkClaim>,
  observation: Readonly<TargetDeliveryHostEffectObservation>,
): boolean {
  return (
    context.loaded.identity.demandId === request.demandId &&
    claim.target.demandId === request.demandId &&
    observation.action.actionId === request.actionId &&
    observation.observationDigest === request.observationDigest &&
    claim.claimId === request.actionId &&
    claim.route.hostId === expectedHostId &&
    claim.target.targetDeliveryId === observation.action.targetDeliveryId &&
    claim.target.intentDigest === observation.action.intentDigest &&
    claim.route.hostId === observation.action.hostId &&
    claim.route.windowId === observation.action.windowId &&
    claim.route.bindingId === observation.action.bindingId &&
    claim.claimDigest === observation.action.claimDigest &&
    claim.claimTransition.eventId === observation.action.claimEventId &&
    claim.claimTransition.commitId === observation.action.claimCommitId &&
    claim.claimTransition.expectedStreamRevision + 1 ===
      observation.action.claimEventStreamRevision &&
    claim.claimTransition.expectedStateDigest ===
      observation.action.claimExpectedStateDigest &&
    claim.hostObservation.authorityDigest ===
      observation.action.hostObservationAuthorityDigest &&
    claim.claimedAt === observation.action.issuedAt
  );
}

async function loadImplementationSources(
  context: Readonly<DemandOperationAuthorityContext>,
  repository: DemandEventSourcingRepository,
  expectedHostId: WakeflowWorkspaceHostId,
  request: Readonly<TargetResultImportRequest>,
  claim: Readonly<WindowWorkClaim>,
  observation: Readonly<TargetDeliveryHostEffectObservation>,
  existingResultEvent: Readonly<LocatedTargetResultRecordedEvent> | null,
  eventAuthority: TargetResultImportAuthorityEventAuthority,
  signal: AbortSignal | undefined,
): Promise<Readonly<ImplementationTargetResultImportSources>> {
  const prepared = await repository.findTargetDeliveryPreparedEvent(
    claim.target.targetDeliveryId,
    signal === undefined ? undefined : { signal },
  );
  if (prepared === null) fail("intent", undefined, eventAuthority);
  const intent = prepared.event.data.intent;
  const taskEvent = await repository.findTargetTaskPlannedEvent(
    intent.target.taskPackageId,
    signal === undefined ? undefined : { signal },
  );
  if (
    taskEvent === null ||
    taskEvent.event.data.taskPackage.workType !== "implementation"
  ) {
    fail("task-package", undefined, eventAuthority);
  }
  if (
    !commonSourcesClose(context, expectedHostId, request, claim, observation) ||
    request.report.workType !== "implementation" ||
    claim.target.workType === "test" ||
    observation.action.workType === "test" ||
    intent.demandId !== request.demandId ||
    intent.target.targetTaskId !== claim.target.targetTaskId ||
    intent.targetDeliveryId !== claim.target.targetDeliveryId ||
    taskEvent.event.data.taskPackage.targetTaskId !== claim.target.targetTaskId
  ) {
    fail("state", undefined, eventAuthority);
  }
  return Object.freeze({
    workType: "implementation" as const,
    taskPackage: taskEvent.event.data.taskPackage,
    intent,
    claim,
    observation,
    existingResultEvent,
  });
}

async function loadTestSources(
  context: Readonly<DemandOperationAuthorityContext>,
  repository: DemandEventSourcingRepository,
  expectedHostId: WakeflowWorkspaceHostId,
  request: Readonly<TargetResultImportRequest>,
  claim: Readonly<WindowWorkClaim>,
  observation: Readonly<TargetDeliveryHostEffectObservation>,
  existingResultEvent: Readonly<LocatedTargetResultRecordedEvent> | null,
  eventAuthority: TargetResultImportAuthorityEventAuthority,
  signal: AbortSignal | undefined,
): Promise<Readonly<TestTargetResultImportSources>> {
  const prepared = await repository.findTestDeliveryPreparedEvent(
    claim.target.targetDeliveryId,
    signal === undefined ? undefined : { signal },
  );
  if (prepared === null) fail("intent", undefined, eventAuthority);
  const intent = prepared.event.data.intent;
  const [taskEvent, cardEvent] = await Promise.all([
    repository.findTargetTaskPlannedEvent(
      intent.target.taskPackageId,
      signal === undefined ? undefined : { signal },
    ),
    repository.findTestCardCreatedEvent(
      intent.target.testCard.testCardId,
      signal === undefined ? undefined : { signal },
    ),
  ]);
  if (
    taskEvent === null ||
    taskEvent.event.data.taskPackage.workType !== "test"
  ) {
    fail("task-package", undefined, eventAuthority);
  }
  if (cardEvent === null) fail("test-card", undefined, eventAuthority);
  const taskPackage = taskEvent.event.data.taskPackage;
  const testCard = cardEvent.event.data.testCard;
  let packet: Readonly<TestDispatchPacket>;
  try {
    packet = createTestDispatchPacket({
      sourceEvent: {
        eventId: prepared.storedEvent.eventId,
        eventDigest: computeDemandEventSourcingStoredEventDigest(
          prepared.storedEvent,
        ),
        streamRevision: prepared.storedEvent.streamRevision,
      },
      intent,
      taskPackage,
      testCard,
    });
  } catch (error: unknown) {
    if (error instanceof TestDispatchPacketError) {
      fail("packet", error, eventAuthority);
    }
    throw error;
  }
  if (
    !commonSourcesClose(context, expectedHostId, request, claim, observation) ||
    request.report.workType !== "test" ||
    claim.target.workType !== "test" ||
    observation.action.workType !== "test" ||
    intent.demandId !== request.demandId ||
    intent.target.targetTaskId !== claim.target.targetTaskId ||
    intent.targetDeliveryId !== claim.target.targetDeliveryId ||
    taskPackage.targetTaskId !== claim.target.targetTaskId ||
    intent.attempt.testAttemptId !== claim.target.testAttemptId ||
    observation.action.testAttemptId !== claim.target.testAttemptId ||
    packet.packetDigest !== claim.target.testDispatchPacketDigest ||
    observation.action.testDispatchPacketDigest !==
      claim.target.testDispatchPacketDigest
  ) {
    fail("state", undefined, eventAuthority);
  }
  return Object.freeze({
    workType: "test" as const,
    taskPackage,
    testCard,
    intent,
    packet,
    claim,
    observation,
    existingResultEvent,
  });
}

/** 从不可变Event历史恢复Result Import所需的精确来源。 */
export async function loadTargetResultImportSources(
  context: Readonly<DemandOperationAuthorityContext>,
  expectedHostId: WakeflowWorkspaceHostId,
  request: Readonly<TargetResultImportRequest>,
  signal: AbortSignal | undefined,
): Promise<Readonly<TargetResultImportSources>> {
  const repository = new DemandEventSourcingRepository(context.demandRoot);
  try {
    const [claimEvent, observationEvent, existingResultEvent] =
      await Promise.all([
        repository.findTargetHostEffectClaimedEvent(
          request.actionId,
          signal === undefined ? undefined : { signal },
        ),
        repository.findTargetHostEffectObservedEvent(
          request.actionId,
          signal === undefined ? undefined : { signal },
        ),
        repository.findTargetResultRecordedEvent(
          request.actionId,
          signal === undefined ? undefined : { signal },
        ),
      ]);
    const eventAuthority =
      existingResultEvent === null
        ? ("unchanged" as const)
        : ("current" as const);
    if (claimEvent === null) {
      fail("claim-event", undefined, eventAuthority);
    }
    if (observationEvent === null) {
      fail("observation", undefined, eventAuthority);
    }
    const claim = claimEvent.event.data.claim;
    const observation = observationEvent.event.data.observation;
    if (claim.route.hostId !== expectedHostId) {
      fail("host", undefined, eventAuthority);
    }
    return request.report.workType === "test"
      ? await loadTestSources(
          context,
          repository,
          expectedHostId,
          request,
          claim,
          observation,
          existingResultEvent,
          eventAuthority,
          signal,
        )
      : await loadImplementationSources(
          context,
          repository,
          expectedHostId,
          request,
          claim,
          observation,
          existingResultEvent,
          eventAuthority,
          signal,
        );
  } catch (error: unknown) {
    if (error instanceof TargetResultImportAuthorityError) throw error;
    if (error instanceof DemandEventSourcingRepositoryError) {
      if (error.reason === "aborted") fail("aborted", error, "unknown");
      fail("state", error, "unknown");
    }
    throw error;
  }
}
