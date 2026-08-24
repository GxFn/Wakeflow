import assert from "node:assert/strict";
import fs from "node:fs";
import {
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
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { hostProfile as claudeProfile } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import { hostProfile as codexProfile } from "../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import {
  WAKEFLOW_WINDOW_BINDING_KIND,
  WAKEFLOW_WINDOW_BINDING_SCHEMA_VERSION,
  createWindowBindingRecord,
  validateWindowBindingRecord,
  windowBindingCanonicalBytes,
  windowBindingDigest,
  windowBindingRef,
} from "../core/scripts/lib/wakeflow-window-binding-records.mjs";
import {
  decommissionWindowBinding,
  inspectWindowBindingInventory,
  inspectWindowBindingInventoryForLayout,
  registerWindowBinding,
  replaceWindowBinding,
  withCurrentWindowBindingHandle,
} from "../core/scripts/lib/wakeflow-window-binding-service.mjs";
import {
  createWindowCoordinationLeaseRecord,
  windowCoordinationLeaseCanonicalBytes,
} from "../core/scripts/lib/wakeflow-window-lease-records.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  inspectWakeflowWorkspaceMutation,
  withWakeflowRuntimeMutation,
} from "../core/scripts/lib/wakeflow-workspace-mutation.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureFile = path.join(
  repositoryRoot,
  "test/fixtures/wakeflow-config-v3/valid-minimal.json",
);
const schemaFile = path.join(
  repositoryRoot,
  "core/schemas/wakeflow-window-identity/window-binding.schema.json",
);
const recordsFile = path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-window-binding-records.mjs",
);
const serviceFile = path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-window-binding-service.mjs",
);
const runtimeRecordsFile = path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-window-runtime-records.mjs",
);
const runtimeProjectorFile = path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-window-runtime-projector.mjs",
);

const PROGRAM_ID = "program_11111111-1111-4111-8111-111111111111";
const CONTROLLER_WINDOW_ID = "window_55555555-5555-4555-8555-555555555555";
const DESIGN_WINDOW_ID = "window_66666666-6666-4666-8666-666666666666";
const BINDING_A = "binding_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BINDING_B = "binding_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BINDING_C = "binding_cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const HANDLE_A = "10000000-0000-4000-8000-000000000001";
const HANDLE_B = "20000000-0000-4000-8000-000000000002";
const HANDLE_C = "30000000-0000-4000-8000-000000000003";
const REGISTERED_AT = "2026-08-08T08:08:08.000Z";
const VERIFIED_AT = "2026-08-08T08:09:08.000Z";

function configFixture() {
  return JSON.parse(readFileSync(fixtureFile, "utf8"));
}

function withTempWorkspace(t, prefix = "wakeflow-window-binding-") {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  return workspaceRoot;
}

function absoluteRef(workspaceRoot, ref) {
  assert.equal(path.posix.isAbsolute(ref), false, `${ref} must remain portable`);
  assert.equal(ref.includes("\\"), false, `${ref} must use POSIX separators`);
  const absolute = path.resolve(workspaceRoot, ...ref.split("/"));
  assert.ok(
    absolute.startsWith(`${path.resolve(workspaceRoot)}${path.sep}`),
    `${ref} escaped its test workspace`,
  );
  return absolute;
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

function bindingRef(windowId = CONTROLLER_WINDOW_ID) {
  return windowBindingRef({
    hostDirName: codexProfile.runtime.hostDirName,
    windowId,
  });
}

function bindingFile(workspaceRoot, windowId = CONTROLLER_WINDOW_ID) {
  return absoluteRef(workspaceRoot, bindingRef(windowId));
}

function coordinationLeaseFile(workspaceRoot, windowId = CONTROLLER_WINDOW_ID) {
  return absoluteRef(
    workspaceRoot,
    `.wakeflow-local/runtime/shared/coordination/window-leases/${windowId}.json`,
  );
}

function canonicalCoordinationLeaseBytes(binding, windowId = CONTROLLER_WINDOW_ID) {
  return windowCoordinationLeaseCanonicalBytes(createWindowCoordinationLeaseRecord({
    programId: PROGRAM_ID,
    hostId: "codex",
    windowId,
    leaseId: "lease_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    demandId: "demand_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    targetTaskId: "target-task_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    groupId: "group-m3-t05-binding-guard",
    groupDigest: `sha256:${"a".repeat(64)}`,
    deliveryId: "delivery-m3-t05-binding-guard",
    envelopeDigest: `sha256:${"b".repeat(64)}`,
    bindingId: binding.bindingId,
    identityBindingDigest: binding.identityBindingDigest,
    acquiredAt: "2026-08-08T08:08:08.000Z",
    expiresAt: "2026-08-08T10:08:08.000Z",
  }));
}

function prepareWorkspace(t, { config = configFixture(), hostProfile = codexProfile } = {}) {
  const workspaceRoot = withTempWorkspace(t);
  for (const ref of [
    ".wakeflow-local",
    ".wakeflow-local/runtime",
    ".wakeflow-local/runtime/maintenance",
    ".wakeflow-local/runtime/maintenance/transactions",
    `.wakeflow-local/runtime/hosts/${hostProfile.runtime.hostDirName}`,
    `.wakeflow-local/runtime/hosts/${hostProfile.runtime.hostDirName}/identity`,
    `.wakeflow-local/runtime/hosts/${hostProfile.runtime.hostDirName}/identity/window-bindings`,
  ]) {
    ensurePrivateDirectory(workspaceRoot, ref);
  }
  writeConfig(workspaceRoot, config);
  return workspaceRoot;
}

function writeConfig(workspaceRoot, config) {
  const target = path.join(workspaceRoot, "wakeflow.config.json");
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(target, 0o600);
}

function recordFixture(overrides = {}) {
  return createWindowBindingRecord({
    programId: PROGRAM_ID,
    hostId: "codex",
    windowId: CONTROLLER_WINDOW_ID,
    bindingId: BINDING_A,
    handle: { kind: "codex-thread", value: HANDLE_A },
    registeredAt: REGISTERED_AT,
    ...overrides,
  });
}

function writeBindingFixture(workspaceRoot, record = recordFixture()) {
  const target = bindingFile(workspaceRoot, record.windowId);
  writeFileSync(target, windowBindingCanonicalBytes(record), { flag: "wx", mode: 0o600 });
  chmodSync(target, 0o600);
  return target;
}

function modeString(stat) {
  return `0${(stat.mode & 0o777).toString(8).padStart(3, "0")}`;
}

function snapshotTree(workspaceRoot) {
  const entries = [];
  const visit = (directory, base = "") => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const ref = base ? `${base}/${name}` : name;
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        entries.push({ ref, type: "symlink", mode: modeString(stat), nlink: stat.nlink });
      } else if (stat.isDirectory()) {
        entries.push({ ref, type: "directory", mode: modeString(stat), nlink: stat.nlink });
        visit(absolute, ref);
      } else if (stat.isFile()) {
        entries.push({
          ref,
          type: "file",
          mode: modeString(stat),
          nlink: stat.nlink,
          digest: canonicalJsonDigest({ bytes: readFileSync(absolute).toString("base64") }),
        });
      } else {
        entries.push({ ref, type: "other", mode: modeString(stat), nlink: stat.nlink });
      }
    }
  };
  visit(workspaceRoot);
  return entries;
}

function errorText(error) {
  return [
    error?.name,
    error?.message,
    error?.code,
    JSON.stringify(error?.details ?? null),
    JSON.stringify(error?.cause ?? null),
  ].join("\n");
}

async function rejectsWithoutHandle(action, handles, messagePattern = /binding|identity|registry|mutation|runtime/iu) {
  await assert.rejects(action, (error) => {
    const serialized = errorText(error);
    assert.match(serialized, messagePattern);
    for (const handle of handles) {
      assert.equal(serialized.includes(handle), false, "binding errors must redact raw handles");
    }
    return true;
  });
}

function assertNoRawHandle(value, handles, label = "public value") {
  const serialized = JSON.stringify(value);
  for (const handle of handles) {
    assert.equal(serialized.includes(handle), false, `${label} must not expose ${handle}`);
  }
}

function assertMutationResult(result, { status, bindingId, identityRef }) {
  assert.equal(result.status, status);
  assert.equal(result.bindingId, bindingId);
  assert.equal(result.identityRef, identityRef);
  assert.match(result.identityBindingDigest, /^sha256:[0-9a-f]{64}$/u);
  assertNoRawHandle(result, [HANDLE_A, HANDLE_B, HANDLE_C], `${status} result`);
}

function registerInput(workspaceRoot, overrides = {}) {
  return {
    workspaceRoot,
    windowId: CONTROLLER_WINDOW_ID,
    handle: { kind: "codex-thread", value: HANDLE_A },
    ...overrides,
  };
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
      else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(absolute);
    }
  };
  visit(root);
  return files;
}

test("T03 binding schema and codec close the sensitive identity record", () => {
  assert.equal(WAKEFLOW_WINDOW_BINDING_SCHEMA_VERSION, 1);
  assert.equal(typeof WAKEFLOW_WINDOW_BINDING_KIND, "string");
  assert.ok(WAKEFLOW_WINDOW_BINDING_KIND.length > 0);

  const schema = JSON.parse(readFileSync(schemaFile, "utf8"));
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [
    "kind",
    "schemaVersion",
    "programId",
    "hostId",
    "windowId",
    "bindingId",
    "handle",
    "registeredAt",
  ]);
  assert.equal(schema.properties.bindingId.pattern.startsWith("^binding_"), true);
  assert.equal(schema.properties.handle.additionalProperties, false);
  assert.deepEqual(schema.properties.handle.required, ["kind", "value"]);

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addFormat(
    "date-time",
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u,
  );
  const validateSchema = ajv.compile(schema);
  const record = recordFixture({ hostVerifiedAt: VERIFIED_AT });
  assert.equal(validateSchema(record), true, JSON.stringify(validateSchema.errors));
  assert.equal(Object.isFrozen(record), true);
  assert.deepEqual(Object.keys(record), [
    "kind",
    "schemaVersion",
    "programId",
    "hostId",
    "windowId",
    "bindingId",
    "handle",
    "registeredAt",
    "hostVerifiedAt",
  ]);
  assert.equal(windowBindingDigest(record), canonicalJsonDigest(record));
  assert.deepEqual(
    windowBindingCanonicalBytes(record),
    Buffer.from(`${canonicalJson(record)}\n`, "utf8"),
  );

  for (const forbidden of [
    "displayName",
    "windowName",
    "repositoryPath",
    "role",
    "cwd",
    "responsibility",
    "dispatchable",
    "deliveryPolicy",
    "prompt",
    "podReceipt",
    "processId",
    "lastVerifiedAt",
  ]) {
    assert.throws(
      () => validateWindowBindingRecord({ ...record, [forbidden]: "forbidden" }),
      /field|unknown|binding|identity/iu,
      forbidden,
    );
  }
  assert.throws(
    () => validateWindowBindingRecord({ ...record, bindingId: "semantic-controller" }),
    /binding|identifier|typed|uuid/iu,
  );
  assert.throws(
    () => validateWindowBindingRecord({ ...record, registeredAt: "today" }),
    /time|timestamp|utc|registered/iu,
  );
  assert.throws(
    () => validateWindowBindingRecord({ ...record, registeredAt: "2026-02-30T00:00:00Z" }),
    /time|timestamp|calendar|utc/iu,
  );
  assert.throws(
    () => validateWindowBindingRecord({
      ...record,
      registeredAt: VERIFIED_AT,
      hostVerifiedAt: REGISTERED_AT,
    }),
    /time|timestamp|precede|order/iu,
  );
  for (const invalidBindingId of [
    "binding_AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    "binding_aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa",
  ]) {
    assert.throws(
      () => validateWindowBindingRecord({ ...record, bindingId: invalidBindingId }),
      /binding|identifier|uuid/iu,
    );
  }
  assert.throws(
    () => validateWindowBindingRecord({
      ...record,
      handle: { ...record.handle, extra: true },
    }),
    /field|unknown|handle/iu,
  );
  const accessorRecord = { ...record };
  Object.defineProperty(accessorRecord, "registeredAt", {
    enumerable: true,
    get() {
      throw new Error("must not evaluate accessor");
    },
  });
  assert.throws(() => validateWindowBindingRecord(accessorRecord), /field|data property/iu);
  const symbolRecord = { ...record, [Symbol("private")]: true };
  assert.throws(() => validateWindowBindingRecord(symbolRecord), /symbol|field|unknown/iu);
  assert.throws(
    () => validateWindowBindingRecord(
      { ...record, handle: { kind: "claude-session", value: HANDLE_A } },
      {
        expectedProgramId: PROGRAM_ID,
        expectedHostId: "codex",
        expectedWindowId: CONTROLLER_WINDOW_ID,
        expectedHandleKind: "codex-thread",
      },
    ),
    /handle|kind|host/iu,
  );
});

test("T03 host profiles own handle kinds and stable windowId owns the canonical ref", () => {
  assert.equal(codexProfile.handleId.kind, "codex-thread");
  assert.equal(claudeProfile.handleId.kind, "claude-session");

  const first = configFixture();
  const renamed = configFixture();
  renamed.program.displayName = "Renamed program";
  renamed.topology.windows[0].displayName = "Renamed controller";
  assert.notEqual(first.topology.windows[0].displayName, renamed.topology.windows[0].displayName);
  assert.equal(
    windowBindingRef({ hostDirName: "codex", windowId: first.topology.windows[0].windowId }),
    windowBindingRef({ hostDirName: "codex", windowId: renamed.topology.windows[0].windowId }),
  );
  assert.equal(
    bindingRef(),
    `.wakeflow-local/runtime/hosts/codex/identity/window-bindings/${CONTROLLER_WINDOW_ID}.json`,
  );
  assert.throws(
    () => windowBindingRef({ hostDirName: "codex", windowId: "Controller" }),
    /window|identifier|typed|uuid/iu,
  );
});

test("T03 layout identity profile admission never executes a handle contract accessor", () => {
  let getterCalls = 0;
  const hostileProfile = { ...codexProfile };
  Object.defineProperty(hostileProfile, "handleId", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return codexProfile.handleId;
    },
  });
  assert.throws(
    () => inspectWindowBindingInventoryForLayout({
      workspaceRoot: "/must-not-be-inspected",
      programId: PROGRAM_ID,
      hostId: "codex",
      configDigest: `sha256:${"a".repeat(64)}`,
      windowIds: [],
      hostProfile: hostileProfile,
    }),
    (error) => error instanceof Error
      && error.code === "wakeflow-window-binding-profile",
  );
  assert.equal(getterCalls, 0);
});

test("T03 private handle consumer rejects behavioral and hidden result channels without executing them", async (t) => {
  const workspaceRoot = prepareWorkspace(t);
  const binding = await registerWindowBinding({
    workspaceRoot,
    windowId: CONTROLLER_WINDOW_ID,
    handle: { kind: codexProfile.handleId.kind, value: HANDLE_A },
  });
  const input = {
    workspaceRoot,
    windowId: CONTROLLER_WINDOW_ID,
    expectedBindingId: binding.bindingId,
    expectedBindingDigest: binding.identityBindingDigest,
  };

  let getterCalls = 0;
  const arrayAccessor = [];
  Object.defineProperty(arrayAccessor, "0", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return HANDLE_A;
    },
  });
  arrayAccessor.length = 1;
  const objectAccessor = {};
  Object.defineProperty(objectAccessor, "secret", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return HANDLE_A;
    },
  });
  const hiddenArray = [];
  Object.defineProperty(hiddenArray, "secret", {
    enumerable: false,
    value: HANDLE_A,
  });
  const symbolArray = [];
  symbolArray[Symbol("secret")] = HANDLE_A;

  for (const result of [arrayAccessor, objectAccessor, hiddenArray, symbolArray]) {
    await assert.rejects(
      () => withCurrentWindowBindingHandle(input, async () => result),
      (error) => error?.code === "wakeflow-window-binding-handle-leak",
    );
  }
  await assert.rejects(
    () => withCurrentWindowBindingHandle(input, async (handle) => () => handle.value),
    (error) => error?.code === "wakeflow-window-binding-handle-leak",
  );
  assert.equal(getterCalls, 0);
});

test("T03 synchronized Codex and Claude artifacts execute their own host identity seam", async (t) => {
  const fixtures = [
    {
      label: "codex",
      profile: codexProfile,
      serviceUrl: new URL(
        "../plugins/codex-wakeflow/scripts/lib/wakeflow-window-binding-service.mjs",
        import.meta.url,
      ),
      handle: HANDLE_A,
      wrongKind: "claude-session",
    },
    {
      label: "claude-code",
      profile: claudeProfile,
      serviceUrl: new URL(
        "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-window-binding-service.mjs",
        import.meta.url,
      ),
      handle: HANDLE_B,
      wrongKind: "codex-thread",
    },
  ];
  for (const fixture of fixtures) {
    await t.test(fixture.label, async (subtest) => {
      const service = await import(fixture.serviceUrl.href);
      const workspaceRoot = prepareWorkspace(subtest, { hostProfile: fixture.profile });
      const input = {
        workspaceRoot,
        windowId: CONTROLLER_WINDOW_ID,
        handle: { kind: fixture.profile.handleId.kind, value: fixture.handle },
      };
      const created = await service.registerWindowBinding(input);
      const expectedRef = windowBindingRef({
        hostDirName: fixture.profile.runtime.hostDirName,
        windowId: CONTROLLER_WINDOW_ID,
      });
      assertMutationResult(created, {
        status: "created",
        bindingId: created.bindingId,
        identityRef: expectedRef,
      });
      const target = absoluteRef(workspaceRoot, expectedRef);
      const bytes = readFileSync(target);
      assert.deepEqual(JSON.parse(bytes).handle, {
        kind: fixture.profile.handleId.kind,
        value: fixture.handle,
      });
      const replayed = await service.registerWindowBinding(input);
      assert.equal(replayed.status, "replayed");
      assert.equal(replayed.bindingId, created.bindingId);
      assert.deepEqual(readFileSync(target), bytes);
      await rejectsWithoutHandle(
        () => service.registerWindowBinding({
          ...input,
          handle: { kind: fixture.wrongKind, value: fixture.handle },
        }),
        [fixture.handle],
      );
      assert.deepEqual(readFileSync(target), bytes);
    });
  }
});

test("T03 register creates once and same-handle replay is byte stable", async (t) => {
  const workspaceRoot = prepareWorkspace(t);
  const expectedRef = bindingRef();
  const created = await registerWindowBinding(registerInput(workspaceRoot));
  assert.match(created.bindingId, /^binding_[0-9a-f-]{36}$/u);
  assertMutationResult(created, {
    status: "created",
    bindingId: created.bindingId,
    identityRef: expectedRef,
  });
  const target = bindingFile(workspaceRoot);
  const before = readFileSync(target);
  const firstRecord = JSON.parse(before);
  assert.deepEqual(firstRecord.handle, { kind: "codex-thread", value: HANDLE_A });
  assert.equal(firstRecord.bindingId, created.bindingId);
  assert.match(firstRecord.registeredAt, /^\d{4}-\d{2}-\d{2}T/iu);
  assert.equal(Object.hasOwn(firstRecord, "hostVerifiedAt"), false);

  const renamedConfig = configFixture();
  renamedConfig.program.displayName = "Renamed after registration";
  renamedConfig.topology.windows[0].displayName = "Renamed controller after registration";
  writeConfig(workspaceRoot, renamedConfig);
  const replayed = await registerWindowBinding(registerInput(workspaceRoot));
  assertMutationResult(replayed, {
    status: "replayed",
    bindingId: created.bindingId,
    identityRef: expectedRef,
  });
  assert.deepEqual(readFileSync(target), before);
  assert.equal(replayed.identityBindingDigest, created.identityBindingDigest);

  const inspection = inspectWindowBindingInventory({ workspaceRoot });
  assertNoRawHandle(inspection, [HANDLE_A], "binding inventory");
  const serialized = JSON.stringify(inspection);
  assert.equal(serialized.includes(CONTROLLER_WINDOW_ID), true);
  assert.equal(serialized.includes(created.bindingId), true);
  assert.equal(serialized.includes(created.identityBindingDigest), true);
});

test("T03 ordinary registration cannot replace or smuggle writer authority", async (t) => {
  const workspaceRoot = prepareWorkspace(t);
  await registerWindowBinding(registerInput(workspaceRoot));
  const target = bindingFile(workspaceRoot);
  const before = readFileSync(target);

  await rejectsWithoutHandle(
    () => registerWindowBinding(registerInput(workspaceRoot, {
      handle: { kind: "codex-thread", value: HANDLE_B },
    })),
    [HANDLE_A, HANDLE_B],
  );
  assert.deepEqual(readFileSync(target), before);

  for (const invalidHandle of [
    { kind: "claude-session", value: HANDLE_B },
    { kind: "codex-thread", value: "current-codex-thread" },
    { kind: "codex-thread", value: HANDLE_B.toUpperCase() },
  ]) {
    await rejectsWithoutHandle(
      () => registerWindowBinding(registerInput(workspaceRoot, { handle: invalidHandle })),
      [HANDLE_A, HANDLE_B],
      /handle|identity|input|binding/iu,
    );
    assert.deepEqual(readFileSync(target), before);
  }

  for (const forbiddenInput of [
    { bindingId: BINDING_B },
    { config: configFixture() },
    { hostProfile: codexProfile },
    { registeredAt: REGISTERED_AT },
    { hostVerifiedAt: VERIFIED_AT },
    { hostEvidence: { verifiedAt: VERIFIED_AT } },
  ]) {
    await rejectsWithoutHandle(
      () => registerWindowBinding(registerInput(workspaceRoot, forbiddenInput)),
      [HANDLE_A],
      /contract|field|input|binding|identity/iu,
    );
    assert.deepEqual(readFileSync(target), before);
  }
});

test("T03 explicit replacement and decommission require bindingId plus digest CAS", async (t) => {
  const workspaceRoot = prepareWorkspace(t);
  const created = await registerWindowBinding(registerInput(workspaceRoot));
  const target = bindingFile(workspaceRoot);
  const initialBytes = readFileSync(target);

  for (const stale of [
    { expectedBindingId: BINDING_B, expectedBindingDigest: created.identityBindingDigest },
    { expectedBindingId: created.bindingId, expectedBindingDigest: `sha256:${"0".repeat(64)}` },
  ]) {
    await rejectsWithoutHandle(
      () => replaceWindowBinding({
        workspaceRoot,
        windowId: CONTROLLER_WINDOW_ID,
        handle: { kind: "codex-thread", value: HANDLE_B },
        ...stale,
      }),
      [HANDLE_A, HANDLE_B],
    );
    assert.deepEqual(readFileSync(target), initialBytes);
  }

  const replaced = await replaceWindowBinding({
    workspaceRoot,
    windowId: CONTROLLER_WINDOW_ID,
    handle: { kind: "codex-thread", value: HANDLE_B },
    expectedBindingId: created.bindingId,
    expectedBindingDigest: created.identityBindingDigest,
  });
  assert.match(replaced.bindingId, /^binding_[0-9a-f-]{36}$/u);
  assert.notEqual(replaced.bindingId, created.bindingId);
  assertMutationResult(replaced, {
    status: "replaced",
    bindingId: replaced.bindingId,
    identityRef: bindingRef(),
  });
  assert.notEqual(replaced.identityBindingDigest, created.identityBindingDigest);
  const successorBytes = readFileSync(target);
  const successor = JSON.parse(successorBytes);
  assert.equal(successor.bindingId, replaced.bindingId);
  assert.equal(successor.handle.value, HANDLE_B);
  assert.ok(
    Date.parse(successor.registeredAt) > Date.parse(JSON.parse(initialBytes).registeredAt),
    "replacement registeredAt must advance strictly",
  );

  await rejectsWithoutHandle(
    () => replaceWindowBinding({
      workspaceRoot,
      windowId: CONTROLLER_WINDOW_ID,
      handle: { kind: "codex-thread", value: HANDLE_B },
      expectedBindingId: replaced.bindingId,
      expectedBindingDigest: replaced.identityBindingDigest,
    }),
    [HANDLE_A, HANDLE_B],
    /replay|same|binding|identity/iu,
  );
  assert.deepEqual(readFileSync(target), successorBytes);

  await rejectsWithoutHandle(
    () => decommissionWindowBinding({
      workspaceRoot,
      windowId: CONTROLLER_WINDOW_ID,
      expectedBindingId: created.bindingId,
      expectedBindingDigest: created.identityBindingDigest,
    }),
    [HANDLE_A, HANDLE_B],
  );
  assert.deepEqual(readFileSync(target), successorBytes, "stale decommission must preserve successor");

  const decommissioned = await decommissionWindowBinding({
    workspaceRoot,
    windowId: CONTROLLER_WINDOW_ID,
    expectedBindingId: replaced.bindingId,
    expectedBindingDigest: replaced.identityBindingDigest,
  });
  assertMutationResult(decommissioned, {
    status: "decommissioned",
    bindingId: replaced.bindingId,
    identityRef: bindingRef(),
  });
  assert.equal(existsSync(target), false);
  await rejectsWithoutHandle(
    () => decommissionWindowBinding({
      workspaceRoot,
      windowId: CONTROLLER_WINDOW_ID,
      expectedBindingId: replaced.bindingId,
      expectedBindingDigest: replaced.identityBindingDigest,
    }),
    [HANDLE_A, HANDLE_B],
  );
});

test("T05 active lease presence blocks binding replacement and decommission with zero write", async (t) => {
  const nodeScenarios = [
    {
      label: "canonical lease record",
      create(target, ignoredWorkspaceRoot, binding) {
        writeFileSync(target, canonicalCoordinationLeaseBytes(binding), { mode: 0o600 });
        chmodSync(target, 0o600);
      },
    },
    {
      label: "unsafe-mode corrupt node",
      create(target) {
        writeFileSync(target, "not-json\n", { mode: 0o644 });
        chmodSync(target, 0o644);
      },
    },
    {
      label: "symlink node",
      create(target, workspaceRoot) {
        symlinkSync(path.join(workspaceRoot, "wakeflow.config.json"), target);
      },
    },
  ];

  for (const operation of ["replace", "decommission"]) {
    for (const scenario of nodeScenarios) {
      await t.test(`${operation}: ${scenario.label}`, async (subtest) => {
        const workspaceRoot = prepareWorkspace(subtest);
        const created = await registerWindowBinding(registerInput(workspaceRoot));
        const leaseTarget = coordinationLeaseFile(workspaceRoot);
        ensurePrivateDirectory(
          workspaceRoot,
          ".wakeflow-local/runtime/shared/coordination/window-leases",
        );
        scenario.create(leaseTarget, workspaceRoot, created);
        const before = snapshotTree(workspaceRoot);
        const mutate = operation === "replace"
          ? () => replaceWindowBinding({
            workspaceRoot,
            windowId: CONTROLLER_WINDOW_ID,
            handle: { kind: "codex-thread", value: HANDLE_B },
            expectedBindingId: created.bindingId,
            expectedBindingDigest: created.identityBindingDigest,
          })
          : () => decommissionWindowBinding({
            workspaceRoot,
            windowId: CONTROLLER_WINDOW_ID,
            expectedBindingId: created.bindingId,
            expectedBindingDigest: created.identityBindingDigest,
          });

        await assert.rejects(mutate, (error) => {
          assert.equal(error?.code, "wakeflow-window-binding-active-lease");
          assert.equal(error?.details?.windowId, CONTROLLER_WINDOW_ID);
          assert.equal(
            error?.details?.leaseRef,
            `.wakeflow-local/runtime/shared/coordination/window-leases/${CONTROLLER_WINDOW_ID}.json`,
          );
          assertNoRawHandle(error, [HANDLE_A, HANDLE_B], "active-lease rejection");
          return true;
        });
        assert.deepEqual(snapshotTree(workspaceRoot), before);
        assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");
      });
    }
  }

  await t.test("register remains outside the active-lease guard", async (subtest) => {
    const workspaceRoot = prepareWorkspace(subtest);
    const leaseTarget = coordinationLeaseFile(workspaceRoot);
    ensurePrivateDirectory(
      workspaceRoot,
      ".wakeflow-local/runtime/shared/coordination/window-leases",
    );
    writeFileSync(leaseTarget, "opaque-existing-node\n", { mode: 0o600 });
    chmodSync(leaseTarget, 0o600);
    const leaseBytes = readFileSync(leaseTarget);

    const created = await registerWindowBinding(registerInput(workspaceRoot));

    assert.equal(created.status, "created");
    assert.deepEqual(readFileSync(leaseTarget), leaseBytes);
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");
  });

  for (const operation of ["replace", "decommission"]) {
    await t.test(`${operation}: coordination ancestor symlink`, async (subtest) => {
      const workspaceRoot = prepareWorkspace(subtest);
      const created = await registerWindowBinding(registerInput(workspaceRoot));
      const outside = ensurePrivateDirectory(workspaceRoot, "outside-coordination");
      writeFileSync(path.join(outside, "sentinel"), "preserve\n", { mode: 0o600 });
      const shared = absoluteRef(workspaceRoot, ".wakeflow-local/runtime/shared");
      symlinkSync(outside, shared);
      const before = snapshotTree(workspaceRoot);
      const mutate = operation === "replace"
        ? () => replaceWindowBinding({
          workspaceRoot,
          windowId: CONTROLLER_WINDOW_ID,
          handle: { kind: "codex-thread", value: HANDLE_B },
          expectedBindingId: created.bindingId,
          expectedBindingDigest: created.identityBindingDigest,
        })
        : () => decommissionWindowBinding({
          workspaceRoot,
          windowId: CONTROLLER_WINDOW_ID,
          expectedBindingId: created.bindingId,
          expectedBindingDigest: created.identityBindingDigest,
        });

      await assert.rejects(mutate, (error) => {
        assert.equal(error?.code, "wakeflow-window-binding-layout");
        assertNoRawHandle(error, [HANDLE_A, HANDLE_B], "ancestor-symlink rejection");
        return true;
      });
      assert.deepEqual(snapshotTree(workspaceRoot), before);
      assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");
    });
  }
});

test("T03 duplicate handles and legacy-new dual authority fail closed", async (t) => {
  await t.test("one raw handle cannot bind two active durable windows", async (t) => {
    const workspaceRoot = prepareWorkspace(t);
    await registerWindowBinding(registerInput(workspaceRoot));
    const before = snapshotTree(workspaceRoot);
    await rejectsWithoutHandle(
      () => registerWindowBinding({
        workspaceRoot,
        windowId: DESIGN_WINDOW_ID,
        handle: { kind: "codex-thread", value: HANDLE_A },
      }),
      [HANDLE_A],
      /duplicate|binding|identity/iu,
    );
    assert.deepEqual(snapshotTree(workspaceRoot), before);
    assert.equal(existsSync(bindingFile(workspaceRoot, DESIGN_WINDOW_ID)), false);
  });

  await t.test("one binding ID cannot identify two active durable windows", async (t) => {
    const workspaceRoot = prepareWorkspace(t);
    writeBindingFixture(workspaceRoot, recordFixture());
    writeBindingFixture(workspaceRoot, recordFixture({
      windowId: DESIGN_WINDOW_ID,
      bindingId: BINDING_A,
      handle: { kind: "codex-thread", value: HANDLE_B },
    }));
    const before = snapshotTree(workspaceRoot);
    await rejectsWithoutHandle(
      async () => inspectWindowBindingInventory({ workspaceRoot }),
      [HANDLE_A, HANDLE_B],
      /duplicate|binding|identity/iu,
    );
    assert.deepEqual(snapshotTree(workspaceRoot), before);
  });

  await t.test("a legacy registry plus a new binding is never reconciled by guess", async (t) => {
    const workspaceRoot = prepareWorkspace(t);
    await registerWindowBinding(registerInput(workspaceRoot));
    const legacyDirectory = ensurePrivateDirectory(
      workspaceRoot,
      `.wakeflow-local/wakeflow-delivery/hosts/${codexProfile.runtime.hostDirName}/thread-registry`,
    );
    const legacyFile = path.join(legacyDirectory, "controller.json");
    writeFileSync(legacyFile, `${JSON.stringify({
      kind: "CodexWindowThreadRegistration",
      version: 3,
      bindingId: "legacy-binding",
      windowName: "Controller",
      threadId: HANDLE_A,
      registeredAt: REGISTERED_AT,
      lastVerifiedAt: REGISTERED_AT,
    })}\n`, { mode: 0o600 });
    chmodSync(legacyFile, 0o600);
    const before = snapshotTree(workspaceRoot);
    await rejectsWithoutHandle(
      async () => inspectWindowBindingInventory({ workspaceRoot }),
      [HANDLE_A],
      /legacy|dual|authority|binding|identity/iu,
    );
    assert.deepEqual(snapshotTree(workspaceRoot), before);
  });
});

test("T03 unsafe binding inventory rejects with zero domain write and no handle leak", async (t) => {
  const cases = [
    {
      name: "unknown non-json sibling",
      arrange(workspaceRoot) {
        const unknown = path.join(path.dirname(bindingFile(workspaceRoot)), "surprise.tmp");
        writeFileSync(unknown, "{}\n", { mode: 0o600 });
        chmodSync(unknown, 0o600);
      },
    },
    {
      name: "invalid binding filename",
      arrange(workspaceRoot) {
        const unknown = path.join(path.dirname(bindingFile(workspaceRoot)), "surprise.json");
        writeFileSync(unknown, "{}\n", { mode: 0o600 });
        chmodSync(unknown, 0o600);
      },
    },
    {
      name: "symlink target",
      arrange(workspaceRoot) {
        const outside = path.join(workspaceRoot, "outside-binding.json");
        writeFileSync(outside, windowBindingCanonicalBytes(recordFixture()), { mode: 0o600 });
        chmodSync(outside, 0o600);
        symlinkSync(outside, bindingFile(workspaceRoot));
      },
    },
    {
      name: "hard-linked binding",
      arrange(workspaceRoot) {
        const target = writeBindingFixture(workspaceRoot);
        linkSync(target, path.join(workspaceRoot, "binding-alias.json"));
      },
    },
    {
      name: "wrong binding mode",
      arrange(workspaceRoot) {
        chmodSync(writeBindingFixture(workspaceRoot), 0o644);
      },
    },
    {
      name: "wrong binding type",
      arrange(workspaceRoot) {
        mkdirSync(bindingFile(workspaceRoot), { mode: 0o700 });
      },
    },
    {
      name: "corrupt binding record",
      arrange(workspaceRoot) {
        writeFileSync(bindingFile(workspaceRoot), "{}\n", { mode: 0o600 });
        chmodSync(bindingFile(workspaceRoot), 0o600);
      },
    },
    {
      name: "non-canonical binding bytes",
      arrange(workspaceRoot) {
        writeFileSync(
          bindingFile(workspaceRoot),
          `${JSON.stringify(recordFixture(), null, 2)}\n`,
          { mode: 0o600 },
        );
        chmodSync(bindingFile(workspaceRoot), 0o600);
      },
    },
    {
      name: "invalid UTF-8 binding bytes",
      arrange(workspaceRoot) {
        writeFileSync(bindingFile(workspaceRoot), Buffer.from([0xff]), { mode: 0o600 });
        chmodSync(bindingFile(workspaceRoot), 0o600);
      },
    },
    {
      name: "wrong record authority",
      arrange(workspaceRoot) {
        writeBindingFixture(workspaceRoot, recordFixture({
          programId: "program_99999999-9999-4999-8999-999999999999",
        }));
      },
    },
    {
      name: "identity ancestor symlink",
      arrange(workspaceRoot) {
        const root = path.dirname(bindingFile(workspaceRoot));
        rmSync(root, { recursive: true, force: true });
        const outside = ensurePrivateDirectory(workspaceRoot, "outside-bindings");
        writeFileSync(path.join(outside, "sentinel"), "preserve\n", { mode: 0o600 });
        symlinkSync(outside, root);
      },
    },
    {
      name: "identity ancestor wrong type",
      arrange(workspaceRoot) {
        const root = path.dirname(bindingFile(workspaceRoot));
        rmSync(root, { recursive: true, force: true });
        writeFileSync(root, "not a directory\n", { mode: 0o600 });
        chmodSync(root, 0o600);
      },
    },
    {
      name: "identity ancestor mode drift",
      arrange(workspaceRoot) {
        chmodSync(path.dirname(bindingFile(workspaceRoot)), 0o744);
      },
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async (t) => {
      const workspaceRoot = prepareWorkspace(t);
      fixture.arrange(workspaceRoot);
      const before = snapshotTree(workspaceRoot);
      await rejectsWithoutHandle(
        () => registerWindowBinding(registerInput(workspaceRoot, {
          handle: { kind: "codex-thread", value: HANDLE_B },
        })),
        [HANDLE_A, HANDLE_B],
        /inventory|unknown|symlink|link|mode|type|binding|identity|unsafe/iu,
      );
      assert.deepEqual(snapshotTree(workspaceRoot), before);
    });
  }
});

test("T03 structurally inventories orphan typed identity while authority selection stays exact", async (t) => {
  const workspaceRoot = prepareWorkspace(t);
  const orphanWindowId = "window_99999999-9999-4999-8999-999999999999";
  writeBindingFixture(workspaceRoot, recordFixture({
    windowId: orphanWindowId,
    bindingId: BINDING_B,
  }));
  const inventory = inspectWindowBindingInventory({ workspaceRoot });
  assert.deepEqual(inventory.bindings.map((entry) => entry.windowId), [orphanWindowId]);
  assertNoRawHandle(inventory, [HANDLE_A]);
  await rejectsWithoutHandle(
    () => registerWindowBinding({
      workspaceRoot,
      windowId: orphanWindowId,
      handle: { kind: "codex-thread", value: HANDLE_B },
    }),
    [HANDLE_A, HANDLE_B],
    /durable|topology|authorized|window|binding/iu,
  );
  const durable = await registerWindowBinding(registerInput(workspaceRoot, {
    handle: { kind: "codex-thread", value: HANDLE_B },
  }));
  assert.equal(durable.windowId, CONTROLLER_WINDOW_ID);
  assert.deepEqual(
    inspectWindowBindingInventory({ workspaceRoot }).bindings.map((entry) => entry.windowId),
    [CONTROLLER_WINDOW_ID, orphanWindowId].sort(),
  );
});

test("T03 runtime mutation gate blocks owner work and concurrent replacement has one winner", async (t) => {
  await t.test("busy T02 gate causes zero identity write", async (t) => {
    const workspaceRoot = prepareWorkspace(t);
    let releaseHolder;
    let announceEntered;
    const entered = new Promise((resolve) => { announceEntered = resolve; });
    const release = new Promise((resolve) => { releaseHolder = resolve; });
    const holder = withWakeflowRuntimeMutation({
      workspaceRoot,
      operationKind: "window-binding-red-holder",
      domainOwner: "window-registration-service",
    }, async () => {
      announceEntered();
      await release;
      return { status: "released" };
    });
    await entered;
    const before = snapshotTree(workspaceRoot);
    await rejectsWithoutHandle(
      () => registerWindowBinding(registerInput(workspaceRoot, { acquireTimeoutMs: 0 })),
      [HANDLE_A],
      /busy|lock|mutation|runtime|binding/iu,
    );
    assert.deepEqual(snapshotTree(workspaceRoot), before);
    assert.equal(existsSync(bindingFile(workspaceRoot)), false);
    releaseHolder();
    await holder;
  });

  await t.test("two replacements of one generation cannot both commit", async (t) => {
    const workspaceRoot = prepareWorkspace(t);
    const created = await registerWindowBinding(registerInput(workspaceRoot));
    const common = {
      workspaceRoot,
      windowId: CONTROLLER_WINDOW_ID,
      expectedBindingId: created.bindingId,
      expectedBindingDigest: created.identityBindingDigest,
    };
    const settled = await Promise.allSettled([
      replaceWindowBinding({
        ...common,
        handle: { kind: "codex-thread", value: HANDLE_B },
      }),
      replaceWindowBinding({
        ...common,
        handle: { kind: "codex-thread", value: HANDLE_C },
      }),
    ]);
    assert.equal(settled.filter((entry) => entry.status === "fulfilled").length, 1);
    assert.equal(settled.filter((entry) => entry.status === "rejected").length, 1);
    const winner = settled.find((entry) => entry.status === "fulfilled").value;
    const loser = settled.find((entry) => entry.status === "rejected").reason;
    assert.match(winner.bindingId, /^binding_[0-9a-f-]{36}$/u);
    assert.notEqual(winner.bindingId, created.bindingId);
    assertNoRawHandle(winner, [HANDLE_A, HANDLE_B, HANDLE_C], "concurrent winner");
    assertNoRawHandle({ error: errorText(loser) }, [HANDLE_A, HANDLE_B, HANDLE_C], "concurrent loser");
    const current = JSON.parse(readFileSync(bindingFile(workspaceRoot)));
    assert.equal(current.bindingId, winner.bindingId);
    assert.equal([HANDLE_B, HANDLE_C].includes(current.handle.value), true);
  });
});

test("T03 commit faults preserve one exact identity outcome or T02 recovery evidence", async (t) => {
  await t.test("predecessor-capture failure preserves exact old identity and releases the gate", async (t) => {
    const workspaceRoot = prepareWorkspace(t);
    const created = await registerWindowBinding(registerInput(workspaceRoot));
    const target = bindingFile(workspaceRoot);
    const before = readFileSync(target);
    const beforeStat = lstatSync(target);
    const originalRename = fs.renameSync;
    let injected = false;
    t.mock.method(fs, "renameSync", (source, destination) => {
      if (
        !injected
        && source === target
        && String(destination).includes(".wakeflow-predecessor-")
      ) {
        injected = true;
        const error = new Error("injected predecessor capture failure");
        error.code = "EIO";
        throw error;
      }
      return originalRename(source, destination);
    });

    await rejectsWithoutHandle(
      () => replaceWindowBinding({
        workspaceRoot,
        windowId: CONTROLLER_WINDOW_ID,
        handle: { kind: "codex-thread", value: HANDLE_B },
        expectedBindingId: created.bindingId,
        expectedBindingDigest: created.identityBindingDigest,
      }),
      [HANDLE_A, HANDLE_B],
    );
    assert.equal(injected, true);
    assert.deepEqual(readFileSync(target), before);
    assert.equal(lstatSync(target).ino, beforeStat.ino);
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");

    const retried = await replaceWindowBinding({
      workspaceRoot,
      windowId: CONTROLLER_WINDOW_ID,
      handle: { kind: "codex-thread", value: HANDLE_B },
      expectedBindingId: created.bindingId,
      expectedBindingDigest: created.identityBindingDigest,
    });
    assert.equal(retried.status, "replaced");
  });

  await t.test("predecessor cleanup cannot adopt a same-name replacement as exact removal", async (t) => {
    const workspaceRoot = prepareWorkspace(t);
    const created = await registerWindowBinding(registerInput(workspaceRoot));
    const target = bindingFile(workspaceRoot);
    const capturedPredecessor = path.join(workspaceRoot, "captured-predecessor.json");
    const originalRename = fs.renameSync;
    const originalUnlink = fs.unlinkSync;
    let injected = false;
    t.mock.method(fs, "unlinkSync", (candidate) => {
      if (!injected && String(candidate).includes(".wakeflow-predecessor-")) {
        originalRename(candidate, capturedPredecessor);
        writeFileSync(candidate, "same-name predecessor replacement\n", { mode: 0o600 });
        chmodSync(candidate, 0o600);
        injected = true;
      }
      return originalUnlink(candidate);
    });

    await rejectsWithoutHandle(
      () => replaceWindowBinding({
        workspaceRoot,
        windowId: CONTROLLER_WINDOW_ID,
        handle: { kind: "codex-thread", value: HANDLE_B },
        expectedBindingId: created.bindingId,
        expectedBindingDigest: created.identityBindingDigest,
      }),
      [HANDLE_A, HANDLE_B],
      /recovery|mutation|binding|identity/iu,
    );
    assert.equal(injected, true);
    assert.equal(existsSync(capturedPredecessor), true);
    assert.equal(JSON.parse(readFileSync(target)).handle.value, HANDLE_B);
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "busy");
  });

  await t.test("a lease published after the guard cannot turn a committed replacement into success", async (t) => {
    const workspaceRoot = prepareWorkspace(t);
    const created = await registerWindowBinding(registerInput(workspaceRoot));
    const target = bindingFile(workspaceRoot);
    const leaseTarget = coordinationLeaseFile(workspaceRoot);
    ensurePrivateDirectory(
      workspaceRoot,
      ".wakeflow-local/runtime/shared/coordination/window-leases",
    );
    const oldOwnerLease = canonicalCoordinationLeaseBytes(created);
    const originalLink = fs.linkSync;
    let injected = false;
    t.mock.method(fs, "linkSync", (source, destination) => {
      if (
        !injected
        && destination === target
        && String(source).includes(".wakeflow-stage-")
      ) {
        writeFileSync(leaseTarget, oldOwnerLease, { flag: "wx", mode: 0o600 });
        chmodSync(leaseTarget, 0o600);
        injected = true;
      }
      return originalLink(source, destination);
    });

    await assert.rejects(
      () => replaceWindowBinding({
        workspaceRoot,
        windowId: CONTROLLER_WINDOW_ID,
        handle: { kind: "codex-thread", value: HANDLE_B },
        expectedBindingId: created.bindingId,
        expectedBindingDigest: created.identityBindingDigest,
      }),
      (error) => {
        assert.equal(error?.code, "wakeflow-window-binding-recovery-required");
        assertNoRawHandle(error, [HANDLE_A, HANDLE_B], "post-guard lease race rejection");
        return true;
      },
    );
    assert.equal(injected, true);
    const committed = JSON.parse(readFileSync(target));
    assert.notEqual(committed.bindingId, created.bindingId);
    assert.equal(committed.handle.value, HANDLE_B);
    assert.deepEqual(readFileSync(leaseTarget), oldOwnerLease);
    const mutation = inspectWakeflowWorkspaceMutation({ workspaceRoot });
    assert.equal(mutation.state, "busy");
    assert.equal(mutation.lock?.operationKind, "window-binding-replace");
  });

  await t.test("one-shot target fsync failure settles the exact committed identity", async (t) => {
    const workspaceRoot = prepareWorkspace(t);
    const created = await registerWindowBinding(registerInput(workspaceRoot));
    const target = bindingFile(workspaceRoot);
    const originalFsync = fs.fsyncSync;
    let injected = false;
    t.mock.method(fs, "fsyncSync", (descriptor) => {
      const opened = fs.fstatSync(descriptor, { bigint: true });
      let current = null;
      try {
        current = fs.lstatSync(target, { bigint: true });
      } catch {
        // The binding target is not yet committed.
      }
      if (
        !injected
        && current?.isFile()
        && opened.dev === current.dev
        && opened.ino === current.ino
      ) {
        injected = true;
        const error = new Error("injected one-shot binding fsync failure");
        error.code = "EIO";
        throw error;
      }
      return originalFsync(descriptor);
    });

    const replaced = await replaceWindowBinding({
      workspaceRoot,
      windowId: CONTROLLER_WINDOW_ID,
      handle: { kind: "codex-thread", value: HANDLE_B },
      expectedBindingId: created.bindingId,
      expectedBindingDigest: created.identityBindingDigest,
    });
    assert.equal(injected, true);
    assert.equal(replaced.status, "replaced");
    assert.equal(JSON.parse(readFileSync(target)).bindingId, replaced.bindingId);
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");
  });

  await t.test("persistent target fsync failure keeps the exact new identity plus recovery gate", async (t) => {
    const workspaceRoot = prepareWorkspace(t);
    const created = await registerWindowBinding(registerInput(workspaceRoot));
    const target = bindingFile(workspaceRoot);
    const originalFsync = fs.fsyncSync;
    let injected = 0;
    t.mock.method(fs, "fsyncSync", (descriptor) => {
      const opened = fs.fstatSync(descriptor, { bigint: true });
      let current = null;
      try {
        current = fs.lstatSync(target, { bigint: true });
      } catch {
        // The binding target is not yet committed.
      }
      if (
        current?.isFile()
        && opened.dev === current.dev
        && opened.ino === current.ino
      ) {
        injected += 1;
        const error = new Error("injected persistent binding fsync failure");
        error.code = "EIO";
        throw error;
      }
      return originalFsync(descriptor);
    });

    await rejectsWithoutHandle(
      () => replaceWindowBinding({
        workspaceRoot,
        windowId: CONTROLLER_WINDOW_ID,
        handle: { kind: "codex-thread", value: HANDLE_B },
        expectedBindingId: created.bindingId,
        expectedBindingDigest: created.identityBindingDigest,
      }),
      [HANDLE_A, HANDLE_B],
      /recovery|mutation|binding|identity/iu,
    );
    assert.ok(injected >= 2);
    const committed = JSON.parse(readFileSync(target));
    assert.equal(committed.handle.value, HANDLE_B);
    const mutation = inspectWakeflowWorkspaceMutation({ workspaceRoot });
    assert.equal(mutation.state, "busy");
    assert.equal(mutation.lock?.operationKind, "window-binding-replace");
  });

  await t.test("same-byte source inode replacement cannot cross replace CAS", async (t) => {
    const workspaceRoot = prepareWorkspace(t);
    const created = await registerWindowBinding(registerInput(workspaceRoot));
    const target = bindingFile(workspaceRoot);
    const before = readFileSync(target);
    const beforeInode = lstatSync(target).ino;
    const originalOpen = fs.openSync;
    const originalRename = fs.renameSync;
    let injected = false;
    t.mock.method(fs, "openSync", (file, flags, mode) => {
      if (!injected && String(file).includes(".wakeflow-stage-")) {
        const replacement = `${target}.same-bytes-replacement`;
        writeFileSync(replacement, before, { mode: 0o600 });
        chmodSync(replacement, 0o600);
        originalRename(replacement, target);
        injected = true;
      }
      return originalOpen(file, flags, mode);
    });

    await rejectsWithoutHandle(
      () => replaceWindowBinding({
        workspaceRoot,
        windowId: CONTROLLER_WINDOW_ID,
        handle: { kind: "codex-thread", value: HANDLE_B },
        expectedBindingId: created.bindingId,
        expectedBindingDigest: created.identityBindingDigest,
      }),
      [HANDLE_A, HANDLE_B],
      /recovery|mutation|binding|identity/iu,
    );
    assert.equal(injected, true);
    assert.deepEqual(readFileSync(target), before);
    assert.notEqual(lstatSync(target).ino, beforeInode);
    assert.deepEqual(
      readdirSync(path.dirname(target)).filter((name) => name.includes("wakeflow-stage")),
      [],
    );
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "busy");
  });

  await t.test("commit inode replacement before fsync cannot be reported as success", async (t) => {
    const workspaceRoot = prepareWorkspace(t);
    const created = await registerWindowBinding(registerInput(workspaceRoot));
    const target = bindingFile(workspaceRoot);
    const originalFsync = fs.fsyncSync;
    const originalRename = fs.renameSync;
    let committedInode = null;
    let injected = false;
    t.mock.method(fs, "fsyncSync", (descriptor) => {
      const opened = fs.fstatSync(descriptor, { bigint: true });
      let current = null;
      try {
        current = fs.lstatSync(target, { bigint: true });
      } catch {
        // The binding target is not yet committed.
      }
      if (
        !injected
        && current?.isFile()
        && opened.dev === current.dev
        && opened.ino === current.ino
      ) {
        committedInode = String(current.ino);
        const bytes = readFileSync(target);
        const replacement = `${target}.post-commit-replacement`;
        writeFileSync(replacement, bytes, { mode: 0o600 });
        chmodSync(replacement, 0o600);
        originalRename(replacement, target);
        injected = true;
      }
      return originalFsync(descriptor);
    });

    await rejectsWithoutHandle(
      () => replaceWindowBinding({
        workspaceRoot,
        windowId: CONTROLLER_WINDOW_ID,
        handle: { kind: "codex-thread", value: HANDLE_B },
        expectedBindingId: created.bindingId,
        expectedBindingDigest: created.identityBindingDigest,
      }),
      [HANDLE_A, HANDLE_B],
      /recovery|mutation|binding|identity/iu,
    );
    assert.equal(injected, true);
    assert.notEqual(String(lstatSync(target, { bigint: true }).ino), committedInode);
    assert.equal(JSON.parse(readFileSync(target)).handle.value, HANDLE_B);
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "busy");
  });

  await t.test("absent create never overwrites a concurrently published binding", async (t) => {
    const workspaceRoot = prepareWorkspace(t);
    const target = bindingFile(workspaceRoot);
    const interloper = recordFixture({
      bindingId: BINDING_B,
      handle: { kind: "codex-thread", value: HANDLE_B },
    });
    const interloperBytes = windowBindingCanonicalBytes(interloper);
    const originalLink = fs.linkSync;
    let injected = false;
    t.mock.method(fs, "linkSync", (source, destination) => {
      if (!injected && destination === target && String(source).includes(".wakeflow-stage-")) {
        writeFileSync(target, interloperBytes, { flag: "wx", mode: 0o600 });
        chmodSync(target, 0o600);
        injected = true;
      }
      return originalLink(source, destination);
    });

    await rejectsWithoutHandle(
      () => registerWindowBinding(registerInput(workspaceRoot)),
      [HANDLE_A, HANDLE_B],
      /recovery|mutation|binding|identity/iu,
    );
    assert.equal(injected, true);
    assert.deepEqual(readFileSync(target), interloperBytes);
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "busy");
  });

  await t.test("decommission preserves a replacement captured at its final path boundary", async (t) => {
    const workspaceRoot = prepareWorkspace(t);
    const created = await registerWindowBinding(registerInput(workspaceRoot));
    const target = bindingFile(workspaceRoot);
    const successor = recordFixture({
      bindingId: BINDING_B,
      handle: { kind: "codex-thread", value: HANDLE_B },
      registeredAt: VERIFIED_AT,
    });
    const successorBytes = windowBindingCanonicalBytes(successor);
    const originalRename = fs.renameSync;
    let injected = false;
    t.mock.method(fs, "renameSync", (source, destination) => {
      if (
        !injected
        && source === target
        && String(destination).includes(".wakeflow-removal-")
      ) {
        const replacement = `${target}.successor`;
        writeFileSync(replacement, successorBytes, { mode: 0o600 });
        chmodSync(replacement, 0o600);
        originalRename(replacement, target);
        injected = true;
      }
      return originalRename(source, destination);
    });

    await rejectsWithoutHandle(
      () => decommissionWindowBinding({
        workspaceRoot,
        windowId: CONTROLLER_WINDOW_ID,
        expectedBindingId: created.bindingId,
        expectedBindingDigest: created.identityBindingDigest,
      }),
      [HANDLE_A, HANDLE_B],
      /recovery|mutation|binding|identity/iu,
    );
    assert.equal(injected, true);
    const removalStages = readdirSync(path.dirname(target))
      .filter((name) => name.includes(".wakeflow-removal-"));
    assert.equal(removalStages.length, 1);
    assert.deepEqual(
      readFileSync(path.join(path.dirname(target), removalStages[0])),
      successorBytes,
    );
    assert.equal(existsSync(target), false);
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "busy");
  });

  await t.test("decommission cleanup requires an exact unlink receipt before absent can succeed", async (t) => {
    const workspaceRoot = prepareWorkspace(t);
    const created = await registerWindowBinding(registerInput(workspaceRoot));
    const target = bindingFile(workspaceRoot);
    const capturedRemoval = path.join(workspaceRoot, "captured-removal.json");
    const originalRename = fs.renameSync;
    const originalUnlink = fs.unlinkSync;
    let injected = false;
    t.mock.method(fs, "unlinkSync", (candidate) => {
      if (!injected && String(candidate).includes(".wakeflow-removal-")) {
        originalRename(candidate, capturedRemoval);
        writeFileSync(candidate, "same-name removal replacement\n", { mode: 0o600 });
        chmodSync(candidate, 0o600);
        injected = true;
      }
      return originalUnlink(candidate);
    });

    await rejectsWithoutHandle(
      () => decommissionWindowBinding({
        workspaceRoot,
        windowId: CONTROLLER_WINDOW_ID,
        expectedBindingId: created.bindingId,
        expectedBindingDigest: created.identityBindingDigest,
      }),
      [HANDLE_A],
      /recovery|mutation|binding|identity/iu,
    );
    assert.equal(injected, true);
    assert.equal(existsSync(target), false);
    assert.equal(existsSync(capturedRemoval), true);
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "busy");
  });
});

test("T03 candidate and frozen public-v2 modules have a bidirectional zero-import fence", () => {
  const candidateForbidden = new Set([
    "wakeflow-setup.mjs",
    "wakeflow-window-runtime.mjs",
    "wakeflow-thread-registry.mjs",
    "wakeflow-delivery-store.mjs",
  ]);
  for (const candidate of [recordsFile, serviceFile, runtimeRecordsFile, runtimeProjectorFile]) {
    const imports = importSpecifiers(readFileSync(candidate, "utf8"));
    for (const specifier of imports) {
      assert.equal(
        candidateForbidden.has(path.posix.basename(specifier)),
        false,
        `${path.basename(candidate)} must not import ${specifier}`,
      );
    }
  }

  const retiredFiles = [
    path.join(repositoryRoot, "core/scripts/lib/wakeflow-window-runtime.mjs"),
    path.join(repositoryRoot, "core/scripts/lib/wakeflow-thread-registry.mjs"),
    path.join(repositoryRoot, "core/scripts/lib/wakeflow-delivery-store.mjs"),
  ];
  for (const retiredFile of retiredFiles) assert.equal(existsSync(retiredFile), false, retiredFile);

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
  const existing = (files) => files
    .filter((file) => existsSync(path.join(repositoryRoot, file)))
    .sort();
  assert.deepEqual(importersOf("wakeflow-window-binding-records.mjs"), existing([
    "core/scripts/lib/wakeflow-demand-core-records.mjs",
    "core/scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
    "core/scripts/lib/wakeflow-host-decommission-result.mjs",
    "core/scripts/lib/wakeflow-pod-records.mjs",
    "core/scripts/lib/wakeflow-pod-service.mjs",
    "core/scripts/lib/wakeflow-transport-records.mjs",
    "core/scripts/lib/wakeflow-window-binding-service.mjs",
    "core/scripts/lib/wakeflow-window-lease-records.mjs",
    "core/scripts/lib/wakeflow-window-lease-service.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-codex-decommission.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-window-binding-service.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-demand-core-records.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-host-decommission-result.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-pod-records.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-pod-service.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-transport-records.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-window-lease-records.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-window-lease-service.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-decommission.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-window-binding-service.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-demand-core-records.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-decommission-result.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-pod-records.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-pod-service.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-transport-records.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-window-lease-records.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-window-lease-service.mjs",
  ]));
  assert.deepEqual(importersOf("wakeflow-window-binding-service.mjs"), existing([
    "core/scripts/lib/wakeflow-delivery-orchestration.mjs",
    "core/scripts/lib/wakeflow-local-layout-inspection.mjs",
    "core/scripts/lib/wakeflow-observability-v3.mjs",
    "core/scripts/lib/wakeflow-pod-service.mjs",
    "core/scripts/lib/wakeflow-public-v3-runtime.mjs",
    "core/scripts/lib/wakeflow-result-review-orchestration.mjs",
    "core/scripts/lib/wakeflow-window-lease-service.mjs",
    "core/scripts/lib/wakeflow-window-runtime-projector.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-delivery-orchestration.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-local-layout-inspection.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-observability-v3.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-pod-service.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-public-v3-runtime.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-result-review-orchestration.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-window-lease-service.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-window-runtime-projector.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-lifecycle.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-locator.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-transport.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-delivery-orchestration.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-local-layout-inspection.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-observability-v3.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-pod-service.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-public-v3-runtime.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-result-review-orchestration.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-window-lease-service.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-window-runtime-projector.mjs",
  ]));
  assert.deepEqual(importersOf("wakeflow-window-runtime-records.mjs"), existing([
    "core/scripts/lib/wakeflow-window-runtime-projector.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-window-runtime-projector.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-window-runtime-projector.mjs",
  ]));
  assert.deepEqual(importersOf("wakeflow-window-runtime-projector.mjs"), existing([
    "core/scripts/lib/wakeflow-fresh-initialize.mjs",
    "core/scripts/lib/wakeflow-local-layout-inspection.mjs",
    "core/scripts/lib/wakeflow-local-layout-realization.mjs",
    "core/scripts/lib/wakeflow-maintenance-action-runtime.mjs",
    "core/scripts/lib/wakeflow-migration-production.mjs",
    "core/scripts/lib/wakeflow-observability-v3.mjs",
    "core/scripts/lib/wakeflow-reconcile.mjs",
    "core/scripts/lib/wakeflow-reconfigure.mjs",
    ...(existsSync(path.join(
      repositoryRoot,
      "plugins/codex-wakeflow/scripts/lib/wakeflow-window-runtime-projector.mjs",
    )) ? [
      "plugins/codex-wakeflow/scripts/lib/wakeflow-fresh-initialize.mjs",
      "plugins/codex-wakeflow/scripts/lib/wakeflow-local-layout-inspection.mjs",
      "plugins/codex-wakeflow/scripts/lib/wakeflow-local-layout-realization.mjs",
      "plugins/codex-wakeflow/scripts/lib/wakeflow-maintenance-action-runtime.mjs",
      "plugins/codex-wakeflow/scripts/lib/wakeflow-migration-production.mjs",
      "plugins/codex-wakeflow/scripts/lib/wakeflow-observability-v3.mjs",
      "plugins/codex-wakeflow/scripts/lib/wakeflow-reconfigure.mjs",
    ] : []),
    ...(existsSync(path.join(
      repositoryRoot,
      "plugins/claude-code-wakeflow/scripts/lib/wakeflow-window-runtime-projector.mjs",
    )) ? [
      "plugins/claude-code-wakeflow/scripts/lib/wakeflow-fresh-initialize.mjs",
      "plugins/claude-code-wakeflow/scripts/lib/wakeflow-local-layout-inspection.mjs",
      "plugins/claude-code-wakeflow/scripts/lib/wakeflow-local-layout-realization.mjs",
      "plugins/claude-code-wakeflow/scripts/lib/wakeflow-maintenance-action-runtime.mjs",
      "plugins/claude-code-wakeflow/scripts/lib/wakeflow-migration-production.mjs",
      "plugins/claude-code-wakeflow/scripts/lib/wakeflow-observability-v3.mjs",
      "plugins/claude-code-wakeflow/scripts/lib/wakeflow-reconfigure.mjs",
    ] : []),
    ...(existsSync(path.join(
      repositoryRoot,
      "plugins/codex-wakeflow/scripts/lib/wakeflow-reconcile.mjs",
    )) ? ["plugins/codex-wakeflow/scripts/lib/wakeflow-reconcile.mjs"] : []),
    ...(existsSync(path.join(
      repositoryRoot,
      "plugins/claude-code-wakeflow/scripts/lib/wakeflow-reconcile.mjs",
    )) ? ["plugins/claude-code-wakeflow/scripts/lib/wakeflow-reconcile.mjs"] : []),
  ]));
  assert.deepEqual(importersOf("wakeflow-local-layout-inspection.mjs"), existing([
    "core/scripts/lib/wakeflow-fresh-initialize.mjs",
    "core/scripts/lib/wakeflow-local-layout-realization.mjs",
    "core/scripts/lib/wakeflow-observability-v3.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-fresh-initialize.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-local-layout-realization.mjs",
    "plugins/codex-wakeflow/scripts/lib/wakeflow-observability-v3.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-fresh-initialize.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-local-layout-realization.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-observability-v3.mjs",
  ]));
  assert.deepEqual(
    importersOf("wakeflow-local-layout-realization.mjs"),
    existing([
      "core/scripts/lib/wakeflow-fresh-initialize.mjs",
      "core/scripts/lib/wakeflow-maintenance-action-runtime.mjs",
      "core/scripts/lib/wakeflow-migration-production.mjs",
      "core/scripts/lib/wakeflow-reconcile.mjs",
      "plugins/codex-wakeflow/scripts/lib/wakeflow-fresh-initialize.mjs",
      "plugins/codex-wakeflow/scripts/lib/wakeflow-maintenance-action-runtime.mjs",
      "plugins/codex-wakeflow/scripts/lib/wakeflow-migration-production.mjs",
      "plugins/codex-wakeflow/scripts/lib/wakeflow-reconcile.mjs",
      "plugins/claude-code-wakeflow/scripts/lib/wakeflow-fresh-initialize.mjs",
      "plugins/claude-code-wakeflow/scripts/lib/wakeflow-maintenance-action-runtime.mjs",
      "plugins/claude-code-wakeflow/scripts/lib/wakeflow-migration-production.mjs",
      "plugins/claude-code-wakeflow/scripts/lib/wakeflow-reconcile.mjs",
    ]),
    "only admitted fresh, maintenance, migration, and reconcile owners may consume the realization chain",
  );
  const cjsIngress = readFileSync(path.join(repositoryRoot, "core/mcp/server.cjs"), "utf8");
  for (const candidateBasename of [
    "wakeflow-config-v3-owner.mjs",
    "wakeflow-fresh-initialize.mjs",
    "wakeflow-reconcile.mjs",
    "wakeflow-reconfigure.mjs",
    "wakeflow-window-binding-records.mjs",
    "wakeflow-window-binding-service.mjs",
    "wakeflow-window-runtime-records.mjs",
    "wakeflow-window-runtime-projector.mjs",
    "wakeflow-local-layout-inspection.mjs",
    "wakeflow-local-layout-realization.mjs",
  ]) {
    assert.equal(cjsIngress.includes(candidateBasename), false, candidateBasename);
  }
});
