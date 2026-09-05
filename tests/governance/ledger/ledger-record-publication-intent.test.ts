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
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import {
  createRequirementRecord,
  renderLedgerAuthorityRecord,
  type RequirementRecord,
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
import {
  FIXTURE_RECORDED_AT,
  FIXTURE_REQUIREMENT_ID,
  requirementMembers,
  requirementRecordDraft,
} from "./requirement-package.fixture.js";

const MEMBERS = requirementMembers();
const PLAN_OPTIONS = {
  directoryMode: 0o755,
  maximumDepth: 64,
  maximumEntries: 64,
  maximumFileBytes: 4 * 1024 * 1024,
  maximumFiles: 19,
  maximumTotalBytes: 16 * 1024 * 1024,
} as const;

function fixtureRecord(): Readonly<RequirementRecord> {
  return createRequirementRecord(requirementRecordDraft(), {
    clock: () => FIXTURE_RECORDED_AT,
  });
}

function fixturePlan(record: Readonly<RequirementRecord>) {
  return planDirectoryTreeCandidate([
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
  ].sort((left, right) => (
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  )), PLAN_OPTIONS);
}

test("Ledger publication intent stores metadata without duplicating member payload", () => {
  const record = fixtureRecord();
  const plan = fixturePlan(record);

  const intent = createLedgerRecordPublicationIntent(record, plan);
  equal(intent.record.artifactKind, "wakeflow-requirement-record");
  equal(intent.record.requirementId, FIXTURE_REQUIREMENT_ID);
  equal(Object.hasOwn(intent, "family"), false);
  equal(Object.hasOwn(intent, "recordId"), false);
  equal(intent.finalRootRef, `requirements/${FIXTURE_REQUIREMENT_ID}`);
  equal(intent.intentRef, `transactions/${FIXTURE_REQUIREMENT_ID}.intent.json`);
  equal(intent.lockRef, `transactions/${FIXTURE_REQUIREMENT_ID}.lock`);
  equal(intent.stageRef, `transactions/.${FIXTURE_REQUIREMENT_ID}.stage`);
  equal(intent.stageRef, ledgerRecordPublicationStageRef(record));
  equal(intent.intentRef, ledgerRecordPublicationIntentRef(record));
  equal(intent.lockRef, ledgerRecordPublicationLockRef(record));
  equal(intent.treePlan.files.length, 3);

  const text = renderLedgerRecordPublicationIntent(intent);
  const parsed = parseLedgerRecordPublicationIntentDocument(text);
  equal(renderLedgerRecordPublicationIntent(parsed), text);
  equal(parsed.treePlan.treeDigest, plan.treeDigest);
  for (const member of MEMBERS) {
    equal(text.includes(Buffer.from(member.bytes).toString("base64url")), false);
  }
  equal(text.includes("让 Controller 能从需求包创建 Demand"), false);
  match(text, /"record"/u);
  match(text, /"sections"/u);
});

test("Ledger publication intent rejects a forged stage relation", () => {
  const record = fixtureRecord();
  const intent = createLedgerRecordPublicationIntent(record, fixturePlan(record));
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
  const record = fixtureRecord();
  const recordBytes = encodeUtf8(renderLedgerAuthorityRecord(record));
  const [landing, requirement] = MEMBERS;
  if (landing === undefined || requirement === undefined) {
    throw new Error("Expected two fixture members.");
  }
  const plan = planDirectoryTreeCandidateFromFileDescriptors([{
    path: parsePortableResourcePath(landing.path),
    byteCount: parseByteCount(landing.bytes.byteLength),
    digest: computeSha256Digest(landing.bytes),
    mode: 0o644,
  }, {
    path: parsePortableResourcePath("record.json"),
    byteCount: parseByteCount(recordBytes.byteLength),
    digest: computeSha256Digest(recordBytes),
    mode: 0o644,
  }, {
    path: parsePortableResourcePath(requirement.path),
    byteCount: parseByteCount(4 * 1024 * 1024 + 1),
    digest: computeSha256Digest(requirement.bytes),
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
