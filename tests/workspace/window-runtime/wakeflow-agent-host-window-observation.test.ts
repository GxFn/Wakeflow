import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  compileWakeflowAgentHostWindowObservationAuthority,
  WakeflowAgentHostWindowObservationAuthorityError,
} from "../../../src/workspace/window-runtime/wakeflow-agent-host-window-observation-authority.js";
import {
  parseWakeflowAgentHostWindowObservation,
  WakeflowAgentHostWindowObservationError,
} from "../../../src/workspace/window-runtime/wakeflow-agent-host-window-observation.js";
import { createWakeflowWindowHostBinding } from "../../../src/workspace/window-runtime/wakeflow-window-host-binding.js";
import { parseWakeflowWindowHostBindingId } from "../../../src/workspace/window-runtime/wakeflow-window-host-binding-id.js";
import { parseWakeflowWindowHostHandle } from "../../../src/workspace/window-runtime/wakeflow-window-host-identity-profile.js";
import { compileWakeflowWindowLaunchIntents } from "../../../src/workspace/window-runtime/wakeflow-window-launch-intent.js";
import { compileWakeflowWindowRuntimeDesiredTopology } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-desired-topology.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { createMinimalWakeflowConfigV3 } from "../../configuration/wakeflow-config-v3.fixture.js";

const RAW_HANDLE = "codex-host-owned-thread:opaque-delivery-target";
const OTHER_HANDLE = "codex-host-owned-thread:opaque-other-target";
const BINDING_ID = parseWakeflowWindowHostBindingId(
  "window_binding_99999999-9999-4999-8999-999999999999",
);
const OTHER_BINDING_ID = parseWakeflowWindowHostBindingId(
  "window_binding_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const CREATED_AT = parseUtcInstant("2026-08-29T10:00:00.000Z");
const REGISTERED_AT = parseUtcInstant("2026-08-29T10:00:01.000Z");
const OBSERVED_AT = parseUtcInstant("2026-08-29T09:59:59.000Z");

function fixture() {
  const config = parseWakeflowConfigV3(createMinimalWakeflowConfigV3());
  const launchSet = compileWakeflowWindowLaunchIntents(
    config,
    codexWorkspaceHostResourceProfile,
  );
  const topology = compileWakeflowWindowRuntimeDesiredTopology(
    config,
    codexWorkspaceHostResourceProfile,
  );
  const launchIntent = launchSet.intents.find(
    (entry) => entry.role === "product",
  );
  const desiredWindow = topology.windows.find(
    (entry) => entry.role === "product",
  );
  if (launchIntent === undefined || desiredWindow === undefined) {
    throw new Error("Expected one product window fixture.");
  }
  const handle = parseWakeflowWindowHostHandle(codexWindowHostIdentityProfile, {
    kind: "codex-thread",
    value: RAW_HANDLE,
  });
  const binding = createWakeflowWindowHostBinding(
    {
      programId: config.program.programId,
      hostId: "codex",
      windowId: desiredWindow.windowId,
      bindingId: BINDING_ID,
      handle,
      launchIntentDigest: launchIntent.intentDigest,
      observedAt: CREATED_AT,
      registeredAt: REGISTERED_AT,
    },
    codexWindowHostIdentityProfile,
  );
  const observationValue = {
    kind: "WakeflowAgentHostWindowObservation",
    schemaVersion: 1,
    source: "agent-host-inspection-result",
    hostId: "codex",
    windowId: desiredWindow.windowId,
    bindingId: BINDING_ID,
    handle: { kind: "codex-thread", value: RAW_HANDLE },
    attestedRoot: {
      status: "matches-configured-root",
      logicalRoot: desiredWindow.logicalRoot,
      configuredPlacement: desiredWindow.configuredPlacement,
    },
    observedAt: OBSERVED_AT,
  } as const;
  return { binding, config, desiredWindow, observationValue };
}

test("Agent Host Window observation 只准入当前宿主的被动瞬时声明", () => {
  const { desiredWindow, observationValue } = fixture();
  const observation = parseWakeflowAgentHostWindowObservation(
    codexWindowHostIdentityProfile,
    observationValue,
  );
  deepEqual(observation.attestedRoot, {
    status: "matches-configured-root",
    logicalRoot: desiredWindow.logicalRoot,
    configuredPlacement: desiredWindow.configuredPlacement,
  });
  equal(observation.handle.value, RAW_HANDLE);
  equal(Object.isFrozen(observation), true);
  equal(Object.isFrozen(observation.attestedRoot), true);
  equal(Object.isFrozen(observation.handle), true);

  throws(
    () =>
      parseWakeflowAgentHostWindowObservation(codexWindowHostIdentityProfile, {
        ...observationValue,
        extra: true,
      }),
    (error: unknown) =>
      error instanceof WakeflowAgentHostWindowObservationError &&
      error.reason === "schema",
  );
  const accessor = { ...observationValue } as Record<string, unknown>;
  Object.defineProperty(accessor, "observedAt", {
    enumerable: true,
    get: () => OBSERVED_AT,
  });
  throws(
    () =>
      parseWakeflowAgentHostWindowObservation(
        codexWindowHostIdentityProfile,
        accessor,
      ),
    (error: unknown) =>
      error instanceof WakeflowAgentHostWindowObservationError &&
      error.reason === "input",
  );
});

test("Observation authority 精确闭合 Binding 与当前逻辑根且删除 raw handle", () => {
  const { binding, config, observationValue } = fixture();
  const observation = parseWakeflowAgentHostWindowObservation(
    codexWindowHostIdentityProfile,
    observationValue,
  );
  const authority = compileWakeflowAgentHostWindowObservationAuthority({
    config,
    resourceProfile: codexWorkspaceHostResourceProfile,
    identityProfile: codexWindowHostIdentityProfile,
    binding,
    observation,
  });
  equal(authority.binding.bindingId, BINDING_ID);
  equal(authority.rootAttestation.observedAt, OBSERVED_AT);
  equal(
    authority.rootAttestation.observedAt < authority.binding.registeredAt,
    true,
  );
  equal(authority.authorityDigest.startsWith("sha256:"), true);
  equal(
    authority.authorityDigest,
    compileWakeflowAgentHostWindowObservationAuthority({
      config,
      resourceProfile: codexWorkspaceHostResourceProfile,
      identityProfile: codexWindowHostIdentityProfile,
      binding,
      observation,
    }).authorityDigest,
  );
  const encoded = JSON.stringify(authority);
  equal(encoded.includes(RAW_HANDLE), false);
  equal(encoded.includes('"handle"'), false);
});

test("Observation authority 拒绝错误代际、候选handle和根声明", () => {
  const { binding, config, observationValue } = fixture();
  const cases = [
    {
      reason: "binding",
      value: {
        ...observationValue,
        bindingId: OTHER_BINDING_ID,
      },
    },
    {
      reason: "binding",
      value: {
        ...observationValue,
        handle: { kind: "codex-thread", value: OTHER_HANDLE },
      },
    },
    {
      reason: "config",
      value: {
        ...observationValue,
        attestedRoot: {
          ...observationValue.attestedRoot,
          configuredPlacement: "DifferentProduct",
        },
      },
    },
  ] as const;
  for (const candidate of cases) {
    const observation = parseWakeflowAgentHostWindowObservation(
      codexWindowHostIdentityProfile,
      candidate.value,
    );
    throws(
      () =>
        compileWakeflowAgentHostWindowObservationAuthority({
          config,
          resourceProfile: codexWorkspaceHostResourceProfile,
          identityProfile: codexWindowHostIdentityProfile,
          binding,
          observation,
        }),
      (error: unknown) =>
        error instanceof WakeflowAgentHostWindowObservationAuthorityError &&
        error.reason === candidate.reason &&
        !error.message.includes(RAW_HANDLE) &&
        !error.message.includes(OTHER_HANDLE),
    );
  }
});

test("Observation authority 只因根拓扑变化失效，不把显示文本当作 Binding 身份", () => {
  const { binding, observationValue } = fixture();
  const changed = createMinimalWakeflowConfigV3();
  const topology = changed.topology as {
    repositories: Array<Record<string, unknown>>;
    windows: Array<Record<string, unknown>>;
  };
  const product = topology.windows.find((entry) => entry.role === "product");
  if (product === undefined) throw new Error("Expected one product window.");
  product.displayName = "Changed Product Window";
  const observation = parseWakeflowAgentHostWindowObservation(
    codexWindowHostIdentityProfile,
    observationValue,
  );
  const displayChangedConfig = parseWakeflowConfigV3(changed);
  const stillCurrent = compileWakeflowAgentHostWindowObservationAuthority({
    config: displayChangedConfig,
    resourceProfile: codexWorkspaceHostResourceProfile,
    identityProfile: codexWindowHostIdentityProfile,
    binding,
    observation,
  });
  equal(
    stillCurrent.binding.launchIntentDigest,
    binding.source.launchIntentDigest,
  );

  const repository = topology.repositories[0];
  if (repository === undefined) throw new Error("Expected one repository.");
  repository.path = "../MovedProduct";
  const rootChangedConfig = parseWakeflowConfigV3(changed);
  throws(
    () =>
      compileWakeflowAgentHostWindowObservationAuthority({
        config: rootChangedConfig,
        resourceProfile: codexWorkspaceHostResourceProfile,
        identityProfile: codexWindowHostIdentityProfile,
        binding,
        observation,
      }),
    (error: unknown) =>
      error instanceof WakeflowAgentHostWindowObservationAuthorityError &&
      error.reason === "config",
  );
});
