import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  ClaudeCodePortableSettingsTransitionError,
  claudeCodePortableSettingsRetiredRulesFor,
  claudeCodePortableSettingsRulesFor,
  planClaudeCodePortableSettingsTransition,
  WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
} from "../../../src/hosts/claude-code/claude-code-portable-settings-transition.js";
import {
  CLAUDE_CODE_TMUX_ASSET_COMMAND,
  WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE,
} from "../../../src/hosts/claude-code/claude-code-tmux-asset.js";

/**
 * 每种根拥有的 allow 规则（§13.117 D5）：工作区根多一条只放行 tmux 助手这一条调用的规则，
 * 支撑面只有 MCP 一条；两条规则都是精确前缀，不是旧项目的 `Bash(tmux *)`。
 */

function allowOf(text: string | null): string[] {
  return (JSON.parse(text ?? "null") as { permissions: { allow: string[] } }).permissions.allow;
}

test("the program root owns the server-wide MCP rule and the precise tmux helper rule; surfaces own only their role's tool rules and retire the server-wide rule（ADR-0020 决定 3，§13.168）", () => {
  deepEqual(
    [...claudeCodePortableSettingsRulesFor({ rootKind: "program" })],
    [WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE, WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE],
  );
  deepEqual(
    [...claudeCodePortableSettingsRulesFor({ rootKind: "support-surface", role: "design" })],
    [
      `${WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE}__wakeflow_inspect_board`,
      `${WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE}__wakeflow_publish_requirement`,
      `${WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE}__wakeflow_status`,
    ],
  );
  deepEqual(
    [...claudeCodePortableSettingsRulesFor({ rootKind: "support-surface", role: "test" })],
    [
      `${WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE}__wakeflow_import_target_result`,
      `${WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE}__wakeflow_record_evidence`,
      `${WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE}__wakeflow_status`,
    ],
  );
  deepEqual([...claudeCodePortableSettingsRetiredRulesFor({ rootKind: "program" })], []);
  deepEqual(
    [...claudeCodePortableSettingsRetiredRulesFor({ rootKind: "support-surface", role: "test" })],
    [WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE],
  );
  // 支撑面里以前写的整服务器规则被精确删除，用户条目原位保留，角色规则追加到末尾。
  const narrowed = planClaudeCodePortableSettingsTransition(
    `${JSON.stringify({ permissions: { allow: ["Read(./docs/**)", WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE] } }, null, 2)}\n`,
    claudeCodePortableSettingsRulesFor({ rootKind: "support-surface", role: "design" }),
    claudeCodePortableSettingsRetiredRulesFor({ rootKind: "support-surface", role: "design" }),
  );
  equal(narrowed.status, "update");
  deepEqual(allowOf(narrowed.desiredText), [
    "Read(./docs/**)",
    `${WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE}__wakeflow_inspect_board`,
    `${WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE}__wakeflow_publish_requirement`,
    `${WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE}__wakeflow_status`,
  ]);
  equal(WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE, `Bash(${CLAUDE_CODE_TMUX_ASSET_COMMAND} *)`);
  equal(
    CLAUDE_CODE_TMUX_ASSET_COMMAND,
    "node .wakeflow-local/runtime/hosts/claude-code/operations/assets/tmux.mjs",
  );
});

test("program rules create both entries and append only the missing one on update", () => {
  const rules = claudeCodePortableSettingsRulesFor({ rootKind: "program" });
  const created = planClaudeCodePortableSettingsTransition(null, rules);
  equal(created.status, "create");
  deepEqual(allowOf(created.desiredText), [...rules]);

  // 已有 MCP 规则与用户条目：只追加缺的助手规则，用户条目原位保留。
  const partial = `${JSON.stringify(
    {
      permissions: { allow: ["Read(./docs/**)", WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE] },
    },
    null,
    2,
  )}\n`;
  const updated = planClaudeCodePortableSettingsTransition(partial, rules);
  equal(updated.status, "update");
  deepEqual(allowOf(updated.desiredText), [
    "Read(./docs/**)",
    WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
    WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE,
  ]);

  // 两条都在（顺序无所谓，重复只留第一次）：current。
  const complete = `${JSON.stringify(
    {
      permissions: {
        allow: [
          WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE,
          "Read(./docs/**)",
          WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
        ],
      },
    },
    null,
    2,
  )}\n`;
  equal(planClaudeCodePortableSettingsTransition(complete, rules).status, "current");
  const duplicated = `${JSON.stringify(
    {
      permissions: {
        allow: [
          WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
          WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE,
          WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE,
        ],
      },
    },
    null,
    2,
  )}\n`;
  const deduplicated = planClaudeCodePortableSettingsTransition(duplicated, rules);
  equal(deduplicated.status, "update");
  deepEqual(allowOf(deduplicated.desiredText), [
    WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
    WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE,
  ]);

  // 缺省规则集与显式支撑面规则集一致：只有 MCP 一条。
  deepEqual(allowOf(planClaudeCodePortableSettingsTransition(null).desiredText), [
    WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
  ]);
});

test("rule sets are validated: empty, duplicated or legacy broad rules are refused", () => {
  for (const rules of [[], ["a", "a"], ["Bash(tmux *)"], [""], "not-an-array"]) {
    throws(
      () => planClaudeCodePortableSettingsTransition(null, rules),
      (error: unknown) =>
        error instanceof ClaudeCodePortableSettingsTransitionError && error.path === "$rules",
    );
  }
});
