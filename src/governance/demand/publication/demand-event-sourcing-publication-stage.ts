import {
  materializeDirectoryPath,
  DurableDirectoryMaterializationError,
} from "../../../foundation/filesystem/durable-directory-materialization.js";
import {
  renameResourceDurably,
  DurableResourceRenameError,
} from "../../../foundation/filesystem/durable-resource-rename.js";
import type { FileNodeSnapshot } from "../../../foundation/filesystem/file-node-snapshot.js";
import { RootedDirectory } from "../../../foundation/filesystem/rooted-directory.js";
import {
  computeDemandEventStreamCommitDigest,
} from "../event-sourcing/demand-event-stream-commit.js";
import { executeDemandEventSourcingCommand, DemandEventSourcingCommandHandlerError } from "../event-sourcing/demand-event-sourcing-command-handler.js";
import {
  DemandEventSourcingRepository,
  DemandEventSourcingRepositoryError,
} from "../event-sourcing/demand-event-sourcing-repository.js";
import {
  loadDemandEventSourcingRootAuthority,
  DemandEventSourcingRootAuthorityError,
  type LoadedDemandEventSourcingRootAuthority,
} from "../event-sourcing/demand-event-sourcing-root-authority.js";
import { inspectDemandEventSourcingRootInventory, DemandEventSourcingRootInventoryError } from "../event-sourcing/demand-event-sourcing-root-inventory.js";
import {
  DEMAND_EVENT_SOURCING_ARTIFACTS_ROOT_REF,
  DEMAND_EVENT_SOURCING_AUTHORITY_REF,
  DEMAND_EVENT_SOURCING_IDENTITY_REF,
  DEMAND_EVENT_SOURCING_TRANSACTIONS_ROOT_REF,
} from "../event-sourcing/demand-event-sourcing-paths.js";
import {
  TASK_PACKAGE_PROJECTIONS_ROOT_REF,
} from "../../tasking/task-package-projection-paths.js";
import {
  DemandFileEventSnapshotStore,
  DemandFileEventSnapshotStoreError,
} from "../event-sourcing/demand-file-event-snapshot-store.js";
import { DemandFileEventStore, DemandFileEventStoreError } from "../event-sourcing/demand-file-event-store.js";
import { renderDemandAuthority } from "../model/demand-authority.js";
import { renderDemandIdentity } from "../model/demand-identity.js";
import type { LedgerAuthorityStore } from "../../ledger/ledger-authority-store.js";
import {
  DEMAND_EVENT_SOURCING_PUBLICATION_DIRECTORY_MODE,
  DemandEventSourcingPublicationServiceError,
  failDemandEventSourcingPublication as fail,
} from "./demand-event-sourcing-publication-contract.js";
import type { DemandEventSourcingPublicationTransaction } from "./demand-event-sourcing-publication-transaction.js";
import {
  assertPrivatePublicationNode,
  admitDemandPublicationResourceOperation,
  ensureExactPublicationTextFile,
  ensurePublicationTransaction,
  openDemandPublicationRoot,
  publicationNodeOrNull,
} from "./demand-event-sourcing-publication-storage.js";
import { DEMAND_PUBLICATION_MARKER_REF } from "./demand-publication-paths.js";

/** Demand 事件溯源根目录的暂存构建、整体重命名和最终加载。 */

function mapStageError(error: unknown): never {
  if (error instanceof DemandEventSourcingPublicationServiceError) throw error;
  if (
    error instanceof DemandFileEventStoreError
    || error instanceof DemandFileEventSnapshotStoreError
    || error instanceof DemandEventSourcingRepositoryError
    || error instanceof DemandEventSourcingCommandHandlerError
    || error instanceof DemandEventSourcingRootInventoryError
  ) {
    if (error.reason === "aborted") fail("aborted", "$signal");
    fail("conflict", "$stage");
  }
  if (error instanceof DurableDirectoryMaterializationError) {
    if (error.reason === "aborted") fail("aborted", "$signal");
    fail("operation-failure", "$stage/directories");
  }
  throw error;
}

export async function materializeDemandPublicationStage(
  workspaceRoot: RootedDirectory,
  transaction: Readonly<DemandEventSourcingPublicationTransaction>,
  signal: AbortSignal | undefined,
): Promise<void> {
  let stageNode: Readonly<FileNodeSnapshot>;
  try {
    stageNode = (await materializeDirectoryPath(
      workspaceRoot,
      transaction.stageRef,
      {
      mode: DEMAND_EVENT_SOURCING_PUBLICATION_DIRECTORY_MODE,
      ...(signal === undefined ? {} : { signal }),
      },
    )).node;
  } catch (error: unknown) {
    mapStageError(error);
  }
  const stageRoot = await openDemandPublicationRoot(
    workspaceRoot,
    transaction.stageRef,
    stageNode,
  );
  let operationError: unknown;
  try {
    const eventStore = new DemandFileEventStore(stageRoot);
    await eventStore.initialize(signal === undefined ? undefined : { signal });
    for (const ref of [
      DEMAND_EVENT_SOURCING_ARTIFACTS_ROOT_REF,
      TASK_PACKAGE_PROJECTIONS_ROOT_REF,
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
    const repository = new DemandEventSourcingRepository(stageRoot);
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
    operationError = error;
  }
  let closeError: unknown;
  try {
    await stageRoot.close();
  } catch (error: unknown) {
    closeError = error;
  }
  if (operationError !== undefined) mapStageError(operationError);
  if (closeError !== undefined) fail("operation-failure", "$stage/close");
}

export async function publishDemandStage(
  root: RootedDirectory,
  transaction: Readonly<DemandEventSourcingPublicationTransaction>,
  signal: AbortSignal | undefined,
): Promise<void> {
  const stageNode = await publicationNodeOrNull(root, transaction.stageRef);
  if (stageNode === null) fail("conflict", "$stage");
  assertPrivatePublicationNode(stageNode, "directory", "$stage");
  admitDemandPublicationResourceOperation(
    transaction,
    transaction.finalRootRef,
    "exact-directory-publish",
  );
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
      if (
        error.reason === "commit-uncertain"
        || error.reason === "durability-failure"
        || error.reason === "close-failure"
      ) {
        fail("recovery-required", "$stage");
      }
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
  const finalNode = await publicationNodeOrNull(
    workspaceRoot,
    transaction.finalRootRef,
  );
  if (finalNode === null) fail("conflict", "$demandRoot");
  assertPrivatePublicationNode(finalNode, "directory", "$demandRoot");
  const demandRoot = await openDemandPublicationRoot(
    workspaceRoot,
    transaction.finalRootRef,
    finalNode,
  );
  let loaded: Readonly<LoadedDemandEventSourcingRootAuthority> | undefined;
  let operationError: unknown;
  try {
    loaded = await loadDemandEventSourcingRootAuthority(
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
  } catch (error: unknown) {
    operationError = error;
  }
  let closeError: unknown;
  try {
    await demandRoot.close();
  } catch (error: unknown) {
    closeError = error;
  }
  if (operationError !== undefined) {
    if (operationError instanceof DemandEventSourcingPublicationServiceError) {
      throw operationError;
    }
    if (operationError instanceof DemandEventSourcingRootAuthorityError) {
      if (operationError.reason === "aborted") fail("aborted", "$signal");
      fail("conflict", "$demandRoot");
    }
    throw operationError;
  }
  if (closeError !== undefined) fail("operation-failure", "$demandRoot/close");
  if (loaded === undefined) fail("operation-failure", "$demandRoot");
  return loaded;
}
