import { types } from "node:util";

import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  DeterministicJsonDocumentError,
} from "../../foundation/data/deterministic-json-document.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import {
  readDeterministicJsonFile,
  type DeterministicJsonFileResult,
} from "../../foundation/filesystem/deterministic-json-file.js";
import {
  unlinkRegularFileExactly,
  ExactRegularFileUnlinkError,
  type ExactRegularFileUnlinkReceipt,
} from "../../foundation/filesystem/exact-regular-file-unlink.js";
import {
  sameFileNodeSnapshot,
  type FileNodeSnapshot,
} from "../../foundation/filesystem/file-node-snapshot.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import { StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import {
  admitWakeflowResourceOperation,
  WakeflowResourceProcessingContractError,
} from "../../foundation/resource/resource-processing-contract.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  createManagedEvidencePublicationTransactionResourceDeclaration,
} from "./managed-evidence-resource-catalog.js";
import {
  computeManagedEvidencePublicationTransactionDigest,
  parseManagedEvidencePublicationTransaction,
  parseManagedEvidencePublicationTransactionDocument,
  renderManagedEvidencePublicationTransaction,
  MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_MAXIMUM_BYTES,
  ManagedEvidencePublicationTransactionError,
  type ManagedEvidencePublicationTransaction,
} from "./managed-evidence-publication-transaction.js";
import {
  MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF,
} from "./managed-evidence-resource-paths.js";

/**
 * Wakeflow Governance / Evidence：固定Publication Transaction journal的耐久Store。
 *
 * Store只拥有Demand根内一个0600、single-link、absent-only journal槽位。正常create
 * 遇到任何现存文件都会拒绝并路由显式恢复；load稳定读取并签发进程内retire能力；
 * retire在提交前重读exact文档，再按节点预期耐久unlink。
 *
 * 本模块不保存可变phase、不创建Managed Evidence容器或stage、不读取原source、
 * 不追加Event，也不判断何时允许退休。Event前取消与Event后前向完成仍由未来
 * Publication Application根据Transaction、Inventory与Event Store共同决定。
 */

export const MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_FILE_MODE = 0o600;

export interface StoredManagedEvidencePublicationTransaction {
  readonly transaction: Readonly<ManagedEvidencePublicationTransaction>;
  readonly transactionDigest: Sha256Digest;
  readonly source: Readonly<DeterministicJsonFileResult>;
}

export interface ManagedEvidencePublicationTransactionRetirementReceipt {
  readonly transactionDigest: Sha256Digest;
  readonly retirement: Readonly<ExactRegularFileUnlinkReceipt>;
}

export interface ManagedEvidencePublicationTransactionStoreOptions {
  readonly signal?: AbortSignal;
}

export type ManagedEvidencePublicationTransactionStoreErrorReason =
  | "input"
  | "root-scope"
  | "transaction-exists"
  | "conflict"
  | "capacity"
  | "aborted"
  | "recovery-required"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Managed evidence publication transaction store input is invalid.",
  "root-scope": "Managed evidence publication transaction store escaped its Demand root.",
  "transaction-exists": "Managed evidence publication transaction journal already exists.",
  conflict: "Managed evidence publication transaction journal is invalid or changed.",
  capacity: "Managed evidence publication transaction journal exceeds its capacity.",
  aborted: "Managed evidence publication transaction store operation was aborted.",
  "recovery-required": "Managed evidence publication transaction journal requires explicit recovery.",
  "operation-failure": "Managed evidence publication transaction store operation failed.",
} as const satisfies Readonly<
  Record<ManagedEvidencePublicationTransactionStoreErrorReason, string>
>;

/** Journal生命周期无法安全证明时的稳定、脱敏错误。 */
export class ManagedEvidencePublicationTransactionStoreError extends Error {
  override readonly name = "ManagedEvidencePublicationTransactionStoreError";
  readonly code =
    "wakeflow-managed-evidence-publication-transaction-store" as const;
  readonly reason: ManagedEvidencePublicationTransactionStoreErrorReason;
  readonly path: string;

  constructor(
    reason: ManagedEvidencePublicationTransactionStoreErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedOptions {
  readonly signal: AbortSignal | undefined;
}

const ISSUED_STORED_TRANSACTIONS = new WeakSet<object>();
const TRANSACTION_MAXIMUM_BYTES = parseByteCount(
  MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_MAXIMUM_BYTES,
);

function fail(
  reason: ManagedEvidencePublicationTransactionStoreErrorReason,
  path: string,
): never {
  throw new ManagedEvidencePublicationTransactionStoreError(reason, path);
}

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    !(value instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
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
    Object.keys(record).some((key) => key !== "signal") ||
    (record.signal !== undefined &&
      (typeof record.signal !== "object" ||
        record.signal === null ||
        types.isProxy(record.signal) ||
        !(record.signal instanceof AbortSignal)))
  ) {
    fail("input", "$options");
  }
  return Object.freeze({
    signal: record.signal as AbortSignal | undefined,
  });
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted", "$signal");
}

function currentUserId(): bigint | null {
  return typeof process.geteuid === "function"
    ? BigInt(process.geteuid())
    : null;
}

function assertJournalNode(node: Readonly<FileNodeSnapshot>): void {
  const userId = currentUserId();
  if (
    node.kind !== "file" ||
    node.permissionBits !== MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_FILE_MODE ||
    node.linkCount !== 1n ||
    (userId !== null && node.userId !== userId)
  ) {
    fail("conflict", "$transaction");
  }
}

function parseExpectedNode(
  value: unknown,
): Readonly<FileNodeSnapshot> | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    !Object.isFrozen(value)
  ) {
    fail("input", "$expectedNode");
  }
  try {
    sameFileNodeSnapshot(
      value as Readonly<FileNodeSnapshot>,
      value as Readonly<FileNodeSnapshot>,
    );
  } catch {
    fail("input", "$expectedNode");
  }
  return value as Readonly<FileNodeSnapshot>;
}

function admitMutation(
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
  recipe: "exclusive-create" | "exact-retire",
): void {
  const declaration =
    createManagedEvidencePublicationTransactionResourceDeclaration(
      transaction.manifest.demandId,
    );
  try {
    admitWakeflowResourceOperation(declaration.processing, recipe);
  } catch (error: unknown) {
    if (error instanceof WakeflowResourceProcessingContractError) {
      fail("operation-failure", "$catalog");
    }
    throw error;
  }
}

async function journalNodeOrNull(
  root: RootedDirectory,
): Promise<Readonly<FileNodeSnapshot> | null> {
  try {
    return (
      await root.inspectExistingResource(
        MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF,
        "$transaction",
      )
    ).node;
  } catch (error: unknown) {
    if (
      error instanceof RootedDirectoryError &&
      error.reason === "resource-not-found"
    ) {
      return null;
    }
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root");
    throw error;
  }
}

function mapReadError(error: unknown): never {
  if (error instanceof StableFileReadError) {
    if (error.reason === "aborted") fail("aborted", "$signal");
    if (
      error.reason === "root-scope" ||
      error.reason === "unsupported-platform"
    ) {
      fail("root-scope", "$root");
    }
    if (error.reason === "too-large") fail("capacity", "$transaction");
    fail("conflict", "$transaction");
  }
  if (
    error instanceof StrictTextFileError ||
    error instanceof DeterministicJsonDocumentError
  ) {
    fail("conflict", "$transaction");
  }
  throw error;
}

async function readStoredAtNode(
  root: RootedDirectory,
  expectedNode: Readonly<FileNodeSnapshot>,
  signal: AbortSignal | undefined,
): Promise<Readonly<StoredManagedEvidencePublicationTransaction>> {
  assertJournalNode(expectedNode);
  let source;
  try {
    source = await readDeterministicJsonFile(
      root,
      MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF,
      {
        maximumBytes: TRANSACTION_MAXIMUM_BYTES,
        expectedNode,
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch (error: unknown) {
    mapReadError(error);
  }
  let transaction: Readonly<ManagedEvidencePublicationTransaction>;
  try {
    transaction = parseManagedEvidencePublicationTransactionDocument(
      source.text,
    );
  } catch (error: unknown) {
    if (error instanceof ManagedEvidencePublicationTransactionError) {
      fail("conflict", "$transaction");
    }
    throw error;
  }
  const stored = Object.freeze({
    transaction,
    transactionDigest:
      computeManagedEvidencePublicationTransactionDigest(transaction),
    source,
  });
  ISSUED_STORED_TRANSACTIONS.add(stored);
  return stored;
}

function sameTransaction(
  left: Readonly<ManagedEvidencePublicationTransaction>,
  right: Readonly<ManagedEvidencePublicationTransaction>,
): boolean {
  return renderManagedEvidencePublicationTransaction(left) ===
    renderManagedEvidencePublicationTransaction(right);
}

/** 读取当前固定journal；严格absent返回null，非法或漂移资源失败关闭。 */
export async function loadManagedEvidencePublicationTransaction(
  root: RootedDirectory,
  optionsValue: ManagedEvidencePublicationTransactionStoreOptions = {},
): Promise<Readonly<StoredManagedEvidencePublicationTransaction> | null> {
  assertRoot(root);
  const options = parseOptions(optionsValue);
  assertNotAborted(options.signal);
  const node = await journalNodeOrNull(root);
  return node === null
    ? null
    : readStoredAtNode(root, node, options.signal);
}

/** 读取并证明固定journal仍绑定exact Transaction与可选原始node。 */
export async function requireCurrentManagedEvidencePublicationTransaction(
  root: RootedDirectory,
  transactionValue: unknown,
  expectedNodeValue?: Readonly<FileNodeSnapshot>,
  optionsValue: ManagedEvidencePublicationTransactionStoreOptions = {},
): Promise<Readonly<StoredManagedEvidencePublicationTransaction>> {
  assertRoot(root);
  const options = parseOptions(optionsValue);
  assertNotAborted(options.signal);
  let transaction: Readonly<ManagedEvidencePublicationTransaction>;
  try {
    transaction = parseManagedEvidencePublicationTransaction(transactionValue);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidencePublicationTransactionError) {
      fail("input", "$transaction");
    }
    throw error;
  }
  const expectedNode = parseExpectedNode(expectedNodeValue);
  const stored = await loadManagedEvidencePublicationTransaction(
    root,
    options.signal === undefined ? undefined : { signal: options.signal },
  );
  if (
    stored === null ||
    stored.transactionDigest !==
      computeManagedEvidencePublicationTransactionDigest(transaction) ||
    !sameTransaction(stored.transaction, transaction) ||
    (expectedNode !== undefined &&
      !sameFileNodeSnapshot(stored.source.node, expectedNode))
  ) {
    fail("conflict", "$transaction");
  }
  return stored;
}

function mapCreateError(error: DurableAtomicFileWriteError): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "root-scope") fail("root-scope", "$root");
  if (error.reason === "capacity") fail("capacity", "$transaction");
  if (error.reason === "target-exists") {
    fail("transaction-exists", "$transaction");
  }
  if (
    error.reason === "commit-uncertain" ||
    error.reason === "durability-failure" ||
    error.reason === "stage-cleanup-failure" ||
    error.reason === "stage-recovery-required" ||
    error.reason === "close-failure"
  ) {
    fail("recovery-required", "$transaction");
  }
  fail("operation-failure", "$transaction");
}

/** 严格absent-only创建并同步完整journal；现存exact journal也必须走显式恢复。 */
export async function createManagedEvidencePublicationTransactionJournal(
  root: RootedDirectory,
  transactionValue: unknown,
  optionsValue: ManagedEvidencePublicationTransactionStoreOptions = {},
): Promise<Readonly<StoredManagedEvidencePublicationTransaction>> {
  assertRoot(root);
  const options = parseOptions(optionsValue);
  assertNotAborted(options.signal);
  let transaction: Readonly<ManagedEvidencePublicationTransaction>;
  try {
    transaction = parseManagedEvidencePublicationTransaction(transactionValue);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidencePublicationTransactionError) {
      fail("input", "$transaction");
    }
    throw error;
  }
  admitMutation(transaction, "exclusive-create");
  const text = renderManagedEvidencePublicationTransaction(transaction);
  const bytes = encodeUtf8(text, "$transaction");
  if (
    bytes.byteLength >
      MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_MAXIMUM_BYTES
  ) {
    fail("capacity", "$transaction");
  }
  let publication;
  try {
    publication = await createFileAtomically(
      root,
      MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF,
      bytes,
      {
        mode: MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_FILE_MODE,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) mapCreateError(error);
    throw error;
  }
  let stored: Readonly<StoredManagedEvidencePublicationTransaction>;
  try {
    // journal已经提交后不再让取消遮蔽readback；失败统一要求显式恢复。
    stored = await readStoredAtNode(root, publication.node, undefined);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidencePublicationTransactionStoreError) {
      fail("recovery-required", "$transaction");
    }
    throw error;
  }
  if (!sameTransaction(stored.transaction, transaction)) {
    fail("recovery-required", "$transaction");
  }
  return stored;
}

function assertStoredCapability(
  value: unknown,
): asserts value is Readonly<StoredManagedEvidencePublicationTransaction> {
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    !Object.isFrozen(value) ||
    !ISSUED_STORED_TRANSACTIONS.has(value)
  ) {
    fail("input", "$stored");
  }
}

/** 只退休Store重新读证后的exact journal；缺失、替换或提交不确定均不伪造成功。 */
export async function retireManagedEvidencePublicationTransactionJournal(
  root: RootedDirectory,
  storedValue: unknown,
  optionsValue: ManagedEvidencePublicationTransactionStoreOptions = {},
): Promise<Readonly<ManagedEvidencePublicationTransactionRetirementReceipt>> {
  assertRoot(root);
  const options = parseOptions(optionsValue);
  assertStoredCapability(storedValue);
  assertNotAborted(options.signal);
  admitMutation(storedValue.transaction, "exact-retire");
  let current: Readonly<StoredManagedEvidencePublicationTransaction>;
  try {
    current = await readStoredAtNode(
      root,
      storedValue.source.node,
      options.signal,
    );
  } catch (error: unknown) {
    if (error instanceof ManagedEvidencePublicationTransactionStoreError) {
      if (error.reason === "aborted") throw error;
      if (error.reason === "root-scope") throw error;
      fail("conflict", "$transaction");
    }
    throw error;
  }
  if (
    current.transactionDigest !== storedValue.transactionDigest ||
    !sameFileNodeSnapshot(current.source.node, storedValue.source.node) ||
    !sameTransaction(current.transaction, storedValue.transaction)
  ) {
    fail("conflict", "$transaction");
  }
  let retirement: Readonly<ExactRegularFileUnlinkReceipt>;
  try {
    retirement = await unlinkRegularFileExactly(
      root,
      MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF,
      {
        expectedNode: current.source.node,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof ExactRegularFileUnlinkError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "root-scope") fail("root-scope", "$root");
      fail("recovery-required", "$transaction");
    }
    throw error;
  }
  ISSUED_STORED_TRANSACTIONS.delete(storedValue);
  return Object.freeze({
    transactionDigest: storedValue.transactionDigest,
    retirement,
  });
}
