/**
 * 0 级（纯逻辑）：`.claude/settings.json` 的 portable settings transition——写入路径的创建、最小编辑、
 * current 与 blocked 理由，以及退出路径的精确删除（ADR-0024 `remove-portable-settings-rules`）：只删
 * Wakeflow 当前与退役的条目、用户条目与键原样保留、无条目或无文件即 current、读不出即 blocked。
 */
import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  ClaudeCodePortableSettingsTransitionError,
  claudeCodePortableSettingsRemovedRulesFor,
  claudeCodePortableSettingsRetiredRulesFor,
  claudeCodePortableSettingsRulesFor,
  planClaudeCodePortableSettingsRemovalTransition,
  planClaudeCodePortableSettingsTransition,
  WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
} from "../../../src/hosts/claude-code/claude-code-portable-settings-transition.js";
import { WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE } from "../../../src/hosts/claude-code/claude-code-tmux-asset.js";

test("Claude portable settings creates only the Wakeflow MCP permission", () => {
  const transition = planClaudeCodePortableSettingsTransition(null);
  equal(transition.status, "create");
  const desired = JSON.parse(transition.desiredText ?? "null") as {
    permissions: { allow: string[] };
  };
  deepEqual(desired.permissions.allow, [WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE]);
  equal(transition.desiredText?.includes("Bash("), false);
});

test("minimal edit preserves user fields and deduplicates only Wakeflow ownership", () => {
  const source = [
    "{",
    '\t"theme": "dark",',
    '\t"permissions": {',
    '\t\t"deny": ["Read(./.env)"],',
    `\t\t"allow": ["Read(./docs/**)", "${WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE}", "${WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE}"]`,
    "\t},",
    '\t"custom": { "preserved": true }',
    "}",
  ].join("\n");
  const transition = planClaudeCodePortableSettingsTransition(source);
  equal(transition.status, "update");
  const desiredText = transition.desiredText ?? "";
  equal(desiredText.includes('\t"theme": "dark",'), true);
  equal(desiredText.includes('\t"custom": { "preserved": true }'), true);
  const desired = JSON.parse(desiredText) as {
    permissions: { allow: string[]; deny: string[] };
    custom: { preserved: boolean };
  };
  deepEqual(desired.permissions.allow, [
    "Read(./docs/**)",
    WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
  ]);
  deepEqual(desired.permissions.deny, ["Read(./.env)"]);
  equal(desired.custom.preserved, true);

  const current = planClaudeCodePortableSettingsTransition(desiredText);
  equal(current.status, "current");
  equal(current.desiredText, null);
});

test("invalid, conflicting, and legacy broad permissions remain blocked", () => {
  const cases = [
    ["{", "syntax"],
    ['{"permissions":{},"permissions":{}}', "duplicate-key"],
    ["[]", "root-not-object"],
    ['{"permissions":[]}', "permissions-not-object"],
    ['{"permissions":{"allow":[1]}}', "allow-not-string-array"],
    ['{"permissions":{"allow":["Bash(git *)"]}}', "legacy-broad-permission-present"],
    ["{/* comment */}", "syntax"],
    ['{"permissions":{},}', "syntax"],
  ] as const;
  for (const [source, reason] of cases) {
    const transition = planClaudeCodePortableSettingsTransition(source);
    equal(transition.status, "blocked");
    equal(transition.reason, reason);
    equal(transition.desiredText, null);
  }
});

function allowOf(text: string | null): string[] {
  return (JSON.parse(text ?? "null") as { permissions: { allow: string[] } }).permissions.allow;
}

test("removal deletes exactly the given entries, keeps the user's entries, keys and formatting, and leaves an emptied allow array in place（ADR-0024）", () => {
  const removed = claudeCodePortableSettingsRemovedRulesFor({ rootKind: "program" });
  deepEqual(
    [...removed],
    [WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE, WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE],
  );
  const source = [
    "{",
    '\t"theme": "dark",',
    '\t"permissions": {',
    '\t\t"deny": ["Read(./.env)"],',
    `\t\t"allow": ["Read(./docs/**)", "${WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE}", ${JSON.stringify(WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE)}, "Bash(ls:*)"]`,
    "\t},",
    '\t"custom": { "preserved": true }',
    "}",
  ].join("\n");
  const transition = planClaudeCodePortableSettingsRemovalTransition(source, removed);
  equal(transition.status, "update");
  equal(transition.reason, null);
  const desiredText = transition.desiredText ?? "";
  equal(desiredText.includes('\t"theme": "dark",'), true);
  equal(desiredText.includes('\t"custom": { "preserved": true }'), true);
  equal(desiredText.includes('"deny": ["Read(./.env)"]'), true);
  deepEqual(allowOf(desiredText), ["Read(./docs/**)", "Bash(ls:*)"]);
  equal(desiredText.includes("wakeflow"), false, "no Wakeflow entry survives");

  // 删完就是 current：同一删除表再算一次零写。
  const current = planClaudeCodePortableSettingsRemovalTransition(desiredText, removed);
  equal(current.status, "current");
  equal(current.desiredText, null);
  equal(current.desiredDigest, current.sourceDigest);

  // 只有 Wakeflow 的条目：allow 删成空数组但留着，文件不删、键不删。
  const onlyWakeflow = `${JSON.stringify({ permissions: { allow: [...removed] } }, null, 2)}\n`;
  const emptied = planClaudeCodePortableSettingsRemovalTransition(onlyWakeflow, removed);
  equal(emptied.status, "update");
  deepEqual(JSON.parse(emptied.desiredText ?? "null"), { permissions: { allow: [] } });
});

test("removal is current for an absent file, a file without the entries, and a file without permissions at all", () => {
  const removed = claudeCodePortableSettingsRemovedRulesFor({ rootKind: "program" });
  const absent = planClaudeCodePortableSettingsRemovalTransition(null, removed);
  equal(absent.status, "current");
  equal(absent.sourceDigest, null);
  equal(absent.desiredDigest, null);
  equal(absent.desiredText, null);
  for (const source of [
    '{"theme":"dark"}\n',
    '{"permissions":{}}\n',
    '{"permissions":{"allow":[]}}\n',
    '{"permissions":{"allow":["Read(./docs/**)"]}}\n',
  ]) {
    const transition = planClaudeCodePortableSettingsRemovalTransition(source, removed);
    equal(transition.status, "current", source);
    equal(transition.desiredText, null);
  }
});

test("removal blocks on unreadable or mistyped documents with the write path's reasons, but a legacy broad rule neither blocks nor gets removed", () => {
  const removed = claudeCodePortableSettingsRemovedRulesFor({ rootKind: "program" });
  const cases = [
    ["{", "syntax"],
    ['{"permissions":{},"permissions":{}}', "duplicate-key"],
    ["[]", "root-not-object"],
    ['{"permissions":[]}', "permissions-not-object"],
    ['{"permissions":{"allow":[1]}}', "allow-not-string-array"],
    ["{/* comment */}", "syntax"],
  ] as const;
  for (const [source, reason] of cases) {
    const transition = planClaudeCodePortableSettingsRemovalTransition(source, removed);
    equal(transition.status, "blocked", source);
    equal(transition.reason, reason);
    equal(transition.desiredText, null);
  }
  // 旧插件的宽泛规则不能证明是 Wakeflow 写的：删除路径不删它，也不因它停下（写入路径仍 blocked）。
  const legacy = `${JSON.stringify(
    { permissions: { allow: ["Bash(git *)", WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE] } },
    null,
    2,
  )}\n`;
  equal(
    planClaudeCodePortableSettingsTransition(legacy, [WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE])
      .reason,
    "legacy-broad-permission-present",
  );
  const removal = planClaudeCodePortableSettingsRemovalTransition(legacy, removed);
  equal(removal.status, "update");
  deepEqual(allowOf(removal.desiredText), ["Bash(git *)"]);
});

test("the removed-rule table is the deduplicated union of current and retired rules, and removal input is validated", () => {
  for (const role of ["design", "test"] as const) {
    const owner = { rootKind: "support-surface" as const, role };
    deepEqual(
      [...claudeCodePortableSettingsRemovedRulesFor(owner)],
      [
        ...claudeCodePortableSettingsRulesFor(owner),
        ...claudeCodePortableSettingsRetiredRulesFor(owner),
      ],
    );
    equal(
      new Set(claudeCodePortableSettingsRemovedRulesFor(owner)).size,
      claudeCodePortableSettingsRemovedRulesFor(owner).length,
    );
  }
  for (const removedRules of [[], ["a", "a"], [""], "not-an-array", undefined]) {
    throws(
      () => planClaudeCodePortableSettingsRemovalTransition('{"permissions":{}}', removedRules),
      (error: unknown) =>
        error instanceof ClaudeCodePortableSettingsTransitionError &&
        error.path === "$removedRules",
    );
  }
  throws(
    () => planClaudeCodePortableSettingsRemovalTransition(42, ["a"]),
    (error: unknown) =>
      error instanceof ClaudeCodePortableSettingsTransitionError && error.path === "$sourceText",
  );
});
