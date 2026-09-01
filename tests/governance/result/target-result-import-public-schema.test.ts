import { equal } from "node:assert/strict";
import { test } from "node:test";

import {
  WAKEFLOW_TARGET_RESULT_IMPORT_REQUEST_SCHEMA,
  type WakeflowTargetResultImportRequestV1 as ImportRequestWire,
} from "../../../src/contracts/generated/entrypoints/wakeflow-target-result-import-request.generated.js";
import {
  WAKEFLOW_TARGET_RESULT_IMPORT_RESULT_SCHEMA,
  type WakeflowTargetResultImportResultV1 as ImportResultWire,
} from "../../../src/contracts/generated/entrypoints/wakeflow-target-result-import-result.generated.js";
import { createRuntimeJsonSchemaValidator } from "../../../src/foundation/schema/runtime-json-schema.js";
import { createTargetResultFixture } from "./target-result.fixture.js";

const validateRequest = createRuntimeJsonSchemaValidator<ImportRequestWire>(
  WAKEFLOW_TARGET_RESULT_IMPORT_REQUEST_SCHEMA,
);
const validateResult = createRuntimeJsonSchemaValidator<ImportResultWire>(
  WAKEFLOW_TARGET_RESULT_IMPORT_RESULT_SCHEMA,
);

const DIGEST = `sha256:${"0".repeat(64)}`;
const TEST_ATTEMPT_ID = "test-attempt_77777777-7777-4777-8777-777777777777";
const TEST_CARD_ID = "test-card_88888888-8888-4888-8888-888888888888";
const EVENT_ID = "demand-event_99999999-9999-4999-8999-999999999999";
const COMMIT_ID = "demand-event-commit_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function implementationReportContent() {
  const report = createTargetResultFixture().report;
  if (report.kind !== "WakeflowImplementationTargetResultReport") {
    throw new Error("Expected implementation Report fixture.");
  }
  return {
    outcome: report.outcome,
    summary: report.summary,
    repositoryChange: report.repositoryChange,
    evidenceLocators: report.evidenceLocators,
    verification: report.verification,
    risks: report.risks,
    anchorEvidence: report.anchorEvidence,
  } as const;
}

function implementationRequest() {
  const result = createTargetResultFixture();
  return {
    root: "/workspace",
    demandId: result.demandId,
    actionId: result.hostEffect.actionId,
    observationDigest: result.hostEffect.observationDigest,
    report: {
      workType: "implementation",
      content: implementationReportContent(),
    },
  } as const;
}

function testReportContent() {
  return {
    outcome: "completed",
    summary: "Test Agent完成全部批准步骤。",
    evidenceLocators: [
      {
        kind: "test-step-report",
        ref: "evidence/test-runs/step-0.json",
        digest: DIGEST,
      },
    ],
    verification: ["逐步复验完成。"],
    risks: ["仍需Controller独立审查。"],
    stepEvidence: [
      {
        planIndex: 0,
        step: "执行批准的真实场景步骤。",
        evidence: {
          ref: "evidence/test-runs/step-0.json",
          digest: DIGEST,
        },
      },
    ],
  } as const;
}

function testRequest() {
  const implementation = implementationRequest();
  return {
    ...implementation,
    report: {
      workType: "test",
      content: testReportContent(),
    },
  } as const;
}

function implementationResult() {
  const result = createTargetResultFixture();
  return {
    kind: "WakeflowTargetResultImportResult",
    schemaVersion: 1,
    tool: "wakeflow_import_target_result",
    status: "recorded",
    disposition: "committed",
    claimAuthority: "released",
    eventAuthority: "current",
    result,
    event: {
      eventId: EVENT_ID,
      streamRevision: 6,
    },
    commit: {
      commitId: COMMIT_ID,
      commitSequence: 6,
      commitDigest: DIGEST,
    },
    stateDigest: DIGEST,
  } as const;
}

function testResult() {
  const implementation = createTargetResultFixture();
  const content = testReportContent();
  return {
    ...implementationResult(),
    result: {
      ...implementation,
      workType: "test",
      assignment: {
        windowId: implementation.assignment.windowId,
      },
      report: {
        kind: "WakeflowTestTargetResultReport",
        schemaVersion: 1,
        ...content,
        reportedAt: implementation.report.reportedAt,
        reportDigest: DIGEST,
      },
      testExecution: {
        testAttemptId: TEST_ATTEMPT_ID,
        testCard: {
          testCardId: TEST_CARD_ID,
          testCardDigest: DIGEST,
        },
        testDispatchPacketDigest: DIGEST,
      },
      resultDigest: DIGEST,
    },
  } as const;
}

test("Result Import Request只接受Action、Observation与判别式Agent Report", () => {
  const implementation = implementationRequest();
  const testing = testRequest();
  equal(validateRequest(implementation).ok, true);
  equal(validateRequest(testing).ok, true);
  equal(
    validateRequest({
      ...implementation,
      targetTaskId: createTargetResultFixture().targetTaskId,
    }).ok,
    false,
  );
  equal(
    validateRequest({
      ...implementation,
      report: {
        workType: "test",
        content: implementation.report.content,
      },
    }).ok,
    false,
  );
  equal(
    validateRequest({
      ...testing,
      report: {
        ...testing.report,
        content: {
          ...testing.report.content,
          stepEvidence: [],
        },
      },
    }).ok,
    false,
  );
  equal(
    validateRequest({
      ...implementation,
      report: {
        ...implementation.report,
        content: {
          ...implementation.report.content,
          evidenceLocators: [
            {
              kind: "verification-report",
              ref: "/private/evidence.json",
              digest: DIGEST,
            },
          ],
        },
      },
    }).ok,
    false,
  );
});

test("Result Import Result关闭状态、workType、Report与Test execution关系", () => {
  const implementation = implementationResult();
  const testing = testResult();
  equal(validateResult(implementation).ok, true);
  equal(validateResult(testing).ok, true);
  equal(
    validateResult({
      ...implementation,
      status: "already-recorded",
      disposition: "idempotent",
    }).ok,
    true,
  );
  equal(
    validateResult({ ...implementation, disposition: "idempotent" }).ok,
    false,
  );
  equal(
    validateResult({
      ...implementation,
      result: {
        ...implementation.result,
        testExecution: testing.result.testExecution,
      },
    }).ok,
    false,
  );
  const { testExecution: _testExecution, ...testWithoutExecution } =
    testing.result;
  equal(validateResult({ ...testing, result: testWithoutExecution }).ok, false);
  equal(validateResult({ ...implementation, root: "/workspace" }).ok, false);
  equal(
    validateResult({ ...implementation, controllerAccepted: true }).ok,
    false,
  );
});
