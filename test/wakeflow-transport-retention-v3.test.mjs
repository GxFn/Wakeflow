import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  commitDemandBusinessArchive,
} from "../core/scripts/lib/wakeflow-business-archive-service.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  parseWakeflowConfigV3,
  serializeWakeflowConfigV3,
} from "../core/scripts/lib/wakeflow-config-v3.mjs";
import {
  publishInitialDemandPublication,
} from "../core/scripts/lib/wakeflow-demand-publication-service.mjs";
import {
  commitDemandLifecycleTransitionWhileLocked,
  loadDemandCoreRecordsWithArtifactClosure,
} from "../core/scripts/lib/wakeflow-demand-state-service.mjs";
import { withStateRootLock } from "../core/scripts/lib/wakeflow-state-lock.mjs";
import {
  createLedgerMemberReference,
  createLedgerRecord,
  loadLedgerRecord,
} from "../core/scripts/lib/wakeflow-ledger-records.mjs";
import {
  WakeflowTransportRetentionError,
  applyTransportDemandPrunePlan,
  planTransportDemandPrune,
  recoverTransportDemandPrune,
} from "../core/scripts/lib/wakeflow-transport-retention.mjs";
import {
  createWindowBindingRecord,
  windowBindingCanonicalBytes,
  windowBindingDigest,
  windowBindingRef,
} from "../core/scripts/lib/wakeflow-window-binding-records.mjs";
import {
  createWindowCoordinationLeaseRecord,
  windowCoordinationLeaseCanonicalBytes,
  windowCoordinationLeaseRef,
} from "../core/scripts/lib/wakeflow-window-lease-records.mjs";
import {
  parseWakeflowAssetBundle,
} from "../core/scripts/lib/wakeflow-template-renderer.mjs";
import {
  buildWakeflowAssetBundle,
} from "../tools/build-asset-bundle.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configFixturePath = path.join(
  repositoryRoot,
  "test/fixtures/wakeflow-config-v3/valid-minimal.json",
);
const sourceRoot = path.join(repositoryRoot, "core/template-sources");
const bundle = parseWakeflowAssetBundle(buildWakeflowAssetBundle({ sourceRoot }));
const retentionModuleUrl = new URL(
  "../core/scripts/lib/wakeflow-transport-retention.mjs",
  import.meta.url,
);
const expectedExports = Object.freeze([
  "WakeflowTransportRetentionError",
  "applyTransportDemandPrunePlan",
  "planTransportDemandPrune",
  "recoverTransportDemandPrune",
]);

const IDS = Object.freeze({
  program: "program_11111111-1111-4111-8111-111111111111",
  repository: "repository_22222222-2222-4222-8222-222222222222",
  controllerWindow: "window_55555555-5555-4555-8555-555555555555",
  productWindow: "window_88888888-8888-4888-8888-888888888888",
  demand: "demand_91919191-9191-4191-8191-919191919191",
  requirement: "requirement_92929292-9292-4292-8292-929292929292",
  archive: "archive_93939393-9393-4393-8393-939393939393",
  targetTask: "target-task_94949494-9494-4494-8494-949494949494",
  binding: "binding_95959595-9595-4595-8595-959595959595",
  lease: "lease_96969696-9696-4696-8696-969696969696",
});
const CREATED_AT = "2026-08-08T01:00:00.000Z";
const TERMINAL_AT = "2026-08-08T02:00:00.000Z";
const ARCHIVED_AT = "2026-08-08T03:00:00.000Z";
const HANDLE = "97000000-0000-4000-8000-000000000001";
const GROUP_ID = "group-m3-t09-retention-fixture";
const DELIVERY_ID = "delivery-m3-t09-retention-fixture";
const GROUP_DIGEST = `sha256:${"a".repeat(64)}`;
const ENVELOPE_DIGEST = `sha256:${"b".repeat(64)}`;

function digestBytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function ensurePrivateDirectory(workspaceRoot, ref) {
  let current = workspaceRoot;
  for (const segment of ref.split("/")) {
    current = path.join(current, segment);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    if (process.platform !== "win32") chmodSync(current, 0o700);
  }
  return current;
}

function writeExact(file, content, mode = 0o600) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, content, { mode });
  if (process.platform !== "win32") chmodSync(file, mode);
}

function configuredModel() {
  const raw = JSON.parse(readFileSync(configFixturePath, "utf8"));
  raw.program.interfaceLanguage = "en";
  raw.topology.repositories[0].path = "ProductA";
  raw.topology.supportSurfaces[0].path = "Design";
  raw.topology.supportSurfaces[1].path = "Test";
  raw.storage.ledgerRoot = "Ledger";
  return parseWakeflowConfigV3(raw);
}

function treeSnapshot(root) {
  const entries = {};
  const visit = (directory, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const file = path.join(directory, entry.name);
      const ref = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) {
        entries[ref] = `link:${readlinkSync(file)}`;
      } else if (stat.isDirectory()) {
        entries[`${ref}/`] = `directory:${stat.mode & 0o777}`;
        visit(file, ref);
      } else if (stat.isFile()) {
        entries[ref] = `file:${stat.mode & 0o777}:${readFileSync(file).toString("hex")}`;
      } else {
        entries[ref] = `special:${stat.mode & 0o170000}`;
      }
    }
  };
  visit(root);
  return entries;
}

function authorityDocuments() {
  return [
    "code-facts",
    "landing-plan",
    "non-goals",
    "original-plan",
    "requirement-design",
    "user-confirmation",
  ].map((role, index) => {
    const memberPath = `${String(index + 1).padStart(2, "0")}-${role}.md`;
    const content = `# ${role}\n\nM3-T09 retention fixture authority.\n`;
    return {
      role,
      path: memberPath,
      mediaType: "text/markdown",
      digest: digestBytes(content),
      content,
    };
  });
}

function currentStack(fixture) {
  return loadDemandCoreRecordsWithArtifactClosure({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
}

function expectedPrevious(stack) {
  return { revision: stack.state.revision, stateDigest: stack.digests.state };
}

function createArchivedEmptyTransportFixture(t) {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-transport-retention-v3-"));
  if (process.platform !== "win32") chmodSync(workspaceRoot, 0o700);
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const model = configuredModel();
  for (const ref of [
    ".wakeflow-active/current",
    ".wakeflow-local/runtime/maintenance/transactions",
    ".wakeflow-local/runtime/shared/coordination/window-leases",
    ".wakeflow-local/runtime/shared/transport/demands",
    ".wakeflow-local/runtime/hosts/codex/identity/window-bindings",
    "Design",
    "ProductA",
    "Test",
  ]) ensurePrivateDirectory(workspaceRoot, ref);
  for (const ref of [
    "Ledger",
    "Ledger/requirement-designs",
    "Ledger/goal-stage-confirmation",
    "Ledger/workspace/archive",
  ]) {
    const directory = path.join(workspaceRoot, ...ref.split("/"));
    mkdirSync(directory, { recursive: true, mode: 0o755 });
    if (process.platform !== "win32") chmodSync(directory, 0o755);
  }
  writeExact(
    path.join(workspaceRoot, "wakeflow.config.json"),
    serializeWakeflowConfigV3(model),
  );

  const ledgerRoot = path.join(workspaceRoot, model.storage.ledgerRoot);
  const documents = authorityDocuments();
  const createdRequirement = createLedgerRecord({
    ledgerRoot,
    expectedProgramId: IDS.program,
    record: {
      schemaVersion: 1,
      artifactKind: "wakeflow-requirement-record",
      requirementId: IDS.requirement,
      programId: IDS.program,
      title: "M3-T09 retention authority",
      status: "confirmed",
      relatedDemandIds: [IDS.demand],
      documents: documents.map(({ content: _content, ...document }) => document),
    },
    memberContents: Object.fromEntries(
      documents.map((document) => [document.path, document.content]),
    ),
  });
  const loadedRequirement = loadLedgerRecord({
    ledgerRoot,
    root: createdRequirement.root,
    expectedFamily: "requirement",
    expectedProgramId: IDS.program,
  });
  const authorityRefs = documents.map((document) => (
    createLedgerMemberReference(loadedRequirement, document.path)
  ));
  const demand = {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand",
    programId: IDS.program,
    demandId: IDS.demand,
    createdAt: CREATED_AT,
    title: "M3-T09 whole-demand transport retention fixture",
    goal: "Prove exact archived transport can be pruned without touching any sibling.",
    completionDefinition: "The terminal archive and the T02 release both close exactly.",
    demandType: "requirement",
    source: {
      schemaVersion: 1,
      artifactKind: "wakeflow-demand-ledger-source",
      memberRefs: authorityRefs,
    },
    executionPlacement: { mode: "main" },
  };
  const authority = {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand-authority",
    demandId: IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(demand),
    entryMode: "design-delivery",
    authorityRefs,
    testDecision: {
      mode: "controller-only",
      summary: "Only the bounded retention regression is required.",
    },
  };
  publishInitialDemandPublication({
    workspaceRoot,
    ledgerRoot,
    expectedProgramId: IDS.program,
    bundle,
    language: "en",
    demand,
    authority,
    initialTransition: {
      eventId: "event-retention-initial-0001",
      createdAt: CREATED_AT,
      reason: "publish one strict retention fixture",
      decisionSummary: "Publish exact ledger-backed authority before terminal closure.",
    },
    expectedTodoRow: null,
  });
  const stateRoot = path.join(workspaceRoot, ".wakeflow-active/current", IDS.demand);
  let stack = loadDemandCoreRecordsWithArtifactClosure({
    stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot,
  });
  const terminalEvent = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: "event-retention-completed-0002",
    demandId: IDS.demand,
    createdAt: TERMINAL_AT,
    actor: "controller",
    command: "complete-demand",
    type: "demand.completed",
    previousRevision: stack.state.revision,
    nextRevision: stack.state.revision + 1,
    from: stack.state.state,
    to: "completed",
    reason: "close the exact zero-task retention fixture",
    decisionSummary: "The zero-task fixture has no unresolved business work.",
    changedArtifacts: [],
    lifecycleTransition: { action: "complete" },
  };
  const nextState = structuredClone(stack.state);
  nextState.revision = terminalEvent.nextRevision;
  nextState.state = terminalEvent.to;
  nextState.stateReason = terminalEvent.reason;
  nextState.updatedAt = terminalEvent.createdAt;
  nextState.lastEvent = {
    eventId: terminalEvent.eventId,
    eventDigest: canonicalJsonDigest(terminalEvent),
  };
  withStateRootLock(stateRoot, () => commitDemandLifecycleTransitionWhileLocked({
    stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot,
    expectedPrevious: expectedPrevious(stack),
    event: terminalEvent,
    nextState,
  }));

  const transportRoot = path.join(
    workspaceRoot,
    ".wakeflow-local/runtime/shared/transport/demands",
    IDS.demand,
  );
  for (const directoryName of ["groups", "packets", "envelopes", "runs"]) {
    ensurePrivateDirectory(
      workspaceRoot,
      `.wakeflow-local/runtime/shared/transport/demands/${IDS.demand}/${directoryName}`,
    );
  }
  stack = currentStack({ stateRoot, ledgerRoot });
  const archived = commitDemandBusinessArchive({
    workspaceRoot,
    expectedProgramId: IDS.program,
    demandId: IDS.demand,
    archiveId: IDS.archive,
    archivedAt: ARCHIVED_AT,
    archiveEventId: "event-retention-archive-0003",
    archiveReason: "freeze exact terminal business and T06 authority",
    conclusion: "The disposable demand is terminal and its transport inventory is empty.",
    expectedPrevious: expectedPrevious(stack),
  });
  return Object.freeze({
    workspaceRoot,
    ledgerRoot,
    stateRoot,
    transportRoot,
    archiveRoot: path.join(ledgerRoot, "workspace/archive/2026-08", IDS.archive),
    archived,
  });
}

function retentionInput(fixture) {
  return {
    workspaceRoot: fixture.workspaceRoot,
    expectedProgramId: IDS.program,
    demandId: IDS.demand,
    archiveId: IDS.archive,
  };
}

function writeMatchingLease(fixture) {
  const binding = createWindowBindingRecord({
    programId: IDS.program,
    hostId: "codex",
    windowId: IDS.productWindow,
    bindingId: IDS.binding,
    handle: { kind: "codex-thread", value: HANDLE },
    registeredAt: ARCHIVED_AT,
  });
  const bindingRef = windowBindingRef({
    hostDirName: "codex",
    windowId: IDS.productWindow,
  });
  writeExact(
    path.join(fixture.workspaceRoot, ...bindingRef.split("/")),
    windowBindingCanonicalBytes(binding),
  );
  const lease = createWindowCoordinationLeaseRecord({
    programId: IDS.program,
    hostId: "codex",
    windowId: IDS.productWindow,
    leaseId: IDS.lease,
    demandId: IDS.demand,
    targetTaskId: IDS.targetTask,
    groupId: GROUP_ID,
    groupDigest: GROUP_DIGEST,
    deliveryId: DELIVERY_ID,
    envelopeDigest: ENVELOPE_DIGEST,
    bindingId: IDS.binding,
    identityBindingDigest: windowBindingDigest(binding),
    repositoryId: IDS.repository,
    checkoutResourceKey: `main:${IDS.repository}`,
    acquiredAt: ARCHIVED_AT,
    expiresAt: "2026-08-09T03:00:00.000Z",
  });
  const leaseRef = windowCoordinationLeaseRef({ windowId: IDS.productWindow });
  writeExact(
    path.join(fixture.workspaceRoot, ...leaseRef.split("/")),
    windowCoordinationLeaseCanonicalBytes(lease),
  );
}

test("M3-T09 candidate exposes only the archive-gated whole-demand retention boundary", async () => {
  const retention = await import(retentionModuleUrl.href);
  assert.deepEqual(Object.keys(retention).sort(), [...expectedExports].sort());
});

test("M3-T09 retention public inputs stay passive and blocker order is locale-independent", async () => {
  const source = readFileSync(fileURLToPath(retentionModuleUrl), "utf8");
  assert.doesNotMatch(source, /\.localeCompare\(/u);

  let getterCalls = 0;
  const accessorInput = {};
  Object.defineProperty(accessorInput, "workspaceRoot", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "/must-not-be-read";
    },
  });
  const isContractError = (error) => error instanceof WakeflowTransportRetentionError
    && error.code === "wakeflow-transport-retention-contract";
  assert.throws(() => planTransportDemandPrune(accessorInput), isContractError);
  await assert.rejects(() => applyTransportDemandPrunePlan(accessorInput), isContractError);
  await assert.rejects(() => recoverTransportDemandPrune(accessorInput), isContractError);
  assert.equal(getterCalls, 0);

  const hiddenInput = {};
  Object.defineProperty(hiddenInput, "workspaceRoot", {
    enumerable: false,
    value: "/must-not-be-admitted",
  });
  assert.throws(() => planTransportDemandPrune(hiddenInput), isContractError);
  assert.throws(
    () => planTransportDemandPrune({ [Symbol("workspaceRoot")]: "/must-not-be-admitted" }),
    isContractError,
  );
});

test("M3-T09 plans zero-write and prunes one archived demand root without touching siblings", async (t) => {
  const fixture = createArchivedEmptyTransportFixture(t);
  const legacyFile = path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/legacy-transport/demands",
    IDS.demand,
    "private.json",
  );
  writeExact(legacyFile, "{\"legacy\":true}\n");
  const archiveBefore = treeSnapshot(fixture.archiveRoot);
  const beforePlan = treeSnapshot(fixture.workspaceRoot);
  const planned = planTransportDemandPrune(retentionInput(fixture));

  assert.deepEqual(treeSnapshot(fixture.workspaceRoot), beforePlan);
  assert.equal(planned.plan.payload.disposition, "eligible");
  assert.deepEqual(planned.plan.payload.blockers, []);
  assert.equal(planned.plan.payload.steps.length, 1);
  assert.deepEqual(planned.plan.payload.steps[0], {
    stepId: "release-archived-transport-demand",
    ordinal: 0,
    stepKind: "remove",
    source: {
      ref: `.wakeflow-local/runtime/shared/transport/demands/${IDS.demand}`,
      type: "directory",
      mode: "0700",
      digest: planned.plan.payload.archive.transportSummary.inventoryDigest,
    },
    staging: {
      ref: `.wakeflow-local/runtime/shared/transport/demands/.${IDS.demand}.${IDS.archive}.wakeflow-prune-stage`,
      type: "directory",
      mode: "0700",
      digest: planned.plan.payload.archive.transportSummary.inventoryDigest,
    },
    final: {
      ref: `.wakeflow-local/runtime/shared/transport/demands/${IDS.demand}`,
      type: "absent",
    },
  });

  const applied = await applyTransportDemandPrunePlan({
    ...retentionInput(fixture),
    ...planned,
  });
  assert.equal(applied.status, "completed");
  assert.equal(applied.demandId, IDS.demand);
  assert.equal(applied.archiveId, IDS.archive);
  assert.equal(existsSync(fixture.transportRoot), false);
  assert.equal(
    existsSync(path.join(
      path.dirname(fixture.transportRoot),
      `.${IDS.demand}.${IDS.archive}.wakeflow-prune-stage`,
    )),
    false,
  );
  assert.equal(readFileSync(legacyFile, "utf8"), "{\"legacy\":true}\n");
  assert.deepEqual(treeSnapshot(fixture.archiveRoot), archiveBefore);
  assert.deepEqual(
    readdirSync(path.join(fixture.workspaceRoot, ".wakeflow-local/runtime/maintenance/transactions")),
    [],
  );
  assert.equal(
    existsSync(path.join(fixture.workspaceRoot, ".wakeflow-local/runtime/maintenance.lock")),
    false,
  );

  const absent = planTransportDemandPrune(retentionInput(fixture));
  assert.equal(absent.plan.payload.disposition, "source-absent");
  assert.deepEqual(absent.plan.payload.steps, []);
  const beforeReplay = treeSnapshot(fixture.workspaceRoot);
  const replay = await applyTransportDemandPrunePlan({
    ...retentionInput(fixture),
    ...absent,
  });
  assert.deepEqual(replay, { status: "source-absent", planDigest: absent.planDigest });
  assert.deepEqual(treeSnapshot(fixture.workspaceRoot), beforeReplay);
});

test("M3-T09 rejects time heuristics and blocks an exact unresolved demand lease without writing", async (t) => {
  const fixture = createArchivedEmptyTransportFixture(t);
  const beforeUnknownInput = treeSnapshot(fixture.workspaceRoot);
  for (const extra of [
    { now: "2026-08-08T10:00:00.000Z" },
    { cutoff: "2026-08-01T00:00:00.000Z" },
    { retentionDays: 7 },
  ]) {
    assert.throws(
      () => planTransportDemandPrune({ ...retentionInput(fixture), ...extra }),
      (error) => error instanceof WakeflowTransportRetentionError
        && error.code === "wakeflow-transport-retention-contract",
    );
  }
  assert.deepEqual(treeSnapshot(fixture.workspaceRoot), beforeUnknownInput);

  writeMatchingLease(fixture);
  const beforePlan = treeSnapshot(fixture.workspaceRoot);
  const planned = planTransportDemandPrune(retentionInput(fixture));
  assert.deepEqual(treeSnapshot(fixture.workspaceRoot), beforePlan);
  assert.equal(planned.plan.payload.disposition, "blocked");
  assert.deepEqual(planned.plan.payload.steps, []);
  assert.equal(
    planned.plan.payload.blockers.some((blocker) => (
      blocker.scope === "lease" && blocker.code === "active-demand-lease"
    )),
    true,
  );
  await assert.rejects(
    () => applyTransportDemandPrunePlan({ ...retentionInput(fixture), ...planned }),
    (error) => error instanceof WakeflowTransportRetentionError
      && error.code === "wakeflow-transport-retention-blocked",
  );
  assert.deepEqual(treeSnapshot(fixture.workspaceRoot), beforePlan);
  assert.equal(existsSync(fixture.transportRoot), true);
});

test("M3-T09 fails closed on archive or live-inventory corruption and never detaches the source", (t) => {
  const corruptLive = createArchivedEmptyTransportFixture(t);
  writeExact(path.join(corruptLive.transportRoot, "unknown.json"), "{}\n");
  const beforeLivePlan = treeSnapshot(corruptLive.workspaceRoot);
  const livePlan = planTransportDemandPrune(retentionInput(corruptLive));
  assert.equal(livePlan.plan.payload.disposition, "blocked");
  assert.equal(
    livePlan.plan.payload.blockers.some((blocker) => (
      blocker.scope === "transport" && blocker.code === "transport-inventory-unavailable"
    )),
    true,
  );
  assert.deepEqual(treeSnapshot(corruptLive.workspaceRoot), beforeLivePlan);
  assert.equal(existsSync(corruptLive.transportRoot), true);

  const corruptArchive = createArchivedEmptyTransportFixture(t);
  writeExact(path.join(corruptArchive.archiveRoot, "transport-summary.json"), "{}\n");
  const beforeArchivePlan = treeSnapshot(corruptArchive.workspaceRoot);
  const archivePlan = planTransportDemandPrune(retentionInput(corruptArchive));
  assert.equal(archivePlan.plan.payload.disposition, "blocked");
  assert.deepEqual(archivePlan.plan.payload.blockers, [{
    code: "archive-unavailable",
    scope: "archive",
  }]);
  assert.deepEqual(treeSnapshot(corruptArchive.workspaceRoot), beforeArchivePlan);
  assert.equal(existsSync(corruptArchive.transportRoot), true);
});

function interruptTransportCleanup(fixture, planned, failOnCall) {
  const childSource = `
    import fs from "node:fs";
    import { applyTransportDemandPrunePlan } from ${JSON.stringify(retentionModuleUrl.href)};
    const [workspaceRoot, planJson, planDigest, failOnCallText] = process.argv.slice(1);
    const plan = JSON.parse(planJson);
    const failOnCall = Number(failOnCallText);
    const originalRmdirSync = fs.rmdirSync;
    let calls = 0;
    fs.rmdirSync = function injectedTransportCleanupFailure(...args) {
      calls += 1;
      if (calls === failOnCall) {
        const error = new Error("synthetic post-rename transport cleanup interruption");
        error.code = "EIO";
        throw error;
      }
      return originalRmdirSync.apply(this, args);
    };
    try {
      await applyTransportDemandPrunePlan({
        workspaceRoot,
        expectedProgramId: ${JSON.stringify(IDS.program)},
        demandId: ${JSON.stringify(IDS.demand)},
        archiveId: ${JSON.stringify(IDS.archive)},
        plan,
        planDigest,
      });
      process.stderr.write("transport cleanup interruption fixture unexpectedly completed");
      process.exitCode = 4;
    } catch (error) {
      process.stderr.write(String(error?.code ?? error?.message ?? error));
      process.exitCode = error?.code === "wakeflow-transport-retention-recovery-required" ? 3 : 5;
    }
  `;
  const child = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    childSource,
    fixture.workspaceRoot,
    JSON.stringify(planned.plan),
    planned.planDigest,
    String(failOnCall),
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(child.status, 3, child.stderr);
  assert.match(child.stderr, /wakeflow-transport-retention-recovery-required/u);
  assert.equal(existsSync(fixture.transportRoot), false);
  const stageRoot = path.join(
    path.dirname(fixture.transportRoot),
    `.${IDS.demand}.${IDS.archive}.wakeflow-prune-stage`,
  );
  assert.equal(existsSync(stageRoot), true);
  const transactionsRoot = path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/runtime/maintenance/transactions",
  );
  const journals = readdirSync(transactionsRoot)
    .filter((name) => /^workspace-mutation_[0-9a-f-]+\.json$/u.test(name));
  assert.equal(journals.length, 1);
  return Object.freeze({
    stageRoot,
    transactionsRoot,
    operationId: journals[0].slice(0, -".json".length),
  });
}

test("M3-T09 recovery resumes both full-stage and deterministic partial cleanup prefixes", async (t) => {
  for (const failOnCall of [1, 3]) {
    const fixture = createArchivedEmptyTransportFixture(t);
    const planned = planTransportDemandPrune(retentionInput(fixture));
    const archiveBefore = treeSnapshot(fixture.archiveRoot);
    const { stageRoot, transactionsRoot, operationId } = interruptTransportCleanup(
      fixture,
      planned,
      failOnCall,
    );
    const recovered = await recoverTransportDemandPrune({
      ...retentionInput(fixture),
      operationId,
      ...planned,
    });
    assert.equal(recovered.status, "terminal-cleanup-recovered");
    assert.equal(recovered.operationId, operationId);
    assert.equal(recovered.recoveryGeneration, 1);
    assert.equal(existsSync(stageRoot), false);
    assert.equal(existsSync(fixture.transportRoot), false);
    assert.deepEqual(treeSnapshot(fixture.archiveRoot), archiveBefore);
    assert.deepEqual(readdirSync(transactionsRoot), []);
    assert.equal(
      existsSync(path.join(fixture.workspaceRoot, ".wakeflow-local/runtime/maintenance.lock")),
      false,
    );
  }
});

test("M3-T09 recovery preserves unknown and non-prefix stage residue", async (t) => {
  for (const residue of ["unknown-member", "non-prefix-hole"]) {
    const fixture = createArchivedEmptyTransportFixture(t);
    const planned = planTransportDemandPrune(retentionInput(fixture));
    const interrupted = interruptTransportCleanup(fixture, planned, 1);
    if (residue === "unknown-member") {
      writeExact(path.join(interrupted.stageRoot, "rogue.json"), "{}\n");
    } else {
      rmdirSync(path.join(interrupted.stageRoot, "packets"));
    }
    const stageBefore = treeSnapshot(interrupted.stageRoot);
    const archiveBefore = treeSnapshot(fixture.archiveRoot);
    await assert.rejects(
      () => recoverTransportDemandPrune({
        ...retentionInput(fixture),
        operationId: interrupted.operationId,
        ...planned,
      }),
      (error) => error instanceof WakeflowTransportRetentionError
        && error.code === "wakeflow-transport-retention-recovery-required",
    );
    assert.equal(existsSync(fixture.transportRoot), false);
    assert.equal(existsSync(interrupted.stageRoot), true);
    assert.deepEqual(treeSnapshot(interrupted.stageRoot), stageBefore);
    assert.deepEqual(treeSnapshot(fixture.archiveRoot), archiveBefore);
  }
});

test("M3-T09 declares separate portable transport-summary and maintenance-plan schemas", () => {
  const contracts = [
    {
      file: "core/schemas/wakeflow-business-archive/transport-summary.schema.json",
      id: "urn:wakeflow:internal:business-archive:transport-summary:v1",
      kind: "wakeflow-business-archive-transport-summary",
    },
    {
      file: "core/schemas/wakeflow-maintenance/transport-retention-plan.schema.json",
      id: "urn:wakeflow:internal:maintenance:transport-retention-plan:v1",
      kind: "wakeflow-transport-retention-plan",
    },
  ];
  for (const contract of contracts) {
    const absolute = path.join(repositoryRoot, contract.file);
    assert.equal(existsSync(absolute), true, contract.file);
    const schema = JSON.parse(readFileSync(absolute, "utf8"));
    assert.equal(schema.$id, contract.id, contract.file);
    assert.equal(schema.type, "object", contract.file);
    assert.equal(schema.additionalProperties, false, contract.file);
    const artifactKind = schema.properties.artifactKind
      ?? schema.$defs?.payload?.properties?.artifactKind;
    assert.equal(artifactKind?.const, contract.kind, contract.file);
  }
});

test("M3-T09 has no retired public-v2 prune surface", () => {
  const retiredPublicFiles = [
    "core/scripts/wakeflow-delivery.mjs",
    "core/scripts/wakeflow-runtime.mjs",
    "core/scripts/wakeflow-state.mjs",
    "core/scripts/lib/wakeflow-delivery-store.mjs",
  ];
  for (const relativeFile of retiredPublicFiles) {
    assert.equal(existsSync(path.join(repositoryRoot, relativeFile)), false, relativeFile);
  }
});
