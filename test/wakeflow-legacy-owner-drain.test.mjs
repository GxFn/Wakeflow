import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  cpSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { inspectWakeflowArtifactTree } from "../core/scripts/lib/wakeflow-artifact-tree-identity.mjs";
import {
  canonicalJsonDigest,
  canonicalJsonDigestHex,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  retiredV2DispatchPacketDigest,
  retiredV2DispatchPreparationDigest,
} from "./support/wakeflow-retired-v2-digests.mjs";
import {
  inspectWakeflowRetiredWriterFixture,
  materializeWakeflowRetiredArchiveOutput,
} from "./support/wakeflow-retired-writer-fixture.mjs";
import { loadWakeflowHistoricalArtifactIdentity } from "./support/wakeflow-historical-artifact.mjs";
import {
  WAKEFLOW_LEGACY_ARCHIVE_IMPORT_INVENTORY_KIND,
  WAKEFLOW_LEGACY_ARCHIVE_IMPORT_INVENTORY_SCHEMA_VERSION,
  WAKEFLOW_LEGACY_OWNER_DRAIN_KIND,
  WAKEFLOW_LEGACY_OWNER_DRAIN_SCHEMA_VERSION,
  WAKEFLOW_LEGACY_OWNER_DRAIN_STATUSES,
  WakeflowLegacyOwnerDrainError,
  inspectWakeflowLegacyArchiveImportInventory,
  inspectWakeflowLegacyOwnerDrain,
  validateWakeflowLegacyArchiveImportInventory,
  validateWakeflowLegacyOwnerDrainAssessment,
  wakeflowLegacyArchiveImportInventoryDigest,
  wakeflowLegacyOwnerDrainAssessmentDigest,
} from "../core/scripts/lib/wakeflow-legacy-owner-drain.mjs";
import { inspectWakeflowMigrationInventory } from "../core/scripts/lib/wakeflow-migration-inventory.mjs";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..");
const ORIGINS_ROOT = path.join(REPOSITORY_ROOT, "test/fixtures/legacy-origins");
const CODEX_ARTIFACT = path.join(REPOSITORY_ROOT, "plugins/codex-wakeflow");
const CLAUDE_ARTIFACT = path.join(REPOSITORY_ROOT, "plugins/claude-code-wakeflow");

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactTree(root) {
  const entries = [];
  function walk(file, ref) {
    const stat = lstatSync(file);
    const type = stat.isDirectory()
      ? "directory"
      : stat.isFile()
        ? "file"
        : stat.isSymbolicLink()
          ? "symlink"
          : "special";
    entries.push({
      digest: type === "file"
        ? sha256(readFileSync(file))
        : type === "symlink"
          ? sha256(Buffer.from(readlinkSync(file), "utf8"))
          : null,
      ref,
      size: stat.size,
      type,
    });
    if (type !== "directory") return;
    for (const name of readdirSync(file).sort()) {
      walk(path.join(file, name), ref ? `${ref}/${name}` : name);
    }
  }
  walk(root, "");
  return entries;
}

function materializeOrigin(t, originId) {
  const originRoot = path.join(ORIGINS_ROOT, originId);
  const origin = JSON.parse(readFileSync(path.join(originRoot, "origin.json"), "utf8"));
  const sandbox = mkdtempSync(path.join(os.tmpdir(), "wakeflow-owner-drain-origin-"));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  for (const layer of origin.staticLayers) {
    for (const entry of layer.expectedEntries) {
      const target = path.join(sandbox, ...entry.path.split("/"));
      if (entry.afterType === null) {
        rmSync(target, { recursive: true, force: true });
      } else if (entry.afterType === "directory") {
        mkdirSync(target, { recursive: true });
      } else {
        assert.equal(entry.afterType, "file");
        mkdirSync(path.dirname(target), { recursive: true });
        cpSync(path.join(originRoot, "static", layer.layerId, ...entry.path.split("/")), target);
      }
    }
  }
  return {
    origin,
    originRoot,
    sandbox,
    workspaceRoot: path.join(sandbox, "WakeflowFixture"),
  };
}

function applyScenario(materialized, scenarioId) {
  const scenarioRoot = path.join(materialized.originRoot, "scenarios", scenarioId);
  const scenario = JSON.parse(readFileSync(path.join(scenarioRoot, "scenario.json"), "utf8"));
  for (const entry of scenario.deltaEntries) {
    const target = path.join(materialized.sandbox, ...entry.path.split("/"));
    if (entry.afterType === null) {
      rmSync(target, { recursive: true, force: true });
    } else if (entry.afterType === "directory") {
      mkdirSync(target, { recursive: true });
    } else {
      assert.equal(entry.afterType, "file");
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(path.join(scenarioRoot, "output", ...entry.path.split("/")), target);
    }
  }
  if (scenarioId === "transport-result-reviewed") {
    rehydrateTransportDigests(materialized.workspaceRoot);
  }
  if (["pod-open", "pod-closed"].includes(scenarioId)) {
    rehydratePodDigests(materialized.workspaceRoot);
  }
  return scenario;
}

function rehydrateTransportDigests(workspaceRoot) {
  const transportRoot = path.join(workspaceRoot, ".wakeflow-local/wakeflow-delivery");
  const packetRoot = path.join(transportRoot, "dispatch-packets");
  const envelopeRoot = path.join(transportRoot, "delivery-envelopes");
  if (!existsSync(packetRoot) || !existsSync(envelopeRoot)) return;
  const packets = new Map();
  for (const name of readdirSync(packetRoot).filter((entry) => entry.endsWith(".json"))) {
    const file = path.join(packetRoot, name);
    const packet = JSON.parse(readFileSync(file, "utf8"));
    packet.packetDigest = retiredV2DispatchPacketDigest(packet);
    writeFileSync(file, `${JSON.stringify(packet, null, 2)}\n`);
    packets.set(packet.id, packet);
  }
  for (const name of readdirSync(envelopeRoot).filter((entry) => entry.endsWith(".json"))) {
    const file = path.join(envelopeRoot, name);
    const envelope = JSON.parse(readFileSync(file, "utf8"));
    if (envelope.kind !== "DeliveryEnvelope") continue;
    const packet = packets.get(envelope.sourcePacketId);
    assert.ok(packet, `missing packet for ${envelope.deliveryId}`);
    envelope.sourcePacketDigest = packet.packetDigest;
    envelope.preparationDigest = retiredV2DispatchPreparationDigest({ packet, envelope });
    writeFileSync(file, `${JSON.stringify(envelope, null, 2)}\n`);
  }
}

function rehydratePodDigests(workspaceRoot) {
  const hostsRoot = path.join(
    workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/hosts",
  );
  if (!existsSync(hostsRoot)) return;
  for (const hostName of readdirSync(hostsRoot)) {
    const hostRoot = path.join(hostsRoot, hostName);
    const bindingsRoot = path.join(hostRoot, "pod-bindings");
    if (existsSync(bindingsRoot)) {
      for (const podName of readdirSync(bindingsRoot)) {
        const podRoot = path.join(bindingsRoot, podName);
        for (const name of readdirSync(podRoot).filter((entry) => entry.endsWith(".json"))) {
          const file = path.join(podRoot, name);
          const binding = JSON.parse(readFileSync(file, "utf8"));
          binding.receiptDigest = canonicalJsonDigestHex(binding.receipt);
          writeJson(file, binding);
        }
      }
    }
    const operationsRoot = path.join(hostRoot, "pod-operations");
    if (!existsSync(operationsRoot)) continue;
    for (const name of readdirSync(operationsRoot).filter((entry) => entry.endsWith(".json"))) {
      const file = path.join(operationsRoot, name);
      const operation = JSON.parse(readFileSync(file, "utf8"));
      operation.intentDigest = canonicalJsonDigestHex(operation.intent);
      if (operation.receipt) operation.receiptDigest = canonicalJsonDigestHex(operation.receipt);
      if (operation.operationType === "launch") {
        const bindingFile = findJsonFile(
          path.join(bindingsRoot, operation.podId),
          (binding) => binding.windowName === operation.windowName,
        );
        if (bindingFile) {
          const binding = JSON.parse(readFileSync(bindingFile, "utf8"));
          operation.bindingId = binding.bindingId;
          operation.receiptDigest = binding.receiptDigest;
        }
      }
      writeJson(file, operation);
    }
  }
}

let currentOwnerArtifact;
function ownerArtifact() {
  currentOwnerArtifact ??= loadWakeflowHistoricalArtifactIdentity({ host: "codex" });
  return currentOwnerArtifact;
}

let currentClaudeOwnerArtifact;
function claudeOwnerArtifact() {
  currentClaudeOwnerArtifact ??= loadWakeflowHistoricalArtifactIdentity({ host: "claude-code" });
  return currentClaudeOwnerArtifact;
}

function inspect(workspaceRoot, legacyOwnerArtifact = ownerArtifact()) {
  return inspectWakeflowLegacyOwnerDrain({ workspaceRoot, legacyOwnerArtifact });
}

function inspectImport(workspaceRoot, legacyOwnerArtifact = ownerArtifact()) {
  return inspectWakeflowLegacyArchiveImportInventory({ workspaceRoot, legacyOwnerArtifact });
}

function domain(assessment, name) {
  const value = assessment.domains.find((entry) => entry.domain === name);
  assert.ok(value, `missing drain domain ${name}`);
  return value;
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function findJsonFile(directory, predicate) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(directory, name))
    .find((file) => predicate(JSON.parse(readFileSync(file, "utf8")), file));
}

function archiveReviewedTransport(workspaceRoot) {
  return materializeWakeflowRetiredArchiveOutput({
    disposableRoot: path.dirname(workspaceRoot),
    workspaceRoot,
    scenarioId: "transport-result-reviewed",
  }).archiveRef;
}

function archiveClosedPod(workspaceRoot) {
  return materializeWakeflowRetiredArchiveOutput({
    disposableRoot: path.dirname(workspaceRoot),
    workspaceRoot,
    scenarioId: "pod-closed",
  }).archiveRef;
}

function installValidatedLegacyTestAccess(workspaceRoot, ledgerDest) {
  const hostRoot = path.join(
    workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/hosts/codex",
  );
  const bindings = readdirSync(path.join(hostRoot, "pod-bindings/SCENARIO-POD"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(
      path.join(hostRoot, "pod-bindings/SCENARIO-POD", name),
      "utf8",
    )));
  const testBinding = bindings.find((value) => value.role === "test");
  const productBinding = bindings.find((value) => value.role === "product");
  assert.ok(testBinding && productBinding);
  const manifest = JSON.parse(readFileSync(
    path.join(hostRoot, "pod-manifests/SCENARIO-POD.json"),
    "utf8",
  ));
  const bindingSetDigest = canonicalJsonDigestHex({
    test: {
      windowName: testBinding.windowName,
      bindingId: testBinding.bindingId,
      receiptDigest: testBinding.receiptDigest,
    },
    products: [{
      windowName: productBinding.windowName,
      repositoryWindow: productBinding.repositoryWindow,
      bindingId: productBinding.bindingId,
      receiptDigest: productBinding.receiptDigest,
    }],
  });
  const expectedRootDigest = canonicalJsonDigestHex({
    kind: "pod-product-root",
    value: productBinding.receipt.actualCwd,
  });
  const expectedGitTopLevelDigest = canonicalJsonDigestHex({
    kind: "pod-product-git-top-level",
    value: productBinding.receipt.gitTopLevel,
  });
  const probeId = "pod-test-access-owner-drain-validated";
  const planBase = {
    kind: "WakeflowPodTestAccessProbePlan",
    version: 1,
    probeId,
    demandKey: manifest.demandKey,
    podId: manifest.podId,
    host: manifest.host,
    testWindowName: testBinding.windowName,
    testBindingId: testBinding.bindingId,
    bindingSetDigest,
    capabilityUnderTest: "direct-multi-root",
    probeTargets: [{
      windowName: productBinding.windowName,
      repositoryWindow: productBinding.repositoryWindow,
      bindingId: productBinding.bindingId,
      receiptDigest: productBinding.receiptDigest,
      actualRoot: productBinding.receipt.actualCwd,
      expectedRootDigest,
      expectedGitTopLevelDigest,
      expectedHead: productBinding.receipt.head,
    }],
    prohibitedFallbacks: [
      "main-checkout",
      "product-window-as-test",
      "unverified-per-repository-executor",
    ],
  };
  const plan = { ...planBase, planDigest: canonicalJsonDigestHex(planBase) };
  const observedAt = "2026-08-10T00:00:00.000Z";
  const receipt = {
    kind: "WakeflowPodTestAccessProbeReceipt",
    version: 1,
    probeId,
    demandKey: manifest.demandKey,
    podId: manifest.podId,
    host: manifest.host,
    testWindowName: testBinding.windowName,
    testBindingId: testBinding.bindingId,
    bindingSetDigest,
    planDigest: plan.planDigest,
    status: "validated",
    capability: "direct-multi-root",
    productAccess: [{
      windowName: productBinding.windowName,
      repositoryWindow: productBinding.repositoryWindow,
      bindingId: productBinding.bindingId,
      rootDigest: expectedRootDigest,
      gitTopLevelDigest: expectedGitTopLevelDigest,
      head: productBinding.receipt.head,
      readable: true,
      gitIdentityVerified: true,
    }],
    observedAt,
  };
  const planFile = path.join(hostRoot, "pod-test-access-plans", `${probeId}.json`);
  const receiptFile = path.join(hostRoot, "pod-test-access-receipts", `${probeId}.json`);
  writeJson(planFile, plan);
  writeJson(receiptFile, receipt);
  const stateFile = path.join(workspaceRoot, ledgerDest, "wakeflow-state.json");
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  state.podProvisioning.testAccess = {
    probeId,
    status: "validated",
    capability: "direct-multi-root",
    bindingSetDigest,
    planDigest: plan.planDigest,
    productBindingCount: 1,
    receiptDigest: canonicalJsonDigestHex(receipt),
    validatedAt: observedAt,
    updatedAt: observedAt,
  };
  writeJson(stateFile, state);
  return { plan, planFile, receipt, receiptFile };
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

test("M6-T06 exposes one closed read-only owner-drain assessment surface", () => {
  assert.equal(WAKEFLOW_LEGACY_OWNER_DRAIN_KIND, "WakeflowLegacyOwnerDrainAssessment");
  assert.equal(WAKEFLOW_LEGACY_OWNER_DRAIN_SCHEMA_VERSION, 1);
  assert.deepEqual(WAKEFLOW_LEGACY_OWNER_DRAIN_STATUSES, [
    "absent",
    "drain-required",
    "drained",
    "drained-with-host-followup",
    "manual-recovery",
  ]);
  assert.equal(
    WAKEFLOW_LEGACY_ARCHIVE_IMPORT_INVENTORY_KIND,
    "WakeflowLegacyArchiveImportInventory",
  );
  assert.equal(WAKEFLOW_LEGACY_ARCHIVE_IMPORT_INVENTORY_SCHEMA_VERSION, 1);
});

test("static workspace assessment is deterministic, deeply frozen, private, and zero-write", (t) => {
  const fixture = materializeOrigin(t, "codex-0.9.6-70d79d72");
  const before = exactTree(fixture.workspaceRoot);
  const first = inspect(fixture.workspaceRoot);
  const second = inspect(fixture.workspaceRoot);

  assert.deepEqual(second, first);
  assert.deepEqual(validateWakeflowLegacyOwnerDrainAssessment(first), first);
  assert.equal(wakeflowLegacyOwnerDrainAssessmentDigest(first), first.assessmentDigest);
  assert.equal(first.summary.ownerDrainSatisfied, true);
  assert.equal(first.summary.status, "drained");
  assert.ok(first.domains.every((entry) => ["absent", "drained"].includes(entry.status)));
  assertDeepFrozen(first);
  assert.deepEqual(exactTree(fixture.workspaceRoot), before);
  const encoded = JSON.stringify(first);
  assert.equal(encoded.includes(fixture.workspaceRoot), false);
  assert.equal(encoded.includes(REPOSITORY_ROOT), false);
  assert.doesNotMatch(encoded, /(?:threadId|handle|workerPid|childPid|"pid"|token|prompt)/u);

  const imported = inspectImport(fixture.workspaceRoot);
  assert.deepEqual(imported.demands, []);
  assert.deepEqual(validateWakeflowLegacyArchiveImportInventory(imported), imported);
  assert.equal(wakeflowLegacyArchiveImportInventoryDigest(imported), imported.inventoryDigest);
  assertDeepFrozen(imported);
  assert.deepEqual(exactTree(fixture.workspaceRoot), before);
});

test("two observations reject a workspace that changes during owner-drain inspection", async (t) => {
  const fixture = materializeOrigin(t, "codex-0.9.6-70d79d72");
  applyScenario(fixture, "keep-live-terminal");
  const stateFile = path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/hosts/codex/keep-live/state.json",
  );
  const mutator = spawn(process.execPath, [
    "-e",
    [
      "const fs=require('node:fs');",
      "const file=process.argv[1];",
      "const base=JSON.parse(fs.readFileSync(file,'utf8'));",
      "process.stdout.write('ready\\n');",
      "const end=Date.now()+3000;",
      "let counter=0;",
      "while(Date.now()<end){",
      " const temp=file+'.race';",
      " fs.writeFileSync(temp,JSON.stringify({...base,raceCounter:counter++}));",
      " fs.renameSync(temp,file);",
      "}",
    ].join(""),
    stateFile,
  ], { stdio: ["ignore", "pipe", "ignore"] });
  try {
    await once(mutator.stdout, "data");
    assert.throws(
      () => inspect(fixture.workspaceRoot),
      (error) => error instanceof WakeflowLegacyOwnerDrainError
        && error.code === "wakeflow-legacy-owner-drain-stale",
    );
  } finally {
    if (mutator.exitCode === null) {
      mutator.kill("SIGTERM");
      await once(mutator, "exit").catch(() => {});
    }
  }
});

test("active reviewed transport requires its old owner, then checked historical archive bytes close the exact chain", (t) => {
  const fixture = materializeOrigin(t, "codex-0.9.6-70d79d72");
  applyScenario(fixture, "transport-result-reviewed");

  const active = inspect(fixture.workspaceRoot);
  assert.equal(domain(active, "demand-state").status, "drain-required");
  assert.equal(domain(active, "transport").status, "drain-required");
  assert.equal(active.summary.ownerDrainSatisfied, false);
  assert.throws(
    () => inspectImport(fixture.workspaceRoot),
    (error) => error instanceof WakeflowLegacyOwnerDrainError
      && error.code === "wakeflow-legacy-owner-drain-import-blocked",
  );

  const activeStateRoot = path.join(
    fixture.workspaceRoot,
    ".wakeflow-active/current/SCENARIO-TRANSPORT",
  );
  const pendingTransition = path.join(activeStateRoot, "wakeflow-state.pending-transition.json");
  writeJson(pendingTransition, { pending: true });
  const recovering = inspect(fixture.workspaceRoot);
  assert.ok(domain(recovering, "demand-state").blockerCodes.includes("migration-state-recovery-required"));
  rmSync(pendingTransition);

  const ledgerDest = archiveReviewedTransport(fixture.workspaceRoot);
  const drained = inspect(fixture.workspaceRoot);
  assert.equal(domain(drained, "demand-state").status, "drained");
  assert.equal(domain(drained, "transport").status, "drained");
  assert.equal(drained.summary.ownerDrainSatisfied, true);
  const archiveImport = inspectImport(fixture.workspaceRoot);
  assert.equal(archiveImport.demands.length, 1);
  assert.equal(archiveImport.demands[0].transport.sourceStatus, "archived");
  assert.ok(archiveImport.demands[0].transport.groupDigests.length > 0);
  assert.deepEqual(archiveImport.demands[0].legacyEvidenceFacts, []);
  const migrationInventory = inspectWakeflowMigrationInventory({
    workspaceRoot: fixture.workspaceRoot,
  });
  const importSources = archiveImport.demands[0].sourceIds.map((sourceId) => (
    migrationInventory.sources.find((source) => source.sourceId === sourceId)
  ));
  assert.ok(importSources.every(Boolean));
  assert.ok(importSources.some((source) => (
    source.resource.kind === "transport"
    && source.classification?.defaultDisposition.route === "archive-wrap"
  )));
  const omittedArchiveRoot = structuredClone(archiveImport);
  omittedArchiveRoot.demands[0].sourceIds = omittedArchiveRoot.demands[0].sourceIds
    .filter((sourceId) => sourceId !== omittedArchiveRoot.demands[0].archive.archiveSourceId);
  assert.throws(
    () => validateWakeflowLegacyArchiveImportInventory(omittedArchiveRoot),
    (error) => error instanceof WakeflowLegacyOwnerDrainError
      && error.code === "wakeflow-legacy-owner-drain-import-contract",
  );
  assertDeepFrozen(archiveImport);
  const encodedImport = JSON.stringify(archiveImport);
  assert.equal(encodedImport.includes("SCENARIO-TRANSPORT"), false);
  assert.doesNotMatch(encodedImport, /(?:demandKey|windowName|prompt|handle|actualRoot|rootDigest)/u);

  const archivedState = JSON.parse(readFileSync(
    path.join(fixture.workspaceRoot, ledgerDest, "wakeflow-state.json"),
    "utf8",
  ));
  const localResultFile = findJsonFile(
    path.join(fixture.workspaceRoot, ".wakeflow-local/wakeflow-delivery/target-results"),
    (value) => value.kind === "TargetResultEnvelope",
  );
  const localResult = JSON.parse(readFileSync(localResultFile, "utf8"));
  assert.notEqual(
    localResult.resultId,
    archivedState.targetTasks[0].resultId,
    "local and imported results are different artifacts; closure is proved by lineage",
  );

  const runsDir = path.join(fixture.workspaceRoot, ".wakeflow-local/wakeflow-delivery/delivery-runs");
  const targetRunFile = readdirSync(runsDir)
    .map((name) => path.join(runsDir, name))
    .find((file) => JSON.parse(readFileSync(file, "utf8")).deliveryId.startsWith("delivery-"));
  const targetRun = JSON.parse(readFileSync(targetRunFile, "utf8"));
  const rejectedRetry = structuredClone(targetRun);
  rejectedRetry.deliveryRunId = `${targetRun.deliveryRunId}-retry`;
  rejectedRetry.status = "failed";
  rejectedRetry.transportStatus = "rejected-before-send";
  rejectedRetry.readback = {
    checked: false,
    ok: false,
    status: "unavailable",
    attempts: 0,
    evidence: "",
  };
  rejectedRetry.error = "host rejected retry before send";
  rejectedRetry.wakeflowTrace.deliveryRunId = rejectedRetry.deliveryRunId;
  const retryFile = path.join(runsDir, "target-rejected-retry.json");
  writeJson(retryFile, rejectedRetry);
  const retried = inspect(fixture.workspaceRoot);
  assert.equal(domain(retried, "transport").status, "drained");

  rejectedRetry.deliveryId = "delivery-without-envelope";
  rejectedRetry.wakeflowTrace.deliveryId = rejectedRetry.deliveryId;
  writeJson(retryFile, rejectedRetry);
  const orphaned = inspect(fixture.workspaceRoot);
  assert.equal(domain(orphaned, "transport").status, "manual-recovery");
  assert.ok(domain(orphaned, "transport").blockerCodes.includes("migration-transport-run-orphan"));
  rmSync(retryFile);

  targetRun.readback.status = "pending";
  targetRun.readback.ok = false;
  writeFileSync(targetRunFile, `${JSON.stringify(targetRun, null, 2)}\n`);
  const reopened = inspect(fixture.workspaceRoot);
  assert.equal(domain(reopened, "transport").status, "drain-required");
  assert.ok(domain(reopened, "transport").blockerCodes.includes("migration-transport-readback-unconfirmed"));
  assert.equal(lstatSync(path.join(fixture.workspaceRoot, ledgerDest)).isDirectory(), true);
});

test("transport rejects digest drift and archived imported-result lineage drift", (t) => {
  const fixture = materializeOrigin(t, "codex-0.9.6-70d79d72");
  applyScenario(fixture, "transport-result-reviewed");
  const ledgerDest = archiveReviewedTransport(fixture.workspaceRoot);
  const archiveResult = findJsonFile(
    path.join(fixture.workspaceRoot, ledgerDest, "target-results"),
    (value) => value.schemaVersion === 1 && value.currentResult === true,
  );
  const imported = JSON.parse(readFileSync(archiveResult, "utf8"));
  imported.dispatchGroup = "GROUP-WITHOUT-AUTHORITY";
  writeJson(archiveResult, imported);
  const brokenArchive = inspect(fixture.workspaceRoot);
  assert.equal(domain(brokenArchive, "demand-state").status, "manual-recovery");
  assert.ok(domain(brokenArchive, "demand-state").blockerCodes.includes("migration-archive-target-result-invalid"));

  const second = materializeOrigin(t, "codex-0.9.6-70d79d72");
  applyScenario(second, "transport-result-reviewed");
  archiveReviewedTransport(second.workspaceRoot);
  const packetFile = findJsonFile(
    path.join(second.workspaceRoot, ".wakeflow-local/wakeflow-delivery/dispatch-packets"),
    (value) => value.kind === "ControllerDispatchPacket",
  );
  const packet = JSON.parse(readFileSync(packetFile, "utf8"));
  packet.prompt = `${packet.prompt}\nunauthorized digest drift`;
  writeJson(packetFile, packet);
  const digestDrift = inspect(second.workspaceRoot);
  assert.equal(domain(digestDrift, "transport").status, "manual-recovery");
  assert.ok(domain(digestDrift, "transport").blockerCodes.includes("migration-transport-packet-lineage-invalid"));
});

test("archived state rejects ambiguous result identity and revision", (t) => {
  const fixture = materializeOrigin(t, "codex-0.9.6-70d79d72");
  applyScenario(fixture, "transport-result-reviewed");
  const ledgerDest = archiveReviewedTransport(fixture.workspaceRoot);
  const resultsRoot = path.join(fixture.workspaceRoot, ledgerDest, "target-results");
  const currentFile = findJsonFile(
    resultsRoot,
    (value) => value.schemaVersion === 1 && value.currentResult === true,
  );
  const duplicate = JSON.parse(readFileSync(currentFile, "utf8"));
  duplicate.currentResult = false;
  writeJson(path.join(resultsRoot, "duplicate-history.json"), duplicate);

  const assessment = inspect(fixture.workspaceRoot);
  assert.equal(domain(assessment, "demand-state").status, "manual-recovery");
  assert.ok(domain(assessment, "demand-state").blockerCodes.includes(
    "migration-archive-target-result-invalid",
  ));
});

test("legacy archive JSON must be strict UTF-8 bytes", (t) => {
  const fixture = materializeOrigin(t, "codex-0.9.6-70d79d72");
  applyScenario(fixture, "transport-result-reviewed");
  const ledgerDest = archiveReviewedTransport(fixture.workspaceRoot);
  const manifestFile = path.join(fixture.workspaceRoot, ledgerDest, "archive-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  manifest.title = "WAKEFLOW_INVALID_UTF8_MARKER";
  const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8");
  const marker = Buffer.from(manifest.title, "utf8");
  const markerOffset = bytes.indexOf(marker);
  assert.ok(markerOffset >= 0);
  writeFileSync(manifestFile, Buffer.concat([
    bytes.subarray(0, markerOffset),
    Buffer.from([0xc3, 0x28]),
    bytes.subarray(markerOffset + marker.length),
  ]));

  const assessment = inspect(fixture.workspaceRoot);
  assert.equal(domain(assessment, "demand-state").status, "manual-recovery");
  assert.ok(domain(assessment, "demand-state").blockerCodes.includes(
    "migration-archive-contract-invalid",
  ));
});

test("active state requires a contiguous unique controller event log", (t) => {
  const fixture = materializeOrigin(t, "codex-0.9.6-70d79d72");
  applyScenario(fixture, "transport-result-reviewed");
  const eventsFile = path.join(
    fixture.workspaceRoot,
    ".wakeflow-active/current/SCENARIO-TRANSPORT/controller-events.jsonl",
  );
  const events = readFileSync(eventsFile, "utf8").trimEnd().split("\n").map(JSON.parse);
  events[1].stateRevision = events[0].stateRevision;
  writeFileSync(eventsFile, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);

  const assessment = inspect(fixture.workspaceRoot);
  assert.equal(domain(assessment, "demand-state").status, "manual-recovery");
  assert.ok(domain(assessment, "demand-state").blockerCodes.includes(
    "migration-active-demand-contract-invalid",
  ));
});

test("rejected-before-send is terminal, while ambiguous transport remains old-owner work", (t) => {
  const fixture = materializeOrigin(t, "codex-0.9.6-70d79d72");
  applyScenario(fixture, "transport-result-reviewed");
  const ledgerDest = archiveReviewedTransport(fixture.workspaceRoot);
  const transportRoot = path.join(fixture.workspaceRoot, ".wakeflow-local/wakeflow-delivery");

  rmSync(path.join(transportRoot, "target-results"), { recursive: true, force: true });
  rmSync(path.join(fixture.workspaceRoot, ledgerDest, "target-results"), { recursive: true, force: true });
  const envelopeDir = path.join(transportRoot, "delivery-envelopes");
  const controllerReturn = findJsonFile(envelopeDir, (value) => value.kind === "ControllerReturnEnvelope");
  const controllerDeliveryId = JSON.parse(readFileSync(controllerReturn, "utf8")).deliveryId;
  rmSync(controllerReturn);
  const runsDir = path.join(transportRoot, "delivery-runs");
  const controllerRun = findJsonFile(runsDir, (value) => value.deliveryId === controllerDeliveryId);
  rmSync(controllerRun);

  const targetRunFile = findJsonFile(runsDir, (value) => value.kind === "DirectThreadDeliveryRun");
  const targetRun = JSON.parse(readFileSync(targetRunFile, "utf8"));
  Object.assign(targetRun, {
    status: "failed",
    transportStatus: "rejected-before-send",
    error: "host rejected before physical send",
    readback: {
      checked: false,
      ok: false,
      status: "unavailable",
      attempts: 0,
      evidence: "",
    },
  });
  writeJson(targetRunFile, targetRun);

  const stateFile = path.join(fixture.workspaceRoot, ledgerDest, "wakeflow-state.json");
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  state.targetTasks[0].status = "cancelled";
  state.targetTasks[0].reviewDecision = null;
  delete state.targetTasks[0].resultId;
  state.targetTasks[0].delivery.transportStatus = "rejected-before-send";
  state.targetTasks[0].delivery.readbackOk = false;
  state.targetTasks[0].delivery.readbackStatus = "unavailable";
  writeJson(stateFile, state);
  const manifestFile = path.join(fixture.workspaceRoot, ledgerDest, "archive-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  manifest.taskLedger[0].status = "cancelled";
  manifest.taskLedger[0].reviewDecision = null;
  writeJson(manifestFile, manifest);

  const rejected = inspect(fixture.workspaceRoot);
  assert.equal(domain(rejected, "transport").status, "drained");

  targetRun.transportStatus = "ambiguous";
  writeJson(targetRunFile, targetRun);
  const ambiguous = inspect(fixture.workspaceRoot);
  assert.equal(domain(ambiguous, "transport").status, "drain-required");
  assert.ok(domain(ambiguous, "transport").blockerCodes.includes("migration-transport-ambiguous"));
});

test("rejected transport cannot contradict an archived accepted task", (t) => {
  const fixture = materializeOrigin(t, "codex-0.9.6-70d79d72");
  applyScenario(fixture, "transport-result-reviewed");
  archiveReviewedTransport(fixture.workspaceRoot);
  const transportRoot = path.join(fixture.workspaceRoot, ".wakeflow-local/wakeflow-delivery");
  const runsDir = path.join(transportRoot, "delivery-runs");
  const targetRunFile = findJsonFile(
    runsDir,
    (value) => value.kind === "DirectThreadDeliveryRun" && value.deliveryId.startsWith("delivery-"),
  );
  const targetRun = JSON.parse(readFileSync(targetRunFile, "utf8"));
  Object.assign(targetRun, {
    status: "failed",
    transportStatus: "rejected-before-send",
    error: "host rejected before physical send",
    readback: {
      checked: false,
      ok: false,
      status: "unavailable",
      attempts: 0,
      evidence: "",
    },
  });
  writeJson(targetRunFile, targetRun);
  rmSync(path.join(transportRoot, "target-results"), { recursive: true, force: true });

  const assessment = inspect(fixture.workspaceRoot);
  assert.equal(domain(assessment, "transport").status, "manual-recovery");
  assert.ok(domain(assessment, "transport").blockerCodes.includes(
    "migration-transport-run-archive-mismatch",
  ));
});

test("synthetic historical result history is parsed as a chain without restoring its retired writer", (t) => {
  const fixture = materializeOrigin(t, "codex-0.9.6-70d79d72");
  applyScenario(fixture, "transport-result-reviewed");
  const resultsRoot = path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/target-results",
  );
  const currentFile = findJsonFile(resultsRoot, (value) => value.kind === "TargetResultEnvelope");
  const currentRef = path.relative(fixture.workspaceRoot, currentFile).split(path.sep).join("/");
  const revisionOne = JSON.parse(readFileSync(currentFile, "utf8"));
  const revisionOneRef = `${path.posix.dirname(currentRef)}/superseded/revision-1.json`;
  const revisionTwoRef = `${path.posix.dirname(currentRef)}/superseded/revision-2.json`;
  const revisionTwo = {
    ...structuredClone(revisionOne),
    resultId: `${revisionOne.resultId}-r2`,
    resultRevision: 2,
    summary: "synthetic historical correction",
    reportedAt: "2026-08-10T01:00:00.000Z",
    supersedes: {
      archivedResultFile: revisionOneRef,
      resultId: revisionOne.resultId,
      status: revisionOne.status,
      reportedAt: revisionOne.reportedAt,
      supersededAt: "2026-08-10T01:00:00.000Z",
    },
    supersededBy: {
      resultId: `${revisionOne.resultId}-r3`,
      resultFile: currentRef,
      supersededAt: "2026-08-10T02:00:00.000Z",
    },
  };
  revisionOne.supersededBy = {
    resultId: revisionTwo.resultId,
    resultFile: currentRef,
    supersededAt: revisionTwo.supersedes.supersededAt,
  };
  const revisionThree = {
    ...structuredClone(revisionTwo),
    resultId: `${revisionOne.resultId}-r3`,
    resultRevision: 3,
    summary: "synthetic current correction",
    reportedAt: "2026-08-10T02:00:00.000Z",
    supersedes: {
      archivedResultFile: revisionTwoRef,
      resultId: revisionTwo.resultId,
      status: revisionTwo.status,
      reportedAt: revisionTwo.reportedAt,
      supersededAt: revisionTwo.supersededBy.supersededAt,
    },
  };
  delete revisionThree.supersededBy;
  writeJson(path.join(fixture.workspaceRoot, ...revisionOneRef.split("/")), revisionOne);
  writeJson(path.join(fixture.workspaceRoot, ...revisionTwoRef.split("/")), revisionTwo);
  writeJson(currentFile, revisionThree);
  archiveReviewedTransport(fixture.workspaceRoot);
  const assessment = inspect(fixture.workspaceRoot);
  assert.equal(domain(assessment, "transport").status, "drain-required");
  assert.ok(domain(assessment, "transport").blockerCodes.includes("migration-transport-result-not-archived-as-accepted"));
  assert.equal(domain(assessment, "transport").blockerCodes.includes("migration-transport-result-history-invalid"), false);
});

test("retired archive output remains self-contained provenance and current artifacts ship no writer", () => {
  const fixture = inspectWakeflowRetiredWriterFixture();
  assert.equal(fixture.source.executionPolicy, "checked-in-bytes-only-current-writer-retired");
  assert.equal(fixture.source.sourceCommit, "70d79d720d65837a068993006f356e8de91215d4");
  assert.deepEqual(Object.keys(fixture.cases).sort(), ["pod-closed", "transport-result-reviewed"]);
  assert.equal(existsSync(path.join(CODEX_ARTIFACT, fixture.source.writer.ref)), false);
  assert.equal(existsSync(path.join(CLAUDE_ARTIFACT, fixture.source.writer.ref)), false);
});

test("configured active-root forks and archive staging residue fail closed", (t) => {
  const forked = materializeOrigin(t, "codex-0.9.6-70d79d72");
  const configFile = path.join(forked.workspaceRoot, "wakeflow.config.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  config.storage.activeRoot = "fork-active";
  writeJson(configFile, config);
  writeJson(path.join(forked.workspaceRoot, "fork-active/current/UNOWNED/wakeflow-state.json"), { demandKey: "UNOWNED" });
  const divergent = inspect(forked.workspaceRoot);
  assert.equal(domain(divergent, "demand-state").status, "manual-recovery");
  assert.ok(domain(divergent, "demand-state").blockerCodes.includes("migration-active-root-divergence"));
  rmSync(path.join(forked.workspaceRoot, "fork-active"), { recursive: true, force: true });
  mkdirSync(path.join(forked.workspaceRoot, "fork-active"), { recursive: true });
  const emptyFork = inspect(forked.workspaceRoot);
  assert.notEqual(domain(emptyFork, "demand-state").status, "manual-recovery");

  const staging = materializeOrigin(t, "codex-0.9.6-70d79d72");
  writeJson(
    path.join(staging.workspaceRoot, "wakeflow-ledger/workspace/archive/2026-08/STAGED.tmp-1-1/partial.json"),
    { partial: true },
  );
  const staged = inspect(staging.workspaceRoot);
  assert.equal(domain(staged, "demand-state").status, "manual-recovery");
  assert.ok(domain(staged, "demand-state").blockerCodes.includes("migration-archive-staging-residue"));
});

test("keep-live terminal state drains, while a live lease remains owner work", (t) => {
  const fixture = materializeOrigin(t, "codex-0.9.6-70d79d72");
  applyScenario(fixture, "keep-live-terminal");
  const terminal = inspect(fixture.workspaceRoot);
  assert.equal(domain(terminal, "keep-live").status, "drained");

  const stateFile = path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/hosts/codex/keep-live/state.json",
  );
  const controlFile = path.join(path.dirname(stateFile), "control.json");
  writeJson(controlFile, { action: "stop" });
  const corruptControl = inspect(fixture.workspaceRoot);
  assert.equal(domain(corruptControl, "keep-live").status, "manual-recovery");
  assert.ok(domain(corruptControl, "keep-live").blockerCodes.includes(
    "migration-keep-live-contract-invalid",
  ));
  rmSync(controlFile);

  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  Object.assign(state, {
    active: true,
    activeAutomationRunIds: ["run-a"],
    activeRunCount: 1,
    leases: { "run-a": { automationRunId: "run-a" } },
    status: "running",
  });
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  const live = inspect(fixture.workspaceRoot);
  assert.equal(domain(live, "keep-live").status, "drain-required");
  assert.ok(domain(live, "keep-live").blockerCodes.includes("migration-keep-live-lease-active"));

  Object.assign(state, {
    active: false,
    activeAutomationRunIds: [],
    activeRunCount: 0,
    leases: {},
    status: "stopped",
  });
  writeJson(stateFile, state);
  const lockFile = `${stateFile}.lock`;
  writeJson(lockFile, { owner: "legacy-writer" });
  const locked = inspect(fixture.workspaceRoot);
  assert.equal(domain(locked, "keep-live").status, "drain-required");
  assert.ok(domain(locked, "keep-live").blockerCodes.includes("migration-keep-live-lock-active"));
  rmSync(lockFile);

  state.workerPid = "not-a-pid";
  writeJson(stateFile, state);
  const unknownProcess = inspect(fixture.workspaceRoot);
  assert.equal(domain(unknownProcess, "keep-live").status, "manual-recovery");
  assert.ok(domain(unknownProcess, "keep-live").blockerCodes.includes("migration-keep-live-process-unknown"));

  writeFileSync(stateFile, "{not-json\n");
  const corrupt = inspect(fixture.workspaceRoot);
  assert.equal(domain(corrupt, "keep-live").status, "manual-recovery");
  assert.ok(domain(corrupt, "keep-live").blockerCodes.includes("migration-keep-live-contract-invalid"));
});

test("closed legacy stream with a pending merge is not falsely treated as drained", (t) => {
  const fixture = materializeOrigin(t, "claude-code-0.9.6-70d79d72");
  applyScenario(fixture, "legacy-stream-closed");
  const pending = inspect(fixture.workspaceRoot, claudeOwnerArtifact());
  assert.equal(domain(pending, "stream-worktree").status, "drain-required");
  assert.ok(domain(pending, "stream-worktree").blockerCodes.includes("migration-stream-pending-merge"));

  const pendingFile = path.join(fixture.workspaceRoot, "wakeflow-ledger/workspace/pending-merges.md");
  writeFileSync(pendingFile, [
    "# Pending Merges",
    "",
    "> No unresolved legacy branch remains.",
    "",
    "| Closed At | Demand | Repo | Branch | Window |",
    "| --- | --- | --- | --- | --- |",
    "",
  ].join("\n"));
  const closed = inspect(fixture.workspaceRoot, claudeOwnerArtifact());
  assert.equal(domain(closed, "stream-worktree").status, "drained");
});

test("a valid open Pod remains drain-required rather than being mislabeled corrupt", (t) => {
  const fixture = materializeOrigin(t, "codex-0.9.6-70d79d72");
  applyScenario(fixture, "pod-open");
  const assessment = inspect(fixture.workspaceRoot);
  assert.equal(domain(assessment, "pod").status, "drain-required");
  assert.ok(domain(assessment, "pod").blockerCodes.includes("migration-pod-not-closed"));
  assert.equal(domain(assessment, "pod").blockerCodes.includes("migration-pod-window-coverage-invalid"), false);
});

test("closed legacy Test access exports one bounded partial-identity fact without private roots", (t) => {
  const fixture = materializeOrigin(t, "codex-0.9.6-70d79d72");
  applyScenario(fixture, "pod-closed");
  const ledgerDest = archiveClosedPod(fixture.workspaceRoot);
  const installed = installValidatedLegacyTestAccess(fixture.workspaceRoot, ledgerDest);
  const before = exactTree(fixture.workspaceRoot);

  const assessment = inspect(fixture.workspaceRoot);
  assert.equal(domain(assessment, "pod").status, "drained-with-host-followup");
  const inventory = inspectImport(fixture.workspaceRoot);
  assert.deepEqual(
    inventory.demands[0].legacyEvidenceFacts.map((entry) => entry.sourceKind),
    ["pod-close", "pod-materialization", "pod-test-access"],
  );
  const fact = inventory.demands[0].legacyEvidenceFacts[2];
  assert.equal(fact.details.probeType, "direct-multi-root");
  assert.equal(fact.details.probeOutcome, "validated");
  assert.equal(fact.details.targetCount, 1);
  assert.equal(fact.details.legacyIdentityCoverage, "partial");
  assert.equal(fact.details.observedAt, installed.receipt.observedAt);
  assert.equal(fact.details.recordedAt, null);
  assert.equal(fact.details.planDigest, sha256(readFileSync(installed.planFile)));
  assert.equal(fact.details.receiptDigest, sha256(readFileSync(installed.receiptFile)));
  const migrationInventory = inspectWakeflowMigrationInventory({
    workspaceRoot: fixture.workspaceRoot,
  });
  const importSources = inventory.demands[0].sourceIds.map((sourceId) => (
    migrationInventory.sources.find((source) => source.sourceId === sourceId)
  ));
  assert.ok(importSources.every(Boolean));
  assert.ok(importSources.some((source) => (
    source.resource.kind === "pod"
    && source.classification?.defaultDisposition.route === "archive-wrap"
  )));
  const encoded = JSON.stringify(inventory);
  assert.equal(encoded.includes(installed.plan.probeId), false);
  assert.equal(encoded.includes(installed.plan.probeTargets[0].actualRoot), false);
  assert.doesNotMatch(encoded, /(?:rootDigest|gitTopLevelDigest|expectedHead|repositoryWindow|windowName)/u);
  assertDeepFrozen(inventory);
  assert.deepEqual(exactTree(fixture.workspaceRoot), before);

  const corrupted = structuredClone(installed.receipt);
  corrupted.productAccess[0].rootDigest = "0".repeat(64);
  writeJson(installed.receiptFile, corrupted);
  assert.throws(
    () => inspectImport(fixture.workspaceRoot),
    (error) => error instanceof WakeflowLegacyOwnerDrainError
      && error.code === "wakeflow-legacy-owner-drain-import-blocked",
  );
});

test("Pod logical close needs archive; retained worktree becomes an exact T07 follow-up", (t) => {
  const fixture = materializeOrigin(t, "codex-0.9.6-70d79d72");
  applyScenario(fixture, "pod-closed");
  const unarchived = inspect(fixture.workspaceRoot);
  assert.equal(domain(unarchived, "demand-state").status, "drain-required");
  assert.equal(domain(unarchived, "pod").status, "drain-required");

  const ledgerDest = archiveClosedPod(fixture.workspaceRoot);
  const archived = inspect(fixture.workspaceRoot);
  assert.equal(domain(archived, "demand-state").status, "drained");
  assert.equal(domain(archived, "pod").status, "drained-with-host-followup");
  assert.equal(archived.summary.ownerDrainSatisfied, true);
  assert.equal(archived.summary.status, "drained-with-host-followup");
  assert.ok(domain(archived, "pod").blockerCodes.includes("migration-pod-host-resource-followup-required"));
  const archiveImport = inspectImport(fixture.workspaceRoot);
  assert.equal(archiveImport.demands.length, 1);
  assert.deepEqual(
    archiveImport.demands[0].legacyEvidenceFacts.map((entry) => entry.sourceKind),
    ["pod-close", "pod-materialization"],
  );
  assert.equal(
    archiveImport.demands[0].legacyEvidenceFacts[0].details.resourceCoverage,
    "host-followup",
  );
  assert.equal(
    archiveImport.demands[0].legacyEvidenceFacts[1].details.historyComplete,
    false,
  );
  assert.equal(JSON.stringify(archiveImport).includes("SCENARIO-POD"), false);
  assertDeepFrozen(archiveImport);

  const hostRoot = path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/hosts/codex",
  );
  const podLock = path.join(hostRoot, "pod-operations.lock");
  writeJson(podLock, { owner: "legacy-pod-writer" });
  const locked = inspect(fixture.workspaceRoot);
  assert.equal(domain(locked, "pod").status, "drain-required");
  assert.ok(domain(locked, "pod").blockerCodes.includes("migration-pod-lock-active"));
  rmSync(podLock);

  const bindingDir = path.join(hostRoot, "pod-bindings/SCENARIO-POD");
  const bindingValues = readdirSync(bindingDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(path.join(bindingDir, name), "utf8")));
  const testBinding = bindingValues.find((value) => value.role === "test");
  const productBinding = bindingValues.find((value) => value.role === "product");
  assert.ok(testBinding && productBinding);
  const manifest = JSON.parse(readFileSync(
    path.join(hostRoot, "pod-manifests/SCENARIO-POD.json"),
    "utf8",
  ));
  const bindingSetDigest = canonicalJsonDigestHex({
    test: {
      windowName: testBinding.windowName,
      bindingId: testBinding.bindingId,
      receiptDigest: testBinding.receiptDigest,
    },
    products: [{
      windowName: productBinding.windowName,
      repositoryWindow: productBinding.repositoryWindow,
      bindingId: productBinding.bindingId,
      receiptDigest: productBinding.receiptDigest,
    }],
  });
  const probeId = "pod-test-access-owner-drain-fixture";
  const planBase = {
    kind: "WakeflowPodTestAccessProbePlan",
    version: 1,
    probeId,
    demandKey: manifest.demandKey,
    podId: manifest.podId,
    host: manifest.host,
    testWindowName: testBinding.windowName,
    testBindingId: testBinding.bindingId,
    bindingSetDigest,
    capabilityUnderTest: "direct-multi-root",
    probeTargets: [{
      windowName: productBinding.windowName,
      repositoryWindow: productBinding.repositoryWindow,
      bindingId: productBinding.bindingId,
      receiptDigest: productBinding.receiptDigest,
      actualRoot: productBinding.receipt.actualCwd,
      expectedRootDigest: canonicalJsonDigestHex({
        kind: "pod-product-root",
        value: productBinding.receipt.actualCwd,
      }),
      expectedGitTopLevelDigest: canonicalJsonDigestHex({
        kind: "pod-product-git-top-level",
        value: productBinding.receipt.gitTopLevel,
      }),
      expectedHead: productBinding.receipt.head,
    }],
    prohibitedFallbacks: ["main-checkout"],
  };
  const plan = { ...planBase, planDigest: canonicalJsonDigestHex(planBase) };
  const planFile = path.join(hostRoot, "pod-test-access-plans", `${probeId}.json`);
  writeJson(planFile, plan);
  const archivedStateFile = path.join(fixture.workspaceRoot, ledgerDest, "wakeflow-state.json");
  const archivedState = JSON.parse(readFileSync(archivedStateFile, "utf8"));
  archivedState.podProvisioning.testAccess = {
    probeId,
    status: "pending",
    capability: "pending",
    bindingSetDigest,
    planDigest: plan.planDigest,
    productBindingCount: 1,
    updatedAt: "2026-08-10T00:00:00.000Z",
  };
  writeJson(archivedStateFile, archivedState);
  const pendingAccess = inspect(fixture.workspaceRoot);
  assert.equal(domain(pendingAccess, "pod").status, "drain-required");
  assert.ok(domain(pendingAccess, "pod").blockerCodes.includes("migration-pod-test-access-pending"));
  rmSync(planFile);
  delete archivedState.podProvisioning.testAccess;
  writeJson(archivedStateFile, archivedState);

  const operationsDir = path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/hosts/codex/pod-operations",
  );
  const closeFile = readdirSync(operationsDir)
    .find((name) => JSON.parse(readFileSync(path.join(operationsDir, name), "utf8")).operationType === "close");
  rmSync(path.join(operationsDir, closeFile));
  const corrupt = inspect(fixture.workspaceRoot);
  assert.equal(domain(corrupt, "pod").status, "manual-recovery");
});

test("closed Pod must match the exact archived window membership", (t) => {
  const fixture = materializeOrigin(t, "codex-0.9.6-70d79d72");
  applyScenario(fixture, "pod-closed");
  const ledgerDest = archiveClosedPod(fixture.workspaceRoot);
  const stateFile = path.join(fixture.workspaceRoot, ledgerDest, "wakeflow-state.json");
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  state.podProvisioning.windows[0].launchCorrelationId = "pod-launch-not-in-manifest";
  writeJson(stateFile, state);

  const assessment = inspect(fixture.workspaceRoot);
  assert.equal(domain(assessment, "pod").status, "manual-recovery");
  assert.ok(domain(assessment, "pod").blockerCodes.includes(
    "migration-pod-archive-state-mismatch",
  ));
});

test("Pod owner drain rederives launch, binding, and close record digests", (t) => {
  const launchFixture = materializeOrigin(t, "codex-0.9.6-70d79d72");
  applyScenario(launchFixture, "pod-closed");
  archiveClosedPod(launchFixture.workspaceRoot);
  const launchOperations = path.join(
    launchFixture.workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/hosts/codex/pod-operations",
  );
  const launchFile = findJsonFile(
    launchOperations,
    (operation) => operation.operationType === "launch",
  );
  const launch = JSON.parse(readFileSync(launchFile, "utf8"));
  launch.intentDigest = "0".repeat(64);
  writeJson(launchFile, launch);
  const invalidLaunch = inspect(launchFixture.workspaceRoot);
  assert.equal(domain(invalidLaunch, "pod").status, "manual-recovery");
  assert.ok(domain(invalidLaunch, "pod").blockerCodes.includes(
    "migration-pod-launch-chain-invalid",
  ));

  const bindingFixture = materializeOrigin(t, "codex-0.9.6-70d79d72");
  applyScenario(bindingFixture, "pod-closed");
  archiveClosedPod(bindingFixture.workspaceRoot);
  const bindingRoot = path.join(
    bindingFixture.workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/hosts/codex/pod-bindings/SCENARIO-POD",
  );
  const bindingFile = findJsonFile(bindingRoot, (binding) => binding.role === "product");
  const binding = JSON.parse(readFileSync(bindingFile, "utf8"));
  binding.receiptDigest = "1".repeat(64);
  writeJson(bindingFile, binding);
  const bindingOperations = path.join(
    bindingFixture.workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/hosts/codex/pod-operations",
  );
  const boundLaunchFile = findJsonFile(
    bindingOperations,
    (operation) => operation.operationId === binding.launchCorrelationId,
  );
  const boundLaunch = JSON.parse(readFileSync(boundLaunchFile, "utf8"));
  boundLaunch.receiptDigest = binding.receiptDigest;
  writeJson(boundLaunchFile, boundLaunch);
  const invalidBinding = inspect(bindingFixture.workspaceRoot);
  assert.equal(domain(invalidBinding, "pod").status, "manual-recovery");
  assert.ok(domain(invalidBinding, "pod").blockerCodes.includes(
    "migration-pod-binding-lifecycle-invalid",
  ));

  const closeFixture = materializeOrigin(t, "codex-0.9.6-70d79d72");
  applyScenario(closeFixture, "pod-closed");
  archiveClosedPod(closeFixture.workspaceRoot);
  const closeOperations = path.join(
    closeFixture.workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/hosts/codex/pod-operations",
  );
  const closeFile = findJsonFile(
    closeOperations,
    (operation) => operation.operationType === "close",
  );
  const close = JSON.parse(readFileSync(closeFile, "utf8"));
  close.receiptDigest = "2".repeat(64);
  writeJson(closeFile, close);
  const invalidClose = inspect(closeFixture.workspaceRoot);
  assert.equal(domain(invalidClose, "pod").status, "manual-recovery");
  assert.ok(domain(invalidClose, "pod").blockerCodes.includes(
    "migration-pod-close-chain-invalid",
  ));
});

test("archive import rejects a multiply-linked legacy archive member", (t) => {
  const fixture = materializeOrigin(t, "codex-0.9.6-70d79d72");
  applyScenario(fixture, "pod-closed");
  const ledgerDest = archiveClosedPod(fixture.workspaceRoot);
  const stateFile = path.join(fixture.workspaceRoot, ledgerDest, "wakeflow-state.json");
  linkSync(stateFile, path.join(fixture.workspaceRoot, ledgerDest, "state-hardlink-copy.bin"));

  const assessment = inspect(fixture.workspaceRoot);
  assert.equal(domain(assessment, "demand-state").status, "manual-recovery");
  assert.ok(domain(assessment, "demand-state").blockerCodes.includes(
    "migration-source-multiple-links",
  ));
  assert.throws(
    () => inspectImport(fixture.workspaceRoot),
    (error) => error instanceof WakeflowLegacyOwnerDrainError
      && error.code === "wakeflow-legacy-owner-drain-import-blocked",
  );
});

test("missing exact owner capability and re-signed assessment tampering fail closed", (t) => {
  const fixture = materializeOrigin(t, "codex-0.9.6-70d79d72");
  applyScenario(fixture, "transport-result-reviewed");
  const artifactRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-owner-drain-incapable-"));
  t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));
  writeFileSync(path.join(artifactRoot, "package.json"), "{}\n");
  const incapable = inspectWakeflowArtifactTree({ artifactRoot });
  const assessment = inspect(fixture.workspaceRoot, incapable);
  assert.equal(domain(assessment, "demand-state").status, "manual-recovery");
  assert.ok(domain(assessment, "demand-state").blockerCodes.includes("migration-legacy-owner-capability-missing"));

  const tampered = structuredClone(assessment);
  tampered.domains.find((entry) => entry.domain === "demand-state").status = "drained";
  tampered.domains.find((entry) => entry.domain === "demand-state").blockerCodes = [];
  tampered.summary.status = "drained";
  tampered.summary.ownerDrainSatisfied = true;
  tampered.assessmentDigest = canonicalJsonDigest({
    artifactKind: tampered.artifactKind,
    artifact: tampered.artifact,
    domains: tampered.domains,
    inventory: tampered.inventory,
    schemaVersion: tampered.schemaVersion,
    summary: tampered.summary,
  });
  assert.throws(
    () => validateWakeflowLegacyOwnerDrainAssessment(tampered),
    (error) => error instanceof WakeflowLegacyOwnerDrainError,
  );
});

test("archive import validation rejects private or semantic fields without echoing their values", (t) => {
  const fixture = materializeOrigin(t, "codex-0.9.6-70d79d72");
  const inventory = structuredClone(inspectImport(fixture.workspaceRoot));
  const secret = "/Users/private/legacy-window";
  inventory.demands.push({ windowName: secret });
  let captured = null;
  try {
    validateWakeflowLegacyArchiveImportInventory(inventory);
  } catch (error) {
    captured = error;
  }
  assert.equal(captured instanceof WakeflowLegacyOwnerDrainError, true);
  assert.equal(captured.code, "wakeflow-legacy-owner-drain-import-privacy");
  assert.equal(JSON.stringify({
    code: captured.code,
    message: captured.message,
    details: captured.details,
  }).includes(secret), false);
});

test("assessment rejects caller evidence overrides and artifact digest mismatch", (t) => {
  const fixture = materializeOrigin(t, "codex-0.9.6-70d79d72");
  assert.throws(
    () => inspectWakeflowLegacyOwnerDrain({
      workspaceRoot: fixture.workspaceRoot,
      legacyOwnerArtifact: ownerArtifact(),
      drained: true,
    }),
    (error) => error instanceof WakeflowLegacyOwnerDrainError
      && error.code === "wakeflow-legacy-owner-drain-input",
  );
  const tamperedArtifact = structuredClone(ownerArtifact());
  tamperedArtifact.artifactDigest = `sha256:${"0".repeat(64)}`;
  assert.throws(
    () => inspect(fixture.workspaceRoot, tamperedArtifact),
    (error) => error instanceof WakeflowLegacyOwnerDrainError
      && error.code === "wakeflow-legacy-owner-drain-artifact",
  );
});
