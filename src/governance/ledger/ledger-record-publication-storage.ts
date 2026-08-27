import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  DeterministicJsonDocumentError,
} from "../../foundation/data/deterministic-json-document.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import {
  recoverDurableAtomicFileStagesInDirectory,
  DurableAtomicFileStageRecoveryError,
} from "../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import {
  inspectDirectoryTreeCandidate,
  DurableDirectoryTreeCandidateError,
  type DirectoryTreeCandidateResult,
} from "../../foundation/filesystem/durable-directory-tree-candidate.js";
import {
  publishDirectoryTreeCandidateDurably,
  DurableDirectoryTreePublicationError,
} from "../../foundation/filesystem/durable-directory-tree-publication.js";
import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import {
  unlinkRegularFileExactly,
  ExactRegularFileUnlinkError,
} from "../../foundation/filesystem/exact-regular-file-unlink.js";
import type { FileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  inspectRootedExclusiveFileLock,
  retireRootedExclusiveFileLockResidue,
  withRootedExclusiveFileLock,
  RootedExclusiveFileLockError,
} from "../../foundation/filesystem/rooted-exclusive-file-lock.js";
import { StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../foundation/filesystem/strict-text-file.js";
import { loadLedgerAuthorityRecord } from "./ledger-authority-reader.js";
import { computeLedgerAuthorityRecordDigest } from "./ledger-authority-record.js";
import {
  LEDGER_TRANSACTIONS_ROOT_REF,
} from "./ledger-authority-paths.js";
import {
  LedgerAuthorityStoreError,
  throwLedgerAuthorityStoreError as fail,
  type LoadedLedgerAuthorityRecord,
} from "./ledger-authority-store-contract.js";
import {
  parseLedgerRecordPublicationIntentDocument,
  renderLedgerRecordPublicationIntent,
  sameLedgerRecordPublicationIntent,
  LedgerRecordPublicationIntentError,
  type LedgerRecordPublicationIntent,
} from "./ledger-record-publication-intent.js";
import {
  LEDGER_PUBLICATION_INTENT_MAXIMUM_BYTES,
  LEDGER_RECORD_PUBLICATION_LOCK_TIMEOUT_MILLISECONDS,
  LEDGER_TRANSACTION_FILE_MODE,
} from "./ledger-authority-storage-policy.js";

/**
 * Wakeflow Governance / Ledger：逐记录发布流程的私有存储与协调边界。
 *
 * 本模块负责发布意图记录、暂存残留、逐记录锁和最终目标回读校验。它不解析调用方
 * 提供的成员输入，也不决定使用正常发布入口还是恢复入口。
 */

export interface StoredLedgerRecordPublicationIntent {
  readonly intent: Readonly<LedgerRecordPublicationIntent>;
  readonly node: Readonly<FileNodeSnapshot>;
}

export interface LedgerRecordPublicationResidues {
  readonly stageNode: Readonly<FileNodeSnapshot> | null;
}

export async function ledgerPublicationResourceNodeOrNull(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
): Promise<Readonly<FileNodeSnapshot> | null> {
  try {
    return (await root.inspectExistingResource(resourcePath)).node;
  } catch (error: unknown) {
    if (
      error instanceof RootedDirectoryError
      && error.reason === "resource-not-found"
    ) {
      return null;
    }
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root");
    throw error;
  }
}

function assertTransactionFileNode(node: Readonly<FileNodeSnapshot>): void {
  if (
    node.kind !== "file"
    || node.permissionBits !== LEDGER_TRANSACTION_FILE_MODE
    || node.linkCount !== 1n
  ) {
    fail("conflict", "$intent");
  }
}

async function readStoredIntent(
  root: RootedDirectory,
  intentRef: PortableResourcePath,
  expectedNode: Readonly<FileNodeSnapshot>,
  signal: AbortSignal | undefined,
): Promise<Readonly<StoredLedgerRecordPublicationIntent>> {
  assertTransactionFileNode(expectedNode);
  let read;
  try {
    read = await readDeterministicJsonFile(root, intentRef, {
      maximumBytes: LEDGER_PUBLICATION_INTENT_MAXIMUM_BYTES,
      expectedNode,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "too-large") fail("capacity", "$intent");
      fail("conflict", "$intent");
    }
    if (
      error instanceof StrictTextFileError
      || error instanceof DeterministicJsonDocumentError
    ) {
      fail("conflict", "$intent");
    }
    throw error;
  }
  let intent;
  try {
    intent = parseLedgerRecordPublicationIntentDocument(read.text);
  } catch (error: unknown) {
    if (error instanceof LedgerRecordPublicationIntentError) {
      fail("conflict", "$intent");
    }
    throw error;
  }
  return Object.freeze({ intent, node: read.node });
}

export async function existingLedgerRecordPublicationIntentOrNull(
  root: RootedDirectory,
  intentRef: PortableResourcePath,
  signal: AbortSignal | undefined,
): Promise<Readonly<StoredLedgerRecordPublicationIntent> | null> {
  const node = await ledgerPublicationResourceNodeOrNull(root, intentRef);
  return node === null ? null : readStoredIntent(root, intentRef, node, signal);
}

export async function ensureLedgerRecordPublicationIntent(
  root: RootedDirectory,
  expected: Readonly<LedgerRecordPublicationIntent>,
  signal: AbortSignal | undefined,
): Promise<Readonly<StoredLedgerRecordPublicationIntent>> {
  const existing = await existingLedgerRecordPublicationIntentOrNull(
    root,
    expected.intentRef,
    signal,
  );
  if (existing !== null) {
    if (!sameLedgerRecordPublicationIntent(existing.intent, expected)) {
      fail("conflict", "$intent");
    }
    return existing;
  }
  try {
    await createFileAtomically(
      root,
      expected.intentRef,
      encodeUtf8(renderLedgerRecordPublicationIntent(expected)),
      {
        mode: LEDGER_TRANSACTION_FILE_MODE,
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason !== "target-exists") fail("operation-failure", "$intent");
    } else {
      throw error;
    }
  }
  const stored = await existingLedgerRecordPublicationIntentOrNull(
    root,
    expected.intentRef,
    signal,
  );
  if (
    stored === null
    || !sameLedgerRecordPublicationIntent(stored.intent, expected)
  ) {
    fail("conflict", "$intent");
  }
  return stored;
}

export async function retireLedgerRecordPublicationIntent(
  root: RootedDirectory,
  stored: Readonly<StoredLedgerRecordPublicationIntent>,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await unlinkRegularFileExactly(root, stored.intent.intentRef, {
      expectedNode: stored.node,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof ExactRegularFileUnlinkError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("recovery-required", "$intent");
    }
    throw error;
  }
}

export async function inspectLedgerRecordPublicationResidues(
  root: RootedDirectory,
  intent: Readonly<LedgerRecordPublicationIntent>,
  _signal: AbortSignal | undefined,
): Promise<Readonly<LedgerRecordPublicationResidues>> {
  return Object.freeze({
    stageNode: await ledgerPublicationResourceNodeOrNull(root, intent.stageRef),
  });
}

export async function recoverLedgerIntentAtomicStages(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await recoverDurableAtomicFileStagesInDirectory(
      root,
      LEDGER_TRANSACTIONS_ROOT_REF,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileStageRecoveryError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("recovery-required", "$transactions");
    }
    throw error;
  }
}

export async function prepareLedgerRecordPublicationLockRecovery(
  root: RootedDirectory,
  lockRef: PortableResourcePath,
): Promise<void> {
  let observation;
  try {
    observation = await inspectRootedExclusiveFileLock(root, lockRef);
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) {
      fail("lock-unsafe", "$lock");
    }
    throw error;
  }
  if (observation.status !== "held" || observation.ownerState !== "inactive") {
    return;
  }
  try {
    await retireRootedExclusiveFileLockResidue(root, lockRef, observation);
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) {
      fail("recovery-required", "$lock");
    }
    throw error;
  }
}

function mapLockError(error: RootedExclusiveFileLockError): never {
  if (error.reason === "timeout") fail("lock-timeout", "$lock");
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (
    error.reason === "unsafe-lock"
    || error.reason === "parent"
    || error.reason === "root-scope"
  ) {
    fail("lock-unsafe", "$lock");
  }
  fail("recovery-required", "$lock");
}

export async function withLedgerRecordPublicationLock<Result>(
  root: RootedDirectory,
  lockRef: PortableResourcePath,
  signal: AbortSignal | undefined,
  action: () => Promise<Result>,
): Promise<Result> {
  try {
    return await withRootedExclusiveFileLock(root, lockRef, action, {
      acquireTimeoutMilliseconds:
        LEDGER_RECORD_PUBLICATION_LOCK_TIMEOUT_MILLISECONDS,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityStoreError) throw error;
    if (error instanceof RootedExclusiveFileLockError) mapLockError(error);
    throw error;
  }
}

export async function loadExactPublishedLedgerRecord(
  root: RootedDirectory,
  intent: Readonly<LedgerRecordPublicationIntent>,
  signal: AbortSignal | undefined,
): Promise<Readonly<LoadedLedgerAuthorityRecord>> {
  const finalNode = await ledgerPublicationResourceNodeOrNull(
    root,
    intent.finalRootRef,
  );
  if (finalNode === null) fail("not-found", "$record");
  if (finalNode.kind !== "directory") fail("conflict", "$record");
  try {
    await inspectDirectoryTreeCandidate(
      root,
      intent.finalRootRef,
      intent.treePlan,
      {
        expectedRootNode: finalNode,
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("conflict", "$record");
    }
    throw error;
  }
  const loaded = await loadLedgerAuthorityRecord(
    root,
    intent.finalRootRef,
    intent.family,
    intent.recordId,
    signal,
  );
  if (
    loaded.recordDigest !== computeLedgerAuthorityRecordDigest(intent.record)
    || loaded.documents.length !== intent.record.documents.length
    || loaded.documents.some((document, index) => (
      document.digest !== intent.record.documents[index]?.digest
    ))
  ) {
    fail("conflict", "$record");
  }
  return loaded;
}

export async function publishLedgerRecordStage(
  root: RootedDirectory,
  intent: Readonly<LedgerRecordPublicationIntent>,
  candidate: Readonly<DirectoryTreeCandidateResult>,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await publishDirectoryTreeCandidateDurably(
      root,
      candidate,
      intent.finalRootRef,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreePublicationError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "cross-device") fail("root-scope", "$stage");
      if (
        error.reason === "commit-uncertain"
        || error.reason === "durability-failure"
      ) {
        fail("recovery-required", "$stage");
      }
      fail("conflict", "$stage");
    }
    throw error;
  }
}

export async function settleCommittedLedgerIntent(
  root: RootedDirectory,
  stored: Readonly<StoredLedgerRecordPublicationIntent>,
  residues: Readonly<LedgerRecordPublicationResidues>,
  signal: AbortSignal | undefined,
): Promise<Readonly<LoadedLedgerAuthorityRecord>> {
  if (residues.stageNode !== null) {
    fail("recovery-required", "$stage");
  }
  const loaded = await loadExactPublishedLedgerRecord(root, stored.intent, signal);
  await retireLedgerRecordPublicationIntent(root, stored, signal);
  return loaded;
}
