import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import type { WakeflowHostMaintenanceOperationInput } from "../../workspace/maintenance/wakeflow-host-maintenance-contribution.js";
import {
  type ClaudeCodeHostAssetDescriptor,
  type ClaudeCodeHostAssetOperationResult,
  type ExecuteClaudeCodeHostAssetOperationRequest,
  executeClaudeCodeHostAssetOperation,
  planClaudeCodeHostAssetOperation,
} from "./claude-code-host-asset-operation.js";
import {
  CLAUDE_CODE_STATUSLINE_ASSET_CONTENT,
  CLAUDE_CODE_STATUSLINE_ASSET_DIGEST,
  CLAUDE_CODE_STATUSLINE_ASSET_FILE_NAME,
  CLAUDE_CODE_STATUSLINE_ASSET_REF,
} from "./claude-code-statusline-asset.js";

/**
 * Wakeflow Host / Claude Code：状态栏资产的维护操作（gate-log §13.94 D6）。
 *
 * 描述符之外的一切（只读计划、单文件 CAS、0600、0700 目录、affected 恢复）都在通用的
 * 宿主资产操作里；本模块只说这份资产是谁。`settings.local.json` 的 statusLine 条目不在这里，
 * 见 claude-code-statusline-settings-operation.ts。
 */

export const CLAUDE_CODE_STATUSLINE_ASSET_OPERATION_KIND = "statusline-asset" as const;
export const CLAUDE_CODE_STATUSLINE_ASSET_OWNER_ID = "claude-code-statusline-asset" as const;
/** 操作标识按字典序排在每一条 `claude-portable-settings:*` 操作之后：先写 settings，再装资产。 */
export const CLAUDE_CODE_STATUSLINE_ASSET_OPERATION_ID = "claude-statusline-asset:install" as const;

const CLAUDE_CODE_STATUSLINE_ASSET_DESCRIPTOR: Readonly<ClaudeCodeHostAssetDescriptor> =
  Object.freeze({
    fileName: CLAUDE_CODE_STATUSLINE_ASSET_FILE_NAME,
    ref: CLAUDE_CODE_STATUSLINE_ASSET_REF,
    content: CLAUDE_CODE_STATUSLINE_ASSET_CONTENT,
    digest: CLAUDE_CODE_STATUSLINE_ASSET_DIGEST,
    operationId: CLAUDE_CODE_STATUSLINE_ASSET_OPERATION_ID,
    operationKind: CLAUDE_CODE_STATUSLINE_ASSET_OPERATION_KIND,
    ownerId: CLAUDE_CODE_STATUSLINE_ASSET_OWNER_ID,
    targetKey: "asset:claude-code:statusline",
  });

/** 零写计划：字节已是期望即 null，否则一条操作（sourceDigest 是当前字节摘要或 null）。 */
export function planClaudeCodeStatuslineAssetOperation(
  root: RootedDirectory,
  options: { readonly signal?: AbortSignal } = {},
): Promise<WakeflowHostMaintenanceOperationInput | null> {
  return planClaudeCodeHostAssetOperation(root, CLAUDE_CODE_STATUSLINE_ASSET_DESCRIPTOR, options);
}

/** 执行：缺失创建、不同 CAS 替换；已是期望字节即 current（恢复与普通执行同一判定）。 */
export function executeClaudeCodeStatuslineAssetOperation(
  root: RootedDirectory,
  request: Readonly<ExecuteClaudeCodeHostAssetOperationRequest>,
): Promise<Readonly<ClaudeCodeHostAssetOperationResult>> {
  return executeClaudeCodeHostAssetOperation(root, CLAUDE_CODE_STATUSLINE_ASSET_DESCRIPTOR, request);
}
