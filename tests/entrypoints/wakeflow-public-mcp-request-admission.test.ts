import { deepEqual, equal } from "node:assert/strict";
import { type TestContext, test } from "node:test";

import type { CallToolResult, Client } from "@modelcontextprotocol/client";
import {
  fromJsonSchema,
  type JsonSchemaType,
  type JsonSchemaValidator,
  type jsonSchemaValidator,
  McpServer,
} from "@modelcontextprotocol/server";

import { WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME } from "../../src/capabilities/workspace/maintain-workspace.js";
import { executeClaudeCodeWakeflowMaintenance } from "../../src/entrypoints/claude-code-wakeflow-maintenance.js";
import { createClaudeCodeWakeflowMcpServer } from "../../src/entrypoints/claude-code-wakeflow-mcp.js";
import { WAKEFLOW_PUBLIC_TOOL_CATALOG } from "../../src/entrypoints/wakeflow-public-mcp-catalog.js";
import { type JsonValue, parseJsonValue } from "../../src/foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../src/foundation/schema/runtime-json-schema.js";
import { publicToolDefinition } from "../../src/kernel/tool-registry.js";
import { useDisposableDurability } from "../support/disposable-durability.js";
import { disposableRoot } from "../support/temp-root.js";
import {
  connectWakeflowMcpServerForTest,
  connectWakeflowMcpTestClient,
  wakeflowMcpTextContent,
} from "./wakeflow-public-mcp-server.fixture.js";

useDisposableDurability();

/**
 * 3 级（公共工具）：公共请求经真实的 SDK 路径准入（R13；a-spec §7 风险 1，2026-11-27 裁定）。Claude Code
 * 组合根经官方内存 Transport 调用。SDK 的校验器放行，请求只在 Wakeflow 自己那里准入一次——命令外壳的被动
 * JSON 解析、切片合同的请求 Schema——所以 Schema 不认的请求拿到结构化的 `invalid-request`（`path` 与
 * `details.schema`），不再是 SDK 的一行 "Input validation error … Wakeflow tool input is invalid at …" 文本；
 * `tools/list` 与让 SDK 自己校验时逐字节相同。进程内的切片测试从 executor 下面调用，看不到这一层。
 */

const STATUS = "wakeflow_status";
const LONE_SURROGATE = "\uD800";

async function connectClaudeCode(t: TestContext): Promise<Client> {
  const { client, close } = await connectWakeflowMcpServerForTest(
    createClaudeCodeWakeflowMcpServer("1.0.0-test"),
  );
  t.after(close);
  return client;
}

/** 错误信封：工具名与 `error` 里的稳定字段。 */
function envelopeOf(result: unknown): Readonly<Record<string, unknown>> {
  const call = result as CallToolResult;
  equal(call.isError, true);
  const envelope = JSON.parse(wakeflowMcpTextContent(call)) as Record<string, unknown>;
  equal(envelope.kind, "WakeflowMcpError");
  equal(envelope.status, "error");
  return envelope;
}

function refusalOf(result: unknown): unknown {
  return envelopeOf(result).error;
}

function schemaRefusal(path: string, schema: string) {
  return { code: "invalid-request", details: { schema }, path, reason: "schema", retryable: false };
}

function notJsonRefusal(path: string) {
  return { code: "invalid-request", path, reason: "not-json", retryable: false };
}

/** 改动之前的注册方式：SDK 经这个提供者在回调之前跑请求 Schema（2026-11-27 之前的入口）。 */
const VALIDATING_PROVIDER: jsonSchemaValidator = Object.freeze({
  getValidator<T>(schema: JsonSchemaType): JsonSchemaValidator<T> {
    const validate = createRuntimeJsonSchemaValidator<T>(schema);
    return (input: unknown) => {
      let json: JsonValue;
      try {
        json = parseJsonValue(input, "$request");
      } catch {
        return { valid: false, data: undefined, errorMessage: "not passive JSON" };
      }
      const result = validate(json);
      return result.ok
        ? { valid: true, data: result.value, errorMessage: undefined }
        : { valid: false, data: undefined, errorMessage: result.detail };
    };
  },
});

test("tools/list publishes byte-identical tools whether or not the SDK validates the request", async (t) => {
  const reference = new McpServer({ name: "reference", version: "1.0.0-test" });
  for (const registration of WAKEFLOW_PUBLIC_TOOL_CATALOG.tools) {
    const definition = publicToolDefinition(registration);
    reference.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: fromJsonSchema<unknown>(
          definition.inputSchema as JsonSchemaType,
          VALIDATING_PROVIDER,
        ),
        annotations: definition.annotations,
      },
      async () => ({ content: [] }),
    );
  }
  const validated = await connectWakeflowMcpServerForTest(reference);
  t.after(validated.close);
  const production = await connectClaudeCode(t);
  const expected = (await validated.client.listTools()).tools;
  const listed = (await production.listTools()).tools;
  equal(listed.length, WAKEFLOW_PUBLIC_TOOL_CATALOG.tools.length);
  equal(JSON.stringify(listed), JSON.stringify(expected));
});

test("wakeflow_status through the SDK: a valid call reaches the slice; Schema-invalid, extra-field and non-JSON calls get the structured invalid-request refusal", async (t) => {
  const root = disposableRoot(t, "wakeflow-request-admission-");
  const client = await connectClaudeCode(t);
  const call = (args: Record<string, unknown>) =>
    client.callTool({ name: STATUS, arguments: args });

  // A valid request is admitted and answered by the slice: an empty directory has no config.
  deepEqual(refusalOf(await call({ root })), {
    causeReason: "source",
    code: "precondition-failed",
    path: "$request.root",
    reason: "config-authority",
    retryable: false,
  });
  deepEqual(envelopeOf(await call({ root, demandId: "demand_nope" })), {
    error: schemaRefusal("$request/demandId", "pattern"),
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: STATUS,
  });
  deepEqual(
    refusalOf(await call({ root, extra: true })),
    schemaRefusal("$request", "additional:extra"),
  );
  deepEqual(
    refusalOf(await call({ root, detail: "everything" })),
    schemaRefusal("$request/detail", "enum:full.summary"),
  );
  // Not passive JSON: a lone surrogate also arrives over stdio (JSON text may escape one); NaN only
  // through the in-memory transport, which hands objects over by reference.
  deepEqual(
    refusalOf(await call({ root: `${root}${LONE_SURROGATE}` })),
    notJsonRefusal("$request/root"),
  );
  deepEqual(refusalOf(await call({ root, detail: Number.NaN })), notJsonRefusal("$request/detail"));
});

test("wakeflow_maintain_workspace through the SDK: a valid preview is answered; Schema-invalid, extra-field, mismatched-body and non-JSON calls get the structured invalid-request refusal", async (t) => {
  const root = disposableRoot(t, "wakeflow-request-admission-");
  const client = await connectClaudeCode(t);
  const call = (args: Record<string, unknown>) =>
    client.callTool({ name: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME, arguments: args });
  const reconcile = { root, mode: "preview", action: "reconcile", request: {} };

  const preview = (await call(reconcile)) as CallToolResult;
  equal(preview.isError, undefined);
  const content = preview.structuredContent as Readonly<Record<string, unknown>> | undefined;
  deepEqual(
    { kind: content?.kind, status: content?.status, blockerCodes: content?.blockerCodes },
    {
      kind: "WakeflowMaintenancePublicPreviewResult",
      status: "blocked",
      blockerCodes: [
        "current-config-unavailable",
        "desired-config-unavailable",
        "window-runtime-missing",
      ],
    },
  );
  deepEqual(
    envelopeOf(await call({ root, mode: "recover", operationId: "maintenance_operation_nope" })),
    {
      error: schemaRefusal("$request/operationId", "pattern"),
      kind: "WakeflowMcpError",
      schemaVersion: 1,
      status: "error",
      tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    },
  );
  deepEqual(
    refusalOf(await call({ ...reconcile, extra: true })),
    schemaRefusal("$request", "additional:extra"),
  );
  deepEqual(
    refusalOf(await call({ ...reconcile, request: { desiredConfig: {} } })),
    schemaRefusal("$request/action", "const:fresh-initialize"),
  );
  deepEqual(
    refusalOf(
      await call({
        root,
        mode: "preview",
        action: "reconfigure",
        request: { desiredConfig: { x: Number.NaN } },
      }),
    ),
    notJsonRefusal("$request/request/desiredConfig/x"),
  );
  deepEqual(
    refusalOf(await call({ ...reconcile, root: `${root}${LONE_SURROGATE}` })),
    notJsonRefusal("$request/root"),
  );
});

/**
 * 每个 Maintenance 动作配一个不属于它的请求体。Schema 的判别联合按 `mode` 与 `action` 选支；detach 两个动作的
 * `action` 是 `$ref` 到枚举，联合的解释器不跟 `$ref`（foundation `runtime-json-schema.ts` 的 `fixedValues`），
 * 于是 reconfigure 与 reconcile 的预览、以及 apply 的错体，选不出唯一一支，报的是 Ajv 第一支的错误
 * （`$request/action` 的 `const:fresh-initialize`，apply 是 `additional:planDigest`）。这里把今天的路径钉住：
 * 解释器修好之后这几行随之改。
 */
test("every wakeflow_maintain_workspace action refuses a body that belongs to another action as invalid-request with the Schema's path, through the SDK", async (t) => {
  const root = disposableRoot(t, "wakeflow-request-admission-");
  const client = await connectClaudeCode(t);
  const refusal = async (args: Record<string, unknown>) =>
    refusalOf(
      await client.callTool({ name: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME, arguments: args }),
    );
  const preview = (action: string, request: Record<string, unknown>) => ({
    root,
    mode: "preview",
    action,
    request,
  });
  const cases = [
    [preview("fresh-initialize", { desiredConfig: {} }), "$request/request", "required:selection"],
    [preview("reconfigure", { selection: {} }), "$request/action", "const:fresh-initialize"],
    [preview("reconcile", { desiredConfig: {} }), "$request/action", "const:fresh-initialize"],
    [
      preview("detach-repository", { desiredConfig: {} }),
      "$request/request",
      "additional:desiredConfig",
    ],
    [preview("detach-workspace", { selection: {} }), "$request/request", "additional:selection"],
    [
      {
        ...preview("reconcile", { desiredConfig: {} }),
        mode: "apply",
        planDigest: `sha256:${"1".repeat(64)}`,
      },
      "$request",
      "additional:planDigest",
    ],
    [
      {
        root,
        mode: "recover",
        operationId: "maintenance_operation_11111111-1111-4111-8111-111111111111",
        request: {},
      },
      "$request",
      "additional:request",
    ],
  ] as const;
  for (const [args, path, schema] of cases) {
    deepEqual(await refusal(args), schemaRefusal(path, schema), JSON.stringify(args));
  }
});

test("Schema-invalid requests to tools of every shape get the structured refusal through the SDK: append, effect, endpoint (per-operation detail, W39) and the entry-level quick Demand", async (t) => {
  const root = disposableRoot(t, "wakeflow-request-admission-");
  const client = await connectClaudeCode(t);
  const digest = `sha256:${"1".repeat(64)}`;
  const cases = [
    [
      "wakeflow_prepare_delivery",
      {
        root,
        demandId: "demand_11111111-1111-4111-8111-111111111111",
        idempotencyKey: "admission-1",
        expectedStreamRevision: 2,
        targetTaskId: "target-task_22222222-2222-4222-8222-222222222222",
      },
      schemaRefusal("$request", "required:authored"),
    ],
    [
      "wakeflow_pod",
      { root, mode: "preview", intent: { kind: "create", name: "Bad Name", idempotencyKey: "k" } },
      schemaRefusal("$request/intent/name", "pattern"),
    ],
    [
      "wakeflow_register_window_binding",
      {
        root,
        operation: "replace",
        windowId: "window_55555555-5555-4555-8555-555555555555",
        observation: {
          handle: { kind: "claude-code-session", value: "5f0c6a52-2f5e-4f7e-9a39-1b2c3d4e5f60" },
          launchIntentDigest: digest,
          observedAt: "2026-11-01T08:00:00.000Z",
          tmux: { socketName: null, sessionName: "wakeflow", windowId: "@3", paneId: "%7" },
        },
      },
      schemaRefusal("$request", "required:expectedBindingId"),
    ],
    [
      "wakeflow_quick_demand",
      { root, mode: "preview" },
      schemaRefusal("$request", "required:repositoryId"),
    ],
  ] as const;
  for (const [name, args, expected] of cases) {
    const envelope = envelopeOf(await client.callTool({ name, arguments: args }));
    equal(envelope.tool, name);
    deepEqual(envelope.error, expected, name);
  }
});

test("the stale-artifact gate is decided at the entry before admission: a Schema-invalid preview never reaches it, a Schema-invalid apply passes it and is then refused by the Schema", async (t) => {
  const root = disposableRoot(t, "wakeflow-request-admission-");
  let guarded = 0;
  const client = await connectWakeflowMcpTestClient(t, {
    executeMaintenance: executeClaudeCodeWakeflowMaintenance,
    beforeMutation: () => {
      guarded += 1;
    },
  });
  const mismatched = { root, action: "reconcile", request: { desiredConfig: {} } };
  const preview = await client.callTool({
    name: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    arguments: { ...mismatched, mode: "preview" },
  });
  deepEqual(refusalOf(preview), schemaRefusal("$request/action", "const:fresh-initialize"));
  equal(guarded, 0);
  const apply = await client.callTool({
    name: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    arguments: { ...mismatched, mode: "apply", planDigest: `sha256:${"1".repeat(64)}` },
  });
  equal((refusalOf(apply) as { reason: string }).reason, "schema");
  equal(guarded, 1);
});
