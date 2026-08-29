import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  computeWakeflowConfigV3Digest,
  parseWakeflowConfigV3,
} from "../../../src/configuration/wakeflow-config-v3.js";
import {
  parseSha256Digest,
} from "../../../src/foundation/crypto/sha256.js";
import {
  claudeCodeWorkspaceHostResourceProfile,
} from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import {
  codexWorkspaceHostResourceProfile,
} from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  createWakeflowMaintenanceConfirmation,
  parseWakeflowMaintenanceConfirmation,
  WakeflowMaintenanceConfirmationError,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-confirmation.js";
import {
  createWakeflowMaintenanceExecutionPlan,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-plan.js";
import {
  computeWakeflowStaticMaterializationPreviewDigest,
  parseWakeflowStaticMaterializationPreview,
} from "../../../src/workspace/maintenance/wakeflow-static-materialization-preview.js";
import type {
  WakeflowStaticMaterializationAction,
} from "../../../src/workspace/maintenance/wakeflow-static-materialization-preview-contract.js";
import {
  createWakeflowWorkspaceStaticResourceMatrix,
} from "../../../src/workspace/wakeflow-workspace-static-resource-matrix.js";
import {
  createMinimalWakeflowConfigV3,
} from "../../configuration/wakeflow-config-v3.fixture.js";

const PROFILES = Object.freeze([
  codexWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostResourceProfile,
]);
const OBSERVATION_DIGEST = parseSha256Digest(`sha256:${"9".repeat(64)}`);

function desiredConfig() {
  const value = createMinimalWakeflowConfigV3();
  (value.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  return parseWakeflowConfigV3(value);
}

function request(
  action: WakeflowStaticMaterializationAction,
  desired: ReturnType<typeof desiredConfig> | null,
) {
  return Object.freeze({
    action,
    desiredConfig: desired,
    currentHostProfile: codexWorkspaceHostResourceProfile,
    hostProfiles: PROFILES,
  });
}

function readyPlan(
  action: WakeflowStaticMaterializationAction,
  desired: ReturnType<typeof desiredConfig>,
) {
  const desiredConfigDigest = computeWakeflowConfigV3Digest(desired);
  const matrixDigest = createWakeflowWorkspaceStaticResourceMatrix(
    codexWorkspaceHostResourceProfile,
  ).matrixDigest;
  const basis = Object.freeze({
    kind: "WakeflowStaticMaterializationPreview" as const,
    schemaVersion: 1 as const,
    executionBoundary: "preview-only" as const,
    action,
    status: "ready" as const,
    currentConfigDigest: action === "fresh-initialize"
      ? null
      : desiredConfigDigest,
    desiredConfigDigest,
    matrixDigest,
    coreLayoutInspectionDigest: OBSERVATION_DIGEST,
    blockerCodes: Object.freeze([]),
    steps: Object.freeze(action === "fresh-initialize"
      ? [Object.freeze({
          stepId: "authority:config",
          kind: "publish-config" as const,
          ownerId: "config-authority",
          targetKey: "workspace.config-authority",
          sourceDigest: null,
          targetDigest: desiredConfigDigest,
          dependsOn: Object.freeze([]),
        })]
      : []),
  });
  const preview = parseWakeflowStaticMaterializationPreview({
    ...basis,
    planDigest: computeWakeflowStaticMaterializationPreviewDigest(basis),
  });
  return createWakeflowMaintenanceExecutionPlan(
    preview,
    codexWorkspaceHostResourceProfile,
    null,
  );
}

function clone(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

test("Fresh confirmation binds the exact request, ready plan and launch intents", () => {
  const desired = desiredConfig();
  const confirmation = createWakeflowMaintenanceConfirmation(
    readyPlan("fresh-initialize", desired),
    request("fresh-initialize", desired),
  );

  deepEqual(parseWakeflowMaintenanceConfirmation(confirmation), confirmation);
  equal(confirmation.launchIntentSet?.intents.length, 4);
  equal(confirmation.launchIntentSet?.hostId, "codex");
  equal(confirmation.executionPlan.sharedPreview.desiredConfigDigest,
    confirmation.launchIntentSet?.configDigest);
  const serialized = JSON.stringify(confirmation);
  equal(serialized.includes("/Users/"), false);
  equal(
    /"(?:threadId|sessionId|rawHandle|clientThreadId|projectId)":/u.test(
      serialized,
    ),
    false,
  );
});

test("Reconfigure and reconcile confirmations do not invent launch intents", () => {
  const desired = desiredConfig();
  const reconfigure = createWakeflowMaintenanceConfirmation(
    readyPlan("reconfigure", desired),
    request("reconfigure", desired),
  );
  const reconcile = createWakeflowMaintenanceConfirmation(
    readyPlan("reconcile", desired),
    request("reconcile", null),
  );

  equal(reconfigure.launchIntentSet, null);
  equal(reconcile.launchIntentSet, null);
});

test("Confirmation rejects unrelated Config, altered launch data and digest drift", () => {
  const desired = desiredConfig();
  const plan = readyPlan("fresh-initialize", desired);
  const changedValue = createMinimalWakeflowConfigV3();
  (changedValue.storage as Record<string, unknown>).ledgerRoot = "OtherLedger";
  const changed = parseWakeflowConfigV3(changedValue);

  let caught: unknown;
  try {
    createWakeflowMaintenanceConfirmation(
      plan,
      request("fresh-initialize", changed),
    );
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowMaintenanceConfirmationError, true);
  if (caught instanceof WakeflowMaintenanceConfirmationError) {
    equal(caught.reason, "relation");
  }

  const confirmation = createWakeflowMaintenanceConfirmation(
    plan,
    request("fresh-initialize", desired),
  );
  const alteredLaunch = clone(confirmation);
  const launchSet = alteredLaunch.launchIntentSet as Record<string, unknown>;
  launchSet.intents = [];
  caught = undefined;
  try {
    parseWakeflowMaintenanceConfirmation(alteredLaunch);
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowMaintenanceConfirmationError, true);
  if (caught instanceof WakeflowMaintenanceConfirmationError) {
    equal(caught.reason, "relation");
  }

  const alteredDigest = clone(confirmation);
  alteredDigest.confirmationDigest = OBSERVATION_DIGEST;
  caught = undefined;
  try {
    parseWakeflowMaintenanceConfirmation(alteredDigest);
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowMaintenanceConfirmationError, true);
  if (caught instanceof WakeflowMaintenanceConfirmationError) {
    equal(caught.reason, "digest");
  }
});
