import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  withWakeflowActiveProjectionLock,
} from "../core/scripts/lib/wakeflow-active-projection-lock.mjs";
import {
  createTaskPackageArtifact,
  recordTargetResultArtifact,
} from "../core/scripts/lib/wakeflow-demand-artifact-service.mjs";
import {
  parseWakeflowConfigV3,
  serializeWakeflowConfigV3,
} from "../core/scripts/lib/wakeflow-config-v3.mjs";
import {
  publishInitialDemandPublication,
} from "../core/scripts/lib/wakeflow-demand-publication-service.mjs";
import {
  commitDemandStateTransition,
  loadDemandCoreRecordsWithArtifactClosure,
} from "../core/scripts/lib/wakeflow-demand-state-service.mjs";
import {
  createLedgerMemberReference,
  createLedgerRecord,
  loadLedgerRecord,
} from "../core/scripts/lib/wakeflow-ledger-records.mjs";
import {
  parseWakeflowAssetBundle,
} from "../core/scripts/lib/wakeflow-template-renderer.mjs";
import * as todoService from "../core/scripts/lib/wakeflow-todo-service.mjs";
import {
  buildWakeflowAssetBundle,
} from "../tools/build-asset-bundle.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(repositoryRoot, "core/template-sources");
const configFixturePath = path.join(repositoryRoot, "test/fixtures/wakeflow-config-v3/valid-minimal.json");
const projectorUrl = new URL("../core/scripts/lib/wakeflow-active-projector.mjs", import.meta.url);

const IDS = Object.freeze({
  program: "program_11111111-1111-4111-8111-111111111111",
  demandA: "demand_22222222-2222-4222-8222-222222222222",
  demandB: "demand_88888888-8888-4888-8888-888888888888",
  controllerWindow: "window_55555555-5555-4555-8555-555555555555",
  designWindow: "window_66666666-6666-4666-8666-666666666666",
  repository: "repository_22222222-2222-4222-8222-222222222222",
  productWindow: "window_88888888-8888-4888-8888-888888888888",
  taskPackage: "task-package_66666666-6666-4666-8666-666666666666",
  targetTask: "target-task_77777777-7777-4777-8777-777777777777",
  targetResult: "target-result_99999999-9999-4999-8999-999999999999",
  isolatedRequirement: "requirement_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  isolatedConfirmation: "confirmation_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
});
const CREATED_AT = "2026-08-07T01:02:03.000Z";
const UPDATED_AT = "2026-08-07T01:03:04.000Z";
const WORKSPACE_INDEX_REF = ".wakeflow-active/index.md";
const WORKSPACE_STATUS_REF = ".wakeflow-active/current/workspace-current-status.md";
const TODO_REF = ".wakeflow-active/current/global-todo-board.md";
const PROJECTOR_LOCK_REF = ".wakeflow-active/projector.lock";

const bundle = parseWakeflowAssetBundle(buildWakeflowAssetBundle({ sourceRoot }));

async function projectorApi() {
  return import(projectorUrl.href);
}

function absolute(workspaceRoot, ref) {
  return path.join(workspaceRoot, ...ref.split("/"));
}

function digestBytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function writeExact(file, content, mode = 0o600) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, content, { mode });
  if (process.platform !== "win32") chmodSync(file, mode);
}

function configuredModel(language = "en", configure = null) {
  const value = JSON.parse(readFileSync(configFixturePath, "utf8"));
  value.program.interfaceLanguage = language;
  value.topology.repositories[0].path = "ProductA";
  value.topology.supportSurfaces[0].path = "Design";
  value.topology.supportSurfaces[1].path = "Test";
  value.storage.ledgerRoot = "Ledger";
  configure?.(value);
  return parseWakeflowConfigV3(value);
}

function workspaceFixture({ language = "en", configure = null } = {}) {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-active-projector-"));
  const model = configuredModel(language, configure);
  for (const relative of new Set([
    ".wakeflow-active/current",
    ".wakeflow-local",
    "Design",
    model.storage.ledgerRoot,
    `${model.storage.ledgerRoot}/goal-stage-confirmation`,
    `${model.storage.ledgerRoot}/requirement-designs`,
    `${model.storage.ledgerRoot}/workspace/archive`,
    "ProductA",
    "Test",
  ])) {
    const directory = absolute(workspaceRoot, relative);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") chmodSync(directory, 0o700);
  }
  const configPath = path.join(workspaceRoot, "wakeflow.config.json");
  writeExact(configPath, serializeWakeflowConfigV3(model));
  const boardPath = absolute(workspaceRoot, TODO_REF);
  todoService.createTodoBoardIfAbsent({
    root: workspaceRoot,
    boardPath,
    freshWorkspace: true,
  });
  return {
    workspaceRoot,
    configPath,
    currentRoot: absolute(workspaceRoot, ".wakeflow-active/current"),
    boardPath,
    language,
    model,
  };
}

function projectorInput(fixture) {
  return {
    workspaceRoot: fixture.workspaceRoot,
    bundle,
    language: fixture.language,
  };
}

function todoRow(todoId) {
  return {
    ID: todoId,
    Status: "pending-claim",
    Type: "requirement",
    Priority: "P1",
    Owner: IDS.designWindow,
    "Item / Goal": `Publish ${todoId}`,
    "Affects Retest / Dispatch": "yes",
    "Dependency / Trigger": "confirmed requirement",
    "Recommended Window": IDS.controllerWindow,
    "Current Mount": "none",
    "Auto Claim": "yes",
    "Testing Decision": "controller-only: run bounded candidate tests",
    Documents: "[requirement](requirement-designs/requirement_33333333-3333-4333-8333-333333333333/01-original-plan.md)",
  };
}

function demandRecord({ demandId, source, title, executionPlacement = { mode: "main" } }) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand",
    programId: IDS.program,
    demandId,
    createdAt: CREATED_AT,
    title,
    goal: "Project one strict demand root into deterministic offline orientation.",
    completionDefinition: "Workspace and demand projections bind the exact authority source.",
    demandType: "requirement",
    source,
    executionPlacement,
  };
}

function frozenAuthorityForDemand(fixture, demand) {
  const ledgerRoot = path.resolve(fixture.workspaceRoot, fixture.model.storage.ledgerRoot);
  mkdirSync(path.join(ledgerRoot, "requirement-designs"), { recursive: true, mode: 0o700 });
  const roles = [
    "original-plan",
    "requirement-design",
    "code-facts",
    "landing-plan",
    "non-goals",
    "user-confirmation",
    "test-environment",
  ];
  const documents = roles.map((role, index) => {
    const memberPath = `${String(index + 1).padStart(2, "0")}-${role}.md`;
    const content = `# ${role}\n`;
    return {
      role,
      path: memberPath,
      mediaType: "text/markdown",
      digest: digestBytes(Buffer.from(content, "utf8")),
      content,
    };
  });
  const created = createLedgerRecord({
    ledgerRoot,
    expectedProgramId: IDS.program,
    record: {
      schemaVersion: 1,
      artifactKind: "wakeflow-requirement-record",
      requirementId: "requirement_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      programId: IDS.program,
      title: "T08 frozen projector authority",
      status: "confirmed",
      relatedDemandIds: [demand.demandId],
      documents: documents.map(({ content: _content, ...document }) => document),
    },
    memberContents: Object.fromEntries(documents.map((entry) => [entry.path, entry.content])),
  });
  const loaded = loadLedgerRecord({
    ledgerRoot,
    root: created.root,
    expectedFamily: "requirement",
    expectedProgramId: IDS.program,
  });
  const authorityRefs = documents.map((entry) => createLedgerMemberReference(loaded, entry.path));
  const environment = authorityRefs.find((entry) => entry.role === "test-environment");
  return {
    ledgerRoot,
    goalRef: authorityRefs.find((entry) => entry.role === "original-plan"),
    authority: {
      schemaVersion: 1,
      artifactKind: "wakeflow-demand-authority",
      demandId: demand.demandId,
      demandRef: "demand.json",
      demandDigest: canonicalJsonDigest(demand),
      entryMode: "design-delivery",
      authorityRefs,
      testDecision: {
        mode: "real-environment",
        summary: "Use the exact confirmed real-environment strategy.",
        environmentSpecRef: environment.memberRef,
      },
    },
  };
}

function publishIsolatedDemand(fixture, {
  demandId,
  title,
  eventId,
}) {
  const ledgerRoot = path.resolve(fixture.workspaceRoot, fixture.model.storage.ledgerRoot);
  mkdirSync(path.join(ledgerRoot, "requirement-designs"), { recursive: true, mode: 0o700 });
  mkdirSync(path.join(ledgerRoot, "goal-stage-confirmation"), { recursive: true, mode: 0o700 });
  const requirementDocuments = [
    "code-facts",
    "landing-plan",
    "non-goals",
    "original-plan",
    "requirement-design",
    "user-confirmation",
  ].map((role, index) => {
    const memberPath = `${String(index + 1).padStart(2, "0")}-${role}.md`;
    const content = `# ${role}\n`;
    return {
      role,
      path: memberPath,
      mediaType: "text/markdown",
      digest: digestBytes(Buffer.from(content, "utf8")),
      content,
    };
  });
  const createdRequirement = createLedgerRecord({
    ledgerRoot,
    expectedProgramId: IDS.program,
    record: {
      schemaVersion: 1,
      artifactKind: "wakeflow-requirement-record",
      requirementId: IDS.isolatedRequirement,
      programId: IDS.program,
      title: "T08 isolated projector authority",
      status: "confirmed",
      relatedDemandIds: [demandId],
      documents: requirementDocuments.map(({ content: _content, ...document }) => document),
    },
    memberContents: Object.fromEntries(
      requirementDocuments.map((entry) => [entry.path, entry.content]),
    ),
  });
  const loadedRequirement = loadLedgerRecord({
    ledgerRoot,
    root: createdRequirement.root,
    expectedFamily: "requirement",
    expectedProgramId: IDS.program,
  });
  const authorityRefs = requirementDocuments.map((entry) => (
    createLedgerMemberReference(loadedRequirement, entry.path)
  ));

  const confirmationDocuments = [
    ["goal-stage-decision", "01-goal-stage-decision.md"],
    ["user-confirmation", "02-user-confirmation.md"],
  ].map(([role, memberPath]) => {
    const content = `# ${role}\n`;
    return {
      role,
      path: memberPath,
      mediaType: "text/markdown",
      digest: digestBytes(Buffer.from(content, "utf8")),
      content,
    };
  });
  const createdConfirmation = createLedgerRecord({
    ledgerRoot,
    expectedProgramId: IDS.program,
    record: {
      schemaVersion: 1,
      artifactKind: "wakeflow-confirmation-record",
      confirmationId: IDS.isolatedConfirmation,
      programId: IDS.program,
      demandId,
      title: "T08 isolated placement confirmation",
      status: "confirmed",
      documents: confirmationDocuments.map(({ content: _content, ...document }) => document),
    },
    memberContents: Object.fromEntries(
      confirmationDocuments.map((entry) => [entry.path, entry.content]),
    ),
  });
  const loadedConfirmation = loadLedgerRecord({
    ledgerRoot,
    root: createdConfirmation.root,
    expectedFamily: "confirmation",
    expectedProgramId: IDS.program,
  });
  const placementRef = createLedgerMemberReference(
    loadedConfirmation,
    confirmationDocuments[0].path,
  );
  const demand = demandRecord({
    demandId,
    title,
    source: {
      schemaVersion: 1,
      artifactKind: "wakeflow-demand-ledger-source",
      memberRefs: authorityRefs,
    },
    executionPlacement: {
      mode: "isolated",
      authorizationRef: placementRef,
    },
  });
  const authority = {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand-authority",
    demandId,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(demand),
    entryMode: "pod-design",
    authorityRefs,
    testDecision: {
      mode: "controller-only",
      summary: "Run the bounded candidate projector suite.",
    },
  };
  const result = publishInitialDemandPublication({
    workspaceRoot: fixture.workspaceRoot,
    ledgerRoot,
    expectedProgramId: IDS.program,
    bundle,
    language: fixture.language,
    demand,
    authority,
    initialTransition: {
      eventId,
      createdAt: CREATED_AT,
      reason: "candidate isolated demand publication initialized",
      decisionSummary: "Publish one complete isolated root before projection.",
    },
    expectedTodoRow: null,
  });
  return {
    ...result,
    stateRoot: path.join(fixture.currentRoot, demandId),
    demandId,
    demand,
    authority,
    ledgerRoot,
  };
}

function publishDemand(fixture, {
  demandId,
  todoId,
  title,
  eventId,
  frozen = false,
}) {
  todoService.appendTodoRow({
    root: fixture.workspaceRoot,
    boardPath: fixture.boardPath,
    row: todoRow(todoId),
  });
  const board = todoService.scanTodoBoard(readFileSync(fixture.boardPath, "utf8"));
  const row = board.rows.find((candidate) => candidate.id === todoId);
  assert.ok(row, todoId);
  const demand = demandRecord({ demandId, source: row.lineageRef, title });
  const frozenContext = frozen ? frozenAuthorityForDemand(fixture, demand) : null;
  const ledgerRoot = frozenContext?.ledgerRoot
    ?? path.resolve(fixture.workspaceRoot, fixture.model.storage.ledgerRoot);
  const result = publishInitialDemandPublication({
    workspaceRoot: fixture.workspaceRoot,
    ledgerRoot,
    expectedProgramId: IDS.program,
    bundle,
    language: fixture.language,
    demand,
    authority: frozenContext?.authority ?? null,
    initialTransition: {
      eventId,
      createdAt: CREATED_AT,
      reason: "candidate demand publication initialized",
      decisionSummary: "Publish one complete strict demand root before projection.",
    },
    expectedTodoRow: row.snapshot,
  });
  return {
    ...result,
    stateRoot: path.join(fixture.currentRoot, demandId),
    demandId,
    demand,
    authority: frozenContext?.authority ?? null,
    ledgerRoot,
    goalRef: frozenContext?.goalRef ?? null,
  };
}

function strictStack(published) {
  return loadDemandCoreRecordsWithArtifactClosure({
    stateRoot: published.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: published.ledgerRoot,
  });
}

function artifactTransition(eventId, createdAt) {
  return {
    eventId,
    createdAt,
    reason: `commit ${eventId}`,
    decisionSummary: `Bind the exact immutable artifact for ${eventId}.`,
  };
}

function createBlockedTargetResult(fixture, published) {
  const taskPackage = {
    schemaVersion: 1,
    artifactKind: "wakeflow-task-package",
    programId: IDS.program,
    demandId: published.demandId,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(published.demand),
    createdAt: "2026-08-07T01:04:00.000Z",
    demandAuthorityRef: "demand-authority.json",
    demandAuthorityDigest: canonicalJsonDigest(published.authority),
    taskPackageId: IDS.taskPackage,
    targetTaskId: IDS.targetTask,
    windowId: IDS.productWindow,
    repositoryId: IDS.repository,
    workType: "implementation",
    objective: "Return one real blocked TargetResult for projector classification.",
    confirmedContext: ["The exact T08 projector integration context is frozen."],
    requirementRefs: [{
      role: "goal",
      ref: published.goalRef.memberRef,
      digest: published.goalRef.memberDigest,
      anchor: "original-plan",
    }],
    boundaries: {
      inScope: ["Only the assigned target change."],
      outOfScope: ["Unrelated repositories and demands."],
      forbidden: ["Do not mutate controller authority."],
    },
    completionExpectations: ["Return one strict TargetResult."],
    dependsOnTargetTaskIds: [],
    commitExpectation: "leave-uncommitted",
    acceptanceAnchors: [{
      anchorId: "A1",
      claim: "The target reports a deterministic blocker.",
      probe: "Inspect the strict TargetResult outcome.",
      expected: "The outcome is blocked.",
    }],
    reviewInputContract: {
      requiredKinds: ["test-output"],
      requiredAcceptanceAnchorIds: ["A1"],
    },
  };
  let stack = strictStack(published);
  createTaskPackageArtifact({
    stateRoot: published.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: published.ledgerRoot,
    config: fixture.model,
    expectedPrevious: { revision: stack.state.revision, stateDigest: stack.digests.state },
    artifact: taskPackage,
    transition: artifactTransition("event-t08-task-package-0002", taskPackage.createdAt),
  });
  stack = strictStack(published);
  const dispatchEvent = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: "event-t08-target-dispatched-0003",
    demandId: published.demandId,
    createdAt: "2026-08-07T01:04:30.000Z",
    actor: "controller",
    command: "dispatch-target",
    type: "target-task.dispatched",
    previousRevision: stack.state.revision,
    nextRevision: stack.state.revision + 1,
    from: stack.state.state,
    to: "dispatched",
    reason: "Dispatch the exact target task for the T08 integration fixture.",
    decisionSummary: "The Controller selected the exact immutable task package.",
    changedArtifacts: [],
  };
  const dispatchedState = structuredClone(stack.state);
  dispatchedState.revision = dispatchEvent.nextRevision;
  dispatchedState.state = dispatchEvent.to;
  dispatchedState.stateReason = dispatchEvent.reason;
  dispatchedState.updatedAt = dispatchEvent.createdAt;
  dispatchedState.lastEvent = {
    eventId: dispatchEvent.eventId,
    eventDigest: canonicalJsonDigest(dispatchEvent),
  };
  dispatchedState.targetTasks.find((entry) => entry.targetTaskId === IDS.targetTask).lifecycleStatus = "dispatched";
  writeExact(
    path.join(published.stateRoot, "controller-events.jsonl"),
    `${stack.events.map((entry) => canonicalJson(entry)).join("\n")}\n${canonicalJson(dispatchEvent)}\n`,
  );
  writeExact(
    path.join(published.stateRoot, "wakeflow-state.json"),
    `${canonicalJson(dispatchedState)}\n`,
  );
  stack = strictStack(published);
  const targetResult = {
    schemaVersion: 1,
    artifactKind: "wakeflow-target-result",
    programId: IDS.program,
    demandId: published.demandId,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(published.demand),
    createdAt: "2026-08-07T01:05:00.000Z",
    targetResultId: IDS.targetResult,
    targetTaskId: IDS.targetTask,
    taskPackage: {
      taskPackageId: IDS.taskPackage,
      ref: `task-packages/${IDS.taskPackage}.json`,
      digest: canonicalJsonDigest(taskPackage),
    },
    assignment: {
      windowId: IDS.productWindow,
      repositoryId: IDS.repository,
    },
    observedState: {
      revision: stack.state.revision,
      eventId: stack.state.lastEvent.eventId,
      eventDigest: stack.state.lastEvent.eventDigest,
    },
    transport: {
      group: {
        id: "group-t08-blocked",
        ref: "transport/groups/group-t08-blocked.json",
        digest: `sha256:${"3".repeat(64)}`,
      },
      envelope: {
        id: "envelope-t08-blocked",
        ref: "transport/envelopes/envelope-t08-blocked.json",
        digest: `sha256:${"4".repeat(64)}`,
      },
    },
    outcome: "blocked",
    summary: "The target returned an explicit blocker for Controller review.",
    repositoryChanges: [{
      repositoryId: IDS.repository,
      disposition: "left-uncommitted",
      commits: [],
    }],
    evidenceLocators: [],
    verification: ["The blocker was reproduced."],
    risks: ["Controller action is required."],
    craftMapping: [],
  };
  recordTargetResultArtifact({
    stateRoot: published.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: published.ledgerRoot,
    config: fixture.model,
    expectedPrevious: { revision: stack.state.revision, stateDigest: stack.digests.state },
    artifact: targetResult,
    selection: "current",
    transition: artifactTransition("event-t08-target-result-0004", targetResult.createdAt),
  });
  return { taskPackage, targetResult, stack: strictStack(published) };
}

function blockDemand(published, eventId = "event-blocked-0002") {
  const stateFile = path.join(published.stateRoot, "wakeflow-state.json");
  const previousState = JSON.parse(readFileSync(stateFile, "utf8"));
  const reason = "bounded authority requires user repair";
  const event = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId,
    demandId: published.demandId,
    createdAt: UPDATED_AT,
    actor: "controller",
    command: "continue-demand",
    type: "state.transitioned",
    previousRevision: previousState.revision,
    nextRevision: previousState.revision + 1,
    from: previousState.state,
    to: "blocked",
    reason,
    decisionSummary: "Expose the blocked authority state without deriving a second state machine.",
    changedArtifacts: [],
  };
  const nextState = {
    ...previousState,
    revision: event.nextRevision,
    state: event.to,
    stateReason: reason,
    updatedAt: UPDATED_AT,
    lastEvent: {
      eventId,
      eventDigest: canonicalJsonDigest(event),
    },
  };
  commitDemandStateTransition({
    stateRoot: published.stateRoot,
    expectedProgramId: IDS.program,
    expectedPrevious: {
      revision: previousState.revision,
      stateDigest: canonicalJsonDigest(previousState),
    },
    event,
    nextState,
  });
  return { event, nextState };
}

function archiveDemandInCurrent(published, eventId = "event-archived-current-0002") {
  const stateFile = path.join(published.stateRoot, "wakeflow-state.json");
  const previousState = JSON.parse(readFileSync(stateFile, "utf8"));
  const reason = "archive transition committed before the state root move";
  const event = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId,
    demandId: published.demandId,
    createdAt: UPDATED_AT,
    actor: "controller",
    command: "archive-demand",
    type: "demand.archived",
    previousRevision: previousState.revision,
    nextRevision: previousState.revision + 1,
    from: previousState.state,
    to: "archived",
    reason,
    decisionSummary: "Keep the committed archived state in current only as a diagnosed move residue.",
    changedArtifacts: [],
  };
  const nextState = {
    ...previousState,
    revision: event.nextRevision,
    state: event.to,
    stateReason: reason,
    updatedAt: UPDATED_AT,
    lastEvent: {
      eventId,
      eventDigest: canonicalJsonDigest(event),
    },
  };
  // 该夹具故意模拟旧归档流程已经改写 core、却在搬移 state root 前中断的非法残留；
  // production writer 现在必须拒绝此路径，因此测试直接物化待诊断的历史坏状态。
  const eventsFile = path.join(published.stateRoot, "controller-events.jsonl");
  writeFileSync(
    eventsFile,
    `${readFileSync(eventsFile, "utf8")}${canonicalJson(event)}\n`,
    { mode: 0o600 },
  );
  writeFileSync(stateFile, `${canonicalJson(nextState)}\n`, { mode: 0o600 });
  return { event, nextState };
}

function snapshotFiles(root) {
  const snapshot = new Map();
  const walk = (directory, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      const ref = prefix ? `${prefix}/${entry.name}` : entry.name;
      const file = path.join(directory, entry.name);
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) {
        snapshot.set(ref, {
          kind: "symlink",
          target: readlinkSync(file),
          mode: stat.mode & 0o777,
        });
      } else if (stat.isDirectory()) {
        walk(file, ref);
      } else {
        snapshot.set(ref, {
          kind: "file",
          digest: digestBytes(readFileSync(file)),
          mode: stat.mode & 0o777,
          links: stat.nlink,
        });
      }
    }
  };
  walk(root);
  return snapshot;
}

function changedFileRefs(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((ref) => JSON.stringify(before.get(ref)) !== JSON.stringify(after.get(ref)))
    .sort();
}

function fileIdentity(file) {
  const stat = statSync(file, { bigint: true });
  return {
    ino: stat.ino,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    digest: digestBytes(readFileSync(file)),
  };
}

function projectionAxes(result) {
  assert.ok(result && typeof result === "object", "projector must return a structured result");
  return result.axes && typeof result.axes === "object" ? result.axes : result;
}

function assertAxes(result, expected) {
  const axes = projectionAxes(result);
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(axes[key], value, `${key} must be ${value}`);
  }
}

function issueCodes(result) {
  const issues = result.issues ?? result.diagnostics?.issues ?? projectionAxes(result).issues ?? [];
  assert.equal(Array.isArray(issues), true, "projector issues must be an array");
  return issues.map((issue) => issue?.code);
}

function assertSanitized(value, fixture, secrets = []) {
  const rendered = value instanceof Error
    ? JSON.stringify({
      name: value.name,
      code: value.code,
      message: value.message,
      path: value.path,
      details: value.details,
      cause: value.cause?.message,
    })
    : JSON.stringify(value);
  assert.equal(rendered.includes(fixture.workspaceRoot), false, rendered);
  assert.equal(rendered.includes(fixture.configPath), false, rendered);
  for (const secret of secrets) assert.equal(rendered.includes(secret), false, secret);
}

function projectionFingerprint(content) {
  const match = content.match(
    /<!-- wakeflow:active-projection:v([1-9][0-9]*):(sha256:[0-9a-f]{64}) -->/u,
  );
  assert.ok(match, "workspace projection must carry its canonical source fingerprint marker");
  return { schemaVersion: Number(match[1]), fingerprint: match[2] };
}

function projectionRefs(demandIds = []) {
  return [
    WORKSPACE_INDEX_REF,
    WORKSPACE_STATUS_REF,
    ...demandIds.flatMap((demandId) => [
      `.wakeflow-active/current/${demandId}/index.md`,
      `.wakeflow-active/current/${demandId}/developer-progress.md`,
    ]),
  ].sort();
}

function runUnsafeRebuild(api, fixture) {
  try {
    const result = api.rebuildWakeflowActiveProjection(projectorInput(fixture));
    assertAxes(result, { projectionStatus: "unsafe" });
    assertSanitized(result, fixture);
  } catch (error) {
    assert.equal(error instanceof api.WakeflowActiveProjectorError, true, error?.stack);
    assert.match(error.code ?? "", /unsafe/u);
    assertSanitized(error, fixture);
  }
}

function runProjectorChild(fixture) {
  const source = [
    `import { buildWakeflowAssetBundle } from ${JSON.stringify(new URL("../tools/build-asset-bundle.mjs", import.meta.url).href)};`,
    `import { parseWakeflowAssetBundle } from ${JSON.stringify(new URL("../core/scripts/lib/wakeflow-template-renderer.mjs", import.meta.url).href)};`,
    `import { rebuildWakeflowActiveProjection } from ${JSON.stringify(projectorUrl.href)};`,
    "const bundle = parseWakeflowAssetBundle(buildWakeflowAssetBundle({ sourceRoot: process.argv[2] }));",
    "const result = rebuildWakeflowActiveProjection({ workspaceRoot: process.argv[1], bundle, language: 'en' });",
    "process.stdout.write(`${JSON.stringify(result)}\\n`);",
  ].join("\n");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--input-type=module",
      "--eval",
      source,
      fixture.workspaceRoot,
      sourceRoot,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`projector child exited ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (cause) {
        reject(new Error(`projector child returned invalid JSON: ${stdout}`, { cause }));
      }
    });
  });
}

test("full active projector exposes only the admitted API and rejects caller-supplied config or plan", async () => {
  const api = await projectorApi();
  assert.deepEqual(Object.keys(api).sort(), [
    "WAKEFLOW_ACTIVE_PROJECTION_MAINTENANCE_KIND",
    "WAKEFLOW_ACTIVE_PROJECTION_MAINTENANCE_SCHEMA_ID",
    "WAKEFLOW_ACTIVE_PROJECTION_MAINTENANCE_SCHEMA_VERSION",
    "WAKEFLOW_ACTIVE_PROJECTOR_SCHEMA_VERSION",
    "WakeflowActiveProjectorError",
    "createWakeflowActiveProjectionMutationParticipant",
    "inspectWakeflowActiveProjection",
    "planWakeflowActiveProjectionMaintenance",
    "projectWakeflowActiveProjectionMaintenance",
    "rebuildWakeflowActiveProjection",
    "validateWakeflowActiveProjectionMaintenancePlan",
  ]);
  assert.equal(api.WAKEFLOW_ACTIVE_PROJECTOR_SCHEMA_VERSION, 1);

  const fixture = workspaceFixture();
  for (const [operation, extra] of [
    [api.inspectWakeflowActiveProjection, { configPath: fixture.configPath }],
    [api.rebuildWakeflowActiveProjection, { plan: {} }],
    [api.inspectWakeflowActiveProjection, { [`${fixture.workspaceRoot}/customer-token-ALPHA-pid-424242`]: true }],
  ]) {
    assert.throws(
      () => operation({ ...projectorInput(fixture), ...extra }),
      (error) => {
        assert.equal(error instanceof api.WakeflowActiveProjectorError, true);
        assert.match(error.code ?? "", /input|unknown/u);
        assertSanitized(error, fixture, ["customer-token-ALPHA", "424242"]);
        return true;
      },
    );
  }
  assert.equal(existsSync(absolute(fixture.workspaceRoot, WORKSPACE_INDEX_REF)), false);
  assert.equal(existsSync(absolute(fixture.workspaceRoot, WORKSPACE_STATUS_REF)), false);
});

test("zero-demand inspect is read-only and rebuild is deterministic, 0600, and insensitive to TODO/local/mtime", async () => {
  const api = await projectorApi();
  const fixture = workspaceFixture();
  const beforeInspect = snapshotFiles(fixture.workspaceRoot);
  const inspected = api.inspectWakeflowActiveProjection(projectorInput(fixture));
  assertAxes(inspected, {
    demandSet: "empty",
    sourceHealth: "complete",
    storageHealth: "healthy",
    orientation: "idle",
    projectionStatus: "missing",
  });
  assert.match(inspected.configDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(inspected.storageInventory.status, "observed");
  const eventCounts = new Map(inspected.storageInventory.entries.map((entry) => [entry.key, entry]));
  assert.deepEqual(eventCounts.get("event.active.projector.lock"), {
    key: "event.active.projector.lock",
    count: 0,
    health: "current",
  });
  assert.deepEqual(eventCounts.get("event.demand.root"), {
    key: "event.demand.root",
    count: 0,
    health: "current",
  });
  assert.deepEqual(eventCounts.get("event.demand.transaction.state-transition"), {
    key: "event.demand.transaction.state-transition",
    count: 0,
    health: "current",
  });
  const duringProjectionOperation = withWakeflowActiveProjectionLock(
    fixture.workspaceRoot,
    () => api.inspectWakeflowActiveProjection(projectorInput(fixture)),
  );
  assert.deepEqual(
    duringProjectionOperation.storageInventory.entries.find((entry) => (
      entry.key === "event.active.projector.lock"
    )),
    { key: "event.active.projector.lock", count: 1, health: "blocked-reference" },
  );
  assert.deepEqual(snapshotFiles(fixture.workspaceRoot), beforeInspect);

  const rebuilt = api.rebuildWakeflowActiveProjection(projectorInput(fixture));
  assertAxes(rebuilt, {
    demandSet: "empty",
    sourceHealth: "complete",
    storageHealth: "healthy",
    orientation: "idle",
    projectionStatus: "current",
  });
  const indexFile = absolute(fixture.workspaceRoot, WORKSPACE_INDEX_REF);
  const statusFile = absolute(fixture.workspaceRoot, WORKSPACE_STATUS_REF);
  if (process.platform !== "win32") {
    assert.equal(statSync(indexFile).mode & 0o777, 0o600);
    assert.equal(statSync(statusFile).mode & 0o777, 0o600);
  }
  const indexFingerprint = projectionFingerprint(readFileSync(indexFile, "utf8"));
  const statusFingerprint = projectionFingerprint(readFileSync(statusFile, "utf8"));
  assert.deepEqual(indexFingerprint, statusFingerprint);
  assert.equal(indexFingerprint.schemaVersion, api.WAKEFLOW_ACTIVE_PROJECTOR_SCHEMA_VERSION);
  assert.match(readFileSync(statusFile, "utf8"), /\bidle\b/iu);

  const beforeNoop = new Map([
    [WORKSPACE_INDEX_REF, fileIdentity(indexFile)],
    [WORKSPACE_STATUS_REF, fileIdentity(statusFile)],
  ]);
  todoService.appendTodoRow({
    root: fixture.workspaceRoot,
    boardPath: fixture.boardPath,
    row: todoRow("TODO-M2-T08-NON-SOURCE"),
  });
  writeExact(absolute(fixture.workspaceRoot, ".wakeflow-local/non-source.json"), "{\"local\":true}\n");
  utimesSync(fixture.configPath, new Date("2026-08-07T02:00:00.000Z"), new Date("2026-08-07T02:00:00.000Z"));
  const second = api.rebuildWakeflowActiveProjection(projectorInput(fixture));
  assertAxes(second, { projectionStatus: "current", orientation: "idle" });
  assert.deepEqual(fileIdentity(indexFile), beforeNoop.get(WORKSPACE_INDEX_REF));
  assert.deepEqual(fileIdentity(statusFile), beforeNoop.get(WORKSPACE_STATUS_REF));
  assert.equal(existsSync(absolute(fixture.workspaceRoot, PROJECTOR_LOCK_REF)), false);
});

test("workspace Markdown collapses multiline labels and percent-encodes configured portable paths", async () => {
  const api = await projectorApi();
  const fixture = workspaceFixture({
    configure(value) {
      value.program.displayName = "Line One\n# Unexpected heading";
      value.storage.ledgerRoot = "Ledger (prod)";
    },
  });
  const result = api.rebuildWakeflowActiveProjection(projectorInput(fixture));
  assertAxes(result, { sourceHealth: "complete", projectionStatus: "current" });
  const index = readFileSync(absolute(fixture.workspaceRoot, WORKSPACE_INDEX_REF), "utf8");
  assert.match(index, /\.\.\/Ledger%20%28prod%29\/workspace\/workspace-record-map\.md/u);
  assert.doesNotMatch(index, /\]\(\.\.\/Ledger \(prod\)/u);
  assert.doesNotMatch(index, /\n# Unexpected heading/u);
  assert.match(index, /<code>Line One # Unexpected heading<\/code>/u);
  assert.equal(index.split("\n").filter((line) => line.startsWith("# ")).length, 1);
});

test("an unknown current directory cannot be downgraded to storage residue or overwritten with idle", async () => {
  const api = await projectorApi();

  const fresh = workspaceFixture();
  mkdirSync(path.join(fresh.currentRoot, "unknown-authority-root"), { mode: 0o700 });
  const freshResult = api.rebuildWakeflowActiveProjection(projectorInput(fresh));
  assertAxes(freshResult, {
    sourceHealth: "degraded",
    orientation: "degraded",
    projectionStatus: "stale",
  });
  assert.equal(issueCodes(freshResult).includes("authority-unhealthy"), true);
  assert.equal(existsSync(absolute(fresh.workspaceRoot, WORKSPACE_INDEX_REF)), false);
  assert.equal(existsSync(absolute(fresh.workspaceRoot, WORKSPACE_STATUS_REF)), false);

  const existing = workspaceFixture();
  api.rebuildWakeflowActiveProjection(projectorInput(existing));
  const before = new Map([
    [WORKSPACE_INDEX_REF, fileIdentity(absolute(existing.workspaceRoot, WORKSPACE_INDEX_REF))],
    [WORKSPACE_STATUS_REF, fileIdentity(absolute(existing.workspaceRoot, WORKSPACE_STATUS_REF))],
  ]);
  mkdirSync(path.join(existing.currentRoot, "unknown-authority-root"), { mode: 0o700 });
  const preserved = api.rebuildWakeflowActiveProjection(projectorInput(existing));
  assertAxes(preserved, {
    sourceHealth: "degraded",
    orientation: "degraded",
    projectionStatus: "stale",
  });
  assert.deepEqual(fileIdentity(absolute(existing.workspaceRoot, WORKSPACE_INDEX_REF)), before.get(WORKSPACE_INDEX_REF));
  assert.deepEqual(fileIdentity(absolute(existing.workspaceRoot, WORKSPACE_STATUS_REF)), before.get(WORKSPACE_STATUS_REF));
});

test("a live demand create lock is recovery-required and can never publish a false idle projection", async () => {
  const api = await projectorApi();
  const fixture = workspaceFixture();
  api.rebuildWakeflowActiveProjection(projectorInput(fixture));
  const before = new Map([
    [WORKSPACE_INDEX_REF, fileIdentity(absolute(fixture.workspaceRoot, WORKSPACE_INDEX_REF))],
    [WORKSPACE_STATUS_REF, fileIdentity(absolute(fixture.workspaceRoot, WORKSPACE_STATUS_REF))],
  ]);
  const privateLockBytes = "customer-token-ALPHA pid=424242";
  writeExact(path.join(fixture.currentRoot, `${IDS.demandA}.create-lock`), privateLockBytes);

  const result = api.rebuildWakeflowActiveProjection(projectorInput(fixture));
  assertAxes(result, {
    demandSet: "empty",
    sourceHealth: "recovery-required",
    orientation: "degraded",
    projectionStatus: "stale",
  });
  assert.equal(result.writeStatus, "preserved");
  assert.equal(issueCodes(result).includes("recovery-required"), true);
  assertSanitized(result, fixture, [privateLockBytes, "customer-token-ALPHA", "424242"]);
  assert.deepEqual(fileIdentity(absolute(fixture.workspaceRoot, WORKSPACE_INDEX_REF)), before.get(WORKSPACE_INDEX_REF));
  assert.deepEqual(fileIdentity(absolute(fixture.workspaceRoot, WORKSPACE_STATUS_REF)), before.get(WORKSPACE_STATUS_REF));
  assert.equal(existsSync(absolute(fixture.workspaceRoot, PROJECTOR_LOCK_REF)), false);
});

test("exact T09 archive sidecar and tombstone residues are recovery-required and preserve old projections", async (t) => {
  const api = await projectorApi();
  const cases = [
    {
      label: "archive intent sidecar",
      basename: `.${IDS.demandA}.wakeflow-archive-intent.json`,
      materialize(target, secret) {
        writeExact(target, secret);
      },
    },
    {
      label: "archive detach tombstone",
      basename: `.${IDS.demandA}.wakeflow-archive-stage`,
      materialize(target, secret) {
        mkdirSync(target, { mode: 0o700 });
        if (process.platform !== "win32") chmodSync(target, 0o700);
        writeExact(path.join(target, "private-journal-fragment"), secret);
      },
    },
  ];
  for (const current of cases) {
    await t.test(current.label, () => {
      const fixture = workspaceFixture();
      api.rebuildWakeflowActiveProjection(projectorInput(fixture));
      const before = new Map([
        [WORKSPACE_INDEX_REF, fileIdentity(absolute(fixture.workspaceRoot, WORKSPACE_INDEX_REF))],
        [WORKSPACE_STATUS_REF, fileIdentity(absolute(fixture.workspaceRoot, WORKSPACE_STATUS_REF))],
      ]);
      const secret = `customer-token-T09-${current.label}-pid-929292`;
      current.materialize(path.join(fixture.currentRoot, current.basename), secret);

      const result = api.rebuildWakeflowActiveProjection(projectorInput(fixture));
      assertAxes(result, {
        demandSet: "empty",
        sourceHealth: "recovery-required",
        storageHealth: "healthy",
        orientation: "degraded",
        projectionStatus: "stale",
      });
      assert.equal(result.writeStatus, "preserved");
      assert.deepEqual(result.demands, []);
      assert.equal(issueCodes(result).includes("recovery-required"), true);
      assertSanitized(result, fixture, [current.basename, secret, "929292"]);
      assert.deepEqual(
        fileIdentity(absolute(fixture.workspaceRoot, WORKSPACE_INDEX_REF)),
        before.get(WORKSPACE_INDEX_REF),
      );
      assert.deepEqual(
        fileIdentity(absolute(fixture.workspaceRoot, WORKSPACE_STATUS_REF)),
        before.get(WORKSPACE_STATUS_REF),
      );
      assert.equal(existsSync(absolute(fixture.workspaceRoot, PROJECTOR_LOCK_REF)), false);
    });
  }
});

test("archive residue recognition is exact and never adopts similar opaque names", async (t) => {
  const api = await projectorApi();
  await t.test("sidecar near-match remains storage-only", () => {
    const fixture = workspaceFixture();
    const basename = `.${IDS.demandA}.wakeflow-archive-intent.json.backup-private-pid-919191`;
    writeExact(path.join(fixture.currentRoot, basename), "opaque near-match\n");
    const result = api.rebuildWakeflowActiveProjection(projectorInput(fixture));
    assertAxes(result, {
      demandSet: "empty",
      sourceHealth: "complete",
      storageHealth: "degraded",
      orientation: "idle",
      projectionStatus: "current",
    });
    assert.deepEqual(issueCodes(result), ["storage-degraded"]);
    assertSanitized(result, fixture, [basename, "backup-private", "919191"]);
  });

  await t.test("tombstone near-match remains unknown authority", () => {
    const fixture = workspaceFixture();
    const basename = `.${IDS.demandA}.wakeflow-archive-stage-old-private-pid-939393`;
    mkdirSync(path.join(fixture.currentRoot, basename), { mode: 0o700 });
    const result = api.rebuildWakeflowActiveProjection(projectorInput(fixture));
    assertAxes(result, {
      demandSet: "empty",
      sourceHealth: "degraded",
      storageHealth: "healthy",
      orientation: "degraded",
      projectionStatus: "stale",
    });
    assert.deepEqual(issueCodes(result), ["authority-unhealthy"]);
    assertSanitized(result, fixture, [basename, "old-private", "939393"]);
  });
});

test("a real T03 revision-1 root keeps its generated demand documents byte-for-byte and inode-stable", async () => {
  const api = await projectorApi();
  const fixture = workspaceFixture();
  const published = publishDemand(fixture, {
    demandId: IDS.demandA,
    todoId: "TODO-M2-T08-T03",
    title: "Published by the T03 transaction",
    eventId: "event-initial-t08-t03-0001",
  });
  const demandIndex = path.join(published.stateRoot, "index.md");
  const progress = path.join(published.stateRoot, "developer-progress.md");
  const before = new Map([
    ["index.md", fileIdentity(demandIndex)],
    ["developer-progress.md", fileIdentity(progress)],
  ]);

  const result = api.rebuildWakeflowActiveProjection(projectorInput(fixture));
  assertAxes(result, {
    demandSet: "nonempty",
    sourceHealth: "complete",
    orientation: "active",
    projectionStatus: "current",
  });
  assert.deepEqual(fileIdentity(demandIndex), before.get("index.md"));
  assert.deepEqual(fileIdentity(progress), before.get("developer-progress.md"));
  assert.match(readFileSync(absolute(fixture.workspaceRoot, WORKSPACE_INDEX_REF), "utf8"), new RegExp(IDS.demandA, "u"));
  assert.match(readFileSync(absolute(fixture.workspaceRoot, WORKSPACE_STATUS_REF), "utf8"), /Published by the T03 transaction/u);
});

test("maintenance participant rejects omission of a complete live demand projection pair", async () => {
  const api = await projectorApi();
  const fixture = workspaceFixture();
  publishDemand(fixture, {
    demandId: IDS.demandA,
    todoId: "TODO-M2-T08-PLAN-COVERAGE",
    title: "Dynamic projection coverage",
    eventId: "event-plan-coverage-0001",
  });
  const input = {
    workspaceRoot: fixture.workspaceRoot,
    action: "reconcile",
    sourceModel: fixture.model,
    desiredModel: fixture.model,
    bundle,
    language: fixture.language,
  };
  const complete = api.planWakeflowActiveProjectionMaintenance(input);
  assert.equal(complete.payload.operations.filter((entry) => entry.kind === "demand").length, 2);

  const truncated = structuredClone(complete);
  const retainedIds = new Set(truncated.payload.operations
    .filter((entry) => entry.kind === "active")
    .map((entry) => entry.operationId));
  truncated.payload.operations = truncated.payload.operations.filter((entry) => entry.kind === "active");
  truncated.payload.steps = truncated.payload.steps.filter((entry) => retainedIds.has(entry.stepId));
  assert.deepEqual(api.validateWakeflowActiveProjectionMaintenancePlan(truncated), truncated);
  assert.throws(
    () => api.createWakeflowActiveProjectionMutationParticipant({
      ...input,
      confirmedPlan: truncated,
    }),
    /omits current source files|projection plan/iu,
  );
});

test("unreferenced artifact and evidence children degrade storage only and never disclose raw names", async () => {
  const api = await projectorApi();
  const fixture = workspaceFixture();
  const published = publishDemand(fixture, {
    demandId: IDS.demandA,
    todoId: "TODO-M2-T08-OPAQUE",
    title: "Opaque storage residue",
    eventId: "event-initial-t08-opaque-0001",
  });
  api.rebuildWakeflowActiveProjection(projectorInput(fixture));
  const before = new Map(
    projectionRefs([IDS.demandA]).map((ref) => [ref, fileIdentity(absolute(fixture.workspaceRoot, ref))]),
  );
  const artifactSecret = "customer-secret-ALPHA-raw-pid-424242.txt";
  const evidenceSecret = "customer-secret-BETA-session-pid-434343";
  const rootSecret = "customer-secret-DELTA-projector-stage-pid-454545";
  writeExact(path.join(published.stateRoot, "task-packages", artifactSecret), "opaque residue\n");
  mkdirSync(path.join(published.stateRoot, "evidence", evidenceSecret), { mode: 0o700 });
  writeExact(path.join(published.stateRoot, rootSecret), "top-level residue\n");

  const result = api.rebuildWakeflowActiveProjection(projectorInput(fixture));
  assertAxes(result, {
    demandSet: "nonempty",
    sourceHealth: "complete",
    storageHealth: "degraded",
    orientation: "active",
    projectionStatus: "current",
  });
  assert.equal(result.writeStatus, "current");
  assert.equal(issueCodes(result).every((entry) => entry === "storage-degraded"), true);
  assertSanitized(result, fixture, [
    artifactSecret,
    evidenceSecret,
    rootSecret,
    "424242",
    "434343",
    "454545",
  ]);
  for (const [ref, identity] of before) {
    assert.deepEqual(fileIdentity(absolute(fixture.workspaceRoot, ref)), identity, ref);
  }
});

test("artifact stage residue is recovery-required and its stage token is opaque", async () => {
  const api = await projectorApi();
  const fixture = workspaceFixture();
  const published = publishDemand(fixture, {
    demandId: IDS.demandA,
    todoId: "TODO-M2-T08-STAGE",
    title: "Opaque recovery residue",
    eventId: "event-initial-t08-stage-0001",
  });
  const stageName = ".task-package_customer-secret-GAMMA.wakeflow-stage-raw-pid-444444";
  writeExact(path.join(published.stateRoot, "task-packages", stageName), "incomplete\n");

  const result = api.rebuildWakeflowActiveProjection(projectorInput(fixture));
  assertAxes(result, {
    sourceHealth: "recovery-required",
    storageHealth: "healthy",
    orientation: "degraded",
    projectionStatus: "stale",
  });
  assert.equal(result.writeStatus, "preserved");
  assert.equal(issueCodes(result).includes("recovery-required"), true);
  assertSanitized(result, fixture, [stageName, "customer-secret-GAMMA", "444444"]);
  assert.equal(existsSync(absolute(fixture.workspaceRoot, WORKSPACE_INDEX_REF)), false);
});

test("an empty capability-root gap degrades storage while a referenced descendant gap degrades authority", async () => {
  const api = await projectorApi();

  const emptyFixture = workspaceFixture();
  const emptyPublished = publishDemand(emptyFixture, {
    demandId: IDS.demandA,
    todoId: "TODO-M2-T08-EMPTY-CAPABILITY",
    title: "Empty capability storage gap",
    eventId: "event-initial-t08-empty-capability-0001",
  });
  api.rebuildWakeflowActiveProjection(projectorInput(emptyFixture));
  rmSync(path.join(emptyPublished.stateRoot, "task-packages"), { recursive: true });

  const emptyGap = api.rebuildWakeflowActiveProjection(projectorInput(emptyFixture));
  assertAxes(emptyGap, {
    demandSet: "nonempty",
    sourceHealth: "complete",
    storageHealth: "degraded",
    orientation: "active",
    projectionStatus: "current",
  });
  assert.equal(emptyGap.writeStatus, "current");
  assert.equal(issueCodes(emptyGap).every((entry) => entry === "storage-degraded"), true);
  assert.equal(
    emptyGap.issues.some((entry) => entry.ref === (
      `.wakeflow-active/current/${IDS.demandA}/task-packages/`
    )),
    true,
  );

  const referencedFixture = workspaceFixture();
  const referencedPublished = publishDemand(referencedFixture, {
    demandId: IDS.demandA,
    todoId: "TODO-M2-T08-REFERENCED-CAPABILITY",
    title: "Referenced capability authority gap",
    eventId: "event-initial-t08-referenced-capability-0001",
    frozen: true,
  });
  createBlockedTargetResult(referencedFixture, referencedPublished);
  api.rebuildWakeflowActiveProjection(projectorInput(referencedFixture));
  rmSync(path.join(referencedPublished.stateRoot, "target-results"), { recursive: true });

  const referencedGap = api.rebuildWakeflowActiveProjection(projectorInput(referencedFixture));
  assertAxes(referencedGap, {
    demandSet: "nonempty",
    sourceHealth: "degraded",
    orientation: "degraded",
    projectionStatus: "stale",
  });
  assert.equal(referencedGap.writeStatus, "preserved");
  assert.equal(issueCodes(referencedGap).includes("authority-unhealthy"), true);
  assert.equal(
    referencedGap.issues.some((entry) => entry.ref.startsWith(
      `.wakeflow-active/current/${IDS.demandA}/target-results/`,
    )),
    true,
  );
});

test("isolated Pod capability drift is storage-only, bounded, and opaque", async () => {
  const api = await projectorApi();
  const fixture = workspaceFixture();
  const published = publishIsolatedDemand(fixture, {
    demandId: IDS.demandA,
    title: "Isolated Pod capability inventory",
    eventId: "event-initial-t08-isolated-capability-0001",
  });
  const baseline = api.rebuildWakeflowActiveProjection(projectorInput(fixture));
  assertAxes(baseline, {
    demandSet: "nonempty",
    sourceHealth: "complete",
    storageHealth: "healthy",
    orientation: "active",
    projectionStatus: "current",
  });

  const podRoot = path.join(published.stateRoot, "pod");
  const requestsRoot = path.join(podRoot, "design-requests");
  rmSync(requestsRoot, { recursive: true });
  const missingLeaf = api.rebuildWakeflowActiveProjection(projectorInput(fixture));
  assertAxes(missingLeaf, {
    sourceHealth: "complete",
    storageHealth: "degraded",
    orientation: "active",
    projectionStatus: "current",
  });
  assert.equal(missingLeaf.writeStatus, "current");
  assert.equal(issueCodes(missingLeaf).every((entry) => entry === "storage-degraded"), true);

  mkdirSync(requestsRoot, { mode: 0o700 });
  if (process.platform !== "win32") chmodSync(requestsRoot, 0o700);
  if (process.platform !== "win32") {
    const handoffsRoot = path.join(podRoot, "design-handoffs");
    const externalRoot = path.join(fixture.workspaceRoot, "isolated-pod-symlink-target");
    mkdirSync(externalRoot, { mode: 0o700 });
    rmSync(handoffsRoot, { recursive: true });
    symlinkSync(externalRoot, handoffsRoot, "dir");
    const unsafeLeaf = api.inspectWakeflowActiveProjection(projectorInput(fixture));
    assertAxes(unsafeLeaf, {
      sourceHealth: "complete",
      storageHealth: "degraded",
      orientation: "active",
      projectionStatus: "current",
    });
    assertSanitized(unsafeLeaf, fixture, [externalRoot]);
    unlinkSync(handoffsRoot);
    mkdirSync(handoffsRoot, { mode: 0o700 });
    chmodSync(handoffsRoot, 0o700);
  }

  const secretChild = "customer-secret-POD-private-pid-464646";
  mkdirSync(path.join(podRoot, secretChild), { mode: 0o700 });
  const unknownChild = api.inspectWakeflowActiveProjection(projectorInput(fixture));
  assertAxes(unknownChild, {
    sourceHealth: "complete",
    storageHealth: "degraded",
    orientation: "active",
    projectionStatus: "current",
  });
  assert.equal(issueCodes(unknownChild).every((entry) => entry === "storage-degraded"), true);
  assertSanitized(unknownChild, fixture, [secretChild, "customer-secret-POD", "464646"]);
});

test("multiple demand roots sort by typed demandId and any blocked authority drives blocked orientation", async () => {
  const api = await projectorApi();
  const fixture = workspaceFixture();
  const later = publishDemand(fixture, {
    demandId: IDS.demandB,
    todoId: "TODO-M2-T08-B",
    title: "Alphabetically first but identifier second",
    eventId: "event-initial-t08-b-0001",
  });
  publishDemand(fixture, {
    demandId: IDS.demandA,
    todoId: "TODO-M2-T08-A",
    title: "Zulu title but identifier first",
    eventId: "event-initial-t08-a-0001",
  });
  blockDemand(later);

  const result = api.rebuildWakeflowActiveProjection(projectorInput(fixture));
  assertAxes(result, {
    demandSet: "nonempty",
    sourceHealth: "complete",
    orientation: "blocked",
    projectionStatus: "current",
  });
  for (const ref of [WORKSPACE_INDEX_REF, WORKSPACE_STATUS_REF]) {
    const content = readFileSync(absolute(fixture.workspaceRoot, ref), "utf8");
    assert.ok(content.indexOf(IDS.demandA) < content.indexOf(IDS.demandB), ref);
  }
  assert.match(readFileSync(absolute(fixture.workspaceRoot, WORKSPACE_STATUS_REF), "utf8"), /\bblocked\b/iu);
});

test("a real blocked TargetResult drives blocked orientation without changing the top-level demand state", async () => {
  const api = await projectorApi();
  const fixture = workspaceFixture();
  const published = publishDemand(fixture, {
    demandId: IDS.demandA,
    todoId: "TODO-M2-T08-REAL-BLOCKED",
    title: "Real blocked TargetResult",
    eventId: "event-initial-t08-real-blocked-0001",
    frozen: true,
  });
  const created = createBlockedTargetResult(fixture, published);
  assert.notEqual(created.stack.state.state, "blocked");
  assert.equal(created.stack.state.targetTasks[0].lifecycleStatus, "blocked");

  const result = api.rebuildWakeflowActiveProjection(projectorInput(fixture));
  assertAxes(result, {
    demandSet: "nonempty",
    sourceHealth: "complete",
    storageHealth: "healthy",
    orientation: "blocked",
    projectionStatus: "current",
  });
  const status = readFileSync(absolute(fixture.workspaceRoot, WORKSPACE_STATUS_REF), "utf8");
  assert.match(status, /\bblocked\b/iu);
  assert.match(status, new RegExp(IDS.targetResult, "u"));
});

test("an archived authority root left in current is diagnosed and never projected as idle", async () => {
  const api = await projectorApi();
  const fixture = workspaceFixture();
  const published = publishDemand(fixture, {
    demandId: IDS.demandA,
    todoId: "TODO-M2-T08-ARCHIVED",
    title: "Archived current residue",
    eventId: "event-initial-t08-archived-0001",
  });
  archiveDemandInCurrent(published);

  const result = api.rebuildWakeflowActiveProjection(projectorInput(fixture));
  assertAxes(result, {
    demandSet: "nonempty",
    sourceHealth: "degraded",
    orientation: "degraded",
    projectionStatus: "stale",
  });
  assert.equal(result.writeStatus, "preserved");
  assert.equal(issueCodes(result).includes("archived-current-residue"), true);
  assert.equal(result.demands[0].status, "archived-current-residue");
  assert.equal(existsSync(absolute(fixture.workspaceRoot, WORKSPACE_INDEX_REF)), false);
});

test("config drift that invalidates an immutable task assignment degrades source and preserves projections", async () => {
  const api = await projectorApi();
  const fixture = workspaceFixture();
  const published = publishDemand(fixture, {
    demandId: IDS.demandA,
    todoId: "TODO-M2-T08-ASSIGNMENT",
    title: "Assignment closure",
    eventId: "event-initial-t08-assignment-0001",
    frozen: true,
  });
  createBlockedTargetResult(fixture, published);
  api.rebuildWakeflowActiveProjection(projectorInput(fixture));
  const before = new Map(
    projectionRefs([IDS.demandA]).map((ref) => [ref, fileIdentity(absolute(fixture.workspaceRoot, ref))]),
  );
  const changed = JSON.parse(readFileSync(fixture.configPath, "utf8"));
  changed.topology.windows.find((entry) => entry.role === "product").windowId = (
    "window_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  );
  writeExact(
    fixture.configPath,
    serializeWakeflowConfigV3(parseWakeflowConfigV3(changed)),
  );

  const result = api.rebuildWakeflowActiveProjection(projectorInput(fixture));
  assertAxes(result, {
    sourceHealth: "degraded",
    orientation: "degraded",
    projectionStatus: "stale",
  });
  assert.equal(result.writeStatus, "preserved");
  assert.equal(issueCodes(result).includes("authority-unhealthy"), true);
  for (const [ref, identity] of before) {
    assert.deepEqual(fileIdentity(absolute(fixture.workspaceRoot, ref)), identity, ref);
  }
});

test("a pending state transaction reports recovery-required and preserves every old projection byte", async () => {
  const api = await projectorApi();
  const fixture = workspaceFixture();
  const published = publishDemand(fixture, {
    demandId: IDS.demandA,
    todoId: "TODO-M2-T08-PENDING",
    title: "Pending source preservation",
    eventId: "event-initial-t08-pending-0001",
  });
  api.rebuildWakeflowActiveProjection(projectorInput(fixture));
  const before = snapshotFiles(fixture.workspaceRoot);
  writeExact(path.join(published.stateRoot, "transactions/state-transition.json"), "{}\n");
  const beforeProjection = new Map(
    projectionRefs([IDS.demandA]).map((ref) => [ref, readFileSync(absolute(fixture.workspaceRoot, ref))]),
  );

  const result = api.rebuildWakeflowActiveProjection(projectorInput(fixture));
  assertAxes(result, {
    demandSet: "nonempty",
    sourceHealth: "recovery-required",
    projectionStatus: "stale",
  });
  assert.equal(issueCodes(result).includes("recovery-required"), true);
  for (const [ref, content] of beforeProjection) {
    assert.deepEqual(readFileSync(absolute(fixture.workspaceRoot, ref)), content, ref);
  }
  const after = snapshotFiles(fixture.workspaceRoot);
  assert.deepEqual(changedFileRefs(before, after), [
    `.wakeflow-active/current/${IDS.demandA}/transactions/state-transition.json`,
  ]);
  assert.equal(existsSync(absolute(fixture.workspaceRoot, PROJECTOR_LOCK_REF)), false);
});

test("an exact transactions/archive.json journal reports recovery-required without reading private journal bytes", async () => {
  const api = await projectorApi();
  const fixture = workspaceFixture();
  const published = publishDemand(fixture, {
    demandId: IDS.demandA,
    todoId: "TODO-M2-T08-ARCHIVE-JOURNAL",
    title: "Pending business archive journal",
    eventId: "event-initial-t08-archive-journal-0001",
  });
  api.rebuildWakeflowActiveProjection(projectorInput(fixture));
  const beforeProjection = new Map(
    projectionRefs([IDS.demandA]).map((ref) => [ref, readFileSync(absolute(fixture.workspaceRoot, ref))]),
  );
  const secret = "private-business-archive-journal-token-pid-949494";
  writeExact(path.join(published.stateRoot, "transactions/archive.json"), secret);

  const result = api.rebuildWakeflowActiveProjection(projectorInput(fixture));
  assertAxes(result, {
    demandSet: "nonempty",
    sourceHealth: "recovery-required",
    projectionStatus: "stale",
  });
  assert.equal(result.writeStatus, "preserved");
  assert.equal(issueCodes(result).includes("recovery-required"), true);
  assertSanitized(result, fixture, [secret, "949494", "archive.json"]);
  for (const [ref, content] of beforeProjection) {
    assert.deepEqual(readFileSync(absolute(fixture.workspaceRoot, ref)), content, ref);
  }
  assert.equal(existsSync(absolute(fixture.workspaceRoot, PROJECTOR_LOCK_REF)), false);
});

test("a corrupt typed root reports a sanitized degraded issue and preserves old workspace and demand projections", async () => {
  const api = await projectorApi();
  const fixture = workspaceFixture();
  const published = publishDemand(fixture, {
    demandId: IDS.demandA,
    todoId: "TODO-M2-T08-CORRUPT",
    title: "Corrupt source preservation",
    eventId: "event-initial-t08-corrupt-0001",
  });
  api.rebuildWakeflowActiveProjection(projectorInput(fixture));
  const oldProjection = new Map(
    projectionRefs([IDS.demandA]).map((ref) => [ref, readFileSync(absolute(fixture.workspaceRoot, ref))]),
  );
  const secret = "PRIVATE-STATE-BYTES-MUST-NOT-ESCAPE";
  writeExact(path.join(published.stateRoot, "wakeflow-state.json"), `${secret}\n`);

  const inspected = api.inspectWakeflowActiveProjection(projectorInput(fixture));
  assertAxes(inspected, {
    demandSet: "nonempty",
    sourceHealth: "degraded",
    orientation: "degraded",
    projectionStatus: "stale",
  });
  assert.equal(issueCodes(inspected).includes("authority-unhealthy"), true);
  assertSanitized(inspected, fixture, [secret]);
  const rebuilt = api.rebuildWakeflowActiveProjection(projectorInput(fixture));
  assertAxes(rebuilt, { sourceHealth: "degraded", projectionStatus: "stale" });
  assertSanitized(rebuilt, fixture, [secret]);
  for (const [ref, content] of oldProjection) {
    assert.deepEqual(readFileSync(absolute(fixture.workspaceRoot, ref)), content, ref);
  }
});

test("a symlink projection target is unsafe and full preflight performs zero writes", async () => {
  const api = await projectorApi();
  const fixture = workspaceFixture();
  const externalRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-active-projector-external-"));
  const external = path.join(externalRoot, "outside.md");
  writeExact(external, "outside sentinel\n");
  const indexFile = absolute(fixture.workspaceRoot, WORKSPACE_INDEX_REF);
  symlinkSync(external, indexFile);
  const before = snapshotFiles(fixture.workspaceRoot);
  const externalBefore = readFileSync(external);

  const inspected = api.inspectWakeflowActiveProjection(projectorInput(fixture));
  assertAxes(inspected, { sourceHealth: "complete", projectionStatus: "unsafe" });
  assertSanitized(inspected, fixture, [external]);
  runUnsafeRebuild(api, fixture);
  assert.deepEqual(snapshotFiles(fixture.workspaceRoot), before);
  assert.deepEqual(readFileSync(external), externalBefore);
  assert.equal(existsSync(absolute(fixture.workspaceRoot, WORKSPACE_STATUS_REF)), false);
  assert.equal(existsSync(absolute(fixture.workspaceRoot, PROJECTOR_LOCK_REF)), false);
});

test("a multiply-linked projection target is unsafe and cannot partially create its sibling projection", async (t) => {
  if (process.platform === "win32") {
    t.skip("hard-link identity behavior is covered on POSIX hosts");
    return;
  }
  const api = await projectorApi();
  const fixture = workspaceFixture();
  const externalRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-active-projector-hardlink-"));
  const external = path.join(externalRoot, "outside.md");
  writeExact(external, "hard-link sentinel\n");
  const statusFile = absolute(fixture.workspaceRoot, WORKSPACE_STATUS_REF);
  linkSync(external, statusFile);
  assert.equal(statSync(external).nlink, 2);
  const before = snapshotFiles(fixture.workspaceRoot);
  const externalBefore = readFileSync(external);

  const inspected = api.inspectWakeflowActiveProjection(projectorInput(fixture));
  assertAxes(inspected, { sourceHealth: "complete", projectionStatus: "unsafe" });
  runUnsafeRebuild(api, fixture);
  assert.deepEqual(snapshotFiles(fixture.workspaceRoot), before);
  assert.deepEqual(readFileSync(external), externalBefore);
  assert.equal(statSync(external).nlink, 2);
  assert.equal(existsSync(absolute(fixture.workspaceRoot, WORKSPACE_INDEX_REF)), false);
  assert.equal(existsSync(absolute(fixture.workspaceRoot, PROJECTOR_LOCK_REF)), false);
});

test("managed stale and mixed-missing projections rebuild narrowly while unmanaged bytes fail closed", async () => {
  const api = await projectorApi();

  const unmanaged = workspaceFixture();
  const unmanagedIndex = absolute(unmanaged.workspaceRoot, WORKSPACE_INDEX_REF);
  writeExact(unmanagedIndex, "# User-owned document without a Wakeflow marker\n");
  const beforeUnmanaged = fileIdentity(unmanagedIndex);
  const unsafe = api.rebuildWakeflowActiveProjection(projectorInput(unmanaged));
  assertAxes(unsafe, { sourceHealth: "complete", projectionStatus: "unsafe" });
  assert.equal(unsafe.writeStatus, "preserved");
  assert.deepEqual(fileIdentity(unmanagedIndex), beforeUnmanaged);
  assert.equal(existsSync(absolute(unmanaged.workspaceRoot, WORKSPACE_STATUS_REF)), false);

  const managed = workspaceFixture();
  api.rebuildWakeflowActiveProjection(projectorInput(managed));
  const managedIndex = absolute(managed.workspaceRoot, WORKSPACE_INDEX_REF);
  const managedStatus = absolute(managed.workspaceRoot, WORKSPACE_STATUS_REF);
  const statusBefore = fileIdentity(managedStatus);
  writeExact(managedIndex, `${readFileSync(managedIndex, "utf8")}managed drift\n`);
  const stale = api.rebuildWakeflowActiveProjection(projectorInput(managed));
  assertAxes(stale, { projectionStatus: "current" });
  assert.equal(stale.writeStatus, "rebuilt");
  assert.deepEqual(stale.written, [WORKSPACE_INDEX_REF]);
  assert.deepEqual(fileIdentity(managedStatus), statusBefore);

  const indexBeforeMissing = fileIdentity(managedIndex);
  unlinkSync(managedStatus);
  const mixed = api.rebuildWakeflowActiveProjection(projectorInput(managed));
  assertAxes(mixed, { projectionStatus: "current" });
  assert.equal(mixed.writeStatus, "rebuilt");
  assert.deepEqual(mixed.written, [WORKSPACE_STATUS_REF]);
  assert.deepEqual(fileIdentity(managedIndex), indexBeforeMissing);
});

test("an unreadable current root reports unknown demand coverage and degraded storage", async () => {
  const api = await projectorApi();
  const fixture = workspaceFixture();
  rmSync(fixture.currentRoot, { recursive: true, force: true });
  writeExact(fixture.currentRoot, "not a directory\n");

  const result = api.inspectWakeflowActiveProjection(projectorInput(fixture));
  assertAxes(result, {
    demandSet: "unknown",
    sourceHealth: "unreadable",
    storageHealth: "degraded",
    orientation: "degraded",
    projectionStatus: "stale",
  });
  assert.equal(issueCodes(result).includes("source-unreadable"), true);
  assertSanitized(result, fixture);
});

test("an unreadable canonical config preserves the old pair and returns no root, raw bytes, or private path", async () => {
  const api = await projectorApi();
  const fixture = workspaceFixture();
  api.rebuildWakeflowActiveProjection(projectorInput(fixture));
  const oldIndex = readFileSync(absolute(fixture.workspaceRoot, WORKSPACE_INDEX_REF));
  const oldStatus = readFileSync(absolute(fixture.workspaceRoot, WORKSPACE_STATUS_REF));
  const secret = "PRIVATE-CONFIG-BYTES-MUST-NOT-ESCAPE";
  writeExact(fixture.configPath, `{\"secret\":\"${secret}\"\n`);

  for (const operation of [
    api.inspectWakeflowActiveProjection,
    api.rebuildWakeflowActiveProjection,
  ]) {
    const result = operation(projectorInput(fixture));
    assertAxes(result, {
      demandSet: "unknown",
      sourceHealth: "unreadable",
      storageHealth: "degraded",
      orientation: "degraded",
      projectionStatus: "stale",
    });
    assert.equal(issueCodes(result).includes("source-unreadable"), true);
    assertSanitized(result, fixture, [secret]);
  }
  assert.deepEqual(readFileSync(absolute(fixture.workspaceRoot, WORKSPACE_INDEX_REF)), oldIndex);
  assert.deepEqual(readFileSync(absolute(fixture.workspaceRoot, WORKSPACE_STATUS_REF)), oldStatus);
  assert.equal(existsSync(absolute(fixture.workspaceRoot, PROJECTOR_LOCK_REF)), false);
});

test("two projector processes converge through the shared ephemeral lock", async () => {
  const api = await projectorApi();
  const fixture = workspaceFixture();
  publishDemand(fixture, {
    demandId: IDS.demandA,
    todoId: "TODO-M2-T08-CONCURRENT",
    title: "Concurrent projector convergence",
    eventId: "event-initial-t08-concurrent-0001",
  });

  const results = await Promise.all([
    runProjectorChild(fixture),
    runProjectorChild(fixture),
  ]);
  assert.deepEqual(results.map((entry) => entry.writeStatus).sort(), ["current", "rebuilt"]);
  for (const result of results) {
    assertAxes(result, {
      sourceHealth: "complete",
      storageHealth: "healthy",
      orientation: "active",
      projectionStatus: "current",
    });
    assertSanitized(result, fixture);
  }
  const inspected = api.inspectWakeflowActiveProjection(projectorInput(fixture));
  assertAxes(inspected, { projectionStatus: "current" });
  assert.equal(existsSync(absolute(fixture.workspaceRoot, PROJECTOR_LOCK_REF)), false);
});

test("rebuild changes exactly the four admitted projection classes and never TODO, local runtime, ledger, or authority", async () => {
  const api = await projectorApi();
  const fixture = workspaceFixture();
  const published = publishDemand(fixture, {
    demandId: IDS.demandA,
    todoId: "TODO-M2-T08-WRITES",
    title: "Bounded projection writes",
    eventId: "event-initial-t08-writes-0001",
  });
  blockDemand(published, "event-blocked-writes-0002");
  writeExact(absolute(fixture.workspaceRoot, ".wakeflow-local/runtime-sentinel.json"), "{\"runtime\":true}\n");
  writeExact(absolute(fixture.workspaceRoot, "Ledger/workspace/workspace-record-map.md"), "# Ledger sentinel\n");
  const before = snapshotFiles(fixture.workspaceRoot);

  const result = api.rebuildWakeflowActiveProjection(projectorInput(fixture));
  assertAxes(result, {
    sourceHealth: "complete",
    orientation: "blocked",
    projectionStatus: "current",
  });
  const after = snapshotFiles(fixture.workspaceRoot);
  assert.deepEqual(changedFileRefs(before, after), projectionRefs([IDS.demandA]));
  assert.equal(readFileSync(absolute(fixture.workspaceRoot, ".wakeflow-local/runtime-sentinel.json"), "utf8"), "{\"runtime\":true}\n");
  assert.equal(readFileSync(absolute(fixture.workspaceRoot, "Ledger/workspace/workspace-record-map.md"), "utf8"), "# Ledger sentinel\n");
  assert.equal(existsSync(absolute(fixture.workspaceRoot, PROJECTOR_LOCK_REF)), false);
  const residue = [...snapshotFiles(fixture.workspaceRoot).keys()].filter((ref) => (
    ref.includes("wakeflow-stage") || ref.endsWith(".tmp") || ref.endsWith(".lock")
  ));
  assert.deepEqual(residue, []);
});
