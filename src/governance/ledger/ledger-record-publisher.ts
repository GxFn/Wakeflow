import { types } from "node:util";

import { computeSha256Digest } from "../../foundation/crypto/sha256.js";
import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  createDirectoryTreeCandidateDurably,
  planDirectoryTreeCandidate,
  settleDirectoryTreeCandidateDurably,
  DurableDirectoryTreeCandidateError,
  type DirectoryTreeCandidateFileInput,
  type DirectoryTreeCandidateResult,
} from "../../foundation/filesystem/durable-directory-tree-candidate.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  parseLedgerAuthorityRecord,
  renderLedgerAuthorityRecord,
  LedgerAuthorityRecordError,
  type LedgerAuthorityRecord,
} from "./ledger-authority-record.js";
import {
  throwLedgerAuthorityStoreError as fail,
  type LedgerAuthorityMemberInput,
  type LedgerAuthorityPublicationResult,
} from "./ledger-authority-store-contract.js";
import {
  createLedgerRecordPublicationIntent,
  sameLedgerRecordPublicationIntent,
  LedgerRecordPublicationIntentError,
  type LedgerRecordPublicationIntent,
} from "./ledger-record-publication-intent.js";
import {
  ensureLedgerRecordPublicationIntent,
  existingLedgerRecordPublicationIntentOrNull,
  inspectLedgerRecordPublicationResidues,
  ledgerPublicationResourceNodeOrNull,
  loadExactPublishedLedgerRecord,
  prepareLedgerRecordPublicationLockRecovery,
  publishLedgerRecordStage,
  recoverLedgerIntentAtomicStages,
  retireLedgerRecordPublicationIntent,
  settleCommittedLedgerIntent,
  withLedgerRecordPublicationLock,
} from "./ledger-record-publication-storage.js";
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

/**
 * Wakeflow Governance / Ledger：单记录聚合的暂存发布编排。
 *
 * 本模块负责输入准入、目录树候选计划和正常提交。持久化存储、逐记录锁和不依赖
 * 调用方成员字节的恢复逻辑分别位于相邻模块。
 */

interface ParsedMemberInput {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly digest: ReturnType<typeof computeSha256Digest>;
}

interface PreparedPublication {
  readonly record: Readonly<LedgerAuthorityRecord>;
  readonly candidateFiles: readonly Readonly<DirectoryTreeCandidateFileInput>[];
  readonly intent: Readonly<LedgerRecordPublicationIntent>;
}

function parseMembers(
  value: unknown,
  record: Readonly<LedgerAuthorityRecord>,
): readonly Readonly<ParsedMemberInput>[] {
  let entries: readonly unknown[];
  try {
    entries = parseDenseArray(value, LEDGER_AUTHORITY_MAXIMUM_DOCUMENTS, "$members");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$members");
    throw error;
  }
  if (entries.length !== record.documents.length) fail("member", "$members");
  const parsed = entries.map((entry, index): Readonly<ParsedMemberInput> => {
    let input: Readonly<Record<string, unknown>>;
    try {
      input = parsePlainRecord(entry, `$members/${index}`);
    } catch (error: unknown) {
      if (error instanceof PassiveOwnDataError) fail("input", `$members/${index}`);
      throw error;
    }
    const keys = Object.keys(input).sort();
    const inputBytes = input.bytes;
    if (
      keys.length !== 2
      || keys[0] !== "bytes"
      || keys[1] !== "path"
      || typeof input.path !== "string"
      || !ArrayBuffer.isView(inputBytes)
      || !(inputBytes instanceof Uint8Array)
      || types.isProxy(inputBytes)
      || inputBytes.byteLength > LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES
    ) {
      fail("input", `$members/${index}`);
    }
    const bytes = new Uint8Array(inputBytes);
    const digest = computeSha256Digest(bytes, `$members/${index}/bytes`);
    const declared = record.documents[index];
    if (
      declared === undefined
      || input.path !== declared.path
      || digest !== declared.digest
    ) {
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

function preparePublication(
  recordValue: unknown,
  membersValue: readonly LedgerAuthorityMemberInput[],
  signal: AbortSignal | undefined,
): Readonly<PreparedPublication> {
  let record: Readonly<LedgerAuthorityRecord>;
  try {
    record = parseLedgerAuthorityRecord(recordValue);
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityRecordError) fail("input", "$record");
    throw error;
  }
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
  const candidateFiles = Object.freeze([{
    path: "record.json",
    bytes: recordBytes,
    mode: LEDGER_DURABLE_FILE_MODE,
  }, ...members.map((member) => ({
    path: member.path,
    bytes: member.bytes,
    mode: LEDGER_DURABLE_FILE_MODE,
  }))].sort((left, right) => (
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  )));
  try {
    const plan = planDirectoryTreeCandidate(
      candidateFiles,
      candidateOptions(signal),
    );
    return Object.freeze({
      record,
      candidateFiles,
      intent: createLedgerRecordPublicationIntent(record, plan),
    });
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      if (error.reason === "capacity") fail("capacity", "$members");
      fail("member", "$members");
    }
    if (error instanceof LedgerRecordPublicationIntentError) {
      fail("conflict", "$intent");
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
        prepared.intent.stageRef,
        prepared.candidateFiles,
        candidateOptions(signal),
      )
      : await createDirectoryTreeCandidateDurably(
        root,
        prepared.intent.stageRef,
        prepared.candidateFiles,
        candidateOptions(signal),
      );
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "capacity") fail("capacity", "$stage");
      fail("conflict", "$stage");
    }
    throw error;
  }
}

/** 在记录标识级互斥锁内整体发布目录树，或幂等复用完全一致的不可变权威记录。 */
export async function publishLedgerAuthorityRecord(
  root: RootedDirectory,
  recordValue: unknown,
  membersValue: readonly LedgerAuthorityMemberInput[],
  signal: AbortSignal | undefined,
): Promise<Readonly<LedgerAuthorityPublicationResult>> {
  const prepared = preparePublication(recordValue, membersValue, signal);
  await recoverLedgerIntentAtomicStages(root, signal);
  await prepareLedgerRecordPublicationLockRecovery(root, prepared.intent.lockRef);
  return withLedgerRecordPublicationLock(
    root,
    prepared.intent.lockRef,
    signal,
    async () => {
      const storedBefore = await existingLedgerRecordPublicationIntentOrNull(
        root,
        prepared.intent.intentRef,
        signal,
      );
      if (
        storedBefore !== null
        && !sameLedgerRecordPublicationIntent(storedBefore.intent, prepared.intent)
      ) {
        fail("conflict", "$intent");
      }
      const residuesBefore = await inspectLedgerRecordPublicationResidues(
        root,
        prepared.intent,
        signal,
      );
      const finalNode = await ledgerPublicationResourceNodeOrNull(
        root,
        prepared.intent.finalRootRef,
      );
      if (finalNode !== null) {
        if (storedBefore !== null) {
          const loaded = await settleCommittedLedgerIntent(
            root,
            storedBefore,
            residuesBefore,
            signal,
          );
          return Object.freeze({ created: false, loaded });
        }
        if (residuesBefore.stageNode !== null) {
          fail("recovery-required", "$stage");
        }
        const loaded = await loadExactPublishedLedgerRecord(
          root,
          prepared.intent,
          signal,
        );
        return Object.freeze({ created: false, loaded });
      }
      if (storedBefore === null && residuesBefore.stageNode !== null) {
        fail("recovery-required", "$stage");
      }
      const stored = storedBefore ?? await ensureLedgerRecordPublicationIntent(
        root,
        prepared.intent,
        signal,
      );
      const candidate = await createOrSettleStage(
        root,
        prepared,
        residuesBefore.stageNode !== null,
        signal,
      );
      await publishLedgerRecordStage(root, prepared.intent, candidate, signal);
      const loaded = await loadExactPublishedLedgerRecord(
        root,
        prepared.intent,
        signal,
      );
      const freshStored = await existingLedgerRecordPublicationIntentOrNull(
        root,
        prepared.intent.intentRef,
        signal,
      );
      if (
        freshStored === null
        || !sameLedgerRecordPublicationIntent(freshStored.intent, stored.intent)
      ) {
        fail("recovery-required", "$intent");
      }
      await retireLedgerRecordPublicationIntent(root, freshStored, signal);
      return Object.freeze({ created: true, loaded });
    },
  );
}
