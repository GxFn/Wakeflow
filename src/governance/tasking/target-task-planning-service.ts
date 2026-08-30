import { types } from "node:util";

import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
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
import {
  DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMIT_BYTES,
} from "../demand/event-sourcing/demand-file-event-store-contract.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  createTaskPackage,
  TaskPackageError,
  type TaskPackage,
} from "./task-package.js";
import {
  TaskPackageProjectionStore,
  TaskPackageProjectionStoreError,
  type TaskPackageProjectionMaterializationReceipt,
} from "./task-package-projection-store.js";
import {
  assertTargetTaskPlanningAuthorityAndTopology,
  assertTargetTaskPlanningConfigCurrent,
  closeTargetTaskPlanningAuthorityContext,
  closeTargetTaskPlanningRoot,
  openTargetTaskPlanningAuthorityContext,
  openTargetTaskPlanningDemandRoot,
  resolveTargetTaskPlanningAuthorityReferences,
  TargetTaskPlanningAuthorityError,
} from "./target-task-planning-authority.js";
import {
  allocateTargetTaskPlanningIds,
  assertTargetTaskPlanningNotAborted,
  parseTargetTaskPlanningApplyOptions,
  parseTargetTaskPlanningPreviewOptions,
  parseTargetTaskPlanningPreviewRequest,
  TargetTaskPlanningInputError,
  type TargetTaskPlanningApplyOptions,
  type TargetTaskPlanningPreviewOptions,
} from "./target-task-planning-input.js";
import {
  computeTargetTaskPlanningPlanDigest,
  createTargetTaskPlanningPlan,
  parseTargetTaskPlanningPlan,
  TargetTaskPlanningPlanError,
  type TargetTaskPlanningPlan,
} from "./target-task-planning-plan.js";

/**
 * Wakeflow Governance / Tasking：Target Task Planning preview/apply 唯一编排职责。
 *
 * Preview 只读取权威并生成完整计划；Apply 重新验证计划和当前 authority，再调用标准
 * Command Handler。Event commit 是唯一业务提交点，随后只允许投影创建或修复。
 * 同一 Commit 已存在时跳过当前 Config 准入，保证后续重配不会阻断已提交事件恢复。
 */

export interface TargetTaskPlanningPreviewResult {
  readonly plan: Readonly<TargetTaskPlanningPlan>;
  readonly planDigest: Sha256Digest;
}

export interface TargetTaskPlanningApplyResult {
  readonly disposition: "committed" | "idempotent";
  readonly plan: Readonly<TargetTaskPlanningPlan>;
  readonly planDigest: Sha256Digest;
  readonly commandDigest: Sha256Digest;
  readonly commandResult: Readonly<DemandEventSourcingCommandResult>;
  readonly commitDigest: Sha256Digest;
  readonly projection:
    Readonly<TaskPackageProjectionMaterializationReceipt>;
}

export type TargetTaskPlanningServiceEventAuthority =
  | "unchanged"
  | "current"
  | "unknown";

export type TargetTaskPlanningServiceErrorReason =
  | "input"
  | "identity"
  | "root"
  | "config"
  | "demand-authority"
  | "topology"
  | "reference"
  | "task-package"
  | "plan"
  | "transition"
  | "event"
  | "projection"
  | "capacity"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Target Task Planning input is invalid.",
  identity: "Target Task Planning identity allocation failed.",
  root: "Target Task Planning root could not be held safely.",
  config: "Target Task Planning Config authority is invalid.",
  "demand-authority": "Target Task Planning Demand authority is invalid.",
  topology: "Target Task Planning assignment is not in current Config topology.",
  reference: "Target Task Planning selected authority references are invalid.",
  "task-package": "Target Task Planning TaskPackage is invalid.",
  plan: "Target Task Planning plan is invalid or stale.",
  transition: "Target Task Planning transition is not admitted.",
  event: "Target Task Planning event append failed.",
  projection: "Target Task Planning projection could not be materialized.",
  capacity: "Target Task Planning event commit exceeds its capacity.",
  aborted: "Target Task Planning was aborted.",
  "operation-failure": "Target Task Planning operation failed.",
} as const satisfies Readonly<Record<
  TargetTaskPlanningServiceErrorReason,
  string
>>;

export class TargetTaskPlanningServiceError extends Error {
  override readonly name = "TargetTaskPlanningServiceError";
  readonly code = "wakeflow-target-task-planning-service" as const;
  readonly reason: TargetTaskPlanningServiceErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly eventAuthority: TargetTaskPlanningServiceEventAuthority;

  constructor(
    reason: TargetTaskPlanningServiceErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    eventAuthority: TargetTaskPlanningServiceEventAuthority = "unchanged",
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
  return descriptor !== undefined
    && Object.hasOwn(descriptor, "value")
    && typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function fail(
  reason: TargetTaskPlanningServiceErrorReason,
  cause?: unknown,
  eventAuthority: TargetTaskPlanningServiceEventAuthority = "unchanged",
): never {
  throw new TargetTaskPlanningServiceError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    eventAuthority,
  );
}

function mapInputError(error: TargetTaskPlanningInputError): never {
  if (error.reason === "identity") fail("identity", error);
  if (error.reason === "aborted") fail("aborted", error);
  fail("input", error);
}

function mapAuthorityError(error: TargetTaskPlanningAuthorityError): never {
  if (error.reason === "aborted") fail("aborted", error);
  fail(error.reason, error);
}

function planningCommand(plan: Readonly<TargetTaskPlanningPlan>) {
  return parseDemandEventSourcingCommand({
    commandType: "tasking.plan-target-task",
    commandVersion: 1,
    eventId: plan.eventId,
    taskPackage: plan.taskPackage,
  });
}

async function classifyEventAuthority(
  repository: DemandEventSourcingRepository,
  plan: Readonly<TargetTaskPlanningPlan>,
  commandDigest: Sha256Digest,
  signal: AbortSignal | undefined,
): Promise<TargetTaskPlanningServiceEventAuthority> {
  try {
    const existing = await repository.findCommitById(
      plan.commitId,
      signal === undefined ? undefined : { signal },
    );
    if (existing === null) return "unchanged";
    return existing.commandDigest === commandDigest
      && existing.expectedStreamRevision === plan.expectedStreamRevision
      ? "current"
      : "unchanged";
  } catch {
    return "unknown";
  }
}

async function executePlanCommand(
  repository: DemandEventSourcingRepository,
  plan: Readonly<TargetTaskPlanningPlan>,
  signal: AbortSignal | undefined,
): Promise<Readonly<{
  readonly commandDigest: Sha256Digest;
  readonly result: Readonly<DemandEventSourcingCommandResult>;
}>> {
  const command = planningCommand(plan);
  const commandDigest = computeDemandEventSourcingCommandDigest(command);
  try {
    const result = await executeDemandEventSourcingCommand(
      repository,
      command,
      {
        commitId: plan.commitId,
        expectedStreamRevision: plan.expectedStreamRevision,
        ...(signal === undefined ? {} : { signal }),
      },
    );
    return Object.freeze({ commandDigest, result });
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingCommandHandlerError) {
      const authority = await classifyEventAuthority(
        repository,
        plan,
        commandDigest,
        signal,
      );
      if (error.reason === "aborted") fail("aborted", error, authority);
      if (error.reason === "concurrency-conflict") fail("plan", error, authority);
      if (error.reason === "decision-rejected") {
        fail("transition", error, authority);
      }
      fail("event", error, authority);
    }
    throw error;
  }
}

async function materializeProjection(
  demandRoot: RootedDirectory,
  plan: Readonly<TargetTaskPlanningPlan>,
  signal: AbortSignal | undefined,
): Promise<Readonly<TaskPackageProjectionMaterializationReceipt>> {
  try {
    return await new TaskPackageProjectionStore(demandRoot).materialize(
      plan.taskPackage.taskPackageId,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof TaskPackageProjectionStoreError) {
      if (error.reason === "aborted") fail("aborted", error, "current");
      fail("projection", error, "current");
    }
    throw error;
  }
}

async function closeRoot(
  root: RootedDirectory,
  eventAuthority: TargetTaskPlanningServiceEventAuthority,
): Promise<void> {
  try {
    await closeTargetTaskPlanningRoot(root);
  } catch (error: unknown) {
    if (error instanceof TargetTaskPlanningAuthorityError) {
      fail("root", error, eventAuthority);
    }
    throw error;
  }
}

export class TargetTaskPlanningService {
  readonly #workspaceRoot: RootedDirectory;

  constructor(workspaceRoot: RootedDirectory) {
    if (
      typeof workspaceRoot !== "object"
      || workspaceRoot === null
      || types.isProxy(workspaceRoot)
      || !(workspaceRoot instanceof RootedDirectory)
    ) {
      fail("input");
    }
    this.#workspaceRoot = workspaceRoot;
  }

  /** 只读生成一份完整、可供用户审阅的 Target Task Planning plan。 */
  async preview(
    requestValue: unknown,
    optionsValue: TargetTaskPlanningPreviewOptions = {},
  ): Promise<Readonly<TargetTaskPlanningPreviewResult>> {
    let request;
    let options;
    try {
      request = parseTargetTaskPlanningPreviewRequest(requestValue);
      options = parseTargetTaskPlanningPreviewOptions(optionsValue);
      assertTargetTaskPlanningNotAborted(options.signal);
    } catch (error: unknown) {
      if (error instanceof TargetTaskPlanningInputError) mapInputError(error);
      throw error;
    }
    let context;
    try {
      context = await openTargetTaskPlanningAuthorityContext(
        this.#workspaceRoot,
        request.demandId,
        options.signal,
      );
    } catch (error: unknown) {
      if (error instanceof TargetTaskPlanningAuthorityError) {
        mapAuthorityError(error);
      }
      throw error;
    }
    let result: Readonly<TargetTaskPlanningPreviewResult> | undefined;
    let failure: unknown;
    try {
      let ids;
      try {
        ids = allocateTargetTaskPlanningIds(options.uuidFactory);
      } catch (error: unknown) {
        if (error instanceof TargetTaskPlanningInputError) mapInputError(error);
        throw error;
      }
      let selectedAuthorityRefs;
      try {
        selectedAuthorityRefs = resolveTargetTaskPlanningAuthorityReferences(
          context,
          request.taskPackage.selectedAuthorityMemberRefs,
        );
      } catch (error: unknown) {
        if (error instanceof TargetTaskPlanningAuthorityError) {
          mapAuthorityError(error);
        }
        throw error;
      }
      let taskPackage: Readonly<TaskPackage>;
      try {
        taskPackage = createTaskPackage({
          programId: context.loaded.identity.programId,
          configDigest: context.config.configDigest,
          demandId: context.loaded.identity.demandId,
          demandAuthorityDigest: context.loaded.authorityDigest,
          taskPackageId: ids.taskPackageId,
          targetTaskId: ids.targetTaskId,
          assignment: request.taskPackage.assignment,
          workType: request.taskPackage.workType,
          objective: request.taskPackage.objective,
          confirmedContext: request.taskPackage.confirmedContext,
          selectedAuthorityRefs,
          boundaries: request.taskPackage.boundaries,
          completionExpectations: request.taskPackage.completionExpectations,
          commitExpectation: request.taskPackage.commitExpectation,
          acceptanceAnchors: request.taskPackage.acceptanceAnchors,
        }, options.clock === undefined ? {} : { clock: options.clock });
      } catch (error: unknown) {
        if (error instanceof TaskPackageError) fail("task-package", error);
        throw error;
      }
      try {
        assertTargetTaskPlanningAuthorityAndTopology(context, taskPackage);
      } catch (error: unknown) {
        if (error instanceof TargetTaskPlanningAuthorityError) {
          mapAuthorityError(error);
        }
        throw error;
      }
      const plan = createTargetTaskPlanningPlan({
        demandId: request.demandId,
        expectedStreamRevision: context.loaded.aggregate.streamRevision,
        commitId: ids.commitId,
        eventId: ids.eventId,
        taskPackage,
      });
      try {
        const command = planningCommand(plan);
        const events = decideDemandEventSourcingCommand(
          context.loaded.aggregate.state,
          command,
        );
        const prepared = prepareDemandEventStreamCommit(
          context.loaded.aggregate,
          {
            commitId: plan.commitId,
            commandDigest: computeDemandEventSourcingCommandDigest(command),
            events,
          },
        );
        if (
          encodeUtf8(renderDemandEventStreamCommit(prepared.commit)).byteLength
            > DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMIT_BYTES
        ) {
          fail("capacity");
        }
      } catch (error: unknown) {
        if (
          error instanceof DemandEventSourcingDecisionError
          || error instanceof DemandEventStreamCommitError
        ) {
          fail("transition", error);
        }
        throw error;
      }
      result = Object.freeze({
        plan,
        planDigest: computeTargetTaskPlanningPlanDigest(plan),
      });
    } catch (error: unknown) {
      failure = error;
    }
    try {
      await closeTargetTaskPlanningAuthorityContext(context);
    } catch (error: unknown) {
      if (failure === undefined) {
        if (error instanceof TargetTaskPlanningAuthorityError) {
          mapAuthorityError(error);
        }
        throw error;
      }
    }
    if (failure !== undefined) throw failure;
    if (result === undefined) fail("operation-failure");
    return result;
  }

  /** 重验并应用一份 preview 计划；重复同一计划只收敛事件和投影。 */
  async apply(
    planValue: unknown,
    planDigestValue: unknown,
    optionsValue: TargetTaskPlanningApplyOptions = {},
  ): Promise<Readonly<TargetTaskPlanningApplyResult>> {
    let options;
    try {
      options = parseTargetTaskPlanningApplyOptions(optionsValue);
      assertTargetTaskPlanningNotAborted(options.signal);
    } catch (error: unknown) {
      if (error instanceof TargetTaskPlanningInputError) mapInputError(error);
      throw error;
    }
    let plan: Readonly<TargetTaskPlanningPlan>;
    let planDigest: Sha256Digest;
    try {
      plan = parseTargetTaskPlanningPlan(planValue);
      planDigest = parseSha256Digest(planDigestValue, "$planDigest");
    } catch (error: unknown) {
      if (
        error instanceof TargetTaskPlanningPlanError
        || error instanceof Sha256Error
      ) {
        fail("plan", error);
      }
      throw error;
    }
    if (computeTargetTaskPlanningPlanDigest(plan) !== planDigest) fail("plan");

    let demandRoot: RootedDirectory | undefined;
    try {
      demandRoot = await openTargetTaskPlanningDemandRoot(
        this.#workspaceRoot,
        plan.demandId,
      );
    } catch (error: unknown) {
      if (error instanceof TargetTaskPlanningAuthorityError) {
        mapAuthorityError(error);
      }
      throw error;
    }
    let eventAuthority: TargetTaskPlanningServiceEventAuthority = "unchanged";
    let result: Readonly<TargetTaskPlanningApplyResult> | undefined;
    let failure: unknown;
    try {
      let repository = new DemandEventSourcingRepository(demandRoot);
      const command = planningCommand(plan);
      const commandDigest = computeDemandEventSourcingCommandDigest(command);
      let existing;
      try {
        existing = await repository.findCommitById(
          plan.commitId,
          options.signal === undefined ? undefined : { signal: options.signal },
        );
      } catch (error: unknown) {
        if (error instanceof DemandEventSourcingRepositoryError) {
          if (error.reason === "aborted") fail("aborted", error);
          fail("event", error, "unknown");
        }
        throw error;
      }
      if (existing !== null && (
        existing.commandDigest !== commandDigest
        || existing.expectedStreamRevision !== plan.expectedStreamRevision
      )) {
        fail("plan");
      }

      if (existing === null) {
        await closeRoot(demandRoot, eventAuthority);
        demandRoot = undefined;
        let context;
        try {
          context = await openTargetTaskPlanningAuthorityContext(
            this.#workspaceRoot,
            plan.demandId,
            options.signal,
          );
        } catch (error: unknown) {
          if (error instanceof TargetTaskPlanningAuthorityError) {
            mapAuthorityError(error);
          }
          throw error;
        }
        demandRoot = context.demandRoot;
        let contextFailure: unknown;
        try {
          repository = new DemandEventSourcingRepository(context.demandRoot);
          let racedCommit;
          try {
            racedCommit = await repository.findCommitById(
              plan.commitId,
              options.signal === undefined
                ? undefined
                : { signal: options.signal },
            );
          } catch (error: unknown) {
            if (error instanceof DemandEventSourcingRepositoryError) {
              if (error.reason === "aborted") fail("aborted", error);
              fail("event", error, "unknown");
            }
            throw error;
          }
          if (racedCommit !== null && (
            racedCommit.commandDigest !== commandDigest
            || racedCommit.expectedStreamRevision
              !== plan.expectedStreamRevision
          )) {
            fail("plan");
          }
          if (racedCommit === null) {
            try {
              assertTargetTaskPlanningAuthorityAndTopology(
                context,
                plan.taskPackage,
              );
              if (
                context.loaded.aggregate.streamRevision
                  === plan.expectedStreamRevision
              ) {
                decideDemandEventSourcingCommand(
                  context.loaded.aggregate.state,
                  command,
                );
              }
              await assertTargetTaskPlanningConfigCurrent(
                this.#workspaceRoot,
                context.config,
                options.signal,
              );
            } catch (error: unknown) {
              if (error instanceof TargetTaskPlanningAuthorityError) {
                mapAuthorityError(error);
              }
              if (error instanceof DemandEventSourcingDecisionError) {
                fail("transition", error);
              }
              throw error;
            }
          }
          const executed = await executePlanCommand(
            repository,
            plan,
            options.signal,
          );
          eventAuthority = "current";
          const projection = await materializeProjection(
            context.demandRoot,
            plan,
            options.signal,
          );
          result = Object.freeze({
            disposition: executed.result.disposition,
            plan,
            planDigest,
            commandDigest: executed.commandDigest,
            commandResult: executed.result,
            commitDigest: computeDemandEventStreamCommitDigest(
              executed.result.commit,
            ),
            projection,
          });
        } catch (error: unknown) {
          contextFailure = error;
        }
        try {
          await closeTargetTaskPlanningRoot(context.ledgerRoot);
        } catch (error: unknown) {
          if (contextFailure === undefined) {
            contextFailure = error instanceof TargetTaskPlanningAuthorityError
              ? new TargetTaskPlanningServiceError(
                  "root",
                  error.code,
                  error.reason,
                  eventAuthority,
                )
              : error;
          }
        }
        if (contextFailure !== undefined) throw contextFailure;
      } else {
        eventAuthority = "current";
        const executed = await executePlanCommand(
          repository,
          plan,
          options.signal,
        );
        const projection = await materializeProjection(
          demandRoot,
          plan,
          options.signal,
        );
        result = Object.freeze({
          disposition: executed.result.disposition,
          plan,
          planDigest,
          commandDigest: executed.commandDigest,
          commandResult: executed.result,
          commitDigest: computeDemandEventStreamCommitDigest(
            executed.result.commit,
          ),
          projection,
        });
      }
    } catch (error: unknown) {
      if (error instanceof TargetTaskPlanningServiceError) {
        eventAuthority = error.eventAuthority;
      }
      failure = error;
    }
    if (demandRoot !== undefined) {
      try {
        await closeRoot(demandRoot, eventAuthority);
      } catch (error: unknown) {
        if (failure === undefined) failure = error;
      }
    }
    if (failure !== undefined) throw failure;
    if (result === undefined) fail("operation-failure", undefined, eventAuthority);
    return result;
  }
}

export type {
  TargetTaskPlanningApplyOptions,
  TargetTaskPlanningAuthoredTaskPackage,
  TargetTaskPlanningPreviewOptions,
  TargetTaskPlanningPreviewRequest,
} from "./target-task-planning-input.js";
