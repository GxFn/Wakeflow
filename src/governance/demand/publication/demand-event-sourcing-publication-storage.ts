import nodePath from "node:path";

import {
  createFileAtomically,
  DurableAtomicFileWriteError,
} from "../../../foundation/filesystem/durable-atomic-file-write.js";
import {
  recoverDurableAtomicFileStagesInDirectory,
  DurableAtomicFileStageRecoveryError,
} from "../../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import {
  materializeDirectoryPath,
  DurableDirectoryMaterializationError,
} from "../../../foundation/filesystem/durable-directory-materialization.js";
import {
  readDeterministicJsonFile,
  type DeterministicJsonFileResult,
} from "../../../foundation/filesystem/deterministic-json-file.js";
import { DeterministicJsonDocumentError } from "../../../foundation/data/deterministic-json-document.js";
import {
  unlinkRegularFileExactly,
  ExactRegularFileUnlinkError,
} from "../../../foundation/filesystem/exact-regular-file-unlink.js";
import type { FileNodeSnapshot } from "../../../foundation/filesystem/file-node-snapshot.js";
import type { PortableResourcePath } from "../../../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../../foundation/filesystem/rooted-directory.js";
import { StableFileReadError } from "../../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../../foundation/text/utf8.js";
import {
  computeDemandEventSourcingPublicationTransactionDigest,
  parseDemandEventSourcingPublicationTransactionDocument,
  renderDemandEventSourcingPublicationTransaction,
  DemandEventSourcingPublicationTransactionError,
  type DemandEventSourcingPublicationTransaction,
} from "./demand-event-sourcing-publication-transaction.js";
import {
  DEMAND_EVENT_SOURCING_PUBLICATION_DIRECTORY_MODE,
  DEMAND_EVENT_SOURCING_PUBLICATION_FILE_MODE,
  failDemandEventSourcingPublication as fail,
  type StoredDemandEventSourcingPublicationTransaction,
} from "./demand-event-sourcing-publication-contract.js";
import {
  DEMAND_PUBLICATION_LOCKS_ROOT_REF,
  DEMAND_PUBLICATION_ROOT_REF,
  DEMAND_PUBLICATION_STAGES_ROOT_REF,
  DEMAND_PUBLICATION_TRANSACTIONS_ROOT_REF,
} from "./demand-publication-paths.js";

/** Demand Event Sourcing publication 的 rooted file storage seam。 */

const TRANSACTION_MAXIMUM_BYTES = parseByteCount(24 * 1024 * 1024);

function mapPublicationReadError(error: unknown, path: string): never {
  if (error instanceof StableFileReadError) {
    if (error.reason === "aborted") fail("aborted", "$signal");
    if (
      error.reason === "root-scope"
      || error.reason === "unsupported-platform"
    ) {
      fail("root-scope", "$root");
    }
    fail("conflict", path);
  }
  if (
    error instanceof StrictTextFileError
    || error instanceof DeterministicJsonDocumentError
  ) {
    fail("conflict", path);
  }
  throw error;
}

export async function publicationNodeOrNull(
  root: RootedDirectory,
  ref: PortableResourcePath,
): Promise<Readonly<FileNodeSnapshot> | null> {
  try {
    return (await root.inspectExistingResource(ref)).node;
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

export function assertPrivatePublicationNode(
  node: Readonly<FileNodeSnapshot>,
  kind: "file" | "directory",
  path: string,
  admittedFileLinks: readonly bigint[] = [1n],
): void {
  if (
    node.kind !== kind
    || node.permissionBits !== (
      kind === "file"
        ? DEMAND_EVENT_SOURCING_PUBLICATION_FILE_MODE
        : DEMAND_EVENT_SOURCING_PUBLICATION_DIRECTORY_MODE
    )
    || (kind === "file" && !admittedFileLinks.includes(node.linkCount))
  ) {
    fail("conflict", path);
  }
}

export async function readPublicationTransactionAt(
  root: RootedDirectory,
  ref: PortableResourcePath,
  node: Readonly<FileNodeSnapshot>,
  signal: AbortSignal | undefined,
): Promise<Readonly<StoredDemandEventSourcingPublicationTransaction>> {
  assertPrivatePublicationNode(node, "file", "$transaction");
  let read;
  try {
    read = await readDeterministicJsonFile(root, ref, {
      maximumBytes: TRANSACTION_MAXIMUM_BYTES,
      expectedNode: node,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    mapPublicationReadError(error, "$transaction");
  }
  let transaction;
  try {
    transaction = parseDemandEventSourcingPublicationTransactionDocument(
      read.text,
    );
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingPublicationTransactionError) {
      fail("conflict", "$transaction");
    }
    throw error;
  }
  return Object.freeze({ transaction, source: read });
}

export async function ensureExactPublicationTextFile(
  root: RootedDirectory,
  ref: PortableResourcePath,
  text: string,
  maximumBytes: number,
  signal: AbortSignal | undefined,
): Promise<Readonly<DeterministicJsonFileResult>> {
  let node = await publicationNodeOrNull(root, ref);
  if (node === null) {
    try {
      const created = await createFileAtomically(root, ref, encodeUtf8(text), {
        mode: DEMAND_EVENT_SOURCING_PUBLICATION_FILE_MODE,
        ...(signal === undefined ? {} : { signal }),
      });
      node = created.node;
    } catch (error: unknown) {
      if (
        error instanceof DurableAtomicFileWriteError
        && error.reason === "target-exists"
      ) {
        node = await publicationNodeOrNull(root, ref);
      } else if (
        error instanceof DurableAtomicFileWriteError
        && error.reason === "aborted"
      ) {
        fail("aborted", "$signal");
      } else {
        fail("operation-failure", "$write");
      }
    }
  }
  if (node === null) fail("operation-failure", "$write");
  assertPrivatePublicationNode(node, "file", "$write");
  let read;
  try {
    read = await readDeterministicJsonFile(root, ref, {
      maximumBytes: parseByteCount(maximumBytes),
      expectedNode: node,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    mapPublicationReadError(error, "$write");
  }
  if (read.text !== text) fail("conflict", "$write");
  return read;
}

export async function ensurePublicationTransaction(
  root: RootedDirectory,
  ref: PortableResourcePath,
  transaction: Readonly<DemandEventSourcingPublicationTransaction>,
  signal: AbortSignal | undefined,
): Promise<Readonly<StoredDemandEventSourcingPublicationTransaction>> {
  const text = renderDemandEventSourcingPublicationTransaction(transaction);
  const source = await ensureExactPublicationTextFile(
    root,
    ref,
    text,
    TRANSACTION_MAXIMUM_BYTES,
    signal,
  );
  const stored = await readPublicationTransactionAt(
    root,
    ref,
    source.node,
    signal,
  );
  if (!samePublicationTransaction(stored.transaction, transaction)) {
    fail("conflict", "$transaction");
  }
  return stored;
}

export async function retirePublicationFile(
  root: RootedDirectory,
  ref: PortableResourcePath,
  node: Readonly<FileNodeSnapshot>,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await unlinkRegularFileExactly(root, ref, {
      expectedNode: node,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof ExactRegularFileUnlinkError) {
      fail("recovery-required", "$transaction");
    }
    throw error;
  }
}

export function publicationPhysicalPath(
  root: RootedDirectory,
  ref: PortableResourcePath,
): string {
  return nodePath.join(root.absolutePath, ...ref.split("/"));
}

export function samePublicationTransaction(
  left: Readonly<DemandEventSourcingPublicationTransaction>,
  right: Readonly<DemandEventSourcingPublicationTransaction>,
): boolean {
  return computeDemandEventSourcingPublicationTransactionDigest(left)
    === computeDemandEventSourcingPublicationTransactionDigest(right);
}

export async function initializePublicationStorage(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    for (const ref of [
      DEMAND_PUBLICATION_ROOT_REF,
      DEMAND_PUBLICATION_STAGES_ROOT_REF,
      DEMAND_PUBLICATION_TRANSACTIONS_ROOT_REF,
      DEMAND_PUBLICATION_LOCKS_ROOT_REF,
    ]) {
      await materializeDirectoryPath(root, ref, {
        mode: DEMAND_EVENT_SOURCING_PUBLICATION_DIRECTORY_MODE,
        ...(signal === undefined ? {} : { signal }),
      });
    }
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryMaterializationError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("operation-failure", "$initialize");
    }
    throw error;
  }
}

/** 显式恢复 workspace publication transactions 内的 inactive atomic stages。 */
export async function recoverPublicationTransactionStages(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    const receipt = await recoverDurableAtomicFileStagesInDirectory(
      root,
      DEMAND_PUBLICATION_TRANSACTIONS_ROOT_REF,
      signal === undefined ? undefined : { signal },
    );
    if (
      receipt.activeStageCount !== 0
      || receipt.unknownStageCount !== 0
    ) {
      fail("recovery-required", "$transaction/stage");
    }
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileStageRecoveryError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("recovery-required", "$transaction/stage");
    }
    throw error;
  }
}

export async function openDemandPublicationRoot(
  workspaceRoot: RootedDirectory,
  ref: PortableResourcePath,
): Promise<RootedDirectory> {
  try {
    return await RootedDirectory.open(publicationPhysicalPath(workspaceRoot, ref));
  } catch {
    fail("conflict", "$demandRoot");
  }
}
