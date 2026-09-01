import type { WakeflowTestDispatchPacket as TestDispatchPacketWire } from "../../contracts/generated/governance/testing/test-dispatch-packet.generated.js";
import { WAKEFLOW_TEST_DISPATCH_PACKET_SCHEMA } from "../../contracts/generated/governance/testing/test-dispatch-packet.generated.js";
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
import { canonicalizeJson } from "../../foundation/data/canonical-json.js";
import {
  DeterministicJsonDocumentError,
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
} from "../../foundation/data/deterministic-json-document.js";
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
  parseTaskPackage,
  TaskPackageError,
  type TestTaskPackage,
} from "../tasking/task-package.js";
import {
  taskPackageProjectionRef,
  TaskPackageProjectionPathError,
} from "../tasking/task-package-projection-paths.js";
import {
  assertTestTaskPackageMatchesTestCard,
  TestTaskPackageError,
} from "./test-task-package.js";
import {
  assertTestDeliveryIntentMatchesSources,
  parseTestDeliveryIntent,
  TestDeliveryIntentError,
  type TestDeliveryIntent,
} from "./test-delivery-intent.js";
import {
  parseTestExecutionAttempt,
  TestExecutionAttemptError,
  type TestExecutionAttempt,
} from "./test-execution-attempt.js";
import { parseTestCard, TestCardError, type TestCard } from "./test-card.js";
import {
  createTestDispatchTaskBriefing,
  renderTestDispatchPortablePrompt,
  TEST_DISPATCH_REQUIRED_SKILLS,
  TestDispatchBriefingError,
  type TestDispatchTaskBriefing,
} from "./test-dispatch-briefing.js";
import {
  testCardProjectionRef,
  testDispatchPacketProjectionRef,
  TestDispatchProjectionPathError,
} from "./test-dispatch-projection-paths.js";

/**
 * Wakeflow Governance / Testing：一个已授权Test Delivery的目标窗口读取快照。
 *
 * packet只投影目标开始执行前必须同时看到的导航、briefing和Test execution contract。
 * 完整TaskPackage与TestCard保留在各自只创建投影中，Demand Event Stream仍是唯一
 * Authority。packet不取得WindowWorkClaim，不包含raw host handle，也不表示消息、环境或
 * Test执行已经发生。
 */

const PACKET_ARTIFACT_KIND = "wakeflow-test-dispatch-packet" as const;
const PACKET_SCHEMA_VERSION = 1 as const;
const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
const SKILL_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u;
const HOST_IDS = new Set<string>(WAKEFLOW_WORKSPACE_HOST_IDS);
const LANGUAGES = new Set<string>(WAKEFLOW_PRESENTATION_LANGUAGES);

export interface TestDispatchPacketSourceEvent {
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly eventDigest: Sha256Digest;
  readonly streamRevision: number;
}

export interface TestDispatchPacket {
  readonly artifactKind: typeof PACKET_ARTIFACT_KIND;
  readonly schemaVersion: typeof PACKET_SCHEMA_VERSION;
  readonly programId: WakeflowDurableId<"program">;
  readonly configDigest: Sha256Digest;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly targetDeliveryId: WakeflowDurableId<"target-delivery">;
  readonly source: Readonly<{
    readonly eventId: WakeflowDurableId<"demand-event">;
    readonly eventDigest: Sha256Digest;
    readonly streamRevision: number;
    readonly intentDigest: Sha256Digest;
  }>;
  readonly target: Readonly<{
    readonly targetTaskId: WakeflowDurableId<"target-task">;
    readonly taskPackage: Readonly<{
      readonly taskPackageId: WakeflowDurableId<"task-package">;
      readonly taskPackageRef: PortableResourcePath;
      readonly taskPackageDigest: Sha256Digest;
    }>;
    readonly testCard: Readonly<{
      readonly testCardId: WakeflowDurableId<"test-card">;
      readonly testCardRef: PortableResourcePath;
      readonly testCardDigest: Sha256Digest;
    }>;
  }>;
  readonly route: Readonly<{
    readonly hostId: WakeflowWorkspaceHostId;
    readonly windowId: WakeflowDurableId<"window">;
    readonly bindingId: WakeflowWindowHostBindingId;
  }>;
  readonly attempt: Readonly<TestExecutionAttempt>;
  readonly taskBriefing: Readonly<TestDispatchTaskBriefing>;
  readonly testContract: Readonly<{
    readonly executionContract: Readonly<{
      readonly requirementGoal: string;
      readonly approvedPlan: TestCard["approvedPlan"];
      readonly allowedSkills: TestCard["allowedSkills"];
      readonly environmentSetup: TestExecutionAttempt["environmentSetup"];
      readonly maxAttempts: number;
      readonly changeControl: "return-blocked-to-controller";
      readonly productSourcePolicy: "read-only";
    }>;
  }>;
  readonly language: WakeflowPresentationLanguage;
  readonly portablePrompt: string;
  readonly preparedAt: UtcInstant;
  readonly packetDigest: Sha256Digest;
}

export interface CreateTestDispatchPacketInput {
  readonly sourceEvent: Readonly<TestDispatchPacketSourceEvent>;
  readonly intent: Readonly<TestDeliveryIntent>;
  readonly taskPackage: Readonly<TestTaskPackage>;
  readonly testCard: Readonly<TestCard>;
}

export type TestDispatchPacketErrorReason =
  | "json"
  | "schema"
  | "identifier"
  | "digest"
  | "path"
  | "host"
  | "language"
  | "time"
  | "text"
  | "position"
  | "task-package"
  | "test-card"
  | "intent"
  | "attempt"
  | "prompt"
  | "relation"
  | "representation";

const ERROR_MESSAGES = {
  json: "Test dispatch packet is not passive JSON data.",
  schema: "Test dispatch packet does not satisfy its Schema.",
  identifier: "Test dispatch packet contains an invalid typed identity.",
  digest: "Test dispatch packet contains an invalid or inconsistent digest.",
  path: "Test dispatch packet contains an invalid projection reference.",
  host: "Test dispatch packet contains an unsupported host.",
  language: "Test dispatch packet contains an unsupported language.",
  time: "Test dispatch packet contains an invalid preparation time.",
  text: "Test dispatch packet contains non-canonical text.",
  position: "Test dispatch packet contains an invalid Event Stream position.",
  "task-package": "Test dispatch packet requires a valid Test TaskPackage.",
  "test-card": "Test dispatch packet requires a valid TestCard.",
  intent: "Test dispatch packet requires a valid Test Delivery Intent.",
  attempt: "Test dispatch packet contains an invalid Test attempt.",
  prompt:
    "Test dispatch packet prompt is invalid or not derived from its sources.",
  relation: "Test dispatch packet sources do not close.",
  representation: "Test dispatch packet bytes are not deterministic.",
} as const satisfies Readonly<Record<TestDispatchPacketErrorReason, string>>;

/** Test dispatch packet准入、派生或确定性表示失败时的稳定错误。 */
export class TestDispatchPacketError extends Error {
  override readonly name = "TestDispatchPacketError";
  readonly code = "wakeflow-test-dispatch-packet" as const;
  readonly reason: TestDispatchPacketErrorReason;
  readonly path: string;

  constructor(reason: TestDispatchPacketErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<TestDispatchPacketWire>(
  WAKEFLOW_TEST_DISPATCH_PACKET_SCHEMA,
  [
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_TASK_PACKAGE_SCHEMA,
    WAKEFLOW_TEST_CARD_SCHEMA,
    WAKEFLOW_TEST_DELIVERY_INTENT_SCHEMA,
    WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
    WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA,
  ],
);

function fail(reason: TestDispatchPacketErrorReason, path: string): never {
  throw new TestDispatchPacketError(reason, path);
}

function id<
  Kind extends
    | "program"
    | "demand"
    | "demand-event"
    | "target-delivery"
    | "target-task"
    | "task-package"
    | "test-card"
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

function resourcePath(value: unknown, path: string): PortableResourcePath {
  try {
    return parsePortableResourcePath(value, path);
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) fail("path", path);
    throw error;
  }
}

function text(value: string, path: string): string {
  if (
    value.length === 0 ||
    value.length > 32_768 ||
    !value.isWellFormed() ||
    value.normalize("NFC") !== value ||
    value.trim() !== value ||
    CONTROL_EXCEPT_LF_PATTERN.test(value)
  ) {
    fail("text", path);
  }
  return value;
}

function textList(values: readonly string[], path: string): readonly string[] {
  const parsed = values.map((value, index) => text(value, `${path}/${index}`));
  if (new Set(parsed).size !== parsed.length) fail("relation", path);
  return Object.freeze(parsed);
}

function nonEmptyTextList(
  values: readonly string[],
  path: string,
): readonly [string, ...string[]] {
  const parsed = textList(values, path);
  const first = parsed[0];
  if (first === undefined) fail("schema", path);
  return Object.freeze([first, ...parsed.slice(1)]);
}

function allowedSkills(values: readonly string[]): readonly string[] {
  const parsed = values.map((value, index) => {
    if (!SKILL_TOKEN_PATTERN.test(value)) {
      fail("text", `$/testContract/executionContract/allowedSkills/${index}`);
    }
    return value;
  });
  if (
    new Set(parsed).size !== parsed.length ||
    parsed.some((value, index) => index > 0 && parsed[index - 1]! >= value)
  ) {
    fail("relation", "$/testContract/executionContract/allowedSkills");
  }
  return Object.freeze(parsed);
}

function workspaceProjectionRef(
  demandId: WakeflowDurableId<"demand">,
  localRef: PortableResourcePath,
): PortableResourcePath {
  try {
    return parsePortableResourcePath(
      `${demandFinalRootRef(demandId)}/${localRef}`,
    );
  } catch (error: unknown) {
    if (
      error instanceof PortableResourcePathError ||
      error instanceof TestDispatchProjectionPathError
    ) {
      fail("path", "$projectionRef");
    }
    throw error;
  }
}

function testCardRef(
  demandId: WakeflowDurableId<"demand">,
  testCardId: WakeflowDurableId<"test-card">,
): PortableResourcePath {
  try {
    return workspaceProjectionRef(demandId, testCardProjectionRef(testCardId));
  } catch (error: unknown) {
    if (error instanceof TestDispatchProjectionPathError) {
      fail("path", "$/target/testCard/testCardRef");
    }
    throw error;
  }
}

function taskPackageRefFor(
  demandId: WakeflowDurableId<"demand">,
  taskPackageId: WakeflowDurableId<"task-package">,
): PortableResourcePath {
  try {
    return workspaceProjectionRef(
      demandId,
      taskPackageProjectionRef(taskPackageId),
    );
  } catch (error: unknown) {
    if (error instanceof TaskPackageProjectionPathError) {
      fail("path", "$/target/taskPackage/taskPackageRef");
    }
    throw error;
  }
}

function packetRef(
  demandId: WakeflowDurableId<"demand">,
  targetDeliveryId: WakeflowDurableId<"target-delivery">,
): PortableResourcePath {
  try {
    return workspaceProjectionRef(
      demandId,
      testDispatchPacketProjectionRef(targetDeliveryId),
    );
  } catch (error: unknown) {
    if (error instanceof TestDispatchProjectionPathError) {
      fail("path", "$packetRef");
    }
    throw error;
  }
}

function basis(
  value: Omit<TestDispatchPacket, "packetDigest">,
): Omit<TestDispatchPacket, "packetDigest"> {
  return {
    artifactKind: PACKET_ARTIFACT_KIND,
    schemaVersion: PACKET_SCHEMA_VERSION,
    programId: value.programId,
    configDigest: value.configDigest,
    demandId: value.demandId,
    targetDeliveryId: value.targetDeliveryId,
    source: value.source,
    target: value.target,
    route: value.route,
    attempt: value.attempt,
    taskBriefing: value.taskBriefing,
    testContract: value.testContract,
    language: value.language,
    portablePrompt: value.portablePrompt,
    preparedAt: value.preparedAt,
  };
}

/** 严格解析并复验self-excluding digest的Test dispatch packet。 */
export function parseTestDispatchPacket(
  value: unknown,
): Readonly<TestDispatchPacket> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$packet");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const validated = validateWire(json);
  if (!validated.ok) fail("schema", validated.path);
  const wire = validated.value;
  const demandId = id(wire.demandId, "demand", "$/demandId");
  const targetDeliveryId = id(
    wire.targetDeliveryId,
    "target-delivery",
    "$/targetDeliveryId",
  );
  const taskPackageId = id(
    wire.target.taskPackage.taskPackageId,
    "task-package",
    "$/target/taskPackage/taskPackageId",
  );
  const testCardId = id(
    wire.target.testCard.testCardId,
    "test-card",
    "$/target/testCard/testCardId",
  );
  const taskPackageRef = resourcePath(
    wire.target.taskPackage.taskPackageRef,
    "$/target/taskPackage/taskPackageRef",
  );
  const parsedTestCardRef = resourcePath(
    wire.target.testCard.testCardRef,
    "$/target/testCard/testCardRef",
  );
  if (parsedTestCardRef !== testCardRef(demandId, testCardId)) {
    fail("relation", "$/target/testCard/testCardRef");
  }
  if (taskPackageRef !== taskPackageRefFor(demandId, taskPackageId)) {
    fail("relation", "$/target/taskPackage/taskPackageRef");
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
  if (
    !Number.isSafeInteger(wire.source.streamRevision) ||
    wire.source.streamRevision < 1
  ) {
    fail("position", "$/source/streamRevision");
  }
  const completionValues = nonEmptyTextList(
    wire.taskBriefing.completionFocus,
    "$/taskBriefing/completionFocus",
  );
  const completion: readonly [string] | readonly [string, string] =
    completionValues.length === 1
      ? Object.freeze([completionValues[0]])
      : Object.freeze([completionValues[0], completionValues[1]!]);
  if (
    wire.taskBriefing.requiredSkills.length !==
      TEST_DISPATCH_REQUIRED_SKILLS.length ||
    wire.taskBriefing.requiredSkills.some(
      (value, index) => value !== TEST_DISPATCH_REQUIRED_SKILLS[index],
    )
  ) {
    fail("relation", "$/taskBriefing/requiredSkills");
  }
  const execution = wire.testContract.executionContract;
  const approvedPlan = nonEmptyTextList(
    execution.approvedPlan,
    "$/testContract/executionContract/approvedPlan",
  );
  if (
    !Number.isSafeInteger(execution.maxAttempts) ||
    execution.maxAttempts < 1 ||
    execution.maxAttempts > 10 ||
    canonicalizeJson(
      execution.environmentSetup,
      "$executionEnvironmentSetup",
    ) !== canonicalizeJson(attempt.environmentSetup, "$attemptEnvironmentSetup")
  ) {
    fail("relation", "$/testContract/executionContract");
  }
  const packetBasis = basis({
    artifactKind: PACKET_ARTIFACT_KIND,
    schemaVersion: PACKET_SCHEMA_VERSION,
    programId: id(wire.programId, "program", "$/programId"),
    configDigest: digest(wire.configDigest, "$/configDigest"),
    demandId,
    targetDeliveryId,
    source: Object.freeze({
      eventId: id(wire.source.eventId, "demand-event", "$/source/eventId"),
      eventDigest: digest(wire.source.eventDigest, "$/source/eventDigest"),
      streamRevision: wire.source.streamRevision,
      intentDigest: digest(wire.source.intentDigest, "$/source/intentDigest"),
    }),
    target: Object.freeze({
      targetTaskId: id(
        wire.target.targetTaskId,
        "target-task",
        "$/target/targetTaskId",
      ),
      taskPackage: Object.freeze({
        taskPackageId,
        taskPackageRef,
        taskPackageDigest: digest(
          wire.target.taskPackage.taskPackageDigest,
          "$/target/taskPackage/taskPackageDigest",
        ),
      }),
      testCard: Object.freeze({
        testCardId,
        testCardRef: parsedTestCardRef,
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
    taskBriefing: Object.freeze({
      workType: "test" as const,
      objective: text(wire.taskBriefing.objective, "$/taskBriefing/objective"),
      completionFocus: completion,
      priorityContext: text(
        wire.taskBriefing.priorityContext,
        "$/taskBriefing/priorityContext",
      ),
      criticalBoundary: Object.freeze({
        kind: wire.taskBriefing.criticalBoundary.kind,
        value: text(
          wire.taskBriefing.criticalBoundary.value,
          "$/taskBriefing/criticalBoundary/value",
        ),
      }),
      requiredSkills: TEST_DISPATCH_REQUIRED_SKILLS,
    }),
    testContract: Object.freeze({
      executionContract: Object.freeze({
        requirementGoal: text(
          execution.requirementGoal,
          "$/testContract/executionContract/requirementGoal",
        ),
        approvedPlan,
        allowedSkills: allowedSkills(execution.allowedSkills),
        environmentSetup: attempt.environmentSetup,
        maxAttempts: execution.maxAttempts,
        changeControl: "return-blocked-to-controller" as const,
        productSourcePolicy: "read-only" as const,
      }),
    }),
    language: wire.language,
    portablePrompt: text(wire.portablePrompt, "$/portablePrompt"),
    preparedAt,
  });
  if (
    packetBasis.attempt.targetTaskId !== packetBasis.target.targetTaskId ||
    packetBasis.attempt.testCard.testCardId !==
      packetBasis.target.testCard.testCardId ||
    packetBasis.attempt.testCard.testCardDigest !==
      packetBasis.target.testCard.testCardDigest
  ) {
    fail("relation", "$/attempt");
  }
  const packetDigest = digest(wire.packetDigest, "$/packetDigest");
  if (computeCanonicalJsonSha256Digest(packetBasis) !== packetDigest) {
    fail("digest", "$/packetDigest");
  }
  return Object.freeze({ ...packetBasis, packetDigest });
}

function parseSources(
  intentValue: unknown,
  taskPackageValue: unknown,
  testCardValue: unknown,
): Readonly<{
  readonly intent: Readonly<TestDeliveryIntent>;
  readonly taskPackage: Readonly<TestTaskPackage>;
  readonly testCard: Readonly<TestCard>;
}> {
  let intent: Readonly<TestDeliveryIntent>;
  let taskPackage;
  let testCard;
  try {
    intent = parseTestDeliveryIntent(intentValue);
  } catch (error: unknown) {
    if (error instanceof TestDeliveryIntentError) fail("intent", "$intent");
    throw error;
  }
  try {
    taskPackage = parseTaskPackage(taskPackageValue);
  } catch (error: unknown) {
    if (error instanceof TaskPackageError) fail("task-package", "$taskPackage");
    throw error;
  }
  if (taskPackage.workType !== "test") fail("task-package", "$taskPackage");
  try {
    testCard = parseTestCard(testCardValue);
    assertTestTaskPackageMatchesTestCard(taskPackage, testCard);
    assertTestDeliveryIntentMatchesSources(intent, taskPackage, testCard);
  } catch (error: unknown) {
    if (error instanceof TestCardError) fail("test-card", "$testCard");
    if (error instanceof TestTaskPackageError) {
      fail("task-package", "$taskPackage");
    }
    if (error instanceof TestDeliveryIntentError) fail("intent", "$intent");
    throw error;
  }
  return Object.freeze({ intent, taskPackage, testCard });
}

function parseSourceEvent(
  value: Readonly<TestDispatchPacketSourceEvent>,
): Readonly<TestDispatchPacketSourceEvent> {
  if (!Number.isSafeInteger(value.streamRevision) || value.streamRevision < 1) {
    fail("position", "$sourceEvent/streamRevision");
  }
  return Object.freeze({
    eventId: id(value.eventId, "demand-event", "$sourceEvent/eventId"),
    eventDigest: digest(value.eventDigest, "$sourceEvent/eventDigest"),
    streamRevision: value.streamRevision,
  });
}

/** 从prepared Event及其精确Card/Package来源确定性派生目标窗口packet。 */
export function createTestDispatchPacket(
  input: Readonly<CreateTestDispatchPacketInput>,
): Readonly<TestDispatchPacket> {
  const sources = parseSources(input.intent, input.taskPackage, input.testCard);
  const sourceEvent = parseSourceEvent(input.sourceEvent);
  return createTestDispatchPacketUnchecked(sources, sourceEvent);
}

/** 复验packet仍是同一prepared Event、Intent、TaskPackage和TestCard的唯一投影。 */
export function assertTestDispatchPacketMatchesSources(
  packetValue: unknown,
  intentValue: unknown,
  taskPackageValue: unknown,
  testCardValue: unknown,
  sourceEventValue: Readonly<TestDispatchPacketSourceEvent>,
): void {
  const packet = parseTestDispatchPacket(packetValue);
  const expected = createTestDispatchPacketUnchecked(
    parseSources(intentValue, taskPackageValue, testCardValue),
    parseSourceEvent(sourceEventValue),
  );
  if (
    canonicalizeJson(packet, "$packet") !==
    canonicalizeJson(expected, "$expectedPacket")
  ) {
    fail("relation", "$sources");
  }
}

function createTestDispatchPacketUnchecked(
  sources: Readonly<{
    readonly intent: Readonly<TestDeliveryIntent>;
    readonly taskPackage: Readonly<TestTaskPackage>;
    readonly testCard: Readonly<TestCard>;
  }>,
  sourceEvent: Readonly<TestDispatchPacketSourceEvent>,
): Readonly<TestDispatchPacket> {
  const cardPath = testCardRef(
    sources.intent.demandId,
    sources.testCard.testCardId,
  );
  const currentPacketRef = packetRef(
    sources.intent.demandId,
    sources.intent.targetDeliveryId,
  );
  const briefing = createTestDispatchTaskBriefing(sources.taskPackage);
  let portablePrompt: string;
  try {
    portablePrompt = renderTestDispatchPortablePrompt({
      packetRef: currentPacketRef,
      taskPackageRef: sources.intent.target.taskPackageRef,
      testCardRef: cardPath,
      targetTaskId: sources.intent.target.targetTaskId,
      windowId: sources.intent.route.windowId,
      briefing,
      language: sources.intent.language,
    });
  } catch (error: unknown) {
    if (error instanceof TestDispatchBriefingError) {
      fail("prompt", "$portablePrompt");
    }
    throw error;
  }
  const packetBasis = basis({
    artifactKind: PACKET_ARTIFACT_KIND,
    schemaVersion: PACKET_SCHEMA_VERSION,
    programId: sources.intent.programId,
    configDigest: sources.intent.configDigest,
    demandId: sources.intent.demandId,
    targetDeliveryId: sources.intent.targetDeliveryId,
    source: Object.freeze({
      ...sourceEvent,
      intentDigest: sources.intent.intentDigest,
    }),
    target: Object.freeze({
      targetTaskId: sources.intent.target.targetTaskId,
      taskPackage: Object.freeze({
        taskPackageId: sources.intent.target.taskPackageId,
        taskPackageRef: sources.intent.target.taskPackageRef,
        taskPackageDigest: sources.intent.target.taskPackageDigest,
      }),
      testCard: Object.freeze({
        testCardId: sources.testCard.testCardId,
        testCardRef: cardPath,
        testCardDigest: sources.testCard.testCardDigest,
      }),
    }),
    route: sources.intent.route,
    attempt: sources.intent.attempt,
    taskBriefing: briefing,
    testContract: Object.freeze({
      executionContract: Object.freeze({
        requirementGoal: sources.testCard.requirementGoal,
        approvedPlan: sources.testCard.approvedPlan,
        allowedSkills: sources.testCard.allowedSkills,
        environmentSetup: sources.intent.attempt.environmentSetup,
        maxAttempts: sources.testCard.maxAttempts,
        changeControl: sources.testCard.changeControl,
        productSourcePolicy: sources.testCard.productSourcePolicy,
      }),
    }),
    language: sources.intent.language,
    portablePrompt,
    preparedAt: sources.intent.preparedAt,
  });
  return parseTestDispatchPacket({
    ...packetBasis,
    packetDigest: computeCanonicalJsonSha256Digest(packetBasis),
  });
}

/** 以Wakeflow确定性JSON文档格式渲染packet投影。 */
export function renderTestDispatchPacket(value: unknown): string {
  return renderDeterministicJsonDocument(
    parseTestDispatchPacket(value),
    "$packet",
  );
}

/** 解析并复验packet的确定性磁盘表示。 */
export function parseTestDispatchPacketDocument(
  textValue: unknown,
): Readonly<TestDispatchPacket> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(textValue, "$packet");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", "$packet");
    }
    throw error;
  }
  const packet = parseTestDispatchPacket(json);
  if (renderTestDispatchPacket(packet) !== textValue) {
    fail("representation", "$packet");
  }
  return packet;
}

/** 返回已经完整复验的Test dispatch packet摘要。 */
export function computeTestDispatchPacketDigest(value: unknown): Sha256Digest {
  return parseTestDispatchPacket(value).packetDigest;
}
