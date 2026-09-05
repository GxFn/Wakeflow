import type { RootedDirectory } from "../../../foundation/filesystem/rooted-directory.js";
import { WakeflowError } from "../../../kernel/error.js";
import {
  claimRequirementPackage,
  computeRequirementClaimStateDigest,
  readRequirementClaimState,
  refreshRequirementBoardIndex,
  replaceRequirementClaimStateFile,
  type RequirementClaimStateSource,
} from "../../../kernel/requirement-board.js";
import type { DemandEventSourcingPublicationTransaction } from "./demand-event-sourcing-publication-transaction.js";
import {
  failDemandEventSourcingPublication as fail,
  type DemandEventSourcingPublicationClaimResult,
} from "./demand-event-sourcing-publication-contract.js";

/**
 * Demand 发布与需求包看板认领状态之间的精确前序状态和认领关系验证（ADR-0011 D7）。
 *
 * 认领是一次带期望节点的整文件 CAS 替换，没有集合锁与日志：前序必须是计划里
 * 记录的 `pending` 摘要；已经以同一 Demand 认领过的状态直接视为当前，恢复只需
 * 重跑同一认领。内核错误在这里收敛为发布错误词汇，保持 publicationAuthority 的
 * 分类不变。
 */

function mapBoardError(error: unknown, path: string): never {
  if (error instanceof WakeflowError) {
    if (error.reason.endsWith("-aborted")) fail("aborted", "$signal");
    if (error.code === "concurrency-conflict") fail("cas-mismatch", path);
    if (error.code === "not-found") fail("package-not-found", path);
    fail("conflict", path);
  }
  throw error;
}

/** 读取计划所指需求包的当前认领状态；看板上不存在返回 `null`。 */
export async function inspectPackageForDemandPublication(
  root: RootedDirectory,
  transaction: Readonly<DemandEventSourcingPublicationTransaction>,
  signal: AbortSignal | undefined,
): Promise<Readonly<RequirementClaimStateSource> | null> {
  try {
    return await readRequirementClaimState(root, transaction.requirementId, signal);
  } catch (error: unknown) {
    mapBoardError(error, "$board");
  }
}

function sameLineage(
  source: Readonly<RequirementClaimStateSource>,
  transaction: Readonly<DemandEventSourcingPublicationTransaction>,
): boolean {
  return source.state.requirementId === transaction.requirementId
    && source.state.requirementId === transaction.identity.source.requirementId
    && source.state.recordDigest === transaction.identity.source.recordDigest
    && source.state.programId === transaction.identity.programId;
}

/** 状态已经由同一 Demand 从计划里的前序认领时返回它，否则返回 `null`。 */
export function exactClaimedPackage(
  source: Readonly<RequirementClaimStateSource> | null,
  transaction: Readonly<DemandEventSourcingPublicationTransaction>,
): Readonly<DemandEventSourcingPublicationClaimResult> | null {
  if (
    source === null
    || !sameLineage(source, transaction)
    || source.state.status !== "claimed"
    || source.state.claim === null
    || source.state.claim.demandId !== transaction.demandId
    || source.state.previousStateDigest !== transaction.expectedClaimStateDigest
  ) {
    return null;
  }
  return Object.freeze({ state: source.state, digest: source.digest });
}

/** 状态必须仍是计划记录的那份 `pending` 摘要，否则视为 CAS 过期。 */
export function assertPendingPackage(
  source: Readonly<RequirementClaimStateSource> | null,
  transaction: Readonly<DemandEventSourcingPublicationTransaction>,
): Readonly<RequirementClaimStateSource> {
  if (source === null) fail("package-not-found", "$board");
  if (
    !sameLineage(source, transaction)
    || source.state.status !== "pending"
    || source.digest !== transaction.expectedClaimStateDigest
  ) {
    fail("cas-mismatch", "$board");
  }
  return source;
}

/** 根先建后认领：以计划里的前序摘要做 CAS 替换，然后重写看板索引。 */
export async function claimPackageForDemandPublication(
  root: RootedDirectory,
  transaction: Readonly<DemandEventSourcingPublicationTransaction>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandEventSourcingPublicationClaimResult>> {
  const before = await inspectPackageForDemandPublication(root, transaction, signal);
  let claimed = exactClaimedPackage(before, transaction);
  if (claimed === null) {
    const pending = assertPendingPackage(before, transaction);
    try {
      const next = claimRequirementPackage(
        pending.state,
        transaction.demandId,
        transaction.initialCommand.recordedAt,
      );
      await replaceRequirementClaimStateFile(
        root,
        { digest: pending.digest, read: pending.read },
        next,
        signal,
      );
      claimed = Object.freeze({
        state: next,
        digest: computeRequirementClaimStateDigest(next),
      });
    } catch (error: unknown) {
      mapBoardError(error, "$board");
    }
  }
  try {
    await refreshRequirementBoardIndex(root, signal);
  } catch (error: unknown) {
    mapBoardError(error, "$board/index");
  }
  return claimed;
}
