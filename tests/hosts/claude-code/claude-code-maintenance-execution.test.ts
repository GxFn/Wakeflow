import { deepEqual, equal, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { parseWakeflowConfig } from "../../../src/configuration/wakeflow-config.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  CLAUDE_CODE_STATUSLINE_ASSET_BLOCKER,
  claudeCodeMaintenanceCapability,
} from "../../../src/hosts/claude-code/claude-code-maintenance-capability.js";
import {
  executeClaudeCodeMaintenanceExecution,
  previewClaudeCodeMaintenanceExecution,
  recoverClaudeCodeMaintenanceExecution,
} from "../../../src/hosts/claude-code/claude-code-maintenance-execution.js";
import {
  claudeCodePortableSettingsRulesFor,
  WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
} from "../../../src/hosts/claude-code/claude-code-portable-settings-transition.js";
import {
  CLAUDE_CODE_STATUSLINE_ASSET_DIGEST,
  CLAUDE_CODE_STATUSLINE_ASSET_REF,
  claudeCodeStatuslineCommand,
} from "../../../src/hosts/claude-code/claude-code-statusline-asset.js";
import { CLAUDE_CODE_STATUSLINE_ASSET_OPERATION_ID } from "../../../src/hosts/claude-code/claude-code-statusline-asset-operation.js";
import {
  CLAUDE_CODE_LOCAL_SETTINGS_REF,
  CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_ID,
  claudeCodeStatuslineSettingsSurfaceOperationId,
} from "../../../src/hosts/claude-code/claude-code-statusline-settings-operation.js";
import {
  CLAUDE_CODE_TMUX_ASSET_DIGEST,
  CLAUDE_CODE_TMUX_ASSET_REF,
  WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE,
} from "../../../src/hosts/claude-code/claude-code-tmux-asset.js";
import { CLAUDE_CODE_TMUX_ASSET_OPERATION_ID } from "../../../src/hosts/claude-code/claude-code-tmux-asset-operation.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { createWakeflowMaintenanceExecutionIntent } from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-intent.js";
import { publishWakeflowMaintenanceExecutionIntent } from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-intent-store.js";
import { WakeflowMaintenanceExecutionPreviewError } from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-preview.js";
import { WakeflowMaintenanceExecutionTransactionError } from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-transaction.js";
import { withWakeflowMaintenanceGate } from "../../../src/workspace/maintenance/wakeflow-maintenance-gate.js";
import {
  beginWakeflowMaintenanceJournalStep,
  completeWakeflowMaintenanceJournalStep,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-journal.js";
import {
  checkpointWakeflowMaintenanceJournal,
  publishPreparedWakeflowMaintenanceJournal,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-journal-store.js";
import { parseWakeflowMaintenanceOperationId } from "../../../src/workspace/maintenance/wakeflow-maintenance-operation-id.js";
import { executeWakeflowStaticMaterializationStep } from "../../../src/workspace/maintenance/wakeflow-static-materialization-step-executor.js";
import { createMinimalWakeflowConfig } from "../../configuration/wakeflow-config.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

/**
 * Claude 宿主的聚合维护事务（能力卡 1 §1.1 / §1.4 / §1.5，gate-log §13.94 D6、§13.117 D4–D5，复审 M2）。
 * 2 级能力测试：在一次性 Git 工作区上跑完整的 preview → apply → recover，覆盖 fresh 的三条 portable
 * settings、两份资产与三条本地设置条目、affected 操作的恢复重放、设置漂移的 plan-stale 拒绝、读不出的
 * 资产 blocker，以及 reconcile 对被删受管 Design 根的重建与规则回写（open-items W5 / CR-H6）。
 */

const PROFILES = Object.freeze([
  codexWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostResourceProfile,
]);
const UUID = "11111111-1111-4111-8111-111111111111";
const RECONCILE_UUID = "22222222-2222-4222-8222-222222222222";
const OPERATION_ID = parseWakeflowMaintenanceOperationId(`maintenance_operation_${UUID}`);

async function fixture(t: TestContext) {
  const absolutePath = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "wakeflow-claude-maintenance-execution-")),
  );
  const initialized = spawnSync("git", ["init", "--quiet"], {
    cwd: absolutePath,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (initialized.status !== 0) throw new Error("Cannot initialize fixture Git.");
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({ absolutePath, root });
}

function desiredConfig() {
  const value = createMinimalWakeflowConfig();
  (value.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  return parseWakeflowConfig(value);
}

function request(config: ReturnType<typeof desiredConfig>) {
  return Object.freeze({
    action: "fresh-initialize" as const,
    desiredConfig: config,
    currentHostProfile: claudeCodeWorkspaceHostResourceProfile,
    hostProfiles: PROFILES,
  });
}

function settingsPermission(absoluteRoot: string): readonly string[] {
  const value = JSON.parse(
    readFileSync(path.join(absoluteRoot, ".claude", "settings.json"), "utf8"),
  ) as { permissions: { allow: string[] } };
  return value.permissions.allow;
}

test("Claude aggregate preview preserves cancellation as an operation outcome", async (t) => {
  const workspace = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  await rejects(
    previewClaudeCodeMaintenanceExecution(workspace.root, {
      ...request(desiredConfig()),
      signal: controller.signal,
    }),
    (error: unknown) =>
      error instanceof WakeflowMaintenanceExecutionPreviewError && error.reason === "aborted",
  );
});

test("Claude aggregate transaction publishes three portable settings, the two assets and the three local settings entries before Config", async (t) => {
  const workspace = await fixture(t);
  const desired = desiredConfig();
  const input = request(desired);
  const plan = await previewClaudeCodeMaintenanceExecution(workspace.root, input);
  equal(plan.status, "ready");
  // 三条 portable settings、状态栏资产、本地设置条目（工作区根与 Design、Test 面各一条，复审 M2）、tmux 助手资产；
  // 按标识排序（§13.94 D6，§13.117 D4）。
  equal(plan.hostContribution?.operations.length, 8);
  const statusline = plan.hostContribution?.operations.at(-5);
  const settings = plan.hostContribution?.operations.at(-4);
  const designSettings = plan.hostContribution?.operations.at(-3);
  const testSettings = plan.hostContribution?.operations.at(-2);
  const tmuxAsset = plan.hostContribution?.operations.at(-1);
  equal(settings?.operationId, CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_ID);
  equal(settings?.operationKind, "statusline-settings");
  equal(settings?.sourceDigest, null);
  const [designSurface, testSurface] = desired.topology.supportSurfaces;
  if (designSurface === undefined || testSurface === undefined) {
    throw new Error("The fixture config declares two support surfaces.");
  }
  equal(
    designSettings?.operationId,
    claudeCodeStatuslineSettingsSurfaceOperationId(designSurface.surfaceId),
  );
  equal(
    testSettings?.operationId,
    claudeCodeStatuslineSettingsSurfaceOperationId(testSurface.surfaceId),
  );
  for (const entry of [designSettings, testSettings]) {
    equal(entry?.operationKind, "statusline-settings");
    equal(entry?.sourceDigest, null, "a surface that does not exist yet plans a create");
  }
  equal(statusline?.operationId, CLAUDE_CODE_STATUSLINE_ASSET_OPERATION_ID);
  equal(statusline?.operationKind, "statusline-asset");
  equal(statusline?.targetDigest, CLAUDE_CODE_STATUSLINE_ASSET_DIGEST);
  equal(tmuxAsset?.operationId, CLAUDE_CODE_TMUX_ASSET_OPERATION_ID);
  equal(tmuxAsset?.operationKind, "tmux-asset");
  equal(tmuxAsset?.targetDigest, CLAUDE_CODE_TMUX_ASSET_DIGEST);
  equal(plan.steps.at(-1)?.stepId, "authority:config");
  equal(plan.steps.filter((entry) => entry.boundary === "host-capability").length, 8);

  const completed = await executeClaudeCodeMaintenanceExecution(workspace.root, plan, input, {
    uuidFactory: () => UUID,
  });
  equal(completed.status, "completed");
  equal(completed.operationId, OPERATION_ID);
  equal(completed.stepReceipts.filter((entry) => entry.boundary === "host-capability").length, 8);
  const assetPath = path.join(
    workspace.absolutePath,
    ...CLAUDE_CODE_STATUSLINE_ASSET_REF.split("/"),
  );
  equal(statSync(assetPath).mode & 0o777, 0o600);
  equal(computeSha256Digest(readFileSync(assetPath)), CLAUDE_CODE_STATUSLINE_ASSET_DIGEST);
  const tmuxAssetPath = path.join(workspace.absolutePath, ...CLAUDE_CODE_TMUX_ASSET_REF.split("/"));
  equal(statSync(tmuxAssetPath).mode & 0o777, 0o600);
  equal(computeSha256Digest(readFileSync(tmuxAssetPath)), CLAUDE_CODE_TMUX_ASSET_DIGEST);
  // 本地设置只有 statusLine 一键，命令指向资产并带 base64url 的根；文件 0600（忽略的私有文件）。
  const localSettingsPath = path.join(
    workspace.absolutePath,
    ...CLAUDE_CODE_LOCAL_SETTINGS_REF.split("/"),
  );
  equal(statSync(localSettingsPath).mode & 0o777, 0o600);
  deepEqual(JSON.parse(readFileSync(localSettingsPath, "utf8")), {
    statusLine: {
      type: "command",
      command: claudeCodeStatuslineCommand(workspace.root.absolutePath),
    },
  });
  // Design、Test 面各有同一条目（命令里仍是工作区根），所以那两个窗口也有状态行（复审 M2）。
  for (const surface of desired.topology.supportSurfaces) {
    const surfaceSettingsPath = path.join(
      workspace.absolutePath,
      surface.path,
      ...CLAUDE_CODE_LOCAL_SETTINGS_REF.split("/"),
    );
    equal(statSync(surfaceSettingsPath).mode & 0o777, 0o600);
    deepEqual(JSON.parse(readFileSync(surfaceSettingsPath, "utf8")), {
      statusLine: {
        type: "command",
        command: claudeCodeStatuslineCommand(workspace.root.absolutePath),
      },
    });
  }
  // 工作区根多一条只放行 tmux 助手的规则（§13.117 D5）；支撑面只放行该角色使用的工具（ADR-0020 决定 3），且没有任何 Bash 规则。
  deepEqual(settingsPermission(workspace.absolutePath), [
    WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
    WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE,
  ]);
  equal(WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE.includes(" *)"), true);
  equal(WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE.startsWith("Bash(node .wakeflow-local/"), true);
  for (const [directory, role] of [
    ["Design", "design"],
    ["Test", "test"],
  ] as const) {
    const root = path.join(workspace.absolutePath, directory);
    deepEqual(settingsPermission(root), [
      ...claudeCodePortableSettingsRulesFor({ rootKind: "support-surface", role }),
    ]);
    equal(
      readFileSync(path.join(root, ".claude", "settings.json"), "utf8").includes("Bash("),
      false,
    );
  }
  equal(existsSync(path.join(workspace.absolutePath, "wakeflow.config.json")), true);

  const reconcileInput = Object.freeze({
    action: "reconcile" as const,
    desiredConfig: null,
    currentHostProfile: claudeCodeWorkspaceHostResourceProfile,
    hostProfiles: PROFILES,
  });
  const reconcilePlan = await previewClaudeCodeMaintenanceExecution(workspace.root, reconcileInput);
  equal(reconcilePlan.steps.length, 0);
  const noOp = await executeClaudeCodeMaintenanceExecution(
    workspace.root,
    reconcilePlan,
    reconcileInput,
  );
  equal(noOp.status, "no-op");
  equal(noOp.operationId, null);
});

test("reconcile rebuilds a deleted managed Design root and writes Claude's rules into it instead of blocking on its own contribution", async (t) => {
  const workspace = await fixture(t);
  const desired = desiredConfig();
  const input = request(desired);
  const initialized = await executeClaudeCodeMaintenanceExecution(
    workspace.root,
    await previewClaudeCodeMaintenanceExecution(workspace.root, input),
    input,
    { uuidFactory: () => UUID },
  );
  equal(initialized.status, "completed");
  const [designSurface] = desired.topology.supportSurfaces;
  if (designSurface === undefined) throw new Error("The fixture config declares a Design surface.");
  const designRoot = path.join(workspace.absolutePath, designSurface.path);
  // 用户误删（或移走）了受管 Design 根，连同里面的 Claude 设置（open-items W5 / CR-H6）。
  rmSync(designRoot, { recursive: true, force: true });
  equal(existsSync(designRoot), false);

  const reconcileInput = Object.freeze({
    action: "reconcile" as const,
    desiredConfig: null,
    currentHostProfile: claudeCodeWorkspaceHostResourceProfile,
    hostProfiles: PROFILES,
  });
  const plan = await previewClaudeCodeMaintenanceExecution(workspace.root, reconcileInput);
  deepEqual(
    plan.blockerCodes,
    [],
    "the host contribution no longer blocks the root it needs rebuilt",
  );
  equal(plan.status, "ready");
  equal(plan.hostContribution?.status, "ready");
  // 共享步先重建根；宿主为它计划的两条 create（规则与状态行条目）都排在该步之后。
  const rootStepIndex = plan.steps.findIndex(
    (entry) => entry.stepId === `support-root:${designSurface.surfaceId}`,
  );
  const rootStep = plan.steps[rootStepIndex];
  equal(
    rootStep?.boundary === "shared-static" ? rootStep.stepKind : null,
    "materialize-support-root",
  );
  const designOperations = [
    `claude-portable-settings:support-surface:${designSurface.surfaceId}`,
    claudeCodeStatuslineSettingsSurfaceOperationId(designSurface.surfaceId),
  ].map((operationId) => ({
    operationId,
    sourceDigest: plan.hostContribution?.operations.find(
      (entry) => entry.operationId === operationId,
    )?.sourceDigest,
    stepIndex: plan.steps.findIndex((entry) => entry.stepId === `host-effect:${operationId}`),
  }));
  deepEqual(
    designOperations.map((entry) => entry.sourceDigest),
    [null, null],
    "both Design operations are creates into the rebuilt root",
  );
  equal(
    designOperations.every((entry) => entry.stepIndex > rootStepIndex),
    true,
    "the Design host operations run after the root is rebuilt",
  );

  const completed = await executeClaudeCodeMaintenanceExecution(
    workspace.root,
    plan,
    reconcileInput,
    { uuidFactory: () => RECONCILE_UUID },
  );
  equal(completed.status, "completed");
  equal(
    statSync(path.join(designRoot, "drafts")).isDirectory(),
    true,
    "the shared step rebuilt the root with its scaffold",
  );
  deepEqual(settingsPermission(designRoot), [
    ...claudeCodePortableSettingsRulesFor({ rootKind: "support-surface", role: "design" }),
  ]);
  const localSettingsPath = path.join(designRoot, ...CLAUDE_CODE_LOCAL_SETTINGS_REF.split("/"));
  equal(statSync(localSettingsPath).mode & 0o777, 0o600);
  deepEqual(JSON.parse(readFileSync(localSettingsPath, "utf8")), {
    statusLine: {
      type: "command",
      command: claudeCodeStatuslineCommand(workspace.root.absolutePath),
    },
  });
  // 修好之后再对账：零步骤、无阻塞，即只读校验通过。
  const verified = await previewClaudeCodeMaintenanceExecution(workspace.root, reconcileInput);
  equal(verified.status, "ready");
  deepEqual(verified.blockerCodes, []);
  equal(verified.steps.length, 0);
});

test("recovery replays only the affected Claude operation from the exact journal", async (t) => {
  const workspace = await fixture(t);
  const desired = desiredConfig();
  const input = request(desired);
  const plan = await previewClaudeCodeMaintenanceExecution(workspace.root, input);
  const privateError = new Error("interrupt after first Claude host effect");
  try {
    await withWakeflowMaintenanceGate(
      workspace.root,
      {
        expectedCoreLayoutInspectionDigest: plan.sharedPreview.coreLayoutInspectionDigest,
        operationId: OPERATION_ID,
      },
      async (context) => {
        const intent = createWakeflowMaintenanceExecutionIntent(
          context.operationId,
          plan,
          input,
          desired,
        );
        const intentSource = await publishWakeflowMaintenanceExecutionIntent(
          workspace.root,
          context,
          intent,
        );
        let source = await publishPreparedWakeflowMaintenanceJournal(
          workspace.root,
          context,
          intentSource,
          plan,
        );
        for (const step of plan.steps) {
          source = await checkpointWakeflowMaintenanceJournal(
            workspace.root,
            context,
            intentSource,
            source,
            beginWakeflowMaintenanceJournalStep(source.journal),
          );
          if (step.boundary === "shared-static") {
            await executeWakeflowStaticMaterializationStep(
              workspace.root,
              context,
              plan.sharedPreview,
              input,
              step.stepId,
              { sourceConfig: null, recoveringAffectedStep: false },
            );
          } else {
            const operation = plan.hostContribution?.operations.find(
              (entry) => entry.operationId === step.operationId,
            );
            if (operation === undefined) {
              throw new Error("Missing host operation.");
            }
            await claudeCodeMaintenanceCapability.executeOperation(workspace.root, context, {
              config: desired,
              profile: claudeCodeWorkspaceHostResourceProfile,
              operation,
              recoveringAffectedOperation: false,
            });
            throw privateError;
          }
          source = await checkpointWakeflowMaintenanceJournal(
            workspace.root,
            context,
            intentSource,
            source,
            completeWakeflowMaintenanceJournalStep(source.journal),
          );
        }
        throw new Error("Expected a Claude host operation.");
      },
    );
  } catch (error: unknown) {
    equal(error, privateError);
  }
  equal(existsSync(path.join(workspace.absolutePath, ".claude", "settings.json")), true);
  equal(existsSync(path.join(workspace.absolutePath, "Design", ".claude", "settings.json")), false);
  equal(existsSync(path.join(workspace.absolutePath, "wakeflow.config.json")), false);

  const recovered = await recoverClaudeCodeMaintenanceExecution(workspace.root, OPERATION_ID);
  equal(recovered.status, "recovered");
  equal(recovered.stepReceipts[0]?.boundary, "host-capability");
  equal(recovered.stepReceipts[0]?.disposition, "current");
  equal(recovered.stepReceipts.at(-1)?.stepId, "authority:config");
  equal(
    existsSync(path.join(workspace.absolutePath, ...CLAUDE_CODE_STATUSLINE_ASSET_REF.split("/"))),
    true,
    "recovery installs the statusline asset after the interrupted settings operation",
  );
  equal(
    existsSync(path.join(workspace.absolutePath, ...CLAUDE_CODE_TMUX_ASSET_REF.split("/"))),
    true,
    "recovery installs the tmux helper asset too",
  );
  equal(
    existsSync(path.join(workspace.absolutePath, ...CLAUDE_CODE_LOCAL_SETTINGS_REF.split("/"))),
    true,
    "recovery installs the local settings entry too",
  );
  equal(existsSync(path.join(workspace.absolutePath, "Design", ".claude", "settings.json")), true);
  equal(existsSync(path.join(workspace.absolutePath, "wakeflow.config.json")), true);
});

test("Claude aggregate execution rejects settings drift before acquiring the gate", async (t) => {
  const workspace = await fixture(t);
  const desired = desiredConfig();
  const input = request(desired);
  const plan = await previewClaudeCodeMaintenanceExecution(workspace.root, input);
  mkdirSync(path.join(workspace.absolutePath, ".claude"), { mode: 0o755 });
  writeFileSync(
    path.join(workspace.absolutePath, ".claude", "settings.json"),
    '{\n  "theme": "dark"\n}\n',
    { mode: 0o644 },
  );
  let caught: unknown;
  try {
    await executeClaudeCodeMaintenanceExecution(workspace.root, plan, input, {
      uuidFactory: () => UUID,
    });
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowMaintenanceExecutionTransactionError, true);
  if (caught instanceof WakeflowMaintenanceExecutionTransactionError) {
    equal(caught.reason, "plan-stale");
    equal(caught.operationId, null);
  }
  equal(existsSync(path.join(workspace.absolutePath, ".wakeflow-local")), false);
  equal(existsSync(path.join(workspace.absolutePath, "wakeflow.config.json")), false);
});

test("状态栏资产不是常规文件时贡献 blocked 并带稳定 blocker，工作区仍可维护", async (t) => {
  const workspace = await fixture(t);
  // 资产路径被一个目录占住（解压残留）：字节读不稳，但这不能让整个工作区无法维护。
  mkdirSync(path.join(workspace.absolutePath, ...CLAUDE_CODE_STATUSLINE_ASSET_REF.split("/")), {
    recursive: true,
    mode: 0o700,
  });
  const input = request(desiredConfig());
  const plan = await previewClaudeCodeMaintenanceExecution(workspace.root, input);
  equal(plan.status, "blocked");
  equal(plan.hostContribution?.status, "blocked");
  deepEqual(
    plan.hostContribution?.blockerCodes,
    [CLAUDE_CODE_STATUSLINE_ASSET_BLOCKER],
    "读不出的资产只报一条稳定 blocker",
  );
  equal(
    plan.blockerCodes.includes(
      `host:claude-code:claude-code-maintenance:${CLAUDE_CODE_STATUSLINE_ASSET_BLOCKER}`,
    ),
    true,
    "宿主 blocker 以贡献身份前缀进入计划",
  );
  equal(
    plan.hostContribution?.operations.some((entry) => entry.operationKind === "statusline-asset"),
    false,
    "读不出的资产不带安装操作",
  );
  // 其他宿主操作仍在计划里：blocked 只丢掉读不出的那一条。
  equal(
    plan.hostContribution?.operations.some(
      (entry) => entry.operationId === CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_ID,
    ),
    true,
  );
});
