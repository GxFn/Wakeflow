import { equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  configuredWakeflowWorkspaceHostTransport,
  selectWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostTransportError,
} from "../../../src/workspace/host-runtime/wakeflow-host-window-transport.js";
import { parseWakeflowWorkspaceHostResourceProfile } from "../../../src/workspace/workspace-host-resource-profile.js";

/** 级别：pure——窗口传输的 profile 选择只按配置键索引宿主提供的表（ADR-0025 D1）。 */

const tmux = parseWakeflowWorkspaceHostResourceProfile({
  kind: "WakeflowWorkspaceHostResourceProfile",
  hostId: "claude-code",
  runtimeDirectoryName: "claude-code",
  instructionFileName: "CLAUDE.md",
  surfaces: {
    windowIdentity: true,
    podReceipts: true,
    worktree: { launch: "claude-worktree-flag", attachedDirectories: "add-dir-flag" },
    windowLocator: true,
    settingsIntegration: {
      portablePath: ".claude/settings.json",
      localPath: ".claude/settings.local.json",
    },
    statuslineAsset: { fileName: "statusline.mjs" },
    helperAsset: { fileName: "tmux.mjs" },
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

const desktop = parseWakeflowWorkspaceHostResourceProfile({
  kind: "WakeflowWorkspaceHostResourceProfile",
  hostId: "claude-code",
  runtimeDirectoryName: "claude-code",
  instructionFileName: "CLAUDE.md",
  surfaces: {
    windowIdentity: true,
    podReceipts: true,
    worktree: { launch: "claude-worktree-flag", attachedDirectories: "add-dir-flag" },
    windowLocator: true,
    settingsIntegration: {
      portablePath: ".claude/settings.json",
      localPath: ".claude/settings.local.json",
    },
    statuslineAsset: null,
    helperAsset: { fileName: "desktop.mjs" },
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

const host = Object.freeze({
  hostId: "claude-code",
  resourceProfile: tmux,
  transports: Object.freeze({
    defaultTransport: "tmux",
    profiles: Object.freeze({ tmux, desktop }),
  }),
});

test("配置未声明 windowTransport 时选宿主的缺省传输；声明了就按键选", () => {
  equal(configuredWakeflowWorkspaceHostTransport(host, {}), "tmux");
  equal(selectWakeflowWorkspaceHostResourceProfile(host, {}), tmux);
  equal(selectWakeflowWorkspaceHostResourceProfile(host, { hosts: {} }), tmux);
  equal(selectWakeflowWorkspaceHostResourceProfile(host, { hosts: { "claude-code": {} } }), tmux);
  equal(
    selectWakeflowWorkspaceHostResourceProfile(host, {
      hosts: { "claude-code": { windowTransport: "desktop" } },
    }),
    desktop,
  );
  equal(
    configuredWakeflowWorkspaceHostTransport(host, {
      hosts: { "claude-code": { windowTransport: "desktop" } },
    }),
    "desktop",
  );
});

test("别的宿主的 windowTransport 不影响本宿主；配置里不是对象或不是字符串的值视为未声明", () => {
  equal(
    selectWakeflowWorkspaceHostResourceProfile(host, {
      hosts: { codex: { windowTransport: "desktop" } },
    }),
    tmux,
  );
  equal(selectWakeflowWorkspaceHostResourceProfile(host, { hosts: "nope" }), tmux);
  equal(
    selectWakeflowWorkspaceHostResourceProfile(host, {
      hosts: { "claude-code": { windowTransport: 7 } },
    }),
    tmux,
  );
});

test("没有传输表的宿主原样返回它唯一的 profile，配置值不被读取", () => {
  const single = Object.freeze({ hostId: "codex", resourceProfile: desktop });
  equal(
    configuredWakeflowWorkspaceHostTransport(single, {
      hosts: { codex: { windowTransport: "x" } },
    }),
    null,
  );
  equal(
    selectWakeflowWorkspaceHostResourceProfile(single, {
      hosts: { codex: { windowTransport: "x" } },
    }),
    desktop,
  );
});

test("表里没有的传输键是合同违背：抛出带键名的稳定错误", () => {
  throws(
    () =>
      selectWakeflowWorkspaceHostResourceProfile(host, {
        hosts: { "claude-code": { windowTransport: "screen" } },
      }),
    (error: unknown) =>
      error instanceof WakeflowWorkspaceHostTransportError &&
      error.code === "wakeflow-workspace-host-transport" &&
      error.reason === "unknown-transport" &&
      error.transport === "screen",
  );
});
