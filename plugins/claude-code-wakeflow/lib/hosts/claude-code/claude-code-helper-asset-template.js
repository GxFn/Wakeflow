import { WAKEFLOW_WINDOW_ROLES } from "../../contracts/vocabulary/wakeflow-role-tool-access.js";
import { parseWakeflowNodeEngineBounds, WAKEFLOW_NODE_ENGINES, } from "../../contracts/vocabulary/wakeflow-runtime-engines.js";
import { WAKEFLOW_CONFIG_SCHEMA_VERSION } from "../../kernel/layout.js";
import { claudeCodeMcpPermissionRulesFor } from "./claude-code-mcp-permission-rules.js";
import { CLAUDE_CODE_POD_WINDOW_TITLE_SEPARATOR } from "./claude-code-window-launch-instructions.js";
/**
 * Wakeflow Host / Claude Code：把生成的助手模板装配成发布字节。
 *
 * 助手（tmux、桌面）的源文件在 `assets/` 下，`npm run helpers:build` 把每个入口连同它导入的片段装配成
 * `generated/` 里的一份模板：自包含的脚本，只剩构建期记号（`__WAKEFLOW_…__`）没有填。记号的取值是
 * 运行时自己的常量，在模块加载时填入，所以改许可规则或 Node 引擎范围不需要重新生成，发布字节与摘要
 * 随常量变化。每个取值都是一段 JavaScript 字面量的源文本。
 */
/**
 * 两个助手共用的构建期取值。记号名与 `assets/build-values.d.ts` 里给 `checkJs` 看的环境声明一一对应：
 * 加一个记号要同时加这里的取值与那里的声明。
 */
export const CLAUDE_CODE_HELPER_BUILD_VALUES = Object.freeze({
    /** 配置文件的 schemaVersion：助手读配置时核对。 */
    __WAKEFLOW_CONFIG_SCHEMA_VERSION__: String(WAKEFLOW_CONFIG_SCHEMA_VERSION),
    /** Node 引擎范围的原文与解析后的边界（A6，§13.167）：preflight 用它核对当前 node。 */
    __WAKEFLOW_NODE_ENGINES__: JSON.stringify(WAKEFLOW_NODE_ENGINES),
    __WAKEFLOW_NODE_ENGINE_BOUNDS__: JSON.stringify(parseWakeflowNodeEngineBounds(WAKEFLOW_NODE_ENGINES)),
    /** pod 窗口显示名里 pod 名与标题之间的分隔（open-items W28）：tmux 助手的 mark 据此算窗口名。 */
    __WAKEFLOW_POD_WINDOW_TITLE_SEPARATOR__: JSON.stringify(CLAUDE_CODE_POD_WINDOW_TITLE_SEPARATOR),
    /** 按角色的 MCP 允许规则（ADR-0020 决定 3，F2，§13.168）：launch 与 resume 的 `--allowedTools`。 */
    __WAKEFLOW_ROLE_MCP_PERMISSION_RULES__: JSON.stringify(Object.fromEntries(WAKEFLOW_WINDOW_ROLES.map((role) => [role, claudeCodeMcpPermissionRulesFor(role)]))),
});
const BUILD_TOKEN = /__WAKEFLOW_[A-Z0-9_]+__/gu;
/**
 * 把模板里的每个记号换成它的取值。
 *
 * `tokens` 是生成模块导出的记号清单（模板里出现的全部记号），`values` 按它定型：少给一个取值过不了
 * 类型检查。发布字节以换行结尾。
 */
export function renderClaudeCodeHelperAsset(template, tokens, values) {
    const lookup = new Map();
    for (const token of tokens)
        lookup.set(token, values[token]);
    const rendered = template.replace(BUILD_TOKEN, (token) => lookup.get(token) ?? token);
    return rendered.endsWith("\n") ? rendered : `${rendered}\n`;
}
