import { deepEqual, equal, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { compileWakeflowFreshConfigSelection } from "../../src/configuration/wakeflow-fresh-config-selection.js";
import { executeClaudeCodeWakeflowMaintenance } from "../../src/entrypoints/claude-code-wakeflow-maintenance.js";
import { executeCodexWakeflowMaintenance } from "../../src/entrypoints/codex-wakeflow-maintenance.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { parseSha256Digest } from "../../src/foundation/crypto/sha256.js";
import { isWakeflowError } from "../../src/kernel/error.js";
import { WORK_CLAIMS_ROOT_REF } from "../../src/kernel/layout.js";
import { createWakeflowMaintenanceExecutionIntent } from "../../src/workspace/maintenance/wakeflow-maintenance-execution-intent.js";
import { publishWakeflowMaintenanceExecutionIntent } from "../../src/workspace/maintenance/wakeflow-maintenance-execution-intent-store.js";
import { parseWakeflowMaintenanceExecutionPlan } from "../../src/workspace/maintenance/wakeflow-maintenance-execution-plan.js";
import { withWakeflowMaintenanceGate } from "../../src/workspace/maintenance/wakeflow-maintenance-gate.js";
import { parseWakeflowMaintenanceOperationId } from "../../src/workspace/maintenance/wakeflow-maintenance-operation-id.js";
import { createMinimalWakeflowFreshConfigSelection } from "../configuration/wakeflow-fresh-config-selection.fixture.js";
import { useDisposableDurability } from "../support/disposable-durability.js";

useDisposableDurability();

async function fixture(t: TestContext, label: string) {
  const absolutePath = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), `wakeflow-public-${label}-`)),
  );
  const initialized = spawnSync("git", ["init", "--quiet"], {
    cwd: absolutePath,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (initialized.status !== 0) throw new Error("Cannot initialize fixture Git.");
  t.after(() => rmSync(absolutePath, { recursive: true, force: true }));
  return absolutePath;
}

function selection() {
  const value = createMinimalWakeflowFreshConfigSelection();
  (value.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  return value;
}

const RECOVERY_OPERATION_ID = parseWakeflowMaintenanceOperationId(
  "maintenance_operation_11111111-1111-4111-8111-111111111111",
);

test("Codex public entrypoint completes Fresh preview/apply and a no-op reconcile", async (t) => {
  const root = await fixture(t, "codex");
  const before = readdirSync(root).sort();
  // apply 必须重发同一请求：同一 selection 才能重算出同一计划摘要。
  const selected = selection();
  const preview = await executeCodexWakeflowMaintenance({
    root,
    action: "fresh-initialize",
    mode: "preview",
    request: { selection: selected },
  });

  equal(preview.mode, "preview");
  equal(preview.hostId, "codex");
  equal(preview.status, "ready");
  equal(preview.plan !== null, true);
  equal(preview.launchIntents.length, 4);
  equal(preview.next.frontier, "workspace-maintenance-apply");
  equal(preview.next.owner, "user");
  equal(JSON.stringify(preview).includes(root), false);
  deepEqual(readdirSync(root).sort(), before);
  if (preview.planDigest === null) {
    throw new Error("Expected a ready public plan digest.");
  }

  const applied = await executeCodexWakeflowMaintenance({
    root,
    action: "fresh-initialize",
    mode: "apply",
    request: { selection: selected },
    planDigest: preview.planDigest,
  });
  equal(applied.mode, "apply");
  equal(applied.action, "fresh-initialize");
  equal(applied.status, "completed");
  equal(applied.planDigest, preview.planDigest);
  equal(applied.launchIntents.length, 4);
  equal(applied.next.frontier, "window-launch");
  equal(applied.next.suggestedTool, "wakeflow_register_window_binding");
  equal(existsSync(path.join(root, "wakeflow.config.json")), true);
  const claimRoot = path.join(root, ...WORK_CLAIMS_ROOT_REF.split("/"));
  equal(existsSync(claimRoot), true);
  equal(statSync(claimRoot).mode & 0o777, 0o700);
  equal(JSON.stringify(applied).includes(root), false);

  const reconcile = await executeCodexWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "preview",
    request: {},
  });
  equal(reconcile.mode, "preview");
  equal(reconcile.status, "ready");
  equal(reconcile.launchIntents.length, 0);
  if (reconcile.planDigest === null) {
    throw new Error("Expected a ready reconcile plan digest.");
  }
  const reconciled = await executeCodexWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "apply",
    request: {},
    planDigest: reconcile.planDigest,
  });
  equal(reconciled.mode, "apply");
  equal(reconciled.status, "no-op");
  equal(reconciled.operationId, null);
  equal(reconciled.next.frontier, null);
  equal(reconciled.next.owner, "none");
});

test("Claude entrypoint contributes settings and its plan digest is rejected by Codex", async (t) => {
  const root = await fixture(t, "claude");
  const selected = selection();
  const preview = await executeClaudeCodeWakeflowMaintenance({
    root,
    action: "fresh-initialize",
    mode: "preview",
    request: { selection: selected },
  });
  equal(preview.mode, "preview");
  equal(preview.hostId, "claude-code");
  if (preview.planDigest === null || preview.plan === null) {
    throw new Error("Expected a ready Claude plan.");
  }
  const plan = parseWakeflowMaintenanceExecutionPlan(preview.plan);
  // 三条 portable settings、状态栏资产、三条本地设置条目（根与 Design、Test 面，复审 M2）、tmux 助手资产。
  equal(plan.hostContribution?.operations.length, 8);

  let caught: unknown;
  try {
    await executeCodexWakeflowMaintenance({
      root,
      action: "fresh-initialize",
      mode: "apply",
      request: { selection: selected },
      planDigest: preview.planDigest,
    });
  } catch (error: unknown) {
    caught = error;
  }
  equal(isWakeflowError(caught), true);
  if (isWakeflowError(caught)) {
    equal(caught.code, "precondition-failed");
    equal(caught.reason, "plan-drift");
    equal(caught.path, "$request.planDigest");
  }
  equal(existsSync(path.join(root, "wakeflow.config.json")), false);
});

test("Public recovery consumes only an operation ID and its private intent", async (t) => {
  const absoluteRoot = await fixture(t, "recover");
  const selected = selection();
  const preview = await executeCodexWakeflowMaintenance({
    root: absoluteRoot,
    action: "fresh-initialize",
    mode: "preview",
    request: { selection: selected },
  });
  if (preview.mode !== "preview" || preview.plan === null) {
    throw new Error("Expected a ready recovery fixture plan.");
  }
  const executionPlan = parseWakeflowMaintenanceExecutionPlan(preview.plan);
  const rooted = await RootedDirectory.open(absoluteRoot);
  // 维护以工作区根（realpath）作 id 种子（裁决 R2）：手工编译同一 selection 时要传同一根，意图才与计划一致。
  const desiredConfig = compileWakeflowFreshConfigSelection(selected, {
    workspaceRoot: rooted.absolutePath,
  }).config;
  const executionRequest = Object.freeze({
    action: "fresh-initialize" as const,
    desiredConfig,
    currentHostProfile: codexWorkspaceHostResourceProfile,
    hostProfiles: Object.freeze([
      codexWorkspaceHostResourceProfile,
      claudeCodeWorkspaceHostResourceProfile,
    ]),
  });
  const interrupted = new Error("intent-only test interruption");
  try {
    await rejects(
      withWakeflowMaintenanceGate(
        rooted,
        {
          expectedCoreLayoutInspectionDigest:
            executionPlan.sharedPreview.coreLayoutInspectionDigest,
          operationId: RECOVERY_OPERATION_ID,
        },
        async (context) => {
          await publishWakeflowMaintenanceExecutionIntent(
            rooted,
            context,
            createWakeflowMaintenanceExecutionIntent(
              context.operationId,
              executionPlan,
              executionRequest,
              desiredConfig,
            ),
          );
          throw interrupted;
        },
      ),
      (error: unknown) => error === interrupted,
    );
  } finally {
    await rooted.close();
  }

  const recovered = await executeCodexWakeflowMaintenance({
    root: absoluteRoot,
    mode: "recover",
    operationId: RECOVERY_OPERATION_ID,
  });
  equal(recovered.mode, "recover");
  equal(recovered.status, "recovered");
  equal(recovered.operationId, RECOVERY_OPERATION_ID);
  equal(recovered.action, null);
  equal(recovered.next.frontier, null);
  equal(existsSync(path.join(absoluteRoot, "wakeflow.config.json")), true);
  equal(JSON.stringify(recovered).includes(absoluteRoot), false);
});

test("被中断的维护事务是另一版制品写的（open-items B8）：本构建读不了它的意图时，恢复以 maintenance-recovery-artifact-mismatch 说出那一版；写者戳相同或没有戳时仍是 intent", async (t) => {
  const absoluteRoot = await fixture(t, "recover-other-build");
  const selected = selection();
  const preview = await executeCodexWakeflowMaintenance({
    root: absoluteRoot,
    action: "fresh-initialize",
    mode: "preview",
    request: { selection: selected },
  });
  if (preview.mode !== "preview" || preview.plan === null) {
    throw new Error("Expected a ready recovery fixture plan.");
  }
  const executionPlan = parseWakeflowMaintenanceExecutionPlan(preview.plan);
  const olderBuild = {
    version: "1.2.9",
    manifestDigest: parseSha256Digest(`sha256:${"a".repeat(64)}`),
  };
  const thisBuild = {
    version: "1.3.0",
    manifestDigest: parseSha256Digest(`sha256:${"b".repeat(64)}`),
  };
  const intentFile = path.join(
    absoluteRoot,
    ".wakeflow-local",
    "runtime",
    "maintenance",
    "transactions",
    `${RECOVERY_OPERATION_ID}.intent.json`,
  );
  /** 留下一份只有意图的中断事务；`writer` 是写它的那一版制品的戳（null 即没有戳）。 */
  const interrupt = async (writer: typeof olderBuild | null): Promise<void> => {
    const rooted = await RootedDirectory.open(absoluteRoot);
    const desiredConfig = compileWakeflowFreshConfigSelection(selected, {
      workspaceRoot: rooted.absolutePath,
    }).config;
    const executionRequest = Object.freeze({
      action: "fresh-initialize" as const,
      desiredConfig,
      currentHostProfile: codexWorkspaceHostResourceProfile,
      hostProfiles: Object.freeze([
        codexWorkspaceHostResourceProfile,
        claudeCodeWorkspaceHostResourceProfile,
      ]),
    });
    const interrupted = new Error("other-build test interruption");
    try {
      await rejects(
        withWakeflowMaintenanceGate(
          rooted,
          {
            expectedCoreLayoutInspectionDigest:
              executionPlan.sharedPreview.coreLayoutInspectionDigest,
            operationId: RECOVERY_OPERATION_ID,
          },
          async (context) => {
            await publishWakeflowMaintenanceExecutionIntent(
              rooted,
              context,
              createWakeflowMaintenanceExecutionIntent(
                context.operationId,
                executionPlan,
                executionRequest,
                desiredConfig,
                writer ?? undefined,
              ),
            );
            throw interrupted;
          },
        ),
        (error: unknown) => error === interrupted,
      );
    } finally {
      await rooted.close();
    }
    // 另一版制品的计划代码算出的摘要与本构建不同：把存下的 planDigest 换成别的值来模拟。
    const stored = readFileSync(intentFile, "utf8");
    const foreign = stored.replace(
      `"planDigest": "${executionPlan.planDigest}"`,
      `"planDigest": "sha256:${"f".repeat(64)}"`,
    );
    equal(foreign === stored, false, "the stored intent carries the plan digest");
    writeFileSync(intentFile, foreign, { mode: 0o600 });
  };
  const recover = async (writer: typeof thisBuild | null) => {
    try {
      await executeCodexWakeflowMaintenance(
        { root: absoluteRoot, mode: "recover", operationId: RECOVERY_OPERATION_ID },
        { writer },
      );
    } catch (error: unknown) {
      if (!isWakeflowError(error)) throw error;
      return {
        code: error.code,
        reason: error.reason,
        details: JSON.parse(JSON.stringify(error.details ?? null)) as unknown,
      };
    }
    throw new Error("recover unexpectedly succeeded");
  };

  await interrupt(olderBuild);
  // 本构建（另一份 manifest）恢复不了：说出写它的那一版。没有 manifest 的测试构建同样算"不是那一版"。
  for (const running of [thisBuild, null]) {
    deepEqual(await recover(running), {
      code: "recovery-required",
      reason: "maintenance-recovery-artifact-mismatch",
      details: { operationId: RECOVERY_OPERATION_ID, writerVersion: "1.2.9" },
    });
  }
  // 同一份制品也读不了：那是意图本身坏了，不是版本问题。
  deepEqual(await recover(olderBuild), {
    code: "recovery-required",
    reason: "intent",
    details: { operationId: RECOVERY_OPERATION_ID },
  });
  // 什么都没有被改动：意图还在，配置没有被写出。
  equal(existsSync(intentFile), true);
  equal(existsSync(path.join(absoluteRoot, "wakeflow.config.json")), false);
});
