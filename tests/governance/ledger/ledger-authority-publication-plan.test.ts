import { equal, notEqual } from "node:assert/strict";
import { test } from "node:test";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { planDirectoryTreeCandidate } from "../../../src/foundation/filesystem/durable-directory-tree-candidate.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  computeLedgerAuthorityPublicationPlanDigest,
  createLedgerAuthorityPublicationPlan,
  LedgerAuthorityPublicationPlanError,
  parseLedgerAuthorityPublicationPlan,
  type LedgerAuthorityPublicationPlanErrorReason,
} from "../../../src/governance/ledger/ledger-authority-publication-plan.js";
import {
  createConfirmationRecord,
  createRequirementRecord,
  renderLedgerAuthorityRecord,
  type LedgerAuthorityRecord,
} from "../../../src/governance/ledger/ledger-authority-record.js";
import { createLedgerRecordPublicationIntent } from "../../../src/governance/ledger/ledger-record-publication-intent.js";

const CONFIG_DIGEST = `sha256:${"a".repeat(64)}`;
const DESIGN_SURFACE_ID =
  "surface_11111111-1111-4111-8111-111111111111";
const PROGRAM_ID = "program_22222222-2222-4222-8222-222222222222";
const REQUIREMENT_ID =
  "requirement_33333333-3333-4333-8333-333333333333";
const CONFIRMATION_ID =
  "confirmation_44444444-4444-4444-8444-444444444444";
const DEMAND_ID = "demand_55555555-5555-4555-8555-555555555555";
const RECORDED_AT = parseUtcInstant("2026-09-02T12:00:00.000Z");
const MEMBER_BYTES = encodeUtf8("# Confirmed design authority\n");

const CANDIDATE_OPTIONS = {
  directoryMode: 0o755,
  maximumDepth: 64,
  maximumEntries: 256,
  maximumFileBytes: 4 * 1024 * 1024,
  maximumFiles: 33,
  maximumTotalBytes: 16 * 1024 * 1024,
} as const;

function intentFor(
  record: Readonly<LedgerAuthorityRecord>,
  memberPath: string,
) {
  const treePlan = planDirectoryTreeCandidate([{
    path: memberPath,
    bytes: MEMBER_BYTES,
    mode: 0o644,
  }, {
    path: "record.json",
    bytes: encodeUtf8(renderLedgerAuthorityRecord(record)),
    mode: 0o644,
  }], CANDIDATE_OPTIONS);
  return createLedgerRecordPublicationIntent(record, treePlan);
}

function requirementIntent(
  mediaType = "text/markdown",
  memberPath = "design/requirement.md",
) {
  const record = createRequirementRecord({
    requirementId: REQUIREMENT_ID,
    programId: PROGRAM_ID,
    title: "Publish confirmed requirement authority",
    documents: [{
      role: "requirement-design",
      path: memberPath,
      mediaType,
      digest: computeSha256Digest(MEMBER_BYTES),
    }],
  }, { clock: () => RECORDED_AT });
  return intentFor(record, memberPath);
}

function confirmationIntent() {
  const memberPath = "decisions/placement.md";
  const record = createConfirmationRecord({
    confirmationId: CONFIRMATION_ID,
    programId: PROGRAM_ID,
    demandId: DEMAND_ID,
    title: "Publish isolated placement confirmation",
    documents: [{
      role: "goal-stage-decision",
      path: memberPath,
      mediaType: "text/markdown",
      digest: computeSha256Digest(MEMBER_BYTES),
    }],
  }, { clock: () => RECORDED_AT });
  return intentFor(record, memberPath);
}

function draft(intent = requirementIntent()) {
  return {
    configDigest: CONFIG_DIGEST,
    designSurfaceId: DESIGN_SURFACE_ID,
    intent,
  };
}

function expectPlanError(
  action: () => unknown,
  reason: LedgerAuthorityPublicationPlanErrorReason,
): void {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof LedgerAuthorityPublicationPlanError)) {
    throw new Error("Expected LedgerAuthorityPublicationPlanError.");
  }
  equal(caught.code, "wakeflow-ledger-authority-publication-plan");
  equal(caught.reason, reason);
}

test("requirement plan reuses the compact Intent without member bytes", () => {
  const plan = createLedgerAuthorityPublicationPlan(draft());
  equal(plan.kind, "WakeflowLedgerAuthorityPublicationPlan");
  equal(plan.schemaVersion, 1);
  equal(plan.configDigest, CONFIG_DIGEST);
  equal(plan.designSurfaceId, DESIGN_SURFACE_ID);
  equal(plan.intent.record.artifactKind, "wakeflow-requirement-record");
  equal(plan.intent.treePlan.files.length, 2);
  equal(Object.isFrozen(plan), true);
  equal(Object.isFrozen(plan.intent), true);
  equal(JSON.stringify(plan).includes("Confirmed design authority"), false);
  equal(computeLedgerAuthorityPublicationPlanDigest(plan).length, 71);
});

test("confirmation plan preserves the owner-derived future Demand identity", () => {
  const plan = createLedgerAuthorityPublicationPlan(
    draft(confirmationIntent()),
  );
  equal(plan.intent.record.artifactKind, "wakeflow-confirmation-record");
  if (plan.intent.record.artifactKind !== "wakeflow-confirmation-record") {
    throw new Error("Expected Confirmation Record.");
  }
  equal(plan.intent.record.confirmationId, CONFIRMATION_ID);
  equal(plan.intent.record.demandId, DEMAND_ID);
});

test("plan digest is field-order independent and binds every retained fact", () => {
  const plan = createLedgerAuthorityPublicationPlan(draft());
  const reordered = Object.fromEntries(Object.entries(plan).reverse());
  equal(
    computeLedgerAuthorityPublicationPlanDigest(reordered),
    computeLedgerAuthorityPublicationPlanDigest(plan),
  );
  notEqual(
    computeLedgerAuthorityPublicationPlanDigest({
      ...plan,
      configDigest: `sha256:${"b".repeat(64)}`,
    }),
    computeLedgerAuthorityPublicationPlanDigest(plan),
  );
});

test("forged Config, Intent, and non-Markdown source profiles fail closed", () => {
  expectPlanError(
    () => createLedgerAuthorityPublicationPlan({
      ...draft(),
      configDigest: "sha256:bad",
    }),
    "digest",
  );
  expectPlanError(
    () => createLedgerAuthorityPublicationPlan({
      ...draft(),
      designSurfaceId: "repository_11111111-1111-4111-8111-111111111111",
    }),
    "source-profile",
  );
  expectPlanError(
    () => createLedgerAuthorityPublicationPlan({
      ...draft(),
      intent: {
        ...requirementIntent(),
        stageRef: "transactions/.forged.stage",
      },
    }),
    "intent",
  );
  for (const intent of [
    requirementIntent("text/plain"),
    requirementIntent("text/markdown", ".git/requirement.md"),
  ]) {
    expectPlanError(
      () => createLedgerAuthorityPublicationPlan(draft(intent)),
      "source-profile",
    );
  }
});

test("plan and draft inputs remain closed passive records", () => {
  const plan = createLedgerAuthorityPublicationPlan(draft());
  expectPlanError(
    () => parseLedgerAuthorityPublicationPlan({ ...plan, unknown: true }),
    "input",
  );
  expectPlanError(
    () => createLedgerAuthorityPublicationPlan({ ...draft(), unknown: true }),
    "input",
  );

  const hostile = draft();
  let getterCalls = 0;
  Object.defineProperty(hostile, "configDigest", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return CONFIG_DIGEST;
    },
  });
  expectPlanError(
    () => createLedgerAuthorityPublicationPlan(hostile),
    "input",
  );
  equal(getterCalls, 0);
});
