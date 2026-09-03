import {
  inspectDirectoryTreeCandidate,
  DurableDirectoryTreeCandidateError,
} from "../../foundation/filesystem/durable-directory-tree-candidate.js";
import {
  settleDirectoryTreeCandidateRetirement,
  DurableDirectoryTreeCandidateRetirementError,
  type DirectoryTreeCandidateRetirementReceipt,
} from "../../foundation/filesystem/durable-directory-tree-candidate-retirement.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  executeDemandEventSourcingCommand,
  DemandEventSourcingCommandHandlerError,
  type DemandEventSourcingCommandResult,
} from "../demand/event-sourcing/demand-event-sourcing-command-handler.js";
import {
  DemandEventSourcingRepository,
  DemandEventSourcingRepositoryError,
} from "../demand/event-sourcing/demand-event-sourcing-repository.js";
import {
  loadDemandEventSourcingRootAuthority,
  loadDemandEventSourcingRootAuthorityDuringManagedEvidencePublication,
  DemandEventSourcingRootAuthorityError,
  type LoadedDemandEventSourcingRootAuthority,
} from "../demand/event-sourcing/demand-event-sourcing-root-authority.js";
import type { DemandEventStreamCommit } from "../demand/event-sourcing/demand-event-stream-commit.js";
import {
  upcastDemandEventSourcingStoredEvent,
  DemandEventSourcingUpcasterError,
} from "../demand/event-sourcing/demand-event-sourcing-upcaster.js";
import { LedgerAuthorityStore } from "../ledger/ledger-authority-store.js";
import { renderManagedEvidenceManifest } from "./managed-evidence-manifest.js";
import {
  publishManagedEvidencePublicationRecord,
  ManagedEvidencePublicationRecordPublisherError,
  type ManagedEvidencePublicationRecordResult,
} from "./managed-evidence-publication-record-publisher.js";
import {
  requireCurrentManagedEvidencePublicationTransaction,
  retireManagedEvidencePublicationTransactionJournal,
  ManagedEvidencePublicationTransactionStoreError,
  type StoredManagedEvidencePublicationTransaction,
} from "./managed-evidence-publication-transaction-store.js";
import {
  computeManagedEvidencePublicationTransactionDigest,
  deriveManagedEvidencePublicationEventSourcingCommand,
  deriveManagedEvidencePublicationRecordTreePlan,
  type ManagedEvidencePublicationTransaction,
} from "./managed-evidence-publication-transaction.js";

/**
 * Wakeflow Governance / Evidence：已耐久Publication Transaction的不可逆边界结算。
 *
 * 本模块只处理Event追加、Event后final前向完成、Event前stale candidate退休，以及
 * journal-last闭合。Config/source准入与stage物化属于Application；本模块不会在
 * Event提交后读取source，也不会把Event回滚为文件删除。
 */

export interface ManagedEvidencePublicationTransactionCompletion {
  readonly eventDisposition: "committed" | "idempotent" | "existing";
  readonly commit: Readonly<DemandEventStreamCommit>;
  readonly record: Readonly<ManagedEvidencePublicationRecordResult>;
  readonly loaded: Readonly<LoadedDemandEventSourcingRootAuthority>;
}

export interface ManagedEvidencePublicationStaleRetirement {
  readonly candidateRetirement: Readonly<DirectoryTreeCandidateRetirementReceipt>;
  readonly loaded: Readonly<LoadedDemandEventSourcingRootAuthority>;
}

export type ManagedEvidencePublicationTransactionSettlementErrorReason =
  | "journal"
  | "event-sourcing"
  | "final"
  | "closure"
  | "aborted"
  | "recovery-required";

const ERROR_MESSAGES = {
  journal: "Managed evidence publication settlement journal is unavailable or conflicting.",
  "event-sourcing": "Managed evidence publication settlement Event is invalid or conflicting.",
  final: "Managed evidence publication settlement final record is invalid or conflicting.",
  closure: "Managed evidence publication settlement cannot prove its Demand root closure.",
  aborted: "Managed evidence publication settlement was aborted.",
  "recovery-required": "Managed evidence publication settlement requires explicit recovery.",
} as const satisfies Readonly<
  Record<ManagedEvidencePublicationTransactionSettlementErrorReason, string>
>;

/** Event/final/journal结算无法安全确定时的稳定、脱敏错误。 */
export class ManagedEvidencePublicationTransactionSettlementError extends Error {
  override readonly name =
    "ManagedEvidencePublicationTransactionSettlementError";
  readonly code =
    "wakeflow-managed-evidence-publication-transaction-settlement" as const;
  readonly reason: ManagedEvidencePublicationTransactionSettlementErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;

  constructor(
    reason: ManagedEvidencePublicationTransactionSettlementErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
  }
}

function ownString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined &&
    Object.hasOwn(descriptor, "value") &&
    typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function fail(
  reason: ManagedEvidencePublicationTransactionSettlementErrorReason,
  cause?: unknown,
): never {
  throw new ManagedEvidencePublicationTransactionSettlementError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
  );
}

function assertCommitRelation(
  commit: Readonly<DemandEventStreamCommit>,
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
): void {
  const expected = transaction.demandEventSourcingAppend;
  const storedEvent = commit.events[0];
  if (
    commit.commitId !== expected.commitId ||
    commit.demandId !== transaction.manifest.demandId ||
    commit.commandDigest !== expected.commandDigest ||
    commit.expectedStreamRevision !== expected.expectedStreamRevision ||
    commit.firstStreamRevision !== expected.expectedStreamRevision + 1 ||
    commit.lastStreamRevision !== expected.expectedStreamRevision + 1 ||
    commit.events.length !== 1 ||
    storedEvent === undefined ||
    storedEvent.eventId !== expected.eventId
  ) {
    fail("event-sourcing");
  }
  try {
    const event = upcastDemandEventSourcingStoredEvent(storedEvent);
    if (
      event.eventType !== "evidence.managed-evidence-recorded" ||
      renderManagedEvidenceManifest(event.data.manifest) !==
        renderManagedEvidenceManifest(transaction.manifest)
    ) {
      fail("event-sourcing");
    }
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingUpcasterError) {
      fail("event-sourcing", error);
    }
    throw error;
  }
}

function mapRootAuthorityError(
  error: DemandEventSourcingRootAuthorityError,
): never {
  if (error.reason === "aborted") fail("aborted", error);
  fail("closure", error);
}

function mapStoreError(
  error: ManagedEvidencePublicationTransactionStoreError,
): never {
  if (error.reason === "aborted") fail("aborted", error);
  if (error.reason === "recovery-required") {
    fail("recovery-required", error);
  }
  fail("journal", error);
}

/** 读取journal仍存在时的完整Demand事务期Authority。 */
export async function loadManagedEvidencePublicationTransactionAuthority(
  demandRoot: RootedDirectory,
  ledgerRoot: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<LoadedDemandEventSourcingRootAuthority>> {
  try {
    return await loadDemandEventSourcingRootAuthorityDuringManagedEvidencePublication(
      demandRoot,
      new LedgerAuthorityStore(ledgerRoot),
      {
        audit: true,
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingRootAuthorityError) {
      mapRootAuthorityError(error);
    }
    throw error;
  }
}

/** journal缺失时加载普通健康Demand Authority。 */
export async function loadManagedEvidencePublicationHealthyAuthority(
  demandRoot: RootedDirectory,
  ledgerRoot: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<LoadedDemandEventSourcingRootAuthority>> {
  try {
    return await loadDemandEventSourcingRootAuthority(
      demandRoot,
      new LedgerAuthorityStore(ledgerRoot),
      {
        audit: true,
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingRootAuthorityError) {
      mapRootAuthorityError(error);
    }
    throw error;
  }
}

/** 在真实当前Aggregate上执行Transaction绑定的exact Event命令。 */
export async function appendManagedEvidencePublicationEvent(
  demandRoot: RootedDirectory,
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandEventSourcingCommandResult>> {
  try {
    const result = await executeDemandEventSourcingCommand(
      new DemandEventSourcingRepository(demandRoot),
      deriveManagedEvidencePublicationEventSourcingCommand(transaction),
      {
        commitId: transaction.demandEventSourcingAppend.commitId,
        expectedStreamRevision:
          transaction.demandEventSourcingAppend.expectedStreamRevision,
        ...(signal === undefined ? {} : { signal }),
      },
    );
    assertCommitRelation(result.commit, transaction);
    return result;
  } catch (error: unknown) {
    if (error instanceof ManagedEvidencePublicationTransactionSettlementError) {
      throw error;
    }
    if (error instanceof DemandEventSourcingCommandHandlerError) {
      if (error.reason === "aborted") fail("aborted", error);
      if (error.reason === "concurrency-conflict") {
        fail("recovery-required", error);
      }
      fail("event-sourcing", error);
    }
    throw error;
  }
}

/** 只在Recovery中按Commit ID有界扫描不可变提交历史。 */
export async function findManagedEvidencePublicationCommit(
  demandRoot: RootedDirectory,
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandEventStreamCommit> | null> {
  try {
    const commit =
      await new DemandEventSourcingRepository(demandRoot).findCommitById(
        transaction.demandEventSourcingAppend.commitId,
        signal === undefined ? undefined : { signal },
      );
    if (commit !== null) assertCommitRelation(commit, transaction);
    return commit;
  } catch (error: unknown) {
    if (error instanceof ManagedEvidencePublicationTransactionSettlementError) {
      throw error;
    }
    if (error instanceof DemandEventSourcingRepositoryError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("event-sourcing", error);
    }
    throw error;
  }
}

async function publishFinal(
  demandRoot: RootedDirectory,
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
  signal: AbortSignal | undefined,
): Promise<Readonly<ManagedEvidencePublicationRecordResult>> {
  try {
    return await publishManagedEvidencePublicationRecord(
      demandRoot,
      transaction,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof ManagedEvidencePublicationRecordPublisherError) {
      if (error.reason === "aborted") fail("aborted", error);
      if (
        error.reason === "commit-uncertain" ||
        error.reason === "durability-failure"
      ) {
        fail("recovery-required", error);
      }
      fail("final", error);
    }
    throw error;
  }
}

async function retireJournal(
  demandRoot: RootedDirectory,
  stored: Readonly<StoredManagedEvidencePublicationTransaction>,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    const current = await requireCurrentManagedEvidencePublicationTransaction(
      demandRoot,
      stored.transaction,
      stored.source.node,
      signal === undefined ? undefined : { signal },
    );
    await retireManagedEvidencePublicationTransactionJournal(
      demandRoot,
      current,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof ManagedEvidencePublicationTransactionStoreError) {
      mapStoreError(error);
    }
    throw error;
  }
}

/** Event已提交后，只允许发布/重用final并以journal-last恢复健康Root。 */
export async function completeManagedEvidencePublicationTransaction(
  demandRoot: RootedDirectory,
  ledgerRoot: RootedDirectory,
  stored: Readonly<StoredManagedEvidencePublicationTransaction>,
  eventDisposition: ManagedEvidencePublicationTransactionCompletion["eventDisposition"],
  signal: AbortSignal | undefined,
): Promise<Readonly<ManagedEvidencePublicationTransactionCompletion>> {
  const transaction = stored.transaction;
  const commit = await findManagedEvidencePublicationCommit(
    demandRoot,
    transaction,
    signal,
  );
  if (commit === null) fail("recovery-required");
  const beforeFinal = await loadManagedEvidencePublicationTransactionAuthority(
    demandRoot,
    ledgerRoot,
    signal,
  );
  if (
    beforeFinal.inventory.managedEvidence.publication?.transactionDigest !==
      stored.transactionDigest
  ) {
    fail("closure");
  }
  const record = await publishFinal(demandRoot, transaction, signal);
  const finalAuthority =
    await loadManagedEvidencePublicationTransactionAuthority(
      demandRoot,
      ledgerRoot,
      signal,
    );
  if (
    finalAuthority.inventory.managedEvidence.publication?.physicalState !==
      "final" ||
    finalAuthority.inventory.managedEvidence.publication.transactionDigest !==
      stored.transactionDigest
  ) {
    fail("closure");
  }
  await retireJournal(demandRoot, stored, signal);
  const loaded = await loadManagedEvidencePublicationHealthyAuthority(
    demandRoot,
    ledgerRoot,
    signal,
  );
  return Object.freeze({
    eventDisposition,
    commit,
    record,
    loaded,
  });
}

/** Event仍缺失且Transaction基线已过期时，退休safe candidate并恢复健康Root。 */
export async function retireStaleManagedEvidencePublicationTransaction(
  demandRoot: RootedDirectory,
  ledgerRoot: RootedDirectory,
  stored: Readonly<StoredManagedEvidencePublicationTransaction>,
  signal: AbortSignal | undefined,
): Promise<Readonly<ManagedEvidencePublicationStaleRetirement>> {
  const beforeRetirement =
    await loadManagedEvidencePublicationTransactionAuthority(
      demandRoot,
      ledgerRoot,
      signal,
    );
  const targetSelector =
    beforeRetirement.aggregate.state.managedEvidence?.find(
      (selector) =>
        selector.evidenceId === stored.transaction.manifest.evidenceId,
    );
  if (
    beforeRetirement.inventory.managedEvidence.publication
      ?.transactionDigest !== stored.transactionDigest ||
    targetSelector !== undefined ||
    (await findManagedEvidencePublicationCommit(
      demandRoot,
      stored.transaction,
      signal,
    )) !== null
  ) {
    fail("recovery-required");
  }
  const plan = deriveManagedEvidencePublicationRecordTreePlan(
    stored.transaction,
  );
  let candidateRetirement: Readonly<DirectoryTreeCandidateRetirementReceipt>;
  try {
    candidateRetirement = await settleDirectoryTreeCandidateRetirement(
      demandRoot,
      plan.candidateRootPath,
      plan.directoryPlan,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateRetirementError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("recovery-required", error);
    }
    throw error;
  }
  const current = await loadManagedEvidencePublicationTransactionAuthority(
    demandRoot,
    ledgerRoot,
    signal,
  );
  if (
    current.inventory.managedEvidence.publication?.physicalState !== "absent"
  ) {
    fail("closure");
  }
  await retireJournal(demandRoot, stored, signal);
  const loaded = await loadManagedEvidencePublicationHealthyAuthority(
    demandRoot,
    ledgerRoot,
    signal,
  );
  return Object.freeze({ candidateRetirement, loaded });
}

/**
 * journal已经退休后，从健康Root重新证明同一Transaction的Event与完整final仍current。
 */
export async function loadCurrentManagedEvidencePublicationTransaction(
  demandRoot: RootedDirectory,
  ledgerRoot: RootedDirectory,
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
  transactionDigest: Sha256Digest,
  signal: AbortSignal | undefined,
): Promise<Readonly<ManagedEvidencePublicationTransactionCompletion>> {
  if (
    computeManagedEvidencePublicationTransactionDigest(transaction) !==
    transactionDigest
  ) {
    fail("event-sourcing");
  }
  const loaded = await loadManagedEvidencePublicationHealthyAuthority(
    demandRoot,
    ledgerRoot,
    signal,
  );
  const commit = await findManagedEvidencePublicationCommit(
    demandRoot,
    transaction,
    signal,
  );
  const manifest = transaction.manifest;
  const selector = loaded.aggregate.state.managedEvidence?.find(
    (candidate) => candidate.evidenceId === manifest.evidenceId,
  );
  const inventory = loaded.inventory.managedEvidence.records.find(
    (candidate) => candidate.evidenceId === manifest.evidenceId,
  );
  if (
    commit === null ||
    selector?.manifestDigest !== manifest.manifestDigest ||
    selector.payloadArtifactDigest !== manifest.payload.artifactDigest ||
    inventory?.manifestDigest !== manifest.manifestDigest ||
    inventory.payloadArtifactDigest !== manifest.payload.artifactDigest ||
    inventory.recordTreePlanDigest !== transaction.recordTreePlanDigest ||
    loaded.identity.demandId !== manifest.demandId ||
    loaded.identity.programId !== manifest.programId ||
    loaded.authorityDigest !== manifest.demandAuthorityDigest
  ) {
    fail("closure");
  }
  const plan = deriveManagedEvidencePublicationRecordTreePlan(transaction);
  let finalRecord;
  try {
    finalRecord = await inspectDirectoryTreeCandidate(
      demandRoot,
      plan.destinationRootPath,
      plan.directoryPlan,
      {
        expectedRootNode: inventory.rootNode,
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("closure", error);
    }
    throw error;
  }
  return Object.freeze({
    eventDisposition: "existing" as const,
    commit,
    record: Object.freeze({
      disposition: "current" as const,
      transactionDigest: computeManagedEvidencePublicationTransactionDigest(
        transaction,
      ),
      finalRecord,
      publication: null,
    }),
    loaded,
  });
}
