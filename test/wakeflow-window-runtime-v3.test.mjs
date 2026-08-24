import assert from "node:assert/strict";
import fs, {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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

import { hostProfile as codexProfile } from "../core/scripts/lib/wakeflow-host-profile.mjs";
import {
  WAKEFLOW_WINDOW_RUNTIME_KIND,
  WAKEFLOW_WINDOW_RUNTIME_SCHEMA_VERSION,
  createWindowRuntimeProjection,
  validateWindowRuntimeProjection,
  windowRuntimeProjectionCanonicalBytes,
  windowRuntimeProjectionDigest,
  windowRuntimeProjectionRef,
} from "../core/scripts/lib/wakeflow-window-runtime-records.mjs";
import {
  inspectWindowRuntimeProjections,
  rebuildWindowRuntimeProjections,
} from "../core/scripts/lib/wakeflow-window-runtime-projector.mjs";
import {
  inspectWindowBindingInventory,
  registerWindowBinding,
  replaceWindowBinding,
} from "../core/scripts/lib/wakeflow-window-binding-service.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import { parseWakeflowConfigV3 } from "../core/scripts/lib/wakeflow-config-v3.mjs";
import { createWakeflowLayoutDescriptor } from "../core/scripts/lib/wakeflow-layout-descriptor.mjs";
import { inspectWakeflowLocalLayout } from "../core/scripts/lib/wakeflow-local-layout-inspection.mjs";
import {
  inspectWakeflowWorkspaceMutation,
  withWakeflowRuntimeMutation,
} from "../core/scripts/lib/wakeflow-workspace-mutation.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configFixtureFile = path.join(
  repositoryRoot,
  "test/fixtures/wakeflow-config-v3/valid-minimal.json",
);
const fullConfigFixtureFile = path.join(
  repositoryRoot,
  "test/fixtures/wakeflow-config-v3/valid-full.json",
);
const schemaFile = path.join(
  repositoryRoot,
  "core/schemas/wakeflow-window-runtime/window-runtime.schema.json",
);
const recordsFile = path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-window-runtime-records.mjs",
);
const projectorFile = path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-window-runtime-projector.mjs",
);

const IDS = Object.freeze({
  program: "program_11111111-1111-4111-8111-111111111111",
  repository: "repository_22222222-2222-4222-8222-222222222222",
  designSurface: "surface_33333333-3333-4333-8333-333333333333",
  testSurface: "surface_44444444-4444-4444-8444-444444444444",
  controller: "window_55555555-5555-4555-8555-555555555555",
  design: "window_66666666-6666-4666-8666-666666666666",
  test: "window_77777777-7777-4777-8777-777777777777",
  product: "window_88888888-8888-4888-8888-888888888888",
  productTwo: "window_99999999-9999-4999-8999-999999999999",
});
const HANDLE_A = "10000000-0000-4000-8000-000000000001";
const HANDLE_B = "20000000-0000-4000-8000-000000000002";
const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;
const DIGEST_D = `sha256:${"d".repeat(64)}`;
const DIGEST_E = `sha256:${"e".repeat(64)}`;

function configFixture(file = configFixtureFile) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function ensurePrivateDirectory(root, ref) {
  let current = root;
  for (const segment of ref.split("/")) {
    current = path.join(current, segment);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    chmodSync(current, 0o700);
  }
  return current;
}

function prepareWorkspace(t, {
  missingProduct = false,
  config = configFixture(),
  profile = codexProfile,
} = {}) {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-window-runtime-v3-"));
  const workspaceRoot = path.join(fixtureRoot, "Program");
  mkdirSync(workspaceRoot, { mode: 0o700 });
  const configuredRoots = [
    ...config.topology.supportSurfaces.map((surface) => ({ path: surface.path, kind: "surface" })),
    ...config.topology.repositories.map((repository) => ({ path: repository.path, kind: "repository" })),
    { path: config.storage.ledgerRoot, kind: "ledger" },
  ];
  for (const root of configuredRoots) {
    if (missingProduct && root.kind === "repository") continue;
    const absolute = path.resolve(workspaceRoot, root.path);
    if (!existsSync(absolute)) mkdirSync(absolute, { recursive: true, mode: 0o700 });
    chmodSync(absolute, 0o700);
  }
  for (const ref of [
    ".wakeflow-local/runtime/maintenance/transactions",
    `.wakeflow-local/runtime/hosts/${profile.runtime.hostDirName}/identity/window-bindings`,
    `.wakeflow-local/runtime/hosts/${profile.runtime.hostDirName}/projections/window-runtime`,
  ]) {
    ensurePrivateDirectory(workspaceRoot, ref);
  }
  writeFileSync(
    path.join(workspaceRoot, "wakeflow.config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    { mode: 0o600 },
  );
  chmodSync(path.join(workspaceRoot, "wakeflow.config.json"), 0o600);
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  return workspaceRoot;
}

function projectionFile(workspaceRoot, windowId) {
  const ref = windowRuntimeProjectionRef({
    hostDirName: codexProfile.runtime.hostDirName,
    windowId,
  });
  assert.equal(path.posix.isAbsolute(ref), false);
  assert.equal(ref.includes("\\"), false);
  return path.resolve(workspaceRoot, ...ref.split("/"));
}

function readProjection(workspaceRoot, windowId) {
  return validateWindowRuntimeProjection(JSON.parse(readFileSync(
    projectionFile(workspaceRoot, windowId),
    "utf8",
  )));
}

function projectionResidue(workspaceRoot) {
  return fs.readdirSync(path.dirname(projectionFile(workspaceRoot, IDS.controller)))
    .filter((name) => name.includes("wakeflow-stage") || name.includes("wakeflow-predecessor"))
    .sort();
}

async function prepareStaleController(t) {
  const workspaceRoot = prepareWorkspace(t);
  await rebuildWindowRuntimeProjections({ workspaceRoot });
  await registerWindowBinding({
    workspaceRoot,
    windowId: IDS.controller,
    handle: { kind: "codex-thread", value: HANDLE_A },
  });
  assert.equal(inspectWindowRuntimeProjections({ workspaceRoot }).projectionStatus, "stale");
  return workspaceRoot;
}

function recordFixture(overrides = {}) {
  return createWindowRuntimeProjection({
    programId: IDS.program,
    hostId: "codex",
    windowId: IDS.controller,
    role: "controller",
    rootRef: { kind: "program", programId: IDS.program },
    configuredRoot: ".",
    resolvedRoot: { status: "unobserved", observationDigest: DIGEST_A },
    identity: { status: "unregistered" },
    dispatchEligibility: "eligible",
    preflightStatus: "blocked",
    blockingReasons: [{ code: "identity-unregistered", source: "identity" }],
    hostAvailability: { status: "unobserved" },
    sourceFingerprints: {
      configDigest: DIGEST_A,
      topologyDigest: DIGEST_B,
      windowDigest: DIGEST_C,
      rootObservationDigest: DIGEST_A,
      identityInventoryDigest: DIGEST_D,
    },
    ...overrides,
  });
}

function publicError(error) {
  return [
    error?.name,
    error?.message,
    error?.code,
    JSON.stringify(error?.details ?? null),
    JSON.stringify(error?.cause ?? null),
  ].join("\n");
}

function assertNoPrivateRuntimeData(value, workspaceRoot, handles = [HANDLE_A, HANDLE_B]) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  for (const forbidden of [workspaceRoot, ...handles]) {
    assert.equal(serialized.includes(forbidden), false, `public value leaked ${forbidden}`);
  }
}

test("T04 schema and codec define one closed deterministic projection", () => {
  assert.equal(WAKEFLOW_WINDOW_RUNTIME_SCHEMA_VERSION, 1);
  assert.equal(WAKEFLOW_WINDOW_RUNTIME_KIND, "wakeflow-window-runtime-projection");
  const schema = JSON.parse(readFileSync(schemaFile, "utf8"));
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.kind.const, WAKEFLOW_WINDOW_RUNTIME_KIND);
  assert.equal(schema.properties.schemaVersion.const, WAKEFLOW_WINDOW_RUNTIME_SCHEMA_VERSION);

  const validateSchema = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  const record = recordFixture();
  assert.equal(validateSchema(record), true, JSON.stringify(validateSchema.errors));
  assert.equal(Object.isFrozen(record), true);
  const { projectionDigest, ...unsigned } = record;
  assert.equal(projectionDigest, canonicalJsonDigest(unsigned));
  assert.equal(windowRuntimeProjectionDigest(record), projectionDigest);
  assert.deepEqual(
    windowRuntimeProjectionCanonicalBytes(record),
    Buffer.from(`${canonicalJson(record)}\n`, "utf8"),
  );

  for (const forbidden of [
    "handle",
    "threadId",
    "sessionId",
    "windowName",
    "displayName",
    "cwd",
    "responsibilityRoot",
    "dispatchable",
    "sendable",
    "threadRegistered",
    "delivery",
    "automation",
    "result",
    "prompt",
    "generatedAt",
    "podReceipt",
  ]) {
    assert.throws(
      () => validateWindowRuntimeProjection({ ...record, [forbidden]: "forbidden" }),
      /runtime|projection|field|unknown|schema/iu,
      forbidden,
    );
  }
  assert.throws(
    () => createWindowRuntimeProjection({
      ...unsigned,
      role: "design",
      dispatchEligibility: "eligible",
    }),
    /role|eligib|projection|runtime/iu,
  );
  assert.throws(
    () => createWindowRuntimeProjection({
      ...unsigned,
      preflightStatus: "ready",
      blockingReasons: [],
    }),
    /identity|preflight|projection|runtime/iu,
  );

  const design = createWindowRuntimeProjection({
    ...unsigned,
    windowId: IDS.design,
    role: "design",
    rootRef: { kind: "support-surface", surfaceId: IDS.designSurface },
    configuredRoot: "Design",
    resolvedRoot: { status: "available", observationDigest: DIGEST_A },
    identity: {
      status: "valid",
      identityRef: `.wakeflow-local/runtime/hosts/codex/identity/window-bindings/${IDS.design}.json`,
      bindingId: "binding_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      identityBindingDigest: DIGEST_E,
    },
    dispatchEligibility: "ineligible",
    preflightStatus: "ready",
    blockingReasons: [],
    sourceFingerprints: {
      ...unsigned.sourceFingerprints,
      identityBindingDigest: DIGEST_E,
    },
  });
  assert.equal(design.dispatchEligibility, "ineligible");
  assert.equal(design.preflightStatus, "ready");

  const validIdentityWithUnobservedRoot = {
    ...design,
    resolvedRoot: { status: "unobserved", observationDigest: DIGEST_A },
  };
  assert.equal(validateSchema(validIdentityWithUnobservedRoot), false);
  assert.throws(
    () => createWindowRuntimeProjection({
      ...unsigned,
      windowId: IDS.design,
      role: "design",
      rootRef: { kind: "support-surface", surfaceId: IDS.designSurface },
      configuredRoot: "Design",
      resolvedRoot: { status: "unobserved", observationDigest: DIGEST_A },
      identity: {
        status: "valid",
        identityRef: `.wakeflow-local/runtime/hosts/codex/identity/window-bindings/${IDS.design}.json`,
        bindingId: "binding_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        identityBindingDigest: DIGEST_E,
      },
      dispatchEligibility: "ineligible",
      preflightStatus: "blocked",
      blockingReasons: [],
      sourceFingerprints: {
        ...unsigned.sourceFingerprints,
        identityBindingDigest: DIGEST_E,
      },
    }),
    /identity|root|observation|projection|runtime/iu,
  );

  for (const configuredRoot of [
    " ProductA",
    "ProductA ",
    "C:ProductA",
    "C:/ProductA",
    "/private/tmp/ProductA",
  ]) {
    const candidate = { ...design, configuredRoot };
    assert.equal(validateSchema(candidate), false, configuredRoot);
    assert.throws(
      () => validateWindowRuntimeProjection(candidate),
      /root|projection|runtime/iu,
    );
  }
  assert.throws(
    () => validateWindowRuntimeProjection({
      ...record,
      programId: "program_99999999-9999-4999-8999-999999999999",
    }),
    /program|root|projection|runtime/iu,
  );
  assert.throws(
    () => validateWindowRuntimeProjection({
      ...design,
      identity: {
        ...design.identity,
        identityRef: `.wakeflow-local/runtime/hosts/codex/identity/window-bindings/${IDS.controller}.json`,
      },
    }),
    /identity|projection|runtime/iu,
  );
  assert.throws(
    () => validateWindowRuntimeProjection({
      ...record,
      sourceFingerprints: {
        ...record.sourceFingerprints,
        rootObservationDigest: DIGEST_B,
      },
    }),
    /fingerprint|root|digest|projection|runtime/iu,
  );
  assert.throws(
    () => validateWindowRuntimeProjection({ ...record, projectionDigest: DIGEST_B }),
    /digest|projection|runtime/iu,
  );
  assert.throws(
    () => windowRuntimeProjectionRef({
      hostDirName: "arbitrary-host",
      windowId: IDS.controller,
    }),
    /host|ref|runtime|projection/iu,
  );
  try {
    validateWindowRuntimeProjection({
      ...record,
      programId: "/private/tmp/WakeWorkspace",
    });
    assert.fail("private invalid identifiers must be rejected");
  } catch (error) {
    assertNoPrivateRuntimeData(publicError(error), "/private/tmp/WakeWorkspace", []);
  }
});

test("T04 rebuild writes every durable baseline window once and is byte deterministic", async (t) => {
  const workspaceRoot = prepareWorkspace(t);
  const first = await rebuildWindowRuntimeProjections({ workspaceRoot });
  assert.equal(first.operation, "rebuild");
  assert.equal(first.writeStatus, "rebuilt");
  assert.equal(first.projectionStatus, "current");
  assert.deepEqual(first.written, [IDS.controller, IDS.design, IDS.product, IDS.test].sort());
  assertNoPrivateRuntimeData(first, workspaceRoot);

  const bytes = new Map();
  for (const [windowId, role, eligibility] of [
    [IDS.controller, "controller", "eligible"],
    [IDS.design, "design", "ineligible"],
    [IDS.test, "test", "eligible"],
    [IDS.product, "product", "eligible"],
  ]) {
    const file = projectionFile(workspaceRoot, windowId);
    const record = readProjection(workspaceRoot, windowId);
    bytes.set(windowId, readFileSync(file));
    assert.equal(record.windowId, windowId);
    assert.equal(record.role, role);
    assert.equal(record.dispatchEligibility, eligibility);
    assert.equal(record.identity.status, "unregistered");
    assert.equal(record.resolvedRoot.status, "unobserved");
    assert.equal(record.preflightStatus, "blocked");
    assert.equal(record.hostAvailability.status, "unobserved");
    assert.match(record.projectionDigest, /^sha256:[0-9a-f]{64}$/u);
    assertNoPrivateRuntimeData(record, workspaceRoot);
  }

  const replay = await rebuildWindowRuntimeProjections({ workspaceRoot });
  assert.equal(replay.writeStatus, "current");
  assert.deepEqual(replay.written, []);
  for (const [windowId, before] of bytes) {
    assert.deepEqual(readFileSync(projectionFile(workspaceRoot, windowId)), before);
  }

  for (const windowId of bytes.keys()) unlinkSync(projectionFile(workspaceRoot, windowId));
  const rebuilt = await rebuildWindowRuntimeProjections({ workspaceRoot });
  assert.equal(rebuilt.writeStatus, "rebuilt");
  for (const [windowId, before] of bytes) {
    assert.deepEqual(readFileSync(projectionFile(workspaceRoot, windowId)), before);
  }
});

test("T04 root observation begins only after durable identity registration", async (t) => {
  const workspaceRoot = prepareWorkspace(t, { missingProduct: true });
  await rebuildWindowRuntimeProjections({ workspaceRoot });
  const unregistered = readProjection(workspaceRoot, IDS.product);
  assert.equal(unregistered.resolvedRoot.status, "unobserved");
  assert.equal(unregistered.preflightStatus, "blocked");
  assert.deepEqual(unregistered.blockingReasons, [
    { code: "identity-unregistered", source: "identity" },
  ]);
  const unregisteredBytes = readFileSync(projectionFile(workspaceRoot, IDS.product));
  const productRoot = path.resolve(
    workspaceRoot,
    configFixture().topology.repositories[0].path,
  );
  mkdirSync(productRoot, { recursive: true, mode: 0o700 });
  chmodSync(productRoot, 0o700);
  assert.equal(inspectWindowRuntimeProjections({ workspaceRoot }).projectionStatus, "current");
  const unregisteredReplay = await rebuildWindowRuntimeProjections({ workspaceRoot });
  assert.equal(unregisteredReplay.writeStatus, "current");
  assert.deepEqual(
    readFileSync(projectionFile(workspaceRoot, IDS.product)),
    unregisteredBytes,
  );
  rmSync(productRoot, { recursive: true });

  await registerWindowBinding({
    workspaceRoot,
    windowId: IDS.product,
    handle: { kind: "codex-thread", value: HANDLE_A },
  });
  await rebuildWindowRuntimeProjections({ workspaceRoot });
  const registered = readProjection(workspaceRoot, IDS.product);
  assert.equal(registered.identity.status, "valid");
  assert.equal(registered.resolvedRoot.status, "missing");
  assert.equal(registered.preflightStatus, "blocked");
  assert.deepEqual(registered.blockingReasons, [
    { code: "root-unavailable", source: "root" },
  ]);
  assert.equal(registered.hostAvailability.status, "unobserved");
  assertNoPrivateRuntimeData({ unregistered, registered }, workspaceRoot);
});

test("T04 replacing a configured root inode makes only derived projection bytes stale", async (t) => {
  const workspaceRoot = prepareWorkspace(t);
  await registerWindowBinding({
    workspaceRoot,
    windowId: IDS.product,
    handle: { kind: "codex-thread", value: HANDLE_A },
  });
  await rebuildWindowRuntimeProjections({ workspaceRoot });
  const before = readProjection(workspaceRoot, IDS.product);
  const productRoot = path.resolve(workspaceRoot, "../ProductA");
  const oldRoot = path.resolve(workspaceRoot, "../ProductA-old");
  fs.renameSync(productRoot, oldRoot);
  mkdirSync(productRoot, { mode: 0o700 });
  chmodSync(productRoot, 0o700);

  const stale = inspectWindowRuntimeProjections({ workspaceRoot });
  assert.equal(stale.projectionStatus, "stale");
  assert.equal(stale.windows.find((window) => window.windowId === IDS.product).status, "stale");
  const rebuilt = await rebuildWindowRuntimeProjections({ workspaceRoot });
  assert.equal(rebuilt.projectionStatus, "current");
  const after = readProjection(workspaceRoot, IDS.product);
  assert.notEqual(after.resolvedRoot.observationDigest, before.resolvedRoot.observationDigest);
  assertNoPrivateRuntimeData({ stale, rebuilt, before, after }, workspaceRoot);
});

test("T04 binding create and replacement stale only derived bytes and never expose handles", async (t) => {
  const workspaceRoot = prepareWorkspace(t);
  await rebuildWindowRuntimeProjections({ workspaceRoot });
  const before = readFileSync(projectionFile(workspaceRoot, IDS.controller));

  const created = await registerWindowBinding({
    workspaceRoot,
    windowId: IDS.controller,
    handle: { kind: "codex-thread", value: HANDLE_A },
  });
  const stale = inspectWindowRuntimeProjections({ workspaceRoot });
  assert.equal(stale.projectionStatus, "stale");
  assert.equal(stale.windows.find((entry) => entry.windowId === IDS.controller).status, "stale");
  assertNoPrivateRuntimeData(stale, workspaceRoot);

  const refreshed = await rebuildWindowRuntimeProjections({ workspaceRoot });
  assert.equal(refreshed.writeStatus, "rebuilt");
  const valid = readProjection(workspaceRoot, IDS.controller);
  assert.equal(valid.identity.status, "valid");
  assert.equal(valid.identity.bindingId, created.bindingId);
  assert.equal(valid.identity.identityBindingDigest, created.identityBindingDigest);
  assert.notDeepEqual(readFileSync(projectionFile(workspaceRoot, IDS.controller)), before);
  assertNoPrivateRuntimeData({ refreshed, valid }, workspaceRoot);

  const replaced = await replaceWindowBinding({
    workspaceRoot,
    windowId: IDS.controller,
    expectedBindingId: created.bindingId,
    expectedBindingDigest: created.identityBindingDigest,
    handle: { kind: "codex-thread", value: HANDLE_B },
  });
  assert.equal(inspectWindowRuntimeProjections({ workspaceRoot }).projectionStatus, "stale");
  await rebuildWindowRuntimeProjections({ workspaceRoot });
  const replacement = readProjection(workspaceRoot, IDS.controller);
  assert.equal(replacement.identity.bindingId, replaced.bindingId);
  assert.notEqual(replacement.identity.bindingId, created.bindingId);
  assertNoPrivateRuntimeData(replacement, workspaceRoot);
});

test("T04 corrupt identity and unsafe projection targets preserve existing projection bytes", async (t) => {
  await t.test("corrupt identity source is never projected as an invalid replacement", async (t) => {
    const workspaceRoot = prepareWorkspace(t);
    await rebuildWindowRuntimeProjections({ workspaceRoot });
    const projection = projectionFile(workspaceRoot, IDS.controller);
    const before = readFileSync(projection);
    const identityRoot = inspectWindowBindingInventory({ workspaceRoot }).identityRootRef
      .split("/")
      .reduce((current, segment) => path.join(current, segment), workspaceRoot);
    const bindingFile = path.join(identityRoot, `${IDS.controller}.json`);
    writeFileSync(bindingFile, "{}\n", { mode: 0o600 });
    chmodSync(bindingFile, 0o600);
    await assert.rejects(
      () => rebuildWindowRuntimeProjections({ workspaceRoot }),
      (error) => {
        assert.match(publicError(error), /identity|binding|source|runtime|projection/iu);
        assertNoPrivateRuntimeData(publicError(error), workspaceRoot);
        return true;
      },
    );
    assert.deepEqual(readFileSync(projection), before);
  });

  await t.test("symlink projection target is unsafe and causes zero sibling write", async (t) => {
    const workspaceRoot = prepareWorkspace(t);
    await rebuildWindowRuntimeProjections({ workspaceRoot });
    const outside = path.join(path.dirname(workspaceRoot), "outside.json");
    writeFileSync(outside, "outside\n", { mode: 0o600 });
    const target = projectionFile(workspaceRoot, IDS.controller);
    unlinkSync(target);
    symlinkSync(outside, target);
    const sibling = projectionFile(workspaceRoot, IDS.design);
    const beforeSibling = readFileSync(sibling);
    const inspected = inspectWindowRuntimeProjections({ workspaceRoot });
    assert.equal(inspected.projectionStatus, "unsafe");
    const rebuilt = await rebuildWindowRuntimeProjections({ workspaceRoot });
    assert.equal(rebuilt.writeStatus, "preserved");
    assert.equal(readFileSync(outside, "utf8"), "outside\n");
    assert.deepEqual(readFileSync(sibling), beforeSibling);
    assertNoPrivateRuntimeData({ inspected, rebuilt }, workspaceRoot);
  });

  const unsafeScenarios = [
    {
      label: "corrupt projection record",
      mutate(workspaceRoot, target) {
        writeFileSync(target, "{}\n", { mode: 0o600 });
        chmodSync(target, 0o600);
      },
    },
    {
      label: "noncanonical projection bytes",
      mutate(workspaceRoot, target) {
        writeFileSync(target, `${JSON.stringify(readProjection(workspaceRoot, IDS.controller), null, 2)}\n`, {
          mode: 0o600,
        });
        chmodSync(target, 0o600);
      },
    },
    {
      label: "cross-window canonical projection",
      mutate(workspaceRoot, target) {
        writeFileSync(
          target,
          windowRuntimeProjectionCanonicalBytes(readProjection(workspaceRoot, IDS.design)),
          { mode: 0o600 },
        );
        chmodSync(target, 0o600);
      },
    },
    {
      label: "unknown projection sibling",
      mutate(workspaceRoot, target) {
        const sibling = path.join(path.dirname(target), "private-token.json");
        writeFileSync(sibling, "{}\n", { mode: 0o600 });
        chmodSync(sibling, 0o600);
      },
    },
    {
      label: "hard-linked projection target",
      mutate(workspaceRoot, target) {
        const outside = path.join(path.dirname(workspaceRoot), "linked-projection.json");
        writeFileSync(outside, readFileSync(target), { mode: 0o600 });
        chmodSync(outside, 0o600);
        unlinkSync(target);
        fs.linkSync(outside, target);
      },
    },
    {
      label: "wrong-mode projection target",
      mutate(workspaceRoot, target) {
        chmodSync(target, 0o644);
      },
    },
  ];
  for (const scenario of unsafeScenarios) {
    await t.test(scenario.label, async (subtest) => {
      const workspaceRoot = prepareWorkspace(subtest);
      await rebuildWindowRuntimeProjections({ workspaceRoot });
      const target = projectionFile(workspaceRoot, IDS.controller);
      const sibling = projectionFile(workspaceRoot, IDS.design);
      const siblingBefore = readFileSync(sibling);
      scenario.mutate(workspaceRoot, target);
      const targetBefore = readFileSync(target);

      const inspected = inspectWindowRuntimeProjections({ workspaceRoot });
      assert.equal(inspected.projectionStatus, "unsafe");
      const rebuilt = await rebuildWindowRuntimeProjections({ workspaceRoot });
      assert.equal(rebuilt.writeStatus, "preserved");
      assert.deepEqual(readFileSync(target), targetBefore);
      assert.deepEqual(readFileSync(sibling), siblingBefore);
      assertNoPrivateRuntimeData({ inspected, rebuilt }, workspaceRoot);
      assert.equal(JSON.stringify({ inspected, rebuilt }).includes("private-token.json"), false);
    });
  }
});

test("T04 windows sharing one typed repository receive one root observation", async (t) => {
  const fixture = configFixture(fullConfigFixtureFile);
  const workspaceRoot = prepareWorkspace(t, { config: fixture });

  const rebuilt = await rebuildWindowRuntimeProjections({ workspaceRoot });
  assert.equal(rebuilt.projectionStatus, "current");
  assert.deepEqual(
    rebuilt.windows.map((window) => window.windowId),
    fixture.topology.windows.map((window) => window.windowId).sort(),
  );
  const first = readProjection(workspaceRoot, IDS.product);
  const second = readProjection(workspaceRoot, IDS.productTwo);
  assert.deepEqual(first.rootRef, second.rootRef);
  assert.equal(first.configuredRoot, second.configuredRoot);
  assert.equal(first.resolvedRoot.observationDigest, second.resolvedRoot.observationDigest);
  assert.equal(
    first.sourceFingerprints.rootObservationDigest,
    second.sourceFingerprints.rootObservationDigest,
  );
  assertNoPrivateRuntimeData({ rebuilt, first, second }, workspaceRoot);
});

test("T04 synchronized artifacts project exact minimal and full baselines for both hosts", async (t) => {
  const hosts = [
    { label: "codex", artifact: "plugins/codex-wakeflow" },
    { label: "claude-code", artifact: "plugins/claude-code-wakeflow" },
  ];
  const fixtures = [
    { label: "minimal", file: configFixtureFile },
    { label: "full", file: fullConfigFixtureFile },
  ];

  for (const host of hosts) {
    for (const fixtureCase of fixtures) {
      await t.test(`${host.label}/${fixtureCase.label}`, async (subtest) => {
        const artifactRoot = path.join(repositoryRoot, host.artifact);
        const [{ hostProfile }, projector, records] = await Promise.all([
          import(pathToFileURL(path.join(
            artifactRoot,
            "scripts/lib/wakeflow-host-profile.mjs",
          )).href),
          import(pathToFileURL(path.join(
            artifactRoot,
            "scripts/lib/wakeflow-window-runtime-projector.mjs",
          )).href),
          import(pathToFileURL(path.join(
            artifactRoot,
            "scripts/lib/wakeflow-window-runtime-records.mjs",
          )).href),
        ]);
        const fixture = configFixture(fixtureCase.file);
        const workspaceRoot = prepareWorkspace(subtest, {
          config: fixture,
          profile: hostProfile,
        });
        const expectedWindowIds = fixture.topology.windows
          .map((window) => window.windowId)
          .sort();
        const expectedNames = expectedWindowIds.map((windowId) => `${windowId}.json`);
        const projectionRoot = path.join(
          workspaceRoot,
          ".wakeflow-local/runtime/hosts",
          hostProfile.runtime.hostDirName,
          "projections/window-runtime",
        );
        const identityRoot = path.join(
          workspaceRoot,
          ".wakeflow-local/runtime/hosts",
          hostProfile.runtime.hostDirName,
          "identity/window-bindings",
        );

        const first = await projector.rebuildWindowRuntimeProjections({ workspaceRoot });
        assert.equal(first.hostId, hostProfile.hostId);
        assert.equal(first.projectionStatus, "current");
        assert.equal(first.writeStatus, "rebuilt");
        assert.deepEqual(first.written, expectedWindowIds);
        assert.deepEqual(fs.readdirSync(projectionRoot).sort(), expectedNames);
        assert.deepEqual(fs.readdirSync(identityRoot), []);
        assert.equal(fs.statSync(projectionRoot).mode & 0o777, 0o700);
        assert.equal(fs.statSync(identityRoot).mode & 0o777, 0o700);

        const firstBytes = new Map();
        const projected = new Map();
        for (const windowId of expectedWindowIds) {
          const ref = records.windowRuntimeProjectionRef({
            hostDirName: hostProfile.runtime.hostDirName,
            windowId,
          });
          const expectedRef = `.wakeflow-local/runtime/hosts/${hostProfile.runtime.hostDirName}`
            + `/projections/window-runtime/${windowId}.json`;
          assert.equal(ref, expectedRef);
          const file = path.resolve(workspaceRoot, ...ref.split("/"));
          const bytes = readFileSync(file);
          const record = records.validateWindowRuntimeProjection(JSON.parse(bytes));
          assert.equal(record.hostId, hostProfile.hostId);
          assert.equal(record.windowId, windowId);
          assert.deepEqual(record.identity, { status: "unregistered" });
          assert.equal(record.resolvedRoot.status, "unobserved");
          assert.deepEqual(bytes, records.windowRuntimeProjectionCanonicalBytes(record));
          assert.equal(fs.statSync(file).mode & 0o777, 0o600);
          firstBytes.set(windowId, bytes);
          projected.set(windowId, record);
        }
        assert.doesNotMatch(
          JSON.stringify([...projected.values()]),
          /podId|hostOperation|creationReceipt|dynamicWindow|handle/iu,
        );

        if (fixtureCase.label === "full") {
          const firstProduct = projected.get(IDS.product);
          const secondProduct = projected.get(IDS.productTwo);
          assert.deepEqual(firstProduct.rootRef, secondProduct.rootRef);
          assert.equal(
            firstProduct.resolvedRoot.observationDigest,
            secondProduct.resolvedRoot.observationDigest,
          );
        }

        for (const name of expectedNames) unlinkSync(path.join(projectionRoot, name));
        const second = await projector.rebuildWindowRuntimeProjections({ workspaceRoot });
        assert.equal(second.projectionStatus, "current");
        assert.equal(second.writeStatus, "rebuilt");
        assert.deepEqual(second.written, expectedWindowIds);
        assert.deepEqual(fs.readdirSync(projectionRoot).sort(), expectedNames);
        for (const windowId of expectedWindowIds) {
          assert.deepEqual(
            readFileSync(path.join(projectionRoot, `${windowId}.json`)),
            firstBytes.get(windowId),
          );
        }
        assert.deepEqual(fs.readdirSync(identityRoot), []);
        assertNoPrivateRuntimeData({ first, second }, workspaceRoot);
      });
    }
  }
});

test("T04 rebuild participates in the T02 runtime gate and rejects nested mutation", async (t) => {
  const workspaceRoot = prepareWorkspace(t);
  await withWakeflowRuntimeMutation({
    workspaceRoot,
    operationKind: "window-runtime-test-holder",
    domainOwner: "runtime-projection-builder",
  }, async () => {
    await assert.rejects(
      () => rebuildWindowRuntimeProjections({ workspaceRoot, acquireTimeoutMs: 10 }),
      /nested|reentrant|mutation|busy|runtime|projection/iu,
    );
  });
  assert.equal(inspectWindowRuntimeProjections({ workspaceRoot }).projectionStatus, "missing");
});

test("T04 commit faults release only exact safe stale outcomes", async (t) => {
  await t.test("a cleaned second-stage failure returns partial safe stale and releases the gate", async (t) => {
    const workspaceRoot = prepareWorkspace(t);
    const originalOpen = fs.openSync;
    let stageCount = 0;
    t.mock.method(fs, "openSync", (file, flags, mode) => {
      if (String(file).includes(".wakeflow-stage-")) {
        stageCount += 1;
        if (stageCount === 2) {
          const error = new Error("injected second projection stage failure");
          error.code = "EIO";
          throw error;
        }
      }
      return originalOpen(file, flags, mode);
    });

    const result = await rebuildWindowRuntimeProjections({ workspaceRoot });
    assert.equal(stageCount, 2);
    assert.equal(result.projectionStatus, "stale");
    assert.equal(result.writeStatus, "stale");
    assert.deepEqual(result.written, [IDS.controller]);
    assert.equal(existsSync(projectionFile(workspaceRoot, IDS.controller)), true);
    assert.equal(existsSync(projectionFile(workspaceRoot, IDS.design)), false);
    assert.deepEqual(projectionResidue(workspaceRoot), []);
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");

    t.mock.restoreAll();
    const retried = await rebuildWindowRuntimeProjections({ workspaceRoot });
    assert.equal(retried.projectionStatus, "current");
    assert.equal(retried.writeStatus, "rebuilt");
  });

  await t.test("same-byte source inode replacement cannot cross stale projection CAS", async (t) => {
    const workspaceRoot = await prepareStaleController(t);
    const target = projectionFile(workspaceRoot, IDS.controller);
    const before = readFileSync(target);
    const beforeInode = fs.lstatSync(target, { bigint: true }).ino;
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

    const result = await rebuildWindowRuntimeProjections({ workspaceRoot });
    assert.equal(injected, true);
    assert.equal(result.projectionStatus, "stale");
    assert.equal(result.writeStatus, "stale");
    assert.deepEqual(result.written, []);
    assert.deepEqual(readFileSync(target), before);
    assert.notEqual(fs.lstatSync(target, { bigint: true }).ino, beforeInode);
    assert.deepEqual(projectionResidue(workspaceRoot), []);
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");
  });

  await t.test("predecessor capture failure preserves exact old bytes and releases the gate", async (t) => {
    const workspaceRoot = await prepareStaleController(t);
    const target = projectionFile(workspaceRoot, IDS.controller);
    const before = readFileSync(target);
    const beforeInode = fs.lstatSync(target, { bigint: true }).ino;
    const originalRename = fs.renameSync;
    let injected = false;
    t.mock.method(fs, "renameSync", (source, destination) => {
      if (
        !injected
        && source === target
        && String(destination).includes(".wakeflow-predecessor-")
      ) {
        injected = true;
        const error = new Error("injected projection predecessor capture failure");
        error.code = "EIO";
        throw error;
      }
      return originalRename(source, destination);
    });

    const result = await rebuildWindowRuntimeProjections({ workspaceRoot });
    assert.equal(injected, true);
    assert.equal(result.projectionStatus, "stale");
    assert.deepEqual(result.written, []);
    assert.deepEqual(readFileSync(target), before);
    assert.equal(fs.lstatSync(target, { bigint: true }).ino, beforeInode);
    assert.deepEqual(projectionResidue(workspaceRoot), []);
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");
  });
});

test("T04 durability and inode ambiguity retain T02 recovery evidence", async (t) => {
  await t.test("one-shot target fsync failure closes on the same commit identity", async (t) => {
    const workspaceRoot = await prepareStaleController(t);
    const target = projectionFile(workspaceRoot, IDS.controller);
    const originalFsync = fs.fsyncSync;
    let injected = false;
    t.mock.method(fs, "fsyncSync", (descriptor) => {
      const opened = fs.fstatSync(descriptor, { bigint: true });
      let current = null;
      try {
        current = fs.lstatSync(target, { bigint: true });
      } catch {
        // The projection target is not committed yet.
      }
      if (
        !injected
        && current?.isFile()
        && opened.dev === current.dev
        && opened.ino === current.ino
      ) {
        injected = true;
        const error = new Error("injected one-shot projection fsync failure");
        error.code = "EIO";
        throw error;
      }
      return originalFsync(descriptor);
    });

    const result = await rebuildWindowRuntimeProjections({ workspaceRoot });
    assert.equal(injected, true);
    assert.equal(result.projectionStatus, "current");
    assert.equal(result.writeStatus, "rebuilt");
    assert.deepEqual(
      result.written,
      [IDS.controller, IDS.design, IDS.product, IDS.test].sort(),
    );
    assert.equal(readProjection(workspaceRoot, IDS.controller).identity.status, "valid");
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");
  });

  await t.test("persistent target fsync failure keeps the committed projection plus recovery gate", async (t) => {
    const workspaceRoot = await prepareStaleController(t);
    const target = projectionFile(workspaceRoot, IDS.controller);
    const originalFsync = fs.fsyncSync;
    let injected = 0;
    t.mock.method(fs, "fsyncSync", (descriptor) => {
      const opened = fs.fstatSync(descriptor, { bigint: true });
      let current = null;
      try {
        current = fs.lstatSync(target, { bigint: true });
      } catch {
        // The projection target is not committed yet.
      }
      if (current?.isFile() && opened.dev === current.dev && opened.ino === current.ino) {
        injected += 1;
        const error = new Error("injected persistent projection fsync failure");
        error.code = "EIO";
        throw error;
      }
      return originalFsync(descriptor);
    });

    await assert.rejects(
      () => rebuildWindowRuntimeProjections({ workspaceRoot }),
      (error) => {
        assert.match(publicError(error), /durability|recovery|projection|runtime/iu);
        assertNoPrivateRuntimeData(publicError(error), workspaceRoot);
        return true;
      },
    );
    assert.ok(injected >= 2);
    assert.equal(readProjection(workspaceRoot, IDS.controller).identity.status, "valid");
    const mutation = inspectWakeflowWorkspaceMutation({ workspaceRoot });
    assert.equal(mutation.state, "busy");
    assert.equal(mutation.lock?.operationKind, "window-runtime-projection-rebuild");
  });

  await t.test("committed target inode replacement before fsync cannot be reported current", async (t) => {
    const workspaceRoot = await prepareStaleController(t);
    const target = projectionFile(workspaceRoot, IDS.controller);
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
        // The projection target is not committed yet.
      }
      if (
        !injected
        && current?.isFile()
        && opened.dev === current.dev
        && opened.ino === current.ino
      ) {
        committedInode = current.ino;
        const replacement = `${target}.post-commit-replacement`;
        writeFileSync(replacement, readFileSync(target), { mode: 0o600 });
        chmodSync(replacement, 0o600);
        originalRename(replacement, target);
        injected = true;
      }
      return originalFsync(descriptor);
    });

    await assert.rejects(
      () => rebuildWindowRuntimeProjections({ workspaceRoot }),
      /durability|recovery|projection|runtime/iu,
    );
    assert.equal(injected, true);
    assert.notEqual(fs.lstatSync(target, { bigint: true }).ino, committedInode);
    assert.equal(readProjection(workspaceRoot, IDS.controller).identity.status, "valid");
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "busy");
  });

  await t.test("persistent projection-parent fsync failure retains recovery evidence", async (t) => {
    const workspaceRoot = await prepareStaleController(t);
    const target = projectionFile(workspaceRoot, IDS.controller);
    const parent = path.dirname(target);
    const parentStat = fs.lstatSync(parent, { bigint: true });
    const originalFsync = fs.fsyncSync;
    let injected = 0;
    t.mock.method(fs, "fsyncSync", (descriptor) => {
      const opened = fs.fstatSync(descriptor, { bigint: true });
      if (opened.isDirectory() && opened.dev === parentStat.dev && opened.ino === parentStat.ino) {
        injected += 1;
        const error = new Error("injected persistent projection parent fsync failure");
        error.code = "EIO";
        throw error;
      }
      return originalFsync(descriptor);
    });

    await assert.rejects(
      () => rebuildWindowRuntimeProjections({ workspaceRoot }),
      /durability|recovery|projection|runtime/iu,
    );
    assert.ok(injected >= 2);
    assert.equal(readProjection(workspaceRoot, IDS.controller).identity.status, "valid");
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "busy");
  });
});

test("T04 source changes after a partial commit release a safe stale gate", async (t) => {
  await t.test("valid config change returns partial stale and retry converges", async (t) => {
    const workspaceRoot = prepareWorkspace(t);
    const target = projectionFile(workspaceRoot, IDS.controller);
    const configFile = path.join(workspaceRoot, "wakeflow.config.json");
    const changed = configFixture();
    changed.program.displayName = "Changed during projection commit";
    const originalFsync = fs.fsyncSync;
    let injected = false;
    t.mock.method(fs, "fsyncSync", (descriptor) => {
      const opened = fs.fstatSync(descriptor, { bigint: true });
      let current = null;
      try {
        current = fs.lstatSync(target, { bigint: true });
      } catch {
        // The first projection is not committed yet.
      }
      if (!injected && current?.isFile() && opened.dev === current.dev && opened.ino === current.ino) {
        const result = originalFsync(descriptor);
        writeFileSync(configFile, `${JSON.stringify(changed, null, 2)}\n`, { mode: 0o600 });
        chmodSync(configFile, 0o600);
        injected = true;
        return result;
      }
      return originalFsync(descriptor);
    });

    const result = await rebuildWindowRuntimeProjections({ workspaceRoot });
    assert.equal(injected, true);
    assert.equal(result.projectionStatus, "stale");
    assert.equal(result.writeStatus, "stale");
    assert.deepEqual(result.written, [IDS.controller]);
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");
    assert.deepEqual(projectionResidue(workspaceRoot), []);

    t.mock.restoreAll();
    const retried = await rebuildWindowRuntimeProjections({ workspaceRoot });
    assert.equal(retried.projectionStatus, "current");
  });

  await t.test("corrupt identity source after a commit releases gate but never reports current", async (t) => {
    const workspaceRoot = prepareWorkspace(t);
    const binding = await registerWindowBinding({
      workspaceRoot,
      windowId: IDS.controller,
      handle: { kind: "codex-thread", value: HANDLE_A },
    });
    const bindingFile = path.resolve(workspaceRoot, ...binding.identityRef.split("/"));
    const bindingBytes = readFileSync(bindingFile);
    const target = projectionFile(workspaceRoot, IDS.controller);
    const originalFsync = fs.fsyncSync;
    let injected = false;
    t.mock.method(fs, "fsyncSync", (descriptor) => {
      const opened = fs.fstatSync(descriptor, { bigint: true });
      let current = null;
      try {
        current = fs.lstatSync(target, { bigint: true });
      } catch {
        // The first projection is not committed yet.
      }
      if (!injected && current?.isFile() && opened.dev === current.dev && opened.ino === current.ino) {
        const result = originalFsync(descriptor);
        writeFileSync(bindingFile, "{}\n", { mode: 0o600 });
        chmodSync(bindingFile, 0o600);
        injected = true;
        return result;
      }
      return originalFsync(descriptor);
    });

    await assert.rejects(
      () => rebuildWindowRuntimeProjections({ workspaceRoot }),
      (error) => {
        assert.match(publicError(error), /source|identity|projection|runtime/iu);
        assertNoPrivateRuntimeData(publicError(error), workspaceRoot);
        return true;
      },
    );
    assert.equal(injected, true);
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");
    assert.deepEqual(projectionResidue(workspaceRoot), []);

    t.mock.restoreAll();
    writeFileSync(bindingFile, bindingBytes, { mode: 0o600 });
    chmodSync(bindingFile, 0o600);
    const retried = await rebuildWindowRuntimeProjections({ workspaceRoot });
    assert.equal(retried.projectionStatus, "current");
  });
});

test("T04 layout owner validation closes current projection files after the M7A cutover", async (t) => {
  const workspaceRoot = prepareWorkspace(t);
  await rebuildWindowRuntimeProjections({ workspaceRoot });
  const model = parseWakeflowConfigV3(configFixture());
  const layoutDescriptor = createWakeflowLayoutDescriptor({ model, hostProfile: codexProfile });
  const inspection = inspectWakeflowLocalLayout({
    workspaceRoot,
    model,
    layoutDescriptor,
    hostProfile: codexProfile,
  });
  assert.equal(
    inspection.items.initialProjections.every((entry) => entry.classification === "owner-validated"),
    true,
  );
  assert.equal(
    inspection.blockers.some((entry) => entry.owner === "runtime-projection-builder"),
    false,
  );

  const changedFixture = configFixture();
  changedFixture.program.displayName = "Projection fingerprint changed";
  const changedModel = parseWakeflowConfigV3(changedFixture);
  const changedLayout = createWakeflowLayoutDescriptor({
    model: changedModel,
    hostProfile: codexProfile,
  });
  const staleInspection = inspectWakeflowLocalLayout({
    workspaceRoot,
    model: changedModel,
    layoutDescriptor: changedLayout,
    hostProfile: codexProfile,
  });
  assert.equal(
    staleInspection.items.initialProjections.every(
      (entry) => entry.classification === "owner-validator-stale",
    ),
    true,
  );
  assert.equal(
    staleInspection.blockers.some(
      (entry) => entry.classification === "owner-validator-stale",
    ),
    true,
  );

  const corruptProjection = projectionFile(workspaceRoot, IDS.controller);
  writeFileSync(corruptProjection, "{}\n", { mode: 0o600 });
  chmodSync(corruptProjection, 0o600);
  const invalidInspection = inspectWakeflowLocalLayout({
    workspaceRoot,
    model: changedModel,
    layoutDescriptor: changedLayout,
    hostProfile: codexProfile,
  });
  assert.equal(
    invalidInspection.items.initialProjections.every(
      (entry) => entry.classification === "owner-validator-invalid",
    ),
    true,
  );
  assert.equal(invalidInspection.overall, "blocked");

  for (const relative of [
    "core/scripts/lib/wakeflow-window-runtime.mjs",
    "core/scripts/lib/wakeflow-mainline-health.mjs",
    "core/scripts/lib/wakeflow-dispatch-commands.mjs",
    "core/scripts/wakeflow-delivery.mjs",
  ]) {
    assert.equal(existsSync(path.join(repositoryRoot, relative)), false, relative);
  }
  for (const candidate of [recordsFile, projectorFile]) {
    const source = readFileSync(candidate, "utf8");
    assert.doesNotMatch(
      source,
      /wakeflow-(?:setup|thread-registry|delivery-store|dispatch-commands|mainline-health)\.mjs/u,
    );
  }
  assertNoPrivateRuntimeData(
    { inspection, staleInspection, invalidInspection },
    workspaceRoot,
  );
});

test("T04 configured-root ancestor symlinks fail closed across layout and normal inspection", async (t) => {
  const fixture = configFixture();
  fixture.topology.supportSurfaces.find(
    (surface) => surface.surfaceId === IDS.designSurface,
  ).path = "Surfaces/Design";
  const workspaceRoot = prepareWorkspace(t, { config: fixture });
  await registerWindowBinding({
    workspaceRoot,
    windowId: IDS.design,
    handle: { kind: "codex-thread", value: HANDLE_A },
  });
  await rebuildWindowRuntimeProjections({ workspaceRoot });
  const before = new Map(fixture.topology.windows.map((window) => [
    window.windowId,
    readFileSync(projectionFile(workspaceRoot, window.windowId)),
  ]));

  const configuredAncestor = path.join(workspaceRoot, "Surfaces");
  const movedAncestor = path.join(path.dirname(workspaceRoot), "moved-design-surfaces");
  fs.renameSync(configuredAncestor, movedAncestor);
  symlinkSync(movedAncestor, configuredAncestor);

  const model = parseWakeflowConfigV3(fixture);
  const layoutDescriptor = createWakeflowLayoutDescriptor({
    model,
    hostProfile: codexProfile,
  });
  const layoutInspection = inspectWakeflowLocalLayout({
    workspaceRoot,
    model,
    layoutDescriptor,
    hostProfile: codexProfile,
  });
  assert.equal(
    layoutInspection.items.initialProjections.every(
      (entry) => entry.classification === "owner-validator-invalid",
    ),
    true,
  );
  assert.equal(layoutInspection.overall, "blocked");
  assertNoPrivateRuntimeData(layoutInspection, workspaceRoot);
  assert.equal(JSON.stringify(layoutInspection).includes(movedAncestor), false);

  assert.throws(
    () => inspectWindowRuntimeProjections({ workspaceRoot }),
    (error) => {
      assert.match(publicError(error), /root|placement|source|runtime|projection/iu);
      assertNoPrivateRuntimeData(publicError(error), workspaceRoot);
      assert.equal(publicError(error).includes(movedAncestor), false);
      return true;
    },
  );
  await assert.rejects(
    () => rebuildWindowRuntimeProjections({ workspaceRoot }),
    (error) => {
      assert.match(publicError(error), /root|placement|source|runtime|projection/iu);
      assertNoPrivateRuntimeData(publicError(error), workspaceRoot);
      assert.equal(publicError(error).includes(movedAncestor), false);
      return true;
    },
  );
  for (const [windowId, bytes] of before) {
    assert.deepEqual(readFileSync(projectionFile(workspaceRoot, windowId)), bytes);
  }
  assert.deepEqual(projectionResidue(workspaceRoot), []);
  assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");
});

test("T04 source fingerprints are strict digests and cannot be caller-forged", () => {
  const record = recordFixture({
    resolvedRoot: { status: "available", observationDigest: DIGEST_A },
    identity: {
      status: "valid",
      identityRef: `.wakeflow-local/runtime/hosts/codex/identity/window-bindings/${IDS.controller}.json`,
      bindingId: "binding_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      identityBindingDigest: DIGEST_E,
    },
    preflightStatus: "ready",
    blockingReasons: [],
    sourceFingerprints: {
      configDigest: DIGEST_A,
      topologyDigest: DIGEST_B,
      windowDigest: DIGEST_C,
      rootObservationDigest: DIGEST_A,
      identityInventoryDigest: DIGEST_D,
      identityBindingDigest: DIGEST_E,
    },
  });
  assert.equal(validateWindowRuntimeProjection(record), record);
  assert.throws(
    () => validateWindowRuntimeProjection({
      ...record,
      sourceFingerprints: {
        ...record.sourceFingerprints,
        identityBindingDigest: DIGEST_A,
      },
    }),
    /digest|identity|projection|runtime/iu,
  );
  assert.throws(
    () => inspectWindowRuntimeProjections({
      workspaceRoot: "/tmp/not-authority",
      model: configFixture(),
    }),
    /input|workspace|runtime|projection/iu,
  );
});
