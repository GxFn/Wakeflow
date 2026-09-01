import type { WakeflowTaskPackage as TaskPackageWire } from "../../contracts/generated/governance/tasking/task-package.generated.js";
import { WAKEFLOW_TASK_PACKAGE_SCHEMA } from "../../contracts/generated/governance/tasking/task-package.generated.js";
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
  LedgerAuthorityStoreError,
  parseLedgerAuthorityMemberReference,
  type LedgerAuthorityMemberReference,
} from "../ledger/ledger-authority-store.js";

/**
 * Wakeflow Governance / Tasking：一个 implementation Target Task 的不可变执行合同。
 *
 * TaskPackage 把已发布 Demand 的权威摘要、准入时 Config 摘要、产品仓库与窗口分配、
 * 执行边界和验收锚点固定为一次任务规划事实。它不代表任务已发送、窗口已占用或工作
 * 已被接受；这些状态分别由后续 Demand Event Sourcing、Delivery、Lease 和 Review
 * 职责所有者维护。
 *
 * `selectedAuthorityRefs` 直接复用 Ledger 的完整成员引用，避免创建第二套 ref/digest
 * 结构。这里仅验证可移植合同与局部唯一性；引用是否属于指定 Demand 的完整 Authority、
 * `windowId` 是否指向 `repositoryId`，以及同仓库活动 lineage 约束由 Tasking service
 * 在追加业务事件前验证。
 */

const TASK_PACKAGE_ARTIFACT_KIND = "wakeflow-task-package" as const;
const TASK_PACKAGE_SCHEMA_VERSION = 1 as const;

export type TaskPackageWorkType = "implementation" | "test";
export type TaskPackageCommitExpectation = "commit" | "leave-uncommitted";

export interface ImplementationTaskPackageAssignment {
  readonly repositoryId: WakeflowDurableId<"repository">;
  readonly windowId: WakeflowDurableId<"window">;
}

export interface TestTaskPackageAssignment {
  readonly windowId: WakeflowDurableId<"window">;
}

export interface TaskPackageBoundaries {
  readonly inScope: readonly [string, ...string[]];
  readonly outOfScope: readonly string[];
  readonly forbidden: readonly string[];
}

export interface TaskPackageAcceptanceAnchor {
  readonly anchorId: string;
  readonly claim: string;
  readonly probe: string;
  readonly expected: string;
}

export interface TaskPackageTestCardTuple {
  readonly testCardId: WakeflowDurableId<"test-card">;
  readonly testCardDigest: Sha256Digest;
}

interface TaskPackageBase {
  readonly artifactKind: typeof TASK_PACKAGE_ARTIFACT_KIND;
  readonly schemaVersion: typeof TASK_PACKAGE_SCHEMA_VERSION;
  readonly programId: WakeflowDurableId<"program">;
  readonly configDigest: Sha256Digest;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly demandAuthorityDigest: Sha256Digest;
  readonly taskPackageId: WakeflowDurableId<"task-package">;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly createdAt: UtcInstant;
  readonly objective: string;
  readonly confirmedContext: readonly [string, ...string[]];
  readonly selectedAuthorityRefs: readonly [
    Readonly<LedgerAuthorityMemberReference>,
    ...Readonly<LedgerAuthorityMemberReference>[],
  ];
  readonly boundaries: Readonly<TaskPackageBoundaries>;
  readonly completionExpectations: readonly [string, ...string[]];
}

export interface ImplementationTaskPackage extends TaskPackageBase {
  readonly assignment: Readonly<ImplementationTaskPackageAssignment>;
  readonly workType: "implementation";
  readonly commitExpectation: TaskPackageCommitExpectation;
  readonly acceptanceAnchors: readonly [
    Readonly<TaskPackageAcceptanceAnchor>,
    ...Readonly<TaskPackageAcceptanceAnchor>[],
  ];
}

export interface TestTaskPackage extends TaskPackageBase {
  readonly assignment: Readonly<TestTaskPackageAssignment>;
  readonly workType: "test";
  readonly acceptanceAnchors: readonly [];
  readonly testCard: Readonly<TaskPackageTestCardTuple>;
}

export type TaskPackage = ImplementationTaskPackage | TestTaskPackage;

export interface CreateTaskPackageOptions {
  readonly clock?: UtcWallClock;
}

/** 公共 Planning preview 允许调用方填写、但不允许控制身份/权威/时间的字段。 */
export type TaskPackageContentDraft = Readonly<
  Pick<
    ImplementationTaskPackage,
    | "acceptanceAnchors"
    | "assignment"
    | "boundaries"
    | "commitExpectation"
    | "completionExpectations"
    | "confirmedContext"
    | "objective"
    | "selectedAuthorityRefs"
    | "workType"
  >
>;

/** 尚未由 Planning owner 解析 Authority member 选择的调用方内容字段。 */
export type TaskPackageAuthoredContentDraft = Readonly<
  Omit<TaskPackageContentDraft, "selectedAuthorityRefs">
>;

export type TaskPackageErrorReason =
  | "input"
  | "json"
  | "schema"
  | "identifier"
  | "digest"
  | "time"
  | "text"
  | "reference"
  | "relation"
  | "representation";

const ERROR_MESSAGES = {
  input: "Task package input is invalid.",
  json: "Task package is not passive JSON data.",
  schema: "Task package does not satisfy its portable Schema.",
  identifier: "Task package contains an invalid typed identity.",
  digest: "Task package contains an invalid authority digest.",
  time: "Task package contains an invalid creation time.",
  text: "Task package contains non-canonical text.",
  reference: "Task package contains an invalid Ledger authority reference.",
  relation: "Task package contains inconsistent local relationships.",
  representation:
    "Task package bytes are not its deterministic domain representation.",
} as const satisfies Readonly<Record<TaskPackageErrorReason, string>>;

/** TaskPackage 准入或确定性表示失败时返回的稳定、脱敏错误。 */
export class TaskPackageError extends Error {
  override readonly name = "TaskPackageError";
  readonly code = "wakeflow-task-package" as const;
  readonly reason: TaskPackageErrorReason;
  readonly path: string;

  constructor(reason: TaskPackageErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<TaskPackageWire>(
  WAKEFLOW_TASK_PACKAGE_SCHEMA,
  [
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
  ],
);
const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
const DRAFT_FIELDS = Object.freeze([
  "acceptanceAnchors",
  "assignment",
  "boundaries",
  "commitExpectation",
  "completionExpectations",
  "configDigest",
  "confirmedContext",
  "demandAuthorityDigest",
  "demandId",
  "objective",
  "programId",
  "selectedAuthorityRefs",
  "targetTaskId",
  "taskPackageId",
  "workType",
] as const);
const TEST_DRAFT_FIELDS = Object.freeze([
  "acceptanceAnchors",
  "assignment",
  "boundaries",
  "completionExpectations",
  "configDigest",
  "confirmedContext",
  "demandAuthorityDigest",
  "demandId",
  "objective",
  "programId",
  "selectedAuthorityRefs",
  "targetTaskId",
  "taskPackageId",
  "testCard",
  "workType",
] as const);
const CONTENT_DRAFT_FIELDS = Object.freeze([
  "acceptanceAnchors",
  "assignment",
  "boundaries",
  "commitExpectation",
  "completionExpectations",
  "confirmedContext",
  "objective",
  "selectedAuthorityRefs",
  "workType",
] as const);
const AUTHORED_CONTENT_DRAFT_FIELDS = Object.freeze([
  "acceptanceAnchors",
  "assignment",
  "boundaries",
  "commitExpectation",
  "completionExpectations",
  "confirmedContext",
  "objective",
  "workType",
] as const);
const DRAFT_VALIDATION_INSTANT = parseUtcInstant(
  "1970-01-01T00:00:00.000Z",
  "$draftValidationInstant",
);
const CONTENT_DRAFT_VALIDATION_DIGEST = parseSha256Digest(
  `sha256:${"0".repeat(64)}`,
  "$contentDraftValidationDigest",
);
const CONTENT_DRAFT_PROGRAM_ID = parseWakeflowDurableIdOfKind(
  "program_00000000-0000-4000-8000-000000000000",
  "program",
  "$contentDraftProgramId",
);
const CONTENT_DRAFT_DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_00000000-0000-4000-8000-000000000001",
  "demand",
  "$contentDraftDemandId",
);
const CONTENT_DRAFT_TASK_PACKAGE_ID = parseWakeflowDurableIdOfKind(
  "task-package_00000000-0000-4000-8000-000000000002",
  "task-package",
  "$contentDraftTaskPackageId",
);
const CONTENT_DRAFT_TARGET_TASK_ID = parseWakeflowDurableIdOfKind(
  "target-task_00000000-0000-4000-8000-000000000003",
  "target-task",
  "$contentDraftTargetTaskId",
);
const AUTHORED_CONTENT_DRAFT_REFERENCE = parseLedgerAuthorityMemberReference({
  artifactKind: "wakeflow-ledger-authority-member-reference",
  schemaVersion: 1,
  family: "requirement",
  recordId: "requirement_00000000-0000-4000-8000-000000000010",
  recordRef:
    "requirements/requirement_00000000-0000-4000-8000-000000000010/record.json",
  recordDigest: CONTENT_DRAFT_VALIDATION_DIGEST,
  memberPath: "validation.md",
  memberRef:
    "requirements/requirement_00000000-0000-4000-8000-000000000010/validation.md",
  memberDigest: CONTENT_DRAFT_VALIDATION_DIGEST,
  role: "requirement-design",
  mediaType: "text/markdown",
});

function fail(reason: TaskPackageErrorReason, path: string): never {
  throw new TaskPackageError(reason, path);
}

function parseCanonicalText(value: string, path: string): string {
  if (
    !value.isWellFormed() ||
    value.normalize("NFC") !== value ||
    CONTROL_EXCEPT_LF_PATTERN.test(value)
  ) {
    fail("text", path);
  }
  return value;
}

function parseId<
  Kind extends
    | "program"
    | "demand"
    | "task-package"
    | "target-task"
    | "test-card"
    | "repository"
    | "window",
>(value: unknown, kind: Kind, path: string): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
    throw error;
  }
}

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path);
    throw error;
  }
}

function parseCreationTime(value: unknown): UtcInstant {
  try {
    return parseUtcInstant(value, "$/createdAt");
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", "$/createdAt");
    throw error;
  }
}

function parseTextList(
  values: readonly string[],
  path: string,
): readonly string[] {
  const parsed: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const text = parseCanonicalText(
      values[index] as string,
      `${path}/${index}`,
    );
    if (seen.has(text)) fail("relation", `${path}/${index}`);
    seen.add(text);
    parsed.push(text);
  }
  return Object.freeze(parsed);
}

function parseNonEmptyTextList(
  values: readonly string[],
  path: string,
): readonly [string, ...string[]] {
  const parsed = parseTextList(values, path);
  const first = parsed[0];
  if (first === undefined) fail("schema", path);
  return Object.freeze([first, ...parsed.slice(1)]);
}

function parseSelectedAuthorityRefs(
  values: readonly TaskPackageWire["selectedAuthorityRefs"][number][],
): TaskPackage["selectedAuthorityRefs"] {
  const parsed: Readonly<LedgerAuthorityMemberReference>[] = [];
  const memberRefs = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    let reference: Readonly<LedgerAuthorityMemberReference>;
    try {
      reference = parseLedgerAuthorityMemberReference(values[index]);
    } catch (error: unknown) {
      if (error instanceof LedgerAuthorityStoreError) {
        fail("reference", `$/selectedAuthorityRefs/${index}`);
      }
      throw error;
    }
    if (memberRefs.has(reference.memberRef)) {
      fail("relation", `$/selectedAuthorityRefs/${index}`);
    }
    memberRefs.add(reference.memberRef);
    parsed.push(reference);
  }
  const first = parsed[0];
  if (first === undefined) fail("schema", "$/selectedAuthorityRefs");
  return Object.freeze([first, ...parsed.slice(1)]);
}

function parseAcceptanceAnchors(
  values: readonly TaskPackageWire["acceptanceAnchors"][number][],
): readonly Readonly<TaskPackageAcceptanceAnchor>[] {
  const parsed: Readonly<TaskPackageAcceptanceAnchor>[] = [];
  const anchorIds = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) fail("schema", `$/acceptanceAnchors/${index}`);
    const path = `$/acceptanceAnchors/${index}`;
    const anchorId = parseCanonicalText(value.anchorId, `${path}/anchorId`);
    if (anchorIds.has(anchorId)) fail("relation", `${path}/anchorId`);
    anchorIds.add(anchorId);
    parsed.push(
      Object.freeze({
        anchorId,
        claim: parseCanonicalText(value.claim, `${path}/claim`),
        probe: parseCanonicalText(value.probe, `${path}/probe`),
        expected: parseCanonicalText(value.expected, `${path}/expected`),
      }),
    );
  }
  return Object.freeze(parsed);
}

function normalizeWire(wire: Readonly<TaskPackageWire>): Readonly<TaskPackage> {
  const confirmedContext = parseNonEmptyTextList(
    wire.confirmedContext,
    "$/confirmedContext",
  );
  const inScope = parseNonEmptyTextList(
    wire.boundaries.inScope,
    "$/boundaries/inScope",
  );
  const completionExpectations = parseNonEmptyTextList(
    wire.completionExpectations,
    "$/completionExpectations",
  );
  const common = {
    artifactKind: TASK_PACKAGE_ARTIFACT_KIND,
    schemaVersion: TASK_PACKAGE_SCHEMA_VERSION,
    programId: parseId(wire.programId, "program", "$/programId"),
    configDigest: parseDigest(wire.configDigest, "$/configDigest"),
    demandId: parseId(wire.demandId, "demand", "$/demandId"),
    demandAuthorityDigest: parseDigest(
      wire.demandAuthorityDigest,
      "$/demandAuthorityDigest",
    ),
    taskPackageId: parseId(
      wire.taskPackageId,
      "task-package",
      "$/taskPackageId",
    ),
    targetTaskId: parseId(wire.targetTaskId, "target-task", "$/targetTaskId"),
    createdAt: parseCreationTime(wire.createdAt),
    objective: parseCanonicalText(wire.objective, "$/objective"),
    confirmedContext,
    selectedAuthorityRefs: parseSelectedAuthorityRefs(
      wire.selectedAuthorityRefs,
    ),
    boundaries: Object.freeze({
      inScope,
      outOfScope: parseTextList(
        wire.boundaries.outOfScope,
        "$/boundaries/outOfScope",
      ),
      forbidden: parseTextList(
        wire.boundaries.forbidden,
        "$/boundaries/forbidden",
      ),
    }),
    completionExpectations,
  } as const;
  const windowId = parseId(
    wire.assignment.windowId,
    "window",
    "$/assignment/windowId",
  );
  const acceptanceAnchors = parseAcceptanceAnchors(wire.acceptanceAnchors);
  if (wire.workType === "implementation") {
    if (
      !("repositoryId" in wire.assignment) ||
      wire.commitExpectation === undefined
    ) {
      fail("schema", "$/assignment");
    }
    const firstAnchor = acceptanceAnchors[0];
    if (firstAnchor === undefined) fail("schema", "$/acceptanceAnchors");
    const parsedAnchors: ImplementationTaskPackage["acceptanceAnchors"] =
      Object.freeze([firstAnchor, ...acceptanceAnchors.slice(1)]);
    const implementation: ImplementationTaskPackage = {
      ...common,
      assignment: Object.freeze({
        repositoryId: parseId(
          wire.assignment.repositoryId,
          "repository",
          "$/assignment/repositoryId",
        ),
        windowId,
      }),
      workType: "implementation" as const,
      commitExpectation: wire.commitExpectation,
      acceptanceAnchors: parsedAnchors,
    };
    return Object.freeze(implementation);
  }
  if (wire.testCard === undefined || acceptanceAnchors.length !== 0) {
    fail("schema", "$/testCard");
  }
  const test: TestTaskPackage = {
    ...common,
    assignment: Object.freeze({ windowId }),
    workType: "test" as const,
    acceptanceAnchors: Object.freeze([]) as readonly [],
    testCard: Object.freeze({
      testCardId: parseId(
        wire.testCard.testCardId,
        "test-card",
        "$/testCard/testCardId",
      ),
      testCardDigest: parseDigest(
        wire.testCard.testCardDigest,
        "$/testCard/testCardDigest",
      ),
    }),
  };
  return Object.freeze(test);
}

/** 把任意进程内值解析为递归冻结、局部关系一致的 TaskPackage。 */
export function parseTaskPackage(value: unknown): Readonly<TaskPackage> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$taskPackage");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const result = validateWire(json);
  if (!result.ok) fail("schema", result.path);
  return normalizeWire(result.value);
}

function readCreationTime(options: CreateTaskPackageOptions): UtcInstant {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(options, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (Object.keys(record).some((key) => key !== "clock")) {
    fail("input", "$options");
  }
  try {
    return readUtcWallClock(record.clock as UtcWallClock | undefined);
  } catch (error: unknown) {
    if (error instanceof UtcWallClockError) fail("time", "$options/clock");
    throw error;
  }
}

/** 从不含协议头和创建时间、字段集合严格受限的草稿创建 TaskPackage。 */
export function createTaskPackage(
  draft: unknown,
  options: CreateTaskPackageOptions = {},
): Readonly<TaskPackage> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(draft, "$draft");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$draft");
    throw error;
  }
  const keys = Object.keys(record).sort();
  const expectedFields =
    record.workType === "test" ? TEST_DRAFT_FIELDS : DRAFT_FIELDS;
  if (
    keys.length !== expectedFields.length ||
    keys.some((key, index) => key !== expectedFields[index])
  ) {
    fail("input", "$draft");
  }
  const admitted = parseTaskPackage({
    artifactKind: TASK_PACKAGE_ARTIFACT_KIND,
    schemaVersion: TASK_PACKAGE_SCHEMA_VERSION,
    programId: record.programId,
    configDigest: record.configDigest,
    demandId: record.demandId,
    demandAuthorityDigest: record.demandAuthorityDigest,
    taskPackageId: record.taskPackageId,
    targetTaskId: record.targetTaskId,
    createdAt: DRAFT_VALIDATION_INSTANT,
    assignment: record.assignment,
    workType: record.workType,
    objective: record.objective,
    confirmedContext: record.confirmedContext,
    selectedAuthorityRefs: record.selectedAuthorityRefs,
    boundaries: record.boundaries,
    completionExpectations: record.completionExpectations,
    acceptanceAnchors: record.acceptanceAnchors,
    ...(record.workType === "test"
      ? { testCard: record.testCard }
      : { commitExpectation: record.commitExpectation }),
  });
  return Object.freeze({
    ...admitted,
    createdAt: readCreationTime(options),
  });
}

/**
 * 解析 Controller 可填写的 TaskPackage 内容草稿。
 *
 * 受控的 Program/Demand/Config/Authority/Task/Event 时间字段由 Planning owner 注入；
 * 本函数使用固定内部值复用完整 TaskPackage parser，随后只投影调用方拥有的字段。
 */
export function parseTaskPackageContentDraft(
  value: unknown,
): TaskPackageContentDraft {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$contentDraft");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$contentDraft");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== CONTENT_DRAFT_FIELDS.length ||
    keys.some((key, index) => key !== CONTENT_DRAFT_FIELDS[index])
  ) {
    fail("input", "$contentDraft");
  }
  const parsed = parseTaskPackage({
    artifactKind: TASK_PACKAGE_ARTIFACT_KIND,
    schemaVersion: TASK_PACKAGE_SCHEMA_VERSION,
    programId: CONTENT_DRAFT_PROGRAM_ID,
    configDigest: CONTENT_DRAFT_VALIDATION_DIGEST,
    demandId: CONTENT_DRAFT_DEMAND_ID,
    demandAuthorityDigest: CONTENT_DRAFT_VALIDATION_DIGEST,
    taskPackageId: CONTENT_DRAFT_TASK_PACKAGE_ID,
    targetTaskId: CONTENT_DRAFT_TARGET_TASK_ID,
    createdAt: DRAFT_VALIDATION_INSTANT,
    assignment: record.assignment,
    workType: record.workType,
    objective: record.objective,
    confirmedContext: record.confirmedContext,
    selectedAuthorityRefs: record.selectedAuthorityRefs,
    boundaries: record.boundaries,
    completionExpectations: record.completionExpectations,
    commitExpectation: record.commitExpectation,
    acceptanceAnchors: record.acceptanceAnchors,
  });
  if (parsed.workType !== "implementation") {
    fail("relation", "$/workType");
  }
  return Object.freeze({
    assignment: parsed.assignment,
    workType: parsed.workType,
    objective: parsed.objective,
    confirmedContext: parsed.confirmedContext,
    selectedAuthorityRefs: parsed.selectedAuthorityRefs,
    boundaries: parsed.boundaries,
    completionExpectations: parsed.completionExpectations,
    commitExpectation: parsed.commitExpectation,
    acceptanceAnchors: parsed.acceptanceAnchors,
  });
}

/** 解析尚未绑定完整 Ledger 引用的 Controller authored content。 */
export function parseTaskPackageAuthoredContentDraft(
  value: unknown,
): TaskPackageAuthoredContentDraft {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$authoredContentDraft");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      fail("input", "$authoredContentDraft");
    }
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== AUTHORED_CONTENT_DRAFT_FIELDS.length ||
    keys.some((key, index) => key !== AUTHORED_CONTENT_DRAFT_FIELDS[index])
  ) {
    fail("input", "$authoredContentDraft");
  }
  const parsed = parseTaskPackageContentDraft({
    assignment: record.assignment,
    workType: record.workType,
    objective: record.objective,
    confirmedContext: record.confirmedContext,
    selectedAuthorityRefs: [AUTHORED_CONTENT_DRAFT_REFERENCE],
    boundaries: record.boundaries,
    completionExpectations: record.completionExpectations,
    commitExpectation: record.commitExpectation,
    acceptanceAnchors: record.acceptanceAnchors,
  });
  return Object.freeze({
    assignment: parsed.assignment,
    workType: parsed.workType,
    objective: parsed.objective,
    confirmedContext: parsed.confirmedContext,
    boundaries: parsed.boundaries,
    completionExpectations: parsed.completionExpectations,
    commitExpectation: parsed.commitExpectation,
    acceptanceAnchors: parsed.acceptanceAnchors,
  });
}

/** 渲染 TaskPackage 的唯一确定性 JSON 文档表示。 */
export function renderTaskPackage(value: unknown): string {
  return renderDeterministicJsonDocument(
    parseTaskPackage(value),
    "$taskPackage",
  );
}

/** 只接受与领域确定性表示逐字节相同的 TaskPackage 文档。 */
export function parseTaskPackageDocument(text: unknown): Readonly<TaskPackage> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(text, "$taskPackage");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", error.path);
    }
    throw error;
  }
  const taskPackage = parseTaskPackage(json);
  if (renderTaskPackage(taskPackage) !== text) {
    fail("representation", "$taskPackage");
  }
  return taskPackage;
}

/** 计算 TaskPackage 领域值的 Canonical JSON SHA-256 摘要。 */
export function computeTaskPackageDigest(value: unknown): Sha256Digest {
  return computeCanonicalJsonSha256Digest(parseTaskPackage(value));
}
