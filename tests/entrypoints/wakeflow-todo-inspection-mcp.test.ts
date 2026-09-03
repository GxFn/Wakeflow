import { deepEqual, equal } from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createCodexWakeflowMcpServer } from "../../src/entrypoints/codex-wakeflow-mcp.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../src/foundation/time/utc-instant.js";
import {
  appendTodoItem,
  initializeTodoCollection,
} from "../../src/governance/todo/todo-collection-service.js";
import { WAKEFLOW_TODO_INSPECTION_PUBLIC_TOOL_NAME } from "../../src/governance/todo/todo-inspection-public-contract.js";
import { TodoInspectionPublicCoordinatorError } from "../../src/governance/todo/todo-inspection-public-coordinator.js";
import { materializeWakeflowActiveLayout } from "../../src/workspace/active/wakeflow-active-layout-materialization.js";
import { todoIntakeDraft } from "../governance/todo/todo-intake.fixture.js";
import {
  connectWakeflowMcpServerForTest,
  connectWakeflowMcpTestClient,
  wakeflowMcpTextContent,
} from "./wakeflow-public-mcp-server.fixture.js";

const TODO_ID = "todo_b1111111-1111-4111-8111-111111111111";

async function createFixture(): Promise<string> {
  const rootPath = mkdtempSync(
    path.join(os.tmpdir(), "wakeflow-todo-inspection-mcp-"),
  );
  const root = await RootedDirectory.open(rootPath);
  try {
    await materializeWakeflowActiveLayout(root, {
      recoveringFreshLayout: false,
    });
    await initializeTodoCollection(root, { freshWorkspace: true });
    await appendTodoItem(root, todoIntakeDraft(TODO_ID), {
      clock: () => parseUtcInstant("2026-09-03T09:00:00.000Z"),
    });
  } finally {
    await root.close();
  }
  return rootPath;
}

test("Codex MCP有界查询TODO summary与exact item", async () => {
  const rootPath = await createFixture();
  const connection = await connectWakeflowMcpServerForTest(
    createCodexWakeflowMcpServer("1.0.0-test"),
  );
  try {
    const listCall = await connection.client.callTool({
      name: WAKEFLOW_TODO_INSPECTION_PUBLIC_TOOL_NAME,
      arguments: { root: rootPath, view: "list" },
    });
    equal(listCall.isError, undefined, wakeflowMcpTextContent(listCall));
    const list = listCall.structuredContent as {
      readonly view: "list";
      readonly items: readonly Readonly<{ readonly todoId: string }>[];
    };
    deepEqual(list.items.map((entry) => entry.todoId), [TODO_ID]);

    const itemCall = await connection.client.callTool({
      name: WAKEFLOW_TODO_INSPECTION_PUBLIC_TOOL_NAME,
      arguments: { root: rootPath, view: "item", todoId: TODO_ID },
    });
    equal(itemCall.isError, undefined, wakeflowMcpTextContent(itemCall));
    const item = itemCall.structuredContent as {
      readonly view: "item";
      readonly item: Readonly<{
        readonly todoId: string;
        readonly intake: Readonly<{ readonly authorityRefs: readonly unknown[] }>;
      }>;
    };
    equal(item.item.todoId, TODO_ID);
    equal(item.item.intake.authorityRefs.length > 0, true);
    const serialized = JSON.stringify({ list, item });
    equal(serialized.includes(rootPath), false);
    equal(serialized.includes("projection"), false);
    equal(serialized.includes("stateRootRef"), false);
  } finally {
    await connection.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("TODO Inspection MCP错误信封保留stale token分类且不回显root", async (t) => {
  const client = await connectWakeflowMcpTestClient(t, {
    inspectTodo: async () => {
      throw new TodoInspectionPublicCoordinatorError(
        "inspection",
        "wakeflow-todo-inspection-query",
        "stale-page-token",
      );
    },
  });
  const root = "/workspace/private-todo-inspection";
  const result = await client.callTool({
    name: WAKEFLOW_TODO_INSPECTION_PUBLIC_TOOL_NAME,
    arguments: { root, view: "list" },
  });
  equal(result.isError, true);
  const text = wakeflowMcpTextContent(result);
  deepEqual(JSON.parse(text), {
    error: {
      causeCode: "wakeflow-todo-inspection-query",
      causeReason: "stale-page-token",
      code: "wakeflow-todo-inspection-public-coordinator",
      reason: "inspection",
    },
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: WAKEFLOW_TODO_INSPECTION_PUBLIC_TOOL_NAME,
  });
  equal(text.includes(root), false);
  equal(text.includes("stack"), false);
});
