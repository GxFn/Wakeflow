import { RERUNNABLE_TEST_FAILURE_CLASSIFICATIONS, } from "../../contracts/vocabulary/test-step-vocabulary.js";
import { scanPrivacy } from "../../kernel/privacy-scan.js";
/**
 * Wakeflow Capabilities / Result Review：结果导入与评审的纯决定（能力卡 7 修订，§13.87 D2 D3 D6 D7）。
 *
 * 这里没有 I/O：证据定位符只解析成"该读哪份受管证据的哪个成员"的计划，隐私扫描只收集
 * 命中类别，完成证据与回调落地由记录列表派生，允许的决定与决定的阻塞项由分类路由表派生，
 * approved 基线由同目标尝试链与 retest 链派生。
 */
const MANAGED_EVIDENCE_LOCATOR_ROOT = "artifacts/managed-evidence";
const EVIDENCE_ID_PATTERN = /^evidence_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
/**
 * 定位符只解析同 Demand 受管证据记录内的路径：`<root>/<evidenceId>/manifest.json` 或
 * `<root>/<evidenceId>/payload/<member>`；其余返回 null。表驱动：slice 8 只加根与种类。
 */
export function planEvidenceLocator(ref) {
    const prefix = `${MANAGED_EVIDENCE_LOCATOR_ROOT}/`;
    if (!ref.startsWith(prefix))
        return null;
    const rest = ref.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash <= 0)
        return null;
    const evidenceId = rest.slice(0, slash);
    if (!EVIDENCE_ID_PATTERN.test(evidenceId))
        return null;
    const member = rest.slice(slash + 1);
    const typedEvidenceId = evidenceId;
    if (member === "manifest.json") {
        return Object.freeze({ evidenceId: typedEvidenceId, member: "manifest" });
    }
    if (member.startsWith("payload/") && member.length > "payload/".length) {
        return Object.freeze({
            evidenceId: typedEvidenceId,
            member: "payload",
            memberRef: member.slice("payload/".length),
        });
    }
    return null;
}
/** 报告里出现的每个 `{ref, digest}` 只解析一次；同一 ref 不同摘要视为两条（第二条必然不符）。 */
export function collectEvidenceReferences(report) {
    const seen = new Set();
    const references = [];
    const add = (reference) => {
        const key = `${reference.ref}\u0000${reference.digest}`;
        if (seen.has(key))
            return;
        seen.add(key);
        references.push(Object.freeze({
            ref: reference.ref,
            digest: reference.digest,
            kind: reference.kind ?? null,
        }));
    };
    for (const locator of report.evidenceLocators)
        add(locator);
    for (const anchor of report.anchorEvidence ?? []) {
        for (const reference of anchor.evidenceRefs)
            add(reference);
    }
    for (const step of report.steps ?? [])
        add(step.evidence);
    return Object.freeze(references);
}
/** 报告的自由文本：摘要、验证、风险、逐步观察与建议动作；锚点与定位符是引用不是文本。 */
export function reportTexts(report) {
    return Object.freeze([
        report.summary,
        ...report.verification,
        ...report.risks,
        ...(report.steps ?? []).flatMap((step) => step.failure === undefined
            ? [step.observed]
            : [step.observed, step.failure.recommendedAction]),
    ]);
}
/** 隐私扫描只返回命中的规则类别（去重、稳定排序），从不返回命中的文本。 */
export function derivePrivacyRules(texts, policy) {
    const kinds = new Set();
    for (const text of texts) {
        for (const finding of scanPrivacy(text, policy))
            kinds.add(finding.kind);
    }
    return Object.freeze([...kinds].sort());
}
/** 完成证据：目标会话在 `reportedAt` 之后的第一条 Stop 或 turn-complete 记录（§13.87 D2）。 */
export function deriveTargetCompletion(records, reportedAt) {
    const reported = Date.parse(reportedAt);
    const record = [...records]
        .filter((entry) => (entry.event === "stop" || entry.event === "turn-complete") &&
        Date.parse(entry.recordedAt) >= reported)
        .sort((left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt))[0];
    if (record === undefined)
        return Object.freeze({ status: "pending" });
    return Object.freeze({
        status: "confirmed",
        recordId: record.recordId,
        event: record.event === "stop" ? "stop" : "turn-complete",
        observedAt: record.recordedAt,
    });
}
/** 回调落地：Controller 会话在签发之后、摘要相符的 `user-prompt-submit` 记录。 */
export function deriveCallbackLanding(records, promptDigest, issuedAt) {
    const issued = Date.parse(issuedAt);
    const record = [...records]
        .filter((entry) => entry.event === "user-prompt-submit" &&
        entry.promptDigest === promptDigest &&
        Date.parse(entry.recordedAt) >= issued)
        .sort((left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt))[0];
    return record === undefined
        ? null
        : Object.freeze({ recordId: record.recordId, landedAt: record.recordedAt });
}
/** blocked 或 escalated 之后的再决定必须带 resumption 指向当前决定，且升级已被回答（D4）。 */
export function deriveResumptionBlockers(source, resumption) {
    if (source.status === "reported") {
        return Object.freeze(resumption === undefined ? [] : ["resumption-unexpected"]);
    }
    if (resumption === undefined)
        return Object.freeze(["resumption-missing"]);
    const blockers = [];
    if (resumption.previousDecisionId !== source.currentDecisionId) {
        blockers.push("resumption-previous-decision");
    }
    const expectedBasis = source.status === "review-blocked" ? "condition-cleared" : "decision-recorded";
    if (resumption.basis.kind !== expectedBasis) {
        blockers.push(`resumption-basis:${resumption.basis.kind}`);
    }
    else if (resumption.basis.kind === "decision-recorded") {
        if (resumption.basis.escalationEventId !== source.escalationEventId) {
            blockers.push("resumption-escalation-event");
        }
        if (!source.escalationAnswered)
            blockers.push("awaiting-decision");
    }
    return Object.freeze(blockers);
}
/**
 * 实现决定的机器阻塞项：accept 要求 completed 且完成证据已确认；rework 在给出独立检查时至少
 * 一条 failed——failed 的检查就是返工投递交给目标的整改项，全部 passed 的 rework 永远投不出去，
 * 所以在记录时就拒绝；其余由 Controller 判断。
 */
export function deriveImplementationDecisionBlockers(decision, view, independentChecks) {
    const blockers = [];
    if (decision === "accept") {
        if (view.outcome !== "completed")
            blockers.push(`outcome:${view.outcome}`);
        if (view.targetCompletion.status !== "confirmed")
            blockers.push("target-completion-pending");
    }
    if (decision === "rework" &&
        independentChecks !== undefined &&
        !independentChecks.some((check) => check.outcome === "failed")) {
        blockers.push("rework-checks:no-failed");
    }
    return Object.freeze(blockers);
}
export function deriveImplementationAllowedDecisions(view) {
    const decisions = ["accept", "rework", "blocked", "escalate"];
    return Object.freeze(decisions.filter((decision) => deriveImplementationDecisionBlockers(decision, view).length === 0));
}
function passedStep(results, match) {
    for (const result of results) {
        const stepId = match(result);
        if (stepId === null)
            continue;
        const step = result.steps.find((entry) => entry.stepId === stepId);
        if (step === undefined || step.verdict !== "pass")
            continue;
        return Object.freeze({
            attemptOrdinal: result.attemptOrdinal,
            targetTaskId: result.targetTaskId,
            observed: step.observed,
            evidence: step.evidence,
        });
    }
    return null;
}
/**
 * approved 基线：先看同目标更早的尝试（同 stepId），再看 retest 链里的前代目标（引用同一
 * 需求验收条目的步骤）；只有通过的步骤才是基线，最近一次优先。
 */
export function deriveStepViews(contractSteps, current, priorAttempts, retestedResults) {
    const latestFirst = (values) => [...values].sort((left, right) => right.attemptOrdinal - left.attemptOrdinal);
    const attempts = latestFirst(priorAttempts);
    const retested = latestFirst(retestedResults);
    return Object.freeze(contractSteps.map((contractStep) => {
        const recorded = current.steps.find((step) => step.stepId === contractStep.stepId);
        const inScope = current.stepIds === null || current.stepIds.includes(contractStep.stepId);
        if (recorded !== undefined && inScope) {
            return Object.freeze({
                stepId: contractStep.stepId,
                given: contractStep.given,
                when: contractStep.when,
                expected: contractStep.then,
                observed: recorded.observed,
                evidence: recorded.evidence,
                verdict: recorded.verdict,
                failure: recorded.failure ?? null,
                baseline: null,
            });
        }
        const baseline = passedStep(attempts, () => contractStep.stepId) ??
            passedStep(retested, (result) => {
                const match = [...result.itemIdByStepId.entries()].find(([, itemId]) => itemId === contractStep.requirementRef.itemId);
                return match === undefined ? null : match[0];
            });
        return Object.freeze({
            stepId: contractStep.stepId,
            given: contractStep.given,
            when: contractStep.when,
            expected: contractStep.then,
            observed: null,
            evidence: null,
            verdict: null,
            failure: null,
            baseline,
        });
    }));
}
/** 并集判定：本次 fail 即 fail，含 blocked 即 blocked，任何合同步骤既未通过也无基线即 cannot-conclude。 */
export function deriveUnionVerdict(views) {
    if (views.some((view) => view.verdict === "fail"))
        return "fail";
    if (views.some((view) => view.verdict === "blocked"))
        return "blocked";
    if (views.some((view) => view.verdict !== "pass" && view.baseline === null)) {
        return "cannot-conclude";
    }
    return "pass";
}
function failedViews(views) {
    return views.filter((view) => view.verdict !== null && view.verdict !== "pass");
}
function rerunBlockers(request, view) {
    const blockers = [];
    const failed = failedViews(view.steps);
    if (failed.length === 0)
        blockers.push("no-failed-step");
    if (view.attemptCount >= view.maxAttempts)
        blockers.push(`attempt-capacity:${view.attemptCount}`);
    for (const step of failed) {
        const classification = step.failure?.classification;
        if (classification === undefined ||
            !RERUNNABLE_TEST_FAILURE_CLASSIFICATIONS.includes(classification)) {
            blockers.push(`classification:${step.stepId}:${classification ?? "none"}`);
        }
        else if (classification === "flaky" && view.previouslyFlakyStepIds.includes(step.stepId)) {
            blockers.push(`flaky-repeat:${step.stepId}`);
        }
    }
    const failedIds = new Set(failed.map((step) => step.stepId));
    for (const stepId of request.stepIds ?? []) {
        if (!failedIds.has(stepId))
            blockers.push(`step-scope:${stepId}`);
    }
    return blockers;
}
function escalateBlockers(request, view) {
    const escalation = request.escalation;
    if (escalation === undefined || escalation.classification !== "product-defect")
        return [];
    const blockers = [];
    const defects = new Set(view.steps
        .filter((step) => step.verdict === "fail" && step.failure?.classification === "product-defect")
        .map((step) => step.stepId));
    if (defects.size === 0)
        blockers.push("product-defect-missing");
    for (const target of escalation.remediation?.affectedTargets ?? []) {
        for (const stepId of target.failedStepIds) {
            if (!defects.has(stepId))
                blockers.push(`remediation-step:${stepId}`);
        }
    }
    return blockers;
}
/**
 * 分类到决定的机器规则（D7）：accept 要求并集 pass、completed 与完成证据；request-another-attempt
 * 要求失败步骤全部可重跑、容量未满、无连续 flaky、范围只含失败步骤；blocked 要求 environment
 * 失败或报告整体 blocked；escalate{product-defect} 要求存在 product-defect 步骤且映射只含这些步骤。
 */
export function deriveTestDecisionBlockers(request, view) {
    switch (request.decision) {
        case "accept": {
            const blockers = [];
            const verdict = deriveUnionVerdict(view.steps);
            if (verdict !== "pass")
                blockers.push(`verdict:${verdict}`);
            if (view.outcome !== "completed")
                blockers.push(`outcome:${view.outcome}`);
            if (view.targetCompletion.status !== "confirmed")
                blockers.push("target-completion-pending");
            return Object.freeze(blockers);
        }
        case "request-another-attempt":
            return Object.freeze(rerunBlockers(request, view));
        case "blocked":
            return Object.freeze(view.outcome === "blocked" ||
                view.steps.some((step) => step.failure?.classification === "environment")
                ? []
                : ["blocked-basis"]);
        case "escalate":
            return Object.freeze(escalateBlockers(request, view));
    }
}
export function deriveTestAllowedDecisions(view) {
    const decisions = [
        "accept",
        "request-another-attempt",
        "blocked",
        "escalate",
    ];
    return Object.freeze(decisions.filter((decision) => deriveTestDecisionBlockers({ decision }, view).length === 0));
}
/** 决定与阶段的对应：结果里派生目标 phase，供结果投影与断言复用。 */
export function implementationPhaseForDecision(decision) {
    switch (decision) {
        case "accept":
            return "accepted";
        case "rework":
            return "rework-requested";
        case "blocked":
            return "review-blocked";
        case "escalate":
            return "escalated";
    }
}
export function testPhaseForDecision(decision, classification) {
    switch (decision) {
        case "accept":
            return "test-accepted";
        case "request-another-attempt":
            return "test-another-attempt-requested";
        case "blocked":
            return "test-review-blocked";
        case "escalate":
            return classification === "product-defect" ? "test-product-defect" : "test-escalated";
    }
}
/** 回调 prompt 需要的结果摘要：分支与提交只对实现结果存在。 */
export function summarizeResultForCallback(result) {
    if (result.workType === "test") {
        return Object.freeze({
            outcome: result.report.outcome,
            summary: result.report.summary,
            branch: null,
            commits: Object.freeze([]),
            verdict: result.report.verdict,
        });
    }
    const implementation = result;
    return Object.freeze({
        outcome: implementation.report.outcome,
        summary: implementation.report.summary,
        branch: implementation.report.repositoryChange.branch,
        commits: Object.freeze(implementation.report.repositoryChange.commits.map(String)),
        verdict: null,
    });
}
/** 当前决定所附带升级事件的判定输入：由 lifecycle.demand-escalated 的 source 反查。 */
export function findReviewEscalationEventId(escalations, decision) {
    if (decision === null)
        return null;
    const match = escalations.find((entry) => entry.source.kind === "review-decision" &&
        entry.source.targetReviewDecisionId === decision.targetReviewDecisionId);
    return match === undefined ? null : match.eventId;
}
