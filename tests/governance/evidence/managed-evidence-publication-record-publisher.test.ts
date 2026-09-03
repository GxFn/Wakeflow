import { equal, rejects } from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  publishManagedEvidencePublicationRecord,
  ManagedEvidencePublicationRecordPublisherError,
  type ManagedEvidencePublicationRecordPublisherErrorReason,
} from "../../../src/governance/evidence/managed-evidence-publication-record-publisher.js";
import {
  createManagedEvidencePublicationTransactionJournal,
  loadManagedEvidencePublicationTransaction,
} from "../../../src/governance/evidence/managed-evidence-publication-transaction-store.js";
import { deriveManagedEvidencePublicationRecordTreePlan } from "../../../src/governance/evidence/managed-evidence-publication-transaction.js";
import { inspectManagedEvidenceRecordSetInventory } from "../../../src/governance/evidence/managed-evidence-record-set-inventory.js";
import {
  MANAGED_EVIDENCE_MANIFEST_FILE_NAME,
  MANAGED_EVIDENCE_ROOT_REF,
} from "../../../src/governance/evidence/managed-evidence-resource-paths.js";
import { renderManagedEvidenceManifest } from "../../../src/governance/evidence/managed-evidence-manifest.js";
import {
  createManagedEvidencePublicationTransactionFixture,
  MANAGED_EVIDENCE_PUBLICATION_TEST_CONTENT,
} from "./managed-evidence-publication.fixture.js";

interface PublisherFixture {
  readonly rootPath: string;
  readonly root: RootedDirectory;
}

async function createPublisherFixture(): Promise<PublisherFixture> {
  const rootPath = mkdtempSync(
    path.join(os.tmpdir(), "wakeflow-evidence-record-publisher-"),
  );
  mkdirSync(path.join(rootPath, "artifacts"), { mode: 0o700 });
  mkdirSync(path.join(rootPath, "transactions"), { mode: 0o700 });
  return Object.freeze({
    rootPath,
    root: await RootedDirectory.open(rootPath),
  });
}

async function cleanupPublisherFixture(
  fixture: PublisherFixture,
): Promise<void> {
  await fixture.root.close();
  rmSync(fixture.rootPath, { recursive: true, force: true });
}

function physical(root: string, ref: string): string {
  return path.join(root, ...ref.split("/"));
}

function materializeExactRecordTree(
  fixture: PublisherFixture,
  transaction: ReturnType<
    typeof createManagedEvidencePublicationTransactionFixture
  >["transaction"],
  target: "stage" | "final",
): string {
  const plan = deriveManagedEvidencePublicationRecordTreePlan(transaction);
  const targetPath = physical(
    fixture.rootPath,
    target === "stage"
      ? plan.candidateRootPath
      : plan.destinationRootPath,
  );
  mkdirSync(physical(fixture.rootPath, MANAGED_EVIDENCE_ROOT_REF), {
    recursive: true,
    mode: 0o700,
  });
  mkdirSync(path.join(targetPath, "payload"), {
    recursive: true,
    mode: 0o700,
  });
  writeFileSync(
    path.join(targetPath, "payload", "content"),
    MANAGED_EVIDENCE_PUBLICATION_TEST_CONTENT,
    { mode: 0o600 },
  );
  writeFileSync(
    path.join(targetPath, MANAGED_EVIDENCE_MANIFEST_FILE_NAME),
    renderManagedEvidenceManifest(transaction.manifest),
    { mode: 0o600 },
  );
  return targetPath;
}

async function expectPublisherError(
  action: Promise<unknown>,
  reason: ManagedEvidencePublicationRecordPublisherErrorReason,
): Promise<void> {
  await rejects(
    action,
    (error: unknown) =>
      error instanceof ManagedEvidencePublicationRecordPublisherError &&
      error.reason === reason,
  );
}

test("Record Publisher耐久发布完整stage、保留journal并幂等读取final", async () => {
  const fixture = await createPublisherFixture();
  try {
    const { transaction } =
      createManagedEvidencePublicationTransactionFixture();
    const stored = await createManagedEvidencePublicationTransactionJournal(
      fixture.root,
      transaction,
    );
    const stagePath = materializeExactRecordTree(
      fixture,
      transaction,
      "stage",
    );
    const result = await publishManagedEvidencePublicationRecord(
      fixture.root,
      transaction,
    );
    const plan = deriveManagedEvidencePublicationRecordTreePlan(transaction);
    const finalPath = physical(fixture.rootPath, plan.destinationRootPath);
    equal(result.disposition, "published");
    equal(result.transactionDigest, stored.transactionDigest);
    equal(existsSync(stagePath), false);
    equal(existsSync(finalPath), true);
    equal(
      readFileSync(path.join(finalPath, "payload", "content"), "utf8"),
      "managed evidence\n",
    );
    equal(
      (await loadManagedEvidencePublicationTransaction(fixture.root))
        ?.transactionDigest,
      stored.transactionDigest,
    );

    const current = await publishManagedEvidencePublicationRecord(
      fixture.root,
      transaction,
    );
    equal(current.disposition, "current");
    equal(current.publication, null);
    const managedRootNode = (
      await fixture.root.inspectExistingResource(MANAGED_EVIDENCE_ROOT_REF)
    ).node;
    const journal = await loadManagedEvidencePublicationTransaction(
      fixture.root,
    );
    if (journal === null) throw new Error("Expected journal.");
    const inventory = await inspectManagedEvidenceRecordSetInventory(
      fixture.root,
      {
        expectedRootNode: managedRootNode,
        expectedTransactionNode: journal.source.node,
      },
    );
    equal(inventory.publication?.physicalState, "final");
  } finally {
    await cleanupPublisherFixture(fixture);
  }
});

test("Record Publisher拒绝缺失、不完整及stage/final并存状态", async () => {
  const fixture = await createPublisherFixture();
  try {
    const { transaction } =
      createManagedEvidencePublicationTransactionFixture();
    await createManagedEvidencePublicationTransactionJournal(
      fixture.root,
      transaction,
    );
    await expectPublisherError(
      publishManagedEvidencePublicationRecord(fixture.root, transaction),
      "stage-missing",
    );

    const plan = deriveManagedEvidencePublicationRecordTreePlan(transaction);
    mkdirSync(physical(fixture.rootPath, MANAGED_EVIDENCE_ROOT_REF), {
      mode: 0o700,
    });
    mkdirSync(physical(fixture.rootPath, plan.candidateRootPath), {
      mode: 0o700,
    });
    await expectPublisherError(
      publishManagedEvidencePublicationRecord(fixture.root, transaction),
      "stage-conflict",
    );
    rmSync(physical(fixture.rootPath, plan.candidateRootPath), {
      recursive: true,
    });

    materializeExactRecordTree(fixture, transaction, "stage");
    materializeExactRecordTree(fixture, transaction, "final");
    await expectPublisherError(
      publishManagedEvidencePublicationRecord(fixture.root, transaction),
      "stage-conflict",
    );
  } finally {
    await cleanupPublisherFixture(fixture);
  }
});

test("Record Publisher要求exact journal并拒绝内容漂移的既有final", async () => {
  const fixture = await createPublisherFixture();
  try {
    const { transaction } =
      createManagedEvidencePublicationTransactionFixture();
    const finalPath = materializeExactRecordTree(
      fixture,
      transaction,
      "final",
    );
    await expectPublisherError(
      publishManagedEvidencePublicationRecord(fixture.root, transaction),
      "journal",
    );
    await createManagedEvidencePublicationTransactionJournal(
      fixture.root,
      transaction,
    );
    equal(
      (
        await publishManagedEvidencePublicationRecord(
          fixture.root,
          transaction,
        )
      ).disposition,
      "current",
    );
    writeFileSync(path.join(finalPath, "payload", "content"), "drifted\n");
    await expectPublisherError(
      publishManagedEvidencePublicationRecord(fixture.root, transaction),
      "final-conflict",
    );
  } finally {
    await cleanupPublisherFixture(fixture);
  }
});
