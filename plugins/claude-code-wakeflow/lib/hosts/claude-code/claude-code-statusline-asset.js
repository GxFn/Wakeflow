import { WAKEFLOW_CONFIG_KIND, WAKEFLOW_CONFIG_SCHEMA_VERSION, } from "../../contracts/vocabulary/wakeflow-config-identity.js";
import { computeSha256Digest } from "../../foundation/crypto/sha256.js";
import { parsePortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { hostRuntimeRootRef } from "../../kernel/layout.js";
import { renderClaudeCodeHelperAsset } from "./claude-code-helper-asset-template.js";
import { CLAUDE_CODE_STATUSLINE_SCRIPT_TEMPLATE, CLAUDE_CODE_STATUSLINE_SCRIPT_TOKENS, } from "./generated/claude-code-statusline-script.generated.js";
/**
 * Wakeflow Host / Claude Code：状态栏资产（能力卡 9 §9.4 Q6，gate-log §13.94 D6）。
 *
 * 资产是一段由 Claude Code 状态栏调用的 Node 脚本：读 stdin 的 statusline JSON 取 `session_id`
 * 与模型名，读 `wakeflow.config.json` 与绑定目录找 `claude-session` 句柄等于 `session_id` 的窗口，
 * 打印恰好一行——main pod 为 `<model> · <window>`，其他 pod 为 `<model> · <pod> · <window>`，找不到
 * 只打印模型名；不含路径、句柄、摘要，stderr 为空。工作区根由命令行以 base64url 显式给出，
 * 从不从 cwd 推断。Wakeflow 只把字节写进自己的运行时目录并在 verify 里核对字节与模式，
 * 不 spawn node 做 smoke；`settings.local.json` 的 statusLine 条目由维护操作
 * `claude-statusline-settings:install` 写入（§13.94 D6 否决了"由 Agent 按计划安装"那条路径，
 * §13.96 记下落地机制），单键、CAS 与 0600 规则见 claude-code-statusline-settings-operation.ts。
 */
export const CLAUDE_CODE_STATUSLINE_ASSET_FILE_NAME = "statusline.mjs";
export const CLAUDE_CODE_STATUSLINE_MARKER = "--wakeflow-statusline-v1";
export const CLAUDE_CODE_STATUSLINE_ROOT_ARGUMENT = "--workspace-root-base64";
export const CLAUDE_CODE_STATUSLINE_ASSET_REF = parsePortableResourcePath(`${hostRuntimeRootRef("claude-code")}/operations/assets/${CLAUDE_CODE_STATUSLINE_ASSET_FILE_NAME}`, "$asset");
/**
 * 资产的精确字节：维护事务写入的就是这一份，verify 按它核对。脚本的源文件是 `assets/statusline.mjs`，由 `npm run helpers:build` 装配成生成模块里的模板；
 * 这里只把模板里的两个构建期记号（配置的 kind 与 schemaVersion）换成字面量。
 */
export const CLAUDE_CODE_STATUSLINE_ASSET_CONTENT = renderClaudeCodeHelperAsset(CLAUDE_CODE_STATUSLINE_SCRIPT_TEMPLATE, CLAUDE_CODE_STATUSLINE_SCRIPT_TOKENS, {
    __WAKEFLOW_CONFIG_KIND__: JSON.stringify(WAKEFLOW_CONFIG_KIND),
    __WAKEFLOW_CONFIG_SCHEMA_VERSION__: String(WAKEFLOW_CONFIG_SCHEMA_VERSION),
});
export const CLAUDE_CODE_STATUSLINE_ASSET_DIGEST = computeSha256Digest(encodeUtf8(CLAUDE_CODE_STATUSLINE_ASSET_CONTENT, "$asset"), "$asset");
function shellQuote(value) {
    return `'${value.replace(/'/gu, "'\\''")}'`;
}
/**
 * 维护操作 `claude-statusline-settings:install` 写进 `settings.local.json` 的
 * `statusLine.command`：根以 base64url 显式传入。唯一调用方是
 * claude-code-statusline-settings-operation.ts 的 `claudeCodeStatuslineSettingsEntry`，
 * 那里定义只改 `statusLine` 一键、CAS 替换与 0600 的规则；改命令形状要同时改那条操作的目标摘要。
 */
export function claudeCodeStatuslineCommand(workspaceRoot) {
    const asset = [workspaceRoot, ...CLAUDE_CODE_STATUSLINE_ASSET_REF.split("/")].join("/");
    const encodedRoot = Buffer.from(workspaceRoot, "utf8").toString("base64url");
    return `node -- ${shellQuote(asset)} ${CLAUDE_CODE_STATUSLINE_MARKER} ${CLAUDE_CODE_STATUSLINE_ROOT_ARGUMENT} ${encodedRoot}`;
}
