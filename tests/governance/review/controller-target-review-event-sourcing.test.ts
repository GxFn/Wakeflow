import { deepEqual, equal, throws } from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableId,
} from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  computeDemandEventSourcingCommandDigest,
  decideDemandEventSourcingCommand,
  type DemandEventSourcingCommand,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import type { DemandEventSourcingAggregate } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-aggregate.js";
import {
  applyDemandEventStreamCommit,
  prepareDemandEventStreamCommit,
  DemandEventStreamCommitError,
  type PreparedDemandEventStreamCommit,
} from "../../../src/governance/demand/event-sourcing/demand-event-stream-commit.js";
import { DemandFileEventStore } from "../../../src/governance/demand/event-sourcing/demand-file-event-store.js";
import { targetDeliveryHostEffectObservationCommitId } from "../../../src/governance/delivery/target-delivery-host-effect-observation.js";
import { targetResultRecordedCommitIdFromResult } from "../../../src/governance/result/target-result.js";
import { controllerImplementationReviewDecisionCommitId } from "../../../src/governance/review/controller-implementation-review-decision.js";
import { readDemandResultReviewSnapshot } from "../../../src/governance/review/demand-result-review-snapshot.js";
import { createTargetDeliveryHostEffectObservationFixture } from "../delivery/target-delivery-host-effect-observation.fixture.js";
import { createTargetDeliveryIntentFixture } from "../delivery/target-delivery-intent.fixture.js";
import { createWindowWorkClaimFixture } from "../delivery/window-work-claim.fixture.js";
import { createTargetResultFixture } from "../result/target-result.fixture.js";
import {
  createTaskPackageFixture,
  TASKING_AUTHORITY_DIGEST,
  TASKING_DEMAND_ID,
} from "../tasking/task-package.fixture.js";
import {
  createControllerImplementationReviewDecisionForState,
  createControllerImplementationReviewDecisionForSnapshot,
} from "./controller-implementation-review-decision.fixture.js";

const PUBLICATION_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_01010101-0101-4101-8101-010101010101",
  "demand-event",
);
const PUBLICATION_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_02020202-0202-4202-8202-020202020202",
  "demand-event-commit",
);
const PLANNING_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_03030303-0303-4303-8303-030303030303",
  "demand-event",
);
const PLANNING_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_04040404-0404-4404-8404-040404040404",
  "demand-event-commit",
);
const DELIVERY_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_05050505-0505-4505-8505-050505050505",
  "demand-event",
);
const DELIVERY_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_06060606-0606-4606-8606-060606060606",
  "demand-event-commit",
);
const WRONG_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_07070707-0707-4707-8707-070707070707",
  "demand-event-commit",
);
const PUBLICATION_AT = parseUtcInstant("2026-08-29T09:00:00.000Z");
const IDENTITY_DIGEST = parseSha256Digest(`sha256:${"9".repeat(64)}`);

function appendCommand(
  current: Readonly<DemandEventSourcingAggregate> | null,
  command: Readonly<DemandEventSourcingCommand>,
  commitId: WakeflowDurableId<"demand-event-commit">,
  preparedCommits?: PreparedDemandEventStreamCommit[],
): Readonly<DemandEventSourcingAggregate> {
  const events = decideDemandEventSourcingCommand(
    current?.state ?? null,
    command,
  );
  const prepared = prepareDemandEventStreamCommit(current, {
    commitId,
    commandDigest: computeDemandEventSourcingCommandDigest(command),
    events,
  });
  preparedCommits?.push(prepared);
  return prepared.aggregate;
}

test("Controller Review Event使用精确Snapshot revision提交并可完整重放", async () => {
  const preparedCommits: PreparedDemandEventStreamCommit[] = [];
  let aggregate = appendCommand(
    null,
    {
      commandType: "publication.publish-demand",
      commandVersion: 1,
      demandId: TASKING_DEMAND_ID,
      eventId: PUBLICATION_EVENT_ID,
      recordedAt: PUBLICATION_AT,
      identityDigest: IDENTITY_DIGEST,
      authorityDigest: TASKING_AUTHORITY_DIGEST,
    },
    PUBLICATION_COMMIT_ID,
    preparedCommits,
  );

  const taskPackage = createTaskPackageFixture();
  aggregate = appendCommand(
    aggregate,
    {
      commandType: "tasking.plan-target-task",
      commandVersion: 1,
      eventId: PLANNING_EVENT_ID,
      taskPackage,
    },
    PLANNING_COMMIT_ID,
    preparedCommits,
  );
  const intent = createTargetDeliveryIntentFixture();
  aggregate = appendCommand(
    aggregate,
    {
      commandType: "delivery.prepare-target-delivery",
      commandVersion: 1,
      eventId: DELIVERY_EVENT_ID,
      intent,
      taskPackage,
    },
    DELIVERY_COMMIT_ID,
    preparedCommits,
  );
  const claim = createWindowWorkClaimFixture(undefined, aggregate.stateDigest);
  aggregate = appendCommand(
    aggregate,
    {
      commandType: "delivery.claim-target-host-effect",
      commandVersion: 1,
      claim,
    },
    claim.claimTransition.commitId,
    preparedCommits,
  );
  const observation = createTargetDeliveryHostEffectObservationFixture({
    claim,
  });
  aggregate = appendCommand(
    aggregate,
    {
      commandType: "delivery.record-target-host-effect-observation",
      commandVersion: 1,
      observation,
    },
    targetDeliveryHostEffectObservationCommitId(claim.claimId),
    preparedCommits,
  );
  const result = createTargetResultFixture({ claim, observation });
  aggregate = appendCommand(
    aggregate,
    {
      commandType: "result.record-target-result",
      commandVersion: 1,
      result,
    },
    targetResultRecordedCommitIdFromResult(result),
    preparedCommits,
  );
  equal(aggregate.streamRevision, 6);
  equal(aggregate.state.targetTasks[0]?.phase, "result-reported");

  const fixtureRoot = mkdtempSync(
    path.join(os.tmpdir(), "wakeflow-controller-review-event-"),
  );
  const root = await RootedDirectory.open(fixtureRoot);
  try {
    const store = new DemandFileEventStore(root);
    await store.initialize();
    for (const candidate of preparedCommits) await store.append(candidate);
    const reportedSnapshot = await readDemandResultReviewSnapshot(root);
    const staleDecision = createControllerImplementationReviewDecisionForState(
      aggregate.stateDigest,
      "accept",
      aggregate.streamRevision - 1,
      result,
    );
    const staleCommand = Object.freeze({
      commandType: "review.decide-target-result" as const,
      commandVersion: 1 as const,
      decision: staleDecision,
    });
    throws(
      () =>
        prepareDemandEventStreamCommit(aggregate, {
          commitId:
            controllerImplementationReviewDecisionCommitId(staleDecision),
          commandDigest: computeDemandEventSourcingCommandDigest(staleCommand),
          events: decideDemandEventSourcingCommand(
            aggregate.state,
            staleCommand,
          ),
        }),
      (error: unknown) =>
        error instanceof DemandEventStreamCommitError &&
        error.reason === "relation",
    );
    const decision =
      createControllerImplementationReviewDecisionForSnapshot(reportedSnapshot);
    const command = Object.freeze({
      commandType: "review.decide-target-result" as const,
      commandVersion: 1 as const,
      decision,
    });
    const events = decideDemandEventSourcingCommand(aggregate.state, command);
    throws(
      () =>
        prepareDemandEventStreamCommit(aggregate, {
          commitId: WRONG_COMMIT_ID,
          commandDigest: computeDemandEventSourcingCommandDigest(command),
          events,
        }),
      (error: unknown) =>
        error instanceof DemandEventStreamCommitError &&
        error.reason === "relation",
    );
    const prepared = prepareDemandEventStreamCommit(aggregate, {
      commitId: controllerImplementationReviewDecisionCommitId(decision),
      commandDigest: computeDemandEventSourcingCommandDigest(command),
      events,
    });
    equal(prepared.aggregate.streamRevision, 7);
    equal(prepared.aggregate.state.targetTasks[0]?.phase, "accepted");
    equal(prepared.commit.events[0]?.eventType, "review.target-result-decided");
    equal(prepared.commit.events[0]?.eventVersion, 1);
    deepEqual(
      applyDemandEventStreamCommit(aggregate, prepared.commit),
      prepared.aggregate,
    );
    await store.append(prepared);
    const snapshot = await readDemandResultReviewSnapshot(root);
    const target = snapshot.targets[0];
    if (target?.status !== "review-decided") {
      throw new Error("Expected review-decided snapshot target.");
    }
    equal(target.phase, "accepted");
    equal(target.reviewDecision.decisionDigest, decision.decisionDigest);
    equal(
      target.reviewDecisionSourceEvent.streamRevision,
      prepared.aggregate.streamRevision,
    );
  } finally {
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
