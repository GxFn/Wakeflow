import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { parseWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3.js";
import { renderWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3-document.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { upcastDemandEventSourcingStoredEvent } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-upcaster.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import {
  parseDemandAggregateState,
  DemandAggregateStateError,
} from "../../../src/governance/demand/model/demand-aggregate-state.js";
import { inspectDemandEventSourcingRootInventory } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-root-inventory.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { readDemandPostAcceptanceRoute } from "../../../src/governance/review/demand-post-acceptance-route.js";
import type { LedgerAuthorityMemberReference } from "../../../src/governance/ledger/ledger-authority-store.js";
import {
  parseTestCard,
  parseTestCardAuthoredContent,
  renderTestCard,
  TestCardError,
} from "../../../src/governance/testing/test-card.js";
import {
  deriveTestCardBasisAuthorities,
  TestCardPlanningAuthorityError,
} from "../../../src/governance/testing/test-card-planning-authority.js";
import {
  parseTestCardPlanningPlan,
  TestCardPlanningPlanError,
} from "../../../src/governance/testing/test-card-planning-plan.js";
import {
  TestCardPlanningService,
  TestCardPlanningServiceError,
} from "../../../src/governance/testing/test-card-planning-service.js";
import { createWindowWorkClaimInStore } from "../../../src/governance/delivery/window-work-claim-store.js";
import { createMinimalWakeflowConfigV3 } from "../../configuration/wakeflow-config-v3.fixture.js";
import {
  cleanupAcceptedDemandCompletionWorkspaceFixture,
  createAcceptedDemandCompletionWorkspaceFixture,
} from "../lifecycle/demand-completion-service.fixture.js";
import {
  cleanupTestCardPlanningWorkspaceFixture,
  createTestCardContentFixture,
  createTestCardPlanningWorkspaceFixture,
  TEST_CARD_CREATED_AT,
  testCardUuidFactory,
} from "./test-card-planning-service.fixture.js";

async function demandInventory(workspacePath: string, demandId: string) {
  const root = await RootedDirectory.open(
    path.join(workspacePath, ...demandFinalRootRef(demandId).split("/")),
  );
  try {
    return await inspectDemandEventSourcingRootInventory(root);
  } finally {
    await root.close();
  }
}

async function auditedAggregate(workspacePath: string, demandId: string) {
  const root = await RootedDirectory.open(
    path.join(workspacePath, ...demandFinalRootRef(demandId).split("/")),
  );
  try {
    return (await new DemandEventSourcingRepository(root).audit()).aggregate;
  } finally {
    await root.close();
  }
}

function rewriteConfig(workspacePath: string): void {
  const value = createMinimalWakeflowConfigV3();
  const program = value.program as Record<string, unknown>;
  program.displayName = "Changed after TestCard creation";
  writeFileSync(
    path.join(workspacePath, "wakeflow.config.json"),
    renderWakeflowConfigV3(parseWakeflowConfigV3(value)),
    { mode: 0o644 },
  );
}

test("TestCard preview零写，Apply创建唯一Event并路由到Test Task planning", async () => {
  const fixture = await createTestCardPlanningWorkspaceFixture();
  try {
    const service = new TestCardPlanningService(fixture.workspaceRoot);
    const before = await demandInventory(
      fixture.workspacePath,
      fixture.intent.demandId,
    );
    const preview = await service.preview(
      {
        demandId: fixture.intent.demandId,
        testCard: fixture.testCardContent,
      },
      {
        clock: () => TEST_CARD_CREATED_AT,
        uuidFactory: testCardUuidFactory(),
      },
    );
    deepEqual(
      await demandInventory(fixture.workspacePath, fixture.intent.demandId),
      before,
    );
    const card = preview.plan.testCard;
    deepEqual(preview.plan.generationSource, { kind: "initial" });
    equal(Object.hasOwn(card, "generationSource"), false);
    equal(card.requirementGoal, "建立一份可审计的 implementation TaskPackage");
    equal(card.environmentAuthority.role, "test-environment");
    deepEqual(
      card.testBasisAuthorities.map((reference) => reference.role),
      ["requirement-design"],
    );
    equal(card.implementationBaselines.length, 1);
    equal(card.controllerSelfChecks.length, 2);
    equal(card.changeControl, "return-blocked-to-controller");
    equal(card.productSourcePolicy, "read-only");
    equal(renderTestCard(parseTestCard(card)), renderTestCard(card));
    equal(
      /(?:rawHandle|threadId|sessionId|secret)/u.test(JSON.stringify(card)),
      false,
    );
    const legacyCreated = upcastDemandEventSourcingStoredEvent({
      artifactKind: "wakeflow-demand-event-sourcing-event",
      schemaVersion: 1,
      eventId: preview.plan.eventId,
      demandId: card.demandId,
      streamRevision: card.source.streamRevision + 1,
      recordedAt: card.createdAt,
      eventType: "testing.test-card-created",
      eventVersion: 1,
      data: { testCard: card },
      resultingStateModelVersion: 1,
      resultingStateDigest: parseSha256Digest(`sha256:${"a".repeat(64)}`),
    });
    equal(legacyCreated.eventType, "testing.test-card-created");
    if (legacyCreated.eventType === "testing.test-card-created") {
      deepEqual(legacyCreated.data.generationSource, { kind: "initial" });
    }
    throws(
      () =>
        parseTestCard({
          ...card,
          testCardDigest: `sha256:${"0".repeat(64)}`,
        }),
      (error: unknown) =>
        error instanceof TestCardError && error.reason === "digest",
    );
    throws(
      () => parseTestCard({ ...card, testBasisAuthorities: [] }),
      (error: unknown) =>
        error instanceof TestCardError && error.reason === "schema",
    );
    throws(
      () =>
        parseTestCard({
          ...card,
          testBasisAuthorities: [card.environmentAuthority],
        }),
      (error: unknown) =>
        error instanceof TestCardError && error.reason === "authority",
    );
    throws(
      () =>
        parseTestCardPlanningPlan({
          ...preview.plan,
          expectedStreamRevision: preview.plan.expectedStreamRevision + 1,
        }),
      (error: unknown) =>
        error instanceof TestCardPlanningPlanError &&
        error.reason === "relation",
    );

    const applied = await service.apply(preview.plan, preview.planDigest);
    equal(applied.status, "created");
    equal(applied.disposition, "committed");
    equal(applied.commandResult.aggregate.streamRevision, 8);
    equal(
      applied.commandResult.commit.events[0]?.eventType,
      "testing.test-card-created",
    );
    equal(applied.commandResult.commit.events[0]?.eventVersion, 2);
    equal(
      applied.commandResult.aggregate.state.currentTestCard?.testCardId,
      card.testCardId,
    );
    equal(
      Object.hasOwn(applied.commandResult.aggregate.state, "pendingTestRetest"),
      false,
    );
    throws(
      () =>
        parseDemandAggregateState({
          ...applied.commandResult.aggregate.state,
          lifecycle: "completed",
        }),
      (error: unknown) =>
        error instanceof DemandAggregateStateError &&
        error.reason === "relation",
    );
    const next = await readDemandPostAcceptanceRoute(
      fixture.workspaceRoot,
      fixture.intent.demandId,
    );
    equal(next.nextStage.status, "test-task-planning");
    if (next.nextStage.status !== "test-task-planning") {
      throw new Error("Expected Test Task planning route.");
    }
    equal(next.nextStage.testCard.testCardId, card.testCardId);
    await rejects(
      service.preview({
        demandId: fixture.intent.demandId,
        testCard: fixture.testCardContent,
      }),
      (error: unknown) =>
        error instanceof TestCardPlanningServiceError &&
        error.reason === "route",
    );

    rewriteConfig(fixture.workspacePath);
    const replayed = await service.apply(preview.plan, preview.planDigest);
    equal(replayed.status, "already-created");
    equal(replayed.disposition, "idempotent");
    equal(
      (await auditedAggregate(fixture.workspacePath, fixture.intent.demandId))
        .state.currentTestCard?.testCardDigest,
      card.testCardDigest,
    );
  } finally {
    await cleanupTestCardPlanningWorkspaceFixture(fixture);
  }
});

test("并发相同TestCard plan收敛为一个Event", async () => {
  const fixture = await createTestCardPlanningWorkspaceFixture();
  try {
    const first = new TestCardPlanningService(fixture.workspaceRoot);
    const second = new TestCardPlanningService(fixture.workspaceRoot);
    const preview = await first.preview(
      {
        demandId: fixture.intent.demandId,
        testCard: fixture.testCardContent,
      },
      {
        clock: () => TEST_CARD_CREATED_AT,
        uuidFactory: testCardUuidFactory(),
      },
    );
    const results = await Promise.all([
      first.apply(preview.plan, preview.planDigest),
      second.apply(preview.plan, preview.planDigest),
    ]);
    deepEqual(results.map((result) => result.disposition).sort(), [
      "committed",
      "idempotent",
    ]);
    equal(
      (await auditedAggregate(fixture.workspacePath, fixture.intent.demandId))
        .streamRevision,
      8,
    );
  } finally {
    await cleanupTestCardPlanningWorkspaceFixture(fixture);
  }
});

test("TestCard Planning拒绝controller-only和preview后的WorkClaim漂移", async () => {
  const controllerOnly = await createAcceptedDemandCompletionWorkspaceFixture();
  try {
    await rejects(
      new TestCardPlanningService(controllerOnly.workspaceRoot).preview({
        demandId: controllerOnly.intent.demandId,
        testCard: createTestCardContentFixture(),
      }),
      (error: unknown) =>
        error instanceof TestCardPlanningServiceError &&
        error.reason === "route",
    );
  } finally {
    await cleanupAcceptedDemandCompletionWorkspaceFixture(controllerOnly);
  }

  const fixture = await createTestCardPlanningWorkspaceFixture();
  try {
    const service = new TestCardPlanningService(fixture.workspaceRoot);
    const preview = await service.preview(
      {
        demandId: fixture.intent.demandId,
        testCard: fixture.testCardContent,
      },
      {
        clock: () => TEST_CARD_CREATED_AT,
        uuidFactory: testCardUuidFactory(),
      },
    );
    const reported = fixture.reviewSnapshot.targets[0];
    if (reported?.status !== "reported") {
      throw new Error("Expected prior reported TargetResult fixture.");
    }
    const root = await RootedDirectory.open(
      path.join(
        fixture.workspacePath,
        ...demandFinalRootRef(fixture.intent.demandId).split("/"),
      ),
    );
    let priorClaim;
    try {
      const located = await new DemandEventSourcingRepository(
        root,
      ).findTargetHostEffectClaimedEvent(
        reported.targetResult.hostEffect.actionId,
      );
      if (located === null) throw new Error("Expected prior Claim Event.");
      priorClaim = located.event.data.claim;
    } finally {
      await root.close();
    }
    await createWindowWorkClaimInStore(fixture.workspaceRoot, priorClaim);
    await rejects(
      service.apply(preview.plan, preview.planDigest),
      (error: unknown) =>
        error instanceof TestCardPlanningServiceError &&
        error.reason === "claim",
    );
  } finally {
    await cleanupTestCardPlanningWorkspaceFixture(fixture);
  }
});

test("Test Basis按Demand类型完整派生并保持稳定顺序", async () => {
  const fixture = await createTestCardPlanningWorkspaceFixture();
  try {
    const target = fixture.reviewSnapshot.targets[0];
    if (target?.status !== "reported" && target?.status !== "review-decided") {
      throw new Error("Expected result-bearing implementation target fixture.");
    }
    const template = target.taskPackage.selectedAuthorityRefs[0];
    if (template === undefined) {
      throw new Error("Expected Authority reference fixture.");
    }
    const reference = (
      role: LedgerAuthorityMemberReference["role"],
      name: string,
    ): Readonly<LedgerAuthorityMemberReference> =>
      Object.freeze({
        ...template,
        role,
        memberPath: parsePortableResourcePath(`${name}.md`),
        memberRef: parsePortableResourcePath(`basis/${name}.md`),
      });
    const designB = reference("requirement-design", "z-design");
    const designA = reference("requirement-design", "a-design");
    const reproduction = reference("reproduction", "b-reproduction");
    const scopeA = reference("scope", "c-scope");
    const scopeB = reference("scope", "d-scope");
    const delta = reference("requirement-delta", "e-delta");

    deepEqual(
      deriveTestCardBasisAuthorities("requirement", [designB, scopeA, designA]),
      [designA, designB],
    );
    deepEqual(
      deriveTestCardBasisAuthorities("bug", [scopeB, reproduction, scopeA]),
      [reproduction, scopeA, scopeB],
    );
    deepEqual(
      deriveTestCardBasisAuthorities("supplement", [delta, designB, designA]),
      [designA, delta, designB],
    );
    throws(
      () => deriveTestCardBasisAuthorities("bug", [reproduction]),
      (error: unknown) =>
        error instanceof TestCardPlanningAuthorityError &&
        error.reason === "test-basis",
    );
    throws(
      () => deriveTestCardBasisAuthorities("research", [designA]),
      (error: unknown) =>
        error instanceof TestCardPlanningAuthorityError &&
        error.reason === "test-basis",
    );
  } finally {
    await cleanupTestCardPlanningWorkspaceFixture(fixture);
  }
});

test("TestCard内容在UUID和时钟前拒绝空边界与废弃重启字段", () => {
  const content = createTestCardContentFixture();
  throws(
    () =>
      parseTestCardAuthoredContent({
        ...content,
        restartConditions: ["废弃字段不得重新进入新TS合同"],
      }),
    (error: unknown) =>
      error instanceof TestCardError && error.reason === "schema",
  );
  throws(
    () =>
      parseTestCardAuthoredContent({
        ...content,
        objectBoundary: "",
      }),
    (error: unknown) =>
      error instanceof TestCardError && error.reason === "text",
  );
});
