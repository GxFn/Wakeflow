import { deepEqual, equal } from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

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
import { publishDirectoryTreeCandidateDurably } from "../../../src/foundation/filesystem/durable-directory-tree-publication.js";
import { createFileCandidateDurably } from "../../../src/foundation/filesystem/durable-file-candidate.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import {
  createRequirementRecord,
  type RequirementRecord,
  renderLedgerAuthorityRecord,
} from "../../../src/governance/ledger/ledger-authority-record.js";
import {
  createLedgerAuthorityMemberReference,
  LedgerAuthorityStore,
  LedgerAuthorityStoreError,
  type LedgerAuthorityStoreErrorReason,
  parseLedgerAuthorityMemberReference,
} from "../../../src/governance/ledger/ledger-authority-store.js";
import {
  ledgerAuthorityRootRef,
  ledgerRecordPublicationLockRef,
  ledgerRecordPublicationStageRef,
} from "../../../src/governance/ledger/ledger-authority-paths.js";
import { durableAtomicFileStageRefForTest } from "../../foundation/filesystem/durable-atomic-file-test-support.js";
import { rootedExclusiveFileLockRecordTextForTest } from "../../foundation/filesystem/rooted-exclusive-file-lock-test-support.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import {
  FIXTURE_LANDING_MARKDOWN,
  FIXTURE_RECORDED_AT,
  FIXTURE_REQUIREMENT_ID,
  FIXTURE_REQUIREMENT_MARKDOWN,
  fixtureDocuments,
  requirementMembers,
  requirementRecordDraft,
} from "./requirement-package.fixture.js";

useDisposableDurability();

const REQUIREMENT_ID = FIXTURE_REQUIREMENT_ID;
const OTHER_REQUIREMENT_ID = "requirement_22222222-2222-4222-8222-222222222222";
const THIRD_REQUIREMENT_ID = "requirement_33333333-3333-4333-8333-333333333333";
const UNRELATED_REQUIREMENT_ID = "requirement_44444444-4444-4444-8444-444444444444";
const MEMBERS = requirementMembers();

const CANDIDATE_OPTIONS = {
  directoryMode: 0o755,
  maximumDepth: 64,
  maximumEntries: 256,
  maximumFileBytes: 4 * 1024 * 1024,
  maximumFiles: 19,
  maximumTotalBytes: 16 * 1024 * 1024,
} as const;

async function expectStoreError(
  action: () => unknown | Promise<unknown>,
  reason: LedgerAuthorityStoreErrorReason,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof LedgerAuthorityStoreError)) {
    throw new Error("Expected LedgerAuthorityStoreError.");
  }
  equal(caught.reason, reason);
}

async function fixture() {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-ledger-stage-"));
  const root = await RootedDirectory.open(rootPath);
  const store = new LedgerAuthorityStore(root);
  await store.initialize({ freshLedger: true });
  return { rootPath, root, store };
}

function requirementRecord(
  requirementId: `requirement_${string}`,
  title: string,
): Readonly<RequirementRecord> {
  return createRequirementRecord(requirementRecordDraft({ requirementId, title }), {
    clock: () => FIXTURE_RECORDED_AT,
  });
}

function publicationPlan(record: Readonly<RequirementRecord>) {
  const files = [
    ...MEMBERS.map((member) => ({
      path: member.path,
      bytes: member.bytes,
      mode: 0o644,
    })),
    {
      path: "record.json",
      bytes: encodeUtf8(renderLedgerAuthorityRecord(record)),
      mode: 0o644,
    },
  ].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  planDirectoryTreeCandidate(files, CANDIDATE_OPTIONS);
  return {
    files,
    refs: {
      finalRootRef: ledgerAuthorityRootRef(record),
      lockRef: ledgerRecordPublicationLockRef(record),
      stageRef: ledgerRecordPublicationStageRef(record),
    },
  };
}

test("Ledger publishes one requirement package tree and idempotently reuses it", async () => {
  const { rootPath, root, store } = await fixture();
  try {
    deepEqual(readdirSync(rootPath).sort(), ["archives", "requirements", "transactions"]);
    equal(statSync(path.join(rootPath, "requirements")).mode & 0o777, 0o755);
    equal(statSync(path.join(rootPath, "transactions")).mode & 0o777, 0o700);

    const record = requirementRecord(REQUIREMENT_ID, "示例需求");
    const created = await store.publish(record, MEMBERS);
    equal(created.wroteAuthority, true);
    equal(created.loaded.family, "requirement");
    equal(created.loaded.record.requirementId, REQUIREMENT_ID);
    equal(created.loaded.recordRef, `requirements/${REQUIREMENT_ID}/record.json`);
    deepEqual(
      created.loaded.documents.map((document) => [document.role, document.memberRef]),
      [
        ["landing", `requirements/${REQUIREMENT_ID}/landing.md`],
        ["requirement", `requirements/${REQUIREMENT_ID}/requirement.md`],
      ],
    );
    equal(statSync(path.join(rootPath, "requirements", REQUIREMENT_ID)).mode & 0o777, 0o755);
    equal(
      statSync(path.join(rootPath, "requirements", REQUIREMENT_ID, "record.json")).mode & 0o777,
      0o644,
    );
    equal(readdirSync(path.join(rootPath, "transactions")).length, 0);

    const reused = await store.publish(record, MEMBERS);
    equal(reused.wroteAuthority, false);
    equal(reused.loaded.recordDigest, created.loaded.recordDigest);
    const loaded = await store.loadRequirement(REQUIREMENT_ID);
    deepEqual(loaded.record, record);
    equal(loaded.recordDigest, created.loaded.recordDigest);
    deepEqual(
      loaded.documents.map((document) => document.digest),
      MEMBERS.map((member) => computeSha256Digest(member.bytes)),
    );

    const [landingReference, requirementReference] = ["landing.md", "requirement.md"].map(
      (memberPath) => createLedgerAuthorityMemberReference(created.loaded, memberPath),
    );
    if (landingReference === undefined || requirementReference === undefined) {
      throw new Error("Expected two member references.");
    }
    deepEqual(
      [landingReference, requirementReference].map((reference) => [
        reference.family,
        reference.role,
        reference.memberPath,
        reference.memberRef,
      ]),
      [
        ["requirement", "landing", "landing.md", `requirements/${REQUIREMENT_ID}/landing.md`],
        [
          "requirement",
          "requirement",
          "requirement.md",
          `requirements/${REQUIREMENT_ID}/requirement.md`,
        ],
      ],
    );
    deepEqual(
      parseLedgerAuthorityMemberReference(JSON.parse(JSON.stringify(requirementReference))),
      requirementReference,
    );
    const resolved = await store.resolveMemberReferences([landingReference, requirementReference]);
    deepEqual(
      resolved.map((entry) => entry.bytes),
      [encodeUtf8(FIXTURE_LANDING_MARKDOWN), encodeUtf8(FIXTURE_REQUIREMENT_MARKDOWN)],
    );
    equal((await store.resolveMemberReference(requirementReference)).document.role, "requirement");

    await expectStoreError(
      () => parseLedgerAuthorityMemberReference({ ...requirementReference, family: "other" }),
      "input",
    );
    await expectStoreError(
      () =>
        parseLedgerAuthorityMemberReference({
          ...requirementReference,
          role: "goal-stage-decision",
        }),
      "input",
    );
    await expectStoreError(
      () =>
        parseLedgerAuthorityMemberReference({
          ...requirementReference,
          memberPath: "Record.json",
          memberRef: requirementReference.recordRef,
        }),
      "input",
    );
    await expectStoreError(
      () => store.resolveMemberReference({ ...requirementReference, role: "landing" }),
      "conflict",
    );

    const conflict = requirementRecord(REQUIREMENT_ID, "Conflicting title");
    await expectStoreError(() => store.publish(conflict, MEMBERS), "conflict");
    await expectStoreError(
      () => store.publish(record, requirementMembers(fixtureDocuments({ landing: "# 改动\n" }))),
      "member",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("a complete stage left by a dead writer is published by the same publish call, and its lock residue is retired", async () => {
  const { rootPath, root, store } = await fixture();
  try {
    const record = requirementRecord(REQUIREMENT_ID, "Recover staged authority");
    const publication = publicationPlan(record);
    await createDirectoryTreeCandidateDurably(
      root,
      publication.refs.stageRef,
      publication.files,
      CANDIDATE_OPTIONS,
    );
    const lockPath = path.join(rootPath, ...publication.refs.lockRef.split("/"));
    writeFileSync(
      lockPath,
      rootedExclusiveFileLockRecordTextForTest({
        tokenUuid: "99999999-9999-4999-8999-999999999999",
      }),
      { mode: 0o600 },
    );

    // 没有日志：同一个发布请求再发一次就是恢复（ADR-0031，5a 的 A 行）。
    const resumed = await store.publish(record, MEMBERS);
    equal(resumed.wroteAuthority, true);
    equal(resumed.loaded.recordDigest.length, 71);
    equal(existsSync(path.join(rootPath, ...publication.refs.stageRef.split("/"))), false);
    equal(existsSync(lockPath), false);
    equal(readdirSync(path.join(rootPath, "transactions")).length, 0);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("an incomplete stage is filled by the publish retry, which writes only the missing bytes", async () => {
  const { rootPath, root, store } = await fixture();
  try {
    const record = requirementRecord(REQUIREMENT_ID, "Resume staged authority");
    const publication = publicationPlan(record);
    await createDirectoryAtomically(root, parsePortableResourcePath(publication.refs.stageRef), {
      mode: 0o755,
    });
    await createFileCandidateDurably(
      root,
      parsePortableResourcePath(`${publication.refs.stageRef}/record.json`),
      encodeUtf8(renderLedgerAuthorityRecord(record)),
      { mode: 0o644 },
    );
    const recordNode = statSync(
      path.join(rootPath, ...publication.refs.stageRef.split("/"), "record.json"),
    ).ino;

    const resumed = await store.publish(record, MEMBERS);
    equal(resumed.wroteAuthority, true);
    equal(existsSync(path.join(rootPath, ...publication.refs.stageRef.split("/"))), false);
    equal(readdirSync(path.join(rootPath, "transactions")).length, 0);
    // 已经写好的那个成员原样随目录改名过去，没有被重写。
    equal(
      statSync(path.join(rootPath, ...publication.refs.finalRootRef.split("/"), "record.json")).ino,
      recordNode,
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("one record's pending stage does not block unrelated reads or publications", async () => {
  const { rootPath, root, store } = await fixture();
  try {
    const first = requirementRecord(REQUIREMENT_ID, "Committed record");
    await store.publish(first, MEMBERS);

    const pending = requirementRecord(OTHER_REQUIREMENT_ID, "Pending record");
    await createDirectoryAtomically(
      root,
      parsePortableResourcePath(publicationPlan(pending).refs.stageRef),
      { mode: 0o755 },
    );
    const unrelatedTarget = parsePortableResourcePath(
      `transactions/${UNRELATED_REQUIREMENT_ID}.lock`,
    );
    const intendedBytes = encodeUtf8("unrelated-intent");
    const address = issueDurableAtomicFileStageAddress(
      "create",
      unrelatedTarget,
      computeSha256Digest(intendedBytes),
      0o600,
    );
    const unrelatedStage = durableAtomicFileStageRefForTest(unrelatedTarget, address);
    try {
      await createFileCandidateDurably(root, unrelatedStage, encodeUtf8("partial"), {
        mode: 0o600,
      });
    } finally {
      releaseDurableAtomicFileStageAddress(address);
    }
    deepEqual((await store.loadRequirement(REQUIREMENT_ID)).record, first);

    const third = requirementRecord(THIRD_REQUIREMENT_ID, "Independent record");
    const published = await store.publish(third, MEMBERS);
    equal(published.wroteAuthority, true);
    deepEqual((await store.loadRequirement(REQUIREMENT_ID)).record, first);
    equal(existsSync(path.join(rootPath, ...unrelatedStage.split("/"))), true);
    equal(readdirSync(path.join(rootPath, "transactions")).length, 2);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("same record concurrent publication has one commit and one idempotent result", async () => {
  const { rootPath, root, store } = await fixture();
  try {
    const record = requirementRecord(REQUIREMENT_ID, "Concurrent authority");
    const results = await Promise.all([
      store.publish(record, MEMBERS),
      store.publish(record, MEMBERS),
    ]);
    deepEqual(results.map((result) => result.wroteAuthority).sort(), [false, true]);
    equal(readdirSync(path.join(rootPath, "transactions")).length, 0);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("a final that was already published is reused by the same publish call", async () => {
  const { rootPath, root, store } = await fixture();
  try {
    const record = requirementRecord(REQUIREMENT_ID, "Post-rename recovery");
    const publication = publicationPlan(record);
    const candidate = await createDirectoryTreeCandidateDurably(
      root,
      publication.refs.stageRef,
      publication.files,
      CANDIDATE_OPTIONS,
    );
    await publishDirectoryTreeCandidateDurably(root, candidate, publication.refs.finalRootRef);

    const reused = await store.publish(record, MEMBERS);
    equal(reused.wroteAuthority, false);
    equal(reused.loaded.record.requirementId, REQUIREMENT_ID);
    equal(readdirSync(path.join(rootPath, "transactions")).length, 0);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});
