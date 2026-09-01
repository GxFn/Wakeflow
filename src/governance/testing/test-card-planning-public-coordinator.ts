import {
  WAKEFLOW_TEST_CARD_PLANNING_RESULT_SCHEMA,
  type WakeflowTestCardPlanningResultV1 as TestCardPlanningPublicResultWire,
} from "../../contracts/generated/entrypoints/wakeflow-test-card-planning-result.generated.js";
import {
  canonicalizeJson,
  encodeCanonicalJson,
} from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import { computeDemandEventStreamCommitDigest } from "../demand/event-sourcing/demand-event-stream-commit.js";
import {
  parseTestCardPlanningPublicRequest,
  TestCardPlanningPublicContractError,
  type TestCardPlanningPublicApplyRequest,
  WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_TOOL_NAME,
} from "./test-card-planning-public-contract.js";
import {
  TestCardPlanningService,
  TestCardPlanningServiceError,
  type TestCardPlanningApplyOptions,
  type TestCardPlanningEventAuthority,
  type TestCardPlanningPreviewOptions,
} from "./test-card-planning-service.js";

/**
 * Wakeflow Governance / Testing：TestCard Planning公共preview/apply边界。
 *
 * Coordinator只校验公共wire、隐私和Service结果闭合；TestCard Planning Service继续拥有
 * Test Basis、Route、Config、WorkClaim、Event与幂等准入。本模块不创建Test Task或执行宿主效果。
 */

export type TestCardPlanningPublicResult =
  Readonly<TestCardPlanningPublicResultWire>;

export interface TestCardPlanningPublicCoordinatorOptions {
  readonly preview?: TestCardPlanningPreviewOptions;
  readonly apply?: TestCardPlanningApplyOptions;
}

export type TestCardPlanningPublicCoordinatorErrorReason =
  "root" | "privacy" | "preview" | "apply" | "output";

const ERROR_MESSAGES = {
  root: "TestCard Planning public workspace root is invalid.",
  privacy: "TestCard Planning public content contains private root text.",
  preview: "TestCard Planning public preview failed.",
  apply: "TestCard Planning public apply failed.",
  output: "TestCard Planning public result violated its boundary.",
} as const satisfies Readonly<
  Record<TestCardPlanningPublicCoordinatorErrorReason, string>
>;

/** 公共TestCard Planning失败时保留稳定分类和Event authority。 */
export class TestCardPlanningPublicCoordinatorError extends Error {
  override readonly name = "TestCardPlanningPublicCoordinatorError";
  readonly code = "wakeflow-test-card-planning-public-coordinator" as const;
  readonly reason: TestCardPlanningPublicCoordinatorErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly eventAuthority: TestCardPlanningEventAuthority;

  constructor(
    reason: TestCardPlanningPublicCoordinatorErrorReason,
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

const TEST_CARD_PLANNING_PUBLIC_MAXIMUM_RESULT_BYTES = 24 * 1024 * 1024;
const validateResult =
  createRuntimeJsonSchemaValidator<TestCardPlanningPublicResultWire>(
    WAKEFLOW_TEST_CARD_PLANNING_RESULT_SCHEMA,
  );

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
  reason: TestCardPlanningPublicCoordinatorErrorReason,
  cause?: unknown,
  eventAuthority: TestCardPlanningEventAuthority = cause instanceof
  TestCardPlanningServiceError
    ? cause.eventAuthority
    : "unchanged",
): never {
  throw new TestCardPlanningPublicCoordinatorError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    eventAuthority,
  );
}

function containsPrivateText(
  value: unknown,
  privateValues: ReadonlySet<string>,
): boolean {
  if (typeof value === "string") {
    return [...privateValues].some((privateValue) =>
      value.includes(privateValue),
    );
  }
  if (value === null || typeof value !== "object") return false;
  return Object.values(value as Readonly<Record<string, unknown>>).some(
    (entry) => containsPrivateText(entry, privateValues),
  );
}

function publicResult(
  value: unknown,
  privateValues: ReadonlySet<string>,
  eventAuthority: TestCardPlanningEventAuthority,
): TestCardPlanningPublicResult {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$result");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("output", error, eventAuthority);
    throw error;
  }
  if (
    encodeCanonicalJson(json, "$result").byteLength >
      TEST_CARD_PLANNING_PUBLIC_MAXIMUM_RESULT_BYTES ||
    containsPrivateText(json, privateValues) ||
    !validateResult(json).ok
  ) {
    fail("output", undefined, eventAuthority);
  }
  return json as unknown as TestCardPlanningPublicResult;
}

function projectApplyResult(
  result: Awaited<ReturnType<TestCardPlanningService["apply"]>>,
  request: TestCardPlanningPublicApplyRequest,
) {
  const { commandResult, plan } = result;
  const event = commandResult.commit.events.find(
    (entry) =>
      entry.eventId === plan.eventId &&
      entry.eventType === "testing.test-card-created",
  );
  const committedStateMatches =
    result.disposition === "idempotent" ||
    (event !== undefined &&
      commandResult.aggregate.streamRevision === event.streamRevision &&
      commandResult.aggregate.state.currentTestCard?.testCardId ===
        plan.testCard.testCardId &&
      commandResult.aggregate.state.currentTestCard.testCardDigest ===
        plan.testCard.testCardDigest &&
      commandResult.aggregate.stateDigest === event.resultingStateDigest);
  if (
    event === undefined ||
    !committedStateMatches ||
    result.eventAuthority !== "current" ||
    result.planDigest !== request.planDigest ||
    canonicalizeJson(plan, "$resultPlan") !==
      canonicalizeJson(request.plan, "$requestPlan") ||
    (result.status === "created") !== (result.disposition === "committed") ||
    commandResult.commit.events.length !== 1 ||
    commandResult.commit.commitId !== plan.commitId ||
    commandResult.commit.demandId !== plan.demandId ||
    commandResult.commit.commandDigest !== result.commandDigest ||
    commandResult.commit.expectedStreamRevision !==
      plan.expectedStreamRevision ||
    commandResult.commit.firstStreamRevision !== event.streamRevision ||
    commandResult.commit.lastStreamRevision !== event.streamRevision ||
    event.streamRevision !== plan.expectedStreamRevision + 1 ||
    event.demandId !== plan.demandId ||
    event.recordedAt !== plan.testCard.createdAt ||
    canonicalizeJson(event.data.testCard, "$eventTestCard") !==
      canonicalizeJson(plan.testCard, "$planTestCard") ||
    canonicalizeJson(event.data.generationSource, "$eventGenerationSource") !==
      canonicalizeJson(plan.generationSource, "$planGenerationSource") ||
    computeDemandEventStreamCommitDigest(commandResult.commit) !==
      result.commitDigest
  ) {
    fail("output", undefined, "current");
  }
  return {
    kind: "WakeflowTestCardPlanningApplyResult" as const,
    schemaVersion: WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_TOOL_NAME,
    mode: "apply" as const,
    status: result.status,
    disposition: result.disposition,
    eventAuthority: "current" as const,
    testCard: plan.testCard,
    generationSource: plan.generationSource,
    planDigest: result.planDigest,
    commandDigest: result.commandDigest,
    event: {
      eventId: event.eventId,
      streamRevision: event.streamRevision,
    },
    commit: {
      commitId: commandResult.commit.commitId,
      commitSequence: commandResult.commit.commitSequence,
      commitDigest: result.commitDigest,
    },
    stateDigest: event.resultingStateDigest,
  };
}

/** 执行公共TestCard Planning preview或exact-plan apply。 */
export async function executeTestCardPlanningPublicRequest(
  value: unknown,
  options: TestCardPlanningPublicCoordinatorOptions = {},
): Promise<TestCardPlanningPublicResult> {
  const request = parseTestCardPlanningPublicRequest(value);
  let root: RootedDirectory;
  try {
    root = await RootedDirectory.open(request.root, "$request.root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root", error);
    throw error;
  }

  const privateValues = new Set(
    [request.root, root.absolutePath].filter((entry) => entry.length > 1),
  );
  let eventAuthority: TestCardPlanningEventAuthority = "unchanged";
  let result: TestCardPlanningPublicResult | undefined;
  let failure: unknown;
  try {
    const service = new TestCardPlanningService(root);
    if (request.mode === "preview") {
      if (containsPrivateText(request.testCard, privateValues)) fail("privacy");
      let preview;
      try {
        preview = await service.preview(
          {
            demandId: request.demandId,
            testCard: request.testCard,
          },
          options.preview,
        );
      } catch (error: unknown) {
        if (error instanceof TestCardPlanningServiceError) {
          fail("preview", error);
        }
        throw error;
      }
      if (
        preview.plan.demandId !== request.demandId ||
        preview.plan.testCard.demandId !== request.demandId
      ) {
        fail("output");
      }
      result = publicResult(
        {
          kind: "WakeflowTestCardPlanningPreviewResult",
          schemaVersion: WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_SCHEMA_VERSION,
          tool: WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_TOOL_NAME,
          mode: "preview",
          status: "ready",
          plan: preview.plan,
          planDigest: preview.planDigest,
        },
        privateValues,
        eventAuthority,
      );
    } else {
      if (containsPrivateText(request.plan, privateValues)) fail("privacy");
      let applied;
      try {
        applied = await service.apply(
          request.plan,
          request.planDigest,
          options.apply,
        );
        eventAuthority = "current";
      } catch (error: unknown) {
        if (error instanceof TestCardPlanningServiceError) {
          eventAuthority = error.eventAuthority;
          fail("apply", error);
        }
        throw error;
      }
      result = publicResult(
        projectApplyResult(applied, request),
        privateValues,
        eventAuthority,
      );
    }
  } catch (error: unknown) {
    if (error instanceof TestCardPlanningPublicCoordinatorError) {
      eventAuthority = error.eventAuthority;
    }
    failure = error;
  }

  try {
    await root.close();
  } catch (error: unknown) {
    if (failure === undefined) {
      failure = new TestCardPlanningPublicCoordinatorError(
        "root",
        ownString(error, "code"),
        ownString(error, "reason"),
        eventAuthority,
      );
    }
  }
  if (failure !== undefined) throw failure;
  if (result === undefined) fail("output", undefined, eventAuthority);
  return result;
}

export { TestCardPlanningPublicContractError };
