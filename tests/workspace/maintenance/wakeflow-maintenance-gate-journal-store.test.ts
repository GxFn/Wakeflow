import { equal } from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { rootedExclusiveFileLockRecordTextForTest } from "../../foundation/filesystem/rooted-exclusive-file-lock-test-support.js";
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
  inspectRootedExclusiveFileLock,
} from "../../../src/foundation/filesystem/rooted-exclusive-file-lock.js";
import {
  withWakeflowMaintenanceGate,
  WakeflowMaintenanceGateError,
  type WakeflowMaintenanceGateContext,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-gate.js";
import {
  checkpointWakeflowMaintenanceJournal,
  publishPreparedWakeflowMaintenanceJournal,
  readWakeflowMaintenanceJournal,
  retirePreparedWakeflowMaintenanceJournal,
  retireTerminalWakeflowMaintenanceJournal,
  WakeflowMaintenanceJournalStoreError,
  type WakeflowMaintenanceJournalSource,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-journal-store.js";
import {
  beginWakeflowMaintenanceJournalStep,
  completeWakeflowMaintenanceJournalStep,
  terminalizeWakeflowMaintenanceJournal,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-journal.js";
import {
  createWakeflowMaintenanceExecutionIntent,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-intent.js";
import {
  publishWakeflowMaintenanceExecutionIntent,
  retireWakeflowMaintenanceExecutionIntent,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-intent-store.js";
import {
  wakeflowMaintenanceIntentRef,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-operation-id.js";
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
  createMinimalWakeflowConfigV3,
} from "../../configuration/wakeflow-config-v3.fixture.js";

const UUID = "11111111-1111-4111-8111-111111111111";
const OPERATION_ID = `maintenance_operation_${UUID}`;
const DIGEST = parseSha256Digest(`sha256:${"1".repeat(64)}`);
const DESIRED_CONFIG = parseWakeflowConfigV3(createMinimalWakeflowConfigV3());
const DESIRED_CONFIG_DIGEST = computeWakeflowConfigV3Digest(DESIRED_CONFIG);
const PROFILES = Object.freeze([
  codexWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostResourceProfile,
]);

async function fixture(t: TestContext) {
  const absolutePath = realpathSync(mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-maintenance-gate-journal-",
  )));
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({ absolutePath, root });
}

function preview(coreLayoutInspectionDigest: typeof DIGEST) {
  const matrix = createWakeflowWorkspaceStaticResourceMatrix(
    codexWorkspaceHostResourceProfile,
  );
  const plan = {
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
    ...plan,
    planDigest: computeWakeflowStaticMaterializationPreviewDigest(plan),
  });
  return createWakeflowMaintenanceExecutionPlan(
    sharedPreview,
    codexWorkspaceHostResourceProfile,
    null,
  );
}

const REQUEST = Object.freeze({
  action: "fresh-initialize" as const,
  desiredConfig: DESIRED_CONFIG,
  currentHostProfile: codexWorkspaceHostResourceProfile,
  hostProfiles: PROFILES,
});

async function publishPreparedTransaction(
  root: RootedDirectory,
  context: Readonly<WakeflowMaintenanceGateContext>,
  plan: ReturnType<typeof preview>,
) {
  const intent = createWakeflowMaintenanceExecutionIntent(
    context.operationId,
    plan,
    REQUEST,
    DESIRED_CONFIG,
  );
  const intentSource = await publishWakeflowMaintenanceExecutionIntent(
    root,
    context,
    intent,
  );
  const journalSource = await publishPreparedWakeflowMaintenanceJournal(
    root,
    context,
    intentSource,
    plan,
  );
  return Object.freeze({ intentSource, journalSource });
}

test("maintenance gate bootstraps, correlates operation and retires prepared journal", async (t) => {
  const workspace = await fixture(t);
  const core = await inspectWakeflowWorkspaceCoreLayout(workspace.root);
  const plan = preview(core.inspectionDigest);
  let expiredContext: Readonly<WakeflowMaintenanceGateContext> | undefined;
  let retiredSource: Readonly<WakeflowMaintenanceJournalSource> | undefined;

  await withWakeflowMaintenanceGate(
    workspace.root,
    {
      expectedCoreLayoutInspectionDigest: core.inspectionDigest,
      uuidFactory: () => UUID,
    },
    async (context) => {
      expiredContext = context;
      equal(context.operationId, OPERATION_ID);
      const lock = await inspectRootedExclusiveFileLock(
        workspace.root,
        WAKEFLOW_MAINTENANCE_GATE_REF,
      );
      equal(lock.status, "held");
      if (lock.status === "held") {
        equal(lock.record.token.endsWith(`-${UUID}`), true);
      }
      const transaction = await publishPreparedTransaction(
        workspace.root,
        context,
        plan,
      );
      const prepared = transaction.journalSource;
      retiredSource = prepared;
      equal(prepared.journal.operationId, OPERATION_ID);
      equal(prepared.journal.planDigest, plan.planDigest);
      const reread = await readWakeflowMaintenanceJournal(
        workspace.root,
        context.operationId,
      );
      equal(reread.digest, prepared.digest);
      await retireWakeflowMaintenanceExecutionIntent(
        workspace.root,
        context,
        transaction.intentSource,
      );
      const retired = await retirePreparedWakeflowMaintenanceJournal(
        workspace.root,
        context,
        prepared,
      );
      equal(retired.disposition, "retired-prepared");
    },
  );

  equal(existsSync(path.join(workspace.absolutePath, ".wakeflow-local")), true);
  const after = await inspectWakeflowWorkspaceCoreLayout(workspace.root);
  equal(after.local.status, "idle");
  equal(existsSync(path.join(
    workspace.absolutePath,
    ...WAKEFLOW_MAINTENANCE_GATE_REF.split("/"),
  )), false);

  let outsideError: unknown;
  try {
    if (expiredContext === undefined || retiredSource === undefined) {
      throw new Error("Expected issued scope.");
    }
    await retirePreparedWakeflowMaintenanceJournal(
      workspace.root,
      expiredContext,
      retiredSource,
    );
  } catch (error: unknown) {
    outsideError = error;
  }
  equal(outsideError instanceof WakeflowMaintenanceJournalStoreError, true);
  if (outsideError instanceof WakeflowMaintenanceJournalStoreError) {
    equal(outsideError.reason, "gate");
  }
});

test("prepared journal survives operation failure while gate releases", async (t) => {
  const workspace = await fixture(t);
  const core = await inspectWakeflowWorkspaceCoreLayout(workspace.root);
  const plan = preview(core.inspectionDigest);
  const privateError = new Error("stop after journal");
  let caught: unknown;
  try {
    await withWakeflowMaintenanceGate(
      workspace.root,
      {
        expectedCoreLayoutInspectionDigest: core.inspectionDigest,
        uuidFactory: () => UUID,
      },
      async (context) => {
        await publishPreparedTransaction(
          workspace.root,
          context,
          plan,
        );
        throw privateError;
      },
    );
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught, privateError);
  const journal = await readWakeflowMaintenanceJournal(
    workspace.root,
    OPERATION_ID,
  );
  equal(journal.journal.state, "prepared");
  const after = await inspectWakeflowWorkspaceCoreLayout(workspace.root);
  equal(after.local.status, "recovery-required");
  equal(existsSync(path.join(
    workspace.absolutePath,
    ...WAKEFLOW_MAINTENANCE_GATE_REF.split("/"),
  )), false);
  const recovered = await recoverPreparedWakeflowMaintenanceTransaction(
    workspace.root,
    OPERATION_ID,
  );
  equal(recovered.retiredPreviousGateDigest, null);
  equal(recovered.intentRetirement?.disposition, "retired-intent");
  equal(recovered.journalRetirement.disposition, "retired-prepared");
  const idle = await inspectWakeflowWorkspaceCoreLayout(workspace.root);
  equal(idle.local.status, "idle");
});

test("journal store CAS advances affected, checkpoint and terminal states", async (t) => {
  const workspace = await fixture(t);
  const core = await inspectWakeflowWorkspaceCoreLayout(workspace.root);
  const plan = preview(core.inspectionDigest);
  await withWakeflowMaintenanceGate(
    workspace.root,
    {
      expectedCoreLayoutInspectionDigest: core.inspectionDigest,
      uuidFactory: () => UUID,
    },
    async (context) => {
      const transaction = await publishPreparedTransaction(
        workspace.root,
        context,
        plan,
      );
      let source = transaction.journalSource;
      source = await checkpointWakeflowMaintenanceJournal(
        workspace.root,
        context,
        transaction.intentSource,
        source,
        beginWakeflowMaintenanceJournalStep(source.journal),
      );
      equal(source.journal.affectedStepId, "authority:config");
      source = await checkpointWakeflowMaintenanceJournal(
        workspace.root,
        context,
        transaction.intentSource,
        source,
        completeWakeflowMaintenanceJournalStep(source.journal),
      );
      equal(source.journal.checkpoint, 1);
      source = await checkpointWakeflowMaintenanceJournal(
        workspace.root,
        context,
        transaction.intentSource,
        source,
        terminalizeWakeflowMaintenanceJournal(source.journal),
      );
      equal(source.journal.state, "terminal");
      await retireWakeflowMaintenanceExecutionIntent(
        workspace.root,
        context,
        transaction.intentSource,
      );
      await retireTerminalWakeflowMaintenanceJournal(
        workspace.root,
        context,
        source,
      );
    },
  );
  const idle = await inspectWakeflowWorkspaceCoreLayout(workspace.root);
  equal(idle.local.status, "idle");
});

test("journal checkpoint rejects immutable intent drift", async (t) => {
  const workspace = await fixture(t);
  const core = await inspectWakeflowWorkspaceCoreLayout(workspace.root);
  const plan = preview(core.inspectionDigest);
  await withWakeflowMaintenanceGate(
    workspace.root,
    {
      expectedCoreLayoutInspectionDigest: core.inspectionDigest,
      uuidFactory: () => UUID,
    },
    async (context) => {
      const transaction = await publishPreparedTransaction(
        workspace.root,
        context,
        plan,
      );
      writeFileSync(path.join(
        workspace.absolutePath,
        ...wakeflowMaintenanceIntentRef(OPERATION_ID).split("/"),
      ), "{}\n", { mode: 0o600 });
      let caught: unknown;
      try {
        await checkpointWakeflowMaintenanceJournal(
          workspace.root,
          context,
          transaction.intentSource,
          transaction.journalSource,
          beginWakeflowMaintenanceJournalStep(
            transaction.journalSource.journal,
          ),
        );
      } catch (error: unknown) {
        caught = error;
      }
      equal(caught instanceof WakeflowMaintenanceJournalStoreError, true);
      if (caught instanceof WakeflowMaintenanceJournalStoreError) {
        equal(caught.reason, "conflict");
      }
    },
  );
});

test("prepared recovery retires a correlated inactive gate before journal", async (t) => {
  const workspace = await fixture(t);
  const core = await inspectWakeflowWorkspaceCoreLayout(workspace.root);
  const plan = preview(core.inspectionDigest);
  const privateError = new Error("leave prepared");
  try {
    await withWakeflowMaintenanceGate(
      workspace.root,
      {
        expectedCoreLayoutInspectionDigest: core.inspectionDigest,
        uuidFactory: () => UUID,
      },
      async (context) => {
        await publishPreparedTransaction(
          workspace.root,
          context,
          plan,
        );
        throw privateError;
      },
    );
  } catch (error: unknown) {
    equal(error, privateError);
  }
  const gatePath = path.join(
    workspace.absolutePath,
    ...WAKEFLOW_MAINTENANCE_GATE_REF.split("/"),
  );
  writeFileSync(gatePath, rootedExclusiveFileLockRecordTextForTest({
    tokenUuid: UUID,
  }), { mode: 0o600 });

  const recovered = await recoverPreparedWakeflowMaintenanceTransaction(
    workspace.root,
    OPERATION_ID,
  );
  equal(recovered.retiredPreviousGateDigest === null, false);
  equal(existsSync(gatePath), false);
  const idle = await inspectWakeflowWorkspaceCoreLayout(workspace.root);
  equal(idle.local.status, "idle");
});

test("prepared recovery proves intent and journal are the only transaction", async (t) => {
  const workspace = await fixture(t);
  const core = await inspectWakeflowWorkspaceCoreLayout(workspace.root);
  const plan = preview(core.inspectionDigest);
  try {
    await withWakeflowMaintenanceGate(
      workspace.root,
      {
        expectedCoreLayoutInspectionDigest: core.inspectionDigest,
        uuidFactory: () => UUID,
      },
      async (context) => {
        await publishPreparedTransaction(
          workspace.root,
          context,
          plan,
        );
        throw new Error("leave prepared");
      },
    );
  } catch {
    // 预期只留下 prepared journal。
  }
  const transactions = path.join(
    workspace.absolutePath,
    ".wakeflow-local/runtime/maintenance/transactions",
  );
  const foreign = path.join(transactions, "foreign.json");
  writeFileSync(foreign, "{}\n", { mode: 0o600 });
  let caught: unknown;
  try {
    await recoverPreparedWakeflowMaintenanceTransaction(
      workspace.root,
      OPERATION_ID,
    );
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowPreparedMaintenanceRecoveryError, true);
  if (caught instanceof WakeflowPreparedMaintenanceRecoveryError) {
    equal(caught.reason, "transaction");
  }
  equal(existsSync(foreign), true);
  equal(existsSync(path.join(
    transactions,
    `${OPERATION_ID}.journal.json`,
  )), true);
  equal(existsSync(path.join(
    transactions,
    `${OPERATION_ID}.intent.json`,
  )), true);
});

test("prepared cancellation validates options before recovery observation", async (t) => {
  const workspace = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  let caught: unknown;
  try {
    await recoverPreparedWakeflowMaintenanceTransaction(
      workspace.root,
      OPERATION_ID,
      { signal: controller.signal },
    );
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowPreparedMaintenanceRecoveryError, true);
  if (caught instanceof WakeflowPreparedMaintenanceRecoveryError) {
    equal(caught.reason, "aborted");
  }
  equal(existsSync(path.join(workspace.absolutePath, ".wakeflow-local")), false);
});

test("maintenance gate rejects a stale core-layout preview before bootstrap", async (t) => {
  const workspace = await fixture(t);
  let caught: unknown;
  try {
    await withWakeflowMaintenanceGate(
      workspace.root,
      {
        expectedCoreLayoutInspectionDigest: DIGEST,
        uuidFactory: () => UUID,
      },
      () => undefined,
    );
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowMaintenanceGateError, true);
  if (caught instanceof WakeflowMaintenanceGateError) {
    equal(caught.reason, "stale-preview");
  }
  equal(existsSync(path.join(workspace.absolutePath, ".wakeflow-local")), false);
});

test("maintenance gate validates its operation ID factory before bootstrap", async (t) => {
  const workspace = await fixture(t);
  const core = await inspectWakeflowWorkspaceCoreLayout(workspace.root);
  let caught: unknown;
  try {
    await withWakeflowMaintenanceGate(
      workspace.root,
      {
        expectedCoreLayoutInspectionDigest: core.inspectionDigest,
        uuidFactory: () => "invalid",
      },
      () => undefined,
    );
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowMaintenanceGateError, true);
  if (caught instanceof WakeflowMaintenanceGateError) {
    equal(caught.reason, "input");
  }
  equal(existsSync(path.join(workspace.absolutePath, ".wakeflow-local")), false);
});
