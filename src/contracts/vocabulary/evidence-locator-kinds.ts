/**
 * Wakeflow Contracts / Vocabulary：证据定位符的闭集种类（能力卡 8 Q2；能力卡 7 修订）。
 *
 * L1 result-review 切片只接受能在同一 Demand 的受管证据记录内解析的种类；evidence
 * 切片追加 `hook-observation` 与 `link` 并扩展解析根。消费者以 `never` 守卫穷尽。
 */

export const EVIDENCE_LOCATOR_KINDS = Object.freeze([
  "test-output",
  "diff",
  "document",
  "transcript",
  "commit",
] as const);

export type EvidenceLocatorKind = (typeof EVIDENCE_LOCATOR_KINDS)[number];

const KIND_SET: ReadonlySet<string> = new Set(EVIDENCE_LOCATOR_KINDS);

export function isEvidenceLocatorKind(value: unknown): value is EvidenceLocatorKind {
  return typeof value === "string" && KIND_SET.has(value);
}
