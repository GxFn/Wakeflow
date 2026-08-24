import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { canonicalJsonDigest } from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  parseWakeflowConfigV3,
  serializeWakeflowConfigV3,
} from "../core/scripts/lib/wakeflow-config-v3.mjs";
import { hostProfile as codexProfile } from "../core/scripts/lib/wakeflow-host-profile.mjs";
import { createWakeflowLayoutDescriptor } from "../core/scripts/lib/wakeflow-layout-descriptor.mjs";
import { planWakeflowLocalLayout } from "../core/scripts/lib/wakeflow-local-layout.mjs";
import { planWakeflowLocalLayoutRealization } from "../core/scripts/lib/wakeflow-local-layout-realization.mjs";
import { rebuildWindowRuntimeProjections } from "../core/scripts/lib/wakeflow-window-runtime-projector.mjs";
import { parseWakeflowAssetBundle } from "../core/scripts/lib/wakeflow-template-renderer.mjs";
import { hostProfile as claudeProfile } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import { buildWakeflowAssetBundle } from "../tools/build-asset-bundle.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetBundle = parseWakeflowAssetBundle(buildWakeflowAssetBundle({
  sourceRoot: path.join(repositoryRoot, "core/template-sources"),
}));
const reconcileUrl = pathToFileURL(path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-reconcile.mjs",
)).href;
const fixture = JSON.parse(readFileSync(
  path.join(repositoryRoot, "test/fixtures/wakeflow-config-v3/valid-minimal.json"),
  "utf8",
));

let reconcileModule = null;
let reconcileImportError = null;
try {
  reconcileModule = await import(reconcileUrl);
} catch (error) {
  reconcileImportError = error;
}

function api(name) {
  assert.ifError(reconcileImportError);
  assert.equal(typeof reconcileModule?.[name], "function", `${name} must be implemented`);
  return reconcileModule[name];
}

function parsed(mutator = null) {
  const value = structuredClone(fixture);
  mutator?.(value);
  return parseWakeflowConfigV3(value);
}

function ensureDirectory(root, ref, mode = 0o700) {
  const target = path.resolve(root, ...ref.split("/"));
  mkdirSync(target, { recursive: true, mode });
  chmodSync(target, mode);
  return target;
}

function prepareWorkspace(t, {
  profile = codexProfile,
  materializeLocal = false,
  model = parsed(),
} = {}) {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-reconcile-v3-"));
  const workspaceRoot = path.join(fixtureRoot, "Program");
  mkdirSync(workspaceRoot, { mode: 0o700 });
  for (const configured of [
    ...model.topology.repositories.map((entry) => entry.path),
    ...model.topology.supportSurfaces.map((entry) => entry.path),
    model.storage.ledgerRoot,
  ]) {
    const target = path.resolve(workspaceRoot, configured);
    mkdirSync(target, { recursive: true, mode: 0o700 });
    chmodSync(target, 0o700);
  }
  const configFile = path.join(workspaceRoot, "wakeflow.config.json");
  writeFileSync(configFile, serializeWakeflowConfigV3(model), { mode: 0o644 });
  chmodSync(configFile, 0o644);
  if (materializeLocal) {
    const descriptor = createWakeflowLayoutDescriptor({ model, hostProfile: profile });
    const layout = planWakeflowLocalLayout({ model, layoutDescriptor: descriptor, hostProfile: profile });
    for (const entry of layout.staticDirectories) ensureDirectory(workspaceRoot, entry.path);
  }
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  return { fixtureRoot, workspaceRoot, model, configFile };
}

function treeSnapshot(root) {
  const visit = (absolute, relative = ".") => readdirSync(absolute, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, "en"))
    .flatMap((entry) => {
      const child = path.join(absolute, entry.name);
      const ref = relative === "." ? entry.name : `${relative}/${entry.name}`;
      const stat = lstatSync(child);
      const record = {
        ref,
        type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
        mode: stat.mode & 0o777,
        bytesDigest: entry.isFile() ? canonicalJsonDigest(readFileSync(child).toString("base64")) : null,
      };
      return entry.isDirectory() ? [record, ...visit(child, ref)] : [record];
    });
  return visit(root);
}

function plan(workspaceRoot, profile = codexProfile) {
  return api("planWakeflowReconcileBackbone")({
    workspaceRoot,
    hostProfile: profile,
    bundle: assetBundle,
    language: "zh",
  });
}

function localLayout(workspaceRoot, model, profile = codexProfile) {
  const layoutDescriptor = createWakeflowLayoutDescriptor({ model, hostProfile: profile });
  return {
    layoutDescriptor,
    layout: planWakeflowLocalLayout({ model, layoutDescriptor, hostProfile: profile }),
  };
}

test("T05 exposes one internal reconcile backbone without changing public-v2", () => {
  assert.ifError(reconcileImportError);
  assert.equal(reconcileModule.WAKEFLOW_RECONCILE_KIND, "WakeflowReconcileBackbonePlan");
  assert.equal(reconcileModule.WAKEFLOW_RECONCILE_SCHEMA_VERSION, 1);
  assert.equal(typeof reconcileModule.WakeflowReconcileError, "function");
  assert.equal(typeof reconcileModule.planWakeflowReconcileBackbone, "function");
});

test("T05 reconcile derives the exact current config and preview performs zero writes", (t) => {
  const { workspaceRoot, configFile } = prepareWorkspace(t);
  const beforeTree = treeSnapshot(path.dirname(workspaceRoot));
  const beforeConfig = readFileSync(configFile);
  const beforeIdentity = lstatSync(configFile);
  const first = plan(workspaceRoot);
  const second = plan(workspaceRoot);

  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.ownerGraph), true);
  assert.equal(first.action, "reconcile");
  assert.equal(first.status, "blocked");
  assert.equal(first.confirmedActionPlan, null);
  assert.equal(first.hostEffectsAllowed, false);
  assert.equal(first.config.disposition, "current");
  assert.equal(first.scope.configMutationAllowed, false);
  assert.equal(first.scope.registrationAllowed, false);
  assert.equal(first.scope.migrationAllowed, false);
  assert.equal(first.topologyDiff.every((entry) => entry.change === "unchanged"), true);
  assert.equal(first.aggregatePlan.payload.config.disposition, "current");
  assert.equal(
    first.aggregatePlan.payload.filesystemActions.find((entry) => entry.componentId === "config").stepId,
    null,
  );
  assert.equal(first.aggregatePlan.payload.steps.some((entry) => entry.final.ref.endsWith("wakeflow.config.json")), false);
  assert.equal(first.ownerGraph.find((entry) => entry.componentId === "ignore").availability, "available");
  assert.equal(first.ownerGraph.find((entry) => entry.componentId === "managed-memory").availability, "available");
  assert.equal(first.ownerGraph.some((entry) => (
    new Set(["ignore", "managed-memory"]).has(entry.componentId) && entry.availability === "missing"
  )), false);
  assert.equal(first.aggregatePlan.payload.filesystemActions.some((entry) => entry.componentId === "ignore"), true);
  assert.equal(
    first.aggregatePlan.payload.filesystemActions.some((entry) => entry.componentId === "managed-memory"),
    true,
  );
  assert.equal(JSON.stringify(first).includes(workspaceRoot), false);
  assert.deepEqual(readFileSync(configFile), beforeConfig);
  const afterIdentity = lstatSync(configFile);
  assert.equal(afterIdentity.dev, beforeIdentity.dev);
  assert.equal(afterIdentity.ino, beforeIdentity.ino);
  assert.deepEqual(treeSnapshot(path.dirname(workspaceRoot)), beforeTree);
});

test("T05 local owner plans missing directories and only admitted safe mode repair", (t) => {
  const { workspaceRoot, model } = prepareWorkspace(t, { materializeLocal: true });
  const { layout } = localLayout(workspaceRoot, model);
  const protocolProvided = new Set([
    ".wakeflow-local",
    ".wakeflow-local/runtime",
    ".wakeflow-local/runtime/maintenance",
    ".wakeflow-local/runtime/maintenance/transactions",
  ]);
  const leafDirectories = layout.staticDirectories.filter((entry) => (
    !protocolProvided.has(entry.path)
    &&
    !layout.staticDirectories.some((other) => other.path.startsWith(`${entry.path}/`))
  ));
  const [missing, repair, unsafe] = leafDirectories.slice(0, 3);
  assert.ok(missing && repair && unsafe);
  rmSync(path.resolve(workspaceRoot, ...missing.path.split("/")), { recursive: true });
  chmodSync(path.resolve(workspaceRoot, ...repair.path.split("/")), 0o740);

  const admitted = plan(workspaceRoot);
  assert.ok(admitted.aggregatePlan, JSON.stringify({
    selected: { missing: missing.path, repair: repair.path, unsafe: unsafe.path },
    localLayout: admitted.localLayout,
    windowRuntime: admitted.windowRuntime,
    blockers: admitted.blockers,
  }));
  const byRef = new Map(admitted.aggregatePlan.payload.filesystemActions.map((entry) => [entry.ref, entry]));
  assert.equal(byRef.get(missing.path).classification, "managed-missing");
  assert.equal(byRef.get(missing.path).action, "create-managed");
  assert.equal(byRef.get(repair.path).classification, "managed-stale-known");
  assert.equal(byRef.get(repair.path).action, "update-managed");

  chmodSync(path.resolve(workspaceRoot, ...unsafe.path.split("/")), 0o770);
  const blocked = plan(workspaceRoot);
  assert.equal(blocked.aggregatePlan, null);
  assert.equal(blocked.blockers.some((entry) => (
    entry.owner === "layout-manager" && entry.code === "reconcile-local-layout-blocked"
  )), true);
});

test("T08 delegated projection drift is repaired by its owner without stealing layout authority", async (t) => {
  const { workspaceRoot, model } = prepareWorkspace(t, { materializeLocal: true });
  await rebuildWindowRuntimeProjections({ workspaceRoot });
  const changed = parsed((value) => { value.program.displayName = "Changed projection source"; });
  writeFileSync(
    path.join(workspaceRoot, "wakeflow.config.json"),
    serializeWakeflowConfigV3(changed),
    { mode: 0o644 },
  );
  chmodSync(path.join(workspaceRoot, "wakeflow.config.json"), 0o644);
  const { layout } = localLayout(workspaceRoot, changed);
  const missing = layout.staticDirectories.find((entry) => (
    !layout.staticDirectories.some((other) => other.path.startsWith(`${entry.path}/`))
  ));
  rmSync(path.resolve(workspaceRoot, ...missing.path.split("/")), { recursive: true });

  const descriptor = createWakeflowLayoutDescriptor({ model: changed, hostProfile: codexProfile });
  const ownerPlan = planWakeflowLocalLayoutRealization({
    workspaceRoot,
    action: "reconcile",
    model: changed,
    layoutDescriptor: descriptor,
    hostProfile: codexProfile,
  });
  assert.equal(ownerPlan.payload.blockers.length, 0);
  assert.equal(ownerPlan.payload.steps.some((entry) => entry.final.ref === missing.path), true);

  const result = plan(workspaceRoot);
  assert.equal(result.windowRuntime.projectionStatus, "stale");
  assert.equal(result.ownerGraph.find((entry) => entry.componentId === "local-layout").availability, "available");
  assert.equal(result.blockers.some((entry) => entry.code === "reconcile-window-runtime-participant-unavailable"), false);
  assert.equal(
    result.ownerGraph.find((entry) => entry.componentId === "window-runtime-projection").availability,
    "available",
  );
  assert.equal(result.aggregatePlan.payload.filesystemActions.some((entry) => (
    entry.componentId === "window-runtime-projection" && entry.action === "update-managed"
  )), true);
  assert.equal(result.aggregatePlan.payload.filesystemActions.some((entry) => entry.ref === missing.path), true);
  assert.equal(model.program.programId, changed.program.programId);
});

test("T05 unsafe derived projection is preserved and blocks all reconcile writes", async (t) => {
  const { workspaceRoot, model } = prepareWorkspace(t, { materializeLocal: true });
  await rebuildWindowRuntimeProjections({ workspaceRoot });
  const { layout } = localLayout(workspaceRoot, model);
  const projection = layout.initialProjections[0];
  writeFileSync(path.resolve(workspaceRoot, ...projection.path.split("/")), "{}\n", { mode: 0o600 });
  chmodSync(path.resolve(workspaceRoot, ...projection.path.split("/")), 0o600);
  const before = treeSnapshot(path.dirname(workspaceRoot));

  const result = plan(workspaceRoot);
  assert.equal(result.windowRuntime.projectionStatus, "unsafe");
  assert.equal(result.aggregatePlan, null);
  assert.equal(result.blockers.some((entry) => entry.code === "reconcile-window-runtime-unsafe"), true);
  assert.deepEqual(treeSnapshot(path.dirname(workspaceRoot)), before);
});

test("T05 exact current projections satisfy their owner dependency without a rewrite", async (t) => {
  const { workspaceRoot } = prepareWorkspace(t, { materializeLocal: true });
  await rebuildWindowRuntimeProjections({ workspaceRoot });
  const before = treeSnapshot(path.dirname(workspaceRoot));

  const result = plan(workspaceRoot);
  assert.equal(result.windowRuntime.projectionStatus, "current");
  assert.equal(
    result.ownerGraph.find((entry) => entry.componentId === "window-runtime-projection").availability,
    "available",
  );
  assert.equal(result.blockers.some((entry) => entry.componentId === "window-runtime-projection"), false);
  assert.deepEqual(treeSnapshot(path.dirname(workspaceRoot)), before);
});

test("T05 delegated host asset shape stays outside layout-manager write authority", (t) => {
  const { workspaceRoot, model } = prepareWorkspace(t, {
    profile: claudeProfile,
    materializeLocal: true,
  });
  const { layoutDescriptor, layout } = localLayout(workspaceRoot, model, claudeProfile);
  const asset = layout.managedFiles[0];
  assert.ok(asset);
  writeFileSync(
    path.resolve(workspaceRoot, ...asset.path.split("/")),
    "custom-or-stale-host-asset\n",
    { mode: 0o600 },
  );
  chmodSync(path.resolve(workspaceRoot, ...asset.path.split("/")), 0o600);
  const ownerPlan = planWakeflowLocalLayoutRealization({
    workspaceRoot,
    action: "reconcile",
    model,
    layoutDescriptor,
    hostProfile: claudeProfile,
  });
  assert.equal(ownerPlan.payload.blockers.length, 0);
  assert.equal(ownerPlan.payload.steps.some((entry) => entry.final.ref === asset.path), false);

  const result = plan(workspaceRoot, claudeProfile);
  assert.ok(result.aggregatePlan);
  assert.equal(result.aggregatePlan.payload.filesystemActions.some((entry) => entry.ref === asset.path), false);
  assert.equal(result.blockers.some((entry) => entry.componentId === "host-settings-assets"), true);
});

test("T05 legacy, unknown, and unsafe config ownership fail closed", (t) => {
  const first = prepareWorkspace(t, { materializeLocal: true });
  writeFileSync(path.join(first.workspaceRoot, ".wakeflow-local", "README.md"), "legacy\n", { mode: 0o600 });
  const legacy = plan(first.workspaceRoot);
  assert.equal(legacy.aggregatePlan, null);
  assert.equal(legacy.blockers.some((entry) => entry.owner === "layout-manager"), true);

  const second = prepareWorkspace(t);
  chmodSync(second.configFile, 0o600);
  const configBlocked = plan(second.workspaceRoot);
  assert.equal(configBlocked.aggregatePlan, null);
  assert.equal(configBlocked.config.status, "blocked");
  assert.equal(configBlocked.blockers.some((entry) => entry.owner === "config-writer"), true);
});

test("T05 another host first-entry scope materializes only that host surface", (t) => {
  const claude = prepareWorkspace(t);
  const claudePlan = plan(claude.workspaceRoot, claudeProfile);
  assert.equal(claudePlan.scope.hostId, "claude-code");
  assert.equal(claudePlan.scope.hostDirName, "claude-code");
  assert.equal(claudePlan.ownerGraph.some((entry) => entry.componentId === "host-settings-assets"), true);
  const claudeHostRefs = claudePlan.aggregatePlan.payload.filesystemActions
    .map((entry) => entry.ref)
    .filter((ref) => ref.startsWith(".wakeflow-local/runtime/hosts/"));
  assert.equal(claudeHostRefs.some((ref) => ref.startsWith(".wakeflow-local/runtime/hosts/claude-code/")), true);
  assert.equal(claudeHostRefs.some((ref) => ref.startsWith(".wakeflow-local/runtime/hosts/codex/")), false);

  const codex = prepareWorkspace(t);
  const codexPlan = plan(codex.workspaceRoot, codexProfile);
  assert.equal(codexPlan.scope.hostId, "codex");
  assert.equal(codexPlan.ownerGraph.some((entry) => entry.componentId === "host-settings-assets"), false);
});

test("T05 reconcile input is closed and never accepts a desired config", (t) => {
  const { workspaceRoot } = prepareWorkspace(t);
  assert.throws(
    () => api("planWakeflowReconcileBackbone")({
      workspaceRoot,
      hostProfile: codexProfile,
      bundle: assetBundle,
      language: "zh",
      desiredModel: parsed(),
    }),
    /field|contract|input/iu,
  );
});
