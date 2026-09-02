import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import { createCodexWakeflowMcpServer } from "../../src/entrypoints/codex-wakeflow-mcp.js";
import { WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME } from "../../src/governance/controller/demand-controller-route-public-contract.js";
import { WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME } from "../../src/governance/demand/publication/demand-publication-public-contract.js";
import { DemandPublicationPublicCoordinatorError } from "../../src/governance/demand/publication/demand-publication-public-coordinator.js";
import {
  cleanupDemandEventSourcingPublicationWorkspaceFixture,
  createDemandEventSourcingPublicationWorkspaceFixture,
  demandEventSourcingPublicationAuthoredDemand,
  PUBLICATION_TODO_ID,
} from "../governance/demand/demand-event-sourcing-publication-service.fixture.js";
import {
  connectWakeflowMcpServerForTest,
  connectWakeflowMcpTestClient,
  wakeflowMcpTextContent,
} from "./wakeflow-public-mcp-server.fixture.js";

const PUBLICATION_DEMAND_ID = "demand_22222222-2222-4222-8222-222222222222";

test("Codex MCP从pending TODO发布Demand并进入首个Controller Route", async () => {
  const fixture = await createDemandEventSourcingPublicationWorkspaceFixture();
  const server = createCodexWakeflowMcpServer("1.0.0-test");
  const { client, close } = await connectWakeflowMcpServerForTest(server);
  try {
    const previewCall = await client.callTool({
      name: WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        mode: "preview",
        todoId: PUBLICATION_TODO_ID,
        demand: demandEventSourcingPublicationAuthoredDemand({ mode: "main" }),
        authorityMembers: fixture.requirementMembers,
      },
    });
    equal(previewCall.isError, undefined);
    const preview = previewCall.structuredContent as {
      readonly mode: "preview";
      readonly plan: Readonly<Record<string, unknown>>;
      readonly planDigest: string;
    };
    equal(preview.mode, "preview");

    const appliedCall = await client.callTool({
      name: WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        mode: "apply",
        plan: preview.plan,
        planDigest: preview.planDigest,
      },
    });
    equal(appliedCall.isError, undefined);
    const applied = appliedCall.structuredContent as {
      readonly mode: "apply";
      readonly status: "current";
      readonly publication: Readonly<{
        readonly publicationAuthority: "current";
        readonly demandId: string;
      }>;
    };
    equal(applied.status, "current");
    equal(applied.publication.publicationAuthority, "current");

    const routeCall = await client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: applied.publication.demandId,
      },
    });
    equal(routeCall.isError, undefined);
    const route = routeCall.structuredContent as {
      readonly route: Readonly<{
        readonly disposition: string;
        readonly frontiers: readonly Readonly<{
          readonly kind: string;
          readonly owner: string;
        }>[];
      }>;
    };
    equal(route.route.disposition, "work-available");
    equal(route.route.frontiers[0]?.kind, "implementation-task-planning");
    equal(route.route.frontiers[0]?.owner, "target-task-planning");

    const replayed = await client.callTool({
      name: WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        mode: "apply",
        plan: preview.plan,
        planDigest: preview.planDigest,
      },
    });
    equal(replayed.isError, undefined);
    deepEqual(replayed.structuredContent, appliedCall.structuredContent);
  } finally {
    await close();
    await cleanupDemandEventSourcingPublicationWorkspaceFixture(fixture);
  }
});

test("Demand Publication MCP保留recoverable authority且不回显root", async (t) => {
  const client = await connectWakeflowMcpTestClient(t, {
    createDemand: async () => {
      throw new DemandPublicationPublicCoordinatorError(
        "apply",
        "wakeflow-demand-event-sourcing-publication-service",
        "recovery-required",
        "recoverable",
      );
    },
  });
  const request = {
    root: "/workspace/private-publication",
    mode: "recover",
    demandId: PUBLICATION_DEMAND_ID,
  } as const;
  const result = await client.callTool({
    name: WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME,
    arguments: request,
  });
  equal(result.isError, true);
  const textContent = wakeflowMcpTextContent(result);
  deepEqual(JSON.parse(textContent), {
    error: {
      causeCode: "wakeflow-demand-event-sourcing-publication-service",
      causeReason: "recovery-required",
      code: "wakeflow-demand-publication-public-coordinator",
      publicationAuthority: "recoverable",
      reason: "apply",
    },
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME,
  });
  equal(textContent.includes(request.root), false);
  equal(textContent.includes("stack"), false);
});
