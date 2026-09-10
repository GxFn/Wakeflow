import type { WakeflowConfigAuthoritySnapshot } from "../../configuration/wakeflow-config-authority-snapshot.js";
import type { UtcInstant } from "../../foundation/time/utc-instant.js";
import type {
  DemandAcceptedTargetTaskState,
  DemandAggregateState,
} from "../../governance/demand/model/demand-aggregate-state.js";
import type {
  TaskPackageAcceptanceAnchor,
  TaskPackageLineage,
  TaskPackagePlanReview,
  TestImplementationBaseline,
} from "../../governance/tasking/task-package.js";
import { parseMarkdownListItems, parseMarkdownSections } from "../../kernel/markdown-sections.js";
import { resolveRequirementSectionAnchor } from "../../contracts/vocabulary/requirement-sections.js";

/**
 * Wakeflow Capabilities / Tasking：纯决定。
 *
 * 验收标准条目从 requirement.md 切出；锚点引用、章节锚点、谱系、审阅门、拓扑与
 * 测试合同（步骤引用、规划准入、实现基线）都只看已读好的数据，不读文件、不看时钟。
 * 聚合在追加时再次执行谱系与基线规则；这里先把拒绝理由说清楚，让 Controller 不必猜。
 */

const ACCEPTANCE_CRITERIA_ANCHOR = "acceptance-criteria";
const ACCEPTANCE_ITEM_PREFIX = "ac";

export interface AcceptanceCriterion {
  readonly itemId: string;
  readonly text: string;
}

/** requirement.md 验收标准节里的顶层列表项；没有该节或没有列表项时为空。 */
export function parseAcceptanceCriteria(requirementText: string): readonly AcceptanceCriterion[] {
  const section = parseMarkdownSections(requirementText).find(
    (candidate) =>
      resolveRequirementSectionAnchor(candidate.heading) === ACCEPTANCE_CRITERIA_ANCHOR,
  );
  if (section === undefined) return Object.freeze([]);
  return Object.freeze(
    parseMarkdownListItems(section.body, ACCEPTANCE_ITEM_PREFIX).map((item) =>
      Object.freeze({ itemId: item.itemId, text: item.text }),
    ),
  );
}

export interface AnchorReferenceInput {
  readonly anchors: readonly Readonly<TaskPackageAcceptanceAnchor>[];
  /** Demand 谱系里的需求包记录摘要。 */
  readonly recordDigest: string;
  readonly criteria: readonly AcceptanceCriterion[];
}

/** 锚点引用的阻塞：记录摘要、节锚点与条目都必须命中（ADR-0012 D5）。 */
export function deriveAnchorReferenceBlockers(
  input: Readonly<AnchorReferenceInput>,
): readonly string[] {
  const itemIds = new Set(input.criteria.map((criterion) => criterion.itemId));
  const blockers: string[] = [];
  for (const anchor of input.anchors) {
    const reference = anchor.requirementRef;
    if (reference.recordDigest !== input.recordDigest) {
      blockers.push(`anchor-record-drift:${anchor.anchorId}`);
    }
    if (reference.sectionAnchor !== ACCEPTANCE_CRITERIA_ANCHOR) {
      blockers.push(`anchor-section:${anchor.anchorId}:${reference.sectionAnchor}`);
    }
    if (!itemIds.has(reference.itemId)) {
      blockers.push(`anchor-item-unknown:${anchor.anchorId}:${reference.itemId}`);
    }
  }
  return Object.freeze(blockers);
}

/** 章节锚点必须在需求包记录的 sections 里。 */
export function deriveSectionAnchorBlockers(
  sectionAnchors: readonly string[],
  recordSectionAnchors: readonly string[],
): readonly string[] {
  const known = new Set(recordSectionAnchors);
  return Object.freeze(
    sectionAnchors
      .filter((anchor) => !known.has(anchor))
      .map((anchor) => `section-anchor-unknown:${anchor}`),
  );
}

export interface PlanReviewInput {
  readonly taskPlanReview: "controller" | "user";
  readonly confirmedAt: UtcInstant | null;
}

/** 需求包要求用户过目任务清单时，请求必须带确认时间；否则确认时间不得出现。 */
export function derivePlanReview(input: Readonly<PlanReviewInput>): Readonly<{
  readonly planReview: TaskPackagePlanReview | null;
  readonly blocker: string | null;
}> {
  if (input.taskPlanReview === "user") {
    return input.confirmedAt === null
      ? Object.freeze({ planReview: null, blocker: "task-plan-review-required" })
      : Object.freeze({
          planReview: Object.freeze({ reviewer: "user" as const, confirmedAt: input.confirmedAt }),
          blocker: null,
        });
  }
  return input.confirmedAt === null
    ? Object.freeze({
        planReview: Object.freeze({ reviewer: "controller" as const }),
        blocker: null,
      })
    : Object.freeze({ planReview: null, blocker: "task-plan-review-not-requested" });
}

export type LineageExpectation =
  | Readonly<{ readonly kind: "none" }>
  | Readonly<{
      readonly kind: "replacement";
      readonly targetTaskId: string;
      readonly replaceable: boolean;
    }>
  | Readonly<{ readonly kind: "continuation"; readonly targetTaskIds: readonly string[] }>;

const REPLACEABLE_PHASES: readonly string[] = Object.freeze([
  "planned",
  "delivery-prepared",
  "host-effect-rejected",
  "rework-requested",
  "product-defect-rework-requested",
  "escalated",
  "review-blocked",
]);

/** 仓库里的谱系头：有未接受且未被替代的目标就必须替代它；只剩已接受目标就必须续接。 */
export function deriveLineageExpectation(
  state: Readonly<DemandAggregateState>,
  repositoryId: string,
): LineageExpectation {
  const sameRepository = state.targetTasks.filter(
    (target) => target.workType !== "test" && target.repositoryId === repositoryId,
  );
  const open = sameRepository.find(
    (target) => target.phase !== "accepted" && target.phase !== "superseded",
  );
  if (open !== undefined) {
    return Object.freeze({
      kind: "replacement",
      targetTaskId: open.targetTaskId,
      replaceable: REPLACEABLE_PHASES.includes(open.phase),
    });
  }
  const accepted = sameRepository.filter((target) => target.phase === "accepted");
  if (accepted.length > 0) {
    return Object.freeze({
      kind: "continuation",
      targetTaskIds: Object.freeze(accepted.map((target) => target.targetTaskId)),
    });
  }
  return Object.freeze({ kind: "none" });
}

/** 把声明的谱系与仓库现状对照，给出可读的拒绝理由；空即可以追加。 */
export function deriveLineageBlockers(
  lineage: TaskPackageLineage,
  expectation: LineageExpectation,
): readonly string[] {
  if (expectation.kind === "none") {
    return lineage === null ? Object.freeze([]) : Object.freeze(["lineage-unexpected"]);
  }
  if (expectation.kind === "replacement") {
    if (lineage === null || lineage.kind !== "replacement") {
      return Object.freeze([`lineage-replacement-required:${expectation.targetTaskId}`]);
    }
    if (lineage.replacesTargetTaskId !== expectation.targetTaskId) {
      return Object.freeze([`lineage-replacement-target:${expectation.targetTaskId}`]);
    }
    return expectation.replaceable
      ? Object.freeze([])
      : Object.freeze([`lineage-target-in-flight:${expectation.targetTaskId}`]);
  }
  if (lineage === null || lineage.kind !== "continuation") {
    return Object.freeze([`lineage-continuation-required:${expectation.targetTaskIds.join("|")}`]);
  }
  return expectation.targetTaskIds.includes(lineage.continuesTargetTaskId)
    ? Object.freeze([])
    : Object.freeze([`lineage-continuation-target:${expectation.targetTaskIds.join("|")}`]);
}

export interface TopologyInput {
  readonly config: Readonly<WakeflowConfigAuthoritySnapshot>;
  readonly repositoryId: string;
  readonly windowId: string;
}

/** 实现任务只派给 product 窗口，且窗口根仓库必须等于任务仓库（能力卡 5 角色门）。 */
function lookup<Value>(record: Readonly<Record<string, Value>>, key: string): Value | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

export function deriveTopologyBlockers(input: Readonly<TopologyInput>): readonly string[] {
  const repository = lookup(input.config.indexes.repositoryById, input.repositoryId);
  const window = lookup(input.config.indexes.windowById, input.windowId);
  const blockers: string[] = [];
  if (repository === undefined) blockers.push("repository-unknown");
  if (window === undefined) blockers.push("window-unknown");
  else if (window.role !== "product") blockers.push(`window-role:${window.role}`);
  else if (window.root.kind !== "repository" || window.root.repositoryId !== input.repositoryId) {
    blockers.push("window-repository-mismatch");
  }
  return Object.freeze(blockers);
}

// ---- 测试合同（能力卡 5 修订 5.2，§13.85 D1–D3） -----------------------------------

export interface TestStepReferenceInput {
  readonly steps: readonly Readonly<{
    readonly stepId: string;
    readonly requirementRef: Readonly<{
      readonly recordDigest: string;
      readonly sectionAnchor: string;
      readonly itemId: string;
    }>;
  }>[];
  readonly recordDigest: string;
  readonly criteria: readonly AcceptanceCriterion[];
}

/** 测试合同每一步的 requirementRef 都必须命中需求包验收标准的一条，规则同验收锚点。 */
export function deriveTestStepReferenceBlockers(
  input: Readonly<TestStepReferenceInput>,
): readonly string[] {
  const itemIds = new Set(input.criteria.map((criterion) => criterion.itemId));
  const blockers: string[] = [];
  for (const step of input.steps) {
    const reference = step.requirementRef;
    if (reference.recordDigest !== input.recordDigest) {
      blockers.push(`step-record-drift:${step.stepId}`);
    }
    if (reference.sectionAnchor !== ACCEPTANCE_CRITERIA_ANCHOR) {
      blockers.push(`step-section:${step.stepId}:${reference.sectionAnchor}`);
    }
    if (!itemIds.has(reference.itemId)) {
      blockers.push(`step-item-unknown:${step.stepId}:${reference.itemId}`);
    }
  }
  return Object.freeze(blockers);
}

export interface TestPlanningInput {
  readonly testingMode: string;
  readonly state: Readonly<DemandAggregateState>;
  readonly lineage: Readonly<{
    readonly kind: "retest";
    readonly retestsTargetTaskId: string;
  }> | null;
}

/** 实现侧准入：现存实现目标至少一个且全部已接受。 */
function implementationReadinessBlockers(state: Readonly<DemandAggregateState>): readonly string[] {
  const implementation = state.targetTasks.filter(
    (target) => target.workType !== "test" && target.phase !== "superseded",
  );
  if (implementation.length === 0) return Object.freeze(["implementation-targets-missing"]);
  return Object.freeze(
    implementation
      .filter((target) => target.phase !== "accepted")
      .map((target) => `implementation-target-not-accepted:${target.targetTaskId}`),
  );
}

/** 测试侧准入：至多一个未终结 test 目标；谱系必须对上待消费复测，缺陷代际未授权时不能开新合同。 */
function testLineageBlockers(
  state: Readonly<DemandAggregateState>,
  lineage: TestPlanningInput["lineage"],
): readonly string[] {
  const testTargets = state.targetTasks.filter((target) => target.workType === "test");
  const openTestTargets = testTargets.filter((target) => target.phase !== "test-product-defect");
  const blockers = openTestTargets.map((target) => `test-target-open:${target.targetTaskId}`);
  const pending = state.pendingTestRetest;
  if (pending !== undefined) {
    const previous = pending.previousTestTarget.targetTaskId;
    if (lineage === null) blockers.push(`lineage-retest-required:${previous}`);
    else if (lineage.retestsTargetTaskId !== previous) {
      blockers.push(`lineage-retest-target:${previous}`);
    }
  } else if (testTargets.length > 0 && openTestTargets.length === 0) {
    blockers.push("test-retest-not-authorized");
  } else if (lineage !== null) {
    blockers.push("lineage-unexpected");
  }
  return Object.freeze(blockers);
}

/**
 * 测试规划准入：真实环境模式、活动 Demand 无待答升级、全部现存实现目标已接受、
 * 没有未终结 test 目标；待消费复测要求 retest 谱系指向前一 test 目标。
 */
export function deriveTestPlanningBlockers(input: Readonly<TestPlanningInput>): readonly string[] {
  const { state, lineage } = input;
  const blockers: string[] = [];
  if (input.testingMode !== "real-environment") blockers.push(`testing-mode:${input.testingMode}`);
  if (state.lifecycle !== "active") blockers.push(`demand-lifecycle:${state.lifecycle}`);
  if (state.awaitingDecision !== undefined) blockers.push("awaiting-decision");
  blockers.push(...implementationReadinessBlockers(state), ...testLineageBlockers(state, lineage));
  return Object.freeze(blockers);
}

/** 测试基线由 Wakeflow 从聚合派生：全部现存实现目标的已接受结果与审查决定。 */
export function deriveImplementationBaselines(
  state: Readonly<DemandAggregateState>,
): readonly Readonly<TestImplementationBaseline>[] {
  return Object.freeze(
    state.targetTasks
      .filter(
        (target): target is Readonly<DemandAcceptedTargetTaskState> =>
          target.workType !== "test" && target.phase === "accepted",
      )
      .map((target) =>
        Object.freeze({
          targetTaskId: target.targetTaskId,
          taskPackageId: target.taskPackageId,
          taskPackageDigest: target.taskPackageDigest,
          repositoryId: target.repositoryId,
          windowId: target.windowId,
          targetResultId: target.currentDelivery.targetResult.targetResultId,
          resultDigest: target.currentDelivery.targetResult.resultDigest,
          targetReviewDecisionId: target.currentDelivery.reviewDecision.targetReviewDecisionId,
          decisionDigest: target.currentDelivery.reviewDecision.decisionDigest,
        }),
      ),
  );
}
