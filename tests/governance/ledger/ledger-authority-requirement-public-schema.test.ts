import { equal } from "node:assert/strict";
import { test } from "node:test";

import type { WakeflowRequirementPublicationRequestV1 as RequirementRequestWire } from "../../../src/contracts/generated/entrypoints/wakeflow-requirement-publication-request.generated.js";
import { WAKEFLOW_REQUIREMENT_PUBLICATION_REQUEST_SCHEMA } from "../../../src/contracts/generated/entrypoints/wakeflow-requirement-publication-request.generated.js";
import type { WakeflowRequirementPublicationResultV1 as RequirementResultWire } from "../../../src/contracts/generated/entrypoints/wakeflow-requirement-publication-result.generated.js";
import { WAKEFLOW_REQUIREMENT_PUBLICATION_RESULT_SCHEMA } from "../../../src/contracts/generated/entrypoints/wakeflow-requirement-publication-result.generated.js";
import { createRuntimeJsonSchemaValidator } from "../../../src/foundation/schema/runtime-json-schema.js";
import { LedgerAuthorityPublicationApplicationService } from "../../../src/governance/ledger/ledger-authority-publication-application-service.js";
import { LedgerAuthorityPublicationPlanningService } from "../../../src/governance/ledger/ledger-authority-publication-planning-service.js";
import {
  cleanupLedgerAuthorityPublicationFixture,
  createLedgerAuthorityPublicationFixture,
  ledgerAuthorityPublicationUuidFactory,
  requirementPublicationInput,
  RECORDED_AT,
  REQUIREMENT_UUID,
} from "./ledger-authority-publication.fixture.js";

const validateRequest =
  createRuntimeJsonSchemaValidator<RequirementRequestWire>(
    WAKEFLOW_REQUIREMENT_PUBLICATION_REQUEST_SCHEMA,
  );
const validateResult = createRuntimeJsonSchemaValidator<RequirementResultWire>(
  WAKEFLOW_REQUIREMENT_PUBLICATION_RESULT_SCHEMA,
);

test("Requirement Publication公共Schema闭合真实preview/apply/recover且不泄露内部状态", async () => {
  const fixture = await createLedgerAuthorityPublicationFixture();
  try {
    const authored = requirementPublicationInput();
    const previewRequest = {
      root: fixture.workspacePath,
      mode: "preview",
      ...authored,
    } as const;
    equal(validateRequest(previewRequest).ok, true);
    equal(
      validateRequest({ ...previewRequest, family: "requirement" }).ok,
      false,
    );
    equal(
      validateRequest({
        ...previewRequest,
        requirementId: `requirement_${REQUIREMENT_UUID}`,
      }).ok,
      false,
    );
    equal(
      validateRequest({
        ...previewRequest,
        documents: [{
          role: "goal-stage-decision",
          path: "decisions/goal.md",
        }],
      }).ok,
      false,
    );
    equal(
      validateRequest({
        ...previewRequest,
        documents: [{
          role: "requirement-design",
          path: "authority/requirement-design.md",
          content: "# Inline bytes are forbidden\n",
        }],
      }).ok,
      false,
    );
    equal(
      validateRequest({
        ...previewRequest,
        documents: [{
          role: "requirement-design",
          path: ".git/requirement.md",
        }],
      }).ok,
      false,
    );

    const planning = new LedgerAuthorityPublicationPlanningService(
      fixture.workspaceRoot,
    );
    const preview = await planning.previewRequirement(authored, {
      uuidFactory: ledgerAuthorityPublicationUuidFactory(
        [REQUIREMENT_UUID],
        { value: 0 },
      ),
      clock: () => RECORDED_AT,
    });
    const previewResult = {
      kind: "WakeflowRequirementPublicationPreviewResult",
      schemaVersion: 1,
      tool: "wakeflow_publish_requirement",
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
    const recoverRequest = {
      ...applyRequest,
      mode: "recover",
    } as const;
    equal(validateRequest(applyRequest).ok, true);
    equal(validateRequest(recoverRequest).ok, true);
    equal(
      validateRequest({
        root: fixture.workspacePath,
        mode: "recover",
        requirementId: `requirement_${REQUIREMENT_UUID}`,
      }).ok,
      false,
    );
    equal(
      validateRequest({
        root: fixture.workspacePath,
        mode: "recover",
        plan: preview.plan,
      }).ok,
      false,
    );

    const application = new LedgerAuthorityPublicationApplicationService(
      fixture.workspaceRoot,
    );
    const applied = await application.apply(preview.plan, preview.planDigest);
    if (applied.loaded.record.artifactKind !== "wakeflow-requirement-record") {
      throw new Error("Expected Requirement publication result.");
    }
    const publication = {
      publicationAuthority: "current",
      disposition: applied.disposition,
      requirementId: applied.loaded.record.requirementId,
      recordRef: applied.loaded.recordRef,
      recordDigest: applied.loaded.recordDigest,
      memberReferences: applied.memberReferences,
    } as const;
    const applyResult = {
      kind: "WakeflowRequirementPublicationApplyResult",
      schemaVersion: 1,
      tool: "wakeflow_publish_requirement",
      mode: "apply",
      status: "current",
      planDigest: applied.planDigest,
      publication,
    } as const;
    equal(validateResult(applyResult).ok, true);
    equal(JSON.stringify(applyResult).includes(fixture.workspacePath), false);
    equal(JSON.stringify(applyResult).includes("inodeId"), false);
    equal(JSON.stringify(applyResult).includes("loaded"), false);

    const recovered = await application.recover(
      preview.plan,
      preview.planDigest,
    );
    const recoveryResult = {
      kind: "WakeflowRequirementPublicationRecoveryResult",
      schemaVersion: 1,
      tool: "wakeflow_publish_requirement",
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

    const wrongFamily = structuredClone(applyResult) as unknown as {
      publication: {
        memberReferences: Array<{ family: string }>;
      };
    };
    wrongFamily.publication.memberReferences[0]!.family = "confirmation";
    equal(validateResult(wrongFamily).ok, false);
    const wrongMediaType = structuredClone(applyResult) as unknown as {
      publication: {
        memberReferences: Array<{ mediaType: string }>;
      };
    };
    wrongMediaType.publication.memberReferences[0]!.mediaType = "text/plain";
    equal(validateResult(wrongMediaType).ok, false);
    const leakedLoaded = structuredClone(applyResult) as typeof applyResult & {
      loaded?: { readonly recordRef: string };
    };
    leakedLoaded.loaded = { recordRef: applied.loaded.recordRef };
    equal(validateResult(leakedLoaded).ok, false);
  } finally {
    await cleanupLedgerAuthorityPublicationFixture(fixture);
  }
});
