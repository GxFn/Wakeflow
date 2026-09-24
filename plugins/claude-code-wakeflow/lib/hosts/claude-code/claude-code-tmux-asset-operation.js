import { executeClaudeCodeHostAssetOperation, planClaudeCodeHostAssetOperation, } from "./claude-code-host-asset-operation.js";
import { CLAUDE_CODE_TMUX_ASSET_CONTENT, CLAUDE_CODE_TMUX_ASSET_DIGEST, CLAUDE_CODE_TMUX_ASSET_FILE_NAME, CLAUDE_CODE_TMUX_ASSET_REF, } from "./claude-code-tmux-asset.js";
/**
 * Wakeflow Host / Claude Code：tmux 助手资产的维护操作（gate-log §13.117 D4）。
 *
 * 与状态栏资产同一通用操作：只读计划、单文件 CAS、0600、affected 恢复。操作标识按字典序
 * 排在状态栏资产与本地设置条目之后，先装状态栏再装助手；两者互不依赖。
 */
export const CLAUDE_CODE_TMUX_ASSET_OPERATION_KIND = "tmux-asset";
export const CLAUDE_CODE_TMUX_ASSET_OWNER_ID = "claude-code-tmux-asset";
export const CLAUDE_CODE_TMUX_ASSET_OPERATION_ID = "claude-tmux-asset:install";
/** 资产读不出（目录、符号链接、超过 256 KiB、权限不足）时宿主贡献报出的 blocker。 */
export const CLAUDE_CODE_TMUX_ASSET_BLOCKER = "claude-tmux-asset-unreadable";
const CLAUDE_CODE_TMUX_ASSET_DESCRIPTOR = Object.freeze({
    fileName: CLAUDE_CODE_TMUX_ASSET_FILE_NAME,
    ref: CLAUDE_CODE_TMUX_ASSET_REF,
    content: CLAUDE_CODE_TMUX_ASSET_CONTENT,
    digest: CLAUDE_CODE_TMUX_ASSET_DIGEST,
    operationId: CLAUDE_CODE_TMUX_ASSET_OPERATION_ID,
    operationKind: CLAUDE_CODE_TMUX_ASSET_OPERATION_KIND,
    ownerId: CLAUDE_CODE_TMUX_ASSET_OWNER_ID,
    targetKey: "asset:claude-code:tmux",
});
/** 零写计划：字节已是期望即 null，否则一条操作（sourceDigest 是当前字节摘要或 null）。 */
export function planClaudeCodeTmuxAssetOperation(root, options = {}) {
    return planClaudeCodeHostAssetOperation(root, CLAUDE_CODE_TMUX_ASSET_DESCRIPTOR, options);
}
/** 执行：缺失创建、不同 CAS 替换；已是期望字节即 current（恢复与普通执行同一判定）。 */
export function executeClaudeCodeTmuxAssetOperation(root, request) {
    return executeClaudeCodeHostAssetOperation(root, CLAUDE_CODE_TMUX_ASSET_DESCRIPTOR, request);
}
