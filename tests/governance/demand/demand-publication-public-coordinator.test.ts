import { equal, rejects, throws } from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { test } from "node:test";

import {
  executeDemandPublicationPublicRequest,
  DemandPublicationPublicCoordinatorError,
} from "../../../src/governance/demand/publication/demand-publication-public-coordinator.js";
import {
  parseDemandPublicationPublicRequest,
  DemandPublicationPublicContractError,
} from "../../../src/governance/demand/publication/demand-publication-public-contract.js";
import { initializeDemandEventSourcingPublication } from "../../../src/governance/demand/publication/demand-event-sourcing-publication-service.js";
import {
  parseDemandEventSourcingPublicationTransaction,
  renderDemandEventSourcingPublicationTransaction,
} from "../../../src/governance/demand/publication/demand-event-sourcing-publication-transaction.js";
import { demandPublicationTransactionRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
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

async function previewPublic(
  fixture: Readonly<DemandEventSourcingPublicationWorkspaceFixture>,
  uuids: readonly [string, string, string],
) {
  const calls = { value: 0 };
  const result = await executeDemandPublicationPublicRequest(
    {
      root: fixture.workspacePath,
      mode: "preview",
      todoId: PUBLICATION_TODO_ID,
      demand: demandEventSourcingPublicationAuthoredDemand({ mode: "main" }),
    },
    {
      preview: {
        uuidFactory: demandEventSourcingPublicationUuidFactory(uuids, calls),
        clock: () => PUBLICATION_RECORDED_AT,
      },
    },
  );
  if (result.mode !== "preview") {
    throw new Error("Expected Demand Publication preview result.");
  }
  return result;
}

test("Demand Publication public contract closes all three modes", () => {
  equal(
    parseDemandPublicationPublicRequest({
      root: "/workspace",
      mode: "recover",
      demandId: "demand_11111111-1111-4111-8111-111111111111",
    }).mode,
    "recover",
  );
  throws(
    () => parseDemandPublicationPublicRequest(new Proxy({}, {})),
    (error: unknown) =>
      error instanceof DemandPublicationPublicContractError &&
      error.reason === "json",
  );
  throws(
    () =>
      parseDemandPublicationPublicRequest({
        root: "/workspace",
        mode: "apply",
        plan: {},
        planDigest: `sha256:${"0".repeat(64)}`,
      }),
    (error: unknown) =>
      error instanceof DemandPublicationPublicContractError &&
      error.reason === "schema",
  );
  throws(
    () =>
      parseDemandPublicationPublicRequest({
        root: "/workspace",
        mode: "preview",
        todoId: PUBLICATION_TODO_ID,
        demand: {
          ...demandEventSourcingPublicationAuthoredDemand({ mode: "main" }),
          demandType: "requirement",
        },
        authorityMembers: [
          {
            recordId: "requirement_33333333-3333-4333-8333-333333333333",
            memberPath: "authority/requirement-design.md",
            role: "requirement-design",
          },
        ],
      }),
    (error: unknown) =>
      error instanceof DemandPublicationPublicContractError &&
      error.reason === "schema",
  );
});

test("Demand Publication public preview/apply returns only the stable receipt", async () => {
  const fixture = await createDemandEventSourcingPublicationWorkspaceFixture();
  try {
    await rejects(
      executeDemandPublicationPublicRequest(
        {
          root: fixture.workspacePath,
          mode: "preview",
          todoId: PUBLICATION_TODO_ID,
          demand: {
            ...demandEventSourcingPublicationAuthoredDemand({ mode: "main" }),
            title: fixture.workspacePath,
          },
        },
        {
          preview: {
            uuidFactory: () => "99999999-9999-4999-8999-999999999999",
            clock: () => PUBLICATION_RECORDED_AT,
          },
        },
      ),
      (error: unknown) =>
        error instanceof DemandPublicationPublicCoordinatorError &&
        error.reason === "privacy" &&
        error.publicationAuthority === "unchanged",
    );

    const preview = await previewPublic(fixture, [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ]);
    const plan = parseDemandEventSourcingPublicationTransaction(preview.plan);
    equal(preview.status, "ready");
    equal(plan.todoId, PUBLICATION_TODO_ID);
    equal(JSON.stringify(preview).includes(fixture.workspacePath), false);

    await rejects(
      executeDemandPublicationPublicRequest({
        root: fixture.workspacePath,
        mode: "apply",
        plan: preview.plan,
        planDigest: `sha256:${"0".repeat(64)}`,
      }),
      (error: unknown) =>
        error instanceof DemandPublicationPublicCoordinatorError &&
        error.reason === "apply" &&
        error.causeReason === "plan" &&
        error.publicationAuthority === "unchanged",
    );

    const applied = await executeDemandPublicationPublicRequest({
      root: fixture.workspacePath,
      mode: "apply",
      plan: preview.plan,
      planDigest: preview.planDigest,
    });
    if (applied.mode !== "apply") {
      throw new Error("Expected Demand Publication apply result.");
    }
    equal(applied.status, "current");
    equal(applied.publication.publicationAuthority, "current");
    equal(applied.publication.demandId, plan.demandId);
    equal(applied.publication.event.streamRevision, 1);
    equal(applied.publication.commit.commitSequence, 1);
    equal(applied.publication.todoClaim.stateRevision, 2);
    equal(Object.hasOwn(applied.publication, "rootRef"), false);
    equal(Object.hasOwn(applied.publication, "authority"), false);
    equal(Object.hasOwn(applied.publication, "aggregate"), false);
    equal(Object.hasOwn(applied.publication, "wroteDemandRoot"), false);
    equal(JSON.stringify(applied).includes(fixture.workspacePath), false);

    const replayed = await executeDemandPublicationPublicRequest({
      root: fixture.workspacePath,
      mode: "apply",
      plan: preview.plan,
      planDigest: preview.planDigest,
    });
    equal(replayed.mode, "apply");
    equal(JSON.stringify(replayed), JSON.stringify(applied));
  } finally {
    await cleanupDemandEventSourcingPublicationWorkspaceFixture(fixture);
  }
});

test("Demand Publication public recovery consumes only exact sidecar evidence", async () => {
  const fixture = await createDemandEventSourcingPublicationWorkspaceFixture();
  try {
    const preview = await previewPublic(fixture, [
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
    ]);
    const plan = parseDemandEventSourcingPublicationTransaction(preview.plan);
    await initializeDemandEventSourcingPublication(fixture.workspaceRoot);
    const sidecarRef = demandPublicationTransactionRef(plan.demandId);
    const sidecarPath = demandEventSourcingPublicationPhysicalPath(
      fixture.workspacePath,
      sidecarRef,
    );
    writeFileSync(
      sidecarPath,
      renderDemandEventSourcingPublicationTransaction(plan),
      { mode: 0o600 },
    );

    const recovered = await executeDemandPublicationPublicRequest({
      root: fixture.workspacePath,
      mode: "recover",
      demandId: plan.demandId,
    });
    if (recovered.mode !== "recover") {
      throw new Error("Expected Demand Publication recovery result.");
    }
    equal(recovered.status, "current");
    equal(recovered.publication.publicationAuthority, "current");
    equal(recovered.publication.demandId, plan.demandId);
    equal(existsSync(sidecarPath), false);

    await rejects(
      executeDemandPublicationPublicRequest({
        root: fixture.workspacePath,
        mode: "recover",
        demandId: plan.demandId,
      }),
      (error: unknown) =>
        error instanceof DemandPublicationPublicCoordinatorError &&
        error.reason === "recover" &&
        error.publicationAuthority === "unknown",
    );
  } finally {
    await cleanupDemandEventSourcingPublicationWorkspaceFixture(fixture);
  }
});
