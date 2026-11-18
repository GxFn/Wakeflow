/**
 * Wakeflow Governance / Result：任务包之外收到的指示（ADR-0030 决定 3）。
 *
 * 使用者直接对目标窗口说话、别的会话发来消息，系统里原来没有任何记录。记录版本 2 的两类报告都带这一项：
 * 谁给的、说了什么、怎么处理的。没有收到就是空数组，不省略——"没有"也是一个要申报的事实。它是目标的自述，
 * 不是宿主观察；评审单元把它与 Wakeflow 自己的观察并排给出，判断留给 Controller。
 */

export const TARGET_RESULT_OUTSIDE_INSTRUCTION_SOURCES = Object.freeze([
  "user",
  "other-session",
  "unknown",
] as const);
export type TargetResultOutsideInstructionSource =
  (typeof TARGET_RESULT_OUTSIDE_INSTRUCTION_SOURCES)[number];

/** followed：不改合同，照做了；declined：与任务包冲突，没有照做；escalated：停下来上报。 */
export const TARGET_RESULT_OUTSIDE_INSTRUCTION_HANDLINGS = Object.freeze([
  "followed",
  "declined",
  "escalated",
] as const);
export type TargetResultOutsideInstructionHandling =
  (typeof TARGET_RESULT_OUTSIDE_INSTRUCTION_HANDLINGS)[number];

export interface TargetResultOutsideInstruction {
  readonly source: TargetResultOutsideInstructionSource;
  readonly summary: string;
  readonly handling: TargetResultOutsideInstructionHandling;
}

const OUTSIDE_INSTRUCTIONS_MAXIMUM = 16;

/** 两类报告各有自己的错误类与文本规则：解析时由调用方给出取成员、取文本与失败的做法。 */
export interface OutsideInstructionParsing {
  readonly record: (
    value: unknown,
    fields: readonly string[],
    path: string,
  ) => Readonly<Record<string, unknown>>;
  readonly text: (value: unknown, path: string) => string;
  readonly fail: (path: string) => never;
}

function member<Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  path: string,
  parsing: Readonly<OutsideInstructionParsing>,
): Value {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    parsing.fail(path);
  }
  return value as Value;
}

export function parseTargetResultOutsideInstructions(
  value: unknown,
  path: string,
  parsing: Readonly<OutsideInstructionParsing>,
): readonly Readonly<TargetResultOutsideInstruction>[] {
  if (!Array.isArray(value) || value.length > OUTSIDE_INSTRUCTIONS_MAXIMUM) parsing.fail(path);
  return Object.freeze(
    value.map((entry, index) => {
      const entryPath = `${path}/${index}`;
      const record = parsing.record(entry, ["handling", "source", "summary"], entryPath);
      return Object.freeze({
        source: member(
          record.source,
          TARGET_RESULT_OUTSIDE_INSTRUCTION_SOURCES,
          `${entryPath}/source`,
          parsing,
        ),
        summary: parsing.text(record.summary, `${entryPath}/summary`),
        handling: member(
          record.handling,
          TARGET_RESULT_OUTSIDE_INSTRUCTION_HANDLINGS,
          `${entryPath}/handling`,
          parsing,
        ),
      });
    }),
  );
}
