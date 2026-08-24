import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  linkSync,
  lstatSync,
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

import { canonicalJsonDigest } from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  loadWakeflowAssetBundle,
  parseWakeflowAssetBundle,
  renderWakeflowAsset,
} from "../core/scripts/lib/wakeflow-template-renderer.mjs";
import {
  buildWakeflowAssetBundle,
  buildWakeflowAssetBundleBytes,
} from "../tools/build-asset-bundle.mjs";

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const sourceRoot = path.join(repositoryRoot, "core/template-sources");
const builderCli = path.join(repositoryRoot, "tools/build-asset-bundle.mjs");

function copySourceFixture() {
  const parent = mkdtempSync(path.join(os.tmpdir(), "wakeflow-template-builder-"));
  const root = path.join(parent, "template-sources");
  cpSync(sourceRoot, root, { recursive: true });
  return root;
}

function resign(bundle) {
  const withoutDigest = {
    schemaVersion: bundle.schemaVersion,
    artifactKind: bundle.artifactKind,
    source: bundle.source,
    sourceDigest: bundle.sourceDigest,
    assets: bundle.assets,
  };
  bundle.bundleDigest = canonicalJsonDigest(withoutDigest);
  return bundle;
}

test("asset bundle build is byte deterministic and strict-loader compatible", () => {
  const first = buildWakeflowAssetBundleBytes({ sourceRoot });
  const second = buildWakeflowAssetBundleBytes({ sourceRoot });
  assert.deepEqual(first, second);
  const bundle = parseWakeflowAssetBundle(JSON.parse(first.toString("utf8")));
  assert.equal(bundle.schemaVersion, 2);
  assert.equal(bundle.artifactKind, "wakeflow-install-assets");
  assert.match(bundle.sourceDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(bundle.bundleDigest, /^sha256:[0-9a-f]{64}$/);
});

test("builder rejects behavioral operations, runtime-invalid templates, and runtime-unloadable output size", () => {
  for (const build of [buildWakeflowAssetBundle, buildWakeflowAssetBundleBytes]) {
    let rootReads = 0;
    const operation = {};
    Object.defineProperty(operation, "sourceRoot", {
      enumerable: true,
      get() {
        rootReads += 1;
        return sourceRoot;
      },
    });
    assert.throws(
      () => build(operation),
      (error) => error.code === "wakeflow-asset-source-type",
    );
    assert.equal(rootReads, 0);
  }

  const invalidContract = copySourceFixture();
  const invalidFile = path.join(invalidContract, "progress/demand-progress.template.md");
  writeFileSync(
    invalidFile,
    readFileSync(invalidFile, "utf8").replace("{{goal}}", "{{unknownGoal}}"),
  );
  assert.throws(
    () => buildWakeflowAssetBundle({ sourceRoot: invalidContract }),
    (error) => error.code === "wakeflow-template-token-contract",
  );

  const mismatchedInput = copySourceFixture();
  const manifestFile = path.join(mismatchedInput, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  manifest.assets[0].input.goal = "integer";
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.throws(
    () => buildWakeflowAssetBundle({ sourceRoot: mismatchedInput }),
    (error) => error.code === "wakeflow-asset-source-runtime-contract",
  );

  const oversizedBundle = copySourceFixture();
  for (const relative of [
    "progress/demand-progress.template.md",
    "progress/demand-progress.zh-CN.template.md",
  ]) {
    const file = path.join(oversizedBundle, relative);
    writeFileSync(file, readFileSync(file, "utf8").replace(/\n$/u, `\n${"x".repeat(530000)}\n`));
  }
  assert.throws(
    () => buildWakeflowAssetBundleBytes({ sourceRoot: oversizedBundle }),
    (error) => error.code === "wakeflow-asset-bundle-too-large",
  );
});

test("strict loader rejects entry, asset-set, token, and bundle integrity drift", () => {
  const corruptEntry = buildWakeflowAssetBundle({ sourceRoot });
  corruptEntry.assets["progress.demand.en"].content += "corrupt\n";
  resign(corruptEntry);
  assert.throws(
    () => parseWakeflowAssetBundle(corruptEntry),
    (error) => error.code === "wakeflow-template-entry-digest",
  );

  const extraAsset = buildWakeflowAssetBundle({ sourceRoot });
  extraAsset.assets["progress.extra.en"] = extraAsset.assets["progress.demand.en"];
  resign(extraAsset);
  assert.throws(
    () => parseWakeflowAssetBundle(extraAsset),
    (error) => error.code === "wakeflow-template-asset-set",
  );

  const tokenDrift = buildWakeflowAssetBundle({ sourceRoot });
  const entry = tokenDrift.assets["progress.demand.en"];
  entry.content = entry.content.replace("{{goal}}", "{{unknownGoal}}");
  entry.sha256 = `sha256:${createHash("sha256").update(entry.content).digest("hex")}`;
  resign(tokenDrift);
  assert.throws(
    () => parseWakeflowAssetBundle(tokenDrift),
    (error) => error.code === "wakeflow-template-token-contract",
  );

  const malformedToken = buildWakeflowAssetBundle({ sourceRoot });
  const malformedEntry = malformedToken.assets["progress.demand.en"];
  malformedEntry.content = malformedEntry.content.replace(/\n$/u, "\n{{unknown_name}}\n");
  malformedEntry.sha256 = `sha256:${createHash("sha256").update(malformedEntry.content).digest("hex")}`;
  resign(malformedToken);
  assert.throws(
    () => parseWakeflowAssetBundle(malformedToken),
    (error) => error.code === "wakeflow-template-token-contract",
  );

  const corruptBundle = buildWakeflowAssetBundle({ sourceRoot });
  corruptBundle.bundleDigest = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  assert.throws(
    () => parseWakeflowAssetBundle(corruptBundle),
    (error) => error.code === "wakeflow-template-bundle-digest",
  );

  const accessorAssetMap = buildWakeflowAssetBundle({ sourceRoot });
  const assetId = "progress.demand.en";
  const asset = accessorAssetMap.assets[assetId];
  let assetReads = 0;
  Object.defineProperty(accessorAssetMap.assets, assetId, {
    enumerable: true,
    get() {
      assetReads += 1;
      return asset;
    },
  });
  assert.throws(
    () => parseWakeflowAssetBundle(accessorAssetMap),
    (error) => error.code === "wakeflow-template-asset-set",
  );
  assert.equal(assetReads, 0, "asset-map admission must reject accessors without invoking them");
});

test("typed renderer rejects missing, extra, empty, and wrong-type input without interpreting user braces", () => {
  const bundle = parseWakeflowAssetBundle(buildWakeflowAssetBundle({ sourceRoot }));
  const valid = {
    authority: "No active execution authority.",
    completionDefinition: "Done",
    currentState: "active",
    demand: "demand_22222222-2222-4222-8222-222222222222",
    events: "No controller events.",
    goal: "Preserve user text such as {{literal}} exactly.",
    projectionMarker: "<!-- wakeflow:projection -->",
    source: "revision 1",
    title: "Asset contract",
  };
  const rendered = renderWakeflowAsset({
    bundle,
    assetId: "progress.demand.en",
    input: valid,
  });
  assert.match(rendered.content, /\{\{literal}}/);
  assert.doesNotMatch(rendered.content, /\{\{title}}/);

  const missing = { ...valid };
  delete missing.goal;
  for (const input of [
    missing,
    { ...valid, goal: undefined },
    { ...valid, goal: "" },
    { ...valid, extra: "no" },
  ]) {
    assert.throws(
      () => renderWakeflowAsset({ bundle, assetId: "progress.demand.en", input }),
      (error) => error.code.startsWith("wakeflow-template-input"),
    );
  }
  let accessorReads = 0;
  const accessor = { ...valid };
  Object.defineProperty(accessor, "goal", {
    enumerable: true,
    get() {
      accessorReads += 1;
      return "unstable";
    },
  });
  const symbolInput = { ...valid, [Symbol("hidden")]: true };
  const hiddenInput = { ...valid };
  Object.defineProperty(hiddenInput, "hidden", { value: true });
  for (const input of [accessor, symbolInput, hiddenInput]) {
    assert.throws(
      () => renderWakeflowAsset({ bundle, assetId: "progress.demand.en", input }),
      (error) => error.code.startsWith("wakeflow-template-input"),
    );
  }
  assert.equal(accessorReads, 0);
  assert.throws(
    () => renderWakeflowAsset({ bundle, assetId: "progress.unknown.en", input: valid }),
    (error) => error.code === "wakeflow-template-asset-id",
  );

  let operationReads = 0;
  const operation = { bundle, input: valid };
  Object.defineProperty(operation, "assetId", {
    enumerable: true,
    get() {
      operationReads += 1;
      return "progress.demand.en";
    },
  });
  assert.throws(() => renderWakeflowAsset(operation), (error) => error.code.startsWith("wakeflow-template-"));
  assert.equal(operationReads, 0, "renderer operation admission must not invoke accessors");
});

test("installed loader reads only the exact new bundle and never falls back to legacy or loose templates", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-template-load-"));
  mkdirSync(path.join(root, "templates/wakeflow-state-machine"), { recursive: true });
  writeFileSync(path.join(root, "templates/wakeflow-template-bundle.json"), "{}\n");
  writeFileSync(path.join(root, "templates/wakeflow-state-machine/developer-progress.template.md"), "fallback\n");
  assert.throws(
    () => loadWakeflowAssetBundle({ wakeflowRoot: root }),
    (error) => error.code === "wakeflow-template-bundle-missing",
  );

  writeFileSync(
    path.join(root, "templates/wakeflow-asset-bundle.json"),
    buildWakeflowAssetBundleBytes({ sourceRoot }),
  );
  const bundle = loadWakeflowAssetBundle({ wakeflowRoot: root });
  assert.equal(bundle.artifactKind, "wakeflow-install-assets");

  let rootReads = 0;
  const accessorOperation = {};
  Object.defineProperty(accessorOperation, "wakeflowRoot", {
    enumerable: true,
    get() {
      rootReads += 1;
      return root;
    },
  });
  assert.throws(
    () => loadWakeflowAssetBundle(accessorOperation),
    (error) => error.code === "wakeflow-template-root",
  );
  assert.equal(rootReads, 0, "loader operation admission must not invoke accessors");

  const oversizedRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-template-oversized-"));
  mkdirSync(path.join(oversizedRoot, "templates"), { recursive: true });
  writeFileSync(
    path.join(oversizedRoot, "templates/wakeflow-asset-bundle.json"),
    Buffer.alloc((1024 * 1024) + 1, 0x20),
  );
  assert.throws(
    () => loadWakeflowAssetBundle({ wakeflowRoot: oversizedRoot }),
    (error) => error.code === "wakeflow-template-bundle-too-large",
  );

  if (process.platform !== "win32") {
    const symlinkRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-template-symlink-"));
    mkdirSync(path.join(symlinkRoot, "templates"), { recursive: true });
    const realBundle = path.join(symlinkRoot, "real-bundle.json");
    writeFileSync(realBundle, buildWakeflowAssetBundleBytes({ sourceRoot }));
    symlinkSync(realBundle, path.join(symlinkRoot, "templates/wakeflow-asset-bundle.json"));
    assert.throws(
      () => loadWakeflowAssetBundle({ wakeflowRoot: symlinkRoot }),
      (error) => error.code === "wakeflow-template-bundle-unsafe",
    );
  }
});

test("changing one canonical source changes both its raw digest and aggregate source digest", () => {
  const fixture = copySourceFixture();
  const before = buildWakeflowAssetBundle({ sourceRoot: fixture });
  const file = path.join(fixture, "progress/demand-progress.template.md");
  writeFileSync(file, readFileSync(file, "utf8").replace("## Goal", "## Intended Goal"));
  const after = buildWakeflowAssetBundle({ sourceRoot: fixture });
  assert.notEqual(
    before.assets["progress.demand.en"].sha256,
    after.assets["progress.demand.en"].sha256,
  );
  assert.notEqual(before.sourceDigest, after.sourceDigest);
  assert.notEqual(before.bundleDigest, after.bundleDigest);
});

test("asset builder CLI atomically replaces regular output and refuses symlink or hardlink output", {
  skip: process.platform === "win32",
}, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-asset-output-"));
  const sentinel = path.join(root, "sentinel.json");
  const output = path.join(root, "bundle.json");
  writeFileSync(sentinel, "preserve\n");
  symlinkSync(sentinel, output);
  const symlinked = spawnSync(process.execPath, [builderCli, "--output", output], { encoding: "utf8" });
  assert.notEqual(symlinked.status, 0);
  assert.match(symlinked.stderr, /wakeflow-asset-cli-output/u);
  assert.equal(readFileSync(sentinel, "utf8"), "preserve\n");

  unlinkSync(output);
  linkSync(sentinel, output);
  const hardlinked = spawnSync(process.execPath, [builderCli, "--output", output], { encoding: "utf8" });
  assert.notEqual(hardlinked.status, 0);
  assert.match(hardlinked.stderr, /wakeflow-asset-cli-output/u);
  assert.equal(readFileSync(sentinel, "utf8"), "preserve\n");
  assert.equal(lstatSync(output).nlink, 2);

  unlinkSync(output);
  writeFileSync(output, "old\n");
  const regular = spawnSync(process.execPath, [builderCli, "--output", output], { encoding: "utf8" });
  assert.equal(regular.status, 0, regular.stderr || regular.stdout);
  assert.deepEqual(readFileSync(output), buildWakeflowAssetBundleBytes({ sourceRoot }));
  assert.equal(lstatSync(output).mode & 0o777, 0o644);
});
