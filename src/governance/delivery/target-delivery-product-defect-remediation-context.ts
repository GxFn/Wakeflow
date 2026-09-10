import {
  parseTargetResult,
  TargetResultError,
  type TargetResult,
} from "../result/target-result.js";
import {
  parseControllerProductDefectRemediationAuthorization,
  ControllerProductDefectRemediationAuthorizationError,
  type ControllerProductDefectRemediationAuthorization,
} from "../review/controller-product-defect-remediation-authorization.js";
import {
  projectTargetDeliveryProductDefectRemediationContext,
  type TargetDeliveryProductDefectRemediationContext,
} from "./delivery-envelope.js";

/**
 * Wakeflow Governance / Delivery：从完整产品缺陷Authorization历史组装投递投影。
 *
 * 本模块验证Authorization选中的产品baseline与先前accepted TargetResult后，只投影
 * Target执行所需的有界来源（失败步骤编号与观察摘要）；它不修改TaskPackage、不授权
 * 跨包修复，也不读取文件。
 */

export interface CreateTargetDeliveryProductDefectRemediationContextInput {
  readonly authorization: Readonly<ControllerProductDefectRemediationAuthorization>;
  readonly previousResult: Readonly<TargetResult>;
}

export type TargetDeliveryProductDefectRemediationContextErrorReason =
  "authorization" | "result" | "relation";

const ERROR_MESSAGES = {
  authorization:
    "Target Delivery product-defect remediation context requires a valid Controller Authorization.",
  result:
    "Target Delivery product-defect remediation context requires a valid previous product TargetResult.",
  relation:
    "Target Delivery product-defect remediation Authorization and previous Result are inconsistent.",
} as const satisfies Readonly<
  Record<TargetDeliveryProductDefectRemediationContextErrorReason, string>
>;

export class TargetDeliveryProductDefectRemediationContextError extends Error {
  override readonly name = "TargetDeliveryProductDefectRemediationContextError";
  readonly code =
    "wakeflow-target-delivery-product-defect-remediation-context" as const;
  readonly reason: TargetDeliveryProductDefectRemediationContextErrorReason;

  constructor(
    reason: TargetDeliveryProductDefectRemediationContextErrorReason,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

function fail(
  reason: TargetDeliveryProductDefectRemediationContextErrorReason,
): never {
  throw new TargetDeliveryProductDefectRemediationContextError(reason);
}

/** 从完整Authorization与产品Result创建最小产品缺陷修复投影。 */
export function createTargetDeliveryProductDefectRemediationContext(
  input: Readonly<CreateTargetDeliveryProductDefectRemediationContextInput>,
): Readonly<TargetDeliveryProductDefectRemediationContext> {
  let authorization: Readonly<ControllerProductDefectRemediationAuthorization>;
  let previousResult: Readonly<TargetResult>;
  try {
    authorization = parseControllerProductDefectRemediationAuthorization(
      input.authorization,
    );
  } catch (error: unknown) {
    if (error instanceof ControllerProductDefectRemediationAuthorizationError) {
      fail("authorization");
    }
    throw error;
  }
  try {
    previousResult = parseTargetResult(input.previousResult);
  } catch (error: unknown) {
    if (error instanceof TargetResultError) fail("result");
    throw error;
  }
  const affected = authorization.affectedTargets.find(
    (target) => target.baseline.targetTaskId === previousResult.targetTaskId,
  );
  if (
    previousResult.workType !== "implementation" ||
    affected === undefined ||
    authorization.programId !== previousResult.programId ||
    authorization.demandId !== previousResult.demandId ||
    affected.baseline.taskPackageId !==
      previousResult.taskPackage.taskPackageId ||
    affected.baseline.taskPackageDigest !== previousResult.taskPackage.digest ||
    affected.baseline.repositoryId !== previousResult.assignment.repositoryId ||
    affected.baseline.windowId !== previousResult.assignment.windowId ||
    affected.baseline.targetResultId !== previousResult.targetResultId ||
    affected.baseline.resultDigest !== previousResult.resultDigest
  ) {
    fail("relation");
  }
  const failedStepById = new Map(
    authorization.failedSteps.map((step) => [step.stepId, step] as const),
  );
  const requiredCorrections = affected.failedStepIds.map((stepId) => {
    const step = failedStepById.get(stepId);
    if (step === undefined) fail("relation");
    return Object.freeze({ stepId: step.stepId, observed: step.observed });
  });
  return projectTargetDeliveryProductDefectRemediationContext({
    authorization: Object.freeze({
      productDefectRemediationId: authorization.productDefectRemediationId,
      authorizationDigest: authorization.authorizationDigest,
    }),
    testReviewDecision: Object.freeze({
      targetReviewDecisionId:
        authorization.source.testReviewDecision.targetReviewDecisionId,
      decisionDigest: authorization.source.testReviewDecision.decisionDigest,
    }),
    previousResult: Object.freeze({
      targetResultId: previousResult.targetResultId,
      resultDigest: previousResult.resultDigest,
    }),
    authorizationRationale: authorization.authorizationRationale,
    correctionObjective: affected.correctionObjective,
    requiredCorrections,
  });
}
