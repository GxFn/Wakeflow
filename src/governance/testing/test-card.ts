import type { WakeflowTestCard as TestCardWire } from "../../contracts/generated/governance/testing/test-card.generated.js";
import { WAKEFLOW_TEST_CARD_SCHEMA } from "../../contracts/generated/governance/testing/test-card.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
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
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
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
  parseLedgerAuthorityMemberReference,
  LedgerAuthorityStoreError,
  type LedgerAuthorityMemberReference,
} from "../ledger/ledger-authority-store.js";

/**
 * Wakeflow Governance / Testing：Controller冻结的真实环境Test执行合同。
 *
 * TestCard只描述已批准测试目标、Test Basis/环境Authority来源、实现接受基线和执行边界。它不创建
 * Test TaskPackage、不运行测试，也不允许Test修改目标、添加未映射步骤或使用未列出Skill。
 */

const TEST_CARD_ARTIFACT_KIND = "wakeflow-test-card" as const;
const TEST_CARD_SCHEMA_VERSION = 1 as const;
const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u;
const AUTHORED_CONTENT_FIELDS = Object.freeze([
  "allowedOperations",
  "allowedSkills",
  "approvedPlan",
  "cannotConclude",
  "controllerSelfChecks",
  "evidenceRequired",
  "failureMeans",
  "forbiddenOperations",
  "maxAttempts",
  "objectBoundary",
  "question",
  "realScenarioConditions",
  "setupPolicy",
  "stopConditions",
  "successMeans",
] as const);

export type TestCardSetupPolicy =
  "fresh-once" | "fresh-per-attempt" | "reuse-existing";

export interface TestCardImplementationBaseline {
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly taskPackageId: WakeflowDurableId<"task-package">;
  readonly taskPackageDigest: Sha256Digest;
  readonly repositoryId: WakeflowDurableId<"repository">;
  readonly windowId: WakeflowDurableId<"window">;
  readonly targetResultId: WakeflowDurableId<"target-result">;
  readonly resultDigest: Sha256Digest;
  readonly targetReviewDecisionId: WakeflowDurableId<"target-review-decision">;
  readonly decisionDigest: Sha256Digest;
}

/** TestCard用于追踪测试合同来源的非空、稳定有序Ledger成员集合。 */
export type TestCardBasisAuthorities = readonly [
  Readonly<LedgerAuthorityMemberReference>,
  ...Readonly<LedgerAuthorityMemberReference>[],
];

export interface TestCardRouteSource {
  readonly programId: WakeflowDurableId<"program">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly demandAuthorityDigest: Sha256Digest;
  readonly environmentAuthority: Readonly<LedgerAuthorityMemberReference>;
  readonly testBasisAuthorities: TestCardBasisAuthorities;
  readonly postAcceptanceRouteDigest: Sha256Digest;
  readonly reviewSnapshotDigest: Sha256Digest;
  readonly streamRevision: number;
  readonly stateDigest: Sha256Digest;
  readonly lastEventId: WakeflowDurableId<"demand-event">;
  readonly lastEventDigest: Sha256Digest;
  readonly implementationBaselines: readonly [
    Readonly<TestCardImplementationBaseline>,
    ...Readonly<TestCardImplementationBaseline>[],
  ];
}

export interface TestCardAuthoredContent {
  readonly approvedPlan: readonly [string, ...string[]];
  readonly allowedSkills: readonly string[];
  readonly setupPolicy: TestCardSetupPolicy;
  readonly maxAttempts: number;
  readonly question: string;
  readonly objectBoundary: string;
  readonly controllerSelfChecks: readonly [string, ...string[]];
  readonly realScenarioConditions: readonly [string, ...string[]];
  readonly successMeans: readonly [string, ...string[]];
  readonly failureMeans: readonly [string, ...string[]];
  readonly cannotConclude: readonly [string, ...string[]];
  readonly stopConditions: readonly [string, ...string[]];
  readonly evidenceRequired: readonly [string, ...string[]];
  readonly allowedOperations: readonly [string, ...string[]];
  readonly forbiddenOperations: readonly [string, ...string[]];
}

export interface TestCard extends TestCardAuthoredContent {
  readonly artifactKind: typeof TEST_CARD_ARTIFACT_KIND;
  readonly schemaVersion: typeof TEST_CARD_SCHEMA_VERSION;
  readonly testCardId: WakeflowDurableId<"test-card">;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly programId: WakeflowDurableId<"program">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly demandAuthorityDigest: Sha256Digest;
  readonly testWindowId: WakeflowDurableId<"window">;
  readonly environmentAuthority: Readonly<LedgerAuthorityMemberReference>;
  readonly testBasisAuthorities: TestCardBasisAuthorities;
  readonly source: Readonly<{
    readonly postAcceptanceRouteDigest: Sha256Digest;
    readonly reviewSnapshotDigest: Sha256Digest;
    readonly streamRevision: number;
    readonly stateDigest: Sha256Digest;
    readonly lastEventId: WakeflowDurableId<"demand-event">;
    readonly lastEventDigest: Sha256Digest;
  }>;
  readonly requirementGoal: string;
  readonly implementationBaselines: TestCardRouteSource["implementationBaselines"];
  readonly changeControl: "return-blocked-to-controller";
  readonly productSourcePolicy: "read-only";
  readonly createdAt: UtcInstant;
  readonly testCardDigest: Sha256Digest;
}

export interface CreateTestCardInput extends TestCardAuthoredContent {
  readonly testCardId: WakeflowDurableId<"test-card">;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly testWindowId: WakeflowDurableId<"window">;
  readonly requirementGoal: string;
  readonly routeSource: Readonly<TestCardRouteSource>;
}

export interface CreateTestCardOptions {
  readonly clock?: UtcWallClock;
}

export type TestCardErrorReason =
  | "json"
  | "schema"
  | "identifier"
  | "digest"
  | "time"
  | "text"
  | "token"
  | "authority"
  | "position"
  | "relation"
  | "representation";

const ERROR_MESSAGES = {
  json: "TestCard is not passive JSON data.",
  schema: "TestCard does not satisfy its Schema.",
  identifier: "TestCard contains an invalid typed identity.",
  digest: "TestCard contains an invalid or inconsistent digest.",
  time: "TestCard contains an invalid creation time.",
  text: "TestCard contains non-canonical text.",
  token: "TestCard contains an invalid or unsorted Skill token.",
  authority: "TestCard Authority references are invalid.",
  position: "TestCard contains an invalid Event Stream position.",
  relation: "TestCard sources are inconsistent.",
  representation: "TestCard bytes are not deterministic.",
} as const satisfies Readonly<Record<TestCardErrorReason, string>>;

/** TestCard准入、创建或确定性表示失败时的稳定错误。 */
export class TestCardError extends Error {
  override readonly name = "TestCardError";
  readonly code = "wakeflow-test-card" as const;
  readonly reason: TestCardErrorReason;
  readonly path: string;

  constructor(reason: TestCardErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<TestCardWire>(
  WAKEFLOW_TEST_CARD_SCHEMA,
  [
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
  ],
);

function fail(reason: TestCardErrorReason, path: string): never {
  throw new TestCardError(reason, path);
}

function id<
  Kind extends
    | "test-card"
    | "target-task"
    | "program"
    | "demand"
    | "window"
    | "task-package"
    | "repository"
    | "target-result"
    | "target-review-decision"
    | "demand-event",
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

function authorityReference(
  value: unknown,
  path: string,
): Readonly<LedgerAuthorityMemberReference> {
  try {
    return parseLedgerAuthorityMemberReference(value);
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityStoreError) fail("authority", path);
    throw error;
  }
}

function compareAuthorityMemberRefs(
  left: Readonly<LedgerAuthorityMemberReference>,
  right: Readonly<LedgerAuthorityMemberReference>,
): number {
  return left.memberRef < right.memberRef
    ? -1
    : left.memberRef > right.memberRef
      ? 1
      : 0;
}

function testBasisAuthorities(
  values: readonly unknown[],
  environmentAuthority: Readonly<LedgerAuthorityMemberReference>,
): TestCardBasisAuthorities {
  const parsed = values.map((value, index) =>
    authorityReference(value, `$/testBasisAuthorities/${index}`),
  );
  const first = parsed[0];
  if (first === undefined) fail("authority", "$/testBasisAuthorities");
  for (let index = 0; index < parsed.length; index += 1) {
    const current = parsed[index];
    const previous = parsed[index - 1];
    if (
      current === undefined ||
      current.role === "test-environment" ||
      current.memberRef === environmentAuthority.memberRef ||
      (previous !== undefined &&
        compareAuthorityMemberRefs(previous, current) >= 0)
    ) {
      fail("authority", `$/testBasisAuthorities/${index}`);
    }
  }
  return Object.freeze([first, ...parsed.slice(1)]);
}

function text(value: string, path: string): string {
  if (
    value.length === 0 ||
    value.length > 8192 ||
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

function skills(values: readonly string[]): readonly string[] {
  const parsed = values.map((value, index) => {
    if (!TOKEN_PATTERN.test(value)) fail("token", `$/allowedSkills/${index}`);
    return value;
  });
  if (
    new Set(parsed).size !== parsed.length ||
    parsed.some((value, index) => index > 0 && parsed[index - 1]! >= value)
  ) {
    fail("token", "$/allowedSkills");
  }
  return Object.freeze(parsed);
}

function authoredArray(value: unknown, path: string): readonly string[] {
  let values: readonly unknown[];
  try {
    values = parseDenseArray(value, 32, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("schema", path);
    throw error;
  }
  if (values.some((entry) => typeof entry !== "string")) {
    fail("schema", path);
  }
  return values as readonly string[];
}

/** 在读取UUID和时钟前严格准入Controller编写的TestCard内容。 */
export function parseTestCardAuthoredContent(
  value: unknown,
): Readonly<TestCardAuthoredContent> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$content");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("schema", "$content");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== AUTHORED_CONTENT_FIELDS.length ||
    keys.some((key, index) => key !== AUTHORED_CONTENT_FIELDS[index]) ||
    !Number.isSafeInteger(record.maxAttempts) ||
    (record.maxAttempts as number) < 1 ||
    (record.maxAttempts as number) > 10 ||
    !["fresh-once", "fresh-per-attempt", "reuse-existing"].includes(
      record.setupPolicy as string,
    ) ||
    typeof record.question !== "string" ||
    typeof record.objectBoundary !== "string"
  ) {
    fail("schema", "$content");
  }
  return Object.freeze({
    approvedPlan: nonEmptyTextList(
      authoredArray(record.approvedPlan, "$/approvedPlan"),
      "$/approvedPlan",
    ),
    allowedSkills: skills(
      [...authoredArray(record.allowedSkills, "$/allowedSkills")].sort(),
    ),
    setupPolicy: record.setupPolicy as TestCardSetupPolicy,
    maxAttempts: record.maxAttempts as number,
    question: text(record.question as string, "$/question"),
    objectBoundary: text(record.objectBoundary as string, "$/objectBoundary"),
    controllerSelfChecks: nonEmptyTextList(
      authoredArray(record.controllerSelfChecks, "$/controllerSelfChecks"),
      "$/controllerSelfChecks",
    ),
    realScenarioConditions: nonEmptyTextList(
      authoredArray(record.realScenarioConditions, "$/realScenarioConditions"),
      "$/realScenarioConditions",
    ),
    successMeans: nonEmptyTextList(
      authoredArray(record.successMeans, "$/successMeans"),
      "$/successMeans",
    ),
    failureMeans: nonEmptyTextList(
      authoredArray(record.failureMeans, "$/failureMeans"),
      "$/failureMeans",
    ),
    cannotConclude: nonEmptyTextList(
      authoredArray(record.cannotConclude, "$/cannotConclude"),
      "$/cannotConclude",
    ),
    stopConditions: nonEmptyTextList(
      authoredArray(record.stopConditions, "$/stopConditions"),
      "$/stopConditions",
    ),
    evidenceRequired: nonEmptyTextList(
      authoredArray(record.evidenceRequired, "$/evidenceRequired"),
      "$/evidenceRequired",
    ),
    allowedOperations: nonEmptyTextList(
      authoredArray(record.allowedOperations, "$/allowedOperations"),
      "$/allowedOperations",
    ),
    forbiddenOperations: nonEmptyTextList(
      authoredArray(record.forbiddenOperations, "$/forbiddenOperations"),
      "$/forbiddenOperations",
    ),
  });
}

function baseline(
  value: Readonly<TestCardWire["implementationBaselines"][number]>,
  path: string,
): Readonly<TestCardImplementationBaseline> {
  return Object.freeze({
    targetTaskId: id(value.targetTaskId, "target-task", `${path}/targetTaskId`),
    taskPackageId: id(
      value.taskPackageId,
      "task-package",
      `${path}/taskPackageId`,
    ),
    taskPackageDigest: digest(
      value.taskPackageDigest,
      `${path}/taskPackageDigest`,
    ),
    repositoryId: id(value.repositoryId, "repository", `${path}/repositoryId`),
    windowId: id(value.windowId, "window", `${path}/windowId`),
    targetResultId: id(
      value.targetResultId,
      "target-result",
      `${path}/targetResultId`,
    ),
    resultDigest: digest(value.resultDigest, `${path}/resultDigest`),
    targetReviewDecisionId: id(
      value.targetReviewDecisionId,
      "target-review-decision",
      `${path}/targetReviewDecisionId`,
    ),
    decisionDigest: digest(value.decisionDigest, `${path}/decisionDigest`),
  });
}

function testCardBasis(
  value: Omit<TestCard, "testCardDigest">,
): Omit<TestCard, "testCardDigest"> {
  return {
    artifactKind: TEST_CARD_ARTIFACT_KIND,
    schemaVersion: TEST_CARD_SCHEMA_VERSION,
    testCardId: value.testCardId,
    targetTaskId: value.targetTaskId,
    programId: value.programId,
    demandId: value.demandId,
    demandAuthorityDigest: value.demandAuthorityDigest,
    testWindowId: value.testWindowId,
    environmentAuthority: value.environmentAuthority,
    testBasisAuthorities: value.testBasisAuthorities,
    source: value.source,
    requirementGoal: value.requirementGoal,
    implementationBaselines: value.implementationBaselines,
    approvedPlan: value.approvedPlan,
    allowedSkills: value.allowedSkills,
    setupPolicy: value.setupPolicy,
    maxAttempts: value.maxAttempts,
    changeControl: "return-blocked-to-controller",
    productSourcePolicy: "read-only",
    question: value.question,
    objectBoundary: value.objectBoundary,
    controllerSelfChecks: value.controllerSelfChecks,
    realScenarioConditions: value.realScenarioConditions,
    successMeans: value.successMeans,
    failureMeans: value.failureMeans,
    cannotConclude: value.cannotConclude,
    stopConditions: value.stopConditions,
    evidenceRequired: value.evidenceRequired,
    allowedOperations: value.allowedOperations,
    forbiddenOperations: value.forbiddenOperations,
    createdAt: value.createdAt,
  };
}

export function parseTestCard(value: unknown): Readonly<TestCard> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$testCard");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const validated = validateWire(json);
  if (!validated.ok) fail("schema", validated.path);
  const wire = validated.value;
  const environmentAuthority = authorityReference(
    wire.environmentAuthority,
    "$/environmentAuthority",
  );
  if (environmentAuthority.role !== "test-environment") {
    fail("authority", "$/environmentAuthority/role");
  }
  const parsedTestBasisAuthorities = testBasisAuthorities(
    wire.testBasisAuthorities,
    environmentAuthority,
  );
  if (!Number.isSafeInteger(wire.source.streamRevision)) {
    fail("position", "$/source/streamRevision");
  }
  const parsedBaselines = wire.implementationBaselines.map((value, index) =>
    baseline(value, `$/implementationBaselines/${index}`),
  );
  const firstBaseline = parsedBaselines[0];
  if (
    firstBaseline === undefined ||
    new Set(parsedBaselines.map((entry) => entry.targetTaskId)).size !==
      parsedBaselines.length ||
    parsedBaselines.some(
      (entry, index) =>
        index > 0 &&
        parsedBaselines[index - 1]!.targetTaskId >= entry.targetTaskId,
    )
  ) {
    fail("relation", "$/implementationBaselines");
  }
  let createdAt: UtcInstant;
  try {
    createdAt = parseUtcInstant(wire.createdAt, "$/createdAt");
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", "$/createdAt");
    throw error;
  }
  const basis = testCardBasis({
    artifactKind: TEST_CARD_ARTIFACT_KIND,
    schemaVersion: TEST_CARD_SCHEMA_VERSION,
    testCardId: id(wire.testCardId, "test-card", "$/testCardId"),
    targetTaskId: id(wire.targetTaskId, "target-task", "$/targetTaskId"),
    programId: id(wire.programId, "program", "$/programId"),
    demandId: id(wire.demandId, "demand", "$/demandId"),
    demandAuthorityDigest: digest(
      wire.demandAuthorityDigest,
      "$/demandAuthorityDigest",
    ),
    testWindowId: id(wire.testWindowId, "window", "$/testWindowId"),
    environmentAuthority,
    testBasisAuthorities: parsedTestBasisAuthorities,
    source: Object.freeze({
      postAcceptanceRouteDigest: digest(
        wire.source.postAcceptanceRouteDigest,
        "$/source/postAcceptanceRouteDigest",
      ),
      reviewSnapshotDigest: digest(
        wire.source.reviewSnapshotDigest,
        "$/source/reviewSnapshotDigest",
      ),
      streamRevision: wire.source.streamRevision,
      stateDigest: digest(wire.source.stateDigest, "$/source/stateDigest"),
      lastEventId: id(
        wire.source.lastEventId,
        "demand-event",
        "$/source/lastEventId",
      ),
      lastEventDigest: digest(
        wire.source.lastEventDigest,
        "$/source/lastEventDigest",
      ),
    }),
    requirementGoal: text(wire.requirementGoal, "$/requirementGoal"),
    implementationBaselines: Object.freeze([
      firstBaseline,
      ...parsedBaselines.slice(1),
    ]),
    approvedPlan: nonEmptyTextList(wire.approvedPlan, "$/approvedPlan"),
    allowedSkills: skills(wire.allowedSkills),
    setupPolicy: wire.setupPolicy,
    maxAttempts: wire.maxAttempts,
    changeControl: "return-blocked-to-controller",
    productSourcePolicy: "read-only",
    question: text(wire.question, "$/question"),
    objectBoundary: text(wire.objectBoundary, "$/objectBoundary"),
    controllerSelfChecks: nonEmptyTextList(
      wire.controllerSelfChecks,
      "$/controllerSelfChecks",
    ),
    realScenarioConditions: nonEmptyTextList(
      wire.realScenarioConditions,
      "$/realScenarioConditions",
    ),
    successMeans: nonEmptyTextList(wire.successMeans, "$/successMeans"),
    failureMeans: nonEmptyTextList(wire.failureMeans, "$/failureMeans"),
    cannotConclude: nonEmptyTextList(wire.cannotConclude, "$/cannotConclude"),
    stopConditions: nonEmptyTextList(wire.stopConditions, "$/stopConditions"),
    evidenceRequired: nonEmptyTextList(
      wire.evidenceRequired,
      "$/evidenceRequired",
    ),
    allowedOperations: nonEmptyTextList(
      wire.allowedOperations,
      "$/allowedOperations",
    ),
    forbiddenOperations: nonEmptyTextList(
      wire.forbiddenOperations,
      "$/forbiddenOperations",
    ),
    createdAt,
  });
  const testCardDigest = digest(wire.testCardDigest, "$/testCardDigest");
  if (computeCanonicalJsonSha256Digest(basis) !== testCardDigest) {
    fail("digest", "$/testCardDigest");
  }
  return Object.freeze({ ...basis, testCardDigest });
}

export function createTestCard(
  input: Readonly<CreateTestCardInput>,
  options: CreateTestCardOptions = {},
): Readonly<TestCard> {
  const content = parseTestCardAuthoredContent({
    approvedPlan: input.approvedPlan,
    allowedSkills: input.allowedSkills,
    setupPolicy: input.setupPolicy,
    maxAttempts: input.maxAttempts,
    question: input.question,
    objectBoundary: input.objectBoundary,
    controllerSelfChecks: input.controllerSelfChecks,
    realScenarioConditions: input.realScenarioConditions,
    successMeans: input.successMeans,
    failureMeans: input.failureMeans,
    cannotConclude: input.cannotConclude,
    stopConditions: input.stopConditions,
    evidenceRequired: input.evidenceRequired,
    allowedOperations: input.allowedOperations,
    forbiddenOperations: input.forbiddenOperations,
  });
  let createdAt: UtcInstant;
  try {
    createdAt =
      options.clock === undefined
        ? readUtcWallClock()
        : readUtcWallClock(options.clock);
  } catch (error: unknown) {
    if (error instanceof UtcWallClockError) fail("time", "$clock");
    throw error;
  }
  const implementationBaselines = [
    ...input.routeSource.implementationBaselines,
  ].sort((left, right) =>
    left.targetTaskId < right.targetTaskId
      ? -1
      : left.targetTaskId > right.targetTaskId
        ? 1
        : 0,
  );
  const firstBaseline = implementationBaselines[0];
  if (firstBaseline === undefined) fail("relation", "$routeSource");
  const sortedTestBasisAuthorities = [
    ...input.routeSource.testBasisAuthorities,
  ].sort(compareAuthorityMemberRefs);
  const firstTestBasisAuthority = sortedTestBasisAuthorities[0];
  if (firstTestBasisAuthority === undefined) {
    fail("authority", "$routeSource/testBasisAuthorities");
  }
  const basis = testCardBasis({
    artifactKind: TEST_CARD_ARTIFACT_KIND,
    schemaVersion: TEST_CARD_SCHEMA_VERSION,
    testCardId: input.testCardId,
    targetTaskId: input.targetTaskId,
    programId: input.routeSource.programId,
    demandId: input.routeSource.demandId,
    demandAuthorityDigest: input.routeSource.demandAuthorityDigest,
    testWindowId: input.testWindowId,
    environmentAuthority: input.routeSource.environmentAuthority,
    testBasisAuthorities: Object.freeze([
      firstTestBasisAuthority,
      ...sortedTestBasisAuthorities.slice(1),
    ]),
    source: Object.freeze({
      postAcceptanceRouteDigest: input.routeSource.postAcceptanceRouteDigest,
      reviewSnapshotDigest: input.routeSource.reviewSnapshotDigest,
      streamRevision: input.routeSource.streamRevision,
      stateDigest: input.routeSource.stateDigest,
      lastEventId: input.routeSource.lastEventId,
      lastEventDigest: input.routeSource.lastEventDigest,
    }),
    requirementGoal: input.requirementGoal,
    implementationBaselines: Object.freeze([
      firstBaseline,
      ...implementationBaselines.slice(1),
    ]),
    approvedPlan: content.approvedPlan,
    allowedSkills: content.allowedSkills,
    setupPolicy: content.setupPolicy,
    maxAttempts: content.maxAttempts,
    changeControl: "return-blocked-to-controller",
    productSourcePolicy: "read-only",
    question: content.question,
    objectBoundary: content.objectBoundary,
    controllerSelfChecks: content.controllerSelfChecks,
    realScenarioConditions: content.realScenarioConditions,
    successMeans: content.successMeans,
    failureMeans: content.failureMeans,
    cannotConclude: content.cannotConclude,
    stopConditions: content.stopConditions,
    evidenceRequired: content.evidenceRequired,
    allowedOperations: content.allowedOperations,
    forbiddenOperations: content.forbiddenOperations,
    createdAt,
  });
  return parseTestCard({
    ...basis,
    testCardDigest: computeCanonicalJsonSha256Digest(basis),
  });
}

export function renderTestCard(value: unknown): string {
  return renderDeterministicJsonDocument(parseTestCard(value), "$testCard");
}

export function parseTestCardDocument(textValue: unknown): Readonly<TestCard> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(textValue, "$testCard");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", "$testCard");
    }
    throw error;
  }
  const testCard = parseTestCard(json);
  if (renderTestCard(testCard) !== textValue) {
    fail("representation", "$testCard");
  }
  return testCard;
}

export function computeTestCardDigest(value: unknown): Sha256Digest {
  return parseTestCard(value).testCardDigest;
}
