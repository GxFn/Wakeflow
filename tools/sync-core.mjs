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

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coreRoot = path.join(repoRoot, "core");
const check = process.argv.includes("--check");

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
