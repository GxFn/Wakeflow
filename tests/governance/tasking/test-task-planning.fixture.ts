import type { TargetTaskPlanningResult } from "../../../src/capabilities/tasking/contract.js";
import {
  executeTargetTaskPlanningPublicRequest,
  type ExecuteTargetTaskPlanningOptions,
} from "../../../src/capabilities/tasking/service.js";
import type { WakeflowTargetTaskPlanningRequestV1 } from "../../../src/contracts/generated/entrypoints/wakeflow-target-task-planning-request.generated.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  cleanupAcceptedDemandCompletionWorkspaceFixture,
  createAcceptedDemandCompletionWorkspaceFixture,
  type AcceptedDemandCompletionWorkspaceFixture,
} from "../lifecycle/demand-completion-service.fixture.js";

/**
 * 测试任务包夹具：真实环境测试决策下、实现目标已被 Controller 接受的 Demand，加一份
 * Controller 撰写的测试合同请求。合同两步分别引用需求包验收标准 AC-1、AC-2；测试窗口、
 * 环境成员与实现基线由切片派生（能力卡 5 修订 5.2）。
 */

export const TEST_TASK_PACKAGE_CREATED_AT = parseUtcInstant("2026-08-29T12:25:00.000Z");

export type TestTaskPackageRequest = Extract<
  WakeflowTargetTaskPlanningRequestV1["taskPackage"],
  { readonly workType: "test" }
>;

export interface TestTaskPlanningWorkspaceFixture extends AcceptedDemandCompletionWorkspaceFixture {
  readonly testTaskRequest: Readonly<{
    readonly demandId: string;
    readonly taskPackage: TestTaskPackageRequest;
  }>;
  /** 合同步骤由 Wakeflow 编号为 ts-1..ts-n；结果导入按此回报逐步证据。 */
  readonly testStepIds: readonly string[];
}

export interface TestTaskPlanningWorkspaceFixtureOptions {
  readonly maxAttempts?: number;
  readonly executionPlacement?: "main" | "isolated";
}

export function createTestContractRequestFixture(
  recordDigest: string,
  options: TestTaskPlanningWorkspaceFixtureOptions = {},
): TestTaskPackageRequest["testContract"] {
  const requirementRef = (itemId: string) => ({
    recordDigest,
    sectionAnchor: "acceptance-criteria",
    itemId,
  });
  return {
    question: "已接受实现能否在已确认真实环境中保持目标行为？",
    objectBoundary: "仅观察当前Demand涉及的产品入口和已确认测试环境",
    steps: [
      {
        given: "已确认的真实环境与冻结实现基线",
        when: "执行冷启动并观察真实入口",
        // biome-ignore lint/suspicious/noThenProperty: Given/When/Then 合同步骤字段（§13.85 D1）
        then: "入口按需求响应且无环境特定回归",
        requirementRef: requirementRef("ac-1"),
      },
      {
        given: "冷启动已完成",
        when: "按需求记录输入、输出与日志",
        // biome-ignore lint/suspicious/noThenProperty: Given/When/Then 合同步骤字段（§13.85 D1）
        then: "记录与需求一致且满足停止条件",
        requirementRef: requirementRef("ac-2"),
      },
    ],
    allowedSkills: [],
    setupPolicy: "reuse-existing",
    maxAttempts: options.maxAttempts ?? 1,
    stopConditions: ["环境与冻结Authority不一致时立即停止", "需要未批准操作时返回blocked"],
  };
}

export function createTestTaskPackageRequestFixture(
  fixture: Readonly<{
    readonly recordDigest: string;
    readonly request: Readonly<{
      readonly taskPackage: Readonly<{ readonly selectedAuthorityMemberRefs: readonly string[] }>;
    }>;
  }>,
  options: TestTaskPlanningWorkspaceFixtureOptions = {},
): TestTaskPackageRequest {
  const [first, ...rest] = fixture.request.taskPackage.selectedAuthorityMemberRefs;
  if (first === undefined) throw new Error("Expected at least one authority member reference.");
  return {
    workType: "test",
    objective: "在已确认真实环境中验证已接受实现",
    confirmedContext: ["全部实现目标已被Controller接受", "测试环境由需求包landing成员描述"],
    selectedAuthorityMemberRefs: [first, ...rest],
    boundaries: {
      inScope: ["执行测试合同的批准步骤"],
      outOfScope: ["修改产品代码"],
      forbidden: ["创建未批准环境或配置"],
    },
    completionExpectations: ["每一步都返回可复核证据", "结果按合同stepId回报"],
    testContract: createTestContractRequestFixture(fixture.recordDigest, options),
    lineage: null,
  };
}

export async function createTestTaskPlanningWorkspaceFixture(
  options: TestTaskPlanningWorkspaceFixtureOptions = {},
): Promise<Readonly<TestTaskPlanningWorkspaceFixture>> {
  const fixture = await createAcceptedDemandCompletionWorkspaceFixture({
    testingMode: "real-environment",
    ...(options.executionPlacement === undefined
      ? {}
      : { executionPlacement: options.executionPlacement }),
  });
  const taskPackage = createTestTaskPackageRequestFixture(fixture, options);
  return Object.freeze({
    ...fixture,
    testTaskRequest: Object.freeze({ demandId: fixture.demandId, taskPackage }),
    testStepIds: Object.freeze(
      taskPackage.testContract.steps.map((_step, index) => `ts-${index + 1}`),
    ),
  });
}

/** 经切片追加一份 test 任务包；期望修订由调用方给出（实现接受之后通常是 6）。 */
export async function planFixtureTestTask(
  fixture: Readonly<{
    readonly workspacePath: string;
    readonly testTaskRequest: TestTaskPlanningWorkspaceFixture["testTaskRequest"];
  }>,
  expectedStreamRevision: number,
  overrides: Readonly<{
    readonly idempotencyKey?: string;
    readonly taskPackage?: Partial<TestTaskPackageRequest>;
  }> = {},
  options: ExecuteTargetTaskPlanningOptions = { clock: () => TEST_TASK_PACKAGE_CREATED_AT },
): Promise<TargetTaskPlanningResult> {
  return executeTargetTaskPlanningPublicRequest(
    {
      root: fixture.workspacePath,
      demandId: fixture.testTaskRequest.demandId,
      idempotencyKey: overrides.idempotencyKey ?? "fixture-test-plan-1",
      expectedStreamRevision,
      taskPackage: { ...fixture.testTaskRequest.taskPackage, ...overrides.taskPackage },
    },
    options,
  );
}

export async function cleanupTestTaskPlanningWorkspaceFixture(
  fixture: Readonly<TestTaskPlanningWorkspaceFixture>,
): Promise<void> {
  await cleanupAcceptedDemandCompletionWorkspaceFixture(fixture);
}
