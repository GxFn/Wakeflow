/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/ledger/ledger-record-publication-intent.schema.json
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
export const WAKEFLOW_LEDGER_RECORD_PUBLICATION_INTENT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:ledger:record-publication-intent:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_LEDGER_RECORD_PUBLICATION_INTENT_SCHEMA\",\"title\":\"WakeflowLedgerRecordPublicationIntent\",\"description\":\"Ledger immutable record tree 整体发布的短期元数据意图。\",\"$comment\":\"Intent 保存 exact record、物理 refs 与关闭树摘要，但不重复保存可由 record 推导的 family/recordId，也不复制 member payload；完整 stage 是待发布数据，final directory rename 是 authority commit point。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"record\",\"finalRootRef\",\"intentRef\",\"lockRef\",\"stageRef\",\"treePlan\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-ledger-record-publication-intent\"},\"schemaVersion\":{\"const\":1},\"record\":{\"$ref\":\"urn:wakeflow:governance:ledger:requirement-record:v1\"},\"finalRootRef\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"intentRef\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"lockRef\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"stageRef\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:portable-resource-path:v1\"},\"treePlan\":{\"$ref\":\"urn:wakeflow:foundation:filesystem:directory-tree-candidate-plan:v1\"}}}");
