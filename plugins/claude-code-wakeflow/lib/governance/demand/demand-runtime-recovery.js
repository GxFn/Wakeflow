import { readWakeflowConfigAuthoritySnapshot } from "../../configuration/wakeflow-config-authority-snapshot.js";
import { parseWakeflowDurableIdOfKind } from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parseJsonValue } from "../../foundation/data/json-value.js";
import { materializeDirectoryPath } from "../../foundation/filesystem/durable-directory-materialization.js";
import { inspectRootedExclusiveFileLock, retireRootedExclusiveFileLockResidue, withRootedExclusiveFileLock } from "../../foundation/filesystem/rooted-exclusive-file-lock.js";
import { readStableResourceDirectory } from "../../foundation/filesystem/stable-directory-read.js";
import { readStrictTextFile } from "../../foundation/filesystem/strict-text-file.js";
import { parsePortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import { fail } from "../../kernel/error.js";
import { WAKEFLOW_ACTIVE_CURRENT_ROOT_REF } from "../../kernel/layout.js";
import { openDemandOperationRoot } from "./demand-operation-authority-context.js";
import { DemandFileEventStore } from "./event-sourcing/demand-file-event-store.js";
import { DEMAND_IDENTITY_MAXIMUM_BYTES } from "./event-sourcing/demand-event-sourcing-root-authority.js";
import { parseDemandIdentityDocument } from "./model/demand-identity.js";
import { DEMAND_PUBLICATION_LOCKS_ROOT_REF, demandPublicationLockRef } from "./publication/demand-publication-paths.js";
const DEMAND_NAME = /^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const IDENTITY_REF = parsePortableResourcePath("identity.json");
/** 节点期望是私有 CAS 输入，只发布其摘要；不把 PID、候选文件名或机器路径发到模型。 */
function nodeValue(node) {
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [
        key, typeof value === "bigint" ? String(value) : value,
    ]));
}
export async function inspectDemandRuntimeRecovery(workspaceRoot, options = {}) {
    const config = await readWakeflowConfigAuthoritySnapshot(workspaceRoot, options);
    const listing = await readStableResourceDirectory(workspaceRoot, WAKEFLOW_ACTIVE_CURRENT_ROOT_REF, {
        maximumEntries: 4096, ...options,
    });
    const demands = [];
    const blockers = [];
    for (const entry of listing.entries) {
        if (!DEMAND_NAME.test(entry.name))
            continue;
        const demandId = parseWakeflowDurableIdOfKind(entry.name, "demand");
        const root = await openDemandOperationRoot(workspaceRoot, demandId);
        try {
            const candidates = await new DemandFileEventStore(root).inspectAppendCandidates(options);
            if (candidates.length === 0)
                continue;
            const identity = await readStrictTextFile(root, IDENTITY_REF, { maximumBytes: DEMAND_IDENTITY_MAXIMUM_BYTES, ...options });
            const parsed = parseDemandIdentityDocument(identity.text);
            if (parsed.demandId !== demandId || parsed.programId !== config.model.program.programId) {
                fail("precondition-failed", "recovery-demand-identity", "$demandRoot");
            }
            if (candidates.some((candidate) => candidate.ownerState !== "inactive")) {
                blockers.push(`demand-candidates-busy:${demandId}`);
            }
            const digest = computeCanonicalJsonSha256Digest(parseJsonValue({
                configDigest: config.configDigest,
                identityDigest: identity.digest,
                root: nodeValue(await root.assertCurrent()),
                candidates: candidates.map(({ entry: candidate, ownerState }) => ({
                    ref: candidate.resourcePath, node: nodeValue(candidate.node), ownerState,
                })),
            }));
            demands.push(Object.freeze({ demandId, candidateCount: candidates.length, digest }));
        }
        finally {
            await root.close();
        }
    }
    return Object.freeze({
        demands: Object.freeze(demands), blockers: Object.freeze(blockers),
        digest: computeCanonicalJsonSha256Digest(parseJsonValue({ demands, blockers })),
    });
}
export async function applyDemandRuntimeRecovery(workspaceRoot, expected, options = {}) {
    const current = await inspectDemandRuntimeRecovery(workspaceRoot, options);
    if (current.digest !== expected.digest || current.blockers.length > 0) {
        fail("precondition-failed", "recovery-plan-drift", "$planDigest");
    }
    await materializeDirectoryPath(workspaceRoot, DEMAND_PUBLICATION_LOCKS_ROOT_REF, { mode: 0o700, ...options });
    const recovered = [];
    for (const demand of expected.demands) {
        const demandId = parseWakeflowDurableIdOfKind(demand.demandId, "demand");
        const lockRef = demandPublicationLockRef(demandId);
        const lock = await inspectRootedExclusiveFileLock(workspaceRoot, lockRef);
        if (lock.status === "held" && lock.ownerState === "inactive") {
            await retireRootedExclusiveFileLockResidue(workspaceRoot, lockRef, lock);
        }
        await withRootedExclusiveFileLock(workspaceRoot, lockRef, async () => {
            const fresh = await inspectDemandRuntimeRecovery(workspaceRoot, options);
            const observed = fresh.demands.find((candidate) => candidate.demandId === demandId);
            if (observed === undefined)
                return; // 其他恢复者已完成，按幂等结算。
            if (observed.digest !== demand.digest)
                fail("precondition-failed", "recovery-plan-drift", "$planDigest");
            const root = await openDemandOperationRoot(workspaceRoot, demandId);
            try {
                const receipt = await new DemandFileEventStore(root).recoverAppendCandidates(options);
                recovered.push(Object.freeze({ demandId, retiredCount: receipt.retiredCount }));
            }
            finally {
                await root.close();
            }
        }, options);
    }
    return Object.freeze(recovered);
}
