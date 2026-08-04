#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadWorkspaceConfig, resolveWorkspaceRoot, workspaceConfigDiagnostics } from "./lib/wakeflow-config.mjs";
import { assertExistingPathInside } from "./lib/wakeflow-fs-safety.mjs";
import { documentPlacements } from "./lib/wakeflow-document-placement.mjs";
import {
  PRESERVED_DIR,
  PRESERVED_MANIFEST,
  preservedRetentionDays,
  readmeContents,
  scanStorage,
} from "./lib/wakeflow-storage-map.mjs";

const rawArgs = process.argv.slice(2);
const command = rawArgs[0] && !rawArgs[0].startsWith("--") ? rawArgs[0] : "map";
const options = rawArgs[0] && !rawArgs[0].startsWith("--") ? rawArgs.slice(1) : rawArgs;
const workspaceRoot = resolveWorkspaceRoot(options);
const write = options.includes("--write") || options.includes("--apply");
const json = options.includes("--json");

const helpText = `
Wakeflow local-storage map and hygiene

Usage:
  node scripts/wakeflow-storage.mjs map [--root <workspace>] [--json]
  node scripts/wakeflow-storage.mjs seed-readmes [--root <workspace>] [--write] [--json]
  node scripts/wakeflow-storage.mjs preserve --source <path> --reason <slug> [--note <text>] [--root <workspace>] [--write] [--json]
  node scripts/wakeflow-storage.mjs prune-preserved [--before <ISO date>] [--root <workspace>] [--apply] [--json]

Design:
  map is the read-only storage projection (wakeflow_view scope=storage):
  every known tree with class/size/age, plus legacy residue, unknown trees,
  and preserved/ entries. seed-readmes converges the in-place orientation
  READMEs. preserve is the ONE sanctioned manual-rescue move: it relocates a
  path into .wakeflow-local/preserved/<date>-<reason>/ and writes the
  MANIFEST. prune-preserved deletes preserved entries older than the
  retention (dry-run unless --apply). Nothing here ever auto-deletes legacy
  or unknown trees — those route to the user.
`.trim();

class CliExit extends Error {}

function getValue(name, fallback = null) {
  const eq = options.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const index = options.indexOf(name);
  if (index >= 0 && options[index + 1] && !options[index + 1].startsWith("--")) {
    return options[index + 1];
  }
  return fallback;
}

function output(payload, textLines = []) {
  const complete = { scriptComplete: true, ...payload };
  if (json) {
    console.log(JSON.stringify(complete, null, 2));
    return;
  }
  for (const line of textLines) console.log(line);
  if (complete.agentNext) console.log(`Agent next: ${complete.agentNext}`);
}

function fail(message) {
  output({ ok: false, command, error: message });
  process.exitCode = 1;
  throw new CliExit(message);
}

function relative(file) {
  return path.relative(workspaceRoot, file).split(path.sep).join("/") || ".";
}

function commandMap() {
  const config = loadWorkspaceConfig({ workspaceRoot, args: options });
  const configuration = workspaceConfigDiagnostics({ workspaceRoot, args: options, effectiveConfig: config });
  const scan = scanStorage({ workspaceRoot, config });
  const retentionDays = preservedRetentionDays(config);
  const now = Date.now();
  const aging = scan.preserved.filter((entry) => {
    if (!entry.newest) return false;
    return now - Date.parse(entry.newest) > retentionDays * 24 * 3600 * 1000;
  }).map((entry) => entry.name);
  output({
    ok: true,
    command: "map",
    configuration,
    layout: scan.layout,
    trees: scan.trees,
    legacy: scan.legacy,
    unknown: scan.unknown,
    preserved: scan.preserved,
    preservedRetentionDays: retentionDays,
    preservedAging: aging,
    forbiddenConclusions: [
      "storage-map-authorizes-deletion",
      "legacy-or-unknown-trees-are-safe-to-auto-delete",
    ],
    agentNext: scan.unknown.length > 0
      ? `Unknown tree(s) under .wakeflow-local (${scan.unknown.map((u) => u.path).join(", ")}): route to the user — fold keepers via 'wakeflow-storage preserve', never auto-delete.`
      : scan.legacy.length > 0
        ? `Legacy residue present (${scan.legacy.map((l) => l.path).join(", ")}): after user review, fold keepers via 'wakeflow-storage preserve' or delete; current runtime never writes these.`
        : aging.length > 0
          ? `Preserved entries past the ${retentionDays}-day retention (${aging.join(", ")}): review, then 'prune-preserved --apply' or keep with an updated manifest.`
          : "Storage is clean: known trees only, no aging preserved entries.",
  }, ["Storage map computed."]);
}

function commandSeedReadmes() {
  const config = loadWorkspaceConfig({ workspaceRoot, args: options });
  const ledgerRel = (config.projectLedgerRoot ?? "../wakeflow-ledger").split(path.sep).join("/");
  const ledgerRoot = path.resolve(workspaceRoot, config.projectLedgerRoot ?? "../wakeflow-ledger");
  const placements = documentPlacements({ workspaceRoot, config, displayRoot: ledgerRoot });
  const results = [];
  for (const item of readmeContents({
    ledgerRel,
    placements,
  })) {
    const file = path.resolve(workspaceRoot, item.file);
    // Seed only where the parent tier already exists — never invent layers.
    if (!existsSync(path.dirname(file))) {
      results.push({ file: item.file, status: "skipped-missing-parent" });
      continue;
    }
    const current = existsSync(file) ? readFileSync(file, "utf8") : null;
    if (current === item.content) {
      results.push({ file: item.file, status: "current" });
      continue;
    }
    if (write) {
      writeFileSync(file, item.content);
      results.push({ file: item.file, status: current === null ? "created" : "updated" });
    } else {
      results.push({ file: item.file, status: current === null ? "would-create" : "would-update" });
    }
  }
  output({
    ok: true,
    command: "seed-readmes",
    wrote: write,
    results,
    agentNext: write
      ? "In-place storage READMEs are converged; re-run after layout changes."
      : "Dry-run only; re-run with --write to converge the in-place READMEs.",
  }, results.map((r) => `${r.status}: ${r.file}`));
}

function commandPreserve() {
  const source = getValue("--source");
  const reason = getValue("--reason");
  if (!source) fail("--source <path> is required (the file or directory to preserve).");
  if (!reason) fail("--reason <slug> is required (lowercase-kebab, e.g. pre-migration-transport).");
  const reasonSlug = String(reason).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!reasonSlug) fail("--reason must contain at least one [a-z0-9] character.");
  const sourceAbs = path.resolve(workspaceRoot, source);
  if (!existsSync(sourceAbs)) fail(`--source does not exist: ${relative(sourceAbs)}`);
  const localRoot = path.join(workspaceRoot, ".wakeflow-local");
  let sourceSafety;
  try {
    sourceSafety = assertExistingPathInside({
      root: localRoot,
      candidate: sourceAbs,
      label: "preserve source",
    });
  } catch (error) {
    fail(error.message);
  }
  const preservedRoot = path.join(workspaceRoot, ".wakeflow-local", PRESERVED_DIR);
  if (existsSync(preservedRoot)) {
    try {
      assertExistingPathInside({
        root: localRoot,
        candidate: preservedRoot,
        label: "preserved storage root",
      });
    } catch (error) {
      fail(error.message);
    }
  }
  if (sourceAbs === preservedRoot || sourceAbs.startsWith(`${preservedRoot}${path.sep}`)) {
    fail("--source is already inside preserved/.");
  }
  const date = new Date().toISOString().slice(0, 10);
  let destName = `${date}-${reasonSlug}`;
  let dest = path.join(preservedRoot, destName);
  for (let n = 2; existsSync(dest); n += 1) {
    destName = `${date}-${reasonSlug}-${n}`;
    dest = path.join(preservedRoot, destName);
  }
  const manifest = [
    `# Preserved: ${destName}`,
    "",
    `- Preserved at: ${new Date().toISOString()}`,
    `- Source: ${relative(sourceAbs)}`,
    `- Reason: ${getValue("--note", reasonSlug)}`,
    `- Preserved by: wakeflow-storage preserve`,
    `- Retention: review after ${preservedRetentionDays(loadWorkspaceConfig({ workspaceRoot, args: options }))} days (prune-preserved lists it once aged)`,
    "",
    "Delete this entry (or the whole directory) once the audit need has passed;",
    "`wakeflow-storage prune-preserved` lists aged entries, `--apply` deletes them.",
  ].join("\n");
  if (!write) {
    output({
      ok: true,
      command: "preserve",
      wrote: false,
      wouldMove: {
        from: relative(sourceAbs),
        to: relative(dest),
        payload: sourceSafety.stat.isDirectory() ? "." : path.basename(sourceAbs),
      },
      agentNext: "Dry-run only; re-run with --write to move the source under preserved/ with its manifest.",
    }, [`Would preserve ${relative(sourceAbs)} -> ${relative(dest)}`]);
    return;
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  const payloadDest = sourceSafety.stat.isDirectory() ? dest : path.join(dest, path.basename(sourceAbs));
  if (!sourceSafety.stat.isDirectory()) mkdirSync(dest);
  try {
    renameSync(sourceAbs, payloadDest);
  } catch (error) {
    if (error.code === "EXDEV") {
      cpSync(sourceAbs, payloadDest, { recursive: true });
      rmSync(sourceAbs, { recursive: true, force: true });
    } else {
      throw error;
    }
  }
  writeFileSync(path.join(dest, PRESERVED_MANIFEST), `${manifest}\n`);
  output({
    ok: true,
    command: "preserve",
    wrote: true,
    moved: {
      from: relative(sourceAbs),
      to: relative(dest),
      payload: sourceSafety.stat.isDirectory() ? "." : path.basename(sourceAbs),
    },
    manifest: relative(path.join(dest, PRESERVED_MANIFEST)),
    agentNext: "Preserved with manifest. prune-preserved will surface it once it ages past retention.",
  }, [`Preserved ${relative(sourceAbs)} -> ${relative(dest)}`]);
}

function commandPrunePreserved() {
  const config = loadWorkspaceConfig({ workspaceRoot, args: options });
  const retentionDays = preservedRetentionDays(config);
  const beforeArg = getValue("--before");
  const cutoff = beforeArg ? Date.parse(beforeArg) : Date.now() - retentionDays * 24 * 3600 * 1000;
  if (Number.isNaN(cutoff)) fail(`--before is not a parseable date: ${beforeArg}`);
  const scan = scanStorage({ workspaceRoot, config });
  const candidates = scan.preserved.filter((entry) => entry.newest && Date.parse(entry.newest) < cutoff);
  const kept = scan.preserved.filter((entry) => !candidates.includes(entry));
  if (!write) {
    output({
      ok: true,
      command: "prune-preserved",
      wrote: false,
      cutoff: new Date(cutoff).toISOString(),
      retentionDays: beforeArg ? null : retentionDays,
      candidates,
      keptCount: kept.length,
      forbiddenConclusions: ["prune-candidates-are-pre-approved-deletions"],
      agentNext: candidates.length > 0
        ? "Review each candidate's MANIFEST.md, then re-run with --apply to delete the listed entries."
        : "No preserved entry is older than the cutoff.",
    }, [`${candidates.length} preserved candidate(s) older than ${new Date(cutoff).toISOString()}.`]);
    return;
  }
  const deleted = [];
  for (const entry of candidates) {
    rmSync(path.resolve(workspaceRoot, entry.path), { recursive: true, force: true });
    deleted.push(entry.path);
  }
  output({
    ok: true,
    command: "prune-preserved",
    wrote: true,
    cutoff: new Date(cutoff).toISOString(),
    deleted,
    keptCount: kept.length,
    agentNext: deleted.length > 0
      ? "Aged preserved entries deleted; the storage map reflects the new state."
      : "Nothing to delete.",
  }, deleted.map((p) => `deleted: ${p}`));
}

function main() {
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(helpText);
    return;
  }
  if (command === "map") return commandMap();
  if (command === "seed-readmes") return commandSeedReadmes();
  if (command === "preserve") return commandPreserve();
  if (command === "prune-preserved") return commandPrunePreserved();
  fail(`unknown command: ${command}. See help.`);
}

try {
  main();
} catch (error) {
  if (!(error instanceof CliExit)) {
    output({ ok: false, command, error: error.message });
    process.exitCode = 1;
  }
}
