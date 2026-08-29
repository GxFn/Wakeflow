import { deepEqual, equal } from "node:assert/strict";
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
  compileWakeflowWindowLaunchIntents,
} from "../../../src/workspace/window-runtime/wakeflow-window-launch-intent.js";
import {
  createMinimalWakeflowConfigV3,
} from "../../configuration/wakeflow-config-v3.fixture.js";

test("launch intents resolve Config roots without host handles", () => {
  const config = parseWakeflowConfigV3(createMinimalWakeflowConfigV3());
  const set = compileWakeflowWindowLaunchIntents(
    config,
    codexWorkspaceHostResourceProfile,
  );
  equal(set.intents.length, 4);
  deepEqual(set.intents.map((entry) => entry.windowId), [
    "window_55555555-5555-4555-8555-555555555555",
    "window_66666666-6666-4666-8666-666666666666",
    "window_77777777-7777-4777-8777-777777777777",
    "window_88888888-8888-4888-8888-888888888888",
  ]);
  deepEqual(set.intents.map((entry) => ({
    role: entry.role,
    root: entry.root,
  })), [{
    role: "controller",
    root: {
      kind: "program",
      rootId: "program_11111111-1111-4111-8111-111111111111",
      configuredPlacement: ".",
    },
  }, {
    role: "design",
    root: {
      kind: "support-surface",
      rootId: "surface_33333333-3333-4333-8333-333333333333",
      configuredPlacement: "Design",
    },
  }, {
    role: "test",
    root: {
      kind: "support-surface",
      rootId: "surface_44444444-4444-4444-8444-444444444444",
      configuredPlacement: "Test",
    },
  }, {
    role: "product",
    root: {
      kind: "repository",
      rootId: "repository_22222222-2222-4222-8222-222222222222",
      configuredPlacement: "../ProductA",
    },
  }]);
  equal(set.intents.every((entry) => (
    entry.create.authorization === "not-authorized-by-preview"
    && entry.registration.rawHandleSource === "host-create-result"
    && entry.registration.identityAuthority === "window-host-binding"
    && !Object.hasOwn(entry.registration, "windowId")
    && !Object.hasOwn(entry.registration, "hostId")
  )), true);
  const serialized = JSON.stringify(set);
  equal(
    /"(?:threadId|sessionId|rawHandle|clientThreadId|projectId)":/u.test(
      serialized,
    ),
    false,
  );
});

test("launch intent set binds the current host profile without changing logical windows", () => {
  const config = parseWakeflowConfigV3(createMinimalWakeflowConfigV3());
  const codex = compileWakeflowWindowLaunchIntents(
    config,
    codexWorkspaceHostResourceProfile,
  );
  const claude = compileWakeflowWindowLaunchIntents(
    config,
    claudeCodeWorkspaceHostResourceProfile,
  );
  equal(codex.configDigest, claude.configDigest);
  equal(codex.profileDigest === claude.profileDigest, false);
  equal(codex.launchSetDigest === claude.launchSetDigest, false);
  deepEqual(codex.intents.map((entry) => ({
    windowId: entry.windowId,
    role: entry.role,
    displayTitle: entry.displayTitle,
    root: entry.root,
  })), claude.intents.map((entry) => ({
    windowId: entry.windowId,
    role: entry.role,
    displayTitle: entry.displayTitle,
    root: entry.root,
  })));
  equal(claude.intents.every((entry) => (
    entry.host.hostId === "claude-code"
  )), true);
});
