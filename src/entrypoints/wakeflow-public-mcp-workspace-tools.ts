import {
  fromJsonSchema,
  type McpServer,
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
  WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
  type WakeflowMaintenancePublicResult,
} from "../capabilities/workspace/maintain-workspace.js";
import {
  WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
  WakeflowWindowHostBindingPublicContractError,
} from "../workspace/window-runtime/wakeflow-window-host-binding-public-contract.js";
import {
  WakeflowWindowHostBindingPublicCoordinatorError,
  type WakeflowWindowHostBindingPublicResult,
} from "../workspace/window-runtime/wakeflow-window-host-binding-public-coordinator.js";
import {
  registerWakeflowPublicMcpTool,
  type WakeflowPublicMcpErrorDetails,
  type WakeflowPublicMcpExecutor,
} from "./wakeflow-public-mcp-tool.js";

/** Workspace与宿主身份两项公共工具所需的固定executor集合。 */
export interface WakeflowPublicMcpWorkspaceExecutors {
  readonly executeMaintenance: WakeflowPublicMcpExecutor<WakeflowMaintenancePublicResult>;
  readonly registerWindowHostBinding: WakeflowPublicMcpExecutor<WakeflowWindowHostBindingPublicResult>;
}

function windowHostBindingError(
  error: unknown,
): Readonly<WakeflowPublicMcpErrorDetails> | null {
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
      ...(error.causeReason === null ? {} : { causeReason: error.causeReason }),
      bindingAuthority: error.bindingAuthority,
    });
  }
  return null;
}

/** 注册Workspace Maintenance与私有Window Binding公共工具。 */
export function registerWakeflowPublicMcpWorkspaceTools(
  server: McpServer,
  executors: Readonly<WakeflowPublicMcpWorkspaceExecutors>,
): void {
  registerWakeflowPublicMcpTool<
    WakeflowMaintenancePublicRequestV1,
    WakeflowMaintenancePublicResultV1
  >(server, {
    name: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    title: "Maintain Wakeflow Workspace",
    description: [
      "Preview, apply, or recover one Wakeflow workspace Maintenance transaction (fresh-initialize, reconfigure, reconcile).",
      "Preview is read-only and returns the plan with its planDigest; apply resends the same action and request with that planDigest, and Wakeflow re-derives the plan and rejects any drift.",
      "Recover finishes an interrupted transaction by its operationId. Returned window launch intents require explicit Agent host actions; every result carries next.",
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
    execute: executors.executeMaintenance,
    mapError: () => null,
  });

  registerWakeflowPublicMcpTool<
    WakeflowWindowHostBindingRegistrationRequestV1,
    WakeflowWindowHostBindingRegistrationResultV1
  >(server, {
    name: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
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
    execute: executors.registerWindowHostBinding,
    mapError: windowHostBindingError,
  });
}
