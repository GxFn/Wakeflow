import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
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
  WAKEFLOW_EVIDENCE_ARTIFACT_KIND,
  WAKEFLOW_EVIDENCE_CONTENT_CLASSES as RECORD_CONTENT_CLASSES,
  WAKEFLOW_EVIDENCE_MAX_MANIFEST_BYTES,
  WAKEFLOW_EVIDENCE_MAX_RELATIONS,
  evidenceIdentity,
  evidenceManifestCanonicalBytes,
  evidenceManifestDigest,
  evidenceManifestRef,
  inspectManagedEvidenceInventory,
  loadManagedEvidenceByRef,
  validateEvidenceManifest,
  validateEvidencePayload,
  validateEvidenceSource,
  validateEvidenceWriteIntent,
} from "../core/scripts/lib/wakeflow-evidence-records.mjs";
import {
  CONTENT_CLASSES as TREE_CONTENT_CLASSES,
  WAKEFLOW_EVIDENCE_CONTENT_CLASSES as TREE_EXPLICIT_CONTENT_CLASSES,
  assertNoEvidenceStageResidue,
  evidenceRootPath,
  evidenceStagePath,
  inspectConfiguredEvidenceSource,
  inspectEvidenceFinalWrite,
  inspectEvidenceStage,
  materializeEvidenceStage,
  publishEvidenceStage,
} from "../core/scripts/lib/wakeflow-evidence-tree.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceSchema = JSON.parse(readFileSync(
  path.join(repositoryRoot, "core/schemas/wakeflow-demand-evidence/evidence.schema.json"),
  "utf8",
));

const IDS = Object.freeze({
  program: "program_11111111-1111-4111-8111-111111111111",
  demand: "demand_22222222-2222-4222-8222-222222222222",
  evidence: "evidence_33333333-3333-4333-8333-333333333333",
  evidenceOther: "evidence_34343434-3434-4434-8434-343434343434",
  repository: "repository_44444444-4444-4444-8444-444444444444",
  surface: "surface_55555555-5555-4555-8555-555555555555",
  window: "window_66666666-6666-4666-8666-666666666666",
  taskPackage: "task-package_77777777-7777-4777-8777-777777777777",
});

const CREATED_AT = "2026-08-07T06:07:08.123Z";
const DEMAND_DIGEST = `sha256:${"d".repeat(64)}`;
const CONFIG_DIGEST = `sha256:${"c".repeat(64)}`;
const CONTENT = Buffer.from("portable evidence\n", "utf8");

function byteDigest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function clone(value) {
  return structuredClone(value);
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function treeDigest({ directories, files }) {
  return canonicalJsonDigest({ directories, files });
}

function filePayload(bytes = CONTENT, contentClass = "text/plain") {
  const file = {
    path: "payload/content",
    bytes: bytes.length,
    digest: byteDigest(bytes),
    contentClass,
  };
  return {
    directories: ["payload"],
    files: [file],
    totalBytes: bytes.length,
    treeDigest: treeDigest({
      directories: [],
      files: [{ ...file, path: "content" }],
    }),
  };
}

function emptyTreePayload(directories = ["payload"]) {
  return {
    directories,
    files: [],
    totalBytes: 0,
    treeDigest: treeDigest({
      directories: directories
        .filter((entry) => entry !== "payload")
        .map((entry) => entry.slice("payload/".length)),
      files: [],
    }),
  };
}

function managedSource(overrides = {}) {
  return {
    kind: "managed-path",
    root: { kind: "repository", repositoryId: IDS.repository },
    path: "reports/result.txt",
    expectedType: "file",
    expectedDigest: byteDigest(CONTENT),
    ...overrides,
  };
}

function httpsSource(overrides = {}) {
  return {
    kind: "https",
    url: "https://example.test/evidence/report",
    verification: {
      kind: "caller-supplied-digest",
      digest: `sha256:${"a".repeat(64)}`,
    },
    ...overrides,
  };
}

function manifest(overrides = {}) {
  return {
    schemaVersion: 1,
    artifactKind: WAKEFLOW_EVIDENCE_ARTIFACT_KIND,
    programId: IDS.program,
    demandId: IDS.demand,
    demandRef: "demand.json",
    demandDigest: DEMAND_DIGEST,
    evidenceId: IDS.evidence,
    kind: "test-output",
    capturedAt: CREATED_AT,
    recordedBy: {
      windowId: IDS.window,
      role: "controller",
      configDigest: CONFIG_DIGEST,
    },
    source: managedSource(),
    sensitivity: "internal",
    privacyScan: {
      schemaVersion: 1,
      disposition: "passed",
      findingCounts: [],
    },
    relations: [],
    payload: filePayload(),
    ...overrides,
  };
}

function locatorManifest(overrides = {}) {
  const value = manifest({ source: httpsSource(), ...overrides });
  delete value.payload;
  return value;
}

function writeIntent(value = manifest()) {
  return { ...evidenceIdentity(value), value };
}

function expectRecordError(callback, code, errorPath = null) {
  assert.throws(callback, (error) => {
    assert.equal(error?.name, "WakeflowEvidenceRecordError");
    assert.equal(error?.code, code);
    if (errorPath !== null) assert.equal(error?.path, errorPath);
    return true;
  });
}

function expectTreeError(callback, code) {
  assert.throws(callback, (error) => {
    assert.equal(error?.name, "WakeflowEvidenceTreeError");
    assert.equal(error?.code, code);
    return true;
  });
}

function makeStateRoot(t, { value = manifest(), payloadBytes = CONTENT } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-evidence-records-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const evidenceRoot = path.join(root, "evidence");
  const artifactRoot = path.join(evidenceRoot, value.evidenceId);
  for (const directory of [evidenceRoot, artifactRoot]) {
    mkdirSync(directory, { mode: 0o700 });
    chmodSync(directory, 0o700);
  }
  if (value.payload) {
    const payloadRoot = path.join(artifactRoot, "payload");
    mkdirSync(payloadRoot, { mode: 0o700 });
    chmodSync(payloadRoot, 0o700);
    writeFileSync(path.join(payloadRoot, "content"), payloadBytes, { mode: 0o600 });
    chmodSync(path.join(payloadRoot, "content"), 0o600);
  }
  writeFileSync(path.join(artifactRoot, "evidence.json"), evidenceManifestCanonicalBytes(value), { mode: 0o600 });
  chmodSync(path.join(artifactRoot, "evidence.json"), 0o600);
  return { root, evidenceRoot, artifactRoot, value, identity: evidenceIdentity(value) };
}

test("evidence schema, record runtime, and tree share one exact content-class contract", () => {
  const schemaClasses = evidenceSchema.$defs.payloadFile.properties.contentClass.enum;
  const expected = [
    "application/pdf",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
    "text/plain",
  ];
  assert.equal(new Set(schemaClasses).size, expected.length);
  assert.deepEqual([...schemaClasses].sort(lexicalCompare), expected);
  assert.deepEqual(RECORD_CONTENT_CLASSES, expected);
  assert.deepEqual(TREE_CONTENT_CLASSES, expected);
  assert.deepEqual(TREE_EXPLICIT_CONTENT_CLASSES, expected);
  assert.strictEqual(TREE_CONTENT_CLASSES, TREE_EXPLICIT_CONTENT_CLASSES);
  assert.equal(evidenceSchema.additionalProperties, false);
  assert.equal(evidenceSchema.$defs.managedSource.additionalProperties, false);
  assert.equal(evidenceSchema.$defs.payload.additionalProperties, false);
  assert.equal(evidenceSchema.$defs.payloadFile.additionalProperties, false);
  assert.equal(evidenceSchema.properties.relations.maxItems, WAKEFLOW_EVIDENCE_MAX_RELATIONS);
  assert.equal(evidenceSchema.$defs.httpsSource.properties.url.maxLength, 2048);
  assert.equal(WAKEFLOW_EVIDENCE_MAX_MANIFEST_BYTES, 1024 * 1024);
  const treeRuntimeSource = readFileSync(
    path.join(repositoryRoot, "core/scripts/lib/wakeflow-evidence-tree.mjs"),
    "utf8",
  );
  assert.match(treeRuntimeSource, /mtimeNs/u);
  assert.match(treeRuntimeSource, /ctimeNs/u);
  assert.doesNotMatch(treeRuntimeSource, /mtimeMs|ctimeMs/u);
});

test("portable path schema and runtime reject the same structural host-path forms", () => {
  const portablePattern = new RegExp(evidenceSchema.$defs.portablePath.pattern, "u");
  const payloadPattern = new RegExp(evidenceSchema.$defs.payloadPath.pattern, "u");
  for (const value of ["report.txt", "reports/final.txt", ...Array.from(
    { length: 16 },
    (_, index) => Array.from({ length: index + 1 }, (__, part) => `d${part}`).join("/"),
  )]) {
    assert.equal(portablePattern.test(value), true, value);
  }
  for (const value of ["foo:bar", " foo", "foo ", ".", "..", "a/../b", "a\\b", "a//b"]) {
    assert.equal(portablePattern.test(value), false, value);
    expectRecordError(
      () => validateEvidenceSource(managedSource({ path: value })),
      "wakeflow-evidence-path",
      "$/source/path",
    );
  }
  for (const value of [
    "token=not-a-real-credential",
    "88888888-8888-4888-8888-888888888888",
  ]) {
    assert.equal(portablePattern.test(value), true, "schema admits structurally portable metadata");
    expectRecordError(
      () => validateEvidenceSource(managedSource({ path: value })),
      "wakeflow-evidence-privacy",
      "$/source/path",
    );
    expectRecordError(
      () => validateEvidencePayload(emptyTreePayload(["payload", `payload/${value}`])),
      "wakeflow-evidence-privacy",
      "$/payload/directories/1",
    );
  }
  for (const value of ["payload", "payload/report.txt", `payload/${Array.from(
    { length: 16 },
    (_, index) => `d${index}`,
  ).join("/")}`]) {
    assert.equal(payloadPattern.test(value), true, value);
  }
  for (const value of [
    "payload/.",
    "payload/..",
    "payload/a\\b",
    "payload/C:drive",
    "payload/trailing ",
    `payload/${Array.from({ length: 17 }, (_, index) => `d${index}`).join("/")}`,
  ]) {
    assert.equal(payloadPattern.test(value), false, value);
  }
});

test("empty source-tree directory metadata is scanned before a passed disposition is returned", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-evidence-empty-tree-metadata-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const source = path.join(root, "source");
  mkdirSync(source, { mode: 0o700 });
  chmodSync(source, 0o700);
  const privateMember = "token=not-a-real-credential";
  mkdirSync(path.join(source, privateMember), { mode: 0o700 });
  expectTreeError(
    () => inspectConfiguredEvidenceSource({
      root,
      source: managedSource({
        path: "source",
        expectedType: "tree",
        expectedDigest: treeDigest({ directories: [privateMember], files: [] }),
      }),
      sensitivity: "internal",
    }),
    "wakeflow-evidence-privacy-finding",
  );

  const privateRootName = "88888888-8888-4888-8888-888888888888";
  mkdirSync(path.join(root, privateRootName), { mode: 0o700 });
  expectTreeError(
    () => inspectConfiguredEvidenceSource({
      root,
      source: managedSource({
        path: privateRootName,
        expectedType: "tree",
        expectedDigest: treeDigest({ directories: [], files: [] }),
      }),
      sensitivity: "internal",
    }),
    "wakeflow-evidence-privacy",
  );
});

test("direct tree materialization validates the full write before any filesystem mutation", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-evidence-tree-boundary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stateRoot = path.join(root, "demand");
  const evidenceRoot = path.join(stateRoot, "evidence");
  mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
  chmodSync(stateRoot, 0o700);
  chmodSync(evidenceRoot, 0o700);
  const malformed = manifest();
  malformed.payload.directories = ["../../escaped"];
  const write = {
    artifactKind: WAKEFLOW_EVIDENCE_ARTIFACT_KIND,
    artifactId: malformed.evidenceId,
    ref: `evidence/${malformed.evidenceId}/evidence.json`,
    digest: canonicalJsonDigest(malformed),
    value: malformed,
  };
  expectTreeError(
    () => materializeEvidenceStage({ stateRoot, write, resolvedSourceRoot: root }),
    "wakeflow-evidence-tree-write",
  );
  assert.deepEqual(readdirSync(evidenceRoot), []);
  assert.equal(existsSync(path.join(stateRoot, "escaped")), false);
});

test("public evidence tree inputs are exact canonical data and never execute accessors", () => {
  const write = writeIntent();
  const pathInput = { evidenceId: IDS.evidence };
  const sourceInput = {
    source: managedSource(),
    sensitivity: "internal",
  };
  const stageInput = { write };
  const residueInput = {};
  let getterCalls = 0;
  for (const [operation, input] of [
    [inspectConfiguredEvidenceSource, sourceInput],
    [evidenceStagePath, pathInput],
    [evidenceRootPath, { ...pathInput }],
    [inspectEvidenceStage, stageInput],
    [assertNoEvidenceStageResidue, residueInput],
    [materializeEvidenceStage, { write }],
    [publishEvidenceStage, { write }],
    [inspectEvidenceFinalWrite, { write }],
  ]) {
    Object.defineProperty(input, "stateRoot", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "/tmp/forged-evidence-tree-root";
      },
    });
    expectTreeError(
      () => operation(input),
      "wakeflow-evidence-tree-input",
    );
    assert.equal(getterCalls, 0);
  }

  expectTreeError(
    () => evidenceRootPath({
      stateRoot: "/tmp/forged-evidence-tree-root",
      evidenceId: IDS.evidence,
      unknown: true,
    }),
    "wakeflow-evidence-tree-input",
  );
  expectTreeError(
    () => inspectEvidenceStage({
      stateRoot: "/tmp/forged-evidence-tree-root",
      write,
      allowMissing: "yes",
    }),
    "wakeflow-evidence-tree-input",
  );
});

test("configured sources stay owner-neutral while private evidence nodes require the current effective user", (t) => {
  if (process.platform === "win32" || typeof process.geteuid !== "function") {
    t.skip("effective-user ownership is a POSIX boundary");
    return;
  }
  const current = makeStateRoot(t);
  const sourceFile = path.join(current.root, "shared-source.txt");
  writeFileSync(sourceFile, CONTENT, { mode: 0o644 });
  const originalGeteuid = process.geteuid;
  process.geteuid = () => originalGeteuid() + 1;
  try {
    const captured = inspectConfiguredEvidenceSource({
      root: current.root,
      source: managedSource({
        path: "shared-source.txt",
        expectedDigest: byteDigest(CONTENT),
      }),
      sensitivity: "internal",
    });
    assert.equal(captured.payload.files[0].digest, byteDigest(CONTENT));
    expectTreeError(
      () => inspectEvidenceFinalWrite({
        stateRoot: current.root,
        write: writeIntent(current.value),
      }),
      "wakeflow-evidence-tree-directory",
    );
  } finally {
    process.geteuid = originalGeteuid;
  }
});

test("manifest identity is canonical, frozen, and closed against unknown fields", () => {
  const value = manifest();
  const validated = validateEvidenceManifest(value);
  const identity = evidenceIdentity(value);
  const ref = `evidence/${IDS.evidence}/evidence.json`;
  assert.equal(evidenceManifestRef(value), ref);
  assert.equal(evidenceManifestRef(IDS.evidence), ref);
  assert.equal(evidenceManifestDigest(value), canonicalJsonDigest(value));
  assert.deepEqual(evidenceManifestCanonicalBytes(value), Buffer.from(`${canonicalJson(value)}\n`, "utf8"));
  assert.deepEqual(identity, {
    artifactKind: "wakeflow-evidence",
    artifactId: IDS.evidence,
    ref,
    digest: canonicalJsonDigest(value),
  });
  assert.equal(Object.isFrozen(validated), true);
  assert.equal(Object.isFrozen(validated.recordedBy), true);
  assert.equal(Object.isFrozen(identity), true);

  expectRecordError(
    () => validateEvidenceManifest({ ...value, unknown: true }),
    "wakeflow-evidence-unknown-field",
    "$/unknown",
  );
  expectRecordError(
    () => validateEvidenceManifest({ ...value, source: { ...value.source, unknown: true } }),
    "wakeflow-evidence-unknown-field",
    "$/source/unknown",
  );
  expectRecordError(
    () => validateEvidenceManifest({ ...value, payload: { ...value.payload, unknown: true } }),
    "wakeflow-evidence-unknown-field",
    "$/payload/unknown",
  );
  const fileUnknown = clone(value);
  fileUnknown.payload.files[0].unknown = true;
  expectRecordError(
    () => validateEvidenceManifest(fileUnknown),
    "wakeflow-evidence-unknown-field",
    "$/payload/files/0/unknown",
  );
  expectRecordError(
    () => validateEvidenceWriteIntent({ ...writeIntent(value), unknown: true }),
    "wakeflow-evidence-unknown-field",
    "$/unknown",
  );
});

test("public evidence record inputs reject accessors and retired aliases without executing them", () => {
  let getterCalls = 0;
  const source = httpsSource();
  Object.defineProperty(source, "kind", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "https";
    },
  });
  expectRecordError(
    () => validateEvidenceSource(source),
    "wakeflow-evidence-data",
    "$/source",
  );
  assert.equal(getterCalls, 0);

  const ref = `evidence/${IDS.evidence}/evidence.json`;
  for (const [operation, input] of [
    [loadManagedEvidenceByRef, { ref }],
    [inspectManagedEvidenceInventory, {}],
  ]) {
    Object.defineProperty(input, "stateRoot", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "/tmp/forged-evidence-root";
      },
    });
    expectRecordError(
      () => operation(input),
      "wakeflow-evidence-data",
      "$input",
    );
    assert.equal(getterCalls, 0);
  }

  expectRecordError(
    () => inspectManagedEvidenceInventory({
      stateRoot: "/tmp/forged-evidence-root",
      expectedArtifacts: [],
    }),
    "wakeflow-evidence-unknown-field",
    "$input/expectedArtifacts",
  );
});

test("typed IDs, real UTC timestamps, and bounded portable tokens fail closed", () => {
  const wrongProgram = manifest({ programId: IDS.demand });
  expectRecordError(() => validateEvidenceManifest(wrongProgram), "wakeflow-evidence-id", "$/programId");
  const wrongEvidence = manifest({ evidenceId: IDS.demand });
  expectRecordError(() => validateEvidenceManifest(wrongEvidence), "wakeflow-evidence-id", "$/evidenceId");
  const wrongWindow = manifest({ recordedBy: { ...manifest().recordedBy, windowId: IDS.repository } });
  expectRecordError(() => validateEvidenceManifest(wrongWindow), "wakeflow-evidence-id", "$/recordedBy/windowId");
  expectRecordError(
    () => validateEvidenceManifest(manifest({ capturedAt: "2026-02-30T00:00:00Z" })),
    "wakeflow-evidence-timestamp",
    "$/capturedAt",
  );
  expectRecordError(
    () => validateEvidenceManifest(manifest({ capturedAt: "2026-08-07T06:07:08+00:00" })),
    "wakeflow-evidence-timestamp",
    "$/capturedAt",
  );
  for (const kind of [" test-output", "test-output ", "test\u0000output", "x".repeat(129)]) {
    expectRecordError(() => validateEvidenceManifest(manifest({ kind })), "wakeflow-evidence-token", "$/kind");
  }
  assert.equal(validateEvidenceManifest(manifest({ kind: "x".repeat(128) })).kind.length, 128);
});

test("digests and payload byte counts use exact canonical scalar forms", () => {
  expectRecordError(
    () => validateEvidenceManifest(manifest({ demandDigest: `sha256:${"A".repeat(64)}` })),
    "wakeflow-evidence-digest",
    "$/demandDigest",
  );
  const malformedSourceDigest = managedSource({ expectedDigest: "sha256:1234" });
  expectRecordError(
    () => validateEvidenceSource(malformedSourceDigest),
    "wakeflow-evidence-digest",
    "$/source/expectedDigest",
  );
  for (const bytes of [-1, 1.5, (16 * 1024 * 1024) + 1]) {
    const payload = filePayload();
    payload.files[0].bytes = bytes;
    expectRecordError(
      () => validateEvidencePayload(payload),
      "wakeflow-evidence-integer",
      "$/payload/files/0/bytes",
    );
  }
  const badFileDigest = filePayload();
  badFileDigest.files[0].digest = `sha256:${"A".repeat(64)}`;
  expectRecordError(
    () => validateEvidencePayload(badFileDigest),
    "wakeflow-evidence-digest",
    "$/payload/files/0/digest",
  );
  expectRecordError(
    () => evidenceManifestRef(IDS.demand),
    "wakeflow-evidence-id",
    "$evidenceId",
  );
});

test("write intent requires the exact canonical artifact ID, ref, digest, bytes, and demand binding", () => {
  const value = manifest();
  const valid = writeIntent(value);
  assert.deepEqual(validateEvidenceWriteIntent(valid), valid);
  for (const [field, replacement] of [
    ["artifactKind", "wakeflow-task-package"],
    ["artifactId", IDS.evidenceOther],
    ["ref", `evidence/${IDS.evidenceOther}/evidence.json`],
    ["digest", `sha256:${"f".repeat(64)}`],
  ]) {
    expectRecordError(
      () => validateEvidenceWriteIntent({ ...valid, [field]: replacement }),
      "wakeflow-evidence-write",
      `$/` + field,
    );
  }
  const demand = { programId: IDS.program, demandId: IDS.demand, immutable: true };
  const bound = manifest({ demandDigest: canonicalJsonDigest(demand) });
  assert.deepEqual(validateEvidenceWriteIntent(writeIntent(bound), { demand }), writeIntent(bound));
  expectRecordError(
    () => validateEvidenceWriteIntent(writeIntent(value), { demand }),
    "wakeflow-evidence-demand",
    "$/value",
  );
});

test("payload inventory enforces order, uniqueness, parents, totals, tree closure, and depth", () => {
  const first = {
    path: "payload/a.txt",
    bytes: 1,
    digest: byteDigest("a"),
    contentClass: "text/plain",
  };
  const second = {
    path: "payload/b.txt",
    bytes: 1,
    digest: byteDigest("b"),
    contentClass: "text/plain",
  };
  const ordered = {
    directories: ["payload"],
    files: [first, second],
    totalBytes: 2,
    treeDigest: treeDigest({
      directories: [],
      files: [{ ...first, path: "a.txt" }, { ...second, path: "b.txt" }],
    }),
  };
  assert.deepEqual(validateEvidencePayload(ordered), ordered);

  const unsortedFiles = { ...ordered, files: [second, first] };
  expectRecordError(() => validateEvidencePayload(unsortedFiles), "wakeflow-evidence-order", "$/payload/files");
  const duplicateFiles = { ...ordered, files: [first, first] };
  expectRecordError(() => validateEvidencePayload(duplicateFiles), "wakeflow-evidence-order", "$/payload/files");
  const unsortedDirectories = emptyTreePayload(["payload", "payload/z", "payload/a"]);
  expectRecordError(
    () => validateEvidencePayload(unsortedDirectories),
    "wakeflow-evidence-order",
    "$/payload/directories",
  );
  const missingParent = emptyTreePayload(["payload", "payload/a/b"]);
  expectRecordError(
    () => validateEvidencePayload(missingParent),
    "wakeflow-evidence-payload",
    "$/payload/directories",
  );
  const fileMissingParent = {
    ...ordered,
    files: [{ ...first, path: "payload/missing/a.txt" }],
    totalBytes: 1,
    treeDigest: treeDigest({ directories: [], files: [{ ...first, path: "missing/a.txt" }] }),
  };
  expectRecordError(
    () => validateEvidencePayload(fileMissingParent),
    "wakeflow-evidence-payload",
    "$/payload/files",
  );
  expectRecordError(
    () => validateEvidencePayload({ ...ordered, totalBytes: 1 }),
    "wakeflow-evidence-payload",
    "$/payload/totalBytes",
  );
  expectRecordError(
    () => validateEvidencePayload({ ...ordered, treeDigest: `sha256:${"0".repeat(64)}` }),
    "wakeflow-evidence-payload",
    "$/payload/treeDigest",
  );

  const sourceDepth16 = ["payload"];
  while (sourceDepth16.at(-1).split("/").length < 17) sourceDepth16.push(`${sourceDepth16.at(-1)}/a`);
  assert.deepEqual(validateEvidencePayload(emptyTreePayload(sourceDepth16)).directories, sourceDepth16);
  const sourceDepth17 = [...sourceDepth16, `${sourceDepth16.at(-1)}/a`];
  expectRecordError(
    () => validateEvidencePayload(emptyTreePayload(sourceDepth17)),
    "wakeflow-evidence-path",
    "$/payload/directories/17",
  );
});

test("source and payload form an exact one-of contract for file, tree, and locator evidence", () => {
  const managedMissing = manifest();
  delete managedMissing.payload;
  expectRecordError(
    () => validateEvidenceManifest(managedMissing),
    "wakeflow-evidence-source",
    "$/payload",
  );
  expectRecordError(
    () => validateEvidenceManifest({ ...locatorManifest(), payload: filePayload() }),
    "wakeflow-evidence-source",
    "$/payload",
  );
  expectRecordError(
    () => validateEvidenceManifest({ ...locatorManifest(), controllerReviewedOpaque: true }),
    "wakeflow-evidence-content",
    "$/controllerReviewedOpaque",
  );

  const wrongFileShape = manifest({ payload: emptyTreePayload() });
  expectRecordError(() => validateEvidenceManifest(wrongFileShape), "wakeflow-evidence-source", "$/payload");
  const treePayload = emptyTreePayload(["payload", "payload/a"]);
  const treeValue = manifest({
    source: managedSource({ expectedType: "tree", expectedDigest: treePayload.treeDigest }),
    payload: treePayload,
  });
  assert.equal(validateEvidenceManifest(treeValue).source.expectedType, "tree");
  expectRecordError(
    () => validateEvidenceManifest({
      ...treeValue,
      source: { ...treeValue.source, expectedDigest: `sha256:${"0".repeat(64)}` },
    }),
    "wakeflow-evidence-source",
    "$/payload/treeDigest",
  );

  const path16 = Array.from({ length: 16 }, (_, index) => `s${index}`).join("/");
  assert.equal(validateEvidenceSource(managedSource({ path: path16 })).path, path16);
  const path17 = `${path16}/s16`;
  expectRecordError(
    () => validateEvidenceSource(managedSource({ path: path17 })),
    "wakeflow-evidence-path",
    "$/source/path",
  );
});

test("relations admit at most 256 strictly shaped and canonically ordered references", () => {
  const relations = Array.from({ length: 256 }, (_, index) => ({
    kind: "controller-event",
    eventId: `event-evidence-${String(index).padStart(3, "0")}`,
    digest: `sha256:${index.toString(16).padStart(64, "0")}`,
  })).sort((left, right) => lexicalCompare(canonicalJson(left), canonicalJson(right)));
  assert.equal(validateEvidenceManifest(manifest({ relations })).relations.length, 256);
  const tooMany = [...relations, {
    kind: "controller-event",
    eventId: "event-evidence-256",
    digest: `sha256:${"f".repeat(64)}`,
  }].sort((left, right) => lexicalCompare(canonicalJson(left), canonicalJson(right)));
  expectRecordError(
    () => validateEvidenceManifest(manifest({ relations: tooMany })),
    "wakeflow-evidence-relation",
    "$/relations",
  );

  const unknown = [{ ...relations[0], unknown: true }];
  expectRecordError(
    () => validateEvidenceManifest(manifest({ relations: unknown })),
    "wakeflow-evidence-unknown-field",
    "$/relations/0/unknown",
  );
  const artifact = {
    kind: "artifact",
    artifactKind: "wakeflow-task-package",
    artifactId: IDS.taskPackage,
    ref: `task-packages/${IDS.taskPackage}.json`,
    digest: `sha256:${"b".repeat(64)}`,
  };
  assert.deepEqual(validateEvidenceManifest(manifest({ relations: [artifact] })).relations, [artifact]);
  expectRecordError(
    () => validateEvidenceManifest(manifest({ relations: [{ ...artifact, artifactId: IDS.evidence }] })),
    "wakeflow-evidence-id",
    "$/relations/0/artifactId",
  );
  expectRecordError(
    () => validateEvidenceManifest(manifest({ relations: [{ ...artifact, ref: "task-packages/other.json" }] })),
    "wakeflow-evidence-relation",
    "$/relations/0/ref",
  );
  expectRecordError(
    () => validateEvidenceManifest(manifest({ relations: [artifact, artifact] })),
    "wakeflow-evidence-order",
    "$/relations",
  );
});

test("HTTPS locators honor the 2048-byte boundary and reject private or credential metadata", () => {
  const prefix = "https://example.test/";
  const atLimit = `${prefix}${"a".repeat(2048 - Buffer.byteLength(prefix, "utf8"))}`;
  assert.equal(Buffer.byteLength(atLimit, "utf8"), 2048);
  assert.equal(validateEvidenceSource(httpsSource({ url: atLimit })).url, atLimit);
  expectRecordError(
    () => validateEvidenceSource(httpsSource({ url: `${atLimit}a` })),
    "wakeflow-evidence-source",
    "$/source/url",
  );
  const privateMetadata = `${prefix}${["Users", "example", "report.txt"].join("/")}`;
  expectRecordError(
    () => validateEvidenceSource(httpsSource({ url: privateMetadata })),
    "wakeflow-evidence-privacy",
    "$/source/url",
  );
  for (const privateRoot of [
    "tmp",
    "var",
    "Users",
    "D:/work",
    "D%3A/work",
  ]) {
    expectRecordError(
      () => validateEvidenceSource(httpsSource({ url: `${prefix}${privateRoot}` })),
      "wakeflow-evidence-privacy",
      "$/source/url",
    );
  }
  const credentialMetadata = `${prefix}${["token", "not-a-real-credential"].join("=")}`;
  expectRecordError(
    () => validateEvidenceSource(httpsSource({ url: credentialMetadata })),
    "wakeflow-evidence-privacy",
    "$/source/url",
  );
  const hostHandle = `${prefix}host/${"88888888-8888-4888-8888-888888888888"}`;
  expectRecordError(
    () => validateEvidenceSource(httpsSource({ url: hostHandle })),
    "wakeflow-evidence-privacy",
    "$/source/url",
  );
  for (const url of [
    "https://sk-proj-not-a-real-token.example.test/report",
    "https://88888888-8888-4888-8888-888888888888.example.test/report",
    "https://home/report",
  ]) {
    expectRecordError(
      () => validateEvidenceSource(httpsSource({ url })),
      "wakeflow-evidence-privacy",
      "$/source/url",
    );
  }
  for (const url of [
    "https://user@example.test/report",
    "https://example.test/report?download=1",
    "https://example.test/report#fragment",
    "http://example.test/report",
  ]) {
    expectRecordError(() => validateEvidenceSource(httpsSource({ url })), "wakeflow-evidence-source", "$/source/url");
  }
});

test("managed loader closes canonical bytes, manifest cap, demand digest, unsafe files, and payload tamper", async (t) => {
  await t.test("loads exact canonical bytes and exact demand digest", () => {
    const current = makeStateRoot(t);
    const loaded = loadManagedEvidenceByRef({
      stateRoot: current.root,
      ref: current.identity.ref,
      digest: current.identity.digest,
      expectedEvidenceId: IDS.evidence,
      expectedProgramId: IDS.program,
      expectedDemandId: IDS.demand,
      expectedDemandDigest: DEMAND_DIGEST,
    });
    assert.deepEqual(loaded.identity, current.identity);
    assert.deepEqual(loaded.bytes, evidenceManifestCanonicalBytes(current.value));
    assert.equal(loaded.tree.complete, true);
    expectRecordError(
      () => loadManagedEvidenceByRef({
        stateRoot: current.root,
        ref: current.identity.ref,
        expectedDemandDigest: `sha256:${"0".repeat(64)}`,
      }),
      "wakeflow-evidence-demand",
      "$/demandDigest",
    );
  });

  await t.test("rejects non-canonical manifest bytes", () => {
    const current = makeStateRoot(t);
    writeFileSync(
      path.join(current.artifactRoot, "evidence.json"),
      `${JSON.stringify(current.value, null, 2)}\n`,
      { mode: 0o600 },
    );
    expectRecordError(
      () => loadManagedEvidenceByRef({ stateRoot: current.root, ref: current.identity.ref }),
      "wakeflow-evidence-encoding",
      "$ref",
    );
  });

  await t.test("rejects a manifest above the one MiB read cap before parsing", () => {
    const current = makeStateRoot(t);
    writeFileSync(
      path.join(current.artifactRoot, "evidence.json"),
      Buffer.alloc(WAKEFLOW_EVIDENCE_MAX_MANIFEST_BYTES + 1, 0x78),
      { mode: 0o600 },
    );
    expectRecordError(
      () => loadManagedEvidenceByRef({ stateRoot: current.root, ref: current.identity.ref }),
      "wakeflow-evidence-file",
      "$ref/evidence.json",
    );
  });

  await t.test("rejects unsafe linked manifest files", () => {
    const current = makeStateRoot(t);
    const manifestFile = path.join(current.artifactRoot, "evidence.json");
    const secondLink = path.join(current.root, "manifest-hardlink.json");
    linkSync(manifestFile, secondLink);
    expectRecordError(
      () => loadManagedEvidenceByRef({ stateRoot: current.root, ref: current.identity.ref }),
      "wakeflow-evidence-file",
      "$ref/evidence.json",
    );
  });

  await t.test("rejects a symlinked manifest even when its target has valid bytes", () => {
    const current = makeStateRoot(t);
    const manifestFile = path.join(current.artifactRoot, "evidence.json");
    const target = path.join(current.root, "outside-manifest.json");
    writeFileSync(target, evidenceManifestCanonicalBytes(current.value), { mode: 0o600 });
    unlinkSync(manifestFile);
    symlinkSync(target, manifestFile);
    expectRecordError(
      () => loadManagedEvidenceByRef({ stateRoot: current.root, ref: current.identity.ref }),
      "wakeflow-evidence-file",
      "$ref/evidence.json",
    );
  });

  await t.test("rejects payload byte tamper against the immutable inventory", () => {
    const current = makeStateRoot(t);
    writeFileSync(path.join(current.artifactRoot, "payload", "content"), Buffer.from("tampered evidence\n"), { mode: 0o600 });
    expectTreeError(
      () => loadManagedEvidenceByRef({ stateRoot: current.root, ref: current.identity.ref }),
      "wakeflow-evidence-tree-tamper",
    );
  });
});

test("portable member loader returns one fully verified stable inventory of defensive evidence bytes", async (t) => {
  const records = await import("../core/scripts/lib/wakeflow-evidence-records.mjs");
  assert.equal(
    typeof records.loadManagedEvidencePortableMembers,
    "function",
    "M2-T09 requires a byte-bearing loader for the already verified evidence tree",
  );
  const current = makeStateRoot(t);
  const args = {
    stateRoot: current.root,
    ref: current.identity.ref,
    digest: current.identity.digest,
    expectedEvidenceId: IDS.evidence,
    expectedProgramId: IDS.program,
    expectedDemandId: IDS.demand,
    expectedDemandDigest: DEMAND_DIGEST,
  };
  const members = records.loadManagedEvidencePortableMembers(args);
  const manifestRef = `evidence/${IDS.evidence}/evidence.json`;
  const payloadRef = `evidence/${IDS.evidence}/payload/content`;
  assert.deepEqual(members.map((entry) => entry.ref), [manifestRef, payloadRef]);
  assert.deepEqual(members.map((entry) => entry.ref).sort(lexicalCompare), [manifestRef, payloadRef]);
  assert.deepEqual(members.map((entry) => Object.keys(entry).sort()), [
    ["byteDigest", "bytes", "ref"],
    ["byteDigest", "bytes", "ref"],
  ]);
  assert.deepEqual(members[0].bytes, evidenceManifestCanonicalBytes(current.value));
  assert.deepEqual(members[1].bytes, CONTENT);
  for (const member of members) {
    assert.equal(member.byteDigest, byteDigest(member.bytes));
    assert.equal(Object.isFrozen(member), true);
  }
  assert.equal(Object.isFrozen(members), true);

  const originalManifestBytes = Buffer.from(members[0].bytes);
  const originalPayloadBytes = Buffer.from(members[1].bytes);
  members[0].bytes.fill(0x78);
  members[1].bytes.fill(0x79);
  assert.deepEqual(readFileSync(path.join(current.artifactRoot, "evidence.json")), originalManifestBytes);
  assert.deepEqual(readFileSync(path.join(current.artifactRoot, "payload", "content")), originalPayloadBytes);
  const replay = records.loadManagedEvidencePortableMembers(args);
  assert.deepEqual(replay[0].bytes, originalManifestBytes);
  assert.deepEqual(replay[1].bytes, originalPayloadBytes);

  writeFileSync(path.join(current.artifactRoot, "payload", "undeclared.txt"), "undeclared\n", { mode: 0o600 });
  assert.throws(
    () => records.loadManagedEvidencePortableMembers(args),
    (error) => error?.code === "wakeflow-evidence-tree-unknown",
  );
});

test("managed inventory binds demandDigest and classifies missing, orphan, unsafe, staged, and tampered roots", async (t) => {
  await t.test("reports one exact committed identity", () => {
    const current = makeStateRoot(t);
    const inventory = inspectManagedEvidenceInventory({
      stateRoot: current.root,
      expectedProgramId: IDS.program,
      expectedDemandId: IDS.demand,
      expectedDemandDigest: DEMAND_DIGEST,
      expectedEvidence: [{
        evidenceId: IDS.evidence,
        ref: current.identity.ref,
        digest: current.identity.digest,
      }],
    });
    assert.equal(inventory.healthy, true);
    assert.equal(inventory.expectedCount, 1);
    assert.equal(inventory.observedCount, 1);
    assert.deepEqual(inventory.issues, []);
    assert.equal(inventory.entries[0].classification, "committed");
  });

  await t.test("classifies demand digest drift as invalid", () => {
    const current = makeStateRoot(t);
    const inventory = inspectManagedEvidenceInventory({
      stateRoot: current.root,
      expectedDemandDigest: `sha256:${"0".repeat(64)}`,
      expectedEvidence: [current.identity],
    });
    assert.equal(inventory.healthy, false);
    assert.deepEqual(inventory.entries, []);
    assert.deepEqual(inventory.issues, [{
      ref: current.identity.ref,
      classification: "invalid",
      code: "wakeflow-evidence-demand",
    }]);
  });

  await t.test("reports an unreferenced exact root as orphan", () => {
    const current = makeStateRoot(t);
    const inventory = inspectManagedEvidenceInventory({ stateRoot: current.root });
    assert.equal(inventory.healthy, false);
    assert.equal(inventory.entries[0].classification, "orphan");
    assert.deepEqual(inventory.issues, [{
      ref: current.identity.ref,
      classification: "orphan",
      code: "wakeflow-evidence-inventory-orphan",
    }]);
  });

  await t.test("reports an expected but absent root as missing", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-evidence-inventory-empty-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    chmodSync(root, 0o700);
    mkdirSync(path.join(root, "evidence"), { mode: 0o700 });
    const identity = evidenceIdentity(manifest());
    const inventory = inspectManagedEvidenceInventory({ stateRoot: root, expectedEvidence: [identity] });
    assert.equal(inventory.healthy, false);
    assert.deepEqual(inventory.issues, [{
      ref: identity.ref,
      classification: "missing",
      code: "wakeflow-evidence-inventory-missing",
    }]);
  });

  await t.test("separates a capability-root failure from an opaque unknown child", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-evidence-inventory-opaque-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    chmodSync(root, 0o700);
    const evidenceRoot = path.join(root, "evidence");
    mkdirSync(evidenceRoot, { mode: 0o700 });
    const privateBasename = "PRIVATE_EVIDENCE_SESSION_PID_4242";
    writeFileSync(path.join(evidenceRoot, privateBasename), "unknown\n", { mode: 0o600 });

    const first = inspectManagedEvidenceInventory({ stateRoot: root });
    const second = inspectManagedEvidenceInventory({ stateRoot: root });
    assert.equal(first.healthy, false);
    assert.deepEqual(first.issues, second.issues);
    assert.equal(first.issues.length, 1);
    assert.equal(first.issues[0].classification, "invalid");
    assert.equal(first.issues[0].code, "wakeflow-evidence-inventory-unknown-entry");
    assert.match(first.issues[0].ref, /^evidence\/unknown-sha256-[0-9a-f]{64}$/u);
    assert.equal(JSON.stringify(first).includes(privateBasename), false);

    rmSync(evidenceRoot, { recursive: true, force: true });
    writeFileSync(evidenceRoot, "not a capability directory\n", { mode: 0o600 });
    const rootFailure = inspectManagedEvidenceInventory({ stateRoot: root });
    assert.deepEqual(rootFailure.issues, [{
      ref: "evidence/",
      classification: "invalid",
      code: "wakeflow-evidence-inventory-capability-root-failure",
    }]);
  });

  await t.test("reports a deterministic stage residue as incomplete", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-evidence-inventory-stage-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    chmodSync(root, 0o700);
    const evidenceRoot = path.join(root, "evidence");
    mkdirSync(evidenceRoot, { mode: 0o700 });
    mkdirSync(path.join(evidenceRoot, `.${IDS.evidence}.wakeflow-stage`), { mode: 0o700 });
    const inventory = inspectManagedEvidenceInventory({ stateRoot: root });
    assert.equal(inventory.healthy, false);
    assert.deepEqual(inventory.issues, [{
      ref: `evidence/.${IDS.evidence}.wakeflow-stage`,
      classification: "incomplete",
      code: "wakeflow-evidence-inventory-stage-residue",
    }]);
  });

  await t.test("reports unsafe or tampered roots without admitting an entry", () => {
    const current = makeStateRoot(t);
    writeFileSync(path.join(current.artifactRoot, "payload", "content"), Buffer.from("tampered evidence\n"), { mode: 0o600 });
    const inventory = inspectManagedEvidenceInventory({
      stateRoot: current.root,
      expectedEvidence: [current.identity],
    });
    assert.equal(inventory.healthy, false);
    assert.deepEqual(inventory.entries, []);
    assert.deepEqual(inventory.issues, [{
      ref: current.identity.ref,
      classification: "invalid",
      code: "wakeflow-evidence-tree-tamper",
    }]);
  });

  await t.test("reports an unsafe hardlinked manifest without admitting an entry", () => {
    const current = makeStateRoot(t);
    linkSync(
      path.join(current.artifactRoot, "evidence.json"),
      path.join(current.root, "manifest-hardlink.json"),
    );
    const inventory = inspectManagedEvidenceInventory({
      stateRoot: current.root,
      expectedEvidence: [current.identity],
    });
    assert.equal(inventory.healthy, false);
    assert.deepEqual(inventory.entries, []);
    assert.deepEqual(inventory.issues, [{
      ref: current.identity.ref,
      classification: "invalid",
      code: "wakeflow-evidence-file",
    }]);
  });
});
