import { types } from "node:util";
import { canonicalizeJson } from "../../foundation/data/canonical-json.js";
import { DeterministicJsonDocumentError } from "../../foundation/data/deterministic-json-document.js";
import { PassiveOwnDataError, parsePlainRecord } from "../../foundation/data/passive-own-data.js";
import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import { hasDurableAtomicFileStagePrefix } from "../../foundation/filesystem/durable-atomic-file-stage-address.js";
import { DurableAtomicFileStageRecoveryError, recoverDurableAtomicFileStagesForTargets, } from "../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import { createFileAtomically, DurableAtomicFileWriteError, } from "../../foundation/filesystem/durable-atomic-file-write.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { KernelFileLockError } from "../../foundation/filesystem/kernel-file-lock.js";
import { withWorkspaceLock } from "../../kernel/workspace-locks.js";
import { readStableResourceDirectory, StableDirectoryReadError, } from "../../foundation/filesystem/stable-directory-read.js";
import { StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../foundation/filesystem/strict-text-file.js";
import { currentUserIdOrNull } from "../../foundation/node/current-user.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { readUtcWallClock, UtcWallClockError, } from "../../foundation/time/wall-clock.js";
import { createWakeflowWindowHostBinding, parseWakeflowWindowHostBindingDocument, renderWakeflowWindowHostBinding, WakeflowWindowHostBindingError, } from "./wakeflow-window-host-binding.js";
import { createWakeflowWindowHostBindingId, WakeflowWindowHostBindingIdError, } from "./wakeflow-window-host-binding-id.js";
import { wakeflowWindowHostBindingRef } from "./wakeflow-window-runtime-paths.js";
const ERROR_MESSAGES = {
    input: "Window Host Binding store input is invalid.",
    layout: "Window Host Binding private layout is unavailable or unsafe.",
    inventory: "Window Host Binding inventory is invalid or changed.",
    lock: "Window Host Binding store lock could not be acquired safely.",
    "recovery-required": "Window Host Binding store requires explicit recovery.",
    aborted: "Window Host Binding store operation was aborted.",
    time: "Window Host Binding store clock could not be read safely.",
    "binding-id": "Window Host Binding ID could not be allocated safely.",
    write: "Window Host Binding authority could not be published safely.",
};
/** Binding store 物理操作失败的稳定、脱敏错误。 */
export class WakeflowWindowHostBindingStoreError extends Error {
    name = "WakeflowWindowHostBindingStoreError";
    code = "wakeflow-window-host-binding-store";
    reason;
    path;
    bindingAuthority;
    constructor(reason, path, bindingAuthority = "unchanged") {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
        this.bindingAuthority = bindingAuthority;
    }
}
const MAXIMUM_BINDING_BYTES = parseByteCount(64 * 1024);
function fail(reason, path, bindingAuthority = "unchanged") {
    throw new WakeflowWindowHostBindingStoreError(reason, path, bindingAuthority);
}
function parseOptions(value) {
    let record;
    try {
        record = parsePlainRecord(value ?? {}, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$options");
        throw error;
    }
    const allowed = new Set(["acquireTimeoutMilliseconds", "signal", "uuidFactory", "wallClock"]);
    if (Object.keys(record).some((key) => !allowed.has(key))) {
        fail("input", "$options");
    }
    for (const key of ["uuidFactory", "wallClock"]) {
        if (record[key] !== undefined &&
            (typeof record[key] !== "function" || types.isProxy(record[key]))) {
            fail("input", `$options.${key}`);
        }
    }
    if (record.signal !== undefined &&
        (typeof record.signal !== "object" ||
            record.signal === null ||
            types.isProxy(record.signal) ||
            !(record.signal instanceof AbortSignal))) {
        fail("input", "$options.signal");
    }
    if (record.acquireTimeoutMilliseconds !== undefined &&
        (typeof record.acquireTimeoutMilliseconds !== "number" ||
            !Number.isSafeInteger(record.acquireTimeoutMilliseconds) ||
            record.acquireTimeoutMilliseconds <= 0 ||
            record.acquireTimeoutMilliseconds > 300_000)) {
        fail("input", "$options.acquireTimeoutMilliseconds");
    }
    return Object.freeze({
        uuidFactory: record.uuidFactory,
        wallClock: record.wallClock,
        signal: record.signal,
        acquireTimeoutMilliseconds: record.acquireTimeoutMilliseconds,
    });
}
function parseInspectOptions(value) {
    let record;
    try {
        record = parsePlainRecord(value ?? {}, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$options");
        throw error;
    }
    if (Object.keys(record).some((key) => key !== "signal") ||
        (record.signal !== undefined &&
            (typeof record.signal !== "object" ||
                record.signal === null ||
                types.isProxy(record.signal) ||
                !(record.signal instanceof AbortSignal)))) {
        fail("input", "$options");
    }
    return Object.freeze({
        signal: record.signal,
    });
}
function assertNotAborted(signal) {
    if (signal?.aborted === true)
        fail("aborted", "$signal");
}
function privateNode(node, kind, path, maximumLinks = 1n) {
    const currentUserId = currentUserIdOrNull();
    if (node.kind !== kind ||
        node.permissionBits !== (kind === "directory" ? 0o700 : 0o600) ||
        (kind === "file" && (node.linkCount < 1n || node.linkCount > maximumLinks)) ||
        (currentUserId !== null && node.userId !== currentUserId)) {
        fail("layout", path);
    }
}
async function recoverStages(root, targets, signal) {
    try {
        const recovery = await recoverDurableAtomicFileStagesForTargets(root, targets, signal === undefined ? undefined : { signal });
        if (recovery.activeStageCount !== 0 || recovery.unknownStageCount !== 0) {
            fail("recovery-required", "$stages");
        }
    }
    catch (error) {
        if (error instanceof WakeflowWindowHostBindingStoreError)
            throw error;
        if (error instanceof DurableAtomicFileStageRecoveryError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("recovery-required", "$stages");
        }
        throw error;
    }
}
async function readInventory(root, authority, signal) {
    let directory;
    try {
        // 登记表的成员之外，最多还有一份登记文件的暂存和一个文件锁版本留下的登记锁。
        directory = await readStableResourceDirectory(root, authority.bindingRootRef, {
            maximumEntries: authority.bindingRefs.length + 2,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof StableDirectoryReadError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("layout", "$bindingRoot");
        }
        throw error;
    }
    privateNode(directory.directoryNode, "directory", "$bindingRoot");
    const expected = new Set(authority.bindingRefs);
    const bindings = [];
    for (const entry of directory.entries) {
        // 登记留下的原子暂存不是成员；清它们的是下一次登记。
        if (hasDurableAtomicFileStagePrefix(entry.name))
            continue;
        // 文件锁版本（1.4.3 及之前）的登记被强杀后留下的锁文件也不是成员：它挡住登记表，就挡住了删掉它的
        // 那次维护（ADR-0033 决定 10）。与清理一起只活一个版本。
        if (entry.name === ".registration.lock")
            continue;
        if (!expected.has(entry.resourcePath))
            fail("inventory", "$inventory");
        privateNode(entry.node, "file", "$inventory");
        let read;
        try {
            read = await readDeterministicJsonFile(root, entry.resourcePath, {
                maximumBytes: MAXIMUM_BINDING_BYTES,
                expectedNode: entry.node,
                ...(signal === undefined ? {} : { signal }),
            });
        }
        catch (error) {
            if (error instanceof StableFileReadError && error.reason === "aborted") {
                fail("aborted", "$signal");
            }
            if (error instanceof StableFileReadError ||
                error instanceof StrictTextFileError ||
                error instanceof DeterministicJsonDocumentError) {
                fail("inventory", "$inventory");
            }
            throw error;
        }
        let binding;
        try {
            binding = parseWakeflowWindowHostBindingDocument(read.text, authority.identityProfile);
        }
        catch (error) {
            if (error instanceof WakeflowWindowHostBindingError) {
                fail("inventory", "$inventory");
            }
            throw error;
        }
        if (binding.programId !== authority.programId ||
            binding.hostId !== authority.resourceProfile.hostId ||
            wakeflowWindowHostBindingRef(authority.resourceProfile, binding.windowId) !==
                entry.resourcePath) {
            fail("inventory", "$inventory");
        }
        bindings.push(binding);
    }
    const windowIds = new Set();
    const bindingIds = new Set();
    const handles = new Set();
    for (const binding of bindings) {
        const handleKey = `${binding.handle.kind}\u0000${binding.handle.value}`;
        if (windowIds.has(binding.windowId) ||
            bindingIds.has(binding.bindingId) ||
            handles.has(handleKey)) {
            fail("inventory", "$inventory");
        }
        windowIds.add(binding.windowId);
        bindingIds.add(binding.bindingId);
        handles.add(handleKey);
    }
    return Object.freeze({
        bindings: Object.freeze(bindings),
    });
}
function mapLockError(error) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    fail("lock", "$lock");
}
function sameInventory(left, right) {
    return canonicalizeJson(left, "$leftInventory") === canonicalizeJson(right, "$rightInventory");
}
/**
 * 零写入观察一份稳定的完整Binding inventory。
 *
 * 读两遍并比较：一次登记恰好穿过观察窗口时两遍不同，本次读取失败关闭。登记锁在不在不影响读（1.4.2）：
 * 以前锁在场就拒绝，而持有者死掉之后只有下一次登记才清它，这期间每一个只读的调用都失败。现在读到的
 * 是此刻盘面上的登记表——与一次正在进行的登记同时发生时，可能是它之前的样子。锁文件与属于登记的原子
 * 暂存不算登记表的成员。该入口不创建锁、不恢复stage、不清理残留。
 */
export async function inspectWakeflowWindowHostBindingInventory(root, authority, optionsValue = {}) {
    if (typeof root !== "object" ||
        root === null ||
        types.isProxy(root) ||
        !(root instanceof RootedDirectory)) {
        fail("input", "$root");
    }
    const { signal } = parseInspectOptions(optionsValue);
    assertNotAborted(signal);
    const first = await readInventory(root, authority, signal);
    const second = await readInventory(root, authority, signal);
    if (!sameInventory(first, second))
        fail("inventory", "$inventory");
    return second;
}
/** 在恢复后的专用锁内提供一份完整 Binding inventory。 */
export async function withWakeflowWindowHostBindingStore(root, authoritySource, optionsValue, operation) {
    if (typeof root !== "object" ||
        root === null ||
        types.isProxy(root) ||
        !(root instanceof RootedDirectory) ||
        typeof operation !== "function" ||
        types.isProxy(operation)) {
        fail("input", "$store");
    }
    const options = parseOptions(optionsValue);
    assertNotAborted(options.signal);
    const authority = typeof authoritySource === "function" ? await authoritySource() : authoritySource;
    let entered = false;
    try {
        // 登记锁（ADR-0033）：两个宿主的登记共用一把；上一次登记留下的暂存在锁内先恢复（见下）。
        return await withWorkspaceLock(root, "window-binding", async () => {
            entered = true;
            const current = typeof authoritySource === "function" ? await authoritySource() : authority;
            if (current.bindingRootRef !== authority.bindingRootRef ||
                current.programId !== authority.programId ||
                current.resourceProfile.hostId !== authority.resourceProfile.hostId) {
                fail("input", "$authority");
            }
            await recoverStages(root, current.bindingRefs, options.signal);
            return operation(Object.freeze({
                inventory: await readInventory(root, current, options.signal),
                uuidFactory: options.uuidFactory,
                wallClock: options.wallClock,
                signal: options.signal,
            }));
        }, {
            ...(options.acquireTimeoutMilliseconds === undefined
                ? {}
                : {
                    acquireTimeoutMilliseconds: options.acquireTimeoutMilliseconds,
                }),
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
    }
    catch (error) {
        if (!entered && error instanceof KernelFileLockError)
            mapLockError(error);
        throw error;
    }
}
/** 在已锁定 inventory 下 no-replace 创建一份新的 Binding authority。 */
export async function createWakeflowWindowHostBindingInStore(root, authority, context) {
    let registeredAt;
    try {
        registeredAt =
            context.wallClock === undefined ? readUtcWallClock() : readUtcWallClock(context.wallClock);
    }
    catch (error) {
        if (error instanceof UtcWallClockError)
            fail("time", "$clock");
        throw error;
    }
    let binding;
    try {
        const allocatedBindingId = createWakeflowWindowHostBindingId(context.uuidFactory);
        if (context.inventory.bindings.some((entry) => entry.bindingId === allocatedBindingId)) {
            fail("binding-id", "$bindingId");
        }
        binding = createWakeflowWindowHostBinding({
            programId: authority.programId,
            hostId: authority.resourceProfile.hostId,
            windowId: authority.windowId,
            bindingId: allocatedBindingId,
            handle: authority.handle,
            launchIntentDigest: authority.launchIntentDigest,
            observedAt: authority.observedAt,
            registeredAt,
            ...(authority.launch === undefined ? {} : { launch: authority.launch }),
        }, authority.identityProfile);
    }
    catch (error) {
        if (error instanceof WakeflowWindowHostBindingIdError) {
            fail("binding-id", "$bindingId");
        }
        if (error instanceof WakeflowWindowHostBindingError) {
            if (error.reason === "time")
                fail("time", "$binding");
            fail("write", "$binding");
        }
        throw error;
    }
    try {
        await createFileAtomically(root, authority.bindingRef, encodeUtf8(renderWakeflowWindowHostBinding(binding, authority.identityProfile), "$binding"), {
            mode: 0o600,
            ...(context.signal === undefined ? {} : { signal: context.signal }),
        });
    }
    catch (error) {
        if (error instanceof DurableAtomicFileWriteError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "stage-recovery-required") {
                fail("recovery-required", "$binding");
            }
            if (error.reason === "target-exists" ||
                error.reason === "commit-uncertain" ||
                error.reason === "durability-failure" ||
                error.reason === "stage-cleanup-failure" ||
                error.reason === "close-failure") {
                fail("write", "$binding", "unknown");
            }
            fail("write", "$binding");
        }
        throw error;
    }
    return binding;
}
