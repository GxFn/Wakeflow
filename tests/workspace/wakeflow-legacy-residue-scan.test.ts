import { deepEqual, equal } from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  LEDGER_ARCHIVES_ROOT_REF,
  LEDGER_REQUIREMENTS_ROOT_REF,
  LEDGER_TRANSACTIONS_ROOT_REF,
} from "../../src/governance/ledger/ledger-authority-paths.js";

import {
  scanWakeflowLegacyResidue,
  WAKEFLOW_CURRENT_LEDGER_ENTRY_NAMES,
  WAKEFLOW_LEGACY_RESIDUE_MAXIMUM_ITEMS,
} from "../../src/workspace/wakeflow-legacy-residue-scan.js";
import { disposableRoot } from "../support/temp-root.js";

const REPOSITORY_KEY = "repository.repository_22222222-2222-4222-8222-222222222222.root";

/** 目录下每个文件的相对路径与内容：用来证明扫描是只读的。 */
function* require_fs_snapshot(root: string, relative = ""): Generator<readonly [string, string]> {
  for (const name of readdirSync(path.join(root, relative)).sort()) {
    const child = relative === "" ? name : `${relative}/${name}`;
    const absolute = path.join(root, child);
    if (statSync(absolute).isDirectory()) yield* require_fs_snapshot(root, child);
    else yield [child, readFileSync(absolute, "utf8")] as const;
  }
}

test("legacy residue scan reports scope blocks, broad rules, additionalDirectories, root markers and the ledger sibling read-only, per root and in a fixed order（F4，ADR-0020，§13.168）", async (t) => {
  const parent = disposableRoot(t, "wakeflow-legacy-residue-");
  const workspace = path.join(parent, "Workspace");
  const repository = path.join(parent, "ProductA");
  mkdirSync(workspace);
  mkdirSync(repository);
  writeFileSync(path.join(workspace, "AGENTS.md"), "# Workspace\n");
  writeFileSync(
    path.join(repository, "CLAUDE.md"),
    "# Product\n\n<!-- wakeflow:scope:start -->\nold reading order\n<!-- wakeflow:scope:end -->\n",
  );
  mkdirSync(path.join(repository, ".claude"));
  writeFileSync(
    path.join(repository, ".claude", "settings.json"),
    `${JSON.stringify(
      {
        permissions: {
          allow: ["Read(./docs/**)", "Bash(tmux *)", "Bash(node *)"],
          additionalDirectories: [".."],
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(path.join(repository, ".claude", "settings.local.json"), "{ not json\n");
  writeFileSync(path.join(repository, ".workspace-active"), "");
  mkdirSync(path.join(repository, ".wakeflow-stage-20260101"));
  mkdirSync(path.join(parent, "wakeflow-ledger"));
  const before = JSON.stringify([...require_fs_snapshot(repository)]);

  const scan = await scanWakeflowLegacyResidue([
    { key: "workspace.root", absolutePath: workspace },
    { key: REPOSITORY_KEY, absolutePath: repository },
  ]);
  deepEqual(scan.items, [
    // 两个根共用一个上层目录：旁边的 ledger 目录只报一次，报在先看到它的根上。
    {
      root: "workspace.root",
      kind: "ledger-directory",
      path: "../wakeflow-ledger",
      line: null,
      detail: null,
    },
    {
      root: REPOSITORY_KEY,
      kind: "scope-block",
      path: "CLAUDE.md",
      line: 3,
      detail: "<!-- wakeflow:scope:start -->",
    },
    {
      root: REPOSITORY_KEY,
      kind: "broad-permission",
      path: ".claude/settings.json",
      line: 6,
      detail: "Bash(node *)",
    },
    {
      root: REPOSITORY_KEY,
      kind: "broad-permission",
      path: ".claude/settings.json",
      line: 5,
      detail: "Bash(tmux *)",
    },
    {
      root: REPOSITORY_KEY,
      kind: "additional-directories",
      path: ".claude/settings.json",
      line: 8,
      detail: "..",
    },
    {
      root: REPOSITORY_KEY,
      kind: "root-marker",
      path: ".wakeflow-stage-20260101",
      line: null,
      detail: null,
    },
    {
      root: REPOSITORY_KEY,
      kind: "root-marker",
      path: ".workspace-active",
      line: null,
      detail: null,
    },
  ]);
  // 解析不出的 settings.local.json 计 unreadable，不是"没有残留"。
  equal(scan.unreadable, 1);
  equal(scan.omitted, 0);
  equal(Object.isFrozen(scan.items), true);
  // 只读：扫描前后仓库内容一字不改。
  equal(JSON.stringify([...require_fs_snapshot(repository)]), before);
});

test("legacy residue scan caps at 64 items and counts the rest, and counts a vanished root as unreadable", async (t) => {
  const parent = disposableRoot(t, "wakeflow-legacy-residue-cap-");
  const root = path.join(parent, "Workspace");
  mkdirSync(root);
  for (let index = 0; index < WAKEFLOW_LEGACY_RESIDUE_MAXIMUM_ITEMS + 6; index += 1) {
    mkdirSync(path.join(root, `.wakeflow-create-stage-${String(index).padStart(3, "0")}`));
  }
  const scan = await scanWakeflowLegacyResidue([
    { key: "workspace.root", absolutePath: root },
    {
      key: "support.surface_33333333-3333-4333-8333-333333333333.root",
      absolutePath: path.join(parent, "gone"),
    },
  ]);
  equal(scan.items.length, WAKEFLOW_LEGACY_RESIDUE_MAXIMUM_ITEMS);
  equal(scan.omitted, 6);
  equal(
    scan.items.every((item) => item.kind === "root-marker" && item.root === "workspace.root"),
    true,
  );
  equal(scan.unreadable, 1);
});

test("a sibling wakeflow-ledger that carries the current ledger layout is another workspace's live ledger, not residue（§13.181 F-L1-4）", async (t) => {
  const parent = disposableRoot(t, "wakeflow-legacy-residue-ledger-");
  const workspace = path.join(parent, "Workspace");
  mkdirSync(workspace);
  const ledger = path.join(parent, "wakeflow-ledger");
  mkdirSync(ledger);
  for (const name of WAKEFLOW_CURRENT_LEDGER_ENTRY_NAMES) mkdirSync(path.join(ledger, name));
  const current = await scanWakeflowLegacyResidue([
    { key: "workspace.root", absolutePath: workspace },
  ]);
  deepEqual(current.items, []);
  // 少一个顶层目录就不是现役账本：仍按 0.9.x 残留报告。
  rmSync(path.join(ledger, "transactions"), { recursive: true });
  const partial = await scanWakeflowLegacyResidue([
    { key: "workspace.root", absolutePath: workspace },
  ]);
  deepEqual(
    partial.items.map((item) => [item.kind, item.path]),
    [["ledger-directory", "../wakeflow-ledger"]],
  );
  deepEqual(
    [...WAKEFLOW_CURRENT_LEDGER_ENTRY_NAMES],
    [LEDGER_ARCHIVES_ROOT_REF, LEDGER_REQUIREMENTS_ROOT_REF, LEDGER_TRANSACTIONS_ROOT_REF],
  );
});
