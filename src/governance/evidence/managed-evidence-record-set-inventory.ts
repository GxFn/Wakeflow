import { types } from "node:util";

import pLimit from "p-limit";

import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  inspectDirectoryTreeCandidate,
  inspectDirectoryTreeCandidateProgress,
  DurableDirectoryTreeCandidateError,
  type DirectoryTreeCandidateProgress,
} from "../../foundation/filesystem/durable-directory-tree-candidate.js";
import {
  sameFileNodeSnapshot,
  FileNodeSnapshotError,
  type FileNodeSnapshot,
} from "../../foundation/filesystem/file-node-snapshot.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
  type StableDirectoryEntry,
  type StableDirectoryReadResult,
} from "../../foundation/filesystem/stable-directory-read.js";
import {
  deriveManagedEvidencePublicationRecordTreePlan,
  type ManagedEvidencePublicationTransaction,
} from "./managed-evidence-publication-transaction.js";
import {
  loadManagedEvidencePublicationTransaction,
  ManagedEvidencePublicationTransactionStoreError,
  type StoredManagedEvidencePublicationTransaction,
} from "./managed-evidence-publication-transaction-store.js";
import {
  loadManagedEvidenceRecord,
  ManagedEvidenceRecordReaderError,
} from "./managed-evidence-record-reader.js";
import {
  parseManagedEvidenceRecordDirectoryName,
  parseManagedEvidenceStageDirectoryName,
  MANAGED_EVIDENCE_ROOT_REF,
  ManagedEvidenceResourcePathError,
} from "./managed-evidence-resource-paths.js";

/**
 * Wakeflow Governance / Evidence：Demand根内Managed Evidence记录集合的稳定只读清单。
 *
 * healthy观察只接纳完整final record。事务观察额外读取固定journal，并只允许该
 * journal绑定Evidence的一个安全partial/complete stage或完整final。healthy集合稳定
 * 关闭Evidence ID、`manifest.json`/`payload/`顶层并读取有界Manifest，以便和Demand
 * Identity/Authority/Event selector闭合，但不散列全部历史payload；当前事务自己的
 * stage/final仍按完整record tree plan复验。
 *
 * 本模块不读取原source、不创建或补齐stage、不追加Event、不退休candidate/journal，
 * 也不判断Event是否已经提交；后者由Demand Root Authority与恢复Application闭合。
 * 专用Evidence Reader在读取具体记录时负责该份payload的完整或定向内容复验。
 */

export const MANAGED_EVIDENCE_RECORD_SET_MAXIMUM_RECORDS = 10_000;

export interface ManagedEvidenceRecordInventoryEntry {
  readonly evidenceId: WakeflowDurableId<"evidence">;
  readonly programId: WakeflowDurableId<"program">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly demandAuthorityDigest: Sha256Digest;
  readonly manifestDigest: Sha256Digest;
  readonly payloadArtifactDigest: Sha256Digest;
  readonly recordTreePlanDigest: Sha256Digest;
  readonly payloadVerification: "deferred";
  readonly rootNode: Readonly<FileNodeSnapshot>;
  readonly manifestNode: Readonly<FileNodeSnapshot>;
  readonly payloadNode: Readonly<FileNodeSnapshot>;
}

export type ManagedEvidencePublicationPhysicalState =
  | "absent"
  | "stage-incomplete"
  | "stage-complete"
  | "final";

export interface ManagedEvidenceRecordSetPublicationInventory {
  readonly transaction: Readonly<ManagedEvidencePublicationTransaction>;
  readonly transactionDigest: Sha256Digest;
  readonly transactionNode: Readonly<FileNodeSnapshot>;
  readonly evidenceId: WakeflowDurableId<"evidence">;
  readonly physicalState: ManagedEvidencePublicationPhysicalState;
  readonly stageProgress?: Readonly<DirectoryTreeCandidateProgress>;
}

export interface ManagedEvidenceRecordSetInventory {
  readonly recordCount: number;
  readonly records: readonly Readonly<ManagedEvidenceRecordInventoryEntry>[];
  readonly rootNode?: Readonly<FileNodeSnapshot>;
  readonly publication:
    Readonly<ManagedEvidenceRecordSetPublicationInventory> | null;
}

export interface InspectManagedEvidenceRecordSetInventoryOptions {
  readonly expectedRootNode?: Readonly<FileNodeSnapshot>;
  readonly expectedTransactionNode?: Readonly<FileNodeSnapshot>;
  readonly signal?: AbortSignal;
}

export type ManagedEvidenceRecordSetInventoryErrorReason =
  | "input"
  | "root-scope"
  | "tree-shape"
  | "node-policy"
  | "transaction"
  | "record"
  | "capacity"
  | "source-changed"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Managed evidence record-set inventory input is invalid.",
  "root-scope": "Managed evidence record-set inventory escaped its root scope.",
  "tree-shape": "Managed evidence record set contains an unknown resource.",
  "node-policy": "Managed evidence record set violates its private node policy.",
  transaction: "Managed evidence publication transaction is invalid.",
  record: "Managed evidence final record is incomplete or inconsistent.",
  capacity: "Managed evidence record-set inventory exceeds its capacity.",
  "source-changed": "Managed evidence record set changed during inventory.",
  aborted: "Managed evidence record-set inventory was aborted.",
  "operation-failure": "Managed evidence record-set inventory failed.",
} as const satisfies Readonly<
  Record<ManagedEvidenceRecordSetInventoryErrorReason, string>
>;

/** Record-set结构、事务或Manifest闭包无法稳定证明时的脱敏错误。 */
export class ManagedEvidenceRecordSetInventoryError extends Error {
  override readonly name = "ManagedEvidenceRecordSetInventoryError";
  readonly code = "wakeflow-managed-evidence-record-set-inventory" as const;
  readonly reason: ManagedEvidenceRecordSetInventoryErrorReason;
  readonly path: string;

  constructor(
    reason: ManagedEvidenceRecordSetInventoryErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedOptions {
  readonly expectedRootNode: Readonly<FileNodeSnapshot> | undefined;
  readonly expectedTransactionNode: Readonly<FileNodeSnapshot> | undefined;
  readonly signal: AbortSignal | undefined;
}

const RECORD_INSPECTION_CONCURRENCY = 4;

function fail(
  reason: ManagedEvidenceRecordSetInventoryErrorReason,
  path: string,
): never {
  throw new ManagedEvidenceRecordSetInventoryError(reason, path);
}

function parseExpectedNode(
  value: unknown,
  path: string,
): Readonly<FileNodeSnapshot> | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    !Object.isFrozen(value)
  ) {
    fail("input", path);
  }
  try {
    sameFileNodeSnapshot(
      value as Readonly<FileNodeSnapshot>,
      value as Readonly<FileNodeSnapshot>,
    );
  } catch (error: unknown) {
    if (error instanceof FileNodeSnapshotError) fail("input", path);
    throw error;
  }
  return value as Readonly<FileNodeSnapshot>;
}

function parseOptions(value: unknown): Readonly<ParsedOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (
    Object.keys(record).some(
      (key) =>
        key !== "expectedRootNode" &&
        key !== "expectedTransactionNode" &&
        key !== "signal",
    ) ||
    (record.signal !== undefined &&
      (typeof record.signal !== "object" ||
        record.signal === null ||
        types.isProxy(record.signal) ||
        !(record.signal instanceof AbortSignal)))
  ) {
    fail("input", "$options");
  }
  return Object.freeze({
    expectedRootNode: parseExpectedNode(
      record.expectedRootNode,
      "$/expectedRootNode",
    ),
    expectedTransactionNode: parseExpectedNode(
      record.expectedTransactionNode,
      "$/expectedTransactionNode",
    ),
    signal: record.signal as AbortSignal | undefined,
  });
}

function assertDirectory(node: Readonly<FileNodeSnapshot>, path: string): void {
  if (
    node.kind !== "directory" ||
    node.permissionBits !== 0o700 ||
    (typeof process.geteuid === "function" &&
      node.userId !== BigInt(process.geteuid()))
  ) {
    fail("node-policy", path);
  }
}

function mapDirectoryError(error: StableDirectoryReadError): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "root-scope") fail("root-scope", "$root");
  if (error.reason === "too-many-entries") {
    fail("capacity", "$managedEvidence");
  }
  if (
    error.reason === "source-changed" ||
    error.reason === "expectation-changed"
  ) {
    fail("source-changed", "$managedEvidence");
  }
  if (
    error.reason === "not-found" ||
    error.reason === "symlink" ||
    error.reason === "not-directory"
  ) {
    fail("tree-shape", "$managedEvidence");
  }
  fail("operation-failure", "$managedEvidence");
}

function mapCandidateError(
  error: DurableDirectoryTreeCandidateError,
  owner: "record" | "transaction",
): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "source-changed") {
    fail("source-changed", owner === "record" ? "$record" : "$stage");
  }
  fail(owner, owner === "record" ? "$record" : "$stage");
}

async function readContainer(
  root: RootedDirectory,
  expectedNode: Readonly<FileNodeSnapshot>,
  signal: AbortSignal | undefined,
): Promise<Readonly<StableDirectoryReadResult<PortableResourcePath>>> {
  try {
    return await readStableResourceDirectory(root, MANAGED_EVIDENCE_ROOT_REF, {
      maximumEntries: MANAGED_EVIDENCE_RECORD_SET_MAXIMUM_RECORDS + 1,
      expectedNode,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError) mapDirectoryError(error);
    throw error;
  }
}

function mapTransactionStoreError(
  error: ManagedEvidencePublicationTransactionStoreError,
): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "root-scope") fail("root-scope", "$root");
  if (error.reason === "capacity") fail("capacity", "$transaction");
  if (error.reason === "conflict") fail("transaction", "$transaction");
  fail("operation-failure", "$transaction");
}

async function readTransaction(
  root: RootedDirectory,
  expectedNode: Readonly<FileNodeSnapshot>,
  signal: AbortSignal | undefined,
): Promise<Readonly<StoredManagedEvidencePublicationTransaction>> {
  let stored;
  try {
    stored = await loadManagedEvidencePublicationTransaction(
      root,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof ManagedEvidencePublicationTransactionStoreError) {
      mapTransactionStoreError(error);
    }
    throw error;
  }
  if (
    stored === null ||
    !sameFileNodeSnapshot(stored.source.node, expectedNode)
  ) {
    fail("source-changed", "$transaction");
  }
  return stored;
}

async function assertTransactionCurrent(
  root: RootedDirectory,
  expected: Readonly<StoredManagedEvidencePublicationTransaction>,
  signal: AbortSignal | undefined,
): Promise<void> {
  let current: Readonly<StoredManagedEvidencePublicationTransaction> | null;
  try {
    current = await loadManagedEvidencePublicationTransaction(
      root,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof ManagedEvidencePublicationTransactionStoreError) {
      mapTransactionStoreError(error);
    }
    throw error;
  }
  if (
    current === null ||
    current.transactionDigest !== expected.transactionDigest ||
    current.source.text !== expected.source.text ||
    !sameFileNodeSnapshot(current.source.node, expected.source.node)
  ) {
    fail("source-changed", "$transaction");
  }
}

async function inspectRecord(
  root: RootedDirectory,
  entry: Readonly<StableDirectoryEntry>,
  signal: AbortSignal | undefined,
): Promise<Readonly<ManagedEvidenceRecordInventoryEntry>> {
  let address;
  try {
    address = parseManagedEvidenceRecordDirectoryName(entry.name);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceResourcePathError) {
      fail("tree-shape", "$managedEvidence");
    }
    throw error;
  }
  let loaded;
  try {
    loaded = await loadManagedEvidenceRecord(
      root,
      address.evidenceId,
      {
        expectedRootNode: entry.node,
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceRecordReaderError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "root-scope") fail("root-scope", "$root");
      if (error.reason === "capacity") fail("capacity", "$record");
      if (error.reason === "source-changed") {
        fail("source-changed", "$record");
      }
      if (error.reason === "node-policy") fail("node-policy", "$record");
      fail("record", "$record");
    }
    throw error;
  }
  const manifest = loaded.manifest;
  return Object.freeze({
    evidenceId: manifest.evidenceId,
    programId: manifest.programId,
    demandId: manifest.demandId,
    demandAuthorityDigest: manifest.demandAuthorityDigest,
    manifestDigest: manifest.manifestDigest,
    payloadArtifactDigest: manifest.payload.artifactDigest,
    recordTreePlanDigest: loaded.recordTreePlan.planDigest,
    payloadVerification: "deferred",
    rootNode: loaded.rootNode,
    manifestNode: loaded.manifestNode,
    payloadNode: loaded.payloadNode,
  });
}

function sameDirectoryRead(
  left: Readonly<StableDirectoryReadResult<PortableResourcePath>>,
  right: Readonly<StableDirectoryReadResult<PortableResourcePath>>,
): boolean {
  return (
    sameFileNodeSnapshot(left.directoryNode, right.directoryNode) &&
    left.entries.length === right.entries.length &&
    left.entries.every((entry, index) => {
      const other = right.entries[index];
      return (
        other !== undefined &&
        entry.name === other.name &&
        sameFileNodeSnapshot(entry.node, other.node)
      );
    })
  );
}

async function inspectRecords(
  root: RootedDirectory,
  entries: readonly Readonly<StableDirectoryEntry>[],
  signal: AbortSignal | undefined,
): Promise<readonly Readonly<ManagedEvidenceRecordInventoryEntry>[]> {
  const limit = pLimit(RECORD_INSPECTION_CONCURRENCY);
  const settled = await Promise.allSettled(
    entries.map((entry) => limit(() => inspectRecord(root, entry, signal))),
  );
  for (const result of settled) {
    if (result.status === "rejected") throw result.reason;
  }
  return Object.freeze(settled.map((result) => {
    if (result.status !== "fulfilled") fail("operation-failure", "$record");
    return result.value;
  }));
}

async function inspectStage(
  root: RootedDirectory,
  entry: Readonly<StableDirectoryEntry>,
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DirectoryTreeCandidateProgress>> {
  let address;
  try {
    address = parseManagedEvidenceStageDirectoryName(entry.name);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceResourcePathError) {
      fail("tree-shape", "$managedEvidence");
    }
    throw error;
  }
  if (address.evidenceId !== transaction.manifest.evidenceId) {
    fail("transaction", "$stage");
  }
  assertDirectory(entry.node, "$stage");
  const plan = deriveManagedEvidencePublicationRecordTreePlan(transaction);
  try {
    return await inspectDirectoryTreeCandidateProgress(
      root,
      address.stageRootRef,
      plan.directoryPlan,
      {
        expectedRootNode: entry.node,
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      mapCandidateError(error, "transaction");
    }
    throw error;
  }
}

async function inspectCurrentFinal(
  root: RootedDirectory,
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
  expectedRootNode: Readonly<FileNodeSnapshot>,
  signal: AbortSignal | undefined,
): Promise<void> {
  const plan = deriveManagedEvidencePublicationRecordTreePlan(transaction);
  try {
    await inspectDirectoryTreeCandidate(
      root,
      plan.destinationRootPath,
      plan.directoryPlan,
      {
        expectedRootNode,
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      mapCandidateError(error, "transaction");
    }
    throw error;
  }
}

/** 稳定分类Managed Evidence final集合及可选的单槽publication事务。 */
export async function inspectManagedEvidenceRecordSetInventory(
  root: RootedDirectory,
  optionsValue: InspectManagedEvidenceRecordSetInventoryOptions = {},
): Promise<Readonly<ManagedEvidenceRecordSetInventory>> {
  if (
    typeof root !== "object" ||
    root === null ||
    types.isProxy(root) ||
    !(root instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
  const options = parseOptions(optionsValue);
  if (options.signal?.aborted === true) fail("aborted", "$signal");
  const readTransactionResult = options.expectedTransactionNode === undefined
    ? null
    : await readTransaction(
        root,
        options.expectedTransactionNode,
        options.signal,
      );
  if (options.expectedRootNode === undefined) {
    if (readTransactionResult !== null) {
      await assertTransactionCurrent(root, readTransactionResult, options.signal);
    }
    return Object.freeze({
      recordCount: 0,
      records: Object.freeze([]),
      publication: readTransactionResult === null
        ? null
        : Object.freeze({
            transaction: readTransactionResult.transaction,
            transactionDigest: readTransactionResult.transactionDigest,
            transactionNode: readTransactionResult.source.node,
            evidenceId: readTransactionResult.transaction.manifest.evidenceId,
            physicalState: "absent" as const,
          }),
    });
  }

  const before = await readContainer(
    root,
    options.expectedRootNode,
    options.signal,
  );
  assertDirectory(before.directoryNode, "$managedEvidence");
  const recordEntries: StableDirectoryEntry[] = [];
  let stageEntry: Readonly<StableDirectoryEntry> | undefined;
  for (const entry of before.entries) {
    try {
      parseManagedEvidenceRecordDirectoryName(entry.name);
      recordEntries.push(entry);
      continue;
    } catch (error: unknown) {
      if (!(error instanceof ManagedEvidenceResourcePathError)) throw error;
    }
    try {
      parseManagedEvidenceStageDirectoryName(entry.name);
    } catch (error: unknown) {
      if (error instanceof ManagedEvidenceResourcePathError) {
        fail("tree-shape", "$managedEvidence");
      }
      throw error;
    }
    if (stageEntry !== undefined) fail("tree-shape", "$managedEvidence");
    stageEntry = entry;
  }
  if (recordEntries.length > MANAGED_EVIDENCE_RECORD_SET_MAXIMUM_RECORDS) {
    fail("capacity", "$managedEvidence");
  }
  if (readTransactionResult === null && stageEntry !== undefined) {
    fail("tree-shape", "$managedEvidence");
  }

  const records = await inspectRecords(root, recordEntries, options.signal);
  let publication:
    Readonly<ManagedEvidenceRecordSetPublicationInventory> | null = null;
  if (readTransactionResult !== null) {
    const transaction = readTransactionResult.transaction;
    const final = records.find(
      (entry) => entry.evidenceId === transaction.manifest.evidenceId,
    );
    if (stageEntry !== undefined && final !== undefined) {
      fail("transaction", "$managedEvidence");
    }
    if (
      final !== undefined &&
      final.recordTreePlanDigest !== transaction.recordTreePlanDigest
    ) {
      fail("transaction", "$managedEvidence");
    }
    if (final !== undefined) {
      await inspectCurrentFinal(
        root,
        transaction,
        final.rootNode,
        options.signal,
      );
    }
    const stageProgress = stageEntry === undefined
      ? undefined
      : await inspectStage(root, stageEntry, transaction, options.signal);
    publication = Object.freeze({
      transaction,
      transactionDigest: readTransactionResult.transactionDigest,
      transactionNode: readTransactionResult.source.node,
      evidenceId: transaction.manifest.evidenceId,
      physicalState: final !== undefined
        ? "final"
        : stageProgress === undefined
        ? "absent"
        : stageProgress.status === "complete"
        ? "stage-complete"
        : "stage-incomplete",
      ...(stageProgress === undefined ? {} : { stageProgress }),
    });
  }

  const after = await readContainer(root, before.directoryNode, options.signal);
  if (!sameDirectoryRead(before, after)) {
    fail("source-changed", "$managedEvidence");
  }
  if (readTransactionResult !== null) {
    await assertTransactionCurrent(root, readTransactionResult, options.signal);
  }
  return Object.freeze({
    recordCount: records.length,
    records,
    rootNode: after.directoryNode,
    publication,
  });
}
