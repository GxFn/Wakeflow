import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import { createDirectoryAtomically } from "../../../src/foundation/filesystem/durable-directory-materialization.js";
import {
  createDirectoryTreeCandidateDurably,
  planDirectoryTreeCandidate,
} from "../../../src/foundation/filesystem/durable-directory-tree-candidate.js";
import { createFileCandidateDurably } from "../../../src/foundation/filesystem/durable-file-candidate.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { acquireRootedExclusiveFileLock } from "../../../src/foundation/filesystem/rooted-exclusive-file-lock.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { materializeLedgerAuthorityLayout } from "../../../src/governance/ledger/ledger-authority-layout.js";
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
  LEDGER_PUBLICATION_INTENT_MAXIMUM_BYTES,
  LEDGER_TRANSACTION_FILE_MODE,
} from "../../../src/governance/ledger/ledger-authority-storage-policy.js";
import {
  LedgerAuthorityStoreError,
  type LedgerAuthorityStoreErrorReason,
} from "../../../src/governance/ledger/ledger-authority-store-contract.js";
import {
  createLedgerRecordPublicationIntent,
  type LedgerRecordPublicationIntent,
  renderLedgerRecordPublicationIntent,
  sameLedgerRecordPublicationIntent,
} from "../../../src/governance/ledger/ledger-record-publication-intent.js";
import {
  ensureLedgerRecordPublicationIntent,
  existingLedgerRecordPublicationIntentOrNull,
  inspectLedgerRecordPublicationResidues,
  ledgerPublicationResourceNodeOrNull,
  loadExactPublishedLedgerRecord,
  prepareLedgerRecordPublicationLockRecovery,
  publishLedgerRecordStage,
  recoverLedgerIntentAtomicStages,
  retireLedgerRecordPublicationIntent,
  settleCommittedLedgerIntent,
  withLedgerRecordPublicationLock,
} from "../../../src/governance/ledger/ledger-record-publication-storage.js";
import { durableAtomicFileStageRefForTest } from "../../foundation/filesystem/durable-atomic-file-test-support.js";
import { rootedExclusiveFileLockRecordTextForTest } from "../../foundation/filesystem/rooted-exclusive-file-lock-test-support.js";
import { disposableRoot } from "../../support/temp-root.js";
import { writeTextFile } from "../../support/write-tree.js";
import {
  FIXTURE_RECORDED_AT,
  FIXTURE_REQUIREMENT_ID,
  requirementMembers,
  requirementRecordDraft,
} from "./requirement-package.fixture.js";

/** 直接覆盖逐记录发布流程的私有存储边界：意图记录、残留、锁、暂存发布与精确回读。 */

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
  const plan = planDirectoryTreeCandidate(files, CANDIDATE_OPTIONS);
  return { record, files, intent: createLedgerRecordPublicationIntent(record, plan) };
}

function writeIntentFile(
  rootPath: string,
  intent: Readonly<LedgerRecordPublicationIntent>,
): string {
  const text = renderLedgerRecordPublicationIntent(intent);
  const file = writeTextFile(rootPath, intent.intentRef, text, LEDGER_TRANSACTION_FILE_MODE);
  chmodSync(file, LEDGER_TRANSACTION_FILE_MODE);
  return file;
}

test("resource node lookup reports absence, the exact node, and unsafe ancestors", async (t) => {
  const { rootPath, root } = await ledgerRoot(t);
  const { intent } = publication(requirementRecord("示例需求"));
  equal(await ledgerPublicationResourceNodeOrNull(root, intent.intentRef), null);
  equal(await ledgerPublicationResourceNodeOrNull(root, intent.finalRootRef), null);

  writeIntentFile(rootPath, intent);
  const node = await ledgerPublicationResourceNodeOrNull(root, intent.intentRef);
  ok(node !== null);
  equal(node.kind, "file");
  equal(node.permissionBits, LEDGER_TRANSACTION_FILE_MODE);
  equal(node.linkCount, 1n);

  const throughFile = parsePortableResourcePath(`${intent.intentRef}/child`);
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

test("publication intent is created once, read back exactly, and rejects foreign nodes", async (t) => {
  const { rootPath, root } = await ledgerRoot(t);
  const { intent } = publication(requirementRecord("示例需求"));
  const intentPath = physical(rootPath, intent.intentRef);
  const text = renderLedgerRecordPublicationIntent(intent);
  const read = (signal?: AbortSignal) =>
    existingLedgerRecordPublicationIntentOrNull(root, intent.intentRef, signal);
  equal(await read(), null);

  const stored = await ensureLedgerRecordPublicationIntent(root, intent, undefined);
  equal(statSync(intentPath).mode & 0o777, LEDGER_TRANSACTION_FILE_MODE);
  equal(readFileSync(intentPath, "utf8"), text);
  equal(sameLedgerRecordPublicationIntent(stored.intent, intent), true);
  equal(stored.node.kind, "file");
  equal(Object.isFrozen(stored), true);

  const again = await ensureLedgerRecordPublicationIntent(root, intent, undefined);
  equal(again.node.inodeId, stored.node.inodeId);
  const existing = await read();
  ok(existing !== null);
  equal(existing.node.inodeId, stored.node.inodeId);
  equal(sameLedgerRecordPublicationIntent(existing.intent, intent), true);

  const conflicting = publication(requirementRecord("Conflicting title")).intent;
  await expectStoreError(
    () => ensureLedgerRecordPublicationIntent(root, conflicting, undefined),
    "conflict",
    "$intent",
  );
  equal(readFileSync(intentPath, "utf8"), text);
  await expectStoreError(() => read(ABORTED), "aborted", "$signal");

  chmodSync(intentPath, 0o644);
  await expectStoreError(read, "conflict", "$intent");
  chmodSync(intentPath, LEDGER_TRANSACTION_FILE_MODE);

  // Same JSON, non-deterministic representation: the bytes are no longer the admitted render,
  // and ensure must not silently overwrite them.
  writeFileSync(intentPath, `${text}\n`);
  await expectStoreError(read, "conflict", "$intent");
  await expectStoreError(
    () => ensureLedgerRecordPublicationIntent(root, intent, undefined),
    "conflict",
    "$intent",
  );
  writeFileSync(intentPath, "x".repeat(LEDGER_PUBLICATION_INTENT_MAXIMUM_BYTES + 1));
  await expectStoreError(read, "capacity", "$intent");
  rmSync(intentPath);
  mkdirSync(intentPath);
  await expectStoreError(read, "conflict", "$intent");
});

test("a bare root without the ledger layout fails closed for every transaction resource", async (t) => {
  const { rootPath, root } = await ledgerRoot(t, false);
  const { intent } = publication(requirementRecord("示例需求"));
  const noop = async () => undefined;
  await expectStoreError(
    () => ensureLedgerRecordPublicationIntent(root, intent, undefined),
    "operation-failure",
    "$intent",
  );
  await expectStoreError(
    () => recoverLedgerIntentAtomicStages(root, intent.intentRef, undefined),
    "recovery-required",
    "$intent/stage",
  );
  await prepareLedgerRecordPublicationLockRecovery(root, intent.lockRef);
  await expectStoreError(
    () => withLedgerRecordPublicationLock(root, intent.lockRef, undefined, noop),
    "lock-unsafe",
    "$lock",
  );

  await materializeLedgerAuthorityLayout(root);
  await expectStoreError(
    () => ensureLedgerRecordPublicationIntent(root, intent, ABORTED),
    "aborted",
    "$signal",
  );
  equal(existsSync(physical(rootPath, intent.intentRef)), false);
});

test("intent retirement unlinks only the exact stored node", async (t) => {
  const { rootPath, root } = await ledgerRoot(t);
  const { intent } = publication(requirementRecord("示例需求"));
  const intentPath = physical(rootPath, intent.intentRef);
  const stored = await ensureLedgerRecordPublicationIntent(root, intent, undefined);
  await expectStoreError(
    () => retireLedgerRecordPublicationIntent(root, stored, ABORTED),
    "aborted",
    "$signal",
  );
  equal(existsSync(intentPath), true);
  await retireLedgerRecordPublicationIntent(root, stored, undefined);
  equal(existsSync(intentPath), false);
  await expectStoreError(
    () => retireLedgerRecordPublicationIntent(root, stored, undefined),
    "recovery-required",
    "$intent",
  );

  const stale = await ensureLedgerRecordPublicationIntent(root, intent, undefined);
  rmSync(intentPath);
  writeIntentFile(rootPath, intent);
  await expectStoreError(
    () => retireLedgerRecordPublicationIntent(root, stale, undefined),
    "recovery-required",
    "$intent",
  );
  equal(existsSync(intentPath), true);
  const fresh = await existingLedgerRecordPublicationIntentOrNull(
    root,
    intent.intentRef,
    undefined,
  );
  ok(fresh !== null);
  await retireLedgerRecordPublicationIntent(root, fresh, undefined);
  deepEqual(readdirSync(path.join(rootPath, "transactions")), []);
});

test("residue inspection admits only a durable stage directory", async (t) => {
  const { rootPath, root } = await ledgerRoot(t);
  const { intent } = publication(requirementRecord("示例需求"));
  const stagePath = physical(rootPath, intent.stageRef);
  deepEqual(await inspectLedgerRecordPublicationResidues(root, intent), { stageNode: null });

  await createDirectoryAtomically(root, intent.stageRef, { mode: LEDGER_DURABLE_DIRECTORY_MODE });
  const residues = await inspectLedgerRecordPublicationResidues(root, intent);
  ok(residues.stageNode !== null);
  equal(residues.stageNode.kind, "directory");
  equal(residues.stageNode.permissionBits, LEDGER_DURABLE_DIRECTORY_MODE);

  chmodSync(stagePath, 0o700);
  await expectStoreError(
    () => inspectLedgerRecordPublicationResidues(root, intent),
    "conflict",
    "$stage",
  );
  rmSync(stagePath, { recursive: true });
  writeTextFile(rootPath, intent.stageRef, "not a stage");
  await expectStoreError(
    () => inspectLedgerRecordPublicationResidues(root, intent),
    "conflict",
    "$stage",
  );
});

test("atomic intent stages are retired when stale and preserved while active", async (t) => {
  const { rootPath, root } = await ledgerRoot(t);
  const { intent } = publication(requirementRecord("示例需求"));
  const recover = (signal?: AbortSignal) =>
    recoverLedgerIntentAtomicStages(root, intent.intentRef, signal);
  await recover();
  const digest = computeSha256Digest(encodeUtf8(renderLedgerRecordPublicationIntent(intent)));
  const mode = LEDGER_TRANSACTION_FILE_MODE;

  const stale = issueDurableAtomicFileStageAddress("create", intent.intentRef, digest, mode);
  const staleRef = durableAtomicFileStageRefForTest(intent.intentRef, stale);
  await createFileCandidateDurably(root, staleRef, encodeUtf8("partial"), { mode });
  releaseDurableAtomicFileStageAddress(stale);
  await recover();
  equal(existsSync(physical(rootPath, staleRef)), false);
  equal(existsSync(physical(rootPath, intent.intentRef)), false);

  const active = issueDurableAtomicFileStageAddress("create", intent.intentRef, digest, mode);
  const activeRef = durableAtomicFileStageRefForTest(intent.intentRef, active);
  try {
    await createFileCandidateDurably(root, activeRef, encodeUtf8("partial"), { mode });
    await expectStoreError(recover, "recovery-required", "$intent/stage");
    equal(existsSync(physical(rootPath, activeRef)), true);
    await expectStoreError(() => recover(ABORTED), "aborted", "$signal");
  } finally {
    releaseDurableAtomicFileStageAddress(active);
  }
});

test("lock recovery retires inactive residues and leaves live or unsafe locks alone", async (t) => {
  const { rootPath, root } = await ledgerRoot(t);
  const { intent } = publication(requirementRecord("示例需求"));
  const lockPath = physical(rootPath, intent.lockRef);
  const prepare = () => prepareLedgerRecordPublicationLockRecovery(root, intent.lockRef);
  const locked = <Result>(action: () => Promise<Result>, signal?: AbortSignal) =>
    withLedgerRecordPublicationLock(root, intent.lockRef, signal, action);
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

  const lease = await acquireRootedExclusiveFileLock(root, intent.lockRef);
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
  const { intent } = publication(requirementRecord("示例需求"));
  const lease = await acquireRootedExclusiveFileLock(root, intent.lockRef);
  try {
    const startedAt = performance.now();
    const noop = async () => undefined;
    await expectStoreError(
      () => withLedgerRecordPublicationLock(root, intent.lockRef, undefined, noop),
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
  const { record, files, intent } = publication(requirementRecord("示例需求"));
  const finalPath = physical(rootPath, intent.finalRootRef);
  const stagePath = physical(rootPath, intent.stageRef);
  const load = (signal?: AbortSignal) => loadExactPublishedLedgerRecord(root, intent, signal);
  await expectStoreError(load, "not-found", "$record");

  const candidate = await createDirectoryTreeCandidateDurably(
    root,
    intent.stageRef,
    files,
    CANDIDATE_OPTIONS,
  );
  await expectStoreError(
    () => publishLedgerRecordStage(root, intent, candidate, ABORTED),
    "aborted",
    "$signal",
  );
  await publishLedgerRecordStage(root, intent, candidate, undefined);
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
    () => publishLedgerRecordStage(root, intent, candidate, undefined),
    "conflict",
    "$stage",
  );
  const second = await createDirectoryTreeCandidateDurably(
    root,
    intent.stageRef,
    files,
    CANDIDATE_OPTIONS,
  );
  await expectStoreError(
    () => publishLedgerRecordStage(root, intent, second, undefined),
    "conflict",
    "$stage",
  );
  equal(existsSync(stagePath), true);
  rmSync(stagePath, { recursive: true });

  writeTextFile(rootPath, `${intent.finalRootRef}/extra.md`, "# extra\n", LEDGER_DURABLE_FILE_MODE);
  await expectStoreError(load, "conflict", "$record");
  rmSync(path.join(finalPath, "extra.md"));
  deepEqual((await load()).record, record);

  const other = publication(requirementRecord("Other", OTHER_REQUIREMENT_ID)).intent;
  writeTextFile(rootPath, other.finalRootRef, "not a tree");
  await expectStoreError(
    () => loadExactPublishedLedgerRecord(root, other, undefined),
    "conflict",
    "$record",
  );
});

test("settling a committed intent retires it only when no stage residue remains", async (t) => {
  const { rootPath, root } = await ledgerRoot(t);
  const { record, files, intent } = publication(requirementRecord("示例需求"));
  const intentPath = physical(rootPath, intent.intentRef);
  const stored = await ensureLedgerRecordPublicationIntent(root, intent, undefined);
  const settle = (stageNode: typeof stored.node | null) =>
    settleCommittedLedgerIntent(root, stored, { stageNode }, undefined);
  await expectStoreError(() => settle(null), "not-found", "$record");
  equal(existsSync(intentPath), true);

  const candidate = await createDirectoryTreeCandidateDurably(
    root,
    intent.stageRef,
    files,
    CANDIDATE_OPTIONS,
  );
  await publishLedgerRecordStage(root, intent, candidate, undefined);
  await expectStoreError(() => settle(stored.node), "recovery-required", "$stage");
  equal(existsSync(intentPath), true);

  deepEqual((await settle(null)).record, record);
  deepEqual(readdirSync(path.join(rootPath, "transactions")), []);
  await expectStoreError(() => settle(null), "recovery-required", "$intent");
});
