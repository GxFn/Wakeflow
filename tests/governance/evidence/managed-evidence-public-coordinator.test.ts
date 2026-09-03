import { deepEqual, equal, rejects } from "node:assert/strict";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { executeDemandEventSourcingCommand } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import {
  executeManagedEvidencePublicRequest,
  ManagedEvidencePublicCoordinatorError,
} from "../../../src/governance/evidence/managed-evidence-public-coordinator.js";
import { materializeManagedEvidencePublicationStage } from "../../../src/governance/evidence/managed-evidence-publication-stage-materializer.js";
import { createManagedEvidencePublicationTransactionJournal } from "../../../src/governance/evidence/managed-evidence-publication-transaction-store.js";
import {
  deriveManagedEvidencePublicationEventSourcingCommand,
  deriveManagedEvidencePublicationRecordTreePlan,
  parseManagedEvidencePublicationTransaction,
} from "../../../src/governance/evidence/managed-evidence-publication-transaction.js";
import { MANAGED_EVIDENCE_ROOT_REF } from "../../../src/governance/evidence/managed-evidence-resource-paths.js";
import {
  cleanupManagedEvidenceCapturePlanningWorkspaceFixture,
  createManagedEvidenceCapturePlanningWorkspaceFixture,
  EVIDENCE_CAPTURED_AT,
  EVIDENCE_DEMAND_ID,
  EVIDENCE_REPOSITORY_ID,
  type ManagedEvidenceCapturePlanningWorkspaceFixture,
} from "./managed-evidence-capture-planning-service.fixture.js";

const OTHER_DEMAND_ID =
  "demand_f1111111-1111-4111-8111-111111111111";
const CANCELLATION_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_f2222222-2222-4222-8222-222222222222",
  "demand-event",
);
const CANCELLATION_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_f3333333-3333-4333-8333-333333333333",
  "demand-event-commit",
);

function demandRootPath(
  fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>,
): string {
  return path.join(
    fixture.publication.workspacePath,
    ".wakeflow-active",
    "current",
    EVIDENCE_DEMAND_ID,
  );
}

function physical(root: string, ref: string): string {
  return path.join(root, ...ref.split("/"));
}

function fileSelection() {
  return {
    evidenceType: "test-output",
    source: {
      root: {
        kind: "repository",
        repositoryId: EVIDENCE_REPOSITORY_ID,
      },
      path: "artifacts/test-run/logs/report.txt",
      resourceType: "file",
    },
    sensitivity: "internal",
    opaqueContentPolicy: "reject",
  } as const;
}

function uuidFactory() {
  const values = [
    "f4444444-4444-4444-8444-444444444444",
    "f5555555-5555-4555-8555-555555555555",
    "f6666666-6666-4666-8666-666666666666",
  ];
  let index = 0;
  return () => {
    const value = values[index];
    if (value === undefined) throw new Error("UUID fixture exhausted.");
    index += 1;
    return value;
  };
}

async function preview(
  fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>,
) {
  const result = await executeManagedEvidencePublicRequest(
    {
      root: fixture.publication.workspacePath,
      mode: "preview",
      demandId: EVIDENCE_DEMAND_ID,
      selection: fileSelection(),
    },
    {
      preview: {
        uuidFactory: uuidFactory(),
        clock: () => EVIDENCE_CAPTURED_AT,
      },
    },
  );
  if (result.mode !== "preview") throw new Error("Expected preview result.");
  return result;
}

test("公共preview/apply只返回确认计划与metadata receipt，并支持末端healthy recovery", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const planned = await preview(fixture);
    const transaction = parseManagedEvidencePublicationTransaction(
      planned.plan,
    );
    equal(
      transaction.manifest.evidenceId,
      "evidence_f4444444-4444-4444-8444-444444444444",
    );
    equal(
      transaction.demandEventSourcingAppend.eventId,
      "demand-event_f5555555-5555-4555-8555-555555555555",
    );
    equal(
      transaction.demandEventSourcingAppend.commitId,
      "demand-event-commit_f6666666-6666-4666-8666-666666666666",
    );
    equal(
      existsSync(
        path.join(
          demandRootPath(fixture),
          "transactions",
          "managed-evidence-publication.json",
        ),
      ),
      false,
    );

    await rejects(
      executeManagedEvidencePublicRequest({
        root: fixture.publication.workspacePath,
        mode: "apply",
        demandId: OTHER_DEMAND_ID,
        plan: planned.plan,
        planDigest: planned.planDigest,
      }),
      (error: unknown) =>
        error instanceof ManagedEvidencePublicCoordinatorError &&
        error.reason === "apply" &&
        error.publicationAuthority === "unchanged",
    );

    const applied = await executeManagedEvidencePublicRequest({
      root: fixture.publication.workspacePath,
      mode: "apply",
      demandId: EVIDENCE_DEMAND_ID,
      plan: planned.plan,
      planDigest: planned.planDigest,
    });
    if (applied.mode !== "apply") throw new Error("Expected apply result.");
    equal(applied.status, "current");
    equal(applied.publication.evidenceId, transaction.manifest.evidenceId);
    equal(
      applied.publication.payloadArtifactDigest,
      transaction.manifest.payload.artifactDigest,
    );
    const serialized = JSON.stringify(applied);
    equal(serialized.includes(fixture.publication.workspacePath), false);
    equal(serialized.includes(fixture.repositoryRoot), false);
    equal(serialized.includes("artifacts/test-run"), false);
    equal(serialized.includes("payloadVerification"), false);

    const replayed = await executeManagedEvidencePublicRequest({
      root: fixture.publication.workspacePath,
      mode: "apply",
      demandId: EVIDENCE_DEMAND_ID,
      plan: planned.plan,
      planDigest: planned.planDigest,
    });
    deepEqual(replayed, applied);

    const recovered = await executeManagedEvidencePublicRequest({
      root: fixture.publication.workspacePath,
      mode: "recover",
      demandId: EVIDENCE_DEMAND_ID,
    });
    equal(recovered.mode, "recover");
    equal(recovered.status, "healthy");
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("公共recover在Event已提交时只前向完成并返回current receipt", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  let demandRoot: RootedDirectory | undefined;
  let sourceRoot: RootedDirectory | undefined;
  try {
    const planned = await preview(fixture);
    const transaction = parseManagedEvidencePublicationTransaction(
      planned.plan,
    );
    demandRoot = await RootedDirectory.open(demandRootPath(fixture));
    sourceRoot = await RootedDirectory.open(fixture.repositoryRoot);
    await createManagedEvidencePublicationTransactionJournal(
      demandRoot,
      transaction,
    );
    await materializeManagedEvidencePublicationStage(
      sourceRoot,
      demandRoot,
      transaction,
    );
    await executeDemandEventSourcingCommand(
      new DemandEventSourcingRepository(demandRoot),
      deriveManagedEvidencePublicationEventSourcingCommand(transaction),
      {
        commitId: transaction.demandEventSourcingAppend.commitId,
        expectedStreamRevision:
          transaction.demandEventSourcingAppend.expectedStreamRevision,
      },
    );
    await sourceRoot.close();
    sourceRoot = undefined;
    await demandRoot.close();
    demandRoot = undefined;

    const recovered = await executeManagedEvidencePublicRequest({
      root: fixture.publication.workspacePath,
      mode: "recover",
      demandId: EVIDENCE_DEMAND_ID,
    });
    if (recovered.status !== "current") {
      throw new Error("Expected current recovery.");
    }
    equal(recovered.publication.evidenceId, transaction.manifest.evidenceId);
    equal(
      recovered.publication.transactionDigest,
      planned.planDigest,
    );
  } finally {
    if (sourceRoot !== undefined) await sourceRoot.close();
    if (demandRoot !== undefined) await demandRoot.close();
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("公共recover在Event前CAS过期时返回retired-stale而不伪造publication", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  let demandRoot: RootedDirectory | undefined;
  try {
    const planned = await preview(fixture);
    const transaction = parseManagedEvidencePublicationTransaction(
      planned.plan,
    );
    const rootPath = demandRootPath(fixture);
    demandRoot = await RootedDirectory.open(rootPath);
    await createManagedEvidencePublicationTransactionJournal(
      demandRoot,
      transaction,
    );
    const recordPlan =
      deriveManagedEvidencePublicationRecordTreePlan(transaction);
    mkdirSync(physical(rootPath, MANAGED_EVIDENCE_ROOT_REF), { mode: 0o700 });
    mkdirSync(physical(rootPath, recordPlan.candidateRootPath), {
      mode: 0o700,
    });
    await executeDemandEventSourcingCommand(
      new DemandEventSourcingRepository(demandRoot),
      {
        commandType: "lifecycle.cancel-demand",
        commandVersion: 1,
        demandId: EVIDENCE_DEMAND_ID,
        eventId: CANCELLATION_EVENT_ID,
        recordedAt: parseUtcInstant("2026-09-01T21:02:00.000Z"),
        reason: "测试公共Evidence恢复的过期CAS退休",
      },
      {
        commitId: CANCELLATION_COMMIT_ID,
        expectedStreamRevision:
          transaction.demandEventSourcingAppend.expectedStreamRevision,
      },
    );
    await demandRoot.close();
    demandRoot = undefined;

    const recovered = await executeManagedEvidencePublicRequest({
      root: fixture.publication.workspacePath,
      mode: "recover",
      demandId: EVIDENCE_DEMAND_ID,
    });
    if (recovered.status !== "retired-stale") {
      throw new Error("Expected retired-stale recovery.");
    }
    equal(recovered.retirement.evidenceId, transaction.manifest.evidenceId);
    equal(Object.hasOwn(recovered, "publication"), false);
  } finally {
    if (demandRoot !== undefined) await demandRoot.close();
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("公共apply在journal后失败时报告recoverable且不回显source", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const planned = await preview(fixture);
    const sourcePath = path.join(
      fixture.repositoryRoot,
      "artifacts",
      "test-run",
      "logs",
      "report.txt",
    );
    rmSync(sourcePath);
    await rejects(
      executeManagedEvidencePublicRequest({
        root: fixture.publication.workspacePath,
        mode: "apply",
        demandId: EVIDENCE_DEMAND_ID,
        plan: planned.plan,
        planDigest: planned.planDigest,
      }),
      (error: unknown) =>
        error instanceof ManagedEvidencePublicCoordinatorError &&
        error.reason === "apply" &&
        error.publicationAuthority === "recoverable" &&
        error.causeReason === "stage",
    );
    equal(
      existsSync(
        path.join(
          demandRootPath(fixture),
          "transactions",
          "managed-evidence-publication.json",
        ),
      ),
      true,
    );
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});
