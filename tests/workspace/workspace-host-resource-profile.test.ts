import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  parseWakeflowWorkspaceHostResourceProfile,
  WAKEFLOW_WORKSPACE_HOST_RESOURCE_SURFACE_NAMES,
  WakeflowWorkspaceHostResourceProfileError,
  type WakeflowWorkspaceHostResourceProfileErrorReason,
} from "../../src/workspace/workspace-host-resource-profile.js";

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function expectHostResourceProfileError(
  action: () => unknown,
  reason: WakeflowWorkspaceHostResourceProfileErrorReason,
  path: string,
): WakeflowWorkspaceHostResourceProfileError {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof WakeflowWorkspaceHostResourceProfileError)) {
    throw new Error("Expected WakeflowWorkspaceHostResourceProfileError.");
  }
  equal(caught.code, "wakeflow-workspace-host-resource-profile");
  equal(caught.reason, reason);
  equal(caught.path, path);
  return caught;
}

function codexProfile(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    kind: "WakeflowWorkspaceHostResourceProfile",
    hostId: "codex",
    runtimeDirectoryName: "codex",
    instructionFileName: "AGENTS.md",
    surfaces: {
      windowIdentity: true,
      podEvidence: true,
      keepLive: true,
      windowLocator: false,
      settingsIntegration: null,
      statuslineAsset: null,
      activityMonitor: false,
      temporaryPrompts: false,
    },
    ...overrides,
  };
}

test("host resource profile keeps only matrix-shaping static surfaces", () => {
  deepEqual(WAKEFLOW_WORKSPACE_HOST_RESOURCE_SURFACE_NAMES, [
    "windowIdentity",
    "podEvidence",
    "keepLive",
    "windowLocator",
    "settingsIntegration",
    "statuslineAsset",
    "activityMonitor",
    "temporaryPrompts",
  ]);

  const codexInput = {
    kind: "WakeflowWorkspaceHostResourceProfile",
    hostId: "codex",
    runtimeDirectoryName: "codex",
    instructionFileName: "AGENTS.md",
    surfaces: {
      windowIdentity: true,
      podEvidence: true,
      keepLive: true,
      windowLocator: false,
      settingsIntegration: null,
      statuslineAsset: null,
      activityMonitor: false,
      temporaryPrompts: false,
    },
  };
  const codex = parseWakeflowWorkspaceHostResourceProfile(codexInput);
  deepEqual(codex, codexInput);
  assertDeepFrozen(codex);

  codexInput.runtimeDirectoryName = "changed";
  codexInput.surfaces.windowIdentity = false;
  equal(codex.runtimeDirectoryName, "codex");
  equal(codex.surfaces.windowIdentity, true);

  const claudeInput = {
    kind: "WakeflowWorkspaceHostResourceProfile",
    hostId: "claude-code",
    runtimeDirectoryName: "claude-code",
    instructionFileName: "CLAUDE.md",
    surfaces: {
      windowIdentity: true,
      podEvidence: true,
      keepLive: true,
      windowLocator: true,
      settingsIntegration: {
        portablePath: ".claude/settings.json",
        localPath: ".claude/settings.local.json",
      },
      statuslineAsset: {
        fileName: "statusline.mjs",
      },
      activityMonitor: true,
      temporaryPrompts: true,
    },
  };
  const claude = parseWakeflowWorkspaceHostResourceProfile(claudeInput);
  deepEqual(claude, claudeInput);
  assertDeepFrozen(claude);

  const settings = claudeInput.surfaces.settingsIntegration;
  const statusline = claudeInput.surfaces.statuslineAsset;
  if (settings !== null) settings.portablePath = "changed/settings.json";
  if (statusline !== null) statusline.fileName = "changed.mjs";
  deepEqual(claude.surfaces.settingsIntegration, {
    portablePath: ".claude/settings.json",
    localPath: ".claude/settings.local.json",
  });
  deepEqual(claude.surfaces.statuslineAsset, {
    fileName: "statusline.mjs",
  });
});

test("host resource profile rejects open or behavioral data and unsafe paths", () => {
  expectHostResourceProfileError(
    () => parseWakeflowWorkspaceHostResourceProfile(codexProfile({
      realization: "current",
    })),
    "shape",
    "$/realization",
  );
  expectHostResourceProfileError(
    () => parseWakeflowWorkspaceHostResourceProfile(codexProfile({
      surfaces: {
        windowIdentity: true,
        podEvidence: true,
        keepLive: true,
        windowLocator: false,
        settingsIntegration: null,
        statuslineAsset: null,
        activityMonitor: false,
        temporaryPrompts: false,
        close: true,
      },
    })),
    "shape",
    "$/surfaces/close",
  );
  expectHostResourceProfileError(
    () => parseWakeflowWorkspaceHostResourceProfile(codexProfile({
      instructionFileName: "nested/AGENTS.md",
    })),
    "component",
    "$/instructionFileName",
  );
  expectHostResourceProfileError(
    () => parseWakeflowWorkspaceHostResourceProfile(codexProfile({
      runtimeDirectoryName: "../codex",
    })),
    "component",
    "$/runtimeDirectoryName",
  );
  expectHostResourceProfileError(
    () => parseWakeflowWorkspaceHostResourceProfile(codexProfile({
      surfaces: {
        windowIdentity: true,
        podEvidence: true,
        keepLive: true,
        windowLocator: true,
        settingsIntegration: {
          portablePath: "../settings.json",
          localPath: ".host/settings.local.json",
        },
        statuslineAsset: null,
        activityMonitor: false,
        temporaryPrompts: false,
      },
    })),
    "path",
    "$/surfaces/settingsIntegration/portablePath",
  );
  expectHostResourceProfileError(
    () => parseWakeflowWorkspaceHostResourceProfile(codexProfile({
      surfaces: {
        windowIdentity: true,
        podEvidence: true,
        keepLive: true,
        windowLocator: true,
        settingsIntegration: {
          portablePath: ".host/settings.json",
          localPath: ".host/settings.local.json",
          realization: "current",
        },
        statuslineAsset: null,
        activityMonitor: false,
        temporaryPrompts: false,
      },
    })),
    "shape",
    "$/surfaces/settingsIntegration/realization",
  );
  expectHostResourceProfileError(
    () => parseWakeflowWorkspaceHostResourceProfile(codexProfile({
      surfaces: {
        windowIdentity: true,
        podEvidence: true,
        keepLive: true,
        windowLocator: true,
        settingsIntegration: {
          portablePath: ".host/settings.json",
          localPath: ".host/settings.local.json",
        },
        statuslineAsset: {
          fileName: "statusline.mjs",
          executable: true,
        },
        activityMonitor: false,
        temporaryPrompts: false,
      },
    })),
    "shape",
    "$/surfaces/statuslineAsset/executable",
  );

  let trapCalls = 0;
  const proxy = new Proxy(codexProfile(), {
    get: () => {
      trapCalls += 1;
      return undefined;
    },
    getOwnPropertyDescriptor: () => {
      trapCalls += 1;
      return undefined;
    },
    getPrototypeOf: () => {
      trapCalls += 1;
      return Object.prototype;
    },
    ownKeys: () => {
      trapCalls += 1;
      return [];
    },
  });
  expectHostResourceProfileError(
    () => parseWakeflowWorkspaceHostResourceProfile(proxy),
    "input",
    "$",
  );
  equal(trapCalls, 0);
});

test("host resource profile closes relations without encoding host capability branches", () => {
  expectHostResourceProfileError(
    () => parseWakeflowWorkspaceHostResourceProfile(codexProfile({
      runtimeDirectoryName: "claude-code",
    })),
    "contradiction",
    "$/runtimeDirectoryName",
  );
  expectHostResourceProfileError(
    () => parseWakeflowWorkspaceHostResourceProfile(codexProfile({
      surfaces: {
        windowIdentity: true,
        podEvidence: true,
        keepLive: true,
        windowLocator: true,
        settingsIntegration: {
          portablePath: ".host/settings.json",
          localPath: ".host/settings.json",
        },
        statuslineAsset: null,
        activityMonitor: false,
        temporaryPrompts: false,
      },
    })),
    "contradiction",
    "$/surfaces/settingsIntegration/localPath",
  );
  expectHostResourceProfileError(
    () => parseWakeflowWorkspaceHostResourceProfile(codexProfile({
      surfaces: {
        windowIdentity: true,
        podEvidence: true,
        keepLive: true,
        windowLocator: false,
        settingsIntegration: null,
        statuslineAsset: {
          fileName: "statusline.mjs",
        },
        activityMonitor: false,
        temporaryPrompts: false,
      },
    })),
    "contradiction",
    "$/surfaces/statuslineAsset",
  );

  const capabilityIndependentCodex =
    parseWakeflowWorkspaceHostResourceProfile(codexProfile({
      surfaces: {
        windowIdentity: false,
        podEvidence: false,
        keepLive: false,
        windowLocator: true,
        settingsIntegration: {
          portablePath: ".codex/settings.json",
          localPath: ".codex/settings.local.json",
        },
        statuslineAsset: {
          fileName: "statusline.mjs",
        },
        activityMonitor: true,
        temporaryPrompts: true,
      },
    }));
  equal(capabilityIndependentCodex.hostId, "codex");
  equal(capabilityIndependentCodex.surfaces.windowIdentity, false);
  equal(capabilityIndependentCodex.surfaces.windowLocator, true);
  equal(capabilityIndependentCodex.surfaces.activityMonitor, true);
  equal(capabilityIndependentCodex.surfaces.temporaryPrompts, true);
  deepEqual(capabilityIndependentCodex.surfaces.settingsIntegration, {
    portablePath: ".codex/settings.json",
    localPath: ".codex/settings.local.json",
  });
});
