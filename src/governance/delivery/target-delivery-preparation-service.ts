import { types } from "node:util";

import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import { canonicalizeJson } from "../../foundation/data/canonical-json.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
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
  closeDemandOperationRoot,
  openDemandOperationAuthorityContext,
  openDemandOperationRoot,
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
} from "../demand/event-sourcing/demand-event-sourcing-repository.js";
import { DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMIT_BYTES } from "../demand/event-sourcing/demand-file-event-store-contract.js";
import type { TaskPackage } from "../tasking/task-package.js";
import {
  assertTargetDeliveryIntentMatchesTaskPackage,
  createTargetDeliveryIntent,
  TargetDeliveryIntentError,
  type TargetDeliveryIntent,
} from "./target-delivery-intent.js";
import {
  computeTargetDeliveryPreparationPlanDigest,
  createTargetDeliveryPreparationPlan,
  parseTargetDeliveryPreparationPlan,
  TargetDeliveryPreparationPlanError,
  type TargetDeliveryPreparationPlan,
} from "./target-delivery-preparation-plan.js";
import {
  loadTargetDeliveryPreparationSources,
  loadTargetDeliveryPreparationProductDefectRemediationSourceFromEventHistory,
  loadTargetDeliveryPreparationReworkSourceFromEventHistory,
  loadTargetDeliveryPreparationTaskPackageFromEvent,
  TargetDeliveryPreparationAuthorityError,
  type TargetDeliveryPreparationReworkSource,
  type TargetDeliveryPreparationProductDefectRemediationSource,
} from "./target-delivery-preparation-authority.js";
import {
  allocateTargetDeliveryPreparationIds,
  assertTargetDeliveryPreparationNotAborted,
  parseTargetDeliveryPreparationApplyOptions,
  parseTargetDeliveryPreparationPreviewOptions,
  parseTargetDeliveryPreparationPreviewRequest,
  TargetDeliveryPreparationInputError,
  type TargetDeliveryPreparationApplyOptions,
  type TargetDeliveryPreparationPreviewOptions,
} from "./target-delivery-preparation-input.js";

/**
 * Wakeflow Governance / Delivery：Target Delivery Preparation preview/apply编排。
 *
 * Preview全程只读，闭合当前Tasking、Config、Demand/Ledger与私有Binding后生成Intent和
 * Event/Commit计划。Apply先识别同Commit重放；未提交时重读全部权威、稳定观察Binding、
 * 复验Config后只追加当前版本的`delivery.target-delivery-prepared`事件。本服务不取得WindowWorkClaim、
 * 不读取 raw handle、不生成最终目标投递宿主动作，也不调用任何宿主能力。
 */

export interface TargetDeliveryPreparationPreviewResult {
  readonly plan: Readonly<TargetDeliveryPreparationPlan>;
  readonly planDigest: Sha256Digest;
}

export interface TargetDeliveryPreparationApplyResult {
  readonly disposition: "committed" | "idempotent";
  readonly plan: Readonly<TargetDeliveryPreparationPlan>;
  readonly planDigest: Sha256Digest;
  readonly commandDigest: Sha256Digest;
  readonly commandResult: Readonly<DemandEventSourcingCommandResult>;
  readonly commitDigest: Sha256Digest;
}

export type TargetDeliveryPreparationEventAuthority =
  "unchanged" | "current" | "unknown";

export type TargetDeliveryPreparationServiceErrorReason =
  | "input"
  | "identity"
  | "root"
  | "config"
  | "demand-authority"
  | "task-package"
  | "rework"
  | "product-defect-remediation"
  | "topology"
  | "binding"
  | "plan"
  | "transition"
  | "event"
  | "capacity"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Target Delivery Preparation input is invalid.",
  identity: "Target Delivery Preparation identity allocation failed.",
  root: "Target Delivery Preparation root could not be held safely.",
  config: "Target Delivery Preparation Config authority is invalid or stale.",
  "demand-authority":
    "Target Delivery Preparation Demand authority is invalid.",
  "task-package":
    "Target Delivery Preparation TaskPackage authority is invalid.",
  rework: "Target Delivery Preparation rework history is invalid or stale.",
  "product-defect-remediation":
    "Target Delivery Preparation product-defect remediation history is invalid or stale.",
  topology:
    "Target Delivery Preparation assignment is not in current Config topology.",
  binding: "Target Delivery Preparation current Binding authority is invalid.",
  plan: "Target Delivery Preparation plan is invalid or stale.",
  transition: "Target Delivery Preparation transition is not admitted.",
  event: "Target Delivery Preparation event append failed.",
  capacity: "Target Delivery Preparation event commit exceeds its capacity.",
  aborted: "Target Delivery Preparation was aborted.",
  "operation-failure": "Target Delivery Preparation operation failed.",
} as const satisfies Readonly<
  Record<TargetDeliveryPreparationServiceErrorReason, string>
>;

/** Preparation失败时返回稳定分类，并声明事件authority是否可能已提交。 */
export class TargetDeliveryPreparationServiceError extends Error {
  override readonly name = "TargetDeliveryPreparationServiceError";
  readonly code = "wakeflow-target-delivery-preparation-service" as const;
  readonly reason: TargetDeliveryPreparationServiceErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly eventAuthority: TargetDeliveryPreparationEventAuthority;

  constructor(
    reason: TargetDeliveryPreparationServiceErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    eventAuthority: TargetDeliveryPreparationEventAuthority = "unchanged",
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
  reason: TargetDeliveryPreparationServiceErrorReason,
  cause?: unknown,
  eventAuthority: TargetDeliveryPreparationEventAuthority = "unchanged",
): never {
  throw new TargetDeliveryPreparationServiceError(
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

function mapInputError(error: TargetDeliveryPreparationInputError): never {
  fail(error.reason, error);
}

function mapAuthorityError(
  error: TargetDeliveryPreparationAuthorityError,
): never {
  fail(error.reason, error);
}

function preparationCommand(
  plan: Readonly<TargetDeliveryPreparationPlan>,
  taskPackage: Readonly<TaskPackage>,
  reworkSource: Readonly<TargetDeliveryPreparationReworkSource> | undefined,
  productDefectRemediationSource:
    | Readonly<TargetDeliveryPreparationProductDefectRemediationSource>
    | undefined,
) {
  return parseDemandEventSourcingCommand({
    commandType: "delivery.prepare-target-delivery",
    commandVersion: 1,
    eventId: plan.eventId,
    intent: plan.intent,
    taskPackage,
    ...(reworkSource === undefined ? {} : { reworkSource }),
    ...(productDefectRemediationSource === undefined
      ? {}
      : { productDefectRemediationSource }),
  });
}

function preflightCommit(
  context: Readonly<DemandOperationAuthorityContext>,
  plan: Readonly<TargetDeliveryPreparationPlan>,
  taskPackage: Readonly<TaskPackage>,
  reworkSource: Readonly<TargetDeliveryPreparationReworkSource> | undefined,
  productDefectRemediationSource:
    | Readonly<TargetDeliveryPreparationProductDefectRemediationSource>
    | undefined,
): void {
  try {
    const command = preparationCommand(
      plan,
      taskPackage,
      reworkSource,
      productDefectRemediationSource,
    );
    const events = decideDemandEventSourcingCommand(
      context.loaded.aggregate.state,
      command,
    );
    const prepared = prepareDemandEventStreamCommit(context.loaded.aggregate, {
      commitId: plan.commitId,
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
    if (error instanceof TargetDeliveryPreparationServiceError) throw error;
    if (
      error instanceof DemandEventSourcingDecisionError ||
      error instanceof DemandEventStreamCommitError
    ) {
      fail("transition", error);
    }
    throw error;
  }
}

async function classifyEventAuthority(
  repository: DemandEventSourcingRepository,
  plan: Readonly<TargetDeliveryPreparationPlan>,
  commandDigest: Sha256Digest,
  signalValue: AbortSignal | undefined,
): Promise<TargetDeliveryPreparationEventAuthority> {
  try {
    const existing = await repository.findCommitById(
      plan.commitId,
      signalValue === undefined ? undefined : { signal: signalValue },
    );
    if (existing === null) return "unchanged";
    return existing.commandDigest === commandDigest &&
      existing.expectedStreamRevision === plan.expectedStreamRevision
      ? "current"
      : "unchanged";
  } catch {
    return "unknown";
  }
}

async function assertTargetDeliveryIdAvailable(
  repository: DemandEventSourcingRepository,
  targetDeliveryId: TargetDeliveryIntent["targetDeliveryId"],
  signal: AbortSignal | undefined,
  collisionReason: "identity" | "plan",
): Promise<void> {
  try {
    const existing = await repository.findTargetDeliveryPreparedEvent(
      targetDeliveryId,
      signal === undefined ? undefined : { signal },
    );
    if (existing !== null) fail(collisionReason);
  } catch (error: unknown) {
    if (error instanceof TargetDeliveryPreparationServiceError) throw error;
    if (error instanceof DemandEventSourcingRepositoryError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("event", error);
    }
    throw error;
  }
}

async function executePlan(
  repository: DemandEventSourcingRepository,
  plan: Readonly<TargetDeliveryPreparationPlan>,
  taskPackage: Readonly<TaskPackage>,
  reworkSource: Readonly<TargetDeliveryPreparationReworkSource> | undefined,
  productDefectRemediationSource:
    | Readonly<TargetDeliveryPreparationProductDefectRemediationSource>
    | undefined,
  signalValue: AbortSignal | undefined,
): Promise<
  Readonly<{
    readonly commandDigest: Sha256Digest;
    readonly result: Readonly<DemandEventSourcingCommandResult>;
  }>
> {
  const command = preparationCommand(
    plan,
    taskPackage,
    reworkSource,
    productDefectRemediationSource,
  );
  const commandDigest = computeDemandEventSourcingCommandDigest(command);
  try {
    const result = await executeDemandEventSourcingCommand(
      repository,
      command,
      {
        commitId: plan.commitId,
        expectedStreamRevision: plan.expectedStreamRevision,
        ...(signalValue === undefined ? {} : { signal: signalValue }),
      },
    );
    return Object.freeze({ commandDigest, result });
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingCommandHandlerError) {
      const authority = await classifyEventAuthority(
        repository,
        plan,
        commandDigest,
        signalValue,
      );
      if (error.reason === "aborted") fail("aborted", error, authority);
      if (error.reason === "concurrency-conflict") {
        fail("plan", error, authority);
      }
      if (error.reason === "decision-rejected") {
        fail("transition", error, authority);
      }
      fail("event", error, authority);
    }
    throw error;
  }
}

async function closeRoot(
  root: RootedDirectory,
  eventAuthority: TargetDeliveryPreparationEventAuthority,
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

export class TargetDeliveryPreparationService {
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

  /** 零写入生成一份完整Preparation plan并预演唯一事件commit。 */
  async preview(
    requestValue: unknown,
    optionsValue: TargetDeliveryPreparationPreviewOptions = {},
  ): Promise<Readonly<TargetDeliveryPreparationPreviewResult>> {
    let request;
    let options;
    try {
      request = parseTargetDeliveryPreparationPreviewRequest(requestValue);
      options = parseTargetDeliveryPreparationPreviewOptions(optionsValue);
      assertTargetDeliveryPreparationNotAborted(options.signal);
    } catch (error: unknown) {
      if (error instanceof TargetDeliveryPreparationInputError) {
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
    let result: Readonly<TargetDeliveryPreparationPreviewResult> | undefined;
    let failure: unknown;
    try {
      let sources;
      try {
        sources = await loadTargetDeliveryPreparationSources(
          this.#workspaceRoot,
          context,
          request.targetTaskId,
          this.#resourceProfile,
          this.#identityProfile,
          options.signal,
        );
      } catch (error: unknown) {
        if (error instanceof TargetDeliveryPreparationAuthorityError) {
          mapAuthorityError(error);
        }
        throw error;
      }
      let ids;
      try {
        ids = allocateTargetDeliveryPreparationIds(options.uuidFactory);
      } catch (error: unknown) {
        if (error instanceof TargetDeliveryPreparationInputError) {
          mapInputError(error);
        }
        throw error;
      }
      await assertTargetDeliveryIdAvailable(
        new DemandEventSourcingRepository(context.demandRoot),
        ids.targetDeliveryId,
        options.signal,
        "identity",
      );
      let intent: Readonly<TargetDeliveryIntent>;
      try {
        intent = createTargetDeliveryIntent(
          {
            targetDeliveryId: ids.targetDeliveryId,
            taskPackage: sources.taskPackage,
            hostId: this.#resourceProfile.hostId,
            bindingId: sources.binding.bindingId,
            language: context.config.model.presentation.language,
            ...(sources.purpose === "implementation-review-rework"
              ? { rework: sources.reworkContext }
              : sources.purpose === "product-defect-remediation"
                ? {
                    productDefectRemediation:
                      sources.productDefectRemediationContext,
                  }
                : {}),
          },
          options.clock === undefined ? {} : { clock: options.clock },
        );
      } catch (error: unknown) {
        if (error instanceof TargetDeliveryIntentError) {
          if (error.reason === "time") fail("input", error);
          fail("transition", error);
        }
        throw error;
      }
      const plan = createTargetDeliveryPreparationPlan({
        demandId: request.demandId,
        targetTaskId: request.targetTaskId,
        expectedStreamRevision: context.loaded.aggregate.streamRevision,
        commitId: ids.commitId,
        eventId: ids.eventId,
        intent,
      });
      preflightCommit(
        context,
        plan,
        sources.taskPackage,
        sources.purpose === "implementation-review-rework"
          ? sources.reworkSource
          : undefined,
        sources.purpose === "product-defect-remediation"
          ? sources.productDefectRemediationSource
          : undefined,
      );
      result = Object.freeze({
        plan,
        planDigest: computeTargetDeliveryPreparationPlanDigest(plan),
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
        throw error;
      }
    }
    if (failure !== undefined) throw failure;
    if (result === undefined) fail("operation-failure");
    return result;
  }

  /** 重验并应用preview计划；已提交重试只证明同Commit并返回现有事件authority。 */
  async apply(
    planValue: unknown,
    planDigestValue: unknown,
    optionsValue: TargetDeliveryPreparationApplyOptions = {},
  ): Promise<Readonly<TargetDeliveryPreparationApplyResult>> {
    let options;
    try {
      options = parseTargetDeliveryPreparationApplyOptions(optionsValue);
      assertTargetDeliveryPreparationNotAborted(options.signal);
    } catch (error: unknown) {
      if (error instanceof TargetDeliveryPreparationInputError) {
        mapInputError(error);
      }
      throw error;
    }
    let plan: Readonly<TargetDeliveryPreparationPlan>;
    let planDigest: Sha256Digest;
    try {
      plan = parseTargetDeliveryPreparationPlan(planValue);
      planDigest = parseSha256Digest(planDigestValue, "$planDigest");
    } catch (error: unknown) {
      if (
        error instanceof TargetDeliveryPreparationPlanError ||
        error instanceof Sha256Error
      ) {
        fail("plan", error);
      }
      throw error;
    }
    if (computeTargetDeliveryPreparationPlanDigest(plan) !== planDigest) {
      fail("plan");
    }

    let demandRoot: RootedDirectory | undefined;
    try {
      demandRoot = await openDemandOperationRoot(
        this.#workspaceRoot,
        plan.demandId,
      );
    } catch (error: unknown) {
      if (error instanceof DemandOperationAuthorityContextError) {
        mapContextError(error);
      }
      throw error;
    }
    let eventAuthority: TargetDeliveryPreparationEventAuthority = "unchanged";
    let result: Readonly<TargetDeliveryPreparationApplyResult> | undefined;
    let failure: unknown;
    try {
      let repository = new DemandEventSourcingRepository(demandRoot);
      let taskPackage;
      let reworkSource:
        Readonly<TargetDeliveryPreparationReworkSource> | undefined;
      let productDefectRemediationSource:
        | Readonly<TargetDeliveryPreparationProductDefectRemediationSource>
        | undefined;
      try {
        taskPackage = await loadTargetDeliveryPreparationTaskPackageFromEvent(
          repository,
          plan,
          options.signal,
        );
        reworkSource =
          await loadTargetDeliveryPreparationReworkSourceFromEventHistory(
            repository,
            plan.intent,
            options.signal,
          );
        productDefectRemediationSource =
          await loadTargetDeliveryPreparationProductDefectRemediationSourceFromEventHistory(
            repository,
            plan.intent,
            options.signal,
          );
      } catch (error: unknown) {
        if (error instanceof TargetDeliveryPreparationAuthorityError) {
          mapAuthorityError(error);
        }
        throw error;
      }
      const command = preparationCommand(
        plan,
        taskPackage,
        reworkSource,
        productDefectRemediationSource,
      );
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
      if (
        existing !== null &&
        (existing.commandDigest !== commandDigest ||
          existing.expectedStreamRevision !== plan.expectedStreamRevision)
      ) {
        fail("plan");
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
          if (
            racedCommit !== null &&
            (racedCommit.commandDigest !== commandDigest ||
              racedCommit.expectedStreamRevision !==
                plan.expectedStreamRevision)
          ) {
            fail("plan");
          }
          if (racedCommit === null) {
            await assertTargetDeliveryIdAvailable(
              repository,
              plan.intent.targetDeliveryId,
              options.signal,
              "plan",
            );
            let sources;
            try {
              sources = await loadTargetDeliveryPreparationSources(
                this.#workspaceRoot,
                context,
                plan.targetTaskId,
                this.#resourceProfile,
                this.#identityProfile,
                options.signal,
              );
            } catch (error: unknown) {
              if (error instanceof TargetDeliveryPreparationAuthorityError) {
                mapAuthorityError(error);
              }
              throw error;
            }
            taskPackage = sources.taskPackage;
            reworkSource =
              sources.purpose === "implementation-review-rework"
                ? sources.reworkSource
                : undefined;
            productDefectRemediationSource =
              sources.purpose === "product-defect-remediation"
                ? sources.productDefectRemediationSource
                : undefined;
            assertTargetDeliveryIntentMatchesTaskPackage(
              plan.intent,
              taskPackage,
            );
            let currentIntent;
            try {
              currentIntent = createTargetDeliveryIntent(
                {
                  targetDeliveryId: plan.intent.targetDeliveryId,
                  taskPackage,
                  hostId: this.#resourceProfile.hostId,
                  bindingId: sources.binding.bindingId,
                  language: context.config.model.presentation.language,
                  ...(sources.purpose === "implementation-review-rework"
                    ? { rework: sources.reworkContext }
                    : sources.purpose === "product-defect-remediation"
                      ? {
                          productDefectRemediation:
                            sources.productDefectRemediationContext,
                        }
                      : {}),
                },
                { clock: () => plan.intent.preparedAt },
              );
            } catch (error: unknown) {
              if (error instanceof TargetDeliveryIntentError) {
                fail("plan", error);
              }
              throw error;
            }
            if (
              canonicalizeJson(currentIntent, "$currentIntent") !==
                canonicalizeJson(plan.intent, "$planIntent") ||
              context.loaded.aggregate.streamRevision !==
                plan.expectedStreamRevision
            ) {
              fail("plan");
            }
            preflightCommit(
              context,
              plan,
              taskPackage,
              reworkSource,
              productDefectRemediationSource,
            );
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
          const executed = await executePlan(
            repository,
            plan,
            taskPackage,
            reworkSource,
            productDefectRemediationSource,
            options.signal,
          );
          eventAuthority = "current";
          result = Object.freeze({
            disposition: executed.result.disposition,
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
          if (contextFailure === undefined) contextFailure = error;
        }
        if (contextFailure !== undefined) throw contextFailure;
      } else {
        eventAuthority = "current";
        const executed = await executePlan(
          repository,
          plan,
          taskPackage,
          reworkSource,
          productDefectRemediationSource,
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
        });
      }
    } catch (error: unknown) {
      if (error instanceof TargetDeliveryPreparationServiceError) {
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
    if (result === undefined) {
      fail("operation-failure", undefined, eventAuthority);
    }
    return result;
  }
}

export type {
  TargetDeliveryPreparationApplyOptions,
  TargetDeliveryPreparationPreviewOptions,
  TargetDeliveryPreparationPreviewRequest,
} from "./target-delivery-preparation-input.js";
