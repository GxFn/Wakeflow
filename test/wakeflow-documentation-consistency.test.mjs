import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

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

test("delivery docs preserve the prepare-to-send target lease boundary", () => {
  const claudeDispatch = read("plugins/claude-code-wakeflow/commands/dispatch.md");
  assert.match(claudeDispatch, /applied envelope preparation reserves the shared per-window target/);
  assert.match(claudeDispatch, /reuses or revalidates the same delivery id/);
  assert.doesNotMatch(claudeDispatch, /not by envelope preparation|at the real send boundary/);

  const codexDelivery = read("plugins/codex-wakeflow/skills/wakeflow-governance/references/wakeflow-delivery.md");
  const claudeDelivery = read("plugins/claude-code-wakeflow/skills/wakeflow-governance/references/wakeflow-delivery.md");
  assert.match(codexDelivery, /Applied envelope preparation.*reserves the shared/s);
  assert.match(claudeDelivery, /already reserved by applied envelope preparation/);
});

test("craft and Pod docs preserve executable contract limitations", () => {
  const craft = read("core/skills/wakeflow-target-craft/SKILL.md");
  assert.match(craft, /\| `acceptance-anchor` \|/);
  assert.doesNotMatch(craft, /\| `acceptance-anchors` \|/);
  assert.match(craft, /leave-uncommitted/);
  assert.match(craft, /Treat `designIntent` as an implementation sketch/);
  assert.match(craft, /kind: "acceptance-anchor", anchorId, red, green, ref/);
  assert.match(craft, /kind: "test-step", planIndex, step, ref/);
  assert.match(craft, /Non-implementation packages \(including research,\s+documentation, and Test work\)/);

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
    assert.match(text, /--cwd <recorded actual\s+cwd>/);
    assert.match(text, /--session-id <registered id>/);
    assert.match(text, /creation and recovery are separate/i);
    assert.match(text, /wakeflow_pod_open mode=resume/);
    assert.match(text, /exact registered session/);
    assert.match(text, /--worktree/);
    assert.doesNotMatch(text, /recovery capability gap/);
  }
  assert.doesNotMatch(`${controller}\n${target}\n${governance}`, /2026-06-15|Agent SDK credit/);
});
