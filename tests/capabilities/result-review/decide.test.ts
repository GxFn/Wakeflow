import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import type { WakeflowDurableId } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import type { TestTargetResultStep } from "../../../src/governance/result/test-target-result-report.js";
import type { TestContractStep } from "../../../src/governance/tasking/task-package.js";
import { DEFAULT_ALLOWED_ID_PREFIXES } from "../../../src/kernel/privacy-scan.js";
import {
  collectEvidenceReferences,
  deriveCallbackLanding,
  deriveImplementationAllowedDecisions,
  deriveImplementationDecisionBlockers,
  derivePrivacyRules,
  deriveResumptionBlockers,
  deriveStepViews,
  deriveTargetCompletion,
  deriveTestAllowedDecisions,
  deriveTestDecisionBlockers,
  deriveUnionVerdict,
  planEvidenceLocator,
  reportTexts,
  type StepView,
  type TestAdmissionView,
} from "../../../src/capabilities/result-review/decide.js";
import { deriveTargetResultCallbackStatus } from "../../../src/governance/result/target-result-callback.js";

/**
 * 结果导入与评审的纯决定（§13.87 D2 D3 D6 D7）：定位符计划、隐私规则、完成证据、回调状态、
 * 允许的决定与阻塞项、approved 基线与并集判定。这里没有 I/O。
 */

const EVIDENCE_ID = "evidence_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DIGEST = parseSha256Digest(`sha256:${"1".repeat(64)}`);
const OTHER_DIGEST = parseSha256Digest(`sha256:${"2".repeat(64)}`);
const REPORTED_AT = parseUtcInstant("2026-08-29T12:10:00.000Z");
const ISSUED_AT = parseUtcInstant("2026-08-29T12:10:30.000Z");
const TARGET_A =
  "target-task_99999999-9999-4999-8999-999999999999" as WakeflowDurableId<"target-task">;
const TARGET_B =
  "target-task_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as WakeflowDurableId<"target-task">;

test("证据定位符只解析同 Demand 受管证据记录内的 manifest 或 payload 成员", () => {
  deepEqual(planEvidenceLocator(`artifacts/managed-evidence/${EVIDENCE_ID}/manifest.json`), {
    evidenceId: EVIDENCE_ID,
    member: "manifest",
  });
  deepEqual(planEvidenceLocator(`artifacts/managed-evidence/${EVIDENCE_ID}/payload/logs/a.txt`), {
    evidenceId: EVIDENCE_ID,
    member: "payload",
    memberRef: "logs/a.txt",
  });
  equal(planEvidenceLocator(`artifacts/managed-evidence/${EVIDENCE_ID}/payload/`), null);
  equal(planEvidenceLocator(`artifacts/managed-evidence/${EVIDENCE_ID}/other.json`), null);
  equal(planEvidenceLocator("artifacts/managed-evidence/not-an-id/payload/x"), null);
  equal(planEvidenceLocator("reports/verification.json"), null);
  equal(planEvidenceLocator("/absolute/artifacts/managed-evidence/x"), null);
});

test("报告里的证据引用去重收集，自由文本按隐私规则只返回命中类别", () => {
  const ref = `artifacts/managed-evidence/${EVIDENCE_ID}/payload/content`;
  const references = collectEvidenceReferences({
    evidenceLocators: [{ ref, digest: DIGEST }],
    anchorEvidence: [
      {
        evidenceRefs: [
          { ref, digest: DIGEST },
          { ref, digest: OTHER_DIGEST },
        ],
      },
    ],
    steps: [{ evidence: { ref, digest: DIGEST } }],
  });
  equal(references.length, 2);
  equal(Object.isFrozen(references), true);
  const texts = reportTexts({
    summary: "done",
    verification: ["node --test"],
    risks: [],
    steps: [
      { observed: "ok" },
      { observed: "failed", failure: { recommendedAction: "token = abcdefghijkl" } },
    ],
  });
  equal(texts.length, 5);
  const policy = { allowedPathRoots: [], allowedIdPrefixes: DEFAULT_ALLOWED_ID_PREFIXES };
  deepEqual(derivePrivacyRules(texts, policy), ["credential-assignment"]);
  deepEqual(
    derivePrivacyRules(
      ["/Users/someone/private/path/file", "sk-ant-abcdefghijklmnopqrstu"],
      policy,
    ),
    ["provider-credential", "unlisted-absolute-path"],
  );
  deepEqual(derivePrivacyRules(["demand_22222222-2222-4222-8222-222222222222"], policy), []);
});

test("完成证据取结果之后的首条 Stop/turn-complete 记录，回调落地取摘要相符的 user-prompt-submit", () => {
  const records = [
    {
      recordId: "r0",
      event: "stop",
      promptDigest: null,
      recordedAt: parseUtcInstant("2026-08-29T12:09:00.000Z"),
    },
    {
      recordId: "r2",
      event: "turn-complete",
      promptDigest: null,
      recordedAt: parseUtcInstant("2026-08-29T12:12:00.000Z"),
    },
    {
      recordId: "r1",
      event: "stop",
      promptDigest: null,
      recordedAt: parseUtcInstant("2026-08-29T12:11:00.000Z"),
    },
    {
      recordId: "r3",
      event: "user-prompt-submit",
      promptDigest: DIGEST,
      recordedAt: parseUtcInstant("2026-08-29T12:11:30.000Z"),
    },
  ];
  deepEqual(deriveTargetCompletion(records, REPORTED_AT), {
    status: "confirmed",
    recordId: "r1",
    event: "stop",
    observedAt: parseUtcInstant("2026-08-29T12:11:00.000Z"),
  });
  deepEqual(deriveTargetCompletion(records.slice(0, 1), REPORTED_AT), { status: "pending" });
  deepEqual(deriveCallbackLanding(records, DIGEST, ISSUED_AT), {
    recordId: "r3",
    landedAt: parseUtcInstant("2026-08-29T12:11:30.000Z"),
  });
  equal(deriveCallbackLanding(records, OTHER_DIGEST, ISSUED_AT), null);
  equal(deriveCallbackLanding(records, DIGEST, parseUtcInstant("2026-08-29T12:12:00.000Z")), null);
  const silenceMilliseconds = 10 * 60 * 1000;
  equal(
    deriveTargetResultCallbackStatus({
      issuedAt: ISSUED_AT,
      promptDigest: DIGEST,
      landingRecords: [],
      acknowledged: false,
      now: parseUtcInstant("2026-08-29T12:15:00.000Z"),
      silenceMilliseconds,
    }).status,
    "pending",
  );
  equal(
    deriveTargetResultCallbackStatus({
      issuedAt: ISSUED_AT,
      promptDigest: DIGEST,
      landingRecords: [],
      acknowledged: false,
      now: parseUtcInstant("2026-08-29T12:21:00.000Z"),
      silenceMilliseconds,
    }).status,
    "silent",
  );
  equal(
    deriveTargetResultCallbackStatus({
      issuedAt: ISSUED_AT,
      promptDigest: DIGEST,
      landingRecords: records,
      acknowledged: false,
      now: parseUtcInstant("2026-08-29T12:21:00.000Z"),
      silenceMilliseconds,
    }).status,
    "landed",
  );
  equal(
    deriveTargetResultCallbackStatus({
      issuedAt: ISSUED_AT,
      promptDigest: DIGEST,
      landingRecords: [],
      acknowledged: true,
      now: parseUtcInstant("2026-08-29T12:21:00.000Z"),
      silenceMilliseconds,
    }).status,
    "acknowledged",
  );
});

test("实现决定：accept 要求 completed 与完成证据；resumption 只接在 blocked/escalated 之后", () => {
  const confirmed = {
    status: "confirmed" as const,
    recordId: "r1",
    event: "stop" as const,
    observedAt: REPORTED_AT,
  };
  const view = (
    outcome: "completed" | "blocked" | "needs-review",
    targetCompletion: Parameters<
      typeof deriveImplementationAllowedDecisions
    >[0]["targetCompletion"],
    managedEvidenceIds: readonly string[] = [],
  ) => ({ outcome, targetCompletion, acceptanceAnchorIds: ["ac-1", "ac-2"], managedEvidenceIds });
  deepEqual(deriveImplementationAllowedDecisions(view("completed", confirmed)), [
    "accept",
    "rework",
    "blocked",
    "escalate",
  ]);
  deepEqual(deriveImplementationAllowedDecisions(view("completed", { status: "pending" })), [
    "rework",
    "blocked",
    "escalate",
  ]);
  deepEqual(deriveImplementationAllowedDecisions(view("blocked", confirmed)), [
    "rework",
    "blocked",
    "escalate",
  ]);
  // rework 带上独立检查时至少一条 failed；不带检查（允许集推导）时不阻塞（§13.119）。
  const needsReview = view("needs-review", confirmed);
  deepEqual(deriveImplementationDecisionBlockers("rework", needsReview, [{ outcome: "passed" }]), [
    "rework-checks:no-failed",
  ]);
  deepEqual(
    deriveImplementationDecisionBlockers("rework", needsReview, [
      { outcome: "passed" },
      { outcome: "failed" },
    ]),
    [],
  );
  deepEqual(deriveImplementationDecisionBlockers("rework", needsReview), []);
  // needs-review 的 accept（§13.121 D7）：允许集只看本 Demand 有没有托管证据；记录时逐锚点核对绑定。
  const E1 = "evidence_11111111-1111-4111-8111-111111111111";
  const E2 = "evidence_22222222-2222-4222-8222-222222222222";
  deepEqual(deriveImplementationDecisionBlockers("accept", needsReview, [{ outcome: "passed" }]), [
    "anchor-evidence:no-managed-evidence",
  ]);
  deepEqual(deriveImplementationAllowedDecisions(needsReview), ["rework", "blocked", "escalate"]);
  const withEvidence = view("needs-review", confirmed, [E1]);
  deepEqual(deriveImplementationAllowedDecisions(withEvidence), [
    "accept",
    "rework",
    "blocked",
    "escalate",
  ]);
  const passed = [{ outcome: "passed" as const }];
  deepEqual(deriveImplementationDecisionBlockers("accept", withEvidence, passed, null), [
    "anchor-evidence:missing",
  ]);
  deepEqual(
    deriveImplementationDecisionBlockers("accept", withEvidence, passed, [
      { anchorId: "ac-1", evidenceIds: [E1] },
    ]),
    ["anchor-evidence:uncovered:ac-2"],
  );
  deepEqual(
    deriveImplementationDecisionBlockers("accept", withEvidence, passed, [
      { anchorId: "ac-1", evidenceIds: [E1] },
      { anchorId: "ac-2", evidenceIds: [E2] },
      { anchorId: "ac-9", evidenceIds: [E1] },
    ]),
    [`anchor-evidence:unknown-evidence:${E2}`, "anchor-evidence:unknown-anchor:ac-9"],
  );
  deepEqual(
    deriveImplementationDecisionBlockers("accept", withEvidence, passed, [
      { anchorId: "ac-1", evidenceIds: [E1] },
      { anchorId: "ac-2", evidenceIds: [E1] },
    ]),
    [],
  );
  deepEqual(
    deriveImplementationDecisionBlockers("accept", view("blocked", confirmed, [E1]), passed),
    ["outcome:blocked"],
  );
  const reported = {
    status: "reported" as const,
    currentDecisionId: null,
    escalationEventId: null,
    escalationAnswered: false,
  };
  deepEqual(deriveResumptionBlockers(reported, undefined), []);
  deepEqual(
    deriveResumptionBlockers(reported, {
      previousDecisionId: "x",
      basis: { kind: "condition-cleared" },
    }),
    ["resumption-unexpected"],
  );
  const blocked = {
    status: "review-blocked" as const,
    currentDecisionId: "d1",
    escalationEventId: null,
    escalationAnswered: false,
  };
  deepEqual(deriveResumptionBlockers(blocked, undefined), ["resumption-missing"]);
  deepEqual(
    deriveResumptionBlockers(blocked, {
      previousDecisionId: "d1",
      basis: { kind: "condition-cleared" },
    }),
    [],
  );
  deepEqual(
    deriveResumptionBlockers(blocked, {
      previousDecisionId: "d0",
      basis: { kind: "decision-recorded", escalationEventId: "e1" },
    }),
    ["resumption-previous-decision", "resumption-basis:decision-recorded"],
  );
  const escalated = {
    status: "escalated" as const,
    currentDecisionId: "d1",
    escalationEventId: "e1",
    escalationAnswered: false,
  };
  deepEqual(
    deriveResumptionBlockers(escalated, {
      previousDecisionId: "d1",
      basis: { kind: "decision-recorded", escalationEventId: "e1" },
    }),
    ["awaiting-decision"],
  );
  deepEqual(
    deriveResumptionBlockers(
      { ...escalated, escalationAnswered: true },
      { previousDecisionId: "d1", basis: { kind: "decision-recorded", escalationEventId: "e2" } },
    ),
    ["resumption-escalation-event"],
  );
});

function contractStep(stepId: string, then: string): TestContractStep {
  return {
    stepId,
    given: "given",
    when: "when",
    then,
    requirementRef: {
      recordDigest: DIGEST,
      sectionAnchor: "acceptance-criteria",
      itemId: `ac-${stepId.slice("ts-".length)}`,
    },
  };
}

function step(
  stepId: string,
  verdict: TestTargetResultStep["verdict"],
  classification?: TestTargetResultStep["failure"] extends infer F
    ? F extends { readonly classification: infer C }
      ? C
      : never
    : never,
): TestTargetResultStep {
  const evidence = {
    ref: `artifacts/managed-evidence/${EVIDENCE_ID}/payload/content` as never,
    digest: DIGEST,
  };
  return classification === undefined
    ? { stepId, observed: `${stepId} observed`, evidence, verdict }
    : {
        stepId,
        observed: `${stepId} observed`,
        evidence,
        verdict,
        failure: { classification, likelyOwner: "test", recommendedAction: "retry" },
      };
}

test("逐步视图：范围外步骤沿用同目标更早尝试或 retest 链里引用同一需求条目的步骤的通过记录；并集判定按合同全集", () => {
  const contract = [
    contractStep("ts-1", "A"),
    contractStep("ts-2", "B"),
    contractStep("ts-3", "C"),
  ];
  const priorAttempt = {
    targetTaskId: TARGET_A,
    attemptOrdinal: 1,
    steps: [
      step("ts-1", "pass"),
      step("ts-2", "fail", "flaky"),
      step("ts-3", "fail", "product-defect"),
    ],
    itemIdByStepId: new Map([
      ["ts-1", "ac-1"],
      ["ts-2", "ac-2"],
      ["ts-3", "ac-3"],
    ]),
  };
  const retested = {
    targetTaskId: TARGET_B,
    attemptOrdinal: 1,
    steps: [step("ts-7", "pass")],
    // 复测合同的 ts-7 引用与上一代 ts-3 相同的验收条目；措辞可以不同。
    itemIdByStepId: new Map([["ts-7", "ac-3"]]),
  };
  const views = deriveStepViews(
    contract,
    { steps: [step("ts-2", "pass")], stepIds: ["ts-2"] },
    [priorAttempt],
    [retested],
  );
  equal(views.length, 3);
  equal(views[0]?.observed, null);
  equal(views[0]?.baseline?.attemptOrdinal, 1);
  equal(views[0]?.baseline?.targetTaskId, TARGET_A);
  equal(views[1]?.verdict, "pass");
  equal(views[1]?.baseline, null);
  equal(views[2]?.baseline?.targetTaskId, TARGET_B);
  equal(views[2]?.expected, "C");
  equal(deriveUnionVerdict(views), "pass");
  const missing = deriveStepViews(
    contract,
    { steps: [step("ts-2", "pass")], stepIds: ["ts-2"] },
    [],
    [],
  );
  equal(deriveUnionVerdict(missing), "cannot-conclude");
  const failing = deriveStepViews(
    contract,
    {
      steps: [
        step("ts-1", "pass"),
        step("ts-2", "fail", "harness-defect"),
        step("ts-3", "blocked", "environment"),
      ],
      stepIds: null,
    },
    [],
    [],
  );
  equal(deriveUnionVerdict(failing), "fail");
  equal(deriveUnionVerdict(failing.filter((view) => view.stepId !== "ts-2")), "blocked");
});

function admission(
  steps: readonly Readonly<StepView>[],
  overrides: Partial<TestAdmissionView> = {},
): TestAdmissionView {
  return {
    outcome: "completed",
    targetCompletion: {
      status: "confirmed",
      recordId: "r1",
      event: "stop",
      observedAt: REPORTED_AT,
    },
    steps,
    attemptCount: 1,
    maxAttempts: 3,
    previouslyFlakyStepIds: [],
    ...overrides,
  };
}

test("测试决定的分类路由：accept、可重跑分类、容量、连续 flaky、environment 阻塞与产品缺陷映射", () => {
  const contract = [contractStep("ts-1", "A"), contractStep("ts-2", "B")];
  const allPass = deriveStepViews(
    contract,
    { steps: [step("ts-1", "pass"), step("ts-2", "pass")], stepIds: null },
    [],
    [],
  );
  deepEqual(deriveTestAllowedDecisions(admission(allPass)), ["accept", "escalate"]);
  deepEqual(
    deriveTestDecisionBlockers(
      { decision: "accept" },
      admission(allPass, { targetCompletion: { status: "pending" } }),
    ),
    ["target-completion-pending"],
  );
  const flaky = deriveStepViews(
    contract,
    { steps: [step("ts-1", "pass"), step("ts-2", "fail", "flaky")], stepIds: null },
    [],
    [],
  );
  deepEqual(deriveTestAllowedDecisions(admission(flaky)), ["request-another-attempt", "escalate"]);
  deepEqual(deriveTestDecisionBlockers({ decision: "accept" }, admission(flaky)), ["verdict:fail"]);
  deepEqual(
    deriveTestDecisionBlockers(
      { decision: "request-another-attempt", stepIds: ["ts-2"] },
      admission(flaky, { attemptCount: 3 }),
    ),
    ["attempt-capacity:3"],
  );
  deepEqual(
    deriveTestDecisionBlockers(
      { decision: "request-another-attempt", stepIds: ["ts-1"] },
      admission(flaky),
    ),
    ["step-scope:ts-1"],
  );
  deepEqual(
    deriveTestDecisionBlockers(
      { decision: "request-another-attempt", stepIds: ["ts-2"] },
      admission(flaky, { previouslyFlakyStepIds: ["ts-2"] }),
    ),
    ["flaky-repeat:ts-2"],
  );
  const defect = deriveStepViews(
    contract,
    { steps: [step("ts-1", "pass"), step("ts-2", "fail", "product-defect")], stepIds: null },
    [],
    [],
  );
  deepEqual(deriveTestAllowedDecisions(admission(defect)), ["escalate"]);
  deepEqual(
    deriveTestDecisionBlockers(
      { decision: "request-another-attempt", stepIds: ["ts-2"] },
      admission(defect),
    ),
    ["classification:ts-2:product-defect"],
  );
  deepEqual(
    deriveTestDecisionBlockers(
      {
        decision: "escalate",
        escalation: {
          classification: "product-defect",
          remediation: { affectedTargets: [{ failedStepIds: ["ts-1"] }] },
        },
      },
      admission(defect),
    ),
    ["remediation-step:ts-1"],
  );
  deepEqual(
    deriveTestDecisionBlockers(
      {
        decision: "escalate",
        escalation: {
          classification: "product-defect",
          remediation: { affectedTargets: [{ failedStepIds: ["ts-2"] }] },
        },
      },
      admission(allPass),
    ),
    ["product-defect-missing", "remediation-step:ts-2"],
  );
  deepEqual(
    deriveTestDecisionBlockers(
      { decision: "escalate", escalation: { classification: "needs-decision" } },
      admission(defect),
    ),
    [],
  );
  const environment = deriveStepViews(
    contract,
    { steps: [step("ts-1", "pass"), step("ts-2", "blocked", "environment")], stepIds: null },
    [],
    [],
  );
  deepEqual(deriveTestAllowedDecisions(admission(environment, { outcome: "blocked" })), [
    "blocked",
    "escalate",
  ]);
  deepEqual(deriveTestDecisionBlockers({ decision: "blocked" }, admission(allPass)), [
    "blocked-basis",
  ]);
});
