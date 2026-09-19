import {
  buildWakeflowConfigIndexes,
  computeWakeflowConfigDigest,
  parseWakeflowConfig,
  WakeflowConfigError,
  type WakeflowConfigPlacement,
  type WakeflowConfigPod,
  type WakeflowConfigModel,
  type WakeflowConfigIndexes,
  type WakeflowConfigWindow,
} from "../../configuration/wakeflow-config.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
  type WakeflowWorkspaceHostId,
  type WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";
import {
  WAKEFLOW_WINDOW_RUNTIME_MAXIMUM_STATIC_WINDOWS,
} from "./wakeflow-window-runtime-desired-topology.js";

/**
 * Wakeflow Workspace / Window Runtime：Config窗口到宿主中立launch intent的纯编译。
 *
 * Intent只描述逻辑窗口、配置根和后续typed binding来源。它不包含raw thread/session
 * handle、项目数据库ID、tmux locator、实时ready状态或宿主工具名，也不授权执行host
 * effect；宿主固定composition从同一confirmed Config读取自己的launch preferences。
 *
 * 每个意图带所属 pod；worktree pod 的产品窗口意图附 worktree 意图（仓库、建议名称、
 * `local-head` 基线策略），Test 窗口意图列出要以附加目录方式读取的 worktree 仓库（ADR-0010 D4）。
 */

type WakeflowWindowLaunchRoot =
  | Readonly<{
      readonly kind: "program";
      readonly rootId: WakeflowDurableId<"program">;
      readonly configuredPlacement: ".";
    }>
  | Readonly<{
      readonly kind: "repository";
      readonly rootId: WakeflowDurableId<"repository">;
      readonly configuredPlacement: WakeflowConfigPlacement;
    }>
  | Readonly<{
      readonly kind: "support-surface";
      readonly rootId: WakeflowDurableId<"surface">;
      readonly configuredPlacement: WakeflowConfigPlacement;
    }>;

/** worktree pod 产品窗口的 worktree 意图：宿主据此创建检出，路径与分支由回执带回。 */
export interface WakeflowWindowWorktreeIntent {
  readonly repositoryId: WakeflowDurableId<"repository">;
  readonly suggestedName: string;
  readonly basePolicy: "local-head";
}

export interface WakeflowWindowAttachedWorktree {
  readonly repositoryId: WakeflowDurableId<"repository">;
  readonly productWindowId: WakeflowDurableId<"window">;
}

export interface WakeflowWindowLaunchIntent {
  readonly kind: "WakeflowWindowLaunchIntent";
  readonly schemaVersion: 1;
  readonly windowId: WakeflowDurableId<"window">;
  readonly podId: WakeflowDurableId<"pod">;
  readonly podName: string;
  readonly podPlacement: WakeflowConfigPod["placement"];
  readonly role: WakeflowConfigWindow["role"];
  readonly displayTitle: string;
  readonly root: WakeflowWindowLaunchRoot;
  readonly worktree: Readonly<WakeflowWindowWorktreeIntent> | null;
  readonly attachedWorktrees: readonly Readonly<WakeflowWindowAttachedWorktree>[];
  readonly host: Readonly<{
    readonly hostId: WakeflowWorkspaceHostId;
    readonly profileDigest: Sha256Digest;
  }>;
  readonly create: Readonly<{
    readonly effect: "create-window";
    readonly authorization: "not-authorized-by-preview";
  }>;
  readonly registration: Readonly<{
    readonly operation: "register-window-host-binding";
    readonly rawHandleSource: "host-create-result";
    readonly identityAuthority: "window-host-binding";
  }>;
  readonly configDigest: Sha256Digest;
  readonly intentDigest: Sha256Digest;
}

export interface WakeflowWindowLaunchIntentSet {
  readonly kind: "WakeflowWindowLaunchIntentSet";
  readonly schemaVersion: 1;
  readonly hostId: WakeflowWorkspaceHostId;
  readonly configDigest: Sha256Digest;
  readonly profileDigest: Sha256Digest;
  readonly intents: readonly Readonly<WakeflowWindowLaunchIntent>[];
  readonly launchSetDigest: Sha256Digest;
}

type WakeflowWindowLaunchIntentErrorReason =
  | "config"
  | "profile"
  | "capacity"
  | "relation";

const ERROR_MESSAGES = {
  config: "Wakeflow window launch intent Config is invalid.",
  profile: "Wakeflow window launch intent Host Profile is invalid.",
  capacity: "Wakeflow window launch intent exceeds its static window budget.",
  relation: "Wakeflow window launch intent root cannot be resolved.",
} as const satisfies Readonly<Record<
  WakeflowWindowLaunchIntentErrorReason,
  string
>>;

/** Window launch intent 编译失败的稳定、脱敏错误。 */
export class WakeflowWindowLaunchIntentError extends Error {
  override readonly name = "WakeflowWindowLaunchIntentError";
  readonly code = "wakeflow-window-launch-intent" as const;
  readonly reason: WakeflowWindowLaunchIntentErrorReason;
  readonly path: string;

  constructor(reason: WakeflowWindowLaunchIntentErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: WakeflowWindowLaunchIntentErrorReason,
  path: string,
): never {
  throw new WakeflowWindowLaunchIntentError(reason, path);
}

function parseConfig(value: unknown): WakeflowConfigModel {
  try {
    return parseWakeflowConfig(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigError) fail("config", error.path);
    throw error;
  }
}

function parseProfile(
  value: unknown,
): Readonly<WakeflowWorkspaceHostResourceProfile> {
  try {
    return parseWakeflowWorkspaceHostResourceProfile(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
      fail("profile", error.path);
    }
    throw error;
  }
}

function rootForWindow(
  model: WakeflowConfigModel,
  indexes: Readonly<WakeflowConfigIndexes>,
  window: WakeflowConfigWindow,
): WakeflowWindowLaunchRoot {
  if (window.root.kind === "program") {
    return Object.freeze({
      kind: "program",
      rootId: model.program.programId,
      configuredPlacement: ".",
    });
  }
  if (window.root.kind === "repository") {
    const repository = indexes.repositoryById[window.root.repositoryId];
    if (repository === undefined) fail("relation", "$window.root");
    return Object.freeze({
      kind: "repository",
      rootId: repository.repositoryId,
      configuredPlacement: repository.path,
    });
  }
  const surface = indexes.surfaceById[window.root.surfaceId];
  if (surface === undefined) fail("relation", "$window.root");
  return Object.freeze({
    kind: "support-surface",
    rootId: surface.surfaceId,
    configuredPlacement: surface.path,
  });
}

function worktreeForWindow(
  pod: WakeflowConfigPod,
  window: WakeflowConfigWindow,
): Readonly<WakeflowWindowWorktreeIntent> | null {
  if (pod.placement !== "worktree" || window.role !== "product") return null;
  const worktree = pod.worktrees.find((entry) => entry.windowId === window.windowId);
  if (worktree === undefined) fail("relation", "$window.worktree");
  return Object.freeze({
    repositoryId: worktree.repositoryId,
    suggestedName: worktree.suggestedName,
    basePolicy: "local-head" as const,
  });
}

function attachedWorktreesForWindow(
  pod: WakeflowConfigPod,
  window: WakeflowConfigWindow,
): readonly Readonly<WakeflowWindowAttachedWorktree>[] {
  if (pod.placement !== "worktree" || window.role !== "test") return Object.freeze([]);
  return Object.freeze(
    pod.worktrees.map((entry) =>
      Object.freeze({ repositoryId: entry.repositoryId, productWindowId: entry.windowId }),
    ),
  );
}

function createIntent(
  model: WakeflowConfigModel,
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  configDigest: Sha256Digest,
  profileDigest: Sha256Digest,
  indexes: Readonly<WakeflowConfigIndexes>,
  window: WakeflowConfigWindow,
): Readonly<WakeflowWindowLaunchIntent> {
  const pod = indexes.podById[window.podId];
  if (pod === undefined) fail("relation", "$window.podId");
  const basis = Object.freeze({
    kind: "WakeflowWindowLaunchIntent" as const,
    schemaVersion: 1 as const,
    windowId: window.windowId,
    podId: pod.podId,
    podName: pod.name,
    podPlacement: pod.placement,
    role: window.role,
    displayTitle: window.displayName,
    root: rootForWindow(model, indexes, window),
    worktree: worktreeForWindow(pod, window),
    attachedWorktrees: attachedWorktreesForWindow(pod, window),
    host: Object.freeze({
      hostId: profile.hostId,
      profileDigest,
    }),
    create: Object.freeze({
      effect: "create-window" as const,
      authorization: "not-authorized-by-preview" as const,
    }),
    registration: Object.freeze({
      operation: "register-window-host-binding" as const,
      rawHandleSource: "host-create-result" as const,
      identityAuthority: "window-host-binding" as const,
    }),
    configDigest,
  });
  return Object.freeze({
    ...basis,
    intentDigest: computeCanonicalJsonSha256Digest(basis),
  });
}

/** 从完整Config和当前Host Profile生成按windowId排序的launch intent集合。 */
export function compileWakeflowWindowLaunchIntents(
  configValue: unknown,
  profileValue: unknown,
): Readonly<WakeflowWindowLaunchIntentSet> {
  const model = parseConfig(configValue);
  const profile = parseProfile(profileValue);
  if (
    model.topology.windows.length
      > WAKEFLOW_WINDOW_RUNTIME_MAXIMUM_STATIC_WINDOWS
  ) {
    fail("capacity", "$/topology/windows");
  }
  const indexes = buildWakeflowConfigIndexes(model);
  const configDigest = computeWakeflowConfigDigest(model);
  const profileDigest = computeCanonicalJsonSha256Digest(profile);
  const intents = Object.freeze([...model.topology.windows]
    .sort((left, right) => (
      left.windowId < right.windowId
        ? -1
        : left.windowId > right.windowId
          ? 1
          : 0
    ))
    .map((window) => createIntent(
      model,
      profile,
      configDigest,
      profileDigest,
      indexes,
      window,
    )));
  const basis = Object.freeze({
    kind: "WakeflowWindowLaunchIntentSet" as const,
    schemaVersion: 1 as const,
    hostId: profile.hostId,
    configDigest,
    profileDigest,
    intents,
  });
  return Object.freeze({
    ...basis,
    launchSetDigest: computeCanonicalJsonSha256Digest(basis),
  });
}
