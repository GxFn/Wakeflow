import path from "node:path";

import { parseWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { TestDeliveryPreparationService } from "../../../src/governance/testing/test-delivery-preparation-service.js";
import { TestDispatchProjectionStore } from "../../../src/governance/testing/test-dispatch-projection-store.js";
import { compileWakeflowWindowRuntimeDesiredTopology } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-desired-topology.js";
import { materializeWakeflowSharedCoordinationLayout } from "../../../src/workspace/wakeflow-shared-coordination-layout.js";
import { createMinimalWakeflowConfigV3 } from "../../configuration/wakeflow-config-v3.fixture.js";
import {
  cleanupTestDeliveryPreparationWorkspaceFixture,
  createTestDeliveryPreparationWorkspaceFixture,
  TEST_DELIVERY_PREPARED_AT,
  testDeliveryUuidFactory,
  type TestDeliveryPreparationWorkspaceFixture,
} from "./test-delivery-preparation-service.fixture.js";
import type { TestCardPlanningWorkspaceFixtureOptions } from "./test-card-planning-service.fixture.js";

export const TEST_CLAIM_OBSERVED_AT = parseUtcInstant(
  "2026-08-29T12:28:00.000Z",
);
export const TEST_CLAIMED_AT = parseUtcInstant("2026-08-29T12:32:00.000Z");

const TEST_CLAIM_UUIDS = Object.freeze([
  "b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2",
  "b3b3b3b3-b3b3-43b3-83b3-b3b3b3b3b3b3",
  "b4b4b4b4-b4b4-44b4-84b4-b4b4b4b4b4b4",
]);

export interface TestHostEffectClaimWorkspaceFixture extends TestDeliveryPreparationWorkspaceFixture {
  readonly targetDeliveryId: string;
  readonly intentDigest: string;
  readonly testAttemptId: string;
  readonly testDispatchPacketDigest: string;
  readonly testClaimRequest: Readonly<{
    readonly workType: "test";
    readonly demandId: string;
    readonly targetTaskId: string;
    readonly targetDeliveryId: string;
    readonly intentDigest: string;
    readonly testDispatchPacketDigest: string;
    readonly observation: Readonly<Record<string, unknown>>;
  }>;
}

export function testClaimUuidFactory(): () => string {
  let index = 0;
  return () => TEST_CLAIM_UUIDS[index++] ?? "invalid";
}

export async function createTestHostEffectClaimWorkspaceFixture(
  options: TestCardPlanningWorkspaceFixtureOptions = {},
): Promise<Readonly<TestHostEffectClaimWorkspaceFixture>> {
  const fixture = await createTestDeliveryPreparationWorkspaceFixture(options);
  let demandRoot: RootedDirectory | undefined;
  try {
    await materializeWakeflowSharedCoordinationLayout(fixture.workspaceRoot, {
      mode: "ensure",
    });
    const preparation = new TestDeliveryPreparationService(
      fixture.workspaceRoot,
      codexWorkspaceHostResourceProfile,
      codexWindowHostIdentityProfile,
    );
    const preview = await preparation.preview(fixture.testDeliveryRequest, {
      clock: () => TEST_DELIVERY_PREPARED_AT,
      uuidFactory: testDeliveryUuidFactory(),
    });
    await preparation.apply(preview.plan, preview.planDigest);
    const intent = preview.plan.intent;
    demandRoot = await RootedDirectory.open(
      path.join(
        fixture.workspacePath,
        ...demandFinalRootRef(intent.demandId).split("/"),
      ),
    );
    const packet = (
      await new TestDispatchProjectionStore(demandRoot).materialize(
        intent.targetDeliveryId,
      )
    ).packet.projection.packet;
    await demandRoot.close();
    demandRoot = undefined;
    const config = parseWakeflowConfigV3(createMinimalWakeflowConfigV3());
    const desired = compileWakeflowWindowRuntimeDesiredTopology(
      config,
      codexWorkspaceHostResourceProfile,
    ).windows.find((entry) => entry.windowId === intent.route.windowId);
    if (desired === undefined) throw new Error("Expected desired Test window.");
    return Object.freeze({
      ...fixture,
      targetDeliveryId: intent.targetDeliveryId,
      intentDigest: intent.intentDigest,
      testAttemptId: intent.attempt.testAttemptId,
      testDispatchPacketDigest: packet.packetDigest,
      testClaimRequest: Object.freeze({
        workType: "test" as const,
        demandId: intent.demandId,
        targetTaskId: intent.target.targetTaskId,
        targetDeliveryId: intent.targetDeliveryId,
        intentDigest: intent.intentDigest,
        testDispatchPacketDigest: packet.packetDigest,
        observation: Object.freeze({
          kind: "WakeflowAgentHostWindowObservation",
          schemaVersion: 1,
          source: "agent-host-inspection-result",
          hostId: "codex",
          windowId: intent.route.windowId,
          bindingId: fixture.testBindingId,
          handle: Object.freeze({
            kind: "codex-thread",
            value: fixture.testRawHandle,
          }),
          attestedRoot: Object.freeze({
            status: "matches-configured-root",
            logicalRoot: desired.logicalRoot,
            configuredPlacement: desired.configuredPlacement,
          }),
          observedAt: TEST_CLAIM_OBSERVED_AT,
        }),
      }),
    });
  } catch (error: unknown) {
    if (demandRoot !== undefined) await demandRoot.close();
    await cleanupTestDeliveryPreparationWorkspaceFixture(fixture);
    throw error;
  }
}

export async function cleanupTestHostEffectClaimWorkspaceFixture(
  fixture: Readonly<TestHostEffectClaimWorkspaceFixture>,
): Promise<void> {
  await cleanupTestDeliveryPreparationWorkspaceFixture(fixture);
}
