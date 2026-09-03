import { types } from "node:util";

import type { Sha256Digest } from "../../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../../foundation/data/passive-own-data.js";
import { readDeterministicJsonFile } from "../../../foundation/filesystem/deterministic-json-file.js";
import { sameFileNodeSnapshot } from "../../../foundation/filesystem/file-node-snapshot.js";
import type { FileNodeSnapshot } from "../../../foundation/filesystem/file-node-snapshot.js";
import { StableFileReadError } from "../../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../../foundation/filesystem/strict-text-file.js";
import { DeterministicJsonDocumentError } from "../../../foundation/data/deterministic-json-document.js";
import { RootedDirectory } from "../../../foundation/filesystem/rooted-directory.js";
import type { PortableResourcePath } from "../../../foundation/filesystem/portable-resource-path.js";
import { parseByteCount } from "../../../foundation/numeric/byte-count.js";
import type { ByteCount } from "../../../foundation/numeric/byte-count.js";
import {
  admitDemandAuthority,
  computeDemandAuthorityDigest,
  parseDemandAuthorityDocument,
  DemandAuthorityError,
  type AdmittedDemandAuthority,
  type DemandAuthority,
} from "../model/demand-authority.js";
import {
  computeDemandIdentityDigest,
  parseDemandIdentityDocument,
  DemandIdentityError,
  type DemandIdentity,
} from "../model/demand-identity.js";
import {
  DemandEventSourcingRepository,
  DemandEventSourcingRepositoryError,
} from "./demand-event-sourcing-repository.js";
import type { DemandEventSourcingAggregate } from "./demand-event-sourcing-aggregate.js";
import {
  DemandEventSourcingRootInventoryError,
  inspectDemandEventSourcingRootInventory,
  type DemandEventSourcingRootInventory,
  type DemandEventSourcingRootInventoryPhase,
} from "./demand-event-sourcing-root-inventory.js";
import {
  DEMAND_EVENT_SOURCING_AUTHORITY_REF,
  DEMAND_EVENT_SOURCING_IDENTITY_REF,
} from "./demand-event-sourcing-paths.js";
import {
  DemandFileEventStore,
  DemandFileEventStoreError,
} from "./demand-file-event-store.js";
import type { DemandEventStreamCommit } from "./demand-event-stream-commit.js";
import {
  upcastDemandEventSourcingStoredEvent,
  DemandEventSourcingUpcasterError,
} from "./demand-event-sourcing-upcaster.js";
import {
  LedgerAuthorityStore,
  LedgerAuthorityStoreError,
} from "../../ledger/ledger-authority-store.js";

/**
 * Wakeflow Governance / Demand Event Sourcing：Demand根目录的组合权威加载。
 *
 * 本边界组合完整根目录资源清单、不可变身份/权威关系记录、Ledger 精确引用解析、
 * 聚合仓储重建和修订 1 发布关系验证。事件存储和聚合仓储本身仍不依赖 Ledger；
 * 普通入口只接受无事务健康根；Managed Evidence专用入口接纳journal绑定且关系关闭
 * 的事务期根。只有需要完整Demand权威事实的上层才调用本文件。
 */

const IDENTITY_MAXIMUM_BYTES = parseByteCount(512 * 1024);
const AUTHORITY_MAXIMUM_BYTES = parseByteCount(1024 * 1024);

export interface LoadedDemandEventSourcingRootAuthority {
  readonly inventory: Readonly<DemandEventSourcingRootInventory>;
  readonly identity: Readonly<DemandIdentity>;
  readonly identityDigest: Sha256Digest;
  readonly authority: Readonly<DemandAuthority>;
  readonly authorityDigest: Sha256Digest;
  readonly admittedAuthority: Readonly<AdmittedDemandAuthority>;
  readonly firstCommit: Readonly<DemandEventStreamCommit>;
  readonly aggregate: Readonly<DemandEventSourcingAggregate>;
  readonly loadMode: "snapshot-tail" | "full-replay" | "audit";
  readonly replayedCommitCount: number;
}

export type DemandEventSourcingRootAuthorityErrorReason =
  | "input"
  | "inventory"
  | "identity"
  | "authority"
  | "ledger"
  | "stream"
  | "closure"
  | "aborted";

const ERROR_MESSAGES = {
  input: "Demand Event Sourcing root authority input is invalid.",
  inventory: "Demand Event Sourcing root inventory does not satisfy its requested phase.",
  identity: "Demand Event Sourcing root identity is invalid.",
  authority: "Demand Event Sourcing root authority record is invalid.",
  ledger:
    "Demand Event Sourcing root authority cannot resolve its Ledger closure.",
  stream: "Demand Event Sourcing root event stream is invalid.",
  closure: "Demand Event Sourcing root records do not form one aggregate.",
  aborted: "Demand Event Sourcing root authority load was aborted.",
} as const satisfies Readonly<
  Record<DemandEventSourcingRootAuthorityErrorReason, string>
>;

export class DemandEventSourcingRootAuthorityError extends Error {
  override readonly name = "DemandEventSourcingRootAuthorityError";
  readonly code = "wakeflow-demand-event-sourcing-root-authority" as const;
  readonly reason: DemandEventSourcingRootAuthorityErrorReason;
  readonly path: string;

  constructor(
    reason: DemandEventSourcingRootAuthorityErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: DemandEventSourcingRootAuthorityErrorReason,
  path: string,
): never {
  throw new DemandEventSourcingRootAuthorityError(reason, path);
}

function sameOptionalNode(
  left: Readonly<FileNodeSnapshot> | undefined,
  right: Readonly<FileNodeSnapshot> | undefined,
): boolean {
  return left === undefined
    ? right === undefined
    : right !== undefined && sameFileNodeSnapshot(left, right);
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameManagedEvidencePublication(
  left: Readonly<
    DemandEventSourcingRootInventory["managedEvidence"]["publication"]
  >,
  right: Readonly<
    DemandEventSourcingRootInventory["managedEvidence"]["publication"]
  >,
): boolean {
  if (left === null || right === null) return left === right;
  const leftProgress = left.stageProgress;
  const rightProgress = right.stageProgress;
  return (
    left.transactionDigest === right.transactionDigest &&
    left.evidenceId === right.evidenceId &&
    left.physicalState === right.physicalState &&
    sameFileNodeSnapshot(left.transactionNode, right.transactionNode) &&
    (leftProgress === undefined || rightProgress === undefined
      ? leftProgress === rightProgress
      : leftProgress.candidateRootPath === rightProgress.candidateRootPath &&
        leftProgress.plan.treeDigest === rightProgress.plan.treeDigest &&
        leftProgress.status === rightProgress.status &&
        sameFileNodeSnapshot(leftProgress.rootNode, rightProgress.rootNode) &&
        sameStringArray(
          leftProgress.missingDirectories,
          rightProgress.missingDirectories,
        ) &&
        sameStringArray(leftProgress.missingFiles, rightProgress.missingFiles))
  );
}

function sameManagedEvidenceInventory(
  left: Readonly<DemandEventSourcingRootInventory>["managedEvidence"],
  right: Readonly<DemandEventSourcingRootInventory>["managedEvidence"],
): boolean {
  return (
    sameManagedEvidencePublication(left.publication, right.publication) &&
    left.recordCount === right.recordCount &&
    sameOptionalNode(left.rootNode, right.rootNode) &&
    left.records.length === right.records.length &&
    left.records.every((record, index) => {
      const other = right.records[index];
      return (
        other !== undefined &&
        record.evidenceId === other.evidenceId &&
        record.programId === other.programId &&
        record.demandId === other.demandId &&
        record.demandAuthorityDigest === other.demandAuthorityDigest &&
        record.manifestDigest === other.manifestDigest &&
        record.payloadArtifactDigest === other.payloadArtifactDigest &&
        record.recordTreePlanDigest === other.recordTreePlanDigest &&
        record.payloadVerification === other.payloadVerification &&
        sameFileNodeSnapshot(record.rootNode, other.rootNode) &&
        sameFileNodeSnapshot(record.manifestNode, other.manifestNode) &&
        sameFileNodeSnapshot(record.payloadNode, other.payloadNode)
      );
    })
  );
}

function sameInventory(
  left: Readonly<DemandEventSourcingRootInventory>,
  right: Readonly<DemandEventSourcingRootInventory>,
): boolean {
  return (
    left.commitCount === right.commitCount &&
    left.snapshotCount === right.snapshotCount &&
    left.artifactCount === right.artifactCount &&
    left.transactionCount === right.transactionCount &&
    left.appendCandidateCount === right.appendCandidateCount &&
    sameManagedEvidenceInventory(
      left.managedEvidence,
      right.managedEvidence,
    ) &&
    sameFileNodeSnapshot(left.nodes.root, right.nodes.root) &&
    sameFileNodeSnapshot(left.nodes.identity, right.nodes.identity) &&
    sameFileNodeSnapshot(left.nodes.authority, right.nodes.authority) &&
    sameFileNodeSnapshot(left.nodes.eventSourcing, right.nodes.eventSourcing) &&
    sameFileNodeSnapshot(left.nodes.commits, right.nodes.commits) &&
    sameFileNodeSnapshot(left.nodes.snapshots, right.nodes.snapshots) &&
    sameFileNodeSnapshot(
      left.nodes.appendCandidates,
      right.nodes.appendCandidates,
    ) &&
    sameFileNodeSnapshot(left.nodes.artifacts, right.nodes.artifacts) &&
    sameFileNodeSnapshot(left.nodes.taskPackages, right.nodes.taskPackages) &&
    sameOptionalNode(left.nodes.testCards, right.nodes.testCards) &&
    sameOptionalNode(
      left.nodes.testDispatchPackets,
      right.nodes.testDispatchPackets,
    ) &&
    sameFileNodeSnapshot(left.nodes.transactions, right.nodes.transactions)
  );
}

function sameManagedEvidenceSelector(
  record: Readonly<
    DemandEventSourcingRootInventory["managedEvidence"]["records"][number]
  >,
  selector: NonNullable<
    DemandEventSourcingAggregate["state"]["managedEvidence"]
  >[number],
): boolean {
  return (
    record.evidenceId === selector.evidenceId &&
    record.manifestDigest === selector.manifestDigest &&
    record.payloadArtifactDigest === selector.payloadArtifactDigest
  );
}

function assertClosedManagedEvidenceRecords(
  records: Readonly<
    DemandEventSourcingRootInventory["managedEvidence"]["records"]
  >,
  selectors: NonNullable<
    DemandEventSourcingAggregate["state"]["managedEvidence"]
  >,
  identity: Readonly<DemandIdentity>,
  authorityDigest: Sha256Digest,
): void {
  if (
    records.length !== selectors.length ||
    records.some((record, index) => {
      const selector = selectors[index];
      return (
        selector === undefined ||
        !sameManagedEvidenceSelector(record, selector) ||
        record.programId !== identity.programId ||
        record.demandId !== identity.demandId ||
        record.demandAuthorityDigest !== authorityDigest
      );
    })
  ) {
    fail("closure", "$managed-evidence");
  }
}

function assertManagedEvidenceClosure(
  inventory: Readonly<DemandEventSourcingRootInventory>,
  identity: Readonly<DemandIdentity>,
  authorityDigest: Sha256Digest,
  aggregate: Readonly<DemandEventSourcingAggregate>,
  phase: Extract<
    DemandEventSourcingRootInventoryPhase,
    "healthy" | "managed-evidence-publication"
  >,
): void {
  const records = inventory.managedEvidence.records;
  const selectors = aggregate.state.managedEvidence ?? [];
  const publication = inventory.managedEvidence.publication;
  if (phase === "healthy") {
    if (publication !== null) fail("closure", "$managed-evidence");
    assertClosedManagedEvidenceRecords(
      records,
      selectors,
      identity,
      authorityDigest,
    );
    return;
  }

  if (publication === null) fail("closure", "$managed-evidence");
  const manifest = publication.transaction.manifest;
  if (
    manifest.evidenceId !== publication.evidenceId ||
    manifest.programId !== identity.programId ||
    manifest.demandId !== identity.demandId ||
    manifest.demandAuthorityDigest !== authorityDigest
  ) {
    fail("closure", "$managed-evidence");
  }
  const targetSelector = selectors.find(
    (selector) => selector.evidenceId === manifest.evidenceId,
  );
  const targetRecord = records.find(
    (record) => record.evidenceId === manifest.evidenceId,
  );
  if (
    targetSelector !== undefined &&
    (targetSelector.manifestDigest !== manifest.manifestDigest ||
      targetSelector.payloadArtifactDigest !== manifest.payload.artifactDigest)
  ) {
    fail("closure", "$managed-evidence");
  }
  if (publication.physicalState === "final") {
    if (
      targetSelector === undefined ||
      targetRecord === undefined ||
      !sameManagedEvidenceSelector(targetRecord, targetSelector)
    ) {
      fail("closure", "$managed-evidence");
    }
    assertClosedManagedEvidenceRecords(
      records,
      selectors,
      identity,
      authorityDigest,
    );
    return;
  }
  if (
    targetRecord !== undefined ||
    (targetSelector !== undefined &&
      publication.physicalState !== "stage-complete")
  ) {
    fail("closure", "$managed-evidence");
  }
  assertClosedManagedEvidenceRecords(
    records,
    targetSelector === undefined
      ? selectors
      : selectors.filter(
          (selector) => selector.evidenceId !== manifest.evidenceId,
        ),
    identity,
    authorityDigest,
  );
}

async function readRecord(
  root: RootedDirectory,
  ref: PortableResourcePath,
  maximumBytes: ByteCount,
  expectedNode: Readonly<FileNodeSnapshot>,
  signal: AbortSignal | undefined,
  owner: "identity" | "authority",
) {
  try {
    return await readDeterministicJsonFile(root, ref, {
      maximumBytes,
      expectedNode,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (
        error.reason === "root-scope" ||
        error.reason === "source-changed" ||
        error.reason === "expectation-changed"
      ) {
        fail("inventory", "$root");
      }
      fail(owner, `$${owner}`);
    }
    if (
      error instanceof StrictTextFileError ||
      error instanceof DeterministicJsonDocumentError
    ) {
      fail(owner, `$${owner}`);
    }
    throw error;
  }
}

function parseOptions(value: unknown): Readonly<{
  readonly audit: boolean;
  readonly signal: AbortSignal | undefined;
}> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (
    Object.keys(record).some((key) => key !== "audit" && key !== "signal") ||
    (record.audit !== undefined && typeof record.audit !== "boolean") ||
    (record.signal !== undefined &&
      (typeof record.signal !== "object" ||
        record.signal === null ||
        types.isProxy(record.signal) ||
        !(record.signal instanceof AbortSignal)))
  ) {
    fail("input", "$options");
  }
  return Object.freeze({
    audit: record.audit === true,
    signal: record.signal as AbortSignal | undefined,
  });
}

type RootAuthorityPhase = Extract<
  DemandEventSourcingRootInventoryPhase,
  "healthy" | "managed-evidence-publication"
>;

async function loadRootAuthority(
  root: RootedDirectory,
  ledgerStore: LedgerAuthorityStore,
  options?: { readonly audit?: boolean; readonly signal?: AbortSignal },
  phase: RootAuthorityPhase = "healthy",
): Promise<Readonly<LoadedDemandEventSourcingRootAuthority>> {
  if (
    typeof root !== "object" ||
    root === null ||
    types.isProxy(root) ||
    !(root instanceof RootedDirectory) ||
    typeof ledgerStore !== "object" ||
    ledgerStore === null ||
    types.isProxy(ledgerStore) ||
    !(ledgerStore instanceof LedgerAuthorityStore)
  ) {
    fail("input", "$input");
  }
  const { audit, signal } = parseOptions(options);
  let inventory: Readonly<DemandEventSourcingRootInventory>;
  try {
    inventory = await inspectDemandEventSourcingRootInventory(
      root,
      {
        phase,
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingRootInventoryError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("inventory", "$root");
    }
    throw error;
  }

  const identityRead = await readRecord(
    root,
    DEMAND_EVENT_SOURCING_IDENTITY_REF,
    IDENTITY_MAXIMUM_BYTES,
    inventory.nodes.identity,
    signal,
    "identity",
  );
  const authorityRead = await readRecord(
    root,
    DEMAND_EVENT_SOURCING_AUTHORITY_REF,
    AUTHORITY_MAXIMUM_BYTES,
    inventory.nodes.authority,
    signal,
    "authority",
  );
  let identity: Readonly<DemandIdentity>;
  let authority: Readonly<DemandAuthority>;
  try {
    identity = parseDemandIdentityDocument(identityRead.text);
  } catch (error: unknown) {
    if (error instanceof DemandIdentityError) fail("identity", "$identity");
    throw error;
  }
  try {
    authority = parseDemandAuthorityDocument(authorityRead.text, identity);
  } catch (error: unknown) {
    if (error instanceof DemandAuthorityError) fail("authority", "$authority");
    throw error;
  }
  let admittedAuthority: Readonly<AdmittedDemandAuthority>;
  try {
    admittedAuthority = await admitDemandAuthority(
      identity,
      authority,
      ledgerStore,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (
      error instanceof DemandAuthorityError ||
      error instanceof LedgerAuthorityStoreError
    ) {
      if (
        (error instanceof DemandAuthorityError && error.reason === "aborted") ||
        (error instanceof LedgerAuthorityStoreError &&
          error.reason === "aborted")
      ) {
        fail("aborted", "$signal");
      }
      fail("ledger", "$authority");
    }
    throw error;
  }

  const eventStore = new DemandFileEventStore(root);
  const repository = new DemandEventSourcingRepository(root);
  let aggregate: Readonly<DemandEventSourcingAggregate>;
  let loadMode: LoadedDemandEventSourcingRootAuthority["loadMode"];
  let replayedCommitCount: number;
  try {
    if (audit) {
      const audited = await repository.audit(
        signal === undefined ? undefined : { signal },
      );
      aggregate = audited.aggregate;
      replayedCommitCount = audited.replayedCommitCount;
      loadMode = "audit";
    } else {
      const loaded = await repository.load(
        signal === undefined ? undefined : { signal },
      );
      if (loaded === null) fail("stream", "$commits");
      aggregate = loaded.aggregate;
      replayedCommitCount = loaded.replayedCommitCount;
      loadMode =
        loaded.snapshotStatus === "used" ? "snapshot-tail" : "full-replay";
    }
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingRootAuthorityError) throw error;
    if (
      error instanceof DemandEventSourcingRepositoryError ||
      error instanceof DemandFileEventStoreError
    ) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("stream", "$commits");
    }
    throw error;
  }
  let firstCommit;
  try {
    firstCommit = await eventStore.readCommitAt(
      1,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof DemandFileEventStoreError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("stream", "$commits/0");
    }
    throw error;
  }
  const firstPersistedEvent = firstCommit?.events[0];
  let firstEvent;
  try {
    firstEvent =
      firstPersistedEvent === undefined
        ? undefined
        : upcastDemandEventSourcingStoredEvent(firstPersistedEvent);
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingUpcasterError) {
      fail("stream", "$commits/0/events/0");
    }
    throw error;
  }
  const identityDigest = computeDemandIdentityDigest(identity);
  const authorityDigest = computeDemandAuthorityDigest(authority);
  if (
    aggregate.demandId !== identity.demandId ||
    authority.demandId !== identity.demandId ||
    firstCommit === null ||
    firstCommit.demandId !== identity.demandId ||
    firstCommit.commitSequence !== 1 ||
    firstCommit.firstStreamRevision !== 1 ||
    firstCommit.lastStreamRevision !== 1 ||
    firstCommit.events.length !== 1 ||
    firstEvent?.eventType !== "publication.demand-published" ||
    firstEvent.data.identityDigest !== identityDigest ||
    firstEvent.data.authorityDigest !== authorityDigest
  ) {
    fail("closure", "$root");
  }
  assertManagedEvidenceClosure(
    inventory,
    identity,
    authorityDigest,
    aggregate,
    phase,
  );
  let finalInventory: Readonly<DemandEventSourcingRootInventory>;
  try {
    finalInventory = await inspectDemandEventSourcingRootInventory(
      root,
      {
        phase,
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingRootInventoryError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("inventory", "$root");
    }
    throw error;
  }
  if (!sameInventory(inventory, finalInventory)) fail("inventory", "$root");
  return Object.freeze({
    inventory: finalInventory,
    identity,
    identityDigest,
    authority,
    authorityDigest,
    admittedAuthority,
    firstCommit,
    aggregate,
    loadMode,
    replayedCommitCount,
  });
}

/** 加载健康根目录；`audit: true` 明确要求从提交 1 开始完整重放。 */
export async function loadDemandEventSourcingRootAuthority(
  root: RootedDirectory,
  ledgerStore: LedgerAuthorityStore,
  options?: { readonly audit?: boolean; readonly signal?: AbortSignal },
): Promise<Readonly<LoadedDemandEventSourcingRootAuthority>> {
  return loadRootAuthority(root, ledgerStore, options, "healthy");
}

/**
 * 加载一个Managed Evidence事务期Demand根。
 *
 * 该边界仍完整验证Identity、Authority、Ledger与Event Stream，只把当前journal
 * 绑定的stage/final作为受限恢复状态接纳。它不证明目标Commit ID；Evidence
 * Application必须再用Transaction中的Commit ID与Command digest闭合Event归属。
 */
export async function loadDemandEventSourcingRootAuthorityDuringManagedEvidencePublication(
  root: RootedDirectory,
  ledgerStore: LedgerAuthorityStore,
  options?: { readonly audit?: boolean; readonly signal?: AbortSignal },
): Promise<Readonly<LoadedDemandEventSourcingRootAuthority>> {
  return loadRootAuthority(
    root,
    ledgerStore,
    options,
    "managed-evidence-publication",
  );
}
