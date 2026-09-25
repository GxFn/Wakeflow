/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/demand/demand-authority.schema.json
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
export const WAKEFLOW_DEMAND_AUTHORITY_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:demand:authority:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_AUTHORITY_SCHEMA\",\"title\":\"WakeflowDemandAuthority\",\"description\":\"Demand publication 时必须存在并永久冻结的 Ledger authority closure。\",\"$comment\":\"Demand type role completeness、identity digest、requirement lineage binding、Ledger resolution 和 testing relations 由 Demand authority codec 继续校验。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"demandId\",\"identityDigest\",\"authorityRefs\",\"testingDecision\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-demand-authority\"},\"schemaVersion\":{\"const\":1},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"identityDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},\"authorityRefs\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":32,\"items\":{\"$ref\":\"urn:wakeflow:governance:ledger:authority-member-reference:v1\"}},\"testingDecision\":{\"$ref\":\"#/$defs/testingDecision\"}},\"$defs\":{\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"nonEmptyText\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":8192,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},\"testingDecision\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"mode\",\"summary\",\"environmentMemberRef\"],\"properties\":{\"mode\":{\"enum\":[\"controller-only\",\"real-environment\",\"not-applicable\"]},\"summary\":{\"$ref\":\"#/$defs/nonEmptyText\"},\"environmentMemberRef\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"}]}}}}}");
