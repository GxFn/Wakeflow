import { types } from "node:util";

import {
  parseWakeflowConfigPlacement,
  parseWakeflowConfigV3,
  WakeflowConfigV3Error,
  type WakeflowConfigV3Model,
} from "../../configuration/wakeflow-config-v3.js";
import {
  validateWakeflowConfigRootPlacements,
  WakeflowConfigRootPlacementError,
} from "../../configuration/wakeflow-config-root-placement.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
} from "../../contracts/identity/wakeflow-durable-id.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
} from "../../workspace/workspace-host-resource-profile.js";
import {
  compileClaudeCodePortableSettingsRootAuthority,
  createClaudeCodePortableSettingsOperation,
  type ClaudeCodePortableSettingsOperation,
  type ClaudeCodePortableSettingsRoot,
} from "./claude-code-portable-settings-composition.js";
import {
  CLAUDE_CODE_PORTABLE_SETTINGS_REF,
  inspectClaudeCodePortableSettings,
  publishClaudeCodePortableSettings,
  settleClaudeCodePortableSettingsPublicationStages,
  ClaudeCodePortableSettingsPublicationError,
} from "./claude-code-portable-settings-publication.js";

/**
 * Wakeflow Host / Claude Code：confirmed portable settings 的单 operation executor。
 *
 * Executor 重新解析 Config/Profile、重建Root Authority、解析逻辑根与当前物理位置，
 * 并只执行一个 source→target CAS。普通执行要求当前source精确匹配；只有明确的
 * affected-operation恢复才接受目标已提交或先结算同目标Foundation stage。
 */

export interface ExecuteClaudeCodePortableSettingsOperationRequest {
  readonly config: unknown;
  readonly profile: unknown;
  readonly operation: unknown;
  readonly recoveringAffectedOperation: boolean;
  readonly signal?: AbortSignal;
}

export interface ClaudeCodePortableSettingsOperationExecutionResult {
  readonly kind: "ClaudeCodePortableSettingsOperationExecutionResult";
  readonly operationId: string;
  readonly root: Readonly<ClaudeCodePortableSettingsRoot>;
  readonly disposition: "current" | "created" | "updated";
  readonly sourceDigest: Sha256Digest | null;
  readonly targetDigest: Sha256Digest;
}

export type ClaudeCodePortableSettingsOperationExecutionErrorReason =
  | "input"
  | "config"
  | "profile"
  | "operation"
  | "authority-changed"
  | "placement"
  | "root-open"
  | "source-stale"
  | "transition-blocked"
  | "owner"
  | "close-failure"
  | "aborted";

const ERROR_MESSAGES = {
  input: "Claude portable settings operation execution input is invalid.",
  config: "Claude portable settings operation Config is invalid.",
  profile: "Claude portable settings operation Host Profile is invalid.",
  operation: "Claude portable settings operation is invalid.",
  "authority-changed": "Claude portable settings root authority changed.",
  placement: "Claude portable settings operation placement is unavailable.",
  "root-open": "Claude portable settings operation root could not be opened.",
  "source-stale": "Claude portable settings operation source is stale.",
  "transition-blocked": "Claude portable settings operation transition is blocked.",
  owner: "Claude portable settings single-root owner failed.",
  "close-failure": "Claude portable settings operation root could not be closed.",
  aborted: "Claude portable settings operation was aborted.",
} as const satisfies Readonly<Record<
  ClaudeCodePortableSettingsOperationExecutionErrorReason,
  string
>>;

/** Claude portable settings 单 operation 执行失败的稳定、脱敏错误。 */
export class ClaudeCodePortableSettingsOperationExecutionError extends Error {
  override readonly name = "ClaudeCodePortableSettingsOperationExecutionError";
  readonly code = "wakeflow-claude-code-portable-settings-operation-execution" as const;
  readonly reason: ClaudeCodePortableSettingsOperationExecutionErrorReason;
  readonly path: string;

  constructor(
    reason: ClaudeCodePortableSettingsOperationExecutionErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedRequest {
  readonly model: WakeflowConfigV3Model;
  readonly profile: ReturnType<typeof parseWakeflowWorkspaceHostResourceProfile>;
  readonly operation: Readonly<ClaudeCodePortableSettingsOperation>;
  readonly recoveringAffectedOperation: boolean;
  readonly signal: AbortSignal | undefined;
}

function fail(
  reason: ClaudeCodePortableSettingsOperationExecutionErrorReason,
  path: string,
): never {
  throw new ClaudeCodePortableSettingsOperationExecutionError(reason, path);
}

function digest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("operation", path);
    throw error;
  }
}

function operationRoot(value: unknown): Readonly<ClaudeCodePortableSettingsRoot> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$operation.root");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("operation", "$operation.root");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 4
    || keys[0] !== "configuredPlacement"
    || keys[1] !== "resourceRef"
    || keys[2] !== "rootId"
    || keys[3] !== "rootKind"
    || record.resourceRef !== CLAUDE_CODE_PORTABLE_SETTINGS_REF
  ) {
    fail("operation", "$operation.root");
  }
  if (record.rootKind === "program") {
    if (record.configuredPlacement !== ".") {
      fail("operation", "$operation.root.configuredPlacement");
    }
    try {
      return Object.freeze({
        rootKind: "program",
        rootId: parseWakeflowDurableIdOfKind(
          record.rootId,
          "program",
          "$operation.root.rootId",
        ),
        configuredPlacement: ".",
        resourceRef: CLAUDE_CODE_PORTABLE_SETTINGS_REF,
      });
    } catch (error: unknown) {
      if (error instanceof WakeflowDurableIdError) {
        fail("operation", "$operation.root.rootId");
      }
      throw error;
    }
  }
  if (record.rootKind !== "support-surface") {
    fail("operation", "$operation.root.rootKind");
  }
  let rootId;
  try {
    rootId = parseWakeflowDurableIdOfKind(
      record.rootId,
      "surface",
      "$operation.root.rootId",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) {
      fail("operation", "$operation.root.rootId");
    }
    throw error;
  }
  let configuredPlacement;
  try {
    configuredPlacement = parseWakeflowConfigPlacement(
      record.configuredPlacement,
      "$operation.root.configuredPlacement",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigV3Error) {
      fail("operation", "$operation.root.configuredPlacement");
    }
    throw error;
  }
  return Object.freeze({
    rootKind: "support-surface",
    rootId,
    configuredPlacement,
    resourceRef: CLAUDE_CODE_PORTABLE_SETTINGS_REF,
  });
}

function parseOperation(value: unknown): Readonly<ClaudeCodePortableSettingsOperation> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$operation");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("operation", "$operation");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 7
    || keys[0] !== "action"
    || keys[1] !== "authorityDigest"
    || keys[2] !== "operationDigest"
    || keys[3] !== "operationId"
    || keys[4] !== "root"
    || keys[5] !== "sourceDigest"
    || keys[6] !== "targetDigest"
    || (record.action !== "create" && record.action !== "update")
    || typeof record.operationId !== "string"
  ) {
    fail("operation", "$operation");
  }
  const root = operationRoot(record.root);
  const authorityDigest = digest(
    record.authorityDigest,
    "$operation.authorityDigest",
  );
  const sourceDigest = record.sourceDigest === null
    ? null
    : digest(record.sourceDigest, "$operation.sourceDigest");
  const targetDigest = digest(record.targetDigest, "$operation.targetDigest");
  if (
    (record.action === "create" && sourceDigest !== null)
    || (record.action === "update" && sourceDigest === null)
  ) {
    fail("operation", "$operation.sourceDigest");
  }
  const expected = createClaudeCodePortableSettingsOperation(
    authorityDigest,
    root,
    record.action,
    sourceDigest,
    targetDigest,
  );
  if (
    expected.operationId !== record.operationId
    || expected.operationDigest
      !== digest(record.operationDigest, "$operation.operationDigest")
  ) {
    fail("operation", "$operation.operationDigest");
  }
  return expected;
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
    !Object.hasOwn(record, "config")
    || !Object.hasOwn(record, "profile")
    || !Object.hasOwn(record, "operation")
    || !Object.hasOwn(record, "recoveringAffectedOperation")
    || Object.keys(record).some((key) => (
      key !== "config"
      && key !== "profile"
      && key !== "operation"
      && key !== "recoveringAffectedOperation"
      && key !== "signal"
    ))
    || typeof record.recoveringAffectedOperation !== "boolean"
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
  let profile;
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
    model,
    profile,
    operation: parseOperation(record.operation),
    recoveringAffectedOperation: record.recoveringAffectedOperation,
    signal: record.signal as AbortSignal | undefined,
  });
}

function sameRoot(
  left: Readonly<ClaudeCodePortableSettingsRoot>,
  right: Readonly<ClaudeCodePortableSettingsRoot>,
): boolean {
  return left.rootKind === right.rootKind
    && left.rootId === right.rootId
    && left.configuredPlacement === right.configuredPlacement
    && left.resourceRef === right.resourceRef;
}

async function executeAtRoot(
  root: RootedDirectory,
  request: Readonly<ParsedRequest>,
) {
  if (request.recoveringAffectedOperation) {
    try {
      await settleClaudeCodePortableSettingsPublicationStages(
        root,
        request.signal === undefined ? {} : { signal: request.signal },
      );
    } catch (error: unknown) {
      if (error instanceof ClaudeCodePortableSettingsPublicationError) {
        if (error.reason === "aborted") fail("aborted", "$signal");
        fail("owner", "$stageRecovery");
      }
      throw error;
    }
  }
  let inspection;
  try {
    inspection = await inspectClaudeCodePortableSettings(
      root,
      request.signal === undefined ? {} : { signal: request.signal },
    );
  } catch (error: unknown) {
    if (error instanceof ClaudeCodePortableSettingsPublicationError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("owner", "$inspection");
    }
    throw error;
  }
  if (inspection.transition.status === "blocked") {
    fail("transition-blocked", "$transition");
  }
  if (inspection.transition.status === "current") {
    if (
      !request.recoveringAffectedOperation
      || inspection.sourceDigest !== request.operation.targetDigest
    ) {
      fail("source-stale", "$operation.sourceDigest");
    }
    return Object.freeze({
      disposition: "current" as const,
      sourceDigest: request.operation.sourceDigest,
      targetDigest: request.operation.targetDigest,
    });
  }
  if (inspection.transition.desiredDigest === null) {
    fail("owner", "$transition");
  }
  const expected = createClaudeCodePortableSettingsOperation(
    request.operation.authorityDigest,
    request.operation.root,
    inspection.transition.status,
    inspection.transition.sourceDigest,
    inspection.transition.desiredDigest,
  );
  if (expected.operationDigest !== request.operation.operationDigest) {
    fail("source-stale", "$operation.operationDigest");
  }
  let published;
  try {
    published = await publishClaudeCodePortableSettings(
      root,
      request.signal === undefined ? {} : { signal: request.signal },
    );
  } catch (error: unknown) {
    if (error instanceof ClaudeCodePortableSettingsPublicationError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "transition-blocked") {
        fail("transition-blocked", "$transition");
      }
      if (error.reason === "source-changed") {
        fail("source-stale", "$operation.sourceDigest");
      }
      fail("owner", "$publication");
    }
    throw error;
  }
  if (
    published.sourceDigest !== request.operation.sourceDigest
    || published.targetDigest !== request.operation.targetDigest
  ) {
    fail("owner", "$publication");
  }
  return published;
}

/** 执行一个 exact confirmed portable settings operation。 */
export async function executeClaudeCodePortableSettingsOperation(
  workspaceRootValue: RootedDirectory,
  requestValue: ExecuteClaudeCodePortableSettingsOperationRequest,
): Promise<Readonly<ClaudeCodePortableSettingsOperationExecutionResult>> {
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
  if (authority.authorityDigest !== request.operation.authorityDigest) {
    fail("authority-changed", "$operation.authorityDigest");
  }
  const authoritativeRoot = authority.roots.find((root) => (
    root.rootKind === request.operation.root.rootKind
    && root.rootId === request.operation.root.rootId
  ));
  if (
    authoritativeRoot === undefined
    || !sameRoot(authoritativeRoot, request.operation.root)
  ) {
    fail("authority-changed", "$operation.root");
  }

  let targetRoot = workspaceRootValue;
  let closeTarget = false;
  if (authoritativeRoot.rootKind === "support-surface") {
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
    const placement = placements.roots.find((entry) => (
      entry.key === `support.${authoritativeRoot.rootId}.root`
    ));
    if (placement?.state !== "present") fail("placement", "$supportRoot");
    try {
      targetRoot = await RootedDirectory.open(placement.absolutePath);
      closeTarget = true;
    } catch (error: unknown) {
      if (error instanceof RootedDirectoryError) fail("root-open", "$supportRoot");
      throw error;
    }
  }

  let executed: Awaited<ReturnType<typeof executeAtRoot>> | undefined;
  let primaryError: unknown;
  try {
    executed = await executeAtRoot(targetRoot, request);
  } catch (error: unknown) {
    primaryError = error;
  }
  let closeError: unknown;
  if (closeTarget) {
    try {
      await targetRoot.close();
    } catch (error: unknown) {
      closeError = error;
    }
  }
  if (primaryError !== undefined) throw primaryError;
  if (closeError !== undefined) fail("close-failure", "$supportRoot");
  if (executed === undefined) fail("owner", "$execution");
  return Object.freeze({
    kind: "ClaudeCodePortableSettingsOperationExecutionResult",
    operationId: request.operation.operationId,
    root: request.operation.root,
    disposition: executed.disposition,
    sourceDigest: executed.sourceDigest,
    targetDigest: executed.targetDigest,
  });
}
