import { equal, rejects, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  WAKEFLOW_DEMAND_COMPLETION_RESULT_SCHEMA,
  type WakeflowDemandCompletionResultV1 as DemandCompletionResultWire,
} from "../../../src/contracts/generated/entrypoints/wakeflow-demand-completion-result.generated.js";
import type { JsonValue } from "../../../src/foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../../src/foundation/schema/runtime-json-schema.js";
import { executeDemandControllerRoutePublicRequest } from "../../../src/governance/controller/demand-controller-route-public-coordinator.js";
import {
  parseDemandCompletionPublicRequest,
  DemandCompletionPublicContractError,
} from "../../../src/governance/lifecycle/demand-completion-public-contract.js";
import {
  executeDemandCompletionPublicRequest,
  DemandCompletionPublicCoordinatorError,
} from "../../../src/governance/lifecycle/demand-completion-public-coordinator.js";
import {
  cleanupAcceptedDemandCompletionWorkspaceFixture,
  completionUuidFactory,
  COMPLETION_COMPLETED_AT,
  createAcceptedDemandCompletionWorkspaceFixture,
} from "./demand-completion-service.fixture.js";

const validateResult =
  createRuntimeJsonSchemaValidator<DemandCompletionResultWire>(
    WAKEFLOW_DEMAND_COMPLETION_RESULT_SCHEMA,
  );

function containsText(value: unknown, needle: string): boolean {
  if (typeof value === "string") return value.includes(needle);
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some((entry) => containsText(entry, needle));
}

test("Completion Public Coordinator从accept Route精确进入终态并支持幂等重放", async () => {
  const fixture = await createAcceptedDemandCompletionWorkspaceFixture();
  try {
    const request = {
      root: fixture.workspacePath,
      mode: "preview" as const,
      demandId: fixture.intent.demandId,
    };
    const parsed = parseDemandCompletionPublicRequest(request);
    equal(Object.isFrozen(parsed), true);
    throws(
      () => parseDemandCompletionPublicRequest(new Proxy(request, {})),
      (error: unknown) =>
        error instanceof DemandCompletionPublicContractError &&
        error.reason === "json",
    );
    throws(
      () => parseDemandCompletionPublicRequest({ ...request, archive: true }),
      (error: unknown) =>
        error instanceof DemandCompletionPublicContractError &&
        error.reason === "schema",
    );

    const before = await executeDemandControllerRoutePublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
    });
    equal(before.route.frontiers[0]?.kind, "demand-completion-preflight");

    const preview = await executeDemandCompletionPublicRequest(request, {
      preview: {
        clock: () => COMPLETION_COMPLETED_AT,
        uuidFactory: completionUuidFactory(),
      },
    });
    equal(preview.mode, "preview");
    if (preview.mode !== "preview") {
      throw new Error("Expected a Demand Completion preview.");
    }
    equal(preview.status, "ready");
    equal(preview.plan.demandId, fixture.intent.demandId);
    equal(preview.plan.completion.testingMode, "controller-only");
    equal(containsText(preview, fixture.workspacePath), false);
    equal(containsText(preview, fixture.rawHandle), false);

    const afterPreview = await executeDemandControllerRoutePublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
    });
    equal(
      afterPreview.route.observedEventStream.streamRevision,
      before.route.observedEventStream.streamRevision,
    );
    equal(
      afterPreview.route.observedEventStream.stateDigest,
      before.route.observedEventStream.stateDigest,
    );

    const applyRequest = {
      root: fixture.workspacePath,
      mode: "apply" as const,
      plan: preview.plan,
      planDigest: preview.planDigest,
    };
    const completed = await executeDemandCompletionPublicRequest(applyRequest);
    equal(completed.mode, "apply");
    if (completed.mode !== "apply") {
      throw new Error("Expected a Demand Completion apply result.");
    }
    equal(completed.status, "completed");
    equal(completed.disposition, "committed");
    equal(completed.eventAuthority, "current");
    equal(
      completed.completion.completionDigest,
      preview.plan.completion.completionDigest,
    );
    equal(completed.event.eventId, preview.plan.eventId);
    equal(completed.commit.commitId, preview.plan.commitId);
    equal(validateResult(completed as unknown as JsonValue).ok, true);
    equal(
      validateResult({
        ...completed,
        status: "already-completed",
      } as unknown as JsonValue).ok,
      false,
    );
    equal(containsText(completed, fixture.workspacePath), false);
    equal(containsText(completed, fixture.rawHandle), false);
    equal(Object.hasOwn(completed, "archive"), false);
    equal(Object.hasOwn(completed, "hostClose"), false);

    const terminal = await executeDemandControllerRoutePublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
    });
    equal(terminal.route.lifecycle, "completed");
    equal(terminal.route.disposition, "terminal");
    equal(terminal.route.frontiers.length, 0);

    const replayed = await executeDemandCompletionPublicRequest(applyRequest);
    equal(replayed.mode, "apply");
    if (replayed.mode !== "apply") {
      throw new Error("Expected an idempotent Demand Completion result.");
    }
    equal(replayed.status, "already-completed");
    equal(replayed.disposition, "idempotent");
    equal(replayed.event.eventId, completed.event.eventId);
    equal(replayed.stateDigest, completed.stateDigest);
  } finally {
    await cleanupAcceptedDemandCompletionWorkspaceFixture(fixture);
  }
});

test("Completion Public Coordinator稳定区分根、preview与apply失败", async () => {
  await rejects(
    executeDemandCompletionPublicRequest({
      root: "/wakeflow/nonexistent-completion-root",
      mode: "preview",
      demandId: "demand_11111111-1111-4111-8111-111111111111",
    }),
    (error: unknown) =>
      error instanceof DemandCompletionPublicCoordinatorError &&
      error.reason === "root" &&
      error.eventAuthority === "unchanged",
  );

  const fixture = await createAcceptedDemandCompletionWorkspaceFixture();
  try {
    const preview = await executeDemandCompletionPublicRequest(
      {
        root: fixture.workspacePath,
        mode: "preview",
        demandId: fixture.intent.demandId,
      },
      {
        preview: {
          clock: () => COMPLETION_COMPLETED_AT,
          uuidFactory: completionUuidFactory(),
        },
      },
    );
    if (preview.mode !== "preview") {
      throw new Error("Expected a Demand Completion preview.");
    }
    await rejects(
      executeDemandCompletionPublicRequest({
        root: fixture.workspacePath,
        mode: "apply",
        plan: {
          ...preview.plan,
          expectedStreamRevision: preview.plan.expectedStreamRevision + 1,
        },
        planDigest: preview.planDigest,
      }),
      (error: unknown) =>
        error instanceof DemandCompletionPublicCoordinatorError &&
        error.reason === "apply" &&
        error.causeReason === "plan" &&
        error.eventAuthority === "unchanged",
    );

    await executeDemandCompletionPublicRequest({
      root: fixture.workspacePath,
      mode: "apply",
      plan: preview.plan,
      planDigest: preview.planDigest,
    });
    await rejects(
      executeDemandCompletionPublicRequest({
        root: fixture.workspacePath,
        mode: "preview",
        demandId: fixture.intent.demandId,
      }),
      (error: unknown) =>
        error instanceof DemandCompletionPublicCoordinatorError &&
        error.reason === "preview" &&
        error.causeReason === "route" &&
        error.eventAuthority === "unchanged",
    );
  } finally {
    await cleanupAcceptedDemandCompletionWorkspaceFixture(fixture);
  }
});
