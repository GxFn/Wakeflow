import { deepEqual, equal } from "node:assert/strict";
import os from "node:os";
import { test } from "node:test";

import { WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME } from "../../src/capabilities/demand/contract.js";
import { WAKEFLOW_STATUS_PUBLIC_TOOL_NAME } from "../../src/capabilities/observation/contract.js";
import { WAKEFLOW_PREPARE_DELIVERY_PUBLIC_TOOL_NAME } from "../../src/capabilities/delivery/contract.js";
import { WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME } from "../../src/capabilities/workspace/maintain-workspace.js";
import { WakeflowError } from "../../src/kernel/error.js";
import {
  createTaskPackageFixture,
  TASKING_DEMAND_ID,
} from "../governance/tasking/task-package.fixture.js";
import {
  connectWakeflowMcpTestClient,
  wakeflowMcpTextContent,
} from "./wakeflow-public-mcp-server.fixture.js";

function prepareDeliveryRequest() {
  const taskPackage = createTaskPackageFixture();
  return {
    root: "/workspace/private-delivery",
    demandId: taskPackage.demandId,
    idempotencyKey: "envelope-prepare-1",
    expectedStreamRevision: 2,
    targetTaskId: taskPackage.targetTaskId,
    authored: {
      goal: "按任务包完成本轮实现。",
      focus: ["先读任务包"],
      boundary: "不触碰其他仓库。",
    },
  } as const;
}

test("Workspace注册组只公开合同错误字段", async (t) => {
  const client = await connectWakeflowMcpTestClient(t, {
    executeMaintenance: async () => {
      throw new WakeflowError("invalid-request", "shape", "$request", {
        details: { operationId: "maintenance_operation_11111111-1111-4111-8111-111111111111" },
      });
    },
  });
  const result = await client.callTool({
    name: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    arguments: {
      root: "/workspace/private-maintenance",
      action: "reconcile",
      mode: "preview",
      request: {},
    },
  });
  equal(result.isError, true);
  deepEqual(JSON.parse(wakeflowMcpTextContent(result)), {
    error: {
      code: "invalid-request",
      details: {
        operationId: "maintenance_operation_11111111-1111-4111-8111-111111111111",
      },
      path: "$request",
      reason: "shape",
      retryable: false,
    },
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
  });
  equal(wakeflowMcpTextContent(result).includes("private-maintenance"), false);
});

test("Authority注册组返回稳定code、reason与path且不回显root", async (t) => {
  const client = await connectWakeflowMcpTestClient(t, {
    inspectStatus: async () => {
      throw new WakeflowError("precondition-failed", "demand-authority-inventory", "$demandRoot");
    },
  });
  const root = "/workspace/private-demand-route";
  const result = await client.callTool({
    name: WAKEFLOW_STATUS_PUBLIC_TOOL_NAME,
    arguments: { root, demandId: TASKING_DEMAND_ID },
  });
  equal(result.isError, true);
  deepEqual(JSON.parse(wakeflowMcpTextContent(result)), {
    error: {
      code: "precondition-failed",
      path: "$demandRoot",
      reason: "demand-authority-inventory",
      retryable: false,
    },
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: WAKEFLOW_STATUS_PUBLIC_TOOL_NAME,
  });
  equal(wakeflowMcpTextContent(result).includes(root), false);
});

test("Execution注册组把窗口占用作为稳定前置条件错误返回且不回显路径", async (t) => {
  const client = await connectWakeflowMcpTestClient(t, {
    prepareDelivery: async () => {
      throw new WakeflowError("precondition-failed", "window-claimed", "$request.targetTaskId", {
        details: { blockers: "window-claimed:demand_22222222-2222-4222-8222-222222222222" },
      });
    },
  });
  const request = prepareDeliveryRequest();
  const result = await client.callTool({
    name: WAKEFLOW_PREPARE_DELIVERY_PUBLIC_TOOL_NAME,
    arguments: request,
  });
  equal(result.isError, true);
  deepEqual(JSON.parse(wakeflowMcpTextContent(result)), {
    error: {
      code: "precondition-failed",
      details: { blockers: "window-claimed:demand_22222222-2222-4222-8222-222222222222" },
      path: "$request.targetTaskId",
      reason: "window-claimed",
      retryable: false,
    },
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: WAKEFLOW_PREPARE_DELIVERY_PUBLIC_TOOL_NAME,
  });
  equal(wakeflowMcpTextContent(result).includes(request.root), false);
});

test("Review注册组返回稳定Completion前置条件错误且不回显root", async (t) => {
  const client = await connectWakeflowMcpTestClient(t, {
    completeDemand: async () => {
      throw new WakeflowError("precondition-failed", "completion-route", "$demandRoot");
    },
  });
  const root = "/workspace/private-completion";
  const result = await client.callTool({
    name: WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
    arguments: {
      root,
      mode: "preview",
      demandId: TASKING_DEMAND_ID,
    },
  });
  equal(result.isError, true);
  deepEqual(JSON.parse(wakeflowMcpTextContent(result)), {
    error: {
      code: "precondition-failed",
      path: "$demandRoot",
      reason: "completion-route",
      retryable: false,
    },
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
  });
  equal(wakeflowMcpTextContent(result).includes(root), false);
});

test("未知异常统一脱敏且不返回stack", async (t) => {
  const privateMarker = "private-unexpected-error-marker";
  const client = await connectWakeflowMcpTestClient(t, {
    inspectStatus: async () => {
      throw new Error(privateMarker);
    },
  });
  const result = await client.callTool({
    name: WAKEFLOW_STATUS_PUBLIC_TOOL_NAME,
    arguments: { root: "/workspace", demandId: TASKING_DEMAND_ID },
  });
  equal(result.isError, true);
  deepEqual(JSON.parse(wakeflowMcpTextContent(result)), {
    error: {
      code: "wakeflow-unexpected",
      reason: "unexpected",
    },
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: WAKEFLOW_STATUS_PUBLIC_TOOL_NAME,
  });
  equal(wakeflowMcpTextContent(result).includes(privateMarker), false);
  equal(wakeflowMcpTextContent(result).includes("stack"), false);
});

test("旧领域错误只投影自身稳定字符串字段，不回显消息", async (t) => {
  const privateMarker = "private-legacy-error-marker";
  const client = await connectWakeflowMcpTestClient(t, {
    inspectStatus: async () => {
      throw Object.assign(new Error(privateMarker), {
        code: "legacy-conflict",
        reason: "stream-moved",
        causeCode: "event-store",
        eventAuthority: "unknown",
      });
    },
  });
  const result = await client.callTool({
    name: WAKEFLOW_STATUS_PUBLIC_TOOL_NAME,
    arguments: { root: "/workspace", demandId: TASKING_DEMAND_ID },
  });
  equal(result.isError, true);
  deepEqual(JSON.parse(wakeflowMcpTextContent(result)), {
    error: {
      causeCode: "event-store",
      code: "legacy-conflict",
      eventAuthority: "unknown",
      reason: "stream-moved",
    },
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: WAKEFLOW_STATUS_PUBLIC_TOOL_NAME,
  });
  equal(wakeflowMcpTextContent(result).includes(privateMarker), false);
});

test("旧领域错误字段含home路径时退回固定unexpected信封", async (t) => {
  const homePath = `${os.homedir()}/private-legacy-path`;
  const client = await connectWakeflowMcpTestClient(t, {
    inspectStatus: async () => {
      throw Object.assign(new Error("legacy"), {
        code: "legacy-conflict",
        reason: "stream-moved",
        path: homePath,
      });
    },
  });
  const result = await client.callTool({
    name: WAKEFLOW_STATUS_PUBLIC_TOOL_NAME,
    arguments: { root: "/workspace", demandId: TASKING_DEMAND_ID },
  });
  equal(result.isError, true);
  deepEqual(JSON.parse(wakeflowMcpTextContent(result)).error, {
    code: "wakeflow-unexpected",
    reason: "unexpected",
  });
  equal(wakeflowMcpTextContent(result).includes(homePath), false);
});
