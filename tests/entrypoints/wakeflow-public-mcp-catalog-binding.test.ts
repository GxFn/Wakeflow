import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";

import {
  WAKEFLOW_PUBLIC_MCP_EXECUTOR_FIELDS,
  WAKEFLOW_PUBLIC_TOOL_CATALOG,
} from "../../src/entrypoints/wakeflow-public-mcp-catalog.js";
import {
  registerWakeflowPublicMcpCatalog,
  type WakeflowPublicMcpExecutor,
} from "../../src/entrypoints/wakeflow-public-mcp-tool.js";

type CapturedHandler = (request: unknown) => Promise<CallToolResult>;

interface CapturedRegistration {
  readonly handler: CapturedHandler;
  readonly configuration: Readonly<Record<string, unknown>>;
}

test("登记表把二十个工具绑定到同名executor，且只公开请求Schema", async () => {
  const captured = new Map<string, CapturedRegistration>();
  const server = new McpServer({ name: "catalog-binding-test", version: "1" });
  server.registerTool = ((
    name: string,
    configuration: Readonly<Record<string, unknown>>,
    callback: (request: never, context: never) => CallToolResult | Promise<CallToolResult>,
  ) => {
    captured.set(name, {
      configuration,
      handler: async (request: unknown) =>
        callback(request as never, undefined as never) as Promise<CallToolResult>,
    });
    return Object.freeze({}) as never;
  }) as typeof server.registerTool;

  const calls: Array<Readonly<{ field: string; request: unknown }>> = [];
  const executors: Record<string, WakeflowPublicMcpExecutor<unknown>> = {};
  for (const field of WAKEFLOW_PUBLIC_MCP_EXECUTOR_FIELDS) {
    executors[field] = async (request: unknown): Promise<never> => {
      calls.push(Object.freeze({ field, request }));
      throw new Error(`sentinel:${field}`);
    };
  }
  registerWakeflowPublicMcpCatalog(server, WAKEFLOW_PUBLIC_TOOL_CATALOG, executors);

  equal(WAKEFLOW_PUBLIC_TOOL_CATALOG.tools.length, 20);
  deepEqual(
    [...captured.keys()],
    WAKEFLOW_PUBLIC_TOOL_CATALOG.tools.map((tool) => tool.name),
  );
  for (const tool of WAKEFLOW_PUBLIC_TOOL_CATALOG.tools) {
    const registration = captured.get(tool.name);
    if (registration === undefined) throw new Error(`Missing ${tool.name}.`);
    equal(registration.configuration.title, tool.title);
    equal(registration.configuration.description, tool.description);
    equal(Object.hasOwn(registration.configuration, "outputSchema"), false);
    equal(typeof registration.configuration.inputSchema, "object");
    const request = Object.freeze({ tool: tool.name });
    const result = await registration.handler(request);
    equal(result.isError, true);
    deepEqual(calls.at(-1), { field: tool.executor, request });
    const envelope = JSON.parse((result.content[0] as { readonly text: string }).text) as {
      readonly error: { readonly code: string };
    };
    equal(envelope.error.code, "wakeflow-unexpected");
  }
  equal(calls.length, WAKEFLOW_PUBLIC_TOOL_CATALOG.tools.length);
});
