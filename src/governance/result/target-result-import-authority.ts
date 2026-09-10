import type { WakeflowWorkspaceHostId } from "../../workspace/workspace-host-resource-profile.js";
import type { DemandOperationAuthorityContext } from "../demand/demand-operation-authority-context.js";
import {
  DemandEventSourcingRepository,
  DemandEventSourcingRepositoryError,
  type LocatedTargetResultRecordedEvent,
} from "../demand/event-sourcing/demand-event-sourcing-repository.js";
import type {
  DemandCurrentDeliveryBase,
  DemandDeliveryOutcomeSummary,
} from "../demand/model/demand-aggregate-state.js";
import type { DeliveryEnvelope } from "../delivery/delivery-envelope.js";
import type { TaskPackage } from "../tasking/task-package.js";
import type { TargetResultImportRequest } from "./target-result-import-input.js";

/**
 * Result Import 从同一 Demand 事件流恢复的不可变来源闭包：任务包（test 含测试合同）、
 * 投递信封、当前投递代际（围栏与处置摘要来自聚合状态）。
 */

export interface TargetResultImportCurrentDelivery extends DemandCurrentDeliveryBase {
  readonly outcome: Readonly<DemandDeliveryOutcomeSummary>;
}

interface TargetResultImportSourceBase {
  readonly envelope: Readonly<DeliveryEnvelope>;
  readonly currentDelivery: Readonly<TargetResultImportCurrentDelivery>;
  readonly existingResultEvent: Readonly<LocatedTargetResultRecordedEvent> | null;
}

export interface ImplementationTargetResultImportSources extends TargetResultImportSourceBase {
  readonly workType: "implementation";
  readonly taskPackage: Readonly<
    Extract<TaskPackage, { readonly workType: "implementation" }>
  >;
}

export interface TestTargetResultImportSources extends TargetResultImportSourceBase {
  readonly workType: "test";
  readonly taskPackage: Readonly<
    Extract<TaskPackage, { readonly workType: "test" }>
  >;
}

export type TargetResultImportSources =
  ImplementationTargetResultImportSources | TestTargetResultImportSources;

export type TargetResultImportAuthorityErrorReason =
  | "task-package"
  | "envelope"
  | "fence"
  | "host"
  | "outcome"
  | "state"
  | "aborted";

const ERROR_MESSAGES = {
  "task-package": "TargetResult Import TaskPackage authority is invalid.",
  envelope: "TargetResult Import Delivery Envelope authority is invalid.",
  fence: "TargetResult Import fence token does not match the current delivery generation.",
  host: "TargetResult Import delivery belongs to another Host.",
  outcome: "TargetResult Import delivery has no accepted or indeterminate outcome.",
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

function currentDeliveryFor(
  context: Readonly<DemandOperationAuthorityContext>,
  request: Readonly<TargetResultImportRequest>,
): Readonly<TargetResultImportCurrentDelivery> {
  const candidates = context.loaded.aggregate.state.targetTasks.filter(
    (entry) =>
      entry.phase !== "planned" &&
      entry.phase !== "superseded" &&
      entry.currentDelivery.deliveryId === request.deliveryId,
  );
  const target = candidates.length === 1 ? candidates[0] : undefined;
  if (target === undefined || target.phase === "planned" || target.phase === "superseded") {
    fail("state");
  }
  const currentDelivery = target.currentDelivery;
  if (!("outcome" in currentDelivery)) fail("outcome");
  return Object.freeze({ ...currentDelivery, outcome: currentDelivery.outcome });
}

/** 从不可变事件历史与当前聚合恢复 Result Import 所需的精确来源。 */
export async function loadTargetResultImportSources(
  context: Readonly<DemandOperationAuthorityContext>,
  expectedHostId: WakeflowWorkspaceHostId,
  request: Readonly<TargetResultImportRequest>,
  signal: AbortSignal | undefined,
): Promise<Readonly<TargetResultImportSources>> {
  const repository = new DemandEventSourcingRepository(context.demandRoot);
  const options = signal === undefined ? undefined : { signal };
  try {
    if (context.loaded.identity.demandId !== request.demandId) fail("state");
    const currentDelivery = currentDeliveryFor(context, request);
    if (currentDelivery.hostId !== expectedHostId) fail("host");
    if (currentDelivery.fence.claimDigest !== request.claimDigest) fail("fence");
    if (currentDelivery.outcome.disposition === "rejected-before-send") fail("outcome");
    const [prepared, existingResultEvent] = await Promise.all([
      repository.findDeliveryPreparedEvent(request.deliveryId, options),
      repository.findTargetResultRecordedEvent(currentDelivery.fence.claimId, options),
    ]);
    const eventAuthority =
      existingResultEvent === null ? ("unchanged" as const) : ("current" as const);
    if (prepared === null) fail("envelope", undefined, eventAuthority);
    const envelope = prepared.event.data.envelope;
    if (
      envelope.demandId !== request.demandId ||
      envelope.envelopeDigest !== currentDelivery.envelopeDigest ||
      envelope.route.hostId !== expectedHostId ||
      envelope.workType !== request.report.workType
    ) {
      fail("state", undefined, eventAuthority);
    }
    const taskEvent = await repository.findTargetTaskPlannedEvent(
      envelope.target.taskPackageId,
      options,
    );
    if (
      taskEvent === null ||
      taskEvent.event.data.taskPackage.targetTaskId !== envelope.target.targetTaskId
    ) {
      fail("task-package", undefined, eventAuthority);
    }
    const taskPackage = taskEvent.event.data.taskPackage;
    if (envelope.workType === "test") {
      if (taskPackage.workType !== "test") fail("task-package", undefined, eventAuthority);
      return Object.freeze({
        workType: "test" as const,
        taskPackage,
        envelope,
        currentDelivery,
        existingResultEvent,
      });
    }
    if (taskPackage.workType !== "implementation") {
      fail("task-package", undefined, eventAuthority);
    }
    return Object.freeze({
      workType: "implementation" as const,
      taskPackage,
      envelope,
      currentDelivery,
      existingResultEvent,
    });
  } catch (error: unknown) {
    if (error instanceof TargetResultImportAuthorityError) throw error;
    if (error instanceof DemandEventSourcingRepositoryError) {
      if (error.reason === "aborted") fail("aborted", error, "unknown");
      fail("state", error, "unknown");
    }
    throw error;
  }
}
