import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  computeDemandEventSourcingCommandDigest,
  decideDemandEventSourcingCommand,
  parseDemandEventSourcingCommand,
  DemandEventSourcingDecisionError,
} from "../demand/event-sourcing/demand-event-sourcing-decider.js";
import {
  executeDemandEventSourcingCommand,
  type DemandEventSourcingCommandResult,
} from "../demand/event-sourcing/demand-event-sourcing-command-handler.js";
import {
  prepareDemandEventStreamCommit,
  renderDemandEventStreamCommit,
  DemandEventStreamCommitError,
} from "../demand/event-sourcing/demand-event-stream-commit.js";
import {
  DemandEventSourcingRepository,
  DemandEventSourcingRepositoryError,
  type AuditedDemandTargetResultHistory,
} from "../demand/event-sourcing/demand-event-sourcing-repository.js";
import { DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMIT_BYTES } from "../demand/event-sourcing/demand-file-event-store-contract.js";
import {
  controllerReviewDecisionCommitId,
  type ControllerReviewDecision,
} from "./controller-review-decision.js";

/**
 * 两类Controller Review Service共享的Event持久化机制。
 *
 * 本模块只拥有共享Event command、预检、容量与append调用，不选择Decision类型、不创建
 * Decision、不判断Test attempt容量，也不恢复并发业务winner。source-specific Service仍
 * 负责这些业务边界。
 */

export type ControllerReviewDecisionEventAuthority =
  "unchanged" | "current" | "unknown";

export type ControllerReviewDecisionEventOwnerErrorReason =
  "aborted" | "capacity" | "event" | "state" | "transition";

export class ControllerReviewDecisionEventOwnerError extends Error {
  override readonly name = "ControllerReviewDecisionEventOwnerError";
  readonly code = "wakeflow-controller-review-decision-event-owner" as const;
  readonly reason: ControllerReviewDecisionEventOwnerErrorReason;
  readonly sourceError: unknown;
  readonly eventAuthority: ControllerReviewDecisionEventAuthority;

  constructor(
    reason: ControllerReviewDecisionEventOwnerErrorReason,
    cause?: unknown,
    eventAuthority: ControllerReviewDecisionEventAuthority = "unchanged",
  ) {
    super(`Controller Review Decision Event owner failed: ${reason}.`);
    this.reason = reason;
    this.sourceError = cause;
    this.eventAuthority = eventAuthority;
  }
}

function fail(
  reason: ControllerReviewDecisionEventOwnerErrorReason,
  cause?: unknown,
  eventAuthority: ControllerReviewDecisionEventAuthority = "unchanged",
): never {
  throw new ControllerReviewDecisionEventOwnerError(
    reason,
    cause,
    eventAuthority,
  );
}

export function createControllerReviewDecisionCommand(
  decision: Readonly<ControllerReviewDecision>,
) {
  return parseDemandEventSourcingCommand({
    commandType: "review.decide-target-result",
    commandVersion: 1,
    decision,
  });
}

export function preflightControllerReviewDecisionEvent(
  history: Readonly<AuditedDemandTargetResultHistory>,
  decision: Readonly<ControllerReviewDecision>,
): void {
  try {
    const command = createControllerReviewDecisionCommand(decision);
    const events = decideDemandEventSourcingCommand(
      history.aggregate.state,
      command,
    );
    const prepared = prepareDemandEventStreamCommit(history.aggregate, {
      commitId: controllerReviewDecisionCommitId(decision),
      commandDigest: computeDemandEventSourcingCommandDigest(command),
      events,
    });
    if (
      encodeUtf8(renderDemandEventStreamCommit(prepared.commit)).byteLength >
      DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMIT_BYTES
    ) {
      fail("capacity");
    }
  } catch (error: unknown) {
    if (error instanceof ControllerReviewDecisionEventOwnerError) throw error;
    if (
      error instanceof DemandEventSourcingDecisionError ||
      error instanceof DemandEventStreamCommitError
    ) {
      fail("transition", error);
    }
    throw error;
  }
}

export async function auditControllerReviewDecisionHistory(
  repository: DemandEventSourcingRepository,
  signal: AbortSignal | undefined,
  eventAuthority: ControllerReviewDecisionEventAuthority = "unchanged",
): Promise<Readonly<AuditedDemandTargetResultHistory>> {
  // 最多三次重读只用于跨过已知的提交链接结算窗口；持续stream错误仍按损坏失败。
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await repository.auditTargetResultHistory(
        signal === undefined ? undefined : { signal },
      );
    } catch (error: unknown) {
      if (error instanceof DemandEventSourcingRepositoryError) {
        if (error.reason === "aborted") fail("aborted", error);
        if (error.reason === "stream" && attempt < 3) continue;
        if (error.reason === "stream" || error.reason === "not-found") {
          fail("state", error, eventAuthority);
        }
        fail(
          "event",
          error,
          eventAuthority === "unchanged" ? "unknown" : eventAuthority,
        );
      }
      throw error;
    }
  }
  fail("state", undefined, eventAuthority);
}

export async function appendControllerReviewDecisionEvent(
  repository: DemandEventSourcingRepository,
  decision: Readonly<ControllerReviewDecision>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandEventSourcingCommandResult>> {
  return executeDemandEventSourcingCommand(
    repository,
    createControllerReviewDecisionCommand(decision),
    {
      commitId: controllerReviewDecisionCommitId(decision),
      expectedStreamRevision: decision.reviewed.streamRevision,
      ...(signal === undefined ? {} : { signal }),
    },
  );
}
