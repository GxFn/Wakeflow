import { types } from "node:util";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { computeSha256Digest, parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { JsonValueError, parseJsonValue } from "../../foundation/data/json-value.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
import { DurableDirectoryMaterializationError, materializeDirectoryPath, } from "../../foundation/filesystem/durable-directory-materialization.js";
import { createFileAtomically, DurableAtomicFileWriteError, replaceFileAtomically, } from "../../foundation/filesystem/durable-atomic-file-write.js";
import { parsePortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { readStableFile, StableFileReadError, } from "../../foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { decodeUtf8, encodeUtf8 } from "../../foundation/text/utf8.js";
import { CLAUDE_CODE_SETTINGS_DIRECTORY_REF } from "./claude-code-portable-settings-publication.js";
import { claudeCodeStatuslineCommand } from "./claude-code-statusline-asset.js";
import { claudeCodeWorkspaceHostResourceProfile } from "./wakeflow-workspace-host-resource-profile.js";
/**
 * Wakeflow Host / Claude Code：状态栏命令写进本地设置的维护操作（gate-log §13.94 D6）。
 *
 * 目标是 `.claude/settings.local.json` 的 `statusLine` 一个键：命令里带 base64url 的工作区绝对根，
 * 所以只能进忽略的私有本地文件，不能进可提交的 `settings.json`。计划只读：键已是期望值且文件
 * 0600 即无操作；缺失、漂移或模式不对即一条 `statusline-settings` 操作，目标摘要是"现有文档
 * 只改这一键"重新渲染后的字节。文件读不出或不是 JSON 对象时不猜：计划报 `settings-unreadable`，
 * 宿主贡献把它变成 blocker。执行是单文件 CAS：缺失创建，存在替换，保留其他键与顺序，0600。
 * 负载不含根：命令在执行时从根重新派生，目标摘要绑定最终字节。
 */
export const CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_KIND = "statusline-settings";
export const CLAUDE_CODE_STATUSLINE_SETTINGS_OWNER_ID = "claude-code-statusline-settings";
/** 排在资产安装之后：先装资产，再让 settings 指向它。 */
export const CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_ID = "claude-statusline-settings:install";
export const CLAUDE_CODE_STATUSLINE_SETTINGS_KEY = "statusLine";
export const CLAUDE_CODE_LOCAL_SETTINGS_REF = parsePortableResourcePath(claudeCodeWorkspaceHostResourceProfile.surfaces.settingsIntegration?.localPath
    ?? ".claude/settings.local.json", "$settings");
/** 计划失败时宿主贡献报出的 blocker。 */
export const CLAUDE_CODE_STATUSLINE_SETTINGS_BLOCKER = "claude-settings-local-unreadable";
const TARGET_KEY = "settings:claude-code:local-statusline";
const SETTINGS_MAXIMUM_BYTES = parseByteCount(1024 * 1024, "$settings.maximumBytes");
const SETTINGS_MODE = 0o600;
const DIRECTORY_MODE = 0o755;
const ERROR_MESSAGES = {
    input: "Claude statusline settings operation input is invalid.",
    operation: "Claude statusline settings operation payload is invalid.",
    "settings-unreadable": "Claude local settings could not be read as a JSON object.",
    "source-stale": "Claude local settings changed since the plan was made.",
    write: "Claude local settings could not be written safely.",
    aborted: "Claude statusline settings operation was aborted.",
};
/** 状态栏设置操作失败的稳定、脱敏错误。 */
export class ClaudeCodeStatuslineSettingsOperationError extends Error {
    name = "ClaudeCodeStatuslineSettingsOperationError";
    code = "wakeflow-claude-code-statusline-settings-operation";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new ClaudeCodeStatuslineSettingsOperationError(reason, path);
}
function signalOptions(signal) {
    return signal === undefined ? {} : { signal };
}
function assertRoot(root) {
    if (typeof root !== "object"
        || root === null
        || types.isProxy(root)
        || !(root instanceof RootedDirectory)) {
        fail("input", "$root");
    }
}
/** Claude Code 期望的 `statusLine` 值：命令行带资产路径、标记与 base64url 的工作区根。 */
export function claudeCodeStatuslineSettingsEntry(workspaceRoot) {
    return parseJsonValue({ type: "command", command: claudeCodeStatuslineCommand(workspaceRoot) }, "$statusLine");
}
function parseSettingsDocument(bytes) {
    let decoded;
    try {
        decoded = JSON.parse(decodeUtf8(bytes, "$settings"));
    }
    catch {
        fail("settings-unreadable", "$settings");
    }
    try {
        const record = parsePlainRecord(decoded, "$settings");
        const document = {};
        for (const [key, value] of Object.entries(record)) {
            document[key] = parseJsonValue(value, `$settings/${key}`);
        }
        return Object.freeze(document);
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError || error instanceof JsonValueError) {
            fail("settings-unreadable", "$settings");
        }
        throw error;
    }
}
/** 当前本地设置：缺失为 null；读不出或不是 JSON 对象即 `settings-unreadable`。 */
async function currentSettings(root, signal) {
    let read;
    try {
        read = await readStableFile(root, CLAUDE_CODE_LOCAL_SETTINGS_REF, {
            maximumBytes: SETTINGS_MAXIMUM_BYTES,
            ...signalOptions(signal),
        });
    }
    catch (error) {
        if (error instanceof StableFileReadError) {
            if (error.reason === "not-found")
                return null;
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("settings-unreadable", "$settings");
        }
        throw error;
    }
    return Object.freeze({
        source: Object.freeze({
            resourcePath: read.resourcePath,
            node: read.node,
            byteCount: read.byteCount,
            digest: read.digest,
        }),
        document: parseSettingsDocument(read.bytes),
    });
}
/** 只改 `statusLine` 一键：已有键原位替换，否则追加在末尾；其他键与顺序原样保留。 */
function renderTarget(document, entry) {
    const next = {};
    let replaced = false;
    for (const [key, value] of Object.entries(document)) {
        if (key === CLAUDE_CODE_STATUSLINE_SETTINGS_KEY) {
            next[key] = entry;
            replaced = true;
        }
        else {
            next[key] = value;
        }
    }
    if (!replaced)
        next[CLAUDE_CODE_STATUSLINE_SETTINGS_KEY] = entry;
    return encodeUtf8(`${JSON.stringify(next, null, 2)}\n`, "$settings");
}
function entryCurrent(current, entry) {
    if (current === null)
        return false;
    const existing = current.document[CLAUDE_CODE_STATUSLINE_SETTINGS_KEY];
    return (existing !== undefined
        && computeCanonicalJsonSha256Digest(existing) === computeCanonicalJsonSha256Digest(entry)
        && current.source.node.permissionBits === SETTINGS_MODE);
}
/** 零写计划：键已是期望值且 0600 即 null，否则一条操作；文件读不出即抛 `settings-unreadable`。 */
export async function planClaudeCodeStatuslineSettingsOperation(root, options = {}) {
    assertRoot(root);
    const current = await currentSettings(root, options.signal);
    const entry = claudeCodeStatuslineSettingsEntry(root.absolutePath);
    if (entryCurrent(current, entry))
        return null;
    const target = renderTarget(current?.document ?? {}, entry);
    return Object.freeze({
        operationId: CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_ID,
        operationKind: CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_KIND,
        ownerId: CLAUDE_CODE_STATUSLINE_SETTINGS_OWNER_ID,
        targetKey: TARGET_KEY,
        sourceDigest: current?.source.digest ?? null,
        targetDigest: computeSha256Digest(target),
        payload: {
            path: CLAUDE_CODE_LOCAL_SETTINGS_REF,
            key: CLAUDE_CODE_STATUSLINE_SETTINGS_KEY,
        },
    });
}
function parsePayload(value) {
    let record;
    try {
        record = parsePlainRecord(value, "$operation");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("operation", error.path);
        throw error;
    }
    if (Object.keys(record).sort().join(" ") !== "key path"
        || record.path !== CLAUDE_CODE_LOCAL_SETTINGS_REF
        || record.key !== CLAUDE_CODE_STATUSLINE_SETTINGS_KEY) {
        fail("operation", "$operation");
    }
    return Object.freeze({
        path: CLAUDE_CODE_LOCAL_SETTINGS_REF,
        key: CLAUDE_CODE_STATUSLINE_SETTINGS_KEY,
    });
}
function parseDigests(request) {
    try {
        return {
            sourceDigest: request.sourceDigest === null
                ? null
                : parseSha256Digest(request.sourceDigest, "$operation.sourceDigest"),
            targetDigest: parseSha256Digest(request.targetDigest, "$operation.targetDigest"),
        };
    }
    catch (error) {
        if (error instanceof Sha256Error)
            fail("operation", error.path);
        throw error;
    }
}
async function ensureSettingsDirectory(root, signal) {
    try {
        await materializeDirectoryPath(root, CLAUDE_CODE_SETTINGS_DIRECTORY_REF, {
            mode: DIRECTORY_MODE,
            ...signalOptions(signal),
        });
    }
    catch (error) {
        if (error instanceof DurableDirectoryMaterializationError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("write", "$settings.directory");
        }
        throw error;
    }
}
async function writeTarget(root, current, bytes, signal) {
    try {
        if (current === null) {
            await ensureSettingsDirectory(root, signal);
            await createFileAtomically(root, CLAUDE_CODE_LOCAL_SETTINGS_REF, bytes, {
                mode: SETTINGS_MODE,
                ...signalOptions(signal),
            });
            return "created";
        }
        await replaceFileAtomically(root, CLAUDE_CODE_LOCAL_SETTINGS_REF, bytes, {
            mode: SETTINGS_MODE,
            expected: current.source,
            ...signalOptions(signal),
        });
        return "updated";
    }
    catch (error) {
        if (error instanceof DurableAtomicFileWriteError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "expectation-changed" || error.reason === "target-exists") {
                fail("source-stale", "$settings");
            }
            fail("write", "$settings");
        }
        throw error;
    }
}
/**
 * 执行：文件已是目标字节且 0600 即 current；否则来源摘要必须等于计划时的（affected 恢复放开
 * 这一条），从当前文档重新渲染并要求得到计划的目标摘要，再 CAS 写入。
 */
export async function executeClaudeCodeStatuslineSettingsOperation(root, request) {
    assertRoot(root);
    parsePayload(request.operation);
    const digests = parseDigests(request);
    const current = await currentSettings(root, request.signal);
    if (current !== null
        && current.source.digest === digests.targetDigest
        && current.source.node.permissionBits === SETTINGS_MODE) {
        return Object.freeze({
            operationId: CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_ID,
            disposition: "current",
            targetDigest: digests.targetDigest,
        });
    }
    if (!request.recoveringAffectedOperation
        && (current?.source.digest ?? null) !== digests.sourceDigest) {
        fail("source-stale", "$settings");
    }
    const bytes = renderTarget(current?.document ?? {}, claudeCodeStatuslineSettingsEntry(root.absolutePath));
    if (computeSha256Digest(bytes) !== digests.targetDigest)
        fail("source-stale", "$settings");
    const disposition = await writeTarget(root, current, bytes, request.signal);
    return Object.freeze({
        operationId: CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_ID,
        disposition,
        targetDigest: digests.targetDigest,
    });
}
