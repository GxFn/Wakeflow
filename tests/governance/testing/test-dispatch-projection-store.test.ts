import { deepEqual, equal, throws } from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { loadDemandEventSourcingRootAuthority } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-root-authority.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { LedgerAuthorityStore } from "../../../src/governance/ledger/ledger-authority-store.js";
import {
  assertTestDispatchPacketMatchesSources,
  parseTestDispatchPacket,
  TestDispatchPacketError,
} from "../../../src/governance/testing/test-dispatch-packet.js";
import { renderTestDispatchPortablePrompt } from "../../../src/governance/testing/test-dispatch-briefing.js";
import { TestDispatchProjectionStore } from "../../../src/governance/testing/test-dispatch-projection-store.js";
import {
  testCardProjectionRef,
  testDispatchPacketProjectionRef,
} from "../../../src/governance/testing/test-dispatch-projection-paths.js";
import { TestDeliveryPreparationService } from "../../../src/governance/testing/test-delivery-preparation-service.js";
import {
  cleanupTestDeliveryPreparationWorkspaceFixture,
  createTestDeliveryPreparationWorkspaceFixture,
  TEST_DELIVERY_PREPARED_AT,
  testDeliveryUuidFactory,
} from "./test-delivery-preparation-service.fixture.js";

test("prepared Test Delivery可重建闭合的Card与target-facing packet投影", async () => {
  const fixture = await createTestDeliveryPreparationWorkspaceFixture();
  let demandRoot: RootedDirectory | undefined;
  let ledgerRoot: RootedDirectory | undefined;
  try {
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
        ...demandFinalRootRef(fixture.intent.demandId).split("/"),
      ),
    );
    const repository = new DemandEventSourcingRepository(demandRoot);
    const beforeRevision = (await repository.audit()).aggregate.streamRevision;
    const store = new TestDispatchProjectionStore(demandRoot);
    const receipt = await store.materialize(intent.targetDeliveryId);

    equal(receipt.taskPackage.disposition, "current");
    equal(receipt.testCard.disposition, "created");
    equal(receipt.packet.disposition, "created");
    equal(receipt.testCard.projection.source.node.permissionBits, 0o600);
    equal(receipt.packet.projection.source.node.permissionBits, 0o600);
    equal(receipt.testCard.projection.source.node.linkCount, 1n);
    equal(receipt.packet.projection.source.node.linkCount, 1n);
    equal((await repository.audit()).aggregate.streamRevision, beforeRevision);

    const packet = receipt.packet.projection.packet;
    equal(packet.targetDeliveryId, intent.targetDeliveryId);
    equal(packet.source.intentDigest, intent.intentDigest);
    equal(
      packet.target.taskPackage.taskPackageRef,
      intent.target.taskPackageRef,
    );
    equal(packet.target.testCard.testCardId, fixture.testCard.testCardId);
    equal(
      packet.target.testCard.testCardRef,
      `${demandFinalRootRef(fixture.intent.demandId)}/${testCardProjectionRef(fixture.testCard.testCardId)}`,
    );
    deepEqual(packet.taskBriefing.requiredSkills, [
      "skills/wakeflow-target/SKILL.md",
      "skills/wakeflow-test/SKILL.md",
    ]);
    equal(packet.taskBriefing.completionFocus.length <= 2, true);
    equal(
      packet.testContract.executionContract.requirementGoal,
      fixture.testCard.requirementGoal,
    );
    deepEqual(
      packet.testContract.executionContract.approvedPlan,
      fixture.testCard.approvedPlan,
    );
    deepEqual(
      packet.testContract.executionContract.environmentSetup,
      intent.attempt.environmentSetup,
    );
    equal(
      packet.testContract.executionContract.productSourcePolicy,
      "read-only",
    );
    equal(
      packet.portablePrompt.includes(
        `${demandFinalRootRef(fixture.intent.demandId)}/${testDispatchPacketProjectionRef(intent.targetDeliveryId)}`,
      ),
      true,
    );
    equal(packet.portablePrompt.includes(fixture.workspacePath), false);
    equal(JSON.stringify(packet).includes(fixture.testRawHandle), false);
    equal(Object.hasOwn(packet, "claim"), false);
    equal(Object.hasOwn(packet, "hostEffect"), false);
    equal(Object.hasOwn(packet, "resultContract"), false);
    const chinesePrompt = renderTestDispatchPortablePrompt({
      packetRef: testDispatchPacketProjectionRef(intent.targetDeliveryId),
      taskPackageRef: intent.target.taskPackageRef,
      testCardRef: testCardProjectionRef(fixture.testCard.testCardId),
      targetTaskId: intent.target.targetTaskId,
      windowId: intent.route.windowId,
      briefing: packet.taskBriefing,
      language: "zh-Hans",
    });
    equal(chinesePrompt.startsWith("Wakeflow Test 目标任务"), true);

    equal(
      (
        await store.loadTestCard(fixture.testCard.testCardId, {
          expectedTestCardDigest: fixture.testCard.testCardDigest,
        })
      ).testCard.testCardId,
      fixture.testCard.testCardId,
    );
    equal(
      (
        await store.loadPacket(intent.targetDeliveryId, {
          expectedPacketDigest: packet.packetDigest,
        })
      ).packet.packetDigest,
      packet.packetDigest,
    );
    const repeated = await store.materialize(intent.targetDeliveryId);
    equal(repeated.taskPackage.disposition, "current");
    equal(repeated.testCard.disposition, "current");
    equal(repeated.packet.disposition, "current");

    ledgerRoot = await RootedDirectory.open(
      path.join(fixture.fixtureRoot, "wakeflow-ledger"),
    );
    const strictAuthority = await loadDemandEventSourcingRootAuthority(
      demandRoot,
      new LedgerAuthorityStore(ledgerRoot),
    );
    equal(strictAuthority.inventory.nodes.testCards?.kind, "directory");
    equal(
      strictAuthority.inventory.nodes.testDispatchPackets?.kind,
      "directory",
    );

    const deliveryEvent = await repository.findTestDeliveryPreparedEvent(
      intent.targetDeliveryId,
    );
    const taskEvent = await repository.findTargetTaskPlannedEvent(
      intent.target.taskPackageId,
    );
    const cardEvent = await repository.findTestCardCreatedEvent(
      fixture.testCard.testCardId,
    );
    if (deliveryEvent === null || taskEvent === null || cardEvent === null) {
      throw new Error("Expected exact Test dispatch source Events.");
    }
    const { packetDigest: _packetDigest, ...packetBasis } = packet;
    const forgedBasis = {
      ...packetBasis,
      taskBriefing: {
        ...packetBasis.taskBriefing,
        objective: "Forged target-facing objective",
      },
    };
    const forged = parseTestDispatchPacket({
      ...forgedBasis,
      packetDigest: computeCanonicalJsonSha256Digest(forgedBasis),
    });
    throws(
      () =>
        assertTestDispatchPacketMatchesSources(
          forged,
          intent,
          taskEvent.event.data.taskPackage,
          cardEvent.event.data.testCard,
          receipt.packet.sourceEvent,
        ),
      (error: unknown) =>
        error instanceof TestDispatchPacketError && error.reason === "relation",
    );
  } finally {
    if (ledgerRoot !== undefined) await ledgerRoot.close();
    if (demandRoot !== undefined) await demandRoot.close();
    await cleanupTestDeliveryPreparationWorkspaceFixture(fixture);
  }
});
