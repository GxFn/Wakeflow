import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  inspectWakeflowArtifactTree,
} from "../core/scripts/lib/wakeflow-artifact-tree-identity.mjs";
import { canonicalJsonDigest } from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  assertWakeflowLegacyScenarioExecutionAllowed,
  buildWakeflowHistoricalSeedScenarioCandidate,
  buildWakeflowLegacyScenarioCandidate,
  listWakeflowLegacyScenarioDefinitions,
  resolveWakeflowLegacyScenarioDefinition,
  writeWakeflowLegacyScenarioCandidate,
} from "./helpers/wakeflow-legacy-scenario-builder.mjs";
import {
  inspectWakeflowLegacyOriginFixtureDirectory,
  validateWakeflowLegacyOriginFixture,
} from "../tools/lib/wakeflow-legacy-origin-fixtures.mjs";
import {
  createWakeflowLegacyScenarioManifest,
  inspectWakeflowLegacyScenarioFixtureDirectory,
  validateWakeflowLegacyScenarioAgainstOrigin,
  validateWakeflowLegacyScenarioManifest,
} from "../tools/lib/wakeflow-legacy-scenario-fixtures.mjs";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const originRoots = Object.freeze([
  Object.freeze({
    fixtureRoot: path.join(repoRoot, "test/fixtures/legacy-origins/codex-0.9.6-70d79d72"),
    host: "codex",
  }),
  Object.freeze({
    fixtureRoot: path.join(repoRoot, "test/fixtures/legacy-origins/claude-code-0.9.6-70d79d72"),
    host: "claude-code",
  }),
]);

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function readOrigin(root = originRoots[0].fixtureRoot) {
  return validateWakeflowLegacyOriginFixture(
    JSON.parse(readFileSync(path.join(root, "origin.json"), "utf8")),
  );
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function createdDeltaEntries(outputManifest) {
  const directories = new Set();
  for (const file of outputManifest.files) {
    const segments = file.ref.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join("/"));
    }
  }
  return [
    ...[...directories].map((entryPath) => ({
      afterBytes: null,
      afterDigest: null,
      afterExecutable: null,
      afterType: "directory",
      beforeBytes: null,
      beforeDigest: null,
      beforeExecutable: null,
      beforeType: null,
      operation: "create",
      path: entryPath,
    })),
    ...outputManifest.files.map((file) => ({
      afterBytes: file.bytes,
      afterDigest: file.digest,
      afterExecutable: file.executable,
      afterType: "file",
      beforeBytes: null,
      beforeDigest: null,
      beforeExecutable: null,
      beforeType: null,
      operation: "create",
      path: file.ref,
    })),
  ].sort((left, right) => left.path.localeCompare(right.path));
}

function makeOutputRoot({ privatePath = false } = {}) {
  const outputRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-legacy-scenario-output-"));
  writeJson(
    path.join(
      outputRoot,
      ".wakeflow-local/wakeflow-delivery/hosts/codex/thread-registry/ProductWindow.json",
    ),
    {
      kind: "CodexWindowThreadRegistration",
      threadId: privatePath ? "/Users/private-user/thread" : "@wakeflow-scenario-thread",
      version: 3,
      windowName: "ProductWindow",
    },
  );
  return outputRoot;
}

function realManifest(origin = readOrigin(), { outputRoot = makeOutputRoot() } = {}) {
  const source = origin.source.artifactManifest.files.find(
    (entry) => entry.ref === "scripts/wakeflow-delivery.mjs",
  );
  assert.ok(source);
  const outputManifest = inspectWakeflowArtifactTree({ artifactRoot: outputRoot }).manifest;
  return createWakeflowLegacyScenarioManifest({
    artifactKind: "wakeflow-legacy-lifecycle-scenario",
    beforeManifest: null,
    category: "identity",
    commandSequence: [{
      argv: [
        "node",
        "<artifact-root>/scripts/wakeflow-delivery.mjs",
        "register-thread",
        "--root",
        "<workspace-root>",
        "--window",
        "ProductWindow",
        "--thread-id",
        "<synthetic-thread-id>",
        "--write",
        "--json",
      ],
      stepId: "register-thread",
    }],
    deltaEntries: createdDeltaEntries(outputManifest),
    host: "codex",
    materializationMode: "real-writer",
    normalizations: [{
      kind: "json-pointer-token",
      ref: ".wakeflow-local/wakeflow-delivery/hosts/codex/thread-registry/ProductWindow.json",
      selector: "/threadId",
      token: "@wakeflow-scenario-thread",
    }],
    outputManifest,
    producer: {
      artifactDigest: origin.source.artifactDigest,
      sourceCommit: origin.source.commit,
      sourceFiles: [{ ...source, role: "delivery-writer" }],
    },
    scenarioId: "identity-registered",
    schemaVersion: 1,
  });
}

function writeScenarioDirectory({ manifest, outputRoot }) {
  const scenarioRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-legacy-scenario-"));
  cpSync(outputRoot, path.join(scenarioRoot, "output"), { recursive: true });
  writeJson(path.join(scenarioRoot, "scenario.json"), manifest);
  return scenarioRoot;
}

function writeCandidateDirectory(candidate) {
  const scenarioRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-scenario-candidate-"));
  for (const file of candidate.files) {
    const target = path.join(scenarioRoot, ...file.ref.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, Buffer.from(file.contentBase64, "base64"), {
      mode: file.executable ? 0o755 : 0o644,
    });
  }
  return scenarioRoot;
}

function candidateFromDirectory({ manifest, scenarioRoot }) {
  const inventory = inspectWakeflowArtifactTree({ artifactRoot: scenarioRoot });
  const files = inventory.manifest.files.map((entry) => ({
    ...entry,
    contentBase64: readFileSync(
      path.join(scenarioRoot, ...entry.ref.split("/")),
    ).toString("base64"),
  }));
  return {
    definition: resolveWakeflowLegacyScenarioDefinition({
      host: manifest.host,
      scenarioId: manifest.scenarioId,
    }),
    files,
    fixtureDigest: canonicalJsonDigest(files.map(({ bytes, digest, executable, ref }) => ({
      bytes,
      digest,
      executable,
      ref,
    }))),
    manifest,
  };
}

function copyOriginWithoutScenarios(prefix) {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), prefix));
  cpSync(originRoots[0].fixtureRoot, fixtureRoot, { recursive: true });
  rmSync(path.join(fixtureRoot, "scenarios"), { recursive: true, force: true });
  const origin = JSON.parse(readFileSync(path.join(fixtureRoot, "origin.json"), "utf8"));
  origin.scenarios = [];
  writeJson(path.join(fixtureRoot, "origin.json"), origin);
  return fixtureRoot;
}

test("real-writer provenance is retained while current source execution is retired", () => {
  const helperSource = readFileSync(
    path.join(repoRoot, "test/helpers/wakeflow-legacy-scenario-builder.mjs"),
    "utf8",
  );
  assert.doesNotMatch(helperSource, /node:child_process|\b(?:exec|spawn)(?:File)?Sync\s*\(/u);
  const definitions = listWakeflowLegacyScenarioDefinitions();
  assert.equal(Object.isFrozen(definitions), true);
  assert.deepEqual(
    definitions.map(({ scenarioId }) => scenarioId),
    [...definitions.map(({ scenarioId }) => scenarioId)].sort(),
  );
  const real = resolveWakeflowLegacyScenarioDefinition({
    host: "codex",
    scenarioId: "transport-result-reviewed",
  });
  assert.equal(real.materializationMode, "real-writer");
  assert.equal(real.executionPolicy, "historical-artifact-only");
  assert.throws(
    () => assertWakeflowLegacyScenarioExecutionAllowed({
      host: "codex",
      scenarioId: real.scenarioId,
    }),
    (error) => error.code === "wakeflow-legacy-scenario-writer-retired",
  );
  assert.throws(
    () => buildWakeflowLegacyScenarioCandidate({
      artifactRoot: path.join(repoRoot, "plugins/codex-wakeflow"),
      host: "codex",
      originSource: {},
      scenarioId: "identity-registered",
    }),
    (error) => error.code === "wakeflow-legacy-scenario-writer-retired",
  );

  const seed = resolveWakeflowLegacyScenarioDefinition({
    host: "codex",
    scenarioId: "stop-marker-historical",
  });
  assert.equal(seed.materializationMode, "historical-seed");
  assert.equal(seed.executionPolicy, "never-execute");
  assert.throws(
    () => assertWakeflowLegacyScenarioExecutionAllowed({
      host: "codex",
      scenarioId: seed.scenarioId,
    }),
    (error) => error.code === "wakeflow-legacy-scenario-historical-seed",
  );
});

test("checked-in real-writer scenarios remain exact self-contained historical evidence", () => {
  const definitions = listWakeflowLegacyScenarioDefinitions();
  for (const { fixtureRoot, host } of originRoots) {
    const inspectedOrigin = inspectWakeflowLegacyOriginFixtureDirectory({ fixtureRoot });
    const origin = inspectedOrigin.origin;
    const expected = definitions
      .filter(({ materializationMode, supportedHosts }) => (
        materializationMode === "real-writer" && supportedHosts.includes(host)
      ))
      .map(({ scenarioId }) => scenarioId)
      .sort();
    assert.deepEqual(
      origin.scenarios.map((ref) => ref.split("/")[0]).sort(),
      expected,
      `${host} fixture must retain every admitted real-writer provenance scenario`,
    );
    for (const scenarioRef of origin.scenarios) {
      const scenarioRoot = path.join(fixtureRoot, "scenarios", path.dirname(scenarioRef));
      const inspected = inspectWakeflowLegacyScenarioFixtureDirectory({ origin, scenarioRoot });
      const manifest = validateWakeflowLegacyScenarioAgainstOrigin({
        origin,
        scenario: inspected.manifest,
      });
      assert.equal(manifest.materializationMode, "real-writer");
      assert.ok(manifest.commandSequence.length > 0);
      assert.equal(
        resolveWakeflowLegacyScenarioDefinition({ host, scenarioId: manifest.scenarioId }).executionPolicy,
        "historical-artifact-only",
      );
      for (const sourceFile of manifest.producer.sourceFiles) {
        const source = origin.source.artifactManifest.files.find(
          (entry) => entry.ref === sourceFile.ref,
        );
        assert.ok(source, `${manifest.scenarioId} source ${sourceFile.ref} must exist in origin artifact manifest`);
        assert.equal(source.digest, sourceFile.digest);
        assert.equal(source.bytes, sourceFile.bytes);
        assert.equal(source.executable, sourceFile.executable);
      }
    }
  }
});

test("historical-seed maintenance copies exact bytes without executing writer source", () => {
  const historicalSourceRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-historical-source-"));
  const sampleRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-historical-sample-"));
  const sentinel = path.join(historicalSourceRoot, "retired-writer-executed");
  const writerFile = path.join(historicalSourceRoot, "scripts/wakeflow-delivery.mjs");
  const sourceBytes = Buffer.from(`throw new Error(${JSON.stringify(sentinel)});\n`, "utf8");
  mkdirSync(path.dirname(writerFile), { recursive: true });
  writeFileSync(writerFile, sourceBytes);
  const sampleFile = path.join(sampleRoot, ".wakeflow-local/wakeflow-delivery/stop.json");
  const sampleBytes = Buffer.from(`${JSON.stringify({
    kind: "AutomationLoopStop",
    pid: 0,
    reason: "fixture terminal stop",
    stoppedAt: "2026-06-11T00:00:00.000Z",
    version: 1,
  }, null, 2)}\n`, "utf8");
  mkdirSync(path.dirname(sampleFile), { recursive: true });
  writeFileSync(sampleFile, sampleBytes);

  const request = {
    historicalSourceRoot,
    host: "codex",
    sampleRoot,
    scenarioId: "stop-marker-historical",
  };
  const first = buildWakeflowHistoricalSeedScenarioCandidate(request);
  const replay = buildWakeflowHistoricalSeedScenarioCandidate(request);
  assert.equal(first.fixtureDigest, replay.fixtureDigest);
  assert.equal(first.manifest.materializationMode, "historical-seed");
  assert.deepEqual(first.manifest.commandSequence, []);
  assert.deepEqual(first.manifest.normalizations, []);
  assert.deepEqual(first.manifest.producer.sourceFiles, [{
    bytes: sourceBytes.length,
    digest: sha256(sourceBytes),
    executable: false,
    ref: "scripts/wakeflow-delivery.mjs",
    role: "original-writer",
  }]);
  assert.equal(existsSync(sentinel), false);
  assert.equal(
    inspectWakeflowLegacyScenarioFixtureDirectory({
      scenarioRoot: writeCandidateDirectory(first),
    }).manifest.scenarioDigest,
    first.manifest.scenarioDigest,
  );

  const linkedSample = path.join(sampleRoot, "linked-stop.json");
  linkSync(sampleFile, linkedSample);
  assert.throws(
    () => buildWakeflowHistoricalSeedScenarioCandidate(request),
    (error) => error.code === "wakeflow-legacy-scenario-tree",
  );
  unlinkSync(linkedSample);

  const linkedWriter = path.join(historicalSourceRoot, "scripts/linked-writer.mjs");
  linkSync(writerFile, linkedWriter);
  assert.throws(
    () => buildWakeflowHistoricalSeedScenarioCandidate(request),
    (error) => error.code === "wakeflow-legacy-scenario-historical-source",
  );
  unlinkSync(linkedWriter);
});

test("scenario manifest codec binds source, command, normalized output, and digest", () => {
  const origin = readOrigin();
  const outputRoot = makeOutputRoot();
  const manifest = realManifest(origin, { outputRoot });
  assert.deepEqual(validateWakeflowLegacyScenarioManifest(manifest), manifest);
  assert.deepEqual(validateWakeflowLegacyScenarioAgainstOrigin({ origin, scenario: manifest }), manifest);
  const inspected = inspectWakeflowLegacyScenarioFixtureDirectory({
    origin,
    scenarioRoot: writeScenarioDirectory({ manifest, outputRoot }),
  });
  assert.equal(inspected.manifest.scenarioId, "identity-registered");

  const tampered = structuredClone(manifest);
  tampered.commandSequence[0].argv.push("--unexpected");
  assert.throws(
    () => validateWakeflowLegacyScenarioManifest(tampered),
    (error) => error.code === "wakeflow-legacy-scenario-digest",
  );
});

test("scenario inspection rejects private output and unlisted files", () => {
  const origin = readOrigin();
  const privateOutput = makeOutputRoot({ privatePath: true });
  assert.throws(
    () => inspectWakeflowLegacyScenarioFixtureDirectory({
      origin,
      scenarioRoot: writeScenarioDirectory({
        manifest: realManifest(origin, { outputRoot: privateOutput }),
        outputRoot: privateOutput,
      }),
    }),
    (error) => error.code === "wakeflow-legacy-scenario-privacy",
  );

  const outputRoot = makeOutputRoot();
  const manifest = realManifest(origin, { outputRoot });
  const scenarioRoot = writeScenarioDirectory({ manifest, outputRoot });
  writeFileSync(path.join(scenarioRoot, "extra.txt"), "not in manifest\n");
  assert.throws(
    () => inspectWakeflowLegacyScenarioFixtureDirectory({ origin, scenarioRoot }),
    (error) => error.code === "wakeflow-legacy-scenario-directory",
  );

  const linkedRoot = writeScenarioDirectory({ manifest, outputRoot });
  const linkedTarget = path.join(
    linkedRoot,
    "output/.wakeflow-local/wakeflow-delivery/hosts/codex/thread-registry/ProductWindow.json",
  );
  const outside = path.join(mkdtempSync(path.join(os.tmpdir(), "wakeflow-scenario-hardlink-")), "outside-copy.json");
  writeFileSync(outside, readFileSync(linkedTarget));
  unlinkSync(linkedTarget);
  linkSync(outside, linkedTarget);
  assert.throws(
    () => inspectWakeflowLegacyScenarioFixtureDirectory({ origin, scenarioRoot: linkedRoot }),
    (error) => error.code === "wakeflow-legacy-scenario-directory",
  );
});

test("source-maintenance attach remains create-once without executing artifact writers", () => {
  const fixtureRoot = copyOriginWithoutScenarios("wakeflow-origin-scenario-write-");
  const origin = readOrigin(fixtureRoot);
  const outputRoot = makeOutputRoot();
  const manifest = realManifest(origin, { outputRoot });
  const scenarioRoot = writeScenarioDirectory({ manifest, outputRoot });
  const candidate = candidateFromDirectory({ manifest, scenarioRoot });

  const written = writeWakeflowLegacyScenarioCandidate({ candidate, fixtureRoot });
  assert.equal(written.status, "written");
  assert.deepEqual(readOrigin(fixtureRoot).scenarios, ["identity-registered/scenario.json"]);
  const replayed = writeWakeflowLegacyScenarioCandidate({ candidate, fixtureRoot });
  assert.equal(replayed.status, "replayed");
  assert.equal(replayed.wroteScenario, false);
  assert.equal(replayed.wroteOrigin, false);
});
