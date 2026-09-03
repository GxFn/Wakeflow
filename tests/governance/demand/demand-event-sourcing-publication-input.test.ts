import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  parseDemandEventSourcingPublicationPreviewRequest,
  DemandEventSourcingPublicationInputError,
} from "../../../src/governance/demand/publication/demand-event-sourcing-publication-input.js";

const REQUIREMENT_ID = "requirement_22222222-2222-4222-8222-222222222222";
const CONFIRMATION_ID = "confirmation_11111111-1111-4111-8111-111111111111";

const REQUIREMENT_MEMBER = Object.freeze({
  recordId: REQUIREMENT_ID,
  memberPath: "authority/requirement-design.md",
});
const CONFIRMATION_MEMBER = Object.freeze({
  recordId: CONFIRMATION_ID,
  memberPath: "decisions/placement.md",
});

function request() {
  return {
    todoId: "todo_9e9b3e91-55e2-43c1-8e93-68226aa84f80",
    demand: {
      title: "Demand Event Sourcing Publication",
      goal: "从当前TODO与Ledger权威派生一份Demand",
      completionDefinition: "发布revision 1并精确领取TODO",
      executionPlacement: { mode: "main" },
    },
  };
}

function isInputError(
  reason: DemandEventSourcingPublicationInputError["reason"],
  path?: string,
) {
  return (error: unknown) =>
    error instanceof DemandEventSourcingPublicationInputError &&
    error.reason === reason &&
    (path === undefined || error.path === path);
}

test("Publication preview input keeps only authored Demand intent and TODO identity", () => {
  const parsed = parseDemandEventSourcingPublicationPreviewRequest(request());

  equal(parsed.todoId, "todo_9e9b3e91-55e2-43c1-8e93-68226aa84f80");
  deepEqual(parsed.demand, {
    title: "Demand Event Sourcing Publication",
    goal: "从当前TODO与Ledger权威派生一份Demand",
    completionDefinition: "发布revision 1并精确领取TODO",
    executionPlacement: { mode: "main" },
  });
  equal(Object.isFrozen(parsed), true);
  equal(Object.isFrozen(parsed.demand), true);
  equal(Object.isFrozen(parsed.demand.executionPlacement), true);
  equal(Object.hasOwn(parsed, "authorityMembers"), false);
  equal(Object.hasOwn(parsed, "programId"), false);
  equal(Object.hasOwn(parsed, "demandType"), false);
  equal(Object.hasOwn(parsed, "testingDecision"), false);
  equal(Object.hasOwn(parsed, "eventId"), false);
  equal(Object.hasOwn(parsed, "recordedAt"), false);
});

test("isolated placement names one Confirmation member for later TODO-bound resolution", () => {
  const parsed = parseDemandEventSourcingPublicationPreviewRequest({
    ...request(),
    demand: {
      ...request().demand,
      executionPlacement: {
        mode: "isolated",
        authorizationMember: { ...CONFIRMATION_MEMBER },
      },
    },
  });

  deepEqual(parsed.demand.executionPlacement, {
    mode: "isolated",
    authorizationMember: CONFIRMATION_MEMBER,
  });
  equal(Object.isFrozen(parsed.demand.executionPlacement), true);
  if (parsed.demand.executionPlacement.mode === "isolated") {
    equal(
      Object.isFrozen(parsed.demand.executionPlacement.authorizationMember),
      true,
    );
  }

  throws(
    () =>
      parseDemandEventSourcingPublicationPreviewRequest({
        ...request(),
        demand: {
          ...request().demand,
          executionPlacement: {
            mode: "isolated",
            authorizationMember: REQUIREMENT_MEMBER,
          },
        },
      }),
    isInputError(
      "placement",
      "$/demand/executionPlacement/authorizationMember",
    ),
  );
});

test("Publication preview input rejects caller authority sets and non-canonical identity text", () => {
  throws(
    () =>
      parseDemandEventSourcingPublicationPreviewRequest({
        ...request(),
        todoId: "todo with spaces",
      }),
    isInputError("todo", "$/todoId"),
  );
  throws(
    () =>
      parseDemandEventSourcingPublicationPreviewRequest({
        ...request(),
        authorityMembers: [],
      }),
    isInputError("input", "$request"),
  );
  throws(
    () =>
      parseDemandEventSourcingPublicationPreviewRequest({
        ...request(),
        demand: { ...request().demand, title: " padded" },
      }),
    isInputError("identity", "$/demand/title"),
  );
  throws(
    () =>
      parseDemandEventSourcingPublicationPreviewRequest({
        ...request(),
        demand: { ...request().demand, goal: "e\u0301" },
      }),
    isInputError("identity", "$/demand/goal"),
  );
  throws(
    () =>
      parseDemandEventSourcingPublicationPreviewRequest({
        ...request(),
        demand: {
          ...request().demand,
          completionDefinition: "x".repeat(16_385),
        },
      }),
    isInputError("identity", "$/demand/completionDefinition"),
  );
});

test("Publication preview input rejects active data and unknown fields without invoking getters", () => {
  let getterCalled = false;
  const activeDemand = Object.defineProperty(
    {
      title: "Demand Event Sourcing Publication",
      goal: "目标",
      completionDefinition: "完成定义",
      executionPlacement: { mode: "main" },
    },
    "extra",
    {
      enumerable: true,
      get() {
        getterCalled = true;
        return "never";
      },
    },
  );

  throws(
    () =>
      parseDemandEventSourcingPublicationPreviewRequest({
        ...request(),
        demand: activeDemand,
      }),
    isInputError("identity", "$/demand"),
  );
  equal(getterCalled, false);
  throws(
    () =>
      parseDemandEventSourcingPublicationPreviewRequest({
        ...request(),
        unexpected: true,
      }),
    isInputError("input", "$request"),
  );
  throws(
    () =>
      parseDemandEventSourcingPublicationPreviewRequest(
        new Proxy(request(), {}),
      ),
    isInputError("input", "$request"),
  );
});
