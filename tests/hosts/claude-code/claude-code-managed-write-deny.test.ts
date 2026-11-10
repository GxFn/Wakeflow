import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";

import {
  WAKEFLOW_ACTIVE_ROOT,
  WAKEFLOW_LOCAL_ROOT,
} from "../../../src/configuration/wakeflow-config.js";
import { WAKEFLOW_CONFIG_FILE_REF } from "../../../src/configuration/wakeflow-config-authority-snapshot.js";
import { WAKEFLOW_ROLE_TOOL_ACCESS } from "../../../src/contracts/vocabulary/wakeflow-role-tool-access.js";
import { CLAUDE_CODE_DESKTOP_ASSET_CONTENT } from "../../../src/hosts/claude-code/claude-code-desktop-asset.js";
import { CLAUDE_CODE_MANAGED_WRITE_DENY } from "../../../src/hosts/claude-code/claude-code-helper-asset-template.js";
import { CLAUDE_CODE_PORTABLE_SETTINGS_REF } from "../../../src/hosts/claude-code/claude-code-portable-settings-publication.js";
import { CLAUDE_CODE_TMUX_ASSET_CONTENT } from "../../../src/hosts/claude-code/claude-code-tmux-asset.js";
import {
  claudeCodeDesktopWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostResourceProfile,
} from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";

/**
 * 级别 0（纯逻辑；`tests/hosts` 的缺省是 2 级）：受管路径的写拒绝表（ADR-0020 决定 6，open-items F1）。
 *
 * 表是助手里 deny 规则的唯一来源，装配时填进两个助手。这里钉它指向的就是运行时自己用的那几处——收窄角色
 * 与归属表同一组，目录与文件是布局、配置与 settings 发布各自的常量——以及两种传输的发布字节带着同一张表：
 * 谁挪了受管路径或加了角色而没改这张表，这里失败。助手怎样把表拼成规则，在两个助手各自的测试里。
 */

test("写拒绝表的角色就是归属表里被收窄的角色，路径就是布局、配置与 settings 发布各自的常量", () => {
  deepEqual(
    [...CLAUDE_CODE_MANAGED_WRITE_DENY.roles].sort(),
    Object.keys(WAKEFLOW_ROLE_TOOL_ACCESS).sort(),
  );
  equal(CLAUDE_CODE_MANAGED_WRITE_DENY.roles.includes("controller" as never), false);
  deepEqual(
    [...CLAUDE_CODE_MANAGED_WRITE_DENY.directories],
    [WAKEFLOW_LOCAL_ROOT, WAKEFLOW_ACTIVE_ROOT],
  );
  for (const profile of [
    claudeCodeWorkspaceHostResourceProfile,
    claudeCodeDesktopWorkspaceHostResourceProfile,
  ]) {
    const settings = profile.surfaces.settingsIntegration;
    ok(settings !== null);
    deepEqual(
      [...CLAUDE_CODE_MANAGED_WRITE_DENY.files],
      [String(WAKEFLOW_CONFIG_FILE_REF), String(settings.portablePath), String(settings.localPath)],
    );
  }
  equal(CLAUDE_CODE_MANAGED_WRITE_DENY.files[1], String(CLAUDE_CODE_PORTABLE_SETTINGS_REF));
  // 目录整棵拒绝、文件按名字拒绝：`.claude/` 本身不在目录里，worktree 检出（`.claude/worktrees/`）不受影响。
  equal(
    [...CLAUDE_CODE_MANAGED_WRITE_DENY.directories, ...CLAUDE_CODE_MANAGED_WRITE_DENY.files].some(
      (entry) => entry === ".claude" || entry.startsWith(".claude/worktrees"),
    ),
    false,
  );
});

test("两种传输的发布字节带着同一张表，规则参数在意图参数之后", () => {
  const literal = `const MANAGED_WRITE_DENY = ${JSON.stringify(CLAUDE_CODE_MANAGED_WRITE_DENY)};`;
  for (const content of [CLAUDE_CODE_TMUX_ASSET_CONTENT, CLAUDE_CODE_DESKTOP_ASSET_CONTENT]) {
    equal(content.split(literal).length, 2, "the table is filled in exactly once");
    ok(content.includes('"--disallowedTools", ...deny'));
    equal(content.includes("__WAKEFLOW_MANAGED_WRITE_DENY__"), false);
  }
});
