import { readWakeflowConfigAuthoritySnapshot, } from "../../configuration/wakeflow-config-authority-snapshot.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parseJsonValue } from "../../foundation/data/json-value.js";
import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { inspectWorkClaim } from "../../kernel/work-claims.js";
import { managedEvidenceManifestRef } from "../evidence/managed-evidence-resource-paths.js";
import { inspectLedgerAuthorityLayout } from "../ledger/ledger-authority-layout.js";
import { DemandEventSourcingRepository } from "./event-sourcing/demand-event-sourcing-repository.js";
const MANIFEST_MAXIMUM_BYTES = parseByteCount(4 * 1024 * 1024, "$manifest.maximumBytes");
export function computeVerifyObservationDigest(gates) {
    return computeCanonicalJsonSha256Digest(parseJsonValue({ gates }, "$verify"));
}
/** 本 Demand 曾派工的全部窗口，去重排序；工作声明按窗口检查与释放。 */
export function demandWindowIds(state) {
    return Object.freeze([...new Set(state.targetTasks.map((target) => target.windowId))].sort());
}
function gate(name, status, detail = null) {
    return Object.freeze({ gate: name, status, detail });
}
async function guarded(name, probe) {
    try {
        return await probe();
    }
    catch (error) {
        const reason = typeof error === "object" &&
            error !== null &&
            "reason" in error &&
            typeof error.reason === "string"
            ? error.reason
            : "error";
        // 中止不是门的失败：照常上抛，剩下的门也不再白跑。
        if (reason === "aborted")
            throw error;
        return gate(name, "unavailable", reason);
    }
}
function signalOptions(signal) {
    return signal === undefined ? {} : { signal };
}
async function configGate(input) {
    const current = await readWakeflowConfigAuthoritySnapshot(input.workspaceRoot, signalOptions(input.signal));
    return current.configDigest === input.snapshot.configDigest
        ? gate("config-authority", "pass")
        : gate("config-authority", "fail", "config-changed");
}
async function ledgerGate(input) {
    const inspection = await inspectLedgerAuthorityLayout(input.ledgerRoot, input.signal);
    return inspection.status === "current"
        ? gate("ledger-layout", "pass")
        : gate("ledger-layout", "fail", inspection.status);
}
async function auditGate(input) {
    const audited = await new DemandEventSourcingRepository(input.demandRoot).audit(signalOptions(input.signal));
    return audited.aggregate.stateDigest === input.loaded.aggregate.stateDigest
        ? gate("demand-root-audit", "pass")
        : gate("demand-root-audit", "fail", "state-digest-drift");
}
function boardGate(input) {
    const state = input.claim?.state;
    if (state === undefined)
        return gate("board-claim", "fail", "package-unknown");
    return state.status === "claimed" && state.claim?.demandId === input.loaded.identity.demandId
        ? gate("board-claim", "pass")
        : gate("board-claim", "fail", state.status);
}
async function workClaimGate(input) {
    const held = [];
    for (const windowId of input.windowIds) {
        const result = await inspectWorkClaim(input.workspaceRoot, windowId, signalOptions(input.signal));
        if (result.status !== "absent")
            held.push(windowId);
    }
    return held.length === 0
        ? gate("work-claims-released", "pass")
        : gate("work-claims-released", "fail", held.join(","));
}
function appendCandidateGate(input) {
    return input.loaded.inventory.appendCandidateCount === 0
        ? gate("append-candidates-clear", "pass")
        : gate("append-candidates-clear", "fail", String(input.loaded.inventory.appendCandidateCount));
}
async function evidenceGate(input) {
    for (const summary of input.loaded.aggregate.state.managedEvidence ?? []) {
        const read = await readDeterministicJsonFile(input.demandRoot, managedEvidenceManifestRef(summary.evidenceId), { maximumBytes: MANIFEST_MAXIMUM_BYTES, ...signalOptions(input.signal) });
        const value = read.value;
        const evidenceId = value !== null && typeof value === "object" && !Array.isArray(value)
            ? value.evidenceId
            : undefined;
        if (evidenceId !== summary.evidenceId) {
            return gate("evidence-integrity", "fail", summary.evidenceId);
        }
    }
    return gate("evidence-integrity", "pass");
}
function privacyGate(payloadBlockers) {
    return payloadBlockers.length === 0
        ? gate("payload-privacy", "pass")
        : gate("payload-privacy", "fail", String(payloadBlockers.length));
}
/** research Demand 的完成物：至少一条 document 类受管证据（§13.94 D8）；其他类型不设此门。 */
function researchEvidenceGate(input) {
    if (input.loaded.identity.demandType !== "research")
        return null;
    const documents = (input.loaded.aggregate.state.managedEvidence ?? []).filter((summary) => summary.kind === "document");
    return documents.length > 0
        ? gate("research-evidence", "pass")
        : gate("research-evidence", "fail", "document-evidence-missing");
}
/** 门按固定顺序评估；报告确定性，摘要只依赖门的结果。 */
export async function evaluateVerifyGates(input) {
    const research = researchEvidenceGate(input);
    const gates = [
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
