import { equal, rejects } from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseWakeflowConfig } from "../../../src/configuration/wakeflow-config.js";
import { renderWakeflowConfig } from "../../../src/configuration/wakeflow-config-document.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { filesystemMutation } from "../../../src/foundation/filesystem/filesystem-mutation.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  RootedResourceParentHandle,
  RootedResourceParentHandleError,
} from "../../../src/foundation/filesystem/rooted-resource-parent-handle.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { executeDemandEventSourcingCommand } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { ManagedEvidenceCapturePlanningService } from "../../../src/governance/evidence-publication/managed-evidence-capture-planning-service.js";
import {
  ManagedEvidencePublicationApplicationService,
  ManagedEvidencePublicationApplicationServiceError,
} from "../../../src/governance/evidence-publication/managed-evidence-publication-application-service.js";
import { materializeManagedEvidencePublicationStage } from "../../../src/governance/evidence-publication/managed-evidence-publication-stage-materializer.js";
import {
  computeManagedEvidencePublicationTransactionDigest,
  createManagedEvidencePublicationTransaction,
  deriveManagedEvidencePublicationEventSourcingCommand,
  deriveManagedEvidencePublicationRecordTreePlan,
} from "../../../src/governance/demand/managed-evidence/managed-evidence-publication-transaction.js";
import {
  completeManagedEvidencePublicationTransaction,
  ManagedEvidencePublicationTransactionSettlementError,
  retireStaleManagedEvidencePublicationTransaction,
} from "../../../src/governance/evidence-publication/managed-evidence-publication-transaction-settlement.js";
import { createManagedEvidencePublicationTransactionJournal } from "../../../src/governance/demand/managed-evidence/managed-evidence-publication-transaction-store.js";
import {
  MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF,
  MANAGED_EVIDENCE_ROOT_REF,
} from "../../../src/governance/evidence/managed-evidence-resource-paths.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import {
  cleanupManagedEvidenceCapturePlanningWorkspaceFixture,
  createManagedEvidenceCapturePlanningWorkspaceFixture,
  EVIDENCE_CAPTURED_AT,
  fileSelection,
  type ManagedEvidenceCapturePlanningWorkspaceFixture,
  readyCapturePlan,
} from "./managed-evidence-capture-planning-service.fixture.js";

useDisposableDurability();

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

function demandRootPath(fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>): string {
  return path.join(
    fixture.publication.workspacePath,
    ".wakeflow-active",
    "current",
    fixture.demandId,
  );
}

function sourceFilePath(fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>): string {
  return path.join(fixture.repositoryRoot, "artifacts", "test-run", "logs", "report.txt");
}

function changePresentationLanguage(
  fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>,
): void {
  const configPath = path.join(fixture.publication.workspacePath, "wakeflow.config.json");
  const current = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  const changed = parseWakeflowConfig({
    ...current,
    presentation: { language: "zh-Hans" },
  });
  writeFileSync(configPath, renderWakeflowConfig(changed));
}

async function createTransaction(
  fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>,
) {
  const capturePlan = readyCapturePlan(
    await new ManagedEvidenceCapturePlanningService(fixture.publication.workspaceRoot).preview(
      fixture.demandId,
      fileSelection("artifacts/test-run/logs/report.txt"),
      { clock: () => EVIDENCE_CAPTURED_AT },
    ),
  );
  const transaction = createManagedEvidencePublicationTransaction({
    capturePlan,
    eventId: EVENT_ID,
    commitId: COMMIT_ID,
  });
  return Object.freeze({
    capturePlan,
    transaction,
    transactionDigest: computeManagedEvidencePublicationTransactionDigest(transaction),
  });
}

test("Application按journal、stage、Event、final和健康闭包完成发布", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const prepared = await createTransaction(fixture);
    const service = new ManagedEvidencePublicationApplicationService(
      fixture.publication.workspaceRoot,
    );
    const result = await service.apply(prepared.transaction, prepared.transactionDigest);
    const plan = deriveManagedEvidencePublicationRecordTreePlan(prepared.transaction);
    equal(result.disposition, "completed");
    equal(result.eventDisposition, "committed");
    equal(result.record.disposition, "published");
    equal(
      result.loaded.aggregate.state.managedEvidence?.[0]?.evidenceId,
      prepared.capturePlan.manifest.evidenceId,
    );
    equal(existsSync(physical(demandRootPath(fixture), plan.destinationRootPath)), true);
    equal(
      existsSync(physical(demandRootPath(fixture), MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF)),
      false,
    );
    const alreadySettled = await service.recover(fixture.demandId);
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
    await materializeManagedEvidencePublicationStage(sourceRoot, demandRoot, prepared.transaction);
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
        error instanceof ManagedEvidencePublicationTransactionSettlementError &&
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
    ).recover(fixture.demandId);
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
    await materializeManagedEvidencePublicationStage(sourceRoot, demandRoot, prepared.transaction);
    await executeDemandEventSourcingCommand(
      new DemandEventSourcingRepository(demandRoot),
      deriveManagedEvidencePublicationEventSourcingCommand(prepared.transaction),
      {
        commitId: prepared.transaction.demandEventSourcingAppend.commitId,
        expectedStreamRevision:
          prepared.transaction.demandEventSourcingAppend.expectedStreamRevision,
      },
    );
    ledgerRoot = await RootedDirectory.open(
      path.join(fixture.publication.fixtureRoot, "wakeflow-ledger"),
    );
    await rejects(
      retireStaleManagedEvidencePublicationTransaction(demandRoot, ledgerRoot, stored, undefined),
      (error: unknown) =>
        error instanceof ManagedEvidencePublicationTransactionSettlementError &&
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
    ).recover(fixture.demandId);
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
    await createManagedEvidencePublicationTransactionJournal(demandRoot, prepared.transaction);
    const plan = deriveManagedEvidencePublicationRecordTreePlan(prepared.transaction);
    mkdirSync(physical(rootPath, MANAGED_EVIDENCE_ROOT_REF), { mode: 0o700 });
    mkdirSync(physical(rootPath, plan.candidateRootPath), { mode: 0o700 });
    await executeDemandEventSourcingCommand(
      new DemandEventSourcingRepository(demandRoot),
      {
        commandType: "lifecycle.cancel-demand",
        commandVersion: 1,
        demandId: fixture.demandId,
        eventId: CANCELLATION_EVENT_ID,
        recordedAt: parseUtcInstant("2026-09-01T21:01:00.000Z"),
        reason: "测试Event前乐观并发冲突恢复",
      },
      {
        commitId: CANCELLATION_COMMIT_ID,
        expectedStreamRevision:
          prepared.transaction.demandEventSourcingAppend.expectedStreamRevision,
      },
    );
    await demandRoot.close();
    demandRoot = undefined;

    const recovered = await new ManagedEvidencePublicationApplicationService(
      fixture.publication.workspaceRoot,
    ).recover(fixture.demandId);
    equal(recovered.disposition, "retired-stale");
    if (recovered.disposition !== "retired-stale") {
      throw new Error("Expected stale retirement.");
    }
    equal(recovered.candidateRetirement.disposition, "retired");
    equal(recovered.loaded.aggregate.state.lifecycle, "cancelled");
    equal(existsSync(physical(rootPath, plan.candidateRootPath)), false);
    equal(existsSync(physical(rootPath, MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF)), false);
  } finally {
    if (demandRoot !== undefined) await demandRoot.close();
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("过期清退沿用“候选树已经不在”之前先落盘：上一次清退死在删候选根之后、同步之前，recover 先同步 managed-evidence 再删事务文件（1.4.1 段 1b）", async (t) => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  let demandRoot: RootedDirectory | undefined;
  try {
    const prepared = await createTransaction(fixture);
    const rootPath = demandRootPath(fixture);
    demandRoot = await RootedDirectory.open(rootPath);
    await createManagedEvidencePublicationTransactionJournal(demandRoot, prepared.transaction);
    const plan = deriveManagedEvidencePublicationRecordTreePlan(prepared.transaction);
    mkdirSync(physical(rootPath, MANAGED_EVIDENCE_ROOT_REF), { mode: 0o700 });
    mkdirSync(physical(rootPath, plan.candidateRootPath), { mode: 0o700 });
    await executeDemandEventSourcingCommand(
      new DemandEventSourcingRepository(demandRoot),
      {
        commandType: "lifecycle.cancel-demand",
        commandVersion: 1,
        demandId: fixture.demandId,
        eventId: CANCELLATION_EVENT_ID,
        recordedAt: parseUtcInstant("2026-09-01T21:01:00.000Z"),
        reason: "测试过期清退的同步顺序",
      },
      {
        commitId: CANCELLATION_COMMIT_ID,
        expectedStreamRevision:
          prepared.transaction.demandEventSourcingAppend.expectedStreamRevision,
      },
    );
    await demandRoot.close();
    demandRoot = undefined;

    const canonicalRoot = path.join(
      fixture.publication.workspaceRoot.absolutePath,
      ".wakeflow-active",
      "current",
      fixture.demandId,
    );
    const relative = (absolute: string) =>
      path.relative(canonicalRoot, absolute).split(path.sep).join("/");
    const managedRoot = MANAGED_EVIDENCE_ROOT_REF;
    const events: string[] = [];
    let loseNextManagedRootSync = false;
    const originalRmdir = filesystemMutation.rmdir;
    t.mock.method(filesystemMutation, "rmdir", async (target: string) => {
      await originalRmdir.call(filesystemMutation, target);
      events.push(`rmdir ${relative(target)}`);
      if (relative(target) === plan.candidateRootPath) loseNextManagedRootSync = true;
    });
    const originalUnlink = filesystemMutation.unlink;
    t.mock.method(filesystemMutation, "unlink", async (target: string) => {
      await originalUnlink.call(filesystemMutation, target);
      events.push(`unlink ${relative(target)}`);
    });
    const originalSync = RootedResourceParentHandle.prototype.sync;
    t.mock.method(
      RootedResourceParentHandle.prototype,
      "sync",
      async function observedSync(this: RootedResourceParentHandle) {
        const directory = relative(path.dirname(this.resourceAbsolutePath));
        if (loseNextManagedRootSync && directory === managedRoot) {
          loseNextManagedRootSync = false;
          events.push(`sync-lost ${directory}`);
          throw Object.assign(new Error("injected parent sync loss"), { code: "EIO" });
        }
        events.push(`sync ${directory}`);
        return originalSync.call(this);
      },
    );

    const service = new ManagedEvidencePublicationApplicationService(
      fixture.publication.workspaceRoot,
    );
    // 注入的是同步"没有发生"：这一次 recover 以失败结束，留下的盘面与进程恰在这里被杀相同。
    await rejects(service.recover(fixture.demandId));
    equal(events.includes(`sync-lost ${managedRoot}`), true, events.join(" | "));
    equal(existsSync(physical(rootPath, plan.candidateRootPath)), false, "候选根已经删掉");
    equal(
      existsSync(physical(rootPath, MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF)),
      true,
      "事务文件必须留给下一次 recover",
    );

    const start = events.length;
    const recovered = await service.recover(fixture.demandId);
    equal(recovered.disposition, "retired-stale");
    const after = events.slice(start);
    const settled = after.indexOf(`sync ${managedRoot}`);
    const retired = after.indexOf(`unlink ${MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF}`);
    equal(
      settled >= 0 && retired > settled,
      true,
      `recover 删事务文件之前没有同步 ${managedRoot}：${after.join(" | ")}`,
    );
  } finally {
    if (demandRoot !== undefined) await demandRoot.close();
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("final 同步失败：apply 以 recovery-required 失败、final 可见、journal 保留；recover 补同步后以 current 完成（open-items W11）", async (t) => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const prepared = await createTransaction(fixture);
    const plan = deriveManagedEvidencePublicationRecordTreePlan(prepared.transaction);
    const canonicalDemandRoot = path.join(
      fixture.publication.workspaceRoot.absolutePath,
      ".wakeflow-active",
      "current",
      fixture.demandId,
    );
    const finalPath = physical(canonicalDemandRoot, plan.destinationRootPath);
    const managedRootPath = physical(canonicalDemandRoot, MANAGED_EVIDENCE_ROOT_REF);
    const journalPath = physical(canonicalDemandRoot, MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF);
    const originalSync = RootedResourceParentHandle.prototype.sync;
    let finalParentSyncs = 0;
    let injected = false;
    t.mock.method(
      RootedResourceParentHandle.prototype,
      "sync",
      async function (this: RootedResourceParentHandle, ...args: Parameters<typeof originalSync>) {
        if (this.parentAbsolutePath === managedRootPath && existsSync(finalPath)) {
          finalParentSyncs += 1;
          if (!injected) {
            injected = true;
            throw new RootedResourceParentHandleError("sync-failure", "$test");
          }
        }
        return originalSync.apply(this, args);
      },
    );
    const service = new ManagedEvidencePublicationApplicationService(
      fixture.publication.workspaceRoot,
    );
    await rejects(
      service.apply(prepared.transaction, prepared.transactionDigest),
      (error: unknown) =>
        error instanceof ManagedEvidencePublicationApplicationServiceError &&
        error.reason === "recovery-required",
    );
    equal(injected, true);
    equal(existsSync(finalPath), true);
    equal(existsSync(journalPath), true, "the journal stays for recovery");
    const syncsBefore = finalParentSyncs;
    const recovered = await service.recover(fixture.demandId);
    equal(recovered.disposition, "completed");
    if (recovered.disposition !== "completed") {
      throw new Error("Expected completed recovery.");
    }
    equal(recovered.eventDisposition, "existing");
    equal(recovered.record.disposition, "current");
    equal(finalParentSyncs > syncsBefore, true, "recovery synchronizes the visible final");
    equal(existsSync(journalPath), false);
    equal(recovered.loaded.aggregate.state.managedEvidence?.length, 1);
  } finally {
    t.mock.restoreAll();
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});
