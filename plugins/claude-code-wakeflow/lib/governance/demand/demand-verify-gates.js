import { readWakeflowConfigAuthoritySnapshot, } from "../../configuration/wakeflow-config-authority-snapshot.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { computeSha256Digest } from "../../foundation/crypto/sha256.js";
import { parseJsonValue } from "../../foundation/data/json-value.js";
import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import { parsePortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import { readStableFile, StableFileReadError, } from "../../foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { inspectWorkClaim } from "../../kernel/work-claims.js";
import { ManagedEvidenceManifestError, parseManagedEvidenceManifest, } from "../evidence/managed-evidence-manifest.js";
import { managedEvidenceManifestRef, managedEvidencePayloadRootRef, } from "../evidence/managed-evidence-resource-paths.js";
import { inspectLedgerAuthorityLayout } from "../ledger/ledger-authority-layout.js";
import { readDemandAcceptanceCoverage } from "./demand-acceptance-coverage.js";
import { DemandEventSourcingRepository } from "./event-sourcing/demand-event-sourcing-repository.js";
const MANIFEST_MAXIMUM_BYTES = parseByteCount(4 * 1024 * 1024, "$manifest.maximumBytes");
function computeVerifyObservationDigest(gates) {
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
    if (state.status !== "claimed")
        return gate("board-claim", "fail", state.status);
    return state.claim?.demandId === input.loaded.identity.demandId
        ? gate("board-claim", "pass")
        : gate("board-claim", "fail", "claimed-by-other-demand");
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
/**
 * 复审 G6：每条受管证据的负载字节在完成路径上重新哈希——清单树里每个文件的字节数与 sha256 都要
 * 等于磁盘上的；读不到、超长、摘要不等都算该条证据失败（`<evidenceId>:<ref>`）。上限由证据清单
 * 自己的容量（内核 WAKEFLOW_DEMAND_TREE_CAPACITY）压住，所以可归档的证据必然可重哈希。
 */
async function payloadFileMismatch(input, evidenceId, payloadRoot, file) {
    const ref = parsePortableResourcePath(`${payloadRoot}/${file.ref}`, "$evidence");
    let bytes;
    try {
        bytes = (await readStableFile(input.demandRoot, ref, {
            maximumBytes: parseByteCount(Math.max(file.bytes, 1), "$evidence.maximumBytes"),
            ...signalOptions(input.signal),
        })).bytes;
    }
    catch (error) {
        if (error instanceof StableFileReadError && error.reason !== "aborted") {
            return `${evidenceId}:${file.ref}`;
        }
        throw error;
    }
    const matches = bytes.byteLength === file.bytes && computeSha256Digest(bytes, "$evidence") === file.digest;
    return matches ? null : `${evidenceId}:${file.ref}`;
}
async function evidencePayloadMismatch(input, evidenceId, value) {
    let manifest;
    try {
        manifest = parseManagedEvidenceManifest(value);
    }
    catch (error) {
        if (error instanceof ManagedEvidenceManifestError)
            return `${evidenceId}:manifest`;
        throw error;
    }
    const payloadRoot = managedEvidencePayloadRootRef(evidenceId);
    for (const file of manifest.payload.treeManifest.files) {
        const mismatch = await payloadFileMismatch(input, evidenceId, payloadRoot, file);
        if (mismatch !== null)
            return mismatch;
    }
    return null;
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
        const mismatch = await evidencePayloadMismatch(input, summary.evidenceId, value);
        if (mismatch !== null)
            return gate("evidence-integrity", "fail", mismatch);
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
/**
 * 任务包声明的证据要求（R4）：所有已规划包 `requiredEvidenceKinds` 的并集都要在受管证据里出现；
 * 没有任何包声明时不设此门。包从已规划事件重读（与 coverage 同一做法）。
 */
async function requiredEvidenceGate(input) {
    const repository = new DemandEventSourcingRepository(input.demandRoot);
    const required = new Set();
    for (const target of input.loaded.aggregate.state.targetTasks) {
        const planned = await repository.findTargetTaskPlannedEvent(target.taskPackageId, signalOptions(input.signal));
        for (const kind of planned?.event.data.taskPackage.requiredEvidenceKinds ?? [])
            required.add(kind);
    }
    if (required.size === 0)
        return null;
    const held = new Set((input.loaded.aggregate.state.managedEvidence ?? []).map((summary) => summary.kind));
    const missing = [...required].filter((kind) => !held.has(kind)).sort();
    return missing.length === 0
        ? gate("required-evidence", "pass")
        : gate("required-evidence", "fail", `missing:${missing.join(",")}`);
}
/** 门按固定顺序评估；报告确定性，摘要只依赖门的结果。 */
export async function evaluateVerifyGates(input) {
    const research = researchEvidenceGate(input);
    const requiredEvidence = await guarded("required-evidence", () => requiredEvidenceGate(input));
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
        ...(requiredEvidence === null ? [] : [requiredEvidence]),
        ...(input.loaded.identity.demandType === "research" ||
            input.loaded.aggregate.state.lifecycle !== "active"
            ? []
            : [
                await guarded("requirement-coverage", async () => {
                    const coverage = await readDemandAcceptanceCoverage(input.demandRoot, input.ledgerRoot, input.loaded, input.signal);
                    if (coverage.total === 0)
                        return gate("requirement-coverage", "fail", "acceptance-criteria-empty");
                    if (coverage.uncovered.length === 0)
                        return gate("requirement-coverage", "pass");
                    const shown = coverage.uncovered.slice(0, 20).join(",");
                    return gate("requirement-coverage", "fail", `uncovered:${coverage.uncovered.length}:${shown}`);
                }),
            ]),
    ];
    return Object.freeze({
        kind: "WakeflowDemandVerifyReport",
        schemaVersion: 1,
        demandId: input.loaded.identity.demandId,
        gates: Object.freeze(gates),
        observationDigest: computeVerifyObservationDigest(gates),
    });
}
