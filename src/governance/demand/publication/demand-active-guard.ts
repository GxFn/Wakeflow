import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../../contracts/identity/wakeflow-durable-id.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../../foundation/filesystem/rooted-directory.js";
import { fail } from "../../../kernel/error.js";
import {
  listRequirementClaimStates,
  type RequirementClaimState,
} from "../../../kernel/requirement-board.js";
import {
  closeDemandOperationRoot,
  DemandOperationAuthorityContextError,
  openDemandOperationRoot,
} from "../demand-operation-authority-context.js";
import {
  DemandEventSourcingRepository,
  DemandEventSourcingRepositoryError,
} from "../event-sourcing/demand-event-sourcing-repository.js";
import { demandFinalRootRef } from "./demand-publication-paths.js";

/**
 * Wakeflow Governance / Demand：ADR-0011 D7 的活动 Demand 守卫。
 *
 * 总控同时只有一个活动 Demand：看板上 `claimed` 的包若其 Demand 根存在且聚合未到
 * 终态，即为活动。根无法证明终态时同样视为活动。preview 与 apply 都检查。
 */

async function resourceExists(
  root: RootedDirectory,
  ref: ReturnType<typeof demandFinalRootRef>,
): Promise<boolean> {
  try {
    await root.inspectExistingResource(ref);
    return true;
  } catch (error: unknown) {
    if (
      error instanceof RootedDirectoryError &&
      error.reason === "resource-not-found"
    ) {
      return false;
    }
    if (error instanceof RootedDirectoryError) {
      fail("io-failure", "demand-root-inspect", "$demandRoot", { cause: error });
    }
    throw error;
  }
}

/** 一个已认领包对应的 Demand 根存在且聚合未到终态即为活动 Demand。 */
export async function demandIsActive(
  root: RootedDirectory,
  state: RequirementClaimState,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  if (state.claim === null) return false;
  let demandId: WakeflowDurableId<"demand">;
  try {
    demandId = parseWakeflowDurableIdOfKind(state.claim.demandId, "demand");
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) {
      fail("precondition-failed", "claim-demand-id", "$board", { cause: error });
    }
    throw error;
  }
  if (!(await resourceExists(root, demandFinalRootRef(demandId)))) return false;
  let demandRoot: RootedDirectory;
  try {
    demandRoot = await openDemandOperationRoot(root, demandId);
  } catch (error: unknown) {
    if (error instanceof DemandOperationAuthorityContextError) return true;
    throw error;
  }
  let active = true;
  let failure: unknown;
  try {
    const loaded = await new DemandEventSourcingRepository(demandRoot).load(
      signal === undefined ? undefined : { signal },
    );
    if (loaded !== null) {
      const lifecycle = loaded.aggregate.state.lifecycle;
      active = lifecycle !== "completed" && lifecycle !== "cancelled";
    }
  } catch (error: unknown) {
    if (
      error instanceof DemandEventSourcingRepositoryError &&
      error.reason === "aborted"
    ) {
      failure = error;
    }
  }
  try {
    await closeDemandOperationRoot(demandRoot);
  } catch (error: unknown) {
    if (failure === undefined) failure = error;
  }
  if (failure !== undefined) {
    if (failure instanceof DemandEventSourcingRepositoryError) {
      fail("io-failure", "aborted", "$signal", { cause: failure });
    }
    if (failure instanceof DemandOperationAuthorityContextError) {
      fail("io-failure", "demand-root-close", "$demandRoot", { cause: failure });
    }
    throw failure;
  }
  return active;
}

/** 总控已有活动 Demand 时拒绝再认领任何需求包；`excluding` 让 continue 忽略自己。 */
export async function assertNoActiveDemand(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
  excluding: string | null = null,
): Promise<void> {
  const states = (await listRequirementClaimStates(root, signal)).states;
  for (const state of states) {
    if (state.status !== "claimed") continue;
    if (state.claim !== null && state.claim.demandId === excluding) continue;
    if (await demandIsActive(root, state, signal)) {
      fail("precondition-failed", "active-demand-exists", "$board");
    }
  }
}
