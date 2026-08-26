import {
  materializeDirectoryPath,
  DurableDirectoryMaterializationError,
} from "../../../foundation/filesystem/durable-directory-materialization.js";
import {
  renameResourceDurably,
  DurableResourceRenameError,
} from "../../../foundation/filesystem/durable-resource-rename.js";
import type { RootedDirectory } from "../../../foundation/filesystem/rooted-directory.js";
import {
  computeDemandEventStreamCommitDigest,
} from "../event-sourcing/demand-event-stream-commit.js";
import { executeDemandEventSourcingCommand, DemandEventSourcingCommandHandlerError } from "../event-sourcing/demand-event-sourcing-command-handler.js";
import { DemandEventSourcingRepository } from "../event-sourcing/demand-event-sourcing-repository.js";
import {
  loadDemandEventSourcingRootAuthority,
  type LoadedDemandEventSourcingRootAuthority,
} from "../event-sourcing/demand-event-sourcing-root-authority.js";
import { inspectDemandEventSourcingRootInventory, DemandEventSourcingRootInventoryError } from "../event-sourcing/demand-event-sourcing-root-inventory.js";
import {
  DEMAND_EVENT_SOURCING_ARTIFACTS_ROOT_REF,
  DEMAND_EVENT_SOURCING_AUTHORITY_REF,
  DEMAND_EVENT_SOURCING_IDENTITY_REF,
  DEMAND_EVENT_SOURCING_TRANSACTIONS_ROOT_REF,
} from "../event-sourcing/demand-event-sourcing-paths.js";
import { DemandFileEventSnapshotStore } from "../event-sourcing/demand-file-event-snapshot-store.js";
import { DemandFileEventStore, DemandFileEventStoreError } from "../event-sourcing/demand-file-event-store.js";
import { renderDemandAuthority } from "../model/demand-authority.js";
import { renderDemandIdentity } from "../model/demand-identity.js";
import type { LedgerAuthorityStore } from "../../ledger/ledger-authority-store.js";
import {
  DEMAND_EVENT_SOURCING_PUBLICATION_DIRECTORY_MODE,
  failDemandEventSourcingPublication as fail,
} from "./demand-event-sourcing-publication-contract.js";
import type { DemandEventSourcingPublicationTransaction } from "./demand-event-sourcing-publication-transaction.js";
import {
  assertPrivatePublicationNode,
  ensureExactPublicationTextFile,
  ensurePublicationTransaction,
  openDemandPublicationRoot,
  publicationNodeOrNull,
} from "./demand-event-sourcing-publication-storage.js";
import { DEMAND_PUBLICATION_MARKER_REF } from "./demand-publication-paths.js";

/** Demand Event Sourcing root 的 stage materialization、rename 与 final load。 */

export async function materializeDemandPublicationStage(
  workspaceRoot: RootedDirectory,
  transaction: Readonly<DemandEventSourcingPublicationTransaction>,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await materializeDirectoryPath(workspaceRoot, transaction.stageRef, {
      mode: DEMAND_EVENT_SOURCING_PUBLICATION_DIRECTORY_MODE,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (
      error instanceof DurableDirectoryMaterializationError
      && error.reason === "aborted"
    ) {
      fail("aborted", "$signal");
    }
    fail("operation-failure", "$stage");
  }
  const stageRoot = await openDemandPublicationRoot(
    workspaceRoot,
    transaction.stageRef,
  );
  try {
    const eventStore = new DemandFileEventStore(stageRoot);
    await eventStore.initialize(signal === undefined ? undefined : { signal });
    for (const ref of [
      DEMAND_EVENT_SOURCING_ARTIFACTS_ROOT_REF,
      DEMAND_EVENT_SOURCING_TRANSACTIONS_ROOT_REF,
    ]) {
      await materializeDirectoryPath(stageRoot, ref, {
        mode: DEMAND_EVENT_SOURCING_PUBLICATION_DIRECTORY_MODE,
        ...(signal === undefined ? {} : { signal }),
      });
    }
    await ensureExactPublicationTextFile(
      stageRoot,
      DEMAND_EVENT_SOURCING_IDENTITY_REF,
      renderDemandIdentity(transaction.identity),
      512 * 1024,
      signal,
    );
    await ensureExactPublicationTextFile(
      stageRoot,
      DEMAND_EVENT_SOURCING_AUTHORITY_REF,
      renderDemandAuthority(transaction.authority),
      1024 * 1024,
      signal,
    );
    await ensurePublicationTransaction(
      stageRoot,
      DEMAND_PUBLICATION_MARKER_REF,
      transaction,
      signal,
    );
    await eventStore.recoverAppendCandidates(
      signal === undefined ? undefined : { signal },
    );
    const snapshotStore = new DemandFileEventSnapshotStore(stageRoot);
    await snapshotStore.recoverPublicationStages(
      signal === undefined ? undefined : { signal },
    );
    const repository = new DemandEventSourcingRepository(
      eventStore,
      snapshotStore,
    );
    const result = await executeDemandEventSourcingCommand(
      repository,
      transaction.initialCommand,
      {
        commitId: transaction.initialCommit.commitId,
        expectedStreamRevision: 0,
        ...(signal === undefined ? {} : { signal }),
      },
    );
    if (
      result.commandDigest !== transaction.initialCommandDigest
      || computeDemandEventStreamCommitDigest(result.commit)
        !== transaction.initialCommitDigest
      || result.aggregate.streamRevision !== 1
    ) {
      fail("conflict", "$stage/commit");
    }
    await repository.publishSnapshot(
      result.aggregate,
      signal === undefined ? undefined : { signal },
    );
    await inspectDemandEventSourcingRootInventory(stageRoot, {
      phase: "publication",
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (
      error instanceof DemandFileEventStoreError
      || error instanceof DemandEventSourcingCommandHandlerError
      || error instanceof DemandEventSourcingRootInventoryError
    ) {
      fail("conflict", "$stage");
    }
    if (error instanceof DurableDirectoryMaterializationError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("operation-failure", "$stage/directories");
    }
    throw error;
  } finally {
    await stageRoot.close();
  }
}

export async function publishDemandStage(
  root: RootedDirectory,
  transaction: Readonly<DemandEventSourcingPublicationTransaction>,
  signal: AbortSignal | undefined,
): Promise<void> {
  const stageNode = await publicationNodeOrNull(root, transaction.stageRef);
  if (stageNode === null) fail("conflict", "$stage");
  assertPrivatePublicationNode(stageNode, "directory", "$stage");
  try {
    await renameResourceDurably(
      root,
      transaction.stageRef,
      transaction.finalRootRef,
      {
        expectedSourceNode: stageNode,
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DurableResourceRenameError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("conflict", "$stage");
    }
    throw error;
  }
}

export async function loadFinalDemandPublication(
  workspaceRoot: RootedDirectory,
  ledgerStore: LedgerAuthorityStore,
  transaction: Readonly<DemandEventSourcingPublicationTransaction>,
  signal: AbortSignal | undefined,
): Promise<Readonly<LoadedDemandEventSourcingRootAuthority>> {
  const demandRoot = await openDemandPublicationRoot(
    workspaceRoot,
    transaction.finalRootRef,
  );
  try {
    const loaded = await loadDemandEventSourcingRootAuthority(
      demandRoot,
      ledgerStore,
      signal === undefined ? undefined : { signal },
    );
    if (
      loaded.identityDigest !== transaction.identityDigest
      || loaded.authorityDigest !== transaction.authorityDigest
      || loaded.firstCommit.commitId !== transaction.initialCommit.commitId
      || computeDemandEventStreamCommitDigest(loaded.firstCommit)
        !== transaction.initialCommitDigest
    ) {
      fail("conflict", "$demandRoot");
    }
    return loaded;
  } finally {
    await demandRoot.close();
  }
}
