import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import { createCodexWakeflowMcpServer } from "../../src/entrypoints/codex-wakeflow-mcp.js";
import { WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_TOOL_NAME } from "../../src/governance/todo/todo-intake-publication-public-contract.js";
import { TodoIntakePublicationPublicCoordinatorError } from "../../src/governance/todo/todo-intake-publication-public-coordinator.js";
import {
  cleanupTodoIntakePublicationFixture,
  createTodoIntakePublicationFixture,
  todoIntakePublicationInput,
} from "../governance/todo/todo-intake-publication.fixture.js";
import {
  connectWakeflowMcpServerForTest,
  connectWakeflowMcpTestClient,
  wakeflowMcpTextContent,
} from "./wakeflow-public-mcp-server.fixture.js";

test("Codex MCP以exact preview/apply/recover创建TODO Intake", async () => {
  const fixture = await createTodoIntakePublicationFixture();
  const connection = await connectWakeflowMcpServerForTest(
    createCodexWakeflowMcpServer("1.0.0-test"),
  );
  try {
    const previewCall = await connection.client.callTool({
      name: WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.ledger.workspacePath,
        mode: "preview",
        intake: todoIntakePublicationInput(fixture),
      },
    });
    equal(previewCall.isError, undefined, wakeflowMcpTextContent(previewCall));
    const preview = previewCall.structuredContent as {
      readonly mode: "preview";
      readonly plan: Readonly<Record<string, unknown>>;
      readonly planDigest: string;
    };

    const applyCall = await connection.client.callTool({
      name: WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.ledger.workspacePath,
        mode: "apply",
        plan: preview.plan,
        planDigest: preview.planDigest,
      },
    });
    equal(applyCall.isError, undefined, wakeflowMcpTextContent(applyCall));
    const applied = applyCall.structuredContent as {
      readonly publication: Readonly<{
        readonly todoId: string;
        readonly disposition: string;
      }>;
    };
    equal(applied.publication.todoId.startsWith("todo_"), true);
    equal(applied.publication.disposition, "published");
    const serialized = JSON.stringify(applied);
    equal(serialized.includes(fixture.ledger.workspacePath), false);
    equal(serialized.includes("authorityRefs"), false);

    const recoverCall = await connection.client.callTool({
      name: WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.ledger.workspacePath,
        mode: "recover",
        plan: preview.plan,
        planDigest: preview.planDigest,
      },
    });
    equal(recoverCall.isError, undefined, wakeflowMcpTextContent(recoverCall));
  } finally {
    await connection.close();
    await cleanupTodoIntakePublicationFixture(fixture);
  }
});

test("TODO Intake MCP错误信封保留recoverable publication authority", async (t) => {
  const client = await connectWakeflowMcpTestClient(t, {
    intakeTodo: async () => {
      throw new TodoIntakePublicationPublicCoordinatorError(
        "apply",
        "wakeflow-todo-intake-publication-application-service",
        "recovery-required",
        "recoverable",
      );
    },
  });
  const root = "/workspace/private-todo-intake";
  const result = await client.callTool({
    name: WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_TOOL_NAME,
    arguments: {
      root,
      mode: "apply",
      plan: { kind: "placeholder" },
      planDigest: `sha256:${"0".repeat(64)}`,
    },
  });
  equal(result.isError, true);
  const text = wakeflowMcpTextContent(result);
  deepEqual(JSON.parse(text), {
    error: {
      causeCode: "wakeflow-todo-intake-publication-application-service",
      causeReason: "recovery-required",
      code: "wakeflow-todo-intake-publication-public-coordinator",
      publicationAuthority: "recoverable",
      reason: "apply",
    },
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_TOOL_NAME,
  });
  equal(text.includes(root), false);
});
