import {
  equal,
  match,
} from "node:assert/strict";
import { test } from "node:test";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  planDirectoryTreeCandidate,
  planDirectoryTreeCandidateFromFileDescriptors,
} from "../../../src/foundation/filesystem/durable-directory-tree-candidate.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { parseByteCount } from "../../../src/foundation/numeric/byte-count.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  createRequirementRecord,
  renderLedgerAuthorityRecord,
} from "../../../src/governance/ledger/ledger-authority-record.js";
import {
  ledgerRecordPublicationIntentRef,
  ledgerRecordPublicationLockRef,
  ledgerRecordPublicationStageRef,
} from "../../../src/governance/ledger/ledger-authority-paths.js";
import {
  createLedgerRecordPublicationIntent,
  parseLedgerRecordPublicationIntentDocument,
  renderLedgerRecordPublicationIntent,
  LedgerRecordPublicationIntentError,
} from "../../../src/governance/ledger/ledger-record-publication-intent.js";

const REQUIREMENT_ID = parseWakeflowDurableIdOfKind(
  "requirement_11111111-1111-4111-8111-111111111111",
  "requirement",
);
const PROGRAM_ID = parseWakeflowDurableIdOfKind(
  "program_22222222-2222-4222-8222-222222222222",
  "program",
);
const RECORDED_AT = parseUtcInstant("2026-08-27T08:00:00.000Z");
const MEMBER_BYTES = encodeUtf8("# Exact requirement bytes\n");

test("Ledger publication intent stores metadata without duplicating member payload", () => {
  const record = createRequirementRecord({
    requirementId: REQUIREMENT_ID,
    programId: PROGRAM_ID,
    title: "Ledger staged publication",
    documents: [{
      role: "requirement-design",
      path: "design/requirement.md",
      mediaType: "text/markdown",
      digest: computeSha256Digest(MEMBER_BYTES),
    }],
  }, { clock: () => RECORDED_AT });
  const recordBytes = encodeUtf8(renderLedgerAuthorityRecord(record));
  const plan = planDirectoryTreeCandidate([{
    path: "design/requirement.md",
    bytes: MEMBER_BYTES,
    mode: 0o644,
  }, {
    path: "record.json",
    bytes: recordBytes,
    mode: 0o644,
  }], {
    directoryMode: 0o755,
    maximumDepth: 64,
    maximumEntries: 64,
    maximumFileBytes: 4 * 1024 * 1024,
    maximumFiles: 33,
    maximumTotalBytes: 16 * 1024 * 1024,
  });

  const intent = createLedgerRecordPublicationIntent(record, plan);
  equal(intent.record.artifactKind, "wakeflow-requirement-record");
  if (intent.record.artifactKind !== "wakeflow-requirement-record") {
    throw new Error("Expected requirement publication intent.");
  }
  equal(intent.record.requirementId, REQUIREMENT_ID);
  equal(Object.hasOwn(intent, "family"), false);
  equal(Object.hasOwn(intent, "recordId"), false);
  equal(intent.finalRootRef, `requirements/${REQUIREMENT_ID}`);
  equal(intent.intentRef, `transactions/${REQUIREMENT_ID}.intent.json`);
  equal(intent.lockRef, `transactions/${REQUIREMENT_ID}.lock`);
  equal(intent.stageRef, `transactions/.${REQUIREMENT_ID}.stage`);
  equal(intent.stageRef, ledgerRecordPublicationStageRef(record));
  equal(intent.intentRef, ledgerRecordPublicationIntentRef(record));
  equal(intent.lockRef, ledgerRecordPublicationLockRef(record));

  const text = renderLedgerRecordPublicationIntent(intent);
  const parsed = parseLedgerRecordPublicationIntentDocument(text);
  equal(renderLedgerRecordPublicationIntent(parsed), text);
  equal(parsed.treePlan.treeDigest, plan.treeDigest);
  equal(text.includes(Buffer.from(MEMBER_BYTES).toString("base64url")), false);
  equal(text.includes("Exact requirement bytes"), false);
  match(text, /"record"/u);
});

test("Ledger publication intent rejects a forged stage relation", () => {
  const record = createRequirementRecord({
    requirementId: REQUIREMENT_ID,
    programId: PROGRAM_ID,
    title: "Ledger staged publication",
    documents: [{
      role: "requirement-design",
      path: "design/requirement.md",
      mediaType: "text/markdown",
      digest: computeSha256Digest(MEMBER_BYTES),
    }],
  }, { clock: () => RECORDED_AT });
  const plan = planDirectoryTreeCandidate([{
    path: "design/requirement.md",
    bytes: MEMBER_BYTES,
    mode: 0o644,
  }, {
    path: "record.json",
    bytes: encodeUtf8(renderLedgerAuthorityRecord(record)),
    mode: 0o644,
  }], {
    directoryMode: 0o755,
    maximumDepth: 64,
    maximumEntries: 64,
    maximumFileBytes: 4 * 1024 * 1024,
    maximumFiles: 33,
    maximumTotalBytes: 16 * 1024 * 1024,
  });
  const intent = createLedgerRecordPublicationIntent(record, plan);
  let caught: unknown;
  try {
    renderLedgerRecordPublicationIntent({
      ...intent,
      stageRef: "transactions/.forged.stage",
    });
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof LedgerRecordPublicationIntentError, true);
});

test("Ledger publication intent reapplies its owner byte budget", () => {
  const record = createRequirementRecord({
    requirementId: REQUIREMENT_ID,
    programId: PROGRAM_ID,
    title: "Ledger staged publication",
    documents: [{
      role: "requirement-design",
      path: "design/requirement.md",
      mediaType: "text/markdown",
      digest: computeSha256Digest(MEMBER_BYTES),
    }],
  }, { clock: () => RECORDED_AT });
  const recordBytes = encodeUtf8(renderLedgerAuthorityRecord(record));
  const plan = planDirectoryTreeCandidateFromFileDescriptors([{
    path: parsePortableResourcePath("design/requirement.md"),
    byteCount: parseByteCount(4 * 1024 * 1024 + 1),
    digest: computeSha256Digest(MEMBER_BYTES),
    mode: 0o644,
  }, {
    path: parsePortableResourcePath("record.json"),
    byteCount: parseByteCount(recordBytes.byteLength),
    digest: computeSha256Digest(recordBytes),
    mode: 0o644,
  }], {
    directoryMode: 0o755,
    maximumDepth: 64,
    maximumEntries: 8192,
    maximumFileBytes: 32 * 1024 * 1024,
    maximumFiles: 4096,
    maximumTotalBytes: 256 * 1024 * 1024,
  });

  let caught: unknown;
  try {
    createLedgerRecordPublicationIntent(record, plan);
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof LedgerRecordPublicationIntentError, true);
  if (caught instanceof LedgerRecordPublicationIntentError) {
    equal(caught.reason, "tree-plan");
  }
});
