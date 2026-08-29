import {
  inspectDirectoryTreeCandidateProgress,
  DurableDirectoryTreeCandidateError,
} from "../../foundation/filesystem/durable-directory-tree-candidate.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  parseWakeflowDurableId,
  WakeflowDurableIdError,
} from "../../contracts/identity/wakeflow-durable-id.js";
import {
  ledgerAuthorityFamily,
  ledgerAuthorityRecordId,
  ledgerRecordPublicationIntentRefForIdentity,
  ledgerRecordPublicationLockRefForIdentity,
  type LedgerAuthorityFamily,
  type LedgerAuthorityRecordId,
} from "./ledger-authority-paths.js";
import {
  throwLedgerAuthorityStoreError as fail,
  type LedgerAuthorityPublicationResult,
} from "./ledger-authority-store-contract.js";
import {
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
import { sameLedgerRecordPublicationIntent } from "./ledger-record-publication-intent.js";

/** Wakeflow Governance / Ledger：由精简发布意图记录驱动的单记录前向恢复。 */

function parseRecordIdentity(recordIdValue: unknown): Readonly<{
  readonly family: LedgerAuthorityFamily;
  readonly recordId: LedgerAuthorityRecordId;
}> {
  let parsed;
  try {
    parsed = parseWakeflowDurableId(recordIdValue, "$recordId");
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("input", "$recordId");
    throw error;
  }
  if (parsed.kind !== "requirement" && parsed.kind !== "confirmation") {
    fail("input", "$recordId");
  }
  return Object.freeze({
    family: parsed.kind,
    recordId: parsed.value as LedgerAuthorityRecordId,
  });
}

/**
 * 本函数只依据精简发布意图记录以及现有暂存目录、最终目录状态恢复一次记录发布。
 * 如果暂存目录缺少成员字节，函数会明确要求调用方使用原始发布输入重试，而不会
 * 根据摘要虚构缺失内容。
 */
export async function recoverLedgerAuthorityRecordPublication(
  root: RootedDirectory,
  recordIdValue: unknown,
  signal: AbortSignal | undefined,
): Promise<Readonly<LedgerAuthorityPublicationResult>> {
  const identity = parseRecordIdentity(recordIdValue);
  const intentRef = ledgerRecordPublicationIntentRefForIdentity(
    identity.family,
    identity.recordId,
  );
  const lockRef = ledgerRecordPublicationLockRefForIdentity(
    identity.family,
    identity.recordId,
  );
  await recoverLedgerIntentAtomicStages(root, intentRef, signal);
  const observed = await existingLedgerRecordPublicationIntentOrNull(
    root,
    intentRef,
    signal,
  );
  if (observed === null) fail("not-found", "$intent");
  if (
    ledgerAuthorityFamily(observed.intent.record) !== identity.family
    || ledgerAuthorityRecordId(observed.intent.record) !== identity.recordId
    || observed.intent.lockRef !== lockRef
  ) {
    fail("conflict", "$intent");
  }
  await prepareLedgerRecordPublicationLockRecovery(root, lockRef);
  return withLedgerRecordPublicationLock(root, lockRef, signal, async () => {
    await recoverLedgerIntentAtomicStages(root, intentRef, signal);
    const stored = await existingLedgerRecordPublicationIntentOrNull(
      root,
      intentRef,
      signal,
    );
    if (
      stored === null
      || !sameLedgerRecordPublicationIntent(stored.intent, observed.intent)
    ) {
      fail("conflict", "$intent");
    }
    if (
      ledgerAuthorityFamily(stored.intent.record) !== identity.family
      || ledgerAuthorityRecordId(stored.intent.record) !== identity.recordId
      || stored.intent.lockRef !== lockRef
    ) {
      fail("conflict", "$intent");
    }
    const residues = await inspectLedgerRecordPublicationResidues(
      root,
      stored.intent,
      signal,
    );
    if (
      await ledgerPublicationResourceNodeOrNull(
        root,
        stored.intent.finalRootRef,
      ) !== null
    ) {
      const loaded = await settleCommittedLedgerIntent(
        root,
        stored,
        residues,
        signal,
      );
      return Object.freeze({ wroteAuthority: false, loaded });
    }
    if (residues.stageNode === null) {
      fail("recovery-input-required", "$stage");
    }
    let progress;
    try {
      progress = await inspectDirectoryTreeCandidateProgress(
        root,
        stored.intent.stageRef,
        stored.intent.treePlan,
        {
          expectedRootNode: residues.stageNode,
          ...(signal === undefined ? {} : { signal }),
        },
      );
    } catch (error: unknown) {
      if (error instanceof DurableDirectoryTreeCandidateError) {
        if (error.reason === "aborted") fail("aborted", "$signal");
        fail("conflict", "$stage");
      }
      throw error;
    }
    if (progress.status !== "complete") {
      fail("recovery-input-required", "$stage");
    }
    const candidate = Object.freeze({
      candidateRootPath: progress.candidateRootPath,
      plan: progress.plan,
      rootNode: progress.rootNode,
    });
    await publishLedgerRecordStage(root, stored.intent, candidate, signal);
    const loaded = await loadExactPublishedLedgerRecord(
      root,
      stored.intent,
      signal,
    );
    const freshStored = await existingLedgerRecordPublicationIntentOrNull(
      root,
      intentRef,
      signal,
    );
    if (
      freshStored === null
      || !sameLedgerRecordPublicationIntent(freshStored.intent, stored.intent)
    ) {
      fail("recovery-required", "$intent");
    }
    await retireLedgerRecordPublicationIntent(root, freshStored, signal);
    return Object.freeze({ wroteAuthority: true, loaded });
  });
}
