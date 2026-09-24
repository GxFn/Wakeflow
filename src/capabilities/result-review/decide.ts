import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import {
  RERUNNABLE_TEST_FAILURE_CLASSIFICATIONS,
  type TestFailureClassification,
  type TestStepVerdict,
} from "../../contracts/vocabulary/test-step-vocabulary.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { UtcInstant } from "../../foundation/time/utc-instant.js";
import type {
  ImplementationTargetResult,
  TargetResult,
} from "../../governance/result/target-result.js";
import type { TargetResultOutcome } from "../../governance/result/target-result-report-contract.js";
import type { TestTargetResultStep } from "../../governance/result/test-target-result-report.js";
import type { ControllerReviewDecision } from "../../governance/review/controller-review-decision.js";
import type { ControllerIndependentCheckOutcome } from "../../governance/review/controller-review-decision-contract.js";
import type { TestContractStep } from "../../governance/tasking/task-package.js";
import { type PrivacyScanPolicy, scanPrivacy } from "../../kernel/privacy-scan.js";

/**
 * Wakeflow Capabilities / Result Review：结果导入与评审的纯决定（能力卡 7 修订，§13.87 D2 D3 D6 D7）。
 *
 * 这里没有 I/O：证据定位符只解析成"该读哪份受管证据的哪个成员"的计划，隐私扫描只收集
 * 命中类别，完成证据与回调落地由记录列表派生，允许的决定与决定的阻塞项由分类路由表派生，
 * approved 基线由同目标尝试链与 retest 链派生。
 */

const MANAGED_EVIDENCE_LOCATOR_ROOT = "artifacts/managed-evidence";

const EVIDENCE_ID_PATTERN =
  /^evidence_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type EvidenceLocatorPlan =
  | Readonly<{
      readonly evidenceId: WakeflowDurableId<"evidence">;
      readonly member: "manifest";
    }>
  | Readonly<{
      readonly evidenceId: WakeflowDurableId<"evidence">;
      readonly member: "payload";
      /** payload 根之下的成员引用，例如 `content` 或 `logs/report.txt`。 */
      readonly memberRef: string;
    }>;

/**
 * 定位符只解析同 Demand 受管证据记录内的路径：`<root>/<evidenceId>/manifest.json` 或
 * `<root>/<evidenceId>/payload/<member>`；其余返回 null。表驱动：slice 8 只加根与种类。
 */
export function planEvidenceLocator(ref: string): EvidenceLocatorPlan | null {
  const prefix = `${MANAGED_EVIDENCE_LOCATOR_ROOT}/`;
  if (!ref.startsWith(prefix)) return null;
  const rest = ref.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const evidenceId = rest.slice(0, slash);
  if (!EVIDENCE_ID_PATTERN.test(evidenceId)) return null;
  const member = rest.slice(slash + 1);
  const typedEvidenceId = evidenceId as WakeflowDurableId<"evidence">;
  if (member === "manifest.json") {
    return Object.freeze({ evidenceId: typedEvidenceId, member: "manifest" as const });
  }
  if (member.startsWith("payload/") && member.length > "payload/".length) {
    return Object.freeze({
      evidenceId: typedEvidenceId,
      member: "payload" as const,
      memberRef: member.slice("payload/".length),
    });
  }
  return null;
}

/**
 * 报告里出现的证据引用：解析前只是文本，解析成功后才成为可移植路径与摘要。定位符带种类，
 * 锚点与步骤引用不带（`kind: null`）；带种类的引用必须与所引记录的种类一致（切片 8 D5）。
 */
export interface EvidenceReference {
  readonly ref: string;
  readonly digest: string;
  readonly kind: string | null;
}

/** 逐步记录里的证据引用：路径与摘要，种类由整份报告的定位符表达。 */
export interface StepEvidenceRef {
  readonly ref: string;
  readonly digest: string;
}

interface ReportEvidenceRef {
  readonly ref: string;
  readonly digest: string;
  readonly kind?: string;
}

export interface ReportEvidenceView {
  readonly evidenceLocators: readonly Readonly<ReportEvidenceRef>[];
  readonly anchorEvidence?: readonly Readonly<{
    readonly evidenceRefs: readonly Readonly<ReportEvidenceRef>[];
  }>[];
  readonly steps?: readonly Readonly<{ readonly evidence: Readonly<ReportEvidenceRef> }>[];
}

/** 报告里出现的每个 `{ref, digest}` 只解析一次；同一 ref 不同摘要视为两条（第二条必然不符）。 */
export function collectEvidenceReferences(
  report: Readonly<ReportEvidenceView>,
): readonly Readonly<EvidenceReference>[] {
  const seen = new Set<string>();
  const references: Readonly<EvidenceReference>[] = [];
  const add = (reference: Readonly<ReportEvidenceRef>) => {
    const key = `${reference.ref}\u0000${reference.digest}`;
    if (seen.has(key)) return;
    seen.add(key);
    references.push(
      Object.freeze({
        ref: reference.ref,
        digest: reference.digest,
        kind: reference.kind ?? null,
      }),
    );
  };
  for (const locator of report.evidenceLocators) add(locator);
  for (const anchor of report.anchorEvidence ?? []) {
    for (const reference of anchor.evidenceRefs) add(reference);
  }
  for (const step of report.steps ?? []) add(step.evidence);
  return Object.freeze(references);
}

export interface ReportTextView {
  readonly summary: string;
  readonly verification: readonly string[];
  readonly risks: readonly string[];
  readonly steps?: readonly Readonly<{
    readonly observed: string;
    readonly failure?: Readonly<{ readonly recommendedAction: string }>;
  }>[];
}

/** 报告的自由文本：摘要、验证、风险、逐步观察与建议动作；锚点与定位符是引用不是文本。 */
export function reportTexts(report: Readonly<ReportTextView>): readonly string[] {
  return Object.freeze([
    report.summary,
    ...report.verification,
    ...report.risks,
    ...(report.steps ?? []).flatMap((step) =>
      step.failure === undefined
        ? [step.observed]
        : [step.observed, step.failure.recommendedAction],
    ),
  ]);
}

/** 隐私扫描只返回命中的规则类别（去重、稳定排序），从不返回命中的文本。 */
export function derivePrivacyRules(
  texts: readonly string[],
  policy: Readonly<PrivacyScanPolicy>,
): readonly string[] {
  const kinds = new Set<string>();
  for (const text of texts) {
    for (const finding of scanPrivacy(text, policy)) kinds.add(finding.kind);
  }
  return Object.freeze([...kinds].sort());
}

export interface SessionRecordView {
  readonly recordId: string;
  readonly event: string;
  readonly promptDigest: Sha256Digest | null;
  readonly recordedAt: UtcInstant;
}

export type TargetCompletionView =
  | Readonly<{ readonly status: "pending" }>
  | Readonly<{
      readonly status: "confirmed";
      readonly recordId: string;
      readonly event: "stop" | "turn-complete";
      readonly observedAt: UtcInstant;
    }>;

/** 完成证据：目标会话在 `reportedAt` 之后的第一条 Stop 或 turn-complete 记录（§13.87 D2）。 */
export function deriveTargetCompletion(
  records: readonly Readonly<SessionRecordView>[],
  reportedAt: UtcInstant,
): TargetCompletionView {
  const reported = Date.parse(reportedAt);
  const record = [...records]
    .filter(
      (entry) =>
        (entry.event === "stop" || entry.event === "turn-complete") &&
        Date.parse(entry.recordedAt) >= reported,
    )
    .sort((left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt))[0];
  if (record === undefined) return Object.freeze({ status: "pending" as const });
  return Object.freeze({
    status: "confirmed" as const,
    recordId: record.recordId,
    event: record.event === "stop" ? ("stop" as const) : ("turn-complete" as const),
    observedAt: record.recordedAt,
  });
}

/** 回调落地：Controller 会话在签发之后、摘要相符的 `user-prompt-submit` 记录。 */
export function deriveCallbackLanding(
  records: readonly Readonly<SessionRecordView>[],
  promptDigest: Sha256Digest,
  issuedAt: UtcInstant,
): Readonly<{ readonly recordId: string; readonly landedAt: UtcInstant }> | null {
  const issued = Date.parse(issuedAt);
  const record = [...records]
    .filter(
      (entry) =>
        entry.event === "user-prompt-submit" &&
        entry.promptDigest === promptDigest &&
        Date.parse(entry.recordedAt) >= issued,
    )
    .sort((left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt))[0];
  return record === undefined
    ? null
    : Object.freeze({ recordId: record.recordId, landedAt: record.recordedAt });
}

export type ReviewUnitStatus = "reported" | "review-blocked" | "escalated";

export interface ResumptionRequestView {
  readonly previousDecisionId: string;
  readonly basis:
    | Readonly<{ readonly kind: "condition-cleared" }>
    | Readonly<{ readonly kind: "decision-recorded"; readonly escalationEventId: string }>;
}

export interface ResumptionSourceView {
  readonly status: ReviewUnitStatus;
  readonly currentDecisionId: string | null;
  /** 当前 escalate 决定所附带的升级事件；非 escalated 单元为 null。 */
  readonly escalationEventId: string | null;
  readonly escalationAnswered: boolean;
}

/** blocked 或 escalated 之后的再决定必须带 resumption 指向当前决定，且升级已被回答（D4）。 */
export function deriveResumptionBlockers(
  source: Readonly<ResumptionSourceView>,
  resumption: Readonly<ResumptionRequestView> | undefined,
): readonly string[] {
  if (source.status === "reported") {
    return Object.freeze(resumption === undefined ? [] : ["resumption-unexpected"]);
  }
  if (resumption === undefined) return Object.freeze(["resumption-missing"]);
  const blockers: string[] = [];
  if (resumption.previousDecisionId !== source.currentDecisionId) {
    blockers.push("resumption-previous-decision");
  }
  const expectedBasis =
    source.status === "review-blocked" ? "condition-cleared" : "decision-recorded";
  if (resumption.basis.kind !== expectedBasis) {
    blockers.push(`resumption-basis:${resumption.basis.kind}`);
  } else if (resumption.basis.kind === "decision-recorded") {
    if (resumption.basis.escalationEventId !== source.escalationEventId) {
      blockers.push("resumption-escalation-event");
    }
    if (!source.escalationAnswered) blockers.push("awaiting-decision");
  }
  return Object.freeze(blockers);
}

export type ImplementationDecisionType = "accept" | "rework" | "blocked" | "escalate";
export type TestDecisionType = "accept" | "request-another-attempt" | "blocked" | "escalate";

export interface ImplementationAdmissionView {
  readonly outcome: TargetResultOutcome;
  readonly targetCompletion: TargetCompletionView;
  /** 任务包的验收锚点：needs-review 结果被 accept 时 Controller 的绑定须覆盖全部（§13.121 D7）。 */
  readonly acceptanceAnchorIds: readonly string[];
  /** 本 Demand 已登记的托管证据 id：绑定只能引用它们。 */
  readonly managedEvidenceIds: readonly string[];
}

/** Controller 在 accept 请求里给出的锚点→托管证据绑定。 */
export type ImplementationAnchorEvidenceClaim = Readonly<{
  readonly anchorId: string;
  readonly evidenceIds: readonly string[];
}>;

/**
 * needs-review 结果的 accept 依据（§13.121 D7）：Controller 把每个验收锚点绑到本 Demand 已登记的
 * 托管证据。未给出绑定（允许集推导）时只看证据是否存在；给出时逐锚点、逐证据核对。
 */
function deriveAnchorEvidenceBlockers(
  view: Readonly<ImplementationAdmissionView>,
  anchorEvidence: readonly ImplementationAnchorEvidenceClaim[] | null | undefined,
): readonly string[] {
  if (view.managedEvidenceIds.length === 0) return ["anchor-evidence:no-managed-evidence"];
  if (anchorEvidence === undefined) return [];
  if (anchorEvidence === null || anchorEvidence.length === 0) return ["anchor-evidence:missing"];
  const blockers: string[] = [];
  const claimed = new Set(anchorEvidence.map((entry) => entry.anchorId));
  for (const anchorId of view.acceptanceAnchorIds) {
    if (!claimed.has(anchorId)) blockers.push(`anchor-evidence:uncovered:${anchorId}`);
  }
  const known = new Set(view.managedEvidenceIds);
  for (const entry of anchorEvidence) {
    if (!view.acceptanceAnchorIds.includes(entry.anchorId)) {
      blockers.push(`anchor-evidence:unknown-anchor:${entry.anchorId}`);
    }
    for (const evidenceId of entry.evidenceIds) {
      if (!known.has(evidenceId)) blockers.push(`anchor-evidence:unknown-evidence:${evidenceId}`);
    }
  }
  return blockers;
}

/**
 * 实现决定的机器阻塞项：accept 要求完成证据已确认，且结果是 completed，或是 needs-review 而
 * Controller 的 anchorEvidence 把每个验收锚点绑到本 Demand 已登记的托管证据（§13.121 D7）；rework
 * 在给出独立检查时至少一条 failed——failed 的检查就是返工投递交给目标的整改项，全部 passed 的
 * rework 永远投不出去，所以在记录时就拒绝；其余由 Controller 判断。
 */
export function deriveImplementationDecisionBlockers(
  decision: ImplementationDecisionType,
  view: Readonly<ImplementationAdmissionView>,
  independentChecks?: readonly Readonly<{ readonly outcome: ControllerIndependentCheckOutcome }>[],
  anchorEvidence?: readonly ImplementationAnchorEvidenceClaim[] | null,
): readonly string[] {
  const blockers: string[] = [];
  if (decision === "accept") {
    if (view.outcome === "needs-review") {
      blockers.push(...deriveAnchorEvidenceBlockers(view, anchorEvidence));
    } else if (view.outcome !== "completed") {
      blockers.push(`outcome:${view.outcome}`);
    }
    if (view.targetCompletion.status !== "confirmed") blockers.push("target-completion-pending");
  }
  if (
    decision === "rework" &&
    independentChecks !== undefined &&
    !independentChecks.some((check) => check.outcome === "failed")
  ) {
    blockers.push("rework-checks:no-failed");
  }
  return Object.freeze(blockers);
}

export function deriveImplementationAllowedDecisions(
  view: Readonly<ImplementationAdmissionView>,
): readonly ImplementationDecisionType[] {
  const decisions: ImplementationDecisionType[] = ["accept", "rework", "blocked", "escalate"];
  return Object.freeze(
    decisions.filter(
      (decision) => deriveImplementationDecisionBlockers(decision, view).length === 0,
    ),
  );
}

export interface StepBaselineView {
  readonly attemptOrdinal: number;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly observed: string;
  readonly evidence: Readonly<StepEvidenceRef>;
}

/** 逐步视图：合同的 GWT 加本次尝试的记录；范围外步骤沿用 approved 基线（D6）。 */
export interface StepView {
  readonly stepId: string;
  readonly given: string;
  readonly when: string;
  readonly expected: string;
  readonly observed: string | null;
  readonly evidence: Readonly<StepEvidenceRef> | null;
  readonly verdict: TestStepVerdict | null;
  readonly failure: Readonly<TestTargetResultStep["failure"]> | null;
  readonly baseline: Readonly<StepBaselineView> | null;
}

export interface PriorTestResultView {
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly attemptOrdinal: number;
  readonly steps: readonly Readonly<TestTargetResultStep>[];
  /** 该结果所属合同每一步引用的需求验收条目，按 stepId；retest 链按相同条目匹配（条目号跨代际稳定，措辞不是）。 */
  readonly itemIdByStepId: ReadonlyMap<string, string>;
}

function passedStep(
  results: readonly Readonly<PriorTestResultView>[],
  match: (result: Readonly<PriorTestResultView>) => string | null,
): Readonly<StepBaselineView> | null {
  for (const result of results) {
    const stepId = match(result);
    if (stepId === null) continue;
    const step = result.steps.find((entry) => entry.stepId === stepId);
    if (step === undefined || step.verdict !== "pass") continue;
    return Object.freeze({
      attemptOrdinal: result.attemptOrdinal,
      targetTaskId: result.targetTaskId,
      observed: step.observed,
      evidence: step.evidence,
    });
  }
  return null;
}

/**
 * approved 基线：先看同目标更早的尝试（同 stepId），再看 retest 链里的前代目标（引用同一
 * 需求验收条目的步骤）；只有通过的步骤才是基线，最近一次优先。
 */
export function deriveStepViews(
  contractSteps: readonly Readonly<TestContractStep>[],
  current: Readonly<{
    readonly steps: readonly Readonly<TestTargetResultStep>[];
    readonly stepIds: readonly string[] | null;
  }>,
  priorAttempts: readonly Readonly<PriorTestResultView>[],
  retestedResults: readonly Readonly<PriorTestResultView>[],
): readonly Readonly<StepView>[] {
  const latestFirst = (values: readonly Readonly<PriorTestResultView>[]) =>
    [...values].sort((left, right) => right.attemptOrdinal - left.attemptOrdinal);
  const attempts = latestFirst(priorAttempts);
  const retested = latestFirst(retestedResults);
  return Object.freeze(
    contractSteps.map((contractStep) => {
      const recorded = current.steps.find((step) => step.stepId === contractStep.stepId);
      const inScope = current.stepIds === null || current.stepIds.includes(contractStep.stepId);
      if (recorded !== undefined && inScope) {
        return Object.freeze({
          stepId: contractStep.stepId,
          given: contractStep.given,
          when: contractStep.when,
          expected: contractStep.then,
          observed: recorded.observed,
          evidence: recorded.evidence,
          verdict: recorded.verdict,
          failure: recorded.failure ?? null,
          baseline: null,
        });
      }
      const baseline =
        passedStep(attempts, () => contractStep.stepId) ??
        passedStep(retested, (result) => {
          const match = [...result.itemIdByStepId.entries()].find(
            ([, itemId]) => itemId === contractStep.requirementRef.itemId,
          );
          return match === undefined ? null : match[0];
        });
      return Object.freeze({
        stepId: contractStep.stepId,
        given: contractStep.given,
        when: contractStep.when,
        expected: contractStep.then,
        observed: null,
        evidence: null,
        verdict: null,
        failure: null,
        baseline,
      });
    }),
  );
}

/** 并集判定：本次 fail 即 fail，含 blocked 即 blocked，任何合同步骤既未通过也无基线即 cannot-conclude。 */
export function deriveUnionVerdict(views: readonly Readonly<StepView>[]): TestStepVerdict {
  if (views.some((view) => view.verdict === "fail")) return "fail";
  if (views.some((view) => view.verdict === "blocked")) return "blocked";
  if (views.some((view) => view.verdict !== "pass" && view.baseline === null)) {
    return "cannot-conclude";
  }
  return "pass";
}

export interface TestAdmissionView {
  readonly outcome: TargetResultOutcome;
  readonly targetCompletion: TargetCompletionView;
  readonly steps: readonly Readonly<StepView>[];
  readonly attemptCount: number;
  readonly maxAttempts: number;
  /** 上一次尝试里分类为 flaky 的步骤：同一步连续两次 flaky 不能再重跑（D7）。 */
  readonly previouslyFlakyStepIds: readonly string[];
}

export interface TestDecisionRequestView {
  readonly decision: TestDecisionType;
  readonly stepIds?: readonly string[] | undefined;
  readonly escalation?:
    | Readonly<{
        readonly classification: TestFailureClassification;
        readonly remediation?: Readonly<{
          readonly affectedTargets: readonly Readonly<{
            readonly failedStepIds: readonly string[];
          }>[];
        }>;
      }>
    | undefined;
}

function failedViews(views: readonly Readonly<StepView>[]) {
  return views.filter((view) => view.verdict !== null && view.verdict !== "pass");
}

function rerunBlockers(
  request: Readonly<TestDecisionRequestView>,
  view: Readonly<TestAdmissionView>,
): readonly string[] {
  const blockers: string[] = [];
  const failed = failedViews(view.steps);
  if (failed.length === 0) blockers.push("no-failed-step");
  if (view.attemptCount >= view.maxAttempts) blockers.push(`attempt-capacity:${view.attemptCount}`);
  for (const step of failed) {
    const classification = step.failure?.classification;
    if (
      classification === undefined ||
      !RERUNNABLE_TEST_FAILURE_CLASSIFICATIONS.includes(classification)
    ) {
      blockers.push(`classification:${step.stepId}:${classification ?? "none"}`);
    } else if (classification === "flaky" && view.previouslyFlakyStepIds.includes(step.stepId)) {
      blockers.push(`flaky-repeat:${step.stepId}`);
    }
  }
  const failedIds = new Set(failed.map((step) => step.stepId));
  for (const stepId of request.stepIds ?? []) {
    if (!failedIds.has(stepId)) blockers.push(`step-scope:${stepId}`);
  }
  return blockers;
}

function escalateBlockers(
  request: Readonly<TestDecisionRequestView>,
  view: Readonly<TestAdmissionView>,
): readonly string[] {
  const escalation = request.escalation;
  if (escalation === undefined || escalation.classification !== "product-defect") return [];
  const blockers: string[] = [];
  const defects = new Set(
    view.steps
      .filter(
        (step) => step.verdict === "fail" && step.failure?.classification === "product-defect",
      )
      .map((step) => step.stepId),
  );
  if (defects.size === 0) blockers.push("product-defect-missing");
  for (const target of escalation.remediation?.affectedTargets ?? []) {
    for (const stepId of target.failedStepIds) {
      if (!defects.has(stepId)) blockers.push(`remediation-step:${stepId}`);
    }
  }
  return blockers;
}

/**
 * 分类到决定的机器规则（D7）：accept 要求并集 pass、completed 与完成证据；request-another-attempt
 * 要求失败步骤全部可重跑、容量未满、无连续 flaky、范围只含失败步骤；blocked 要求 environment
 * 失败或报告整体 blocked；escalate{product-defect} 要求存在 product-defect 步骤且映射只含这些步骤。
 */
export function deriveTestDecisionBlockers(
  request: Readonly<TestDecisionRequestView>,
  view: Readonly<TestAdmissionView>,
): readonly string[] {
  switch (request.decision) {
    case "accept": {
      const blockers: string[] = [];
      const verdict = deriveUnionVerdict(view.steps);
      if (verdict !== "pass") blockers.push(`verdict:${verdict}`);
      if (view.outcome !== "completed") blockers.push(`outcome:${view.outcome}`);
      if (view.targetCompletion.status !== "confirmed") blockers.push("target-completion-pending");
      return Object.freeze(blockers);
    }
    case "request-another-attempt":
      return Object.freeze(rerunBlockers(request, view));
    case "blocked":
      return Object.freeze(
        view.outcome === "blocked" ||
          view.steps.some((step) => step.failure?.classification === "environment")
          ? []
          : ["blocked-basis"],
      );
    case "escalate":
      return Object.freeze(escalateBlockers(request, view));
  }
}

export function deriveTestAllowedDecisions(
  view: Readonly<TestAdmissionView>,
): readonly TestDecisionType[] {
  const decisions: TestDecisionType[] = [
    "accept",
    "request-another-attempt",
    "blocked",
    "escalate",
  ];
  return Object.freeze(
    decisions.filter((decision) => deriveTestDecisionBlockers({ decision }, view).length === 0),
  );
}

/** 决定与阶段的对应：结果里派生目标 phase，供结果投影与断言复用。 */
export function implementationPhaseForDecision(
  decision: ImplementationDecisionType,
): "accepted" | "rework-requested" | "review-blocked" | "escalated" {
  switch (decision) {
    case "accept":
      return "accepted";
    case "rework":
      return "rework-requested";
    case "blocked":
      return "review-blocked";
    case "escalate":
      return "escalated";
  }
}

export function testPhaseForDecision(
  decision: TestDecisionType,
  classification: TestFailureClassification | null,
):
  | "test-accepted"
  | "test-another-attempt-requested"
  | "test-review-blocked"
  | "test-product-defect"
  | "test-escalated" {
  switch (decision) {
    case "accept":
      return "test-accepted";
    case "request-another-attempt":
      return "test-another-attempt-requested";
    case "blocked":
      return "test-review-blocked";
    case "escalate":
      return classification === "product-defect" ? "test-product-defect" : "test-escalated";
  }
}

/** 回调 prompt 需要的结果摘要：分支与提交只对实现结果存在。 */
export function summarizeResultForCallback(result: Readonly<TargetResult>): Readonly<{
  readonly outcome: TargetResultOutcome;
  readonly summary: string;
  readonly branch: string | null;
  readonly commits: readonly string[];
  readonly verdict: TestStepVerdict | null;
}> {
  if (result.workType === "test") {
    return Object.freeze({
      outcome: result.report.outcome,
      summary: result.report.summary,
      branch: null,
      commits: Object.freeze([]),
      verdict: result.report.verdict,
    });
  }
  const implementation: Readonly<ImplementationTargetResult> = result;
  return Object.freeze({
    outcome: implementation.report.outcome,
    summary: implementation.report.summary,
    branch: implementation.report.repositoryChange.branch,
    commits: Object.freeze(implementation.report.repositoryChange.commits.map(String)),
    verdict: null,
  });
}

/** 当前决定所附带升级事件的判定输入：由 lifecycle.demand-escalated 的 source 反查。 */
export function findReviewEscalationEventId(
  escalations: readonly Readonly<{
    readonly eventId: string;
    readonly source: Readonly<{ readonly kind: string; readonly targetReviewDecisionId?: string }>;
  }>[],
  decision: Readonly<ControllerReviewDecision> | null,
): string | null {
  if (decision === null) return null;
  const match = escalations.find(
    (entry) =>
      entry.source.kind === "review-decision" &&
      entry.source.targetReviewDecisionId === decision.targetReviewDecisionId,
  );
  return match === undefined ? null : match.eventId;
}
