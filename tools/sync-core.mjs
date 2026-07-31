#!/usr/bin/env node

/**
 * Sync the shared Wakeflow core into every plugin artifact.
 *
 * `core/` is the source of truth for host-neutral runtime files. Each plugin
 * artifact (plugins/codex-wakeflow, plugins/claude-code-wakeflow) is a
 * self-contained marketplace install surface, so synced files are committed
 * inside each artifact as plain copies.
 *
 * Usage:
 *   node scripts/sync-core.mjs            # copy core files into all targets
 *   node scripts/sync-core.mjs --check    # fail when any target drifts from core
 *
 * Host-layer files are never written by this script. Each target owns its own
 * host profile, host artifact checks, host send adapter, manifests, README,
 * memory-file template, skills, and template bundle; --check only verifies
 * that those contract files exist.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function argValue(name, fallback = null) {
  const args = process.argv.slice(2);
  const equals = args.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")
    ? args[index + 1]
    : fallback;
}

const defaultRepoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(argValue("--repo-root", defaultRepoRoot));
const coreRoot = path.join(repoRoot, "core");
const check = process.argv.includes("--check");
const CORE_MANIFEST = "scripts/wakeflow-core-manifest.json";

const TARGETS = [
  {
    dir: "plugins/codex-wakeflow",
    manifest: ".codex-plugin/plugin.json",
    memoryFile: "AGENTS.md",
  },
  {
    dir: "plugins/claude-code-wakeflow",
    manifest: ".claude-plugin/plugin.json",
    memoryFile: "CLAUDE.md",
  },
];

const HOST_CONTRACT_FILES = (target) => [
  target.manifest,
  ".mcp.json",
  target.memoryFile,
  "README.md",
  "README.zh-CN.md",
  "package.json",
  "scripts/README.md",
  "scripts/lib/wakeflow-host-profile.mjs",
  "scripts/lib/wakeflow-host-artifact-checks.mjs",
  "scripts/lib/wakeflow-host-send-adapter.mjs",
  "skills/wakeflow-controller/SKILL.md",
  "skills/wakeflow-target/SKILL.md",
  "skills/wakeflow-governance/SKILL.md",
  "templates/wakeflow-template-bundle.json",
];

const HOST_LOCAL_CORE_FILES = new Set([
  "scripts/lib/wakeflow-host-profile.mjs",
]);

function listCoreFiles(directory = coreRoot) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listCoreFiles(absolute));
    } else if (entry.isFile()) {
      const relative = path.relative(coreRoot, absolute);
      if (HOST_LOCAL_CORE_FILES.has(relative)) continue;
      files.push(relative);
    }
  }
  return files.sort();
}

function sameContent(a, b) {
  if (!existsSync(a) || !existsSync(b)) return false;
  return readFileSync(a).equals(readFileSync(b));
}

function validManagedPath(relative) {
  return Boolean(relative)
    && !path.isAbsolute(relative)
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !relative.split(/[\\/]/u).includes("..");
}

function readManagedManifest(targetRoot) {
  const file = path.join(targetRoot, CORE_MANIFEST);
  if (!existsSync(file)) return { file, value: null, issue: `${path.relative(repoRoot, file)} is missing` };
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (value?.schemaVersion !== 1 || value?.source !== "core" || !Array.isArray(value.files)) {
      return { file, value: null, issue: `${path.relative(repoRoot, file)} has an invalid shape` };
    }
    if (value.files.some((relative) => !validManagedPath(relative))) {
      return { file, value: null, issue: `${path.relative(repoRoot, file)} contains an unsafe managed path` };
    }
    return { file, value, issue: null };
  } catch (error) {
    return { file, value: null, issue: `${path.relative(repoRoot, file)} is unreadable: ${error.message}` };
  }
}

function expectedManifest(coreFiles) {
  return {
    schemaVersion: 1,
    source: "core",
    files: coreFiles,
  };
}

if (!existsSync(coreRoot) || !statSync(coreRoot).isDirectory()) {
  console.error("core/ directory is missing; nothing to sync.");
  process.exitCode = 1;
} else {
  const coreFiles = listCoreFiles();
  const issues = [];
  let copied = 0;

  for (const target of TARGETS) {
    const targetRoot = path.join(repoRoot, target.dir);
    if (!existsSync(targetRoot)) {
      if (check) {
        issues.push(`${target.dir}: target artifact directory is missing`);
        continue;
      }
      mkdirSync(targetRoot, { recursive: true });
    }

    const managed = readManagedManifest(targetRoot);
    const stale = (managed.value?.files ?? [])
      .filter((relative) => !coreFiles.includes(relative))
      .filter((relative) => existsSync(path.join(targetRoot, relative)));
    if (check) {
      if (managed.issue) issues.push(managed.issue);
      for (const relative of stale) {
        issues.push(`${target.dir}/${relative} is a stale core-managed file`);
      }
      const expected = JSON.stringify(expectedManifest(coreFiles));
      const actual = managed.value ? JSON.stringify(managed.value) : null;
      if (managed.value && actual !== expected) {
        issues.push(`${target.dir}/${CORE_MANIFEST} does not match the current core file set`);
      }
    } else {
      for (const relative of stale) {
        rmSync(path.join(targetRoot, relative), { force: true });
      }
    }

    for (const relative of coreFiles) {
      const source = path.join(coreRoot, relative);
      const destination = path.join(targetRoot, relative);
      if (sameContent(source, destination)) continue;
      if (check) {
        issues.push(`${target.dir}/${relative} drifts from core/${relative}`);
        continue;
      }
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(source, destination);
      copied += 1;
    }

    for (const relative of HOST_CONTRACT_FILES(target)) {
      const required = path.join(targetRoot, relative);
      if (!existsSync(required)) {
        issues.push(`${target.dir}/${relative} is missing (host contract file)`);
      }
    }

    if (!check) {
      mkdirSync(path.dirname(managed.file), { recursive: true });
      writeFileSync(managed.file, `${JSON.stringify(expectedManifest(coreFiles), null, 2)}\n`);
    }
  }

  const payload = {
    ok: issues.length === 0,
    mode: check ? "check" : "sync",
    coreFiles: coreFiles.length,
    targets: TARGETS.map((target) => target.dir),
    copied: check ? undefined : copied,
    issues,
  };

  if (issues.length > 0) {
    console.error(JSON.stringify(payload, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }
}
