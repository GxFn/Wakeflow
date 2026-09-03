import {
  parseLedgerAuthorityMemberReference,
} from "../../../src/governance/ledger/ledger-authority-reader.js";
import type {
  LedgerAuthorityMemberReference,
} from "../../../src/governance/ledger/ledger-authority-store-contract.js";

export const TODO_PROGRAM_ID =
  "program_11111111-1111-4111-8111-111111111111";
export const TODO_ORIGIN_WINDOW_ID =
  "window_22222222-2222-4222-8222-222222222222";
export const TODO_CONTROLLER_WINDOW_ID =
  "window_33333333-3333-4333-8333-333333333333";
const REQUIREMENT_ID =
  "requirement_44444444-4444-4444-8444-444444444444";

const REQUIRED_ROLES = Object.freeze({
  requirement: Object.freeze([
    "original-plan",
    "requirement-design",
    "code-facts",
    "landing-plan",
    "non-goals",
    "user-confirmation",
  ]),
  bug: Object.freeze(["reproduction", "scope", "non-goals"]),
  supplement: Object.freeze([
    "requirement-design",
    "requirement-delta",
    "user-confirmation",
  ]),
  research: Object.freeze(["research-question", "boundaries"]),
} as const);

type FixtureDemandType = keyof typeof REQUIRED_ROLES;
type FixtureTestingMode =
  | "controller-only"
  | "real-environment"
  | "not-applicable";

function digest(index: number): `sha256:${string}` {
  return `sha256:${index.toString(16).padStart(64, "0")}`;
}

function memberReference(
  role: string,
  index: number,
): Readonly<LedgerAuthorityMemberReference> {
  const memberPath = `authority/${String(index).padStart(2, "0")}-${role}.md`;
  const root = `requirements/${REQUIREMENT_ID}`;
  return parseLedgerAuthorityMemberReference({
    artifactKind: "wakeflow-ledger-authority-member-reference",
    schemaVersion: 1,
    family: "requirement",
    recordId: REQUIREMENT_ID,
    recordRef: `${root}/record.json`,
    recordDigest: digest(100),
    memberPath,
    memberRef: `${root}/${memberPath}`,
    memberDigest: digest(index + 1),
    role,
    mediaType: "text/markdown",
  });
}

export function todoAuthorityRefs(
  demandType: FixtureDemandType = "requirement",
  testingMode: FixtureTestingMode = demandType === "research"
    ? "not-applicable"
    : "controller-only",
): readonly Readonly<LedgerAuthorityMemberReference>[] {
  const roles = [
    ...REQUIRED_ROLES[demandType],
    ...(testingMode === "real-environment" ? ["test-environment"] : []),
  ];
  return Object.freeze(
    roles
      .map((role, index) => memberReference(role, index))
      .sort((left, right) =>
        left.memberRef < right.memberRef
          ? -1
          : left.memberRef > right.memberRef
            ? 1
            : 0),
  );
}

function testingMode(value: unknown): FixtureTestingMode {
  if (
    typeof value === "object"
    && value !== null
    && Object.hasOwn(value, "mode")
  ) {
    const mode = (value as Readonly<Record<string, unknown>>).mode;
    if (
      mode === "controller-only"
      || mode === "real-environment"
      || mode === "not-applicable"
    ) {
      return mode;
    }
  }
  return "controller-only";
}

export function todoIntakeDraft(
  todoId: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const demandType = (
    overrides.demandType === "requirement"
    || overrides.demandType === "bug"
    || overrides.demandType === "supplement"
    || overrides.demandType === "research"
  )
    ? overrides.demandType
    : "requirement";
  const defaultMode: FixtureTestingMode = demandType === "research"
    ? "not-applicable"
    : "controller-only";
  const decision = Object.hasOwn(overrides, "testingDecision")
    ? overrides.testingDecision
    : {
      mode: defaultMode,
      summary: defaultMode === "not-applicable"
        ? "Research has no execution target"
        : "Focused target tests",
      environmentMemberRef: null,
    };
  const mode = testingMode(decision);
  const authorityRefs = Object.hasOwn(overrides, "authorityRefs")
    ? overrides.authorityRefs
    : todoAuthorityRefs(demandType, mode);
  const environmentMemberRef = Array.isArray(authorityRefs)
    ? authorityRefs.find((entry) => (
      typeof entry === "object"
      && entry !== null
      && (entry as Readonly<Record<string, unknown>>).role === "test-environment"
    ))
    : undefined;
  const normalizedDecision =
    mode === "real-environment"
    && typeof decision === "object"
    && decision !== null
    && !Object.hasOwn(decision, "environmentMemberRef")
      ? {
        ...(decision as Readonly<Record<string, unknown>>),
        environmentMemberRef:
          (environmentMemberRef as Readonly<Record<string, unknown>> | undefined)
            ?.memberRef ?? null,
      }
      : decision;
  return {
    programId: TODO_PROGRAM_ID,
    todoId,
    demandType,
    priority: "P1",
    originWindowId: TODO_ORIGIN_WINDOW_ID,
    controllerWindowId: TODO_CONTROLLER_WINDOW_ID,
    summary: `Implement ${todoId}`,
    intakeRationale: "Queue confirmed work before Demand publication.",
    readiness: { status: "ready" },
    autoClaim: true,
    ...overrides,
    testingDecision: normalizedDecision,
    authorityRefs,
  };
}
