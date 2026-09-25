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
  DemandEventSourcingDecisionError,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import type { DemandEventSourcingAggregate } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-aggregate.js";
import {
  applyDemandEventStreamCommit,
  prepareDemandEventStreamCommit,
  DemandEventStreamCommitError,
  type PreparedDemandEventStreamCommit,
} from "../../../src/governance/demand/event-sourcing/demand-event-stream-commit.js";
import { DemandFileEventStore } from "../../../src/governance/demand/event-sourcing/demand-file-event-store.js";
import {
  DemandAggregateStateError,
  decideTargetResultReviewInDemandAggregateState,
} from "../../../src/governance/demand/model/demand-aggregate-state.js";
import { readDemandResultReviewSnapshot } from "../../../src/governance/review/demand-result-review-snapshot.js";
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
const OUTCOME_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_08080808-0808-4808-8808-080808080808",
  "demand-event",
);
const OUTCOME_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_09090909-0909-4909-8909-090909090909",
  "demand-event-commit",
);
const RESULT_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a",
  "demand-event-commit",
);
const DECISION_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_07070707-0707-4707-8707-070707070707",
  "demand-event-commit",
);
const RESUMED_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b",
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
  const events = decideDemandEventSourcingCommand(current?.state ?? null, command);
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
    { commandType: "tasking.plan-target-task", commandVersion: 1, eventId: PLANNING_EVENT_ID, taskPackage },
    PLANNING_COMMIT_ID,
    preparedCommits,
  );
  const claim = createWorkClaimFixture();
  const envelope = createDeliveryEnvelopeFixture({
    claim,
    expectedStreamRevision: aggregate.streamRevision,
  });
  aggregate = appendCommand(
    aggregate,
    {
      commandType: "delivery.prepare-delivery",
      commandVersion: 1,
      eventId: DELIVERY_EVENT_ID,
      envelope,
      taskPackage,
    },
    DELIVERY_COMMIT_ID,
    preparedCommits,
  );
  const outcome = createDeliveryOutcomeFixture({ claim, envelope });
  aggregate = appendCommand(
    aggregate,
    { commandType: "delivery.record-delivery-outcome", commandVersion: 1, eventId: OUTCOME_EVENT_ID, outcome },
    OUTCOME_COMMIT_ID,
    preparedCommits,
  );
  const result = createTargetResultFixture({ claim, envelope, outcome });
  const callback = createTargetResultCallbackFixture(result);
  aggregate = appendCommand(
    aggregate,
    {
      commandType: "result.record-target-result",
      commandVersion: 1,
      result,
      callback,
      evidenceResolution: [],
    },
    RESULT_COMMIT_ID,
    preparedCommits,
  );
  equal(aggregate.streamRevision, 5);
  const reported = aggregate.state.targetTasks[0];
  equal(reported?.phase, "result-reported");
  if (reported?.phase !== "result-reported") throw new Error("Expected result-reported target.");
  equal(reported.currentDelivery.targetResult.callback.callbackId, callback.callbackId);

  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-controller-review-event-"));
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
          commitId: DECISION_COMMIT_ID,
          commandDigest: computeDemandEventSourcingCommandDigest(staleCommand),
          events: decideDemandEventSourcingCommand(aggregate.state, staleCommand),
        }),
      (error: unknown) =>
        error instanceof DemandEventStreamCommitError && error.reason === "relation",
    );
    const decision = createControllerImplementationReviewDecisionForSnapshot(reportedSnapshot);
    const command = Object.freeze({
      commandType: "review.decide-target-result" as const,
      commandVersion: 1 as const,
      decision,
    });
    const events = decideDemandEventSourcingCommand(aggregate.state, command);
    const prepared = prepareDemandEventStreamCommit(aggregate, {
      commitId: DECISION_COMMIT_ID,
      commandDigest: computeDemandEventSourcingCommandDigest(command),
      events,
    });
    equal(prepared.aggregate.streamRevision, 6);
    equal(prepared.aggregate.state.targetTasks[0]?.phase, "accepted");
    equal(prepared.commit.events[0]?.eventType, "review.target-result-decided");
    equal(prepared.commit.events[0]?.eventVersion, 1);
    deepEqual(applyDemandEventStreamCommit(aggregate, prepared.commit), prepared.aggregate);
    await store.append(prepared);
    const snapshot = await readDemandResultReviewSnapshot(root);
    const target = snapshot.targets[0];
    if (target?.status !== "review-decided") {
      throw new Error("Expected review-decided snapshot target.");
    }
    equal(target.phase, "accepted");
    equal(target.reviewDecision.decisionDigest, decision.decisionDigest);
    equal(target.reviewDecisionSourceEvent.streamRevision, prepared.aggregate.streamRevision);
  } finally {
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("escalate 决定在同一提交附带升级事件；blocked 之后带 resumption 的再决定回到同一结果", () => {
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
    { commandType: "tasking.plan-target-task", commandVersion: 1, eventId: PLANNING_EVENT_ID, taskPackage },
    PLANNING_COMMIT_ID,
  );
  const claim = createWorkClaimFixture();
  const envelope = createDeliveryEnvelopeFixture({ claim, expectedStreamRevision: aggregate.streamRevision });
  aggregate = appendCommand(
    aggregate,
    { commandType: "delivery.prepare-delivery", commandVersion: 1, eventId: DELIVERY_EVENT_ID, envelope, taskPackage },
    DELIVERY_COMMIT_ID,
  );
  const outcome = createDeliveryOutcomeFixture({ claim, envelope });
  aggregate = appendCommand(
    aggregate,
    { commandType: "delivery.record-delivery-outcome", commandVersion: 1, eventId: OUTCOME_EVENT_ID, outcome },
    OUTCOME_COMMIT_ID,
  );
  const result = createTargetResultFixture({ claim, envelope, outcome });
  aggregate = appendCommand(
    aggregate,
    {
      commandType: "result.record-target-result",
      commandVersion: 1,
      result,
      callback: createTargetResultCallbackFixture(result),
      evidenceResolution: [],
    },
    RESULT_COMMIT_ID,
  );

  const escalate = createControllerImplementationReviewDecisionForState(
    aggregate.stateDigest,
    "escalate",
    aggregate.streamRevision,
    result,
  );
  const escalatedEvents = decideDemandEventSourcingCommand(aggregate.state, {
    commandType: "review.decide-target-result",
    commandVersion: 1,
    decision: escalate,
  });
  equal(escalatedEvents.length, 2);
  equal(escalatedEvents[1]?.eventType, "lifecycle.demand-escalated");
  const escalatedCommit = prepareDemandEventStreamCommit(aggregate, {
    commitId: DECISION_COMMIT_ID,
    commandDigest: parseSha256Digest(`sha256:${"5".repeat(64)}`),
    events: escalatedEvents,
  });
  equal(escalatedCommit.aggregate.state.targetTasks[0]?.phase, "escalated");
  equal(escalatedCommit.aggregate.state.awaitingDecision?.escalationEventId, escalatedEvents[1]?.eventId);

  const blocked = createControllerImplementationReviewDecisionForState(
    aggregate.stateDigest,
    "blocked",
    aggregate.streamRevision,
    result,
  );
  const blockedCommit = prepareDemandEventStreamCommit(aggregate, {
    commitId: DECISION_COMMIT_ID,
    commandDigest: parseSha256Digest(`sha256:${"6".repeat(64)}`),
    events: decideDemandEventSourcingCommand(aggregate.state, {
      commandType: "review.decide-target-result",
      commandVersion: 1,
      decision: blocked,
    }),
  });
  equal(blockedCommit.aggregate.state.targetTasks[0]?.phase, "review-blocked");
  const resumed = createControllerImplementationReviewDecisionForState(
    blockedCommit.aggregate.stateDigest,
    "rework",
    blockedCommit.aggregate.streamRevision,
    result,
    {
      resumption: {
        previousDecisionId: blocked.targetReviewDecisionId,
        basis: { kind: "condition-cleared" },
        summary: "外部依赖已恢复，可以继续评审。",
      },
    },
  );
  const resumedEvents = decideDemandEventSourcingCommand(blockedCommit.aggregate.state, {
    commandType: "review.decide-target-result",
    commandVersion: 1,
    decision: resumed,
  });
  equal(resumedEvents.length, 1);
  const resumedCommit = prepareDemandEventStreamCommit(blockedCommit.aggregate, {
    commitId: RESUMED_COMMIT_ID,
    commandDigest: parseSha256Digest(`sha256:${"7".repeat(64)}`),
    events: resumedEvents,
  });
  equal(resumedCommit.aggregate.state.targetTasks[0]?.phase, "rework-requested");
  const withoutResumption = createControllerImplementationReviewDecisionForState(
    blockedCommit.aggregate.stateDigest,
    "rework",
    blockedCommit.aggregate.streamRevision,
    result,
    {},
    "eaeaeaea-eaea-4aea-8aea-eaeaeaeaeaea",
  );
  // 与已记录的 blocked 决定使用不同的 id，才能越过重复决定检查，真正命中 resumption 规则。
  throws(
    () => decideTargetResultReviewInDemandAggregateState(
      blockedCommit.aggregate.state,
      withoutResumption,
    ),
    (error: unknown) =>
      error instanceof DemandAggregateStateError
      && error.reason === "transition"
      && error.path === "$/targetTasks/resumption",
  );
  throws(
    () => decideDemandEventSourcingCommand(blockedCommit.aggregate.state, {
      commandType: "review.decide-target-result",
      commandVersion: 1,
      decision: withoutResumption,
    }),
    (error: unknown) =>
      error instanceof DemandEventSourcingDecisionError
      && error.reason === "transition",
  );
});
