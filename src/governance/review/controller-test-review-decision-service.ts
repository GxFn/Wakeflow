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
  appendControllerReviewDecisionEvent,
  auditControllerReviewDecisionHistory,
  preflightControllerReviewDecisionEvent,
  ControllerReviewDecisionEventOwnerError,
} from "./controller-review-decision-event-owner.js";
import {
  createControllerTestReviewDecision,
  ControllerTestReviewDecisionError,
  type ControllerTestReviewDecision,
  type ControllerTestReviewJudgment,
} from "./controller-test-review-decision.js";
import {
  parseControllerTestReviewDecisionOptions,
  parseControllerTestReviewDecisionRequest,
  ControllerTestReviewDecisionInputError,
  type ControllerTestReviewDecisionOptions,
  type ControllerTestReviewDecisionRequest,
} from "./controller-test-review-decision-input.js";

/**
 * Wakeflow Governance / Review：提交一份Controller Test审查决定。
 *
 * Service以TargetResult ID定位唯一当前Test reported unit，从Event Stream重建
 * Review Snapshot，并从
 * TestCard创建事件读取`maxAttempts`；请求另一attempt只形成后续授权，不创建attempt、
 * Delivery或宿主效果。相同Result与Snapshot的已提交Decision构成幂等权威。
 */

export interface ControllerTestReviewDecisionServiceResult {
  readonly status: "decided" | "already-decided";
  readonly disposition: "committed" | "idempotent";
  readonly eventAuthority: "current";
  readonly decision: Readonly<ControllerTestReviewDecision>;
  readonly commandDigest: Sha256Digest;
  readonly commandResult: Readonly<DemandEventSourcingCommandResult>;
  readonly commitDigest: Sha256Digest;
}

export type ControllerTestReviewDecisionServiceErrorReason =
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
  | "attempt-capacity"
  | "commit-capacity"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Controller Test Review Decision input is invalid.",
  root: "Controller Test Review Decision root could not be held safely.",
  config:
    "Controller Test Review Decision Config authority is invalid or stale.",
  "demand-authority":
    "Controller Test Review Decision Demand authority is invalid.",
  "controller-authority":
    "Controller Test Review Decision Controller authority is invalid.",
  "review-snapshot":
    "Controller Test Review Decision Review Snapshot is stale or inconsistent.",
  state: "Controller Test Review Decision Aggregate state is invalid.",
  decision: "Controller Test Review Decision record is invalid.",
  transition: "Controller Test Review Decision transition is not admitted.",
  event: "Controller Test Review Decision Event append failed.",
  "attempt-capacity":
    "Controller Test Review Decision requests an attempt beyond the TestCard capacity.",
  "commit-capacity":
    "Controller Test Review Decision Event Commit exceeds its capacity.",
  aborted: "Controller Test Review Decision was aborted.",
  "operation-failure": "Controller Test Review Decision operation failed.",
} as const satisfies Readonly<
  Record<ControllerTestReviewDecisionServiceErrorReason, string>
>;

export class ControllerTestReviewDecisionServiceError extends Error {
  override readonly name = "ControllerTestReviewDecisionServiceError";
  readonly code = "wakeflow-controller-test-review-decision-service" as const;
  readonly reason: ControllerTestReviewDecisionServiceErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly eventAuthority: "unchanged" | "current" | "unknown";

  constructor(
    reason: ControllerTestReviewDecisionServiceErrorReason,
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
  reason: ControllerTestReviewDecisionServiceErrorReason,
  cause?: unknown,
  eventAuthority: "unchanged" | "current" | "unknown" = "unchanged",
): never {
  throw new ControllerTestReviewDecisionServiceError(
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
  value: Readonly<ControllerTestReviewJudgment>,
): Readonly<ControllerTestReviewJudgment> {
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
  value: Readonly<ControllerTestReviewJudgment>,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(judgment(value));
}

function assertExistingMatchesRequest(
  decision: Readonly<ControllerTestReviewDecision>,
  request: Readonly<ControllerTestReviewDecisionRequest>,
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
  request: Readonly<ControllerTestReviewDecisionRequest>,
): Readonly<ControllerTestReviewDecision> | null {
  const sources = history.targetReviewDecisions.filter(
    (entry) =>
      entry.decision.kind === "WakeflowControllerTestReviewDecision" &&
      entry.decision.reviewed.targetResultId === request.targetResultId &&
      entry.decision.reviewed.snapshotDigest === request.snapshotDigest,
  );
  if (sources.length === 0) return null;
  if (sources.length !== 1 || sources[0] === undefined) {
    fail("state", undefined, "current");
  }
  const decision = sources[0].decision;
  if (decision.kind !== "WakeflowControllerTestReviewDecision") {
    fail("state", undefined, "current");
  }
  assertExistingMatchesRequest(decision, request);
  return decision;
}

function reportedTestTarget(
  history: Readonly<AuditedDemandTargetResultHistory>,
  request: Readonly<ControllerTestReviewDecisionRequest>,
): Readonly<
  DemandResultReviewReportedTarget & {
    readonly taskPackage: Extract<
      DemandResultReviewReportedTarget["taskPackage"],
      { readonly workType: "test" }
    >;
    readonly targetResult: Extract<
      DemandResultReviewReportedTarget["targetResult"],
      { readonly workType: "test" }
    >;
  }
> {
  const snapshot = buildDemandResultReviewSnapshotFromHistory(history);
  const matches = snapshot.targets.filter(
    (entry) =>
      entry.status === "reported" &&
      entry.targetResult.targetResultId === request.targetResultId,
  );
  const target = matches.length === 1 ? matches[0] : undefined;
  if (
    target?.status !== "reported" ||
    target.taskPackage.workType !== "test" ||
    target.targetResult.workType !== "test" ||
    target.targetResult.targetResultId !== request.targetResultId ||
    target.reviewUnitDigest !== request.reviewUnitDigest ||
    snapshot.snapshotDigest !== request.snapshotDigest
  ) {
    fail("review-snapshot");
  }
  return target as Readonly<
    DemandResultReviewReportedTarget & {
      readonly taskPackage: Extract<
        DemandResultReviewReportedTarget["taskPackage"],
        { readonly workType: "test" }
      >;
      readonly targetResult: Extract<
        DemandResultReviewReportedTarget["targetResult"],
        { readonly workType: "test" }
      >;
    }
  >;
}

function preflight(
  history: Readonly<AuditedDemandTargetResultHistory>,
  decision: Readonly<ControllerTestReviewDecision>,
): void {
  try {
    preflightControllerReviewDecisionEvent(history, decision);
  } catch (error: unknown) {
    if (error instanceof ControllerReviewDecisionEventOwnerError) {
      fail(
        error.reason === "capacity" ? "commit-capacity" : "transition",
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
  request: Readonly<ControllerTestReviewDecisionRequest>,
  signal: AbortSignal | undefined,
): Promise<Readonly<{
  readonly decision: Readonly<ControllerTestReviewDecision>;
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

export class ControllerTestReviewDecisionService {
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

  /** 提交当前Test reported unit的Controller决定；已提交的相同请求幂等返回。 */
  async decide(
    requestValue: unknown,
    optionsValue: ControllerTestReviewDecisionOptions = {},
  ): Promise<Readonly<ControllerTestReviewDecisionServiceResult>> {
    let request: Readonly<ControllerTestReviewDecisionRequest>;
    let options;
    try {
      request = parseControllerTestReviewDecisionRequest(requestValue);
      options = parseControllerTestReviewDecisionOptions(optionsValue);
    } catch (error: unknown) {
      if (error instanceof ControllerTestReviewDecisionInputError) {
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
      Readonly<ControllerTestReviewDecisionServiceResult> | undefined;
    let failure: unknown;
    try {
      const repository = new DemandEventSourcingRepository(context.demandRoot);
      const history = await auditHistory(repository, options.signal);
      let decision = existingDecision(history, request);
      let commandResult: Readonly<DemandEventSourcingCommandResult>;
      if (decision === null) {
        const target = reportedTestTarget(history, request);
        const aggregateTarget = history.aggregate.state.targetTasks.find(
          (entry) => entry.targetTaskId === target.targetTaskId,
        );
        const testCardSource = history.testCards.find(
          (source) =>
            source.testCard.testCardId ===
            target.targetResult.testExecution.testCard.testCardId,
        );
        if (
          context.config.model.program.programId !==
            target.taskPackage.programId ||
          context.loaded.identity.programId !== target.taskPackage.programId ||
          target.taskPackage.demandId !== request.demandId ||
          aggregateTarget?.workType !== "test" ||
          aggregateTarget.phase !== "test-result-reported" ||
          testCardSource === undefined ||
          testCardSource.testCard.testCardId !==
            target.targetResult.testExecution.testCard.testCardId ||
          testCardSource.testCard.testCardDigest !==
            target.targetResult.testExecution.testCard.testCardDigest
        ) {
          fail("controller-authority");
        }
        if (
          request.decision === "request-another-attempt" &&
          aggregateTarget.testAttempts.length >=
            testCardSource.testCard.maxAttempts
        ) {
          fail("attempt-capacity");
        }
        try {
          decision = createControllerTestReviewDecision(
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
              testExecution: target.targetResult.testExecution,
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
          if (error instanceof ControllerTestReviewDecisionError) {
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
            fail("state", error, "current");
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
            ? new ControllerTestReviewDecisionServiceError(
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
