import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  type RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
} from "../../foundation/filesystem/stable-directory-read.js";
import { OperationAbortedError, throwIfAborted } from "../../foundation/node/abort-signal.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { demandLifecycleJournalRef } from "../../kernel/layout.js";
import { DEMAND_RECOVERY_TOOLS } from "../../kernel/next-projection.js";
import { MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF } from "../evidence/managed-evidence-resource-paths.js";
import { locateLatestDemandArchive } from "../observation/demand-archive-locator.js";
import { TASK_PACKAGE_PROJECTIONS_ROOT_REF } from "../tasking/task-package-projection-paths.js";
import {
  DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF,
  DEMAND_EVENT_SOURCING_ARTIFACTS_ROOT_REF,
  DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF,
  DEMAND_EVENT_SOURCING_TRANSACTIONS_ROOT_REF,
  DEMAND_EVENT_STREAM_COMMITS_ROOT_REF,
  DEMAND_EVENT_STREAM_INDEX_ROOT_REF,
} from "./event-sourcing/demand-event-sourcing-paths.js";
import {
  DEMAND_PUBLICATION_MARKER_REF,
  demandFinalRootRef,
} from "./publication/demand-publication-paths.js";

/**
 * Wakeflow Governance / Demand：一个 Demand 停在哪一个被打断的事务上（1.4.1 段 1b）。
 *
 * 进程死在一个多步事务中途之后，盘面上留着那个事务自己的恢复记录：发布标记、受管证据的事务文件、事件
 * 追加的候选、生命周期日志。这里只读这些记录，回答"哪一类恢复接手"，不写任何东西，也不判断恢复能否
 * 成功。两处用同一个回答：生命周期命令的拒绝点名出口，status 与 verify 的下一步。（reconcile 不问这里：
 * 它只用一条更窄的规则决定跳过哪些根，见 `demand-runtime-recovery.ts`。）治理层不认识工具名之外的切片，
 * 所以回答是种类；工具名取自 kernel 的表。
 *
 * 判断按固定次序，先命中的算数：发布标记、追加候选、证据事务、生命周期日志。追加候选排在证据事务与
 * 日志之前，因为那两条 recover 都要先打开根，而根的清点在候选目录不空时一律拒绝：进程死在证据事件或
 * 终态事件的追加里，会同时留下候选与它那一类的记录，先点名后者只会让它被拒、盘面不变、下一次还点它。
 * reconcile 收掉候选之后，再问一次就轮到下一类。读不出来的记录一律当作没有（返回 null，由调用方按
 * 原来的方式回答），只有中止会抛出。
 */

export type DemandRootReading =
  | { readonly root: "absent" }
  | { readonly root: "unloadable" }
  | { readonly root: "loads"; readonly lifecycle: "active" | "completed" | "cancelled" };

export type DemandRecoveryRoute =
  | { readonly kind: "publication" }
  | { readonly kind: "evidence" }
  | { readonly kind: "append-candidates" }
  | { readonly kind: "lifecycle"; readonly action: "complete" | "cancel" | "continue" };

export type DemandRecoveryReason =
  | "demand-publication"
  | "evidence-publication-pending"
  | "append-candidates-pending"
  | "lifecycle-journal-pending";

export const DEMAND_LIFECYCLE_JOURNAL_KIND = "WakeflowDemandLifecycleJournal";
export const DEMAND_LIFECYCLE_JOURNAL_MAXIMUM_BYTES = parseByteCount(
  4 * 1024 * 1024,
  "$journal.maximumBytes",
);

/**
 * 归档负载里没有、恢复时补齐的空目录。continue 放回根之后逐个补建；少了其中一个的根打不开，而补建
 * 正是 continue recover 的最后一段。
 */
export const DEMAND_REBUILDABLE_DIRECTORY_REFS: readonly PortableResourcePath[] = Object.freeze([
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
export function demandRecoveryTool(route: Readonly<DemandRecoveryRoute>): string {
  return route.kind === "lifecycle"
    ? DEMAND_RECOVERY_TOOLS[route.action]
    : DEMAND_RECOVERY_TOOLS[route.kind];
}

/** 这条恢复路径对应的拒绝原因；status 与 verify 把它放进 blockers。 */
export function demandRecoveryReason(route: Readonly<DemandRecoveryRoute>): DemandRecoveryReason {
  if (route.kind === "publication") return "demand-publication";
  if (route.kind === "evidence") return "evidence-publication-pending";
  if (route.kind === "append-candidates") return "append-candidates-pending";
  return "lifecycle-journal-pending";
}

/** 节点种类；不在为 null，看不清为 "unreadable"。 */
async function nodeKind(
  workspaceRoot: RootedDirectory,
  ref: PortableResourcePath,
): Promise<string | null> {
  try {
    return (await workspaceRoot.inspectExistingResource(ref, "$demandRoot")).node.kind;
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError && error.reason === "resource-not-found") return null;
    return "unreadable";
  }
}

function inDemandRoot(demandId: string, ref: PortableResourcePath): PortableResourcePath {
  return parsePortableResourcePath(`${demandFinalRootRef(demandId)}/${ref}`, "$demandRoot");
}

async function hasAppendCandidates(
  workspaceRoot: RootedDirectory,
  demandId: string,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  try {
    const listing = await readStableResourceDirectory(
      workspaceRoot,
      inDemandRoot(demandId, DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF),
      {
        maximumEntries: APPEND_CANDIDATES_MAXIMUM_ENTRIES,
        ...(signal === undefined ? {} : { signal }),
      },
    );
    return listing.entries.length > 0;
  } catch (error: unknown) {
    if (error instanceof OperationAbortedError) throw error;
    return error instanceof StableDirectoryReadError && error.reason === "too-many-entries";
  }
}

interface PendingJournal {
  readonly action: "complete" | "cancel" | "continue";
  readonly eventId: string | null;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

/** 这个 Demand 名下的生命周期日志；不在、读不出、不是这个 Demand 的或动作不认识，都是 null。 */
async function readPendingJournal(
  workspaceRoot: RootedDirectory,
  demandId: string,
  signal: AbortSignal | undefined,
): Promise<PendingJournal | null> {
  let value: unknown;
  try {
    const read = await readDeterministicJsonFile(
      workspaceRoot,
      demandLifecycleJournalRef(demandId),
      {
        maximumBytes: DEMAND_LIFECYCLE_JOURNAL_MAXIMUM_BYTES,
        ...(signal === undefined ? {} : { signal }),
      },
    );
    value = read.value;
  } catch (error: unknown) {
    if (error instanceof OperationAbortedError) throw error;
    return null;
  }
  const journal = record(value);
  const plan = record(journal?.plan);
  if (journal?.kind !== DEMAND_LIFECYCLE_JOURNAL_KIND || plan === null) return null;
  if (plan.demandId !== demandId) return null;
  const action = plan.action;
  if (action !== "complete" && action !== "cancel" && action !== "continue") return null;
  return { action, eventId: typeof plan.eventId === "string" ? plan.eventId : null };
}

/** 最近的归档是这份终态计划封的：结局相符，终态事件就是计划里的那一个。 */
async function latestArchiveBound(
  ledgerRoot: RootedDirectory,
  demandId: string,
  journal: PendingJournal,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  try {
    const located = await locateLatestDemandArchive(ledgerRoot, demandId, signal);
    return (
      located !== null &&
      journal.eventId !== null &&
      located.outcome === (journal.action === "complete" ? "completed" : "cancelled") &&
      located.terminalEvent.eventId === journal.eventId
    );
  } catch (error: unknown) {
    if (error instanceof OperationAbortedError) throw error;
    return false;
  }
}

async function rebuildableDirectoryMissing(
  workspaceRoot: RootedDirectory,
  demandId: string,
): Promise<boolean> {
  for (const directory of DEMAND_REBUILDABLE_DIRECTORY_REFS) {
    if ((await nodeKind(workspaceRoot, inDemandRoot(demandId, directory))) === null) return true;
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
async function continueJournalApplies(
  workspaceRoot: RootedDirectory,
  demandId: string,
  reading: Readonly<DemandRootReading>,
): Promise<boolean> {
  if (reading.root === "absent") return true;
  if (reading.root === "loads") return reading.lifecycle !== "cancelled";
  return rebuildableDirectoryMissing(workspaceRoot, demandId);
}

async function terminalJournalApplies(
  ledgerRoot: RootedDirectory,
  demandId: string,
  journal: PendingJournal,
  reading: Readonly<DemandRootReading>,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  if (reading.root === "loads") {
    return reading.lifecycle === (journal.action === "complete" ? "completed" : "cancelled");
  }
  return latestArchiveBound(ledgerRoot, demandId, journal, signal);
}

async function lifecycleRoute(
  workspaceRoot: RootedDirectory,
  ledgerRoot: RootedDirectory,
  demandId: string,
  reading: Readonly<DemandRootReading>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandRecoveryRoute> | null> {
  const journal = await readPendingJournal(workspaceRoot, demandId, signal);
  if (journal === null) return null;
  const applies =
    journal.action === "continue"
      ? await continueJournalApplies(workspaceRoot, demandId, reading)
      : await terminalJournalApplies(ledgerRoot, demandId, journal, reading, signal);
  return applies ? Object.freeze({ kind: "lifecycle", action: journal.action } as const) : null;
}

/** 这个 Demand 停在哪一个被打断的事务上；没有就是 null。只读。 */
export async function inspectDemandRecoveryRoute(
  workspaceRoot: RootedDirectory,
  ledgerRoot: RootedDirectory,
  demandId: string,
  reading: Readonly<DemandRootReading>,
  options: Readonly<{ readonly signal?: AbortSignal }> = {},
): Promise<Readonly<DemandRecoveryRoute> | null> {
  throwIfAborted(options.signal);
  if (reading.root !== "absent") {
    if (
      (await nodeKind(workspaceRoot, inDemandRoot(demandId, DEMAND_PUBLICATION_MARKER_REF))) ===
      "file"
    ) {
      return Object.freeze({ kind: "publication" } as const);
    }
  }
  if (
    reading.root === "unloadable" &&
    (await hasAppendCandidates(workspaceRoot, demandId, options.signal))
  ) {
    return Object.freeze({ kind: "append-candidates" } as const);
  }
  if (reading.root !== "absent") {
    const evidence = inDemandRoot(demandId, MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF);
    if ((await nodeKind(workspaceRoot, evidence)) === "file") {
      return Object.freeze({ kind: "evidence" } as const);
    }
  }
  return lifecycleRoute(workspaceRoot, ledgerRoot, demandId, reading, options.signal);
}
