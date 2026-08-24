import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hostProfile as claudeProfile } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import { hostProfile as codexProfile } from "../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import { parseWakeflowConfigV3 } from "../core/scripts/lib/wakeflow-config-v3.mjs";
import { createWakeflowLayoutDescriptor } from "../core/scripts/lib/wakeflow-layout-descriptor.mjs";
import { planWakeflowLocalLayout } from "../core/scripts/lib/wakeflow-local-layout.mjs";
import {
  createKeepLiveControlRecord,
  createKeepLiveLeaseRecord,
  createKeepLiveProcessRecord,
  keepLiveControlCanonicalBytes,
  keepLiveLeaseCanonicalBytes,
  keepLiveProcessCanonicalBytes,
} from "../core/scripts/lib/wakeflow-keep-live-records.mjs";
import {
  createPodLaunchIntentRecord,
  createPodScopeRecord,
  podRecordCanonicalBytes,
  podRecordDigest,
  podRecordRef,
  WAKEFLOW_POD_LAUNCH_INTENT_KIND,
  WAKEFLOW_POD_SCOPE_KIND,
} from "../core/scripts/lib/wakeflow-pod-records.mjs";
import {
  createDispatchGroupRecord,
  dispatchGroupCanonicalBytes,
} from "../core/scripts/lib/wakeflow-transport-records.mjs";
import {
  createWindowBindingRecord,
  windowBindingCanonicalBytes,
} from "../core/scripts/lib/wakeflow-window-binding-records.mjs";
import {
  recoverWakeflowWorkspaceMutation,
  runWakeflowMaintenanceMutation,
  withWakeflowRuntimeMutation,
} from "../core/scripts/lib/wakeflow-workspace-mutation.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureFile = path.join(repositoryRoot, "test/fixtures/wakeflow-config-v3/valid-minimal.json");
const realizationFile = path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-local-layout-realization.mjs",
);
const realizationUrl = pathToFileURL(realizationFile).href;

const PROTOCOL_PROVIDED_REFS = Object.freeze([
  ".wakeflow-local",
  ".wakeflow-local/runtime",
  ".wakeflow-local/runtime/maintenance",
  ".wakeflow-local/runtime/maintenance/transactions",
]);

function fixture() {
  return JSON.parse(readFileSync(fixtureFile, "utf8"));
}

function buildInput(hostProfile) {
  const model = parseWakeflowConfigV3(fixture());
  return {
    model,
    layoutDescriptor: createWakeflowLayoutDescriptor({ model, hostProfile }),
    hostProfile,
  };
}

async function realization() {
  return import(realizationUrl);
}

function withTempWorkspace(t, prefix) {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(workspaceRoot, { force: true, recursive: true }));
  return workspaceRoot;
}

function modeString(stat) {
  return `0${(stat.mode & 0o777).toString(8).padStart(3, "0")}`;
}

function portablePath(workspaceRoot, ref) {
  assert.equal(path.posix.isAbsolute(ref), false, "test fixture refs must stay portable");
  assert.equal(ref.includes("\\"), false, "test fixture refs must use POSIX separators");
  const absolute = path.resolve(workspaceRoot, ...ref.split("/"));
  assert.ok(
    absolute.startsWith(`${path.resolve(workspaceRoot)}${path.sep}`),
    `${ref} escaped its test workspace`,
  );
  return absolute;
}

function snapshotTree(workspaceRoot) {
  const result = [];
  const visit = (directory, relativeBase = "") => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const ref = relativeBase ? `${relativeBase}/${name}` : name;
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        result.push({ ref, type: "symlink", mode: modeString(stat), target: readlinkSync(absolute) });
      } else if (stat.isDirectory()) {
        result.push({ ref, type: "directory", mode: modeString(stat) });
        visit(absolute, ref);
      } else if (stat.isFile()) {
        result.push({
          ref,
          type: "file",
          mode: modeString(stat),
          bytes: readFileSync(absolute).toString("base64"),
        });
      } else {
        result.push({ ref, type: "other", mode: modeString(stat) });
      }
    }
  };
  visit(workspaceRoot);
  return result;
}

function createPrivateDirectory(workspaceRoot, ref) {
  const absolute = portablePath(workspaceRoot, ref);
  mkdirSync(absolute, { recursive: true, mode: 0o700 });
  chmodSync(absolute, 0o700);
}

function writePrivatePodRecord(workspaceRoot, record) {
  const ref = podRecordRef(record);
  createPrivateDirectory(workspaceRoot, path.posix.dirname(ref));
  writeFileSync(portablePath(workspaceRoot, ref), podRecordCanonicalBytes(record), { mode: 0o600 });
  chmodSync(portablePath(workspaceRoot, ref), 0o600);
  return ref;
}

function itemRef(item) {
  const ref = item.ref ?? item.path;
  if (typeof ref === "string") {
    assert.equal(path.posix.isAbsolute(ref), false, `${ref} must be portable`);
    return ref;
  }
  assert.equal(item.path, null, "redacted inventory items must not retain a raw path");
  assert.match(item.pathDigest, /^sha256:[0-9a-f]{64}$/u);
  return item.pathDigest;
}

function inventoryItems(inspection) {
  return Object.values(inspection.items).flat();
}

function assertInspectionShape(inspection, { workspaceRoot, desiredPlan, staticCount }) {
  assert.equal(inspection.kind, "WakeflowLocalLayoutInspection");
  assert.equal(inspection.schemaVersion, 1);
  assert.equal(inspection.layoutPlanDigest, desiredPlan.planDigest);
  assert.match(inspection.inspectionDigest, /^sha256:[0-9a-f]{64}$/u);
  const { inspectionDigest, ...unsigned } = inspection;
  assert.equal(inspectionDigest, canonicalJsonDigest(unsigned));
  assert.equal(Object.isFrozen(inspection), true);
  for (const partition of [
    "staticDirectories",
    "managedFiles",
    "initialProjections",
    "events",
    "boundaries",
  ]) {
    assert.ok(Array.isArray(inspection.items?.[partition]), `missing ${partition} inventory partition`);
  }
  assert.equal(inspection.items.staticDirectories.length, staticCount);
  for (const item of inventoryItems(inspection)) itemRef(item);
  const serialized = canonicalJson(inspection);
  assert.equal(serialized.includes(workspaceRoot), false, "inspection must not leak its absolute workspace path");
  assert.equal(serialized.includes("/var/folders/"), false);
  assert.equal(serialized.includes("/tmp/"), false);
}

function protocolProvidedRefs(plan) {
  return plan.payload.protocolProvided.map((entry) => {
    if (typeof entry === "string") return entry;
    assert.equal(
      entry.classification ?? entry.status ?? entry.disposition,
      "protocol-provided",
      "protocol bootstrap entries must remain visibly protocol-provided",
    );
    return entry.ref ?? entry.path;
  });
}

function assertT02DirectoryStep(step, ordinal, protocolProvided) {
  assert.deepEqual(Object.keys(step).sort(), [
    "final",
    "ordinal",
    "source",
    "staging",
    "stepId",
    "stepKind",
  ]);
  assert.equal(step.ordinal, ordinal);
  assert.match(step.stepId, /^[a-z][a-z0-9-]{0,127}$/u);
  assert.equal(step.stepKind, "create-or-update");
  assert.equal(step.source.type, "absent");
  assert.deepEqual(Object.keys(step.source).sort(), ["ref", "type"]);
  assert.equal(step.staging, null);
  assert.deepEqual(step.final, {
    ref: step.source.ref,
    type: "directory",
    mode: "0700",
    digest: step.final.digest,
  });
  assert.match(step.final.digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(protocolProvided.has(step.final.ref), false, "gate bootstrap cannot be a domain step");
}

function assertRealizationPlan(plan, { action, desiredPlan }) {
  assert.equal(plan.schemaId, "urn:wakeflow:internal:local-layout-realization-plan:v1");
  assert.equal(plan.payload.kind, "WakeflowLocalLayoutRealizationPlan");
  assert.equal(plan.payload.schemaVersion, 1);
  assert.equal(plan.payload.action, action);
  assert.equal(plan.payload.layoutPlanDigest, desiredPlan.planDigest);
  assert.match(plan.payload.structuralInventoryDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.ok(Array.isArray(plan.payload.protocolProvided));
  assert.ok(Array.isArray(plan.payload.steps));
  assert.ok(Array.isArray(plan.payload.blockers));
  const refs = protocolProvidedRefs(plan);
  assert.deepEqual(refs, PROTOCOL_PROVIDED_REFS);
  const protocolProvided = new Set(refs);
  plan.payload.steps.forEach((step, ordinal) => assertT02DirectoryStep(step, ordinal, protocolProvided));
  assert.equal(Object.isFrozen(plan), true);
}

async function applyLocalLayout(workspaceRoot, input, action) {
  const {
    createWakeflowLocalLayoutMutationParticipant,
    planWakeflowLocalLayoutRealization,
  } = await realization();
  const confirmedPlan = planWakeflowLocalLayoutRealization({ workspaceRoot, action, ...input });
  const participant = createWakeflowLocalLayoutMutationParticipant({
    workspaceRoot,
    confirmedPlan,
    ...input,
  });
  const result = await runWakeflowMaintenanceMutation({
    workspaceRoot,
    action,
    operationKind: "local-layout-realization",
    domainOwner: "layout-manager",
    confirmedPlan,
    planDigest: canonicalJsonDigest(confirmedPlan),
    validatePlan: participant.validatePlan,
    deriveCurrentPlan: participant.deriveCurrentPlan,
    deriveTerminalClosure: participant.deriveTerminalClosure,
    stepHandlers: participant.stepHandlers,
  });
  return { confirmedPlan, participant, result };
}

function actualEvent(inspection, key, classification = null) {
  return inspection.items.events.find((item) => (
    Array.isArray(item.matchedKeys)
    && item.matchedKeys.includes(key)
    && (classification === null || item.classification === classification)
  ));
}

test("T01b inspects absent Codex and Claude local layouts without writing", async (t) => {
  const { inspectWakeflowLocalLayout } = await realization();
  for (const [hostProfile, expected] of [
    [codexProfile, { staticCount: 22, managedCount: 0, eventCount: 34 }],
    [claudeProfile, { staticCount: 27, managedCount: 1, eventCount: 39 }],
  ]) {
    await t.test(hostProfile.hostId, (subtest) => {
      const workspaceRoot = withTempWorkspace(subtest, `wakeflow-layout-inspect-${hostProfile.hostId}-`);
      const input = buildInput(hostProfile);
      const desiredPlan = planWakeflowLocalLayout(input);
      const before = snapshotTree(workspaceRoot);
      const inspection = inspectWakeflowLocalLayout({ workspaceRoot, ...input });

      assertInspectionShape(inspection, { workspaceRoot, desiredPlan, staticCount: expected.staticCount });
      assert.equal(inspection.overall, "drift");
      assert.equal(
        inspection.items.staticDirectories.every((entry) => entry.classification === "missing"),
        true,
      );
      assert.equal(inspection.items.managedFiles.length, expected.managedCount);
      assert.equal(
        inspection.items.managedFiles.every((entry) => entry.classification === "delegated-missing"),
        true,
      );
      assert.equal(inspection.items.initialProjections.length, 4);
      assert.equal(
        inspection.items.initialProjections.every((entry) => entry.classification === "delegated-missing"),
        true,
      );
      assert.equal(inspection.items.events.length, expected.eventCount);
      assert.equal(
        inspection.items.events.some((entry) => ["current", "materialized"].includes(entry.classification)),
        false,
      );
      assert.deepEqual(inspection.items.boundaries, []);
      assert.deepEqual(snapshotTree(workspaceRoot), before, "read-only inspection created local residue");
    });
  }
});

test("T01b admits host event inspectors and their inventories only through explicit data contracts", async (t) => {
  const { inspectWakeflowLocalLayout } = await realization();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-layout-host-inspector-contract-");
  const input = buildInput(claudeProfile);

  const accessorProfile = { ...claudeProfile };
  let facadeGetterCalls = 0;
  Object.defineProperty(accessorProfile, "localEventInspectors", {
    enumerable: true,
    get() {
      facadeGetterCalls += 1;
      return claudeProfile.localEventInspectors;
    },
  });
  assert.throws(
    () => inspectWakeflowLocalLayout({ workspaceRoot, ...input, hostProfile: accessorProfile }),
    (error) => error?.code === "wakeflow-local-inspection-host-profile",
  );
  assert.equal(facadeGetterCalls, 0, "inspector facade admission must not execute a getter");

  await applyLocalLayout(workspaceRoot, input, "fresh-initialize");
  const windowId = input.model.topology.windows[0].windowId;
  const locatorRef = `.wakeflow-local/runtime/hosts/claude-code/operations/window-locators/${windowId}.json`;
  writeFileSync(portablePath(workspaceRoot, locatorRef), "{}\n", { mode: 0o600 });
  chmodSync(portablePath(workspaceRoot, locatorRef), 0o600);
  const before = snapshotTree(workspaceRoot);

  let inventoryGetterCalls = 0;
  const resultAccessorProfile = {
    ...claudeProfile,
    localEventInspectors: {
      activityTemp: claudeProfile.localEventInspectors.activityTemp,
      locator() {
        const inventory = {};
        Object.defineProperty(inventory, "entries", {
          enumerable: true,
          get() {
            inventoryGetterCalls += 1;
            return [];
          },
        });
        return inventory;
      },
    },
  };
  const inspection = inspectWakeflowLocalLayout({
    workspaceRoot,
    ...input,
    hostProfile: resultAccessorProfile,
  });
  const locator = actualEvent(inspection, "event.host.locator", "owner-validator-invalid");
  assert.equal(locator?.ownerValidationCode, "wakeflow-host-locator-inventory");
  assert.equal(inventoryGetterCalls, 0, "inventory admission must not execute a getter");
  assert.deepEqual(snapshotTree(workspaceRoot), before, "rejected host inventory cannot mutate the workspace");
});

test("T01b fresh realization creates exactly 22/27 private static directories", async (t) => {
  const {
    createWakeflowLocalLayoutMutationParticipant,
    inspectWakeflowLocalLayout,
    planWakeflowLocalLayoutRealization,
  } = await realization();

  for (const [hostProfile, staticCount] of [
    [codexProfile, 22],
    [claudeProfile, 27],
  ]) {
    await t.test(hostProfile.hostId, async (subtest) => {
      const workspaceRoot = withTempWorkspace(subtest, `wakeflow-layout-fresh-${hostProfile.hostId}-`);
      const input = buildInput(hostProfile);
      const desiredPlan = planWakeflowLocalLayout(input);
      const confirmedPlan = planWakeflowLocalLayoutRealization({
        workspaceRoot,
        action: "fresh-initialize",
        ...input,
      });
      assertRealizationPlan(confirmedPlan, { action: "fresh-initialize", desiredPlan });
      assert.deepEqual(confirmedPlan.payload.blockers, []);
      assert.ok(confirmedPlan.payload.steps.length > 0);

      const delegatedRefs = new Set([
        ...desiredPlan.managedFiles,
        ...desiredPlan.initialProjections,
        ...desiredPlan.deferredEventPatterns,
      ].map((entry) => entry.path));
      for (const step of confirmedPlan.payload.steps) {
        assert.equal(delegatedRefs.has(step.final.ref), false, `${step.final.ref} belongs to another owner`);
        assert.equal(step.final.ref.includes("{"), false, "event placeholders cannot become fresh steps");
      }

      const participant = createWakeflowLocalLayoutMutationParticipant({
        workspaceRoot,
        confirmedPlan,
        ...input,
      });
      for (const callback of [
        "validatePlan",
        "deriveCurrentPlan",
        "deriveTerminalClosure",
      ]) assert.equal(typeof participant[callback], "function", `participant missing ${callback}`);
      assert.equal(typeof participant.stepHandlers, "object");

      const result = await runWakeflowMaintenanceMutation({
        workspaceRoot,
        action: "fresh-initialize",
        operationKind: "local-layout-realization",
        domainOwner: "layout-manager",
        confirmedPlan,
        planDigest: canonicalJsonDigest(confirmedPlan),
        validatePlan: participant.validatePlan,
        deriveCurrentPlan: participant.deriveCurrentPlan,
        deriveTerminalClosure: participant.deriveTerminalClosure,
        stepHandlers: participant.stepHandlers,
      });
      assert.equal(result.status, "completed");

      const actual = snapshotTree(workspaceRoot);
      const actualRefs = actual.map((entry) => entry.ref).sort();
      const expectedRefs = desiredPlan.staticDirectories.map((entry) => entry.path).sort();
      assert.equal(expectedRefs.length, staticCount);
      assert.deepEqual(actualRefs, expectedRefs, "fresh realization created a non-static placeholder or omitted a root");
      assert.equal(actual.every((entry) => entry.type === "directory" && entry.mode === "0700"), true);
      for (const entry of [...desiredPlan.managedFiles, ...desiredPlan.initialProjections]) {
        assert.equal(existsSync(portablePath(workspaceRoot, entry.path)), false, `${entry.path} must stay delegated`);
      }

      const inspection = inspectWakeflowLocalLayout({ workspaceRoot, ...input });
      assertInspectionShape(inspection, { workspaceRoot, desiredPlan, staticCount });
      assert.equal(
        inspection.items.staticDirectories.every((entry) => entry.classification === "current"),
        true,
      );
      const rerun = planWakeflowLocalLayoutRealization({
        workspaceRoot,
        action: "reconcile",
        ...input,
      });
      assert.deepEqual(rerun.payload.blockers, []);
      assert.deepEqual(rerun.payload.steps, []);
      assert.deepEqual(
        readdirSync(portablePath(workspaceRoot, ".wakeflow-local/runtime/maintenance/transactions")),
        [],
        "healthy completion must not leave a journal",
      );
    });
  }
});

test("T01b normalizes the four T02 bootstrap roots as stable protocol-provided facts", async (t) => {
  const { inspectWakeflowLocalLayout, planWakeflowLocalLayoutRealization } = await realization();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-layout-protocol-stability-");
  const input = buildInput(codexProfile);
  const desiredPlan = planWakeflowLocalLayout(input);
  const absentInspection = inspectWakeflowLocalLayout({ workspaceRoot, ...input });
  const absentPlan = planWakeflowLocalLayoutRealization({
    workspaceRoot,
    action: "fresh-initialize",
    ...input,
  });
  assertRealizationPlan(absentPlan, { action: "fresh-initialize", desiredPlan });

  for (const ref of PROTOCOL_PROVIDED_REFS) createPrivateDirectory(workspaceRoot, ref);
  const bootstrappedInspection = inspectWakeflowLocalLayout({ workspaceRoot, ...input });
  const bootstrappedPlan = planWakeflowLocalLayoutRealization({
    workspaceRoot,
    action: "fresh-initialize",
    ...input,
  });

  assert.notEqual(
    bootstrappedInspection.inspectionDigest,
    absentInspection.inspectionDigest,
    "raw inventory digest must reflect the observed protocol-prefix state",
  );
  assert.deepEqual(
    bootstrappedPlan,
    absentPlan,
    "T02 bootstrap must not make the confirmed domain plan stale",
  );
  assert.deepEqual(protocolProvidedRefs(bootstrappedPlan), PROTOCOL_PROVIDED_REFS);
});

test("T01b delegates safe legacy protocol modes instead of pretending to migrate them", async (t) => {
  const {
    inspectWakeflowLocalLayout,
    planWakeflowLocalLayoutRealization,
  } = await realization();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-layout-legacy-protocol-mode-");
  const input = buildInput(codexProfile);
  mkdirSync(portablePath(workspaceRoot, ".wakeflow-local"), { mode: 0o755 });
  chmodSync(portablePath(workspaceRoot, ".wakeflow-local"), 0o755);
  const before = snapshotTree(workspaceRoot);

  const inspection = inspectWakeflowLocalLayout({ workspaceRoot, ...input });
  assert.equal(
    inspection.items.staticDirectories.find((item) => item.path === ".wakeflow-local")?.classification,
    "permission-drift",
  );
  const plan = planWakeflowLocalLayoutRealization({
    workspaceRoot,
    action: "explicit-migration",
    ...input,
  });
  assert.deepEqual(plan.payload.steps, []);
  assert.ok(plan.payload.blockers.some((item) => item.classification === "protocol-permission-drift"));
  assert.deepEqual(snapshotTree(workspaceRoot), before);
});

test("T01b blocks wrong types, symlinks, unsafe modes, and unknown local entries without writing", async (t) => {
  const { inspectWakeflowLocalLayout, planWakeflowLocalLayoutRealization } = await realization();
  const cases = [
    {
      name: "wrong-type",
      classification: "wrong-type",
      arrange(workspaceRoot) {
        createPrivateDirectory(workspaceRoot, ".wakeflow-local");
        writeFileSync(portablePath(workspaceRoot, ".wakeflow-local/audit"), "not a directory\n", { mode: 0o600 });
      },
    },
    {
      name: "unsafe-mode",
      classification: "unsafe-mode",
      arrange(workspaceRoot) {
        const localRoot = portablePath(workspaceRoot, ".wakeflow-local");
        mkdirSync(localRoot, { mode: 0o700 });
        chmodSync(localRoot, 0o777);
      },
    },
    {
      name: "unknown",
      classification: "unknown",
      arrange(workspaceRoot) {
        createPrivateDirectory(workspaceRoot, ".wakeflow-local");
        writeFileSync(portablePath(workspaceRoot, ".wakeflow-local/alien.txt"), "foreign owner\n", { mode: 0o600 });
      },
    },
  ];
  if (process.platform !== "win32") {
    cases.push({
      name: "symlink",
      classification: "symlink",
      arrange(workspaceRoot, current) {
        createPrivateDirectory(workspaceRoot, ".wakeflow-local");
        current.outside = mkdtempSync(path.join(os.tmpdir(), "wakeflow-layout-outside-"));
        writeFileSync(path.join(current.outside, "sentinel.txt"), "outside stays exact\n", { mode: 0o600 });
        symlinkSync(current.outside, portablePath(workspaceRoot, ".wakeflow-local/audit"));
      },
    });
  }

  for (const current of cases) {
    await t.test(current.name, (subtest) => {
      const workspaceRoot = withTempWorkspace(subtest, `wakeflow-layout-block-${current.name}-`);
      subtest.after(() => {
        if (current.outside) rmSync(current.outside, { force: true, recursive: true });
      });
      current.arrange(workspaceRoot, current);
      const input = buildInput(codexProfile);
      const before = snapshotTree(workspaceRoot);
      const inspection = inspectWakeflowLocalLayout({ workspaceRoot, ...input });
      const plan = planWakeflowLocalLayoutRealization({
        workspaceRoot,
        action: "reconcile",
        ...input,
      });

      assert.equal(inspection.overall, "blocked");
      assert.ok(
        inventoryItems(inspection).some((entry) => entry.classification === current.classification),
        `${current.classification} must remain explicit in recursive inventory`,
      );
      assert.ok(
        plan.payload.blockers.some((entry) => entry.classification === current.classification),
        `${current.classification} must block realization`,
      );
      assert.deepEqual(plan.payload.steps, [], "a blocked plan cannot expose a partial write set");
      const serializedBlockers = canonicalJson(plan.payload.blockers);
      assert.equal(serializedBlockers.includes(workspaceRoot), false);
      assert.equal(current.outside ? serializedBlockers.includes(current.outside) : false, false);
      if (current.name === "unknown") {
        assert.equal(canonicalJson(inspection).includes("alien.txt"), false);
        assert.equal(serializedBlockers.includes("alien.txt"), false);
      }
      assert.deepEqual(snapshotTree(workspaceRoot), before);
      if (current.outside) {
        assert.equal(readFileSync(path.join(current.outside, "sentinel.txt"), "utf8"), "outside stays exact\n");
      }
    });
  }
});

test("T01b candidate storage and verify are pure projections of one inspection while public v2 stays disconnected", async (t) => {
  const {
    inspectWakeflowLocalLayout,
    projectWakeflowLocalLayoutStorage,
    verifyWakeflowLocalLayoutInspection,
  } = await realization();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-layout-candidate-projections-");
  const input = buildInput(codexProfile);
  const before = snapshotTree(workspaceRoot);
  const inspection = inspectWakeflowLocalLayout({ workspaceRoot, ...input });
  const inspectionBefore = canonicalJson(inspection);
  const storage = projectWakeflowLocalLayoutStorage({ inspection });
  const verification = verifyWakeflowLocalLayoutInspection({ inspection });

  assert.equal(storage.kind, "WakeflowLocalLayoutStorageProjection");
  assert.equal(storage.schemaVersion, 1);
  assert.equal(storage.inspectionDigest, inspection.inspectionDigest);
  assert.equal(verification.kind, "WakeflowLocalLayoutVerification");
  assert.equal(verification.schemaVersion, 1);
  assert.equal(verification.inspectionDigest, inspection.inspectionDigest);
  assert.equal(verification.ok, false, "an absent required layout is not verified healthy");
  assert.equal(canonicalJson(inspection), inspectionBefore, "projections cannot rewrite their source inspection");
  assert.deepEqual(snapshotTree(workspaceRoot), before, "candidate projections must remain read-only");

  const { inspectionDigest: ignoredDigest, ...unsignedInspection } = JSON.parse(inspectionBefore);
  const forgedUnsigned = {
    ...unsignedInspection,
    overall: "healthy",
    items: {
      ...unsignedInspection.items,
      boundaries: [{ path: "/private/secret", classification: "current" }],
    },
  };
  const forged = {
    ...forgedUnsigned,
    inspectionDigest: canonicalJsonDigest(forgedUnsigned),
  };
  assert.throws(() => projectWakeflowLocalLayoutStorage({ inspection: forged }), /inspection|authority/iu);
  assert.throws(() => verifyWakeflowLocalLayoutInspection({ inspection: forged }), /inspection|authority/iu);

  const retiredRelativeFiles = [
    "core/scripts/lib/wakeflow-storage-map.mjs",
    "core/scripts/wakeflow-check-layout.mjs",
    "core/scripts/wakeflow-storage.mjs",
    "core/scripts/wakeflow-verify.mjs",
  ];
  for (const relative of retiredRelativeFiles) {
    assert.equal(existsSync(path.join(repositoryRoot, relative)), false, relative);
  }
  const source = readFileSync(realizationFile, "utf8");
  assert.match(source, /from\s+["']\.\/wakeflow-local-layout\.mjs["']/u);
  assert.doesNotMatch(source, /wakeflow-storage-map\.mjs|wakeflow-(?:setup|storage|verify|check-layout|cli)\.mjs/u);
});

test("T04 owner validators reject invalid projections and an invalid identity binding", async (t) => {
  const {
    inspectWakeflowLocalLayout,
    planWakeflowLocalLayoutRealization,
    verifyWakeflowLocalLayoutInspection,
  } = await realization();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-layout-owner-pending-");
  const input = buildInput(codexProfile);
  await applyLocalLayout(workspaceRoot, input, "fresh-initialize");
  const desired = planWakeflowLocalLayout(input);
  for (const item of desired.initialProjections) {
    writeFileSync(portablePath(workspaceRoot, item.path), "not canonical owner data\n", { mode: 0o600 });
    chmodSync(portablePath(workspaceRoot, item.path), 0o600);
  }
  const binding = ".wakeflow-local/runtime/hosts/codex/identity/window-bindings/window_55555555-5555-4555-8555-555555555555.json";
  writeFileSync(portablePath(workspaceRoot, binding), "{}\n", { mode: 0o600 });
  chmodSync(portablePath(workspaceRoot, binding), 0o600);

  const inspection = inspectWakeflowLocalLayout({ workspaceRoot, ...input });
  assert.equal(
    inspection.items.initialProjections.every((item) => item.classification === "owner-validator-invalid"),
    true,
  );
  const identityEvent = actualEvent(inspection, "event.identity.binding", "owner-validator-invalid");
  assert.ok(identityEvent);
  assert.equal(identityEvent.ownerValidationCode, "wakeflow-window-binding-inventory");
  assert.equal(inspection.overall, "blocked");
  assert.ok(inspection.blockers.some((item) => item.classification === "owner-validator-invalid"));
  assert.equal(verifyWakeflowLocalLayoutInspection({ inspection }).ok, false);
  const plan = planWakeflowLocalLayoutRealization({ workspaceRoot, action: "reconcile", ...input });
  assert.deepEqual(plan.payload.steps, []);
  assert.ok(plan.payload.blockers.some((item) => item.classification === "owner-validator-invalid"));
  assert.equal(canonicalJson(inspection).includes("not canonical owner data"), false);
});

test("T03 identity binding owner-validator closes its event while absent projections remain delegated", async (t) => {
  const {
    inspectWakeflowLocalLayout,
    planWakeflowLocalLayoutRealization,
    projectWakeflowLocalLayoutStorage,
    verifyWakeflowLocalLayoutInspection,
  } = await realization();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-layout-owner-validated-");
  const input = buildInput(codexProfile);
  await applyLocalLayout(workspaceRoot, input, "fresh-initialize");
  const windowId = "window_55555555-5555-4555-8555-555555555555";
  const binding = `.wakeflow-local/runtime/hosts/codex/identity/window-bindings/${windowId}.json`;
  const record = createWindowBindingRecord({
    programId: input.model.program.programId,
    hostId: "codex",
    windowId,
    bindingId: "binding_99999999-9999-4999-8999-999999999999",
    handle: {
      kind: codexProfile.handleId.kind,
      value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
    registeredAt: "2026-08-08T00:00:00.000Z",
  });
  writeFileSync(portablePath(workspaceRoot, binding), windowBindingCanonicalBytes(record), { mode: 0o600 });
  chmodSync(portablePath(workspaceRoot, binding), 0o600);

  const inspection = inspectWakeflowLocalLayout({ workspaceRoot, ...input });
  assert.equal(
    inspection.items.initialProjections.every((item) => item.classification === "delegated-missing"),
    true,
  );
  const identityEvent = actualEvent(inspection, "event.identity.binding", "owner-validated");
  assert.ok(identityEvent);
  assert.equal(identityEvent.bindingId, record.bindingId);
  assert.match(identityEvent.identityBindingDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(canonicalJson(identityEvent).includes(record.handle.value), false);
  assert.equal(inspection.overall, "drift");
  assert.equal(
    inspection.blockers.some((item) => item.classification === "owner-validator-invalid"),
    false,
  );
  const storage = projectWakeflowLocalLayoutStorage({ inspection });
  const verification = verifyWakeflowLocalLayoutInspection({ inspection });
  assert.equal(storage.inspectionDigest, inspection.inspectionDigest);
  assert.equal(verification.inspectionDigest, inspection.inspectionDigest);
  assert.equal(verification.ok, false);
  assert.equal(canonicalJson({ storage, verification }).includes(record.handle.value), false);
  const plan = planWakeflowLocalLayoutRealization({ workspaceRoot, action: "reconcile", ...input });
  assert.deepEqual(plan.payload.steps, []);
  assert.equal(
    plan.payload.blockers.some((item) => item.classification === "owner-validator-invalid"),
    false,
  );
});

test("T03 identity owner-validator structurally accepts dynamic identities and rejects duplicate inventories", async (t) => {
  const fixtures = [
    {
      name: "config-external typed dynamic window",
      records: [{
        windowId: "window_99999999-9999-4999-8999-999999999999",
        bindingId: "binding_99999999-9999-4999-8999-999999999999",
        handle: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }],
      expectedClassification: "owner-validated",
      expectedCode: null,
      expectedOverall: "drift",
      expectedBlockers: 0,
    },
    {
      name: "duplicate binding ID",
      records: [
        {
          windowId: "window_55555555-5555-4555-8555-555555555555",
          bindingId: "binding_99999999-9999-4999-8999-999999999999",
          handle: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
        {
          windowId: "window_66666666-6666-4666-8666-666666666666",
          bindingId: "binding_99999999-9999-4999-8999-999999999999",
          handle: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        },
      ],
      expectedClassification: "owner-validator-invalid",
      expectedCode: "wakeflow-window-binding-duplicate",
      expectedOverall: "blocked",
      expectedBlockers: 2,
    },
    {
      name: "duplicate host handle",
      records: [
        {
          windowId: "window_55555555-5555-4555-8555-555555555555",
          bindingId: "binding_99999999-9999-4999-8999-999999999999",
          handle: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
        {
          windowId: "window_66666666-6666-4666-8666-666666666666",
          bindingId: "binding_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          handle: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
      ],
      expectedClassification: "owner-validator-invalid",
      expectedCode: "wakeflow-window-binding-duplicate",
      expectedOverall: "blocked",
      expectedBlockers: 2,
    },
  ];

  for (const fixture of fixtures) {
    await t.test(fixture.name, async (subtest) => {
      const { inspectWakeflowLocalLayout } = await realization();
      const workspaceRoot = withTempWorkspace(subtest, "wakeflow-layout-owner-inventory-");
      const input = buildInput(codexProfile);
      await applyLocalLayout(workspaceRoot, input, "fresh-initialize");
      for (const value of fixture.records) {
        const ref = `.wakeflow-local/runtime/hosts/codex/identity/window-bindings/${value.windowId}.json`;
        const record = createWindowBindingRecord({
          programId: input.model.program.programId,
          hostId: "codex",
          windowId: value.windowId,
          bindingId: value.bindingId,
          handle: { kind: codexProfile.handleId.kind, value: value.handle },
          registeredAt: "2026-08-08T00:00:00.000Z",
        });
        writeFileSync(portablePath(workspaceRoot, ref), windowBindingCanonicalBytes(record), { mode: 0o600 });
        chmodSync(portablePath(workspaceRoot, ref), 0o600);
      }

      const inspection = inspectWakeflowLocalLayout({ workspaceRoot, ...input });
      const identityEvents = inspection.items.events.filter((item) => (
        item.matchedKeys?.includes("event.identity.binding")
      ));
      assert.equal(identityEvents.length, fixture.records.length);
      assert.equal(
        identityEvents.every((item) => (
          item.classification === fixture.expectedClassification
          && (fixture.expectedCode === null
            ? !Object.hasOwn(item, "ownerValidationCode")
            : item.ownerValidationCode === fixture.expectedCode)
        )),
        true,
      );
      assert.equal(inspection.overall, fixture.expectedOverall);
      assert.equal(
        inspection.blockers.filter((item) => item.classification === "owner-validator-invalid").length,
        fixture.expectedBlockers,
      );
      for (const value of fixture.records) {
        assert.equal(canonicalJson(inspection).includes(value.handle), false);
      }
    });
  }
});

test("T03 owner validation preserves T01b repair of safe identity-directory mode drift", async (t) => {
  const { inspectWakeflowLocalLayout } = await realization();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-layout-identity-mode-repair-");
  const input = buildInput(codexProfile);
  await applyLocalLayout(workspaceRoot, input, "fresh-initialize");
  const windowId = "window_55555555-5555-4555-8555-555555555555";
  const bindingRoot = ".wakeflow-local/runtime/hosts/codex/identity/window-bindings";
  const binding = `${bindingRoot}/${windowId}.json`;
  const record = createWindowBindingRecord({
    programId: input.model.program.programId,
    hostId: "codex",
    windowId,
    bindingId: "binding_99999999-9999-4999-8999-999999999999",
    handle: {
      kind: codexProfile.handleId.kind,
      value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
    registeredAt: "2026-08-08T00:00:00.000Z",
  });
  writeFileSync(portablePath(workspaceRoot, binding), windowBindingCanonicalBytes(record), { mode: 0o600 });
  chmodSync(portablePath(workspaceRoot, binding), 0o600);
  chmodSync(portablePath(workspaceRoot, bindingRoot), 0o744);

  const before = inspectWakeflowLocalLayout({ workspaceRoot, ...input });
  assert.equal(
    before.items.staticDirectories.find((item) => item.path === bindingRoot)?.classification,
    "permission-drift",
  );
  assert.ok(actualEvent(before, "event.identity.binding", "owner-validated"));
  assert.equal(
    before.blockers.some((item) => item.classification === "owner-validator-invalid"),
    false,
  );

  const { confirmedPlan, result } = await applyLocalLayout(workspaceRoot, input, "reconcile");
  assert.equal(result.status, "completed");
  assert.equal(
    confirmedPlan.payload.steps.some((step) => step.final.ref === bindingRoot),
    true,
  );
  assert.equal(modeString(lstatSync(portablePath(workspaceRoot, bindingRoot))), "0700");
  const after = inspectWakeflowLocalLayout({ workspaceRoot, ...input });
  assert.ok(actualEvent(after, "event.identity.binding", "owner-validated"));
});

test("T01b reconcile completes a partial protocol prefix and repairs every safe static mode", async (t) => {
  const { inspectWakeflowLocalLayout } = await realization();
  const input = buildInput(codexProfile);

  await t.test("partial protocol prefix", async (subtest) => {
    const workspaceRoot = withTempWorkspace(subtest, "wakeflow-layout-partial-prefix-");
    createPrivateDirectory(workspaceRoot, ".wakeflow-local/runtime");

    const { result } = await applyLocalLayout(workspaceRoot, input, "reconcile");
    assert.equal(result.status, "completed");
    const expected = planWakeflowLocalLayout(input).staticDirectories.map((item) => item.path).sort();
    assert.deepEqual(snapshotTree(workspaceRoot).map((item) => item.ref).sort(), expected);
    assert.equal(snapshotTree(workspaceRoot).every((item) => item.mode === "0700"), true);
  });

  await t.test("safe 0744 mode drift", async (subtest) => {
    const workspaceRoot = withTempWorkspace(subtest, "wakeflow-layout-safe-mode-");
    await applyLocalLayout(workspaceRoot, input, "fresh-initialize");
    const driftRef = ".wakeflow-local/audit";
    chmodSync(portablePath(workspaceRoot, driftRef), 0o744);

    const before = inspectWakeflowLocalLayout({ workspaceRoot, ...input });
    assert.equal(
      before.items.staticDirectories.find((item) => item.path === driftRef)?.classification,
      "permission-drift",
    );
    const { confirmedPlan, result } = await applyLocalLayout(workspaceRoot, input, "reconcile");
    assert.equal(result.status, "completed");
    assert.equal(confirmedPlan.payload.steps.length, 1);
    assert.deepEqual(confirmedPlan.payload.steps[0].source, {
      ref: driftRef,
      type: "directory",
      mode: "0744",
      digest: confirmedPlan.payload.steps[0].final.digest,
    });
    assert.equal(modeString(lstatSync(portablePath(workspaceRoot, driftRef))), "0700");
  });
});

test("T01b event inventory preserves typed, owner-pending, payload, foreign-host, and legacy boundaries", async (t) => {
  const {
    inspectWakeflowLocalLayout,
    planWakeflowLocalLayoutRealization,
  } = await realization();
  const input = buildInput(codexProfile);

  await t.test("typed structural parents and unresolved owner IDs", async (subtest) => {
    const workspaceRoot = withTempWorkspace(subtest, "wakeflow-layout-events-");
    await applyLocalLayout(workspaceRoot, input, "fresh-initialize");

    const demandId = "demand_22222222-2222-4222-8222-222222222222";
    const demandRoot = `.wakeflow-local/runtime/shared/transport/demands/${demandId}`;
    createPrivateDirectory(workspaceRoot, demandRoot);
    let inspection = inspectWakeflowLocalLayout({ workspaceRoot, ...input });
    assert.equal(
      actualEvent(inspection, "event.transport.demand.envelopes")?.classification,
      "owner-validator-invalid",
    );
    assert.equal(inspection.overall, "blocked");
    assert.ok(inspection.blockers.some((blocker) => (
      blocker.classification === "owner-validator-invalid"
    )));

    for (const directory of ["groups", "packets", "envelopes", "runs"]) {
      createPrivateDirectory(workspaceRoot, `${demandRoot}/${directory}`);
    }
    const group = createDispatchGroupRecord({
      programId: input.model.program.programId,
      demandId,
      groupId: "dispatch-group_99999999-9999-4999-8999-999999999999",
      stateRevision: 1,
      controllerWindowId: "window_55555555-5555-4555-8555-555555555555",
      members: [{
        windowId: "window_88888888-8888-4888-8888-888888888888",
        targetTaskId: "target-task_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        packetId: "dispatch-packet_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }],
      returnPolicy: { mode: "group-ready" },
      createdAt: "2026-08-08T00:00:00.000Z",
    });
    const groupRef = `${demandRoot}/groups/${group.groupId}.json`;
    writeFileSync(
      portablePath(workspaceRoot, groupRef),
      dispatchGroupCanonicalBytes(group),
      { mode: 0o600 },
    );
    chmodSync(portablePath(workspaceRoot, groupRef), 0o600);
    inspection = inspectWakeflowLocalLayout({ workspaceRoot, ...input });
    const groupEvent = inspection.items.events.find((event) => (
      event.transportRecordDigest === group.groupDigest
    ));
    assert.equal(groupEvent?.classification, "owner-validated");
    assert.match(groupEvent.transportInventoryDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.ok(inspection.items.events.some((event) => (
      event.classification === "owner-validated"
      && event.transportInventoryDigest === groupEvent.transportInventoryDigest
      && !Object.hasOwn(event, "transportRecordDigest")
    )));
    assert.equal(inspection.blockers.length, 0);

    const transportRoot = ".wakeflow-local/runtime/shared/transport";
    chmodSync(portablePath(workspaceRoot, transportRoot), 0o744);
    inspection = inspectWakeflowLocalLayout({ workspaceRoot, ...input });
    assert.equal(
      inspection.items.staticDirectories.find((item) => item.path === transportRoot)?.classification,
      "permission-drift",
    );
    assert.equal(
      inspection.items.events.find((event) => event.transportRecordDigest === group.groupDigest)
        ?.classification,
      "owner-validated",
      "layout diagnostics must not turn safe static mode repair into transport corruption",
    );
    assert.equal(
      inspection.blockers.some((blocker) => blocker.classification === "owner-validator-invalid"),
      false,
    );
    chmodSync(portablePath(workspaceRoot, transportRoot), 0o700);

    const podRoot = ".wakeflow-local/runtime/hosts/codex/evidence/pods/"
      + "pod_33000000-0000-4000-8000-000000000001";
    createPrivateDirectory(workspaceRoot, podRoot);
    inspection = inspectWakeflowLocalLayout({ workspaceRoot, ...input });
    assert.ok(actualEvent(inspection, "event.pod.root", "owner-validator-stale"));
    assert.equal(inspection.overall, "drift");
    assert.ok(inspection.blockers.some((blocker) => blocker.classification === "owner-validator-stale"));

    const invalidLease = ".wakeflow-local/runtime/shared/coordination/window-leases/not-a-window.json";
    writeFileSync(portablePath(workspaceRoot, invalidLease), "{}\n", { mode: 0o600 });
    chmodSync(portablePath(workspaceRoot, invalidLease), 0o600);
    inspection = inspectWakeflowLocalLayout({ workspaceRoot, ...input });
    assert.ok(actualEvent(inspection, "event.coordination.window-lease", "invalid-parameter"));
    assert.equal(inspection.overall, "blocked");

    const payloadRoot = ".wakeflow-local/audit/preserved/preservation-alpha/payload";
    createPrivateDirectory(workspaceRoot, payloadRoot);
    const payloadFile = `${payloadRoot}/evidence.txt`;
    writeFileSync(portablePath(workspaceRoot, payloadFile), "protected\n", { mode: 0o600 });
    chmodSync(portablePath(workspaceRoot, payloadFile), 0o600);
    const payloadLink = `${payloadRoot}/escape-link`;
    symlinkSync("evidence.txt", portablePath(workspaceRoot, payloadLink));
    inspection = inspectWakeflowLocalLayout({ workspaceRoot, ...input });
    assert.ok(actualEvent(inspection, "event.audit.preservation.payload", "invalid-parameter"));

    const plan = planWakeflowLocalLayoutRealization({ workspaceRoot, action: "reconcile", ...input });
    assert.deepEqual(plan.payload.steps, []);
    assert.ok(plan.payload.blockers.some((item) => item.classification === "owner-validator-stale"));
    assert.ok(plan.payload.blockers.some((item) => item.classification === "invalid-parameter"));
  });

  await t.test("Pod owner validation closes a complete immutable control prefix", async (subtest) => {
    const workspaceRoot = withTempWorkspace(subtest, "wakeflow-layout-pod-owner-");
    await applyLocalLayout(workspaceRoot, input, "fresh-initialize");
    const programId = input.model.program.programId;
    const demandId = "demand_22000000-0000-4000-8000-000000000001";
    const podId = "pod_33000000-0000-4000-8000-000000000001";
    const createdAt = "2026-08-09T02:00:01.000Z";
    const scope = createPodScopeRecord({
      kind: WAKEFLOW_POD_SCOPE_KIND,
      schemaVersion: 1,
      programId,
      hostId: "codex",
      podId,
      demandId,
      placementAuthorizationDigest: `sha256:${"a".repeat(64)}`,
      createdAt,
    });
    const controls = [
      ["controller", "1"],
      ["design", "2"],
      ["test", "3"],
    ].map(([role, suffix]) => createPodLaunchIntentRecord({
      kind: WAKEFLOW_POD_LAUNCH_INTENT_KIND,
      schemaVersion: 1,
      programId,
      hostId: "codex",
      podId,
      demandId,
      windowId: `window_55000000-0000-4000-8000-00000000000${suffix}`,
      launchOperationId: `pod-launch_77000000-0000-4000-8000-00000000000${suffix}`,
      bindingId: `binding_66000000-0000-4000-8000-00000000000${suffix}`,
      role,
      environmentIntent: "host-local",
      createdAt,
    }));
    const podRoot = `.wakeflow-local/runtime/hosts/codex/evidence/pods/${podId}`;
    for (const directory of ["bindings", "close", "launch-intents", "materialization", "test-access"]) {
      createPrivateDirectory(workspaceRoot, `${podRoot}/${directory}`);
    }
    for (const record of [scope, ...controls]) writePrivatePodRecord(workspaceRoot, record);

    const inspection = inspectWakeflowLocalLayout({ workspaceRoot, ...input });
    const rootEvent = actualEvent(inspection, "event.pod.root", "owner-validated");
    assert.equal(rootEvent?.podId, podId);
    assert.match(rootEvent?.podInventoryDigest, /^sha256:[0-9a-f]{64}$/u);
    const scopeEvent = actualEvent(inspection, "event.pod.scope", "owner-validated");
    assert.equal(scopeEvent?.podRecordDigest, podRecordDigest(scope));
    for (const control of controls) {
      assert.ok(inspection.items.events.some((event) => (
        event.classification === "owner-validated"
        && event.podRecordDigest === podRecordDigest(control)
        && event.podInventoryDigest === rootEvent.podInventoryDigest
      )));
    }
    assert.equal(inspection.blockers.length, 0);
    assert.equal(
      inspection.overall,
      "drift",
      "absent delegated projections remain ordinary layout drift beside valid Pod evidence",
    );

    const invalidPodId = "pod_33000000-0000-4000-8000-000000000002";
    createPrivateDirectory(
      workspaceRoot,
      `.wakeflow-local/runtime/hosts/codex/evidence/pods/${invalidPodId}/unexpected`,
    );
    const isolated = inspectWakeflowLocalLayout({ workspaceRoot, ...input });
    assert.equal(
      isolated.items.events.find((event) => event.podRecordDigest === podRecordDigest(scope))
        ?.classification,
      "owner-validated",
      "an invalid adjacent Pod must not contaminate exact valid Pod evidence",
    );
    assert.ok(isolated.items.events.some((event) => (
      event.podId === invalidPodId && event.classification === "owner-validator-invalid"
    )));
    assert.equal(isolated.overall, "blocked");
  });

  await t.test("keep-live owner validation closes one exact lease generation and control tuple", async (subtest) => {
    const workspaceRoot = withTempWorkspace(subtest, "wakeflow-layout-keep-live-owner-");
    await applyLocalLayout(workspaceRoot, input, "fresh-initialize");
    const programId = input.model.program.programId;
    const demandId = "demand_22000000-0000-4000-8000-000000000009";
    const automationRunId = "dispatch-group_33000000-0000-4000-8000-000000000009";
    const generationId = "keep-live-generation_44000000-0000-4000-8000-000000000009";
    const requestId = "keep-live-request_55000000-0000-4000-8000-000000000009";
    const createdAt = "2026-08-09T02:00:09.000Z";
    const lease = createKeepLiveLeaseRecord({
      programId,
      hostId: "codex",
      demandId,
      automationRunId,
      acquiredAt: createdAt,
      lastConfirmedAt: createdAt,
    });
    const processRecord = createKeepLiveProcessRecord({
      programId,
      hostId: "codex",
      generationId,
      capability: "macos-caffeinate",
      mechanism: "worker-caffeinate",
      status: "starting",
      worker: null,
      child: null,
      controlRequestId: requestId,
      controlRevision: 1,
      createdAt,
      startedAt: null,
      observedAt: createdAt,
      stopRequestedAt: null,
      errorCode: null,
    });
    const control = createKeepLiveControlRecord({
      programId,
      hostId: "codex",
      generationId,
      requestId,
      action: "start",
      phase: "requested",
      revision: 1,
      requestedAt: createdAt,
      updatedAt: createdAt,
      errorCode: null,
    });
    const root = ".wakeflow-local/runtime/hosts/codex/operations/keep-live";
    writeFileSync(
      portablePath(workspaceRoot, `${root}/leases/${automationRunId}.json`),
      keepLiveLeaseCanonicalBytes(lease),
      { mode: 0o600 },
    );
    writeFileSync(
      portablePath(workspaceRoot, `${root}/process.json`),
      keepLiveProcessCanonicalBytes(processRecord),
      { mode: 0o600 },
    );
    writeFileSync(
      portablePath(workspaceRoot, `${root}/control.json`),
      keepLiveControlCanonicalBytes(control),
      { mode: 0o600 },
    );
    let inspection = inspectWakeflowLocalLayout({ workspaceRoot, ...input });
    const keepLiveEvents = inspection.items.events.filter((event) => (
      event.matchedKeys?.some((key) => key.startsWith("event.keep-live."))
    ));
    assert.equal(keepLiveEvents.length, 3);
    assert.equal(keepLiveEvents.every((event) => event.classification === "owner-validated"), true);
    assert.equal(keepLiveEvents.every((event) => /^sha256:[0-9a-f]{64}$/u.test(event.recordDigest)), true);
    assert.equal(canonicalJson(keepLiveEvents).includes('"pid"'), false);
    assert.equal(canonicalJson(keepLiveEvents).includes(workspaceRoot), false);

    writeFileSync(
      portablePath(workspaceRoot, `${root}/control.json`),
      "{\"schemaVersion\":1}\n",
      { mode: 0o600 },
    );
    inspection = inspectWakeflowLocalLayout({ workspaceRoot, ...input });
    assert.equal(
      actualEvent(inspection, "event.keep-live.control")?.classification,
      "owner-validator-invalid",
    );
    assert.equal(inspection.overall, "blocked");
  });

  await t.test("transport owner validation isolates each typed demand", async (subtest) => {
    const workspaceRoot = withTempWorkspace(subtest, "wakeflow-layout-transport-isolation-");
    await applyLocalLayout(workspaceRoot, input, "fresh-initialize");
    const validDemandId = "demand_cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const invalidDemandId = "demand_dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    for (const demandId of [validDemandId, invalidDemandId]) {
      const demandRoot = `.wakeflow-local/runtime/shared/transport/demands/${demandId}`;
      for (const directory of ["groups", "packets", "envelopes", "runs"]) {
        createPrivateDirectory(workspaceRoot, `${demandRoot}/${directory}`);
      }
    }
    const validGroup = createDispatchGroupRecord({
      programId: input.model.program.programId,
      demandId: validDemandId,
      groupId: "dispatch-group_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      stateRevision: 2,
      controllerWindowId: "window_55555555-5555-4555-8555-555555555555",
      members: [{
        windowId: "window_88888888-8888-4888-8888-888888888888",
        targetTaskId: "target-task_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        packetId: "dispatch-packet_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      }],
      returnPolicy: { mode: "group-ready" },
      createdAt: "2026-08-08T00:00:00.000Z",
    });
    const validGroupRef = `.wakeflow-local/runtime/shared/transport/demands/${validDemandId}`
      + `/groups/${validGroup.groupId}.json`;
    writeFileSync(
      portablePath(workspaceRoot, validGroupRef),
      dispatchGroupCanonicalBytes(validGroup),
      { mode: 0o600 },
    );
    chmodSync(portablePath(workspaceRoot, validGroupRef), 0o600);

    const inspection = inspectWakeflowLocalLayout({ workspaceRoot, ...input });
    assert.equal(
      inspection.items.events.find((event) => (
        event.transportRecordDigest === validGroup.groupDigest
      ))?.classification,
      "owner-validated",
      "an invalid adjacent demand must not contaminate the exact valid demand scan",
    );
    assert.ok(inspection.items.events.some((event) => (
      event.classification === "owner-validator-invalid"
      && event.ownerValidationCode === "wakeflow-transport-layout-empty"
    )));
    assert.equal(inspection.overall, "blocked");
  });

  await t.test("foreign host remains in place while legacy remains blocking", async (subtest) => {
    const workspaceRoot = withTempWorkspace(subtest, "wakeflow-layout-foreign-host-");
    await applyLocalLayout(workspaceRoot, input, "fresh-initialize");
    const foreignRoot = ".wakeflow-local/runtime/hosts/claude-code";
    createPrivateDirectory(workspaceRoot, `${foreignRoot}/private-child`);

    let inspection = inspectWakeflowLocalLayout({ workspaceRoot, ...input });
    const foreign = inspection.items.boundaries.find((item) => item.path === foreignRoot);
    assert.equal(foreign?.classification, "foreign-host-surface");
    assert.equal(foreign?.applicability, "not-applicable-to-current-adapter");
    let plan = planWakeflowLocalLayoutRealization({ workspaceRoot, action: "reconcile", ...input });
    assert.deepEqual(plan.payload.blockers, []);
    assert.deepEqual(plan.payload.steps, []);

    const legacy = ".wakeflow-local/README.md";
    writeFileSync(portablePath(workspaceRoot, legacy), "legacy stays exact\n", { mode: 0o600 });
    chmodSync(portablePath(workspaceRoot, legacy), 0o600);
    inspection = inspectWakeflowLocalLayout({ workspaceRoot, ...input });
    assert.equal(
      inspection.items.boundaries.find((item) => item.path === legacy)?.classification,
      "legacy",
    );
    plan = planWakeflowLocalLayoutRealization({ workspaceRoot, action: "reconcile", ...input });
    assert.deepEqual(plan.payload.steps, []);
    assert.ok(plan.payload.blockers.some((item) => item.classification === "legacy"));
    assert.equal(readFileSync(portablePath(workspaceRoot, legacy), "utf8"), "legacy stays exact\n");
  });
});

test("T01b participant rejects forged, wrong-workspace, expired, and nested mutation authority", {
  skip: process.platform === "win32" ? "POSIX mutation authority is required" : false,
}, async (t) => {
  const {
    createWakeflowLocalLayoutMutationParticipant,
    inspectWakeflowLocalLayout,
    planWakeflowLocalLayoutRealization,
  } = await realization();
  const input = buildInput(codexProfile);
  const workspaceA = withTempWorkspace(t, "wakeflow-layout-context-a-");
  const workspaceB = withTempWorkspace(t, "wakeflow-layout-context-b-");
  for (const workspaceRoot of [workspaceA, workspaceB]) {
    for (const ref of PROTOCOL_PROVIDED_REFS) createPrivateDirectory(workspaceRoot, ref);
  }
  const planA = planWakeflowLocalLayoutRealization({ workspaceRoot: workspaceA, action: "reconcile", ...input });
  const planB = planWakeflowLocalLayoutRealization({ workspaceRoot: workspaceB, action: "reconcile", ...input });
  const participantA = createWakeflowLocalLayoutMutationParticipant({
    workspaceRoot: workspaceA,
    confirmedPlan: planA,
    ...input,
  });
  const participantB = createWakeflowLocalLayoutMutationParticipant({
    workspaceRoot: workspaceB,
    confirmedPlan: planB,
    ...input,
  });
  const firstHandlerB = participantB.stepHandlers[planB.payload.steps[0].stepId];
  assert.throws(() => firstHandlerB.observe({ context: {} }), /(?:context|forgery)/iu);

  let expiredContext = null;
  const beforeB = snapshotTree(workspaceB);
  await runWakeflowMaintenanceMutation({
    workspaceRoot: workspaceA,
    action: "reconcile",
    operationKind: "local-layout-realization",
    domainOwner: "layout-manager",
    confirmedPlan: planA,
    planDigest: canonicalJsonDigest(planA),
    validatePlan: participantA.validatePlan,
    deriveCurrentPlan: async ({ context }) => {
      expiredContext = context;
      assert.throws(
        () => firstHandlerB.observe({ context }),
        /(?:context|workspace|mismatch)/iu,
        "another workspace's exact gate cannot authorize this participant",
      );
      await assert.rejects(
        () => runWakeflowMaintenanceMutation({
          workspaceRoot: workspaceB,
          action: "reconcile",
          operationKind: "local-layout-realization",
          domainOwner: "layout-manager",
          confirmedPlan: planB,
          planDigest: canonicalJsonDigest(planB),
          validatePlan: participantB.validatePlan,
          deriveCurrentPlan: participantB.deriveCurrentPlan,
          deriveTerminalClosure: participantB.deriveTerminalClosure,
          stepHandlers: participantB.stepHandlers,
        }),
        /(?:nested|reentrant)/iu,
      );
      return participantA.deriveCurrentPlan({ context });
    },
    deriveTerminalClosure: participantA.deriveTerminalClosure,
    stepHandlers: participantA.stepHandlers,
  });
  assert.deepEqual(snapshotTree(workspaceB), beforeB, "rejected nested admission cannot bootstrap or mutate B");
  assert.throws(
    () => firstHandlerB.observe({ context: expiredContext }),
    /(?:context|expired|inactive)/iu,
  );
});

test("T01b participant rejects a malformed step source with a domain error before mutation", {
  skip: process.platform === "win32" ? "POSIX mutation authority is required" : false,
}, async (t) => {
  const {
    createWakeflowLocalLayoutMutationParticipant,
    planWakeflowLocalLayoutRealization,
  } = await realization();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-layout-malformed-step-");
  const input = buildInput(codexProfile);
  const confirmedPlan = planWakeflowLocalLayoutRealization({
    workspaceRoot,
    action: "fresh-initialize",
    ...input,
  });
  const forgedPlan = JSON.parse(canonicalJson(confirmedPlan));
  forgedPlan.payload.steps[0].source = null;
  const before = snapshotTree(workspaceRoot);

  assert.throws(
    () => createWakeflowLocalLayoutMutationParticipant({
      workspaceRoot,
      confirmedPlan: forgedPlan,
      ...input,
    }),
    (error) => error?.code === "wakeflow-local-realization-plan",
  );
  assert.deepEqual(snapshotTree(workspaceRoot), before);
});

test("T01b prepared directory realization recovers forward through the standard participant", {
  skip: !new Set(["darwin", "linux"]).has(process.platform)
    ? "production recovery process identity supports Darwin and Linux"
    : false,
  timeout: 30_000,
}, async (t) => {
  const {
    createWakeflowLocalLayoutMutationParticipant,
    inspectWakeflowLocalLayout,
    planWakeflowLocalLayoutRealization,
  } = await realization();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-layout-recovery-");
  const input = buildInput(codexProfile);
  const confirmedPlan = planWakeflowLocalLayoutRealization({
    workspaceRoot,
    action: "fresh-initialize",
    ...input,
  });
  const childSource = `
    import { readFileSync } from "node:fs";
    import { pathToFileURL } from "node:url";
    const workspaceRoot = ${JSON.stringify(workspaceRoot)};
    const realization = await import(${JSON.stringify(realizationUrl)});
    const manager = await import(${JSON.stringify(pathToFileURL(path.join(repositoryRoot, "core/scripts/lib/wakeflow-workspace-mutation.mjs")).href)});
    const config = await import(${JSON.stringify(pathToFileURL(path.join(repositoryRoot, "core/scripts/lib/wakeflow-config-v3.mjs")).href)});
    const descriptor = await import(${JSON.stringify(pathToFileURL(path.join(repositoryRoot, "core/scripts/lib/wakeflow-layout-descriptor.mjs")).href)});
    const canonical = await import(${JSON.stringify(pathToFileURL(path.join(repositoryRoot, "core/scripts/lib/wakeflow-canonical-json.mjs")).href)});
    const { hostProfile } = await import(${JSON.stringify(pathToFileURL(path.join(repositoryRoot, "plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs")).href)});
    const model = config.parseWakeflowConfigV3(JSON.parse(readFileSync(${JSON.stringify(fixtureFile)}, "utf8")));
    const input = { model, layoutDescriptor: descriptor.createWakeflowLayoutDescriptor({ model, hostProfile }), hostProfile };
    const confirmedPlan = realization.planWakeflowLocalLayoutRealization({ workspaceRoot, action: "fresh-initialize", ...input });
    const participant = realization.createWakeflowLocalLayoutMutationParticipant({ workspaceRoot, confirmedPlan, ...input });
    const firstId = confirmedPlan.payload.steps[0].stepId;
    const stepHandlers = { ...participant.stepHandlers, [firstId]: {
      ...participant.stepHandlers[firstId],
      commit() { process.kill(process.pid, "SIGKILL"); },
    } };
    await manager.runWakeflowMaintenanceMutation({
      workspaceRoot,
      action: "fresh-initialize",
      operationKind: "local-layout-realization",
      domainOwner: "layout-manager",
      confirmedPlan,
      planDigest: canonical.canonicalJsonDigest(confirmedPlan),
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

  const transactionRoot = portablePath(
    workspaceRoot,
    ".wakeflow-local/runtime/maintenance/transactions",
  );
  const journalName = readdirSync(transactionRoot).find((name) => (
    /^workspace-mutation_[0-9a-f-]+\.json$/u.test(name)
  ));
  assert.equal(typeof journalName, "string", "prepared crash must retain one journal");
  const operationId = journalName.slice(0, -".json".length);
  const journal = JSON.parse(readFileSync(path.join(transactionRoot, journalName), "utf8"));
  assert.equal(journal.steps[0].status, "prepared");
  const recoveryInspection = inspectWakeflowLocalLayout({ workspaceRoot, ...input });
  assert.equal(
    recoveryInspection.items.events.some((item) => (
      Array.isArray(item.matchedKeys)
      && item.matchedKeys.some((key) => key.startsWith("event.maintenance."))
    )),
    false,
    "generic event matching must not duplicate T02 residue authority",
  );
  assert.equal(
    recoveryInspection.blockers.every((item) => item.classification.startsWith("workspace-mutation-")),
    true,
  );

  const participant = createWakeflowLocalLayoutMutationParticipant({
    workspaceRoot,
    confirmedPlan,
    ...input,
  });
  const result = await recoverWakeflowWorkspaceMutation({
    workspaceRoot,
    operationId,
    confirmedPlan,
    planDigest: canonicalJsonDigest(confirmedPlan),
    validatePlan: participant.validatePlan,
    deriveCurrentPlan: participant.deriveCurrentPlan,
    deriveTerminalClosure: participant.deriveTerminalClosure,
    stepHandlers: participant.stepHandlers,
  });
  assert.equal(result.status, "recovered");
  assert.deepEqual(readdirSync(transactionRoot), []);
  const desired = planWakeflowLocalLayout(input);
  assert.deepEqual(
    snapshotTree(workspaceRoot).map((item) => item.ref).sort(),
    desired.staticDirectories.map((item) => item.path).sort(),
  );
});

test("T01b recovery rejects a mode-repair inode replacement after its final precommit observation", {
  skip: !new Set(["darwin", "linux"]).has(process.platform)
    ? "production recovery process identity supports Darwin and Linux"
    : false,
  timeout: 30_000,
}, async (t) => {
  const {
    createWakeflowLocalLayoutMutationParticipant,
    planWakeflowLocalLayoutRealization,
  } = await realization();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-layout-recovery-cas-");
  const displacedRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-layout-recovery-cas-original-"));
  t.after(() => rmSync(displacedRoot, { force: true, recursive: true }));
  const input = buildInput(codexProfile);
  await applyLocalLayout(workspaceRoot, input, "fresh-initialize");

  const driftRef = ".wakeflow-local/audit/preserved";
  const target = portablePath(workspaceRoot, driftRef);
  chmodSync(target, 0o755);
  const confirmedPlan = planWakeflowLocalLayoutRealization({
    workspaceRoot,
    action: "reconcile",
    ...input,
  });
  assert.equal(confirmedPlan.payload.steps.length, 1);
  assert.equal(confirmedPlan.payload.steps[0].final.ref, driftRef);
  assert.equal(confirmedPlan.payload.steps[0].source.mode, "0755");

  const childSource = `
    import { readFileSync } from "node:fs";
    const workspaceRoot = ${JSON.stringify(workspaceRoot)};
    const realization = await import(${JSON.stringify(realizationUrl)});
    const manager = await import(${JSON.stringify(pathToFileURL(path.join(repositoryRoot, "core/scripts/lib/wakeflow-workspace-mutation.mjs")).href)});
    const config = await import(${JSON.stringify(pathToFileURL(path.join(repositoryRoot, "core/scripts/lib/wakeflow-config-v3.mjs")).href)});
    const descriptor = await import(${JSON.stringify(pathToFileURL(path.join(repositoryRoot, "core/scripts/lib/wakeflow-layout-descriptor.mjs")).href)});
    const canonical = await import(${JSON.stringify(pathToFileURL(path.join(repositoryRoot, "core/scripts/lib/wakeflow-canonical-json.mjs")).href)});
    const { hostProfile } = await import(${JSON.stringify(pathToFileURL(path.join(repositoryRoot, "plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs")).href)});
    const model = config.parseWakeflowConfigV3(JSON.parse(readFileSync(${JSON.stringify(fixtureFile)}, "utf8")));
    const input = { model, layoutDescriptor: descriptor.createWakeflowLayoutDescriptor({ model, hostProfile }), hostProfile };
    const confirmedPlan = realization.planWakeflowLocalLayoutRealization({ workspaceRoot, action: "reconcile", ...input });
    const participant = realization.createWakeflowLocalLayoutMutationParticipant({ workspaceRoot, confirmedPlan, ...input });
    const stepId = confirmedPlan.payload.steps[0].stepId;
    const stepHandlers = { ...participant.stepHandlers, [stepId]: {
      ...participant.stepHandlers[stepId],
      commit() { process.kill(process.pid, "SIGKILL"); },
    } };
    await manager.runWakeflowMaintenanceMutation({
      workspaceRoot,
      action: "reconcile",
      operationKind: "local-layout-realization",
      domainOwner: "layout-manager",
      confirmedPlan,
      planDigest: canonical.canonicalJsonDigest(confirmedPlan),
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

  const transactionRoot = portablePath(
    workspaceRoot,
    ".wakeflow-local/runtime/maintenance/transactions",
  );
  const journalName = readdirSync(transactionRoot).find((name) => (
    /^workspace-mutation_[0-9a-f-]+\.json$/u.test(name)
  ));
  assert.equal(typeof journalName, "string", "prepared mode repair must retain one journal");
  const operationId = journalName.slice(0, -".json".length);
  const preparedJournal = JSON.parse(readFileSync(path.join(transactionRoot, journalName), "utf8"));
  assert.equal(preparedJournal.steps[0].status, "prepared");
  const originalIdentity = lstatSync(target);
  assert.equal(modeString(originalIdentity), "0755");

  const participant = createWakeflowLocalLayoutMutationParticipant({
    workspaceRoot,
    confirmedPlan,
    ...input,
  });
  const stepId = confirmedPlan.payload.steps[0].stepId;
  const realHandler = participant.stepHandlers[stepId];
  const displaced = path.join(displacedRoot, "preserved");
  let observeCount = 0;
  let replacementIdentity = null;
  const stepHandlers = {
    ...participant.stepHandlers,
    [stepId]: {
      ...realHandler,
      observe(args) {
        const observation = realHandler.observe(args);
        observeCount += 1;
        if (observeCount === 2) {
          renameSync(target, displaced);
          mkdirSync(target, { mode: 0o755 });
          chmodSync(target, 0o755);
          replacementIdentity = lstatSync(target);
        }
        return observation;
      },
    },
  };

  await assert.rejects(
    () => recoverWakeflowWorkspaceMutation({
      workspaceRoot,
      operationId,
      confirmedPlan,
      planDigest: canonicalJsonDigest(confirmedPlan),
      validatePlan: participant.validatePlan,
      deriveCurrentPlan: participant.deriveCurrentPlan,
      deriveTerminalClosure: participant.deriveTerminalClosure,
      stepHandlers,
    }),
    (error) => {
      const codes = [];
      for (let current = error; current; current = current.cause) codes.push(current.code);
      assert.equal(codes[0], "wakeflow-mutation-recovery-required");
      assert.ok(
        codes.includes("wakeflow-local-realization-race"),
        `recovery rejected for an unexpected reason: ${codes.join(" -> ")}`,
      );
      return true;
    },
  );

  assert.ok(observeCount >= 2, "recovery must reach its final precommit observation");
  assert.ok(replacementIdentity, "the race fixture must install a replacement inode");
  const displacedIdentity = lstatSync(displaced);
  assert.equal(String(displacedIdentity.dev), String(originalIdentity.dev));
  assert.equal(String(displacedIdentity.ino), String(originalIdentity.ino));
  assert.notEqual(
    `${replacementIdentity.dev}:${replacementIdentity.ino}`,
    `${originalIdentity.dev}:${originalIdentity.ino}`,
    "the replacement must be a distinct inode",
  );
  const replacementAfterRecovery = lstatSync(target);
  assert.equal(
    `${replacementAfterRecovery.dev}:${replacementAfterRecovery.ino}`,
    `${replacementIdentity.dev}:${replacementIdentity.ino}`,
    "recovery must leave the substituted inode in place for manual handling",
  );
  assert.equal(modeString(replacementAfterRecovery), "0755", "recovery must not chmod the replacement");
  assert.equal(modeString(displacedIdentity), "0755", "recovery must not chmod the displaced original");

  const residue = readdirSync(transactionRoot);
  assert.ok(residue.includes(journalName), "the recovery rejection must retain its journal evidence");
  assert.ok(
    residue.includes(`${operationId}.recovery-1.json`),
    "the recovery rejection must retain its takeover claim evidence",
  );
  const retainedJournal = JSON.parse(readFileSync(path.join(transactionRoot, journalName), "utf8"));
  assert.equal(retainedJournal.steps[0].status, "prepared");
  assert.equal(retainedJournal.ownerDisposition, "relinquished");
});
