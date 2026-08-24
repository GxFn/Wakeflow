import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  WAKEFLOW_LEGACY_CLASSIFIER_ACTIONS,
  WAKEFLOW_LEGACY_CLASSIFIER_CATALOG_KIND,
  WAKEFLOW_LEGACY_CLASSIFIER_CATALOG_VERSION,
  classifyWakeflowLegacySource,
  readWakeflowLegacyClassifierCatalog,
  validateWakeflowLegacyClassifierCatalog,
} from "../core/scripts/lib/wakeflow-legacy-classifier.mjs";
import {
  WAKEFLOW_LEGACY_CLASSIFIER_CATALOG_RELATIVE_PATH,
  buildWakeflowLegacyClassifierCatalog,
  legacyClassifierFixtureSourceDescriptor,
} from "../tools/lib/wakeflow-legacy-classifier-catalog.mjs";
import {
  writeWakeflowLegacyClassifierCatalogBytes,
} from "../tools/build-legacy-classifier-catalog.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const fixturesRoot = path.join(repositoryRoot, "test/fixtures/legacy-origins");
const catalogFile = path.join(repositoryRoot, WAKEFLOW_LEGACY_CLASSIFIER_CATALOG_RELATIVE_PATH);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function resignCatalog(catalog) {
  catalog.catalogDigest = canonicalJsonDigest({
    artifactKind: catalog.artifactKind,
    coverage: catalog.coverage,
    entries: catalog.entries,
    schemaVersion: catalog.schemaVersion,
  });
  return catalog;
}

function readOrigin(originId) {
  return JSON.parse(readFileSync(path.join(fixturesRoot, originId, "origin.json"), "utf8"));
}

function currentOrigin(host) {
  return readdirSync(fixturesRoot)
    .filter((originId) => originId.startsWith(`${host}-0.9.6-`))
    .map((originId) => ({ originId, origin: readOrigin(originId) }))
    .find(({ origin }) => origin.source.commit === "70d79d720d65837a068993006f356e8de91215d4");
}

function staticFixture(originId, layerId, ref) {
  return readFileSync(path.join(fixturesRoot, originId, "static", layerId, ...ref.split("/")));
}

function scenarioFixture(originId, scenarioId, ref) {
  return readFileSync(path.join(fixturesRoot, originId, "scenarios", scenarioId, "output", ...ref.split("/")));
}

function classifyFixture({ bytes, origin, ref, owner, scenario = null }) {
  return classifyWakeflowLegacySource({
    ...legacyClassifierFixtureSourceDescriptor({
      owner,
      ref,
      rootFamily: origin.rootFamily,
      scenarioCategory: scenario?.category ?? null,
    }),
    sourceBytes: bytes,
  });
}

test("the checked-in classifier catalog is deterministic, compact, validated, and deeply frozen", () => {
  const built = buildWakeflowLegacyClassifierCatalog({ fixturesRoot });
  const checkedIn = JSON.parse(readFileSync(catalogFile, "utf8"));
  const loaded = readWakeflowLegacyClassifierCatalog();

  assert.deepEqual(built, checkedIn);
  assert.deepEqual(validateWakeflowLegacyClassifierCatalog(checkedIn), checkedIn);
  assert.deepEqual(loaded, checkedIn);
  assert.equal(loaded.artifactKind, WAKEFLOW_LEGACY_CLASSIFIER_CATALOG_KIND);
  assert.equal(loaded.schemaVersion, WAKEFLOW_LEGACY_CLASSIFIER_CATALOG_VERSION);
  assert.equal(loaded.coverage.originCount, 97);
  assert.equal(loaded.coverage.pendingOriginCount, 0);
  assert.ok(loaded.entries.length > 100);
  assert.ok(statSync(catalogFile).size < 4 * 1024 * 1024);
  assert.match(loaded.catalogDigest, SHA256_PATTERN);
  assert.equal(Object.isFrozen(loaded), true);
  assert.equal(Object.isFrozen(loaded.entries), true);
  assert.equal(Object.isFrozen(loaded.entries[0]), true);
  assert.equal(JSON.stringify(loaded).includes("/Users/"), false);
  assert.equal(JSON.stringify(loaded).includes("/private/var/"), false);
  assert.equal(JSON.stringify(loaded).includes("test/fixtures/legacy-origins"), false);
});

test("catalog validation closes array descriptors, policy vocabulary, entry digests, and portable paths", () => {
  const checkedIn = JSON.parse(readFileSync(catalogFile, "utf8"));

  const hidden = structuredClone(checkedIn);
  Object.defineProperty(hidden.entries, "hidden", { value: true });
  assert.throws(
    () => validateWakeflowLegacyClassifierCatalog(hidden),
    (error) => error.code === "wakeflow-legacy-classifier-catalog-shape",
  );

  const symbol = structuredClone(checkedIn);
  Object.defineProperty(symbol.entries, Symbol("hidden"), { value: true });
  assert.throws(
    () => validateWakeflowLegacyClassifierCatalog(symbol),
    (error) => error.code === "wakeflow-legacy-classifier-catalog-shape",
  );

  const behavior = structuredClone(checkedIn);
  let getterExecutions = 0;
  Object.defineProperty(behavior.entries, "0", {
    enumerable: true,
    get() {
      getterExecutions += 1;
      return checkedIn.entries[0];
    },
  });
  assert.throws(
    () => validateWakeflowLegacyClassifierCatalog(behavior),
    (error) => error.code === "wakeflow-legacy-classifier-catalog-shape",
  );
  assert.equal(getterExecutions, 0);

  const inventedPolicy = structuredClone(checkedIn);
  inventedPolicy.entries[0].dispositionPolicy = "invented-policy";
  resignCatalog(inventedPolicy);
  assert.throws(
    () => validateWakeflowLegacyClassifierCatalog(inventedPolicy),
    (error) => error.code === "wakeflow-legacy-classifier-catalog-shape",
  );

  const staleEntryDigest = structuredClone(checkedIn);
  const entry = staleEntryDigest.entries.find(({ dispositionPolicy }) => dispositionPolicy !== "mixed-memory");
  entry.dispositionPolicy = "mixed-memory";
  resignCatalog(staleEntryDigest);
  assert.throws(
    () => validateWakeflowLegacyClassifierCatalog(staleEntryDigest),
    (error) => error.code === "wakeflow-legacy-classifier-catalog-digest",
  );

  const base = {
    surfaceKind: "controller",
    ownership: "wakeflow-managed",
    gitIgnoreRoot: "unknown",
    sourceBytes: Buffer.from("opaque"),
  };
  for (const relativePath of ["folder/control\nfile", "folder/e\u0301.json"]) {
    assert.throws(
      () => classifyWakeflowLegacySource({ ...base, relativePath }),
      (error) => error.code === "wakeflow-legacy-classifier-path",
    );
  }
});

test("the packaged catalog reader rejects oversized files and symbolic-link substitution", async () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-classifier-reader-"));
  try {
    const libRoot = path.join(temporaryRoot, "scripts/lib");
    const dataRoot = path.join(temporaryRoot, "scripts/data");
    mkdirSync(libRoot, { recursive: true });
    mkdirSync(dataRoot, { recursive: true });
    copyFileSync(
      path.join(repositoryRoot, "core/scripts/lib/wakeflow-legacy-classifier.mjs"),
      path.join(libRoot, "wakeflow-legacy-classifier.mjs"),
    );
    copyFileSync(
      path.join(repositoryRoot, "core/scripts/lib/wakeflow-canonical-json.mjs"),
      path.join(libRoot, "wakeflow-canonical-json.mjs"),
    );
    const isolated = await import(`${pathToFileURL(path.join(libRoot, "wakeflow-legacy-classifier.mjs")).href}?reader-boundary=1`);
    const isolatedCatalog = path.join(dataRoot, "wakeflow-legacy-classifier-catalog.json");
    writeFileSync(isolatedCatalog, Buffer.alloc((4 * 1024 * 1024) + 1, 0x20));
    assert.throws(
      () => isolated.readWakeflowLegacyClassifierCatalog(),
      (error) => error.code === "wakeflow-legacy-classifier-catalog-read"
        && error.details.causeCode === "wakeflow-legacy-classifier-catalog-limit",
    );

    rmSync(isolatedCatalog);
    symlinkSync(catalogFile, isolatedCatalog);
    assert.throws(
      () => isolated.readWakeflowLegacyClassifierCatalog(),
      (error) => error.code === "wakeflow-legacy-classifier-catalog-read",
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("catalog source writer is atomic and refuses linked output files", {
  skip: process.platform === "win32",
}, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-classifier-writer-"));
  try {
    const bytes = readFileSync(catalogFile);
    const output = path.join(root, "catalog.json");
    assert.equal(
      writeWakeflowLegacyClassifierCatalogBytes({ catalogFile: output, bytes }),
      "written",
    );
    assert.deepEqual(readFileSync(output), bytes);
    assert.equal(
      writeWakeflowLegacyClassifierCatalogBytes({ catalogFile: output, bytes }),
      "unchanged",
    );

    const sentinel = path.join(root, "sentinel.json");
    writeFileSync(sentinel, bytes);
    const linked = path.join(root, "linked.json");
    symlinkSync(sentinel, linked);
    assert.throws(
      () => writeWakeflowLegacyClassifierCatalogBytes({ catalogFile: linked, bytes }),
      /non-symlink single-link/u,
    );
    unlinkSync(linked);
    linkSync(sentinel, linked);
    assert.throws(
      () => writeWakeflowLegacyClassifierCatalogBytes({ catalogFile: linked, bytes }),
      /non-symlink single-link/u,
    );
    assert.deepEqual(readFileSync(sentinel), bytes);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every checked-in static and scenario regular file has a strict known classification and its exact origin candidate", () => {
  const originIds = readdirSync(fixturesRoot)
    .filter((name) => name !== "source-map.json")
    .sort();
  let classifiedFiles = 0;

  for (const originId of originIds) {
    const origin = readOrigin(originId);
    for (const layer of origin.staticLayers) {
      for (const entry of layer.expectedEntries) {
        if (entry.afterType !== "file") continue;
        const bytes = staticFixture(originId, layer.layerId, entry.path);
        const result = classifyFixture({
          bytes,
          origin,
          owner: layer.owner,
          ref: entry.path,
        });
        assert.notEqual(result.confidence, "unknown", `${originId}:${layer.layerId}:${entry.path}`);
        assert.equal(result.rawDigest, entry.afterDigest, `${originId}:${layer.layerId}:${entry.path}`);
        assert.ok(result.originCandidates.includes(originId), `${originId}:${layer.layerId}:${entry.path}`);
        assert.ok(WAKEFLOW_LEGACY_CLASSIFIER_ACTIONS.includes(result.defaultDisposition.action));
        classifiedFiles += 1;
      }
    }
    for (const scenarioRef of origin.scenarios) {
      const scenarioId = scenarioRef.split("/")[0];
      const scenario = JSON.parse(readFileSync(path.join(fixturesRoot, originId, "scenarios", scenarioRef), "utf8"));
      for (const entry of scenario.outputManifest.files) {
        const bytes = scenarioFixture(originId, scenarioId, entry.ref);
        const result = classifyFixture({
          bytes,
          origin,
          owner: scenario.materializationMode,
          ref: entry.ref,
          scenario,
        });
        assert.notEqual(result.confidence, "unknown", `${originId}:${scenarioId}:${entry.ref}`);
        assert.equal(result.rawDigest, entry.digest, `${originId}:${scenarioId}:${entry.ref}`);
        assert.ok(result.originCandidates.includes(originId), `${originId}:${scenarioId}:${entry.ref}`);
        assert.ok(WAKEFLOW_LEGACY_CLASSIFIER_ACTIONS.includes(result.defaultDisposition.action));
        classifiedFiles += 1;
      }
    }
  }

  assert.ok(classifiedFiles > 6_900);
});

test("declared JSON, path, and surface slots vary without weakening non-slot bytes", () => {
  const { originId, origin } = currentOrigin("codex");
  const ref = "WakeflowFixture/.wakeflow-local/wakeflow-delivery/hosts/codex/window-config/ProductWindow.json";
  const fixture = staticFixture(originId, "shared-setup", ref).toString("utf8");
  const varied = Buffer.from(fixture
    .replaceAll("ProductWindow", "Application")
    .replaceAll("ProductWorkspace", "ApplicationRepo")
    .replaceAll("@wakeflow-fixture-root/ApplicationRepo", "/srv/example/ApplicationRepo")
    .replace("@wakeflow-fixture-iso-time", "2026-08-10T09:10:11.012Z"), "utf8");
  const descriptor = legacyClassifierFixtureSourceDescriptor({
    owner: "shared-setup",
    ref,
    rootFamily: origin.rootFamily,
    scenarioCategory: null,
  });
  const result = classifyWakeflowLegacySource({
    ...descriptor,
    relativePath: descriptor.relativePath.replace("ProductWindow.json", "Application.json"),
    sourceBytes: varied,
  });

  assert.equal(result.confidence, "typed-known");
  assert.match(result.canonicalClassifierDigest, SHA256_PATTERN);
  assert.notEqual(result.rawDigest, sha256(Buffer.from(fixture)));
  assert.ok(result.typedSlots.some((slot) => slot.type === "window-name"));
  assert.ok(result.typedSlots.some((slot) => slot.type === "absolute-path"));
  assert.ok(result.typedSlots.some((slot) => slot.type === "iso-time"));
  assert.equal(JSON.stringify(result).includes("/srv/example"), false);

  const rootMemory = staticFixture(originId, "shared-setup", "AGENTS.md").toString("utf8");
  const variedMemory = classifyWakeflowLegacySource({
    ...legacyClassifierFixtureSourceDescriptor({
      owner: "shared-setup",
      ref: "AGENTS.md",
      rootFamily: origin.rootFamily,
      scenarioCategory: null,
    }),
    sourceBytes: Buffer.from(rootMemory.replaceAll("WakeflowFixture", "ApplicationFlow")),
  });
  assert.equal(variedMemory.confidence, "component-known");
  assert.ok(variedMemory.typedSlots.some((slot) => slot.type === "workspace-name"));

  for (const poisoned of [
    fixture.replace("@wakeflow-fixture-root/ProductWorkspace", "/srv/example/../escaped"),
    fixture.replace("@wakeflow-fixture-iso-time", "2026-02-30T25:61:61.999Z"),
  ]) {
    const poisonedResult = classifyWakeflowLegacySource({
      ...descriptor,
      sourceBytes: Buffer.from(poisoned),
    });
    assert.equal(poisonedResult.confidence, "unknown");
    assert.ok(poisonedResult.blockerCodes.includes("legacy-source-modified"));
  }

  const sharedProjection = classifyFixture({
    bytes: staticFixture(originId, "shared-setup", "WakeflowFixture/.wakeflow-active/current/global-todo-board.md"),
    origin,
    owner: "shared-setup",
    ref: "WakeflowFixture/.wakeflow-active/current/global-todo-board.md",
  });
  assert.ok(sharedProjection.originCandidates.length > 1);
  assert.deepEqual(sharedProjection.originCandidates, [...sharedProjection.originCandidates].sort());
  assert.equal(Object.hasOwn(sharedProjection, "selectedOrigin"), false);

  const modified = classifyWakeflowLegacySource({
    ...descriptor,
    sourceBytes: Buffer.from(fixture.replace("Project repository; confirm scope and responsibility before enabling.", "user changed responsibility")),
  });
  assert.equal(modified.confidence, "unknown");
  assert.equal(modified.defaultDisposition.action, "manual");
  assert.ok(modified.blockerCodes.includes("legacy-source-modified"));
});

test("flat and v2 config use a closed field classifier rather than one fixture digest", () => {
  const flat = Buffer.from(`${JSON.stringify({
    workspaceName: "Example",
    controllerWindow: "Control",
    interfaceLanguage: "zh",
    designWindow: "UX",
    testWindow: "QA",
    realProjectWindow: "",
    baseWindow: "",
    workspaceRoot: "..",
    wakeflowRepoDir: "Controller",
    activeLedgerRoot: ".wakeflow-active",
    projectLedgerRoot: "../ledger",
    windowLedgerRoot: "../ledger",
    windowLedgerDirs: {},
    repositories: [
      { windowName: "App", path: "../app", role: "product", managedAgents: true, mode: "external" },
      { windowName: "UX", path: "UX", role: "design", managedAgents: false, mode: "internal" },
      { windowName: "QA", path: "QA", role: "test", managedAgents: false, mode: "internal" },
    ],
  }, null, 2)}\n`);
  const base = {
    surfaceKind: "controller",
    relativePath: "wakeflow.config.json",
    ownership: "wakeflow-managed",
    gitIgnoreRoot: "unknown",
  };
  const flatResult = classifyWakeflowLegacySource({ ...base, sourceBytes: flat });
  assert.equal(flatResult.confidence, "typed-known");
  assert.equal(flatResult.artifact.kind, "wakeflow-config-flat-v1");
  assert.equal(flatResult.defaultDisposition.action, "transform");
  assert.equal(flatResult.defaultDisposition.route, "schema-map");

  const flatValue = JSON.parse(flat);
  const variedFlatValue = {
    ...flatValue,
    workspaceName: "ApplicationFlow",
    controllerWindow: "ControlPlane",
    repositories: flatValue.repositories.map((repository, index) => ({
      ...repository,
      path: `../repository-${index}`,
      windowName: `Window-${index}`,
    })),
  };
  const variedFlat = classifyWakeflowLegacySource({
    ...base,
    sourceBytes: Buffer.from(`${JSON.stringify(variedFlatValue, null, 2)}\n`),
  });
  assert.equal(variedFlat.confidence, "typed-known");
  assert.equal(variedFlat.canonicalClassifierDigest, flatResult.canonicalClassifierDigest);

  const reorderedFlat = classifyWakeflowLegacySource({
    ...base,
    sourceBytes: Buffer.from(`${JSON.stringify({
      ...variedFlatValue,
      repositories: [...variedFlatValue.repositories].reverse(),
    }, null, 2)}\n`),
  });
  assert.equal(reorderedFlat.confidence, "typed-known");
  assert.notEqual(reorderedFlat.canonicalClassifierDigest, variedFlat.canonicalClassifierDigest);

  const unknown = classifyWakeflowLegacySource({
    ...base,
    sourceBytes: Buffer.from(`${JSON.stringify({ ...flatValue, surprise: true })}\n`),
  });
  assert.equal(unknown.confidence, "unknown");
  assert.equal(unknown.defaultDisposition.action, "manual");
  assert.ok(unknown.blockerCodes.includes("legacy-config-unknown-field"));

  for (const invalidFields of [
    { $schema: 42 },
    { allowMissingRepos: "yes" },
    { configMigrationWarnings: {} },
    { maxActiveDemands: "many" },
    { preservedRetentionDays: 1.5 },
    { workspaceArchiveDir: [] },
  ]) {
    const invalidFieldResult = classifyWakeflowLegacySource({
      ...base,
      sourceBytes: Buffer.from(`${JSON.stringify({ ...flatValue, ...invalidFields })}\n`),
    });
    assert.equal(invalidFieldResult.confidence, "unknown", JSON.stringify(invalidFields));
    assert.ok(invalidFieldResult.blockerCodes.includes("legacy-config-invalid-type"));
  }

  const current = currentOrigin("codex");
  const nestedValue = JSON.parse(staticFixture(
    current.originId,
    "shared-setup",
    "WakeflowFixture/wakeflow.config.json",
  ));
  for (const mutate of [
    (value) => { value.roles.base = {}; },
    (value) => { value.storage.windowLedgerRoot = 7; },
    (value) => { value.policy = { preservedRetentionDays: 1.5 }; },
  ]) {
    const invalidNested = structuredClone(nestedValue);
    mutate(invalidNested);
    const invalidNestedResult = classifyWakeflowLegacySource({
      ...base,
      sourceBytes: Buffer.from(`${JSON.stringify(invalidNested)}\n`),
    });
    assert.equal(invalidNestedResult.confidence, "unknown");
    assert.ok(invalidNestedResult.blockerCodes.includes("legacy-config-invalid-type"));
  }

  const future = classifyWakeflowLegacySource({
    ...base,
    sourceBytes: Buffer.from('{"schemaVersion":99}\n'),
  });
  assert.equal(future.confidence, "unknown");
  assert.ok(future.blockerCodes.includes("legacy-config-future-schema"));

  const localWithoutDerived = classifyWakeflowLegacySource({
    ...base,
    relativePath: ".wakeflow-local/wakeflow.config.json",
    sourceBytes: flat,
  });
  assert.equal(localWithoutDerived.defaultDisposition.action, "manual");
  assert.ok(localWithoutDerived.blockerCodes.includes("legacy-local-config-unmanaged"));
});

test("representative static sources retain their exact D39 action and bounded route", () => {
  const { originId, origin } = currentOrigin("codex");
  for (const expected of [
    {
      action: "remove",
      ref: "WakeflowFixture/.wakeflow-active/current/index.md",
      route: "remove-exact",
    },
    {
      action: "transform",
      ref: "WakeflowFixture/wakeflow-ledger/workspace/workspace-record-map.md",
      route: "rebuild-derived",
    },
    {
      action: "remove",
      ref: "WakeflowFixture/wakeflow-ledger/workspace/todo-window-scheduling-policy.md",
      route: "remove-exact",
    },
    {
      action: "remove",
      ref: "WakeflowFixture/Design/docs/index.md",
      route: "remove-exact",
    },
  ]) {
    const result = classifyFixture({
      bytes: staticFixture(originId, "shared-setup", expected.ref),
      origin,
      owner: "shared-setup",
      ref: expected.ref,
    });
    assert.equal(result.defaultDisposition.action, expected.action, expected.ref);
    assert.equal(result.defaultDisposition.route, expected.route, expected.ref);
  }
});

test("mixed-owned memory, ignore, and Claude settings classify only their Wakeflow components", () => {
  const { originId, origin } = currentOrigin("codex");
  const rootMemory = staticFixture(originId, "shared-setup", "AGENTS.md").toString("utf8");
  const memory = classifyWakeflowLegacySource({
    surfaceKind: "workspace-parent",
    relativePath: "AGENTS.md",
    ownership: "owner-managed",
    gitIgnoreRoot: "unknown",
    sourceBytes: Buffer.from(`# User preface\n\n${rootMemory}\n# User suffix\n`),
  });
  assert.equal(memory.confidence, "component-known");
  assert.ok(memory.components.some((component) => component.componentKind === "wakeflow-memory-block" && component.action === "transform"));
  assert.ok(memory.components.some((component) => component.componentKind === "user-remainder" && component.action === "keep"));
  assert.ok(memory.originCandidates.includes(originId));

  const duplicate = classifyWakeflowLegacySource({
    surfaceKind: "workspace-parent",
    relativePath: "AGENTS.md",
    ownership: "owner-managed",
    gitIgnoreRoot: "unknown",
    sourceBytes: Buffer.from(`${rootMemory}\n${rootMemory}`),
  });
  assert.equal(duplicate.defaultDisposition.action, "manual");
  assert.ok(duplicate.blockerCodes.includes("legacy-managed-marker-conflict"));

  const conflictingRemainder = classifyWakeflowLegacySource({
    surfaceKind: "workspace-parent",
    relativePath: "AGENTS.md",
    ownership: "owner-managed",
    gitIgnoreRoot: "unknown",
    sourceBytes: Buffer.from(`${rootMemory}\n<!-- wakeflow:custom:start -->\nuser content\n`),
  });
  assert.equal(conflictingRemainder.defaultDisposition.action, "manual");
  assert.ok(conflictingRemainder.blockerCodes.includes("legacy-managed-marker-conflict"));

  const wakeflowIgnoreBlock = "# Wakeflow runtime state\n.wakeflow-active/\n.wakeflow-local/\n";
  const ignore = classifyWakeflowLegacySource({
    surfaceKind: "controller",
    relativePath: ".gitignore",
    ownership: "wakeflow-managed",
    gitIgnoreRoot: true,
    sourceBytes: Buffer.from(`user-cache/\n${wakeflowIgnoreBlock}`),
  });
  assert.equal(ignore.confidence, "component-known");
  assert.ok(ignore.components.some((component) => component.componentKind === "wakeflow-ignore-entries"));
  assert.ok(ignore.components.some((component) => component.componentKind === "user-remainder"));

  const anotherGeneratedIgnoreBlock = readWakeflowLegacyClassifierCatalog().entries
    .filter((entry) => (
      entry.surfaceKind === "controller"
      && entry.classifierMode === "gitignore-components"
      && entry.pathTemplate === ".gitignore"
    ))
    .map((entry) => Buffer.from(entry.contentTemplateBase64, "base64").toString("utf8"))
    .find((template) => template !== wakeflowIgnoreBlock && !template.includes(wakeflowIgnoreBlock));
  assert.ok(anotherGeneratedIgnoreBlock);
  const competingIgnoreComponents = classifyWakeflowLegacySource({
    surfaceKind: "controller",
    relativePath: ".gitignore",
    ownership: "wakeflow-managed",
    gitIgnoreRoot: true,
    sourceBytes: Buffer.from(`${wakeflowIgnoreBlock}${anotherGeneratedIgnoreBlock}`),
  });
  assert.equal(competingIgnoreComponents.defaultDisposition.action, "manual");
  assert.ok(competingIgnoreComponents.blockerCodes.includes("legacy-ignore-component-conflict"));

  const duplicateIgnore = classifyWakeflowLegacySource({
    surfaceKind: "controller",
    relativePath: ".gitignore",
    ownership: "wakeflow-managed",
    gitIgnoreRoot: true,
    sourceBytes: Buffer.from(`${wakeflowIgnoreBlock}${wakeflowIgnoreBlock}`),
  });
  assert.equal(duplicateIgnore.defaultDisposition.action, "manual");
  assert.ok(duplicateIgnore.blockerCodes.includes("legacy-ignore-component-conflict"));

  const negatedIgnore = classifyWakeflowLegacySource({
    surfaceKind: "controller",
    relativePath: ".gitignore",
    ownership: "wakeflow-managed",
    gitIgnoreRoot: true,
    sourceBytes: Buffer.from(`${wakeflowIgnoreBlock}!.wakeflow-local/\n`),
  });
  assert.equal(negatedIgnore.defaultDisposition.action, "manual");
  assert.ok(negatedIgnore.blockerCodes.includes("legacy-ignore-rule-conflict"));

  const claude = currentOrigin("claude-code");
  const settings = JSON.parse(staticFixture(
    claude.originId,
    "host-activation",
    "WakeflowFixture/.claude/settings.json",
  ));
  settings.userPreference = { theme: "dark" };
  const classifiedSettings = classifyWakeflowLegacySource({
    surfaceKind: "controller",
    relativePath: ".claude/settings.json",
    ownership: "wakeflow-managed",
    gitIgnoreRoot: "unknown",
    sourceBytes: Buffer.from(`${JSON.stringify(settings, null, 2)}\n`),
  });
  assert.equal(classifiedSettings.confidence, "component-known");
  assert.ok(classifiedSettings.components.some((component) => component.componentKind === "claude-permission-entry"));
  const settingsRemainder = classifiedSettings.components.find((component) => component.componentKind === "user-remainder");
  assert.equal(
    settingsRemainder.rawDigest,
    sha256(Buffer.from(canonicalJson({ userPreference: { theme: "dark" } }))),
  );
  assert.equal(new Set(classifiedSettings.components.map(({ selector }) => selector)).size, classifiedSettings.components.length);

  const exactManagedSettings = classifyWakeflowLegacySource({
    surfaceKind: "controller",
    relativePath: ".claude/settings.json",
    ownership: "wakeflow-managed",
    gitIgnoreRoot: "unknown",
    sourceBytes: staticFixture(
      claude.originId,
      "host-activation",
      "WakeflowFixture/.claude/settings.json",
    ),
  });
  assert.equal(exactManagedSettings.components.some(({ componentKind }) => componentKind === "user-remainder"), false);

  const duplicateManagedPermission = structuredClone(settings);
  duplicateManagedPermission.permissions.allow.push(duplicateManagedPermission.permissions.allow[0]);
  const duplicatePermissionResult = classifyWakeflowLegacySource({
    surfaceKind: "controller",
    relativePath: ".claude/settings.json",
    ownership: "wakeflow-managed",
    gitIgnoreRoot: "unknown",
    sourceBytes: Buffer.from(`${JSON.stringify(duplicateManagedPermission, null, 2)}\n`),
  });
  assert.equal(duplicatePermissionResult.defaultDisposition.action, "manual");
  assert.ok(duplicatePermissionResult.blockerCodes.includes("legacy-settings-component-conflict"));

  const localSettings = JSON.parse(staticFixture(
    claude.originId,
    "host-activation",
    "WakeflowFixture/.claude/settings.local.json",
  ));
  const portableLegacyStatusLine = classifyWakeflowLegacySource({
    surfaceKind: "controller",
    relativePath: ".claude/settings.json",
    ownership: "wakeflow-managed",
    gitIgnoreRoot: "unknown",
    sourceBytes: Buffer.from(`${JSON.stringify({
      ...settings,
      statusLine: localSettings.statusLine,
    }, null, 2)}\n`),
  });
  assert.ok(portableLegacyStatusLine.components.some((component) => (
    component.selector === "statusLine"
    && component.action === "remove"
  )));
  assert.equal(
    portableLegacyStatusLine.components.find(({ componentKind }) => componentKind === "user-remainder").rawDigest,
    sha256(Buffer.from(canonicalJson({ userPreference: { theme: "dark" } }))),
  );
  assert.ok(portableLegacyStatusLine.typedSlots.some(({ type }) => type === "absolute-path"));

  const localWithUserKey = classifyWakeflowLegacySource({
    surfaceKind: "controller",
    relativePath: ".claude/settings.local.json",
    ownership: "wakeflow-managed",
    gitIgnoreRoot: "unknown",
    sourceBytes: Buffer.from(`${JSON.stringify({
      ...localSettings,
      userPreference: { compact: true },
    }, null, 2)}\n`),
  });
  assert.equal(
    localWithUserKey.components.find(({ componentKind }) => componentKind === "user-remainder").rawDigest,
    sha256(Buffer.from(canonicalJson({ userPreference: { compact: true } }))),
  );
  assert.ok(localWithUserKey.typedSlots.some(({ type }) => type === "absolute-path"));

  const designSettingsWithGrant = classifyWakeflowLegacySource({
    surfaceKind: "design-support",
    relativePath: ".claude/settings.json",
    ownership: "wakeflow-managed",
    gitIgnoreRoot: "unknown",
    sourceBytes: Buffer.from(`${JSON.stringify({
      permissions: {
        allow: [
          "Bash(git *)",
          "Bash(node *)",
          "Bash(tmux *)",
          "mcp__plugin_wakeflow_wakeflow",
        ],
        additionalDirectories: ["..", "./user-owned"],
      },
    }, null, 2)}\n`),
  });
  assert.ok(designSettingsWithGrant.components.some((component) => (
    component.componentKind === "claude-additional-directory-entry"
    && component.action === "remove"
  )));
  assert.equal(
    designSettingsWithGrant.components.find(({ componentKind }) => componentKind === "user-remainder").rawDigest,
    sha256(Buffer.from(canonicalJson({
      permissions: { additionalDirectories: ["./user-owned"] },
    }))),
  );

  settings.permissions.allow.push("mcp__plugin_wakeflow_unowned");
  const conflictingSettings = classifyWakeflowLegacySource({
    surfaceKind: "controller",
    relativePath: ".claude/settings.json",
    ownership: "wakeflow-managed",
    gitIgnoreRoot: "unknown",
    sourceBytes: Buffer.from(`${JSON.stringify(settings, null, 2)}\n`),
  });
  assert.equal(conflictingSettings.defaultDisposition.action, "manual");
  assert.ok(conflictingSettings.blockerCodes.includes("legacy-settings-component-conflict"));
});

test("known old-root material stays manual and lifecycle-shaped sources never claim terminal authority", () => {
  const old = readdirSync(fixturesRoot)
    .map((originId) => ({ originId, origin: originId === "source-map.json" ? null : readOrigin(originId) }))
    .find(({ origin }) => origin?.rootFamily === "old-root-flat" && origin.source.host === "codex");
  const configEntry = old.origin.staticLayers
    .flatMap((layer) => layer.expectedEntries.map((entry) => ({ ...entry, layerId: layer.layerId, owner: layer.owner })))
    .find((entry) => entry.path.endsWith("/workspace.config.json"));
  const oldConfig = classifyFixture({
    bytes: staticFixture(old.originId, configEntry.layerId, configEntry.path),
    origin: old.origin,
    owner: configEntry.owner,
    ref: configEntry.path,
  });
  assert.notEqual(oldConfig.confidence, "unknown");
  assert.equal(oldConfig.defaultDisposition.action, "manual");
  assert.ok(oldConfig.blockerCodes.includes("legacy-old-root-unsupported"));

  const current = currentOrigin("codex");
  const scenario = JSON.parse(readFileSync(path.join(
    fixturesRoot,
    current.originId,
    "scenarios/transport-result-reviewed/scenario.json",
  )));
  const groupRef = scenario.outputManifest.files.find((entry) => entry.ref.includes("/dispatch-groups/")).ref;
  const group = classifyFixture({
    bytes: scenarioFixture(current.originId, "transport-result-reviewed", groupRef),
    origin: current.origin,
    owner: scenario.materializationMode,
    ref: groupRef,
    scenario,
  });
  assert.equal(group.defaultDisposition.action, "transform");
  assert.equal(group.defaultDisposition.route, "archive-wrap");
  assert.ok(group.defaultDisposition.prerequisites.includes("legacy-owner-drain"));
  assert.ok(group.defaultDisposition.prerequisites.includes("domain-chain-correlation"));
  assert.equal(group.lifecycleConclusion, "unresolved");
});

test("sensitive slots are digest-only and all classifier output is deterministic and deeply frozen", () => {
  const current = currentOrigin("codex");
  const scenario = JSON.parse(readFileSync(path.join(
    fixturesRoot,
    current.originId,
    "scenarios/identity-registered/scenario.json",
  )));
  const ref = scenario.outputManifest.files.find((entry) => entry.ref.includes("/thread-registry/")).ref;
  const fixture = scenarioFixture(current.originId, "identity-registered", ref).toString("utf8");
  const secret = "thread_private_1234567890";
  const bytes = Buffer.from(fixture.replace(/@wakeflow-scenario-thread-id-[a-f0-9]+/u, secret));
  const first = classifyFixture({
    bytes,
    origin: current.origin,
    owner: scenario.materializationMode,
    ref,
    scenario,
  });
  const second = classifyFixture({
    bytes,
    origin: current.origin,
    owner: scenario.materializationMode,
    ref,
    scenario,
  });

  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(first).includes(secret), false);
  assert.ok(first.typedSlots.some((slot) => slot.type === "host-handle" && slot.sensitivity === "secret"));
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.typedSlots), true);
  assert.equal(Object.isFrozen(first.typedSlots[0]), true);
});

test("invalid request shape, invalid UTF-8, invalid JSON, and unknown paths fail closed", () => {
  const base = {
    surfaceKind: "controller",
    relativePath: "wakeflow.config.json",
    ownership: "wakeflow-managed",
    gitIgnoreRoot: "unknown",
  };
  assert.throws(
    () => classifyWakeflowLegacySource({ ...base, sourceBytes: Buffer.from("{}"), mtime: 1 }),
    (error) => error.code === "wakeflow-legacy-classifier-input-shape",
  );
  const invalidUtf8 = classifyWakeflowLegacySource({
    ...base,
    sourceBytes: Buffer.from([0xc3, 0x28]),
  });
  assert.equal(invalidUtf8.defaultDisposition.action, "manual");
  assert.ok(invalidUtf8.blockerCodes.includes("legacy-source-invalid-utf8"));

  const invalidJson = classifyWakeflowLegacySource({
    ...base,
    sourceBytes: Buffer.from("{not-json}\n"),
  });
  assert.equal(invalidJson.defaultDisposition.action, "manual");
  assert.ok(invalidJson.blockerCodes.includes("legacy-source-invalid-json"));

  const unknownPath = classifyWakeflowLegacySource({
    ...base,
    relativePath: ".wakeflow-local/unknown.bin",
    sourceBytes: Buffer.from("opaque"),
  });
  assert.equal(unknownPath.confidence, "unknown");
  assert.equal(unknownPath.defaultDisposition.action, "manual");
  assert.ok(unknownPath.blockerCodes.includes("legacy-source-unknown"));
});
