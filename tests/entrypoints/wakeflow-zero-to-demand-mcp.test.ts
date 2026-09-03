import { equal } from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { createCodexWakeflowMcpServer } from "../../src/entrypoints/codex-wakeflow-mcp.js";
import { WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME } from "../../src/governance/controller/demand-controller-route-public-contract.js";
import { WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME } from "../../src/governance/demand/publication/demand-publication-public-contract.js";
import { WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME } from "../../src/governance/ledger/ledger-authority-public-contract.js";
import { initializeTodoCollection } from "../../src/governance/todo/todo-collection-service.js";
import { WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_TOOL_NAME } from "../../src/governance/todo/todo-intake-publication-public-contract.js";
import { WAKEFLOW_TODO_INSPECTION_PUBLIC_TOOL_NAME } from "../../src/governance/todo/todo-inspection-public-contract.js";
import { materializeWakeflowActiveLayout } from "../../src/workspace/active/wakeflow-active-layout-materialization.js";
import {
  cleanupLedgerAuthorityPublicationFixture,
  createLedgerAuthorityPublicationFixture,
  ORIGINAL_PLAN_PATH,
  REQUIREMENT_DESIGN_PATH,
} from "../governance/ledger/ledger-authority-publication.fixture.js";
import {
  connectWakeflowMcpServerForTest,
  wakeflowMcpTextContent,
} from "./wakeflow-public-mcp-server.fixture.js";

const EXTRA_DOCUMENTS = Object.freeze([
  { role: "code-facts", path: "authority/code-facts.md" },
  { role: "landing-plan", path: "authority/landing-plan.md" },
  { role: "non-goals", path: "authority/non-goals.md" },
  { role: "user-confirmation", path: "authority/user-confirmation.md" },
] as const);

test("公共MCP从Design Ledger到TODO Intake再到Demand Route闭合零到一链", async () => {
  const fixture = await createLedgerAuthorityPublicationFixture();
  for (const document of EXTRA_DOCUMENTS) {
    writeFileSync(
      path.join(fixture.designPath, document.path),
      `# ${document.role}\n`,
      { mode: 0o644 },
    );
  }
  await materializeWakeflowActiveLayout(fixture.workspaceRoot, {
    recoveringFreshLayout: false,
  });
  await initializeTodoCollection(fixture.workspaceRoot, { freshWorkspace: true });
  const connection = await connectWakeflowMcpServerForTest(
    createCodexWakeflowMcpServer("1.0.0-test"),
  );
  try {
    const requirementPreviewCall = await connection.client.callTool({
      name: WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        mode: "preview",
        title: "Public zero-to-demand Requirement",
        designSurfaceId: "surface_33333333-3333-4333-8333-333333333333",
        documents: [
          { role: "original-plan", path: ORIGINAL_PLAN_PATH },
          { role: "requirement-design", path: REQUIREMENT_DESIGN_PATH },
          ...EXTRA_DOCUMENTS,
        ],
      },
    });
    equal(
      requirementPreviewCall.isError,
      undefined,
      wakeflowMcpTextContent(requirementPreviewCall),
    );
    const requirementPreview = requirementPreviewCall.structuredContent as {
      readonly plan: Readonly<Record<string, unknown>>;
      readonly planDigest: string;
    };
    const requirementApplyCall = await connection.client.callTool({
      name: WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        mode: "apply",
        plan: requirementPreview.plan,
        planDigest: requirementPreview.planDigest,
      },
    });
    equal(
      requirementApplyCall.isError,
      undefined,
      wakeflowMcpTextContent(requirementApplyCall),
    );
    const requirement = requirementApplyCall.structuredContent as {
      readonly publication: Readonly<{
        readonly memberReferences: readonly Readonly<{
          readonly recordId: string;
          readonly memberPath: string;
        }>[];
      }>;
    };

    const intakePreviewCall = await connection.client.callTool({
      name: WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        mode: "preview",
        intake: {
          demandType: "requirement",
          priority: "P1",
          originWindowId: "window_66666666-6666-4666-8666-666666666666",
          summary: "Implement the public zero-to-demand Requirement",
          intakeRationale: "The confirmed Requirement is ready for Demand publication.",
          readiness: { status: "ready" },
          autoClaim: false,
          testingDecision: {
            mode: "controller-only",
            summary: "Controller validates focused implementation checks.",
          },
          authorityMembers: requirement.publication.memberReferences.map(
            (reference) => ({
              recordId: reference.recordId,
              memberPath: reference.memberPath,
            }),
          ),
        },
      },
    });
    equal(
      intakePreviewCall.isError,
      undefined,
      wakeflowMcpTextContent(intakePreviewCall),
    );
    const intakePreview = intakePreviewCall.structuredContent as {
      readonly plan: Readonly<Record<string, unknown>>;
      readonly planDigest: string;
    };
    const intakeApplyCall = await connection.client.callTool({
      name: WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        mode: "apply",
        plan: intakePreview.plan,
        planDigest: intakePreview.planDigest,
      },
    });
    equal(
      intakeApplyCall.isError,
      undefined,
      wakeflowMcpTextContent(intakeApplyCall),
    );
    const intake = intakeApplyCall.structuredContent as {
      readonly publication: Readonly<{ readonly todoId: string }>;
    };

    const todoInspectionCall = await connection.client.callTool({
      name: WAKEFLOW_TODO_INSPECTION_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        view: "item",
        todoId: intake.publication.todoId,
      },
    });
    equal(
      todoInspectionCall.isError,
      undefined,
      wakeflowMcpTextContent(todoInspectionCall),
    );
    const inspectedTodo = todoInspectionCall.structuredContent as {
      readonly item: Readonly<{
        readonly intake: Readonly<{
          readonly authorityRefs: readonly unknown[];
        }>;
      }>;
    };
    equal(inspectedTodo.item.intake.authorityRefs.length, 6);

    const demandPreviewCall = await connection.client.callTool({
      name: WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        mode: "preview",
        todoId: intake.publication.todoId,
        demand: {
          title: "Public zero-to-demand",
          goal: "Implement the confirmed Requirement through the new TS chain.",
          completionDefinition: "The confirmed implementation and focused checks are accepted.",
          executionPlacement: { mode: "main" },
        },
      },
    });
    equal(
      demandPreviewCall.isError,
      undefined,
      wakeflowMcpTextContent(demandPreviewCall),
    );
    const demandPreview = demandPreviewCall.structuredContent as {
      readonly plan: Readonly<Record<string, unknown>>;
      readonly planDigest: string;
    };
    const demandApplyCall = await connection.client.callTool({
      name: WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        mode: "apply",
        plan: demandPreview.plan,
        planDigest: demandPreview.planDigest,
      },
    });
    equal(
      demandApplyCall.isError,
      undefined,
      wakeflowMcpTextContent(demandApplyCall),
    );
    const demand = demandApplyCall.structuredContent as {
      readonly publication: Readonly<{ readonly demandId: string }>;
    };

    const routeCall = await connection.client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: demand.publication.demandId,
      },
    });
    equal(routeCall.isError, undefined, wakeflowMcpTextContent(routeCall));
    const route = routeCall.structuredContent as {
      readonly route: Readonly<{
        readonly disposition: string;
        readonly frontiers: readonly Readonly<{ readonly kind: string }>[];
      }>;
    };
    equal(route.route.disposition, "work-available");
    equal(
      route.route.frontiers.some(
        (frontier) => frontier.kind === "implementation-task-planning",
      ),
      true,
    );
    const serialized = JSON.stringify({
      requirement,
      intake,
      inspectedTodo,
      demand,
      route,
    });
    equal(serialized.includes(fixture.workspacePath), false);
    equal(serialized.includes("authorityMembers"), false);
  } finally {
    await connection.close();
    await cleanupLedgerAuthorityPublicationFixture(fixture);
  }
});
