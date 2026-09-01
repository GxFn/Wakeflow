import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import type { WakeflowWorkspaceHostId } from "../../workspace/workspace-host-resource-profile.js";
import type { WakeflowWindowHostBindingId } from "../../workspace/window-runtime/wakeflow-window-host-binding-id.js";
import type { WakeflowAgentHostWindowObservationAuthority } from "../../workspace/window-runtime/wakeflow-agent-host-window-observation-authority.js";
import type {
  WindowWorkClaimId,
  WindowWorkClaim,
} from "./window-work-claim.js";
import type { TargetDeliveryIntent } from "./target-delivery-intent.js";
import { windowWorkClaimRef } from "./window-work-claim-resource-catalog.js";

/**
 * Wakeflow Governance / Delivery：交给 Agent 执行的一次性宿主发送动作。
 *
 * Action 只在 Claim Event 首次提交成功后生成。它包含最终 prompt、脱敏路由元组和
 * 本次当前观察摘要，但不包含 raw handle；Agent 继续使用刚从宿主能力取得并提交验证的
 * 同一候选 handle。Action 不持久化，workspace 绝对根路径只以 JSON 字符串出现在本次
 * prompt 中。
 */

export interface TargetDeliveryAgentHostAction {
  readonly kind: "WakeflowTargetDeliveryAgentHostAction";
  readonly schemaVersion: 1;
  readonly actionId: WindowWorkClaimId;
  readonly effect: "send-message-to-observed-target-window";
  readonly hostId: WakeflowWorkspaceHostId;
  readonly windowId: WindowWorkClaim["route"]["windowId"];
  readonly bindingId: WakeflowWindowHostBindingId;
  readonly targetDeliveryId: TargetDeliveryIntent["targetDeliveryId"];
  readonly intentDigest: Sha256Digest;
  readonly workClaim: Readonly<{
    readonly claimId: WindowWorkClaimId;
    readonly claimRef: ReturnType<typeof windowWorkClaimRef>;
    readonly claimDigest: Sha256Digest;
    readonly expectedStateDigest: Sha256Digest;
    readonly claimCommitId: WindowWorkClaim["claimTransition"]["commitId"];
  }>;
  readonly hostObservation: Readonly<{
    readonly authorityDigest: Sha256Digest;
    readonly observedAt: WakeflowAgentHostWindowObservationAuthority["rootAttestation"]["observedAt"];
  }>;
  readonly prompt: string;
  readonly issuedAt: WindowWorkClaim["claimedAt"];
  readonly claimEvent: Readonly<{
    readonly eventId: WindowWorkClaim["claimTransition"]["eventId"];
    readonly streamRevision: number;
    readonly stateDigest: Sha256Digest;
  }>;
}

export type TargetDeliveryAgentHostActionErrorReason =
  "input" | "relation" | "capacity";

const ERROR_MESSAGES = {
  input: "Agent Host Action input is invalid.",
  relation: "Agent Host Action sources are inconsistent.",
  capacity: "Agent Host Action prompt exceeds its capacity.",
} as const satisfies Readonly<
  Record<TargetDeliveryAgentHostActionErrorReason, string>
>;

/** 无法从已提交 Claim 事实安全生成目标投递宿主动作时的稳定错误。 */
export class TargetDeliveryAgentHostActionError extends Error {
  override readonly name = "TargetDeliveryAgentHostActionError";
  readonly code = "wakeflow-target-delivery-agent-host-action" as const;
  readonly reason: TargetDeliveryAgentHostActionErrorReason;

  constructor(reason: TargetDeliveryAgentHostActionErrorReason) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

const MAXIMUM_ACTION_PROMPT_BYTES = 128 * 1024;

function fail(reason: TargetDeliveryAgentHostActionErrorReason): never {
  throw new TargetDeliveryAgentHostActionError(reason);
}

function actionPrompt(
  absoluteWorkspaceRoot: string,
  intent: Readonly<TargetDeliveryIntent>,
): string {
  if (
    absoluteWorkspaceRoot.length === 0 ||
    !absoluteWorkspaceRoot.isWellFormed()
  ) {
    fail("input");
  }
  const rootLine =
    intent.language === "zh-Hans"
      ? `Wakeflow workspace 根目录（JSON 字符串）：${JSON.stringify(absoluteWorkspaceRoot)}`
      : `Wakeflow workspace root (JSON string): ${JSON.stringify(absoluteWorkspaceRoot)}`;
  const prompt = `${intent.portablePrompt}\n\n${rootLine}`;
  if (encodeUtf8(prompt, "$prompt").byteLength > MAXIMUM_ACTION_PROMPT_BYTES) {
    fail("capacity");
  }
  return prompt;
}

/** 从首次提交的 Claim Event 回执生成唯一的瞬时目标投递宿主动作。 */
export function createTargetDeliveryAgentHostAction(
  absoluteWorkspaceRoot: string,
  intent: Readonly<TargetDeliveryIntent>,
  claim: Readonly<WindowWorkClaim>,
  hostObservation: Readonly<WakeflowAgentHostWindowObservationAuthority>,
  claimEvent: Readonly<{
    readonly eventId: WindowWorkClaim["claimTransition"]["eventId"];
    readonly streamRevision: number;
    readonly stateDigest: Sha256Digest;
  }>,
): Readonly<TargetDeliveryAgentHostAction> {
  if (
    claim.target.targetDeliveryId !== intent.targetDeliveryId ||
    claim.target.intentDigest !== intent.intentDigest ||
    claim.target.demandId !== intent.demandId ||
    claim.target.targetTaskId !== intent.target.targetTaskId ||
    claim.route.hostId !== intent.route.hostId ||
    claim.route.windowId !== intent.route.windowId ||
    claim.route.bindingId !== intent.route.bindingId ||
    hostObservation.programId !== claim.programId ||
    hostObservation.hostId !== claim.route.hostId ||
    hostObservation.windowId !== claim.route.windowId ||
    hostObservation.binding.bindingId !== claim.route.bindingId ||
    claimEvent.eventId !== claim.claimTransition.eventId ||
    claimEvent.streamRevision !==
      claim.claimTransition.expectedStreamRevision + 1
  ) {
    fail("relation");
  }
  return Object.freeze({
    kind: "WakeflowTargetDeliveryAgentHostAction" as const,
    schemaVersion: 1 as const,
    actionId: claim.claimId,
    effect: "send-message-to-observed-target-window" as const,
    hostId: claim.route.hostId,
    windowId: claim.route.windowId,
    bindingId: claim.route.bindingId,
    targetDeliveryId: claim.target.targetDeliveryId,
    intentDigest: claim.target.intentDigest,
    workClaim: Object.freeze({
      claimId: claim.claimId,
      claimRef: windowWorkClaimRef(claim.route.windowId),
      claimDigest: claim.claimDigest,
      expectedStateDigest: claim.claimTransition.expectedStateDigest,
      claimCommitId: claim.claimTransition.commitId,
    }),
    hostObservation: Object.freeze({
      authorityDigest: hostObservation.authorityDigest,
      observedAt: hostObservation.rootAttestation.observedAt,
    }),
    prompt: actionPrompt(absoluteWorkspaceRoot, intent),
    issuedAt: claim.claimedAt,
    claimEvent: Object.freeze({ ...claimEvent }),
  });
}
