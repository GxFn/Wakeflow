import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const coreSkillsRoot = path.join(repositoryRoot, "core/skills");

const skillLayouts = {
  "wakeflow-design": [
    "SKILL.md",
    "assets/original-plan.md",
    "assets/requirement-design.md",
    "references/clarification.md",
    "references/design-handoff.md",
    "references/option-planning.md",
    "references/requirement-design.md",
    "references/work-slicing.md",
  ],
  "wakeflow-test": [
    "SKILL.md",
    "references/debugging-triage.md",
    "references/regression-advisory.md",
    "references/risk-strategy.md",
    "references/self-evidence-review.md",
  ],
  "wakeflow-target-craft": [
    "SKILL.md",
  ],
};

const artifactRoots = [
  path.join(repositoryRoot, "plugins/codex-wakeflow"),
  path.join(repositoryRoot, "plugins/claude-code-wakeflow"),
];

function listFiles(root, base = root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(absolute, base));
    } else if (entry.isFile()) {
      files.push(path.relative(base, absolute).split(path.sep).join("/"));
    }
  }
  return files.sort();
}

function readTree(root) {
  return listFiles(root)
    .map((relative) => readFileSync(path.join(root, relative), "utf8"))
    .join("\n");
}

function parseSkillFrontmatter(file) {
  const content = readFileSync(file, "utf8");
  const match = content.match(/^---\n([\s\S]*?)\n---\n/u);
  assert.ok(match, `${file} must start with YAML frontmatter`);
  const entries = match[1]
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const separator = line.indexOf(":");
      assert.notEqual(separator, -1, `${file} has malformed frontmatter: ${line}`);
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    });
  assert.deepEqual(
    entries.map(([key]) => key).sort(),
    ["description", "name"],
    `${file} frontmatter may contain only name and description`,
  );
  return Object.fromEntries(entries);
}

function markdownTargets(file) {
  const content = readFileSync(file, "utf8");
  const targets = [];
  for (const match of content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
    let target = match[1].trim();
    if (!target || target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/iu.test(target)) continue;
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    target = decodeURIComponent(target.split("#", 1)[0]);
    assert.ok(target, `${file} contains an empty local Markdown target`);
    targets.push(target);
  }
  return targets;
}

function assertMarkdownClosure(skillRoot, entryRelative = "SKILL.md") {
  const resolvedRoot = path.resolve(skillRoot);
  const entry = path.join(resolvedRoot, entryRelative);
  const pending = [entry];
  const visited = new Set();

  while (pending.length > 0) {
    const file = pending.shift();
    if (visited.has(file)) continue;
    assert.equal(existsSync(file), true, `${file} is missing`);
    assert.equal(statSync(file).isFile(), true, `${file} must be a file`);
    visited.add(file);

    for (const target of markdownTargets(file)) {
      const resolved = path.resolve(path.dirname(file), target);
      assert.ok(
        resolved.startsWith(`${resolvedRoot}${path.sep}`),
        `${path.relative(resolvedRoot, file)} link escapes its Skill root: ${target}`,
      );
      assert.equal(existsSync(resolved), true, `${path.relative(resolvedRoot, file)} links to missing ${target}`);
      assert.equal(statSync(resolved).isFile(), true, `${target} must resolve to a file`);
      if (path.extname(resolved).toLowerCase() === ".md") pending.push(resolved);
    }
  }

  const markdownFiles = listFiles(resolvedRoot)
    .filter((relative) => relative.endsWith(".md"))
    .map((relative) => path.join(resolvedRoot, relative));
  assert.deepEqual(
    [...visited].sort(),
    markdownFiles.sort(),
    `${skillRoot} contains orphan Markdown that is not recursively reachable from ${entryRelative}`,
  );
  return new Set([...visited].map((file) => path.relative(resolvedRoot, file).split(path.sep).join("/")));
}

test("shared Design, Test, and Target Craft Skills have the exact canonical file surface", () => {
  for (const [skill, expected] of Object.entries(skillLayouts)) {
    const root = path.join(coreSkillsRoot, skill);
    assert.equal(existsSync(root), true, `${skill} canonical root is missing`);
    assert.deepEqual(listFiles(root), [...expected].sort());

    for (const relative of expected) {
      const content = readFileSync(path.join(root, relative), "utf8");
      assert.doesNotMatch(content, /[\u3400-\u9fff]/u, `${skill}/${relative} must remain English`);
      assert.doesNotMatch(
        content,
        /\bPCV\b|progressive-chain-validation/iu,
        `${skill}/${relative} must not absorb the excluded advanced capability`,
      );
      if (relative !== "SKILL.md") {
        assert.doesNotMatch(content, /^---\n/u, `${skill}/${relative} must not introduce another Skill entry`);
      }
    }

    assert.equal(expected.some((relative) => path.basename(relative).toLowerCase() === "readme.md"), false);
    assert.equal(expected.includes("agents/openai.yaml"), false);
  }
});

test("shared Skill frontmatter contains only name and trigger description", () => {
  for (const skill of Object.keys(skillLayouts)) {
    const frontmatter = parseSkillFrontmatter(path.join(coreSkillsRoot, skill, "SKILL.md"));
    assert.equal(frontmatter.name, skill);
    assert.match(frontmatter.description, /^Use when\b/u);
  }
});

test("shared Skill Markdown links stay contained, resolve, and leave no orphans", () => {
  for (const skill of Object.keys(skillLayouts)) {
    assertMarkdownClosure(path.join(coreSkillsRoot, skill));
  }
});

test("Design remains draft-only until explicit wakeflow_deliver confirmation", () => {
  const content = readTree(path.join(coreSkillsRoot, "wakeflow-design"));
  assert.match(content, /explicit(?:ly)? confirm/iu);
  assert.match(content, /wakeflow_deliver/u);
  assert.match(content, /Do not edit product code/iu);
  assert.match(content, /Do not hand-edit the global TODO\/Backlog/iu);
  assert.match(content, /Do not dispatch implementation/iu);
  assert.match(content, /Do not .*accept\/reject target results/iu);
  assert.match(content, /non-authoritative Design draft/iu);
  assert.match(content, /wakeflow_view[\s\S]*operation: "config"/u);
  assert.match(content, /wakeflow_next_work[\s\S]*operation: "inspect"/u);
  assert.match(content, /result\.contentDigest[\s\S]*expectedBoardDigest/u);
  assert.match(content, /exactly these 13 string fields/iu);
  const lines = new Set(content.split("\n").map((line) => line.trim()));
  for (const column of [
    "ID",
    "Status",
    "Type",
    "Priority",
    "Owner",
    "Item / Goal",
    "Affects Retest / Dispatch",
    "Dependency / Trigger",
    "Recommended Window",
    "Current Mount",
    "Auto Claim",
    "Testing Decision",
    "Documents",
  ]) {
    assert.equal(lines.has(column), true, `Design delivery procedure must name exact TODO column ${column}`);
  }
  assert.match(content, /operation: "append"[\s\S]*request: \{ row, expectedBoardDigest \}/u);
  assert.match(content, /does not resolve the `Documents` targets[\s\S]*freeze `demand-authority`/iu);
  assert.doesNotMatch(content, /\bdemandAuthority\b|\bautoClaim\s*:/u);
});

test("Test stays inside controller gates and returns non-acceptance evidence", () => {
  const content = readTree(path.join(coreSkillsRoot, "wakeflow-test"));
  assert.match(content, /Controller-accepted implementation validation/iu);
  assert.match(content, /Controller-scoped Test-only diagnostic/iu);
  assert.match(content, /PRODUCT SOURCE IS READ-ONLY, ALWAYS/iu);
  assert.match(content, /confirmed Test environment/iu);
  assert.match(content, /card may explicitly authorize only/iu);
  assert.match(content, /Test-owned assets[\s\S]*harnesses\/[\s\S]*fixtures\//iu);
  assert.match(content, /strict `TargetResult`/u);
  assert.match(content, /artifactKind` is `wakeflow-target-result`/u);
  assert.match(content, /evidenceLocators[\s\S]*\{ kind, ref, digest \}/u);
  assert.match(content, /craftMapping[\s\S]*kind: "test-step", planIndex, step, ref/u);
  assert.match(content, /maps every approved plan step exactly once and in[\s\S]*order/iu);
  assert.match(content, /TEST EVIDENCE IS REVIEW INPUT, NEVER CONTROLLER ACCEPTANCE/iu);
  assert.match(content, /Self-evidence review[\s\S]*only the controller independently validates[\s\S]*decides[\s\S]*acceptance/iu);
  assert.match(content, /controller\s+must\s+independently\s+inspect\s+and\s+validate/iu);
  assert.doesNotMatch(content, /product (?:fix|repair) unless authorized by (?:the )?(?:test )?card/iu);
  assert.doesNotMatch(content, /TargetResultEnvelope|\bevidenceContract\b|\btestExecution\b/u);
});

test("Target Craft teaches the strict v3 packet and result contract", () => {
  const content = readTree(path.join(coreSkillsRoot, "wakeflow-target-craft"));
  assert.match(content, /one immutable TaskPackage for one target task/u);
  assert.match(content, /reviewInputContract\.requiredKinds/u);
  assert.match(content, /testContract\.executionContract/u);
  assert.match(content, /artifactKind: "wakeflow-target-result"/u);
  assert.match(content, /Every review input is an exact locator:[\s\S]*\{ kind, ref, digest \}/u);
  assert.match(content, /kind: "acceptance-anchor", anchorId, evidenceRefs: \[\{ ref, digest \}\]/u);
  assert.match(content, /kind: "test-step", planIndex, step, ref/u);
  assert.match(content, /does not expose a `reworkCount` or[\s\S]*`recurringProblem` field/iu);
  assert.match(content, /There is no global machine-owned evidence-kind taxonomy/iu);
  assert.doesNotMatch(
    content,
    /TargetResultEnvelope|\bevidenceContract\b|\btestExecution\b|pending-merges|anchorId, red, green/u,
  );
});

test("host governance entries recursively route to the shared Design/Test source map", () => {
  const routeLines = [];
  for (const artifactRoot of artifactRoots) {
    const governanceRoot = path.join(artifactRoot, "skills/wakeflow-governance");
    const reachable = assertMarkdownClosure(governanceRoot);
    assert.equal(
      reachable.has("references/design-test-skill-realization-source-map.md"),
      true,
      `${artifactRoot} governance Skill must route to the Design/Test source map`,
    );
    const routeLine = readFileSync(path.join(governanceRoot, "SKILL.md"), "utf8")
      .split("\n")
      .find((line) => line.includes("design-test-skill-realization-source-map.md"));
    assert.ok(routeLine, `${artifactRoot} is missing the source-map route line`);
    routeLines.push(routeLine);
  }
  assert.equal(routeLines[0], routeLines[1], "both host governance Skills must use the same business route text");
});

test("Design/Test source map names canonical shared paths and self-evidence ownership", () => {
  const sourceMap = readFileSync(
    path.join(coreSkillsRoot, "wakeflow-governance/references/design-test-skill-realization-source-map.md"),
    "utf8",
  );
  assert.match(sourceMap, /core\/skills\/wakeflow-design\/SKILL\.md/u);
  assert.match(sourceMap, /core\/skills\/wakeflow-test\/SKILL\.md/u);
  assert.match(sourceMap, /references\/self-evidence-review\.md/u);
  assert.match(sourceMap, /plugin-discovered shared Skills/iu);
  assert.match(sourceMap, /`sync-core`[\s\S]*byte-for-byte/iu);
  assert.match(sourceMap, /strict TODO append[\s\S]*strict `wakeflow-target-result` artifacts/iu);
  assert.match(sourceMap, /all three shared Skill directories into both artifacts/iu);
  assert.doesNotMatch(sourceMap, /templates\/window-support/u);
  assert.doesNotMatch(sourceMap, /`evidence-review`|testing\/skills\/evidence-review/u);
  assert.doesNotMatch(sourceMap, /TargetResultEnvelope|\bevidenceContract\b|\btestExecution\b/u);
});

test("both host script references preserve the same canonical asset ownership contract", () => {
  const sections = artifactRoots.map((artifactRoot) => {
    const content = readFileSync(
      path.join(artifactRoot, "skills/wakeflow-governance/references/script-pipeline.md"),
      "utf8",
    );
    const match = content.match(/## Canonical Asset Ownership\n([\s\S]*?)(?=\n## )/u);
    assert.ok(match, `${artifactRoot} is missing Canonical Asset Ownership`);
    return match[1];
  });
  assert.equal(sections[0], sections[1], "host script references must keep this business contract identical");
  assert.match(sections[0], /core\/template-sources\//u);
  assert.match(sections[0], /npm run sync:core/u);
  assert.match(sections[0], /Active index\/current-status projections, global TODO content, ledger indexes/iu);
  assert.match(sections[0], /root\/repository\/Design\/Test memory[\s\S]*domain owners/iu);
  assert.match(sections[0], /two localized demand-progress[\s\S]*wakeflow-asset-bundle\.json/iu);
  assert.match(sections[0], /wakeflow-template-bundle\.json[\s\S]*not a compatibility\s+surface/iu);
});

test("synchronized host artifacts byte-match every shared Skill file", (t) => {
  const expectedManaged = Object.entries(skillLayouts)
    .flatMap(([skill, files]) => files.map((relative) => `skills/${skill}/${relative}`))
    .sort();
  const presentCounts = artifactRoots.map((artifactRoot) => (
    expectedManaged.filter((relative) => existsSync(path.join(artifactRoot, relative))).length
  ));
  if (presentCounts.every((count) => count === 0)) {
    t.skip("shared Skill artifacts have not been synchronized yet");
    return;
  }
  assert.deepEqual(
    presentCounts,
    artifactRoots.map(() => expectedManaged.length),
    "shared Skill synchronization must not leave a partial host surface",
  );

  const manifests = artifactRoots.map((artifactRoot) => JSON.parse(
    readFileSync(path.join(artifactRoot, "scripts/wakeflow-core-manifest.json"), "utf8"),
  ));
  const synchronized = manifests.map((manifest) => (
    expectedManaged.every((relative) => manifest.files.includes(relative))
  ));
  assert.equal(synchronized.every(Boolean), true, "shared Skill synchronization must not be partial across hosts");

  const sharedFiles = [
    ...expectedManaged,
    "skills/wakeflow-governance/references/design-test-skill-realization-source-map.md",
  ];
  for (const artifactRoot of artifactRoots) {
    for (const relative of sharedFiles) {
      const source = path.join(repositoryRoot, "core", relative);
      const artifact = path.join(artifactRoot, relative);
      assert.equal(existsSync(artifact), true, `${artifact} is missing after synchronization`);
      assert.equal(
        readFileSync(artifact).equals(readFileSync(source)),
        true,
        `${artifact} must byte-match ${source}`,
      );
    }
    for (const [skill, expected] of Object.entries(skillLayouts)) {
      assert.deepEqual(
        listFiles(path.join(artifactRoot, "skills", skill)),
        [...expected].sort(),
        `${artifactRoot} must not add host-local files to ${skill}`,
      );
    }
  }
});
