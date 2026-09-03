import { deepEqual, equal, rejects } from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { renderWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3-document.js";
import { parseWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { decodeUtf8 } from "../../../src/foundation/text/utf8.js";
import {
  materializeLedgerAuthorityPublicationPayload,
  LedgerAuthorityPublicationPayloadMaterializationError,
} from "../../../src/governance/ledger/ledger-authority-publication-payload-materializer.js";
import { LedgerAuthorityPublicationPlanningService } from "../../../src/governance/ledger/ledger-authority-publication-planning-service.js";
import type { LedgerAuthorityMemberInput } from "../../../src/governance/ledger/ledger-authority-store.js";
import { createMinimalWakeflowConfigV3 } from "../../configuration/wakeflow-config-v3.fixture.js";
import {
  cleanupLedgerAuthorityPublicationFixture,
  confirmationPublicationInput,
  createLedgerAuthorityPublicationFixture,
  ledgerAuthorityPublicationContents,
  ledgerAuthorityPublicationUuidFactory,
  requirementPublicationInput,
  CONFIRMATION_TEXT,
  CONFIRMATION_UUID,
  DEMAND_UUID,
  ORIGINAL_PLAN_PATH,
  ORIGINAL_PLAN_TEXT,
  RECORDED_AT,
  REQUIREMENT_DESIGN_PATH,
  REQUIREMENT_DESIGN_TEXT,
  REQUIREMENT_UUID,
} from "./ledger-authority-publication.fixture.js";

function expectMaterializationError(
  reason: LedgerAuthorityPublicationPayloadMaterializationError["reason"],
) {
  return (error: unknown) =>
    error instanceof LedgerAuthorityPublicationPayloadMaterializationError
    && error.reason === reason;
}

test("Ledger authority Payload Materializer returns exact Store bytes without writes", async (t) => {
  const fixture = await createLedgerAuthorityPublicationFixture();
  try {
    const planning = new LedgerAuthorityPublicationPlanningService(
      fixture.workspaceRoot,
    );
    const requirementPlan = (
      await planning.previewRequirement(requirementPublicationInput(), {
        uuidFactory: ledgerAuthorityPublicationUuidFactory(
          [REQUIREMENT_UUID],
          { value: 0 },
        ),
        clock: () => RECORDED_AT,
      })
    ).plan;
    const confirmationPlan = (
      await planning.previewConfirmation(confirmationPublicationInput(), {
        uuidFactory: ledgerAuthorityPublicationUuidFactory(
          [CONFIRMATION_UUID, DEMAND_UUID],
          { value: 0 },
        ),
        clock: () => RECORDED_AT,
      })
    ).plan;

    await t.test("both families materialize in canonical member order", async () => {
      const requirementPayload =
        await materializeLedgerAuthorityPublicationPayload(
          fixture.workspaceRoot,
          requirementPlan,
        );
      const storePayload: readonly Readonly<LedgerAuthorityMemberInput>[] =
        requirementPayload;
      deepEqual(storePayload.map((member) => member.path), [
        ORIGINAL_PLAN_PATH,
        REQUIREMENT_DESIGN_PATH,
      ]);
      deepEqual(storePayload.map((member) => decodeUtf8(member.bytes)), [
        ORIGINAL_PLAN_TEXT,
        REQUIREMENT_DESIGN_TEXT,
      ]);
      equal(
        computeSha256Digest(storePayload[0]?.bytes ?? new Uint8Array()),
        requirementPlan.intent.record.documents[0]?.digest,
      );
      equal(Object.isFrozen(requirementPayload), true);
      equal(Object.isFrozen(requirementPayload[0]), true);

      const confirmationPayload =
        await materializeLedgerAuthorityPublicationPayload(
          fixture.workspaceRoot,
          confirmationPlan,
        );
      equal(confirmationPayload.length, 1);
      equal(confirmationPayload[0]?.path, "decisions/goal-stage.md");
      equal(
        decodeUtf8(confirmationPayload[0]?.bytes ?? new Uint8Array()),
        CONFIRMATION_TEXT,
      );
      deepEqual(ledgerAuthorityPublicationContents(fixture), {
        requirements: [],
        confirmations: [],
        transactions: [],
      });
      equal(existsSync(path.join(fixture.workspacePath, ".wakeflow-active")), false);
    });

    await t.test("payload bytes are fresh copies rather than a process cache", async () => {
      const first = await materializeLedgerAuthorityPublicationPayload(
        fixture.workspaceRoot,
        requirementPlan,
      );
      const firstMember = first[0];
      if (firstMember === undefined) throw new Error("Expected payload member.");
      firstMember.bytes[0] = 0;
      const second = await materializeLedgerAuthorityPublicationPayload(
        fixture.workspaceRoot,
        requirementPlan,
      );
      equal(decodeUtf8(second[0]?.bytes ?? new Uint8Array()), ORIGINAL_PLAN_TEXT);
      equal(firstMember.bytes === second[0]?.bytes, false);
    });

    await t.test("post-preview source drift is rejected without Ledger writes", async () => {
      writeFileSync(
        path.join(fixture.designPath, REQUIREMENT_DESIGN_PATH),
        "# Requirement changed after preview\n",
        { mode: 0o644 },
      );
      await rejects(
        materializeLedgerAuthorityPublicationPayload(
          fixture.workspaceRoot,
          requirementPlan,
        ),
        expectMaterializationError("source-changed"),
      );
      writeFileSync(
        path.join(fixture.designPath, REQUIREMENT_DESIGN_PATH),
        REQUIREMENT_DESIGN_TEXT,
        { mode: 0o644 },
      );
      deepEqual(ledgerAuthorityPublicationContents(fixture), {
        requirements: [],
        confirmations: [],
        transactions: [],
      });
    });

    await t.test("stale Config and malformed Plan fail before source disclosure", async () => {
      const changedConfig = createMinimalWakeflowConfigV3();
      (changedConfig.presentation as Record<string, unknown>).language =
        "zh-Hans";
      writeFileSync(
        path.join(fixture.workspacePath, "wakeflow.config.json"),
        renderWakeflowConfigV3(parseWakeflowConfigV3(changedConfig)),
        { mode: 0o644 },
      );
      await rejects(
        materializeLedgerAuthorityPublicationPayload(
          fixture.workspaceRoot,
          requirementPlan,
        ),
        expectMaterializationError("config"),
      );
      writeFileSync(
        path.join(fixture.workspacePath, "wakeflow.config.json"),
        renderWakeflowConfigV3(
          parseWakeflowConfigV3(createMinimalWakeflowConfigV3()),
        ),
        { mode: 0o644 },
      );
      await rejects(
        materializeLedgerAuthorityPublicationPayload(
          fixture.workspaceRoot,
          { ...requirementPlan, unknown: true },
        ),
        expectMaterializationError("plan"),
      );
    });

    await t.test("pre-aborted materialization performs no read or write", async () => {
      const controller = new AbortController();
      controller.abort();
      await rejects(
        materializeLedgerAuthorityPublicationPayload(
          fixture.workspaceRoot,
          requirementPlan,
          { signal: controller.signal },
        ),
        expectMaterializationError("aborted"),
      );
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
