import { deepEqual, equal, rejects } from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import {
  LedgerAuthorityPublicationPlanningService,
  LedgerAuthorityPublicationPlanningServiceError,
} from "../../../src/governance/ledger/ledger-authority-publication-planning-service.js";
import { computeLedgerAuthorityPublicationPlanDigest } from "../../../src/governance/ledger/ledger-authority-publication-plan.js";
import {
  cleanupLedgerAuthorityPublicationFixture,
  confirmationPublicationInput,
  createLedgerAuthorityPublicationFixture,
  ledgerAuthorityPublicationContents,
  ledgerAuthorityPublicationUuidFactory,
  requirementPublicationInput,
  CONFIRMATION_UUID,
  DEMAND_UUID,
  ORIGINAL_PLAN_PATH,
  ORIGINAL_PLAN_TEXT,
  RECORDED_AT,
  REQUIREMENT_DESIGN_PATH,
  REQUIREMENT_DESIGN_TEXT,
  REQUIREMENT_UUID,
  TEST_SURFACE_ID,
} from "./ledger-authority-publication.fixture.js";

function expectPlanningError(
  reason: LedgerAuthorityPublicationPlanningServiceError["reason"],
) {
  return (error: unknown) =>
    error instanceof LedgerAuthorityPublicationPlanningServiceError
    && error.reason === reason;
}

test("Ledger authority Planning derives closed zero-write plans from Design Markdown", async (t) => {
  const fixture = await createLedgerAuthorityPublicationFixture();
  try {
    const service = new LedgerAuthorityPublicationPlanningService(
      fixture.workspaceRoot,
    );

    await t.test("Requirement and Confirmation allocate only owner fields", async () => {
      const requirementCalls = { value: 0 };
      const requirementClockCalls = { value: 0 };
      const requirement = await service.previewRequirement(
        requirementPublicationInput(),
        {
          uuidFactory: ledgerAuthorityPublicationUuidFactory(
            [REQUIREMENT_UUID],
            requirementCalls,
          ),
          clock: () => {
            requirementClockCalls.value += 1;
            return RECORDED_AT;
          },
        },
      );
      const requirementRecord = requirement.plan.intent.record;
      equal(requirementRecord.artifactKind, "wakeflow-requirement-record");
      if (requirementRecord.artifactKind !== "wakeflow-requirement-record") {
        throw new Error("Expected Requirement record.");
      }
      equal(
        requirementRecord.requirementId,
        `requirement_${REQUIREMENT_UUID}`,
      );
      equal(requirementRecord.recordedAt, RECORDED_AT);
      deepEqual(
        requirementRecord.documents.map(({ role, path: memberPath }) => ({
          role,
          path: memberPath,
        })),
        [
          { role: "original-plan", path: ORIGINAL_PLAN_PATH },
          { role: "requirement-design", path: REQUIREMENT_DESIGN_PATH },
        ],
      );
      equal(
        requirementRecord.documents[0]?.digest,
        computeSha256Digest(encodeUtf8(ORIGINAL_PLAN_TEXT)),
      );
      equal(requirement.plan.intent.treePlan.files.length, 3);
      equal(
        requirement.planDigest,
        computeLedgerAuthorityPublicationPlanDigest(requirement.plan),
      );
      equal(JSON.stringify(requirement.plan).includes(ORIGINAL_PLAN_TEXT), false);
      equal(requirementCalls.value, 1);
      equal(requirementClockCalls.value, 1);

      const confirmationCalls = { value: 0 };
      const confirmationClockCalls = { value: 0 };
      const confirmation = await service.previewConfirmation(
        confirmationPublicationInput(),
        {
          uuidFactory: ledgerAuthorityPublicationUuidFactory(
            [CONFIRMATION_UUID, DEMAND_UUID],
            confirmationCalls,
          ),
          clock: () => {
            confirmationClockCalls.value += 1;
            return RECORDED_AT;
          },
        },
      );
      const confirmationRecord = confirmation.plan.intent.record;
      equal(confirmationRecord.artifactKind, "wakeflow-confirmation-record");
      if (confirmationRecord.artifactKind !== "wakeflow-confirmation-record") {
        throw new Error("Expected Confirmation record.");
      }
      equal(
        confirmationRecord.confirmationId,
        `confirmation_${CONFIRMATION_UUID}`,
      );
      equal(confirmationRecord.demandId, `demand_${DEMAND_UUID}`);
      equal(confirmationRecord.recordedAt, RECORDED_AT);
      equal(confirmationCalls.value, 2);
      equal(confirmationClockCalls.value, 1);

      deepEqual(ledgerAuthorityPublicationContents(fixture), {
        requirements: [],
        confirmations: [],
        transactions: [],
      });
      equal(existsSync(path.join(fixture.workspacePath, ".wakeflow-active")), false);
    });

    await t.test("invalid Design selection and text fail before allocation", async () => {
      for (const [input, expectedReason] of [
        [requirementPublicationInput(TEST_SURFACE_ID), "source-root"],
        [
          requirementPublicationInput(
            undefined,
            "authority/missing.md",
          ),
          "source",
        ],
      ] as const) {
        const calls = { value: 0 };
        await rejects(
          service.previewRequirement(input, {
            uuidFactory: ledgerAuthorityPublicationUuidFactory(
              [REQUIREMENT_UUID],
              calls,
            ),
          }),
          expectPlanningError(expectedReason),
        );
        equal(calls.value, 0);
      }

      writeFileSync(
        path.join(fixture.designPath, REQUIREMENT_DESIGN_PATH),
        "# Requirement design\r\n",
        { mode: 0o644 },
      );
      const calls = { value: 0 };
      await rejects(
        service.previewRequirement(requirementPublicationInput(), {
          uuidFactory: ledgerAuthorityPublicationUuidFactory(
            [REQUIREMENT_UUID],
            calls,
          ),
        }),
        expectPlanningError("source-profile"),
      );
      equal(calls.value, 0);
      writeFileSync(
        path.join(fixture.designPath, REQUIREMENT_DESIGN_PATH),
        REQUIREMENT_DESIGN_TEXT,
        { mode: 0o644 },
      );
    });

    await t.test("source drift between both passes fails before clock use", async () => {
      const uuidCalls = { value: 0 };
      const clockCalls = { value: 0 };
      await rejects(
        service.previewRequirement(requirementPublicationInput(), {
          uuidFactory: ledgerAuthorityPublicationUuidFactory(
            [REQUIREMENT_UUID],
            uuidCalls,
            () => writeFileSync(
              path.join(fixture.designPath, REQUIREMENT_DESIGN_PATH),
              "# Requirement design changed during planning\n",
              { mode: 0o644 },
            ),
          ),
          clock: () => {
            clockCalls.value += 1;
            return RECORDED_AT;
          },
        }),
        expectPlanningError("source-changed"),
      );
      equal(uuidCalls.value, 1);
      equal(clockCalls.value, 0);
      writeFileSync(
        path.join(fixture.designPath, REQUIREMENT_DESIGN_PATH),
        REQUIREMENT_DESIGN_TEXT,
        { mode: 0o644 },
      );
    });

    await t.test("occupied and duplicate generated identities fail closed", async () => {
      const occupiedId = `requirement_${REQUIREMENT_UUID}`;
      const occupiedPath = path.join(
        fixture.ledgerPath,
        "requirements",
        occupiedId,
      );
      mkdirSync(occupiedPath, { mode: 0o755 });
      const conflictClockCalls = { value: 0 };
      await rejects(
        service.previewRequirement(requirementPublicationInput(), {
          uuidFactory: ledgerAuthorityPublicationUuidFactory(
            [REQUIREMENT_UUID],
            { value: 0 },
          ),
          clock: () => {
            conflictClockCalls.value += 1;
            return RECORDED_AT;
          },
        }),
        expectPlanningError("conflict"),
      );
      equal(conflictClockCalls.value, 0);
      rmSync(occupiedPath, { recursive: true, force: true });

      const duplicateCalls = { value: 0 };
      const duplicateClockCalls = { value: 0 };
      await rejects(
        service.previewConfirmation(confirmationPublicationInput(), {
          uuidFactory: ledgerAuthorityPublicationUuidFactory(
            [CONFIRMATION_UUID, CONFIRMATION_UUID],
            duplicateCalls,
          ),
          clock: () => {
            duplicateClockCalls.value += 1;
            return RECORDED_AT;
          },
        }),
        expectPlanningError("identity"),
      );
      equal(duplicateCalls.value, 2);
      equal(duplicateClockCalls.value, 0);
      deepEqual(ledgerAuthorityPublicationContents(fixture), {
        requirements: [],
        confirmations: [],
        transactions: [],
      });
    });
  } finally {
    await cleanupLedgerAuthorityPublicationFixture(fixture);
  }
});
