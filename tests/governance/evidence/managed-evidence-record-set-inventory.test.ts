import { equal, rejects } from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { DemandFileEventStore } from "../../../src/governance/demand/event-sourcing/demand-file-event-store.js";
import { executeDemandEventSourcingCommand } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import {
  loadDemandEventSourcingRootAuthority,
  loadDemandEventSourcingRootAuthorityDuringManagedEvidencePublication,
  DemandEventSourcingRootAuthorityError,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-root-authority.js";
import {
  inspectDemandEventSourcingRootInventory,
  DemandEventSourcingRootInventoryError,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-root-inventory.js";
import {
  createManagedEvidenceManifest,
  renderManagedEvidenceManifest,
} from "../../../src/governance/evidence/managed-evidence-manifest.js";
import {
  createManagedEvidencePublicationTransaction,
  deriveManagedEvidencePublicationEventSourcingCommand,
  renderManagedEvidencePublicationTransaction,
} from "../../../src/governance/evidence/managed-evidence-publication-transaction.js";
import {
  createManagedEvidencePublicationTransactionJournal,
  retireManagedEvidencePublicationTransactionJournal,
} from "../../../src/governance/evidence/managed-evidence-publication-transaction-store.js";
import {
  managedEvidencePublicationStageRef,
  managedEvidenceRecordRootRef,
  MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF,
  MANAGED_EVIDENCE_ROOT_REF,
} from "../../../src/governance/evidence/managed-evidence-resource-paths.js";
import { ManagedEvidenceCapturePlanningService } from "../../../src/governance/evidence/managed-evidence-capture-planning-service.js";
import { LedgerAuthorityStore } from "../../../src/governance/ledger/ledger-authority-store.js";
import {
  cleanupManagedEvidenceCapturePlanningWorkspaceFixture,
  createManagedEvidenceCapturePlanningWorkspaceFixture,
  EVIDENCE_CAPTURED_AT,
  EVIDENCE_DEMAND_ID,
  EVIDENCE_REPOSITORY_ID,
} from "./managed-evidence-capture-planning-service.fixture.js";
import {
  createManagedEvidencePublicationTransactionFixture,
  MANAGED_EVIDENCE_PUBLICATION_TEST_CONTENT as CONTENT,
  MANAGED_EVIDENCE_PUBLICATION_TEST_IDS as IDS,
} from "./managed-evidence-publication.fixture.js";

function physical(root: string, ref: string): string {
  return path.join(root, ...ref.split("/"));
}

function transactionFixture() {
  const fixture = createManagedEvidencePublicationTransactionFixture();
  return {
    manifest: fixture.capturePlan.manifest,
    transaction: fixture.transaction,
  };
}

function createDemandRoot(rootPath: string): void {
  chmodSync(rootPath, 0o700);
  writeFileSync(path.join(rootPath, "identity.json"), "{}\n", { mode: 0o600 });
  writeFileSync(path.join(rootPath, "authority.json"), "{}\n", { mode: 0o600 });
  mkdirSync(path.join(rootPath, "artifacts"), { mode: 0o700 });
  mkdirSync(path.join(rootPath, "artifacts", "task-packages"), {
    mode: 0o700,
  });
  mkdirSync(path.join(rootPath, "transactions"), { mode: 0o700 });
}

function materializeRecordTree(
  rootPath: string,
  targetRef: string,
  manifestText: string,
  payloadBytes: Uint8Array,
): void {
  const target = physical(rootPath, targetRef);
  mkdirSync(target, { mode: 0o700 });
  mkdirSync(path.join(target, "payload"), { mode: 0o700 });
  writeFileSync(path.join(target, "payload", "content"), payloadBytes, {
    mode: 0o600,
  });
  writeFileSync(path.join(target, "manifest.json"), manifestText, {
    mode: 0o600,
  });
}

async function expectInventoryFailure(
  root: RootedDirectory,
  phase: "healthy" | "managed-evidence-publication" = "healthy",
): Promise<void> {
  await rejects(
    inspectDemandEventSourcingRootInventory(root, { phase }),
    (error: unknown) =>
      error instanceof DemandEventSourcingRootInventoryError &&
      error.reason === "tree-shape",
  );
}

test("Managed Evidence Root Inventory分类journal、stage、final并关闭健康Manifest顶层", async () => {
  const fixtureRoot = mkdtempSync(
    path.join(os.tmpdir(), "wakeflow-managed-evidence-inventory-"),
  );
  createDemandRoot(fixtureRoot);
  const root = await RootedDirectory.open(fixtureRoot);
  try {
    const eventStore = new DemandFileEventStore(root);
    await eventStore.initialize();
    const initial = await inspectDemandEventSourcingRootInventory(root);
    equal(initial.managedEvidence.recordCount, 0);
    equal(initial.managedEvidence.publication, null);

    const { manifest, transaction } = transactionFixture();
    writeFileSync(
      physical(fixtureRoot, MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF),
      renderManagedEvidencePublicationTransaction(transaction),
      { mode: 0o600 },
    );
    let inventory = await inspectDemandEventSourcingRootInventory(root, {
      phase: "managed-evidence-publication",
    });
    equal(inventory.transactionCount, 1);
    equal(inventory.managedEvidence.publication?.physicalState, "absent");

    mkdirSync(physical(fixtureRoot, MANAGED_EVIDENCE_ROOT_REF), {
      mode: 0o700,
    });
    const stageRef = managedEvidencePublicationStageRef(IDS.evidence);
    mkdirSync(physical(fixtureRoot, stageRef), { mode: 0o700 });
    inventory = await inspectDemandEventSourcingRootInventory(root, {
      phase: "managed-evidence-publication",
    });
    equal(
      inventory.managedEvidence.publication?.physicalState,
      "stage-incomplete",
    );

    const unknown = path.join(physical(fixtureRoot, stageRef), "foreign.txt");
    writeFileSync(unknown, "foreign\n", { mode: 0o600 });
    await expectInventoryFailure(root, "managed-evidence-publication");
    rmSync(unknown);

    rmSync(physical(fixtureRoot, stageRef), { recursive: true });
    materializeRecordTree(
      fixtureRoot,
      stageRef,
      renderManagedEvidenceManifest(manifest),
      CONTENT,
    );
    inventory = await inspectDemandEventSourcingRootInventory(root, {
      phase: "managed-evidence-publication",
    });
    equal(
      inventory.managedEvidence.publication?.physicalState,
      "stage-complete",
    );

    const finalRef = managedEvidenceRecordRootRef(IDS.evidence);
    renameSync(
      physical(fixtureRoot, stageRef),
      physical(fixtureRoot, finalRef),
    );
    inventory = await inspectDemandEventSourcingRootInventory(root, {
      phase: "managed-evidence-publication",
    });
    equal(inventory.managedEvidence.publication?.physicalState, "final");
    equal(inventory.managedEvidence.recordCount, 1);
    const payload = path.join(
      physical(fixtureRoot, finalRef),
      "payload",
      "content",
    );
    writeFileSync(payload, "changed evidence\n");
    await expectInventoryFailure(root, "managed-evidence-publication");
    writeFileSync(payload, CONTENT);
    await expectInventoryFailure(root);

    rmSync(physical(fixtureRoot, MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF));
    inventory = await inspectDemandEventSourcingRootInventory(root);
    equal(inventory.transactionCount, 0);
    equal(inventory.managedEvidence.recordCount, 1);
    equal(inventory.artifactCount, 1);
    equal(
      inventory.managedEvidence.records[0]?.manifestDigest,
      manifest.manifestDigest,
    );
    equal(
      inventory.managedEvidence.records[0]?.payloadVerification,
      "deferred",
    );

    writeFileSync(payload, "changed evidence\n");
    inventory = await inspectDemandEventSourcingRootInventory(root);
    equal(inventory.managedEvidence.recordCount, 1);
    equal(
      inventory.managedEvidence.records[0]?.payloadVerification,
      "deferred",
    );
  } finally {
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("健康Root Authority要求final记录与Managed Evidence Event selector精确一致", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  let demandRoot: RootedDirectory | undefined;
  let ledgerRoot: RootedDirectory | undefined;
  try {
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
        uuidFactory: () => "99999999-9999-4999-8999-999999999999",
        clock: () => EVIDENCE_CAPTURED_AT,
      },
    );
    const transaction = createManagedEvidencePublicationTransaction({
      capturePlan,
      eventId: IDS.event,
      commitId: IDS.commit,
    });
    const demandRootPath = path.join(
      fixture.publication.workspacePath,
      ".wakeflow-active",
      "current",
      EVIDENCE_DEMAND_ID,
    );
    demandRoot = await RootedDirectory.open(demandRootPath);
    ledgerRoot = await RootedDirectory.open(
      path.join(fixture.publication.fixtureRoot, "wakeflow-ledger"),
    );
    mkdirSync(physical(demandRootPath, MANAGED_EVIDENCE_ROOT_REF), {
      mode: 0o700,
    });
    const finalRef = managedEvidenceRecordRootRef(
      capturePlan.manifest.evidenceId,
    );
    materializeRecordTree(
      demandRootPath,
      finalRef,
      renderManagedEvidenceManifest(capturePlan.manifest),
      encodeUtf8("tests passed\n"),
    );

    const ledgerStore = new LedgerAuthorityStore(ledgerRoot);
    await rejects(
      loadDemandEventSourcingRootAuthority(demandRoot, ledgerStore),
      (error: unknown) =>
        error instanceof DemandEventSourcingRootAuthorityError &&
        error.reason === "closure" &&
        error.path === "$managed-evidence",
    );

    const stored =
      await createManagedEvidencePublicationTransactionJournal(
        demandRoot,
        transaction,
      );
    await rejects(
      loadDemandEventSourcingRootAuthorityDuringManagedEvidencePublication(
        demandRoot,
        ledgerStore,
        { audit: true },
      ),
      (error: unknown) =>
        error instanceof DemandEventSourcingRootAuthorityError &&
        error.reason === "closure" &&
        error.path === "$managed-evidence",
    );
    rmSync(physical(demandRootPath, finalRef), { recursive: true });
    const stageRef = managedEvidencePublicationStageRef(
      capturePlan.manifest.evidenceId,
    );
    materializeRecordTree(
      demandRootPath,
      stageRef,
      renderManagedEvidenceManifest(capturePlan.manifest),
      encodeUtf8("tests passed\n"),
    );
    let transactionAuthority =
      await loadDemandEventSourcingRootAuthorityDuringManagedEvidencePublication(
        demandRoot,
        ledgerStore,
        { audit: true },
      );
    equal(
      transactionAuthority.inventory.managedEvidence.publication
        ?.physicalState,
      "stage-complete",
    );
    equal(
      transactionAuthority.aggregate.state.managedEvidence,
      undefined,
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
    transactionAuthority =
      await loadDemandEventSourcingRootAuthorityDuringManagedEvidencePublication(
        demandRoot,
        ledgerStore,
        { audit: true },
      );
    equal(
      transactionAuthority.aggregate.state.managedEvidence?.[0]
        ?.manifestDigest,
      capturePlan.manifest.manifestDigest,
    );
    renameSync(
      physical(demandRootPath, stageRef),
      physical(demandRootPath, finalRef),
    );
    transactionAuthority =
      await loadDemandEventSourcingRootAuthorityDuringManagedEvidencePublication(
        demandRoot,
        ledgerStore,
        { audit: true },
      );
    equal(
      transactionAuthority.inventory.managedEvidence.publication
        ?.physicalState,
      "final",
    );
    await rejects(
      loadDemandEventSourcingRootAuthority(demandRoot, ledgerStore),
      (error: unknown) =>
        error instanceof DemandEventSourcingRootAuthorityError &&
        error.reason === "inventory",
    );
    await retireManagedEvidencePublicationTransactionJournal(
      demandRoot,
      stored,
    );
    const loaded = await loadDemandEventSourcingRootAuthority(
      demandRoot,
      ledgerStore,
      { audit: true },
    );
    equal(loaded.inventory.managedEvidence.recordCount, 1);
    equal(
      loaded.aggregate.state.managedEvidence?.[0]?.manifestDigest,
      capturePlan.manifest.manifestDigest,
    );
    const foreignManifest = createManagedEvidenceManifest(
      {
        evidenceId: capturePlan.manifest.evidenceId,
        programId: IDS.otherProgram,
        demandId: capturePlan.manifest.demandId,
        demandAuthorityDigest: capturePlan.manifest.demandAuthorityDigest,
        evidenceType: capturePlan.manifest.evidenceType,
        recordedBy: capturePlan.manifest.recordedBy,
        source: capturePlan.manifest.source,
        sensitivity: capturePlan.manifest.sensitivity,
        payload: capturePlan.manifest.payload,
        contentReview: capturePlan.manifest.contentReview,
      },
      { clock: () => capturePlan.manifest.capturedAt },
    );
    const manifestPath = path.join(
      physical(demandRootPath, finalRef),
      "manifest.json",
    );
    writeFileSync(manifestPath, renderManagedEvidenceManifest(foreignManifest));
    await rejects(
      loadDemandEventSourcingRootAuthority(demandRoot, ledgerStore),
      (error: unknown) =>
        error instanceof DemandEventSourcingRootAuthorityError &&
        error.reason === "closure" &&
        error.path === "$managed-evidence",
    );
    writeFileSync(
      manifestPath,
      renderManagedEvidenceManifest(capturePlan.manifest),
    );
    writeFileSync(
      path.join(physical(demandRootPath, finalRef), "payload", "content"),
      "changed after publication\n",
    );
    const deferred = await loadDemandEventSourcingRootAuthority(
      demandRoot,
      ledgerStore,
      { audit: true },
    );
    equal(
      deferred.inventory.managedEvidence.records[0]?.payloadVerification,
      "deferred",
    );
  } finally {
    if (demandRoot !== undefined) await demandRoot.close();
    if (ledgerRoot !== undefined) await ledgerRoot.close();
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});
