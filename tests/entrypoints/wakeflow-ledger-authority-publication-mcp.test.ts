import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import { createClaudeCodeWakeflowMcpServer } from "../../src/entrypoints/claude-code-wakeflow-mcp.js";
import { createCodexWakeflowMcpServer } from "../../src/entrypoints/codex-wakeflow-mcp.js";
import {
  WAKEFLOW_CONFIRMATION_PUBLICATION_PUBLIC_TOOL_NAME,
  WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
} from "../../src/governance/ledger/ledger-authority-public-contract.js";
import { LedgerAuthorityPublicationPublicCoordinatorError } from "../../src/governance/ledger/ledger-authority-public-coordinator.js";
import {
  cleanupLedgerAuthorityPublicationFixture,
  confirmationPublicationInput,
  createLedgerAuthorityPublicationFixture,
  requirementPublicationInput,
} from "../governance/ledger/ledger-authority-publication.fixture.js";
import {
  connectWakeflowMcpServerForTest,
  connectWakeflowMcpTestClient,
  wakeflowMcpTextContent,
} from "./wakeflow-public-mcp-server.fixture.js";

test("Codex与Claude MCP分别发布Requirement和Confirmation权威", async () => {
  const fixture = await createLedgerAuthorityPublicationFixture();
  try {
    const codexConnection = await connectWakeflowMcpServerForTest(
      createCodexWakeflowMcpServer("1.0.0-test"),
    );
    try {
      const previewCall = await codexConnection.client.callTool({
        name: WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
        arguments: {
          root: fixture.workspacePath,
          mode: "preview",
          ...requirementPublicationInput(),
        },
      });
      equal(previewCall.isError, undefined, wakeflowMcpTextContent(previewCall));
      const preview = previewCall.structuredContent as {
        readonly mode: "preview";
        readonly plan: Readonly<Record<string, unknown>>;
        readonly planDigest: string;
      };
      equal(preview.mode, "preview");

      const applyCall = await codexConnection.client.callTool({
        name: WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
        arguments: {
          root: fixture.workspacePath,
          mode: "apply",
          plan: preview.plan,
          planDigest: preview.planDigest,
        },
      });
      equal(applyCall.isError, undefined, wakeflowMcpTextContent(applyCall));
      const applied = applyCall.structuredContent as {
        readonly mode: "apply";
        readonly status: "current";
        readonly publication: Readonly<{
          readonly disposition: string;
          readonly requirementId: string;
        }>;
      };
      equal(applied.status, "current");
      equal(applied.publication.disposition, "published");
      equal(applied.publication.requirementId.startsWith("requirement_"), true);
      const serialized = JSON.stringify(applied);
      equal(serialized.includes(fixture.workspacePath), false);
      equal(serialized.includes(fixture.designPath), false);
      equal(serialized.includes("loaded"), false);
      equal(serialized.includes("bytes"), false);

      const recoverCall = await codexConnection.client.callTool({
        name: WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
        arguments: {
          root: fixture.workspacePath,
          mode: "recover",
          plan: preview.plan,
          planDigest: preview.planDigest,
        },
      });
      equal(
        recoverCall.isError,
        undefined,
        wakeflowMcpTextContent(recoverCall),
      );
      const recovered = recoverCall.structuredContent as {
        readonly mode: "recover";
        readonly publication: Readonly<{ readonly disposition: string }>;
      };
      equal(recovered.mode, "recover");
      equal(recovered.publication.disposition, "current");
    } finally {
      await codexConnection.close();
    }

    const claudeConnection = await connectWakeflowMcpServerForTest(
      createClaudeCodeWakeflowMcpServer("1.0.0-test"),
    );
    try {
      const previewCall = await claudeConnection.client.callTool({
        name: WAKEFLOW_CONFIRMATION_PUBLICATION_PUBLIC_TOOL_NAME,
        arguments: {
          root: fixture.workspacePath,
          mode: "preview",
          ...confirmationPublicationInput(),
        },
      });
      equal(previewCall.isError, undefined, wakeflowMcpTextContent(previewCall));
      const preview = previewCall.structuredContent as {
        readonly plan: Readonly<Record<string, unknown>>;
        readonly planDigest: string;
      };

      const applyCall = await claudeConnection.client.callTool({
        name: WAKEFLOW_CONFIRMATION_PUBLICATION_PUBLIC_TOOL_NAME,
        arguments: {
          root: fixture.workspacePath,
          mode: "apply",
          plan: preview.plan,
          planDigest: preview.planDigest,
        },
      });
      equal(applyCall.isError, undefined, wakeflowMcpTextContent(applyCall));
      const applied = applyCall.structuredContent as {
        readonly status: "current";
        readonly publication: Readonly<{
          readonly confirmationId: string;
          readonly demandId: string;
        }>;
      };
      equal(applied.status, "current");
      equal(
        applied.publication.confirmationId.startsWith("confirmation_"),
        true,
      );
      equal(applied.publication.demandId.startsWith("demand_"), true);
      const serialized = JSON.stringify(applied);
      equal(serialized.includes(fixture.workspacePath), false);
      equal(serialized.includes(fixture.designPath), false);
    } finally {
      await claudeConnection.close();
    }
  } finally {
    await cleanupLedgerAuthorityPublicationFixture(fixture);
  }
});

test("Ledger Authority MCP保留recoverable效果权威且不回显root", async (t) => {
  const client = await connectWakeflowMcpTestClient(t, {
    publishRequirement: async () => {
      throw new LedgerAuthorityPublicationPublicCoordinatorError(
        "apply",
        "wakeflow-ledger-authority-publication-application-service",
        "recovery-required",
        "recoverable",
      );
    },
  });
  const root = "/workspace/private-ledger-authority";
  const result = await client.callTool({
    name: WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
    arguments: {
      root,
      mode: "apply",
      plan: { intent: {} },
      planDigest: `sha256:${"0".repeat(64)}`,
    },
  });
  equal(result.isError, true);
  const text = wakeflowMcpTextContent(result);
  deepEqual(JSON.parse(text), {
    error: {
      causeCode: "wakeflow-ledger-authority-publication-application-service",
      causeReason: "recovery-required",
      code: "wakeflow-ledger-authority-publication-public-coordinator",
      publicationAuthority: "recoverable",
      reason: "apply",
    },
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
  });
  equal(text.includes(root), false);
  equal(text.includes("stack"), false);
});
