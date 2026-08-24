import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkReleaseConsistency,
  collectReleaseVersionSources,
} from "../tools/check-release-consistency.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repositoryRoot, "tools/check-release-consistency.mjs");

function write(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
}

function makeVersionFixture({ marketplacePlugins = null } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-release-check-"));
  for (const relative of [
    "plugins/codex-wakeflow/package.json",
    "plugins/codex-wakeflow/.codex-plugin/plugin.json",
    "plugins/claude-code-wakeflow/package.json",
    "plugins/claude-code-wakeflow/.claude-plugin/plugin.json",
  ]) {
    write(path.join(root, relative), { version: "1.2.3" });
  }
  write(path.join(root, ".claude-plugin/marketplace.json"), {
    plugins: marketplacePlugins ?? [{ name: "wakeflow", version: "1.2.3" }],
  });
  return root;
}

test("release version collection finds the named Wakeflow marketplace entry, not plugins[0]", () => {
  const root = makeVersionFixture({
    marketplacePlugins: [
      { name: "another-plugin", version: "9.9.9" },
      { name: "wakeflow", version: "1.2.3" },
    ],
  });
  const sources = collectReleaseVersionSources(root);
  assert.deepEqual(sources.map((source) => source.value), Array(5).fill("1.2.3"));
  assert.equal(sources.every((source) => source.error === null), true);
});

test("release version collection rejects malformed, duplicate, and symbolic-link evidence", () => {
  const root = makeVersionFixture({
    marketplacePlugins: [
      { name: "wakeflow", version: "1.2.3" },
      { name: "wakeflow", version: "1.2.3" },
    ],
  });
  write(path.join(root, "plugins/claude-code-wakeflow/.claude-plugin/plugin.json"), "not-json\n");
  const outside = path.join(root, "outside-package.json");
  write(outside, { version: "1.2.3" });
  const codexPackage = path.join(root, "plugins/codex-wakeflow/package.json");
  unlinkSync(codexPackage);
  symlinkSync(outside, codexPackage);

  const sources = collectReleaseVersionSources(root);
  assert.match(sources.find((source) => source.label === "codex package").error, /non-symlink single-link/u);
  assert.match(sources.find((source) => source.label === "claude plugin manifest").error, /valid UTF-8 JSON/u);
  assert.match(sources.find((source) => source.label === "claude marketplace").error, /exactly one plugin named wakeflow/u);
});

test("release check never reports an uninspectable worktree as clean or a missing tag as matching HEAD", () => {
  const root = makeVersionFixture();
  const result = checkReleaseConsistency({
    repoRoot: root,
    requireClean: true,
    requireTag: true,
    inspectPacks: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.git.clean, null);
  assert.equal(result.git.head, null);
  assert.equal(result.git.tagCommit, null);
  assert.match(result.issues.join("\n"), /git worktree status inspection failed/u);
  assert.match(result.issues.join("\n"), /release worktree must be verified clean/u);
  assert.match(result.issues.join("\n"), /v1\.2\.3 must exist and point at HEAD/u);
});

test("strict release check rejects historical fixture bytes hidden from the Git source closure", () => {
  const root = makeVersionFixture();
  write(path.join(root, "tools/sync-core.mjs"), "process.exit(0);\n");
  write(path.join(root, ".gitignore"), ".wakeflow-local/\n");
  write(
    path.join(root, "test/fixtures/legacy-origins/example/static/WakeflowFixture/.wakeflow-local/state.json"),
    "{}\n",
  );
  const initialized = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);

  const result = checkReleaseConsistency({
    repoRoot: root,
    requireClean: true,
    inspectPacks: false,
  });
  assert.equal(result.sourceClosure.ignoredUntrackedFixtureFiles, 1);
  assert.match(result.issues.join("\n"), /historical fixture files are physically present but excluded from the Git source closure/u);
});

test("release-check CLI rejects unknown, duplicate, and missing-value options", () => {
  for (const args of [
    ["--require-cleen"],
    ["--json", "--json"],
    ["--repo-root"],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
    assert.equal(result.status, 64, result.stderr || result.stdout);
    assert.match(result.stderr, /wakeflow-release-check-argv/u);
  }
});
