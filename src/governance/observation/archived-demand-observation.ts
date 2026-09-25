import path from "node:path";

import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { fail, WakeflowError } from "../../kernel/error.js";
import {
  type DemandResultReviewSnapshot,
  readArchivedDemandResultReviewSnapshot,
} from "../review/demand-result-review-snapshot.js";
import { locateLatestDemandArchive } from "./demand-archive-locator.js";

/**
 * Wakeflow Governance / Observation：仍在配置里的 worktree pod 的已归档 Demand（gate-log §13.130）。
 *
 * `unmergedAccepted` 原本只从活动 Demand 派生：Demand 归档后，它接受过、还没合并的 worktree
 * 分支就从 status 里消失，直到 pod 关闭的第一段逼出分支处置。这里在全作用域里按看板的终态记录
 * （完成归档的与取消撤回的，gate-log §13.130）新的在前读归档清单的 `podId`，只保留仍是配置里
 * worktree pod 的那些，再从归档包的 `payload/`（Demand 根的副本，事件提交齐全）读评审快照。
 * 两个上限分开（gate-log §13.130）：清单至多读新的 1024 个（只读一个小文件）；评审快照只对
 * worktree pod 的归档读、至多 64 个。primary pod 的归档随工作区只增不减，只占清单预算、从不占
 * 快照预算；worktree pod 的归档随 pod 关闭自然退出候选。两个上限截掉的都计入 `skipped`。
 * 读不出的归档只计数，从不抛出；中止照常上抛。本模块只读。
 */

export const ARCHIVED_DEMAND_SCAN_MAXIMUM = 64;
export const ARCHIVED_DEMAND_MANIFEST_SCAN_MAXIMUM = 1024;

/** 看板上一条终态（归档或因取消撤回）的需求包指向的 Demand 与终态时间（排序用）。 */
export interface ArchivedDemandCandidate {
  readonly demandId: string;
  readonly archivedAt: string;
}

export interface ObservedArchivedDemand {
  readonly demandId: string;
  readonly podId: string;
  readonly reviewSnapshot: Readonly<DemandResultReviewSnapshot>;
}

export interface ObservedArchivedDemands {
  readonly demands: readonly Readonly<ObservedArchivedDemand>[];
  /** 读过评审快照的 worktree pod 归档数（至多 `ARCHIVED_DEMAND_SCAN_MAXIMUM`）。 */
  readonly scanned: number;
  /** 超过清单上限或快照上限而没读的候选数。 */
  readonly skipped: number;
  /** 清单或评审快照读不出的归档数。 */
  readonly unreadable: number;
}

const NOTHING_TO_SCAN: Readonly<ObservedArchivedDemands> = Object.freeze({
  demands: Object.freeze([]),
  scanned: 0,
  skipped: 0,
  unreadable: 0,
});

function reasonOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const reason = (error as { readonly reason?: unknown }).reason;
  return typeof reason === "string" ? reason : null;
}

/** 新的在前；同一时刻按 demandId，保证截断确定。 */
function newestFirst(
  left: Readonly<ArchivedDemandCandidate>,
  right: Readonly<ArchivedDemandCandidate>,
): number {
  if (left.archivedAt !== right.archivedAt) return left.archivedAt < right.archivedAt ? 1 : -1;
  return left.demandId < right.demandId ? -1 : left.demandId > right.demandId ? 1 : 0;
}

async function readArchivedReviewSnapshot(
  ledgerRoot: RootedDirectory,
  archiveRef: string,
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandResultReviewSnapshot>> {
  const payload = await RootedDirectory.open(
    path.join(ledgerRoot.absolutePath, ...`${archiveRef}/payload`.split("/")),
    "$archive/payload",
    { durability: ledgerRoot.durability },
  );
  try {
    return await readArchivedDemandResultReviewSnapshot(
      payload,
      signal === undefined ? {} : { signal },
    );
  } finally {
    await payload.close();
  }
}

/** 两个扫描上限；测试可以调低，运行时用默认值。 */
export interface ArchivedDemandScanLimits {
  readonly manifests: number;
  readonly snapshots: number;
}

const DEFAULT_SCAN_LIMITS: Readonly<ArchivedDemandScanLimits> = Object.freeze({
  manifests: ARCHIVED_DEMAND_MANIFEST_SCAN_MAXIMUM,
  snapshots: ARCHIVED_DEMAND_SCAN_MAXIMUM,
});

/** 带原因的错误计为读不出；中止上抛为 `io-failure/aborted`；没有原因的错误原样上抛。 */
function countUnreadable(error: unknown): void {
  const reason = reasonOf(error);
  if (reason === null) throw error;
  if (reason === "aborted") {
    if (error instanceof WakeflowError) throw error;
    fail("io-failure", "aborted", "$signal", { cause: error });
  }
}

/**
 * 读候选里属于 `worktreePodIds` 的终态 Demand 的评审快照。没有 worktree pod 时什么都不读。
 * 候选先按终态时间新到旧排序；清单至多读 `limits.manifests` 个，pod 过滤在快照上限之前，
 * 快照至多读 `limits.snapshots` 个（gate-log §13.130）。每个归档独立失败。
 */
export async function observeArchivedDemands(
  ledgerRoot: RootedDirectory,
  candidates: readonly Readonly<ArchivedDemandCandidate>[],
  worktreePodIds: ReadonlySet<string>,
  signal: AbortSignal | undefined,
  limits: Readonly<ArchivedDemandScanLimits> = DEFAULT_SCAN_LIMITS,
): Promise<Readonly<ObservedArchivedDemands>> {
  if (worktreePodIds.size === 0) return NOTHING_TO_SCAN;
  const ordered = [...candidates].sort(newestFirst);
  const manifestScan = ordered.slice(0, limits.manifests);
  let skipped = ordered.length - manifestScan.length;
  const demands: Readonly<ObservedArchivedDemand>[] = [];
  let scanned = 0;
  let unreadable = 0;
  for (const candidate of manifestScan) {
    try {
      const located = await locateLatestDemandArchive(ledgerRoot, candidate.demandId, signal);
      if (located === null || located.podId === null || !worktreePodIds.has(located.podId)) {
        continue;
      }
      if (scanned >= limits.snapshots) {
        skipped += 1;
        continue;
      }
      scanned += 1;
      const reviewSnapshot = await readArchivedReviewSnapshot(
        ledgerRoot,
        located.archiveRef,
        signal,
      );
      demands.push(
        Object.freeze({ demandId: candidate.demandId, podId: located.podId, reviewSnapshot }),
      );
    } catch (error: unknown) {
      countUnreadable(error);
      unreadable += 1;
    }
  }
  return Object.freeze({ demands: Object.freeze(demands), scanned, skipped, unreadable });
}
