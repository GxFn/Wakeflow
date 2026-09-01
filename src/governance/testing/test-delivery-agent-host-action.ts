import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import type { WakeflowWorkspaceHostId } from "../../workspace/workspace-host-resource-profile.js";
import type { WakeflowWindowHostBindingId } from "../../workspace/window-runtime/wakeflow-window-host-binding-id.js";
import type { WakeflowAgentHostWindowObservationAuthority } from "../../workspace/window-runtime/wakeflow-agent-host-window-observation-authority.js";
import { demandFinalRootRef } from "../demand/publication/demand-publication-paths.js";
import type {
  WindowWorkClaim,
  WindowWorkClaimId,
} from "../delivery/window-work-claim.js";
import { windowWorkClaimRef } from "../delivery/window-work-claim-resource-catalog.js";
import type { TestDeliveryIntent } from "./test-delivery-intent.js";
import type { TestDispatchPacket } from "./test-dispatch-packet.js";
import {
  testDispatchPacketProjectionRef,
  TestDispatchProjectionPathError,
} from "./test-dispatch-projection-paths.js";

/**
 * Wakeflow Governance / Testing：首次Test Claim Event提交后交给Agent的
 * 一次性宿主动作。
 *
 * Action绑定同一logical Test attempt和target-facing packet digest，携带最终prompt与
 * 脱敏路由，但不包含raw handle，也不持久化。真实宿主调用及其最多一次readback
 * 属于后续owner。
 */

export interface TestDeliveryAgentHostAction {
  readonly kind: "WakeflowTestDeliveryAgentHostAction";
  readonly schemaVersion: 1;
  readonly actionId: WindowWorkClaimId;
  readonly effect: "send-message-to-observed-target-window";
  readonly hostId: WakeflowWorkspaceHostId;
  readonly windowId: WindowWorkClaim["route"]["windowId"];
  readonly bindingId: WakeflowWindowHostBindingId;
  readonly targetDeliveryId: TestDeliveryIntent["targetDeliveryId"];
  readonly intentDigest: Sha256Digest;
  readonly testAttemptId: TestDeliveryIntent["attempt"]["testAttemptId"];
  readonly testDispatchPacket: Readonly<{
    readonly ref: PortableResourcePath;
    readonly digest: Sha256Digest;
  }>;
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

export type TestDeliveryAgentHostActionErrorReason =
  "input" | "relation" | "capacity";

const ERROR_MESSAGES = {
  input: "Test Agent Host Action input is invalid.",
  relation: "Test Agent Host Action sources are inconsistent.",
  capacity: "Test Agent Host Action prompt exceeds its capacity.",
} as const satisfies Readonly<
  Record<TestDeliveryAgentHostActionErrorReason, string>
>;

/** 无法从首次提交的Test Claim事实生成安全宿主动作时的稳定错误。 */
export class TestDeliveryAgentHostActionError extends Error {
  override readonly name = "TestDeliveryAgentHostActionError";
  readonly code = "wakeflow-test-delivery-agent-host-action" as const;
  readonly reason: TestDeliveryAgentHostActionErrorReason;

  constructor(reason: TestDeliveryAgentHostActionErrorReason) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

const MAXIMUM_ACTION_PROMPT_BYTES = 128 * 1024;

function fail(reason: TestDeliveryAgentHostActionErrorReason): never {
  throw new TestDeliveryAgentHostActionError(reason);
}

function actionPrompt(
  absoluteWorkspaceRoot: string,
  intent: Readonly<TestDeliveryIntent>,
  packet: Readonly<TestDispatchPacket>,
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
  const prompt = `${packet.portablePrompt}\n\n${rootLine}`;
  if (encodeUtf8(prompt, "$prompt").byteLength > MAXIMUM_ACTION_PROMPT_BYTES) {
    fail("capacity");
  }
  return prompt;
}

function packetRef(intent: Readonly<TestDeliveryIntent>): PortableResourcePath {
  try {
    return parsePortableResourcePath(
      `${demandFinalRootRef(intent.demandId)}/${testDispatchPacketProjectionRef(
        intent.targetDeliveryId,
      )}`,
    );
  } catch (error: unknown) {
    if (
      error instanceof PortableResourcePathError ||
      error instanceof TestDispatchProjectionPathError
    ) {
      fail("input");
    }
    throw error;
  }
}

/** 从首次提交的Test Claim Event回执生成唯一瞬时宿主动作。 */
export function createTestDeliveryAgentHostAction(
  absoluteWorkspaceRoot: string,
  intent: Readonly<TestDeliveryIntent>,
  packet: Readonly<TestDispatchPacket>,
  claim: Readonly<WindowWorkClaim>,
  hostObservation: Readonly<WakeflowAgentHostWindowObservationAuthority>,
  claimEvent: Readonly<{
    readonly eventId: WindowWorkClaim["claimTransition"]["eventId"];
    readonly streamRevision: number;
    readonly stateDigest: Sha256Digest;
  }>,
): Readonly<TestDeliveryAgentHostAction> {
  if (
    claim.target.workType !== "test" ||
    claim.target.targetDeliveryId !== intent.targetDeliveryId ||
    claim.target.intentDigest !== intent.intentDigest ||
    claim.target.demandId !== intent.demandId ||
    claim.target.targetTaskId !== intent.target.targetTaskId ||
    claim.target.testAttemptId !== intent.attempt.testAttemptId ||
    claim.target.testDispatchPacketDigest !== packet.packetDigest ||
    packet.targetDeliveryId !== intent.targetDeliveryId ||
    packet.source.intentDigest !== intent.intentDigest ||
    packet.attempt.testAttemptId !== intent.attempt.testAttemptId ||
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
    kind: "WakeflowTestDeliveryAgentHostAction" as const,
    schemaVersion: 1 as const,
    actionId: claim.claimId,
    effect: "send-message-to-observed-target-window" as const,
    hostId: claim.route.hostId,
    windowId: claim.route.windowId,
    bindingId: claim.route.bindingId,
    targetDeliveryId: claim.target.targetDeliveryId,
    intentDigest: claim.target.intentDigest,
    testAttemptId: claim.target.testAttemptId,
    testDispatchPacket: Object.freeze({
      ref: packetRef(intent),
      digest: packet.packetDigest,
    }),
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
    prompt: actionPrompt(absoluteWorkspaceRoot, intent, packet),
    issuedAt: claim.claimedAt,
    claimEvent: Object.freeze({ ...claimEvent }),
  });
}
