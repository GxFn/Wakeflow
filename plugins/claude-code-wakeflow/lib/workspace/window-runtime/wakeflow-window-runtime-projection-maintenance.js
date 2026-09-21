import { parseWakeflowConfig, WakeflowConfigError, } from "../../configuration/wakeflow-config.js";
import { DurableDirectoryMaterializationError, materializeDirectoryPath, } from "../../foundation/filesystem/durable-directory-materialization.js";
import { ExactRegularFileUnlinkError, unlinkRegularFileExactly, } from "../../foundation/filesystem/exact-regular-file-unlink.js";
import { RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { isWakeflowError } from "../../kernel/error.js";
import { parseWakeflowWorkspaceHostResourceProfile, WakeflowWorkspaceHostResourceProfileError, } from "../workspace-host-resource-profile.js";
import { WAKEFLOW_HOST_RUNTIME_PROFILES_ROOT_REF, wakeflowHostIdentityRootRef, wakeflowHostProjectionsRootRef, wakeflowHostRuntimeRootRef, } from "../workspace-host-runtime-paths.js";
import { wakeflowWindowHostBindingRootRef, wakeflowWindowRuntimeProjectionRef, wakeflowWindowRuntimeProjectionRootRef, } from "./wakeflow-window-runtime-paths.js";
import { inspectWakeflowWindowRuntimeProjectionDocument, publishWakeflowWindowRuntimeProjectionDocument, } from "./wakeflow-window-runtime-projection-document.js";
import { admitWakeflowWindowRuntimeProjectionInputs, failWindowRuntimeProjection, inspectWakeflowWindowRuntimeProjectionEntries, resolveWakeflowWindowRuntimeProjectionExpectedEntries, } from "./wakeflow-window-runtime-projection-inspection.js";
import { compileWakeflowWindowRuntimeUnregisteredProjectionSet, WakeflowWindowRuntimeUnregisteredProjectionError, } from "./wakeflow-window-runtime-unregistered-projection.js";
/**
 * Wakeflow Workspace / Window Runtime：对账时窗口运行投影的重建（能力卡 1 §1.4 自动修复）。
 *
 * 每个窗口的目标文档由当前 Config 与当前 Binding inventory 重算（观察缝
 * `wakeflow-window-runtime-projection-inspection.ts`，与 `wakeflow_status` / `wakeflow_verify`
 * 共用同一份判定）。磁盘文档缺失或过期（合法但内容不同）出一条宿主维护操作，由宿主 capability
 * 在维护事务内执行；读不出或不是确定性 JSON 的文档只报告 `window-runtime-projection-unsafe`，
 * 不覆盖。宿主运行时根尚未发布时本模块不出操作：共享预览已用 `window-runtime-missing` 报告它。
 * fresh 由共享步骤发布全部未登记投影。
 *
 * 目标文档需要宿主的 identity profile，所以本模块经宿主 capability 端口进入维护事务，
 * 而不是静态预览：共享层不能选择宿主身份。
 */
export const WAKEFLOW_WINDOW_RUNTIME_PROJECTION_OPERATION_KIND = "window-runtime-projection";
export const WAKEFLOW_WINDOW_RUNTIME_PROJECTION_OWNER_ID = "window-runtime-projection";
export const WAKEFLOW_WINDOW_RUNTIME_PROJECTION_UNSAFE_BLOCKER = "window-runtime-projection-unsafe";
export const WAKEFLOW_WINDOW_RUNTIME_PROJECTION_UNAVAILABLE_BLOCKER = "window-runtime-projection-unavailable";
function operationFor(entry, sourceDigest) {
    return {
        operationId: `window-runtime-projection:${entry.windowId}`,
        operationKind: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_OPERATION_KIND,
        ownerId: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_OWNER_ID,
        targetKey: entry.windowId,
        sourceDigest,
        targetDigest: entry.target.documentDigest,
        payload: {
            windowId: entry.windowId,
            resourceRef: entry.target.resourceRef,
            registered: entry.registered,
            projectionDigest: entry.target.projectionDigest,
        },
    };
}
/** 零写入规划：缺失或过期的投影各出一条操作；读不稳的投影与读不出的 inventory 只报告。 */
export async function planWakeflowWindowRuntimeProjectionMaintenance(rootValue, request) {
    if (request.signal?.aborted === true)
        failWindowRuntimeProjection("aborted", "$signal");
    const inputs = admitWakeflowWindowRuntimeProjectionInputs(rootValue, request.config, request.resourceProfile, request.identityProfile);
    if (request.action === "fresh-initialize") {
        return Object.freeze({ operations: Object.freeze([]), blockerCodes: Object.freeze([]) });
    }
    let expected = await resolveWakeflowWindowRuntimeProjectionExpectedEntries(rootValue, inputs, request.signal);
    // 宿主运行时根缺失：共享预览在同一事务里先补目录骨架与未登记投影（§13.114 D2），本贡献只为
    // 仍有 Binding 的窗口出 registered 投影操作；未登记窗口由骨架步骤发布。
    const runtimeMissing = expected.kind === "runtime-missing";
    if (runtimeMissing) {
        expected = await resolveWakeflowWindowRuntimeProjectionExpectedEntries(rootValue, inputs, request.signal, { projectionRootRequired: false });
    }
    if (expected.kind === "runtime-missing") {
        return Object.freeze({ operations: Object.freeze([]), blockerCodes: Object.freeze([]) });
    }
    if (expected.kind === "inventory-unavailable") {
        return Object.freeze({
            operations: Object.freeze([]),
            blockerCodes: Object.freeze([WAKEFLOW_WINDOW_RUNTIME_PROJECTION_UNAVAILABLE_BLOCKER]),
        });
    }
    const operations = [];
    let unsafe = false;
    const inspected = await inspectWakeflowWindowRuntimeProjectionEntries(rootValue, expected.entries, request.signal);
    for (const item of inspected) {
        if (runtimeMissing && !item.entry.registered)
            continue;
        if (item.status === "current")
            continue;
        if (item.status === "unsafe") {
            unsafe = true;
            continue;
        }
        operations.push(operationFor(item.entry, item.currentDigest));
    }
    return Object.freeze({
        operations: Object.freeze(operations),
        blockerCodes: Object.freeze(unsafe ? [WAKEFLOW_WINDOW_RUNTIME_PROJECTION_UNSAFE_BLOCKER] : []),
    });
}
/**
 * 配置事务收尾：窗口集变了（pod 创建 / 关闭）就把本宿主缺失或过期的窗口投影收敛到新 Config 与
 * 当前 Binding 的重算；每份投影的指纹覆盖整个期望拓扑，所以别的窗口增减也会让它过期
 * （G6，§13.111 D5）。unsafe 原样保留；宿主运行时根未发布或 inventory 读不出时不写。
 */
export async function refreshWakeflowWindowRuntimeProjections(rootValue, request) {
    if (request.signal?.aborted === true)
        failWindowRuntimeProjection("aborted", "$signal");
    const inputs = admitWakeflowWindowRuntimeProjectionInputs(rootValue, request.config, request.resourceProfile, request.identityProfile);
    const expected = await resolveWakeflowWindowRuntimeProjectionExpectedEntries(rootValue, inputs, request.signal);
    if (expected.kind !== "entries") {
        return Object.freeze({ status: expected.kind, published: 0, unsafe: 0 });
    }
    const inspected = await inspectWakeflowWindowRuntimeProjectionEntries(rootValue, expected.entries, request.signal);
    let published = 0;
    let unsafe = 0;
    for (const item of inspected) {
        if (item.status === "current")
            continue;
        if (item.status === "unsafe") {
            unsafe += 1;
            continue;
        }
        try {
            await publishWakeflowWindowRuntimeProjectionDocument(rootValue, item.entry.target, request.signal);
        }
        catch (error) {
            if (isWakeflowError(error)) {
                failWindowRuntimeProjection(error.reason === "aborted" ? "aborted" : "effect", "$projection");
            }
            throw error;
        }
        published += 1;
    }
    return Object.freeze({ status: "refreshed", published, unsafe });
}
/**
 * 对账 / 重配置补齐本宿主运行时的目录骨架（与 fresh 同一组六个 0700 目录）与缺失的未登记
 * 投影（§13.114 D2）；已有投影一律不动——过期的由宿主 capability 的逐窗口操作重建，读不出的
 * 只报告。只需资源 profile，所以可以在共享执行器里跑。
 */
export async function ensureWakeflowWindowRuntimeSkeleton(rootValue, request) {
    if (request.signal?.aborted === true)
        failWindowRuntimeProjection("aborted", "$signal");
    let config;
    try {
        config = parseWakeflowConfig(request.config);
    }
    catch (error) {
        if (error instanceof WakeflowConfigError)
            failWindowRuntimeProjection("input", error.path);
        throw error;
    }
    let resourceProfile;
    try {
        resourceProfile = parseWakeflowWorkspaceHostResourceProfile(request.resourceProfile);
    }
    catch (error) {
        if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
            failWindowRuntimeProjection("profile", error.path);
        }
        throw error;
    }
    let unregistered;
    try {
        unregistered = compileWakeflowWindowRuntimeUnregisteredProjectionSet(config, resourceProfile);
    }
    catch (error) {
        if (error instanceof WakeflowWindowRuntimeUnregisteredProjectionError) {
            failWindowRuntimeProjection("topology", error.path);
        }
        throw error;
    }
    const signal = request.signal;
    let directoriesCreated = 0;
    for (const resourceRef of [
        WAKEFLOW_HOST_RUNTIME_PROFILES_ROOT_REF,
        wakeflowHostRuntimeRootRef(resourceProfile),
        wakeflowHostIdentityRootRef(resourceProfile),
        wakeflowHostProjectionsRootRef(resourceProfile),
        wakeflowWindowHostBindingRootRef(resourceProfile),
        wakeflowWindowRuntimeProjectionRootRef(resourceProfile),
    ]) {
        let present = true;
        try {
            await rootValue.inspectExistingResource(resourceRef, "$skeleton");
        }
        catch (error) {
            if (!(error instanceof RootedDirectoryError && error.reason === "resource-not-found")) {
                throw error;
            }
            present = false;
        }
        try {
            await materializeDirectoryPath(rootValue, resourceRef, {
                mode: 0o700,
                ...(signal === undefined ? {} : { signal }),
            });
        }
        catch (error) {
            if (error instanceof DurableDirectoryMaterializationError) {
                failWindowRuntimeProjection(error.reason === "aborted" ? "aborted" : "effect", `$skeleton/${resourceRef}`);
            }
            throw error;
        }
        if (!present)
            directoriesCreated += 1;
    }
    let projectionsPublished = 0;
    for (const entry of unregistered.entries) {
        const target = Object.freeze({
            resourceRef: entry.resourceRef,
            document: entry.document,
            documentDigest: entry.documentDigest,
            projectionDigest: entry.projection.projectionDigest,
        });
        try {
            const inspection = await inspectWakeflowWindowRuntimeProjectionDocument(rootValue, target, signal);
            if (inspection.status !== "missing")
                continue;
            await publishWakeflowWindowRuntimeProjectionDocument(rootValue, target, signal);
        }
        catch (error) {
            if (isWakeflowError(error)) {
                failWindowRuntimeProjection(error.reason === "aborted" ? "aborted" : "effect", "$projection");
            }
            throw error;
        }
        projectionsPublished += 1;
    }
    return Object.freeze({
        created: directoriesCreated + projectionsPublished > 0,
        directoriesCreated,
        projectionsPublished,
    });
}
/**
 * 窗口离开配置（pod 关闭）后退役本宿主的投影文件（§13.114 D3）：只按已知 windowId 精确删除，
 * 不枚举投影目录；文件不在即 absent。投影是派生物，退役失败由调用方决定是否只报告。
 */
export async function retireWakeflowWindowRuntimeProjections(rootValue, request) {
    if (request.signal?.aborted === true)
        failWindowRuntimeProjection("aborted", "$signal");
    let resourceProfile;
    try {
        resourceProfile = parseWakeflowWorkspaceHostResourceProfile(request.resourceProfile);
    }
    catch (error) {
        if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
            failWindowRuntimeProjection("profile", error.path);
        }
        throw error;
    }
    let retired = 0;
    let absent = 0;
    for (const windowId of request.windowIds) {
        const resourceRef = wakeflowWindowRuntimeProjectionRef(resourceProfile, windowId);
        let node;
        try {
            node = (await rootValue.inspectExistingResource(resourceRef, "$projection")).node;
        }
        catch (error) {
            if (error instanceof RootedDirectoryError && error.reason === "resource-not-found") {
                absent += 1;
                continue;
            }
            throw error;
        }
        try {
            await unlinkRegularFileExactly(rootValue, resourceRef, {
                expectedNode: node,
                ...(request.signal === undefined ? {} : { signal: request.signal }),
            });
        }
        catch (error) {
            if (error instanceof ExactRegularFileUnlinkError) {
                failWindowRuntimeProjection(error.reason === "aborted" ? "aborted" : "effect", "$projection");
            }
            throw error;
        }
        retired += 1;
    }
    return Object.freeze({ retired, absent });
}
/** 在维护事务内重算同一窗口的目标文档，核对与计划一致后发布；目标已相同即 current。 */
export async function executeWakeflowWindowRuntimeProjectionOperation(rootValue, request) {
    if (request.signal?.aborted === true)
        failWindowRuntimeProjection("aborted", "$signal");
    const inputs = admitWakeflowWindowRuntimeProjectionInputs(rootValue, request.config, request.resourceProfile, request.identityProfile);
    const expected = await resolveWakeflowWindowRuntimeProjectionExpectedEntries(rootValue, inputs, request.signal);
    if (expected.kind !== "entries")
        failWindowRuntimeProjection("plan", "$operation");
    const entry = expected.entries.find((candidate) => candidate.windowId === request.targetKey);
    if (entry === undefined
        || request.operationId !== `window-runtime-projection:${entry.windowId}`
        || entry.target.documentDigest !== request.targetDigest) {
        failWindowRuntimeProjection("plan", "$operation");
    }
    let receipt;
    try {
        receipt = await publishWakeflowWindowRuntimeProjectionDocument(rootValue, entry.target, request.signal);
    }
    catch (error) {
        if (isWakeflowError(error)) {
            failWindowRuntimeProjection(error.reason === "aborted" ? "aborted" : "effect", "$projection");
        }
        throw error;
    }
    return Object.freeze({
        operationId: request.operationId,
        disposition: receipt.disposition === "current"
            ? "current"
            : receipt.disposition === "created"
                ? "created"
                : "updated",
        observationDigest: receipt.documentDigest,
    });
}
