import { types } from "node:util";

import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  assertDemandOperationConfigCurrent,
  closeDemandOperationAuthorityContext,
  openDemandOperationAuthorityContext,
  DemandOperationAuthorityContextError,
} from "../demand/demand-operation-authority-context.js";
import { computeDemandEventStreamCommitDigest } from "../demand/event-sourcing/demand-event-stream-commit.js";
import {
  DemandEventSourcingCommandHandlerError,
  type DemandEventSourcingCommandResult,
} from "../demand/event-sourcing/demand-event-sourcing-command-handler.js";
import {
  DemandEventSourcingRepository,
  type AuditedDemandTargetResultHistory,
} from "../demand/event-sourcing/demand-event-sourcing-repository.js";
import {
  buildDemandResultReviewSnapshotFromHistory,
  type DemandResultReviewReportedTarget,
} from "./demand-result-review-snapshot.js";
import {
  createControllerImplementationReviewDecision,
  ControllerImplementationReviewDecisionError,
  type ControllerImplementationReviewDecision,
  type ControllerImplementationReviewJudgment,
} from "./controller-implementation-review-decision.js";
import {
  parseControllerImplementationReviewDecisionOptions,
  parseControllerImplementationReviewDecisionRequest,
  ControllerImplementationReviewDecisionInputError,
  type ControllerImplementationReviewDecisionOptions,
  type ControllerImplementationReviewDecisionRequest,
} from "./controller-implementation-review-decision-input.js";
import {
  appendControllerReviewDecisionEvent,
  auditControllerReviewDecisionHistory,
  preflightControllerReviewDecisionEvent,
  ControllerReviewDecisionEventOwnerError,
} from "./controller-review-decision-event-owner.js";

/**
 * Wakeflow Governance / Review：提交一个Controller单Target审查决定。
 *
 * Service从当前Config派生唯一Controller Window，完整审计Demand Event Stream并重算
 * Review Snapshot；请求只能决定精确的reported unit。相同TargetResult的已提交Decision
 * 形成幂等权威。Service不验证代码真实性，也不执行决定后的业务route。
 */

export interface ControllerImplementationReviewDecisionServiceResult {
  readonly status: "decided" | "already-decided";
  readonly disposition: "committed" | "idempotent";
  readonly eventAuthority: "current";
  readonly decision: Readonly<ControllerImplementationReviewDecision>;
  readonly commandDigest: Sha256Digest;
  readonly commandResult: Readonly<DemandEventSourcingCommandResult>;
  readonly commitDigest: Sha256Digest;
}

export type ControllerImplementationReviewDecisionServiceErrorReason =
  | "input"
  | "root"
  | "config"
  | "demand-authority"
  | "controller-authority"
  | "review-snapshot"
  | "state"
  | "decision"
  | "transition"
  | "event"
  | "capacity"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Controller Implementation Review Decision input is invalid.",
  root: "Controller Implementation Review Decision root could not be held safely.",
  config:
    "Controller Implementation Review Decision Config authority is invalid or stale.",
  "demand-authority":
    "Controller Implementation Review Decision Demand authority is invalid.",
  "controller-authority":
    "Controller Implementation Review Decision Controller authority is invalid.",
  "review-snapshot":
    "Controller Implementation Review Decision Review Snapshot is stale or inconsistent.",
  state:
    "Controller Implementation Review Decision Aggregate state is invalid.",
  decision: "Controller Implementation Review Decision record is invalid.",
  transition:
    "Controller Implementation Review Decision transition is not admitted.",
  event: "Controller Implementation Review Decision Event append failed.",
  capacity:
    "Controller Implementation Review Decision Event Commit exceeds its capacity.",
  aborted: "Controller Implementation Review Decision was aborted.",
  "operation-failure":
    "Controller Implementation Review Decision operation failed.",
} as const satisfies Readonly<
  Record<ControllerImplementationReviewDecisionServiceErrorReason, string>
>;

export class ControllerImplementationReviewDecisionServiceError extends Error {
  override readonly name = "ControllerImplementationReviewDecisionServiceError";
  readonly code =
    "wakeflow-controller-implementation-review-decision-service" as const;
  readonly reason: ControllerImplementationReviewDecisionServiceErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly eventAuthority: "unchanged" | "current" | "unknown";

  constructor(
    reason: ControllerImplementationReviewDecisionServiceErrorReason,
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
  reason: ControllerImplementationReviewDecisionServiceErrorReason,
  cause?: unknown,
  eventAuthority: "unchanged" | "current" | "unknown" = "unchanged",
): never {
  throw new ControllerImplementationReviewDecisionServiceError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
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

function judgment(
  value: Readonly<ControllerImplementationReviewJudgment>,
): Readonly<ControllerImplementationReviewJudgment> {
  return Object.freeze({
    decision: value.decision,
    assessment: value.assessment,
    independentChecks: value.independentChecks,
    rationale: value.rationale,
    blockingReasons: value.blockingReasons,
    residualRisks: value.residualRisks,
  });
}

function judgmentDigest(
  value: Readonly<ControllerImplementationReviewJudgment>,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(judgment(value));
}

function assertExistingMatchesRequest(
  decision: Readonly<ControllerImplementationReviewDecision>,
  request: Readonly<ControllerImplementationReviewDecisionRequest>,
): void {
  if (
    decision.demandId !== request.demandId ||
    decision.reviewed.targetResultId !== request.targetResultId ||
    decision.reviewed.snapshotDigest !== request.snapshotDigest ||
    decision.reviewed.reviewUnitDigest !== request.reviewUnitDigest ||
    judgmentDigest(decision) !== judgmentDigest(request)
  ) {
    fail("state", undefined, "current");
  }
}

function existingDecision(
  history: Readonly<AuditedDemandTargetResultHistory>,
  request: Readonly<ControllerImplementationReviewDecisionRequest>,
): Readonly<ControllerImplementationReviewDecision> | null {
  const sources = history.targetReviewDecisions.filter(
    (entry) =>
      entry.decision.kind ===
        "WakeflowControllerImplementationReviewDecision" &&
      entry.decision.reviewed.targetResultId === request.targetResultId &&
      entry.decision.reviewed.snapshotDigest === request.snapshotDigest,
  );
  if (sources.length === 0) return null;
  if (sources.length !== 1 || sources[0] === undefined) {
    fail("state", undefined, "current");
  }
  const source = sources[0];
  const decision = source.decision;
  if (decision.kind !== "WakeflowControllerImplementationReviewDecision") {
    fail("state", undefined, "current");
  }
  assertExistingMatchesRequest(decision, request);
  return decision;
}

function reportedTarget(
  history: Readonly<AuditedDemandTargetResultHistory>,
  request: Readonly<ControllerImplementationReviewDecisionRequest>,
): Readonly<DemandResultReviewReportedTarget> {
  const snapshot = buildDemandResultReviewSnapshotFromHistory(history);
  const matches = snapshot.targets.filter(
    (entry) =>
      entry.status === "reported" &&
      entry.targetResult.targetResultId === request.targetResultId,
  );
  const target = matches.length === 1 ? matches[0] : undefined;
  if (
    target?.status !== "reported" ||
    target.taskPackage.workType !== "implementation" ||
    target.targetResult.workType !== "implementation" ||
    target.targetResult.targetResultId !== request.targetResultId ||
    target.reviewUnitDigest !== request.reviewUnitDigest ||
    snapshot.snapshotDigest !== request.snapshotDigest
  ) {
    const priorDecisionExists = history.targetReviewDecisions.some(
      (entry) =>
        entry.decision.kind ===
          "WakeflowControllerImplementationReviewDecision" &&
        entry.decision.reviewed.targetResultId === request.targetResultId,
    );
    fail(
      "review-snapshot",
      undefined,
      priorDecisionExists ? "current" : "unchanged",
    );
  }
  return target;
}

function preflight(
  history: Readonly<AuditedDemandTargetResultHistory>,
  decision: Readonly<ControllerImplementationReviewDecision>,
): void {
  try {
    preflightControllerReviewDecisionEvent(history, decision);
  } catch (error: unknown) {
    if (error instanceof ControllerReviewDecisionEventOwnerError) {
      fail(
        error.reason === "capacity" ? "capacity" : "transition",
        error.sourceError,
        error.eventAuthority,
      );
    }
    throw error;
  }
}

async function auditHistory(
  repository: DemandEventSourcingRepository,
  signal: AbortSignal | undefined,
  eventAuthority: "unchanged" | "current" | "unknown" = "unchanged",
): Promise<Readonly<AuditedDemandTargetResultHistory>> {
  try {
    return await auditControllerReviewDecisionHistory(
      repository,
      signal,
      eventAuthority,
    );
  } catch (error: unknown) {
    if (error instanceof ControllerReviewDecisionEventOwnerError) {
      const reason =
        error.reason === "aborted"
          ? ("aborted" as const)
          : error.reason === "state"
            ? ("state" as const)
            : ("event" as const);
      fail(reason, error.sourceError, error.eventAuthority);
    }
    throw error;
  }
}

async function recoverConcurrentDecision(
  repository: DemandEventSourcingRepository,
  request: Readonly<ControllerImplementationReviewDecisionRequest>,
  signal: AbortSignal | undefined,
): Promise<Readonly<{
  readonly decision: Readonly<ControllerImplementationReviewDecision>;
  readonly commandResult: Readonly<DemandEventSourcingCommandResult>;
}> | null> {
  const history = await auditHistory(repository, signal, "unknown");
  const recovered = existingDecision(history, request);
  if (recovered === null) return null;
  let commandResult: Readonly<DemandEventSourcingCommandResult>;
  try {
    commandResult = await appendControllerReviewDecisionEvent(
      repository,
      recovered,
      signal,
    );
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingCommandHandlerError) {
      if (error.reason === "aborted") fail("aborted", error, "current");
      fail("event", error, "current");
    }
    throw error;
  }
  return Object.freeze({ decision: recovered, commandResult });
}

export class ControllerImplementationReviewDecisionService {
  readonly #workspaceRoot: RootedDirectory;

  constructor(workspaceRoot: RootedDirectory) {
    if (
      typeof workspaceRoot !== "object" ||
      workspaceRoot === null ||
      types.isProxy(workspaceRoot) ||
      !(workspaceRoot instanceof RootedDirectory)
    ) {
      fail("input");
    }
    this.#workspaceRoot = workspaceRoot;
  }

  /** 提交当前reported unit的Controller决定；相同请求按历史Decision幂等返回。 */
  async decide(
    requestValue: unknown,
    optionsValue: ControllerImplementationReviewDecisionOptions = {},
  ): Promise<Readonly<ControllerImplementationReviewDecisionServiceResult>> {
    let request: Readonly<ControllerImplementationReviewDecisionRequest>;
    let options;
    try {
      request =
        parseControllerImplementationReviewDecisionRequest(requestValue);
      options =
        parseControllerImplementationReviewDecisionOptions(optionsValue);
    } catch (error: unknown) {
      if (error instanceof ControllerImplementationReviewDecisionInputError) {
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

    let returned:
      Readonly<ControllerImplementationReviewDecisionServiceResult> | undefined;
    let failure: unknown;
    try {
      const repository = new DemandEventSourcingRepository(context.demandRoot);
      const history = await auditHistory(repository, options.signal);
      let decision = existingDecision(history, request);
      let commandResult: Readonly<DemandEventSourcingCommandResult>;
      if (decision === null) {
        const target = reportedTarget(history, request);
        if (
          context.config.model.program.programId !==
            target.taskPackage.programId ||
          context.loaded.identity.programId !== target.taskPackage.programId ||
          target.taskPackage.demandId !== request.demandId
        ) {
          fail("controller-authority");
        }
        try {
          decision = createControllerImplementationReviewDecision(
            {
              programId: target.taskPackage.programId,
              demandId: request.demandId,
              targetTaskId: target.targetTaskId,
              controllerWindowId:
                context.config.indexes.controllerWindow.windowId,
              reviewed: {
                snapshotDigest: request.snapshotDigest,
                reviewUnitDigest: request.reviewUnitDigest,
                stateDigest: history.aggregate.stateDigest,
                streamRevision: history.aggregate.streamRevision,
                taskPackageId: target.taskPackage.taskPackageId,
                taskPackageDigest: target.targetResult.taskPackage.digest,
                targetResultId: target.targetResult.targetResultId,
                targetResultDigest: target.targetResult.resultDigest,
                targetResultOutcome: target.targetResult.report.outcome,
                targetResultReportedAt: target.targetResult.report.reportedAt,
              },
              ...judgment(request),
            },
            {
              ...(options.clock === undefined ? {} : { clock: options.clock }),
              ...(options.uuidFactory === undefined
                ? {}
                : { uuidFactory: options.uuidFactory }),
            },
          );
        } catch (error: unknown) {
          if (error instanceof ControllerImplementationReviewDecisionError) {
            fail("decision", error);
          }
          throw error;
        }
        preflight(history, decision);
        try {
          await assertDemandOperationConfigCurrent(
            this.#workspaceRoot,
            context.config,
            options.signal,
          );
        } catch (error: unknown) {
          if (error instanceof DemandOperationAuthorityContextError) {
            mapContextError(error);
          }
          throw error;
        }
      }

      try {
        commandResult = await appendControllerReviewDecisionEvent(
          repository,
          decision,
          options.signal,
        );
      } catch (error: unknown) {
        if (error instanceof DemandEventSourcingCommandHandlerError) {
          if (error.reason === "aborted") fail("aborted", error, "unknown");
          if (
            error.reason === "concurrency-conflict" ||
            error.reason === "stream"
          ) {
            const recovered = await recoverConcurrentDecision(
              repository,
              request,
              options.signal,
            );
            if (recovered !== null) {
              decision = recovered.decision;
              commandResult = recovered.commandResult;
            } else {
              fail(
                error.reason === "concurrency-conflict" ? "state" : "event",
                error,
                error.reason === "stream" ? "unknown" : "unchanged",
              );
            }
          } else if (error.reason === "decision-rejected") {
            fail("transition", error);
          } else if (error.reason === "idempotency-conflict") {
            fail("state", error);
          } else {
            fail("event", error, "unknown");
          }
        } else {
          throw error;
        }
      }
      returned = Object.freeze({
        status:
          commandResult.disposition === "committed"
            ? ("decided" as const)
            : ("already-decided" as const),
        disposition: commandResult.disposition,
        eventAuthority: "current" as const,
        decision,
        commandDigest: commandResult.commandDigest,
        commandResult,
        commitDigest: computeDemandEventStreamCommitDigest(
          commandResult.commit,
        ),
      });
    } catch (error: unknown) {
      failure = error;
    }

    try {
      await closeDemandOperationAuthorityContext(context);
    } catch (error: unknown) {
      if (failure === undefined) {
        failure =
          error instanceof DemandOperationAuthorityContextError
            ? new ControllerImplementationReviewDecisionServiceError(
                error.reason === "root" ? "root" : "operation-failure",
                error.code,
                error.reason,
                returned === undefined ? "unchanged" : "current",
              )
            : error;
      }
    }
    if (failure !== undefined) throw failure;
    if (returned === undefined) fail("operation-failure");
    return returned;
  }
}
