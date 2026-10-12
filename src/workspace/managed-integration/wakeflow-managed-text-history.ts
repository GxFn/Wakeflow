import type { WakeflowManagedTextEnvelopeTarget } from "./wakeflow-managed-text-envelope.js";

/**
 * Wakeflow Workspace / Managed Integration：托管正文的历史准入（open-items C5，§13.167）。
 *
 * 五种托管正文——程序指令块、外部指令块、仓库 `.gitignore` 块、支撑面 `.gitignore` 块、支撑面整文件
 * 记忆——都只准入"精确等于当前渲染"的已有正文。渲染器一改，每个已有工作区的 reconcile 与 local-layout
 * 门就以 unknown-managed-body / unadmitted-source 阻塞，出口只剩手删技能承诺不会覆盖的块。本模块是
 * 有界的版本演进接缝：每个组件一张历史渲染表，表项带退役版本与一个用相同输入重算旧正文的函数；生产者
 * 把历史正文作为额外 currentTargets / currentContents 交给转换层，旧正文于是被准入并重组为当前渲染。
 *
 * 表今天为空。改任何一个渲染器时必须把被替换的渲染登记进来：黄金测试
 * `tests/workspace/managed-integration/wakeflow-managed-text-history.test.ts` 钉住当前渲染在固定夹具下
 * 的摘要，改了文本不登记就红；CLAUDE.md / AGENTS.md 的 Change Discipline 有同一条规则。
 *
 * 边界：转换层最多收 8 个 current 目标，表加当前渲染合计不得超过 8 项，所以每张表最多 7 项；重算时旧
 * 渲染器抛错或返回 null（输入形状已变到它算不出来）就跳过——只有仍能重算的前序目标才准入；与当前渲染
 * 或彼此相同的正文去重（转换层拒绝重复摘要）。
 */

export interface WakeflowManagedTextHistoricalRender<Inputs extends readonly unknown[]> {
  /** 该渲染被替换时的发布版本（semver），只做登记用途。 */
  readonly retiredIn: string;
  /** 用与当前渲染器相同的输入重算旧正文；算不出来返回 null。 */
  readonly render: (...inputs: Inputs) => string | null;
}

/** 每张表的上限：转换层最多 8 个 current 目标，其中一个是当前渲染。 */
export const WAKEFLOW_MANAGED_TEXT_HISTORY_MAXIMUM = 7;

export type WakeflowProgramInstructionHistoryInputs = readonly [
  configValue: unknown,
  profileValue: unknown,
];
export type WakeflowExternalInstructionHistoryInputs = readonly [
  configValue: unknown,
  profileValue: unknown,
  targetValue: unknown,
];
export type WakeflowHostProfilesHistoryInputs = readonly [profileValues: unknown];
export type WakeflowSupportMemoryHistoryInputs = readonly [
  configValue: unknown,
  profileValue: unknown,
  surfaceIdValue: unknown,
];

/** 程序指令块（工作区根的 CLAUDE.md / AGENTS.md）：输入同 `createWakeflowProgramInstructionBodyAuthority`。 */
export const WAKEFLOW_PROGRAM_INSTRUCTION_BODY_HISTORY: readonly WakeflowManagedTextHistoricalRender<
  WakeflowProgramInstructionHistoryInputs
>[] = Object.freeze([]);

/** 外部指令块（managed-block 仓库与外部支撑面的指令文件）：输入同 `createWakeflowExternalInstructionBodyAuthority`。 */
export const WAKEFLOW_EXTERNAL_INSTRUCTION_BODY_HISTORY: readonly WakeflowManagedTextHistoricalRender<
  WakeflowExternalInstructionHistoryInputs
>[] = Object.freeze([]);

/** 仓库 `.gitignore` 托管块：输入同 `createWakeflowGitignoreBodyAuthority`。 */
export const WAKEFLOW_GITIGNORE_BODY_HISTORY: readonly WakeflowManagedTextHistoricalRender<
  WakeflowHostProfilesHistoryInputs
>[] = Object.freeze([]);

/** 支撑面 `.gitignore` 托管块：输入同 `createWakeflowSupportGitignoreBodyAuthority`。 */
export const WAKEFLOW_SUPPORT_GITIGNORE_BODY_HISTORY: readonly WakeflowManagedTextHistoricalRender<
  WakeflowHostProfilesHistoryInputs
>[] = Object.freeze([]);

/** 支撑面整文件记忆：输入同 `createWakeflowSupportMemoryAuthority`。 */
export const WAKEFLOW_SUPPORT_MEMORY_BODY_HISTORY: readonly WakeflowManagedTextHistoricalRender<
  WakeflowSupportMemoryHistoryInputs
>[] = Object.freeze([]);

/**
 * 用相同输入重算历史正文：算不出的（抛错或 null）、与当前渲染相同的、彼此重复的都去掉，按表序返回。
 */
export function historicalWakeflowManagedTextBodies<Inputs extends readonly unknown[]>(
  history: readonly WakeflowManagedTextHistoricalRender<Inputs>[],
  currentBody: string,
  ...inputs: Inputs
): readonly string[] {
  const bodies: string[] = [];
  for (const entry of history) {
    let body: string | null;
    try {
      body = entry.render(...inputs);
    } catch {
      body = null;
    }
    if (body === null || body === currentBody || bodies.includes(body)) continue;
    bodies.push(body);
  }
  return Object.freeze(bodies);
}

/**
 * 历史正文套上当前目标的 component 与 owner 作为额外 current 目标：转换层要求每个 current 目标与
 * desired 同 component、同 owner，历史正文只在正文上不同。
 */
export function historicalWakeflowManagedTextTargets<Inputs extends readonly unknown[]>(
  history: readonly WakeflowManagedTextHistoricalRender<Inputs>[],
  current: Readonly<WakeflowManagedTextEnvelopeTarget>,
  ...inputs: Inputs
): readonly Readonly<WakeflowManagedTextEnvelopeTarget>[] {
  return Object.freeze(
    historicalWakeflowManagedTextBodies(history, current.body, ...inputs).map((body) =>
      Object.freeze({ component: current.component, owner: current.owner, body }),
    ),
  );
}
