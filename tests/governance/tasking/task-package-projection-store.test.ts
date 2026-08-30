import {
  deepEqual,
  equal,
  rejects,
} from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  parseWakeflowDurableIdOfKind,
} from "../../../src/contracts/identity/wakeflow-durable-id.js";
import {
  parseSha256Digest,
} from "../../../src/foundation/crypto/sha256.js";
import {
  RootedDirectory,
} from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  parseUtcInstant,
} from "../../../src/foundation/time/utc-instant.js";
import {
  executeDemandEventSourcingCommand,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import {
  DemandEventSourcingRepository,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import {
  DemandFileEventStore,
} from "../../../src/governance/demand/event-sourcing/demand-file-event-store.js";
import {
  computeTaskPackageDigest,
  parseTaskPackage,
  renderTaskPackage,
} from "../../../src/governance/tasking/task-package.js";
import {
  taskPackageProjectionRef,
} from "../../../src/governance/tasking/task-package-projection-paths.js";
import {
  TaskPackageProjectionStore,
  TaskPackageProjectionStoreError,
} from "../../../src/governance/tasking/task-package-projection-store.js";
import {
  createTaskPackageFixture,
  TASKING_AUTHORITY_DIGEST,
  TASKING_CREATED_AT,
  TASKING_DEMAND_ID,
  TASK_PACKAGE_ID,
} from "./task-package.fixture.js";

const PUBLISHED_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_88888888-8888-4888-8888-888888888888",
  "demand-event",
);
const PUBLISHED_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_99999999-9999-4999-8999-999999999999",
  "demand-event-commit",
);
const PLANNED_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "demand-event",
);
const PLANNED_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "demand-event-commit",
);
const IDENTITY_DIGEST = parseSha256Digest(`sha256:${"d".repeat(64)}`);

async function appendPublication(
  repository: DemandEventSourcingRepository,
): Promise<void> {
  await executeDemandEventSourcingCommand(repository, {
    commandType: "publication.publish-demand",
    commandVersion: 1,
    demandId: TASKING_DEMAND_ID,
    eventId: PUBLISHED_EVENT_ID,
    recordedAt: parseUtcInstant("2026-08-29T09:00:00.000Z"),
    identityDigest: IDENTITY_DIGEST,
    authorityDigest: TASKING_AUTHORITY_DIGEST,
  }, {
    commitId: PUBLISHED_COMMIT_ID,
    expectedStreamRevision: 0,
  });
}

async function appendTaskPackage(
  repository: DemandEventSourcingRepository,
): Promise<void> {
  await executeDemandEventSourcingCommand(repository, {
    commandType: "tasking.plan-target-task",
    commandVersion: 1,
    eventId: PLANNED_EVENT_ID,
    taskPackage: createTaskPackageFixture(),
  }, {
    commitId: PLANNED_COMMIT_ID,
    expectedStreamRevision: 1,
  });
}

test("TaskPackage projection is event-backed, idempotent, repairable, and never overwritten", async () => {
  const fixtureRoot = mkdtempSync(
    path.join(os.tmpdir(), "wakeflow-task-package-projection-"),
  );
  chmodSync(fixtureRoot, 0o700);
  const root = await RootedDirectory.open(fixtureRoot);
  try {
    const eventStore = new DemandFileEventStore(root);
    await eventStore.initialize();
    const repository = new DemandEventSourcingRepository(root);
    const projections = new TaskPackageProjectionStore(root);
    await appendPublication(repository);

    await rejects(
      projections.materialize(TASK_PACKAGE_ID),
      (error: unknown) => (
        error instanceof TaskPackageProjectionStoreError
        && error.reason === "authority-not-found"
      ),
    );
    equal(existsSync(path.join(fixtureRoot, "artifacts")), false);

    await appendTaskPackage(repository);
    const initial = await projections.materialize(TASK_PACKAGE_ID);
    equal(initial.disposition, "created");
    const projectionRef = taskPackageProjectionRef(TASK_PACKAGE_ID);
    const projectionPath = path.join(
      fixtureRoot,
      ...projectionRef.split("/"),
    );
    rmSync(projectionPath);

    const concurrent = await Promise.allSettled([
      projections.materialize(TASK_PACKAGE_ID),
      projections.materialize(TASK_PACKAGE_ID),
    ]);
    const results = concurrent.flatMap((entry) => (
      entry.status === "fulfilled" ? [entry.value] : []
    ));
    equal(results.some((entry) => entry.disposition === "created"), true);
    for (const entry of concurrent) {
      if (entry.status === "fulfilled") continue;
      equal(
        entry.reason instanceof TaskPackageProjectionStoreError
        && entry.reason.reason === "recovery-required",
        true,
      );
    }
    for (const result of results) {
      equal(result.sourceEvent.eventId, PLANNED_EVENT_ID);
      equal(result.sourceEvent.streamRevision, 2);
      equal(result.projection.taskPackage.createdAt, TASKING_CREATED_AT);
      equal(Object.isFrozen(result), true);
      equal(Object.isFrozen(result.projection), true);
    }
    equal(
      (await projections.materialize(TASK_PACKAGE_ID)).disposition,
      "current",
    );

    const taskPackage = createTaskPackageFixture();
    const taskPackageDigest = computeTaskPackageDigest(taskPackage);
    const loaded = await projections.load(TASK_PACKAGE_ID, {
      expectedTaskPackageDigest: taskPackageDigest,
    });
    deepEqual(loaded.taskPackage, taskPackage);
    await rejects(
      projections.load(TASK_PACKAGE_ID, {
        expectedTaskPackageDigest: parseSha256Digest(
          `sha256:${"e".repeat(64)}`,
        ),
      }),
      (error: unknown) => (
        error instanceof TaskPackageProjectionStoreError
        && error.reason === "conflict"
      ),
    );

    deepEqual(
      readdirSync(path.dirname(projectionPath)),
      [`${TASK_PACKAGE_ID}.json`],
    );

    rmSync(projectionPath);
    await rejects(
      projections.load(TASK_PACKAGE_ID, {
        expectedTaskPackageDigest: taskPackageDigest,
      }),
      (error: unknown) => (
        error instanceof TaskPackageProjectionStoreError
        && error.reason === "projection-not-found"
      ),
    );
    equal(
      (await projections.materialize(TASK_PACKAGE_ID)).disposition,
      "created",
    );

    const conflicting = parseTaskPackage({
      ...taskPackage,
      objective: "与事件权威不同的投影内容",
    });
    const conflictingText = renderTaskPackage(conflicting);
    writeFileSync(projectionPath, conflictingText, { mode: 0o600 });
    await rejects(
      projections.materialize(TASK_PACKAGE_ID),
      (error: unknown) => (
        error instanceof TaskPackageProjectionStoreError
        && error.reason === "conflict"
      ),
    );
    equal(readFileSync(projectionPath, "utf8"), conflictingText);
  } finally {
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
