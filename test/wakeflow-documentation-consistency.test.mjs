import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

function markdownFilesUnder(relative) {
  const absolute = path.join(root, relative);
  const files = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...markdownFilesUnder(child));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(child);
  }
  return files;
}

const hosts = [
  { dir: "plugins/codex-wakeflow", memory: "AGENTS.md" },
  { dir: "plugins/claude-code-wakeflow", memory: "CLAUDE.md" },
];

test("execution-facing prompt docs match the layered target prompt contract", () => {
  for (const host of hosts) {
    const files = [
      `${host.dir}/skills/wakeflow-target/SKILL.md`,
      `${host.dir}/skills/wakeflow-governance/references/window-dispatch.md`,
      `${host.dir}/skills/wakeflow-governance/references/wakeflow-delivery.md`,
    ];
    for (const file of files) {
      const text = read(file);
      assert.match(text, /Priority context/);
      assert.match(text, /Critical boundary/);
      assert.match(text, /Key acceptance anchors/);
      assert.match(text, /Workspace instructions/);
      assert.match(text, /Current state root/);
      assert.match(text, /Required execution Skills/);
      assert.match(text, /Test execution contract/);
      assert.match(text, new RegExp(host.memory.replace(".", "\\.")));
    }
    const targetSkill = read(`${host.dir}/skills/wakeflow-target/SKILL.md`);
    assert.match(targetSkill, /Completion focus \(up to two/);
    assert.match(targetSkill, /Workspace instructions \(only when distinct/);
  }
});

test("controller-return docs use semantic context and current machine keys", () => {
  for (const host of hosts) {
    const files = [
      `${host.dir}/skills/wakeflow-controller/SKILL.md`,
      `${host.dir}/skills/wakeflow-governance/references/wakeflow-delivery.md`,
    ];
    for (const file of files) {
      const text = read(file);
      assert.match(text, /Review context:/);
      assert.match(text, /remainingTargets/);
      assert.match(text, /pendingDispatchTargets/);
      assert.match(text, /Required execution Skill:/);
      assert.doesNotMatch(text, /Variables:|missingTargets: <only when non-empty>/);
    }
  }
});

test("delivery docs keep immutable apply separate from the pre-send target claim", () => {
  const claudeDispatch = read("plugins/claude-code-wakeflow/commands/dispatch.md");
  assert.match(claudeDispatch, /Apply writes immutable group\/packet\/envelope transport only/);
  assert.match(claudeDispatch, /operation=target-claim/);
  assert.match(claudeDispatch, /stable-window\s+operation mutex across validation, physical paste, and at most one bounded\s+readback/s);

  const codexDelivery = read("plugins/codex-wakeflow/skills/wakeflow-governance/references/wakeflow-delivery.md");
  const claudeDelivery = read("plugins/claude-code-wakeflow/skills/wakeflow-governance/references/wakeflow-delivery.md");
  for (const text of [codexDelivery, claudeDelivery]) {
    assert.match(text, /Applied preparation stores immutable transport only/);
    assert.match(text, /operation=target-claim.*acquires the exact typed current-window\s+lease/s);
    assert.doesNotMatch(text, /applied (?:envelope )?preparation (?:already )?reserves/i);
  }
});

test("craft and Pod docs preserve executable contract limitations", () => {
  const craft = read("core/skills/wakeflow-target-craft/SKILL.md");
  assert.match(craft, /leave-uncommitted/);
  assert.match(craft, /Treat `designIntent` as an implementation sketch/);
  assert.match(craft, /reviewInputContract\.requiredKinds/);
  assert.match(craft, /\{ kind, ref, digest \}/);
  assert.match(craft, /kind: "acceptance-anchor", anchorId, evidenceRefs: \[\{ ref, digest \}\]/);
  assert.match(craft, /kind: "test-step", planIndex, step, ref/);
  assert.match(craft, /Non-implementation packages \(including research,\s+documentation, and Test work\)/);
  assert.doesNotMatch(
    craft,
    /TargetResultEnvelope|\bevidenceContract\b|\btestExecution\b|pending-merges|anchorId, red, green/,
  );

  for (const host of hosts) {
    const controller = read(`${host.dir}/skills/wakeflow-controller/SKILL.md`);
    assert.match(controller, /supports only one frozen Pod Design request\/handoff/);
    assert.match(controller, /different second request remains blocked/);
    assert.doesNotMatch(controller, /supports only (?:its |one )?initial frozen Pod Design/);
    assert.match(controller, /request-redesign/);
    const ruleMap = read(`${host.dir}/skills/wakeflow-governance/references/agents-rule-map.md`);
    assert.match(ruleMap, /They are not\s+current anchors/);
    assert.doesNotMatch(ruleMap, /#Highest Stop Card|#Decision Questions|#Confirmation Gates|#Gate Flow/);
  }
});

test("Claude recovery guidance keeps baseline and Pod identity separate", () => {
  const controller = read("plugins/claude-code-wakeflow/skills/wakeflow-controller/SKILL.md");
  const target = read("plugins/claude-code-wakeflow/skills/wakeflow-target/SKILL.md");
  const governance = read("plugins/claude-code-wakeflow/skills/wakeflow-governance/SKILL.md");
  for (const text of [controller, target, governance]) {
    assert.match(text, /creation and recovery are separate/i);
    assert.match(text, /operation=inspect-materialization/);
    assert.doesNotMatch(text, /wakeflow_pod_open mode=resume|launch-window --resume/);
  }
  assert.match(controller, /never creates,\s+discovers, or rebinds a replacement/s);
  assert.match(target, /never repeats first\s+materialization, passes `--worktree`, discovers\/rebinds a replacement/s);
  assert.match(governance, /never fall back to mainline or\s+a discovered same-named worktree/s);
  assert.doesNotMatch(`${controller}\n${target}\n${governance}`, /2026-06-15|Agent SDK credit/);
});

test("installed docs advertise only the consolidated public MCP routes", () => {
  const retired = [
    "wakeflow_render_progress",
    "wakeflow_sanitize_archive",
    "wakeflow_pod_record_materialization",
    "wakeflow_pod_prepare_design_request",
    "wakeflow_pod_record_design_handoff",
    "wakeflow_pod_prepare_test_access",
    "wakeflow_pod_record_test_access",
    "wakeflow_pod_close",
    "wakeflow_pod_record_close_receipt",
    "wakeflow_pod_list",
  ];
  for (const host of hosts) {
    const text = [
      `${host.dir}/README.md`,
      `${host.dir}/README.zh-CN.md`,
      `${host.dir}/skills/wakeflow-controller/SKILL.md`,
      `${host.dir}/skills/wakeflow-governance/SKILL.md`,
      `${host.dir}/skills/wakeflow-governance/references/script-pipeline.md`,
    ].map(read).join("\n");
    for (const current of [
      "wakeflow_maintain_workspace",
      "wakeflow_record_evidence",
      "wakeflow_review_pack",
      "wakeflow_pod_open",
      "wakeflow_pod_bind",
      "wakeflow_pod_plan",
      "wakeflow_pod_record",
    ]) {
      assert.match(text, new RegExp(current), `${host.dir} documents ${current}`);
    }
    for (const oldName of retired) {
      assert.doesNotMatch(text, new RegExp(oldName), `${host.dir} retires ${oldName}`);
    }
  }
});

test("installed documentation does not instruct public-v2 invocation syntax", () => {
  const files = [
    "README.md",
    "README.zh-CN.md",
    ...hosts.flatMap((host) => [
      `${host.dir}/README.md`,
      `${host.dir}/README.zh-CN.md`,
      `${host.dir}/${host.memory}`,
      `${host.dir}/scripts/README.md`,
      ...markdownFilesUnder(`${host.dir}/skills`),
    ]),
    ...markdownFilesUnder("plugins/claude-code-wakeflow/commands"),
  ];
  const forbidden = [
    /wakeflow_initialize_workspace/,
    /wakeflow_adopt_demand_host/,
    /wakeflow_pod_open\s+mode=/,
    /wakeflow_pod_record\s+event=/,
    /wakeflow_pod_plan\s+action=/,
    /wakeflow_view\s+scope=/,
    /wakeflow_archive\s+target=/,
    /wakeflow_record_target_result\s+operation=record\b/,
    /launch-window\s+--resume/,
    /deliver\s+--delivery-file/,
    /wait-results\s+--group/,
    /tmuxSocket/,
    /applied (?:envelope )?preparation (?:already )?reserves/i,
  ];
  for (const file of [...new Set(files)]) {
    const text = read(file);
    for (const pattern of forbidden) {
      assert.doesNotMatch(text, pattern, `${file} must not publish ${pattern}`);
    }
  }
});

test("current documentation teaches strict TargetResult and the two real projection assets", () => {
  const files = [
    "README.md",
    "README.zh-CN.md",
    ...hosts.flatMap((host) => [
      `${host.dir}/README.md`,
      `${host.dir}/README.zh-CN.md`,
      `${host.dir}/${host.memory}`,
      `${host.dir}/skills/wakeflow-controller/SKILL.md`,
      `${host.dir}/skills/wakeflow-governance/references/script-pipeline.md`,
    ]),
  ];
  for (const file of files) {
    const text = read(file);
    assert.doesNotMatch(
      text,
      /TargetResultEnvelope|Unified Status|six canonical localized|six localized|6 份 canonical/u,
      `${file} must not publish retired result or asset contracts`,
    );
  }

  for (const file of ["README.md", "README.zh-CN.md"]) {
    const text = read(file);
    assert.match(text, /strict TargetResult/u, `${file} names the strict result contract`);
    assert.match(
      text,
      /two localized demand-progress|两项本地化 demand-progress/u,
      `${file} names the exact two-asset bundle`,
    );
    assert.match(text, /destructiveHint/u, `${file} explains strongest-operation annotations`);
  }
});

test("normal demand creation keeps root-first TODO claim composition honest", () => {
  for (const host of hosts) {
    const memory = read(`${host.dir}/${host.memory}`);
    const routeMap = read(`${host.dir}/skills/wakeflow-governance/references/stage-route-map.md`);
    const scriptPipeline = read(`${host.dir}/skills/wakeflow-governance/references/script-pipeline.md`);
    assert.match(memory, /create owner publishes the root first and atomically claims/iu);
    assert.match(memory, /Do not use standalone `wakeflow_claim_next operation=claim`/u);
    assert.doesNotMatch(memory, /via `wakeflow_claim_next`/u);
    assert.match(routeMap, /root-first publication plus\s+exact linked TODO claim/u);
    assert.doesNotMatch(routeMap, /optional exact `wakeflow_claim_next`/u);
    assert.match(scriptPipeline, /not a demand initializer/u);
  }
});

test("host documentation preserves the real v3 facade and close-proof split", () => {
  const claude = [
    "plugins/claude-code-wakeflow/README.md",
    "plugins/claude-code-wakeflow/README.zh-CN.md",
    "plugins/claude-code-wakeflow/CLAUDE.md",
    "plugins/claude-code-wakeflow/skills/wakeflow-controller/SKILL.md",
    "plugins/claude-code-wakeflow/skills/wakeflow-target/SKILL.md",
    "plugins/claude-code-wakeflow/skills/wakeflow-governance/references/wakeflow-delivery.md",
    "plugins/claude-code-wakeflow/skills/wakeflow-governance/references/window-dispatch.md",
  ].map(read).join("\n");
  assert.match(claude, /current closed v3 facade/iu);
  assert.match(claude, /`launch-window`/u);
  assert.match(claude, /`target-delivery`/u);
  assert.match(claude, /`controller-return`/u);
  assert.doesNotMatch(claude, /M6-T11|wakeflow-claude-host\.mjs\s+deliver/u);

  const codex = [
    "README.md",
    "README.zh-CN.md",
    "plugins/codex-wakeflow/README.md",
    "plugins/codex-wakeflow/README.zh-CN.md",
    "plugins/codex-wakeflow/AGENTS.md",
    "plugins/codex-wakeflow/skills/wakeflow-controller/SKILL.md",
    "plugins/codex-wakeflow/skills/wakeflow-governance/references/direct-thread-window-config.md",
  ].map(read).join("\n");
  assert.match(codex, /manual-host-gate/u);
  assert.match(codex, /no machine-verified close receipt|不能生成机器验证 close receipt/iu);
  assert.match(codex, /does not authorize automatic Pod archive|不授权自动 Pod archive/iu);
});
