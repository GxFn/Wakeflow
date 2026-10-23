/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-pod-request.schema.json
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
export const WAKEFLOW_POD_REQUEST_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:pod-request:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_POD_REQUEST_SCHEMA\",\"title\":\"WakeflowPodRequestV1\",\"description\":\"wakeflow_pod 的请求：preview 零写推导计划，apply 带 planDigest 执行一次配置事务，recover 按 podId 对账。create 建一个 worktree pod；close 两段关闭（先记分支处置，再在窗口退役、检出处置后删 pod）。只有 main 的 Controller 调用。\",\"type\":\"object\",\"oneOf\":[{\"$ref\":\"#/$defs/effectRequest\"},{\"$ref\":\"#/$defs/recoverRequest\"}],\"$defs\":{\"workspaceRoot\":{\"type\":\"string\",\"minLength\":1,\"description\":\"Absolute path of the existing Wakeflow workspace root; never returned.\"},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"podId\":{\"type\":\"string\",\"pattern\":\"^pod_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"repositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"podName\":{\"type\":\"string\",\"pattern\":\"^[a-z][a-z0-9-]{0,31}$\",\"description\":\"Short host-safe pod name; unique among live pods and never `main`. The worktree name is wakeflow-<name>.\"},\"idempotencyKey\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":128,\"pattern\":\"^[A-Za-z0-9._:-]{1,128}$\",\"description\":\"Client key the podId derives from; the same key replays the same pod as already-created.\"},\"createIntent\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"name\",\"idempotencyKey\"],\"properties\":{\"kind\":{\"const\":\"create\"},\"name\":{\"$ref\":\"#/$defs/podName\"},\"idempotencyKey\":{\"$ref\":\"#/$defs/idempotencyKey\"}}},\"branchDisposition\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"repositoryId\",\"disposition\"],\"properties\":{\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"},\"disposition\":{\"enum\":[\"merged\",\"abandoned\"],\"description\":\"How the developer disposed of this worktree branch; merging happens outside Wakeflow (ADR-0010 D5).\"}}},\"closeIntent\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"podId\",\"branches\"],\"properties\":{\"kind\":{\"const\":\"close\"},\"podId\":{\"$ref\":\"#/$defs/podId\"},\"branches\":{\"type\":\"array\",\"maxItems\":64,\"description\":\"One disposition per registered worktree; required on the first close phase, ignored once the pod is closing.\",\"items\":{\"$ref\":\"#/$defs/branchDisposition\"}}}},\"effectRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"intent\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"enum\":[\"preview\",\"apply\"]},\"planDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"intent\":{\"oneOf\":[{\"$ref\":\"#/$defs/createIntent\"},{\"$ref\":\"#/$defs/closeIntent\"}]}},\"allOf\":[{\"if\":{\"properties\":{\"mode\":{\"const\":\"apply\"}},\"required\":[\"mode\"]},\"then\":{\"required\":[\"planDigest\"],\"properties\":{\"planDigest\":true}},\"else\":{\"properties\":{\"planDigest\":false}}}]},\"recoverRequest\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"root\",\"mode\",\"podId\"],\"properties\":{\"root\":{\"$ref\":\"#/$defs/workspaceRoot\"},\"mode\":{\"const\":\"recover\"},\"podId\":{\"$ref\":\"#/$defs/podId\"}}}}}");
