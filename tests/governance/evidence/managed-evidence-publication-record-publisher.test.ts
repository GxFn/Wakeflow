import { equal, rejects } from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  RootedResourceParentHandle,
  RootedResourceParentHandleError,
} from "../../../src/foundation/filesystem/rooted-resource-parent-handle.js";
import { renderManagedEvidenceManifest } from "../../../src/governance/evidence/managed-evidence-manifest.js";
import {
  ManagedEvidencePublicationRecordPublisherError,
  type ManagedEvidencePublicationRecordPublisherErrorReason,
  publishManagedEvidencePublicationRecord,
} from "../../../src/governance/evidence/managed-evidence-publication-record-publisher.js";
import { deriveManagedEvidencePublicationRecordTreePlan } from "../../../src/governance/evidence/managed-evidence-publication-transaction.js";
import {
  createManagedEvidencePublicationTransactionJournal,
  loadManagedEvidencePublicationTransaction,
} from "../../../src/governance/evidence/managed-evidence-publication-transaction-store.js";
import { inspectManagedEvidenceRecordSetInventory } from "../../../src/governance/evidence/managed-evidence-record-set-inventory.js";
import {
  MANAGED_EVIDENCE_MANIFEST_FILE_NAME,
  MANAGED_EVIDENCE_ROOT_REF,
} from "../../../src/governance/evidence/managed-evidence-resource-paths.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import {
  createManagedEvidencePublicationTransactionFixture,
  MANAGED_EVIDENCE_PUBLICATION_TEST_CONTENT,
} from "./managed-evidence-publication.fixture.js";

useDisposableDurability();

/**
 * 1 级（组件）：Record Publisher 在一次性 Demand 根上的 stage → final 发布——耐久发布与幂等读取、缺失与并存
 * 状态的拒绝、exact journal 与内容漂移，以及 final 可见但目录项未同步时的结局（open-items W11）。
 */

interface PublisherFixture {
  readonly rootPath: string;
  readonly root: RootedDirectory;
}

async function createPublisherFixture(): Promise<PublisherFixture> {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-evidence-record-publisher-"));
  mkdirSync(path.join(rootPath, "artifacts"), { mode: 0o700 });
  mkdirSync(path.join(rootPath, "transactions"), { mode: 0o700 });
  return Object.freeze({
    rootPath,
    root: await RootedDirectory.open(rootPath),
  });
}

async function cleanupPublisherFixture(fixture: PublisherFixture): Promise<void> {
  await fixture.root.close();
  rmSync(fixture.rootPath, { recursive: true, force: true });
}

function physical(root: string, ref: string): string {
  return path.join(root, ...ref.split("/"));
}

function materializeExactRecordTree(
  fixture: PublisherFixture,
  transaction: ReturnType<typeof createManagedEvidencePublicationTransactionFixture>["transaction"],
  target: "stage" | "final",
): string {
  const plan = deriveManagedEvidencePublicationRecordTreePlan(transaction);
  const targetPath = physical(
    fixture.rootPath,
    target === "stage" ? plan.candidateRootPath : plan.destinationRootPath,
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
      error instanceof ManagedEvidencePublicationRecordPublisherError && error.reason === reason,
  );
}

test("Record Publisher耐久发布完整stage、保留journal并幂等读取final", async () => {
  const fixture = await createPublisherFixture();
  try {
    const { transaction } = createManagedEvidencePublicationTransactionFixture();
    const stored = await createManagedEvidencePublicationTransactionJournal(
      fixture.root,
      transaction,
    );
    const stagePath = materializeExactRecordTree(fixture, transaction, "stage");
    const result = await publishManagedEvidencePublicationRecord(fixture.root, transaction);
    const plan = deriveManagedEvidencePublicationRecordTreePlan(transaction);
    const finalPath = physical(fixture.rootPath, plan.destinationRootPath);
    equal(result.disposition, "published");
    equal(result.transactionDigest, stored.transactionDigest);
    equal(existsSync(stagePath), false);
    equal(existsSync(finalPath), true);
    equal(readFileSync(path.join(finalPath, "payload", "content"), "utf8"), "managed evidence\n");
    equal(
      (await loadManagedEvidencePublicationTransaction(fixture.root))?.transactionDigest,
      stored.transactionDigest,
    );

    const current = await publishManagedEvidencePublicationRecord(fixture.root, transaction);
    equal(current.disposition, "current");
    equal(current.publication, null);
    const managedRootNode = (await fixture.root.inspectExistingResource(MANAGED_EVIDENCE_ROOT_REF))
      .node;
    const journal = await loadManagedEvidencePublicationTransaction(fixture.root);
    if (journal === null) throw new Error("Expected journal.");
    const inventory = await inspectManagedEvidenceRecordSetInventory(fixture.root, {
      expectedRootNode: managedRootNode,
      expectedTransactionNode: journal.source.node,
    });
    equal(inventory.publication?.physicalState, "final");
  } finally {
    await cleanupPublisherFixture(fixture);
  }
});

test("Record Publisher拒绝缺失、不完整及stage/final并存状态", async () => {
  const fixture = await createPublisherFixture();
  try {
    const { transaction } = createManagedEvidencePublicationTransactionFixture();
    await createManagedEvidencePublicationTransactionJournal(fixture.root, transaction);
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
    const { transaction } = createManagedEvidencePublicationTransactionFixture();
    const finalPath = materializeExactRecordTree(fixture, transaction, "final");
    await expectPublisherError(
      publishManagedEvidencePublicationRecord(fixture.root, transaction),
      "journal",
    );
    await createManagedEvidencePublicationTransactionJournal(fixture.root, transaction);
    equal(
      (await publishManagedEvidencePublicationRecord(fixture.root, transaction)).disposition,
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

/**
 * 拦截 managed-evidence 父目录在 final 可见之后的 `sync`：计数，并按要求把第一次换成 sync-failure——这正是
 * rename 已经发生、父目录项还没同步的那一刻。
 */
function interceptFinalParentSync(
  t: TestContext,
  managedRootPath: string,
  finalPath: string,
  failOnce: boolean,
): { syncs: number; injected: boolean } {
  const originalSync = RootedResourceParentHandle.prototype.sync;
  const state = { syncs: 0, injected: false };
  t.mock.method(
    RootedResourceParentHandle.prototype,
    "sync",
    async function (this: RootedResourceParentHandle, ...args: Parameters<typeof originalSync>) {
      if (this.parentAbsolutePath === managedRootPath && existsSync(finalPath)) {
        state.syncs += 1;
        if (failOnce && !state.injected) {
          state.injected = true;
          throw new RootedResourceParentHandleError("sync-failure", "$test");
        }
      }
      return originalSync.apply(this, args);
    },
  );
  return state;
}

test("final 目录项同步失败不是 current：publisher 抛 durability-failure、final 可见、journal 保留；再次发布先补父目录同步再返回 current（open-items W11）", async (t) => {
  const fixture = await createPublisherFixture();
  try {
    const { transaction } = createManagedEvidencePublicationTransactionFixture();
    const stored = await createManagedEvidencePublicationTransactionJournal(
      fixture.root,
      transaction,
    );
    const stagePath = materializeExactRecordTree(fixture, transaction, "stage");
    const plan = deriveManagedEvidencePublicationRecordTreePlan(transaction);
    const finalPath = physical(fixture.root.absolutePath, plan.destinationRootPath);
    const state = interceptFinalParentSync(
      t,
      physical(fixture.root.absolutePath, MANAGED_EVIDENCE_ROOT_REF),
      finalPath,
      true,
    );
    await expectPublisherError(
      publishManagedEvidencePublicationRecord(fixture.root, transaction),
      "durability-failure",
    );
    equal(state.injected, true);
    equal(existsSync(finalPath), true);
    equal(existsSync(stagePath), false);
    equal(
      (await loadManagedEvidencePublicationTransaction(fixture.root))?.transactionDigest,
      stored.transactionDigest,
    );
    const syncsBefore = state.syncs;
    const current = await publishManagedEvidencePublicationRecord(fixture.root, transaction);
    equal(current.disposition, "current");
    equal(current.publication, null);
    equal(state.syncs > syncsBefore, true, "a visible final is synchronized before it is current");
    equal(readFileSync(path.join(finalPath, "payload", "content"), "utf8"), "managed evidence\n");
  } finally {
    t.mock.restoreAll();
    await cleanupPublisherFixture(fixture);
  }
});

test("rename 提交后父目录句柄关闭失败：publisher 按 stage/final 实况识别同一结果，补父目录同步后返回 current（open-items W11）", async (t) => {
  const fixture = await createPublisherFixture();
  try {
    const { transaction } = createManagedEvidencePublicationTransactionFixture();
    await createManagedEvidencePublicationTransactionJournal(fixture.root, transaction);
    materializeExactRecordTree(fixture, transaction, "stage");
    const plan = deriveManagedEvidencePublicationRecordTreePlan(transaction);
    const finalPath = physical(fixture.root.absolutePath, plan.destinationRootPath);
    const managedRootPath = physical(fixture.root.absolutePath, MANAGED_EVIDENCE_ROOT_REF);
    const state = interceptFinalParentSync(t, managedRootPath, finalPath, false);
    const originalClose = RootedResourceParentHandle.prototype.close;
    let closeFailures = 0;
    t.mock.method(
      RootedResourceParentHandle.prototype,
      "close",
      async function (this: RootedResourceParentHandle) {
        await originalClose.call(this);
        if (
          closeFailures === 0 &&
          this.parentAbsolutePath === managedRootPath &&
          existsSync(finalPath)
        ) {
          closeFailures += 1;
          throw new RootedResourceParentHandleError("close-failure", "$test");
        }
      },
    );
    const result = await publishManagedEvidencePublicationRecord(fixture.root, transaction);
    equal(closeFailures, 1);
    equal(result.disposition, "current");
    equal(result.publication, null);
    // 一次来自 rename 自己的父目录同步，一次是识别 final 为 current 之前补的。
    equal(state.syncs, 2);
    equal(existsSync(physical(fixture.root.absolutePath, plan.candidateRootPath)), false);
  } finally {
    t.mock.restoreAll();
    await cleanupPublisherFixture(fixture);
  }
});
