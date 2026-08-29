import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  codexWorkspaceHostResourceProfile,
} from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";

import {
  createPreparedWakeflowMaintenanceJournal,
  createWakeflowMaintenanceJournalResourceDeclaration,
  parseWakeflowMaintenanceJournal,
  renderWakeflowMaintenanceJournal,
  computeWakeflowMaintenanceJournalDigest,
  beginWakeflowMaintenanceJournalStep,
  completeWakeflowMaintenanceJournalStep,
  isWakeflowMaintenanceJournalSuccessor,
  terminalizeWakeflowMaintenanceJournal,
  WakeflowMaintenanceJournalError,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-journal.js";
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

const DIGEST = parseSha256Digest(`sha256:${"1".repeat(64)}`);
const OTHER_DIGEST = parseSha256Digest(`sha256:${"2".repeat(64)}`);
const OPERATION_ID =
  "maintenance_operation_11111111-1111-4111-8111-111111111111";

function plan() {
  const matrix = createWakeflowWorkspaceStaticResourceMatrix(
    codexWorkspaceHostResourceProfile,
  );
  const withoutDigest = {
    kind: "WakeflowStaticMaterializationPreview" as const,
    schemaVersion: 1 as const,
    executionBoundary: "preview-only" as const,
    action: "fresh-initialize" as const,
    status: "ready" as const,
    currentConfigDigest: null,
    desiredConfigDigest: DIGEST,
    matrixDigest: matrix.matrixDigest,
    coreLayoutInspectionDigest: DIGEST,
    blockerCodes: Object.freeze([]),
    steps: Object.freeze([Object.freeze({
      stepId: "authority:config",
      kind: "publish-config" as const,
      ownerId: "config-authority",
      targetKey: "workspace.config-authority",
      sourceDigest: null,
      targetDigest: DIGEST,
      dependsOn: Object.freeze([]),
    })]),
  };
  const preview = parseWakeflowStaticMaterializationPreview({
    ...withoutDigest,
    planDigest: computeWakeflowStaticMaterializationPreviewDigest(withoutDigest),
  });
  return createWakeflowMaintenanceExecutionPlan(
    preview,
    codexWorkspaceHostResourceProfile,
    null,
  );
}

test("prepared maintenance journal binds only operation and exact plan facts", () => {
  const executionPlan = plan();
  const journal = createPreparedWakeflowMaintenanceJournal(
    OPERATION_ID,
    OTHER_DIGEST,
    executionPlan,
  );
  deepEqual(journal, {
    kind: "WakeflowMaintenanceJournal",
    schemaVersion: 1,
    operationId: OPERATION_ID,
    intentDigest: OTHER_DIGEST,
    action: "fresh-initialize",
    planDigest: executionPlan.planDigest,
    matrixDigest: executionPlan.sharedPreview.matrixDigest,
    currentConfigDigest: null,
    desiredConfigDigest: DIGEST,
    stepIds: ["authority:config"],
    checkpoint: 0,
    affectedStepId: null,
    state: "prepared",
  });
  const text = renderWakeflowMaintenanceJournal(journal);
  deepEqual(parseWakeflowMaintenanceJournal(JSON.parse(text)), journal);
  equal(/^sha256:[0-9a-f]{64}$/u.test(
    computeWakeflowMaintenanceJournalDigest(journal),
  ), true);
  deepEqual(createWakeflowMaintenanceJournalResourceDeclaration(OPERATION_ID), {
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: `maintenance.transaction.${OPERATION_ID}`,
    family: "maintenance",
    ownerId: "workspace-maintenance",
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath:
        `.wakeflow-local/runtime/maintenance/transactions/${OPERATION_ID}.journal.json`,
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
      allowedMutationRecipes: [
        "exclusive-create",
        "exact-source-replace",
        "exact-retire",
      ],
      recoveryStrategy: "owner-transaction-recovery",
    },
  });
});

test("journal advances only through affected, checkpoint and terminal successors", () => {
  const prepared = createPreparedWakeflowMaintenanceJournal(
    OPERATION_ID,
    OTHER_DIGEST,
    plan(),
  );
  const affected = beginWakeflowMaintenanceJournalStep(prepared);
  equal(affected.state, "executing");
  equal(affected.checkpoint, 0);
  equal(affected.affectedStepId, "authority:config");
  equal(isWakeflowMaintenanceJournalSuccessor(prepared, affected), true);

  const checkpointed = completeWakeflowMaintenanceJournalStep(affected);
  equal(checkpointed.checkpoint, 1);
  equal(checkpointed.affectedStepId, null);
  equal(isWakeflowMaintenanceJournalSuccessor(affected, checkpointed), true);

  const terminal = terminalizeWakeflowMaintenanceJournal(checkpointed);
  equal(terminal.state, "terminal");
  equal(isWakeflowMaintenanceJournalSuccessor(checkpointed, terminal), true);
  equal(isWakeflowMaintenanceJournalSuccessor(prepared, terminal), false);
});

test("journal rejects impossible checkpoints and unbounded step identities", () => {
  const prepared = createPreparedWakeflowMaintenanceJournal(
    OPERATION_ID,
    OTHER_DIGEST,
    plan(),
  );
  for (const candidate of [
    { ...prepared, state: "prepared", checkpoint: 1 },
    { ...prepared, state: "executing", affectedStepId: "core:unknown" },
    { ...prepared, state: "terminal" },
    { ...prepared, stepIds: [`core:${"a".repeat(264)}`] },
  ]) {
    let caught: unknown;
    try {
      parseWakeflowMaintenanceJournal(candidate);
    } catch (error: unknown) {
      caught = error;
    }
    equal(caught instanceof WakeflowMaintenanceJournalError, true);
    if (caught instanceof WakeflowMaintenanceJournalError) {
      equal(caught.reason, "schema");
    }
  }
});

test("prepared journal rejects blocked, empty or forged plans", () => {
  const valid = plan();
  for (const candidate of [
    { ...valid, status: "blocked", blockerCodes: ["blocked"] },
    { ...valid, steps: [] },
    { ...valid, planDigest: OTHER_DIGEST },
  ]) {
    let caught: unknown;
    try {
      createPreparedWakeflowMaintenanceJournal(
        OPERATION_ID,
        OTHER_DIGEST,
        candidate,
      );
    } catch (error: unknown) {
      caught = error;
    }
    equal(caught instanceof WakeflowMaintenanceJournalError, true);
    if (caught instanceof WakeflowMaintenanceJournalError) {
      equal(caught.reason, "plan");
    }
  }
});
