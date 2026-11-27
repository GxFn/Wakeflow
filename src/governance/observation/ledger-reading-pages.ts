import {
  createFileAtomically,
  DurableAtomicFileWriteError,
  replaceFileAtomically,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import {
  DurableAtomicFileStageRecoveryError,
  recoverDurableAtomicFileStagesMatchingTargets,
} from "../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import {
  readStrictTextFileOrNull,
  StrictTextFileError,
  type StrictTextFileResult,
} from "../../foundation/filesystem/strict-text-file.js";
import { OperationAbortedError, signalOptions } from "../../foundation/node/abort-signal.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { fail, WakeflowError } from "../../kernel/error.js";
import { demandArchivePageRef, LEDGER_HISTORY_INDEX_REF } from "../../kernel/layout.js";
import { createLedgerReadingPageResourceDeclaration } from "../ledger/ledger-resource-catalog.js";
import { readArchivedReviewSnapshot } from "./archived-demand-observation.js";
import {
  countDemandArchiveEvidence,
  type LocatedDemandArchiveSummary,
  listArchivedDemandIds,
  locateLatestDemandArchive,
  readDemandArchiveEvents,
  readDemandArchiveIdentity,
} from "./demand-archive-locator.js";
import { measureDemandArchiveEvents } from "./demand-archive-measures.js";
import {
  buildDemandArchivePageFacts,
  DEMAND_ARCHIVE_PAGE_COMPACT_LIMITS,
  type DemandArchivePageLanguage,
  type DemandArchivePageReviewHistory,
  demandArchivePageHistoryOf,
  demandArchiveResultAccountsOf,
  demandArchiveSessionPromptsOf,
  demandArchivePageLine,
  demandArchivePageMarker,
  renderDemandArchivePage,
} from "./demand-archive-page.js";

/**
 * Wakeflow Governance / Observation：账本里的两样人读投影（open-items I22，1.4 第 3 段）。
 *
 * - 历史索引 `<ledger>/history.md`：每个归档过的 Demand 一行，新的在前；
 * - 每个 Demand 一页 `<ledger>/archives/<demandId>/<修订号>.md`：在归档修订目录的旁边。
 *
 * 两样都从 `archives/` 确定地渲染，随时可以重算；它们不是记录，没有任何读取方把它们当输入。完成或取消
 * 一个 Demand、以及每次维护 apply 之后刷新一次。刷新是自愈的：页面的标记带着渲染器版本、语言与归档
 * 清单的摘要，三者没变就不重读那份归档；没有页面的旧归档每次刷新补上有限的几份，补完为止。
 * 并发的两次刷新不用锁：先读现有索引、再列归档、最后按先前读到的那份做替换——中间有人写过就重来。
 */

/** 一个要写的页面：它的资源声明，加从声明取出的路径与权限位（不另写一遍）。 */
interface ReadingPageTarget {
  readonly declaration: ReturnType<typeof createLedgerReadingPageResourceDeclaration>;
  readonly resourcePath: PortableResourcePath;
  readonly mode: number;
}

function readingPageTarget(
  declarationId: string,
  resourcePath: PortableResourcePath,
): Readonly<ReadingPageTarget> {
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
function archivePageTarget(pageRef: PortableResourcePath): Readonly<ReadingPageTarget> {
  const [, demandId, file] = pageRef.split("/");
  return readingPageTarget(
    `ledger.archive-page.${demandId ?? ""}.${(file ?? "").replace(/\.md$/u, "")}`,
    pageRef,
  );
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
    notice:
      "Generated from the archives under `archives/`: one row per archived Demand, newest first. A Demand that was continued stays listed by its latest sealed archive. Do not edit by hand.",
    header: "| Archived | Demand | Type | Outcome | Page |",
    empty: "No Demand has been archived yet.",
    untitled: "(no title recorded)",
  }),
  "zh-Hans": Object.freeze({
    title: "# Wakeflow Demand 历史",
    notice:
      "本文件由 `archives/` 下的归档包生成：每个归档过的 Demand 一行，新的在前。被续接的 Demand 仍按它最近一次封存的归档列出。请勿手改。",
    header: "| 归档时间 | Demand | 类型 | 结局 | 页面 |",
    empty: "还没有归档过的 Demand。",
    untitled: "（没有记录标题）",
  }),
});

export interface LedgerHistoryEntry {
  readonly demandId: string;
  /** 归档修订目录的名字（十位数字）。 */
  readonly revision: string;
  readonly title: string;
  readonly demandType: string | null;
  readonly outcome: "completed" | "cancelled";
  readonly archivedAt: string;
  /** 这份归档的页面此刻在不在、是不是当前渲染：不是就不给链接。 */
  readonly pageCurrent: boolean;
}

function historyMarker(language: DemandArchivePageLanguage): string {
  return `<!-- wakeflow:ledger-history:v1:${language} -->`;
}

/** 新的在前；同一时刻按 Demand 标识，保证字节确定。 */
function newestFirst(
  left: Readonly<{ readonly archivedAt: string; readonly demandId: string }>,
  right: Readonly<{ readonly archivedAt: string; readonly demandId: string }>,
): number {
  if (left.archivedAt !== right.archivedAt) return left.archivedAt < right.archivedAt ? 1 : -1;
  return left.demandId < right.demandId ? -1 : left.demandId > right.demandId ? 1 : 0;
}

/** 渲染历史索引；`entries` 的顺序不影响结果。 */
export function renderLedgerHistoryIndex(
  entries: readonly Readonly<LedgerHistoryEntry>[],
  language: DemandArchivePageLanguage,
): string {
  const text = HISTORY_TEXT[language];
  const rows = [...entries].sort(newestFirst).map((entry) => {
    const title =
      entry.title === ""
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

async function readPageOrNull(
  ledgerRoot: RootedDirectory,
  resourcePath: PortableResourcePath,
  maximumBytes: number,
  signal: AbortSignal | undefined,
): Promise<Readonly<StrictTextFileResult> | null> {
  try {
    return await readStrictTextFileOrNull(ledgerRoot, resourcePath, {
      maximumBytes: parseByteCount(maximumBytes, "$page.maximumBytes"),
      ...signalOptions(signal),
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError || error instanceof StrictTextFileError) {
      fail("io-failure", `reading-page-read-${error.reason}`, "$ledger", { cause: error });
    }
    throw error;
  }
}

/** 崩溃留下的、属于这个目标的写入暂存先退休：否则之后每一次写都被基础层拒绝。 */
async function settleStage(
  ledgerRoot: RootedDirectory,
  resourcePath: PortableResourcePath,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await recoverDurableAtomicFileStagesMatchingTargets(
      ledgerRoot,
      [resourcePath],
      signalOptions(signal),
    );
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileStageRecoveryError) {
      fail("io-failure", "reading-page-stage", "$ledger", { cause: error });
    }
    throw error;
  }
}

/** 让磁盘上的文件等于 `document`；`current` 是先前读到的那一份（没有即 null），中间变过即失败。 */
async function publishPage(
  ledgerRoot: RootedDirectory,
  target: Readonly<ReadingPageTarget>,
  document: string,
  current: Readonly<StrictTextFileResult> | null,
  signal: AbortSignal | undefined,
): Promise<"written" | "current"> {
  if (current !== null && current.text === document) return "current";
  const { resourcePath, mode } = target;
  const bytes = encodeUtf8(document, "$ledger/page");
  await settleStage(ledgerRoot, resourcePath, signal);
  try {
    if (current === null) {
      await createFileAtomically(ledgerRoot, resourcePath, bytes, {
        mode,
        ...signalOptions(signal),
      });
    } else {
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
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) {
      fail("io-failure", `reading-page-write-${error.reason}`, "$ledger", { cause: error });
    }
    throw error;
  }
  return "written";
}

/** 写的那一刻目标被别人先写了（同一份归档的页面，或另一轮刷新的索引）。 */
function isWriteRace(error: unknown): boolean {
  return (
    error instanceof WakeflowError &&
    (error.reason === "reading-page-write-expectation-changed" ||
      error.reason === "reading-page-write-stage-changed" ||
      error.reason === "reading-page-write-target-exists")
  );
}

/** 归档里的评审历史；读不出为 null（页面照样渲染，只说明这一部分读不出）。中止上抛。 */
async function readHistoryOrNull(
  ledgerRoot: RootedDirectory,
  archiveRef: PortableResourcePath,
  events: Parameters<typeof demandArchiveSessionPromptsOf>[0],
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandArchivePageReviewHistory> | null> {
  try {
    return demandArchivePageHistoryOf(
      await readArchivedReviewSnapshot(ledgerRoot, archiveRef, signal),
      demandArchiveSessionPromptsOf(events),
      demandArchiveResultAccountsOf(events),
    );
  } catch (error: unknown) {
    if (error instanceof OperationAbortedError) throw error;
    const reason =
      typeof error === "object" && error !== null
        ? (error as { readonly reason?: unknown }).reason
        : undefined;
    if (typeof reason !== "string") throw error;
    return null;
  }
}

/**
 * 一份归档的页面正文：超过上限就用短的那一档再渲染一次，还超就不出这一页（返回 null，索引里那一行
 * 不给链接）。不为它设拒绝原因：这条路没有调用方会看到。
 */
async function renderArchivePage(
  ledgerRoot: RootedDirectory,
  summary: Readonly<LocatedDemandArchiveSummary>,
  language: DemandArchivePageLanguage,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  const read = await readDemandArchiveEvents(ledgerRoot, summary.archiveRef, signal);
  const facts = buildDemandArchivePageFacts({
    summary,
    identity: await readDemandArchiveIdentity(ledgerRoot, summary.archiveRef, signal),
    evidenceCount: await countDemandArchiveEvidence(ledgerRoot, summary.archiveRef, signal),
    history: await readHistoryOrNull(ledgerRoot, summary.archiveRef, read.events, signal),
    measures:
      read.eventCommits === 0 ? null : measureDemandArchiveEvents(read.events, read.eventCommits),
  });
  const full = renderDemandArchivePage(facts, language);
  if (encodeUtf8(full, "$ledger/page").byteLength <= PAGE_MAXIMUM_BYTES) return full;
  const compact = renderDemandArchivePage(facts, language, DEMAND_ARCHIVE_PAGE_COMPACT_LIMITS);
  return encodeUtf8(compact, "$ledger/page").byteLength <= PAGE_MAXIMUM_BYTES ? compact : null;
}

interface Candidate {
  readonly summary: Readonly<LocatedDemandArchiveSummary>;
  readonly title: string;
  readonly demandType: string | null;
  readonly pageRef: PortableResourcePath;
}

/** 每个归档过的 Demand 最近的一份归档；读不出的只计数。 */
async function locateCandidates(
  ledgerRoot: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<{ readonly candidates: readonly Candidate[]; readonly unreadable: number }>> {
  const candidates: Candidate[] = [];
  let unreadable = 0;
  for (const demandId of await listArchivedDemandIds(ledgerRoot, signal)) {
    try {
      const summary = await locateLatestDemandArchive(ledgerRoot, demandId, signal);
      if (summary === null) continue;
      const identity = await readDemandArchiveIdentity(ledgerRoot, summary.archiveRef, signal);
      candidates.push({
        summary,
        title: identity.title,
        demandType: identity.demandType,
        pageRef: demandArchivePageRef(summary.archiveRef),
      });
    } catch (error: unknown) {
      if (!(error instanceof WakeflowError)) throw error;
      unreadable += 1;
    }
  }
  return { candidates, unreadable };
}

export interface LedgerReadingPagesReceipt {
  /** 历史索引里的行数。 */
  readonly demands: number;
  /** 这一轮新写或重写的 Demand 页面数。 */
  readonly pagesWritten: number;
  /** 还没有当前页面、留给下一轮的归档数（超过了这一轮的渲染上限，或这一页渲染失败）。 */
  readonly pagesPending: number;
  readonly historyWritten: boolean;
  /** 清单读不出的归档数：不进索引。 */
  readonly unreadable: number;
}

export interface RefreshLedgerReadingPagesOptions {
  readonly language: DemandArchivePageLanguage;
  readonly signal?: AbortSignal;
  /** 这一轮最多新渲染多少页；缺省是 `LEDGER_READING_PAGES_DEFAULT_RENDER_LIMIT`。 */
  readonly renderLimit?: number;
  /** 先渲染这个 Demand 的页面（刚归档的那一个），不受上限的排序影响。 */
  readonly preferDemandId?: string;
}

/** 一份归档的页面：标记没变即当前；否则在上限之内渲染并写入。返回这一页此刻是不是当前渲染。 */
async function ensurePage(
  ledgerRoot: RootedDirectory,
  candidate: Candidate,
  options: Readonly<RefreshLedgerReadingPagesOptions>,
  budget: { remaining: number; written: number },
): Promise<boolean> {
  const { language, signal } = options;
  const existing = await readPageOrNull(ledgerRoot, candidate.pageRef, PAGE_MAXIMUM_BYTES, signal);
  const marker = demandArchivePageMarker(language, candidate.summary.manifestDigest);
  if (existing?.text.includes(marker) === true) return true;
  if (budget.remaining <= 0) return false;
  budget.remaining -= 1;
  const document = await renderArchivePage(ledgerRoot, candidate.summary, language, signal);
  if (document === null) return false;
  try {
    await publishPage(ledgerRoot, archivePageTarget(candidate.pageRef), document, existing, signal);
  } catch (error: unknown) {
    // 另一轮刷新先写了同一份归档的页面：同一份归档渲染出同样的字节，算当前。
    if (!isWriteRace(error)) throw error;
  }
  budget.written += 1;
  return true;
}

async function ensurePageQuietly(
  ledgerRoot: RootedDirectory,
  candidate: Candidate,
  options: Readonly<RefreshLedgerReadingPagesOptions>,
  budget: { remaining: number; written: number },
): Promise<boolean> {
  try {
    return await ensurePage(ledgerRoot, candidate, options, budget);
  } catch (error: unknown) {
    // 一页渲染或写入失败不拖累别的页与索引；中止与编程错误照常上抛。
    if (!(error instanceof WakeflowError) || error.code === "unexpected") throw error;
    return false;
  }
}

async function refreshOnce(
  ledgerRoot: RootedDirectory,
  options: Readonly<RefreshLedgerReadingPagesOptions>,
): Promise<Readonly<LedgerReadingPagesReceipt>> {
  const { language, signal } = options;
  // 先读现有索引、再列归档：之后的替换按这一刻读到的那份做，期间别人写过即重来。
  const currentHistory = await readPageOrNull(
    ledgerRoot,
    LEDGER_HISTORY_INDEX_REF,
    HISTORY_MAXIMUM_BYTES,
    signal,
  );
  const { candidates, unreadable } = await locateCandidates(ledgerRoot, signal);
  const ordered = [...candidates].sort((left, right) => {
    const preferred =
      Number(right.summary.demandId === options.preferDemandId) -
      Number(left.summary.demandId === options.preferDemandId);
    return preferred !== 0 ? preferred : newestFirst(left.summary, right.summary);
  });
  const budget = {
    remaining: options.renderLimit ?? LEDGER_READING_PAGES_DEFAULT_RENDER_LIMIT,
    written: 0,
  };
  const entries: LedgerHistoryEntry[] = [];
  for (const candidate of ordered) {
    const pageCurrent = await ensurePageQuietly(ledgerRoot, candidate, options, budget);
    entries.push({
      demandId: candidate.summary.demandId,
      revision: candidate.summary.archiveRef.slice(
        candidate.summary.archiveRef.lastIndexOf("/") + 1,
      ),
      title: candidate.title,
      demandType: candidate.demandType,
      outcome: candidate.summary.outcome,
      archivedAt: candidate.summary.archivedAt,
      pageCurrent,
    });
  }
  // 没有归档、也没有旧索引：不在账本里凭空放一个文件。
  const historyWritten =
    entries.length === 0 && currentHistory === null
      ? false
      : (await publishPage(
          ledgerRoot,
          HISTORY_INDEX_TARGET,
          renderLedgerHistoryIndex(entries, language),
          currentHistory,
          signal,
        )) === "written";
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
export async function refreshLedgerReadingPages(
  ledgerRoot: RootedDirectory,
  options: Readonly<RefreshLedgerReadingPagesOptions>,
): Promise<Readonly<LedgerReadingPagesReceipt>> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await refreshOnce(ledgerRoot, options);
    } catch (error: unknown) {
      if (!isWriteRace(error) || attempt >= REFRESH_ATTEMPTS) throw error;
    }
  }
}

/**
 * 静默刷新：吞掉已归类的 Wakeflow 失败，中止也在内——归档已经封存，一次被取消或写不成的刷新不能把
 * 已提交的终态事务变成失败，页面下一次刷新自会补上。`unexpected`（没人认领的错误，也就是编程错误的
 * 出口）与非 Wakeflow 的错误上抛。
 */
export async function refreshLedgerReadingPagesQuietly(
  ledgerRoot: RootedDirectory,
  options: Readonly<RefreshLedgerReadingPagesOptions>,
): Promise<Readonly<LedgerReadingPagesReceipt> | null> {
  try {
    return await refreshLedgerReadingPages(ledgerRoot, options);
  } catch (error: unknown) {
    if (error instanceof OperationAbortedError) return null;
    if (!(error instanceof WakeflowError) || error.code === "unexpected") throw error;
    return null;
  }
}
