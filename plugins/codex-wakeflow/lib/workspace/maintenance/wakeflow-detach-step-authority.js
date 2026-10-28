import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
/**
 * Wakeflow Workspace / Maintenance：退出路径三个共享步的目标权威（ADR-0024）。
 *
 * 预览与执行各自从 Config 与 profile 重算同一摘要：`remove-managed-block` 的权威是"该文件里没有
 * 这个 component/owner 的托管块"，`retire-window-projections` 的权威是"这组窗口没有投影文件"，
 * `retire-config` 的权威是"带这个摘要的配置文件已改名为退役文件"。权威不含文件正文，所以执行时
 * 文件已被删或块已不在都算 current，而不是目标漂移。
 */
/** detach-workspace 的窗口投影退役步与宿主步共用的 targetKey。 */
export const WAKEFLOW_DETACH_WORKSPACE_TARGET_KEY = "workspace";
export function wakeflowManagedBlockRemovalAuthorityDigest(identity, instructionFileName) {
    return computeCanonicalJsonSha256Digest({
        kind: "WakeflowManagedBlockRemovalAuthority",
        schemaVersion: 1,
        component: identity.component,
        owner: identity.owner,
        instructionFileName,
    });
}
export function wakeflowWindowProjectionRetirementAuthorityDigest(windowIds) {
    return computeCanonicalJsonSha256Digest({
        kind: "WakeflowWindowProjectionRetirementAuthority",
        schemaVersion: 1,
        windowIds: [...windowIds].sort(),
    });
}
export function wakeflowConfigRetirementAuthorityDigest(configDigest) {
    return computeCanonicalJsonSha256Digest({
        kind: "WakeflowConfigAuthorityRetirementAuthority",
        schemaVersion: 1,
        configDigest,
    });
}
