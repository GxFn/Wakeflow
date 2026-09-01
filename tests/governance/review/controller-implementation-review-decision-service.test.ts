import { deepEqual, equal, rejects } from "node:assert/strict";
import { test } from "node:test";

import { readWakeflowConfigAuthoritySnapshot } from "../../../src/configuration/wakeflow-config-authority-snapshot.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  ControllerImplementationReviewDecisionService,
  ControllerImplementationReviewDecisionServiceError,
} from "../../../src/governance/review/controller-implementation-review-decision-service.js";
import { controllerImplementationReviewDecisionInput } from "./controller-implementation-review-decision.fixture.js";
import {
  cleanupControllerImplementationReviewDecisionServiceFixture,
  createControllerImplementationReviewDecisionServiceFixture,
  readControllerImplementationReviewDecisionServiceSnapshot,
} from "./controller-implementation-review-decision-service.fixture.js";

const DECIDED_AT = parseUtcInstant("2026-08-29T12:15:00.000Z");
const RETRY_AT = parseUtcInstant("2026-08-29T12:20:00.000Z");
const FIRST_UUID = "f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1";
const SECOND_UUID = "f2f2f2f2-f2f2-42f2-82f2-f2f2f2f2f2f2";
const THIRD_UUID = "f3f3f3f3-f3f3-43f3-83f3-f3f3f3f3f3f3";

test("Controller Decision首次提交并以原Decision身份精确幂等重试", async () => {
  const fixture =
    await createControllerImplementationReviewDecisionServiceFixture();
  try {
    const service = new ControllerImplementationReviewDecisionService(
      fixture.workspaceRoot,
    );
    const decided = await service.decide(fixture.decisionRequest, {
      clock: () => DECIDED_AT,
      uuidFactory: () => FIRST_UUID,
    });
    equal(decided.status, "decided");
    equal(decided.disposition, "committed");
    equal(decided.decision.decision, "accept");
    equal(
      decided.decision.reviewed.snapshotDigest,
      fixture.decisionRequest.snapshotDigest,
    );
    const config = await readWakeflowConfigAuthoritySnapshot(
      fixture.workspaceRoot,
    );
    equal(
      decided.decision.controllerWindowId,
      config.indexes.controllerWindow.windowId,
    );
    const after =
      await readControllerImplementationReviewDecisionServiceSnapshot(fixture);
    const target = after.targets[0];
    if (target?.status !== "review-decided") {
      throw new Error("Expected review-decided target.");
    }
    equal(target.phase, "accepted");

    const replayed = await service.decide(fixture.decisionRequest, {
      clock: () => RETRY_AT,
      uuidFactory: () => SECOND_UUID,
    });
    equal(replayed.status, "already-decided");
    equal(replayed.disposition, "idempotent");
    equal(
      replayed.decision.targetReviewDecisionId,
      decided.decision.targetReviewDecisionId,
    );
    equal(replayed.decision.decidedAt, DECIDED_AT);

    const rework = controllerImplementationReviewDecisionInput("rework");
    await rejects(
      service.decide(
        {
          ...fixture.decisionRequest,
          decision: rework.decision,
          assessment: rework.assessment,
          independentChecks: rework.independentChecks,
          rationale: rework.rationale,
          blockingReasons: rework.blockingReasons,
          residualRisks: rework.residualRisks,
        },
        {
          clock: () => RETRY_AT,
          uuidFactory: () => THIRD_UUID,
        },
      ),
      (error: unknown) =>
        error instanceof ControllerImplementationReviewDecisionServiceError &&
        error.reason === "state" &&
        error.eventAuthority === "current",
    );
    await rejects(
      service.decide({
        ...fixture.decisionRequest,
        snapshotDigest: `sha256:${"0".repeat(64)}`,
      }),
      (error: unknown) =>
        error instanceof ControllerImplementationReviewDecisionServiceError &&
        error.reason === "review-snapshot" &&
        error.eventAuthority === "current",
    );
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
  }
});

test("陈旧或非closed Decision请求在UUID和时钟读取前零写拒绝", async () => {
  const fixture =
    await createControllerImplementationReviewDecisionServiceFixture();
  let clockReads = 0;
  let uuidReads = 0;
  try {
    const service = new ControllerImplementationReviewDecisionService(
      fixture.workspaceRoot,
    );
    const before =
      await readControllerImplementationReviewDecisionServiceSnapshot(fixture);
    await rejects(
      service.decide(
        {
          ...fixture.decisionRequest,
          snapshotDigest: `sha256:${"0".repeat(64)}`,
        },
        {
          clock: () => {
            clockReads += 1;
            return DECIDED_AT;
          },
          uuidFactory: () => {
            uuidReads += 1;
            return FIRST_UUID;
          },
        },
      ),
      (error: unknown) =>
        error instanceof ControllerImplementationReviewDecisionServiceError &&
        error.reason === "review-snapshot",
    );
    await rejects(
      service.decide(
        {
          ...fixture.decisionRequest,
          targetTaskId: fixture.intent.target.targetTaskId,
        },
        {
          clock: () => {
            clockReads += 1;
            return DECIDED_AT;
          },
          uuidFactory: () => {
            uuidReads += 1;
            return FIRST_UUID;
          },
        },
      ),
      (error: unknown) =>
        error instanceof ControllerImplementationReviewDecisionServiceError &&
        error.reason === "input",
    );
    equal(clockReads, 0);
    equal(uuidReads, 0);
    deepEqual(
      await readControllerImplementationReviewDecisionServiceSnapshot(fixture),
      before,
    );
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
  }
});

test("并发相同Controller Decision收敛为一个Event和一个Decision身份", async () => {
  const fixture =
    await createControllerImplementationReviewDecisionServiceFixture();
  try {
    const first = new ControllerImplementationReviewDecisionService(
      fixture.workspaceRoot,
    );
    const second = new ControllerImplementationReviewDecisionService(
      fixture.workspaceRoot,
    );
    const results = await Promise.all([
      first.decide(fixture.decisionRequest, {
        clock: () => DECIDED_AT,
        uuidFactory: () => FIRST_UUID,
      }),
      second.decide(fixture.decisionRequest, {
        clock: () => DECIDED_AT,
        uuidFactory: () => SECOND_UUID,
      }),
    ]);
    deepEqual(results.map((result) => result.disposition).sort(), [
      "committed",
      "idempotent",
    ]);
    equal(
      results[0]?.decision.targetReviewDecisionId,
      results[1]?.decision.targetReviewDecisionId,
    );
    const snapshot =
      await readControllerImplementationReviewDecisionServiceSnapshot(fixture);
    equal(
      snapshot.eventStream.streamRevision,
      fixture.reviewSnapshot.eventStream.streamRevision + 1,
    );
    equal(snapshot.targets[0]?.status, "review-decided");
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
  }
});
