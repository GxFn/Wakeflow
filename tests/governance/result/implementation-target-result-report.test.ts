import { deepEqual, equal, notEqual, throws } from "node:assert/strict";
import { test } from "node:test";

import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  createImplementationTargetResultReport,
  ImplementationTargetResultReportError,
  implementationReportAnchorResults,
  implementationReportOutsideInstructions,
  implementationTargetResultReportContentDigest,
  parseImplementationTargetResultReport,
  parseImplementationTargetResultReportDocument,
  renderImplementationTargetResultReport,
} from "../../../src/governance/result/implementation-target-result-report.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import {
  createImplementationTargetResultReportContentFixture,
  createImplementationTargetResultReportFixture,
} from "./implementation-target-result-report.fixture.js";

useDisposableDurability();

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
  equal(parseImplementationTargetResultReportDocument(document).reportDigest, report.reportDigest);

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
      anchorResults: later.anchorResults,
      outsideInstructions: later.outsideInstructions,
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
      error instanceof ImplementationTargetResultReportError && error.reason === "relation",
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
      error instanceof ImplementationTargetResultReportError && error.reason === "relation",
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
      error instanceof ImplementationTargetResultReportError && error.reason === "digest",
  );
});

test("记录版本 2（ADR-0030）：逐条锚点的结论与任务包之外收到的指示进报告并进摘要；重复的锚点、未知的状态与指示里的未知词被拒", () => {
  const content = createImplementationTargetResultReportContentFixture();
  const report = createImplementationTargetResultReport({
    ...content,
    outsideInstructions: [
      { source: "user", summary: "顺手把 README 的标题也改了。", handling: "declined" },
    ],
  });
  equal(report.schemaVersion, 2);
  deepEqual(
    implementationReportAnchorResults(report)?.map((entry) => entry.status),
    content.anchorResults.map(() => "passed"),
  );
  deepEqual(implementationReportOutsideInstructions(report), [
    { source: "user", summary: "顺手把 README 的标题也改了。", handling: "declined" },
  ]);
  // 两项都在摘要的基里：改一条结论就是另一份报告。
  const [first, ...rest] = content.anchorResults;
  if (first === undefined) throw new Error("fixture has no anchors");
  const changed = createImplementationTargetResultReport({
    ...content,
    anchorResults: [{ ...first, status: "not-run", observed: "没有核对这一条。" }, ...rest],
  });
  notEqual(
    implementationTargetResultReportContentDigest({ ...content }),
    implementationTargetResultReportContentDigest({
      ...content,
      anchorResults: changed.anchorResults,
    }),
  );
  for (const [label, broken] of [
    ["duplicate anchor", { anchorResults: [first, first] }],
    ["unknown status", { anchorResults: [{ ...first, status: "ok" }, ...rest] }],
    ["empty observation", { anchorResults: [{ ...first, observed: "" }, ...rest] }],
    ["missing member", { anchorResults: undefined }],
    [
      "unknown handling",
      { outsideInstructions: [{ source: "user", summary: "x", handling: "ignored" }] },
    ],
    [
      "unknown source",
      { outsideInstructions: [{ source: "controller", summary: "x", handling: "followed" }] },
    ],
  ] as const) {
    throws(
      () => createImplementationTargetResultReport({ ...content, ...broken }),
      (error: unknown) => error instanceof ImplementationTargetResultReportError,
      label,
    );
  }
});

test("记录版本 1 原样读入（ADR-0030 决定 4）：1.4 之前写下的报告没有这两项，读作未记录；它的摘要仍是在原来的字节上算的", () => {
  const content = createImplementationTargetResultReportContentFixture();
  const {
    anchorResults: _anchorResults,
    outsideInstructions: _outside,
    ...legacyContent
  } = content;
  const basis = {
    kind: "WakeflowImplementationTargetResultReport",
    schemaVersion: 1,
    ...legacyContent,
    reportedAt: "2026-08-29T12:10:00.000Z",
  };
  const stored = { ...basis, reportDigest: computeCanonicalJsonSha256Digest(basis) };
  const legacy = parseImplementationTargetResultReport(stored);
  equal(legacy.schemaVersion, 1);
  equal(legacy.reportDigest, stored.reportDigest);
  equal(implementationReportAnchorResults(legacy), null);
  equal(implementationReportOutsideInstructions(legacy), null);
  equal(Object.hasOwn(legacy, "anchorResults"), false);
  // 读回再写出是同一份字节：升级不替旧报告补任何成员。
  equal(
    renderImplementationTargetResultReport(legacy),
    renderImplementationTargetResultReport(stored),
  );
  // 自称版本 1 却带着新成员、或自称版本 2 却缺了它们，都不是合法的记录。
  for (const broken of [
    { ...stored, anchorResults: [] },
    { ...stored, schemaVersion: 2 },
  ]) {
    throws(
      () => parseImplementationTargetResultReport(broken),
      (error: unknown) =>
        error instanceof ImplementationTargetResultReportError && error.reason === "schema",
    );
  }
});
