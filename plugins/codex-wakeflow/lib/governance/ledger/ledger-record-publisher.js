import { types } from "node:util";
import { computeSha256Digest } from "../../foundation/crypto/sha256.js";
import { PassiveOwnDataError, parseDenseArray, parsePlainRecord, } from "../../foundation/data/passive-own-data.js";
import { createDirectoryTreeCandidateDurably, DurableDirectoryTreeCandidateError, planDirectoryTreeCandidate, settleDirectoryTreeCandidateDurably, } from "../../foundation/filesystem/durable-directory-tree-candidate.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { LedgerAuthorityRecordError, parseLedgerAuthorityRecord, renderLedgerAuthorityRecord, } from "./ledger-authority-record.js";
import { LEDGER_AUTHORITY_MAXIMUM_DOCUMENTS, LEDGER_AUTHORITY_MAXIMUM_TREE_DEPTH, LEDGER_AUTHORITY_MAXIMUM_TREE_ENTRIES, LEDGER_AUTHORITY_MAXIMUM_TREE_FILES, LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES, LEDGER_AUTHORITY_RECORD_MAXIMUM_BYTES, LEDGER_AUTHORITY_TREE_MAXIMUM_BYTES, LEDGER_DURABLE_DIRECTORY_MODE, LEDGER_DURABLE_FILE_MODE, } from "./ledger-authority-storage-policy.js";
import { ledgerAuthorityRootRef, ledgerRecordPublicationLockRef, ledgerRecordPublicationStageRef, } from "./ledger-authority-paths.js";
import { throwLedgerAuthorityStoreError as fail, } from "./ledger-authority-store-contract.js";
import { ledgerPublicationResourceNodeOrNull, ledgerRecordPublicationStageNodeOrNull, loadExactPublishedLedgerRecord, prepareLedgerRecordPublicationLockRecovery, publishLedgerRecordStage, withLedgerRecordPublicationLock, } from "./ledger-record-publication-storage.js";
function parseMembers(value, record) {
    let entries;
    try {
        entries = parseDenseArray(value, LEDGER_AUTHORITY_MAXIMUM_DOCUMENTS, "$members");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$members", error);
        throw error;
    }
    if (entries.length !== record.documents.length)
        fail("member", "$members");
    const parsed = entries.map((entry, index) => {
        let input;
        try {
            input = parsePlainRecord(entry, `$members/${index}`);
        }
        catch (error) {
            if (error instanceof PassiveOwnDataError)
                fail("input", `$members/${index}`, error);
            throw error;
        }
        const keys = Object.keys(input).sort();
        const inputBytes = input.bytes;
        if (keys.length !== 2 ||
            keys[0] !== "bytes" ||
            keys[1] !== "path" ||
            typeof input.path !== "string" ||
            !ArrayBuffer.isView(inputBytes) ||
            !(inputBytes instanceof Uint8Array) ||
            types.isProxy(inputBytes)) {
            fail("input", `$members/${index}`);
        }
        if (inputBytes.byteLength > LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES) {
            fail("capacity", `$members/${index}`);
        }
        const bytes = new Uint8Array(inputBytes);
        const digest = computeSha256Digest(bytes, `$members/${index}/bytes`);
        const declared = record.documents[index];
        if (declared === undefined || input.path !== declared.path || digest !== declared.digest) {
            fail("member", `$members/${index}`);
        }
        return Object.freeze({ path: declared.path, bytes, digest });
    });
    return Object.freeze(parsed);
}
function candidateOptions(signal) {
    return Object.freeze({
        directoryMode: LEDGER_DURABLE_DIRECTORY_MODE,
        maximumDepth: LEDGER_AUTHORITY_MAXIMUM_TREE_DEPTH,
        maximumEntries: LEDGER_AUTHORITY_MAXIMUM_TREE_ENTRIES,
        maximumFileBytes: LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES,
        maximumFiles: LEDGER_AUTHORITY_MAXIMUM_TREE_FILES,
        maximumTotalBytes: LEDGER_AUTHORITY_TREE_MAXIMUM_BYTES,
        ...(signal === undefined ? {} : { signal }),
    });
}
function parsePublicationRecord(value) {
    try {
        return parseLedgerAuthorityRecord(value);
    }
    catch (error) {
        if (error instanceof LedgerAuthorityRecordError)
            fail("input", "$record", error);
        throw error;
    }
}
function preparePublication(recordValue, membersValue, signal) {
    const record = parsePublicationRecord(recordValue);
    const members = parseMembers(membersValue, record);
    const recordBytes = encodeUtf8(renderLedgerAuthorityRecord(record));
    if (recordBytes.byteLength > LEDGER_AUTHORITY_RECORD_MAXIMUM_BYTES) {
        fail("capacity", "$record");
    }
    const totalBytes = members.reduce((total, member) => total + member.bytes.byteLength, recordBytes.byteLength);
    if (totalBytes > LEDGER_AUTHORITY_TREE_MAXIMUM_BYTES) {
        fail("capacity", "$members");
    }
    const candidateFiles = Object.freeze([
        {
            path: "record.json",
            bytes: recordBytes,
            mode: LEDGER_DURABLE_FILE_MODE,
        },
        ...members.map((member) => ({
            path: member.path,
            bytes: member.bytes,
            mode: LEDGER_DURABLE_FILE_MODE,
        })),
    ].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)));
    try {
        const treePlan = planDirectoryTreeCandidate(candidateFiles, candidateOptions(signal));
        return Object.freeze({
            record,
            candidateFiles,
            plan: Object.freeze({
                record,
                finalRootRef: ledgerAuthorityRootRef(record),
                lockRef: ledgerRecordPublicationLockRef(record),
                stageRef: ledgerRecordPublicationStageRef(record),
                treePlan,
            }),
        });
    }
    catch (error) {
        if (error instanceof DurableDirectoryTreeCandidateError) {
            // 规划候选树先核对取消信号：已取消的调用是 aborted，不是成员输入问题（镜像测试 §13.169 发现）。
            if (error.reason === "aborted")
                fail("aborted", "$signal", error);
            if (error.reason === "capacity")
                fail("capacity", "$members", error);
            fail("member", "$members", error);
        }
        throw error;
    }
}
async function createOrSettleStage(root, prepared, stageNodePresent, signal) {
    try {
        return stageNodePresent
            ? await settleDirectoryTreeCandidateDurably(root, prepared.plan.stageRef, prepared.candidateFiles, candidateOptions(signal))
            : await createDirectoryTreeCandidateDurably(root, prepared.plan.stageRef, prepared.candidateFiles, candidateOptions(signal));
    }
    catch (error) {
        if (error instanceof DurableDirectoryTreeCandidateError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal", error);
            if (error.reason === "capacity")
                fail("capacity", "$stage", error);
            fail("conflict", "$stage", error);
        }
        throw error;
    }
}
/**
 * 在记录标识级互斥锁内整体发布目录树，或幂等复用完全一致的不可变权威记录。
 *
 * 不记日志：final 在就逐字节核对后复用；不在就把暂存补齐（上一次被打断留下的同一份内容）或新建，
 * 然后改名生效。被打断的发布由同一个请求再发一次续上。
 */
export async function publishLedgerAuthorityRecord(root, recordValue, membersValue, signal) {
    const prepared = preparePublication(recordValue, membersValue, signal);
    await prepareLedgerRecordPublicationLockRecovery(root, prepared.plan.lockRef);
    return withLedgerRecordPublicationLock(root, prepared.plan.lockRef, signal, async () => {
        if ((await ledgerPublicationResourceNodeOrNull(root, prepared.plan.finalRootRef)) !== null) {
            const loaded = await loadExactPublishedLedgerRecord(root, prepared.plan, signal);
            return Object.freeze({ wroteAuthority: false, loaded });
        }
        const stageNode = await ledgerRecordPublicationStageNodeOrNull(root, prepared.plan);
        const candidate = await createOrSettleStage(root, prepared, stageNode !== null, signal);
        await publishLedgerRecordStage(root, prepared.plan, candidate, signal);
        const loaded = await loadExactPublishedLedgerRecord(root, prepared.plan, signal);
        return Object.freeze({ wroteAuthority: true, loaded });
    });
}
