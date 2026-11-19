import { types } from "node:util";

import { computeSha256Digest } from "../../foundation/crypto/sha256.js";
import {
  PassiveOwnDataError,
  parseDenseArray,
  parsePlainRecord,
} from "../../foundation/data/passive-own-data.js";
import {
  createDirectoryTreeCandidateDurably,
  type DirectoryTreeCandidateFileInput,
  type DirectoryTreeCandidateResult,
  DurableDirectoryTreeCandidateError,
  planDirectoryTreeCandidate,
  settleDirectoryTreeCandidateDurably,
} from "../../foundation/filesystem/durable-directory-tree-candidate.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  type LedgerAuthorityRecord,
  LedgerAuthorityRecordError,
  parseLedgerAuthorityRecord,
  renderLedgerAuthorityRecord,
} from "./ledger-authority-record.js";
import {
  LEDGER_AUTHORITY_MAXIMUM_DOCUMENTS,
  LEDGER_AUTHORITY_MAXIMUM_TREE_DEPTH,
  LEDGER_AUTHORITY_MAXIMUM_TREE_ENTRIES,
  LEDGER_AUTHORITY_MAXIMUM_TREE_FILES,
  LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES,
  LEDGER_AUTHORITY_RECORD_MAXIMUM_BYTES,
  LEDGER_AUTHORITY_TREE_MAXIMUM_BYTES,
  LEDGER_DURABLE_DIRECTORY_MODE,
  LEDGER_DURABLE_FILE_MODE,
} from "./ledger-authority-storage-policy.js";
import {
  ledgerAuthorityRootRef,
  ledgerRecordPublicationLockRef,
  ledgerRecordPublicationStageRef,
} from "./ledger-authority-paths.js";
import {
  throwLedgerAuthorityStoreError as fail,
  type LedgerAuthorityMemberInput,
  type LedgerAuthorityPublicationResult,
} from "./ledger-authority-store-contract.js";
import {
  type LedgerRecordPublicationPlan,
  ledgerPublicationResourceNodeOrNull,
  ledgerRecordPublicationStageNodeOrNull,
  loadExactPublishedLedgerRecord,
  prepareLedgerRecordPublicationLockRecovery,
  publishLedgerRecordStage,
  withLedgerRecordPublicationLock,
} from "./ledger-record-publication-storage.js";

/**
 * Wakeflow Governance / Ledger：单记录聚合的暂存发布编排。
 *
 * 本模块负责输入准入、目录树候选计划和提交。暂存、逐记录锁与回读校验在相邻的存储模块里。
 */

interface ParsedMemberInput {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly digest: ReturnType<typeof computeSha256Digest>;
}

interface PreparedPublication {
  readonly record: Readonly<LedgerAuthorityRecord>;
  readonly candidateFiles: readonly Readonly<DirectoryTreeCandidateFileInput>[];
  readonly plan: Readonly<LedgerRecordPublicationPlan>;
}

function parseMembers(
  value: unknown,
  record: Readonly<LedgerAuthorityRecord>,
): readonly Readonly<ParsedMemberInput>[] {
  let entries: readonly unknown[];
  try {
    entries = parseDenseArray(value, LEDGER_AUTHORITY_MAXIMUM_DOCUMENTS, "$members");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$members", error);
    throw error;
  }
  if (entries.length !== record.documents.length) fail("member", "$members");
  const parsed = entries.map((entry, index): Readonly<ParsedMemberInput> => {
    let input: Readonly<Record<string, unknown>>;
    try {
      input = parsePlainRecord(entry, `$members/${index}`);
    } catch (error: unknown) {
      if (error instanceof PassiveOwnDataError) fail("input", `$members/${index}`, error);
      throw error;
    }
    const keys = Object.keys(input).sort();
    const inputBytes = input.bytes;
    if (
      keys.length !== 2 ||
      keys[0] !== "bytes" ||
      keys[1] !== "path" ||
      typeof input.path !== "string" ||
      !ArrayBuffer.isView(inputBytes) ||
      !(inputBytes instanceof Uint8Array) ||
      types.isProxy(inputBytes)
    ) {
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

function candidateOptions(signal: AbortSignal | undefined) {
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

function parsePublicationRecord(value: unknown): Readonly<LedgerAuthorityRecord> {
  try {
    return parseLedgerAuthorityRecord(value);
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityRecordError) fail("input", "$record", error);
    throw error;
  }
}

function preparePublication(
  recordValue: unknown,
  membersValue: readonly LedgerAuthorityMemberInput[],
  signal: AbortSignal | undefined,
): Readonly<PreparedPublication> {
  const record = parsePublicationRecord(recordValue);
  const members = parseMembers(membersValue, record);
  const recordBytes = encodeUtf8(renderLedgerAuthorityRecord(record));
  if (recordBytes.byteLength > LEDGER_AUTHORITY_RECORD_MAXIMUM_BYTES) {
    fail("capacity", "$record");
  }
  const totalBytes = members.reduce(
    (total, member) => total + member.bytes.byteLength,
    recordBytes.byteLength,
  );
  if (totalBytes > LEDGER_AUTHORITY_TREE_MAXIMUM_BYTES) {
    fail("capacity", "$members");
  }
  const candidateFiles = Object.freeze(
    [
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
    ].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
  );
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
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      // 规划候选树先核对取消信号：已取消的调用是 aborted，不是成员输入问题（镜像测试 §13.169 发现）。
      if (error.reason === "aborted") fail("aborted", "$signal", error);
      if (error.reason === "capacity") fail("capacity", "$members", error);
      fail("member", "$members", error);
    }
    throw error;
  }
}

async function createOrSettleStage(
  root: RootedDirectory,
  prepared: Readonly<PreparedPublication>,
  stageNodePresent: boolean,
  signal: AbortSignal | undefined,
): Promise<Readonly<DirectoryTreeCandidateResult>> {
  try {
    return stageNodePresent
      ? await settleDirectoryTreeCandidateDurably(
          root,
          prepared.plan.stageRef,
          prepared.candidateFiles,
          candidateOptions(signal),
        )
      : await createDirectoryTreeCandidateDurably(
          root,
          prepared.plan.stageRef,
          prepared.candidateFiles,
          candidateOptions(signal),
        );
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      if (error.reason === "aborted") fail("aborted", "$signal", error);
      if (error.reason === "capacity") fail("capacity", "$stage", error);
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
export async function publishLedgerAuthorityRecord(
  root: RootedDirectory,
  recordValue: unknown,
  membersValue: readonly LedgerAuthorityMemberInput[],
  signal: AbortSignal | undefined,
): Promise<Readonly<LedgerAuthorityPublicationResult>> {
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
