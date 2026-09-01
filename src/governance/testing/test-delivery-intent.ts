import type { WakeflowTestDeliveryIntent as TestDeliveryIntentWire } from "../../contracts/generated/governance/testing/test-delivery-intent.generated.js";
import { WAKEFLOW_TEST_DELIVERY_INTENT_SCHEMA } from "../../contracts/generated/governance/testing/test-delivery-intent.generated.js";
import { WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA } from "../../contracts/generated/governance/testing/test-execution-attempt.generated.js";
import { WAKEFLOW_TEST_CARD_SCHEMA } from "../../contracts/generated/governance/testing/test-card.generated.js";
import { WAKEFLOW_TASK_PACKAGE_SCHEMA } from "../../contracts/generated/governance/tasking/task-package.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import { WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA } from "../../contracts/generated/workspace/window-host-binding.generated.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../foundation/time/utc-instant.js";
import {
  readUtcWallClock,
  UtcWallClockError,
  type UtcWallClock,
} from "../../foundation/time/wall-clock.js";
import {
  WAKEFLOW_PRESENTATION_LANGUAGES,
  type WakeflowPresentationLanguage,
} from "../../configuration/wakeflow-config-v3.js";
import {
  WAKEFLOW_WORKSPACE_HOST_IDS,
  type WakeflowWorkspaceHostId,
} from "../../workspace/workspace-host-resource-profile.js";
import {
  parseWakeflowWindowHostBindingId,
  WakeflowWindowHostBindingIdError,
  type WakeflowWindowHostBindingId,
} from "../../workspace/window-runtime/wakeflow-window-host-binding-id.js";
import { demandFinalRootRef } from "../demand/publication/demand-publication-paths.js";
import {
  computeTaskPackageDigest,
  parseTaskPackage,
  TaskPackageError,
  type TestTaskPackage,
} from "../tasking/task-package.js";
import {
  taskPackageProjectionRef,
  TaskPackageProjectionPathError,
} from "../tasking/task-package-projection-paths.js";
import {
  parseWindowWorkClaimId,
  WindowWorkClaimError,
  type WindowWorkClaimId,
} from "../delivery/window-work-claim.js";
import {
  assertTestExecutionAttemptMatchesCard,
  parseTestExecutionAttempt,
  TestExecutionAttemptError,
  type TestExecutionAttempt,
} from "./test-execution-attempt.js";
import { parseTestCard, TestCardError, type TestCard } from "./test-card.js";

/**
 * Wakeflow Governance / Testing：一次logical Test attempt的不可变投递授权Intent。
 *
 * 首份Intent创建attempt；明确`rejected-before-effect`后可以为同一attempt追加一份新
 * Delivery授权。每份Intent都冻结Test TaskPackage、TestCard、当前Binding、语言和
 * environment setup指令，但不生成prompt/packet/envelope，不取得WindowWorkClaim，也不
 * 声称环境已经准备或宿主效果已经发生。
 */

const INTENT_KIND = "WakeflowTestDeliveryIntent" as const;
const INTENT_SCHEMA_VERSION = 1 as const;
const HOST_IDS = new Set<string>(WAKEFLOW_WORKSPACE_HOST_IDS);
const LANGUAGES = new Set<string>(WAKEFLOW_PRESENTATION_LANGUAGES);

/** 单个logical attempt允许保留的有界、追加型Delivery授权数量。 */
export const MAXIMUM_TEST_DELIVERY_AUTHORIZATIONS_PER_ATTEMPT = 32;

export interface TestDeliveryIntent {
  readonly kind: typeof INTENT_KIND;
  readonly schemaVersion: typeof INTENT_SCHEMA_VERSION;
  readonly targetDeliveryId: WakeflowDurableId<"target-delivery">;
  readonly programId: WakeflowDurableId<"program">;
  readonly configDigest: Sha256Digest;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly target: Readonly<{
    readonly targetTaskId: WakeflowDurableId<"target-task">;
    readonly taskPackageId: WakeflowDurableId<"task-package">;
    readonly taskPackageRef: PortableResourcePath;
    readonly taskPackageDigest: Sha256Digest;
    readonly testCard: Readonly<{
      readonly testCardId: WakeflowDurableId<"test-card">;
      readonly testCardDigest: Sha256Digest;
    }>;
  }>;
  readonly route: Readonly<{
    readonly hostId: WakeflowWorkspaceHostId;
    readonly windowId: WakeflowDurableId<"window">;
    readonly bindingId: WakeflowWindowHostBindingId;
  }>;
  readonly attempt: Readonly<TestExecutionAttempt>;
  readonly replacement?: Readonly<TestDeliveryReplacementAuthorization>;
  readonly language: WakeflowPresentationLanguage;
  readonly preparedAt: UtcInstant;
  readonly intentDigest: Sha256Digest;
}

export interface TestDeliveryReplacementAuthorization {
  readonly kind: "rejected-before-effect";
  readonly authorizationOrdinal: number;
  readonly previousDelivery: Readonly<{
    readonly targetDeliveryId: WakeflowDurableId<"target-delivery">;
    readonly intentDigest: Sha256Digest;
    readonly testDispatchPacketDigest: Sha256Digest;
  }>;
  readonly rejectedHostEffect: Readonly<{
    readonly claimId: WindowWorkClaimId;
    readonly claimDigest: Sha256Digest;
    readonly claimEventId: WakeflowDurableId<"demand-event">;
    readonly claimCommitId: WakeflowDurableId<"demand-event-commit">;
    readonly observationDigest: Sha256Digest;
    readonly observedAt: UtcInstant;
  }>;
}

export interface CreateTestDeliveryIntentInput {
  readonly targetDeliveryId: WakeflowDurableId<"target-delivery">;
  readonly taskPackage: Readonly<TestTaskPackage>;
  readonly testCard: Readonly<TestCard>;
  readonly attempt: Readonly<TestExecutionAttempt>;
  readonly hostId: WakeflowWorkspaceHostId;
  readonly bindingId: WakeflowWindowHostBindingId;
  readonly language: WakeflowPresentationLanguage;
  readonly replacement?: Readonly<TestDeliveryReplacementAuthorization>;
}

export interface CreateTestDeliveryIntentOptions {
  readonly clock?: UtcWallClock;
}

export type TestDeliveryIntentErrorReason =
  | "json"
  | "schema"
  | "identifier"
  | "digest"
  | "path"
  | "host"
  | "language"
  | "time"
  | "task-package"
  | "test-card"
  | "attempt"
  | "replacement"
  | "relation";

const ERROR_MESSAGES = {
  json: "Test Delivery Intent is not passive JSON data.",
  schema: "Test Delivery Intent does not satisfy its Schema.",
  identifier: "Test Delivery Intent contains an invalid typed identity.",
  digest: "Test Delivery Intent contains an invalid or inconsistent digest.",
  path: "Test Delivery Intent contains an invalid TaskPackage reference.",
  host: "Test Delivery Intent contains an unsupported host.",
  language: "Test Delivery Intent contains an unsupported language.",
  time: "Test Delivery Intent contains an invalid preparation time.",
  "task-package": "Test Delivery Intent requires a valid Test TaskPackage.",
  "test-card": "Test Delivery Intent requires a valid TestCard.",
  attempt: "Test Delivery Intent requires a valid logical Test attempt.",
  replacement: "Test Delivery Intent replacement authorization is invalid.",
  relation: "Test Delivery Intent sources do not close.",
} as const satisfies Readonly<Record<TestDeliveryIntentErrorReason, string>>;

/** Test Delivery Intent准入或来源闭合失败时的稳定错误。 */
export class TestDeliveryIntentError extends Error {
  override readonly name = "TestDeliveryIntentError";
  readonly code = "wakeflow-test-delivery-intent" as const;
  readonly reason: TestDeliveryIntentErrorReason;
  readonly path: string;

  constructor(reason: TestDeliveryIntentErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<TestDeliveryIntentWire>(
  WAKEFLOW_TEST_DELIVERY_INTENT_SCHEMA,
  [
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_TASK_PACKAGE_SCHEMA,
    WAKEFLOW_TEST_CARD_SCHEMA,
    WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
    WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA,
  ],
);

function fail(reason: TestDeliveryIntentErrorReason, path: string): never {
  throw new TestDeliveryIntentError(reason, path);
}

function id<
  Kind extends
    | "demand"
    | "program"
    | "target-delivery"
    | "target-task"
    | "task-package"
    | "test-card"
    | "demand-event"
    | "demand-event-commit"
    | "window",
>(value: unknown, kind: Kind, path: string): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
    throw error;
  }
}

function digest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path);
    throw error;
  }
}

function claimId(value: unknown, path: string): WindowWorkClaimId {
  try {
    return parseWindowWorkClaimId(value, path);
  } catch (error: unknown) {
    if (error instanceof WindowWorkClaimError) fail("replacement", path);
    throw error;
  }
}

function replacementAuthorization(
  value: NonNullable<TestDeliveryIntentWire["replacement"]>,
): Readonly<TestDeliveryReplacementAuthorization> {
  if (
    !Number.isSafeInteger(value.authorizationOrdinal) ||
    value.authorizationOrdinal < 2 ||
    value.authorizationOrdinal >
      MAXIMUM_TEST_DELIVERY_AUTHORIZATIONS_PER_ATTEMPT
  ) {
    fail("replacement", "$/replacement/authorizationOrdinal");
  }
  let observedAt: UtcInstant;
  try {
    observedAt = parseUtcInstant(
      value.rejectedHostEffect.observedAt,
      "$/replacement/rejectedHostEffect/observedAt",
    );
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) {
      fail("replacement", "$/replacement/rejectedHostEffect/observedAt");
    }
    throw error;
  }
  return Object.freeze({
    kind: "rejected-before-effect" as const,
    authorizationOrdinal: value.authorizationOrdinal,
    previousDelivery: Object.freeze({
      targetDeliveryId: id(
        value.previousDelivery.targetDeliveryId,
        "target-delivery",
        "$/replacement/previousDelivery/targetDeliveryId",
      ),
      intentDigest: digest(
        value.previousDelivery.intentDigest,
        "$/replacement/previousDelivery/intentDigest",
      ),
      testDispatchPacketDigest: digest(
        value.previousDelivery.testDispatchPacketDigest,
        "$/replacement/previousDelivery/testDispatchPacketDigest",
      ),
    }),
    rejectedHostEffect: Object.freeze({
      claimId: claimId(
        value.rejectedHostEffect.claimId,
        "$/replacement/rejectedHostEffect/claimId",
      ),
      claimDigest: digest(
        value.rejectedHostEffect.claimDigest,
        "$/replacement/rejectedHostEffect/claimDigest",
      ),
      claimEventId: id(
        value.rejectedHostEffect.claimEventId,
        "demand-event",
        "$/replacement/rejectedHostEffect/claimEventId",
      ),
      claimCommitId: id(
        value.rejectedHostEffect.claimCommitId,
        "demand-event-commit",
        "$/replacement/rejectedHostEffect/claimCommitId",
      ),
      observationDigest: digest(
        value.rejectedHostEffect.observationDigest,
        "$/replacement/rejectedHostEffect/observationDigest",
      ),
      observedAt,
    }),
  });
}

function packageRef(
  demandId: WakeflowDurableId<"demand">,
  taskPackageId: WakeflowDurableId<"task-package">,
): PortableResourcePath {
  try {
    return parsePortableResourcePath(
      `${demandFinalRootRef(demandId)}/${taskPackageProjectionRef(taskPackageId)}`,
    );
  } catch (error: unknown) {
    if (
      error instanceof PortableResourcePathError ||
      error instanceof TaskPackageProjectionPathError
    ) {
      fail("path", "$/target/taskPackageRef");
    }
    throw error;
  }
}

function basis(
  value: Omit<TestDeliveryIntent, "intentDigest">,
): Omit<TestDeliveryIntent, "intentDigest"> {
  return {
    kind: INTENT_KIND,
    schemaVersion: INTENT_SCHEMA_VERSION,
    targetDeliveryId: value.targetDeliveryId,
    programId: value.programId,
    configDigest: value.configDigest,
    demandId: value.demandId,
    target: value.target,
    route: value.route,
    attempt: value.attempt,
    ...(value.replacement === undefined
      ? {}
      : { replacement: value.replacement }),
    language: value.language,
    preparedAt: value.preparedAt,
  };
}

/** 严格解析并复验self-excluding digest的Test Delivery Intent。 */
export function parseTestDeliveryIntent(
  value: unknown,
): Readonly<TestDeliveryIntent> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$intent");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const validated = validateWire(json);
  if (!validated.ok) fail("schema", validated.path);
  const wire = validated.value;
  const demandId = id(wire.demandId, "demand", "$/demandId");
  const taskPackageId = id(
    wire.target.taskPackageId,
    "task-package",
    "$/target/taskPackageId",
  );
  let taskPackageRef: PortableResourcePath;
  try {
    taskPackageRef = parsePortableResourcePath(
      wire.target.taskPackageRef,
      "$/target/taskPackageRef",
    );
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) {
      fail("path", "$/target/taskPackageRef");
    }
    throw error;
  }
  if (taskPackageRef !== packageRef(demandId, taskPackageId)) {
    fail("relation", "$/target/taskPackageRef");
  }
  if (!HOST_IDS.has(wire.route.hostId)) fail("host", "$/route/hostId");
  if (!LANGUAGES.has(wire.language)) fail("language", "$/language");
  let bindingId: WakeflowWindowHostBindingId;
  try {
    bindingId = parseWakeflowWindowHostBindingId(
      wire.route.bindingId,
      "$/route/bindingId",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostBindingIdError) {
      fail("identifier", "$/route/bindingId");
    }
    throw error;
  }
  let attempt: Readonly<TestExecutionAttempt>;
  try {
    attempt = parseTestExecutionAttempt(wire.attempt);
  } catch (error: unknown) {
    if (error instanceof TestExecutionAttemptError)
      fail("attempt", "$/attempt");
    throw error;
  }
  let preparedAt: UtcInstant;
  try {
    preparedAt = parseUtcInstant(wire.preparedAt, "$/preparedAt");
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", "$/preparedAt");
    throw error;
  }
  const replacement =
    wire.replacement === undefined
      ? undefined
      : replacementAuthorization(wire.replacement);
  const intentBasis = basis({
    kind: INTENT_KIND,
    schemaVersion: INTENT_SCHEMA_VERSION,
    targetDeliveryId: id(
      wire.targetDeliveryId,
      "target-delivery",
      "$/targetDeliveryId",
    ),
    programId: id(wire.programId, "program", "$/programId"),
    configDigest: digest(wire.configDigest, "$/configDigest"),
    demandId,
    target: Object.freeze({
      targetTaskId: id(
        wire.target.targetTaskId,
        "target-task",
        "$/target/targetTaskId",
      ),
      taskPackageId,
      taskPackageRef,
      taskPackageDigest: digest(
        wire.target.taskPackageDigest,
        "$/target/taskPackageDigest",
      ),
      testCard: Object.freeze({
        testCardId: id(
          wire.target.testCard.testCardId,
          "test-card",
          "$/target/testCard/testCardId",
        ),
        testCardDigest: digest(
          wire.target.testCard.testCardDigest,
          "$/target/testCard/testCardDigest",
        ),
      }),
    }),
    route: Object.freeze({
      hostId: wire.route.hostId,
      windowId: id(wire.route.windowId, "window", "$/route/windowId"),
      bindingId,
    }),
    attempt,
    ...(replacement === undefined ? {} : { replacement }),
    language: wire.language,
    preparedAt,
  });
  if (
    intentBasis.attempt.targetTaskId !== intentBasis.target.targetTaskId ||
    intentBasis.attempt.testCard.testCardId !==
      intentBasis.target.testCard.testCardId ||
    intentBasis.attempt.testCard.testCardDigest !==
      intentBasis.target.testCard.testCardDigest ||
    (intentBasis.replacement !== undefined &&
      intentBasis.replacement.previousDelivery.targetDeliveryId ===
        intentBasis.targetDeliveryId)
  ) {
    fail("relation", "$/attempt");
  }
  const intentDigest = digest(wire.intentDigest, "$/intentDigest");
  if (computeCanonicalJsonSha256Digest(intentBasis) !== intentDigest) {
    fail("digest", "$/intentDigest");
  }
  return Object.freeze({ ...intentBasis, intentDigest });
}

function parseSources(
  taskPackageValue: unknown,
  testCardValue: unknown,
  attemptValue: unknown,
): Readonly<{
  readonly taskPackage: Readonly<TestTaskPackage>;
  readonly testCard: Readonly<TestCard>;
  readonly attempt: Readonly<TestExecutionAttempt>;
}> {
  let taskPackage;
  let testCard;
  let attempt;
  try {
    taskPackage = parseTaskPackage(taskPackageValue);
  } catch (error: unknown) {
    if (error instanceof TaskPackageError) fail("task-package", "$taskPackage");
    throw error;
  }
  if (taskPackage.workType !== "test") {
    fail("task-package", "$taskPackage");
  }
  try {
    testCard = parseTestCard(testCardValue);
  } catch (error: unknown) {
    if (error instanceof TestCardError) fail("test-card", "$testCard");
    throw error;
  }
  try {
    attempt = parseTestExecutionAttempt(attemptValue);
    assertTestExecutionAttemptMatchesCard(attempt, testCard);
  } catch (error: unknown) {
    if (error instanceof TestExecutionAttemptError) fail("attempt", "$attempt");
    throw error;
  }
  return Object.freeze({ taskPackage, testCard, attempt });
}

/** 使用当前时钟创建一份尚未产生环境或宿主效果的Test Delivery Intent。 */
export function createTestDeliveryIntent(
  input: Readonly<CreateTestDeliveryIntentInput>,
  options: CreateTestDeliveryIntentOptions = {},
): Readonly<TestDeliveryIntent> {
  const sources = parseSources(
    input.taskPackage,
    input.testCard,
    input.attempt,
  );
  let preparedAt: UtcInstant;
  try {
    preparedAt =
      options.clock === undefined
        ? readUtcWallClock()
        : readUtcWallClock(options.clock);
  } catch (error: unknown) {
    if (error instanceof UtcWallClockError) fail("time", "$clock");
    throw error;
  }
  const intentBasis = basis({
    kind: INTENT_KIND,
    schemaVersion: INTENT_SCHEMA_VERSION,
    targetDeliveryId: input.targetDeliveryId,
    programId: sources.taskPackage.programId,
    configDigest: sources.taskPackage.configDigest,
    demandId: sources.taskPackage.demandId,
    target: Object.freeze({
      targetTaskId: sources.taskPackage.targetTaskId,
      taskPackageId: sources.taskPackage.taskPackageId,
      taskPackageRef: packageRef(
        sources.taskPackage.demandId,
        sources.taskPackage.taskPackageId,
      ),
      taskPackageDigest: computeTaskPackageDigest(sources.taskPackage),
      testCard: sources.taskPackage.testCard,
    }),
    route: Object.freeze({
      hostId: input.hostId,
      windowId: sources.taskPackage.assignment.windowId,
      bindingId: input.bindingId,
    }),
    attempt: sources.attempt,
    ...(input.replacement === undefined
      ? {}
      : { replacement: input.replacement }),
    language: input.language,
    preparedAt,
  });
  const intent = parseTestDeliveryIntent({
    ...intentBasis,
    intentDigest: computeCanonicalJsonSha256Digest(intentBasis),
  });
  assertTestDeliveryIntentMatchesSources(
    intent,
    sources.taskPackage,
    sources.testCard,
  );
  return intent;
}

/** 复验Intent、TaskPackage、TestCard与attempt仍为同一授权关系。 */
export function assertTestDeliveryIntentMatchesSources(
  intentValue: unknown,
  taskPackageValue: unknown,
  testCardValue: unknown,
): void {
  const intent = parseTestDeliveryIntent(intentValue);
  const sources = parseSources(taskPackageValue, testCardValue, intent.attempt);
  if (
    intent.programId !== sources.taskPackage.programId ||
    intent.configDigest !== sources.taskPackage.configDigest ||
    intent.demandId !== sources.taskPackage.demandId ||
    intent.target.targetTaskId !== sources.taskPackage.targetTaskId ||
    intent.target.taskPackageId !== sources.taskPackage.taskPackageId ||
    intent.target.taskPackageRef !==
      packageRef(
        sources.taskPackage.demandId,
        sources.taskPackage.taskPackageId,
      ) ||
    intent.target.taskPackageDigest !==
      computeTaskPackageDigest(sources.taskPackage) ||
    intent.target.testCard.testCardId !== sources.testCard.testCardId ||
    intent.target.testCard.testCardDigest !== sources.testCard.testCardDigest ||
    intent.target.testCard.testCardId !==
      sources.taskPackage.testCard.testCardId ||
    intent.target.testCard.testCardDigest !==
      sources.taskPackage.testCard.testCardDigest ||
    intent.route.windowId !== sources.taskPackage.assignment.windowId
  ) {
    fail("relation", "$sources");
  }
  // preparedAt只保存审计观察；Task/Card/attempt/Observation来源由typed tuple与Event authority证明。
}

/** 返回Test Delivery Intent已经复验的Canonical摘要。 */
export function computeTestDeliveryIntentDigest(value: unknown): Sha256Digest {
  return parseTestDeliveryIntent(value).intentDigest;
}
