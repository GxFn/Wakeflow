import { afterMutationRefresh } from "../../governance/observation/active-projection-refresh.js";
import { compileWakeflowFreshConfigSelection, WakeflowFreshConfigSelectionError, } from "../../configuration/wakeflow-fresh-config-selection.js";
import { parseWakeflowConfig, WakeflowConfigError, } from "../../configuration/wakeflow-config.js";
import { WAKEFLOW_MAINTENANCE_PUBLIC_REQUEST_SCHEMA, } from "../../contracts/generated/entrypoints/wakeflow-maintenance-public-request.generated.js";
import { WAKEFLOW_MAINTENANCE_PUBLIC_RESULT_SCHEMA, } from "../../contracts/generated/entrypoints/wakeflow-maintenance-public-result.generated.js";
import { JsonValueError, parseJsonValue, } from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import { fail } from "../../kernel/error.js";
import { runPublicationTransaction, } from "../../kernel/publication-transaction.js";
import { WakeflowMaintenanceExecutionPreviewError } from "../../workspace/maintenance/wakeflow-maintenance-execution-preview.js";
import { WakeflowMaintenanceExecutionTransactionError, } from "../../workspace/maintenance/wakeflow-maintenance-execution-transaction.js";
import { parseWakeflowMaintenanceOperationId, WakeflowMaintenanceOperationIdError, } from "../../workspace/maintenance/wakeflow-maintenance-operation-id.js";
import { parseWakeflowStaticMaterializationPreviewRequest, WakeflowStaticMaterializationPreviewError, } from "../../workspace/maintenance/wakeflow-static-materialization-preview-contract.js";
import { compileWakeflowWindowLaunchIntents, WakeflowWindowLaunchIntentError, } from "../../workspace/window-runtime/wakeflow-window-launch-intent.js";
/**
 * Wakeflow Capabilities / Workspace：`wakeflow_maintain_workspace` 切片（ADR-0013 试点）。
 *
 * 效果型调用：preview 零写推导维护计划并返回 `planDigest` 与窗口启动意图；apply 带
 * 同一请求与 `planDigest` 回来，Wakeflow 重算计划、比对摘要，再交给宿主固定的维护
 * 事务执行；recover 只凭操作标识完成被中断的事务。每个结果带 `next`。
 */
export const WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME = "wakeflow_maintain_workspace";
const WAKEFLOW_MAINTENANCE_PUBLIC_SCHEMA_VERSION = 1;
const validateRequest = createRuntimeJsonSchemaValidator(WAKEFLOW_MAINTENANCE_PUBLIC_REQUEST_SCHEMA);
const validateResult = createRuntimeJsonSchemaValidator(WAKEFLOW_MAINTENANCE_PUBLIC_RESULT_SCHEMA);
/** 公共 Maintenance 请求由 wire Schema 解析；失败以 `invalid-request` 报出。 */
function parseWakeflowMaintenancePublicRequest(value) {
    let json;
    try {
        json = parseJsonValue(value, "$request");
    }
    catch (error) {
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
function admitHostFacade(facade) {
    try {
        if (typeof facade !== "object" ||
            facade === null ||
            !Object.isFrozen(facade) ||
            !Object.isFrozen(facade.hostProfiles) ||
            typeof facade.preview !== "function" ||
            typeof facade.apply !== "function" ||
            typeof facade.recover !== "function") {
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
    }
    catch (error) {
        if (error instanceof WakeflowStaticMaterializationPreviewError) {
            fail("unexpected", "host-facade", "$facade", { cause: error });
        }
        throw error;
    }
}
function desiredConfigFor(input) {
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
    }
    catch (error) {
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
function mapPreviewError(error) {
    if (error instanceof WakeflowMaintenanceExecutionPreviewError) {
        if (error.reason === "aborted")
            fail("io-failure", "aborted", "$signal", { cause: error });
        if (error.reason === "input")
            fail("invalid-request", "preview-input", "$request", { cause: error });
        fail("precondition-failed", error.reason, "$request", { cause: error });
    }
    if (error instanceof WakeflowStaticMaterializationPreviewError) {
        if (error.reason === "aborted")
            fail("io-failure", "aborted", "$signal", { cause: error });
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
const TRANSACTION_ERROR_TABLE = Object.freeze({
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
function mapTransactionError(error) {
    if (error instanceof WakeflowMaintenanceExecutionTransactionError) {
        const [code, reason, path] = TRANSACTION_ERROR_TABLE[error.reason] ?? [
            "io-failure",
            null,
            "$request.root",
        ];
        // 事务已登记的操作标识随错误公开：中断后 Agent 只凭它调用 recover。
        const details = error.operationId === null || code === "invalid-request" || code === "precondition-failed"
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
function expectedLaunchIntents(plan, request, profiles) {
    if (request.action !== "fresh-initialize" ||
        plan.status !== "ready" ||
        request.desiredConfig === null) {
        return null;
    }
    return compileWakeflowWindowLaunchIntents(request.desiredConfig, profiles.currentHostProfile);
}
async function planMaintenance(context, input) {
    if (input.kind !== "effect") {
        fail("invalid-request", "mode", "$request.mode");
    }
    const { desiredConfig, compilation } = desiredConfigFor(input);
    const executionRequest = Object.freeze({
        action: input.action,
        desiredConfig,
        currentHostProfile: context.profiles.currentHostProfile,
        hostProfiles: context.profiles.hostProfiles,
    });
    let executionPlan;
    let launchIntentSet;
    try {
        executionPlan = await context.facade.preview(context.root, executionRequest);
        launchIntentSet = expectedLaunchIntents(executionPlan, executionRequest, context.profiles);
    }
    catch (error) {
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
function nextAfterLaunchIntents(launchIntentSet) {
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
function deriveNext(phase) {
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
    if (phase.mode === "apply")
        return nextAfterLaunchIntents(phase.plan.launchIntentSet);
    return nextAfterLaunchIntents(null);
}
function freshCompilationView(compilation) {
    return compilation === null
        ? null
        : Object.freeze({
            selectionDigest: compilation.selectionDigest,
            configDigest: compilation.configDigest,
            allocations: compilation.allocations,
        });
}
function publicResult(value) {
    const result = validateResult(parseJsonValue(value, "$result"));
    if (!result.ok) {
        fail("output-boundary", "result-schema", `$result${result.path.slice(1)}`);
    }
    return result.value;
}
function assembleResult(facade, input, phase, next) {
    const base = {
        schemaVersion: WAKEFLOW_MAINTENANCE_PUBLIC_SCHEMA_VERSION,
        tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
        hostId: facade.hostId,
        next,
    };
    if (phase.mode === "preview") {
        if (input.kind !== "effect")
            fail("unexpected", "phase-input", "$request");
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
        if (input.kind !== "effect")
            fail("unexpected", "phase-input", "$request");
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
function parseRequest(value) {
    const request = parseWakeflowMaintenancePublicRequest(value);
    if (request.mode === "recover") {
        let operationId;
        try {
            operationId = parseWakeflowMaintenanceOperationId(request.operationId, "$request.operationId");
        }
        catch (error) {
            mapTransactionError(error);
        }
        return Object.freeze({
            envelope: Object.freeze({
                root: request.root,
                mode: "recover",
                planDigest: null,
                operationId,
            }),
            input: Object.freeze({ kind: "recover" }),
        });
    }
    const planDigest = request.mode === "apply" ? request.planDigest : null;
    return Object.freeze({
        envelope: Object.freeze({
            root: request.root,
            mode: request.mode,
            planDigest,
            operationId: null,
        }),
        input: Object.freeze({
            kind: "effect",
            action: request.action,
            body: request.request,
        }),
    });
}
/** 使用宿主 entrypoint 固定提供的 facade 执行一个公共 Maintenance 请求。 */
export async function executeWakeflowMaintenancePublicRequest(facade, value) {
    const profiles = admitHostFacade(facade);
    return runPublicationTransaction({
        tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
        parseRequest,
        open: async (root) => Object.freeze({ root, facade, profiles }),
        close: async () => { },
        plan: planMaintenance,
        apply: async (context, _input, plan) => {
            try {
                // 维护 apply 之后刷新一次活动投影：reconfigure 换语言或配置摘要、reconcile 重建派生文件（§13.94 D5）。
                return await afterMutationRefresh(context.root, undefined, () => context.facade.apply(context.root, plan.executionPlan, plan.executionRequest));
            }
            catch (error) {
                mapTransactionError(error);
            }
        },
        recover: async (context, operationId) => {
            try {
                return await context.facade.recover(context.root, parseWakeflowMaintenanceOperationId(operationId, "$request.operationId"));
            }
            catch (error) {
                mapTransactionError(error);
            }
        },
        next: async (_context, phase) => deriveNext(phase),
        result: (_envelope, input, phase, next) => assembleResult(facade, input, phase, next),
    }, value);
}
