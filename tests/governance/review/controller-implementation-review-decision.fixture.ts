import type { WakeflowImplementationReviewDecisionRequestV1 } from "../../../src/contracts/generated/entrypoints/wakeflow-implementation-review-decision-request.generated.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest, type Sha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { parseDemandEventStreamRevision } from "../../../src/governance/demand/event-sourcing/demand-event-stream-position.js";
import {
  createControllerImplementationReviewDecision,
  type ControllerImplementationReviewDecisionType,
  type ControllerImplementationReviewJudgment,
  type CreateControllerImplementationReviewDecisionInput,
} from "../../../src/governance/review/controller-implementation-review-decision.js";
import type {
  ControllerReviewEscalation,
  ControllerReviewTargetCompletion,
} from "../../../src/governance/review/controller-review-decision-contract.js";
import type { DemandResultReviewSnapshot } from "../../../src/governance/review/demand-result-review-snapshot.js";
import { createTargetResultFixture } from "../result/target-result.fixture.js";
import { createTaskPackageFixture } from "../tasking/task-package.fixture.js";

export const CONTROLLER_REVIEW_WINDOW_ID = parseWakeflowDurableIdOfKind(
  "window_77777777-7777-4777-8777-777777777777",
  "window",
);
export const CONTROLLER_REVIEW_SNAPSHOT_DIGEST = parseSha256Digest(`sha256:${"1".repeat(64)}`);
export const CONTROLLER_REVIEW_UNIT_DIGEST = parseSha256Digest(`sha256:${"2".repeat(64)}`);
export const CONTROLLER_REVIEW_STATE_DIGEST = parseSha256Digest(`sha256:${"3".repeat(64)}`);
export const CONTROLLER_REVIEW_DECIDED_AT = parseUtcInstant("2026-08-29T12:15:00.000Z");
export const CONTROLLER_REVIEW_DECISION_UUID = "dededede-dede-4ded-8ded-dededededede";
export const CONTROLLER_REVIEW_COMPLETION_RECORD_ID = "20260829T121000000Z-stop-fixture";

/** 目标会话在结果之后的 Stop 记录；accept 决定必须携带（§13.87 D2）。 */
export function controllerReviewTargetCompletionFixture(): Readonly<ControllerReviewTargetCompletion> {
  return Object.freeze({
    recordId: CONTROLLER_REVIEW_COMPLETION_RECORD_ID,
    event: "stop" as const,
    observedAt: parseUtcInstant("2026-08-29T12:11:00.000Z"),
  });
}

const ESCALATION_ISSUE =
  "实现按锚点完成，但需求包对回退策略的表述与产品现状冲突，Controller 不能单方面裁定。";
export const ESCALATION_OPTIONS = Object.freeze([
  Object.freeze({ option: "按当前实现接受并补充需求说明。", impact: "需要设计侧追加需求补充包。" }),
  Object.freeze({ option: "按原表述返工。", impact: "本目标再进入一轮返工。" }),
] as const);
const ESCALATION_RECOMMENDATION = "建议先与需求作者确认回退策略，再决定接受或返工。";

export function controllerReviewEscalationFixture(): Readonly<ControllerReviewEscalation> {
  return Object.freeze({
    issue: ESCALATION_ISSUE,
    requirementRefs: Object.freeze([]),
    evidence: Object.freeze([]),
    options: ESCALATION_OPTIONS,
    recommendation: ESCALATION_RECOMMENDATION,
  });
}

type ImplementationReviewJudgmentWire = Readonly<
  Pick<
    WakeflowImplementationReviewDecisionRequestV1,
    | "decision"
    | "assessment"
    | "independentChecks"
    | "rationale"
    | "blockingReasons"
    | "residualRisks"
    | "escalation"
  >
>;

/** 公共请求线格式的同一份升级内容：生成的线类型要求可变数组，因此不与治理夹具共享对象。 */
export function implementationReviewEscalationWire(): NonNullable<
  ImplementationReviewJudgmentWire["escalation"]
> {
  return {
    issue: ESCALATION_ISSUE,
    requirementRefs: [],
    evidence: [],
    options: [ESCALATION_OPTIONS[0], ESCALATION_OPTIONS[1]],
    recommendation: ESCALATION_RECOMMENDATION,
  };
}

/** 公共请求线格式的判断字段：与 `implementationReviewJudgment` 同一词汇，元组展开为可变数组。 */
export function implementationReviewJudgmentWire(
  decision: ControllerImplementationReviewDecisionType = "accept",
): ImplementationReviewJudgmentWire {
  const judgment = implementationReviewJudgment(decision);
  const independentChecks: ImplementationReviewJudgmentWire["independentChecks"] = [
    judgment.independentChecks[0],
  ];
  return Object.freeze({
    decision: judgment.decision,
    assessment: { ...judgment.assessment },
    independentChecks,
    rationale: judgment.rationale,
    blockingReasons: [...judgment.blockingReasons],
    residualRisks: [...judgment.residualRisks],
    ...(decision === "escalate" ? { escalation: implementationReviewEscalationWire() } : {}),
  });
}

/** 请求里的判断字段：与决定记录共享同一词汇，`escalation` 只在 escalate 时出现。 */
export function implementationReviewJudgment(
  decision: ControllerImplementationReviewDecisionType = "accept",
): Readonly<
  Pick<
    ControllerImplementationReviewJudgment,
    | "decision"
    | "assessment"
    | "independentChecks"
    | "rationale"
    | "blockingReasons"
    | "residualRisks"
  > & { readonly escalation?: Readonly<ControllerReviewEscalation> }
> {
  const assessment =
    decision === "accept"
      ? { requirementAlignment: "aligned" as const, implementationQuality: "satisfactory" as const }
      : decision === "rework"
        ? { requirementAlignment: "aligned" as const, implementationQuality: "defective" as const }
        : { requirementAlignment: "unresolved" as const, implementationQuality: "unverified" as const };
  const outcome =
    decision === "accept"
      ? ("passed" as const)
      : decision === "rework"
        ? ("failed" as const)
        : ("inconclusive" as const);
  return Object.freeze({
    decision,
    assessment: Object.freeze(assessment),
    independentChecks: Object.freeze([
      Object.freeze({
        checkId: `controller-${decision}`,
        method: "重新读取变更并运行新增 TypeScript 聚焦测试",
        outcome,
        observation:
          outcome === "passed"
            ? "实现与任务合同一致，聚焦测试通过。"
            : outcome === "failed"
              ? "独立检查复现了实现缺陷。"
              : "当前输入不足以形成可接受结论。",
      }),
    ] as const),
    rationale: `Controller完成独立检查并决定${decision}。`,
    blockingReasons:
      decision === "blocked" ? Object.freeze(["缺少继续判断所需的外部事实。"]) : Object.freeze([]),
    residualRisks: Object.freeze([]),
    ...(decision === "escalate" ? { escalation: controllerReviewEscalationFixture() } : {}),
  });
}

export function controllerImplementationReviewDecisionInput(
  decision: ControllerImplementationReviewDecisionType = "accept",
): Readonly<CreateControllerImplementationReviewDecisionInput> {
  const taskPackage = createTaskPackageFixture();
  const targetResult = createTargetResultFixture();
  const judgment = implementationReviewJudgment(decision);
  return Object.freeze({
    programId: taskPackage.programId,
    demandId: taskPackage.demandId,
    targetTaskId: taskPackage.targetTaskId,
    controllerWindowId: CONTROLLER_REVIEW_WINDOW_ID,
    reviewed: Object.freeze({
      snapshotDigest: CONTROLLER_REVIEW_SNAPSHOT_DIGEST,
      reviewUnitDigest: CONTROLLER_REVIEW_UNIT_DIGEST,
      stateDigest: CONTROLLER_REVIEW_STATE_DIGEST,
      streamRevision: parseDemandEventStreamRevision(8),
      taskPackageId: taskPackage.taskPackageId,
      taskPackageDigest: targetResult.taskPackage.digest,
      targetResultId: targetResult.targetResultId,
      targetResultDigest: targetResult.resultDigest,
      targetResultOutcome: targetResult.report.outcome,
      targetResultReportedAt: targetResult.report.reportedAt,
    }),
    decision: judgment.decision,
    assessment: judgment.assessment,
    independentChecks: judgment.independentChecks,
    rationale: judgment.rationale,
    blockingReasons: judgment.blockingReasons,
    residualRisks: judgment.residualRisks,
    escalation: judgment.escalation ?? null,
    resumption: null,
    callbackLanding: null,
    targetCompletion: decision === "accept" ? controllerReviewTargetCompletionFixture() : null,
  });
}

export function createControllerImplementationReviewDecisionFixture(
  decision: ControllerImplementationReviewDecisionType = "accept",
) {
  return createControllerImplementationReviewDecision(
    controllerImplementationReviewDecisionInput(decision),
    {
      clock: () => CONTROLLER_REVIEW_DECIDED_AT,
      uuidFactory: () => CONTROLLER_REVIEW_DECISION_UUID,
    },
  );
}

export function createControllerImplementationReviewDecisionForState(
  stateDigest: Sha256Digest,
  decision: ControllerImplementationReviewDecisionType = "accept",
  streamRevision = 8,
  targetResult = createTargetResultFixture(),
  overrides: Partial<CreateControllerImplementationReviewDecisionInput> = {},
) {
  const input = controllerImplementationReviewDecisionInput(decision);
  return createControllerImplementationReviewDecision(
    {
      ...input,
      programId: targetResult.programId,
      demandId: targetResult.demandId,
      targetTaskId: targetResult.targetTaskId,
      reviewed: Object.freeze({
        ...input.reviewed,
        stateDigest,
        streamRevision: parseDemandEventStreamRevision(streamRevision),
        taskPackageId: targetResult.taskPackage.taskPackageId,
        taskPackageDigest: targetResult.taskPackage.digest,
        targetResultId: targetResult.targetResultId,
        targetResultDigest: targetResult.resultDigest,
        targetResultOutcome: targetResult.report.outcome,
        targetResultReportedAt: targetResult.report.reportedAt,
      }),
      ...overrides,
    },
    {
      clock: () => CONTROLLER_REVIEW_DECIDED_AT,
      uuidFactory: () => overrides.resumption === undefined ? CONTROLLER_REVIEW_DECISION_UUID : "dfdfdfdf-dfdf-4dfd-8dfd-dfdfdfdfdfdf",
    },
  );
}

export function createControllerImplementationReviewDecisionForSnapshot(
  snapshot: Readonly<DemandResultReviewSnapshot>,
  decision: ControllerImplementationReviewDecisionType = "accept",
) {
  const target = snapshot.targets.find((entry) => entry.status === "reported");
  if (target?.status !== "reported") {
    throw new Error("Expected one reported review target fixture.");
  }
  const input = controllerImplementationReviewDecisionInput(decision);
  return createControllerImplementationReviewDecision(
    {
      ...input,
      programId: target.taskPackage.programId,
      demandId: target.targetResult.demandId,
      targetTaskId: target.targetTaskId,
      reviewed: Object.freeze({
        snapshotDigest: snapshot.snapshotDigest,
        reviewUnitDigest: target.reviewUnitDigest,
        stateDigest: snapshot.eventStream.stateDigest,
        streamRevision: snapshot.eventStream.streamRevision,
        taskPackageId: target.taskPackage.taskPackageId,
        taskPackageDigest: target.targetResult.taskPackage.digest,
        targetResultId: target.targetResult.targetResultId,
        targetResultDigest: target.targetResult.resultDigest,
        targetResultOutcome: target.targetResult.report.outcome,
        targetResultReportedAt: target.targetResult.report.reportedAt,
      }),
    },
    {
      clock: () => CONTROLLER_REVIEW_DECIDED_AT,
      uuidFactory: () => CONTROLLER_REVIEW_DECISION_UUID,
    },
  );
}
