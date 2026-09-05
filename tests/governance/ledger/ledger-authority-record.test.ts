import {
  deepEqual,
  equal,
} from "node:assert/strict";
import { test } from "node:test";

import {
  computeCanonicalJsonSha256Digest,
} from "../../../src/foundation/crypto/canonical-json-sha256.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import {
  createRequirementRecord,
  parseLedgerAuthorityRecord,
  parseLedgerAuthorityRecordDocument,
  renderLedgerAuthorityRecord,
  LedgerAuthorityRecordError,
  type CreateRequirementRecordInput,
  type LedgerAuthorityDocument,
  type LedgerAuthorityRecordErrorReason,
  type RequirementDocumentRole,
} from "../../../src/governance/ledger/ledger-authority-record.js";
import {
  FIXTURE_ORIGIN_WINDOW_ID,
  FIXTURE_PROGRAM_ID,
  FIXTURE_RECORDED_AT,
  FIXTURE_REQUIREMENT_ID,
  requirementRecordDraft,
} from "./requirement-package.fixture.js";

const OTHER_REQUIREMENT_ID = "requirement_22222222-2222-4222-8222-222222222222";
const CLOCK = { clock: () => FIXTURE_RECORDED_AT } as const;

function expectRecordError(
  action: () => unknown,
  reason: LedgerAuthorityRecordErrorReason,
): void {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof LedgerAuthorityRecordError)) {
    throw new Error("Expected LedgerAuthorityRecordError.");
  }
  equal(caught.reason, reason);
}

function documentOf(
  draft: CreateRequirementRecordInput,
  role: RequirementDocumentRole,
): Readonly<LedgerAuthorityDocument> {
  const document = draft.documents.find((candidate) => candidate.role === role);
  if (document === undefined) throw new Error(`Fixture lacks a ${role} document.`);
  return document;
}

function member(
  role: RequirementDocumentRole,
  path: string,
  text = "# 附件\n",
): Readonly<LedgerAuthorityDocument> {
  return {
    role,
    path: parsePortableResourcePath(path),
    mediaType: "text/markdown",
    digest: computeSha256Digest(encodeUtf8(text)),
  };
}

test("requirement package record carries header, members and sections through the deterministic codec", () => {
  const draft = requirementRecordDraft();
  const record = createRequirementRecord(draft, CLOCK);

  equal(record.artifactKind, "wakeflow-requirement-record");
  equal(record.schemaVersion, 1);
  equal(record.recordedAt, FIXTURE_RECORDED_AT);
  equal(record.requirementId, FIXTURE_REQUIREMENT_ID);
  equal(record.programId, FIXTURE_PROGRAM_ID);
  equal(record.originWindowId, FIXTURE_ORIGIN_WINDOW_ID);
  equal(record.supersedes, null);
  deepEqual(record.testingDecision, draft.testingDecision);
  deepEqual(record.confirmation, draft.confirmation);
  deepEqual(record.documents.map((document) => [document.role, document.path]), [
    ["landing", "landing.md"],
    ["requirement", "requirement.md"],
  ]);
  deepEqual(record.sections.map((section) => [section.path, section.anchor]), [
    ["requirement.md", "goal"],
    ["requirement.md", "completion-definition"],
    ["requirement.md", "non-goals"],
    ["requirement.md", "acceptance-criteria"],
    ["requirement.md", "user-confirmation"],
    ["landing.md", "code-facts"],
    ["landing.md", "landing-plan"],
    ["landing.md", "testing-decision"],
  ]);
  equal(Object.isFrozen(record), true);
  equal(Object.isFrozen(record.documents), true);
  equal(Object.isFrozen(record.sections[0]), true);
  equal(Object.isFrozen(record.confirmation), true);

  const text = renderLedgerAuthorityRecord(record);
  equal(text.endsWith("\n"), true);
  deepEqual(parseLedgerAuthorityRecordDocument(text), record);
  deepEqual(parseLedgerAuthorityRecord(JSON.parse(text)), record);
  equal(
    computeCanonicalJsonSha256Digest(parseLedgerAuthorityRecord(record)),
    computeCanonicalJsonSha256Digest(record),
  );
  expectRecordError(
    () => parseLedgerAuthorityRecord({ ...record, status: "confirmed" }),
    "schema",
  );
  expectRecordError(
    () => parseLedgerAuthorityRecord({ ...record, artifactKind: "wakeflow-todo-record" }),
    "schema",
  );
  expectRecordError(
    () => parseLedgerAuthorityRecordDocument(text.replace("\n}\n", "\n}")),
    "representation",
  );
});

test("record codec closes member roles and paths before accepting a package", () => {
  const draft = requirementRecordDraft();
  const requirement = documentOf(draft, "requirement");
  const landing = documentOf(draft, "landing");
  const withDocuments = (
    documents: readonly Readonly<LedgerAuthorityDocument>[],
  ) => createRequirementRecord(
    requirementRecordDraft({ documents, sections: [] }),
    CLOCK,
  );

  // 缺少 landing.md：即使成员数量满足 Schema，角色关系也不闭合。
  expectRecordError(
    () => withDocuments([member("attachment", "attachments/notes.md"), requirement]),
    "document",
  );
  // 附件必须位于 attachments/ 下且只有一层。
  expectRecordError(
    () => withDocuments([landing, member("attachment", "notes/extra.md"), requirement]),
    "document",
  );
  expectRecordError(
    () => withDocuments([member("attachment", "attachments/deep/extra.md"), landing, requirement]),
    "document",
  );
  // 角色与固定路径互换。
  expectRecordError(
    () => withDocuments([
      { ...landing, role: "requirement" },
      { ...requirement, role: "landing" },
    ]),
    "document",
  );
  // 成员必须按路径严格升序，且不允许大小写冲突。
  expectRecordError(() => withDocuments([requirement, landing]), "document");
  expectRecordError(
    () => withDocuments([
      member("attachment", "attachments/A.md"),
      member("attachment", "attachments/a.md"),
      landing,
      requirement,
    ]),
    "document",
  );

  const withAttachment = withDocuments([
    member("attachment", "attachments/trace.md"),
    landing,
    requirement,
  ]);
  deepEqual(withAttachment.documents.map((document) => document.path), [
    "attachments/trace.md",
    "landing.md",
    "requirement.md",
  ]);
});

test("record codec relates demand type, testing decision and supersedes", () => {
  expectRecordError(
    () => createRequirementRecord(requirementRecordDraft({
      demandType: "research",
      testingDecision: { mode: "controller-only", summary: "聚焦测试。" },
    }), CLOCK),
    "relation",
  );
  expectRecordError(
    () => createRequirementRecord(requirementRecordDraft({
      demandType: "requirement",
      testingDecision: { mode: "not-applicable", summary: "研究不测。" },
    }), CLOCK),
    "relation",
  );
  const research = createRequirementRecord(requirementRecordDraft({
    demandType: "research",
    testingDecision: { mode: "not-applicable", summary: "研究不测。" },
  }), CLOCK);
  equal(research.testingDecision.mode, "not-applicable");

  expectRecordError(
    () => createRequirementRecord(
      requirementRecordDraft({ supersedes: FIXTURE_REQUIREMENT_ID }),
      CLOCK,
    ),
    "relation",
  );
  const superseding = createRequirementRecord(
    requirementRecordDraft({ supersedes: OTHER_REQUIREMENT_ID }),
    CLOCK,
  );
  equal(superseding.supersedes, OTHER_REQUIREMENT_ID);
});

test("record codec keeps sections bound to members without judging the required table", () => {
  const draft = requirementRecordDraft();
  const [first] = draft.sections;
  if (first === undefined) throw new Error("Fixture lacks sections.");

  expectRecordError(
    () => createRequirementRecord(requirementRecordDraft({
      sections: [{ ...first, path: parsePortableResourcePath("notes.md") }],
    }), CLOCK),
    "section",
  );
  expectRecordError(
    () => createRequirementRecord(requirementRecordDraft({
      sections: [first, { ...first, line: first.line + 10 }],
    }), CLOCK),
    "section",
  );
  expectRecordError(
    () => createRequirementRecord(requirementRecordDraft({
      sections: [{ ...first, line: 0 }],
    }), CLOCK),
    "schema",
  );

  const custom = createRequirementRecord(requirementRecordDraft({
    sections: [{ ...first, anchor: "custom-notes", heading: "自定义章节" }],
  }), CLOCK);
  deepEqual(custom.sections.map((section) => section.anchor), ["custom-notes"]);
  const empty = createRequirementRecord(requirementRecordDraft({ sections: [] }), CLOCK);
  deepEqual(empty.sections, []);
});

test("record drafts close their relations before reading the wall clock", () => {
  let clockCalls = 0;
  expectRecordError(
    () => createRequirementRecord(
      requirementRecordDraft({ supersedes: FIXTURE_REQUIREMENT_ID }),
      {
        clock: () => {
          clockCalls += 1;
          return FIXTURE_RECORDED_AT;
        },
      },
    ),
    "relation",
  );
  equal(clockCalls, 0);

  expectRecordError(
    () => createRequirementRecord(requirementRecordDraft(), {
      clock: () => {
        throw new Error("private clock failure");
      },
    }),
    "time",
  );
  expectRecordError(
    () => createRequirementRecord(
      { ...requirementRecordDraft(), recordedAt: FIXTURE_RECORDED_AT } as CreateRequirementRecordInput,
      CLOCK,
    ),
    "input",
  );
});
