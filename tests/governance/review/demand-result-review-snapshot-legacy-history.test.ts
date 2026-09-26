import { equal, rejects } from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest, type Sha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  computeDemandEventSourcingCommandDigest,
  decideDemandEventSourcingCommand,
  type DemandEventSourcingCommand,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import type { DemandEventSourcingAggregate } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-aggregate.js";
import {
  prepareDemandEventStreamCommit,
  type PreparedDemandEventStreamCommit,
} from "../../../src/governance/demand/event-sourcing/demand-event-stream-commit.js";
import { DemandFileEventStore } from "../../../src/governance/demand/event-sourcing/demand-file-event-store.js";
import {
  computeReportedReviewUnitDigest,
  DemandResultReviewSnapshotError,
  readDemandResultReviewSnapshot,
  type DemandResultReviewDecidedTarget,
} from "../../../src/governance/review/demand-result-review-snapshot.js";
import {
  createDeliveryEnvelopeFixture,
  createDeliveryOutcomeFixture,
  createWorkClaimFixture,
} from "../delivery/delivery-records.fixture.js";
import {
  createTargetResultCallbackFixture,
  createTargetResultFixture,
} from "../result/target-result.fixture.js";
import {
  createTaskPackageFixture,
  TASKING_AUTHORITY_DIGEST,
  TASKING_DEMAND_ID,
} from "../tasking/task-package.fixture.js";
import {
  createControllerImplementationReviewDecisionForSnapshot,
  createControllerImplementationReviewDecisionForState,
} from "./controller-implementation-review-decision.fixture.js";

function eventId(digit: string) {
  return parseWakeflowDurableIdOfKind(
    `demand-event_${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`,
    "demand-event",
  );
}

function commitId(digit: string) {
  return parseWakeflowDurableIdOfKind(
    `demand-event-commit_${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`,
    "demand-event-commit",
  );
}

function append(
  current: Readonly<DemandEventSourcingAggregate> | null,
  command: Readonly<DemandEventSourcingCommand>,
  digit: string,
  commits: PreparedDemandEventStreamCommit[],
): Readonly<DemandEventSourcingAggregate> {
  const prepared = prepareDemandEventStreamCommit(current, {
    commitId: commitId(digit),
    commandDigest: computeDemandEventSourcingCommandDigest(command),
    events: decideDemandEventSourcingCommand(current?.state ?? null, command),
  });
  commits.push(prepared);
  return prepared.aggregate;
}

/** 一个目标：结果回报后先记 blocked，再以 resumption 记 accept；accept 的评审单元摘要由调用方给出。 */
async function readAfterResumedAccept(
  reviewUnitDigestFor: (blocked: Readonly<DemandResultReviewDecidedTarget>) => Sha256Digest,
) {
  const commits: PreparedDemandEventStreamCommit[] = [];
  let aggregate = append(null, {
    commandType: "publication.publish-demand",
    commandVersion: 1,
    demandId: TASKING_DEMAND_ID,
    eventId: eventId("1"),
    recordedAt: parseUtcInstant("2026-08-29T09:00:00.000Z"),
    identityDigest: parseSha256Digest(`sha256:${"9".repeat(64)}`),
    authorityDigest: TASKING_AUTHORITY_DIGEST,
  }, "2", commits);
  const taskPackage = createTaskPackageFixture();
  aggregate = append(aggregate, { commandType: "tasking.plan-target-task", commandVersion: 1, eventId: eventId("3"), taskPackage }, "4", commits);
  const claim = createWorkClaimFixture();
  const envelope = createDeliveryEnvelopeFixture({ claim, expectedStreamRevision: aggregate.streamRevision });
  aggregate = append(aggregate, { commandType: "delivery.prepare-delivery", commandVersion: 1, eventId: eventId("5"), envelope, taskPackage }, "6", commits);
  const outcome = createDeliveryOutcomeFixture({ claim, envelope });
  aggregate = append(aggregate, { commandType: "delivery.record-delivery-outcome", commandVersion: 1, eventId: eventId("7"), outcome }, "8", commits);
  const result = createTargetResultFixture({ claim, envelope, outcome });
  aggregate = append(aggregate, {
    commandType: "result.record-target-result",
    commandVersion: 1,
    result,
    callback: createTargetResultCallbackFixture(result),
    evidenceResolution: [],
  }, "a", commits);

  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-legacy-review-history-"));
  const root = await RootedDirectory.open(fixtureRoot);
  try {
    const store = new DemandFileEventStore(root);
    await store.initialize();
    for (const commit of commits) await store.append(commit);
    const blocked = createControllerImplementationReviewDecisionForSnapshot(
      await readDemandResultReviewSnapshot(root),
      "blocked",
    );
    const blockedCommits: PreparedDemandEventStreamCommit[] = [];
    aggregate = append(aggregate, { commandType: "review.decide-target-result", commandVersion: 1, decision: blocked }, "b", blockedCommits);
    for (const commit of blockedCommits) await store.append(commit);
    const blockedTarget = (await readDemandResultReviewSnapshot(root)).targets[0];
    if (blockedTarget?.status !== "review-decided") throw new Error("Expected the blocked decision.");
    const accept = createControllerImplementationReviewDecisionForState(
      aggregate.stateDigest,
      "accept",
      aggregate.streamRevision,
      result,
      {
        reviewed: Object.freeze({
          ...blocked.reviewed,
          snapshotDigest: parseSha256Digest(`sha256:${"c".repeat(64)}`),
          reviewUnitDigest: reviewUnitDigestFor(blockedTarget),
          stateDigest: aggregate.stateDigest,
          streamRevision: aggregate.streamRevision,
        }),
        resumption: {
          previousDecisionId: blocked.targetReviewDecisionId,
          basis: { kind: "condition-cleared" },
          summary: "外部依赖已恢复，可以继续评审。",
        },
      },
    );
    const resumedCommits: PreparedDemandEventStreamCommit[] = [];
    append(aggregate, { commandType: "review.decide-target-result", commandVersion: 1, decision: accept }, "d", resumedCommits);
    for (const commit of resumedCommits) await store.append(commit);
    return await readDemandResultReviewSnapshot(root);
  } finally {
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

/** D7 之前的评审单元基底：历史里的实现决定没有 anchorEvidence 键（当时的决定没有这个字段）。 */
function preAnchorEvidenceReviewUnitDigest(target: Readonly<DemandResultReviewDecidedTarget>): Sha256Digest {
  const { anchorEvidence: _absentBeforeD7, ...legacyDecision } = target.reviewDecision as Readonly<
    Record<string, unknown>
  >;
  return computeCanonicalJsonSha256Digest({
    status: "reported",
    targetTaskId: target.targetTaskId,
    outcome: target.outcome,
    taskPackageSourceEvent: target.taskPackageSourceEvent,
    taskPackage: target.taskPackage,
    targetResultSourceEvent: target.targetResultSourceEvent,
    targetResult: target.targetResult,
    priorReviewHistory: [{ sourceEvent: target.reviewDecisionSourceEvent, decision: legacyDecision }],
  });
}

function currentReviewUnitDigest(target: Readonly<DemandResultReviewDecidedTarget>): Sha256Digest {
  return computeReportedReviewUnitDigest(
    target.targetTaskId,
    target.taskPackageSourceEvent,
    target.taskPackage,
    target.targetResultSourceEvent,
    target.targetResult,
    [{ sourceEvent: target.reviewDecisionSourceEvent, decision: target.reviewDecision }],
  );
}

test("D7 之前记录的已决单元：历史决定没有 anchorEvidence 键时评审单元摘要仍能复现", async () => {
  let legacy: Sha256Digest | null = null;
  let current: Sha256Digest | null = null;
  const snapshot = await readAfterResumedAccept((blocked) => {
    equal(blocked.reviewDecision.kind, "WakeflowControllerImplementationReviewDecision");
    legacy = preAnchorEvidenceReviewUnitDigest(blocked);
    current = currentReviewUnitDigest(blocked);
    return legacy;
  });
  const target = snapshot.targets[0];
  if (target?.status !== "review-decided") throw new Error("Expected the accepted decision.");
  equal(target.phase, "accepted");
  equal(legacy === current, false);
  equal(target.reviewUnitDigest, legacy);
  equal(target.priorReviewHistory.length, 1);
});

test("D7 之后记录的已决单元：显式 null 的 anchorEvidence 按当前形状复现", async () => {
  let current: Sha256Digest | null = null;
  const snapshot = await readAfterResumedAccept((blocked) => {
    current = currentReviewUnitDigest(blocked);
    return current;
  });
  const target = snapshot.targets[0];
  if (target?.status !== "review-decided") throw new Error("Expected the accepted decision.");
  equal(target.phase, "accepted");
  equal(target.reviewUnitDigest, current);
});

test("两种形状都不复现的评审单元摘要仍是 relation", async () => {
  await rejects(
    readAfterResumedAccept(() => parseSha256Digest(`sha256:${"e".repeat(64)}`)),
    (error: unknown) => error instanceof DemandResultReviewSnapshotError && error.reason === "relation",
  );
});
