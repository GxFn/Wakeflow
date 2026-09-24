import { types } from "node:util";
import { PassiveOwnDataError, parsePlainRecord, } from "../../foundation/data/passive-own-data.js";
import { DurableAtomicFileStageRecoveryError, recoverDurableAtomicFileStagesForTargets, } from "../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import { createFileAtomically, DurableAtomicFileWriteError, replaceFileAtomically, } from "../../foundation/filesystem/durable-atomic-file-write.js";
import { createDirectoryAtomically, DurableDirectoryMaterializationError, } from "../../foundation/filesystem/durable-directory-materialization.js";
import { parsePortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { readStableFile, StableFileReadError, } from "../../foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { decodeUtf8, encodeUtf8, Utf8Error, } from "../../foundation/text/utf8.js";
import { planClaudeCodePortableSettingsTransition, } from "./claude-code-portable-settings-transition.js";
/**
 * Wakeflow Host / Claude Code：单个已授权根的 portable settings CAS owner。
 *
 * 本 owner 只创建或精确替换 `.claude/settings.json`，写入内容完全来自 portable
 * transition。它不处理 local settings、statusline、Git ignore、Repository 授权或多根
 * transaction；这些仍由上层 maintenance participant 排序和授权。
 */
export const CLAUDE_CODE_SETTINGS_DIRECTORY_REF = parsePortableResourcePath(".claude");
export const CLAUDE_CODE_PORTABLE_SETTINGS_REF = parsePortableResourcePath(".claude/settings.json");
const ERROR_MESSAGES = {
    input: "Claude Code portable settings publication input is invalid.",
    "directory-policy": "Claude Code settings directory violates its node policy.",
    "source-policy": "Claude Code portable settings source violates its node policy.",
    "transition-blocked": "Claude Code portable settings transition is blocked.",
    "source-changed": "Claude Code portable settings source changed before publication.",
    "root-scope": "Claude Code portable settings publication lost root scope.",
    aborted: "Claude Code portable settings publication was aborted.",
    "recovery-required": "Claude Code portable settings publication requires recovery.",
    "operation-failure": "Claude Code portable settings publication failed.",
};
/** Claude Code portable settings 发布失败的稳定、脱敏错误。 */
export class ClaudeCodePortableSettingsPublicationError extends Error {
    name = "ClaudeCodePortableSettingsPublicationError";
    code = "wakeflow-claude-code-portable-settings-publication";
    reason;
    path;
    transitionReason;
    constructor(reason, path, transitionReason = null) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
        this.transitionReason = transitionReason;
    }
}
const MAXIMUM_SETTINGS_BYTES = parseByteCount(1024 * 1024);
function fail(reason, path, transitionReason = null) {
    throw new ClaudeCodePortableSettingsPublicationError(reason, path, transitionReason);
}
function parseOptions(value) {
    let record;
    try {
        record = parsePlainRecord(value === undefined ? {} : value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$options");
        throw error;
    }
    if (Object.keys(record).some((key) => key !== "signal" && key !== "rules")
        || (record.signal !== undefined
            && (typeof record.signal !== "object"
                || record.signal === null
                || types.isProxy(record.signal)
                || !(record.signal instanceof AbortSignal)))
        || (record.rules !== undefined
            && (!Array.isArray(record.rules)
                || record.rules.some((entry) => typeof entry !== "string")))) {
        fail("input", "$options");
    }
    return Object.freeze({
        signal: record.signal,
        rules: record.rules === undefined
            ? undefined
            : Object.freeze([...record.rules]),
    });
}
function currentUserId() {
    return typeof process.geteuid === "function"
        ? BigInt(process.geteuid())
        : null;
}
function assertDirectoryNode(node) {
    if (node.kind !== "directory"
        || (node.permissionBits !== 0o700 && node.permissionBits !== 0o755)
        || (currentUserId() !== null && node.userId !== currentUserId())) {
        fail("directory-policy", "$settingsDirectory");
    }
}
function assertSourceNode(node) {
    if (node.kind !== "file"
        || node.permissionBits !== 0o644
        || node.linkCount !== 1n
        || (currentUserId() !== null && node.userId !== currentUserId())) {
        fail("source-policy", "$settings");
    }
}
async function directoryNodeOrNull(root) {
    try {
        const resource = await root.inspectExistingResource(CLAUDE_CODE_SETTINGS_DIRECTORY_REF);
        assertDirectoryNode(resource.node);
        return resource.node;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError
            && error.reason === "resource-not-found")
            return null;
        if (error instanceof ClaudeCodePortableSettingsPublicationError)
            throw error;
        if (error instanceof RootedDirectoryError)
            fail("root-scope", "$root");
        throw error;
    }
}
async function sourceOrNull(root, signal) {
    let resource;
    try {
        resource = await root.inspectExistingResource(CLAUDE_CODE_PORTABLE_SETTINGS_REF);
    }
    catch (error) {
        if (error instanceof RootedDirectoryError
            && error.reason === "resource-not-found")
            return null;
        if (error instanceof RootedDirectoryError)
            fail("root-scope", "$root");
        throw error;
    }
    assertSourceNode(resource.node);
    try {
        return await readStableFile(root, CLAUDE_CODE_PORTABLE_SETTINGS_REF, {
            maximumBytes: MAXIMUM_SETTINGS_BYTES,
            expectedNode: resource.node,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof StableFileReadError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "root-scope")
                fail("root-scope", "$root");
            if (error.reason === "expectation-changed"
                || error.reason === "source-changed"
                || error.reason === "not-found") {
                fail("source-changed", "$settings");
            }
            fail("source-policy", "$settings");
        }
        throw error;
    }
}
async function inspectSource(root, signal, rules) {
    const directoryNode = await directoryNodeOrNull(root);
    const source = directoryNode === null
        ? null
        : await sourceOrNull(root, signal);
    let sourceText = null;
    if (source !== null) {
        try {
            sourceText = decodeUtf8(source.bytes, "$settings");
        }
        catch (error) {
            if (error instanceof Utf8Error)
                fail("source-policy", "$settings");
            throw error;
        }
    }
    const transition = planClaudeCodePortableSettingsTransition(sourceText, rules);
    return Object.freeze({ directoryNode, source, sourceText, transition });
}
/** 只读检查一个已授权根的 portable settings，不返回用户源文本或节点身份。 */
export async function inspectClaudeCodePortableSettings(rootValue, optionsValue = {}) {
    if (typeof rootValue !== "object"
        || rootValue === null
        || types.isProxy(rootValue)
        || !(rootValue instanceof RootedDirectory)) {
        fail("input", "$root");
    }
    const options = parseOptions(optionsValue);
    if (options.signal?.aborted === true)
        fail("aborted", "$signal");
    const inspection = await inspectSource(rootValue, options.signal, options.rules);
    return Object.freeze({
        kind: "ClaudeCodePortableSettingsInspection",
        directoryStatus: inspection.directoryNode === null ? "absent" : "present",
        sourceDigest: inspection.source?.digest ?? null,
        transition: inspection.transition,
    });
}
async function ensureSettingsDirectory(root, inspection, signal) {
    if (inspection.directoryNode !== null)
        return;
    try {
        const created = await createDirectoryAtomically(root, CLAUDE_CODE_SETTINGS_DIRECTORY_REF, {
            mode: 0o755,
            ...(signal === undefined ? {} : { signal }),
        });
        assertDirectoryNode(created.node);
    }
    catch (error) {
        if (error instanceof ClaudeCodePortableSettingsPublicationError)
            throw error;
        if (error instanceof DurableDirectoryMaterializationError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("operation-failure", "$settingsDirectory");
        }
        throw error;
    }
}
function assertTransitionReady(transition) {
    if ((transition.status !== "create" && transition.status !== "update")
        || transition.desiredText === null
        || transition.desiredDigest === null) {
        fail("transition-blocked", "$transition", transition.reason);
    }
}
async function publishTransition(root, inspection, signal) {
    const { transition } = inspection;
    assertTransitionReady(transition);
    const bytes = encodeUtf8(transition.desiredText, "$settings");
    try {
        if (transition.status === "create") {
            if (inspection.source !== null)
                fail("source-changed", "$settings");
            await createFileAtomically(root, CLAUDE_CODE_PORTABLE_SETTINGS_REF, bytes, {
                mode: 0o644,
                ...(signal === undefined ? {} : { signal }),
            });
            return;
        }
        if (inspection.source === null)
            fail("source-changed", "$settings");
        await replaceFileAtomically(root, CLAUDE_CODE_PORTABLE_SETTINGS_REF, bytes, {
            mode: 0o644,
            expected: Object.freeze({
                resourcePath: inspection.source.resourcePath,
                node: inspection.source.node,
                byteCount: inspection.source.byteCount,
                digest: inspection.source.digest,
            }),
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof ClaudeCodePortableSettingsPublicationError)
            throw error;
        if (error instanceof DurableAtomicFileWriteError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "target-exists"
                || error.reason === "expectation-changed"
                || error.reason === "expectation-read-failure") {
                fail("source-changed", "$settings");
            }
            if (error.reason === "stage-recovery-required") {
                fail("recovery-required", "$settingsStage");
            }
            fail("operation-failure", "$settings");
        }
        throw error;
    }
}
/** 创建、最小更新或幂等复用一个已授权根的 portable settings。 */
export async function publishClaudeCodePortableSettings(rootValue, optionsValue = {}) {
    if (typeof rootValue !== "object"
        || rootValue === null
        || types.isProxy(rootValue)
        || !(rootValue instanceof RootedDirectory)) {
        fail("input", "$root");
    }
    const options = parseOptions(optionsValue);
    if (options.signal?.aborted === true)
        fail("aborted", "$signal");
    const before = await inspectSource(rootValue, options.signal, options.rules);
    if (before.transition.status === "blocked") {
        fail("transition-blocked", "$transition", before.transition.reason);
    }
    if (before.transition.status === "current") {
        if (before.transition.desiredDigest === null) {
            fail("operation-failure", "$transition");
        }
        return Object.freeze({
            disposition: "current",
            sourceDigest: before.source?.digest ?? null,
            targetDigest: before.transition.desiredDigest,
            transition: before.transition,
        });
    }
    await ensureSettingsDirectory(rootValue, before, options.signal);
    if (before.directoryNode === null) {
        const afterDirectory = await inspectSource(rootValue, options.signal, options.rules);
        if (afterDirectory.source !== null
            || afterDirectory.transition.status !== "create") {
            fail("source-changed", "$settings");
        }
    }
    await publishTransition(rootValue, before, options.signal);
    const after = await inspectSource(rootValue, options.signal, options.rules);
    if (after.transition.status !== "current"
        || before.transition.desiredDigest === null
        || after.source?.digest !== before.transition.desiredDigest) {
        fail("operation-failure", "$readback");
    }
    return Object.freeze({
        disposition: before.transition.status === "create" ? "created" : "updated",
        sourceDigest: before.source?.digest ?? null,
        targetDigest: before.transition.desiredDigest,
        transition: before.transition,
    });
}
/** 只结算目标同父目录内属于 portable settings 的 inactive Foundation stage。 */
export async function settleClaudeCodePortableSettingsPublicationStages(rootValue, optionsValue = {}) {
    if (typeof rootValue !== "object"
        || rootValue === null
        || types.isProxy(rootValue)
        || !(rootValue instanceof RootedDirectory)) {
        fail("input", "$root");
    }
    const options = parseOptions(optionsValue);
    const directory = await directoryNodeOrNull(rootValue);
    if (directory !== null) {
        try {
            const recovery = await recoverDurableAtomicFileStagesForTargets(rootValue, [CLAUDE_CODE_PORTABLE_SETTINGS_REF], options.signal === undefined ? undefined : { signal: options.signal });
            if (recovery.activeStageCount !== 0 || recovery.unknownStageCount !== 0) {
                fail("recovery-required", "$settingsStage");
            }
        }
        catch (error) {
            if (error instanceof ClaudeCodePortableSettingsPublicationError)
                throw error;
            if (error instanceof DurableAtomicFileStageRecoveryError) {
                if (error.reason === "aborted")
                    fail("aborted", "$signal");
                if (error.reason === "root-scope")
                    fail("root-scope", "$root");
                fail("recovery-required", "$settingsStage");
            }
            throw error;
        }
    }
}
/** 显式结算 stage 后幂等恢复 portable settings 发布。 */
export async function recoverClaudeCodePortableSettingsPublication(rootValue, optionsValue = {}) {
    await settleClaudeCodePortableSettingsPublicationStages(rootValue, optionsValue);
    return publishClaudeCodePortableSettings(rootValue, optionsValue);
}
