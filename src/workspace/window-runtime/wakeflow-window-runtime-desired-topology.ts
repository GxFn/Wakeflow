import {
  buildWakeflowConfigIndexes,
  type WakeflowConfigIndexes,
  type WakeflowConfigModel,
  type WakeflowConfigPlacement,
  type WakeflowConfigWindow,
} from "../../configuration/wakeflow-config.js";
import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import type {
  WakeflowWorkspaceHostId,
  WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";

/**
 * Wakeflow Workspace / Window Runtime：由 Config 编译的期望窗口拓扑。
 *
 * 本模块只保留 Window Runtime 后续投影必需的稳定逻辑事实：程序、当前宿主、窗口
 * ID、职责、逻辑根引用和配置位置。它不定义持久文件格式，也不读取 Binding、文件
 * 系统或宿主状态；display title、raw handle、absolute path、dispatch/preflight 与真实
 * root observation 均不属于这一层。
 */

const WAKEFLOW_WINDOW_RUNTIME_DESIRED_TOPOLOGY_KIND =
  "WakeflowWindowRuntimeDesiredTopology" as const;
const WAKEFLOW_WINDOW_RUNTIME_DESIRED_TOPOLOGY_VERSION = 1 as const;
export const WAKEFLOW_WINDOW_RUNTIME_MAXIMUM_STATIC_WINDOWS = 1_024;

export type WakeflowWindowRuntimeLogicalRoot =
  | Readonly<{
      readonly kind: "program";
      readonly programId: WakeflowDurableId<"program">;
    }>
  | Readonly<{
      readonly kind: "support-surface";
      readonly surfaceId: WakeflowDurableId<"surface">;
    }>
  | Readonly<{
      readonly kind: "repository";
      readonly repositoryId: WakeflowDurableId<"repository">;
    }>;

export interface WakeflowWindowRuntimeDesiredWindow {
  readonly windowId: WakeflowDurableId<"window">;
  readonly role: WakeflowConfigWindow["role"];
  readonly logicalRoot: WakeflowWindowRuntimeLogicalRoot;
  readonly configuredPlacement: "." | WakeflowConfigPlacement;
  readonly windowTopologyDigest: Sha256Digest;
}

export interface WakeflowWindowRuntimeDesiredTopology {
  readonly kind: typeof WAKEFLOW_WINDOW_RUNTIME_DESIRED_TOPOLOGY_KIND;
  readonly schemaVersion: typeof WAKEFLOW_WINDOW_RUNTIME_DESIRED_TOPOLOGY_VERSION;
  readonly programId: WakeflowDurableId<"program">;
  readonly hostId: WakeflowWorkspaceHostId;
  readonly windows: readonly Readonly<WakeflowWindowRuntimeDesiredWindow>[];
  readonly desiredTopologyDigest: Sha256Digest;
}

type WakeflowWindowRuntimeDesiredTopologyErrorReason = "capacity" | "reference";

/** Window Runtime 期望拓扑编译失败的稳定、脱敏错误。 */
export class WakeflowWindowRuntimeDesiredTopologyError extends ModuleError<WakeflowWindowRuntimeDesiredTopologyErrorReason> {
  static override readonly code = "wakeflow-window-runtime-desired-topology";
}

const fail: Fail<WakeflowWindowRuntimeDesiredTopologyErrorReason> = failWith(
  WakeflowWindowRuntimeDesiredTopologyError,
);

function compareWindowId(
  left: Readonly<WakeflowConfigWindow>,
  right: Readonly<WakeflowConfigWindow>,
): number {
  return left.windowId < right.windowId ? -1 : left.windowId > right.windowId ? 1 : 0;
}

function desiredWindow(
  model: WakeflowConfigModel,
  indexes: Readonly<WakeflowConfigIndexes>,
  window: Readonly<WakeflowConfigWindow>,
): Readonly<WakeflowWindowRuntimeDesiredWindow> {
  let logicalRoot: WakeflowWindowRuntimeLogicalRoot;
  let configuredPlacement: "." | WakeflowConfigPlacement;
  if (window.root.kind === "program") {
    logicalRoot = Object.freeze({
      kind: "program",
      programId: model.program.programId,
    });
    configuredPlacement = ".";
  } else if (window.root.kind === "support-surface") {
    const surfaceId = window.root.surfaceId;
    const surface = indexes.surfaceById[surfaceId];
    if (surface === undefined) fail("reference", "$window/root/surfaceId");
    logicalRoot = Object.freeze({
      kind: "support-surface",
      surfaceId: surface.surfaceId,
    });
    configuredPlacement = surface.path;
  } else {
    const repositoryId = window.root.repositoryId;
    const repository = indexes.repositoryById[repositoryId];
    if (repository === undefined) {
      fail("reference", "$window/root/repositoryId");
    }
    logicalRoot = Object.freeze({
      kind: "repository",
      repositoryId: repository.repositoryId,
    });
    configuredPlacement = repository.path;
  }
  const basis = {
    windowId: window.windowId,
    role: window.role,
    logicalRoot,
    configuredPlacement,
  };
  return Object.freeze({
    ...basis,
    windowTopologyDigest: computeCanonicalJsonSha256Digest(basis),
  });
}

/**
 * 将严格 Config 与当前 Host Profile 编译为稳定排序的纯期望拓扑。
 * 不相关的语言、显示名称或宿主运行状态变化不会改变该拓扑摘要。Config 与 Profile 是类型化的。
 */
export function compileWakeflowWindowRuntimeDesiredTopology(
  model: WakeflowConfigModel,
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
): Readonly<WakeflowWindowRuntimeDesiredTopology> {
  if (model.topology.windows.length > WAKEFLOW_WINDOW_RUNTIME_MAXIMUM_STATIC_WINDOWS) {
    fail("capacity", "$/topology/windows");
  }
  const indexes = buildWakeflowConfigIndexes(model);
  const windows = Object.freeze(
    [...model.topology.windows]
      .sort(compareWindowId)
      .map((window) => desiredWindow(model, indexes, window)),
  );
  const basis = {
    kind: WAKEFLOW_WINDOW_RUNTIME_DESIRED_TOPOLOGY_KIND,
    schemaVersion: WAKEFLOW_WINDOW_RUNTIME_DESIRED_TOPOLOGY_VERSION,
    programId: model.program.programId,
    hostId: profile.hostId,
    windows,
  };
  return Object.freeze({
    ...basis,
    desiredTopologyDigest: computeCanonicalJsonSha256Digest(basis),
  });
}
