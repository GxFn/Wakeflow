import {
  readWakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
  type WakeflowConfigAuthoritySnapshot,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import {
  RootedDirectory,
  RootedDirectoryError,
  type RootedDirectoryDurability,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  readUtcWallClock,
  UtcWallClockError,
  type UtcWallClock,
} from "../../foundation/time/wall-clock.js";
import type { UtcInstant } from "../../foundation/time/utc-instant.js";
import {
  closeDemandOperationRoot,
  DemandOperationAuthorityContextError,
  openDemandOperationRoot,
} from "../../governance/demand/demand-operation-authority-context.js";
import {
  DemandEventSourcingRootAuthorityError,
  loadDemandEventSourcingRootAuthority,
  type LoadedDemandEventSourcingRootAuthority,
} from "../../governance/demand/event-sourcing/demand-event-sourcing-root-authority.js";
import { demandFinalRootRef } from "../../governance/demand/publication/demand-publication-paths.js";
import {
  LedgerAuthorityStore,
  LedgerAuthorityStoreError,
} from "../../governance/ledger/ledger-authority-store.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { fail } from "../../kernel/error.js";
import type { PublicationTransactionEnvelope } from "../../kernel/publication-transaction.js";
import { deriveNextProjection, type NextProjection } from "../../kernel/next-projection.js";
import { readDemandResultReviewSnapshot } from "../../governance/review/demand-result-review-snapshot.js";
import { buildDemandControllerRoute } from "../../governance/controller/demand-controller-route.js";
import {
  findLatestDemandArchive,
  type LocatedArchive,
  mapFoundationError,
  signalOptions,
} from "./archive.js";
import { WAKEFLOW_DEMAND_CONTINUATION_PUBLIC_TOOL_NAME } from "./contract.js";

/**
 * Wakeflow Capabilities / Demand：四个工具共用的上下文。
 *
 * 配置快照与 Ledger 根在打开时就绪；Demand 根按需打开，根不存在不是错误（完成后
 * 活动根已删除，recover 与 continue 都要在没有根的情况下工作）。
 */

export interface DemandServiceOptions {
  /** 本次调用打开工作区根用的持久化级别；与 `clock` 同类的注入值，生产不传。 */
  readonly durability?: RootedDirectoryDurability;
  readonly clock?: UtcWallClock;
  readonly signal?: AbortSignal;
}

export interface DemandHandle {
  readonly demandRoot: RootedDirectory;
  readonly loaded: Readonly<LoadedDemandEventSourcingRootAuthority>;
}

export interface DemandSliceContext {
  readonly root: RootedDirectory;
  readonly snapshot: Readonly<WakeflowConfigAuthoritySnapshot>;
  readonly ledgerRoot: RootedDirectory;
  readonly store: LedgerAuthorityStore;
  readonly clock: UtcWallClock | undefined;
  readonly signal: AbortSignal | undefined;
  readonly holder: { handle: DemandHandle | null };
}

export { signalOptions };

/** 三种 Demand 事务请求共用的发布事务信封：recover 带 operationId，apply 带 planDigest。 */
export function publicationEnvelope(
  request:
    | Readonly<{ readonly root: string; readonly mode: "recover"; readonly operationId: string }>
    | Readonly<{
        readonly root: string;
        readonly mode: "preview" | "apply";
        readonly planDigest?: string;
      }>,
): PublicationTransactionEnvelope {
  if (request.mode === "recover") {
    return {
      root: request.root,
      mode: "recover",
      planDigest: null,
      operationId: request.operationId,
    };
  }
  return {
    root: request.root,
    mode: request.mode,
    planDigest:
      request.mode === "apply" ? ((request.planDigest ?? null) as Sha256Digest | null) : null,
    operationId: null,
  };
}

export function parseDemandId(
  value: unknown,
  path = "$request.demandId",
): WakeflowDurableId<"demand"> {
  try {
    return parseWakeflowDurableIdOfKind(value, "demand", path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError)
      fail("invalid-request", "demand-id", path, { cause: error });
    throw error;
  }
}

export function now(context: DemandSliceContext): UtcInstant {
  try {
    return readUtcWallClock(context.clock);
  } catch (error: unknown) {
    if (error instanceof UtcWallClockError) fail("unexpected", "clock", "$clock", { cause: error });
    throw error;
  }
}

export async function openSliceContext(
  root: RootedDirectory,
  options: DemandServiceOptions,
): Promise<DemandSliceContext> {
  let snapshot: Readonly<WakeflowConfigAuthoritySnapshot>;
  try {
    snapshot = await readWakeflowConfigAuthoritySnapshot(root, signalOptions(options.signal));
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthoritySnapshotError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
      fail("precondition-failed", "config-authority", "$request.root", { cause: error });
    }
    throw error;
  }
  const placement = snapshot.placements.roots.find((entry) => entry.key === "ledger.root");
  if (placement === undefined || placement.state !== "present" || placement.realPath === null) {
    fail("precondition-failed", "ledger-root-missing", "$request.root");
  }
  let ledgerRoot: RootedDirectory;
  try {
    ledgerRoot = await RootedDirectory.open(placement.absolutePath, "$ledgerRoot", {
      durability: root.durability,
    });
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      fail("precondition-failed", "ledger-root", "$request.root", { cause: error });
    }
    throw error;
  }
  if (ledgerRoot.absolutePath !== placement.realPath) {
    await ledgerRoot.close();
    fail("precondition-failed", "ledger-root-alias", "$request.root");
  }
  return Object.freeze({
    root,
    snapshot,
    ledgerRoot,
    store: new LedgerAuthorityStore(ledgerRoot),
    clock: options.clock,
    signal: options.signal,
    holder: { handle: null },
  });
}

export async function releaseDemandHandle(context: DemandSliceContext): Promise<void> {
  const handle = context.holder.handle;
  if (handle === null) return;
  context.holder.handle = null;
  try {
    await closeDemandOperationRoot(handle.demandRoot);
  } catch (error: unknown) {
    if (error instanceof DemandOperationAuthorityContextError) {
      fail("io-failure", "demand-root-close", "$demandRoot", { cause: error });
    }
    throw error;
  }
}

export async function closeSliceContext(context: DemandSliceContext): Promise<void> {
  let failure: unknown;
  try {
    await releaseDemandHandle(context);
  } catch (error: unknown) {
    failure = error;
  }
  try {
    await context.ledgerRoot.close();
  } catch (error: unknown) {
    if (failure === undefined) failure = error;
  }
  if (failure !== undefined) throw failure;
}

/** Demand 活动根是否存在；不存在以外的检查失败是 io-failure。 */
export async function demandRootExists(root: RootedDirectory, demandId: string): Promise<boolean> {
  try {
    await root.inspectExistingResource(demandFinalRootRef(demandId), "$demandRoot");
    return true;
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError && error.reason === "resource-not-found")
      return false;
    if (error instanceof RootedDirectoryError) {
      fail("io-failure", `demand-root-${error.reason}`, "$demandRoot", { cause: error });
    }
    throw error;
  }
}

function mapDemandOpenError(error: unknown): never {
  if (error instanceof DemandOperationAuthorityContextError) {
    if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
    fail("precondition-failed", `demand-root-${error.reason}`, "$demandRoot", { cause: error });
  }
  if (
    error instanceof DemandEventSourcingRootAuthorityError ||
    error instanceof LedgerAuthorityStoreError
  ) {
    if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
    fail("precondition-failed", `demand-authority-${error.reason}`, "$demandRoot", {
      cause: error,
    });
  }
  throw error;
}

/** 打开并加载一个 Demand 根；根不存在返回 `null`。同一上下文内缓存，重开先释放。 */
export async function openDemandHandle(
  context: DemandSliceContext,
  demandId: WakeflowDurableId<"demand">,
  options: { readonly reload?: boolean } = {},
): Promise<DemandHandle | null> {
  if (context.holder.handle !== null) {
    if (options.reload !== true && context.holder.handle.loaded.identity.demandId === demandId) {
      return context.holder.handle;
    }
    await releaseDemandHandle(context);
  }
  if (!(await demandRootExists(context.root, demandId))) return null;
  let demandRoot: RootedDirectory | undefined;
  try {
    demandRoot = await openDemandOperationRoot(context.root, demandId);
    const loaded = await loadDemandEventSourcingRootAuthority(
      demandRoot,
      context.store,
      signalOptions(context.signal),
    );
    const handle = Object.freeze({ demandRoot, loaded });
    context.holder.handle = handle;
    return handle;
  } catch (error: unknown) {
    if (demandRoot !== undefined) {
      try {
        await demandRoot.close();
      } catch {
        // 首个错误优先。
      }
    }
    mapDemandOpenError(error);
  }
}

/** 活动 Demand 的 `next` 直接来自当前路由；只读同源重算。 */
async function activeNext(
  handle: DemandHandle,
  signal: AbortSignal | undefined,
): Promise<NextProjection> {
  let snapshot: Awaited<ReturnType<typeof readDemandResultReviewSnapshot>>;
  try {
    snapshot = await readDemandResultReviewSnapshot(handle.demandRoot, signalOptions(signal));
  } catch (error: unknown) {
    mapFoundationError(error, "review-snapshot", "$demandRoot");
  }
  return deriveNextProjection(buildDemandControllerRoute(handle.loaded, snapshot));
}

/** 已归档 Demand 的 `next`：完成可 continue，取消到此为止。 */
function archivedNext(archive: LocatedArchive | null): NextProjection {
  if (archive !== null && archive.manifest.outcome === "completed") {
    return Object.freeze({
      frontier: "demand-continuation",
      owner: "controller",
      suggestedTool: WAKEFLOW_DEMAND_CONTINUATION_PUBLIC_TOOL_NAME,
      blockers: Object.freeze([]),
    });
  }
  return Object.freeze({
    frontier: null,
    owner: "none",
    suggestedTool: null,
    blockers: Object.freeze([]),
  });
}

/** 变更后的 `next`：根仍在读路由，根已删读归档。 */
export async function nextAfterMutation(
  context: DemandSliceContext,
  demandId: WakeflowDurableId<"demand">,
): Promise<NextProjection> {
  const handle = await openDemandHandle(context, demandId, { reload: true });
  if (handle !== null) return activeNext(handle, context.signal);
  return archivedNext(await findLatestDemandArchive(context.ledgerRoot, demandId, context.signal));
}

export function previewNext(
  tool: string,
  frontier: string,
  planned: Readonly<{ readonly status: "ready" | "blocked"; readonly blockers: readonly string[] }>,
): NextProjection {
  return planned.status === "ready"
    ? Object.freeze({
        frontier,
        owner: "controller",
        suggestedTool: tool,
        blockers: Object.freeze([]),
      })
    : Object.freeze({
        frontier: null,
        owner: "controller",
        suggestedTool: null,
        blockers: planned.blockers,
      });
}
