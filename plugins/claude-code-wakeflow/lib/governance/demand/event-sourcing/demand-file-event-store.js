import { types } from "node:util";
import { threadId } from "node:worker_threads";
import { createFileCandidateDurably, DurableFileCandidateError, } from "../../../foundation/filesystem/durable-file-candidate.js";
import { materializeDirectoryPath, DurableDirectoryMaterializationError, } from "../../../foundation/filesystem/durable-directory-materialization.js";
import { linkRegularFileWithoutReplacement, DurableRegularFileLinkError, } from "../../../foundation/filesystem/durable-regular-file-link.js";
import { settleRegularFileDurability, DurableRegularFileSettlementError, } from "../../../foundation/filesystem/durable-regular-file-settlement.js";
import { unlinkRegularFileExactly, ExactRegularFileUnlinkError, } from "../../../foundation/filesystem/exact-regular-file-unlink.js";
import { sameFileNodeIdentity, } from "../../../foundation/filesystem/file-node-snapshot.js";
import { RootedDirectory } from "../../../foundation/filesystem/rooted-directory.js";
import { createUuidV4 } from "../../../foundation/identity/uuid-v4.js";
import { readNodeSystemErrorCode } from "../../../foundation/node/node-system-error.js";
import { admitWakeflowResourceOperation, WakeflowResourceProcessingContractError, } from "../../../foundation/resource/resource-processing-contract.js";
import { encodeUtf8 } from "../../../foundation/text/utf8.js";
import { createDemandEventStreamCommitResourceDeclaration } from "../demand-resource-catalog.js";
import { advanceStreamIndex, buildStreamIndex, publishStreamIndex, readLatestStreamIndex, retireStreamIndexAt, retireStreamIndexesBefore, } from "../../../kernel/event-stream/stream-index.js";
import { isWakeflowError } from "../../../kernel/error.js";
import { computeDemandEventSourcingStoredEventDigest } from "./demand-event-sourcing-stored-event.js";
import { computeDemandEventStreamCommitDigest, assertPreparedDemandEventStreamCommit, parseDemandEventStreamCommit, renderDemandEventStreamCommit, DemandEventStreamCommitError, } from "./demand-event-stream-commit.js";
import { demandEventAppendCandidateRef, demandEventStreamCommitRef, parseDemandEventAppendCandidateFileName, DemandEventSourcingPathError, DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF, DEMAND_EVENT_SOURCING_ROOT_REF, DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF, DEMAND_EVENT_STREAM_COMMITS_ROOT_REF, DEMAND_EVENT_STREAM_INDEX_ROOT_REF, } from "./demand-event-sourcing-paths.js";
import { DEMAND_FILE_EVENT_STORE_DIRECTORY_MODE, DEMAND_FILE_EVENT_STORE_FILE_MODE, DemandFileEventStoreError, assertDemandFileEventStoreDirectory, assertDemandFileEventStoreFile, failDemandFileEventStore as fail, parseDemandFileEventStoreOptions, sameDemandEventStreamCommit, } from "./demand-file-event-store-contract.js";
import { assertDemandFileEventAppendAdmissionAgainstPrefix, readAllDemandFileEventCommits, readDemandFileEventCommit, readDemandFileEventCommitAt, readDemandFileEventCommitOrNull, readDemandFileEventCommitsAfter, readDemandFileEventDirectory, } from "./demand-file-event-store-reader.js";
import { DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMIT_BYTES, DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS, DEMAND_FILE_EVENT_STORE_MAXIMUM_TOTAL_BYTES, } from "./demand-file-event-store-contract.js";
/** 索引保留的最新检查点数量；更早的索引文件在刷新后退休，每隔一段做一次清扫兜底。 */
const STREAM_INDEX_RETENTION = 2;
const STREAM_INDEX_SWEEP_INTERVAL = 16;
function indexableCommit(commit) {
    return Object.freeze({
        commitId: commit.commitId,
        commitSequence: commit.commitSequence,
        expectedStreamRevision: commit.expectedStreamRevision,
        lastStreamRevision: commit.lastStreamRevision,
        previousCommitDigest: commit.previousCommitDigest,
        digest: computeDemandEventStreamCommitDigest(commit),
        byteLength: encodeUtf8(renderDemandEventStreamCommit(commit)).byteLength,
        events: commit.events.map((event) => Object.freeze({
            eventId: event.eventId,
            streamRevision: event.streamRevision,
            eventType: event.eventType,
        })),
        ...(commit.idempotency === undefined
            ? {}
            : { idempotencyKey: commit.idempotency.key }),
    });
}
/**
 * Wakeflow Governance / Demand Event Sourcing：受根作用域约束的本地文件事件存储。
 *
 * 本类只持有一个 Demand 根目录，并协调初始化、候选资源到不替换目标提交，以及候选
 * 资源恢复。提交清单、读取逻辑和公共合同由相邻模块负责；事件存储不执行领域决策或
 * 状态演进，不解析 Ledger/看板引用，也不发布 Demand 根目录。同一进程内对同一
 * canonical Demand root 的append短事务串行；跨进程/线程竞争仍由exclusive link与
 * candidate owner/recovery合同处理。
 */
const ACTIVE_APPEND_CANDIDATE_TOKENS = new Set();
/** 同一进程内按canonical Demand root串行append；不保存业务权威。 */
class DemandFileEventStoreMutationQueue {
    #tails = new Map();
    async run(key, operation) {
        const predecessor = this.#tails.get(key) ?? Promise.resolve();
        let release;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        const tail = predecessor.catch(() => undefined).then(() => gate);
        this.#tails.set(key, tail);
        await predecessor.catch(() => undefined);
        try {
            return await operation();
        }
        finally {
            release?.();
            if (this.#tails.get(key) === tail)
                this.#tails.delete(key);
        }
    }
}
const APPEND_MUTATION_QUEUE = new DemandFileEventStoreMutationQueue();
function admitCommitPublication(commit) {
    const declaration = createDemandEventStreamCommitResourceDeclaration(commit.demandId, commit.commitSequence);
    try {
        admitWakeflowResourceOperation(declaration.processing, "exclusive-create");
    }
    catch (error) {
        if (error instanceof WakeflowResourceProcessingContractError) {
            fail("operation-failure", "$catalog");
        }
        throw error;
    }
}
function candidateOwnerState(address) {
    if (address.pid === process.pid) {
        if (address.threadId !== threadId)
            return "unknown";
        return ACTIVE_APPEND_CANDIDATE_TOKENS.has(address.token)
            ? "active"
            : "inactive";
    }
    try {
        process.kill(address.pid, 0);
        return "active";
    }
    catch (error) {
        return readNodeSystemErrorCode(error) === "ESRCH" ? "inactive" : "unknown";
    }
}
/** 持有一个 Demand root 的 Event Store I/O 作用域。 */
export class DemandFileEventStore {
    #root;
    constructor(root) {
        if (typeof root !== "object" ||
            root === null ||
            types.isProxy(root) ||
            !(root instanceof RootedDirectory)) {
            fail("input", "$root");
        }
        this.#root = root;
    }
    /** 幂等创建文件事件存储自身拥有的五个私有目录（事件溯源根及其四个子目录）。 */
    async initialize(options) {
        const { signal } = parseDemandFileEventStoreOptions(options);
        for (const ref of [
            DEMAND_EVENT_SOURCING_ROOT_REF,
            DEMAND_EVENT_STREAM_COMMITS_ROOT_REF,
            DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF,
            DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF,
            DEMAND_EVENT_STREAM_INDEX_ROOT_REF,
        ]) {
            try {
                const result = await materializeDirectoryPath(this.#root, ref, {
                    mode: DEMAND_FILE_EVENT_STORE_DIRECTORY_MODE,
                    ...(signal === undefined ? {} : { signal }),
                });
                assertDemandFileEventStoreDirectory(result.node, `$${ref}`);
            }
            catch (error) {
                if (error instanceof DemandFileEventStoreError)
                    throw error;
                if (error instanceof DurableDirectoryMaterializationError) {
                    if (error.reason === "aborted")
                        fail("aborted", "$signal");
                    fail("operation-failure", `$${ref}`);
                }
                throw error;
            }
        }
    }
    async readCommits(options) {
        const { signal } = parseDemandFileEventStoreOptions(options);
        return readAllDemandFileEventCommits(this.#root, signal);
    }
    async readCommitsAfter(cursor, options) {
        const { signal } = parseDemandFileEventStoreOptions(options);
        return readDemandFileEventCommitsAfter(this.#root, cursor, signal);
    }
    async readCommitAt(sequence, options) {
        const { signal } = parseDemandFileEventStoreOptions(options);
        return readDemandFileEventCommitAt(this.#root, sequence, signal);
    }
    /** 读取最新可用的身份索引；缺失、损坏或不属于该流时返回 `null`，从不重建。 */
    async readIndex(expectedStreamId, options) {
        const { signal } = parseDemandFileEventStoreOptions(options);
        return readLatestStreamIndex(this.#root, DEMAND_EVENT_STREAM_INDEX_ROOT_REF, expectedStreamId, signal);
    }
    /**
     * 追加准入：索引可用且恰好落后一个提交时，只读前序提交文件做 O(1) 检查；
     * 否则读完整前缀做同一套检查并顺带重建索引。返回准入所依据的索引。
     */
    async #admitAppend(prepared, commit, signal) {
        const located = await readLatestStreamIndex(this.#root, DEMAND_EVENT_STREAM_INDEX_ROOT_REF, commit.demandId, signal);
        if (located !== null &&
            located.index.commitSequence === commit.commitSequence - 1) {
            const admitted = await this.#admitAppendWithIndex(located.index, prepared, commit, signal);
            if (admitted)
                return located.index;
        }
        const prefix = await readAllDemandFileEventCommits(this.#root, signal);
        assertDemandFileEventAppendAdmissionAgainstPrefix(prefix.commits, prepared);
        return buildStreamIndex(commit.demandId, prefix.commits.map((entry) => indexableCommit(entry)));
    }
    /** 返回 `false` 表示索引与磁盘不一致，调用方回退到完整前缀。 */
    async #admitAppendWithIndex(index, prepared, commit, signal) {
        const { sourceExpectation } = prepared;
        const commitBytes = encodeUtf8(renderDemandEventStreamCommit(commit)).byteLength;
        if (index.commitSequence >= DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS ||
            commitBytes > DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMIT_BYTES ||
            index.totalCommitBytes + commitBytes >
                DEMAND_FILE_EVENT_STORE_MAXIMUM_TOTAL_BYTES) {
            fail("capacity", "$commit");
        }
        if (commit.commitSequence === 1) {
            if (commit.expectedStreamRevision !== 0 ||
                commit.previousCommitDigest !== null) {
                fail("concurrency-conflict", "$commit");
            }
            if (sourceExpectation.lastEventDigest !== null ||
                sourceExpectation.stateDigest !== null) {
                fail("append-provenance-conflict", "$preparedCommit/sourceExpectation");
            }
        }
        else {
            const previous = await readDemandFileEventCommitAt(this.#root, commit.commitSequence - 1, signal);
            if (previous === null ||
                computeDemandEventStreamCommitDigest(previous) !== index.lastCommitDigest) {
                return false;
            }
            if (previous.lastStreamRevision !== commit.expectedStreamRevision ||
                index.lastCommitDigest !== commit.previousCommitDigest ||
                previous.demandId !== commit.demandId) {
                fail("concurrency-conflict", "$commit");
            }
            const previousLastEvent = previous.events.at(-1);
            if (previousLastEvent === undefined)
                return false;
            if (sourceExpectation.stateDigest !==
                previousLastEvent.resultingStateDigest ||
                sourceExpectation.lastEventDigest !==
                    computeDemandEventSourcingStoredEventDigest(previousLastEvent)) {
                fail("append-provenance-conflict", "$preparedCommit/sourceExpectation");
            }
        }
        if (Object.hasOwn(index.commits, commit.commitId)) {
            fail("append-identity-conflict", "$commit/commitId");
        }
        if (commit.idempotency !== undefined &&
            Object.hasOwn(index.keys, commit.idempotency.key)) {
            fail("append-identity-conflict", "$commit/idempotency/key");
        }
        for (const [position, event] of commit.events.entries()) {
            if (Object.hasOwn(index.events, event.eventId)) {
                fail("append-identity-conflict", `$commit/events/${position}/eventId`);
            }
        }
        return true;
    }
    /** 提交成功后推进并发布索引；索引是缓存，任何失败只让它落后，不影响提交。 */
    async #refreshIndex(index, commit, signal) {
        try {
            const advanced = index.commits[commit.commitId] === commit.commitSequence
                ? index
                : advanceStreamIndex(index, indexableCommit(commit));
            await publishStreamIndex(this.#root, DEMAND_EVENT_STREAM_INDEX_ROOT_REF, advanced, {
                mode: DEMAND_FILE_EVENT_STORE_FILE_MODE,
                ...(signal === undefined ? {} : { signal }),
            });
            await retireStreamIndexAt(this.#root, DEMAND_EVENT_STREAM_INDEX_ROOT_REF, advanced.commitSequence - STREAM_INDEX_RETENTION, signal);
            if (advanced.commitSequence % STREAM_INDEX_SWEEP_INTERVAL === 0) {
                await retireStreamIndexesBefore(this.#root, DEMAND_EVENT_STREAM_INDEX_ROOT_REF, advanced.commitSequence - (STREAM_INDEX_RETENTION - 1), signal);
            }
        }
        catch (error) {
            if (isWakeflowError(error))
                return;
            throw error;
        }
    }
    async #retireCandidate(ref, node, signal, durability = "fsync") {
        try {
            await unlinkRegularFileExactly(this.#root, ref, {
                expectedNode: node,
                durability,
                ...(signal === undefined ? {} : { signal }),
            });
        }
        catch (error) {
            if (error instanceof ExactRegularFileUnlinkError) {
                if (error.reason === "aborted")
                    fail("aborted", "$signal");
                fail("cleanup-required", "$candidate");
            }
            throw error;
        }
    }
    async #settleCommitTarget(ref, node, signal) {
        try {
            await settleRegularFileDurability(this.#root, ref, {
                expectedNode: node,
                ...(signal === undefined ? {} : { signal }),
            });
        }
        catch (error) {
            if (error instanceof DurableRegularFileSettlementError) {
                if (error.reason === "aborted")
                    fail("aborted", "$signal");
                fail("commit-uncertain", "$commit");
            }
            throw error;
        }
    }
    /** 显式清理非活动的孤立候选、已链接残留或并发失败方。 */
    async recoverAppendCandidates(options) {
        const { signal } = parseDemandFileEventStoreOptions(options);
        const inventory = await readDemandFileEventDirectory(this.#root, DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF, 256, signal);
        const candidates = inventory.entries.map((entry, index) => {
            let address;
            try {
                address = parseDemandEventAppendCandidateFileName(entry.name);
            }
            catch (error) {
                if (error instanceof DemandEventSourcingPathError) {
                    fail("candidate-conflict", `$candidates/${index}`);
                }
                throw error;
            }
            assertDemandFileEventStoreFile(entry.node, `$candidates/${index}`, [
                1n,
                2n,
            ]);
            if (candidateOwnerState(address) !== "inactive") {
                fail("candidate-busy", `$candidates/${index}`);
            }
            return Object.freeze({ address, entry });
        });
        let committedResidueCount = 0;
        let durabilitySettledCommitCount = 0;
        let rolledBackCount = 0;
        let loserCount = 0;
        for (const [index, { address, entry }] of candidates.entries()) {
            const target = await readDemandFileEventCommitOrNull(this.#root, demandEventStreamCommitRef(address.commitSequence), signal, [1n, 2n]);
            let candidate;
            try {
                candidate = await readDemandFileEventCommit(this.#root, entry.resourcePath, entry.node, signal, `$candidates/${index}`, [1n, 2n]);
            }
            catch (error) {
                if (error instanceof DemandFileEventStoreError &&
                    error.reason === "stream-invalid" &&
                    entry.node.linkCount === 1n) {
                    await this.#retireCandidate(entry.resourcePath, entry.node, signal);
                    rolledBackCount += 1;
                    continue;
                }
                throw error;
            }
            if (candidate.commit.commitSequence !== address.commitSequence ||
                candidate.commit.commitId !== address.commitId) {
                fail("candidate-conflict", `$candidates/${index}`);
            }
            if (target === null) {
                if (entry.node.linkCount !== 1n) {
                    fail("commit-uncertain", `$candidates/${index}`);
                }
                await this.#retireCandidate(entry.resourcePath, entry.node, signal);
                rolledBackCount += 1;
                continue;
            }
            const sameCommit = sameDemandEventStreamCommit(target.commit, candidate.commit);
            if (entry.node.linkCount === 2n) {
                if (!sameCommit || !sameFileNodeIdentity(entry.node, target.node)) {
                    fail("commit-uncertain", `$candidates/${index}`);
                }
            }
            if (sameCommit) {
                await this.#settleCommitTarget(demandEventStreamCommitRef(address.commitSequence), target.node, signal);
                durabilitySettledCommitCount += 1;
                committedResidueCount += 1;
            }
            else {
                loserCount += 1;
            }
            await this.#retireCandidate(entry.resourcePath, entry.node, signal);
        }
        return Object.freeze({
            retiredCount: candidates.length,
            committedResidueCount,
            durabilitySettledCommitCount,
            rolledBackCount,
            loserCount,
        });
    }
    /** 在固定 `commitSequence` 槽位持久追加一条已经通过语义验证的提交记录。 */
    async append(preparedValue, options) {
        return APPEND_MUTATION_QUEUE.run(this.#root.absolutePath, () => this.#appendUnderProcessGate(preparedValue, options));
    }
    async #appendUnderProcessGate(preparedValue, options) {
        const { signal } = parseDemandFileEventStoreOptions(options);
        try {
            assertPreparedDemandEventStreamCommit(preparedValue);
        }
        catch (error) {
            if (error instanceof DemandEventStreamCommitError)
                fail("input", "$commit");
            throw error;
        }
        const commit = parseDemandEventStreamCommit(preparedValue.commit);
        admitCommitPublication(commit);
        const commitRef = demandEventStreamCommitRef(commit.commitSequence);
        const existing = await readDemandFileEventCommitOrNull(this.#root, commitRef, signal);
        if (existing !== null) {
            if (!sameDemandEventStreamCommit(existing.commit, commit)) {
                fail("concurrency-conflict", "$commit");
            }
            return Object.freeze({
                disposition: "idempotent",
                commitSequence: commit.commitSequence,
                streamRevision: commit.lastStreamRevision,
                commitDigest: computeDemandEventStreamCommitDigest(commit),
            });
        }
        const admittedIndex = await this.#admitAppend(preparedValue, commit, signal);
        const ownerToken = `${process.pid}-${threadId}-${createUuidV4()}`;
        const candidateRef = demandEventAppendCandidateRef(commit.commitSequence, commit.commitId, ownerToken);
        let candidateNode;
        ACTIVE_APPEND_CANDIDATE_TOKENS.add(ownerToken);
        try {
            candidateNode = (await createFileCandidateDurably(this.#root, candidateRef, encodeUtf8(renderDemandEventStreamCommit(commit)), {
                mode: DEMAND_FILE_EVENT_STORE_FILE_MODE,
                // 内容先同步，目录项持久性由 link 后的目标结算负责。
                durability: "content-only",
                ...(signal === undefined ? {} : { signal }),
            })).node;
        }
        catch (error) {
            ACTIVE_APPEND_CANDIDATE_TOKENS.delete(ownerToken);
            if (error instanceof DurableFileCandidateError) {
                if (error.reason === "aborted")
                    fail("aborted", "$signal");
                if (error.reason === "target-exists") {
                    fail("candidate-conflict", "$candidate");
                }
                fail("operation-failure", "$candidate");
            }
            throw error;
        }
        try {
            let linkedNode = null;
            let disposition = "committed";
            try {
                linkedNode = (await linkRegularFileWithoutReplacement(this.#root, candidateRef, commitRef, {
                    expectedSourceNode: candidateNode,
                    ...(signal === undefined ? {} : { signal }),
                })).sourceNode;
            }
            catch (error) {
                if (!(error instanceof DurableRegularFileLinkError)) {
                    throw error;
                }
                const committed = await readDemandFileEventCommitOrNull(this.#root, commitRef, undefined, [1n, 2n]);
                if (committed === null ||
                    !sameDemandEventStreamCommit(committed.commit, commit)) {
                    await this.#retireCandidate(candidateRef, candidateNode, undefined);
                    if (error.reason === "destination-exists") {
                        fail("concurrency-conflict", "$commit");
                    }
                    if (error.reason === "aborted")
                        fail("aborted", "$signal");
                    fail("commit-uncertain", "$commit");
                }
                await this.#settleCommitTarget(commitRef, committed.node, undefined);
                linkedNode =
                    (await readDemandFileEventCommitOrNull(this.#root, candidateRef, undefined, [1n, 2n]))?.node ?? null;
                if (error.reason === "destination-exists") {
                    disposition = "idempotent";
                }
            }
            if (linkedNode === null) {
                fail("commit-uncertain", "$commit");
            }
            // 提交已由 link 持久化；候选残留即使在崩溃后留下，也由候选恢复按双链接结算。
            await this.#retireCandidate(candidateRef, linkedNode, undefined, "none");
            const committed = await readDemandFileEventCommitOrNull(this.#root, commitRef, undefined);
            if (committed === null ||
                !sameDemandEventStreamCommit(committed.commit, commit)) {
                fail("commit-uncertain", "$commit");
            }
            await this.#refreshIndex(admittedIndex, commit, signal);
            return Object.freeze({
                disposition,
                commitSequence: commit.commitSequence,
                streamRevision: commit.lastStreamRevision,
                commitDigest: computeDemandEventStreamCommitDigest(commit),
            });
        }
        finally {
            ACTIVE_APPEND_CANDIDATE_TOKENS.delete(ownerToken);
        }
    }
}
export { DEMAND_FILE_EVENT_STORE_DIRECTORY_MODE, DEMAND_FILE_EVENT_STORE_FILE_MODE, DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS, DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMIT_BYTES, DEMAND_FILE_EVENT_STORE_MAXIMUM_TOTAL_BYTES, DemandFileEventStoreError, } from "./demand-file-event-store-contract.js";
