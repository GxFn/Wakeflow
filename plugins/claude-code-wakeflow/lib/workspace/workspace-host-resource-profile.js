import { parsePlainRecord, PassiveOwnDataError, } from "../foundation/data/passive-own-data.js";
import { parsePortableResourcePath, PortableResourcePathError, splitPortableResourcePath, } from "../foundation/filesystem/portable-resource-path.js";
/**
 * Wakeflow Workspace：会改变资源矩阵形状的宿主静态画像。
 *
 * 这是一个字段集合严格受限的专用数据合同，不是完整的宿主门面。它只登记宿主资源
 * 编译器真正需要的协议身份、运行目录、指令文件名和资源表面；不保存实现状态、就绪
 * 状态、适配器、句柄、启动偏好、实时探测或副作用。
 *
 * Codex 与 Claude Code 分别在 `src/hosts/*` 提供本合同的值。共享代码只能使用这里
 * 规范化后的数据，不得通过 `hostId` 分支重新推导宿主差异。
 */
export const WAKEFLOW_WORKSPACE_HOST_RESOURCE_PROFILE_KIND = "WakeflowWorkspaceHostResourceProfile";
export const WAKEFLOW_WORKSPACE_HOST_IDS = Object.freeze([
    "codex",
    "claude-code",
]);
export const WAKEFLOW_WORKSPACE_HOST_RESOURCE_SURFACE_NAMES = Object.freeze([
    "windowIdentity",
    "podReceipts",
    "worktree",
    "keepLive",
    "windowLocator",
    "settingsIntegration",
    "statuslineAsset",
    "tmuxAsset",
    "activityMonitor",
    "temporaryPrompts",
]);
export const WAKEFLOW_WORKSPACE_HOST_WORKTREE_LAUNCHES = Object.freeze([
    "claude-worktree-flag",
    "codex-worktree-thread",
]);
export const WAKEFLOW_WORKSPACE_HOST_ATTACHED_DIRECTORY_MODES = Object.freeze([
    "add-dir-flag",
    "prompt-path",
]);
const ERROR_MESSAGES = {
    input: "Wakeflow workspace host resource profile is not passive data.",
    shape: "Wakeflow workspace host resource profile has an invalid shape.",
    host: "Wakeflow workspace host identity is invalid.",
    component: "Wakeflow workspace host resource component is invalid.",
    path: "Wakeflow workspace host resource path is invalid.",
    surface: "Wakeflow workspace host resource surface is invalid.",
    contradiction: "Wakeflow workspace host resource facts conflict.",
};
/** Host Resource Profile 准入失败的稳定、脱敏错误。 */
export class WakeflowWorkspaceHostResourceProfileError extends Error {
    name = "WakeflowWorkspaceHostResourceProfileError";
    code = "wakeflow-workspace-host-resource-profile";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const HOST_ID_SET = new Set(WAKEFLOW_WORKSPACE_HOST_IDS);
const PROFILE_FIELDS = new Set([
    "kind",
    "hostId",
    "runtimeDirectoryName",
    "instructionFileName",
    "surfaces",
    "launch",
]);
const TMUX_LAUNCH_FIELDS = new Set([
    "kind",
    "controllerEffort",
    "defaultEffort",
    "permissionMode",
    "sessionName",
]);
const THREAD_LAUNCH_FIELDS = new Set(["kind"]);
const LAUNCH_VALUE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SURFACE_FIELDS = new Set(WAKEFLOW_WORKSPACE_HOST_RESOURCE_SURFACE_NAMES);
const SETTINGS_INTEGRATION_FIELDS = new Set(["portablePath", "localPath"]);
const WORKTREE_FIELDS = new Set(["launch", "attachedDirectories"]);
const WORKTREE_LAUNCH_SET = new Set(WAKEFLOW_WORKSPACE_HOST_WORKTREE_LAUNCHES);
const ATTACHED_DIRECTORY_MODE_SET = new Set(WAKEFLOW_WORKSPACE_HOST_ATTACHED_DIRECTORY_MODES);
const STATUSLINE_ASSET_FIELDS = new Set(["fileName"]);
function fail(reason, path) {
    throw new WakeflowWorkspaceHostResourceProfileError(reason, path);
}
function propertyPath(base, key) {
    const escaped = key.replaceAll("~", "~0").replaceAll("/", "~1");
    return `${base}/${escaped}`;
}
function assertExactFields(record, allowed, path) {
    const unknown = Object.keys(record).sort().find((key) => !allowed.has(key));
    if (unknown !== undefined)
        fail("shape", propertyPath(path, unknown));
}
function plainRecord(value, path) {
    try {
        return parsePlainRecord(value, path);
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", error.path);
        throw error;
    }
}
function parseHostId(value) {
    if (typeof value !== "string" || !HOST_ID_SET.has(value)) {
        fail("host", "$/hostId");
    }
    return value;
}
function parseComponent(value, path) {
    try {
        const resourcePath = parsePortableResourcePath(value, path);
        if (splitPortableResourcePath(resourcePath, path).length !== 1) {
            fail("component", path);
        }
        return resourcePath;
    }
    catch (error) {
        if (error instanceof PortableResourcePathError)
            fail("component", path);
        throw error;
    }
}
function parseResourcePath(value, path) {
    try {
        return parsePortableResourcePath(value, path);
    }
    catch (error) {
        if (error instanceof PortableResourcePathError)
            fail("path", path);
        throw error;
    }
}
function parseSettingsIntegration(value) {
    if (value === null)
        return null;
    const record = plainRecord(value, "$/surfaces/settingsIntegration");
    assertExactFields(record, SETTINGS_INTEGRATION_FIELDS, "$/surfaces/settingsIntegration");
    return Object.freeze({
        portablePath: parseResourcePath(record.portablePath, "$/surfaces/settingsIntegration/portablePath"),
        localPath: parseResourcePath(record.localPath, "$/surfaces/settingsIntegration/localPath"),
    });
}
function parseStatuslineAsset(value) {
    if (value === null)
        return null;
    const record = plainRecord(value, "$/surfaces/statuslineAsset");
    assertExactFields(record, STATUSLINE_ASSET_FIELDS, "$/surfaces/statuslineAsset");
    return Object.freeze({
        fileName: parseComponent(record.fileName, "$/surfaces/statuslineAsset/fileName"),
    });
}
function parseTmuxAsset(value) {
    if (value === null)
        return null;
    const record = plainRecord(value, "$/surfaces/tmuxAsset");
    assertExactFields(record, STATUSLINE_ASSET_FIELDS, "$/surfaces/tmuxAsset");
    return Object.freeze({
        fileName: parseComponent(record.fileName, "$/surfaces/tmuxAsset/fileName"),
    });
}
function parseWorktreeTemplate(value) {
    const record = plainRecord(value, "$/surfaces/worktree");
    assertExactFields(record, WORKTREE_FIELDS, "$/surfaces/worktree");
    const { launch, attachedDirectories } = record;
    if (typeof launch !== "string" || !WORKTREE_LAUNCH_SET.has(launch)) {
        fail("surface", "$/surfaces/worktree/launch");
    }
    if (typeof attachedDirectories !== "string"
        || !ATTACHED_DIRECTORY_MODE_SET.has(attachedDirectories)) {
        fail("surface", "$/surfaces/worktree/attachedDirectories");
    }
    return Object.freeze({
        launch: launch,
        attachedDirectories: attachedDirectories,
    });
}
function surfaceBoolean(value, name) {
    if (typeof value !== "boolean")
        fail("surface", `$/surfaces/${name}`);
    return value;
}
function parseSurfaces(value) {
    const record = plainRecord(value, "$/surfaces");
    assertExactFields(record, SURFACE_FIELDS, "$/surfaces");
    const settingsIntegration = parseSettingsIntegration(record.settingsIntegration);
    const statuslineAsset = parseStatuslineAsset(record.statuslineAsset);
    if (settingsIntegration !== null
        && settingsIntegration.portablePath === settingsIntegration.localPath) {
        fail("contradiction", "$/surfaces/settingsIntegration/localPath");
    }
    if (statuslineAsset !== null && settingsIntegration === null) {
        fail("contradiction", "$/surfaces/statuslineAsset");
    }
    return Object.freeze({
        windowIdentity: surfaceBoolean(record.windowIdentity, "windowIdentity"),
        podReceipts: surfaceBoolean(record.podReceipts, "podReceipts"),
        worktree: parseWorktreeTemplate(record.worktree),
        keepLive: surfaceBoolean(record.keepLive, "keepLive"),
        windowLocator: surfaceBoolean(record.windowLocator, "windowLocator"),
        settingsIntegration,
        statuslineAsset,
        tmuxAsset: parseTmuxAsset(record.tmuxAsset),
        activityMonitor: surfaceBoolean(record.activityMonitor, "activityMonitor"),
        temporaryPrompts: surfaceBoolean(record.temporaryPrompts, "temporaryPrompts"),
    });
}
function launchValue(value, path) {
    if (typeof value !== "string" || !LAUNCH_VALUE_PATTERN.test(value)) {
        fail("surface", path);
    }
    return value;
}
function parseLaunchTemplate(value) {
    const record = plainRecord(value, "$/launch");
    if (record.kind === "host-thread") {
        assertExactFields(record, THREAD_LAUNCH_FIELDS, "$/launch");
        return Object.freeze({ kind: "host-thread" });
    }
    if (record.kind !== "tmux-session")
        fail("surface", "$/launch/kind");
    assertExactFields(record, TMUX_LAUNCH_FIELDS, "$/launch");
    return Object.freeze({
        kind: "tmux-session",
        controllerEffort: launchValue(record.controllerEffort, "$/launch/controllerEffort"),
        defaultEffort: launchValue(record.defaultEffort, "$/launch/defaultEffort"),
        permissionMode: launchValue(record.permissionMode, "$/launch/permissionMode"),
        sessionName: launchValue(record.sessionName, "$/launch/sessionName"),
    });
}
/** 把任意输入准入为解除别名、递归冻结的宿主资源画像。 */
export function parseWakeflowWorkspaceHostResourceProfile(value) {
    const record = plainRecord(value, "$");
    assertExactFields(record, PROFILE_FIELDS, "$");
    if (record.kind !== WAKEFLOW_WORKSPACE_HOST_RESOURCE_PROFILE_KIND) {
        fail("shape", "$/kind");
    }
    const hostId = parseHostId(record.hostId);
    const runtimeDirectoryName = parseComponent(record.runtimeDirectoryName, "$/runtimeDirectoryName");
    if (runtimeDirectoryName !== hostId) {
        fail("contradiction", "$/runtimeDirectoryName");
    }
    const surfaces = parseSurfaces(record.surfaces);
    const launch = parseLaunchTemplate(record.launch);
    if (launch.kind === "tmux-session" && !surfaces.windowLocator) {
        fail("contradiction", "$/launch");
    }
    return Object.freeze({
        kind: WAKEFLOW_WORKSPACE_HOST_RESOURCE_PROFILE_KIND,
        hostId,
        runtimeDirectoryName,
        instructionFileName: parseComponent(record.instructionFileName, "$/instructionFileName"),
        surfaces,
        launch,
    });
}
