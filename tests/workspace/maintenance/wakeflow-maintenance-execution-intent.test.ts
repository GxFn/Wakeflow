import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  computeWakeflowConfigV3Digest,
  parseWakeflowConfigV3,
} from "../../../src/configuration/wakeflow-config-v3.js";
import {
  claudeCodeWorkspaceHostResourceProfile,
} from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import {
  codexWorkspaceHostResourceProfile,
} from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  createWakeflowHostMaintenanceContribution,
} from "../../../src/workspace/maintenance/wakeflow-host-maintenance-contribution.js";
import {
  computeWakeflowMaintenanceExecutionIntentDigest,
  createWakeflowMaintenanceExecutionIntent,
  createWakeflowMaintenanceIntentResourceDeclaration,
  parseWakeflowMaintenanceExecutionIntent,
  parseWakeflowMaintenanceExecutionIntentDocument,
  renderWakeflowMaintenanceExecutionIntent,
  wakeflowMaintenanceExecutionPlanFromIntent,
  wakeflowMaintenanceExecutionRequestFromIntent,
  WakeflowMaintenanceExecutionIntentError,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-intent.js";
import {
  assertWakeflowMaintenanceExecutionIntentCapacity,
  WakeflowMaintenanceExecutionIntentStoreError,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-intent-store.js";
import {
  createWakeflowMaintenanceExecutionPlan,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-plan.js";
import {
  computeWakeflowStaticMaterializationPreviewDigest,
  parseWakeflowStaticMaterializationPreview,
} from "../../../src/workspace/maintenance/wakeflow-static-materialization-preview.js";
import {
  createWakeflowWorkspaceStaticResourceMatrix,
} from "../../../src/workspace/wakeflow-workspace-static-resource-matrix.js";
import {
  createMinimalWakeflowConfigV3,
} from "../../configuration/wakeflow-config-v3.fixture.js";

const OPERATION_ID =
  "maintenance_operation_11111111-1111-4111-8111-111111111111";
const PROFILES = Object.freeze([
  claudeCodeWorkspaceHostResourceProfile,
  codexWorkspaceHostResourceProfile,
]);

function fixture() {
  const config = parseWakeflowConfigV3(createMinimalWakeflowConfigV3());
  const desiredDigest = computeWakeflowConfigV3Digest(config);
  const matrix = createWakeflowWorkspaceStaticResourceMatrix(
    codexWorkspaceHostResourceProfile,
  );
  const basis = {
    kind: "WakeflowStaticMaterializationPreview" as const,
    schemaVersion: 1 as const,
    executionBoundary: "preview-only" as const,
    action: "fresh-initialize" as const,
    status: "ready" as const,
    currentConfigDigest: null,
    desiredConfigDigest: desiredDigest,
    matrixDigest: matrix.matrixDigest,
    coreLayoutInspectionDigest: desiredDigest,
    blockerCodes: Object.freeze([]),
    steps: Object.freeze([Object.freeze({
      stepId: "authority:config",
      kind: "publish-config" as const,
      ownerId: "config-authority",
      targetKey: "workspace.config-authority",
      sourceDigest: null,
      targetDigest: desiredDigest,
      dependsOn: Object.freeze([]),
    })]),
  };
  const preview = parseWakeflowStaticMaterializationPreview({
    ...basis,
    planDigest: computeWakeflowStaticMaterializationPreviewDigest(basis),
  });
  const plan = createWakeflowMaintenanceExecutionPlan(
    preview,
    codexWorkspaceHostResourceProfile,
    null,
  );
  const request = Object.freeze({
    action: "fresh-initialize" as const,
    desiredConfig: config,
    currentHostProfile: codexWorkspaceHostResourceProfile,
    hostProfiles: PROFILES,
  });
  return Object.freeze({ config, plan, request });
}

test("compact intent reconstructs the exact plan and request after restart", () => {
  const value = fixture();
  const intent = createWakeflowMaintenanceExecutionIntent(
    OPERATION_ID,
    value.plan,
    value.request,
    value.config,
  );
  deepEqual(intent.hostProfiles.map((entry) => entry.hostId), [
    "claude-code",
    "codex",
  ]);
  equal(intent.planDigest, value.plan.planDigest);
  equal(
    wakeflowMaintenanceExecutionPlanFromIntent(intent).planDigest,
    value.plan.planDigest,
  );
  const recoveredRequest = wakeflowMaintenanceExecutionRequestFromIntent(intent);
  equal(recoveredRequest.action, "fresh-initialize");
  equal(
    computeWakeflowConfigV3Digest(
      parseWakeflowConfigV3(recoveredRequest.desiredConfig),
    ),
    computeWakeflowConfigV3Digest(value.config),
  );

  const text = renderWakeflowMaintenanceExecutionIntent(intent);
  deepEqual(parseWakeflowMaintenanceExecutionIntentDocument(text), intent);
  equal(
    computeWakeflowMaintenanceExecutionIntentDigest(JSON.parse(text)),
    computeWakeflowMaintenanceExecutionIntentDigest(intent),
  );
  equal(text.includes("absolutePath"), false);
  equal(text.includes("lockToken"), false);
});

test("intent rejects desired Config or plan relation drift", () => {
  const value = fixture();
  const intent = createWakeflowMaintenanceExecutionIntent(
    OPERATION_ID,
    value.plan,
    value.request,
    value.config,
  );
  for (const candidate of [
    {
      ...intent,
      desiredConfig: {
        ...intent.desiredConfig,
        presentation: { language: "zh-Hans" },
      },
    },
    { ...intent, planDigest: intent.sharedPreview.planDigest },
  ]) {
    let caught: unknown;
    try {
      parseWakeflowMaintenanceExecutionIntent(candidate);
    } catch (error: unknown) {
      caught = error;
    }
    equal(caught instanceof WakeflowMaintenanceExecutionIntentError, true);
    if (caught instanceof WakeflowMaintenanceExecutionIntentError) {
      equal(caught.reason, "relation");
    }
  }
});

test("intent resource is a private immutable transaction artifact", () => {
  deepEqual(createWakeflowMaintenanceIntentResourceDeclaration(OPERATION_ID), {
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: `maintenance.transaction-intent.${OPERATION_ID}`,
    family: "maintenance",
    ownerId: "workspace-maintenance",
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath:
        `.wakeflow-local/runtime/maintenance/transactions/${OPERATION_ID}.intent.json`,
    },
    tracking: { disposition: "ignored", privacy: "runtime-private" },
    nodePolicy: {
      kind: "file",
      mode: "0600",
      linkPolicy: "single-link",
      executablePolicy: "forbidden",
    },
    processing: {
      kind: "resource",
      role: "transaction-artifact",
      allowedMutationRecipes: ["exclusive-create", "exact-retire"],
      recoveryStrategy: "owner-transaction-recovery",
    },
  });
});

test("intent persistence budget rejects an oversized host payload", () => {
  const value = fixture();
  const contribution = createWakeflowHostMaintenanceContribution({
    hostId: "codex",
    capabilityId: "codex-maintenance",
    status: "ready",
    sourcePlanDigest: value.plan.sharedPreview.planDigest,
    blockerCodes: [],
    operations: [{
      operationId: "example-operation:program",
      operationKind: "example-operation",
      ownerId: "example-owner",
      targetKey: "example.target",
      sourceDigest: null,
      targetDigest: computeWakeflowConfigV3Digest(value.config),
      payload: { value: "x".repeat(2 * 1024 * 1024) },
    }],
  });
  const plan = createWakeflowMaintenanceExecutionPlan(
    value.plan.sharedPreview,
    codexWorkspaceHostResourceProfile,
    contribution,
  );
  const intent = createWakeflowMaintenanceExecutionIntent(
    OPERATION_ID,
    plan,
    value.request,
    value.config,
  );
  let caught: unknown;
  try {
    assertWakeflowMaintenanceExecutionIntentCapacity(intent);
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowMaintenanceExecutionIntentStoreError, true);
  if (caught instanceof WakeflowMaintenanceExecutionIntentStoreError) {
    equal(caught.reason, "capacity");
  }
});
