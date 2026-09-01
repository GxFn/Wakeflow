import { types } from "node:util";

import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
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
  type AuditedDemandTargetResultHistory,
} from "../demand/event-sourcing/demand-event-sourcing-repository.js";
import { DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMIT_BYTES } from "../demand/event-sourcing/demand-file-event-store-contract.js";
import {
  buildDemandResultReviewSnapshotFromHistory,
  type DemandResultReviewDecidedTarget,
  type DemandResultReviewSnapshot,
} from "./demand-result-review-snapshot.js";
import {
  controllerTargetReviewResumeCommitId,
  createControllerTargetReviewResume,
  ControllerTargetReviewResumeError,
  type ControllerTargetReviewResume,
} from "./controller-target-review-resume.js";
import {
  parseControllerTargetReviewResumeOptions,
  parseControllerTargetReviewResumeRequest,
  ControllerTargetReviewResumeInputError,
  type ControllerTargetReviewResumeOptions,
  type ControllerTargetReviewResumeRequest,
} from "./controller-target-review-resume-input.js";

/**
 * Wakeflow Governance / Review：显式恢复一个精确blocked Review generation。
 *
 * Service只把同一TargetResult恢复为其work type对应的reported phase。恢复后仍须重新
 * 读取Snapshot、运行Controller检查并提交下一代Decision；本服务不根据resolution summary
 * 作业务判断，也不创建Test attempt。
 */

export interface ControllerTargetReviewResumeServiceResult {
  readonly status: "resumed" | "already-resumed";
  readonly disposition: "committed" | "idempotent";
  readonly eventAuthority: "current";
  readonly resume: Readonly<ControllerTargetReviewResume>;
  readonly commandDigest: Sha256Digest;
  readonly commandResult: Readonly<DemandEventSourcingCommandResult>;
  readonly commitDigest: Sha256Digest;
}

export type ControllerTargetReviewResumeServiceErrorReason =
  | "input"
  | "root"
  | "config"
  | "demand-authority"
  | "controller-authority"
  | "review-snapshot"
  | "state"
  | "resume"
  | "transition"
  | "event"
  | "capacity"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Controller Target Review Resume input is invalid.",
  root: "Controller Target Review Resume root could not be held safely.",
  config:
    "Controller Target Review Resume Config authority is invalid or stale.",
  "demand-authority":
    "Controller Target Review Resume Demand authority is invalid.",
  "controller-authority":
    "Controller Target Review Resume Controller authority is invalid.",
  "review-snapshot":
    "Controller Target Review Resume Snapshot is stale or inconsistent.",
  state: "Controller Target Review Resume state is invalid.",
  resume: "Controller Target Review Resume record is invalid.",
  transition: "Controller Target Review Resume transition is not admitted.",
  event: "Controller Target Review Resume Event append failed.",
  capacity:
    "Controller Target Review Resume Event Commit exceeds its capacity.",
  aborted: "Controller Target Review Resume was aborted.",
  "operation-failure": "Controller Target Review Resume operation failed.",
} as const satisfies Readonly<
  Record<ControllerTargetReviewResumeServiceErrorReason, string>
>;

export class ControllerTargetReviewResumeServiceError extends Error {
  override readonly name = "ControllerTargetReviewResumeServiceError";
  readonly code = "wakeflow-controller-target-review-resume-service" as const;
  readonly reason: ControllerTargetReviewResumeServiceErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly eventAuthority: "unchanged" | "current" | "unknown";

  constructor(
    reason: ControllerTargetReviewResumeServiceErrorReason,
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
  reason: ControllerTargetReviewResumeServiceErrorReason,
  cause?: unknown,
  eventAuthority: "unchanged" | "current" | "unknown" = "unchanged",
): never {
  throw new ControllerTargetReviewResumeServiceError(
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

async function auditHistory(
  repository: DemandEventSourcingRepository,
  signal: AbortSignal | undefined,
  eventAuthority: "unchanged" | "current" | "unknown" = "unchanged",
): Promise<Readonly<AuditedDemandTargetResultHistory>> {
  try {
    return await repository.auditTargetResultHistory(
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingRepositoryError) {
      if (error.reason === "aborted") fail("aborted", error, eventAuthority);
      if (error.reason === "stream" || error.reason === "not-found") {
        fail("state", error, eventAuthority);
      }
      fail("event", error, "unknown");
    }
    throw error;
  }
}

function assertExistingMatchesRequest(
  resume: Readonly<ControllerTargetReviewResume>,
  request: Readonly<ControllerTargetReviewResumeRequest>,
): void {
  if (
    resume.demandId !== request.demandId ||
    resume.targetTaskId !== request.targetTaskId ||
    resume.blockedSource.streamRevision !==
      request.expectedBlockedState.streamRevision ||
    resume.blockedSource.stateDigest !==
      request.expectedBlockedState.stateDigest ||
    resume.resolutionSummary !== request.resolutionSummary
  ) {
    fail("state");
  }
}

function existingResume(
  history: Readonly<AuditedDemandTargetResultHistory>,
  request: Readonly<ControllerTargetReviewResumeRequest>,
): Readonly<ControllerTargetReviewResume> | null {
  const matches = history.targetReviewResumes.filter(
    (entry) =>
      entry.resume.targetTaskId === request.targetTaskId &&
      entry.resume.blockedSource.streamRevision ===
        request.expectedBlockedState.streamRevision &&
      entry.resume.blockedSource.stateDigest ===
        request.expectedBlockedState.stateDigest,
  );
  if (matches.length === 0) return null;
  if (matches.length !== 1) fail("state");
  const source = matches[0];
  if (source === undefined) fail("state");
  assertExistingMatchesRequest(source.resume, request);
  return source.resume;
}

interface BlockedTargetSource {
  readonly snapshot: Readonly<DemandResultReviewSnapshot>;
  readonly target: Readonly<DemandResultReviewDecidedTarget>;
}

function blockedTarget(
  history: Readonly<AuditedDemandTargetResultHistory>,
  request: Readonly<ControllerTargetReviewResumeRequest>,
): Readonly<BlockedTargetSource> {
  const snapshot = buildDemandResultReviewSnapshotFromHistory(history);
  const target = snapshot.targets.find(
    (entry) => entry.targetTaskId === request.targetTaskId,
  );
  const testWork =
    target?.status === "review-decided" &&
    target.taskPackage.workType === "test";
  if (
    snapshot.demand.demandId !== request.demandId ||
    snapshot.demand.lifecycle !== "active" ||
    snapshot.eventStream.streamRevision !==
      request.expectedBlockedState.streamRevision ||
    snapshot.eventStream.stateDigest !==
      request.expectedBlockedState.stateDigest ||
    history.aggregate.streamRevision !==
      request.expectedBlockedState.streamRevision ||
    history.aggregate.stateDigest !==
      request.expectedBlockedState.stateDigest ||
    target?.status !== "review-decided" ||
    target.phase !== (testWork ? "test-review-blocked" : "review-blocked") ||
    target.targetResult.workType !== target.taskPackage.workType ||
    (target.reviewDecision.kind === "WakeflowControllerTestReviewDecision") !==
      testWork ||
    target.reviewDecision.decision !== "blocked"
  ) {
    fail("review-snapshot");
  }
  return Object.freeze({ snapshot, target });
}

function command(resume: Readonly<ControllerTargetReviewResume>) {
  return parseDemandEventSourcingCommand({
    commandType: "review.resume-target-result",
    commandVersion: 1,
    resume,
  });
}

function preflight(
  history: Readonly<AuditedDemandTargetResultHistory>,
  resume: Readonly<ControllerTargetReviewResume>,
): void {
  try {
    const parsed = command(resume);
    const events = decideDemandEventSourcingCommand(
      history.aggregate.state,
      parsed,
    );
    const prepared = prepareDemandEventStreamCommit(history.aggregate, {
      commitId: controllerTargetReviewResumeCommitId(resume),
      commandDigest: computeDemandEventSourcingCommandDigest(parsed),
      events,
    });
    if (
      encodeUtf8(renderDemandEventStreamCommit(prepared.commit)).byteLength >
      DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMIT_BYTES
    ) {
      fail("capacity");
    }
  } catch (error: unknown) {
    if (error instanceof ControllerTargetReviewResumeServiceError) throw error;
    if (
      error instanceof DemandEventSourcingDecisionError ||
      error instanceof DemandEventStreamCommitError
    ) {
      fail("transition", error);
    }
    throw error;
  }
}

async function executeResumeEvent(
  repository: DemandEventSourcingRepository,
  resume: Readonly<ControllerTargetReviewResume>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandEventSourcingCommandResult>> {
  return executeDemandEventSourcingCommand(repository, command(resume), {
    commitId: controllerTargetReviewResumeCommitId(resume),
    expectedStreamRevision: resume.blockedSource.streamRevision,
    ...(signal === undefined ? {} : { signal }),
  });
}

async function recoverConcurrentResume(
  repository: DemandEventSourcingRepository,
  request: Readonly<ControllerTargetReviewResumeRequest>,
  signal: AbortSignal | undefined,
): Promise<Readonly<{
  readonly resume: Readonly<ControllerTargetReviewResume>;
  readonly commandResult: Readonly<DemandEventSourcingCommandResult>;
}> | null> {
  const history = await auditHistory(repository, signal, "unknown");
  const recovered = existingResume(history, request);
  if (recovered === null) return null;
  let commandResult: Readonly<DemandEventSourcingCommandResult>;
  try {
    commandResult = await executeResumeEvent(repository, recovered, signal);
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingCommandHandlerError) {
      if (error.reason === "aborted") fail("aborted", error, "current");
      fail("event", error, "current");
    }
    throw error;
  }
  return Object.freeze({ resume: recovered, commandResult });
}

export class ControllerTargetReviewResumeService {
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

  async resume(
    requestValue: unknown,
    optionsValue: ControllerTargetReviewResumeOptions = {},
  ): Promise<Readonly<ControllerTargetReviewResumeServiceResult>> {
    let request: Readonly<ControllerTargetReviewResumeRequest>;
    let options;
    try {
      request = parseControllerTargetReviewResumeRequest(requestValue);
      options = parseControllerTargetReviewResumeOptions(optionsValue);
    } catch (error: unknown) {
      if (error instanceof ControllerTargetReviewResumeInputError) {
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
      Readonly<ControllerTargetReviewResumeServiceResult> | undefined;
    let failure: unknown;
    try {
      const repository = new DemandEventSourcingRepository(context.demandRoot);
      const history = await auditHistory(repository, options.signal);
      let resume = existingResume(history, request);
      let commandResult: Readonly<DemandEventSourcingCommandResult>;
      if (resume === null) {
        const blocked = blockedTarget(history, request);
        const target = blocked.target;
        if (
          context.config.model.program.programId !==
            target.taskPackage.programId ||
          context.loaded.identity.programId !== target.taskPackage.programId ||
          target.taskPackage.demandId !== request.demandId
        ) {
          fail("controller-authority");
        }
        try {
          resume = createControllerTargetReviewResume(
            {
              programId: target.taskPackage.programId,
              demandId: request.demandId,
              targetTaskId: request.targetTaskId,
              controllerWindowId:
                context.config.indexes.controllerWindow.windowId,
              blockedDecision: {
                targetReviewDecisionId:
                  target.reviewDecision.targetReviewDecisionId,
                decisionDigest: target.reviewDecision.decisionDigest,
                targetResultId: target.targetResult.targetResultId,
                targetResultDigest: target.targetResult.resultDigest,
              },
              blockedSource: {
                snapshotDigest: blocked.snapshot.snapshotDigest,
                stateDigest: request.expectedBlockedState.stateDigest,
                streamRevision: request.expectedBlockedState.streamRevision,
              },
              resolutionSummary: request.resolutionSummary,
            },
            {
              ...(options.clock === undefined ? {} : { clock: options.clock }),
              ...(options.uuidFactory === undefined
                ? {}
                : { uuidFactory: options.uuidFactory }),
            },
          );
        } catch (error: unknown) {
          if (error instanceof ControllerTargetReviewResumeError) {
            fail("resume", error);
          }
          throw error;
        }
        preflight(history, resume);
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
        commandResult = await executeResumeEvent(
          repository,
          resume,
          options.signal,
        );
      } catch (error: unknown) {
        if (error instanceof DemandEventSourcingCommandHandlerError) {
          if (error.reason === "aborted") fail("aborted", error, "unknown");
          if (
            error.reason === "concurrency-conflict" ||
            error.reason === "stream"
          ) {
            const recovered = await recoverConcurrentResume(
              repository,
              request,
              options.signal,
            );
            if (recovered !== null) {
              resume = recovered.resume;
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
            ? ("resumed" as const)
            : ("already-resumed" as const),
        disposition: commandResult.disposition,
        eventAuthority: "current" as const,
        resume,
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
            ? new ControllerTargetReviewResumeServiceError(
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
