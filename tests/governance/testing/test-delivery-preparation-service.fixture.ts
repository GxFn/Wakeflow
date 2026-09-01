import { parseWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { TargetTaskPlanningService } from "../../../src/governance/tasking/target-task-planning-service.js";
import { registerWakeflowWindowHostBinding } from "../../../src/workspace/window-runtime/wakeflow-window-host-binding-registration.js";
import { compileWakeflowWindowLaunchIntents } from "../../../src/workspace/window-runtime/wakeflow-window-launch-intent.js";
import { createMinimalWakeflowConfigV3 } from "../../configuration/wakeflow-config-v3.fixture.js";
import {
  cleanupTestTaskPlanningWorkspaceFixture,
  createTestTaskPlanningWorkspaceFixture,
  TEST_TASK_PACKAGE_CREATED_AT,
  testTaskPlanningUuidFactory,
  type TestTaskPlanningWorkspaceFixture,
} from "./test-task-planning-service.fixture.js";
import type { TestCardPlanningWorkspaceFixtureOptions } from "./test-card-planning-service.fixture.js";

export const TEST_DELIVERY_PREPARED_AT = parseUtcInstant(
  "2026-08-29T12:19:00.000Z",
);

const TEST_BINDING_OBSERVED_AT = parseUtcInstant("2026-08-29T12:30:00.000Z");
const TEST_BINDING_REGISTERED_AT = parseUtcInstant("2026-08-29T12:29:00.000Z");
const TEST_BINDING_UUID = "a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4";
const TEST_RAW_HANDLE = "codex-host-thread:test-delivery-preparation-fixture";
const TEST_DELIVERY_UUIDS = Object.freeze([
  "a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5",
  "a6a6a6a6-a6a6-46a6-86a6-a6a6a6a6a6a6",
  "a7a7a7a7-a7a7-47a7-87a7-a7a7a7a7a7a7",
  "a8a8a8a8-a8a8-48a8-88a8-a8a8a8a8a8a8",
]);

export interface TestDeliveryPreparationWorkspaceFixture extends TestTaskPlanningWorkspaceFixture {
  readonly testTargetTaskId: string;
  readonly testTaskPackageId: string;
  readonly testBindingId: string;
  readonly testRawHandle: string;
  readonly testDeliveryRequest: Readonly<{
    readonly demandId: string;
    readonly targetTaskId: string;
  }>;
}

export function testDeliveryUuidFactory(): () => string {
  let index = 0;
  return () => TEST_DELIVERY_UUIDS[index++] ?? "invalid";
}

export async function createTestDeliveryPreparationWorkspaceFixture(
  options: TestCardPlanningWorkspaceFixtureOptions = {},
): Promise<Readonly<TestDeliveryPreparationWorkspaceFixture>> {
  const fixture = await createTestTaskPlanningWorkspaceFixture(options);
  const config = parseWakeflowConfigV3(createMinimalWakeflowConfigV3());
  try {
    const planning = new TargetTaskPlanningService(fixture.workspaceRoot);
    const preview = await planning.preview(fixture.testTaskRequest, {
      clock: () => TEST_TASK_PACKAGE_CREATED_AT,
      uuidFactory: testTaskPlanningUuidFactory(),
    });
    await planning.apply(preview.plan, preview.planDigest);
    if (preview.plan.taskPackage.workType !== "test") {
      throw new Error("Expected Test TaskPackage fixture.");
    }
    const launchIntent = compileWakeflowWindowLaunchIntents(
      config,
      codexWorkspaceHostResourceProfile,
    ).intents.find(
      (entry) =>
        entry.windowId === preview.plan.taskPackage.assignment.windowId,
    );
    if (launchIntent === undefined) {
      throw new Error("Expected exact Test window launch intent.");
    }
    const registration = await registerWakeflowWindowHostBinding(
      fixture.workspaceRoot,
      {
        config,
        resourceProfile: codexWorkspaceHostResourceProfile,
        identityProfile: codexWindowHostIdentityProfile,
        observation: {
          hostId: "codex",
          windowId: launchIntent.windowId,
          launchIntentDigest: launchIntent.intentDigest,
          handle: { kind: "codex-thread", value: TEST_RAW_HANDLE },
          observedAt: TEST_BINDING_OBSERVED_AT,
        },
      },
      {
        uuidFactory: () => TEST_BINDING_UUID,
        wallClock: () => TEST_BINDING_REGISTERED_AT,
      },
    );
    return Object.freeze({
      ...fixture,
      testTargetTaskId: preview.plan.taskPackage.targetTaskId,
      testTaskPackageId: preview.plan.taskPackage.taskPackageId,
      testBindingId: registration.binding.bindingId,
      testRawHandle: TEST_RAW_HANDLE,
      testDeliveryRequest: Object.freeze({
        demandId: fixture.intent.demandId,
        targetTaskId: preview.plan.taskPackage.targetTaskId,
      }),
    });
  } catch (error: unknown) {
    await cleanupTestTaskPlanningWorkspaceFixture(fixture);
    throw error;
  }
}

export async function cleanupTestDeliveryPreparationWorkspaceFixture(
  fixture: Readonly<TestDeliveryPreparationWorkspaceFixture>,
): Promise<void> {
  await cleanupTestTaskPlanningWorkspaceFixture(fixture);
}
