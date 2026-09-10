import { equal, rejects } from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  executeDemandEventSourcingCommand,
  DemandEventSourcingCommandHandlerError,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { DemandFileEventStore } from "../../../src/governance/demand/event-sourcing/demand-file-event-store.js";
import {
  createTaskPackageFixture,
  TASKING_AUTHORITY_DIGEST,
  TASKING_DEMAND_ID,
} from "../tasking/task-package.fixture.js";
import {
  createDeliveryEnvelopeFixture,
  createDeliveryOutcomeFixture,
  createDeliveryRearmFixture,
  createWorkClaimFixture,
} from "../delivery/delivery-records.fixture.js";

const DEMAND_ID = TASKING_DEMAND_ID;
const EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_22222222-2222-4222-8222-222222222222",
  "demand-event",
);
const OTHER_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_55555555-5555-4555-8555-555555555555",
  "demand-event",
);
const COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_33333333-3333-4333-8333-333333333333",
  "demand-event-commit",
);
const OTHER_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_44444444-4444-4444-8444-444444444444",
  "demand-event-commit",
);
const PLAN_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_66666666-6666-4666-8666-666666666666",
  "demand-event",
);
const PLAN_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_77777777-7777-4777-8777-777777777777",
  "demand-event-commit",
);
const DELIVERY_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_88888888-8888-4888-8888-888888888888",
  "demand-event",
);
const DELIVERY_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_99999999-9999-4999-8999-999999999999",
  "demand-event-commit",
);
const OUTCOME_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  "demand-event",
);
const OUTCOME_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  "demand-event-commit",
);
const REARM_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3",
  "demand-event",
);
const REARM_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_a4a4a4a4-a4a4-4a4a-8a4a-a4a4a4a4a4a4",
  "demand-event-commit",
);
const RECORDED_AT = parseUtcInstant("2026-08-26T10:00:00.000Z");
const CANCELLED_AT = parseUtcInstant("2026-08-26T11:00:00.000Z");
const IDENTITY_DIGEST = parseSha256Digest(`sha256:${"a".repeat(64)}`);
const AUTHORITY_DIGEST = TASKING_AUTHORITY_DIGEST;

const COMMAND = Object.freeze({
  commandType: "publication.publish-demand" as const,
  commandVersion: 1 as const,
  demandId: DEMAND_ID,
  eventId: EVENT_ID,
  recordedAt: RECORDED_AT,
  identityDigest: IDENTITY_DIGEST,
  authorityDigest: AUTHORITY_DIGEST,
});

function cancellationCommand(eventId = OTHER_EVENT_ID) {
  return Object.freeze({
    commandType: "lifecycle.cancel-demand" as const,
    commandVersion: 1 as const,
    demandId: DEMAND_ID,
    eventId,
    recordedAt: CANCELLED_AT,
    reason: "用户终止该 Demand",
  });
}

test("Demand Event Sourcing Command Handler 执行 load-decide-append 并按 commitId 幂等", async () => {
  const fixtureRoot = mkdtempSync(
    path.join(os.tmpdir(), "wakeflow-demand-command-handler-"),
  );
  const root = await RootedDirectory.open(fixtureRoot);
  try {
    const eventStore = new DemandFileEventStore(root);
    const repository = new DemandEventSourcingRepository(root);
    await eventStore.initialize();

    await rejects(
      executeDemandEventSourcingCommand(repository, COMMAND, {
        commitId: COMMIT_ID,
      } as never),
      (error: unknown) =>
        error instanceof DemandEventSourcingCommandHandlerError &&
        error.reason === "input",
    );

    const committed = await executeDemandEventSourcingCommand(
      repository,
      COMMAND,
      { commitId: COMMIT_ID, expectedStreamRevision: 0 },
    );
    equal(committed.disposition, "committed");
    equal(committed.aggregate.streamRevision, 1);
    equal(committed.aggregate.state.lifecycle, "active");
    await repository.publishSnapshot(committed.aggregate);
    equal((await repository.load())?.snapshotStatus, "used");

    const retried = await executeDemandEventSourcingCommand(
      repository,
      COMMAND,
      { commitId: COMMIT_ID, expectedStreamRevision: 0 },
    );
    equal(retried.disposition, "idempotent");
    equal(retried.commit.commitId, COMMIT_ID);
    equal((await eventStore.readCommits()).commits.length, 1);

    await rejects(
      executeDemandEventSourcingCommand(repository, COMMAND, {
        commitId: OTHER_COMMIT_ID,
        expectedStreamRevision: 0,
      }),
      (error: unknown) =>
        error instanceof DemandEventSourcingCommandHandlerError &&
        error.reason === "concurrency-conflict",
    );

    await rejects(
      executeDemandEventSourcingCommand(repository, cancellationCommand(), {
        commitId: COMMIT_ID,
        expectedStreamRevision: 1,
      }),
      (error: unknown) =>
        error instanceof DemandEventSourcingCommandHandlerError &&
        error.reason === "idempotency-conflict",
    );
    await rejects(
      executeDemandEventSourcingCommand(
        repository,
        cancellationCommand(EVENT_ID),
        { commitId: OTHER_COMMIT_ID, expectedStreamRevision: 1 },
      ),
      (error: unknown) =>
        error instanceof DemandEventSourcingCommandHandlerError &&
        error.reason === "idempotency-conflict",
    );
    equal((await eventStore.readCommits()).commits.length, 1);

    const taskPackage = createTaskPackageFixture();
    const planCommand = Object.freeze({
      commandType: "tasking.plan-target-task",
      commandVersion: 1 as const,
      eventId: PLAN_EVENT_ID,
      taskPackage,
    });
    const planned = await executeDemandEventSourcingCommand(
      repository,
      planCommand,
      {
        commitId: PLAN_COMMIT_ID,
        expectedStreamRevision: 1,
      },
    );
    equal(planned.disposition, "committed");
    equal(planned.aggregate.streamRevision, 2);
    equal(planned.aggregate.lastEvent.eventType, "tasking.target-task-planned");
    equal(planned.aggregate.state.targetTasks.length, 1);
    equal((await repository.audit()).aggregate.state.targetTasks.length, 1);

    const retriedPlan = await executeDemandEventSourcingCommand(
      repository,
      planCommand,
      { commitId: PLAN_COMMIT_ID, expectedStreamRevision: 1 },
    );
    equal(retriedPlan.disposition, "idempotent");
    equal(retriedPlan.aggregate.streamRevision, 2);
    equal((await eventStore.readCommits()).commits.length, 2);

    const claim = createWorkClaimFixture();
    const envelope = createDeliveryEnvelopeFixture({ claim });
    const deliveryCommand = Object.freeze({
      commandType: "delivery.prepare-delivery" as const,
      commandVersion: 1 as const,
      eventId: DELIVERY_EVENT_ID,
      envelope,
      taskPackage,
    });
    const prepared = await executeDemandEventSourcingCommand(
      repository,
      deliveryCommand,
      { commitId: DELIVERY_COMMIT_ID, expectedStreamRevision: 2 },
    );
    equal(prepared.disposition, "committed");
    equal(prepared.aggregate.streamRevision, 3);
    equal(prepared.aggregate.lastEvent.eventType, "delivery.delivery-prepared");
    equal(prepared.aggregate.state.targetTasks[0]?.phase, "delivery-prepared");
    equal(
      (await repository.audit()).aggregate.state.targetTasks[0]?.phase,
      "delivery-prepared",
    );
    const retriedDelivery = await executeDemandEventSourcingCommand(
      repository,
      deliveryCommand,
      { commitId: DELIVERY_COMMIT_ID, expectedStreamRevision: 2 },
    );
    equal(retriedDelivery.disposition, "idempotent");
    equal(retriedDelivery.aggregate.streamRevision, 3);
    equal((await eventStore.readCommits()).commits.length, 3);

    const outcome = createDeliveryOutcomeFixture({
      claim,
      envelope,
      disposition: "rejected-before-send",
      readbackStatus: "unavailable",
    });
    const outcomeCommand = Object.freeze({
      commandType: "delivery.record-delivery-outcome" as const,
      commandVersion: 1 as const,
      eventId: OUTCOME_EVENT_ID,
      outcome,
    });
    // 复用另一条命令的 commitId：同 id 不同命令按幂等冲突拒绝，不写入。
    await rejects(
      executeDemandEventSourcingCommand(repository, outcomeCommand, {
        commitId: DELIVERY_COMMIT_ID,
        expectedStreamRevision: 3,
      }),
      (error: unknown) =>
        error instanceof DemandEventSourcingCommandHandlerError &&
        error.reason === "idempotency-conflict",
    );
    equal((await eventStore.readCommits()).commits.length, 3);
    const observed = await executeDemandEventSourcingCommand(
      repository,
      outcomeCommand,
      { commitId: OUTCOME_COMMIT_ID, expectedStreamRevision: 3 },
    );
    equal(observed.disposition, "committed");
    equal(observed.aggregate.streamRevision, 4);
    equal(
      observed.aggregate.lastEvent.eventType,
      "delivery.delivery-outcome-recorded",
    );
    equal(observed.aggregate.state.targetTasks[0]?.phase, "host-effect-rejected");
    const retriedObservation = await executeDemandEventSourcingCommand(
      repository,
      outcomeCommand,
      { commitId: OUTCOME_COMMIT_ID, expectedStreamRevision: 3 },
    );
    equal(retriedObservation.disposition, "idempotent");
    equal(retriedObservation.aggregate.streamRevision, 4);
    equal((await eventStore.readCommits()).commits.length, 4);

    // 围栏期望修订与提交边界不一致的 rearm 在决策边界被拒。
    await rejects(
      executeDemandEventSourcingCommand(
        repository,
        {
          commandType: "delivery.rearm-delivery",
          commandVersion: 1,
          eventId: REARM_EVENT_ID,
          rearm: createDeliveryRearmFixture(envelope, outcome, {
            expectedStreamRevision: 3,
          }),
        },
        { commitId: REARM_COMMIT_ID, expectedStreamRevision: 4 },
      ),
      (error: unknown) =>
        error instanceof DemandEventSourcingCommandHandlerError &&
        error.reason === "decision-rejected",
    );
    equal((await eventStore.readCommits()).commits.length, 4);
    const rearm = createDeliveryRearmFixture(envelope, outcome, {
      expectedStreamRevision: 4,
    });
    const rearmCommand = Object.freeze({
      commandType: "delivery.rearm-delivery" as const,
      commandVersion: 1 as const,
      eventId: REARM_EVENT_ID,
      rearm,
    });
    const rearmed = await executeDemandEventSourcingCommand(
      repository,
      rearmCommand,
      { commitId: REARM_COMMIT_ID, expectedStreamRevision: 4 },
    );
    equal(rearmed.disposition, "committed");
    equal(rearmed.aggregate.streamRevision, 5);
    equal(rearmed.aggregate.lastEvent.eventType, "delivery.delivery-rearmed");
    equal(rearmed.aggregate.state.targetTasks[0]?.phase, "delivery-prepared");
    const rearmedTarget = rearmed.aggregate.state.targetTasks[0];
    if (rearmedTarget?.phase !== "delivery-prepared") {
      throw new Error("Expected rearmed delivery-prepared target.");
    }
    equal(rearmedTarget.currentDelivery.generation, 2);
    const retriedRearm = await executeDemandEventSourcingCommand(
      repository,
      rearmCommand,
      { commitId: REARM_COMMIT_ID, expectedStreamRevision: 4 },
    );
    equal(retriedRearm.disposition, "idempotent");
    equal(retriedRearm.aggregate.streamRevision, 5);
    equal((await eventStore.readCommits()).commits.length, 5);
  } finally {
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
