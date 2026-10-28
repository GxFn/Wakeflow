import { types } from "node:util";
import { parseWakeflowConfig, parseWakeflowConfigPlacement, WakeflowConfigError, } from "../../configuration/wakeflow-config.js";
import { validateWakeflowConfigRootPlacements, WakeflowConfigRootPlacementError, } from "../../configuration/wakeflow-config-root-placement.js";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { computeSha256Digest, parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { JsonValueError, parseJsonValue, } from "../../foundation/data/json-value.js";
import { PassiveOwnDataError, parsePlainRecord } from "../../foundation/data/passive-own-data.js";
import { createFileAtomically, DurableAtomicFileWriteError, replaceFileAtomically, } from "../../foundation/filesystem/durable-atomic-file-write.js";
import { DurableDirectoryMaterializationError, materializeDirectoryPath, } from "../../foundation/filesystem/durable-directory-materialization.js";
import { parsePortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { readStableFile, StableFileReadError, } from "../../foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { decodeUtf8, encodeUtf8 } from "../../foundation/text/utf8.js";
import { isWakeflowDetachAction, } from "../../workspace/maintenance/wakeflow-static-materialization-preview-contract.js";
import { claudeCodeMaintenanceMaterializesMissingSupportRoot } from "./claude-code-portable-settings-composition.js";
import { CLAUDE_CODE_SETTINGS_DIRECTORY_REF } from "./claude-code-portable-settings-publication.js";
import { CLAUDE_CODE_STATUSLINE_MARKER, claudeCodeStatuslineCommand, } from "./claude-code-statusline-asset.js";
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
 *
 * 复审 M2（1.1.1 批 1）：Design、Test 窗口在自己的支撑面目录里启动，Claude Code 只读那个 cwd 的
 * `.claude/settings.local.json`，所以每个 wakeflow-managed 支撑面也各写一份同一条目（命令里仍是
 * 工作区根）。支撑面操作的负载多一个 `surface`（surfaceId 与配置里的放置），执行时对照配置核对并
 * 以该面的根为写入根；支撑面根的 `.gitignore` 托管块本来就忽略这个文件。
 *
 * 退出路径（ADR-0024 `remove-statusline-entry`）：对同一组根只删所有权判定为 Wakeflow 的那一条
 * `statusLine`，用户自己的不碰，没有即 current；其他键、顺序与文件本身原样保留。删除负载与安装负载
 * 同形再加 `effect: "remove"`，两边的 executor 互不接受对方的负载。
 */
export const CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_KIND = "statusline-settings";
export const CLAUDE_CODE_STATUSLINE_SETTINGS_OWNER_ID = "claude-code-statusline-settings";
/** 排在资产安装之后：先装资产，再让 settings 指向它。 */
export const CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_ID = "claude-statusline-settings:install";
export const CLAUDE_CODE_STATUSLINE_SETTINGS_KEY = "statusLine";
/** 0.9.x 发布的状态行资产文件名：带它的命令仍是 Wakeflow 的，升级时替换而不是当成用户的。 */
const LEGACY_STATUSLINE_FILE = "wakeflow-statusline.mjs";
export const CLAUDE_CODE_LOCAL_SETTINGS_REF = parsePortableResourcePath(claudeCodeWorkspaceHostResourceProfile.surfaces.settingsIntegration?.localPath ??
    ".claude/settings.local.json", "$settings");
/** 计划失败时宿主贡献报出的 blocker。 */
export const CLAUDE_CODE_STATUSLINE_SETTINGS_BLOCKER = "claude-settings-local-unreadable";
const TARGET_KEY = "settings:claude-code:local-statusline";
const SURFACE_SUFFIX = "support-surface";
/** wakeflow-managed 支撑面的本地设置操作标识（复审 M2）；程序根仍用无后缀的标识。 */
export function claudeCodeStatuslineSettingsSurfaceOperationId(surfaceId) {
    return `${CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_ID}:${SURFACE_SUFFIX}:${surfaceId}`;
}
/** 支撑面读不出本地设置时宿主贡献报出的 blocker（与程序根的区分开，边界内不得重复）。 */
export function claudeCodeStatuslineSettingsSurfaceBlocker(surfaceId) {
    return `${CLAUDE_CODE_STATUSLINE_SETTINGS_BLOCKER}:${SURFACE_SUFFIX}:${surfaceId}`;
}
/** 退出路径的宿主步种类（ADR-0024）：与共享步骤表里的名字逐字相同，宿主贡献用它做 operationKind。 */
export const CLAUDE_CODE_STATUSLINE_REMOVAL_OPERATION_KIND = "remove-statusline-entry";
export const CLAUDE_CODE_STATUSLINE_REMOVAL_OPERATION_ID = "claude-statusline-settings:remove";
const REMOVAL_TARGET_KEY = "statusline";
const REMOVAL_EFFECT = "remove";
/** 退出路径里支撑面那一条的操作标识；程序根仍用无后缀的标识。 */
export function claudeCodeStatuslineSettingsRemovalOperationId(surfaceId) {
    return `${CLAUDE_CODE_STATUSLINE_REMOVAL_OPERATION_ID}:${SURFACE_SUFFIX}:${surfaceId}`;
}
/** 退出路径宿主步的 targetKey（ADR-0024）：程序根 `statusline`，托管支撑面 `statusline:support:<surfaceId>`。 */
export function claudeCodeStatuslineRemovalTargetKey(surface) {
    return surface === null
        ? REMOVAL_TARGET_KEY
        : `${REMOVAL_TARGET_KEY}:support:${surface.surfaceId}`;
}
const SETTINGS_MAXIMUM_BYTES = parseByteCount(1024 * 1024, "$settings.maximumBytes");
const SETTINGS_MODE = 0o600;
const DIRECTORY_MODE = 0o755;
const ERROR_MESSAGES = {
    input: "Claude statusline settings operation input is invalid.",
    operation: "Claude statusline settings operation payload is invalid.",
    "settings-unreadable": "Claude local settings could not be read as a JSON object.",
    "source-stale": "Claude local settings changed since the plan was made.",
    write: "Claude local settings could not be written safely.",
    placement: "Claude support surface root could not be resolved.",
    "root-open": "Claude support surface root could not be opened.",
    "close-failure": "Claude support surface root could not be closed.",
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
    if (typeof root !== "object" ||
        root === null ||
        types.isProxy(root) ||
        !(root instanceof RootedDirectory)) {
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
    return (existing !== undefined &&
        computeCanonicalJsonSha256Digest(existing) === computeCanonicalJsonSha256Digest(entry) &&
        current.source.node.permissionBits === SETTINGS_MODE);
}
/**
 * Wakeflow 自己的状态行条目（复审 T31/M1，旧版的 `custom/unmanaged` 判定）：命令里带现行标记 `--wakeflow-statusline-v1`
 * 或 0.9.x 的 `wakeflow-statusline.mjs` 才是 Wakeflow 的；其他 `statusLine` 是用户自己的，维护不覆盖，观察侧报 `custom`。
 */
export function claudeCodeStatuslineEntryIsWakeflows(entry) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry))
        return false;
    const command = entry.command;
    if (typeof command !== "string")
        return false;
    return (command.includes(CLAUDE_CODE_STATUSLINE_MARKER) || command.includes(LEGACY_STATUSLINE_FILE));
}
/**
 * 零写计划：键已是期望值且 0600 即 null，用户自己的 `statusLine` 也是 null（不碰用户的配置），否则一条操作；
 * 文件读不出即抛 `settings-unreadable`。
 */
export async function planClaudeCodeStatuslineSettingsOperation(root, options = {}) {
    assertRoot(root);
    const current = await currentSettings(root, options.signal);
    return planFromCurrent(current, claudeCodeStatuslineSettingsEntry(root.absolutePath), null);
}
function operationIdFor(surface) {
    return surface === null
        ? CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_ID
        : claudeCodeStatuslineSettingsSurfaceOperationId(surface.surfaceId);
}
function payloadFor(surface) {
    const base = {
        path: CLAUDE_CODE_LOCAL_SETTINGS_REF,
        key: CLAUDE_CODE_STATUSLINE_SETTINGS_KEY,
    };
    return Object.freeze(surface === null
        ? base
        : {
            ...base,
            surface: Object.freeze({
                surfaceId: surface.surfaceId,
                configuredPlacement: surface.configuredPlacement,
            }),
        });
}
/** 同一条零写规则对程序根与每个支撑面各算一次；条目永远由工作区根派生。 */
function planFromCurrent(current, entry, surface) {
    if (entryCurrent(current, entry))
        return null;
    const existing = current?.document[CLAUDE_CODE_STATUSLINE_SETTINGS_KEY];
    if (existing !== undefined && !claudeCodeStatuslineEntryIsWakeflows(existing))
        return null;
    const target = renderTarget(current?.document ?? {}, entry);
    return Object.freeze({
        operationId: operationIdFor(surface),
        operationKind: CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_KIND,
        ownerId: CLAUDE_CODE_STATUSLINE_SETTINGS_OWNER_ID,
        targetKey: surface === null ? TARGET_KEY : `${TARGET_KEY}:${SURFACE_SUFFIX}:${surface.surfaceId}`,
        sourceDigest: current?.source.digest ?? null,
        targetDigest: computeSha256Digest(target),
        payload: payloadFor(surface),
    });
}
function parseModel(value) {
    try {
        return parseWakeflowConfig(value);
    }
    catch (error) {
        if (error instanceof WakeflowConfigError)
            fail("input", "$config");
        throw error;
    }
}
/** 配置里 wakeflow-managed 的支撑面，按 surfaceId 排序（与 portable settings 的根权威同序）。 */
function managedSurfaces(model) {
    return Object.freeze([...model.topology.supportSurfaces]
        .filter((surface) => surface.ownership === "wakeflow-managed")
        .sort((left, right) => left.surfaceId < right.surfaceId ? -1 : left.surfaceId > right.surfaceId ? 1 : 0)
        .map((surface) => Object.freeze({ surfaceId: surface.surfaceId, configuredPlacement: surface.path })));
}
/** 支撑面根的实际位置：缺失即 missing（fresh-initialize 与 reconcile 会先建它），别的准入失败即 `placement`。 */
async function surfacePlacement(workspaceRoot, model, surface) {
    let placements;
    try {
        placements = await validateWakeflowConfigRootPlacements(workspaceRoot, model);
    }
    catch (error) {
        if (error instanceof WakeflowConfigRootPlacementError)
            fail("placement", error.path);
        throw error;
    }
    const placement = placements.roots.find((entry) => entry.key === `support.${surface.surfaceId}.root`);
    if (placement === undefined)
        fail("placement", "$supportRoot");
    return Object.freeze({
        state: placement.state === "present" ? "present" : "missing",
        absolutePath: placement.absolutePath,
    });
}
/** 打开支撑面根跑一段，无论成败都关掉；关不上报 `close-failure`。 */
async function withSurfaceRoot(absolutePath, run) {
    let surfaceRoot;
    try {
        surfaceRoot = await RootedDirectory.open(absolutePath, "$supportRoot");
    }
    catch (error) {
        if (error instanceof RootedDirectoryError)
            fail("root-open", "$supportRoot");
        throw error;
    }
    let result;
    let primaryError;
    try {
        result = { value: await run(surfaceRoot) };
    }
    catch (error) {
        primaryError = error;
    }
    let closeError;
    try {
        await surfaceRoot.close();
    }
    catch (error) {
        closeError = error;
    }
    if (result === undefined)
        throw primaryError;
    if (closeError !== undefined)
        fail("close-failure", "$supportRoot");
    return result.value;
}
/** 一个支撑面：面根不在时 fresh-initialize 与 reconcile 当作缺文件（维护先重建根），reconfigure 不计划；读不出即带 surfaceId 的 blocker。 */
async function planSurface(workspaceRoot, model, surface, action, entry, signal) {
    const placement = await surfacePlacement(workspaceRoot, model, surface);
    if (placement.state === "missing") {
        return {
            operation: claudeCodeMaintenanceMaterializesMissingSupportRoot(action)
                ? planFromCurrent(null, entry, surface)
                : null,
        };
    }
    try {
        const current = await withSurfaceRoot(placement.absolutePath, (surfaceRoot) => currentSettings(surfaceRoot, signal));
        return { operation: planFromCurrent(current, entry, surface) };
    }
    catch (error) {
        if (error instanceof ClaudeCodeStatuslineSettingsOperationError &&
            error.reason === "settings-unreadable") {
            return { blockerCode: claudeCodeStatuslineSettingsSurfaceBlocker(surface.surfaceId) };
        }
        throw error;
    }
}
/**
 * 每个 wakeflow-managed 支撑面一条零写计划（复审 M2）：面根在就按它的本地设置算；面根不在时
 * fresh-initialize 与 reconcile 当作缺文件（维护的共享步先重建根，宿主操作依赖它；open-items W5），
 * reconfigure 跳过（portable settings 的组合已报 `support-root-missing`）；文件读不出不抛，记一条带
 * surfaceId 的 blocker。
 */
export async function planClaudeCodeStatuslineSettingsSurfaceOperations(workspaceRoot, options) {
    assertRoot(workspaceRoot);
    const model = parseModel(options.config);
    if (options.signal?.aborted === true)
        fail("aborted", "$signal");
    const entry = claudeCodeStatuslineSettingsEntry(workspaceRoot.absolutePath);
    const operations = [];
    const blockerCodes = [];
    for (const surface of managedSurfaces(model)) {
        const planned = await planSurface(workspaceRoot, model, surface, options.action, entry, options.signal);
        if ("blockerCode" in planned) {
            blockerCodes.push(planned.blockerCode);
        }
        else if (planned.operation !== null) {
            operations.push(planned.operation);
        }
    }
    return Object.freeze({
        operations: Object.freeze(operations),
        blockerCodes: Object.freeze(blockerCodes),
    });
}
function removalOperationIdFor(surface) {
    return surface === null
        ? CLAUDE_CODE_STATUSLINE_REMOVAL_OPERATION_ID
        : claudeCodeStatuslineSettingsRemovalOperationId(surface.surfaceId);
}
function removalPayloadFor(surface) {
    return Object.freeze({ ...payloadFor(surface), effect: REMOVAL_EFFECT });
}
/** 只删 `statusLine` 一键；其他键与顺序原样保留，文件不删（删空也留 `{}`）。 */
function renderWithoutEntry(document) {
    const next = {};
    for (const [key, value] of Object.entries(document)) {
        if (key !== CLAUDE_CODE_STATUSLINE_SETTINGS_KEY)
            next[key] = value;
    }
    return encodeUtf8(`${JSON.stringify(next, null, 2)}\n`, "$settings");
}
/** 退出路径的零写计划：有 Wakeflow 自己的 `statusLine` 才一条操作；没有文件、没有键或键是用户的都为 null。 */
function planRemovalFromCurrent(current, surface) {
    const existing = current?.document[CLAUDE_CODE_STATUSLINE_SETTINGS_KEY];
    if (current === null ||
        existing === undefined ||
        !claudeCodeStatuslineEntryIsWakeflows(existing)) {
        return null;
    }
    return Object.freeze({
        operationId: removalOperationIdFor(surface),
        operationKind: CLAUDE_CODE_STATUSLINE_REMOVAL_OPERATION_KIND,
        ownerId: CLAUDE_CODE_STATUSLINE_SETTINGS_OWNER_ID,
        targetKey: claudeCodeStatuslineRemovalTargetKey(surface),
        sourceDigest: current.source.digest,
        targetDigest: computeSha256Digest(renderWithoutEntry(current.document)),
        payload: removalPayloadFor(surface),
    });
}
/** 读一个根的本地设置并计划删除；读不出不抛，记调用方给的 blocker。 */
async function planRemovalAt(read, surface, blockerCode) {
    try {
        return { operation: planRemovalFromCurrent(await read(), surface) };
    }
    catch (error) {
        if (error instanceof ClaudeCodeStatuslineSettingsOperationError &&
            error.reason === "settings-unreadable") {
            return { blockerCode };
        }
        throw error;
    }
}
/**
 * 退出路径（ADR-0024 `remove-statusline-entry`）：程序根与每个 wakeflow-managed 支撑面各算一次，只删
 * 所有权判定为 Wakeflow 的那一条；面根不在即无可删；文件读不出不猜，记一条与安装路径同名的 blocker
 * （程序根一条，支撑面带 surfaceId）。detach-repository 没有状态行维度，返回空集；非退出动作是调用错误。
 */
export async function planClaudeCodeStatuslineSettingsRemoval(workspaceRoot, options) {
    assertRoot(workspaceRoot);
    if (!isWakeflowDetachAction(options.action))
        fail("input", "$action");
    const model = parseModel(options.config);
    if (options.signal?.aborted === true)
        fail("aborted", "$signal");
    const operations = [];
    const blockerCodes = [];
    const collect = (planned) => {
        if ("blockerCode" in planned)
            blockerCodes.push(planned.blockerCode);
        else if (planned.operation !== null)
            operations.push(planned.operation);
    };
    if (options.action === "detach-workspace") {
        collect(await planRemovalAt(() => currentSettings(workspaceRoot, options.signal), null, CLAUDE_CODE_STATUSLINE_SETTINGS_BLOCKER));
        for (const surface of managedSurfaces(model)) {
            const placement = await surfacePlacement(workspaceRoot, model, surface);
            if (placement.state === "missing")
                continue;
            collect(await planRemovalAt(() => withSurfaceRoot(placement.absolutePath, (surfaceRoot) => currentSettings(surfaceRoot, options.signal)), surface, claudeCodeStatuslineSettingsSurfaceBlocker(surface.surfaceId)));
        }
    }
    return Object.freeze({
        operations: Object.freeze(operations),
        blockerCodes: Object.freeze(blockerCodes),
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
    const keys = Object.keys(record).sort().join(" ");
    if ((keys !== "key path" && keys !== "key path surface") ||
        record.path !== CLAUDE_CODE_LOCAL_SETTINGS_REF ||
        record.key !== CLAUDE_CODE_STATUSLINE_SETTINGS_KEY) {
        fail("operation", "$operation");
    }
    if (keys === "key path")
        return payloadFor(null);
    return payloadFor(parseSurface(record.surface));
}
function parseSurface(value) {
    let record;
    try {
        record = parsePlainRecord(value, "$operation.surface");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("operation", "$operation.surface");
        throw error;
    }
    if (Object.keys(record).sort().join(" ") !== "configuredPlacement surfaceId") {
        fail("operation", "$operation.surface");
    }
    try {
        return Object.freeze({
            surfaceId: parseWakeflowDurableIdOfKind(record.surfaceId, "surface", "$operation.surface.surfaceId"),
            configuredPlacement: parseWakeflowConfigPlacement(record.configuredPlacement, "$operation.surface.configuredPlacement"),
        });
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError || error instanceof WakeflowConfigError) {
            fail("operation", error.path);
        }
        throw error;
    }
}
/** 支撑面负载只在配置里仍有同一 wakeflow-managed 面、放置未变时执行。 */
function authorizedSurface(model, surface) {
    const configured = model.topology.supportSurfaces.find((entry) => entry.surfaceId === surface.surfaceId);
    if (configured === undefined ||
        configured.ownership !== "wakeflow-managed" ||
        configured.path !== surface.configuredPlacement) {
        fail("operation", "$operation.surface");
    }
    return surface;
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
export async function executeClaudeCodeStatuslineSettingsOperation(workspaceRoot, request) {
    assertRoot(workspaceRoot);
    const model = parseModel(request.config);
    const payload = parsePayload(request.operation);
    const digests = parseDigests(request);
    const entry = claudeCodeStatuslineSettingsEntry(workspaceRoot.absolutePath);
    if (payload.surface === undefined) {
        return executeAt(workspaceRoot, null, entry, digests, request);
    }
    const surface = authorizedSurface(model, payload.surface);
    const placement = await surfacePlacement(workspaceRoot, model, surface);
    if (placement.state !== "present")
        fail("placement", "$supportRoot");
    return withSurfaceRoot(placement.absolutePath, (surfaceRoot) => executeAt(surfaceRoot, surface, entry, digests, request));
}
async function executeAt(settingsRoot, surface, entry, digests, request) {
    const operationId = operationIdFor(surface);
    const current = await currentSettings(settingsRoot, request.signal);
    if (current !== null &&
        current.source.digest === digests.targetDigest &&
        current.source.node.permissionBits === SETTINGS_MODE) {
        return Object.freeze({
            operationId,
            disposition: "current",
            targetDigest: digests.targetDigest,
        });
    }
    if (!request.recoveringAffectedOperation &&
        (current?.source.digest ?? null) !== digests.sourceDigest) {
        fail("source-stale", "$settings");
    }
    const bytes = renderTarget(current?.document ?? {}, entry);
    if (computeSha256Digest(bytes) !== digests.targetDigest)
        fail("source-stale", "$settings");
    const disposition = await writeTarget(settingsRoot, current, bytes, request.signal);
    return Object.freeze({ operationId, disposition, targetDigest: digests.targetDigest });
}
function parseRemovalPayload(value) {
    let record;
    try {
        record = parsePlainRecord(value, "$operation");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("operation", error.path);
        throw error;
    }
    const keys = Object.keys(record).sort().join(" ");
    if ((keys !== "effect key path" && keys !== "effect key path surface") ||
        record.effect !== REMOVAL_EFFECT ||
        record.path !== CLAUDE_CODE_LOCAL_SETTINGS_REF ||
        record.key !== CLAUDE_CODE_STATUSLINE_SETTINGS_KEY) {
        fail("operation", "$operation");
    }
    return removalPayloadFor(keys === "effect key path" ? null : parseSurface(record.surface));
}
/** 退出路径的执行（ADR-0024）：只接受删除负载；支撑面负载同样对照当前配置核对，以该面的根为写入根。 */
export async function executeClaudeCodeStatuslineSettingsRemoval(workspaceRoot, request) {
    assertRoot(workspaceRoot);
    const model = parseModel(request.config);
    const payload = parseRemovalPayload(request.operation);
    const digests = parseDigests(request);
    if (payload.surface === undefined) {
        return executeRemovalAt(workspaceRoot, null, digests, request);
    }
    const surface = authorizedSurface(model, payload.surface);
    const placement = await surfacePlacement(workspaceRoot, model, surface);
    if (placement.state !== "present")
        fail("placement", "$supportRoot");
    return withSurfaceRoot(placement.absolutePath, (surfaceRoot) => executeRemovalAt(surfaceRoot, surface, digests, request));
}
/**
 * 删除：文件已是目标字节即 current；文件已不在时只有 affected 恢复算 current（无可删），常规执行是
 * source-stale；否则来源摘要必须等于计划时的（affected 恢复放开），键必须仍是 Wakeflow 的（用户换成
 * 自己的就不碰），去掉它重渲染必须得到计划的目标摘要，再 CAS 替换，0600。
 */
async function executeRemovalAt(settingsRoot, surface, digests, request) {
    const operationId = removalOperationIdFor(surface);
    const current = await currentSettings(settingsRoot, request.signal);
    const asCurrent = Object.freeze({
        operationId,
        disposition: "current",
        targetDigest: digests.targetDigest,
    });
    if (current === null) {
        if (!request.recoveringAffectedOperation)
            fail("source-stale", "$settings");
        return asCurrent;
    }
    if (current.source.digest === digests.targetDigest)
        return asCurrent;
    if (!request.recoveringAffectedOperation && current.source.digest !== digests.sourceDigest) {
        fail("source-stale", "$settings");
    }
    const existing = current.document[CLAUDE_CODE_STATUSLINE_SETTINGS_KEY];
    if (existing === undefined || !claudeCodeStatuslineEntryIsWakeflows(existing)) {
        fail("source-stale", "$settings");
    }
    const bytes = renderWithoutEntry(current.document);
    if (computeSha256Digest(bytes) !== digests.targetDigest)
        fail("source-stale", "$settings");
    const disposition = await writeTarget(settingsRoot, current, bytes, request.signal);
    return Object.freeze({ operationId, disposition, targetDigest: digests.targetDigest });
}
