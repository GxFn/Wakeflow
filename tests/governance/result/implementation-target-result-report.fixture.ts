import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { createImplementationTargetResultReport } from "../../../src/governance/result/implementation-target-result-report.js";
import { createTaskPackageFixture } from "../tasking/task-package.fixture.js";
import type { TaskPackage } from "../../../src/governance/tasking/task-package.js";

export const TARGET_RESULT_REPORTED_AT = parseUtcInstant(
  "2026-08-29T09:55:00.000Z",
);
export const TARGET_RESULT_EVIDENCE_DIGEST = parseSha256Digest(
  `sha256:${"b".repeat(64)}`,
);

/** 纯记录测试用的定位符只查形状；导入切片解析真实受管证据时由调用方传入真实定位符。 */
export const TARGET_RESULT_EVIDENCE_REF = {
  ref: "artifacts/managed-evidence/evidence_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/payload/content",
  digest: TARGET_RESULT_EVIDENCE_DIGEST,
} as const;

export function createImplementationTargetResultReportContentFixture(
  taskPackage: Readonly<TaskPackage> = createTaskPackageFixture(),
  evidence: Readonly<{ readonly ref: string; readonly digest: string }> = TARGET_RESULT_EVIDENCE_REF,
) {
  if (taskPackage.workType !== "implementation") {
    throw new Error("Expected implementation TaskPackage fixture.");
  }
  const evidenceRef = { ref: evidence.ref, digest: evidence.digest } as const;
  return Object.freeze({
    outcome: "completed" as const,
    summary: "实现已完成，聚焦验证通过。",
    repositoryChange: Object.freeze({
      repositoryId: taskPackage.assignment.repositoryId,
      disposition: "left-uncommitted" as const,
      branch: null,
      commits: Object.freeze([]),
    }),
    evidenceLocators: Object.freeze([
      {
        kind: "test-output",
        ...evidenceRef,
      },
    ]),
    verification: Object.freeze(["node --test：通过" as const]),
    risks: Object.freeze([]),
    anchorEvidence: Object.freeze(
      taskPackage.acceptanceAnchors.map((anchor) =>
        Object.freeze({
          anchorId: anchor.anchorId,
          evidenceRefs: Object.freeze([evidenceRef]),
        }),
      ),
    ),
  });
}

export function createImplementationTargetResultReportFixture() {
  return createImplementationTargetResultReport(
    createImplementationTargetResultReportContentFixture(),
    { clock: () => TARGET_RESULT_REPORTED_AT },
  );
}
