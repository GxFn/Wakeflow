import { equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  createTestTargetResultReport,
  deriveTestVerdict,
  parseTestTargetResultReport,
  parseTestTargetResultReportDocument,
  renderTestTargetResultReport,
  testTargetResultReportContentDigest,
  TestTargetResultReportError,
} from "../../../src/governance/result/test-target-result-report.js";

const REPORTED_AT = parseUtcInstant("2026-08-30T10:00:00.000Z");
const FIRST_DIGEST = `sha256:${"1".repeat(64)}`;
const SECOND_DIGEST = `sha256:${"2".repeat(64)}`;
const EVIDENCE_REF =
  "artifacts/managed-evidence/evidence_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/payload/content";

function completedContent() {
  return {
    outcome: "completed" as const,
    summary: "已执行Controller批准的真实环境步骤并返回逐步记录。",
    evidenceLocators: [{ kind: "test-output", ref: EVIDENCE_REF, digest: FIRST_DIGEST }],
    verification: ["已复验Evidence文档可读取且摘要一致。"],
    risks: ["该结果不替代Controller的独立判断。"],
    steps: [
      {
        stepId: "ts-1",
        observed: "入口按需求响应。",
        evidence: { ref: EVIDENCE_REF, digest: FIRST_DIGEST },
        verdict: "pass" as const,
      },
    ],
  };
}

function failedStep(stepId: string) {
  return {
    stepId,
    observed: "入口返回了错误状态。",
    evidence: { ref: EVIDENCE_REF, digest: FIRST_DIGEST },
    verdict: "fail" as const,
    failure: {
      classification: "product-defect" as const,
      likelyOwner: "implementation" as const,
      recommendedAction: "升级为产品缺陷修复。",
    },
  };
}

test("TestTargetResultReport保存逐步记录并由Wakeflow派生整体判定", () => {
  const content = completedContent();
  const report = createTestTargetResultReport(content, { clock: () => REPORTED_AT });
  equal(report.kind, "WakeflowTestTargetResultReport");
  equal(report.outcome, "completed");
  equal(report.verdict, "pass");
  equal(report.steps[0]?.stepId, "ts-1");
  equal(report.steps[0]?.evidence.digest, FIRST_DIGEST);
  equal(Object.hasOwn(report.steps[0] ?? {}, "failure"), false);
  equal(Object.hasOwn(report, "repositoryChange"), false);
  equal(Object.hasOwn(report, "stepEvidence"), false);
  equal(Object.isFrozen(report.steps), true);
  equal(
    parseTestTargetResultReportDocument(renderTestTargetResultReport(report)).reportDigest,
    report.reportDigest,
  );
  equal(
    testTargetResultReportContentDigest(content),
    testTargetResultReportContentDigest({ ...content }),
  );
  const failed = createTestTargetResultReport(
    { ...content, steps: [content.steps[0]!, failedStep("ts-2")] },
    { clock: () => REPORTED_AT },
  );
  equal(failed.verdict, "fail");
  equal(failed.steps[1]?.failure?.classification, "product-defect");
  equal(deriveTestVerdict([]), "cannot-conclude");
  equal(
    deriveTestVerdict([{ ...content.steps[0]!, verdict: "blocked" }, content.steps[0]!]),
    "blocked",
  );
});

test("TestTargetResultReport拒绝悬空Evidence、重复stepId、缺失或多余的failure与篡改的verdict", () => {
  const content = completedContent();
  const firstStep = content.steps[0]!;
  throws(
    () =>
      createTestTargetResultReport({
        ...content,
        steps: [{ ...firstStep, evidence: { ...firstStep.evidence, digest: SECOND_DIGEST } }],
      }),
    (error: unknown) =>
      error instanceof TestTargetResultReportError && error.reason === "relation",
  );
  throws(
    () => createTestTargetResultReport({ ...content, steps: [firstStep, firstStep] }),
    (error: unknown) =>
      error instanceof TestTargetResultReportError && error.reason === "relation",
  );
  throws(
    () =>
      createTestTargetResultReport({
        ...content,
        steps: [{ ...firstStep, verdict: "fail" }],
      }),
    (error: unknown) =>
      error instanceof TestTargetResultReportError &&
      (error.reason === "schema" || error.reason === "relation"),
  );
  throws(
    () =>
      createTestTargetResultReport({
        ...content,
        steps: [{ ...failedStep("ts-1"), verdict: "pass" }],
      }),
    (error: unknown) =>
      error instanceof TestTargetResultReportError &&
      (error.reason === "schema" || error.reason === "relation"),
  );
  const report = createTestTargetResultReport(content, { clock: () => REPORTED_AT });
  throws(
    () => parseTestTargetResultReport({ ...report, verdict: "fail" }),
    (error: unknown) =>
      error instanceof TestTargetResultReportError &&
      (error.reason === "relation" || error.reason === "digest"),
  );
});

test("TestTargetResultReport允许blocked部分结果但拒绝空completed结果与含fail的blocked", () => {
  const blocked = createTestTargetResultReport(
    {
      outcome: "blocked",
      summary: "环境与冻结测试合同不一致，未执行合同步骤。",
      evidenceLocators: [],
      verification: [],
      risks: ["需要Controller确认环境事实。"],
      steps: [],
    },
    { clock: () => REPORTED_AT },
  );
  equal(blocked.steps.length, 0);
  equal(blocked.verdict, "cannot-conclude");
  throws(
    () =>
      parseTestTargetResultReport({
        ...blocked,
        outcome: "completed",
        reportDigest: blocked.reportDigest,
      }),
    (error: unknown) =>
      error instanceof TestTargetResultReportError &&
      (error.reason === "schema" || error.reason === "digest"),
  );
  throws(
    () =>
      createTestTargetResultReport(
        { ...completedContent(), outcome: "blocked", steps: [failedStep("ts-1")] },
        { clock: () => REPORTED_AT },
      ),
    (error: unknown) =>
      error instanceof TestTargetResultReportError &&
      (error.reason === "schema" || error.reason === "relation"),
  );
});
