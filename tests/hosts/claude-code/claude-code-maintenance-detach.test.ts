/**
 * 2 级（能力）：Claude 宿主维护 capability 的退出路径贡献（ADR-0024，能力卡 01/02）。在一次性 Git 工作区
 * 上先走完整的 fresh-initialize，再直接向 capability 要 detach-workspace 与 detach-repository 的贡献，并在
 * 维护门内执行每条宿主操作：两种宿主步的种类名与 targetKey、按标识排序、执行后只剩用户自己的条目与键、
 * 资产与配置不碰、删完再计划为空、读不出的根成为 blocker、种类与负载不一致的操作被拒绝。共享的 detach
 * 步（受管块、投影退役、retire-config）属于核心切片，不在本文件。
 */
import { deepEqual, equal, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
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
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { claudeCodeMaintenanceCapability } from "../../../src/hosts/claude-code/claude-code-maintenance-capability.js";
import {
  executeClaudeCodeMaintenanceExecution,
  previewClaudeCodeMaintenanceExecution,
} from "../../../src/hosts/claude-code/claude-code-maintenance-execution.js";
import {
  CLAUDE_CODE_PORTABLE_SETTINGS_REMOVAL_BLOCKER,
  CLAUDE_CODE_PORTABLE_SETTINGS_REMOVAL_OPERATION_KIND,
} from "../../../src/hosts/claude-code/claude-code-portable-settings-composition.js";
import { WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE } from "../../../src/hosts/claude-code/claude-code-portable-settings-transition.js";
import { CLAUDE_CODE_STATUSLINE_ASSET_REF } from "../../../src/hosts/claude-code/claude-code-statusline-asset.js";
import {
  CLAUDE_CODE_LOCAL_SETTINGS_REF,
  CLAUDE_CODE_STATUSLINE_REMOVAL_OPERATION_ID,
  CLAUDE_CODE_STATUSLINE_REMOVAL_OPERATION_KIND,
  CLAUDE_CODE_STATUSLINE_SETTINGS_BLOCKER,
  claudeCodeStatuslineSettingsRemovalOperationId,
  claudeCodeStatuslineSettingsSurfaceBlocker,
} from "../../../src/hosts/claude-code/claude-code-statusline-settings-operation.js";
import {
  CLAUDE_CODE_TMUX_ASSET_REF,
  WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE,
} from "../../../src/hosts/claude-code/claude-code-tmux-asset.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import type { WakeflowHostMaintenanceOperation } from "../../../src/workspace/maintenance/wakeflow-host-maintenance-contribution.js";
import { withWakeflowMaintenanceGate } from "../../../src/workspace/maintenance/wakeflow-maintenance-gate.js";
import { createMinimalWakeflowConfig } from "../../configuration/wakeflow-config.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

const PROFILES = Object.freeze([
  codexWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostResourceProfile,
]);
const UUID = "11111111-1111-4111-8111-111111111111";

async function fixture(t: TestContext) {
  const absolutePath = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "wakeflow-claude-maintenance-detach-")),
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

/** 先把工作区完整初始化：三份 settings.json、三份 settings.local.json、两份资产与配置都在。 */
async function initializedWorkspace(t: TestContext) {
  const workspace = await fixture(t);
  const desired = desiredConfig();
  const input = Object.freeze({
    action: "fresh-initialize" as const,
    desiredConfig: desired,
    currentHostProfile: claudeCodeWorkspaceHostResourceProfile,
    hostProfiles: PROFILES,
  });
  const completed = await executeClaudeCodeMaintenanceExecution(
    workspace.root,
    await previewClaudeCodeMaintenanceExecution(workspace.root, input),
    input,
    { uuidFactory: () => UUID },
  );
  equal(completed.status, "completed");
  return Object.freeze({ ...workspace, desired });
}

function settingsPath(directory: string): string {
  return path.join(directory, ".claude", "settings.json");
}

function localSettingsPath(directory: string): string {
  return path.join(directory, ...CLAUDE_CODE_LOCAL_SETTINGS_REF.split("/"));
}

function allowOf(file: string): readonly string[] {
  return (JSON.parse(readFileSync(file, "utf8")) as { permissions: { allow: string[] } })
    .permissions.allow;
}

async function coreLayoutDigest(root: RootedDirectory) {
  const plan = await previewClaudeCodeMaintenanceExecution(root, {
    action: "reconcile",
    desiredConfig: null,
    currentHostProfile: claudeCodeWorkspaceHostResourceProfile,
    hostProfiles: PROFILES,
  });
  return plan.sharedPreview.coreLayoutInspectionDigest;
}

test("detach-workspace contributes exactly the two host removal steps per root with the ADR's kinds and target keys, executing them under the gate strips only Wakeflow's entries and touches neither assets nor Config", async (t) => {
  const workspace = await initializedWorkspace(t);
  const [designSurface, testSurface] = workspace.desired.topology.supportSurfaces;
  if (designSurface === undefined || testSurface === undefined) {
    throw new Error("The fixture config declares two support surfaces.");
  }
  // 用户在程序根的 settings.json 里有自己的键与规则：退出后它们必须原样留下。
  const programSettings = settingsPath(workspace.absolutePath);
  writeFileSync(
    programSettings,
    `${JSON.stringify(
      {
        theme: "dark",
        permissions: {
          allow: [
            "Read(./docs/**)",
            WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
            WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE,
          ],
        },
      },
      null,
      2,
    )}\n`,
    { mode: 0o644 },
  );
  const planRequest = (action: "detach-workspace" | "detach-repository") => ({
    action,
    config: workspace.desired,
    profile: claudeCodeWorkspaceHostResourceProfile,
  });
  const contribution = await claudeCodeMaintenanceCapability.planContribution(
    workspace.root,
    planRequest("detach-workspace"),
  );
  equal(contribution.status, "ready");
  deepEqual(contribution.blockerCodes, []);
  deepEqual(
    contribution.operations.map((entry) => [entry.operationKind, entry.targetKey]),
    [
      [CLAUDE_CODE_PORTABLE_SETTINGS_REMOVAL_OPERATION_KIND, "program"],
      [CLAUDE_CODE_PORTABLE_SETTINGS_REMOVAL_OPERATION_KIND, `support:${designSurface.surfaceId}`],
      [CLAUDE_CODE_PORTABLE_SETTINGS_REMOVAL_OPERATION_KIND, `support:${testSurface.surfaceId}`],
      [CLAUDE_CODE_STATUSLINE_REMOVAL_OPERATION_KIND, "statusline"],
      [
        CLAUDE_CODE_STATUSLINE_REMOVAL_OPERATION_KIND,
        `statusline:support:${designSurface.surfaceId}`,
      ],
      [
        CLAUDE_CODE_STATUSLINE_REMOVAL_OPERATION_KIND,
        `statusline:support:${testSurface.surfaceId}`,
      ],
    ],
  );
  deepEqual(
    contribution.operations.map((entry) => entry.operationKind),
    [
      "remove-portable-settings-rules",
      "remove-portable-settings-rules",
      "remove-portable-settings-rules",
      "remove-statusline-entry",
      "remove-statusline-entry",
      "remove-statusline-entry",
    ],
    "operationKind is the shared step kind name, verbatim",
  );
  equal(contribution.operations[3]?.operationId, CLAUDE_CODE_STATUSLINE_REMOVAL_OPERATION_ID);
  equal(
    contribution.operations[4]?.operationId,
    claudeCodeStatuslineSettingsRemovalOperationId(designSurface.surfaceId),
  );
  // 不是写入路径的任何一种操作：资产、投影、规则写入都不在退出路径上。
  equal(
    contribution.operations.some((entry) =>
      ["portable-settings", "statusline-asset", "tmux-asset", "statusline-settings"].includes(
        entry.operationKind,
      ),
    ),
    false,
  );
  equal(JSON.stringify(contribution).includes(workspace.absolutePath), false);

  // detach-repository：Claude 没有仓库维度的宿主文件，贡献是空集。
  const repository = await claudeCodeMaintenanceCapability.planContribution(
    workspace.root,
    planRequest("detach-repository"),
  );
  equal(repository.status, "ready");
  deepEqual([...repository.operations], []);
  deepEqual([...repository.blockerCodes], []);

  // 在维护门内按计划顺序执行六条宿主步：每条都是 updated。
  await withWakeflowMaintenanceGate(
    workspace.root,
    { expectedCoreLayoutInspectionDigest: await coreLayoutDigest(workspace.root) },
    async (context) => {
      for (const operation of contribution.operations) {
        const receipt = await claudeCodeMaintenanceCapability.executeOperation(
          workspace.root,
          context,
          {
            config: workspace.desired,
            profile: claudeCodeWorkspaceHostResourceProfile,
            operation,
            recoveringAffectedOperation: false,
          },
        );
        equal(receipt.operationId, operation.operationId);
        equal(receipt.disposition, "updated");
        equal(receipt.observationDigest, operation.targetDigest);
      }
    },
  );
  // 程序根：用户的键与规则原样，Wakeflow 的两条没了；支撑面：只剩空的 allow；三份本地设置都只剩 `{}`。
  const program = JSON.parse(readFileSync(programSettings, "utf8")) as {
    theme: string;
    permissions: { allow: string[] };
  };
  equal(program.theme, "dark");
  deepEqual(program.permissions.allow, ["Read(./docs/**)"]);
  for (const surface of [designSurface, testSurface]) {
    const surfaceRoot = path.join(workspace.absolutePath, surface.path);
    deepEqual(allowOf(settingsPath(surfaceRoot)), []);
    equal(readFileSync(settingsPath(surfaceRoot), "utf8").includes("wakeflow"), false);
    deepEqual(JSON.parse(readFileSync(localSettingsPath(surfaceRoot), "utf8")), {});
    equal(statSync(localSettingsPath(surfaceRoot)).mode & 0o777, 0o600);
  }
  deepEqual(JSON.parse(readFileSync(localSettingsPath(workspace.absolutePath), "utf8")), {});
  // 不碰的东西还在：两份资产（`.wakeflow-local`）与配置文件。
  for (const ref of [CLAUDE_CODE_STATUSLINE_ASSET_REF, CLAUDE_CODE_TMUX_ASSET_REF]) {
    equal(existsSync(path.join(workspace.absolutePath, ...ref.split("/"))), true, ref);
  }
  equal(existsSync(path.join(workspace.absolutePath, "wakeflow.config.json")), true);

  // 删完再要贡献：没有宿主步了。
  const again = await claudeCodeMaintenanceCapability.planContribution(
    workspace.root,
    planRequest("detach-workspace"),
  );
  equal(again.status, "ready");
  deepEqual([...again.operations], []);
});

test("an unreadable settings.json or settings.local.json blocks the detach contribution with the per-root codes while the readable roots are still planned, and a kind/payload mismatch is refused before any effect", async (t) => {
  const workspace = await initializedWorkspace(t);
  const [designSurface, testSurface] = workspace.desired.topology.supportSurfaces;
  if (designSurface === undefined || testSurface === undefined) {
    throw new Error("The fixture config declares two support surfaces.");
  }
  // 程序根的 settings.json 不是对象；Design 面的 settings.local.json 不是 JSON。
  writeFileSync(settingsPath(workspace.absolutePath), "[]\n", { mode: 0o644 });
  writeFileSync(
    localSettingsPath(path.join(workspace.absolutePath, designSurface.path)),
    "{ no\n",
    {
      mode: 0o600,
    },
  );
  const contribution = await claudeCodeMaintenanceCapability.planContribution(workspace.root, {
    action: "detach-workspace",
    config: workspace.desired,
    profile: claudeCodeWorkspaceHostResourceProfile,
  });
  equal(contribution.status, "blocked");
  deepEqual(
    [...contribution.blockerCodes],
    [
      claudeCodeStatuslineSettingsSurfaceBlocker(designSurface.surfaceId),
      `${CLAUDE_CODE_PORTABLE_SETTINGS_REMOVAL_BLOCKER}:program`,
    ].sort(),
  );
  equal(contribution.blockerCodes.includes(CLAUDE_CODE_STATUSLINE_SETTINGS_BLOCKER), false);
  deepEqual(
    contribution.operations.map((entry) => entry.targetKey),
    [
      `support:${designSurface.surfaceId}`,
      `support:${testSurface.surfaceId}`,
      "statusline",
      `statusline:support:${testSurface.surfaceId}`,
    ],
    "the readable roots are still planned",
  );

  // 种类说是删除、负载却是写入（或反过来）：在任何效果前以 operation 拒绝。
  const designRemoval = contribution.operations.find(
    (entry) => entry.targetKey === `support:${designSurface.surfaceId}`,
  );
  if (designRemoval === undefined) throw new Error("Expected the Design removal.");
  const designFile = settingsPath(path.join(workspace.absolutePath, designSurface.path));
  const before = readFileSync(designFile, "utf8");
  await withWakeflowMaintenanceGate(
    workspace.root,
    { expectedCoreLayoutInspectionDigest: await coreLayoutDigest(workspace.root) },
    async (context) => {
      const forged = [
        { ...designRemoval, operationKind: "portable-settings" },
        {
          ...designRemoval,
          payload: { ...(designRemoval.payload as Record<string, unknown>), action: "update" },
        },
      ] as unknown as readonly WakeflowHostMaintenanceOperation[];
      for (const operation of forged) {
        await rejects(
          claudeCodeMaintenanceCapability.executeOperation(workspace.root, context, {
            config: workspace.desired,
            profile: claudeCodeWorkspaceHostResourceProfile,
            operation,
            recoveringAffectedOperation: false,
          }),
          (error: unknown) =>
            error instanceof Error &&
            error.name === "ClaudeCodeMaintenanceCapabilityError" &&
            (error as { reason?: string }).reason === "operation",
        );
      }
    },
  );
  equal(readFileSync(designFile, "utf8"), before);
});
