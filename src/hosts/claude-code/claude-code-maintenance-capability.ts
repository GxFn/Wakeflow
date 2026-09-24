import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import type {
  ExecuteWakeflowHostMaintenanceOperationRequest,
  PlanWakeflowHostMaintenanceContributionRequest,
  WakeflowHostMaintenanceCapability,
  WakeflowHostMaintenanceOperationReceipt,
} from "../../workspace/maintenance/wakeflow-host-maintenance-capability.js";
import {
  createWakeflowHostMaintenanceContribution,
} from "../../workspace/maintenance/wakeflow-host-maintenance-contribution.js";
import {
  assertWakeflowMaintenanceGateContext,
  type WakeflowMaintenanceGateContext,
  WakeflowMaintenanceGateError,
} from "../../workspace/maintenance/wakeflow-maintenance-gate.js";
import { WakeflowWindowRuntimeProjectionError } from "../../workspace/window-runtime/wakeflow-window-runtime-projection-inspection.js";
import {
  executeWakeflowWindowRuntimeProjectionOperation,
  planWakeflowWindowRuntimeProjectionMaintenance,
  WAKEFLOW_WINDOW_RUNTIME_PROJECTION_OPERATION_KIND,
  WAKEFLOW_WINDOW_RUNTIME_PROJECTION_OWNER_ID,
} from "../../workspace/window-runtime/wakeflow-window-runtime-projection-maintenance.js";
import { ClaudeCodeHostAssetOperationError } from "./claude-code-host-asset-operation.js";
import {
  planClaudeCodePortableSettingsComposition,
} from "./claude-code-portable-settings-composition.js";
import {
  ClaudeCodePortableSettingsOperationExecutionError,
  executeClaudeCodePortableSettingsOperation,
} from "./claude-code-portable-settings-operation-executor.js";
import {
  CLAUDE_CODE_STATUSLINE_ASSET_OPERATION_KIND,
  CLAUDE_CODE_STATUSLINE_ASSET_OWNER_ID,
  executeClaudeCodeStatuslineAssetOperation,
  planClaudeCodeStatuslineAssetOperation,
} from "./claude-code-statusline-asset-operation.js";
import {
  CLAUDE_CODE_STATUSLINE_SETTINGS_BLOCKER,
  CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_KIND,
  CLAUDE_CODE_STATUSLINE_SETTINGS_OWNER_ID,
  ClaudeCodeStatuslineSettingsOperationError,
  executeClaudeCodeStatuslineSettingsOperation,
  planClaudeCodeStatuslineSettingsOperation,
} from "./claude-code-statusline-settings-operation.js";
import {
  CLAUDE_CODE_TMUX_ASSET_BLOCKER,
  CLAUDE_CODE_TMUX_ASSET_OPERATION_KIND,
  CLAUDE_CODE_TMUX_ASSET_OWNER_ID,
  executeClaudeCodeTmuxAssetOperation,
  planClaudeCodeTmuxAssetOperation,
} from "./claude-code-tmux-asset-operation.js";
import { claudeCodeWindowHostIdentityProfile } from "./claude-code-window-host-identity-profile.js";

/**
 * Wakeflow Host / Claude Code：当前 Claude 宿主维护 capability。
 *
 * 它把 portable settings 的多根只读计划、两份资产（状态栏、tmux 助手）的字节核对与本地设置里
 * 状态栏条目的核对转换成共享 contribution，并在唯一 Maintenance Gate 内以闭合分派执行 exact
 * operation。共享层不依赖本模块；每种 operationKind 都在这里显式分派，不注册动态 handler。
 * 资产字节或本地设置读不稳时贡献 blocked 并带稳定 blocker，不把未分类的宿主错误抛给
 * 维护预览：读不出的宿主制品不能让整个工作区无法维护。
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

/** 资产读不出（目录、符号链接、超过 256 KiB、权限不足）时宿主贡献报出的 blocker。 */
export const CLAUDE_CODE_STATUSLINE_ASSET_BLOCKER =
  "claude-statusline-asset-unreadable" as const;

interface HostAssetPlan {
  readonly operation: Awaited<ReturnType<typeof planClaudeCodeStatuslineAssetOperation>>;
  readonly blocker: string | null;
}

interface StatuslineSettingsPlan {
  readonly operation: Awaited<ReturnType<typeof planClaudeCodeStatuslineSettingsOperation>>;
  readonly blocker: string | null;
}

/** 资产字节读不稳时不猜：整份贡献 blocked，不带该操作，而不是抛出未分类的宿主错误。 */
async function planHostAsset(
  plan: (options: { readonly signal?: AbortSignal }) => Promise<HostAssetPlan["operation"]>,
  blocker: string,
  signal: AbortSignal | undefined,
): Promise<HostAssetPlan> {
  try {
    return {
      operation: await plan(signal === undefined ? {} : { signal }),
      blocker: null,
    };
  } catch (error: unknown) {
    if (error instanceof ClaudeCodeHostAssetOperationError) {
      if (error.reason === "read") return { operation: null, blocker };
      fail("owner", error.path);
    }
    throw error;
  }
}

/** 本地设置读不出或不是 JSON 对象时不猜：整份贡献 blocked，不带该操作。 */
async function planStatuslineSettings(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<StatuslineSettingsPlan> {
  try {
    return {
      operation: await planClaudeCodeStatuslineSettingsOperation(root, {
        ...(signal === undefined ? {} : { signal }),
      }),
      blocker: null,
    };
  } catch (error: unknown) {
    if (error instanceof ClaudeCodeStatuslineSettingsOperationError) {
      if (error.reason === "settings-unreadable") {
        return { operation: null, blocker: CLAUDE_CODE_STATUSLINE_SETTINGS_BLOCKER };
      }
      fail("owner", error.path);
    }
    throw error;
  }
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
  const statusline = await planHostAsset(
    (options) => planClaudeCodeStatuslineAssetOperation(root, options),
    CLAUDE_CODE_STATUSLINE_ASSET_BLOCKER,
    request.signal,
  );
  const tmuxAsset = await planHostAsset(
    (options) => planClaudeCodeTmuxAssetOperation(root, options),
    CLAUDE_CODE_TMUX_ASSET_BLOCKER,
    request.signal,
  );
  const settings = await planStatuslineSettings(root, request.signal);
  const projections = await planProjections(root, request);
  // blocker 在边界内排序去重前必须互不相同：五个来源的前缀各不相同。
  const blockerCodes = [
    ...composition.blockerCodes,
    ...(statusline.blocker === null ? [] : [statusline.blocker]),
    ...(tmuxAsset.blocker === null ? [] : [tmuxAsset.blocker]),
    ...(settings.blocker === null ? [] : [settings.blocker]),
    ...projections.blockerCodes,
  ];
  return createWakeflowHostMaintenanceContribution({
    hostId: "claude-code",
    capabilityId: CLAUDE_CODE_MAINTENANCE_CAPABILITY_ID,
    status: blockerCodes.length === 0 ? "ready" : "blocked",
    blockerCodes,
    operations: [
      ...composition.operations.map((operation) => ({
        operationId: operation.operationId,
        operationKind: "portable-settings",
        ownerId: "claude-code-portable-settings",
        targetKey:
          `settings:${operation.root.rootKind}:${operation.root.rootId}`,
        sourceDigest: operation.sourceDigest,
        targetDigest: operation.targetDigest,
        payload: operation,
      })),
      ...(statusline.operation === null ? [] : [statusline.operation]),
      ...(tmuxAsset.operation === null ? [] : [tmuxAsset.operation]),
      ...(settings.operation === null ? [] : [settings.operation]),
      ...projections.operations,
    ],
  });
}

/** 对账时缺失或过期的窗口运行投影：与 Codex 共用同一 workspace owner，只换 identity profile。 */
async function planProjections(
  root: RootedDirectory,
  request: PlanWakeflowHostMaintenanceContributionRequest,
) {
  try {
    return await planWakeflowWindowRuntimeProjectionMaintenance(root, {
      action: request.action,
      config: request.config,
      resourceProfile: request.profile,
      identityProfile: claudeCodeWindowHostIdentityProfile,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowRuntimeProjectionError) {
      fail("owner", error.path);
    }
    throw error;
  }
}

async function executeProjectionOperation(
  root: RootedDirectory,
  request: ExecuteWakeflowHostMaintenanceOperationRequest,
): Promise<Readonly<WakeflowHostMaintenanceOperationReceipt>> {
  try {
    return await executeWakeflowWindowRuntimeProjectionOperation(root, {
      config: request.config,
      resourceProfile: request.profile,
      identityProfile: claudeCodeWindowHostIdentityProfile,
      operationId: request.operation.operationId,
      targetKey: request.operation.targetKey,
      targetDigest: request.operation.targetDigest,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowRuntimeProjectionError) {
      fail("owner", error.path);
    }
    throw error;
  }
}

async function executeHostAssetOperation(
  execute: typeof executeClaudeCodeStatuslineAssetOperation,
  root: RootedDirectory,
  request: ExecuteWakeflowHostMaintenanceOperationRequest,
): Promise<Readonly<WakeflowHostMaintenanceOperationReceipt>> {
  try {
    const executed = await execute(root, {
      operation: request.operation.payload,
      recoveringAffectedOperation: request.recoveringAffectedOperation,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    if (
      executed.operationId !== request.operation.operationId
      || executed.targetDigest !== request.operation.targetDigest
    ) {
      fail("owner", "$operation");
    }
    return Object.freeze({
      operationId: executed.operationId,
      disposition: executed.disposition,
      observationDigest: executed.targetDigest,
    });
  } catch (error: unknown) {
    if (error instanceof ClaudeCodeHostAssetOperationError) fail("owner", error.path);
    throw error;
  }
}

async function executeStatuslineSettingsOperation(
  root: RootedDirectory,
  request: ExecuteWakeflowHostMaintenanceOperationRequest,
): Promise<Readonly<WakeflowHostMaintenanceOperationReceipt>> {
  try {
    const executed = await executeClaudeCodeStatuslineSettingsOperation(root, {
      operation: request.operation.payload,
      sourceDigest: request.operation.sourceDigest,
      targetDigest: request.operation.targetDigest,
      recoveringAffectedOperation: request.recoveringAffectedOperation,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    if (executed.operationId !== request.operation.operationId) fail("owner", "$operation");
    return Object.freeze({
      operationId: executed.operationId,
      disposition: executed.disposition,
      observationDigest: executed.targetDigest,
    });
  } catch (error: unknown) {
    if (error instanceof ClaudeCodeStatuslineSettingsOperationError) fail("owner", error.path);
    throw error;
  }
}

async function executeOperation(
  root: RootedDirectory,
  context: Readonly<WakeflowMaintenanceGateContext>,
  request: ExecuteWakeflowHostMaintenanceOperationRequest,
): Promise<Readonly<WakeflowHostMaintenanceOperationReceipt>> {
  try {
    assertWakeflowMaintenanceGateContext(context, root);
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceGateError) {
      fail("gate", "$context");
    }
    throw error;
  }
  if (request.profile.hostId !== "claude-code") fail("operation", "$operation");
  if (
    request.operation.operationKind === CLAUDE_CODE_STATUSLINE_ASSET_OPERATION_KIND
    && request.operation.ownerId === CLAUDE_CODE_STATUSLINE_ASSET_OWNER_ID
  ) {
    return executeHostAssetOperation(executeClaudeCodeStatuslineAssetOperation, root, request);
  }
  if (
    request.operation.operationKind === CLAUDE_CODE_TMUX_ASSET_OPERATION_KIND
    && request.operation.ownerId === CLAUDE_CODE_TMUX_ASSET_OWNER_ID
  ) {
    return executeHostAssetOperation(executeClaudeCodeTmuxAssetOperation, root, request);
  }
  if (
    request.operation.operationKind === CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_KIND
    && request.operation.ownerId === CLAUDE_CODE_STATUSLINE_SETTINGS_OWNER_ID
  ) {
    return executeStatuslineSettingsOperation(root, request);
  }
  if (
    request.operation.operationKind === WAKEFLOW_WINDOW_RUNTIME_PROJECTION_OPERATION_KIND
    && request.operation.ownerId === WAKEFLOW_WINDOW_RUNTIME_PROJECTION_OWNER_ID
  ) {
    return executeProjectionOperation(root, request);
  }
  if (
    request.operation.operationKind !== "portable-settings"
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
