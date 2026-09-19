import { afterMutationRefresh } from "../../governance/observation/active-projection-refresh.js";
import {
  compileWakeflowFreshConfigSelection,
  WakeflowFreshConfigSelectionError,
  type WakeflowFreshConfigCompilation,
} from "../../configuration/wakeflow-fresh-config-selection.js";
import {
  parseWakeflowConfig,
  WakeflowConfigError,
  type WakeflowConfigModel,
} from "../../configuration/wakeflow-config.js";
import {
  WAKEFLOW_MAINTENANCE_PUBLIC_REQUEST_SCHEMA,
  type WakeflowMaintenancePublicRequestV1,
} from "../../contracts/generated/entrypoints/wakeflow-maintenance-public-request.generated.js";
import {
  WAKEFLOW_MAINTENANCE_PUBLIC_RESULT_SCHEMA,
  type WakeflowMaintenancePublicResultV1,
} from "../../contracts/generated/entrypoints/wakeflow-maintenance-public-result.generated.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import type { WakeflowErrorCode } from "../../contracts/vocabulary/wakeflow-error-code.js";
import { fail } from "../../kernel/error.js";
import type { NextProjection } from "../../kernel/next-projection.js";
import {
  runPublicationTransaction,
  type PublicationTransactionEnvelope,
  type PublicationTransactionPhase,
  type PublicationTransactionPlan,
} from "../../kernel/publication-transaction.js";
import type { WakeflowMaintenanceExecutionPlan } from "../../workspace/maintenance/wakeflow-maintenance-execution-plan.js";
import { WakeflowMaintenanceExecutionPreviewError } from "../../workspace/maintenance/wakeflow-maintenance-execution-preview.js";
import {
  WakeflowMaintenanceExecutionTransactionError,
  type WakeflowMaintenanceExecutionTransactionReceipt,
} from "../../workspace/maintenance/wakeflow-maintenance-execution-transaction.js";
import {
  parseWakeflowMaintenanceOperationId,
  WakeflowMaintenanceOperationIdError,
  type WakeflowMaintenanceOperationId,
} from "../../workspace/maintenance/wakeflow-maintenance-operation-id.js";
import type { WakeflowMaintenancePublicHostFacade } from "../../workspace/maintenance/wakeflow-maintenance-public-host-facade.js";
import {
  parseWakeflowStaticMaterializationPreviewRequest,
  WakeflowStaticMaterializationPreviewError,
  type WakeflowStaticMaterializationAction,
  type WakeflowStaticMaterializationPreviewRequest,
} from "../../workspace/maintenance/wakeflow-static-materialization-preview-contract.js";
import {
  compileWakeflowWindowLaunchIntents,
  WakeflowWindowLaunchIntentError,
  type WakeflowWindowLaunchIntentSet,
} from "../../workspace/window-runtime/wakeflow-window-launch-intent.js";
import type { WakeflowWorkspaceHostResourceProfile } from "../../workspace/workspace-host-resource-profile.js";

/**
 * Wakeflow Capabilities / Workspace：`wakeflow_maintain_workspace` 切片（ADR-0013 试点）。
 *
 * 效果型调用：preview 零写推导维护计划并返回 `planDigest` 与窗口启动意图；apply 带
 * 同一请求与 `planDigest` 回来，Wakeflow 重算计划、比对摘要，再交给宿主固定的维护
 * 事务执行；recover 只凭操作标识完成被中断的事务。每个结果带 `next`。
 */

export const WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME = "wakeflow_maintain_workspace" as const;
const WAKEFLOW_MAINTENANCE_PUBLIC_SCHEMA_VERSION = 1 as const;

type WakeflowMaintenancePublicRequest = Readonly<WakeflowMaintenancePublicRequestV1>;
export type WakeflowMaintenancePublicResult = Readonly<WakeflowMaintenancePublicResultV1>;

const validateRequest = createRuntimeJsonSchemaValidator<WakeflowMaintenancePublicRequestV1>(
  WAKEFLOW_MAINTENANCE_PUBLIC_REQUEST_SCHEMA,
);
const validateResult = createRuntimeJsonSchemaValidator<WakeflowMaintenancePublicResultV1>(
  WAKEFLOW_MAINTENANCE_PUBLIC_RESULT_SCHEMA,
);

type SliceInput =
  | Readonly<{
      readonly kind: "effect";
      readonly action: WakeflowStaticMaterializationAction;
      readonly body: Readonly<Record<string, JsonValue>>;
    }>
  | Readonly<{ readonly kind: "recover" }>;

interface AdmittedHostProfiles {
  readonly currentHostProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly hostProfiles: readonly Readonly<WakeflowWorkspaceHostResourceProfile>[];
}

interface SliceContext {
  readonly root: RootedDirectory;
  readonly facade: Readonly<WakeflowMaintenancePublicHostFacade>;
  readonly profiles: Readonly<AdmittedHostProfiles>;
}

interface SlicePlan {
  readonly executionPlan: Readonly<WakeflowMaintenanceExecutionPlan>;
  readonly executionRequest: WakeflowStaticMaterializationPreviewRequest;
  readonly compilation: Readonly<WakeflowFreshConfigCompilation> | null;
  readonly launchIntentSet: Readonly<WakeflowWindowLaunchIntentSet> | null;
}

type SliceOutcome = Readonly<WakeflowMaintenanceExecutionTransactionReceipt>;

/** 公共 Maintenance 请求由 wire Schema 解析；失败以 `invalid-request` 报出。 */
function parseWakeflowMaintenancePublicRequest(value: unknown): WakeflowMaintenancePublicRequest {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$request");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) {
      fail("invalid-request", "not-json", error.path);
    }
    throw error;
  }
  const result = validateRequest(json);
  if (!result.ok) {
    fail("invalid-request", "schema", `$request${result.path.slice(1)}`);
  }
  return result.value;
}

function admitHostFacade(
  facade: Readonly<WakeflowMaintenancePublicHostFacade>,
): Readonly<AdmittedHostProfiles> {
  try {
    if (
      typeof facade !== "object" ||
      facade === null ||
      !Object.isFrozen(facade) ||
      !Object.isFrozen(facade.hostProfiles) ||
      typeof facade.preview !== "function" ||
      typeof facade.apply !== "function" ||
      typeof facade.recover !== "function"
    ) {
      fail("unexpected", "host-facade", "$facade");
    }
    const parsed = parseWakeflowStaticMaterializationPreviewRequest({
      action: "reconcile",
      desiredConfig: null,
      currentHostProfile: facade.currentHostProfile,
      hostProfiles: facade.hostProfiles,
    });
    if (parsed.currentHostProfile.hostId !== facade.hostId || parsed.signal !== undefined) {
      fail("unexpected", "host-facade", "$facade");
    }
    return Object.freeze({
      currentHostProfile: parsed.currentHostProfile,
      hostProfiles: parsed.hostProfiles,
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowStaticMaterializationPreviewError) {
      fail("unexpected", "host-facade", "$facade", { cause: error });
    }
    throw error;
  }
}

function desiredConfigFor(input: Extract<SliceInput, { readonly kind: "effect" }>): Readonly<{
  readonly desiredConfig: WakeflowConfigModel | null;
  readonly compilation: Readonly<WakeflowFreshConfigCompilation> | null;
}> {
  try {
    if (input.action === "fresh-initialize") {
      const compilation = compileWakeflowFreshConfigSelection(input.body.selection);
      return Object.freeze({ desiredConfig: compilation.config, compilation });
    }
    if (input.action === "reconfigure") {
      return Object.freeze({
        desiredConfig: parseWakeflowConfig(input.body.desiredConfig),
        compilation: null,
      });
    }
    return Object.freeze({ desiredConfig: null, compilation: null });
  } catch (error: unknown) {
    if (error instanceof WakeflowFreshConfigSelectionError) {
      fail("invalid-request", "selection", "$request.request.selection", {
        cause: error,
      });
    }
    if (error instanceof WakeflowConfigError) {
      fail("invalid-request", "desired-config", "$request.request.desiredConfig", {
        cause: error,
      });
    }
    throw error;
  }
}

function mapPreviewError(error: unknown): never {
  if (error instanceof WakeflowMaintenanceExecutionPreviewError) {
    if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
    if (error.reason === "input")
      fail("invalid-request", "preview-input", "$request", { cause: error });
    fail("precondition-failed", error.reason, "$request", { cause: error });
  }
  if (error instanceof WakeflowStaticMaterializationPreviewError) {
    if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
    if (error.reason === "root-scope")
      fail("root-invalid", "root-scope", "$request.root", { cause: error });
    if (error.reason === "inspection")
      fail("io-failure", "inspection", "$request.root", { cause: error });
    if (error.reason === "config")
      fail("precondition-failed", "config", "$request", { cause: error });
    fail("invalid-request", error.reason, "$request", { cause: error });
  }
  if (error instanceof WakeflowWindowLaunchIntentError) {
    fail("precondition-failed", "launch-intent", "$request", { cause: error });
  }
  throw error;
}

const TRANSACTION_ERROR_TABLE: Readonly<
  Record<string, readonly [WakeflowErrorCode, string | null, string]>
> = Object.freeze({
  aborted: ["io-failure", "aborted", "$signal"],
  input: ["invalid-request", "transaction-input", "$request"],
  "plan-blocked": ["precondition-failed", null, "$request.planDigest"],
  "plan-stale": ["precondition-failed", null, "$request.planDigest"],
  "source-config": ["precondition-failed", null, "$request.planDigest"],
  capability: ["precondition-failed", null, "$request.planDigest"],
  gate: ["concurrency-conflict", "maintenance-gate", "$request.root"],
  "recovery-required": ["recovery-required", null, "$request.root"],
  intent: ["recovery-required", null, "$request.root"],
  journal: ["recovery-required", null, "$request.root"],
  "terminal-closure": ["recovery-required", null, "$request.root"],
});

function mapTransactionError(error: unknown): never {
  if (error instanceof WakeflowMaintenanceExecutionTransactionError) {
    const [code, reason, path] = TRANSACTION_ERROR_TABLE[error.reason] ?? [
      "io-failure",
      null,
      "$request.root",
    ];
    // 事务已登记的操作标识随错误公开：中断后 Agent 只凭它调用 recover。
    const details =
      error.operationId === null || code === "invalid-request" || code === "precondition-failed"
        ? {}
        : { details: { operationId: error.operationId } };
    fail(code, reason ?? error.reason, path, {
      cause: error,
      retryable: code === "concurrency-conflict",
      ...details,
    });
  }
  if (error instanceof WakeflowMaintenanceOperationIdError) {
    fail("invalid-request", "operation-id", "$request.operationId", { cause: error });
  }
  throw error;
}

function expectedLaunchIntents(
  plan: Readonly<WakeflowMaintenanceExecutionPlan>,
  request: WakeflowStaticMaterializationPreviewRequest,
  profiles: Readonly<AdmittedHostProfiles>,
): Readonly<WakeflowWindowLaunchIntentSet> | null {
  if (
    request.action !== "fresh-initialize" ||
    plan.status !== "ready" ||
    request.desiredConfig === null
  ) {
    return null;
  }
  return compileWakeflowWindowLaunchIntents(request.desiredConfig, profiles.currentHostProfile);
}

async function planMaintenance(
  context: SliceContext,
  input: SliceInput,
): Promise<Readonly<PublicationTransactionPlan<SlicePlan>>> {
  if (input.kind !== "effect") {
    fail("invalid-request", "mode", "$request.mode");
  }
  const { desiredConfig, compilation } = desiredConfigFor(input);
  const executionRequest: WakeflowStaticMaterializationPreviewRequest = Object.freeze({
    action: input.action,
    desiredConfig,
    currentHostProfile: context.profiles.currentHostProfile,
    hostProfiles: context.profiles.hostProfiles,
  });
  let executionPlan: Readonly<WakeflowMaintenanceExecutionPlan>;
  let launchIntentSet: Readonly<WakeflowWindowLaunchIntentSet> | null;
  try {
    executionPlan = await context.facade.preview(context.root, executionRequest);
    launchIntentSet = expectedLaunchIntents(executionPlan, executionRequest, context.profiles);
  } catch (error: unknown) {
    mapPreviewError(error);
  }
  const ready = executionPlan.status === "ready";
  return Object.freeze({
    status: executionPlan.status,
    blockers: executionPlan.blockerCodes,
    plan: ready
      ? Object.freeze({ executionPlan, executionRequest, compilation, launchIntentSet })
      : null,
    digest: ready ? executionPlan.planDigest : null,
  });
}

function nextAfterLaunchIntents(
  launchIntentSet: Readonly<WakeflowWindowLaunchIntentSet> | null,
): Readonly<NextProjection> {
  if (launchIntentSet === null || launchIntentSet.intents.length === 0) {
    return Object.freeze({
      frontier: null,
      owner: "none",
      suggestedTool: null,
      blockers: Object.freeze([]),
    });
  }
  return Object.freeze({
    frontier: "window-launch",
    owner: "user",
    // 切片之间不互相引用；公共工具名是词汇，不是依赖。
    suggestedTool: "wakeflow_register_window_binding",
    blockers: Object.freeze([]),
  });
}

function deriveNext(
  phase: PublicationTransactionPhase<SlicePlan, SliceOutcome>,
): Readonly<NextProjection> {
  if (phase.mode === "preview") {
    if (phase.planned.status === "ready") {
      return Object.freeze({
        frontier: "workspace-maintenance-apply",
        owner: "user",
        suggestedTool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
        blockers: Object.freeze([]),
      });
    }
    return Object.freeze({
      frontier: "workspace-maintenance-blocked",
      owner: "user",
      suggestedTool: null,
      blockers: Object.freeze([...phase.planned.blockers].slice(0, 32)),
    });
  }
  if (phase.mode === "apply") return nextAfterLaunchIntents(phase.plan.launchIntentSet);
  return nextAfterLaunchIntents(null);
}

function freshCompilationView(compilation: Readonly<WakeflowFreshConfigCompilation> | null) {
  return compilation === null
    ? null
    : Object.freeze({
        selectionDigest: compilation.selectionDigest,
        configDigest: compilation.configDigest,
        allocations: compilation.allocations,
      });
}

function publicResult(value: unknown): WakeflowMaintenancePublicResult {
  const result = validateResult(parseJsonValue(value, "$result"));
  if (!result.ok) {
    fail("output-boundary", "result-schema", `$result${result.path.slice(1)}`);
  }
  return result.value;
}

function assembleResult(
  facade: Readonly<WakeflowMaintenancePublicHostFacade>,
  input: SliceInput,
  phase: PublicationTransactionPhase<SlicePlan, SliceOutcome>,
  next: Readonly<NextProjection>,
): WakeflowMaintenancePublicResult {
  const base = {
    schemaVersion: WAKEFLOW_MAINTENANCE_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    hostId: facade.hostId,
    next,
  };
  if (phase.mode === "preview") {
    if (input.kind !== "effect") fail("unexpected", "phase-input", "$request");
    const planned = phase.planned;
    const launchIntentSet = planned.plan?.launchIntentSet ?? null;
    return publicResult({
      kind: "WakeflowMaintenancePublicPreviewResult",
      ...base,
      mode: "preview",
      action: input.action,
      status: planned.status,
      blockerCodes: planned.blockers,
      planDigest: planned.digest,
      plan: planned.plan?.executionPlan ?? null,
      freshConfigCompilation: freshCompilationView(planned.plan?.compilation ?? null),
      launchIntents: launchIntentSet?.intents ?? [],
      launchSetDigest: launchIntentSet?.launchSetDigest ?? null,
    });
  }
  if (phase.mode === "apply") {
    if (input.kind !== "effect") fail("unexpected", "phase-input", "$request");
    const launchIntentSet = phase.plan.launchIntentSet;
    return publicResult({
      kind: "WakeflowMaintenancePublicMutationResult",
      ...base,
      mode: "apply",
      action: input.action,
      status: phase.outcome.status,
      operationId: phase.outcome.operationId,
      planDigest: phase.outcome.planDigest,
      stepReceipts: phase.outcome.stepReceipts,
      launchIntents: launchIntentSet?.intents ?? [],
      launchSetDigest: launchIntentSet?.launchSetDigest ?? null,
    });
  }
  return publicResult({
    kind: "WakeflowMaintenancePublicMutationResult",
    ...base,
    mode: "recover",
    action: null,
    status: phase.outcome.status,
    operationId: phase.outcome.operationId,
    planDigest: phase.outcome.planDigest,
    stepReceipts: phase.outcome.stepReceipts,
    launchIntents: [],
    launchSetDigest: null,
  });
}

function parseRequest(value: unknown): Readonly<{
  readonly envelope: PublicationTransactionEnvelope;
  readonly input: SliceInput;
}> {
  const request = parseWakeflowMaintenancePublicRequest(value);
  if (request.mode === "recover") {
    let operationId: WakeflowMaintenanceOperationId;
    try {
      operationId = parseWakeflowMaintenanceOperationId(
        request.operationId,
        "$request.operationId",
      );
    } catch (error: unknown) {
      mapTransactionError(error);
    }
    return Object.freeze({
      envelope: Object.freeze({
        root: request.root,
        mode: "recover" as const,
        planDigest: null,
        operationId,
      }),
      input: Object.freeze({ kind: "recover" as const }),
    });
  }
  const planDigest = request.mode === "apply" ? (request.planDigest as Sha256Digest) : null;
  return Object.freeze({
    envelope: Object.freeze({
      root: request.root,
      mode: request.mode,
      planDigest,
      operationId: null,
    }),
    input: Object.freeze({
      kind: "effect" as const,
      action: request.action,
      body: request.request as Readonly<Record<string, JsonValue>>,
    }),
  });
}

/** 使用宿主 entrypoint 固定提供的 facade 执行一个公共 Maintenance 请求。 */
export async function executeWakeflowMaintenancePublicRequest(
  facade: Readonly<WakeflowMaintenancePublicHostFacade>,
  value: unknown,
): Promise<WakeflowMaintenancePublicResult> {
  const profiles = admitHostFacade(facade);
  return runPublicationTransaction<
    SliceInput,
    SliceContext,
    SlicePlan,
    SliceOutcome,
    WakeflowMaintenancePublicResult
  >(
    {
      tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
      parseRequest,
      open: async (root) => Object.freeze({ root, facade, profiles }),
      close: async () => {},
      plan: planMaintenance,
      apply: async (context, _input, plan) => {
        try {
          // 维护 apply 之后刷新一次活动投影：reconfigure 换语言或配置摘要、reconcile 重建派生文件（§13.94 D5）。
          return await afterMutationRefresh(context.root, undefined, () =>
            context.facade.apply(context.root, plan.executionPlan, plan.executionRequest),
          );
        } catch (error: unknown) {
          mapTransactionError(error);
        }
      },
      recover: async (context, operationId) => {
        try {
          return await context.facade.recover(
            context.root,
            parseWakeflowMaintenanceOperationId(operationId, "$request.operationId"),
          );
        } catch (error: unknown) {
          mapTransactionError(error);
        }
      },
      next: async (_context, phase) => deriveNext(phase),
      result: (_envelope, input, phase, next) => assembleResult(facade, input, phase, next),
    },
    value,
  );
}
