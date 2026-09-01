import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { parseWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3.js";
import { executeDemandControllerRoutePublicRequest } from "../../../src/governance/controller/demand-controller-route-public-coordinator.js";
import {
  parseTargetDeliveryPreparationPublicRequest,
  TargetDeliveryPreparationPublicContractError,
} from "../../../src/governance/delivery/target-delivery-preparation-public-contract.js";
import {
  executeTargetDeliveryPreparationPublicRequest,
  TargetDeliveryPreparationPublicCoordinatorError,
} from "../../../src/governance/delivery/target-delivery-preparation-public-coordinator.js";
import { windowWorkClaimRef } from "../../../src/governance/delivery/window-work-claim-resource-catalog.js";
import { TargetHostEffectClaimService } from "../../../src/governance/delivery/target-host-effect-claim-service.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { materializeWakeflowSharedCoordinationLayout } from "../../../src/workspace/wakeflow-shared-coordination-layout.js";
import { compileWakeflowWindowRuntimeDesiredTopology } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-desired-topology.js";
import { createMinimalWakeflowConfigV3 } from "../../configuration/wakeflow-config-v3.fixture.js";
import {
  cleanupTargetDeliveryPreparationWorkspaceFixture,
  createTargetDeliveryPreparationWorkspaceFixture,
  deliveryUuidFactory,
  DELIVERY_PREPARED_AT,
} from "./target-delivery-preparation-service.fixture.js";
import {
  claimUuidFactory,
  CLAIMED_AT,
  CLAIM_OBSERVED_AT,
} from "./target-host-effect-claim-service.fixture.js";

const CODEX_PREPARATION_FACADE = Object.freeze({
  hostId: "codex" as const,
  resourceProfile: codexWorkspaceHostResourceProfile,
  identityProfile: codexWindowHostIdentityProfile,
});

const DEMAND_ID = "demand_11111111-1111-4111-8111-111111111111" as const;
const TARGET_TASK_ID =
  "target-task_22222222-2222-4222-8222-222222222222" as const;

test("Preparation Public Contract拒绝非JSON、超容量和开放字段", () => {
  const request = parseTargetDeliveryPreparationPublicRequest({
    root: "/tmp/wakeflow",
    mode: "preview",
    demandId: DEMAND_ID,
    targetTaskId: TARGET_TASK_ID,
  });
  equal(request.mode, "preview");
  equal(Object.isFrozen(request), true);

  throws(
    () =>
      parseTargetDeliveryPreparationPublicRequest({
        ...request,
        hostAction: "send",
      }),
    (error: unknown) =>
      error instanceof TargetDeliveryPreparationPublicContractError &&
      error.reason === "schema",
  );
  throws(
    () => parseTargetDeliveryPreparationPublicRequest(new Proxy(request, {})),
    (error: unknown) =>
      error instanceof TargetDeliveryPreparationPublicContractError &&
      error.reason === "json",
  );
  throws(
    () =>
      parseTargetDeliveryPreparationPublicRequest({
        root: `/${"x".repeat(600 * 1024)}`,
        mode: "preview",
        demandId: DEMAND_ID,
        targetTaskId: TARGET_TASK_ID,
      }),
    (error: unknown) =>
      error instanceof TargetDeliveryPreparationPublicContractError &&
      error.reason === "capacity",
  );
});

test("Preparation Public Coordinator闭合preview/apply/route且不取得Claim", async () => {
  const fixture = await createTargetDeliveryPreparationWorkspaceFixture();
  try {
    const routeBefore = await executeDemandControllerRoutePublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.request.demandId,
    });
    const preview = await executeTargetDeliveryPreparationPublicRequest(
      CODEX_PREPARATION_FACADE,
      {
        root: fixture.workspacePath,
        mode: "preview",
        demandId: fixture.request.demandId,
        targetTaskId: fixture.targetTaskId,
      },
      {
        preview: {
          clock: () => DELIVERY_PREPARED_AT,
          uuidFactory: deliveryUuidFactory(),
        },
      },
    );
    if (preview.mode !== "preview") {
      throw new Error("Expected a Preparation preview result.");
    }
    equal(Object.isFrozen(preview), true);
    equal(Object.isFrozen(preview.plan.intent.target), true);
    equal(JSON.stringify(preview).includes(fixture.workspacePath), false);
    equal(JSON.stringify(preview).includes(fixture.rawHandle), false);
    equal(readdirSync(fixture.bindingRootPath).length, 1);

    const routeAfterPreview = await executeDemandControllerRoutePublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.request.demandId,
    });
    deepEqual(routeAfterPreview, routeBefore);

    const claimPath = path.join(
      fixture.workspacePath,
      ...windowWorkClaimRef(preview.plan.intent.route.windowId).split("/"),
    );
    equal(existsSync(claimPath), false);

    await rejects(
      executeTargetDeliveryPreparationPublicRequest(CODEX_PREPARATION_FACADE, {
        root: fixture.workspacePath,
        mode: "apply",
        plan: preview.plan,
        planDigest: `sha256:${"f".repeat(64)}`,
      }),
      (error: unknown) =>
        error instanceof TargetDeliveryPreparationPublicCoordinatorError &&
        error.reason === "apply" &&
        error.causeCode === "wakeflow-target-delivery-preparation-service" &&
        error.causeReason === "plan" &&
        error.eventAuthority === "unchanged",
    );

    const applied = await executeTargetDeliveryPreparationPublicRequest(
      CODEX_PREPARATION_FACADE,
      {
        root: fixture.workspacePath,
        mode: "apply",
        plan: preview.plan,
        planDigest: preview.planDigest,
      },
    );
    if (applied.mode !== "apply") {
      throw new Error("Expected a Preparation apply result.");
    }
    equal(applied.disposition, "committed");
    equal(applied.eventAuthority, "current");
    equal(applied.targetDelivery.phase, "delivery-prepared");
    equal(applied.targetDelivery.purpose, "initial");
    equal(applied.targetDelivery.bindingId, fixture.bindingId);
    equal(JSON.stringify(applied).includes(fixture.workspacePath), false);
    equal(JSON.stringify(applied).includes(fixture.rawHandle), false);
    equal(existsSync(claimPath), false);
    equal(readdirSync(fixture.bindingRootPath).length, 1);

    const routeAfterApply = await executeDemandControllerRoutePublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.request.demandId,
    });
    equal(routeAfterApply.route.observedEventStream.streamRevision, 3);
    equal(
      routeAfterApply.route.frontiers[0]?.kind,
      "implementation-host-effect-claim",
    );

    const replayed = await executeTargetDeliveryPreparationPublicRequest(
      CODEX_PREPARATION_FACADE,
      {
        root: fixture.workspacePath,
        mode: "apply",
        plan: preview.plan,
        planDigest: preview.planDigest,
      },
    );
    if (replayed.mode !== "apply") {
      throw new Error("Expected a replayed Preparation apply result.");
    }
    equal(replayed.disposition, "idempotent");
    equal(
      JSON.stringify({ ...replayed, disposition: "committed" }),
      JSON.stringify(applied),
    );
    equal(existsSync(claimPath), false);

    await materializeWakeflowSharedCoordinationLayout(fixture.workspaceRoot, {
      mode: "ensure",
    });
    const config = parseWakeflowConfigV3(createMinimalWakeflowConfigV3());
    const desired = compileWakeflowWindowRuntimeDesiredTopology(
      config,
      codexWorkspaceHostResourceProfile,
    ).windows.find(
      (entry) => entry.windowId === preview.plan.intent.route.windowId,
    );
    if (desired === undefined) {
      throw new Error("Expected the configured product window.");
    }
    const claimed = await new TargetHostEffectClaimService(
      fixture.workspaceRoot,
      codexWorkspaceHostResourceProfile,
      codexWindowHostIdentityProfile,
    ).claim(
      {
        workType: "implementation",
        demandId: preview.plan.demandId,
        targetTaskId: preview.plan.targetTaskId,
        targetDeliveryId: preview.plan.intent.targetDeliveryId,
        intentDigest: preview.plan.intent.intentDigest,
        observation: {
          kind: "WakeflowAgentHostWindowObservation",
          schemaVersion: 1,
          source: "agent-host-inspection-result",
          hostId: "codex",
          windowId: preview.plan.intent.route.windowId,
          bindingId: fixture.bindingId,
          handle: {
            kind: "codex-thread",
            value: fixture.rawHandle,
          },
          attestedRoot: {
            status: "matches-configured-root",
            logicalRoot: desired.logicalRoot,
            configuredPlacement: desired.configuredPlacement,
          },
          observedAt: CLAIM_OBSERVED_AT,
        },
      },
      {
        clock: () => CLAIMED_AT,
        uuidFactory: claimUuidFactory(),
      },
    );
    equal(claimed.status, "issued");
    equal(existsSync(claimPath), true);

    const lateReplay = await executeTargetDeliveryPreparationPublicRequest(
      CODEX_PREPARATION_FACADE,
      {
        root: fixture.workspacePath,
        mode: "apply",
        plan: preview.plan,
        planDigest: preview.planDigest,
      },
    );
    if (lateReplay.mode !== "apply") {
      throw new Error("Expected a late Preparation replay result.");
    }
    equal(lateReplay.disposition, "idempotent");
    equal(lateReplay.event.streamRevision, 3);
    equal(lateReplay.stateDigest, applied.stateDigest);
    equal(lateReplay.targetDelivery.phase, "delivery-prepared");
    equal(existsSync(claimPath), true);
    equal(JSON.stringify(lateReplay).includes(fixture.rawHandle), false);

    const routeAfterClaim = await executeDemandControllerRoutePublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.request.demandId,
    });
    equal(routeAfterClaim.route.observedEventStream.streamRevision, 4);
    equal(
      routeAfterClaim.route.frontiers[0]?.kind,
      "implementation-host-effect-execution",
    );
  } finally {
    await cleanupTargetDeliveryPreparationWorkspaceFixture(fixture);
  }
});

test("Preparation Public Coordinator固定宿主并稳定分类root错误", async () => {
  await rejects(
    executeTargetDeliveryPreparationPublicRequest(
      {
        ...CODEX_PREPARATION_FACADE,
      },
      {
        root: "/missing",
        mode: "preview",
        demandId: DEMAND_ID,
        targetTaskId: TARGET_TASK_ID,
      },
    ),
    (error: unknown) =>
      error instanceof TargetDeliveryPreparationPublicCoordinatorError &&
      error.reason === "host" &&
      error.eventAuthority === "unchanged",
  );

  await rejects(
    executeTargetDeliveryPreparationPublicRequest(CODEX_PREPARATION_FACADE, {
      root: "/definitely/missing/wakeflow-workspace",
      mode: "preview",
      demandId: DEMAND_ID,
      targetTaskId: TARGET_TASK_ID,
    }),
    (error: unknown) =>
      error instanceof TargetDeliveryPreparationPublicCoordinatorError &&
      error.reason === "root" &&
      error.eventAuthority === "unchanged",
  );
});
