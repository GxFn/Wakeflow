import {
  deepEqual,
  equal,
} from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  computeSha256Digest,
} from "../../../src/foundation/crypto/sha256.js";
import {
  durableAtomicFileStageRef,
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import {
  createFileCandidateDurably,
} from "../../../src/foundation/filesystem/durable-file-candidate.js";
import {
  RootedDirectory,
} from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  parseWakeflowDurableIdOfKind,
} from "../../../src/foundation/identity/wakeflow-durable-id.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  createConfirmationRecord,
  createRequirementRecord,
} from "../../../src/governance/ledger/ledger-authority-record.js";
import {
  createLedgerAuthorityMemberReference,
  LedgerAuthorityStore,
  LedgerAuthorityStoreError,
  type LedgerAuthorityStoreErrorReason,
} from "../../../src/governance/ledger/ledger-authority-store.js";
import {
  ledgerRecordPublicationRef,
} from "../../../src/governance/ledger/ledger-authority-paths.js";
import {
  createLedgerRecordPublication,
  renderLedgerRecordPublication,
} from "../../../src/governance/ledger/ledger-record-publication.js";

const REQUIREMENT_ID = parseWakeflowDurableIdOfKind(
  "requirement_11111111-1111-4111-8111-111111111111",
  "requirement",
);
const CONFIRMATION_ID = parseWakeflowDurableIdOfKind(
  "confirmation_22222222-2222-4222-8222-222222222222",
  "confirmation",
);
const PROGRAM_ID = parseWakeflowDurableIdOfKind(
  "program_33333333-3333-4333-8333-333333333333",
  "program",
);
const DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_44444444-4444-4444-8444-444444444444",
  "demand",
);
const RECORDED_AT = parseUtcInstant("2026-08-26T08:00:00.000Z");
const REQUIREMENT_BYTES = encodeUtf8("# Event Sourcing requirement\n");
const CONFIRMATION_BYTES = encodeUtf8("# Confirmed\n");

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
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-ledger-rh2-"));
  const root = await RootedDirectory.open(rootPath);
  const store = new LedgerAuthorityStore(root);
  await store.initialize({ freshLedger: true });
  return { rootPath, root, store };
}

test("LedgerAuthorityStore publishes, reloads, and idempotently reuses exact authority", async () => {
  const { rootPath, root, store } = await fixture();
  try {
    const record = createRequirementRecord({
      requirementId: REQUIREMENT_ID,
      programId: PROGRAM_ID,
      title: "Demand Event Sourcing",
      documents: [{
        role: "requirement-design",
        path: "design/requirement.md",
        mediaType: "text/markdown",
        digest: computeSha256Digest(REQUIREMENT_BYTES),
      }],
    }, { clock: () => RECORDED_AT });

    const created = await store.publish(record, [{
      path: "design/requirement.md",
      bytes: REQUIREMENT_BYTES,
    }]);
    equal(created.created, true);
    equal(created.loaded.record.requirementId, REQUIREMENT_ID);
    equal(
      created.loaded.recordRef,
      `requirements/${REQUIREMENT_ID}/record.json`,
    );
    equal(created.loaded.documents.length, 1);

    const reused = await store.publish(record, [{
      path: "design/requirement.md",
      bytes: REQUIREMENT_BYTES,
    }]);
    equal(reused.created, false);
    equal(reused.loaded.recordDigest, created.loaded.recordDigest);

    const loaded = await store.loadRequirement(REQUIREMENT_ID);
    deepEqual(loaded.record, record);
    equal(
      readdirSync(path.join(rootPath, "transactions")).length,
      0,
    );
    equal(existsSync(path.join(
      rootPath,
      "requirements",
      REQUIREMENT_ID,
      "design/requirement.md",
    )), true);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("member references bind exact immutable bytes and reject conflicting records", async () => {
  const { rootPath, root, store } = await fixture();
  try {
    const record = createConfirmationRecord({
      confirmationId: CONFIRMATION_ID,
      programId: PROGRAM_ID,
      demandId: DEMAND_ID,
      title: "Event Sourcing confirmed",
      documents: [{
        role: "user-confirmation",
        path: "decisions/confirmation.md",
        mediaType: "text/markdown",
        digest: computeSha256Digest(CONFIRMATION_BYTES),
      }],
    }, { clock: () => RECORDED_AT });
    const published = await store.publish(record, [{
      path: "decisions/confirmation.md",
      bytes: CONFIRMATION_BYTES,
    }]);
    const reference = createLedgerAuthorityMemberReference(
      published.loaded,
      "decisions/confirmation.md",
    );
    const resolved = await store.resolveMemberReference(reference);
    deepEqual(resolved.bytes, CONFIRMATION_BYTES);
    equal(resolved.reference.recordDigest, published.loaded.recordDigest);
    equal(resolved.reference.memberDigest, computeSha256Digest(CONFIRMATION_BYTES));
    equal(resolved.loaded.recordDigest, published.loaded.recordDigest);
    equal(resolved.document.path, "decisions/confirmation.md");
    const [batched] = await store.resolveMemberReferences([reference]);
    equal(batched?.loaded.recordDigest, published.loaded.recordDigest);
    deepEqual(batched?.bytes, CONFIRMATION_BYTES);

    const conflict = createConfirmationRecord({
      confirmationId: CONFIRMATION_ID,
      programId: PROGRAM_ID,
      demandId: DEMAND_ID,
      title: "Conflicting confirmation",
      documents: record.documents,
    }, { clock: () => RECORDED_AT });
    await expectStoreError(
      () => store.publish(conflict, [{
        path: "decisions/confirmation.md",
        bytes: CONFIRMATION_BYTES,
      }]),
      "conflict",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("self-contained Ledger publication journal recovers without caller member bytes", async () => {
  const { rootPath, root, store } = await fixture();
  try {
    const record = createRequirementRecord({
      requirementId: REQUIREMENT_ID,
      programId: PROGRAM_ID,
      title: "Recover Ledger authority",
      documents: [{
        role: "requirement-design",
        path: "design/requirement.md",
        mediaType: "text/markdown",
        digest: computeSha256Digest(REQUIREMENT_BYTES),
      }],
    }, { clock: () => RECORDED_AT });
    const members = [{
      path: "design/requirement.md",
      bytes: REQUIREMENT_BYTES,
    }] as const;
    const publication = createLedgerRecordPublication(record, members);
    const ref = ledgerRecordPublicationRef(record);
    const journalPath = path.join(rootPath, ...ref.split("/"));
    writeFileSync(journalPath, renderLedgerRecordPublication(publication), {
      mode: 0o600,
    });
    chmodSync(journalPath, 0o600);
    const lockPath = path.join(rootPath, "ledger-authority.lock");
    writeFileSync(lockPath, `${JSON.stringify({
      createdAt: "2026-08-26T08:00:00.000Z",
      kind: "WakeflowExclusiveFileLock",
      pid: 2_147_483_647,
      threadId: 0,
      token: "2147483647-0-99999999-9999-4999-8999-999999999999",
      version: 1,
    }, null, 2)}\n`, { mode: 0o600 });

    const recovered = await store.recoverPendingPublication();
    equal(recovered.created, true);
    equal(existsSync(journalPath), false);
    equal(existsSync(lockPath), false);
    equal(recovered.loaded.recordDigest, publication.recordDigest);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("Ledger recovery 回滚 canonical journal 之前的 inactive partial stage", async () => {
  const { rootPath, root, store } = await fixture();
  try {
    const record = createRequirementRecord({
      requirementId: REQUIREMENT_ID,
      programId: PROGRAM_ID,
      title: "Partial publication",
      documents: [{
        role: "requirement-design",
        path: "design/requirement.md",
        mediaType: "text/markdown",
        digest: computeSha256Digest(REQUIREMENT_BYTES),
      }],
    }, { clock: () => RECORDED_AT });
    const publication = createLedgerRecordPublication(record, [{
      path: "design/requirement.md",
      bytes: REQUIREMENT_BYTES,
    }]);
    const targetRef = ledgerRecordPublicationRef(record);
    const intendedBytes = encodeUtf8(renderLedgerRecordPublication(publication));
    const address = issueDurableAtomicFileStageAddress(
      "create",
      targetRef,
      computeSha256Digest(intendedBytes),
      0o600,
    );
    const stageRef = durableAtomicFileStageRef(targetRef, address);
    try {
      await createFileCandidateDurably(root, stageRef, encodeUtf8("partial"), {
        mode: 0o600,
      });
    } finally {
      releaseDurableAtomicFileStageAddress(address);
    }

    await expectStoreError(() => store.recoverPendingPublication(), "not-found");
    equal(readdirSync(path.join(rootPath, "transactions")).length, 0);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});
