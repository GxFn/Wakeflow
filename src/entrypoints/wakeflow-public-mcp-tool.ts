import {
  type CallToolResult,
  type McpServer,
  type StandardSchemaWithJSON,
  type ToolAnnotations,
} from "@modelcontextprotocol/server";

import os from "node:os";

import { canonicalizeJson } from "../foundation/data/canonical-json.js";
import { parseJsonValue } from "../foundation/data/json-value.js";
import { isWakeflowError } from "../kernel/error.js";
import { assertCanonicalTextWithinLimit } from "../kernel/limits.js";
import {
  assertPublicJson,
  createRedactionBoundary,
} from "../kernel/redaction.js";

/** 进程级脱敏边界：用户 home 路径永不进入任何公共结果，与各 owner 的根扫描叠加。 */
const PROCESS_REDACTION_BOUNDARY = createRedactionBoundary([os.homedir()]);

/** 公共MCP executor只接收SDK已解析的wire值，并返回一个领域公共结果。 */
export type WakeflowPublicMcpExecutor<Result> = (
  value: unknown,
) => Promise<Readonly<Result>>;

/** 可安全公开到MCP错误信封中的稳定、脱敏领域错误字段。 */
export interface WakeflowPublicMcpErrorDetails {
  readonly code: string;
  readonly reason: string;
  readonly path?: string;
  readonly retryable?: boolean;
  readonly details?: Readonly<Record<string, string>>;
  readonly causeCode?: string;
  readonly causeReason?: string;
  readonly operationId?: string;
  readonly bindingAuthority?: "unchanged" | "current" | "unknown";
  readonly claimAuthority?: "unchanged" | "current" | "released" | "unknown";
  readonly eventAuthority?: "unchanged" | "current" | "unknown";
  readonly publicationAuthority?:
    | "unchanged"
    | "recoverable"
    | "current"
    | "unknown";
}

export type WakeflowPublicMcpErrorMapper = (
  error: unknown,
) => Readonly<WakeflowPublicMcpErrorDetails> | null;

interface WakeflowPublicMcpErrorEnvelope {
  readonly kind: "WakeflowMcpError";
  readonly schemaVersion: 1;
  readonly tool: string;
  readonly status: "error";
  readonly error: Readonly<WakeflowPublicMcpErrorDetails>;
}

interface WakeflowPublicMcpToolRegistration<Request, Result> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: StandardSchemaWithJSON<Request, Request>;
  readonly outputSchema: StandardSchemaWithJSON<Result, Result>;
  readonly annotations: Readonly<ToolAnnotations>;
  readonly execute: (request: Request) => Promise<unknown>;
  readonly mapError: WakeflowPublicMcpErrorMapper;
}

function errorEnvelope(
  tool: string,
  error: unknown,
  mapError: WakeflowPublicMcpErrorMapper,
): Readonly<WakeflowPublicMcpErrorEnvelope> {
  return Object.freeze({
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    tool,
    status: "error",
    error: isWakeflowError(error)
      ? error.toPublicDetails()
      : (mapError(error) ??
        Object.freeze({
          code: "wakeflow-unexpected",
          reason: "unexpected",
        })),
  });
}

function failedToolResult(
  tool: string,
  error: unknown,
  mapError: WakeflowPublicMcpErrorMapper,
): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: canonicalizeJson(
          errorEnvelope(tool, error, mapError),
          "$mcpError",
        ),
      },
    ],
    isError: true,
  };
}

/**
 * 把领域层的无原型JSON快照转换为MCP SDK可移植的标准JSON对象。
 * 文本与structuredContent共享同一Canonical JSON事实，避免两份独立投影漂移。
 */
function successfulToolResult(value: unknown): CallToolResult {
  const text = canonicalizeJson(value, "$result");
  assertCanonicalTextWithinLimit(text, "publicResultBytes", "$result");
  assertPublicJson(parseJsonValue(value, "$result"), PROCESS_REDACTION_BOUNDARY, "$result");
  const structuredContent: unknown = JSON.parse(text);
  if (
    structuredContent === null ||
    Array.isArray(structuredContent) ||
    typeof structuredContent !== "object"
  ) {
    throw new TypeError("Wakeflow MCP structured result must be an object.");
  }
  return {
    content: [{ type: "text", text }],
    structuredContent: structuredContent as Record<string, unknown>,
  };
}

/**
 * 立即向一个官方MCP Server注册单个真实工具。
 *
 * 本函数不保存动态registry、不选择领域owner，也不解释业务错误；调用方仍分别拥有
 * Schema、description、executor与错误投影。
 */
export function registerWakeflowPublicMcpTool<Request, Result>(
  server: McpServer,
  registration: Readonly<WakeflowPublicMcpToolRegistration<Request, Result>>,
): void {
  server.registerTool(
    registration.name,
    {
      title: registration.title,
      description: registration.description,
      inputSchema: registration.inputSchema,
      outputSchema: registration.outputSchema,
      annotations: registration.annotations,
    },
    async (request) => {
      try {
        return successfulToolResult(await registration.execute(request));
      } catch (error: unknown) {
        return failedToolResult(
          registration.name,
          error,
          registration.mapError,
        );
      }
    },
  );
}
