import { equal, rejects } from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  executeConfirmationPublicationPublicRequest,
  executeRequirementPublicationPublicRequest,
  LedgerAuthorityPublicationPublicContractError,
  LedgerAuthorityPublicationPublicCoordinatorError,
} from "../../../src/governance/ledger/ledger-authority-public-coordinator.js";
import {
  cleanupLedgerAuthorityPublicationFixture,
  confirmationPublicationInput,
  createLedgerAuthorityPublicationFixture,
  ledgerAuthorityPublicationUuidFactory,
  requirementPublicationInput,
  CONFIRMATION_UUID,
  DEMAND_UUID,
  RECORDED_AT,
  REQUIREMENT_DESIGN_PATH,
  REQUIREMENT_DESIGN_TEXT,
  REQUIREMENT_UUID,
} from "./ledger-authority-publication.fixture.js";

function requirementPreviewOptions() {
  return {
    preview: {
      uuidFactory: ledgerAuthorityPublicationUuidFactory(
        [REQUIREMENT_UUID],
        { value: 0 },
      ),
      clock: () => RECORDED_AT,
    },
  };
}

function confirmationPreviewOptions() {
  return {
    preview: {
      uuidFactory: ledgerAuthorityPublicationUuidFactory(
        [CONFIRMATION_UUID, DEMAND_UUID],
        { value: 0 },
      ),
      clock: () => RECORDED_AT,
    },
  };
}

test("Ledger Authority Public Coordinator路由双family且只返回最小receipt", async (t) => {
  const fixture = await createLedgerAuthorityPublicationFixture();
  try {
    const requirementPreview =
      await executeRequirementPublicationPublicRequest(
        {
          root: fixture.workspacePath,
          mode: "preview",
          ...requirementPublicationInput(),
        },
        requirementPreviewOptions(),
      );
    if (requirementPreview.mode !== "preview") {
      throw new Error("Expected Requirement preview.");
    }
    equal(requirementPreview.tool, "wakeflow_publish_requirement");
    equal(JSON.stringify(requirementPreview).includes(fixture.workspacePath), false);

    await t.test("source drift maps to apply/unchanged before publication", async () => {
      writeFileSync(
        path.join(fixture.designPath, REQUIREMENT_DESIGN_PATH),
        "# Requirement changed after public preview\n",
        { mode: 0o644 },
      );
      await rejects(
        executeRequirementPublicationPublicRequest({
          root: fixture.workspacePath,
          mode: "apply",
          plan: requirementPreview.plan,
          planDigest: requirementPreview.planDigest,
        }),
        (error: unknown) =>
          error instanceof LedgerAuthorityPublicationPublicCoordinatorError
          && error.reason === "apply"
          && error.causeReason === "source-changed"
          && error.publicationAuthority === "unchanged",
      );
      writeFileSync(
        path.join(fixture.designPath, REQUIREMENT_DESIGN_PATH),
        REQUIREMENT_DESIGN_TEXT,
        { mode: 0o644 },
      );
    });

    const requirementApplied =
      await executeRequirementPublicationPublicRequest({
        root: fixture.workspacePath,
        mode: "apply",
        plan: requirementPreview.plan,
        planDigest: requirementPreview.planDigest,
      });
    if (requirementApplied.mode !== "apply") {
      throw new Error("Expected Requirement apply.");
    }
    equal(requirementApplied.status, "current");
    equal(requirementApplied.publication.disposition, "published");
    equal(
      requirementApplied.publication.requirementId,
      `requirement_${REQUIREMENT_UUID}`,
    );
    equal(JSON.stringify(requirementApplied).includes("loaded"), false);
    equal(JSON.stringify(requirementApplied).includes("inodeId"), false);

    const requirementRecovered =
      await executeRequirementPublicationPublicRequest({
        root: fixture.workspacePath,
        mode: "recover",
        plan: requirementPreview.plan,
        planDigest: requirementPreview.planDigest,
      });
    if (requirementRecovered.mode !== "recover") {
      throw new Error("Expected Requirement recover.");
    }
    equal(requirementRecovered.publication.disposition, "current");

    const confirmationPreview =
      await executeConfirmationPublicationPublicRequest(
        {
          root: fixture.workspacePath,
          mode: "preview",
          ...confirmationPublicationInput(),
        },
        confirmationPreviewOptions(),
      );
    if (confirmationPreview.mode !== "preview") {
      throw new Error("Expected Confirmation preview.");
    }
    const confirmationApplied =
      await executeConfirmationPublicationPublicRequest({
        root: fixture.workspacePath,
        mode: "apply",
        plan: confirmationPreview.plan,
        planDigest: confirmationPreview.planDigest,
      });
    if (confirmationApplied.mode !== "apply") {
      throw new Error("Expected Confirmation apply.");
    }
    equal(confirmationApplied.tool, "wakeflow_publish_confirmation");
    equal(
      confirmationApplied.publication.confirmationId,
      `confirmation_${CONFIRMATION_UUID}`,
    );
    equal(confirmationApplied.publication.demandId, `demand_${DEMAND_UUID}`);
    equal(JSON.stringify(confirmationApplied).includes(fixture.workspacePath), false);

    await t.test("cross-family Plan fails before Coordinator I/O", async () => {
      await rejects(
        executeConfirmationPublicationPublicRequest({
          root: "/path-that-must-not-open",
          mode: "apply",
          plan: requirementPreview.plan,
          planDigest: requirementPreview.planDigest,
        }),
        (error: unknown) =>
          error instanceof LedgerAuthorityPublicationPublicContractError
          && error.reason === "plan",
      );
      await rejects(
        executeRequirementPublicationPublicRequest({
          root: "/path-that-must-not-open",
          mode: "recover",
          plan: confirmationPreview.plan,
          planDigest: confirmationPreview.planDigest,
        }),
        (error: unknown) =>
          error instanceof LedgerAuthorityPublicationPublicContractError
          && error.reason === "plan",
      );
    });

    await t.test("privacy and invalid root remain unchanged", async () => {
      await rejects(
        executeRequirementPublicationPublicRequest(
          {
            root: fixture.workspacePath,
            mode: "preview",
            ...requirementPublicationInput(),
            title: `Do not disclose ${fixture.workspacePath}`,
          },
          requirementPreviewOptions(),
        ),
        (error: unknown) =>
          error instanceof LedgerAuthorityPublicationPublicCoordinatorError
          && error.reason === "privacy"
          && error.publicationAuthority === "unchanged",
      );
      await rejects(
        executeConfirmationPublicationPublicRequest(
          {
            root: path.join(fixture.fixtureRoot, "missing-workspace"),
            mode: "preview",
            ...confirmationPublicationInput(),
          },
          confirmationPreviewOptions(),
        ),
        (error: unknown) =>
          error instanceof LedgerAuthorityPublicationPublicCoordinatorError
          && error.reason === "root"
          && error.publicationAuthority === "unchanged",
      );
    });
  } finally {
    await cleanupLedgerAuthorityPublicationFixture(fixture);
  }
});
