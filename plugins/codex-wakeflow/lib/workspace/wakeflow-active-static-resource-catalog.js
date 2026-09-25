import { computeCanonicalJsonSha256Digest } from "../foundation/crypto/canonical-json-sha256.js";
import { REQUIREMENT_BOARD_INDEX_REF, REQUIREMENT_BOARD_ROOT_REF, WAKEFLOW_ACTIVE_CURRENT_ROOT_REF, WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF, WAKEFLOW_ACTIVE_ROOT_REF, WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF, WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF, } from "../kernel/layout.js";
import { parseWakeflowWorkspaceResourceDeclaration, privateWorkspaceDirectoryDeclaration, } from "./workspace-resource-declaration.js";
/**
 * Wakeflow Workspace / Active：共享活动根的静态资源声明。
 *
 * `.wakeflow-active` 与 `current` 两级容器只由 Active Layout owner 创建，各领域分别声明自己的
 * 后代；两份工作区投影、投影锁与需求看板的目录和人读索引在这里登记，供静态资源矩阵
 * 做节点策略检查。投影内容、标记与重写规则在内核 `active-projection`，看板状态在内核
 * `requirement-board`；本模块只有声明与摘要。
 */
function directoryDeclaration(declarationId, ownerId, relativePath) {
    return privateWorkspaceDirectoryDeclaration({
        declarationId,
        family: "active",
        ownerId,
        scope: "host-neutral",
        relativePath,
    });
}
function projectionDeclaration(declarationId, ownerId, relativePath) {
    return parseWakeflowWorkspaceResourceDeclaration({
        kind: "WakeflowWorkspaceResourceDeclaration",
        declarationId,
        family: "active",
        ownerId,
        scope: "host-neutral",
        placement: { root: { kind: "workspace" }, relativePath },
        tracking: { disposition: "ignored", privacy: "runtime-private" },
        nodePolicy: {
            kind: "file",
            mode: "0600",
            linkPolicy: "single-link",
            executablePolicy: "forbidden",
        },
        processing: {
            kind: "resource",
            role: "derived-projection",
            allowedMutationRecipes: ["deterministic-rewrite"],
            recoveryStrategy: "rebuild-from-authority",
        },
    });
}
export const WAKEFLOW_ACTIVE_ROOT_RESOURCE_DECLARATION = directoryDeclaration("active.root", "active-layout", WAKEFLOW_ACTIVE_ROOT_REF);
export const WAKEFLOW_ACTIVE_CURRENT_ROOT_RESOURCE_DECLARATION = directoryDeclaration("active.current-root", "active-layout", WAKEFLOW_ACTIVE_CURRENT_ROOT_REF);
export const WAKEFLOW_ACTIVE_LAYOUT_RESOURCE_CATALOG = Object.freeze([
    WAKEFLOW_ACTIVE_ROOT_RESOURCE_DECLARATION,
    WAKEFLOW_ACTIVE_CURRENT_ROOT_RESOURCE_DECLARATION,
]);
export const WAKEFLOW_ACTIVE_WORKSPACE_INDEX_RESOURCE_DECLARATION = projectionDeclaration("active.workspace-index", "active-workspace-projection", WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF);
export const WAKEFLOW_ACTIVE_WORKSPACE_STATUS_RESOURCE_DECLARATION = projectionDeclaration("active.workspace-status", "active-workspace-projection", WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF);
export const WAKEFLOW_ACTIVE_PROJECTION_LOCK_RESOURCE_DECLARATION = parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: "active.workspace-projection-lock",
    family: "active",
    ownerId: "active-workspace-projection",
    scope: "host-neutral",
    placement: { root: { kind: "workspace" }, relativePath: WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF },
    tracking: { disposition: "ignored", privacy: "runtime-private" },
    nodePolicy: {
        kind: "file",
        mode: "0600",
        linkPolicy: "single-link",
        executablePolicy: "forbidden",
    },
    processing: {
        kind: "resource",
        role: "transaction-artifact",
        allowedMutationRecipes: ["exclusive-create", "exact-retire"],
        recoveryStrategy: "owner-transaction-recovery",
    },
});
export const WAKEFLOW_ACTIVE_STATIC_RESOURCE_CATALOG = Object.freeze([
    ...WAKEFLOW_ACTIVE_LAYOUT_RESOURCE_CATALOG,
    WAKEFLOW_ACTIVE_WORKSPACE_INDEX_RESOURCE_DECLARATION,
    WAKEFLOW_ACTIVE_WORKSPACE_STATUS_RESOURCE_DECLARATION,
    WAKEFLOW_ACTIVE_PROJECTION_LOCK_RESOURCE_DECLARATION,
]);
/** Active Layout 两级容器策略的语义摘要；维护计划用它做步骤目标。 */
export const WAKEFLOW_ACTIVE_LAYOUT_AUTHORITY_DIGEST = computeCanonicalJsonSha256Digest({
    kind: "WakeflowActiveLayoutAuthority",
    schemaVersion: 1,
    declarations: WAKEFLOW_ACTIVE_LAYOUT_RESOURCE_CATALOG,
});
export const REQUIREMENT_BOARD_RESOURCE_OWNER_ID = "requirement-board";
/** 需求看板 owner 的确定性静态资源目录：目录与人读索引。 */
export const WAKEFLOW_REQUIREMENT_BOARD_STATIC_RESOURCE_CATALOG = Object.freeze([
    directoryDeclaration("active.board.root", REQUIREMENT_BOARD_RESOURCE_OWNER_ID, REQUIREMENT_BOARD_ROOT_REF),
    projectionDeclaration("active.board.index", REQUIREMENT_BOARD_RESOURCE_OWNER_ID, REQUIREMENT_BOARD_INDEX_REF),
]);
