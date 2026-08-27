import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  codexWorkspaceHostResourceProfile,
} from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

test("Codex host owns one exact matrix-shaping resource profile", () => {
  deepEqual(codexWorkspaceHostResourceProfile, {
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
  });
  assertDeepFrozen(codexWorkspaceHostResourceProfile);
});
