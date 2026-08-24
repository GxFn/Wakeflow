import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  WAKEFLOW_MIGRATION_INVENTORY_KIND,
  WAKEFLOW_MIGRATION_INVENTORY_SCHEMA_VERSION,
  WakeflowMigrationInventoryError,
  inspectWakeflowMigrationInventory,
} from "../core/scripts/lib/wakeflow-migration-inventory.mjs";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..");
const LEGACY_ORIGINS_ROOT = path.join(REPOSITORY_ROOT, "test/fixtures/legacy-origins");
const CURRENT_FIXTURE_ROOT = path.join(
  REPOSITORY_ROOT,
  "test/fixtures/legacy-origins/codex-0.9.6-70d79d72/static/shared-setup",
);

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readFixture(ref) {
  return readFileSync(path.join(CURRENT_FIXTURE_ROOT, ref));
}

function createWorkspaceFixture({ splitActive = false } = {}) {
  const sandbox = mkdtempSync(path.join(os.tmpdir(), "wakeflow-migration-inventory-"));
  const workspaceRoot = path.join(sandbox, "WakeflowFixture");
  const productRoot = path.join(sandbox, "ProductWorkspace");
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(productRoot, { recursive: true });

  const config = JSON.parse(readFixture("WakeflowFixture/wakeflow.config.json").toString("utf8"));
  if (splitActive) config.storage.activeRoot = "configured-active";
  writeJson(path.join(workspaceRoot, "wakeflow.config.json"), config);

  for (const ref of [
    "WakeflowFixture/.wakeflow-active/README.md",
    "WakeflowFixture/.wakeflow-active/index.md",
    "WakeflowFixture/.wakeflow-local/wakeflow-delivery/hosts/README.md",
    "WakeflowFixture/.gitignore",
    "WakeflowFixture/Design/README.md",
    "WakeflowFixture/Test/README.md",
    "ProductWorkspace/AGENTS.md",
  ]) {
    const destination = path.join(sandbox, ref);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, readFixture(ref));
  }

  mkdirSync(path.join(workspaceRoot, ".wakeflow-local/wakeflow-delivery/hosts/codex/window-config"), { recursive: true });
  mkdirSync(path.join(workspaceRoot, ".wakeflow-local/wakeflow-delivery/hosts/claude-code/window-host"), { recursive: true });
  writeFileSync(path.join(workspaceRoot, ".wakeflow-local/stream-overlay.lock"), "legacy-lock\n");
  writeJson(
    path.join(workspaceRoot, ".wakeflow-local/wakeflow-delivery/hosts/codex/window-config/private-thread-123.json"),
    { threadId: "private-thread-123" },
  );
  writeJson(
    path.join(workspaceRoot, ".wakeflow-local/wakeflow-delivery/hosts/claude-code/window-host/private-pane-456.json"),
    { pane: "%private-pane-456" },
  );
  writeJson(
    path.join(workspaceRoot, ".workspace-local/wakeflow-delivery/ignored-by-current-loader.json"),
    { legacy: true },
  );
  writeJson(
    path.join(workspaceRoot, ".wakeflow-active/current/DEMAND-DYNAMIC/wakeflow-state.json"),
    { schemaVersion: 2, demandId: "DEMAND-DYNAMIC", status: "active" },
  );
  if (splitActive) {
    mkdirSync(path.join(workspaceRoot, "configured-active"), { recursive: true });
    writeFileSync(path.join(workspaceRoot, "configured-active/configured-only.md"), "configured\n");
  }

  const outside = path.join(sandbox, "outside-secret.txt");
  writeFileSync(outside, "outside\n");
  symlinkSync(outside, path.join(workspaceRoot, ".wakeflow-local/outside-link"));

  return { sandbox, workspaceRoot, productRoot, config };
}

function nodeType(stat) {
  if (stat.isSymbolicLink()) return "symlink";
  if (stat.isDirectory()) return "directory";
  if (stat.isFile()) return "file";
  if (stat.isFIFO()) return "fifo";
  if (stat.isSocket()) return "socket";
  return "special";
}

function exactTreeSnapshot(root) {
  const entries = [];
  function walk(file, ref) {
    const stat = lstatSync(file);
    const type = nodeType(stat);
    let digest = null;
    if (type === "file") digest = sha256(readFileSync(file));
    if (type === "symlink") digest = sha256(Buffer.from(readlinkSync(file), "utf8"));
    entries.push({ ref, type, size: stat.size, digest });
    if (type !== "directory") return;
    for (const name of readdirSync(file).sort()) {
      walk(path.join(file, name), ref ? `${ref}/${name}` : name);
    }
  }
  walk(root, "");
  return entries;
}

function materializeStaticOrigin(originRoot) {
  const origin = JSON.parse(readFileSync(path.join(originRoot, "origin.json"), "utf8"));
  const sandbox = mkdtempSync(path.join(os.tmpdir(), "wakeflow-migration-origin-"));
  for (const layer of origin.staticLayers) {
    for (const entry of layer.expectedEntries) {
      const target = path.join(sandbox, ...entry.path.split("/"));
      if (entry.afterType === null) {
        rmSync(target, { recursive: true, force: true });
        continue;
      }
      if (entry.afterType === "directory") {
        mkdirSync(target, { recursive: true });
        continue;
      }
      assert.equal(entry.afterType, "file");
      const source = path.join(originRoot, "static", layer.layerId, ...entry.path.split("/"));
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(source, target);
    }
  }
  return { origin, sandbox };
}

function countRegularFiles(root) {
  let count = 0;
  function walk(directory) {
    for (const name of readdirSync(directory)) {
      const file = path.join(directory, name);
      const stat = lstatSync(file);
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) count += 1;
    }
  }
  walk(root);
  return count;
}

function sourceAt(inventory, ref) {
  return inventory.sources.find((source) => source.path === ref) ?? null;
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

test("M6-T04 exports one strict read-only inventory owner", () => {
  assert.equal(WAKEFLOW_MIGRATION_INVENTORY_KIND, "WakeflowMigrationInventory");
  assert.equal(WAKEFLOW_MIGRATION_INVENTORY_SCHEMA_VERSION, 1);
  assert.throws(
    () => inspectWakeflowMigrationInventory({ workspaceRoot: ".", extra: true }),
    (error) => error instanceof WakeflowMigrationInventoryError
      && error.code === "wakeflow-migration-inventory-input",
  );
});

test("checked-in current and old-root baselines are complete per-file inventories", () => {
  const current = inspectWakeflowMigrationInventory({
    workspaceRoot: path.join(CURRENT_FIXTURE_ROOT, "WakeflowFixture"),
  });
  assert.equal(current.summary.fileCount, 72);
  assert.equal(current.summary.knownFileCount, 72);
  assert.equal(current.summary.unknownFileCount, 0);

  const old = inspectWakeflowMigrationInventory({
    workspaceRoot: path.join(
      REPOSITORY_ROOT,
      "test/fixtures/legacy-origins/codex-0.1.2-58eb3bcf/static/shared-setup/WakeflowFixture",
    ),
  });
  assert.equal(old.summary.fileCount, 68);
  assert.equal(old.summary.knownFileCount, 68);
  assert.equal(old.summary.unknownFileCount, 0);
  assert.ok(old.blockers.some((blocker) => blocker.code === "legacy-old-root-unsupported"));
  assert.ok(old.sources.some((source) => source.classification?.defaultDisposition.action === "manual"));
});

test("all 97 checked-in origin baselines materialize to complete known-source inventories", () => {
  const origins = readdirSync(LEGACY_ORIGINS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(LEGACY_ORIGINS_ROOT, entry.name, "origin.json")))
    .map((entry) => entry.name)
    .sort();
  assert.equal(origins.length, 97);
  for (const originId of origins) {
    const materialized = materializeStaticOrigin(path.join(LEGACY_ORIGINS_ROOT, originId));
    try {
      const workspaceRoot = path.join(materialized.sandbox, "WakeflowFixture");
      const expectedFileCount = countRegularFiles(materialized.sandbox);
      const inventory = inspectWakeflowMigrationInventory({ workspaceRoot });
      assert.equal(inventory.summary.fileCount, expectedFileCount, `${originId} file coverage`);
      assert.equal(inventory.summary.knownFileCount, expectedFileCount, `${originId} known coverage`);
      assert.equal(inventory.summary.unknownFileCount, 0, `${originId} unknown coverage`);
      assert.ok(inventory.configSources.length >= 1, `${originId} config source`);
      if (materialized.origin.rootFamily === "old-root-flat") {
        assert.ok(
          inventory.blockers.some((blocker) => blocker.code === "legacy-old-root-unsupported"),
          `${originId} old-root manual gate`,
        );
      }
    } finally {
      rmSync(materialized.sandbox, { recursive: true, force: true });
    }
  }
});

test("inventory scans fixed, configured, old, and every actual host source without normal-loader omissions", (t) => {
  const fixture = createWorkspaceFixture({ splitActive: true });
  t.after(() => rmSync(fixture.sandbox, { recursive: true, force: true }));
  const before = exactTreeSnapshot(fixture.sandbox);

  const inventory = inspectWakeflowMigrationInventory({ workspaceRoot: fixture.workspaceRoot });

  assert.equal(inventory.artifactKind, WAKEFLOW_MIGRATION_INVENTORY_KIND);
  assert.equal(inventory.schemaVersion, WAKEFLOW_MIGRATION_INVENTORY_SCHEMA_VERSION);
  assert.equal(inventory.summary.authorityEligible, false);
  for (const rootRef of [
    ".wakeflow-active",
    ".wakeflow-local",
    ".workspace-active",
    ".workspace-local",
    "configured-active",
  ]) {
    assert.ok(inventory.roots.some((root) => root.location.path === rootRef), `missing root ${rootRef}`);
  }
  for (const ref of [
    ".wakeflow-local/stream-overlay.lock",
    ".workspace-local/wakeflow-delivery/ignored-by-current-loader.json",
    "configured-active/configured-only.md",
  ]) {
    assert.ok(sourceAt(inventory, ref), `missing source ${ref}`);
  }
  assert.ok(inventory.sources.some((source) => source.type === "directory" && source.path === ".wakeflow-local"));
  const privateSource = inventory.sources.find(
    (source) => source.privacy === "local-secret" && source.path === null && source.type === "file",
  );
  assert.ok(privateSource);
  assert.match(privateSource.parentSourceId ?? "", /^sha256:[a-f0-9]{64}$/u);
  const privateParent = inventory.sources.find((source) => source.sourceId === privateSource.parentSourceId);
  assert.ok(privateParent?.childSourceIds.includes(privateSource.sourceId));
  assert.equal(privateParent?.path, null);
  for (const source of inventory.sources) {
    assert.deepEqual([...source.childSourceIds].sort(), source.childSourceIds);
    for (const childSourceId of source.childSourceIds) {
      const child = inventory.sources.find((candidate) => candidate.sourceId === childSourceId);
      assert.equal(child?.parentSourceId, source.sourceId);
    }
  }
  assert.equal(JSON.stringify(inventory).includes("private-thread-123"), false);
  assert.equal(JSON.stringify(inventory).includes("private-pane-456"), false);
  assert.equal(JSON.stringify(inventory).includes(fixture.sandbox), false);
  const hostIdentitySources = inventory.sources.filter((source) => source.resource.kind === "host-identity");
  assert.equal(hostIdentitySources.length, 2);
  assert.ok(hostIdentitySources.every((source) => (
    source.type !== "directory"
    && source.blockerCodes.includes("migration-host-decommission-required")
  )));
  assert.ok(inventory.sources.some((source) => (
    source.path === ".wakeflow-local/wakeflow-delivery/hosts/codex"
    && source.resource.kind === "container"
    && !source.blockerCodes.some((code) => code.includes("host-decommission"))
  )));
  assert.ok(inventory.sources.some((source) => (
    source.path === ".wakeflow-local/wakeflow-delivery/hosts/README.md"
    && source.resource.kind === "local-readme"
    && !source.blockerCodes.some((code) => code.includes("host-decommission"))
  )));
  assert.ok(inventory.domainFacts.some((fact) => fact.kind === "active-demand" && fact.state === "drain-required"));
  assert.ok(inventory.blockers.some((blocker) => blocker.code === "migration-owner-drain-required"));
  assert.ok(inventory.blockers.some((blocker) => blocker.code === "migration-config-root-divergence"));
  assert.deepEqual(exactTreeSnapshot(fixture.sandbox), before);
});

test("inventory is deterministic, deeply frozen, no-follow, and keeps dynamic unknowns manual", (t) => {
  const fixture = createWorkspaceFixture();
  t.after(() => rmSync(fixture.sandbox, { recursive: true, force: true }));

  const first = inspectWakeflowMigrationInventory({ workspaceRoot: fixture.workspaceRoot });
  const second = inspectWakeflowMigrationInventory({ workspaceRoot: fixture.workspaceRoot });
  assert.deepEqual(second, first);
  assert.equal(second.inventoryDigest, first.inventoryDigest);
  assertDeepFrozen(first);

  const link = sourceAt(first, ".wakeflow-local/outside-link");
  assert.equal(link?.type, "symlink");
  assert.ok(link?.blockerCodes.includes("migration-source-symlink"));
  assert.equal(JSON.stringify(first).includes("outside-secret.txt"), false);

  const lock = sourceAt(first, ".wakeflow-local/stream-overlay.lock");
  assert.equal(lock?.classification?.confidence, "unknown");
  assert.ok(lock?.blockerCodes.includes("migration-source-unrecognized"));
  assert.ok(lock?.blockerCodes.includes("migration-owner-drain-required"));
  assert.equal(Object.hasOwn(lock, "mtime"), false);
  assert.equal(Object.hasOwn(lock, "ctime"), false);
});

test("special and unsafe filesystem entries stay visible only as manual digest evidence", (t) => {
  const fixture = createWorkspaceFixture();
  t.after(() => rmSync(fixture.sandbox, { recursive: true, force: true }));
  writeFileSync(path.join(fixture.workspaceRoot, ".wakeflow-local/unsafe name.txt"), "unsafe\n");
  const fifo = path.join(fixture.workspaceRoot, ".wakeflow-local/legacy.fifo");
  const made = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
  if (made.status !== 0) {
    t.skip("mkfifo is unavailable on this platform");
    return;
  }

  const inventory = inspectWakeflowMigrationInventory({ workspaceRoot: fixture.workspaceRoot });
  const fifoSource = sourceAt(inventory, ".wakeflow-local/legacy.fifo");
  assert.equal(fifoSource?.type, "fifo");
  assert.ok(fifoSource?.blockerCodes.includes("migration-source-special-node"));
  const unsafe = inventory.sources.find(
    (source) => source.type === "file" && source.blockerCodes.includes("migration-source-unsafe-ref"),
  );
  assert.equal(unsafe?.path, null);
  assert.match(unsafe?.pathDigest ?? "", /^sha256:[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(inventory).includes("unsafe name.txt"), false);
});

test("config source set preserves every digest, detects divergence, and validates overlay base evidence", (t) => {
  const fixture = createWorkspaceFixture();
  t.after(() => rmSync(fixture.sandbox, { recursive: true, force: true }));
  const durableFile = path.join(fixture.workspaceRoot, "wakeflow.config.json");
  const durableBytes = readFileSync(durableFile);

  const conflicting = {
    workspaceName: fixture.config.workspace.name,
    interfaceLanguage: fixture.config.workspace.language,
    runtimeMode: fixture.config.workspace.runtimeMode,
    workspaceRoot: fixture.config.workspace.root,
    wakeflowRepoDir: fixture.config.workspace.wakeflowRepoDir,
    controllerWindow: fixture.config.roles.controller,
    designWindow: fixture.config.roles.design,
    testWindow: fixture.config.roles.test,
    activeLedgerRoot: fixture.config.storage.activeRoot,
    projectLedgerRoot: fixture.config.storage.ledgerRoot,
    allowMissingRepos: fixture.config.policy.allowMissingRepos,
    disallowedTrackedPaths: fixture.config.policy.disallowedTrackedPaths,
    allowedRepositoryResiduePaths: fixture.config.policy.allowedRepositoryResiduePaths,
    runtimeProcessMatchers: fixture.config.policy.runtimeProcessMatchers,
    runtimeProcessLabel: fixture.config.policy.runtimeProcessLabel,
    repositories: fixture.config.repositories,
    hosts: fixture.config.hosts,
  };
  writeJson(path.join(fixture.workspaceRoot, "workspace.config.json"), conflicting);
  const equivalent = inspectWakeflowMigrationInventory({ workspaceRoot: fixture.workspaceRoot });
  assert.equal(equivalent.blockers.some((blocker) => blocker.code === "migration-config-intent-conflict"), false);

  conflicting.workspaceName = "ConflictingWorkspace";
  writeJson(path.join(fixture.workspaceRoot, "workspace.config.json"), conflicting);

  const overlay = structuredClone(fixture.config);
  overlay.derived = {
    kind: "WakeflowLocalConfigOverlay",
    version: 1,
    from: "wakeflow.config.json",
    baseHash: sha256(durableBytes).slice("sha256:".length),
    generatedAt: "2026-08-10T00:00:00.000Z",
    streamWindows: [],
  };
  writeJson(path.join(fixture.workspaceRoot, ".wakeflow-local/wakeflow.config.json"), overlay);

  const inventory = inspectWakeflowMigrationInventory({ workspaceRoot: fixture.workspaceRoot });
  assert.equal(inventory.configSources.length, 3);
  assert.equal(new Set(inventory.configSources.map((source) => source.rawDigest)).size, 3);
  assert.ok(inventory.blockers.some((blocker) => blocker.code === "migration-config-intent-conflict"));
  const overlaySource = inventory.configSources.find((source) => source.scope === "local-overlay");
  assert.equal(overlaySource?.baseEvidence, "matched-durable-source");
  assert.ok(overlaySource?.blockerCodes.includes("migration-owner-drain-required"));

  overlay.storage.activeRoot = "silently-diverged-active";
  writeJson(path.join(fixture.workspaceRoot, ".wakeflow-local/wakeflow.config.json"), overlay);
  const intentMismatch = inspectWakeflowMigrationInventory({ workspaceRoot: fixture.workspaceRoot });
  const mismatchedIntent = intentMismatch.configSources.find((source) => source.scope === "local-overlay");
  assert.equal(mismatchedIntent?.baseEvidence, "mismatched-durable-intent");
  assert.ok(mismatchedIntent?.blockerCodes.includes("migration-overlay-intent-mismatch"));

  overlay.storage.activeRoot = fixture.config.storage.activeRoot;
  overlay.derived.from = "workspace.config.json";
  writeJson(path.join(fixture.workspaceRoot, ".wakeflow-local/wakeflow.config.json"), overlay);
  const referenceMismatch = inspectWakeflowMigrationInventory({ workspaceRoot: fixture.workspaceRoot });
  const mismatchedReference = referenceMismatch.configSources.find((source) => source.scope === "local-overlay");
  assert.equal(mismatchedReference?.baseEvidence, "mismatched-durable-source");
  assert.ok(mismatchedReference?.blockerCodes.includes("migration-overlay-base-mismatch"));
});

test("invalid config paths and durable topology-only divergence remain explicit blockers", (t) => {
  const fixture = createWorkspaceFixture();
  t.after(() => rmSync(fixture.sandbox, { recursive: true, force: true }));

  const flat = {
    workspaceName: fixture.config.workspace.name,
    interfaceLanguage: fixture.config.workspace.language,
    runtimeMode: fixture.config.workspace.runtimeMode,
    workspaceRoot: fixture.config.workspace.root,
    wakeflowRepoDir: fixture.config.workspace.wakeflowRepoDir,
    controllerWindow: fixture.config.roles.controller,
    designWindow: fixture.config.roles.design,
    testWindow: fixture.config.roles.test,
    activeLedgerRoot: fixture.config.storage.activeRoot,
    projectLedgerRoot: fixture.config.storage.ledgerRoot,
    internalDesignPath: "AlternateDesign",
    allowMissingRepos: fixture.config.policy.allowMissingRepos,
    disallowedTrackedPaths: fixture.config.policy.disallowedTrackedPaths,
    allowedRepositoryResiduePaths: fixture.config.policy.allowedRepositoryResiduePaths,
    runtimeProcessMatchers: fixture.config.policy.runtimeProcessMatchers,
    runtimeProcessLabel: fixture.config.policy.runtimeProcessLabel,
    repositories: fixture.config.repositories,
    hosts: fixture.config.hosts,
  };
  writeJson(path.join(fixture.workspaceRoot, "workspace.config.json"), flat);
  const topologyConflict = inspectWakeflowMigrationInventory({ workspaceRoot: fixture.workspaceRoot });
  assert.ok(topologyConflict.blockers.some((blocker) => blocker.code === "migration-config-topology-conflict"));

  rmSync(path.join(fixture.workspaceRoot, "workspace.config.json"));
  const invalid = structuredClone(fixture.config);
  invalid.storage.activeRoot = "bad\u0000root";
  writeJson(path.join(fixture.workspaceRoot, "wakeflow.config.json"), invalid);
  const invalidPath = inspectWakeflowMigrationInventory({ workspaceRoot: fixture.workspaceRoot });
  assert.ok(invalidPath.configSources[0].blockerCodes.includes("migration-config-path-invalid"));
  assert.ok(invalidPath.blockers.some((blocker) => blocker.code === "migration-config-path-invalid"));
});

test("external repositories expose only exact mixed-owned surfaces while internal support is recursive", (t) => {
  const fixture = createWorkspaceFixture();
  t.after(() => rmSync(fixture.sandbox, { recursive: true, force: true }));
  writeFileSync(path.join(fixture.productRoot, "private-product-source.txt"), "must not be scanned\n");
  writeFileSync(path.join(fixture.workspaceRoot, "Design/internal-generated.txt"), "must be scanned\n");

  const inventory = inspectWakeflowMigrationInventory({ workspaceRoot: fixture.workspaceRoot });
  assert.ok(inventory.sources.some((source) => source.path === "internal-generated.txt" && source.surfaceKind === "design-support"));
  assert.equal(JSON.stringify(inventory).includes("private-product-source.txt"), false);
  assert.ok(inventory.sources.some((source) => source.path === "AGENTS.md" && source.surfaceKind === "product-repository"));
});

test("internal support cannot escape through an intermediate symlink and conflicting claim contexts stay opaque", (t) => {
  const fixture = createWorkspaceFixture();
  t.after(() => rmSync(fixture.sandbox, { recursive: true, force: true }));
  const outside = path.join(fixture.sandbox, "OutsideSupport");
  mkdirSync(path.join(outside, "Design"), { recursive: true });
  writeFileSync(path.join(outside, "Design/private.md"), "must not be scanned through an internal path\n");
  symlinkSync(outside, path.join(fixture.workspaceRoot, "internal-link"));

  const escaped = structuredClone(fixture.config);
  escaped.repositories.find((repository) => repository.windowName === "Design").path = "internal-link/Design";
  writeJson(path.join(fixture.workspaceRoot, "wakeflow.config.json"), escaped);
  const escapedInventory = inspectWakeflowMigrationInventory({ workspaceRoot: fixture.workspaceRoot });
  assert.equal(JSON.stringify(escapedInventory).includes("private.md"), false);
  assert.ok(escapedInventory.roots.some((root) => (
    root.surfaceKind === "design-support"
    && root.blockerCodes.includes("migration-source-symlink-ancestor")
  )));

  const ambiguous = structuredClone(fixture.config);
  ambiguous.repositories.find((repository) => repository.windowName === "Design").path = "../ProductWorkspace";
  ambiguous.repositories.find((repository) => repository.windowName === "Design").mode = "external";
  writeJson(path.join(fixture.workspaceRoot, "wakeflow.config.json"), ambiguous);
  const ambiguousInventory = inspectWakeflowMigrationInventory({ workspaceRoot: fixture.workspaceRoot });
  const ambiguousSource = ambiguousInventory.sources.find((source) => (
    source.surfaceKind === "ambiguous"
    && source.blockerCodes.includes("migration-source-context-conflict")
  ));
  assert.ok(ambiguousSource);
  assert.equal(ambiguousSource.path, null);
  assert.equal(ambiguousSource.owner, "unknown");
  assert.equal(ambiguousSource.classification, null);
});

test("regular-file hard links remain inventoried but cannot become automatic source units", (t) => {
  const fixture = createWorkspaceFixture();
  t.after(() => rmSync(fixture.sandbox, { recursive: true, force: true }));
  const original = path.join(fixture.workspaceRoot, ".wakeflow-active/README.md");
  const alias = path.join(fixture.workspaceRoot, ".wakeflow-active/README-copy.md");
  linkSync(original, alias);

  const inventory = inspectWakeflowMigrationInventory({ workspaceRoot: fixture.workspaceRoot });
  const sources = inventory.sources.filter((source) => (
    source.digest === sha256(readFileSync(original))
    && source.blockerCodes.includes("migration-source-multiple-links")
  ));
  assert.equal(sources.length, 2);
  assert.ok(inventory.blockers.some((blocker) => blocker.code === "migration-source-multiple-links"));
});

test("root topology keeps empty old roots, nested authority roots, and unbounded workspace surfaces blocking", (t) => {
  const fixture = createWorkspaceFixture();
  t.after(() => rmSync(fixture.sandbox, { recursive: true, force: true }));
  mkdirSync(path.join(fixture.workspaceRoot, ".workspace-active"), { recursive: true });
  mkdirSync(path.join(fixture.workspaceRoot, ".wakeflow-local/nested-active"), { recursive: true });

  const farWorkspace = path.join(fixture.sandbox, "FarWorkspace");
  mkdirSync(farWorkspace, { recursive: true });
  writeFileSync(path.join(farWorkspace, "AGENTS.md"), "must remain outside the bounded workspace scan\n");
  const config = JSON.parse(readFileSync(path.join(fixture.workspaceRoot, "wakeflow.config.json"), "utf8"));
  config.storage.activeRoot = ".wakeflow-local/nested-active";
  config.workspace.root = "../FarWorkspace";
  writeJson(path.join(fixture.workspaceRoot, "wakeflow.config.json"), config);

  const inventory = inspectWakeflowMigrationInventory({ workspaceRoot: fixture.workspaceRoot });
  const oldRoot = inventory.roots.find((root) => root.location.path === ".workspace-active");
  assert.equal(oldRoot?.exists, true);
  assert.ok(oldRoot?.blockerCodes.includes("legacy-old-root-unsupported"));
  assert.ok(inventory.blockers.some((blocker) => blocker.code === "migration-config-root-divergence"));
  assert.ok(inventory.blockers.some((blocker) => blocker.code === "migration-config-root-overlap"));

  const unboundedRoots = inventory.roots.filter(
    (root) => root.location.kind === "configured-private"
      && root.blockerCodes.includes("migration-config-workspace-root-unbounded"),
  );
  assert.ok(unboundedRoots.length > 0);
  assert.ok(unboundedRoots.every((root) => root.exists === false));
  assert.equal(JSON.stringify(inventory).includes("must remain outside the bounded workspace scan"), false);
});

test("exact external surfaces never recurse through an unexpected directory or a configured symlink ancestor", (t) => {
  const fixture = createWorkspaceFixture();
  t.after(() => rmSync(fixture.sandbox, { recursive: true, force: true }));
  rmSync(path.join(fixture.productRoot, "AGENTS.md"));
  mkdirSync(path.join(fixture.productRoot, "AGENTS.md/private"), { recursive: true });
  writeFileSync(path.join(fixture.productRoot, "AGENTS.md/private/source.txt"), "not inventory input\n");

  const linkedTarget = path.join(fixture.workspaceRoot, "linked-target");
  mkdirSync(linkedTarget);
  writeFileSync(path.join(linkedTarget, "secret.md"), "do not follow\n");
  symlinkSync(linkedTarget, path.join(fixture.workspaceRoot, "configured-link"));
  const config = JSON.parse(readFileSync(path.join(fixture.workspaceRoot, "wakeflow.config.json"), "utf8"));
  config.storage.activeRoot = "configured-link/secret.md";
  writeJson(path.join(fixture.workspaceRoot, "wakeflow.config.json"), config);

  const inventory = inspectWakeflowMigrationInventory({ workspaceRoot: fixture.workspaceRoot });
  const unexpectedDirectory = inventory.sources.find(
    (source) => source.path === "AGENTS.md" && source.surfaceKind === "product-repository",
  );
  assert.equal(unexpectedDirectory?.type, "directory");
  assert.ok(unexpectedDirectory?.blockerCodes.includes("migration-source-type-mismatch"));
  assert.equal(JSON.stringify(inventory).includes("source.txt"), false);
  assert.equal(JSON.stringify(inventory).includes("do not follow"), false);
  assert.ok(inventory.blockers.some((blocker) => blocker.code === "migration-source-symlink-ancestor"));
});

test("config discovery and external mixed surfaces never traverse a symlinked configured root", (t) => {
  const fixture = createWorkspaceFixture();
  t.after(() => rmSync(fixture.sandbox, { recursive: true, force: true }));

  const durableBytes = readFileSync(path.join(fixture.workspaceRoot, "wakeflow.config.json"));
  const outsideLocal = path.join(fixture.sandbox, "OutsideLocal");
  rmSync(path.join(fixture.workspaceRoot, ".wakeflow-local"), { recursive: true, force: true });
  mkdirSync(outsideLocal, { recursive: true });
  const overlay = structuredClone(fixture.config);
  overlay.storage.activeRoot = "followed-active";
  overlay.derived = {
    kind: "WakeflowLocalConfigOverlay",
    version: 1,
    from: "wakeflow.config.json",
    baseHash: sha256(durableBytes).slice("sha256:".length),
    generatedAt: "2026-08-10T00:00:00.000Z",
    streamWindows: [],
  };
  writeJson(path.join(outsideLocal, "wakeflow.config.json"), overlay);
  symlinkSync(outsideLocal, path.join(fixture.workspaceRoot, ".wakeflow-local"));

  const productTarget = path.join(fixture.sandbox, "ProductTarget");
  rmSync(fixture.productRoot, { recursive: true, force: true });
  mkdirSync(productTarget, { recursive: true });
  writeFileSync(path.join(productTarget, "AGENTS.md"), "must not be read through configured root\n");
  symlinkSync(productTarget, fixture.productRoot);

  const inventory = inspectWakeflowMigrationInventory({ workspaceRoot: fixture.workspaceRoot });
  const localConfig = inventory.configSources.find((source) => source.scope === "local-overlay");
  assert.equal(localConfig?.rawDigest, null);
  assert.ok(localConfig?.blockerCodes.includes("migration-source-symlink-ancestor"));
  assert.equal(inventory.roots.some((root) => root.location.path === "followed-active"), false);
  assert.equal(inventory.sources.some((source) => source.surfaceKind === "product-repository"), false);
  assert.ok(inventory.roots.some(
    (root) => root.surfaceKind === "product-repository"
      && root.blockerCodes.includes("migration-source-symlink-ancestor"),
  ));
  assert.equal(JSON.stringify(inventory).includes("must not be read through configured root"), false);
});

test("missing or symlink workspace roots fail before traversal", (t) => {
  const sandbox = mkdtempSync(path.join(os.tmpdir(), "wakeflow-migration-inventory-root-"));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  const real = path.join(sandbox, "real");
  const link = path.join(sandbox, "link");
  mkdirSync(real);
  symlinkSync(real, link);
  assert.throws(
    () => inspectWakeflowMigrationInventory({ workspaceRoot: link }),
    (error) => error instanceof WakeflowMigrationInventoryError
      && error.code === "wakeflow-migration-inventory-workspace",
  );
  assert.throws(
    () => inspectWakeflowMigrationInventory({ workspaceRoot: path.join(sandbox, "missing") }),
    (error) => error instanceof WakeflowMigrationInventoryError
      && error.code === "wakeflow-migration-inventory-workspace",
  );
});
