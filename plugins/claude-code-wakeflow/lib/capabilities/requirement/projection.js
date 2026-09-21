import { compareRequirementClaimStates, computeRequirementClaimStateDigest, } from "../../kernel/requirement-board.js";
import { WAKEFLOW_BOARD_INSPECTION_PUBLIC_TOOL_NAME, WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME, } from "./contract.js";
export function boardCounts(states) {
    const counts = { pending: 0, parked: 0, claimed: 0, withdrawn: 0, archived: 0 };
    for (const state of states)
        counts[state.status] += 1;
    return Object.freeze(counts);
}
export function toBoardEntry(state, digest) {
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
        claim: state.claim === null ? null : Object.freeze({ demandId: state.claim.demandId }),
        parked: state.parked === null ? null : Object.freeze({ trigger: state.parked.trigger }),
    });
}
/** 过滤并按优先级、发布时间、标识排序；`limit` 之外的条目只计数。 */
export function selectBoardEntries(states, filter, limit) {
    const matched = states
        .filter((state) => filter.statuses === undefined || filter.statuses.includes(state.status))
        .filter((state) => filter.priorities === undefined || filter.priorities.includes(state.priority))
        .filter((state) => filter.demandTypes === undefined || filter.demandTypes.includes(state.demandType))
        .sort(compareRequirementClaimStates);
    return Object.freeze({
        entries: Object.freeze(matched.slice(0, limit).map((state) => toBoardEntry(state))),
        totalMatched: matched.length,
    });
}
/** 本切片对 `next` 的贡献：确认、应用、认领三个前沿。 */
export function deriveRequirementNext(input) {
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
    if (input.pendingCount > 0) {
        return Object.freeze({
            frontier: "requirement-claim",
            owner: "controller",
            suggestedTool: "wakeflow_create_demand",
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
