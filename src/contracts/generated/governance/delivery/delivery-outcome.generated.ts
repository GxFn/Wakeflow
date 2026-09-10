/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/governance/delivery/delivery-outcome.schema.json
 */

/**
 * 一次投递代际的宿主效果处置：由 Wakeflow 按证据派生，记录证据种类、宿主记录标识与声明处置。
 */
export type WakeflowDeliveryOutcome = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowDeliveryOutcome"
schemaVersion: 1
deliveryId: DeliveryId
generation: number
fence: FenceRef
disposition: ("accepted" | "indeterminate" | "rejected-before-send")
attempt: {
status: ("sent" | "failed-before-send" | "unknown")
evidenceDigest: (WakeflowSha256DigestText | null)
}
readback: {
status: ("confirmed" | "pending" | "unavailable")
evidenceDigest: (WakeflowSha256DigestText | null)
}
evidence: {
kind: ("hook-record" | "host-send-return" | "agent-declaration" | "controller-resolution")
hookRecordId: (string | null)
rationale: (string | null)
}
claimHandling: ("retain" | "release-authorized")
observedAt: WakeflowUtcInstantText
outcomeDigest: WakeflowSha256DigestText
})
export type DeliveryId = string
export type ClaimId = string
/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
/**
 * Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。
 */
export type WakeflowUtcInstantText = string

export interface FenceRef {
claimId: ClaimId
claimDigest: WakeflowSha256DigestText
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
export const WAKEFLOW_DELIVERY_OUTCOME_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:governance:delivery:delivery-outcome:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DELIVERY_OUTCOME_SCHEMA\",\"title\":\"WakeflowDeliveryOutcome\",\"description\":\"一次投递代际的宿主效果处置：由 Wakeflow 按证据派生，记录证据种类、宿主记录标识与声明处置。\",\"$comment\":\"accepted 只来自目标会话的 user-prompt-submit hook 记录（prompt 摘要一致）、Codex 宿主发送调用的成功返回，或 Controller 对 indeterminate 的显式解决；rejected-before-send 只用于发送调用本身失败且未触碰目标会话；其余为 indeterminate 并保留声明。回读只是补充观察。\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"deliveryId\",\"generation\",\"fence\",\"disposition\",\"attempt\",\"readback\",\"evidence\",\"claimHandling\",\"observedAt\",\"outcomeDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowDeliveryOutcome\"},\"schemaVersion\":{\"const\":1},\"deliveryId\":{\"$ref\":\"#/$defs/deliveryId\"},\"generation\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":4},\"fence\":{\"$ref\":\"#/$defs/fenceRef\"},\"disposition\":{\"enum\":[\"accepted\",\"indeterminate\",\"rejected-before-send\"]},\"attempt\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\",\"evidenceDigest\"],\"properties\":{\"status\":{\"enum\":[\"sent\",\"failed-before-send\",\"unknown\"]},\"evidenceDigest\":{\"oneOf\":[{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},{\"type\":\"null\"}]}}},\"readback\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"status\",\"evidenceDigest\"],\"properties\":{\"status\":{\"enum\":[\"confirmed\",\"pending\",\"unavailable\"]},\"evidenceDigest\":{\"oneOf\":[{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"},{\"type\":\"null\"}]}}},\"evidence\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"hookRecordId\",\"rationale\"],\"properties\":{\"kind\":{\"enum\":[\"hook-record\",\"host-send-return\",\"agent-declaration\",\"controller-resolution\"]},\"hookRecordId\":{\"oneOf\":[{\"type\":\"string\",\"minLength\":1,\"maxLength\":256,\"pattern\":\"^[A-Za-z0-9._:-]{1,256}$\"},{\"type\":\"null\"}]},\"rationale\":{\"oneOf\":[{\"type\":\"string\",\"minLength\":1,\"maxLength\":2048,\"pattern\":\"^(?!\\\\s)[\\\\s\\\\S]*\\\\S$\"},{\"type\":\"null\"}]}}},\"claimHandling\":{\"enum\":[\"retain\",\"release-authorized\"]},\"observedAt\":{\"$ref\":\"urn:wakeflow:foundation:time:utc-instant:v1\"},\"outcomeDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}},\"allOf\":[{\"if\":{\"properties\":{\"disposition\":{\"const\":\"rejected-before-send\"}},\"required\":[\"disposition\"]},\"then\":{\"properties\":{\"claimHandling\":{\"const\":\"release-authorized\"}}},\"else\":{\"properties\":{\"claimHandling\":{\"const\":\"retain\"}}}},{\"if\":{\"properties\":{\"disposition\":{\"const\":\"accepted\"}},\"required\":[\"disposition\"]},\"then\":{\"properties\":{\"evidence\":{\"type\":\"object\",\"properties\":{\"kind\":{\"enum\":[\"hook-record\",\"host-send-return\",\"controller-resolution\"]}}}}}},{\"if\":{\"properties\":{\"disposition\":{\"const\":\"indeterminate\"}},\"required\":[\"disposition\"]},\"then\":{\"properties\":{\"evidence\":{\"type\":\"object\",\"properties\":{\"kind\":{\"const\":\"agent-declaration\"}}}}}},{\"if\":{\"properties\":{\"evidence\":{\"type\":\"object\",\"properties\":{\"kind\":{\"const\":\"hook-record\"}},\"required\":[\"kind\"]}},\"required\":[\"evidence\"]},\"then\":{\"properties\":{\"evidence\":{\"type\":\"object\",\"properties\":{\"hookRecordId\":{\"type\":\"string\"}}}}}},{\"if\":{\"properties\":{\"evidence\":{\"type\":\"object\",\"properties\":{\"kind\":{\"const\":\"controller-resolution\"}},\"required\":[\"kind\"]}},\"required\":[\"evidence\"]},\"then\":{\"properties\":{\"evidence\":{\"type\":\"object\",\"properties\":{\"rationale\":{\"type\":\"string\"}}}}}}],\"$defs\":{\"deliveryId\":{\"type\":\"string\",\"pattern\":\"^target-delivery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"claimId\":{\"type\":\"string\",\"pattern\":\"^work-claim_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"fenceRef\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"claimId\",\"claimDigest\"],\"properties\":{\"claimId\":{\"$ref\":\"#/$defs/claimId\"},\"claimDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}}}}");
