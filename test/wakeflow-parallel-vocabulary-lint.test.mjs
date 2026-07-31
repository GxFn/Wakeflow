// Pod placement vocabulary contract.
//
// This suite deliberately replaces the retired "one shared Wakeflow
// worktree set / numeric pool" narrative. The current product contract is:
// mainline by default, Pod only with explicit user authority, a complete
// independent Pod fleet, product worktrees created by the host, and no
// numeric admission cap.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const RETIRED_NARRATIVE = [
  { pattern: /Parallelism exists ONLY at the demand level/i, label: "demand-level-only parallelism" },
  { pattern: /ONE worktree set/i, label: "one Wakeflow-owned worktree set" },
  { pattern: /shared Wakeflow worktree set/i, label: "shared Wakeflow worktree set" },
  { pattern: /pool-exhausted blocks at maxStreamsPerRepo/i, label: "numeric pool admission" },
  {
    pattern: /automatic(?:ally)? (?:assign|convert|place|select)[^\n]{0,100}(?:isolated|Pod)/i,
    label: "automatic Pod placement",
    allowedContext: /(?:does not|never|without)[\s\S]{0,180}automatic(?:ally)? (?:assign|convert|place|select)[^\n]{0,100}(?:isolated|Pod)/i,
  },
  {
    pattern: /Wakeflow[- ](?:created|managed|owned)[^\n]{0,80}(?:Git )?worktree/i,
    label: "Wakeflow-owned product worktree",
  },
];

const SCAN_EXTENSIONS = new Set([".md", ".mjs", ".cjs", ".json"]);
const EXCLUDED_DIRS = new Set(["node_modules", ".git"]);

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolute, files);
    } else if (entry.isFile() && SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(absolute);
    }
  }
  return files;
}

function containsRetiredNarrative(text, pattern, allowedContext) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matches = text.matchAll(new RegExp(pattern.source, flags));
  for (const match of matches) {
    const start = Math.max(0, (match.index ?? 0) - 220);
    const end = Math.min(text.length, (match.index ?? 0) + match[0].length + 220);
    const context = text.slice(start, end);
    if (!allowedContext || !allowedContext.test(context)) return true;
  }
  return false;
}

test("normative runtime surfaces do not restore the retired shared-worktree or numeric-pool design", () => {
  const normativeDirectories = [
    "plugins/claude-code-wakeflow/skills",
    "plugins/codex-wakeflow/skills",
  ];
  const files = [
    path.join(repoRoot, "README.md"),
    path.join(repoRoot, "README.zh-CN.md"),
    path.join(repoRoot, "core/lib/wakeflow-mcp-tools.mjs"),
    path.join(repoRoot, "core/scripts/wakeflow-pod.mjs"),
    path.join(repoRoot, "plugins/claude-code-wakeflow/CLAUDE.md"),
    path.join(repoRoot, "plugins/claude-code-wakeflow/README.md"),
    path.join(repoRoot, "plugins/claude-code-wakeflow/README.zh-CN.md"),
    path.join(repoRoot, "plugins/claude-code-wakeflow/lib/wakeflow-mcp-tools.mjs"),
    path.join(repoRoot, "plugins/claude-code-wakeflow/scripts/wakeflow-pod.mjs"),
    path.join(repoRoot, "plugins/codex-wakeflow/AGENTS.md"),
    path.join(repoRoot, "plugins/codex-wakeflow/README.md"),
    path.join(repoRoot, "plugins/codex-wakeflow/README.zh-CN.md"),
    path.join(repoRoot, "plugins/codex-wakeflow/lib/wakeflow-mcp-tools.mjs"),
    path.join(repoRoot, "plugins/codex-wakeflow/scripts/wakeflow-pod.mjs"),
    ...normativeDirectories.flatMap((directory) => walk(path.join(repoRoot, directory))),
  ];
  const violations = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const { pattern, label, allowedContext = null } of RETIRED_NARRATIVE) {
      const found = containsRetiredNarrative(text, pattern, allowedContext);
      if (found) {
        violations.push(`${path.relative(repoRoot, file)}: retired narrative "${label}"`);
      }
    }
  }
  assert.deepEqual(violations, [], `retired Pod contract found:\n${violations.join("\n")}`);
});

test("load-bearing host and skill surfaces retain the new placement and complete-Pod contract", () => {
  const surfaces = [
    "plugins/claude-code-wakeflow/CLAUDE.md",
    "plugins/codex-wakeflow/AGENTS.md",
    "plugins/claude-code-wakeflow/skills/wakeflow-governance/SKILL.md",
    "plugins/codex-wakeflow/skills/wakeflow-governance/SKILL.md",
    "plugins/claude-code-wakeflow/skills/wakeflow-controller/SKILL.md",
    "plugins/codex-wakeflow/skills/wakeflow-controller/SKILL.md",
  ];
  const requiredSemantics = [
    { pattern: /mainline (?:fleet )?(?:is )?(?:the )?default|Mainline first|\*\*Default:\*\*[\s\S]{0,120}mainline/i, label: "mainline default" },
    { pattern: /explicit[\s\S]{0,180}(?:user|authorization|authority)[\s\S]{0,180}Pod|Pod[\s\S]{0,180}explicit[\s\S]{0,180}(?:user|authorization|authority)/i, label: "explicit user Pod authority" },
    { pattern: /Controller__<pod>[\s\S]{0,180}Design__<pod>[\s\S]{0,180}Test__<pod>/i, label: "complete independent Pod roles" },
    { pattern: /host-(?:created|managed)[\s\S]{0,160}worktree|(?:Codex|Claude Code)[\s\S]{0,160}(?:owns|creates)[\s\S]{0,160}worktree|native[\s\S]{0,80}--worktree/i, label: "host-created product worktree" },
    { pattern: /no numeric[\s\S]{0,100}(?:Pod )?(?:admission )?limit|does not impose[\s\S]{0,80}numeric[\s\S]{0,80}limit|applies no numeric Pod limit/i, label: "no numeric Pod admission cap" },
  ];
  for (const relative of surfaces) {
    const text = readFileSync(path.join(repoRoot, relative), "utf8");
    for (const { pattern, label } of requiredSemantics) {
      assert.match(text, pattern, `${relative} must retain: ${label}`);
    }
  }
});
