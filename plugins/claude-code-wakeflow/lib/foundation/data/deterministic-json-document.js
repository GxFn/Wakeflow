import { hasPassiveJsonSerializationEnvironment, JsonValueError, parseJsonValue, } from "./json-value.js";
const ERROR_MESSAGES = {
    "input": "Deterministic JSON document input is invalid.",
    "json-syntax": "Deterministic JSON document syntax is invalid.",
    "non-deterministic": "JSON text does not use the deterministic pretty representation.",
    "render-failure": "Deterministic JSON document rendering failed after JSON admission.",
    "unsupported-type": "Deterministic JSON value contains an unsupported type.",
    "non-finite-number": "Deterministic JSON numbers must be finite.",
    "negative-zero": "Deterministic JSON does not accept negative zero.",
    "lone-surrogate": "Deterministic JSON text contains invalid Unicode.",
    "cycle": "Deterministic JSON values cannot contain cycles.",
    "maximum-depth": "Deterministic JSON exceeds its structural depth limit.",
    "invalid-container": "Deterministic JSON contains an invalid container.",
    "proxy": "Deterministic JSON does not accept Proxy values.",
    "record-prototype": "Deterministic JSON objects require a plain prototype.",
    "symbol-key": "Deterministic JSON objects cannot contain symbol keys.",
    "non-enumerable-property": "Deterministic JSON cannot contain hidden properties.",
    "accessor-property": "Deterministic JSON cannot contain accessors.",
    "array-prototype": "Deterministic JSON arrays require the standard prototype.",
    "array-slot": "Deterministic JSON arrays must be dense.",
    "array-extra-property": "Deterministic JSON arrays cannot contain extra properties.",
};
/** 确定性格式化 JSON 准入或渲染失败时返回的稳定、脱敏错误。 */
export class DeterministicJsonDocumentError extends Error {
    name = "DeterministicJsonDocumentError";
    code = "wakeflow-deterministic-json-document";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new DeterministicJsonDocumentError(reason, path);
}
function assertNoInheritedArrayToJson(path) {
    if (!hasPassiveJsonSerializationEnvironment())
        fail("render-failure", path);
}
function normalizePath(value) {
    return typeof value === "string" && value.length > 0 ? value : "$document";
}
function admitJsonValue(value, path) {
    try {
        return parseJsonValue(value, path);
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail(error.reason, error.path);
        throw error;
    }
}
function renderAdmitted(value, path) {
    assertNoInheritedArrayToJson(path);
    let rendered;
    try {
        rendered = JSON.stringify(value, null, 2);
    }
    catch {
        fail("render-failure", path);
    }
    if (typeof rendered !== "string")
        fail("render-failure", path);
    return `${rendered}\n`;
}
/**
 * 将任意无副作用 JSON 数据值渲染为确定性格式化文本。
 *
 * 调用方如果要求特定领域字段顺序，必须先传入按该顺序重建的模型。本函数不会根据
 * 字典序、Schema 的 `properties` 或历史输入顺序替调用方决定领域表示；最终键顺序
 * 仍遵循 ECMAScript 的自有键枚举规则。
 */
export function renderDeterministicJsonDocument(value, errorPath) {
    const path = normalizePath(errorPath);
    return renderAdmitted(admitJsonValue(value, path), path);
}
/**
 * 解析并验证确定性格式化 JSON 文本。
 *
 * 成功结果是与输入容器解除引用关系、递归冻结的 `JsonValue`。重复键会在重新渲染
 * 时消失，因此与其他表示漂移一样被拒绝；本函数不执行自动格式化或兼容修复。
 */
export function parseDeterministicJsonDocument(text, errorPath) {
    const path = normalizePath(errorPath);
    if (typeof text !== "string")
        fail("input", path);
    let decoded;
    try {
        decoded = JSON.parse(text);
    }
    catch {
        fail("json-syntax", path);
    }
    const value = admitJsonValue(decoded, path);
    if (renderAdmitted(value, path) !== text)
        fail("non-deterministic", path);
    return value;
}
