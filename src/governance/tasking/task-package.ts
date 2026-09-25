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

/** 锚点引用需求包验收标准节的一条列表项；Wakeflow 校验引用存在，Controller 不能发明锚点（ADR-0012 D5）。 */
export interface TaskPackageRequirementRef {
  readonly recordDigest: Sha256Digest;
  readonly sectionAnchor: string;
  readonly itemId: string;
}

export interface TaskPackageAcceptanceAnchor {
  readonly anchorId: string;
  readonly claim: string;
  readonly probe: string;
  readonly expected: string;
  readonly requirementRef: Readonly<TaskPackageRequirementRef>;
}

/** 同仓库再来一个包必须声明谱系：替代未接受的旧目标，或续接已接受的旧目标（能力卡 5 Q2）。 */
export type TaskPackageLineage =
  | Readonly<{ readonly kind: "replacement"; readonly replacesTargetTaskId: WakeflowDurableId<"target-task"> }>
  | Readonly<{ readonly kind: "continuation"; readonly continuesTargetTaskId: WakeflowDurableId<"target-task"> }>
  | null;

/** 需求包 `taskPlanReview` 为 user 时，任务清单先交用户过目，确认时间记入包（ADR-0011 补充）。 */
export type TaskPackagePlanReview =
  | Readonly<{ readonly reviewer: "controller" }>
  | Readonly<{ readonly reviewer: "user"; readonly confirmedAt: UtcInstant }>;

/** 测试合同的一步：given/when/then 来自需求包验收标准的一条列表项（ADR-0012 D4）。 */
export interface TestContractStep {
  readonly stepId: string;
  readonly given: string;
  readonly when: string;
  readonly then: string;
  readonly requirementRef: Readonly<TaskPackageRequirementRef>;
}

export type TestSetupPolicy = "fresh-once" | "fresh-per-attempt" | "reuse-existing";

/** test 任务包携带的测试合同；冻结语义由任务包不可变性承担（能力卡 5 修订 5.2）。 */
export interface TestContract {
  readonly question: string;
  readonly objectBoundary: string;
  readonly steps: readonly [Readonly<TestContractStep>, ...Readonly<TestContractStep>[]];
  readonly environment: Readonly<LedgerAuthorityMemberReference>;
  readonly allowedSkills: readonly string[];
  readonly setupPolicy: TestSetupPolicy;
  readonly maxAttempts: number;
  readonly stopConditions: readonly [string, ...string[]];
}

/** 测试所针对的已接受实现基线；由 Wakeflow 从聚合派生进包，Controller 不撰写。 */
export interface TestImplementationBaseline {
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

/** test 包谱系：首轮为 null；产品缺陷修复后的新代际记 retest（能力卡 5 Q5）。 */
export type TestTaskLineage =
  | Readonly<{
      readonly kind: "retest";
      readonly retestsTargetTaskId: WakeflowDurableId<"target-task">;
      readonly productDefectRemediationId: WakeflowDurableId<"product-defect-remediation">;
      readonly authorizationDigest: Sha256Digest;
    }>
  | null;

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
  readonly lineage: TaskPackageLineage;
  readonly planReview: TaskPackagePlanReview;
  /** 选中成员里进一步指向的章节锚点，须在需求包记录的 `sections` 里。 */
  readonly sectionAnchors: readonly string[];
}

export interface TestTaskPackage extends TaskPackageBase {
  readonly assignment: Readonly<TestTaskPackageAssignment>;
  readonly workType: "test";
  readonly acceptanceAnchors: readonly [];
  readonly testContract: Readonly<TestContract>;
  readonly implementationBaselines: readonly [
    Readonly<TestImplementationBaseline>,
    ...Readonly<TestImplementationBaseline>[],
  ];
  readonly lineage: TestTaskLineage;
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
    | "lineage"
    | "objective"
    | "planReview"
    | "sectionAnchors"
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
const CONTROL_EXCEPT_LF_PATTERN = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
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
  "lineage",
  "objective",
  "planReview",
  "programId",
  "sectionAnchors",
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
  "implementationBaselines",
  "lineage",
  "objective",
  "programId",
  "selectedAuthorityRefs",
  "targetTaskId",
  "taskPackageId",
  "testContract",
  "workType",
] as const);
const CONTENT_DRAFT_FIELDS = Object.freeze([
  "acceptanceAnchors",
  "assignment",
  "boundaries",
  "commitExpectation",
  "completionExpectations",
  "confirmedContext",
  "lineage",
  "objective",
  "planReview",
  "sectionAnchors",
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
  "lineage",
  "objective",
  "planReview",
  "sectionAnchors",
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
  memberPath: "requirement.md",
  memberRef:
    "requirements/requirement_00000000-0000-4000-8000-000000000010/requirement.md",
  memberDigest: CONTENT_DRAFT_VALIDATION_DIGEST,
  role: "requirement",
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
    | "target-result"
    | "target-review-decision"
    | "product-defect-remediation"
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
        requirementRef: parseRequirementRef(
          value.requirementRef,
          `${path}/requirementRef`,
        ),
      }),
    );
  }
  return Object.freeze(parsed);
}

function parseLineage(
  value: Exclude<TaskPackageWire["lineage"], { readonly kind: "retest" }>,
  targetTaskId: WakeflowDurableId<"target-task">,
): TaskPackageLineage {
  if (value === undefined || value === null) return null;
  if (value.kind === "replacement") {
    const replacesTargetTaskId = parseId(
      value.replacesTargetTaskId,
      "target-task",
      "$/lineage/replacesTargetTaskId",
    );
    if (replacesTargetTaskId === targetTaskId) fail("relation", "$/lineage");
    return Object.freeze({ kind: "replacement" as const, replacesTargetTaskId });
  }
  const continuesTargetTaskId = parseId(
    value.continuesTargetTaskId,
    "target-task",
    "$/lineage/continuesTargetTaskId",
  );
  if (continuesTargetTaskId === targetTaskId) fail("relation", "$/lineage");
  return Object.freeze({ kind: "continuation" as const, continuesTargetTaskId });
}

function parsePlanReview(
  value: TaskPackageWire["planReview"],
): TaskPackagePlanReview {
  if (value === undefined) fail("schema", "$/planReview");
  if (value.reviewer === "controller") {
    return Object.freeze({ reviewer: "controller" as const });
  }
  let confirmedAt: UtcInstant;
  try {
    confirmedAt = parseUtcInstant(value.confirmedAt, "$/planReview/confirmedAt");
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", "$/planReview/confirmedAt");
    throw error;
  }
  return Object.freeze({ reviewer: "user" as const, confirmedAt });
}

function parseSectionAnchors(
  value: TaskPackageWire["sectionAnchors"],
): readonly string[] {
  if (value === undefined) fail("schema", "$/sectionAnchors");
  const seen = new Set<string>();
  for (const [index, anchor] of value.entries()) {
    if (seen.has(anchor)) fail("relation", `$/sectionAnchors/${index}`);
    seen.add(anchor);
  }
  return Object.freeze([...value]);
}

const STEP_ID_PREFIX = "ts-";

function parseRequirementRef(
  value: Readonly<{ readonly recordDigest: string; readonly sectionAnchor: string; readonly itemId: string }>,
  path: string,
): Readonly<TaskPackageRequirementRef> {
  return Object.freeze({
    recordDigest: parseDigest(value.recordDigest, `${path}/recordDigest`),
    sectionAnchor: value.sectionAnchor,
    itemId: value.itemId,
  });
}

function parseTestContract(
  value: TaskPackageWire["testContract"],
): Readonly<TestContract> {
  if (value === undefined) fail("schema", "$/testContract");
  const steps: Readonly<TestContractStep>[] = [];
  const itemIds = new Set<string>();
  for (const [index, step] of value.steps.entries()) {
    const path = `$/testContract/steps/${index}`;
    // 步骤序号由 Wakeflow 按顺序编为 ts-1…ts-n，一步只引用一条验收标准项。
    if (step.stepId !== `${STEP_ID_PREFIX}${index + 1}`) fail("relation", `${path}/stepId`);
    const requirementRef = parseRequirementRef(step.requirementRef, `${path}/requirementRef`);
    if (itemIds.has(requirementRef.itemId)) fail("relation", `${path}/requirementRef/itemId`);
    itemIds.add(requirementRef.itemId);
    steps.push(
      Object.freeze({
        stepId: step.stepId,
        given: parseCanonicalText(step.given, `${path}/given`),
        when: parseCanonicalText(step.when, `${path}/when`),
        // biome-ignore lint/suspicious/noThenProperty: Given/When/Then 合同步骤字段（§13.85 D1）
        then: parseCanonicalText(step.then, `${path}/then`),
        requirementRef,
      }),
    );
  }
  const firstStep = steps[0];
  if (firstStep === undefined) fail("schema", "$/testContract/steps");
  const stepTuple: TestContract["steps"] = Object.freeze([firstStep, ...steps.slice(1)]);
  let environment: Readonly<LedgerAuthorityMemberReference>;
  try {
    environment = parseLedgerAuthorityMemberReference(value.environment);
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityStoreError) fail("reference", "$/testContract/environment");
    throw error;
  }
  const stopConditions = parseNonEmptyTextList(value.stopConditions, "$/testContract/stopConditions");
  const skills = new Set<string>();
  for (const [index, skill] of value.allowedSkills.entries()) {
    if (skills.has(skill)) fail("relation", `$/testContract/allowedSkills/${index}`);
    skills.add(skill);
  }
  return Object.freeze({
    question: parseCanonicalText(value.question, "$/testContract/question"),
    objectBoundary: parseCanonicalText(value.objectBoundary, "$/testContract/objectBoundary"),
    steps: stepTuple,
    environment,
    allowedSkills: Object.freeze([...value.allowedSkills]),
    setupPolicy: value.setupPolicy,
    maxAttempts: value.maxAttempts,
    stopConditions,
  });
}

function parseImplementationBaselines(
  value: TaskPackageWire["implementationBaselines"],
): TestTaskPackage["implementationBaselines"] {
  if (value === undefined) fail("schema", "$/implementationBaselines");
  const parsed: Readonly<TestImplementationBaseline>[] = [];
  const targetTaskIds = new Set<string>();
  for (const [index, baseline] of value.entries()) {
    const path = `$/implementationBaselines/${index}`;
    const targetTaskId = parseId(baseline.targetTaskId, "target-task", `${path}/targetTaskId`);
    if (targetTaskIds.has(targetTaskId)) fail("relation", `${path}/targetTaskId`);
    targetTaskIds.add(targetTaskId);
    parsed.push(
      Object.freeze({
        targetTaskId,
        taskPackageId: parseId(baseline.taskPackageId, "task-package", `${path}/taskPackageId`),
        taskPackageDigest: parseDigest(baseline.taskPackageDigest, `${path}/taskPackageDigest`),
        repositoryId: parseId(baseline.repositoryId, "repository", `${path}/repositoryId`),
        windowId: parseId(baseline.windowId, "window", `${path}/windowId`),
        targetResultId: parseId(baseline.targetResultId, "target-result", `${path}/targetResultId`),
        resultDigest: parseDigest(baseline.resultDigest, `${path}/resultDigest`),
        targetReviewDecisionId: parseId(
          baseline.targetReviewDecisionId,
          "target-review-decision",
          `${path}/targetReviewDecisionId`,
        ),
        decisionDigest: parseDigest(baseline.decisionDigest, `${path}/decisionDigest`),
      }),
    );
  }
  const first = parsed[0];
  if (first === undefined) fail("schema", "$/implementationBaselines");
  return Object.freeze([first, ...parsed.slice(1)]);
}

function parseTestLineage(
  value: TaskPackageWire["lineage"],
  targetTaskId: WakeflowDurableId<"target-task">,
): TestTaskLineage {
  if (value === undefined || value === null) return null;
  if (value.kind !== "retest") fail("schema", "$/lineage");
  const retestsTargetTaskId = parseId(
    value.retestsTargetTaskId,
    "target-task",
    "$/lineage/retestsTargetTaskId",
  );
  if (retestsTargetTaskId === targetTaskId) fail("relation", "$/lineage");
  return Object.freeze({
    kind: "retest" as const,
    retestsTargetTaskId,
    productDefectRemediationId: parseId(
      value.productDefectRemediationId,
      "product-defect-remediation",
      "$/lineage/productDefectRemediationId",
    ),
    authorizationDigest: parseDigest(value.authorizationDigest, "$/lineage/authorizationDigest"),
  });
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
      lineage: parseLineage(
        wire.lineage !== undefined && wire.lineage !== null && wire.lineage.kind === "retest"
          ? fail("schema", "$/lineage")
          : wire.lineage,
        common.targetTaskId,
      ),
      planReview: parsePlanReview(wire.planReview),
      sectionAnchors: parseSectionAnchors(wire.sectionAnchors),
    };
    return Object.freeze(implementation);
  }
  if (
    wire.testContract === undefined ||
    wire.implementationBaselines === undefined ||
    wire.lineage === undefined ||
    acceptanceAnchors.length !== 0 ||
    wire.planReview !== undefined ||
    wire.sectionAnchors !== undefined
  ) {
    fail("schema", "$/testContract");
  }
  const test: TestTaskPackage = {
    ...common,
    assignment: Object.freeze({ windowId }),
    workType: "test" as const,
    acceptanceAnchors: Object.freeze([]) as readonly [],
    testContract: parseTestContract(wire.testContract),
    implementationBaselines: parseImplementationBaselines(wire.implementationBaselines),
    lineage: parseTestLineage(wire.lineage, common.targetTaskId),
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
      ? {
          testContract: record.testContract,
          implementationBaselines: record.implementationBaselines,
          lineage: record.lineage,
        }
      : {
          commitExpectation: record.commitExpectation,
          lineage: record.lineage,
          planReview: record.planReview,
          sectionAnchors: record.sectionAnchors,
        }),
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
    lineage: record.lineage,
    planReview: record.planReview,
    sectionAnchors: record.sectionAnchors,
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
    lineage: parsed.lineage,
    planReview: parsed.planReview,
    sectionAnchors: parsed.sectionAnchors,
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
    lineage: record.lineage,
    planReview: record.planReview,
    sectionAnchors: record.sectionAnchors,
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
    lineage: parsed.lineage,
    planReview: parsed.planReview,
    sectionAnchors: parsed.sectionAnchors,
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
