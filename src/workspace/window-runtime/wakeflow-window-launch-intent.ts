import {
  buildWakeflowConfigV3Indexes,
  computeWakeflowConfigV3Digest,
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
  type WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";

/**
 * Wakeflow Workspace / Window Runtime：Config窗口到宿主中立launch intent的纯编译。
 *
 * Intent只描述逻辑窗口、配置根和后续typed binding来源。它不包含raw thread/session
 * handle、项目数据库ID、tmux locator、实时ready状态或宿主工具名，也不授权执行host
 * effect；宿主固定composition从同一confirmed Config读取自己的launch preferences。
 */

export type WakeflowWindowLaunchRoot =
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

export interface WakeflowWindowLaunchIntent {
  readonly kind: "WakeflowWindowLaunchIntent";
  readonly schemaVersion: 1;
  readonly windowId: WakeflowDurableId<"window">;
  readonly role: WakeflowConfigWindow["role"];
  readonly displayTitle: string;
  readonly root: WakeflowWindowLaunchRoot;
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
    readonly windowId: WakeflowDurableId<"window">;
    readonly hostId: WakeflowWorkspaceHostId;
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

export type WakeflowWindowLaunchIntentErrorReason =
  | "config"
  | "profile"
  | "relation";

const ERROR_MESSAGES = {
  config: "Wakeflow window launch intent Config is invalid.",
  profile: "Wakeflow window launch intent Host Profile is invalid.",
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

function parseConfig(value: unknown): WakeflowConfigV3Model {
  try {
    return parseWakeflowConfigV3(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigV3Error) fail("config", error.path);
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
  model: WakeflowConfigV3Model,
  window: WakeflowConfigWindow,
): WakeflowWindowLaunchRoot {
  if (window.root.kind === "program") {
    return Object.freeze({
      kind: "program",
      rootId: model.program.programId,
      configuredPlacement: ".",
    });
  }
  const indexes = buildWakeflowConfigV3Indexes(model);
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

function createIntent(
  model: WakeflowConfigV3Model,
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  configDigest: Sha256Digest,
  profileDigest: Sha256Digest,
  window: WakeflowConfigWindow,
): Readonly<WakeflowWindowLaunchIntent> {
  const basis = Object.freeze({
    kind: "WakeflowWindowLaunchIntent" as const,
    schemaVersion: 1 as const,
    windowId: window.windowId,
    role: window.role,
    displayTitle: window.displayName,
    root: rootForWindow(model, window),
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
      windowId: window.windowId,
      hostId: profile.hostId,
      rawHandleSource: "host-create-result" as const,
      identityAuthority: "window-host-binding" as const,
    }),
    configDigest,
  });
  return Object.freeze({
    ...basis,
    intentDigest: computeCanonicalJsonSha256Digest(
      basis as unknown as JsonValue,
    ),
  });
}

/** 从完整Config和当前Host Profile生成按windowId排序的launch intent集合。 */
export function compileWakeflowWindowLaunchIntents(
  configValue: unknown,
  profileValue: unknown,
): Readonly<WakeflowWindowLaunchIntentSet> {
  const model = parseConfig(configValue);
  const profile = parseProfile(profileValue);
  const configDigest = computeWakeflowConfigV3Digest(model);
  const profileDigest = computeCanonicalJsonSha256Digest(
    profile as unknown as JsonValue,
  );
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
    launchSetDigest: computeCanonicalJsonSha256Digest(
      basis as unknown as JsonValue,
    ),
  });
}
