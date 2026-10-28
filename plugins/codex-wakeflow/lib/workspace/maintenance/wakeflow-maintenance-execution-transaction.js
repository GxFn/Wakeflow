import { types } from "node:util";
import { computeWakeflowConfigDigest, } from "../../configuration/wakeflow-config.js";
import { readWakeflowConfigAuthoritySnapshot, readWakeflowDetachedConfigRecord, WakeflowConfigAuthoritySnapshotError, } from "../../configuration/wakeflow-config-authority-snapshot.js";
import { PassiveOwnDataError, parsePlainRecord } from "../../foundation/data/passive-own-data.js";
import { inspectRootedExclusiveFileLock, RootedExclusiveFileLockError, retireRootedExclusiveFileLockResidue, } from "../../foundation/filesystem/rooted-exclusive-file-lock.js";
import { createWakeflowWorkspaceStaticResourceMatrix } from "../wakeflow-workspace-static-resource-matrix.js";
import { assertWakeflowHostMaintenanceCapability, assertWakeflowHostMaintenanceContributionCapability, WakeflowHostMaintenanceCapabilityError, } from "./wakeflow-host-maintenance-capability.js";
import { computeWakeflowMaintenanceExecutionIntentDigest, createWakeflowMaintenanceExecutionIntent, reconstructWakeflowMaintenanceExecutionFromIntent, WakeflowMaintenanceExecutionIntentError, } from "./wakeflow-maintenance-execution-intent.js";
import { assertWakeflowMaintenanceExecutionIntentCapacity, assertWakeflowMaintenanceIntentAndJournalAreOnlyTransaction, assertWakeflowMaintenanceIntentIsOnlyTransactionPrefix, publishWakeflowMaintenanceExecutionIntent, readWakeflowMaintenanceExecutionIntent, readWakeflowMaintenanceExecutionIntentOrNull, recoverWakeflowMaintenanceExecutionIntentStages, retireWakeflowMaintenanceExecutionIntent, WakeflowMaintenanceExecutionIntentStoreError, } from "./wakeflow-maintenance-execution-intent-store.js";
import { parseWakeflowMaintenanceExecutionPlan, } from "./wakeflow-maintenance-execution-plan.js";
import { previewWakeflowMaintenanceExecution, WakeflowMaintenanceExecutionPreviewError, } from "./wakeflow-maintenance-execution-preview.js";
import { WakeflowMaintenanceGateError, withExistingWakeflowMaintenanceGate, withWakeflowMaintenanceGate, } from "./wakeflow-maintenance-gate.js";
import { beginWakeflowMaintenanceJournalStep, completeWakeflowMaintenanceJournalStep, terminalizeWakeflowMaintenanceJournal, } from "./wakeflow-maintenance-journal.js";
import { assertWakeflowMaintenanceJournalIsOnlyTransaction, assertWakeflowPreparedMaintenanceJournalCapacity, checkpointWakeflowMaintenanceJournal, publishPreparedWakeflowMaintenanceJournal, readWakeflowMaintenanceJournal, readWakeflowMaintenanceJournalOrNull, recoverWakeflowMaintenanceJournalStages, retireTerminalWakeflowMaintenanceJournal, WakeflowMaintenanceJournalStoreError, } from "./wakeflow-maintenance-journal-store.js";
import { createWakeflowMaintenanceOperationId, parseWakeflowMaintenanceOperationId, WakeflowMaintenanceOperationIdError, wakeflowMaintenanceOperationUuid, } from "./wakeflow-maintenance-operation-id.js";
import { WAKEFLOW_MAINTENANCE_GATE_REF } from "./wakeflow-maintenance-resource-catalog.js";
import { parseWakeflowMaintenanceWriter, WakeflowMaintenanceWriterError, } from "./wakeflow-maintenance-writer.js";
import { isWakeflowDetachAction, parseWakeflowStaticMaterializationPreviewRequest, wakeflowStaticMaterializationActionUsesCurrentConfig, } from "./wakeflow-static-materialization-preview-contract.js";
import { executeWakeflowStaticMaterializationStep, WakeflowStaticMaterializationStepExecutionError, } from "./wakeflow-static-materialization-step-executor.js";
const ERROR_MESSAGES = {
    input: "Wakeflow maintenance execution transaction input is invalid.",
    "plan-blocked": "Wakeflow maintenance execution plan is blocked.",
    "plan-stale": "Wakeflow maintenance execution plan is stale.",
    "source-config": "Wakeflow maintenance execution source Config is invalid.",
    capability: "Wakeflow maintenance execution host capability is invalid.",
    gate: "Wakeflow maintenance execution gate failed.",
    intent: "Wakeflow maintenance execution recovery intent failed.",
    transaction: "Wakeflow maintenance execution transaction resources have an invalid shape.",
    journal: "Wakeflow maintenance execution journal failed.",
    step: "Wakeflow maintenance execution step failed.",
    "terminal-closure": "Wakeflow maintenance execution terminal closure failed.",
    aborted: "Wakeflow maintenance execution was aborted.",
    "recovery-required": "Wakeflow maintenance execution requires recovery.",
};
/** 聚合 maintenance transaction 失败的稳定、脱敏错误。 */
export class WakeflowMaintenanceExecutionTransactionError extends Error {
    name = "WakeflowMaintenanceExecutionTransactionError";
    code = "wakeflow-maintenance-execution-transaction";
    reason;
    path;
    operationId;
    constructor(reason, path, operationId) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
        this.operationId = operationId;
    }
}
function fail(reason, path, operationId = null) {
    throw new WakeflowMaintenanceExecutionTransactionError(reason, path, operationId);
}
function assertNotAborted(signal, operationId = null) {
    if (signal?.aborted === true)
        fail("aborted", "$signal", operationId);
}
function admittedOperationId(value) {
    try {
        return parseWakeflowMaintenanceOperationId(value);
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceOperationIdError) {
            fail("input", "$operationId");
        }
        throw error;
    }
}
function createOperationId(factory) {
    try {
        return factory === undefined
            ? createWakeflowMaintenanceOperationId()
            : createWakeflowMaintenanceOperationId(factory);
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceOperationIdError) {
            fail("input", "$options.uuidFactory");
        }
        throw error;
    }
}
function effectiveSignal(requestSignal, optionSignal) {
    if (requestSignal !== undefined && optionSignal !== undefined && requestSignal !== optionSignal) {
        fail("input", "$options.signal");
    }
    return optionSignal ?? requestSignal;
}
function requestWithSignal(request, signal) {
    return Object.freeze({
        action: request.action,
        desiredConfig: request.desiredConfig,
        currentHostProfile: request.currentHostProfile,
        hostProfiles: request.hostProfiles,
        ...(signal === undefined ? {} : { signal }),
    });
}
function positiveMilliseconds(value, path) {
    if (value === undefined)
        return undefined;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > 300_000) {
        fail("input", path);
    }
    return value;
}
function parseOptions(value) {
    let record;
    try {
        record = parsePlainRecord(value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$options");
        throw error;
    }
    if (Object.keys(record).some((key) => key !== "acquireTimeoutMilliseconds" &&
        key !== "retryDelayMilliseconds" &&
        key !== "signal" &&
        key !== "uuidFactory" &&
        key !== "writer")) {
        fail("input", "$options");
    }
    let writer;
    try {
        writer = parseWakeflowMaintenanceWriter(record.writer, "$options.writer");
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceWriterError)
            fail("input", error.path);
        throw error;
    }
    if (record.signal !== undefined &&
        (typeof record.signal !== "object" ||
            record.signal === null ||
            types.isProxy(record.signal) ||
            !(record.signal instanceof AbortSignal))) {
        fail("input", "$options.signal");
    }
    if (record.uuidFactory !== undefined &&
        (typeof record.uuidFactory !== "function" || types.isProxy(record.uuidFactory))) {
        fail("input", "$options.uuidFactory");
    }
    return Object.freeze({
        acquireTimeoutMilliseconds: positiveMilliseconds(record.acquireTimeoutMilliseconds, "$options.acquireTimeoutMilliseconds"),
        retryDelayMilliseconds: positiveMilliseconds(record.retryDelayMilliseconds, "$options.retryDelayMilliseconds"),
        signal: record.signal,
        uuidFactory: record.uuidFactory,
        writer,
    });
}
async function currentConfigSnapshot(root, signal, operationId = null) {
    try {
        return await readWakeflowConfigAuthoritySnapshot(root, signal === undefined ? undefined : { signal });
    }
    catch (error) {
        if (error instanceof WakeflowConfigAuthoritySnapshotError && error.reason === "source") {
            return null;
        }
        if (error instanceof WakeflowConfigAuthoritySnapshotError) {
            if (error.reason === "aborted") {
                fail("aborted", "$signal", operationId);
            }
            fail("source-config", "$config", operationId);
        }
        throw error;
    }
}
function parseCapability(plan, value) {
    if (plan.hostContribution === null) {
        if (value !== undefined)
            fail("capability", "$capability");
        return undefined;
    }
    if (value === undefined)
        fail("capability", "$capability");
    try {
        assertWakeflowHostMaintenanceCapability(value, plan.hostId);
        assertWakeflowHostMaintenanceContributionCapability(value, plan.hostContribution);
    }
    catch (error) {
        if (error instanceof WakeflowHostMaintenanceCapabilityError) {
            fail("capability", error.path);
        }
        throw error;
    }
    return value;
}
function assertRequestMatchesPlan(plan, request) {
    if (request.action !== plan.sharedPreview.action ||
        request.currentHostProfile.hostId !== plan.hostId ||
        createWakeflowWorkspaceStaticResourceMatrix(request.currentHostProfile).matrixDigest !==
            plan.sharedPreview.matrixDigest) {
        fail("input", "$request");
    }
}
function validateJournalPlan(source, intentSource, plan) {
    const preview = plan.sharedPreview;
    if (source.journal.intentDigest !== intentSource.intentDigest ||
        source.journal.planDigest !== plan.planDigest ||
        source.journal.action !== preview.action ||
        source.journal.matrixDigest !== preview.matrixDigest ||
        source.journal.currentConfigDigest !== preview.currentConfigDigest ||
        source.journal.desiredConfigDigest !== preview.desiredConfigDigest ||
        source.journal.stepIds.length !== plan.steps.length ||
        source.journal.stepIds.some((stepId, index) => stepId !== plan.steps[index]?.stepId)) {
        fail("journal", "$journal", source.operationId);
    }
}
/** 退役配置记录（ADR-0024 终态）：不在为 null；读不出即源 Config 不可信。 */
async function detachedConfigRecord(root, signal, operationId) {
    try {
        return await readWakeflowDetachedConfigRecord(root, signal === undefined ? undefined : { signal });
    }
    catch (error) {
        if (error instanceof WakeflowConfigAuthoritySnapshotError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal", operationId);
            fail("source-config", "$detached", operationId);
        }
        throw error;
    }
}
/**
 * 终态核对：publish-config 之后配置文件带期望摘要；detach-workspace 的 retire-config 之后配置文件
 * 不在而退役文件带同一摘要（ADR-0024）。
 */
async function assertTerminalConfig(root, plan, operationId) {
    const expected = plan.sharedPreview.desiredConfigDigest;
    if (expected === null)
        fail("terminal-closure", "$config", operationId);
    const current = await currentConfigSnapshot(root, undefined, operationId);
    if (plan.sharedPreview.action === "detach-workspace") {
        const retired = await detachedConfigRecord(root, undefined, operationId);
        if (current !== null || retired?.configDigest !== expected) {
            fail("terminal-closure", "$config", operationId);
        }
        return;
    }
    if (current?.configDigest !== expected) {
        fail("terminal-closure", "$config", operationId);
    }
}
/**
 * 宿主操作拿到的 Config：退出路径一律是当前 Config——要清理的就是它声明的托管面（ADR-0024）；
 * reconcile 也是当前 Config；fresh 与 reconfigure 是期望 Config。
 */
function hostConfigForExecution(request, sourceConfig, operationId) {
    const config = isWakeflowDetachAction(request.action) ||
        wakeflowStaticMaterializationActionUsesCurrentConfig(request.action)
        ? sourceConfig
        : request.desiredConfig;
    if (config === null)
        fail("source-config", "$config", operationId);
    return config;
}
function receipt(step, disposition, observationDigest) {
    return Object.freeze({
        stepId: step.stepId,
        boundary: step.boundary,
        disposition,
        observationDigest,
    });
}
async function executeStep(root, context, plan, requestValue, request, sourceConfig, capability, stepId, recoveringAffectedOperation, signal) {
    const step = plan.steps.find((entry) => entry.stepId === stepId);
    if (step === undefined)
        fail("step", `$step:${stepId}`, context.operationId);
    if (step.boundary === "shared-static") {
        try {
            const executed = await executeWakeflowStaticMaterializationStep(root, context, plan.sharedPreview, requestValue, stepId, {
                sourceConfig,
                recoveringAffectedStep: recoveringAffectedOperation,
                ...(signal === undefined ? {} : { signal }),
            });
            return receipt(step, executed.disposition, executed.observationDigest);
        }
        catch (error) {
            if (error instanceof WakeflowStaticMaterializationStepExecutionError) {
                if (error.reason === "aborted") {
                    fail("aborted", "$signal", context.operationId);
                }
                fail("step", `$step:${stepId}`, context.operationId);
            }
            throw error;
        }
    }
    if (capability === undefined) {
        fail("capability", "$capability", context.operationId);
    }
    const operation = plan.hostContribution?.operations.find((entry) => entry.operationId === step.operationId);
    if (operation === undefined ||
        operation.payloadDigest !== step.payloadDigest ||
        operation.targetDigest !== step.targetDigest) {
        fail("step", `$step:${stepId}`, context.operationId);
    }
    try {
        const executed = await capability.executeOperation(root, context, {
            config: hostConfigForExecution(request, sourceConfig, context.operationId),
            profile: request.currentHostProfile,
            operation,
            recoveringAffectedOperation,
            ...(signal === undefined ? {} : { signal }),
        });
        if (executed.operationId !== operation.operationId ||
            executed.observationDigest !== operation.targetDigest) {
            fail("step", `$step:${stepId}`, context.operationId);
        }
        return receipt(step, executed.disposition, executed.observationDigest);
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceExecutionTransactionError) {
            throw error;
        }
        assertNotAborted(signal, context.operationId);
        fail("step", `$step:${stepId}`, context.operationId);
    }
}
async function advanceJournal(root, context, intentSource, sourceValue, plan, requestValue, request, sourceConfig, capability, recovery, signal) {
    let source = sourceValue;
    const receipts = [];
    let replayingAffected = recovery && source.journal.affectedStepId !== null;
    while (source.journal.state !== "terminal") {
        assertNotAborted(signal, context.operationId);
        if (source.journal.affectedStepId === null) {
            if (source.journal.checkpoint === source.journal.stepIds.length) {
                source = await checkpointWakeflowMaintenanceJournal(root, context, intentSource, source, terminalizeWakeflowMaintenanceJournal(source.journal));
                continue;
            }
            source = await checkpointWakeflowMaintenanceJournal(root, context, intentSource, source, beginWakeflowMaintenanceJournalStep(source.journal));
            replayingAffected = false;
        }
        const stepId = source.journal.affectedStepId;
        if (stepId === null)
            fail("journal", "$journal", context.operationId);
        receipts.push(await executeStep(root, context, plan, requestValue, request, sourceConfig, capability, stepId, replayingAffected, signal));
        source = await checkpointWakeflowMaintenanceJournal(root, context, intentSource, source, completeWakeflowMaintenanceJournalStep(source.journal));
        replayingAffected = false;
    }
    return Object.freeze({
        terminalSource: source,
        receipts: Object.freeze(receipts),
    });
}
async function retireInactiveCorrelatedGate(root, operationId) {
    let gate;
    try {
        gate = await inspectRootedExclusiveFileLock(root, WAKEFLOW_MAINTENANCE_GATE_REF);
    }
    catch (error) {
        if (error instanceof RootedExclusiveFileLockError) {
            fail("gate", "$gate", operationId);
        }
        throw error;
    }
    if (gate.status === "absent")
        return;
    if (gate.ownerState !== "inactive")
        fail("gate", "$gate", operationId);
    if (!gate.record.token.endsWith(`-${wakeflowMaintenanceOperationUuid(operationId)}`)) {
        fail("gate", "$operationId", operationId);
    }
    try {
        await retireRootedExclusiveFileLockResidue(root, WAKEFLOW_MAINTENANCE_GATE_REF, gate);
    }
    catch (error) {
        if (error instanceof RootedExclusiveFileLockError) {
            fail("recovery-required", "$gate", operationId);
        }
        throw error;
    }
}
function gateOptions(options, signal = options.signal) {
    return {
        ...(options.acquireTimeoutMilliseconds === undefined
            ? {}
            : { acquireTimeoutMilliseconds: options.acquireTimeoutMilliseconds }),
        ...(options.retryDelayMilliseconds === undefined
            ? {}
            : { retryDelayMilliseconds: options.retryDelayMilliseconds }),
        ...(signal === undefined ? {} : { signal }),
    };
}
function mapGateError(error, operationId, persistentTransaction = false) {
    const exposedOperationId = persistentTransaction ? operationId : null;
    if (error.reason === "aborted") {
        fail("aborted", "$signal", exposedOperationId);
    }
    if (error.reason === "stale-preview") {
        fail("plan-stale", "$plan", null);
    }
    if (error.reason === "recovery-required") {
        fail("recovery-required", "$gate", operationId);
    }
    fail("gate", "$gate", exposedOperationId);
}
function intentStoreFailureReason(error) {
    if (error.reason === "transactions-shape")
        return "transaction";
    return error.reason === "commit-uncertain" || error.reason === "recovery-required"
        ? "recovery-required"
        : "intent";
}
function journalStoreFailureReason(error) {
    if (error.reason === "transactions-shape")
        return "transaction";
    return error.reason === "commit-uncertain" || error.reason === "recovery-required"
        ? "recovery-required"
        : "journal";
}
/** 执行一份重新验证后的聚合维护计划；尚不暴露为公共 maintenance apply。 */
export async function executeWakeflowMaintenanceExecutionTransaction(root, planValue, requestValue, capabilityValue, optionsValue = {}) {
    const options = parseOptions(optionsValue);
    const plan = parseWakeflowMaintenanceExecutionPlan(planValue);
    const request = parseWakeflowStaticMaterializationPreviewRequest(requestValue);
    const signal = effectiveSignal(request.signal, options.signal);
    assertNotAborted(signal);
    const executionRequestValue = requestWithSignal(request, signal);
    assertRequestMatchesPlan(plan, request);
    if (plan.status !== "ready")
        fail("plan-blocked", "$plan");
    const capability = parseCapability(plan, capabilityValue);
    let rederived;
    try {
        rederived = await previewWakeflowMaintenanceExecution(root, executionRequestValue, capability);
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceExecutionPreviewError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal", null);
            fail("plan-stale", "$plan", null);
        }
        throw error;
    }
    if (rederived.planDigest !== plan.planDigest) {
        fail("plan-stale", "$plan.planDigest");
    }
    if (plan.steps.length === 0) {
        return Object.freeze({
            status: "no-op",
            operationId: null,
            planDigest: plan.planDigest,
            stepReceipts: [],
        });
    }
    const current = await currentConfigSnapshot(root, signal);
    const desiredConfig = wakeflowStaticMaterializationActionUsesCurrentConfig(request.action)
        ? (current?.model ?? null)
        : request.desiredConfig;
    if (desiredConfig === null ||
        computeWakeflowConfigDigest(desiredConfig) !== plan.sharedPreview.desiredConfigDigest) {
        fail("source-config", "$config");
    }
    const operationId = createOperationId(options.uuidFactory);
    let intent;
    try {
        intent = createWakeflowMaintenanceExecutionIntent(operationId, plan, executionRequestValue, desiredConfig, options.writer);
        assertWakeflowMaintenanceExecutionIntentCapacity(intent);
        assertWakeflowPreparedMaintenanceJournalCapacity(operationId, computeWakeflowMaintenanceExecutionIntentDigest(intent), plan, options.writer);
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceExecutionIntentError ||
            error instanceof WakeflowMaintenanceExecutionIntentStoreError) {
            fail("intent", "$intent", null);
        }
        if (error instanceof WakeflowMaintenanceJournalStoreError) {
            fail("journal", "$journal", null);
        }
        throw error;
    }
    const reconstructed = reconstructWakeflowMaintenanceExecutionFromIntent(intent);
    const intentPlan = reconstructed.plan;
    const intentRequest = parseWakeflowStaticMaterializationPreviewRequest(reconstructed.request);
    const intentRequestValue = requestWithSignal(intentRequest, signal);
    try {
        return await withWakeflowMaintenanceGate(root, {
            expectedCoreLayoutInspectionDigest: plan.sharedPreview.coreLayoutInspectionDigest,
            operationId,
            bootstrap: request.action === "fresh-initialize" ? "fresh" : "repair",
            ...gateOptions(options, signal),
        }, async (context) => {
            let lockedPlan;
            try {
                lockedPlan = await previewWakeflowMaintenanceExecution(root, executionRequestValue, capability, context);
            }
            catch (error) {
                if (error instanceof WakeflowMaintenanceExecutionPreviewError) {
                    if (error.reason === "aborted")
                        fail("aborted", "$signal", null);
                    fail("plan-stale", "$plan", null);
                }
                throw error;
            }
            if (lockedPlan.planDigest !== plan.planDigest) {
                fail("plan-stale", "$plan.planDigest", null);
            }
            const intentSource = await publishWakeflowMaintenanceExecutionIntent(root, context, intent);
            const prepared = await publishPreparedWakeflowMaintenanceJournal(root, context, intentSource, intentPlan, options.writer);
            const advanced = await advanceJournal(root, context, intentSource, prepared, intentPlan, intentRequestValue, intentRequest, current?.model ?? null, capability, false, signal);
            await assertTerminalConfig(root, intentPlan, operationId);
            await retireWakeflowMaintenanceExecutionIntent(root, context, intentSource);
            await retireTerminalWakeflowMaintenanceJournal(root, context, advanced.terminalSource);
            return Object.freeze({
                status: "completed",
                operationId,
                planDigest: intentPlan.planDigest,
                stepReceipts: advanced.receipts,
            });
        });
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceExecutionTransactionError)
            throw error;
        if (error instanceof WakeflowMaintenanceGateError) {
            mapGateError(error, operationId);
        }
        if (error instanceof WakeflowMaintenanceExecutionIntentStoreError) {
            const reason = intentStoreFailureReason(error);
            fail(reason, reason === "transaction" ? "$transactions" : "$intent", operationId);
        }
        if (error instanceof WakeflowMaintenanceJournalStoreError) {
            const reason = journalStoreFailureReason(error);
            fail(reason, reason === "transaction" ? "$transactions" : "$journal", operationId);
        }
        throw error;
    }
}
async function recoverTerminalJournalWithoutIntent(root, operationId, initial, options) {
    if (initial.journal.state !== "terminal" ||
        initial.journal.affectedStepId !== null ||
        initial.journal.checkpoint !== initial.journal.stepIds.length) {
        fail("intent", "$intent", operationId);
    }
    assertNotAborted(options.signal, operationId);
    const current = await currentConfigSnapshot(root, options.signal, operationId);
    if (initial.journal.action === "detach-workspace") {
        // 终态是退役文件带同一摘要、配置文件不在（ADR-0024）。
        const retired = await detachedConfigRecord(root, options.signal, operationId);
        if (current !== null || retired?.configDigest !== initial.journal.desiredConfigDigest) {
            fail("terminal-closure", "$config", operationId);
        }
    }
    else if (current?.configDigest !== initial.journal.desiredConfigDigest) {
        fail("terminal-closure", "$config", operationId);
    }
    await assertWakeflowMaintenanceJournalIsOnlyTransaction(root, initial);
    await retireInactiveCorrelatedGate(root, operationId);
    return withExistingWakeflowMaintenanceGate(root, operationId, async (context) => {
        const source = await readWakeflowMaintenanceJournal(root, operationId);
        if (source.digest !== initial.digest ||
            source.journalDigest !== initial.journalDigest ||
            source.node.deviceId !== initial.node.deviceId ||
            source.node.inodeId !== initial.node.inodeId) {
            fail("journal", "$journal", operationId);
        }
        await retireTerminalWakeflowMaintenanceJournal(root, context, source);
        return Object.freeze({
            status: "recovered",
            operationId,
            planDigest: source.journal.planDigest,
            stepReceipts: Object.freeze([]),
        });
    }, gateOptions(options));
}
/**
 * detach-workspace 的恢复源 Config（ADR-0024）：配置文件还在即它（退役步必未完成）；配置文件不在则
 * 退役文件必须带同一摘要且退役步已开始，源 Config 就是退役文件里的那份。
 */
function detachRecoveryConfigState(plan, journal, current, retired, operationId) {
    const expected = plan.sharedPreview.currentConfigDigest;
    if (expected === null)
        fail("source-config", "$config", operationId);
    const retireIndex = plan.steps.findIndex((entry) => entry.boundary === "shared-static" && entry.stepKind === "retire-config");
    const retireStepId = plan.steps[retireIndex]?.stepId;
    if (current !== null) {
        if (current.configDigest !== expected ||
            (journal !== null && retireIndex >= 0 && journal.journal.checkpoint > retireIndex)) {
            fail("source-config", "$config", operationId);
        }
        return current.model;
    }
    if (retired === null ||
        retired.configDigest !== expected ||
        journal === null ||
        (retireIndex >= 0 &&
            journal.journal.checkpoint <= retireIndex &&
            journal.journal.affectedStepId !== retireStepId)) {
        fail("source-config", "$config", operationId);
    }
    return retired.model;
}
function assertRecoveryConfigState(plan, journal, current, retired, operationId) {
    if (plan.sharedPreview.action === "detach-workspace") {
        return detachRecoveryConfigState(plan, journal, current, retired, operationId);
    }
    if (journal === null) {
        if ((current?.configDigest ?? null) !== plan.sharedPreview.currentConfigDigest) {
            fail("source-config", "$config", operationId);
        }
        return current?.model ?? null;
    }
    const configIndex = plan.steps.findIndex((entry) => entry.boundary === "shared-static" && entry.stepKind === "publish-config");
    if (configIndex >= 0 && current?.configDigest === plan.sharedPreview.desiredConfigDigest) {
        const configStepId = plan.steps[configIndex]?.stepId;
        if (journal.journal.checkpoint <= configIndex &&
            journal.journal.affectedStepId !== configStepId) {
            fail("source-config", "$config", operationId);
        }
    }
    if (configIndex >= 0 &&
        current?.configDigest === plan.sharedPreview.currentConfigDigest &&
        journal.journal.checkpoint > configIndex) {
        fail("source-config", "$config", operationId);
    }
    if (plan.sharedPreview.currentConfigDigest === null) {
        if (current !== null && current.configDigest !== plan.sharedPreview.desiredConfigDigest) {
            fail("source-config", "$config", operationId);
        }
        return null;
    }
    if (current?.configDigest === plan.sharedPreview.currentConfigDigest ||
        current?.configDigest === plan.sharedPreview.desiredConfigDigest) {
        return current.model;
    }
    fail("source-config", "$config", operationId);
}
/**
 * 只凭operation ID、磁盘intent/journal和固定宿主capability恢复同一事务。
 */
export async function recoverWakeflowMaintenanceExecutionTransaction(root, operationIdValue, capabilityValue, optionsValue = {}) {
    const options = parseOptions(optionsValue);
    if (options.uuidFactory !== undefined)
        fail("input", "$options.uuidFactory");
    const operationId = admittedOperationId(operationIdValue);
    assertNotAborted(options.signal, operationId);
    try {
        await recoverWakeflowMaintenanceExecutionIntentStages(root, operationId);
        await recoverWakeflowMaintenanceJournalStages(root, operationId);
        assertNotAborted(options.signal, operationId);
        const intentSource = await readWakeflowMaintenanceExecutionIntentOrNull(root, operationId);
        const initialJournal = await readWakeflowMaintenanceJournalOrNull(root, operationId);
        if (intentSource === null) {
            if (initialJournal === null)
                fail("intent", "$intent", operationId);
            return await recoverTerminalJournalWithoutIntent(root, operationId, initialJournal, options);
        }
        const reconstructed = reconstructWakeflowMaintenanceExecutionFromIntent(intentSource.intent);
        const plan = reconstructed.plan;
        const requestValue = reconstructed.request;
        const request = parseWakeflowStaticMaterializationPreviewRequest(requestValue);
        assertRequestMatchesPlan(plan, request);
        const capability = parseCapability(plan, capabilityValue);
        if (initialJournal === null) {
            await assertWakeflowMaintenanceIntentIsOnlyTransactionPrefix(root, intentSource);
        }
        else {
            validateJournalPlan(initialJournal, intentSource, plan);
            await assertWakeflowMaintenanceIntentAndJournalAreOnlyTransaction(root, intentSource);
        }
        const current = await currentConfigSnapshot(root, options.signal, operationId);
        const retired = plan.sharedPreview.action === "detach-workspace"
            ? await detachedConfigRecord(root, options.signal, operationId)
            : null;
        const sourceConfig = assertRecoveryConfigState(plan, initialJournal, current, retired, operationId);
        await retireInactiveCorrelatedGate(root, operationId);
        return await withExistingWakeflowMaintenanceGate(root, operationId, async (context) => {
            const currentIntent = await readWakeflowMaintenanceExecutionIntent(root, operationId);
            if (currentIntent.intentDigest !== intentSource.intentDigest ||
                currentIntent.digest !== intentSource.digest ||
                currentIntent.node.deviceId !== intentSource.node.deviceId ||
                currentIntent.node.inodeId !== intentSource.node.inodeId) {
                fail("intent", "$intent", operationId);
            }
            const existingJournal = await readWakeflowMaintenanceJournalOrNull(root, operationId);
            const source = existingJournal ??
                (await publishPreparedWakeflowMaintenanceJournal(root, context, currentIntent, plan, options.writer));
            validateJournalPlan(source, currentIntent, plan);
            const advanced = await advanceJournal(root, context, currentIntent, source, plan, requestValue, request, sourceConfig, capability, true, options.signal);
            await assertTerminalConfig(root, plan, operationId);
            await retireWakeflowMaintenanceExecutionIntent(root, context, currentIntent);
            await retireTerminalWakeflowMaintenanceJournal(root, context, advanced.terminalSource);
            return Object.freeze({
                status: "recovered",
                operationId,
                planDigest: plan.planDigest,
                stepReceipts: advanced.receipts,
            });
        }, gateOptions(options));
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceExecutionTransactionError)
            throw error;
        if (error instanceof WakeflowMaintenanceGateError) {
            mapGateError(error, operationId, true);
        }
        if (error instanceof WakeflowMaintenanceExecutionIntentStoreError) {
            const reason = intentStoreFailureReason(error);
            fail(reason, reason === "transaction" ? "$transactions" : "$intent", operationId);
        }
        if (error instanceof WakeflowMaintenanceJournalStoreError) {
            const reason = journalStoreFailureReason(error);
            fail(reason, reason === "transaction" ? "$transactions" : "$journal", operationId);
        }
        throw error;
    }
}
