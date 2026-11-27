import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { NextProjection } from "../../kernel/next-projection.js";
import {
  compareRequirementClaimStates,
  computeRequirementClaimStateDigest,
  type PendingRequirementWork,
  type RequirementClaimState,
  type RequirementClaimStatus,
} from "../../governance/ledger/requirement-board.js";
import {
  WAKEFLOW_BOARD_INSPECTION_PUBLIC_TOOL_NAME,
  WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
} from "./contract.js";

/**
 * Wakeflow Capabilities / Requirement：看板视图与 `next` 的纯投影。
 */

export interface BoardCounts {
  readonly pending: number;
  readonly parked: number;
  readonly claimed: number;
  readonly withdrawn: number;
  readonly archived: number;
}

export function boardCounts(states: readonly RequirementClaimState[]): BoardCounts {
  const counts = { pending: 0, parked: 0, claimed: 0, withdrawn: 0, archived: 0 };
  for (const state of states) counts[state.status] += 1;
  return Object.freeze(counts);
}

export interface BoardEntry {
  readonly requirementId: string;
  readonly title: string;
  readonly demandType: RequirementClaimState["demandType"];
  readonly priority: RequirementClaimState["priority"];
  readonly status: RequirementClaimStatus;
  readonly publishedAt: string;
  readonly updatedAt: string;
  readonly revision: number;
  readonly stateDigest: Sha256Digest;
  readonly recordDigest: string;
  readonly supersedes: string | null;
  /** supplement 包补充的父需求；其他包没有这一项。 */
  readonly supplements?: string;
  readonly claim: Readonly<{ readonly demandId: string }> | null;
  readonly parked: Readonly<{ readonly trigger: string }> | null;
  /** 撤回原因与时间：`superseded-by:<requirementId>` 或撤回请求里的原因；未撤回为 null。 */
  readonly withdrawal: Readonly<{ readonly reason: string; readonly withdrawnAt: string }> | null;
}

export function toBoardEntry(state: RequirementClaimState, digest?: Sha256Digest): BoardEntry {
  return Object.freeze({
    requirementId: state.requirementId,
    title: state.title,
    demandType: state.demandType,
    priority: state.priority,
    status: state.status,
    publishedAt: state.publishedAt,
    updatedAt: state.updatedAt,
    revision: state.revision,
    stateDigest: digest ?? computeRequirementClaimStateDigest(state),
    recordDigest: state.recordDigest,
    supersedes: state.supersedes,
    ...(state.supplements === undefined ? {} : { supplements: state.supplements }),
    claim: state.claim === null ? null : Object.freeze({ demandId: state.claim.demandId }),
    parked: state.parked === null ? null : Object.freeze({ trigger: state.parked.trigger }),
    withdrawal:
      state.withdrawal === null
        ? null
        : Object.freeze({
            reason: state.withdrawal.reason,
            withdrawnAt: state.withdrawal.withdrawnAt,
          }),
  });
}

export interface BoardFilter {
  readonly statuses?: readonly RequirementClaimStatus[];
  readonly priorities?: readonly RequirementClaimState["priority"][];
  readonly demandTypes?: readonly RequirementClaimState["demandType"][];
}

/** 过滤并按优先级、发布时间、标识排序；`limit` 之外的条目只计数。 */
export function selectBoardEntries(
  states: readonly RequirementClaimState[],
  filter: Readonly<BoardFilter>,
  limit: number,
): Readonly<{ readonly entries: readonly BoardEntry[]; readonly totalMatched: number }> {
  const matched = states
    .filter((state) => filter.statuses === undefined || filter.statuses.includes(state.status))
    .filter(
      (state) => filter.priorities === undefined || filter.priorities.includes(state.priority),
    )
    .filter(
      (state) => filter.demandTypes === undefined || filter.demandTypes.includes(state.demandType),
    )
    .sort(compareRequirementClaimStates);
  return Object.freeze({
    entries: Object.freeze(matched.slice(0, limit).map((state) => toBoardEntry(state))),
    totalMatched: matched.length,
  });
}

export interface RequirementNextInput {
  /** preview 因缺用户确认而阻塞。 */
  readonly confirmationMissing: boolean;
  /** preview 就绪、尚未 apply。 */
  readonly awaitingApply: boolean;
  /** 看板上 Controller 现在能动手的 pending 包（预览阶段全为 0）。 */
  readonly pending: Readonly<PendingRequirementWork>;
}

/**
 * 本切片对 `next` 的贡献：确认、应用、认领，以及 supplement 包的续接。supplement 包不认领
 * （`supplement-of:<id>`），它并入完成了父需求的 Demand——与 `wakeflow_status` 给的是同一条路（1.3.0 终验：
 * 发布 supplement 包之后这里曾指向 `wakeflow_create_demand`）。
 */
export function deriveRequirementNext(
  input: Readonly<RequirementNextInput>,
): Readonly<NextProjection> {
  if (input.confirmationMissing) {
    return Object.freeze({
      frontier: "requirement-confirmation",
      owner: "user",
      suggestedTool: WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
      blockers: Object.freeze(["user-confirmation-missing"]),
    });
  }
  if (input.awaitingApply) {
    return Object.freeze({
      frontier: "requirement-publication-apply",
      owner: "user",
      suggestedTool: WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
      blockers: Object.freeze([]),
    });
  }
  if (input.pending.claimable > 0) {
    return Object.freeze({
      frontier: "requirement-claim",
      owner: "controller",
      suggestedTool: "wakeflow_create_demand",
      blockers: Object.freeze([]),
    });
  }
  if (input.pending.attachable > 0) {
    return Object.freeze({
      frontier: "supplement-attach",
      owner: "controller",
      suggestedTool: "wakeflow_continue_demand",
      blockers: Object.freeze([]),
    });
  }
  return Object.freeze({
    frontier: null,
    owner: "none",
    suggestedTool: WAKEFLOW_BOARD_INSPECTION_PUBLIC_TOOL_NAME,
    blockers: Object.freeze([]),
  });
}
