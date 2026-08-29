import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  codexWorkspaceHostResourceProfile,
} from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  claudeCodeWorkspaceHostResourceProfile,
} from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import {
  createWakeflowHostMaintenanceContribution,
  parseWakeflowHostMaintenanceContribution,
  WakeflowHostMaintenanceContributionError,
} from "../../../src/workspace/maintenance/wakeflow-host-maintenance-contribution.js";
import {
  createPreparedWakeflowMaintenanceJournal,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-journal.js";
import {
  createWakeflowMaintenanceExecutionPlan,
  parseWakeflowMaintenanceExecutionPlan,
  WakeflowMaintenanceExecutionPlanError,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-plan.js";
import {
  computeWakeflowStaticMaterializationPreviewDigest,
  parseWakeflowStaticMaterializationPreview,
} from "../../../src/workspace/maintenance/wakeflow-static-materialization-preview.js";
import {
  createWakeflowWorkspaceStaticResourceMatrix,
} from "../../../src/workspace/wakeflow-workspace-static-resource-matrix.js";

const DIGEST = parseSha256Digest(`sha256:${"1".repeat(64)}`);
const OTHER_DIGEST = parseSha256Digest(`sha256:${"2".repeat(64)}`);
const OPERATION_ID =
  "maintenance_operation_11111111-1111-4111-8111-111111111111";

function sharedPreview() {
  const matrix = createWakeflowWorkspaceStaticResourceMatrix(
    claudeCodeWorkspaceHostResourceProfile,
  );
  const basis = {
    kind: "WakeflowStaticMaterializationPreview" as const,
    schemaVersion: 1 as const,
    executionBoundary: "preview-only" as const,
    action: "fresh-initialize" as const,
    status: "ready" as const,
    currentConfigDigest: null,
    desiredConfigDigest: DIGEST,
    matrixDigest: matrix.matrixDigest,
    coreLayoutInspectionDigest: OTHER_DIGEST,
    blockerCodes: Object.freeze([]),
    steps: Object.freeze([
      Object.freeze({
        stepId: "core:active-layout",
        kind: "materialize-active-layout" as const,
        ownerId: "active-layout",
        targetKey: "active.layout",
        sourceDigest: null,
        targetDigest: OTHER_DIGEST,
        dependsOn: Object.freeze([]),
      }),
      Object.freeze({
        stepId: "authority:config",
        kind: "publish-config" as const,
        ownerId: "config-authority",
        targetKey: "workspace.config-authority",
        sourceDigest: null,
        targetDigest: DIGEST,
        dependsOn: Object.freeze(["core:active-layout"]),
      }),
    ]),
  };
  return parseWakeflowStaticMaterializationPreview({
    ...basis,
    planDigest: computeWakeflowStaticMaterializationPreviewDigest(basis),
  });
}

function contribution() {
  return createWakeflowHostMaintenanceContribution({
    hostId: "claude-code",
    capabilityId: "claude-code-maintenance",
    status: "ready",
    sourcePlanDigest: OTHER_DIGEST,
    blockerCodes: [],
    operations: [{
      operationId:
        "claude-portable-settings:program:program_11111111-1111-4111-8111-111111111111",
      operationKind: "portable-settings",
      ownerId: "claude-code-portable-settings",
      targetKey:
        "settings:program:program_11111111-1111-4111-8111-111111111111",
      sourceDigest: null,
      targetDigest: DIGEST,
      payload: {
        kind: "ExamplePortableSettingsOperation",
        targetDigest: DIGEST,
      },
    }],
  });
}

test("aggregate plan inserts exact host operation before Config and binds one journal", () => {
  const plan = createWakeflowMaintenanceExecutionPlan(
    sharedPreview(),
    claudeCodeWorkspaceHostResourceProfile,
    contribution(),
  );
  equal(plan.status, "ready");
  deepEqual(plan.steps.map((entry) => entry.stepId), [
    "core:active-layout",
    "host-effect:claude-portable-settings:program:program_11111111-1111-4111-8111-111111111111",
    "authority:config",
  ]);
  deepEqual(plan.steps.at(-1)?.dependsOn, [
    "core:active-layout",
    "host-effect:claude-portable-settings:program:program_11111111-1111-4111-8111-111111111111",
  ]);
  deepEqual(parseWakeflowMaintenanceExecutionPlan(plan), plan);

  const journal = createPreparedWakeflowMaintenanceJournal(
    OPERATION_ID,
    OTHER_DIGEST,
    plan,
  );
  equal(journal.planDigest, plan.planDigest);
  deepEqual(journal.stepIds, plan.steps.map((entry) => entry.stepId));
});

test("host payload drift is rejected before it can alter aggregate identity", () => {
  const forged = JSON.parse(JSON.stringify(contribution())) as Record<string, unknown>;
  const operations = forged.operations as Array<Record<string, unknown>>;
  (operations[0]?.payload as Record<string, unknown>).targetDigest = OTHER_DIGEST;
  let caught: unknown;
  try {
    parseWakeflowHostMaintenanceContribution(forged);
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowHostMaintenanceContributionError, true);
  if (caught instanceof WakeflowHostMaintenanceContributionError) {
    equal(caught.reason, "digest");
  }
});

test("aggregate plan rejects a profile whose host matrix differs", () => {
  let caught: unknown;
  try {
    createWakeflowMaintenanceExecutionPlan(
      sharedPreview(),
      codexWorkspaceHostResourceProfile,
      contribution(),
    );
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowMaintenanceExecutionPlanError, true);
  if (caught instanceof WakeflowMaintenanceExecutionPlanError) {
    equal(caught.reason, "matrix");
  }
});
