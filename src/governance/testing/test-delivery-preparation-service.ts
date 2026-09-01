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
import type { TestTaskPackage } from "../tasking/task-package.js";
import {
  loadCurrentTestDeliveryPreparationSources,
  loadTestDeliveryPreparationSourcesFromEvents,
  TestDeliveryPreparationAuthorityError,
  type TestDeliveryPreparationSources,
} from "./test-delivery-preparation-authority.js";
import {
  allocateInitialTestDeliveryPreparationIds,
  allocateReplacementTestDeliveryPreparationIds,
  allocateRerunTestDeliveryPreparationIds,
  assertTestDeliveryPreparationNotAborted,
  parseTestDeliveryPreparationApplyOptions,
  parseTestDeliveryPreparationPreviewOptions,
  parseTestDeliveryPreparationPreviewRequest,
  TestDeliveryPreparationInputError,
  type TestDeliveryPreparationApplyOptions,
  type TestDeliveryPreparationPreviewOptions,
} from "./test-delivery-preparation-input.js";
import {
  computeTestDeliveryPreparationPlanDigest,
  createTestDeliveryPreparationPlan,
  parseTestDeliveryPreparationPlan,
  TestDeliveryPreparationPlanError,
  type TestDeliveryPreparationPlan,
} from "./test-delivery-preparation-plan.js";
import {
  createTestDeliveryIntent,
  TestDeliveryIntentError,
} from "./test-delivery-intent.js";
import {
  createInitialTestExecutionAttempt,
  createRerunTestExecutionAttempt,
  TestExecutionAttemptError,
} from "./test-execution-attempt.js";

/**
 * Wakeflow Governance / Testing：Test Delivery授权准备的唯一写owner。
 *
 * Event Commit是本单元唯一业务提交点。Service不创建packet/envelope、prompt或
 * WindowWorkClaim，不执行environment setup或宿主发送；同Commit重试只从既有Event
 * 恢复TaskPackage/TestCard并返回原Event authority。
 */

export interface TestDeliveryPreparationPreviewResult {
  readonly plan: Readonly<TestDeliveryPreparationPlan>;
  readonly planDigest: Sha256Digest;
}

export interface TestDeliveryPreparationApplyResult {
  readonly disposition: "committed" | "idempotent";
  readonly eventAuthority: "current";
  readonly plan: Readonly<TestDeliveryPreparationPlan>;
  readonly planDigest: Sha256Digest;
  readonly commandDigest: Sha256Digest;
  readonly commandResult: Readonly<DemandEventSourcingCommandResult>;
  readonly commitDigest: Sha256Digest;
}

export type TestDeliveryPreparationEventAuthority =
  "unchanged" | "current" | "unknown";

export type TestDeliveryPreparationServiceErrorReason =
  | "input"
  | "identity"
  | "root"
  | "config"
  | "demand-authority"
  | "placement"
  | "route"
  | "task-package"
  | "test-card"
  | "binding"
  | "claim"
  | "observation"
  | "attempt"
  | "intent"
  | "plan"
  | "transition"
  | "event"
  | "attempt-capacity"
  | "delivery-authorization-capacity"
  | "commit-capacity"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Test Delivery Preparation input is invalid.",
  identity: "Test Delivery Preparation identity allocation failed.",
  root: "Test Delivery Preparation root could not be held safely.",
  config: "Test Delivery Preparation Config is invalid or stale.",
  "demand-authority": "Test Delivery Preparation Demand Authority is invalid.",
  placement: "Test Delivery Preparation placement is unsupported.",
  route: "Test Delivery Preparation route is not admitted.",
  "task-package": "Test Delivery Preparation TaskPackage is invalid.",
  "test-card": "Test Delivery Preparation TestCard is invalid.",
  binding: "Test Delivery Preparation current Binding is invalid.",
  claim:
    "Test Delivery Preparation cannot retain a conflicting Window WorkClaim.",
  observation: "Test Delivery Preparation rejected host effect is invalid.",
  attempt: "Test Delivery Preparation logical attempt is invalid.",
  intent: "Test Delivery Preparation Intent is invalid.",
  plan: "Test Delivery Preparation plan is invalid or stale.",
  transition: "Test Delivery Preparation transition is not admitted.",
  event: "Test Delivery Preparation Event append failed.",
  "attempt-capacity":
    "Test Delivery Preparation has no remaining logical attempt capacity.",
  "delivery-authorization-capacity":
    "Test Delivery Preparation has no remaining Delivery authorization capacity in the current attempt.",
  "commit-capacity":
    "Test Delivery Preparation Event Commit exceeds its byte capacity.",
  aborted: "Test Delivery Preparation was aborted.",
  "operation-failure": "Test Delivery Preparation operation failed.",
} as const satisfies Readonly<
  Record<TestDeliveryPreparationServiceErrorReason, string>
>;

export class TestDeliveryPreparationServiceError extends Error {
  override readonly name = "TestDeliveryPreparationServiceError";
  readonly code = "wakeflow-test-delivery-preparation-service" as const;
  readonly reason: TestDeliveryPreparationServiceErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly eventAuthority: TestDeliveryPreparationEventAuthority;

  constructor(
    reason: TestDeliveryPreparationServiceErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    eventAuthority: TestDeliveryPreparationEventAuthority = "unchanged",
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
  reason: TestDeliveryPreparationServiceErrorReason,
  cause?: unknown,
  eventAuthority: TestDeliveryPreparationEventAuthority = "unchanged",
): never {
  throw new TestDeliveryPreparationServiceError(
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

function mapInputError(error: TestDeliveryPreparationInputError): never {
  fail(error.reason, error);
}

function mapAuthorityError(
  error: TestDeliveryPreparationAuthorityError,
): never {
  if (error.reason === "authority") fail("demand-authority", error);
  if (error.reason === "authorization-capacity") {
    fail("delivery-authorization-capacity", error);
  }
  if (error.reason === "attempt-capacity") fail("attempt-capacity", error);
  fail(error.reason, error);
}

function preparationCommand(
  plan: Readonly<TestDeliveryPreparationPlan>,
  taskPackage: Readonly<TestTaskPackage>,
  testCard: Readonly<TestDeliveryPreparationSources["testCard"]>,
) {
  return parseDemandEventSourcingCommand({
    commandType: "testing.prepare-test-delivery",
    commandVersion: 1,
    eventId: plan.eventId,
    intent: plan.intent,
    taskPackage,
    testCard,
  });
}

function preflight(
  context: Readonly<DemandOperationAuthorityContext>,
  plan: Readonly<TestDeliveryPreparationPlan>,
  taskPackage: Readonly<TestTaskPackage>,
  testCard: Readonly<TestDeliveryPreparationSources["testCard"]>,
): void {
  try {
    const command = preparationCommand(plan, taskPackage, testCard);
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
      fail("commit-capacity");
    }
  } catch (error: unknown) {
    if (error instanceof TestDeliveryPreparationServiceError) throw error;
    if (
      error instanceof DemandEventSourcingDecisionError ||
      error instanceof DemandEventStreamCommitError
    ) {
      fail("transition", error);
    }
    throw error;
  }
}

async function assertIdentitiesAvailable(
  repository: DemandEventSourcingRepository,
  plan: Readonly<TestDeliveryPreparationPlan>,
  signal: AbortSignal | undefined,
  collisionReason: "identity" | "plan",
): Promise<void> {
  try {
    const [testDelivery, productDelivery] = await Promise.all([
      repository.findTestDeliveryPreparedEvent(
        plan.intent.targetDeliveryId,
        signal === undefined ? undefined : { signal },
      ),
      repository.findTargetDeliveryPreparedEvent(
        plan.intent.targetDeliveryId,
        signal === undefined ? undefined : { signal },
      ),
    ]);
    if (testDelivery !== null || productDelivery !== null) {
      fail(collisionReason);
    }
  } catch (error: unknown) {
    if (error instanceof TestDeliveryPreparationServiceError) throw error;
    if (error instanceof DemandEventSourcingRepositoryError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("event", error, "unknown");
    }
    throw error;
  }
}

async function classifyEventAuthority(
  repository: DemandEventSourcingRepository,
  plan: Readonly<TestDeliveryPreparationPlan>,
  commandDigest: Sha256Digest,
  signal: AbortSignal | undefined,
): Promise<TestDeliveryPreparationEventAuthority> {
  try {
    const existing = await repository.findCommitById(
      plan.commitId,
      signal === undefined ? undefined : { signal },
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

async function executePlan(
  repository: DemandEventSourcingRepository,
  plan: Readonly<TestDeliveryPreparationPlan>,
  taskPackage: Readonly<TestTaskPackage>,
  testCard: Readonly<TestDeliveryPreparationSources["testCard"]>,
  signal: AbortSignal | undefined,
): Promise<
  Readonly<{
    readonly commandDigest: Sha256Digest;
    readonly result: Readonly<DemandEventSourcingCommandResult>;
  }>
> {
  const command = preparationCommand(plan, taskPackage, testCard);
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
      if (
        error.reason === "concurrency-conflict" ||
        error.reason === "idempotency-conflict"
      ) {
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
  authority: TestDeliveryPreparationEventAuthority,
): Promise<void> {
  try {
    await closeDemandOperationRoot(root);
  } catch (error: unknown) {
    if (error instanceof DemandOperationAuthorityContextError) {
      fail("root", error, authority);
    }
    throw error;
  }
}

export class TestDeliveryPreparationService {
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

  async preview(
    requestValue: unknown,
    optionsValue: TestDeliveryPreparationPreviewOptions = {},
  ): Promise<Readonly<TestDeliveryPreparationPreviewResult>> {
    let request;
    let options;
    try {
      request = parseTestDeliveryPreparationPreviewRequest(requestValue);
      options = parseTestDeliveryPreparationPreviewOptions(optionsValue);
      assertTestDeliveryPreparationNotAborted(options.signal);
    } catch (error: unknown) {
      if (error instanceof TestDeliveryPreparationInputError) {
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
    let result: Readonly<TestDeliveryPreparationPreviewResult> | undefined;
    let failure: unknown;
    try {
      let sources;
      try {
        sources = await loadCurrentTestDeliveryPreparationSources(
          this.#workspaceRoot,
          context,
          request.targetTaskId,
          this.#resourceProfile,
          this.#identityProfile,
          options.signal,
        );
      } catch (error: unknown) {
        if (error instanceof TestDeliveryPreparationAuthorityError) {
          mapAuthorityError(error);
        }
        throw error;
      }
      let ids: Readonly<{
        readonly targetDeliveryId: TestDeliveryPreparationPlan["intent"]["targetDeliveryId"];
        readonly eventId: TestDeliveryPreparationPlan["eventId"];
        readonly commitId: TestDeliveryPreparationPlan["commitId"];
      }>;
      let attempt;
      let intent;
      try {
        if (sources.mode === "initial") {
          const allocated = allocateInitialTestDeliveryPreparationIds(
            options.uuidFactory,
          );
          ids = allocated;
          attempt = createInitialTestExecutionAttempt({
            testAttemptId: allocated.testAttemptId,
            testCard: sources.testCard,
          });
        } else if (sources.mode === "rerun") {
          const allocated = allocateRerunTestDeliveryPreparationIds(
            options.uuidFactory,
          );
          ids = allocated;
          attempt = createRerunTestExecutionAttempt({
            testAttemptId: allocated.testAttemptId,
            testCard: sources.testCard,
            previousAttempt: sources.previousAttempt,
            previousResult: sources.rerunSource.previousResult,
            reviewDecision: sources.rerunSource.reviewDecision,
          });
        } else {
          ids = allocateReplacementTestDeliveryPreparationIds(
            options.uuidFactory,
          );
          attempt = sources.attempt;
        }
        intent = createTestDeliveryIntent(
          {
            targetDeliveryId: ids.targetDeliveryId,
            taskPackage: sources.taskPackage,
            testCard: sources.testCard,
            attempt,
            hostId: this.#resourceProfile.hostId,
            bindingId: sources.binding.bindingId,
            language: context.config.model.presentation.language,
            ...(sources.mode === "replacement-authorization"
              ? { replacement: sources.replacement }
              : {}),
          },
          options.clock === undefined ? {} : { clock: options.clock },
        );
      } catch (error: unknown) {
        if (error instanceof TestDeliveryPreparationInputError) {
          mapInputError(error);
        }
        if (error instanceof TestExecutionAttemptError) fail("attempt", error);
        if (error instanceof TestDeliveryIntentError) {
          fail(error.reason === "time" ? "input" : "intent", error);
        }
        throw error;
      }
      const plan = createTestDeliveryPreparationPlan({
        demandId: request.demandId,
        targetTaskId: request.targetTaskId,
        expectedStreamRevision: context.loaded.aggregate.streamRevision,
        commitId: ids.commitId,
        eventId: ids.eventId,
        intent,
      });
      await assertIdentitiesAvailable(
        new DemandEventSourcingRepository(context.demandRoot),
        plan,
        options.signal,
        "identity",
      );
      preflight(context, plan, sources.taskPackage, sources.testCard);
      result = Object.freeze({
        plan,
        planDigest: computeTestDeliveryPreparationPlanDigest(plan),
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

  async apply(
    planValue: unknown,
    planDigestValue: unknown,
    optionsValue: TestDeliveryPreparationApplyOptions = {},
  ): Promise<Readonly<TestDeliveryPreparationApplyResult>> {
    let options;
    try {
      options = parseTestDeliveryPreparationApplyOptions(optionsValue);
      assertTestDeliveryPreparationNotAborted(options.signal);
    } catch (error: unknown) {
      if (error instanceof TestDeliveryPreparationInputError) {
        mapInputError(error);
      }
      throw error;
    }
    let plan: Readonly<TestDeliveryPreparationPlan>;
    let planDigest: Sha256Digest;
    try {
      plan = parseTestDeliveryPreparationPlan(planValue);
      planDigest = parseSha256Digest(planDigestValue, "$planDigest");
    } catch (error: unknown) {
      if (
        error instanceof TestDeliveryPreparationPlanError ||
        error instanceof Sha256Error
      ) {
        fail("plan", error);
      }
      throw error;
    }
    if (computeTestDeliveryPreparationPlanDigest(plan) !== planDigest) {
      fail("plan");
    }

    let demandRoot: RootedDirectory | undefined;
    let eventAuthority: TestDeliveryPreparationEventAuthority = "unchanged";
    let result: Readonly<TestDeliveryPreparationApplyResult> | undefined;
    let failure: unknown;
    try {
      demandRoot = await openDemandOperationRoot(
        this.#workspaceRoot,
        plan.demandId,
      );
      let repository = new DemandEventSourcingRepository(demandRoot);
      let eventSources;
      try {
        eventSources = await loadTestDeliveryPreparationSourcesFromEvents(
          repository,
          plan,
          options.signal,
        );
      } catch (error: unknown) {
        if (error instanceof TestDeliveryPreparationAuthorityError) {
          mapAuthorityError(error);
        }
        throw error;
      }
      let command = preparationCommand(
        plan,
        eventSources.taskPackage,
        eventSources.testCard,
      );
      let commandDigest = computeDemandEventSourcingCommandDigest(command);
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
          let raced;
          try {
            raced = await repository.findCommitById(
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
            raced !== null &&
            (raced.commandDigest !== commandDigest ||
              raced.expectedStreamRevision !== plan.expectedStreamRevision)
          ) {
            fail("plan");
          }
          if (raced === null) {
            await assertIdentitiesAvailable(
              repository,
              plan,
              options.signal,
              "plan",
            );
            let sources;
            try {
              sources = await loadCurrentTestDeliveryPreparationSources(
                this.#workspaceRoot,
                context,
                plan.targetTaskId,
                this.#resourceProfile,
                this.#identityProfile,
                options.signal,
              );
            } catch (error: unknown) {
              if (error instanceof TestDeliveryPreparationAuthorityError) {
                mapAuthorityError(error);
              }
              throw error;
            }
            let currentIntent;
            try {
              const attempt =
                sources.mode === "initial"
                  ? createInitialTestExecutionAttempt({
                      testAttemptId: plan.intent.attempt.testAttemptId,
                      testCard: sources.testCard,
                    })
                  : sources.mode === "rerun"
                    ? createRerunTestExecutionAttempt({
                        testAttemptId: plan.intent.attempt.testAttemptId,
                        testCard: sources.testCard,
                        previousAttempt: sources.previousAttempt,
                        previousResult: sources.rerunSource.previousResult,
                        reviewDecision: sources.rerunSource.reviewDecision,
                      })
                    : sources.attempt;
              currentIntent = createTestDeliveryIntent(
                {
                  targetDeliveryId: plan.intent.targetDeliveryId,
                  taskPackage: sources.taskPackage,
                  testCard: sources.testCard,
                  attempt,
                  hostId: this.#resourceProfile.hostId,
                  bindingId: sources.binding.bindingId,
                  language: context.config.model.presentation.language,
                  ...(sources.mode === "replacement-authorization"
                    ? { replacement: sources.replacement }
                    : {}),
                },
                { clock: () => plan.intent.preparedAt },
              );
            } catch (error: unknown) {
              if (
                error instanceof TestExecutionAttemptError ||
                error instanceof TestDeliveryIntentError
              ) {
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
            eventSources = sources;
            command = preparationCommand(
              plan,
              sources.taskPackage,
              sources.testCard,
            );
            commandDigest = computeDemandEventSourcingCommandDigest(command);
            preflight(context, plan, sources.taskPackage, sources.testCard);
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
            eventSources.taskPackage,
            eventSources.testCard,
            options.signal,
          );
          eventAuthority = "current";
          result = Object.freeze({
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
                ? new TestDeliveryPreparationServiceError(
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
        const executed = await executePlan(
          repository,
          plan,
          eventSources.taskPackage,
          eventSources.testCard,
          options.signal,
        );
        eventAuthority = "current";
        result = Object.freeze({
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
      if (error instanceof TestDeliveryPreparationServiceError) {
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
  TestDeliveryPreparationApplyOptions,
  TestDeliveryPreparationPreviewOptions,
  TestDeliveryPreparationPreviewRequest,
} from "./test-delivery-preparation-input.js";
