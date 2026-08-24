import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  WAKEFLOW_LEGACY_ORIGIN_GENERATION_COMMAND,
  WAKEFLOW_LEGACY_ORIGIN_SYNTHETIC_TOPOLOGY,
  buildWakeflowLegacyOriginFixture,
  inspectWakeflowLegacyOriginFixtureDirectory,
  inspectWakeflowLegacyOriginSourceMap,
  summarizeWakeflowLegacyOriginFixture,
  validateWakeflowLegacyOriginFixture,
  writeWakeflowLegacyOriginFixture,
} from "../tools/lib/wakeflow-legacy-origin-fixtures.mjs";
import { loadWakeflowHistoricalArtifactIdentity } from "./support/wakeflow-historical-artifact.mjs";

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const cli = path.join(repositoryRoot, "tools/build-legacy-origin-fixtures.mjs");

function makeArtifact(root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-legacy-artifact-"))) {
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  mkdirSync(path.join(root, "templates"), { recursive: true });
  writeFileSync(path.join(root, "package.json"), "{\"name\":\"wakeflow\",\"version\":\"0.9.6\"}\n");
  writeFileSync(path.join(root, "scripts/wakeflow-setup.mjs"), "export const setup = true;\n");
  writeFileSync(path.join(root, "templates/wakeflow-template-bundle.json"), "{\"version\":1,\"files\":{}}\n");
  chmodSync(path.join(root, "scripts/wakeflow-setup.mjs"), 0o755);
  return root;
}

function makeStaticPair() {
  const parent = mkdtempSync(path.join(os.tmpdir(), "wakeflow-legacy-static-"));
  const beforeRoot = path.join(parent, "before");
  const afterRoot = path.join(parent, "after");
  for (const root of [beforeRoot, afterRoot]) {
    mkdirSync(path.join(root, "ProductWorkspace"), { recursive: true });
    writeFileSync(path.join(root, "unchanged.txt"), "preserve\n");
  }
  writeFileSync(path.join(beforeRoot, ".gitignore"), "user-entry\n");
  writeFileSync(path.join(afterRoot, ".gitignore"), "user-entry\n.wakeflow-local/\n");
  mkdirSync(path.join(afterRoot, "WakeflowFixture/.wakeflow-local"), { recursive: true });
  mkdirSync(path.join(afterRoot, "WakeflowFixture/Design/empty"), { recursive: true });
  writeFileSync(path.join(afterRoot, "ProductWorkspace/AGENTS.md"), "# Synthetic product window\n");
  writeFileSync(path.join(afterRoot, "WakeflowFixture/wakeflow.config.json"), "{\"schemaVersion\":2}\n");
  writeFileSync(path.join(afterRoot, "WakeflowFixture/.wakeflow-local/state.json"), "{\"status\":\"idle\"}\n");
  writeFileSync(path.join(afterRoot, "WakeflowFixture/.wakeflow-local/window.json"), `${JSON.stringify({
    cwd: path.join(afterRoot, "WakeflowFixture/Design"),
    generatedAt: "2026-08-10T01:02:03.004Z",
    statusLine: {
      command: `node "${path.join(afterRoot, "WakeflowFixture/.wakeflow-local/wakeflow-statusline.mjs")}"`,
      type: "command",
    },
  }, null, 2)}\n`);
  return { afterRoot, beforeRoot };
}

function validRequest(overrides = {}) {
  const artifactRoot = makeArtifact();
  const { afterRoot, beforeRoot } = makeStaticPair();
  return {
    schemaVersion: 1,
    originId: "codex-0.9.6-aaaaaaaa",
    rootFamily: "current-root-v2",
    source: {
      artifactVersion: "0.9.6",
      commit: "a".repeat(40),
      host: "codex",
      packageIntegrity: null,
    },
    artifactRoot,
    entrypoints: [
      { ref: "scripts/wakeflow-setup.mjs", role: "setup" },
      { ref: "templates/wakeflow-template-bundle.json", role: "template-bundle" },
    ],
    layers: [
      { afterRoot, beforeRoot, layerId: "shared-setup", owner: "shared-setup" },
    ],
    ...overrides,
  };
}

test("origin builder captures exact artifact provenance and only the generated static delta", () => {
  const request = validRequest();
  const candidate = buildWakeflowLegacyOriginFixture(request);
  const validated = validateWakeflowLegacyOriginFixture(candidate.origin);

  assert.deepEqual(validated, candidate.origin);
  assert.equal(candidate.origin.source.commit, "a".repeat(40));
  assert.equal(candidate.origin.source.artifactVersion, "0.9.6");
  assert.equal(candidate.origin.source.host, "codex");
  assert.match(candidate.origin.source.artifactDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(candidate.origin.source.sourceManifest.closurePolicy, "complete-artifact-tree-conservative");
  assert.equal(candidate.origin.source.sourceManifest.digest, candidate.origin.source.artifactDigest);
  assert.deepEqual(candidate.origin.generation.commandTemplate, WAKEFLOW_LEGACY_ORIGIN_GENERATION_COMMAND);
  assert.deepEqual(candidate.origin.generation.topology, WAKEFLOW_LEGACY_ORIGIN_SYNTHETIC_TOPOLOGY);
  assert.equal(candidate.origin.eligibility, "conditional-auto");
  assert.deepEqual(candidate.origin.scenarios, []);

  const [layer] = candidate.origin.staticLayers;
  assert.equal(layer.layerId, "shared-setup");
  assert.equal(layer.expectedEntries.some((entry) => entry.path === "unchanged.txt"), false);
  assert.equal(layer.expectedEntries.some((entry) => entry.path === "ProductWorkspace"), false);
  assert.equal(layer.expectedEntries.some((entry) => entry.path === "WakeflowFixture/Design/empty" && entry.afterType === "directory"), true);
  assert.equal(layer.expectedEntries.some((entry) => entry.path === ".gitignore" && entry.operation === "replace"), true);
  assert.equal(layer.expectedEntries.some((entry) => entry.path === "ProductWorkspace/AGENTS.md" && entry.owner === "shared-setup"), true);
  const normalizedWindow = layer.expectedEntries.find((entry) => entry.path === "WakeflowFixture/.wakeflow-local/window.json");
  assert.deepEqual(normalizedWindow.normalizations, [
    { kind: "json-root-path", pointer: "$/cwd", token: "fixture-workspace-root" },
    { kind: "json-iso-time", pointer: "$/generatedAt", token: "fixture-iso-time" },
    { kind: "json-statusline-command", pointer: "$/statusLine/command", token: "fixture-workspace-root" },
  ]);

  const outputRefs = candidate.files.map((file) => file.ref);
  assert.equal(outputRefs.includes("origin.json"), true);
  assert.equal(outputRefs.includes("static/shared-setup/unchanged.txt"), false);
  assert.equal(outputRefs.includes("static/shared-setup/ProductWorkspace/AGENTS.md"), true);
  assert.equal(outputRefs.includes("static/shared-setup/WakeflowFixture/Design/empty"), false);
  const normalizedOutput = candidate.files.find((file) => file.ref.endsWith("/window.json"));
  const normalizedText = Buffer.from(normalizedOutput.contentBase64, "base64").toString("utf8");
  assert.match(normalizedText, /@wakeflow-fixture-root\/WakeflowFixture\/Design/u);
  assert.match(normalizedText, /@wakeflow-fixture-iso-time/u);
  assert.equal(Object.isFrozen(candidate), true);
  assert.equal(Object.isFrozen(candidate.origin), true);
  assert.equal(Object.isFrozen(candidate.origin.source.artifactManifest.files), true);
  assert.equal(JSON.stringify(candidate).includes(request.artifactRoot), false);
  assert.equal(JSON.stringify(candidate).includes(request.layers[0].afterRoot), false);
  assert.equal(JSON.stringify(candidate).includes(request.layers[0].beforeRoot), false);
});

test("same explicit bytes at different local roots produce byte-identical fixture candidates", () => {
  const firstRequest = validRequest();
  const secondArtifact = makeArtifact();
  const secondPair = makeStaticPair();
  const secondRequest = {
    ...firstRequest,
    artifactRoot: secondArtifact,
    layers: [{
      ...firstRequest.layers[0],
      afterRoot: secondPair.afterRoot,
      beforeRoot: secondPair.beforeRoot,
    }],
  };
  const first = buildWakeflowLegacyOriginFixture(firstRequest);
  const second = buildWakeflowLegacyOriginFixture(secondRequest);
  assert.deepEqual(second, first);
});

test("origin builder is closed and rejects unknown fields, missing entry roles, symlinks, and private-path residue", () => {
  const request = validRequest();
  assert.throws(
    () => buildWakeflowLegacyOriginFixture({ ...request, unknown: true }),
    (error) => error.code === "wakeflow-legacy-origin-request-shape",
  );
  assert.throws(
    () => buildWakeflowLegacyOriginFixture({
      ...request,
      entrypoints: request.entrypoints.filter((entry) => entry.role !== "template-bundle"),
    }),
    (error) => error.code === "wakeflow-legacy-origin-entrypoint",
  );

  const symlinkRequest = validRequest();
  symlinkSync(
    path.join(symlinkRequest.layers[0].afterRoot, "unchanged.txt"),
    path.join(symlinkRequest.layers[0].afterRoot, "linked.txt"),
  );
  assert.throws(
    () => buildWakeflowLegacyOriginFixture(symlinkRequest),
    (error) => error.code === "wakeflow-legacy-origin-tree-symlink",
  );

  const hardlinkRequest = validRequest();
  const linkedFile = path.join(hardlinkRequest.layers[0].afterRoot, "unchanged.txt");
  unlinkSync(linkedFile);
  linkSync(path.join(hardlinkRequest.layers[0].beforeRoot, "unchanged.txt"), linkedFile);
  assert.throws(
    () => buildWakeflowLegacyOriginFixture(hardlinkRequest),
    (error) => error.code === "wakeflow-legacy-origin-tree-special-node",
  );

  const privateRequest = validRequest();
  writeFileSync(
    path.join(privateRequest.layers[0].afterRoot, "WakeflowFixture/private.txt"),
    `artifact=${privateRequest.artifactRoot}\n`,
  );
  assert.throws(
    () => buildWakeflowLegacyOriginFixture(privateRequest),
    (error) => error.code === "wakeflow-legacy-origin-privacy",
  );
});

test("old-root provenance is always manual regardless of artifact version", () => {
  const request = validRequest({ rootFamily: "old-root-flat" });
  const candidate = buildWakeflowLegacyOriginFixture(request);
  assert.equal(candidate.origin.eligibility, "manual");
});

test("source-maintenance writer is create-once, exact-replay idempotent, and conflict-safe", () => {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-legacy-fixture-repo-"));
  writeFileSync(path.join(repoRoot, "package.json"), "{\"name\":\"wakeflow-repo\",\"private\":true}\n");
  const candidate = buildWakeflowLegacyOriginFixture(validRequest());

  const first = writeWakeflowLegacyOriginFixture({ candidate, repoRoot });
  assert.equal(first.status, "created");
  assert.equal(first.relativeRoot, "test/fixtures/legacy-origins/codex-0.9.6-aaaaaaaa");
  assert.equal(existsSync(path.join(repoRoot, first.relativeRoot, "origin.json")), true);
  assert.equal(
    readFileSync(path.join(repoRoot, first.relativeRoot, "static/shared-setup/ProductWorkspace/AGENTS.md"), "utf8"),
    "# Synthetic product window\n",
  );

  const replay = writeWakeflowLegacyOriginFixture({ candidate, repoRoot });
  assert.equal(replay.status, "unchanged");
  writeFileSync(path.join(repoRoot, first.relativeRoot, "origin.json"), "{}\n");
  assert.throws(
    () => writeWakeflowLegacyOriginFixture({ candidate, repoRoot }),
    (error) => error.code === "wakeflow-legacy-origin-write-conflict",
  );

  const linkedRepoRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-legacy-linked-repo-"));
  const outside = mkdtempSync(path.join(os.tmpdir(), "wakeflow-legacy-outside-"));
  writeFileSync(path.join(linkedRepoRoot, "package.json"), "{\"name\":\"wakeflow-repo\",\"private\":true}\n");
  symlinkSync(outside, path.join(linkedRepoRoot, "test"));
  assert.throws(
    () => writeWakeflowLegacyOriginFixture({ candidate, repoRoot: linkedRepoRoot }),
    (error) => error.code === "wakeflow-legacy-origin-write-boundary",
  );
  assert.equal(existsSync(path.join(outside, "fixtures")), false);
  assert.deepEqual(readFileSync(path.join(linkedRepoRoot, "package.json"), "utf8"), "{\"name\":\"wakeflow-repo\",\"private\":true}\n");
});

test("CLI defaults to preview, accepts request only on stdin, and emits no private roots", () => {
  const request = validRequest();
  const before = existsSync(path.join(repositoryRoot, "test/fixtures/legacy-origins", request.originId));
  const result = spawnSync(process.execPath, [cli, "--json"], {
    cwd: mkdtempSync(path.join(os.tmpdir(), "wakeflow-legacy-cli-cwd-")),
    encoding: "utf8",
    input: JSON.stringify(request),
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload, summarizeWakeflowLegacyOriginFixture(buildWakeflowLegacyOriginFixture(request), {
    mode: "preview",
    writeResult: null,
  }));
  assert.equal(result.stdout.includes(request.artifactRoot), false);
  assert.equal(result.stdout.includes(request.layers[0].beforeRoot), false);
  assert.equal(result.stdout.includes(request.layers[0].afterRoot), false);
  assert.equal(existsSync(path.join(repositoryRoot, "test/fixtures/legacy-origins", request.originId)), before);

  const rejectedArgv = spawnSync(process.execPath, [cli, "--json", "--artifact-root", request.artifactRoot], {
    encoding: "utf8",
    input: JSON.stringify(request),
  });
  assert.notEqual(rejectedArgv.status, 0);
  assert.equal(rejectedArgv.stdout.includes(request.artifactRoot), false);
  assert.equal(rejectedArgv.stderr.includes(request.artifactRoot), false);

  const oversized = spawnSync(process.execPath, [cli, "--json"], {
    encoding: "utf8",
    input: Buffer.alloc((8 * 1024 * 1024) + 1, 0x20),
  });
  assert.notEqual(oversized.status, 0);
  assert.equal(JSON.parse(oversized.stdout).error.code, "wakeflow-legacy-origin-request-bytes");
});

test("checked-in release-origin fixture is self-contained and validates without Git, cache, network, or historical artifact access", () => {
  const fixtureRoot = path.join(
    repositoryRoot,
    "test/fixtures/legacy-origins/codex-0.9.6-b7be3ac9",
  );
  const inspected = inspectWakeflowLegacyOriginFixtureDirectory({ fixtureRoot });
  assert.equal(inspected.origin.originId, "codex-0.9.6-b7be3ac9");
  assert.equal(inspected.origin.source.commit, "b7be3ac9b4a7d5a01d825a3ec21271352c10a372");
  assert.equal(inspected.origin.source.host, "codex");
  assert.equal(inspected.origin.source.artifactVersion, "0.9.6");
  assert.equal(inspected.origin.source.artifactManifest.fileCount, 117);
  assert.equal(inspected.origin.staticLayers[0].fileCount, 72);
  assert.equal(inspected.fileCount, 73);
  assert.equal(inspected.fixtureDigest, "sha256:82fa332c1aa10ef9a8e9ff849a0272b9e05a96b8ea73a4b3a846b7885e68979e");
});

test("historical artifact identity accepts only one exact checked-in origin version", () => {
  const identity = loadWakeflowHistoricalArtifactIdentity({ host: "codex" });
  assert.match(identity.artifactDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.throws(
    () => loadWakeflowHistoricalArtifactIdentity({
      host: "codex",
      originVersion: "../../outside",
    }),
    /originVersion must be an exact version/u,
  );
});

test("checked-in source map distinguishes and materializes all 49 source boundaries and 97 host artifacts", () => {
  const fixturesRoot = path.join(repositoryRoot, "test/fixtures/legacy-origins");
  const inspected = inspectWakeflowLegacyOriginSourceMap({ fixturesRoot });
  assert.equal(inspected.sourceMap.audit.head, "70d79d720d65837a068993006f356e8de91215d4");
  assert.equal(inspected.sourceMap.counts.boundaries, 49);
  assert.deepEqual(inspected.sourceMap.counts.hostArtifactsByHost, { claudeCode: 48, codex: 49 });
  assert.equal(inspected.sourceMap.counts.hostArtifacts, 97);
  assert.deepEqual(inspected.sourceMap.counts.rootFamilies, {
    currentRootFlatCanonicalName: 27,
    currentRootFlatLegacyName: 13,
    currentRootV2: 2,
    oldRootFlat: 7,
  });
  assert.deepEqual(inspected.sourceMap.counts.currentRootDirectProducerCohortLowerBounds, {
    claudeCode: 26,
    codex: 16,
  });
  assert.equal(inspected.sourceMap.boundaries[0].artifactVersion, "0.1.2");
  assert.equal(inspected.sourceMap.boundaries[0].rootFamily, "old-root-flat");
  assert.equal(inspected.sourceMap.boundaries.at(-1).originKind, "head-snapshot");
  assert.equal(inspected.sourceMap.materializationPolicy, "one-fixture-per-available-host-artifact");
  assert.equal(inspected.materializedOriginIds.includes("claude-code-0.5.8-9564a798"), true);
  assert.equal(inspected.materializedOriginIds.includes("claude-code-0.9.6-b7be3ac9"), true);
  assert.equal(inspected.materializedOriginIds.includes("claude-code-0.9.6-70d79d72"), true);
  assert.equal(inspected.materializedOriginIds.includes("codex-0.1.2-58eb3bcf"), true);
  assert.equal(inspected.materializedOriginIds.includes("codex-0.9.6-b7be3ac9"), true);
  assert.equal(inspected.materializedOriginIds.includes("codex-0.9.6-70d79d72"), true);
  assert.deepEqual(inspected.pendingOriginIds, []);
  assert.equal(inspected.pendingHostArtifacts, 0);
  assert.equal(inspected.materializedHostArtifacts, 97);
  assert.deepEqual(inspected.cohortCounts, {
    all: { claudeCode: 48, codex: 49 },
    currentRoot: { claudeCode: 42, codex: 42 },
  });
  assert.equal(inspected.cohorts.length, 97);
  assert.equal(inspected.cohorts.every((cohort) => cohort.originIds.length === 1), true);
  assert.equal(Object.isFrozen(inspected.cohorts), true);
  assert.equal(Object.isFrozen(inspected.cohorts[0].originIds), true);
});
