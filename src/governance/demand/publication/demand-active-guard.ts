import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../../contracts/identity/wakeflow-durable-id.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../../foundation/filesystem/rooted-directory.js";
import { readStrictTextFile, StrictTextFileError } from "../../../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../../../foundation/numeric/byte-count.js";
import { fail } from "../../../kernel/error.js";
import {
  listRequirementClaimStates,
  type RequirementClaimState,
} from "../../../kernel/requirement-board.js";
import { DemandIdentityError, parseDemandIdentityDocument } from "../model/demand-identity.js";
import { DEMAND_EVENT_SOURCING_IDENTITY_REF } from "../event-sourcing/demand-event-sourcing-paths.js";
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
 * Wakeflow Governance / Demand：活动 Demand 守卫（ADR-0011 D7，按 ADR-0010 D3 收窄到 pod）。
 *
 * 一个 pod 同一时刻只推进一个 Demand：看板上 `claimed` 的包若其 Demand 根存在、身份记
 * 的 pod 等于目标 pod 且聚合未到终态，即为该 pod 的活动 Demand。根无法证明终态时同样视为
 * 活动。preview 与 apply 都检查。
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

const IDENTITY_MAXIMUM_BYTES = parseByteCount(256 * 1024, "$identity.maximumBytes");

/** 身份记录的 pod；读不到或不合法时返回 null，调用方把它当作活动（不能证明属于别的 pod）。 */
async function identityPodId(
  demandRoot: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  try {
    const read = await readStrictTextFile(demandRoot, DEMAND_EVENT_SOURCING_IDENTITY_REF, {
      maximumBytes: IDENTITY_MAXIMUM_BYTES,
      ...(signal === undefined ? {} : { signal }),
    });
    return parseDemandIdentityDocument(read.text).podId;
  } catch (error: unknown) {
    if (error instanceof StrictTextFileError || error instanceof DemandIdentityError) return null;
    throw error;
  }
}

/** 一个已认领包对应的 Demand 根存在、属于目标 pod 且聚合未到终态即为该 pod 的活动 Demand。 */
export async function demandIsActive(
  root: RootedDirectory,
  state: RequirementClaimState,
  signal: AbortSignal | undefined,
  podId: string | null = null,
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
      if (active && podId !== null) {
        const ownerPodId = await identityPodId(demandRoot, signal);
        active = ownerPodId === null || ownerPodId === podId;
      }
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

/**
 * 目标 pod 已有活动 Demand 时拒绝再认领任何需求包（`pod-busy`，details 带占用的 demandId）；
 * `excluding` 让 continue 忽略自己；`podId` 为 null 时退回全局守卫。
 */
export async function assertNoActiveDemand(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
  excluding: string | null = null,
  podId: string | null = null,
): Promise<void> {
  const states = (await listRequirementClaimStates(root, signal)).states;
  for (const state of states) {
    // 看板关系保证 claimed 必有 claim；这里收窄一次，让 details 的 demandId 总是存在。
    if (state.status !== "claimed" || state.claim === null) continue;
    if (state.claim.demandId === excluding) continue;
    if (await demandIsActive(root, state, signal, podId)) {
      fail("precondition-failed", "pod-busy", "$board", {
        details: { demandId: state.claim.demandId },
      });
    }
  }
}
