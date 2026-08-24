import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { hostProfile as claudeProfile } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import { hostProfile as codexProfile } from "../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import { parseWakeflowConfigV3 } from "../core/scripts/lib/wakeflow-config-v3.mjs";
import { HOST_CAPABILITY_NAMES } from "../core/scripts/lib/wakeflow-host-capability.mjs";
import { createWakeflowLayoutDescriptor } from "../core/scripts/lib/wakeflow-layout-descriptor.mjs";

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const fixtureRoot = path.join(repositoryRoot, "test/fixtures/wakeflow-config-v3");

const COMMON_STATIC_DIRECTORIES = Object.freeze([
  ".wakeflow-local",
  ".wakeflow-local/audit",
  ".wakeflow-local/runtime",
  ".wakeflow-local/audit/preserved",
  ".wakeflow-local/runtime/hosts",
  ".wakeflow-local/runtime/maintenance",
  ".wakeflow-local/runtime/shared",
  ".wakeflow-local/runtime/maintenance/transactions",
  ".wakeflow-local/runtime/shared/coordination",
  ".wakeflow-local/runtime/shared/transport",
  ".wakeflow-local/runtime/shared/coordination/window-leases",
  ".wakeflow-local/runtime/shared/transport/demands",
]);

function fixture(name = "valid-minimal.json") {
  return JSON.parse(readFileSync(path.join(fixtureRoot, name), "utf8"));
}

function model(name = "valid-minimal.json") {
  return parseWakeflowConfigV3(fixture(name));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function minimalHostProfile(hostProfile) {
  return {
    hostId: hostProfile.hostId,
    memoryFile: hostProfile.memoryFile,
    runtime: { hostDirName: hostProfile.runtime.hostDirName },
    capabilities: clone(hostProfile.capabilities),
  };
}

function paths(entries) {
  return entries.map((entry) => entry.path);
}

function expectedStaticDirectories(hostId, claude = false) {
  const hostRoot = `.wakeflow-local/runtime/hosts/${hostId}`;
  return [
    ...COMMON_STATIC_DIRECTORIES,
    hostRoot,
    `${hostRoot}/evidence`,
    `${hostRoot}/identity`,
    `${hostRoot}/operations`,
    `${hostRoot}/projections`,
    `${hostRoot}/evidence/pods`,
    `${hostRoot}/identity/window-bindings`,
    `${hostRoot}/operations/keep-live`,
    `${hostRoot}/projections/window-runtime`,
    `${hostRoot}/operations/keep-live/leases`,
    ...(claude ? [
      `${hostRoot}/operations/activity-monitor`,
      `${hostRoot}/operations/assets`,
      `${hostRoot}/operations/temp`,
      `${hostRoot}/operations/window-locators`,
      `${hostRoot}/operations/temp/prompts`,
    ] : []),
  ].sort((left, right) => {
    const depth = left.split("/").length - right.split("/").length;
    return depth || (left < right ? -1 : left > right ? 1 : 0);
  });
}

function assertDeepFrozen(value, at = "$") {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true, `${at} must be frozen`);
  for (const [key, child] of Object.entries(value)) assertDeepFrozen(child, `${at}/${key}`);
}

function assertPlanDigest(plan) {
  const { planDigest, ...unsigned } = plan;
  assert.equal(planDigest, canonicalJsonDigest(unsigned));
}

function descriptorMetadata(entry) {
  return {
    key: entry.key,
    path: entry.path,
    pathKind: entry.pathKind,
    scope: entry.scope,
    owner: entry.owner,
    authority: entry.authority,
    lifecycle: entry.lifecycle,
    tracking: entry.tracking,
    mode: entry.mode,
    createTiming: entry.createTiming,
    condition: entry.condition,
    capability: entry.capability,
    allowDescendants: entry.allowDescendants,
  };
}

function plannedMetadata(entry) {
  return descriptorMetadata(entry);
}

function productionModules(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && /\.(?:mjs|cjs)$/u.test(entry.name)) files.push(absolute);
    }
  };
  visit(root);
  return files.sort();
}

async function planner() {
  return import("../core/scripts/lib/wakeflow-local-layout.mjs");
}

function buildInput(hostProfile, fixtureName = "valid-minimal.json") {
  const normalizedModel = model(fixtureName);
  return {
    model: normalizedModel,
    layoutDescriptor: createWakeflowLayoutDescriptor({ model: normalizedModel, hostProfile }),
    hostProfile,
  };
}

test("T01a partitions each current-host descriptor into one exact pure local plan", async () => {
  const { planWakeflowLocalLayout } = await planner();
  for (const [hostProfile, expected] of [
    [codexProfile, { staticCount: 22, managedCount: 0, projectionCount: 4, eventCount: 34, claude: false }],
    [claudeProfile, { staticCount: 27, managedCount: 1, projectionCount: 4, eventCount: 39, claude: true }],
  ]) {
    const input = buildInput(hostProfile);
    const plan = planWakeflowLocalLayout(input);
    assert.equal(plan.kind, "WakeflowLocalLayoutPlan");
    assert.equal(plan.schemaVersion, 1);
    assert.equal(plan.protocolRoot, ".wakeflow-local");
    assert.equal(plan.programId, input.model.program.programId);
    assert.equal(plan.configDigest, input.layoutDescriptor.configDigest);
    assert.equal(plan.layoutDigest, input.layoutDescriptor.layoutDigest);
    assert.match(plan.planDigest, /^sha256:[0-9a-f]{64}$/u);
    assertPlanDigest(plan);
    assert.deepEqual(
      { hostId: plan.host.hostId, hostDirName: plan.host.hostDirName },
      { hostId: hostProfile.hostId, hostDirName: hostProfile.runtime.hostDirName },
    );
    assert.deepEqual(plan.host.capabilities, HOST_CAPABILITY_NAMES.map((name) => ({
      name,
      applicable: hostProfile.capabilities[name].applicable,
      realization: hostProfile.capabilities[name].realization,
    })));
    assert.deepEqual(
      paths(plan.staticDirectories),
      expectedStaticDirectories(hostProfile.runtime.hostDirName, expected.claude),
    );
    assert.deepEqual(
      {
        staticCount: plan.staticDirectories.length,
        managedCount: plan.managedFiles.length,
        projectionCount: plan.initialProjections.length,
        eventCount: plan.deferredEventPatterns.length,
      },
      {
        staticCount: expected.staticCount,
        managedCount: expected.managedCount,
        projectionCount: expected.projectionCount,
        eventCount: expected.eventCount,
      },
    );
    assert.ok(plan.staticDirectories.every((entry) =>
      entry.pathKind === "directory"
      && entry.mode === "0700"
      && entry.status === "required"));
    assert.ok([...plan.managedFiles, ...plan.initialProjections].every((entry) =>
      entry.pathKind === "file"
      && entry.mode === "0600"
      && entry.status === "delegated"));
    assert.ok(plan.deferredEventPatterns.every((entry) =>
      entry.createTiming === "event-only"
      && entry.status === "deferred"));
    assert.deepEqual(
      plan.deferredEventPatterns
        .filter((entry) => entry.key.startsWith("event.maintenance."))
      .map((entry) => [entry.key, entry.lifecycle]),
      [
        ["event.maintenance.lock-publisher-stage", "transaction-staging-residue"],
        ["event.maintenance.lock", "event-fact"],
        ["event.maintenance.publisher-stage", "transaction-staging-residue"],
        ["event.maintenance.transaction-stage", "transaction-staging-residue"],
        ["event.maintenance.transaction", "event-fact"],
        ["event.maintenance.recovery-claim", "event-fact"],
      ],
    );
  }
});

test("T01a delegates deterministic files to their real owners without creating placeholder content", async () => {
  const { planWakeflowLocalLayout } = await planner();
  const codexInput = buildInput(codexProfile);
  const claudeInput = buildInput(claudeProfile);
  const codex = planWakeflowLocalLayout(codexInput);
  const claude = planWakeflowLocalLayout(claudeInput);
  assert.deepEqual(codex.managedFiles, []);
  assert.deepEqual(paths(claude.managedFiles), [
    ".wakeflow-local/runtime/hosts/claude-code/operations/assets/statusline.mjs",
  ]);
  assert.equal(claude.managedFiles[0].owner, "host-settings-assets-owner");
  assert.equal(claude.managedFiles[0].trigger, "managed-owner-reconcile");
  for (const plan of [codex, claude]) {
    const input = plan.host.hostId === codexProfile.hostId ? codexInput : claudeInput;
    const projections = plan.initialProjections;
    assert.equal(projections.every((entry) => entry.owner === "runtime-projection-builder"), true);
    assert.equal(projections.every((entry) => entry.trigger === "projection-builder-initialize"), true);
    assert.deepEqual(
      projections.map((entry) => path.posix.basename(entry.path)),
      input.model.topology.windows.map((entry) => `${entry.windowId}.json`),
    );
    for (const entry of [...plan.managedFiles, ...plan.initialProjections]) {
      assert.equal(Object.hasOwn(entry, "content"), false);
      assert.equal(Object.hasOwn(entry, "bytes"), false);
    }
  }
});

test("T01a derives structural parents deterministically and covers each local descriptor entry exactly once", async () => {
  const { planWakeflowLocalLayout } = await planner();
  for (const hostProfile of [codexProfile, claudeProfile]) {
    const input = buildInput(hostProfile);
    const first = planWakeflowLocalLayout(input);
    const second = planWakeflowLocalLayout(input);
    assert.equal(canonicalJson(first), canonicalJson(second));
    assertPlanDigest(first);
    assertDeepFrozen(first);
    const sourceKeys = first.staticDirectories
      .filter((entry) => entry.derived)
      .flatMap((entry) => entry.sourceKeys);
    assert.equal(sourceKeys.length > 0, true);
    assert.equal(first.staticDirectories.every((entry) =>
      Array.isArray(entry.sourceKeys)
      && entry.sourceKeys.length > 0
      && [...entry.sourceKeys].sort().join("\n") === entry.sourceKeys.join("\n")), true);

    const plannedKeys = [
      ...first.staticDirectories.filter((entry) => entry.key !== null),
      ...first.managedFiles,
      ...first.initialProjections,
      ...first.deferredEventPatterns,
    ].map((entry) => entry.key);
    const expectedKeys = input.layoutDescriptor.entries
      .filter((entry) => entry.path === ".wakeflow-local" || entry.path.startsWith(".wakeflow-local/"))
      .map((entry) => entry.key)
      .sort();
    assert.deepEqual([...plannedKeys].sort(), expectedKeys);
    assert.equal(new Set(plannedKeys).size, plannedKeys.length);

    const descriptorByKey = new Map(input.layoutDescriptor.entries.map((entry) => [entry.key, entry]));
    for (const [entries, trigger, status] of [
      [first.staticDirectories.filter((entry) => !entry.derived), "fresh-or-host-surface-reconcile", "required"],
      [first.managedFiles, "managed-owner-reconcile", "delegated"],
      [first.initialProjections, "projection-builder-initialize", "delegated"],
      [first.deferredEventPatterns, "owner-event", "deferred"],
    ]) {
      for (const entry of entries) {
        const descriptorEntry = descriptorByKey.get(entry.key);
        assert.deepEqual(plannedMetadata(entry), descriptorMetadata(descriptorEntry));
        assert.equal(entry.trigger, trigger);
        assert.equal(entry.status, status);
        assert.equal(entry.hostApplicability, descriptorEntry.scope === "current-host"
          ? hostProfile.hostId
          : "host-neutral");
        assert.deepEqual(entry.sourceKeys, [entry.key]);
      }
    }
    const hostRoot = `.wakeflow-local/runtime/hosts/${hostProfile.runtime.hostDirName}`;
    for (const entry of first.staticDirectories.filter((candidate) => candidate.derived)) {
      const currentHost = entry.path === hostRoot || entry.path.startsWith(`${hostRoot}/`);
      assert.deepEqual(
        {
          key: entry.key,
          pathKind: entry.pathKind,
          scope: entry.scope,
          owner: entry.owner,
          lifecycle: entry.lifecycle,
          mode: entry.mode,
          createTiming: entry.createTiming,
          condition: entry.condition,
          capability: entry.capability,
          trigger: entry.trigger,
          hostApplicability: entry.hostApplicability,
          status: entry.status,
          derived: entry.derived,
        },
        {
          key: null,
          pathKind: "directory",
          scope: currentHost ? "current-host" : "host-neutral",
          owner: "layout-manager",
          lifecycle: "structural-parent",
          mode: "0700",
          createTiming: "fresh",
          condition: null,
          capability: null,
          trigger: "fresh-or-host-surface-reconcile",
          hostApplicability: currentHost ? hostProfile.hostId : "host-neutral",
          status: "required",
          derived: true,
        },
      );
      for (const sourceKey of entry.sourceKeys) {
        const source = descriptorByKey.get(sourceKey);
        assert.ok(source, `${sourceKey} must identify a descriptor entry`);
        const leaf = source.pathKind === "directory" ? source.path : path.posix.dirname(source.path);
        assert.equal(leaf === entry.path || leaf.startsWith(`${entry.path}/`), true);
      }
    }
  }
});

test("T01a derives one projection per durable stable window without a fixed cardinality", async () => {
  const { planWakeflowLocalLayout } = await planner();
  for (const hostProfile of [codexProfile, claudeProfile]) {
    const input = buildInput(hostProfile, "valid-full.json");
    const plan = planWakeflowLocalLayout(input);
    assert.deepEqual(
      plan.initialProjections.map((entry) => path.posix.basename(entry.path)),
      input.model.topology.windows.map((entry) => `${entry.windowId}.json`),
    );
    assert.equal(plan.initialProjections.length, 5);
    assert.deepEqual(
      paths(plan.staticDirectories),
      expectedStaticDirectories(hostProfile.runtime.hostDirName, hostProfile.hostId === "claude-code"),
    );
    assertPlanDigest(plan);
  }
});

test("T01a excludes every path owned by a non-applicable host capability", async () => {
  const { planWakeflowLocalLayout } = await planner();
  const hostProfile = minimalHostProfile(codexProfile);
  hostProfile.capabilities.identity = { applicable: false, realization: "not-applicable" };
  const input = buildInput(hostProfile);
  const plan = planWakeflowLocalLayout(input);
  const serialized = canonicalJson(plan);
  assert.equal(serialized.includes("identity/window-bindings"), false);
  assert.equal(serialized.includes("event.identity.binding"), false);
  assert.deepEqual(
    plan.host.capabilities.find((entry) => entry.name === "identity"),
    { name: "identity", applicable: false, realization: "not-applicable" },
  );
  assertPlanDigest(plan);
});

test("T01a rejects nested accessors, symbols, and hidden fields without evaluating them", async () => {
  const { planWakeflowLocalLayout, WakeflowLocalLayoutError } = await planner();
  const safe = buildInput(codexProfile);
  const cases = [];

  const accessorModel = clone(safe.model);
  let modelGetterCalls = 0;
  Object.defineProperty(accessorModel.program, "displayName", {
    enumerable: true,
    get() {
      modelGetterCalls += 1;
      return "Accessor Program";
    },
  });
  cases.push({ input: { ...safe, model: accessorModel }, calls: () => modelGetterCalls });

  const accessorHost = minimalHostProfile(codexProfile);
  let hostGetterCalls = 0;
  Object.defineProperty(accessorHost, "hostId", {
    enumerable: true,
    get() {
      hostGetterCalls += 1;
      return "codex";
    },
  });
  cases.push({ input: { ...safe, hostProfile: accessorHost }, calls: () => hostGetterCalls });

  const accessorDescriptor = clone(safe.layoutDescriptor);
  let descriptorGetterCalls = 0;
  Object.defineProperty(accessorDescriptor, "kind", {
    enumerable: true,
    get() {
      descriptorGetterCalls += 1;
      return "WakeflowLayoutDescriptor";
    },
  });
  cases.push({ input: { ...safe, layoutDescriptor: accessorDescriptor }, calls: () => descriptorGetterCalls });

  for (const entry of cases) {
    assert.throws(
      () => planWakeflowLocalLayout(entry.input),
      (error) => error instanceof WakeflowLocalLayoutError && error.code === "wakeflow-local-layout-type",
    );
    assert.equal(entry.calls(), 0, "planner must reject an accessor without invoking it");
  }

  const symbolModel = clone(safe.model);
  symbolModel.program[Symbol("hidden")] = "hidden";
  assert.throws(
    () => planWakeflowLocalLayout({ ...safe, model: symbolModel }),
    (error) => error instanceof WakeflowLocalLayoutError && error.code === "wakeflow-local-layout-type",
  );
  const hiddenDescriptor = clone(safe.layoutDescriptor);
  Object.defineProperty(hiddenDescriptor.entries[0], "hidden", { enumerable: false, value: true });
  assert.throws(
    () => planWakeflowLocalLayout({ ...safe, layoutDescriptor: hiddenDescriptor }),
    (error) => error instanceof WakeflowLocalLayoutError && error.code === "wakeflow-local-layout-type",
  );
});

test("T01a fresh path graph is unique and no delegated file can own another path's ancestor", async () => {
  const { planWakeflowLocalLayout } = await planner();
  for (const fixtureName of ["valid-minimal.json", "valid-full.json"]) {
    for (const hostProfile of [codexProfile, claudeProfile]) {
      const plan = planWakeflowLocalLayout(buildInput(hostProfile, fixtureName));
      const fresh = [...plan.staticDirectories, ...plan.managedFiles, ...plan.initialProjections];
      assert.equal(new Set(paths(fresh)).size, fresh.length);
      for (const file of [...plan.managedFiles, ...plan.initialProjections]) {
        assert.equal(
          fresh.some((entry) => entry !== file && entry.path.startsWith(`${file.path}/`)),
          false,
          `${file.path} cannot be another planned path's ancestor`,
        );
      }
    }
  }
});

test("T01a plan contains no legacy, event placeholder, private handle, or machine-local surface", async () => {
  const { planWakeflowLocalLayout } = await planner();
  for (const hostProfile of [codexProfile, claudeProfile]) {
    const plan = planWakeflowLocalLayout(buildInput(hostProfile));
    const serialized = canonicalJson(plan);
    for (const forbidden of [
      "README.md",
      "wakeflow-delivery",
      "next-work.json",
      "target-results",
      "compatibility",
      "layout-meta",
      "installed-version",
      repositoryRoot,
      "/Users/",
      "/var/folders/",
      "threadId",
      "sessionId",
      "workspaceRoot",
      "generatedAt",
    ]) {
      assert.equal(serialized.includes(forbidden), false, `${forbidden} must not enter the structural plan`);
    }
    assert.equal(Object.hasOwn(plan, "preservedExisting"), false);
    assert.equal(Object.hasOwn(plan, "blocked"), false);
  }
});

test("T01a rejects extra authority, cross-host/config descriptors, and forged paths", async () => {
  const { planWakeflowLocalLayout, WakeflowLocalLayoutError } = await planner();
  const codex = buildInput(codexProfile);
  assert.throws(
    () => planWakeflowLocalLayout({ ...codex, workspaceRoot: "/tmp/not-authorized" }),
    (error) => error instanceof WakeflowLocalLayoutError && error.code === "wakeflow-local-layout-unknown",
  );
  assert.throws(
    () => planWakeflowLocalLayout({ ...codex, hostProfile: claudeProfile }),
    (error) => error instanceof WakeflowLocalLayoutError && error.code === "wakeflow-local-layout-descriptor",
  );
  const changedModel = clone(codex.model);
  changedModel.program.displayName = "Changed Program";
  assert.throws(
    () => planWakeflowLocalLayout({ ...codex, model: changedModel }),
    (error) => error instanceof WakeflowLocalLayoutError && error.code === "wakeflow-local-layout-descriptor",
  );
  const forged = clone(codex.layoutDescriptor);
  forged.entries.find((entry) => entry.key === "local.runtime").path = "../escape";
  assert.throws(
    () => planWakeflowLocalLayout({ ...codex, layoutDescriptor: forged }),
    (error) => error instanceof WakeflowLocalLayoutError && error.code === "wakeflow-local-layout-descriptor",
  );
});

test("T01a remains a pure planner while only admitted v3 owners may import local-layout authority", async () => {
  await planner();
  const moduleFile = path.join(repositoryRoot, "core/scripts/lib/wakeflow-local-layout.mjs");
  const source = readFileSync(moduleFile, "utf8");
  for (const forbidden of [
    /from\s+["']node:fs["']/u,
    /wakeflow-atomic-write/u,
    /\bDate(?:\.|\()/u,
    /\brandomUUID\b/u,
    /\bprocess(?:\.|\[)/u,
    /\b(?:mkdir|chmod|write|rename|unlink|rm)Sync\b/u,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
  const staticImports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(staticImports, [
    "./wakeflow-canonical-json.mjs",
    "./wakeflow-config-v3.mjs",
    "./wakeflow-host-capability.mjs",
    "./wakeflow-layout-descriptor.mjs",
    "node:path",
  ].sort());
  assert.doesNotMatch(source, /\bimport\s*\(/u);
  assert.doesNotMatch(source, /\brequire\s*\(/u);
  const productionRoots = [
    path.join(repositoryRoot, "core"),
    path.join(repositoryRoot, "plugins/codex-wakeflow"),
    path.join(repositoryRoot, "plugins/claude-code-wakeflow"),
  ];
  const publicFiles = productionRoots.flatMap(productionModules)
    .filter((file) => ![
      "wakeflow-fresh-initialize.mjs",
      "wakeflow-maintenance-action-runtime.mjs",
      "wakeflow-reconcile.mjs",
      "wakeflow-observability-v3.mjs",
      "wakeflow-validate.mjs",
      "wakeflow-local-layout.mjs",
      "wakeflow-local-layout-inspection.mjs",
      "wakeflow-local-layout-realization.mjs",
      "wakeflow-migration-production.mjs",
    ].includes(path.basename(file)));
  assert.equal(publicFiles.length > 0, true);
  for (const file of publicFiles) {
    const relative = path.relative(repositoryRoot, file);
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /wakeflow-local-layout(?:-(?:inspection|realization))?\.mjs/u,
      `${relative} is not an admitted v3 local-layout owner`,
    );
  }
});
