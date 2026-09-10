import {
  readWakeflowConfigAuthoritySnapshot,
  type WakeflowConfigAuthoritySnapshot,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { inspectWorkClaim } from "../../kernel/work-claims.js";
import { DemandEventSourcingRepository } from "../../governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import type { LoadedDemandEventSourcingRootAuthority } from "../../governance/demand/event-sourcing/demand-event-sourcing-root-authority.js";
import { managedEvidenceManifestRef } from "../../governance/evidence/managed-evidence-resource-paths.js";
import { inspectLedgerAuthorityLayout } from "../../governance/ledger/ledger-authority-layout.js";
import type { RequirementClaimStateSource } from "../../kernel/requirement-board.js";
import { computeVerifyObservationDigest, type VerifyGateOutcome } from "./decide.js";

/**
 * Wakeflow Capabilities / Demand：完成与取消前内嵌的 verify 门（ADR-0012 D3，能力卡 9 Q4）。
 *
 * 每道门只读；读不到即 `unavailable`，与 `fail` 一样阻塞。报告随归档包保存，
 * 观察摘要进入计划，preview 与 apply 之间任何门的变化都表现为计划漂移。
 */

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
  readonly payloadBlockers: readonly string[];
  readonly signal: AbortSignal | undefined;
}

const MANIFEST_MAXIMUM_BYTES = parseByteCount(4 * 1024 * 1024, "$manifest.maximumBytes");

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
  return state.status === "claimed" && state.claim?.demandId === input.loaded.identity.demandId
    ? gate("board-claim", "pass")
    : gate("board-claim", "fail", state.status);
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

function privacyGate(input: VerifyInput): VerifyGateOutcome {
  return input.payloadBlockers.length === 0
    ? gate("payload-privacy", "pass")
    : gate("payload-privacy", "fail", String(input.payloadBlockers.length));
}

/** 八道门按固定顺序评估；报告确定性，摘要只依赖门的结果。 */
export async function evaluateVerifyGates(input: VerifyInput): Promise<VerifyReport> {
  const gates: VerifyGateOutcome[] = [
    await guarded("config-authority", () => configGate(input)),
    await guarded("ledger-layout", () => ledgerGate(input)),
    await guarded("demand-root-audit", () => auditGate(input)),
    boardGate(input),
    await guarded("work-claims-released", () => workClaimGate(input)),
    appendCandidateGate(input),
    await guarded("evidence-integrity", () => evidenceGate(input)),
    privacyGate(input),
  ];
  return Object.freeze({
    kind: "WakeflowDemandVerifyReport",
    schemaVersion: 1,
    demandId: input.loaded.identity.demandId,
    gates: Object.freeze(gates),
    observationDigest: computeVerifyObservationDigest(gates),
  });
}
