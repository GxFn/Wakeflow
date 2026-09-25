import {
  readWakeflowConfigAuthoritySnapshot,
  type WakeflowConfigAuthoritySnapshot,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { parseJsonValue } from "../../foundation/data/json-value.js";
import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import type { RequirementClaimStateSource } from "../../kernel/requirement-board.js";
import { inspectWorkClaim } from "../../kernel/work-claims.js";
import { managedEvidenceManifestRef } from "../evidence/managed-evidence-resource-paths.js";
import { inspectLedgerAuthorityLayout } from "../ledger/ledger-authority-layout.js";
import { DemandEventSourcingRepository } from "./event-sourcing/demand-event-sourcing-repository.js";
import type { LoadedDemandEventSourcingRootAuthority } from "./event-sourcing/demand-event-sourcing-root-authority.js";
import type { DemandAggregateState } from "./model/demand-aggregate-state.js";

/**
 * Wakeflow Governance / Demand：一个 Demand 的 verify 门（ADR-0012 D3，能力卡 9 Q4）。
 *
 * 完成与取消的 preview 内嵌这些门，`wakeflow_verify{demandId}` 复用同一份（§13.94 D3）。
 * 每道门只读；读不到即 `unavailable`，与 `fail` 一样阻塞。`payloadBlockers` 为 null 时
 * 不评估 payload-privacy 门（只有完成路径扫描负载正文）。报告确定性，摘要只依赖门的结果。
 */

export interface VerifyGateOutcome {
  readonly gate: string;
  readonly status: "pass" | "fail" | "unavailable";
  readonly detail: string | null;
}

export interface VerifyReport {
  readonly kind: "WakeflowDemandVerifyReport";
  readonly schemaVersion: 1;
  readonly demandId: string;
  readonly gates: readonly VerifyGateOutcome[];
  readonly observationDigest: string;
}

export interface VerifyInput {
  readonly workspaceRoot: RootedDirectory;
  readonly ledgerRoot: RootedDirectory;
  readonly snapshot: Readonly<WakeflowConfigAuthoritySnapshot>;
  readonly demandRoot: RootedDirectory;
  readonly loaded: Readonly<LoadedDemandEventSourcingRootAuthority>;
  readonly claim: RequirementClaimStateSource | null;
  readonly windowIds: readonly string[];
  /** 负载隐私扫描的阻塞项；null 表示本次不扫描负载，不设 payload-privacy 门。 */
  readonly payloadBlockers: readonly string[] | null;
  readonly signal: AbortSignal | undefined;
}

const MANIFEST_MAXIMUM_BYTES = parseByteCount(4 * 1024 * 1024, "$manifest.maximumBytes");

export function computeVerifyObservationDigest(gates: readonly VerifyGateOutcome[]): Sha256Digest {
  return computeCanonicalJsonSha256Digest(parseJsonValue({ gates }, "$verify"));
}

/** 本 Demand 曾派工的全部窗口，去重排序；工作声明按窗口检查与释放。 */
export function demandWindowIds(state: Readonly<DemandAggregateState>): readonly string[] {
  return Object.freeze([...new Set(state.targetTasks.map((target) => target.windowId))].sort());
}

function gate(name: string, status: VerifyGateOutcome["status"], detail: string | null = null) {
  return Object.freeze({ gate: name, status, detail });
}

async function guarded(
  name: string,
  probe: () => Promise<VerifyGateOutcome>,
): Promise<VerifyGateOutcome> {
  try {
    return await probe();
  } catch (error: unknown) {
    const reason =
      typeof error === "object" &&
      error !== null &&
      "reason" in error &&
      typeof error.reason === "string"
        ? error.reason
        : "error";
    // 中止不是门的失败：照常上抛，剩下的门也不再白跑。
    if (reason === "aborted") throw error;
    return gate(name, "unavailable", reason);
  }
}

function signalOptions(signal: AbortSignal | undefined): { readonly signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

async function configGate(input: VerifyInput): Promise<VerifyGateOutcome> {
  const current = await readWakeflowConfigAuthoritySnapshot(
    input.workspaceRoot,
    signalOptions(input.signal),
  );
  return current.configDigest === input.snapshot.configDigest
    ? gate("config-authority", "pass")
    : gate("config-authority", "fail", "config-changed");
}

async function ledgerGate(input: VerifyInput): Promise<VerifyGateOutcome> {
  const inspection = await inspectLedgerAuthorityLayout(input.ledgerRoot, input.signal);
  return inspection.status === "current"
    ? gate("ledger-layout", "pass")
    : gate("ledger-layout", "fail", inspection.status);
}

async function auditGate(input: VerifyInput): Promise<VerifyGateOutcome> {
  const audited = await new DemandEventSourcingRepository(input.demandRoot).audit(
    signalOptions(input.signal),
  );
  return audited.aggregate.stateDigest === input.loaded.aggregate.stateDigest
    ? gate("demand-root-audit", "pass")
    : gate("demand-root-audit", "fail", "state-digest-drift");
}

function boardGate(input: VerifyInput): VerifyGateOutcome {
  const state = input.claim?.state;
  if (state === undefined) return gate("board-claim", "fail", "package-unknown");
  if (state.status !== "claimed") return gate("board-claim", "fail", state.status);
  return state.claim?.demandId === input.loaded.identity.demandId
    ? gate("board-claim", "pass")
    : gate("board-claim", "fail", "claimed-by-other-demand");
}

async function workClaimGate(input: VerifyInput): Promise<VerifyGateOutcome> {
  const held: string[] = [];
  for (const windowId of input.windowIds) {
    const result = await inspectWorkClaim(
      input.workspaceRoot,
      windowId,
      signalOptions(input.signal),
    );
    if (result.status !== "absent") held.push(windowId);
  }
  return held.length === 0
    ? gate("work-claims-released", "pass")
    : gate("work-claims-released", "fail", held.join(","));
}

function appendCandidateGate(input: VerifyInput): VerifyGateOutcome {
  return input.loaded.inventory.appendCandidateCount === 0
    ? gate("append-candidates-clear", "pass")
    : gate("append-candidates-clear", "fail", String(input.loaded.inventory.appendCandidateCount));
}

async function evidenceGate(input: VerifyInput): Promise<VerifyGateOutcome> {
  for (const summary of input.loaded.aggregate.state.managedEvidence ?? []) {
    const read = await readDeterministicJsonFile(
      input.demandRoot,
      managedEvidenceManifestRef(summary.evidenceId),
      { maximumBytes: MANIFEST_MAXIMUM_BYTES, ...signalOptions(input.signal) },
    );
    const value = read.value;
    const evidenceId =
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>).evidenceId
        : undefined;
    if (evidenceId !== summary.evidenceId) {
      return gate("evidence-integrity", "fail", summary.evidenceId);
    }
  }
  return gate("evidence-integrity", "pass");
}

function privacyGate(payloadBlockers: readonly string[]): VerifyGateOutcome {
  return payloadBlockers.length === 0
    ? gate("payload-privacy", "pass")
    : gate("payload-privacy", "fail", String(payloadBlockers.length));
}

/** research Demand 的完成物：至少一条 document 类受管证据（§13.94 D8）；其他类型不设此门。 */
function researchEvidenceGate(input: VerifyInput): VerifyGateOutcome | null {
  if (input.loaded.identity.demandType !== "research") return null;
  const documents = (input.loaded.aggregate.state.managedEvidence ?? []).filter(
    (summary) => summary.kind === "document",
  );
  return documents.length > 0
    ? gate("research-evidence", "pass")
    : gate("research-evidence", "fail", "document-evidence-missing");
}

/** 门按固定顺序评估；报告确定性，摘要只依赖门的结果。 */
export async function evaluateVerifyGates(input: VerifyInput): Promise<VerifyReport> {
  const research = researchEvidenceGate(input);
  const gates: VerifyGateOutcome[] = [
    await guarded("config-authority", () => configGate(input)),
    await guarded("ledger-layout", () => ledgerGate(input)),
    await guarded("demand-root-audit", () => auditGate(input)),
    boardGate(input),
    await guarded("work-claims-released", () => workClaimGate(input)),
    appendCandidateGate(input),
    await guarded("evidence-integrity", () => evidenceGate(input)),
    ...(input.payloadBlockers === null ? [] : [privacyGate(input.payloadBlockers)]),
    ...(research === null ? [] : [research]),
  ];
  return Object.freeze({
    kind: "WakeflowDemandVerifyReport",
    schemaVersion: 1,
    demandId: input.loaded.identity.demandId,
    gates: Object.freeze(gates),
    observationDigest: computeVerifyObservationDigest(gates),
  });
}
