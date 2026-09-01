import { types } from "node:util";

import {
  WAKEFLOW_TEST_DELIVERY_PREPARATION_RESULT_SCHEMA,
  type WakeflowTestDeliveryPreparationResultV1 as TestDeliveryPreparationPublicResultWire,
} from "../../contracts/generated/entrypoints/wakeflow-test-delivery-preparation-result.generated.js";
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
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
  type WakeflowWorkspaceHostId,
  type WakeflowWorkspaceHostResourceProfile,
} from "../../workspace/workspace-host-resource-profile.js";
import {
  parseWakeflowWindowHostIdentityProfile,
  WakeflowWindowHostIdentityProfileError,
  type WakeflowWindowHostIdentityProfile,
} from "../../workspace/window-runtime/wakeflow-window-host-identity-profile.js";
import { computeDemandEventStreamCommitDigest } from "../demand/event-sourcing/demand-event-stream-commit.js";
import {
  parseTestDeliveryPreparationPublicRequest,
  TestDeliveryPreparationPublicContractError,
  type TestDeliveryPreparationPublicApplyRequest,
  WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
} from "./test-delivery-preparation-public-contract.js";
import {
  TestDeliveryPreparationService,
  TestDeliveryPreparationServiceError,
  type TestDeliveryPreparationApplyOptions,
  type TestDeliveryPreparationEventAuthority,
  type TestDeliveryPreparationPreviewOptions,
} from "./test-delivery-preparation-service.js";

/**
 * Wakeflow Governance / Testing：Test Delivery Preparation公共preview/apply边界。
 *
 * Coordinator固定当前Host Profile并投影owner提交的Event receipt。initial、rerun或
 * rejected-before-effect replacement只由Service根据当前Route派生；本层不创建
 * Dispatch Packet、WindowWorkClaim、Agent Host Action，也不执行任何宿主能力。
 */

export type TestDeliveryPreparationPublicResult =
  Readonly<TestDeliveryPreparationPublicResultWire>;

interface TestDeliveryPreparationPublicHostFacade {
  readonly hostId: WakeflowWorkspaceHostId;
  readonly resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly identityProfile: Readonly<WakeflowWindowHostIdentityProfile>;
}

export interface TestDeliveryPreparationPublicCoordinatorOptions {
  readonly preview?: TestDeliveryPreparationPreviewOptions;
  readonly apply?: TestDeliveryPreparationApplyOptions;
}

export type TestDeliveryPreparationPublicCoordinatorErrorReason =
  "host" | "root" | "privacy" | "preview" | "apply" | "output";

const ERROR_MESSAGES = {
  host: "Test Delivery Preparation public host composition is invalid.",
  root: "Test Delivery Preparation public workspace root is invalid.",
  privacy:
    "Test Delivery Preparation public content contains private root text.",
  preview: "Test Delivery Preparation public preview failed.",
  apply: "Test Delivery Preparation public apply failed.",
  output: "Test Delivery Preparation public result violated its boundary.",
} as const satisfies Readonly<
  Record<TestDeliveryPreparationPublicCoordinatorErrorReason, string>
>;

/** 公共Test Delivery Preparation失败时保留稳定分类和Event authority。 */
export class TestDeliveryPreparationPublicCoordinatorError extends Error {
  override readonly name = "TestDeliveryPreparationPublicCoordinatorError";
  readonly code =
    "wakeflow-test-delivery-preparation-public-coordinator" as const;
  readonly reason: TestDeliveryPreparationPublicCoordinatorErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly eventAuthority: TestDeliveryPreparationEventAuthority;

  constructor(
    reason: TestDeliveryPreparationPublicCoordinatorErrorReason,
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

const TEST_DELIVERY_PREPARATION_PUBLIC_MAXIMUM_RESULT_BYTES = 24 * 1024 * 1024;
const validateResult =
  createRuntimeJsonSchemaValidator<TestDeliveryPreparationPublicResultWire>(
    WAKEFLOW_TEST_DELIVERY_PREPARATION_RESULT_SCHEMA,
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
  reason: TestDeliveryPreparationPublicCoordinatorErrorReason,
  cause?: unknown,
  eventAuthority: TestDeliveryPreparationEventAuthority = cause instanceof
  TestDeliveryPreparationServiceError
    ? cause.eventAuthority
    : "unchanged",
): never {
  throw new TestDeliveryPreparationPublicCoordinatorError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    eventAuthority,
  );
}

function assertFacade(
  facade: Readonly<TestDeliveryPreparationPublicHostFacade>,
): Readonly<TestDeliveryPreparationPublicHostFacade> {
  try {
    if (
      typeof facade !== "object" ||
      facade === null ||
      types.isProxy(facade) ||
      !Object.isFrozen(facade)
    ) {
      fail("host");
    }
    const resourceProfile = parseWakeflowWorkspaceHostResourceProfile(
      facade.resourceProfile,
    );
    const identityProfile = parseWakeflowWindowHostIdentityProfile(
      facade.identityProfile,
    );
    if (
      facade.hostId !== resourceProfile.hostId ||
      facade.hostId !== identityProfile.hostId ||
      !resourceProfile.surfaces.windowIdentity
    ) {
      fail("host");
    }
    return Object.freeze({
      hostId: resourceProfile.hostId,
      resourceProfile,
      identityProfile,
    });
  } catch (error: unknown) {
    if (error instanceof TestDeliveryPreparationPublicCoordinatorError) {
      throw error;
    }
    if (
      error instanceof WakeflowWorkspaceHostResourceProfileError ||
      error instanceof WakeflowWindowHostIdentityProfileError
    ) {
      fail("host", error);
    }
    throw error;
  }
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
  eventAuthority: TestDeliveryPreparationEventAuthority,
): TestDeliveryPreparationPublicResult {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$result");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("output", error, eventAuthority);
    throw error;
  }
  if (
    encodeCanonicalJson(json, "$result").byteLength >
      TEST_DELIVERY_PREPARATION_PUBLIC_MAXIMUM_RESULT_BYTES ||
    containsPrivateText(json, privateValues) ||
    !validateResult(json).ok
  ) {
    fail("output", undefined, eventAuthority);
  }
  return json as unknown as TestDeliveryPreparationPublicResult;
}

function authorizationKind(
  intent: TestDeliveryPreparationPublicApplyRequest["plan"]["intent"],
): "initial" | "rerun" | "replacement" {
  if (intent.replacement !== undefined) return "replacement";
  return intent.attempt.mode;
}

function projectApplyResult(
  result: Awaited<ReturnType<TestDeliveryPreparationService["apply"]>>,
  request: TestDeliveryPreparationPublicApplyRequest,
) {
  const { commandResult, plan } = result;
  const event = commandResult.commit.events.find(
    (entry) =>
      entry.eventId === plan.eventId &&
      entry.eventType === "testing.test-delivery-prepared",
  );
  const target = commandResult.aggregate.state.targetTasks.find(
    (entry) => entry.targetTaskId === plan.targetTaskId,
  );
  const currentAttempt =
    target?.workType === "test" && target.phase === "test-delivery-prepared"
      ? target.testAttempts.at(-1)
      : undefined;
  const currentAuthorization = currentAttempt?.deliveryAuthorizations.at(-1);
  const committedStateMatches =
    result.disposition === "idempotent" ||
    (event !== undefined &&
      commandResult.aggregate.streamRevision === event.streamRevision &&
      target?.workType === "test" &&
      target.phase === "test-delivery-prepared" &&
      target.taskPackageId === plan.intent.target.taskPackageId &&
      target.taskPackageDigest === plan.intent.target.taskPackageDigest &&
      target.testCard.testCardId === plan.intent.target.testCard.testCardId &&
      target.testCard.testCardDigest ===
        plan.intent.target.testCard.testCardDigest &&
      target.currentDelivery.targetDeliveryId ===
        plan.intent.targetDeliveryId &&
      target.currentDelivery.intentDigest === plan.intent.intentDigest &&
      target.currentDelivery.hostId === plan.intent.route.hostId &&
      target.currentDelivery.bindingId === plan.intent.route.bindingId &&
      target.currentDelivery.testAttemptId ===
        plan.intent.attempt.testAttemptId &&
      currentAttempt?.attempt.testAttemptId ===
        plan.intent.attempt.testAttemptId &&
      currentAuthorization?.targetDeliveryId === plan.intent.targetDeliveryId &&
      currentAuthorization.intentDigest === plan.intent.intentDigest &&
      currentAuthorization.preparedAt === plan.intent.preparedAt &&
      commandResult.aggregate.stateDigest === event.resultingStateDigest);

  if (
    event === undefined ||
    !committedStateMatches ||
    result.eventAuthority !== "current" ||
    result.planDigest !== request.planDigest ||
    canonicalizeJson(plan, "$resultPlan") !==
      canonicalizeJson(request.plan, "$requestPlan") ||
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
    event.recordedAt !== plan.intent.preparedAt ||
    canonicalizeJson(event.data.intent, "$eventIntent") !==
      canonicalizeJson(plan.intent, "$planIntent") ||
    computeDemandEventStreamCommitDigest(commandResult.commit) !==
      result.commitDigest
  ) {
    fail("output", undefined, "current");
  }

  return {
    kind: "WakeflowTestDeliveryPreparationApplyResult" as const,
    schemaVersion: WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
    mode: "apply" as const,
    status: "completed" as const,
    disposition: result.disposition,
    eventAuthority: "current" as const,
    demandId: plan.demandId,
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
    testDelivery: {
      workType: "test" as const,
      authorizationKind: authorizationKind(plan.intent),
      targetTaskId: plan.intent.target.targetTaskId,
      taskPackageId: plan.intent.target.taskPackageId,
      taskPackageDigest: plan.intent.target.taskPackageDigest,
      testCard: plan.intent.target.testCard,
      testAttemptId: plan.intent.attempt.testAttemptId,
      attemptOrdinal: plan.intent.attempt.ordinal,
      targetDeliveryId: plan.intent.targetDeliveryId,
      intentDigest: plan.intent.intentDigest,
      hostId: plan.intent.route.hostId,
      windowId: plan.intent.route.windowId,
      bindingId: plan.intent.route.bindingId,
      phase: "test-delivery-prepared" as const,
    },
  };
}

/** 执行一次固定当前宿主的公共Test Delivery Preparation请求。 */
export async function executeTestDeliveryPreparationPublicRequest(
  facadeValue: Readonly<TestDeliveryPreparationPublicHostFacade>,
  value: unknown,
  options: TestDeliveryPreparationPublicCoordinatorOptions = {},
): Promise<TestDeliveryPreparationPublicResult> {
  const facade = assertFacade(facadeValue);
  const request = parseTestDeliveryPreparationPublicRequest(value);
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
  let eventAuthority: TestDeliveryPreparationEventAuthority = "unchanged";
  let result: TestDeliveryPreparationPublicResult | undefined;
  let failure: unknown;
  try {
    const service = new TestDeliveryPreparationService(
      root,
      facade.resourceProfile,
      facade.identityProfile,
    );
    if (request.mode === "preview") {
      let preview;
      try {
        preview = await service.preview(
          {
            demandId: request.demandId,
            targetTaskId: request.targetTaskId,
          },
          options.preview,
        );
      } catch (error: unknown) {
        if (error instanceof TestDeliveryPreparationServiceError) {
          fail("preview", error);
        }
        throw error;
      }
      if (
        preview.plan.demandId !== request.demandId ||
        preview.plan.targetTaskId !== request.targetTaskId
      ) {
        fail("output");
      }
      result = publicResult(
        {
          kind: "WakeflowTestDeliveryPreparationPreviewResult",
          schemaVersion:
            WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_SCHEMA_VERSION,
          tool: WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
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
        if (error instanceof TestDeliveryPreparationServiceError) {
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
    if (error instanceof TestDeliveryPreparationPublicCoordinatorError) {
      eventAuthority = error.eventAuthority;
    }
    failure = error;
  }

  try {
    await root.close();
  } catch (error: unknown) {
    if (failure === undefined) {
      failure = new TestDeliveryPreparationPublicCoordinatorError(
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

export { TestDeliveryPreparationPublicContractError };
