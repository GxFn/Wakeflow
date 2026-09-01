import { types } from "node:util";

import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  WAKEFLOW_WORKSPACE_HOST_IDS,
  type WakeflowWorkspaceHostId,
} from "../../workspace/workspace-host-resource-profile.js";
import {
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
import { DemandEventSourcingRepository } from "../demand/event-sourcing/demand-event-sourcing-repository.js";
import { DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMIT_BYTES } from "../demand/event-sourcing/demand-file-event-store-contract.js";
import {
  loadTargetHostEffectOutcomeSources,
  TargetHostEffectOutcomeAuthorityError,
  type TargetHostEffectOutcomeSources,
} from "./target-host-effect-outcome-authority.js";
import {
  parseTargetHostEffectOutcomeOptions,
  parseTargetHostEffectOutcomeRequest,
  TargetHostEffectOutcomeInputError,
  type TargetHostEffectOutcomeOptions,
} from "./target-host-effect-outcome-input.js";
import {
  targetDeliveryHostEffectObservationCommitId,
  type TargetDeliveryHostEffectDisposition,
  type TargetDeliveryHostEffectObservation,
} from "./target-delivery-host-effect-observation.js";
import {
  inspectWindowWorkClaim,
  WindowWorkClaimStoreError,
} from "./window-work-claim-store.js";
import { settleAuthorizedWindowWorkClaimRelease } from "./window-work-claim-release-settlement.js";
import type { WindowWorkClaim } from "./window-work-claim.js";

/**
 * Wakeflow Governance / Delivery：记录一次已经发生的 Agent 宿主效果观察。
 *
 * 本服务不执行宿主能力，也不重新验证后来可能漂移的 Config/Binding。它从完整 Claim
 * Event 恢复 Action 闭合字段，提交唯一 observed Event；只有明确的
 * `rejected-before-effect` 在事件提交后获得精确释放原 Claim 的业务授权。
 */

export type TargetHostEffectOutcomeClaimAuthority =
  "current" | "released" | "unknown";

export type TargetHostEffectOutcomeEventAuthority =
  "unchanged" | "current" | "unknown";

export interface TargetHostEffectOutcomeResult {
  readonly status: "recorded" | "already-recorded";
  readonly disposition: "committed" | "idempotent";
  readonly effectDisposition: TargetDeliveryHostEffectDisposition;
  readonly claimHandling: "retain" | "release-authorized";
  readonly claimAuthority: TargetHostEffectOutcomeClaimAuthority;
  readonly eventAuthority: "current";
  readonly claim: Readonly<WindowWorkClaim>;
  readonly observation: Readonly<TargetDeliveryHostEffectObservation>;
  readonly commandDigest: Sha256Digest;
  readonly commandResult: Readonly<DemandEventSourcingCommandResult>;
  readonly commitDigest: Sha256Digest;
}

export type TargetHostEffectOutcomeServiceErrorReason =
  | "input"
  | "root"
  | "config"
  | "demand-authority"
  | "claim-event"
  | "host"
  | "state"
  | "observation"
  | "claim"
  | "recovery-required"
  | "transition"
  | "event"
  | "capacity"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Target Host Effect Outcome input is invalid.",
  root: "Target Host Effect Outcome root could not be held safely.",
  config: "Target Host Effect Outcome Config authority is unavailable.",
  "demand-authority": "Target Host Effect Outcome Demand authority is invalid.",
  "claim-event": "Target Host Effect Outcome Claim Event authority is invalid.",
  host: "Target Host Effect Outcome Claim belongs to another Host.",
  state: "Target Host Effect Outcome Aggregate state is invalid.",
  observation: "Target Host Effect Outcome observation is invalid.",
  claim: "Target Host Effect Outcome Claim operation failed.",
  "recovery-required": "Target Host Effect Outcome requires explicit recovery.",
  transition: "Target Host Effect Outcome transition is not admitted.",
  event: "Target Host Effect Outcome event append failed.",
  capacity: "Target Host Effect Outcome event commit exceeds its capacity.",
  aborted: "Target Host Effect Outcome was aborted.",
  "operation-failure": "Target Host Effect Outcome operation failed.",
} as const satisfies Readonly<
  Record<TargetHostEffectOutcomeServiceErrorReason, string>
>;

/** Outcome 失败时同时报告 Claim 与 Demand Event 的权威状态。 */
export class TargetHostEffectOutcomeServiceError extends Error {
  override readonly name = "TargetHostEffectOutcomeServiceError";
  readonly code = "wakeflow-target-host-effect-outcome-service" as const;
  readonly reason: TargetHostEffectOutcomeServiceErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly claimAuthority: TargetHostEffectOutcomeClaimAuthority;
  readonly eventAuthority: TargetHostEffectOutcomeEventAuthority;

  constructor(
    reason: TargetHostEffectOutcomeServiceErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    claimAuthority: TargetHostEffectOutcomeClaimAuthority = "unknown",
    eventAuthority: TargetHostEffectOutcomeEventAuthority = "unchanged",
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
  reason: TargetHostEffectOutcomeServiceErrorReason,
  cause?: unknown,
  claimAuthority: TargetHostEffectOutcomeClaimAuthority = "unknown",
  eventAuthority: TargetHostEffectOutcomeEventAuthority = "unchanged",
): never {
  throw new TargetHostEffectOutcomeServiceError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    claimAuthority,
    eventAuthority,
  );
}

function mapContextError(error: DemandOperationAuthorityContextError): never {
  if (error.reason === "root") fail("root", error);
  if (error.reason === "config" || error.reason === "stale-config") {
    fail("config", error);
  }
  if (error.reason === "demand-authority") fail("demand-authority", error);
  fail("aborted", error);
}

function command(observation: Readonly<TargetDeliveryHostEffectObservation>) {
  return parseDemandEventSourcingCommand({
    commandType: "delivery.record-target-host-effect-observation",
    commandVersion: 1,
    observation,
  });
}

function preflight(
  aggregate: Readonly<
    Awaited<ReturnType<DemandEventSourcingRepository["audit"]>>["aggregate"]
  >,
  observation: Readonly<TargetDeliveryHostEffectObservation>,
): void {
  try {
    const parsed = command(observation);
    const events = decideDemandEventSourcingCommand(aggregate.state, parsed);
    const prepared = prepareDemandEventStreamCommit(aggregate, {
      commitId: targetDeliveryHostEffectObservationCommitId(
        observation.action.actionId,
      ),
      commandDigest: computeDemandEventSourcingCommandDigest(parsed),
      events,
    });
    if (
      encodeUtf8(renderDemandEventStreamCommit(prepared.commit)).byteLength >
      DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMIT_BYTES
    ) {
      fail("capacity", undefined, "current");
    }
  } catch (error: unknown) {
    if (error instanceof TargetHostEffectOutcomeServiceError) throw error;
    if (
      error instanceof DemandEventSourcingDecisionError ||
      error instanceof DemandEventStreamCommitError
    ) {
      fail("transition", error, "current");
    }
    throw error;
  }
}

async function executeOutcomeEvent(
  repository: DemandEventSourcingRepository,
  aggregate: Readonly<
    Awaited<ReturnType<DemandEventSourcingRepository["audit"]>>["aggregate"]
  >,
  observation: Readonly<TargetDeliveryHostEffectObservation>,
  signal: AbortSignal | undefined,
): Promise<
  Readonly<{
    readonly commandDigest: Sha256Digest;
    readonly result: Readonly<DemandEventSourcingCommandResult>;
  }>
> {
  const parsed = command(observation);
  const commandDigest = computeDemandEventSourcingCommandDigest(parsed);
  const commitId = targetDeliveryHostEffectObservationCommitId(
    observation.action.actionId,
  );
  let existing;
  try {
    existing = await repository.findCommitById(
      commitId,
      signal === undefined ? undefined : { signal },
    );
  } catch {
    fail("event", undefined, "current", "unknown");
  }
  if (existing === null) preflight(aggregate, observation);
  try {
    const result = await executeDemandEventSourcingCommand(repository, parsed, {
      commitId,
      expectedStreamRevision:
        existing?.expectedStreamRevision ?? aggregate.streamRevision,
      ...(signal === undefined ? {} : { signal }),
    });
    return Object.freeze({ commandDigest, result });
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingCommandHandlerError) {
      if (error.reason === "aborted") {
        fail("aborted", error, "current", "unknown");
      }
      if (error.reason === "decision-rejected") {
        fail("transition", error, "current");
      }
      if (error.reason === "concurrency-conflict") {
        fail("state", error, "current");
      }
      fail("event", error, "current", "unknown");
    }
    throw error;
  }
}

function sameClaim(
  left: Readonly<WindowWorkClaim>,
  right: Readonly<WindowWorkClaim>,
): boolean {
  return (
    left.claimId === right.claimId && left.claimDigest === right.claimDigest
  );
}

export class TargetHostEffectOutcomeService {
  readonly #workspaceRoot: RootedDirectory;
  readonly #hostId: WakeflowWorkspaceHostId;

  constructor(workspaceRoot: RootedDirectory, hostId: unknown) {
    if (
      typeof workspaceRoot !== "object" ||
      workspaceRoot === null ||
      types.isProxy(workspaceRoot) ||
      !(workspaceRoot instanceof RootedDirectory) ||
      typeof hostId !== "string" ||
      !WAKEFLOW_WORKSPACE_HOST_IDS.some((candidate) => candidate === hostId)
    ) {
      fail("input");
    }
    this.#workspaceRoot = workspaceRoot;
    this.#hostId = hostId as WakeflowWorkspaceHostId;
  }

  /** 记录或幂等恢复一次宿主效果观察，并结算明确拒绝的 Claim。 */
  async record(
    requestValue: unknown,
    optionsValue: TargetHostEffectOutcomeOptions = {},
  ): Promise<Readonly<TargetHostEffectOutcomeResult>> {
    let request;
    let options;
    try {
      request = parseTargetHostEffectOutcomeRequest(requestValue);
      options = parseTargetHostEffectOutcomeOptions(optionsValue);
    } catch (error: unknown) {
      if (error instanceof TargetHostEffectOutcomeInputError) {
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

    let result: Readonly<TargetHostEffectOutcomeResult> | undefined;
    let failure: unknown;
    let observedEventAuthority: TargetHostEffectOutcomeEventAuthority =
      "unchanged";
    try {
      let sources: Readonly<TargetHostEffectOutcomeSources>;
      try {
        sources = await loadTargetHostEffectOutcomeSources(
          context,
          this.#hostId,
          request,
          options.signal,
        );
      } catch (error: unknown) {
        if (error instanceof TargetHostEffectOutcomeAuthorityError) {
          fail(error.reason, error, "unknown", error.eventAuthority);
        }
        throw error;
      }
      if (
        sources.target.phase !== "host-effect-claimed" &&
        sources.target.phase !== "test-host-effect-claimed"
      ) {
        observedEventAuthority = "current";
      }
      const inspected = await inspectWindowWorkClaim(
        this.#workspaceRoot,
        sources.claim.route.windowId,
        options.signal === undefined ? {} : { signal: options.signal },
      );
      const currentClaim =
        inspected.status === "claimed" &&
        inspected.claim !== undefined &&
        sameClaim(inspected.claim, sources.claim);
      const alreadyRejected =
        sources.target.phase === "host-effect-rejected" ||
        sources.target.phase === "test-host-effect-rejected";
      if (
        (inspected.status === "claimed" && !currentClaim) ||
        (inspected.status === "absent" &&
          (!alreadyRejected ||
            sources.disposition !== "rejected-before-effect"))
      ) {
        fail("recovery-required", undefined, "unknown", observedEventAuthority);
      }

      const repository = new DemandEventSourcingRepository(context.demandRoot);
      const executed = await executeOutcomeEvent(
        repository,
        context.loaded.aggregate,
        sources.observation,
        options.signal,
      );
      observedEventAuthority = "current";
      let claimAuthority: TargetHostEffectOutcomeClaimAuthority = "current";
      const claimHandling =
        sources.disposition === "rejected-before-effect"
          ? ("release-authorized" as const)
          : ("retain" as const);
      if (claimHandling === "release-authorized") {
        claimAuthority =
          inspected.status === "absent"
            ? "released"
            : await settleAuthorizedWindowWorkClaimRelease(
                this.#workspaceRoot,
                sources.claim,
              );
      }
      result = Object.freeze({
        status:
          executed.result.disposition === "committed"
            ? ("recorded" as const)
            : ("already-recorded" as const),
        disposition: executed.result.disposition,
        effectDisposition: sources.disposition,
        claimHandling,
        claimAuthority,
        eventAuthority: "current" as const,
        claim: sources.claim,
        observation: sources.observation,
        commandDigest: executed.commandDigest,
        commandResult: executed.result,
        commitDigest: computeDemandEventStreamCommitDigest(
          executed.result.commit,
        ),
      });
    } catch (error: unknown) {
      if (error instanceof WindowWorkClaimStoreError) {
        failure = new TargetHostEffectOutcomeServiceError(
          error.reason === "aborted" ? "aborted" : "claim",
          error.code,
          error.reason,
          error.claimAuthority === "current" ? "current" : "unknown",
          observedEventAuthority,
        );
      } else {
        failure = error;
      }
    }

    try {
      await closeDemandOperationAuthorityContext(context);
    } catch (error: unknown) {
      if (failure === undefined && result === undefined) {
        if (error instanceof DemandOperationAuthorityContextError) {
          mapContextError(error);
        }
        throw error;
      }
      // 已提交事件或既有失败优先，关闭读取句柄失败不能吞掉唯一 outcome 回执。
    }
    if (failure !== undefined) throw failure;
    if (result === undefined) fail("operation-failure");
    return result;
  }
}
