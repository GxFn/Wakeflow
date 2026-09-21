import { types } from "node:util";
const ERROR_MESSAGES = {
    "proxy": "Proxy values are not accepted by passive data readers.",
    "value-type": "The value is not an accepted data container.",
    "record-prototype": "The record does not have an accepted prototype.",
    "symbol-key": "Symbol-keyed properties are not accepted.",
    "non-enumerable-property": "Non-enumerable data properties are not accepted.",
    "accessor-property": "Accessor properties are not accepted.",
    "property-selection": "The property selection is not passive and well formed.",
    "array-prototype": "The array does not have the standard Array prototype.",
    "array-length": "The array length or configured length bound is invalid.",
    "array-slot": "The array contains a missing or invalid indexed slot.",
    "array-extra-property": "The array contains a non-indexed own property.",
};
/**
 * 自有数据属性读取失败时返回的稳定错误。
 *
 * 错误只暴露能力代码、失败分类和结构路径，不把成员值写入消息，避免错误日志
 * 意外携带令牌、提示词或其他业务数据。
 */
export class PassiveOwnDataError extends Error {
    name = "PassiveOwnDataError";
    code = "wakeflow-passive-own-data";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new PassiveOwnDataError(reason, path);
}
function normalizeErrorPath(path) {
    return typeof path === "string" && path.length > 0 ? path : "$";
}
function appendPropertyPath(basePath, key) {
    const escaped = key.replaceAll("~", "~0").replaceAll("/", "~1");
    return `${basePath}/${escaped}`;
}
function isObjectOrFunction(value) {
    return ((typeof value === "object" && value !== null)
        || typeof value === "function");
}
/**
 * 必须在任何反射操作之前拒绝 Proxy；Node.js 的原生检测不会触发代理陷阱。
 * 选择器把代理输入归为选择器错误，普通输入则保留独立的 `proxy` 分类。
 */
function rejectProxy(value, path, reason = "proxy") {
    if (isObjectOrFunction(value) && types.isProxy(value))
        fail(reason, path);
}
function readEnumerableDataValue(descriptor, path, missingReason = "accessor-property") {
    if (descriptor === undefined)
        fail(missingReason, path);
    if (!Object.hasOwn(descriptor, "value"))
        fail("accessor-property", path);
    if (descriptor.enumerable !== true)
        fail("non-enumerable-property", path);
    return descriptor.value;
}
function defineSnapshotProperty(snapshot, key, value) {
    Object.defineProperty(snapshot, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
    });
}
function parseCanonicalArrayIndex(key) {
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= 0xffff_ffff) {
        return undefined;
    }
    return String(index) === key ? index : undefined;
}
function readArrayLength(value, path) {
    const descriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
        fail("array-length", path);
    }
    const length = descriptor.value;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
        fail("array-length", path);
    }
    return length;
}
/**
 * 属性名列表也是输入数据，不能用普通数组读取隐式信任它。这里要求标准原型、
 * 稠密索引、可枚举数据属性、非空字符串和唯一值，并忽略所有成员行为。
 */
function parsePropertySelection(value, basePath) {
    const selectionPath = `${basePath}.keys`;
    rejectProxy(value, selectionPath, "property-selection");
    if (!Array.isArray(value))
        fail("property-selection", selectionPath);
    if (Object.getPrototypeOf(value) !== Array.prototype) {
        fail("property-selection", selectionPath);
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (lengthDescriptor === undefined || !Object.hasOwn(lengthDescriptor, "value")) {
        fail("property-selection", selectionPath);
    }
    const length = lengthDescriptor.value;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length <= 0) {
        fail("property-selection", selectionPath);
    }
    for (const ownKey of Reflect.ownKeys(value)) {
        if (ownKey === "length")
            continue;
        if (typeof ownKey === "symbol")
            fail("property-selection", selectionPath);
        const ownPath = appendPropertyPath(selectionPath, ownKey);
        const index = parseCanonicalArrayIndex(ownKey);
        if (index === undefined || index >= length)
            fail("property-selection", ownPath);
    }
    const selection = [];
    const seen = new Set();
    for (let index = 0; index < length; index += 1) {
        const indexPath = appendPropertyPath(selectionPath, String(index));
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined
            || !Object.hasOwn(descriptor, "value")
            || descriptor.enumerable !== true) {
            fail("property-selection", indexPath);
        }
        const key = descriptor.value;
        if (typeof key !== "string" || key.length === 0 || seen.has(key)) {
            fail("property-selection", indexPath);
        }
        seen.add(key);
        selection.push(key);
    }
    return selection;
}
/**
 * 将普通记录解析为新的、无原型、浅冻结数据快照。
 *
 * 只接受 `Object.prototype` 或 `null` 原型，并验证全部自有属性，因此调用者可
 * 确认源记录没有隐藏字段、Symbol 字段或访问器。成员值保持原引用。
 */
export function parsePlainRecord(value, errorPath) {
    const basePath = normalizeErrorPath(errorPath);
    rejectProxy(value, basePath);
    if (typeof value !== "object" || value === null)
        fail("value-type", basePath);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        fail("record-prototype", basePath);
    }
    const snapshot = Object.create(null);
    for (const ownKey of Reflect.ownKeys(value)) {
        if (typeof ownKey === "symbol")
            fail("symbol-key", basePath);
        const ownPath = appendPropertyPath(basePath, ownKey);
        const member = readEnumerableDataValue(Object.getOwnPropertyDescriptor(value, ownKey), ownPath);
        defineSnapshotProperty(snapshot, ownKey, member);
    }
    return Object.freeze(snapshot);
}
/**
 * 从对象中投影指定的自有数据属性，并返回新的、无原型、浅冻结快照。
 *
 * 与完整记录解析不同，本函数有意不枚举无关扩展字段，也不读取原型链。缺失键
 * 会被省略；必填性由了解业务语义的上层解析器负责。
 */
export function pickOwnDataProperties(value, keys, errorPath) {
    const basePath = normalizeErrorPath(errorPath);
    const selection = parsePropertySelection(keys, basePath);
    rejectProxy(value, basePath);
    if (typeof value !== "object" || value === null)
        fail("value-type", basePath);
    const snapshot = Object.create(null);
    for (const key of selection) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined)
            continue;
        const ownPath = appendPropertyPath(basePath, key);
        const member = readEnumerableDataValue(descriptor, ownPath);
        defineSnapshotProperty(snapshot, key, member);
    }
    // selection 已经验证为 Keys 的稠密字符串成员；此处只恢复编译器无法保留的键映射。
    return Object.freeze(snapshot);
}
/**
 * 将标准稠密数组解析为新的浅冻结数组。
 *
 * 长度上限由调用者按协议场景提供；本函数验证无空槽、无额外自有字段、无
 * Symbol 字段且每个索引都是可枚举数据属性。成员值保持原引用。
 */
export function parseDenseArray(value, maximumLength, errorPath) {
    const basePath = normalizeErrorPath(errorPath);
    if (!Number.isSafeInteger(maximumLength) || maximumLength < 0) {
        fail("array-length", basePath);
    }
    rejectProxy(value, basePath);
    if (!Array.isArray(value))
        fail("value-type", basePath);
    if (Object.getPrototypeOf(value) !== Array.prototype) {
        fail("array-prototype", basePath);
    }
    const length = readArrayLength(value, basePath);
    if (length > maximumLength)
        fail("array-length", basePath);
    for (const ownKey of Reflect.ownKeys(value)) {
        if (ownKey === "length")
            continue;
        if (typeof ownKey === "symbol")
            fail("symbol-key", basePath);
        const ownPath = appendPropertyPath(basePath, ownKey);
        const index = parseCanonicalArrayIndex(ownKey);
        if (index === undefined || index >= length)
            fail("array-extra-property", ownPath);
        readEnumerableDataValue(Object.getOwnPropertyDescriptor(value, ownKey), ownPath, "array-slot");
    }
    const snapshot = [];
    for (let index = 0; index < length; index += 1) {
        const ownPath = appendPropertyPath(basePath, String(index));
        const member = readEnumerableDataValue(Object.getOwnPropertyDescriptor(value, String(index)), ownPath, "array-slot");
        snapshot.push(member);
    }
    return Object.freeze(snapshot);
}
