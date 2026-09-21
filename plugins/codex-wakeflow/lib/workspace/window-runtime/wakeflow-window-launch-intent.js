import { buildWakeflowConfigIndexes, computeWakeflowConfigDigest, parseWakeflowConfig, WakeflowConfigError, } from "../../configuration/wakeflow-config.js";
import { computeCanonicalJsonSha256Digest, } from "../../foundation/crypto/canonical-json-sha256.js";
import { parseWakeflowWorkspaceHostResourceProfile, WakeflowWorkspaceHostResourceProfileError, } from "../workspace-host-resource-profile.js";
import { WAKEFLOW_WINDOW_RUNTIME_MAXIMUM_STATIC_WINDOWS, } from "./wakeflow-window-runtime-desired-topology.js";
const ERROR_MESSAGES = {
    config: "Wakeflow window launch intent Config is invalid.",
    profile: "Wakeflow window launch intent Host Profile is invalid.",
    capacity: "Wakeflow window launch intent exceeds its static window budget.",
    relation: "Wakeflow window launch intent root cannot be resolved.",
};
/** Window launch intent 编译失败的稳定、脱敏错误。 */
export class WakeflowWindowLaunchIntentError extends Error {
    name = "WakeflowWindowLaunchIntentError";
    code = "wakeflow-window-launch-intent";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new WakeflowWindowLaunchIntentError(reason, path);
}
function parseConfig(value) {
    try {
        return parseWakeflowConfig(value);
    }
    catch (error) {
        if (error instanceof WakeflowConfigError)
            fail("config", error.path);
        throw error;
    }
}
function parseProfile(value) {
    try {
        return parseWakeflowWorkspaceHostResourceProfile(value);
    }
    catch (error) {
        if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
            fail("profile", error.path);
        }
        throw error;
    }
}
function rootForWindow(model, indexes, window) {
    if (window.root.kind === "program") {
        return Object.freeze({
            kind: "program",
            rootId: model.program.programId,
            configuredPlacement: ".",
        });
    }
    if (window.root.kind === "repository") {
        const repository = indexes.repositoryById[window.root.repositoryId];
        if (repository === undefined)
            fail("relation", "$window.root");
        return Object.freeze({
            kind: "repository",
            rootId: repository.repositoryId,
            configuredPlacement: repository.path,
        });
    }
    const surface = indexes.surfaceById[window.root.surfaceId];
    if (surface === undefined)
        fail("relation", "$window.root");
    return Object.freeze({
        kind: "support-surface",
        rootId: surface.surfaceId,
        configuredPlacement: surface.path,
    });
}
function worktreeForWindow(pod, window) {
    if (pod.placement !== "worktree" || window.role !== "product")
        return null;
    const worktree = pod.worktrees.find((entry) => entry.windowId === window.windowId);
    if (worktree === undefined)
        fail("relation", "$window.worktree");
    return Object.freeze({
        repositoryId: worktree.repositoryId,
        suggestedName: worktree.suggestedName,
        basePolicy: "local-head",
    });
}
function attachedWorktreesForWindow(pod, window) {
    if (pod.placement !== "worktree" || window.role !== "test")
        return Object.freeze([]);
    return Object.freeze(pod.worktrees.map((entry) => Object.freeze({ repositoryId: entry.repositoryId, productWindowId: entry.windowId })));
}
function createIntent(model, profile, configDigest, profileDigest, indexes, window) {
    const pod = indexes.podById[window.podId];
    if (pod === undefined)
        fail("relation", "$window.podId");
    const basis = Object.freeze({
        kind: "WakeflowWindowLaunchIntent",
        schemaVersion: 1,
        windowId: window.windowId,
        podId: pod.podId,
        podName: pod.name,
        podPlacement: pod.placement,
        role: window.role,
        displayTitle: window.displayName,
        root: rootForWindow(model, indexes, window),
        worktree: worktreeForWindow(pod, window),
        attachedWorktrees: attachedWorktreesForWindow(pod, window),
        host: Object.freeze({
            hostId: profile.hostId,
            profileDigest,
        }),
        create: Object.freeze({
            effect: "create-window",
            authorization: "not-authorized-by-preview",
        }),
        registration: Object.freeze({
            operation: "register-window-host-binding",
            rawHandleSource: "host-create-result",
            identityAuthority: "window-host-binding",
        }),
        configDigest,
    });
    return Object.freeze({
        ...basis,
        intentDigest: computeCanonicalJsonSha256Digest(basis),
    });
}
/** 从完整Config和当前Host Profile生成按windowId排序的launch intent集合。 */
export function compileWakeflowWindowLaunchIntents(configValue, profileValue) {
    const model = parseConfig(configValue);
    const profile = parseProfile(profileValue);
    if (model.topology.windows.length
        > WAKEFLOW_WINDOW_RUNTIME_MAXIMUM_STATIC_WINDOWS) {
        fail("capacity", "$/topology/windows");
    }
    const indexes = buildWakeflowConfigIndexes(model);
    const configDigest = computeWakeflowConfigDigest(model);
    const profileDigest = computeCanonicalJsonSha256Digest(profile);
    const intents = Object.freeze([...model.topology.windows]
        .sort((left, right) => (left.windowId < right.windowId
        ? -1
        : left.windowId > right.windowId
            ? 1
            : 0))
        .map((window) => createIntent(model, profile, configDigest, profileDigest, indexes, window)));
    const basis = Object.freeze({
        kind: "WakeflowWindowLaunchIntentSet",
        schemaVersion: 1,
        hostId: profile.hostId,
        configDigest,
        profileDigest,
        intents,
    });
    return Object.freeze({
        ...basis,
        launchSetDigest: computeCanonicalJsonSha256Digest(basis),
    });
}
