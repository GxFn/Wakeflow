import { deepEqual, equal, rejects } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { parseWakeflowDurableIdOfKind } from "../../../../src/contracts/identity/wakeflow-durable-id.js";
import {
  type FileNodeSnapshot,
  sameFileNodeIdentity,
} from "../../../../src/foundation/filesystem/file-node-snapshot.js";
import type { PortableResourcePath } from "../../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../../src/foundation/time/utc-instant.js";
import { parseDemandEventStreamCommitDocument } from "../../../../src/governance/demand/event-sourcing/demand-event-stream-commit.js";
import {
  createDemandAuthority,
  renderDemandAuthority,
} from "../../../../src/governance/demand/model/demand-authority.js";
import {
  createDemandIdentity,
  renderDemandIdentity,
} from "../../../../src/governance/demand/model/demand-identity.js";
import { DemandEventSourcingPublicationServiceError } from "../../../../src/governance/demand/publication/demand-event-sourcing-publication-contract.js";
import {
  loadFinalDemandPublication,
  materializeDemandPublicationStage,
  publishDemandStage,
} from "../../../../src/governance/demand/publication/demand-event-sourcing-publication-stage.js";
import {
  initializePublicationStorage,
  publicationNodeOrNull,
  retirePublicationFile,
} from "../../../../src/governance/demand/publication/demand-event-sourcing-publication-storage.js";
import {
  createDemandEventSourcingPublicationTransaction,
  renderDemandEventSourcingPublicationTransaction,
} from "../../../../src/governance/demand/publication/demand-event-sourcing-publication-transaction.js";
import {
  DEMAND_PUBLICATION_STAGES_ROOT_REF,
  demandFinalPublicationMarkerRef,
} from "../../../../src/governance/demand/publication/demand-publication-paths.js";
import {
  createLedgerAuthorityMemberReference,
  LedgerAuthorityStore,
} from "../../../../src/governance/ledger/ledger-authority-store.js";
import { materializeActiveLayout } from "../../../../src/kernel/active-projection.js";
import { useDisposableDurability } from "../../../support/disposable-durability.js";
import { DISPOSABLE_ROOT_OPTIONS } from "../../../support/prepared-workspace.js";
import { disposableRoot } from "../../../support/temp-root.js";
import { publishFixtureRequirement } from "../../ledger/requirement-package.fixture.js";
import { placePendingClaimState, requirementLineageOf } from "../requirement-board.fixture.js";

useDisposableDurability();

/**
 * 直接覆盖暂存构建、整体重命名与最终加载；工作区、Ledger 与需求包按
 * publication-service 测试的同一夹具链建立。
 */

const PROGRAM_ID = parseWakeflowDurableIdOfKind(
  "program_11111111-1111-4111-8111-111111111111",
  "program",
);
const DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_22222222-2222-4222-8222-222222222222",
  "demand",
);
const EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_44444444-4444-4444-8444-444444444444",
  "demand-event",
);
const COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_77777777-7777-4777-8777-777777777777",
  "demand-event-commit",
);
const CREATED_AT = parseUtcInstant("2026-08-26T10:00:00.000Z");
const COMMIT_FILE = "0000000000000001.json";

async function publicationFixture(t: TestContext, prefix: string) {
  const fixtureRoot = disposableRoot(t, prefix);
  const workspacePath = path.join(fixtureRoot, "workspace");
  const ledgerPath = path.join(fixtureRoot, "ledger");
  mkdirSync(workspacePath, { mode: 0o700 });
  mkdirSync(ledgerPath, { mode: 0o700 });
  const workspaceRoot = await RootedDirectory.open(workspacePath, "$root", DISPOSABLE_ROOT_OPTIONS);
  t.after(() => workspaceRoot.close());
  const ledgerRoot = await RootedDirectory.open(ledgerPath, "$root", DISPOSABLE_ROOT_OPTIONS);
  t.after(() => ledgerRoot.close());
  await materializeActiveLayout(workspaceRoot, { recovering: false });
  const ledgerStore = new LedgerAuthorityStore(ledgerRoot);
  await ledgerStore.initialize({ freshLedger: true });
  const loaded = await publishFixtureRequirement(ledgerStore);
  const claim = await placePendingClaimState(workspaceRoot, loaded);
  const identity = createDemandIdentity(
    {
      programId: PROGRAM_ID,
      demandId: DEMAND_ID,
      title: "Demand publication stage",
      goal: "在暂存目录内建立 revision 1 根",
      completionDefinition: "暂存、重命名与最终加载闭合",
      demandType: "requirement",
      source: requirementLineageOf(loaded),
      podId: "pod_99999999-9999-4999-8999-999999999999",
    },
    { clock: () => CREATED_AT },
  );
  const authority = createDemandAuthority(identity, {
    authorityRefs: loaded.documents.map((document) =>
      createLedgerAuthorityMemberReference(loaded, document.path),
    ),
    testingDecision: { mode: "controller-only", summary: "聚焦测试", environmentMemberRef: null },
  });
  const transaction = createDemandEventSourcingPublicationTransaction({
    identity,
    authority,
    eventId: EVENT_ID,
    commitId: COMMIT_ID,
    recordedAt: CREATED_AT,
    expectedClaimStateDigest: claim.digest,
  });
  await initializePublicationStorage(workspaceRoot, undefined);
  const physical = (ref: PortableResourcePath): string =>
    path.join(workspacePath, ...ref.split("/"));
  return {
    workspaceRoot,
    ledgerStore,
    transaction,
    physical,
    stagePath: physical(transaction.stageRef),
    finalPath: physical(transaction.finalRootRef),
  };
}

function modeOf(file: string): number {
  return statSync(file).mode & 0o777;
}

async function nodeOf(
  root: RootedDirectory,
  ref: PortableResourcePath,
): Promise<Readonly<FileNodeSnapshot>> {
  const node = await publicationNodeOrNull(root, ref);
  if (node === null) throw new Error(`Expected a node at ${ref}.`);
  return node;
}

function abortedSignal(): AbortSignal {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}

function isServiceError(
  reason: DemandEventSourcingPublicationServiceError["reason"],
  errorPath?: string,
) {
  return (error: unknown): boolean =>
    error instanceof DemandEventSourcingPublicationServiceError &&
    error.reason === reason &&
    (errorPath === undefined || error.path === errorPath);
}

test("materializeDemandPublicationStage 补齐半写暂存并建立完整 revision 1 Demand 根", async (t) => {
  const { workspaceRoot, transaction, stagePath } = await publicationFixture(
    t,
    "wakeflow-stage-materialize-",
  );
  // 半写暂存：目录与身份文件已经存在，其余资源缺失。
  mkdirSync(stagePath, { mode: 0o700 });
  writeFileSync(path.join(stagePath, "identity.json"), renderDemandIdentity(transaction.identity), {
    mode: 0o600,
  });

  await materializeDemandPublicationStage(workspaceRoot, transaction, undefined);
  equal(modeOf(stagePath), 0o700);
  for (const relative of [
    "artifacts",
    "artifacts/task-packages",
    "transactions",
    "event-sourcing/append-candidates",
  ]) {
    const directory = path.join(stagePath, ...relative.split("/"));
    equal(statSync(directory).isDirectory(), true, relative);
    equal(modeOf(directory), 0o700, relative);
  }
  for (const relative of [
    "identity.json",
    "authority.json",
    "transactions/publication.json",
    `event-sourcing/commits/${COMMIT_FILE}`,
    `event-sourcing/snapshots/${COMMIT_FILE}`,
  ]) {
    equal(modeOf(path.join(stagePath, ...relative.split("/"))), 0o600, relative);
  }
  equal(
    readFileSync(path.join(stagePath, "identity.json"), "utf8"),
    renderDemandIdentity(transaction.identity),
  );
  equal(
    readFileSync(path.join(stagePath, "authority.json"), "utf8"),
    renderDemandAuthority(transaction.authority),
  );
  equal(
    readFileSync(path.join(stagePath, "transactions", "publication.json"), "utf8"),
    renderDemandEventSourcingPublicationTransaction(transaction),
  );
  const commitsPath = path.join(stagePath, "event-sourcing", "commits");
  deepEqual(
    parseDemandEventStreamCommitDocument(readFileSync(path.join(commitsPath, COMMIT_FILE), "utf8")),
    transaction.initialCommit,
  );

  // 对完整暂存重跑是精确幂等的：不追加第二个提交，也不改写任何文件。
  await materializeDemandPublicationStage(workspaceRoot, transaction, undefined);
  deepEqual(readdirSync(commitsPath), [COMMIT_FILE]);
  deepEqual(readdirSync(path.join(stagePath, "event-sourcing", "append-candidates")), []);
});

test("materializeDemandPublicationStage 拒绝不私有、与计划不一致或树形不合法的暂存", async (t) => {
  const { workspaceRoot, transaction, stagePath, physical } = await publicationFixture(
    t,
    "wakeflow-stage-conflict-",
  );
  await rejects(
    materializeDemandPublicationStage(workspaceRoot, transaction, abortedSignal()),
    isServiceError("aborted", "$signal"),
  );
  equal(existsSync(stagePath), false);

  mkdirSync(stagePath, { mode: 0o755 });
  await rejects(
    materializeDemandPublicationStage(workspaceRoot, transaction, undefined),
    isServiceError("conflict", "$demandRoot"),
  );
  chmodSync(stagePath, 0o700);

  const identityPath = path.join(stagePath, "identity.json");
  writeFileSync(identityPath, '{\n  "drift": true\n}\n', { mode: 0o600 });
  await rejects(
    materializeDemandPublicationStage(workspaceRoot, transaction, undefined),
    isServiceError("conflict", "$write"),
  );
  equal(readFileSync(identityPath, "utf8"), '{\n  "drift": true\n}\n');
  rmSync(identityPath);

  // 暂存里多出一个外来投影：提交与快照都已写入，但发布期清单检查拒绝整棵暂存。
  const projections = path.join(stagePath, "artifacts", "task-packages");
  mkdirSync(projections, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(projections, "foreign.json"), "{}\n", { mode: 0o600 });
  await rejects(
    materializeDemandPublicationStage(workspaceRoot, transaction, undefined),
    isServiceError("conflict", "$stage"),
  );
  deepEqual(readdirSync(path.join(stagePath, "event-sourcing", "commits")), [COMMIT_FILE]);

  const stagesRoot = physical(DEMAND_PUBLICATION_STAGES_ROOT_REF);
  rmSync(stagesRoot, { recursive: true });
  writeFileSync(stagesRoot, "", { mode: 0o600 });
  await rejects(
    materializeDemandPublicationStage(workspaceRoot, transaction, undefined),
    isServiceError("operation-failure", "$stage/directories"),
  );
});

test("publishDemandStage 把私有暂存整体重命名为最终 Demand 根", async (t) => {
  const { workspaceRoot, transaction, stagePath, finalPath } = await publicationFixture(
    t,
    "wakeflow-stage-publish-",
  );
  const conflict = isServiceError("conflict", "$stage");
  await rejects(publishDemandStage(workspaceRoot, transaction, undefined), conflict);
  await materializeDemandPublicationStage(workspaceRoot, transaction, undefined);
  await rejects(
    publishDemandStage(workspaceRoot, transaction, abortedSignal()),
    isServiceError("aborted", "$signal"),
  );
  chmodSync(stagePath, 0o755);
  await rejects(publishDemandStage(workspaceRoot, transaction, undefined), conflict);
  chmodSync(stagePath, 0o700);
  equal(existsSync(finalPath), false);

  const stageNode = await nodeOf(workspaceRoot, transaction.stageRef);
  await publishDemandStage(workspaceRoot, transaction, undefined);
  equal(existsSync(stagePath), false);
  const finalNode = await nodeOf(workspaceRoot, transaction.finalRootRef);
  equal(sameFileNodeIdentity(stageNode, finalNode), true);
  equal(finalNode.permissionBits, 0o700);
  equal(existsSync(path.join(finalPath, "transactions", "publication.json")), true);
  equal(existsSync(path.join(finalPath, "event-sourcing", "commits", COMMIT_FILE)), true);

  // 最终根已存在时，重新出现的暂存不能覆盖它。
  mkdirSync(stagePath, { mode: 0o700 });
  await rejects(publishDemandStage(workspaceRoot, transaction, undefined), conflict);
  equal(existsSync(stagePath), true);
  equal(
    sameFileNodeIdentity(await nodeOf(workspaceRoot, transaction.finalRootRef), finalNode),
    true,
  );
});

test("loadFinalDemandPublication 只接受标记已退休且摘要与计划闭合的最终根", async (t) => {
  const { workspaceRoot, ledgerStore, transaction, finalPath } = await publicationFixture(
    t,
    "wakeflow-stage-load-",
  );
  const conflict = isServiceError("conflict", "$demandRoot");
  await rejects(
    loadFinalDemandPublication(workspaceRoot, ledgerStore, transaction, undefined),
    conflict,
  );
  await materializeDemandPublicationStage(workspaceRoot, transaction, undefined);
  await publishDemandStage(workspaceRoot, transaction, undefined);
  // 发布标记仍在 transactions/ 里：正常权威加载的清单阶段拒绝该根。
  await rejects(
    loadFinalDemandPublication(workspaceRoot, ledgerStore, transaction, undefined),
    conflict,
  );

  const markerRef = demandFinalPublicationMarkerRef(DEMAND_ID);
  await retirePublicationFile(
    workspaceRoot,
    transaction,
    markerRef,
    await nodeOf(workspaceRoot, markerRef),
    undefined,
  );
  equal(existsSync(path.join(finalPath, "transactions", "publication.json")), false);
  await rejects(
    loadFinalDemandPublication(workspaceRoot, ledgerStore, transaction, abortedSignal()),
    isServiceError("aborted", "$signal"),
  );

  const loaded = await loadFinalDemandPublication(
    workspaceRoot,
    ledgerStore,
    transaction,
    undefined,
  );
  equal(loaded.identityDigest, transaction.identityDigest);
  equal(loaded.authorityDigest, transaction.authorityDigest);
  deepEqual(loaded.identity, transaction.identity);
  deepEqual(loaded.authority, transaction.authority);
  deepEqual(loaded.firstCommit, transaction.initialCommit);
  equal(loaded.aggregate.streamRevision, 1);
  equal(loaded.inventory.commitCount, 1);

  await rejects(
    loadFinalDemandPublication(
      workspaceRoot,
      ledgerStore,
      { ...transaction, identityDigest: transaction.authorityDigest },
      undefined,
    ),
    conflict,
  );
  await rejects(
    loadFinalDemandPublication(
      workspaceRoot,
      ledgerStore,
      { ...transaction, initialCommitDigest: transaction.identityDigest },
      undefined,
    ),
    conflict,
  );
  chmodSync(finalPath, 0o755);
  await rejects(
    loadFinalDemandPublication(workspaceRoot, ledgerStore, transaction, undefined),
    conflict,
  );
});
