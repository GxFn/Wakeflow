import path from "node:path";

import type { WakeflowPresentationLanguage } from "../../configuration/wakeflow-config.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import {
  DELIVERY_PROMPT_MAXIMUM_CHARACTERS,
  type TargetDeliveryProductDefectRemediationContext,
  type TargetDeliveryReworkContext,
} from "../../governance/delivery/delivery-envelope.js";
import type { LedgerAuthorityMemberReference } from "../../governance/ledger/ledger-authority-store-contract.js";
import type { RequirementSection } from "../../governance/ledger/ledger-authority-record.js";
import type { TaskPackage } from "../../governance/tasking/task-package.js";
import { fail } from "../../kernel/error.js";
import { DELIVERY_REQUIRED_SKILLS } from "./decide.js";

/**
 * Wakeflow Capabilities / Delivery：投递 prompt 骨架（能力卡 5 Q6）。
 *
 * Controller 只写目标、完成焦点、边界三段；Wakeflow 渲染头行、验收锚点、阅读顺序、
 * 必需技能、身份块、交回指针与派发记录。prompt 只含可移植路径：工作区根以相对于窗口
 * 根的路径给出，绝对路径从不进入 prompt、事件或结果；摘要覆盖去除首尾空白后的文本。
 * 阅读顺序按文档列出需求包成员：每份文档一条从窗口根可解析的 ledger 路径，任务包指向的
 * 章节列在它所在的文档下（gate-log §13.134）。
 */

export interface DeliveryPromptAuthored {
  readonly goal: string;
  readonly focus: readonly string[];
  readonly boundary: string;
}

export interface DeliveryPromptIdentity {
  readonly demandId: string;
  readonly podId: string;
  readonly windowId: string;
  readonly repositoryId: string | null;
  readonly bindingId: string;
}

/** 需求包的一份成员文档：ledger 内的 memberRef，以及需求包记录放在这份文档里的章节锚点。 */
export interface DeliveryPromptRequirementDocument {
  readonly role: LedgerAuthorityMemberReference["role"];
  readonly memberRef: PortableResourcePath;
  readonly sectionAnchors: readonly string[];
}

/** 阅读顺序里的需求包（§13.134）：ledger 根的配置位置（相对工作区根）与 Demand 权威引用的全部成员。 */
export interface DeliveryPromptRequirementPackage {
  readonly ledgerRootFromWorkspace: string;
  readonly documents: readonly Readonly<DeliveryPromptRequirementDocument>[];
}

export interface DeliveryPromptReadingOrder {
  /** 从窗口根到工作区根的相对路径，例如 `..` 或兄弟目录窗口的 `../Workspace`；程序根窗口为 `.`；worktree 检出按回执路径计算。 */
  readonly workspaceRootFromWindow: string;
  /** worktree pod 的测试任务：每仓库一条从本窗口根到 worktree 检出的相对路径（ADR-0010 D4）。 */
  readonly attachedWorktrees: readonly Readonly<{
    readonly repositoryId: string;
    readonly pathFromWindow: string;
  }>[];
  readonly taskPackageRef: PortableResourcePath;
  /** 任务包指向的章节锚点（按任务包顺序）；渲染时归到需求包里各自所在的文档下。 */
  readonly requirementSections: readonly string[];
  /** 需求包成员：每份文档在阅读顺序里各占一条从窗口根可解析的路径（§13.134，收 §13.133 I7）。 */
  readonly requirementPackage: Readonly<DeliveryPromptRequirementPackage>;
  readonly workspaceInstructionFile: string;
  readonly repositoryInstructionFile: string | null;
  readonly stateRootRef: PortableResourcePath;
}

/** 从 Demand 权威引用读出的需求包成员视图；`ResolvedDemandAuthorityReference` 结构上满足它。 */
export interface DeliveryPromptResolvedAuthorityMember {
  readonly reference: Readonly<
    Pick<LedgerAuthorityMemberReference, "role" | "memberPath" | "memberRef">
  >;
  readonly record: Readonly<{
    readonly record: Readonly<{
      readonly sections: readonly Readonly<Pick<RequirementSection, "path" | "anchor">>[];
    }>;
  }>;
}

/**
 * 由 Demand 权威引用（`admittedAuthority.resolvedAuthority`）与配置的 ledger 位置得出阅读顺序里的
 * 需求包：每个成员带上记录里落在该成员路径上的章节锚点（§13.134）。
 */
export function deliveryPromptRequirementPackage(
  ledgerRootFromWorkspace: string,
  members: readonly Readonly<DeliveryPromptResolvedAuthorityMember>[],
): Readonly<DeliveryPromptRequirementPackage> {
  return Object.freeze({
    ledgerRootFromWorkspace,
    documents: Object.freeze(
      members.map(({ reference, record }) =>
        Object.freeze({
          role: reference.role,
          memberRef: reference.memberRef,
          sectionAnchors: Object.freeze(
            record.record.sections
              .filter((section) => section.path === reference.memberPath)
              .map((section) => section.anchor),
          ),
        }),
      ),
    ),
  });
}

export interface DeliveryPromptReturn {
  readonly deliveryId: string;
  readonly claimDigest: string;
  readonly streamRevision: number;
  readonly generation: number;
}

export interface DeliveryTestContractStepSection {
  readonly stepId: string;
  readonly given: string;
  readonly when: string;
  readonly then: string;
}

/** 测试合同在 prompt 里的可移植摘要：问题、边界、逐步 GWT、环境成员与尝试预算。 */
export interface DeliveryTestContractSection {
  readonly question: string;
  readonly objectBoundary: string;
  readonly steps: readonly Readonly<DeliveryTestContractStepSection>[];
  readonly environmentMemberRef: string;
  readonly allowedSkills: readonly string[];
  readonly setupDirective: string;
  readonly attemptOrdinal: number;
  readonly maxAttempts: number;
  readonly stopConditions: readonly string[];
}

export interface RenderDeliveryPromptInput {
  readonly language: WakeflowPresentationLanguage;
  readonly displayTitle: string;
  readonly taskPackage: Readonly<TaskPackage>;
  readonly authored: Readonly<DeliveryPromptAuthored>;
  readonly identity: Readonly<DeliveryPromptIdentity>;
  readonly readingOrder: Readonly<DeliveryPromptReadingOrder>;
  readonly returnPointer: Readonly<DeliveryPromptReturn>;
  readonly rework: Readonly<TargetDeliveryReworkContext> | null;
  readonly productDefectRemediation: Readonly<TargetDeliveryProductDefectRemediationContext> | null;
  readonly testContract: Readonly<DeliveryTestContractSection> | null;
}

const MAXIMUM_ANCHORS = 4;
const RETURN_TOOL = "wakeflow_import_target_result";

type Labels = Readonly<
  Record<
    | "header"
    | "goal"
    | "focus"
    | "context"
    | "boundary"
    | "anchors"
    | "reading"
    | "skills"
    | "identity"
    | "return"
    | "record"
    | "rework"
    | "remediation"
    | "test"
    | "pod"
    | "window"
    | "repository"
    | "binding"
    | "demand"
    | "workspaceRoot"
    | "worktrees"
    | "sections"
    | "moreAnchors"
    | "returnInstruction"
    | "noWrite",
    string
  >
>;

const LABELS: Readonly<Record<WakeflowPresentationLanguage, Labels>> = Object.freeze({
  en: Object.freeze({
    header: "Continue current window task",
    goal: "Goal",
    focus: "Completion focus",
    context: "Priority context",
    boundary: "Critical boundary",
    anchors: "Acceptance anchors",
    reading: "Read in this order",
    skills: "Required skills",
    identity: "Identity",
    return: "Return",
    record: "Dispatch record",
    rework: "Rework basis (continue the same TaskPackage)",
    remediation: "Product-defect remediation basis (continue the same TaskPackage)",
    test: "Test contract",
    pod: "pod",
    window: "window",
    repository: "repository",
    binding: "binding",
    demand: "demand",
    workspaceRoot: "workspace root (relative to this window's root)",
    worktrees: "pod worktrees to read (relative to this window's root)",
    sections: "sections",
    moreAnchors: "more acceptance anchors are in the task package",
    returnInstruction:
      "Import the result with the MCP tool below; do not write result files. Delivery is not acceptance.",
    noWrite: "Never send this prompt onward to another window.",
  }),
  "zh-Hans": Object.freeze({
    header: "继续当前窗口任务",
    goal: "目标",
    focus: "完成焦点",
    context: "优先上下文",
    boundary: "关键边界",
    anchors: "验收锚点",
    reading: "按序阅读",
    skills: "必需技能",
    identity: "身份",
    return: "交回",
    record: "派发记录",
    rework: "返工依据（继续执行同一 TaskPackage）",
    remediation: "产品缺陷修复依据（继续执行同一 TaskPackage）",
    test: "测试合同",
    pod: "pod",
    window: "窗口",
    repository: "仓库",
    binding: "绑定",
    demand: "demand",
    workspaceRoot: "工作区根（相对本窗口根）",
    worktrees: "要读取的 pod worktree（相对本窗口根）",
    sections: "章节",
    moreAnchors: "条验收锚点在任务包里",
    returnInstruction: "用下面的 MCP 工具导入结果，不写本地结果文件；投递成功不等于验收。",
    noWrite: "不得把本 prompt 转发给其他窗口。",
  }),
});

function section(title: string, lines: readonly string[]): readonly string[] {
  return ["", `${title}:`, ...lines];
}

// 提示词只列前 MAXIMUM_ANCHORS 条；多出来的点明条数，目标窗口才知道要去任务包里找（§13.134 现场：第 5 条被静默略去）。
function anchorLines(taskPackage: Readonly<TaskPackage>, labels: Labels): readonly string[] {
  const anchors = taskPackage.acceptanceAnchors;
  const hidden = anchors.length - MAXIMUM_ANCHORS;
  return [
    ...anchors.slice(0, MAXIMUM_ANCHORS).map((anchor) => `- ${anchor.anchorId}: ${anchor.claim}`),
    ...(hidden > 0 ? [`- … ${hidden} ${labels.moreAnchors}`] : []),
  ];
}

interface ReadingEntry {
  readonly target: string;
  readonly sections: readonly string[];
}

/** requirement.md 先于 landing.md，附件随后按 memberRef 排序。 */
const DOCUMENT_ROLE_ORDER: readonly string[] = Object.freeze(["requirement", "landing"]);

function documentRank(document: Readonly<DeliveryPromptRequirementDocument>): number {
  const rank = DOCUMENT_ROLE_ORDER.indexOf(document.role);
  return rank === -1 ? DOCUMENT_ROLE_ORDER.length : rank;
}

function compareDocuments(
  left: Readonly<DeliveryPromptRequirementDocument>,
  right: Readonly<DeliveryPromptRequirementDocument>,
): number {
  const rank = documentRank(left) - documentRank(right);
  if (rank !== 0) return rank;
  return left.memberRef < right.memberRef ? -1 : left.memberRef > right.memberRef ? 1 : 0;
}

/** 每份需求包文档一条可解析路径：窗口根 → 工作区根 → ledger 根 → memberRef；章节归到所在文档（§13.134）。 */
function requirementEntries(order: Readonly<DeliveryPromptReadingOrder>): readonly ReadingEntry[] {
  const requirementPackage = order.requirementPackage;
  const ledgerRoot = path.posix.join(
    order.workspaceRootFromWindow,
    requirementPackage.ledgerRootFromWorkspace,
  );
  return [...requirementPackage.documents].sort(compareDocuments).map((document) => ({
    target: path.posix.join(ledgerRoot, document.memberRef),
    sections: order.requirementSections.filter((anchor) =>
      document.sectionAnchors.includes(anchor),
    ),
  }));
}

function readingLines(input: RenderDeliveryPromptInput, labels: Labels): readonly string[] {
  const order = input.readingOrder;
  const root = order.workspaceRootFromWindow;
  const entries: ReadingEntry[] = [
    { target: `${root}/${order.taskPackageRef}`, sections: [] },
    ...requirementEntries(order),
    { target: `${root}/${order.workspaceInstructionFile}`, sections: [] },
  ];
  if (order.repositoryInstructionFile !== null) {
    entries.push({ target: order.repositoryInstructionFile, sections: [] });
  }
  entries.push({ target: `${root}/${order.stateRootRef}`, sections: [] });
  return entries.flatMap((entry, index) => [
    `${index + 1}. ${entry.target}`,
    ...(entry.sections.length === 0 ? [] : [`   ${labels.sections}: ${entry.sections.join(", ")}`]),
  ]);
}

function worktreeLines(input: RenderDeliveryPromptInput, labels: Labels): readonly string[] {
  const attached = input.readingOrder.attachedWorktrees;
  if (attached.length === 0) return [];
  return section(
    labels.worktrees,
    attached.map((entry) => `- ${entry.repositoryId}: ${entry.pathFromWindow}`),
  );
}

function identityLines(input: RenderDeliveryPromptInput, labels: Labels): readonly string[] {
  const identity = input.identity;
  const lines = [
    `- ${labels.demand}: ${identity.demandId}`,
    `- ${labels.pod}: ${identity.podId}`,
    `- ${labels.window}: ${identity.windowId}`,
  ];
  if (identity.repositoryId !== null)
    lines.push(`- ${labels.repository}: ${identity.repositoryId}`);
  lines.push(`- ${labels.binding}: ${identity.bindingId}`);
  lines.push(`- ${labels.workspaceRoot}: ${input.readingOrder.workspaceRootFromWindow}`);
  return lines;
}

function correctionLines(
  corrections: readonly Readonly<{
    readonly checkId: string;
    readonly outcome: string;
    readonly methodSummary: string;
    readonly observationSummary: string;
  }>[],
): readonly string[] {
  return corrections.flatMap((correction) => [
    `- [${correction.outcome}] ${correction.checkId}`,
    `  method: ${correction.methodSummary}`,
    `  observed: ${correction.observationSummary}`,
  ]);
}

function reworkLines(input: RenderDeliveryPromptInput, labels: Labels): readonly string[] {
  const rework = input.rework;
  if (rework === null) return [];
  return section(labels.rework, [
    `- decision: ${rework.decision.targetReviewDecisionId} / ${rework.decision.decisionDigest}`,
    `- previous result: ${rework.previousResult.targetResultId} / ${rework.previousResult.resultDigest}`,
    `- rationale: ${rework.rationaleSummary}`,
    ...correctionLines(rework.requiredCorrections),
  ]);
}

function remediationLines(input: RenderDeliveryPromptInput, labels: Labels): readonly string[] {
  const remediation = input.productDefectRemediation;
  if (remediation === null) return [];
  return section(labels.remediation, [
    `- authorization: ${remediation.authorization.productDefectRemediationId} / ${remediation.authorization.authorizationDigest}`,
    `- test review decision: ${remediation.testReviewDecision.targetReviewDecisionId} / ${remediation.testReviewDecision.decisionDigest}`,
    `- previous result: ${remediation.previousResult.targetResultId} / ${remediation.previousResult.resultDigest}`,
    `- rationale: ${remediation.authorizationRationaleSummary}`,
    `- objective: ${remediation.correctionObjectiveSummary}`,
    ...remediation.requiredCorrections.map(
      (correction) => `- [fail] ${correction.stepId}: ${correction.observedSummary}`,
    ),
  ]);
}

function testLines(input: RenderDeliveryPromptInput, labels: Labels): readonly string[] {
  const contract = input.testContract;
  if (contract === null) return [];
  return section(labels.test, [
    `- question: ${contract.question}`,
    `- object boundary: ${contract.objectBoundary}`,
    `- attempt: ${contract.attemptOrdinal} of ${contract.maxAttempts}`,
    `- environment: ${contract.environmentMemberRef}`,
    `- setup: ${contract.setupDirective}`,
    ...contract.steps.map(
      (step) => `- ${step.stepId}: given ${step.given}; when ${step.when}; then ${step.then}`,
    ),
    ...(contract.allowedSkills.length === 0
      ? []
      : [`- allowed skills: ${contract.allowedSkills.join(", ")}`]),
    ...contract.stopConditions.map((condition) => `- stop when: ${condition}`),
  ]);
}

/** 确定性渲染可移植 prompt（不含绝对路径；工作区根只以相对窗口根的路径出现）。 */
export function renderDeliveryPortablePrompt(input: Readonly<RenderDeliveryPromptInput>): string {
  const labels = LABELS[input.language];
  const taskPackage = input.taskPackage;
  const workType = taskPackage.workType;
  const lines = [
    `${labels.header}: ${input.displayTitle}/${taskPackage.targetTaskId}`,
    ...section(labels.goal, [input.authored.goal]),
    ...section(
      labels.focus,
      input.authored.focus.map((entry) => `- ${entry}`),
    ),
    ...section(labels.context, [taskPackage.confirmedContext[0] ?? taskPackage.objective]),
    ...section(labels.boundary, [
      `- ${input.authored.boundary}`,
      ...(taskPackage.boundaries.forbidden[0] === undefined
        ? []
        : [`- forbidden: ${taskPackage.boundaries.forbidden[0]}`]),
    ]),
    ...(workType === "implementation"
      ? section(labels.anchors, anchorLines(taskPackage, labels))
      : []),
    ...testLines(input, labels),
    ...reworkLines(input, labels),
    ...remediationLines(input, labels),
    ...section(labels.reading, readingLines(input, labels)),
    ...worktreeLines(input, labels),
    ...section(
      labels.skills,
      DELIVERY_REQUIRED_SKILLS[workType].map((skill) => `- ${skill}`),
    ),
    ...section(labels.identity, identityLines(input, labels)),
    ...section(labels.return, [
      labels.returnInstruction,
      `- tool: ${RETURN_TOOL}`,
      `- deliveryId: ${input.returnPointer.deliveryId}`,
      `- claimDigest: ${input.returnPointer.claimDigest}`,
      labels.noWrite,
    ]),
    ...section(labels.record, [
      `- deliveryId: ${input.returnPointer.deliveryId}`,
      `- generation: ${input.returnPointer.generation}`,
      `- claimDigest: ${input.returnPointer.claimDigest}`,
      `- streamRevision: ${input.returnPointer.streamRevision}`,
    ]),
  ];
  const prompt = lines.join("\n");
  if (prompt.length > DELIVERY_PROMPT_MAXIMUM_CHARACTERS) {
    fail("capacity-exceeded", "prompt-capacity", "$prompt");
  }
  return prompt;
}
