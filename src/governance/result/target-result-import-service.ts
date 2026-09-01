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
import {
  DemandEventSourcingRepository,
  DemandEventSourcingRepositoryError,
} from "../demand/event-sourcing/demand-event-sourcing-repository.js";
import { DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMIT_BYTES } from "../demand/event-sourcing/demand-file-event-store-contract.js";
import {
  inspectWindowWorkClaim,
  WindowWorkClaimStoreError,
} from "../delivery/window-work-claim-store.js";
import { settleAuthorizedWindowWorkClaimRelease } from "../delivery/window-work-claim-release-settlement.js";
import type { WindowWorkClaim } from "../delivery/window-work-claim.js";
import type { TargetDeliveryHostEffectObservation } from "../delivery/target-delivery-host-effect-observation.js";
import {
  targetResultRecordedCommitIdFromResult,
  type TargetResult,
} from "./target-result.js";
import {
  createImplementationTargetResult,
  ImplementationTargetResultError,
} from "./implementation-target-result.js";
import {
  createTestTargetResult,
  TestTargetResultError,
} from "./test-target-result.js";
import {
  createImplementationTargetResultReport,
  implementationTargetResultReportContentDigest,
  ImplementationTargetResultReportError,
  type ImplementationTargetResultReport,
} from "./implementation-target-result-report.js";
import {
  createTestTargetResultReport,
  testTargetResultReportContentDigest,
  TestTargetResultReportError,
  type TestTargetResultReport,
} from "./test-target-result-report.js";
import {
  loadTargetResultImportSources,
  TargetResultImportAuthorityError,
} from "./target-result-import-authority.js";
import {
  parseTargetResultImportOptions,
  parseTargetResultImportRequest,
  TargetResultImportInputError,
  type TargetResultImportOptions,
} from "./target-result-import-input.js";

/**
 * Wakeflow Governance / Result：把Agent Report导入当前TargetResult Event。
 *
 * Service从历史TaskPackage、Intent、Claim和Host Effect Observation恢复完整authority，提交
 * Result Event后才精确释放Claim。Report的completed/blocked/needs-review只是目标陈述，绝不在
 * 本层产生Controller acceptance。
 */

export interface TargetResultImportResult {
  readonly status: "recorded" | "already-recorded";
  readonly disposition: "committed" | "idempotent";
  readonly claimAuthority: "released";
  readonly eventAuthority: "current";
  readonly claim: Readonly<WindowWorkClaim>;
  readonly observation: Readonly<TargetDeliveryHostEffectObservation>;
  readonly result: Readonly<TargetResult>;
  readonly commandDigest: Sha256Digest;
  readonly commandResult: Readonly<DemandEventSourcingCommandResult>;
  readonly commitDigest: Sha256Digest;
}

export type TargetResultImportServiceErrorReason =
  | "input"
  | "root"
  | "config"
  | "demand-authority"
  | "task-package"
  | "intent"
  | "test-card"
  | "packet"
  | "claim-event"
  | "host"
  | "observation"
  | "report"
  | "state"
  | "claim"
  | "recovery-required"
  | "transition"
  | "event"
  | "capacity"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "TargetResult Import input is invalid.",
  root: "TargetResult Import root could not be held safely.",
  config: "TargetResult Import Config authority is unavailable.",
  "demand-authority": "TargetResult Import Demand authority is invalid.",
  "task-package": "TargetResult Import TaskPackage authority is invalid.",
  intent: "TargetResult Import TargetDeliveryIntent authority is invalid.",
  "test-card": "TargetResult Import TestCard authority is invalid.",
  packet: "TargetResult Import TestDispatchPacket authority is invalid.",
  "claim-event": "TargetResult Import Claim Event authority is invalid.",
  host: "TargetResult Import Claim belongs to another Host.",
  observation:
    "TargetResult Import Host Effect Observation authority is invalid.",
  report: "TargetResult Import Agent report is invalid.",
  state: "TargetResult Import Aggregate state is invalid.",
  claim: "TargetResult Import Claim release failed.",
  "recovery-required": "TargetResult Import requires explicit recovery.",
  transition: "TargetResult Import transition is not admitted.",
  event: "TargetResult Import event append failed.",
  capacity: "TargetResult Import event commit exceeds its capacity.",
  aborted: "TargetResult Import was aborted.",
  "operation-failure": "TargetResult Import operation failed.",
} as const satisfies Readonly<
  Record<TargetResultImportServiceErrorReason, string>
>;

export class TargetResultImportServiceError extends Error {
  override readonly name = "TargetResultImportServiceError";
  readonly code = "wakeflow-target-result-import-service" as const;
  readonly reason: TargetResultImportServiceErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly eventAuthority: "unchanged" | "current" | "unknown";
  readonly claimAuthority: "current" | "released" | "unknown";

  constructor(
    reason: TargetResultImportServiceErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    eventAuthority: "unchanged" | "current" | "unknown" = "unchanged",
    claimAuthority: "current" | "released" | "unknown" = "unknown",
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
    this.eventAuthority = eventAuthority;
    this.claimAuthority = claimAuthority;
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
  reason: TargetResultImportServiceErrorReason,
  cause?: unknown,
  eventAuthority: "unchanged" | "current" | "unknown" = "unchanged",
  claimAuthority: "current" | "released" | "unknown" = "unknown",
): never {
  throw new TargetResultImportServiceError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    eventAuthority,
    claimAuthority,
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

function reportContent(report: Readonly<ImplementationTargetResultReport>) {
  return Object.freeze({
    outcome: report.outcome,
    summary: report.summary,
    repositoryChange: report.repositoryChange,
    evidenceLocators: report.evidenceLocators,
    verification: report.verification,
    risks: report.risks,
    anchorEvidence: report.anchorEvidence,
  });
}

function testReportContent(report: Readonly<TestTargetResultReport>) {
  return Object.freeze({
    outcome: report.outcome,
    summary: report.summary,
    evidenceLocators: report.evidenceLocators,
    verification: report.verification,
    risks: report.risks,
    stepEvidence: report.stepEvidence,
  });
}

function command(result: Readonly<TargetResult>) {
  return parseDemandEventSourcingCommand({
    commandType: "result.record-target-result",
    commandVersion: 1,
    result,
  });
}

function preflight(
  aggregate: Readonly<
    Awaited<ReturnType<DemandEventSourcingRepository["audit"]>>["aggregate"]
  >,
  result: Readonly<TargetResult>,
): void {
  try {
    const parsed = command(result);
    const events = decideDemandEventSourcingCommand(aggregate.state, parsed);
    const prepared = prepareDemandEventStreamCommit(aggregate, {
      commitId: targetResultRecordedCommitIdFromResult(result),
      commandDigest: computeDemandEventSourcingCommandDigest(parsed),
      events,
    });
    if (
      encodeUtf8(renderDemandEventStreamCommit(prepared.commit)).byteLength >
      DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMIT_BYTES
    ) {
      fail("capacity", undefined, "unchanged", "current");
    }
  } catch (error: unknown) {
    if (error instanceof TargetResultImportServiceError) throw error;
    if (
      error instanceof DemandEventSourcingDecisionError ||
      error instanceof DemandEventStreamCommitError
    ) {
      fail("transition", error, "unchanged", "current");
    }
    throw error;
  }
}

async function executeResultEvent(
  repository: DemandEventSourcingRepository,
  aggregate: Readonly<
    Awaited<ReturnType<DemandEventSourcingRepository["audit"]>>["aggregate"]
  >,
  result: Readonly<TargetResult>,
  claimAuthority: "current" | "released",
  signal: AbortSignal | undefined,
): Promise<
  Readonly<{
    readonly commandDigest: Sha256Digest;
    readonly result: Readonly<DemandEventSourcingCommandResult>;
  }>
> {
  const parsed = command(result);
  const commandDigest = computeDemandEventSourcingCommandDigest(parsed);
  const commitId = targetResultRecordedCommitIdFromResult(result);
  let existing;
  try {
    existing = await repository.findCommitById(
      commitId,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingRepositoryError) {
      if (error.reason === "aborted") {
        fail("aborted", error, "unknown", claimAuthority);
      }
      fail("event", error, "unknown", claimAuthority);
    }
    throw error;
  }
  const knownEventAuthority =
    existing === null ? ("unchanged" as const) : ("current" as const);
  if (existing === null) preflight(aggregate, result);
  try {
    const executed = await executeDemandEventSourcingCommand(
      repository,
      parsed,
      {
        commitId,
        expectedStreamRevision:
          existing?.expectedStreamRevision ?? aggregate.streamRevision,
        ...(signal === undefined ? {} : { signal }),
      },
    );
    return Object.freeze({ commandDigest, result: executed });
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingCommandHandlerError) {
      if (error.reason === "aborted") {
        fail(
          "aborted",
          error,
          existing === null ? "unknown" : "current",
          claimAuthority,
        );
      }
      if (error.reason === "decision-rejected") {
        fail("transition", error, knownEventAuthority, claimAuthority);
      }
      if (error.reason === "concurrency-conflict") {
        fail("state", error, knownEventAuthority, claimAuthority);
      }
      fail(
        "event",
        error,
        existing === null ? "unknown" : "current",
        claimAuthority,
      );
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

export class TargetResultImportService {
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

  async import(
    requestValue: unknown,
    optionsValue: TargetResultImportOptions = {},
  ): Promise<Readonly<TargetResultImportResult>> {
    let request;
    let options;
    try {
      request = parseTargetResultImportRequest(requestValue);
      options = parseTargetResultImportOptions(optionsValue);
    } catch (error: unknown) {
      if (error instanceof TargetResultImportInputError) {
        fail(
          error.reason === "aborted"
            ? "aborted"
            : error.reason === "report"
              ? "report"
              : "input",
          error,
        );
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

    let returned: Readonly<TargetResultImportResult> | undefined;
    let failure: unknown;
    let knownEventAuthority: "unchanged" | "current" | "unknown" = "unchanged";
    let knownClaimAuthority: "current" | "released" | "unknown" = "unknown";
    try {
      const repository = new DemandEventSourcingRepository(context.demandRoot);
      let sources;
      try {
        sources = await loadTargetResultImportSources(
          context,
          this.#hostId,
          request,
          options.signal,
        );
      } catch (error: unknown) {
        if (error instanceof TargetResultImportAuthorityError) {
          fail(error.reason, error, error.eventAuthority, "unknown");
        }
        throw error;
      }
      const { claim, observation } = sources;
      const existingEvent = sources.existingResultEvent;
      knownEventAuthority = existingEvent === null ? "unchanged" : "current";
      let result: Readonly<TargetResult>;
      if (existingEvent !== null) {
        result = existingEvent.event.data.result;
        const reportMatches =
          request.report.workType === "test"
            ? result.workType === "test" &&
              testTargetResultReportContentDigest(
                testReportContent(result.report),
              ) === testTargetResultReportContentDigest(request.report.content)
            : result.workType === "implementation" &&
              implementationTargetResultReportContentDigest(
                reportContent(result.report),
              ) ===
                implementationTargetResultReportContentDigest(
                  request.report.content,
                );
        if (
          !reportMatches ||
          result.targetTaskId !== claim.target.targetTaskId ||
          result.targetDeliveryId !== claim.target.targetDeliveryId ||
          result.hostEffect.observationDigest !== request.observationDigest
        ) {
          fail("state", undefined, knownEventAuthority);
        }
      } else if (
        request.report.workType === "test" &&
        sources.workType === "test"
      ) {
        let report: Readonly<TestTargetResultReport>;
        try {
          report = createTestTargetResultReport(request.report.content, {
            ...(options.clock === undefined ? {} : { clock: options.clock }),
          });
        } catch (error: unknown) {
          if (error instanceof TestTargetResultReportError) {
            fail("report", error, knownEventAuthority, knownClaimAuthority);
          }
          throw error;
        }
        try {
          result = createTestTargetResult({
            taskPackage: sources.taskPackage,
            testCard: sources.testCard,
            intent: sources.intent,
            packet: sources.packet,
            claim,
            observation,
            report,
          });
        } catch (error: unknown) {
          if (error instanceof TestTargetResultError) {
            fail(
              error.reason === "report" ? "report" : "state",
              error,
              knownEventAuthority,
              knownClaimAuthority,
            );
          }
          throw error;
        }
      } else if (
        request.report.workType === "implementation" &&
        sources.workType === "implementation"
      ) {
        let report: Readonly<ImplementationTargetResultReport>;
        try {
          report = createImplementationTargetResultReport(
            request.report.content,
            {
              ...(options.clock === undefined ? {} : { clock: options.clock }),
            },
          );
        } catch (error: unknown) {
          if (error instanceof ImplementationTargetResultReportError)
            fail("report", error, knownEventAuthority, knownClaimAuthority);
          throw error;
        }
        try {
          result = createImplementationTargetResult({
            taskPackage: sources.taskPackage,
            intent: sources.intent,
            claim,
            observation,
            report,
          });
        } catch (error: unknown) {
          if (error instanceof ImplementationTargetResultError) {
            fail(
              error.reason === "report" ? "report" : "state",
              error,
              knownEventAuthority,
              knownClaimAuthority,
            );
          }
          throw error;
        }
      } else {
        fail("state", undefined, knownEventAuthority, knownClaimAuthority);
      }

      const target = context.loaded.aggregate.state.targetTasks.find(
        (entry) => entry.targetTaskId === claim.target.targetTaskId,
      );
      if (existingEvent === null) {
        const targetMatches =
          sources.workType === "test"
            ? target?.workType === "test" &&
              (target.phase === "test-host-effect-accepted" ||
                target.phase === "test-host-effect-indeterminate") &&
              target.currentDelivery.testAttemptId ===
                sources.intent.attempt.testAttemptId &&
              target.currentDelivery.workClaim.testDispatchPacketDigest ===
                sources.packet.packetDigest &&
              target.currentDelivery.hostEffect.observationDigest ===
                observation.observationDigest
            : target !== undefined &&
              target.workType !== "test" &&
              (target.phase === "host-effect-accepted" ||
                target.phase === "host-effect-indeterminate") &&
              target.currentDelivery.hostEffect.observationDigest ===
                observation.observationDigest;
        if (!targetMatches) {
          fail("state", undefined, knownEventAuthority, knownClaimAuthority);
        }
      }

      const inspected = await inspectWindowWorkClaim(
        this.#workspaceRoot,
        claim.route.windowId,
        options.signal === undefined ? {} : { signal: options.signal },
      );
      const currentClaim =
        inspected.status === "claimed" &&
        inspected.claim !== undefined &&
        sameClaim(inspected.claim, claim);
      if (
        (inspected.status === "claimed" && !currentClaim) ||
        (existingEvent === null && inspected.status === "absent")
      ) {
        fail("recovery-required", undefined, knownEventAuthority, "unknown");
      }
      knownClaimAuthority =
        inspected.status === "absent" ? "released" : "current";

      const executed = await executeResultEvent(
        repository,
        context.loaded.aggregate,
        result,
        knownClaimAuthority,
        options.signal,
      );
      knownEventAuthority = "current";
      if (inspected.status !== "absent") {
        try {
          await settleAuthorizedWindowWorkClaimRelease(
            this.#workspaceRoot,
            claim,
          );
        } catch (error: unknown) {
          if (error instanceof WindowWorkClaimStoreError) {
            fail("claim", error, "current", "unknown");
          }
          throw error;
        }
        knownClaimAuthority = "released";
      }
      returned = Object.freeze({
        status:
          executed.result.disposition === "committed"
            ? ("recorded" as const)
            : ("already-recorded" as const),
        disposition: executed.result.disposition,
        claimAuthority: "released" as const,
        eventAuthority: "current" as const,
        claim,
        observation,
        result,
        commandDigest: executed.commandDigest,
        commandResult: executed.result,
        commitDigest: computeDemandEventStreamCommitDigest(
          executed.result.commit,
        ),
      });
    } catch (error: unknown) {
      if (error instanceof TargetResultImportServiceError) {
        failure = error;
      } else if (error instanceof DemandEventSourcingRepositoryError) {
        failure = new TargetResultImportServiceError(
          error.reason === "aborted" ? "aborted" : "event",
          error.code,
          error.reason,
          knownEventAuthority,
          knownClaimAuthority,
        );
      } else if (error instanceof WindowWorkClaimStoreError) {
        failure = new TargetResultImportServiceError(
          error.reason === "aborted" ? "aborted" : "claim",
          error.code,
          error.reason,
          knownEventAuthority,
          error.claimAuthority === "current"
            ? "current"
            : knownClaimAuthority === "released"
              ? "released"
              : "unknown",
        );
      } else {
        failure = error;
      }
    }

    try {
      await closeDemandOperationAuthorityContext(context);
    } catch (error: unknown) {
      if (failure === undefined && returned === undefined) {
        if (error instanceof DemandOperationAuthorityContextError) {
          mapContextError(error);
        }
        throw error;
      }
    }
    if (failure !== undefined) throw failure;
    if (returned === undefined) fail("operation-failure");
    return returned;
  }
}
