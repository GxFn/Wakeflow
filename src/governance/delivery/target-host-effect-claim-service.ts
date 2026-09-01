import { types } from "node:util";

import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  readUtcWallClock,
  UtcWallClockError,
  type UtcWallClock,
} from "../../foundation/time/wall-clock.js";
import {
  utcInstantEpochNanoseconds,
  type UtcInstant,
} from "../../foundation/time/utc-instant.js";
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
  type DemandOperationAuthorityContext,
} from "../demand/demand-operation-authority-context.js";
import {
  computeDemandEventStreamCommitDigest,
  prepareDemandEventStreamCommit,
  renderDemandEventStreamCommit,
  DemandEventStreamCommitError,
  type PreparedDemandEventStreamCommit,
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
import { DemandEventSourcingRepository } from "../demand/event-sourcing/demand-event-sourcing-repository.js";
import { DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMIT_BYTES } from "../demand/event-sourcing/demand-file-event-store-contract.js";
import {
  createTargetDeliveryAgentHostAction,
  TargetDeliveryAgentHostActionError,
  type TargetDeliveryAgentHostAction,
} from "./target-delivery-agent-host-action.js";
import {
  createTestDeliveryAgentHostAction,
  TestDeliveryAgentHostActionError,
  type TestDeliveryAgentHostAction,
} from "../testing/test-delivery-agent-host-action.js";
import {
  loadTestHostEffectClaimIntent,
  loadTestHostEffectClaimSources,
  TestHostEffectClaimAuthorityError,
  type TestHostEffectClaimSources,
} from "../testing/test-host-effect-claim-authority.js";
import {
  loadTargetHostEffectClaimIntent,
  loadTargetHostEffectClaimSources,
  TargetHostEffectClaimAuthorityError,
  type TargetHostEffectClaimSources,
} from "./target-host-effect-claim-authority.js";
import {
  allocateTargetHostEffectClaimIds,
  parseTargetHostEffectClaimOptions,
  parseTargetHostEffectClaimRequest,
  TargetHostEffectClaimInputError,
  type TargetHostEffectClaimOptions,
  type TargetHostEffectClaimRequest,
} from "./target-host-effect-claim-input.js";
import {
  createWindowWorkClaim,
  WindowWorkClaimError,
  type WindowWorkClaim,
} from "./window-work-claim.js";
import {
  createWindowWorkClaimInStore,
  inspectWindowWorkClaim,
  releaseWindowWorkClaimInStore,
  WindowWorkClaimStoreError,
} from "./window-work-claim-store.js";

/**
 * Wakeflow Governance / Delivery：从implementation或Test prepared Intent到一次性目标
 * 投递宿主动作的共享Claim编排。
 *
 * Claim 文件先于 Demand 事件创建，保证跨 Demand 排他；事件首次提交后才返回 Action。
 * 若进程在两者之间中断，重试使用 Claim 内预分配的 Event/Commit 前向完成。已提交或幂等
 * 重放永不重新签发Action。Test分支额外绑定target-facing packet；本服务验证候选handle
 * 但不返回它，也不执行任何宿主能力。
 */

export const MAXIMUM_AGENT_HOST_OBSERVATION_AGE_MILLISECONDS = 5 * 60 * 1_000;
const MAXIMUM_AGENT_HOST_OBSERVATION_AGE_NANOSECONDS =
  BigInt(MAXIMUM_AGENT_HOST_OBSERVATION_AGE_MILLISECONDS) * 1_000_000n;

export interface TargetHostEffectClaimResult {
  readonly status: "issued" | "already-claimed";
  readonly disposition: "committed" | "idempotent";
  readonly claimAuthority: "current";
  readonly eventAuthority: "current";
  readonly claim: Readonly<WindowWorkClaim>;
  readonly action:
    | Readonly<TargetDeliveryAgentHostAction>
    | Readonly<TestDeliveryAgentHostAction>
    | null;
  readonly commandDigest: Sha256Digest;
  readonly commandResult: Readonly<DemandEventSourcingCommandResult>;
  readonly commitDigest: Sha256Digest;
}

export type TargetHostEffectClaimAuthorityState =
  "unchanged" | "current" | "unknown";

export type TargetHostEffectClaimServiceErrorReason =
  | "input"
  | "root"
  | "config"
  | "demand-authority"
  | "intent"
  | "state"
  | "binding"
  | "packet"
  | "observation"
  | "stale-observation"
  | "occupied"
  | "claim"
  | "recovery-required"
  | "transition"
  | "event"
  | "capacity"
  | "action"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Target Host Effect Claim input is invalid.",
  root: "Target Host Effect Claim root could not be held safely.",
  config: "Target Host Effect Claim Config authority is invalid or stale.",
  "demand-authority": "Target Host Effect Claim Demand authority is invalid.",
  intent: "Target Host Effect Claim prepared Intent is invalid.",
  state: "Target Host Effect Claim Aggregate state is invalid.",
  binding: "Target Host Effect Claim current Binding is invalid.",
  packet: "Target Host Effect Claim Test dispatch packet is invalid.",
  observation: "Target Host Effect Claim Agent observation is invalid.",
  "stale-observation":
    "Target Host Effect Claim Agent observation is not current enough.",
  occupied: "Target window is occupied by another Work Claim.",
  claim: "Target Host Effect Claim file operation failed.",
  "recovery-required": "Target Host Effect Claim requires explicit recovery.",
  transition: "Target Host Effect Claim transition is not admitted.",
  event: "Target Host Effect Claim event append failed.",
  capacity: "Target Host Effect Claim event commit exceeds its capacity.",
  action:
    "Target Host Effect Claim could not produce a safe Target Delivery Agent Host Action.",
  aborted: "Target Host Effect Claim was aborted.",
  "operation-failure": "Target Host Effect Claim operation failed.",
} as const satisfies Readonly<
  Record<TargetHostEffectClaimServiceErrorReason, string>
>;

/** Claim 失败时同时报告全局 Claim 与 Demand 事件的权威状态。 */
export class TargetHostEffectClaimServiceError extends Error {
  override readonly name = "TargetHostEffectClaimServiceError";
  readonly code = "wakeflow-target-host-effect-claim-service" as const;
  readonly reason: TargetHostEffectClaimServiceErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly claimAuthority: TargetHostEffectClaimAuthorityState;
  readonly eventAuthority: TargetHostEffectClaimAuthorityState;

  constructor(
    reason: TargetHostEffectClaimServiceErrorReason,
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
  reason: TargetHostEffectClaimServiceErrorReason,
  cause?: unknown,
  claimAuthority: TargetHostEffectClaimAuthorityState = "unchanged",
  eventAuthority: TargetHostEffectClaimAuthorityState = "unchanged",
): never {
  throw new TargetHostEffectClaimServiceError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    claimAuthority,
    eventAuthority,
  );
}

function mapContextError(
  error: DemandOperationAuthorityContextError,
  claimAuthority: TargetHostEffectClaimAuthorityState = "unchanged",
  eventAuthority: TargetHostEffectClaimAuthorityState = "unchanged",
): never {
  if (error.reason === "root") {
    fail("root", error, claimAuthority, eventAuthority);
  }
  if (error.reason === "config" || error.reason === "stale-config") {
    fail("config", error, claimAuthority, eventAuthority);
  }
  if (error.reason === "demand-authority") {
    fail("demand-authority", error, claimAuthority, eventAuthority);
  }
  fail("aborted", error, claimAuthority, eventAuthority);
}

function mapInputError(error: TargetHostEffectClaimInputError): never {
  if (error.reason === "aborted") fail("aborted", error);
  fail("input", error);
}

function mapAuthorityError(
  error: TargetHostEffectClaimAuthorityError,
  claimAuthority: TargetHostEffectClaimAuthorityState = "unchanged",
  eventAuthority: TargetHostEffectClaimAuthorityState = "unchanged",
): never {
  fail(error.reason, error, claimAuthority, eventAuthority);
}

function mapTestAuthorityError(
  error: TestHostEffectClaimAuthorityError,
  claimAuthority: TargetHostEffectClaimAuthorityState = "unchanged",
  eventAuthority: TargetHostEffectClaimAuthorityState = "unchanged",
): never {
  fail(error.reason, error, claimAuthority, eventAuthority);
}

function mapStoreError(error: WindowWorkClaimStoreError): never {
  if (error.reason === "occupied") {
    fail("occupied", error, "current");
  }
  if (error.reason === "aborted") {
    fail("aborted", error, error.claimAuthority);
  }
  if (error.reason === "recovery-required") {
    fail("recovery-required", error, error.claimAuthority);
  }
  fail("claim", error, error.claimAuthority);
}

function readClaimClock(clock: UtcWallClock | undefined): UtcInstant {
  try {
    return clock === undefined ? readUtcWallClock() : readUtcWallClock(clock);
  } catch (error: unknown) {
    if (error instanceof UtcWallClockError) fail("input", error);
    throw error;
  }
}

function assertObservationFresh(now: UtcInstant, observedAt: UtcInstant): void {
  const age =
    utcInstantEpochNanoseconds(now, "$now") -
    utcInstantEpochNanoseconds(observedAt, "$observedAt");
  if (age < 0n || age > MAXIMUM_AGENT_HOST_OBSERVATION_AGE_NANOSECONDS) {
    fail("stale-observation");
  }
}

function claimCommand(claim: Readonly<WindowWorkClaim>) {
  return parseDemandEventSourcingCommand({
    commandType: "delivery.claim-target-host-effect",
    commandVersion: 1,
    claim,
  });
}

type HostEffectClaimSources =
  Readonly<TargetHostEffectClaimSources> | Readonly<TestHostEffectClaimSources>;

async function loadClaimIntent(
  repository: DemandEventSourcingRepository,
  request: Readonly<TargetHostEffectClaimRequest>,
  signal: AbortSignal | undefined,
) {
  try {
    return request.workType === "test"
      ? await loadTestHostEffectClaimIntent(repository, request, signal)
      : await loadTargetHostEffectClaimIntent(repository, request, signal);
  } catch (error: unknown) {
    if (error instanceof TestHostEffectClaimAuthorityError) {
      mapTestAuthorityError(error);
    }
    if (error instanceof TargetHostEffectClaimAuthorityError) {
      mapAuthorityError(error);
    }
    throw error;
  }
}

async function loadClaimSources(
  workspaceRoot: RootedDirectory,
  context: Readonly<DemandOperationAuthorityContext>,
  request: Readonly<TargetHostEffectClaimRequest>,
  resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  identityProfile: Readonly<WakeflowWindowHostIdentityProfile>,
  signal: AbortSignal | undefined,
  claimAuthority: TargetHostEffectClaimAuthorityState = "unchanged",
  eventAuthority: TargetHostEffectClaimAuthorityState = "unchanged",
): Promise<HostEffectClaimSources> {
  if (request.workType === "test") {
    try {
      return await loadTestHostEffectClaimSources(
        workspaceRoot,
        context,
        request,
        resourceProfile,
        identityProfile,
        signal,
      );
    } catch (error: unknown) {
      if (error instanceof TestHostEffectClaimAuthorityError) {
        mapTestAuthorityError(error, claimAuthority, eventAuthority);
      }
      throw error;
    }
  }
  try {
    return await loadTargetHostEffectClaimSources(
      workspaceRoot,
      context,
      request,
      resourceProfile,
      identityProfile,
      signal,
    );
  } catch (error: unknown) {
    if (error instanceof TargetHostEffectClaimAuthorityError) {
      mapAuthorityError(error, claimAuthority, eventAuthority);
    }
    throw error;
  }
}

function sameClaimIntentAndRoute(
  claim: Readonly<WindowWorkClaim>,
  request: Readonly<TargetHostEffectClaimRequest>,
  sources: HostEffectClaimSources,
): boolean {
  const common =
    claim.programId === sources.intent.programId &&
    claim.target.demandId === request.demandId &&
    claim.target.targetTaskId === request.targetTaskId &&
    claim.target.targetDeliveryId === request.targetDeliveryId &&
    claim.target.intentDigest === request.intentDigest &&
    claim.target.intentPreparedAt === sources.intent.preparedAt &&
    claim.route.hostId === sources.intent.route.hostId &&
    claim.route.windowId === sources.intent.route.windowId &&
    claim.route.bindingId === sources.intent.route.bindingId;
  if (!common || request.workType !== sources.workType) return false;
  if (sources.workType === "test") {
    if (request.workType !== "test") return false;
    return (
      "workType" in claim.target &&
      claim.target.workType === "test" &&
      claim.target.testAttemptId === sources.intent.attempt.testAttemptId &&
      claim.target.testDispatchPacketDigest === sources.packet.packetDigest &&
      request.testDispatchPacketDigest === sources.packet.packetDigest
    );
  }
  return !("workType" in claim.target);
}

function preflightClaimCommit(
  aggregate: Readonly<
    Awaited<ReturnType<DemandEventSourcingRepository["audit"]>>["aggregate"]
  >,
  claim: Readonly<WindowWorkClaim>,
): Readonly<PreparedDemandEventStreamCommit> {
  try {
    const command = claimCommand(claim);
    const events = decideDemandEventSourcingCommand(aggregate.state, command);
    const prepared = prepareDemandEventStreamCommit(aggregate, {
      commitId: claim.claimTransition.commitId,
      commandDigest: computeDemandEventSourcingCommandDigest(command),
      events,
    });
    if (
      encodeUtf8(renderDemandEventStreamCommit(prepared.commit)).byteLength >
      DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMIT_BYTES
    ) {
      fail("capacity");
    }
    return prepared;
  } catch (error: unknown) {
    if (error instanceof TargetHostEffectClaimServiceError) throw error;
    if (
      error instanceof DemandEventSourcingDecisionError ||
      error instanceof DemandEventStreamCommitError
    ) {
      fail("transition", error, "current");
    }
    throw error;
  }
}

async function classifyEventAuthority(
  repository: DemandEventSourcingRepository,
  claim: Readonly<WindowWorkClaim>,
  commandDigest: Sha256Digest,
  signal: AbortSignal | undefined,
): Promise<TargetHostEffectClaimAuthorityState> {
  try {
    const commit = await repository.findCommitById(
      claim.claimTransition.commitId,
      signal === undefined ? undefined : { signal },
    );
    if (commit === null) return "unchanged";
    return commit.commandDigest === commandDigest &&
      commit.expectedStreamRevision ===
        claim.claimTransition.expectedStreamRevision
      ? "current"
      : "unchanged";
  } catch {
    return "unknown";
  }
}

async function executeClaimEvent(
  repository: DemandEventSourcingRepository,
  claim: Readonly<WindowWorkClaim>,
  signal: AbortSignal | undefined,
): Promise<
  Readonly<{
    readonly commandDigest: Sha256Digest;
    readonly result: Readonly<DemandEventSourcingCommandResult>;
  }>
> {
  const command = claimCommand(claim);
  const commandDigest = computeDemandEventSourcingCommandDigest(command);
  try {
    const result = await executeDemandEventSourcingCommand(
      repository,
      command,
      {
        commitId: claim.claimTransition.commitId,
        expectedStreamRevision: claim.claimTransition.expectedStreamRevision,
        ...(signal === undefined ? {} : { signal }),
      },
    );
    return Object.freeze({ commandDigest, result });
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingCommandHandlerError) {
      const eventAuthority = await classifyEventAuthority(
        repository,
        claim,
        commandDigest,
        signal,
      );
      if (error.reason === "aborted") {
        fail("aborted", error, "current", eventAuthority);
      }
      if (error.reason === "decision-rejected") {
        fail("transition", error, "current", eventAuthority);
      }
      if (error.reason === "concurrency-conflict") {
        fail("state", error, "current", eventAuthority);
      }
      fail("event", error, "current", eventAuthority);
    }
    throw error;
  }
}

async function releaseUncommittedClaim(
  root: RootedDirectory,
  claim: Readonly<WindowWorkClaim>,
): Promise<TargetHostEffectClaimAuthorityState> {
  try {
    // 已创建 Claim 后的精确补偿不能被原请求的取消信号再次中断。
    await releaseWindowWorkClaimInStore(root, claim);
    return "unchanged";
  } catch {
    return "unknown";
  }
}

export class TargetHostEffectClaimService {
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

  /** 创建或前向恢复一次 Claim；只有首次事件提交才返回目标投递宿主动作。 */
  async claim(
    requestValue: unknown,
    optionsValue: TargetHostEffectClaimOptions = {},
  ): Promise<Readonly<TargetHostEffectClaimResult>> {
    let request;
    let options;
    try {
      request = parseTargetHostEffectClaimRequest(requestValue);
      options = parseTargetHostEffectClaimOptions(optionsValue);
    } catch (error: unknown) {
      if (error instanceof TargetHostEffectClaimInputError) {
        mapInputError(error);
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

    let claimAuthority: TargetHostEffectClaimAuthorityState = "unchanged";
    let eventAuthority: TargetHostEffectClaimAuthorityState = "unchanged";
    let claim: Readonly<WindowWorkClaim> | undefined;
    let result: Readonly<TargetHostEffectClaimResult> | undefined;
    let failure: unknown;
    try {
      const repository = new DemandEventSourcingRepository(context.demandRoot);
      const intent = await loadClaimIntent(repository, request, options.signal);
      const target = context.loaded.aggregate.state.targetTasks.find(
        (entry) => entry.targetTaskId === request.targetTaskId,
      );
      if (
        target === undefined ||
        target.phase === "planned" ||
        (target.workType === "test") !== (request.workType === "test")
      ) {
        fail("state");
      }
      const claimedWorkClaim =
        target.workType === "test"
          ? target.phase === "test-host-effect-claimed"
            ? target.currentDelivery.workClaim
            : undefined
          : target.phase === "host-effect-claimed"
            ? target.currentDelivery.workClaim
            : undefined;

      const inspected = await inspectWindowWorkClaim(
        this.#workspaceRoot,
        intent.route.windowId,
        options.signal === undefined ? {} : { signal: options.signal },
      );

      if (claimedWorkClaim !== undefined) {
        if (
          inspected.status !== "claimed" ||
          inspected.claim === undefined ||
          claimedWorkClaim.claimDigest !== inspected.claim.claimDigest ||
          claimedWorkClaim.claimId !== inspected.claim.claimId
        ) {
          fail("recovery-required", undefined, "unknown", "current");
        }
        claim = inspected.claim;
        claimAuthority = "current";
        const executed = await executeClaimEvent(
          repository,
          claim,
          options.signal,
        );
        eventAuthority = "current";
        if (executed.result.disposition !== "idempotent") {
          fail("event", undefined, claimAuthority, "unknown");
        }
        result = Object.freeze({
          status: "already-claimed" as const,
          disposition: "idempotent" as const,
          claimAuthority: "current" as const,
          eventAuthority: "current" as const,
          claim,
          action: null,
          commandDigest: executed.commandDigest,
          commandResult: executed.result,
          commitDigest: computeDemandEventStreamCommitDigest(
            executed.result.commit,
          ),
        });
      } else {
        const sources = await loadClaimSources(
          this.#workspaceRoot,
          context,
          request,
          this.#resourceProfile,
          this.#identityProfile,
          options.signal,
        );
        const now = readClaimClock(options.clock);
        assertObservationFresh(
          now,
          sources.observationAuthority.rootAttestation.observedAt,
        );

        if (inspected.status === "claimed") {
          if (
            inspected.claim === undefined ||
            !sameClaimIntentAndRoute(inspected.claim, request, sources)
          ) {
            fail("occupied", undefined, "current");
          }
          claim = inspected.claim;
          claimAuthority = "current";
        } else {
          let ids;
          try {
            ids = allocateTargetHostEffectClaimIds(options.uuidFactory);
          } catch (error: unknown) {
            if (error instanceof TargetHostEffectClaimInputError) {
              mapInputError(error);
            }
            throw error;
          }
          try {
            const targetClaim =
              sources.workType === "test"
                ? {
                    demandId: request.demandId,
                    targetTaskId: request.targetTaskId,
                    targetDeliveryId: intent.targetDeliveryId,
                    intentDigest: intent.intentDigest,
                    intentPreparedAt: intent.preparedAt,
                    workType: "test" as const,
                    testAttemptId: sources.intent.attempt.testAttemptId,
                    testDispatchPacketDigest: sources.packet.packetDigest,
                  }
                : {
                    demandId: request.demandId,
                    targetTaskId: request.targetTaskId,
                    targetDeliveryId: intent.targetDeliveryId,
                    intentDigest: intent.intentDigest,
                    intentPreparedAt: intent.preparedAt,
                  };
            claim = createWindowWorkClaim(
              {
                claimId: ids.claimId,
                programId: context.loaded.identity.programId,
                target: targetClaim,
                route: {
                  hostId: intent.route.hostId,
                  windowId: intent.route.windowId,
                  bindingId: intent.route.bindingId,
                },
                hostObservation: {
                  authorityDigest: sources.observationAuthority.authorityDigest,
                  observedAt:
                    sources.observationAuthority.rootAttestation.observedAt,
                },
                claimTransition: {
                  commitId: ids.commitId,
                  eventId: ids.eventId,
                  expectedStreamRevision:
                    context.loaded.aggregate.streamRevision,
                  expectedStateDigest: context.loaded.aggregate.stateDigest,
                },
              },
              { clock: () => now },
            );
          } catch (error: unknown) {
            if (error instanceof WindowWorkClaimError) {
              if (error.reason === "relation" || error.reason === "time") {
                fail("stale-observation", error);
              }
              fail("claim", error);
            }
            throw error;
          }
          try {
            const created = await createWindowWorkClaimInStore(
              this.#workspaceRoot,
              claim,
              options.signal === undefined ? {} : { signal: options.signal },
            );
            claim = created.claim;
            claimAuthority = "current";
          } catch (error: unknown) {
            if (error instanceof WindowWorkClaimStoreError) {
              mapStoreError(error);
            }
            throw error;
          }
        }

        const prepared = preflightClaimCommit(context.loaded.aggregate, claim);
        let currentSources: HostEffectClaimSources;
        try {
          await assertDemandOperationConfigCurrent(
            this.#workspaceRoot,
            context.config,
            options.signal,
          );
          currentSources = await loadClaimSources(
            this.#workspaceRoot,
            context,
            request,
            this.#resourceProfile,
            this.#identityProfile,
            options.signal,
            claimAuthority,
            eventAuthority,
          );
          if (!sameClaimIntentAndRoute(claim, request, currentSources)) {
            fail("binding", undefined, claimAuthority);
          }
        } catch (error: unknown) {
          if (error instanceof DemandOperationAuthorityContextError) {
            mapContextError(error, claimAuthority, eventAuthority);
          }
          throw error;
        }
        let action:
          | Readonly<TargetDeliveryAgentHostAction>
          | Readonly<TestDeliveryAgentHostAction>;
        try {
          const claimEvent = {
            eventId: claim.claimTransition.eventId,
            streamRevision: prepared.aggregate.streamRevision,
            stateDigest: prepared.aggregate.stateDigest,
          } as const;
          action =
            currentSources.workType === "test"
              ? createTestDeliveryAgentHostAction(
                  this.#workspaceRoot.absolutePath,
                  currentSources.intent,
                  currentSources.packet,
                  claim,
                  currentSources.observationAuthority,
                  claimEvent,
                )
              : createTargetDeliveryAgentHostAction(
                  this.#workspaceRoot.absolutePath,
                  currentSources.intent,
                  claim,
                  currentSources.observationAuthority,
                  claimEvent,
                );
        } catch (error: unknown) {
          if (
            error instanceof TargetDeliveryAgentHostActionError ||
            error instanceof TestDeliveryAgentHostActionError
          ) {
            fail("action", error, claimAuthority);
          }
          throw error;
        }

        const executed = await executeClaimEvent(
          repository,
          claim,
          options.signal,
        );
        eventAuthority = "current";
        const issued = executed.result.disposition === "committed";
        result = Object.freeze({
          status: issued ? ("issued" as const) : ("already-claimed" as const),
          disposition: executed.result.disposition,
          claimAuthority: "current" as const,
          eventAuthority: "current" as const,
          claim,
          action: issued ? action : null,
          commandDigest: executed.commandDigest,
          commandResult: executed.result,
          commitDigest: computeDemandEventStreamCommitDigest(
            executed.result.commit,
          ),
        });
      }
    } catch (error: unknown) {
      if (error instanceof TargetHostEffectClaimServiceError) {
        claimAuthority = error.claimAuthority;
        eventAuthority = error.eventAuthority;
      }
      failure = error;
    }

    if (
      failure !== undefined &&
      claim !== undefined &&
      claimAuthority === "current" &&
      eventAuthority === "unchanged"
    ) {
      claimAuthority = await releaseUncommittedClaim(
        this.#workspaceRoot,
        claim,
      );
      if (
        failure instanceof TargetHostEffectClaimServiceError &&
        failure.claimAuthority !== claimAuthority
      ) {
        failure = new TargetHostEffectClaimServiceError(
          failure.reason,
          failure.causeCode,
          failure.causeReason,
          claimAuthority,
          failure.eventAuthority,
        );
      }
    }

    try {
      await closeDemandOperationAuthorityContext(context);
    } catch (error: unknown) {
      if (failure === undefined && result === undefined) {
        if (error instanceof DemandOperationAuthorityContextError) {
          mapContextError(error, claimAuthority, eventAuthority);
        }
        throw error;
      }
      // 事件已经确定提交时，关闭读取句柄失败不能吞掉唯一一次 Action 签发结果。
    }
    if (failure !== undefined) throw failure;
    if (result === undefined) {
      fail("operation-failure", undefined, claimAuthority, eventAuthority);
    }
    return result;
  }
}
