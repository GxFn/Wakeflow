import { types } from "node:util";

import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../foundation/data/passive-own-data.js";
import type { WakeflowToolCatalog } from "../kernel/tool-registry.js";
import type { WakeflowPublicMcpExecutors } from "./wakeflow-public-mcp-catalog.js";

/** Public Server固定组合所需的完整、关闭依赖集合。 */
export interface CreateWakeflowPublicMcpServerOptions
  extends WakeflowPublicMcpExecutors {
  readonly serverName: string;
  readonly serverVersion: string;
}

export type WakeflowPublicMcpServerConfigurationErrorReason =
  | "options"
  | "server-name"
  | "server-version"
  | "executor";

const CONFIGURATION_ERROR_MESSAGES = {
  options: "Wakeflow MCP server options are invalid.",
  "server-name": "Wakeflow MCP server name is invalid.",
  "server-version": "Wakeflow MCP server version is invalid.",
  executor: "Wakeflow MCP server executor is invalid.",
} as const satisfies Readonly<
  Record<WakeflowPublicMcpServerConfigurationErrorReason, string>
>;

/** MCP composition root配置无效时返回的稳定错误。 */
export class WakeflowPublicMcpServerConfigurationError extends Error {
  override readonly name = "WakeflowPublicMcpServerConfigurationError";
  readonly code = "wakeflow-public-mcp-server-configuration" as const;
  readonly reason: WakeflowPublicMcpServerConfigurationErrorReason;
  /** 出错的 executor 绑定名；其他原因为 `null`。 */
  readonly field: string | null;

  constructor(
    reason: WakeflowPublicMcpServerConfigurationErrorReason,
    field: string | null = null,
  ) {
    super(CONFIGURATION_ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.field = field;
  }
}

function fail(
  reason: WakeflowPublicMcpServerConfigurationErrorReason,
  field: string | null = null,
): never {
  throw new WakeflowPublicMcpServerConfigurationError(reason, field);
}

function nonEmptyText(
  value: unknown,
  reason: "server-name" | "server-version",
): string {
  if (typeof value !== "string" || value.length === 0) fail(reason);
  return value;
}

/** 严格准入组合根元数据与登记表要求的全部 executor，不接受 Proxy 或扩展字段。 */
export function parseCreateWakeflowPublicMcpServerOptions(
  value: unknown,
  catalog: Readonly<WakeflowToolCatalog>,
): Readonly<CreateWakeflowPublicMcpServerOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("options");
    throw error;
  }
  const executorFields = catalog.tools.map((tool) => tool.executor);
  const expectedKeys = [...executorFields, "serverName", "serverVersion"].sort();
  const keys = Object.keys(record).sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    fail("options");
  }
  const executors: Record<string, unknown> = {};
  for (const field of executorFields) {
    const executor = record[field];
    if (typeof executor !== "function" || types.isProxy(executor)) {
      fail("executor", field);
    }
    executors[field] = executor;
  }
  return Object.freeze({
    ...(executors as unknown as WakeflowPublicMcpExecutors),
    serverName: nonEmptyText(record.serverName, "server-name"),
    serverVersion: nonEmptyText(record.serverVersion, "server-version"),
  });
}
