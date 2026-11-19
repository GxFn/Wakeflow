import {
  parseUtcInstant,
  type UtcInstant,
  UtcInstantError,
} from "../../foundation/time/utc-instant.js";

/**
 * Wakeflow Governance / Result：目标会话里的越级 prompt 的观察（open-items H13，1.4 第 4 段）。
 *
 * 使用者直接对产品窗口说话、别的会话发来消息——这些不经 Controller 的指示原来不留任何痕迹。目标导入
 * 结果的那一刻，Wakeflow 自己数一遍：从这份投递的落地记录到导入，目标会话里提交过几条 prompt，其中几条
 * 带着 Wakeflow 的许可身份（重新武装的投递）、几条是 Controller 推过的续跑短句、其余的就是任务包之外
 * 来的。只记条数与时刻，不记内容、摘要与会话标识。它与目标自己申报的 `outsideInstructions` 并排给评审者：
 * 一个是宿主观察，一个是自述，判断留给 Controller。
 *
 * 观察随结果事件落盘（事件数据版本 2 的可选成员），所以归档里有它；没有落地记录可当起点的宿主（落地
 * 由发送返回证明的情形）报 `unobserved`，不假装是零条。
 */

export const TARGET_SESSION_PROMPT_UNOBSERVED_REASONS = Object.freeze([
  /** 这份投递的结局没有落地记录（落地由发送返回或 Agent 的陈述证明）：区间没有起点。 */
  "landing-record-absent",
  /** 结局点名的落地记录已经读不到（被清理、被移动）。 */
  "landing-record-unreadable",
  /** 目标会话的记录这一刻读不全。 */
  "records-unavailable",
] as const);
export type TargetSessionPromptUnobservedReason =
  (typeof TARGET_SESSION_PROMPT_UNOBSERVED_REASONS)[number];

/** 任务包之外的 prompt 至多列出这么多个时刻（最早的那些）；条数照实给。 */
export const TARGET_SESSION_OUTSIDE_PROMPT_TIMES_MAXIMUM = 16;
const COUNT_MAXIMUM = 16_384;

export interface TargetSessionPromptObservation {
  readonly status: "observed" | "unobserved";
  readonly reason: TargetSessionPromptUnobservedReason | null;
  /** 区间起点：这份投递的落地记录的时刻；未观察时为 null。 */
  readonly from: UtcInstant | null;
  /** 区间终点：结果导入的时刻。 */
  readonly until: UtcInstant;
  /** 带 Wakeflow 许可身份的 prompt（落地那一条不计）。 */
  readonly permitPrompts: number;
  /** 与 Controller 推过的续跑短句对得上的 prompt。 */
  readonly nudgePrompts: number;
  /** 其余的：任务包之外来的 prompt。 */
  readonly outsidePrompts: number;
  readonly outsideAt: readonly UtcInstant[];
}

export class TargetSessionPromptObservationError extends Error {
  override readonly name = "TargetSessionPromptObservationError";
  readonly path: string;

  constructor(path: string, options?: ErrorOptions) {
    super("Target session prompt observation is invalid.", options);
    this.path = path;
  }
}

function fail(path: string, cause?: unknown): never {
  throw new TargetSessionPromptObservationError(path, cause === undefined ? undefined : { cause });
}

function count(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(path);
  if (value > COUNT_MAXIMUM) fail(path);
  return value;
}

function instant(value: unknown, path: string): UtcInstant {
  try {
    return parseUtcInstant(value, path);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail(path, error);
    throw error;
  }
}

const FIELDS = Object.freeze([
  "from",
  "nudgePrompts",
  "outsideAt",
  "outsidePrompts",
  "permitPrompts",
  "reason",
  "status",
  "until",
] as const);

function plainRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path);
  const record = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record).sort();
  if (keys.length !== FIELDS.length || keys.some((key, index) => key !== FIELDS[index])) {
    fail(path);
  }
  return record;
}

function unobservedReason(value: unknown, path: string): TargetSessionPromptUnobservedReason {
  if (
    typeof value !== "string" ||
    !(TARGET_SESSION_PROMPT_UNOBSERVED_REASONS as readonly string[]).includes(value)
  ) {
    fail(path);
  }
  return value as TargetSessionPromptUnobservedReason;
}

/** 严格解析：成员齐全、计数与时刻合法，并且两种状态各自自洽。 */
export function parseTargetSessionPromptObservation(
  value: unknown,
  path = "$sessionPrompts",
): Readonly<TargetSessionPromptObservation> {
  const record = plainRecord(value, path);
  const until = instant(record.until, `${path}/until`);
  if (record.status === "unobserved") {
    const reason = unobservedReason(record.reason, `${path}/reason`);
    const empty =
      record.from === null &&
      record.permitPrompts === 0 &&
      record.nudgePrompts === 0 &&
      record.outsidePrompts === 0 &&
      Array.isArray(record.outsideAt) &&
      record.outsideAt.length === 0;
    if (!empty) fail(path);
    return unobservedTargetSessionPrompts(reason, until);
  }
  if (record.status !== "observed" || record.reason !== null) fail(`${path}/status`);
  const from = instant(record.from, `${path}/from`);
  const outsidePrompts = count(record.outsidePrompts, `${path}/outsidePrompts`);
  if (!Array.isArray(record.outsideAt)) fail(`${path}/outsideAt`);
  const outsideAt = record.outsideAt.map((entry, index) =>
    instant(entry, `${path}/outsideAt/${index}`),
  );
  const expected = Math.min(outsidePrompts, TARGET_SESSION_OUTSIDE_PROMPT_TIMES_MAXIMUM);
  if (outsideAt.length !== expected || Date.parse(from) > Date.parse(until)) fail(path);
  return Object.freeze({
    status: "observed" as const,
    reason: null,
    from,
    until,
    permitPrompts: count(record.permitPrompts, `${path}/permitPrompts`),
    nudgePrompts: count(record.nudgePrompts, `${path}/nudgePrompts`),
    outsidePrompts,
    outsideAt: Object.freeze(outsideAt),
  });
}

export function unobservedTargetSessionPrompts(
  reason: TargetSessionPromptUnobservedReason,
  until: UtcInstant,
): Readonly<TargetSessionPromptObservation> {
  return Object.freeze({
    status: "unobserved" as const,
    reason,
    from: null,
    until,
    permitPrompts: 0,
    nudgePrompts: 0,
    outsidePrompts: 0,
    outsideAt: Object.freeze([]),
  });
}

/** 目标会话里的一条 prompt 记录：只取归类要用的三样。 */
export interface TargetSessionPromptRecord {
  readonly recordedAt: UtcInstant;
  readonly promptDigest: string | null;
  readonly promptPermitIds: readonly string[] | null;
}

/**
 * 把落地之后、导入之前的 prompt 记录归成三类。`records` 不含落地那一条；`nudgeDigests` 是这个窗口在
 * 区间里被推过的续跑短句的摘要。
 */
export function classifyTargetSessionPrompts(
  input: Readonly<{
    readonly from: UtcInstant;
    readonly until: UtcInstant;
    readonly records: readonly Readonly<TargetSessionPromptRecord>[];
    readonly nudgeDigests: ReadonlySet<string>;
  }>,
): Readonly<TargetSessionPromptObservation> {
  const from = Date.parse(input.from);
  const until = Date.parse(input.until);
  let permitPrompts = 0;
  let nudgePrompts = 0;
  const outside: UtcInstant[] = [];
  for (const record of input.records) {
    const at = Date.parse(record.recordedAt);
    if (at < from || at > until) continue;
    if ((record.promptPermitIds?.length ?? 0) > 0) permitPrompts += 1;
    else if (record.promptDigest !== null && input.nudgeDigests.has(record.promptDigest)) {
      nudgePrompts += 1;
    } else outside.push(record.recordedAt);
  }
  outside.sort((left, right) => Date.parse(left) - Date.parse(right));
  return Object.freeze({
    status: "observed" as const,
    reason: null,
    from: input.from,
    until: input.until,
    permitPrompts,
    nudgePrompts,
    outsidePrompts: outside.length,
    outsideAt: Object.freeze(outside.slice(0, TARGET_SESSION_OUTSIDE_PROMPT_TIMES_MAXIMUM)),
  });
}
