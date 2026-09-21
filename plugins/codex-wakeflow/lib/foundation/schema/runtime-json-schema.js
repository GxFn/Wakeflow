import { Ajv2020 } from "ajv/dist/2020.js";
import { JsonValueError, parseJsonValue, } from "../data/json-value.js";
import { parseDenseArray, PassiveOwnDataError, } from "../data/passive-own-data.js";
const ERROR_MESSAGES = {
    "schema-input": "Runtime JSON Schema input is invalid.",
    "schema-dependency": "Runtime JSON Schema dependency catalog is invalid.",
    "schema-compile": "Runtime JSON Schema catalog could not be compiled strictly.",
};
/** 运行时 Schema 目录构建或编译失败时返回的稳定、脱敏错误。 */
export class RuntimeJsonSchemaError extends Error {
    name = "RuntimeJsonSchemaError";
    code = "wakeflow-runtime-json-schema";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new RuntimeJsonSchemaError(reason, path);
}
function schemaObject(value, path, reason) {
    let admitted;
    try {
        admitted = parseJsonValue(value, path);
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail(reason, error.path);
        throw error;
    }
    if (admitted === null ||
        Array.isArray(admitted) ||
        typeof admitted !== "object") {
        fail(reason, path);
    }
    // 上述准入已经排除原始值和 JsonArray；此处恢复 TypeScript 无法保留的只读类型收窄。
    return admitted;
}
function dependencySchemas(value) {
    let dependencies;
    try {
        dependencies = parseDenseArray(value, 64, "$dependencies");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError) {
            fail("schema-dependency", error.path);
        }
        throw error;
    }
    const result = [];
    const ids = new Set();
    for (const [index, dependency] of dependencies.entries()) {
        const path = `$dependencies/${index}`;
        const schema = schemaObject(dependency, path, "schema-dependency");
        const id = schema.$id;
        if (typeof id !== "string" || id.length === 0 || ids.has(id)) {
            fail("schema-dependency", `${path}/$id`);
        }
        ids.add(id);
        result.push(schema);
    }
    return Object.freeze(result);
}
function validationPath(instancePath) {
    return instancePath.length === 0 ? "$" : `$${instancePath}`;
}
/** 不调用对象方法地比较两个已准入JSON值，成员顺序不影响对象相等性。 */
function sameJsonValue(left, right) {
    if (left === right)
        return true;
    if (left === null ||
        right === null ||
        typeof left !== "object" ||
        typeof right !== "object") {
        return false;
    }
    const leftIsArray = Array.isArray(left);
    if (leftIsArray !== Array.isArray(right))
        return false;
    if (leftIsArray) {
        const leftArray = left;
        const rightArray = right;
        return (leftArray.length === rightArray.length &&
            leftArray.every((entry, index) => sameJsonValue(entry, rightArray[index])));
    }
    const leftRecord = left;
    const rightRecord = right;
    const leftKeys = Object.keys(leftRecord);
    if (leftKeys.length !== Object.keys(rightRecord).length)
        return false;
    return leftKeys.every((key) => Object.hasOwn(rightRecord, key) &&
        sameJsonValue(leftRecord[key], rightRecord[key]));
}
/** JSON Schema `uniqueItems`的无原型安全实现。 */
function uniqueJsonItems(enabled, value) {
    if (!enabled || !Array.isArray(value))
        return true;
    const items = value;
    for (let right = 1; right < items.length; right += 1) {
        for (let left = 0; left < right; left += 1) {
            if (sameJsonValue(items[left], items[right]))
                return false;
        }
    }
    return true;
}
/**
 * 为不访问网络的本地 Schema 目录返回可复用的校验器。
 *
 * Schema 目录的形状与 `$id` 在调用时立即准入；Ajv 实例与编译推迟到第一次校验，
 * 因此在模块初始化时创建校验器不再产生编译成本，未被使用的校验器永远不编译。
 * 每个校验器拥有独立的 Ajv 实例，避免不同领域 Schema 目录的 `$id`、格式或错误
 * 状态相互污染；编译失败在第一次校验时以 `schema-compile` 报出。
 */
export function createRuntimeJsonSchemaValidator(rootSchema, dependencies = []) {
    const root = schemaObject(rootSchema, "$schema", "schema-input");
    const admittedDependencies = dependencySchemas(dependencies);
    let compiled = null;
    return (value) => {
        if (compiled === null) {
            compiled = compileRuntimeJsonSchemaValidator(root, admittedDependencies);
        }
        return compiled(value);
    };
}
function compileRuntimeJsonSchemaValidator(root, admittedDependencies) {
    const ajv = new Ajv2020({
        allErrors: false,
        strict: true,
        validateSchema: true,
    });
    ajv.addFormat("regex", {
        type: "string",
        validate(value) {
            try {
                new RegExp(value, "u");
                return true;
            }
            catch {
                return false;
            }
        },
    });
    ajv.removeKeyword("uniqueItems");
    ajv.addKeyword({
        keyword: "uniqueItems",
        type: "array",
        schemaType: "boolean",
        validate: uniqueJsonItems,
        errors: false,
    });
    ajv.addKeyword({
        keyword: "x-wakeflow-runtime-export",
        schemaType: "string",
        valid: true,
        errors: false,
    });
    let validate;
    try {
        for (const dependency of admittedDependencies) {
            ajv.addSchema(dependency, dependency.$id);
        }
        validate = ajv.compile(root);
    }
    catch {
        fail("schema-compile", "$schema");
    }
    return (value) => {
        if (validate(value)) {
            return Object.freeze({ ok: true, value: value });
        }
        const first = validate.errors?.[0];
        return Object.freeze({
            ok: false,
            path: validationPath(first?.instancePath ?? ""),
        });
    };
}
