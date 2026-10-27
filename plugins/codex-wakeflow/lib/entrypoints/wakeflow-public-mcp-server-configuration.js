import { types } from "node:util";
import { PassiveOwnDataError, parsePlainRecord } from "../foundation/data/passive-own-data.js";
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
    const expectedKeys = [
        ...executorFields,
        "serverName",
        "serverVersion",
        ...(record.beforeMutation === undefined ? [] : ["beforeMutation"]),
        ...(record.writer === undefined ? [] : ["writer"]),
    ].sort();
    const keys = Object.keys(record).sort();
    if (keys.length !== expectedKeys.length ||
        keys.some((key, index) => key !== expectedKeys[index])) {
        fail("options");
    }
    const executors = {};
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
        ...executors,
        serverName: nonEmptyText(record.serverName, "server-name"),
        serverVersion: nonEmptyText(record.serverVersion, "server-version"),
        ...(beforeMutation === undefined ? {} : { beforeMutation }),
        ...(writer === undefined ? {} : { writer }),
    });
}
/** `beforeMutation` 省略即 undefined，否则必须是非 Proxy 的函数。 */
function admitBeforeMutation(value) {
    if (value === undefined)
        return undefined;
    if (typeof value !== "function" || types.isProxy(value))
        fail("options");
    return value;
}
/**
 * `writer` 省略即 undefined；否则是 null，或恰好 `version` 与 `manifestDigest` 两个文本字段的非 Proxy
 * 普通记录。严格准入归各持久写入。
 */
function admitWriter(value) {
    if (value === undefined)
        return undefined;
    if (value === null)
        return null;
    let record;
    try {
        record = parsePlainRecord(value, "$options.writer");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("options");
        throw error;
    }
    const keys = Object.keys(record).sort();
    if (keys.length !== 2 ||
        keys[0] !== "manifestDigest" ||
        keys[1] !== "version" ||
        typeof record.manifestDigest !== "string" ||
        typeof record.version !== "string") {
        fail("options");
    }
    return value;
}
