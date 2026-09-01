import { types } from "node:util";

import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
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
import { parseDemandEventStreamRevision } from "../demand/event-sourcing/demand-event-stream-position.js";
import {
  buildDemandPostAcceptanceRoute,
  DemandPostAcceptanceRouteError,
} from "./demand-post-acceptance-route.js";
import {
  buildDemandResultReviewSnapshotFromHistory,
  DemandResultReviewSnapshotError,
} from "./demand-result-review-snapshot.js";
import {
  createControllerProductDefectRemediationAuthorization,
  productDefectRemediationAuthorizedCommitId,
  ControllerProductDefectRemediationAuthorizationError,
  type ControllerProductDefectRemediationAuthorization,
  type CreateProductDefectRemediationAffectedTargetInput,
} from "./controller-product-defect-remediation-authorization.js";
import {
  parseControllerProductDefectRemediationOptions,
  parseControllerProductDefectRemediationRequest,
  ControllerProductDefectRemediationInputError,
  type ControllerProductDefectRemediationOptions,
  type ControllerProductDefectRemediationRequest,
} from "./controller-product-defect-remediation-input.js";

/**
 * Wakeflow Governance / Review：把当前Test产品缺陷升级为同Demand产品返工授权。
 *
 * 调用方只选择受影响Target、失败检查映射和修复目标。Service从当前route、完整Event
 * history和TestCard派生baseline、Decision、Result与stream位置，并原子追加授权Event。
 */

export interface ControllerProductDefectRemediationServiceResult {
  readonly status: "authorized" | "already-authorized";
  readonly disposition: "committed" | "idempotent";
  readonly eventAuthority: "current";
  readonly authorization: Readonly<ControllerProductDefectRemediationAuthorization>;
  readonly commandDigest: Sha256Digest;
  readonly commandResult: Readonly<DemandEventSourcingCommandResult>;
  readonly commitDigest: Sha256Digest;
}

export type ControllerProductDefectRemediationServiceErrorReason =
  | "input"
  | "root"
  | "config"
  | "demand-authority"
  | "controller-authority"
  | "route"
  | "state"
  | "test-card"
  | "authorization"
  | "transition"
  | "event"
  | "capacity"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Controller Product Defect Remediation input is invalid.",
  root: "Controller Product Defect Remediation root could not be held safely.",
  config:
    "Controller Product Defect Remediation Config authority is invalid or stale.",
  "demand-authority":
    "Controller Product Defect Remediation Demand authority is invalid.",
  "controller-authority":
    "Controller Product Defect Remediation Controller authority is invalid.",
  route:
    "Controller Product Defect Remediation route is stale or inconsistent.",
  state: "Controller Product Defect Remediation Event history is invalid.",
  "test-card":
    "Controller Product Defect Remediation TestCard baseline is invalid.",
  authorization:
    "Controller Product Defect Remediation Authorization is invalid.",
  transition:
    "Controller Product Defect Remediation transition is not admitted.",
  event: "Controller Product Defect Remediation Event append failed.",
  capacity:
    "Controller Product Defect Remediation Event Commit exceeds its capacity.",
  aborted: "Controller Product Defect Remediation was aborted.",
  "operation-failure":
    "Controller Product Defect Remediation operation failed.",
} as const satisfies Readonly<
  Record<ControllerProductDefectRemediationServiceErrorReason, string>
>;

export class ControllerProductDefectRemediationServiceError extends Error {
  override readonly name = "ControllerProductDefectRemediationServiceError";
  readonly code =
    "wakeflow-controller-product-defect-remediation-service" as const;
  readonly reason: ControllerProductDefectRemediationServiceErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly eventAuthority: "unchanged" | "current" | "unknown";

  constructor(
    reason: ControllerProductDefectRemediationServiceErrorReason,
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
  reason: ControllerProductDefectRemediationServiceErrorReason,
  cause?: unknown,
  eventAuthority: "unchanged" | "current" | "unknown" = "unchanged",
): never {
  throw new ControllerProductDefectRemediationServiceError(
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

function arraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function assertExistingMatchesRequest(
  authorization: Readonly<ControllerProductDefectRemediationAuthorization>,
  request: Readonly<ControllerProductDefectRemediationRequest>,
): void {
  if (
    authorization.demandId !== request.demandId ||
    authorization.source.testReviewDecision.targetReviewDecisionId !==
      request.testReviewDecisionId ||
    authorization.source.postAcceptanceRouteDigest !==
      request.postAcceptanceRouteDigest ||
    authorization.authorizationRationale !== request.authorizationRationale ||
    authorization.affectedTargets.length !== request.affectedTargets.length ||
    request.affectedTargets.some((target, index) => {
      const existing = authorization.affectedTargets[index];
      return (
        existing === undefined ||
        existing.baseline.targetTaskId !== target.targetTaskId ||
        existing.correctionObjective !== target.correctionObjective ||
        !arraysEqual(existing.failedCheckIds, target.failedCheckIds)
      );
    })
  ) {
    fail("state", undefined, "current");
  }
}

function existingAuthorization(
  history: Readonly<AuditedDemandTargetResultHistory>,
  request: Readonly<ControllerProductDefectRemediationRequest>,
): Readonly<ControllerProductDefectRemediationAuthorization> | null {
  const sources = history.productDefectRemediationAuthorizations.filter(
    (entry) =>
      entry.authorization.source.testReviewDecision.targetReviewDecisionId ===
      request.testReviewDecisionId,
  );
  if (sources.length === 0) return null;
  if (sources.length !== 1 || sources[0] === undefined) {
    fail("state", undefined, "current");
  }
  const authorization = sources[0].authorization;
  assertExistingMatchesRequest(authorization, request);
  return authorization;
}

function command(
  authorization: Readonly<ControllerProductDefectRemediationAuthorization>,
) {
  return parseDemandEventSourcingCommand({
    commandType: "review.authorize-product-defect-remediation",
    commandVersion: 1,
    authorization,
  });
}

function preflight(
  history: Readonly<AuditedDemandTargetResultHistory>,
  authorization: Readonly<ControllerProductDefectRemediationAuthorization>,
): void {
  try {
    const parsed = command(authorization);
    const events = decideDemandEventSourcingCommand(
      history.aggregate.state,
      parsed,
    );
    const prepared = prepareDemandEventStreamCommit(history.aggregate, {
      commitId: productDefectRemediationAuthorizedCommitId(authorization),
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
    if (error instanceof ControllerProductDefectRemediationServiceError) {
      throw error;
    }
    if (
      error instanceof DemandEventSourcingDecisionError ||
      error instanceof DemandEventStreamCommitError
    ) {
      fail("transition", error);
    }
    throw error;
  }
}

async function executeAuthorizationEvent(
  repository: DemandEventSourcingRepository,
  authorization: Readonly<ControllerProductDefectRemediationAuthorization>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandEventSourcingCommandResult>> {
  return executeDemandEventSourcingCommand(repository, command(authorization), {
    commitId: productDefectRemediationAuthorizedCommitId(authorization),
    expectedStreamRevision: authorization.source.streamRevision,
    ...(signal === undefined ? {} : { signal }),
  });
}

function initialAuthorization(
  context: Readonly<DemandOperationAuthorityContext>,
  history: Readonly<AuditedDemandTargetResultHistory>,
  request: Readonly<ControllerProductDefectRemediationRequest>,
  options: Readonly<{
    readonly clock: ControllerProductDefectRemediationOptions["clock"];
    readonly uuidFactory: ControllerProductDefectRemediationOptions["uuidFactory"];
  }>,
): Readonly<ControllerProductDefectRemediationAuthorization> {
  if (
    context.loaded.aggregate.streamRevision !==
      history.aggregate.streamRevision ||
    context.loaded.aggregate.stateDigest !== history.aggregate.stateDigest
  ) {
    fail("state");
  }
  let route;
  try {
    const snapshot = buildDemandResultReviewSnapshotFromHistory(history);
    route = buildDemandPostAcceptanceRoute(context.loaded, snapshot);
  } catch (error: unknown) {
    if (
      error instanceof DemandResultReviewSnapshotError ||
      error instanceof DemandPostAcceptanceRouteError
    ) {
      fail("route", error);
    }
    throw error;
  }
  if (
    route.nextStage.status !== "test-product-defect-escalated" ||
    route.routeDigest !== request.postAcceptanceRouteDigest ||
    route.nextStage.testReview.targetReviewDecisionId !==
      request.testReviewDecisionId
  ) {
    fail("route");
  }
  const decisionSources = history.targetReviewDecisions.filter(
    (entry) =>
      entry.decision.targetReviewDecisionId === request.testReviewDecisionId,
  );
  if (decisionSources.length !== 1 || decisionSources[0] === undefined) {
    fail("controller-authority");
  }
  const decision = decisionSources[0].decision;
  if (
    decision.kind !== "WakeflowControllerTestReviewDecision" ||
    decision.decision !== "escalate-product-defect" ||
    decision.targetTaskId !== route.nextStage.testReview.targetTaskId ||
    decision.testExecution.testCard.testCardId !==
      route.nextStage.testReview.testCardId ||
    decision.testExecution.testCard.testCardDigest !==
      route.nextStage.testReview.testCardDigest ||
    decision.controllerWindowId !==
      context.config.indexes.controllerWindow.windowId ||
    decision.programId !== context.config.model.program.programId ||
    decision.programId !== context.loaded.identity.programId
  ) {
    fail("controller-authority");
  }
  const testCardSource = history.testCards.find(
    (entry) =>
      entry.testCard.testCardId === decision.testExecution.testCard.testCardId,
  );
  if (
    testCardSource === undefined ||
    testCardSource.testCard.testCardDigest !==
      decision.testExecution.testCard.testCardDigest
  ) {
    fail("test-card");
  }
  const baselineByTarget = new Map(
    testCardSource.testCard.implementationBaselines.map(
      (baseline) => [baseline.targetTaskId, baseline] as const,
    ),
  );
  const acceptedByTarget = new Map(
    route.acceptedTargets.map(
      (target) => [target.targetTaskId, target] as const,
    ),
  );
  const mappedTargets = request.affectedTargets.map((target) => {
    const baseline = baselineByTarget.get(target.targetTaskId);
    const accepted = acceptedByTarget.get(target.targetTaskId);
    if (
      baseline === undefined ||
      accepted === undefined ||
      accepted.taskPackageId !== baseline.taskPackageId ||
      accepted.taskPackageDigest !== baseline.taskPackageDigest ||
      accepted.repositoryId !== baseline.repositoryId ||
      accepted.windowId !== baseline.windowId ||
      accepted.targetResultId !== baseline.targetResultId ||
      accepted.resultDigest !== baseline.resultDigest ||
      accepted.targetReviewDecisionId !== baseline.targetReviewDecisionId ||
      accepted.decisionDigest !== baseline.decisionDigest
    ) {
      fail("test-card");
    }
    return Object.freeze({
      baseline,
      failedCheckIds: target.failedCheckIds,
      correctionObjective: target.correctionObjective,
    });
  });
  const firstTarget = mappedTargets[0];
  if (firstTarget === undefined) fail("input");
  const affectedTargets: readonly [
    Readonly<CreateProductDefectRemediationAffectedTargetInput>,
    ...Readonly<CreateProductDefectRemediationAffectedTargetInput>[],
  ] = Object.freeze([firstTarget, ...mappedTargets.slice(1)]);
  try {
    return createControllerProductDefectRemediationAuthorization(
      {
        decision,
        routeSource: {
          postAcceptanceRouteDigest: route.routeDigest,
          reviewSnapshotDigest: route.reviewSnapshotDigest,
          stateDigest: route.observedEventStream.stateDigest,
          streamRevision: parseDemandEventStreamRevision(
            route.observedEventStream.streamRevision,
          ),
        },
        affectedTargets,
        authorizationRationale: request.authorizationRationale,
      },
      {
        ...(options.clock === undefined ? {} : { clock: options.clock }),
        ...(options.uuidFactory === undefined
          ? {}
          : { uuidFactory: options.uuidFactory }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof ControllerProductDefectRemediationAuthorizationError) {
      fail("authorization", error);
    }
    throw error;
  }
}

async function recoverConcurrentAuthorization(
  repository: DemandEventSourcingRepository,
  request: Readonly<ControllerProductDefectRemediationRequest>,
  signal: AbortSignal | undefined,
): Promise<Readonly<{
  readonly authorization: Readonly<ControllerProductDefectRemediationAuthorization>;
  readonly commandResult: Readonly<DemandEventSourcingCommandResult>;
}> | null> {
  const history = await auditHistory(repository, signal, "unknown");
  const recovered = existingAuthorization(history, request);
  if (recovered === null) return null;
  let commandResult: Readonly<DemandEventSourcingCommandResult>;
  try {
    commandResult = await executeAuthorizationEvent(
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
  return Object.freeze({ authorization: recovered, commandResult });
}

export class ControllerProductDefectRemediationService {
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

  async authorize(
    requestValue: unknown,
    optionsValue: ControllerProductDefectRemediationOptions = {},
  ): Promise<Readonly<ControllerProductDefectRemediationServiceResult>> {
    let request: Readonly<ControllerProductDefectRemediationRequest>;
    let options;
    try {
      request = parseControllerProductDefectRemediationRequest(requestValue);
      options = parseControllerProductDefectRemediationOptions(optionsValue);
    } catch (error: unknown) {
      if (error instanceof ControllerProductDefectRemediationInputError) {
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
      Readonly<ControllerProductDefectRemediationServiceResult> | undefined;
    let failure: unknown;
    try {
      const repository = new DemandEventSourcingRepository(context.demandRoot);
      const history = await auditHistory(repository, options.signal);
      let authorization = existingAuthorization(history, request);
      let commandResult: Readonly<DemandEventSourcingCommandResult>;
      if (authorization === null) {
        authorization = initialAuthorization(
          context,
          history,
          request,
          options,
        );
        preflight(history, authorization);
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
        commandResult = await executeAuthorizationEvent(
          repository,
          authorization,
          options.signal,
        );
      } catch (error: unknown) {
        if (error instanceof DemandEventSourcingCommandHandlerError) {
          if (error.reason === "aborted") fail("aborted", error, "unknown");
          if (
            error.reason === "concurrency-conflict" ||
            error.reason === "stream"
          ) {
            const recovered = await recoverConcurrentAuthorization(
              repository,
              request,
              options.signal,
            );
            if (recovered === null) {
              fail(
                error.reason === "concurrency-conflict" ? "state" : "event",
                error,
                error.reason === "stream" ? "unknown" : "unchanged",
              );
            }
            authorization = recovered.authorization;
            commandResult = recovered.commandResult;
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
            ? ("authorized" as const)
            : ("already-authorized" as const),
        disposition: commandResult.disposition,
        eventAuthority: "current" as const,
        authorization,
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
            ? new ControllerProductDefectRemediationServiceError(
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
