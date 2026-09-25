import os from "node:os";
import {
  type CallToolResult,
  fromJsonSchema,
  type JsonSchemaType,
  type JsonSchemaValidator,
  type jsonSchemaValidator,
  type McpServer,
} from "@modelcontextprotocol/server";

import { canonicalizeJson } from "../foundation/data/canonical-json.js";
import { type JsonValue, parseJsonValue } from "../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../foundation/schema/runtime-json-schema.js";
import { fail, isWakeflowError } from "../kernel/error.js";
import { assertCanonicalTextWithinLimit } from "../kernel/limits.js";
import { assertPublicJson, createRedactionBoundary } from "../kernel/redaction.js";
import { publicToolDefinition, type WakeflowToolCatalog } from "../kernel/tool-registry.js";

/**
 * Wakeflow Entrypoint / MCP：公共工具的协议边界。
 *
 * 官方 SDK 拥有协议与工具调用生命周期；这里只做三件事：按登记表注册工具、把
 * executor 结果投影为 canonical JSON 并做脱敏与上限检查、把错误收敛为稳定的
 * 错误信封。请求校验用 Wakeflow 自己的运行时校验器（惰性编译），与服务端解析
 * 同一份 Schema、同一套规则。
 */

/** 进程级脱敏边界：用户 home 路径永不进入任何公共结果，与各 owner 的根扫描叠加。 */
const PROCESS_REDACTION_BOUNDARY = createRedactionBoundary([os.homedir()]);

/** 公共MCP executor只接收SDK已解析的wire值，并返回一个领域公共结果。 */
export type WakeflowPublicMcpExecutor<Result> = (value: unknown) => Promise<Readonly<Result>>;

/** 可安全公开到MCP错误信封中的稳定、脱敏领域错误字段。 */
interface WakeflowPublicMcpErrorDetails {
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
  readonly publicationAuthority?: "unchanged" | "recoverable" | "current" | "unknown";
}

interface WakeflowPublicMcpErrorEnvelope {
  readonly kind: "WakeflowMcpError";
  readonly schemaVersion: 1;
  readonly tool: string;
  readonly status: "error";
  readonly error: Readonly<WakeflowPublicMcpErrorDetails>;
}

const LEGACY_OPTIONAL_TEXT_FIELDS = Object.freeze([
  "path",
  "causeCode",
  "causeReason",
  "operationId",
  "bindingAuthority",
  "claimAuthority",
  "eventAuthority",
  "publicationAuthority",
] as const);

function ownText(value: object, key: string): string | null {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined &&
    Object.hasOwn(descriptor, "value") &&
    typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

/**
 * 旧领域错误的结构投影：只取自身数据属性里的稳定字符串字段，从不复制消息、
 * 调用栈或原因链。内核错误走 `toPublicDetails`，随 L1 切片迁移后本投影退役。
 */
function legacyErrorDetails(error: unknown): Readonly<WakeflowPublicMcpErrorDetails> | null {
  if (typeof error !== "object" || error === null) return null;
  const code = ownText(error, "code");
  const reason = ownText(error, "reason");
  if (code === null || reason === null) return null;
  const details: Record<string, string> = { code, reason };
  for (const field of LEGACY_OPTIONAL_TEXT_FIELDS) {
    const value = ownText(error, field);
    if (value !== null) details[field] = value;
  }
  return Object.freeze(details) as unknown as Readonly<WakeflowPublicMcpErrorDetails>;
}

const UNEXPECTED_ERROR_DETAILS = Object.freeze({
  code: "wakeflow-unexpected",
  reason: "unexpected",
}) as Readonly<WakeflowPublicMcpErrorDetails>;

function errorEnvelope(
  tool: string,
  details: Readonly<WakeflowPublicMcpErrorDetails>,
): Readonly<WakeflowPublicMcpErrorEnvelope> {
  return Object.freeze({
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    tool,
    status: "error",
    error: details,
  });
}

/** 错误信封与成功结果过同一进程脱敏边界；越界时退回固定的 unexpected 信封。 */
function redactedErrorEnvelope(
  tool: string,
  error: unknown,
): Readonly<WakeflowPublicMcpErrorEnvelope> {
  const envelope = errorEnvelope(
    tool,
    isWakeflowError(error)
      ? error.toPublicDetails()
      : (legacyErrorDetails(error) ?? UNEXPECTED_ERROR_DETAILS),
  );
  try {
    assertPublicJson(
      parseJsonValue(envelope, "$mcpError"),
      PROCESS_REDACTION_BOUNDARY,
      "$mcpError",
    );
    return envelope;
  } catch {
    return errorEnvelope(tool, UNEXPECTED_ERROR_DETAILS);
  }
}

function failedToolResult(tool: string, error: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: canonicalizeJson(redactedErrorEnvelope(tool, error), "$mcpError"),
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
 * 给 SDK 的请求校验器提供者：Schema 在注册时准入，Ajv 编译推迟到该工具第一次
 * 被调用，因此注册二十余个工具不再支付编译成本。
 */
const WAKEFLOW_JSON_SCHEMA_VALIDATOR: jsonSchemaValidator = Object.freeze({
  getValidator<T>(schema: JsonSchemaType): JsonSchemaValidator<T> {
    const validate = createRuntimeJsonSchemaValidator<T>(schema);
    return (input: unknown) => {
      let json: JsonValue;
      try {
        json = parseJsonValue(input, "$request");
      } catch {
        return {
          valid: false,
          data: undefined,
          errorMessage: "Wakeflow tool input must be passive JSON.",
        };
      }
      const result = validate(json);
      return result.ok
        ? { valid: true, data: result.value, errorMessage: undefined }
        : {
            valid: false,
            data: undefined,
            errorMessage: `Wakeflow tool input is invalid at ${result.path}.`,
          };
    };
  },
});

/**
 * 按登记表向一个官方 MCP Server 注册全部公共工具。
 *
 * `tools/list` 只公开请求 Schema（ADR-0004）；结果由各 owner 按结果 Schema 校验。
 * 本函数不保存动态 registry、不选择领域 owner，也不解释业务错误。
 */
export function registerWakeflowPublicMcpCatalog(
  server: McpServer,
  catalog: Readonly<WakeflowToolCatalog>,
  executors: Readonly<Record<string, WakeflowPublicMcpExecutor<unknown>>>,
): void {
  for (const registration of catalog.tools) {
    const execute = executors[registration.executor];
    if (typeof execute !== "function") {
      fail("unexpected", "tool-executor-missing", `$executors.${registration.executor}`);
    }
    const definition = publicToolDefinition(registration);
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: fromJsonSchema<unknown>(
          definition.inputSchema as JsonSchemaType,
          WAKEFLOW_JSON_SCHEMA_VALIDATOR,
        ),
        annotations: definition.annotations,
      },
      async (request: unknown) => {
        try {
          return successfulToolResult(await execute(request));
        } catch (error: unknown) {
          return failedToolResult(registration.name, error);
        }
      },
    );
  }
}
