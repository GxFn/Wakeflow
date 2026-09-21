import { createUuidV4, parseUuidV4, UuidV4Error, } from "../../foundation/identity/uuid-v4.js";
/**
 * Wakeflow Workspace / Window Runtime：Window Host Binding 的代际身份。
 *
 * Binding 是可替换的运行时路由事实，不是持久业务实体，因此不进入 durable ID kind
 * 词汇。每次新建或未来替换都会获得新的随机 UUIDv4；相同 Agent observation 的幂等
 * 重放继续返回已经提交的 bindingId，不重新分配。
 */
const WAKEFLOW_WINDOW_HOST_BINDING_ID_PREFIX = "window_binding_";
const ERROR_MESSAGES = {
    format: "Wakeflow Window Host Binding ID is invalid.",
    factory: "Wakeflow Window Host Binding ID could not be generated.",
};
/** Binding ID 解析或创建失败的稳定、脱敏错误。 */
export class WakeflowWindowHostBindingIdError extends Error {
    name = "WakeflowWindowHostBindingIdError";
    code = "wakeflow-window-host-binding-id";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new WakeflowWindowHostBindingIdError(reason, path);
}
/** 严格解析一个 Window Host Binding 代际 ID。 */
export function parseWakeflowWindowHostBindingId(value, path = "$bindingId") {
    if (typeof value !== "string"
        || !value.startsWith(WAKEFLOW_WINDOW_HOST_BINDING_ID_PREFIX)) {
        fail("format", path);
    }
    try {
        parseUuidV4(value.slice(WAKEFLOW_WINDOW_HOST_BINDING_ID_PREFIX.length), path);
    }
    catch (error) {
        if (error instanceof UuidV4Error)
            fail("format", path);
        throw error;
    }
    return value;
}
/** 使用密码学 UUIDv4 源创建新的 Binding 代际 ID。 */
export function createWakeflowWindowHostBindingId(uuidFactory) {
    try {
        const uuid = uuidFactory === undefined
            ? createUuidV4()
            : createUuidV4(uuidFactory);
        return parseWakeflowWindowHostBindingId(`${WAKEFLOW_WINDOW_HOST_BINDING_ID_PREFIX}${uuid}`);
    }
    catch (error) {
        if (error instanceof UuidV4Error
            || error instanceof WakeflowWindowHostBindingIdError) {
            fail("factory", "$uuidFactory");
        }
        throw error;
    }
}
