import { WAKEFLOW_WINDOW_HOST_BINDING_ID_PREFIX } from "../../contracts/identity/wakeflow-typed-id-prefixes.js";
import { createUuidV4, parseUuidV4, UuidV4Error, } from "../../foundation/identity/uuid-v4.js";
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
