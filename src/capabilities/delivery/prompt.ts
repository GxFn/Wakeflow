import type { WakeflowPresentationLanguage } from "../../configuration/wakeflow-config-v3.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import type {
  TargetDeliveryProductDefectRemediationContext,
  TargetDeliveryReworkContext,
} from "../../governance/delivery/delivery-envelope.js";
import type { TaskPackage } from "../../governance/tasking/task-package.js";
import { fail } from "../../kernel/error.js";
import { DELIVERY_REQUIRED_SKILLS } from "./decide.js";

/**
 * Wakeflow Capabilities / Delivery：投递 prompt 骨架（能力卡 5 Q6）。
 *
 * Controller 只写目标、完成焦点、边界三段；Wakeflow 渲染头行、验收锚点、阅读顺序、
 * 必需技能、身份块、交回指针与派发记录。prompt 只含可移植路径：工作区根以相对于窗口
 * 根的路径给出，绝对路径从不进入 prompt、事件或结果；摘要覆盖去除首尾空白后的文本。
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

export interface DeliveryPromptReadingOrder {
  /** 从窗口根到工作区根的相对路径，例如 `../..`；程序根窗口为 `.`。 */
  readonly workspaceRootFromWindow: string;
  readonly taskPackageRef: PortableResourcePath;
  readonly requirementSections: readonly string[];
  readonly workspaceInstructionFile: string;
  readonly repositoryInstructionFile: string | null;
  readonly stateRootRef: PortableResourcePath;
}

export interface DeliveryPromptReturn {
  readonly deliveryId: string;
  readonly claimDigest: string;
  readonly streamRevision: number;
  readonly generation: number;
}

export interface DeliveryTestContractSection {
  readonly approvedPlan: readonly string[];
  readonly allowedSkills: readonly string[];
  readonly setupDirective: string;
  readonly attemptOrdinal: number;
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
const MAXIMUM_PORTABLE_CHARACTERS = 60_000;
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
    returnInstruction: "用下面的 MCP 工具导入结果，不写本地结果文件；投递成功不等于验收。",
    noWrite: "不得把本 prompt 转发给其他窗口。",
  }),
});

function section(title: string, lines: readonly string[]): readonly string[] {
  return ["", `${title}:`, ...lines];
}

function anchorLines(taskPackage: Readonly<TaskPackage>): readonly string[] {
  return taskPackage.acceptanceAnchors
    .slice(0, MAXIMUM_ANCHORS)
    .map((anchor) => `- ${anchor.anchorId}: ${anchor.claim}`);
}

function readingLines(input: RenderDeliveryPromptInput): readonly string[] {
  const order = input.readingOrder;
  const sections =
    order.requirementSections.length === 0 ? "" : ` (${order.requirementSections.join(", ")})`;
  const root = order.workspaceRootFromWindow;
  const lines = [
    `1. ${root}/${order.taskPackageRef}`,
    `2. requirement.md${sections}`,
    `3. ${root}/${order.workspaceInstructionFile}`,
  ];
  if (order.repositoryInstructionFile !== null) lines.push(`4. ${order.repositoryInstructionFile}`);
  lines.push(`${lines.length + 1}. ${root}/${order.stateRootRef}`);
  return lines;
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
    ...correctionLines(remediation.requiredCorrections),
  ]);
}

function testLines(input: RenderDeliveryPromptInput, labels: Labels): readonly string[] {
  const contract = input.testContract;
  if (contract === null) return [];
  return section(labels.test, [
    `- attempt: ${contract.attemptOrdinal}`,
    `- environment: ${contract.setupDirective}`,
    ...contract.approvedPlan.map((step, index) => `- step ${index + 1}: ${step}`),
    ...(contract.allowedSkills.length === 0
      ? []
      : [`- allowed skills: ${contract.allowedSkills.join(", ")}`]),
    ...contract.stopConditions.map((condition) => `- stop when: ${condition}`),
  ]);
}

/** 确定性渲染可移植 prompt（不含工作区根）。 */
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
    ...(workType === "implementation" ? section(labels.anchors, anchorLines(taskPackage)) : []),
    ...testLines(input, labels),
    ...reworkLines(input, labels),
    ...remediationLines(input, labels),
    ...section(labels.reading, readingLines(input)),
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
  if (prompt.length > MAXIMUM_PORTABLE_CHARACTERS) {
    fail("capacity-exceeded", "prompt-capacity", "$prompt");
  }
  return prompt;
}
