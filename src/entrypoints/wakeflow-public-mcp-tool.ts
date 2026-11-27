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
import { RootedDirectory } from "../foundation/filesystem/rooted-directory.js";
import type { DemandEventStreamCommitWriter } from "../governance/demand/event-sourcing/demand-event-stream-commit.js";
import { fail, toWakeflowError, type WakeflowError } from "../kernel/error.js";
import { createIncidentId, recordIncident } from "../kernel/incident.js";
import { assertCanonicalTextWithinLimit } from "../kernel/limits.js";
import { assertPublicJson, createRedactionBoundary } from "../kernel/redaction.js";
import { publicToolDefinition, type WakeflowToolCatalog } from "../kernel/tool-registry.js";
import type { WakeflowCallAuthorizer } from "./wakeflow-caller-role-gate.js";

/**
 * Wakeflow Entrypoint / MCP：公共工具的协议边界。
 *
 * 官方 SDK 拥有协议与工具调用生命周期；这里只做三件事：按登记表注册工具、把
 * executor 结果投影为 canonical JSON 并做脱敏与上限检查、把错误收敛为稳定的
 * 错误信封。请求准入不在这里也不在 SDK 里：SDK 原样交出参数，命令外壳做被动 JSON
 * 解析，切片合同跑唯一一次请求 Schema，失败是结构化的 `invalid-request`（R13，
 * 2026-11-27 裁定）。
 */

/** 进程级脱敏边界：用户 home 路径永不进入任何公共结果，与各 owner 的根扫描叠加。 */
const PROCESS_REDACTION_BOUNDARY = createRedactionBoundary([os.homedir()]);

/**
 * SDK 签发的执行上下文；不是 Agent 可填写的 wire 请求。`writer` 是组合根固定的本进程写者戳
 * （C11：制品发布版本与 manifest 摘要），每个 executor 原样转交给自己的持久写入；没有 manifest 的
 * 构建为 null。
 */
export interface WakeflowPublicMcpExecutionContext {
  readonly signal: AbortSignal;
  readonly writer: Readonly<DemandEventStreamCommitWriter> | null;
}

/**
 * 公共 executor 接收 SDK 原样交出的参数（尚未经 Wakeflow 准入）和请求取消信号，返回领域公共结果；
 * 被动 JSON 解析与请求 Schema 都在它下面，各一次（命令外壳与切片合同；快速 Demand 不经外壳，在自己的
 * 入口调用外壳的同一个 `parsePublicRequestJson`，再跑自己合同的 Schema）。
 */
export type WakeflowPublicMcpExecutor<Result> = (
  value: unknown,
  context: Readonly<WakeflowPublicMcpExecutionContext>,
) => Promise<Readonly<Result>>;

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

/** 信封本身越过脱敏边界时退回的固定细节：封闭码里的 `unexpected`，原因只说明被脱敏。 */
const REDACTED_ERROR_DETAILS: Readonly<WakeflowPublicMcpErrorDetails> = Object.freeze({
  code: "unexpected",
  reason: "redacted",
  path: "$",
  retryable: false,
});

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

/**
 * 错误信封与成功结果过同一进程脱敏边界；越界时退回固定的 redacted 信封。每个错误先经内核收敛：
 * 内核错误原样投影，旧错误类按 `LEGACY_ERROR_CODE_FAMILIES` 翻成封闭码（§13.166 批次 1，旧的逐字段
 * 投影已退役），其余是 `unexpected`。
 */
function redactedErrorEnvelope(
  tool: string,
  details: Readonly<WakeflowPublicMcpErrorDetails>,
): Readonly<WakeflowPublicMcpErrorEnvelope> {
  const envelope = errorEnvelope(tool, details);
  try {
    assertPublicJson(
      parseJsonValue(envelope, "$mcpError"),
      PROCESS_REDACTION_BOUNDARY,
      "$mcpError",
    );
    return envelope;
  } catch {
    return errorEnvelope(tool, REDACTED_ERROR_DETAILS);
  }
}

/** 这两类失败对 Agent 没有可修的原因（G4），所以留事故记录并在信封里回显事故 id（G1）。 */
const INCIDENT_CODES: ReadonlySet<string> = new Set(["unexpected", "io-failure"]);

function requestRoot(request: unknown): string | null {
  if (typeof request !== "object" || request === null) return null;
  const root = (request as { readonly root?: unknown }).root;
  return typeof root === "string" ? root : null;
}

/** 尽力而为：请求指向一个已初始化的工作区才写；打开失败、不是工作区或写失败都静默。 */
async function recordToolIncident(
  request: unknown,
  tool: string,
  incidentId: string,
  failure: WakeflowError,
): Promise<void> {
  const root = requestRoot(request);
  if (root === null) return;
  let directory: RootedDirectory | null = null;
  try {
    directory = await RootedDirectory.open(root, "$request.root");
    await recordIncident(directory, {
      incidentId,
      source: "mcp-tool",
      tool,
      error: failure,
      requestKeys: Object.keys(request as object),
    });
  } catch {
    // 事故记录从不让失败的调用失败得更厉害。
  } finally {
    if (directory !== null) {
      try {
        await directory.close();
      } catch {
        // 根句柄关闭失败不改变结果。
      }
    }
  }
}

function writeIncidentLine(line: string): void {
  try {
    process.stderr.write(`${line}\n`);
  } catch {
    // stderr 不可用时结果不变。
  }
}

async function failedToolResult(
  tool: string,
  error: unknown,
  request: unknown,
): Promise<CallToolResult> {
  const failure = toWakeflowError(error, "$");
  let details: Readonly<WakeflowPublicMcpErrorDetails> = failure.toPublicDetails();
  if (INCIDENT_CODES.has(failure.code)) {
    const incidentId = createIncidentId();
    details = Object.freeze({
      ...details,
      details: Object.freeze({ ...(details.details ?? {}), incidentId }),
    });
    await recordToolIncident(request, tool, incidentId, failure);
    writeIncidentLine(
      `wakeflow: incident ${incidentId} (${tool}: ${failure.code}/${failure.reason})`,
    );
  }
  return {
    content: [
      {
        type: "text",
        text: canonicalizeJson(redactedErrorEnvelope(tool, details), "$mcpError"),
      },
    ],
    isError: true,
  };
}

/**
 * 把领域层的无原型JSON快照转换为MCP SDK可移植的标准JSON对象。
 * 文本与structuredContent共享同一Canonical JSON事实，避免两份独立投影漂移；进程脱敏扫的也是这份
 * 事实（规范化本身已经完成 JSON 准入，不再另走一遍）。命令外壳已按工作区边界检查过自己的结果，这里
 * 仍要再查：快速 Demand 与续接一步的组合结果从不整体经过外壳（续接的组合可以超过单个结果的上限），
 * 而这道进程边界与上限是每个 executor 共同的最后一道。
 */
function successfulToolResult(value: unknown): CallToolResult {
  const text = canonicalizeJson(value, "$result");
  assertCanonicalTextWithinLimit(text, "publicResultBytes", "$result");
  const structuredContent: JsonValue = JSON.parse(text);
  assertPublicJson(structuredContent, PROCESS_REDACTION_BOUNDARY, "$result");
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
 * 给 SDK 的请求校验器提供者：一律放行，参数原样交给工具回调（`fromJsonSchema` 的第二个参数就是 SDK 留给
 * 自定义校验的位置）。SDK 校验失败只会回一行纯文本工具错误（"Input validation error: …"），切片合同的
 * 结构化拒绝（`invalid-request`，`path` 与 `details.schema`，判别联合报选中的那一支，W39）就永远到不了
 * Agent；所以请求只在 Wakeflow 自己那里准入一次（R13）。`tools/list` 不经校验器：SDK 从同一份 Schema 的
 * `jsonSchema.input()` 生成目录，字节不变。
 */
const WAKEFLOW_PASS_THROUGH_VALIDATOR: jsonSchemaValidator = Object.freeze({
  getValidator<T>(_schema: JsonSchemaType): JsonSchemaValidator<T> {
    return (input: unknown) => ({ valid: true, data: input as T, errorMessage: undefined });
  },
});

/**
 * 这次调用会不会写：入口唯一的"是否变更"判断，过期制品门（`beforeMutation`）凭它在角色门之后、任何能力
 * 代码与工作区根之前拒绝。只读工具不写；`mode: "preview"` 与 `operation: "inspect"` 是切片约定的零写形态
 * （切片的 `scope` 在同样的成员上挑锁，`read` 与这里的"不写"一致）。读的是 SDK 交来的参数的顶层成员；
 * 请求随后才被准入，Schema 不认的请求即使在这里判错，也只是多走或少走一次过期检查，不会写任何东西。
 */
function mayMutate(readOnly: boolean, request: unknown): boolean {
  if (readOnly) return false;
  if (request === null || typeof request !== "object") return true;
  const inspected =
    ("mode" in request && request.mode === "preview") ||
    ("operation" in request && request.operation === "inspect");
  return !inspected;
}

/**
 * 按登记表向一个官方 MCP Server 注册全部公共工具。
 *
 * `tools/list` 只公开请求 Schema（ADR-0004）；结果由各 owner 按结果 Schema 校验。
 * 本函数不保存动态 registry、不选择领域 owner，也不解释业务错误。`listedTools` 给了就只登记这些名字的
 * 工具（按角色的工具子集，ADR-0029），null 登记全部。
 */
export function registerWakeflowPublicMcpCatalog(
  server: McpServer,
  catalog: Readonly<WakeflowToolCatalog>,
  executors: Readonly<Record<string, WakeflowPublicMcpExecutor<unknown>>>,
  beforeMutation?: () => void,
  writer: Readonly<DemandEventStreamCommitWriter> | null = null,
  authorizeCall?: WakeflowCallAuthorizer,
  listedTools: readonly string[] | null = null,
): void {
  for (const registration of catalog.tools) {
    if (listedTools !== null && !listedTools.includes(registration.name)) continue;
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
          WAKEFLOW_PASS_THROUGH_VALIDATOR,
        ),
        annotations: definition.annotations,
      },
      async (request: unknown, context) => {
        try {
          // 按窗口角色的归属表（ADR-0020 决定 3）：认得出调用方角色而工具不归它时，在任何读写之前拒绝。
          await authorizeCall?.(definition.name, request, context.mcpReq.signal);
          if (mayMutate(definition.annotations.readOnlyHint === true, request)) beforeMutation?.();
          return successfulToolResult(
            await execute(request, Object.freeze({ signal: context.mcpReq.signal, writer })),
          );
        } catch (error: unknown) {
          return await failedToolResult(registration.name, error, request);
        }
      },
    );
  }
}
