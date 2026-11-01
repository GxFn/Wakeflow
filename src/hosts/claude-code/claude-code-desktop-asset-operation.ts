import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import type { WakeflowHostMaintenanceOperationInput } from "../../workspace/maintenance/wakeflow-host-maintenance-contribution.js";
import {
  CLAUDE_CODE_DESKTOP_ASSET_CONTENT,
  CLAUDE_CODE_DESKTOP_ASSET_DIGEST,
  CLAUDE_CODE_DESKTOP_ASSET_FILE_NAME,
  CLAUDE_CODE_DESKTOP_ASSET_REF,
} from "./claude-code-desktop-asset.js";
import {
  type ClaudeCodeHostAssetDescriptor,
  type ClaudeCodeHostAssetOperationResult,
  type ExecuteClaudeCodeHostAssetOperationRequest,
  executeClaudeCodeHostAssetOperation,
  planClaudeCodeHostAssetOperation,
} from "./claude-code-host-asset-operation.js";

/**
 * Wakeflow Host / Claude Code：桌面助手资产的维护操作（ADR-0025 D4、D6）。
 *
 * 与 tmux 助手资产同一通用操作：只读计划、单文件 CAS、0600、affected 恢复。桌面传输的宿主资产集合只有
 * 这一份资产加便携设置规则（没有状态行、没有 tmux 助手）；维护按选出的 profile 决定发布哪一份。
 */

export const CLAUDE_CODE_DESKTOP_ASSET_OPERATION_KIND = "desktop-asset" as const;
export const CLAUDE_CODE_DESKTOP_ASSET_OWNER_ID = "claude-code-desktop-asset" as const;
export const CLAUDE_CODE_DESKTOP_ASSET_OPERATION_ID = "claude-desktop-asset:install" as const;
/** 资产读不出（目录、符号链接、超过 256 KiB、权限不足）时宿主贡献报出的 blocker。 */
export const CLAUDE_CODE_DESKTOP_ASSET_BLOCKER = "claude-desktop-asset-unreadable" as const;

const CLAUDE_CODE_DESKTOP_ASSET_DESCRIPTOR: Readonly<ClaudeCodeHostAssetDescriptor> = Object.freeze(
  {
    fileName: CLAUDE_CODE_DESKTOP_ASSET_FILE_NAME,
    ref: CLAUDE_CODE_DESKTOP_ASSET_REF,
    content: CLAUDE_CODE_DESKTOP_ASSET_CONTENT,
    digest: CLAUDE_CODE_DESKTOP_ASSET_DIGEST,
    operationId: CLAUDE_CODE_DESKTOP_ASSET_OPERATION_ID,
    operationKind: CLAUDE_CODE_DESKTOP_ASSET_OPERATION_KIND,
    ownerId: CLAUDE_CODE_DESKTOP_ASSET_OWNER_ID,
    targetKey: "asset:claude-code:desktop",
  },
);

/** 零写计划：字节已是期望即 null，否则一条操作（sourceDigest 是当前字节摘要或 null）。 */
export function planClaudeCodeDesktopAssetOperation(
  root: RootedDirectory,
  options: { readonly signal?: AbortSignal } = {},
): Promise<WakeflowHostMaintenanceOperationInput | null> {
  return planClaudeCodeHostAssetOperation(root, CLAUDE_CODE_DESKTOP_ASSET_DESCRIPTOR, options);
}

/** 执行：缺失创建、不同 CAS 替换；已是期望字节即 current（恢复与普通执行同一判定）。 */
export function executeClaudeCodeDesktopAssetOperation(
  root: RootedDirectory,
  request: Readonly<ExecuteClaudeCodeHostAssetOperationRequest>,
): Promise<Readonly<ClaudeCodeHostAssetOperationResult>> {
  return executeClaudeCodeHostAssetOperation(root, CLAUDE_CODE_DESKTOP_ASSET_DESCRIPTOR, request);
}
