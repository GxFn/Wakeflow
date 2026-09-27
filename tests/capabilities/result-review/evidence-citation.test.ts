import { equal, rejects } from "node:assert/strict";
import { test } from "node:test";

import {
  collectEvidenceReferences,
  locateEvidenceReference,
} from "../../../src/capabilities/result-review/decide.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import {
  cleanupDeliveryWorkspaceFixture,
  createDeliveryWorkspaceFixture,
  deliverFixtureTarget,
} from "../../governance/delivery/delivery-workspace.fixture.js";
import {
  importFixtureImplementationResult,
  loadFixtureTaskPackage,
  recordFixtureEvidence,
  registerFixtureControllerWindow,
} from "../../governance/review/controller-implementation-review-decision-service.fixture.js";
import { createImplementationTargetResultReportContentFixture } from "../../governance/result/implementation-target-result-report.fixture.js";

/**
 * 结果导入拒绝解析不了的证据引用时点名是哪一条、属于哪一类（gate-log §13.134，收 §13.133 I8）：
 * 原因是原因类，路径指到报告里第一条出问题的引用，details 给出一共几条；错误形状仍是
 * code、reason、path。
 */

const OTHER_EVIDENCE_ID = "evidence_99999999-9999-4999-8999-999999999999";
const WRONG_DIGEST = `sha256:${"f".repeat(64)}`;

function refusedAt(reason: string, path: string, count = "1") {
  return (error: unknown) =>
    isWakeflowError(error) &&
    error.code === "precondition-failed" &&
    error.reason === reason &&
    error.path === path &&
    error.toPublicDetails().details?.unresolvedCitations === count;
}

test("证据引用解析失败按类点名第一条出问题的引用：定位符形态、未知证据、缺成员、摘要不符、种类不符", async () => {
  const fixture = await createDeliveryWorkspaceFixture();
  try {
    await registerFixtureControllerWindow(fixture);
    const delivered = await deliverFixtureTarget(fixture);
    const evidence = await recordFixtureEvidence(fixture);
    const taskPackage = await loadFixtureTaskPackage(
      fixture,
      delivered.envelope.target.taskPackageId,
    );
    const base = createImplementationTargetResultReportContentFixture(taskPackage, evidence);
    const [locator] = base.evidenceLocators;
    const [firstAnchor, ...otherAnchors] = base.anchorEvidence;
    if (locator === undefined || firstAnchor === undefined) {
      throw new Error("Expected one locator and one anchor citation.");
    }
    const good = { ref: evidence.ref, digest: evidence.digest };
    const withLocator = (patch: Readonly<Record<string, string>>) => ({
      ...base,
      evidenceLocators: [{ ...locator, ...patch }],
    });
    const withAnchorRef = (reference: Readonly<{ ref: string; digest: string }>) => ({
      ...base,
      anchorEvidence: [{ ...firstAnchor, evidenceRefs: [reference] }, ...otherAnchors],
    });
    const cases: readonly (readonly [string, unknown, (error: unknown) => boolean])[] = [
      [
        "digest",
        withLocator({ digest: WRONG_DIGEST }),
        refusedAt("evidence-digest-mismatch", "$request.report.content.evidenceLocators[0]"),
      ],
      [
        "locator form",
        withLocator({ ref: "reports/verification.txt" }),
        refusedAt("evidence-locator-invalid", "$request.report.content.evidenceLocators[0]"),
      ],
      [
        "unknown evidence",
        withAnchorRef({
          ...good,
          ref: `artifacts/managed-evidence/${OTHER_EVIDENCE_ID}/payload/content`,
        }),
        refusedAt("evidence-unknown", "$request.report.content.anchorEvidence[0].evidenceRefs[0]"),
      ],
      [
        "missing member",
        withAnchorRef({
          ...good,
          ref: `artifacts/managed-evidence/${evidence.evidenceId}/payload/verification.txt`,
        }),
        refusedAt(
          "evidence-member-missing",
          "$request.report.content.anchorEvidence[0].evidenceRefs[0]",
        ),
      ],
      [
        "kind",
        withLocator({ kind: "diff" }),
        refusedAt("evidence-kind-mismatch", "$request.report.content.evidenceLocators[0]"),
      ],
      [
        "two failures, the first named",
        {
          ...withLocator({ digest: WRONG_DIGEST }),
          anchorEvidence: [
            { ...firstAnchor, evidenceRefs: [{ ...good, ref: "reports/verification.txt" }] },
            ...otherAnchors,
          ],
        },
        refusedAt("evidence-digest-mismatch", "$request.report.content.evidenceLocators[0]", "2"),
      ],
    ];
    for (const [label, content, expected] of cases) {
      await rejects(
        importFixtureImplementationResult(fixture, delivered, {
          evidence,
          content,
          idempotencyKey: `fixture-import-citation-${label.replaceAll(/[^a-z]+/gu, "-")}`,
        }),
        expected,
        label,
      );
    }
    const imported = await importFixtureImplementationResult(fixture, delivered, { evidence });
    equal(imported.status, "committed");
  } finally {
    await cleanupDeliveryWorkspaceFixture(fixture);
  }
});

test("引用位置按收集顺序找第一次出现：定位符连种类一起比，锚点与步骤引用只比 ref 与摘要", () => {
  const a = { ref: "artifacts/managed-evidence/a/payload/content", digest: WRONG_DIGEST };
  const b = { ref: "artifacts/managed-evidence/b/payload/content", digest: WRONG_DIGEST };
  const c = { ref: "artifacts/managed-evidence/c/manifest.json", digest: WRONG_DIGEST };
  const report = {
    evidenceLocators: [
      { ...a, kind: "test-output" },
      { ...a, kind: "diff" },
    ],
    anchorEvidence: [{ evidenceRefs: [a] }, { evidenceRefs: [a, b] }],
    steps: [{ evidence: b }, { evidence: c }],
  };
  const located = collectEvidenceReferences(report).map((reference) => [
    reference.ref.split("/")[2],
    reference.kind,
    locateEvidenceReference(report, reference),
  ]);
  equal(
    JSON.stringify(located),
    JSON.stringify([
      ["a", "test-output", "$request.report.content.evidenceLocators[0]"],
      ["a", "diff", "$request.report.content.evidenceLocators[1]"],
      ["b", null, "$request.report.content.anchorEvidence[1].evidenceRefs[1]"],
      ["c", null, "$request.report.content.steps[1].evidence"],
    ]),
  );
  equal(
    locateEvidenceReference(report, { ref: "elsewhere", digest: WRONG_DIGEST, kind: null }),
    "$request.report.content",
  );
});
