import { types } from "node:util";
import { computeSha256Digest } from "../../foundation/crypto/sha256.js";
import { PassiveOwnDataError, parseDenseArray, parsePlainRecord, } from "../../foundation/data/passive-own-data.js";
import { createDirectoryTreeCandidateDurably, DurableDirectoryTreeCandidateError, planDirectoryTreeCandidate, settleDirectoryTreeCandidateDurably, } from "../../foundation/filesystem/durable-directory-tree-candidate.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { ledgerAuthorityRootRef, ledgerRecordPublicationStageRef, } from "./ledger-authority-paths.js";
import { LedgerAuthorityRecordError, parseLedgerAuthorityRecord, renderLedgerAuthorityRecord, } from "./ledger-authority-record.js";
import { LEDGER_AUTHORITY_MAXIMUM_DOCUMENTS, LEDGER_AUTHORITY_MAXIMUM_TREE_DEPTH, LEDGER_AUTHORITY_MAXIMUM_TREE_ENTRIES, LEDGER_AUTHORITY_MAXIMUM_TREE_FILES, LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES, LEDGER_AUTHORITY_RECORD_MAXIMUM_BYTES, LEDGER_AUTHORITY_TREE_MAXIMUM_BYTES, LEDGER_DURABLE_DIRECTORY_MODE, LEDGER_DURABLE_FILE_MODE, } from "./ledger-authority-storage-policy.js";
import { throwLedgerAuthorityStoreError as fail, } from "./ledger-authority-store-contract.js";
import { ledgerPublicationResourceNodeOrNull, ledgerRecordPublicationStageState, loadExactPublishedLedgerRecord, publishLedgerRecordStage, retireLedgerRecordPublicationStage, } from "./ledger-record-publication-storage.js";
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
function mapStageError(error) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
        if (error.reason === "aborted")
            fail("aborted", "$signal", error);
        if (error.reason === "capacity")
            fail("capacity", "$stage", error);
        fail("conflict", "$stage", error);
    }
    throw error;
}
async function createStage(root, prepared, signal) {
    try {
        return await createDirectoryTreeCandidateDurably(root, prepared.plan.stageRef, prepared.candidateFiles, candidateOptions(signal));
    }
    catch (error) {
        mapStageError(error);
    }
}
/** 补齐已有的暂存；树不是计划的安全子集（`tree-conflict`）时返回 `residue`，其余错误照旧映射。 */
async function settleStageOrResidue(root, prepared, signal) {
    try {
        return await settleDirectoryTreeCandidateDurably(root, prepared.plan.stageRef, prepared.candidateFiles, candidateOptions(signal));
    }
    catch (error) {
        if (error instanceof DurableDirectoryTreeCandidateError && error.reason === "tree-conflict") {
            return "residue";
        }
        mapStageError(error);
    }
}
/**
 * 备好这条记录的暂存：不在就新建；在且是计划的安全子集（已有的成员完整且字节、权限位都对，只是
 * 缺几项）就补齐续做；否则把它当作同一条记录的崩溃残留，删掉之后从头新建一次。
 *
 * 残留的来路：进程 umask 收窄了目录的权限位时，mkdir 以收窄后的权限位出生、chmod 之前进程被杀
 * （不被收窄时目录以请求的权限位出生，新的建造没有这一种；1.4.0 一律以 0700 出生，它被打断的建造
 * 留下的也算）；成员排他新建之后、写完或 chmod 之前进程被杀
 * （空的或短的、权限位还是 0600）；掉电时目录的 chmod 或成员内容没有落盘（第 1 段起建造期间不同步
 * 目录）。这些状态补齐路径都不认，过去每次重发都报冲突，没有任何代码删它。
 *
 * 为什么删掉是安全的（调用方持有记录锁，并且已经确认 final 不在）：
 * - `transactions/` 是私有目录（0700、当前用户），暂存路径由记录标识推出，标识由内容推出，所以
 *   这个目录里只可能是同一条记录被打断的建造；
 * - 记录锁排除了并发的建造者，而只有本发布器把这个暂存改名生效；
 * - final 不在，就没有任何东西引用这个暂存：删掉它不丢任何已生效的状态，新暂存完全由这次已经校验过
 *   的输入建成。
 *
 * 删除走根作用域的整树删除（先确认目标在根内且是目录，删后同步 `transactions/`）。重建只做一次，
 * 不循环：重建出来的暂存再失败就照旧报冲突。
 */
async function stageCandidate(root, prepared, signal) {
    const state = await ledgerRecordPublicationStageState(root, prepared.plan);
    if (state === "absent")
        return await createStage(root, prepared, signal);
    if (state === "resumable") {
        const settled = await settleStageOrResidue(root, prepared, signal);
        if (settled !== "residue")
            return settled;
    }
    await retireLedgerRecordPublicationStage(root, prepared.plan, signal);
    return await createStage(root, prepared, signal);
}
/**
 * 整体发布目录树，或幂等复用完全一致的不可变权威记录。调用方持有工作区的账本记录锁（ADR-0033）：
 * 同一条记录的暂存目录只有一个，两次发布不能同时进行。
 *
 * 不记日志：final 在就逐字节核对后复用；不在就把暂存补齐（上一次被打断留下的同一份内容）、
 * 删掉补不了的残留重建，或新建，然后改名生效。被打断的发布由同一个请求再发一次续上。
 */
export async function publishLedgerAuthorityRecord(root, recordValue, membersValue, signal) {
    const prepared = preparePublication(recordValue, membersValue, signal);
    if ((await ledgerPublicationResourceNodeOrNull(root, prepared.plan.finalRootRef)) !== null) {
        const loaded = await loadExactPublishedLedgerRecord(root, prepared.plan, signal);
        return Object.freeze({ wroteAuthority: false, loaded });
    }
    const candidate = await stageCandidate(root, prepared, signal);
    await publishLedgerRecordStage(root, prepared.plan, candidate, signal);
    const loaded = await loadExactPublishedLedgerRecord(root, prepared.plan, signal);
    return Object.freeze({ wroteAuthority: true, loaded });
}
