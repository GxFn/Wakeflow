import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
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

import { hostProfile as codexProfile } from "../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import { canonicalJson } from "../core/scripts/lib/wakeflow-canonical-json.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(repositoryRoot, "test/fixtures/wakeflow-config-v3");
const recordsModule = "../core/scripts/lib/wakeflow-ledger-records.mjs";
const projectorModule = "../core/scripts/lib/wakeflow-ledger-projector.mjs";

const IDS = Object.freeze({
  program: "program_11111111-1111-4111-8111-111111111111",
  programOther: "program_22222222-2222-4222-8222-222222222222",
  requirementA: "requirement_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  requirementB: "requirement_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  confirmation: "confirmation_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  archiveA: "archive_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  archiveB: "archive_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  demand: "demand_ffffffff-ffff-4fff-8fff-ffffffffffff",
  demandOther: "demand_01234567-89ab-4cde-8fab-0123456789ab",
  demandAbsent: "demand_99999999-9999-4999-8999-999999999999",
});

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function makeLedgerRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-ledger-v3-"));
  mkdirSync(path.join(root, "requirement-designs"), { recursive: true });
  mkdirSync(path.join(root, "goal-stage-confirmation"), { recursive: true });
  mkdirSync(path.join(root, "workspace/archive"), { recursive: true });
  return root;
}

function fixture(name = "valid-minimal.json") {
  return JSON.parse(readFileSync(path.join(fixtureRoot, name), "utf8"));
}

function requirementRecord({
  requirementId = IDS.requirementA,
  title = "Confirmed requirement",
  content = "# Requirement\n",
} = {}) {
  return {
    record: {
      schemaVersion: 1,
      artifactKind: "wakeflow-requirement-record",
      requirementId,
      programId: IDS.program,
      title,
      status: "confirmed",
      relatedDemandIds: [IDS.demand],
      documents: [{
        role: "requirement-design",
        path: "requirement.md",
        mediaType: "text/markdown",
        digest: sha256(content),
      }],
    },
    memberContents: { "requirement.md": content },
  };
}

function confirmationRecord() {
  const content = "# User confirmation\n";
  return {
    record: {
      schemaVersion: 1,
      artifactKind: "wakeflow-confirmation-record",
      confirmationId: IDS.confirmation,
      programId: IDS.program,
      demandId: IDS.demand,
      title: "Goal and stage confirmed",
      status: "confirmed",
      documents: [{
        role: "user-confirmation",
        path: "confirmation.md",
        mediaType: "text/markdown",
        digest: sha256(content),
      }],
    },
    memberContents: { "confirmation.md": content },
  };
}

function archiveRecord({
  archiveId = IDS.archiveA,
  archiveKind = "demand",
  demandId = IDS.demand,
  yearMonth = "2026-08",
  title = "Completed demand",
  conclusion = "Accepted and archived.",
  content = "archive payload\n",
} = {}) {
  const digest = sha256(content);
  const transportSummary = "{\"artifactKind\":\"wakeflow-business-archive-transport-summary\"}\n";
  const transportSummaryDigest = sha256(transportSummary);
  const source = archiveKind === "demand"
    ? {
        kind: "demand",
        demandId,
        demandRef: "payload/data.txt",
        demandDigest: digest,
      }
    : archiveKind === "documents"
      ? {
          kind: "documents",
          documents: [{ ref: "requirements/source.md", digest }],
        }
      : {
          kind: "todo",
          todoRows: [{ todoId: "todo-2026-08-07", digest }],
        };
  return {
    record: {
      schemaVersion: 1,
      artifactKind: "wakeflow-archive-manifest",
      archiveId,
      programId: IDS.program,
      archiveKind,
      yearMonth,
      title,
      conclusion,
      source,
      transport: archiveKind === "demand"
        ? {
            status: "archived",
            inventoryDigest: sha256("empty strict transport inventory"),
            memberRefs: [{ ref: "transport-summary.json", digest: transportSummaryDigest }],
          }
        : { status: "unsupported", memberRefs: [] },
      members: [
        {
          role: archiveKind === "todo" ? "todo-history" : "payload",
          path: "payload/data.txt",
          mediaType: "text/plain",
          digest,
        },
        ...(archiveKind === "demand" ? [{
          role: "transport-summary",
          path: "transport-summary.json",
          mediaType: "application/json",
          digest: transportSummaryDigest,
        }] : []),
      ],
    },
    memberContents: {
      "payload/data.txt": content,
      ...(archiveKind === "demand" ? { "transport-summary.json": transportSummary } : {}),
    },
  };
}

function archiveRecordWithSummary(options = {}) {
  const input = archiveRecord(options);
  const summary = "{\"artifactKind\":\"wakeflow-business-archive-summary\"}\n";
  input.record.members.push({
    role: "summary",
    path: "business-summary.json",
    mediaType: "application/json",
    digest: sha256(summary),
  });
  input.memberContents["business-summary.json"] = summary;
  return input;
}

function demandArchiveWithTodoHistory(options = {}) {
  const input = archiveRecord(options);
  const history = "{\"artifactKind\":\"wakeflow-todo-history\"}\n";
  input.record.members.push({
    role: "todo-history",
    path: "todo-history.json",
    mediaType: "application/json",
    digest: sha256(history),
  });
  input.memberContents["todo-history.json"] = history;
  return input;
}

function bulkArchiveRecord(memberCount = 800) {
  const input = archiveRecord();
  for (let index = 0; index < memberCount; index += 1) {
    const memberPath = `bulk/member-${String(index).padStart(4, "0")}.txt`;
    const content = index === 0 ? `${"x".repeat(8 * 1024 * 1024)}\n` : `member ${index}\n`;
    input.record.members.push({
      role: "summary",
      path: memberPath,
      mediaType: "text/plain",
      digest: sha256(content),
    });
    input.memberContents[memberPath] = content;
  }
  return input;
}

function deterministicLedgerStage(ledgerRoot, input) {
  const relativeRoot = input.record.archiveKind
    ? path.join("workspace", "archive", input.record.yearMonth)
    : input.record.artifactKind === "wakeflow-requirement-record"
      ? "requirement-designs"
      : "goal-stage-confirmation";
  return path.join(ledgerRoot, relativeRoot, `.${input.record.archiveId ?? input.record.requirementId ?? input.record.confirmationId}.wakeflow-stage`);
}

function seedArchiveStage(ledgerRoot, input, boundary) {
  const stage = deterministicLedgerStage(ledgerRoot, input);
  mkdirSync(path.dirname(stage), { recursive: true });
  mkdirSync(stage);
  if (boundary === "empty") return stage;
  writeFileSync(
    path.join(stage, "archive-manifest.json"),
    `${canonicalJson(input.record)}\n`,
  );
  if (boundary === "manifest") return stage;
  const members = [...input.record.members].sort((left, right) => left.path.localeCompare(right.path));
  const count = boundary === "partial-members" ? 1 : members.length;
  for (const member of members.slice(0, count)) {
    const target = path.join(stage, ...member.path.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, input.memberContents[member.path]);
  }
  return stage;
}

function seedCommittedArchive(ledgerRoot, input) {
  const root = path.join(
    ledgerRoot,
    "workspace/archive",
    input.record.yearMonth,
    input.record.archiveId,
  );
  mkdirSync(root, { recursive: true, mode: 0o755 });
  chmodSync(path.join(ledgerRoot, "workspace/archive", input.record.yearMonth), 0o755);
  chmodSync(root, 0o755);
  for (const member of input.record.members) {
    const target = path.join(root, ...member.path.split("/"));
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
    let directory = path.dirname(target);
    while (directory !== root) {
      chmodSync(directory, 0o755);
      directory = path.dirname(directory);
    }
    writeFileSync(target, input.memberContents[member.path], { mode: 0o644 });
    chmodSync(target, 0o644);
  }
  const manifest = path.join(root, "archive-manifest.json");
  writeFileSync(manifest, `${canonicalJson(input.record)}\n`, { mode: 0o644 });
  chmodSync(manifest, 0o644);
  return root;
}

function assertLedgerFailure(fn) {
  assert.throws(fn, (error) => {
    assert.match(String(error?.code ?? ""), /^wakeflow-ledger-|^WAKEFLOW_STATE_LOCK_/u);
    assert.equal(typeof error?.path, "string");
    return true;
  });
}

function permissionBits(candidate) {
  return statSync(candidate).mode & 0o777;
}

function waitForPaths(paths, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (paths.every((candidate) => existsSync(candidate))) {
        resolve();
      } else if (Date.now() >= deadline) {
        reject(new Error(`timed out waiting for child readiness: ${paths.join(", ")}`));
      } else {
        setTimeout(poll, 5);
      }
    };
    poll();
  });
}

function collectChild(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function spawnLedgerCreate({ moduleHref, inputPath, readyPath, startPath }) {
  const source = String.raw`
    import { existsSync, readFileSync, writeFileSync } from "node:fs";
    const [moduleHref, inputPath, readyPath, startPath] = process.argv.slice(1);
    const { createLedgerRecord } = await import(moduleHref);
    writeFileSync(readyPath, "ready\n");
    const sleeper = new Int32Array(new SharedArrayBuffer(4));
    while (!existsSync(startPath)) Atomics.wait(sleeper, 0, 0, 2);
    const input = JSON.parse(readFileSync(inputPath, "utf8"));
    try {
      const result = createLedgerRecord(input);
      process.stdout.write(JSON.stringify({ ok: true, created: result.created, recordId: result.recordId }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, code: error?.code, path: error?.path }));
    }
  `;
  return spawn(process.execPath, [
    "--input-type=module",
    "--eval",
    source,
    moduleHref,
    inputPath,
    readyPath,
    startPath,
  ], { stdio: ["ignore", "pipe", "pipe"] });
}

function expectLedgerCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error?.code, code, error?.stack ?? String(error));
    assert.equal(typeof error?.path, "string");
    return true;
  });
}

test("the shared typed ID system admits ledger, demand, immutable artifact, and transport identities", async () => {
  const {
    WAKEFLOW_ID_TYPES,
    generateWakeflowId,
    parseWakeflowId,
  } = await import("../core/scripts/lib/wakeflow-identifiers.mjs");
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
  const idByType = {
    requirement: IDS.requirementA,
    confirmation: IDS.confirmation,
    archive: IDS.archiveA,
    demand: IDS.demand,
  };
  for (const type of ["requirement", "confirmation", "archive", "demand"]) {
    assert.ok(WAKEFLOW_ID_TYPES.includes(type), `${type} must be a shared typed ID`);
    const uuid = idByType[type].slice(type.length + 1);
    assert.equal(generateWakeflowId(type, () => uuid), idByType[type]);
    assert.equal(parseWakeflowId(idByType[type]).type, type);
  }
  for (const admitted of ["task-package", "target-task", "target-result", "review-candidate", "test-card"]) {
    assert.equal(WAKEFLOW_ID_TYPES.includes(admitted), true);
  }
  assert.equal(WAKEFLOW_ID_TYPES.includes("evidence"), true);
});

test("candidate layout has three authority families, one projector owner, and no workspace record authority", async () => {
  const { parseWakeflowConfigV3 } = await import("../core/scripts/lib/wakeflow-config-v3.mjs");
  const {
    createWakeflowLayoutDescriptor,
    eventOnlyWakeflowLayoutEntries,
    wakeflowLayoutEntry,
  } = await import("../core/scripts/lib/wakeflow-layout-descriptor.mjs");
  const descriptor = createWakeflowLayoutDescriptor({
    model: parseWakeflowConfigV3(fixture()),
    hostProfile: codexProfile,
  });
  for (const key of [
    "ledger.requirements.index",
    "ledger.goal-stage.index",
    "ledger.workspace.record-map",
    "ledger.workspace.archive.index",
  ]) {
    const entry = wakeflowLayoutEntry(descriptor, key);
    assert.equal(entry.owner, "ledger-projector");
    assert.equal(entry.authority, "projection");
    assert.equal(entry.lifecycle, "deterministic-projection");
  }
  const workspace = wakeflowLayoutEntry(descriptor, "ledger.workspace");
  assert.equal(workspace.owner, "layout-manager");
  assert.equal(workspace.authority, "none");
  assert.equal(workspace.lifecycle, "static-capability-root");
  const ledgerEvents = eventOnlyWakeflowLayoutEntries(descriptor)
    .filter((entry) => entry.key.startsWith("event.ledger."));
  assert.deepEqual(
    [...new Set(ledgerEvents.map((entry) => entry.key.split(".")[2]))].sort(),
    ["archive", "confirmation", "requirement"],
  );
  assert.equal(ledgerEvents.some((entry) => entry.key.includes("workspace-record")), false);
});

test("ledger ships exactly three strict authority schemas and no generic workspace record schema", () => {
  const schemaRoot = path.join(repositoryRoot, "core/schemas/wakeflow-ledger");
  assert.deepEqual(readdirSync(schemaRoot).sort(), [
    "archive-manifest.schema.json",
    "confirmation-record.schema.json",
    "requirement-record.schema.json",
  ]);
  const expectations = [
    ["requirement-record.schema.json", "wakeflow-requirement-record", "requirementId"],
    ["confirmation-record.schema.json", "wakeflow-confirmation-record", "confirmationId"],
    ["archive-manifest.schema.json", "wakeflow-archive-manifest", "archiveId"],
  ];
  for (const [file, artifactKind, idField] of expectations) {
    const schema = JSON.parse(readFileSync(path.join(schemaRoot, file), "utf8"));
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.artifactKind.const, artifactKind);
    assert.ok(schema.required.includes(idField));
    assert.equal(schema.properties[idField].pattern.startsWith(`^${idField.replace("Id", "")}_`), true);
    const humanText = new RegExp(schema.$defs.trimmedNonEmptyString.pattern, "u");
    assert.equal(humanText.test("line one\nline two"), true);
    assert.equal(humanText.test("unsafe\ttitle"), false);
    assert.equal(humanText.test("unsafe\u0085title"), false);
    const memberPath = new RegExp(schema.$defs.memberPath.pattern, "u");
    assert.equal(memberPath.test("nested/member.md"), true);
    assert.equal(memberPath.test("nested\u0085member.md"), false);
  }
  const archiveSchema = JSON.parse(readFileSync(path.join(schemaRoot, "archive-manifest.schema.json"), "utf8"));
  assert.equal(archiveSchema.allOf.length, 3, "archiveKind must discriminate the exact source schema");
  assert.deepEqual(archiveSchema.properties.transport.oneOf, [
    { $ref: "#/$defs/transportUnsupported" },
    { $ref: "#/$defs/transportArchived" },
  ]);
  assert.equal(archiveSchema.$defs.transportUnsupported.properties.status.const, "unsupported");
  assert.equal(archiveSchema.$defs.transportUnsupported.properties.memberRefs.maxItems, 0);
  assert.equal(archiveSchema.$defs.transportArchived.properties.status.const, "archived");
  assert.equal(archiveSchema.$defs.transportArchived.properties.memberRefs.minItems, 1);
  const singleLineToken = new RegExp(archiveSchema.$defs.singleLineToken.pattern, "u");
  assert.equal(singleLineToken.test("todo-2026-08-07"), true);
  assert.equal(singleLineToken.test("todo\nbreak"), false);
});

test("schemas own structure while the mandatory runtime validator owns cross-entry semantics", async () => {
  const schemaRoot = path.join(repositoryRoot, "core/schemas/wakeflow-ledger");
  for (const file of readdirSync(schemaRoot)) {
    const schema = JSON.parse(readFileSync(path.join(schemaRoot, file), "utf8"));
    assert.match(schema.$comment, /structural and lexical shape only/i);
    assert.match(schema.$comment, /validateLedgerRecord\(\).*mandatory authoritative semantic validator/i);
    assert.match(schema.$comment, /ordering.*uniqueness.*prefix closure.*digest/i);
  }

  const { validateLedgerRecord } = await import(recordsModule);
  const duplicateMemberPath = requirementRecord().record;
  duplicateMemberPath.documents.push({
    ...duplicateMemberPath.documents[0],
    role: "supporting-evidence",
  });
  const memberPrefixCollision = requirementRecord().record;
  memberPrefixCollision.documents[0].path = "nested";
  memberPrefixCollision.documents.push({
    ...memberPrefixCollision.documents[0],
    role: "supporting-evidence",
    path: "nested/member.md",
  });
  const unsortedLineage = archiveRecord({ archiveKind: "documents" }).record;
  unsortedLineage.source.documents = [
    { ref: "z/source.md", digest: unsortedLineage.members[0].digest },
    { ref: "a/source.md", digest: unsortedLineage.members[0].digest },
  ];
  const crossFieldDigest = archiveRecord().record;
  crossFieldDigest.source.demandDigest = sha256("other member\n");
  const invalidRuntimeCorpus = [
    [duplicateMemberPath, "wakeflow-ledger-member-duplicate"],
    [memberPrefixCollision, "wakeflow-ledger-member-path"],
    [unsortedLineage, "wakeflow-ledger-archive-source"],
    [crossFieldDigest, "wakeflow-ledger-archive-source"],
  ];
  for (const [record, code] of invalidRuntimeCorpus) {
    expectLedgerCode(() => validateLedgerRecord(record), code);
  }
});

test("ledger record and projector entrypoints reject behavioral data without executing it", async () => {
  const {
    createLedgerRecord,
    validateLedgerRecord,
  } = await import(recordsModule);
  const { buildEmptyLedgerProjection } = await import(projectorModule);
  let calls = 0;

  const behavioralRecord = requirementRecord().record;
  Object.defineProperty(behavioralRecord, "artifactKind", {
    enumerable: true,
    get() {
      calls += 1;
      return "wakeflow-requirement-record";
    },
  });
  assert.throws(
    () => validateLedgerRecord(behavioralRecord),
    (error) => /^wakeflow-ledger-/u.test(error?.code),
  );
  assert.equal(calls, 0);

  const input = requirementRecord();
  const behavioralContents = {};
  Object.defineProperty(behavioralContents, "requirement.md", {
    enumerable: true,
    get() {
      calls += 1;
      return "# Requirement\n";
    },
  });
  assert.throws(
    () => createLedgerRecord({
      ledgerRoot: makeLedgerRoot(),
      expectedProgramId: IDS.program,
      record: input.record,
      memberContents: behavioralContents,
    }),
    (error) => /^wakeflow-ledger-/u.test(error?.code),
  );
  assert.equal(calls, 0);

  const presentation = { programId: IDS.program };
  Object.defineProperty(presentation, "programDisplayName", {
    enumerable: true,
    get() {
      calls += 1;
      return "Example Program";
    },
  });
  assert.throws(
    () => buildEmptyLedgerProjection(presentation),
    (error) => /^wakeflow-ledger-/u.test(error?.code),
  );
  assert.equal(calls, 0);
});

test("ledger physical readers use bounded current-owner nanosecond descriptor snapshots", () => {
  for (const relative of [
    "core/scripts/lib/wakeflow-ledger-records.mjs",
    "core/scripts/lib/wakeflow-ledger-projector.mjs",
    "core/scripts/lib/wakeflow-ledger-materialization.mjs",
  ]) {
    const source = readFileSync(path.join(repositoryRoot, relative), "utf8");
    assert.match(source, /process\.geteuid/u, relative);
    assert.match(source, /\{ bigint: true \}/u, relative);
    assert.match(source, /mtimeNs/u, relative);
    assert.match(source, /ctimeNs/u, relative);
    assert.match(source, /readSync\(descriptor/u, relative);
    assert.match(source, /MAX_LEDGER_(?:FILE|PROJECTION)_BYTES/u, relative);
    assert.doesNotMatch(source, /mtimeMs|ctimeMs|readFileSync\(descriptor\)/u, relative);
  }
  const recordsSource = readFileSync(path.join(
    repositoryRoot,
    "core/scripts/lib/wakeflow-ledger-records.mjs",
  ), "utf8");
  const projectorSource = readFileSync(path.join(
    repositoryRoot,
    "core/scripts/lib/wakeflow-ledger-projector.mjs",
  ), "utf8");
  assert.match(recordsSource, /assertLedgerFileCapacity\([\s\S]*recordBytes/u);
  assert.match(recordsSource, /assertLedgerFileCapacity\([\s\S]*Buffer\.from\(content\)/u);
  assert.match(projectorSource, /Buffer\.byteLength\(content, "utf8"\) > MAX_LEDGER_PROJECTION_BYTES/u);
});

test("strict create/load is canonical, create-only, and rejects unknown fields or digest drift", async () => {
  const {
    createLedgerRecord,
    ledgerMutationLockPath,
    loadLedgerRecord,
  } = await import(recordsModule);
  const ledgerRoot = makeLedgerRoot();
  const input = requirementRecord();
  const created = createLedgerRecord({ ledgerRoot, expectedProgramId: IDS.program, ...input });
  assert.equal(created.created, true);
  assert.equal(created.family, "requirement");
  assert.equal(created.recordId, IDS.requirementA);
  assert.equal(created.relativeRoot, `requirement-designs/${IDS.requirementA}`);
  const realLedgerRoot = realpathSync(ledgerRoot);
  assert.equal(
    ledgerMutationLockPath(ledgerRoot),
    path.join(path.dirname(realLedgerRoot), `${path.basename(realLedgerRoot)}.ledger-lock`),
  );
  assert.equal(existsSync(ledgerMutationLockPath(ledgerRoot)), false, "ephemeral ledger lock is released");
  assert.equal(readdirSync(ledgerRoot).some((name) => name.includes("lock")), false, "tracked ledger contains no lock handle");

  const unsafeLockRoot = makeLedgerRoot();
  const unsafeLockPath = ledgerMutationLockPath(unsafeLockRoot);
  symlinkSync(path.join(unsafeLockRoot, "missing-lock-target"), unsafeLockPath);
  const lockStartedAt = Date.now();
  assert.throws(
    () => createLedgerRecord({
      ledgerRoot: unsafeLockRoot,
      expectedProgramId: IDS.program,
      ...requirementRecord(),
    }),
    (error) => {
      assert.equal(error?.code, "WAKEFLOW_STATE_LOCK_UNSAFE");
      assert.equal(error?.path, unsafeLockPath);
      return true;
    },
  );
  assert.ok(Date.now() - lockStartedAt < 500, "dangling sibling lock must fail without an unbounded retry");
  assert.deepEqual(readdirSync(path.join(unsafeLockRoot, "requirement-designs")), []);
  unlinkSync(unsafeLockPath);
  const loaded = loadLedgerRecord({
    ledgerRoot,
    root: path.join(ledgerRoot, created.relativeRoot),
    expectedFamily: "requirement",
    expectedProgramId: IDS.program,
  });
  assert.equal(loaded.recordDigest, created.recordDigest);
  assert.equal(loaded.members[0].digest, input.record.documents[0].digest);
  assert.equal(
    readFileSync(path.join(loaded.root, "record.json"), "utf8"),
    `${canonicalJson(input.record)}\n`,
    "record.json must use canonical sorted-key JSON",
  );
  assert.equal(
    createLedgerRecord({ ledgerRoot, expectedProgramId: IDS.program, ...input }).created,
    false,
    "exact retry is idempotent",
  );

  const conflicting = requirementRecord({ title: "Different immutable title" });
  expectLedgerCode(
    () => createLedgerRecord({ ledgerRoot, expectedProgramId: IDS.program, ...conflicting }),
    "wakeflow-ledger-record-conflict",
  );
  const unknown = structuredClone(input.record);
  unknown.generatedAt = "2026-08-07T00:00:00Z";
  expectLedgerCode(
    () => createLedgerRecord({
      ledgerRoot,
      expectedProgramId: IDS.program,
      record: unknown,
      memberContents: input.memberContents,
    }),
    "wakeflow-ledger-unknown-field",
  );
  const drifted = structuredClone(input.record);
  drifted.documents[0].digest = sha256("different\n");
  expectLedgerCode(
    () => createLedgerRecord({
      ledgerRoot: makeLedgerRoot(),
      expectedProgramId: IDS.program,
      record: drifted,
      memberContents: input.memberContents,
    }),
    "wakeflow-ledger-member-digest",
  );
  const foreignRoot = makeLedgerRoot();
  expectLedgerCode(
    () => createLedgerRecord({
      ledgerRoot: foreignRoot,
      expectedProgramId: IDS.programOther,
      ...input,
    }),
    "wakeflow-ledger-program",
  );
  assert.deepEqual(readdirSync(path.join(foreignRoot, "requirement-designs")), []);
  assert.deepEqual(
    readdirSync(path.join(ledgerRoot, "requirement-designs")).filter((name) => name.includes("wakeflow-stage")),
    [],
  );
});

test("demand archive source identity is unique inside one ledger mutation transaction", async () => {
  const {
    createLedgerRecord,
    ledgerMutationLockPath,
    loadLedgerRecord,
  } = await import(recordsModule);
  const ledgerRoot = makeLedgerRoot();
  const firstInput = archiveRecord({ archiveId: IDS.archiveA, title: "First demand archive" });
  const first = createLedgerRecord({
    ledgerRoot,
    expectedProgramId: IDS.program,
    ...firstInput,
  });
  assert.equal(first.created, true);
  assert.equal(
    createLedgerRecord({ ledgerRoot, expectedProgramId: IDS.program, ...firstInput }).created,
    false,
    "the exact archive ID and bytes remain idempotent",
  );

  const duplicateSource = archiveRecord({
    archiveId: IDS.archiveB,
    title: "A second ID for the same demand must not publish",
  });
  assertLedgerFailure(() => createLedgerRecord({
    ledgerRoot,
    expectedProgramId: IDS.program,
    ...duplicateSource,
  }));
  const duplicateDestination = path.join(
    ledgerRoot,
    "workspace/archive/2026-08",
    IDS.archiveB,
  );
  assert.equal(existsSync(duplicateDestination), false);
  assert.equal(existsSync(deterministicLedgerStage(ledgerRoot, duplicateSource)), false);
  assert.equal(existsSync(ledgerMutationLockPath(ledgerRoot)), false);

  const duplicateIdInAnotherMonth = archiveRecord({
    archiveId: IDS.archiveA,
    yearMonth: "2026-09",
    title: "The same archive identity cannot move to another month",
  });
  expectLedgerCode(
    () => createLedgerRecord({
      ledgerRoot,
      expectedProgramId: IDS.program,
      ...duplicateIdInAnotherMonth,
    }),
    "wakeflow-ledger-record-conflict",
  );
  assert.equal(existsSync(path.join(ledgerRoot, "workspace/archive/2026-09")), false);

  const loadedFirst = loadLedgerRecord({
    ledgerRoot,
    root: first.root,
    expectedFamily: "archive",
    expectedProgramId: IDS.program,
  });
  assert.equal(loadedFirst.record.source.demandId, IDS.demand);

  const independentDemand = archiveRecord({
    archiveId: IDS.archiveB,
    demandId: IDS.demandOther,
    title: "A distinct demand may use another archive ID",
  });
  assert.equal(createLedgerRecord({
    ledgerRoot,
    expectedProgramId: IDS.program,
    ...independentDemand,
  }).created, true);
});

test("migration archive creation tolerates only the exact caller-validated legacy roots", async () => {
  const {
    createLedgerMigrationArchiveRecord,
    createLedgerRecord,
    loadLedgerRecord,
  } = await import(recordsModule);
  const ledgerRoot = makeLedgerRoot();
  const legacyRoot = path.join(
    ledgerRoot,
    "workspace/archive/2025-12/SCENARIO-LEGACY-TRANSPORT",
  );
  mkdirSync(legacyRoot, { recursive: true });
  writeFileSync(path.join(legacyRoot, "wakeflow-state.json"), "legacy bytes\n");
  const input = archiveRecord();

  expectLedgerCode(
    () => createLedgerRecord({ ledgerRoot, expectedProgramId: IDS.program, ...input }),
    "wakeflow-ledger-unknown-entry",
  );
  assert.equal(existsSync(deterministicLedgerStage(ledgerRoot, input)), false);

  expectLedgerCode(
    () => createLedgerMigrationArchiveRecord({
      ledgerRoot,
      expectedProgramId: IDS.program,
      legacyArchiveRoots: [],
      ...input,
    }),
    "wakeflow-ledger-unknown-entry",
  );
  expectLedgerCode(
    () => createLedgerMigrationArchiveRecord({
      ledgerRoot,
      expectedProgramId: IDS.program,
      legacyArchiveRoots: [
        legacyRoot,
        path.join(ledgerRoot, "workspace/archive/2025-12/ANOTHER-LEGACY-ROOT"),
      ],
      ...input,
    }),
    "wakeflow-ledger-record-conflict",
  );

  const created = createLedgerMigrationArchiveRecord({
    ledgerRoot,
    expectedProgramId: IDS.program,
    legacyArchiveRoots: [legacyRoot],
    ...input,
  });
  assert.equal(created.created, true);
  assert.equal(existsSync(legacyRoot), true, "migration creation never detaches legacy source");
  assert.equal(
    readFileSync(path.join(legacyRoot, "wakeflow-state.json"), "utf8"),
    "legacy bytes\n",
  );
  assert.equal(
    createLedgerMigrationArchiveRecord({
      ledgerRoot,
      expectedProgramId: IDS.program,
      legacyArchiveRoots: [legacyRoot],
      ...input,
    }).created,
    false,
    "exact migration replay resolves the committed typed record",
  );
  const loaded = loadLedgerRecord({
    ledgerRoot,
    root: created.root,
    expectedFamily: "archive",
    expectedProgramId: IDS.program,
  });
  assert.equal(loaded.recordId, IDS.archiveA);
  assert.equal(loaded.record.source.demandId, IDS.demand);
});

test("two real processes serialize different archive IDs for one demand", async () => {
  const ledgerRoot = makeLedgerRoot();
  const harnessRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-ledger-concurrency-"));
  const startPath = path.join(harnessRoot, "start");
  const inputs = [
    archiveRecord({ archiveId: IDS.archiveA, title: "Concurrent archive A" }),
    archiveRecord({ archiveId: IDS.archiveB, title: "Concurrent archive B" }),
  ];
  const children = inputs.map((input, index) => {
    const inputPath = path.join(harnessRoot, `input-${index}.json`);
    const readyPath = path.join(harnessRoot, `ready-${index}`);
    writeFileSync(inputPath, `${JSON.stringify({
      ledgerRoot,
      expectedProgramId: IDS.program,
      ...input,
    })}\n`);
    return {
      readyPath,
      child: spawnLedgerCreate({
        moduleHref: new URL(recordsModule, import.meta.url).href,
        inputPath,
        readyPath,
        startPath,
      }),
    };
  });
  await waitForPaths(children.map(({ readyPath }) => readyPath));
  writeFileSync(startPath, "start\n");
  const outputs = await Promise.all(children.map(({ child }) => collectChild(child)));
  assert.deepEqual(outputs.map(({ code }) => code), [0, 0], outputs.map(({ stderr }) => stderr).join("\n"));
  const results = outputs.map(({ stdout }) => JSON.parse(stdout));
  assert.equal(results.filter(({ ok }) => ok).length, 1, JSON.stringify(results));
  assert.equal(results.filter(({ code }) => code === "wakeflow-ledger-record-conflict").length, 1);
  const month = path.join(ledgerRoot, "workspace/archive/2026-08");
  assert.equal(readdirSync(month).filter((name) => name.startsWith("archive_")).length, 1);
  assert.equal(readdirSync(month).some((name) => name.includes("wakeflow-stage")), false);
});

test("demand archive lookup is strict, cross-month, locator-only, and conflict-aware", async (t) => {
  const {
    createLedgerRecord,
    findDemandArchiveRecord,
  } = await import(recordsModule);
  assert.equal(typeof findDemandArchiveRecord, "function");
  const ledgerRoot = makeLedgerRoot();
  const archived = archiveRecord({
    archiveId: IDS.archiveA,
    yearMonth: "2025-12",
    title: "Cross-month demand archive",
  });
  createLedgerRecord({ ledgerRoot, expectedProgramId: IDS.program, ...archived });
  createLedgerRecord({
    ledgerRoot,
    expectedProgramId: IDS.program,
    ...archiveRecord({
      archiveId: IDS.archiveB,
      demandId: IDS.demandOther,
      yearMonth: "2026-08",
      title: "Other demand archive",
    }),
  });

  const found = findDemandArchiveRecord({
    ledgerRoot,
    expectedProgramId: IDS.program,
    demandId: IDS.demand,
    archiveId: IDS.archiveA,
  });
  assert.deepEqual(Object.keys(found).sort(), [
    "members",
    "record",
    "recordDigest",
    "recordId",
    "relativeRoot",
  ]);
  assert.equal(found.recordId, IDS.archiveA);
  assert.equal(found.relativeRoot, `workspace/archive/2025-12/${IDS.archiveA}`);
  assert.equal(found.record.source.demandId, IDS.demand);
  assert.equal(Object.isFrozen(found), true);
  assert.equal(Object.isFrozen(found.record), true);
  assert.equal(Object.isFrozen(found.members), true);
  assert.equal(JSON.stringify(found).includes(realpathSync(ledgerRoot)), false);
  assert.equal(JSON.stringify(found).includes("absolutePath"), false);
  assert.equal(findDemandArchiveRecord({
    ledgerRoot,
    expectedProgramId: IDS.program,
    demandId: IDS.demandAbsent,
  }), null);
  assertLedgerFailure(() => findDemandArchiveRecord({
    ledgerRoot,
    expectedProgramId: IDS.program,
    demandId: IDS.demand,
    archiveId: IDS.archiveB,
  }));

  await t.test("pending stage blocks lookup", () => {
    const stagedRoot = makeLedgerRoot();
    seedArchiveStage(stagedRoot, archiveRecord(), "manifest");
    assertLedgerFailure(() => findDemandArchiveRecord({
      ledgerRoot: stagedRoot,
      expectedProgramId: IDS.program,
      demandId: IDS.demand,
    }));
  });

  await t.test("unknown archive inventory blocks lookup", () => {
    const unknownRoot = makeLedgerRoot();
    writeFileSync(path.join(unknownRoot, "workspace/archive/unknown.txt"), "unknown\n");
    assertLedgerFailure(() => findDemandArchiveRecord({
      ledgerRoot: unknownRoot,
      expectedProgramId: IDS.program,
      demandId: IDS.demandAbsent,
    }));
  });

  await t.test("pre-existing same-demand duplicate blocks lookup", () => {
    const duplicateRoot = makeLedgerRoot();
    seedCommittedArchive(duplicateRoot, archiveRecord({ archiveId: IDS.archiveA, yearMonth: "2025-12" }));
    seedCommittedArchive(duplicateRoot, archiveRecord({ archiveId: IDS.archiveB, yearMonth: "2026-08" }));
    assertLedgerFailure(() => findDemandArchiveRecord({
      ledgerRoot: duplicateRoot,
      expectedProgramId: IDS.program,
      demandId: IDS.demand,
    }));
  });
});

test("demand archive lookup ignores the health of the exact archive index projection", async (t) => {
  const {
    findDemandArchiveRecord,
    loadLedgerRecord,
  } = await import(recordsModule);
  const variants = [
    {
      name: "stale bytes",
      mutate(indexPath) {
        writeFileSync(indexPath, "# stale archive projection\n", { mode: 0o644 });
        if (process.platform !== "win32") chmodSync(indexPath, 0o644);
      },
    },
    {
      name: "wrong mode",
      skip: process.platform === "win32",
      mutate(indexPath) {
        writeFileSync(indexPath, "# unsafe archive projection\n", { mode: 0o600 });
        chmodSync(indexPath, 0o600);
      },
    },
    {
      name: "hardlink",
      skip: process.platform === "win32",
      mutate(indexPath) {
        const outside = path.join(
          mkdtempSync(path.join(os.tmpdir(), "wakeflow-ledger-locator-index-link-")),
          "index.md",
        );
        writeFileSync(outside, "# multiply linked archive projection\n", { mode: 0o644 });
        chmodSync(outside, 0o644);
        linkSync(outside, indexPath);
      },
    },
    {
      name: "symlink",
      skip: process.platform === "win32",
      mutate(indexPath) {
        const outside = path.join(
          mkdtempSync(path.join(os.tmpdir(), "wakeflow-ledger-locator-index-symlink-")),
          "index.md",
        );
        writeFileSync(outside, "# external archive projection\n");
        symlinkSync(outside, indexPath);
      },
    },
    {
      name: "interrupted atomic stage",
      mutate(indexPath) {
        const stage = path.join(
          path.dirname(indexPath),
          ".index.md.wakeflow-stage-999999-00000000-0000-4000-8000-000000000000",
        );
        writeFileSync(stage, "# interrupted archive projection\n", { mode: 0o644 });
        if (process.platform !== "win32") chmodSync(stage, 0o644);
      },
    },
  ];

  for (const variant of variants) {
    await t.test(variant.name, { skip: variant.skip ?? false }, () => {
      const ledgerRoot = makeLedgerRoot();
      const input = archiveRecord({ yearMonth: "2025-12" });
      const archiveRoot = seedCommittedArchive(ledgerRoot, input);
      const indexPath = path.join(ledgerRoot, "workspace/archive/index.md");
      variant.mutate(indexPath);

      const locator = findDemandArchiveRecord({
        ledgerRoot,
        expectedProgramId: IDS.program,
        demandId: IDS.demand,
        archiveId: IDS.archiveA,
      });
      const loaded = loadLedgerRecord({
        ledgerRoot,
        root: archiveRoot,
        expectedFamily: "archive",
        expectedProgramId: IDS.program,
      });
      assert.equal(locator.recordId, loaded.recordId);
      assert.equal(locator.recordDigest, loaded.recordDigest);
      assert.equal(locator.relativeRoot, loaded.relativeRoot);
      assert.equal(locator.record.source.demandId, IDS.demand);
      assert.equal(JSON.stringify(locator).includes(realpathSync(ledgerRoot)), false);
    });
  }
});

test("deterministic per-record stages recover exact intent at every publish boundary", async (t) => {
  const { createLedgerRecord, loadLedgerRecord } = await import(recordsModule);
  for (const boundary of ["empty", "manifest", "partial-members", "complete"]) {
    await t.test(boundary, () => {
      const ledgerRoot = makeLedgerRoot();
      const input = archiveRecordWithSummary();
      const stage = seedArchiveStage(ledgerRoot, input, boundary);
      const created = createLedgerRecord({
        ledgerRoot,
        expectedProgramId: IDS.program,
        ...input,
      });
      assert.equal(created.created, true);
      assert.equal(existsSync(stage), false, "the exact deterministic stage is published, not abandoned");
      const loaded = loadLedgerRecord({
        ledgerRoot,
        root: created.root,
        expectedFamily: "archive",
        expectedProgramId: IDS.program,
      });
      assert.equal(loaded.recordDigest, created.recordDigest);
      assert.deepEqual(
        loaded.members.map(({ path: memberPath, digest }) => ({ path: memberPath, digest })),
        input.record.members.map(({ path: memberPath, digest }) => ({ path: memberPath, digest })),
      );
      assert.equal(createLedgerRecord({
        ledgerRoot,
        expectedProgramId: IDS.program,
        ...input,
      }).created, false);
    });
  }
});

test("deterministic stage recovery preserves conflicting, unknown, and unsafe residue", async (t) => {
  const { createLedgerRecord } = await import(recordsModule);
  const assertBlocked = ({ ledgerRoot, input, stage }) => {
    assertLedgerFailure(() => createLedgerRecord({
      ledgerRoot,
      expectedProgramId: IDS.program,
      ...input,
    }));
    assert.equal(existsSync(stage), true, "unproven residue must remain available for explicit inspection");
    assert.equal(
      existsSync(path.join(ledgerRoot, "workspace/archive", input.record.yearMonth, input.record.archiveId)),
      false,
      "a blocked stage must not publish authority",
    );
  };

  await t.test("conflicting manifest", () => {
    const ledgerRoot = makeLedgerRoot();
    const input = archiveRecordWithSummary();
    const conflicting = archiveRecordWithSummary({ title: "Conflicting immutable intent" });
    const stage = seedArchiveStage(ledgerRoot, conflicting, "manifest");
    assertBlocked({ ledgerRoot, input, stage });
    assert.match(readFileSync(path.join(stage, "archive-manifest.json"), "utf8"), /Conflicting immutable intent/u);
  });

  await t.test("member bytes before a manifest intent", () => {
    const ledgerRoot = makeLedgerRoot();
    const input = archiveRecordWithSummary();
    const stage = deterministicLedgerStage(ledgerRoot, input);
    mkdirSync(path.join(stage, "payload"), { recursive: true });
    writeFileSync(path.join(stage, "payload/data.txt"), input.memberContents["payload/data.txt"]);
    assertBlocked({ ledgerRoot, input, stage });
    assert.equal(readFileSync(path.join(stage, "payload/data.txt"), "utf8"), "archive payload\n");
  });

  await t.test("conflicting member and unknown entry", () => {
    const ledgerRoot = makeLedgerRoot();
    const input = archiveRecordWithSummary();
    const stage = seedArchiveStage(ledgerRoot, input, "complete");
    writeFileSync(path.join(stage, "payload/data.txt"), "conflicting bytes\n");
    writeFileSync(path.join(stage, "unknown.txt"), "unknown residue\n");
    assertBlocked({ ledgerRoot, input, stage });
    assert.equal(readFileSync(path.join(stage, "unknown.txt"), "utf8"), "unknown residue\n");
  });

  await t.test("symlink stage", () => {
    const ledgerRoot = makeLedgerRoot();
    const input = archiveRecordWithSummary();
    const stage = deterministicLedgerStage(ledgerRoot, input);
    mkdirSync(path.dirname(stage), { recursive: true });
    const outside = mkdtempSync(path.join(os.tmpdir(), "wakeflow-ledger-unsafe-stage-"));
    writeFileSync(path.join(outside, "sentinel.txt"), "must survive\n");
    symlinkSync(outside, stage);
    assertBlocked({ ledgerRoot, input, stage });
    assert.equal(readFileSync(path.join(outside, "sentinel.txt"), "utf8"), "must survive\n");
  });

  await t.test("legacy PID and mtime stage is never guessed stale or deleted", () => {
    const ledgerRoot = makeLedgerRoot();
    const input = archiveRecordWithSummary();
    const monthRoot = path.join(ledgerRoot, "workspace/archive", input.record.yearMonth);
    mkdirSync(monthRoot, { recursive: true });
    const stage = path.join(
      monthRoot,
      `.${input.record.archiveId}.wakeflow-stage-999999-00000000-0000-4000-8000-000000000000`,
    );
    mkdirSync(stage);
    writeFileSync(path.join(stage, "sentinel.txt"), "unowned residue\n");
    const oldTime = new Date("2000-01-01T00:00:00.000Z");
    utimesSync(stage, oldTime, oldTime);
    assertBlocked({ ledgerRoot, input, stage });
    assert.equal(readFileSync(path.join(stage, "sentinel.txt"), "utf8"), "unowned residue\n");
  });
});

test("ledger authority and deterministic stages enforce descriptor modes and single-link files", {
  skip: process.platform === "win32",
}, async (t) => {
  const { createLedgerRecord, loadLedgerRecord } = await import(recordsModule);

  await t.test("creation normalizes umask to 0755 directories and 0644 files", () => {
    const ledgerRoot = makeLedgerRoot();
    const input = archiveRecordWithSummary();
    const previousUmask = process.umask(0o077);
    let created;
    try {
      created = createLedgerRecord({ ledgerRoot, expectedProgramId: IDS.program, ...input });
    } finally {
      process.umask(previousUmask);
    }
    for (const directory of [
      path.join(ledgerRoot, "workspace/archive/2026-08"),
      created.root,
      path.join(created.root, "payload"),
    ]) {
      assert.equal(permissionBits(directory), 0o755, directory);
    }
    for (const file of [
      path.join(created.root, "archive-manifest.json"),
      path.join(created.root, "payload/data.txt"),
      path.join(created.root, "business-summary.json"),
    ]) {
      assert.equal(permissionBits(file), 0o644, file);
      assert.equal(statSync(file).nlink, 1, file);
    }
  });

  for (const variant of ["stage-root", "manifest", "member-directory", "member-file"]) {
    await t.test(`wrong-mode ${variant} stage is preserved`, () => {
      const ledgerRoot = makeLedgerRoot();
      const input = archiveRecordWithSummary();
      const stage = seedArchiveStage(ledgerRoot, input, "complete");
      const candidate = variant === "stage-root"
        ? stage
        : variant === "manifest"
          ? path.join(stage, "archive-manifest.json")
          : variant === "member-directory"
            ? path.join(stage, "payload")
            : path.join(stage, "payload/data.txt");
      chmodSync(candidate, variant.includes("file") || variant === "manifest" ? 0o600 : 0o700);
      assertLedgerFailure(() => createLedgerRecord({
        ledgerRoot,
        expectedProgramId: IDS.program,
        ...input,
      }));
      assert.equal(existsSync(stage), true);
      assert.equal(permissionBits(candidate), variant.includes("file") || variant === "manifest" ? 0o600 : 0o700);
    });
  }

  await t.test("wrong-mode final authority root fails strict reload", () => {
    const ledgerRoot = makeLedgerRoot();
    const input = archiveRecord();
    const created = createLedgerRecord({ ledgerRoot, expectedProgramId: IDS.program, ...input });
    chmodSync(created.root, 0o700);
    assertLedgerFailure(() => loadLedgerRecord({
      ledgerRoot,
      root: created.root,
      expectedFamily: "archive",
      expectedProgramId: IDS.program,
    }));
    assert.equal(permissionBits(created.root), 0o700);
  });

  await t.test("a more restrictive authority ancestor remains a container, not record identity", () => {
    const ledgerRoot = makeLedgerRoot();
    const input = requirementRecord();
    const created = createLedgerRecord({ ledgerRoot, expectedProgramId: IDS.program, ...input });
    const domainRoot = path.join(ledgerRoot, "requirement-designs");
    chmodSync(domainRoot, 0o700);
    const loaded = loadLedgerRecord({
      ledgerRoot,
      root: created.root,
      expectedFamily: "requirement",
      expectedProgramId: IDS.program,
    });
    assert.equal(loaded.recordId, input.record.requirementId);
    assert.equal(permissionBits(domainRoot), 0o700);
  });

  for (const relative of ["archive-manifest.json", "payload/data.txt"]) {
    await t.test(`hardlinked final ${relative} fails strict reload`, () => {
      const ledgerRoot = makeLedgerRoot();
      const input = archiveRecord();
      const created = createLedgerRecord({ ledgerRoot, expectedProgramId: IDS.program, ...input });
      const target = path.join(created.root, ...relative.split("/"));
      const outside = path.join(mkdtempSync(path.join(os.tmpdir(), "wakeflow-ledger-hardlink-")), "linked");
      linkSync(target, outside);
      assert.equal(statSync(target).nlink, 2);
      assertLedgerFailure(() => loadLedgerRecord({
        ledgerRoot,
        root: created.root,
        expectedFamily: "archive",
        expectedProgramId: IDS.program,
      }));
      assert.equal(statSync(target).nlink, 2);
    });
  }
});

test("exact authority and deterministic stage coexistence fails closed and preserves both", async () => {
  const { createLedgerRecord, loadLedgerRecord } = await import(recordsModule);
  const ledgerRoot = makeLedgerRoot();
  const input = archiveRecordWithSummary();
  const created = createLedgerRecord({ ledgerRoot, expectedProgramId: IDS.program, ...input });
  const stage = seedArchiveStage(ledgerRoot, input, "complete");
  assertLedgerFailure(() => createLedgerRecord({
    ledgerRoot,
    expectedProgramId: IDS.program,
    ...input,
  }));
  assert.equal(existsSync(stage), true);
  assert.equal(loadLedgerRecord({
    ledgerRoot,
    root: created.root,
    expectedFamily: "archive",
    expectedProgramId: IDS.program,
  }).recordDigest, created.recordDigest);
});

test("archive month cleanup preserves an inode replacement after a real process swap", {
  skip: process.platform === "win32",
}, async () => {
  const ledgerRoot = makeLedgerRoot();
  const input = bulkArchiveRecord();
  const month = path.join(ledgerRoot, "workspace/archive", input.record.yearMonth);
  const firstStageMember = path.join(
    month,
    `.${input.record.archiveId}.wakeflow-stage`,
    "bulk/member-0000.txt",
  );
  const harnessRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-ledger-month-swap-"));
  const replacement = path.join(ledgerRoot, "workspace/archive", ".month-replacement");
  const displaced = path.join(ledgerRoot, "workspace/archive", ".month-displaced");
  const inputPath = path.join(harnessRoot, "input.json");
  const readyPath = path.join(harnessRoot, "ready");
  const startPath = path.join(harnessRoot, "start");
  writeFileSync(inputPath, `${JSON.stringify({
    ledgerRoot,
    expectedProgramId: IDS.program,
    ...input,
  })}\n`);
  const child = spawnLedgerCreate({
    moduleHref: new URL(recordsModule, import.meta.url).href,
    inputPath,
    readyPath,
    startPath,
  });
  const childResult = collectChild(child);
  await waitForPaths([readyPath]);
  const firstMemberVisible = waitForPaths([firstStageMember], 15000);
  writeFileSync(startPath, "start\n");
  await firstMemberVisible;
  mkdirSync(replacement, { mode: 0o755 });
  chmodSync(replacement, 0o755);
  const replacementIdentity = statSync(replacement);
  renameSync(month, displaced);
  renameSync(replacement, month);
  const result = await childResult;
  assert.equal(result.code, 0, result.stderr);
  const childRecord = JSON.parse(result.stdout);
  assert.equal(childRecord.ok, false, result.stdout);
  assert.equal(existsSync(month), true, "cleanup must not remove a replacement inode");
  const current = statSync(month);
  assert.equal(current.dev, replacementIdentity.dev);
  assert.equal(current.ino, replacementIdentity.ino);
  assert.deepEqual(readdirSync(month), [], "the replacement remains empty and is preserved by identity, not content");
  assert.equal(existsSync(displaced), true);
});

test("strict member paths, refs, unknown residue, and symlinks fail closed", async () => {
  const {
    createLedgerMemberReference,
    createLedgerRecord,
    loadLedgerRecord,
    resolveLedgerMemberReference,
  } = await import(recordsModule);
  const traversal = requirementRecord();
  traversal.record.documents[0].path = "../escape.md";
  expectLedgerCode(
    () => createLedgerRecord({ ledgerRoot: makeLedgerRoot(), expectedProgramId: IDS.program, ...traversal }),
    "wakeflow-ledger-member-path",
  );
  const newlinePath = requirementRecord();
  newlinePath.record.documents[0].path = "line\nbreak.md";
  expectLedgerCode(
    () => createLedgerRecord({ ledgerRoot: makeLedgerRoot(), expectedProgramId: IDS.program, ...newlinePath }),
    "wakeflow-ledger-member-path",
  );
  const c1Path = requirementRecord();
  c1Path.record.documents[0].path = "line\u0085break.md";
  expectLedgerCode(
    () => createLedgerRecord({ ledgerRoot: makeLedgerRoot(), expectedProgramId: IDS.program, ...c1Path }),
    "wakeflow-ledger-member-path",
  );
  const duplicatePath = requirementRecord();
  duplicatePath.record.documents.push({
    ...duplicatePath.record.documents[0],
    role: "supporting-evidence",
  });
  expectLedgerCode(
    () => createLedgerRecord({
      ledgerRoot: makeLedgerRoot(),
      expectedProgramId: IDS.program,
      ...duplicatePath,
    }),
    "wakeflow-ledger-member-duplicate",
  );
  const overlappingPaths = requirementRecord();
  overlappingPaths.record.documents[0].path = "nested";
  overlappingPaths.record.documents.push({
    ...overlappingPaths.record.documents[0],
    role: "supporting-evidence",
    path: "nested/member.md",
  });
  expectLedgerCode(
    () => createLedgerRecord({
      ledgerRoot: makeLedgerRoot(),
      expectedProgramId: IDS.program,
      ...overlappingPaths,
    }),
    "wakeflow-ledger-member-path",
  );

  const ledgerRoot = makeLedgerRoot();
  const input = requirementRecord();
  const created = createLedgerRecord({ ledgerRoot, expectedProgramId: IDS.program, ...input });
  const loaded = loadLedgerRecord({ ledgerRoot, root: path.join(ledgerRoot, created.relativeRoot) });
  const reference = createLedgerMemberReference(loaded, "requirement.md");
  assert.equal(reference.family, "requirement");
  assert.equal(reference.recordDigest, loaded.recordDigest);
  assert.equal(reference.memberDigest, input.record.documents[0].digest);
  assert.equal(resolveLedgerMemberReference({
    ledgerRoot,
    reference,
    expectedFamily: "requirement",
    expectedRole: "requirement-design",
    expectedProgramId: IDS.program,
  }).member.path, "requirement.md");
  expectLedgerCode(
    () => resolveLedgerMemberReference({
      ledgerRoot,
      reference: { ...reference, memberDigest: sha256("tampered") },
    }),
    "wakeflow-ledger-reference-digest",
  );
  expectLedgerCode(
    () => resolveLedgerMemberReference({
      ledgerRoot,
      reference: { ...reference, memberRef: "../escape.md" },
    }),
    "wakeflow-ledger-reference-path",
  );

  writeFileSync(path.join(loaded.root, "unknown.txt"), "unknown\n");
  expectLedgerCode(
    () => loadLedgerRecord({ ledgerRoot, root: loaded.root }),
    "wakeflow-ledger-unknown-entry",
  );
  unlinkSync(path.join(loaded.root, "unknown.txt"));
  const outside = path.join(mkdtempSync(path.join(os.tmpdir(), "wakeflow-ledger-outside-")), "outside.md");
  writeFileSync(outside, "# Requirement\n");
  unlinkSync(path.join(loaded.root, "requirement.md"));
  symlinkSync(outside, path.join(loaded.root, "requirement.md"));
  expectLedgerCode(
    () => loadLedgerRecord({ ledgerRoot, root: loaded.root }),
    "wakeflow-ledger-symlink",
  );

  const manifestRoot = makeLedgerRoot();
  const manifestInput = requirementRecord();
  const manifestCreated = createLedgerRecord({
    ledgerRoot: manifestRoot,
    expectedProgramId: IDS.program,
    ...manifestInput,
  });
  const manifestRecordRoot = path.join(manifestRoot, manifestCreated.relativeRoot);
  const manifestPath = path.join(manifestRecordRoot, "record.json");
  const invalidOutside = path.join(
    mkdtempSync(path.join(os.tmpdir(), "wakeflow-ledger-manifest-outside-")),
    "invalid.json",
  );
  writeFileSync(invalidOutside, "not json\n");
  unlinkSync(manifestPath);
  symlinkSync(invalidOutside, manifestPath);
  expectLedgerCode(
    () => loadLedgerRecord({ ledgerRoot: manifestRoot, root: manifestRecordRoot }),
    "wakeflow-ledger-symlink",
  );
});

test("confirmation and archive are the only other strict record families", async () => {
  const {
    createLedgerRecord,
    loadLedgerRecord,
    validateLedgerRecord,
  } = await import(recordsModule);
  const ledgerRoot = makeLedgerRoot();
  for (const [family, input] of [
    ["confirmation", confirmationRecord()],
    ["archive", archiveRecord()],
  ]) {
    const created = createLedgerRecord({ ledgerRoot, expectedProgramId: IDS.program, ...input });
    const loaded = loadLedgerRecord({
      ledgerRoot,
      root: path.join(ledgerRoot, created.relativeRoot),
      expectedFamily: family,
      expectedProgramId: IDS.program,
    });
    assert.equal(loaded.family, family);
    assert.equal(validateLedgerRecord(input.record).family, family);
  }
  const wrongSource = archiveRecord().record;
  wrongSource.source = {
    kind: "documents",
    documents: [{ ref: "source.md", digest: wrongSource.members[0].digest }],
  };
  expectLedgerCode(
    () => validateLedgerRecord(wrongSource),
    "wakeflow-ledger-archive-source",
  );
  const speculativeTransport = archiveRecord().record;
  speculativeTransport.transport.memberRefs.push("runs/run.json");
  expectLedgerCode(
    () => validateLedgerRecord(speculativeTransport),
    "wakeflow-ledger-transport",
  );
  const multilineTodo = archiveRecord({ archiveKind: "todo" }).record;
  multilineTodo.source.todoRows[0].todoId = "todo\nbreak";
  expectLedgerCode(
    () => validateLedgerRecord(multilineTodo),
    "wakeflow-ledger-archive-source",
  );
  const unsafeTitle = requirementRecord().record;
  unsafeTitle.title = "unsafe\ttitle";
  expectLedgerCode(
    () => validateLedgerRecord(unsafeTitle),
    "wakeflow-ledger-string",
  );
  const unsafeConclusion = archiveRecord().record;
  unsafeConclusion.conclusion = "unsafe\u0085conclusion";
  expectLedgerCode(
    () => validateLedgerRecord(unsafeConclusion),
    "wakeflow-ledger-string",
  );
  const unsortedDocuments = archiveRecord({ archiveKind: "documents" }).record;
  unsortedDocuments.source.documents = [
    { ref: "z/source.md", digest: unsortedDocuments.members[0].digest },
    { ref: "a/source.md", digest: unsortedDocuments.members[0].digest },
  ];
  expectLedgerCode(
    () => validateLedgerRecord(unsortedDocuments),
    "wakeflow-ledger-archive-source",
  );
  const unsorted = requirementRecord();
  unsorted.record.relatedDemandIds = [
    "demand_ffffffff-ffff-4fff-8fff-ffffffffffff",
    "demand_00000000-0000-4000-8000-000000000000",
  ];
  expectLedgerCode(
    () => validateLedgerRecord(unsorted.record),
    "wakeflow-ledger-related-demands",
  );
  expectLedgerCode(
    () => validateLedgerRecord({ schemaVersion: 1, artifactKind: "wakeflow-workspace-record" }),
    "wakeflow-ledger-artifact-kind",
  );
});

async function populateLedger(ledgerRoot, order = "forward") {
  const { createLedgerRecord } = await import(recordsModule);
  const entries = [
    requirementRecord({ requirementId: IDS.requirementB, title: "Second requirement", content: "# B\n" }),
    requirementRecord({ requirementId: IDS.requirementA, title: "First | requirement", content: "# A\n" }),
    confirmationRecord(),
    archiveRecord({ archiveId: IDS.archiveB, title: "Second archive" }),
    archiveRecord({
      archiveId: IDS.archiveA,
      archiveKind: "todo",
      title: "TODO history",
      conclusion: "Completed TODO rows archived.",
    }),
  ];
  for (const input of order === "forward" ? entries : entries.toReversed()) {
    createLedgerRecord({ ledgerRoot, expectedProgramId: IDS.program, ...input });
  }
}

test("the four-index projector is byte deterministic and workspace-record-map remains a projection", async () => {
  const {
    LEDGER_PROJECTION_PATHS,
    buildLedgerProjection,
    writeLedgerProjection,
  } = await import(projectorModule);
  const projectorSource = readFileSync(path.join(
    repositoryRoot,
    "core/scripts/lib/wakeflow-ledger-projector.mjs",
  ), "utf8");
  assert.match(projectorSource, /openSync\(target, fsConstants\.O_RDONLY \| \(fsConstants\.O_NOFOLLOW \?\? 0\)\)/u);
  assert.doesNotMatch(projectorSource, /readFileSync\(target\)/u);
  const firstRoot = makeLedgerRoot();
  const secondRoot = makeLedgerRoot();
  await populateLedger(firstRoot, "forward");
  await populateLedger(secondRoot, "reverse");
  const options = { programId: IDS.program, programDisplayName: "Example Program" };
  const first = buildLedgerProjection({ ledgerRoot: firstRoot, ...options });
  const second = buildLedgerProjection({ ledgerRoot: secondRoot, ...options });
  assert.deepEqual(Object.keys(first.files).sort(), [...LEDGER_PROJECTION_PATHS].sort());
  assert.deepEqual(first.files, second.files);
  assert.equal(first.sourceDigest, second.sourceDigest);
  assert.equal(first.counts.requirements, 2);
  assert.equal(first.counts.requirementDocuments, 2);
  assert.equal(first.counts.confirmations, 1);
  assert.equal(first.counts.confirmationDocuments, 1);
  assert.equal(first.counts.archives, 2);
  assert.equal(first.counts.archivePayloads, 3);
  for (const content of Object.values(first.files)) {
    assert.doesNotMatch(content, /Updated|Generated|2026-08-07T|mtime/i);
    assert.doesNotMatch(content, /\| None \|/);
  }
  const requirements = first.files["requirement-designs/index.md"];
  assert.ok(requirements.indexOf(IDS.requirementA) < requirements.indexOf(IDS.requirementB));
  assert.match(requirements, /First \\| requirement/);
  const recordMap = first.files["workspace/workspace-record-map.md"];
  assert.match(recordMap, /## Record Domains/);
  assert.match(recordMap, /## TODO History/);
  assert.match(recordMap, /## Archive/);
  assert.doesNotMatch(recordMap, /workspace-records\//i);
  const confirmation = first.files["goal-stage-confirmation/index.md"];
  assert.match(confirmation, new RegExp(IDS.demand));
  const archives = first.files["workspace/archive/index.md"];
  assert.match(archives, /unsupported/);

  const hostilePresentation = buildLedgerProjection({
    ledgerRoot: firstRoot,
    programId: IDS.program,
    programDisplayName: "<b>[Example]</b> `Program`",
  });
  const hostileRecordMap = hostilePresentation.files["workspace/workspace-record-map.md"];
  assert.match(hostileRecordMap, /&lt;b&gt;&#91;Example&#93;&lt;\/b&gt; &#96;Program&#96;/u);
  assert.doesNotMatch(hostileRecordMap, /<b>|\[Example\]|`Program`/u);

  const written = writeLedgerProjection({ ledgerRoot: firstRoot, ...options });
  assert.equal(written.projectionStatus, "current");
  assert.equal(written.changed.length, 4);
  assert.equal(writeLedgerProjection({ ledgerRoot: firstRoot, ...options }).changed.length, 0);
  for (const relative of LEDGER_PROJECTION_PATHS) {
    assert.equal(readFileSync(path.join(firstRoot, relative), "utf8"), first.files[relative]);
  }
});

test("workspace-record-map TODO History is selected by typed member role across archive kinds", async () => {
  const { createLedgerRecord } = await import(recordsModule);
  const { buildLedgerProjection } = await import(projectorModule);
  const ledgerRoot = makeLedgerRoot();
  const withTodoHistory = demandArchiveWithTodoHistory({
    archiveId: IDS.archiveA,
    title: "Demand archive with exact TODO lineage",
  });
  const withoutTodoHistory = archiveRecord({
    archiveId: IDS.archiveB,
    demandId: IDS.demandOther,
    title: "Demand archive without TODO lineage",
  });
  createLedgerRecord({ ledgerRoot, expectedProgramId: IDS.program, ...withTodoHistory });
  createLedgerRecord({ ledgerRoot, expectedProgramId: IDS.program, ...withoutTodoHistory });

  const projection = buildLedgerProjection({
    ledgerRoot,
    programId: IDS.program,
    programDisplayName: "Example Program",
  });
  const recordMap = projection.files["workspace/workspace-record-map.md"];
  const todoStart = recordMap.indexOf("## TODO History");
  const archiveStart = recordMap.indexOf("## Archive", todoStart + 1);
  assert.ok(todoStart >= 0 && archiveStart > todoStart);
  const todoHistory = recordMap.slice(todoStart, archiveStart);
  assert.match(todoHistory, new RegExp(IDS.archiveA));
  assert.match(todoHistory, /Demand archive with exact TODO lineage/u);
  assert.doesNotMatch(todoHistory, new RegExp(IDS.archiveB));
  assert.doesNotMatch(todoHistory, /Demand archive without TODO lineage/u);
});

test("ledger projector rejects archive identity duplication and unsafe month modes", async (t) => {
  const {
    LEDGER_PROJECTION_PATHS,
    buildLedgerProjection,
    writeLedgerProjection,
  } = await import(projectorModule);
  const options = {
    programId: IDS.program,
    programDisplayName: "Example Program",
  };
  const variants = [
    {
      name: "one archive ID in two months",
      arrange(ledgerRoot) {
        seedCommittedArchive(ledgerRoot, archiveRecord({
          archiveId: IDS.archiveA,
          demandId: IDS.demand,
          yearMonth: "2025-12",
        }));
        seedCommittedArchive(ledgerRoot, archiveRecord({
          archiveId: IDS.archiveA,
          demandId: IDS.demandOther,
          yearMonth: "2026-08",
        }));
      },
    },
    {
      name: "one demand with two archive IDs",
      arrange(ledgerRoot) {
        seedCommittedArchive(ledgerRoot, archiveRecord({
          archiveId: IDS.archiveA,
          yearMonth: "2025-12",
        }));
        seedCommittedArchive(ledgerRoot, archiveRecord({
          archiveId: IDS.archiveB,
          yearMonth: "2026-08",
        }));
      },
    },
    {
      name: "archive month mode differs from 0755",
      skip: process.platform === "win32",
      arrange(ledgerRoot) {
        const input = archiveRecord({ yearMonth: "2026-08" });
        seedCommittedArchive(ledgerRoot, input);
        chmodSync(path.join(ledgerRoot, "workspace/archive/2026-08"), 0o700);
      },
    },
    {
      name: "empty authority directory mode differs from 0755",
      skip: process.platform === "win32",
      arrange(ledgerRoot) {
        chmodSync(path.join(ledgerRoot, "requirement-designs"), 0o700);
      },
    },
  ];
  const operations = [
    ["build", (ledgerRoot) => buildLedgerProjection({ ledgerRoot, ...options })],
    ["write", (ledgerRoot) => writeLedgerProjection({ ledgerRoot, ...options })],
  ];

  for (const variant of variants) {
    for (const [operationName, operation] of operations) {
      await t.test(`${variant.name} / ${operationName}`, { skip: variant.skip ?? false }, () => {
        const ledgerRoot = makeLedgerRoot();
        variant.arrange(ledgerRoot);
        assertLedgerFailure(() => operation(ledgerRoot));
        for (const relative of LEDGER_PROJECTION_PATHS) {
          assert.equal(existsSync(path.join(ledgerRoot, ...relative.split("/"))), false);
        }
      });
    }
  }
});

test("existing projections require stable 0644 single-link files even when content is current", {
  skip: process.platform === "win32",
}, async (t) => {
  const {
    buildLedgerProjection,
    writeLedgerProjection,
  } = await import(projectorModule);
  const options = {
    programId: IDS.program,
    programDisplayName: "Example Program",
  };

  await t.test("wrong mode", async () => {
    const ledgerRoot = makeLedgerRoot();
    await populateLedger(ledgerRoot);
    writeLedgerProjection({ ledgerRoot, ...options });
    const target = path.join(ledgerRoot, "workspace/workspace-record-map.md");
    chmodSync(target, 0o600);
    assertLedgerFailure(() => buildLedgerProjection({ ledgerRoot, ...options }));
    assertLedgerFailure(() => writeLedgerProjection({ ledgerRoot, ...options }));
    assert.equal(permissionBits(target), 0o600);
  });

  await t.test("hardlink", async () => {
    const ledgerRoot = makeLedgerRoot();
    await populateLedger(ledgerRoot);
    writeLedgerProjection({ ledgerRoot, ...options });
    const target = path.join(ledgerRoot, "workspace/archive/index.md");
    const outside = path.join(mkdtempSync(path.join(os.tmpdir(), "wakeflow-ledger-projection-link-")), "index.md");
    linkSync(target, outside);
    assert.equal(statSync(target).nlink, 2);
    assertLedgerFailure(() => buildLedgerProjection({ ledgerRoot, ...options }));
    assertLedgerFailure(() => writeLedgerProjection({ ledgerRoot, ...options }));
    assert.equal(statSync(target).nlink, 2);
  });
});

test("projector reconciliation consumes one safe atomic stage and preserves ambiguous or unsafe stages", async (t) => {
  const { writeLedgerProjection } = await import(projectorModule);
  const { createLedgerRecord } = await import(recordsModule);
  const options = {
    programId: IDS.program,
    programDisplayName: "Example Program",
  };
  const stagePath = (target, suffix = "00000000-0000-4000-8000-000000000000") => path.join(
    path.dirname(target),
    `.${path.basename(target)}.wakeflow-stage-999999-${suffix}`,
  );

  await t.test("one safe partial stage is discarded and rebuilt from authority", () => {
    const ledgerRoot = makeLedgerRoot();
    createLedgerRecord({ ledgerRoot, expectedProgramId: IDS.program, ...archiveRecordWithSummary() });
    const target = path.join(ledgerRoot, "workspace/archive/index.md");
    const stage = stagePath(target);
    writeFileSync(stage, "partial derived projection bytes", { mode: 0o644 });
    if (process.platform !== "win32") chmodSync(stage, 0o644);

    const written = writeLedgerProjection({ ledgerRoot, ...options });
    assert.equal(written.projectionStatus, "current");
    assert.equal(existsSync(stage), false);
    assert.equal(readFileSync(target, "utf8"), written.files["workspace/archive/index.md"]);
  });

  await t.test("a wrong-mode stage is preserved and blocks all projection writes", {
    skip: process.platform === "win32",
  }, () => {
    const ledgerRoot = makeLedgerRoot();
    const target = path.join(ledgerRoot, "workspace/archive/index.md");
    const stage = stagePath(target);
    writeFileSync(stage, "unsafe derived projection bytes", { mode: 0o600 });
    chmodSync(stage, 0o600);

    assertLedgerFailure(() => writeLedgerProjection({ ledgerRoot, ...options }));
    assert.equal(existsSync(stage), true);
    for (const relative of [
      "requirement-designs/index.md",
      "goal-stage-confirmation/index.md",
      "workspace/workspace-record-map.md",
      "workspace/archive/index.md",
    ]) {
      assert.equal(existsSync(path.join(ledgerRoot, ...relative.split("/"))), false);
    }
  });

  await t.test("multiple stages for one target are preserved as ambiguous evidence", () => {
    const ledgerRoot = makeLedgerRoot();
    const target = path.join(ledgerRoot, "workspace/archive/index.md");
    const stages = [
      stagePath(target),
      stagePath(target, "11111111-1111-4111-8111-111111111111"),
    ];
    for (const stage of stages) {
      writeFileSync(stage, "ambiguous derived projection bytes", { mode: 0o644 });
      if (process.platform !== "win32") chmodSync(stage, 0o644);
    }

    assertLedgerFailure(() => writeLedgerProjection({ ledgerRoot, ...options }));
    assert.deepEqual(stages.map((stage) => existsSync(stage)), [true, true]);
  });
});

test("candidate commit refreshes every projection and reports stale without rolling authority back", async () => {
  const {
    LEDGER_PROJECTION_PATHS,
    commitLedgerRecordAndProject,
    writeLedgerProjection,
  } = await import(projectorModule);
  const currentRoot = makeLedgerRoot();
  const current = commitLedgerRecordAndProject({
    ledgerRoot: currentRoot,
    programId: IDS.program,
    ...requirementRecord(),
    programDisplayName: "Example Program",
  });
  assert.equal(current.authorityCommitted, true);
  assert.equal(current.authority.created, true);
  assert.equal(current.projectionStatus, "current");
  assert.deepEqual(current.projection.changed, LEDGER_PROJECTION_PATHS);
  for (const relative of LEDGER_PROJECTION_PATHS) {
    assert.equal(existsSync(path.join(currentRoot, relative)), true);
  }

  const staleRoot = makeLedgerRoot();
  const outsideRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-ledger-projection-outside-"));
  const outside = path.join(outsideRoot, "requirement-index.md");
  writeFileSync(outside, "outside projection\n");
  const projectionTarget = path.join(staleRoot, "requirement-designs/index.md");
  symlinkSync(outside, projectionTarget);
  assert.throws(
    () => writeLedgerProjection({
      ledgerRoot: staleRoot,
      programId: IDS.program,
      programDisplayName: "Example Program",
    }),
    (error) => {
      assert.equal(error?.code, "wakeflow-ledger-symlink");
      assert.equal(error?.details?.authorityCommitted, undefined);
      return true;
    },
  );
  const stale = commitLedgerRecordAndProject({
    ledgerRoot: staleRoot,
    programId: IDS.program,
    ...requirementRecord(),
    programDisplayName: "Example Program",
  });
  assert.equal(stale.authorityCommitted, true);
  assert.equal(stale.authority.created, true);
  assert.equal(stale.projectionStatus, "stale");
  assert.equal(stale.projectionError.code, "wakeflow-ledger-symlink");
  assert.equal(readFileSync(projectionTarget, "utf8"), "outside projection\n");
  const committed = (await import(recordsModule)).loadLedgerRecord({
    ledgerRoot: staleRoot,
    root: path.join(staleRoot, stale.authority.relativeRoot),
    expectedFamily: "requirement",
    expectedProgramId: IDS.program,
  });
  assert.equal(committed.recordId, IDS.requirementA);

  unlinkSync(projectionTarget);
  const repaired = writeLedgerProjection({
    ledgerRoot: staleRoot,
    programId: IDS.program,
    programDisplayName: "Example Program",
  });
  assert.equal(repaired.projectionStatus, "current");
  assert.deepEqual(repaired.changed, LEDGER_PROJECTION_PATHS);
});

test("empty projections contain zero data rows and corrupt inventory blocks projection", async () => {
  const { buildLedgerProjection } = await import(projectorModule);
  const ledgerRoot = makeLedgerRoot();
  const empty = buildLedgerProjection({
    ledgerRoot,
    programId: IDS.program,
    programDisplayName: "Example Program",
  });
  for (const content of Object.values(empty.files)) {
    assert.doesNotMatch(content, /\| None \|/);
  }
  expectLedgerCode(
    () => buildLedgerProjection({
      ledgerRoot,
      programId: IDS.program,
      programDisplayName: "unsafe\u0000program",
    }),
    "wakeflow-ledger-program",
  );
  writeFileSync(path.join(ledgerRoot, ".wakeflow-ledger.lock"), "legacy in-root lock\n");
  expectLedgerCode(
    () => buildLedgerProjection({
      ledgerRoot,
      programId: IDS.program,
      programDisplayName: "Example Program",
    }),
    "wakeflow-ledger-unknown-entry",
  );
  unlinkSync(path.join(ledgerRoot, ".wakeflow-ledger.lock"));
  const emptyMonth = path.join(ledgerRoot, "workspace/archive/2026-08");
  mkdirSync(emptyMonth);
  expectLedgerCode(
    () => buildLedgerProjection({
      ledgerRoot,
      programId: IDS.program,
      programDisplayName: "Example Program",
    }),
    "wakeflow-ledger-unknown-entry",
  );
  rmdirSync(emptyMonth);
  mkdirSync(path.join(ledgerRoot, "workspace-records"));
  expectLedgerCode(
    () => buildLedgerProjection({
      ledgerRoot,
      programId: IDS.program,
      programDisplayName: "Example Program",
    }),
    "wakeflow-ledger-unknown-entry",
  );
  assert.equal(existsSync(path.join(ledgerRoot, "workspace-records/index.md")), false);
});
