import { deepEqual, equal, rejects } from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

import { computeDemandEventSourcingPublicationTransactionDigest } from "../../../src/governance/demand/publication/demand-event-sourcing-publication-transaction.js";
import {
  DemandEventSourcingPublicationPlanningService,
  DemandEventSourcingPublicationPlanningServiceError,
} from "../../../src/governance/demand/publication/demand-event-sourcing-publication-planning-service.js";
import {
  demandFinalRootRef,
  DEMAND_PUBLICATION_ROOT_REF,
} from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { inspectTodoItems } from "../../../src/governance/todo/todo-collection-service.js";
import {
  cleanupDemandEventSourcingPublicationWorkspaceFixture,
  createDemandEventSourcingPublicationWorkspaceFixture,
  demandEventSourcingPublicationAuthoredDemand,
  demandEventSourcingPublicationPhysicalPath,
  demandEventSourcingPublicationUuidFactory,
  PUBLICATION_CONFIRMATION_A_ID,
  PUBLICATION_CONFIRMATION_DEMAND_A,
  PUBLICATION_CONFIRMATION_DEMAND_B,
  PUBLICATION_RECORDED_AT,
  PUBLICATION_REQUIRED_ROLES,
  PUBLICATION_TODO_ID,
} from "./demand-event-sourcing-publication-service.fixture.js";

test("Publication Planning preview derives main and isolated plans without writes", async (t) => {
  const fixture = await createDemandEventSourcingPublicationWorkspaceFixture();
  try {
    const service = new DemandEventSourcingPublicationPlanningService(
      fixture.workspaceRoot,
    );

    await t.test(
      "main placement allocates Demand/Event/Commit identity",
      async () => {
        const uuidCalls = { value: 0 };
        const clockCalls = { value: 0 };
        const preview = await service.preview(
          {
            todoId: PUBLICATION_TODO_ID,
            demand: demandEventSourcingPublicationAuthoredDemand({
              mode: "main",
            }),
            authorityMembers: [...fixture.requirementMembers].reverse(),
          },
          {
            uuidFactory: demandEventSourcingPublicationUuidFactory(
              [
                "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              ],
              uuidCalls,
            ),
            clock: () => {
              clockCalls.value += 1;
              return PUBLICATION_RECORDED_AT;
            },
          },
        );

        equal(
          preview.plan.demandId,
          "demand_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        );
        equal(
          preview.plan.initialCommand.eventId,
          "demand-event_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        );
        equal(
          preview.plan.initialCommit.commitId,
          "demand-event-commit_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        );
        equal(preview.plan.identity.createdAt, PUBLICATION_RECORDED_AT);
        equal(preview.plan.initialCommand.recordedAt, PUBLICATION_RECORDED_AT);
        equal(preview.plan.identity.demandType, "requirement");
        equal(preview.plan.identity.source.todoId, PUBLICATION_TODO_ID);
        equal(preview.plan.identity.executionPlacement.mode, "main");
        equal(preview.plan.authority.testingDecision.mode, "controller-only");
        deepEqual(
          preview.plan.authority.authorityRefs.map(
            (reference) => reference.role,
          ),
          [...PUBLICATION_REQUIRED_ROLES].sort(),
        );
        equal(
          preview.plan.expectedTodoStateDigest,
          fixture.initialTodoStateDigest,
        );
        equal(preview.plan.initialCommit.commitSequence, 1);
        equal(preview.plan.initialCommit.expectedStreamRevision, 0);
        equal(
          preview.planDigest,
          computeDemandEventSourcingPublicationTransactionDigest(preview.plan),
        );
        equal(uuidCalls.value, 3);
        equal(clockCalls.value, 1);
        equal(Object.isFrozen(preview), true);
        equal(Object.isFrozen(preview.plan), true);
      },
    );

    await t.test(
      "isolated placement derives Demand identity from Confirmation",
      async () => {
        const uuidCalls = { value: 0 };
        const clockCalls = { value: 0 };
        const preview = await service.preview(
          {
            todoId: PUBLICATION_TODO_ID,
            demand: demandEventSourcingPublicationAuthoredDemand({
              mode: "isolated",
              authorizationMember: fixture.confirmationA,
            }),
            authorityMembers: [
              ...fixture.requirementMembers,
              fixture.confirmationA,
            ],
          },
          {
            uuidFactory: demandEventSourcingPublicationUuidFactory(
              [
                "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
              ],
              uuidCalls,
            ),
            clock: () => {
              clockCalls.value += 1;
              return PUBLICATION_RECORDED_AT;
            },
          },
        );

        equal(preview.plan.demandId, PUBLICATION_CONFIRMATION_DEMAND_A);
        equal(
          preview.plan.identity.demandId,
          PUBLICATION_CONFIRMATION_DEMAND_A,
        );
        equal(preview.plan.identity.executionPlacement.mode, "isolated");
        if (preview.plan.identity.executionPlacement.mode === "isolated") {
          equal(
            preview.plan.identity.executionPlacement.authorizationRef.recordId,
            PUBLICATION_CONFIRMATION_A_ID,
          );
          equal(
            preview.plan.identity.executionPlacement.authorizationRef.role,
            "goal-stage-decision",
          );
        }
        equal(uuidCalls.value, 2);
        equal(clockCalls.value, 1);
      },
    );

    await t.test(
      "conflicting Confirmation demand identities fail before allocation",
      async () => {
        const uuidCalls = { value: 0 };
        const clockCalls = { value: 0 };
        await rejects(
          service.preview(
            {
              todoId: PUBLICATION_TODO_ID,
              demand: demandEventSourcingPublicationAuthoredDemand({
                mode: "main",
              }),
              authorityMembers: [
                ...fixture.requirementMembers,
                fixture.confirmationA,
                fixture.confirmationB,
              ],
            },
            {
              uuidFactory: demandEventSourcingPublicationUuidFactory(
                ["ffffffff-ffff-4fff-8fff-ffffffffffff"],
                uuidCalls,
              ),
              clock: () => {
                clockCalls.value += 1;
                return PUBLICATION_RECORDED_AT;
              },
            },
          ),
          (error: unknown) =>
            error instanceof
              DemandEventSourcingPublicationPlanningServiceError &&
            error.reason === "authority",
        );
        equal(uuidCalls.value, 0);
        equal(clockCalls.value, 0);
      },
    );

    await t.test(
      "incomplete role closure fails before allocation",
      async () => {
        const uuidCalls = { value: 0 };
        const clockCalls = { value: 0 };
        await rejects(
          service.preview(
            {
              todoId: PUBLICATION_TODO_ID,
              demand: demandEventSourcingPublicationAuthoredDemand({
                mode: "main",
              }),
              authorityMembers: [fixture.requirementMembers[0]],
            },
            {
              uuidFactory: demandEventSourcingPublicationUuidFactory(
                ["ffffffff-ffff-4fff-8fff-ffffffffffff"],
                uuidCalls,
              ),
              clock: () => {
                clockCalls.value += 1;
                return PUBLICATION_RECORDED_AT;
              },
            },
          ),
          (error: unknown) =>
            error instanceof
              DemandEventSourcingPublicationPlanningServiceError &&
            error.reason === "authority" &&
            error.causeReason === "role",
        );
        equal(uuidCalls.value, 0);
        equal(clockCalls.value, 0);
      },
    );

    const snapshot = await inspectTodoItems(fixture.workspaceRoot);
    const todo = snapshot.items.find(
      (item) => item.todoId === PUBLICATION_TODO_ID,
    );
    equal(todo?.state.status, "pending-claim");
    equal(todo?.stateDigest, fixture.initialTodoStateDigest);
    equal(
      existsSync(
        demandEventSourcingPublicationPhysicalPath(
          fixture.workspacePath,
          DEMAND_PUBLICATION_ROOT_REF,
        ),
      ),
      false,
    );
    for (const demandId of [
      "demand_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      PUBLICATION_CONFIRMATION_DEMAND_A,
      PUBLICATION_CONFIRMATION_DEMAND_B,
    ]) {
      equal(
        existsSync(
          demandEventSourcingPublicationPhysicalPath(
            fixture.workspacePath,
            demandFinalRootRef(demandId),
          ),
        ),
        false,
      );
    }
  } finally {
    await cleanupDemandEventSourcingPublicationWorkspaceFixture(fixture);
  }
});
