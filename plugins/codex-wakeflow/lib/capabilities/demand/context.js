import { readWakeflowConfigAuthoritySnapshot, WakeflowConfigAuthoritySnapshotError, } from "../../configuration/wakeflow-config-authority-snapshot.js";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { readUtcWallClock, UtcWallClockError, } from "../../foundation/time/wall-clock.js";
import { closeDemandOperationRoot, DemandOperationAuthorityContextError, openDemandOperationRoot, } from "../../governance/demand/demand-operation-authority-context.js";
import { DemandEventSourcingRootAuthorityError, loadDemandEventSourcingRootAuthority, } from "../../governance/demand/event-sourcing/demand-event-sourcing-root-authority.js";
import { demandFinalRootRef } from "../../governance/demand/publication/demand-publication-paths.js";
import { LedgerAuthorityStore, LedgerAuthorityStoreError, } from "../../governance/ledger/ledger-authority-store.js";
import { fail } from "../../kernel/error.js";
import { deriveNextProjection } from "../../kernel/next-projection.js";
import { readDemandResultReviewSnapshot } from "../../governance/review/demand-result-review-snapshot.js";
import { buildDemandControllerRoute } from "../../governance/controller/demand-controller-route.js";
import { findLatestDemandArchive, mapFoundationError, signalOptions, } from "./archive.js";
import { WAKEFLOW_DEMAND_CONTINUATION_PUBLIC_TOOL_NAME } from "./contract.js";
export { signalOptions };
/** 三种 Demand 事务请求共用的发布事务信封：recover 带 operationId，apply 带 planDigest。 */
export function publicationEnvelope(request) {
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
        planDigest: request.mode === "apply" ? (request.planDigest ?? null) : null,
        operationId: null,
    };
}
export function parseDemandId(value, path = "$request.demandId") {
    try {
        return parseWakeflowDurableIdOfKind(value, "demand", path);
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("invalid-request", "demand-id", path, { cause: error });
        throw error;
    }
}
export function now(context) {
    try {
        return readUtcWallClock(context.clock);
    }
    catch (error) {
        if (error instanceof UtcWallClockError)
            fail("unexpected", "clock", "$clock", { cause: error });
        throw error;
    }
}
export async function openSliceContext(root, options) {
    let snapshot;
    try {
        snapshot = await readWakeflowConfigAuthoritySnapshot(root, signalOptions(options.signal));
    }
    catch (error) {
        if (error instanceof WakeflowConfigAuthoritySnapshotError) {
            if (error.reason === "aborted")
                fail("io-failure", "aborted", "$signal", { cause: error });
            fail("precondition-failed", "config-authority", "$request.root", { cause: error });
        }
        throw error;
    }
    const placement = snapshot.placements.roots.find((entry) => entry.key === "ledger.root");
    if (placement === undefined || placement.state !== "present" || placement.realPath === null) {
        fail("precondition-failed", "ledger-root-missing", "$request.root");
    }
    let ledgerRoot;
    try {
        ledgerRoot = await RootedDirectory.open(placement.absolutePath, "$ledgerRoot", {
            durability: root.durability,
        });
    }
    catch (error) {
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
export async function releaseDemandHandle(context) {
    const handle = context.holder.handle;
    if (handle === null)
        return;
    context.holder.handle = null;
    try {
        await closeDemandOperationRoot(handle.demandRoot);
    }
    catch (error) {
        if (error instanceof DemandOperationAuthorityContextError) {
            fail("io-failure", "demand-root-close", "$demandRoot", { cause: error });
        }
        throw error;
    }
}
export async function closeSliceContext(context) {
    let failure;
    try {
        await releaseDemandHandle(context);
    }
    catch (error) {
        failure = error;
    }
    try {
        await context.ledgerRoot.close();
    }
    catch (error) {
        if (failure === undefined)
            failure = error;
    }
    if (failure !== undefined)
        throw failure;
}
/** Demand 活动根是否存在；不存在以外的检查失败是 io-failure。 */
export async function demandRootExists(root, demandId) {
    try {
        await root.inspectExistingResource(demandFinalRootRef(demandId), "$demandRoot");
        return true;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError && error.reason === "resource-not-found")
            return false;
        if (error instanceof RootedDirectoryError) {
            fail("io-failure", `demand-root-${error.reason}`, "$demandRoot", { cause: error });
        }
        throw error;
    }
}
function mapDemandOpenError(error) {
    if (error instanceof DemandOperationAuthorityContextError) {
        if (error.reason === "aborted")
            fail("io-failure", "aborted", "$signal", { cause: error });
        fail("precondition-failed", `demand-root-${error.reason}`, "$demandRoot", { cause: error });
    }
    if (error instanceof DemandEventSourcingRootAuthorityError ||
        error instanceof LedgerAuthorityStoreError) {
        if (error.reason === "aborted")
            fail("io-failure", "aborted", "$signal", { cause: error });
        fail("precondition-failed", `demand-authority-${error.reason}`, "$demandRoot", {
            cause: error,
        });
    }
    throw error;
}
/** 打开并加载一个 Demand 根；根不存在返回 `null`。同一上下文内缓存，重开先释放。 */
export async function openDemandHandle(context, demandId, options = {}) {
    if (context.holder.handle !== null) {
        if (options.reload !== true && context.holder.handle.loaded.identity.demandId === demandId) {
            return context.holder.handle;
        }
        await releaseDemandHandle(context);
    }
    if (!(await demandRootExists(context.root, demandId)))
        return null;
    let demandRoot;
    try {
        demandRoot = await openDemandOperationRoot(context.root, demandId);
        const loaded = await loadDemandEventSourcingRootAuthority(demandRoot, context.store, signalOptions(context.signal));
        const handle = Object.freeze({ demandRoot, loaded });
        context.holder.handle = handle;
        return handle;
    }
    catch (error) {
        if (demandRoot !== undefined) {
            try {
                await demandRoot.close();
            }
            catch {
                // 首个错误优先。
            }
        }
        mapDemandOpenError(error);
    }
}
/** 活动 Demand 的 `next` 直接来自当前路由；只读同源重算。 */
async function activeNext(handle, signal) {
    let snapshot;
    try {
        snapshot = await readDemandResultReviewSnapshot(handle.demandRoot, signalOptions(signal));
    }
    catch (error) {
        mapFoundationError(error, "review-snapshot", "$demandRoot");
    }
    return deriveNextProjection(buildDemandControllerRoute(handle.loaded, snapshot));
}
/** 已归档 Demand 的 `next`：完成可 continue，取消到此为止。 */
function archivedNext(archive) {
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
export async function nextAfterMutation(context, demandId) {
    const handle = await openDemandHandle(context, demandId, { reload: true });
    if (handle !== null)
        return activeNext(handle, context.signal);
    return archivedNext(await findLatestDemandArchive(context.ledgerRoot, demandId, context.signal));
}
export function previewNext(tool, frontier, planned) {
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
