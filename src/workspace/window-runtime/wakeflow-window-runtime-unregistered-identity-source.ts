import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { JsonValue } from "../../foundation/data/json-value.js";
import type { WakeflowDurableId } from "../../foundation/identity/wakeflow-durable-id.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import type { WakeflowWorkspaceHostId } from "../workspace-host-resource-profile.js";
import {
  compileWakeflowWindowRuntimeDesiredTopology,
} from "./wakeflow-window-runtime-desired-topology.js";
import {
  wakeflowWindowBindingRootRef,
} from "./wakeflow-window-runtime-paths.js";

/**
 * Wakeflow Workspace / Window Runtime：Fresh 初始化使用的未注册 identity source。
 *
 * 该纯数据只描述“Binding namespace 已由 owner 证明为空”时应得到的全部 unregistered
 * 窗口。它不创建目录、不扫描文件，也不能被当成空目录证据；未来物理 owner 必须先
 * 完成 exact empty inventory inspection，才能签发并消费这一 source。
 */

export const WAKEFLOW_WINDOW_RUNTIME_UNREGISTERED_IDENTITY_SOURCE_KIND =
  "WakeflowWindowRuntimeUnregisteredIdentitySource" as const;
export const WAKEFLOW_WINDOW_RUNTIME_UNREGISTERED_IDENTITY_SOURCE_VERSION =
  1 as const;

export interface WakeflowWindowRuntimeUnregisteredIdentityEntry {
  readonly windowId: WakeflowDurableId<"window">;
  readonly status: "unregistered";
}

export interface WakeflowWindowRuntimeUnregisteredIdentitySource {
  readonly kind:
    typeof WAKEFLOW_WINDOW_RUNTIME_UNREGISTERED_IDENTITY_SOURCE_KIND;
  readonly schemaVersion:
    typeof WAKEFLOW_WINDOW_RUNTIME_UNREGISTERED_IDENTITY_SOURCE_VERSION;
  readonly programId: WakeflowDurableId<"program">;
  readonly hostId: WakeflowWorkspaceHostId;
  readonly desiredTopologyDigest: Sha256Digest;
  readonly identityRootRef: PortableResourcePath;
  readonly inventoryStatus: "empty";
  readonly entries:
    readonly Readonly<WakeflowWindowRuntimeUnregisteredIdentityEntry>[];
  readonly identitySourceDigest: Sha256Digest;
}

/** 为 strict Config/Host 组合编译无时间字段、无占位 handle 的空 identity source。 */
export function compileWakeflowWindowRuntimeUnregisteredIdentitySource(
  configValue: unknown,
  profileValue: unknown,
): Readonly<WakeflowWindowRuntimeUnregisteredIdentitySource> {
  const desired = compileWakeflowWindowRuntimeDesiredTopology(
    configValue,
    profileValue,
  );
  const entries = Object.freeze(desired.windows.map((window) => Object.freeze({
    windowId: window.windowId,
    status: "unregistered" as const,
  })));
  const basis = {
    kind: WAKEFLOW_WINDOW_RUNTIME_UNREGISTERED_IDENTITY_SOURCE_KIND,
    schemaVersion: WAKEFLOW_WINDOW_RUNTIME_UNREGISTERED_IDENTITY_SOURCE_VERSION,
    programId: desired.programId,
    hostId: desired.hostId,
    desiredTopologyDigest: desired.desiredTopologyDigest,
    identityRootRef: wakeflowWindowBindingRootRef(profileValue),
    inventoryStatus: "empty" as const,
    entries,
  };
  return Object.freeze({
    ...basis,
    identitySourceDigest: computeCanonicalJsonSha256Digest(
      basis as unknown as JsonValue,
    ),
  });
}
