import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertBusinessArchivePortable,
  businessArchiveCanonicalBytes,
  validateBusinessArchivePlan,
  validateBusinessArchiveSummary,
  validateBusinessArchiveTransaction,
} from "../core/scripts/lib/wakeflow-business-archive-records.mjs";
import { WAKEFLOW_DEMAND_ARTIFACT_KINDS } from "../core/scripts/lib/wakeflow-demand-artifact-records.mjs";
import {
  WakeflowBusinessArchiveError,
  commitDemandBusinessArchive,
  planDemandBusinessArchive,
  recoverDemandBusinessArchive,
} from "../core/scripts/lib/wakeflow-business-archive-service.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import { loadWakeflowConfigV3Snapshot } from "../core/scripts/lib/wakeflow-config-v3-snapshot.mjs";
import {
  parseWakeflowConfigV3,
  serializeWakeflowConfigV3,
} from "../core/scripts/lib/wakeflow-config-v3.mjs";
import {
  createReviewCandidateArtifact,
  createTaskPackageArtifact,
  createTestCardArtifact,
  recordTargetResultArtifact,
} from "../core/scripts/lib/wakeflow-demand-artifact-service.mjs";
import { publishInitialDemandPublication } from "../core/scripts/lib/wakeflow-demand-publication-service.mjs";
import {
  commitDemandLifecycleTransitionWhileLocked,
  loadDemandCoreRecordsWithArtifactClosure,
} from "../core/scripts/lib/wakeflow-demand-state-service.mjs";
import { withStateRootLock } from "../core/scripts/lib/wakeflow-state-lock.mjs";
import {
  applyManagedEvidenceImport,
  planManagedEvidenceImport,
} from "../core/scripts/lib/wakeflow-evidence-importer.mjs";
import {
  createLedgerMemberReference,
  createLedgerRecord,
  loadLedgerRecord,
} from "../core/scripts/lib/wakeflow-ledger-records.mjs";
import { buildLedgerProjection } from "../core/scripts/lib/wakeflow-ledger-projector.mjs";
import { parseWakeflowAssetBundle } from "../core/scripts/lib/wakeflow-template-renderer.mjs";
import * as todoService from "../core/scripts/lib/wakeflow-todo-service.mjs";
import { buildWakeflowAssetBundle } from "../tools/build-asset-bundle.mjs";
import {
  createDeliveryRunRecord,
  createDispatchGroupRecord,
  createDispatchPacketRecord,
  createTargetDeliveryEnvelopeRecord,
  deliveryEnvelopeCanonicalBytes,
  deliveryEnvelopeRef,
  deliveryRunCanonicalBytes,
  dispatchGroupCanonicalBytes,
  dispatchGroupRef,
  dispatchPacketCanonicalBytes,
} from "../core/scripts/lib/wakeflow-transport-records.mjs";
import {
  createWindowBindingRecord,
  windowBindingDigest,
} from "../core/scripts/lib/wakeflow-window-binding-records.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configFixturePath = path.join(
  repositoryRoot,
  "test/fixtures/wakeflow-config-v3/valid-minimal.json",
);
const sourceRoot = path.join(repositoryRoot, "core/template-sources");
const bundle = parseWakeflowAssetBundle(buildWakeflowAssetBundle({ sourceRoot }));

const IDS = Object.freeze({
  program: "program_11111111-1111-4111-8111-111111111111",
  demand: "demand_22222222-2222-4222-8222-222222222222",
  requirement: "requirement_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  archive: "archive_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  repository: "repository_22222222-2222-4222-8222-222222222222",
  controllerWindow: "window_55555555-5555-4555-8555-555555555555",
  designWindow: "window_66666666-6666-4666-8666-666666666666",
  testWindow: "window_77777777-7777-4777-8777-777777777777",
  productWindow: "window_88888888-8888-4888-8888-888888888888",
  taskPackage: "task-package_66666666-6666-4666-8666-666666666666",
  targetTask: "target-task_77777777-7777-4777-8777-777777777777",
  targetResult: "target-result_88888888-8888-4888-8888-888888888888",
  reviewCandidate: "review-candidate_99999999-9999-4999-8999-999999999999",
  testCard: "test-card_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  transportGroup: "dispatch-group_36363636-3636-4636-8636-363636363636",
  transportPacket: "dispatch-packet_37373737-3737-4737-8737-373737373737",
  transportDelivery: "delivery_38383838-3838-4838-8838-383838383838",
  transportRun: "delivery-run_39393939-3939-4939-8939-393939393939",
  transportBinding: "binding_40404040-4040-4040-8040-404040404040",
});

const CREATED_AT = "2026-08-07T01:00:00.000Z";
const PACKAGE_AT = "2026-08-07T02:00:00.000Z";
const DISPATCH_AT = "2026-08-07T02:10:00.000Z";
const RESULT_AT = "2026-08-07T02:20:00.000Z";
const REVIEW_AT = "2026-08-07T02:30:00.000Z";
const ACCEPT_AT = "2026-08-07T03:00:00.000Z";
const TERMINAL_AT = "2026-08-07T04:00:00.000Z";
const ARCHIVED_AT = "2026-08-07T05:00:00.000Z";

function byteDigest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function mkdirExact(directory, mode) {
  mkdirSync(directory, { recursive: true, mode });
  if (process.platform !== "win32") chmodSync(directory, mode);
}

function writeExact(file, content, mode = 0o600) {
  mkdirExact(path.dirname(file), 0o700);
  writeFileSync(file, content, { mode });
  if (process.platform !== "win32") chmodSync(file, mode);
}

function writeCanonical(file, value) {
  writeExact(file, `${canonicalJson(value)}\n`);
}

function materializeAcceptedTransport(fixture, stack, pkg) {
  const group = createDispatchGroupRecord({
    programId: IDS.program,
    demandId: IDS.demand,
    groupId: IDS.transportGroup,
    stateRevision: stack.state.revision,
    controllerWindowId: IDS.controllerWindow,
    members: [{
      windowId: IDS.productWindow,
      targetTaskId: IDS.targetTask,
      packetId: IDS.transportPacket,
    }],
    returnPolicy: { mode: "group-ready" },
    createdAt: DISPATCH_AT,
  });
  const packet = createDispatchPacketRecord({
    programId: IDS.program,
    demandId: IDS.demand,
    groupId: group.groupId,
    groupDigest: group.groupDigest,
    packetId: IDS.transportPacket,
    windowId: IDS.productWindow,
    targetTaskId: IDS.targetTask,
    taskPackageId: IDS.taskPackage,
    taskPackageDigest: canonicalJsonDigest(pkg),
    objective: pkg.objective,
    taskBriefing: {
      workType: "implementation",
      confirmedContext: pkg.confirmedContext,
      completionExpectations: pkg.completionExpectations,
      requiredSkills: [
        "skills/wakeflow-target/SKILL.md",
        "skills/wakeflow-target-craft/SKILL.md",
      ],
      commitExpectation: pkg.commitExpectation,
    },
    boundaries: pkg.boundaries,
    acceptanceAnchors: pkg.acceptanceAnchors,
    designIntent: "Preserve the exact archive fixture authority.",
    reviewInputContract: pkg.reviewInputContract,
    resultContract: {
      artifactKind: "wakeflow-target-result",
      schemaVersion: 1,
    },
    contextPolicy: "refresh-if-missing",
    prompt: "Execute only this immutable disposable archive packet and return one TargetResult.",
    createdAt: "2026-08-07T02:10:01.000Z",
  });
  const binding = createWindowBindingRecord({
    programId: IDS.program,
    hostId: "codex",
    windowId: IDS.productWindow,
    bindingId: IDS.transportBinding,
    handle: { kind: "codex-thread", value: "41414141-4141-4141-8141-414141414141" },
    registeredAt: "2026-08-07T02:10:02.000Z",
  });
  const envelope = createTargetDeliveryEnvelopeRecord({
    programId: IDS.program,
    demandId: IDS.demand,
    deliveryId: IDS.transportDelivery,
    groupId: group.groupId,
    groupDigest: group.groupDigest,
    packetId: packet.packetId,
    packetDigest: packet.packetDigest,
    preparedByHostId: "codex",
    windowId: IDS.productWindow,
    bindingId: binding.bindingId,
    identityBindingDigest: windowBindingDigest(binding),
    prompt: packet.prompt,
    oneShot: true,
    transportPolicy: {
      kind: "direct-thread",
      missingIdentity: "rejected-before-send",
    },
    readbackPolicy: { required: true, maxObservations: 1 },
    automationRequested: false,
    createdAt: "2026-08-07T02:10:03.000Z",
  });
  const run = createDeliveryRunRecord({
    programId: IDS.program,
    demandId: IDS.demand,
    runId: IDS.transportRun,
    deliveryId: envelope.deliveryId,
    envelopeDigest: envelope.envelopeDigest,
    hostId: "codex",
    windowId: IDS.productWindow,
    attemptOrdinal: 1,
    hostMethod: "send_message_to_thread",
    hostMode: "new-turn",
    transportStatus: "accepted",
    readback: {
      status: "confirmed",
      attempts: 1,
      evidence: [{ kind: "host-readback", digest: `sha256:${"6".repeat(64)}` }],
    },
    createdAt: "2026-08-07T02:10:04.000Z",
  });
  const demandRoot = path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/runtime/shared/transport/demands",
    IDS.demand,
  );
  for (const directory of ["groups", "packets", "envelopes", "runs"]) {
    mkdirExact(path.join(demandRoot, directory), 0o700);
  }
  writeExact(path.join(demandRoot, "groups", `${group.groupId}.json`), dispatchGroupCanonicalBytes(group));
  writeExact(path.join(demandRoot, "packets", `${packet.packetId}.json`), dispatchPacketCanonicalBytes(packet));
  writeExact(path.join(demandRoot, "envelopes", `${envelope.deliveryId}.json`), deliveryEnvelopeCanonicalBytes(envelope));
  writeExact(path.join(demandRoot, "runs", `${run.runId}.json`), deliveryRunCanonicalBytes(run));
  return { group, packet, envelope, run };
}

function overwriteCanonicalLedgerFile(file, value) {
  writeFileSync(file, `${canonicalJson(value)}\n`, { mode: 0o644 });
  if (process.platform !== "win32") chmodSync(file, 0o644);
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

function relative(root, ref) {
  return path.join(root, ...ref.split("/"));
}

function authorityDocuments({ realEnvironment = false } = {}) {
  const roles = [
    "code-facts",
    "landing-plan",
    "non-goals",
    "original-plan",
    "requirement-design",
    "user-confirmation",
  ];
  if (realEnvironment) roles.push("test-environment");
  return roles.map((role, index) => {
    const memberPath = `${String(index + 1).padStart(2, "0")}-${role}.md`;
    const content = `# ${role}\n\nDisposable recovery fixture authority.\n`;
    return {
      role,
      path: memberPath,
      mediaType: "text/markdown",
      digest: byteDigest(content),
      content,
    };
  });
}

function todoRow(todoId, item = `Archive ${todoId}`) {
  return {
    ID: todoId,
    Status: "pending-claim",
    Type: "requirement",
    Priority: "P1",
    Owner: IDS.designWindow,
    "Item / Goal": item,
    "Affects Retest / Dispatch": "yes",
    "Dependency / Trigger": "confirmed requirement",
    "Recommended Window": IDS.controllerWindow,
    "Current Mount": "none",
    "Auto Claim": "yes",
    "Testing Decision": "controller-only: run bounded candidate tests",
    Documents: `[original-plan](requirement-designs/${IDS.requirement}/01-original-plan.md)`,
  };
}

function makeFixture(t, { todoBacked = false, secondTodo = false, realEnvironment = false } = {}) {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-business-archive-recovery-"));
  t?.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const model = configuredModel();
  const currentRoot = path.join(workspaceRoot, ".wakeflow-active", "current");
  mkdirExact(currentRoot, 0o700);
  mkdirExact(
    path.join(workspaceRoot, ".wakeflow-local/runtime/shared/transport/demands"),
    0o700,
  );
  for (const ref of ["ProductA", "Design", "Test"]) mkdirExact(relative(workspaceRoot, ref), 0o700);
  for (const ref of [
    "Ledger",
    "Ledger/requirement-designs",
    "Ledger/goal-stage-confirmation",
    "Ledger/workspace/archive",
  ]) {
    mkdirExact(relative(workspaceRoot, ref), 0o755);
  }
  const configPath = path.join(workspaceRoot, "wakeflow.config.json");
  writeExact(configPath, serializeWakeflowConfigV3(model));
  const ledgerRoot = path.join(workspaceRoot, "Ledger");
  const boardPath = path.join(currentRoot, "global-todo-board.md");

  let source;
  let authority = null;
  let authorityRefs = [];
  let expectedTodoRow = null;
  if (todoBacked) {
    todoService.createTodoBoardIfAbsent({ root: workspaceRoot, boardPath, freshWorkspace: true });
    todoService.appendTodoRow({ root: workspaceRoot, boardPath, row: todoRow("TODO-M2-T09") });
    if (secondTodo) {
      todoService.appendTodoRow({
        root: workspaceRoot,
        boardPath,
        row: todoRow("TODO-M2-T09-OTHER", "Preserve the unrelated row"),
      });
    }
    const row = todoService.scanTodoBoard(readFileSync(boardPath, "utf8")).rows
      .find((entry) => entry.id === "TODO-M2-T09");
    source = row.lineageRef;
    expectedTodoRow = row.snapshot;
  } else {
    const documents = authorityDocuments({ realEnvironment });
    const created = createLedgerRecord({
      ledgerRoot,
      expectedProgramId: IDS.program,
      record: {
        schemaVersion: 1,
        artifactKind: "wakeflow-requirement-record",
        requirementId: IDS.requirement,
        programId: IDS.program,
        title: "Business archive recovery authority",
        status: "confirmed",
        relatedDemandIds: [IDS.demand],
        documents: documents.map(({ content: _content, ...document }) => document),
      },
      memberContents: Object.fromEntries(documents.map((document) => [document.path, document.content])),
    });
    const loaded = loadLedgerRecord({
      ledgerRoot,
      root: created.root,
      expectedFamily: "requirement",
      expectedProgramId: IDS.program,
    });
    authorityRefs = documents.map((document) => createLedgerMemberReference(loaded, document.path));
    source = {
      schemaVersion: 1,
      artifactKind: "wakeflow-demand-ledger-source",
      memberRefs: authorityRefs,
    };
  }

  const demand = {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand",
    programId: IDS.program,
    demandId: IDS.demand,
    createdAt: CREATED_AT,
    title: todoBacked ? "TODO-backed business archive" : "Ledger-backed business archive",
    goal: "Verify forward-only typed business archive recovery.",
    completionDefinition: "The immutable ledger archive closes before exact source removal.",
    demandType: "requirement",
    source,
    executionPlacement: { mode: "main" },
  };
  if (!todoBacked) {
    authority = {
      schemaVersion: 1,
      artifactKind: "wakeflow-demand-authority",
      demandId: IDS.demand,
      demandRef: "demand.json",
      demandDigest: canonicalJsonDigest(demand),
      entryMode: "design-delivery",
      authorityRefs,
      testDecision: {
        mode: realEnvironment ? "real-environment" : "controller-only",
        summary: realEnvironment
          ? "Run the approved disposable Test environment scenario."
          : "Run only disposable business archive recovery regressions.",
        ...(realEnvironment ? {
          environmentSpecRef: authorityRefs.find((entry) => entry.role === "test-environment").memberRef,
        } : {}),
      },
    };
  }

  publishInitialDemandPublication({
    workspaceRoot,
    ledgerRoot,
    expectedProgramId: IDS.program,
    bundle,
    language: "en",
    demand,
    authority,
    initialTransition: {
      eventId: "event-business-archive-recovery-initial-0001",
      createdAt: CREATED_AT,
      reason: "publish one disposable strict recovery fixture",
      decisionSummary: "Publish the exact initial authority before terminal closure.",
    },
    expectedTodoRow,
  });

  return {
    workspaceRoot,
    currentRoot,
    stateRoot: path.join(currentRoot, IDS.demand),
    ledgerRoot,
    configPath,
    boardPath,
    model,
    demand,
    authority,
    authorityRefs,
    todoBacked,
  };
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

function appendManualTransition(fixture, event, mutate) {
  const stack = currentStack(fixture);
  const nextState = structuredClone(stack.state);
  nextState.revision = event.nextRevision;
  nextState.state = event.to;
  nextState.stateReason = event.reason;
  nextState.updatedAt = event.createdAt;
  nextState.lastEvent = { eventId: event.eventId, eventDigest: canonicalJsonDigest(event) };
  mutate(nextState);
  writeExact(
    path.join(fixture.stateRoot, "controller-events.jsonl"),
    `${stack.events.map((entry) => canonicalJson(entry)).join("\n")}\n${canonicalJson(event)}\n`,
  );
  writeCanonical(path.join(fixture.stateRoot, "wakeflow-state.json"), nextState);
  return currentStack(fixture);
}

function terminalize(fixture, { terminalAt = TERMINAL_AT, state = "completed" } = {}) {
  const stack = currentStack(fixture);
  const event = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: `event-business-archive-recovery-terminal-${stack.state.revision + 1}`,
    demandId: IDS.demand,
    createdAt: terminalAt,
    actor: "controller",
    command: state === "completed" ? "complete-demand" : "cancel-demand",
    type: `demand.${state}`,
    previousRevision: stack.state.revision,
    nextRevision: stack.state.revision + 1,
    from: stack.state.state,
    to: state,
    reason: "close the exact disposable business archive fixture",
    decisionSummary: "No open package, review, result, or evidence fact remains unbound.",
    changedArtifacts: [],
    lifecycleTransition: { action: state === "completed" ? "complete" : "cancel" },
  };
  const nextState = structuredClone(stack.state);
  nextState.revision = event.nextRevision;
  nextState.state = event.to;
  nextState.stateReason = event.reason;
  nextState.updatedAt = event.createdAt;
  nextState.lastEvent = { eventId: event.eventId, eventDigest: canonicalJsonDigest(event) };
  withStateRootLock(fixture.stateRoot, () => commitDemandLifecycleTransitionWhileLocked({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    expectedPrevious: expectedPrevious(stack),
    event,
    nextState,
  }));
  return currentStack(fixture);
}

function archiveInput(fixture, {
  archivedAt = ARCHIVED_AT,
  archiveReason = "publish the immutable terminal business archive",
  conclusion = "The terminal demand and its portable members are closed.",
} = {}) {
  const stack = currentStack(fixture);
  return {
    workspaceRoot: fixture.workspaceRoot,
    expectedProgramId: IDS.program,
    demandId: IDS.demand,
    archiveId: IDS.archive,
    archivedAt,
    archiveEventId: "event-business-archive-recovery-archive-0009",
    archiveReason,
    conclusion,
    expectedPrevious: expectedPrevious(stack),
  };
}

function scanSourceTree(stateRoot) {
  const directories = [];
  const files = [];
  const visit = (directory, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const ref = prefix ? `${prefix}/${entry.name}` : entry.name;
      const candidate = path.join(directory, entry.name);
      const stat = lstatSync(candidate);
      if (stat.isDirectory()) {
        directories.push({ ref, mode: stat.mode & 0o777 });
        visit(candidate, ref);
      } else if (stat.isFile()) {
        files.push({ ref, mode: stat.mode & 0o777, byteDigest: byteDigest(readFileSync(candidate)) });
      } else {
        assert.fail(`fixture source contains unsupported entry ${ref}`);
      }
    }
  };
  visit(stateRoot);
  directories.sort((a, b) => a.ref.localeCompare(b.ref));
  files.sort((a, b) => a.ref.localeCompare(b.ref));
  return {
    directories,
    files,
    treeDigest: canonicalJsonDigest({ directories, files }),
  };
}

function buildArchiveTransaction(fixture, input, publicPlan) {
  const stack = currentStack(fixture);
  const archiveEvent = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: input.archiveEventId,
    demandId: input.demandId,
    createdAt: input.archivedAt,
    actor: "controller",
    command: "archive-demand",
    type: "demand.archived",
    previousRevision: stack.state.revision,
    nextRevision: stack.state.revision + 1,
    from: stack.state.state,
    to: "archived",
    reason: input.archiveReason,
    decisionSummary: input.conclusion,
    changedArtifacts: [],
  };
  const archivedState = structuredClone(stack.state);
  archivedState.revision = archiveEvent.nextRevision;
  archivedState.state = "archived";
  archivedState.stateReason = archiveEvent.reason;
  archivedState.updatedAt = archiveEvent.createdAt;
  archivedState.lastEvent = {
    eventId: archiveEvent.eventId,
    eventDigest: canonicalJsonDigest(archiveEvent),
  };
  const plan = validateBusinessArchivePlan({
    schemaVersion: 1,
    artifactKind: "wakeflow-business-archive-plan",
    archiveEvent,
    archivedState,
    manifest: publicPlan.manifest,
    businessSummary: publicPlan.businessSummary,
    transportSummary: publicPlan.transportSummary,
    todoHistory: publicPlan.todoHistory,
  });
  assert.equal(canonicalJsonDigest(plan), publicPlan.planDigest);
  const config = loadWakeflowConfigV3Snapshot({ workspaceRoot: fixture.workspaceRoot });
  return validateBusinessArchiveTransaction({
    schemaVersion: 1,
    artifactKind: "wakeflow-business-archive-transaction",
    archiveId: input.archiveId,
    programId: input.expectedProgramId,
    demandId: input.demandId,
    config: {
      ref: "wakeflow.config.json",
      digest: config.configDigest,
      ledgerRootRef: fixture.model.storage.ledgerRoot,
    },
    sourceTree: scanSourceTree(fixture.stateRoot),
    plan,
    planDigest: publicPlan.planDigest,
  });
}

function journalPath(fixture) {
  return path.join(fixture.stateRoot, "transactions", "archive.json");
}

function sidecarPath(fixture) {
  return path.join(fixture.currentRoot, `.${IDS.demand}.wakeflow-archive-intent.json`);
}

function tombstonePath(fixture) {
  return path.join(fixture.currentRoot, `.${IDS.demand}.wakeflow-archive-stage`);
}

function archiveRoot(fixture, yearMonth = "2026-08") {
  return path.join(fixture.ledgerRoot, "workspace", "archive", yearMonth, IDS.archive);
}

function writeArchiveJournal(fixture, transaction) {
  writeExact(journalPath(fixture), businessArchiveCanonicalBytes(transaction));
}

function writeArchiveSidecar(fixture, transaction) {
  writeExact(sidecarPath(fixture), businessArchiveCanonicalBytes(transaction));
}

function backupStateRoot(fixture, label) {
  const backup = path.join(fixture.workspaceRoot, `.fixture-backup-${label}`);
  cpSync(fixture.stateRoot, backup, { recursive: true });
  return backup;
}

function restoreStateRoot(fixture, backup) {
  assert.equal(existsSync(fixture.stateRoot), false);
  cpSync(backup, fixture.stateRoot, { recursive: true });
  if (process.platform !== "win32") {
    const normalize = (candidate) => {
      const stat = lstatSync(candidate);
      if (stat.isDirectory()) {
        chmodSync(candidate, 0o700);
        for (const name of readdirSync(candidate)) normalize(path.join(candidate, name));
      } else if (stat.isFile()) {
        chmodSync(candidate, 0o600);
      }
    };
    normalize(fixture.stateRoot);
  }
}

function recoveryInput(fixture) {
  return {
    workspaceRoot: fixture.workspaceRoot,
    expectedProgramId: IDS.program,
    demandId: IDS.demand,
    archiveId: IDS.archive,
  };
}

function filesystemSnapshot(root) {
  if (!existsSync(root)) return null;
  const values = [];
  const visit = (candidate, ref = ".") => {
    const stat = lstatSync(candidate);
    if (stat.isDirectory()) {
      values.push({ ref, kind: "directory", mode: stat.mode & 0o777 });
      for (const name of readdirSync(candidate).sort()) {
        visit(path.join(candidate, name), ref === "." ? name : `${ref}/${name}`);
      }
    } else if (stat.isFile()) {
      values.push({ ref, kind: "file", mode: stat.mode & 0o777, digest: byteDigest(readFileSync(candidate)) });
    } else {
      values.push({ ref, kind: "other", mode: stat.mode & 0o777 });
    }
  };
  visit(root);
  return values;
}

function expectArchiveError(operation, {
  code = /wakeflow-business-archive-/u,
  forbidden = [],
} = {}) {
  assert.throws(operation, (error) => {
    assert.equal(error instanceof WakeflowBusinessArchiveError, true, error?.stack);
    assert.match(error.code ?? "", code);
    const view = JSON.stringify({
      name: error.name,
      code: error.code,
      message: error.message,
      details: error.details,
    });
    for (const value of forbidden) assert.equal(view.includes(value), false, view);
    return true;
  });
}

function transition(eventId, createdAt) {
  return {
    eventId,
    createdAt,
    reason: `commit ${eventId}`,
    decisionSummary: `Bind the exact immutable artifact for ${eventId}.`,
  };
}

function taskPackage(fixture) {
  const goalRef = fixture.authorityRefs.find((entry) => entry.role === "original-plan");
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-task-package",
    programId: IDS.program,
    demandId: IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(fixture.demand),
    demandAuthorityRef: "demand-authority.json",
    demandAuthorityDigest: canonicalJsonDigest(fixture.authority),
    createdAt: PACKAGE_AT,
    taskPackageId: IDS.taskPackage,
    targetTaskId: IDS.targetTask,
    windowId: IDS.productWindow,
    repositoryId: IDS.repository,
    workType: "implementation",
    objective: "Exercise immutable artifact and evidence archive closure.",
    confirmedContext: ["The Controller confirmed this disposable recovery fixture."],
    requirementRefs: [{
      role: "goal",
      ref: goalRef.memberRef,
      digest: goalRef.memberDigest,
      anchor: "original-plan",
    }],
    boundaries: {
      inScope: ["Only the disposable fixture."],
      outOfScope: ["Any real workspace."],
      forbidden: ["Do not mutate external repositories."],
    },
    completionExpectations: ["Return one strict TargetResult."],
    dependsOnTargetTaskIds: [],
    commitExpectation: "leave-uncommitted",
    acceptanceAnchors: [{
      anchorId: "A1",
      claim: "The bounded artifact result is exact.",
      probe: "Inspect the immutable result.",
      expected: "The result matches the package.",
    }],
    reviewInputContract: {
      requiredKinds: ["test-output"],
      requiredAcceptanceAnchorIds: ["A1"],
    },
  };
}

function testCard(fixture, stack) {
  const strategySource = fixture.authorityRefs.find((entry) => entry.role === "test-environment");
  assert.ok(strategySource);
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-test-card",
    programId: IDS.program,
    demandId: IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(fixture.demand),
    createdAt: PACKAGE_AT,
    testCardId: IDS.testCard,
    targetTaskId: IDS.targetTask,
    windowId: IDS.testWindow,
    demandAuthorityRef: "demand-authority.json",
    demandAuthorityDigest: canonicalJsonDigest(fixture.authority),
    strategySource: { ref: strategySource.memberRef, digest: strategySource.memberDigest },
    observedState: {
      revision: stack.state.revision,
      eventId: stack.state.lastEvent.eventId,
      eventDigest: stack.state.lastEvent.eventDigest,
    },
    executionContract: {
      requirementGoal: fixture.demand.goal,
      approvedPlan: ["Run the approved disposable real-environment scenario."],
      allowedSkills: [],
      setupPolicy: "fresh-per-attempt",
      maxAttempts: 2,
      restartConditions: ["The disposable environment is proven contaminated."],
      changeControl: {
        testMayChangeApproach: false,
        testMayChangeGoal: false,
        testMayAddUnmappedSteps: false,
        testMayUseUnlistedSkills: false,
        route: "return-blocked-to-controller",
      },
    },
    boundaryGate: {
      question: "Does the confirmed behavior work in the approved environment?",
      objectBoundary: "Only the disposable archive scenario.",
      controllerSelfChecks: ["Candidate self-checks already pass."],
      realScenarioConditions: ["Use the fresh disposable Test surface."],
      successMeans: ["Observed behavior matches the requirement."],
      failureMeans: ["Observed behavior contradicts the requirement."],
      cannotConclude: ["The disposable environment is unavailable."],
      stopConditions: ["The attempt limit is reached."],
    },
    evidenceRequired: ["Portable execution summary."],
    allowedOperations: ["Operate only inside the disposable Test surface."],
    forbiddenOperations: ["Do not modify product source."],
  };
}

function buildAcceptedArtifactClosure(fixture) {
  let stack = currentStack(fixture);
  const pkg = taskPackage(fixture);
  createTaskPackageArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.model,
    expectedPrevious: expectedPrevious(stack),
    artifact: pkg,
    transition: transition("event-business-archive-package-0002", PACKAGE_AT),
  });

  stack = currentStack(fixture);
  const dispatchEvent = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: "event-business-archive-dispatch-0003",
    demandId: IDS.demand,
    createdAt: DISPATCH_AT,
    actor: "controller",
    command: "dispatch-target",
    type: "target-task.dispatched",
    previousRevision: stack.state.revision,
    nextRevision: stack.state.revision + 1,
    from: stack.state.state,
    to: "dispatched",
    reason: "dispatch the exact disposable artifact fixture",
    decisionSummary: "The Controller dispatched the immutable task package.",
    changedArtifacts: [],
  };
  stack = appendManualTransition(fixture, dispatchEvent, (state) => {
    state.targetTasks[0].lifecycleStatus = "dispatched";
  });
  const transport = materializeAcceptedTransport(fixture, stack, pkg);

  const result = {
    schemaVersion: 1,
    artifactKind: "wakeflow-target-result",
    programId: IDS.program,
    demandId: IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(fixture.demand),
    createdAt: RESULT_AT,
    targetResultId: IDS.targetResult,
    targetTaskId: IDS.targetTask,
    taskPackage: {
      taskPackageId: IDS.taskPackage,
      ref: `task-packages/${IDS.taskPackage}.json`,
      digest: canonicalJsonDigest(pkg),
    },
    assignment: { windowId: IDS.productWindow, repositoryId: IDS.repository },
    observedState: {
      revision: stack.state.revision,
      eventId: stack.state.lastEvent.eventId,
      eventDigest: stack.state.lastEvent.eventDigest,
    },
    transport: {
      group: {
        id: transport.group.groupId,
        ref: dispatchGroupRef({ demandId: IDS.demand, groupId: transport.group.groupId }),
        digest: transport.group.groupDigest,
      },
      envelope: {
        id: transport.envelope.deliveryId,
        ref: deliveryEnvelopeRef({
          demandId: IDS.demand,
          deliveryId: transport.envelope.deliveryId,
        }),
        digest: transport.envelope.envelopeDigest,
      },
    },
    outcome: "completed",
    summary: "The disposable target fixture completed.",
    repositoryChanges: [{
      repositoryId: IDS.repository,
      disposition: "left-uncommitted",
      commits: [],
    }],
    evidenceLocators: [{
      kind: "test-output",
      ref: "evidence/test-output.txt",
      digest: `sha256:${"5".repeat(64)}`,
    }],
    verification: ["The bounded fixture probe passed."],
    risks: [],
    craftMapping: [{
      kind: "acceptance-anchor",
      anchorId: "A1",
      evidenceRefs: [{
        ref: "evidence/test-output.txt",
        digest: `sha256:${"5".repeat(64)}`,
      }],
    }],
  };
  recordTargetResultArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.model,
    expectedPrevious: expectedPrevious(stack),
    artifact: result,
    selection: "current",
    transition: transition("event-business-archive-result-0004", RESULT_AT),
  });

  stack = currentStack(fixture);
  const results = [{
    targetTaskId: IDS.targetTask,
    targetResultId: IDS.targetResult,
    ref: `target-results/${IDS.targetTask}/${IDS.targetResult}.json`,
    digest: canonicalJsonDigest(result),
    outcome: "completed",
  }];
  const candidate = {
    schemaVersion: 1,
    artifactKind: "wakeflow-review-candidate",
    programId: IDS.program,
    demandId: IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(fixture.demand),
    createdAt: REVIEW_AT,
    reviewCandidateId: IDS.reviewCandidate,
    fromState: {
      revision: stack.state.revision,
      stateDigest: stack.digests.state,
      eventId: stack.state.lastEvent.eventId,
      eventDigest: stack.state.lastEvent.eventDigest,
    },
    reviewScope: { targetTaskIds: [IDS.targetTask], excludedTargetTaskIds: [] },
    results,
    resultSetDigest: canonicalJsonDigest(results),
    readyTargetTaskIds: [IDS.targetTask],
    blockedTargetTaskIds: [],
    missingTargetTaskIds: [],
    allowedDecisions: ["accept", "blocked", "redesign", "rework"],
    structuralGaps: [],
  };
  createReviewCandidateArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    expectedPrevious: expectedPrevious(stack),
    artifact: candidate,
    transition: transition("event-business-archive-review-0005", REVIEW_AT),
  });

  stack = currentStack(fixture);
  const acceptEvent = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: "event-business-archive-review-accepted-0006",
    demandId: IDS.demand,
    createdAt: ACCEPT_AT,
    actor: "controller",
    command: "accept-review-candidate",
    type: "review.accepted",
    previousRevision: stack.state.revision,
    nextRevision: stack.state.revision + 1,
    from: stack.state.state,
    to: "planned",
    reason: "accept the exact reviewed target result",
    decisionSummary: "Close the task package and retain the immutable review history.",
    changedArtifacts: [],
  };
  appendManualTransition(fixture, acceptEvent, (state) => {
    state.review = {
      status: "idle",
      readyTargetTaskIds: [],
      blockedTargetTaskIds: [],
      missingTargetTaskIds: [],
    };
    state.targetTasks[0].lifecycleStatus = "accepted";
    state.taskPackages[0].lifecycleStatus = "closed";
  });
  return { pkg, result, candidate };
}

function addPortableEvidence(fixture, { relations = [] } = {}) {
  const sourceFile = path.join(fixture.workspaceRoot, "ProductA", "reports", "archive-evidence.txt");
  const sourceBytes = Buffer.from(`portable evidence for ${IDS.demand}\n`, "utf8");
  writeExact(sourceFile, sourceBytes);
  const planned = planManagedEvidenceImport({
    stateRoot: fixture.stateRoot,
    configPath: fixture.configPath,
    controllerWindowId: IDS.controllerWindow,
    kind: "test-output",
    source: {
      kind: "managed-path",
      root: { kind: "repository", repositoryId: IDS.repository },
      path: "reports/archive-evidence.txt",
      expectedType: "file",
      expectedDigest: byteDigest(sourceBytes),
    },
    relations,
    sensitivity: "internal",
  });
  const applied = applyManagedEvidenceImport({
    plan: planned.plan,
    planDigest: planned.planDigest,
    runtimeContext: {
      stateRoot: fixture.stateRoot,
      configPath: fixture.configPath,
      expectedProgramId: IDS.program,
    },
  });
  return { sourceBytes, planned, applied };
}

function archiveMemberContents(fixture, transaction) {
  const stack = currentStack(fixture);
  const contents = new Map([
    ["business-summary.json", businessArchiveCanonicalBytes(transaction.plan.businessSummary)],
    ["transport-summary.json", businessArchiveCanonicalBytes(transaction.plan.transportSummary)],
    ["payload/demand.json", readFileSync(path.join(fixture.stateRoot, "demand.json"))],
    ["payload/wakeflow-state.json", Buffer.from(`${canonicalJson(transaction.plan.archivedState)}\n`, "utf8")],
    [
      "payload/controller-events.jsonl",
      Buffer.from(
        `${[...stack.events, transaction.plan.archiveEvent].map((event) => canonicalJson(event)).join("\n")}\n`,
        "utf8",
      ),
    ],
  ]);
  if (fixture.authority) {
    contents.set(
      "payload/demand-authority.json",
      readFileSync(path.join(fixture.stateRoot, "demand-authority.json")),
    );
  }
  if (transaction.plan.todoHistory) {
    contents.set("todo-history.json", businessArchiveCanonicalBytes(transaction.plan.todoHistory));
  }
  for (const member of transaction.plan.manifest.members) {
    assert.equal(contents.has(member.path), true, `fixture lacks archive member ${member.path}`);
    assert.equal(byteDigest(contents.get(member.path)), member.digest, member.path);
  }
  return contents;
}

function prepareRecoveryFixture(t) {
  const fixture = makeFixture(t);
  terminalize(fixture);
  const input = archiveInput(fixture);
  const publicPlan = planDemandBusinessArchive(input);
  const transaction = buildArchiveTransaction(fixture, input, publicPlan);
  const memberContents = archiveMemberContents(fixture, transaction);
  return { fixture, input, publicPlan, transaction, memberContents };
}

function deterministicArchiveStage(fixture) {
  return path.join(
    fixture.ledgerRoot,
    "workspace",
    "archive",
    "2026-08",
    `.${IDS.archive}.wakeflow-stage`,
  );
}

function writeLedgerMember(file, content) {
  mkdirExact(path.dirname(file), 0o755);
  writeFileSync(file, content, { mode: 0o644 });
  if (process.platform !== "win32") chmodSync(file, 0o644);
}

function seedDeterministicArchiveStage(fixture, transaction, memberContents, boundary) {
  const stage = deterministicArchiveStage(fixture);
  mkdirExact(path.dirname(stage), 0o755);
  mkdirExact(stage, 0o755);
  if (boundary === "empty") return stage;
  writeLedgerMember(
    path.join(stage, "archive-manifest.json"),
    `${canonicalJson(transaction.plan.manifest)}\n`,
  );
  if (boundary === "manifest") return stage;
  const members = [...transaction.plan.manifest.members].sort((left, right) => (
    left.path.localeCompare(right.path)
  ));
  const count = boundary === "partial" ? Math.max(1, Math.floor(members.length / 2)) : members.length;
  for (const member of members.slice(0, count)) {
    writeLedgerMember(
      path.join(stage, ...member.path.split("/")),
      memberContents.get(member.path),
    );
  }
  return stage;
}

function atomicCrashStage(target) {
  return path.join(
    path.dirname(target),
    `.${path.basename(target)}.wakeflow-stage-999999-00000000-0000-4000-8000-000000000000`,
  );
}

function seedAtomicCrashStage(target, content) {
  const stage = atomicCrashStage(target);
  assert.equal(existsSync(target), false, target);
  writeExact(stage, content);
  return stage;
}

function invalidAtomicCrashBytes(transaction, boundary) {
  if (boundary === "0-byte") return Buffer.alloc(0);
  const exact = businessArchiveCanonicalBytes(transaction);
  return exact.subarray(0, Math.max(1, Math.floor(exact.length / 2)));
}

function rewriteArchivedEvidenceRelations(fixture, evidenceId, relations) {
  const root = archiveRoot(fixture);
  const summaryPath = path.join(root, "business-summary.json");
  const manifestPath = path.join(root, "archive-manifest.json");
  const statePath = path.join(root, "payload/wakeflow-state.json");
  const eventsPath = path.join(root, "payload/controller-events.jsonl");
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const archivedState = JSON.parse(readFileSync(statePath, "utf8"));
  const events = readFileSync(eventsPath, "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
  const evidenceSummary = summary.evidence.find((entry) => entry.evidenceId === evidenceId);
  assert.ok(evidenceSummary);
  const evidenceManifestRef = `payload/${evidenceSummary.ref}`;
  const evidenceManifestPath = path.join(root, ...evidenceManifestRef.split("/"));
  const evidenceManifest = JSON.parse(readFileSync(evidenceManifestPath, "utf8"));
  evidenceManifest.relations = relations;
  const evidenceManifestBytes = Buffer.from(`${canonicalJson(evidenceManifest)}\n`, "utf8");
  const evidenceDigest = canonicalJsonDigest(evidenceManifest);

  const recordedEvent = events.find((event) => event.eventId === `event-evidence-recorded-${evidenceId}`);
  assert.ok(recordedEvent);
  const evidenceChange = recordedEvent.changedArtifacts.find((entry) => (
    entry.artifactKind === "wakeflow-evidence" && entry.artifactId === evidenceId
  ));
  assert.ok(evidenceChange);
  evidenceChange.digest = evidenceDigest;
  const archivedEvidence = archivedState.evidence.find((entry) => entry.evidenceId === evidenceId);
  assert.ok(archivedEvidence);
  archivedEvidence.digest = evidenceDigest;

  const archivedStateBytes = Buffer.from(`${canonicalJson(archivedState)}\n`, "utf8");
  const archivedEventsBytes = Buffer.from(`${events.map((event) => canonicalJson(event)).join("\n")}\n`, "utf8");
  const archiveEvent = events.at(-1);
  const sourceEvents = events.slice(0, -1);
  const terminalEvent = sourceEvents.at(-1);
  const terminalState = structuredClone(archivedState);
  terminalState.revision = archiveEvent.previousRevision;
  terminalState.state = archiveEvent.from;
  terminalState.stateReason = terminalEvent.reason;
  terminalState.updatedAt = terminalEvent.createdAt;
  terminalState.lastEvent = {
    eventId: terminalEvent.eventId,
    eventDigest: canonicalJsonDigest(terminalEvent),
  };
  const terminalStateBytes = Buffer.from(`${canonicalJson(terminalState)}\n`, "utf8");
  const sourceEventsBytes = Buffer.from(`${sourceEvents.map((event) => canonicalJson(event)).join("\n")}\n`, "utf8");
  const terminalStateDigest = canonicalJsonDigest(terminalState);

  evidenceSummary.digest = evidenceDigest;
  evidenceSummary.memberRefs.find((entry) => entry.ref === evidenceManifestRef).digest = byteDigest(evidenceManifestBytes);
  summary.terminalAdmission.stateDigest = terminalStateDigest;
  summary.resultAuthority.stateDigest = terminalStateDigest;
  summary.archiveTransition.stateDigest = canonicalJsonDigest(archivedState);
  const stateCore = summary.core.find((entry) => entry.role === "state");
  const eventsCore = summary.core.find((entry) => entry.role === "events");
  assert.ok(stateCore);
  assert.ok(eventsCore);
  stateCore.sourceDigest = terminalStateDigest;
  stateCore.sourceByteDigest = byteDigest(terminalStateBytes);
  stateCore.memberDigest = byteDigest(archivedStateBytes);
  eventsCore.sourceByteDigest = byteDigest(sourceEventsBytes);
  eventsCore.memberDigest = byteDigest(archivedEventsBytes);

  const summaryBytes = Buffer.from(`${canonicalJson(summary)}\n`, "utf8");
  const changedMembers = new Map([
    ["business-summary.json", summaryBytes],
    ["payload/controller-events.jsonl", archivedEventsBytes],
    ["payload/wakeflow-state.json", archivedStateBytes],
    [evidenceManifestRef, evidenceManifestBytes],
  ]);
  for (const [memberRef, bytes] of changedMembers) {
    const member = manifest.members.find((entry) => entry.path === memberRef);
    assert.ok(member, memberRef);
    member.digest = byteDigest(bytes);
  }

  writeLedgerMember(evidenceManifestPath, evidenceManifestBytes);
  writeLedgerMember(eventsPath, archivedEventsBytes);
  writeLedgerMember(statePath, archivedStateBytes);
  writeLedgerMember(summaryPath, summaryBytes);
  overwriteCanonicalLedgerFile(manifestPath, manifest);

  const loaded = loadLedgerRecord({
    ledgerRoot: fixture.ledgerRoot,
    root,
    expectedFamily: "archive",
    expectedProgramId: IDS.program,
  });
  validateBusinessArchivePlan({
    schemaVersion: 1,
    artifactKind: "wakeflow-business-archive-plan",
    archiveEvent,
    archivedState,
    manifest: loaded.record,
    businessSummary: summary,
    transportSummary: JSON.parse(readFileSync(path.join(root, "transport-summary.json"), "utf8")),
    todoHistory: null,
  });
  return { loaded, summary, evidenceManifest };
}

function rewriteArchivedArtifactClosure(fixture, mutate) {
  const root = archiveRoot(fixture);
  const summaryPath = path.join(root, "business-summary.json");
  const manifestPath = path.join(root, "archive-manifest.json");
  const statePath = path.join(root, "payload/wakeflow-state.json");
  const eventsPath = path.join(root, "payload/controller-events.jsonl");
  const packageRef = `payload/task-packages/${IDS.taskPackage}.json`;
  const resultRef = `payload/target-results/${IDS.targetTask}/${IDS.targetResult}.json`;
  const candidateRef = `payload/review-candidates/${IDS.reviewCandidate}.json`;
  const packagePath = path.join(root, ...packageRef.split("/"));
  const resultPath = path.join(root, ...resultRef.split("/"));
  const candidatePath = path.join(root, ...candidateRef.split("/"));
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const archivedState = JSON.parse(readFileSync(statePath, "utf8"));
  const events = readFileSync(eventsPath, "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  const candidate = JSON.parse(readFileSync(candidatePath, "utf8"));
  mutate({ pkg, result, candidate, events });

  const packageBytes = Buffer.from(`${canonicalJson(pkg)}\n`, "utf8");
  const packageDigest = canonicalJsonDigest(pkg);
  result.taskPackage.digest = packageDigest;
  const resultBytes = Buffer.from(`${canonicalJson(result)}\n`, "utf8");
  const resultDigest = canonicalJsonDigest(result);
  candidate.results.find((entry) => entry.targetResultId === IDS.targetResult).digest = resultDigest;
  candidate.resultSetDigest = canonicalJsonDigest(candidate.results);
  const candidateBytes = Buffer.from(`${canonicalJson(candidate)}\n`, "utf8");
  const candidateDigest = canonicalJsonDigest(candidate);
  const artifactDigests = new Map([
    [IDS.taskPackage, packageDigest],
    [IDS.targetResult, resultDigest],
    [IDS.reviewCandidate, candidateDigest],
  ]);
  for (const event of events) {
    for (const identity of event.changedArtifacts) {
      if (artifactDigests.has(identity.artifactId)) identity.digest = artifactDigests.get(identity.artifactId);
    }
  }
  archivedState.taskPackages.find((entry) => entry.taskPackageId === IDS.taskPackage).digest = packageDigest;
  archivedState.targetResults.find((entry) => entry.targetResultId === IDS.targetResult).digest = resultDigest;
  archivedState.targetTasks.find((entry) => entry.targetTaskId === IDS.targetTask).currentResult.digest = resultDigest;

  const archiveEvent = events.at(-1);
  const sourceEvents = events.slice(0, -1);
  const terminalEvent = sourceEvents.at(-1);
  const terminalState = structuredClone(archivedState);
  terminalState.revision = archiveEvent.previousRevision;
  terminalState.state = archiveEvent.from;
  terminalState.stateReason = terminalEvent.reason;
  terminalState.updatedAt = terminalEvent.createdAt;
  terminalState.lastEvent = {
    eventId: terminalEvent.eventId,
    eventDigest: canonicalJsonDigest(terminalEvent),
  };
  const archivedStateBytes = Buffer.from(`${canonicalJson(archivedState)}\n`, "utf8");
  const terminalStateBytes = Buffer.from(`${canonicalJson(terminalState)}\n`, "utf8");
  const archivedEventsBytes = Buffer.from(`${events.map((event) => canonicalJson(event)).join("\n")}\n`, "utf8");
  const sourceEventsBytes = Buffer.from(`${sourceEvents.map((event) => canonicalJson(event)).join("\n")}\n`, "utf8");
  const terminalStateDigest = canonicalJsonDigest(terminalState);
  for (const [artifactId, digest, memberRef, bytes] of [
    [IDS.taskPackage, packageDigest, packageRef, packageBytes],
    [IDS.targetResult, resultDigest, resultRef, resultBytes],
    [IDS.reviewCandidate, candidateDigest, candidateRef, candidateBytes],
  ]) {
    const entry = summary.artifacts.find((artifact) => artifact.artifactId === artifactId);
    assert.ok(entry, artifactId);
    entry.digest = digest;
    entry.memberDigest = byteDigest(bytes);
    assert.equal(entry.memberRef, memberRef);
  }
  summary.resultAuthority.selectedResults.find((entry) => entry.targetResultId === IDS.targetResult).digest = resultDigest;
  summary.terminalAdmission.stateDigest = terminalStateDigest;
  summary.resultAuthority.stateDigest = terminalStateDigest;
  summary.archiveTransition.stateDigest = canonicalJsonDigest(archivedState);
  const stateCore = summary.core.find((entry) => entry.role === "state");
  const eventsCore = summary.core.find((entry) => entry.role === "events");
  stateCore.sourceDigest = terminalStateDigest;
  stateCore.sourceByteDigest = byteDigest(terminalStateBytes);
  stateCore.memberDigest = byteDigest(archivedStateBytes);
  eventsCore.sourceByteDigest = byteDigest(sourceEventsBytes);
  eventsCore.memberDigest = byteDigest(archivedEventsBytes);

  const summaryBytes = Buffer.from(`${canonicalJson(summary)}\n`, "utf8");
  const changedMembers = new Map([
    ["business-summary.json", summaryBytes],
    ["payload/controller-events.jsonl", archivedEventsBytes],
    ["payload/wakeflow-state.json", archivedStateBytes],
    [packageRef, packageBytes],
    [resultRef, resultBytes],
    [candidateRef, candidateBytes],
  ]);
  for (const [memberRef, bytes] of changedMembers) {
    const member = manifest.members.find((entry) => entry.path === memberRef);
    assert.ok(member, memberRef);
    member.digest = byteDigest(bytes);
  }
  for (const [memberRef, bytes] of changedMembers) {
    writeLedgerMember(path.join(root, ...memberRef.split("/")), bytes);
  }
  overwriteCanonicalLedgerFile(manifestPath, manifest);
  const loaded = loadLedgerRecord({
    ledgerRoot: fixture.ledgerRoot,
    root,
    expectedFamily: "archive",
    expectedProgramId: IDS.program,
  });
  validateBusinessArchivePlan({
    schemaVersion: 1,
    artifactKind: "wakeflow-business-archive-plan",
    archiveEvent,
    archivedState,
    manifest: loaded.record,
    businessSummary: summary,
    transportSummary: JSON.parse(readFileSync(path.join(root, "transport-summary.json"), "utf8")),
    todoHistory: null,
  });
  return { loaded, summary };
}

function assertArchiveRecoveryConverged(fixture, extraStages = []) {
  const root = archiveRoot(fixture);
  assert.equal(existsSync(root), true);
  const loaded = loadLedgerRecord({
    ledgerRoot: fixture.ledgerRoot,
    root,
    expectedFamily: "archive",
    expectedProgramId: IDS.program,
  });
  assert.equal(loaded.record.archiveId, IDS.archive);
  assert.equal(loaded.record.source.demandId, IDS.demand);
  assert.equal(existsSync(fixture.stateRoot), false);
  assert.equal(existsSync(sidecarPath(fixture)), false);
  assert.equal(existsSync(tombstonePath(fixture)), false);
  for (const stage of [deterministicArchiveStage(fixture), ...extraStages]) {
    assert.equal(existsSync(stage), false, stage);
  }
  assert.deepEqual(
    readdirSync(fixture.currentRoot).filter((name) => name.includes(".wakeflow-stage")),
    [],
  );
}

test("TODO-backed archive deletes only its exact claimed row and preserves typed lineage", (t) => {
  const fixture = makeFixture(t, { todoBacked: true, secondTodo: true });
  terminalize(fixture);
  const input = archiveInput(fixture);
  const plan = planDemandBusinessArchive(input);

  assert.equal(plan.todoHistory.todoId, "TODO-M2-T09");
  assert.equal(plan.businessSummary.todo.todoId, "TODO-M2-T09");
  assert.equal(plan.businessSummary.todo.memberRef, "todo-history.json");
  assert.equal(
    plan.manifest.members.find((entry) => entry.path === "todo-history.json")?.role,
    "todo-history",
  );
  assert.equal(plan.manifest.members.some((entry) => entry.path === "payload/demand-authority.json"), false);

  const committed = commitDemandBusinessArchive(input);
  assert.equal(committed.archiveId, IDS.archive);
  const board = todoService.scanTodoBoard(readFileSync(fixture.boardPath, "utf8"));
  assert.deepEqual(board.rows.map((entry) => entry.id), ["TODO-M2-T09-OTHER"]);
  assert.equal(existsSync(path.join(archiveRoot(fixture), "todo-history.json")), true);
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(archiveRoot(fixture), "todo-history.json"), "utf8")),
    plan.todoHistory,
  );
});

test("TODO archive admission is exact CAS and leaves no journal or ledger record after row drift", (t) => {
  const fixture = makeFixture(t, { todoBacked: true, secondTodo: true });
  terminalize(fixture);
  const board = todoService.scanTodoBoard(readFileSync(fixture.boardPath, "utf8"));
  const rows = board.rows.map((entry) => structuredClone(entry.value));
  rows.find((entry) => entry.ID === "TODO-M2-T09")["Item / Goal"] = "Drifted after demand claim";
  writeExact(fixture.boardPath, todoService.renderTodoBoard(rows));
  const before = filesystemSnapshot(fixture.workspaceRoot);

  expectArchiveError(() => planDemandBusinessArchive(archiveInput(fixture)), {
    code: /(?:todo|closure|conflict)/u,
    forbidden: [fixture.workspaceRoot],
  });
  assert.deepEqual(filesystemSnapshot(fixture.workspaceRoot), before);
  assert.equal(existsSync(journalPath(fixture)), false);
  assert.equal(existsSync(archiveRoot(fixture)), false);
});

test("T05 current/historical artifacts and T06 immutable evidence form one portable member closure", (t) => {
  const fixture = makeFixture(t);
  const artifacts = buildAcceptedArtifactClosure(fixture);
  const evidence = addPortableEvidence(fixture);
  const evidenceTime = Date.parse(evidence.planned.plan.capturedAt);
  const terminalAt = new Date(evidenceTime + 1_000).toISOString();
  const archivedAt = new Date(evidenceTime + 2_000).toISOString();
  terminalize(fixture, { terminalAt });
  const input = archiveInput(fixture, { archivedAt });
  const plan = planDemandBusinessArchive(input);

  assert.deepEqual(
    plan.businessSummary.artifacts.map((entry) => [entry.artifactKind, entry.artifactId, entry.lifecycleStatus]),
    [
      ["wakeflow-review-candidate", IDS.reviewCandidate, "historical"],
      ["wakeflow-target-result", IDS.targetResult, "current"],
      ["wakeflow-task-package", IDS.taskPackage, "closed"],
    ],
  );
  assert.deepEqual(plan.businessSummary.resultAuthority.selectedResults, [{
    targetTaskId: IDS.targetTask,
    targetResultId: IDS.targetResult,
    ref: `target-results/${IDS.targetTask}/${IDS.targetResult}.json`,
    digest: canonicalJsonDigest(artifacts.result),
    outcome: "completed",
  }]);
  assert.equal(plan.businessSummary.evidence.length, 1);
  const evidenceSummary = plan.businessSummary.evidence[0];
  assert.equal(evidenceSummary.evidenceId, evidence.planned.plan.evidenceId);
  assert.deepEqual(
    evidenceSummary.memberRefs.map((entry) => entry.ref),
    [
      `payload/evidence/${evidence.planned.plan.evidenceId}/evidence.json`,
      `payload/evidence/${evidence.planned.plan.evidenceId}/payload/content`,
    ],
  );
  assert.equal(plan.transportSummary.sourceStatus, "current");
  assert.equal(plan.transportSummary.groups.length, 1);
  assert.equal(plan.transportSummary.packets.length, 1);
  assert.equal(plan.transportSummary.envelopes.length, 1);
  assert.equal(plan.transportSummary.runs.length, 1);
  assert.deepEqual(Object.keys(plan.transportSummary.packets[0]).sort(), [
    "createdAt",
    "digest",
    "groupDigest",
    "groupId",
    "groupRef",
    "packetId",
    "ref",
    "targetTaskId",
    "taskPackage",
    "windowId",
    "workType",
  ]);
  assert.deepEqual(Object.keys(plan.transportSummary.envelopes[0]).sort(), [
    "artifactKind",
    "correlationId",
    "createdAt",
    "deliveryId",
    "digest",
    "group",
    "packet",
    "preparedByHostId",
    "ref",
    "windowId",
  ]);
  const transportJson = canonicalJson(plan.transportSummary);
  for (const privateValue of [
    "Execute only this immutable disposable archive packet and return one TargetResult.",
    "41414141-4141-4141-8141-414141414141",
  ]) {
    assert.equal(transportJson.includes(privateValue), false);
  }
  for (const forbiddenField of [
    "acceptanceAnchors",
    "bindingId",
    "boundaries",
    "identityBindingDigest",
    "objective",
    "prompt",
    "taskBriefing",
  ]) {
    assert.equal(Object.hasOwn(plan.transportSummary.packets[0], forbiddenField), false);
    assert.equal(Object.hasOwn(plan.transportSummary.envelopes[0], forbiddenField), false);
  }

  commitDemandBusinessArchive(input);
  const root = archiveRoot(fixture, archivedAt.slice(0, 7));
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(root, "transport-summary.json"), "utf8")),
    plan.transportSummary,
  );
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(root, `payload/task-packages/${IDS.taskPackage}.json`), "utf8")),
    artifacts.pkg,
  );
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(root, `payload/review-candidates/${IDS.reviewCandidate}.json`), "utf8")),
    artifacts.candidate,
  );
  assert.equal(
    readFileSync(path.join(root, `payload/evidence/${evidence.planned.plan.evidenceId}/payload/content`))
      .equals(evidence.sourceBytes),
    true,
  );
});

test("a cancelled demand archives a closed Test card that never acquired a target task", (t) => {
  const fixture = makeFixture(t, { realEnvironment: true });
  const stack = currentStack(fixture);
  const card = testCard(fixture, stack);
  createTestCardArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.model,
    expectedPrevious: expectedPrevious(stack),
    artifact: card,
    transition: transition("event-business-archive-test-card-0002", PACKAGE_AT),
  });
  const afterCard = currentStack(fixture);
  const cancelEvent = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: "event-business-archive-cancel-after-test-card-0003",
    demandId: IDS.demand,
    createdAt: TERMINAL_AT,
    actor: "controller",
    command: "cancel-demand",
    type: "demand.cancelled",
    previousRevision: afterCard.state.revision,
    nextRevision: afterCard.state.revision + 1,
    from: afterCard.state.state,
    to: "cancelled",
    reason: "cancel before the reserved Test task is packaged",
    decisionSummary: "Close the unassigned Test card without inventing a target task.",
    changedArtifacts: [],
    lifecycleTransition: { action: "cancel" },
  };
  const terminal = appendManualTransition(fixture, cancelEvent, (nextState) => {
    nextState.testCards[0].lifecycleStatus = "closed";
  });
  assert.equal(terminal.state.targetTasks.length, 0);
  assert.equal(terminal.state.testCards[0].lifecycleStatus, "closed");

  const committed = commitDemandBusinessArchive(archiveInput(fixture));
  assert.equal(committed.archiveId, IDS.archive);
  assert.equal(existsSync(fixture.stateRoot), false);
  assert.equal(
    existsSync(path.join(archiveRoot(fixture), `payload/test-cards/${IDS.testCard}.json`)),
    true,
  );
});

test("a completed demand cannot archive a Test card that never acquired a target task", (t) => {
  const fixture = makeFixture(t, { realEnvironment: true });
  const stack = currentStack(fixture);
  const card = testCard(fixture, stack);
  createTestCardArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.model,
    expectedPrevious: expectedPrevious(stack),
    artifact: card,
    transition: transition("event-business-archive-orphan-test-card-0002", PACKAGE_AT),
  });
  const afterCard = currentStack(fixture);
  const completeEvent = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: "event-business-archive-complete-after-test-card-0003",
    demandId: IDS.demand,
    createdAt: TERMINAL_AT,
    actor: "controller",
    command: "complete-demand",
    type: "demand.completed",
    previousRevision: afterCard.state.revision,
    nextRevision: afterCard.state.revision + 1,
    from: afterCard.state.state,
    to: "completed",
    reason: "attempt to complete before the reserved Test task is packaged",
    decisionSummary: "This invalid terminal source must be rejected before archive publication.",
    changedArtifacts: [],
    lifecycleTransition: { action: "complete" },
  };
  appendManualTransition(fixture, completeEvent, (nextState) => {
    nextState.testCards[0].lifecycleStatus = "closed";
  });
  const input = archiveInput(fixture);
  const before = filesystemSnapshot(fixture.workspaceRoot);

  for (const operation of [planDemandBusinessArchive, commitDemandBusinessArchive]) {
    expectArchiveError(() => operation(input), {
      code: /artifact-closure/u,
      forbidden: [fixture.workspaceRoot],
    });
    assert.deepEqual(filesystemSnapshot(fixture.workspaceRoot), before);
    assert.equal(existsSync(journalPath(fixture)), false);
    assert.equal(existsSync(archiveRoot(fixture)), false);
  }
});

test("recovery revalidates archived evidence relations after a coordinated closure rewrite", async (t) => {
  for (const relationKind of ["artifact", "controller-event"]) {
    await t.test(relationKind, () => {
      const fixture = makeFixture(t);
      const artifacts = buildAcceptedArtifactClosure(fixture);
      const relatedEvent = currentStack(fixture).events[0];
      const validRelation = relationKind === "artifact"
        ? {
            kind: "artifact",
            artifactKind: "wakeflow-task-package",
            artifactId: IDS.taskPackage,
            ref: `task-packages/${IDS.taskPackage}.json`,
            digest: canonicalJsonDigest(artifacts.pkg),
          }
        : {
            kind: "controller-event",
            eventId: relatedEvent.eventId,
            digest: canonicalJsonDigest(relatedEvent),
          };
      const evidence = addPortableEvidence(fixture, { relations: [validRelation] });
      const evidenceTime = Date.parse(evidence.planned.plan.capturedAt);
      terminalize(fixture, { terminalAt: new Date(evidenceTime + 1_000).toISOString() });
      commitDemandBusinessArchive(archiveInput(fixture, {
        archivedAt: new Date(evidenceTime + 2_000).toISOString(),
      }));

      const invalidRelation = relationKind === "artifact"
        ? {
            kind: "artifact",
            artifactKind: "wakeflow-task-package",
            artifactId: "task-package_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            ref: "task-packages/task-package_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json",
            digest: `sha256:${"4".repeat(64)}`,
          }
        : {
            kind: "controller-event",
            eventId: relatedEvent.eventId,
            digest: `sha256:${"4".repeat(64)}`,
          };
      assert.notEqual(validRelation.digest, invalidRelation.digest);
      const rewritten = rewriteArchivedEvidenceRelations(
        fixture,
        evidence.planned.plan.evidenceId,
        [invalidRelation],
      );
      assert.deepEqual(rewritten.evidenceManifest.relations, [invalidRelation]);

      const before = filesystemSnapshot(fixture.workspaceRoot);
      expectArchiveError(() => recoverDemandBusinessArchive(recoveryInput(fixture)), {
        code: /(?:archive|evidence|relation)/u,
        forbidden: [fixture.workspaceRoot],
      });
      assert.deepEqual(filesystemSnapshot(fixture.workspaceRoot), before);
    });
  }
});

test("recovery replays T05 producer-owned refs after coordinated artifact rewrites", async (t) => {
  for (const [label, mutate] of [
    ["requirement anchor", ({ pkg }) => {
      pkg.requirementRefs[0].anchor = "missing-authority-heading";
    }],
    ["TargetResult observed state", ({ result }) => {
      result.observedState.eventDigest = `sha256:${"6".repeat(64)}`;
    }],
    ["TargetResult craft evidence", ({ result }) => {
      result.craftMapping[0].evidenceRefs[0].digest = `sha256:${"6".repeat(64)}`;
    }],
    ["TargetResult repository tuple", ({ result }) => {
      result.repositoryChanges = [];
    }],
    ["TargetResult commit disposition", ({ result }) => {
      result.repositoryChanges[0] = {
        repositoryId: IDS.repository,
        disposition: "committed",
        commits: ["deadbeef"],
      };
    }],
    ["artifact creation actor", ({ events }) => {
      events.find((event) => event.eventId === "event-business-archive-package-0002").actor = "target";
    }],
  ]) {
    await t.test(label, () => {
      const fixture = makeFixture(t);
      buildAcceptedArtifactClosure(fixture);
      terminalize(fixture);
      commitDemandBusinessArchive(archiveInput(fixture));
      rewriteArchivedArtifactClosure(fixture, mutate);

      const before = filesystemSnapshot(fixture.workspaceRoot);
      expectArchiveError(() => recoverDemandBusinessArchive(recoveryInput(fixture)), {
        code: /(?:archive|artifact|closure|conflict)/u,
        forbidden: [fixture.workspaceRoot],
      });
      assert.deepEqual(filesystemSnapshot(fixture.workspaceRoot), before);
    });
  }
});

test("recovery rejects a structurally closed manifest and summary whose core semantics were rewritten together", (t) => {
  const fixture = makeFixture(t);
  terminalize(fixture);
  const input = archiveInput(fixture);
  commitDemandBusinessArchive(input);

  const root = archiveRoot(fixture);
  const summaryPath = path.join(root, "business-summary.json");
  const manifestPath = path.join(root, "archive-manifest.json");
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const demandCore = summary.core.find((entry) => entry.role === "demand");
  assert.ok(demandCore);
  assert.notEqual(demandCore.sourceDigest, `sha256:${"a".repeat(64)}`);
  demandCore.sourceDigest = `sha256:${"a".repeat(64)}`;
  const summaryBytes = Buffer.from(`${canonicalJson(summary)}\n`, "utf8");
  manifest.members.find((entry) => entry.path === "business-summary.json").digest = byteDigest(summaryBytes);
  overwriteCanonicalLedgerFile(summaryPath, summary);
  overwriteCanonicalLedgerFile(manifestPath, manifest);
  const structurallyLoaded = loadLedgerRecord({
    ledgerRoot: fixture.ledgerRoot,
    root,
    expectedFamily: "archive",
    expectedProgramId: IDS.program,
  });
  assert.equal(
    structurallyLoaded.record.members.find((entry) => entry.path === "business-summary.json").digest,
    byteDigest(summaryBytes),
  );

  const before = filesystemSnapshot(fixture.workspaceRoot);
  expectArchiveError(() => recoverDemandBusinessArchive(recoveryInput(fixture)), {
    code: /(?:archive|closure|conflict)/u,
    forbidden: [fixture.workspaceRoot],
  });
  assert.deepEqual(filesystemSnapshot(fixture.workspaceRoot), before);
});

test("archive plan validation projects the exact archive event and archived state instead of trusting duplicate summary fields", (t) => {
  const fixture = makeFixture(t);
  terminalize(fixture);
  const input = archiveInput(fixture);
  const publicPlan = planDemandBusinessArchive(input);
  const plan = buildArchiveTransaction(fixture, input, publicPlan).plan;
  const variants = [
    (candidate) => { candidate.archiveEvent.decisionSummary = "A different event conclusion."; },
    (candidate) => {
      candidate.archiveEvent.changedArtifacts = [{
        artifactKind: "wakeflow-review-candidate",
        artifactId: IDS.reviewCandidate,
        ref: `review-candidates/${IDS.reviewCandidate}.json`,
        digest: `sha256:${"4".repeat(64)}`,
      }];
      candidate.archivedState.lastEvent.eventDigest = canonicalJsonDigest(candidate.archiveEvent);
      candidate.businessSummary.archiveTransition.eventDigest = canonicalJsonDigest(candidate.archiveEvent);
      candidate.businessSummary.archiveTransition.stateDigest = canonicalJsonDigest(candidate.archivedState);
    },
    (candidate) => { candidate.businessSummary.archiveTransition.eventId = "event-forged-archive-transition"; },
    (candidate) => { candidate.archivedState.stateReason = "A different archived state reason."; },
  ];
  for (const mutate of variants) {
    const candidate = structuredClone(plan);
    mutate(candidate);
    assert.throws(
      () => validateBusinessArchivePlan(candidate),
      (error) => /^wakeflow-business-archive-record-/u.test(error?.code),
    );
  }
  const invalidSummary = structuredClone(plan.businessSummary);
  invalidSummary.archivedAt = "2026-02-31T05:00:00.000Z";
  assert.throws(
    () => validateBusinessArchiveSummary(invalidSummary),
    (error) => error?.code === "wakeflow-business-archive-record-timestamp",
  );
});

test("BusinessArchive records consume the complete current demand-artifact taxonomy", (t) => {
  const fixture = makeFixture(t);
  terminalize(fixture);
  const input = archiveInput(fixture);
  const publicPlan = planDemandBusinessArchive(input);
  const summary = structuredClone(buildArchiveTransaction(fixture, input, publicPlan).plan.businessSummary);
  const designArtifacts = [
    [
      "wakeflow-pod-design-request",
      "pod-design-request_12121212-1212-4212-8212-121212121212",
      "pod/design-requests/pod-design-request_12121212-1212-4212-8212-121212121212.json",
    ],
    [
      "wakeflow-pod-design-handoff",
      "pod-design-handoff_13131313-1313-4313-8313-131313131313",
      "pod/design-handoffs/pod-design-handoff_13131313-1313-4313-8313-131313131313.json",
    ],
  ];
  summary.artifacts.push(...designArtifacts.map(([artifactKind, artifactId, ref], index) => ({
    artifactKind,
    artifactId,
    ref,
    digest: `sha256:${String(index + 6).repeat(64)}`,
    memberRef: `payload/${ref}`,
    memberDigest: `sha256:${String(index + 8).repeat(64)}`,
    lifecycleStatus: "current",
  })));
  summary.artifacts.sort((left, right) => left.memberRef < right.memberRef ? -1 : left.memberRef > right.memberRef ? 1 : 0);
  const validated = validateBusinessArchiveSummary(summary);
  assert.deepEqual(
    [...new Set(validated.artifacts.map((entry) => entry.artifactKind))].sort(),
    designArtifacts.map(([artifactKind]) => artifactKind).sort(),
  );

  const schema = JSON.parse(readFileSync(path.join(
    repositoryRoot,
    "core/schemas/wakeflow-business-archive/business-summary.schema.json",
  ), "utf8"));
  assert.deepEqual(
    [...schema.$defs.artifactMember.properties.artifactKind.enum].sort(),
    [...WAKEFLOW_DEMAND_ARTIFACT_KINDS].sort(),
  );
});

test("BusinessArchive record entrypoints reject behavioral data without executing it", (t) => {
  const fixture = makeFixture(t);
  terminalize(fixture);
  const input = archiveInput(fixture);
  const publicPlan = planDemandBusinessArchive(input);
  const plan = buildArchiveTransaction(fixture, input, publicPlan).plan;
  let calls = 0;
  const behavioralPlan = structuredClone(plan);
  Object.defineProperty(behavioralPlan, "archiveEvent", {
    enumerable: true,
    get() {
      calls += 1;
      return plan.archiveEvent;
    },
  });
  assert.throws(
    () => validateBusinessArchivePlan(behavioralPlan),
    (error) => /^wakeflow-business-archive-record-/u.test(error?.code),
  );
  assert.equal(calls, 0);

  const behavioralDispatch = {};
  Object.defineProperty(behavioralDispatch, "artifactKind", {
    enumerable: true,
    get() {
      calls += 1;
      return "wakeflow-business-archive-summary";
    },
  });
  assert.throws(
    () => businessArchiveCanonicalBytes(behavioralDispatch),
    (error) => /^wakeflow-business-archive-record-/u.test(error?.code),
  );
  assert.equal(calls, 0);
});

test("BusinessArchive physical reads use current-owner nanosecond identities and bounded descriptor capture", () => {
  const source = readFileSync(path.join(
    repositoryRoot,
    "core/scripts/lib/wakeflow-business-archive-service.mjs",
  ), "utf8");
  assert.match(source, /lstatSync\([^\n]+\{ bigint: true \}\)/u);
  assert.match(source, /fstatSync\(descriptor, \{ bigint: true \}\)/u);
  assert.match(source, /process\.geteuid/u);
  assert.match(source, /mtimeNs/u);
  assert.match(source, /ctimeNs/u);
  assert.match(source, /readSync\(descriptor/u);
  assert.doesNotMatch(source, /mtimeMs|ctimeMs|readFileSync\(descriptor\)|toLocaleLowerCase/u);
  assert.match(source, /const MAX_ARCHIVE_TRANSACTION_BYTES = 16 \* 1024 \* 1024;/u);
  assert.match(source, /transactionBytes\.length > MAX_ARCHIVE_TRANSACTION_BYTES/u);
});

test("recovery rejects manifest business and member metadata that byte-level ledger loading alone admits", async (t) => {
  for (const [label, mutate] of [
    ["title", (manifest) => { manifest.title = "Forged archive title"; }],
    ["member role", (manifest) => {
      manifest.members.find((entry) => entry.path === "payload/demand.json").role = "summary";
    }],
    ["member media type", (manifest) => {
      manifest.members.find((entry) => entry.path === "payload/demand.json").mediaType = "text/plain";
    }],
  ]) {
    await t.test(label, () => {
      const fixture = makeFixture(t);
      terminalize(fixture);
      commitDemandBusinessArchive(archiveInput(fixture));
      const root = archiveRoot(fixture);
      const manifestPath = path.join(root, "archive-manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      mutate(manifest);
      overwriteCanonicalLedgerFile(manifestPath, manifest);
      assert.equal(loadLedgerRecord({
        ledgerRoot: fixture.ledgerRoot,
        root,
        expectedFamily: "archive",
        expectedProgramId: IDS.program,
      }).recordId, IDS.archive);

      const before = filesystemSnapshot(fixture.workspaceRoot);
      expectArchiveError(() => recoverDemandBusinessArchive(recoveryInput(fixture)), {
        code: /(?:archive|closure|conflict)/u,
        forbidden: [fixture.workspaceRoot],
      });
      assert.deepEqual(filesystemSnapshot(fixture.workspaceRoot), before);
    });
  }
});

test("journal recovery completes exact T01 deterministic archive stages at every publish boundary", async (t) => {
  for (const boundary of ["empty", "manifest", "partial", "complete"]) {
    await t.test(boundary, () => {
      const { fixture, transaction, memberContents } = prepareRecoveryFixture(t);
      writeArchiveJournal(fixture, transaction);
      const stage = seedDeterministicArchiveStage(fixture, transaction, memberContents, boundary);
      assert.equal(existsSync(stage), true);

      recoverDemandBusinessArchive(recoveryInput(fixture));
      assertArchiveRecoveryConverged(fixture, [stage]);
    });
  }
});

test("journal, sidecar, and archive-month crash boundaries converge without abandoned stages", async (t) => {
  await t.test("journal atomic stage was written but not renamed", () => {
    const { fixture, transaction } = prepareRecoveryFixture(t);
    const stage = seedAtomicCrashStage(journalPath(fixture), businessArchiveCanonicalBytes(transaction));

    recoverDemandBusinessArchive(recoveryInput(fixture));
    assertArchiveRecoveryConverged(fixture, [stage]);
  });

  await t.test("sidecar atomic stage was written but not renamed", () => {
    const { fixture, transaction, memberContents } = prepareRecoveryFixture(t);
    writeArchiveJournal(fixture, transaction);
    createLedgerRecord({
      ledgerRoot: fixture.ledgerRoot,
      expectedProgramId: IDS.program,
      record: transaction.plan.manifest,
      memberContents,
    });
    const stage = seedAtomicCrashStage(sidecarPath(fixture), businessArchiveCanonicalBytes(transaction));

    recoverDemandBusinessArchive(recoveryInput(fixture));
    assertArchiveRecoveryConverged(fixture, [stage]);
  });

  await t.test("new archive month exists but deterministic record stage does not", () => {
    const { fixture, transaction } = prepareRecoveryFixture(t);
    writeArchiveJournal(fixture, transaction);
    const month = path.dirname(deterministicArchiveStage(fixture));
    mkdirExact(month, 0o755);
    assert.deepEqual(readdirSync(month), []);

    recoverDemandBusinessArchive(recoveryInput(fixture));
    assertArchiveRecoveryConverged(fixture);
  });
});

test("invalid journal atomic stages are rebuilt only by an explicit commit request", async (t) => {
  for (const boundary of ["0-byte", "partial"]) {
    await t.test(`${boundary} commit residue is replaced from the explicit request`, () => {
      const { fixture, input, transaction } = prepareRecoveryFixture(t);
      const stage = seedAtomicCrashStage(
        journalPath(fixture),
        invalidAtomicCrashBytes(transaction, boundary),
      );

      commitDemandBusinessArchive(input);
      assertArchiveRecoveryConverged(fixture, [stage]);
    });

    await t.test(`${boundary} recovery residue blocks without changing authority`, () => {
      const { fixture, transaction } = prepareRecoveryFixture(t);
      const residue = invalidAtomicCrashBytes(transaction, boundary);
      const stage = seedAtomicCrashStage(journalPath(fixture), residue);
      const before = filesystemSnapshot(fixture.workspaceRoot);

      expectArchiveError(() => recoverDemandBusinessArchive(recoveryInput(fixture)), {
        code: /(?:atomic|record|recovery)/u,
        forbidden: [fixture.workspaceRoot],
      });
      assert.deepEqual(filesystemSnapshot(fixture.workspaceRoot), before);
      assert.equal(readFileSync(stage).equals(residue), true);
      assert.equal(existsSync(journalPath(fixture)), false);
      assert.equal(existsSync(archiveRoot(fixture)), false);
      assert.equal(existsSync(fixture.stateRoot), true);
    });
  }
});

test("an exact journal and ledger authority replace one invalid sidecar atomic stage", async (t) => {
  for (const boundary of ["0-byte", "partial"]) {
    await t.test(boundary, () => {
      const { fixture, transaction, memberContents } = prepareRecoveryFixture(t);
      writeArchiveJournal(fixture, transaction);
      createLedgerRecord({
        ledgerRoot: fixture.ledgerRoot,
        expectedProgramId: IDS.program,
        record: transaction.plan.manifest,
        memberContents,
      });
      const stage = seedAtomicCrashStage(
        sidecarPath(fixture),
        invalidAtomicCrashBytes(transaction, boundary),
      );

      recoverDemandBusinessArchive(recoveryInput(fixture));
      assertArchiveRecoveryConverged(fixture, [stage]);
    });
  }
});

test("recovery advances an exact current journal when ledger authority is still absent", (t) => {
  const fixture = makeFixture(t);
  terminalize(fixture);
  const input = archiveInput(fixture);
  const plan = planDemandBusinessArchive(input);
  const transaction = buildArchiveTransaction(fixture, input, plan);
  writeArchiveJournal(fixture, transaction);

  assert.equal(existsSync(archiveRoot(fixture)), false);
  const recovered = recoverDemandBusinessArchive(recoveryInput(fixture));
  assert.equal(recovered.archiveId, IDS.archive);
  assert.equal(existsSync(fixture.stateRoot), false);
  assert.equal(existsSync(archiveRoot(fixture)), true);
  assert.equal(existsSync(sidecarPath(fixture)), false);
  assert.equal(existsSync(tombstonePath(fixture)), false);
});

test("authority commit detaches the active source even when the repairable ledger projection stays stale", {
  skip: process.platform === "win32",
}, (t) => {
  const fixture = makeFixture(t);
  terminalize(fixture);
  const archiveIndex = path.join(fixture.ledgerRoot, "workspace", "archive", "index.md");
  writeExact(archiveIndex, "stale projection must not become authority\n", 0o600);

  const committed = commitDemandBusinessArchive(archiveInput(fixture));
  assert.equal(committed.ledgerProjectionStatus, "stale");
  assert.equal(existsSync(archiveRoot(fixture)), true);
  assert.equal(existsSync(fixture.stateRoot), false);
  assert.equal(existsSync(sidecarPath(fixture)), false);
  assert.equal(existsSync(tombstonePath(fixture)), false);
  assert.equal(readFileSync(archiveIndex, "utf8"), "stale projection must not become authority\n");
});

test("journal recovery lets the projector reconcile an exact archive-index atomic stage", (t) => {
  const { fixture, transaction, memberContents } = prepareRecoveryFixture(t);
  writeArchiveJournal(fixture, transaction);
  createLedgerRecord({
    ledgerRoot: fixture.ledgerRoot,
    expectedProgramId: IDS.program,
    record: transaction.plan.manifest,
    memberContents,
  });
  const projection = buildLedgerProjection({
    ledgerRoot: fixture.ledgerRoot,
    programId: IDS.program,
    programDisplayName: fixture.model.program.displayName,
  });
  const archiveIndex = path.join(fixture.ledgerRoot, "workspace", "archive", "index.md");
  const stage = atomicCrashStage(archiveIndex);
  writeLedgerMember(stage, projection.files["workspace/archive/index.md"]);

  const recovered = recoverDemandBusinessArchive(recoveryInput(fixture));
  assert.equal(recovered.ledgerProjectionStatus, "current");
  assert.equal(existsSync(archiveRoot(fixture)), true);
  assert.equal(existsSync(fixture.stateRoot), false);
  assert.equal(existsSync(sidecarPath(fixture)), false);
  assert.equal(existsSync(tombstonePath(fixture)), false);
  assert.equal(existsSync(stage), false, "the projector owner consumes its derived crash residue");
  assert.equal(
    readFileSync(archiveIndex, "utf8"),
    projection.files["workspace/archive/index.md"],
  );
});

test("ledger-committed TODO recovery treats exact row absence as committed and rejects same-ID drift", async (t) => {
  await t.test("exact absent TODO row completes restored current+journal recovery", () => {
    const fixture = makeFixture(t, { todoBacked: true, secondTodo: true });
    terminalize(fixture);
    const input = archiveInput(fixture);
    const plan = planDemandBusinessArchive(input);
    const transaction = buildArchiveTransaction(fixture, input, plan);
    const backup = backupStateRoot(fixture, "todo-absent");
    commitDemandBusinessArchive(input);
    assert.deepEqual(
      todoService.scanTodoBoard(readFileSync(fixture.boardPath, "utf8")).rows.map((entry) => entry.id),
      ["TODO-M2-T09-OTHER"],
    );
    restoreStateRoot(fixture, backup);
    writeArchiveJournal(fixture, transaction);

    recoverDemandBusinessArchive(recoveryInput(fixture));
    assert.equal(existsSync(fixture.stateRoot), false);
    assert.deepEqual(
      todoService.scanTodoBoard(readFileSync(fixture.boardPath, "utf8")).rows.map((entry) => entry.id),
      ["TODO-M2-T09-OTHER"],
    );
  });

  await t.test("same TODO ID with different bytes blocks post-ledger deletion", () => {
    const fixture = makeFixture(t, { todoBacked: true, secondTodo: true });
    terminalize(fixture);
    const claimedValue = structuredClone(
      todoService.scanTodoBoard(readFileSync(fixture.boardPath, "utf8")).rows
        .find((entry) => entry.id === "TODO-M2-T09").value,
    );
    const input = archiveInput(fixture);
    const plan = planDemandBusinessArchive(input);
    const transaction = buildArchiveTransaction(fixture, input, plan);
    const backup = backupStateRoot(fixture, "todo-drift");
    commitDemandBusinessArchive(input);
    restoreStateRoot(fixture, backup);
    writeArchiveJournal(fixture, transaction);

    const currentRows = todoService.scanTodoBoard(readFileSync(fixture.boardPath, "utf8")).rows
      .map((entry) => structuredClone(entry.value));
    claimedValue["Item / Goal"] = "Reused ID with conflicting archived bytes";
    writeExact(fixture.boardPath, todoService.renderTodoBoard([claimedValue, ...currentRows]));
    const before = filesystemSnapshot(fixture.workspaceRoot);
    expectArchiveError(() => recoverDemandBusinessArchive(recoveryInput(fixture)), {
      code: /(?:todo|conflict)/u,
      forbidden: [fixture.workspaceRoot],
    });
    assert.deepEqual(filesystemSnapshot(fixture.workspaceRoot), before);
    assert.equal(existsSync(fixture.stateRoot), true);
    assert.equal(existsSync(journalPath(fixture)), true);
    assert.equal(existsSync(archiveRoot(fixture)), true);
  });
});

test("recovery accepts only the frozen current/journal, tombstone/sidecar, sidecar, or archive states", async (t) => {
  await t.test("tombstone plus sidecar plus ledger authority completes", () => {
    const fixture = makeFixture(t);
    terminalize(fixture);
    const input = archiveInput(fixture);
    const plan = planDemandBusinessArchive(input);
    const transaction = buildArchiveTransaction(fixture, input, plan);
    const backup = backupStateRoot(fixture, "tombstone");
    commitDemandBusinessArchive(input);
    restoreStateRoot(fixture, backup);
    writeArchiveJournal(fixture, transaction);
    writeArchiveSidecar(fixture, transaction);
    renameSync(fixture.stateRoot, tombstonePath(fixture));

    recoverDemandBusinessArchive(recoveryInput(fixture));
    assert.equal(existsSync(fixture.stateRoot), false);
    assert.equal(existsSync(tombstonePath(fixture)), false);
    assert.equal(existsSync(sidecarPath(fixture)), false);
    assert.equal(existsSync(archiveRoot(fixture)), true);
  });

  await t.test("sidecar plus ledger authority completes after tombstone cleanup", () => {
    const fixture = makeFixture(t);
    terminalize(fixture);
    const input = archiveInput(fixture);
    const plan = planDemandBusinessArchive(input);
    const transaction = buildArchiveTransaction(fixture, input, plan);
    commitDemandBusinessArchive(input);
    writeArchiveSidecar(fixture, transaction);

    recoverDemandBusinessArchive(recoveryInput(fixture));
    assert.equal(existsSync(sidecarPath(fixture)), false);
    assert.equal(existsSync(archiveRoot(fixture)), true);
  });

  await t.test("ledger authority alone is an idempotent complete replay", () => {
    const fixture = makeFixture(t);
    terminalize(fixture);
    const input = archiveInput(fixture);
    const committed = commitDemandBusinessArchive(input);
    const recovered = recoverDemandBusinessArchive(recoveryInput(fixture));
    assert.equal(recovered.manifestDigest, committed.manifestDigest);
    assert.equal(existsSync(fixture.stateRoot), false);
  });
});

test("illegal archive residue combinations fail closed without deleting evidence", async (t) => {
  await t.test("current and tombstone cannot coexist", () => {
    const fixture = makeFixture(t);
    terminalize(fixture);
    const input = archiveInput(fixture);
    const plan = planDemandBusinessArchive(input);
    const transaction = buildArchiveTransaction(fixture, input, plan);
    const backup = backupStateRoot(fixture, "coexist");
    commitDemandBusinessArchive(input);
    restoreStateRoot(fixture, backup);
    writeArchiveJournal(fixture, transaction);
    cpSync(fixture.stateRoot, tombstonePath(fixture), { recursive: true });
    writeArchiveSidecar(fixture, transaction);
    const before = filesystemSnapshot(fixture.workspaceRoot);

    expectArchiveError(() => recoverDemandBusinessArchive(recoveryInput(fixture)), {
      code: /recovery/u,
      forbidden: [fixture.workspaceRoot],
    });
    assert.deepEqual(filesystemSnapshot(fixture.workspaceRoot), before);
  });

  await t.test("tombstone with ledger authority still requires its exact sidecar", () => {
    const fixture = makeFixture(t);
    terminalize(fixture);
    const input = archiveInput(fixture);
    const plan = planDemandBusinessArchive(input);
    const transaction = buildArchiveTransaction(fixture, input, plan);
    const backup = backupStateRoot(fixture, "missing-sidecar");
    commitDemandBusinessArchive(input);
    restoreStateRoot(fixture, backup);
    writeArchiveJournal(fixture, transaction);
    renameSync(fixture.stateRoot, tombstonePath(fixture));
    const before = filesystemSnapshot(fixture.workspaceRoot);

    expectArchiveError(() => recoverDemandBusinessArchive(recoveryInput(fixture)), {
      code: /recovery/u,
      forbidden: [fixture.workspaceRoot],
    });
    assert.deepEqual(filesystemSnapshot(fixture.workspaceRoot), before);
  });

  await t.test("orphan sidecar without ledger authority is not a transaction owner", () => {
    const fixture = makeFixture(t);
    terminalize(fixture);
    const input = archiveInput(fixture);
    const plan = planDemandBusinessArchive(input);
    const transaction = buildArchiveTransaction(fixture, input, plan);
    renameSync(fixture.stateRoot, path.join(fixture.workspaceRoot, ".orphan-source"));
    writeArchiveSidecar(fixture, transaction);
    const before = filesystemSnapshot(fixture.workspaceRoot);

    expectArchiveError(() => recoverDemandBusinessArchive(recoveryInput(fixture)), {
      code: /recovery/u,
      forbidden: [fixture.workspaceRoot],
    });
    assert.deepEqual(filesystemSnapshot(fixture.workspaceRoot), before);
  });

  await t.test("unknown tombstone member blocks bounded cleanup", () => {
    const fixture = makeFixture(t);
    terminalize(fixture);
    const input = archiveInput(fixture);
    const plan = planDemandBusinessArchive(input);
    const transaction = buildArchiveTransaction(fixture, input, plan);
    const backup = backupStateRoot(fixture, "unknown-tombstone");
    commitDemandBusinessArchive(input);
    restoreStateRoot(fixture, backup);
    writeArchiveJournal(fixture, transaction);
    writeArchiveSidecar(fixture, transaction);
    renameSync(fixture.stateRoot, tombstonePath(fixture));
    writeExact(path.join(tombstonePath(fixture), "unknown-private.txt"), "must survive\n");
    const before = filesystemSnapshot(fixture.workspaceRoot);

    expectArchiveError(() => recoverDemandBusinessArchive(recoveryInput(fixture)), {
      code: /recovery/u,
      forbidden: [fixture.workspaceRoot],
    });
    assert.deepEqual(filesystemSnapshot(fixture.workspaceRoot), before);
    assert.equal(existsSync(path.join(tombstonePath(fixture), "unknown-private.txt")), true);
  });

  await t.test("a symlinked active ancestor cannot redirect recovery cleanup outside the workspace", {
    skip: process.platform === "win32",
  }, () => {
    const fixture = makeFixture(t);
    terminalize(fixture);
    const input = archiveInput(fixture);
    const plan = planDemandBusinessArchive(input);
    const transaction = buildArchiveTransaction(fixture, input, plan);
    commitDemandBusinessArchive(input);

    const activeRoot = path.join(fixture.workspaceRoot, ".wakeflow-active");
    renameSync(activeRoot, path.join(fixture.workspaceRoot, ".wakeflow-active-displaced"));
    const externalRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-business-archive-external-active-"));
    t.after(() => rmSync(externalRoot, { recursive: true, force: true }));
    const externalCurrent = path.join(externalRoot, "current");
    mkdirExact(externalCurrent, 0o700);
    writeExact(
      path.join(externalCurrent, `.${IDS.demand}.wakeflow-archive-intent.json`),
      businessArchiveCanonicalBytes(transaction),
    );
    writeExact(path.join(externalCurrent, "sentinel.txt"), "must survive redirected recovery\n");
    symlinkSync(externalRoot, activeRoot);
    const before = filesystemSnapshot(externalRoot);

    expectArchiveError(() => recoverDemandBusinessArchive(recoveryInput(fixture)), {
      code: /recovery/u,
      forbidden: [fixture.workspaceRoot, externalRoot],
    });
    assert.deepEqual(filesystemSnapshot(externalRoot), before);
  });
});

test("portable privacy rejects credentials, private paths, and bare UUIDs while admitting typed IDs", (t) => {
  const disposableRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-business-archive-privacy-"));
  t.after(() => rmSync(disposableRoot, { recursive: true, force: true }));
  const preservationId = "preservation_cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const typedPayload = Buffer.from(`portable ${IDS.demand}\n`, "utf8");
  assert.deepEqual(
    assertBusinessArchivePortable({
      values: [{ demandId: IDS.demand, note: IDS.archive, preservationId }],
      opaqueMembers: [{ ref: "payload/typed-id.txt", bytes: typedPayload }],
      forbiddenRoots: [disposableRoot],
    }),
    {
      schemaVersion: 1,
      disposition: "passed",
      findingCount: 0,
      scannedStringCount: 3,
      scannedByteCount: typedPayload.length,
    },
  );

  const unsafe = [
    "ghp_WakeflowBusinessArchiveSecret1234567890",
    "/Users/customer/private-product",
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  ];
  for (const finding of unsafe) {
    assert.throws(
      () => assertBusinessArchivePortable({
        values: [{ note: finding }],
        forbiddenRoots: [disposableRoot],
      }),
      (error) => {
        assert.equal(error.code, "wakeflow-business-archive-privacy");
        assert.equal(JSON.stringify(error).includes(finding), false);
        assert.equal(error.details.findingCount, 1);
        return true;
      },
    );
  }

  let calls = 0;
  const behavioral = {};
  Object.defineProperty(behavioral, "note", {
    enumerable: true,
    get() {
      calls += 1;
      return unsafe[0];
    },
  });
  assert.throws(
    () => assertBusinessArchivePortable({ values: [behavioral] }),
    (error) => error?.code === "wakeflow-business-archive-privacy",
  );
  assert.equal(calls, 0);
});
