import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { TargetDeliveryPreparationService } from "../../../src/governance/delivery/target-delivery-preparation-service.js";
import { compileWakeflowWindowRuntimeDesiredTopology } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-desired-topology.js";
import { materializeWakeflowSharedCoordinationLayout } from "../../../src/workspace/wakeflow-shared-coordination-layout.js";
import { parseWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3.js";
import { createMinimalWakeflowConfigV3 } from "../../configuration/wakeflow-config-v3.fixture.js";
import {
  cleanupTargetDeliveryPreparationWorkspaceFixture,
  createTargetDeliveryPreparationWorkspaceFixture,
  deliveryUuidFactory,
  DELIVERY_PREPARED_AT,
  type TargetDeliveryPreparationWorkspaceFixture,
} from "./target-delivery-preparation-service.fixture.js";
import type { TargetDeliveryIntent } from "../../../src/governance/delivery/target-delivery-intent.js";
import type { TargetTaskPlanningWorkspaceFixtureOptions } from "../tasking/target-task-planning-service.fixture.js";

export const CLAIM_OBSERVED_AT = parseUtcInstant("2026-08-29T12:01:00.000Z");
export const CLAIMED_AT = parseUtcInstant("2026-08-29T12:05:00.000Z");
const CLAIM_UUIDS = Object.freeze([
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  "ffffffff-ffff-4fff-8fff-ffffffffffff",
  "12121212-1212-4212-8212-121212121212",
]);

export interface TargetHostEffectClaimWorkspaceFixture extends TargetDeliveryPreparationWorkspaceFixture {
  readonly intent: Readonly<TargetDeliveryIntent>;
  readonly claimRequest: Readonly<{
    readonly workType: "implementation";
    readonly demandId: string;
    readonly targetTaskId: string;
    readonly targetDeliveryId: string;
    readonly intentDigest: string;
    readonly observation: Readonly<Record<string, unknown>>;
  }>;
}

export function claimUuidFactory(): () => string {
  let index = 0;
  return () => CLAIM_UUIDS[index++] ?? "invalid";
}

export async function createTargetHostEffectClaimWorkspaceFixture(
  options: TargetTaskPlanningWorkspaceFixtureOptions = {},
): Promise<Readonly<TargetHostEffectClaimWorkspaceFixture>> {
  const fixture =
    await createTargetDeliveryPreparationWorkspaceFixture(options);
  try {
    await materializeWakeflowSharedCoordinationLayout(fixture.workspaceRoot, {
      mode: "ensure",
    });
    const preparation = new TargetDeliveryPreparationService(
      fixture.workspaceRoot,
      codexWorkspaceHostResourceProfile,
      codexWindowHostIdentityProfile,
    );
    const preview = await preparation.preview(
      {
        demandId: fixture.request.demandId,
        targetTaskId: fixture.targetTaskId,
      },
      {
        clock: () => DELIVERY_PREPARED_AT,
        uuidFactory: deliveryUuidFactory(),
      },
    );
    await preparation.apply(preview.plan, preview.planDigest);
    const intent = preview.plan.intent;
    const config = parseWakeflowConfigV3(createMinimalWakeflowConfigV3());
    const desired = compileWakeflowWindowRuntimeDesiredTopology(
      config,
      codexWorkspaceHostResourceProfile,
    ).windows.find((entry) => entry.windowId === intent.route.windowId);
    if (desired === undefined)
      throw new Error("Expected desired product window.");
    return Object.freeze({
      ...fixture,
      intent,
      claimRequest: Object.freeze({
        workType: "implementation" as const,
        demandId: intent.demandId,
        targetTaskId: intent.target.targetTaskId,
        targetDeliveryId: intent.targetDeliveryId,
        intentDigest: intent.intentDigest,
        observation: Object.freeze({
          kind: "WakeflowAgentHostWindowObservation",
          schemaVersion: 1,
          source: "agent-host-inspection-result",
          hostId: "codex",
          windowId: intent.route.windowId,
          bindingId: fixture.bindingId,
          handle: Object.freeze({
            kind: "codex-thread",
            value: fixture.rawHandle,
          }),
          attestedRoot: Object.freeze({
            status: "matches-configured-root",
            logicalRoot: desired.logicalRoot,
            configuredPlacement: desired.configuredPlacement,
          }),
          observedAt: CLAIM_OBSERVED_AT,
        }),
      }),
    });
  } catch (error: unknown) {
    await cleanupTargetDeliveryPreparationWorkspaceFixture(fixture);
    throw error;
  }
}

export async function cleanupTargetHostEffectClaimWorkspaceFixture(
  fixture: Readonly<TargetHostEffectClaimWorkspaceFixture>,
): Promise<void> {
  await cleanupTargetDeliveryPreparationWorkspaceFixture(fixture);
}
