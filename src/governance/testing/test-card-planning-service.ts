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
  createTestCard,
  parseTestCardAuthoredContent,
  TestCardError,
  type TestCard,
  type TestCardAuthoredContent,
} from "./test-card.js";
import {
  loadTestCardPlanningGenerationAuthorizationFromEventHistory,
  loadTestCardPlanningSources,
  TestCardPlanningAuthorityError,
} from "./test-card-planning-authority.js";
import type { ControllerProductDefectRemediationAuthorization } from "../review/controller-product-defect-remediation-authorization.js";
import {
  computeTestCardPlanningPlanDigest,
  createTestCardPlanningPlan,
  parseTestCardPlanningPlan,
  TestCardPlanningPlanError,
  type TestCardPlanningPlan,
} from "./test-card-planning-plan.js";

/** TestCard Planning preview/apply owner；只创建TestCard Event，不创建Test TaskPackage。 */

export interface TestCardPlanningPreviewRequest {
  readonly demandId: WakeflowDurableId<"demand">;
  readonly testCard: Readonly<TestCardAuthoredContent>;
}

export interface TestCardPlanningPreviewOptions {
  readonly clock?: UtcWallClock;
  readonly uuidFactory?: UuidV4Factory;
  readonly signal?: AbortSignal;
}

export interface TestCardPlanningApplyOptions {
  readonly signal?: AbortSignal;
}

export interface TestCardPlanningPreviewResult {
  readonly plan: Readonly<TestCardPlanningPlan>;
  readonly planDigest: Sha256Digest;
}

export interface TestCardPlanningApplyResult {
  readonly status: "created" | "already-created";
  readonly disposition: "committed" | "idempotent";
  readonly eventAuthority: "current";
  readonly plan: Readonly<TestCardPlanningPlan>;
  readonly planDigest: Sha256Digest;
  readonly commandDigest: Sha256Digest;
  readonly commandResult: Readonly<DemandEventSourcingCommandResult>;
  readonly commitDigest: Sha256Digest;
}

export type TestCardPlanningEventAuthority =
  "unchanged" | "current" | "unknown";

export type TestCardPlanningServiceErrorReason =
  | "input"
  | "identity"
  | "root"
  | "config"
  | "demand-authority"
  | "route"
  | "placement"
  | "claim"
  | "test-basis"
  | "generation-source"
  | "test-card"
  | "plan"
  | "transition"
  | "event"
  | "capacity"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "TestCard Planning input is invalid.",
  identity: "TestCard Planning identity allocation failed.",
  root: "TestCard Planning root could not be held safely.",
  config: "TestCard Planning Config authority is invalid or stale.",
  "demand-authority": "TestCard Planning Demand authority is invalid.",
  route: "TestCard Planning real-environment route is not admitted.",
  placement: "TestCard Planning execution placement is unsupported.",
  claim: "TestCard Planning cannot retain a product WorkClaim.",
  "test-basis": "TestCard Planning Test Basis Authority is invalid.",
  "generation-source":
    "TestCard Planning generation lineage is invalid or ambiguous.",
  "test-card": "TestCard Planning TestCard is invalid.",
  plan: "TestCard Planning plan is invalid or stale.",
  transition: "TestCard Planning transition is not admitted.",
  event: "TestCard Planning Event append failed.",
  capacity: "TestCard Planning Event Commit exceeds its capacity.",
  aborted: "TestCard Planning was aborted.",
  "operation-failure": "TestCard Planning operation failed.",
} as const satisfies Readonly<
  Record<TestCardPlanningServiceErrorReason, string>
>;

export class TestCardPlanningServiceError extends Error {
  override readonly name = "TestCardPlanningServiceError";
  readonly code = "wakeflow-test-card-planning-service" as const;
  readonly reason: TestCardPlanningServiceErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly eventAuthority: TestCardPlanningEventAuthority;

  constructor(
    reason: TestCardPlanningServiceErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    eventAuthority: TestCardPlanningEventAuthority = "unchanged",
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
  reason: TestCardPlanningServiceErrorReason,
  cause?: unknown,
  eventAuthority: TestCardPlanningEventAuthority = "unchanged",
): never {
  throw new TestCardPlanningServiceError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    eventAuthority,
  );
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
  path: string,
): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error);
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== fields.length ||
    keys.some((key, index) => key !== fields[index])
  ) {
    fail("input");
  }
  return record;
}

function optionalRecord(
  value: unknown,
  allowed: readonly string[],
  path: string,
): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error);
    throw error;
  }
  if (Object.keys(record).some((key) => !allowed.includes(key))) fail("input");
  return record;
}

function parseSignal(value: unknown): AbortSignal | undefined {
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
  readonly request: Readonly<TestCardPlanningPreviewRequest>;
  readonly options: Readonly<TestCardPlanningPreviewOptions>;
}> {
  const request = exactRecord(
    requestValue,
    ["demandId", "testCard"],
    "$request",
  );
  let demandId: WakeflowDurableId<"demand">;
  let testCard: Readonly<TestCardAuthoredContent>;
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
  try {
    testCard = parseTestCardAuthoredContent(request.testCard);
  } catch (error: unknown) {
    if (error instanceof TestCardError) fail("input", error);
    throw error;
  }
  const options = optionalRecord(
    optionsValue,
    ["clock", "signal", "uuidFactory"],
    "$options",
  );
  if (
    Object.keys(options).some(
      (key) => !["clock", "signal", "uuidFactory"].includes(key),
    ) ||
    (options.clock !== undefined &&
      (typeof options.clock !== "function" || types.isProxy(options.clock))) ||
    (options.uuidFactory !== undefined &&
      (typeof options.uuidFactory !== "function" ||
        types.isProxy(options.uuidFactory)))
  ) {
    fail("input");
  }
  const parsedSignal = parseSignal(options.signal);
  return Object.freeze({
    request: Object.freeze({
      demandId,
      testCard,
    }),
    options: Object.freeze({
      ...(options.clock === undefined
        ? {}
        : { clock: options.clock as UtcWallClock }),
      ...(options.uuidFactory === undefined
        ? {}
        : { uuidFactory: options.uuidFactory as UuidV4Factory }),
      ...(parsedSignal === undefined ? {} : { signal: parsedSignal }),
    }),
  });
}

function applyOptions(value: unknown): Readonly<TestCardPlanningApplyOptions> {
  const record = optionalRecord(value, ["signal"], "$options");
  const signal = parseSignal(record.signal);
  return Object.freeze(signal === undefined ? {} : { signal });
}

function allocateIds(factory: UuidV4Factory | undefined): Readonly<{
  readonly testCardId: WakeflowDurableId<"test-card">;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly commitId: WakeflowDurableId<"demand-event-commit">;
}> {
  try {
    return Object.freeze({
      testCardId: createWakeflowDurableId("test-card", createUuidV4(factory)),
      targetTaskId: createWakeflowDurableId(
        "target-task",
        createUuidV4(factory),
      ),
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

function mapAuthorityError(error: TestCardPlanningAuthorityError): never {
  fail(error.reason, error);
}

function command(
  plan: Readonly<TestCardPlanningPlan>,
  generationAuthorization:
    Readonly<ControllerProductDefectRemediationAuthorization> | undefined,
) {
  return parseDemandEventSourcingCommand({
    commandType: "testing.create-test-card",
    commandVersion: 1,
    eventId: plan.eventId,
    authority: plan.authority,
    testCard: plan.testCard,
    generationSource: plan.generationSource,
    ...(generationAuthorization === undefined
      ? {}
      : { generationAuthorization }),
  });
}

function preflight(
  context: Readonly<DemandOperationAuthorityContext>,
  plan: Readonly<TestCardPlanningPlan>,
  generationAuthorization:
    Readonly<ControllerProductDefectRemediationAuthorization> | undefined,
): void {
  try {
    const parsed = command(plan, generationAuthorization);
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
    if (error instanceof TestCardPlanningServiceError) throw error;
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
  plan: Readonly<TestCardPlanningPlan>,
  generationAuthorization:
    Readonly<ControllerProductDefectRemediationAuthorization> | undefined,
  signal: AbortSignal | undefined,
): Promise<
  Readonly<{
    readonly commandDigest: Sha256Digest;
    readonly result: Readonly<DemandEventSourcingCommandResult>;
  }>
> {
  const parsed = command(plan, generationAuthorization);
  const commandDigest = computeDemandEventSourcingCommandDigest(parsed);
  try {
    const result = await executeDemandEventSourcingCommand(repository, parsed, {
      commitId: plan.commitId,
      expectedStreamRevision: plan.expectedStreamRevision,
      ...(signal === undefined ? {} : { signal }),
    });
    return Object.freeze({ commandDigest, result });
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingCommandHandlerError) {
      if (error.reason === "aborted") fail("aborted", error, "unknown");
      if (error.reason === "idempotency-conflict") fail("plan", error);
      if (error.reason === "concurrency-conflict") fail("plan", error);
      if (error.reason === "decision-rejected") fail("transition", error);
      fail("event", error, "unknown");
    }
    throw error;
  }
}

async function closeRoot(
  root: RootedDirectory,
  authority: TestCardPlanningEventAuthority,
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

export class TestCardPlanningService {
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

  async preview(
    requestValue: unknown,
    optionsValue: TestCardPlanningPreviewOptions = {},
  ): Promise<Readonly<TestCardPlanningPreviewResult>> {
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
    let result: Readonly<TestCardPlanningPreviewResult> | undefined;
    let failure: unknown;
    try {
      let sources;
      try {
        sources = await loadTestCardPlanningSources(
          this.#workspaceRoot,
          context,
          options.signal,
        );
      } catch (error: unknown) {
        if (error instanceof TestCardPlanningAuthorityError) {
          mapAuthorityError(error);
        }
        throw error;
      }
      const ids = allocateIds(options.uuidFactory);
      let testCard: Readonly<TestCard>;
      try {
        testCard = createTestCard(
          {
            ...request.testCard,
            testCardId: ids.testCardId,
            targetTaskId: ids.targetTaskId,
            testWindowId: sources.testWindowId,
            requirementGoal: sources.requirementGoal,
            routeSource: sources.routeSource,
          },
          options.clock === undefined ? {} : { clock: options.clock },
        );
      } catch (error: unknown) {
        if (error instanceof TestCardError) fail("test-card", error);
        throw error;
      }
      const plan = createTestCardPlanningPlan({
        demandId: request.demandId,
        expectedStreamRevision: context.loaded.aggregate.streamRevision,
        eventId: ids.eventId,
        commitId: ids.commitId,
        authority: context.loaded.authority,
        testCard,
        generationSource: sources.generationSource,
      });
      preflight(context, plan, sources.generationAuthorization);
      result = Object.freeze({
        plan,
        planDigest: computeTestCardPlanningPlanDigest(plan),
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
    optionsValue: TestCardPlanningApplyOptions = {},
  ): Promise<Readonly<TestCardPlanningApplyResult>> {
    const options = applyOptions(optionsValue);
    let plan: Readonly<TestCardPlanningPlan>;
    let planDigest: Sha256Digest;
    try {
      plan = parseTestCardPlanningPlan(planValue);
      planDigest = parseSha256Digest(planDigestValue, "$planDigest");
    } catch (error: unknown) {
      if (
        error instanceof TestCardPlanningPlanError ||
        error instanceof Sha256Error
      ) {
        fail("plan", error);
      }
      throw error;
    }
    if (computeTestCardPlanningPlanDigest(plan) !== planDigest) fail("plan");

    let demandRoot: RootedDirectory | undefined;
    let eventAuthority: TestCardPlanningEventAuthority = "unchanged";
    let result: Readonly<TestCardPlanningApplyResult> | undefined;
    let failure: unknown;
    try {
      demandRoot = await openDemandOperationRoot(
        this.#workspaceRoot,
        plan.demandId,
      );
      let repository = new DemandEventSourcingRepository(demandRoot);
      let generationAuthorization:
        Readonly<ControllerProductDefectRemediationAuthorization> | undefined;
      try {
        generationAuthorization =
          await loadTestCardPlanningGenerationAuthorizationFromEventHistory(
            repository,
            plan.generationSource,
            options.signal,
          );
      } catch (error: unknown) {
        if (error instanceof TestCardPlanningAuthorityError) {
          mapAuthorityError(error);
        }
        throw error;
      }
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
          if (raced === null) {
            let sources;
            try {
              sources = await loadTestCardPlanningSources(
                this.#workspaceRoot,
                context,
                options.signal,
              );
            } catch (error: unknown) {
              if (error instanceof TestCardPlanningAuthorityError) {
                mapAuthorityError(error);
              }
              throw error;
            }
            const current = createTestCard(
              {
                ...plan.testCard,
                testCardId: plan.testCard.testCardId,
                targetTaskId: plan.testCard.targetTaskId,
                testWindowId: sources.testWindowId,
                requirementGoal: sources.requirementGoal,
                routeSource: sources.routeSource,
              },
              { clock: () => plan.testCard.createdAt },
            );
            generationAuthorization = sources.generationAuthorization;
            if (
              context.loaded.aggregate.streamRevision !==
                plan.expectedStreamRevision ||
              canonicalizeJson(current, "$currentTestCard") !==
                canonicalizeJson(plan.testCard, "$planTestCard") ||
              canonicalizeJson(
                context.loaded.authority,
                "$currentAuthority",
              ) !== canonicalizeJson(plan.authority, "$planAuthority") ||
              canonicalizeJson(
                sources.generationSource,
                "$currentGenerationSource",
              ) !==
                canonicalizeJson(plan.generationSource, "$planGenerationSource")
            ) {
              fail("plan");
            }
            preflight(context, plan, generationAuthorization);
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
            generationAuthorization,
            options.signal,
          );
          eventAuthority = "current";
          result = Object.freeze({
            status:
              executed.result.disposition === "committed"
                ? ("created" as const)
                : ("already-created" as const),
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
                ? new TestCardPlanningServiceError(
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
          generationAuthorization,
          options.signal,
        );
        eventAuthority = "current";
        result = Object.freeze({
          status: "already-created" as const,
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
      if (error instanceof TestCardPlanningServiceError) {
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
