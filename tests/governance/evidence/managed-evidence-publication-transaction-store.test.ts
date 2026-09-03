import {
  deepEqual,
  equal,
  rejects,
} from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  createManagedEvidencePublicationTransaction,
  renderManagedEvidencePublicationTransaction,
} from "../../../src/governance/evidence/managed-evidence-publication-transaction.js";
import {
  createManagedEvidencePublicationTransactionJournal,
  loadManagedEvidencePublicationTransaction,
  retireManagedEvidencePublicationTransactionJournal,
  MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_FILE_MODE,
  ManagedEvidencePublicationTransactionStoreError,
  type ManagedEvidencePublicationTransactionStoreErrorReason,
} from "../../../src/governance/evidence/managed-evidence-publication-transaction-store.js";
import { MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF } from "../../../src/governance/evidence/managed-evidence-resource-paths.js";
import {
  createManagedEvidencePublicationTransactionFixture,
} from "./managed-evidence-publication.fixture.js";

const OTHER_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_99999999-9999-4999-8999-999999999999",
  "demand-event",
);
const OTHER_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "demand-event-commit",
);

interface StoreFixture {
  readonly rootPath: string;
  readonly root: RootedDirectory;
  readonly journalPath: string;
}

async function createStoreFixture(): Promise<StoreFixture> {
  const rootPath = mkdtempSync(
    path.join(os.tmpdir(), "wakeflow-managed-evidence-store-"),
  );
  chmodSync(rootPath, 0o700);
  mkdirSync(path.join(rootPath, "transactions"), { mode: 0o700 });
  return Object.freeze({
    rootPath,
    root: await RootedDirectory.open(rootPath),
    journalPath: path.join(
      rootPath,
      ...MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF.split("/"),
    ),
  });
}

async function cleanupStoreFixture(fixture: StoreFixture): Promise<void> {
  await fixture.root.close();
  rmSync(fixture.rootPath, { recursive: true, force: true });
}

async function expectStoreError(
  action: Promise<unknown>,
  reason: ManagedEvidencePublicationTransactionStoreErrorReason,
): Promise<void> {
  await rejects(
    action,
    (error: unknown) =>
      error instanceof ManagedEvidencePublicationTransactionStoreError &&
      error.reason === reason,
  );
}

test("Transaction Store严格absent-only创建并稳定重读0600单链接journal", async () => {
  const fixture = await createStoreFixture();
  try {
    const { transaction } =
      createManagedEvidencePublicationTransactionFixture();
    equal(
      await loadManagedEvidencePublicationTransaction(fixture.root),
      null,
    );
    const stored = await createManagedEvidencePublicationTransactionJournal(
      fixture.root,
      transaction,
    );
    deepEqual(stored.transaction, transaction);
    equal(
      stored.source.resourcePath,
      MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF,
    );
    equal(
      stored.source.node.permissionBits,
      MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_FILE_MODE,
    );
    equal(stored.source.node.linkCount, 1n);
    equal(Object.isFrozen(stored), true);

    const loaded = await loadManagedEvidencePublicationTransaction(
      fixture.root,
    );
    if (loaded === null) throw new Error("Expected stored transaction.");
    deepEqual(loaded.transaction, transaction);
    equal(loaded.transactionDigest, stored.transactionDigest);
    await expectStoreError(
      createManagedEvidencePublicationTransactionJournal(
        fixture.root,
        transaction,
      ),
      "transaction-exists",
    );
  } finally {
    await cleanupStoreFixture(fixture);
  }
});

test("Transaction Store只凭签发能力退休exact文档并拒绝替换journal", async () => {
  const fixture = await createStoreFixture();
  try {
    const { capturePlan, transaction } =
      createManagedEvidencePublicationTransactionFixture();
    const stored = await createManagedEvidencePublicationTransactionJournal(
      fixture.root,
      transaction,
    );
    await expectStoreError(
      retireManagedEvidencePublicationTransactionJournal(
        fixture.root,
        structuredClone(stored),
      ),
      "input",
    );

    const replacement = createManagedEvidencePublicationTransaction({
      capturePlan,
      eventId: OTHER_EVENT_ID,
      commitId: OTHER_COMMIT_ID,
    });
    writeFileSync(
      fixture.journalPath,
      renderManagedEvidencePublicationTransaction(replacement),
    );
    await expectStoreError(
      retireManagedEvidencePublicationTransactionJournal(
        fixture.root,
        stored,
      ),
      "conflict",
    );
    equal(existsSync(fixture.journalPath), true);

    const current = await loadManagedEvidencePublicationTransaction(
      fixture.root,
    );
    if (current === null) throw new Error("Expected replacement journal.");
    const receipt =
      await retireManagedEvidencePublicationTransactionJournal(
        fixture.root,
        current,
      );
    equal(receipt.transactionDigest, current.transactionDigest);
    equal(receipt.retirement.replacementObserved, false);
    equal(existsSync(fixture.journalPath), false);
    await expectStoreError(
      retireManagedEvidencePublicationTransactionJournal(
        fixture.root,
        current,
      ),
      "input",
    );
  } finally {
    await cleanupStoreFixture(fixture);
  }
});

test("Transaction Store拒绝错误节点策略并在预取消时保持absent", async () => {
  const fixture = await createStoreFixture();
  try {
    const { transaction } =
      createManagedEvidencePublicationTransactionFixture();
    writeFileSync(
      fixture.journalPath,
      renderManagedEvidencePublicationTransaction(transaction),
      { mode: 0o644 },
    );
    await expectStoreError(
      loadManagedEvidencePublicationTransaction(fixture.root),
      "conflict",
    );
    rmSync(fixture.journalPath);

    const controller = new AbortController();
    controller.abort();
    await expectStoreError(
      createManagedEvidencePublicationTransactionJournal(
        fixture.root,
        transaction,
        { signal: controller.signal },
      ),
      "aborted",
    );
    equal(existsSync(fixture.journalPath), false);
  } finally {
    await cleanupStoreFixture(fixture);
  }
});
