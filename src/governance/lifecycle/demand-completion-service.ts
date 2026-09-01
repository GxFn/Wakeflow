import { types } from "node:util";

import {
  createWakeflowDurableId,
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import { canonicalizeJson } from "../../foundation/data/canonical-json.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  createUuidV4,
  UuidV4Error,
  type UuidV4Factory,
} from "../../foundation/identity/uuid-v4.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import type { UtcWallClock } from "../../foundation/time/wall-clock.js";
import {
  assertDemandOperationConfigCurrent,
  closeDemandOperationAuthorityContext,
  closeDemandOperationRoot,
  openDemandOperationAuthorityContext,
  openDemandOperationRoot,
  DemandOperationAuthorityContextError,
  type DemandOperationAuthorityContext,
} from "../demand/demand-operation-authority-context.js";
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
  computeDemandEventStreamCommitDigest,
  prepareDemandEventStreamCommit,
  renderDemandEventStreamCommit,
  DemandEventStreamCommitError,
} from "../demand/event-sourcing/demand-event-stream-commit.js";
import { DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMIT_BYTES } from "../demand/event-sourcing/demand-file-event-store-contract.js";
import {
  createDemandCompletion,
  DemandCompletionError,
  type DemandCompletion,
} from "./demand-completion.js";
import {
  computeDemandCompletionPlanDigest,
  createDemandCompletionPlan,
  parseDemandCompletionPlan,
  DemandCompletionPlanError,
  type DemandCompletionPlan,
} from "./demand-completion-plan.js";
import {
  loadDemandCompletionSources,
  DemandCompletionAuthorityError,
} from "./demand-completion-authority.js";

/**
 * Wakeflow Governance / Lifecycle：Demand Completion preview/apply编排。
 *
 * Preview零写读取Route、TODO、WorkClaim、Config和Demand Authority。Apply对未提交计划重读全部
 * 来源并追加唯一`lifecycle.demand-completed` Event；已提交重试只使用plan内冻结Authority重建
 * 原command，不依赖后来TODO归档、Config或Ledger状态。
 */

export interface DemandCompletionPreviewResult {
  readonly plan: Readonly<DemandCompletionPlan>;
  readonly planDigest: Sha256Digest;
}

export interface DemandCompletionApplyResult {
  readonly status: "completed" | "already-completed";
  readonly disposition: "committed" | "idempotent";
  readonly eventAuthority: "current";
  readonly plan: Readonly<DemandCompletionPlan>;
  readonly planDigest: Sha256Digest;
  readonly commandDigest: Sha256Digest;
  readonly commandResult: Readonly<DemandEventSourcingCommandResult>;
  readonly commitDigest: Sha256Digest;
}

export interface DemandCompletionPreviewRequest {
  readonly demandId: WakeflowDurableId<"demand">;
}

export interface DemandCompletionPreviewOptions {
  readonly clock?: UtcWallClock;
  readonly uuidFactory?: UuidV4Factory;
  readonly signal?: AbortSignal;
}

export interface DemandCompletionApplyOptions {
  readonly signal?: AbortSignal;
}

export type DemandCompletionEventAuthority =
  "unchanged" | "current" | "unknown";

export type DemandCompletionServiceErrorReason =
  | "input"
  | "identity"
  | "root"
  | "config"
  | "demand-authority"
  | "route"
  | "todo"
  | "claim"
  | "plan"
  | "completion"
  | "transition"
  | "event"
  | "capacity"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Demand Completion input is invalid.",
  identity: "Demand Completion identity allocation failed.",
  root: "Demand Completion root could not be held safely.",
  config: "Demand Completion Config authority is invalid or stale.",
  "demand-authority": "Demand Completion Demand authority is invalid.",
  route: "Demand Completion post-acceptance route is not admitted.",
  todo: "Demand Completion TODO authority is invalid or stale.",
  claim: "Demand Completion cannot retain a WorkClaim.",
  plan: "Demand Completion plan is invalid or stale.",
  completion: "Demand Completion record is invalid.",
  transition: "Demand Completion transition is not admitted.",
  event: "Demand Completion Event append failed.",
  capacity: "Demand Completion Event Commit exceeds its capacity.",
  aborted: "Demand Completion was aborted.",
  "operation-failure": "Demand Completion operation failed.",
} as const satisfies Readonly<
  Record<DemandCompletionServiceErrorReason, string>
>;

/** Completion失败时保留稳定分类和Event是否可能已经提交。 */
export class DemandCompletionServiceError extends Error {
  override readonly name = "DemandCompletionServiceError";
  readonly code = "wakeflow-demand-completion-service" as const;
  readonly reason: DemandCompletionServiceErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly eventAuthority: DemandCompletionEventAuthority;

  constructor(
    reason: DemandCompletionServiceErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    eventAuthority: DemandCompletionEventAuthority = "unchanged",
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
  reason: DemandCompletionServiceErrorReason,
  cause?: unknown,
  eventAuthority: DemandCompletionEventAuthority = "unchanged",
): never {
  throw new DemandCompletionServiceError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    eventAuthority,
  );
}

function exactRecord(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error);
    throw error;
  }
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    Object.keys(record).some((key) => !allowed.includes(key))
  ) {
    fail("input");
  }
  return record;
}

function signal(value: unknown): AbortSignal | undefined {
  if (
    value !== undefined &&
    (typeof value !== "object" ||
      value === null ||
      types.isProxy(value) ||
      !(value instanceof AbortSignal))
  ) {
    fail("input");
  }
  if ((value as AbortSignal | undefined)?.aborted === true) fail("aborted");
  return value as AbortSignal | undefined;
}

function previewInput(
  requestValue: unknown,
  optionsValue: unknown,
): Readonly<{
  readonly request: Readonly<DemandCompletionPreviewRequest>;
  readonly options: Readonly<{
    readonly clock: UtcWallClock | undefined;
    readonly uuidFactory: UuidV4Factory | undefined;
    readonly signal: AbortSignal | undefined;
  }>;
}> {
  const request = exactRecord(
    requestValue,
    ["demandId"],
    ["demandId"],
    "$request",
  );
  const options = exactRecord(
    optionsValue === undefined ? {} : optionsValue,
    ["clock", "signal", "uuidFactory"],
    [],
    "$options",
  );
  if (
    options.clock !== undefined &&
    (typeof options.clock !== "function" || types.isProxy(options.clock))
  ) {
    fail("input");
  }
  if (
    options.uuidFactory !== undefined &&
    (typeof options.uuidFactory !== "function" ||
      types.isProxy(options.uuidFactory))
  ) {
    fail("input");
  }
  let demandId: WakeflowDurableId<"demand">;
  try {
    demandId = parseWakeflowDurableIdOfKind(
      request.demandId,
      "demand",
      "$/demandId",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("input", error);
    throw error;
  }
  return Object.freeze({
    request: Object.freeze({ demandId }),
    options: Object.freeze({
      clock: options.clock as UtcWallClock | undefined,
      uuidFactory: options.uuidFactory as UuidV4Factory | undefined,
      signal: signal(options.signal),
    }),
  });
}

function applyOptions(value: unknown): Readonly<DemandCompletionApplyOptions> {
  const record = exactRecord(
    value === undefined ? {} : value,
    ["signal"],
    [],
    "$options",
  );
  const parsed = signal(record.signal);
  return Object.freeze(parsed === undefined ? {} : { signal: parsed });
}

function allocateIds(factory: UuidV4Factory | undefined): Readonly<{
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly commitId: WakeflowDurableId<"demand-event-commit">;
}> {
  try {
    return Object.freeze({
      eventId: createWakeflowDurableId("demand-event", createUuidV4(factory)),
      commitId: createWakeflowDurableId(
        "demand-event-commit",
        createUuidV4(factory),
      ),
    });
  } catch (error: unknown) {
    if (
      error instanceof UuidV4Error ||
      error instanceof WakeflowDurableIdError
    ) {
      fail("identity", error);
    }
    throw error;
  }
}

function mapContextError(error: DemandOperationAuthorityContextError): never {
  if (error.reason === "root") fail("root", error);
  if (error.reason === "config" || error.reason === "stale-config") {
    fail("config", error);
  }
  if (error.reason === "demand-authority") fail("demand-authority", error);
  fail("aborted", error);
}

function mapAuthorityError(error: DemandCompletionAuthorityError): never {
  fail(error.reason, error);
}

function command(plan: Readonly<DemandCompletionPlan>) {
  return parseDemandEventSourcingCommand({
    commandType: "lifecycle.complete-demand",
    commandVersion: 1,
    eventId: plan.eventId,
    authority: plan.authority,
    completion: plan.completion,
  });
}

function preflight(
  context: Readonly<DemandOperationAuthorityContext>,
  plan: Readonly<DemandCompletionPlan>,
): void {
  try {
    const parsed = command(plan);
    const events = decideDemandEventSourcingCommand(
      context.loaded.aggregate.state,
      parsed,
    );
    const prepared = prepareDemandEventStreamCommit(context.loaded.aggregate, {
      commitId: plan.commitId,
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
    if (error instanceof DemandCompletionServiceError) throw error;
    if (
      error instanceof DemandEventSourcingDecisionError ||
      error instanceof DemandEventStreamCommitError
    ) {
      fail("transition", error);
    }
    throw error;
  }
}

async function executePlan(
  repository: DemandEventSourcingRepository,
  plan: Readonly<DemandCompletionPlan>,
  signalValue: AbortSignal | undefined,
): Promise<
  Readonly<{
    readonly commandDigest: Sha256Digest;
    readonly result: Readonly<DemandEventSourcingCommandResult>;
  }>
> {
  const parsed = command(plan);
  const commandDigest = computeDemandEventSourcingCommandDigest(parsed);
  try {
    const result = await executeDemandEventSourcingCommand(repository, parsed, {
      commitId: plan.commitId,
      expectedStreamRevision: plan.expectedStreamRevision,
      ...(signalValue === undefined ? {} : { signal: signalValue }),
    });
    return Object.freeze({ commandDigest, result });
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingCommandHandlerError) {
      if (error.reason === "aborted") fail("aborted", error, "unknown");
      if (error.reason === "concurrency-conflict") {
        fail("plan", error, "unchanged");
      }
      if (error.reason === "idempotency-conflict") {
        fail("plan", error, "unchanged");
      }
      if (error.reason === "decision-rejected") {
        fail("transition", error, "unchanged");
      }
      fail("event", error, "unknown");
    }
    throw error;
  }
}

async function closeRoot(
  root: RootedDirectory,
  eventAuthority: DemandCompletionEventAuthority,
): Promise<void> {
  try {
    await closeDemandOperationRoot(root);
  } catch (error: unknown) {
    if (error instanceof DemandOperationAuthorityContextError) {
      fail("root", error, eventAuthority);
    }
    throw error;
  }
}

export class DemandCompletionService {
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

  /** 零写构造并preflight一份精确Completion Event计划。 */
  async preview(
    requestValue: unknown,
    optionsValue: DemandCompletionPreviewOptions = {},
  ): Promise<Readonly<DemandCompletionPreviewResult>> {
    const { request, options } = previewInput(requestValue, optionsValue);
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
    let result: Readonly<DemandCompletionPreviewResult> | undefined;
    let failure: unknown;
    try {
      let sources;
      try {
        sources = await loadDemandCompletionSources(
          this.#workspaceRoot,
          context,
          options.signal,
        );
      } catch (error: unknown) {
        if (error instanceof DemandCompletionAuthorityError) {
          mapAuthorityError(error);
        }
        throw error;
      }
      let completion: Readonly<DemandCompletion>;
      try {
        completion = createDemandCompletion(
          {
            controllerWindowId: sources.controllerWindowId,
            routeSource: sources.routeSource,
            todoSource: sources.todoSource,
          },
          options.clock === undefined ? {} : { clock: options.clock },
        );
      } catch (error: unknown) {
        if (error instanceof DemandCompletionError) {
          fail(error.reason === "time" ? "input" : "completion", error);
        }
        throw error;
      }
      const ids = allocateIds(options.uuidFactory);
      const plan = createDemandCompletionPlan({
        demandId: request.demandId,
        expectedStreamRevision: context.loaded.aggregate.streamRevision,
        commitId: ids.commitId,
        eventId: ids.eventId,
        authority: context.loaded.authority,
        completion,
      });
      preflight(context, plan);
      result = Object.freeze({
        plan,
        planDigest: computeDemandCompletionPlanDigest(plan),
      });
    } catch (error: unknown) {
      failure = error;
    }
    try {
      await closeDemandOperationAuthorityContext(context);
    } catch (error: unknown) {
      if (failure === undefined) {
        if (error instanceof DemandOperationAuthorityContextError) {
          mapContextError(error);
        }
        failure = error;
      }
    }
    if (failure !== undefined) throw failure;
    if (result === undefined) fail("operation-failure");
    return result;
  }

  /** 应用精确preview计划；同Commit重试不重新要求外部Authority仍处于preflight状态。 */
  async apply(
    planValue: unknown,
    planDigestValue: unknown,
    optionsValue: DemandCompletionApplyOptions = {},
  ): Promise<Readonly<DemandCompletionApplyResult>> {
    const options = applyOptions(optionsValue);
    let plan: Readonly<DemandCompletionPlan>;
    let planDigest: Sha256Digest;
    try {
      plan = parseDemandCompletionPlan(planValue);
      planDigest = parseSha256Digest(planDigestValue, "$planDigest");
    } catch (error: unknown) {
      if (
        error instanceof DemandCompletionPlanError ||
        error instanceof Sha256Error
      ) {
        fail("plan", error);
      }
      throw error;
    }
    if (computeDemandCompletionPlanDigest(plan) !== planDigest) fail("plan");

    let demandRoot: RootedDirectory | undefined;
    let eventAuthority: DemandCompletionEventAuthority = "unchanged";
    let result: Readonly<DemandCompletionApplyResult> | undefined;
    let failure: unknown;
    try {
      demandRoot = await openDemandOperationRoot(
        this.#workspaceRoot,
        plan.demandId,
      );
      let repository = new DemandEventSourcingRepository(demandRoot);
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

      if (existing === null) {
        await closeRoot(demandRoot, eventAuthority);
        demandRoot = undefined;
        let context;
        try {
          context = await openDemandOperationAuthorityContext(
            this.#workspaceRoot,
            plan.demandId,
            options.signal,
          );
        } catch (error: unknown) {
          if (error instanceof DemandOperationAuthorityContextError) {
            mapContextError(error);
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
          if (racedCommit === null) {
            let sources;
            try {
              sources = await loadDemandCompletionSources(
                this.#workspaceRoot,
                context,
                options.signal,
              );
            } catch (error: unknown) {
              if (error instanceof DemandCompletionAuthorityError) {
                mapAuthorityError(error);
              }
              throw error;
            }
            let currentCompletion: Readonly<DemandCompletion>;
            try {
              currentCompletion = createDemandCompletion(
                {
                  controllerWindowId: sources.controllerWindowId,
                  routeSource: sources.routeSource,
                  todoSource: sources.todoSource,
                },
                { clock: () => plan.completion.completedAt },
              );
            } catch (error: unknown) {
              if (error instanceof DemandCompletionError) {
                fail("plan", error);
              }
              throw error;
            }
            if (
              context.loaded.aggregate.streamRevision !==
                plan.expectedStreamRevision ||
              canonicalizeJson(currentCompletion, "$currentCompletion") !==
                canonicalizeJson(plan.completion, "$planCompletion") ||
              canonicalizeJson(
                context.loaded.authority,
                "$currentAuthority",
              ) !== canonicalizeJson(plan.authority, "$planAuthority")
            ) {
              fail("plan");
            }
            preflight(context, plan);
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
          const executed = await executePlan(repository, plan, options.signal);
          eventAuthority = "current";
          result = Object.freeze({
            status:
              executed.result.disposition === "committed"
                ? ("completed" as const)
                : ("already-completed" as const),
            disposition: executed.result.disposition,
            eventAuthority: "current" as const,
            plan,
            planDigest,
            commandDigest: executed.commandDigest,
            commandResult: executed.result,
            commitDigest: computeDemandEventStreamCommitDigest(
              executed.result.commit,
            ),
          });
        } catch (error: unknown) {
          contextFailure = error;
        }
        try {
          await closeDemandOperationRoot(context.ledgerRoot);
        } catch (error: unknown) {
          if (contextFailure === undefined) {
            contextFailure =
              error instanceof DemandOperationAuthorityContextError
                ? new DemandCompletionServiceError(
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
        const executed = await executePlan(repository, plan, options.signal);
        eventAuthority = "current";
        result = Object.freeze({
          status: "already-completed" as const,
          disposition: executed.result.disposition,
          eventAuthority: "current" as const,
          plan,
          planDigest,
          commandDigest: executed.commandDigest,
          commandResult: executed.result,
          commitDigest: computeDemandEventStreamCommitDigest(
            executed.result.commit,
          ),
        });
      }
    } catch (error: unknown) {
      if (error instanceof DemandCompletionServiceError) {
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
    if (result === undefined)
      fail("operation-failure", undefined, eventAuthority);
    return result;
  }
}
