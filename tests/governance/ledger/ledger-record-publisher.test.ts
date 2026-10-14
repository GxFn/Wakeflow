import { deepEqual, equal } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
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
import { publishDirectoryTreeCandidateDurably } from "../../../src/foundation/filesystem/durable-directory-tree-publication.js";
import { createFileCandidateDurably } from "../../../src/foundation/filesystem/durable-file-candidate.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { acquireRootedExclusiveFileLock } from "../../../src/foundation/filesystem/rooted-exclusive-file-lock.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { materializeLedgerAuthorityLayout } from "../../../src/governance/ledger/ledger-authority-layout.js";
import { loadLedgerAuthorityRecord } from "../../../src/governance/ledger/ledger-authority-reader.js";
import {
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
} from "../../../src/governance/ledger/ledger-record-publication-intent.js";
import { publishLedgerAuthorityRecord } from "../../../src/governance/ledger/ledger-record-publisher.js";
import { rootedExclusiveFileLockRecordTextForTest } from "../../foundation/filesystem/rooted-exclusive-file-lock-test-support.js";
import { disposableRoot } from "../../support/temp-root.js";
import { writeTextFile } from "../../support/write-tree.js";
import {
  FIXTURE_LANDING_MARKDOWN,
  FIXTURE_RECORDED_AT,
  FIXTURE_REQUIREMENT_ID,
  fixtureDocuments,
  requirementMembers,
  requirementRecordDraft,
} from "./requirement-package.fixture.js";

/** 直接覆盖单记录暂存发布编排：输入准入、首次提交、幂等复用、残留处理与锁门控。 */

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

async function expectStoreError(
  action: () => unknown,
  reason: LedgerAuthorityStoreErrorReason,
  errorPath?: string,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof LedgerAuthorityStoreError)) {
    throw new Error(`Expected LedgerAuthorityStoreError ${reason}.`);
  }
  equal(caught.reason, reason);
  if (errorPath !== undefined) equal(caught.path, errorPath);
}

async function ledgerRoot(t: TestContext) {
  const rootPath = disposableRoot(t, "wakeflow-ledger-publisher-");
  const root = await RootedDirectory.open(rootPath);
  t.after(() => root.close());
  await materializeLedgerAuthorityLayout(root);
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

function writeIntentFile(rootPath: string, intent: Readonly<LedgerRecordPublicationIntent>): string {
  const file = writeTextFile(
    rootPath,
    intent.intentRef,
    renderLedgerRecordPublicationIntent(intent),
    LEDGER_TRANSACTION_FILE_MODE,
  );
  chmodSync(file, LEDGER_TRANSACTION_FILE_MODE);
  return file;
}

test("publishes one requirement tree and idempotently reuses the exact committed record", async (t) => {
  const { rootPath, root } = await ledgerRoot(t);
  const record = requirementRecord("示例需求");
  const created = await publishLedgerAuthorityRecord(root, record, MEMBERS, undefined);
  equal(created.wroteAuthority, true);
  deepEqual(created.loaded.record, record);
  equal(created.loaded.recordRef, `requirements/${FIXTURE_REQUIREMENT_ID}/record.json`);
  deepEqual(
    created.loaded.documents.map((document) => [document.role, document.memberRef]),
    [
      ["landing", `requirements/${FIXTURE_REQUIREMENT_ID}/landing.md`],
      ["requirement", `requirements/${FIXTURE_REQUIREMENT_ID}/requirement.md`],
    ],
  );
  const finalPath = physical(rootPath, `requirements/${FIXTURE_REQUIREMENT_ID}`);
  equal(statSync(finalPath).mode & 0o777, LEDGER_DURABLE_DIRECTORY_MODE);
  deepEqual(readdirSync(finalPath).sort(), ["landing.md", "record.json", "requirement.md"]);
  for (const name of readdirSync(finalPath)) {
    equal(statSync(path.join(finalPath, name)).mode & 0o777, LEDGER_DURABLE_FILE_MODE);
  }
  equal(readFileSync(path.join(finalPath, "record.json"), "utf8"), renderLedgerAuthorityRecord(record));
  equal(readFileSync(path.join(finalPath, "landing.md"), "utf8"), FIXTURE_LANDING_MARKDOWN);
  deepEqual(readdirSync(path.join(rootPath, "transactions")), []);

  const reused = await publishLedgerAuthorityRecord(root, record, MEMBERS, undefined);
  equal(reused.wroteAuthority, false);
  equal(reused.loaded.recordDigest, created.loaded.recordDigest);
  deepEqual((await loadLedgerAuthorityRecord(root, record.requirementId, undefined)).record, record);

  const results = await Promise.all([
    publishLedgerAuthorityRecord(root, requirementRecord("Concurrent", OTHER_REQUIREMENT_ID), MEMBERS, undefined),
    publishLedgerAuthorityRecord(root, requirementRecord("Concurrent", OTHER_REQUIREMENT_ID), MEMBERS, undefined),
  ]);
  deepEqual(results.map((result) => result.wroteAuthority).sort(), [false, true]);

  await expectStoreError(
    () => publishLedgerAuthorityRecord(root, requirementRecord("Conflicting title"), MEMBERS, undefined),
    "conflict",
    "$record",
  );
  await expectStoreError(
    () => publishLedgerAuthorityRecord(
      root,
      record,
      requirementMembers(fixtureDocuments({ landing: "# 改动\n" })),
      undefined,
    ),
    "member",
    "$members/0",
  );
  equal(readFileSync(path.join(finalPath, "landing.md"), "utf8"), FIXTURE_LANDING_MARKDOWN);
  deepEqual(readdirSync(path.join(rootPath, "transactions")), []);
});

test("rejects malformed records and members before touching the ledger", async (t) => {
  const { rootPath, root } = await ledgerRoot(t);
  const record = requirementRecord("示例需求");
  const [landing, requirement] = MEMBERS;
  if (landing === undefined || requirement === undefined) {
    throw new Error("Expected two fixture members.");
  }
  await expectStoreError(
    () => publishLedgerAuthorityRecord(root, { ...record, title: 1 }, MEMBERS, undefined),
    "input",
    "$record",
  );
  await expectStoreError(
    () => publishLedgerAuthorityRecord(root, record, null as never, undefined),
    "input",
    "$members",
  );
  await expectStoreError(
    () => publishLedgerAuthorityRecord(root, record, [landing], undefined),
    "member",
    "$members",
  );
  await expectStoreError(
    () => publishLedgerAuthorityRecord(root, record, [requirement, landing], undefined),
    "member",
    "$members/0",
  );
  await expectStoreError(
    () => publishLedgerAuthorityRecord(root, record, [{ ...landing, extra: 1 } as never, requirement], undefined),
    "input",
    "$members/0",
  );
  await expectStoreError(
    () => publishLedgerAuthorityRecord(
      root,
      record,
      [landing, { path: requirement.path, bytes: new Proxy(requirement.bytes, {}) }],
      undefined,
    ),
    "input",
    "$members/1",
  );
  await expectStoreError(
    () => publishLedgerAuthorityRecord(
      root,
      record,
      [landing, { path: requirement.path, bytes: new Uint8Array(LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES + 1) }],
      undefined,
    ),
    "capacity",
    "$members/1",
  );
  await expectStoreError(
    () => publishLedgerAuthorityRecord(
      root,
      record,
      [landing, { path: requirement.path, bytes: encodeUtf8("# other\n") }],
      undefined,
    ),
    "member",
    "$members/1",
  );
  await expectStoreError(
    () => publishLedgerAuthorityRecord(root, record, [landing, { path: "other.md", bytes: requirement.bytes }], undefined),
    "member",
    "$members/1",
  );
  deepEqual(readdirSync(path.join(rootPath, "requirements")), []);
  deepEqual(readdirSync(path.join(rootPath, "transactions")), []);
});

test("settles a pending intent against an incomplete stage or a committed final", async (t) => {
  const { rootPath, root } = await ledgerRoot(t);
  const partial = publication(requirementRecord("Resume staged authority"));
  writeIntentFile(rootPath, partial.intent);
  await createDirectoryAtomically(root, partial.intent.stageRef, { mode: LEDGER_DURABLE_DIRECTORY_MODE });
  await createFileCandidateDurably(
    root,
    parsePortableResourcePath(`${partial.intent.stageRef}/record.json`),
    encodeUtf8(renderLedgerAuthorityRecord(partial.record)),
    { mode: LEDGER_DURABLE_FILE_MODE },
  );
  const resumed = await publishLedgerAuthorityRecord(root, partial.record, MEMBERS, undefined);
  equal(resumed.wroteAuthority, true);
  deepEqual(resumed.loaded.record, partial.record);
  equal(existsSync(physical(rootPath, partial.intent.stageRef)), false);
  equal(existsSync(physical(rootPath, partial.intent.intentRef)), false);
  equal(
    readFileSync(physical(rootPath, `${partial.intent.finalRootRef}/landing.md`), "utf8"),
    FIXTURE_LANDING_MARKDOWN,
  );

  const committed = publication(requirementRecord("Post-rename recovery", OTHER_REQUIREMENT_ID));
  writeIntentFile(rootPath, committed.intent);
  const candidate = await createDirectoryTreeCandidateDurably(
    root,
    committed.intent.stageRef,
    committed.files,
    CANDIDATE_OPTIONS,
  );
  await publishDirectoryTreeCandidateDurably(root, candidate, committed.intent.finalRootRef);
  const settled = await publishLedgerAuthorityRecord(root, committed.record, MEMBERS, undefined);
  equal(settled.wroteAuthority, false);
  deepEqual(settled.loaded.record, committed.record);
  equal(existsSync(physical(rootPath, committed.intent.intentRef)), false);
  deepEqual(readdirSync(path.join(rootPath, "transactions")), []);
});

test("fails closed on residues it cannot own and on a drifted pending intent", async (t) => {
  const { rootPath, root } = await ledgerRoot(t);
  const { record, intent } = publication(requirementRecord("示例需求"));
  const stagePath = physical(rootPath, intent.stageRef);
  const intentPath = physical(rootPath, intent.intentRef);

  await createDirectoryAtomically(root, intent.stageRef, { mode: LEDGER_DURABLE_DIRECTORY_MODE });
  await expectStoreError(
    () => publishLedgerAuthorityRecord(root, record, MEMBERS, undefined),
    "recovery-required",
    "$stage",
  );
  equal(existsSync(stagePath), true);
  equal(existsSync(intentPath), false);
  rmSync(stagePath, { recursive: true });

  const drifted = publication(requirementRecord("Drifted title")).intent;
  writeIntentFile(rootPath, drifted);
  await expectStoreError(
    () => publishLedgerAuthorityRecord(root, record, MEMBERS, undefined),
    "conflict",
    "$intent",
  );
  equal(readFileSync(intentPath, "utf8"), renderLedgerRecordPublicationIntent(drifted));
  equal(existsSync(physical(rootPath, intent.finalRootRef)), false);
  rmSync(intentPath);

  // A pending intent whose stage already holds different bytes cannot be settled from new input.
  writeIntentFile(rootPath, intent);
  await createDirectoryAtomically(root, intent.stageRef, { mode: LEDGER_DURABLE_DIRECTORY_MODE });
  await createFileCandidateDurably(
    root,
    parsePortableResourcePath(`${intent.stageRef}/record.json`),
    encodeUtf8(renderLedgerAuthorityRecord(requirementRecord("Drifted title"))),
    { mode: LEDGER_DURABLE_FILE_MODE },
  );
  await expectStoreError(() => publishLedgerAuthorityRecord(root, record, MEMBERS, undefined), "conflict", "$stage");
  equal(existsSync(intentPath), true);
  rmSync(stagePath, { recursive: true });
  rmSync(intentPath);

  chmodSync(writeIntentFile(rootPath, intent), 0o644);
  await expectStoreError(
    () => publishLedgerAuthorityRecord(root, record, MEMBERS, undefined),
    "conflict",
    "$intent",
  );
  rmSync(intentPath);

  equal((await publishLedgerAuthorityRecord(root, record, MEMBERS, undefined)).wroteAuthority, true);
  await createDirectoryAtomically(root, intent.stageRef, { mode: LEDGER_DURABLE_DIRECTORY_MODE });
  await expectStoreError(
    () => publishLedgerAuthorityRecord(root, record, MEMBERS, undefined),
    "recovery-required",
    "$stage",
  );
  rmSync(stagePath, { recursive: true });
  equal((await publishLedgerAuthorityRecord(root, record, MEMBERS, undefined)).wroteAuthority, false);
});

test("the record lock gates publication and inactive lock residues are retired first", async (t) => {
  const { rootPath, root } = await ledgerRoot(t);
  const { record, intent } = publication(requirementRecord("示例需求"));
  const lockPath = physical(rootPath, intent.lockRef);
  const lease = await acquireRootedExclusiveFileLock(root, intent.lockRef);
  try {
    await expectStoreError(
      () => publishLedgerAuthorityRecord(root, record, MEMBERS, AbortSignal.timeout(100)),
      "aborted",
      "$signal",
    );
  } finally {
    await lease.release();
  }
  equal(existsSync(physical(rootPath, intent.intentRef)), false);
  equal(existsSync(physical(rootPath, intent.finalRootRef)), false);

  writeFileSync(lockPath, rootedExclusiveFileLockRecordTextForTest({
    tokenUuid: "99999999-9999-4999-8999-999999999999",
  }), { mode: 0o600 });
  equal((await publishLedgerAuthorityRecord(root, record, MEMBERS, undefined)).wroteAuthority, true);
  equal(existsSync(lockPath), false);

  symlinkSync("missing", lockPath);
  await expectStoreError(
    () => publishLedgerAuthorityRecord(root, record, MEMBERS, undefined),
    "lock-unsafe",
    "$lock",
  );
});

test("an already aborted signal is reported as aborted before any admission write", async (t) => {
  const { rootPath, root } = await ledgerRoot(t);
  const { record, intent } = publication(requirementRecord("示例需求"));
  // 候选树规划先核对信号；§13.169 前这里被映射成 member $members。
  await expectStoreError(
    () => publishLedgerAuthorityRecord(root, record, MEMBERS, AbortSignal.abort()),
    "aborted",
    "$signal",
  );
  equal(existsSync(physical(rootPath, intent.intentRef)), false);
  equal(existsSync(physical(rootPath, intent.finalRootRef)), false);
  equal(existsSync(physical(rootPath, intent.lockRef)), false);
});
