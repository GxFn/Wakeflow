import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import type { TargetTaskPlanningResult } from "../../../src/capabilities/tasking/contract.js";
import {
  executeTargetTaskPlanningPublicRequest,
  type ExecuteTargetTaskPlanningOptions,
} from "../../../src/capabilities/tasking/service.js";
import { TestCardPlanningService } from "../../../src/governance/testing/test-card-planning-service.js";
import type { TestCard } from "../../../src/governance/testing/test-card.js";
import {
  cleanupTestCardPlanningWorkspaceFixture,
  createTestCardPlanningWorkspaceFixture,
  TEST_CARD_CREATED_AT,
  testCardUuidFactory,
  type TestCardPlanningWorkspaceFixture,
  type TestCardPlanningWorkspaceFixtureOptions,
} from "./test-card-planning-service.fixture.js";

export const TEST_TASK_PACKAGE_CREATED_AT = parseUtcInstant(
  "2026-08-29T12:25:00.000Z",
);

const TEST_TASK_PLANNING_UUIDS = Object.freeze([
  "f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1",
  "f2f2f2f2-f2f2-42f2-82f2-f2f2f2f2f2f2",
  "f3f3f3f3-f3f3-43f3-83f3-f3f3f3f3f3f3",
]);

export interface TestTaskPlanningWorkspaceFixture extends TestCardPlanningWorkspaceFixture {
  readonly testCard: Readonly<TestCard>;
  readonly testTaskRequest: Readonly<{
    readonly demandId: string;
    readonly taskPackage: Readonly<{ readonly workType: "test" }>;
  }>;
}

export function testTaskPlanningUuidFactory(): () => string {
  let index = 0;
  return () => TEST_TASK_PLANNING_UUIDS[index++] ?? "invalid";
}

export async function createTestTaskPlanningWorkspaceFixture(
  options: TestCardPlanningWorkspaceFixtureOptions = {},
): Promise<Readonly<TestTaskPlanningWorkspaceFixture>> {
  const fixture = await createTestCardPlanningWorkspaceFixture(options);
  try {
    const service = new TestCardPlanningService(fixture.workspaceRoot);
    const preview = await service.preview(
      {
        demandId: fixture.demandId,
        testCard: fixture.testCardContent,
      },
      {
        clock: () => TEST_CARD_CREATED_AT,
        uuidFactory: testCardUuidFactory(),
      },
    );
    await service.apply(preview.plan, preview.planDigest);
    return Object.freeze({
      ...fixture,
      testCard: preview.plan.testCard,
      testTaskRequest: Object.freeze({
        demandId: fixture.demandId,
        taskPackage: Object.freeze({ workType: "test" as const }),
      }),
    });
  } catch (error: unknown) {
    await cleanupTestCardPlanningWorkspaceFixture(fixture);
    throw error;
  }
}

/** 经切片追加一份 test 任务包；期望修订由调用方给出（测试卡之后通常是 7）。 */
export async function planFixtureTestTask(
  fixture: Readonly<{ readonly workspacePath: string; readonly demandId: string }>,
  expectedStreamRevision: number,
  options: ExecuteTargetTaskPlanningOptions = { clock: () => TEST_TASK_PACKAGE_CREATED_AT },
  idempotencyKey = "fixture-test-plan-1",
): Promise<TargetTaskPlanningResult> {
  return executeTargetTaskPlanningPublicRequest(
    {
      root: fixture.workspacePath,
      demandId: fixture.demandId,
      idempotencyKey,
      expectedStreamRevision,
      taskPackage: { workType: "test" },
    },
    options,
  );
}

export async function cleanupTestTaskPlanningWorkspaceFixture(
  fixture: Readonly<TestTaskPlanningWorkspaceFixture>,
): Promise<void> {
  await cleanupTestCardPlanningWorkspaceFixture(fixture);
}
