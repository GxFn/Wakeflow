/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-verify-result.schema.json
 */

export type UtcInstant = string
export type Sha256Digest = string
export type Count = number
export type Token = string
export type Code = string
export type PortableResourcePath = string

/**
 * wakeflow_verify 的结果：工作区级门集合与汇总，ok 要求至少一门且全部 pass；unavailable 算不通过但与 fail 分开计数；带 demandId 时附该 Demand 的门。repairsApplied 恒为 false。
 */
export interface WakeflowVerifyResultV1 {
kind: "WakeflowVerification"
schemaVersion: 1
tool: "wakeflow_verify"
observedAt: UtcInstant
configDigest: Sha256Digest
ok: boolean
summary: {
pass: Count
fail: Count
unavailable: Count
}
/**
 * @maxItems 64
 */
gates: Gate[]
demand: (null | DemandGates)
repairsApplied: false
observationDigest: Sha256Digest
next: NextProjection
}
export interface Gate {
name: Token
owner: Token
status: ("pass" | "fail" | "unavailable")
code: (null | Code)
/**
 * @maxItems 64
 */
evidence: {
ref: PortableResourcePath
digest: Sha256Digest
}[]
}
export interface DemandGates {
demandId: string
status: ("current" | "archived" | "unknown")
/**
 * @maxItems 16
 */
gates: []|[{
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}]|[{
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}]|[{
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}]|[{
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}]|[{
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}]|[{
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}]|[{
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}]|[{
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}]|[{
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}]|[{
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}]|[{
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}]|[{
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}]|[{
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}]|[{
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}]|[{
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}]|[{
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}, {
gate: Token
status: ("pass" | "fail" | "unavailable")
detail: (null | Code)
}]
observationDigest: (null | Sha256Digest)
}
export interface NextProjection {
frontier: (null | Token)
owner: ("controller" | "target" | "test" | "user" | "none")
suggestedTool: (null | string)
/**
 * @maxItems 64
 */
blockers: Code[]
}

/** 递归冻结生成的 Schema，阻止校验器首次使用前发生嵌套漂移。 */
function freezeGeneratedSchema<Value>(value: Value): Readonly<Value> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeGeneratedSchema(child);
    Object.freeze(value);
  }
  return value;
}

/** 从 JSON 文本恢复 Schema，保留 `__proto__` 等普通 JSON 自有键。 */
function restoreGeneratedSchema(
  serialized: string,
): Readonly<Record<string, unknown>> {
  const value: unknown = JSON.parse(serialized);
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError("Generated Schema must be an object.");
  }
  return freezeGeneratedSchema(value as Record<string, unknown>);
}

/** Ajv 严格校验器使用的 Schema 派生运行时权威；不得手工修改。 */
export const WAKEFLOW_VERIFY_RESULT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:verify-result:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_VERIFY_RESULT_SCHEMA\",\"title\":\"WakeflowVerifyResultV1\",\"description\":\"wakeflow_verify 的结果：工作区级门集合与汇总，ok 要求至少一门且全部 pass；unavailable 算不通过但与 fail 分开计数；带 demandId 时附该 Demand 的门。repairsApplied 恒为 false。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"observedAt\",\"configDigest\",\"ok\",\"summary\",\"gates\",\"demand\",\"repairsApplied\",\"observationDigest\",\"next\"],\"properties\":{\"kind\":{\"const\":\"WakeflowVerification\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_verify\"},\"observedAt\":{\"$ref\":\"#/$defs/utcInstant\"},\"configDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"ok\":{\"type\":\"boolean\"},\"summary\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"pass\",\"fail\",\"unavailable\"],\"properties\":{\"pass\":{\"$ref\":\"#/$defs/count\"},\"fail\":{\"$ref\":\"#/$defs/count\"},\"unavailable\":{\"$ref\":\"#/$defs/count\"}}},\"gates\":{\"type\":\"array\",\"maxItems\":64,\"items\":{\"$ref\":\"#/$defs/gate\"}},\"demand\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/demandGates\"}]},\"repairsApplied\":{\"const\":false},\"observationDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"next\":{\"$ref\":\"#/$defs/nextProjection\"}},\"$defs\":{\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"utcInstant\":{\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\"},\"portableResourcePath\":{\"type\":\"string\",\"minLength\":1,\"pattern\":\"^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\\\\.{1,2}(?:/|$))(?!.*\\\\/\\\\.{1,2}(?:/|$))(?!.*\\\\\\\\)(?!.*//)(?!.*\\\\/$)(?!\\\\s)(?!.*\\\\s$)(?!.*\\\\/\\\\s)(?!.*\\\\s\\\\/)(?!.*[\\\\u0000-\\\\u001F\\\\u007F-\\\\u009F]).+$\"},\"count\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":100000},\"token\":{\"type\":\"string\",\"pattern\":\"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$\"},\"code\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":256,\"pattern\":\"^[A-Za-z0-9][A-Za-z0-9._:,/-]{0,255}$\"},\"gate\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"name\",\"owner\",\"status\",\"code\",\"evidence\"],\"properties\":{\"name\":{\"$ref\":\"#/$defs/token\"},\"owner\":{\"$ref\":\"#/$defs/token\"},\"status\":{\"enum\":[\"pass\",\"fail\",\"unavailable\"]},\"code\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/code\"}]},\"evidence\":{\"type\":\"array\",\"maxItems\":64,\"items\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"ref\",\"digest\"],\"properties\":{\"ref\":{\"$ref\":\"#/$defs/portableResourcePath\"},\"digest\":{\"$ref\":\"#/$defs/sha256Digest\"}}}}}},\"demandGates\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"demandId\",\"status\",\"gates\",\"observationDigest\"],\"properties\":{\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"status\":{\"enum\":[\"current\",\"archived\",\"unknown\"]},\"gates\":{\"type\":\"array\",\"maxItems\":16,\"items\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"gate\",\"status\",\"detail\"],\"properties\":{\"gate\":{\"$ref\":\"#/$defs/token\"},\"status\":{\"enum\":[\"pass\",\"fail\",\"unavailable\"]},\"detail\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/code\"}]}}}},\"observationDigest\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/sha256Digest\"}]}}},\"nextProjection\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"frontier\",\"owner\",\"suggestedTool\",\"blockers\"],\"properties\":{\"frontier\":{\"oneOf\":[{\"type\":\"null\"},{\"$ref\":\"#/$defs/token\"}]},\"owner\":{\"enum\":[\"controller\",\"target\",\"test\",\"user\",\"none\"]},\"suggestedTool\":{\"oneOf\":[{\"type\":\"null\"},{\"type\":\"string\",\"pattern\":\"^wakeflow_[a-z][a-z0-9_]{2,62}$\"}]},\"blockers\":{\"type\":\"array\",\"maxItems\":64,\"items\":{\"$ref\":\"#/$defs/code\"}}}}}}");
