import { types } from "node:util";
import { parsePlainRecord, PassiveOwnDataError } from "../foundation/data/passive-own-data.js";
const CONFIGURATION_ERROR_MESSAGES = {
    options: "Wakeflow MCP server options are invalid.",
    "server-name": "Wakeflow MCP server name is invalid.",
    "server-version": "Wakeflow MCP server version is invalid.",
    executor: "Wakeflow MCP server executor is invalid.",
};
/** MCP composition root配置无效时返回的稳定错误。 */
export class WakeflowPublicMcpServerConfigurationError extends Error {
    name = "WakeflowPublicMcpServerConfigurationError";
    code = "wakeflow-public-mcp-server-configuration";
    reason;
    /** 出错的 executor 绑定名；其他原因为 `null`。 */
    field;
    constructor(reason, field = null) {
        super(CONFIGURATION_ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.field = field;
    }
}
function fail(reason, field = null) {
    throw new WakeflowPublicMcpServerConfigurationError(reason, field);
}
function nonEmptyText(value, reason) {
    if (typeof value !== "string" || value.length === 0)
        fail(reason);
    return value;
}
/** 严格准入组合根元数据与登记表要求的全部 executor，不接受 Proxy 或扩展字段。 */
export function parseCreateWakeflowPublicMcpServerOptions(value, catalog) {
    let record;
    try {
        record = parsePlainRecord(value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("options");
        throw error;
    }
    const executorFields = catalog.tools.map((tool) => tool.executor);
    const expectedKeys = [...executorFields, "serverName", "serverVersion"].sort();
    const keys = Object.keys(record).sort();
    if (keys.length !== expectedKeys.length ||
        keys.some((key, index) => key !== expectedKeys[index])) {
        fail("options");
    }
    const executors = {};
    for (const field of executorFields) {
        const executor = record[field];
        if (typeof executor !== "function" || types.isProxy(executor)) {
            fail("executor", field);
        }
        executors[field] = executor;
    }
    return Object.freeze({
        ...executors,
        serverName: nonEmptyText(record.serverName, "server-name"),
        serverVersion: nonEmptyText(record.serverVersion, "server-version"),
    });
}
