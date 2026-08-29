import { types } from "node:util";

import {
  fromJsonSchema,
  McpServer,
  type CallToolResult,
} from "@modelcontextprotocol/server";

import {
  WAKEFLOW_MAINTENANCE_PUBLIC_REQUEST_SCHEMA,
  type WakeflowMaintenancePublicRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-maintenance-public-request.generated.js";
import {
  WAKEFLOW_MAINTENANCE_PUBLIC_RESULT_SCHEMA,
  type WakeflowMaintenancePublicResultV1,
} from "../contracts/generated/entrypoints/wakeflow-maintenance-public-result.generated.js";
import {
  WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_REQUEST_SCHEMA,
  type WakeflowWindowHostBindingRegistrationRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-window-host-binding-registration-request.generated.js";
import {
  WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_RESULT_SCHEMA,
  type WakeflowWindowHostBindingRegistrationResultV1,
} from "../contracts/generated/entrypoints/wakeflow-window-host-binding-registration-result.generated.js";
import {
  canonicalizeJson,
} from "../foundation/data/canonical-json.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../foundation/data/passive-own-data.js";
import {
  WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
  WakeflowMaintenancePublicContractError,
} from "../workspace/maintenance/wakeflow-maintenance-public-contract.js";
import {
  WakeflowMaintenancePublicCoordinatorError,
  type WakeflowMaintenancePublicResult,
} from "../workspace/maintenance/wakeflow-maintenance-public-coordinator.js";
import {
  WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
  WakeflowWindowHostBindingPublicContractError,
} from "../workspace/window-runtime/wakeflow-window-host-binding-public-contract.js";
import {
  WakeflowWindowHostBindingPublicCoordinatorError,
  type WakeflowWindowHostBindingPublicResult,
} from "../workspace/window-runtime/wakeflow-window-host-binding-public-coordinator.js";

/**
 * Wakeflow Entrypoint / MCP：官方 MCP SDK 与当前真实公共 owners 之间的薄适配层。
 *
 * JSON Schema 是每个工具的可移植 wire 权威，官方 SDK 负责协议、tools/list、
 * tools/call 与调用前结构校验。领域 owner 仍独立复验容量、关系、根作用域和 mutation
 * authority。当前只发布已闭环的 Maintenance 与 Window Host Binding registration；
 * 不注册未来业务占位工具，也不执行窗口创建、消息发送、Git worktree 或其他宿主效果。
 */

type WakeflowMaintenanceMcpExecutor = (
  value: unknown,
) => Promise<Readonly<WakeflowMaintenancePublicResult>>;

type WakeflowWindowHostBindingMcpExecutor = (
  value: unknown,
) => Promise<Readonly<WakeflowWindowHostBindingPublicResult>>;

interface CreateWakeflowPublicMcpServerOptions {
  readonly serverName: string;
  readonly serverVersion: string;
  readonly executeMaintenance: WakeflowMaintenanceMcpExecutor;
  readonly registerWindowHostBinding: WakeflowWindowHostBindingMcpExecutor;
}

type WakeflowPublicMcpServerConfigurationErrorReason =
  | "options"
  | "server-name"
  | "server-version"
  | "maintenance-executor"
  | "window-host-binding-executor";

const CONFIGURATION_ERROR_MESSAGES = {
  options: "Wakeflow MCP server options are invalid.",
  "server-name": "Wakeflow MCP server name is invalid.",
  "server-version": "Wakeflow MCP server version is invalid.",
  "maintenance-executor": "Wakeflow MCP Maintenance executor is invalid.",
  "window-host-binding-executor":
    "Wakeflow MCP Window Host Binding executor is invalid.",
} as const satisfies Readonly<Record<
  WakeflowPublicMcpServerConfigurationErrorReason,
  string
>>;

/** MCP composition root 配置无效时返回的稳定错误。 */
export class WakeflowPublicMcpServerConfigurationError extends Error {
  override readonly name = "WakeflowPublicMcpServerConfigurationError";
  readonly code = "wakeflow-public-mcp-server-configuration" as const;
  readonly reason: WakeflowPublicMcpServerConfigurationErrorReason;

  constructor(reason: WakeflowPublicMcpServerConfigurationErrorReason) {
    super(CONFIGURATION_ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

interface WakeflowMcpErrorEnvelope {
  readonly kind: "WakeflowMcpError";
  readonly schemaVersion: 1;
  readonly tool: string;
  readonly status: "error";
  readonly error: Readonly<{
    readonly code: string;
    readonly reason: string;
    readonly path?: string;
    readonly causeCode?: string;
    readonly causeReason?: string;
    readonly operationId?: string;
    readonly bindingAuthority?: "unchanged" | "current" | "unknown";
  }>;
}

function failConfiguration(
  reason: WakeflowPublicMcpServerConfigurationErrorReason,
): never {
  throw new WakeflowPublicMcpServerConfigurationError(reason);
}

function nonEmptyText(value: unknown, reason: "server-name" | "server-version") {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 128
    || value.trim() !== value
    || !value.isWellFormed()
    || value.normalize("NFC") !== value
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    failConfiguration(reason);
  }
  return value;
}

function parseServerOptions(
  value: unknown,
): Readonly<CreateWakeflowPublicMcpServerOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) failConfiguration("options");
    throw error;
  }
  const fields = Object.freeze([
    "executeMaintenance",
    "registerWindowHostBinding",
    "serverName",
    "serverVersion",
  ] as const);
  const keys = Object.keys(record).sort();
  if (
    keys.length !== fields.length
    || keys.some((key, index) => key !== fields[index])
  ) {
    failConfiguration("options");
  }
  const serverName = nonEmptyText(record.serverName, "server-name");
  const serverVersion = nonEmptyText(record.serverVersion, "server-version");
  if (
    typeof record.executeMaintenance !== "function"
    || types.isProxy(record.executeMaintenance)
  ) {
    failConfiguration("maintenance-executor");
  }
  if (
    typeof record.registerWindowHostBinding !== "function"
    || types.isProxy(record.registerWindowHostBinding)
  ) {
    failConfiguration("window-host-binding-executor");
  }
  return Object.freeze({
    serverName,
    serverVersion,
    executeMaintenance:
      record.executeMaintenance as WakeflowMaintenanceMcpExecutor,
    registerWindowHostBinding:
      record.registerWindowHostBinding as WakeflowWindowHostBindingMcpExecutor,
  });
}

function maintenanceError(error: unknown) {
  if (error instanceof WakeflowMaintenancePublicContractError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      path: error.path,
    });
  }
  if (error instanceof WakeflowMaintenancePublicCoordinatorError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      ...(error.causeCode === null ? {} : { causeCode: error.causeCode }),
      ...(error.operationId === null
        ? {}
        : { operationId: error.operationId }),
    });
  }
  return null;
}

function windowHostBindingError(error: unknown) {
  if (error instanceof WakeflowWindowHostBindingPublicContractError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      path: error.path,
    });
  }
  if (error instanceof WakeflowWindowHostBindingPublicCoordinatorError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      ...(error.causeCode === null ? {} : { causeCode: error.causeCode }),
      ...(error.causeReason === null
        ? {}
        : { causeReason: error.causeReason }),
      bindingAuthority: error.bindingAuthority,
    });
  }
  return null;
}

function errorEnvelope(tool: string, error: unknown): WakeflowMcpErrorEnvelope {
  const known = maintenanceError(error) ?? windowHostBindingError(error);
  return Object.freeze({
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    tool,
    status: "error",
    error: known ?? Object.freeze({
      code: "wakeflow-unexpected",
      reason: "unexpected",
    }),
  });
}

function failedToolResult(tool: string, error: unknown): CallToolResult {
  const envelope = errorEnvelope(tool, error);
  return {
    content: [{
      type: "text",
      text: canonicalizeJson(envelope, "$mcpError"),
    }],
    isError: true,
  };
}

/** 创建只注册当前两个真实公共工具的官方 MCP server 实例。 */
export function createWakeflowPublicMcpServer(
  options: Readonly<CreateWakeflowPublicMcpServerOptions>,
): McpServer {
  const admitted = parseServerOptions(options);

  const server = new McpServer({
    name: admitted.serverName,
    version: admitted.serverVersion,
  }, {
    instructions: [
      `Call ${WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME} in preview mode before apply.`,
      "Apply must return the exact confirmation and digest produced by that preview.",
      "Wakeflow never performs host effects: the Agent executes each returned window launch intent with host capabilities.",
      `After a host window is created, pass its exact opaque result to ${WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME}.`,
    ].join(" "),
  });

  server.registerTool(
    WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    {
      title: "Maintain Wakeflow Workspace",
      description: [
        "Preview, apply a confirmed preview, or recover one Wakeflow workspace Maintenance transaction.",
        "Preview is read-only. Apply and recover may mutate Wakeflow-owned local resources.",
        "Returned window launch intents require explicit Agent host actions.",
      ].join(" "),
      inputSchema: fromJsonSchema<WakeflowMaintenancePublicRequestV1>(
        WAKEFLOW_MAINTENANCE_PUBLIC_REQUEST_SCHEMA,
      ),
      outputSchema: fromJsonSchema<WakeflowMaintenancePublicResultV1>(
        WAKEFLOW_MAINTENANCE_PUBLIC_RESULT_SCHEMA,
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (request) => {
      try {
        const result = await admitted.executeMaintenance(request);
        return {
          content: [{
            type: "text" as const,
            text: canonicalizeJson(result, "$result"),
          }],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return failedToolResult(WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME, error);
      }
    },
  );

  server.registerTool(
    WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
    {
      title: "Register Wakeflow Window Host Binding",
      description: [
        "Register the opaque current-host window identifier observed by the Agent after executing one Wakeflow launch intent.",
        "Wakeflow does not create or inspect the host window.",
        "The private handle is stored in a 0600 Binding authority file and omitted from the result and runtime projection.",
      ].join(" "),
      inputSchema:
        fromJsonSchema<WakeflowWindowHostBindingRegistrationRequestV1>(
          WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_REQUEST_SCHEMA,
        ),
      outputSchema:
        fromJsonSchema<WakeflowWindowHostBindingRegistrationResultV1>(
          WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_RESULT_SCHEMA,
        ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (request) => {
      try {
        const result = await admitted.registerWindowHostBinding(request);
        return {
          content: [{
            type: "text" as const,
            text: canonicalizeJson(result, "$result"),
          }],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return failedToolResult(
          WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
          error,
        );
      }
    },
  );

  return server;
}
