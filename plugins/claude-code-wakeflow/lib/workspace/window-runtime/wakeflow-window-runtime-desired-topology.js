import { buildWakeflowConfigIndexes, parseWakeflowConfig, WakeflowConfigError, } from "../../configuration/wakeflow-config.js";
import { computeCanonicalJsonSha256Digest, } from "../../foundation/crypto/canonical-json-sha256.js";
import { parseWakeflowWorkspaceHostResourceProfile, WakeflowWorkspaceHostResourceProfileError, } from "../workspace-host-resource-profile.js";
/**
 * Wakeflow Workspace / Window Runtime：由 Config 编译的期望窗口拓扑。
 *
 * 本模块只保留 Window Runtime 后续投影必需的稳定逻辑事实：程序、当前宿主、窗口
 * ID、职责、逻辑根引用和配置位置。它不定义持久文件格式，也不读取 Binding、文件
 * 系统或宿主状态；display title、raw handle、absolute path、dispatch/preflight 与真实
 * root observation 均不属于这一层。
 */
const WAKEFLOW_WINDOW_RUNTIME_DESIRED_TOPOLOGY_KIND = "WakeflowWindowRuntimeDesiredTopology";
const WAKEFLOW_WINDOW_RUNTIME_DESIRED_TOPOLOGY_VERSION = 1;
export const WAKEFLOW_WINDOW_RUNTIME_MAXIMUM_STATIC_WINDOWS = 1_024;
const ERROR_MESSAGES = {
    config: "Window Runtime desired topology Config is invalid.",
    profile: "Window Runtime desired topology Host Profile is invalid.",
    capacity: "Window Runtime desired topology exceeds its static window budget.",
    reference: "Window Runtime desired topology contains an unresolved root reference.",
};
/** Window Runtime 期望拓扑编译失败的稳定、脱敏错误。 */
export class WakeflowWindowRuntimeDesiredTopologyError extends Error {
    name = "WakeflowWindowRuntimeDesiredTopologyError";
    code = "wakeflow-window-runtime-desired-topology";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new WakeflowWindowRuntimeDesiredTopologyError(reason, path);
}
function compareWindowId(left, right) {
    return left.windowId < right.windowId
        ? -1
        : left.windowId > right.windowId
            ? 1
            : 0;
}
function desiredWindow(model, indexes, window) {
    let logicalRoot;
    let configuredPlacement;
    if (window.root.kind === "program") {
        logicalRoot = Object.freeze({
            kind: "program",
            programId: model.program.programId,
        });
        configuredPlacement = ".";
    }
    else if (window.root.kind === "support-surface") {
        const surfaceId = window.root.surfaceId;
        const surface = indexes.surfaceById[surfaceId];
        if (surface === undefined)
            fail("reference", "$window/root/surfaceId");
        logicalRoot = Object.freeze({
            kind: "support-surface",
            surfaceId: surface.surfaceId,
        });
        configuredPlacement = surface.path;
    }
    else {
        const repositoryId = window.root.repositoryId;
        const repository = indexes.repositoryById[repositoryId];
        if (repository === undefined) {
            fail("reference", "$window/root/repositoryId");
        }
        logicalRoot = Object.freeze({
            kind: "repository",
            repositoryId: repository.repositoryId,
        });
        configuredPlacement = repository.path;
    }
    const basis = {
        windowId: window.windowId,
        role: window.role,
        logicalRoot,
        configuredPlacement,
    };
    return Object.freeze({
        ...basis,
        windowTopologyDigest: computeCanonicalJsonSha256Digest(basis),
    });
}
/**
 * 将严格 Config 与当前 Host Profile 编译为稳定排序的纯期望拓扑。
 * 不相关的语言、显示名称或宿主运行状态变化不会改变该拓扑摘要。
 */
export function compileWakeflowWindowRuntimeDesiredTopology(configValue, profileValue) {
    let model;
    try {
        model = parseWakeflowConfig(configValue);
    }
    catch (error) {
        if (error instanceof WakeflowConfigError)
            fail("config", error.path);
        throw error;
    }
    let profile;
    try {
        profile = parseWakeflowWorkspaceHostResourceProfile(profileValue);
    }
    catch (error) {
        if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
            fail("profile", error.path);
        }
        throw error;
    }
    if (model.topology.windows.length > WAKEFLOW_WINDOW_RUNTIME_MAXIMUM_STATIC_WINDOWS) {
        fail("capacity", "$/topology/windows");
    }
    const indexes = buildWakeflowConfigIndexes(model);
    const windows = Object.freeze([...model.topology.windows]
        .sort(compareWindowId)
        .map((window) => desiredWindow(model, indexes, window)));
    const basis = {
        kind: WAKEFLOW_WINDOW_RUNTIME_DESIRED_TOPOLOGY_KIND,
        schemaVersion: WAKEFLOW_WINDOW_RUNTIME_DESIRED_TOPOLOGY_VERSION,
        programId: model.program.programId,
        hostId: profile.hostId,
        windows,
    };
    return Object.freeze({
        ...basis,
        desiredTopologyDigest: computeCanonicalJsonSha256Digest(basis),
    });
}
