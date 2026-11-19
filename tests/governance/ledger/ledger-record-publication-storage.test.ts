import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { createDirectoryAtomically } from "../../../src/foundation/filesystem/durable-directory-materialization.js";
import {
  createDirectoryTreeCandidateDurably,
  planDirectoryTreeCandidate,
} from "../../../src/foundation/filesystem/durable-directory-tree-candidate.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { acquireRootedExclusiveFileLock } from "../../../src/foundation/filesystem/rooted-exclusive-file-lock.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { materializeLedgerAuthorityLayout } from "../../../src/governance/ledger/ledger-authority-layout.js";
import {
  ledgerAuthorityRootRef,
  ledgerRecordPublicationLockRef,
  ledgerRecordPublicationStageRef,
} from "../../../src/governance/ledger/ledger-authority-paths.js";
import {
  computeLedgerAuthorityRecordDigest,
  createRequirementRecord,
  type RequirementRecord,
  renderLedgerAuthorityRecord,
} from "../../../src/governance/ledger/ledger-authority-record.js";
import {
  LEDGER_AUTHORITY_MAXIMUM_TREE_DEPTH,
  LEDGER_AUTHORITY_MAXIMUM_TREE_ENTRIES,
  LEDGER_AUTHORITY_MAXIMUM_TREE_FILES,
  LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES,
  LEDGER_AUTHORITY_TREE_MAXIMUM_BYTES,
  LEDGER_DURABLE_DIRECTORY_MODE,
  LEDGER_DURABLE_FILE_MODE,
} from "../../../src/governance/ledger/ledger-authority-storage-policy.js";
import {
  LedgerAuthorityStoreError,
  type LedgerAuthorityStoreErrorReason,
} from "../../../src/governance/ledger/ledger-authority-store-contract.js";
import {
  type LedgerRecordPublicationPlan,
  ledgerPublicationResourceNodeOrNull,
  ledgerRecordPublicationStageNodeOrNull,
  loadExactPublishedLedgerRecord,
  prepareLedgerRecordPublicationLockRecovery,
  publishLedgerRecordStage,
  withLedgerRecordPublicationLock,
} from "../../../src/governance/ledger/ledger-record-publication-storage.js";
import { rootedExclusiveFileLockRecordTextForTest } from "../../foundation/filesystem/rooted-exclusive-file-lock-test-support.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { disposableRoot } from "../../support/temp-root.js";
import { writeTextFile } from "../../support/write-tree.js";
import {
  FIXTURE_RECORDED_AT,
  FIXTURE_REQUIREMENT_ID,
  requirementMembers,
  requirementRecordDraft,
} from "./requirement-package.fixture.js";

useDisposableDurability();

/** 直接覆盖逐记录发布流程的私有存储边界：暂存目录、锁、暂存发布与精确回读。级别 1（组件）。 */

const OTHER_REQUIREMENT_ID = "requirement_22222222-2222-4222-8222-222222222222";
const MEMBERS = requirementMembers();
const CANDIDATE_OPTIONS = {
  directoryMode: LEDGER_DURABLE_DIRECTORY_MODE,
  maximumDepth: LEDGER_AUTHORITY_MAXIMUM_TREE_DEPTH,
  maximumEntries: LEDGER_AUTHORITY_MAXIMUM_TREE_ENTRIES,
  maximumFileBytes: LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES,
  maximumFiles: LEDGER_AUTHORITY_MAXIMUM_TREE_FILES,
  maximumTotalBytes: LEDGER_AUTHORITY_TREE_MAXIMUM_BYTES,
} as const;
const ABORTED = AbortSignal.abort();

async function expectStoreError(
  action: () => unknown,
  reason: LedgerAuthorityStoreErrorReason,
  errorPath: string,
): Promise<LedgerAuthorityStoreError> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof LedgerAuthorityStoreError)) {
    throw new Error(`Expected LedgerAuthorityStoreError ${reason} at ${errorPath}.`);
  }
  equal(caught.reason, reason);
  equal(caught.path, errorPath);
  return caught;
}

async function ledgerRoot(t: TestContext, layout = true) {
  const rootPath = disposableRoot(t, "wakeflow-ledger-publication-storage-");
  const root = await RootedDirectory.open(rootPath);
  t.after(() => root.close());
  if (layout) await materializeLedgerAuthorityLayout(root);
  return { rootPath, root };
}

function physical(rootPath: string, ref: string): string {
  return path.join(rootPath, ...ref.split("/"));
}

function requirementRecord(
  title: string,
  requirementId: `requirement_${string}` = FIXTURE_REQUIREMENT_ID,
): Readonly<RequirementRecord> {
  return createRequirementRecord(requirementRecordDraft({ requirementId, title }), {
    clock: () => FIXTURE_RECORDED_AT,
  });
}

function publication(record: Readonly<RequirementRecord>) {
  const files = [
    ...MEMBERS.map((member) => ({
      path: member.path,
      bytes: member.bytes,
      mode: LEDGER_DURABLE_FILE_MODE,
    })),
    {
      path: "record.json",
      bytes: encodeUtf8(renderLedgerAuthorityRecord(record)),
      mode: LEDGER_DURABLE_FILE_MODE,
    },
  ].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const plan: LedgerRecordPublicationPlan = {
    record,
    finalRootRef: ledgerAuthorityRootRef(record),
    lockRef: ledgerRecordPublicationLockRef(record),
    stageRef: ledgerRecordPublicationStageRef(record),
    treePlan: planDirectoryTreeCandidate(files, CANDIDATE_OPTIONS),
  };
  return { record, files, plan };
}

test("resource node lookup reports absence, the exact node, and unsafe ancestors", async (t) => {
  const { rootPath, root } = await ledgerRoot(t);
  const { plan } = publication(requirementRecord("示例需求"));
  const fileRef = parsePortableResourcePath("transactions/plain.txt");
  equal(await ledgerPublicationResourceNodeOrNull(root, fileRef), null);
  equal(await ledgerPublicationResourceNodeOrNull(root, plan.finalRootRef), null);

  chmodSync(writeTextFile(rootPath, fileRef, "plain", 0o600), 0o600);
  const node = await ledgerPublicationResourceNodeOrNull(root, fileRef);
  ok(node !== null);
  equal(node.kind, "file");
  equal(node.permissionBits, 0o600);
  equal(node.linkCount, 1n);

  const throughFile = parsePortableResourcePath(`${fileRef}/child`);
  await expectStoreError(
    () => ledgerPublicationResourceNodeOrNull(root, throughFile),
    "root-scope",
    "$root",
  );
  symlinkSync("requirements", path.join(rootPath, "alias"));
  const throughLink = parsePortableResourcePath("alias/record.json");
  await expectStoreError(
    () => ledgerPublicationResourceNodeOrNull(root, throughLink),
    "root-scope",
    "$root",
  );
});

test("a bare root without the ledger layout fails closed for every transaction resource", async (t) => {
  const { rootPath, root } = await ledgerRoot(t, false);
  const { plan } = publication(requirementRecord("示例需求"));
  const noop = async () => undefined;
  equal(await ledgerRecordPublicationStageNodeOrNull(root, plan), null);
  await prepareLedgerRecordPublicationLockRecovery(root, plan.lockRef);
  await expectStoreError(
    () => withLedgerRecordPublicationLock(root, plan.lockRef, undefined, noop),
    "lock-unsafe",
    "$lock",
  );
  await expectStoreError(
    () => loadExactPublishedLedgerRecord(root, plan, undefined),
    "not-found",
    "$record",
  );
  deepEqual(readdirSync(rootPath), []);
});

test("the stage lookup admits only a durable stage directory", async (t) => {
  const { rootPath, root } = await ledgerRoot(t);
  const { plan } = publication(requirementRecord("示例需求"));
  const stagePath = physical(rootPath, plan.stageRef);
  equal(await ledgerRecordPublicationStageNodeOrNull(root, plan), null);

  await createDirectoryAtomically(root, plan.stageRef, { mode: LEDGER_DURABLE_DIRECTORY_MODE });
  const stageNode = await ledgerRecordPublicationStageNodeOrNull(root, plan);
  ok(stageNode !== null);
  equal(stageNode.kind, "directory");
  equal(stageNode.permissionBits, LEDGER_DURABLE_DIRECTORY_MODE);

  chmodSync(stagePath, 0o700);
  await expectStoreError(
    () => ledgerRecordPublicationStageNodeOrNull(root, plan),
    "conflict",
    "$stage",
  );
  rmSync(stagePath, { recursive: true });
  writeTextFile(rootPath, plan.stageRef, "not a stage");
  await expectStoreError(
    () => ledgerRecordPublicationStageNodeOrNull(root, plan),
    "conflict",
    "$stage",
  );
});

test("lock recovery retires inactive residues and leaves live or unsafe locks alone", async (t) => {
  const { rootPath, root } = await ledgerRoot(t);
  const { plan } = publication(requirementRecord("示例需求"));
  const lockPath = physical(rootPath, plan.lockRef);
  const prepare = () => prepareLedgerRecordPublicationLockRecovery(root, plan.lockRef);
  const locked = <Result>(action: () => Promise<Result>, signal?: AbortSignal) =>
    withLedgerRecordPublicationLock(root, plan.lockRef, signal, action);
  await prepare();
  equal(existsSync(lockPath), false);

  const residue = rootedExclusiveFileLockRecordTextForTest({
    tokenUuid: "99999999-9999-4999-8999-999999999999",
  });
  writeFileSync(lockPath, residue, { mode: 0o600 });
  await prepare();
  equal(existsSync(lockPath), false);

  const result = await locked(async () => {
    equal(existsSync(lockPath), true);
    return "inside";
  });
  equal(result, "inside");
  equal(existsSync(lockPath), false);

  const domainError = new LedgerAuthorityStoreError("conflict", "$test");
  equal(
    await expectStoreError(() => locked(() => Promise.reject(domainError)), "conflict", "$test"),
    domainError,
  );
  await rejects(() => locked(() => Promise.reject(new RangeError("private"))), RangeError);
  equal(existsSync(lockPath), false);

  const lease = await acquireRootedExclusiveFileLock(root, plan.lockRef);
  try {
    await prepare();
    equal(existsSync(lockPath), true);
    let entered = false;
    const enter = async () => {
      entered = true;
    };
    await expectStoreError(() => locked(enter, AbortSignal.timeout(100)), "aborted", "$signal");
    equal(entered, false);
  } finally {
    await lease.release();
  }
  equal(existsSync(lockPath), false);

  symlinkSync("missing", lockPath);
  await expectStoreError(prepare, "lock-unsafe", "$lock");
  await expectStoreError(() => locked(async () => undefined), "lock-unsafe", "$lock");
});

test("a lock held by another owner times out at the publication deadline", async (t) => {
  const { root } = await ledgerRoot(t);
  const { plan } = publication(requirementRecord("示例需求"));
  const lease = await acquireRootedExclusiveFileLock(root, plan.lockRef);
  try {
    const startedAt = performance.now();
    const noop = async () => undefined;
    await expectStoreError(
      () => withLedgerRecordPublicationLock(root, plan.lockRef, undefined, noop),
      "lock-timeout",
      "$lock",
    );
    ok(performance.now() - startedAt >= 9_000);
  } finally {
    await lease.release();
  }
});

test("stage publication commits the tree and exact loading proves it", async (t) => {
  const { rootPath, root } = await ledgerRoot(t);
  const { record, files, plan } = publication(requirementRecord("示例需求"));
  const finalPath = physical(rootPath, plan.finalRootRef);
  const stagePath = physical(rootPath, plan.stageRef);
  const load = (signal?: AbortSignal) => loadExactPublishedLedgerRecord(root, plan, signal);
  await expectStoreError(load, "not-found", "$record");

  const candidate = await createDirectoryTreeCandidateDurably(
    root,
    plan.stageRef,
    files,
    CANDIDATE_OPTIONS,
  );
  await expectStoreError(
    () => publishLedgerRecordStage(root, plan, candidate, ABORTED),
    "aborted",
    "$signal",
  );
  await publishLedgerRecordStage(root, plan, candidate, undefined);
  equal(existsSync(stagePath), false);
  equal(statSync(finalPath).mode & 0o777, LEDGER_DURABLE_DIRECTORY_MODE);
  equal(statSync(path.join(finalPath, "record.json")).mode & 0o777, LEDGER_DURABLE_FILE_MODE);
  deepEqual(readdirSync(finalPath).sort(), ["landing.md", "record.json", "requirement.md"]);

  const loaded = await load();
  deepEqual(loaded.record, record);
  equal(loaded.recordDigest, computeLedgerAuthorityRecordDigest(record));
  deepEqual(
    loaded.documents.map((document) => document.digest),
    record.documents.map((document) => document.digest),
  );
  await expectStoreError(() => load(ABORTED), "aborted", "$signal");

  // The stage was renamed away: neither the stale candidate nor a fresh one may publish again.
  await expectStoreError(
    () => publishLedgerRecordStage(root, plan, candidate, undefined),
    "conflict",
    "$stage",
  );
  const second = await createDirectoryTreeCandidateDurably(
    root,
    plan.stageRef,
    files,
    CANDIDATE_OPTIONS,
  );
  await expectStoreError(
    () => publishLedgerRecordStage(root, plan, second, undefined),
    "conflict",
    "$stage",
  );
  equal(existsSync(stagePath), true);
  rmSync(stagePath, { recursive: true });

  writeTextFile(rootPath, `${plan.finalRootRef}/extra.md`, "# extra\n", LEDGER_DURABLE_FILE_MODE);
  await expectStoreError(load, "conflict", "$record");
  rmSync(path.join(finalPath, "extra.md"));
  deepEqual((await load()).record, record);

  const other = publication(requirementRecord("Other", OTHER_REQUIREMENT_ID)).plan;
  writeTextFile(rootPath, other.finalRootRef, "not a tree");
  await expectStoreError(
    () => loadExactPublishedLedgerRecord(root, other, undefined),
    "conflict",
    "$record",
  );
});
