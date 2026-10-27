import { types } from "node:util";

import { PassiveOwnDataError, parsePlainRecord } from "../foundation/data/passive-own-data.js";
import type { DemandEventStreamCommitWriter } from "../governance/demand/event-sourcing/demand-event-stream-commit.js";
import type { WakeflowToolCatalog } from "../kernel/tool-registry.js";
import type { WakeflowPublicMcpExecutors } from "./wakeflow-public-mcp-catalog.js";

/** Public Server固定组合所需的完整、关闭依赖集合。 */
export interface CreateWakeflowPublicMcpServerOptions extends WakeflowPublicMcpExecutors {
  readonly serverName: string;
  readonly serverVersion: string;
  readonly beforeMutation?: () => void;
  /**
   * 本进程的写者戳（C11）：组合根从制品身份映射，服务把它放进每次调用的执行上下文；省略或 null
   * 即不盖戳（测试构建没有 manifest）。形状在这里只核对到两个文本字段，严格准入归各持久写入。
   */
  readonly writer?: Readonly<DemandEventStreamCommitWriter> | null;
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
} as const satisfies Readonly<Record<WakeflowPublicMcpServerConfigurationErrorReason, string>>;

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

function nonEmptyText(value: unknown, reason: "server-name" | "server-version"): string {
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
  const expectedKeys = [
    ...executorFields,
    "serverName",
    "serverVersion",
    ...(record.beforeMutation === undefined ? [] : ["beforeMutation"]),
    ...(record.writer === undefined ? [] : ["writer"]),
  ].sort();
  const keys = Object.keys(record).sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    fail("options");
  }
  const executors: Record<string, unknown> = {};
  const beforeMutation = admitBeforeMutation(record.beforeMutation);
  const writer = admitWriter(record.writer);
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
    ...(beforeMutation === undefined ? {} : { beforeMutation }),
    ...(writer === undefined ? {} : { writer }),
  });
}

/** `beforeMutation` 省略即 undefined，否则必须是非 Proxy 的函数。 */
function admitBeforeMutation(value: unknown): (() => void) | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "function" || types.isProxy(value)) fail("options");
  return value as () => void;
}

/**
 * `writer` 省略即 undefined；否则是 null，或恰好 `version` 与 `manifestDigest` 两个文本字段的非 Proxy
 * 普通记录。严格准入归各持久写入。
 */
function admitWriter(value: unknown): Readonly<DemandEventStreamCommitWriter> | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options.writer");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("options");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "manifestDigest" ||
    keys[1] !== "version" ||
    typeof record.manifestDigest !== "string" ||
    typeof record.version !== "string"
  ) {
    fail("options");
  }
  return value as Readonly<DemandEventStreamCommitWriter>;
}
