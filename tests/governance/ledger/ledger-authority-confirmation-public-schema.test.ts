import { equal } from "node:assert/strict";
import { test } from "node:test";

import type { WakeflowConfirmationPublicationRequestV1 as ConfirmationRequestWire } from "../../../src/contracts/generated/entrypoints/wakeflow-confirmation-publication-request.generated.js";
import { WAKEFLOW_CONFIRMATION_PUBLICATION_REQUEST_SCHEMA } from "../../../src/contracts/generated/entrypoints/wakeflow-confirmation-publication-request.generated.js";
import type { WakeflowConfirmationPublicationResultV1 as ConfirmationResultWire } from "../../../src/contracts/generated/entrypoints/wakeflow-confirmation-publication-result.generated.js";
import { WAKEFLOW_CONFIRMATION_PUBLICATION_RESULT_SCHEMA } from "../../../src/contracts/generated/entrypoints/wakeflow-confirmation-publication-result.generated.js";
import { createRuntimeJsonSchemaValidator } from "../../../src/foundation/schema/runtime-json-schema.js";
import { LedgerAuthorityPublicationApplicationService } from "../../../src/governance/ledger/ledger-authority-publication-application-service.js";
import { LedgerAuthorityPublicationPlanningService } from "../../../src/governance/ledger/ledger-authority-publication-planning-service.js";
import {
  cleanupLedgerAuthorityPublicationFixture,
  confirmationPublicationInput,
  createLedgerAuthorityPublicationFixture,
  ledgerAuthorityPublicationUuidFactory,
  CONFIRMATION_UUID,
  DEMAND_UUID,
  RECORDED_AT,
} from "./ledger-authority-publication.fixture.js";

const validateRequest =
  createRuntimeJsonSchemaValidator<ConfirmationRequestWire>(
    WAKEFLOW_CONFIRMATION_PUBLICATION_REQUEST_SCHEMA,
  );
const validateResult =
  createRuntimeJsonSchemaValidator<ConfirmationResultWire>(
    WAKEFLOW_CONFIRMATION_PUBLICATION_RESULT_SCHEMA,
  );

test("Confirmation Publication公共Schema闭合owner派生future Demand与最小receipt", async () => {
  const fixture = await createLedgerAuthorityPublicationFixture();
  try {
    const authored = confirmationPublicationInput();
    const previewRequest = {
      root: fixture.workspacePath,
      mode: "preview",
      ...authored,
    } as const;
    equal(validateRequest(previewRequest).ok, true);
    equal(
      validateRequest({ ...previewRequest, family: "confirmation" }).ok,
      false,
    );
    equal(
      validateRequest({
        ...previewRequest,
        confirmationId: `confirmation_${CONFIRMATION_UUID}`,
      }).ok,
      false,
    );
    equal(
      validateRequest({
        ...previewRequest,
        demandId: `demand_${DEMAND_UUID}`,
      }).ok,
      false,
    );
    equal(
      validateRequest({
        ...previewRequest,
        documents: [{
          role: "requirement-design",
          path: "authority/requirement-design.md",
        }],
      }).ok,
      false,
    );
    equal(
      validateRequest({
        ...previewRequest,
        documents: [{
          role: "goal-stage-decision",
          path: "decisions/goal-stage.md",
          bytes: [1, 2, 3],
        }],
      }).ok,
      false,
    );

    const preview = await new LedgerAuthorityPublicationPlanningService(
      fixture.workspaceRoot,
    ).previewConfirmation(authored, {
      uuidFactory: ledgerAuthorityPublicationUuidFactory(
        [CONFIRMATION_UUID, DEMAND_UUID],
        { value: 0 },
      ),
      clock: () => RECORDED_AT,
    });
    if (preview.plan.intent.record.artifactKind !== "wakeflow-confirmation-record") {
      throw new Error("Expected Confirmation plan.");
    }
    equal(preview.plan.intent.record.demandId, `demand_${DEMAND_UUID}`);
    const previewResult = {
      kind: "WakeflowConfirmationPublicationPreviewResult",
      schemaVersion: 1,
      tool: "wakeflow_publish_confirmation",
      mode: "preview",
      status: "ready",
      plan: preview.plan,
      planDigest: preview.planDigest,
    } as const;
    equal(validateResult(previewResult).ok, true);

    const applyRequest = {
      root: fixture.workspacePath,
      mode: "apply",
      plan: preview.plan,
      planDigest: preview.planDigest,
    } as const;
    const recoverRequest = { ...applyRequest, mode: "recover" } as const;
    equal(validateRequest(applyRequest).ok, true);
    equal(validateRequest(recoverRequest).ok, true);
    equal(
      validateRequest({
        root: fixture.workspacePath,
        mode: "recover",
        confirmationId: `confirmation_${CONFIRMATION_UUID}`,
      }).ok,
      false,
    );

    const application = new LedgerAuthorityPublicationApplicationService(
      fixture.workspaceRoot,
    );
    const applied = await application.apply(preview.plan, preview.planDigest);
    if (applied.loaded.record.artifactKind !== "wakeflow-confirmation-record") {
      throw new Error("Expected Confirmation publication result.");
    }
    const publication = {
      publicationAuthority: "current",
      disposition: applied.disposition,
      confirmationId: applied.loaded.record.confirmationId,
      demandId: applied.loaded.record.demandId,
      recordRef: applied.loaded.recordRef,
      recordDigest: applied.loaded.recordDigest,
      memberReferences: applied.memberReferences,
    } as const;
    const applyResult = {
      kind: "WakeflowConfirmationPublicationApplyResult",
      schemaVersion: 1,
      tool: "wakeflow_publish_confirmation",
      mode: "apply",
      status: "current",
      planDigest: applied.planDigest,
      publication,
    } as const;
    equal(validateResult(applyResult).ok, true);
    equal(publication.demandId, `demand_${DEMAND_UUID}`);
    equal(JSON.stringify(applyResult).includes(fixture.workspacePath), false);
    equal(JSON.stringify(applyResult).includes("loaded"), false);

    const recovered = await application.recover(
      preview.plan,
      preview.planDigest,
    );
    const recoveryResult = {
      kind: "WakeflowConfirmationPublicationRecoveryResult",
      schemaVersion: 1,
      tool: "wakeflow_publish_confirmation",
      mode: "recover",
      status: "current",
      planDigest: recovered.planDigest,
      publication: {
        ...publication,
        disposition: recovered.disposition,
      },
    } as const;
    equal(validateResult(recoveryResult).ok, true);
    equal(
      validateResult({
        ...recoveryResult,
        publication: {
          ...recoveryResult.publication,
          disposition: "published",
        },
      }).ok,
      false,
    );

    const { demandId: _demandId, ...publicationWithoutDemand } = publication;
    const missingDemand = {
      ...applyResult,
      publication: publicationWithoutDemand,
    };
    equal(validateResult(missingDemand).ok, false);
    const wrongFamily = structuredClone(applyResult) as unknown as {
      publication: {
        memberReferences: Array<{ family: string }>;
      };
    };
    wrongFamily.publication.memberReferences[0]!.family = "requirement";
    equal(validateResult(wrongFamily).ok, false);
    const wrongRole = structuredClone(applyResult) as unknown as {
      publication: {
        memberReferences: Array<{ role: string }>;
      };
    };
    wrongRole.publication.memberReferences[0]!.role = "requirement-design";
    equal(validateResult(wrongRole).ok, false);
  } finally {
    await cleanupLedgerAuthorityPublicationFixture(fixture);
  }
});
