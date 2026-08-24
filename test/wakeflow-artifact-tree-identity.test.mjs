import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  WAKEFLOW_ARTIFACT_TREE_IDENTITY_LIMITS,
  inspectWakeflowArtifactTree,
  validateWakeflowArtifactTreeManifest,
} from "../core/scripts/lib/wakeflow-artifact-tree-identity.mjs";

function fixtureRoot(prefix = "wakeflow-artifact-identity-") {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  mkdirSync(path.join(root, "scripts/lib"), { recursive: true });
  writeFileSync(path.join(root, "package.json"), "{\"name\":\"fixture\",\"version\":\"1.0.0\"}\n");
  writeFileSync(path.join(root, "scripts-old.mjs"), "export const old = false;\n");
  writeFileSync(path.join(root, "scripts/entry.mjs"), "export const entry = true;\n");
  writeFileSync(path.join(root, "scripts/lib/value.mjs"), "export const value = 1;\n");
  return root;
}

function copyFixtureBytes(source, destination) {
  mkdirSync(path.join(destination, "scripts/lib"), { recursive: true });
  for (const relative of ["package.json", "scripts-old.mjs", "scripts/entry.mjs", "scripts/lib/value.mjs"]) {
    writeFileSync(path.join(destination, relative), readFileSync(path.join(source, relative)));
  }
}

test("complete artifact identity is location-independent, lexical, canonical, and deeply frozen", () => {
  const firstRoot = fixtureRoot();
  const secondRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-artifact-relocated-"));
  copyFixtureBytes(firstRoot, secondRoot);

  const first = inspectWakeflowArtifactTree({ artifactRoot: firstRoot });
  const second = inspectWakeflowArtifactTree({ artifactRoot: secondRoot });

  assert.deepEqual(second, first);
  assert.match(first.artifactDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(first.manifest.files.map((entry) => entry.ref), [
    "package.json",
    "scripts-old.mjs",
    "scripts/entry.mjs",
    "scripts/lib/value.mjs",
  ]);
  assert.equal(first.manifest.fileCount, 4);
  assert.equal(first.manifest.totalBytes, first.manifest.files.reduce((sum, entry) => sum + entry.bytes, 0));
  assert.equal(JSON.stringify(first).includes(firstRoot), false);
  assert.equal(JSON.stringify(first).includes(secondRoot), false);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.manifest), true);
  assert.equal(Object.isFrozen(first.manifest.files), true);
  assert.equal(Object.isFrozen(first.manifest.files[0]), true);

  assert.deepEqual(validateWakeflowArtifactTreeManifest(first.manifest), first.manifest);
});

test("content and executable-bit changes create different exact owners even when package semver is unchanged", () => {
  const root = fixtureRoot();
  const before = inspectWakeflowArtifactTree({ artifactRoot: root });

  writeFileSync(path.join(root, "scripts/lib/value.mjs"), "export const value = 2;\n");
  const contentChanged = inspectWakeflowArtifactTree({ artifactRoot: root });
  assert.notEqual(contentChanged.artifactDigest, before.artifactDigest);
  assert.equal(
    contentChanged.manifest.files.find((entry) => entry.ref === "package.json").digest,
    before.manifest.files.find((entry) => entry.ref === "package.json").digest,
  );

  const entry = path.join(root, "scripts/entry.mjs");
  chmodSync(entry, 0o755);
  const executableChanged = inspectWakeflowArtifactTree({ artifactRoot: root });
  assert.notEqual(executableChanged.artifactDigest, contentChanged.artifactDigest);
  assert.equal(executableChanged.manifest.files.find((item) => item.ref === "scripts/entry.mjs").executable, true);
});

test("artifact identity rejects root and descendant symlinks without following them", () => {
  const root = fixtureRoot();
  const outside = mkdtempSync(path.join(os.tmpdir(), "wakeflow-artifact-outside-"));
  writeFileSync(path.join(outside, "secret.txt"), "secret\n");
  symlinkSync(path.join(outside, "secret.txt"), path.join(root, "linked-secret"));
  assert.throws(
    () => inspectWakeflowArtifactTree({ artifactRoot: root }),
    (error) => error.code === "wakeflow-artifact-tree-symlink",
  );

  const target = fixtureRoot("wakeflow-artifact-target-");
  const parent = mkdtempSync(path.join(os.tmpdir(), "wakeflow-artifact-root-link-"));
  const linkedRoot = path.join(parent, "artifact");
  symlinkSync(target, linkedRoot, "dir");
  assert.throws(
    () => inspectWakeflowArtifactTree({ artifactRoot: linkedRoot }),
    (error) => error.code === "wakeflow-artifact-tree-root-symlink",
  );
});

test("artifact identity rejects special nodes and never silently excludes them", { skip: process.platform === "win32" }, () => {
  const root = fixtureRoot();
  const fifo = path.join(root, "transport.fifo");
  const created = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
  assert.equal(created.status, 0, created.stderr);
  assert.throws(
    () => inspectWakeflowArtifactTree({ artifactRoot: root }),
    (error) => error.code === "wakeflow-artifact-tree-special-node" && error.details.ref === "transport.fifo",
  );
});

test("artifact identity enforces closed count, file-byte, total-byte, depth, and ref-byte bounds", () => {
  const root = fixtureRoot();
  const base = WAKEFLOW_ARTIFACT_TREE_IDENTITY_LIMITS;
  for (const [field, value, code] of [
    ["maxFiles", 2, "wakeflow-artifact-tree-file-count"],
    ["maxFileBytes", 4, "wakeflow-artifact-tree-file-bytes"],
    ["maxTotalBytes", 8, "wakeflow-artifact-tree-total-bytes"],
    ["maxDepth", 1, "wakeflow-artifact-tree-depth"],
    ["maxRefBytes", 8, "wakeflow-artifact-tree-ref-bytes"],
  ]) {
    assert.throws(
      () => inspectWakeflowArtifactTree({
        artifactRoot: root,
        limits: { ...base, [field]: value },
      }),
      (error) => error.code === code,
      field,
    );
  }
  assert.throws(
    () => inspectWakeflowArtifactTree({ artifactRoot: root, limits: { ...base, unknown: 1 } }),
    (error) => error.code === "wakeflow-artifact-tree-limits",
  );
  assert.throws(
    () => inspectWakeflowArtifactTree({
      artifactRoot: root,
      limits: { ...base, maxFileBytes: base.maxFileBytes + 1 },
    }),
    (error) => error.code === "wakeflow-artifact-tree-limits",
  );
});

test("artifact identity bounds all physical entries, including empty directories", () => {
  const root = fixtureRoot();
  for (const name of ["empty-a", "empty-b", "empty-c", "empty-d"]) {
    mkdirSync(path.join(root, name));
  }
  assert.throws(
    () => inspectWakeflowArtifactTree({
      artifactRoot: root,
      limits: { ...WAKEFLOW_ARTIFACT_TREE_IDENTITY_LIMITS, maxEntries: 3 },
    }),
    (error) => error.code === "wakeflow-artifact-tree-entry-count",
  );
});

test("artifact identity rejects decorated inputs and custom-prototype arrays without executing accessors", () => {
  const root = fixtureRoot();
  let getterCalls = 0;
  const input = {};
  Object.defineProperty(input, "artifactRoot", {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error("artifactRoot getter must not execute");
    },
  });
  assert.throws(
    () => inspectWakeflowArtifactTree(input),
    (error) => error.code === "wakeflow-artifact-tree-input",
  );
  assert.equal(getterCalls, 0);

  const { manifest } = inspectWakeflowArtifactTree({ artifactRoot: root });
  const files = [...manifest.files];
  Object.setPrototypeOf(files, Object.create(null));
  assert.throws(
    () => validateWakeflowArtifactTreeManifest({ ...manifest, files }),
    (error) => error.code === "wakeflow-artifact-tree-manifest-shape",
  );
});

test("artifact identity rejects noncanonical and portable-colliding refs", { skip: process.platform === "win32" }, () => {
  const controlRoot = fixtureRoot();
  writeFileSync(path.join(controlRoot, "bad\nname"), "bad\n");
  assert.throws(
    () => inspectWakeflowArtifactTree({ artifactRoot: controlRoot }),
    (error) => error.code === "wakeflow-artifact-tree-ref",
  );

  const unicodeRoot = fixtureRoot();
  writeFileSync(path.join(unicodeRoot, "cafe\u0301.txt"), "decomposed\n");
  assert.throws(
    () => inspectWakeflowArtifactTree({ artifactRoot: unicodeRoot }),
    (error) => error.code === "wakeflow-artifact-tree-ref",
  );

  const { manifest } = inspectWakeflowArtifactTree({ artifactRoot: fixtureRoot() });
  const [sample] = manifest.files;
  const collisionFiles = [
    { ...sample, ref: "Owner.txt" },
    { ...sample, ref: "owner.txt" },
  ];
  assert.throws(
    () => validateWakeflowArtifactTreeManifest({
      ...manifest,
      fileCount: collisionFiles.length,
      files: collisionFiles,
      totalBytes: collisionFiles.reduce((sum, entry) => sum + entry.bytes, 0),
    }),
    (error) => error.code === "wakeflow-artifact-tree-ref-collision",
  );
});

test("manifest validation rejects reordered, unknown, or self-inconsistent input", () => {
  const { manifest } = inspectWakeflowArtifactTree({ artifactRoot: fixtureRoot() });
  assert.throws(
    () => validateWakeflowArtifactTreeManifest({ ...manifest, unknown: true }),
    (error) => error.code === "wakeflow-artifact-tree-manifest-shape",
  );
  assert.throws(
    () => validateWakeflowArtifactTreeManifest({ ...manifest, files: [...manifest.files].reverse() }),
    (error) => error.code === "wakeflow-artifact-tree-manifest-order",
  );
  assert.throws(
    () => validateWakeflowArtifactTreeManifest({ ...manifest, totalBytes: manifest.totalBytes + 1 }),
    (error) => error.code === "wakeflow-artifact-tree-manifest-totals",
  );
});
