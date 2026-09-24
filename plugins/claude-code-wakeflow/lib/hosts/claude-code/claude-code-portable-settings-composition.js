import { types } from "node:util";
import { computeWakeflowConfigDigest, parseWakeflowConfig, WakeflowConfigError, } from "../../configuration/wakeflow-config.js";
import { validateWakeflowConfigRootPlacements, WakeflowConfigRootPlacementError, } from "../../configuration/wakeflow-config-root-placement.js";
import { computeCanonicalJsonSha256Digest, } from "../../foundation/crypto/canonical-json-sha256.js";
import { PassiveOwnDataError, parsePlainRecord, } from "../../foundation/data/passive-own-data.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { parseWakeflowWorkspaceHostResourceProfile, WakeflowWorkspaceHostResourceProfileError, } from "../../workspace/workspace-host-resource-profile.js";
import { CLAUDE_CODE_PORTABLE_SETTINGS_REF, ClaudeCodePortableSettingsPublicationError, inspectClaudeCodePortableSettings, } from "./claude-code-portable-settings-publication.js";
import { claudeCodePortableSettingsRulesFor, planClaudeCodePortableSettingsTransition, } from "./claude-code-portable-settings-transition.js";
/**
 * Wakeflow Host / Claude Code：portable settings 的多根只读 composition。
 *
 * Program 根与 `wakeflow-managed` Support 根是当前唯一 writer-eligible 集合；
 * external-owned Support 和所有 Repository 均不进入 authority。计划只保存逻辑根、
 * source/target digest 与 action，不保存绝对路径或用户 settings 字节。
 */
export const CLAUDE_CODE_PORTABLE_SETTINGS_COMPOSITION_ACTIONS = Object.freeze([
    "fresh-initialize",
    "reconfigure",
    "reconcile",
]);
const ERROR_MESSAGES = {
    input: "Claude portable settings composition input is invalid.",
    config: "Claude portable settings composition Config is invalid.",
    profile: "Claude portable settings composition Host Profile is invalid.",
    placement: "Claude portable settings composition root placement is invalid.",
    "root-open": "Claude portable settings composition root could not be opened.",
    inspection: "Claude portable settings composition source inspection failed.",
    "close-failure": "Claude portable settings composition root could not be closed.",
    aborted: "Claude portable settings composition was aborted.",
};
/** Claude portable settings composition 失败的稳定、脱敏错误。 */
export class ClaudeCodePortableSettingsCompositionError extends Error {
    name = "ClaudeCodePortableSettingsCompositionError";
    code = "wakeflow-claude-code-portable-settings-composition";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new ClaudeCodePortableSettingsCompositionError(reason, path);
}
function parseRequest(value) {
    let record;
    try {
        record = parsePlainRecord(value, "$request");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$request");
        throw error;
    }
    if (!Object.hasOwn(record, "action")
        || !Object.hasOwn(record, "config")
        || !Object.hasOwn(record, "profile")
        || Object.keys(record).some((key) => (key !== "action" && key !== "config" && key !== "profile" && key !== "signal"))
        || typeof record.action !== "string"
        || !CLAUDE_CODE_PORTABLE_SETTINGS_COMPOSITION_ACTIONS.includes(record.action)
        || (record.signal !== undefined
            && (typeof record.signal !== "object"
                || record.signal === null
                || types.isProxy(record.signal)
                || !(record.signal instanceof AbortSignal)))) {
        fail("input", "$request");
    }
    let model;
    try {
        model = parseWakeflowConfig(record.config);
    }
    catch (error) {
        if (error instanceof WakeflowConfigError)
            fail("config", error.path);
        throw error;
    }
    let profile;
    try {
        profile = parseWakeflowWorkspaceHostResourceProfile(record.profile);
    }
    catch (error) {
        if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
            fail("profile", error.path);
        }
        throw error;
    }
    if (profile.hostId !== "claude-code"
        || profile.surfaces.settingsIntegration?.portablePath
            !== CLAUDE_CODE_PORTABLE_SETTINGS_REF) {
        fail("profile", "$/profile");
    }
    return Object.freeze({
        action: record.action,
        model,
        profile: profile,
        signal: record.signal,
    });
}
export function compileClaudeCodePortableSettingsRootAuthority(model) {
    const roots = [Object.freeze({
            rootKind: "program",
            rootId: model.program.programId,
            configuredPlacement: ".",
            resourceRef: CLAUDE_CODE_PORTABLE_SETTINGS_REF,
        })];
    for (const surface of [...model.topology.supportSurfaces].sort((left, right) => (left.surfaceId < right.surfaceId ? -1 : left.surfaceId > right.surfaceId ? 1 : 0))) {
        if (surface.ownership !== "wakeflow-managed")
            continue;
        roots.push(Object.freeze({
            rootKind: "support-surface",
            rootId: surface.surfaceId,
            configuredPlacement: surface.path,
            resourceRef: CLAUDE_CODE_PORTABLE_SETTINGS_REF,
        }));
    }
    const frozenRoots = Object.freeze(roots);
    const basis = {
        kind: "ClaudeCodePortableSettingsRootAuthority",
        schemaVersion: 1,
        programId: model.program.programId,
        hostId: "claude-code",
        configDigest: computeWakeflowConfigDigest(model),
        roots: frozenRoots,
    };
    return Object.freeze({
        ...basis,
        authorityDigest: computeCanonicalJsonSha256Digest(basis),
    });
}
export function createClaudeCodePortableSettingsOperation(authorityDigest, root, action, sourceDigest, targetDigest) {
    const basis = {
        operationId: `claude-portable-settings:${root.rootKind}:${root.rootId}`,
        authorityDigest,
        root,
        action,
        sourceDigest,
        targetDigest,
    };
    return Object.freeze({
        ...basis,
        operationDigest: computeCanonicalJsonSha256Digest(basis),
    });
}
async function inspectPresentRoot(absolutePath, signal) {
    let root;
    try {
        root = await RootedDirectory.open(absolutePath, "$configuredRoot");
    }
    catch (error) {
        if (error instanceof RootedDirectoryError)
            fail("root-open", "$configuredRoot");
        throw error;
    }
    let inspection;
    let primaryError;
    try {
        inspection = await inspectClaudeCodePortableSettings(root, signal === undefined ? {} : { signal });
    }
    catch (error) {
        primaryError = error;
    }
    let closeError;
    try {
        await root.close();
    }
    catch (error) {
        closeError = error;
    }
    if (primaryError !== undefined) {
        if (primaryError instanceof ClaudeCodePortableSettingsPublicationError) {
            if (primaryError.reason === "aborted")
                fail("aborted", "$signal");
            fail("inspection", "$settings");
        }
        throw primaryError;
    }
    if (closeError !== undefined)
        fail("close-failure", "$configuredRoot");
    if (inspection === undefined)
        fail("inspection", "$settings");
    return inspection;
}
/** 为 Program 与 Wakeflow-managed Support roots 生成零写入 portable settings 计划。 */
export async function planClaudeCodePortableSettingsComposition(workspaceRootValue, requestValue) {
    if (typeof workspaceRootValue !== "object"
        || workspaceRootValue === null
        || types.isProxy(workspaceRootValue)
        || !(workspaceRootValue instanceof RootedDirectory)) {
        fail("input", "$workspaceRoot");
    }
    const request = parseRequest(requestValue);
    if (request.signal?.aborted === true)
        fail("aborted", "$signal");
    const authority = compileClaudeCodePortableSettingsRootAuthority(request.model);
    let placements;
    try {
        placements = await validateWakeflowConfigRootPlacements(workspaceRootValue, request.model);
    }
    catch (error) {
        if (error instanceof WakeflowConfigRootPlacementError) {
            fail("placement", error.path);
        }
        throw error;
    }
    const rootEntries = [];
    const operations = [];
    const blockerCodes = new Set();
    for (const root of authority.roots) {
        let placementStatus;
        let transition;
        if (root.rootKind === "program") {
            placementStatus = "present";
            transition = (await inspectClaudeCodePortableSettings(workspaceRootValue, {
                rules: claudeCodePortableSettingsRulesFor("program"),
                ...(request.signal === undefined ? {} : { signal: request.signal }),
            })).transition;
        }
        else {
            const placement = placements.roots.find((entry) => (entry.key === `support.${root.rootId}.root`));
            if (placement === undefined)
                fail("placement", "$supportRoot");
            if (placement.state === "missing") {
                if (request.action !== "fresh-initialize") {
                    blockerCodes.add(`support-root-missing:${root.rootId}`);
                    rootEntries.push(Object.freeze({
                        root,
                        placementStatus: "planned-missing",
                        settingsStatus: "blocked",
                        transitionReason: null,
                    }));
                    continue;
                }
                placementStatus = "planned-missing";
                transition = planClaudeCodePortableSettingsTransition(null);
            }
            else {
                placementStatus = "present";
                transition = (await inspectPresentRoot(placement.absolutePath, request.signal)).transition;
            }
        }
        if (transition.status === "blocked") {
            blockerCodes.add(`settings-blocked:${root.rootKind}:${root.rootId}:${transition.reason}`);
        }
        else if (transition.status === "create" || transition.status === "update") {
            if (transition.desiredDigest === null)
                fail("inspection", "$transition");
            operations.push(createClaudeCodePortableSettingsOperation(authority.authorityDigest, root, transition.status, transition.sourceDigest, transition.desiredDigest));
        }
        rootEntries.push(Object.freeze({
            root,
            placementStatus,
            settingsStatus: transition.status,
            transitionReason: transition.reason,
        }));
    }
    const sortedBlockers = Object.freeze([...blockerCodes].sort());
    const frozenRoots = Object.freeze(rootEntries);
    const frozenOperations = Object.freeze(operations);
    return Object.freeze({
        action: request.action,
        status: sortedBlockers.length === 0 ? "ready" : "blocked",
        authorityDigest: authority.authorityDigest,
        roots: frozenRoots,
        operations: frozenOperations,
        blockerCodes: sortedBlockers,
    });
}
