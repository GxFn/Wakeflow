import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  assertWakeflowMaintenanceGateContext,
  type WakeflowMaintenanceGateContext,
} from "../../workspace/maintenance/wakeflow-maintenance-gate.js";
import {
  createWakeflowHostMaintenanceContribution,
} from "../../workspace/maintenance/wakeflow-host-maintenance-contribution.js";
import type {
  ExecuteWakeflowHostMaintenanceOperationRequest,
  PlanWakeflowHostMaintenanceContributionRequest,
  WakeflowHostMaintenanceCapability,
  WakeflowHostMaintenanceOperationReceipt,
} from "../../workspace/maintenance/wakeflow-host-maintenance-capability.js";
import {
  planClaudeCodePortableSettingsComposition,
} from "./claude-code-portable-settings-composition.js";
import {
  executeClaudeCodePortableSettingsOperation,
  ClaudeCodePortableSettingsOperationExecutionError,
} from "./claude-code-portable-settings-operation-executor.js";

/**
 * Wakeflow Host / Claude Code：当前 Claude 宿主维护 capability。
 *
 * 它把 portable settings 的多根只读计划转换成共享 contribution，并在唯一 Maintenance
 * Gate 内以闭合分派执行 exact operation。共享层不依赖本模块；未来新增 Claude 专属
 * 操作时也必须在这里显式扩展 operationKind，而不是注册动态 handler。
 */

export const CLAUDE_CODE_MAINTENANCE_CAPABILITY_ID =
  "claude-code-maintenance" as const;

export type ClaudeCodeMaintenanceCapabilityErrorReason =
  | "gate"
  | "operation"
  | "owner";

const ERROR_MESSAGES = {
  gate: "Claude Code maintenance capability requires the active matching gate.",
  operation: "Claude Code maintenance capability operation is invalid.",
  owner: "Claude Code maintenance capability owner failed.",
} as const satisfies Readonly<Record<
  ClaudeCodeMaintenanceCapabilityErrorReason,
  string
>>;

/** Claude Code maintenance capability 失败的稳定、脱敏错误。 */
export class ClaudeCodeMaintenanceCapabilityError extends Error {
  override readonly name = "ClaudeCodeMaintenanceCapabilityError";
  readonly code = "wakeflow-claude-code-maintenance-capability" as const;
  readonly reason: ClaudeCodeMaintenanceCapabilityErrorReason;
  readonly path: string;

  constructor(
    reason: ClaudeCodeMaintenanceCapabilityErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: ClaudeCodeMaintenanceCapabilityErrorReason,
  path: string,
): never {
  throw new ClaudeCodeMaintenanceCapabilityError(reason, path);
}

async function planContribution(
  root: RootedDirectory,
  request: PlanWakeflowHostMaintenanceContributionRequest,
) {
  const composition = await planClaudeCodePortableSettingsComposition(root, {
    action: request.action,
    config: request.config,
    profile: request.profile,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  });
  return createWakeflowHostMaintenanceContribution({
    hostId: "claude-code",
    capabilityId: CLAUDE_CODE_MAINTENANCE_CAPABILITY_ID,
    status: composition.status,
    sourcePlanDigest: composition.planDigest,
    blockerCodes: composition.blockerCodes,
    operations: composition.operations.map((operation) => ({
      operationId: operation.operationId,
      operationKind: "portable-settings",
      ownerId: "claude-code-portable-settings",
      targetKey:
        `settings:${operation.root.rootKind}:${operation.root.rootId}`,
      sourceDigest: operation.sourceDigest,
      targetDigest: operation.targetDigest,
      payload: operation,
    })),
  });
}

async function executeOperation(
  root: RootedDirectory,
  context: Readonly<WakeflowMaintenanceGateContext>,
  request: ExecuteWakeflowHostMaintenanceOperationRequest,
): Promise<Readonly<WakeflowHostMaintenanceOperationReceipt>> {
  try {
    assertWakeflowMaintenanceGateContext(context, root);
  } catch {
    fail("gate", "$context");
  }
  if (
    request.profile.hostId !== "claude-code"
    || request.operation.operationKind !== "portable-settings"
    || request.operation.ownerId !== "claude-code-portable-settings"
  ) {
    fail("operation", "$operation");
  }
  let executed;
  try {
    executed = await executeClaudeCodePortableSettingsOperation(root, {
      config: request.config,
      profile: request.profile,
      operation: request.operation.payload,
      recoveringAffectedOperation: request.recoveringAffectedOperation,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
  } catch (error: unknown) {
    if (error instanceof ClaudeCodePortableSettingsOperationExecutionError) {
      fail("owner", error.path);
    }
    throw error;
  }
  if (
    executed.operationId !== request.operation.operationId
    || executed.targetDigest !== request.operation.targetDigest
  ) {
    fail("owner", "$operation");
  }
  return Object.freeze({
    kind: "WakeflowHostMaintenanceOperationReceipt",
    operationId: executed.operationId,
    disposition: executed.disposition,
    observationDigest: executed.targetDigest,
  });
}

/** Claude Code 当前唯一、闭合的宿主维护端口实现。 */
export const claudeCodeMaintenanceCapability:
Readonly<WakeflowHostMaintenanceCapability> = Object.freeze({
  kind: "WakeflowHostMaintenanceCapability",
  hostId: "claude-code",
  capabilityId: CLAUDE_CODE_MAINTENANCE_CAPABILITY_ID,
  planContribution,
  executeOperation,
});
