import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { isWakeflowError } from "../../kernel/error.js";
import type { WakeflowHostMaintenanceOperationInput } from "../maintenance/wakeflow-host-maintenance-contribution.js";
import type { WakeflowStaticMaterializationAction } from "../maintenance/wakeflow-static-materialization-preview-contract.js";
import { publishWakeflowWindowRuntimeProjectionDocument } from "./wakeflow-window-runtime-projection-document.js";
import {
  admitWakeflowWindowRuntimeProjectionInputs,
  failWindowRuntimeProjection,
  inspectWakeflowWindowRuntimeProjectionEntries,
  resolveWakeflowWindowRuntimeProjectionExpectedEntries,
  type WakeflowWindowRuntimeProjectionExpectedEntry,
} from "./wakeflow-window-runtime-projection-inspection.js";

/**
 * Wakeflow Workspace / Window Runtime：对账时窗口运行投影的重建（能力卡 1 §1.4 自动修复）。
 *
 * 每个窗口的目标文档由当前 Config 与当前 Binding inventory 重算（观察缝
 * `wakeflow-window-runtime-projection-inspection.ts`，与 `wakeflow_status` / `wakeflow_verify`
 * 共用同一份判定）。磁盘文档缺失或过期（合法但内容不同）出一条宿主维护操作，由宿主 capability
 * 在维护事务内执行；读不出或不是确定性 JSON 的文档只报告 `window-runtime-projection-unsafe`，
 * 不覆盖。宿主运行时根尚未发布时本模块不出操作：共享预览已用 `window-runtime-missing` 报告它。
 * fresh 由共享步骤发布全部未登记投影。
 *
 * 目标文档需要宿主的 identity profile，所以本模块经宿主 capability 端口进入维护事务，
 * 而不是静态预览：共享层不能选择宿主身份。
 */

export const WAKEFLOW_WINDOW_RUNTIME_PROJECTION_OPERATION_KIND =
  "window-runtime-projection" as const;
export const WAKEFLOW_WINDOW_RUNTIME_PROJECTION_OWNER_ID =
  "window-runtime-projection" as const;
export const WAKEFLOW_WINDOW_RUNTIME_PROJECTION_UNSAFE_BLOCKER =
  "window-runtime-projection-unsafe" as const;
export const WAKEFLOW_WINDOW_RUNTIME_PROJECTION_UNAVAILABLE_BLOCKER =
  "window-runtime-projection-unavailable" as const;

export interface PlanWakeflowWindowRuntimeProjectionMaintenanceRequest {
  readonly action: WakeflowStaticMaterializationAction;
  readonly config: unknown;
  readonly resourceProfile: unknown;
  readonly identityProfile: unknown;
  readonly signal?: AbortSignal;
}

export interface WakeflowWindowRuntimeProjectionMaintenancePlan {
  readonly operations: readonly WakeflowHostMaintenanceOperationInput[];
  readonly blockerCodes: readonly string[];
}

export interface ExecuteWakeflowWindowRuntimeProjectionOperationRequest {
  readonly config: unknown;
  readonly resourceProfile: unknown;
  readonly identityProfile: unknown;
  readonly operationId: string;
  readonly targetKey: string;
  readonly targetDigest: Sha256Digest;
  readonly signal?: AbortSignal;
}

export interface WakeflowWindowRuntimeProjectionOperationReceipt {
  readonly operationId: string;
  readonly disposition: "current" | "created" | "updated";
  readonly observationDigest: Sha256Digest;
}

function operationFor(
  entry: Readonly<WakeflowWindowRuntimeProjectionExpectedEntry>,
  sourceDigest: Sha256Digest | null,
): WakeflowHostMaintenanceOperationInput {
  return {
    operationId: `window-runtime-projection:${entry.windowId}`,
    operationKind: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_OPERATION_KIND,
    ownerId: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_OWNER_ID,
    targetKey: entry.windowId,
    sourceDigest,
    targetDigest: entry.target.documentDigest,
    payload: {
      windowId: entry.windowId,
      resourceRef: entry.target.resourceRef,
      registered: entry.registered,
      projectionDigest: entry.target.projectionDigest,
    },
  };
}

/** 零写入规划：缺失或过期的投影各出一条操作；读不稳的投影与读不出的 inventory 只报告。 */
export async function planWakeflowWindowRuntimeProjectionMaintenance(
  rootValue: RootedDirectory,
  request: PlanWakeflowWindowRuntimeProjectionMaintenanceRequest,
): Promise<Readonly<WakeflowWindowRuntimeProjectionMaintenancePlan>> {
  if (request.signal?.aborted === true) failWindowRuntimeProjection("aborted", "$signal");
  const inputs = admitWakeflowWindowRuntimeProjectionInputs(
    rootValue,
    request.config,
    request.resourceProfile,
    request.identityProfile,
  );
  if (request.action === "fresh-initialize") {
    return Object.freeze({ operations: Object.freeze([]), blockerCodes: Object.freeze([]) });
  }
  const expected = await resolveWakeflowWindowRuntimeProjectionExpectedEntries(
    rootValue,
    inputs,
    request.signal,
  );
  if (expected.kind === "runtime-missing") {
    return Object.freeze({ operations: Object.freeze([]), blockerCodes: Object.freeze([]) });
  }
  if (expected.kind === "inventory-unavailable") {
    return Object.freeze({
      operations: Object.freeze([]),
      blockerCodes: Object.freeze([WAKEFLOW_WINDOW_RUNTIME_PROJECTION_UNAVAILABLE_BLOCKER]),
    });
  }
  const operations: WakeflowHostMaintenanceOperationInput[] = [];
  let unsafe = false;
  const inspected = await inspectWakeflowWindowRuntimeProjectionEntries(
    rootValue,
    expected.entries,
    request.signal,
  );
  for (const item of inspected) {
    if (item.status === "current") continue;
    if (item.status === "unsafe") {
      unsafe = true;
      continue;
    }
    operations.push(operationFor(item.entry, item.currentDigest));
  }
  return Object.freeze({
    operations: Object.freeze(operations),
    blockerCodes: Object.freeze(unsafe ? [WAKEFLOW_WINDOW_RUNTIME_PROJECTION_UNSAFE_BLOCKER] : []),
  });
}

export interface RefreshWakeflowWindowRuntimeProjectionsRequest {
  readonly config: unknown;
  readonly resourceProfile: unknown;
  readonly identityProfile: unknown;
  readonly signal?: AbortSignal;
}

export interface WakeflowWindowRuntimeProjectionRefreshReceipt {
  readonly status: "refreshed" | "runtime-missing" | "inventory-unavailable";
  /** 本轮重新发布（缺失或过期）的投影数。 */
  readonly published: number;
  /** 读不出而原样保留的投影数：只由 verify 报出。 */
  readonly unsafe: number;
}

/**
 * 配置事务收尾：窗口集变了（pod 创建 / 关闭）就把本宿主缺失或过期的窗口投影收敛到新 Config 与
 * 当前 Binding 的重算；每份投影的指纹覆盖整个期望拓扑，所以别的窗口增减也会让它过期
 * （G6，§13.111 D5）。unsafe 原样保留；宿主运行时根未发布或 inventory 读不出时不写。
 */
export async function refreshWakeflowWindowRuntimeProjections(
  rootValue: RootedDirectory,
  request: RefreshWakeflowWindowRuntimeProjectionsRequest,
): Promise<Readonly<WakeflowWindowRuntimeProjectionRefreshReceipt>> {
  if (request.signal?.aborted === true) failWindowRuntimeProjection("aborted", "$signal");
  const inputs = admitWakeflowWindowRuntimeProjectionInputs(
    rootValue,
    request.config,
    request.resourceProfile,
    request.identityProfile,
  );
  const expected = await resolveWakeflowWindowRuntimeProjectionExpectedEntries(
    rootValue,
    inputs,
    request.signal,
  );
  if (expected.kind !== "entries") {
    return Object.freeze({ status: expected.kind, published: 0, unsafe: 0 });
  }
  const inspected = await inspectWakeflowWindowRuntimeProjectionEntries(
    rootValue,
    expected.entries,
    request.signal,
  );
  let published = 0;
  let unsafe = 0;
  for (const item of inspected) {
    if (item.status === "current") continue;
    if (item.status === "unsafe") {
      unsafe += 1;
      continue;
    }
    try {
      await publishWakeflowWindowRuntimeProjectionDocument(
        rootValue,
        item.entry.target,
        request.signal,
      );
    } catch (error: unknown) {
      if (isWakeflowError(error)) {
        failWindowRuntimeProjection(
          error.reason === "aborted" ? "aborted" : "effect",
          "$projection",
        );
      }
      throw error;
    }
    published += 1;
  }
  return Object.freeze({ status: "refreshed" as const, published, unsafe });
}

/** 在维护事务内重算同一窗口的目标文档，核对与计划一致后发布；目标已相同即 current。 */
export async function executeWakeflowWindowRuntimeProjectionOperation(
  rootValue: RootedDirectory,
  request: ExecuteWakeflowWindowRuntimeProjectionOperationRequest,
): Promise<Readonly<WakeflowWindowRuntimeProjectionOperationReceipt>> {
  if (request.signal?.aborted === true) failWindowRuntimeProjection("aborted", "$signal");
  const inputs = admitWakeflowWindowRuntimeProjectionInputs(
    rootValue,
    request.config,
    request.resourceProfile,
    request.identityProfile,
  );
  const expected = await resolveWakeflowWindowRuntimeProjectionExpectedEntries(
    rootValue,
    inputs,
    request.signal,
  );
  if (expected.kind !== "entries") failWindowRuntimeProjection("plan", "$operation");
  const entry = expected.entries.find((candidate) => candidate.windowId === request.targetKey);
  if (
    entry === undefined
    || request.operationId !== `window-runtime-projection:${entry.windowId}`
    || entry.target.documentDigest !== request.targetDigest
  ) {
    failWindowRuntimeProjection("plan", "$operation");
  }
  let receipt;
  try {
    receipt = await publishWakeflowWindowRuntimeProjectionDocument(
      rootValue,
      entry.target,
      request.signal,
    );
  } catch (error: unknown) {
    if (isWakeflowError(error)) {
      failWindowRuntimeProjection(error.reason === "aborted" ? "aborted" : "effect", "$projection");
    }
    throw error;
  }
  return Object.freeze({
    operationId: request.operationId,
    disposition: receipt.disposition === "current"
      ? ("current" as const)
      : receipt.disposition === "created"
        ? ("created" as const)
        : ("updated" as const),
    observationDigest: receipt.documentDigest,
  });
}
