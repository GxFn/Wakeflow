export const TARGET_RESULT_CONTRACT_V1 = "target-result-envelope-v1";
export const TARGET_RESULT_CONTRACT_V2 = "target-result-envelope-v2";
export const COMMIT_DISPOSITIONS = ["committed", "left-uncommitted", "no-changes"];

function nonEmpty(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function resultVerification(result) {
  return array(result?.verificationSummary).length
    ? result.verificationSummary
    : array(result?.verification);
}

function issue(reason, fields = {}) {
  return { reason, ...fields };
}

function mappingContract({ packet, taskPackage }) {
  const explicit = packet?.resultContract;
  if (explicit === TARGET_RESULT_CONTRACT_V2) return TARGET_RESULT_CONTRACT_V2;
  return Number(taskPackage?.contextVersion ?? 0) === 1
    ? TARGET_RESULT_CONTRACT_V2
    : TARGET_RESULT_CONTRACT_V1;
}

function acceptanceMappingIssues(anchors, evidence, { completed }) {
  const expectedIds = anchors
    .map((anchor) => (nonEmpty(anchor?.id) ? anchor.id.trim() : ""))
    .filter(Boolean);
  const expected = new Set(expectedIds);
  const entries = evidence.filter((entry) => entry?.kind === "acceptance-anchor");
  const byId = new Map();
  const issues = [];

  for (const entry of entries) {
    const anchorId = nonEmpty(entry?.anchorId) ? entry.anchorId.trim() : "";
    if (!anchorId) {
      issues.push(issue("acceptance-anchor-id-missing"));
      continue;
    }
    if (!expected.has(anchorId)) {
      issues.push(issue("unknown-acceptance-anchor", { anchorId }));
      continue;
    }
    byId.set(anchorId, [...(byId.get(anchorId) ?? []), entry]);
    for (const field of ["red", "green", "ref"]) {
      if (!nonEmpty(entry?.[field])) {
        issues.push(issue(`acceptance-anchor-${field}-missing`, { anchorId }));
      }
    }
  }

  for (const anchorId of expectedIds) {
    const count = (byId.get(anchorId) ?? []).length;
    if (completed && count === 0) issues.push(issue("acceptance-anchor-missing", { anchorId }));
    if (count > 1) issues.push(issue("acceptance-anchor-duplicate", { anchorId, count }));
  }

  return {
    issues,
    mappedIds: expectedIds.filter((anchorId) => (byId.get(anchorId) ?? []).length === 1),
  };
}

function testStepMappingIssues(testExecution, evidence, { completed }) {
  const approvedPlan = array(testExecution?.approvedPlan);
  const entries = evidence.filter((entry) => entry?.kind === "test-step");
  const byIndex = new Map();
  const issues = [];

  for (const entry of entries) {
    const planIndex = entry?.planIndex;
    if (!Number.isInteger(planIndex)) {
      issues.push(issue("test-step-plan-index-invalid", { planIndex }));
      continue;
    }
    if (planIndex < 0 || planIndex >= approvedPlan.length) {
      issues.push(issue("unknown-test-step", { planIndex }));
      continue;
    }
    byIndex.set(planIndex, [...(byIndex.get(planIndex) ?? []), entry]);
    if (!nonEmpty(entry?.step)) {
      issues.push(issue("test-step-description-missing", { planIndex }));
    } else if (entry.step.trim() !== String(approvedPlan[planIndex]).trim()) {
      issues.push(issue("test-step-description-mismatch", {
        planIndex,
        expectedStep: approvedPlan[planIndex],
      }));
    }
    if (!nonEmpty(entry?.ref)) {
      issues.push(issue("test-step-ref-missing", { planIndex }));
    }
  }

  for (let planIndex = 0; planIndex < approvedPlan.length; planIndex += 1) {
    const count = (byIndex.get(planIndex) ?? []).length;
    if (completed && count === 0) issues.push(issue("test-step-missing", { planIndex }));
    if (count > 1) issues.push(issue("test-step-duplicate", { planIndex, count }));
  }

  return {
    issues,
    mappedPlanIndices: approvedPlan
      .map((_, planIndex) => planIndex)
      .filter((planIndex) => (byIndex.get(planIndex) ?? []).length === 1),
  };
}

function resultReviewInputPresent(result) {
  return array(result?.evidenceRefs).length > 0
    || resultVerification(result).length > 0
    || array(result?.commits).length > 0
    || array(result?.craftEvidence).length > 0;
}

function dispositionConsistencyIssues(result) {
  const disposition = result?.commitDisposition;
  const commits = array(result?.commits);
  const changedRepos = array(result?.changedRepos);
  const issues = [];
  if (!COMMIT_DISPOSITIONS.includes(disposition)) {
    issues.push(issue("commit-disposition-missing-or-invalid", {
      allowed: COMMIT_DISPOSITIONS,
    }));
    return issues;
  }
  if (disposition === "committed" && commits.length === 0) {
    issues.push(issue("committed-disposition-without-commit"));
  }
  if (disposition !== "committed" && commits.length > 0) {
    issues.push(issue("non-committed-disposition-with-commit", { disposition }));
  }
  if (disposition === "no-changes" && changedRepos.length > 0) {
    issues.push(issue("no-changes-disposition-with-changed-repository"));
  }
  return issues;
}

function commitExpectationIssues(taskPackage, result) {
  if (result?.status !== "completed") return [];
  const expectation = taskPackage?.commitExpectation;
  if (!expectation) return [];
  const disposition = result?.commitDisposition;
  if (expectation === "commit" && disposition !== "committed") {
    return [issue("commit-expectation-not-met", {
      expected: "commit",
      actual: disposition ?? null,
    })];
  }
  if (expectation === "leave-uncommitted" && disposition === "committed") {
    return [issue("commit-expectation-not-met", {
      expected: "leave-uncommitted",
      actual: disposition,
    })];
  }
  return [];
}

export function evaluateTargetResultContract({
  packet = null,
  taskPackage = null,
  result,
} = {}) {
  const contract = mappingContract({ packet, taskPackage });
  if (contract !== TARGET_RESULT_CONTRACT_V2) {
    return {
      contract,
      compatibility: "legacy",
      mapping: {
        contract,
        compatibility: "legacy",
        status: "legacy-unenforced",
      },
      recordIssues: [],
      reviewIssues: [],
    };
  }

  const completed = result?.status === "completed";
  const evidence = array(result?.craftEvidence);
  const recordIssues = [];
  if (!nonEmpty(result?.summary)) {
    recordIssues.push(issue(completed ? "completed-summary-missing" : "blocker-summary-missing"));
  }
  if (completed && !resultReviewInputPresent(result)) {
    recordIssues.push(issue("completed-review-input-missing"));
  }
  if (completed) {
    recordIssues.push(...dispositionConsistencyIssues(result));
  }

  const anchors = array(packet?.acceptanceAnchors).length
    ? packet.acceptanceAnchors
    : array(taskPackage?.acceptanceAnchors);
  const testExecution = packet?.testExecution ?? taskPackage?.testExecution ?? null;
  const acceptance = acceptanceMappingIssues(anchors, evidence, { completed });
  const testSteps = testStepMappingIssues(testExecution, evidence, { completed });

  if (completed) {
    recordIssues.push(...acceptance.issues, ...testSteps.issues);
  }

  const reviewIssues = commitExpectationIssues(taskPackage, result);
  return {
    contract,
    compatibility: "enforced",
    mapping: {
      contract,
      compatibility: "enforced",
      status: recordIssues.length === 0 ? (completed ? "complete" : "partial") : "invalid",
      acceptanceAnchorIds: acceptance.mappedIds,
      testPlanIndices: testSteps.mappedPlanIndices,
      ...(completed ? {} : { partialIssues: [...acceptance.issues, ...testSteps.issues] }),
    },
    recordIssues,
    reviewIssues,
  };
}

export function targetResultContractIssueMessage(issues) {
  return issues.map((entry) => {
    const detail = Object.entries(entry)
      .filter(([key]) => key !== "reason")
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(", ");
    return detail ? `${entry.reason} (${detail})` : entry.reason;
  }).join("; ");
}
