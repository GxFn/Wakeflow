import path from "node:path";
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
import { convergeWakeflowPrivateModes, inspectWakeflowPrivateModes, wakeflowPrivateModeAreas, WakeflowPrivateModeCensusError, } from "../../workspace/maintenance/wakeflow-private-mode-census.js";
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
            typeof facade.recover !== "function" ||
            !(facade.artifactRoot === null ||
                (typeof facade.artifactRoot === "string" && path.isAbsolute(facade.artifactRoot)))) {
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
            // 配置文法的拒绝点名到条目（§13.130 审查 D9-2）：路径指到 desiredConfig 里的那一处，
            // details.configReason 是文法原因（topology、reference……），原因码保持 desired-config。
            const detailed = `$request.request.desiredConfig${error.path.startsWith("$/") ? error.path.slice(1) : ""}`;
            fail("invalid-request", "desired-config", detailed.length <= 256 && /^\$[A-Za-z0-9_.[\]$/-]*$/u.test(detailed)
                ? detailed
                : "$request.request.desiredConfig", { cause: error, details: { configReason: error.reason } });
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
// 穷尽表：事务新增 reason 时编译器要求在此显式决定其公开映射。
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
    transaction: ["io-failure", null, "$request.root"],
    step: ["io-failure", null, "$request.root"],
});
function mapTransactionError(error) {
    if (error instanceof WakeflowMaintenanceExecutionTransactionError) {
        const [code, reason, path] = TRANSACTION_ERROR_TABLE[error.reason];
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
/** a 包含 b（或相等）：用规范化绝对路径的词法关系判断。 */
function pathContains(container, candidate) {
    const relative = path.relative(container, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
/**
 * 工作区不得包含已装载的制品、不得位于其中，配置根也不得与之重叠（旧实现 bootstrap 的两条护栏）：
 * 否则维护会把受管文件写进插件自己的目录，或把插件目录当成产品仓库。reconcile 没有 desired
 * Config，只查工作区根；fresh 与 reconfigure 连配置根一起查。
 */
function deriveArtifactOverlapBlockers(rootPath, desiredConfig, artifactRoot) {
    if (artifactRoot === null)
        return Object.freeze([]);
    const blockers = [];
    if (pathContains(rootPath, artifactRoot) || pathContains(artifactRoot, rootPath)) {
        blockers.push("workspace-root-overlaps-artifact");
    }
    if (desiredConfig !== null) {
        const placements = [
            ...desiredConfig.topology.repositories.map((entry) => entry.path),
            ...desiredConfig.topology.supportSurfaces.map((entry) => entry.path),
            desiredConfig.storage.ledgerRoot,
        ];
        if (placements.some((placement) => {
            const resolved = path.resolve(rootPath, placement);
            return pathContains(resolved, artifactRoot) || pathContains(artifactRoot, resolved);
        })) {
            blockers.push("configured-root-overlaps-artifact");
        }
    }
    return Object.freeze(blockers);
}
function blockedPlan(blockers) {
    return Object.freeze({
        status: "blocked",
        blockers: Object.freeze(blockers),
        plan: null,
        digest: null,
    });
}
function mapCensusError(error) {
    if (error instanceof WakeflowPrivateModeCensusError) {
        if (error.reason === "aborted")
            fail("io-failure", "aborted", "$signal", { cause: error });
        if (error.reason === "input")
            fail("unexpected", "private-mode-census", "$request.root", { cause: error });
        fail("io-failure", "private-mode-convergence", "$request.root", { cause: error });
    }
    throw error;
}
/**
 * 私有树的模式普查先于布局预览（§13.124 D8，§13.130）：只有安全漂移时，reconcile 的计划就是收敛
 * 本身，摘要是普查摘要；其余意图以 `private-mode-drift` 阻塞（先 reconcile）。unsafe 节点一律
 * 阻塞并按区域报出，只报告、从不修。普查读不出不遮蔽预览，由布局检查照常报告。
 */
async function privateModePlan(context, action) {
    let census;
    try {
        census = await inspectWakeflowPrivateModes(context.root);
    }
    catch (error) {
        mapCensusError(error);
    }
    if (census.status === "current" || census.status === "unavailable")
        return null;
    if (census.status === "unsafe") {
        return blockedPlan(wakeflowPrivateModeAreas(census.unsafe).map((area) => `private-mode-unsafe:${area}`.slice(0, 128)));
    }
    if (action !== "reconcile")
        return blockedPlan(["private-mode-drift"]);
    const directories = census.drifted.filter((entry) => entry.node.kind === "directory").length;
    const view = Object.freeze({
        kind: "WakeflowPrivateModeConvergencePlan",
        schemaVersion: 1,
        driftedDirectories: directories,
        driftedFiles: census.drifted.length - directories,
        areas: wakeflowPrivateModeAreas(census.drifted.map((entry) => entry.resourcePath)),
    });
    return Object.freeze({
        status: "ready",
        blockers: Object.freeze([]),
        plan: Object.freeze({ kind: "private-mode-convergence", census, view }),
        digest: census.censusDigest,
    });
}
async function convergePrivateModes(context, plan) {
    let receipt;
    try {
        receipt = await convergeWakeflowPrivateModes(context.root, plan.census);
    }
    catch (error) {
        mapCensusError(error);
    }
    return Object.freeze({
        status: "completed",
        operationId: null,
        planDigest: plan.census.censusDigest,
        stepReceipts: Object.freeze([
            Object.freeze({
                kind: "WakeflowPrivateModeConvergenceReceipt",
                converged: receipt.converged,
                current: receipt.current,
                changed: receipt.changed,
            }),
        ]),
    });
}
async function planMaintenance(context, input) {
    if (input.kind !== "effect") {
        fail("invalid-request", "mode", "$request.mode");
    }
    const { desiredConfig, compilation } = desiredConfigFor(input);
    const overlap = deriveArtifactOverlapBlockers(context.root.absolutePath, desiredConfig, context.facade.artifactRoot);
    if (overlap.length > 0)
        return blockedPlan(overlap);
    const privateModes = await privateModePlan(context, input.action);
    if (privateModes !== null)
        return privateModes;
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
            ? Object.freeze({
                kind: "materialization",
                executionPlan,
                executionRequest,
                compilation,
                launchIntentSet,
            })
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
    if (phase.mode === "apply") {
        if (phase.plan.kind === "private-mode-convergence") {
            // 模式收回之后布局检查才看得见其余问题：再预览一次 reconcile。
            return Object.freeze({
                frontier: "workspace-maintenance",
                owner: "controller",
                suggestedTool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
                blockers: Object.freeze([]),
            });
        }
        return nextAfterLaunchIntents(phase.plan.launchIntentSet);
    }
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
function materializationOf(plan) {
    return plan?.kind === "materialization" ? plan : null;
}
/** preview 的 `plan`：物化计划公开执行计划，私有模式收敛公开它的视图（§13.130 D8）。 */
function previewResultOf(base, action, planned) {
    const materialization = materializationOf(planned.plan);
    const launchIntentSet = materialization?.launchIntentSet ?? null;
    return publicResult({
        kind: "WakeflowMaintenancePublicPreviewResult",
        ...base,
        mode: "preview",
        action,
        status: planned.status,
        blockerCodes: planned.blockers,
        planDigest: planned.digest,
        plan: materialization?.executionPlan ??
            (planned.plan?.kind === "private-mode-convergence" ? planned.plan.view : null),
        freshConfigCompilation: freshCompilationView(materialization?.compilation ?? null),
        launchIntents: launchIntentSet?.intents ?? [],
        launchSetDigest: launchIntentSet?.launchSetDigest ?? null,
    });
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
        return previewResultOf(base, input.action, phase.planned);
    }
    if (phase.mode === "apply") {
        if (input.kind !== "effect")
            fail("unexpected", "phase-input", "$request");
        const launchIntentSet = materializationOf(phase.plan)?.launchIntentSet ?? null;
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
            if (plan.kind === "private-mode-convergence")
                return convergePrivateModes(context, plan);
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
