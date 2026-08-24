import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function assertDeepFrozen(value) {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function settingsAdapterProfile(sourceProfile, settingsAssetsHostFile) {
  return {
    hostId: sourceProfile.hostId,
    memoryFile: sourceProfile.memoryFile,
    runtime: { hostDirName: sourceProfile.runtime.hostDirName },
    capabilities: structuredClone(sourceProfile.capabilities),
    artifact: { settingsAssetsHostFile },
  };
}

test("core-dev, Codex, and Claude profiles satisfy one strict capability contract", async () => {
  const {
    HOST_CAPABILITY_NAMES,
    HOST_CAPABILITY_REALIZATIONS,
    normalizeWakeflowHostCapabilityProfile,
  } = await import("../core/scripts/lib/wakeflow-host-capability.mjs");
  assert.deepEqual(HOST_CAPABILITY_REALIZATIONS, [
    "current",
    "runtime-probed",
    "manual-gate",
    "not-applicable",
  ]);
  const profiles = await Promise.all([
    import("../core/scripts/lib/wakeflow-host-profile.mjs").then((module) => module.hostProfile),
    import("../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs").then((module) => module.hostProfile),
    import("../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs").then((module) => module.hostProfile),
  ]);
  for (const profile of profiles) {
    assertDeepFrozen(profile);
    const normalized = normalizeWakeflowHostCapabilityProfile(profile);
    assert.deepEqual(Object.keys(normalized.capabilities), HOST_CAPABILITY_NAMES);
    assert.equal(normalized.hostId, profile.hostId);
    assert.equal(normalized.memoryFile, profile.memoryFile);
    assert.equal(Object.isFrozen(normalized), true);
    assert.equal(Object.isFrozen(normalized.capabilities), true);
    assert.equal(Object.isFrozen(normalized.capabilities.settings.paths), true);
    for (const capability of Object.values(normalized.capabilities)) {
      assert.equal("enabled" in capability, false);
      assert.equal("live" in capability, false);
      assert.equal("available" in capability, false);
      assert.equal(typeof capability.applicable, "boolean");
      assert.equal(typeof capability.realization, "string");
    }
  }
  for (const profile of profiles) {
    assert.equal(profile.pod?.entryExtras, undefined, "Pod physical realization stays in its host owner");
    assert.deepEqual(Object.keys(profile.runtime), ["hostDirName"]);
    assert.deepEqual(Object.keys(profile.hostTools), ["createWindow"]);
    assert.deepEqual(Object.keys(profile.handleId).sort(), ["idShape", "kind", "placeholders"]);
    for (const retired of [
      "decisionOwner",
      "memoryFileLabel",
      "pluginManifestDir",
      "closedLoopContractName",
      "workspaceResidueChecks",
    ]) assert.equal(Object.hasOwn(profile, retired), false, `${profile.hostId}.${retired} has no current consumer`);
    assert.equal(Object.hasOwn(profile.artifact, "marketplacePath"), false);
  }
});

test("settings/assets adapter loading is exact, frozen, and no-follow", async (t) => {
  const { loadWakeflowHostSettingsAssetsAdapter } = await import(
    "../core/scripts/lib/wakeflow-host-settings-assets-owner.mjs"
  );
  const sourceProfile = (await import(
    "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs"
  )).hostProfile;
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-host-adapter-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));

  const makeArtifact = (name, source, { link = false } = {}) => {
    const artifactRoot = path.join(base, name);
    const moduleDirectory = path.join(artifactRoot, "scripts/lib");
    mkdirSync(moduleDirectory, { recursive: true });
    const relative = `scripts/lib/${name}.mjs`;
    const moduleFile = path.join(artifactRoot, relative);
    if (link) {
      const external = path.join(base, `${name}-external.mjs`);
      writeFileSync(external, source);
      symlinkSync(external, moduleFile);
    } else {
      writeFileSync(moduleFile, source);
    }
    return {
      artifactRoot,
      hostProfile: settingsAdapterProfile(sourceProfile, relative),
    };
  };
  const exactSource = `
export const wakeflowHostSettingsAssetsAdapter = Object.freeze({
  hostId: "claude-code",
  planMaintenance() {},
  createMutationParticipant() {},
});
`;

  const exact = makeArtifact("exact", exactSource);
  const loaded = await loadWakeflowHostSettingsAssetsAdapter({
    wakeflowRoot: exact.artifactRoot,
    hostProfile: exact.hostProfile,
  });
  assert.equal(Object.isFrozen(loaded), true);
  assert.deepEqual(Object.keys(loaded).sort(), ["createMutationParticipant", "hostId", "planMaintenance"]);

  const linkedRoot = path.join(base, "linked-root");
  symlinkSync(exact.artifactRoot, linkedRoot, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(
    loadWakeflowHostSettingsAssetsAdapter({
      wakeflowRoot: linkedRoot,
      hostProfile: exact.hostProfile,
    }),
    (error) => error?.code === "wakeflow-host-settings-owner-adapter",
  );

  const linked = makeArtifact("linked", exactSource, { link: true });
  await assert.rejects(
    loadWakeflowHostSettingsAssetsAdapter({
      wakeflowRoot: linked.artifactRoot,
      hostProfile: linked.hostProfile,
    }),
    (error) => error?.code === "wakeflow-host-settings-owner-adapter",
  );

  const widened = makeArtifact("widened", `
export const wakeflowHostSettingsAssetsAdapter = Object.freeze({
  hostId: "claude-code",
  planMaintenance() {},
  createMutationParticipant() {},
  hiddenAuthority() {},
});
`);
  await assert.rejects(
    loadWakeflowHostSettingsAssetsAdapter({
      wakeflowRoot: widened.artifactRoot,
      hostProfile: widened.hostProfile,
    }),
    (error) => error?.code === "wakeflow-host-settings-owner-adapter",
  );

  const mutable = makeArtifact("mutable", `
export const wakeflowHostSettingsAssetsAdapter = {
  hostId: "claude-code",
  planMaintenance() {},
  createMutationParticipant() {},
};
`);
  await assert.rejects(
    loadWakeflowHostSettingsAssetsAdapter({
      wakeflowRoot: mutable.artifactRoot,
      hostProfile: mutable.hostProfile,
    }),
    (error) => error?.code === "wakeflow-host-settings-owner-adapter",
  );
});

test("capabilities describe applicability and current realization without inventing host symmetry", async () => {
  const { normalizeWakeflowHostCapabilityProfile } = await import("../core/scripts/lib/wakeflow-host-capability.mjs");
  const codex = normalizeWakeflowHostCapabilityProfile(
    (await import("../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs")).hostProfile,
  );
  const claude = normalizeWakeflowHostCapabilityProfile(
    (await import("../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs")).hostProfile,
  );

  for (const name of ["identity", "pod", "keepLive"]) {
    assert.equal(codex.capabilities[name].applicable, true);
    assert.equal(claude.capabilities[name].applicable, true);
  }
  assert.equal(codex.capabilities.keepLive.realization, "runtime-probed");
  assert.equal(claude.capabilities.keepLive.realization, "runtime-probed");
  for (const name of ["locator", "settings", "assets", "activity", "temp"]) {
    assert.equal(codex.capabilities[name].applicable, false, `Codex must not gain a fake ${name} surface`);
    assert.equal(codex.capabilities[name].realization, "not-applicable");
    assert.equal(claude.capabilities[name].applicable, true, `Claude declares its ${name} target surface`);
  }
  assert.equal(claude.capabilities.settings.realization, "current");
  assert.equal(claude.capabilities.assets.realization, "current");
  assert.equal(claude.capabilities.activity.realization, "current");
  assert.equal(claude.capabilities.temp.realization, "current");
  assert.equal(codex.capabilities.close.realization, "manual-gate");
  assert.equal(claude.capabilities.close.realization, "current");
  assert.equal(codex.capabilities.revoke.realization, "manual-gate");
  assert.equal(claude.capabilities.revoke.realization, "current");
  assert.equal(codex.capabilities.activation.applicable, true);
  assert.equal(claude.capabilities.activation.applicable, true);
  assert.equal(codex.capabilities.activation.realization, "runtime-probed");
  assert.equal(claude.capabilities.activation.realization, "runtime-probed");
  assert.deepEqual(claude.capabilities.settings.paths, {
    portable: ".claude/settings.json",
    local: ".claude/settings.local.json",
  });
  assert.deepEqual(codex.capabilities.settings.paths, { portable: null, local: null });
  assert.equal(claude.capabilities.assets.statuslineFileName, "statusline.mjs");
  assert.equal(codex.capabilities.assets.statuslineFileName, null);
});

test("capability validation rejects missing, unknown, contradictory, and fake-host declarations", async () => {
  const {
    WakeflowHostCapabilityError,
    normalizeWakeflowHostCapabilityProfile,
  } = await import("../core/scripts/lib/wakeflow-host-capability.mjs");
  const sourceProfile = (await import("../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs")).hostProfile;
  const profile = {
    hostId: sourceProfile.hostId,
    memoryFile: sourceProfile.memoryFile,
    runtime: { hostDirName: sourceProfile.runtime.hostDirName },
    capabilities: structuredClone(sourceProfile.capabilities),
  };
  const expectCapabilityError = (mutate, code) => {
    const value = structuredClone(profile);
    mutate(value);
    assert.throws(
      () => normalizeWakeflowHostCapabilityProfile(value),
      (error) => error instanceof WakeflowHostCapabilityError && error.code === code && typeof error.path === "string",
    );
  };
  expectCapabilityError((value) => { delete value.capabilities.identity; }, "wakeflow-host-capability-missing");
  expectCapabilityError((value) => { value.capabilities.browser = { applicable: true, realization: "current" }; }, "wakeflow-host-capability-unknown");
  expectCapabilityError((value) => { value.capabilities.locator.realization = "current"; }, "wakeflow-host-capability-contradiction");
  expectCapabilityError((value) => { value.capabilities.settings.paths.portable = ".claude/settings.json"; }, "wakeflow-host-capability-contradiction");
  expectCapabilityError((value) => { value.hostId = "future-host"; }, "wakeflow-host-capability-host");
  expectCapabilityError((value) => { value.memoryFile = "../outside.md"; }, "wakeflow-host-capability-type");
  expectCapabilityError((value) => { value.memoryFile = "nested/AGENTS.md"; }, "wakeflow-host-capability-type");
  expectCapabilityError((value) => { value.runtime.hostDirName = "../../outside-host"; }, "wakeflow-host-capability-type");
  expectCapabilityError((value) => { value.runtime.hostDirName = "host/child"; }, "wakeflow-host-capability-type");
  expectCapabilityError((value) => { value.runtime.hostDirName = "claude-code"; }, "wakeflow-host-capability-contradiction");
  expectCapabilityError((value) => { value.capabilities.identity.realization = "legacy-layout"; }, "wakeflow-host-capability-type");
});

test("capability validation accepts only enumerable plain data without invoking getters", async () => {
  const {
    WakeflowHostCapabilityError,
    normalizeWakeflowHostCapabilityProfile,
  } = await import("../core/scripts/lib/wakeflow-host-capability.mjs");
  const sourceProfile = (await import("../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs")).hostProfile;
  const baseProfile = {
    hostId: sourceProfile.hostId,
    memoryFile: sourceProfile.memoryFile,
    runtime: { hostDirName: sourceProfile.runtime.hostDirName },
    capabilities: structuredClone(sourceProfile.capabilities),
  };
  const expectCapabilityError = (mutate, code) => {
    const value = structuredClone(baseProfile);
    mutate(value);
    assert.throws(
      () => normalizeWakeflowHostCapabilityProfile(value),
      (error) => error instanceof WakeflowHostCapabilityError && error.code === code,
    );
  };

  expectCapabilityError((value) => {
    class Capability {
      constructor() {
        this.applicable = true;
        this.realization = "current";
      }
    }
    value.capabilities.identity = new Capability();
  }, "wakeflow-host-capability-type");
  expectCapabilityError((value) => {
    value.capabilities.identity[Symbol("hidden")] = "unexpected";
  }, "wakeflow-host-capability-unknown");
  expectCapabilityError((value) => {
    Object.defineProperty(value.capabilities.identity, "hidden", { value: "unexpected" });
  }, "wakeflow-host-capability-unknown");
  expectCapabilityError((value) => {
    const identity = { realization: "current" };
    Object.defineProperty(identity, "applicable", { value: true });
    value.capabilities.identity = identity;
  }, "wakeflow-host-capability-type");

  let getterCalls = 0;
  expectCapabilityError((value) => {
    value.capabilities.identity = {};
    Object.defineProperties(value.capabilities.identity, {
      applicable: {
        enumerable: true,
        get() {
          getterCalls += 1;
          return true;
        },
      },
      realization: {
        enumerable: true,
        get() {
          getterCalls += 1;
          return "current";
        },
      },
    });
  }, "wakeflow-host-capability-type");
  assert.equal(getterCalls, 0, "capability accessors must be rejected without execution");

  expectCapabilityError((value) => {
    Object.defineProperty(value, "hostId", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "codex";
      },
    });
  }, "wakeflow-host-capability-type");
  assert.equal(getterCalls, 0, "selected profile accessors must be rejected without execution");

  const profileWithUnrelatedHostGetter = structuredClone(baseProfile);
  Object.defineProperty(profileWithUnrelatedHostGetter, "hostSpecificLazyValue", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "host-owned";
    },
  });
  assert.equal(normalizeWakeflowHostCapabilityProfile(profileWithUnrelatedHostGetter).hostId, "codex");
  assert.equal(getterCalls, 0, "the narrow shared projection must not inspect host-owned extension fields");
});

test("shared core consumes capability data and contains no Codex-versus-Claude behavior branch", () => {
  for (const file of [
    "core/scripts/lib/wakeflow-host-capability.mjs",
    "core/scripts/lib/wakeflow-layout-descriptor.mjs",
  ]) {
    const source = readFileSync(path.join(repositoryRoot, file), "utf8");
    assert.doesNotMatch(source, /hostId\s*===\s*["'](?:codex|claude-code)["']/);
    assert.doesNotMatch(source, /switch\s*\(\s*hostId\s*\)/);
  }
});
