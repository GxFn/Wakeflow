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
import {
  loadCurrentDeliveryWindowBinding,
  TargetDeliveryBindingAuthorityError,
} from "../delivery/target-delivery-binding-authority.js";
import type { TestHostEffectClaimRequest } from "../delivery/target-host-effect-claim-input.js";
import type { TestDeliveryIntent } from "./test-delivery-intent.js";
import type { TestDispatchPacket } from "./test-dispatch-packet.js";
import {
  TestDispatchProjectionStore,
  TestDispatchProjectionStoreError,
} from "./test-dispatch-projection-store.js";

/**
 * Test Host Effect Claim对prepared Intent、target-facing packet、当前Binding和Agent
 * observation的组合准入。Claim事务与窗口排他继续由Delivery共享owner维护。
 */

export interface TestHostEffectClaimSources {
  readonly workType: "test";
  readonly intent: Readonly<TestDeliveryIntent>;
  readonly packet: Readonly<TestDispatchPacket>;
  readonly binding: Readonly<WakeflowWindowHostBinding>;
  readonly observationAuthority: Readonly<WakeflowAgentHostWindowObservationAuthority>;
}

export type TestHostEffectClaimAuthorityErrorReason =
  | "config"
  | "demand-authority"
  | "intent"
  | "state"
  | "packet"
  | "binding"
  | "observation"
  | "aborted";

const ERROR_MESSAGES = {
  config: "Test Host Effect Claim Config authority is invalid.",
  "demand-authority": "Test Host Effect Claim Demand authority is invalid.",
  intent: "Test Host Effect Claim prepared Intent authority is invalid.",
  state: "Test Host Effect Claim Aggregate state is not prepared.",
  packet: "Test Host Effect Claim dispatch packet authority is invalid.",
  binding: "Test Host Effect Claim current Binding authority is invalid.",
  observation: "Test Host Effect Claim Agent observation is invalid.",
  aborted: "Test Host Effect Claim authority loading was aborted.",
} as const satisfies Readonly<
  Record<TestHostEffectClaimAuthorityErrorReason, string>
>;

/** Test Claim业务来源无法闭合时的稳定、脱敏错误。 */
export class TestHostEffectClaimAuthorityError extends Error {
  override readonly name = "TestHostEffectClaimAuthorityError";
  readonly code = "wakeflow-test-host-effect-claim-authority" as const;
  readonly reason: TestHostEffectClaimAuthorityErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;

  constructor(
    reason: TestHostEffectClaimAuthorityErrorReason,
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
  reason: TestHostEffectClaimAuthorityErrorReason,
  cause?: unknown,
): never {
  throw new TestHostEffectClaimAuthorityError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
  );
}

/** 从完整事件历史定位并复验请求指向的唯一prepared Test Intent。 */
export async function loadTestHostEffectClaimIntent(
  repository: DemandEventSourcingRepository,
  request: Readonly<TestHostEffectClaimRequest>,
  signal: AbortSignal | undefined,
): Promise<Readonly<TestDeliveryIntent>> {
  try {
    const located = await repository.findTestDeliveryPreparedEvent(
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
    if (error instanceof TestHostEffectClaimAuthorityError) throw error;
    if (error instanceof DemandEventSourcingRepositoryError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("intent", error);
    }
    throw error;
  }
}

/** 为仍处于`test-delivery-prepared`的Target加载全部Claim准入来源。 */
export async function loadTestHostEffectClaimSources(
  workspaceRoot: RootedDirectory,
  context: Readonly<DemandOperationAuthorityContext>,
  request: Readonly<TestHostEffectClaimRequest>,
  resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  identityProfile: Readonly<WakeflowWindowHostIdentityProfile>,
  signal: AbortSignal | undefined,
): Promise<Readonly<TestHostEffectClaimSources>> {
  const repository = new DemandEventSourcingRepository(context.demandRoot);
  const intent = await loadTestHostEffectClaimIntent(
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
    target.workType !== "test" ||
    target.phase !== "test-delivery-prepared" ||
    target.currentDelivery.targetDeliveryId !== intent.targetDeliveryId ||
    target.currentDelivery.intentDigest !== intent.intentDigest ||
    target.currentDelivery.hostId !== intent.route.hostId ||
    target.currentDelivery.bindingId !== intent.route.bindingId ||
    target.currentDelivery.testAttemptId !== intent.attempt.testAttemptId
  ) {
    fail("state");
  }
  let packet: Readonly<TestDispatchPacket>;
  try {
    const materialized = await new TestDispatchProjectionStore(
      context.demandRoot,
    ).materialize(
      intent.targetDeliveryId,
      signal === undefined ? {} : { signal },
    );
    packet = materialized.packet.projection.packet;
  } catch (error: unknown) {
    if (error instanceof TestDispatchProjectionStoreError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("packet", error);
    }
    throw error;
  }
  if (
    packet.packetDigest !== request.testDispatchPacketDigest ||
    packet.source.intentDigest !== intent.intentDigest ||
    packet.attempt.testAttemptId !== intent.attempt.testAttemptId
  ) {
    fail("packet");
  }
  let binding: Readonly<WakeflowWindowHostBinding>;
  try {
    binding = await loadCurrentDeliveryWindowBinding(
      workspaceRoot,
      context.config.model,
      resourceProfile,
      identityProfile,
      intent.route.windowId,
      signal,
    );
  } catch (error: unknown) {
    if (error instanceof TargetDeliveryBindingAuthorityError) {
      fail(error.reason, error);
    }
    throw error;
  }
  if (
    binding.bindingId !== intent.route.bindingId ||
    binding.hostId !== intent.route.hostId
  ) {
    fail("binding");
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
    workType: "test" as const,
    intent,
    packet,
    binding,
    observationAuthority,
  });
}
