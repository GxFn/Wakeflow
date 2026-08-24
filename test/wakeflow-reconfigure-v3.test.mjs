import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hostProfile } from "../core/scripts/lib/wakeflow-host-profile.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  parseWakeflowConfigV3,
  serializeWakeflowConfigV3,
} from "../core/scripts/lib/wakeflow-config-v3.mjs";
import * as configOwner from "../core/scripts/lib/wakeflow-config-v3-owner.mjs";
import {
  createWakeflowManagedContentMutationParticipant,
  planWakeflowManagedContent,
} from "../core/scripts/lib/wakeflow-managed-content.mjs";
import { rebuildWakeflowActiveProjection } from "../core/scripts/lib/wakeflow-active-projector.mjs";
import { createWakeflowLayoutDescriptor } from "../core/scripts/lib/wakeflow-layout-descriptor.mjs";
import { planWakeflowLocalLayout } from "../core/scripts/lib/wakeflow-local-layout.mjs";
import { writeLedgerProjection } from "../core/scripts/lib/wakeflow-ledger-projector.mjs";
import { EMPTY_TODO_BOARD, TODO_BOARD_REF } from "../core/scripts/lib/wakeflow-todo-service.mjs";
import { rebuildWindowRuntimeProjections } from "../core/scripts/lib/wakeflow-window-runtime-projector.mjs";
import {
  recoverWakeflowWorkspaceMutation,
  runWakeflowMaintenanceMutation,
} from "../core/scripts/lib/wakeflow-workspace-mutation.mjs";
import { parseWakeflowAssetBundle } from "../core/scripts/lib/wakeflow-template-renderer.mjs";
import { buildWakeflowAssetBundle } from "../tools/build-asset-bundle.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetBundle = parseWakeflowAssetBundle(buildWakeflowAssetBundle({
  sourceRoot: path.join(repositoryRoot, "core/template-sources"),
}));
const reconfigureUrl = pathToFileURL(path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-reconfigure.mjs",
)).href;
const configOwnerUrl = pathToFileURL(path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-config-v3-owner.mjs",
)).href;
const mutationUrl = pathToFileURL(path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-workspace-mutation.mjs",
)).href;
const canonicalUrl = pathToFileURL(path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-canonical-json.mjs",
)).href;
let reconfigureModule = null;
let reconfigureImportError = null;
try {
  reconfigureModule = await import(reconfigureUrl);
} catch (error) {
  reconfigureImportError = error;
}

const fixture = JSON.parse(readFileSync(
  path.join(repositoryRoot, "test/fixtures/wakeflow-config-v3/valid-full.json"),
  "utf8",
));

function api(module, name, importError = null) {
  assert.ifError(importError);
  assert.equal(typeof module?.[name], "function", `${name} must be implemented`);
  return module[name];
}

function parsed(value = fixture) {
  return parseWakeflowConfigV3(structuredClone(value));
}

function changed(mutator) {
  const value = structuredClone(fixture);
  mutator(value);
  return parsed(value);
}

function withTempWorkspace(t, prefix = "wakeflow-reconfigure-v3-") {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), prefix));
  const workspaceRoot = path.join(fixtureRoot, "Program");
  mkdirSync(workspaceRoot, { mode: 0o700 });
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  return workspaceRoot;
}

function writeConfig(workspaceRoot, model) {
  const file = path.join(workspaceRoot, "wakeflow.config.json");
  writeFileSync(file, serializeWakeflowConfigV3(model), { mode: 0o644 });
  chmodSync(file, 0o644);
  return file;
}

function topologyDiff(currentModel, desiredModel) {
  return api(
    reconfigureModule,
    "diffWakeflowConfigV3Topology",
    reconfigureImportError,
  )({ currentModel, desiredModel });
}

test("T04 exposes one internal reconfigure module without changing the public-v2 surface", () => {
  assert.ifError(reconfigureImportError);
  for (const name of [
    "diffWakeflowConfigV3Topology",
    "planWakeflowReconfigureBackbone",
  ]) {
    assert.equal(typeof reconfigureModule[name], "function");
  }
  for (const name of [
    "inspectWakeflowConfigV3ReconfigureSource",
    "planWakeflowConfigV3ReconfigureOwner",
    "validateWakeflowConfigV3ReconfigureOwnerPlan",
    "createWakeflowConfigV3ReconfigureMutationParticipant",
  ]) {
    assert.equal(typeof configOwner[name], "function");
  }
});

test("T04 stable-ID topology diff distinguishes unchanged, metadata, add, remove, root, and role changes", () => {
  const current = parsed();
  const unchanged = topologyDiff(current, parsed());
  assert.equal(unchanged.every((entry) => entry.change === "unchanged"), true);
  assert.equal(Object.isFrozen(unchanged), true);
  assert.equal(Object.isFrozen(unchanged[0]), true);

  const metadata = changed((value) => {
    value.topology.windows[3].displayName = "Renamed Product Backend";
    value.topology.repositories[0].displayName = "Renamed Product A";
  });
  const metadataDiff = topologyDiff(current, metadata);
  assert.equal(metadataDiff.find((entry) => entry.entityId === current.topology.windows[3].windowId).change, "metadata-changed");
  assert.equal(metadataDiff.find((entry) => entry.entityId === current.topology.repositories[0].repositoryId).change, "metadata-changed");

  const rootChanged = changed((value) => {
    value.topology.repositories[0].path = "../ProductA-moved";
  });
  assert.equal(
    topologyDiff(current, rootChanged).find((entry) => entry.entityType === "repository").change,
    "root-changed",
  );

  const added = changed((value) => {
    value.topology.windows.push({
      windowId: "window_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      role: "product",
      displayName: "Product A Worker",
      root: {
        kind: "repository",
        repositoryId: value.topology.repositories[0].repositoryId,
      },
    });
  });
  assert.equal(
    topologyDiff(current, added).find((entry) => entry.entityId === "window_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").change,
    "added",
  );

  const removed = changed((value) => {
    value.topology.windows.splice(4, 1);
  });
  assert.equal(
    topologyDiff(current, removed).find((entry) => entry.entityId === current.topology.windows[4].windowId).change,
    "removed",
  );

  const reassigned = changed((value) => {
    const design = value.topology.windows[1];
    const product = value.topology.windows[3];
    design.role = "product";
    design.root = structuredClone(product.root);
    product.role = "design";
    product.root = {
      kind: "support-surface",
      surfaceId: value.topology.supportSurfaces[0].surfaceId,
    };
  });
  const reassignedDiff = topologyDiff(current, reassigned);
  assert.equal(reassignedDiff.find((entry) => entry.entityId === current.topology.windows[1].windowId).change, "role-reassigned");
  assert.equal(reassignedDiff.find((entry) => entry.entityId === current.topology.windows[3].windowId).change, "role-reassigned");
});

test("T04 diff preserves program identity and does not turn host preference changes into topology removal", () => {
  const current = parsed();
  const hostOnly = changed((value) => {
    value.hosts.codex.launch.modelByRole.product = "another-model";
  });
  assert.equal(topologyDiff(current, hostOnly).every((entry) => entry.change === "unchanged"), true);

  const differentProgram = structuredClone(fixture);
  differentProgram.program.programId = "program_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  assert.throws(
    () => topologyDiff(current, parsed(differentProgram)),
    /program|identity/iu,
  );
});

test("T04 config owner plans deterministic current and update states without preview writes", (t) => {
  const workspaceRoot = withTempWorkspace(t);
  const current = parsed();
  writeConfig(workspaceRoot, current);
  const before = readFileSync(path.join(workspaceRoot, "wakeflow.config.json"));
  const planOwner = api(configOwner, "planWakeflowConfigV3ReconfigureOwner");

  const currentPlan = planOwner({ workspaceRoot, desiredModel: current });
  assert.equal(currentPlan.payload.action, "reconfigure");
  assert.equal(currentPlan.payload.status, "ready");
  assert.equal(currentPlan.payload.disposition, "current");
  assert.equal(currentPlan.payload.steps.length, 0);
  assert.equal(Object.isFrozen(currentPlan), true);

  const forgedCurrentPlan = structuredClone(currentPlan);
  forgedCurrentPlan.payload.sourceModel = null;
  forgedCurrentPlan.payload.sourceModelDigest = null;
  forgedCurrentPlan.payload.sourceConfigBytesDigest = null;
  forgedCurrentPlan.payload.sourceFileIdentityDigest = null;
  assert.throws(
    () => configOwner.validateWakeflowConfigV3ReconfigureOwnerPlan(forgedCurrentPlan),
    (error) => error instanceof configOwner.WakeflowConfigV3OwnerError,
  );

  const desired = changed((value) => {
    value.program.displayName = "Renamed Program";
  });
  const first = planOwner({ workspaceRoot, desiredModel: desired });
  const second = planOwner({ workspaceRoot, desiredModel: desired });
  assert.deepEqual(first, second);
  assert.equal(first.payload.status, "ready");
  assert.equal(first.payload.disposition, "update");
  assert.equal(first.payload.steps.length, 1);
  assert.deepEqual(readFileSync(path.join(workspaceRoot, "wakeflow.config.json")), before);
  assert.equal(readFileSync(path.join(workspaceRoot, "wakeflow.config.json"), "utf8"), serializeWakeflowConfigV3(current));
});

test("T04 config update runs through the M3 fence and exact owner participant", async (t) => {
  const workspaceRoot = withTempWorkspace(t);
  const current = parsed();
  const desired = changed((value) => {
    value.program.displayName = "Renamed Program";
    value.topology.windows[3].displayName = "Renamed Backend";
  });
  writeConfig(workspaceRoot, current);
  const planOwner = api(configOwner, "planWakeflowConfigV3ReconfigureOwner");
  const createParticipant = api(configOwner, "createWakeflowConfigV3ReconfigureMutationParticipant");
  const confirmedPlan = planOwner({ workspaceRoot, desiredModel: desired });
  const participant = createParticipant({ workspaceRoot, desiredModel: desired, confirmedPlan });
  const result = await runWakeflowMaintenanceMutation({
    workspaceRoot,
    action: "reconfigure",
    operationKind: "config-v3-reconfigure",
    domainOwner: "config-writer",
    confirmedPlan,
    planDigest: canonicalJsonDigest(confirmedPlan),
    validatePlan: participant.validatePlan,
    deriveCurrentPlan: participant.deriveCurrentPlan,
    deriveTerminalClosure: participant.deriveTerminalClosure,
    stepHandlers: participant.stepHandlers,
  });
  assert.equal(result.status, "completed");
  assert.equal(readFileSync(path.join(workspaceRoot, "wakeflow.config.json"), "utf8"), serializeWakeflowConfigV3(desired));
  assert.deepEqual(
    planOwner({ workspaceRoot, desiredModel: desired }).payload.steps,
    [],
  );
});

test("T04 config owner rejects stale identity, links, symlinks, and unrelated residue without overwrite", async (t) => {
  const current = parsed();
  const desired = changed((value) => {
    value.program.displayName = "Desired Program";
  });
  const planOwner = api(configOwner, "planWakeflowConfigV3ReconfigureOwner");
  const createParticipant = api(configOwner, "createWakeflowConfigV3ReconfigureMutationParticipant");

  const staleRoot = withTempWorkspace(t, "wakeflow-reconfigure-stale-");
  const staleFile = writeConfig(staleRoot, current);
  const confirmedPlan = planOwner({ workspaceRoot: staleRoot, desiredModel: desired });
  const participant = createParticipant({ workspaceRoot: staleRoot, desiredModel: desired, confirmedPlan });
  rmSync(staleFile);
  writeConfig(staleRoot, current);
  await assert.rejects(
    () => runWakeflowMaintenanceMutation({
      workspaceRoot: staleRoot,
      action: "reconfigure",
      operationKind: "config-v3-reconfigure",
      domainOwner: "config-writer",
      confirmedPlan,
      planDigest: canonicalJsonDigest(confirmedPlan),
      validatePlan: participant.validatePlan,
      deriveCurrentPlan: participant.deriveCurrentPlan,
      deriveTerminalClosure: participant.deriveTerminalClosure,
      stepHandlers: participant.stepHandlers,
    }),
    /stale|blocked|plan/iu,
  );
  assert.equal(readFileSync(staleFile, "utf8"), serializeWakeflowConfigV3(current));

  const hardlinkRoot = withTempWorkspace(t, "wakeflow-reconfigure-hardlink-");
  const hardlinkFile = writeConfig(hardlinkRoot, current);
  linkSync(hardlinkFile, path.join(hardlinkRoot, "config-alias.json"));
  assert.equal(planOwner({ workspaceRoot: hardlinkRoot, desiredModel: desired }).payload.status, "blocked");

  const symlinkRoot = withTempWorkspace(t, "wakeflow-reconfigure-symlink-");
  const source = path.join(symlinkRoot, "source.json");
  writeFileSync(source, serializeWakeflowConfigV3(current));
  symlinkSync(source, path.join(symlinkRoot, "wakeflow.config.json"));
  assert.equal(planOwner({ workspaceRoot: symlinkRoot, desiredModel: desired }).payload.status, "blocked");

  const residueRoot = withTempWorkspace(t, "wakeflow-reconfigure-residue-");
  writeConfig(residueRoot, current);
  const residuePlan = planOwner({ workspaceRoot: residueRoot, desiredModel: desired });
  writeFileSync(path.join(residueRoot, residuePlan.payload.stageRef), "unrelated", { mode: 0o644 });
  assert.equal(planOwner({ workspaceRoot: residueRoot, desiredModel: desired }).payload.status, "blocked");

  const foreignResidueRoot = withTempWorkspace(t, "wakeflow-reconfigure-foreign-residue-");
  writeConfig(foreignResidueRoot, current);
  const foreignResiduePlan = planOwner({ workspaceRoot: foreignResidueRoot, desiredModel: desired });
  const targetDigest = foreignResiduePlan.payload.configBytesDigest.slice("sha256:".length);
  const foreignDigest = `${targetDigest[0] === "0" ? "1" : "0"}${targetDigest.slice(1)}`;
  const foreignStageRef = `.wakeflow.config.json.${foreignDigest}.reconfigure-stage`;
  writeFileSync(path.join(foreignResidueRoot, foreignStageRef), "unrelated", { mode: 0o644 });
  const foreignResidueBlocked = planOwner({ workspaceRoot: foreignResidueRoot, desiredModel: desired });
  assert.equal(foreignResidueBlocked.payload.status, "blocked");
  assert.equal(foreignResidueBlocked.payload.sourceClassification, "unsafe-residue");
  assert.equal(
    readFileSync(path.join(foreignResidueRoot, "wakeflow.config.json"), "utf8"),
    serializeWakeflowConfigV3(current),
  );
});

test("T04 config owner recovers prepare, commit, and terminal-cleanup crash boundaries", {
  skip: !new Set(["darwin", "linux"]).has(process.platform)
    ? "M3 process-identity recovery is supported on Darwin and Linux"
    : false,
  timeout: 90_000,
}, async (t) => {
  const current = parsed();
  const desired = changed((value) => {
    value.program.displayName = "Crash-Recovered Program";
    value.topology.windows[3].displayName = "Crash-Recovered Backend";
  });
  for (const boundary of ["prepare", "commit", "cleanup"]) {
    await t.test(boundary, { timeout: 30_000 }, async (subtest) => {
      const workspaceRoot = withTempWorkspace(subtest, `wakeflow-reconfigure-crash-${boundary}-`);
      writeConfig(workspaceRoot, current);
      const childSource = `
        const owner = await import(${JSON.stringify(configOwnerUrl)});
        const manager = await import(${JSON.stringify(mutationUrl)});
        const canonical = await import(${JSON.stringify(canonicalUrl)});
        const workspaceRoot = ${JSON.stringify(workspaceRoot)};
        const desiredModel = ${JSON.stringify(desired)};
        const plan = owner.planWakeflowConfigV3ReconfigureOwner({ workspaceRoot, desiredModel });
        const participant = owner.createWakeflowConfigV3ReconfigureMutationParticipant({ workspaceRoot, desiredModel, confirmedPlan: plan });
        const stepId = plan.payload.steps[0].stepId;
        const real = participant.stepHandlers[stepId];
        const stepHandlers = { ...participant.stepHandlers, [stepId]: { ...real,
          ${boundary}(...args) { real.${boundary}(...args); process.kill(process.pid, "SIGKILL"); },
        } };
        await manager.runWakeflowMaintenanceMutation({
          workspaceRoot,
          action: "reconfigure",
          operationKind: "config-v3-reconfigure",
          domainOwner: "config-writer",
          confirmedPlan: plan,
          planDigest: canonical.canonicalJsonDigest(plan),
          validatePlan: participant.validatePlan,
          deriveCurrentPlan: participant.deriveCurrentPlan,
          deriveTerminalClosure: participant.deriveTerminalClosure,
          stepHandlers,
        });
      `;
      const child = spawn(process.execPath, ["--input-type=module", "-e", childSource], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      let childError = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => { childError += chunk; });
      const [exitCode, signal] = await once(child, "exit");
      assert.equal(exitCode, null, childError);
      assert.equal(signal, "SIGKILL", childError);

      const transactionRoot = path.join(
        workspaceRoot,
        ".wakeflow-local/runtime/maintenance/transactions",
      );
      const journalName = readdirSync(transactionRoot).find((name) => (
        /^workspace-mutation_[0-9a-f-]+\.json$/u.test(name)
      ));
      assert.equal(typeof journalName, "string");
      const operationId = journalName.slice(0, -".json".length);
      const durablePlan = JSON.parse(readFileSync(path.join(transactionRoot, journalName), "utf8")).plan;
      const participant = configOwner.createWakeflowConfigV3ReconfigureMutationParticipant({
        workspaceRoot,
        desiredModel: desired,
        confirmedPlan: durablePlan,
      });
      const recovered = await recoverWakeflowWorkspaceMutation({
        workspaceRoot,
        operationId,
        confirmedPlan: durablePlan,
        planDigest: canonicalJsonDigest(durablePlan),
        validatePlan: participant.validatePlan,
        deriveCurrentPlan: participant.deriveCurrentPlan,
        deriveTerminalClosure: participant.deriveTerminalClosure,
        stepHandlers: participant.stepHandlers,
      });
      const configFile = path.join(workspaceRoot, "wakeflow.config.json");
      assert.equal(
        recovered.status,
        boundary === "cleanup" ? "terminal-cleanup-recovered" : "recovered",
      );
      assert.equal(readFileSync(configFile, "utf8"), serializeWakeflowConfigV3(desired));
      assert.equal(lstatSync(configFile).nlink, 1);
      assert.equal(existsSync(path.join(workspaceRoot, durablePlan.payload.stageRef)), false);
      assert.equal(existsSync(path.join(workspaceRoot, durablePlan.payload.predecessorRef)), false);
      assert.deepEqual(readdirSync(transactionRoot), []);
    });
  }
});

test("T04 backbone blocks ledger migration and unresolved domain owners while preserving stable facts", (t) => {
  const workspaceRoot = withTempWorkspace(t);
  const current = parsed();
  writeConfig(workspaceRoot, current);
  const planBackbone = api(reconfigureModule, "planWakeflowReconfigureBackbone", reconfigureImportError);
  const metadataDesired = changed((value) => {
    value.topology.windows[3].displayName = "Renamed Backend";
  });
  const metadataPlan = planBackbone({
    workspaceRoot,
    desiredModel: metadataDesired,
    hostProfile,
    bundle: assetBundle,
    language: "en",
  });
  assert.equal(metadataPlan.status, "blocked");
  assert.equal(metadataPlan.aggregatePlan.payload.status, "blocked");
  assert.equal(metadataPlan.dependencyMatrix.some((entry) => entry.owner === "managed-content-owner"), false);
  assert.equal(metadataPlan.ownerGraph.some((entry) => entry.componentId === "ignore"), true);
  assert.equal(metadataPlan.ownerGraph.some((entry) => entry.componentId === "managed-memory"), true);
  assert.deepEqual(
    metadataPlan.preservation.find((entry) => entry.entityId === current.topology.windows[3].windowId).preserves,
    ["binding", "evidence", "lease", "operations", "transport"],
  );
  assert.equal(canonicalJson(metadataPlan).includes(path.resolve(workspaceRoot)), false);
  assert.equal(canonicalJson(metadataPlan).includes("rawHandle"), false);

  const ledgerDesired = changed((value) => {
    value.storage.ledgerRoot = "../wakeflow-ledger-moved";
  });
  const ledgerPlan = planBackbone({
    workspaceRoot,
    desiredModel: ledgerDesired,
    hostProfile,
    bundle: assetBundle,
    language: "en",
  });
  assert.equal(ledgerPlan.status, "blocked");
  assert.equal(ledgerPlan.blockers.some((entry) => entry.code === "ledger-root-requires-explicit-migration"), true);
});

test("T04 window-runtime source failure remains one stable reconfigure blocker", (t) => {
  const workspaceRoot = withTempWorkspace(t, "wakeflow-reconfigure-window-runtime-unavailable-");
  const current = parsed();
  writeConfig(workspaceRoot, current);
  for (const ref of [
    ".wakeflow-local",
    ".wakeflow-local/runtime",
    ".wakeflow-local/runtime/hosts",
    ".wakeflow-local/runtime/hosts/codex",
    ".wakeflow-local/runtime/hosts/codex/identity",
    ".wakeflow-local/runtime/hosts/codex/identity/window-bindings",
  ]) {
    const target = path.join(workspaceRoot, ...ref.split("/"));
    mkdirSync(target, { recursive: true, mode: 0o700 });
    chmodSync(target, 0o700);
  }
  writeFileSync(
    path.join(
      workspaceRoot,
      ".wakeflow-local/runtime/hosts/codex/identity/window-bindings/unknown.txt",
    ),
    "unknown identity sibling\n",
    { mode: 0o600 },
  );

  const plan = api(
    reconfigureModule,
    "planWakeflowReconfigureBackbone",
    reconfigureImportError,
  )({
    workspaceRoot,
    desiredModel: current,
    hostProfile,
    bundle: assetBundle,
    language: "en",
  });
  assert.equal(plan.status, "blocked");
  assert.equal(plan.aggregatePlan, null);
  assert.equal(plan.confirmedActionPlan, null);
  assert.equal(plan.blockers.some((entry) => (
    entry.componentId === "window-runtime-projection"
    && entry.owner === "runtime-projection-builder"
    && entry.code === "reconfigure-window-runtime-source-unavailable"
  )), true);
  assert.equal(plan.dependencyMatrix.some((entry) => (
    entry.owner === "runtime-projection-builder"
    && entry.code === "reconfigure-window-runtime-source-unavailable"
  )), true);
  assert.equal(
    plan.ownerGraph.find((entry) => entry.componentId === "window-runtime-projection").availability,
    "blocked",
  );
});

test("T04 same-model reconfigure audits managed content and is zero-step only when current", async (t) => {
  const workspaceRoot = withTempWorkspace(t);
  const current = parsed();
  writeConfig(workspaceRoot, current);
  const planBackbone = api(
    reconfigureModule,
    "planWakeflowReconfigureBackbone",
    reconfigureImportError,
  );
  const incomplete = planBackbone({
    workspaceRoot,
    desiredModel: current,
    hostProfile,
    bundle: assetBundle,
    language: "en",
  });
  assert.equal(incomplete.status, "blocked");
  assert.equal(incomplete.blockers.some((entry) => entry.code === "managed-root-missing"), true);

  for (const configuredPath of [
    ...current.topology.repositories.map((entry) => entry.path),
    ...current.topology.supportSurfaces.map((entry) => entry.path),
  ]) mkdirSync(path.resolve(workspaceRoot, configuredPath), { recursive: true, mode: 0o700 });
  const ledgerRoot = path.resolve(workspaceRoot, current.storage.ledgerRoot);
  for (const ref of [".", "requirement-designs", "goal-stage-confirmation", "workspace", "workspace/archive"]) {
    const target = ref === "." ? ledgerRoot : path.join(ledgerRoot, ...ref.split("/"));
    mkdirSync(target, { recursive: true, mode: 0o755 });
    chmodSync(target, 0o755);
  }
  writeLedgerProjection({
    ledgerRoot,
    programId: current.program.programId,
    programDisplayName: current.program.displayName,
  });
  const managedPlan = planWakeflowManagedContent({
    workspaceRoot,
    action: "reconfigure",
    sourceModel: current,
    desiredModel: current,
    hostProfile,
    authorizedRepositoryIds: [],
  });
  const managedParticipant = createWakeflowManagedContentMutationParticipant({
    workspaceRoot,
    action: "reconfigure",
    sourceModel: current,
    desiredModel: current,
    hostProfile,
    authorizedRepositoryIds: [],
    confirmedPlan: managedPlan,
  });
  await runWakeflowMaintenanceMutation({
    workspaceRoot,
    action: "reconfigure",
    operationKind: "managed-content",
    domainOwner: "managed-content-owner",
    confirmedPlan: managedPlan,
    planDigest: canonicalJsonDigest(managedPlan),
    validatePlan: managedParticipant.validatePlan,
    deriveCurrentPlan: managedParticipant.deriveCurrentPlan,
    deriveTerminalClosure: managedParticipant.deriveTerminalClosure,
    stepHandlers: managedParticipant.stepHandlers,
  });

  const activeRoot = path.join(workspaceRoot, ".wakeflow-active");
  const currentRoot = path.join(activeRoot, "current");
  mkdirSync(currentRoot, { recursive: true, mode: 0o755 });
  chmodSync(activeRoot, 0o755);
  chmodSync(currentRoot, 0o755);
  const todoFile = path.join(workspaceRoot, ...TODO_BOARD_REF.split("/"));
  writeFileSync(todoFile, EMPTY_TODO_BOARD, { mode: 0o644 });
  chmodSync(todoFile, 0o644);
  rebuildWakeflowActiveProjection({
    workspaceRoot,
    bundle: assetBundle,
    language: "en",
  });

  const descriptor = createWakeflowLayoutDescriptor({ model: current, hostProfile });
  const localLayout = planWakeflowLocalLayout({
    model: current,
    layoutDescriptor: descriptor,
    hostProfile,
  });
  for (const entry of localLayout.staticDirectories) {
    const target = path.join(workspaceRoot, ...entry.path.split("/"));
    const mode = Number.parseInt(entry.mode, 8);
    mkdirSync(target, { recursive: true, mode });
    chmodSync(target, mode);
  }
  await rebuildWindowRuntimeProjections({ workspaceRoot });

  const plan = planBackbone({
    workspaceRoot,
    desiredModel: current,
    hostProfile,
    bundle: assetBundle,
    language: "en",
  });
  assert.equal(plan.status, "ready");
  assert.ok(plan.confirmedActionPlan);
  assert.equal(plan.confirmedActionPlan.payload.aggregatePlanDigest, plan.aggregatePlanDigest);
  assert.equal(plan.config.disposition, "current");
  assert.deepEqual(plan.dependencyMatrix, []);
  assert.equal(plan.aggregatePlan.payload.status, "ready");
  assert.deepEqual(plan.aggregatePlan.payload.steps, []);
  assert.equal(plan.ownerGraph.find((entry) => entry.componentId === "ignore").availability, "available");
  assert.equal(plan.ownerGraph.find((entry) => entry.componentId === "managed-memory").availability, "available");
  assert.equal(plan.aggregatePlan.payload.components.some((entry) => entry.componentId === "ignore"), true);
  assert.equal(plan.aggregatePlan.payload.components.some((entry) => entry.componentId === "managed-memory"), true);
  assert.equal(plan.topologyDiff.every((entry) => entry.change === "unchanged"), true);
});

test("T04 removed window remains blocked by exact lifecycle owners and never claims host closure", (t) => {
  const workspaceRoot = withTempWorkspace(t);
  const current = parsed();
  writeConfig(workspaceRoot, current);
  const desired = changed((value) => {
    value.topology.windows.splice(4, 1);
  });
  const plan = api(
    reconfigureModule,
    "planWakeflowReconfigureBackbone",
    reconfigureImportError,
  )({
    workspaceRoot,
    desiredModel: desired,
    hostProfile,
    bundle: assetBundle,
    language: "en",
  });
  const removedWindowId = current.topology.windows[4].windowId;
  const owners = new Set(
    plan.dependencyMatrix
      .filter((entry) => entry.subject.kind === "window" && entry.subject.value === removedWindowId)
      .map((entry) => entry.owner),
  );
  for (const owner of [
    "active-state-owner",
    "transport-owner",
    "window-binding-owner",
    "window-lease-owner",
    "pod-owner",
    "host-lifecycle-owner",
    "window-runtime-projector",
  ]) {
    assert.equal(owners.has(owner), true, `missing lifecycle owner ${owner}`);
  }
  assert.equal(plan.hostEffectsAllowed, false);
  assert.equal(plan.blockers.some((entry) => /closed|decommissioned/iu.test(entry.code)), false);
});
