import type { WakeflowPresentationLanguage } from "../../configuration/wakeflow-config.js";
import { fail } from "../../kernel/error.js";
import { WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME } from "./contract.js";

/**
 * Wakeflow Capabilities / Result Review：wake-controller 回调 prompt（ADR-0012 D1，§13.87 D1）。
 *
 * 回调只传输证据：Demand、pod、目标与包摘要、结果的陈述与摘要、分支与提交、结果身份与流修订、
 * 下一步工具名。不含路径、句柄或任何本机值；摘要覆盖去除首尾空白后的文本，Controller 会话的
 * `user-prompt-submit` 记录以此为落地证据。
 */

export interface WakeControllerPromptInput {
  readonly language: WakeflowPresentationLanguage;
  readonly demandId: string;
  readonly podId: string;
  readonly target: Readonly<{
    readonly targetTaskId: string;
    readonly taskPackageId: string;
    readonly workType: "implementation" | "test";
    readonly objective: string;
  }>;
  readonly result: Readonly<{
    readonly targetResultId: string;
    readonly resultDigest: string;
    readonly outcome: string;
    readonly summary: string;
    readonly branch: string | null;
    readonly commits: readonly string[];
    readonly verdict: string | null;
    /** 结果事件追加后的流修订：Controller 检查与决定的期望修订从这里起算。 */
    readonly streamRevision: number;
  }>;
}

const MAXIMUM_PORTABLE_CHARACTERS = 20_000;
const MAXIMUM_SUMMARY_CODE_POINTS = 600;

type Labels = Readonly<
  Record<
    | "header"
    | "identity"
    | "demand"
    | "pod"
    | "target"
    | "package"
    | "objective"
    | "result"
    | "outcome"
    | "verdict"
    | "summary"
    | "branch"
    | "commits"
    | "resultId"
    | "resultDigest"
    | "streamRevision"
    | "next"
    | "nextInstruction"
    | "transportOnly",
    string
  >
>;

const LABELS: Readonly<Record<WakeflowPresentationLanguage, Labels>> = Object.freeze({
  en: Object.freeze({
    header: "Wakeflow callback: a target result is ready for review",
    identity: "Identity",
    demand: "demand",
    pod: "pod",
    target: "target task",
    package: "task package",
    objective: "objective",
    result: "Result",
    outcome: "outcome",
    verdict: "test verdict",
    summary: "summary",
    branch: "branch",
    commits: "commits",
    resultId: "targetResultId",
    resultDigest: "resultDigest",
    streamRevision: "streamRevision",
    next: "Next",
    nextInstruction: "Inspect the review unit with the MCP tool below, then record your decision.",
    transportOnly:
      "This callback only transports evidence; it is not acceptance and carries no authority.",
  }),
  "zh-Hans": Object.freeze({
    header: "Wakeflow 回调：一份目标结果待评审",
    identity: "身份",
    demand: "demand",
    pod: "pod",
    target: "目标任务",
    package: "任务包",
    objective: "目标",
    result: "结果",
    outcome: "陈述",
    verdict: "测试判定",
    summary: "摘要",
    branch: "分支",
    commits: "提交",
    resultId: "targetResultId",
    resultDigest: "resultDigest",
    streamRevision: "streamRevision",
    next: "下一步",
    nextInstruction: "用下面的 MCP 工具读取评审单元，再记录你的决定。",
    transportOnly: "本回调只是传输证据，不是验收，也不携带任何授权。",
  }),
});

function section(title: string, lines: readonly string[]): readonly string[] {
  return ["", `${title}:`, ...lines];
}

function clip(text: string): string {
  const codePoints = Array.from(text.trim());
  return codePoints.length <= MAXIMUM_SUMMARY_CODE_POINTS
    ? codePoints.join("")
    : `${codePoints.slice(0, MAXIMUM_SUMMARY_CODE_POINTS - 1).join("")}…`;
}

/** 确定性渲染回调 prompt；同一输入永远得到同一文本与摘要。 */
export function renderWakeControllerPrompt(input: Readonly<WakeControllerPromptInput>): string {
  const labels = LABELS[input.language];
  const { target, result } = input;
  const lines = [
    `${labels.header}: ${target.targetTaskId}`,
    ...section(labels.identity, [
      `- ${labels.demand}: ${input.demandId}`,
      `- ${labels.pod}: ${input.podId}`,
      `- ${labels.target}: ${target.targetTaskId} (${target.workType})`,
      `- ${labels.package}: ${target.taskPackageId}`,
      `- ${labels.objective}: ${clip(target.objective)}`,
    ]),
    ...section(labels.result, [
      `- ${labels.outcome}: ${result.outcome}`,
      ...(result.verdict === null ? [] : [`- ${labels.verdict}: ${result.verdict}`]),
      `- ${labels.summary}: ${clip(result.summary)}`,
      ...(result.branch === null ? [] : [`- ${labels.branch}: ${result.branch}`]),
      ...(result.commits.length === 0 ? [] : [`- ${labels.commits}: ${result.commits.join(", ")}`]),
      `- ${labels.resultId}: ${result.targetResultId}`,
      `- ${labels.resultDigest}: ${result.resultDigest}`,
      `- ${labels.streamRevision}: ${result.streamRevision}`,
    ]),
    ...section(labels.next, [
      labels.nextInstruction,
      `- tool: ${WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME}`,
      `- demandId: ${input.demandId}`,
      `- targetTaskId: ${target.targetTaskId}`,
      labels.transportOnly,
    ]),
  ];
  const prompt = lines.join("\n");
  if (prompt.length > MAXIMUM_PORTABLE_CHARACTERS) {
    fail("capacity-exceeded", "prompt-capacity", "$prompt");
  }
  return prompt;
}
