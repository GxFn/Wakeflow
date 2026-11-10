/**
 * Wakeflow Host / Claude Code：助手源文件里的构建期记号。
 *
 * 这些名字不是运行时变量：`claude-code-helper-asset-template.ts` 在装配发布字节时把每个记号换成一段
 * 字面量，发布出去的脚本里没有它们。这里的声明只让 `checkJs` 知道记号的类型；加一个记号要同时加那边的
 * 取值。
 */

/** 缩短宿主命令时间上限的环境变量名，每个助手一个（只供测试使用）。 */
declare const __WAKEFLOW_COMMAND_TIMEOUT_VARIABLE__: string;
/** 配置文件的 kind。 */
declare const __WAKEFLOW_CONFIG_KIND__: string;
/** 配置文件的 schemaVersion。 */
declare const __WAKEFLOW_CONFIG_SCHEMA_VERSION__: number;
/** Node 引擎范围的原文，例如 `>=24.19.0 <25`。 */
declare const __WAKEFLOW_NODE_ENGINES__: string;
/** 解析后的引擎边界：最低版本与不含的主版本上限。 */
declare const __WAKEFLOW_NODE_ENGINE_BOUNDS__: Readonly<{
  minimum: readonly [number, number, number];
  exclusiveMajor: number;
}>;
/** pod 窗口显示名里 pod 名与标题之间的分隔。 */
declare const __WAKEFLOW_POD_WINDOW_TITLE_SEPARATOR__: string;
/** 窗口角色到该角色 MCP 允许规则的表。 */
declare const __WAKEFLOW_ROLE_MCP_PERMISSION_RULES__: Readonly<Record<string, readonly string[]>>;
/** 受管路径的写拒绝：带规则的角色，以及工作区根下受管的目录与文件（相对工作区根）。 */
declare const __WAKEFLOW_MANAGED_WRITE_DENY__: Readonly<{
  roles: readonly string[];
  directories: readonly string[];
  files: readonly string[];
}>;
