import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildWakeflowAssetBundle,
  readWakeflowAssetSources,
} from "../tools/build-asset-bundle.mjs";

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const sourceRoot = path.join(repositoryRoot, "core/template-sources");

const expectedDigests = {
  "progress.demand.en": "sha256:235512389c9fe63f302cb305bd2a7359db462aa51feee80fe7e4b25de9d47c67",
  "progress.demand.zh-CN": "sha256:06f76d3ad5056c3d1006011c463ca9f9f0e3889b18df76f286f9dcce7466d585",
};

function copySourceFixture() {
  const parent = mkdtempSync(path.join(os.tmpdir(), "wakeflow-template-source-"));
  const root = path.join(parent, "template-sources");
  cpSync(sourceRoot, root, { recursive: true });
  return root;
}

test("canonical template source contains only the two current demand projection assets", () => {
  const sources = readWakeflowAssetSources({ sourceRoot });
  assert.deepEqual(sources.map((entry) => entry.id), Object.keys(expectedDigests));
  assert.deepEqual(
    Object.fromEntries(sources.map((entry) => [entry.id, entry.sha256])),
    expectedDigests,
  );
  assert.deepEqual(
    sources.map((entry) => entry.consumers),
    [
      ["wakeflow-demand-document-builder"],
      ["wakeflow-demand-document-builder"],
    ],
  );
  for (const entry of sources) {
    for (const consumer of entry.consumers) {
      const consumerFile = path.join(repositoryRoot, "core/scripts/lib", `${consumer}.mjs`);
      assert.equal(existsSync(consumerFile), true, `${entry.id} declares missing consumer ${consumer}`);
      assert.match(readFileSync(consumerFile, "utf8"), new RegExp(entry.id.replaceAll(".", "\\."), "u"));
    }
  }
});

test("generated carrier excludes workspace scaffolds, memory, Skills, README, host, and event facts", () => {
  const bundle = buildWakeflowAssetBundle({ sourceRoot });
  const serialized = JSON.stringify(bundle);
  assert.deepEqual(Object.keys(bundle.assets), Object.keys(expectedDigests));
  for (const forbidden of [
    "AGENTS.md",
    "CLAUDE.md",
    "README.md",
    "SKILL.md",
    "starter-workspace",
    "window-support",
    "controller-events",
    "wakeflow.config",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must not enter the install asset carrier`);
  }
});

test("public cutover removes the v2 bundle and ships only the canonical generated asset carrier", () => {
  const expected = buildWakeflowAssetBundle({ sourceRoot });
  for (const host of ["codex-wakeflow", "claude-code-wakeflow"]) {
    const templateRoot = path.join(repositoryRoot, "plugins", host, "templates");
    assert.equal(existsSync(path.join(templateRoot, "wakeflow-template-bundle.json")), false);
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(templateRoot, "wakeflow-asset-bundle.json"), "utf8")),
      expected,
    );
  }
});

test("source inventory rejects unregistered files, duplicate sources, path escape, and noncanonical bytes", () => {
  const extra = copySourceFixture();
  writeFileSync(path.join(extra, "progress/unregistered.md"), "Unregistered\n");
  assert.throws(
    () => readWakeflowAssetSources({ sourceRoot: extra }),
    (error) => error.code === "wakeflow-asset-source-inventory",
  );

  const duplicate = copySourceFixture();
  const duplicateManifest = JSON.parse(readFileSync(path.join(duplicate, "manifest.json"), "utf8"));
  duplicateManifest.assets[1].source = duplicateManifest.assets[0].source;
  writeFileSync(path.join(duplicate, "manifest.json"), `${JSON.stringify(duplicateManifest, null, 2)}\n`);
  assert.throws(
    () => readWakeflowAssetSources({ sourceRoot: duplicate }),
    (error) => error.code === "wakeflow-asset-source-duplicate",
  );

  const escaped = copySourceFixture();
  const escapedManifest = JSON.parse(readFileSync(path.join(escaped, "manifest.json"), "utf8"));
  escapedManifest.assets[0].source = "../outside.md";
  writeFileSync(path.join(escaped, "manifest.json"), `${JSON.stringify(escapedManifest, null, 2)}\n`);
  assert.throws(
    () => readWakeflowAssetSources({ sourceRoot: escaped }),
    (error) => error.code === "wakeflow-asset-source-path",
  );

  const crlf = copySourceFixture();
  const file = path.join(crlf, "progress/demand-progress.template.md");
  writeFileSync(file, readFileSync(file, "utf8").replaceAll("\n", "\r\n"));
  assert.throws(
    () => readWakeflowAssetSources({ sourceRoot: crlf }),
    (error) => error.code === "wakeflow-asset-source-bytes",
  );
});

test("source reader rejects ambient roots, behavioral operations, and oversized source files", () => {
  assert.throws(
    () => readWakeflowAssetSources({ sourceRoot: "core/template-sources" }),
    (error) => error.code === "wakeflow-asset-source-root",
  );

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
    () => readWakeflowAssetSources(operation),
    (error) => error.code === "wakeflow-asset-source-type",
  );
  assert.equal(rootReads, 0);

  const oversized = copySourceFixture();
  writeFileSync(
    path.join(oversized, "progress/demand-progress.template.md"),
    Buffer.alloc((1024 * 1024) + 1, 0x61),
  );
  assert.throws(
    () => readWakeflowAssetSources({ sourceRoot: oversized }),
    (error) => error.code === "wakeflow-asset-source-too-large",
  );
});
