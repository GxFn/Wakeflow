import { deepEqual, equal, notEqual } from "node:assert/strict";
import { test } from "node:test";

import {
  parseWakeflowConfigV3,
} from "../../../src/configuration/wakeflow-config-v3.js";
import {
  claudeCodeWorkspaceHostResourceProfile,
} from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import {
  codexWorkspaceHostResourceProfile,
} from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  compileWakeflowWindowRuntimeDesiredTopology,
} from "../../../src/workspace/window-runtime/wakeflow-window-runtime-desired-topology.js";
import {
  createMinimalWakeflowConfigV3,
} from "../../configuration/wakeflow-config-v3.fixture.js";

function config() {
  return parseWakeflowConfigV3(createMinimalWakeflowConfigV3());
}

test("Window Runtime desired topology compiles only stable logical facts", () => {
  const topology = compileWakeflowWindowRuntimeDesiredTopology(
    config(),
    codexWorkspaceHostResourceProfile,
  );
  equal(topology.kind, "WakeflowWindowRuntimeDesiredTopology");
  equal(topology.hostId, "codex");
  equal(topology.windows.length, 4);
  deepEqual(topology.windows.map((entry) => entry.role), [
    "controller",
    "design",
    "test",
    "product",
  ]);
  deepEqual(topology.windows.map((entry) => entry.configuredPlacement), [
    ".",
    "Design",
    "Test",
    "../ProductA",
  ]);
  deepEqual(topology.windows.map((entry) => entry.logicalRoot.kind), [
    "program",
    "support-surface",
    "support-surface",
    "repository",
  ]);
  equal(Object.isFrozen(topology), true);
  equal(Object.isFrozen(topology.windows), true);
  equal(topology.windows.every((entry) => Object.isFrozen(entry)), true);
  equal("displayName" in topology.windows[0]!, false);
  equal("dispatchEligibility" in topology.windows[0]!, false);
  equal("identity" in topology.windows[0]!, false);
  equal("absolutePath" in topology.windows[0]!, false);
});

test("desired topology ignores presentation and display text but tracks placement and host", () => {
  const baselineValue = createMinimalWakeflowConfigV3();
  const baseline = compileWakeflowWindowRuntimeDesiredTopology(
    baselineValue,
    codexWorkspaceHostResourceProfile,
  );

  const presentationChanged = createMinimalWakeflowConfigV3();
  (presentationChanged.presentation as Record<string, unknown>).language =
    "zh-Hans";
  const windows = (presentationChanged.topology as {
    windows: Record<string, unknown>[];
  }).windows;
  const designWindow = windows[1];
  if (designWindow === undefined) throw new Error("Expected Design window.");
  designWindow.displayName = "设计窗口";
  const textChanged = compileWakeflowWindowRuntimeDesiredTopology(
    presentationChanged,
    codexWorkspaceHostResourceProfile,
  );
  equal(textChanged.desiredTopologyDigest, baseline.desiredTopologyDigest);

  const placementChanged = createMinimalWakeflowConfigV3();
  const surfaces = (placementChanged.topology as {
    supportSurfaces: Record<string, unknown>[];
  }).supportSurfaces;
  const designSurface = surfaces[0];
  if (designSurface === undefined) throw new Error("Expected Design surface.");
  designSurface.path = "DesignMoved";
  const moved = compileWakeflowWindowRuntimeDesiredTopology(
    placementChanged,
    codexWorkspaceHostResourceProfile,
  );
  notEqual(moved.desiredTopologyDigest, baseline.desiredTopologyDigest);

  const claude = compileWakeflowWindowRuntimeDesiredTopology(
    baselineValue,
    claudeCodeWorkspaceHostResourceProfile,
  );
  notEqual(claude.desiredTopologyDigest, baseline.desiredTopologyDigest);
  equal(claude.hostId, "claude-code");
});
