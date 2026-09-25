import { equal } from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { Sha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { rootedExclusiveFileLockRecordTextForTest } from "../../foundation/filesystem/rooted-exclusive-file-lock-test-support.js";
import {
  computeWakeflowConfigDigest,
  parseWakeflowConfig,
} from "../../../src/configuration/wakeflow-config.js";
import {
  claudeCodeWorkspaceHostResourceProfile,
} from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import {
  codexWorkspaceHostResourceProfile,
} from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  withWakeflowMaintenanceGate,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-gate.js";
import {
  checkpointWakeflowMaintenanceJournal,
  publishPreparedWakeflowMaintenanceJournal,
  readWakeflowMaintenanceJournal,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-journal-store.js";
import {
  beginWakeflowMaintenanceJournalStep,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-journal.js";
import {
  createWakeflowMaintenanceExecutionIntent,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-intent.js";
import {
  publishWakeflowMaintenanceExecutionIntent,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-intent-store.js";
import {
  WAKEFLOW_MAINTENANCE_GATE_REF,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-resource-catalog.js";
import {
  recoverPreparedWakeflowMaintenanceTransaction,
  WakeflowPreparedMaintenanceRecoveryError,
} from "../../../src/workspace/maintenance/wakeflow-prepared-maintenance-recovery.js";
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
  inspectWakeflowWorkspaceCoreLayout,
} from "../../../src/workspace/maintenance/wakeflow-workspace-core-layout-inspection.js";
import {
  createMinimalWakeflowConfig,
} from "../../configuration/wakeflow-config.fixture.js";

const UUID = "11111111-1111-4111-8111-111111111111";
const OPERATION_ID = `maintenance_operation_${UUID}`;
const DESIRED_CONFIG = parseWakeflowConfig(createMinimalWakeflowConfig());
const DESIRED_CONFIG_DIGEST = computeWakeflowConfigDigest(DESIRED_CONFIG);

function executionPlan(coreLayoutInspectionDigest: Sha256Digest) {
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
    desiredConfigDigest: DESIRED_CONFIG_DIGEST,
    matrixDigest: matrix.matrixDigest,
    coreLayoutInspectionDigest,
    blockerCodes: Object.freeze([]),
    steps: Object.freeze([Object.freeze({
      stepId: "authority:config",
      kind: "publish-config" as const,
      ownerId: "config-authority",
      targetKey: "workspace.config-authority",
      sourceDigest: null,
      targetDigest: DESIRED_CONFIG_DIGEST,
      dependsOn: Object.freeze([]),
    })]),
  };
  const sharedPreview = parseWakeflowStaticMaterializationPreview({
    ...withoutDigest,
    planDigest: computeWakeflowStaticMaterializationPreviewDigest(withoutDigest),
  });
  return createWakeflowMaintenanceExecutionPlan(
    sharedPreview,
    codexWorkspaceHostResourceProfile,
    null,
  );
}

test("prepared recovery refuses an executing journal without retiring the old gate", async (t) => {
  const absolutePath = realpathSync(mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-prepared-maintenance-recovery-",
  )));
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  const core = await inspectWakeflowWorkspaceCoreLayout(root);
  const plan = executionPlan(core.inspectionDigest);
  const request = Object.freeze({
    action: "fresh-initialize" as const,
    desiredConfig: DESIRED_CONFIG,
    currentHostProfile: codexWorkspaceHostResourceProfile,
    hostProfiles: Object.freeze([
      codexWorkspaceHostResourceProfile,
      claudeCodeWorkspaceHostResourceProfile,
    ]),
  });
  const privateError = new Error("stop while executing");
  try {
    await withWakeflowMaintenanceGate(
      root,
      {
        expectedCoreLayoutInspectionDigest: core.inspectionDigest,
        uuidFactory: () => UUID,
      },
      async (context) => {
        const intentSource = await publishWakeflowMaintenanceExecutionIntent(
          root,
          context,
          createWakeflowMaintenanceExecutionIntent(
            context.operationId,
            plan,
            request,
            DESIRED_CONFIG,
          ),
        );
        const journalSource = await publishPreparedWakeflowMaintenanceJournal(
          root,
          context,
          intentSource,
          plan,
        );
        await checkpointWakeflowMaintenanceJournal(
          root,
          context,
          intentSource,
          journalSource,
          beginWakeflowMaintenanceJournalStep(journalSource.journal),
        );
        throw privateError;
      },
    );
  } catch (error: unknown) {
    equal(error, privateError);
  }
  const gatePath = path.join(
    absolutePath,
    ...WAKEFLOW_MAINTENANCE_GATE_REF.split("/"),
  );
  const gateText = rootedExclusiveFileLockRecordTextForTest({ tokenUuid: UUID });
  writeFileSync(gatePath, gateText, { mode: 0o600 });

  let caught: unknown;
  try {
    await recoverPreparedWakeflowMaintenanceTransaction(root, OPERATION_ID);
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowPreparedMaintenanceRecoveryError, true);
  if (caught instanceof WakeflowPreparedMaintenanceRecoveryError) {
    equal(caught.reason, "journal");
  }
  equal(existsSync(gatePath), true);
  equal(readFileSync(gatePath, "utf8"), gateText);
  const journal = await readWakeflowMaintenanceJournal(root, OPERATION_ID);
  equal(journal.journal.state, "executing");
  equal(journal.journal.affectedStepId, "authority:config");
});
