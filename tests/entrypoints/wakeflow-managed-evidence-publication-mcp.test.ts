import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import { createCodexWakeflowMcpServer } from "../../src/entrypoints/codex-wakeflow-mcp.js";
import { WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_TOOL_NAME } from "../../src/governance/evidence/managed-evidence-public-contract.js";
import { ManagedEvidencePublicCoordinatorError } from "../../src/governance/evidence/managed-evidence-public-coordinator.js";
import {
  cleanupManagedEvidenceCapturePlanningWorkspaceFixture,
  createManagedEvidenceCapturePlanningWorkspaceFixture,
  EVIDENCE_DEMAND_ID,
  EVIDENCE_REPOSITORY_ID,
} from "../governance/evidence/managed-evidence-capture-planning-service.fixture.js";
import {
  connectWakeflowMcpServerForTest,
  connectWakeflowMcpTestClient,
  wakeflowMcpTextContent,
} from "./wakeflow-public-mcp-server.fixture.js";

test("Codex MCP以preview/apply记录Evidence且只返回metadata receipt", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  const server = createCodexWakeflowMcpServer("1.0.0-test");
  const { client, close } = await connectWakeflowMcpServerForTest(server);
  try {
    const previewCall = await client.callTool({
      name: WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.publication.workspacePath,
        mode: "preview",
        demandId: EVIDENCE_DEMAND_ID,
        selection: {
          evidenceType: "test-output",
          source: {
            root: {
              kind: "repository",
              repositoryId: EVIDENCE_REPOSITORY_ID,
            },
            path: "artifacts/test-run/logs/report.txt",
            resourceType: "file",
          },
          sensitivity: "internal",
          opaqueContentPolicy: "reject",
        },
      },
    });
    equal(previewCall.isError, undefined, wakeflowMcpTextContent(previewCall));
    const preview = previewCall.structuredContent as {
      readonly mode: "preview";
      readonly plan: Readonly<Record<string, unknown>>;
      readonly planDigest: string;
    };
    equal(preview.mode, "preview");

    const applyCall = await client.callTool({
      name: WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.publication.workspacePath,
        mode: "apply",
        demandId: EVIDENCE_DEMAND_ID,
        plan: preview.plan,
        planDigest: preview.planDigest,
      },
    });
    equal(applyCall.isError, undefined, wakeflowMcpTextContent(applyCall));
    const applied = applyCall.structuredContent as {
      readonly mode: "apply";
      readonly status: "current";
      readonly publication: Readonly<{
        readonly demandId: string;
        readonly evidenceId: string;
        readonly manifestDigest: string;
        readonly payloadArtifactDigest: string;
      }>;
    };
    equal(applied.status, "current");
    equal(applied.publication.demandId, EVIDENCE_DEMAND_ID);
    equal(applied.publication.evidenceId.startsWith("evidence_"), true);
    const serialized = JSON.stringify(applied);
    equal(serialized.includes(fixture.publication.workspacePath), false);
    equal(serialized.includes(fixture.repositoryRoot), false);
    equal(serialized.includes("artifacts/test-run"), false);
    equal(serialized.includes("payloadVerification"), false);
    equal(serialized.includes("bytes"), false);

    const recoveredCall = await client.callTool({
      name: WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.publication.workspacePath,
        mode: "recover",
        demandId: EVIDENCE_DEMAND_ID,
      },
    });
    equal(
      recoveredCall.isError,
      undefined,
      wakeflowMcpTextContent(recoveredCall),
    );
    const recovered = recoveredCall.structuredContent as {
      readonly mode: "recover";
      readonly status: "healthy";
    };
    equal(recovered.status, "healthy");
  } finally {
    await close();
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("Managed Evidence MCP保留recoverable authority且不回显root", async (t) => {
  const client = await connectWakeflowMcpTestClient(t, {
    recordManagedEvidence: async () => {
      throw new ManagedEvidencePublicCoordinatorError(
        "apply",
        "wakeflow-managed-evidence-publication-application-service",
        "recovery-required",
        "recoverable",
      );
    },
  });
  const request = {
    root: "/workspace/private-evidence",
    mode: "recover",
    demandId: EVIDENCE_DEMAND_ID,
  } as const;
  const result = await client.callTool({
    name: WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_TOOL_NAME,
    arguments: request,
  });
  equal(result.isError, true);
  const text = wakeflowMcpTextContent(result);
  deepEqual(JSON.parse(text), {
    error: {
      causeCode: "wakeflow-managed-evidence-publication-application-service",
      causeReason: "recovery-required",
      code: "wakeflow-managed-evidence-public-coordinator",
      publicationAuthority: "recoverable",
      reason: "apply",
    },
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_TOOL_NAME,
  });
  equal(text.includes(request.root), false);
  equal(text.includes("stack"), false);
});
