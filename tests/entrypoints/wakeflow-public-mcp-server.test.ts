import { deepEqual, equal, match, throws } from "node:assert/strict";
import { test, type TestContext } from "node:test";

import {
  Client,
  InMemoryTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";

import { parseSha256Digest } from "../../src/foundation/crypto/sha256.js";

import {
  createWakeflowPublicMcpServer,
  WakeflowPublicMcpServerConfigurationError,
} from "../../src/entrypoints/wakeflow-public-mcp-server.js";
import {
  WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
  WakeflowMaintenancePublicContractError,
} from "../../src/workspace/maintenance/wakeflow-maintenance-public-contract.js";
import type {
  WakeflowMaintenancePublicResult,
} from "../../src/workspace/maintenance/wakeflow-maintenance-public-coordinator.js";
import {
  WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
} from "../../src/workspace/window-runtime/wakeflow-window-host-binding-public-contract.js";
import type {
  WakeflowWindowHostBindingPublicResult,
} from "../../src/workspace/window-runtime/wakeflow-window-host-binding-public-coordinator.js";
import {
  WakeflowWindowHostBindingPublicCoordinatorError,
} from "../../src/workspace/window-runtime/wakeflow-window-host-binding-public-coordinator.js";
import {
  WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
} from "../../src/governance/tasking/target-task-planning-public-contract.js";
import {
  executeTargetTaskPlanningPublicRequest,
  TargetTaskPlanningPublicCoordinatorError,
  type TargetTaskPlanningPublicResult,
} from "../../src/governance/tasking/target-task-planning-public-coordinator.js";
import {
  computeTargetTaskPlanningPlanDigest,
  createTargetTaskPlanningPlan,
} from "../../src/governance/tasking/target-task-planning-plan.js";
import {
  createTaskPackageFixture,
  taskPackageDraft,
  TASKING_DEMAND_ID,
} from "../governance/tasking/task-package.fixture.js";
import {
  parseWakeflowDurableIdOfKind,
} from "../../src/contracts/identity/wakeflow-durable-id.js";
import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  createTargetTaskPlanningWorkspaceFixture,
  planningUuidFactory,
  PLANNING_RECORDED_AT,
} from "../governance/tasking/target-task-planning-service.fixture.js";

/** 两个工具聚焦测试共用的合法占位摘要。 */
const ZERO_DIGEST = parseSha256Digest(`sha256:${"0".repeat(64)}`);
const WINDOW_ID = "window_11111111-1111-4111-8111-111111111111";
const BINDING_ID =
  "window_binding_22222222-2222-4222-8222-222222222222";

type PublicServerOptions = Parameters<
  typeof createWakeflowPublicMcpServer
>[0];
type WakeflowMaintenanceMcpExecutor =
  PublicServerOptions["executeMaintenance"];
type WakeflowWindowHostBindingMcpExecutor =
  PublicServerOptions["registerWindowHostBinding"];
type WakeflowTargetTaskPlanningMcpExecutor =
  PublicServerOptions["planTargetTask"];

function previewResult(): Readonly<WakeflowMaintenancePublicResult> {
  return Object.freeze({
    kind: "WakeflowMaintenancePublicPreviewResult",
    schemaVersion: 1,
    tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    hostId: "codex",
    mode: "preview",
    action: "reconcile",
    status: "blocked",
    blockerCodes: Object.freeze(["example-blocker"]),
    confirmation: null,
    confirmationDigest: null,
    freshConfigCompilation: null,
    launchIntents: [] as const,
    launchSetDigest: null,
  });
}

function mutationResult(): Readonly<WakeflowMaintenancePublicResult> {
  return Object.freeze({
    kind: "WakeflowMaintenancePublicMutationResult",
    schemaVersion: 1,
    tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    hostId: "codex",
    mode: "apply",
    action: "reconcile",
    status: "no-op",
    operationId: null,
    planDigest: ZERO_DIGEST,
    stepReceipts: Object.freeze([]),
    confirmationDigest: ZERO_DIGEST,
    launchIntents: Object.freeze([]),
    launchSetDigest: null,
  });
}

function bindingResult(): Readonly<WakeflowWindowHostBindingPublicResult> {
  return Object.freeze({
    kind: "WakeflowWindowHostBindingRegistrationResult",
    schemaVersion: 1,
    tool: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
    hostId: "codex",
    windowId: WINDOW_ID as WakeflowWindowHostBindingPublicResult["windowId"],
    disposition: "registered",
    binding: Object.freeze({
      bindingId: BINDING_ID as WakeflowWindowHostBindingPublicResult["binding"]["bindingId"],
      bindingRef:
        `.wakeflow-local/runtime/hosts/codex/identity/window-bindings/${WINDOW_ID}.json` as WakeflowWindowHostBindingPublicResult["binding"]["bindingRef"],
      registeredAt: "2026-08-28T10:00:01.000Z" as WakeflowWindowHostBindingPublicResult["binding"]["registeredAt"],
      source: Object.freeze({
        kind: "agent-host-create-result" as const,
        launchIntentDigest: ZERO_DIGEST as WakeflowWindowHostBindingPublicResult["binding"]["source"]["launchIntentDigest"],
        observedAt: "2026-08-28T10:00:00.000Z" as WakeflowWindowHostBindingPublicResult["binding"]["source"]["observedAt"],
      }),
    }),
    projection: Object.freeze({
      resourceRef:
        `.wakeflow-local/runtime/hosts/codex/projections/window-runtime/${WINDOW_ID}.json` as WakeflowWindowHostBindingPublicResult["projection"]["resourceRef"],
      projectionDigest: ZERO_DIGEST as WakeflowWindowHostBindingPublicResult["projection"]["projectionDigest"],
      documentDigest: ZERO_DIGEST as WakeflowWindowHostBindingPublicResult["projection"]["documentDigest"],
    }),
  });
}

function planningPreviewResult(): Readonly<TargetTaskPlanningPublicResult> {
  const plan = createTargetTaskPlanningPlan({
    demandId: TASKING_DEMAND_ID,
    expectedStreamRevision: 1,
    commitId: parseWakeflowDurableIdOfKind(
      "demand-event-commit_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "demand-event-commit",
    ),
    eventId: parseWakeflowDurableIdOfKind(
      "demand-event_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "demand-event",
    ),
    taskPackage: createTaskPackageFixture(),
  });
  return Object.freeze({
    kind: "WakeflowTargetTaskPlanningPreviewResult",
    schemaVersion: 1,
    tool: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
    mode: "preview",
    status: "ready",
    plan,
    planDigest: computeTargetTaskPlanningPlanDigest(plan),
  }) as unknown as Readonly<TargetTaskPlanningPublicResult>;
}

function planningPreviewRequest() {
  const draft = taskPackageDraft();
  return {
    root: "/workspace",
    mode: "preview" as const,
    demandId: TASKING_DEMAND_ID,
    taskPackage: {
      assignment: draft.assignment,
      workType: draft.workType,
      objective: draft.objective,
      confirmedContext: draft.confirmedContext,
      selectedAuthorityMemberRefs: draft.selectedAuthorityRefs.map(
        (reference) => reference.memberRef,
      ),
      boundaries: draft.boundaries,
      completionExpectations: draft.completionExpectations,
      commitExpectation: draft.commitExpectation,
      acceptanceAnchors: draft.acceptanceAnchors,
    },
  };
}

async function connect(
  t: TestContext,
  executeMaintenance: WakeflowMaintenanceMcpExecutor,
  registerWindowHostBinding: WakeflowWindowHostBindingMcpExecutor =
    async () => bindingResult(),
  planTargetTask: WakeflowTargetTaskPlanningMcpExecutor =
    async () => planningPreviewResult(),
) {
  const server = createWakeflowPublicMcpServer({
    serverName: "wakeflow-mcp-focused-test",
    serverVersion: "1.0.0-test",
    executeMaintenance,
    planTargetTask,
    registerWindowHostBinding,
  });
  const client = new Client({
    name: "wakeflow-mcp-focused-client",
    version: "1.0.0-test",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await Promise.allSettled([client.close(), server.close()]);
  });
  return client;
}

function textContent(result: CallToolResult): string {
  const first = result.content[0];
  if (first?.type !== "text") {
    throw new Error("Expected one MCP text content block.");
  }
  return first.text;
}

test("MCP composition拒绝Proxy executor与额外配置字段", () => {
  const executeMaintenance = async () => previewResult();
  const planTargetTask = async () => planningPreviewResult();
  const registerWindowHostBinding = async () => bindingResult();
  throws(
    () => createWakeflowPublicMcpServer({
      serverName: "wakeflow-test",
      serverVersion: "1.0.0-test",
      executeMaintenance,
      planTargetTask,
      registerWindowHostBinding: new Proxy(
        registerWindowHostBinding,
        {},
      ),
    }),
    (error: unknown) => (
      error instanceof WakeflowPublicMcpServerConfigurationError
      && error.reason === "window-host-binding-executor"
    ),
  );
  throws(
    () => createWakeflowPublicMcpServer({
      serverName: "wakeflow-test",
      serverVersion: "1.0.0-test",
      executeMaintenance,
      planTargetTask,
      registerWindowHostBinding,
      extra: true,
    } as never),
    (error: unknown) => (
      error instanceof WakeflowPublicMcpServerConfigurationError
      && error.reason === "options"
    ),
  );
});

test("官方 MCP server 只发布三个已有真实 owner 的 Schema 工具", async (t) => {
  const calls: unknown[] = [];
  const expected = previewResult();
  const client = await connect(t, async (request) => {
    calls.push(request);
    return expected;
  });

  const listed = await client.listTools();
  equal(listed.tools.length, 3);
  const tool = listed.tools.find((entry) => (
    entry.name === WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME
  ));
  equal(tool?.name, WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME);
  equal(tool?.inputSchema.$id, "urn:wakeflow:entrypoints:maintenance-public-request:v1");
  equal(tool?.outputSchema?.$id, "urn:wakeflow:entrypoints:maintenance-public-result:v1");
  equal(tool?.annotations?.readOnlyHint, false);
  equal(tool?.annotations?.openWorldHint, false);

  const request = {
    root: "/workspace",
    action: "reconcile",
    mode: "preview",
    request: {},
  } as const;
  const result = await client.callTool({
    name: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    arguments: request,
  });
  equal(result.isError, undefined);
  deepEqual(result.structuredContent, expected);
  deepEqual(JSON.parse(textContent(result)), expected);
  deepEqual(calls, [request]);
});

test("Target Task Planning MCP exposes exact preview/apply schemas and additive idempotency", async (t) => {
  const calls: unknown[] = [];
  const expected = planningPreviewResult();
  const client = await connect(
    t,
    async () => previewResult(),
    async () => bindingResult(),
    async (request) => {
      calls.push(request);
      return expected;
    },
  );
  const listed = await client.listTools();
  const tool = listed.tools.find((entry) => (
    entry.name === WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME
  ));
  equal(
    tool?.inputSchema.$id,
    "urn:wakeflow:entrypoints:target-task-planning-request:v1",
  );
  equal(
    tool?.outputSchema?.$id,
    "urn:wakeflow:entrypoints:target-task-planning-result:v1",
  );
  equal(tool?.annotations?.readOnlyHint, false);
  equal(tool?.annotations?.destructiveHint, false);
  equal(tool?.annotations?.idempotentHint, true);
  equal(tool?.annotations?.openWorldHint, false);
  equal(JSON.stringify(tool?.inputSchema).includes('"$ref":"urn:'), false);

  const request = planningPreviewRequest();
  const result = await client.callTool({
    name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
    arguments: request,
  });
  equal(result.isError, undefined);
  deepEqual(result.structuredContent, expected);
  deepEqual(JSON.parse(textContent(result)), expected);
  deepEqual(calls, [request]);
});

test("official MCP Client completes a real Target Task Planning preview/apply/retry", async (t) => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture();
  try {
    const client = await connect(
      t,
      async () => previewResult(),
      async () => bindingResult(),
      (request) => executeTargetTaskPlanningPublicRequest(request, {
        preview: {
          clock: () => PLANNING_RECORDED_AT,
          uuidFactory: planningUuidFactory(),
        },
      }),
    );
    const privateEcho = await client.callTool({
      name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        mode: "preview",
        demandId: fixture.request.demandId,
        taskPackage: {
          ...fixture.request.taskPackage,
          objective: `Do not echo ${fixture.workspacePath}/private`,
        },
      },
    });
    equal(privateEcho.isError, true);
    equal(textContent(privateEcho).includes(fixture.workspacePath), false);

    const previewCall = await client.callTool({
      name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        mode: "preview",
        demandId: fixture.request.demandId,
        taskPackage: fixture.request.taskPackage,
      },
    });
    equal(previewCall.isError, undefined);
    equal(textContent(previewCall).includes(fixture.workspacePath), false);
    const preview = previewCall.structuredContent as {
      readonly plan: unknown;
      readonly planDigest: string;
    };
    const applyArguments = {
      root: fixture.workspacePath,
      mode: "apply",
      plan: preview.plan,
      planDigest: preview.planDigest,
    } as const;
    const applied = await client.callTool({
      name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
      arguments: applyArguments,
    });
    equal(applied.isError, undefined);
    equal(textContent(applied).includes(fixture.workspacePath), false);
    equal(
      (applied.structuredContent as { disposition: string }).disposition,
      "committed",
    );
    const replayed = await client.callTool({
      name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
      arguments: applyArguments,
    });
    equal(replayed.isError, undefined);
    equal(
      (replayed.structuredContent as { disposition: string }).disposition,
      "idempotent",
    );
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});

test("official SDK rejects Target Task Planning extensions before its owner", async (t) => {
  let calls = 0;
  const client = await connect(
    t,
    async () => previewResult(),
    async () => bindingResult(),
    async () => {
      calls += 1;
      return planningPreviewResult();
    },
  );
  const result = await client.callTool({
    name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
    arguments: {
      ...planningPreviewRequest(),
      unownedField: true,
    },
  });
  equal(result.isError, true);
  match(textContent(result), /Input validation error/u);
  equal(calls, 0);
});

test("Maintenance MCP Schema接受领域统一的算法前缀摘要", async (t) => {
  const calls: unknown[] = [];
  const expected = mutationResult();
  const client = await connect(t, async (request) => {
    calls.push(request);
    return expected;
  });
  const request = {
    root: "/workspace",
    mode: "apply",
    confirmation: { kind: "ExampleConfirmation" },
    confirmationDigest: ZERO_DIGEST,
  } as const;
  const result = await client.callTool({
    name: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    arguments: request,
  });
  equal(result.isError, undefined);
  deepEqual(result.structuredContent, expected);
  deepEqual(calls, [request]);
});

test("Maintenance MCP输出Schema拒绝不可能的preview字段关系", async (t) => {
  const invalid = {
    ...previewResult(),
    status: "ready",
    blockerCodes: [],
  } as unknown as WakeflowMaintenancePublicResult;
  const client = await connect(t, async () => invalid);
  const result = await client.callTool({
    name: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    arguments: {
      root: "/workspace",
      action: "reconcile",
      mode: "preview",
      request: {},
    },
  });
  equal(result.isError, true);
  match(textContent(result), /Output validation error/u);
});

test("Window Host Binding 工具保持 Agent effect 与私有 handle 边界", async (t) => {
  const observations: unknown[] = [];
  const expected = bindingResult();
  const client = await connect(
    t,
    async () => previewResult(),
    async (request) => {
      observations.push(request);
      return expected;
    },
  );
  const listed = await client.listTools();
  const tool = listed.tools.find((entry) => (
    entry.name === WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME
  ));
  equal(
    tool?.inputSchema.$id,
    "urn:wakeflow:entrypoints:window-host-binding-registration-request:v1",
  );
  equal(
    JSON.stringify(tool?.outputSchema).includes('"$ref":"urn:'),
    false,
  );
  equal(tool?.annotations?.idempotentHint, true);

  const request = {
    root: "/workspace",
    observation: {
      kind: "WakeflowAgentHostWindowCreationObservation",
      schemaVersion: 1,
      source: "agent-host-create-result",
      hostId: "codex",
      windowId: WINDOW_ID,
      launchIntentDigest: ZERO_DIGEST,
      handle: {
        kind: "codex-thread",
        value: "opaque-host-thread-id",
      },
      observedAt: "2026-08-28T10:00:00.000Z",
    },
  } as const;
  const result = await client.callTool({
    name: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
    arguments: request,
  });
  equal(result.isError, undefined);
  deepEqual(result.structuredContent, expected);
  equal(textContent(result).includes("opaque-host-thread-id"), false);
  deepEqual(observations, [request]);
});

test("Window Host Binding输出Schema拒绝越界资源引用", async (t) => {
  const baseline = bindingResult();
  const invalid = {
    ...baseline,
    binding: {
      ...baseline.binding,
      bindingRef: "../outside.json",
    },
  } as unknown as WakeflowWindowHostBindingPublicResult;
  const client = await connect(
    t,
    async () => previewResult(),
    async () => invalid,
  );
  const result = await client.callTool({
    name: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
    arguments: {
      root: "/workspace",
      observation: {
        kind: "WakeflowAgentHostWindowCreationObservation",
        schemaVersion: 1,
        source: "agent-host-create-result",
        hostId: "codex",
        windowId: WINDOW_ID,
        launchIntentDigest: ZERO_DIGEST,
        handle: { kind: "codex-thread", value: "opaque-host-thread-id" },
        observedAt: "2026-08-28T10:00:00.000Z",
      },
    },
  });
  equal(result.isError, true);
  match(textContent(result), /Output validation error/u);
});

test("官方 SDK 在进入 Maintenance owner 前拒绝额外字段", async (t) => {
  let calls = 0;
  const client = await connect(t, async () => {
    calls += 1;
    return previewResult();
  });

  const result = await client.callTool({
    name: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    arguments: {
      root: "/workspace",
      action: "reconcile",
      mode: "preview",
      request: {},
      unownedField: true,
    },
  });
  equal(result.isError, true);
  match(textContent(result), /Input validation error/u);
  equal(calls, 0);
});

test("MCP 错误结果只公开稳定的领域错误字段", async (t) => {
  const client = await connect(t, async () => {
    throw new WakeflowMaintenancePublicContractError("shape", "$request");
  });

  const result = await client.callTool({
    name: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    arguments: {
      root: "/workspace",
      action: "reconcile",
      mode: "preview",
      request: {},
    },
  });
  equal(result.isError, true);
  deepEqual(JSON.parse(textContent(result)), {
    error: {
      code: "wakeflow-maintenance-public-contract",
      path: "$request",
      reason: "shape",
    },
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
  });
  equal(textContent(result).includes(ZERO_DIGEST), false);
  equal(textContent(result).includes("stack"), false);
});

test("MCP 显式保留 Binding commit unknown 而不伪装回滚", async (t) => {
  const client = await connect(
    t,
    async () => previewResult(),
    async () => {
      throw new WakeflowWindowHostBindingPublicCoordinatorError(
        "registration",
        "wakeflow-window-host-binding-store",
        "write",
        "unknown",
      );
    },
  );
  const result = await client.callTool({
    name: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
    arguments: {
      root: "/workspace",
      observation: {
        kind: "WakeflowAgentHostWindowCreationObservation",
        schemaVersion: 1,
        source: "agent-host-create-result",
        hostId: "codex",
        windowId: WINDOW_ID,
        launchIntentDigest: ZERO_DIGEST,
        handle: { kind: "codex-thread", value: "private-value" },
        observedAt: "2026-08-28T10:00:00.000Z",
      },
    },
  });
  equal(result.isError, true);
  const envelope = JSON.parse(textContent(result)) as {
    readonly error: {
      readonly bindingAuthority: string;
      readonly causeReason: string;
    };
  };
  equal(envelope.error.bindingAuthority, "unknown");
  equal(envelope.error.causeReason, "write");
  equal(textContent(result).includes("private-value"), false);
});

test("MCP 显式保留 Planning event authority current", async (t) => {
  const client = await connect(
    t,
    async () => previewResult(),
    async () => bindingResult(),
    async () => {
      throw new TargetTaskPlanningPublicCoordinatorError(
        "apply",
        "wakeflow-task-package-projection-store",
        "conflict",
        "current",
      );
    },
  );
  const result = await client.callTool({
    name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
    arguments: planningPreviewRequest(),
  });
  equal(result.isError, true);
  const envelope = JSON.parse(textContent(result)) as {
    readonly error: {
      readonly eventAuthority: string;
      readonly causeReason: string;
    };
  };
  equal(envelope.error.eventAuthority, "current");
  equal(envelope.error.causeReason, "conflict");
});
