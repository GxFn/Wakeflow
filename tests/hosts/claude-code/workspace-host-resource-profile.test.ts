import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  claudeCodeWorkspaceHostResourceProfile,
} from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { CLAUDE_CODE_STATUSLINE_ASSET_FILE_NAME } from "../../../src/hosts/claude-code/claude-code-statusline-asset.js";
import {
  CLAUDE_CODE_TMUX_ASSET_FILE_NAME,
  CLAUDE_CODE_TMUX_ASSET_REF,
} from "../../../src/hosts/claude-code/claude-code-tmux-asset.js";
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
    },
    launch: {
      kind: "tmux-session",
      controllerEffort: "max",
      defaultEffort: "xhigh",
      permissionMode: "acceptEdits",
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
  const tmux = catalog.find((entry) => entry.declarationId === "host-runtime.claude-code.tmux-asset");
  equal(tmux?.placement.relativePath, CLAUDE_CODE_TMUX_ASSET_REF);
});
