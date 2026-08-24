import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const importerRelative = "core/scripts/lib/wakeflow-evidence-importer.mjs";
const recordsRelative = "core/scripts/lib/wakeflow-evidence-records.mjs";
const treeRelative = "core/scripts/lib/wakeflow-evidence-tree.mjs";
const schemaRelative = "core/schemas/wakeflow-demand-evidence/evidence.schema.json";

const IDS = Object.freeze({
  program: "program_11111111-1111-4111-8111-111111111111",
  demand: "demand_22222222-2222-4222-8222-222222222222",
  demandOther: "demand_23232323-2323-4232-8232-232323232323",
  requirement: "requirement_24242424-2424-4242-8242-242424242424",
  repository: "repository_22222222-2222-4222-8222-222222222222",
  repositoryUnknown: "repository_29292929-2929-4929-8929-292929292929",
  designSurface: "surface_33333333-3333-4333-8333-333333333333",
  testSurface: "surface_44444444-4444-4444-8444-444444444444",
  surfaceUnknown: "surface_49494949-4949-4949-8949-494949494949",
  controllerWindow: "window_55555555-5555-4555-8555-555555555555",
  productWindow: "window_88888888-8888-4888-8888-888888888888",
});

const CREATED_AT = "2026-08-07T05:00:00.000Z";
const EVIDENCE_ID_RE = /^evidence_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const REQUIREMENT_AUTHORITY_ROLES = Object.freeze([
  "code-facts",
  "landing-plan",
  "non-goals",
  "original-plan",
  "requirement-design",
  "user-confirmation",
]);

function byteDigest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function writeCanonical(file, value) {
  writeFileSync(file, `${canonicalJson(value)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

function resolvePortable(root, ref) {
  assert.equal(typeof ref, "string");
  assert.equal(path.posix.isAbsolute(ref), false);
  assert.equal(ref.includes("\\"), false);
  assert.equal(ref.split("/").some((segment) => segment === "." || segment === ".."), false);
  return path.join(root, ...ref.split("/"));
}

function deepFrozen(value) {
  if (!value || typeof value !== "object") return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every(deepFrozen);
}

function filesystemSnapshot(root) {
  if (!existsSync(root)) return null;
  const walk = (target, relative = ".") => {
    const stats = lstatSync(target);
    const entry = {
      path: relative,
      kind: stats.isSymbolicLink()
        ? "symlink"
        : stats.isDirectory()
          ? "directory"
          : stats.isFile()
            ? "file"
            : "special",
      mode: stats.mode & 0o777,
      links: stats.nlink,
    };
    if (stats.isSymbolicLink()) return [{ ...entry, target: readFileSync(target, "utf8") }];
    if (stats.isFile()) return [{ ...entry, digest: byteDigest(readFileSync(target)) }];
    if (!stats.isDirectory()) return [entry];
    return [
      entry,
      ...readdirSync(target)
        .sort()
        .flatMap((name) => walk(path.join(target, name), relative === "." ? name : `${relative}/${name}`)),
    ];
  };
  return walk(root);
}

function initialArtifactState() {
  return {
    taskPackages: [],
    targetTasks: [],
    targetResults: [],
    testCards: [],
    evidence: [],
    review: {
      status: "idle",
      readyTargetTaskIds: [],
      blockedTargetTaskIds: [],
      missingTargetTaskIds: [],
    },
  };
}

async function createAuthorityFixture(current) {
  const {
    createLedgerMemberReference,
    createLedgerRecord,
    loadLedgerRecord,
  } = await import("../core/scripts/lib/wakeflow-ledger-records.mjs");
  for (const directory of [
    "requirement-designs",
    "goal-stage-confirmation",
    "workspace/archive",
  ]) {
    mkdirSync(path.join(current.ledgerRoot, ...directory.split("/")), {
      recursive: true,
      mode: 0o700,
    });
  }
  const documents = REQUIREMENT_AUTHORITY_ROLES.map((role, index) => {
    const memberPath = `${String(index + 1).padStart(2, "0")}-${role}.md`;
    const content = `# ${role}\n`;
    return {
      role,
      path: memberPath,
      mediaType: "text/markdown",
      digest: byteDigest(content),
      content,
    };
  });
  const record = {
    schemaVersion: 1,
    artifactKind: "wakeflow-requirement-record",
    requirementId: IDS.requirement,
    programId: IDS.program,
    title: "Evidence replay authority fixture",
    status: "confirmed",
    relatedDemandIds: [IDS.demand],
    documents: documents.map(({ content: _content, ...document }) => document),
  };
  const created = createLedgerRecord({
    ledgerRoot: current.ledgerRoot,
    expectedProgramId: IDS.program,
    record,
    memberContents: Object.fromEntries(
      documents.map((document) => [document.path, document.content]),
    ),
  });
  const loaded = loadLedgerRecord({
    ledgerRoot: current.ledgerRoot,
    root: created.root,
    expectedFamily: "requirement",
    expectedProgramId: IDS.program,
  });
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand-authority",
    demandId: current.demand.demandId,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(current.demand),
    entryMode: "design-delivery",
    authorityRefs: documents.map((document) => (
      createLedgerMemberReference(loaded, document.path)
    )),
    testDecision: {
      mode: "controller-only",
      summary: "Keep this regression bounded to the controller transaction surface.",
    },
  };
}

function candidateConfig() {
  return {
    $schema: "https://raw.githubusercontent.com/GxFn/Wakeflow/main/core/schemas/wakeflow-config.schema.json",
    kind: "WakeflowConfig",
    schemaVersion: 3,
    program: {
      programId: IDS.program,
      displayName: "T06 Evidence Fixture",
      interfaceLanguage: "en",
    },
    topology: {
      repositories: [{
        repositoryId: IDS.repository,
        path: "../ProductA",
        displayName: "Product A",
        instructionManagement: "owner-managed",
      }],
      supportSurfaces: [{
        surfaceId: IDS.designSurface,
        capability: "design",
        path: "Design",
        displayName: "Design",
        ownership: "wakeflow-managed",
      }, {
        surfaceId: IDS.testSurface,
        capability: "test",
        path: "Test",
        displayName: "Test",
        ownership: "wakeflow-managed",
      }],
      windows: [{
        windowId: IDS.controllerWindow,
        role: "controller",
        displayName: "Controller",
        root: { kind: "program" },
      }, {
        windowId: "window_66666666-6666-4666-8666-666666666666",
        role: "design",
        displayName: "Design",
        root: { kind: "support-surface", surfaceId: IDS.designSurface },
      }, {
        windowId: "window_77777777-7777-4777-8777-777777777777",
        role: "test",
        displayName: "Test",
        root: { kind: "support-surface", surfaceId: IDS.testSurface },
      }, {
        windowId: IDS.productWindow,
        role: "product",
        displayName: "Product A",
        root: { kind: "repository", repositoryId: IDS.repository },
      }],
    },
    storage: { ledgerRoot: "../Ledger" },
    governance: {},
    hosts: {},
  };
}

function demandRecord() {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand",
    programId: IDS.program,
    demandId: IDS.demand,
    createdAt: CREATED_AT,
    title: "T06 managed evidence",
    goal: "Record one verified portable evidence snapshot.",
    completionDefinition: "The evidence root, event, and state reference remain exact.",
    demandType: "requirement",
    source: {
      schemaVersion: 1,
      artifactKind: "wakeflow-todo-lineage-ref",
      boardRef: ".wakeflow-active/current/global-todo-board.md",
      todoId: "TODO-M2-T06",
      intakeRowDigest: `sha256:${"a".repeat(64)}`,
    },
    executionPlacement: { mode: "main" },
  };
}

function initialEvent(demand) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: "event-initial-evidence-0001",
    demandId: IDS.demand,
    createdAt: CREATED_AT,
    actor: "controller",
    command: "init",
    type: "state.initialized",
    previousRevision: 0,
    nextRevision: 1,
    from: null,
    to: "intake",
    reason: "initialize the candidate demand before evidence import",
    decisionSummary: "Publish an empty managed evidence capability without a fabricated fact.",
    changedArtifacts: [{
      artifactKind: "wakeflow-demand",
      ref: "demand.json",
      digest: canonicalJsonDigest(demand),
    }],
  };
}

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-evidence-importer-"));
  t?.after(() => rmSync(root, { recursive: true, force: true }));
  const programRoot = path.join(root, "Program");
  const repositoryPath = path.join(root, "ProductA");
  const ledgerRoot = path.join(root, "Ledger");
  const designPath = path.join(programRoot, "Design");
  const testPath = path.join(programRoot, "Test");
  const stateRoot = path.join(programRoot, ".wakeflow-active", "current", IDS.demand);
  for (const directory of [
    programRoot,
    repositoryPath,
    ledgerRoot,
    designPath,
    testPath,
    stateRoot,
    path.join(stateRoot, "task-packages"),
    path.join(stateRoot, "target-results"),
    path.join(stateRoot, "review-candidates"),
    path.join(stateRoot, "test-cards"),
    path.join(stateRoot, "evidence"),
    path.join(stateRoot, "transactions"),
  ]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
  }
  const configPath = path.join(programRoot, "wakeflow.config.json");
  const config = candidateConfig();
  writeCanonical(configPath, config);
  const demand = demandRecord();
  const event = initialEvent(demand);
  const state = {
    schemaVersion: 1,
    artifactKind: "wakeflow-state",
    programId: IDS.program,
    demandId: IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(demand),
    revision: 1,
    state: "intake",
    stateReason: event.reason,
    updatedAt: event.createdAt,
    lastEvent: {
      eventId: event.eventId,
      eventDigest: canonicalJsonDigest(event),
    },
    ...initialArtifactState(),
  };
  writeCanonical(path.join(stateRoot, "demand.json"), demand);
  writeCanonical(path.join(stateRoot, "wakeflow-state.json"), state);
  writeFileSync(
    path.join(stateRoot, "controller-events.jsonl"),
    `${canonicalJson(event)}\n`,
    { mode: 0o600 },
  );
  chmodSync(path.join(stateRoot, "controller-events.jsonl"), 0o600);
  const sourceFile = path.join(repositoryPath, "reports", "focused-test.txt");
  mkdirSync(path.dirname(sourceFile), { recursive: true, mode: 0o700 });
  const sourceBytes = Buffer.from("portable focused test output\n", "utf8");
  writeFileSync(sourceFile, sourceBytes, { mode: 0o600 });
  return {
    root,
    programRoot,
    repositoryPath,
    ledgerRoot,
    designPath,
    testPath,
    stateRoot,
    configPath,
    config,
    demand,
    event,
    state,
    sourceFile,
    sourceBytes,
    runtimeContext: {
      stateRoot,
      configPath,
      expectedProgramId: IDS.program,
    },
  };
}

function managedSource({
  rootKind = "repository",
  rootId = IDS.repository,
  sourcePath = "reports/focused-test.txt",
  expectedType = "file",
  expectedDigest = null,
  bytes = Buffer.from("portable focused test output\n", "utf8"),
} = {}) {
  const root = rootKind === "repository"
    ? { kind: "repository", repositoryId: rootId }
    : { kind: "support-surface", surfaceId: rootId };
  return {
    kind: "managed-path",
    root,
    path: sourcePath,
    expectedType,
    expectedDigest: expectedDigest ?? byteDigest(bytes),
  };
}

function managedTreeDigest(files, directories = []) {
  return canonicalJsonDigest({
    directories: [...directories].sort(),
    files: files
      .map(({ path: memberPath, bytes }) => ({
        path: memberPath,
        bytes: bytes.length,
        digest: byteDigest(bytes),
        contentClass: "text/plain",
      }))
      .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
  });
}

function previewInput(current, source = managedSource(), overrides = {}) {
  return {
    stateRoot: current.stateRoot,
    configPath: current.configPath,
    controllerWindowId: IDS.controllerWindow,
    kind: "test-output",
    source,
    relations: [],
    sensitivity: "internal",
    ...overrides,
  };
}

async function importerApi() {
  return import(`../${importerRelative}`);
}

function runApplyChild(planned, runtimeContext) {
  const moduleUrl = pathToFileURL(path.join(repositoryRoot, importerRelative)).href;
  const source = `
    const api = await import(process.env.WAKEFLOW_T06_IMPORTER_URL);
    try {
      const result = api.applyManagedEvidenceImport({
        plan: JSON.parse(process.env.WAKEFLOW_T06_PLAN),
        planDigest: process.env.WAKEFLOW_T06_PLAN_DIGEST,
        runtimeContext: JSON.parse(process.env.WAKEFLOW_T06_RUNTIME),
      });
      process.stdout.write(JSON.stringify({ ok: true, status: result.status }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, code: error?.code ?? null, message: error?.message ?? String(error) }));
      process.exitCode = 2;
    }
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        WAKEFLOW_T06_IMPORTER_URL: moduleUrl,
        WAKEFLOW_T06_PLAN: JSON.stringify(planned.plan),
        WAKEFLOW_T06_PLAN_DIGEST: planned.planDigest,
        WAKEFLOW_T06_RUNTIME: JSON.stringify(runtimeContext),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({
        code,
        signal,
        stderr,
        result: stdout ? JSON.parse(stdout) : null,
      });
    });
  });
}

function captureFailure(operation) {
  let failure = null;
  try {
    operation();
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof Error, "operation must fail closed");
  return failure;
}

function errorSurface(error, depth = 0) {
  if (!error || depth > 8) return null;
  return {
    name: error.name ?? null,
    code: error.code ?? null,
    message: error.message ?? String(error),
    details: error.details ?? null,
    cause: errorSurface(error.cause, depth + 1),
    cleanupError: errorSurface(error.cleanupError, depth + 1),
  };
}

function assertEvidenceFailure(operation, expected = /evidence|source|config|state|controller|digest|path/u, forbidden = []) {
  const error = captureFailure(operation);
  assert.match(`${error.code ?? ""} ${error.message}`, expected);
  const surface = JSON.stringify(errorSurface(error));
  for (const secret of forbidden) {
    assert.equal(surface.includes(secret), false);
  }
  return error;
}

function planPaths(current, planned) {
  const refs = planned.plan.paths;
  return {
    journal: resolvePortable(current.stateRoot, refs.journalRef),
    stageRoot: resolvePortable(current.stateRoot, refs.stageRootRef),
    evidenceRoot: resolvePortable(current.stateRoot, refs.evidenceRootRef),
    manifest: resolvePortable(current.stateRoot, refs.manifestRef),
  };
}

function alternateCompletePlanForSameEvidence(planned) {
  const plan = structuredClone(planned.plan);
  plan.manifest.kind = "alternate-test-output";
  const manifestDigest = canonicalJsonDigest(plan.manifest);
  plan.nextEvent.changedArtifacts[0].digest = manifestDigest;
  const eventDigest = canonicalJsonDigest(plan.nextEvent);
  const stateEvidence = plan.nextState.evidence.find(
    (entry) => entry.evidenceId === plan.evidenceId,
  );
  stateEvidence.digest = manifestDigest;
  plan.nextState.lastEvent.eventDigest = eventDigest;
  const stateDigest = canonicalJsonDigest(plan.nextState);
  plan.transaction.nextEvent = structuredClone(plan.nextEvent);
  plan.transaction.nextEventDigest = eventDigest;
  plan.transaction.nextState = structuredClone(plan.nextState);
  plan.transaction.nextStateDigest = stateDigest;
  plan.transaction.artifactWrites[0].digest = manifestDigest;
  plan.transaction.artifactWrites[0].value = structuredClone(plan.manifest);
  return {
    plan,
    planDigest: canonicalJsonDigest(plan),
  };
}

function materializeJournal(current, planned) {
  const paths = planPaths(current, planned);
  writeCanonical(paths.journal, planned.plan.transaction);
  return paths;
}

function materializeFileStage(current, planned, { complete = true } = {}) {
  const paths = materializeJournal(current, planned);
  mkdirSync(path.join(paths.stageRoot, "payload"), { recursive: true, mode: 0o700 });
  chmodSync(paths.stageRoot, 0o700);
  chmodSync(path.join(paths.stageRoot, "payload"), 0o700);
  if (complete) {
    copyFileSync(current.sourceFile, path.join(paths.stageRoot, "payload", "content"));
    chmodSync(path.join(paths.stageRoot, "payload", "content"), 0o600);
    writeCanonical(path.join(paths.stageRoot, "evidence.json"), planned.plan.manifest);
  }
  return paths;
}

function publishMaterializedStage(current, planned) {
  const paths = materializeFileStage(current, planned);
  renameSync(paths.stageRoot, paths.evidenceRoot);
  return paths;
}

function appendPlannedEvent(current, planned) {
  writeFileSync(
    path.join(current.stateRoot, "controller-events.jsonl"),
    `${canonicalJson(planned.plan.nextEvent)}\n`,
    { flag: "a", mode: 0o600 },
  );
}

test("candidate evidence modules and strict schema expose the admitted internal contract", async () => {
  for (const relative of [schemaRelative, recordsRelative, treeRelative, importerRelative]) {
    assert.equal(existsSync(path.join(repositoryRoot, relative)), true, relative);
  }
  const schema = JSON.parse(readFileSync(path.join(repositoryRoot, schemaRelative), "utf8"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.$id, "urn:wakeflow:internal:demand-evidence:evidence:v1");
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.artifactKind.const, "wakeflow-evidence");
  assert.equal(schema.properties.schemaVersion.const, 1);

  const api = await importerApi();
  for (const name of [
    "applyManagedEvidenceImport",
    "planManagedEvidenceImport",
    "recoverManagedEvidenceImport",
  ]) {
    assert.equal(typeof api[name], "function", name);
  }
  const tree = await import(`../${treeRelative}`);
  assert.deepEqual(tree.WAKEFLOW_EVIDENCE_LIMITS, {
    maxFiles: 256,
    maxDirectories: 256,
    maxFileBytes: 16 * 1024 * 1024,
    maxTotalBytes: 32 * 1024 * 1024,
    maxDepth: 16,
    maxPathBytes: 512,
  });
});

test("public importer inputs reject accessors without executing them", async (t) => {
  const {
    applyManagedEvidenceImport,
    planManagedEvidenceImport,
    recoverManagedEvidenceImport,
  } = await importerApi();
  const current = fixture(t);
  let getterCalls = 0;

  const preview = previewInput(current);
  delete preview.stateRoot;
  Object.defineProperty(preview, "stateRoot", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return current.stateRoot;
    },
  });
  assertEvidenceFailure(
    () => planManagedEvidenceImport(preview),
    /evidence-import-input/u,
  );
  assert.equal(getterCalls, 0);

  const applyInput = {
    planDigest: `sha256:${"a".repeat(64)}`,
    runtimeContext: current.runtimeContext,
  };
  Object.defineProperty(applyInput, "plan", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return {};
    },
  });
  assertEvidenceFailure(
    () => applyManagedEvidenceImport(applyInput),
    /evidence-import-input/u,
  );
  assert.equal(getterCalls, 0);

  const recoveryInput = {
    configPath: current.configPath,
    expectedProgramId: IDS.program,
  };
  Object.defineProperty(recoveryInput, "stateRoot", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return current.stateRoot;
    },
  });
  assertEvidenceFailure(
    () => recoverManagedEvidenceImport(recoveryInput),
    /evidence-import-input/u,
  );
  assert.equal(getterCalls, 0);
});

test("preview performs zero writes and returns one complete, frozen, portable canonical plan", async (t) => {
  const { planManagedEvidenceImport } = await importerApi();
  const current = fixture(t);
  const beforeProgram = filesystemSnapshot(current.programRoot);
  const beforeRepository = filesystemSnapshot(current.repositoryPath);
  const planned = planManagedEvidenceImport(previewInput(current));

  assert.deepEqual(Object.keys(planned), ["plan", "planDigest"]);
  assert.equal(planned.planDigest, canonicalJsonDigest(planned.plan));
  assert.equal(planned.plan.schemaVersion, 1);
  assert.equal(planned.plan.artifactKind, "wakeflow-evidence-import-plan");
  assert.match(planned.plan.evidenceId, EVIDENCE_ID_RE);
  assert.match(planned.plan.capturedAt, /^[0-9]{4}-[0-9]{2}-[0-9]{2}T/u);
  assert.equal(planned.plan.eventId, `event-evidence-recorded-${planned.plan.evidenceId}`);
  assert.equal(planned.plan.configSnapshot.programId, IDS.program);
  assert.match(planned.plan.configSnapshot.digest, DIGEST_RE);
  assert.equal(planned.plan.stateSnapshot.revision, 1);
  assert.match(planned.plan.stateSnapshot.digest, DIGEST_RE);
  assert.equal(planned.plan.sourceSnapshot.type, "file");
  assert.equal(planned.plan.sourceSnapshot.digest, byteDigest(current.sourceBytes));
  assert.equal(planned.plan.manifest.evidenceId, planned.plan.evidenceId);
  assert.equal(planned.plan.nextEvent.type, "evidence.recorded");
  assert.equal(planned.plan.nextState.revision, 2);
  assert.equal(planned.plan.transaction.artifactKind, "wakeflow-state-transition");
  assert.deepEqual(planned.plan.paths, {
    journalRef: "transactions/state-transition.json",
    stageRootRef: `evidence/.${planned.plan.evidenceId}.wakeflow-stage`,
    evidenceRootRef: `evidence/${planned.plan.evidenceId}`,
    manifestRef: `evidence/${planned.plan.evidenceId}/evidence.json`,
  });
  assert.equal(JSON.stringify(planned).includes(current.root), false);
  assert.equal(deepFrozen(planned), true);
  assert.deepEqual(filesystemSnapshot(current.programRoot), beforeProgram);
  assert.deepEqual(filesystemSnapshot(current.repositoryPath), beforeRepository);
});

test("file apply publishes exact bytes, event, and state tuple; exact replay is idempotent", async (t) => {
  const {
    applyManagedEvidenceImport,
    planManagedEvidenceImport,
  } = await importerApi();
  const current = fixture(t);
  const planned = planManagedEvidenceImport(previewInput(current));
  const applied = applyManagedEvidenceImport({
    plan: planned.plan,
    planDigest: planned.planDigest,
    runtimeContext: current.runtimeContext,
  });

  assert.equal(applied.status, "recorded");
  assert.deepEqual(applied.plan, planned.plan);
  assert.equal(applied.planDigest, planned.planDigest);
  assert.equal(applied.evidenceId, planned.plan.evidenceId);
  assert.equal(applied.ref, planned.plan.paths.manifestRef);
  assert.equal(applied.digest, canonicalJsonDigest(planned.plan.manifest));
  assert.equal(applied.eventRef, `controller-events.jsonl#${planned.plan.eventId}`);
  assert.equal(applied.stateRevision, 2);
  assert.deepEqual(applied.findings, { count: 0, codes: [] });
  assert.deepEqual(applied.blockers, []);

  const paths = planPaths(current, planned);
  assert.equal(readFileSync(path.join(paths.evidenceRoot, "payload", "content")).equals(current.sourceBytes), true);
  assert.deepEqual(JSON.parse(readFileSync(paths.manifest, "utf8")), planned.plan.manifest);
  assert.equal(statSync(paths.evidenceRoot).mode & 0o777, 0o700);
  assert.equal(statSync(paths.manifest).mode & 0o777, 0o600);
  assert.equal(statSync(path.join(paths.evidenceRoot, "payload", "content")).nlink, 1);
  assert.deepEqual(readdirSync(path.join(current.stateRoot, "transactions")), []);
  assert.equal(existsSync(paths.stageRoot), false);
  assert.equal(existsSync(`${current.stateRoot}.state-lock`), false);
  const state = JSON.parse(readFileSync(path.join(current.stateRoot, "wakeflow-state.json"), "utf8"));
  assert.deepEqual(state.evidence, [{
    evidenceId: planned.plan.evidenceId,
    ref: planned.plan.paths.manifestRef,
    digest: canonicalJsonDigest(planned.plan.manifest),
  }]);
  const eventLines = readFileSync(path.join(current.stateRoot, "controller-events.jsonl"), "utf8").trimEnd().split("\n");
  assert.equal(eventLines.length, 2);
  assert.deepEqual(JSON.parse(eventLines[1]), planned.plan.nextEvent);

  const replay = applyManagedEvidenceImport({
    plan: planned.plan,
    planDigest: planned.planDigest,
    runtimeContext: current.runtimeContext,
  });
  assert.equal(replay.status, "already-recorded");
  assert.equal(replay.planDigest, planned.planDigest);
  assert.equal(readFileSync(path.join(current.stateRoot, "controller-events.jsonl"), "utf8").trimEnd().split("\n").length, 2);
});

test("historical exact evidence replay survives a later frozen authority", async (t) => {
  const {
    applyManagedEvidenceImport,
    planManagedEvidenceImport,
  } = await importerApi();
  const { freezeDemandAuthority } = await import(
    "../core/scripts/lib/wakeflow-demand-state-service.mjs"
  );
  const current = fixture(t);
  const planned = planManagedEvidenceImport(previewInput(current));
  assert.equal(applyManagedEvidenceImport({
    plan: planned.plan,
    planDigest: planned.planDigest,
    runtimeContext: current.runtimeContext,
  }).status, "recorded");

  const authority = await createAuthorityFixture(current);
  const authorityDigest = canonicalJsonDigest(authority);
  const authorityCreatedAt = new Date(
    Date.parse(planned.plan.nextEvent.createdAt) + 1_000,
  ).toISOString();
  const authorityEvent = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: "event-authority-after-evidence-0003",
    demandId: IDS.demand,
    createdAt: authorityCreatedAt,
    actor: "controller",
    command: "freeze-authority",
    type: "authority.frozen",
    previousRevision: 2,
    nextRevision: 3,
    from: "intake",
    to: "intake",
    reason: "freeze the verified requirement authority after evidence was recorded",
    decisionSummary: "Preserve the earlier evidence transaction while binding later authority.",
    changedArtifacts: [{
      artifactKind: "wakeflow-demand-authority",
      ref: "demand-authority.json",
      digest: authorityDigest,
    }],
  };
  const authorityState = structuredClone(planned.plan.nextState);
  authorityState.demandAuthorityRef = "demand-authority.json";
  authorityState.demandAuthorityDigest = authorityDigest;
  authorityState.revision = 3;
  authorityState.stateReason = authorityEvent.reason;
  authorityState.updatedAt = authorityEvent.createdAt;
  authorityState.lastEvent = {
    eventId: authorityEvent.eventId,
    eventDigest: canonicalJsonDigest(authorityEvent),
  };
  const frozen = freezeDemandAuthority({
    stateRoot: current.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: current.ledgerRoot,
    expectedPrevious: {
      revision: 2,
      stateDigest: canonicalJsonDigest(planned.plan.nextState),
    },
    authority,
    event: authorityEvent,
    nextState: authorityState,
  });
  assert.equal(frozen.created, true);
  assert.equal(frozen.revision, 3);

  const authorityPath = path.join(current.stateRoot, "demand-authority.json");
  const statePath = path.join(current.stateRoot, "wakeflow-state.json");
  const eventsPath = path.join(current.stateRoot, "controller-events.jsonl");
  const evidenceRoot = path.join(current.stateRoot, "evidence");
  const beforeReplay = {
    authority: readFileSync(authorityPath),
    state: readFileSync(statePath),
    events: readFileSync(eventsPath),
    evidence: filesystemSnapshot(evidenceRoot),
  };

  const replay = applyManagedEvidenceImport({
    plan: planned.plan,
    planDigest: planned.planDigest,
    runtimeContext: current.runtimeContext,
  });
  assert.equal(replay.status, "already-recorded");
  assert.equal(replay.planDigest, planned.planDigest);
  assert.deepEqual(readFileSync(authorityPath), beforeReplay.authority);
  assert.deepEqual(readFileSync(statePath), beforeReplay.state);
  assert.deepEqual(readFileSync(eventsPath), beforeReplay.events);
  assert.deepEqual(filesystemSnapshot(evidenceRoot), beforeReplay.evidence);
  assert.deepEqual(readdirSync(path.join(current.stateRoot, "transactions")), []);
});

test("evidence inventory stays canonical when a later ID sorts first and both historical plans replay exactly", async (t) => {
  const {
    applyManagedEvidenceImport,
    planManagedEvidenceImport,
  } = await importerApi();
  const current = fixture(t);
  let first = null;
  for (let attempt = 0; attempt < 512; attempt += 1) {
    const candidate = planManagedEvidenceImport(previewInput(current));
    const leadingHex = candidate.plan.evidenceId.slice("evidence_".length, "evidence_".length + 1);
    if (leadingHex === "e" || leadingHex === "f") {
      first = candidate;
      break;
    }
  }
  assert.ok(first, "a high-sorting first evidence identity must be generated");
  assert.equal(applyManagedEvidenceImport({
    plan: first.plan,
    planDigest: first.planDigest,
    runtimeContext: current.runtimeContext,
  }).status, "recorded");

  const secondBytes = Buffer.from("second evidence whose identity sorts first\n", "utf8");
  const secondSourceFile = path.join(current.repositoryPath, "reports", "second-sorts-first.txt");
  writeFileSync(secondSourceFile, secondBytes, { mode: 0o600 });
  const secondSource = managedSource({
    sourcePath: "reports/second-sorts-first.txt",
    bytes: secondBytes,
  });
  let second = null;
  for (let attempt = 0; attempt < 512; attempt += 1) {
    const candidate = planManagedEvidenceImport(previewInput(current, secondSource));
    if (candidate.plan.evidenceId < first.plan.evidenceId) {
      second = candidate;
      break;
    }
  }
  assert.ok(second, "a later evidence identity sorting before the first must be generated");
  assert.equal(applyManagedEvidenceImport({
    plan: second.plan,
    planDigest: second.planDigest,
    runtimeContext: current.runtimeContext,
  }).status, "recorded");

  const stateAfterSecond = JSON.parse(
    readFileSync(path.join(current.stateRoot, "wakeflow-state.json"), "utf8"),
  );
  const expectedInventory = [first, second]
    .map((entry) => ({
      evidenceId: entry.plan.evidenceId,
      ref: entry.plan.paths.manifestRef,
      digest: canonicalJsonDigest(entry.plan.manifest),
    }))
    .sort((left, right) => left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0);
  assert.deepEqual(stateAfterSecond.evidence, expectedInventory);
  assert.deepEqual(
    stateAfterSecond.evidence.map((entry) => entry.evidenceId),
    [second.plan.evidenceId, first.plan.evidenceId],
  );
  const events = readFileSync(
    path.join(current.stateRoot, "controller-events.jsonl"),
    "utf8",
  ).trimEnd().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(
    events.slice(1).map((entry) => entry.eventId),
    [first.plan.eventId, second.plan.eventId],
  );

  for (const historical of [first, second]) {
    const replay = applyManagedEvidenceImport({
      plan: historical.plan,
      planDigest: historical.planDigest,
      runtimeContext: current.runtimeContext,
    });
    assert.equal(replay.status, "already-recorded");
  }
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(current.stateRoot, "wakeflow-state.json"), "utf8")),
    stateAfterSecond,
  );
  assert.equal(
    readFileSync(path.join(current.stateRoot, "controller-events.jsonl"), "utf8").trimEnd().split("\n").length,
    3,
  );
});

test("two real processes applying one exact plan produce one record and one proven replay", async (t) => {
  const { planManagedEvidenceImport } = await importerApi();
  const current = fixture(t);
  const planned = planManagedEvidenceImport(previewInput(current));
  const outcomes = await Promise.all([
    runApplyChild(planned, current.runtimeContext),
    runApplyChild(planned, current.runtimeContext),
  ]);
  assert.deepEqual(outcomes.map((entry) => entry.code).sort(), [0, 0], JSON.stringify(outcomes));
  assert.deepEqual(
    outcomes.map((entry) => entry.result?.status).sort(),
    ["already-recorded", "recorded"],
  );
  assert.deepEqual(readdirSync(path.join(current.stateRoot, "transactions")), []);
  assert.equal(existsSync(resolvePortable(current.stateRoot, planned.plan.paths.stageRootRef)), false);
  assert.equal(
    readFileSync(path.join(current.stateRoot, "controller-events.jsonl"), "utf8").trimEnd().split("\n").length,
    2,
  );
});

test("preview owns identity and one evidence ID cannot be rebound by a different complete plan", async (t) => {
  const {
    applyManagedEvidenceImport,
    planManagedEvidenceImport,
  } = await importerApi();
  const current = fixture(t);
  const first = planManagedEvidenceImport(previewInput(current));
  assertEvidenceFailure(
    () => planManagedEvidenceImport(previewInput(current, managedSource(), {
      evidenceId: first.plan.evidenceId,
    })),
    /wakeflow-evidence-import-input/u,
  );
  assertEvidenceFailure(
    () => planManagedEvidenceImport(previewInput(current, managedSource(), {
      capturedAt: first.plan.capturedAt,
    })),
    /wakeflow-evidence-import-input/u,
  );
  const second = alternateCompletePlanForSameEvidence(first);
  assert.notEqual(second.planDigest, first.planDigest);
  applyManagedEvidenceImport({
    plan: first.plan,
    planDigest: first.planDigest,
    runtimeContext: current.runtimeContext,
  });
  const before = filesystemSnapshot(current.stateRoot);
  const failure = assertEvidenceFailure(
    () => applyManagedEvidenceImport({
      plan: second.plan,
      planDigest: second.planDigest,
      runtimeContext: current.runtimeContext,
    }),
    /wakeflow-demand-state-evidence-conflict/u,
  );
  assert.equal(failure.code, "wakeflow-demand-state-evidence-conflict");
  assert.deepEqual(filesystemSnapshot(current.stateRoot), before);
  assert.equal(
    readFileSync(path.join(current.stateRoot, "controller-events.jsonl"), "utf8").trimEnd().split("\n").length,
    2,
  );
});

test("repository/support file, empty tree, HTTPS, and Git locator sources stay discriminated", async (t) => {
  const {
    applyManagedEvidenceImport,
    planManagedEvidenceImport,
  } = await importerApi();

  await t.test("support-surface file", () => {
    const current = fixture(t);
    const bytes = Buffer.from("portable design decision\n", "utf8");
    writeFileSync(path.join(current.designPath, "decision.txt"), bytes, { mode: 0o600 });
    const source = managedSource({
      rootKind: "support-surface",
      rootId: IDS.designSurface,
      sourcePath: "decision.txt",
      bytes,
    });
    const planned = planManagedEvidenceImport(previewInput(current, source));
    const applied = applyManagedEvidenceImport({
      plan: planned.plan,
      planDigest: planned.planDigest,
      runtimeContext: current.runtimeContext,
    });
    assert.equal(applied.status, "recorded");
    assert.equal(planned.plan.manifest.source.root.surfaceId, IDS.designSurface);
  });

  await t.test("repository empty tree", () => {
    const current = fixture(t);
    mkdirSync(path.join(current.repositoryPath, "tree", "empty"), { recursive: true, mode: 0o700 });
    const expectedDigest = canonicalJsonDigest({ directories: ["empty"], files: [] });
    const source = managedSource({
      sourcePath: "tree",
      expectedType: "tree",
      expectedDigest,
    });
    const planned = planManagedEvidenceImport(previewInput(current, source));
    const applied = applyManagedEvidenceImport({
      plan: planned.plan,
      planDigest: planned.planDigest,
      runtimeContext: current.runtimeContext,
    });
    assert.equal(applied.status, "recorded");
    assert.equal(existsSync(resolvePortable(current.stateRoot, `${planned.plan.paths.evidenceRootRef}/payload/empty`)), true);
    assert.deepEqual(planned.plan.manifest.payload.directories, ["payload", "payload/empty"]);
  });

  for (const [name, source] of [[
    "HTTPS locator",
    {
      kind: "https",
      url: "https://evidence.example.invalid/reports/run-1",
      verification: { kind: "caller-supplied-digest", digest: `sha256:${"b".repeat(64)}` },
    },
  ], [
    "Git locator",
    {
      kind: "git-commit",
      repositoryId: IDS.repository,
      commitOid: "c".repeat(40),
      verification: { kind: "caller-supplied-digest", digest: `sha256:${"d".repeat(64)}` },
    },
  ]]) {
    await t.test(name, () => {
      const current = fixture(t);
      const planned = planManagedEvidenceImport(previewInput(current, source));
      const applied = applyManagedEvidenceImport({
        plan: planned.plan,
        planDigest: planned.planDigest,
        runtimeContext: current.runtimeContext,
      });
      const evidenceRoot = resolvePortable(current.stateRoot, planned.plan.paths.evidenceRootRef);
      assert.equal(applied.status, "recorded");
      assert.equal(Object.hasOwn(planned.plan.manifest, "payload"), false);
      assert.deepEqual(readdirSync(evidenceRoot), ["evidence.json"]);
      assert.equal(planned.plan.manifest.source.verification.kind, "caller-supplied-digest");
    });
  }
});

test("legal payload names cannot collide with private member-stage recovery files", async (t) => {
  const {
    applyManagedEvidenceImport,
    planManagedEvidenceImport,
  } = await importerApi();

  for (const [name, memberName] of [[
    "legacy stage suffix",
    "report.wakeflow-evidence-member-stage",
  ], [
    "255-byte basename",
    `${"n".repeat(251)}.txt`,
  ]]) {
    await t.test(name, (subtest) => {
      const current = fixture(t);
      const treeRoot = path.join(current.repositoryPath, "legal-payload-names");
      mkdirSync(treeRoot, { mode: 0o700 });
      const bytes = Buffer.from(`legal payload member: ${name}\n`, "utf8");
      const sourceFile = path.join(treeRoot, memberName);
      try {
        writeFileSync(sourceFile, bytes, { mode: 0o600 });
      } catch (error) {
        if (name === "255-byte basename" && new Set(["EINVAL", "ENAMETOOLONG", "ENOTSUP"]).has(error?.code)) {
          subtest.skip("the current temporary filesystem does not support a 255-byte basename");
          return;
        }
        throw error;
      }
      if (name === "255-byte basename") assert.equal(Buffer.byteLength(memberName), 255);
      const source = managedSource({
        sourcePath: "legal-payload-names",
        expectedType: "tree",
        expectedDigest: managedTreeDigest([{ path: memberName, bytes }]),
      });
      const planned = planManagedEvidenceImport(previewInput(current, source));
      const applied = applyManagedEvidenceImport({
        plan: planned.plan,
        planDigest: planned.planDigest,
        runtimeContext: current.runtimeContext,
      });
      const output = resolvePortable(
        current.stateRoot,
        `${planned.plan.paths.evidenceRootRef}/payload/${memberName}`,
      );
      assert.equal(applied.status, "recorded");
      assert.equal(readFileSync(output).equals(bytes), true);
      assert.equal(
        existsSync(path.join(planPaths(current, planned).evidenceRoot, ".wakeflow-evidence-member-stages")),
        false,
      );
    });
  }
});

test("apply revalidates plan digest, exact config, controller admission, state, and source before journaling", async (t) => {
  const {
    applyManagedEvidenceImport,
    planManagedEvidenceImport,
  } = await importerApi();

  const wrongController = fixture(t);
  assertEvidenceFailure(
    () => planManagedEvidenceImport(previewInput(wrongController, undefined, {
      controllerWindowId: IDS.productWindow,
    })),
    /controller|topology|window/u,
  );

  for (const scenario of ["plan-digest", "config", "state", "source"]) {
    await t.test(scenario, () => {
      const current = fixture(t);
      const planned = planManagedEvidenceImport(previewInput(current));
      let planDigest = planned.planDigest;
      if (scenario === "plan-digest") planDigest = `sha256:${"f".repeat(64)}`;
      if (scenario === "config") {
        const changed = structuredClone(current.config);
        changed.program.displayName = "Changed after preview";
        writeCanonical(current.configPath, changed);
      }
      if (scenario === "state") {
        const changed = structuredClone(current.state);
        changed.stateReason = "state changed after preview";
        writeCanonical(path.join(current.stateRoot, "wakeflow-state.json"), changed);
      }
      if (scenario === "source") writeFileSync(current.sourceFile, "source drift after preview\n");
      assertEvidenceFailure(
        () => applyManagedEvidenceImport({
          plan: planned.plan,
          planDigest,
          runtimeContext: current.runtimeContext,
        }),
        new RegExp(
          scenario === "plan-digest"
            ? "plan|digest"
            : scenario === "state"
              ? "state|stack-tail|core"
              : scenario,
          "u",
        ),
      );
      assert.deepEqual(readdirSync(path.join(current.stateRoot, "transactions")), []);
      assert.deepEqual(readdirSync(path.join(current.stateRoot, "evidence")), []);
    });
  }
});

test("apply rejects a canonically re-digested plan whose source inventory counts drift", async (t) => {
  const {
    applyManagedEvidenceImport,
    planManagedEvidenceImport,
  } = await importerApi();
  const current = fixture(t);
  const planned = planManagedEvidenceImport(previewInput(current));
  const tamperedPlan = structuredClone(planned.plan);
  tamperedPlan.sourceSnapshot.fileCount += 1;
  const tamperedDigest = canonicalJsonDigest(tamperedPlan);
  assert.notEqual(tamperedDigest, planned.planDigest);
  assertEvidenceFailure(
    () => applyManagedEvidenceImport({
      plan: tamperedPlan,
      planDigest: tamperedDigest,
      runtimeContext: current.runtimeContext,
    }),
    /plan|source|snapshot|count|payload/u,
  );
  assert.deepEqual(readdirSync(path.join(current.stateRoot, "transactions")), []);
  assert.deepEqual(readdirSync(path.join(current.stateRoot, "evidence")), []);
});

test("managed source authority, path, type, and digest are strict and locator-only input is portable", async (t) => {
  const { planManagedEvidenceImport } = await importerApi();
  const cases = [
    ["program root", { ...managedSource(), root: { kind: "program" } }],
    ["generic root", { ...managedSource(), root: { kind: "generic", id: "anything" } }],
    ["unknown repository", managedSource({ rootId: IDS.repositoryUnknown })],
    ["unknown support surface", managedSource({ rootKind: "support-surface", rootId: IDS.surfaceUnknown })],
    ["absolute POSIX path", managedSource({ sourcePath: "/tmp/forbidden" })],
    ["absolute Windows path", managedSource({ sourcePath: "C:\\Users\\forbidden" })],
    ["parent traversal", managedSource({ sourcePath: "../outside" })],
    ["dot segment", managedSource({ sourcePath: "reports/../focused-test.txt" })],
    ["type mismatch", managedSource({ expectedType: "tree" })],
    ["digest mismatch", managedSource({ expectedDigest: `sha256:${"e".repeat(64)}` })],
    ["HTTPS userinfo", {
      kind: "https",
      url: "https://user@example.invalid/report",
      verification: { kind: "caller-supplied-digest", digest: `sha256:${"1".repeat(64)}` },
    }],
    ["HTTPS query", {
      kind: "https",
      url: "https://example.invalid/report?token=hidden",
      verification: { kind: "caller-supplied-digest", digest: `sha256:${"1".repeat(64)}` },
    }],
    ["Git symbolic ref", {
      kind: "git-commit",
      repositoryId: IDS.repository,
      commitOid: "main",
      verification: { kind: "caller-supplied-digest", digest: `sha256:${"1".repeat(64)}` },
    }],
    ["Git unknown repository", {
      kind: "git-commit",
      repositoryId: IDS.repositoryUnknown,
      commitOid: "c".repeat(40),
      verification: { kind: "caller-supplied-digest", digest: `sha256:${"1".repeat(64)}` },
    }],
  ];
  for (const [name, source] of cases) {
    await t.test(name, () => {
      const current = fixture(t);
      assertEvidenceFailure(
        () => planManagedEvidenceImport(previewInput(current, source)),
        /source|root|repository|surface|path|type|digest|locator|url|commit/u,
        ["token=hidden"],
      );
      assert.deepEqual(readdirSync(path.join(current.stateRoot, "transactions")), []);
    });
  }
});

test("missing managed source errors expose no absolute fixture path or raw cause", async (t) => {
  const { planManagedEvidenceImport } = await importerApi();
  const current = fixture(t);
  const missingMember = "reports/missing-private-fixture.txt";
  const error = assertEvidenceFailure(
    () => planManagedEvidenceImport(previewInput(current, managedSource({
      sourcePath: missingMember,
      expectedDigest: `sha256:${"6".repeat(64)}`,
    }))),
    /source|path|unavailable|preview/u,
    [current.root, current.programRoot, current.repositoryPath, current.sourceFile],
  );
  assert.equal(Object.hasOwn(error, "cause"), false);
  assert.equal(error.cause, undefined);
  assert.equal(JSON.stringify(errorSurface(error)).includes(path.join(current.repositoryPath, missingMember)), false);
  assert.deepEqual(readdirSync(path.join(current.stateRoot, "transactions")), []);
  assert.deepEqual(readdirSync(path.join(current.stateRoot, "evidence")), []);
});

test("root, intermediate, leaf symlinks, hardlinks, and special files fail closed", async (t) => {
  const { planManagedEvidenceImport } = await importerApi();
  for (const scenario of ["root-symlink", "intermediate-symlink", "leaf-symlink", "hardlink", "fifo"]) {
    await t.test(scenario, (subtest) => {
      const current = fixture(t);
      let source = managedSource();
      if (scenario === "root-symlink") {
        const actual = path.join(current.root, "ProductA-actual");
        renameSync(current.repositoryPath, actual);
        symlinkSync(actual, current.repositoryPath, "dir");
      }
      if (scenario === "intermediate-symlink") {
        const actual = path.join(current.repositoryPath, "actual-reports");
        renameSync(path.join(current.repositoryPath, "reports"), actual);
        symlinkSync(actual, path.join(current.repositoryPath, "reports"), "dir");
      }
      if (scenario === "leaf-symlink") {
        const actual = path.join(current.repositoryPath, "reports", "actual.txt");
        renameSync(current.sourceFile, actual);
        symlinkSync("actual.txt", current.sourceFile);
      }
      if (scenario === "hardlink") {
        linkSync(current.sourceFile, path.join(current.repositoryPath, "reports", "second-link.txt"));
      }
      if (scenario === "fifo") {
        unlinkSync(current.sourceFile);
        const made = spawnSync("mkfifo", [current.sourceFile], { encoding: "utf8" });
        if (made.status !== 0) {
          subtest.skip("mkfifo is unavailable on this platform");
          return;
        }
        source = managedSource({ expectedDigest: `sha256:${"2".repeat(64)}` });
      }
      assertEvidenceFailure(
        () => planManagedEvidenceImport(previewInput(current, source)),
        /source|symlink|link|special|fifo|file|type|config-placement/u,
      );
    });
  }
});

test("content allowlist, opaque review, privacy findings, and fixed limits reject without value leakage", async (t) => {
  const {
    applyManagedEvidenceImport,
    planManagedEvidenceImport,
  } = await importerApi();

  await t.test("empty UTF-8 file is valid", () => {
    const current = fixture(t);
    writeFileSync(current.sourceFile, Buffer.alloc(0));
    const planned = planManagedEvidenceImport(previewInput(current, managedSource({ bytes: Buffer.alloc(0) })));
    assert.equal(planned.plan.manifest.payload.totalBytes, 0);
  });

  await t.test("typed Wakeflow ID is not a private host handle", () => {
    const current = fixture(t);
    const bytes = Buffer.from(`${IDS.controllerWindow}\n`, "utf8");
    writeFileSync(current.sourceFile, bytes);
    assert.doesNotThrow(() => planManagedEvidenceImport(previewInput(current, managedSource({ bytes }))));
  });

  await t.test("recognized binary requires explicit controller review", () => {
    const current = fixture(t);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
    writeFileSync(current.sourceFile, png);
    const source = managedSource({ bytes: png });
    assertEvidenceFailure(
      () => planManagedEvidenceImport(previewInput(current, source)),
      /opaque|binary|review/u,
    );
    const planned = planManagedEvidenceImport(previewInput(current, source, {
      controllerReviewedOpaque: true,
    }));
    const applied = applyManagedEvidenceImport({
      plan: planned.plan,
      planDigest: planned.planDigest,
      runtimeContext: current.runtimeContext,
    });
    assert.equal(applied.status, "recorded");
    assert.equal(planned.plan.manifest.payload.files[0].contentClass, "image/png");
  });

  const privacyValues = [
    "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n",
    "sk-proj-not-a-real-provider-token\n",
    "token = do-not-echo-this-value\n",
    "/Users/example/private/project\n",
    "C:\\Users\\example\\private\\project\n",
    "~/private/project\n",
    "55555555-5555-4555-8555-555555555555\n",
    "binary\u0000payload",
  ];
  for (const value of privacyValues) {
    await t.test(`reject ${byteDigest(value).slice(-12)}`, () => {
      const current = fixture(t);
      const bytes = Buffer.from(value, "utf8");
      writeFileSync(current.sourceFile, bytes);
      const error = assertEvidenceFailure(
        () => planManagedEvidenceImport(previewInput(current, managedSource({ bytes }))),
        /content|privacy|credential|secret|path|handle|binary|nul|finding/u,
        [value.trim(), "do-not-echo-this-value", "not-a-real-provider-token"],
      );
      assert.ok(Number.isInteger(error.details?.findingCount ?? 1));
    });
  }

  await t.test("path byte and directory count limits", () => {
    const longPath = `${"a".repeat(509)}.txt`;
    const pathCurrent = fixture(t);
    assertEvidenceFailure(
      () => planManagedEvidenceImport(previewInput(pathCurrent, managedSource({ sourcePath: longPath }))),
      /path|512|limit/u,
    );

    const treeCurrent = fixture(t);
    const treeRoot = path.join(treeCurrent.repositoryPath, "too-many-directories");
    mkdirSync(treeRoot, { mode: 0o700 });
    for (let index = 0; index < 257; index += 1) {
      mkdirSync(path.join(treeRoot, `d${String(index).padStart(3, "0")}`), { mode: 0o700 });
    }
    assertEvidenceFailure(
      () => planManagedEvidenceImport(previewInput(treeCurrent, managedSource({
        sourcePath: "too-many-directories",
        expectedType: "tree",
        expectedDigest: `sha256:${"3".repeat(64)}`,
      }))),
      /director|256|limit|count/u,
    );
  });
});

test("relations strict-load the same demand event and revalidate it at apply", async (t) => {
  const {
    applyManagedEvidenceImport,
    planManagedEvidenceImport,
  } = await importerApi();
  const current = fixture(t);
  const relation = {
    kind: "controller-event",
    eventId: current.event.eventId,
    digest: canonicalJsonDigest(current.event),
  };
  const planned = planManagedEvidenceImport(previewInput(current, undefined, { relations: [relation] }));
  assert.deepEqual(planned.plan.manifest.relations, [relation]);

  const changedEvent = { ...current.event, decisionSummary: "tampered relation source" };
  writeFileSync(
    path.join(current.stateRoot, "controller-events.jsonl"),
    `${canonicalJson(changedEvent)}\n`,
    { mode: 0o600 },
  );
  assertEvidenceFailure(
    () => applyManagedEvidenceImport({
      plan: planned.plan,
      planDigest: planned.planDigest,
      runtimeContext: current.runtimeContext,
    }),
    /relation|event|state|digest|tamper|stack-tail|core/u,
  );

  const missing = fixture(t);
  assertEvidenceFailure(
    () => planManagedEvidenceImport(previewInput(missing, undefined, {
      relations: [{
        kind: "controller-event",
        eventId: "event-from-another-demand-0001",
        digest: `sha256:${"4".repeat(64)}`,
      }],
    })),
    /relation|event|demand|missing/u,
  );

  const extraField = fixture(t);
  assertEvidenceFailure(
    () => planManagedEvidenceImport(previewInput(extraField, undefined, {
      relations: [{
        kind: "controller-event",
        eventId: extraField.event.eventId,
        digest: canonicalJsonDigest(extraField.event),
        unadmitted: "must-not-be-ignored",
      }],
    })),
    /relation|field|input/u,
  );
});

test("recovery forward-completes journal, partial/complete stage, root, event, and state checkpoints", async (t) => {
  const {
    planManagedEvidenceImport,
    recoverManagedEvidenceImport,
  } = await importerApi();
  for (const checkpoint of ["journal", "partial-stage", "complete-stage", "root", "event", "state"]) {
    await t.test(checkpoint, () => {
      const current = fixture(t);
      const planned = planManagedEvidenceImport(previewInput(current));
      if (checkpoint === "journal") materializeJournal(current, planned);
      if (checkpoint === "partial-stage") materializeFileStage(current, planned, { complete: false });
      if (checkpoint === "complete-stage") materializeFileStage(current, planned);
      if (["root", "event", "state"].includes(checkpoint)) publishMaterializedStage(current, planned);
      if (["event", "state"].includes(checkpoint)) appendPlannedEvent(current, planned);
      if (checkpoint === "state") {
        writeCanonical(path.join(current.stateRoot, "wakeflow-state.json"), planned.plan.nextState);
      }
      const recovered = recoverManagedEvidenceImport(current.runtimeContext);
      assert.equal(recovered.status, "recovered");
      assert.equal(recovered.evidenceId, planned.plan.evidenceId);
      const paths = planPaths(current, planned);
      assert.equal(existsSync(paths.evidenceRoot), true);
      assert.equal(existsSync(paths.stageRoot), false);
      assert.equal(existsSync(paths.journal), false);
      assert.deepEqual(JSON.parse(readFileSync(paths.manifest, "utf8")), planned.plan.manifest);
      assert.deepEqual(
        JSON.parse(readFileSync(path.join(current.stateRoot, "wakeflow-state.json"), "utf8")),
        planned.plan.nextState,
      );
      assert.equal(
        readFileSync(path.join(current.stateRoot, "controller-events.jsonl"), "utf8").trimEnd().split("\n").length,
        2,
      );
    });
  }
});

test("generic and evidence recovery entrypoints cannot adopt each other's journal kind", async (t) => {
  const {
    planManagedEvidenceImport,
    recoverManagedEvidenceImport,
  } = await importerApi();
  const { recoverDemandStateTransition } = await import(
    "../core/scripts/lib/wakeflow-demand-state-service.mjs"
  );

  await t.test("generic recovery rejects an evidence journal", () => {
    const current = fixture(t);
    const planned = planManagedEvidenceImport(previewInput(current));
    const paths = materializeJournal(current, planned);
    assert.throws(
      () => recoverDemandStateTransition({
        stateRoot: current.stateRoot,
        expectedProgramId: IDS.program,
      }),
      (error) => error?.code === "wakeflow-demand-state-recovery-conflict",
    );
    assert.equal(existsSync(paths.journal), true);
    assert.equal(existsSync(paths.stageRoot), false);
    assert.equal(existsSync(paths.evidenceRoot), false);
    assert.equal(recoverManagedEvidenceImport(current.runtimeContext).status, "recovered");
  });

  await t.test("evidence recovery rejects a generic state journal", () => {
    const current = fixture(t);
    const planned = planManagedEvidenceImport(previewInput(current));
    const event = {
      ...planned.plan.nextEvent,
      eventId: "event-generic-state-transition-0002",
      command: "continue-demand",
      type: "state.transitioned",
      reason: "advance one generic candidate state transition",
      decisionSummary: "Keep evidence recovery scoped to evidence-owned journals.",
      changedArtifacts: [],
    };
    const nextState = {
      ...current.state,
      revision: event.nextRevision,
      state: event.to,
      stateReason: event.reason,
      updatedAt: event.createdAt,
      lastEvent: {
        eventId: event.eventId,
        eventDigest: canonicalJsonDigest(event),
      },
    };
    const transaction = {
      ...planned.plan.transaction,
      command: event.command,
      nextEvent: event,
      nextEventDigest: canonicalJsonDigest(event),
      nextState,
      nextStateDigest: canonicalJsonDigest(nextState),
      artifactWrites: [],
    };
    const journal = path.join(current.stateRoot, "transactions", "state-transition.json");
    writeCanonical(journal, transaction);
    assertEvidenceFailure(
      () => recoverManagedEvidenceImport(current.runtimeContext),
      /recovery|artifact|evidence|conflict/u,
    );
    assert.equal(existsSync(journal), true);
    assert.equal(recoverDemandStateTransition({
      stateRoot: current.stateRoot,
      expectedProgramId: IDS.program,
    }).status, "recovered");
    assert.equal(existsSync(journal), false);
  });

  await t.test("evidence recovery executes one exact locked admission before replay", () => {
    const current = fixture(t);
    const planned = planManagedEvidenceImport(previewInput(current));
    const paths = materializeJournal(current, planned);
    let admissionCalls = 0;
    let getterCalls = 0;
    let resolverCalls = 0;
    assert.throws(
      () => recoverDemandStateTransition({
        stateRoot: current.stateRoot,
        expectedProgramId: IDS.program,
        expectedArtifactKind: "wakeflow-evidence",
        resolveEvidenceSource() {
          resolverCalls += 1;
          throw new Error("evidence resolver must not run after rejected admission");
        },
        admitRecoveryWhileLocked() {
          admissionCalls += 1;
          const verdict = {};
          Object.defineProperty(verdict, "admitted", {
            enumerable: true,
            get() {
              getterCalls += 1;
              return true;
            },
          });
          return verdict;
        },
      }),
      (error) => error?.code === "wakeflow-demand-state-recovery-conflict",
    );
    assert.equal(admissionCalls, 1);
    assert.equal(getterCalls, 0);
    assert.equal(resolverCalls, 0);
    assert.equal(existsSync(paths.journal), true);
    assert.equal(existsSync(paths.stageRoot), false);
    assert.equal(existsSync(paths.evidenceRoot), false);
  });
});

test("a verified published final evidence root remains recovery authority after source deletion or drift", async (t) => {
  const {
    planManagedEvidenceImport,
    recoverManagedEvidenceImport,
  } = await importerApi();
  for (const scenario of ["deleted", "drifted"]) {
    await t.test(scenario, () => {
      const current = fixture(t);
      const planned = planManagedEvidenceImport(previewInput(current));
      const paths = publishMaterializedStage(current, planned);
      if (scenario === "deleted") unlinkSync(current.sourceFile);
      if (scenario === "drifted") writeFileSync(current.sourceFile, "source changed after immutable publication\n");

      const recovered = recoverManagedEvidenceImport(current.runtimeContext);
      assert.equal(recovered.status, "recovered");
      assert.equal(recovered.evidenceId, planned.plan.evidenceId);
      assert.equal(existsSync(paths.journal), false);
      assert.equal(existsSync(paths.stageRoot), false);
      assert.equal(
        readFileSync(path.join(paths.evidenceRoot, "payload", "content")).equals(current.sourceBytes),
        true,
      );
      assert.deepEqual(
        JSON.parse(readFileSync(path.join(current.stateRoot, "wakeflow-state.json"), "utf8")),
        planned.plan.nextState,
      );
      assert.equal(
        readFileSync(path.join(current.stateRoot, "controller-events.jsonl"), "utf8").trimEnd().split("\n").length,
        2,
      );
    });
  }
});

test("recovery removes one verified deterministic private member residue and reconstructs exact bytes", async (t) => {
  const {
    planManagedEvidenceImport,
    recoverManagedEvidenceImport,
  } = await importerApi();
  const current = fixture(t);
  const planned = planManagedEvidenceImport(previewInput(current));
  const paths = materializeJournal(current, planned);
  const residueDirectory = path.join(paths.stageRoot, ".wakeflow-evidence-member-stages");
  const payloadDirectory = path.join(paths.stageRoot, "payload");
  mkdirSync(paths.stageRoot, { mode: 0o700 });
  mkdirSync(payloadDirectory, { mode: 0o700 });
  mkdirSync(residueDirectory, { mode: 0o700 });
  chmodSync(paths.stageRoot, 0o700);
  chmodSync(payloadDirectory, 0o700);
  chmodSync(residueDirectory, 0o700);
  const residueName = `${createHash("sha256").update("payload/content", "utf8").digest("hex")}.stage`;
  const residueFile = path.join(residueDirectory, residueName);
  writeFileSync(residueFile, "interrupted private member bytes", { mode: 0o600 });
  chmodSync(residueFile, 0o600);

  const recovered = recoverManagedEvidenceImport(current.runtimeContext);
  assert.equal(recovered.status, "recovered");
  assert.equal(recovered.evidenceId, planned.plan.evidenceId);
  assert.equal(existsSync(paths.journal), false);
  assert.equal(existsSync(paths.stageRoot), false);
  assert.equal(existsSync(residueFile), false);
  assert.equal(existsSync(path.join(paths.evidenceRoot, ".wakeflow-evidence-member-stages")), false);
  assert.equal(
    readFileSync(path.join(paths.evidenceRoot, "payload", "content")).equals(current.sourceBytes),
    true,
  );
  assert.deepEqual(JSON.parse(readFileSync(paths.manifest, "utf8")), planned.plan.manifest);
});

test("recovery never backfills a missing final root after the event is visible", async (t) => {
  const {
    planManagedEvidenceImport,
    recoverManagedEvidenceImport,
  } = await importerApi();
  const current = fixture(t);
  const planned = planManagedEvidenceImport(previewInput(current));
  const paths = materializeJournal(current, planned);
  appendPlannedEvent(current, planned);

  assertEvidenceFailure(
    () => recoverManagedEvidenceImport(current.runtimeContext),
    /event|root|missing|backfill|recovery/u,
  );
  assert.equal(existsSync(paths.journal), true);
  assert.equal(existsSync(paths.evidenceRoot), false);
  assert.equal(existsSync(paths.stageRoot), false);
});

test("recovery keeps the journal on source drift, ambiguous stage/root, and unknown staged members", async (t) => {
  const {
    planManagedEvidenceImport,
    recoverManagedEvidenceImport,
  } = await importerApi();
  for (const scenario of ["source-drift", "stage-and-root", "unknown-stage-member"]) {
    await t.test(scenario, () => {
      const current = fixture(t);
      const planned = planManagedEvidenceImport(previewInput(current));
      const paths = materializeFileStage(current, planned, { complete: scenario !== "unknown-stage-member" });
      if (scenario === "source-drift") writeFileSync(current.sourceFile, "changed before recovery\n");
      if (scenario === "stage-and-root") cpSync(paths.stageRoot, paths.evidenceRoot, { recursive: true });
      if (scenario === "unknown-stage-member") writeFileSync(path.join(paths.stageRoot, "unexpected.bin"), "x");
      assertEvidenceFailure(
        () => recoverManagedEvidenceImport(current.runtimeContext),
        /source|drift|stage|root|unknown|recovery|conflict/u,
      );
      assert.equal(existsSync(paths.journal), true);
    });
  }
});

test("committed evidence tamper, orphan roots, and duplicate identity block normal later mutation", async (t) => {
  const {
    applyManagedEvidenceImport,
    planManagedEvidenceImport,
  } = await importerApi();

  for (const scenario of ["payload-tamper", "manifest-tamper", "orphan-root", "duplicate-identity"]) {
    await t.test(scenario, () => {
      const current = fixture(t);
      const first = planManagedEvidenceImport(previewInput(current));
      applyManagedEvidenceImport({
        plan: first.plan,
        planDigest: first.planDigest,
        runtimeContext: current.runtimeContext,
      });
      const firstPaths = planPaths(current, first);
      if (scenario === "payload-tamper") {
        writeFileSync(path.join(firstPaths.evidenceRoot, "payload", "content"), "tampered\n");
      }
      if (scenario === "manifest-tamper") {
        const manifest = JSON.parse(readFileSync(firstPaths.manifest, "utf8"));
        manifest.kind = "tampered-kind";
        writeCanonical(firstPaths.manifest, manifest);
      }
      if (scenario === "orphan-root") {
        mkdirSync(path.join(current.stateRoot, "evidence", "unknown-root"), { mode: 0o700 });
      }
      if (scenario === "duplicate-identity") {
        const duplicateId = "evidence_99999999-9999-4999-8999-999999999999";
        cpSync(firstPaths.evidenceRoot, path.join(current.stateRoot, "evidence", duplicateId), { recursive: true });
      }
      const secondBytes = Buffer.from("second clean evidence\n", "utf8");
      writeFileSync(path.join(current.repositoryPath, "reports", "second.txt"), secondBytes, { mode: 0o600 });
      assertEvidenceFailure(
        () => planManagedEvidenceImport(previewInput(current, managedSource({
          sourcePath: "reports/second.txt",
          bytes: secondBytes,
        }))),
        /evidence|inventory|closure|tamper|orphan|duplicate|digest|identity/u,
      );
      assert.deepEqual(readdirSync(path.join(current.stateRoot, "transactions")), []);
    });
  }
});

test("the v3 MCP owns evidence import while retired state, result, review, and archive surfaces stay isolated", () => {
  const retiredFiles = [
    "core/scripts/wakeflow-state.mjs",
    "core/mcp/server.cjs",
    "core/scripts/lib/wakeflow-state-results.mjs",
    "core/scripts/lib/wakeflow-result-recording-commands.mjs",
    "core/scripts/lib/wakeflow-review-commands.mjs",
    "core/scripts/lib/wakeflow-dispatch-group-review.mjs",
    "core/scripts/wakeflow-archive-docs.mjs",
    "core/scripts/wakeflow-archive-summaries.mjs",
  ];
  for (const relative of retiredFiles) {
    if (relative === "core/mcp/server.cjs") continue;
    assert.equal(existsSync(path.join(repositoryRoot, relative)), false, relative);
  }

  const mcpSource = readFileSync(
    path.join(repositoryRoot, "core/lib/wakeflow-mcp-tools.mjs"),
    "utf8",
  );
  assert.match(mcpSource, /from "\.\.\/scripts\/lib\/wakeflow-evidence-importer\.mjs"/u);
  assert.match(mcpSource, /wakeflow_record_evidence/u);

  const importerSource = existsSync(path.join(repositoryRoot, importerRelative))
    ? readFileSync(path.join(repositoryRoot, importerRelative), "utf8")
    : "";
  for (const legacy of [
    "wakeflow-state.mjs",
    "wakeflow-state-results.mjs",
    "wakeflow-result-recording-commands.mjs",
    "wakeflow-review-commands.mjs",
    "wakeflow-archive-docs.mjs",
    "wakeflow-archive-summaries.mjs",
  ]) {
    assert.equal(importerSource.includes(legacy), false, legacy);
  }
});
