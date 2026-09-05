import { deepEqual, equal, rejects } from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { executeDemandEventSourcingCommand } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { DemandEventSourcingPublicationApplicationService } from "../../../src/governance/demand/publication/demand-event-sourcing-publication-application-service.js";
import { computeDemandEventSourcingPublicationTransactionDigest } from "../../../src/governance/demand/publication/demand-event-sourcing-publication-transaction.js";
import {
  DemandEventSourcingPublicationPlanningService,
  DemandEventSourcingPublicationPlanningServiceError,
} from "../../../src/governance/demand/publication/demand-event-sourcing-publication-planning-service.js";
import {
  demandFinalRootRef,
  DEMAND_PUBLICATION_ROOT_REF,
} from "../../../src/governance/demand/publication/demand-publication-paths.js";
import {
  readRequirementClaimState,
  replaceRequirementClaimStateFile,
  withdrawRequirementClaim,
} from "../../../src/kernel/requirement-board.js";
import {
  cleanupDemandEventSourcingPublicationWorkspaceFixture,
  createDemandEventSourcingPublicationWorkspaceFixture,
  demandEventSourcingPublicationAuthoredDemand,
  demandEventSourcingPublicationPhysicalPath,
  demandEventSourcingPublicationUuidFactory,
  publishPendingPackage,
  PUBLICATION_PACKAGE_ROLES,
  PUBLICATION_RECORDED_AT,
  PUBLICATION_REQUIREMENT_ID,
  PUBLICATION_SECOND_REQUIREMENT_ID,
  type DemandEventSourcingPublicationWorkspaceFixture,
} from "./demand-event-sourcing-publication-service.fixture.js";

const MAIN_UUIDS = [
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
] as const;
const SECOND_UUIDS = [
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  "ffffffff-ffff-4fff-8fff-ffffffffffff",
] as const;
const CANCELLED_AT = parseUtcInstant("2026-09-01T12:30:00.000Z");

function previewPackage(
  fixture: Readonly<DemandEventSourcingPublicationWorkspaceFixture>,
  requirementId: string,
  uuids: readonly string[],
  counters: { readonly uuid: { value: number }; readonly clock: { value: number } },
) {
  return new DemandEventSourcingPublicationPlanningService(
    fixture.workspaceRoot,
  ).preview(
    {
      requirementId,
      demand: demandEventSourcingPublicationAuthoredDemand({ mode: "main" }),
    },
    {
      uuidFactory: demandEventSourcingPublicationUuidFactory(uuids, counters.uuid),
      clock: () => {
        counters.clock.value += 1;
        return PUBLICATION_RECORDED_AT;
      },
    },
  );
}

function counters() {
  return { uuid: { value: 0 }, clock: { value: 0 } };
}

async function cancelDemand(
  fixture: Readonly<DemandEventSourcingPublicationWorkspaceFixture>,
  demandId: string,
): Promise<void> {
  const demandRoot = await RootedDirectory.open(
    path.join(fixture.workspacePath, ...demandFinalRootRef(demandId).split("/")),
  );
  try {
    const repository = new DemandEventSourcingRepository(demandRoot);
    const current = await repository.audit();
    await executeDemandEventSourcingCommand(
      repository,
      {
        commandType: "lifecycle.cancel-demand",
        commandVersion: 1,
        demandId: parseWakeflowDurableIdOfKind(demandId, "demand"),
        eventId: parseWakeflowDurableIdOfKind(
          "demand-event_c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3",
          "demand-event",
        ),
        recordedAt: CANCELLED_AT,
        reason: "验证终态Demand不再阻塞新的需求包认领",
      },
      {
        commitId: parseWakeflowDurableIdOfKind(
          "demand-event-commit_c4c4c4c4-c4c4-44c4-84c4-c4c4c4c4c4c4",
          "demand-event-commit",
        ),
        expectedStreamRevision: current.aggregate.streamRevision,
      },
    );
  } finally {
    await demandRoot.close();
  }
}

test("Publication Planning preview derives a main plan from the requirement package without writes", async (t) => {
  const fixture = await createDemandEventSourcingPublicationWorkspaceFixture();
  try {
    await t.test(
      "main placement allocates Demand/Event/Commit identity",
      async () => {
        const count = counters();
        const preview = await previewPackage(
          fixture,
          PUBLICATION_REQUIREMENT_ID,
          MAIN_UUIDS,
          count,
        );

        equal(
          preview.plan.demandId,
          "demand_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        );
        equal(
          preview.plan.initialCommand.eventId,
          "demand-event_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        );
        equal(
          preview.plan.initialCommit.commitId,
          "demand-event-commit_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        );
        equal(preview.plan.identity.createdAt, PUBLICATION_RECORDED_AT);
        equal(preview.plan.initialCommand.recordedAt, PUBLICATION_RECORDED_AT);
        equal(preview.plan.identity.demandType, "requirement");
        equal(preview.plan.requirementId, PUBLICATION_REQUIREMENT_ID);
        equal(preview.plan.identity.source.artifactKind, "wakeflow-requirement-lineage");
        equal(preview.plan.identity.source.requirementId, PUBLICATION_REQUIREMENT_ID);
        equal(preview.plan.identity.source.recordDigest, fixture.recordDigest);
        equal(
          preview.plan.identity.source.recordRef,
          `requirements/${PUBLICATION_REQUIREMENT_ID}/record.json`,
        );
        equal(preview.plan.identity.executionPlacement.mode, "main");
        equal(preview.plan.authority.testingDecision.mode, "controller-only");
        equal(preview.plan.authority.testingDecision.environmentMemberRef, null);
        deepEqual(
          preview.plan.authority.authorityRefs.map(
            (reference) => reference.role,
          ),
          [...PUBLICATION_PACKAGE_ROLES],
        );
        equal(
          preview.plan.authority.authorityRefs.every(
            (reference) =>
              reference.recordId === PUBLICATION_REQUIREMENT_ID &&
              reference.recordDigest === fixture.recordDigest,
          ),
          true,
        );
        equal(
          preview.plan.expectedClaimStateDigest,
          fixture.initialClaimStateDigest,
        );
        equal(preview.plan.initialCommit.commitSequence, 1);
        equal(preview.plan.initialCommit.expectedStreamRevision, 0);
        equal(
          preview.planDigest,
          computeDemandEventSourcingPublicationTransactionDigest(preview.plan),
        );
        equal(count.uuid.value, 3);
        equal(count.clock.value, 1);
        equal(Object.isFrozen(preview), true);
        equal(Object.isFrozen(preview.plan), true);
      },
    );

    await t.test(
      "isolated placement is retired before any allocation",
      async () => {
        const count = counters();
        await rejects(
          new DemandEventSourcingPublicationPlanningService(
            fixture.workspaceRoot,
          ).preview(
            {
              requirementId: PUBLICATION_REQUIREMENT_ID,
              demand: demandEventSourcingPublicationAuthoredDemand({
                mode: "isolated",
                authorizationMember: {
                  recordId: PUBLICATION_REQUIREMENT_ID,
                  memberPath: "requirement.md",
                },
              }),
            },
            {
              uuidFactory: demandEventSourcingPublicationUuidFactory(
                MAIN_UUIDS,
                count.uuid,
              ),
              clock: () => {
                count.clock.value += 1;
                return PUBLICATION_RECORDED_AT;
              },
            },
          ),
          (error: unknown) =>
            error instanceof
              DemandEventSourcingPublicationPlanningServiceError &&
            error.reason === "isolated-placement-retired",
        );
        equal(count.uuid.value, 0);
        equal(count.clock.value, 0);
      },
    );

    const claim = await readRequirementClaimState(
      fixture.workspaceRoot,
      PUBLICATION_REQUIREMENT_ID,
    );
    equal(claim?.state.status, "pending");
    equal(claim?.digest, fixture.initialClaimStateDigest);
    equal(
      existsSync(
        demandEventSourcingPublicationPhysicalPath(
          fixture.workspacePath,
          DEMAND_PUBLICATION_ROOT_REF,
        ),
      ),
      false,
    );
    equal(
      existsSync(
        demandEventSourcingPublicationPhysicalPath(
          fixture.workspacePath,
          demandFinalRootRef("demand_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
        ),
      ),
      false,
    );
  } finally {
    await cleanupDemandEventSourcingPublicationWorkspaceFixture(fixture);
  }
});

test("Publication Planning refuses a second package while a claimed Demand is active", async () => {
  const fixture = await createDemandEventSourcingPublicationWorkspaceFixture();
  try {
    const first = await previewPackage(
      fixture,
      PUBLICATION_REQUIREMENT_ID,
      MAIN_UUIDS,
      counters(),
    );
    await new DemandEventSourcingPublicationApplicationService(
      fixture.workspaceRoot,
    ).apply(first.plan, first.planDigest);
    await publishPendingPackage(
      fixture.workspaceRoot,
      fixture.ledgerPath,
      PUBLICATION_SECOND_REQUIREMENT_ID,
    );

    const blocked = counters();
    await rejects(
      previewPackage(
        fixture,
        PUBLICATION_SECOND_REQUIREMENT_ID,
        SECOND_UUIDS,
        blocked,
      ),
      (error: unknown) =>
        error instanceof DemandEventSourcingPublicationPlanningServiceError &&
        error.reason === "active-demand-exists",
    );
    equal(blocked.uuid.value, 0);
    equal(blocked.clock.value, 0);

    await cancelDemand(fixture, first.plan.demandId);
    const count = counters();
    const second = await previewPackage(
      fixture,
      PUBLICATION_SECOND_REQUIREMENT_ID,
      SECOND_UUIDS,
      count,
    );
    equal(second.plan.requirementId, PUBLICATION_SECOND_REQUIREMENT_ID);
    equal(second.plan.demandId, "demand_dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    equal(count.uuid.value, 3);
    equal(count.clock.value, 1);
  } finally {
    await cleanupDemandEventSourcingPublicationWorkspaceFixture(fixture);
  }
});

test("Publication Planning refuses packages that are not pending on the board", async () => {
  const fixture = await createDemandEventSourcingPublicationWorkspaceFixture();
  try {
    const count = counters();
    await rejects(
      previewPackage(
        fixture,
        PUBLICATION_SECOND_REQUIREMENT_ID,
        MAIN_UUIDS,
        count,
      ),
      (error: unknown) =>
        error instanceof DemandEventSourcingPublicationPlanningServiceError &&
        error.reason === "board",
    );

    const source = await readRequirementClaimState(
      fixture.workspaceRoot,
      PUBLICATION_REQUIREMENT_ID,
    );
    if (source === null) throw new Error("Expected pending claim state fixture.");
    await replaceRequirementClaimStateFile(
      fixture.workspaceRoot,
      { digest: source.digest, read: source.read },
      withdrawRequirementClaim(source.state, "需求包在规划前被撤回", CANCELLED_AT),
    );
    await rejects(
      previewPackage(fixture, PUBLICATION_REQUIREMENT_ID, MAIN_UUIDS, count),
      (error: unknown) =>
        error instanceof DemandEventSourcingPublicationPlanningServiceError &&
        error.reason === "board",
    );
    equal(count.uuid.value, 0);
    equal(count.clock.value, 0);
  } finally {
    await cleanupDemandEventSourcingPublicationWorkspaceFixture(fixture);
  }
});
