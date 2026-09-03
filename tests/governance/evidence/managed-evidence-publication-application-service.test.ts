import { equal, rejects } from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3.js";
import { renderWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3-document.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { executeDemandEventSourcingCommand } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { ManagedEvidenceCapturePlanningService } from "../../../src/governance/evidence/managed-evidence-capture-planning-service.js";
import { ManagedEvidencePublicationApplicationService } from "../../../src/governance/evidence/managed-evidence-publication-application-service.js";
import { materializeManagedEvidencePublicationStage } from "../../../src/governance/evidence/managed-evidence-publication-stage-materializer.js";
import { createManagedEvidencePublicationTransactionJournal } from "../../../src/governance/evidence/managed-evidence-publication-transaction-store.js";
import {
  completeManagedEvidencePublicationTransaction,
  retireStaleManagedEvidencePublicationTransaction,
  ManagedEvidencePublicationTransactionSettlementError,
} from "../../../src/governance/evidence/managed-evidence-publication-transaction-settlement.js";
import {
  computeManagedEvidencePublicationTransactionDigest,
  createManagedEvidencePublicationTransaction,
  deriveManagedEvidencePublicationEventSourcingCommand,
  deriveManagedEvidencePublicationRecordTreePlan,
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

const EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_d1111111-1111-4111-8111-111111111111",
  "demand-event",
);
const COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_d2222222-2222-4222-8222-222222222222",
  "demand-event-commit",
);
const CANCELLATION_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_d3333333-3333-4333-8333-333333333333",
  "demand-event",
);
const CANCELLATION_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_d4444444-4444-4444-8444-444444444444",
  "demand-event-commit",
);

function physical(root: string, ref: string): string {
  return path.join(root, ...ref.split("/"));
}

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

function sourceFilePath(
  fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>,
): string {
  return path.join(
    fixture.repositoryRoot,
    "artifacts",
    "test-run",
    "logs",
    "report.txt",
  );
}

function changePresentationLanguage(
  fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>,
): void {
  const configPath = path.join(
    fixture.publication.workspacePath,
    "wakeflow.config.json",
  );
  const current = JSON.parse(readFileSync(configPath, "utf8")) as Record<
    string,
    unknown
  >;
  const changed = parseWakeflowConfigV3({
    ...current,
    presentation: { language: "zh-Hans" },
  });
  writeFileSync(configPath, renderWakeflowConfigV3(changed));
}

async function createTransaction(
  fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>,
) {
  const capturePlan = await new ManagedEvidenceCapturePlanningService(
    fixture.publication.workspaceRoot,
  ).preview(
    EVIDENCE_DEMAND_ID,
    {
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
    },
    {
      uuidFactory: () => "d5555555-5555-4555-8555-555555555555",
      clock: () => EVIDENCE_CAPTURED_AT,
    },
  );
  const transaction = createManagedEvidencePublicationTransaction({
    capturePlan,
    eventId: EVENT_ID,
    commitId: COMMIT_ID,
  });
  return Object.freeze({
    capturePlan,
    transaction,
    transactionDigest:
      computeManagedEvidencePublicationTransactionDigest(transaction),
  });
}

test("Application按journal、stage、Event、final和健康闭包完成发布", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const prepared = await createTransaction(fixture);
    const service = new ManagedEvidencePublicationApplicationService(
      fixture.publication.workspaceRoot,
    );
    const result = await service.apply(
      prepared.transaction,
      prepared.transactionDigest,
    );
    const plan = deriveManagedEvidencePublicationRecordTreePlan(
      prepared.transaction,
    );
    equal(result.disposition, "completed");
    equal(result.eventDisposition, "committed");
    equal(result.record.disposition, "published");
    equal(
      result.loaded.aggregate.state.managedEvidence?.[0]?.evidenceId,
      prepared.capturePlan.manifest.evidenceId,
    );
    equal(
      existsSync(physical(demandRootPath(fixture), plan.destinationRootPath)),
      true,
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
    const alreadySettled = await service.recover(EVIDENCE_DEMAND_ID);
    equal(alreadySettled.disposition, "healthy");
    equal(
      alreadySettled.loaded.aggregate.state.managedEvidence?.[0]?.evidenceId,
      prepared.capturePlan.manifest.evidenceId,
    );
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("Recovery从Event前完整stage继续且不受后续Config/source变化影响", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  let demandRoot: RootedDirectory | undefined;
  let ledgerRoot: RootedDirectory | undefined;
  let sourceRoot: RootedDirectory | undefined;
  try {
    const prepared = await createTransaction(fixture);
    demandRoot = await RootedDirectory.open(demandRootPath(fixture));
    sourceRoot = await RootedDirectory.open(fixture.repositoryRoot);
    const stored = await createManagedEvidencePublicationTransactionJournal(
      demandRoot,
      prepared.transaction,
    );
    await materializeManagedEvidencePublicationStage(
      sourceRoot,
      demandRoot,
      prepared.transaction,
    );
    ledgerRoot = await RootedDirectory.open(
      path.join(fixture.publication.fixtureRoot, "wakeflow-ledger"),
    );
    await rejects(
      completeManagedEvidencePublicationTransaction(
        demandRoot,
        ledgerRoot,
        stored,
        "existing",
        undefined,
      ),
      (error: unknown) =>
        error instanceof
          ManagedEvidencePublicationTransactionSettlementError &&
        error.reason === "recovery-required",
    );
    await ledgerRoot.close();
    ledgerRoot = undefined;
    await sourceRoot.close();
    sourceRoot = undefined;
    await demandRoot.close();
    demandRoot = undefined;
    rmSync(sourceFilePath(fixture));
    changePresentationLanguage(fixture);

    const recovered = await new ManagedEvidencePublicationApplicationService(
      fixture.publication.workspaceRoot,
    ).recover(EVIDENCE_DEMAND_ID);
    equal(recovered.disposition, "completed");
    if (recovered.disposition !== "completed") {
      throw new Error("Expected completed recovery.");
    }
    equal(recovered.eventDisposition, "committed");
    equal(recovered.record.disposition, "published");
  } finally {
    if (sourceRoot !== undefined) await sourceRoot.close();
    if (ledgerRoot !== undefined) await ledgerRoot.close();
    if (demandRoot !== undefined) await demandRoot.close();
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("Recovery在Event已提交后不重读source并前向发布final", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  let demandRoot: RootedDirectory | undefined;
  let ledgerRoot: RootedDirectory | undefined;
  let sourceRoot: RootedDirectory | undefined;
  try {
    const prepared = await createTransaction(fixture);
    demandRoot = await RootedDirectory.open(demandRootPath(fixture));
    sourceRoot = await RootedDirectory.open(fixture.repositoryRoot);
    const stored = await createManagedEvidencePublicationTransactionJournal(
      demandRoot,
      prepared.transaction,
    );
    await materializeManagedEvidencePublicationStage(
      sourceRoot,
      demandRoot,
      prepared.transaction,
    );
    await executeDemandEventSourcingCommand(
      new DemandEventSourcingRepository(demandRoot),
      deriveManagedEvidencePublicationEventSourcingCommand(
        prepared.transaction,
      ),
      {
        commitId: prepared.transaction.demandEventSourcingAppend.commitId,
        expectedStreamRevision:
          prepared.transaction.demandEventSourcingAppend
            .expectedStreamRevision,
      },
    );
    ledgerRoot = await RootedDirectory.open(
      path.join(fixture.publication.fixtureRoot, "wakeflow-ledger"),
    );
    await rejects(
      retireStaleManagedEvidencePublicationTransaction(
        demandRoot,
        ledgerRoot,
        stored,
        undefined,
      ),
      (error: unknown) =>
        error instanceof
          ManagedEvidencePublicationTransactionSettlementError &&
        error.reason === "recovery-required",
    );
    await ledgerRoot.close();
    ledgerRoot = undefined;
    await sourceRoot.close();
    sourceRoot = undefined;
    await demandRoot.close();
    demandRoot = undefined;
    rmSync(sourceFilePath(fixture));

    const recovered = await new ManagedEvidencePublicationApplicationService(
      fixture.publication.workspaceRoot,
    ).recover(EVIDENCE_DEMAND_ID);
    equal(recovered.disposition, "completed");
    if (recovered.disposition !== "completed") {
      throw new Error("Expected completed recovery.");
    }
    equal(recovered.eventDisposition, "existing");
    equal(recovered.record.disposition, "published");
    equal(recovered.loaded.aggregate.state.managedEvidence?.length, 1);
  } finally {
    if (sourceRoot !== undefined) await sourceRoot.close();
    if (ledgerRoot !== undefined) await ledgerRoot.close();
    if (demandRoot !== undefined) await demandRoot.close();
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("Recovery在目标Event前CAS过期时退休partial stage与journal", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  let demandRoot: RootedDirectory | undefined;
  try {
    const prepared = await createTransaction(fixture);
    const rootPath = demandRootPath(fixture);
    demandRoot = await RootedDirectory.open(rootPath);
    await createManagedEvidencePublicationTransactionJournal(
      demandRoot,
      prepared.transaction,
    );
    const plan = deriveManagedEvidencePublicationRecordTreePlan(
      prepared.transaction,
    );
    mkdirSync(physical(rootPath, MANAGED_EVIDENCE_ROOT_REF), { mode: 0o700 });
    mkdirSync(physical(rootPath, plan.candidateRootPath), { mode: 0o700 });
    await executeDemandEventSourcingCommand(
      new DemandEventSourcingRepository(demandRoot),
      {
        commandType: "lifecycle.cancel-demand",
        commandVersion: 1,
        demandId: EVIDENCE_DEMAND_ID,
        eventId: CANCELLATION_EVENT_ID,
        recordedAt: parseUtcInstant("2026-09-01T21:01:00.000Z"),
        reason: "测试Event前乐观并发冲突恢复",
      },
      {
        commitId: CANCELLATION_COMMIT_ID,
        expectedStreamRevision:
          prepared.transaction.demandEventSourcingAppend
            .expectedStreamRevision,
      },
    );
    await demandRoot.close();
    demandRoot = undefined;

    const recovered = await new ManagedEvidencePublicationApplicationService(
      fixture.publication.workspaceRoot,
    ).recover(EVIDENCE_DEMAND_ID);
    equal(recovered.disposition, "retired-stale");
    if (recovered.disposition !== "retired-stale") {
      throw new Error("Expected stale retirement.");
    }
    equal(recovered.candidateRetirement.disposition, "retired");
    equal(recovered.loaded.aggregate.state.lifecycle, "cancelled");
    equal(existsSync(physical(rootPath, plan.candidateRootPath)), false);
    equal(
      existsSync(
        path.join(
          rootPath,
          "transactions",
          "managed-evidence-publication.json",
        ),
      ),
      false,
    );
  } finally {
    if (demandRoot !== undefined) await demandRoot.close();
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});
