import { equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  controllerTargetReviewResumeCommitId,
  controllerTargetReviewResumeEventId,
  parseControllerTargetReviewResume,
  parseControllerTargetReviewResumeDocument,
  renderControllerTargetReviewResume,
  ControllerTargetReviewResumeError,
} from "../../../src/governance/review/controller-target-review-resume.js";
import {
  CONTROLLER_REVIEW_RESUME_UUID,
  createControllerTargetReviewResumeFixture,
} from "./controller-target-review-resume.fixture.js";

test("Controller Target Review Resume绑定blocked Decision并派生稳定Event身份", () => {
  const resume = createControllerTargetReviewResumeFixture();
  equal(Object.isFrozen(resume), true);
  equal(Object.isFrozen(resume.blockedDecision), true);
  equal(Object.isFrozen(resume.blockedSource), true);
  equal(
    controllerTargetReviewResumeEventId(resume),
    `demand-event_${CONTROLLER_REVIEW_RESUME_UUID}`,
  );
  equal(
    controllerTargetReviewResumeCommitId(resume),
    `demand-event-commit_${CONTROLLER_REVIEW_RESUME_UUID}`,
  );
  const text = renderControllerTargetReviewResume(resume);
  equal(
    parseControllerTargetReviewResumeDocument(text).resumeDigest,
    resume.resumeDigest,
  );
});

test("Controller Target Review Resume拒绝非NFC文本、额外字段和摘要漂移", () => {
  const resume = createControllerTargetReviewResumeFixture();
  throws(
    () =>
      parseControllerTargetReviewResume({
        ...resume,
        resolutionSummary: "Cafe\u0301",
      }),
    (error: unknown) =>
      error instanceof ControllerTargetReviewResumeError &&
      error.reason === "text",
  );
  throws(
    () => parseControllerTargetReviewResume({ ...resume, extra: true }),
    (error: unknown) =>
      error instanceof ControllerTargetReviewResumeError &&
      error.reason === "schema",
  );
  throws(
    () =>
      parseControllerTargetReviewResume({
        ...resume,
        resumeDigest: `sha256:${"0".repeat(64)}`,
      }),
    (error: unknown) =>
      error instanceof ControllerTargetReviewResumeError &&
      error.reason === "digest",
  );
});
