import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

import { parseWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { TargetTaskPlanningService } from "../../../src/governance/tasking/target-task-planning-service.js";
import { registerWakeflowWindowHostBinding } from "../../../src/workspace/window-runtime/wakeflow-window-host-binding-registration.js";
import { compileWakeflowWindowLaunchIntents } from "../../../src/workspace/window-runtime/wakeflow-window-launch-intent.js";
import { publishFreshWakeflowWindowRuntime } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-fresh-publication.js";
import { wakeflowWindowHostBindingRootRef } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-paths.js";
import { createMinimalWakeflowConfigV3 } from "../../configuration/wakeflow-config-v3.fixture.js";
import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  createTargetTaskPlanningWorkspaceFixture,
  planningUuidFactory,
  PLANNING_RECORDED_AT,
  type TargetTaskPlanningWorkspaceFixture,
  type TargetTaskPlanningWorkspaceFixtureOptions,
} from "../tasking/target-task-planning-service.fixture.js";

export const DELIVERY_PREPARED_AT = parseUtcInstant("2026-08-29T11:59:00.000Z");
const BINDING_OBSERVED_AT = parseUtcInstant("2026-08-29T12:03:00.000Z");
const BINDING_REGISTERED_AT = parseUtcInstant("2026-08-29T12:02:00.000Z");
const BINDING_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RAW_HANDLE = "codex-host-thread:delivery-preparation-fixture";
const DELIVERY_UUIDS = Object.freeze([
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
]);

export interface TargetDeliveryPreparationWorkspaceFixture extends TargetTaskPlanningWorkspaceFixture {
  readonly targetTaskId: string;
  readonly taskPackageId: string;
  readonly bindingId: string;
  readonly rawHandle: string;
  readonly bindingRootPath: string;
}

export function deliveryUuidFactory(): () => string {
  let index = 0;
  return () => DELIVERY_UUIDS[index++] ?? "invalid";
}

export async function createTargetDeliveryPreparationWorkspaceFixture(
  options: TargetTaskPlanningWorkspaceFixtureOptions = {},
): Promise<Readonly<TargetDeliveryPreparationWorkspaceFixture>> {
  const fixture = await createTargetTaskPlanningWorkspaceFixture(options);
  const config = parseWakeflowConfigV3(createMinimalWakeflowConfigV3());
  try {
    const planning = new TargetTaskPlanningService(fixture.workspaceRoot);
    const preview = await planning.preview(fixture.request, {
      clock: () => PLANNING_RECORDED_AT,
      uuidFactory: planningUuidFactory(),
    });
    await planning.apply(preview.plan, preview.planDigest);

    mkdirSync(path.join(fixture.workspacePath, ".wakeflow-local", "runtime"), {
      mode: 0o700,
    });
    await publishFreshWakeflowWindowRuntime(
      fixture.workspaceRoot,
      config,
      codexWorkspaceHostResourceProfile,
      { recoveringFreshPublication: false },
    );
    const launchIntent = compileWakeflowWindowLaunchIntents(
      config,
      codexWorkspaceHostResourceProfile,
    ).intents.find(
      (entry) =>
        entry.windowId === preview.plan.taskPackage.assignment.windowId,
    );
    if (launchIntent === undefined) {
      throw new Error("Expected exact product window launch intent.");
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
          handle: { kind: "codex-thread", value: RAW_HANDLE },
          observedAt: BINDING_OBSERVED_AT,
        },
      },
      {
        uuidFactory: () => BINDING_UUID,
        wallClock: () => BINDING_REGISTERED_AT,
      },
    );
    const bindingRootPath = path.join(
      fixture.workspacePath,
      ...wakeflowWindowHostBindingRootRef(
        codexWorkspaceHostResourceProfile,
      ).split("/"),
    );
    if (readdirSync(bindingRootPath).length !== 1) {
      throw new Error("Expected one private Binding fixture.");
    }
    return Object.freeze({
      ...fixture,
      targetTaskId: preview.plan.taskPackage.targetTaskId,
      taskPackageId: preview.plan.taskPackage.taskPackageId,
      bindingId: registration.binding.bindingId,
      rawHandle: RAW_HANDLE,
      bindingRootPath,
    });
  } catch (error: unknown) {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
    throw error;
  }
}

export async function cleanupTargetDeliveryPreparationWorkspaceFixture(
  fixture: Readonly<TargetDeliveryPreparationWorkspaceFixture>,
): Promise<void> {
  await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
}
