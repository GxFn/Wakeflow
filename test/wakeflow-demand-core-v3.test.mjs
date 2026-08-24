import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const recordsModule = "../core/scripts/lib/wakeflow-demand-core-records.mjs";
const stateServiceModule = "../core/scripts/lib/wakeflow-demand-state-service.mjs";
const stateServiceUrl = new URL(stateServiceModule, import.meta.url);
const stateLockUrl = new URL("../core/scripts/lib/wakeflow-state-lock.mjs", import.meta.url);

const IDS = Object.freeze({
  program: "program_11111111-1111-4111-8111-111111111111",
  programOther: "program_99999999-9999-4999-8999-999999999999",
  demand: "demand_22222222-2222-4222-8222-222222222222",
  demandOther: "demand_88888888-8888-4888-8888-888888888888",
  requirement: "requirement_33333333-3333-4333-8333-333333333333",
  confirmation: "confirmation_44444444-4444-4444-8444-444444444444",
});
const CREATED_AT = "2026-08-07T01:02:03.000Z";
const UPDATED_AT = "2026-08-07T01:03:04.000Z";

function clone(value) {
  return structuredClone(value);
}

function digest(value) {
  return canonicalJsonDigest(value);
}

function byteDigest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function writeCanonical(file, value) {
  writeFileSync(file, `${canonicalJson(value)}\n`, { mode: 0o600 });
}

function visitObjectTree(value, visitor, valuePath = "$") {
  if (!value || typeof value !== "object") return;
  visitor(value, valuePath);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitObjectTree(entry, visitor, `${valuePath}/${index}`));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    visitObjectTree(entry, visitor, `${valuePath}/${key}`);
  }
}

function listModuleFiles(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(candidate);
      else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(candidate);
    }
  };
  walk(root);
  return files;
}

function todoLineage() {
  return {
    artifactKind: "wakeflow-todo-lineage-ref",
    schemaVersion: 1,
    boardRef: ".wakeflow-active/current/global-todo-board.md",
    todoId: "TODO-M2-T04",
    intakeRowDigest: `sha256:${"a".repeat(64)}`,
  };
}

const REQUIREMENT_AUTHORITY_ROLES = Object.freeze([
  "code-facts",
  "landing-plan",
  "non-goals",
  "original-plan",
  "requirement-design",
  "user-confirmation",
]);

function ledgerMemberReference(role = "requirement-design", index = 0) {
  const memberName = `${String(index + 1).padStart(2, "0")}-${role}.md`;
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-ledger-member-ref",
    family: "requirement",
    recordId: IDS.requirement,
    recordRef: `requirement-designs/${IDS.requirement}/record.json`,
    recordDigest: `sha256:${"b".repeat(64)}`,
    memberRef: `requirement-designs/${IDS.requirement}/${memberName}`,
    memberDigest: `sha256:${"c".repeat(64)}`,
    role,
  };
}

function ledgerMemberReferences() {
  return REQUIREMENT_AUTHORITY_ROLES.map(ledgerMemberReference);
}

async function makeAuthorityLedger({ confirmationDemandId = null } = {}) {
  const {
    createLedgerMemberReference,
    createLedgerRecord,
    loadLedgerRecord,
  } = await import("../core/scripts/lib/wakeflow-ledger-records.mjs");
  const ledgerRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-demand-core-ledger-"));
  mkdirSync(path.join(ledgerRoot, "requirement-designs"), { recursive: true });
  mkdirSync(path.join(ledgerRoot, "goal-stage-confirmation"), { recursive: true });
  mkdirSync(path.join(ledgerRoot, "workspace", "archive"), { recursive: true });
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
    title: "Candidate demand authority",
    status: "confirmed",
    relatedDemandIds: [IDS.demand],
    documents: documents.map(({ content: _content, ...document }) => document),
  };
  const created = createLedgerRecord({
    ledgerRoot,
    expectedProgramId: IDS.program,
    record,
    memberContents: Object.fromEntries(documents.map((document) => [document.path, document.content])),
  });
  const loaded = loadLedgerRecord({
    ledgerRoot,
    root: created.root,
    expectedFamily: "requirement",
    expectedProgramId: IDS.program,
  });
  let confirmationRefs = [];
  if (confirmationDemandId !== null) {
    const confirmationDocuments = [
      ["goal-stage-decision", "01-goal-stage-decision.md"],
      ["user-confirmation", "02-user-confirmation.md"],
    ].map(([role, memberPath]) => ({
      role,
      path: memberPath,
      mediaType: "text/markdown",
      content: `# ${role}\n`,
    }));
    const confirmation = {
      schemaVersion: 1,
      artifactKind: "wakeflow-confirmation-record",
      confirmationId: IDS.confirmation,
      programId: IDS.program,
      demandId: confirmationDemandId,
      title: "Bound goal and stage decision",
      status: "confirmed",
      documents: confirmationDocuments.map(({ content, ...document }) => ({
        ...document,
        digest: byteDigest(content),
      })),
    };
    const createdConfirmation = createLedgerRecord({
      ledgerRoot,
      expectedProgramId: IDS.program,
      record: confirmation,
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
    confirmationRefs = confirmationDocuments.map((document) => (
      createLedgerMemberReference(loadedConfirmation, document.path)
    ));
  }
  return {
    ledgerRoot,
    authorityRefs: documents.map((document) => createLedgerMemberReference(loaded, document.path)),
    confirmationRefs,
  };
}

function demandRecord(overrides = {}) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand",
    programId: IDS.program,
    demandId: IDS.demand,
    createdAt: CREATED_AT,
    title: "Candidate demand core",
    goal: "Freeze one strict candidate authority stack.",
    completionDefinition: "Identity, state, event, and authority remain aligned.",
    demandType: "requirement",
    source: todoLineage(),
    executionPlacement: { mode: "main" },
    ...overrides,
  };
}

function authorityRecord(demand = demandRecord(), overrides = {}) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand-authority",
    demandId: demand.demandId,
    demandRef: "demand.json",
    demandDigest: digest(demand),
    entryMode: "design-delivery",
    authorityRefs: ledgerMemberReferences(),
    testDecision: {
      mode: "controller-only",
      summary: "Run the bounded candidate regression suite.",
    },
    ...overrides,
  };
}

function changedArtifact(artifactKind, ref, artifactDigest) {
  return { artifactKind, ref, digest: artifactDigest };
}

function controllerEvent({
  eventId = "event-initial-0001",
  createdAt = CREATED_AT,
  command = "init",
  type = "state.initialized",
  previousRevision = 0,
  nextRevision = 1,
  from = null,
  to = "intake",
  reason = "candidate demand core initialized",
  decisionSummary = "Publish the strict immutable demand identity.",
  changedArtifacts = [],
} = {}) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId,
    demandId: IDS.demand,
    createdAt,
    actor: "controller",
    command,
    type,
    previousRevision,
    nextRevision,
    from,
    to,
    reason,
    decisionSummary,
    changedArtifacts,
  };
}

function stateRecord({
  demand = demandRecord(),
  authority = null,
  event,
  revision = event.nextRevision,
  state = event.to,
  stateReason = event.reason,
  updatedAt = event.createdAt,
} = {}) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-state",
    programId: demand.programId,
    demandId: demand.demandId,
    demandRef: "demand.json",
    demandDigest: digest(demand),
    ...(authority === null ? {} : {
      demandAuthorityRef: "demand-authority.json",
      demandAuthorityDigest: digest(authority),
    }),
    revision,
    state,
    stateReason,
    updatedAt,
    lastEvent: {
      eventId: event.eventId,
      eventDigest: digest(event),
    },
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

function makePublishedRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-demand-core-v3-"));
  const stateRoot = path.join(root, IDS.demand);
  mkdirSync(path.join(stateRoot, "transactions"), { recursive: true, mode: 0o700 });
  mkdirSync(path.join(stateRoot, "evidence"), { recursive: true, mode: 0o700 });
  const demand = demandRecord();
  const event = controllerEvent({
    changedArtifacts: [changedArtifact("wakeflow-demand", "demand.json", digest(demand))],
  });
  const state = stateRecord({ demand, event });
  writeCanonical(path.join(stateRoot, "demand.json"), demand);
  writeCanonical(path.join(stateRoot, "wakeflow-state.json"), state);
  writeFileSync(path.join(stateRoot, "controller-events.jsonl"), `${canonicalJson(event)}\n`, {
    mode: 0o600,
  });
  return { root, stateRoot, demand, event, state };
}

function nextTransition(fixture, {
  eventId = "event-transition-0002",
  reason = "candidate transition committed",
  decisionSummary = "Move the current snapshot without copying demand payload.",
} = {}) {
  const event = controllerEvent({
    eventId,
    createdAt: UPDATED_AT,
    command: "continue-demand",
    type: "state.transitioned",
    previousRevision: 1,
    nextRevision: 2,
    from: "intake",
    to: "planned",
    reason,
    decisionSummary,
  });
  return {
    event,
    nextState: stateRecord({
      demand: fixture.demand,
      event,
      revision: 2,
      state: "planned",
      stateReason: reason,
      updatedAt: UPDATED_AT,
    }),
  };
}

function transitionJournal({ fixture, event, nextState, artifactWrites = [] }) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-state-transition",
    demandId: fixture.demand.demandId,
    command: event.command,
    createdAt: event.createdAt,
    expectedPreviousRevision: fixture.state.revision,
    expectedPreviousStateDigest: digest(fixture.state),
    previousState: fixture.state,
    nextEvent: event,
    nextEventDigest: digest(event),
    nextState,
    nextStateDigest: digest(nextState),
    artifactWrites,
  };
}

async function runTransitionChild(args) {
  const source = [
    `import { commitDemandStateTransition } from ${JSON.stringify(stateServiceUrl.href)};`,
    `const args = ${JSON.stringify(args)};`,
    "try {",
    "  commitDemandStateTransition(args);",
    "  process.stdout.write(JSON.stringify({ status: 'committed' }));",
    "} catch (error) {",
    "  process.stdout.write(JSON.stringify({ status: 'rejected', code: error?.code ?? null, message: error?.message ?? String(error) }));",
    "  process.exitCode = 2;",
    "}",
  ].join("\n");
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    cwd: repositoryRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code, signal] = await once(child, "exit");
  return { code, signal, stdout, stderr };
}

async function runAuthorityChild(args) {
  const source = [
    `import { freezeDemandAuthority } from ${JSON.stringify(stateServiceUrl.href)};`,
    `const args = ${JSON.stringify(args)};`,
    "try {",
    "  const result = freezeDemandAuthority(args);",
    "  process.stdout.write(JSON.stringify({ status: 'ok', created: result.created }));",
    "} catch (error) {",
    "  process.stdout.write(JSON.stringify({ status: 'error', code: error?.code ?? null }));",
    "  process.exitCode = 2;",
    "}",
  ].join("\n");
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    cwd: repositoryRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code, signal] = await once(child, "exit");
  return { code, signal, stdout, stderr, payload: JSON.parse(stdout) };
}

async function startStateLockHolder(stateRoot, holdMs = 300) {
  const source = [
    `import { withStateRootLock } from ${JSON.stringify(stateLockUrl.href)};`,
    `const stateRoot = ${JSON.stringify(stateRoot)};`,
    `const holdMs = ${JSON.stringify(holdMs)};`,
    "withStateRootLock(stateRoot, () => {",
    "  process.stdout.write('locked\\n');",
    "  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, holdMs);",
    "});",
  ].join("\n");
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    cwd: repositoryRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exitPromise = once(child, "exit");
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes("locked\n")) resolve();
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!stdout.includes("locked\n")) {
        reject(new Error(`lock holder exited ${code}: ${stderr}`));
      }
    });
  });
  return { child, exitPromise };
}

test("candidate demand core ships only the five admitted strict schemas", async () => {
  const {
    WAKEFLOW_DEMAND_AUTHORITY_ENTRY_MODES,
    WAKEFLOW_DEMAND_STATES,
    WAKEFLOW_DEMAND_TEST_MODES,
    WAKEFLOW_DEMAND_TYPES,
  } = await import(recordsModule);
  const schemaRoot = path.join(repositoryRoot, "core/schemas/wakeflow-demand-core");
  const schemaFiles = [
    "controller-event.schema.json",
    "demand-authority.schema.json",
    "demand.schema.json",
    "state-transition.schema.json",
    "wakeflow-state.schema.json",
  ];
  assert.deepEqual(readdirSync(schemaRoot).sort(), schemaFiles);

  const expectedKinds = new Map([
    ["controller-event.schema.json", "wakeflow-controller-event"],
    ["demand-authority.schema.json", "wakeflow-demand-authority"],
    ["demand.schema.json", "wakeflow-demand"],
    ["state-transition.schema.json", "wakeflow-state-transition"],
    ["wakeflow-state.schema.json", "wakeflow-state"],
  ]);
  const schemas = new Map();
  let closedObjectCount = 0;
  const externalRefs = [];
  for (const [file, artifactKind] of expectedKinds) {
    const schema = JSON.parse(readFileSync(path.join(schemaRoot, file), "utf8"));
    schemas.set(file, schema);
    assert.equal(schema.additionalProperties, false, `${file} must reject unknown root fields`);
    assert.equal(schema.properties.artifactKind.const, artifactKind);
    visitObjectTree(schema, (node, nodePath) => {
      if (node.type === "object") {
        closedObjectCount += 1;
        assert.equal(node.additionalProperties, false, `${file}:${nodePath} must reject unknown fields`);
      }
      if (typeof node.$ref === "string" && node.$ref.startsWith("urn:wakeflow:")) {
        externalRefs.push({ file, nodePath, ref: node.$ref });
      }
    });
  }
  assert.equal(closedObjectCount, 67, "every admitted data object must stay explicitly closed");
  const artifactSchemaRoot = path.join(repositoryRoot, "core/schemas/wakeflow-demand-artifacts");
  const evidenceSchema = JSON.parse(readFileSync(
    path.join(repositoryRoot, "core/schemas/wakeflow-demand-evidence/evidence.schema.json"),
    "utf8",
  ));
  const schemaIds = new Set([
    ...[...schemas.values()].map((schema) => schema.$id),
    ...readdirSync(artifactSchemaRoot).map((file) => (
      JSON.parse(readFileSync(path.join(artifactSchemaRoot, file), "utf8")).$id
    )),
    evidenceSchema.$id,
  ]);
  assert.equal(externalRefs.length, 11);
  for (const { file, nodePath, ref } of externalRefs) {
    assert.equal(schemaIds.has(ref), true, `${file}:${nodePath} must resolve inside the admitted schema set`);
  }

  const authoritySchema = schemas.get("demand-authority.schema.json");
  for (const forbidden of ["authorityId", "status", "demandType"]) {
    assert.equal(Object.hasOwn(authoritySchema.properties, forbidden), false);
  }
  assert.deepEqual(authoritySchema.properties.entryMode.enum, [...WAKEFLOW_DEMAND_AUTHORITY_ENTRY_MODES]);
  assert.deepEqual(authoritySchema.$defs.testDecision.properties.mode.enum, [...WAKEFLOW_DEMAND_TEST_MODES]);
  assert.deepEqual(authoritySchema.$defs.requirementRole.enum, [
    "original-plan",
    "requirement-design",
    "code-facts",
    "landing-plan",
    "non-goals",
    "user-confirmation",
    "reproduction",
    "scope",
    "requirement-delta",
    "research-question",
    "boundaries",
    "test-environment",
  ]);
  assert.deepEqual(authoritySchema.$defs.confirmationRole.enum, [
    "user-confirmation",
    "requirement-delta",
  ]);

  const demandSchema = schemas.get("demand.schema.json");
  assert.deepEqual(demandSchema.properties.demandType.enum, [...WAKEFLOW_DEMAND_TYPES]);
  assert.deepEqual(demandSchema.$defs.todoLineageRef.required, [
    "schemaVersion",
    "artifactKind",
    "boardRef",
    "todoId",
    "intakeRowDigest",
  ]);
  assert.equal(
    demandSchema.$defs.todoLineageRef.properties.boardRef.const,
    ".wakeflow-active/current/global-todo-board.md",
  );
  assert.equal(demandSchema.$defs.todoId.pattern, "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$");
  assert.deepEqual(demandSchema.$defs.requirementRole.enum, [
    ...authoritySchema.$defs.requirementRole.enum,
    "supporting-evidence",
  ]);
  assert.deepEqual(demandSchema.$defs.confirmationRole.enum, [
    "goal-stage-decision",
    "user-confirmation",
    "requirement-delta",
    "supporting-evidence",
  ]);

  const stateSchema = schemas.get("wakeflow-state.schema.json");
  assert.deepEqual(stateSchema.properties.state.enum, [...WAKEFLOW_DEMAND_STATES]);
  assert.equal(stateSchema.required.includes("evidence"), true);
  assert.deepEqual(stateSchema.$defs.evidenceState.required, ["evidenceId", "ref", "digest"]);
  assert.equal(stateSchema.$defs.evidenceState.additionalProperties, false);
  for (const forbidden of ["title", "goal", "completionDefinition", "source", "projection", "extensions"]) {
    assert.equal(Object.hasOwn(stateSchema.properties, forbidden), false);
  }
  const eventSchema = schemas.get("controller-event.schema.json");
  assert.deepEqual(eventSchema.$defs.demandState.enum, [...WAKEFLOW_DEMAND_STATES]);
  assert.deepEqual(
    eventSchema.properties.changedArtifacts.items.oneOf.map((entry) => entry.$ref),
    [
      "#/$defs/demandChange",
      "#/$defs/authorityChange",
      "#/$defs/taskPackageChange",
      "#/$defs/targetResultChange",
      "#/$defs/reviewCandidateChange",
      "#/$defs/testCardChange",
      "#/$defs/podDesignRequestChange",
      "#/$defs/podDesignHandoffChange",
      "#/$defs/evidenceChange",
    ],
  );
  assert.equal(Object.hasOwn(eventSchema.properties, "stateDigest"), false);

  const timestampPattern = "^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\.[0-9]{1,9})?Z$";
  for (const file of [
    "controller-event.schema.json",
    "demand.schema.json",
    "state-transition.schema.json",
    "wakeflow-state.schema.json",
  ]) {
    assert.equal(schemas.get(file).$defs.timestamp.pattern, timestampPattern, `${file} timestamp pattern`);
  }

  const journalSchema = schemas.get("state-transition.schema.json");
  assert.equal(
    journalSchema.properties.artifactWrites.items.oneOf.at(-1).$ref,
    "#/$defs/evidenceWrite",
  );
  assert.equal(
    journalSchema.$defs.evidenceWrite.properties.value.$ref,
    "urn:wakeflow:internal:demand-evidence:evidence:v1",
  );
  for (const forbidden of ["operationId", "status", "checkpoint", "extensions"]) {
    assert.equal(Object.hasOwn(journalSchema.properties, forbidden), false);
  }
});

test("demand identity is strict, typed, immutable data with unchanged TODO lineage", async () => {
  const { validateDemandRecord } = await import(recordsModule);
  const demand = demandRecord();
  const validated = validateDemandRecord(demand);
  assert.deepEqual(validated, demand);
  assert.equal(Object.isFrozen(validated), true);
  assert.deepEqual(validated.source, todoLineage());

  for (const mutate of [
    (value) => { value.demandId = "semantic-demand-title"; },
    (value) => { value.status = "active"; },
    (value) => { value.currentWindow = "Controller"; },
    (value) => { value.source.intakeRowDigest = "not-a-digest"; },
    (value) => { value.source.todoId = "not portable"; },
    (value) => { value.executionPlacement.runtimePhase = "ready"; },
  ]) {
    const invalid = clone(demand);
    mutate(invalid);
    assert.throws(() => validateDemandRecord(invalid));
  }

  for (const createdAt of [
    "2028-02-29T23:59:59Z",
    "2028-02-29T23:59:59.123456789Z",
  ]) {
    assert.equal(validateDemandRecord(demandRecord({ createdAt })).createdAt, createdAt);
  }
  for (const createdAt of [
    "2026-08-07T24:00:00Z",
    "2026-02-29T00:00:00Z",
    "2026-02-31T00:00:00Z",
    "2026-04-31T00:00:00Z",
  ]) {
    assert.throws(() => validateDemandRecord(demandRecord({ createdAt })), undefined, createdAt);
  }
});

test("authority has no identity or mutable status and accepts only exact T01 member refs", async () => {
  const { validateDemandAuthorityRecord } = await import(recordsModule);
  const demand = demandRecord();
  const { ledgerRoot, authorityRefs } = await makeAuthorityLedger();
  const authority = authorityRecord(demand, { authorityRefs });
  assert.deepEqual(validateDemandAuthorityRecord(authority), authority);
  assert.deepEqual(validateDemandAuthorityRecord(authority, { demand, ledgerRoot }), authority);

  const loose = clone(authority);
  loose.authorityRefs = [{ role: "requirement-design", ref: "requirement.md" }];
  assert.throws(() => validateDemandAuthorityRecord(loose));
  const unresolved = clone(authority);
  unresolved.authorityRefs[0].memberDigest = `sha256:${"d".repeat(64)}`;
  assert.throws(() => validateDemandAuthorityRecord(unresolved, { demand, ledgerRoot }));
  const incomplete = clone(authority);
  incomplete.authorityRefs = incomplete.authorityRefs.slice(1);
  assert.throws(() => validateDemandAuthorityRecord(incomplete, { demand, ledgerRoot }));
  for (const field of ["authorityId", "status", "demandType", "extensions"]) {
    const invalid = clone(authority);
    invalid[field] = field === "status" ? "active" : "invented";
    assert.throws(() => validateDemandAuthorityRecord(invalid));
  }
});

test("confirmation lineage may cross demands but placement and frozen authority cannot", async () => {
  const {
    validateDemandAuthorityRecord,
    validateDemandRecord,
  } = await import(recordsModule);
  const crossDemand = await makeAuthorityLedger({ confirmationDemandId: IDS.demandOther });
  const goalStageRef = crossDemand.confirmationRefs.find((entry) => entry.role === "goal-stage-decision");
  const userConfirmationRef = crossDemand.confirmationRefs.find((entry) => entry.role === "user-confirmation");

  const lineage = demandRecord({
    source: {
      schemaVersion: 1,
      artifactKind: "wakeflow-demand-ledger-source",
      memberRefs: [goalStageRef],
    },
  });
  assert.doesNotThrow(() => validateDemandRecord(lineage, { ledgerRoot: crossDemand.ledgerRoot }));

  const isolated = demandRecord({
    executionPlacement: { mode: "isolated", authorizationRef: goalStageRef },
  });
  assert.throws(() => validateDemandRecord(isolated, { ledgerRoot: crossDemand.ledgerRoot }));

  const crossAuthority = authorityRecord(demandRecord(), {
    authorityRefs: [userConfirmationRef, ...crossDemand.authorityRefs],
  });
  assert.throws(() => validateDemandAuthorityRecord(crossAuthority, {
    demand: demandRecord(),
    ledgerRoot: crossDemand.ledgerRoot,
  }));

  const sameDemand = await makeAuthorityLedger({ confirmationDemandId: IDS.demand });
  const sameDemandPlacement = demandRecord({
    executionPlacement: {
      mode: "isolated",
      authorizationRef: sameDemand.confirmationRefs.find((entry) => entry.role === "goal-stage-decision"),
    },
  });
  assert.doesNotThrow(() => validateDemandRecord(sameDemandPlacement, { ledgerRoot: sameDemand.ledgerRoot }));
});

test("state is a pure current snapshot with exact immutable refs and no copied payload", async () => {
  const { validateDemandStateRecord } = await import(recordsModule);
  const demand = demandRecord();
  const event = controllerEvent({
    changedArtifacts: [changedArtifact("wakeflow-demand", "demand.json", digest(demand))],
  });
  const state = stateRecord({ demand, event });
  assert.deepEqual(validateDemandStateRecord(state), state);

  const evidenceId = "evidence_11111111-1111-4111-8111-111111111111";
  const evidenceState = clone(state);
  evidenceState.evidence = [{
    evidenceId,
    ref: `evidence/${evidenceId}/evidence.json`,
    digest: `sha256:${"1".repeat(64)}`,
  }];
  assert.deepEqual(validateDemandStateRecord(evidenceState), evidenceState);

  for (const mutate of [
    (value) => { delete value.evidence; },
    (value) => { value.evidence[0].ref = `evidence/${evidenceId}/manifest.json`; },
    (value) => { value.evidence[0].lifecycleStatus = "active"; },
    (value) => { value.evidence[0].payload = {}; },
  ]) {
    const invalidEvidence = clone(evidenceState);
    mutate(invalidEvidence);
    assert.throws(() => validateDemandStateRecord(invalidEvidence));
  }
  const unsortedEvidence = clone(evidenceState);
  const earlierEvidenceId = "evidence_00000000-0000-4000-8000-000000000000";
  unsortedEvidence.evidence.push({
    evidenceId: earlierEvidenceId,
    ref: `evidence/${earlierEvidenceId}/evidence.json`,
    digest: `sha256:${"2".repeat(64)}`,
  });
  assert.throws(() => validateDemandStateRecord(unsortedEvidence));

  for (const [field, value] of [
    ["title", demand.title],
    ["goal", demand.goal],
    ["completionDefinition", demand.completionDefinition],
    ["source", demand.source],
    ["taskPackages", [{ taskPackageId: "invented" }]],
    ["projection", { status: "synced" }],
    ["extensions", {}],
  ]) {
    const invalid = clone(state);
    invalid[field] = value;
    assert.throws(() => validateDemandStateRecord(invalid));
  }
});

test("event revisions are contiguous and the state tail binds the exact final event digest", async () => {
  const {
    validateControllerEventRecord,
    validateDemandCoreStack,
  } = await import(recordsModule);
  const fixture = makePublishedRoot();
  const transition = nextTransition(fixture);
  const nextState = transition.nextState;
  assert.deepEqual(validateControllerEventRecord(fixture.event), fixture.event);
  assert.deepEqual(validateControllerEventRecord(transition.event), transition.event);
  assert.doesNotThrow(() => validateDemandCoreStack({
    demand: fixture.demand,
    state: nextState,
    events: [fixture.event, transition.event],
  }));

  const gapped = clone(transition.event);
  gapped.previousRevision = 2;
  gapped.nextRevision = 3;
  assert.throws(() => validateDemandCoreStack({
    demand: fixture.demand,
    state: nextState,
    events: [fixture.event, gapped],
  }));
  const staleTail = clone(nextState);
  staleTail.lastEvent.eventDigest = `sha256:${"f".repeat(64)}`;
  assert.throws(() => validateDemandCoreStack({
    demand: fixture.demand,
    state: staleTail,
    events: [fixture.event, transition.event],
  }));

  for (const [field, value] of [
    ["actor", "target"],
    ["command", "create-demand"],
    ["type", "state.transitioned"],
    ["to", "planned"],
  ]) {
    const invalidInitial = clone(fixture.event);
    invalidInitial[field] = value;
    assert.throws(
      () => validateControllerEventRecord(invalidInitial),
      undefined,
      `revision 0 to 1 must reject initial ${field}=${value}`,
    );
  }
});

test("post-publication event and state close one exact managed evidence identity", async () => {
  const {
    validateControllerEventRecord,
    validateDemandCoreStack,
  } = await import(recordsModule);
  const fixture = makePublishedRoot();
  const evidenceId = "evidence_11111111-1111-4111-8111-111111111111";
  const ref = `evidence/${evidenceId}/evidence.json`;
  const evidenceDigest = `sha256:${"1".repeat(64)}`;
  const event = controllerEvent({
    eventId: "event-evidence-recorded-0002",
    command: "record-evidence",
    type: "evidence.recorded",
    previousRevision: 1,
    nextRevision: 2,
    from: "intake",
    to: "intake",
    reason: "Record one immutable managed evidence root.",
    decisionSummary: "Bind the exact evidence manifest identity without copying payload into state.",
    changedArtifacts: [{
      artifactKind: "wakeflow-evidence",
      artifactId: evidenceId,
      ref,
      digest: evidenceDigest,
    }],
  });
  const state = clone(fixture.state);
  state.revision = 2;
  state.stateReason = event.reason;
  state.updatedAt = event.createdAt;
  state.lastEvent = { eventId: event.eventId, eventDigest: digest(event) };
  state.evidence = [{ evidenceId, ref, digest: evidenceDigest }];

  assert.deepEqual(validateControllerEventRecord(event), event);
  assert.doesNotThrow(() => validateDemandCoreStack({
    demand: fixture.demand,
    state,
    events: [fixture.event, event],
  }));

  const wrongRef = clone(event);
  wrongRef.changedArtifacts[0].ref = `evidence/${evidenceId}/manifest.json`;
  assert.throws(() => validateControllerEventRecord(wrongRef));

  const unbound = clone(state);
  unbound.evidence[0].digest = `sha256:${"2".repeat(64)}`;
  assert.throws(() => validateDemandCoreStack({
    demand: fixture.demand,
    state: unbound,
    events: [fixture.event, event],
  }));

  const dropped = clone(state);
  dropped.evidence = [];
  assert.throws(() => validateDemandCoreStack({
    demand: fixture.demand,
    state: dropped,
    events: [fixture.event, event],
  }));

  const invalidInitial = clone(fixture.event);
  invalidInitial.changedArtifacts.push(event.changedArtifacts[0]);
  assert.throws(() => validateControllerEventRecord(invalidInitial));
});

test("strict readers reject any pending or corrupt state-transition journal", async () => {
  const { loadDemandCoreRecords } = await import(recordsModule);
  const fixture = makePublishedRoot();
  const loaded = loadDemandCoreRecords({ stateRoot: fixture.stateRoot, expectedProgramId: IDS.program });
  assert.deepEqual(loaded.demand, fixture.demand);
  assert.deepEqual(loaded.state, fixture.state);
  assert.deepEqual(loaded.events, [fixture.event]);
  assert.equal(loaded.authority, null);
  assert.throws(() => loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.programOther,
  }));

  const journal = path.join(fixture.stateRoot, "transactions", "state-transition.json");
  const transition = nextTransition(fixture);
  writeCanonical(journal, transitionJournal({ fixture, ...transition }));
  assert.throws(() => loadDemandCoreRecords({ stateRoot: fixture.stateRoot }));
  writeCanonical(journal, { artifactKind: "corrupt-untrusted-journal" });
  assert.throws(() => loadDemandCoreRecords({ stateRoot: fixture.stateRoot }));
});

test("archive recovery loader admits only transactions/archive.json and returns exact core bytes", async () => {
  const records = await import(recordsModule);
  const { withStateRootLock } = await import("../core/scripts/lib/wakeflow-state-lock.mjs");
  assert.equal(
    records.WAKEFLOW_DEMAND_ARCHIVE_TRANSACTION_FILE,
    "archive.json",
    "M2-T09 owns one exact archive transaction basename",
  );
  assert.equal(
    typeof records.loadDemandArchiveRecoveryRecordsWhileLocked,
    "function",
    "M2-T09 requires a locked archive-only recovery reader",
  );

  const fixture = makePublishedRoot();
  const journal = {
    schemaVersion: 1,
    artifactKind: "wakeflow-business-archive-transaction",
    demandId: IDS.demand,
    planDigest: `sha256:${"7".repeat(64)}`,
  };
  const journalFile = path.join(fixture.stateRoot, "transactions", "archive.json");
  writeCanonical(journalFile, journal);
  assert.throws(
    () => records.loadDemandCoreRecords({ stateRoot: fixture.stateRoot }),
    (error) => error?.code === "wakeflow-demand-core-transaction-residue",
  );

  const loaded = withStateRootLock(fixture.stateRoot, () => (
    records.loadDemandArchiveRecoveryRecordsWhileLocked({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
    })
  ));
  const expectedBytes = {
    demand: readFileSync(path.join(fixture.stateRoot, "demand.json")),
    authority: null,
    state: readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json")),
    events: readFileSync(path.join(fixture.stateRoot, "controller-events.jsonl")),
    journal: readFileSync(journalFile),
  };
  assert.deepEqual(loaded.journal, journal);
  assert.deepEqual(loaded.events, [fixture.event]);
  assert.deepEqual(loaded.bytes, expectedBytes);
  assert.deepEqual(loaded.byteDigests, {
    demand: byteDigest(expectedBytes.demand).slice("sha256:".length),
    authority: null,
    state: byteDigest(expectedBytes.state).slice("sha256:".length),
    events: byteDigest(expectedBytes.events).slice("sha256:".length),
    journal: byteDigest(expectedBytes.journal).slice("sha256:".length),
  });
  assert.equal(loaded.digests.demand, digest(fixture.demand));
  assert.equal(loaded.digests.state, digest(fixture.state));
  assert.equal(loaded.digests.journal, digest(journal));
});

test("archive recovery loader rejects every non-exact or mixed transaction inventory", async () => {
  const records = await import(recordsModule);
  const { withStateRootLock } = await import("../core/scripts/lib/wakeflow-state-lock.mjs");
  assert.equal(typeof records.loadDemandArchiveRecoveryRecordsWhileLocked, "function");
  const journal = {
    schemaVersion: 1,
    artifactKind: "wakeflow-business-archive-transaction",
    demandId: IDS.demand,
    planDigest: `sha256:${"8".repeat(64)}`,
  };
  const inventories = [
    [["state-transition.json", journal]],
    [["archive.json.bak", journal]],
    [["archive.json", journal], ["unknown.json", journal]],
  ];
  for (const inventory of inventories) {
    const fixture = makePublishedRoot();
    for (const [basename, value] of inventory) {
      writeCanonical(path.join(fixture.stateRoot, "transactions", basename), value);
    }
    assert.throws(
      () => withStateRootLock(fixture.stateRoot, () => (
        records.loadDemandArchiveRecoveryRecordsWhileLocked({ stateRoot: fixture.stateRoot })
      )),
      (error) => error?.code === "wakeflow-demand-core-archive-recovery-journal",
    );
  }
});

test("strict readers reject non-canonical UTF-8 and reserved core atomic stages", async () => {
  const { loadDemandCoreRecords } = await import(recordsModule);

  const invalidUtf8 = makePublishedRoot();
  const event = clone(invalidUtf8.event);
  event.reason = "candidate replacement \ufffd octet";
  const state = stateRecord({ demand: invalidUtf8.demand, event });
  writeCanonical(path.join(invalidUtf8.stateRoot, "wakeflow-state.json"), state);
  const validEventBytes = Buffer.from(`${canonicalJson(event)}\n`, "utf8");
  const replacementBytes = Buffer.from("\ufffd", "utf8");
  const replacementOffset = validEventBytes.indexOf(replacementBytes);
  assert.notEqual(replacementOffset, -1);
  const invalidEventBytes = Buffer.concat([
    validEventBytes.subarray(0, replacementOffset),
    Buffer.from([0xff]),
    validEventBytes.subarray(replacementOffset + replacementBytes.length),
  ]);
  writeFileSync(
    path.join(invalidUtf8.stateRoot, "controller-events.jsonl"),
    invalidEventBytes,
  );
  assert.throws(() => loadDemandCoreRecords({ stateRoot: invalidUtf8.stateRoot }));

  const staged = makePublishedRoot();
  const stageFile = path.join(
    staged.stateRoot,
    ".wakeflow-state.json.wakeflow-stage-99999999-residue",
  );
  writeFileSync(stageFile, "private interrupted stage\n", { mode: 0o600 });
  assert.throws(
    () => loadDemandCoreRecords({ stateRoot: staged.stateRoot }),
    (error) => error?.code === "wakeflow-demand-core-stage-residue",
  );
});

test("ordinary strict readers serialize with state writers on the state-root lock", async () => {
  const { loadDemandCoreRecords } = await import(recordsModule);
  const fixture = makePublishedRoot();
  const holder = await startStateLockHolder(fixture.stateRoot);
  const startedAt = Date.now();
  const loaded = loadDemandCoreRecords({ stateRoot: fixture.stateRoot });
  const elapsedMs = Date.now() - startedAt;
  const [exitCode] = await holder.exitPromise;
  assert.equal(exitCode, 0);
  assert.equal(loaded.state.revision, 1);
  assert.ok(elapsedMs >= 150, `reader returned after ${elapsedMs}ms without sharing the writer lock`);
});

test("authority freeze is one transaction and create-once bytes cannot be widened", async () => {
  const { loadDemandCoreRecords } = await import(recordsModule);
  const { freezeDemandAuthority } = await import(stateServiceModule);
  const fixture = makePublishedRoot();
  const { ledgerRoot, authorityRefs } = await makeAuthorityLedger();
  const authority = authorityRecord(fixture.demand, { authorityRefs });
  const authorityDigest = digest(authority);
  const event = controllerEvent({
    eventId: "event-authority-0002",
    createdAt: UPDATED_AT,
    command: "freeze-authority",
    type: "authority.frozen",
    previousRevision: 1,
    nextRevision: 2,
    from: "intake",
    to: "intake",
    reason: "proportional demand authority frozen",
    decisionSummary: "Use the exact requirement ledger member and bounded test decision.",
    changedArtifacts: [changedArtifact(
      "wakeflow-demand-authority",
      "demand-authority.json",
      authorityDigest,
    )],
  });
  const nextState = stateRecord({
    demand: fixture.demand,
    authority,
    event,
    revision: 2,
    state: "intake",
    stateReason: event.reason,
    updatedAt: UPDATED_AT,
  });
  freezeDemandAuthority({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot,
    expectedPrevious: { revision: 1, stateDigest: digest(fixture.state) },
    authority,
    event,
    nextState,
  });

  const authorityFile = path.join(fixture.stateRoot, "demand-authority.json");
  const frozenBytes = readFileSync(authorityFile);
  const loaded = loadDemandCoreRecords({ stateRoot: fixture.stateRoot, ledgerRoot });
  assert.deepEqual(loaded.authority, authority);
  assert.deepEqual(loaded.state, nextState);
  assert.deepEqual(loaded.events, [fixture.event, event]);
  assert.deepEqual(readdirSync(path.join(fixture.stateRoot, "transactions")), []);

  const duplicate = freezeDemandAuthority({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot,
    expectedPrevious: { revision: 1, stateDigest: digest(fixture.state) },
    authority,
    event,
    nextState,
  });
  assert.equal(duplicate.created, false);
  assert.deepEqual(readFileSync(authorityFile), frozenBytes);

  const differentEvent = clone(event);
  differentEvent.eventId = "event-authority-different-intent-0002";
  assert.throws(
    () => freezeDemandAuthority({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot,
      expectedPrevious: { revision: 1, stateDigest: digest(fixture.state) },
      authority,
      event: differentEvent,
      nextState,
    }),
    (error) => error?.code === "wakeflow-demand-state-authority-conflict",
  );

  const differentNextState = clone(nextState);
  differentNextState.stateReason = "A different historical state intent.";
  assert.throws(
    () => freezeDemandAuthority({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot,
      expectedPrevious: { revision: 1, stateDigest: digest(fixture.state) },
      authority,
      event,
      nextState: differentNextState,
    }),
    (error) => error?.code === "wakeflow-demand-state-authority-conflict",
  );

  const widened = clone(authority);
  widened.testDecision.summary = "Widened after freeze.";
  const beforeState = readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json"));
  const beforeEvents = readFileSync(path.join(fixture.stateRoot, "controller-events.jsonl"));
  assert.throws(() => freezeDemandAuthority({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot,
    expectedPrevious: { revision: 2, stateDigest: digest(nextState) },
    authority: widened,
    event,
    nextState,
  }));
  assert.deepEqual(readFileSync(authorityFile), frozenBytes);
  assert.deepEqual(readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json")), beforeState);
  assert.deepEqual(readFileSync(path.join(fixture.stateRoot, "controller-events.jsonl")), beforeEvents);

  const orphanEvidenceRoot = path.join(
    fixture.stateRoot,
    "evidence",
    "evidence_abababab-abab-4bab-8bab-abababababab",
  );
  mkdirSync(orphanEvidenceRoot, { mode: 0o700 });
  const beforeClosureReplayState = readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json"));
  const beforeClosureReplayEvents = readFileSync(path.join(fixture.stateRoot, "controller-events.jsonl"));
  assert.throws(
    () => freezeDemandAuthority({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot,
      expectedPrevious: { revision: 1, stateDigest: digest(fixture.state) },
      authority,
      event,
      nextState,
    }),
    (error) => error?.code === "wakeflow-demand-state-evidence-inventory",
  );
  assert.deepEqual(
    readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json")),
    beforeClosureReplayState,
  );
  assert.deepEqual(
    readFileSync(path.join(fixture.stateRoot, "controller-events.jsonl")),
    beforeClosureReplayEvents,
  );
  assert.deepEqual(readdirSync(path.join(fixture.stateRoot, "transactions")), []);
});

test("concurrent exact authority freeze yields one create and one original-intent replay", async () => {
  const { loadDemandCoreRecords } = await import(recordsModule);
  const fixture = makePublishedRoot();
  const { ledgerRoot, authorityRefs } = await makeAuthorityLedger();
  const authority = authorityRecord(fixture.demand, { authorityRefs });
  const event = controllerEvent({
    eventId: "event-authority-concurrent-0002",
    createdAt: UPDATED_AT,
    command: "freeze-authority",
    type: "authority.frozen",
    previousRevision: 1,
    nextRevision: 2,
    from: "intake",
    to: "intake",
    reason: "freeze one exact authority intent concurrently",
    decisionSummary: "Only one writer creates bytes; the loser proves the same original intent.",
    changedArtifacts: [changedArtifact(
      "wakeflow-demand-authority",
      "demand-authority.json",
      digest(authority),
    )],
  });
  const nextState = stateRecord({
    demand: fixture.demand,
    authority,
    event,
    revision: 2,
    state: "intake",
    stateReason: event.reason,
    updatedAt: UPDATED_AT,
  });
  const args = {
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot,
    expectedPrevious: { revision: 1, stateDigest: digest(fixture.state) },
    authority,
    event,
    nextState,
  };
  const attempts = await Promise.all([runAuthorityChild(args), runAuthorityChild(args)]);
  assert.deepEqual(attempts.map((entry) => entry.code), [0, 0], attempts.map((entry) => entry.stderr).join("\n"));
  assert.deepEqual(attempts.map((entry) => entry.payload.created).sort(), [false, true]);
  const loaded = loadDemandCoreRecords({ stateRoot: fixture.stateRoot, ledgerRoot });
  assert.equal(loaded.state.revision, 2);
  assert.deepEqual(loaded.events, [fixture.event, event]);
  assert.deepEqual(readdirSync(path.join(fixture.stateRoot, "transactions")), []);
});

test("state writers reject a duplicate event ID before creating any transition residue", async () => {
  const { commitDemandStateTransition } = await import(stateServiceModule);
  const fixture = makePublishedRoot();
  const duplicate = nextTransition(fixture, { eventId: fixture.event.eventId });
  const beforeState = readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json"));
  const beforeEvents = readFileSync(path.join(fixture.stateRoot, "controller-events.jsonl"));
  assert.throws(() => commitDemandStateTransition({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    expectedPrevious: { revision: 1, stateDigest: digest(fixture.state) },
    event: duplicate.event,
    nextState: duplicate.nextState,
  }));
  assert.deepEqual(readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json")), beforeState);
  assert.deepEqual(readFileSync(path.join(fixture.stateRoot, "controller-events.jsonl")), beforeEvents);
  assert.deepEqual(readdirSync(path.join(fixture.stateRoot, "transactions")), []);
});

test("demand core codecs and state owner routing reject accessors without executing them", async () => {
  const {
    validateDemandRecord,
  } = await import(recordsModule);
  const {
    commitDemandStateTransition,
  } = await import(stateServiceModule);
  let getterCalls = 0;
  const accessorDemand = demandRecord();
  Object.defineProperty(accessorDemand, "title", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "forged title";
    },
  });
  assert.throws(
    () => validateDemandRecord(accessorDemand),
    (error) => error?.code === "wakeflow-demand-core-data",
  );
  assert.equal(getterCalls, 0);

  const fixture = makePublishedRoot();
  const transition = nextTransition(fixture, { eventId: "event-accessor-safe-0002" });
  const accessorEvent = { ...transition.event };
  Object.defineProperty(accessorEvent, "command", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "continue-demand";
    },
  });
  assert.throws(
    () => commitDemandStateTransition({ event: accessorEvent }),
    (error) => error?.code === "wakeflow-demand-state-event",
  );
  const accessorPrevious = { stateDigest: digest(fixture.state) };
  Object.defineProperty(accessorPrevious, "revision", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 1;
    },
  });
  assert.throws(
    () => commitDemandStateTransition({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      expectedPrevious: accessorPrevious,
      event: transition.event,
      nextState: transition.nextState,
    }),
    (error) => error?.code === "wakeflow-demand-state-expected-previous",
  );
  assert.equal(getterCalls, 0);
  assert.deepEqual(readdirSync(path.join(fixture.stateRoot, "transactions")), []);
});

test("generic state transactions cannot alias lifecycle, review, or business archive ownership", async () => {
  const {
    validateControllerEventRecord,
    validateStateTransitionRecord,
  } = await import(recordsModule);
  const { commitDemandStateTransition } = await import(stateServiceModule);
  const fixture = makePublishedRoot();
  const terminalAlias = controllerEvent({
    eventId: "event-terminal-alias-0002",
    createdAt: UPDATED_AT,
    command: "finish-demand-alias",
    type: "state.transitioned",
    previousRevision: 1,
    nextRevision: 2,
    from: "intake",
    to: "completed",
  });
  assert.throws(
    () => validateControllerEventRecord(terminalAlias),
    (error) => error?.code === "wakeflow-demand-core-lifecycle-event",
  );
  assert.throws(
    () => commitDemandStateTransition({ event: terminalAlias }),
    (error) => error?.code === "wakeflow-demand-state-lifecycle-owner",
  );

  const reviewAlias = controllerEvent({
    eventId: "event-review-wrong-owner-0002",
    createdAt: UPDATED_AT,
    command: "decide-review-candidate",
    type: "review.accepted",
    previousRevision: 1,
    nextRevision: 2,
    from: "intake",
    to: "intake",
  });
  reviewAlias.reviewDecision = {};
  assert.throws(
    () => commitDemandStateTransition({ event: reviewAlias }),
    (error) => error?.code === "wakeflow-demand-state-review-owner",
  );

  const archiveEvent = controllerEvent({
    eventId: "event-archive-wrong-owner-0002",
    createdAt: UPDATED_AT,
    command: "archive-demand",
    type: "demand.archived",
    previousRevision: 1,
    nextRevision: 2,
    from: "intake",
    to: "archived",
  });
  const archivedState = stateRecord({ demand: fixture.demand, event: archiveEvent, state: "archived" });
  assert.throws(
    () => commitDemandStateTransition({ event: archiveEvent }),
    (error) => error?.code === "wakeflow-demand-state-archive-owner",
  );
  assert.throws(
    () => validateStateTransitionRecord(
      transitionJournal({ fixture, event: archiveEvent, nextState: archivedState }),
      { demand: fixture.demand },
    ),
    (error) => error?.code === "wakeflow-demand-core-archive-owner",
  );
});

test("state snapshot closes active package ownership and review classification against target tasks", async () => {
  const { validateDemandStateRecord } = await import(recordsModule);
  const event = controllerEvent({
    eventId: "event-artifact-closure-0002",
    createdAt: UPDATED_AT,
    command: "continue-demand",
    type: "state.transitioned",
    previousRevision: 1,
    nextRevision: 2,
    from: "intake",
    to: "planned",
  });
  const taskPackageId = "task-package_10101010-1010-4010-8010-101010101010";
  const targetTaskId = "target-task_20202020-2020-4020-8020-202020202020";
  const state = stateRecord({ event, state: "planned" });
  state.taskPackages = [{
    taskPackageId,
    ref: `task-packages/${taskPackageId}.json`,
    digest: `sha256:${"1".repeat(64)}`,
    lifecycleStatus: "active",
  }];
  state.targetTasks = [{
    targetTaskId,
    taskPackageId,
    windowId: "window_30303030-3030-4030-8030-303030303030",
    lifecycleStatus: "planned",
  }];
  assert.equal(validateDemandStateRecord(state).targetTasks.length, 1);

  const retainedHistory = clone(state);
  retainedHistory.taskPackages.push({
    taskPackageId: "task-package_60606060-6060-4060-8060-606060606060",
    ref: "task-packages/task-package_60606060-6060-4060-8060-606060606060.json",
    digest: `sha256:${"3".repeat(64)}`,
    lifecycleStatus: "closed",
  });
  assert.equal(validateDemandStateRecord(retainedHistory).taskPackages.length, 2);

  const unselectedActive = clone(retainedHistory);
  unselectedActive.taskPackages[1].lifecycleStatus = "active";
  assert.throws(
    () => validateDemandStateRecord(unselectedActive),
    (error) => error?.code === "wakeflow-demand-core-artifact-state",
  );

  const duplicateOwner = clone(state);
  duplicateOwner.targetTasks.push({
    ...duplicateOwner.targetTasks[0],
    targetTaskId: "target-task_40404040-4040-4040-8040-404040404040",
  });
  assert.throws(
    () => validateDemandStateRecord(duplicateOwner),
    (error) => error?.code === "wakeflow-demand-core-artifact-state",
  );

  const mismatchedReview = clone(state);
  mismatchedReview.review = {
    status: "pending",
    readyTargetTaskIds: [targetTaskId],
    blockedTargetTaskIds: [],
    missingTargetTaskIds: [],
    pendingCandidate: {
      reviewCandidateId: "review-candidate_50505050-5050-4050-8050-505050505050",
      ref: "review-candidates/review-candidate_50505050-5050-4050-8050-505050505050.json",
      digest: `sha256:${"2".repeat(64)}`,
    },
  };
  assert.throws(
    () => validateDemandStateRecord(mismatchedReview),
    (error) => error?.code === "wakeflow-demand-core-artifact-state",
  );
});

test("complete/cancel events are owned only by the dedicated lifecycle commit seam", async () => {
  const {
    commitDemandLifecycleTransitionWhileLocked,
    commitDemandStateTransition,
    loadDemandCoreRecordsWithArtifactClosure,
  } = await import(stateServiceModule);
  const { withStateRootLock } = await import(stateLockUrl.href);
  const fixture = makePublishedRoot();
  const event = {
    ...controllerEvent({
      eventId: "event-lifecycle-complete-0002",
      createdAt: UPDATED_AT,
      command: "complete-demand",
      type: "demand.completed",
      previousRevision: 1,
      nextRevision: 2,
      from: "intake",
      to: "completed",
      reason: "close the exact zero-task lifecycle fixture",
      decisionSummary: "No task, review, delivery, or result authority remains open.",
    }),
    lifecycleTransition: { action: "complete" },
  };
  const nextState = stateRecord({
    demand: fixture.demand,
    event,
    state: "completed",
  });
  assert.throws(
    () => commitDemandStateTransition({ event }),
    (error) => error?.code === "wakeflow-demand-state-lifecycle-owner",
  );
  assert.throws(
    () => commitDemandLifecycleTransitionWhileLocked({ event: {
      ...event,
      command: "continue-demand",
      lifecycleTransition: { action: "complete" },
    } }),
    (error) => error?.code === "wakeflow-demand-state-lifecycle-owner",
  );
  withStateRootLock(fixture.stateRoot, () => commitDemandLifecycleTransitionWhileLocked({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    expectedPrevious: { revision: 1, stateDigest: digest(fixture.state) },
    event,
    nextState,
  }));
  const loaded = loadDemandCoreRecordsWithArtifactClosure({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
  });
  assert.deepEqual(loaded.events, [fixture.event, event]);
  assert.deepEqual(loaded.state, nextState);
  assert.deepEqual(readdirSync(path.join(fixture.stateRoot, "transactions")), []);
});

test("lifecycle recovery owns every existing journal boundary and generic recovery refuses it", async () => {
  const {
    recoverDemandLifecycleTransitionWhileLocked,
    recoverDemandStateTransition,
  } = await import(stateServiceModule);
  const { loadDemandCoreRecords } = await import(recordsModule);
  const { withStateRootLock } = await import(stateLockUrl.href);
  for (const boundary of ["journal-only", "event-written", "state-written"]) {
    const fixture = makePublishedRoot();
    const event = {
      ...controllerEvent({
        eventId: `event-lifecycle-cancel-${boundary}-0002`,
        createdAt: UPDATED_AT,
        command: "cancel-demand",
        type: "demand.cancelled",
        previousRevision: 1,
        nextRevision: 2,
        from: "intake",
        to: "cancelled",
        reason: `recover the exact ${boundary} cancellation`,
        decisionSummary: "Close only the current lifecycle authority and preserve immutable facts.",
      }),
      lifecycleTransition: { action: "cancel" },
    };
    const nextState = stateRecord({ demand: fixture.demand, event, state: "cancelled" });
    const journal = transitionJournal({ fixture, event, nextState });
    writeCanonical(path.join(fixture.stateRoot, "transactions", "state-transition.json"), journal);
    if (boundary !== "journal-only") {
      writeFileSync(
        path.join(fixture.stateRoot, "controller-events.jsonl"),
        `${canonicalJson(fixture.event)}\n${canonicalJson(event)}\n`,
      );
    }
    if (boundary === "state-written") {
      writeCanonical(path.join(fixture.stateRoot, "wakeflow-state.json"), nextState);
    }
    assert.throws(
      () => recoverDemandStateTransition({
        stateRoot: fixture.stateRoot,
        expectedProgramId: IDS.program,
      }),
      (error) => error?.code === "wakeflow-demand-state-recovery-conflict",
    );
    let admissionCalls = 0;
    const result = withStateRootLock(fixture.stateRoot, () => (
      recoverDemandLifecycleTransitionWhileLocked({
        stateRoot: fixture.stateRoot,
        expectedProgramId: IDS.program,
        admitRecoveryWhileLocked({ lifecycleTransition }) {
          admissionCalls += 1;
          assert.deepEqual(lifecycleTransition, { action: "cancel" });
          return { admitted: true };
        },
      })
    ));
    assert.equal(result.status, "recovered", boundary);
    assert.equal(admissionCalls, 1, boundary);
    const loaded = loadDemandCoreRecords({ stateRoot: fixture.stateRoot });
    assert.deepEqual(loaded.events, [fixture.event, event], boundary);
    assert.deepEqual(loaded.state, nextState, boundary);
  }

  const accessorFixture = makePublishedRoot();
  const accessorEvent = {
    ...controllerEvent({
      eventId: "event-lifecycle-accessor-admission-0002",
      createdAt: UPDATED_AT,
      command: "cancel-demand",
      type: "demand.cancelled",
      previousRevision: 1,
      nextRevision: 2,
      from: "intake",
      to: "cancelled",
    }),
    lifecycleTransition: { action: "cancel" },
  };
  const accessorNextState = stateRecord({
    demand: accessorFixture.demand,
    event: accessorEvent,
    state: "cancelled",
  });
  writeCanonical(
    path.join(accessorFixture.stateRoot, "transactions", "state-transition.json"),
    transitionJournal({
      fixture: accessorFixture,
      event: accessorEvent,
      nextState: accessorNextState,
    }),
  );
  let getterCalls = 0;
  assert.throws(
    () => withStateRootLock(accessorFixture.stateRoot, () => (
      recoverDemandLifecycleTransitionWhileLocked({
        stateRoot: accessorFixture.stateRoot,
        expectedProgramId: IDS.program,
        admitRecoveryWhileLocked() {
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
      })
    )),
    (error) => error?.code === "wakeflow-demand-state-recovery-conflict",
  );
  assert.equal(getterCalls, 0);
  assert.equal(
    existsSync(path.join(accessorFixture.stateRoot, "transactions", "state-transition.json")),
    true,
  );
});

test("state writers prove committed evidence closure before reporting a stale CAS", async () => {
  const { commitDemandStateTransition } = await import(stateServiceModule);
  const fixture = makePublishedRoot();
  const transition = nextTransition(fixture, { eventId: "event-broken-closure-stale-0002" });
  mkdirSync(path.join(
    fixture.stateRoot,
    "evidence",
    "evidence_acacacac-acac-4cac-8cac-acacacacacac",
  ), { mode: 0o700 });
  const beforeState = readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json"));
  const beforeEvents = readFileSync(path.join(fixture.stateRoot, "controller-events.jsonl"));
  assert.throws(
    () => commitDemandStateTransition({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      expectedPrevious: { revision: 999, stateDigest: `sha256:${"f".repeat(64)}` },
      event: transition.event,
      nextState: transition.nextState,
    }),
    (error) => error?.code === "wakeflow-demand-state-evidence-inventory",
  );
  assert.deepEqual(readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json")), beforeState);
  assert.deepEqual(readFileSync(path.join(fixture.stateRoot, "controller-events.jsonl")), beforeEvents);
  assert.deepEqual(readdirSync(path.join(fixture.stateRoot, "transactions")), []);
});

test("state writers require the exact owning program before any mutation", async () => {
  const { commitDemandStateTransition, recoverDemandStateTransition } = await import(stateServiceModule);
  for (const expectedProgramId of [undefined, IDS.programOther]) {
    const fixture = makePublishedRoot();
    const transition = nextTransition(fixture, {
      eventId: `event-program-fence-${expectedProgramId ? "wrong" : "missing"}-0002`,
    });
    const beforeState = readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json"));
    const beforeEvents = readFileSync(path.join(fixture.stateRoot, "controller-events.jsonl"));
    assert.throws(() => commitDemandStateTransition({
      stateRoot: fixture.stateRoot,
      ...(expectedProgramId === undefined ? {} : { expectedProgramId }),
      expectedPrevious: { revision: 1, stateDigest: digest(fixture.state) },
      event: transition.event,
      nextState: transition.nextState,
    }));
    assert.deepEqual(readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json")), beforeState);
    assert.deepEqual(readFileSync(path.join(fixture.stateRoot, "controller-events.jsonl")), beforeEvents);
    assert.deepEqual(readdirSync(path.join(fixture.stateRoot, "transactions")), []);
  }

  const recoveryFixture = makePublishedRoot();
  assert.throws(() => recoverDemandStateTransition({ stateRoot: recoveryFixture.stateRoot }));
  assert.deepEqual(readdirSync(path.join(recoveryFixture.stateRoot, "transactions")), []);
});

test("concurrent transitions use previous revision plus state digest CAS and leave no journal", async () => {
  const { loadDemandCoreRecords } = await import(recordsModule);
  const fixture = makePublishedRoot();
  const left = nextTransition(fixture, {
    eventId: "event-race-left-0002",
    decisionSummary: "Left concurrent candidate.",
  });
  const right = nextTransition(fixture, {
    eventId: "event-race-right-0002",
    decisionSummary: "Right concurrent candidate.",
  });
  const expectedPrevious = { revision: 1, stateDigest: digest(fixture.state) };
  const results = await Promise.all([left, right].map(({ event, nextState }) => runTransitionChild({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    expectedPrevious,
    event,
    nextState,
  })));
  assert.deepEqual(results.map((result) => result.code).sort(), [0, 2], JSON.stringify(results));

  const loaded = loadDemandCoreRecords({ stateRoot: fixture.stateRoot });
  assert.equal(loaded.state.revision, 2);
  assert.equal(loaded.events.length, 2);
  assert.equal(loaded.state.lastEvent.eventId, loaded.events.at(-1).eventId);
  assert.equal(loaded.state.lastEvent.eventDigest, digest(loaded.events.at(-1)));
  assert.deepEqual(readdirSync(path.join(fixture.stateRoot, "transactions")), []);
  assert.deepEqual(JSON.parse(readFileSync(path.join(fixture.stateRoot, "demand.json"), "utf8")), fixture.demand);
});

test("explicit recovery completes only the exact journal across every T04 durable boundary", async () => {
  const { loadDemandCoreRecords } = await import(recordsModule);
  const { recoverDemandStateTransition } = await import(stateServiceModule);

  for (const boundary of ["journal-only", "event-written", "state-written"]) {
    const fixture = makePublishedRoot();
    const transition = nextTransition(fixture, {
      eventId: `event-recovery-${boundary}-0002`,
      reason: `recover exact ${boundary} transition`,
    });
    const journal = transitionJournal({ fixture, ...transition });
    writeCanonical(path.join(fixture.stateRoot, "transactions", "state-transition.json"), journal);
    if (boundary !== "journal-only") {
      writeFileSync(
        path.join(fixture.stateRoot, "controller-events.jsonl"),
        `${canonicalJson(fixture.event)}\n${canonicalJson(transition.event)}\n`,
      );
    }
    if (boundary === "state-written") {
      writeCanonical(path.join(fixture.stateRoot, "wakeflow-state.json"), transition.nextState);
    }
    const recovered = recoverDemandStateTransition({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
    });
    assert.equal(recovered.status, "recovered", boundary);
    const loaded = loadDemandCoreRecords({ stateRoot: fixture.stateRoot });
    assert.deepEqual(loaded.events, [fixture.event, transition.event], boundary);
    assert.deepEqual(loaded.state, transition.nextState, boundary);
    assert.deepEqual(readdirSync(path.join(fixture.stateRoot, "transactions")), [], boundary);
  }

  const authorityFixture = makePublishedRoot();
  const { ledgerRoot, authorityRefs } = await makeAuthorityLedger();
  const authority = authorityRecord(authorityFixture.demand, { authorityRefs });
  const authorityDigest = digest(authority);
  const authorityEvent = controllerEvent({
    eventId: "event-recovery-authority-0002",
    createdAt: UPDATED_AT,
    command: "freeze-authority",
    type: "authority.frozen",
    previousRevision: 1,
    nextRevision: 2,
    from: "intake",
    to: "intake",
    reason: "recover exact authority freeze",
    decisionSummary: "Recover only the already journaled authority bytes.",
    changedArtifacts: [changedArtifact(
      "wakeflow-demand-authority",
      "demand-authority.json",
      authorityDigest,
    )],
  });
  const authorityState = stateRecord({
    demand: authorityFixture.demand,
    authority,
    event: authorityEvent,
    revision: 2,
    state: "intake",
    stateReason: authorityEvent.reason,
    updatedAt: UPDATED_AT,
  });
  const artifactWrite = {
    artifactKind: "wakeflow-demand-authority",
    ref: "demand-authority.json",
    digest: authorityDigest,
    value: authority,
  };
  writeCanonical(
    path.join(authorityFixture.stateRoot, "transactions", "state-transition.json"),
    transitionJournal({
      fixture: authorityFixture,
      event: authorityEvent,
      nextState: authorityState,
      artifactWrites: [artifactWrite],
    }),
  );
  writeCanonical(path.join(authorityFixture.stateRoot, "demand-authority.json"), authority);
  assert.equal(recoverDemandStateTransition({
    stateRoot: authorityFixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot,
  }).status, "recovered");
  assert.deepEqual(
    loadDemandCoreRecords({ stateRoot: authorityFixture.stateRoot, ledgerRoot }).authority,
    authority,
  );

  const conflictFixture = makePublishedRoot();
  const intended = nextTransition(conflictFixture, { eventId: "event-intended-0002" });
  writeCanonical(
    path.join(conflictFixture.stateRoot, "transactions", "state-transition.json"),
    transitionJournal({ fixture: conflictFixture, ...intended }),
  );
  const competing = nextTransition(conflictFixture, { eventId: "event-competing-0002" });
  writeFileSync(
    path.join(conflictFixture.stateRoot, "controller-events.jsonl"),
    `${canonicalJson(conflictFixture.event)}\n${canonicalJson(competing.event)}\n`,
  );
  const beforeState = readFileSync(path.join(conflictFixture.stateRoot, "wakeflow-state.json"));
  assert.throws(
    () => recoverDemandStateTransition({
      stateRoot: conflictFixture.stateRoot,
      expectedProgramId: IDS.program,
    }),
    (error) => error?.code === "wakeflow-demand-state-recovery-conflict",
  );
  assert.deepEqual(readFileSync(path.join(conflictFixture.stateRoot, "wakeflow-state.json")), beforeState);
  assert.equal(
    existsSync(path.join(conflictFixture.stateRoot, "transactions", "state-transition.json")),
    true,
  );
});

test("authority recovery never recreates bytes after the freeze event is already visible", async () => {
  const { recoverDemandStateTransition } = await import(stateServiceModule);
  const fixture = makePublishedRoot();
  const { ledgerRoot, authorityRefs } = await makeAuthorityLedger();
  const authority = authorityRecord(fixture.demand, { authorityRefs });
  const authorityDigest = digest(authority);
  const event = controllerEvent({
    eventId: "event-authority-missing-after-event-0002",
    createdAt: UPDATED_AT,
    command: "freeze-authority",
    type: "authority.frozen",
    previousRevision: 1,
    nextRevision: 2,
    from: "intake",
    to: "intake",
    reason: "do not mask an authority deletion after event publication",
    decisionSummary: "Recovery must preserve the conflict rather than recreating authority bytes.",
    changedArtifacts: [changedArtifact(
      "wakeflow-demand-authority",
      "demand-authority.json",
      authorityDigest,
    )],
  });
  const nextState = stateRecord({
    demand: fixture.demand,
    authority,
    event,
    revision: 2,
    state: "intake",
    stateReason: event.reason,
    updatedAt: UPDATED_AT,
  });
  const journalFile = path.join(fixture.stateRoot, "transactions/state-transition.json");
  writeCanonical(journalFile, transitionJournal({
    fixture,
    event,
    nextState,
    artifactWrites: [{
      artifactKind: "wakeflow-demand-authority",
      ref: "demand-authority.json",
      digest: authorityDigest,
      value: authority,
    }],
  }));
  writeFileSync(
    path.join(fixture.stateRoot, "controller-events.jsonl"),
    `${canonicalJson(fixture.event)}\n${canonicalJson(event)}\n`,
    { mode: 0o600 },
  );

  assert.throws(
    () => recoverDemandStateTransition({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot,
    }),
    (error) => error?.code === "wakeflow-demand-state-recovery-conflict",
  );
  assert.equal(existsSync(path.join(fixture.stateRoot, "demand-authority.json")), false);
  assert.equal(existsSync(journalFile), true);
  assert.equal(
    JSON.parse(readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json"), "utf8")).revision,
    1,
  );
});

test("recovery rejects unsafe or conflicting residue and never substitutes new intent", async () => {
  const { recoverDemandStateTransition } = await import(stateServiceModule);

  const clean = makePublishedRoot();
  assert.deepEqual(recoverDemandStateTransition({
    stateRoot: clean.stateRoot,
    expectedProgramId: IDS.program,
  }), {
    status: "none",
    demandId: IDS.demand,
    revision: 1,
  });

  const duplicateEventFixture = makePublishedRoot();
  const duplicateEventTransition = nextTransition(duplicateEventFixture, {
    eventId: duplicateEventFixture.event.eventId,
  });
  writeCanonical(
    path.join(duplicateEventFixture.stateRoot, "transactions", "state-transition.json"),
    transitionJournal({ fixture: duplicateEventFixture, ...duplicateEventTransition }),
  );
  const duplicateState = readFileSync(path.join(duplicateEventFixture.stateRoot, "wakeflow-state.json"));
  const duplicateEvents = readFileSync(path.join(duplicateEventFixture.stateRoot, "controller-events.jsonl"));
  assert.throws(
    () => recoverDemandStateTransition({
      stateRoot: duplicateEventFixture.stateRoot,
      expectedProgramId: IDS.program,
    }),
    (error) => error?.code === "wakeflow-demand-state-recovery-conflict",
  );
  assert.deepEqual(
    readFileSync(path.join(duplicateEventFixture.stateRoot, "wakeflow-state.json")),
    duplicateState,
  );
  assert.deepEqual(
    readFileSync(path.join(duplicateEventFixture.stateRoot, "controller-events.jsonl")),
    duplicateEvents,
  );

  const forgedPrevious = makePublishedRoot();
  const forgedTransition = nextTransition(forgedPrevious, {
    eventId: "event-forged-previous-digest-0002",
  });
  const forgedJournal = transitionJournal({ fixture: forgedPrevious, ...forgedTransition });
  forgedJournal.expectedPreviousStateDigest = `sha256:${"f".repeat(64)}`;
  writeCanonical(
    path.join(forgedPrevious.stateRoot, "transactions", "state-transition.json"),
    forgedJournal,
  );
  writeFileSync(
    path.join(forgedPrevious.stateRoot, "controller-events.jsonl"),
    `${canonicalJson(forgedPrevious.event)}\n${canonicalJson(forgedTransition.event)}\n`,
  );
  writeCanonical(
    path.join(forgedPrevious.stateRoot, "wakeflow-state.json"),
    forgedTransition.nextState,
  );
  assert.throws(
    () => recoverDemandStateTransition({
      stateRoot: forgedPrevious.stateRoot,
      expectedProgramId: IDS.program,
    }),
    (error) => error?.code === "wakeflow-demand-state-recovery-conflict",
  );
  assert.equal(
    existsSync(path.join(forgedPrevious.stateRoot, "transactions", "state-transition.json")),
    true,
  );

  const stagedRecovery = makePublishedRoot();
  const stagedTransition = nextTransition(stagedRecovery, {
    eventId: "event-staged-residue-0002",
  });
  writeCanonical(
    path.join(stagedRecovery.stateRoot, "transactions", "state-transition.json"),
    transitionJournal({ fixture: stagedRecovery, ...stagedTransition }),
  );
  const stagedResidue = path.join(
    stagedRecovery.stateRoot,
    ".controller-events.jsonl.wakeflow-stage-99999999-residue",
  );
  writeFileSync(stagedResidue, "interrupted event stage\n", { mode: 0o600 });
  const stagedState = readFileSync(path.join(stagedRecovery.stateRoot, "wakeflow-state.json"));
  const stagedEvents = readFileSync(path.join(stagedRecovery.stateRoot, "controller-events.jsonl"));
  assert.throws(
    () => recoverDemandStateTransition({
      stateRoot: stagedRecovery.stateRoot,
      expectedProgramId: IDS.program,
    }),
    (error) => error?.code === "wakeflow-demand-core-stage-residue",
  );
  assert.deepEqual(readFileSync(path.join(stagedRecovery.stateRoot, "wakeflow-state.json")), stagedState);
  assert.deepEqual(readFileSync(path.join(stagedRecovery.stateRoot, "controller-events.jsonl")), stagedEvents);
  assert.equal(existsSync(stagedResidue), true);
  assert.equal(
    existsSync(path.join(stagedRecovery.stateRoot, "transactions", "state-transition.json")),
    true,
  );

  const linked = makePublishedRoot();
  const linkedTransition = nextTransition(linked, { eventId: "event-linked-journal-0002" });
  const outside = path.join(linked.root, "outside-transition.json");
  writeCanonical(outside, transitionJournal({ fixture: linked, ...linkedTransition }));
  symlinkSync(outside, path.join(linked.stateRoot, "transactions", "state-transition.json"));
  const linkedState = readFileSync(path.join(linked.stateRoot, "wakeflow-state.json"));
  const linkedEvents = readFileSync(path.join(linked.stateRoot, "controller-events.jsonl"));
  assert.throws(
    () => recoverDemandStateTransition({
      stateRoot: linked.stateRoot,
      expectedProgramId: IDS.program,
    }),
    (error) => error?.code === "wakeflow-demand-state-recovery-unsafe",
  );
  assert.deepEqual(readFileSync(path.join(linked.stateRoot, "wakeflow-state.json")), linkedState);
  assert.deepEqual(readFileSync(path.join(linked.stateRoot, "controller-events.jsonl")), linkedEvents);

  const authorityFixture = makePublishedRoot();
  const { ledgerRoot, authorityRefs } = await makeAuthorityLedger();
  const intendedAuthority = authorityRecord(authorityFixture.demand, { authorityRefs });
  const intendedDigest = digest(intendedAuthority);
  const intendedEvent = controllerEvent({
    eventId: "event-authority-conflict-0002",
    createdAt: UPDATED_AT,
    command: "freeze-authority",
    type: "authority.frozen",
    previousRevision: 1,
    nextRevision: 2,
    from: "intake",
    to: "intake",
    reason: "freeze the journaled authority only",
    decisionSummary: "Do not adopt competing authority bytes.",
    changedArtifacts: [changedArtifact(
      "wakeflow-demand-authority",
      "demand-authority.json",
      intendedDigest,
    )],
  });
  const intendedState = stateRecord({
    demand: authorityFixture.demand,
    authority: intendedAuthority,
    event: intendedEvent,
    revision: 2,
    state: "intake",
    stateReason: intendedEvent.reason,
    updatedAt: UPDATED_AT,
  });
  writeCanonical(
    path.join(authorityFixture.stateRoot, "transactions", "state-transition.json"),
    transitionJournal({
      fixture: authorityFixture,
      event: intendedEvent,
      nextState: intendedState,
      artifactWrites: [{
        artifactKind: "wakeflow-demand-authority",
        ref: "demand-authority.json",
        digest: intendedDigest,
        value: intendedAuthority,
      }],
    }),
  );
  const competingAuthority = clone(intendedAuthority);
  competingAuthority.testDecision.summary = "Competing but structurally valid authority bytes.";
  writeCanonical(path.join(authorityFixture.stateRoot, "demand-authority.json"), competingAuthority);
  const beforeState = readFileSync(path.join(authorityFixture.stateRoot, "wakeflow-state.json"));
  const beforeEvents = readFileSync(path.join(authorityFixture.stateRoot, "controller-events.jsonl"));
  assert.throws(
    () => recoverDemandStateTransition({
      stateRoot: authorityFixture.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot,
    }),
    (error) => error?.code === "wakeflow-demand-state-recovery-conflict",
  );
  assert.deepEqual(readFileSync(path.join(authorityFixture.stateRoot, "wakeflow-state.json")), beforeState);
  assert.deepEqual(readFileSync(path.join(authorityFixture.stateRoot, "controller-events.jsonl")), beforeEvents);
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(authorityFixture.stateRoot, "demand-authority.json"), "utf8")),
    competingAuthority,
  );

  const undeclaredFixture = makePublishedRoot();
  const undeclaredTransition = nextTransition(undeclaredFixture, {
    eventId: "event-undeclared-authority-0002",
  });
  writeCanonical(
    path.join(undeclaredFixture.stateRoot, "transactions", "state-transition.json"),
    transitionJournal({ fixture: undeclaredFixture, ...undeclaredTransition }),
  );
  writeCanonical(
    path.join(undeclaredFixture.stateRoot, "demand-authority.json"),
    intendedAuthority,
  );
  const undeclaredState = readFileSync(path.join(undeclaredFixture.stateRoot, "wakeflow-state.json"));
  const undeclaredEvents = readFileSync(path.join(undeclaredFixture.stateRoot, "controller-events.jsonl"));
  assert.throws(
    () => recoverDemandStateTransition({
      stateRoot: undeclaredFixture.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot,
    }),
    (error) => error?.code === "wakeflow-demand-state-recovery-conflict",
  );
  assert.deepEqual(
    readFileSync(path.join(undeclaredFixture.stateRoot, "wakeflow-state.json")),
    undeclaredState,
  );
  assert.deepEqual(
    readFileSync(path.join(undeclaredFixture.stateRoot, "controller-events.jsonl")),
    undeclaredEvents,
  );
});

test("v3 demand owners are exact while retired public-v2 entrypoints remain isolated", async () => {
  const { WAKEFLOW_ID_TYPES } = await import("../core/scripts/lib/wakeflow-identifiers.mjs");
  const { WAKEFLOW_DEMAND_STATES } = await import(recordsModule);
  assert.deepEqual(WAKEFLOW_ID_TYPES, [
    "archive",
    "confirmation",
    "demand",
    "delivery",
    "delivery-run",
    "dispatch-group",
    "dispatch-packet",
    "evidence",
    "pod",
    "pod-design-handoff",
    "pod-design-request",
    "program",
    "preservation",
    "repository",
    "requirement",
    "review-candidate",
    "surface",
    "target-result",
    "target-task",
    "task-package",
    "test-attempt",
    "test-card",
    "window",
  ]);
  const publicStateSchema = JSON.parse(readFileSync(
    path.join(repositoryRoot, "core/schemas/wakeflow-state-machine/wakeflow-state.schema.json"),
    "utf8",
  ));
  assert.deepEqual(WAKEFLOW_DEMAND_STATES, publicStateSchema.properties.state.enum);

  const candidateFiles = [
    "core/scripts/lib/wakeflow-active-identity-lock.mjs",
    "core/scripts/lib/wakeflow-active-projection-lock.mjs",
    "core/scripts/lib/wakeflow-active-projector.mjs",
    "core/scripts/lib/wakeflow-business-archive-records.mjs",
    "core/scripts/lib/wakeflow-business-archive-service.mjs",
    "core/scripts/lib/wakeflow-config-v3-snapshot.mjs",
    "core/scripts/lib/wakeflow-delivery-orchestration.mjs",
    "core/scripts/lib/wakeflow-demand-core-records.mjs",
    "core/scripts/lib/wakeflow-demand-document-builder.mjs",
    "core/scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
    "core/scripts/lib/wakeflow-demand-publication-service.mjs",
    "core/scripts/lib/wakeflow-demand-state-service.mjs",
    "core/scripts/lib/wakeflow-evidence-importer.mjs",
    "core/scripts/lib/wakeflow-legacy-archive-transform.mjs",
    "core/scripts/lib/wakeflow-preservation.mjs",
    "core/scripts/lib/wakeflow-target-result-authority.mjs",
    "core/scripts/lib/wakeflow-window-binding-records.mjs",
    "core/scripts/lib/wakeflow-window-binding-service.mjs",
    "core/scripts/lib/wakeflow-window-runtime-projector.mjs",
    "core/scripts/lib/wakeflow-window-runtime-records.mjs",
  ];
  for (const relativeFile of candidateFiles) {
    const file = path.join(repositoryRoot, relativeFile);
    assert.equal(existsSync(file), true, `${relativeFile} is the admitted candidate module`);
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /from\s+["'][^"']*wakeflow-config\.mjs["']/u);
    assert.doesNotMatch(source, /from\s+["'][^"']*wakeflow-state\.mjs["']/u);
    assert.doesNotMatch(source, /from\s+["'][^"']*wakeflow-dispatch-commands\.mjs["']/u);
  }

  const retiredV2Files = [
    "core/scripts/wakeflow-demand-sequence.mjs",
    "core/scripts/wakeflow-render-progress.mjs",
    "core/scripts/wakeflow-state.mjs",
    "core/scripts/lib/wakeflow-active-demands.mjs",
    "core/scripts/lib/wakeflow-controller-events.mjs",
    "core/scripts/lib/wakeflow-demand-authority.mjs",
    "core/scripts/lib/wakeflow-state-transition.mjs",
    "core/scripts/lib/wakeflow-window-runtime.mjs",
    "core/scripts/lib/wakeflow-mainline-health.mjs",
    "core/scripts/lib/wakeflow-dispatch-commands.mjs",
    "core/scripts/wakeflow-delivery.mjs",
  ];
  for (const relativeFile of retiredV2Files) {
    assert.equal(existsSync(path.join(repositoryRoot, relativeFile)), false, relativeFile);
  }

  const scanRoots = [
    "core",
    "plugins/codex-wakeflow",
    "plugins/claude-code-wakeflow",
  ].map((relativeRoot) => path.join(repositoryRoot, relativeRoot));
  const productionModules = scanRoots.flatMap(listModuleFiles);
  const importersOf = (basename) => {
    const escaped = basename.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const staticImport = new RegExp(`from\\s+["'][^"']*${escaped}["']`, "u");
    return productionModules
      .filter((file) => staticImport.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(repositoryRoot, file))
      .sort();
  };
  const expectedRecordsImporters = [
    "core/scripts/lib/wakeflow-active-projector.mjs",
    "core/scripts/lib/wakeflow-business-archive-records.mjs",
    "core/scripts/lib/wakeflow-business-archive-service.mjs",
    "core/scripts/lib/wakeflow-delivery-orchestration.mjs",
    "core/scripts/lib/wakeflow-demand-artifact-service.mjs",
    "core/scripts/lib/wakeflow-demand-document-builder.mjs",
    "core/scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
    "core/scripts/lib/wakeflow-demand-publication-service.mjs",
    "core/scripts/lib/wakeflow-demand-state-service.mjs",
    "core/scripts/lib/wakeflow-evidence-importer.mjs",
    "core/scripts/lib/wakeflow-pod-service.mjs",
    "core/scripts/lib/wakeflow-result-review-orchestration.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-active-projector.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-business-archive-records.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-business-archive-service.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-delivery-orchestration.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-demand-document-builder.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-demand-publication-service.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-demand-state-service.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-evidence-importer.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-pod-service.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-result-review-orchestration.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-demand-artifact-service.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-active-projector.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-business-archive-records.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-business-archive-service.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-delivery-orchestration.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-demand-document-builder.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-demand-publication-service.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-demand-state-service.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-evidence-importer.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-pod-service.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-result-review-orchestration.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-demand-artifact-service.mjs",
  ].filter((relativeFile) => existsSync(path.join(repositoryRoot, relativeFile))).sort();
  assert.deepEqual(
    importersOf("wakeflow-demand-core-records.mjs"),
    expectedRecordsImporters,
    "the only production ingress to candidate records is an admitted candidate service or pure builder",
  );
  assert.deepEqual(importersOf("wakeflow-active-projector.mjs"), [
    "core/scripts/lib/wakeflow-fresh-initialize.mjs",
    "core/scripts/lib/wakeflow-maintenance-action-runtime.mjs",
    "core/scripts/lib/wakeflow-migration-production.mjs",
    "core/scripts/lib/wakeflow-observability-v3.mjs",
    "core/scripts/lib/wakeflow-public-v3-runtime.mjs",
    "core/scripts/lib/wakeflow-reconcile.mjs",
    "core/scripts/lib/wakeflow-reconfigure.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-fresh-initialize.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-maintenance-action-runtime.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-migration-production.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-observability-v3.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-public-v3-runtime.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-reconcile.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-reconfigure.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-fresh-initialize.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-maintenance-action-runtime.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-migration-production.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-observability-v3.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-public-v3-runtime.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-reconcile.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-reconfigure.mjs",
  ].filter((relativeFile) => existsSync(path.join(repositoryRoot, relativeFile))).sort(),
  "only admitted candidate lifecycle and observability services may consume the active projector before M6");
  assert.deepEqual(importersOf("wakeflow-config-v3-snapshot.mjs"), [
    "core/lib/wakeflow-mcp-tools.mjs",
    "core/lib/wakeflow-mcp-tools-v3-candidate.mjs",
    "core/scripts/lib/wakeflow-active-projector.mjs",
    "core/scripts/lib/wakeflow-business-archive-service.mjs",
    "core/scripts/lib/wakeflow-config-v3-transition-authority.mjs",
    "core/scripts/lib/wakeflow-delivery-orchestration.mjs",
    "core/scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
    "core/scripts/lib/wakeflow-evidence-importer.mjs",
    "core/scripts/lib/wakeflow-keep-live-service.mjs",
    "core/scripts/lib/wakeflow-legacy-archive-transform.mjs",
    "core/scripts/lib/wakeflow-observability-v3.mjs",
    "core/scripts/lib/wakeflow-pod-service.mjs",
    "core/scripts/lib/wakeflow-preservation.mjs",
    "core/scripts/lib/wakeflow-public-v3-runtime.mjs",
    "core/scripts/lib/wakeflow-reconcile.mjs",
    "core/scripts/lib/wakeflow-result-review-orchestration.mjs",
    "core/scripts/lib/wakeflow-transport-retention.mjs",
    "core/scripts/lib/wakeflow-window-binding-service.mjs",
    "core/scripts/lib/wakeflow-window-lease-service.mjs",
    "core/scripts/lib/wakeflow-window-runtime-projector.mjs",
    "core/scripts/wakeflow-smoke.mjs",
    "core/scripts/wakeflow-smoke-v3-candidate.mjs",
    "plugins/claude-code-wakeflow/lib/wakeflow-mcp-tools.mjs",
    "plugins/claude-code-wakeflow/lib/wakeflow-mcp-tools-v3-candidate.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-active-projector.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-business-archive-service.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-activity.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-lifecycle.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-locator.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-settings.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-transport.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-config-v3-transition-authority.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-delivery-orchestration.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-evidence-importer.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-keep-live-service.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-legacy-archive-transform.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-observability-v3.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-pod-service.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-preservation.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-public-v3-runtime.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-reconcile.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-result-review-orchestration.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-transport-retention.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-window-binding-service.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-window-lease-service.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-window-runtime-projector.mjs",
    "plugins/claude-code-wakeflow/scripts/wakeflow-smoke.mjs",
    "plugins/claude-code-wakeflow/scripts/wakeflow-smoke-v3-candidate.mjs",
    "plugins/codex-wakeflow/lib/wakeflow-mcp-tools.mjs",
    "plugins/codex-wakeflow/lib/wakeflow-mcp-tools-v3-candidate.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-active-projector.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-business-archive-service.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-config-v3-transition-authority.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-delivery-orchestration.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-evidence-importer.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-keep-live-service.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-legacy-archive-transform.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-observability-v3.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-pod-service.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-preservation.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-public-v3-runtime.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-reconcile.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-result-review-orchestration.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-transport-retention.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-window-binding-service.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-window-lease-service.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-window-runtime-projector.mjs",
    "plugins/codex-wakeflow/scripts/wakeflow-smoke.mjs",
    "plugins/codex-wakeflow/scripts/wakeflow-smoke-v3-candidate.mjs",
  ].filter((relativeFile) => existsSync(path.join(repositoryRoot, relativeFile))).sort(),
  "only admitted current services may consume the strict config snapshot");
  assert.deepEqual(importersOf("wakeflow-window-runtime-records.mjs"), [
    "core/scripts/lib/wakeflow-window-runtime-projector.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-window-runtime-projector.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-window-runtime-projector.mjs",
  ].filter((relativeFile) => existsSync(path.join(repositoryRoot, relativeFile))).sort(),
  "only the candidate projector may consume window-runtime records before M6");
  assert.deepEqual(importersOf("wakeflow-window-runtime-projector.mjs"), [
    "core/scripts/lib/wakeflow-fresh-initialize.mjs",
    "core/scripts/lib/wakeflow-local-layout-inspection.mjs",
    "core/scripts/lib/wakeflow-local-layout-realization.mjs",
    "core/scripts/lib/wakeflow-maintenance-action-runtime.mjs",
    "core/scripts/lib/wakeflow-migration-production.mjs",
    "core/scripts/lib/wakeflow-observability-v3.mjs",
    "core/scripts/lib/wakeflow-reconcile.mjs",
    "core/scripts/lib/wakeflow-reconfigure.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-fresh-initialize.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-local-layout-inspection.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-local-layout-realization.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-maintenance-action-runtime.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-migration-production.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-observability-v3.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-reconcile.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-reconfigure.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-fresh-initialize.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-local-layout-inspection.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-local-layout-realization.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-maintenance-action-runtime.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-migration-production.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-observability-v3.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-reconcile.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-reconfigure.mjs",
  ].filter((relativeFile) => {
    if (!existsSync(path.join(repositoryRoot, relativeFile))) return false;
    if (relativeFile.startsWith("core/")) return true;
    return existsSync(path.join(
      path.dirname(path.join(repositoryRoot, relativeFile)),
      "wakeflow-window-runtime-projector.mjs",
    ));
  }).sort(),
  "only admitted candidate lifecycle, owner validation, and observability services may consume the runtime projector before M6");
  assert.deepEqual(importersOf("wakeflow-demand-document-builder.mjs"), [
    "core/scripts/lib/wakeflow-active-projector.mjs",
    "core/scripts/lib/wakeflow-demand-publication-service.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-active-projector.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-demand-publication-service.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-active-projector.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-demand-publication-service.mjs",
  ].filter((relativeFile) => existsSync(path.join(repositoryRoot, relativeFile))).sort(),
  "only T03 publication and T08 projection may consume the pure demand document builder before M6");
  assert.deepEqual(importersOf("wakeflow-target-result-authority.mjs"), [
    "core/scripts/lib/wakeflow-active-projector.mjs",
    "core/scripts/lib/wakeflow-business-archive-service.mjs",
    "core/scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
    "core/scripts/lib/wakeflow-result-review-orchestration.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-active-projector.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-business-archive-service.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-result-review-orchestration.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-active-projector.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-business-archive-service.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-result-review-orchestration.mjs",
  ].filter((relativeFile) => existsSync(path.join(repositoryRoot, relativeFile))).sort(),
  "only T08 review/projection, T09 archive, and the admitted T10 lifecycle owner may consume T07 authority before public cutover");
  assert.deepEqual(
    importersOf("wakeflow-demand-publication-service.mjs"),
    [
      "core/scripts/lib/wakeflow-public-v3-runtime.mjs",
      "plugins/claude-code-wakeflow/scripts/lib/wakeflow-public-v3-runtime.mjs",
      "plugins/codex-wakeflow/scripts/lib/wakeflow-public-v3-runtime.mjs",
    ],
    "only the public v3 runtime facade may expose the publication service",
  );
  assert.deepEqual(importersOf("wakeflow-demand-state-service.mjs"), [
    "core/scripts/lib/wakeflow-delivery-orchestration.mjs",
    "core/scripts/lib/wakeflow-demand-artifact-service.mjs",
    "core/scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
    "core/scripts/lib/wakeflow-evidence-importer.mjs",
    "core/scripts/lib/wakeflow-pod-service.mjs",
    "core/scripts/lib/wakeflow-public-v3-runtime.mjs",
    "core/scripts/lib/wakeflow-result-review-orchestration.mjs",
    "core/scripts/lib/wakeflow-target-result-authority.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-demand-artifact-service.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-transport.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-delivery-orchestration.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-evidence-importer.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-pod-service.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-public-v3-runtime.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-result-review-orchestration.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-target-result-authority.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-demand-artifact-service.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-delivery-orchestration.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-evidence-importer.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-pod-service.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-public-v3-runtime.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-result-review-orchestration.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-target-result-authority.mjs",
  ].filter((relativeFile) => existsSync(path.join(repositoryRoot, relativeFile))).sort(),
  "only admitted domain owners, the public v3 runtime, delivery orchestration, the Claude T08 host seam, and the read-only result authority may consume the state service");
});
