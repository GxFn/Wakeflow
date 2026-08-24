import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  statSync,
  symlinkSync,
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
  loadDemandCoreRecords,
} from "../core/scripts/lib/wakeflow-demand-core-records.mjs";
import { createLedgerRecord } from "../core/scripts/lib/wakeflow-ledger-records.mjs";
import {
  parseWakeflowAssetBundle,
} from "../core/scripts/lib/wakeflow-template-renderer.mjs";
import * as todoService from "../core/scripts/lib/wakeflow-todo-service.mjs";
import {
  buildWakeflowAssetBundle,
} from "../tools/build-asset-bundle.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(repositoryRoot, "core/template-sources");
const publicationRelative = "core/scripts/lib/wakeflow-demand-publication-service.mjs";
const publicationUrl = new URL(`../${publicationRelative}`, import.meta.url);
const schemaRelative = "core/schemas/wakeflow-demand-publication/create-transaction.schema.json";

const IDS = Object.freeze({
  program: "program_11111111-1111-4111-8111-111111111111",
  demand: "demand_22222222-2222-4222-8222-222222222222",
  demandOther: "demand_88888888-8888-4888-8888-888888888888",
  requirement: "requirement_33333333-3333-4333-8333-333333333333",
  confirmation: "confirmation_44444444-4444-4444-8444-444444444444",
  archive: "archive_77777777-7777-4777-8777-777777777777",
  designWindow: "window_55555555-5555-4555-8555-555555555555",
  controllerWindow: "window_66666666-6666-4666-8666-666666666666",
});
const CREATED_AT = "2026-08-07T01:02:03.000Z";
const REQUIREMENT_ROLES = Object.freeze([
  "code-facts",
  "landing-plan",
  "non-goals",
  "original-plan",
  "requirement-design",
  "user-confirmation",
]);
const COMMON_DIRECTORIES = Object.freeze([
  "evidence",
  "review-candidates",
  "target-results",
  "task-packages",
  "test-cards",
  "transactions",
]);

function contentDigest(value) {
  return `sha256:${createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex")}`;
}

function parsedBundle() {
  return parseWakeflowAssetBundle(buildWakeflowAssetBundle({ sourceRoot }));
}

async function publicationApi() {
  return import(publicationUrl.href);
}

function todoRow(todoId = "TODO-M2-T03") {
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
    Documents: `[original-plan](requirement-designs/${IDS.requirement}/01-original-plan.md)`,
  };
}

function workspaceFixture({ todoIds = ["TODO-M2-T03"] } = {}) {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-demand-v3-layout-"));
  const currentRoot = path.join(workspaceRoot, ".wakeflow-active", "current");
  const boardPath = path.join(currentRoot, "global-todo-board.md");
  const ledgerRoot = path.join(workspaceRoot, "Ledger");
  mkdirSync(currentRoot, { recursive: true });
  chmodSync(path.join(workspaceRoot, ".wakeflow-active"), 0o700);
  chmodSync(currentRoot, 0o700);
  for (const ref of ["", "requirement-designs", "goal-stage-confirmation", "workspace", "workspace/archive"]) {
    const directory = ref ? path.join(ledgerRoot, ...ref.split("/")) : ledgerRoot;
    mkdirSync(directory, { recursive: true, mode: 0o755 });
    if (process.platform !== "win32") chmodSync(directory, 0o755);
  }
  todoService.createTodoBoardIfAbsent({ root: workspaceRoot, boardPath, freshWorkspace: true });
  for (const todoId of todoIds) {
    todoService.appendTodoRow({ root: workspaceRoot, boardPath, row: todoRow(todoId) });
  }
  const board = todoService.scanTodoBoard(readFileSync(boardPath, "utf8"));
  return { workspaceRoot, currentRoot, boardPath, board, ledgerRoot };
}

function demandRecord({
  demandId = IDS.demand,
  source,
  executionPlacement = { mode: "main" },
  title = "Candidate initial publication",
} = {}) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand",
    programId: IDS.program,
    demandId,
    createdAt: CREATED_AT,
    title,
    goal: "Publish one complete strict demand root without exposing partial authority.",
    completionDefinition: "The root, TODO lineage, event tail, and generated documents agree.",
    demandType: "requirement",
    source,
    executionPlacement,
  };
}

function transitionInput(suffix = "0001") {
  return {
    eventId: `event-initial-${suffix}`,
    createdAt: CREATED_AT,
    reason: "candidate demand publication initialized",
    decisionSummary: "Publish the immutable identity and its exact initial state.",
  };
}

function todoInput(fixture, {
  demandId = IDS.demand,
  todoId = "TODO-M2-T03",
  title,
} = {}) {
  const row = fixture.board.rows.find((entry) => entry.id === todoId);
  assert.ok(row, todoId);
  return {
    workspaceRoot: fixture.workspaceRoot,
    ledgerRoot: fixture.ledgerRoot,
    expectedProgramId: IDS.program,
    bundle: parsedBundle(),
    language: "en",
    demand: demandRecord({ demandId, source: row.lineageRef, title }),
    authority: null,
    initialTransition: transitionInput(demandId === IDS.demand ? "0001" : "0002"),
    expectedTodoRow: row.snapshot,
  };
}

function directChildren(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
    .sort();
}

function assertMode(file, expected) {
  assert.equal(statSync(file).mode & 0o777, expected, file);
}

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function writePendingTree(plan, destination, { sidecar = false } = {}) {
  if (sidecar) {
    const sidecarPath = path.join(plan.workspaceRoot, ...plan.journal.plan.paths.sidecarRef.split("/"));
    writeFileSync(sidecarPath, plan.journalContent, { mode: 0o600 });
    return;
  }
  mkdirSync(destination, { mode: 0o700 });
  for (const directory of plan.journal.plan.directories) {
    mkdirSync(path.join(destination, ...directory.split("/")), { recursive: true, mode: 0o700 });
  }
  for (const [ref, file] of Object.entries(plan.journal.plan.files)) {
    writeFileSync(path.join(destination, ...ref.split("/")), file.content, { mode: 0o600 });
  }
  writeFileSync(path.join(destination, "transactions", "create.json"), plan.journalContent, {
    mode: 0o600,
  });
}

function todoBoardRow(fixture, todoId = "TODO-M2-T03") {
  const board = todoService.scanTodoBoard(readFileSync(fixture.boardPath, "utf8"));
  const row = board.rows.find((entry) => entry.id === todoId);
  assert.ok(row, todoId);
  return row;
}

function assertCreateResidueAbsent(fixture, demandId) {
  assert.equal(existsSync(path.join(fixture.currentRoot, demandId)), false, demandId);
  assert.equal(
    existsSync(path.join(fixture.currentRoot, `${demandId}.create-intent.json`)),
    false,
    `${demandId} sidecar`,
  );
  assert.equal(
    existsSync(path.join(fixture.currentRoot, `.wakeflow-create-stage-${demandId}`)),
    false,
    `${demandId} stage`,
  );
  assert.equal(
    existsSync(path.join(fixture.currentRoot, `${demandId}.create-lock`)),
    false,
    `${demandId} create lock`,
  );
}

const publicationChildSource = [
  `import { readFileSync } from "node:fs";`,
  `import { publishInitialDemandPublication } from ${JSON.stringify(publicationUrl.href)};`,
  `import { parseWakeflowAssetBundle } from ${JSON.stringify(new URL("../core/scripts/lib/wakeflow-template-renderer.mjs", import.meta.url).href)};`,
  `import { buildWakeflowAssetBundle } from ${JSON.stringify(new URL("../tools/build-asset-bundle.mjs", import.meta.url).href)};`,
  `const input = JSON.parse(readFileSync(process.argv[1], "utf8"));`,
  `input.bundle = parseWakeflowAssetBundle(buildWakeflowAssetBundle({ sourceRoot: ${JSON.stringify(sourceRoot)} }));`,
  `const result = publishInitialDemandPublication(input);`,
  `process.stdout.write(JSON.stringify(result));`,
].join("\n");

async function runPublicationProcess(argsFile) {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", publicationChildSource, argsFile],
    { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code] = await once(child, "exit");
  return { code, stdout, stderr };
}

async function makeAuthorityLedger(demandId = IDS.demand) {
  const {
    createLedgerMemberReference,
    createLedgerRecord,
    loadLedgerRecord,
  } = await import("../core/scripts/lib/wakeflow-ledger-records.mjs");
  const ledgerRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-demand-v3-ledger-"));
  mkdirSync(path.join(ledgerRoot, "requirement-designs"), { recursive: true });
  mkdirSync(path.join(ledgerRoot, "goal-stage-confirmation"), { recursive: true });
  mkdirSync(path.join(ledgerRoot, "workspace", "archive"), { recursive: true });

  const documents = REQUIREMENT_ROLES.map((role, index) => {
    const memberPath = `${String(index + 1).padStart(2, "0")}-${role}.md`;
    const content = `# ${role}\n`;
    return { role, path: memberPath, mediaType: "text/markdown", digest: contentDigest(content), content };
  });
  const requirementRecord = {
    schemaVersion: 1,
    artifactKind: "wakeflow-requirement-record",
    requirementId: IDS.requirement,
    programId: IDS.program,
    title: "Initial demand publication authority",
    status: "confirmed",
    relatedDemandIds: [demandId],
    documents: documents.map(({ content: _content, ...document }) => document),
  };
  const createdRequirement = createLedgerRecord({
    ledgerRoot,
    expectedProgramId: IDS.program,
    record: requirementRecord,
    memberContents: Object.fromEntries(documents.map((document) => [document.path, document.content])),
  });
  const loadedRequirement = loadLedgerRecord({
    ledgerRoot,
    root: createdRequirement.root,
    expectedFamily: "requirement",
    expectedProgramId: IDS.program,
  });

  const confirmationDocuments = [
    ["goal-stage-decision", "01-goal-stage-decision.md"],
    ["user-confirmation", "02-user-confirmation.md"],
  ].map(([role, memberPath]) => ({
    role,
    path: memberPath,
    mediaType: "text/markdown",
    content: `# ${role}\n`,
  }));
  const confirmationRecord = {
    schemaVersion: 1,
    artifactKind: "wakeflow-confirmation-record",
    confirmationId: IDS.confirmation,
    programId: IDS.program,
    demandId,
    title: "Explicit isolated placement",
    status: "confirmed",
    documents: confirmationDocuments.map(({ content, ...document }) => ({
      ...document,
      digest: contentDigest(content),
    })),
  };
  const createdConfirmation = createLedgerRecord({
    ledgerRoot,
    expectedProgramId: IDS.program,
    record: confirmationRecord,
    memberContents: Object.fromEntries(
      confirmationDocuments.map((document) => [document.path, document.content]),
    ),
  });
  const loadedConfirmation = loadLedgerRecord({
    ledgerRoot,
    root: createdConfirmation.root,
    expectedFamily: "confirmation",
    expectedProgramId: IDS.program,
  });
  return {
    ledgerRoot,
    requirementMemberPath: path.join(createdRequirement.root, documents[0].path),
    requirementRefs: documents.map((document) => (
      createLedgerMemberReference(loadedRequirement, document.path)
    )),
    placementRef: createLedgerMemberReference(
      loadedConfirmation,
      confirmationDocuments[0].path,
    ),
  };
}

test("current publication surface and strict transaction schema replace retired public-v2 entrypoints", async () => {
  assert.equal(existsSync(path.join(repositoryRoot, publicationRelative)), true);
  assert.equal(existsSync(path.join(repositoryRoot, schemaRelative)), true);
  const schema = JSON.parse(readFileSync(path.join(repositoryRoot, schemaRelative), "utf8"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.$defs.plan.properties.files.required.sort(), [
    "controller-events.jsonl",
    "demand.json",
    "developer-progress.md",
    "index.md",
    "wakeflow-state.json",
  ]);
  assert.equal(schema.$defs.plan.properties.files.additionalProperties, false);
  assert.equal(schema.$defs.paths.properties.journalRef.const, "transactions/create.json");
  assert.equal(schema.$defs.mainDirectories.maxItems, 6);
  assert.equal(schema.$defs.isolatedDirectories.maxItems, 9);

  const module = await publicationApi();
  assert.deepEqual(Object.keys(module).sort(), [
    "WAKEFLOW_DEMAND_PUBLICATION_SCHEMA_VERSION",
    "WakeflowDemandPublicationError",
    "planInitialDemandPublication",
    "publishInitialDemandPublication",
    "recoverInitialDemandPublication",
  ]);
  const editionRoots = [
    "core",
    "plugins/codex-wakeflow",
    "plugins/claude-code-wakeflow",
  ];
  const retiredEntrySuffixes = [
    "scripts/wakeflow-runtime.mjs",
    "scripts/wakeflow-state.mjs",
    "scripts/wakeflow-demand-sequence.mjs",
    "scripts/wakeflow-render-progress.mjs",
  ];
  for (const relative of editionRoots.flatMap((root) => (
    retiredEntrySuffixes.map((suffix) => `${root}/${suffix}`)
  ))) {
    assert.equal(existsSync(path.join(repositoryRoot, relative)), false, relative);
  }
});

test("read-only planning builds one strict revision-1 stack and portable immutable journal", async () => {
  const { planInitialDemandPublication } = await publicationApi();
  const fixture = workspaceFixture();
  const input = todoInput(fixture);
  const before = directChildren(fixture.currentRoot);
  const plan = planInitialDemandPublication(input);

  assert.deepEqual(Object.keys(plan), [
    "kind",
    "schemaVersion",
    "workspaceRoot",
    "programId",
    "demandId",
    "stateRootRef",
    "planDigest",
    "journal",
    "journalContent",
  ]);
  assert.equal(plan.kind, "WakeflowInitialDemandPublicationPlan");
  assert.equal(plan.programId, IDS.program);
  assert.equal(plan.demandId, IDS.demand);
  assert.equal(plan.stateRootRef, `.wakeflow-active/current/${IDS.demand}`);
  assert.equal(plan.planDigest, plan.journal.planDigest);
  assert.equal(plan.journalContent, `${canonicalJson(plan.journal)}\n`);
  assert.equal(plan.journal.artifactKind, "wakeflow-demand-create-intent");
  assert.equal(plan.journal.plan.language, "en");
  assert.deepEqual(plan.journal.plan.directories, COMMON_DIRECTORIES);
  assert.deepEqual(Object.keys(plan.journal.plan.files).sort(), [
    "controller-events.jsonl",
    "demand.json",
    "developer-progress.md",
    "index.md",
    "wakeflow-state.json",
  ]);
  const event = JSON.parse(plan.journal.plan.files["controller-events.jsonl"].content.trimEnd());
  const state = JSON.parse(plan.journal.plan.files["wakeflow-state.json"].content);
  assert.deepEqual(
    [event.actor, event.command, event.type, event.previousRevision, event.nextRevision, event.from, event.to],
    ["controller", "init", "state.initialized", 0, 1, null, "intake"],
  );
  assert.equal(state.revision, 1);
  assert.deepEqual(state.evidence, []);
  assert.equal(state.lastEvent.eventId, event.eventId);
  assert.equal(state.lastEvent.eventDigest, canonicalJsonDigest(event));
  assert.equal(plan.journal.plan.todoClaim.expectedRow.todoId, "TODO-M2-T03");
  assert.equal(plan.journal.plan.todoClaim.claimedRow.todoId, "TODO-M2-T03");
  assert.equal(plan.journal.plan.todoClaim.mount.identityDigest, canonicalJsonDigest(input.demand));
  assert.equal(plan.journal.plan.documentSource.fingerprint.startsWith("sha256:"), true);
  assert.equal(plan.journalContent.includes(fixture.workspaceRoot), false);
  assert.equal(plan.journalContent.includes(repositoryRoot), false);
  assert.deepEqual(directChildren(fixture.currentRoot), before);
  assertDeepFrozen(plan);
});

test("TODO-backed planning delegates nested snapshot admission without executing accessors", async () => {
  const {
    planInitialDemandPublication,
    WakeflowDemandPublicationError,
  } = await publicationApi();
  const fixture = workspaceFixture();
  const input = todoInput(fixture);
  const snapshot = input.expectedTodoRow;
  let rowReads = 0;
  input.expectedTodoRow = {
    artifactKind: snapshot.artifactKind,
    get row() {
      rowReads += 1;
      return snapshot.row;
    },
    rowDigest: snapshot.rowDigest,
    schemaVersion: snapshot.schemaVersion,
    todoId: snapshot.todoId,
  };

  assert.throws(
    () => planInitialDemandPublication(input),
    (error) => error instanceof WakeflowDemandPublicationError
      && error.code === "wakeflow-demand-publication-invalid"
      && error.details.causeCode === "todo-row-snapshot-invalid",
  );
  assert.equal(rowReads, 0);
  assert.deepEqual(directChildren(fixture.currentRoot), ["global-todo-board.md"]);
});

test("TODO-backed planning consumes the TODO owner's physical authority admission", async () => {
  const {
    planInitialDemandPublication,
    WakeflowDemandPublicationError,
  } = await publicationApi();
  const fixture = workspaceFixture();
  const input = todoInput(fixture);
  chmodSync(fixture.boardPath, 0o600);

  assert.throws(
    () => planInitialDemandPublication(input),
    (error) => error instanceof WakeflowDemandPublicationError
      && error.code === "wakeflow-demand-publication-invalid"
      && error.details.causeCode === "todo-board-source-unsafe",
  );
  assert.deepEqual(directChildren(fixture.currentRoot), ["global-todo-board.md"]);
  assert.equal(statSync(fixture.boardPath).mode & 0o777, 0o600);
});

test("main publication exposes one exact complete tree and claims TODO before the root becomes healthy", async () => {
  const {
    planInitialDemandPublication,
    publishInitialDemandPublication,
  } = await publicationApi();
  const fixture = workspaceFixture();
  const input = todoInput(fixture);
  const plan = planInitialDemandPublication(input);
  const result = publishInitialDemandPublication(input);
  const stateRoot = path.join(fixture.workspaceRoot, ...plan.stateRootRef.split("/"));

  assert.equal(result.status, "published");
  assert.equal(result.planDigest, plan.planDigest);
  assert.equal(existsSync(stateRoot), true);
  assert.deepEqual(directChildren(stateRoot), [
    "controller-events.jsonl",
    "demand.json",
    "developer-progress.md",
    "evidence/",
    "index.md",
    "review-candidates/",
    "target-results/",
    "task-packages/",
    "test-cards/",
    "transactions/",
    "wakeflow-state.json",
  ]);
  assertMode(stateRoot, 0o700);
  for (const directory of COMMON_DIRECTORIES) {
    const target = path.join(stateRoot, directory);
    assertMode(target, 0o700);
    assert.deepEqual(readdirSync(target), []);
  }
  for (const [ref, file] of Object.entries(plan.journal.plan.files)) {
    const target = path.join(stateRoot, ...ref.split("/"));
    assert.equal(readFileSync(target, "utf8"), file.content, ref);
    assert.equal(contentDigest(file.content), file.byteDigest, ref);
    assertMode(target, 0o600);
  }
  for (const forbidden of ["projection.json", "intake", "focus", "transition-candidates", "README.md", "pod"]) {
    assert.equal(existsSync(path.join(stateRoot, forbidden)), false, forbidden);
  }
  const loaded = loadDemandCoreRecords({ stateRoot, expectedProgramId: IDS.program });
  assert.equal(loaded.demand.demandId, IDS.demand);
  const board = todoService.scanTodoBoard(readFileSync(fixture.boardPath, "utf8"));
  const row = board.rows.find((entry) => entry.id === "TODO-M2-T03");
  assert.equal(row.value.Status, "claimed");
  assert.equal(row.value["Current Mount"], plan.stateRootRef);
  assert.equal(existsSync(path.join(fixture.currentRoot, `${IDS.demand}.create-intent.json`)), false);
  assert.equal(existsSync(path.join(fixture.currentRoot, `.wakeflow-create-stage-${IDS.demand}`)), false);
  assert.equal(existsSync(path.join(fixture.currentRoot, `${IDS.demand}.create-lock`)), false);
});

test("isolated publication requires real ledger authority and adds only the two portable Pod roots", async () => {
  const {
    planInitialDemandPublication,
    publishInitialDemandPublication,
  } = await publicationApi();
  const fixture = workspaceFixture({ todoIds: [] });
  const ledger = await makeAuthorityLedger();
  const source = {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand-ledger-source",
    memberRefs: ledger.requirementRefs,
  };
  const demand = demandRecord({
    source,
    executionPlacement: { mode: "isolated", authorizationRef: ledger.placementRef },
  });
  const authority = {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand-authority",
    demandId: demand.demandId,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(demand),
    entryMode: "pod-design",
    authorityRefs: ledger.requirementRefs,
    testDecision: {
      mode: "controller-only",
      summary: "Run the bounded candidate publication suite.",
    },
  };
  const input = {
    workspaceRoot: fixture.workspaceRoot,
    ledgerRoot: ledger.ledgerRoot,
    expectedProgramId: IDS.program,
    bundle: parsedBundle(),
    language: "zh",
    demand,
    authority,
    initialTransition: transitionInput(),
    expectedTodoRow: null,
  };
  const plan = planInitialDemandPublication(input);
  assert.deepEqual(plan.journal.plan.directories, [
    ...COMMON_DIRECTORIES,
    "pod",
    "pod/design-handoffs",
    "pod/design-requests",
  ]);
  assert.ok(plan.journal.plan.files["demand-authority.json"]);
  assert.equal(plan.journal.plan.todoClaim, null);
  publishInitialDemandPublication(input);
  const stateRoot = path.join(fixture.workspaceRoot, ...plan.stateRootRef.split("/"));
  assert.deepEqual(directChildren(path.join(stateRoot, "pod")), [
    "design-handoffs/",
    "design-requests/",
  ]);
  assert.deepEqual(readdirSync(path.join(stateRoot, "pod", "design-handoffs")), []);
  assert.deepEqual(readdirSync(path.join(stateRoot, "pod", "design-requests")), []);
  assert.equal(readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8").includes("## 当前状态"), true);
  loadDemandCoreRecords({
    stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: ledger.ledgerRoot,
  });
});

test("recovery can start from the exact sibling intent or an already-published pending root", async () => {
  const {
    planInitialDemandPublication,
    recoverInitialDemandPublication,
  } = await publicationApi();
  for (const checkpoint of ["sidecar", "published-root"]) {
    const fixture = workspaceFixture();
    const input = todoInput(fixture);
    const plan = planInitialDemandPublication(input);
    const stateRoot = path.join(fixture.workspaceRoot, ...plan.stateRootRef.split("/"));
    if (checkpoint === "sidecar") writePendingTree(plan, stateRoot, { sidecar: true });
    else writePendingTree(plan, stateRoot);

    assert.throws(
      () => loadDemandCoreRecords({ stateRoot, expectedProgramId: IDS.program }),
      checkpoint === "sidecar" ? /stateRoot|state root/u : /pending|transaction/u,
    );
    const recovered = recoverInitialDemandPublication({
      workspaceRoot: fixture.workspaceRoot,
      ledgerRoot: fixture.ledgerRoot,
      expectedProgramId: IDS.program,
      demandId: IDS.demand,
    });
    assert.equal(recovered.status, "recovered");
    assert.deepEqual(readdirSync(path.join(stateRoot, "transactions")), []);
    loadDemandCoreRecords({ stateRoot, expectedProgramId: IDS.program });
    const row = todoService.scanTodoBoard(readFileSync(fixture.boardPath, "utf8")).rows[0];
    assert.equal(row.value.Status, "claimed");
    assert.equal(row.value["Current Mount"], plan.stateRootRef);
  }
});

test("recovery recognizes an exact committed TODO and keeps the root journal as the final read gate", async () => {
  const {
    planInitialDemandPublication,
    recoverInitialDemandPublication,
  } = await publicationApi();
  const fixture = workspaceFixture();
  const input = todoInput(fixture);
  const plan = planInitialDemandPublication(input);
  const stateRoot = path.join(fixture.workspaceRoot, ...plan.stateRootRef.split("/"));
  writePendingTree(plan, stateRoot);
  todoService.recoverTodoRowClaim({
    root: fixture.workspaceRoot,
    boardPath: fixture.boardPath,
    todoId: plan.journal.plan.todoClaim.todoId,
    expectedRow: plan.journal.plan.todoClaim.expectedRow,
    mount: plan.journal.plan.todoClaim.mount,
  });
  assert.throws(
    () => loadDemandCoreRecords({ stateRoot, expectedProgramId: IDS.program }),
    /pending|transaction/u,
  );
  const recovered = recoverInitialDemandPublication({
    workspaceRoot: fixture.workspaceRoot,
    ledgerRoot: fixture.ledgerRoot,
    expectedProgramId: IDS.program,
    demandId: IDS.demand,
  });
  assert.equal(recovered.status, "recovered");
  assert.deepEqual(readdirSync(path.join(stateRoot, "transactions")), []);
  loadDemandCoreRecords({ stateRoot, expectedProgramId: IDS.program });
});

test("explicit demand recovery closes one safe TODO atomic-stage crash prefix", async () => {
  const {
    planInitialDemandPublication,
    recoverInitialDemandPublication,
  } = await publicationApi();
  const fixture = workspaceFixture();
  const plan = planInitialDemandPublication(todoInput(fixture));
  const stateRoot = path.join(fixture.workspaceRoot, ...plan.stateRootRef.split("/"));
  writePendingTree(plan, stateRoot);
  const stage = path.join(
    path.dirname(fixture.boardPath),
    `.${path.basename(fixture.boardPath)}.wakeflow-stage-999999-00000000-0000-4000-8000-000000000001`,
  );
  writeFileSync(stage, "partial TODO claim stage\n", { mode: 0o644 });
  chmodSync(stage, 0o644);

  const recovered = recoverInitialDemandPublication({
    workspaceRoot: fixture.workspaceRoot,
    ledgerRoot: fixture.ledgerRoot,
    expectedProgramId: IDS.program,
    demandId: IDS.demand,
  });
  assert.equal(recovered.status, "recovered");
  assert.equal(existsSync(stage), false);
  assert.deepEqual(readdirSync(path.join(stateRoot, "transactions")), []);
  const row = todoBoardRow(fixture);
  assert.equal(row.value.Status, "claimed");
  assert.equal(row.value["Current Mount"], plan.stateRootRef);
  loadDemandCoreRecords({ stateRoot, expectedProgramId: IDS.program });
});

test("a sidecar cannot excuse a claimed TODO when the root-first publish point is absent", async () => {
  const {
    planInitialDemandPublication,
    recoverInitialDemandPublication,
    WakeflowDemandPublicationError,
  } = await publicationApi();
  const fixture = workspaceFixture();
  const plan = planInitialDemandPublication(todoInput(fixture));
  writePendingTree(plan, "unused", { sidecar: true });
  todoService.recoverTodoRowClaim({
    root: fixture.workspaceRoot,
    boardPath: fixture.boardPath,
    todoId: plan.journal.plan.todoClaim.todoId,
    expectedRow: plan.journal.plan.todoClaim.expectedRow,
    mount: plan.journal.plan.todoClaim.mount,
  });
  assert.throws(
    () => recoverInitialDemandPublication({
      workspaceRoot: fixture.workspaceRoot,
      ledgerRoot: fixture.ledgerRoot,
      expectedProgramId: IDS.program,
      demandId: IDS.demand,
    }),
    (error) => error instanceof WakeflowDemandPublicationError
      && error.code === "wakeflow-demand-publication-order",
  );
  assert.equal(existsSync(path.join(fixture.currentRoot, IDS.demand)), false);
  assert.equal(existsSync(path.join(fixture.currentRoot, `${IDS.demand}.create-intent.json`)), true);
});

test("conflicting valid journals and a different plan for one pending demand preserve first evidence", async () => {
  const {
    planInitialDemandPublication,
    publishInitialDemandPublication,
    recoverInitialDemandPublication,
    WakeflowDemandPublicationError,
  } = await publicationApi();

  const recoveryFixture = workspaceFixture();
  const recoveryFirst = planInitialDemandPublication(todoInput(recoveryFixture, {
    title: "First exact pending create plan",
  }));
  const recoverySecond = planInitialDemandPublication(todoInput(recoveryFixture, {
    title: "Second exact pending create plan",
  }));
  assert.notEqual(recoveryFirst.planDigest, recoverySecond.planDigest);
  const recoveryRoot = path.join(
    recoveryFixture.workspaceRoot,
    ...recoveryFirst.stateRootRef.split("/"),
  );
  const recoverySidecar = path.join(
    recoveryFixture.workspaceRoot,
    ...recoveryFirst.journal.plan.paths.sidecarRef.split("/"),
  );
  const recoveryRootJournal = path.join(recoveryRoot, "transactions", "create.json");
  writePendingTree(recoveryFirst, "unused", { sidecar: true });
  writePendingTree(recoverySecond, recoveryRoot);

  assert.throws(
    () => recoverInitialDemandPublication({
      workspaceRoot: recoveryFixture.workspaceRoot,
      ledgerRoot: recoveryFixture.ledgerRoot,
      expectedProgramId: IDS.program,
      demandId: IDS.demand,
    }),
    (error) => error instanceof WakeflowDemandPublicationError
      && error.code === "wakeflow-demand-publication-conflict",
  );
  assert.equal(readFileSync(recoverySidecar, "utf8"), recoveryFirst.journalContent);
  assert.equal(readFileSync(recoveryRootJournal, "utf8"), recoverySecond.journalContent);
  assert.equal(todoBoardRow(recoveryFixture).value.Status, "pending-claim");
  assert.equal(todoBoardRow(recoveryFixture).value["Current Mount"], "none");

  const publishFixture = workspaceFixture();
  const originalInput = todoInput(publishFixture, { title: "Reserved pending create plan" });
  const candidateInput = todoInput(publishFixture, { title: "Conflicting candidate create plan" });
  const originalPlan = planInitialDemandPublication(originalInput);
  const candidatePlan = planInitialDemandPublication(candidateInput);
  assert.notEqual(originalPlan.planDigest, candidatePlan.planDigest);
  const originalSidecar = path.join(
    publishFixture.workspaceRoot,
    ...originalPlan.journal.plan.paths.sidecarRef.split("/"),
  );
  writePendingTree(originalPlan, "unused", { sidecar: true });

  assert.throws(
    () => publishInitialDemandPublication(candidateInput),
    (error) => error instanceof WakeflowDemandPublicationError
      && error.code === "wakeflow-demand-publication-conflict",
  );
  assert.equal(readFileSync(originalSidecar, "utf8"), originalPlan.journalContent);
  assert.equal(existsSync(path.join(publishFixture.currentRoot, IDS.demand)), false);
  assert.equal(
    existsSync(path.join(publishFixture.currentRoot, `.wakeflow-create-stage-${IDS.demand}`)),
    false,
  );
  assert.equal(existsSync(path.join(publishFixture.currentRoot, `${IDS.demand}.create-lock`)), false);
  assert.equal(
    existsSync(path.join(publishFixture.workspaceRoot, ".wakeflow-active", "current.identity-lock")),
    false,
  );
  assert.equal(todoBoardRow(publishFixture).value.Status, "pending-claim");
  assert.equal(todoBoardRow(publishFixture).value["Current Mount"], "none");
});

test("canonical create intent with a false planDigest fails closed and remains recoverable evidence", async () => {
  const {
    planInitialDemandPublication,
    recoverInitialDemandPublication,
    WakeflowDemandPublicationError,
  } = await publicationApi();
  const fixture = workspaceFixture();
  const plan = planInitialDemandPublication(todoInput(fixture));
  const wrongDigest = plan.planDigest === `sha256:${"a".repeat(64)}`
    ? `sha256:${"b".repeat(64)}`
    : `sha256:${"a".repeat(64)}`;
  const invalidEnvelope = {
    ...plan.journal,
    planDigest: wrongDigest,
  };
  const invalidContent = `${canonicalJson(invalidEnvelope)}\n`;
  assert.equal(invalidContent, `${canonicalJson(JSON.parse(invalidContent))}\n`);
  const sidecar = path.join(
    fixture.workspaceRoot,
    ...plan.journal.plan.paths.sidecarRef.split("/"),
  );
  writeFileSync(sidecar, invalidContent, { mode: 0o600 });

  assert.throws(
    () => recoverInitialDemandPublication({
      workspaceRoot: fixture.workspaceRoot,
      ledgerRoot: fixture.ledgerRoot,
      expectedProgramId: IDS.program,
      demandId: IDS.demand,
    }),
    (error) => error instanceof WakeflowDemandPublicationError
      && error.code === "wakeflow-demand-publication-journal-digest",
  );
  assert.equal(readFileSync(sidecar, "utf8"), invalidContent);
  assert.equal(existsSync(path.join(fixture.currentRoot, IDS.demand)), false);
  assert.equal(todoBoardRow(fixture).value.Status, "pending-claim");
  assert.equal(todoBoardRow(fixture).value["Current Mount"], "none");
});

test("isolated sidecar recovery revalidates ledger members before publishing any local authority", async () => {
  const {
    planInitialDemandPublication,
    recoverInitialDemandPublication,
    WakeflowDemandPublicationError,
  } = await publicationApi();
  const fixture = workspaceFixture({ todoIds: [] });
  const ledger = await makeAuthorityLedger();
  const source = {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand-ledger-source",
    memberRefs: ledger.requirementRefs,
  };
  const demand = demandRecord({
    source,
    executionPlacement: { mode: "isolated", authorizationRef: ledger.placementRef },
  });
  const authority = {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand-authority",
    demandId: demand.demandId,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(demand),
    entryMode: "pod-design",
    authorityRefs: ledger.requirementRefs,
    testDecision: {
      mode: "controller-only",
      summary: "Run the bounded candidate publication suite.",
    },
  };
  const input = {
    workspaceRoot: fixture.workspaceRoot,
    ledgerRoot: ledger.ledgerRoot,
    expectedProgramId: IDS.program,
    bundle: parsedBundle(),
    language: "en",
    demand,
    authority,
    initialTransition: transitionInput(),
    expectedTodoRow: null,
  };
  const plan = planInitialDemandPublication(input);
  writePendingTree(plan, "unused", { sidecar: true });
  const sidecar = path.join(
    fixture.workspaceRoot,
    ...plan.journal.plan.paths.sidecarRef.split("/"),
  );
  const boardBefore = readFileSync(fixture.boardPath);
  writeFileSync(ledger.requirementMemberPath, "# tampered after planning\n");

  assert.throws(
    () => recoverInitialDemandPublication({
      workspaceRoot: fixture.workspaceRoot,
      ledgerRoot: ledger.ledgerRoot,
      expectedProgramId: IDS.program,
      demandId: IDS.demand,
    }),
    WakeflowDemandPublicationError,
  );
  assert.equal(readFileSync(sidecar, "utf8"), plan.journalContent);
  assert.equal(existsSync(path.join(fixture.currentRoot, IDS.demand)), false);
  assert.equal(
    existsSync(path.join(fixture.currentRoot, `.wakeflow-create-stage-${IDS.demand}`)),
    false,
  );
  assert.deepEqual(readFileSync(fixture.boardPath), boardBefore);
});

test("recovery forward-completes an exact partial private stage without inventing files", async () => {
  const {
    planInitialDemandPublication,
    recoverInitialDemandPublication,
  } = await publicationApi();
  const fixture = workspaceFixture();
  const plan = planInitialDemandPublication(todoInput(fixture));
  writePendingTree(plan, "unused", { sidecar: true });
  const stageRoot = path.join(fixture.workspaceRoot, ...plan.journal.plan.paths.stageRootRef.split("/"));
  mkdirSync(stageRoot, { mode: 0o700 });
  mkdirSync(path.join(stageRoot, "transactions"), { mode: 0o700 });
  writeFileSync(
    path.join(stageRoot, "demand.json"),
    plan.journal.plan.files["demand.json"].content,
    { mode: 0o600 },
  );

  const recovered = recoverInitialDemandPublication({
    workspaceRoot: fixture.workspaceRoot,
    ledgerRoot: fixture.ledgerRoot,
    expectedProgramId: IDS.program,
    demandId: IDS.demand,
  });
  assert.equal(recovered.status, "recovered");
  const stateRoot = path.join(fixture.workspaceRoot, ...plan.stateRootRef.split("/"));
  assert.equal(existsSync(stageRoot), false);
  assert.deepEqual(readdirSync(path.join(stateRoot, "transactions")), []);
  loadDemandCoreRecords({ stateRoot, expectedProgramId: IDS.program });
});

test("preflight and recovery fail closed on row drift, machine paths, symlinks, and unknown pending entries", async () => {
  const {
    planInitialDemandPublication,
    publishInitialDemandPublication,
    recoverInitialDemandPublication,
    WakeflowDemandPublicationError,
  } = await publicationApi();

  const privateFixture = workspaceFixture();
  assert.throws(
    () => planInitialDemandPublication(todoInput(privateFixture, {
      title: `Do not persist ${privateFixture.workspaceRoot}/private`,
    })),
    (error) => error instanceof WakeflowDemandPublicationError
      && error.code === "wakeflow-demand-publication-private-path",
  );
  assert.deepEqual(
    directChildren(privateFixture.currentRoot),
    ["global-todo-board.md"],
  );
  for (const title of [
    "Reject path=/Users/another-user/private",
    "Reject ref:file:///home/another-user/private",
    "Reject path=C:\\Users\\another-user\\private",
  ]) {
    const shapedFixture = workspaceFixture();
    assert.throws(
      () => planInitialDemandPublication(todoInput(shapedFixture, { title })),
      (error) => error instanceof WakeflowDemandPublicationError
        && error.code === "wakeflow-demand-publication-private-path",
    );
    assert.deepEqual(directChildren(shapedFixture.currentRoot), ["global-todo-board.md"]);
  }

  const driftFixture = workspaceFixture();
  const driftInput = todoInput(driftFixture);
  todoService.appendTodoRow({
    root: driftFixture.workspaceRoot,
    boardPath: driftFixture.boardPath,
    row: todoRow("TODO-unrelated"),
  });
  todoService.claimTodoRow({
    root: driftFixture.workspaceRoot,
    boardPath: driftFixture.boardPath,
    todoId: "TODO-M2-T03",
    expectedRow: driftInput.expectedTodoRow,
    mount: {
      demandId: IDS.demandOther,
      stateRootRef: `.wakeflow-active/current/${IDS.demandOther}`,
      identityDigest: `sha256:${"f".repeat(64)}`,
    },
  });
  assert.throws(
    () => publishInitialDemandPublication(driftInput),
    WakeflowDemandPublicationError,
  );
  assert.equal(existsSync(path.join(driftFixture.currentRoot, IDS.demand)), false);
  assert.equal(existsSync(path.join(driftFixture.currentRoot, `${IDS.demand}.create-intent.json`)), false);

  const residueFixture = workspaceFixture();
  const plan = planInitialDemandPublication(todoInput(residueFixture));
  const stateRoot = path.join(residueFixture.workspaceRoot, ...plan.stateRootRef.split("/"));
  writePendingTree(plan, stateRoot);
  writeFileSync(path.join(stateRoot, "unknown.json"), "{}\n");
  assert.throws(
    () => recoverInitialDemandPublication({
      workspaceRoot: residueFixture.workspaceRoot,
      ledgerRoot: residueFixture.ledgerRoot,
      expectedProgramId: IDS.program,
      demandId: IDS.demand,
    }),
    WakeflowDemandPublicationError,
  );
  assert.equal(existsSync(path.join(stateRoot, "unknown.json")), true);
  assert.equal(existsSync(path.join(stateRoot, "transactions", "create.json")), true);

  const linkedFixture = workspaceFixture();
  const outside = mkdtempSync(path.join(os.tmpdir(), "wakeflow-demand-v3-outside-"));
  const linkedRoot = path.join(linkedFixture.currentRoot, IDS.demand);
  symlinkSync(outside, linkedRoot, "dir");
  assert.throws(
    () => planInitialDemandPublication(todoInput(linkedFixture)),
    WakeflowDemandPublicationError,
  );
  assert.equal(lstatSync(linkedRoot).isSymbolicLink(), true);
});

test("invalid UTF-8 journal and tree bytes fail closed without consuming recovery evidence or TODO state", async () => {
  const {
    planInitialDemandPublication,
    recoverInitialDemandPublication,
    WakeflowDemandPublicationError,
  } = await publicationApi();

  const journalFixture = workspaceFixture();
  const journalPlan = planInitialDemandPublication(todoInput(journalFixture));
  writePendingTree(journalPlan, "unused", { sidecar: true });
  const sidecar = path.join(
    journalFixture.workspaceRoot,
    ...journalPlan.journal.plan.paths.sidecarRef.split("/"),
  );
  const invalidJournalBytes = Buffer.from(journalPlan.journalContent, "utf8");
  invalidJournalBytes[1] = 0x80;
  writeFileSync(sidecar, invalidJournalBytes, { mode: 0o600 });

  assert.throws(
    () => recoverInitialDemandPublication({
      workspaceRoot: journalFixture.workspaceRoot,
      ledgerRoot: journalFixture.ledgerRoot,
      expectedProgramId: IDS.program,
      demandId: IDS.demand,
    }),
    (error) => error instanceof WakeflowDemandPublicationError
      && error.code === "wakeflow-demand-publication-utf8",
  );
  assert.deepEqual(readFileSync(sidecar), invalidJournalBytes);
  assert.equal(todoBoardRow(journalFixture).value.Status, "pending-claim");
  assert.equal(todoBoardRow(journalFixture).value["Current Mount"], "none");
  assert.equal(existsSync(path.join(journalFixture.currentRoot, IDS.demand)), false);

  const treeFixture = workspaceFixture();
  const treePlan = planInitialDemandPublication(todoInput(treeFixture));
  const stateRoot = path.join(treeFixture.workspaceRoot, ...treePlan.stateRootRef.split("/"));
  writePendingTree(treePlan, stateRoot);
  const invalidTreeFile = path.join(stateRoot, "index.md");
  const invalidTreeBytes = Buffer.from([0x80]);
  writeFileSync(invalidTreeFile, invalidTreeBytes, { mode: 0o600 });
  const rootJournal = path.join(stateRoot, "transactions", "create.json");

  assert.throws(
    () => recoverInitialDemandPublication({
      workspaceRoot: treeFixture.workspaceRoot,
      ledgerRoot: treeFixture.ledgerRoot,
      expectedProgramId: IDS.program,
      demandId: IDS.demand,
    }),
    (error) => error instanceof WakeflowDemandPublicationError
      && error.code === "wakeflow-demand-publication-tree",
  );
  assert.deepEqual(readFileSync(invalidTreeFile), invalidTreeBytes);
  assert.equal(readFileSync(rootJournal, "utf8"), treePlan.journalContent);
  assert.equal(todoBoardRow(treeFixture).value.Status, "pending-claim");
  assert.equal(todoBoardRow(treeFixture).value["Current Mount"], "none");
});

test("same intent is idempotent while a different demand cannot reuse the same TODO mount", async () => {
  const {
    publishInitialDemandPublication,
    WakeflowDemandPublicationError,
  } = await publicationApi();
  const fixture = workspaceFixture();
  const firstInput = todoInput(fixture);
  const first = publishInitialDemandPublication(firstInput);
  const again = publishInitialDemandPublication(firstInput);
  assert.equal(first.status, "published");
  assert.equal(again.status, "already-published");
  assert.equal(again.planDigest, first.planDigest);

  const otherInput = todoInput(fixture, { demandId: IDS.demandOther });
  assert.throws(
    () => publishInitialDemandPublication(otherInput),
    WakeflowDemandPublicationError,
  );
  assert.equal(existsSync(path.join(fixture.currentRoot, IDS.demandOther)), false);
  assert.equal(existsSync(path.join(fixture.currentRoot, `${IDS.demandOther}.create-intent.json`)), false);
});

test("an immutable business archive permanently reserves its demand identity", async () => {
  const {
    publishInitialDemandPublication,
    recoverInitialDemandPublication,
    WakeflowDemandPublicationError,
  } = await publicationApi();
  const fixture = workspaceFixture();
  const payload = "archived demand identity\n";
  const inventoryDigest = canonicalJsonDigest({
    programId: IDS.program,
    demandId: IDS.demand,
    entries: { groups: [], packets: [], envelopes: [], runs: [] },
  });
  const transportSummary = canonicalJson({
    schemaVersion: 1,
    artifactKind: "wakeflow-business-archive-transport-summary",
    programId: IDS.program,
    demandId: IDS.demand,
    sourceStatus: "missing",
    inventoryDigest,
    groups: [],
    packets: [],
    envelopes: [],
    runs: [],
  });
  createLedgerRecord({
    ledgerRoot: fixture.ledgerRoot,
    expectedProgramId: IDS.program,
    record: {
      schemaVersion: 1,
      artifactKind: "wakeflow-archive-manifest",
      archiveId: IDS.archive,
      programId: IDS.program,
      archiveKind: "demand",
      yearMonth: "2026-08",
      title: "Archived demand identity",
      conclusion: "The immutable archive permanently closes this identity.",
      source: {
        kind: "demand",
        demandId: IDS.demand,
        demandRef: "payload/demand.txt",
        demandDigest: contentDigest(payload),
      },
      transport: {
        status: "archived",
        inventoryDigest,
        memberRefs: [{
          ref: "transport-summary.json",
          digest: contentDigest(transportSummary),
        }],
      },
      members: [
        {
          role: "payload",
          path: "payload/demand.txt",
          mediaType: "text/plain",
          digest: contentDigest(payload),
        },
        {
          role: "transport-summary",
          path: "transport-summary.json",
          mediaType: "application/json",
          digest: contentDigest(transportSummary),
        },
      ],
    },
    memberContents: {
      "payload/demand.txt": payload,
      "transport-summary.json": transportSummary,
    },
  });

  const input = todoInput(fixture);
  assert.throws(
    () => publishInitialDemandPublication(input),
    (error) => error instanceof WakeflowDemandPublicationError
      && error.code === "wakeflow-demand-publication-archived-identity",
  );
  assert.throws(
    () => recoverInitialDemandPublication({
      workspaceRoot: fixture.workspaceRoot,
      ledgerRoot: fixture.ledgerRoot,
      expectedProgramId: IDS.program,
      demandId: IDS.demand,
    }),
    (error) => error instanceof WakeflowDemandPublicationError
      && error.code === "wakeflow-demand-publication-archived-identity",
  );
  assertCreateResidueAbsent(fixture, IDS.demand);
  assert.equal(todoBoardRow(fixture).value.Status, "pending-claim");
  assert.equal(todoBoardRow(fixture).value["Current Mount"], "none");
});

test("a pending create journal reserves its exact TODO lineage across demand IDs", async () => {
  const {
    planInitialDemandPublication,
    publishInitialDemandPublication,
    WakeflowDemandPublicationError,
  } = await publicationApi();
  const fixture = workspaceFixture();
  const firstPlan = planInitialDemandPublication(todoInput(fixture));
  writePendingTree(firstPlan, "unused", { sidecar: true });
  const otherInput = todoInput(fixture, { demandId: IDS.demandOther });
  assert.throws(
    () => publishInitialDemandPublication(otherInput),
    (error) => error instanceof WakeflowDemandPublicationError
      && error.code === "wakeflow-demand-publication-todo-conflict",
  );
  assert.equal(existsSync(path.join(fixture.currentRoot, IDS.demandOther)), false);
  assert.equal(existsSync(path.join(fixture.currentRoot, `${IDS.demandOther}.create-intent.json`)), false);
  assert.equal(existsSync(path.join(fixture.currentRoot, `${IDS.demand}.create-intent.json`)), true);
});

test("a corrupt unrelated pending tree blocks every new create before its sidecar", async () => {
  const {
    planInitialDemandPublication,
    publishInitialDemandPublication,
    WakeflowDemandPublicationError,
  } = await publicationApi();
  const fixture = workspaceFixture({ todoIds: ["TODO-first", "TODO-second"] });
  const unrelatedPlan = planInitialDemandPublication(todoInput(fixture, {
    demandId: IDS.demandOther,
    todoId: "TODO-first",
  }));
  writePendingTree(unrelatedPlan, "unused", { sidecar: true });
  const unrelatedStage = path.join(
    fixture.workspaceRoot,
    ...unrelatedPlan.journal.plan.paths.stageRootRef.split("/"),
  );
  mkdirSync(unrelatedStage, { mode: 0o700 });
  writeFileSync(path.join(unrelatedStage, "unknown.bin"), "corrupt\n", { mode: 0o600 });

  const candidate = todoInput(fixture, { todoId: "TODO-second" });
  assert.throws(
    () => publishInitialDemandPublication(candidate),
    (error) => error instanceof WakeflowDemandPublicationError
      && error.code === "wakeflow-demand-publication-tree",
  );
  assert.equal(existsSync(path.join(fixture.currentRoot, IDS.demand)), false);
  assert.equal(existsSync(path.join(fixture.currentRoot, `${IDS.demand}.create-intent.json`)), false);
  assert.equal(existsSync(path.join(unrelatedStage, "unknown.bin")), true);
});

test("TODO drift behind an unrelated sidecar or root journal blocks a new demand with zero candidate residue", async () => {
  const {
    planInitialDemandPublication,
    publishInitialDemandPublication,
    WakeflowDemandPublicationError,
  } = await publicationApi();

  for (const checkpoint of ["sidecar", "root-journal"]) {
    const fixture = workspaceFixture({ todoIds: ["TODO-first", "TODO-second"] });
    const unrelatedPlan = planInitialDemandPublication(todoInput(fixture, {
      demandId: IDS.demandOther,
      todoId: "TODO-first",
    }));
    const unrelatedRoot = path.join(
      fixture.workspaceRoot,
      ...unrelatedPlan.stateRootRef.split("/"),
    );
    if (checkpoint === "sidecar") {
      writePendingTree(unrelatedPlan, "unused", { sidecar: true });
    } else {
      writePendingTree(unrelatedPlan, unrelatedRoot);
    }
    todoService.claimTodoRow({
      root: fixture.workspaceRoot,
      boardPath: fixture.boardPath,
      todoId: "TODO-first",
      expectedRow: unrelatedPlan.journal.plan.todoClaim.expectedRow,
      mount: {
        demandId: IDS.demand,
        stateRootRef: `.wakeflow-active/current/${IDS.demand}`,
        identityDigest: `sha256:${"f".repeat(64)}`,
      },
    });

    assert.throws(
      () => publishInitialDemandPublication(todoInput(fixture, { todoId: "TODO-second" })),
      WakeflowDemandPublicationError,
      checkpoint,
    );
    assertCreateResidueAbsent(fixture, IDS.demand);
    assert.equal(
      existsSync(path.join(fixture.workspaceRoot, ".wakeflow-active", "current.identity-lock")),
      false,
      checkpoint,
    );
    assert.equal(existsSync(`${fixture.boardPath}.lock`), false, checkpoint);
    assert.equal(todoBoardRow(fixture, "TODO-first").value.Status, "claimed");
    assert.equal(
      todoBoardRow(fixture, "TODO-first").value["Current Mount"],
      `.wakeflow-active/current/${IDS.demand}`,
    );
    if (checkpoint === "sidecar") {
      assert.equal(
        existsSync(path.join(fixture.currentRoot, `${IDS.demandOther}.create-intent.json`)),
        true,
      );
    } else {
      assert.equal(
        existsSync(path.join(unrelatedRoot, "transactions", "create.json")),
        true,
      );
    }
  }
});

test("a claimed row without an exact journal cannot stand in for demand identity", async () => {
  const {
    planInitialDemandPublication,
    publishInitialDemandPublication,
    WakeflowDemandPublicationError,
  } = await publicationApi();
  const fixture = workspaceFixture();
  const input = todoInput(fixture);
  todoService.claimTodoRow({
    root: fixture.workspaceRoot,
    boardPath: fixture.boardPath,
    todoId: input.expectedTodoRow.todoId,
    expectedRow: input.expectedTodoRow,
    mount: {
      demandId: IDS.demand,
      stateRootRef: `.wakeflow-active/current/${IDS.demand}`,
      identityDigest: `sha256:${"f".repeat(64)}`,
    },
  });

  // T02 can prove only the exact claimed row/stateRootRef. T03 still plans the
  // intended digest, then refuses to publish because no exact create journal
  // proves which identity originally caused that claimed row.
  const plan = planInitialDemandPublication(input);
  assert.equal(plan.journal.plan.todoClaim.mount.identityDigest, canonicalJsonDigest(input.demand));
  assert.throws(
    () => publishInitialDemandPublication(input),
    (error) => error instanceof WakeflowDemandPublicationError
      && error.code === "wakeflow-demand-publication-order",
  );
  assert.equal(existsSync(path.join(fixture.currentRoot, IDS.demand)), false);
  assert.equal(existsSync(path.join(fixture.currentRoot, `${IDS.demand}.create-intent.json`)), false);
});

test("recovery does not infer a transaction or ignore an atomic sidecar fragment", async () => {
  const {
    recoverInitialDemandPublication,
    WakeflowDemandPublicationError,
  } = await publicationApi();
  const fixture = workspaceFixture();
  const result = recoverInitialDemandPublication({
    workspaceRoot: fixture.workspaceRoot,
    ledgerRoot: fixture.ledgerRoot,
    expectedProgramId: IDS.program,
    demandId: IDS.demand,
  });
  assert.deepEqual(result, {
    status: "no-pending-transaction",
    schemaVersion: 1,
    programId: IDS.program,
    demandId: IDS.demand,
  });
  assert.deepEqual(directChildren(fixture.currentRoot), ["global-todo-board.md"]);

  const fragment = path.join(
    fixture.currentRoot,
    `.${IDS.demand}.create-intent.json.wakeflow-stage-stuck`,
  );
  writeFileSync(fragment, "partial\n", { mode: 0o600 });
  assert.throws(
    () => recoverInitialDemandPublication({
      workspaceRoot: fixture.workspaceRoot,
      ledgerRoot: fixture.ledgerRoot,
      expectedProgramId: IDS.program,
      demandId: IDS.demand,
    }),
    (error) => error instanceof WakeflowDemandPublicationError
      && error.code === "wakeflow-demand-publication-residue",
  );
  assert.equal(readFileSync(fragment, "utf8"), "partial\n");
});

test("concurrent same-intent publishers serialize to one root without leaking locks or stages", async () => {
  const fixture = workspaceFixture();
  const input = todoInput(fixture);
  const serializable = {
    ...input,
    bundle: null,
  };
  const argsFile = path.join(fixture.workspaceRoot, "candidate-input.json");
  writeFileSync(argsFile, `${JSON.stringify(serializable)}\n`, { mode: 0o600 });
  const results = await Promise.all([
    runPublicationProcess(argsFile),
    runPublicationProcess(argsFile),
  ]);
  assert.deepEqual(results.map((entry) => entry.code), [0, 0], JSON.stringify(results));
  assert.deepEqual(
    results.map((entry) => JSON.parse(entry.stdout).status).sort(),
    ["already-published", "published"],
  );
  assert.equal(existsSync(path.join(fixture.currentRoot, IDS.demand)), true);
  assert.deepEqual(
    readdirSync(fixture.currentRoot).filter((entry) => (
      entry.includes("create-lock")
      || entry.includes("create-intent")
      || entry.startsWith(".wakeflow-create-stage-")
    )),
    [],
  );
});

test("different demands racing for one TODO in real processes publish exactly one winner", async () => {
  const fixture = workspaceFixture();
  const candidates = [
    todoInput(fixture, { demandId: IDS.demand }),
    todoInput(fixture, { demandId: IDS.demandOther }),
  ];
  const argsFiles = candidates.map((input) => {
    const argsFile = path.join(fixture.workspaceRoot, `${input.demand.demandId}.input.json`);
    writeFileSync(argsFile, `${JSON.stringify({ ...input, bundle: null })}\n`, { mode: 0o600 });
    return argsFile;
  });
  const results = await Promise.all(argsFiles.map(runPublicationProcess));
  const successes = results.filter((entry) => entry.code === 0);
  const failures = results.filter((entry) => entry.code !== 0);
  assert.equal(successes.length, 1, JSON.stringify(results));
  assert.equal(failures.length, 1, JSON.stringify(results));

  const winner = JSON.parse(successes[0].stdout);
  const winnerId = winner.demandId;
  const loserId = winnerId === IDS.demand ? IDS.demandOther : IDS.demand;
  assert.equal(winner.status, "published");
  assert.equal(existsSync(path.join(fixture.currentRoot, winnerId)), true);
  assertCreateResidueAbsent(fixture, loserId);
  for (const demandId of [IDS.demand, IDS.demandOther]) {
    assert.equal(
      existsSync(path.join(fixture.currentRoot, `${demandId}.create-intent.json`)),
      false,
      `${demandId} sidecar`,
    );
    assert.equal(
      existsSync(path.join(fixture.currentRoot, `.wakeflow-create-stage-${demandId}`)),
      false,
      `${demandId} stage`,
    );
    assert.equal(
      existsSync(path.join(fixture.currentRoot, `${demandId}.create-lock`)),
      false,
      `${demandId} create lock`,
    );
  }
  assert.equal(
    existsSync(path.join(fixture.workspaceRoot, ".wakeflow-active", "current.identity-lock")),
    false,
  );
  assert.equal(existsSync(`${fixture.boardPath}.lock`), false);
  const claimed = todoBoardRow(fixture);
  assert.equal(claimed.value.Status, "claimed");
  assert.equal(claimed.value["Current Mount"], `.wakeflow-active/current/${winnerId}`);
  loadDemandCoreRecords({
    stateRoot: path.join(fixture.currentRoot, winnerId),
    expectedProgramId: IDS.program,
  });
});
