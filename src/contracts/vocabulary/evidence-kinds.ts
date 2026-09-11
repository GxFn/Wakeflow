/**
 * Wakeflow Contracts / Vocabulary：证据种类的闭集（能力卡 8 Q2；能力卡 7 修订）。
 *
 * 受管证据记录的 `kind` 与结果报告里的证据定位符共用这一张表：`hook-observation` 与
 * `transcript` 来自宿主 hook 观察记录，`link` 与 `commit` 是只做定位的引用，其余三种
 * 是从配置根复制字节的记录。消费者以 `never` 守卫穷尽。
 */

export const EVIDENCE_KINDS = Object.freeze([
  "hook-observation",
  "transcript",
  "test-output",
  "diff",
  "document",
  "link",
  "commit",
] as const);

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

const KIND_SET: ReadonlySet<string> = new Set(EVIDENCE_KINDS);

export function isEvidenceKind(value: unknown): value is EvidenceKind {
  return typeof value === "string" && KIND_SET.has(value);
}
