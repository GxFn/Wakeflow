import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  codexPodEntryExtras,
  exactCodexRecoveryThread,
  exactCodexProject,
} from "../plugins/codex-wakeflow/scripts/lib/wakeflow-codex-pod-host.mjs";
import { hostProfile } from "../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import {
  handlers as wakeflowHandlers,
  tools as wakeflowTools,
} from "../core/lib/wakeflow-mcp-tools.mjs";

test("Codex Pod project resolution requires an exact saved-project root", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-codex-pod-project-"));
  const workspace = path.join(root, "WakeWorkspace");
  const repository = path.join(workspace, "RepoA");
  mkdirSync(repository, { recursive: true });

  const response = {
    schemaVersion: 2,
    projects: [
      {
        projectId: "workspace-project",
        projectKind: "local",
        path: workspace,
      },
      {
        projectId: "repository-project",
        projectKind: "local",
        path: repository,
      },
    ],
  };

  assert.equal(exactCodexProject(response, repository).projectId, "repository-project");
  assert.throws(
    () => exactCodexProject({ projects: [response.projects[0]] }, repository),
    (error) => error?.code === "project-not-registered" && /exactly matches/.test(error.message),
  );
});

test("Codex Pod product launch uses the exact project and host worktree environment", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-codex-pod-product-"));
  const repository = path.join(root, "RepoA");
  mkdirSync(repository);

  const operation = {
    role: "product",
    windowName: "RepoA__pod-a",
    repositoryRoot: repository,
    expectedBaseHead: "0123456789abcdef0123456789abcdef01234567",
    environmentIntent: "host-worktree",
    createPrompt: "Return identity only.",
    launchCorrelationId: "pod-launch-product",
    registrationBindingId: "pod-binding-product",
  };
  const stateRoot = path.join(root, ".wakeflow-active/current/pod-a");
  const extras = codexPodEntryExtras(operation, { workspaceRoot: root, stateRoot });

  assert.equal(extras.codexProjectResolution.exactPath, realpathSync.native(repository));
  assert.equal(extras.codexProjectResolution.parentProjectFallback, false);
  assert.equal(extras.codexProjectResolution.localEnvironmentFallback, false);
  assert.deepEqual(extras.hostCreateThread.targetTemplate.environment, {
    type: "worktree",
    startingState: {
      type: "branch",
      branchName: operation.expectedBaseHead,
    },
  });
  assert.equal(extras.hostCreateThread.asynchronousHandlePolicy.rejectClientThreadId, true);
  assert.equal(extras.hostCreateThread.asynchronousHandlePolicy.registerOnlyFinalThreadId, true);
  assert.deepEqual(extras.hostCreateThread.materializationProtocol, {
    recordTool: "wakeflow_pod_record",
    recordEvent: "materialization",
    beforeCreateStatus: "creating",
    asynchronousStatus: "pending",
    finalStatus: "finalized",
    hostRequestIdField: "create_thread.clientThreadId",
    recoveryTool: "list_threads",
    recoveryListArguments: {
      limit: 50,
    },
    recoveryMatch: {
      field: "preview",
      marker: `Wakeflow launch correlation: ${operation.launchCorrelationId}`,
      cardinality: "exactly-one",
      zeroMatches: "wait-or-block-without-create",
      multipleMatches: "block-without-finalize",
    },
    optionalQueryOptimization: {
      useOnlyWhenHostSchemaSupportsIt: true,
      required: false,
      query: operation.launchCorrelationId,
    },
    searchBeforeCreate: true,
    noBlindRetry: true,
    temporaryHandleRegistrationForbidden: true,
  });
  assert.equal(extras.entrySync.taskDispatchAllowed, false);
  assert.equal("cwd" in extras.hostCreateThread, false);
  assert.deepEqual(extras.localRegistration.callTemplate, {
    root,
    window: operation.windowName,
    windowHandle: "<create_thread.threadId>",
    launchCorrelationId: operation.launchCorrelationId,
    bindingId: operation.registrationBindingId,
    stateRoot: ".wakeflow-active/current/pod-a",
    apply: true,
  });
});

test("Codex Pod recovery uses a bounded list preview and finalizes only one exact correlation match", () => {
  const launchCorrelationId = "pod-launch-exact";
  const exact = {
    threadId: "11111111-1111-1111-1111-111111111111",
    preview: `Initialize.\nWakeflow launch correlation: ${launchCorrelationId}\nWait.`,
  };
  const response = {
    threads: [
      {
        threadId: "22222222-2222-2222-2222-222222222222",
        preview: `Wakeflow launch correlation: ${launchCorrelationId}-different`,
      },
      exact,
    ],
  };

  assert.equal(exactCodexRecoveryThread(response, launchCorrelationId), exact);
  for (const threads of [
    [],
    [exact, { ...exact, threadId: "33333333-3333-3333-3333-333333333333" }],
  ]) {
    assert.throws(
      () => exactCodexRecoveryThread({ threads }, launchCorrelationId),
      (error) => (
        error?.code === "recovery-not-unique"
        && error.matchCount === threads.length
      ),
    );
  }
});

test("Codex Pod control roles are separate local sessions in the control project", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-codex-pod-control-"));
  const operations = ["controller", "design", "test"].map((role) => ({
    role,
    windowName: `${role}__pod-a`,
    environmentIntent: "host-local",
    createPrompt: `Initialize ${role}.`,
    launchCorrelationId: `pod-launch-${role}`,
    registrationBindingId: `pod-binding-${role}`,
  }));

  for (const operation of operations) {
    const extras = hostProfile.pod.entryExtras(operation, { workspaceRoot: root });
    assert.equal(extras.codexProjectResolution.exactPath, realpathSync.native(root));
    assert.deepEqual(extras.hostCreateThread.targetTemplate.environment, { type: "local" });
    assert.equal(extras.entrySync.stateRootScope, "current-pod-only");
    assert.equal(extras.entrySync.taskDispatchAllowed, false);
  }
});

test("Codex Pod product intents fail before host creation without a frozen base HEAD", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-codex-pod-head-"));
  assert.throws(
    () => codexPodEntryExtras({
      role: "product",
      windowName: "RepoA__pod-a",
      repositoryRoot: root,
      environmentIntent: "host-worktree",
      registrationBindingId: "pod-binding-product",
    }, { workspaceRoot: root }),
    /missing expectedBaseHead/,
  );
});

test("the MCP surface exposes the two-stage Pod protocol and explicit placement inputs", () => {
  const toolsByName = new Map(wakeflowTools.map((tool) => [tool.name, tool]));
  for (const name of [
    "wakeflow_pod_open",
    "wakeflow_pod_bind",
    "wakeflow_pod_plan",
    "wakeflow_pod_record",
  ]) {
    assert.ok(toolsByName.has(name), `${name} is public`);
  }
  for (const retired of [
    "wakeflow_pod_record_materialization",
    "wakeflow_pod_prepare_design_request",
    "wakeflow_pod_record_design_handoff",
    "wakeflow_pod_prepare_test_access",
    "wakeflow_pod_record_test_access",
    "wakeflow_pod_close",
    "wakeflow_pod_record_close_receipt",
    "wakeflow_pod_list",
  ]) {
    assert.equal(toolsByName.has(retired), false, `${retired} is not public`);
  }

  const createProperties = toolsByName.get("wakeflow_create_demand").inputSchema.properties;
  assert.deepEqual(createProperties.placement.enum, ["main", "pod"]);
  assert.ok(createProperties.authorizationRef);
  assert.ok(createProperties.podId);

  const open = toolsByName.get("wakeflow_pod_open");
  assert.deepEqual(open.inputSchema.required, ["demandKey"]);
  assert.deepEqual(
    open.inputSchema.properties.repositories.items.required,
    ["windowName", "expectedBaseHead"],
  );
  assert.equal(
    /worktree.*thread|thread.*worktree/i.test(open.description)
      && /never creates/i.test(open.description),
    true,
  );

  const plan = toolsByName.get("wakeflow_pod_plan");
  assert.deepEqual(plan.inputSchema.required, ["action"]);
  assert.deepEqual(plan.inputSchema.properties.action.enum, [
    "design-request",
    "test-access",
    "close",
  ]);
  for (const field of ["root", "action", "demandKey", "request", "apply"]) {
    assert.ok(plan.inputSchema.properties[field], `wakeflow_pod_plan exposes ${field}`);
  }
  assert.deepEqual(plan.inputSchema.properties.request.required, [
    "demandKey",
    "podId",
    "demandType",
    "requestType",
    "originalGoal",
    "requirementAnchors",
    "codeEvidenceRefs",
    "pausedTargetIdentity",
    "pausedReviewIdentity",
    "nonGoals",
    "decisionsRequired",
  ]);
  const planBranches = new Map(
    plan.inputSchema.oneOf.map((branch) => [branch.properties.action.const, branch]),
  );
  assert.deepEqual(planBranches.get("design-request").required, ["request"]);
  assert.deepEqual(planBranches.get("test-access").required, ["demandKey"]);
  assert.deepEqual(planBranches.get("close").required, ["demandKey"]);

  const record = toolsByName.get("wakeflow_pod_record");
  assert.deepEqual(record.inputSchema.required, ["event"]);
  assert.deepEqual(record.inputSchema.properties.event.enum, [
    "materialization",
    "design-handoff",
    "test-access",
    "close-receipt",
  ]);
  for (const field of ["root", "event", "attempt", "handoff", "receipt", "apply"]) {
    assert.ok(record.inputSchema.properties[field], `wakeflow_pod_record exposes ${field}`);
  }
  assert.deepEqual(record.inputSchema.properties.attempt.required, [
    "launchCorrelationId",
    "host",
    "status",
    "observedAt",
  ]);
  const recordBranches = new Map(
    record.inputSchema.oneOf.map((branch) => [branch.properties.event.const, branch]),
  );
  assert.deepEqual(recordBranches.get("materialization").required, ["attempt"]);
  assert.deepEqual(recordBranches.get("design-handoff").required, ["handoff"]);
  assert.deepEqual(recordBranches.get("test-access").required, ["receipt"]);
  assert.deepEqual(recordBranches.get("close-receipt").required, ["receipt"]);
  assert.deepEqual(
    ["test-access", "close-receipt"].map(
      (event) => recordBranches.get(event).properties.receipt.required,
    ),
    [
      [
        "probeId",
        "demandKey",
        "podId",
        "host",
        "testWindowName",
        "testBindingId",
        "status",
        "capability",
        "observedAt",
      ],
      [
        "closeCorrelationId",
        "bindingId",
        "windowName",
        "host",
        "sessionStatus",
        "worktreeStatus",
        "confirmedAt",
      ],
    ],
  );
});

test("consolidated Pod routers reject payloads from another action or event", () => {
  assert.throws(
    () => wakeflowHandlers.wakeflow_pod_plan({
      action: "design-request",
      request: {},
      demandKey: "wrong-branch",
    }),
    /action=design-request does not accept demandKey/,
  );
  assert.throws(
    () => wakeflowHandlers.wakeflow_pod_plan({
      action: "test-access",
      request: {},
    }),
    /action=test-access does not accept request/,
  );
  assert.throws(
    () => wakeflowHandlers.wakeflow_pod_record({
      event: "materialization",
      attempt: {},
      receipt: {},
    }),
    /event=materialization does not accept receipt/,
  );
  assert.throws(
    () => wakeflowHandlers.wakeflow_pod_record({ event: "unknown" }),
    /unknown event/,
  );
  assert.throws(
    () => wakeflowHandlers.wakeflow_pod_plan({
      action: "close",
      event: "close-receipt",
      demandKey: "pod-a",
    }),
    /action=close does not accept event/,
  );
  assert.throws(
    () => wakeflowHandlers.wakeflow_pod_record({
      event: "close-receipt",
      action: "close",
      receipt: {},
    }),
    /event=close-receipt does not accept action/,
  );
});
