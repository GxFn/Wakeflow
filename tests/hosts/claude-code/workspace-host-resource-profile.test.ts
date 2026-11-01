import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { derivePodId, derivePodWindows } from "../../../src/capabilities/pod/decide.js";
import {
  buildWakeflowConfigIndexes,
  parseWakeflowConfig,
} from "../../../src/configuration/wakeflow-config.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { CLAUDE_CODE_STATUSLINE_ASSET_FILE_NAME } from "../../../src/hosts/claude-code/claude-code-statusline-asset.js";
import {
  CLAUDE_CODE_DESKTOP_ASSET_COMMAND,
  CLAUDE_CODE_DESKTOP_ASSET_FILE_NAME,
  CLAUDE_CODE_DESKTOP_ASSET_REF,
  WAKEFLOW_CLAUDE_CODE_DESKTOP_PERMISSION_RULE,
} from "../../../src/hosts/claude-code/claude-code-desktop-asset.js";
import {
  CLAUDE_CODE_TMUX_ASSET_CONTENT,
  CLAUDE_CODE_TMUX_ASSET_FILE_NAME,
  CLAUDE_CODE_TMUX_ASSET_REF,
} from "../../../src/hosts/claude-code/claude-code-tmux-asset.js";
import {
  CLAUDE_CODE_POD_WINDOW_TITLE_SEPARATOR,
  claudeCodeTmuxSessionNameFor,
  claudeCodeTmuxWindowNameFor,
} from "../../../src/hosts/claude-code/claude-code-window-launch-instructions.js";
import {
  CLAUDE_CODE_DEFAULT_WINDOW_TRANSPORT,
  CLAUDE_CODE_WINDOW_TRANSPORTS,
  claudeCodeDesktopWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostTransportTable,
} from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { selectWakeflowWorkspaceHostResourceProfile } from "../../../src/workspace/host-runtime/wakeflow-host-window-transport.js";
import { wakeflowWorkspaceHostLocatorProvider } from "../../../src/workspace/workspace-host-resource-profile.js";
import { createWakeflowWorkspaceHostResourceCatalog } from "../../../src/workspace/workspace-host-resource-catalog.js";
import { createMinimalWakeflowConfig } from "../../configuration/wakeflow-config.fixture.js";

/**
 * Claude Code 宿主的资源画像与它派生的 tmux 命名规则（0 级，纯函数）：画像的精确形状与资产文件名、
 * worktree pod 的会话名 `<配置名>-<pod 名>`（§13.186）、tmux 窗口名去掉显示名的 `<pod 名> · ` 前缀
 * （§13.186 补充裁决），以及去前缀规则的单一来源——分隔常量同时进 launch 指令与助手资产（open-items W28）。
 */

const PROGRAM_ID = "program_11111111-1111-4111-8111-111111111111";
const REPOSITORY_ID = parseWakeflowDurableIdOfKind(
  "repository_22222222-2222-4222-8222-222222222222",
  "repository",
);

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
      windowLocator: true,
      settingsIntegration: {
        portablePath: ".claude/settings.json",
        localPath: ".claude/settings.local.json",
      },
      statuslineAsset: {
        fileName: "statusline.mjs",
      },
      helperAsset: {
        fileName: "tmux.mjs",
      },
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

test("桌面传输的 profile 与 tmux 共享表面，只换启动模板、助手文件、状态行与换代方式（ADR-0025 D2）", () => {
  deepEqual(claudeCodeDesktopWorkspaceHostResourceProfile, {
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
      windowLocator: true,
      settingsIntegration: {
        portablePath: ".claude/settings.json",
        localPath: ".claude/settings.local.json",
      },
      statuslineAsset: null,
      helperAsset: {
        fileName: CLAUDE_CODE_DESKTOP_ASSET_FILE_NAME,
      },
      runtimeStaleness: "session-start-observer-digest",
      runtimeRefresh: "user-app-restart",
    },
    launch: {
      kind: "desktop-session",
      controllerEffort: "max",
      defaultEffort: "xhigh",
      permissionMode: "auto",
    },
  });
  assertDeepFrozen(claudeCodeDesktopWorkspaceHostResourceProfile);
  equal(
    wakeflowWorkspaceHostLocatorProvider(claudeCodeDesktopWorkspaceHostResourceProfile),
    "desktop",
  );
  equal(wakeflowWorkspaceHostLocatorProvider(claudeCodeWorkspaceHostResourceProfile), "tmux");
  const catalog = createWakeflowWorkspaceHostResourceCatalog(
    claudeCodeDesktopWorkspaceHostResourceProfile,
  );
  const helper = catalog.find(
    (entry) => entry.declarationId === "host-runtime.claude-code.helper-asset",
  );
  equal(helper?.placement.relativePath, CLAUDE_CODE_DESKTOP_ASSET_REF);
  equal(
    catalog.some((entry) => entry.declarationId === "host-runtime.claude-code.statusline-asset"),
    false,
  );
});

test("传输表以 tmux 为缺省，两把键各指向自己的 profile；共享层按配置键选", () => {
  deepEqual(CLAUDE_CODE_WINDOW_TRANSPORTS, ["tmux", "desktop"]);
  equal(CLAUDE_CODE_DEFAULT_WINDOW_TRANSPORT, "tmux");
  equal(
    claudeCodeWorkspaceHostTransportTable.defaultTransport,
    CLAUDE_CODE_DEFAULT_WINDOW_TRANSPORT,
  );
  // 桌面助手的调用前缀与允许规则与 tmux 助手同形：只放行助手本身。
  equal(CLAUDE_CODE_DESKTOP_ASSET_COMMAND, `node ${CLAUDE_CODE_DESKTOP_ASSET_REF}`);
  equal(
    WAKEFLOW_CLAUDE_CODE_DESKTOP_PERMISSION_RULE,
    `Bash(${CLAUDE_CODE_DESKTOP_ASSET_COMMAND} *)`,
  );
  equal(
    claudeCodeWorkspaceHostTransportTable.profiles.tmux,
    claudeCodeWorkspaceHostResourceProfile,
  );
  equal(
    claudeCodeWorkspaceHostTransportTable.profiles.desktop,
    claudeCodeDesktopWorkspaceHostResourceProfile,
  );
  const host = {
    hostId: "claude-code",
    resourceProfile: claudeCodeWorkspaceHostResourceProfile,
    transports: claudeCodeWorkspaceHostTransportTable,
  };
  equal(
    selectWakeflowWorkspaceHostResourceProfile(host, {}),
    claudeCodeWorkspaceHostResourceProfile,
  );
  equal(
    selectWakeflowWorkspaceHostResourceProfile(host, {
      hosts: { "claude-code": { windowTransport: "desktop" } },
    }),
    claudeCodeDesktopWorkspaceHostResourceProfile,
  );
});

test("Profile 的资产文件名与资产模块一致，目录里的 tmux 助手路径就是资产模块的引用", () => {
  const { helperAsset, statuslineAsset } = claudeCodeWorkspaceHostResourceProfile.surfaces;
  equal(helperAsset?.fileName, CLAUDE_CODE_TMUX_ASSET_FILE_NAME);
  equal(statuslineAsset?.fileName, CLAUDE_CODE_STATUSLINE_ASSET_FILE_NAME);
  const catalog = createWakeflowWorkspaceHostResourceCatalog(
    claudeCodeWorkspaceHostResourceProfile,
  );
  const tmux = catalog.find(
    (entry) => entry.declarationId === "host-runtime.claude-code.helper-asset",
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

test("worktree pod 的 tmux 窗口名去掉显示名里的 `<pod> · ` 前缀，显示名本身与 primary pod 的窗口名不变（§13.186）", () => {
  equal(
    claudeCodeTmuxWindowNameFor({
      podPlacement: "worktree",
      podName: "view",
      displayTitle: "view · Controller",
    }),
    "Controller",
  );
  equal(
    claudeCodeTmuxWindowNameFor({
      podPlacement: "worktree",
      podName: "view",
      displayTitle: "AlembicCore",
    }),
    "AlembicCore",
  );
  equal(
    claudeCodeTmuxWindowNameFor({
      podPlacement: "primary",
      podName: "main",
      displayTitle: "main · Controller",
    }),
    "main · Controller",
  );
});

test("去前缀规则只有一处来源：分隔常量既进 launch 指令的渲染也在构建时填进助手资产，且能还原 pod 切片派生的显示名（open-items W28）", () => {
  equal(CLAUDE_CODE_POD_WINDOW_TITLE_SEPARATOR, " · ");
  ok(
    CLAUDE_CODE_TMUX_ASSET_CONTENT.includes(
      `const POD_WINDOW_TITLE_SEPARATOR = ${JSON.stringify(CLAUDE_CODE_POD_WINDOW_TITLE_SEPARATOR)};`,
    ),
    "the helper's mark strips the prefix with the separator the launch instructions use",
  );
  // pod 切片派生的显示名是 `<pod 名> · <模板标题>`；launch 的规则必须恰好还原模板标题。
  const indexes = buildWakeflowConfigIndexes(parseWakeflowConfig(createMinimalWakeflowConfig()));
  const derived = derivePodWindows(
    indexes.primaryPod,
    [REPOSITORY_ID],
    derivePodId(PROGRAM_ID, "key-w28"),
    "feature-x",
    PROGRAM_ID,
  );
  deepEqual(
    derived.map((window) =>
      claudeCodeTmuxWindowNameFor({
        podPlacement: "worktree",
        podName: "feature-x",
        displayTitle: window.displayName,
      }),
    ),
    ["Controller", "Design", "Test", "Product A"],
  );
});
