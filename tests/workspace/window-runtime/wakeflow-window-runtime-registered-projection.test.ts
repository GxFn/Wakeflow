import { equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  codexWindowHostIdentityProfile,
} from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import {
  codexWorkspaceHostResourceProfile,
} from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  claudeCodeWorkspaceHostResourceProfile,
} from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  createWakeflowWindowHostBinding,
} from "../../../src/workspace/window-runtime/wakeflow-window-host-binding.js";
import {
  parseWakeflowWindowHostBindingId,
} from "../../../src/workspace/window-runtime/wakeflow-window-host-binding-id.js";
import {
  createWakeflowWindowHostBindingResourceCatalog,
} from "../../../src/workspace/window-runtime/wakeflow-window-host-binding-resource-catalog.js";
import {
  parseWakeflowWindowHostHandle,
} from "../../../src/workspace/window-runtime/wakeflow-window-host-identity-profile.js";
import {
  compileWakeflowWindowLaunchIntents,
} from "../../../src/workspace/window-runtime/wakeflow-window-launch-intent.js";
import {
  compileWakeflowWindowRuntimeRegisteredProjectionEntry,
  WakeflowWindowRuntimeRegisteredProjectionError,
} from "../../../src/workspace/window-runtime/wakeflow-window-runtime-registered-projection.js";
import {
  compileWakeflowWindowRuntimeUnregisteredProjectionSet,
} from "../../../src/workspace/window-runtime/wakeflow-window-runtime-unregistered-projection.js";
import { createMinimalWakeflowConfigV3 } from "../../configuration/wakeflow-config-v3.fixture.js";

test("registered projection只公开Binding引用与代际ID并保留root blocker", () => {
  const config = createMinimalWakeflowConfigV3();
  const unregisteredSet =
    compileWakeflowWindowRuntimeUnregisteredProjectionSet(
      config,
      codexWorkspaceHostResourceProfile,
    );
  const launchSet = compileWakeflowWindowLaunchIntents(
    config,
    codexWorkspaceHostResourceProfile,
  );
  const source = unregisteredSet.entries[0];
  const launchIntent = launchSet.intents[0];
  if (source === undefined || launchIntent === undefined) {
    throw new Error("Expected one static window.");
  }
  const rawHandle = "private-codex-thread-id";
  const binding = createWakeflowWindowHostBinding(
    {
      programId: source.projection.programId,
      hostId: "codex",
      windowId: source.windowId,
      bindingId: parseWakeflowWindowHostBindingId(
        "window_binding_33333333-3333-4333-8333-333333333333",
      ),
      handle: parseWakeflowWindowHostHandle(
        codexWindowHostIdentityProfile,
        { kind: "codex-thread", value: rawHandle },
      ),
      launchIntentDigest: launchIntent.intentDigest,
      observedAt: parseUtcInstant("2026-08-28T10:00:00.000Z"),
      registeredAt: parseUtcInstant("2026-08-28T10:00:01.000Z"),
    },
    codexWindowHostIdentityProfile,
  );
  const target = compileWakeflowWindowRuntimeRegisteredProjectionEntry(
    codexWorkspaceHostResourceProfile,
    codexWindowHostIdentityProfile,
    source.projection,
    binding,
  );
  equal(target.projection.identity.status, "registered");
  equal(target.projection.identity.bindingId, binding.bindingId);
  equal(target.projection.preflight.status, "blocked");
  equal(
    target.projection.preflight.blockingReasons[0].code,
    "root-unobserved",
  );
  equal(target.document.includes(rawHandle), false);
  equal(target.document.includes('"handle"'), false);
  equal(target.document.includes('"bindingDigest"'), false);
  throws(
    () => compileWakeflowWindowRuntimeRegisteredProjectionEntry(
      claudeCodeWorkspaceHostResourceProfile,
      codexWindowHostIdentityProfile,
      source.projection,
      binding,
    ),
    (error: unknown) => (
      error instanceof WakeflowWindowRuntimeRegisteredProjectionError
      && error.reason === "source"
    ),
  );
  const catalog = createWakeflowWindowHostBindingResourceCatalog(
    config,
    codexWorkspaceHostResourceProfile,
  );
  equal(catalog.length, unregisteredSet.entries.length);
  equal(catalog.every((entry) => (
    entry.ownerId === "window-host-binding"
    && entry.tracking.privacy === "runtime-private"
    && entry.nodePolicy.kind === "file"
    && entry.nodePolicy.mode === "0600"
    && entry.processing.kind === "resource"
    && entry.processing.role === "immutable-fact"
  )), true);
});
