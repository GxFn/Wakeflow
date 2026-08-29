import { types } from "node:util";

import {
  computeWakeflowConfigV3Digest,
  parseWakeflowConfigV3,
  WakeflowConfigV3Error,
  type WakeflowConfigPlacement,
  type WakeflowConfigV3Model,
} from "../../configuration/wakeflow-config-v3.js";
import {
  validateWakeflowConfigRootPlacements,
  WakeflowConfigRootPlacementError,
} from "../../configuration/wakeflow-config-root-placement.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { JsonValue } from "../../foundation/data/json-value.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import type { WakeflowDurableId } from "../../foundation/identity/wakeflow-durable-id.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
  type WakeflowWorkspaceHostResourceProfile,
} from "../../workspace/workspace-host-resource-profile.js";
import {
  CLAUDE_CODE_PORTABLE_SETTINGS_REF,
  inspectClaudeCodePortableSettings,
  ClaudeCodePortableSettingsPublicationError,
} from "./claude-code-portable-settings-publication.js";
import {
  planClaudeCodePortableSettingsTransition,
  type ClaudeCodePortableSettingsTransitionReason,
} from "./claude-code-portable-settings-transition.js";

/**
 * Wakeflow Host / Claude Code：portable settings 的多根只读 composition。
 *
 * Program 根与 `wakeflow-managed` Support 根是当前唯一 writer-eligible 集合；
 * external-owned Support 和所有 Repository 均不进入 authority。计划只保存逻辑根、
 * source/target digest 与 action，不保存绝对路径或用户 settings 字节。
 */

export const CLAUDE_CODE_PORTABLE_SETTINGS_COMPOSITION_ACTIONS = Object.freeze([
  "fresh-initialize",
  "reconfigure",
  "reconcile",
] as const);
export type ClaudeCodePortableSettingsCompositionAction =
  (typeof CLAUDE_CODE_PORTABLE_SETTINGS_COMPOSITION_ACTIONS)[number];

export type ClaudeCodePortableSettingsRoot =
  | Readonly<{
      readonly rootKind: "program";
      readonly rootId: WakeflowDurableId<"program">;
      readonly configuredPlacement: ".";
      readonly resourceRef: typeof CLAUDE_CODE_PORTABLE_SETTINGS_REF;
    }>
  | Readonly<{
      readonly rootKind: "support-surface";
      readonly rootId: WakeflowDurableId<"surface">;
      readonly configuredPlacement: WakeflowConfigPlacement;
      readonly resourceRef: typeof CLAUDE_CODE_PORTABLE_SETTINGS_REF;
    }>;

export interface ClaudeCodePortableSettingsRootAuthority {
  readonly kind: "ClaudeCodePortableSettingsRootAuthority";
  readonly schemaVersion: 1;
  readonly programId: WakeflowDurableId<"program">;
  readonly hostId: "claude-code";
  readonly configDigest: Sha256Digest;
  readonly roots: readonly Readonly<ClaudeCodePortableSettingsRoot>[];
  readonly authorityDigest: Sha256Digest;
}

export interface ClaudeCodePortableSettingsOperation {
  readonly operationId: string;
  readonly authorityDigest: Sha256Digest;
  readonly root: Readonly<ClaudeCodePortableSettingsRoot>;
  readonly action: "create" | "update";
  readonly sourceDigest: Sha256Digest | null;
  readonly targetDigest: Sha256Digest;
  readonly operationDigest: Sha256Digest;
}

export interface ClaudeCodePortableSettingsRootPlanEntry {
  readonly root: Readonly<ClaudeCodePortableSettingsRoot>;
  readonly placementStatus: "present" | "planned-missing";
  readonly settingsStatus: "current" | "create" | "update" | "blocked";
  readonly transitionReason: ClaudeCodePortableSettingsTransitionReason | null;
}

export interface ClaudeCodePortableSettingsCompositionPlan {
  readonly kind: "ClaudeCodePortableSettingsCompositionPlan";
  readonly schemaVersion: 1;
  readonly action: ClaudeCodePortableSettingsCompositionAction;
  readonly status: "ready" | "blocked";
  readonly authorityDigest: Sha256Digest;
  readonly roots: readonly Readonly<ClaudeCodePortableSettingsRootPlanEntry>[];
  readonly operations: readonly Readonly<ClaudeCodePortableSettingsOperation>[];
  readonly blockerCodes: readonly string[];
  readonly planDigest: Sha256Digest;
}

export interface PlanClaudeCodePortableSettingsCompositionRequest {
  readonly action: ClaudeCodePortableSettingsCompositionAction;
  readonly config: unknown;
  readonly profile: unknown;
  readonly signal?: AbortSignal;
}

export type ClaudeCodePortableSettingsCompositionErrorReason =
  | "input"
  | "config"
  | "profile"
  | "placement"
  | "root-open"
  | "inspection"
  | "close-failure"
  | "aborted";

const ERROR_MESSAGES = {
  input: "Claude portable settings composition input is invalid.",
  config: "Claude portable settings composition Config is invalid.",
  profile: "Claude portable settings composition Host Profile is invalid.",
  placement: "Claude portable settings composition root placement is invalid.",
  "root-open": "Claude portable settings composition root could not be opened.",
  inspection: "Claude portable settings composition source inspection failed.",
  "close-failure": "Claude portable settings composition root could not be closed.",
  aborted: "Claude portable settings composition was aborted.",
} as const satisfies Readonly<Record<
  ClaudeCodePortableSettingsCompositionErrorReason,
  string
>>;

/** Claude portable settings composition 失败的稳定、脱敏错误。 */
export class ClaudeCodePortableSettingsCompositionError extends Error {
  override readonly name = "ClaudeCodePortableSettingsCompositionError";
  readonly code = "wakeflow-claude-code-portable-settings-composition" as const;
  readonly reason: ClaudeCodePortableSettingsCompositionErrorReason;
  readonly path: string;

  constructor(
    reason: ClaudeCodePortableSettingsCompositionErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedRequest {
  readonly action: ClaudeCodePortableSettingsCompositionAction;
  readonly model: WakeflowConfigV3Model;
  readonly profile: Readonly<WakeflowWorkspaceHostResourceProfile> & {
    readonly hostId: "claude-code";
  };
  readonly signal: AbortSignal | undefined;
}

function fail(
  reason: ClaudeCodePortableSettingsCompositionErrorReason,
  path: string,
): never {
  throw new ClaudeCodePortableSettingsCompositionError(reason, path);
}

function parseRequest(value: unknown): Readonly<ParsedRequest> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$request");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$request");
    throw error;
  }
  if (
    !Object.hasOwn(record, "action")
    || !Object.hasOwn(record, "config")
    || !Object.hasOwn(record, "profile")
    || Object.keys(record).some((key) => (
      key !== "action" && key !== "config" && key !== "profile" && key !== "signal"
    ))
    || typeof record.action !== "string"
    || !CLAUDE_CODE_PORTABLE_SETTINGS_COMPOSITION_ACTIONS.includes(
      record.action as ClaudeCodePortableSettingsCompositionAction,
    )
    || (
      record.signal !== undefined
      && (
        typeof record.signal !== "object"
        || record.signal === null
        || types.isProxy(record.signal)
        || !(record.signal instanceof AbortSignal)
      )
    )
  ) {
    fail("input", "$request");
  }
  let model: WakeflowConfigV3Model;
  try {
    model = parseWakeflowConfigV3(record.config);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigV3Error) fail("config", error.path);
    throw error;
  }
  let profile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  try {
    profile = parseWakeflowWorkspaceHostResourceProfile(record.profile);
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
      fail("profile", error.path);
    }
    throw error;
  }
  if (
    profile.hostId !== "claude-code"
    || profile.surfaces.settingsIntegration?.portablePath
      !== CLAUDE_CODE_PORTABLE_SETTINGS_REF
  ) {
    fail("profile", "$/profile");
  }
  return Object.freeze({
    action: record.action as ClaudeCodePortableSettingsCompositionAction,
    model,
    profile: profile as Readonly<WakeflowWorkspaceHostResourceProfile> & {
      readonly hostId: "claude-code";
    },
    signal: record.signal as AbortSignal | undefined,
  });
}

export function compileClaudeCodePortableSettingsRootAuthority(
  model: WakeflowConfigV3Model,
): Readonly<ClaudeCodePortableSettingsRootAuthority> {
  const roots: ClaudeCodePortableSettingsRoot[] = [Object.freeze({
    rootKind: "program" as const,
    rootId: model.program.programId,
    configuredPlacement: "." as const,
    resourceRef: CLAUDE_CODE_PORTABLE_SETTINGS_REF,
  })];
  for (const surface of [...model.topology.supportSurfaces].sort((left, right) => (
    left.surfaceId < right.surfaceId ? -1 : left.surfaceId > right.surfaceId ? 1 : 0
  ))) {
    if (surface.ownership !== "wakeflow-managed") continue;
    roots.push(Object.freeze({
      rootKind: "support-surface" as const,
      rootId: surface.surfaceId,
      configuredPlacement: surface.path,
      resourceRef: CLAUDE_CODE_PORTABLE_SETTINGS_REF,
    }));
  }
  const frozenRoots = Object.freeze(roots);
  const basis = {
    kind: "ClaudeCodePortableSettingsRootAuthority" as const,
    schemaVersion: 1 as const,
    programId: model.program.programId,
    hostId: "claude-code" as const,
    configDigest: computeWakeflowConfigV3Digest(model),
    roots: frozenRoots,
  };
  return Object.freeze({
    ...basis,
    authorityDigest: computeCanonicalJsonSha256Digest(
      basis as unknown as JsonValue,
    ),
  });
}

export function createClaudeCodePortableSettingsOperation(
  authorityDigest: Sha256Digest,
  root: Readonly<ClaudeCodePortableSettingsRoot>,
  action: "create" | "update",
  sourceDigest: Sha256Digest | null,
  targetDigest: Sha256Digest,
): Readonly<ClaudeCodePortableSettingsOperation> {
  const basis = {
    operationId: `claude-portable-settings:${root.rootKind}:${root.rootId}`,
    authorityDigest,
    root,
    action,
    sourceDigest,
    targetDigest,
  };
  return Object.freeze({
    ...basis,
    operationDigest: computeCanonicalJsonSha256Digest(
      basis as unknown as JsonValue,
    ),
  });
}

async function inspectPresentRoot(
  absolutePath: string,
  signal: AbortSignal | undefined,
) {
  let root: RootedDirectory;
  try {
    root = await RootedDirectory.open(absolutePath, "$configuredRoot");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root-open", "$configuredRoot");
    throw error;
  }
  let inspection;
  let primaryError: unknown;
  try {
    inspection = await inspectClaudeCodePortableSettings(
      root,
      signal === undefined ? {} : { signal },
    );
  } catch (error: unknown) {
    primaryError = error;
  }
  let closeError: unknown;
  try {
    await root.close();
  } catch (error: unknown) {
    closeError = error;
  }
  if (primaryError !== undefined) {
    if (primaryError instanceof ClaudeCodePortableSettingsPublicationError) {
      if (primaryError.reason === "aborted") fail("aborted", "$signal");
      fail("inspection", "$settings");
    }
    throw primaryError;
  }
  if (closeError !== undefined) fail("close-failure", "$configuredRoot");
  if (inspection === undefined) fail("inspection", "$settings");
  return inspection;
}

/** 为 Program 与 Wakeflow-managed Support roots 生成零写入 portable settings 计划。 */
export async function planClaudeCodePortableSettingsComposition(
  workspaceRootValue: RootedDirectory,
  requestValue: PlanClaudeCodePortableSettingsCompositionRequest,
): Promise<Readonly<ClaudeCodePortableSettingsCompositionPlan>> {
  if (
    typeof workspaceRootValue !== "object"
    || workspaceRootValue === null
    || types.isProxy(workspaceRootValue)
    || !(workspaceRootValue instanceof RootedDirectory)
  ) {
    fail("input", "$workspaceRoot");
  }
  const request = parseRequest(requestValue);
  if (request.signal?.aborted === true) fail("aborted", "$signal");
  const authority = compileClaudeCodePortableSettingsRootAuthority(request.model);
  let placements;
  try {
    placements = await validateWakeflowConfigRootPlacements(
      workspaceRootValue,
      request.model,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigRootPlacementError) {
      fail("placement", error.path);
    }
    throw error;
  }
  const rootEntries: ClaudeCodePortableSettingsRootPlanEntry[] = [];
  const operations: ClaudeCodePortableSettingsOperation[] = [];
  const blockerCodes = new Set<string>();
  for (const root of authority.roots) {
    let placementStatus: "present" | "planned-missing";
    let transition;
    if (root.rootKind === "program") {
      placementStatus = "present";
      transition = (await inspectClaudeCodePortableSettings(
        workspaceRootValue,
        request.signal === undefined ? {} : { signal: request.signal },
      )).transition;
    } else {
      const placement = placements.roots.find((entry) => (
        entry.key === `support.${root.rootId}.root`
      ));
      if (placement === undefined) fail("placement", "$supportRoot");
      if (placement.state === "missing") {
        if (request.action !== "fresh-initialize") {
          blockerCodes.add(`support-root-missing:${root.rootId}`);
          rootEntries.push(Object.freeze({
            root,
            placementStatus: "planned-missing",
            settingsStatus: "blocked",
            transitionReason: null,
          }));
          continue;
        }
        placementStatus = "planned-missing";
        transition = planClaudeCodePortableSettingsTransition(null);
      } else {
        placementStatus = "present";
        transition = (await inspectPresentRoot(
          placement.absolutePath,
          request.signal,
        )).transition;
      }
    }
    if (transition.status === "blocked") {
      blockerCodes.add(
        `settings-blocked:${root.rootKind}:${root.rootId}:${transition.reason}`,
      );
    } else if (transition.status === "create" || transition.status === "update") {
      if (transition.desiredDigest === null) fail("inspection", "$transition");
      operations.push(createClaudeCodePortableSettingsOperation(
        authority.authorityDigest,
        root,
        transition.status,
        transition.sourceDigest,
        transition.desiredDigest,
      ));
    }
    rootEntries.push(Object.freeze({
      root,
      placementStatus,
      settingsStatus: transition.status,
      transitionReason: transition.reason,
    }));
  }
  const sortedBlockers = Object.freeze([...blockerCodes].sort());
  const frozenRoots = Object.freeze(rootEntries);
  const frozenOperations = Object.freeze(operations);
  const basis = {
    kind: "ClaudeCodePortableSettingsCompositionPlan" as const,
    schemaVersion: 1 as const,
    action: request.action,
    status: sortedBlockers.length === 0 ? "ready" as const : "blocked" as const,
    authorityDigest: authority.authorityDigest,
    roots: frozenRoots,
    operations: frozenOperations,
    blockerCodes: sortedBlockers,
  };
  return Object.freeze({
    ...basis,
    planDigest: computeCanonicalJsonSha256Digest(
      basis as unknown as JsonValue,
    ),
  });
}
