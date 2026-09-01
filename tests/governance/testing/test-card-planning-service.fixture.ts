import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import type { TestCardAuthoredContent } from "../../../src/governance/testing/test-card.js";
import {
  cleanupAcceptedDemandCompletionWorkspaceFixture,
  createAcceptedDemandCompletionWorkspaceFixture,
  type AcceptedDemandCompletionWorkspaceFixture,
} from "../lifecycle/demand-completion-service.fixture.js";

export const TEST_CARD_CREATED_AT = parseUtcInstant("2026-08-29T12:20:00.000Z");

const TEST_CARD_UUIDS = Object.freeze([
  "e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1",
  "e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2",
  "e3e3e3e3-e3e3-43e3-83e3-e3e3e3e3e3e3",
  "e4e4e4e4-e4e4-44e4-84e4-e4e4e4e4e4e4",
]);

export interface TestCardPlanningWorkspaceFixture extends AcceptedDemandCompletionWorkspaceFixture {
  readonly testCardContent: Readonly<TestCardAuthoredContent>;
}

export interface TestCardPlanningWorkspaceFixtureOptions {
  readonly maxAttempts?: number;
  readonly executionPlacement?: "main" | "isolated";
}

export function testCardUuidFactory(): () => string {
  let index = 0;
  return () => TEST_CARD_UUIDS[index++] ?? "invalid";
}

export function createTestCardContentFixture(
  options: TestCardPlanningWorkspaceFixtureOptions = {},
): Readonly<TestCardAuthoredContent> {
  return Object.freeze({
    approvedPlan: Object.freeze([
      "在已确认环境执行冷启动并观察真实入口",
      "按需求记录输入、输出、日志与停止条件",
    ] as const),
    allowedSkills: Object.freeze([]),
    setupPolicy: "reuse-existing" as const,
    maxAttempts: options.maxAttempts ?? 1,
    question: "已接受实现能否在已确认真实环境中保持目标行为？",
    objectBoundary: "仅观察当前Demand涉及的产品入口和已确认测试环境",
    controllerSelfChecks: Object.freeze([
      "Controller已复核变更并运行聚焦测试",
      "所有implementation Target均已接受",
    ] as const),
    realScenarioConditions: Object.freeze([
      "使用冻结test-environment Authority描述的现有环境",
      "不创建或猜测额外配置与凭据",
    ] as const),
    successMeans: Object.freeze([
      "批准步骤均产生预期结果且证据可复核",
    ] as const),
    failureMeans: Object.freeze([
      "批准步骤复现产品缺陷或环境特定回归",
    ] as const),
    cannotConclude: Object.freeze([
      "不能据此扩大需求或替代Controller功能验收",
    ] as const),
    stopConditions: Object.freeze([
      "环境与冻结Authority不一致时立即停止",
      "需要未批准操作时返回blocked",
    ] as const),
    evidenceRequired: Object.freeze([
      "每个批准步骤的实际结果",
      "关键日志或截图的可定位引用",
    ] as const),
    allowedOperations: Object.freeze([
      "读取已确认环境状态",
      "执行批准的测试步骤",
    ] as const),
    forbiddenOperations: Object.freeze([
      "修改产品代码",
      "创建未批准环境或配置",
    ] as const),
  });
}

export async function createTestCardPlanningWorkspaceFixture(
  options: TestCardPlanningWorkspaceFixtureOptions = {},
): Promise<Readonly<TestCardPlanningWorkspaceFixture>> {
  const fixture = await createAcceptedDemandCompletionWorkspaceFixture({
    testingMode: "real-environment",
    ...(options.executionPlacement === undefined
      ? {}
      : { executionPlacement: options.executionPlacement }),
  });
  return Object.freeze({
    ...fixture,
    testCardContent: createTestCardContentFixture(options),
  });
}

export async function cleanupTestCardPlanningWorkspaceFixture(
  fixture: Readonly<TestCardPlanningWorkspaceFixture>,
): Promise<void> {
  await cleanupAcceptedDemandCompletionWorkspaceFixture(fixture);
}
