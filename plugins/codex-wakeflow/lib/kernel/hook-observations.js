import pLimit from "p-limit";
import { parseSha256Digest } from "../foundation/crypto/sha256.js";
import { parseDeterministicJsonDocument, renderDeterministicJsonDocument, } from "../foundation/data/deterministic-json-document.js";
import { parseJsonValue } from "../foundation/data/json-value.js";
import { readDeterministicJsonFile } from "../foundation/filesystem/deterministic-json-file.js";
import { DurableAtomicFileStageAddressError, hasDurableAtomicFileStagePrefix, parseDurableAtomicFileStageFileName, readDurableAtomicFileStageOwnerState, } from "../foundation/filesystem/durable-atomic-file-stage-address.js";
import { createFileAtomically, DurableAtomicFileWriteError, } from "../foundation/filesystem/durable-atomic-file-write.js";
import { DurableDirectoryMaterializationError, materializeDirectoryPath, } from "../foundation/filesystem/durable-directory-materialization.js";
import { sameFileNodeIdentity } from "../foundation/filesystem/file-node-snapshot.js";
import { removeEmptyDirectoryExactly } from "../foundation/filesystem/durable-directory-tree-candidate-retirement.js";
import { unlinkRegularFileExactly } from "../foundation/filesystem/exact-regular-file-unlink.js";
import { parsePortableResourcePath, } from "../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError, } from "../foundation/filesystem/rooted-directory.js";
import { StableDirectoryReadError, } from "../foundation/filesystem/stable-directory-read.js";
import { StableFileReadError } from "../foundation/filesystem/stable-file-read.js";
import { deriveUuidV4 } from "../foundation/identity/uuid-v4.js";
import { parseByteCount } from "../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../foundation/text/utf8.js";
import { parseUtcInstant } from "../foundation/time/utc-instant.js";
import { fail } from "./error.js";
import { HOST_HOOK_FILE_NAME_PATTERN as FILE_NAME_PATTERN, partitionedHostHookRef, visitHostHookDirectory, } from "./hook-observation-directory.js";
import { hostHookObservationsRootRef, parseWakeflowHostId } from "./layout.js";
/**
 * Host hooks persist private facts, never message bodies. Record schema and ids
 * remain v1. New writes use UTC-day/digest-prefix partitions; flat v1 records are
 * read in place, and their retries never migrate or rewrite existing bytes.
 *
 * Directory pages bound memory, not history length. Exact queries distinguish a
 * complete result from truncation; full scans aggregate locally and must discard
 * those aggregates on failure. Directory races, unreadable partitions and aborts
 * cannot become evidence of absence. Known create/0600 stages are not records;
 * unknown names and unsafe nodes count as skipped and are never auto-deleted.
 *
 * Retirement is best effort after a durable create, bounded to 4096 inspected
 * entries per write. The 30-day cutoff is capped by the newest other record,
 * found newest-first, so one future clock jump cannot erase recent evidence and
 * a dense history cannot pin the cutoff to stale leaves (§13.161). Only day
 * partitions before the cutoff day, flat v1 files and the written record's own
 * shard are visited; emptied partitions are removed. Unvisited entries can be
 * retained longer. Known inactive stages older than ten minutes are retired by
 * exact node identity. Caller cancellation still propagates even after the
 * record becomes durable; cancellation does not imply rollback.
 *
 * Foreign names count as skipped for verification but never block evidence
 * queries: only a record-named entry that cannot be read, or a directory or
 * link where a leaf should be, is unreadable. Dot-files other than Wakeflow's
 * own stages (Finder's .DS_Store, editor swap files) are ignored outright.
 */
export const HOST_HOOK_EVENTS = Object.freeze([
    "session-start",
    "user-prompt-submit",
    "stop",
    "session-end",
    "turn-complete",
]);
const RECORD_KIND = "WakeflowHostHookObservation";
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/u;
const CWD_MAXIMUM_LENGTH = 4096;
function hasControlCharacter(text) {
    for (const character of text) {
        const code = character.codePointAt(0) ?? 0;
        if (code < 0x20 || code === 0x7f)
            return true;
    }
    return false;
}
const RECORD_MAXIMUM_BYTES = parseByteCount(64 * 1024, "$observation.maximumBytes");
/** Maximum retained query results/session aggregates, independent of directory capacity. */
export const HOST_HOOK_RECORDS_MAXIMUM = 16384;
/** Best-effort retirement scan and deletion budget per newly committed record. */
const PRUNE_MAXIMUM_ENTRIES = 4096;
const PRUNE_SCAN_COMPLETE = Symbol("prune-scan-budget");
/** 修剪 unlink 的并发上限：与稳定目录读取的 lstat 并发同量级，每次退休量受检查预算限制。 */
const PRUNE_UNLINK_CONCURRENCY = 8;
/** 记录只按龄保留：早于此值的记录文件在下一次成功写入后被 unlink（§13.97 D7b）。 */
export const HOST_HOOK_RETENTION_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;
/**
 * 被遗弃的暂存文件的退休龄（§13.134 B12）：一次 hook 写入里暂存文件只活毫秒级，十分钟远在其上，
 * 仍在写的 hook 的暂存文件不会被下一次写入的修剪抢走。
 */
export const HOST_HOOK_ABANDONED_STAGE_MILLISECONDS = 10 * 60 * 1000;
const NANOSECONDS_PER_MILLISECOND = 1000000n;
/** ISO 毫秒形 `YYYY-MM-DDTHH:MM:SS.mmmZ` 的长度：文件名模式要求 9 位数字，其他精度永远读不出。 */
const MILLISECOND_INSTANT_LENGTH = 24;
const DEFAULT_LIMIT = 256;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const RECORD_KEYS = Object.freeze([
    "kind",
    "schemaVersion",
    "recordId",
    "hostId",
    "event",
    "sessionId",
    "cwd",
    "recordedAt",
    "turnId",
    "promptDigest",
    "lastAssistantMessageDigest",
    "transcriptRef",
]);
/** 后加的可选键：旧记录没有它也合法（§13.127）。 */
const OPTIONAL_RECORD_KEYS = Object.freeze(["artifactManifestDigest"]);
/**
 * 条目若是本写入器自己那种原子暂存文件（§13.134 B12），返回它的暂存地址，否则返回 `null`：普通
 * 文件，名字精确符合 foundation 的暂存命名，且是 `create`、权限位 0600——`writeHostHookObservation`
 * 只会留下这一种。节点也得是这个形状：实际权限位 0600、链接数 1（未发布）或 2（与已发布的记录
 * 双链接）。名字对而节点不对的条目，foundation 的写前暂存清点会拒绝整个目录的写入，它必须计入
 * `skipped` 让 verify 看见，也不许被修剪。先用保留前缀预筛：记录名以数字开头从不占用它，不为每个
 * 记录名付一次解析异常。
 */
function hostHookStageAddress(entry) {
    const { node } = entry;
    if (node.kind !== "file" ||
        node.permissionBits !== FILE_MODE ||
        (node.linkCount !== 1n && node.linkCount !== 2n) ||
        !hasDurableAtomicFileStagePrefix(entry.name)) {
        return null;
    }
    try {
        const address = parseDurableAtomicFileStageFileName(entry.name);
        return address.operation === "create" && address.mode === FILE_MODE ? address : null;
    }
    catch (error) {
        if (error instanceof DurableAtomicFileStageAddressError)
            return null;
        throw error;
    }
}
function isHostHookEvent(value) {
    return typeof value === "string" && HOST_HOOK_EVENTS.includes(value);
}
function identifier(value, path) {
    if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
        fail("invalid-request", "hook-identifier", path);
    }
    return value;
}
function optionalIdentifier(value, path) {
    return value === null || value === undefined ? null : identifier(value, path);
}
function optionalDigest(value, path) {
    return value === null || value === undefined ? null : parseSha256Digest(value, path);
}
function cwd(value, path) {
    if (typeof value !== "string" ||
        value.length === 0 ||
        value.length > CWD_MAXIMUM_LENGTH ||
        !value.startsWith("/") ||
        hasControlCharacter(value)) {
        fail("invalid-request", "hook-cwd", path);
    }
    return value;
}
function optionalText(value, path) {
    if (value === null || value === undefined)
        return null;
    if (typeof value !== "string" ||
        value.length === 0 ||
        value.length > CWD_MAXIMUM_LENGTH ||
        hasControlCharacter(value)) {
        fail("invalid-request", "hook-text", path);
    }
    return value;
}
function compactInstant(recordedAt) {
    return recordedAt.replace(/[-:.]/gu, "");
}
/** 记录时间必须恰好 3 位小数秒：文件名的 9 位数字由此而来（§13.97 D7a）。 */
function millisecondInstant(value, path) {
    const instant = parseUtcInstant(value, path);
    if (instant.length !== MILLISECOND_INSTANT_LENGTH || instant[19] !== ".") {
        fail("invalid-request", "hook-instant-precision", path);
    }
    return instant;
}
/** 由宿主、事件、会话、时间与 turn 派生记录标识：hook 重复触发不会造出第二条记录。 */
function deriveHostHookObservationId(input) {
    return deriveUuidV4("wakeflow-host-hook-observation", input.hostId, input.event, input.sessionId, input.recordedAt, input.turnId ?? "");
}
/** 用宿主交回的事实创建一条记录；不合法的输入以 `invalid-request` 拒绝。 */
export function createHostHookObservation(input) {
    if (typeof input !== "object" || input === null) {
        fail("invalid-request", "hook-input", "$observation");
    }
    const hostId = parseWakeflowHostId(input.hostId, "$observation.hostId");
    if (!isHostHookEvent(input.event))
        fail("invalid-request", "hook-event", "$observation.event");
    const partial = {
        hostId,
        event: input.event,
        sessionId: identifier(input.sessionId, "$observation.sessionId"),
        cwd: cwd(input.cwd, "$observation.cwd"),
        recordedAt: millisecondInstant(input.recordedAt, "$observation.recordedAt"),
        turnId: optionalIdentifier(input.turnId, "$observation.turnId"),
        promptDigest: optionalDigest(input.promptDigest, "$observation.promptDigest"),
        lastAssistantMessageDigest: optionalDigest(input.lastAssistantMessageDigest, "$observation.lastAssistantMessageDigest"),
        transcriptRef: optionalText(input.transcriptRef, "$observation.transcriptRef"),
        artifactManifestDigest: optionalDigest(input.artifactManifestDigest, "$observation.artifactManifestDigest"),
    };
    return Object.freeze({
        kind: RECORD_KIND,
        schemaVersion: 1,
        recordId: deriveHostHookObservationId(partial),
        ...partial,
    });
}
/** 严格解析一条持久化记录；键集、摘要与标识必须自洽。 */
function parseHostHookObservation(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        fail("invalid-request", "hook-record", "$record");
    }
    const object = value;
    const keys = Object.keys(object);
    if (RECORD_KEYS.some((key) => !keys.includes(key)) ||
        keys.some((key) => !RECORD_KEYS.includes(key) && !OPTIONAL_RECORD_KEYS.includes(key))) {
        fail("invalid-request", "hook-record", "$record");
    }
    if (object.kind !== RECORD_KIND || object.schemaVersion !== 1) {
        fail("invalid-request", "hook-record", "$record");
    }
    const record = createHostHookObservation({
        hostId: object.hostId,
        event: object.event,
        sessionId: object.sessionId,
        cwd: object.cwd,
        recordedAt: object.recordedAt,
        turnId: object.turnId,
        promptDigest: object.promptDigest,
        lastAssistantMessageDigest: object.lastAssistantMessageDigest,
        transcriptRef: object.transcriptRef,
        artifactManifestDigest: (object.artifactManifestDigest ?? null),
    });
    if (record.recordId !== object.recordId) {
        fail("invalid-request", "hook-record-id", "$record.recordId");
    }
    return record;
}
function renderHostHookObservation(record) {
    return renderDeterministicJsonDocument(parseJsonValue(record, "$record"), "$record");
}
/** Optional v1 fields may be absent in older durable bytes; retries preserve them. */
function sameObservationDocument(value, document) {
    try {
        return renderHostHookObservation(parseHostHookObservation(value)) === document;
    }
    catch {
        return false;
    }
}
/** 记录文件名：`<时间紧凑形>-<事件>-<recordId>.json`，按名字即可按时间与事件预筛。 */
function hostHookObservationFileName(record) {
    return `${compactInstant(record.recordedAt)}-${record.event}-${record.recordId}.json`;
}
function legacyHostHookObservationRef(record) {
    return parsePortableResourcePath(`${hostHookObservationsRootRef(record.hostId)}/${hostHookObservationFileName(record)}`, "$record");
}
function isAbortFailure(error) {
    return (typeof error === "object" &&
        error !== null &&
        error.reason === "aborted");
}
/** 中止一律上抛为内核错误；其他失败交给调用方按自己的语义处理。 */
function rethrowAbort(error) {
    if (isAbortFailure(error))
        fail("io-failure", "aborted", "$signal", { cause: error });
}
/** 紧凑形 `YYYYMMDDTHHMMSSmmmZ` 还原成 ISO 毫秒形；日期不自洽的合成文件名返回 `null`。 */
function expandCompactInstant(value) {
    const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}.${value.slice(15, 18)}Z`;
    const milliseconds = Date.parse(iso);
    if (!Number.isFinite(milliseconds))
        return null;
    return new Date(milliseconds).toISOString() === iso ? iso : null;
}
/**
 * 早于"截止基准 - 保留期"的记录文件名前缀：与文件名同为定宽紧凑形，可直接比较。基准取
 * `recordedAt` 与本批观察到的另一条最新记录的**较小者**——钉住基准的是目录自己的历史，所以宿主
 * 时钟跳到未来时，一条未来时间的记录只能修剪到与不跳变时相同的那批，D7b 的 30 天损失边界不会被
 * 一次写入越过。基准或结果不可表示（合成文件名、越出四位年份）时返回 `null`，即不修剪。
 */
function retentionCutoffCompact(recordedAt, newestOther) {
    const basis = newestOther < compactInstant(recordedAt) ? expandCompactInstant(newestOther) : recordedAt;
    if (basis === null)
        return null;
    const iso = new Date(Date.parse(basis) - HOST_HOOK_RETENTION_MILLISECONDS).toISOString();
    if (iso.length !== MILLISECOND_INSTANT_LENGTH)
        return null;
    return compactInstant(parseUtcInstant(iso, "$retention"));
}
function isExpiredRecordEntry(entry, cutoff) {
    const match = FILE_NAME_PATTERN.exec(entry.name);
    return match !== null && entry.node.kind === "file" && match[1] < cutoff;
}
/**
 * unlink 一个过期记录文件或被遗弃的暂存文件。修剪是尽力而为且幂等的：崩溃后重现的过期文件在
 * 下一次成功写入时再被修剪，所以不给每个文件付 inode 与父目录两次 fsync——同步 hook 只有几秒
 * 预算，每次退休量受检查预算限制。单个文件的失败只影响它自己；中止上抛。暂存文件若已与
 * 目标记录双链接（创建在两次同步之间被杀），unlink 只让链接数减一，目标记录不受影响。
 */
async function unlinkPrunedHostHookEntry(root, entry, signal) {
    try {
        await unlinkRegularFileExactly(root, entry.resourcePath, {
            expectedNode: entry.node,
            durability: "none",
            ...signal,
        });
    }
    catch (error) {
        rethrowAbort(error);
    }
}
function recognizedRecordLocation(hostId, entry) {
    return (entry.resourcePath === `${hostHookObservationsRootRef(hostId)}/${entry.name}` ||
        entry.resourcePath === partitionedHostHookRef(hostId, entry.name));
}
function isAbandonedStage(entry, cutoff) {
    if (entry.node.modifiedAtNanoseconds >= cutoff)
        return false;
    const address = hostHookStageAddress(entry);
    return address !== null && readDurableAtomicFileStageOwnerState(address) === "inactive";
}
const PROBE_FOUND = Symbol("probe-found");
/**
 * 目录里除刚落地这条之外最新的记录（紧凑时间戳），从最新的一天往回探，命中即停：这是截止基准的
 * 钳位。只看最旧的 4096 个叶子（§13.142 的实现）会把基准钉在陈旧历史上——每天超过约 137 条记录时
 * 永远修剪不到任何东西（gate-log §13.161 H2-01）。根层的旧平铺记录与分片记录都算；只含本条记录
 * 的日目录不算（它是本条自己造出来的，用它做基准会让一次未来时钟的写入越过 D7b 的保留边界）。
 */
async function newestOtherRecordCompact(root, hostId, writtenRef, signal) {
    const probe = { found: null };
    try {
        await visitHostHookDirectory(root, hostId, async (entry) => {
            if (entry.resourcePath === writtenRef || entry.node.kind !== "file")
                return;
            const match = FILE_NAME_PATTERN.exec(entry.name);
            if (match === null || !recognizedRecordLocation(hostId, entry))
                return;
            probe.found = match[1];
            throw PROBE_FOUND;
        }, { ...signal, order: "descending" });
    }
    catch (error) {
        if (error !== PROBE_FOUND)
            throw error;
    }
    return probe.found;
}
/**
 * 空分片或空日目录的回收是尽力而为的：非空、已消失或任何别的失败都只让它留到下一次；和记录退役
 * 一样不做 fsync（一次写入可能回收上千个目录，每个付一次父目录同步会把同步 hook 的预算用光）。
 */
async function removeEmptiedHookDirectory(root, entry, signal) {
    try {
        await removeEmptyDirectoryExactly(root, entry.resourcePath, entry.node, 0o700, signal.signal, "none");
    }
    catch (error) {
        rethrowAbort(error);
    }
}
/**
 * 保留期修剪（§13.97 D7b，§13.161 重写）：基准由 `newestOtherRecordCompact` 钳住，截止日之前的
 * 日目录整个过期，只走它们、根层的旧平铺文件，以及本条记录所在的分片（退休写入器留在那里的
 * 暂存文件）；不再逐日走全部历史，所以 4096 个叶子的检查预算只花在能退役的条目上，积压随后续
 * 写入逐次清完。清空的分片与日目录随手 rmdir，目录数不再随历史无限增长（H2-02）。
 */
async function pruneExpiredHostHookObservations(root, record, resourceRef, signal) {
    try {
        const written = await root.inspectExistingResource(resourceRef, "$record");
        const stageCutoff = written.node.modifiedAtNanoseconds -
            BigInt(HOST_HOOK_ABANDONED_STAGE_MILLISECONDS) * NANOSECONDS_PER_MILLISECOND;
        const newestOther = await newestOtherRecordCompact(root, record.hostId, resourceRef, signal);
        const cutoff = newestOther === null ? null : retentionCutoffCompact(record.recordedAt, newestOther);
        const cutoffDay = cutoff === null ? null : cutoff.slice(0, 8);
        const writtenDay = compactInstant(record.recordedAt).slice(0, 8);
        const writtenShard = record.recordId.slice(0, 2);
        const candidates = [];
        const emptiable = [];
        let inspected = 0;
        try {
            await visitHostHookDirectory(root, record.hostId, async (entry) => {
                if (inspected++ >= PRUNE_MAXIMUM_ENTRIES)
                    throw PRUNE_SCAN_COMPLETE;
                const match = FILE_NAME_PATTERN.exec(entry.name);
                if (match !== null && !recognizedRecordLocation(record.hostId, entry))
                    return;
                if (candidates.length >= PRUNE_MAXIMUM_ENTRIES)
                    return;
                if (cutoff !== null && isExpiredRecordEntry(entry, cutoff))
                    candidates.push(entry);
                else if (isAbandonedStage(entry, stageCutoff))
                    candidates.push(entry);
            }, {
                ...signal,
                selectDay: (day) => (cutoffDay !== null && day < cutoffDay) || day === writtenDay,
                selectShard: (day, shard) => day !== writtenDay || shard === writtenShard,
                onDirectory: (entry, kind) => {
                    // 只有截止日之前、整个过期的日目录才值得回收；本条记录自己的那天不动。
                    if (entry.name !== writtenDay && !entry.resourcePath.includes(`/${writtenDay}/`)) {
                        emptiable.push({ entry, kind });
                    }
                },
            });
        }
        catch (error) {
            if (error !== PRUNE_SCAN_COMPLETE)
                throw error;
        }
        const limit = pLimit(PRUNE_UNLINK_CONCURRENCY);
        const settled = await Promise.allSettled(candidates.map((entry) => limit(unlinkPrunedHostHookEntry, root, entry, signal)));
        for (const result of settled)
            if (result.status === "rejected")
                throw result.reason;
        // 先分片后日目录，和访问顺序相反：一个日目录只有在它的分片都空了之后才会空。
        for (const { entry } of emptiable.filter((item) => item.kind === "shard"))
            await removeEmptiedHookDirectory(root, entry, signal);
        for (const { entry } of emptiable.filter((item) => item.kind === "day"))
            await removeEmptiedHookDirectory(root, entry, signal);
    }
    catch (error) {
        rethrowAbort(error);
    }
}
async function materializeHostHookDirectory(root, resourceRef, signal) {
    try {
        await materializeDirectoryPath(root, parsePortableResourcePath(resourceRef.slice(0, resourceRef.lastIndexOf("/")), "$directory"), {
            mode: DIRECTORY_MODE,
            ...signal,
        });
    }
    catch (error) {
        if (error instanceof DurableDirectoryMaterializationError) {
            fail("io-failure", `observation-directory-${error.reason}`, "$observation", {
                cause: error,
            });
        }
        throw error;
    }
}
/** 创建记录文件；同名已存在时返回 `false`，其他写失败以 `io-failure` 拒绝。 */
async function createHostHookObservationFile(root, resourceRef, document, signal) {
    try {
        await createFileAtomically(root, resourceRef, encodeUtf8(document, "$record"), {
            mode: FILE_MODE,
            ...signal,
        });
        return true;
    }
    catch (error) {
        if (error instanceof DurableAtomicFileWriteError && error.reason === "target-exists") {
            return false;
        }
        if (error instanceof DurableAtomicFileWriteError) {
            fail("io-failure", `observation-write-${error.reason}`, "$observation", { cause: error });
        }
        throw error;
    }
}
/**
 * 写入一条记录：同一事实重复写入返回 `current`，同名不同内容拒绝。只有新落地一条记录（`created`）
 * 才按龄修剪同一宿主目录（§13.97 D7b）——`current` 没有新证据落地，修剪不会有新结果，而 hook 事件
 * 在 D5 下是同步的，不该为一次重复触发再列举一遍整个目录。
 */
export async function writeHostHookObservation(root, input, options = {}) {
    const record = createHostHookObservation(input);
    let resourceRef = partitionedHostHookRef(record.hostId, hostHookObservationFileName(record));
    const signal = options.signal === undefined ? {} : { signal: options.signal };
    const document = renderHostHookObservation(record);
    // A retry of a legacy observation stays in place; no migration or duplicate copy.
    const legacyRef = legacyHostHookObservationRef(record);
    try {
        await root.inspectExistingResource(legacyRef, "$record");
        resourceRef = legacyRef;
    }
    catch (error) {
        if (!(error instanceof RootedDirectoryError) || error.reason !== "resource-not-found")
            throw error;
    }
    try {
        const existing = await readDeterministicJsonFile(root, resourceRef, {
            maximumBytes: RECORD_MAXIMUM_BYTES,
            ...signal,
        });
        if (!sameObservationDocument(existing.value, document))
            fail("precondition-failed", "observation-conflict", "$observation");
        return Object.freeze({ record, resourceRef, disposition: "current" });
    }
    catch (error) {
        if (!(error instanceof StableFileReadError) || error.reason !== "not-found")
            throw error;
    }
    await materializeHostHookDirectory(root, resourceRef, signal);
    let disposition = "created";
    if (!(await createHostHookObservationFile(root, resourceRef, document, signal))) {
        const existing = await readDeterministicJsonFile(root, resourceRef, {
            maximumBytes: RECORD_MAXIMUM_BYTES,
            ...signal,
        });
        if (!sameObservationDocument(existing.value, document)) {
            fail("precondition-failed", "observation-conflict", "$observation");
        }
        disposition = "current";
    }
    if (disposition === "created")
        await pruneExpiredHostHookObservations(root, record, resourceRef, signal);
    return Object.freeze({ record, resourceRef, disposition });
}
function namePrefilter(name, filter) {
    const match = FILE_NAME_PATTERN.exec(name);
    if (match === null)
        return null;
    const event = match[2];
    const compact = match[1];
    if (filter.event !== undefined && event !== filter.event)
        return null;
    if (filter.since !== undefined && compact < compactInstant(filter.since))
        return null;
    return Object.freeze({ event, compact });
}
/** 列举后读取前已不存在的候选：不是证据通道的损坏，不计入 `skipped`（§13.97 D7c）。 */
const VANISHED = Symbol("vanished");
/**
 * 判定候选读取失败是否因为文件已经消失：`not-found` 直接成立；`expectation-changed` 再看一眼
 * 路径，节点已不在也成立（列举到读取之间被修剪）。中止一律上抛。
 */
async function candidateVanished(root, candidate, error) {
    rethrowAbort(error);
    if (!(error instanceof StableFileReadError))
        return false;
    if (error.reason === "not-found")
        return true;
    if (error.reason !== "expectation-changed")
        return false;
    try {
        await root.inspectExistingResource(candidate.entry.resourcePath, "$candidate");
        return false;
    }
    catch (inspection) {
        if (inspection instanceof RootedDirectoryError && inspection.reason === "resource-not-found") {
            return true;
        }
        return false;
    }
}
/**
 * 读取一个候选文件；内容不可用、宿主不符或文件名与记录不一致都返回 `null`，列举后已消失返回
 * `VANISHED`。
 */
async function readCandidateRecord(root, hostId, candidate, signal, readRoot = root) {
    let record;
    try {
        const read = await readDeterministicJsonFile(readRoot, readRoot === root
            ? candidate.entry.resourcePath
            : parsePortableResourcePath(candidate.entry.name), {
            maximumBytes: RECORD_MAXIMUM_BYTES,
            expectedNode: candidate.entry.node,
            ...signal,
        });
        record = parseHostHookObservation(parseDeterministicJsonDocument(read.text, "$record"));
    }
    catch (error) {
        return (await candidateVanished(root, candidate, error)) ? VANISHED : null;
    }
    if (record.hostId !== hostId ||
        (legacyHostHookObservationRef(record) !== candidate.entry.resourcePath &&
            partitionedHostHookRef(hostId, hostHookObservationFileName(record)) !==
                candidate.entry.resourcePath)) {
        return null;
    }
    return record;
}
/** 结果上限缺省 256，上限 16,384；扫描不会因达到结果上限而冒充完整。 */
function readLimit(filter) {
    const limit = filter.limit ?? DEFAULT_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > HOST_HOOK_RECORDS_MAXIMUM) {
        fail("invalid-request", "hook-limit", "$filter.limit");
    }
    return limit;
}
/** 外来文件名：计入 skipped，不阻断证据查询。 */
const FOREIGN = Symbol("foreign");
/** 记录命名但读不出，或叶子位置上的目录 / 链接：可能藏着记录，计入 skipped 与 unreadable。 */
const UNREADABLE = Symbol("unreadable");
// Finder、编辑器等留下的点文件不是证据通道的问题；Wakeflow 自己的暂存前缀除外。
const IGNORED_FOREIGN_NAME_PATTERN = /^\.(?!wakeflow-)/u;
async function scanEntry(root, hostId, entry, filter, signal, recordId, readRoot = root) {
    const match = FILE_NAME_PATTERN.exec(entry.name);
    if (match === null) {
        if (hostHookStageAddress(entry) !== null)
            return null;
        if (entry.node.kind !== "file")
            return UNREADABLE;
        return IGNORED_FOREIGN_NAME_PATTERN.test(entry.name) ? null : FOREIGN;
    }
    if (recordId !== undefined && match[3] !== recordId)
        return null;
    const prefilter = namePrefilter(entry.name, filter);
    if (prefilter === null)
        return null;
    const record = await readCandidateRecord(root, hostId, { entry, event: prefilter.event }, signal, readRoot);
    if (record === VANISHED)
        return null;
    if (record === null)
        return UNREADABLE;
    return filter.sessionId === undefined || filter.sessionId === record.sessionId ? record : null;
}
/**
 * Anchor a small batch to its already-verified parent. This avoids re-walking
 * every workspace-relative ancestor for every file while preserving no-follow
 * reads, file snapshots and parent identity checks before and after the batch.
 */
async function scanScopedBatch(root, hostId, entries, filter, signal, recordId) {
    if (entries.length < 4) {
        return Promise.allSettled(entries.map((entry) => scanEntry(root, hostId, entry, filter, signal, recordId)));
    }
    const directoryRef = parsePortableResourcePath(entries[0].resourcePath.replace(/\/[^/]+$/u, ""));
    const parent = await root.inspectExistingResource(directoryRef, "$hooks");
    const scoped = await RootedDirectory.open(parent.physicalPath, "$hooks");
    try {
        if (!sameFileNodeIdentity(parent.node, await scoped.assertCurrent("$hooks")))
            fail("io-failure", "observation-scope-changed", "$hooks");
        const results = await Promise.allSettled(entries.map((entry) => scanEntry(root, hostId, entry, filter, signal, recordId, scoped)));
        const after = await root.inspectExistingResource(directoryRef, "$hooks");
        if (!sameFileNodeIdentity(parent.node, after.node))
            fail("io-failure", "observation-scope-changed", "$hooks");
        return results;
    }
    finally {
        await scoped.close();
    }
}
async function scanEntryBatch(root, hostId, entries, filter, signal, recordId) {
    const groups = new Map();
    const immediate = [];
    for (const entry of entries) {
        const match = FILE_NAME_PATTERN.exec(entry.name);
        if (match === null ||
            namePrefilter(entry.name, filter) === null ||
            (recordId !== undefined && match[3] !== recordId)) {
            immediate.push(entry);
            continue;
        }
        const key = entry.resourcePath.slice(0, entry.resourcePath.lastIndexOf("/"));
        const group = groups.get(key) ?? [];
        group.push(entry);
        groups.set(key, group);
    }
    const immediateResults = await Promise.allSettled(immediate.map((entry) => scanEntry(root, hostId, entry, filter, signal, recordId)));
    const groupsSettled = await Promise.allSettled([...groups.values()].map((group) => scanScopedBatch(root, hostId, group, filter, signal, recordId)));
    const results = [...immediateResults];
    for (const group of groupsSettled) {
        if (group.status === "rejected")
            throw group.reason;
        results.push(...group.value);
    }
    return results;
}
/** Full, bounded-memory scan. Callers discard their local aggregates if it rejects. */
async function scanObservations(root, hostIdValue, filter, visit, options = {}, onListed = null, recordId) {
    const hostId = parseWakeflowHostId(hostIdValue);
    let records = 0;
    let skipped = 0;
    let unreadable = 0;
    let observed = false;
    const signal = options.signal === undefined ? {} : { signal: options.signal };
    const pending = [];
    const flush = async () => {
        const settled = await scanEntryBatch(root, hostId, pending.splice(0), filter, signal, recordId);
        for (const result of settled) {
            if (result.status === "rejected")
                throw result.reason;
            const record = result.value;
            if (record === FOREIGN)
                skipped += 1;
            else if (record === UNREADABLE) {
                skipped += 1;
                unreadable += 1;
            }
            else if (record !== null) {
                records += 1;
                visit(record);
            }
        }
    };
    try {
        await visitHostHookDirectory(root, hostId, async (entry) => {
            if (!observed) {
                observed = true;
                if (onListed !== null)
                    await onListed();
            }
            pending.push(entry);
            if (pending.length >= 8)
                await flush();
        }, {
            ...signal,
            ...(filter.since === undefined
                ? {}
                : { sinceDay: compactInstant(filter.since).slice(0, 8) }),
            ...(recordId === undefined ? {} : { recordId }),
        });
        await flush();
    }
    catch (error) {
        rethrowAbort(error);
        if (error instanceof RootedDirectoryError) {
            fail("io-failure", `observation-scope-${error.reason}`, "$observations", { cause: error });
        }
        if (error instanceof StableDirectoryReadError) {
            fail("io-failure", `observation-listing-${error.reason}`, "$observations", { cause: error });
        }
        throw error;
    }
    return Object.freeze({ records, skipped, unreadable });
}
/** Complete streaming scan; a callback only builds disposable local aggregates. */
export async function scanHostHookObservations(root, hostId, filter, visit, options = {}) {
    return scanObservations(root, hostId, filter, visit, options);
}
async function readObservations(root, hostIdValue, filter, options, onListed) {
    const limit = readLimit(filter);
    const records = [];
    const compare = (a, b) => hostHookObservationFileName(a).localeCompare(hostHookObservationFileName(b));
    const scan = await scanObservations(root, hostIdValue, filter, (record) => {
        if (records.length === limit &&
            compare(record, records[records.length - 1]) >= 0)
            return;
        let low = 0;
        let high = records.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (compare(records[middle], record) < 0)
                low = middle + 1;
            else
                high = middle;
        }
        records.splice(low, 0, record);
        if (records.length > limit)
            records.pop();
    }, options, onListed);
    return Object.freeze({
        records: Object.freeze(records),
        skipped: scan.skipped,
        unreadable: scan.unreadable,
        complete: scan.records <= limit,
    });
}
/** 有界读取一个宿主的记录；无法读入的条目只计数，不让证据通道整体失败。 */
export async function readHostHookObservations(root, hostIdValue, filter = {}, options = {}) {
    return readObservations(root, hostIdValue, filter, options, null);
}
/**
 * 与 `readHostHookObservations` 走同一条读取路径，只是在第一页候选即将读取之前调用一次
 * `onListed`：内核测试用它确定性地复现"观察期间被修剪"的并发（§13.97 D7c）。观察点留在这个单独
 * 命名的导出里，`readHostHookObservations` 的选项因此保持 §13.97 定下的形状，生产调用方既传不进
 * 回调，也不会顺手把带回调的选项对象透传下去。
 */
export async function readHostHookObservationsInterleaved(root, hostIdValue, filter, onListed, options = {}) {
    return readObservations(root, hostIdValue, filter, options, onListed);
}
/** 按记录标识读取一个宿主的一条记录；目录或记录不存在、内容不可用都返回 `null`。 */
export async function readHostHookObservationRecord(root, hostIdValue, recordId, options = {}) {
    const hostId = parseWakeflowHostId(hostIdValue);
    const signal = options.signal === undefined ? {} : { signal: options.signal };
    let found = null;
    await scanObservations(root, hostId, {}, (record) => {
        found = record;
    }, signal, null, recordId);
    if (found === null)
        return null;
    const record = found;
    for (const ref of [
        legacyHostHookObservationRef(record),
        partitionedHostHookRef(hostId, hostHookObservationFileName(record)),
    ]) {
        try {
            const read = await readDeterministicJsonFile(root, ref, {
                maximumBytes: RECORD_MAXIMUM_BYTES,
                ...signal,
            });
            const parsed = parseHostHookObservation(parseDeterministicJsonDocument(read.text, "$record"));
            if (parsed.recordId !== recordId || parsed.hostId !== hostId)
                return null;
            return Object.freeze({
                record: parsed,
                digest: read.digest,
                byteCount: Number(read.byteCount),
            });
        }
        catch (error) {
            rethrowAbort(error);
            if (!(error instanceof StableFileReadError) || error.reason !== "not-found")
                return null;
        }
    }
    return null;
}
