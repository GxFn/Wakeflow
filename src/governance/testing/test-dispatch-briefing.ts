import type { WakeflowPresentationLanguage } from "../../configuration/wakeflow-config-v3.js";
import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import type { TestTaskPackage } from "../tasking/task-package.js";

/**
 * Wakeflow Governance / Testing：Test dispatch packet的有界briefing与轻量prompt。
 *
 * 完整任务、Card和执行合同分别留在TaskPackage、TestCard及packet结构字段中；本模块只
 * 选择目标窗口不能错过的前两项完成重点、第一条上下文和最高优先级边界，并生成可移植
 * 导航文本。它不读取文件、不查找Binding，也不把prompt提升为Authority。
 */

export const TEST_DISPATCH_REQUIRED_SKILLS = Object.freeze([
  "skills/wakeflow-target/SKILL.md",
  "skills/wakeflow-test/SKILL.md",
] as const);

const MAXIMUM_PROMPT_BYTES = 64 * 1024;

export type TestDispatchCriticalBoundaryKind =
  "forbidden" | "outOfScope" | "inScope";

export interface TestDispatchTaskBriefing {
  readonly workType: "test";
  readonly objective: string;
  readonly completionFocus: readonly [string] | readonly [string, string];
  readonly priorityContext: string;
  readonly criticalBoundary: Readonly<{
    readonly kind: TestDispatchCriticalBoundaryKind;
    readonly value: string;
  }>;
  readonly requiredSkills: typeof TEST_DISPATCH_REQUIRED_SKILLS;
}

export interface RenderTestDispatchPortablePromptInput {
  readonly packetRef: PortableResourcePath;
  readonly taskPackageRef: PortableResourcePath;
  readonly testCardRef: PortableResourcePath;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly windowId: WakeflowDurableId<"window">;
  readonly briefing: Readonly<TestDispatchTaskBriefing>;
  readonly language: WakeflowPresentationLanguage;
}

export class TestDispatchBriefingError extends Error {
  override readonly name = "TestDispatchBriefingError";
  readonly code = "wakeflow-test-dispatch-briefing" as const;
  readonly reason = "capacity" as const;

  constructor() {
    super("Test dispatch portable prompt exceeds its capacity.");
  }
}

function criticalBoundary(
  taskPackage: Readonly<TestTaskPackage>,
): TestDispatchTaskBriefing["criticalBoundary"] {
  const forbidden = taskPackage.boundaries.forbidden[0];
  if (forbidden !== undefined) {
    return Object.freeze({ kind: "forbidden" as const, value: forbidden });
  }
  const outOfScope = taskPackage.boundaries.outOfScope[0];
  if (outOfScope !== undefined) {
    return Object.freeze({ kind: "outOfScope" as const, value: outOfScope });
  }
  return Object.freeze({
    kind: "inScope" as const,
    value: taskPackage.boundaries.inScope[0],
  });
}

function completionFocus(
  taskPackage: Readonly<TestTaskPackage>,
): TestDispatchTaskBriefing["completionFocus"] {
  const first = taskPackage.completionExpectations[0];
  const second = taskPackage.completionExpectations[1];
  return second === undefined
    ? Object.freeze([first])
    : Object.freeze([first, second]);
}

/** 从完整Test TaskPackage确定性选择轻量briefing。 */
export function createTestDispatchTaskBriefing(
  taskPackage: Readonly<TestTaskPackage>,
): Readonly<TestDispatchTaskBriefing> {
  return Object.freeze({
    workType: "test" as const,
    objective: taskPackage.objective,
    completionFocus: completionFocus(taskPackage),
    priorityContext: taskPackage.confirmedContext[0],
    criticalBoundary: criticalBoundary(taskPackage),
    requiredSkills: TEST_DISPATCH_REQUIRED_SKILLS,
  });
}

/** 使用用户语言渲染不含absolute root或raw handle的目标导航prompt。 */
export function renderTestDispatchPortablePrompt(
  input: Readonly<RenderTestDispatchPortablePromptInput>,
): string {
  const completions = input.briefing.completionFocus.map(
    (value) => `- ${value}`,
  );
  const lines =
    input.language === "zh-Hans"
      ? [
          "Wakeflow Test 目标任务",
          "",
          `目标任务：${input.targetTaskId}`,
          "",
          "当前目标（完整上下文以TaskPackage为准）：",
          `- ${input.briefing.objective}`,
          "",
          "完成重点：",
          ...completions,
          "",
          `优先上下文：${input.briefing.priorityContext}`,
          `关键边界 [${input.briefing.criticalBoundary.kind}]：${input.briefing.criticalBoundary.value}`,
          "",
          "执行前按顺序阅读：",
          `- Test dispatch packet：${input.packetRef}`,
          `- TaskPackage：${input.taskPackageRef}`,
          `- TestCard：${input.testCardRef}`,
          "",
          "必需执行Skills：",
          ...input.briefing.requiredSkills.map((value) => `- ${value}`),
          "",
          "Test执行合同：",
          `- ${input.packetRef}#/testContract/executionContract`,
          "- 只执行Controller冻结的问题、环境、计划和方法；产品源码始终只读。",
          "- 缺失、冲突或未映射的输入必须返回Controller，不得自行补充。",
          "",
          `责任窗口：${input.windowId}`,
          "",
          "返回要求：",
          "- 只执行本TaskPackage并保留可复验的Test证据；Test结果不是Controller验收。",
        ]
      : [
          "Wakeflow Test Target Task",
          "",
          `Target task: ${input.targetTaskId}`,
          "",
          "Current objective (the TaskPackage owns complete context):",
          `- ${input.briefing.objective}`,
          "",
          "Completion focus:",
          ...completions,
          "",
          `Priority context: ${input.briefing.priorityContext}`,
          `Critical boundary [${input.briefing.criticalBoundary.kind}]: ${input.briefing.criticalBoundary.value}`,
          "",
          "Read before execution, in order:",
          `- Test dispatch packet: ${input.packetRef}`,
          `- TaskPackage: ${input.taskPackageRef}`,
          `- TestCard: ${input.testCardRef}`,
          "",
          "Required execution Skills:",
          ...input.briefing.requiredSkills.map((value) => `- ${value}`),
          "",
          "Test execution contract:",
          `- ${input.packetRef}#/testContract/executionContract`,
          "- Execute only the Controller-frozen question, environment, plan, and method; product source is always read-only.",
          "- Return missing, conflicting, or unmapped input to the Controller; never invent it.",
          "",
          `Responsibility window: ${input.windowId}`,
          "",
          "Return requirement:",
          "- Execute only this TaskPackage and preserve reproducible Test evidence; a Test result is not Controller acceptance.",
        ];
  const prompt = lines.join("\n");
  if (encodeUtf8(prompt, "$portablePrompt").byteLength > MAXIMUM_PROMPT_BYTES) {
    throw new TestDispatchBriefingError();
  }
  return prompt;
}
