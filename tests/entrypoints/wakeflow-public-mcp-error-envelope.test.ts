import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import { parseSha256Digest } from "../../src/foundation/crypto/sha256.js";
import { WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME } from "../../src/governance/controller/demand-controller-route-public-contract.js";
import { WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME } from "../../src/governance/delivery/target-host-effect-claim-public-contract.js";
import { TargetHostEffectClaimPublicCoordinatorError } from "../../src/governance/delivery/target-host-effect-claim-public-coordinator.js";
import { WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME } from "../../src/governance/lifecycle/demand-completion-public-contract.js";
import { DemandCompletionPublicCoordinatorError } from "../../src/governance/lifecycle/demand-completion-public-coordinator.js";
import { DemandControllerRoutePublicCoordinatorError } from "../../src/governance/controller/demand-controller-route-public-coordinator.js";
import { WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME, WakeflowMaintenancePublicContractError } from "../../src/workspace/maintenance/wakeflow-maintenance-public-contract.js";
import { createTaskPackageFixture, TASKING_DEMAND_ID } from "../governance/tasking/task-package.fixture.js";
import {
  connectWakeflowMcpTestClient,
  wakeflowMcpTextContent,
} from "./wakeflow-public-mcp-server.fixture.js";

const ZERO_DIGEST = parseSha256Digest(`sha256:${"0".repeat(64)}`);
const WINDOW_ID = "window_11111111-1111-4111-8111-111111111111";
const BINDING_ID =
  "window_binding_22222222-2222-4222-8222-222222222222";
const DELIVERY_ID =
  "target-delivery_33333333-3333-4333-8333-333333333333";

function hostEffectClaimRequest() {
  const taskPackage = createTaskPackageFixture();
  if (taskPackage.workType !== "implementation") {
    throw new Error("Expected an implementation TaskPackage fixture.");
  }
  return {
    root: "/workspace/private-claim",
    workType: "implementation" as const,
    demandId: taskPackage.demandId,
    targetTaskId: taskPackage.targetTaskId,
    targetDeliveryId: DELIVERY_ID,
    intentDigest: ZERO_DIGEST,
    observation: {
      kind: "WakeflowAgentHostWindowObservation",
      schemaVersion: 1,
      source: "agent-host-inspection-result",
      hostId: "codex",
      windowId: WINDOW_ID,
      bindingId: BINDING_ID,
      handle: {
        kind: "codex-thread",
        value: "private-target-host-handle",
      },
      attestedRoot: {
        status: "matches-configured-root",
        logicalRoot: {
          kind: "repository",
          repositoryId: taskPackage.assignment.repositoryId,
        },
        configuredPlacement: "Product",
      },
      observedAt: "2026-09-01T10:00:00.000Z",
    },
  } as const;
}

test("Workspace注册组只公开合同错误字段", async (t) => {
  const client = await connectWakeflowMcpTestClient(t, {
    executeMaintenance: async () => {
      throw new WakeflowMaintenancePublicContractError("shape", "$request");
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
      code: "wakeflow-maintenance-public-contract",
      path: "$request",
      reason: "shape",
    },
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
  });
  equal(wakeflowMcpTextContent(result).includes("private-maintenance"), false);
});

test("Authority注册组保留稳定cause且不回显root", async (t) => {
  const client = await connectWakeflowMcpTestClient(t, {
    inspectDemandRoute: async () => {
      throw new DemandControllerRoutePublicCoordinatorError(
        "route",
        "wakeflow-demand-operation-authority-context",
        "demand-authority",
      );
    },
  });
  const root = "/workspace/private-demand-route";
  const result = await client.callTool({
    name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
    arguments: { root, demandId: TASKING_DEMAND_ID },
  });
  equal(result.isError, true);
  deepEqual(JSON.parse(wakeflowMcpTextContent(result)), {
    error: {
      causeCode: "wakeflow-demand-operation-authority-context",
      causeReason: "demand-authority",
      code: "wakeflow-demand-controller-route-public-coordinator",
      reason: "route",
    },
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
  });
  equal(wakeflowMcpTextContent(result).includes(root), false);
});

test("Execution注册组保留Claim与Event双authority", async (t) => {
  const client = await connectWakeflowMcpTestClient(t, {
    claimTargetHostEffect: async () => {
      throw new TargetHostEffectClaimPublicCoordinatorError(
        "claim",
        "wakeflow-window-work-claim-store",
        "write",
        "current",
        "unknown",
      );
    },
  });
  const request = hostEffectClaimRequest();
  const result = await client.callTool({
    name: WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME,
    arguments: request,
  });
  equal(result.isError, true);
  deepEqual(JSON.parse(wakeflowMcpTextContent(result)), {
    error: {
      causeCode: "wakeflow-window-work-claim-store",
      causeReason: "write",
      claimAuthority: "current",
      code: "wakeflow-target-host-effect-claim-public-coordinator",
      eventAuthority: "unknown",
      reason: "claim",
    },
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME,
  });
  equal(wakeflowMcpTextContent(result).includes(request.root), false);
  equal(
    wakeflowMcpTextContent(result).includes(request.observation.handle.value),
    false,
  );
});

test("Review注册组保留Completion event authority", async (t) => {
  const client = await connectWakeflowMcpTestClient(t, {
    completeDemand: async () => {
      throw new DemandCompletionPublicCoordinatorError(
        "preview",
        "wakeflow-demand-completion-service",
        "route",
        "unchanged",
      );
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
      causeCode: "wakeflow-demand-completion-service",
      causeReason: "route",
      code: "wakeflow-demand-completion-public-coordinator",
      eventAuthority: "unchanged",
      reason: "preview",
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
    inspectDemandRoute: async () => {
      throw new Error(privateMarker);
    },
  });
  const result = await client.callTool({
    name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
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
    tool: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
  });
  equal(wakeflowMcpTextContent(result).includes(privateMarker), false);
  equal(wakeflowMcpTextContent(result).includes("stack"), false);
});
