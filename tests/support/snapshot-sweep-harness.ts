import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TestContext } from "node:test";

import type { CallToolResult } from "@modelcontextprotocol/client";

import { WAKEFLOW_RECORD_EVIDENCE_PUBLIC_TOOL_NAME } from "../../src/capabilities/evidence/contract.js";
import { WAKEFLOW_STATUS_PUBLIC_TOOL_NAME } from "../../src/capabilities/observation/contract.js";
import { WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME } from "../../src/capabilities/workspace/maintain-workspace.js";
import { createCodexWakeflowMcpServer } from "../../src/entrypoints/codex-wakeflow-mcp.js";
import { connectWakeflowMcpServerForTest } from "../entrypoints/wakeflow-public-mcp-server.fixture.js";
import {
  copySnapshotSweepSet,
  removeSnapshotSweepNode,
  restoreSnapshotSweepSet,
  type SnapshotSweepSet,
} from "./snapshot-sweep-copy.js";
import { generatePowerLossState, powerLossPositions } from "./snapshot-sweep-powerloss.js";
import { type SnapshotSweepSeamCall, startSnapshotSweepProcess } from "./snapshot-sweep-process.js";
import { disposableRoot } from "./temp-root.js";

/**
 * 快照扫点的驱动（1.4.1 第 1 段清单 2.4 第 2 步）：子进程跑一个场景、每经过一次变更接缝拷一份快照
 * （`snapshot-sweep-process.ts`），本进程按顺序把选中的每一份摆回原处，再跑一轮跟进：只读的 `wakeflow_status`、
 * 一条与场景要同样几把锁的变更调用（不管 status 是否被拒都跑），变更成功之后再一次 `wakeflow_status`。场景
 * 开始之前另拷一份第 0 份作对照，它必须 healed，否则是跟进本身坏了，与快照无关。每一份快照归为五类之一：
 *
 * - `healed`：第一轮里变更跟进与它之后的 status 都成功（第一轮开头的 status 若被拒，照记在行里），并且
 *   那一次 status 不再点着任何恢复——跟进成功而 status 还点着一条恢复，这一轮记
 *   `status-still-names-recovery` 的失败，照它再走一跳（对照点因此也必须什么都不点）；
 * - `signposted-recovery`：第一轮有调用失败，照着被点名的恢复走通。算点名的只有：拒绝码是
 *   `recovery-required` 并且 `details.tool` 写着把它做完的工具——不是维护工具时还要带那次调用的参数
 *   （`details.operationId`；证据的 recover 认的是 `demandId`，拒绝给的是 `details.demandId`），而且就是场景的
 *   那个 Demand；拒绝信封带 `retryable: true`（下一轮原样再跑一次，一份快照上只试一次）；
 *   一次成功的 status 点着它（见下一条）。两样都有时先走点了名的那条，再考虑重试——Controller 照着做也是
 *   这个先后。被点名的若是维护工具：带操作标识就是维护的 recover，不带时 status 列着可恢复的维护操作就
 *   recover 它，否则走公开的 reconcile（预览是 `ready` 并带计划摘要才应用，之后几次只有 `no-op` 或预览被
 *   阻塞算正常结束）；别的工具是它自己的 `mode: recover`。一份摆回的盘面上最多跟三跳，每一跳由最近一次
 *   拒绝或最近一轮的 status 点名（先对账、再 recover 是两跳）；某一跳之后的一轮全部成功就定下来，出口名是
 *   各跳用 `>` 连起来。每一跳都由拒绝或重试给出时归这一类；
 * - `status-named-recovery`：同上，但至少有一跳只有 status 点了名、拒绝没有点名。status 点名有四种，维护的
 *   两种在前（维护占着工作区时任何 Demand 的 recover 都会被挡下，Controller 技能也是先维护）：维护一栏列着
 *   一个可恢复的维护操作；维护协议停在 `recovery-required` 而没有可恢复的操作（走公开的 reconcile）；带着
 *   Demand 标识问的 status 的 `next` 是 `demand-recovery`；`nextActions` 里有一条 `demand-recovery` 点着这个
 *   Demand。单列一张表；
 * - `unsignposted-recovery`：被点名的都走不通（或什么都没点名）时的最后一招，各从重新摆回的快照开始：
 *   单独走公开的 reconcile；单独调用场景自己的恢复调用（`<工具名>:recover`）；先 reconcile 再调用它
 *   （`maintenance:reconcile+<工具名>:recover`）。之后的一轮全部成功就归这一类，行里记下走通的那一条；
 * - `stuck`：上面每一条适用的路都走过之后，status 或变更跟进仍然失败，包括超时：没有公开调用治好它。行里同时
 *   记第一轮 status 与变更跟进各自的结局、每一跳与每一条路的结局和最后一轮的失败。拒绝记作 `code/reason`，
 *   信封带原因链上的理由时再加 `<-原因理由`，指出是哪一项检查拒绝的（见 `markOf`）。被点名的一跳记作
 *   `出口名:凭什么:结局`，凭什么是 `retry`、`refusal` 或 `status`。
 *
 * 没有调用的变更跟进不算证据：变更跟进一个工具都没调用就返回，这一轮记 `follow-up-skipped/no-call` 的失败，
 * 单凭它不治好任何点。同一份摆回上前一轮的变更跟进已经真的调用并成功、只是之后的 status 失败时，走完出口的
 * 下一轮不再跑变更跟进（再跑会因为已经做过而被拒），记 `follow-up skipped`、只看 status；这样定下的点
 * `skipped` 为真，它靠前一轮的变更加这一轮的 status 才算治好。重新摆回之后前一轮的变更不再算数。
 *
 * 不带计划摘要的直接应用在门不过时以预览的形状交回、什么都不写：请求是 `apply` 而结果是预览，记为
 * `apply-blocked`，不算成功（见 `outcomeOf`）。
 *
 * 跟进调用经本进程里装配的真实 Codex MCP 组合根（内存 Transport），与子进程同一套工具名与错误信封。一次调用
 * 超过 45 秒记为超时，但要等那次调用真正落定才返回：组合根在本进程里，被放弃的调用还会继续改盘，下一次摆回
 * 不能与它同时进行；落不定就让整个测试失败。
 *
 * 范围（`WAKEFLOW_SNAPSHOT_SWEEP_SCOPE`）：`locks`（缺省）只摆回第 0 份、每一份接缝调用作用在 L1–L7 锁族文件
 * （锁或租约文件本身，或与它在同一次链接里出现的创建暂存）上的快照，以及每个这样的调用之前的那一份（锁操作的
 * 起点，包括命令的写入都已完成、锁还拿着的状态），再加上场景另列的路线代表点（`routePoints`：段 1b 改过的
 * 每条恢复路线各取一两个点——追加候选、终态日志、根退役、暂存残留、发布标记——这些点不挨着任何锁操作，
 * 不列的话门里一个都不会摆回）；`all` 摆回每一份，并让子进程另在每个经接缝排他新建的
 * 文件内容同步之后拷一份（"内容完整、还没发布"，序号是前一次接缝调用的序号加一位小数，见
 * `snapshot-sweep-process.ts`）。第 1 段只改这七族锁，`locks` 是门里跑的范围；`all` 是完整的崩溃隐患清单，由
 * `wf fault run --suite storage-sweep` 带这个变量跑。
 *
 * 治好之后的锁残留：一份快照治好之后（healed 或走通任何一条路；跟进的调用都已落定），再查一次锁目录——
 * 接缝日志里出现过的每一个 L1–L7 锁或租约文件都必须不在了，这些文件所在目录里也不能有别的 L1–L7 锁名，或
 * 点着日志里某把锁的原子暂存（暂存名里的目标摘要与日志里和锁同一次链接的暂存相同）。仍在的名字规范化之后
 * 按路径计数（几个死读者租约规范化成同一个名字时个数大于 1），记进这一点的 `residue`，测试按显式表断言
 * （`lockResidueOf`）：失败时指出点、路径与个数。跟进若不再拿某一族锁，这一族的死锁文件就不会被清，场景要
 * 换一条会拿它的跟进；跟进拿了锁文件却还在，是产品问题，钉在表里并写明。
 *
 * 治好之后的恢复记录与暂存：场景声明了它操作的 Demand（`demandId`）时，一份快照治好之后再查两样。恢复
 * 记录——`current/` 里改名移走的残留（`.retire-…`）、这个 Demand 的生命周期日志、发布标记与发布暂存树——
 * 应当都不在了（`recoveryResidueOf`）；这个 Demand 的 `index/`、`snapshots/`、`task-packages/` 里仍在的原子
 * 暂存按路径计数（`stageResidueOf`），由下一次对账清。
 *
 * 摆回了哪些点也钉住：每个扫点文件按范围列出摆回过的序号（`sweptIndicesOf`）。显式表只列走出口、卡住或留着
 * 残留的点，一轮就治好的点不在任何一张表里；不钉序号的话，同步点不再产生、锁点选少了或接缝变短都看不出来。
 *
 * 不在快照集里的状态（工作区的 `.git` 与产品检出）在各份快照之间共用，见 `snapshot-sweep-copy.ts`。
 */

/**
 * 一次公共工具调用的结局：成功带结构化结果，拒绝带错误信封的 code、reason 与 details，以及信封里的
 * `retryable` 与原因链上第一个理由记号 `causeReason`（有就带）。
 */
export type SnapshotSweepOutcome =
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | {
      readonly ok: false;
      readonly code: string;
      readonly reason: string;
      readonly details: Readonly<Record<string, unknown>>;
      readonly retryable?: boolean;
      readonly causeReason?: string;
    };

export interface SnapshotSweepCall {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

/** 跟进与恢复出口用来调用公共工具的入口（本进程的组合根）。 */
export type SnapshotSweepInvoke = (
  call: Readonly<SnapshotSweepCall>,
) => Promise<SnapshotSweepOutcome>;

/** 一条点名的恢复出口：名字进归类结果，`run` 失败则试下一条。 */
interface SnapshotSweepRoute {
  readonly name: string;
  run(invoke: SnapshotSweepInvoke): Promise<SnapshotSweepOutcome>;
}

/** 交给变更跟进的上下文：第几份快照、完整的接缝日志、子进程里各调用的结构化结果。 */
export interface SnapshotSweepFollowUpContext {
  readonly index: number;
  readonly seam: readonly SnapshotSweepSeamCall[];
  readonly childResults: readonly Readonly<Record<string, unknown>>[];
}

export interface SnapshotSweepScenario {
  readonly name: string;
  readonly set: Readonly<SnapshotSweepSet>;
  /**
   * 子进程按顺序做完的调用；任何一个被拒都是夹具错误。一项可以是函数，拿前面各调用的结构化结果来构造
   * 这一次的调用（例如应用要带预览返回的计划摘要）。
   */
  readonly calls: readonly (
    | Readonly<SnapshotSweepCall>
    | ((results: readonly Readonly<Record<string, unknown>>[]) => Readonly<SnapshotSweepCall>)
  )[];
  /**
   * 从第几个调用（从 0 数）起才扫点：它之前的调用只是铺垫（别的扫点文件已经扫过），它们的接缝点不摆回，
   * 对照点是这个调用开始之前的那一份，掉电的盘面也把铺垫当作已经落盘。缺省 0。
   */
  readonly sweepFromCall?: number;
  /** 只读跟进的参数（`wakeflow_status`）。 */
  readonly statusArguments: Readonly<Record<string, unknown>>;
  /** 与场景要同样几把锁的变更跟进；同一份快照在出口之后会再调用一次。 */
  followUp(
    invoke: SnapshotSweepInvoke,
    context: Readonly<SnapshotSweepFollowUpContext>,
  ): Promise<SnapshotSweepOutcome>;
  /** 子进程的调用都做完之后、扫点之前，交给场景它们的结构化结果（例如取出新建的 Demand id）。 */
  readonly onChildDone?: (results: readonly Readonly<Record<string, unknown>>[]) => void;
  /**
   * 场景自己的恢复调用（同一工具的 `mode: recover`）：拒绝码是 `recovery-required` 时是有路标的出口；有路标的
   * 出口都走不通时作为没有路标的路再试（见文件头）。参数在扫点开始时读（例如子进程做完才知道的 Demand id）。
   */
  readonly recover?: () => Readonly<SnapshotSweepCall>;
  /**
   * 场景操作的那个 Demand 的标识（扫点开始时读）：拒绝点名的恢复必须是它，status 的 `nextActions` 里点着它的
   * 那一条才算，治好之后的恢复记录残留也按它查。不涉及某一个 Demand 的场景不给。
   */
  readonly demandId?: () => string;
  /**
   * `locks` 范围里另外摆回的序号（接缝调用的整数序号）：这个场景每条恢复路线的代表点，见文件头的"范围"。
   * 序号不在接缝日志里（接缝变短或挪位）时测试失败，不悄悄漏掉。`all` 范围本来就摆回每一份。
   */
  readonly routePoints?: readonly number[];
  /**
   * `all` 范围里另跑掉电的盘面（`snapshot-sweep-powerloss.ts`）：子进程多记每一步改的目录与每一次目录同步，
   * 每一次盖住了新变更的目录同步生成一份"没被同步盖住的目录项变更全部丢失"的盘面，照被杀的点一样摆回、
   * 跟进、归类，结果在报告的 `powerLossPoints` 里。跟进拿到的 `index` 是那一刻的接缝序号，而盘面可能比它
   * 更早，所以开这一项的场景，跟进要按盘面上看到的状态判断，不能按序号。
   */
  readonly powerLoss?: boolean;
}

type SnapshotSweepFailure = Extract<SnapshotSweepOutcome, { ok: false }> & {
  readonly step: "status" | "follow-up" | "status-after";
};

export type SnapshotSweepVerdict =
  | { readonly kind: "healed" }
  | { readonly kind: "signposted-recovery"; readonly route: string }
  | { readonly kind: "status-named-recovery"; readonly route: string }
  | { readonly kind: "unsignposted-recovery"; readonly route: string }
  | {
      readonly kind: "stuck";
      readonly step: SnapshotSweepFailure["step"];
      readonly code: string;
      readonly reason: string;
      /** 最后一轮的三个结局（第一轮，或最后一条走成的出口之后那一轮）。 */
      readonly last: string;
    };

export interface SnapshotSweepPoint {
  readonly index: number;
  readonly method: string;
  /** 这一步的目标名字（最后一个路径参数），带根前缀。 */
  readonly file: string;
  readonly verdict: SnapshotSweepVerdict;
  /** 第一轮 status 的结局：`ok` 或 `code/reason`。 */
  readonly status: string;
  /** 第一轮变更跟进的结局：`ok` 或 `code/reason`。 */
  readonly followUp: string;
  /**
   * 走过的出口，按顺序。被点名的一跳记作 `出口名:凭什么:结局`；从重新摆回的快照试的路记作
   * `unsignposted:名字:结局`。
   */
  readonly routes: readonly string[];
  /** 定下归类的那一轮没有跑变更跟进：同一份摆回上前一轮已经跑成，这一轮只看 status（见文件头）。 */
  readonly skipped: boolean;
  /**
   * 第一跳是拒绝点名的恢复时，第一轮的 status 有没有也点着同一条工具；status 被拒、没有跳或第一跳不是
   * 拒绝点名的，为 null。
   */
  readonly statusNamed: boolean | null;
  /**
   * 治好之后仍在的恢复记录：`current/` 里改名移走的残留（`.retire-…`）、这个 Demand 的生命周期日志、发布
   * 标记与发布暂存树。规范化之后的路径，按路径排序；卡住的快照不查，记空。
   */
  readonly recoveryResidue: readonly string[];
  /**
   * 治好之后这个 Demand 的 `index/`、`snapshots/`、`task-packages/` 里仍在的原子暂存名：规范化之后的路径
   * 与个数；卡住的快照不查，记空。
   */
  readonly stageResidue: readonly (readonly [path: string, count: number])[];
  /**
   * 治好之后仍在的 L1–L7 锁或租约文件，以及点着这些锁的原子暂存：带根前缀、规范化之后的路径与个数，按路径
   * 排序；卡住的快照不查，记空。
   */
  readonly residue: readonly (readonly [path: string, count: number])[];
  /** 摆回加跟进（含恢复出口）的墙钟。 */
  readonly milliseconds: number;
}

/** 一份掉电盘面的归类：`label` 是 `k~s`（第 k 次接缝调用之后的第 s 次目录同步），`index` 是 k。 */
export interface SnapshotSweepPowerLossPoint extends SnapshotSweepPoint {
  readonly label: string;
}

export type SnapshotSweepScope = "locks" | "all";

export interface SnapshotSweepReport {
  readonly scenario: string;
  readonly scope: SnapshotSweepScope;
  /** 子进程里每个调用的结构化结果。 */
  readonly childResults: readonly Readonly<Record<string, unknown>>[];
  readonly seam: readonly SnapshotSweepSeamCall[];
  /** 摆回过的快照（含第 0 份），按序号。 */
  readonly points: readonly SnapshotSweepPoint[];
  /** 掉电的盘面，按发生的先后；场景没有开 `powerLoss` 或不在 `all` 范围时为空。 */
  readonly powerLossPoints: readonly SnapshotSweepPowerLossPoint[];
  readonly childMilliseconds: number;
  readonly sweepMilliseconds: number;
}

/** 卡在今天代码上的一行（测试文件里的显式表）。 */
export interface SnapshotSweepStuckRow {
  readonly index: number;
  readonly method: string;
  readonly file: string;
  /** 第一轮 status 的结局。 */
  readonly status: string;
  /** 第一轮变更跟进的结局。 */
  readonly followUp: string;
  readonly routes: readonly string[];
  /** 最后一轮的三个结局（第一轮，或最后一条走成的出口之后那一轮）。 */
  readonly final: string;
}

const CALL_DEADLINE_MILLISECONDS = 45_000;
/** 超时之后等旧调用落定的上限；过了就让测试失败，不再摆回。 */
const SETTLE_DEADLINE_MILLISECONDS = 3 * CALL_DEADLINE_MILLISECONDS;

function toolText(result: CallToolResult): string {
  const first = result.content[0];
  return first?.type === "text" ? first.text : "";
}

/**
 * 一次调用的结局。直接应用（完成与创建的 apply 不带计划摘要）在门不过时什么都不写、以预览的形状交回阻塞项
 * （`src/capabilities/demand/lifecycle.ts` 的 `directApply`）：请求是 `apply` 而结果是预览时记为
 * `apply-blocked`（理由是阻塞项），不算成功。
 */
function outcomeOf(
  result: CallToolResult,
  call: Readonly<SnapshotSweepCall>,
): SnapshotSweepOutcome {
  if (result.isError !== true) {
    const value = (result.structuredContent ?? {}) as Record<string, unknown>;
    if (call.arguments.mode === "apply" && value.mode === "preview") {
      const blockers = (value.blockerCodes ?? value.blockers ?? []) as readonly string[];
      return {
        ok: false,
        code: "apply-blocked",
        reason: blockers.length > 0 ? blockers.join(",") : `status-${String(value.status)}`,
        details: {},
      };
    }
    return { ok: true, value };
  }
  const text = toolText(result);
  let envelope: {
    error?: {
      code?: unknown;
      reason?: unknown;
      details?: unknown;
      retryable?: unknown;
      causeReason?: unknown;
    };
  } = {};
  try {
    envelope = JSON.parse(text) as typeof envelope;
  } catch {
    return { ok: false, code: "unparsed", reason: text.slice(0, 200), details: {} };
  }
  const causeReason = envelope.error?.causeReason;
  return {
    ok: false,
    code: String(envelope.error?.code ?? "unknown"),
    reason: String(envelope.error?.reason ?? "unknown"),
    details: (envelope.error?.details ?? {}) as Record<string, unknown>,
    retryable: envelope.error?.retryable === true,
    ...(typeof causeReason === "string" ? { causeReason } : {}),
  };
}

/**
 * 本进程里装配一个真实的 Codex 组合根，返回带超时的调用入口。超时的调用不取消：它的处理还在本进程里跑，
 * 取消通知也不会让它停下，所以等它的回应到了（或等满上限后让测试失败）才返回超时。
 */
async function connectSnapshotSweepInvoke(t: TestContext): Promise<SnapshotSweepInvoke> {
  const connection = await connectWakeflowMcpServerForTest(
    createCodexWakeflowMcpServer("1.0.0-test"),
  );
  t.after(connection.close);
  return async (call) => {
    const pending = connection.client
      .callTool(
        { name: call.name, arguments: { ...call.arguments } },
        { timeout: SETTLE_DEADLINE_MILLISECONDS },
      )
      .then((result) => outcomeOf(result as CallToolResult, call));
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<"deadline">((resolve) => {
      timer = setTimeout(() => resolve("deadline"), CALL_DEADLINE_MILLISECONDS);
    });
    try {
      const first = await Promise.race([pending, deadline]);
      if (first !== "deadline") return first;
    } finally {
      clearTimeout(timer);
    }
    try {
      await pending;
    } catch {
      throw new Error(`${call.name} did not settle after its deadline; the sweep cannot restore.`);
    }
    return { ok: false, code: "timeout", reason: call.name, details: {} };
  };
}

/** 场景自己的恢复调用作为一条出口，名字 `<工具名>:recover`。 */
function recoverRoute(call: Readonly<SnapshotSweepCall>): Readonly<SnapshotSweepRoute> {
  return { name: `${call.name}:recover`, run: (invoke) => invoke(call) };
}

/** 结果里的第一个 Demand id（子进程的创建结果带着它）。 */
export function demandIdIn(value: unknown): string {
  const match = /demand_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/u.exec(
    JSON.stringify(value),
  );
  if (match === null) throw new Error("Expected a Demand id in the result.");
  return match[0];
}

/**
 * 一次预览加一次带它摘要的应用：只有预览的 `status` 是 `ready` 并且带计划摘要时才应用；否则以
 * `preview-blocked` 失败，理由是阻塞码（没有阻塞码时记预览的 status）。
 */
export async function previewThenApply(
  invoke: SnapshotSweepInvoke,
  call: Readonly<SnapshotSweepCall>,
): Promise<SnapshotSweepOutcome> {
  const preview = await invoke({
    name: call.name,
    arguments: { ...call.arguments, mode: "preview" },
  });
  if (!preview.ok) return preview;
  const planDigest = preview.value.planDigest;
  if (preview.value.status !== "ready" || typeof planDigest !== "string") {
    const blockers = (preview.value.blockerCodes ??
      preview.value.blockers ??
      []) as readonly string[];
    return {
      ok: false,
      code: "preview-blocked",
      reason: blockers.length > 0 ? blockers.join(",") : `status-${String(preview.value.status)}`,
      details: {},
    };
  }
  return invoke({ name: call.name, arguments: { ...call.arguments, mode: "apply", planDigest } });
}

/** status 列出的、可以恢复的维护操作的标识；没有（或 status 被拒）为 null。 */
async function recoverableMaintenanceOperation(
  invoke: SnapshotSweepInvoke,
  root: string,
): Promise<string | null> {
  const status = await invoke({ name: WAKEFLOW_STATUS_PUBLIC_TOOL_NAME, arguments: { root } });
  if (!status.ok) return null;
  const residues = ((status.value.maintenance as { residues?: unknown } | undefined)?.residues ??
    []) as readonly { operationId: string | null; recoverable: boolean }[];
  return (
    residues.find((entry) => entry.recoverable && entry.operationId !== null)?.operationId ?? null
  );
}

/** reconcile 出口最多应用几次：每次应用只做一类收敛（例如先收敛私有目录的权限位，下一次才恢复追加候选）。 */
const RECONCILE_PASSES = 3;

/**
 * 公开的 reconcile，对任何拒绝都是最后一条出口。请求形状照
 * `tests/capabilities/workspace/demand-runtime-recovery.test.ts`（追加中途被杀之后的公开恢复）：预览，就绪并带
 * 计划时以返回的摘要应用。一次应用只做一类收敛，应用的结果把下一步仍指向维护，所以照着再预览、再应用，最多
 * `RECONCILE_PASSES` 次。第一次就被拒、被阻塞或应用不是 `completed` 算出口失败；之后的一次只有应用报 `no-op`
 * 或预览被阻塞是正常的结束，别的拒绝算出口失败（理由里带着之前每一次的结局）。成功时结果里的 `trail`
 * 逐次记下每一次的结局，归类时写进行里。
 */
function reconcileRoute(root: string): Readonly<SnapshotSweepRoute> {
  return {
    name: "maintenance:reconcile",
    async run(invoke) {
      const trail: string[] = [];
      for (let pass = 0; pass < RECONCILE_PASSES; pass += 1) {
        const applied = await previewThenApply(invoke, {
          name: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
          arguments: { root, action: "reconcile", request: {} },
        });
        if (pass === 0 && !applied.ok) return applied;
        if (!applied.ok && applied.code !== "preview-blocked") {
          return {
            ok: false,
            code: "later-pass-refused",
            reason: [...trail, markOf(applied)].join(","),
            details: {},
          };
        }
        const status = applied.ok ? String(applied.value.status) : markOf(applied);
        if (pass === 0 && status !== "completed") {
          return { ok: false, code: "not-completed", reason: status, details: {} };
        }
        trail.push(status);
        if (status !== "completed") break;
      }
      return { ok: true, value: { trail } };
    },
  };
}

/** 出口结局的记法：reconcile 成功时带它逐次的结局，例如 `ok(completed,completed,no-op)`。 */
function routeMarkOf(outcome: Readonly<SnapshotSweepOutcome>): string {
  if (outcome.ok && Array.isArray(outcome.value.trail)) {
    return `ok(${(outcome.value.trail as readonly string[]).join(",")})`;
  }
  return markOf(outcome);
}

interface SnapshotSweepRound {
  readonly status: SnapshotSweepOutcome;
  /** 变更跟进的结局；`null` 是这一轮没有跑它（同一份摆回上前一轮已经跑成）。 */
  readonly followUp: SnapshotSweepOutcome | null;
  /** 变更跟进成功之后的 status；跟进失败或没有跑时为 null。 */
  readonly after: SnapshotSweepOutcome | null;
  /** 第一处让这一轮不成立的失败（变更跟进或它之后的 status）；全部成功为 null。 */
  readonly failure: SnapshotSweepFailure | null;
  /** 这一轮的变更跟进真的调用了工具并且成功。 */
  readonly applied: boolean;
}

/** 一轮的三个结局：`status <结局>; follow-up <结局>|skipped[; status-after <结局>]`。 */
function roundMarks(entry: Readonly<SnapshotSweepRound>): string {
  const followUp = entry.followUp === null ? "skipped" : markOf(entry.followUp);
  const after = entry.after === null ? "" : `; status-after ${markOf(entry.after)}`;
  return `status ${markOf(entry.status)}; follow-up ${followUp}${after}`;
}

/**
 * 一轮跟进：status、变更跟进（不管 status 的结局），变更成功之后再一次 status。`applied` 为真（同一份摆回上
 * 前一轮的变更跟进已经跑成）时不再跑变更跟进，只看这一次 status。变更跟进一个工具都没调用就返回时记
 * `follow-up-skipped/no-call` 的失败：没有调用不能证明治好。
 */
async function round(
  invoke: SnapshotSweepInvoke,
  scenario: Readonly<SnapshotSweepScenario>,
  context: Readonly<SnapshotSweepFollowUpContext>,
  applied: boolean,
): Promise<SnapshotSweepRound> {
  const statusCall = {
    name: WAKEFLOW_STATUS_PUBLIC_TOOL_NAME,
    arguments: scenario.statusArguments,
  };
  const status = await invoke(statusCall);
  if (applied) {
    const failure: SnapshotSweepFailure | null = status.ok
      ? stillNamedRecovery(status, scenario)
      : { ...status, step: "status-after" };
    return { status, followUp: null, after: null, failure, applied: false };
  }
  let calls = 0;
  const counted: SnapshotSweepInvoke = (call) => {
    calls += 1;
    return invoke(call);
  };
  const outcome = await scenario.followUp(counted, context);
  const followUp: SnapshotSweepOutcome =
    calls === 0
      ? { ok: false, code: "follow-up-skipped", reason: "no-call", details: {} }
      : outcome;
  if (!followUp.ok) {
    const failure: SnapshotSweepFailure = { ...followUp, step: "follow-up" };
    return { status, followUp, after: null, failure, applied: false };
  }
  const after = await invoke(statusCall);
  if (!after.ok) {
    const failure: SnapshotSweepFailure = { ...after, step: "status-after" };
    return { status, followUp, after, failure, applied: true };
  }
  return { status, followUp, after, failure: stillNamedRecovery(after, scenario), applied: true };
}

/**
 * 跟进成功之后的 status 还点着一条恢复：这份盘面没有治好（留着一份没收尾的事务），记成这一轮的失败，
 * 归类照它再走一跳。
 */
function stillNamedRecovery(
  status: Readonly<SnapshotSweepOutcome>,
  scenario: Readonly<SnapshotSweepScenario>,
): SnapshotSweepFailure | null {
  const named = statusNamedRecovery(
    status,
    scenario.demandId?.() ?? null,
    typeof scenario.statusArguments.demandId === "string",
  );
  if (named === null) return null;
  return {
    ok: false,
    code: "status-still-names-recovery",
    reason: named.tool,
    details: {},
    step: "status-after",
  };
}

/** 结局的记法：`ok`，或 `code/reason`，信封带原因理由时再加 `<-原因理由`（指出是哪一项检查拒绝的）。 */
function markOf(outcome: Readonly<SnapshotSweepOutcome>): string {
  if (outcome.ok) return "ok";
  const cause = outcome.causeReason === undefined ? "" : `<-${outcome.causeReason}`;
  return `${outcome.code}/${normalizeSnapshotSweepPath(outcome.reason)}${cause}`;
}

/**
 * 一次拒绝或一次 status 点了名的恢复：哪条工具把它做完，以及（不是维护时）它的标识与那次 recover 用哪个
 * 参数带它——`operationId`，证据的 recover 是 `demandId`。
 */
export interface SnapshotSweepNamedRecovery {
  readonly tool: string;
  readonly operationId: string | null;
  readonly parameter: "operationId" | "demandId";
}

/**
 * 一次拒绝点名的恢复：拒绝码是 `recovery-required`，`details.tool` 是一个公共工具名；不是维护工具时
 * `details.operationId` 或 `details.demandId` 必须在（拒绝给哪个，recover 就带哪个参数：给错了那次 recover
 * 会被请求的 Schema 拒绝，这条路就算没走通），并且（场景声明了 Demand 时）就是那个 Demand。别的拒绝什么都
 * 没点名。
 */
export function refusalNamedRecovery(
  failure: Readonly<SnapshotSweepOutcome> | null,
  demandId: string | null,
): SnapshotSweepNamedRecovery | null {
  if (failure === null || failure.ok || failure.code !== "recovery-required") return null;
  const { tool, operationId } = failure.details;
  if (typeof tool !== "string" || !PUBLIC_TOOL_NAME.test(tool)) return null;
  if (tool === WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME) {
    return {
      tool,
      operationId: typeof operationId === "string" ? operationId : null,
      parameter: "operationId",
    };
  }
  const parameter = typeof operationId === "string" ? "operationId" : "demandId";
  const subject = failure.details[parameter];
  if (typeof subject !== "string") return null;
  if (demandId !== null && subject !== demandId) return null;
  return { tool, operationId: subject, parameter };
}

const PUBLIC_TOOL_NAME = /^wakeflow_[a-z_]+$/u;

/**
 * 一次成功的 status 点名的恢复，四种，按 Controller 照着做的先后。维护的两种在前（维护占着工作区时 Demand
 * 的 recover 会被操作范围挡下，技能写明 `overall` 是 `maintenance` 时先维护）：维护一栏列着一个可以恢复的
 * 维护操作；或维护协议停在 `recovery-required` 而没有可恢复的操作——技能写明这时预览 reconcile（它给出
 * 收掉死闩的计划），对照点上协议是 `idle`。然后是 Demand 的两种：带着 Demand 标识问的 status，它的 `next` 是
 * `demand-recovery`（`demandScoped`：不带标识问的 `next` 是整个工作区的下一步，不指某个 Demand）；
 * `nextActions` 里有一条 `demand-recovery` 点着这个 Demand。status 只给工具名，recover 的参数照技能：证据的
 * recover 带 `demandId`，其余带 `operationId`。工作区的下一步里出现"维护"不算点名：扫点的进程内服务没有
 * 制品清单，那一条在对照点上就在。
 */
export function statusNamedRecovery(
  status: Readonly<SnapshotSweepOutcome>,
  demandId: string | null,
  demandScoped = false,
): SnapshotSweepNamedRecovery | null {
  if (!status.ok) return null;
  const maintenance = statusNamedMaintenance(status.value);
  if (maintenance !== null) return maintenance;
  const named = (tool: unknown): SnapshotSweepNamedRecovery | null => {
    if (typeof tool !== "string" || !PUBLIC_TOOL_NAME.test(tool)) return null;
    if (tool === WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME) {
      return { tool, operationId: null, parameter: "operationId" };
    }
    if (demandId === null) return null;
    const parameter =
      tool === WAKEFLOW_RECORD_EVIDENCE_PUBLIC_TOOL_NAME ? "demandId" : "operationId";
    return { tool, operationId: demandId, parameter };
  };
  const next = status.value.next as { frontier?: unknown; suggestedTool?: unknown } | undefined;
  if (demandScoped && next?.frontier === "demand-recovery") {
    const recovery = named(next.suggestedTool);
    if (recovery !== null) return recovery;
  }
  const actions = (status.value.nextActions ?? []) as readonly {
    reason?: unknown;
    subject?: unknown;
    tool?: unknown;
  }[];
  for (const action of actions) {
    if (action.reason !== "demand-recovery" || demandId === null || action.subject !== demandId) {
      continue;
    }
    const recovery = named(action.tool);
    if (recovery !== null) return recovery;
  }
  return null;
}

/** status 的维护一栏点名的恢复：一个可恢复的维护操作，或停在 `recovery-required` 的协议（reconcile）。 */
function statusNamedMaintenance(
  value: Readonly<Record<string, unknown>>,
): SnapshotSweepNamedRecovery | null {
  const maintenance = value.maintenance as { residues?: unknown; protocol?: unknown } | undefined;
  const residues = (maintenance?.residues ?? []) as readonly {
    operationId?: unknown;
    recoverable?: unknown;
  }[];
  const recoverable = residues.find(
    (entry) => entry.recoverable === true && typeof entry.operationId === "string",
  );
  if (recoverable !== undefined) {
    return {
      tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
      operationId: recoverable.operationId as string,
      parameter: "operationId",
    };
  }
  if (maintenance?.protocol === "recovery-required") {
    return {
      tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
      operationId: null,
      parameter: "operationId",
    };
  }
  return null;
}

/**
 * 走一次被点名的恢复。维护工具带操作标识时是维护的 recover；不带时，status 列着可恢复的维护操作就 recover
 * 它，否则是公开的 reconcile。别的工具是它自己的 `mode: recover`。返回走的是哪一条与结局。
 */
async function runNamedRecovery(
  invoke: SnapshotSweepInvoke,
  root: string,
  named: Readonly<SnapshotSweepNamedRecovery>,
): Promise<Readonly<{ name: string; outcome: SnapshotSweepOutcome }>> {
  if (named.tool !== WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME) {
    const call = {
      name: named.tool,
      arguments: { root, mode: "recover", [named.parameter]: named.operationId },
    };
    return { name: `${named.tool}:recover`, outcome: await invoke(call) };
  }
  const operationId = named.operationId ?? (await recoverableMaintenanceOperation(invoke, root));
  if (operationId === null) {
    const route = reconcileRoute(root);
    return { name: route.name, outcome: await route.run(invoke) };
  }
  const call = {
    name: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    arguments: { root, mode: "recover", operationId },
  };
  return { name: "maintenance:recover", outcome: await invoke(call) };
}

/** 一份摆回的盘面上最多跟几跳被点名的恢复（例如先对账、再 recover 是两跳）。 */
const NAMED_HOP_LIMIT = 3;

export interface SnapshotSweepClassification {
  readonly verdict: SnapshotSweepVerdict;
  readonly status: string;
  readonly followUp: string;
  readonly routes: readonly string[];
  readonly skipped: boolean;
  readonly statusNamed: boolean | null;
}

/** 一跳是凭什么走的：信封的 `retryable`、拒绝点了名、还是只有 status 点了名。 */
type SnapshotSweepHopBasis = "retry" | "refusal" | "status";

interface SnapshotSweepHop {
  readonly name: string;
  readonly by: SnapshotSweepHopBasis;
  readonly tool: string | null;
}

/**
 * 下一跳，按 Controller 照着做的先后：最近一次拒绝点了名就走它；否则可重试而还没重试过就重试；再否则看
 * 最近一轮的 status 点没点名。
 */
function nextNamedHop(
  failure: Readonly<SnapshotSweepFailure>,
  status: Readonly<SnapshotSweepOutcome>,
  retried: boolean,
  demandId: string | null,
  demandScoped: boolean,
): Readonly<{ by: SnapshotSweepHopBasis; named: SnapshotSweepNamedRecovery | null }> | null {
  const refused = refusalNamedRecovery(failure, demandId) ?? refusalNamedRecovery(status, demandId);
  if (refused !== null) return { by: "refusal", named: refused };
  if (failure.retryable === true && !retried) return { by: "retry", named: null };
  const listed = statusNamedRecovery(status, demandId, demandScoped);
  return listed === null ? null : { by: "status", named: listed };
}

/**
 * 一份快照的归类（见文件头）：第一轮；被点名的恢复，最多 `NAMED_HOP_LIMIT` 跳；都走不通时，从重新摆回的
 * 快照试没有被点名的路（`restore`）。
 */
export async function classifySnapshotSweepPoint(
  invoke: SnapshotSweepInvoke,
  scenario: Readonly<SnapshotSweepScenario>,
  context: Readonly<SnapshotSweepFollowUpContext>,
  restore: () => void,
): Promise<SnapshotSweepClassification> {
  const first = await round(invoke, scenario, context, false);
  const marks = {
    status: markOf(first.status),
    followUp: first.followUp === null ? "skipped" : markOf(first.followUp),
  };
  if (first.failure === null) {
    return { verdict: { kind: "healed" }, ...marks, routes: [], skipped: false, statusNamed: null };
  }
  const root = scenario.set.workspace;
  const demandId = scenario.demandId?.() ?? null;
  const recover = scenario.recover?.() ?? null;
  const demandScoped = typeof scenario.statusArguments.demandId === "string";
  let failure: SnapshotSweepFailure = first.failure;
  // 下一跳看最近一次成功的 status：跟进成功之后的那一次在的话用它（它看到的是跟进之后的盘面）。
  const latestStatus = (entry: Readonly<SnapshotSweepRound>): SnapshotSweepOutcome =>
    entry.after?.ok === true ? entry.after : entry.status;
  let status: SnapshotSweepOutcome = latestStatus(first);
  let last = roundMarks(first);
  let applied = first.applied;
  let retried = false;
  const routes: string[] = [];
  const hops: SnapshotSweepHop[] = [];
  while (hops.length < NAMED_HOP_LIMIT) {
    const next = nextNamedHop(failure, status, retried, demandId, demandScoped);
    if (next === null) break;
    retried ||= next.by === "retry";
    const ran =
      next.named === null
        ? { name: "retry", outcome: { ok: true, value: {} } as SnapshotSweepOutcome }
        : await runNamedRecovery(invoke, root, next.named);
    routes.push(`${ran.name}:${next.by}:${routeMarkOf(ran.outcome)}`);
    if (!ran.outcome.ok) break;
    hops.push({ name: ran.name, by: next.by, tool: next.named?.tool ?? null });
    const again = await round(invoke, scenario, context, applied);
    if (again.failure === null) {
      const route = hops.map((hop) => hop.name).join(">");
      const kind = hops.some((hop) => hop.by === "status")
        ? "status-named-recovery"
        : "signposted-recovery";
      return {
        verdict: { kind, route },
        ...marks,
        routes,
        skipped: again.followUp === null,
        statusNamed: firstStatusNamed(first.status, hops, demandId, demandScoped),
      };
    }
    failure = again.failure;
    status = latestStatus(again);
    last = roundMarks(again);
    applied ||= again.applied;
  }
  const statusNamed = firstStatusNamed(first.status, hops, demandId, demandScoped);
  // 最后一招，没有被点名：各从重新摆回的快照开始——单独 reconcile；单独调用场景的恢复调用；先 reconcile 再
  // 调用它。这样试出来的一律算没有路标。
  const attempts: readonly (readonly Readonly<SnapshotSweepRoute>[])[] = [
    [reconcileRoute(root)],
    ...(recover === null
      ? []
      : [[recoverRoute(recover)], [reconcileRoute(root), recoverRoute(recover)]]),
  ];
  for (const steps of attempts) {
    const name = steps.map((step) => step.name).join("+");
    restore();
    const stepMarks: string[] = [];
    let ran: SnapshotSweepOutcome = { ok: true, value: {} };
    for (const step of steps) {
      ran = await step.run(invoke);
      stepMarks.push(routeMarkOf(ran));
      if (!ran.ok) break;
    }
    routes.push(`unsignposted:${name}:${stepMarks.join("+")}`);
    if (!ran.ok) continue;
    const again = await round(invoke, scenario, context, false);
    if (again.failure === null) {
      return {
        verdict: { kind: "unsignposted-recovery", route: name },
        ...marks,
        routes,
        skipped: false,
        statusNamed,
      };
    }
    failure = again.failure;
    last = roundMarks(again);
  }
  return {
    verdict: {
      kind: "stuck",
      step: failure.step,
      code: failure.code,
      reason: normalizeSnapshotSweepPath(failure.reason),
      last,
    },
    ...marks,
    routes,
    skipped: false,
    statusNamed,
  };
}

/**
 * 第一跳是拒绝点名的恢复时，第一轮的 status 有没有也点着同一条工具；status 被拒、没有跳，或第一跳不是拒绝
 * 点名的，为 null。
 */
function firstStatusNamed(
  status: Readonly<SnapshotSweepOutcome>,
  hops: readonly SnapshotSweepHop[],
  demandId: string | null,
  demandScoped: boolean,
): boolean | null {
  const hop = hops.find((entry) => entry.by !== "retry");
  if (hop === undefined || hop.by !== "refusal" || !status.ok) return null;
  return statusNamedRecovery(status, demandId, demandScoped)?.tool === hop.tool;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu;

/**
 * 显式表里的名字不带每次运行都变的部分：暂存名只留操作与权限位，UUID 换成 `<uuid>`，追加候选名里的
 * 属主（pid、序号）换成 `<owner>`。需求包与 Demand 的 id 随确认时刻变化，也一并换掉。
 */
function normalizeSnapshotSweepPath(value: string): string {
  return value
    .replace(
      /\.wakeflow-atomic-v1-([a-z]+)-[0-9a-f]+-[0-9a-f]+-(m[0-7]+)__[^/]*\.tmp/gu,
      ".wakeflow-atomic-$1-$2.tmp",
    )
    .replace(UUID, "<uuid>")
    .replace(/__[0-9]+-[0-9]+-<uuid>/gu, "__<owner>");
}

function targetOf(call: Readonly<SnapshotSweepSeamCall>): string {
  return normalizeSnapshotSweepPath(call.paths.at(-1) ?? "");
}

/**
 * 扫点范围，读 `WAKEFLOW_SNAPSHOT_SWEEP_SCOPE`：`locks`（缺省）或 `all`，其它值让测试失败（不悄悄退回缺省）。
 */
function snapshotSweepScope(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): SnapshotSweepScope {
  const value = environment.WAKEFLOW_SNAPSHOT_SWEEP_SCOPE ?? "locks";
  if (value !== "locks" && value !== "all") {
    throw new Error("WAKEFLOW_SNAPSHOT_SWEEP_SCOPE must be locks or all.");
  }
  return value;
}

/** 跑一个场景：子进程做完调用并逐步拷快照，然后按范围逐份摆回、跟进、归类。 */
export async function runSnapshotSweep(
  t: TestContext,
  scenario: Readonly<SnapshotSweepScenario>,
): Promise<SnapshotSweepReport> {
  const scope = snapshotSweepScope();
  const snapshots = path.join(disposableRoot(t, "wakeflow-snapshot-sweep-"), "snapshots");
  mkdirSync(snapshots);
  // 第 0 份是场景开始之前的样子：对照点。
  copySnapshotSweepSet(scenario.set, path.join(snapshots, "0"));
  const childStarted = performance.now();
  const powerLoss = scope === "all" && scenario.powerLoss === true;
  const child = await startSnapshotSweepProcess(
    snapshots,
    scenario.set,
    scope === "all",
    powerLoss,
  );
  let seam: readonly SnapshotSweepSeamCall[] = [];
  // 对照点的序号：开始扫点的那个调用之前最后一次接缝调用（没有铺垫时是第 0 份）。
  let controlIndex = 0;
  const childResults: Readonly<Record<string, unknown>>[] = [];
  let failed = true;
  try {
    for (const [number, entry] of scenario.calls.entries()) {
      if (number === (scenario.sweepFromCall ?? 0)) controlIndex = lastSeamIndex(snapshots);
      const call = typeof entry === "function" ? entry(childResults) : entry;
      const result = outcomeOf(
        (await child.client.callTool({
          name: call.name,
          arguments: { ...call.arguments },
        })) as CallToolResult,
        call,
      );
      if (!result.ok) {
        throw new Error(`${scenario.name}: ${call.name} refused: ${result.code}/${result.reason}`);
      }
      childResults.push(result.value);
    }
    scenario.onChildDone?.(childResults);
    failed = false;
  } finally {
    // 场景已经失败时不让退出检查盖住原来的错误。
    const closing = child.close();
    if (failed) await closing.catch(() => undefined);
    else seam = await closing;
  }
  const childMilliseconds = Math.round(performance.now() - childStarted);
  const selected = scope === "all" ? null : new Set(snapshotSweepLockPoints(seam));
  for (const index of scenario.routePoints ?? []) {
    if (!seam.some((entry) => entry.index === index && index > controlIndex)) {
      throw new Error(`${scenario.name}: route point ${index} is not a swept seam call.`);
    }
    selected?.add(index);
  }
  const invoke = await connectSnapshotSweepInvoke(t);
  const sweepStarted = performance.now();
  const points: SnapshotSweepPoint[] = [];
  const baseline: SnapshotSweepSeamCall = { index: controlIndex, method: "baseline", paths: [] };
  for (const call of [
    baseline,
    ...seam.filter((entry) => Math.trunc(entry.index) > controlIndex),
  ]) {
    if (selected !== null && call.index !== controlIndex && !selected.has(call.index)) continue;
    const started = performance.now();
    const restore = () =>
      restoreSnapshotSweepSet(path.join(snapshots, String(call.index)), scenario.set);
    restore();
    const classified = await classifySnapshotSweepPoint(
      invoke,
      scenario,
      { index: call.index, seam, childResults },
      restore,
    );
    const stuck = classified.verdict.kind === "stuck";
    const demandId = scenario.demandId?.() ?? null;
    points.push({
      index: call.index,
      method: call.method,
      file: targetOf(call),
      ...classified,
      residue: stuck ? [] : remainingLockFiles(scenario.set, seam),
      recoveryResidue: stuck ? [] : remainingRecoveryRecords(scenario.set, demandId),
      stageResidue: stuck ? [] : remainingDemandStages(scenario.set, demandId),
      milliseconds: Math.round(performance.now() - started),
    });
  }
  const powerLossPoints: SnapshotSweepPowerLossPoint[] = [];
  const positions = powerLoss ? powerLossPositions(seam, child.directorySyncs(), controlIndex) : [];
  for (const position of positions) {
    const started = performance.now();
    const state = path.join(snapshots, `power-loss-${position.label}`);
    generatePowerLossState(snapshots, seam, position, state, controlIndex);
    const restore = () => restoreSnapshotSweepSet(state, scenario.set);
    restore();
    const classified = await classifySnapshotSweepPoint(
      invoke,
      scenario,
      { index: position.seam, seam, childResults },
      restore,
    );
    const stuck = classified.verdict.kind === "stuck";
    const demandId = scenario.demandId?.() ?? null;
    powerLossPoints.push({
      index: position.seam,
      label: position.label,
      method: "power-loss",
      file: "",
      ...classified,
      residue: stuck ? [] : remainingLockFiles(scenario.set, seam),
      recoveryResidue: stuck ? [] : remainingRecoveryRecords(scenario.set, demandId),
      stageResidue: stuck ? [] : remainingDemandStages(scenario.set, demandId),
      milliseconds: Math.round(performance.now() - started),
    });
    removeSnapshotSweepNode(state);
  }
  // 对照点必须一轮就成功、status 也不被拒：否则是跟进或夹具坏了，后面的归类都不可信。
  const control = points[0];
  if (
    control?.index !== controlIndex ||
    control.verdict.kind !== "healed" ||
    control.status !== "ok"
  ) {
    throw new Error(
      `${scenario.name}: control point ${controlIndex} is not healed: ${JSON.stringify(control ?? null)}`,
    );
  }
  const report = Object.freeze({
    scenario: scenario.name,
    scope,
    childResults,
    seam,
    points,
    powerLossPoints,
    childMilliseconds,
    sweepMilliseconds: Math.round(performance.now() - sweepStarted),
  });
  dumpSnapshotSweepTables(report);
  return report;
}

/**
 * 重钉显式表用：环境变量 `WAKEFLOW_SNAPSHOT_SWEEP_DUMP` 指着一个目录时，把这一次运行算出来的每一张表
 * 写成 `<场景>-<范围>.json`（表的断言只报第一张对不上的，改过存储路径之后要一次看全）。门里不设这个
 * 变量，什么都不写；目录要写绝对路径（相对路径按测试进程的工作目录解析，不是仓库根）。写出的文件里的
 * 路径是规范化之后的，不含本机路径。
 */
function dumpSnapshotSweepTables(report: Readonly<SnapshotSweepReport>): void {
  const directory = process.env.WAKEFLOW_SNAPSHOT_SWEEP_DUMP;
  if (directory === undefined || directory.length === 0) return;
  // 测试进程的工作目录不是仓库根：相对路径会把表写到别处，看起来像没写。
  if (!path.isAbsolute(directory)) {
    throw new Error("WAKEFLOW_SNAPSHOT_SWEEP_DUMP must be an absolute directory.");
  }
  mkdirSync(directory, { recursive: true });
  const tables = {
    scenario: report.scenario,
    scope: report.scope,
    snapshots: report.seam.length,
    swept: sweptIndicesOf(report),
    points: report.points.map((point) => [point.index, point.method, point.file]),
    stuck: stuckRowsOf(report),
    signposted: signpostedRecoveryOf(report),
    statusNamed: statusNamedRecoveryOf(report),
    statusUnnamed: statusUnnamedOf(report),
    unsignposted: unsignpostedRecoveryOf(report),
    healedAfterStatusRefusal: healedAfterStatusRefusalOf(report),
    lockResidue: lockResidueOf(report),
    recoveryResidue: recoveryResidueOf(report),
    stageResidue: stageResidueOf(report),
    powerLoss: powerLossVerdictsOf(report),
    powerLossLockResidue: powerLossLockResidueOf(report),
    powerLossRecoveryResidue: powerLossRecoveryResidueOf(report),
  };
  writeFileSync(
    path.join(directory, `${report.scenario}-${report.scope}.json`),
    `${JSON.stringify(tables, null, 2)}\n`,
  );
}

/** 子进程到此刻为止做过的最后一次接缝调用的序号（它每次调用之后同步地往日志里追加一行）；没有为 0。 */
function lastSeamIndex(snapshots: string): number {
  const log = path.join(snapshots, "seam.jsonl");
  if (lstatSync(log, { throwIfNoEntry: false }) === undefined) return 0;
  const indices = readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => Math.trunc((JSON.parse(line) as SnapshotSweepSeamCall).index));
  return Math.max(0, ...indices);
}

/** 显式表的一组行：同样的结局（第一轮、出口、最后一轮），逐行给出序号、接缝成员与那一步的名字。 */
export function snapshotSweepStuckRows(
  outcome: Readonly<Omit<SnapshotSweepStuckRow, "index" | "method" | "file">>,
  rows: readonly (readonly [index: number, method: string, file: string])[],
): readonly SnapshotSweepStuckRow[] {
  return rows.map(([index, method, file]) =>
    Object.freeze({
      index,
      method,
      file,
      status: outcome.status,
      followUp: outcome.followUp,
      routes: outcome.routes,
      final: outcome.final,
    }),
  );
}

/** 报告里卡住的那些快照，按显式表的形状。 */
export function stuckRowsOf(
  report: Readonly<SnapshotSweepReport>,
): readonly SnapshotSweepStuckRow[] {
  return report.points.flatMap((point) =>
    point.verdict.kind === "stuck"
      ? [
          {
            index: point.index,
            method: point.method,
            file: point.file,
            status: point.status,
            followUp: point.followUp,
            routes: point.routes,
            final: point.verdict.last,
          },
        ]
      : [],
  );
}

/**
 * 报告里走某一类路才恢复的快照：`[序号, 路名]`。定下归类的那一轮没有跑变更跟进时（`skipped`），路名后加
 * `, follow-up skipped`，表里看得见它靠前一轮的变更。
 */
function recoveredOf(
  report: Readonly<SnapshotSweepReport>,
  kind: "signposted-recovery" | "status-named-recovery" | "unsignposted-recovery",
): readonly (readonly [index: number, route: string])[] {
  return report.points.flatMap((point) =>
    point.verdict.kind === kind
      ? [
          [
            point.index,
            `${point.verdict.route}${point.skipped ? ", follow-up skipped" : ""}`,
          ] as const,
        ]
      : [],
  );
}

/** 报告里走有路标的出口才恢复的快照：`[序号, 出口名]`。 */
export function signpostedRecoveryOf(
  report: Readonly<SnapshotSweepReport>,
): readonly (readonly [index: number, route: string])[] {
  return recoveredOf(report, "signposted-recovery");
}

/**
 * 报告里靠 status 点名才走通的快照：`[序号, 出口名]`。至少有一跳只有 status 点了名、拒绝没有点名；单列
 * 一张表，不算"没有路标"。
 */
export function statusNamedRecoveryOf(
  report: Readonly<SnapshotSweepReport>,
): readonly (readonly [index: number, route: string])[] {
  return recoveredOf(report, "status-named-recovery");
}

/** 报告里第一跳由拒绝点了名、而第一轮的 status 没有点着同一条工具的快照：`[序号, 出口名]`。 */
export function statusUnnamedOf(
  report: Readonly<SnapshotSweepReport>,
): readonly (readonly [index: number, route: string])[] {
  return report.points.flatMap((point) =>
    point.statusNamed === false && "route" in point.verdict
      ? [[point.index, point.verdict.route] as const]
      : [],
  );
}

/** 报告里治好之后仍留着恢复记录的快照：`[序号, 路径]`，每个路径一行。 */
export function recoveryResidueOf(
  report: Readonly<SnapshotSweepReport>,
): readonly (readonly [index: number, path: string])[] {
  return report.points.flatMap((point) =>
    point.recoveryResidue.map((entry) => [point.index, entry] as const),
  );
}

/** 报告里治好之后 Demand 根的三个目录里仍留着原子暂存的快照：`[序号, 路径, 个数]`。 */
export function stageResidueOf(
  report: Readonly<SnapshotSweepReport>,
): readonly (readonly [index: number, path: string, count: number])[] {
  return report.points.flatMap((point) =>
    point.stageResidue.map(([entry, count]) => [point.index, entry, count] as const),
  );
}

/**
 * 掉电盘面的归类表：每个位置一行，`[位置, 归类]`，归类写作 `healed`、`signposted:<出口>`、
 * `status-named:<出口>`、`unsignposted:<路>` 或 `stuck:<code>/<reason>`。位置也在表里，所以哪些位置
 * 生成过同时被钉住。
 */
export function powerLossVerdictsOf(
  report: Readonly<SnapshotSweepReport>,
): readonly (readonly [label: string, verdict: string])[] {
  return report.powerLossPoints.map((point) => {
    const verdict = point.verdict;
    if (verdict.kind === "healed") return [point.label, "healed"] as const;
    if (verdict.kind === "stuck") {
      return [point.label, `stuck:${verdict.code}/${verdict.reason}`] as const;
    }
    return [point.label, `${verdict.kind.replace("-recovery", "")}:${verdict.route}`] as const;
  });
}

/**
 * 显式表里掉电盘面的行，按归类成组写：`[归类, 位置…]`；展开之后按位置的先后（第几步之后、第几次
 * 目录同步）排好，与 `powerLossVerdictsOf` 的顺序相同。
 */
export function snapshotSweepPowerLossRows(
  groups: readonly (readonly [verdict: string, labels: readonly string[]])[],
): readonly (readonly [label: string, verdict: string])[] {
  const order = (label: string): readonly [number, number] => {
    const [step, sync] = label.split("~");
    return [Number(step), Number(sync)];
  };
  return groups
    .flatMap(([verdict, labels]) => labels.map((label) => [label, verdict] as const))
    .sort(([left], [right]) => {
      const [leftStep, leftSync] = order(left);
      const [rightStep, rightSync] = order(right);
      return leftStep - rightStep || leftSync - rightSync;
    });
}

/** 掉电盘面治好之后仍留着的 L1–L7 锁文件或锁暂存：`[位置, 路径, 个数]`。 */
export function powerLossLockResidueOf(
  report: Readonly<SnapshotSweepReport>,
): readonly (readonly [label: string, path: string, count: number])[] {
  return report.powerLossPoints.flatMap((point) =>
    point.residue.map(([entry, count]) => [point.label, entry, count] as const),
  );
}

/** 掉电盘面治好之后仍留着的恢复记录：`[位置, 路径]`。 */
export function powerLossRecoveryResidueOf(
  report: Readonly<SnapshotSweepReport>,
): readonly (readonly [label: string, path: string])[] {
  return report.powerLossPoints.flatMap((point) =>
    point.recoveryResidue.map((entry) => [point.label, entry] as const),
  );
}

/** 报告里有路标的都走不通、走没有路标的路才恢复的快照：`[序号, 路名]`。 */
export function unsignpostedRecoveryOf(
  report: Readonly<SnapshotSweepReport>,
): readonly (readonly [index: number, route: string])[] {
  return recoveredOf(report, "unsignposted-recovery");
}

/** 报告里治好之后仍留着 L1–L7 锁文件或锁暂存的快照：`[序号, 路径, 个数]`，每个路径一行。 */
export function lockResidueOf(
  report: Readonly<SnapshotSweepReport>,
): readonly (readonly [index: number, path: string, count: number])[] {
  return report.points.flatMap((point) =>
    point.residue.map(([entry, count]) => [point.index, entry, count] as const),
  );
}

/** 共享操作作用域的读者租约（L2）规范化之后的路径：死掉的读者租约只有之后的独占获取才清。 */
export const SNAPSHOT_SWEEP_READER_LEASE =
  "workspace:.wakeflow-local/runtime/operation-admission/reader-<uuid>.lock";

/** 显式表里一段连续的序号 `[from, to]`（含两端，只有整数序号）。 */
export function snapshotSweepSpan(from: number, to: number): readonly number[] {
  return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
}

/**
 * 锁残留的显式表：每个路径、它的个数与留着它的序号，摊平后按 `lockResidueOf` 的顺序（序号，再路径）排好。
 */
export function snapshotSweepResidueRows(
  groups: readonly (readonly [path: string, count: number, indices: readonly number[]])[],
): readonly (readonly [index: number, path: string, count: number])[] {
  return groups
    .flatMap(([entry, count, indices]) => indices.map((index) => [index, entry, count] as const))
    .sort(([leftIndex, leftPath], [rightIndex, rightPath]) =>
      leftIndex !== rightIndex ? leftIndex - rightIndex : leftPath < rightPath ? -1 : 1,
    );
}

/** 报告里第一轮 status 被拒、但变更跟进把它治好的快照：`[序号, status 的 code/reason]`。 */
export function healedAfterStatusRefusalOf(
  report: Readonly<SnapshotSweepReport>,
): readonly (readonly [index: number, status: string])[] {
  return report.points.flatMap((point) =>
    point.verdict.kind === "healed" && point.status !== "ok"
      ? [[point.index, point.status] as const]
      : [],
  );
}

/**
 * 一份钉住的全量表在本次范围里应有的样子：`all` 原样，`locks` 只留摆回过的序号（行的第一项或 `index`）。
 * `all` 范围不过滤：钉住的行所在的点没有摆回（同步点不再产生、接缝变短）就是失败。`locks` 摆回了哪些点另由
 * `sweptIndicesOf` 钉住。
 */
export function withinSweptPoints<Row>(
  report: Readonly<SnapshotSweepReport>,
  rows: readonly Row[],
  indexOf: (row: Row) => number,
): readonly Row[] {
  if (report.scope === "all") return rows;
  const swept = new Set(report.points.map((point) => point.index));
  return rows.filter((row) => swept.has(indexOf(row)));
}

/** 本次范围摆回过的序号，按摆回的顺序（第 0 份在前）。 */
export function sweptIndicesOf(report: Readonly<SnapshotSweepReport>): readonly number[] {
  return report.points.map((point) => point.index);
}

/**
 * `all` 范围摆回的序号的显式写法：第 0 份到最后一次接缝调用的每个整数序号，加上内容同步之后的那些带小数的
 * 序号，按序号排好。
 */
export function snapshotSweepAllPoints(
  last: number,
  contentSynced: readonly number[],
): readonly number[] {
  return [...snapshotSweepSpan(0, last), ...contentSynced].sort((left, right) => left - right);
}

/**
 * 一份报告的一行摘要：每份快照 `序号:h|r(出口)|u(路)|s`，status 先被拒的 healed 记 `h*`，定下归类的一轮没跑
 * 变更跟进的加 `~`，治好之后留着锁残留的再加 `!`；失败时整行进诊断。
 */
export function summarizeSnapshotSweep(report: Readonly<SnapshotSweepReport>): string {
  const marks = report.points.map((point) => {
    const seconds = (point.milliseconds / 1000).toFixed(1);
    const residue =
      point.residue.length + point.recoveryResidue.length + point.stageResidue.length > 0;
    const flags = `${point.skipped ? "~" : ""}${residue ? "!" : ""}`;
    if (point.verdict.kind === "healed")
      return `${point.index}:${point.status === "ok" ? "h" : "h*"}${flags}/${seconds}`;
    if (point.verdict.kind === "signposted-recovery")
      return `${point.index}:r(${point.verdict.route})${flags}/${seconds}`;
    if (point.verdict.kind === "status-named-recovery")
      return `${point.index}:n(${point.verdict.route})${flags}/${seconds}`;
    if (point.verdict.kind === "unsignposted-recovery")
      return `${point.index}:u(${point.verdict.route})${flags}/${seconds}`;
    return `${point.index}:s/${seconds}`;
  });
  const powerLoss =
    report.powerLossPoints.length === 0
      ? ""
      : `; power loss: ${powerLossVerdictsOf(report)
          .map(([label, verdict]) => `${label}:${verdict}`)
          .join(" ")}`;
  return `${report.scenario} [${report.scope}]: ${report.seam.length} snapshots, ${report.points.length} replayed, child ${report.childMilliseconds} ms, sweep ${report.sweepMilliseconds} ms; ${marks.join(" ")}${powerLoss}`;
}

/** 每一行一份 JSON：卡住、走出口、status 先被拒与留着锁残留的快照的完整记录，供诊断与重新生成显式表。 */
export function snapshotSweepRowDiagnostics(
  report: Readonly<SnapshotSweepReport>,
): readonly string[] {
  return report.points
    .filter(
      (point) =>
        point.verdict.kind !== "healed" ||
        point.status !== "ok" ||
        point.skipped ||
        point.residue.length > 0 ||
        point.recoveryResidue.length > 0 ||
        point.stageResidue.length > 0,
    )
    .map((point) => JSON.stringify(point));
}

/**
 * 落盘归档表第 2 节的锁族（L1–L7 是轻档的七族，L8–L12 留在权威档），按接缝日志里出现过的路径认。路径是
 * `snapshot-sweep-process.ts` 记下的带根前缀写法。
 */
const LOCK_FAMILIES: readonly (readonly [string, RegExp])[] = Object.freeze([
  [
    "L1 operation-scope latch and writer",
    /^workspace:\.wakeflow-local\/runtime\/operation-admission\/(latch|writer)\.lock$/u,
  ],
  [
    "L2 reader leases",
    /^workspace:\.wakeflow-local\/runtime\/operation-admission\/reader-[^/]*\.lock$/u,
  ],
  ["L3 projector lock", /^workspace:\.wakeflow-active\/projector\.lock$/u],
  ["L4 board locks", /^workspace:\.wakeflow-active\/current\/board\/locks\/[^/]+\.lock$/u],
  ["L5 pod mutation lock", /^workspace:\.wakeflow-local\/runtime\/pod-mutations\/[^/]+\.lock$/u],
  [
    "L6 Demand publication lock",
    /^workspace:\.wakeflow-active\/current\/demand-publication\/locks\/[^/]+\.lock$/u,
  ],
  ["L7 ledger record lock", /^ledger:transactions\/[^/]+\.lock$/u],
  ["L8 binding registration lock", /\/window-bindings\/\.registration\.lock$/u],
  ["L9 maintenance gate", /^workspace:\.wakeflow-local\/runtime\/maintenance\.lock$/u],
  ["L10 config authority lock", /^workspace:\.wakeflow-config-authority\.lock$/u],
  ["L11 gitignore recomposition lock", /^workspace:\.wakeflow-gitignore-recomposition\.lock$/u],
  ["L12 program instruction lock", /^workspace:\.wakeflow-program-instruction-[^/]+\.lock$/u],
]);

/** 第 1 段降档的七族（L1–L7）。 */
const SELF_RETIRING_LOCK_FAMILIES = LOCK_FAMILIES.slice(0, 7);

function isSelfRetiringLock(entry: string): boolean {
  return SELF_RETIRING_LOCK_FAMILIES.some(([, pattern]) => pattern.test(entry));
}

/** 原子暂存名里的目标摘要（`durable-atomic-file-stage-address.ts` 的命名）。 */
const ATOMIC_STAGE_TARGET = /^\.wakeflow-atomic-v1-(?:create|replace)-([0-9a-f]{64})-/u;

/** 带根前缀的写法（`workspace:`、`ledger:`）换回绝对路径；`outside:` 不查。 */
function resolveLabeled(set: Readonly<SnapshotSweepSet>, entry: string): string | null {
  const separator = entry.indexOf(":");
  const prefix = entry.slice(0, separator);
  const relative = entry.slice(separator + 1);
  if (prefix === "workspace") return path.join(set.workspace, ...relative.split("/"));
  if (prefix === "ledger") return path.join(set.ledger, ...relative.split("/"));
  return null;
}

function labeledDirectoryOf(entry: string): string {
  const separator = entry.indexOf(":");
  return `${entry.slice(0, separator)}:${path.posix.dirname(entry.slice(separator + 1))}`;
}

function labeledChild(directory: string, name: string): string {
  return directory.endsWith(":.") ? `${directory.slice(0, -1)}${name}` : `${directory}/${name}`;
}

function directoryNames(directory: string): readonly string[] {
  return lstatSync(directory, { throwIfNoEntry: false })?.isDirectory() === true
    ? readdirSync(directory)
    : [];
}

/** `current/` 的带根前缀写法。 */
const CURRENT_ROOT = "workspace:.wakeflow-active/current";

/**
 * 治好之后仍在的恢复记录（见 `SnapshotSweepPoint.recoveryResidue`）：`current/` 里以 `.retire-` 开头的名字
 * 不分 Demand 都算；日志、发布标记与发布暂存树按场景的 Demand 查，场景没有声明 Demand 就不查。
 */
function remainingRecoveryRecords(
  set: Readonly<SnapshotSweepSet>,
  demandId: string | null,
): readonly string[] {
  const current = path.join(set.workspace, ".wakeflow-active", "current");
  const found = directoryNames(current)
    .filter((name) => name.startsWith(".retire-") || name.startsWith(".restore-"))
    .map((name) => `${CURRENT_ROOT}/${name}`);
  if (demandId !== null) {
    for (const relative of [
      `lifecycle/${demandId}.json`,
      `${demandId}/transactions/publication.json`,
      `demand-publication/stages/${demandId}`,
    ]) {
      const absolute = path.join(current, ...relative.split("/"));
      if (lstatSync(absolute, { throwIfNoEntry: false }) !== undefined) {
        found.push(`${CURRENT_ROOT}/${relative}`);
      }
    }
  }
  return found.map(normalizeSnapshotSweepPath).sort();
}

/** foundation 原子暂存文件名的前缀（`durable-atomic-file-stage-address.ts` 的命名）。 */
const ATOMIC_STAGE_PREFIX = ".wakeflow-atomic-";

/** 治好之后这个 Demand 的三个目录里仍在的原子暂存名（见 `SnapshotSweepPoint.stageResidue`）。 */
function remainingDemandStages(
  set: Readonly<SnapshotSweepSet>,
  demandId: string | null,
): readonly (readonly [path: string, count: number])[] {
  if (demandId === null) return [];
  const root = path.join(set.workspace, ".wakeflow-active", "current", demandId);
  const found: string[] = [];
  for (const relative of [
    "event-sourcing/index",
    "event-sourcing/snapshots",
    "artifacts/task-packages",
  ]) {
    for (const name of directoryNames(path.join(root, ...relative.split("/")))) {
      if (name.startsWith(ATOMIC_STAGE_PREFIX)) {
        found.push(`${CURRENT_ROOT}/${demandId}/${relative}/${name}`);
      }
    }
  }
  return countSnapshotSweepResidue(found);
}

/**
 * 治好之后仍在的 L1–L7 锁文件与锁暂存（见文件头"治好之后的锁残留"）：日志里出现过的锁路径逐个查是否还在；
 * 这些路径所在的目录逐个列出，其中 L1–L7 的锁名、以及目标摘要等于日志里某个锁暂存目标摘要的原子暂存都算。
 * 每个名字只算一次，规范化之后按路径计数。
 */
function remainingLockFiles(
  set: Readonly<SnapshotSweepSet>,
  seam: readonly SnapshotSweepSeamCall[],
): readonly (readonly [path: string, count: number])[] {
  const locks = new Set(seam.flatMap((call) => call.paths.filter(isSelfRetiringLock)));
  const digests = new Set(
    seam.flatMap((call) =>
      call.paths.some(isSelfRetiringLock)
        ? call.paths.flatMap((entry) => {
            const digest = ATOMIC_STAGE_TARGET.exec(path.posix.basename(entry))?.[1];
            return digest === undefined ? [] : [digest];
          })
        : [],
    ),
  );
  const remaining = new Set<string>();
  for (const lock of locks) {
    const absolute = resolveLabeled(set, lock);
    if (absolute !== null && lstatSync(absolute, { throwIfNoEntry: false }) !== undefined)
      remaining.add(lock);
  }
  for (const directory of new Set([...locks].map(labeledDirectoryOf))) {
    const absolute = resolveLabeled(set, `${directory}/x`);
    if (absolute === null) continue;
    const parent = path.dirname(absolute);
    if (lstatSync(parent, { throwIfNoEntry: false })?.isDirectory() !== true) continue;
    for (const name of readdirSync(parent)) {
      const entry = labeledChild(directory, name);
      const digest = ATOMIC_STAGE_TARGET.exec(name)?.[1];
      if (isSelfRetiringLock(entry) || (digest !== undefined && digests.has(digest)))
        remaining.add(entry);
    }
  }
  return countSnapshotSweepResidue(remaining);
}

/**
 * 仍在的名字规范化之后按路径计数、按路径排序：几个名字规范化成同一个（例如几个死读者租约）时个数大于 1，
 * 不合并成一项。
 */
export function countSnapshotSweepResidue(
  entries: Iterable<string>,
): readonly (readonly [path: string, count: number])[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const normalized = normalizeSnapshotSweepPath(entry);
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return [...counts]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([entry, count]) => [entry, count] as const);
}

/** 一份接缝日志碰到的锁族（按上表的顺序）。 */
export function lockFamiliesOf(seam: readonly SnapshotSweepSeamCall[]): readonly string[] {
  const paths = seam.flatMap((call) => call.paths);
  return LOCK_FAMILIES.filter(([, pattern]) => paths.some((entry) => pattern.test(entry))).map(
    ([name]) => name,
  );
}

/**
 * `locks` 范围摆回的序号：第 0 份；每一次作用在 L1–L7 文件上的接缝调用之后的那一份，以及它之前的那一份。
 * 锁文件按上表认；它的创建暂存按"与锁文件出现在同一次接缝调用里"认（链接那一步的参数是暂存与锁），暂存名
 * 带每次新建的随机部分，所以之后对同一个名字的退役也认得出。
 */
function snapshotSweepLockPoints(seam: readonly SnapshotSweepSeamCall[]): ReadonlySet<number> {
  const isLock = isSelfRetiringLock;
  const stages = new Set(
    seam.flatMap((call) =>
      call.paths.some(isLock) ? call.paths.filter((entry) => !isLock(entry)) : [],
    ),
  );
  const selected = new Set<number>([0]);
  for (const call of seam) {
    if (call.paths.some((entry) => isLock(entry) || stages.has(entry))) {
      selected.add(call.index);
      selected.add(call.index - 1);
    }
  }
  return selected;
}

/** 账本根：配置里 `storage.ledgerRoot` 相对工作区根解析。 */
export function ledgerRootOf(workspace: string): string {
  const config = JSON.parse(readFileSync(path.join(workspace, "wakeflow.config.json"), "utf8")) as {
    storage: { ledgerRoot: string };
  };
  return path.resolve(workspace, config.storage.ledgerRoot);
}
