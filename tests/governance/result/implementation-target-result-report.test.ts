import { equal, notEqual, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  createImplementationTargetResultReport,
  parseImplementationTargetResultReport,
  parseImplementationTargetResultReportDocument,
  renderImplementationTargetResultReport,
  implementationTargetResultReportContentDigest,
  ImplementationTargetResultReportError,
} from "../../../src/governance/result/implementation-target-result-report.js";
import {
  createImplementationTargetResultReportContentFixture,
  createImplementationTargetResultReportFixture,
} from "./implementation-target-result-report.fixture.js";

test("ImplementationTargetResultReport只保存Agent业务陈述并使用显式Git object format", () => {
  const content = createImplementationTargetResultReportContentFixture();
  const report = createImplementationTargetResultReportFixture();
  equal(report.outcome, "completed");
  const committed = createImplementationTargetResultReport({
    ...content,
    repositoryChange: {
      ...content.repositoryChange,
      disposition: "committed",
      commits: [{ algorithm: "sha1", value: "a".repeat(40) }],
    },
  });
  equal(committed.repositoryChange.commits[0]?.algorithm, "sha1");
  equal(report.anchorEvidence.length > 0, true);
  equal(Object.hasOwn(report, "transport"), false);
  equal(Object.hasOwn(report, "claim"), false);
  equal(Object.isFrozen(report.repositoryChange.commits), true);
  const document = renderImplementationTargetResultReport(report);
  equal(
    parseImplementationTargetResultReportDocument(document).reportDigest,
    report.reportDigest,
  );

  const later = createImplementationTargetResultReport(content, {
    clock: () => parseUtcInstant("2026-08-29T12:11:00.000Z"),
  });
  equal(
    implementationTargetResultReportContentDigest(content),
    implementationTargetResultReportContentDigest({
      outcome: later.outcome,
      summary: later.summary,
      repositoryChange: later.repositoryChange,
      evidenceLocators: later.evidenceLocators,
      verification: later.verification,
      risks: later.risks,
      anchorEvidence: later.anchorEvidence,
    }),
  );
  notEqual(later.reportDigest, report.reportDigest);
});

test("ImplementationTargetResultReport拒绝无Locator的anchor evidence与repository矛盾", () => {
  const content = createImplementationTargetResultReportContentFixture();
  throws(
    () =>
      createImplementationTargetResultReport({
        ...content,
        anchorEvidence: [
          {
            ...content.anchorEvidence[0],
            evidenceRefs: [
              {
                ref: "reports/missing.json",
                digest: parseSha256Digest(`sha256:${"c".repeat(64)}`),
              },
            ],
          },
        ],
      }),
    (error: unknown) =>
      error instanceof ImplementationTargetResultReportError &&
      error.reason === "relation",
  );
  throws(
    () =>
      createImplementationTargetResultReport({
        ...content,
        repositoryChange: {
          ...content.repositoryChange,
          disposition: "committed",
        },
      }),
    (error: unknown) =>
      error instanceof ImplementationTargetResultReportError &&
      error.reason === "relation",
  );
});

test("ImplementationTargetResultReport拒绝摘要漂移", () => {
  const report = createImplementationTargetResultReportFixture();
  throws(
    () =>
      parseImplementationTargetResultReport({
        ...report,
        reportDigest: parseSha256Digest(`sha256:${"d".repeat(64)}`),
      }),
    (error: unknown) =>
      error instanceof ImplementationTargetResultReportError &&
      error.reason === "digest",
  );
});
