import { encodeCanonicalJson } from "../foundation/data/canonical-json.js";
import { parseJsonValue } from "../foundation/data/json-value.js";
import { fail } from "./error.js";
const TOOL_NAME_PATTERN = /^wakeflow_[a-z][a-z0-9_]{2,62}$/u;
const SLICE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u;
const EXECUTOR_PATTERN = /^[a-z][A-Za-z0-9]{0,63}$/u;
const SCHEMA_ID_PATTERN = /^urn:wakeflow:entrypoints:([a-z0-9-]+)-(request|result):v1$/u;
const TITLE_MAXIMUM_LENGTH = 80;
/** ADR-0004：描述压到一到两句工作流描述；边界说明进 server instructions 或技能。 */
export const WAKEFLOW_TOOL_DESCRIPTION_MAXIMUM_BYTES = 640;
const WAKEFLOW_TOOL_CATALOG_MAXIMUM_TOOLS = 32;
function schemaStem(schema, kind, path) {
    const id = schema.$id;
    const match = typeof id === "string" ? SCHEMA_ID_PATTERN.exec(id) : null;
    if (match === null || match[2] !== kind || typeof schema.type !== "string") {
        fail("unexpected", `tool-catalog-${kind}-schema`, path);
    }
    return match[1];
}
function assertAnnotationsFitShape(registration, path) {
    const { annotations, shape } = registration;
    if (typeof annotations !== "object" ||
        annotations === null ||
        annotations.openWorldHint !== false ||
        typeof annotations.readOnlyHint !== "boolean" ||
        typeof annotations.destructiveHint !== "boolean" ||
        typeof annotations.idempotentHint !== "boolean") {
        fail("unexpected", "tool-catalog-annotations", path);
    }
    const consistent = shape === "read"
        ? annotations.readOnlyHint && !annotations.destructiveHint && annotations.idempotentHint
        : shape === "append"
            ? !annotations.readOnlyHint && annotations.idempotentHint
            : !annotations.readOnlyHint;
    if (!consistent)
        fail("unexpected", "tool-catalog-shape", path);
}
/** 准入一份登记表：名字、绑定名与 Schema 身份唯一，注解与调用形状一致。 */
export function createWakeflowToolCatalog(registrations) {
    if (!Array.isArray(registrations)) {
        fail("unexpected", "tool-catalog-input", "$catalog");
    }
    if (registrations.length > WAKEFLOW_TOOL_CATALOG_MAXIMUM_TOOLS) {
        fail("unexpected", "tool-catalog-capacity", "$catalog");
    }
    const names = new Set();
    const executors = new Set();
    const stems = new Set();
    const tools = registrations.map((registration, index) => {
        const path = `$catalog/${index}`;
        if (typeof registration !== "object" ||
            registration === null ||
            !TOOL_NAME_PATTERN.test(registration.name) ||
            !SLICE_PATTERN.test(registration.slice) ||
            !EXECUTOR_PATTERN.test(registration.executor) ||
            (registration.shape !== "read" &&
                registration.shape !== "append" &&
                registration.shape !== "effect") ||
            typeof registration.title !== "string" ||
            registration.title.length === 0 ||
            registration.title.length > TITLE_MAXIMUM_LENGTH ||
            typeof registration.description !== "string" ||
            registration.description.length === 0 ||
            Buffer.byteLength(registration.description, "utf8") > WAKEFLOW_TOOL_DESCRIPTION_MAXIMUM_BYTES) {
            fail("unexpected", "tool-catalog-registration", path);
        }
        if (names.has(registration.name)) {
            fail("unexpected", "tool-catalog-duplicate-name", path);
        }
        if (executors.has(registration.executor)) {
            fail("unexpected", "tool-catalog-duplicate-executor", path);
        }
        const requestStem = schemaStem(registration.requestSchema, "request", path);
        const resultStem = schemaStem(registration.resultSchema, "result", path);
        if (requestStem !== resultStem || stems.has(requestStem)) {
            fail("unexpected", "tool-catalog-schema-stem", path);
        }
        assertAnnotationsFitShape(registration, path);
        names.add(registration.name);
        executors.add(registration.executor);
        stems.add(requestStem);
        return Object.freeze({
            name: registration.name,
            slice: registration.slice,
            shape: registration.shape,
            executor: registration.executor,
            title: registration.title,
            description: registration.description,
            requestSchema: registration.requestSchema,
            resultSchema: registration.resultSchema,
            annotations: Object.freeze({
                readOnlyHint: registration.annotations.readOnlyHint,
                destructiveHint: registration.annotations.destructiveHint,
                idempotentHint: registration.annotations.idempotentHint,
                openWorldHint: false,
            }),
        });
    });
    return Object.freeze({ tools: Object.freeze(tools) });
}
/** 公开投影：只带请求 Schema；结果 Schema 由服务端校验，不进 `tools/list`。 */
export function publicToolDefinition(registration) {
    return Object.freeze({
        name: registration.name,
        title: registration.title,
        description: registration.description,
        inputSchema: registration.requestSchema,
        annotations: registration.annotations,
    });
}
export function findWakeflowToolRegistration(catalog, name) {
    return catalog.tools.find((tool) => tool.name === name) ?? null;
}
/** 公开目录的规范 JSON 字节数，作为 `tools/list` 体积预算的度量基准。 */
export function measureWakeflowToolCatalogBytes(catalog) {
    return encodeCanonicalJson(parseJsonValue(catalog.tools.map(publicToolDefinition), "$catalog"), "$catalog").byteLength;
}
