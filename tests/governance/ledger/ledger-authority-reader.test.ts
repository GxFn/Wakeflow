import { deepEqual, equal } from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { materializeLedgerAuthorityLayout } from "../../../src/governance/ledger/ledger-authority-layout.js";
import {
  createLedgerAuthorityMemberReference,
  loadLedgerAuthorityRecord,
  parseLedgerAuthorityMemberReference,
  resolveLoadedLedgerAuthorityMemberReference,
} from "../../../src/governance/ledger/ledger-authority-reader.js";
import {
  computeLedgerAuthorityRecordDigest,
  createRequirementRecord,
  type RequirementRecord,
  renderLedgerAuthorityRecord,
} from "../../../src/governance/ledger/ledger-authority-record.js";
import {
  LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES,
  LEDGER_DURABLE_DIRECTORY_MODE,
  LEDGER_DURABLE_FILE_MODE,
} from "../../../src/governance/ledger/ledger-authority-storage-policy.js";
import {
  LedgerAuthorityStoreError,
  type LedgerAuthorityStoreErrorReason,
} from "../../../src/governance/ledger/ledger-authority-store-contract.js";
import { publishLedgerAuthorityRecord } from "../../../src/governance/ledger/ledger-record-publisher.js";
import { disposableRoot } from "../../support/temp-root.js";
import { writeTextFile } from "../../support/write-tree.js";
import {
  FIXTURE_LANDING_MARKDOWN,
  FIXTURE_PROGRAM_ID,
  FIXTURE_RECORDED_AT,
  FIXTURE_REQUIREMENT_ID,
  FIXTURE_REQUIREMENT_MARKDOWN,
  requirementMembers,
  requirementRecordDraft,
} from "./requirement-package.fixture.js";

/** 直接覆盖不可变权威目录树读取器与成员引用编解码器。 */

const OTHER_REQUIREMENT_ID = "requirement_22222222-2222-4222-8222-222222222222";
const MEMBERS = requirementMembers();
const RECORD_ROOT_REF = `requirements/${FIXTURE_REQUIREMENT_ID}`;

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

function requirementRecord(
  title: string,
  requirementId: `requirement_${string}` = FIXTURE_REQUIREMENT_ID,
): Readonly<RequirementRecord> {
  return createRequirementRecord(requirementRecordDraft({ requirementId, title }), {
    clock: () => FIXTURE_RECORDED_AT,
  });
}

/** 经真实发布器提交一份需求包，再由读取器独立回读。 */
async function publishedLedger(t: TestContext) {
  const rootPath = disposableRoot(t, "wakeflow-ledger-reader-");
  const root = await RootedDirectory.open(rootPath);
  t.after(() => root.close());
  await materializeLedgerAuthorityLayout(root);
  const record = requirementRecord("示例需求");
  await publishLedgerAuthorityRecord(root, record, MEMBERS, undefined);
  return {
    rootPath,
    root,
    record,
    finalPath: path.join(rootPath, "requirements", FIXTURE_REQUIREMENT_ID),
  };
}

test("loads a committed record tree with exact sources and derives member references", async (t) => {
  const { root, record } = await publishedLedger(t);
  const loaded = await loadLedgerAuthorityRecord(root, record.requirementId, undefined);
  equal(loaded.family, "requirement");
  deepEqual(loaded.record, record);
  equal(loaded.recordRootRef, RECORD_ROOT_REF);
  equal(loaded.recordRef, `${RECORD_ROOT_REF}/record.json`);
  equal(loaded.recordDigest, computeLedgerAuthorityRecordDigest(record));
  equal(loaded.recordSource.resourcePath, loaded.recordRef);
  equal(loaded.recordSource.node.kind, "file");
  equal(loaded.recordSource.node.permissionBits, LEDGER_DURABLE_FILE_MODE);
  equal(
    loaded.recordSource.digest,
    computeSha256Digest(encodeUtf8(renderLedgerAuthorityRecord(record))),
  );
  deepEqual(
    loaded.documents.map((document) => [
      document.role,
      document.path,
      document.memberRef,
      document.source.resourcePath,
      document.source.digest === document.digest,
      document.source.node.permissionBits,
    ]),
    [
      [
        "landing",
        "landing.md",
        `${RECORD_ROOT_REF}/landing.md`,
        `${RECORD_ROOT_REF}/landing.md`,
        true,
        0o644,
      ],
      [
        "requirement",
        "requirement.md",
        `${RECORD_ROOT_REF}/requirement.md`,
        `${RECORD_ROOT_REF}/requirement.md`,
        true,
        0o644,
      ],
    ],
  );
  equal(Object.isFrozen(loaded), true);
  equal(Object.isFrozen(loaded.documents), true);

  const reference = createLedgerAuthorityMemberReference(loaded, "requirement.md");
  deepEqual(reference, {
    artifactKind: "wakeflow-ledger-authority-member-reference",
    schemaVersion: 1,
    family: "requirement",
    recordId: FIXTURE_REQUIREMENT_ID,
    recordRef: loaded.recordRef,
    recordDigest: loaded.recordDigest,
    memberPath: "requirement.md",
    memberRef: `${RECORD_ROOT_REF}/requirement.md`,
    memberDigest: computeSha256Digest(encodeUtf8(FIXTURE_REQUIREMENT_MARKDOWN)),
    role: "requirement",
    mediaType: "text/markdown",
  });
  equal(Object.isFrozen(reference), true);
  deepEqual(parseLedgerAuthorityMemberReference(JSON.parse(JSON.stringify(reference))), reference);

  const resolved = await resolveLoadedLedgerAuthorityMemberReference(
    root,
    loaded,
    reference,
    undefined,
  );
  deepEqual(resolved.bytes, encodeUtf8(FIXTURE_REQUIREMENT_MARKDOWN));
  equal(resolved.reference, reference);
  equal(resolved.loaded, loaded);
  equal(resolved.document, loaded.documents[1]);
  equal(resolved.source.resourcePath, reference.memberRef);
  equal(resolved.source.digest, reference.memberDigest);
  equal(resolved.source.node.inodeId, loaded.documents[1]?.source.node.inodeId);
  const landing = await resolveLoadedLedgerAuthorityMemberReference(
    root,
    loaded,
    createLedgerAuthorityMemberReference(loaded, "landing.md"),
    undefined,
  );
  deepEqual(landing.bytes, encodeUtf8(FIXTURE_LANDING_MARKDOWN));
  equal(landing.document.role, "landing");
});

test("member reference parsing enforces the schema and the ref relations", async (t) => {
  const { root, record } = await publishedLedger(t);
  const loaded = await loadLedgerAuthorityRecord(root, record.requirementId, undefined);
  const reference = createLedgerAuthorityMemberReference(loaded, "landing.md");
  const wire = JSON.parse(JSON.stringify(reference)) as Record<string, unknown>;
  const schemaViolations: readonly unknown[] = [
    undefined,
    () => undefined,
    "text",
    [],
    { ...wire, artifactKind: "wakeflow-requirement-record" },
    { ...wire, schemaVersion: 2 },
    { ...wire, family: "other" },
    { ...wire, role: "goal-stage-decision" },
    { ...wire, mediaType: "Text/Markdown" },
    { ...wire, recordId: FIXTURE_PROGRAM_ID },
    { ...wire, recordDigest: "sha256:short" },
    { ...wire, memberPath: "../landing.md", memberRef: `${RECORD_ROOT_REF}/../landing.md` },
    { ...wire, extra: true },
    Object.fromEntries(Object.entries(wire).filter(([key]) => key !== "role")),
  ];
  for (const value of schemaViolations) {
    await expectStoreError(() => parseLedgerAuthorityMemberReference(value), "input");
  }
  await expectStoreError(
    () =>
      parseLedgerAuthorityMemberReference({
        ...wire,
        memberPath: "record.json",
        memberRef: wire.recordRef,
      }),
    "input",
    "$/memberPath",
  );
  await expectStoreError(
    () =>
      parseLedgerAuthorityMemberReference({
        ...wire,
        memberPath: "Record.JSON",
        memberRef: `${RECORD_ROOT_REF}/Record.JSON`,
      }),
    "input",
    "$/memberPath",
  );
  await expectStoreError(
    () =>
      parseLedgerAuthorityMemberReference({
        ...wire,
        memberPath: "record.json/landing.md",
        memberRef: `${RECORD_ROOT_REF}/record.json/landing.md`,
      }),
    "input",
    "$/memberPath",
  );
  await expectStoreError(
    () =>
      parseLedgerAuthorityMemberReference({
        ...wire,
        recordRef: `requirements/${OTHER_REQUIREMENT_ID}/record.json`,
      }),
    "input",
    "$reference",
  );
  await expectStoreError(
    () =>
      parseLedgerAuthorityMemberReference({
        ...wire,
        memberRef: `${RECORD_ROOT_REF}/requirement.md`,
      }),
    "input",
    "$reference",
  );
  await expectStoreError(
    () => parseLedgerAuthorityMemberReference({ ...wire, recordId: OTHER_REQUIREMENT_ID }),
    "input",
    "$reference",
  );

  await expectStoreError(
    () => createLedgerAuthorityMemberReference(loaded, "notes.md"),
    "input",
    "$memberPath",
  );
  await expectStoreError(
    () => createLedgerAuthorityMemberReference(loaded, "record.json"),
    "input",
    "$memberPath",
  );
  await expectStoreError(
    () => createLedgerAuthorityMemberReference(loaded, "../landing.md"),
    "input",
    "$memberPath",
  );
  await expectStoreError(
    () => createLedgerAuthorityMemberReference(loaded, 42),
    "input",
    "$memberPath",
  );
});

test("member resolution requires an exact match with the loaded record and the bytes on disk", async (t) => {
  const { rootPath, root, record } = await publishedLedger(t);
  const loaded = await loadLedgerAuthorityRecord(root, record.requirementId, undefined);
  const reference = createLedgerAuthorityMemberReference(loaded, "landing.md");
  const other = createLedgerAuthorityMemberReference(loaded, "requirement.md");
  const drifts = [
    { ...reference, role: "requirement" as const },
    { ...reference, mediaType: "text/plain" },
    { ...reference, recordDigest: other.memberDigest },
    { ...reference, memberDigest: other.memberDigest },
    { ...reference, memberRef: other.memberRef },
    { ...reference, memberPath: other.memberPath },
    { ...reference, recordRef: other.memberRef },
  ];
  for (const drift of drifts) {
    await expectStoreError(
      () => resolveLoadedLedgerAuthorityMemberReference(root, loaded, drift, undefined),
      "conflict",
      "$reference",
    );
  }
  await expectStoreError(
    () => resolveLoadedLedgerAuthorityMemberReference(root, loaded, reference, AbortSignal.abort()),
    "aborted",
    "$signal",
  );

  // Identical bytes in a new node: the loaded snapshot no longer proves the file it read.
  const landingPath = path.join(rootPath, ...reference.memberRef.split("/"));
  rmSync(landingPath);
  writeTextFile(rootPath, reference.memberRef, FIXTURE_LANDING_MARKDOWN, LEDGER_DURABLE_FILE_MODE);
  chmodSync(landingPath, LEDGER_DURABLE_FILE_MODE);
  await expectStoreError(
    () => resolveLoadedLedgerAuthorityMemberReference(root, loaded, reference, undefined),
    "conflict",
    "$reference",
  );
  const reloaded = await loadLedgerAuthorityRecord(root, record.requirementId, undefined);
  const resolved = await resolveLoadedLedgerAuthorityMemberReference(
    root,
    reloaded,
    reference,
    undefined,
  );
  deepEqual(resolved.bytes, encodeUtf8(FIXTURE_LANDING_MARKDOWN));
});

test("strict tree loading fails closed on every physical drift", async (t) => {
  const { root, record, finalPath } = await publishedLedger(t);
  const recordPath = path.join(finalPath, "record.json");
  const landingPath = path.join(finalPath, "landing.md");
  const recordText = readFileSync(recordPath, "utf8");
  const load = (signal?: AbortSignal) =>
    loadLedgerAuthorityRecord(root, record.requirementId, signal);

  await expectStoreError(
    () =>
      loadLedgerAuthorityRecord(
        root,
        requirementRecord("Other", OTHER_REQUIREMENT_ID).requirementId,
        undefined,
      ),
    "not-found",
    "$record",
  );
  await expectStoreError(() => load(AbortSignal.abort()), "aborted", "$signal");

  writeFileSync(path.join(finalPath, "extra.md"), "# extra\n", { mode: LEDGER_DURABLE_FILE_MODE });
  await expectStoreError(() => load(), "conflict", "$recordRoot");
  rmSync(path.join(finalPath, "extra.md"));

  chmodSync(recordPath, 0o600);
  await expectStoreError(() => load(), "node-policy", "$recordRoot");
  chmodSync(recordPath, LEDGER_DURABLE_FILE_MODE);
  chmodSync(finalPath, 0o700);
  await expectStoreError(() => load(), "node-policy", "$recordRoot");
  chmodSync(finalPath, LEDGER_DURABLE_DIRECTORY_MODE);

  writeFileSync(recordPath, "{ not json\n");
  await expectStoreError(() => load(), "record", "$record");
  writeFileSync(recordPath, `${recordText}\n`);
  await expectStoreError(() => load(), "record", "$record");
  writeFileSync(
    recordPath,
    renderLedgerAuthorityRecord(requirementRecord("Other", OTHER_REQUIREMENT_ID)),
  );
  await expectStoreError(() => load(), "conflict", "$record");
  writeFileSync(recordPath, recordText);

  writeFileSync(landingPath, "# 改动\n");
  await expectStoreError(() => load(), "member", "$record/documents");
  writeFileSync(landingPath, FIXTURE_LANDING_MARKDOWN);
  deepEqual((await load()).record, record);

  rmSync(recordPath);
  await expectStoreError(() => load(), "conflict", "$record/record.json");
  writeFileSync(recordPath, recordText, { mode: LEDGER_DURABLE_FILE_MODE });
  chmodSync(recordPath, LEDGER_DURABLE_FILE_MODE);

  rmSync(landingPath);
  mkdirSync(landingPath, { mode: LEDGER_DURABLE_DIRECTORY_MODE });
  await expectStoreError(() => load(), "conflict", "$recordRoot");
  rmSync(landingPath, { recursive: true });
  // A symbolic link is observed as a non-file entry, so the manifest closure check rejects it.
  symlinkSync("requirement.md", landingPath);
  await expectStoreError(() => load(), "conflict", "$recordRoot");
  rmSync(landingPath);
  writeFileSync(landingPath, FIXTURE_LANDING_MARKDOWN, { mode: LEDGER_DURABLE_FILE_MODE });
  chmodSync(landingPath, LEDGER_DURABLE_FILE_MODE);
  deepEqual((await load()).record, record);

  writeFileSync(
    path.join(finalPath, "huge.bin"),
    Buffer.alloc(LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES + 1),
    {
      mode: LEDGER_DURABLE_FILE_MODE,
    },
  );
  await expectStoreError(() => load(), "capacity", "$record");
  rmSync(path.join(finalPath, "huge.bin"));

  rmSync(finalPath, { recursive: true });
  writeFileSync(finalPath, "not a directory");
  await expectStoreError(() => load(), "conflict", "$record");
});
