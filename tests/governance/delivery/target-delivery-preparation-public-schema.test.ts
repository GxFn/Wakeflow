import { equal } from "node:assert/strict";
import { test } from "node:test";

import type { WakeflowTargetDeliveryPreparationRequestV1 as PreparationRequestWire } from "../../../src/contracts/generated/entrypoints/wakeflow-target-delivery-preparation-request.generated.js";
import { WAKEFLOW_TARGET_DELIVERY_PREPARATION_REQUEST_SCHEMA } from "../../../src/contracts/generated/entrypoints/wakeflow-target-delivery-preparation-request.generated.js";
import type { WakeflowTargetDeliveryPreparationResultV1 as PreparationResultWire } from "../../../src/contracts/generated/entrypoints/wakeflow-target-delivery-preparation-result.generated.js";
import { WAKEFLOW_TARGET_DELIVERY_PREPARATION_RESULT_SCHEMA } from "../../../src/contracts/generated/entrypoints/wakeflow-target-delivery-preparation-result.generated.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { createRuntimeJsonSchemaValidator } from "../../../src/foundation/schema/runtime-json-schema.js";
import { targetDeliveryPurpose } from "../../../src/governance/delivery/target-delivery-intent.js";
import { TargetDeliveryPreparationService } from "../../../src/governance/delivery/target-delivery-preparation-service.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  cleanupTargetDeliveryPreparationWorkspaceFixture,
  createTargetDeliveryPreparationWorkspaceFixture,
  deliveryUuidFactory,
  DELIVERY_PREPARED_AT,
} from "./target-delivery-preparation-service.fixture.js";

const validateRequest =
  createRuntimeJsonSchemaValidator<PreparationRequestWire>(
    WAKEFLOW_TARGET_DELIVERY_PREPARATION_REQUEST_SCHEMA,
  );
const validateResult = createRuntimeJsonSchemaValidator<PreparationResultWire>(
  WAKEFLOW_TARGET_DELIVERY_PREPARATION_RESULT_SCHEMA,
);

function service(root: RootedDirectory): TargetDeliveryPreparationService {
  return new TargetDeliveryPreparationService(
    root,
    codexWorkspaceHostResourceProfile,
    codexWindowHostIdentityProfile,
  );
}

test("Target Delivery Preparation公共Schema闭合真实preview/apply且不承载宿主效果", async () => {
  const fixture = await createTargetDeliveryPreparationWorkspaceFixture();
  try {
    const previewRequest = {
      root: fixture.workspacePath,
      mode: "preview",
      demandId: fixture.request.demandId,
      targetTaskId: fixture.targetTaskId,
    } as const;
    equal(validateRequest(previewRequest).ok, true);
    equal(validateRequest({ ...previewRequest, hostAction: "send" }).ok, false);

    const preparation = service(fixture.workspaceRoot);
    const preview = await preparation.preview(
      {
        demandId: previewRequest.demandId,
        targetTaskId: previewRequest.targetTaskId,
      },
      {
        clock: () => DELIVERY_PREPARED_AT,
        uuidFactory: deliveryUuidFactory(),
      },
    );
    const previewResult = {
      kind: "WakeflowTargetDeliveryPreparationPreviewResult",
      schemaVersion: 1,
      tool: "wakeflow_prepare_implementation_delivery",
      mode: "preview",
      status: "ready",
      plan: preview.plan,
      planDigest: preview.planDigest,
    } as const;
    equal(validateResult(previewResult).ok, true);
    equal(JSON.stringify(previewResult).includes(fixture.rawHandle), false);

    const applyRequest = {
      root: fixture.workspacePath,
      mode: "apply",
      plan: preview.plan,
      planDigest: preview.planDigest,
    } as const;
    equal(validateRequest(applyRequest).ok, true);
    equal(
      validateRequest({ ...applyRequest, targetTaskId: fixture.targetTaskId })
        .ok,
      false,
    );

    const applied = await preparation.apply(preview.plan, preview.planDigest);
    const event = applied.commandResult.commit.events[0];
    const target = applied.commandResult.aggregate.state.targetTasks.find(
      (entry) => entry.targetTaskId === preview.plan.targetTaskId,
    );
    if (
      event === undefined ||
      target === undefined ||
      target.workType === "test" ||
      target.phase !== "delivery-prepared"
    ) {
      throw new Error("Expected one prepared implementation Delivery.");
    }
    const applyResult = {
      kind: "WakeflowTargetDeliveryPreparationApplyResult",
      schemaVersion: 1,
      tool: "wakeflow_prepare_implementation_delivery",
      mode: "apply",
      status: "completed",
      disposition: applied.disposition,
      eventAuthority: "current",
      demandId: preview.plan.demandId,
      planDigest: applied.planDigest,
      commandDigest: applied.commandDigest,
      event: {
        eventId: event.eventId,
        streamRevision: event.streamRevision,
      },
      commit: {
        commitId: applied.commandResult.commit.commitId,
        commitSequence: applied.commandResult.commit.commitSequence,
        commitDigest: applied.commitDigest,
      },
      stateDigest: applied.commandResult.aggregate.stateDigest,
      targetDelivery: {
        purpose: targetDeliveryPurpose(preview.plan.intent),
        targetTaskId: target.targetTaskId,
        taskPackageId: target.taskPackageId,
        taskPackageDigest: target.taskPackageDigest,
        targetDeliveryId: target.currentDelivery.targetDeliveryId,
        intentDigest: target.currentDelivery.intentDigest,
        hostId: target.currentDelivery.hostId,
        windowId: target.windowId,
        bindingId: target.currentDelivery.bindingId,
        phase: target.phase,
      },
    } as const;
    equal(validateResult(applyResult).ok, true);
    equal(JSON.stringify(applyResult).includes(fixture.rawHandle), false);

    const wrongPhase = structuredClone(applyResult) as unknown as {
      targetDelivery: { phase: string };
    };
    wrongPhase.targetDelivery.phase = "host-effect-claimed";
    equal(validateResult(wrongPhase).ok, false);

    const leakedAction = structuredClone(applyResult) as typeof applyResult & {
      hostAction?: string;
    };
    leakedAction.hostAction = "send";
    equal(validateResult(leakedAction).ok, false);
  } finally {
    await cleanupTargetDeliveryPreparationWorkspaceFixture(fixture);
  }
});
