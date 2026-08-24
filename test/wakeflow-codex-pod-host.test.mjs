import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  codexPodCreationObservation,
  codexPodMaterializationOperation,
  exactCodexRecoveryThread,
  exactCodexProject,
} from "../plugins/codex-wakeflow/scripts/lib/wakeflow-codex-pod-host.mjs";
import { canonicalJsonDigest } from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  handlers as wakeflowHandlers,
  tools as wakeflowTools,
} from "../core/lib/wakeflow-mcp-tools.mjs";

function candidatePlan({ mode = "host-create", role = "product", root }) {
  const canonicalRoot = realpathSync.native(root);
  const launchOperationId = "pod-launch_77000000-0000-4000-8000-000000000001";
  const unsigned = {
    kind: "WakeflowPodWindowMaterializationPlan",
    schemaVersion: 1,
    mode,
    programId: "program_11111111-1111-4111-8111-111111111111",
    demandId: "demand_22000000-0000-4000-8000-000000000001",
    hostId: "codex",
    podId: "pod_33000000-0000-4000-8000-000000000001",
    windowId: "window_55000000-0000-4000-8000-000000000001",
    bindingId: "binding_66000000-0000-4000-8000-000000000001",
    configDigest: `sha256:${"1".repeat(64)}`,
    state: { revision: 2, digest: `sha256:${"2".repeat(64)}` },
    launchIntent: {
      ref: `.wakeflow-local/runtime/hosts/codex/evidence/pods/`
        + `pod_33000000-0000-4000-8000-000000000001/launch-intents/${launchOperationId}.json`,
      digest: `sha256:${"3".repeat(64)}`,
    },
    materialization: { status: mode === "host-recovery" ? "pending" : "creating" },
    operation: {
      role,
      environmentIntent: role === "product" ? "host-worktree" : "host-local",
      launchOperationId,
      correlationId: launchOperationId,
      stateRootRef: ".wakeflow-active/current/demand_22000000-0000-4000-8000-000000000001",
      ...(role === "product"
        ? {
            repositoryId: "repository_22222222-2222-4222-8222-222222222222",
            repositoryRoot: canonicalRoot,
            repositorySourceDigest: `sha256:${"4".repeat(64)}`,
            expectedBaseHead: "0123456789abcdef0123456789abcdef01234567",
          }
        : { controlRoot: canonicalRoot }),
    },
    requiresHostOperationFence: true,
    hostCreateAllowed: mode === "host-create",
    recoveryOnly: mode !== "host-create",
  };
  return { ...unsigned, planDigest: canonicalJsonDigest(unsigned) };
}

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

  assert.deepEqual(exactCodexRecoveryThread(response, launchCorrelationId), exact);
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

test("Codex candidate materialization searches before create and consumes the exact v3 plan", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-codex-pod-candidate-"));
  const repository = path.join(root, "RepoA");
  mkdirSync(repository);
  const plan = candidatePlan({ root: repository });
  const projectResponse = {
    projects: [{ projectId: "repo-project", projectKind: "local", path: repository }],
  };
  const create = codexPodMaterializationOperation(plan, {
    projectResponse,
    threadResponse: { threads: [] },
  });
  assert.equal(create.mode, "create");
  assert.equal(create.searchBeforeCreate, true);
  assert.deepEqual(create.createThread.target.environment, {
    type: "worktree",
    startingState: { type: "branch", branchName: plan.operation.expectedBaseHead },
  });
  assert.match(create.createThread.prompt, new RegExp(plan.operation.correlationId));
  assert.equal(Object.isFrozen(create.createThread.target.environment), true);
  assert.throws(
    () => codexPodMaterializationOperation(plan, { projectResponse }),
    (error) => error?.code === "search-before-create-required",
  );

  const existing = codexPodMaterializationOperation(plan, {
    projectResponse,
    threadResponse: {
      threads: [{
        threadId: "11111111-1111-4111-8111-111111111111",
        preview: `Wakeflow launch correlation: ${plan.operation.correlationId}`,
      }],
    },
  });
  assert.equal(existing.mode, "observe-existing");
  assert.equal(existing.createAllowed, false);
  assert.equal("createThread" in existing, false);

  const controlPlan = candidatePlan({ role: "controller", root });
  const control = codexPodMaterializationOperation(controlPlan, {
    projectResponse: {
      projects: [{ projectId: "control-project", projectKind: "local", path: root }],
    },
    threadResponse: { threads: [] },
  });
  assert.deepEqual(control.createThread.target.environment, { type: "local" });

  assert.throws(
    () => codexPodMaterializationOperation({ ...plan, windowId: "tampered" }, {
      projectResponse,
      threadResponse: { threads: [] },
    }),
    (error) => error?.code === "invalid-materialization-plan",
  );
  const recovery = candidatePlan({ mode: "host-recovery", root: repository });
  assert.throws(
    () => codexPodMaterializationOperation(recovery, { threadResponse: { threads: [] } }),
    (error) => error?.code === "recovery-not-found",
  );

  const { planDigest: _planDigest, ...missingHeadUnsigned } = plan;
  missingHeadUnsigned.operation = { ...missingHeadUnsigned.operation };
  delete missingHeadUnsigned.operation.expectedBaseHead;
  const missingHead = {
    ...missingHeadUnsigned,
    planDigest: canonicalJsonDigest(missingHeadUnsigned),
  };
  assert.throws(
    () => codexPodMaterializationOperation(missingHead, {
      projectResponse,
      threadResponse: { threads: [] },
    }),
    (error) => error?.code === "invalid-materialization-plan",
  );
});

test("Codex candidate observation keeps clientThreadId transient and returns only final identity plus cwd", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-codex-pod-observation-"));
  const plan = candidatePlan({ root });
  const pending = codexPodCreationObservation(plan, {
    clientThreadId: "temporary-client-thread-id",
  });
  assert.deepEqual(pending, {
    status: "pending",
    hostRequestId: "temporary-client-thread-id",
  });
  const finalized = codexPodCreationObservation(plan, {
    clientThreadId: "must-not-survive-finalization",
    threadId: "22222222-2222-4222-8222-222222222222",
    actualCwd: root,
    hostCreatedAt: "2026-08-09T03:00:00.000Z",
  });
  assert.deepEqual(finalized, {
    status: "finalized",
    handle: {
      kind: "codex-thread",
      value: "22222222-2222-4222-8222-222222222222",
    },
    observation: {
      actualCwd: realpathSync.native(root),
      hostCreatedAt: "2026-08-09T03:00:00.000Z",
    },
  });
  assert.equal(JSON.stringify(finalized).includes("client-thread"), false);
});

test("Codex Pod host rejects behavioral plans and host observations without executing accessors", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-codex-pod-passive-"));
  const plan = candidatePlan({ root });
  let planKindReads = 0;
  const behavioralPlan = { ...plan };
  Object.defineProperty(behavioralPlan, "kind", {
    enumerable: true,
    configurable: true,
    get() {
      planKindReads += 1;
      return plan.kind;
    },
  });
  assert.throws(
    () => codexPodMaterializationOperation(behavioralPlan, { threadResponse: { threads: [] } }),
    (error) => error?.code === "invalid-materialization-plan",
  );
  assert.equal(planKindReads, 0);

  let threadIdReads = 0;
  const thread = {
    preview: `Wakeflow launch correlation: ${plan.operation.correlationId}`,
  };
  Object.defineProperty(thread, "threadId", {
    enumerable: true,
    configurable: true,
    get() {
      threadIdReads += 1;
      return "11111111-1111-4111-8111-111111111111";
    },
  });
  assert.throws(
    () => codexPodMaterializationOperation(plan, { threadResponse: { threads: [thread] } }),
    (error) => error?.code === "invalid-host-observation",
  );
  assert.equal(threadIdReads, 0);
});

test("the public MCP surface exposes the state-first Pod operation families", () => {
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

  const operations = {
    wakeflow_pod_open: [
      "inspect-materialization",
      "plan-materialization",
      "launch-preview",
      "launch-apply",
      "product-preview",
      "product-apply",
    ],
    wakeflow_pod_record: [
      "record-materialization",
      "design-handoff",
      "test-access-observe",
      "test-access-receipt",
      "close-observe",
      "close-receipt",
    ],
    wakeflow_pod_bind: ["creation-receipt", "binding-decommission"],
    wakeflow_pod_plan: [
      "design-request",
      "test-access-plan",
      "test-access-inspect",
      "close-intent",
      "close-inspect",
    ],
  };
  for (const [name, expectedOperations] of Object.entries(operations)) {
    const tool = toolsByName.get(name);
    assert.deepEqual(tool.inputSchema.required, ["root", "operation", "request"]);
    assert.deepEqual(Object.keys(tool.inputSchema.properties), ["root", "demandId", "operation", "request"]);
    assert.deepEqual(tool.inputSchema.properties.operation.enum, expectedOperations);
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  assert.match(toolsByName.get("wakeflow_pod_open").description, /without performing a host effect/);
});

test("public Pod routers reject retired flattened action and event payloads", async () => {
  const calls = [
    () => wakeflowHandlers.wakeflow_pod_plan({
      action: "design-request",
      request: {},
      demandKey: "wrong-branch",
    }),
    () => wakeflowHandlers.wakeflow_pod_plan({
      action: "test-access",
      request: {},
    }),
    () => wakeflowHandlers.wakeflow_pod_record({
      event: "materialization",
      attempt: {},
      receipt: {},
    }),
    () => wakeflowHandlers.wakeflow_pod_record({ event: "unknown" }),
    () => wakeflowHandlers.wakeflow_pod_plan({
      action: "close",
      event: "close-receipt",
      demandKey: "pod-a",
    }),
    () => wakeflowHandlers.wakeflow_pod_record({
      event: "close-receipt",
      action: "close",
      receipt: {},
    }),
  ];
  for (const call of calls) {
    await assert.rejects(call(), (error) => error?.code === "wakeflow-public-mcp-domain");
  }
});
