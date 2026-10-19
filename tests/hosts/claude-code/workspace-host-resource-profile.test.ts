import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { CLAUDE_CODE_STATUSLINE_ASSET_FILE_NAME } from "../../../src/hosts/claude-code/claude-code-statusline-asset.js";
import {
  CLAUDE_CODE_TMUX_ASSET_FILE_NAME,
  CLAUDE_CODE_TMUX_ASSET_REF,
} from "../../../src/hosts/claude-code/claude-code-tmux-asset.js";
import { claudeCodeTmuxSessionNameFor } from "../../../src/hosts/claude-code/claude-code-window-launch-instructions.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { createWakeflowWorkspaceHostResourceCatalog } from "../../../src/workspace/workspace-host-resource-catalog.js";

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

test("Claude Code host owns one exact matrix-shaping resource profile", () => {
  deepEqual(claudeCodeWorkspaceHostResourceProfile, {
    kind: "WakeflowWorkspaceHostResourceProfile",
    hostId: "claude-code",
    runtimeDirectoryName: "claude-code",
    instructionFileName: "CLAUDE.md",
    surfaces: {
      windowIdentity: true,
      podReceipts: true,
      worktree: {
        launch: "claude-worktree-flag",
        attachedDirectories: "add-dir-flag",
      },
      keepLive: true,
      windowLocator: true,
      settingsIntegration: {
        portablePath: ".claude/settings.json",
        localPath: ".claude/settings.local.json",
      },
      statuslineAsset: {
        fileName: "statusline.mjs",
      },
      tmuxAsset: {
        fileName: "tmux.mjs",
      },
      activityMonitor: true,
      temporaryPrompts: true,
      runtimeStaleness: "session-start-observer-digest",
      runtimeRefresh: "controller-in-place",
    },
    launch: {
      kind: "tmux-session",
      controllerEffort: "max",
      defaultEffort: "xhigh",
      permissionMode: "auto",
      sessionName: "wakeflow",
    },
  });
  assertDeepFrozen(claudeCodeWorkspaceHostResourceProfile);
});

test("Profile 的资产文件名与资产模块一致，目录里的 tmux 助手路径就是资产模块的引用", () => {
  const { tmuxAsset, statuslineAsset } = claudeCodeWorkspaceHostResourceProfile.surfaces;
  equal(tmuxAsset?.fileName, CLAUDE_CODE_TMUX_ASSET_FILE_NAME);
  equal(statuslineAsset?.fileName, CLAUDE_CODE_STATUSLINE_ASSET_FILE_NAME);
  const catalog = createWakeflowWorkspaceHostResourceCatalog(
    claudeCodeWorkspaceHostResourceProfile,
  );
  const tmux = catalog.find(
    (entry) => entry.declarationId === "host-runtime.claude-code.tmux-asset",
  );
  equal(tmux?.placement.relativePath, CLAUDE_CODE_TMUX_ASSET_REF);
});

test("每个 worktree pod 的窗口开在自己的 tmux 会话里：`<配置名>-<pod 名>`，primary pod 用配置名，超长时截断配置名那一段（§13.186）", () => {
  equal(
    claudeCodeTmuxSessionNameFor("wakeflow", { podPlacement: "primary", podName: "main" }),
    "wakeflow",
  );
  equal(
    claudeCodeTmuxSessionNameFor("wakeflow", { podPlacement: "worktree", podName: "live" }),
    "wakeflow-live",
  );
  equal(
    claudeCodeTmuxSessionNameFor("team a", { podPlacement: "worktree", podName: "fix-1" }),
    "team a-fix-1",
  );
  const long = "w".repeat(128);
  const named = claudeCodeTmuxSessionNameFor(long, {
    podPlacement: "worktree",
    podName: "pod-with-a-long-name",
  });
  equal(named.length, 128);
  equal(named.endsWith("-pod-with-a-long-name"), true);
  equal(claudeCodeTmuxSessionNameFor(long, { podPlacement: "primary", podName: "main" }), long);
});
