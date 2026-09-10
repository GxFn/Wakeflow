import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  cleanupTestTaskPlanningWorkspaceFixture,
  createTestTaskPlanningWorkspaceFixture,
  planFixtureTestTask,
  type TestTaskPlanningWorkspaceFixture,
  type TestTaskPlanningWorkspaceFixtureOptions,
} from "../tasking/test-task-planning.fixture.js";
import {
  landFixturePrompt,
  loadFixtureDeliveryEnvelope,
  prepareFixtureDelivery,
  recordFixtureDeliveryOutcome,
  registerFixtureWindowRoute,
  type DeliveredTarget,
  type DeliveryWindowRoute,
  type PrepareFixtureDeliveryOverrides,
} from "./delivery-workspace.fixture.js";

/**
 * 测试链的投递工作区夹具：测试任务包（含测试合同）之后，为测试窗口登记绑定并走完投递三步。
 * 单独成文件是为了不让实现链的评审夹具与本夹具形成环。
 */

const TEST_BINDING_OBSERVED_AT = parseUtcInstant("2026-08-29T12:30:00.000Z");
const TEST_BINDING_REGISTERED_AT = parseUtcInstant("2026-08-29T12:29:00.000Z");
const TEST_BINDING_UUID = "a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4";
const TEST_RAW_HANDLE = "codex-host-thread:test-delivery-fixture";

export interface TestDeliveryWorkspaceFixture extends TestTaskPlanningWorkspaceFixture {
  readonly demandId: string;
  readonly testTargetTaskId: string;
  readonly testTaskPackageId: string;
  readonly testRoute: Readonly<DeliveryWindowRoute>;
}

export async function createTestDeliveryWorkspaceFixture(
  options: TestTaskPlanningWorkspaceFixtureOptions = {},
): Promise<Readonly<TestDeliveryWorkspaceFixture>> {
  const fixture = await createTestTaskPlanningWorkspaceFixture(options);
  try {
    const planned = await planFixtureTestTask(fixture, 6);
    if (planned.targetTask.workType !== "test") {
      throw new Error("Expected Test TaskPackage fixture.");
    }
    const testRoute = await registerFixtureWindowRoute(fixture, planned.targetTask.windowId, {
      value: TEST_RAW_HANDLE,
      uuid: TEST_BINDING_UUID,
      observedAt: TEST_BINDING_OBSERVED_AT,
      registeredAt: TEST_BINDING_REGISTERED_AT,
    });
    return Object.freeze({
      ...fixture,
      demandId: fixture.demandId,
      testTargetTaskId: planned.targetTask.targetTaskId,
      testTaskPackageId: planned.targetTask.taskPackageId,
      testRoute,
    });
  } catch (error: unknown) {
    await cleanupTestTaskPlanningWorkspaceFixture(fixture);
    throw error;
  }
}

export async function cleanupTestDeliveryWorkspaceFixture(
  fixture: Readonly<TestDeliveryWorkspaceFixture>,
): Promise<void> {
  await cleanupTestTaskPlanningWorkspaceFixture(fixture);
}

/** 测试目标同样三步；实现接受（6）与测试任务包（7）之后的期望修订缺省 7。 */
export async function deliverFixtureTestTarget(
  fixture: Readonly<TestDeliveryWorkspaceFixture>,
  overrides: PrepareFixtureDeliveryOverrides = {},
): Promise<Readonly<DeliveredTarget>> {
  const prepared = await prepareFixtureDelivery(
    { workspacePath: fixture.workspacePath, demandId: fixture.demandId, targetTaskId: fixture.testTargetTaskId },
    { expectedStreamRevision: 7, idempotencyKey: "fixture-test-prepare-1", ...overrides },
  );
  const landed = await landFixturePrompt(fixture, fixture.testRoute, prepared.permit.prompt);
  const recorded = await recordFixtureDeliveryOutcome(fixture, prepared, {
    idempotencyKey: "fixture-test-outcome-1",
  });
  if (recorded.outcome.disposition !== "accepted") {
    throw new Error("Expected an accepted Test delivery fixture.");
  }
  const envelope = await loadFixtureDeliveryEnvelope(fixture, prepared.delivery.deliveryId);
  return Object.freeze({ prepared, landed, recorded, envelope });
}
