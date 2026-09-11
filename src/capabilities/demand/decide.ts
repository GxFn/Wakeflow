import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { parseJsonValue } from "../../foundation/data/json-value.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import type { DemandAggregateState } from "../../governance/demand/model/demand-aggregate-state.js";
import { deriveDurableId } from "../../kernel/ids.js";
import { DEFAULT_ALLOWED_ID_PREFIXES, scanPrivacy } from "../../kernel/privacy-scan.js";
import type { RequirementClaimState } from "../../kernel/requirement-board.js";

/**
 * Wakeflow Capabilities / Demand：纯决定。
 *
 * 标识派生、归档负载筛选、阻塞项派生都不读文件、不看时钟；效果由 service 执行。
 */

export interface DemandCreationIds {
  readonly demandId: string;
  readonly eventId: string;
  readonly commitId: string;
}

/** 认领即创建：同一需求包与同一认领状态派生同一个 Demand 身份，重试不会造出第二个。 */
export function deriveDemandCreationIds(
  requirementId: string,
  claimStateDigest: string,
): DemandCreationIds {
  const demandId = deriveDurableId("demand", "requirement-claim", requirementId, claimStateDigest);
  return Object.freeze({
    demandId,
    eventId: deriveDurableId("demand-event", "demand-publication", demandId),
    commitId: deriveDurableId("demand-event-commit", "demand-publication", demandId),
  });
}

export type LifecycleAction = "complete" | "cancel" | "continue" | "record-decision";

export interface LifecycleIds {
  readonly eventId: string;
  readonly commitId: string;
}

/** 生命周期事件的标识由 Demand、动作与期望修订号派生：同一前置状态上的重试命中同一提交。 */
export function deriveLifecycleIds(
  demandId: string,
  action: LifecycleAction,
  expectedStreamRevision: number,
): LifecycleIds {
  const revision = String(expectedStreamRevision);
  return Object.freeze({
    eventId: deriveDurableId("demand-event", `lifecycle-${action}`, demandId, revision),
    commitId: deriveDurableId("demand-event-commit", `lifecycle-${action}`, demandId, revision),
  });
}

/** Demand 根内可重建的检查点与未成为事实的候选，不进归档负载。 */
const ARCHIVE_EXCLUDED_PREFIXES: readonly string[] = Object.freeze([
  "event-sourcing/snapshots",
  "event-sourcing/index",
  "event-sourcing/append-candidates",
]);

export function isArchivePayloadPath(path: string): boolean {
  return !ARCHIVE_EXCLUDED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export interface PayloadFileDigest {
  readonly resourcePath: PortableResourcePath;
  readonly byteCount: number;
  readonly digest: Sha256Digest;
}

/** 负载树摘要：路径与内容摘要的规范 JSON；与文件权限位、时间无关。 */
export function computePayloadTreeDigest(files: readonly PayloadFileDigest[]): Sha256Digest {
  return computeCanonicalJsonSha256Digest(
    parseJsonValue(
      [...files]
        .sort((left, right) =>
          left.resourcePath < right.resourcePath
            ? -1
            : left.resourcePath > right.resourcePath
              ? 1
              : 0,
        )
        .map((file) => ({ path: file.resourcePath, bytes: file.byteCount, digest: file.digest })),
      "$payload",
    ),
  );
}

const CREDENTIAL_KINDS: readonly string[] = Object.freeze([
  "private-key",
  "provider-credential",
  "credential-assignment",
]);
const PRIVACY_POLICY = Object.freeze({
  allowedPathRoots: Object.freeze([]),
  allowedIdPrefixes: DEFAULT_ALLOWED_ID_PREFIXES,
});
const PAYLOAD_PRIVACY_BLOCKER_MAXIMUM = 16;

/** 归档进 tracked 的 Ledger，只拒绝凭证类命中（能力卡 8）；路径与标识由归档负载自带。 */
export function payloadPrivacyBlockers(
  files: readonly Readonly<{ readonly resourcePath: string; readonly text: string }>[],
): readonly string[] {
  const blockers: string[] = [];
  for (const file of files) {
    for (const finding of scanPrivacy(file.text, PRIVACY_POLICY)) {
      if (!CREDENTIAL_KINDS.includes(finding.kind)) continue;
      blockers.push(`payload-privacy:${file.resourcePath}:${finding.line}:${finding.kind}`);
      if (blockers.length >= PAYLOAD_PRIVACY_BLOCKER_MAXIMUM) return Object.freeze(blockers);
    }
  }
  return Object.freeze(blockers);
}

/** 等待 Controller 评审的结果：取消必须先把它们评掉（F5.5）。 */
export function pendingReviewTargets(state: Readonly<DemandAggregateState>): readonly string[] {
  return Object.freeze(
    state.targetTasks
      .filter(
        (target) => target.phase === "result-reported" || target.phase === "test-result-reported",
      )
      .map((target) => target.targetTaskId),
  );
}

/** 本 Demand 曾派工的全部窗口，去重排序；工作声明按窗口检查与释放。 */
export function demandWindowIds(state: Readonly<DemandAggregateState>): readonly string[] {
  return Object.freeze([...new Set(state.targetTasks.map((target) => target.windowId))].sort());
}

export interface VerifyGateOutcome {
  readonly gate: string;
  readonly status: "pass" | "fail" | "unavailable";
  readonly detail: string | null;
}

export function computeVerifyObservationDigest(gates: readonly VerifyGateOutcome[]): Sha256Digest {
  return computeCanonicalJsonSha256Digest(parseJsonValue({ gates }, "$verify"));
}

export interface TerminalBlockerInput {
  readonly action: "complete" | "cancel";
  readonly lifecycle: DemandAggregateState["lifecycle"];
  readonly awaitingDecision: boolean;
  /** complete 要求 post-acceptance 阶段为 completion-preflight；cancel 不看阶段。 */
  readonly postAcceptanceStage: string;
  readonly demandId: string;
  readonly claim: Readonly<RequirementClaimState> | null;
  readonly pendingReviews: readonly string[];
  readonly gates: readonly VerifyGateOutcome[];
  readonly payloadBlockers: readonly string[];
  /** 归档目标已存在且负载摘要不同。 */
  readonly archiveConflict: boolean;
}

const BLOCKERS_MAXIMUM = 64;

function lifecycleBlockers(input: Readonly<TerminalBlockerInput>): readonly string[] {
  const blockers: string[] = [];
  if (input.lifecycle !== "active") blockers.push(`lifecycle:${input.lifecycle}`);
  if (input.action === "complete") {
    if (input.awaitingDecision) blockers.push("awaiting-decision");
    if (input.postAcceptanceStage !== "completion-preflight") {
      blockers.push(`route:${input.postAcceptanceStage}`);
    }
  } else {
    for (const targetTaskId of input.pendingReviews)
      blockers.push(`pending-review:${targetTaskId}`);
  }
  return blockers;
}

function packageBlockers(input: Readonly<TerminalBlockerInput>): readonly string[] {
  if (input.claim === null) return ["package-unknown"];
  if (input.claim.status !== "claimed" || input.claim.claim?.demandId !== input.demandId) {
    return [`package-claim:${input.claim.status}`];
  }
  return [];
}

function gateBlockers(input: Readonly<TerminalBlockerInput>): readonly string[] {
  const blockers: string[] = [];
  for (const gate of input.gates) {
    if (gate.status === "pass") continue;
    // 取消自己释放窗口工作声明；该门只在完成时阻塞。
    if (input.action === "cancel" && gate.gate === "work-claims-released") continue;
    blockers.push(`verify:${gate.gate}:${gate.status}`);
  }
  return blockers;
}

/** 完成与取消的阻塞项；空即 ready。verify 门失败逐条列出，`unavailable` 也阻塞。 */
export function deriveTerminalBlockers(input: Readonly<TerminalBlockerInput>): readonly string[] {
  const blockers = [
    ...lifecycleBlockers(input),
    ...packageBlockers(input),
    ...gateBlockers(input),
    ...input.payloadBlockers,
    ...(input.archiveConflict ? ["archive-conflict"] : []),
  ];
  return Object.freeze([...new Set(blockers)].slice(0, BLOCKERS_MAXIMUM));
}

export interface ContinueBlockerInput {
  readonly rootPresent: boolean;
  readonly archiveOutcome: "completed" | "cancelled" | null;
  readonly demandId: string;
  readonly claim: Readonly<RequirementClaimState> | null;
  /** 该 Demand 所在 pod 上另一个活动 Demand 的标识；没有即 null。 */
  readonly otherActiveDemandId: string | null;
}

/** continue 只对已归档的完成 Demand 开放，且需求包仍由它归档、所在 pod 没有别的活动 Demand。 */
export function deriveContinueBlockers(input: Readonly<ContinueBlockerInput>): readonly string[] {
  const blockers: string[] = [];
  if (input.rootPresent) blockers.push("demand-root-present");
  if (input.archiveOutcome === null) blockers.push("archive-absent");
  else if (input.archiveOutcome !== "completed")
    blockers.push(`archive-outcome:${input.archiveOutcome}`);
  if (input.claim === null) blockers.push("package-unknown");
  else if (input.claim.status !== "archived" || input.claim.archive?.demandId !== input.demandId) {
    blockers.push(`package-claim:${input.claim.status}`);
  }
  if (input.otherActiveDemandId !== null) blockers.push(`pod-busy:${input.otherActiveDemandId}`);
  return Object.freeze(blockers);
}

export interface DecisionBlockerInput {
  readonly rootPresent: boolean;
  readonly lifecycle: DemandAggregateState["lifecycle"] | null;
  readonly awaitingDecision: boolean;
}

export function deriveDecisionBlockers(input: Readonly<DecisionBlockerInput>): readonly string[] {
  const blockers: string[] = [];
  if (!input.rootPresent) blockers.push("demand-root-absent");
  if (input.lifecycle !== null && input.lifecycle !== "active")
    blockers.push(`lifecycle:${input.lifecycle}`);
  if (input.rootPresent && !input.awaitingDecision) blockers.push("no-escalation-pending");
  return Object.freeze(blockers);
}

export interface CreationBlockerInput {
  readonly claim: Readonly<RequirementClaimState> | null;
  readonly programMatches: boolean;
  readonly recordMatches: boolean;
  /** 目标 pod：配置里不存在为 null；存在时带 lifecycle 与它当前的活动 Demand。 */
  readonly pod: Readonly<{
    readonly podId: string;
    readonly lifecycle: "open" | "closing";
    readonly activeDemandId: string | null;
  }> | null;
  readonly requestedPodId: string;
}

/**
 * 认领前置：包 pending、记录属于本程序且与看板绑定同一记录、目标 pod 存在且未在关闭、
 * 该 pod 没有别的活动 Demand（ADR-0010 D3：一 pod 一 Demand）。
 */
export function deriveCreationBlockers(input: Readonly<CreationBlockerInput>): readonly string[] {
  const blockers: string[] = [];
  if (input.claim === null) blockers.push("package-unknown");
  else if (input.claim.status !== "pending") blockers.push(`package-claim:${input.claim.status}`);
  if (input.claim !== null && !input.programMatches) blockers.push("package-program");
  if (input.claim !== null && !input.recordMatches) blockers.push("package-record-drift");
  if (input.pod === null) blockers.push(`pod-unknown:${input.requestedPodId}`);
  else {
    if (input.pod.lifecycle !== "open") blockers.push(`pod-closing:${input.pod.podId}`);
    if (input.pod.activeDemandId !== null) blockers.push(`pod-busy:${input.pod.activeDemandId}`);
  }
  return Object.freeze(blockers);
}
