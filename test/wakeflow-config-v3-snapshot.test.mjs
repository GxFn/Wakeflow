import assert from "node:assert/strict";
import {
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configFixture = path.join(
  repositoryRoot,
  "test/fixtures/wakeflow-config-v3/valid-minimal.json",
);
const modulePath = "../core/scripts/lib/wakeflow-config-v3-snapshot.mjs";
const CONFIG_REF = "wakeflow.config.json";
const CONFIG_LIMIT = 1024 * 1024;

function candidateConfig() {
  return JSON.parse(readFileSync(configFixture, "utf8"));
}

function writeConfig(file, value = candidateConfig()) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function fixture(t, value = candidateConfig()) {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-config-snapshot-"));
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  const workspaceRoot = path.join(temporaryRoot, "WakeflowProgram");
  mkdirSync(workspaceRoot, { mode: 0o700 });
  const configPath = path.join(workspaceRoot, CONFIG_REF);
  writeConfig(configPath, value);
  return { temporaryRoot, workspaceRoot, configPath, value };
}

function deepFrozen(value) {
  if (!value || typeof value !== "object") return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every(deepFrozen);
}

function capture(operation) {
  let failure = null;
  try {
    operation();
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof Error, "operation must fail closed");
  return failure;
}

function assertSnapshotFailure(operation, expectedCode, forbidden = []) {
  const error = capture(operation);
  assert.equal(error.name, "WakeflowConfigV3SnapshotError");
  assert.equal(error.code, expectedCode, error.stack);
  assert.equal(Object.hasOwn(error, "cause"), false);
  assert.equal(error.cause, undefined);
  const publicSurface = JSON.stringify({ message: error.message, details: error.details });
  for (const secret of forbidden) assert.equal(publicSurface.includes(secret), false);
  return error;
}

test("config v3 snapshot exposes one exact deeply frozen canonical snapshot", async (t) => {
  const api = await import(modulePath);
  assert.deepEqual(Object.keys(api).sort(), [
    "WAKEFLOW_CONFIG_V3_SNAPSHOT_SCHEMA_VERSION",
    "WakeflowConfigV3SnapshotError",
    "loadWakeflowConfigV3Snapshot",
  ]);
  assert.equal(api.WAKEFLOW_CONFIG_V3_SNAPSHOT_SCHEMA_VERSION, 1);

  const current = fixture(t);
  const snapshot = api.loadWakeflowConfigV3Snapshot({ workspaceRoot: current.workspaceRoot });
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.kind, "WakeflowConfigV3Snapshot");
  assert.equal(snapshot.ref, CONFIG_REF);
  assert.equal(snapshot.workspaceRoot, path.resolve(current.workspaceRoot));
  assert.equal(
    snapshot.ledgerRoot,
    path.resolve(current.workspaceRoot, current.value.storage.ledgerRoot),
  );
  assert.equal(snapshot.model.program.programId, current.value.program.programId);
  assert.equal(snapshot.indexes.controllerWindow.role, "controller");
  assert.match(snapshot.sourceDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(snapshot.configDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(deepFrozen(snapshot), true);
  assert.throws(() => {
    snapshot.model.program.displayName = "mutated";
  }, TypeError);
});

test("snapshot accepts only an existing real workspace root and its canonical config basename", async (t) => {
  const { loadWakeflowConfigV3Snapshot } = await import(modulePath);
  const current = fixture(t);
  assertSnapshotFailure(
    () => loadWakeflowConfigV3Snapshot({ workspaceRoot: current.workspaceRoot, configPath: current.configPath }),
    "wakeflow-config-v3-snapshot-input",
    [current.workspaceRoot, current.configPath],
  );

  const privateCause = path.join(current.temporaryRoot, "raw-private-cause");
  const hostileInput = new Proxy({}, {
    ownKeys() {
      throw new Error(privateCause);
    },
  });
  assertSnapshotFailure(
    () => loadWakeflowConfigV3Snapshot(hostileInput),
    "wakeflow-config-v3-snapshot-load",
    [current.temporaryRoot, privateCause],
  );

  const missingRoot = path.join(current.temporaryRoot, "missing-private-workspace");
  assertSnapshotFailure(
    () => loadWakeflowConfigV3Snapshot({ workspaceRoot: missingRoot }),
    "wakeflow-config-v3-snapshot-workspace",
    [current.temporaryRoot, missingRoot],
  );

  const actualRoot = path.join(current.temporaryRoot, "actual-root");
  const linkedRoot = path.join(current.temporaryRoot, "linked-root");
  mkdirSync(actualRoot, { mode: 0o700 });
  writeConfig(path.join(actualRoot, CONFIG_REF));
  symlinkSync(actualRoot, linkedRoot, "dir");
  assertSnapshotFailure(
    () => loadWakeflowConfigV3Snapshot({ workspaceRoot: linkedRoot }),
    "wakeflow-config-v3-snapshot-workspace",
    [current.temporaryRoot, actualRoot, linkedRoot],
  );

  rmSync(current.configPath);
  writeConfig(path.join(current.workspaceRoot, "not-the-config.json"));
  assertSnapshotFailure(
    () => loadWakeflowConfigV3Snapshot({ workspaceRoot: current.workspaceRoot }),
    "wakeflow-config-v3-snapshot-source",
    [current.workspaceRoot, current.configPath],
  );
});

test("config symlinks and multiply linked files fail closed without path disclosure", async (t) => {
  const { loadWakeflowConfigV3Snapshot } = await import(modulePath);

  const symbolic = fixture(t);
  const symlinkTarget = path.join(symbolic.temporaryRoot, "private-config-target.json");
  rmSync(symbolic.configPath);
  writeConfig(symlinkTarget);
  symlinkSync(symlinkTarget, symbolic.configPath);
  assertSnapshotFailure(
    () => loadWakeflowConfigV3Snapshot({ workspaceRoot: symbolic.workspaceRoot }),
    "wakeflow-config-v3-snapshot-source",
    [symbolic.temporaryRoot, symbolic.configPath, symlinkTarget],
  );

  const hardlinked = fixture(t);
  const hardlinkTarget = path.join(hardlinked.temporaryRoot, "private-hardlink-target.json");
  rmSync(hardlinked.configPath);
  writeConfig(hardlinkTarget);
  linkSync(hardlinkTarget, hardlinked.configPath);
  assert.equal(lstatSync(hardlinked.configPath).nlink, 2);
  assertSnapshotFailure(
    () => loadWakeflowConfigV3Snapshot({ workspaceRoot: hardlinked.workspaceRoot }),
    "wakeflow-config-v3-snapshot-source",
    [hardlinked.temporaryRoot, hardlinked.configPath, hardlinkTarget],
  );
});

test("invalid UTF-8, oversized bytes, invalid JSON, and non-v3 config stay distinct and sanitized", async (t) => {
  const { loadWakeflowConfigV3Snapshot } = await import(modulePath);
  const scenarios = [
    {
      name: "invalid UTF-8",
      code: "wakeflow-config-v3-snapshot-encoding",
      bytes: Buffer.from([0xc3, 0x28]),
    },
    {
      name: "oversized source",
      code: "wakeflow-config-v3-snapshot-source",
      bytes: Buffer.alloc(CONFIG_LIMIT + 1, 0x20),
    },
    {
      name: "invalid JSON",
      code: "wakeflow-config-v3-snapshot-json",
      bytes: Buffer.from("{not-json}\n", "utf8"),
    },
    {
      name: "non-v3 config",
      code: "wakeflow-config-v3-snapshot-config",
      bytes: Buffer.from(`${JSON.stringify({ ...candidateConfig(), unexpected: true })}\n`, "utf8"),
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, () => {
      const current = fixture(t);
      writeFileSync(current.configPath, scenario.bytes, { mode: 0o600 });
      assertSnapshotFailure(
        () => loadWakeflowConfigV3Snapshot({ workspaceRoot: current.workspaceRoot }),
        scenario.code,
        [current.temporaryRoot, current.workspaceRoot, current.configPath],
      );
    });
  }
});

test("config owner never admits bytes beyond the runtime snapshot limit", async (t) => {
  const { inspectWakeflowConfigV3FreshSource } = await import(
    "../core/scripts/lib/wakeflow-config-v3-owner.mjs"
  );
  const { loadWakeflowConfigV3Snapshot } = await import(modulePath);
  const { parseWakeflowConfigV3, serializeWakeflowConfigV3 } = await import(
    "../core/scripts/lib/wakeflow-config-v3.mjs"
  );
  const current = fixture(t);
  rmSync(current.configPath);

  const boundaryCandidate = candidateConfig();
  boundaryCandidate.program.description = "x";
  const oneCharacterBytes = serializeWakeflowConfigV3(parseWakeflowConfigV3(boundaryCandidate));
  const fixedByteCount = Buffer.byteLength(oneCharacterBytes, "utf8") - 1;
  boundaryCandidate.program.description = "x".repeat(CONFIG_LIMIT - fixedByteCount);
  const boundaryModel = parseWakeflowConfigV3(boundaryCandidate);
  const boundaryBytes = serializeWakeflowConfigV3(boundaryModel);
  assert.equal(Buffer.byteLength(boundaryBytes, "utf8"), CONFIG_LIMIT);

  const ownerInspection = inspectWakeflowConfigV3FreshSource({
    workspaceRoot: current.workspaceRoot,
    model: boundaryModel,
  });
  assert.equal(ownerInspection.classification, "absent");
  writeFileSync(current.configPath, boundaryBytes, { mode: 0o600 });
  assert.equal(
    loadWakeflowConfigV3Snapshot({ workspaceRoot: current.workspaceRoot }).model.program.description.length,
    boundaryModel.program.description.length,
  );

  const oversizedCandidate = structuredClone(boundaryCandidate);
  oversizedCandidate.program.description += "x";
  const oversizedModel = parseWakeflowConfigV3(oversizedCandidate);
  const oversizedBytes = serializeWakeflowConfigV3(oversizedModel);
  assert.equal(Buffer.byteLength(oversizedBytes, "utf8"), CONFIG_LIMIT + 1);
  assert.throws(
    () => inspectWakeflowConfigV3FreshSource({
      workspaceRoot: current.workspaceRoot,
      model: oversizedModel,
    }),
    (error) => error?.code === "wakeflow-config-v3-owner-size",
  );

  writeFileSync(current.configPath, oversizedBytes);
  assertSnapshotFailure(
    () => loadWakeflowConfigV3Snapshot({ workspaceRoot: current.workspaceRoot }),
    "wakeflow-config-v3-snapshot-source",
    [current.temporaryRoot, current.workspaceRoot, current.configPath],
  );
});

test("unsafe or overlapping configured placements fail before a snapshot is returned", async (t) => {
  const { loadWakeflowConfigV3Snapshot } = await import(modulePath);
  const value = candidateConfig();
  value.storage.ledgerRoot = ".wakeflow-active";
  const current = fixture(t, value);
  assertSnapshotFailure(
    () => loadWakeflowConfigV3Snapshot({ workspaceRoot: current.workspaceRoot }),
    "wakeflow-config-v3-snapshot-placement",
    [current.temporaryRoot, current.workspaceRoot, current.configPath],
  );
});

test("the source reader compares descriptor and path stats before and after reading", () => {
  const source = readFileSync(
    path.join(repositoryRoot, "core/scripts/lib/wakeflow-config-v3-snapshot.mjs"),
    "utf8",
  );
  assert.match(source, /const before = inspectConfigSource\(file\)/u);
  assert.match(source, /opened = fstatSync\(descriptor, \{ bigint: true \}\)/u);
  assert.match(source, /afterDescriptor = fstatSync\(descriptor, \{ bigint: true \}\)/u);
  assert.match(source, /afterPath = lstatSync\(file, \{ bigint: true \}\)/u);
  assert.match(source, /sameFileSnapshot\(opened, afterDescriptor\)/u);
  assert.match(source, /sameFileSnapshot\(opened, afterPath\)/u);
});
