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
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import { durableAtomicFileStageRefForTest } from "../../foundation/filesystem/durable-atomic-file-test-support.js";
import {
  createDirectoryTreeCandidateDurably,
  planDirectoryTreeCandidate,
} from "../../../src/foundation/filesystem/durable-directory-tree-candidate.js";
import {
  createDirectoryAtomically,
} from "../../../src/foundation/filesystem/durable-directory-materialization.js";
import {
  publishDirectoryTreeCandidateDurably,
} from "../../../src/foundation/filesystem/durable-directory-tree-publication.js";
import {
  createFileCandidateDurably,
} from "../../../src/foundation/filesystem/durable-file-candidate.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { rootedExclusiveFileLockRecordTextForTest } from "../../foundation/filesystem/rooted-exclusive-file-lock-test-support.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  createConfirmationRecord,
  createRequirementRecord,
  renderLedgerAuthorityRecord,
  type RequirementRecord,
} from "../../../src/governance/ledger/ledger-authority-record.js";
import {
  createLedgerAuthorityMemberReference,
  LedgerAuthorityStore,
  LedgerAuthorityStoreError,
  parseLedgerAuthorityMemberReference,
  type LedgerAuthorityStoreErrorReason,
} from "../../../src/governance/ledger/ledger-authority-store.js";
import {
  createLedgerRecordPublicationIntent,
  renderLedgerRecordPublicationIntent,
} from "../../../src/governance/ledger/ledger-record-publication-intent.js";

const REQUIREMENT_ID = parseWakeflowDurableIdOfKind(
  "requirement_11111111-1111-4111-8111-111111111111",
  "requirement",
);
const OTHER_REQUIREMENT_ID = parseWakeflowDurableIdOfKind(
  "requirement_22222222-2222-4222-8222-222222222222",
  "requirement",
);
const THIRD_REQUIREMENT_ID = parseWakeflowDurableIdOfKind(
  "requirement_33333333-3333-4333-8333-333333333333",
  "requirement",
);
const CONFIRMATION_ID = parseWakeflowDurableIdOfKind(
  "confirmation_44444444-4444-4444-8444-444444444444",
  "confirmation",
);
const PROGRAM_ID = parseWakeflowDurableIdOfKind(
  "program_55555555-5555-4555-8555-555555555555",
  "program",
);
const DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_66666666-6666-4666-8666-666666666666",
  "demand",
);
const RECORDED_AT = parseUtcInstant("2026-08-27T08:00:00.000Z");
const REQUIREMENT_BYTES = encodeUtf8("# Event Sourcing requirement\n");
const CONFIRMATION_BYTES = encodeUtf8("# Confirmed\n");

const CANDIDATE_OPTIONS = {
  directoryMode: 0o755,
  maximumDepth: 64,
  maximumEntries: 256,
  maximumFileBytes: 4 * 1024 * 1024,
  maximumFiles: 33,
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
  requirementId: typeof REQUIREMENT_ID,
  title: string,
  bytes = REQUIREMENT_BYTES,
): Readonly<RequirementRecord> {
  return createRequirementRecord({
    requirementId,
    programId: PROGRAM_ID,
    title,
    documents: [{
      role: "requirement-design",
      path: "design/requirement.md",
      mediaType: "text/markdown",
      digest: computeSha256Digest(bytes),
    }],
  }, { clock: () => RECORDED_AT });
}

function publicationPlan(
  record: Readonly<RequirementRecord>,
  bytes = REQUIREMENT_BYTES,
) {
  const files = [{
    path: "design/requirement.md",
    bytes,
    mode: 0o644,
  }, {
    path: "record.json",
    bytes: encodeUtf8(renderLedgerAuthorityRecord(record)),
    mode: 0o644,
  }] as const;
  const plan = planDirectoryTreeCandidate(files, CANDIDATE_OPTIONS);
  return {
    files,
    plan,
    intent: createLedgerRecordPublicationIntent(record, plan),
  };
}

function writeIntent(
  rootPath: string,
  intent: ReturnType<typeof createLedgerRecordPublicationIntent>,
): void {
  const target = path.join(rootPath, ...intent.intentRef.split("/"));
  writeFileSync(target, renderLedgerRecordPublicationIntent(intent), {
    mode: 0o600,
  });
  chmodSync(target, 0o600);
}

test("Ledger publishes one complete durable tree and idempotently reuses it", async () => {
  const { rootPath, root, store } = await fixture();
  try {
    equal(statSync(path.join(rootPath, "requirements")).mode & 0o777, 0o755);
    equal(statSync(path.join(rootPath, "confirmations")).mode & 0o777, 0o755);
    equal(statSync(path.join(rootPath, "transactions")).mode & 0o777, 0o700);

    const record = requirementRecord(REQUIREMENT_ID, "Demand Event Sourcing");
    const created = await store.publish(record, [{
      path: "design/requirement.md",
      bytes: REQUIREMENT_BYTES,
    }]);
    equal(created.wroteAuthority, true);
    equal(created.loaded.record.requirementId, REQUIREMENT_ID);
    equal(created.loaded.recordRef, `requirements/${REQUIREMENT_ID}/record.json`);
    equal(
      statSync(path.join(rootPath, "requirements", REQUIREMENT_ID)).mode & 0o777,
      0o755,
    );
    equal(
      statSync(path.join(rootPath, "requirements", REQUIREMENT_ID, "record.json")).mode & 0o777,
      0o644,
    );
    equal(readdirSync(path.join(rootPath, "transactions")).length, 0);

    const reused = await store.publish(record, [{
      path: "design/requirement.md",
      bytes: REQUIREMENT_BYTES,
    }]);
    equal(reused.wroteAuthority, false);
    equal(reused.loaded.recordDigest, created.loaded.recordDigest);
    deepEqual((await store.loadRequirement(REQUIREMENT_ID)).record, record);

    const reference = createLedgerAuthorityMemberReference(
      created.loaded,
      "design/requirement.md",
    );
    deepEqual((await store.resolveMemberReference(reference)).bytes, REQUIREMENT_BYTES);
    await expectStoreError(
      () => parseLedgerAuthorityMemberReference({
        ...reference,
        family: "confirmation",
      }),
      "input",
    );
    await expectStoreError(
      () => parseLedgerAuthorityMemberReference({
        ...reference,
        role: "goal-stage-decision",
      }),
      "input",
    );
    await expectStoreError(
      () => parseLedgerAuthorityMemberReference({
        ...reference,
        memberPath: "Record.json",
        memberRef: reference.recordRef,
      }),
      "input",
    );

    const conflict = requirementRecord(REQUIREMENT_ID, "Conflicting title");
    await expectStoreError(
      () => store.publish(conflict, [{
        path: "design/requirement.md",
        bytes: REQUIREMENT_BYTES,
      }]),
      "conflict",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("complete private stage recovers from compact intent without member payload", async () => {
  const { rootPath, root, store } = await fixture();
  try {
    const record = requirementRecord(REQUIREMENT_ID, "Recover staged authority");
    const publication = publicationPlan(record);
    writeIntent(rootPath, publication.intent);
    await createDirectoryTreeCandidateDurably(
      root,
      publication.intent.stageRef,
      publication.files,
      CANDIDATE_OPTIONS,
    );
    const lockPath = path.join(rootPath, ...publication.intent.lockRef.split("/"));
    writeFileSync(lockPath, rootedExclusiveFileLockRecordTextForTest({
      tokenUuid: "99999999-9999-4999-8999-999999999999",
    }), { mode: 0o600 });

    const recovered = await store.recoverRecordPublication(REQUIREMENT_ID);
    equal(recovered.wroteAuthority, true);
    equal(recovered.loaded.recordDigest.length, 71);
    equal(existsSync(path.join(rootPath, ...publication.intent.stageRef.split("/"))), false);
    equal(existsSync(path.join(rootPath, ...publication.intent.intentRef.split("/"))), false);
    equal(existsSync(lockPath), false);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("recovery without an exact intent preserves an inactive lock residue", async () => {
  const { rootPath, root, store } = await fixture();
  try {
    const record = requirementRecord(REQUIREMENT_ID, "Missing recovery intent");
    const lockRef = publicationPlan(record).intent.lockRef;
    const lockPath = path.join(rootPath, ...lockRef.split("/"));
    writeFileSync(lockPath, rootedExclusiveFileLockRecordTextForTest({
      tokenUuid: "77777777-7777-4777-8777-777777777777",
    }), { mode: 0o600 });

    await expectStoreError(
      () => store.recoverRecordPublication(REQUIREMENT_ID),
      "not-found",
    );
    equal(existsSync(lockPath), true);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("incomplete stage requests exact input and publish retry fills only missing bytes", async () => {
  const { rootPath, root, store } = await fixture();
  try {
    const record = requirementRecord(REQUIREMENT_ID, "Resume staged authority");
    const publication = publicationPlan(record);
    writeIntent(rootPath, publication.intent);
    await createDirectoryAtomically(
      root,
      parsePortableResourcePath(publication.intent.stageRef),
      { mode: 0o755 },
    );
    await createFileCandidateDurably(
      root,
      parsePortableResourcePath(`${publication.intent.stageRef}/record.json`),
      encodeUtf8(renderLedgerAuthorityRecord(record)),
      { mode: 0o644 },
    );

    await expectStoreError(
      () => store.recoverRecordPublication(REQUIREMENT_ID),
      "recovery-input-required",
    );
    equal(existsSync(path.join(rootPath, ...publication.intent.stageRef.split("/"))), true);

    const resumed = await store.publish(record, [{
      path: "design/requirement.md",
      bytes: REQUIREMENT_BYTES,
    }]);
    equal(resumed.wroteAuthority, true);
    equal(existsSync(path.join(rootPath, ...publication.intent.stageRef.split("/"))), false);
    equal(readdirSync(path.join(rootPath, "transactions")).length, 0);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("one pending record intent does not block unrelated reads or publications", async () => {
  const { rootPath, root, store } = await fixture();
  try {
    const first = requirementRecord(REQUIREMENT_ID, "Committed record");
    await store.publish(first, [{
      path: "design/requirement.md",
      bytes: REQUIREMENT_BYTES,
    }]);

    const pending = requirementRecord(OTHER_REQUIREMENT_ID, "Pending record");
    writeIntent(rootPath, publicationPlan(pending).intent);
    const unrelatedTarget = parsePortableResourcePath(
      `transactions/${CONFIRMATION_ID}.intent.json`,
    );
    const intendedBytes = encodeUtf8("unrelated-intent");
    const address = issueDurableAtomicFileStageAddress(
      "create",
      unrelatedTarget,
      computeSha256Digest(intendedBytes),
      0o600,
    );
    const unrelatedStage = durableAtomicFileStageRefForTest(
      unrelatedTarget,
      address,
    );
    try {
      await createFileCandidateDurably(
        root,
        unrelatedStage,
        encodeUtf8("partial"),
        { mode: 0o600 },
      );
    } finally {
      releaseDurableAtomicFileStageAddress(address);
    }
    deepEqual((await store.loadRequirement(REQUIREMENT_ID)).record, first);

    const third = requirementRecord(THIRD_REQUIREMENT_ID, "Independent record");
    const published = await store.publish(third, [{
      path: "design/requirement.md",
      bytes: REQUIREMENT_BYTES,
    }]);
    equal(published.wroteAuthority, true);
    deepEqual((await store.loadRequirement(REQUIREMENT_ID)).record, first);
    equal(existsSync(path.join(rootPath, ...unrelatedStage.split("/"))), true);
    equal(readdirSync(path.join(rootPath, "transactions")).length, 2);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("confirmation member references remain exact under the staged store", async () => {
  const { rootPath, root, store } = await fixture();
  try {
    const record = createConfirmationRecord({
      confirmationId: CONFIRMATION_ID,
      programId: PROGRAM_ID,
      demandId: DEMAND_ID,
      title: "Confirmed staged publication",
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
    const [resolved] = await store.resolveMemberReferences([reference]);
    deepEqual(resolved?.bytes, CONFIRMATION_BYTES);
    equal(
      statSync(path.join(rootPath, "confirmations", CONFIRMATION_ID)).mode & 0o777,
      0o755,
    );
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
      store.publish(record, [{
        path: "design/requirement.md",
        bytes: REQUIREMENT_BYTES,
      }]),
      store.publish(record, [{
        path: "design/requirement.md",
        bytes: REQUIREMENT_BYTES,
      }]),
    ]);
    deepEqual(
      results.map((result) => result.wroteAuthority).sort(),
      [false, true],
    );
    equal(readdirSync(path.join(rootPath, "transactions")).length, 0);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("published final with remaining exact intent settles forward", async () => {
  const { rootPath, root, store } = await fixture();
  try {
    const record = requirementRecord(REQUIREMENT_ID, "Post-rename recovery");
    const publication = publicationPlan(record);
    writeIntent(rootPath, publication.intent);
    const candidate = await createDirectoryTreeCandidateDurably(
      root,
      publication.intent.stageRef,
      publication.files,
      CANDIDATE_OPTIONS,
    );
    await publishDirectoryTreeCandidateDurably(
      root,
      candidate,
      publication.intent.finalRootRef,
    );

    const recovered = await store.recoverRecordPublication(REQUIREMENT_ID);
    equal(recovered.wroteAuthority, false);
    equal(recovered.loaded.record.artifactKind, "wakeflow-requirement-record");
    if (recovered.loaded.record.artifactKind !== "wakeflow-requirement-record") {
      throw new Error("Expected recovered requirement record.");
    }
    equal(recovered.loaded.record.requirementId, REQUIREMENT_ID);
    equal(existsSync(path.join(rootPath, ...publication.intent.intentRef.split("/"))), false);
    equal(readdirSync(path.join(rootPath, "transactions")).length, 0);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});
