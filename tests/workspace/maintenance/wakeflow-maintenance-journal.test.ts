import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { createWakeflowMaintenanceExecutionPlan } from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-plan.js";
import {
  beginWakeflowMaintenanceJournalStep,
  completeWakeflowMaintenanceJournalStep,
  computeWakeflowMaintenanceJournalDigest,
  createPreparedWakeflowMaintenanceJournal,
  createWakeflowMaintenanceJournalResourceDeclaration,
  isWakeflowMaintenanceJournalSuccessor,
  parseWakeflowMaintenanceJournal,
  renderWakeflowMaintenanceJournal,
  terminalizeWakeflowMaintenanceJournal,
  WakeflowMaintenanceJournalError,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-journal.js";
import {
  computeWakeflowStaticMaterializationPreviewDigest,
  parseWakeflowStaticMaterializationPreview,
} from "../../../src/workspace/maintenance/wakeflow-static-materialization-preview.js";
import { createWakeflowWorkspaceStaticResourceMatrix } from "../../../src/workspace/wakeflow-workspace-static-resource-matrix.js";

const DIGEST = parseSha256Digest(`sha256:${"1".repeat(64)}`);
const OTHER_DIGEST = parseSha256Digest(`sha256:${"2".repeat(64)}`);
const OPERATION_ID = "maintenance_operation_11111111-1111-4111-8111-111111111111";

function plan() {
  const matrix = createWakeflowWorkspaceStaticResourceMatrix(codexWorkspaceHostResourceProfile);
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
    steps: Object.freeze([
      Object.freeze({
        stepId: "authority:config",
        kind: "publish-config" as const,
        ownerId: "config-authority",
        targetKey: "workspace.config-authority",
        sourceDigest: null,
        targetDigest: DIGEST,
        dependsOn: Object.freeze([]),
      }),
    ]),
  };
  const preview = parseWakeflowStaticMaterializationPreview({
    ...withoutDigest,
    planDigest: computeWakeflowStaticMaterializationPreviewDigest(withoutDigest),
  });
  return createWakeflowMaintenanceExecutionPlan(preview, codexWorkspaceHostResourceProfile, null);
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
  equal(/^sha256:[0-9a-f]{64}$/u.test(computeWakeflowMaintenanceJournalDigest(journal)), true);
  deepEqual(createWakeflowMaintenanceJournalResourceDeclaration(OPERATION_ID), {
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: `maintenance.transaction.${OPERATION_ID}`,
    family: "maintenance",
    ownerId: "workspace-maintenance",
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath: `.wakeflow-local/runtime/maintenance/transactions/${OPERATION_ID}.journal.json`,
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
      allowedMutationRecipes: ["exclusive-create", "exact-source-replace", "exact-retire"],
      recoveryStrategy: "owner-transaction-recovery",
    },
  });
});

test("journal advances only through affected, checkpoint and terminal successors", () => {
  const prepared = createPreparedWakeflowMaintenanceJournal(OPERATION_ID, OTHER_DIGEST, plan());
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
  const prepared = createPreparedWakeflowMaintenanceJournal(OPERATION_ID, OTHER_DIGEST, plan());
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
      createPreparedWakeflowMaintenanceJournal(OPERATION_ID, OTHER_DIGEST, candidate);
    } catch (error: unknown) {
      caught = error;
    }
    equal(caught instanceof WakeflowMaintenanceJournalError, true);
    if (caught instanceof WakeflowMaintenanceJournalError) {
      equal(caught.reason, "plan");
    }
  }
});

test("journal parser rejects a null desired config digest", () => {
  const prepared = createPreparedWakeflowMaintenanceJournal(OPERATION_ID, OTHER_DIGEST, plan());
  let caught: unknown;
  try {
    parseWakeflowMaintenanceJournal({ ...prepared, desiredConfigDigest: null });
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowMaintenanceJournalError, true);
  if (caught instanceof WakeflowMaintenanceJournalError) {
    equal(caught.reason, "schema");
  }
});

const WRITER = Object.freeze({
  version: "1.2.0",
  manifestDigest: parseSha256Digest(`sha256:${"3".repeat(64)}`),
});
const OTHER_WRITER = Object.freeze({
  version: "1.3.0",
  manifestDigest: parseSha256Digest(`sha256:${"4".repeat(64)}`),
});

test("journal carries the optional writer stamp through its successors and rejects a swapped stamp (C11)", () => {
  const executionPlan = plan();
  const unstamped = createPreparedWakeflowMaintenanceJournal(
    OPERATION_ID,
    OTHER_DIGEST,
    executionPlan,
  );
  equal(Object.hasOwn(unstamped, "writer"), false);
  deepEqual(
    createPreparedWakeflowMaintenanceJournal(OPERATION_ID, OTHER_DIGEST, executionPlan, null),
    unstamped,
  );
  const prepared = createPreparedWakeflowMaintenanceJournal(
    OPERATION_ID,
    OTHER_DIGEST,
    executionPlan,
    WRITER,
  );
  deepEqual(prepared.writer, WRITER);
  const text = renderWakeflowMaintenanceJournal(prepared);
  deepEqual((JSON.parse(text) as { writer?: unknown }).writer, {
    version: "1.2.0",
    manifestDigest: WRITER.manifestDigest,
  });
  deepEqual(parseWakeflowMaintenanceJournal(JSON.parse(text)), prepared);
  equal(
    computeWakeflowMaintenanceJournalDigest(JSON.parse(text)),
    computeWakeflowMaintenanceJournalDigest(prepared),
  );
  equal(
    Object.hasOwn(
      parseWakeflowMaintenanceJournal(JSON.parse(renderWakeflowMaintenanceJournal(unstamped))),
      "writer",
    ),
    false,
  );

  const affected = beginWakeflowMaintenanceJournalStep(prepared);
  const checkpointed = completeWakeflowMaintenanceJournalStep(affected);
  const terminal = terminalizeWakeflowMaintenanceJournal(checkpointed);
  deepEqual(affected.writer, WRITER);
  deepEqual(checkpointed.writer, WRITER);
  deepEqual(terminal.writer, WRITER);
  equal(isWakeflowMaintenanceJournalSuccessor(prepared, affected), true);
  equal(
    isWakeflowMaintenanceJournalSuccessor(prepared, { ...affected, writer: OTHER_WRITER }),
    false,
  );
  equal(
    isWakeflowMaintenanceJournalSuccessor(prepared, beginWakeflowMaintenanceJournalStep(unstamped)),
    false,
  );
  equal(isWakeflowMaintenanceJournalSuccessor(unstamped, affected), false);

  for (const writer of [
    { version: "v1", manifestDigest: WRITER.manifestDigest },
    { version: "1.2.0" },
    { version: "1.2.0", manifestDigest: "sha256:zz" },
    "1.2.0",
  ]) {
    throws(
      () =>
        createPreparedWakeflowMaintenanceJournal(OPERATION_ID, OTHER_DIGEST, executionPlan, writer),
      (error: unknown) =>
        error instanceof WakeflowMaintenanceJournalError && error.reason === "input",
    );
  }
  throws(
    () => parseWakeflowMaintenanceJournal({ ...prepared, writer: null }),
    (error: unknown) =>
      error instanceof WakeflowMaintenanceJournalError && error.reason === "schema",
  );
});
