// Parallel-vocabulary contract lint: the unified multi-demand model has one
// narrative — parallelism ONLY at the demand level, one window + one combined
// task package per repo within a demand, one shared worktree set per pod.
// This lint keeps semantic-drift terms from the deleted within-demand-parallel
// design out of code and prose (both editions + core + tests), and pins the
// canonical sentences in the load-bearing surfaces. docs/ is exempt: it keeps
// the superseded design history (roadmap §4.5 records the deletion) and may
// QUOTE banned terms when describing this very lint.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const BANNED = [
  // The within-demand parallel-stream era must not resurface in runtime
  // narrative or code. Historical docs live in docs/ (exempt).
  { pattern: /parallel stream/i, label: "parallel stream" },
  { pattern: /波内并行/, label: "波内并行" },
  { pattern: /同仓多\s*stream/i, label: "同仓多 stream" },
];

const SCAN_ROOTS = ["core", "plugins", "test", "tools"];
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

test("semantic-drift parallel vocabulary stays out of code and runtime prose", () => {
  const files = [
    ...SCAN_ROOTS.flatMap((root) => walk(path.join(repoRoot, root))),
    path.join(repoRoot, "README.md"),
    path.join(repoRoot, "README.zh-CN.md"),
  ];
  // This lint file quotes the banned terms by necessity.
  const self = new URL(import.meta.url).pathname;
  const violations = [];
  for (const file of files) {
    if (path.resolve(file) === path.resolve(self)) continue;
    const text = readFileSync(file, "utf8");
    for (const { pattern, label } of BANNED) {
      if (pattern.test(text)) {
        violations.push(`${path.relative(repoRoot, file)}: banned term "${label}"`);
      }
    }
  }
  assert.deepEqual(violations, [], `semantic-drift terms found:\n${violations.join("\n")}`);
});

test("the canonical demand-level parallelism sentences stay pinned in both editions", () => {
  const surfaces = [
    { file: "plugins/claude-code-wakeflow/CLAUDE.md", must: ["Parallelism exists ONLY at the demand level", "ONE worktree set"] },
    { file: "plugins/codex-wakeflow/AGENTS.md", must: ["Parallelism exists ONLY at the demand level", "ONE worktree set"] },
    { file: "plugins/claude-code-wakeflow/skills/wakeflow-governance/SKILL.md", must: ["ONE combined task package", "ONE worktree set"] },
    { file: "plugins/codex-wakeflow/skills/wakeflow-governance/SKILL.md", must: ["one combined task package", "ONE worktree set"] },
    { file: "plugins/claude-code-wakeflow/skills/wakeflow-controller/SKILL.md", must: ["ONE combined task package", "CROSS-DEMAND isolation only"] },
    { file: "plugins/codex-wakeflow/skills/wakeflow-controller/SKILL.md", must: ["ONE combined task package", "CROSS-DEMAND isolation only"] },
  ];
  for (const surface of surfaces) {
    // Markdown wraps lines: collapse whitespace so a fragment split across a
    // line break still counts as present.
    const text = readFileSync(path.join(repoRoot, surface.file), "utf8").replace(/\s+/g, " ");
    for (const sentence of surface.must) {
      assert.ok(
        text.includes(sentence),
        `${surface.file} must carry the canonical sentence fragment: "${sentence}"`,
      );
    }
  }
});
