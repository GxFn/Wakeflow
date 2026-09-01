import { equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  createTestTargetResultReport,
  parseTestTargetResultReport,
  parseTestTargetResultReportDocument,
  renderTestTargetResultReport,
  testTargetResultReportContentDigest,
  TestTargetResultReportError,
} from "../../../src/governance/result/test-target-result-report.js";

const REPORTED_AT = parseUtcInstant("2026-08-30T10:00:00.000Z");
const FIRST_DIGEST = `sha256:${"1".repeat(64)}`;
const SECOND_DIGEST = `sha256:${"2".repeat(64)}`;

function completedContent() {
  return {
    outcome: "completed" as const,
    summary: "已执行Controller批准的真实环境步骤并返回可复核事实。",
    evidenceLocators: [
      {
        kind: "test-step-report",
        ref: "evidence/test-runs/step-0.json",
        digest: FIRST_DIGEST,
      },
    ],
    verification: ["已复验Evidence文档可读取且摘要一致。"],
    risks: ["该结果不替代Controller的独立判断。"],
    stepEvidence: [
      {
        planIndex: 0,
        step: "在已确认环境执行冷启动并观察真实入口",
        evidence: {
          ref: "evidence/test-runs/step-0.json",
          digest: FIRST_DIGEST,
        },
      },
    ],
  };
}

test("TestTargetResultReport只保存逐步Evidence陈述并保持确定性表示", () => {
  const content = completedContent();
  const report = createTestTargetResultReport(content, {
    clock: () => REPORTED_AT,
  });
  equal(report.kind, "WakeflowTestTargetResultReport");
  equal(report.outcome, "completed");
  equal(report.stepEvidence[0]?.planIndex, 0);
  equal(report.stepEvidence[0]?.evidence.digest, FIRST_DIGEST);
  equal(Object.hasOwn(report, "repositoryChange"), false);
  equal(Object.hasOwn(report, "anchorEvidence"), false);
  equal(Object.hasOwn(report, "verdict"), false);
  equal(Object.isFrozen(report.stepEvidence), true);
  equal(
    parseTestTargetResultReportDocument(renderTestTargetResultReport(report))
      .reportDigest,
    report.reportDigest,
  );
  equal(
    testTargetResultReportContentDigest(content),
    testTargetResultReportContentDigest({ ...content }),
  );
});

test("TestTargetResultReport拒绝悬空Evidence、重复ref与乱序步骤", () => {
  const content = completedContent();
  const firstStep = content.stepEvidence[0]!;
  const firstLocator = content.evidenceLocators[0]!;
  throws(
    () =>
      createTestTargetResultReport({
        ...content,
        stepEvidence: [
          {
            ...firstStep,
            evidence: {
              ...firstStep.evidence,
              digest: SECOND_DIGEST,
            },
          },
        ],
      }),
    (error: unknown) =>
      error instanceof TestTargetResultReportError &&
      error.reason === "relation",
  );
  throws(
    () =>
      createTestTargetResultReport({
        ...content,
        evidenceLocators: [
          ...content.evidenceLocators,
          {
            kind: "screenshot",
            ref: firstLocator.ref,
            digest: SECOND_DIGEST,
          },
        ],
      }),
    (error: unknown) =>
      error instanceof TestTargetResultReportError &&
      error.reason === "relation",
  );
  throws(
    () =>
      createTestTargetResultReport({
        ...content,
        evidenceLocators: [
          ...content.evidenceLocators,
          {
            kind: "test-step-report",
            ref: "evidence/test-runs/step-1.json",
            digest: SECOND_DIGEST,
          },
        ],
        stepEvidence: [
          {
            planIndex: 1,
            step: "记录冷启动输出",
            evidence: {
              ref: "evidence/test-runs/step-1.json",
              digest: SECOND_DIGEST,
            },
          },
          firstStep,
        ],
      }),
    (error: unknown) =>
      error instanceof TestTargetResultReportError &&
      error.reason === "relation",
  );
});

test("TestTargetResultReport允许blocked部分结果但拒绝空completed结果", () => {
  const blocked = createTestTargetResultReport(
    {
      outcome: "blocked",
      summary: "环境与冻结TestCard不一致，未执行批准步骤。",
      evidenceLocators: [],
      verification: [],
      risks: ["需要Controller确认环境事实。"],
      stepEvidence: [],
    },
    { clock: () => REPORTED_AT },
  );
  equal(blocked.stepEvidence.length, 0);
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
});
