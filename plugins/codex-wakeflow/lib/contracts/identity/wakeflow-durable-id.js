import { createUuidV4, parseUuidV4, UuidV4Error, } from "../../foundation/identity/uuid-v4.js";
import { WAKEFLOW_DURABLE_ID_KINDS, } from "../generated/identity/wakeflow-durable-id-kind.generated.js";
/** 对外转交 Schema 派生词汇；本模块不保存第二份类别清单。 */
export { WAKEFLOW_DURABLE_ID_KINDS };
const WAKEFLOW_DURABLE_ID_KIND_SET = new Set(WAKEFLOW_DURABLE_ID_KINDS);
const ERROR_MESSAGES = {
    format: "Wakeflow durable ID must match <known kind>_<canonical lowercase UUID v4>.",
    "kind-unknown": "Wakeflow durable ID kind is not part of the closed durable identity vocabulary.",
    "uuid-format": "Wakeflow durable ID contains an invalid UUID v4 component.",
    "kind-mismatch": "Wakeflow durable ID kind does not match the expected kind.",
};
/**
 * Wakeflow 持久身份词法失败的稳定错误。
 *
 * 错误不回显 ID、UUID 或未知类别。底层随机源失败仍保持 `UuidV4Error`，不会被
 * 伪装成本层的格式错误。
 */
export class WakeflowDurableIdError extends Error {
    name = "WakeflowDurableIdError";
    code = "wakeflow-durable-id";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function normalizeErrorPath(path) {
    return typeof path === "string" && path.length > 0 ? path : "$";
}
function fail(reason, path) {
    throw new WakeflowDurableIdError(reason, path);
}
function isWakeflowDurableIdKind(value) {
    return typeof value === "string" && WAKEFLOW_DURABLE_ID_KIND_SET.has(value);
}
function parseWakeflowDurableIdKind(value, path) {
    if (!isWakeflowDurableIdKind(value))
        fail("kind-unknown", path);
    return value;
}
function parseUuidComponent(value, path) {
    try {
        return parseUuidV4(value, path);
    }
    catch (error) {
        if (error instanceof UuidV4Error)
            fail("uuid-format", path);
        throw error;
    }
}
function parseDurableId(value, path) {
    if (typeof value !== "string")
        fail("format", path);
    const separatorIndex = value.indexOf("_");
    if (separatorIndex <= 0 || separatorIndex !== value.lastIndexOf("_")) {
        fail("format", path);
    }
    const kind = parseWakeflowDurableIdKind(value.slice(0, separatorIndex), path);
    const uuid = parseUuidComponent(value.slice(separatorIndex + 1), path);
    const typedValue = value;
    // 记录只携带已验证的字符串事实；冻结后调用方无法改写 kind 与 value 的关联。
    return Object.freeze({
        kind,
        uuid,
        value: typedValue,
    });
}
/**
 * 创建指定类别的 Wakeflow 持久标识。
 *
 * 函数在生成随机数前复验标识类别。省略 `uuid` 时使用 `uuid-v4` 的 Node.js 随机源；
 * 确定性调用应显式传入已经由 `createUuidV4` 或 `parseUuidV4` 授予品牌类型的
 * `UuidV4`，本层不重复暴露 UUID 工厂。
 */
export function createWakeflowDurableId(kind, uuid) {
    const admittedKind = parseWakeflowDurableIdKind(kind, "$kind");
    const admittedUuid = uuid === undefined ? createUuidV4() : parseUuidComponent(uuid, "$uuid");
    return `${admittedKind}_${admittedUuid}`;
}
/**
 * 解析任意已知类别的 Wakeflow 持久标识，返回冻结的判别词法事实。
 *
 * 本函数不执行字符串强制转换，也不会把绑定、租约或操作 ID 当作
 * 未知持久标识类别的兼容别名。
 */
export function parseWakeflowDurableId(value, errorPath) {
    return parseDurableId(value, normalizeErrorPath(errorPath));
}
/**
 * 解析并收窄为调用方要求的唯一类别，直接返回对应的品牌字符串。
 *
 * 这是记录解析器最常用的入口；`kind` 不一致时不会返回宽泛 ID，也不查找
 * 目标实体是否存在。
 */
export function parseWakeflowDurableIdOfKind(value, expectedKind, errorPath) {
    const path = normalizeErrorPath(errorPath);
    const admittedExpectedKind = parseWakeflowDurableIdKind(expectedKind, "$expectedKind");
    const parsed = parseDurableId(value, path);
    if (parsed.kind !== admittedExpectedKind)
        fail("kind-mismatch", path);
    return parsed.value;
}
