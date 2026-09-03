import { equal, rejects } from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { test } from "node:test";

import { executeDemandControllerRoutePublicRequest } from "../../../src/governance/controller/demand-controller-route-public-coordinator.js";
import {
  DemandEventSourcingPublicationApplicationService,
  DemandEventSourcingPublicationApplicationServiceError,
} from "../../../src/governance/demand/publication/demand-event-sourcing-publication-application-service.js";
import { DemandEventSourcingPublicationPlanningService } from "../../../src/governance/demand/publication/demand-event-sourcing-publication-planning-service.js";
import { initializeDemandEventSourcingPublication } from "../../../src/governance/demand/publication/demand-event-sourcing-publication-service.js";
import { renderDemandEventSourcingPublicationTransaction } from "../../../src/governance/demand/publication/demand-event-sourcing-publication-transaction.js";
import {
  demandFinalRootRef,
  demandPublicationTransactionRef,
} from "../../../src/governance/demand/publication/demand-publication-paths.js";
import {
  cleanupDemandEventSourcingPublicationWorkspaceFixture,
  createDemandEventSourcingPublicationWorkspaceFixture,
  demandEventSourcingPublicationAuthoredDemand,
  demandEventSourcingPublicationPhysicalPath,
  demandEventSourcingPublicationUuidFactory,
  PUBLICATION_RECORDED_AT,
  PUBLICATION_TODO_ID,
  type DemandEventSourcingPublicationWorkspaceFixture,
} from "./demand-event-sourcing-publication-service.fixture.js";

async function previewMainPlan(
  fixture: Readonly<DemandEventSourcingPublicationWorkspaceFixture>,
  uuids: readonly [string, string, string],
) {
  const calls = { value: 0 };
  return new DemandEventSourcingPublicationPlanningService(
    fixture.workspaceRoot,
  ).preview(
    {
      todoId: PUBLICATION_TODO_ID,
      demand: demandEventSourcingPublicationAuthoredDemand({ mode: "main" }),
    },
    {
      uuidFactory: demandEventSourcingPublicationUuidFactory(uuids, calls),
      clock: () => PUBLICATION_RECORDED_AT,
    },
  );
}

test("Publication Application applies one exact plan and exposes the first Route", async () => {
  const fixture = await createDemandEventSourcingPublicationWorkspaceFixture();
  try {
    const preview = await previewMainPlan(fixture, [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ]);
    const service = new DemandEventSourcingPublicationApplicationService(
      fixture.workspaceRoot,
    );

    await rejects(
      service.apply(preview.plan, `sha256:${"0".repeat(64)}`),
      (error: unknown) =>
        error instanceof
          DemandEventSourcingPublicationApplicationServiceError &&
        error.reason === "plan" &&
        error.publicationAuthority === "unchanged",
    );
    equal(
      existsSync(
        demandEventSourcingPublicationPhysicalPath(
          fixture.workspacePath,
          preview.plan.finalRootRef,
        ),
      ),
      false,
    );

    const applied = await service.apply(preview.plan, preview.planDigest);
    equal(applied.planDigest, preview.planDigest);
    equal(applied.publication.publicationAuthority, "current");
    equal(applied.publication.wroteDemandRoot, true);
    equal(applied.publication.demandId, preview.plan.demandId);

    const route = await executeDemandControllerRoutePublicRequest({
      root: fixture.workspacePath,
      demandId: preview.plan.demandId,
    });
    equal(route.route.disposition, "work-available");
    equal(route.route.frontiers.length, 1);
    equal(route.route.frontiers[0]?.kind, "implementation-task-planning");
    equal(route.route.frontiers[0]?.owner, "target-task-planning");

    const replayed = await service.apply(preview.plan, preview.planDigest);
    equal(replayed.publication.publicationAuthority, "current");
    equal(replayed.publication.wroteDemandRoot, false);
  } finally {
    await cleanupDemandEventSourcingPublicationWorkspaceFixture(fixture);
  }
});

test("Publication Application recovers an exact sidecar and preserves unknown without evidence", async () => {
  const fixture = await createDemandEventSourcingPublicationWorkspaceFixture();
  try {
    const preview = await previewMainPlan(fixture, [
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
    ]);
    await initializeDemandEventSourcingPublication(fixture.workspaceRoot);
    const sidecarRef = demandPublicationTransactionRef(preview.plan.demandId);
    const sidecarPath = demandEventSourcingPublicationPhysicalPath(
      fixture.workspacePath,
      sidecarRef,
    );
    writeFileSync(
      sidecarPath,
      renderDemandEventSourcingPublicationTransaction(preview.plan),
      { mode: 0o600 },
    );

    const service = new DemandEventSourcingPublicationApplicationService(
      fixture.workspaceRoot,
    );
    const recovered = await service.recover(preview.plan.demandId);
    equal(recovered.publication.publicationAuthority, "current");
    equal(recovered.publication.demandId, preview.plan.demandId);
    equal(existsSync(sidecarPath), false);
    equal(
      existsSync(
        demandEventSourcingPublicationPhysicalPath(
          fixture.workspacePath,
          demandFinalRootRef(preview.plan.demandId),
        ),
      ),
      true,
    );

    await rejects(
      service.recover(preview.plan.demandId),
      (error: unknown) =>
        error instanceof
          DemandEventSourcingPublicationApplicationServiceError &&
        error.reason === "recover" &&
        error.publicationAuthority === "unknown",
    );
  } finally {
    await cleanupDemandEventSourcingPublicationWorkspaceFixture(fixture);
  }
});
