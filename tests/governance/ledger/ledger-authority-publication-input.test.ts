import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  LEDGER_AUTHORITY_PUBLICATION_MEMBER_MEDIA_TYPE,
  LedgerAuthorityPublicationInputError,
  parseConfirmationAuthorityPublicationInput,
  parseRequirementAuthorityPublicationInput,
  type LedgerAuthorityPublicationInputErrorReason,
} from "../../../src/governance/ledger/ledger-authority-publication-input.js";

const DESIGN_SURFACE_ID =
  "surface_11111111-1111-4111-8111-111111111111";

function requirementInput() {
  return {
    title: "Publish confirmed requirement authority",
    designSurfaceId: DESIGN_SURFACE_ID,
    documents: [
      { role: "original-plan", path: "plan/original.md" },
      { role: "requirement-design", path: "design/requirement.md" },
    ],
  };
}

function confirmationInput() {
  return {
    title: "Publish isolated placement confirmation",
    designSurfaceId: DESIGN_SURFACE_ID,
    documents: [
      { role: "goal-stage-decision", path: "decisions/placement.md" },
    ],
  };
}

function expectInputError(
  action: () => unknown,
  reason: LedgerAuthorityPublicationInputErrorReason,
): void {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof LedgerAuthorityPublicationInputError)) {
    throw new Error("Expected LedgerAuthorityPublicationInputError.");
  }
  equal(caught.code, "wakeflow-ledger-authority-publication-input");
  equal(caught.reason, reason);
}

test("requirement input freezes and canonically sorts Design Markdown selections", () => {
  const input = parseRequirementAuthorityPublicationInput(requirementInput());
  equal(input.family, "requirement");
  equal(input.designSurfaceId, DESIGN_SURFACE_ID);
  deepEqual(input.documents, [
    { role: "requirement-design", path: "design/requirement.md" },
    { role: "original-plan", path: "plan/original.md" },
  ]);
  equal(LEDGER_AUTHORITY_PUBLICATION_MEMBER_MEDIA_TYPE, "text/markdown");
  equal(Object.isFrozen(input), true);
  equal(Object.isFrozen(input.documents), true);
  equal(Object.isFrozen(input.documents[0]), true);
  for (const ownerField of [
    "programId",
    "recordedAt",
    "requirementId",
    "digest",
    "mediaType",
  ]) {
    equal(Object.hasOwn(input, ownerField), false);
  }
});

test("confirmation input contains no caller-supplied Confirmation or Demand identity", () => {
  const input = parseConfirmationAuthorityPublicationInput(
    confirmationInput(),
  );
  equal(input.family, "confirmation");
  equal(input.documents[0].role, "goal-stage-decision");
  equal(Object.hasOwn(input, "confirmationId"), false);
  equal(Object.hasOwn(input, "demandId"), false);
});

test("family-specific roles and closed shapes fail distinctly", () => {
  expectInputError(
    () => parseRequirementAuthorityPublicationInput({
      ...requirementInput(),
      documents: [{
        role: "goal-stage-decision",
        path: "decisions/placement.md",
      }],
    }),
    "document",
  );
  expectInputError(
    () => parseConfirmationAuthorityPublicationInput({
      ...confirmationInput(),
      documents: [{
        role: "requirement-design",
        path: "design/requirement.md",
      }],
    }),
    "document",
  );
  expectInputError(
    () => parseRequirementAuthorityPublicationInput({
      ...requirementInput(),
      family: "requirement",
    }),
    "input",
  );
  expectInputError(
    () => parseRequirementAuthorityPublicationInput({
      ...requirementInput(),
      programId: "program_22222222-2222-4222-8222-222222222222",
    }),
    "input",
  );
  expectInputError(
    () => parseRequirementAuthorityPublicationInput({
      ...requirementInput(),
      documents: [{
        role: "requirement-design",
        path: "design/requirement.md",
        content: "# Caller bytes are not accepted\n",
      }],
    }),
    "document",
  );
});

test("document paths reject unsafe roots, non-Markdown files, and tree collisions", () => {
  for (const path of [
    "../outside.md",
    "design\\requirement.md",
    ".git/requirement.md",
    ".wakeflow-active/requirement.md",
    ".wakeflow-local/requirement.md",
    "record.json",
    "design/requirement.txt",
  ]) {
    expectInputError(
      () => parseRequirementAuthorityPublicationInput({
        ...requirementInput(),
        documents: [{ role: "requirement-design", path }],
      }),
      "path",
    );
  }
  for (const documents of [
    [
      { role: "original-plan", path: "plan/original.md" },
      { role: "requirement-design", path: "plan/original.md" },
    ],
    [
      { role: "original-plan", path: "Plan/original.md" },
      { role: "requirement-design", path: "plan/requirement.md" },
    ],
    [
      { role: "original-plan", path: "design.md" },
      { role: "requirement-design", path: "design.md/requirement.md" },
    ],
  ]) {
    expectInputError(
      () => parseRequirementAuthorityPublicationInput({
        ...requirementInput(),
        documents,
      }),
      "path",
    );
  }
});

test("identity, canonical text, capacity, and passive-data boundaries fail closed", () => {
  expectInputError(
    () => parseRequirementAuthorityPublicationInput({
      ...requirementInput(),
      designSurfaceId: "repository_11111111-1111-4111-8111-111111111111",
    }),
    "identifier",
  );
  expectInputError(
    () => parseRequirementAuthorityPublicationInput({
      ...requirementInput(),
      title: "cafe\u0301",
    }),
    "title",
  );
  expectInputError(
    () => parseRequirementAuthorityPublicationInput({
      ...requirementInput(),
      documents: Array.from({ length: 33 }, (_, index) => ({
        role: "supporting-evidence",
        path: `evidence/${String(index).padStart(2, "0")}.md`,
      })),
    }),
    "document",
  );

  const hostile = requirementInput();
  let getterCalls = 0;
  Object.defineProperty(hostile, "title", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "Publish confirmed requirement authority";
    },
  });
  expectInputError(
    () => parseRequirementAuthorityPublicationInput(hostile),
    "input",
  );
  equal(getterCalls, 0);
});
