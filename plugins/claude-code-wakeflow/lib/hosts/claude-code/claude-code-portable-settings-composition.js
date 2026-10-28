import { types } from "node:util";
import { computeWakeflowConfigDigest, parseWakeflowConfig, WakeflowConfigError, } from "../../configuration/wakeflow-config.js";
import { validateWakeflowConfigRootPlacements, WakeflowConfigRootPlacementError, } from "../../configuration/wakeflow-config-root-placement.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { PassiveOwnDataError, parsePlainRecord } from "../../foundation/data/passive-own-data.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { isWakeflowDetachAction, WAKEFLOW_STATIC_MATERIALIZATION_ACTIONS, } from "../../workspace/maintenance/wakeflow-static-materialization-preview-contract.js";
import { parseWakeflowWorkspaceHostResourceProfile, WakeflowWorkspaceHostResourceProfileError, } from "../../workspace/workspace-host-resource-profile.js";
import { CLAUDE_CODE_PORTABLE_SETTINGS_REF, ClaudeCodePortableSettingsPublicationError, inspectClaudeCodePortableSettings, } from "./claude-code-portable-settings-publication.js";
import { claudeCodePortableSettingsRemovedRulesFor, claudeCodePortableSettingsRetiredRulesFor, claudeCodePortableSettingsRulesFor, planClaudeCodePortableSettingsTransition, } from "./claude-code-portable-settings-transition.js";
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
class ClaudeCodePortableSettingsCompositionError extends Error {
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
    if (!Object.hasOwn(record, "action") ||
        !Object.hasOwn(record, "config") ||
        !Object.hasOwn(record, "profile") ||
        Object.keys(record).some((key) => key !== "action" && key !== "config" && key !== "profile" && key !== "signal") ||
        typeof record.action !== "string" ||
        !WAKEFLOW_STATIC_MATERIALIZATION_ACTIONS.includes(record.action) ||
        (record.signal !== undefined &&
            (typeof record.signal !== "object" ||
                record.signal === null ||
                types.isProxy(record.signal) ||
                !(record.signal instanceof AbortSignal)))) {
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
    if (profile.hostId !== "claude-code" ||
        profile.surfaces.settingsIntegration?.portablePath !== CLAUDE_CODE_PORTABLE_SETTINGS_REF) {
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
    const roots = [
        Object.freeze({
            rootKind: "program",
            rootId: model.program.programId,
            configuredPlacement: ".",
            resourceRef: CLAUDE_CODE_PORTABLE_SETTINGS_REF,
        }),
    ];
    for (const surface of [...model.topology.supportSurfaces].sort((left, right) => left.surfaceId < right.surfaceId ? -1 : left.surfaceId > right.surfaceId ? 1 : 0)) {
        if (surface.ownership !== "wakeflow-managed")
            continue;
        roots.push(Object.freeze({
            rootKind: "support-surface",
            rootId: surface.surfaceId,
            configuredPlacement: surface.path,
            resourceRef: CLAUDE_CODE_PORTABLE_SETTINGS_REF,
            role: surface.capability,
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
/** 退出路径的宿主步种类（ADR-0024）：与共享步骤表里的名字逐字相同，宿主贡献用它做 operationKind。 */
export const CLAUDE_CODE_PORTABLE_SETTINGS_REMOVAL_OPERATION_KIND = "remove-portable-settings-rules";
/** 退出路径里 settings.json 读不出、不是对象或不合写入策略时的 blocker 前缀；后缀是该根的 targetKey。 */
export const CLAUDE_CODE_PORTABLE_SETTINGS_REMOVAL_BLOCKER = "detach-settings-unreadable";
/** 退出路径宿主步的 targetKey（ADR-0024）：程序根 `program`，托管支撑面 `support:<surfaceId>`。 */
export function claudeCodePortableSettingsRemovalTargetKey(root) {
    return root.rootKind === "program" ? "program" : `support:${root.rootId}`;
}
const BLOCKING_PUBLICATION_REASONS = new Set([
    "source-policy",
    "directory-policy",
    "root-scope",
]);
/**
 * 只读检查一个根；用户 settings 节点不合 Wakeflow 的写入策略时降为 blocker，
 * 不让整个 maintenance preview 失败。
 */
async function inspectRootSettings(root, options) {
    try {
        return {
            transition: (await inspectClaudeCodePortableSettings(root, options)).transition,
        };
    }
    catch (error) {
        if (!(error instanceof ClaudeCodePortableSettingsPublicationError)) {
            throw error;
        }
        if (error.reason === "aborted")
            fail("aborted", "$signal");
        if (BLOCKING_PUBLICATION_REASONS.has(error.reason)) {
            return { blockedReason: error.reason };
        }
        fail("inspection", "$settings");
    }
}
async function inspectPresentRoot(absolutePath, options) {
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
        inspection = await inspectRootSettings(root, options);
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
    if (primaryError !== undefined)
        throw primaryError;
    if (closeError !== undefined)
        fail("close-failure", "$configuredRoot");
    if (inspection === undefined)
        fail("inspection", "$settings");
    return inspection;
}
/**
 * 面根不在时仍能把规则计划成 create 的维护动作（open-items W5 / CR-H6）：fresh-initialize 建新根，
 * reconcile 重建被用户删掉或移走的受管根。两者的共享预览都先计划 `materialize-support-root`，执行
 * 计划又让每条宿主操作依赖前一共享步，所以写规则时根已经在。reconfigure 的缺根仍报
 * `support-root-missing:<surfaceId>`：先 reconcile 修根，再改配置。状态行的支撑面计划共用这一条判据。
 */
export function claudeCodeMaintenanceMaterializesMissingSupportRoot(action) {
    return action === "fresh-initialize" || action === "reconcile";
}
function rootEntry(root, placementStatus, settingsStatus, transitionReason) {
    return Object.freeze({ root, placementStatus, settingsStatus, transitionReason });
}
async function rootPlacements(workspaceRoot, model) {
    try {
        return await validateWakeflowConfigRootPlacements(workspaceRoot, model);
    }
    catch (error) {
        if (error instanceof WakeflowConfigRootPlacementError) {
            fail("placement", error.path);
        }
        throw error;
    }
}
function supportPlacement(placements, root) {
    const placement = placements.roots.find((entry) => entry.key === `support.${root.rootId}.root`);
    if (placement === undefined)
        fail("placement", "$supportRoot");
    return placement;
}
function signalOptions(signal) {
    return signal === undefined ? {} : { signal };
}
/** 写入动作的一个根：程序根直接读；支撑面缺根时按动作决定计划 create 还是报 `support-root-missing`。 */
async function planPublicationRoot(context, root) {
    const { request, authority, plan } = context;
    const rules = claudeCodePortableSettingsRulesFor(root);
    const retiredRules = claudeCodePortableSettingsRetiredRulesFor(root);
    const options = { rules, retiredRules, ...signalOptions(request.signal) };
    let placementStatus;
    let inspection;
    if (root.rootKind === "program") {
        placementStatus = "present";
        inspection = await inspectRootSettings(context.workspaceRoot, options);
    }
    else {
        const placement = supportPlacement(context.placements, root);
        if (placement.state === "missing") {
            if (!claudeCodeMaintenanceMaterializesMissingSupportRoot(request.action)) {
                plan.blockerCodes.add(`support-root-missing:${root.rootId}`);
                plan.rootEntries.push(rootEntry(root, "planned-missing", "blocked", null));
                return;
            }
            placementStatus = "planned-missing";
            inspection = {
                transition: planClaudeCodePortableSettingsTransition(null, rules, retiredRules),
            };
        }
        else {
            placementStatus = "present";
            inspection = await inspectPresentRoot(placement.absolutePath, options);
        }
    }
    if ("blockedReason" in inspection) {
        plan.blockerCodes.add(`settings-blocked:${root.rootKind}:${root.rootId}:${inspection.blockedReason}`);
        plan.rootEntries.push(rootEntry(root, placementStatus, "blocked", null));
        return;
    }
    const { transition } = inspection;
    if (transition.status === "blocked") {
        plan.blockerCodes.add(`settings-blocked:${root.rootKind}:${root.rootId}:${transition.reason}`);
    }
    else if (transition.status === "create" || transition.status === "update") {
        if (transition.desiredDigest === null)
            fail("inspection", "$transition");
        plan.operations.push(createClaudeCodePortableSettingsOperation(authority.authorityDigest, root, transition.status, transition.sourceDigest, transition.desiredDigest));
    }
    plan.rootEntries.push(rootEntry(root, placementStatus, transition.status, transition.reason));
}
/**
 * 退出路径（ADR-0024 `remove-portable-settings-rules`）的一个根：支撑面根不在即无可删（absent）；
 * 文件读不出、不是对象或不合写入策略即 `detach-settings-unreadable:<targetKey>`，不猜；有 Wakeflow
 * 当前或退役的条目即一条 remove；没有即 current，零写。
 */
async function planRemovalRoot(context, root) {
    const { request, authority, plan } = context;
    const options = {
        removedRules: claudeCodePortableSettingsRemovedRulesFor(root),
        ...signalOptions(request.signal),
    };
    let inspection;
    if (root.rootKind === "program") {
        inspection = await inspectRootSettings(context.workspaceRoot, options);
    }
    else {
        const placement = supportPlacement(context.placements, root);
        if (placement.state === "missing") {
            plan.rootEntries.push(rootEntry(root, "absent", "current", null));
            return;
        }
        inspection = await inspectPresentRoot(placement.absolutePath, options);
    }
    if ("blockedReason" in inspection || inspection.transition.status === "blocked") {
        plan.blockerCodes.add(`${CLAUDE_CODE_PORTABLE_SETTINGS_REMOVAL_BLOCKER}:${claudeCodePortableSettingsRemovalTargetKey(root)}`);
        const reason = "blockedReason" in inspection ? null : inspection.transition.reason;
        plan.rootEntries.push(rootEntry(root, "present", "blocked", reason));
        return;
    }
    const { transition } = inspection;
    if (transition.status === "update") {
        if (transition.sourceDigest === null || transition.desiredDigest === null) {
            fail("inspection", "$transition");
        }
        plan.operations.push(createClaudeCodePortableSettingsOperation(authority.authorityDigest, root, "remove", transition.sourceDigest, transition.desiredDigest));
    }
    else if (transition.status !== "current") {
        // 删除规划器从不产生 create：文件不存在就是 current。
        fail("inspection", "$transition");
    }
    plan.rootEntries.push(rootEntry(root, "present", transition.status, transition.reason));
}
function assemblePlan(action, authority, plan) {
    const sortedBlockers = Object.freeze([...plan.blockerCodes].sort());
    return Object.freeze({
        action,
        status: sortedBlockers.length === 0 ? "ready" : "blocked",
        authorityDigest: authority.authorityDigest,
        roots: Object.freeze([...plan.rootEntries]),
        operations: Object.freeze([...plan.operations]),
        blockerCodes: sortedBlockers,
    });
}
/**
 * 为 Program 与 Wakeflow-managed Support roots 生成零写入 portable settings 计划：写入动作计划规则的
 * 创建或最小更新，detach-workspace 计划 Wakeflow 条目的精确删除，detach-repository 计划为空（规则
 * 没有仓库维度，ADR-0024）。
 */
export async function planClaudeCodePortableSettingsComposition(workspaceRootValue, requestValue) {
    if (typeof workspaceRootValue !== "object" ||
        workspaceRootValue === null ||
        types.isProxy(workspaceRootValue) ||
        !(workspaceRootValue instanceof RootedDirectory)) {
        fail("input", "$workspaceRoot");
    }
    const request = parseRequest(requestValue);
    if (request.signal?.aborted === true)
        fail("aborted", "$signal");
    const authority = compileClaudeCodePortableSettingsRootAuthority(request.model);
    const plan = { rootEntries: [], operations: [], blockerCodes: new Set() };
    if (request.action === "detach-repository") {
        return assemblePlan(request.action, authority, plan);
    }
    const context = {
        workspaceRoot: workspaceRootValue,
        request,
        authority,
        placements: await rootPlacements(workspaceRootValue, request.model),
        plan,
    };
    const planRoot = isWakeflowDetachAction(request.action) ? planRemovalRoot : planPublicationRoot;
    for (const root of authority.roots) {
        await planRoot(context, root);
    }
    return assemblePlan(request.action, authority, plan);
}
