import { deepEqual, equal, rejects } from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import {
  computeWakeflowConfigDigest,
  parseWakeflowConfig,
} from "../../../src/configuration/wakeflow-config.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { isWorkspaceLockHeld } from "../../../src/kernel/workspace-locks.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { createWakeflowMaintenanceExecutionIntent } from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-intent.js";
import {
  checkpointWakeflowMaintenanceExecutionIntent,
  publishWakeflowMaintenanceExecutionIntent,
  readWakeflowMaintenanceExecutionIntent,
  retireWakeflowMaintenanceExecutionIntent,
  type WakeflowMaintenanceExecutionIntentSource,
  WakeflowMaintenanceExecutionIntentStoreError,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-intent-store.js";
import { createWakeflowMaintenanceExecutionPlan } from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-plan.js";
import {
  type WakeflowMaintenanceGateContext,
  WakeflowMaintenanceGateError,
  withWakeflowMaintenanceGate,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-gate.js";
import { wakeflowMaintenanceIntentRef } from "../../../src/workspace/maintenance/wakeflow-maintenance-operation-id.js";
import {
  computeWakeflowStaticMaterializationPreviewDigest,
  parseWakeflowStaticMaterializationPreview,
} from "../../../src/workspace/maintenance/wakeflow-static-materialization-preview.js";
import { inspectWakeflowWorkspaceCoreLayout } from "../../../src/workspace/maintenance/wakeflow-workspace-core-layout-inspection.js";
import { createWakeflowWorkspaceStaticResourceMatrix } from "../../../src/workspace/wakeflow-workspace-static-resource-matrix.js";
import { createMinimalWakeflowConfig } from "../../configuration/wakeflow-config.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

/**
 * 维护门与 intent 的物理 store：门的引导与关联，intent 的发布、做完一步之后的计数改写与退役。
 * intent 是一次维护在事务目录里唯一的文件（ADR-0031，5a 的 C 行）。级别 1（组件）。
 */

const UUID = "11111111-1111-4111-8111-111111111111";
const OPERATION_ID = `maintenance_operation_${UUID}`;
const DIGEST = parseSha256Digest(`sha256:${"1".repeat(64)}`);
const DESIRED_CONFIG = parseWakeflowConfig(createMinimalWakeflowConfig());
const DESIRED_CONFIG_DIGEST = computeWakeflowConfigDigest(DESIRED_CONFIG);
const PROFILES = Object.freeze([
  codexWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostResourceProfile,
]);

async function fixture(t: TestContext) {
  const absolutePath = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "wakeflow-maintenance-gate-intent-")),
  );
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({ absolutePath, root });
}

function preview(coreLayoutInspectionDigest: typeof DIGEST) {
  const matrix = createWakeflowWorkspaceStaticResourceMatrix(codexWorkspaceHostResourceProfile);
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
    steps: Object.freeze([
      Object.freeze({
        stepId: "authority:config",
        kind: "publish-config" as const,
        ownerId: "config-authority",
        targetKey: "workspace.config-authority",
        sourceDigest: null,
        targetDigest: DESIRED_CONFIG_DIGEST,
        dependsOn: Object.freeze([]),
      }),
    ]),
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

async function publishIntent(
  root: RootedDirectory,
  context: Readonly<WakeflowMaintenanceGateContext>,
  plan: ReturnType<typeof preview>,
  writer?: unknown,
) {
  const intent = createWakeflowMaintenanceExecutionIntent(
    context.operationId,
    plan,
    REQUEST,
    DESIRED_CONFIG,
    writer,
  );
  return publishWakeflowMaintenanceExecutionIntent(root, context, intent);
}

function gateOptions(inspectionDigest: typeof DIGEST) {
  return { expectedCoreLayoutInspectionDigest: inspectionDigest, uuidFactory: () => UUID };
}

const isStoreError = (reason: string) => (error: unknown) =>
  error instanceof WakeflowMaintenanceExecutionIntentStoreError && error.reason === reason;

test("maintenance gate bootstraps, correlates operation and retires the published intent", async (t) => {
  const workspace = await fixture(t);
  const core = await inspectWakeflowWorkspaceCoreLayout(workspace.root);
  const plan = preview(core.inspectionDigest);
  let expiredContext: Readonly<WakeflowMaintenanceGateContext> | undefined;
  let retiredSource: Readonly<WakeflowMaintenanceExecutionIntentSource> | undefined;

  await withWakeflowMaintenanceGate(
    workspace.root,
    gateOptions(core.inspectionDigest),
    async (context) => {
      expiredContext = context;
      equal(context.operationId, OPERATION_ID);
      // 回调里门由本进程持有。
      equal(await isWorkspaceLockHeld(workspace.root, "maintenance-gate"), true);
      const published = await publishIntent(workspace.root, context, plan);
      retiredSource = published;
      equal(published.intent.operationId, OPERATION_ID);
      equal(published.intent.planDigest, plan.planDigest);
      equal(published.intent.completedSteps, 0);
      const reread = await readWakeflowMaintenanceExecutionIntent(
        workspace.root,
        context.operationId,
      );
      equal(reread.digest, published.digest);
      const retired = await retireWakeflowMaintenanceExecutionIntent(
        workspace.root,
        context,
        published,
      );
      equal(retired.disposition, "retired-intent");
    },
  );

  equal(existsSync(path.join(workspace.absolutePath, ".wakeflow-local")), true);
  const after = await inspectWakeflowWorkspaceCoreLayout(workspace.root);
  equal(after.local.status, "idle");
  equal(await isWorkspaceLockHeld(workspace.root, "maintenance-gate"), false);

  if (expiredContext === undefined || retiredSource === undefined) {
    throw new Error("Expected issued scope.");
  }
  // 门已经放掉：拿着过期的上下文什么都改不了。
  await rejects(
    retireWakeflowMaintenanceExecutionIntent(workspace.root, expiredContext, retiredSource),
    isStoreError("gate"),
  );
  await rejects(
    checkpointWakeflowMaintenanceExecutionIntent(workspace.root, expiredContext, retiredSource),
    isStoreError("gate"),
  );
});

test("a published intent survives operation failure while the gate releases", async (t) => {
  const workspace = await fixture(t);
  const core = await inspectWakeflowWorkspaceCoreLayout(workspace.root);
  const plan = preview(core.inspectionDigest);
  const privateError = new Error("stop after intent");
  let caught: unknown;
  try {
    await withWakeflowMaintenanceGate(
      workspace.root,
      gateOptions(core.inspectionDigest),
      async (context) => {
        await publishIntent(workspace.root, context, plan);
        throw privateError;
      },
    );
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught, privateError);
  const stored = await readWakeflowMaintenanceExecutionIntent(workspace.root, OPERATION_ID);
  equal(stored.intent.completedSteps, 0);
  const after = await inspectWakeflowWorkspaceCoreLayout(workspace.root);
  equal(after.local.status, "recovery-required");
  deepEqual(
    after.local.residues.map((residue) => [residue.kind, residue.operationId]),
    [["intent", OPERATION_ID]],
  );
  equal(await isWorkspaceLockHeld(workspace.root, "maintenance-gate"), false);
});

test("the intent store advances the completed-steps counter by exact replacement and keeps the intent digest", async (t) => {
  const workspace = await fixture(t);
  const core = await inspectWakeflowWorkspaceCoreLayout(workspace.root);
  const plan = preview(core.inspectionDigest);
  await withWakeflowMaintenanceGate(
    workspace.root,
    gateOptions(core.inspectionDigest),
    async (context) => {
      const published = await publishIntent(workspace.root, context, plan);
      const advanced = await checkpointWakeflowMaintenanceExecutionIntent(
        workspace.root,
        context,
        published,
      );
      equal(advanced.intent.completedSteps, 1);
      // 计数不进意图摘要：文件的字节变了，"这次要做成什么样"没有变。
      equal(advanced.intentDigest, published.intentDigest);
      equal(advanced.digest === published.digest, false);
      equal(
        (await readWakeflowMaintenanceExecutionIntent(workspace.root, context.operationId)).intent
          .completedSteps,
        1,
      );
      // 读到时的那一份已经被替换：拿旧的再记一步是冲突，不是再加一。
      await rejects(
        checkpointWakeflowMaintenanceExecutionIntent(workspace.root, context, published),
        isStoreError("conflict"),
      );
      // 计划只有一步：全部做完的意图没有后继。
      await rejects(
        checkpointWakeflowMaintenanceExecutionIntent(workspace.root, context, advanced),
        isStoreError("input"),
      );
      await rejects(
        retireWakeflowMaintenanceExecutionIntent(workspace.root, context, published),
        isStoreError("conflict"),
      );
      await retireWakeflowMaintenanceExecutionIntent(workspace.root, context, advanced);
    },
  );
  const idle = await inspectWakeflowWorkspaceCoreLayout(workspace.root);
  equal(idle.local.status, "idle");
});

test("the counter write rejects an intent that changed underneath it and a stray transaction entry", async (t) => {
  const workspace = await fixture(t);
  const core = await inspectWakeflowWorkspaceCoreLayout(workspace.root);
  const plan = preview(core.inspectionDigest);
  await withWakeflowMaintenanceGate(
    workspace.root,
    gateOptions(core.inspectionDigest),
    async (context) => {
      const published = await publishIntent(workspace.root, context, plan);
      const intentPath = path.join(
        workspace.absolutePath,
        ...wakeflowMaintenanceIntentRef(OPERATION_ID).split("/"),
      );
      const stray = path.join(path.dirname(intentPath), "stray.json");
      writeFileSync(stray, "{}\n", { mode: 0o600 });
      await rejects(
        checkpointWakeflowMaintenanceExecutionIntent(workspace.root, context, published),
        isStoreError("transactions-shape"),
      );
      rmSync(stray);
      writeFileSync(intentPath, "{}\n", { mode: 0o600 });
      await rejects(
        checkpointWakeflowMaintenanceExecutionIntent(workspace.root, context, published),
        (error: unknown) => error instanceof WakeflowMaintenanceExecutionIntentStoreError,
      );
    },
  );
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

const WRITER = Object.freeze({
  version: "1.2.0",
  manifestDigest: parseSha256Digest(`sha256:${"5".repeat(64)}`),
});
test("the intent keeps its writer stamp across counter writes (C11)", async (t) => {
  const workspace = await fixture(t);
  const core = await inspectWakeflowWorkspaceCoreLayout(workspace.root);
  const plan = preview(core.inspectionDigest);
  await withWakeflowMaintenanceGate(
    workspace.root,
    gateOptions(core.inspectionDigest),
    async (context) => {
      const published = await publishIntent(workspace.root, context, plan, WRITER);
      deepEqual(published.intent.writer, WRITER);
      const advanced = await checkpointWakeflowMaintenanceExecutionIntent(
        workspace.root,
        context,
        published,
      );
      deepEqual(
        (await readWakeflowMaintenanceExecutionIntent(workspace.root, context.operationId)).intent
          .writer,
        WRITER,
      );
      await retireWakeflowMaintenanceExecutionIntent(workspace.root, context, advanced);
    },
  );
  equal((await inspectWakeflowWorkspaceCoreLayout(workspace.root)).local.status, "idle");
});
