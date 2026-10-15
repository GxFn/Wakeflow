import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { parseWakeflowDurableIdOfKind } from "../../../../src/contracts/identity/wakeflow-durable-id.js";
import {
  computeSha256Digest,
  parseSha256Digest,
} from "../../../../src/foundation/crypto/sha256.js";
import {
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "../../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import { createFileCandidateDurably } from "../../../../src/foundation/filesystem/durable-file-candidate.js";
import {
  type FileNodeSnapshot,
  sameFileNodeIdentity,
} from "../../../../src/foundation/filesystem/file-node-snapshot.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../../src/foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../../../src/foundation/text/utf8.js";
import { parseUtcInstant } from "../../../../src/foundation/time/utc-instant.js";
import { DEMAND_EVENT_SOURCING_IDENTITY_REF } from "../../../../src/governance/demand/event-sourcing/demand-event-sourcing-paths.js";
import { createDemandAuthority } from "../../../../src/governance/demand/model/demand-authority.js";
import { createDemandIdentity } from "../../../../src/governance/demand/model/demand-identity.js";
import { parseRequirementLineageReference } from "../../../../src/governance/demand/model/requirement-lineage.js";
import { DemandEventSourcingPublicationServiceError } from "../../../../src/governance/demand/publication/demand-event-sourcing-publication-contract.js";
import {
  admitDemandPublicationResourceOperation,
  assertPrivatePublicationNode,
  ensureExactPublicationTextFile,
  ensurePublicationTransaction,
  initializePublicationStorage,
  openDemandPublicationRoot,
  publicationNodeOrNull,
  readPublicationTransactionAt,
  recoverPublicationTransactionStages,
  retirePublicationFile,
  samePublicationTransaction,
} from "../../../../src/governance/demand/publication/demand-event-sourcing-publication-storage.js";
import {
  createDemandEventSourcingPublicationTransaction,
  renderDemandEventSourcingPublicationTransaction,
} from "../../../../src/governance/demand/publication/demand-event-sourcing-publication-transaction.js";
import {
  DEMAND_PUBLICATION_LOCKS_ROOT_REF,
  DEMAND_PUBLICATION_MARKER_REF,
  DEMAND_PUBLICATION_ROOT_REF,
  DEMAND_PUBLICATION_STAGES_ROOT_REF,
  DEMAND_PUBLICATION_TRANSACTIONS_ROOT_REF,
  demandFinalRootRef,
  demandPublicationTransactionRef,
} from "../../../../src/governance/demand/publication/demand-publication-paths.js";
import { parseLedgerAuthorityMemberReference } from "../../../../src/governance/ledger/ledger-authority-store.js";
import { materializeActiveLayout } from "../../../../src/kernel/active-projection.js";
import { durableAtomicFileStageRefForTest } from "../../../foundation/filesystem/durable-atomic-file-test-support.js";
import { DISPOSABLE_ROOT_OPTIONS } from "../../../support/prepared-workspace.js";
import { disposableRoot } from "../../../support/temp-root.js";
import { writeTextFile } from "../../../support/write-tree.js";

/** 直接覆盖发布存储边界；事务按 publication-transaction 测试的离线形状构造，不需要 Ledger。 */

const PROGRAM_ID = parseWakeflowDurableIdOfKind(
  "program_11111111-1111-4111-8111-111111111111",
  "program",
);
const DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_22222222-2222-4222-8222-222222222222",
  "demand",
);
const OTHER_DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_88888888-8888-4888-8888-888888888888",
  "demand",
);
const REQUIREMENT_ID = parseWakeflowDurableIdOfKind(
  "requirement_33333333-3333-4333-8333-333333333333",
  "requirement",
);
const EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_44444444-4444-4444-8444-444444444444",
  "demand-event",
);
const COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_55555555-5555-4555-8555-555555555555",
  "demand-event-commit",
);
const CREATED_AT = parseUtcInstant("2026-08-26T10:00:00.000Z");
const DIGEST = parseSha256Digest(`sha256:${"a".repeat(64)}`);
const STATE_DIGEST = parseSha256Digest(`sha256:${"c".repeat(64)}`);
const SIDECAR_REF = demandPublicationTransactionRef(DEMAND_ID);
const IDENTITY_REF = parsePortableResourcePath(
  `${demandFinalRootRef(DEMAND_ID)}/${DEMAND_EVENT_SOURCING_IDENTITY_REF}`,
);
const JSON_TEXT = '{\n  "value": 1\n}\n';

// 被测导出的短别名；导入语句保留完整名称。
const admitOperation = admitDemandPublicationResourceOperation;
const assertPrivateNode = assertPrivatePublicationNode;
const ensureExactText = ensureExactPublicationTextFile;
const ensureTransaction = ensurePublicationTransaction;
const initializeStorage = initializePublicationStorage;
const openRoot = openDemandPublicationRoot;
const readTransactionAt = readPublicationTransactionAt;
const recoverStages = recoverPublicationTransactionStages;
const retireFile = retirePublicationFile;
const render = renderDemandEventSourcingPublicationTransaction;

function authorityReference(role: "requirement" | "landing", memberPath: string) {
  return parseLedgerAuthorityMemberReference({
    artifactKind: "wakeflow-ledger-authority-member-reference",
    schemaVersion: 1,
    family: "requirement",
    recordId: REQUIREMENT_ID,
    recordRef: `requirements/${REQUIREMENT_ID}/record.json`,
    recordDigest: DIGEST,
    memberPath,
    memberRef: `requirements/${REQUIREMENT_ID}/${memberPath}`,
    memberDigest: DIGEST,
    role,
    mediaType: "text/markdown",
  });
}

/** `title` 影响渲染文本长度，用来制造字节数不同的第二份计划。 */
function transactionFixture(title = "Demand publication") {
  const identity = createDemandIdentity(
    {
      programId: PROGRAM_ID,
      demandId: DEMAND_ID,
      title,
      goal: "发布标准 Event Sourcing root",
      completionDefinition: "看板认领与 revision 1 闭合",
      demandType: "requirement",
      source: parseRequirementLineageReference({
        artifactKind: "wakeflow-requirement-lineage",
        schemaVersion: 1,
        requirementId: REQUIREMENT_ID,
        recordRef: `requirements/${REQUIREMENT_ID}/record.json`,
        recordDigest: DIGEST,
      }),
      podId: "pod_99999999-9999-4999-8999-999999999999",
    },
    { clock: () => CREATED_AT },
  );
  const authority = createDemandAuthority(identity, {
    authorityRefs: [
      authorityReference("requirement", "requirement.md"),
      authorityReference("landing", "landing.md"),
    ],
    testingDecision: {
      mode: "controller-only",
      summary: "运行聚焦 TypeScript 测试",
      environmentMemberRef: null,
    },
  });
  return createDemandEventSourcingPublicationTransaction({
    identity,
    authority,
    eventId: EVENT_ID,
    commitId: COMMIT_ID,
    recordedAt: CREATED_AT,
    expectedClaimStateDigest: STATE_DIGEST,
  });
}

async function openWorkspace(t: TestContext, prefix: string, layout = true) {
  const workspacePath = disposableRoot(t, prefix);
  const root = await RootedDirectory.open(workspacePath, "$root", DISPOSABLE_ROOT_OPTIONS);
  t.after(() => root.close());
  if (layout) await materializeActiveLayout(root, { recovering: false });
  const physical = (ref: PortableResourcePath): string =>
    path.join(workspacePath, ...ref.split("/"));
  return { workspacePath, root, physical };
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

const aborted = isServiceError("aborted", "$signal");
const catalogFailure = isServiceError("operation-failure", "$catalog");

test("admitDemandPublicationResourceOperation 只准入目录登记资源声明的方案", () => {
  const transaction = transactionFixture();
  const markerRef = parsePortableResourcePath(
    `${transaction.finalRootRef}/${DEMAND_PUBLICATION_MARKER_REF}`,
  );
  admitOperation(transaction, SIDECAR_REF, "exclusive-create");
  admitOperation(transaction, SIDECAR_REF, "exact-retire");
  admitOperation(transaction, transaction.finalRootRef, "exact-directory-publish");
  admitOperation(transaction, IDENTITY_REF, "exclusive-create");
  admitOperation(transaction, markerRef, "exact-retire");
  throws(() => admitOperation(transaction, IDENTITY_REF, "exact-retire"), catalogFailure);
  throws(() => admitOperation(transaction, markerRef, "exclusive-create"), catalogFailure);
  throws(
    () => admitOperation(transaction, transaction.finalRootRef, "materialize-directory"),
    catalogFailure,
  );
  // 暂存目录与 Demand 根内相对的标记引用都不是 Workspace 目录里的长期资源。
  throws(
    () => admitOperation(transaction, transaction.stageRef, "exact-directory-publish"),
    catalogFailure,
  );
  throws(
    () => admitOperation(transaction, DEMAND_PUBLICATION_MARKER_REF, "exact-retire"),
    catalogFailure,
  );
});

test("publicationNodeOrNull 与 assertPrivatePublicationNode 观察并判定私有节点", async (t) => {
  const { workspacePath, root } = await openWorkspace(t, "wakeflow-publication-node-", false);
  const fileRef = parsePortableResourcePath("private.json");
  const directoryRef = parsePortableResourcePath("nested");
  equal(await publicationNodeOrNull(root, fileRef), null);
  const file = writeTextFile(workspacePath, "private.json", "{}\n", 0o600);
  mkdirSync(path.join(workspacePath, "nested"), { mode: 0o700 });
  const fileConflict = isServiceError("conflict", "$file");
  const directoryConflict = isServiceError("conflict", "$directory");

  const node = await nodeOf(root, fileRef);
  equal(node.kind, "file");
  equal(node.permissionBits, 0o600);
  assertPrivateNode(node, "file", "$file");
  throws(() => assertPrivateNode(node, "directory", "$file"), fileConflict);
  const directory = await nodeOf(root, directoryRef);
  assertPrivateNode(directory, "directory", "$directory");
  throws(() => assertPrivateNode(directory, "file", "$directory"), directoryConflict);

  chmodSync(path.join(workspacePath, "nested"), 0o755);
  const relaxedDirectory = await nodeOf(root, directoryRef);
  throws(() => assertPrivateNode(relaxedDirectory, "directory", "$directory"), directoryConflict);
  chmodSync(file, 0o644);
  const relaxed = await nodeOf(root, fileRef);
  throws(() => assertPrivateNode(relaxed, "file", "$file"), fileConflict);
  chmodSync(file, 0o600);
  linkSync(file, path.join(workspacePath, "alias.json"));
  const linked = await nodeOf(root, fileRef);
  equal(linked.linkCount, 2n);
  throws(() => assertPrivateNode(linked, "file", "$file"), fileConflict);
  assertPrivateNode(linked, "file", "$file", [1n, 2n]);
  const nested = parsePortableResourcePath("private.json/child");
  await rejects(publicationNodeOrNull(root, nested), isServiceError("root-scope", "$root"));
});

test("ensureExactPublicationTextFile 独占创建私有文本并以精确文本幂等", async (t) => {
  const { workspacePath, root } = await openWorkspace(t, "wakeflow-publication-exact-", false);
  mkdirSync(path.join(workspacePath, "facts"), { mode: 0o700 });
  const ref = parsePortableResourcePath("facts/record.json");
  const factsFile = (name: string) => path.join(workspacePath, "facts", name);
  const file = factsFile("record.json");
  const writeConflict = isServiceError("conflict", "$write");

  const created = await ensureExactText(root, ref, JSON_TEXT, 1024, undefined);
  equal(created.text, JSON_TEXT);
  equal(JSON.stringify(created.value), '{"value":1}');
  equal(created.node.permissionBits, 0o600);
  equal(statSync(file).mode & 0o777, 0o600);
  const again = await ensureExactText(root, ref, JSON_TEXT, 1024, undefined);
  equal(again.node.inodeId, created.node.inodeId);
  equal(again.digest, created.digest);

  await rejects(ensureExactText(root, ref, '{\n  "value": 2\n}\n', 1024, undefined), writeConflict);
  equal(readFileSync(file, "utf8"), JSON_TEXT);
  const bigRef = parsePortableResourcePath("facts/big.json");
  await rejects(
    ensureExactText(root, bigRef, JSON_TEXT, 4, undefined),
    isServiceError("capacity", "$write"),
  );
  equal(existsSync(factsFile("big.json")), false);
  chmodSync(file, 0o644);
  await rejects(ensureExactText(root, ref, JSON_TEXT, 1024, undefined), writeConflict);
  chmodSync(file, 0o600);
  const orphanRef = parsePortableResourcePath("missing/record.json");
  await rejects(
    ensureExactText(root, orphanRef, JSON_TEXT, 1024, undefined),
    isServiceError("operation-failure", "$write"),
  );
  // 非确定性 JSON 文本能创建成功，但回读表示检查失败：文件留下，调用按 conflict 失败。
  const plainRef = parsePortableResourcePath("facts/plain.txt");
  await rejects(ensureExactText(root, plainRef, "plain\n", 1024, undefined), writeConflict);
  equal(existsSync(factsFile("plain.txt")), true);
  const abortedRef = parsePortableResourcePath("facts/aborted.json");
  await rejects(ensureExactText(root, abortedRef, JSON_TEXT, 1024, abortedSignal()), aborted);
  equal(existsSync(factsFile("aborted.json")), false);
});

test("ensurePublicationTransaction 按目录准入写入并回读与计划一致的事务", async (t) => {
  const { workspacePath, root, physical } = await openWorkspace(
    t,
    "wakeflow-publication-transaction-",
  );
  await initializeStorage(root, undefined);
  const transaction = transactionFixture();
  const text = render(transaction);

  const stored = await ensureTransaction(root, SIDECAR_REF, transaction, undefined);
  deepEqual(stored.transaction, transaction);
  equal(stored.source.resourcePath, SIDECAR_REF);
  equal(stored.source.text, text);
  equal(statSync(physical(SIDECAR_REF)).mode & 0o777, 0o600);
  const again = await ensureTransaction(root, SIDECAR_REF, transaction, undefined);
  equal(again.source.node.inodeId, stored.source.node.inodeId);
  const read = await readTransactionAt(root, SIDECAR_REF, stored.source.node, undefined);
  deepEqual(read.transaction, transaction);
  equal(read.source.digest, stored.source.digest);
  equal(samePublicationTransaction(read.transaction, transaction), true);

  const other = transactionFixture("Demand publication with a longer title");
  equal(samePublicationTransaction(other, transaction), false);
  await rejects(
    ensureTransaction(root, SIDECAR_REF, other, undefined),
    isServiceError("conflict", "$write"),
  );
  equal(readFileSync(physical(SIDECAR_REF), "utf8"), text);
  const strayRef = parsePortableResourcePath("stray.json");
  await rejects(ensureTransaction(root, strayRef, transaction, undefined), catalogFailure);
  equal(existsSync(path.join(workspacePath, "stray.json")), false);
  // Demand 根内相对的标记引用跳过 Workspace 目录准入。
  mkdirSync(path.join(workspacePath, "transactions"), { mode: 0o700 });
  const marker = await ensureTransaction(
    root,
    DEMAND_PUBLICATION_MARKER_REF,
    transaction,
    undefined,
  );
  deepEqual(marker.transaction, transaction);
  equal(statSync(physical(DEMAND_PUBLICATION_MARKER_REF)).mode & 0o777, 0o600);
});

test("readPublicationTransactionAt 把节点、表示与解析失败都归为 conflict", async (t) => {
  const { workspacePath, root } = await openWorkspace(t, "wakeflow-publication-read-", false);
  const transaction = transactionFixture();
  const ref = parsePortableResourcePath("transactions/publication.json");
  const file = writeTextFile(
    workspacePath,
    "transactions/publication.json",
    render(transaction),
    0o600,
  );
  const node = await nodeOf(root, ref);
  deepEqual((await readTransactionAt(root, ref, node, undefined)).transaction, transaction);
  const conflict = isServiceError("conflict", "$transaction");

  chmodSync(file, 0o644);
  await rejects(readTransactionAt(root, ref, await nodeOf(root, ref), undefined), conflict);
  chmodSync(file, 0o600);
  // 节点快照过期：文件已被另一份字节数不同的计划替换。
  writeFileSync(file, render(transactionFixture("Replaced publication plan")));
  await rejects(readTransactionAt(root, ref, node, undefined), conflict);
  for (const text of ["{}", '{\n  "artifactKind": "other"\n}\n']) {
    writeFileSync(file, text);
    await rejects(readTransactionAt(root, ref, await nodeOf(root, ref), undefined), conflict);
  }
  await rejects(readTransactionAt(root, ref, await nodeOf(root, ref), abortedSignal()), aborted);
});

test("retirePublicationFile 只按目录准入精确退休事务文件", async (t) => {
  const { root, physical } = await openWorkspace(t, "wakeflow-publication-retire-");
  await initializeStorage(root, undefined);
  const transaction = transactionFixture();
  const stored = await ensureTransaction(root, SIDECAR_REF, transaction, undefined);
  const file = physical(SIDECAR_REF);
  const recoveryRequired = isServiceError("recovery-required", "$transaction");

  await rejects(
    retireFile(root, transaction, IDENTITY_REF, stored.source.node, undefined),
    catalogFailure,
  );
  await rejects(
    retireFile(root, transaction, SIDECAR_REF, stored.source.node, abortedSignal()),
    aborted,
  );
  writeFileSync(file, render(transactionFixture("Replaced publication plan")));
  await rejects(
    retireFile(root, transaction, SIDECAR_REF, stored.source.node, undefined),
    recoveryRequired,
  );
  equal(existsSync(file), true);
  const current = await nodeOf(root, SIDECAR_REF);
  await retireFile(root, transaction, SIDECAR_REF, current, undefined);
  equal(existsSync(file), false);
  await rejects(retireFile(root, transaction, SIDECAR_REF, current, undefined), recoveryRequired);
});

test("initializePublicationStorage 只在当前活动布局下幂等建立私有目录", async (t) => {
  const bare = await openWorkspace(t, "wakeflow-publication-init-bare-", false);
  await rejects(
    initializeStorage(bare.root, undefined),
    isServiceError("conflict", "$activeLayout"),
  );
  equal(existsSync(bare.physical(DEMAND_PUBLICATION_ROOT_REF)), false);

  const { root, physical } = await openWorkspace(t, "wakeflow-publication-init-");
  await rejects(initializeStorage(root, abortedSignal()), aborted);
  equal(existsSync(physical(DEMAND_PUBLICATION_ROOT_REF)), false);
  await initializeStorage(root, undefined);
  for (const ref of [
    DEMAND_PUBLICATION_ROOT_REF,
    DEMAND_PUBLICATION_STAGES_ROOT_REF,
    DEMAND_PUBLICATION_TRANSACTIONS_ROOT_REF,
    DEMAND_PUBLICATION_LOCKS_ROOT_REF,
  ]) {
    equal(statSync(physical(ref)).mode & 0o777, 0o700, ref);
  }
  await initializeStorage(root, undefined);
  chmodSync(physical(DEMAND_PUBLICATION_LOCKS_ROOT_REF), 0o755);
  await rejects(
    initializeStorage(root, undefined),
    isServiceError("conflict", `$${DEMAND_PUBLICATION_LOCKS_ROOT_REF}`),
  );
  chmodSync(physical(DEMAND_PUBLICATION_LOCKS_ROOT_REF), 0o700);
  rmSync(physical(DEMAND_PUBLICATION_STAGES_ROOT_REF), { recursive: true });
  writeFileSync(physical(DEMAND_PUBLICATION_STAGES_ROOT_REF), "", { mode: 0o600 });
  await rejects(
    initializeStorage(root, undefined),
    isServiceError("operation-failure", "$initialize"),
  );
});

test("recoverPublicationTransactionStages 只回滚本事务不再活动的原子暂存", async (t) => {
  const { root, physical } = await openWorkspace(t, "wakeflow-publication-stages-");
  const recoveryRequired = isServiceError("recovery-required", "$transaction/stage");
  await rejects(recoverStages(root, SIDECAR_REF, undefined), recoveryRequired);
  await initializeStorage(root, undefined);
  await recoverStages(root, SIDECAR_REF, undefined);

  const stage = async (target: PortableResourcePath, text: string) => {
    const bytes = encodeUtf8(text);
    const address = issueDurableAtomicFileStageAddress(
      "create",
      target,
      computeSha256Digest(bytes),
      0o600,
    );
    const stageRef = durableAtomicFileStageRefForTest(target, address);
    await createFileCandidateDurably(root, stageRef, bytes, { mode: 0o600 });
    return { address, stageRef };
  };
  const own = await stage(SIDECAR_REF, "partial");
  try {
    // 本进程仍持有暂存地址：活写者不得被回滚。
    await rejects(recoverStages(root, SIDECAR_REF, undefined), recoveryRequired);
    equal(existsSync(physical(own.stageRef)), true);
  } finally {
    releaseDurableAtomicFileStageAddress(own.address);
  }
  const foreign = await stage(demandPublicationTransactionRef(OTHER_DEMAND_ID), "foreign");
  releaseDurableAtomicFileStageAddress(foreign.address);
  await rejects(recoverStages(root, SIDECAR_REF, abortedSignal()), aborted);
  await recoverStages(root, SIDECAR_REF, undefined);
  equal(existsSync(physical(own.stageRef)), false);
  equal(existsSync(physical(foreign.stageRef)), true);
});

test("openDemandPublicationRoot 只打开与预期一致的私有 Demand 根并继承持久化级别", async (t) => {
  const { workspacePath, root, physical } = await openWorkspace(t, "wakeflow-publication-open-");
  const finalRef = demandFinalRootRef(DEMAND_ID);
  const otherRef = demandFinalRootRef(OTHER_DEMAND_ID);
  const conflict = isServiceError("conflict", "$demandRoot");
  await rejects(openRoot(root, finalRef), conflict);
  mkdirSync(physical(finalRef), { mode: 0o700 });
  mkdirSync(physical(otherRef), { mode: 0o700 });
  const node = await nodeOf(root, finalRef);

  const opened = await openRoot(root, finalRef, node);
  try {
    equal(opened.absolutePath, physical(finalRef));
    equal(opened.durability, "none");
    equal(sameFileNodeIdentity(await opened.assertCurrent(), node), true);
  } finally {
    await opened.close();
  }
  const fsyncRoot = await RootedDirectory.open(workspacePath);
  t.after(() => fsyncRoot.close());
  const derived = await openRoot(fsyncRoot, finalRef);
  try {
    equal(derived.durability, "fsync");
  } finally {
    await derived.close();
  }

  await rejects(openRoot(root, finalRef, await nodeOf(root, otherRef)), conflict);
  writeTextFile(workspacePath, "stray.json", "{}\n", 0o600);
  await rejects(openRoot(root, parsePortableResourcePath("stray.json")), conflict);
  chmodSync(physical(finalRef), 0o755);
  await rejects(openRoot(root, finalRef, node), conflict);
});
