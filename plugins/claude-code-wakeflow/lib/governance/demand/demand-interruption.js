import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import { parsePortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { readStableResourceDirectory, StableDirectoryReadError, } from "../../foundation/filesystem/stable-directory-read.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { fail, WakeflowError } from "../../kernel/error.js";
import { demandLifecycleJournalRef } from "../../kernel/layout.js";
import { DEMAND_RECOVERY_TOOLS } from "../../kernel/next-projection.js";
import { MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF } from "../evidence/managed-evidence-resource-paths.js";
import { locateLatestDemandArchive } from "../observation/demand-archive-locator.js";
import { TASK_PACKAGE_PROJECTIONS_ROOT_REF } from "../tasking/task-package-projection-paths.js";
import { DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF, DEMAND_EVENT_SOURCING_ARTIFACTS_ROOT_REF, DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF, DEMAND_EVENT_SOURCING_TRANSACTIONS_ROOT_REF, DEMAND_EVENT_STREAM_COMMITS_ROOT_REF, DEMAND_EVENT_STREAM_INDEX_ROOT_REF, } from "./event-sourcing/demand-event-sourcing-paths.js";
import { DEMAND_PUBLICATION_MARKER_REF, demandFinalRootRef, } from "./publication/demand-publication-paths.js";
export const DEMAND_LIFECYCLE_JOURNAL_KIND = "WakeflowDemandLifecycleJournal";
export const DEMAND_LIFECYCLE_JOURNAL_MAXIMUM_BYTES = parseByteCount(4 * 1024 * 1024, "$journal.maximumBytes");
/**
 * 归档负载里没有、恢复时补齐的空目录。continue 放回根之后逐个补建；少了其中一个的根打不开，而补建
 * 正是 continue recover 的最后一段。
 */
export const DEMAND_REBUILDABLE_DIRECTORY_REFS = Object.freeze([
    DEMAND_EVENT_STREAM_COMMITS_ROOT_REF,
    DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF,
    DEMAND_EVENT_STREAM_INDEX_ROOT_REF,
    DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF,
    DEMAND_EVENT_SOURCING_ARTIFACTS_ROOT_REF,
    TASK_PACKAGE_PROJECTIONS_ROOT_REF,
    DEMAND_EVENT_SOURCING_TRANSACTIONS_ROOT_REF,
]);
const APPEND_CANDIDATES_MAXIMUM_ENTRIES = 4096;
/** 接手这条恢复路径的公共工具。 */
export function demandRecoveryTool(route) {
    return route.kind === "lifecycle"
        ? DEMAND_RECOVERY_TOOLS[route.action]
        : DEMAND_RECOVERY_TOOLS[route.kind];
}
/** 这条恢复路径对应的拒绝原因；status 与 verify 把它放进 blockers。 */
export function demandRecoveryReason(route) {
    if (route.kind === "publication")
        return "demand-publication";
    if (route.kind === "evidence")
        return "evidence-publication-pending";
    if (route.kind === "append-candidates")
        return "append-candidates-pending";
    return "lifecycle-journal-pending";
}
function isAborted(error) {
    if (error instanceof WakeflowError)
        return error.reason === "aborted";
    return (typeof error === "object" && error !== null && "reason" in error && error.reason === "aborted");
}
function rethrowAborted(error) {
    if (isAborted(error))
        fail("io-failure", "aborted", "$signal", { cause: error });
}
/** 节点种类；不在为 null，看不清为 "unreadable"。 */
async function nodeKind(workspaceRoot, ref) {
    try {
        return (await workspaceRoot.inspectExistingResource(ref, "$demandRoot")).node.kind;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError && error.reason === "resource-not-found")
            return null;
        return "unreadable";
    }
}
function inDemandRoot(demandId, ref) {
    return parsePortableResourcePath(`${demandFinalRootRef(demandId)}/${ref}`, "$demandRoot");
}
async function hasAppendCandidates(workspaceRoot, demandId, signal) {
    try {
        const listing = await readStableResourceDirectory(workspaceRoot, inDemandRoot(demandId, DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF), {
            maximumEntries: APPEND_CANDIDATES_MAXIMUM_ENTRIES,
            ...(signal === undefined ? {} : { signal }),
        });
        return listing.entries.length > 0;
    }
    catch (error) {
        rethrowAborted(error);
        return error instanceof StableDirectoryReadError && error.reason === "too-many-entries";
    }
}
function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value
        : null;
}
/** 这个 Demand 名下的生命周期日志；不在、读不出、不是这个 Demand 的或动作不认识，都是 null。 */
async function readPendingJournal(workspaceRoot, demandId, signal) {
    let value;
    try {
        const read = await readDeterministicJsonFile(workspaceRoot, demandLifecycleJournalRef(demandId), {
            maximumBytes: DEMAND_LIFECYCLE_JOURNAL_MAXIMUM_BYTES,
            ...(signal === undefined ? {} : { signal }),
        });
        value = read.value;
    }
    catch (error) {
        rethrowAborted(error);
        return null;
    }
    const journal = record(value);
    const plan = record(journal?.plan);
    if (journal?.kind !== DEMAND_LIFECYCLE_JOURNAL_KIND || plan === null)
        return null;
    if (plan.demandId !== demandId)
        return null;
    const action = plan.action;
    if (action !== "complete" && action !== "cancel" && action !== "continue")
        return null;
    return { action, eventId: typeof plan.eventId === "string" ? plan.eventId : null };
}
/** 最近的归档是这份终态计划封的：结局相符，终态事件就是计划里的那一个。 */
async function latestArchiveBound(ledgerRoot, demandId, journal, signal) {
    try {
        const located = await locateLatestDemandArchive(ledgerRoot, demandId, signal);
        return (located !== null &&
            journal.eventId !== null &&
            located.outcome === (journal.action === "complete" ? "completed" : "cancelled") &&
            located.terminalEvent.eventId === journal.eventId);
    }
    catch (error) {
        rethrowAborted(error);
        return false;
    }
}
async function rebuildableDirectoryMissing(workspaceRoot, demandId) {
    for (const directory of DEMAND_REBUILDABLE_DIRECTORY_REFS) {
        if ((await nodeKind(workspaceRoot, inDemandRoot(demandId, directory))) === null)
            return true;
    }
    return false;
}
/**
 * 生命周期日志点出的出口。
 * - continue：根不在（还没放回）或根能打开且是 completed（放回了、事件还没追加）或 active（事件已追加、
 *   认领还没回来）时接手；根打不开时只在少了可重建目录的情形接手，别的打不开不是它能治的。
 * - complete / cancel：根能打开时只在生命周期已经是这个动作的终态时接手。根还是 active 说明终态事件
 *   没有提交，日志只是一份没有生效的意图：点名 recover 会去提交那份旧计划，流若已经前进它又会一直以
 *   `stream-advanced` 拒绝；下一次完成、取消或续接自己会改写这份日志。根不在或打不开时，只在最近的
 *   归档就是这份计划封的时候接手（recover 走残根清除，不再打开根）。
 */
async function continueJournalApplies(workspaceRoot, demandId, reading) {
    if (reading.root === "absent")
        return true;
    if (reading.root === "loads")
        return reading.lifecycle !== "cancelled";
    return rebuildableDirectoryMissing(workspaceRoot, demandId);
}
async function terminalJournalApplies(ledgerRoot, demandId, journal, reading, signal) {
    if (reading.root === "loads") {
        return reading.lifecycle === (journal.action === "complete" ? "completed" : "cancelled");
    }
    return latestArchiveBound(ledgerRoot, demandId, journal, signal);
}
async function lifecycleRoute(workspaceRoot, ledgerRoot, demandId, reading, signal) {
    const journal = await readPendingJournal(workspaceRoot, demandId, signal);
    if (journal === null)
        return null;
    const applies = journal.action === "continue"
        ? await continueJournalApplies(workspaceRoot, demandId, reading)
        : await terminalJournalApplies(ledgerRoot, demandId, journal, reading, signal);
    return applies ? Object.freeze({ kind: "lifecycle", action: journal.action }) : null;
}
/** 这个 Demand 停在哪一个被打断的事务上；没有就是 null。只读。 */
export async function inspectDemandRecoveryRoute(workspaceRoot, ledgerRoot, demandId, reading, options = {}) {
    if (options.signal?.aborted === true)
        fail("io-failure", "aborted", "$signal");
    if (reading.root !== "absent") {
        if ((await nodeKind(workspaceRoot, inDemandRoot(demandId, DEMAND_PUBLICATION_MARKER_REF))) ===
            "file") {
            return Object.freeze({ kind: "publication" });
        }
    }
    if (reading.root === "unloadable" &&
        (await hasAppendCandidates(workspaceRoot, demandId, options.signal))) {
        return Object.freeze({ kind: "append-candidates" });
    }
    if (reading.root !== "absent") {
        const evidence = inDemandRoot(demandId, MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF);
        if ((await nodeKind(workspaceRoot, evidence)) === "file") {
            return Object.freeze({ kind: "evidence" });
        }
    }
    return lifecycleRoute(workspaceRoot, ledgerRoot, demandId, reading, options.signal);
}
