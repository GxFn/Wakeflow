import path from "node:path";

import type { WakeflowWindowRole } from "../../../src/contracts/vocabulary/wakeflow-role-tool-access.js";
import { CLAUDE_CODE_MANAGED_WRITE_DENY } from "../../../src/hosts/claude-code/claude-code-helper-asset-template.js";
import { claudeCodeMcpPermissionRulesFor } from "../../../src/hosts/claude-code/claude-code-mcp-permission-rules.js";

/**
 * 夹具：两个助手（tmux、桌面）给每条 claude 启动命令加的规则参数，按同一张表独立算出。
 *
 * 助手是自包含脚本，规则在它自己的进程里拼；这里从运行时的常量（归属表的 MCP 规则、受管路径的写拒绝表）
 * 另算一遍，两个助手的测试都拿它对照，所以两种传输带的是同一组规则（CLAUDE.md 的双传输同批规则）。
 */

/** 非 Controller 角色的写拒绝规则：受管目录整棵、受管文件按名字、账本根整棵；绝对路径以 `//` 开头。 */
export function expectedClaudeCodeWriteDenyRules(
  root: string,
  ledgerRoot: string,
): readonly string[] {
  return [
    ...CLAUDE_CODE_MANAGED_WRITE_DENY.directories.map(
      (entry) => `Edit(/${path.join(root, entry)}/**)`,
    ),
    ...CLAUDE_CODE_MANAGED_WRITE_DENY.files.map((entry) => `Edit(/${path.join(root, entry)})`),
    `Edit(/${path.resolve(root, ledgerRoot)}/**)`,
  ];
}

/** 启动命令末尾的规则参数：恰好一次 --allowedTools，非 Controller 角色再加恰好一次 --disallowedTools。 */
export function expectedClaudeCodeRuleArguments(input: {
  readonly role: WakeflowWindowRole;
  readonly root: string;
  readonly ledgerRoot: string;
  readonly assetPath: string;
}): readonly string[] {
  return [
    "--allowedTools",
    ...claudeCodeMcpPermissionRulesFor(input.role),
    `Bash(node ${input.assetPath} *)`,
    ...(input.role === "controller"
      ? []
      : ["--disallowedTools", ...expectedClaudeCodeWriteDenyRules(input.root, input.ledgerRoot)]),
  ];
}

/** 助手结果里的写拒绝摘要：只有数目。 */
export function expectedClaudeCodeWriteDenyReport(
  role: WakeflowWindowRole,
): Readonly<{ rules: number; unexpressed: number }> {
  return {
    rules:
      role === "controller"
        ? 0
        : CLAUDE_CODE_MANAGED_WRITE_DENY.directories.length +
          CLAUDE_CODE_MANAGED_WRITE_DENY.files.length +
          1,
    unexpressed: 0,
  };
}
