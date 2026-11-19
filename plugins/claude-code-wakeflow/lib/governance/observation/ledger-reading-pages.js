import { createFileAtomically, DurableAtomicFileWriteError, replaceFileAtomically, } from "../../foundation/filesystem/durable-atomic-file-write.js";
import { DurableAtomicFileStageRecoveryError, recoverDurableAtomicFileStagesMatchingTargets, } from "../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import { StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import { readStrictTextFile, StrictTextFileError, } from "../../foundation/filesystem/strict-text-file.js";
import { signalOptions } from "../../foundation/node/abort-signal.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { fail, WakeflowError } from "../../kernel/error.js";
import { demandArchivePageRef, LEDGER_HISTORY_INDEX_REF } from "../../kernel/layout.js";
import { createLedgerReadingPageResourceDeclaration } from "../ledger/ledger-resource-catalog.js";
import { readArchivedReviewSnapshot } from "./archived-demand-observation.js";
import { countDemandArchiveEvidence, listArchivedDemandIds, locateLatestDemandArchive, readDemandArchiveEvents, readDemandArchiveIdentity, } from "./demand-archive-locator.js";
import { measureDemandArchiveEvents } from "./demand-archive-measures.js";
import { buildDemandArchivePageFacts, DEMAND_ARCHIVE_PAGE_COMPACT_LIMITS, demandArchivePageHistoryOf, demandArchiveSessionPromptsOf, demandArchivePageLine, demandArchivePageMarker, renderDemandArchivePage, } from "./demand-archive-page.js";
function readingPageTarget(declarationId, resourcePath) {
    const declaration = createLedgerReadingPageResourceDeclaration(declarationId, resourcePath);
    if (declaration.nodePolicy.kind !== "file") {
        fail("unexpected", "reading-page-declaration", "$ledger/page");
    }
    return Object.freeze({
        declaration,
        resourcePath,
        mode: Number.parseInt(declaration.nodePolicy.mode, 8),
    });
}
/** 历史索引：tracked、0644、由归档确定地重写。 */
const HISTORY_INDEX_TARGET = readingPageTarget("ledger.history-index", LEDGER_HISTORY_INDEX_REF);
/** 一个归档旁边的 Demand 页；路径是 `archives/<demandId>/<修订号>.md`。 */
function archivePageTarget(pageRef) {
    const [, demandId, file] = pageRef.split("/");
    return readingPageTarget(`ledger.archive-page.${demandId ?? ""}.${(file ?? "").replace(/\.md$/u, "")}`, pageRef);
}
const HISTORY_MAXIMUM_BYTES = parseByteCount(4 * 1024 * 1024, "$history.maximumBytes");
const PAGE_MAXIMUM_BYTES = parseByteCount(512 * 1024, "$archivePage.maximumBytes");
const HISTORY_CELL_MAXIMUM_CODE_POINTS = 120;
const REFRESH_ATTEMPTS = 3;
/** 一次刷新最多新渲染多少页：每页要重读那份归档的全部事件提交。 */
const LEDGER_READING_PAGES_DEFAULT_RENDER_LIMIT = 8;
/** 维护 apply 之后的刷新用它：升级后第一次维护就把旧归档的页面补齐。 */
export const LEDGER_READING_PAGES_MAINTENANCE_RENDER_LIMIT = 512;
const HISTORY_TEXT = Object.freeze({
    en: Object.freeze({
        title: "# Wakeflow Demand history",
        notice: "Generated from the archives under `archives/`: one row per archived Demand, newest first. A Demand that was continued stays listed by its latest sealed archive. Do not edit by hand.",
        header: "| Archived | Demand | Type | Outcome | Page |",
        empty: "No Demand has been archived yet.",
        untitled: "(no title recorded)",
    }),
    "zh-Hans": Object.freeze({
        title: "# Wakeflow Demand 历史",
        notice: "本文件由 `archives/` 下的归档包生成：每个归档过的 Demand 一行，新的在前。被续接的 Demand 仍按它最近一次封存的归档列出。请勿手改。",
        header: "| 归档时间 | Demand | 类型 | 结局 | 页面 |",
        empty: "还没有归档过的 Demand。",
        untitled: "（没有记录标题）",
    }),
});
function historyMarker(language) {
    return `<!-- wakeflow:ledger-history:v1:${language} -->`;
}
/** 新的在前；同一时刻按 Demand 标识，保证字节确定。 */
function newestFirst(left, right) {
    if (left.archivedAt !== right.archivedAt)
        return left.archivedAt < right.archivedAt ? 1 : -1;
    return left.demandId < right.demandId ? -1 : left.demandId > right.demandId ? 1 : 0;
}
/** 渲染历史索引；`entries` 的顺序不影响结果。 */
export function renderLedgerHistoryIndex(entries, language) {
    const text = HISTORY_TEXT[language];
    const rows = [...entries].sort(newestFirst).map((entry) => {
        const title = entry.title === ""
            ? text.untitled
            : demandArchivePageLine(entry.title, HISTORY_CELL_MAXIMUM_CODE_POINTS);
        const page = entry.pageCurrent
            ? `[\`${entry.demandId}\`](archives/${entry.demandId}/${entry.revision}.md)`
            : `\`${entry.demandId}\``;
        return `| ${entry.archivedAt} | ${title} | ${entry.demandType ?? "—"} | ${entry.outcome} | ${page} |`;
    });
    return `${[
        text.title,
        "",
        historyMarker(language),
        "",
        `> ${text.notice}`,
        "",
        ...(rows.length === 0
            ? [text.empty]
            : [text.header, "| --- | --- | --- | --- | --- |", ...rows]),
    ].join("\n")}\n`;
}
// ---- 读与写 --------------------------------------------------------------------
async function readPageOrNull(ledgerRoot, resourcePath, maximumBytes, signal) {
    try {
        return await readStrictTextFile(ledgerRoot, resourcePath, {
            maximumBytes: parseByteCount(maximumBytes, "$page.maximumBytes"),
            ...signalOptions(signal),
        });
    }
    catch (error) {
        if (error instanceof StableFileReadError) {
            if (error.reason === "not-found")
                return null;
            if (error.reason === "aborted")
                fail("io-failure", "aborted", "$signal", { cause: error });
            fail("io-failure", `reading-page-read-${error.reason}`, "$ledger", { cause: error });
        }
        if (error instanceof StrictTextFileError) {
            fail("io-failure", `reading-page-read-${error.reason}`, "$ledger", { cause: error });
        }
        throw error;
    }
}
/** 崩溃留下的、属于这个目标的写入暂存先退休：否则之后每一次写都被基础层拒绝。 */
async function settleStage(ledgerRoot, resourcePath, signal) {
    try {
        await recoverDurableAtomicFileStagesMatchingTargets(ledgerRoot, [resourcePath], signalOptions(signal));
    }
    catch (error) {
        if (error instanceof DurableAtomicFileStageRecoveryError) {
            if (error.reason === "aborted")
                fail("io-failure", "aborted", "$signal", { cause: error });
            fail("io-failure", "reading-page-stage", "$ledger", { cause: error });
        }
        throw error;
    }
}
/** 让磁盘上的文件等于 `document`；`current` 是先前读到的那一份（没有即 null），中间变过即失败。 */
async function publishPage(ledgerRoot, target, document, current, signal) {
    if (current !== null && current.text === document)
        return "current";
    const { resourcePath, mode } = target;
    const bytes = encodeUtf8(document, "$ledger/page");
    await settleStage(ledgerRoot, resourcePath, signal);
    try {
        if (current === null) {
            await createFileAtomically(ledgerRoot, resourcePath, bytes, {
                mode,
                ...signalOptions(signal),
            });
        }
        else {
            await replaceFileAtomically(ledgerRoot, resourcePath, bytes, {
                mode,
                expected: {
                    resourcePath: current.resourcePath,
                    node: current.node,
                    byteCount: current.byteCount,
                    digest: current.digest,
                },
                ...signalOptions(signal),
            });
        }
    }
    catch (error) {
        if (error instanceof DurableAtomicFileWriteError) {
            if (error.reason === "aborted")
                fail("io-failure", "aborted", "$signal", { cause: error });
            fail("io-failure", `reading-page-write-${error.reason}`, "$ledger", { cause: error });
        }
        throw error;
    }
    return "written";
}
/** 写的那一刻目标被别人先写了（同一份归档的页面，或另一轮刷新的索引）。 */
function isWriteRace(error) {
    return (error instanceof WakeflowError &&
        (error.reason === "reading-page-write-expectation-changed" ||
            error.reason === "reading-page-write-stage-changed" ||
            error.reason === "reading-page-write-target-exists"));
}
function isAborted(error) {
    return error instanceof WakeflowError && error.reason === "aborted";
}
/** 归档里的评审历史；读不出为 null（页面照样渲染，只说明这一部分读不出）。中止上抛。 */
async function readHistoryOrNull(ledgerRoot, archiveRef, events, signal) {
    try {
        return demandArchivePageHistoryOf(await readArchivedReviewSnapshot(ledgerRoot, archiveRef, signal), demandArchiveSessionPromptsOf(events));
    }
    catch (error) {
        const reason = typeof error === "object" && error !== null
            ? error.reason
            : undefined;
        if (typeof reason !== "string")
            throw error;
        if (reason === "aborted")
            fail("io-failure", "aborted", "$signal", { cause: error });
        return null;
    }
}
/**
 * 一份归档的页面正文：超过上限就用短的那一档再渲染一次，还超就不出这一页（返回 null，索引里那一行
 * 不给链接）。不为它设拒绝原因：这条路没有调用方会看到。
 */
async function renderArchivePage(ledgerRoot, summary, language, signal) {
    const read = await readDemandArchiveEvents(ledgerRoot, summary.archiveRef, signal);
    const facts = buildDemandArchivePageFacts({
        summary,
        identity: await readDemandArchiveIdentity(ledgerRoot, summary.archiveRef, signal),
        evidenceCount: await countDemandArchiveEvidence(ledgerRoot, summary.archiveRef, signal),
        history: await readHistoryOrNull(ledgerRoot, summary.archiveRef, read.events, signal),
        measures: read.eventCommits === 0 ? null : measureDemandArchiveEvents(read.events, read.eventCommits),
    });
    const full = renderDemandArchivePage(facts, language);
    if (encodeUtf8(full, "$ledger/page").byteLength <= PAGE_MAXIMUM_BYTES)
        return full;
    const compact = renderDemandArchivePage(facts, language, DEMAND_ARCHIVE_PAGE_COMPACT_LIMITS);
    return encodeUtf8(compact, "$ledger/page").byteLength <= PAGE_MAXIMUM_BYTES ? compact : null;
}
/** 每个归档过的 Demand 最近的一份归档；读不出的只计数。 */
async function locateCandidates(ledgerRoot, signal) {
    const candidates = [];
    let unreadable = 0;
    for (const demandId of await listArchivedDemandIds(ledgerRoot, signal)) {
        try {
            const summary = await locateLatestDemandArchive(ledgerRoot, demandId, signal);
            if (summary === null)
                continue;
            const identity = await readDemandArchiveIdentity(ledgerRoot, summary.archiveRef, signal);
            candidates.push({
                summary,
                title: identity.title,
                demandType: identity.demandType,
                pageRef: demandArchivePageRef(summary.archiveRef),
            });
        }
        catch (error) {
            if (!(error instanceof WakeflowError) || isAborted(error))
                throw error;
            unreadable += 1;
        }
    }
    return { candidates, unreadable };
}
/** 一份归档的页面：标记没变即当前；否则在上限之内渲染并写入。返回这一页此刻是不是当前渲染。 */
async function ensurePage(ledgerRoot, candidate, options, budget) {
    const { language, signal } = options;
    const existing = await readPageOrNull(ledgerRoot, candidate.pageRef, PAGE_MAXIMUM_BYTES, signal);
    const marker = demandArchivePageMarker(language, candidate.summary.manifestDigest);
    if (existing?.text.includes(marker) === true)
        return true;
    if (budget.remaining <= 0)
        return false;
    budget.remaining -= 1;
    const document = await renderArchivePage(ledgerRoot, candidate.summary, language, signal);
    if (document === null)
        return false;
    try {
        await publishPage(ledgerRoot, archivePageTarget(candidate.pageRef), document, existing, signal);
    }
    catch (error) {
        // 另一轮刷新先写了同一份归档的页面：同一份归档渲染出同样的字节，算当前。
        if (!isWriteRace(error))
            throw error;
    }
    budget.written += 1;
    return true;
}
async function ensurePageQuietly(ledgerRoot, candidate, options, budget) {
    try {
        return await ensurePage(ledgerRoot, candidate, options, budget);
    }
    catch (error) {
        // 一页渲染或写入失败不拖累别的页与索引；中止与编程错误照常上抛。
        if (!(error instanceof WakeflowError) || isAborted(error) || error.code === "unexpected") {
            throw error;
        }
        return false;
    }
}
async function refreshOnce(ledgerRoot, options) {
    const { language, signal } = options;
    // 先读现有索引、再列归档：之后的替换按这一刻读到的那份做，期间别人写过即重来。
    const currentHistory = await readPageOrNull(ledgerRoot, LEDGER_HISTORY_INDEX_REF, HISTORY_MAXIMUM_BYTES, signal);
    const { candidates, unreadable } = await locateCandidates(ledgerRoot, signal);
    const ordered = [...candidates].sort((left, right) => {
        const preferred = Number(right.summary.demandId === options.preferDemandId) -
            Number(left.summary.demandId === options.preferDemandId);
        return preferred !== 0 ? preferred : newestFirst(left.summary, right.summary);
    });
    const budget = {
        remaining: options.renderLimit ?? LEDGER_READING_PAGES_DEFAULT_RENDER_LIMIT,
        written: 0,
    };
    const entries = [];
    for (const candidate of ordered) {
        const pageCurrent = await ensurePageQuietly(ledgerRoot, candidate, options, budget);
        entries.push({
            demandId: candidate.summary.demandId,
            revision: candidate.summary.archiveRef.slice(candidate.summary.archiveRef.lastIndexOf("/") + 1),
            title: candidate.title,
            demandType: candidate.demandType,
            outcome: candidate.summary.outcome,
            archivedAt: candidate.summary.archivedAt,
            pageCurrent,
        });
    }
    // 没有归档、也没有旧索引：不在账本里凭空放一个文件。
    const historyWritten = entries.length === 0 && currentHistory === null
        ? false
        : (await publishPage(ledgerRoot, HISTORY_INDEX_TARGET, renderLedgerHistoryIndex(entries, language), currentHistory, signal)) === "written";
    return Object.freeze({
        demands: entries.length,
        pagesWritten: budget.written,
        pagesPending: entries.filter((entry) => !entry.pageCurrent).length,
        historyWritten,
        unreadable,
    });
}
/**
 * 重算账本里的历史索引与缺失或过期的 Demand 页面。失败带稳定原因（`reading-page-…`、`archive-list-…`），
 * 调用方通常用静默版本：投影失败不能否定一个已经提交的归档。
 */
export async function refreshLedgerReadingPages(ledgerRoot, options) {
    for (let attempt = 1;; attempt += 1) {
        try {
            return await refreshOnce(ledgerRoot, options);
        }
        catch (error) {
            if (!isWriteRace(error) || attempt >= REFRESH_ATTEMPTS)
                throw error;
        }
    }
}
/**
 * 静默刷新：吞掉已归类的 Wakeflow 失败，中止也在内——归档已经封存，一次被取消或写不成的刷新不能把
 * 已提交的终态事务变成失败，页面下一次刷新自会补上。`unexpected`（没人认领的错误，也就是编程错误的
 * 出口）与非 Wakeflow 的错误上抛。
 */
export async function refreshLedgerReadingPagesQuietly(ledgerRoot, options) {
    try {
        return await refreshLedgerReadingPages(ledgerRoot, options);
    }
    catch (error) {
        if (!(error instanceof WakeflowError) || error.code === "unexpected")
            throw error;
        return null;
    }
}
