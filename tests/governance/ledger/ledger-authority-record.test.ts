import {
  deepEqual,
  equal,
  throws,
} from "node:assert/strict";
import { test } from "node:test";

import {
  computeCanonicalJsonSha256Digest,
} from "../../../src/foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
} from "../../../src/foundation/crypto/sha256.js";
import {
  parseWakeflowDurableIdOfKind,
} from "../../../src/foundation/identity/wakeflow-durable-id.js";
import {
  parseUtcInstant,
} from "../../../src/foundation/time/utc-instant.js";
import {
  createConfirmationRecord,
  createRequirementRecord,
  parseLedgerAuthorityRecord,
  renderLedgerAuthorityRecord,
  LedgerAuthorityRecordError,
} from "../../../src/governance/ledger/ledger-authority-record.js";

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
const DOCUMENT_DIGEST = parseSha256Digest(
  `sha256:${"a".repeat(64)}`,
);

function requirementInput() {
  return {
    requirementId: REQUIREMENT_ID,
    programId: PROGRAM_ID,
    title: "重建 Demand Event Sourcing 骨干",
    documents: [{
      role: "requirement-design" as const,
      path: "design/requirement.md",
      mediaType: "text/markdown",
      digest: DOCUMENT_DIGEST,
    }],
  };
}

test("requirement authority removes legacy status and reverse demand indexes", () => {
  const requirement = createRequirementRecord(requirementInput(), {
    clock: () => RECORDED_AT,
  });

  deepEqual(requirement, {
    artifactKind: "wakeflow-requirement-record",
    schemaVersion: 1,
    requirementId: REQUIREMENT_ID,
    programId: PROGRAM_ID,
    recordedAt: RECORDED_AT,
    title: "重建 Demand Event Sourcing 骨干",
    documents: [{
      role: "requirement-design",
      path: "design/requirement.md",
      mediaType: "text/markdown",
      digest: DOCUMENT_DIGEST,
    }],
  });
  equal(Object.isFrozen(requirement), true);
  equal(Object.isFrozen(requirement.documents), true);
  equal(Object.isFrozen(requirement.documents[0]), true);

  const text = renderLedgerAuthorityRecord(requirement);
  equal(text.endsWith("\n"), true);
  deepEqual(parseLedgerAuthorityRecord(JSON.parse(text)), requirement);
  equal(
    computeCanonicalJsonSha256Digest(parseLedgerAuthorityRecord(requirement)),
    computeCanonicalJsonSha256Digest(requirement),
  );

  for (const legacyField of ["status", "relatedDemandIds"] as const) {
    throws(
      () => parseLedgerAuthorityRecord({
        ...requirement,
        [legacyField]: legacyField === "status" ? "confirmed" : [],
      }),
      LedgerAuthorityRecordError,
    );
  }
});

test("confirmation authority binds one pre-minted Demand without claiming an actor", () => {
  const confirmation = createConfirmationRecord({
    confirmationId: CONFIRMATION_ID,
    programId: PROGRAM_ID,
    demandId: DEMAND_ID,
    title: "确认 RH-2 Event Sourcing 范围",
    documents: [{
      role: "user-confirmation",
      path: "decisions/event-sourcing.md",
      mediaType: "text/markdown",
      digest: DOCUMENT_DIGEST,
    }],
  }, {
    clock: () => RECORDED_AT,
  });

  equal(confirmation.recordedAt, RECORDED_AT);
  equal(confirmation.demandId, DEMAND_ID);
  equal(Object.hasOwn(confirmation, "confirmedBy"), false);
  deepEqual(
    parseLedgerAuthorityRecord(JSON.parse(
      renderLedgerAuthorityRecord(confirmation),
    )),
    confirmation,
  );
});
