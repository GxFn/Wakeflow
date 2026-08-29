import {
  parseWakeflowConfigV3,
  WakeflowConfigV3Error,
  type WakeflowConfigPlacement,
  type WakeflowConfigV3Model,
  type WakeflowConfigWindow,
} from "../../configuration/wakeflow-config-v3.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { JsonValue } from "../../foundation/data/json-value.js";
import type { WakeflowDurableId } from "../../foundation/identity/wakeflow-durable-id.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
  type WakeflowWorkspaceHostId,
} from "../workspace-host-resource-profile.js";

/**
 * Wakeflow Workspace / Window Runtime：由 Config 编译的期望窗口拓扑。
 *
 * 本模块只保留 Window Runtime 后续投影必需的稳定逻辑事实：程序、当前宿主、窗口
 * ID、职责、逻辑根引用和配置位置。它不定义持久文件格式，也不读取 Binding、文件
 * 系统或宿主状态；display title、raw handle、absolute path、dispatch/preflight 与真实
 * root observation 均不属于这一层。
 */

export const WAKEFLOW_WINDOW_RUNTIME_DESIRED_TOPOLOGY_KIND =
  "WakeflowWindowRuntimeDesiredTopology" as const;
export const WAKEFLOW_WINDOW_RUNTIME_DESIRED_TOPOLOGY_VERSION = 1 as const;
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
  readonly schemaVersion:
    typeof WAKEFLOW_WINDOW_RUNTIME_DESIRED_TOPOLOGY_VERSION;
  readonly programId: WakeflowDurableId<"program">;
  readonly hostId: WakeflowWorkspaceHostId;
  readonly windows: readonly Readonly<WakeflowWindowRuntimeDesiredWindow>[];
  readonly desiredTopologyDigest: Sha256Digest;
}

export type WakeflowWindowRuntimeDesiredTopologyErrorReason =
  | "config"
  | "profile"
  | "capacity"
  | "reference";

const ERROR_MESSAGES = {
  config: "Window Runtime desired topology Config is invalid.",
  profile: "Window Runtime desired topology Host Profile is invalid.",
  capacity: "Window Runtime desired topology exceeds its static window budget.",
  reference: "Window Runtime desired topology contains an unresolved root reference.",
} as const satisfies Readonly<Record<
  WakeflowWindowRuntimeDesiredTopologyErrorReason,
  string
>>;

/** Window Runtime 期望拓扑编译失败的稳定、脱敏错误。 */
export class WakeflowWindowRuntimeDesiredTopologyError extends Error {
  override readonly name = "WakeflowWindowRuntimeDesiredTopologyError";
  readonly code = "wakeflow-window-runtime-desired-topology" as const;
  readonly reason: WakeflowWindowRuntimeDesiredTopologyErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowWindowRuntimeDesiredTopologyErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: WakeflowWindowRuntimeDesiredTopologyErrorReason,
  path: string,
): never {
  throw new WakeflowWindowRuntimeDesiredTopologyError(reason, path);
}

function compareWindowId(
  left: Readonly<WakeflowConfigWindow>,
  right: Readonly<WakeflowConfigWindow>,
): number {
  return left.windowId < right.windowId
    ? -1
    : left.windowId > right.windowId
      ? 1
      : 0;
}

function desiredWindow(
  model: WakeflowConfigV3Model,
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
    const surface = model.topology.supportSurfaces.find((entry) => (
      entry.surfaceId === surfaceId
    ));
    if (surface === undefined) fail("reference", "$window/root/surfaceId");
    logicalRoot = Object.freeze({
      kind: "support-surface",
      surfaceId: surface.surfaceId,
    });
    configuredPlacement = surface.path;
  } else {
    const repositoryId = window.root.repositoryId;
    const repository = model.topology.repositories.find((entry) => (
      entry.repositoryId === repositoryId
    ));
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
    windowTopologyDigest: computeCanonicalJsonSha256Digest(
      basis as unknown as JsonValue,
    ),
  });
}

/**
 * 将严格 Config 与当前 Host Profile 编译为稳定排序的纯期望拓扑。
 * 不相关的语言、显示名称或宿主运行状态变化不会改变该拓扑摘要。
 */
export function compileWakeflowWindowRuntimeDesiredTopology(
  configValue: unknown,
  profileValue: unknown,
): Readonly<WakeflowWindowRuntimeDesiredTopology> {
  let model: WakeflowConfigV3Model;
  try {
    model = parseWakeflowConfigV3(configValue);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigV3Error) fail("config", error.path);
    throw error;
  }
  let profile;
  try {
    profile = parseWakeflowWorkspaceHostResourceProfile(profileValue);
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
      fail("profile", error.path);
    }
    throw error;
  }
  if (
    model.topology.windows.length > WAKEFLOW_WINDOW_RUNTIME_MAXIMUM_STATIC_WINDOWS
  ) {
    fail("capacity", "$/topology/windows");
  }
  const windows = Object.freeze(
    [...model.topology.windows]
      .sort(compareWindowId)
      .map((window) => desiredWindow(model, window)),
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
    desiredTopologyDigest: computeCanonicalJsonSha256Digest(
      basis as unknown as JsonValue,
    ),
  });
}
