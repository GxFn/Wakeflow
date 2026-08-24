import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { WAKEFLOW_RETIRED_NORMAL_RUNTIME_PATHS } from "./support/wakeflow-m7a-boundary.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const liveDocumentationRoots = Object.freeze([
  "README.md",
  "README.zh-CN.md",
  "core/skills",
  "plugins/codex-wakeflow/AGENTS.md",
  "plugins/codex-wakeflow/README.md",
  "plugins/codex-wakeflow/README.zh-CN.md",
  "plugins/codex-wakeflow/scripts/README.md",
  "plugins/codex-wakeflow/skills",
  "plugins/claude-code-wakeflow/CLAUDE.md",
  "plugins/claude-code-wakeflow/README.md",
  "plugins/claude-code-wakeflow/README.zh-CN.md",
  "plugins/claude-code-wakeflow/commands",
  "plugins/claude-code-wakeflow/scripts/README.md",
  "plugins/claude-code-wakeflow/skills",
]);

function slash(value) {
  return value.split(path.sep).join("/");
}

function collectMarkdownFiles(target, files = []) {
  if (!existsSync(target)) return files;
  const stats = statSync(target);
  if (stats.isFile()) {
    if (target.endsWith(".md")) files.push(target);
    return files;
  }
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) collectMarkdownFiles(child, files);
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(child);
  }
  return files;
}

function collectCurrentSourceBasenames(target, basenames = new Set()) {
  if (!existsSync(target)) return basenames;
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) collectCurrentSourceBasenames(child, basenames);
    else if (entry.isFile() && /\.(?:cjs|js|mjs)$/u.test(entry.name)) basenames.add(entry.name);
  }
  return basenames;
}

test("live Wakeflow documentation does not advertise a retired normal-runtime entrypoint", () => {
  const liveFiles = liveDocumentationRoots
    .flatMap((relativePath) => collectMarkdownFiles(path.join(repositoryRoot, relativePath)))
    .map((file) => path.resolve(file))
    .filter((file, index, files) => files.indexOf(file) === index)
    .sort();
  assert.ok(liveFiles.length > 0);

  const currentSourceBasenames = collectCurrentSourceBasenames(path.join(repositoryRoot, "core"));
  collectCurrentSourceBasenames(path.join(repositoryRoot, "plugins/codex-wakeflow"), currentSourceBasenames);
  collectCurrentSourceBasenames(path.join(repositoryRoot, "plugins/claude-code-wakeflow"), currentSourceBasenames);

  const unambiguousRetiredBasenames = [...new Set(
    WAKEFLOW_RETIRED_NORMAL_RUNTIME_PATHS.map((relativePath) => path.posix.basename(relativePath)),
  )]
    .filter((basename) => !currentSourceBasenames.has(basename))
    .sort();
  const issues = [];

  for (const file of liveFiles) {
    const source = readFileSync(file, "utf8");
    const relativeFile = slash(path.relative(repositoryRoot, file));
    for (const retiredPath of WAKEFLOW_RETIRED_NORMAL_RUNTIME_PATHS) {
      if (source.includes(retiredPath)) issues.push(`${relativeFile}: exact retired path ${retiredPath}`);
    }
    for (const basename of unambiguousRetiredBasenames) {
      if (source.includes(basename)) issues.push(`${relativeFile}: retired entrypoint ${basename}`);
    }
  }

  assert.deepEqual(issues, []);
});

test("packaged script catalogs enumerate only the current bounded top-level files", () => {
  const expected = Object.freeze([
    "wakeflow-bootstrap.mjs",
    "wakeflow-cli.mjs",
    "wakeflow-core-manifest.json",
    "wakeflow-setup.mjs",
    "wakeflow-smoke.mjs",
    "wakeflow-validate.mjs",
  ]);

  for (const edition of ["codex-wakeflow", "claude-code-wakeflow"]) {
    const scriptsRoot = path.join(repositoryRoot, "plugins", edition, "scripts");
    const actual = readdirSync(scriptsRoot)
      .filter((name) => /\.(?:json|mjs)$/u.test(name))
      .sort();
    assert.deepEqual(actual, expected, edition);
    const readme = readFileSync(path.join(scriptsRoot, "README.md"), "utf8");
    for (const name of expected) assert.match(readme, new RegExp(`\\b${name.replaceAll(".", "\\.")}\\b`, "u"));
  }
});
