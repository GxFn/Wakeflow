import { DELIVERY_LANDING_SILENCE_MILLISECONDS } from "../../governance/delivery/delivery-outcome.js";
import type { WakeflowHostId } from "../../contracts/vocabulary/wakeflow-host-id.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { UtcInstant } from "../../foundation/time/utc-instant.js";
import { DELIVERY_REARM_LIMIT } from "../../governance/delivery/delivery-rearm.js";
import type {
  DeliveryAttemptStatus,
  DeliveryDisposition,
  DeliveryEvidenceKind,
  DeliveryReadbackStatus,
} from "../../governance/delivery/delivery-outcome.js";

/**
 * Wakeflow Capabilities / Delivery：投递切片的纯决定（能力卡 6，ADR-0009，ADR-0012 D2）。
 *
 * 这里没有 I/O：处置由证据派生，准备与 rearm 的阻塞项由状态派生，静默阈值只做时间比较。
 * 阈值按 ADR-0012 未决数值先作常量，由治理层 `delivery-outcome` 导出并进 status 的 policy 段（§13.94 D7）。
 */

/** ambiguous 静默阈值：超过后 `next` 转给 Controller 并列出 landing-evidence-missing；值在治理层的策略表里。 */
export { DELIVERY_LANDING_SILENCE_MILLISECONDS };

/** 目标窗口必须加载的技能：宿主差异只在指令文件名，技能路径两宿主一致。 */
export const DELIVERY_REQUIRED_SKILLS: Readonly<
  Record<"implementation" | "test", readonly string[]>
> = Object.freeze({
  implementation: Object.freeze([
    "skills/wakeflow-target/SKILL.md",
    "skills/wakeflow-target-craft/SKILL.md",
  ]),
  test: Object.freeze(["skills/wakeflow-target/SKILL.md", "skills/wakeflow-test/SKILL.md"]),
});

/** 可以准备投递的实现目标 phase；host-effect-rejected 只在 rearm 用尽后允许换新信封。 */
const PREPARABLE_IMPLEMENTATION_PHASES: readonly string[] = Object.freeze([
  "planned",
  "rework-requested",
  "product-defect-rework-requested",
  "host-effect-rejected",
]);

const PREPARABLE_TEST_PHASES: readonly string[] = Object.freeze([
  "planned",
  "test-another-attempt-requested",
]);

export interface HookLandingRecord {
  readonly recordId: string;
  readonly promptDigest: Sha256Digest | null;
  readonly recordedAt: UtcInstant;
}

export interface DispositionInput {
  readonly hostId: WakeflowHostId;
  readonly attempt: Readonly<{
    readonly status: DeliveryAttemptStatus;
    readonly evidenceDigest: Sha256Digest | null;
  }>;
  readonly readback: Readonly<{
    readonly status: DeliveryReadbackStatus;
    readonly evidenceDigest: Sha256Digest | null;
  }>;
  /** 目标会话在许可签发之后的 `user-prompt-submit` 记录。 */
  readonly landingRecords: readonly Readonly<HookLandingRecord>[];
  readonly expectedPromptDigest: Sha256Digest;
  readonly resolution: Readonly<{
    readonly disposition: "accepted" | "rejected-before-send";
    readonly hookRecordId: string | null;
    readonly rationale: string;
  }> | null;
  /** Controller 解决引用的记录是否真的存在于目标会话（issuedAt 之后）。 */
  readonly resolutionRecordFound: boolean;
  /** 当前 phase 是否已经是 indeterminate（显式解决只在这里允许）。 */
  readonly currentlyIndeterminate: boolean;
}

export type DispositionDecision =
  | Readonly<{
      readonly accepted: true;
      readonly disposition: DeliveryDisposition;
      readonly evidenceKind: DeliveryEvidenceKind;
      readonly hookRecordId: string | null;
      readonly rationale: string | null;
    }>
  | Readonly<{ readonly accepted: false; readonly blocker: string }>;

function decided(
  disposition: DeliveryDisposition,
  evidenceKind: DeliveryEvidenceKind,
  hookRecordId: string | null = null,
  rationale: string | null = null,
): DispositionDecision {
  return Object.freeze({
    accepted: true as const,
    disposition,
    evidenceKind,
    hookRecordId,
    rationale,
  });
}

function resolutionDecision(input: DispositionInput): DispositionDecision {
  const resolution = input.resolution;
  if (resolution === null)
    return Object.freeze({ accepted: false as const, blocker: "resolution-missing" });
  if (!input.currentlyIndeterminate) {
    return Object.freeze({ accepted: false as const, blocker: "resolution-phase" });
  }
  if (resolution.disposition === "accepted") {
    if (resolution.hookRecordId === null || !input.resolutionRecordFound) {
      return Object.freeze({ accepted: false as const, blocker: "resolution-evidence-missing" });
    }
    return decided(
      "accepted",
      "controller-resolution",
      resolution.hookRecordId,
      resolution.rationale,
    );
  }
  return decided("rejected-before-send", "controller-resolution", null, resolution.rationale);
}

/**
 * 处置派生（能力卡 6 修订）：匹配的 hook 记录 → accepted；发送调用失败且未触碰会话 →
 * rejected-before-send；Codex 的发送返回摘要 → accepted；其余 indeterminate。显式解决优先。
 */
export function deriveDeliveryDisposition(input: Readonly<DispositionInput>): DispositionDecision {
  if (input.resolution !== null) return resolutionDecision(input);
  const landed = input.landingRecords.find(
    (record) => record.promptDigest === input.expectedPromptDigest,
  );
  if (landed !== undefined) return decided("accepted", "hook-record", landed.recordId);
  if (input.attempt.status === "failed-before-send") {
    if (input.currentlyIndeterminate) {
      return Object.freeze({ accepted: false as const, blocker: "attempt-status" });
    }
    return decided("rejected-before-send", "agent-declaration");
  }
  if (
    input.hostId === "codex" &&
    input.attempt.status === "sent" &&
    input.attempt.evidenceDigest !== null
  ) {
    return decided("accepted", "host-send-return");
  }
  if (input.currentlyIndeterminate) {
    return Object.freeze({ accepted: false as const, blocker: "landing-evidence-missing" });
  }
  return decided("indeterminate", "agent-declaration");
}

/** 静默是否超过阈值：以许可签发时刻为起点。 */
export function landingSilenceExceeded(
  issuedAt: UtcInstant,
  now: UtcInstant,
  thresholdMilliseconds = DELIVERY_LANDING_SILENCE_MILLISECONDS,
): boolean {
  return Date.parse(now) - Date.parse(issuedAt) > thresholdMilliseconds;
}

export interface PrepareTargetView {
  readonly workType: "implementation" | "test";
  readonly phase: string;
  readonly generation: number | null;
}

/** 准备投递的目标 phase 阻塞项；rearm 未用尽的 rejected 目标必须先 rearm。 */
export function derivePrepareBlockers(target: Readonly<PrepareTargetView>): readonly string[] {
  const admitted =
    target.workType === "test"
      ? PREPARABLE_TEST_PHASES.includes(target.phase)
      : PREPARABLE_IMPLEMENTATION_PHASES.includes(target.phase);
  if (!admitted) return Object.freeze([`target-phase:${target.phase}`]);
  if (
    target.phase === "host-effect-rejected" &&
    target.generation !== null &&
    target.generation <= DELIVERY_REARM_LIMIT
  ) {
    return Object.freeze([`rearm-available:${target.generation}`]);
  }
  return Object.freeze([]);
}

export interface RearmTargetView {
  readonly phase: string;
  readonly generation: number;
}

/** rearm 的阻塞项：只有 rejected-before-send 的当前代际可以 rearm，且不超过上限。 */
export function deriveRearmBlockers(target: Readonly<RearmTargetView>): readonly string[] {
  if (target.phase !== "host-effect-rejected" && target.phase !== "test-host-effect-rejected") {
    return Object.freeze([`target-phase:${target.phase}`]);
  }
  if (target.generation > DELIVERY_REARM_LIMIT)
    return Object.freeze([`rearm-limit:${target.generation}`]);
  return Object.freeze([]);
}

export interface ClaimHolderView {
  readonly demandId: string;
  readonly targetTaskId: string;
  readonly deliveryId: string;
}

/**
 * 窗口声明占用判定：另一 Demand 或另一目标持有即阻塞；同一目标的孤儿声明（聚合里没有
 * 对应投递）允许回收。
 */
export function deriveClaimBlocker(
  holder: Readonly<ClaimHolderView> | null,
  demandId: string,
  targetTaskId: string,
  knownDeliveryIds: readonly string[],
): Readonly<{ readonly blocker: string | null; readonly reclaim: boolean }> {
  if (holder === null) return Object.freeze({ blocker: null, reclaim: false });
  if (holder.demandId !== demandId) {
    return Object.freeze({ blocker: `window-claimed:${holder.demandId}`, reclaim: false });
  }
  if (holder.targetTaskId !== targetTaskId) {
    return Object.freeze({ blocker: `window-claimed:${holder.targetTaskId}`, reclaim: false });
  }
  if (knownDeliveryIds.includes(holder.deliveryId)) {
    return Object.freeze({ blocker: `window-claimed:${holder.deliveryId}`, reclaim: false });
  }
  return Object.freeze({ blocker: null, reclaim: true });
}
