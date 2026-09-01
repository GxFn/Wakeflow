import { types } from "node:util";

import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
  type WakeflowWorkspaceHostResourceProfile,
} from "../../workspace/workspace-host-resource-profile.js";
import {
  parseWakeflowWindowHostIdentityProfile,
  WakeflowWindowHostIdentityProfileError,
  type WakeflowWindowHostIdentityProfile,
} from "../../workspace/window-runtime/wakeflow-window-host-identity-profile.js";
import {
  assertDemandOperationConfigCurrent,
  closeDemandOperationAuthorityContext,
  openDemandOperationAuthorityContext,
  DemandOperationAuthorityContextError,
} from "../demand/demand-operation-authority-context.js";
import {
  computeDemandEventStreamCommitDigest,
  prepareDemandEventStreamCommit,
  renderDemandEventStreamCommit,
  DemandEventStreamCommitError,
} from "../demand/event-sourcing/demand-event-stream-commit.js";
import {
  computeDemandEventSourcingCommandDigest,
  decideDemandEventSourcingCommand,
  parseDemandEventSourcingCommand,
  DemandEventSourcingDecisionError,
} from "../demand/event-sourcing/demand-event-sourcing-decider.js";
import {
  executeDemandEventSourcingCommand,
  DemandEventSourcingCommandHandlerError,
  type DemandEventSourcingCommandResult,
} from "../demand/event-sourcing/demand-event-sourcing-command-handler.js";
import {
  DemandEventSourcingRepository,
  DemandEventSourcingRepositoryError,
  type LocatedTargetHostEffectClaimedEvent,
  type LocatedTargetHostEffectObservedEvent,
  type LocatedTargetHostEffectRearmedEvent,
} from "../demand/event-sourcing/demand-event-sourcing-repository.js";
import { DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMIT_BYTES } from "../demand/event-sourcing/demand-file-event-store-contract.js";
import {
  loadCurrentTargetDeliveryBinding,
  TargetDeliveryBindingAuthorityError,
} from "./target-delivery-binding-authority.js";
import type { TargetDeliveryHostEffectObservation } from "./target-delivery-host-effect-observation.js";
import {
  createTargetHostEffectRearm,
  targetHostEffectRearmCommitId,
  TargetHostEffectRearmError,
  type TargetHostEffectRearm,
} from "./target-host-effect-rearm.js";
import {
  parseTargetHostEffectRearmOptions,
  parseTargetHostEffectRearmRequest,
  TargetHostEffectRearmInputError,
  type TargetHostEffectRearmOptions,
  type TargetHostEffectRearmRequest,
} from "./target-host-effect-rearm-input.js";
import {
  inspectWindowWorkClaim,
  WindowWorkClaimStoreError,
} from "./window-work-claim-store.js";
import type { WindowWorkClaim } from "./window-work-claim.js";

/**
 * Wakeflow Governance / Delivery：显式重新开放一个精确 rejected host-effect 尾部。
 *
 * 新 Rearm 要求旧 Claim 已物理释放、原 Observation 是当前 rejected 尾部、Intent 的 Config
 * 与私有 Binding 仍然有效。事件只恢复 `delivery-prepared`；下一次效果必须重新 Claim。
 * 已提交重试只依赖历史事件与同一 Commit，不受后来 Binding 或新 Claim 影响。
 */

export interface TargetHostEffectRearmResult {
  readonly status: "rearmed" | "already-rearmed";
  readonly disposition: "committed" | "idempotent";
  readonly claimAuthority: "released";
  readonly eventAuthority: "current";
  readonly claim: Readonly<WindowWorkClaim>;
  readonly observation: Readonly<TargetDeliveryHostEffectObservation>;
  readonly rearm: Readonly<TargetHostEffectRearm>;
  readonly commandDigest: Sha256Digest;
  readonly commandResult: Readonly<DemandEventSourcingCommandResult>;
  readonly commitDigest: Sha256Digest;
}

export type TargetHostEffectRearmServiceErrorReason =
  | "input"
  | "root"
  | "config"
  | "demand-authority"
  | "claim-event"
  | "host"
  | "observation"
  | "state"
  | "binding"
  | "claim-not-released"
  | "transition"
  | "event"
  | "capacity"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Target Host Effect Rearm input is invalid.",
  root: "Target Host Effect Rearm root could not be held safely.",
  config: "Target Host Effect Rearm Config authority is invalid or stale.",
  "demand-authority": "Target Host Effect Rearm Demand authority is invalid.",
  "claim-event": "Target Host Effect Rearm Claim Event authority is invalid.",
  host: "Target Host Effect Rearm Claim belongs to another Host.",
  observation: "Target Host Effect Rearm rejected observation is invalid.",
  state: "Target Host Effect Rearm Aggregate state is invalid.",
  binding: "Target Host Effect Rearm current Binding is invalid.",
  "claim-not-released":
    "Target Host Effect Rearm requires the old Claim to be released.",
  transition: "Target Host Effect Rearm transition is not admitted.",
  event: "Target Host Effect Rearm event append failed.",
  capacity: "Target Host Effect Rearm event commit exceeds its capacity.",
  aborted: "Target Host Effect Rearm was aborted.",
  "operation-failure": "Target Host Effect Rearm operation failed.",
} as const satisfies Readonly<
  Record<TargetHostEffectRearmServiceErrorReason, string>
>;

export class TargetHostEffectRearmServiceError extends Error {
  override readonly name = "TargetHostEffectRearmServiceError";
  readonly code = "wakeflow-target-host-effect-rearm-service" as const;
  readonly reason: TargetHostEffectRearmServiceErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly eventAuthority: "unchanged" | "current" | "unknown";

  constructor(
    reason: TargetHostEffectRearmServiceErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    eventAuthority: "unchanged" | "current" | "unknown" = "unchanged",
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
  reason: TargetHostEffectRearmServiceErrorReason,
  cause?: unknown,
  eventAuthority: "unchanged" | "current" | "unknown" = "unchanged",
): never {
  throw new TargetHostEffectRearmServiceError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    eventAuthority,
  );
}

function mapContextError(
  error: DemandOperationAuthorityContextError,
  eventAuthority: "unchanged" | "current" | "unknown" = "unchanged",
): never {
  if (error.reason === "root") fail("root", error, eventAuthority);
  if (error.reason === "config" || error.reason === "stale-config") {
    fail("config", error, eventAuthority);
  }
  if (error.reason === "demand-authority") {
    fail("demand-authority", error, eventAuthority);
  }
  fail("aborted", error, eventAuthority);
}

function rearmCommand(rearm: Readonly<TargetHostEffectRearm>) {
  return parseDemandEventSourcingCommand({
    commandType: "delivery.rearm-target-host-effect",
    commandVersion: 1,
    rearm,
  });
}

function preflight(
  aggregate: Readonly<
    Awaited<ReturnType<DemandEventSourcingRepository["audit"]>>["aggregate"]
  >,
  rearm: Readonly<TargetHostEffectRearm>,
  eventAuthority: "unchanged" | "current",
): void {
  try {
    const command = rearmCommand(rearm);
    const events = decideDemandEventSourcingCommand(aggregate.state, command);
    const prepared = prepareDemandEventStreamCommit(aggregate, {
      commitId: targetHostEffectRearmCommitId(rearm),
      commandDigest: computeDemandEventSourcingCommandDigest(command),
      events,
    });
    if (
      encodeUtf8(renderDemandEventStreamCommit(prepared.commit)).byteLength >
      DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMIT_BYTES
    ) {
      fail("capacity", undefined, eventAuthority);
    }
  } catch (error: unknown) {
    if (error instanceof TargetHostEffectRearmServiceError) throw error;
    if (
      error instanceof DemandEventSourcingDecisionError ||
      error instanceof DemandEventStreamCommitError
    ) {
      fail("transition", error, eventAuthority);
    }
    throw error;
  }
}

async function executeRearmEvent(
  repository: DemandEventSourcingRepository,
  aggregate: Readonly<
    Awaited<ReturnType<DemandEventSourcingRepository["audit"]>>["aggregate"]
  >,
  rearm: Readonly<TargetHostEffectRearm>,
  knownEventAuthority: "unchanged" | "current",
  signal: AbortSignal | undefined,
): Promise<
  Readonly<{
    readonly commandDigest: Sha256Digest;
    readonly result: Readonly<DemandEventSourcingCommandResult>;
  }>
> {
  const command = rearmCommand(rearm);
  const commandDigest = computeDemandEventSourcingCommandDigest(command);
  const commitId = targetHostEffectRearmCommitId(rearm);
  let existing;
  try {
    existing = await repository.findCommitById(
      commitId,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingRepositoryError) {
      if (error.reason === "aborted") {
        fail(
          "aborted",
          error,
          knownEventAuthority === "current" ? "current" : "unknown",
        );
      }
      fail(
        "event",
        error,
        knownEventAuthority === "current" ? "current" : "unknown",
      );
    }
    throw error;
  }
  const eventAuthority =
    existing === null ? knownEventAuthority : ("current" as const);
  if (existing === null) preflight(aggregate, rearm, eventAuthority);
  try {
    const result = await executeDemandEventSourcingCommand(
      repository,
      command,
      {
        commitId,
        expectedStreamRevision:
          existing?.expectedStreamRevision ?? aggregate.streamRevision,
        ...(signal === undefined ? {} : { signal }),
      },
    );
    return Object.freeze({ commandDigest, result });
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingCommandHandlerError) {
      if (error.reason === "decision-rejected") {
        fail("transition", error, eventAuthority);
      }
      const uncertainAuthority =
        eventAuthority === "current" ? "current" : ("unknown" as const);
      if (error.reason === "aborted") {
        fail("aborted", error, uncertainAuthority);
      }
      if (error.reason === "concurrency-conflict") {
        fail("state", error, uncertainAuthority);
      }
      fail("event", error, uncertainAuthority);
    }
    throw error;
  }
}

async function loadHistoricalSources(
  repository: DemandEventSourcingRepository,
  request: Readonly<TargetHostEffectRearmRequest>,
  signal: AbortSignal | undefined,
): Promise<
  Readonly<{
    readonly claimEvent: Readonly<LocatedTargetHostEffectClaimedEvent>;
    readonly observationEvent: Readonly<LocatedTargetHostEffectObservedEvent>;
    readonly existingRearmEvent: Readonly<LocatedTargetHostEffectRearmedEvent> | null;
  }>
> {
  try {
    const [claimEvent, observationEvent, existingRearmEvent] =
      await Promise.all([
        repository.findTargetHostEffectClaimedEvent(
          request.actionId,
          signal === undefined ? undefined : { signal },
        ),
        repository.findTargetHostEffectObservedEvent(
          request.actionId,
          signal === undefined ? undefined : { signal },
        ),
        repository.findTargetHostEffectRearmedEvent(
          request.actionId,
          signal === undefined ? undefined : { signal },
        ),
      ]);
    const eventAuthority =
      existingRearmEvent === null
        ? ("unchanged" as const)
        : ("current" as const);
    if (claimEvent === null) fail("claim-event", undefined, eventAuthority);
    if (observationEvent === null) {
      fail("observation", undefined, eventAuthority);
    }
    return Object.freeze({
      claimEvent,
      observationEvent,
      existingRearmEvent,
    });
  } catch (error: unknown) {
    if (error instanceof TargetHostEffectRearmServiceError) throw error;
    if (error instanceof DemandEventSourcingRepositoryError) {
      if (error.reason === "aborted") fail("aborted", error, "unknown");
      fail("event", error, "unknown");
    }
    throw error;
  }
}

function historicalSourcesClose(
  request: Readonly<TargetHostEffectRearmRequest>,
  claimEvent: Readonly<LocatedTargetHostEffectClaimedEvent>,
  observationEvent: Readonly<LocatedTargetHostEffectObservedEvent>,
): boolean {
  const claim = claimEvent.event.data.claim;
  const observation = observationEvent.event.data.observation;
  return (
    claim.target.demandId === request.demandId &&
    claim.claimId === request.actionId &&
    !("workType" in claim.target) &&
    !("workType" in observation.action) &&
    observation.action.actionId === claim.claimId &&
    observation.observationDigest === request.observationDigest &&
    observation.action.targetDeliveryId === claim.target.targetDeliveryId &&
    observation.action.intentDigest === claim.target.intentDigest &&
    observation.action.hostId === claim.route.hostId &&
    observation.action.windowId === claim.route.windowId &&
    observation.action.bindingId === claim.route.bindingId &&
    observation.action.claimDigest === claim.claimDigest &&
    observation.action.claimEventId === claim.claimTransition.eventId &&
    observation.action.claimCommitId === claim.claimTransition.commitId &&
    observation.action.claimEventStreamRevision ===
      claim.claimTransition.expectedStreamRevision + 1 &&
    observation.action.claimExpectedStateDigest ===
      claim.claimTransition.expectedStateDigest &&
    observation.action.hostObservationAuthorityDigest ===
      claim.hostObservation.authorityDigest &&
    observation.action.issuedAt === claim.claimedAt &&
    observation.attempt.status === "rejected-before-effect" &&
    observation.readback.status === "unavailable"
  );
}

export class TargetHostEffectRearmService {
  readonly #workspaceRoot: RootedDirectory;
  readonly #resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly #identityProfile: Readonly<WakeflowWindowHostIdentityProfile>;

  constructor(
    workspaceRoot: RootedDirectory,
    resourceProfileValue: unknown,
    identityProfileValue: unknown,
  ) {
    if (
      typeof workspaceRoot !== "object" ||
      workspaceRoot === null ||
      types.isProxy(workspaceRoot) ||
      !(workspaceRoot instanceof RootedDirectory)
    ) {
      fail("input");
    }
    try {
      this.#resourceProfile =
        parseWakeflowWorkspaceHostResourceProfile(resourceProfileValue);
      this.#identityProfile =
        parseWakeflowWindowHostIdentityProfile(identityProfileValue);
    } catch (error: unknown) {
      if (
        error instanceof WakeflowWorkspaceHostResourceProfileError ||
        error instanceof WakeflowWindowHostIdentityProfileError
      ) {
        fail("input", error);
      }
      throw error;
    }
    if (
      !this.#resourceProfile.surfaces.windowIdentity ||
      this.#resourceProfile.hostId !== this.#identityProfile.hostId
    ) {
      fail("input");
    }
    this.#workspaceRoot = workspaceRoot;
  }

  /** 显式 Rearm 精确 rejected 尾部；已提交重试不重新读取当前 Binding。 */
  async rearm(
    requestValue: unknown,
    optionsValue: TargetHostEffectRearmOptions = {},
  ): Promise<Readonly<TargetHostEffectRearmResult>> {
    let request;
    let options;
    try {
      request = parseTargetHostEffectRearmRequest(requestValue);
      options = parseTargetHostEffectRearmOptions(optionsValue);
    } catch (error: unknown) {
      if (error instanceof TargetHostEffectRearmInputError) {
        fail(error.reason === "aborted" ? "aborted" : "input", error);
      }
      throw error;
    }
    let context;
    try {
      context = await openDemandOperationAuthorityContext(
        this.#workspaceRoot,
        request.demandId,
        options.signal,
      );
    } catch (error: unknown) {
      if (error instanceof DemandOperationAuthorityContextError) {
        mapContextError(error);
      }
      throw error;
    }

    let result: Readonly<TargetHostEffectRearmResult> | undefined;
    let failure: unknown;
    let knownEventAuthority: "unchanged" | "current" | "unknown" = "unchanged";
    try {
      const repository = new DemandEventSourcingRepository(context.demandRoot);
      const historical = await loadHistoricalSources(
        repository,
        request,
        options.signal,
      );
      const claim = historical.claimEvent.event.data.claim;
      const observation = historical.observationEvent.event.data.observation;
      knownEventAuthority =
        historical.existingRearmEvent === null ? "unchanged" : "current";
      if (
        !historicalSourcesClose(
          request,
          historical.claimEvent,
          historical.observationEvent,
        )
      ) {
        fail("observation", undefined, knownEventAuthority);
      }
      if (claim.route.hostId !== this.#resourceProfile.hostId) {
        fail("host", undefined, knownEventAuthority);
      }
      const targetTaskId = claim.target.targetTaskId;
      const targetDeliveryId = claim.target.targetDeliveryId;

      const existingRearm = historical.existingRearmEvent;
      let rearm: Readonly<TargetHostEffectRearm>;
      if (existingRearm !== null) {
        rearm = existingRearm.event.data.rearm;
        if (
          rearm.target.demandId !== request.demandId ||
          rearm.target.targetTaskId !== targetTaskId ||
          rearm.target.targetDeliveryId !== targetDeliveryId ||
          rearm.rejectedAttempt.claimId !== request.actionId ||
          rearm.rejectedAttempt.claimDigest !== claim.claimDigest ||
          rearm.rejectedAttempt.claimEventId !==
            claim.claimTransition.eventId ||
          rearm.rejectedAttempt.claimCommitId !==
            claim.claimTransition.commitId ||
          rearm.rejectedAttempt.observationDigest !== request.observationDigest
        ) {
          fail("state", undefined, knownEventAuthority);
        }
      } else {
        const target = context.loaded.aggregate.state.targetTasks.find(
          (entry) => entry.targetTaskId === targetTaskId,
        );
        if (
          target?.phase !== "host-effect-rejected" ||
          target.currentDelivery.targetDeliveryId !== targetDeliveryId ||
          target.currentDelivery.workClaim.claimId !== request.actionId ||
          target.currentDelivery.hostEffect.observationDigest !==
            request.observationDigest ||
          target.currentDelivery.hostEffect.claimHandling !==
            "release-authorized"
        ) {
          fail("state", undefined, knownEventAuthority);
        }
        const currentClaim = await inspectWindowWorkClaim(
          this.#workspaceRoot,
          target.windowId,
          options.signal === undefined ? {} : { signal: options.signal },
        );
        if (currentClaim.status !== "absent") {
          fail("claim-not-released", undefined, knownEventAuthority);
        }

        let preparedEvent;
        try {
          preparedEvent = await repository.findTargetDeliveryPreparedEvent(
            targetDeliveryId,
            options.signal === undefined
              ? undefined
              : { signal: options.signal },
          );
        } catch (error: unknown) {
          if (error instanceof DemandEventSourcingRepositoryError) {
            if (error.reason === "aborted") {
              fail("aborted", error, knownEventAuthority);
            }
            fail("event", error, knownEventAuthority);
          }
          throw error;
        }
        if (preparedEvent === null) {
          fail("state", undefined, knownEventAuthority);
        }
        const intent = preparedEvent.event.data.intent;
        if (
          context.config.configDigest !== intent.configDigest ||
          context.config.model.program.programId !== intent.programId ||
          intent.demandId !== request.demandId ||
          intent.target.targetTaskId !== targetTaskId ||
          intent.targetDeliveryId !== targetDeliveryId ||
          intent.intentDigest !== claim.target.intentDigest ||
          intent.route.hostId !== claim.route.hostId ||
          intent.route.windowId !== claim.route.windowId ||
          intent.route.bindingId !== claim.route.bindingId
        ) {
          fail("config", undefined, knownEventAuthority);
        }
        try {
          await loadCurrentTargetDeliveryBinding(
            this.#workspaceRoot,
            context.config.model,
            this.#resourceProfile,
            this.#identityProfile,
            intent,
            options.signal,
          );
        } catch (error: unknown) {
          if (error instanceof TargetDeliveryBindingAuthorityError) {
            fail(error.reason, error, knownEventAuthority);
          }
          throw error;
        }
        try {
          await assertDemandOperationConfigCurrent(
            this.#workspaceRoot,
            context.config,
            options.signal,
          );
        } catch (error: unknown) {
          if (error instanceof DemandOperationAuthorityContextError) {
            mapContextError(error, knownEventAuthority);
          }
          throw error;
        }
        try {
          rearm = createTargetHostEffectRearm(
            {
              target: {
                demandId: request.demandId,
                targetTaskId,
                targetDeliveryId,
              },
              rejectedAttempt: {
                claimId: claim.claimId,
                claimDigest: claim.claimDigest,
                claimEventId: claim.claimTransition.eventId,
                claimCommitId: claim.claimTransition.commitId,
                observationDigest: observation.observationDigest,
              },
            },
            {
              ...(options.clock === undefined ? {} : { clock: options.clock }),
            },
          );
        } catch (error: unknown) {
          if (error instanceof TargetHostEffectRearmError) {
            fail("input", error, knownEventAuthority);
          }
          throw error;
        }
      }

      const executed = await executeRearmEvent(
        repository,
        context.loaded.aggregate,
        rearm,
        knownEventAuthority === "current" ? "current" : "unchanged",
        options.signal,
      );
      knownEventAuthority = "current";
      result = Object.freeze({
        status:
          executed.result.disposition === "committed"
            ? ("rearmed" as const)
            : ("already-rearmed" as const),
        disposition: executed.result.disposition,
        claimAuthority: "released" as const,
        eventAuthority: "current" as const,
        claim,
        observation,
        rearm,
        commandDigest: executed.commandDigest,
        commandResult: executed.result,
        commitDigest: computeDemandEventStreamCommitDigest(
          executed.result.commit,
        ),
      });
    } catch (error: unknown) {
      if (error instanceof WindowWorkClaimStoreError) {
        failure = new TargetHostEffectRearmServiceError(
          error.reason === "aborted" ? "aborted" : "claim-not-released",
          error.code,
          error.reason,
          knownEventAuthority,
        );
      } else if (error instanceof TargetHostEffectRearmServiceError) {
        knownEventAuthority = error.eventAuthority;
        failure = error;
      } else {
        failure = error;
      }
    }

    try {
      await closeDemandOperationAuthorityContext(context);
    } catch (error: unknown) {
      if (failure === undefined && result === undefined) {
        if (error instanceof DemandOperationAuthorityContextError) {
          mapContextError(error, knownEventAuthority);
        }
        throw error;
      }
    }
    if (failure !== undefined) throw failure;
    if (result === undefined) {
      fail("operation-failure", undefined, knownEventAuthority);
    }
    return result;
  }
}
