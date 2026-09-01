import {
  parseTargetResult,
  TargetResultError,
  type TargetResult,
} from "../result/target-result.js";
import {
  parseControllerImplementationReviewDecision,
  ControllerImplementationReviewDecisionError,
  type ControllerImplementationReviewDecision,
} from "../review/controller-implementation-review-decision.js";
import {
  projectTargetDeliveryReworkContext,
  type TargetDeliveryReworkContext,
} from "./target-delivery-intent.js";

/**
 * Wakeflow Governance / Delivery：从完整Review历史组装返工投递上下文。
 *
 * 本模块是Review/Result与Delivery之间的单向适配缝。它验证完整历史来源后只投影
 * Decision/Result身份、有界Controller说明和未通过检查；不修改TaskPackage、不决定
 * 是否应当返工，也不创建新的Delivery身份。
 */

export interface CreateTargetDeliveryReworkContextInput {
  readonly decision: Readonly<ControllerImplementationReviewDecision>;
  readonly previousResult: Readonly<TargetResult>;
}

type ReworkCorrectionSource =
  ControllerImplementationReviewDecision["independentChecks"][number] & {
    readonly outcome: "failed" | "inconclusive";
  };

export type TargetDeliveryReworkContextErrorReason =
  "decision" | "result" | "relation";

const ERROR_MESSAGES = {
  decision:
    "Target Delivery rework context requires a valid Controller Decision.",
  result:
    "Target Delivery rework context requires a valid previous TargetResult.",
  relation:
    "Target Delivery rework Decision and previous Result are inconsistent.",
} as const satisfies Readonly<
  Record<TargetDeliveryReworkContextErrorReason, string>
>;

/** 完整返工来源无法形成一致投递投影时的稳定错误。 */
export class TargetDeliveryReworkContextError extends Error {
  override readonly name = "TargetDeliveryReworkContextError";
  readonly code = "wakeflow-target-delivery-rework-context" as const;
  readonly reason: TargetDeliveryReworkContextErrorReason;

  constructor(reason: TargetDeliveryReworkContextErrorReason) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

function fail(reason: TargetDeliveryReworkContextErrorReason): never {
  throw new TargetDeliveryReworkContextError(reason);
}

/** 从一份精确rework Decision和它审查的TargetResult创建最小执行投影。 */
export function createTargetDeliveryReworkContext(
  input: Readonly<CreateTargetDeliveryReworkContextInput>,
): Readonly<TargetDeliveryReworkContext> {
  let decision: Readonly<ControllerImplementationReviewDecision>;
  let previousResult: Readonly<TargetResult>;
  try {
    decision = parseControllerImplementationReviewDecision(input.decision);
  } catch (error: unknown) {
    if (error instanceof ControllerImplementationReviewDecisionError) {
      fail("decision");
    }
    throw error;
  }
  try {
    previousResult = parseTargetResult(input.previousResult);
  } catch (error: unknown) {
    if (error instanceof TargetResultError) fail("result");
    throw error;
  }
  const requiredCorrections = decision.independentChecks.filter(
    (check): check is ReworkCorrectionSource => check.outcome !== "passed",
  );
  if (
    decision.decision !== "rework" ||
    decision.programId !== previousResult.programId ||
    decision.demandId !== previousResult.demandId ||
    decision.targetTaskId !== previousResult.targetTaskId ||
    decision.reviewed.taskPackageId !==
      previousResult.taskPackage.taskPackageId ||
    decision.reviewed.taskPackageDigest !== previousResult.taskPackage.digest ||
    decision.reviewed.targetResultId !== previousResult.targetResultId ||
    decision.reviewed.targetResultDigest !== previousResult.resultDigest ||
    decision.reviewed.targetResultOutcome !== previousResult.report.outcome ||
    decision.reviewed.targetResultReportedAt !==
      previousResult.report.reportedAt ||
    requiredCorrections.length === 0 ||
    !requiredCorrections.some((check) => check.outcome === "failed")
  ) {
    fail("relation");
  }
  return projectTargetDeliveryReworkContext({
    decision: Object.freeze({
      targetReviewDecisionId: decision.targetReviewDecisionId,
      decisionDigest: decision.decisionDigest,
    }),
    previousResult: Object.freeze({
      targetResultId: previousResult.targetResultId,
      resultDigest: previousResult.resultDigest,
    }),
    rationale: decision.rationale,
    requiredCorrections: requiredCorrections.map((check) =>
      Object.freeze({
        checkId: check.checkId,
        outcome: check.outcome,
        method: check.method,
        observation: check.observation,
      }),
    ),
  });
}
