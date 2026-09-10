import type { WakeflowConfigAuthoritySnapshot } from "../../configuration/wakeflow-config-authority-snapshot.js";
import type { UtcInstant } from "../../foundation/time/utc-instant.js";
import type { DemandAggregateState } from "../../governance/demand/model/demand-aggregate-state.js";
import type {
  TaskPackageAcceptanceAnchor,
  TaskPackageLineage,
  TaskPackagePlanReview,
} from "../../governance/tasking/task-package.js";
import { parseMarkdownListItems, parseMarkdownSections } from "../../kernel/markdown-sections.js";
import { resolveRequirementSectionAnchor } from "../../contracts/vocabulary/requirement-sections.js";

/**
 * Wakeflow Capabilities / Tasking：纯决定。
 *
 * 验收标准条目从 requirement.md 切出；锚点引用、章节锚点、谱系、审阅门与拓扑都只
 * 看已读好的数据，不读文件、不看时钟。聚合在追加时再次执行谱系规则；这里先把
 * 拒绝理由说清楚，让 Controller 不必猜。
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
  "redesign-requested",
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
