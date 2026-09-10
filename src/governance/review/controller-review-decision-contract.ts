import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import type { TestFailureClassification } from "../../contracts/vocabulary/test-step-vocabulary.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../foundation/time/utc-instant.js";
import type { DemandEventStreamRevision } from "../demand/event-sourcing/demand-event-stream-position.js";
import type { TargetResultOutcome } from "../result/target-result-report-contract.js";

/**
 * 两类Controller Review Decision共享的最小、无I/O审查词汇（ADR-0012 D4、D5）。
 *
 * escalate 携带给用户的问题、需求引用、证据、备选方案与建议；blocked 或 escalated 之后
 * 的新决定携带 resumption；callbackLanding 与 targetCompletion 由 Wakeflow 从 hook
 * 记录派生后写进决定，Controller 不撰写。
 */

export type ControllerIndependentCheckOutcome =
  "passed" | "failed" | "inconclusive";

export interface ControllerIndependentReviewCheck {
  readonly checkId: string;
  readonly method: string;
  readonly outcome: ControllerIndependentCheckOutcome;
  readonly observation: string;
}

/** Decision绑定的精确Review Snapshot与TargetResult并发基线。 */
export interface ControllerReviewedTargetResult {
  readonly snapshotDigest: Sha256Digest;
  readonly reviewUnitDigest: Sha256Digest;
  readonly stateDigest: Sha256Digest;
  readonly streamRevision: DemandEventStreamRevision;
  readonly taskPackageId: WakeflowDurableId<"task-package">;
  readonly taskPackageDigest: Sha256Digest;
  readonly targetResultId: WakeflowDurableId<"target-result">;
  readonly targetResultDigest: Sha256Digest;
  readonly targetResultOutcome: TargetResultOutcome;
  readonly targetResultReportedAt: UtcInstant;
}

export type ControllerReviewEscalationEvidenceKind =
  | "target-result"
  | "review-decision"
  | "managed-evidence"
  | "host-effect";

export interface ControllerReviewEscalationOption {
  readonly option: string;
  readonly impact: string;
}

/** 升级给用户的内容；渲染与回答由 demand 切片承担（`lifecycle.demand-escalated`）。 */
export interface ControllerReviewEscalation {
  readonly issue: string;
  readonly requirementRefs: readonly Readonly<{
    readonly recordDigest: Sha256Digest;
    readonly sectionAnchor: string;
  }>[];
  readonly evidence: readonly Readonly<{
    readonly kind: ControllerReviewEscalationEvidenceKind;
    readonly id: string;
    readonly digest: Sha256Digest;
  }>[];
  readonly options: readonly [
    Readonly<ControllerReviewEscalationOption>,
    ...Readonly<ControllerReviewEscalationOption>[],
  ];
  readonly recommendation: string;
}

export type ControllerReviewResumptionBasis =
  | Readonly<{ readonly kind: "condition-cleared" }>
  | Readonly<{
      readonly kind: "decision-recorded";
      readonly escalationEventId: WakeflowDurableId<"demand-event">;
    }>;

/** blocked 或 escalated 之后在同一结果上再次决定的依据。 */
export interface ControllerReviewResumption {
  readonly previousDecisionId: WakeflowDurableId<"target-review-decision">;
  readonly basis: ControllerReviewResumptionBasis;
  readonly summary: string;
}

export interface ControllerReviewCallbackLanding {
  readonly recordId: string;
  readonly landedAt: UtcInstant;
}

export type ControllerReviewTargetCompletionEvent = "stop" | "turn-complete";

export interface ControllerReviewTargetCompletion {
  readonly recordId: string;
  readonly event: ControllerReviewTargetCompletionEvent;
  readonly observedAt: UtcInstant;
}

export interface ControllerTestReviewRemediationTarget {
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly failedStepIds: readonly [string, ...string[]];
  readonly correctionObjective: string;
}

export interface ControllerTestReviewRemediation {
  readonly affectedTargets: readonly [
    Readonly<ControllerTestReviewRemediationTarget>,
    ...Readonly<ControllerTestReviewRemediationTarget>[],
  ];
  readonly authorizationRationale: string;
}

/** 测试 escalate 的两条路：产品缺陷走授权返工，需要决策的走用户。 */
export type ControllerTestReviewEscalation =
  | Readonly<{
      readonly classification: Extract<TestFailureClassification, "product-defect">;
      readonly remediation: Readonly<ControllerTestReviewRemediation>;
    }>
  | Readonly<{
      readonly classification: Extract<TestFailureClassification, "needs-decision">;
      readonly userDecision: Readonly<ControllerReviewEscalation>;
    }>;

export type ControllerReviewSharedErrorReason =
  "identifier" | "digest" | "time" | "text";

type SharedFail = (reason: ControllerReviewSharedErrorReason, path: string) => never;

const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;

export interface ControllerReviewEscalationWire {
  readonly issue: string;
  readonly requirementRefs: readonly {
    readonly recordDigest: string;
    readonly sectionAnchor: string;
  }[];
  readonly evidence: readonly {
    readonly kind: ControllerReviewEscalationEvidenceKind;
    readonly id: string;
    readonly digest: string;
  }[];
  readonly options: readonly { readonly option: string; readonly impact: string }[];
  readonly recommendation: string;
}

export interface ControllerReviewResumptionWire {
  readonly previousDecisionId: string;
  readonly basis:
    | { readonly kind: "condition-cleared" }
    | { readonly kind: "decision-recorded"; readonly escalationEventId: string };
  readonly summary: string;
}

export interface ControllerTestReviewRemediationWire {
  readonly affectedTargets: readonly {
    readonly targetTaskId: string;
    readonly failedStepIds: readonly string[];
    readonly correctionObjective: string;
  }[];
  readonly authorizationRationale: string;
}

/** 生成类型不是判别联合：分类之外的两段都可选，由本模块按分类要求其一。 */
export interface ControllerTestReviewEscalationWire {
  readonly classification: "product-defect" | "needs-decision";
  readonly remediation?: ControllerTestReviewRemediationWire;
  readonly userDecision?: ControllerReviewEscalationWire;
}

function reviewText(
  value: string,
  path: string,
  fail: SharedFail,
  maximum = 8192,
): string {
  if (
    value.length === 0 ||
    value.length > maximum ||
    !value.isWellFormed() ||
    value.normalize("NFC") !== value ||
    value.trim() !== value ||
    CONTROL_EXCEPT_LF_PATTERN.test(value)
  ) {
    fail("text", path);
  }
  return value;
}

function reviewDigest(value: string, path: string, fail: SharedFail): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path);
    throw error;
  }
}

function reviewId<
  Kind extends "target-review-decision" | "demand-event" | "target-task",
>(value: string, kind: Kind, path: string, fail: SharedFail): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
    throw error;
  }
}

function reviewInstant(value: string, path: string, fail: SharedFail): UtcInstant {
  try {
    return parseUtcInstant(value, path);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", path);
    throw error;
  }
}

/** 把 Schema 已校验的升级内容冻结为领域值；备选方案至少一个（Schema 上限 4）。 */
export function normalizeControllerReviewEscalation(
  wire: Readonly<ControllerReviewEscalationWire>,
  path: string,
  fail: SharedFail,
): Readonly<ControllerReviewEscalation> {
  const options = wire.options.map((option, index) =>
    Object.freeze({
      option: reviewText(option.option, `${path}/options/${index}/option`, fail, 1024),
      impact: reviewText(option.impact, `${path}/options/${index}/impact`, fail, 2048),
    }),
  );
  const [first, ...rest] = options;
  if (first === undefined) fail("text", `${path}/options`);
  const admittedOptions: readonly [
    Readonly<ControllerReviewEscalationOption>,
    ...Readonly<ControllerReviewEscalationOption>[],
  ] = Object.freeze([first, ...rest]);
  return Object.freeze({
    issue: reviewText(wire.issue, `${path}/issue`, fail),
    requirementRefs: Object.freeze(
      wire.requirementRefs.map((reference, index) =>
        Object.freeze({
          recordDigest: reviewDigest(
            reference.recordDigest,
            `${path}/requirementRefs/${index}/recordDigest`,
            fail,
          ),
          sectionAnchor: reference.sectionAnchor,
        }),
      ),
    ),
    evidence: Object.freeze(
      wire.evidence.map((entry, index) =>
        Object.freeze({
          kind: entry.kind,
          id: entry.id,
          digest: reviewDigest(entry.digest, `${path}/evidence/${index}/digest`, fail),
        }),
      ),
    ),
    options: admittedOptions,
    recommendation: reviewText(
      wire.recommendation,
      `${path}/recommendation`,
      fail,
      4096,
    ),
  });
}

export function normalizeControllerReviewResumption(
  wire: Readonly<ControllerReviewResumptionWire>,
  path: string,
  fail: SharedFail,
): Readonly<ControllerReviewResumption> {
  return Object.freeze({
    previousDecisionId: reviewId(
      wire.previousDecisionId,
      "target-review-decision",
      `${path}/previousDecisionId`,
      fail,
    ),
    basis:
      wire.basis.kind === "condition-cleared"
        ? Object.freeze({ kind: "condition-cleared" as const })
        : Object.freeze({
            kind: "decision-recorded" as const,
            escalationEventId: reviewId(
              wire.basis.escalationEventId,
              "demand-event",
              `${path}/basis/escalationEventId`,
              fail,
            ),
          }),
    summary: reviewText(wire.summary, `${path}/summary`, fail),
  });
}

export function normalizeControllerReviewCallbackLanding(
  wire: Readonly<{ readonly recordId: string; readonly landedAt: string }> | null,
  path: string,
  fail: SharedFail,
): Readonly<ControllerReviewCallbackLanding> | null {
  if (wire === null) return null;
  return Object.freeze({
    recordId: wire.recordId,
    landedAt: reviewInstant(wire.landedAt, `${path}/landedAt`, fail),
  });
}

export function normalizeControllerReviewTargetCompletion(
  wire: Readonly<{
    readonly recordId: string;
    readonly event: ControllerReviewTargetCompletionEvent;
    readonly observedAt: string;
  }> | null,
  path: string,
  fail: SharedFail,
): Readonly<ControllerReviewTargetCompletion> | null {
  if (wire === null) return null;
  return Object.freeze({
    recordId: wire.recordId,
    event: wire.event,
    observedAt: reviewInstant(wire.observedAt, `${path}/observedAt`, fail),
  });
}

export function normalizeControllerTestReviewEscalation(
  wire: Readonly<ControllerTestReviewEscalationWire>,
  path: string,
  fail: SharedFail,
): Readonly<ControllerTestReviewEscalation> {
  if (wire.classification === "needs-decision") {
    if (wire.userDecision === undefined || wire.remediation !== undefined) {
      fail("text", `${path}/userDecision`);
    }
    return Object.freeze({
      classification: "needs-decision" as const,
      userDecision: normalizeControllerReviewEscalation(
        wire.userDecision,
        `${path}/userDecision`,
        fail,
      ),
    });
  }
  const remediation = wire.remediation;
  if (remediation === undefined || wire.userDecision !== undefined) {
    fail("text", `${path}/remediation`);
  }
  const targets = remediation.affectedTargets.map((target, index) => {
    const targetPath = `${path}/remediation/affectedTargets/${index}`;
    const [firstStep, ...otherSteps] = target.failedStepIds;
    if (firstStep === undefined) fail("text", `${targetPath}/failedStepIds`);
    const failedStepIds: readonly [string, ...string[]] = Object.freeze([
      firstStep,
      ...otherSteps,
    ]);
    return Object.freeze({
      targetTaskId: reviewId(
        target.targetTaskId,
        "target-task",
        `${targetPath}/targetTaskId`,
        fail,
      ),
      failedStepIds,
      correctionObjective: reviewText(
        target.correctionObjective,
        `${targetPath}/correctionObjective`,
        fail,
      ),
    });
  });
  const [firstTarget, ...otherTargets] = targets;
  if (firstTarget === undefined) fail("text", `${path}/remediation/affectedTargets`);
  const affectedTargets: readonly [
    Readonly<ControllerTestReviewRemediationTarget>,
    ...Readonly<ControllerTestReviewRemediationTarget>[],
  ] = Object.freeze([firstTarget, ...otherTargets]);
  return Object.freeze({
    classification: "product-defect" as const,
    remediation: Object.freeze({
      affectedTargets,
      authorizationRationale: reviewText(
        remediation.authorizationRationale,
        `${path}/remediation/authorizationRationale`,
        fail,
      ),
    }),
  });
}
