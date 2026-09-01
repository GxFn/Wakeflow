import { createHash, timingSafeEqual } from "node:crypto";

import {
  computeWakeflowConfigV3Digest,
  type WakeflowConfigV3Model,
} from "../../configuration/wakeflow-config-v3.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import type { UtcInstant } from "../../foundation/time/utc-instant.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
  type WakeflowWorkspaceHostId,
  type WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";
import {
  parseWakeflowAgentHostWindowObservation,
  WakeflowAgentHostWindowObservationError,
  type WakeflowAgentHostWindowObservation,
} from "./wakeflow-agent-host-window-observation.js";
import {
  parseWakeflowWindowHostBinding,
  WakeflowWindowHostBindingError,
  type WakeflowWindowHostBinding,
} from "./wakeflow-window-host-binding.js";
import type { WakeflowWindowHostBindingId } from "./wakeflow-window-host-binding-id.js";
import {
  parseWakeflowWindowHostIdentityProfile,
  WakeflowWindowHostIdentityProfileError,
  type WakeflowWindowHostHandle,
  type WakeflowWindowHostIdentityProfile,
} from "./wakeflow-window-host-identity-profile.js";
import {
  compileWakeflowWindowRuntimeDesiredTopology,
  WakeflowWindowRuntimeDesiredTopologyError,
  type WakeflowWindowRuntimeDesiredWindow,
} from "./wakeflow-window-runtime-desired-topology.js";

/**
 * Wakeflow Workspace / Window Runtime：Agent 宿主窗口观察的脱敏闭合权威。
 *
 * 编译器只接受当前 Config、当前宿主画像、一份私有 Binding 和 Agent 的瞬时观察。
 * 它必须同时证明当前 Config 拓扑、Binding 代际、候选 handle 与逻辑根完全一致；历史
 * launch intent digest 只保留为 Binding 来源，不因显示文本等非路由变化失效。输出删除
 * raw handle，只能作为后续 host-effect claim 的一次输入事实，不能代表宿主在线、空闲、
 * 已发送或已经取得窗口工作权。
 */

export interface CompileWakeflowAgentHostWindowObservationAuthorityRequest {
  readonly config: WakeflowConfigV3Model;
  readonly resourceProfile: WakeflowWorkspaceHostResourceProfile;
  readonly identityProfile: WakeflowWindowHostIdentityProfile;
  readonly binding: WakeflowWindowHostBinding;
  readonly observation: unknown;
}

export interface WakeflowAgentHostWindowObservationAuthority {
  readonly kind: "WakeflowAgentHostWindowObservationAuthority";
  readonly schemaVersion: 1;
  readonly programId: WakeflowDurableId<"program">;
  readonly hostId: WakeflowWorkspaceHostId;
  readonly windowId: WakeflowDurableId<"window">;
  readonly role: WakeflowWindowRuntimeDesiredWindow["role"];
  readonly binding: Readonly<{
    readonly bindingId: WakeflowWindowHostBindingId;
    readonly launchIntentDigest: Sha256Digest;
    readonly registeredAt: UtcInstant;
  }>;
  readonly rootAttestation: Readonly<{
    readonly status: "matches-configured-root";
    readonly logicalRoot: WakeflowWindowRuntimeDesiredWindow["logicalRoot"];
    readonly configuredPlacement: WakeflowWindowRuntimeDesiredWindow["configuredPlacement"];
    readonly observedAt: UtcInstant;
  }>;
  readonly sourceFingerprints: Readonly<{
    readonly configDigest: Sha256Digest;
    readonly desiredTopologyDigest: Sha256Digest;
    readonly windowTopologyDigest: Sha256Digest;
  }>;
  readonly authorityDigest: Sha256Digest;
}

type WakeflowAgentHostWindowObservationAuthorityErrorReason =
  "profile" | "observation" | "binding" | "config" | "relation";

const ERROR_MESSAGES = {
  profile: "Agent Host Window observation profiles are inconsistent.",
  observation: "Agent Host Window observation is invalid.",
  binding:
    "Agent Host Window observation does not match the current private Binding.",
  config:
    "Agent Host Window observation does not match the current Config authority.",
  relation: "Agent Host Window observation sources are inconsistent.",
} as const satisfies Readonly<
  Record<WakeflowAgentHostWindowObservationAuthorityErrorReason, string>
>;

/** Agent Host Window observation 无法形成脱敏闭合权威时的稳定错误。 */
export class WakeflowAgentHostWindowObservationAuthorityError extends Error {
  override readonly name = "WakeflowAgentHostWindowObservationAuthorityError";
  readonly code = "wakeflow-agent-host-window-observation-authority" as const;
  readonly reason: WakeflowAgentHostWindowObservationAuthorityErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowAgentHostWindowObservationAuthorityErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: WakeflowAgentHostWindowObservationAuthorityErrorReason,
  path: string,
): never {
  throw new WakeflowAgentHostWindowObservationAuthorityError(reason, path);
}

function handleFingerprint(handle: Readonly<WakeflowWindowHostHandle>): Buffer {
  return createHash("sha256")
    .update(handle.kind, "utf8")
    .update("\0", "utf8")
    .update(handle.value, "utf8")
    .digest();
}

function sameHandle(
  left: Readonly<WakeflowWindowHostHandle>,
  right: Readonly<WakeflowWindowHostHandle>,
): boolean {
  return timingSafeEqual(handleFingerprint(left), handleFingerprint(right));
}

function sameRoot(
  observation: Readonly<WakeflowAgentHostWindowObservation>,
  desired: Readonly<WakeflowWindowRuntimeDesiredWindow>,
): boolean {
  return (
    observation.attestedRoot.configuredPlacement ===
      desired.configuredPlacement &&
    computeCanonicalJsonSha256Digest(observation.attestedRoot.logicalRoot) ===
      computeCanonicalJsonSha256Digest(desired.logicalRoot)
  );
}

/**
 * 把 Agent 的候选窗口观察与当前私有 Binding 和 Config 根精确闭合。
 * 调用方不得保存传入 observation；只允许携带返回的脱敏 authority 继续编排。
 */
export function compileWakeflowAgentHostWindowObservationAuthority(
  request: Readonly<CompileWakeflowAgentHostWindowObservationAuthorityRequest>,
): Readonly<WakeflowAgentHostWindowObservationAuthority> {
  let resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  let identityProfile: Readonly<WakeflowWindowHostIdentityProfile>;
  try {
    resourceProfile = parseWakeflowWorkspaceHostResourceProfile(
      request.resourceProfile,
    );
    identityProfile = parseWakeflowWindowHostIdentityProfile(
      request.identityProfile,
    );
  } catch (error: unknown) {
    if (
      error instanceof WakeflowWorkspaceHostResourceProfileError ||
      error instanceof WakeflowWindowHostIdentityProfileError
    ) {
      fail("profile", error.path);
    }
    throw error;
  }
  if (
    !resourceProfile.surfaces.windowIdentity ||
    resourceProfile.hostId !== identityProfile.hostId
  ) {
    fail("profile", "$profiles");
  }

  let binding: Readonly<WakeflowWindowHostBinding>;
  try {
    binding = parseWakeflowWindowHostBinding(request.binding, identityProfile);
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostBindingError) {
      fail("binding", error.path);
    }
    throw error;
  }
  let observation: Readonly<WakeflowAgentHostWindowObservation>;
  try {
    observation = parseWakeflowAgentHostWindowObservation(
      identityProfile,
      request.observation,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowAgentHostWindowObservationError) {
      fail("observation", error.path);
    }
    throw error;
  }

  let topology;
  try {
    topology = compileWakeflowWindowRuntimeDesiredTopology(
      request.config,
      resourceProfile,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowRuntimeDesiredTopologyError) {
      fail("config", error.path);
    }
    throw error;
  }
  const desiredWindow = topology.windows.find(
    (entry) => entry.windowId === observation.windowId,
  );
  if (desiredWindow === undefined) {
    fail("config", "$/observation/windowId");
  }
  if (
    binding.programId !== topology.programId ||
    binding.hostId !== resourceProfile.hostId ||
    binding.windowId !== observation.windowId ||
    observation.hostId !== resourceProfile.hostId
  ) {
    fail("relation", "$sources");
  }
  if (
    binding.bindingId !== observation.bindingId ||
    !sameHandle(binding.handle, observation.handle)
  ) {
    fail("binding", "$/observation");
  }
  if (!sameRoot(observation, desiredWindow)) {
    fail("config", "$/observation/attestedRoot");
  }

  // observedAt与registeredAt来自可回拨的墙钟，只保留为审计事实。当前Binding
  // 代际由bindingId、exact handle和launch intent闭合；操作freshness由Claim owner执行。
  const basis = Object.freeze({
    kind: "WakeflowAgentHostWindowObservationAuthority" as const,
    schemaVersion: 1 as const,
    programId: binding.programId,
    hostId: binding.hostId,
    windowId: binding.windowId,
    role: desiredWindow.role,
    binding: Object.freeze({
      bindingId: binding.bindingId,
      launchIntentDigest: binding.source.launchIntentDigest,
      registeredAt: binding.registeredAt,
    }),
    rootAttestation: Object.freeze({
      status: "matches-configured-root" as const,
      logicalRoot: desiredWindow.logicalRoot,
      configuredPlacement: desiredWindow.configuredPlacement,
      observedAt: observation.observedAt,
    }),
    sourceFingerprints: Object.freeze({
      configDigest: computeWakeflowConfigV3Digest(request.config),
      desiredTopologyDigest: topology.desiredTopologyDigest,
      windowTopologyDigest: desiredWindow.windowTopologyDigest,
    }),
  });
  return Object.freeze({
    ...basis,
    authorityDigest: computeCanonicalJsonSha256Digest(basis),
  });
}
