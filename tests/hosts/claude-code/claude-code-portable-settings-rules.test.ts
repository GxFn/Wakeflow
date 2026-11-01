import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  CLAUDE_CODE_DESKTOP_ASSET_COMMAND,
  WAKEFLOW_CLAUDE_CODE_DESKTOP_PERMISSION_RULE,
} from "../../../src/hosts/claude-code/claude-code-desktop-asset.js";
import {
  ClaudeCodePortableSettingsTransitionError,
  claudeCodePortableSettingsPublicationOwnerOf,
  claudeCodePortableSettingsRemovedRulesFor,
  claudeCodePortableSettingsRetiredRulesFor,
  claudeCodePortableSettingsRulesFor,
  planClaudeCodePortableSettingsTransition,
  WAKEFLOW_CLAUDE_CODE_HELPER_PERMISSION_RULES,
  WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
} from "../../../src/hosts/claude-code/claude-code-portable-settings-transition.js";
import {
  CLAUDE_CODE_TMUX_ASSET_COMMAND,
  WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE,
} from "../../../src/hosts/claude-code/claude-code-tmux-asset.js";
import {
  claudeCodeDesktopWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostResourceProfile,
} from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";

/**
 * 0 级（纯逻辑）：每种根拥有的 allow 规则（§13.117 D5；ADR-0025 D6）：工作区根多一条只放行选出传输的助手
 * 这一条调用的规则——tmux profile 是 tmux 助手、桌面 profile 是桌面助手，按 profile 的助手文件名查表——
 * 另一种传输的助手规则退役；支撑面只有 MCP 一条；规则都是精确前缀，不是旧项目的 `Bash(tmux *)`。
 */

function allowOf(text: string | null): string[] {
  return (JSON.parse(text ?? "null") as { permissions: { allow: string[] } }).permissions.allow;
}

/** 工作区根在 tmux 传输下的写入归属；现有用例都从它出发。 */
const TMUX_PROGRAM = claudeCodePortableSettingsPublicationOwnerOf(
  { rootKind: "program" },
  claudeCodeWorkspaceHostResourceProfile,
);

test("the program root's helper rule follows the selected profile: tmux publishes the tmux helper rule and retires the desktop one, desktop the reverse; removal names both; a profile without a known helper is refused（ADR-0025 D6）", () => {
  deepEqual(TMUX_PROGRAM, {
    rootKind: "program",
    helperPermissionRule: WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE,
  });
  const desktopProgram = claudeCodePortableSettingsPublicationOwnerOf(
    { rootKind: "program" },
    claudeCodeDesktopWorkspaceHostResourceProfile,
  );
  deepEqual(desktopProgram, {
    rootKind: "program",
    helperPermissionRule: WAKEFLOW_CLAUDE_CODE_DESKTOP_PERMISSION_RULE,
  });
  deepEqual(
    [...claudeCodePortableSettingsRulesFor(desktopProgram)],
    [WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE, WAKEFLOW_CLAUDE_CODE_DESKTOP_PERMISSION_RULE],
  );
  deepEqual(
    [...claudeCodePortableSettingsRetiredRulesFor(desktopProgram)],
    [WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE],
  );
  deepEqual(
    [...claudeCodePortableSettingsRetiredRulesFor(TMUX_PROGRAM)],
    [WAKEFLOW_CLAUDE_CODE_DESKTOP_PERMISSION_RULE],
  );
  deepEqual(
    [...WAKEFLOW_CLAUDE_CODE_HELPER_PERMISSION_RULES],
    [WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE, WAKEFLOW_CLAUDE_CODE_DESKTOP_PERMISSION_RULE],
  );
  // 退出路径不分传输：工作区根删 MCP 规则加两种传输的助手规则。
  deepEqual(
    [...claudeCodePortableSettingsRemovedRulesFor({ rootKind: "program" })],
    [
      WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
      WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE,
      WAKEFLOW_CLAUDE_CODE_DESKTOP_PERMISSION_RULE,
    ],
  );
  equal(
    WAKEFLOW_CLAUDE_CODE_DESKTOP_PERMISSION_RULE,
    `Bash(${CLAUDE_CODE_DESKTOP_ASSET_COMMAND} *)`,
  );
  equal(
    CLAUDE_CODE_DESKTOP_ASSET_COMMAND,
    "node .wakeflow-local/runtime/hosts/claude-code/operations/assets/desktop.mjs",
  );
  // 支撑面的归属与 profile 无关。
  deepEqual(
    claudeCodePortableSettingsPublicationOwnerOf(
      { rootKind: "support-surface", role: "design" },
      claudeCodeDesktopWorkspaceHostResourceProfile,
    ),
    { rootKind: "support-surface", role: "design" },
  );
  // 没有助手（Codex）或文件名不在表里的 profile 不是本宿主的传输。
  throws(
    () =>
      claudeCodePortableSettingsPublicationOwnerOf(
        { rootKind: "program" },
        codexWorkspaceHostResourceProfile,
      ),
    (error: unknown) =>
      error instanceof ClaudeCodePortableSettingsTransitionError &&
      error.path === "$profile/surfaces/helperAsset",
  );
  throws(
    () =>
      claudeCodePortableSettingsPublicationOwnerOf(
        { rootKind: "program" },
        {
          surfaces: {
            ...claudeCodeWorkspaceHostResourceProfile.surfaces,
            helperAsset: { fileName: "other.mjs" as never },
          },
        },
      ),
    (error: unknown) =>
      error instanceof ClaudeCodePortableSettingsTransitionError &&
      error.path === "$profile/surfaces/helperAsset",
  );
  // 桌面传输的工作区根从零建出两条规则；已有 tmux 规则的根切到桌面时精确换掉它。
  const created = planClaudeCodePortableSettingsTransition(
    null,
    claudeCodePortableSettingsRulesFor(desktopProgram),
    claudeCodePortableSettingsRetiredRulesFor(desktopProgram),
  );
  equal(created.status, "create");
  deepEqual(allowOf(created.desiredText), [
    WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
    WAKEFLOW_CLAUDE_CODE_DESKTOP_PERMISSION_RULE,
  ]);
  const switched = planClaudeCodePortableSettingsTransition(
    `${JSON.stringify(
      {
        permissions: {
          allow: [
            "Read(./docs/**)",
            WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
            WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE,
          ],
        },
      },
      null,
      2,
    )}\n`,
    claudeCodePortableSettingsRulesFor(desktopProgram),
    claudeCodePortableSettingsRetiredRulesFor(desktopProgram),
  );
  equal(switched.status, "update");
  deepEqual(allowOf(switched.desiredText), [
    "Read(./docs/**)",
    WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
    WAKEFLOW_CLAUDE_CODE_DESKTOP_PERMISSION_RULE,
  ]);
});

test("the program root owns the server-wide MCP rule and the precise tmux helper rule; surfaces own only their role's tool rules and retire the server-wide rule（ADR-0020 决定 3，§13.168）", () => {
  deepEqual(
    [...claudeCodePortableSettingsRulesFor(TMUX_PROGRAM)],
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
  // tmux 传输的工作区根退役的是另一种传输（桌面）的助手规则（ADR-0025 D6）。
  deepEqual(
    [...claudeCodePortableSettingsRetiredRulesFor(TMUX_PROGRAM)],
    [WAKEFLOW_CLAUDE_CODE_DESKTOP_PERMISSION_RULE],
  );
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
  const rules = claudeCodePortableSettingsRulesFor(TMUX_PROGRAM);
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
