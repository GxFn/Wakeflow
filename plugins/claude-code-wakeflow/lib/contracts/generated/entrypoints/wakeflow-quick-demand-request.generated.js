/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-quick-demand-request.schema.json
 */
/** 递归冻结生成的 Schema，阻止校验器首次使用前发生嵌套漂移。 */
function freezeGeneratedSchema(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        for (const child of Object.values(value))
            freezeGeneratedSchema(child);
        Object.freeze(value);
    }
    return value;
}
/** 从 JSON 文本恢复 Schema，保留 `__proto__` 等普通 JSON 自有键。 */
function restoreGeneratedSchema(serialized) {
    const value = JSON.parse(serialized);
    if (value === null || Array.isArray(value) || typeof value !== "object") {
        throw new TypeError("Generated Schema must be an object.");
    }
    return freezeGeneratedSchema(value);
}
/** Ajv 严格校验器使用的 Schema 派生运行时权威；不得手工修改。 */
export const WAKEFLOW_QUICK_DEMAND_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:quick-demand-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_QUICK_DEMAND_REQUEST_SCHEMA\",\"title\":\"WakeflowQuickDemandRequestV1\",\"description\":\"wakeflow_quick_demand request: one sentence and one repository; preview is zero-write, apply runs publish, claim, plan and prepare in order.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"repositoryId\",\"title\",\"request\"],\"properties\":{\"root\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":4096,\"description\":\"Absolute path of the existing Wakeflow workspace root.\"},\"mode\":{\"enum\":[\"preview\",\"apply\"]},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\",\"description\":\"apply only: the planDigest the preview returned.\"},\"repositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"title\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":120,\"pattern\":\"^(?!\\\\s)[^\\\\u0000-\\\\u001F\\\\u007F-\\\\u009F]*\\\\S$\"},\"request\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":2000,\"pattern\":\"^(?!\\\\s)(?![\\\\s\\\\S]*\\\\r)(?![\\\\s\\\\S]*[\\\\u0000-\\\\u0009\\\\u000b-\\\\u001f\\\\u007f-\\\\u009f])[\\\\s\\\\S]*\\\\S$\",\"description\":\"What the user asked for, in their words.\"},\"doneWhen\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":5,\"uniqueItems\":true,\"items\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":500,\"pattern\":\"^(?!\\\\s)[^\\\\u0000-\\\\u001F\\\\u007F-\\\\u009F]*\\\\S$\"},\"description\":\"One line per acceptance criterion; omitted, the request itself is the single criterion.\"},\"confirmation\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"confirmedAt\"],\"properties\":{\"confirmedAt\":{\"$ref\":\"#/$defs/utcInstant\"}},\"description\":\"apply only: when the user confirmed the preview.\"}},\"allOf\":[{\"if\":{\"properties\":{\"mode\":{\"const\":\"apply\"}},\"required\":[\"mode\"]},\"then\":{\"required\":[\"planDigest\",\"confirmation\"],\"properties\":{\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"confirmation\":{\"type\":\"object\"}}},\"else\":{\"properties\":{\"planDigest\":false,\"confirmation\":false}}}],\"$defs\":{\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"}}}");
