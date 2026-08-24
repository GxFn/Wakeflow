import assert from "node:assert/strict";
import fs, {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
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
import { fileURLToPath, pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import {
  WAKEFLOW_WINDOW_COORDINATION_LEASE_KIND,
  WAKEFLOW_WINDOW_COORDINATION_LEASE_SCHEMA_VERSION,
  createWindowCoordinationLeaseRecord,
  generateWindowCoordinationLeaseId,
  validateWindowCoordinationLeaseRecord,
  windowCoordinationLeaseCanonicalBytes,
  windowCoordinationLeaseDigest,
  windowCoordinationLeaseRef,
} from "../core/scripts/lib/wakeflow-window-lease-records.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import { hostProfile as codexProfile } from "../core/scripts/lib/wakeflow-host-profile.mjs";
import { hostProfile as claudeProfile } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import {
  parseWakeflowConfigV3,
  wakeflowConfigV3Digest,
} from "../core/scripts/lib/wakeflow-config-v3.mjs";
import { createWakeflowLayoutDescriptor } from "../core/scripts/lib/wakeflow-layout-descriptor.mjs";
import { inspectWakeflowLocalLayout } from "../core/scripts/lib/wakeflow-local-layout-inspection.mjs";
import {
  createWindowBindingRecord,
  windowBindingCanonicalBytes,
  windowBindingDigest,
  windowBindingRef,
} from "../core/scripts/lib/wakeflow-window-binding-records.mjs";
import {
  inspectWindowBindingInventoryForProtocolHost,
} from "../core/scripts/lib/wakeflow-window-binding-service.mjs";
import {
  acquireWindowCoordinationLease,
  acquireWindowCoordinationLeaseAdmitted,
  inspectWindowCoordinationLeaseInventory,
  releaseWindowCoordinationLease,
  releaseWindowCoordinationLeaseAdmitted,
} from "../core/scripts/lib/wakeflow-window-lease-service.mjs";
import {
  inspectWakeflowWorkspaceMutation,
  withWakeflowRuntimeMutation,
} from "../core/scripts/lib/wakeflow-workspace-mutation.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaFile = path.join(
  repositoryRoot,
  "core/schemas/wakeflow-coordination/window-lease.schema.json",
);
const minimalConfigFile = path.join(
  repositoryRoot,
  "test/fixtures/wakeflow-config-v3/valid-minimal.json",
);
const fullConfigFile = path.join(
  repositoryRoot,
  "test/fixtures/wakeflow-config-v3/valid-full.json",
);

const IDS = Object.freeze({
  program: "program_11111111-1111-4111-8111-111111111111",
  repository: "repository_22222222-2222-4222-8222-222222222222",
  repositoryTwo: "repository_abababab-abab-4bab-8bab-abababababab",
  controller: "window_55555555-5555-4555-8555-555555555555",
  design: "window_66666666-6666-4666-8666-666666666666",
  product: "window_88888888-8888-4888-8888-888888888888",
  productAlias: "window_99999999-9999-4999-8999-999999999999",
  productTwo: "window_bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc",
  test: "window_77777777-7777-4777-8777-777777777777",
  dynamic: "window_cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
  demand: "demand_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  demandTwo: "demand_abababab-abab-4bab-8bab-abababababab",
  targetTask: "target-task_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  targetTaskTwo: "target-task_aeaeaeae-aeae-4eae-8eae-aeaeaeaeaeae",
  lease: "lease_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  binding: "binding_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  bindingTwo: "binding_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  bindingThree: "binding_fefefefe-fefe-4efe-8efe-fefefefefefe",
  group: "group-m3-t05-0001",
  delivery: "delivery-m3-t05-0001",
});
const DIGESTS = Object.freeze({
  group: `sha256:${"a".repeat(64)}`,
  envelope: `sha256:${"b".repeat(64)}`,
  binding: `sha256:${"c".repeat(64)}`,
});
const ACQUIRED_AT = "2026-08-08T08:08:08.000Z";
const EXPIRES_AT = "2026-08-08T10:08:08.000Z";
const HANDLE_A = "10000000-0000-4000-8000-000000000001";
const HANDLE_B = "20000000-0000-4000-8000-000000000002";
const HANDLE_C = "30000000-0000-4000-8000-000000000003";

function configFixture(file = minimalConfigFile) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function ensurePrivateDirectory(workspaceRoot, ref) {
  let current = workspaceRoot;
  for (const segment of ref.split("/")) {
    current = path.join(current, segment);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    chmodSync(current, 0o700);
  }
  return current;
}

function prepareWorkspace(t, { config = configFixture(), profile = codexProfile } = {}) {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-window-lease-v3-"));
  const workspaceRoot = path.join(fixtureRoot, "Program");
  mkdirSync(workspaceRoot, { mode: 0o700 });
  for (const configured of [
    ...config.topology.repositories.map((entry) => entry.path),
    ...config.topology.supportSurfaces.map((entry) => entry.path),
    config.storage.ledgerRoot,
  ]) {
    const absolute = path.resolve(workspaceRoot, configured);
    if (!existsSync(absolute)) mkdirSync(absolute, { recursive: true, mode: 0o700 });
    chmodSync(absolute, 0o700);
  }
  for (const ref of [
    ".wakeflow-local/runtime/maintenance/transactions",
    ".wakeflow-local/runtime/shared/coordination/window-leases",
    `.wakeflow-local/runtime/hosts/${profile.runtime.hostDirName}/identity/window-bindings`,
  ]) {
    ensurePrivateDirectory(workspaceRoot, ref);
  }
  const configFile = path.join(workspaceRoot, "wakeflow.config.json");
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(configFile, 0o600);
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  return workspaceRoot;
}

function writeBindingFixture(workspaceRoot, {
  windowId = IDS.product,
  bindingId = IDS.binding,
  handle = HANDLE_A,
  profile = codexProfile,
} = {}) {
  const record = createWindowBindingRecord({
    programId: IDS.program,
    hostId: profile.hostId,
    windowId,
    bindingId,
    handle: { kind: profile.handleId.kind, value: handle },
    registeredAt: ACQUIRED_AT,
  });
  const ref = windowBindingRef({
    hostDirName: profile.runtime.hostDirName,
    windowId,
  });
  const file = path.resolve(workspaceRoot, ...ref.split("/"));
  writeFileSync(file, windowBindingCanonicalBytes(record), { flag: "wx", mode: 0o600 });
  chmodSync(file, 0o600);
  return Object.freeze({
    bindingId,
    identityBindingDigest: windowBindingDigest(record),
    identityRef: ref,
  });
}

function acquireInput(workspaceRoot, binding, overrides = {}) {
  return {
    workspaceRoot,
    windowId: IDS.product,
    demandId: IDS.demand,
    targetTaskId: IDS.targetTask,
    groupId: IDS.group,
    groupDigest: DIGESTS.group,
    deliveryId: IDS.delivery,
    envelopeDigest: DIGESTS.envelope,
    bindingId: binding.bindingId,
    identityBindingDigest: binding.identityBindingDigest,
    ...overrides,
  };
}

function releaseInput(workspaceRoot, acquired, overrides = {}) {
  return {
    workspaceRoot,
    windowId: acquired.lease.windowId,
    leaseId: acquired.lease.leaseId,
    deliveryId: acquired.lease.deliveryId,
    bindingId: acquired.lease.bindingId,
    leaseDigest: acquired.lease.leaseDigest,
    ...overrides,
  };
}

function leaseFile(workspaceRoot, windowId = IDS.product) {
  return path.resolve(
    workspaceRoot,
    ...windowCoordinationLeaseRef({ windowId }).split("/"),
  );
}

function writeLeaseFixture(workspaceRoot, binding, overrides = {}, options = {}) {
  const record = createWindowCoordinationLeaseRecord({
    programId: IDS.program,
    hostId: "codex",
    windowId: IDS.product,
    leaseId: IDS.lease,
    demandId: IDS.demand,
    targetTaskId: IDS.targetTask,
    groupId: IDS.group,
    groupDigest: DIGESTS.group,
    deliveryId: IDS.delivery,
    envelopeDigest: DIGESTS.envelope,
    bindingId: binding.bindingId,
    identityBindingDigest: binding.identityBindingDigest,
    ...(options.withClaim === false ? {} : {
      repositoryId: IDS.repository,
      checkoutResourceKey: `main:${IDS.repository}`,
    }),
    acquiredAt: ACQUIRED_AT,
    expiresAt: EXPIRES_AT,
    ...overrides,
  });
  const target = leaseFile(workspaceRoot, record.windowId);
  writeFileSync(target, windowCoordinationLeaseCanonicalBytes(record), {
    flag: "wx",
    mode: options.mode ?? 0o600,
  });
  chmodSync(target, options.mode ?? 0o600);
  return Object.freeze({ record, target });
}

function leaseDirectorySnapshot(workspaceRoot) {
  const directory = path.dirname(leaseFile(workspaceRoot));
  return readdirSync(directory).sort().map((name) => {
    const file = path.join(directory, name);
    const stat = lstatSync(file);
    return {
      name,
      type: stat.isSymbolicLink() ? "symlink" : stat.isFile() ? "file" : "other",
      mode: stat.mode & 0o777,
      nlink: stat.nlink,
      bytes: stat.isFile() ? readFileSync(file).toString("base64") : null,
    };
  });
}

function errorText(error) {
  return [
    error?.name,
    error?.message,
    error?.code,
    JSON.stringify(error?.details ?? null),
  ].join("\n");
}

function importSpecifiers(source) {
  const specifiers = [];
  const pattern = /(?:from\s+|import\s*\()(["'])([^"']+)\1/gu;
  for (const match of source.matchAll(pattern)) specifiers.push(match[2]);
  return specifiers;
}

function listProductionModules(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && [".mjs", ".cjs"].includes(path.extname(entry.name))) {
        files.push(absolute);
      }
    }
  };
  visit(root);
  return files;
}

function recordFixture(overrides = {}, { withClaim = true } = {}) {
  return createWindowCoordinationLeaseRecord({
    programId: IDS.program,
    hostId: "codex",
    windowId: IDS.product,
    leaseId: IDS.lease,
    demandId: IDS.demand,
    targetTaskId: IDS.targetTask,
    groupId: IDS.group,
    groupDigest: DIGESTS.group,
    deliveryId: IDS.delivery,
    envelopeDigest: DIGESTS.envelope,
    bindingId: IDS.binding,
    identityBindingDigest: DIGESTS.binding,
    ...(withClaim ? {
      repositoryId: IDS.repository,
      checkoutResourceKey: `main:${IDS.repository}`,
    } : {}),
    acquiredAt: ACQUIRED_AT,
    expiresAt: EXPIRES_AT,
    ...overrides,
  });
}

test("T05 lease schema and codec close one exact stable-window owner record", () => {
  assert.equal(WAKEFLOW_WINDOW_COORDINATION_LEASE_SCHEMA_VERSION, 1);
  assert.equal(
    WAKEFLOW_WINDOW_COORDINATION_LEASE_KIND,
    "wakeflow-window-coordination-lease",
  );

  const schema = JSON.parse(readFileSync(schemaFile, "utf8"));
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.kind.const, WAKEFLOW_WINDOW_COORDINATION_LEASE_KIND);
  assert.equal(
    schema.properties.schemaVersion.const,
    WAKEFLOW_WINDOW_COORDINATION_LEASE_SCHEMA_VERSION,
  );

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addFormat(
    "date-time",
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u,
  );
  const validateSchema = ajv.compile(schema);
  const record = recordFixture();
  assert.equal(validateSchema(record), true, JSON.stringify(validateSchema.errors));
  assert.equal(Object.isFrozen(record), true);
  assert.deepEqual(Object.keys(record), [
    "kind",
    "schemaVersion",
    "programId",
    "hostId",
    "windowId",
    "leaseId",
    "demandId",
    "targetTaskId",
    "groupId",
    "groupRef",
    "groupDigest",
    "deliveryId",
    "envelopeRef",
    "envelopeDigest",
    "identityRef",
    "bindingId",
    "identityBindingDigest",
    "repositoryId",
    "checkoutResourceKey",
    "acquiredAt",
    "expiresAt",
    "leaseDigest",
  ]);
  assert.equal(
    record.groupRef,
    `.wakeflow-local/runtime/shared/transport/demands/${IDS.demand}/groups/${IDS.group}.json`,
  );
  assert.equal(
    record.envelopeRef,
    `.wakeflow-local/runtime/shared/transport/demands/${IDS.demand}/envelopes/${IDS.delivery}.json`,
  );
  assert.equal(
    record.identityRef,
    `.wakeflow-local/runtime/hosts/codex/identity/window-bindings/${IDS.product}.json`,
  );
  assert.equal(
    windowCoordinationLeaseRef({ windowId: IDS.product }),
    `.wakeflow-local/runtime/shared/coordination/window-leases/${IDS.product}.json`,
  );

  const { leaseDigest, ...unsigned } = record;
  assert.equal(leaseDigest, canonicalJsonDigest(unsigned));
  assert.equal(windowCoordinationLeaseDigest(record), leaseDigest);
  assert.deepEqual(
    windowCoordinationLeaseCanonicalBytes(record),
    Buffer.from(`${canonicalJson(record)}\n`, "utf8"),
  );

  for (const forbidden of [
    "windowName",
    "displayName",
    "repositoryPath",
    "cwd",
    "handle",
    "threadId",
    "sessionId",
    "prompt",
    "podId",
    "podManifest",
    "status",
    "renewedAt",
    "lastSeenAt",
  ]) {
    assert.throws(
      () => validateWindowCoordinationLeaseRecord({ ...record, [forbidden]: "forbidden" }),
      /lease|field|unknown|coordination/iu,
      forbidden,
    );
  }

  const testWindowLease = recordFixture({ windowId: IDS.test }, { withClaim: false });
  assert.equal(validateSchema(testWindowLease), true, JSON.stringify(validateSchema.errors));
  assert.equal(Object.hasOwn(testWindowLease, "repositoryId"), false);
  assert.equal(Object.hasOwn(testWindowLease, "checkoutResourceKey"), false);

  assert.throws(
    () => recordFixture({ checkoutResourceKey: `main:repository_99999999-9999-4999-8999-999999999999` }),
    /checkout|repository|lease|claim/iu,
  );
  assert.throws(
    () => recordFixture({ checkoutResourceKey: null }),
    /checkout|repository|lease|claim/iu,
  );
  assert.throws(
    () => recordFixture({ expiresAt: ACQUIRED_AT }),
    /expires|acquired|time|lease/iu,
  );
  assert.throws(
    () => validateWindowCoordinationLeaseRecord({ ...record, leaseDigest: DIGESTS.group }),
    /digest|lease/iu,
  );
  let coercions = 0;
  const hostileTransportId = {
    toString() {
      coercions += 1;
      return "group-must-not-coerce";
    },
  };
  assert.throws(
    () => recordFixture({ groupId: hostileTransportId }),
    /group|transport|identifier|lease/iu,
  );
  assert.equal(coercions, 0);
  assert.throws(
    () => recordFixture({ deliveryId: Symbol("private") }),
    /delivery|transport|identifier|lease/iu,
  );
  assert.throws(
    () => generateWindowCoordinationLeaseId(() => hostileTransportId),
    /uuid|source|identifier|lease/iu,
  );
  assert.equal(coercions, 0);
});

test("T05 acquire creates once, exact replay is byte stable, and release is exact", async (t) => {
  const workspaceRoot = prepareWorkspace(t);
  const binding = writeBindingFixture(workspaceRoot);
  const initial = inspectWindowCoordinationLeaseInventory({ workspaceRoot });
  assert.equal(initial.status, "empty");
  assert.deepEqual(initial.leases, []);

  const created = await acquireWindowCoordinationLease(acquireInput(workspaceRoot, binding));
  assert.equal(created.status, "created");
  assert.equal(created.lease.windowId, IDS.product);
  assert.equal(created.lease.repositoryId, IDS.repository);
  assert.equal(created.lease.checkoutResourceKey, `main:${IDS.repository}`);
  assert.equal(created.lease.bindingId, binding.bindingId);
  assert.equal(created.lease.identityBindingDigest, binding.identityBindingDigest);
  assert.match(created.lease.leaseId, /^lease_[0-9a-f-]{36}$/u);
  assert.match(created.inventoryDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(created.leaseRef, windowCoordinationLeaseRef({ windowId: IDS.product }));

  const target = leaseFile(workspaceRoot);
  const before = readFileSync(target);
  const beforeStat = lstatSync(target, { bigint: true });
  assert.equal(beforeStat.isFile(), true);
  assert.equal(beforeStat.nlink, 1n);
  assert.equal(Number(beforeStat.mode & 0o777n), 0o600);
  assert.deepEqual(
    before,
    windowCoordinationLeaseCanonicalBytes(validateWindowCoordinationLeaseRecord(JSON.parse(before))),
  );

  const replayed = await acquireWindowCoordinationLease(acquireInput(workspaceRoot, binding));
  assert.equal(replayed.status, "replayed");
  assert.equal(replayed.lease.leaseId, created.lease.leaseId);
  assert.equal(replayed.lease.leaseDigest, created.lease.leaseDigest);
  assert.deepEqual(readFileSync(target), before);
  assert.equal(lstatSync(target, { bigint: true }).ino, beforeStat.ino);

  await assert.rejects(
    () => acquireWindowCoordinationLease(acquireInput(workspaceRoot, binding, {
      deliveryId: "delivery-m3-t05-conflict",
    })),
    /conflict|owner|window|lease/iu,
  );
  assert.deepEqual(readFileSync(target), before);
  assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");

  await assert.rejects(
    () => releaseWindowCoordinationLease(releaseInput(workspaceRoot, created, {
      leaseId: "lease_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    })),
    /mismatch|holder|lease|release/iu,
  );
  assert.deepEqual(readFileSync(target), before);

  const released = await releaseWindowCoordinationLease(
    releaseInput(workspaceRoot, created),
  );
  assert.equal(released.status, "released");
  assert.equal(released.lease.leaseDigest, created.lease.leaseDigest);
  assert.equal(existsSync(target), false);
  assert.equal(inspectWindowCoordinationLeaseInventory({ workspaceRoot }).status, "empty");

  const successor = await acquireWindowCoordinationLease(acquireInput(workspaceRoot, binding));
  assert.equal(successor.status, "created");
  assert.notEqual(successor.lease.leaseId, created.lease.leaseId);
  const successorBytes = readFileSync(target);
  await assert.rejects(
    () => releaseWindowCoordinationLease(releaseInput(workspaceRoot, created)),
    /mismatch|holder|lease|release/iu,
  );
  assert.deepEqual(readFileSync(target), successorBytes);
  assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");
  assert.equal(JSON.stringify({ created, replayed, released, successor }).includes(workspaceRoot), false);
  assert.equal(JSON.stringify({ created, replayed, released, successor }).includes(HANDLE_A), false);
});

test("T05 one checkout claim has one winner while Test owns only its window", async (t) => {
  const workspaceRoot = prepareWorkspace(t, { config: configFixture(fullConfigFile) });
  const firstBinding = writeBindingFixture(workspaceRoot);
  const secondBinding = writeBindingFixture(workspaceRoot, {
    windowId: IDS.productAlias,
    bindingId: IDS.bindingTwo,
    handle: HANDLE_B,
  });
  const attempts = await Promise.allSettled([
    acquireWindowCoordinationLease(acquireInput(workspaceRoot, firstBinding)),
    acquireWindowCoordinationLease(acquireInput(workspaceRoot, secondBinding, {
      windowId: IDS.productAlias,
      demandId: IDS.demandTwo,
      targetTaskId: IDS.targetTaskTwo,
      groupId: "group-m3-t05-0002",
      groupDigest: `sha256:${"d".repeat(64)}`,
      deliveryId: "delivery-m3-t05-0002",
      envelopeDigest: `sha256:${"e".repeat(64)}`,
    })),
  ]);
  assert.equal(attempts.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((entry) => entry.status === "rejected").length, 1);
  assert.match(
    errorText(attempts.find((entry) => entry.status === "rejected").reason),
    /checkout|claim|conflict|repository|lease/iu,
  );
  const leaseNames = readdirSync(path.dirname(leaseFile(workspaceRoot))).filter(
    (name) => name.endsWith(".json"),
  );
  assert.equal(leaseNames.length, 1);

  const testBinding = writeBindingFixture(workspaceRoot, {
    windowId: IDS.test,
    bindingId: IDS.bindingThree,
    handle: HANDLE_C,
  });
  const testLease = await acquireWindowCoordinationLease(acquireInput(
    workspaceRoot,
    testBinding,
    {
      windowId: IDS.test,
      demandId: "demand_bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc",
      targetTaskId: "target-task_bdbdbdbd-bdbd-4dbd-8dbd-bdbdbdbdbdbd",
      groupId: "group-m3-t05-test",
      groupDigest: `sha256:${"f".repeat(64)}`,
      deliveryId: "delivery-m3-t05-test",
      envelopeDigest: `sha256:${"0".repeat(64)}`,
    },
  ));
  assert.equal(testLease.status, "created");
  assert.equal(Object.hasOwn(testLease.lease, "repositoryId"), false);
  assert.equal(Object.hasOwn(testLease.lease, "checkoutResourceKey"), false);
  assert.equal(readdirSync(path.dirname(leaseFile(workspaceRoot))).length, 2);
  assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");
});

test("T05 duplicate persisted checkout claims invalidate the whole shared inventory", async (t) => {
  const workspaceRoot = prepareWorkspace(t, { config: configFixture(fullConfigFile) });
  const firstBinding = writeBindingFixture(workspaceRoot);
  const secondBinding = writeBindingFixture(workspaceRoot, {
    windowId: IDS.productAlias,
    bindingId: IDS.bindingTwo,
    handle: HANDLE_B,
  });
  writeLeaseFixture(workspaceRoot, firstBinding);
  writeLeaseFixture(workspaceRoot, secondBinding, {
    windowId: IDS.productAlias,
    leaseId: "lease_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    demandId: IDS.demandTwo,
    targetTaskId: IDS.targetTaskTwo,
    groupId: "group-m3-t05-duplicate-claim",
    groupDigest: `sha256:${"d".repeat(64)}`,
    deliveryId: "delivery-m3-t05-duplicate-claim",
    envelopeDigest: `sha256:${"e".repeat(64)}`,
  });
  const before = leaseDirectorySnapshot(workspaceRoot);

  assert.throws(
    () => inspectWindowCoordinationLeaseInventory({ workspaceRoot }),
    /checkout|claim|multiple|inventory|lease/iu,
  );
  await assert.rejects(
    () => acquireWindowCoordinationLease(acquireInput(workspaceRoot, firstBinding)),
    /checkout|claim|multiple|inventory|lease/iu,
  );
  assert.deepEqual(leaseDirectorySnapshot(workspaceRoot), before);
  assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");
});

test("T05 one delivery ID cannot acquire a second target lease", async (t) => {
  const workspaceRoot = prepareWorkspace(t, { config: configFixture(fullConfigFile) });
  const productBinding = writeBindingFixture(workspaceRoot);
  const testBinding = writeBindingFixture(workspaceRoot, {
    windowId: IDS.test,
    bindingId: IDS.bindingTwo,
    handle: HANDLE_B,
  });
  await acquireWindowCoordinationLease(acquireInput(workspaceRoot, productBinding));
  const before = leaseDirectorySnapshot(workspaceRoot);

  await assert.rejects(
    () => acquireWindowCoordinationLease(acquireInput(workspaceRoot, testBinding, {
      windowId: IDS.test,
      demandId: IDS.demandTwo,
      targetTaskId: IDS.targetTaskTwo,
      groupId: "group-m3-t05-duplicate-delivery",
      groupDigest: `sha256:${"d".repeat(64)}`,
      deliveryId: IDS.delivery,
      envelopeDigest: `sha256:${"e".repeat(64)}`,
    })),
    /delivery|conflict|lease/iu,
  );
  assert.deepEqual(leaseDirectorySnapshot(workspaceRoot), before);
  assert.equal(existsSync(leaseFile(workspaceRoot, IDS.test)), false);
  assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");
});

test("T05 non-target and config-external dynamic owners are rejected without a lease write", async (t) => {
  const workspaceRoot = prepareWorkspace(t);
  const designBinding = writeBindingFixture(workspaceRoot, {
    windowId: IDS.design,
    bindingId: IDS.bindingTwo,
    handle: HANDLE_B,
  });
  await assert.rejects(
    () => acquireWindowCoordinationLease(acquireInput(workspaceRoot, designBinding, {
      windowId: IDS.design,
    })),
    /design|ineligible|window|lease/iu,
  );
  assert.deepEqual(readdirSync(path.dirname(leaseFile(workspaceRoot))), []);

  const controllerBinding = writeBindingFixture(workspaceRoot, {
    windowId: IDS.controller,
    bindingId: IDS.bindingThree,
    handle: HANDLE_C,
  });
  await assert.rejects(
    () => acquireWindowCoordinationLease(acquireInput(workspaceRoot, controllerBinding, {
      windowId: IDS.controller,
    })),
    /controller|ineligible|product|test|window|lease/iu,
  );
  assert.deepEqual(readdirSync(path.dirname(leaseFile(workspaceRoot))), []);

  ensurePrivateDirectory(workspaceRoot, ".wakeflow-local/pod-reservations");
  writeFileSync(
    path.join(workspaceRoot, ".wakeflow-local/pod-reservations/legacy.json"),
    "{}\n",
    { mode: 0o600 },
  );
  await assert.rejects(
    () => acquireWindowCoordinationLease(acquireInput(workspaceRoot, {
      bindingId: IDS.binding,
      identityBindingDigest: DIGESTS.binding,
    }, {
      windowId: IDS.dynamic,
    })),
    (error) => {
      assert.match(errorText(error), /dynamic-pod-owner-not-realized|dynamic|pod|window/iu);
      return true;
    },
  );
  assert.deepEqual(readdirSync(path.dirname(leaseFile(workspaceRoot))), []);
  assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");
});

test("T05 a persisted Controller lease is owner-invalid for service and T01b", (t) => {
  const config = configFixture();
  const workspaceRoot = prepareWorkspace(t, { config });
  const controllerBinding = writeBindingFixture(workspaceRoot, {
    windowId: IDS.controller,
    bindingId: IDS.bindingThree,
    handle: HANDLE_C,
  });
  writeLeaseFixture(workspaceRoot, controllerBinding, {
    windowId: IDS.controller,
    leaseId: "lease_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    groupId: "group-m3-t05-controller",
    deliveryId: "delivery-m3-t05-controller",
  }, { withClaim: false });

  assert.throws(
    () => inspectWindowCoordinationLeaseInventory({ workspaceRoot }),
    /product|test|controller|owner|inventory|lease/iu,
  );
  const model = parseWakeflowConfigV3(config);
  const layoutDescriptor = createWakeflowLayoutDescriptor({
    model,
    hostProfile: codexProfile,
  });
  const inspection = inspectWakeflowLocalLayout({
    workspaceRoot,
    model,
    layoutDescriptor,
    hostProfile: codexProfile,
  });
  const controllerLease = inspection.items.events.find((event) => (
    event.matchedKeys?.includes("event.coordination.window-lease")
  ));
  assert.equal(controllerLease?.classification, "owner-validator-invalid");
  assert.equal(inspection.overall, "blocked");
});

test("T05 different repository claims coexist and no repository sidecar is created", async (t) => {
  const config = configFixture();
  config.topology.repositories.push({
    repositoryId: IDS.repositoryTwo,
    path: "../ProductB",
    displayName: "Product B",
    instructionManagement: "owner-managed",
  });
  config.topology.windows.push({
    windowId: IDS.productTwo,
    role: "product",
    displayName: "Product B",
    root: { kind: "repository", repositoryId: IDS.repositoryTwo },
  });
  const workspaceRoot = prepareWorkspace(t, { config });
  const firstBinding = writeBindingFixture(workspaceRoot);
  const secondBinding = writeBindingFixture(workspaceRoot, {
    windowId: IDS.productTwo,
    bindingId: IDS.bindingTwo,
    handle: HANDLE_B,
  });
  const [first, second] = await Promise.all([
    acquireWindowCoordinationLease(acquireInput(workspaceRoot, firstBinding)),
    acquireWindowCoordinationLease(acquireInput(workspaceRoot, secondBinding, {
      windowId: IDS.productTwo,
      demandId: IDS.demandTwo,
      targetTaskId: IDS.targetTaskTwo,
      groupId: "group-m3-t05-product-b",
      groupDigest: `sha256:${"d".repeat(64)}`,
      deliveryId: "delivery-m3-t05-product-b",
      envelopeDigest: `sha256:${"e".repeat(64)}`,
    })),
  ]);
  assert.equal(first.lease.checkoutResourceKey, `main:${IDS.repository}`);
  assert.equal(second.lease.checkoutResourceKey, `main:${IDS.repositoryTwo}`);
  assert.equal(readdirSync(path.dirname(leaseFile(workspaceRoot))).length, 2);
  assert.equal(
    existsSync(path.join(
      workspaceRoot,
      ".wakeflow-local/runtime/shared/coordination/repository-leases",
    )),
    false,
  );
  assert.equal(
    existsSync(path.join(
      workspaceRoot,
      ".wakeflow-local/runtime/shared/coordination/checkout-claims",
    )),
    false,
  );
});

test("T05 shared inventory validates a foreign-host holder and serializes its checkout claim", async (t) => {
  const config = configFixture(fullConfigFile);
  config.topology.repositories.push({
    repositoryId: IDS.repositoryTwo,
    path: "../ProductB",
    displayName: "Product B",
    instructionManagement: "owner-managed",
  });
  config.topology.windows.push({
    windowId: IDS.productTwo,
    role: "product",
    displayName: "Product B",
    root: { kind: "repository", repositoryId: IDS.repositoryTwo },
  });
  const workspaceRoot = prepareWorkspace(t, { config });
  ensurePrivateDirectory(
    workspaceRoot,
    `.wakeflow-local/runtime/hosts/${claudeProfile.runtime.hostDirName}/identity/window-bindings`,
  );
  const foreignBinding = writeBindingFixture(workspaceRoot, {
    profile: claudeProfile,
    handle: HANDLE_B,
  });
  const foreignLease = writeLeaseFixture(workspaceRoot, foreignBinding, {
    hostId: claudeProfile.hostId,
  });
  const localBinding = writeBindingFixture(workspaceRoot, {
    windowId: IDS.productAlias,
    bindingId: IDS.bindingTwo,
    handle: HANDLE_C,
  });
  const otherRepositoryBinding = writeBindingFixture(workspaceRoot, {
    windowId: IDS.productTwo,
    bindingId: IDS.bindingThree,
    handle: HANDLE_A,
  });

  const inspected = inspectWindowCoordinationLeaseInventory({ workspaceRoot });
  assert.equal(inspected.status, "current");
  assert.equal(inspected.leases.length, 1);
  assert.equal(inspected.leases[0].lease.hostId, "claude-code");
  assert.equal(inspected.leases[0].lease.identityRef, foreignBinding.identityRef);

  await assert.rejects(
    () => acquireWindowCoordinationLease(acquireInput(workspaceRoot, localBinding, {
      windowId: IDS.productAlias,
      demandId: IDS.demandTwo,
      targetTaskId: IDS.targetTaskTwo,
      groupId: "group-m3-t05-cross-host",
      groupDigest: `sha256:${"d".repeat(64)}`,
      deliveryId: "delivery-m3-t05-cross-host",
      envelopeDigest: `sha256:${"e".repeat(64)}`,
    })),
    /checkout|claim|conflict|repository|lease/iu,
  );
  assert.deepEqual(readFileSync(foreignLease.target), windowCoordinationLeaseCanonicalBytes(
    foreignLease.record,
  ));

  const otherRepository = await acquireWindowCoordinationLease(acquireInput(
    workspaceRoot,
    otherRepositoryBinding,
    {
      windowId: IDS.productTwo,
      demandId: "demand_bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc",
      targetTaskId: "target-task_bdbdbdbd-bdbd-4dbd-8dbd-bdbdbdbdbdbd",
      groupId: "group-m3-t05-cross-host-repository-b",
      groupDigest: `sha256:${"f".repeat(64)}`,
      deliveryId: "delivery-m3-t05-cross-host-repository-b",
      envelopeDigest: `sha256:${"0".repeat(64)}`,
    },
  ));
  assert.equal(otherRepository.status, "created");
  assert.equal(otherRepository.lease.checkoutResourceKey, `main:${IDS.repositoryTwo}`);
  assert.equal(inspectWindowCoordinationLeaseInventory({ workspaceRoot }).leases.length, 2);

  const released = await releaseWindowCoordinationLease(releaseInput(
    workspaceRoot,
    { lease: foreignLease.record },
  ));
  assert.equal(released.status, "released");
  assert.equal(released.lease.hostId, "claude-code");
  assert.equal(existsSync(foreignLease.target), false);

  const local = await acquireWindowCoordinationLease(acquireInput(workspaceRoot, localBinding, {
    windowId: IDS.productAlias,
    demandId: IDS.demandTwo,
    targetTaskId: IDS.targetTaskTwo,
    groupId: "group-m3-t05-cross-host",
    groupDigest: `sha256:${"d".repeat(64)}`,
    deliveryId: "delivery-m3-t05-cross-host",
    envelopeDigest: `sha256:${"e".repeat(64)}`,
  }));
  assert.equal(local.status, "created");
  assert.equal(local.lease.hostId, "codex");
});

test("T05 protocol-host binding seam is read-only, sanitized, and fail closed", (t) => {
  const config = configFixture();
  const model = parseWakeflowConfigV3(config);
  const workspaceRoot = prepareWorkspace(t, { config });
  ensurePrivateDirectory(
    workspaceRoot,
    `.wakeflow-local/runtime/hosts/${claudeProfile.runtime.hostDirName}/identity/window-bindings`,
  );
  const binding = writeBindingFixture(workspaceRoot, {
    profile: claudeProfile,
    handle: HANDLE_B,
  });
  const input = {
    workspaceRoot,
    programId: model.program.programId,
    hostId: claudeProfile.hostId,
    configDigest: wakeflowConfigV3Digest(model),
    windowIds: model.topology.windows.map((window) => window.windowId),
  };

  const inventory = inspectWindowBindingInventoryForProtocolHost(input);
  assert.equal(inventory.hostId, "claude-code");
  assert.equal(inventory.bindings.length, 1);
  assert.equal(inventory.bindings[0].bindingId, binding.bindingId);
  assert.equal(JSON.stringify(inventory).includes(HANDLE_B), false);
  assert.equal(JSON.stringify(inventory).includes(workspaceRoot), false);
  assert.throws(
    () => inspectWindowBindingInventoryForProtocolHost({
      ...input,
      hostId: "invented-host",
    }),
    /protocol|host|profile|binding/iu,
  );
  assert.throws(
    () => inspectWindowBindingInventoryForProtocolHost({
      ...input,
      programId: "program_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }),
    /owner|codec|program|binding|inventory/iu,
  );

  const target = path.resolve(workspaceRoot, ...binding.identityRef.split("/"));
  const record = JSON.parse(readFileSync(target));
  writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  chmodSync(target, 0o600);
  const before = readFileSync(target);
  assert.throws(
    () => inspectWindowBindingInventoryForProtocolHost(input),
    /canonical|binding|inventory/iu,
  );
  assert.deepEqual(readFileSync(target), before);
});

test("T05 expired strict lease blocks ordinary acquire until exact release", async (t) => {
  const workspaceRoot = prepareWorkspace(t);
  const binding = writeBindingFixture(workspaceRoot);
  const expired = writeLeaseFixture(workspaceRoot, binding, {
    acquiredAt: "2000-01-01T00:00:00.000Z",
    expiresAt: "2000-01-01T02:00:00.000Z",
  });
  const before = readFileSync(expired.target);
  await assert.rejects(
    () => acquireWindowCoordinationLease(acquireInput(workspaceRoot, binding)),
    /expired|recovery|lease/iu,
  );
  assert.deepEqual(readFileSync(expired.target), before);
  assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");

  const released = await releaseWindowCoordinationLease(releaseInput(
    workspaceRoot,
    { lease: expired.record },
  ));
  assert.equal(released.status, "released");
  assert.equal(existsSync(expired.target), false);
  const acquired = await acquireWindowCoordinationLease(acquireInput(workspaceRoot, binding));
  assert.equal(acquired.status, "created");
  assert.notEqual(acquired.lease.leaseId, expired.record.leaseId);
});

test("T05 public wrappers cannot nest T02 while admitted APIs require the exact live context", async (t) => {
  const workspaceRoot = prepareWorkspace(t);
  const binding = writeBindingFixture(workspaceRoot);
  let issuedContext = null;
  await withWakeflowRuntimeMutation({
    workspaceRoot,
    operationKind: "window-lease-admitted-test",
    domainOwner: "lease-manager",
  }, async (mutationContext) => {
    issuedContext = mutationContext;
    await assert.rejects(
      () => acquireWindowCoordinationLease({
        ...acquireInput(workspaceRoot, binding),
        acquireTimeoutMs: 0,
      }),
      /nested|reentrant|mutation|busy|lease/iu,
    );
    const acquired = acquireWindowCoordinationLeaseAdmitted({
      ...acquireInput(workspaceRoot, binding),
      mutationContext,
    });
    assert.equal(acquired?.then, undefined, "admitted acquire must complete synchronously");
    assert.equal(acquired.outcome, "success");
    assert.equal(acquired.value.status, "created");
    const released = releaseWindowCoordinationLeaseAdmitted({
      ...releaseInput(workspaceRoot, acquired.value),
      mutationContext,
    });
    assert.equal(released?.then, undefined, "admitted release must complete synchronously");
    assert.equal(released.outcome, "success");
    assert.equal(released.value.status, "released");
  });
  assert.deepEqual(readdirSync(path.dirname(leaseFile(workspaceRoot))), []);
  assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");
  const designBinding = writeBindingFixture(workspaceRoot, {
    windowId: IDS.design,
    bindingId: IDS.bindingTwo,
    handle: HANDLE_B,
  });
  const rejected = await withWakeflowRuntimeMutation({
    workspaceRoot,
    operationKind: "window-lease-admitted-rejection-test",
    domainOwner: "lease-manager",
  }, (mutationContext) => acquireWindowCoordinationLeaseAdmitted({
    ...acquireInput(workspaceRoot, designBinding, { windowId: IDS.design }),
    mutationContext,
  }));
  assert.equal(rejected.outcome, "rejected");
  assert.equal(rejected.code, "wakeflow-window-lease-window-ineligible");
  assert.deepEqual(readdirSync(path.dirname(leaseFile(workspaceRoot))), []);
  assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");
  assert.throws(
    () => acquireWindowCoordinationLeaseAdmitted({
      ...acquireInput(workspaceRoot, binding),
      mutationContext: issuedContext,
    }),
    /context|mutation|active|lease/iu,
  );
  assert.throws(
    () => acquireWindowCoordinationLeaseAdmitted({
      ...acquireInput(workspaceRoot, binding),
      mutationContext: {},
    }),
    /context|mutation|lease/iu,
  );
});

test("T05 commit faults preserve one exact lease outcome or T02 recovery evidence", async (t) => {
  await t.test("one-shot target fsync failure settles the exact committed lease", async (subtest) => {
    const workspaceRoot = prepareWorkspace(subtest);
    const binding = writeBindingFixture(workspaceRoot);
    const target = leaseFile(workspaceRoot);
    const originalFsync = fs.fsyncSync;
    let injected = false;
    subtest.mock.method(fs, "fsyncSync", (descriptor) => {
      const opened = fs.fstatSync(descriptor, { bigint: true });
      let current = null;
      try {
        current = fs.lstatSync(target, { bigint: true });
      } catch {
        // The lease target is not committed yet.
      }
      if (
        !injected
        && current?.isFile()
        && opened.dev === current.dev
        && opened.ino === current.ino
      ) {
        injected = true;
        const error = new Error("injected one-shot lease fsync failure");
        error.code = "EIO";
        throw error;
      }
      return originalFsync(descriptor);
    });

    const acquired = await acquireWindowCoordinationLease(acquireInput(
      workspaceRoot,
      binding,
    ));
    assert.equal(injected, true);
    assert.equal(acquired.status, "created");
    assert.equal(JSON.parse(readFileSync(target)).leaseDigest, acquired.lease.leaseDigest);
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");
  });

  await t.test("persistent target fsync failure keeps the committed lease and recovery gate", async (subtest) => {
    const workspaceRoot = prepareWorkspace(subtest);
    const binding = writeBindingFixture(workspaceRoot);
    const target = leaseFile(workspaceRoot);
    const originalFsync = fs.fsyncSync;
    let injected = 0;
    subtest.mock.method(fs, "fsyncSync", (descriptor) => {
      const opened = fs.fstatSync(descriptor, { bigint: true });
      let current = null;
      try {
        current = fs.lstatSync(target, { bigint: true });
      } catch {
        // The lease target is not committed yet.
      }
      if (
        current?.isFile()
        && opened.dev === current.dev
        && opened.ino === current.ino
      ) {
        injected += 1;
        const error = new Error("injected persistent lease fsync failure");
        error.code = "EIO";
        throw error;
      }
      return originalFsync(descriptor);
    });

    await assert.rejects(
      () => acquireWindowCoordinationLease(acquireInput(workspaceRoot, binding)),
      /recovery|mutation|durability|lease/iu,
    );
    assert.ok(injected >= 2);
    const committed = validateWindowCoordinationLeaseRecord(JSON.parse(readFileSync(target)));
    assert.equal(committed.bindingId, binding.bindingId);
    const mutation = inspectWakeflowWorkspaceMutation({ workspaceRoot });
    assert.equal(mutation.state, "busy");
    assert.equal(mutation.lock?.operationKind, "window-coordination-lease-acquire");
  });

  await t.test("absent create never overwrites a concurrently published lease", async (subtest) => {
    const workspaceRoot = prepareWorkspace(subtest);
    const binding = writeBindingFixture(workspaceRoot);
    const target = leaseFile(workspaceRoot);
    const interloper = recordFixture({
      bindingId: binding.bindingId,
      identityBindingDigest: binding.identityBindingDigest,
      leaseId: "lease_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      deliveryId: "delivery-m3-t05-interloper",
    });
    const interloperBytes = windowCoordinationLeaseCanonicalBytes(interloper);
    const originalLink = fs.linkSync;
    let injected = false;
    subtest.mock.method(fs, "linkSync", (source, destination) => {
      if (!injected && destination === target && String(source).includes(".wakeflow-stage-")) {
        writeFileSync(target, interloperBytes, { flag: "wx", mode: 0o600 });
        chmodSync(target, 0o600);
        injected = true;
      }
      return originalLink(source, destination);
    });

    await assert.rejects(
      () => acquireWindowCoordinationLease(acquireInput(workspaceRoot, binding)),
      /recovery|mutation|commit|lease/iu,
    );
    assert.equal(injected, true);
    assert.deepEqual(readFileSync(target), interloperBytes);
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "busy");
  });

  await t.test("release preserves a successor published after exact source capture", async (subtest) => {
    const workspaceRoot = prepareWorkspace(subtest);
    const binding = writeBindingFixture(workspaceRoot);
    const acquired = await acquireWindowCoordinationLease(acquireInput(workspaceRoot, binding));
    const target = leaseFile(workspaceRoot);
    const successor = recordFixture({
      bindingId: binding.bindingId,
      identityBindingDigest: binding.identityBindingDigest,
      leaseId: "lease_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      deliveryId: "delivery-m3-t05-successor",
    });
    const successorBytes = windowCoordinationLeaseCanonicalBytes(successor);
    const originalRename = fs.renameSync;
    let injected = false;
    subtest.mock.method(fs, "renameSync", (source, destination) => {
      const result = originalRename(source, destination);
      if (
        !injected
        && source === target
        && String(destination).includes(".wakeflow-removal-")
      ) {
        writeFileSync(target, successorBytes, { flag: "wx", mode: 0o600 });
        chmodSync(target, 0o600);
        injected = true;
      }
      return result;
    });

    await assert.rejects(
      () => releaseWindowCoordinationLease(releaseInput(workspaceRoot, acquired)),
      /recovery|mutation|successor|release|lease/iu,
    );
    assert.equal(injected, true);
    assert.deepEqual(readFileSync(target), successorBytes);
    const removalStages = readdirSync(path.dirname(target))
      .filter((name) => name.includes(".wakeflow-removal-"));
    assert.equal(removalStages.length, 1);
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "busy");
  });

  await t.test("release cleanup requires an exact unlink receipt", async (subtest) => {
    const workspaceRoot = prepareWorkspace(subtest);
    const binding = writeBindingFixture(workspaceRoot);
    const acquired = await acquireWindowCoordinationLease(acquireInput(workspaceRoot, binding));
    const target = leaseFile(workspaceRoot);
    const capturedRemoval = path.join(workspaceRoot, "captured-lease-removal.json");
    const originalRename = fs.renameSync;
    const originalUnlink = fs.unlinkSync;
    let injected = false;
    subtest.mock.method(fs, "unlinkSync", (candidate) => {
      if (!injected && String(candidate).includes(".wakeflow-removal-")) {
        originalRename(candidate, capturedRemoval);
        writeFileSync(candidate, "same-name removal replacement\n", { mode: 0o600 });
        chmodSync(candidate, 0o600);
        injected = true;
      }
      return originalUnlink(candidate);
    });

    await assert.rejects(
      () => releaseWindowCoordinationLease(releaseInput(workspaceRoot, acquired)),
      /recovery|mutation|removal|release|lease/iu,
    );
    assert.equal(injected, true);
    assert.equal(existsSync(target), false);
    assert.deepEqual(
      readFileSync(capturedRemoval),
      windowCoordinationLeaseCanonicalBytes(acquired.lease),
    );
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "busy");
  });
});

test("T05 unsafe lease inventory is never treated as missing or repairable", async (t) => {
  const scenarios = [
    {
      label: "corrupt JSON",
      mutate(workspaceRoot) {
        writeFileSync(leaseFile(workspaceRoot), "{\"kind\":\n", { mode: 0o600 });
      },
    },
    {
      label: "noncanonical valid JSON",
      mutate(workspaceRoot, binding) {
        const record = recordFixture({
          bindingId: binding.bindingId,
          identityBindingDigest: binding.identityBindingDigest,
        });
        writeFileSync(leaseFile(workspaceRoot), `${JSON.stringify(record, null, 2)}\n`, {
          mode: 0o600,
        });
      },
    },
    {
      label: "wrong mode",
      mutate(workspaceRoot, binding) {
        writeLeaseFixture(workspaceRoot, binding, {}, { mode: 0o644 });
      },
    },
    {
      label: "unknown sibling",
      mutate(workspaceRoot) {
        writeFileSync(
          path.join(path.dirname(leaseFile(workspaceRoot)), "private-token.txt"),
          "unknown\n",
          { mode: 0o600 },
        );
      },
    },
    {
      label: "invalid filename",
      mutate(workspaceRoot) {
        writeFileSync(
          path.join(path.dirname(leaseFile(workspaceRoot)), "semantic-window.json"),
          "{}\n",
          { mode: 0o600 },
        );
      },
    },
    {
      label: "symlink source",
      mutate(workspaceRoot) {
        symlinkSync(path.join(workspaceRoot, "wakeflow.config.json"), leaseFile(workspaceRoot));
      },
    },
    {
      label: "hardlink source",
      mutate(workspaceRoot, binding) {
        const { target } = writeLeaseFixture(workspaceRoot, binding);
        linkSync(target, path.join(path.dirname(target), "hardlink-shadow.json"));
      },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.label, async (subtest) => {
      const workspaceRoot = prepareWorkspace(subtest);
      const binding = writeBindingFixture(workspaceRoot);
      scenario.mutate(workspaceRoot, binding);
      const before = leaseDirectorySnapshot(workspaceRoot);
      assert.throws(
        () => inspectWindowCoordinationLeaseInventory({ workspaceRoot }),
        /inventory|lease|canonical|mode|link|file|json|sibling/iu,
      );
      await assert.rejects(
        () => acquireWindowCoordinationLease(acquireInput(workspaceRoot, binding)),
        /inventory|lease|canonical|mode|link|file|json|sibling/iu,
      );
      await assert.rejects(
        () => releaseWindowCoordinationLease({
          workspaceRoot,
          windowId: IDS.product,
          leaseId: IDS.lease,
          deliveryId: IDS.delivery,
          bindingId: binding.bindingId,
          leaseDigest: recordFixture({
            bindingId: binding.bindingId,
            identityBindingDigest: binding.identityBindingDigest,
          }).leaseDigest,
        }),
        /inventory|lease|canonical|mode|link|file|json|sibling|mismatch/iu,
      );
      assert.deepEqual(leaseDirectorySnapshot(workspaceRoot), before);
      assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");
    });
  }
});

test("T05 T01b validates an exact lease event and rejects corrupt owner bytes", async (t) => {
  const config = configFixture();
  const workspaceRoot = prepareWorkspace(t, { config });
  const binding = writeBindingFixture(workspaceRoot);
  const acquired = await acquireWindowCoordinationLease(acquireInput(workspaceRoot, binding));
  const model = parseWakeflowConfigV3(config);
  const layoutDescriptor = createWakeflowLayoutDescriptor({
    model,
    hostProfile: codexProfile,
  });
  const inspect = () => inspectWakeflowLocalLayout({
    workspaceRoot,
    model,
    layoutDescriptor,
    hostProfile: codexProfile,
  });
  const current = inspect();
  const currentLease = current.items.events.find((event) => (
    event.matchedKeys?.includes("event.coordination.window-lease")
  ));
  assert.equal(currentLease?.classification, "owner-validated");
  assert.equal(currentLease?.leaseId, acquired.lease.leaseId);
  assert.equal(currentLease?.leaseDigest, acquired.lease.leaseDigest);

  writeFileSync(leaseFile(workspaceRoot), "{}\n", { mode: 0o600 });
  chmodSync(leaseFile(workspaceRoot), 0o600);
  const invalid = inspect();
  const invalidLease = invalid.items.events.find((event) => (
    event.matchedKeys?.includes("event.coordination.window-lease")
  ));
  assert.equal(invalidLease?.classification, "owner-validator-invalid");
  assert.match(invalidLease?.ownerValidationCode ?? "", /lease|inventory|coordination/iu);
  assert.equal(invalid.overall, "blocked");
});

test("T05 candidate and frozen public-v2 modules keep a bidirectional import fence", () => {
  const recordsFile = path.join(
    repositoryRoot,
    "core/scripts/lib/wakeflow-window-lease-records.mjs",
  );
  const serviceFile = path.join(
    repositoryRoot,
    "core/scripts/lib/wakeflow-window-lease-service.mjs",
  );
  const forbiddenCandidateDependencies = new Set([
    "wakeflow-setup.mjs",
    "wakeflow-window-runtime.mjs",
    "wakeflow-thread-registry.mjs",
    "wakeflow-delivery-store.mjs",
    "wakeflow-dispatch-commands.mjs",
    "wakeflow-delivery-run-recording-command.mjs",
    "wakeflow-result-recording-commands.mjs",
    "wakeflow-pod-runtime.mjs",
  ]);
  for (const candidate of [recordsFile, serviceFile]) {
    for (const specifier of importSpecifiers(readFileSync(candidate, "utf8"))) {
      assert.equal(
        forbiddenCandidateDependencies.has(path.posix.basename(specifier)),
        false,
        `${path.basename(candidate)} must not import ${specifier}`,
      );
    }
  }

  const retiredFiles = [
    "core/scripts/wakeflow-delivery.mjs",
    "core/scripts/wakeflow-state.mjs",
    "core/scripts/lib/wakeflow-delivery-store.mjs",
    "core/scripts/lib/wakeflow-dispatch-commands.mjs",
    "core/scripts/lib/wakeflow-delivery-run-recording-command.mjs",
    "core/scripts/lib/wakeflow-result-recording-commands.mjs",
    "core/scripts/lib/wakeflow-thread-registry.mjs",
    "core/scripts/lib/wakeflow-window-runtime.mjs",
  ];
  for (const relative of retiredFiles) {
    assert.equal(existsSync(path.join(repositoryRoot, relative)), false, relative);
  }

  const productionModules = [
    path.join(repositoryRoot, "core"),
    path.join(repositoryRoot, "plugins/codex-wakeflow"),
    path.join(repositoryRoot, "plugins/claude-code-wakeflow"),
  ].flatMap(listProductionModules);
  const importersOf = (basename) => productionModules
    .filter((file) => importSpecifiers(readFileSync(file, "utf8"))
      .some((specifier) => path.posix.basename(specifier) === basename))
    .map((file) => path.relative(repositoryRoot, file).split(path.sep).join("/"))
    .sort();
  assert.deepEqual(importersOf("wakeflow-window-lease-records.mjs"), [
    "core/scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
    "core/scripts/lib/wakeflow-transport-records.mjs",
    "core/scripts/lib/wakeflow-window-lease-service.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-transport-records.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-window-lease-service.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-transport-records.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-window-lease-service.mjs",
  ]);
  assert.deepEqual(importersOf("wakeflow-window-lease-service.mjs"), [
    "core/scripts/lib/wakeflow-delivery-orchestration.mjs",
    "core/scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
    "core/scripts/lib/wakeflow-local-layout-inspection.mjs",
    "core/scripts/lib/wakeflow-observability-v3.mjs",
    "core/scripts/lib/wakeflow-public-v3-runtime.mjs",
    "core/scripts/lib/wakeflow-result-review-orchestration.mjs",
    "core/scripts/lib/wakeflow-transport-retention.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-delivery-orchestration.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-transport.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-local-layout-inspection.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-observability-v3.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-public-v3-runtime.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-result-review-orchestration.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-transport-retention.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-delivery-orchestration.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-local-layout-inspection.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-observability-v3.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-public-v3-runtime.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-result-review-orchestration.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-transport-retention.mjs",
  ].filter((relativeFile) => existsSync(path.join(repositoryRoot, relativeFile))).sort());
});

test("T05 synchronized Codex and Claude artifacts execute the same shared lease contract", async (t) => {
  for (const fixture of [
    {
      label: "codex",
      artifact: "plugins/codex-wakeflow",
      handle: HANDLE_A,
    },
    {
      label: "claude-code",
      artifact: "plugins/claude-code-wakeflow",
      handle: "session-m3-t05-claude",
    },
  ]) {
    await t.test(fixture.label, async (subtest) => {
      const artifactRoot = path.join(repositoryRoot, fixture.artifact);
      const [{ hostProfile }, service, records] = await Promise.all([
        import(pathToFileURL(path.join(
          artifactRoot,
          "scripts/lib/wakeflow-host-profile.mjs",
        )).href),
        import(pathToFileURL(path.join(
          artifactRoot,
          "scripts/lib/wakeflow-window-lease-service.mjs",
        )).href),
        import(pathToFileURL(path.join(
          artifactRoot,
          "scripts/lib/wakeflow-window-lease-records.mjs",
        )).href),
      ]);
      const workspaceRoot = prepareWorkspace(subtest, { profile: hostProfile });
      const binding = writeBindingFixture(workspaceRoot, {
        profile: hostProfile,
        handle: fixture.handle,
      });
      const acquired = await service.acquireWindowCoordinationLease(
        acquireInput(workspaceRoot, binding),
      );
      assert.equal(acquired.status, "created");
      assert.equal(acquired.lease.hostId, hostProfile.hostId);
      assert.equal(
        acquired.lease.identityRef,
        `.wakeflow-local/runtime/hosts/${hostProfile.runtime.hostDirName}`
          + `/identity/window-bindings/${IDS.product}.json`,
      );
      const bytes = readFileSync(leaseFile(workspaceRoot));
      const record = records.validateWindowCoordinationLeaseRecord(JSON.parse(bytes));
      assert.deepEqual(bytes, records.windowCoordinationLeaseCanonicalBytes(record));
      const released = await service.releaseWindowCoordinationLease(
        releaseInput(workspaceRoot, acquired),
      );
      assert.equal(released.status, "released");
      assert.equal(existsSync(leaseFile(workspaceRoot)), false);
    });
  }

  await t.test("cross-host shared inventory works in both artifact directions", async (subtest) => {
    const [codexArtifact, claudeArtifact] = await Promise.all([
      Promise.all([
        import(pathToFileURL(path.join(
          repositoryRoot,
          "plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs",
        )).href),
        import(pathToFileURL(path.join(
          repositoryRoot,
          "plugins/codex-wakeflow/scripts/lib/wakeflow-window-lease-service.mjs",
        )).href),
      ]),
      Promise.all([
        import(pathToFileURL(path.join(
          repositoryRoot,
          "plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs",
        )).href),
        import(pathToFileURL(path.join(
          repositoryRoot,
          "plugins/claude-code-wakeflow/scripts/lib/wakeflow-window-lease-service.mjs",
        )).href),
      ]),
    ]);
    const [codexHost, codexService] = codexArtifact;
    const [claudeHost, claudeService] = claudeArtifact;
    const workspaceRoot = prepareWorkspace(subtest, { profile: codexHost.hostProfile });
    ensurePrivateDirectory(
      workspaceRoot,
      `.wakeflow-local/runtime/hosts/${claudeHost.hostProfile.runtime.hostDirName}`
        + "/identity/window-bindings",
    );
    const codexBinding = writeBindingFixture(workspaceRoot, {
      profile: codexHost.hostProfile,
      handle: HANDLE_A,
    });
    const claudeBinding = writeBindingFixture(workspaceRoot, {
      profile: claudeHost.hostProfile,
      bindingId: IDS.bindingTwo,
      handle: HANDLE_B,
    });

    const codexLease = await codexService.acquireWindowCoordinationLease(
      acquireInput(workspaceRoot, codexBinding),
    );
    assert.equal(
      claudeService.inspectWindowCoordinationLeaseInventory({ workspaceRoot })
        .leases[0].lease.hostId,
      "codex",
    );
    const releasedByClaude = await claudeService.releaseWindowCoordinationLease(
      releaseInput(workspaceRoot, codexLease),
    );
    assert.equal(releasedByClaude.lease.hostId, "codex");

    const claudeLease = await claudeService.acquireWindowCoordinationLease(
      acquireInput(workspaceRoot, claudeBinding),
    );
    assert.equal(
      codexService.inspectWindowCoordinationLeaseInventory({ workspaceRoot })
        .leases[0].lease.hostId,
      "claude-code",
    );
    const releasedByCodex = await codexService.releaseWindowCoordinationLease(
      releaseInput(workspaceRoot, claudeLease),
    );
    assert.equal(releasedByCodex.lease.hostId, "claude-code");
    assert.equal(existsSync(leaseFile(workspaceRoot)), false);
  });
});
