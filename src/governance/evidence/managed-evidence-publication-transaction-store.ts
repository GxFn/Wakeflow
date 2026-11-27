import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { DeterministicJsonDocumentError } from "../../foundation/data/deterministic-json-document.js";
import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import {
  type DeterministicJsonFileResult,
  readDeterministicJsonFile,
} from "../../foundation/filesystem/deterministic-json-file.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import {
  ExactRegularFileUnlinkError,
  type ExactRegularFileUnlinkReceipt,
  unlinkRegularFileExactly,
} from "../../foundation/filesystem/exact-regular-file-unlink.js";
import {
  type FileNodeSnapshot,
  sameFileNodeSnapshot,
} from "../../foundation/filesystem/file-node-snapshot.js";
import { isPrivateFile } from "../../foundation/filesystem/private-node-policy.js";
import {
  type RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import { StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../foundation/filesystem/strict-text-file.js";
import { throwIfAborted } from "../../foundation/node/abort-signal.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import {
  admitWakeflowResourceOperation,
  WakeflowResourceProcessingContractError,
} from "../../foundation/resource/resource-processing-contract.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  computeManagedEvidencePublicationTransactionDigest,
  MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_MAXIMUM_BYTES,
  type ManagedEvidencePublicationTransaction,
  ManagedEvidencePublicationTransactionError,
  parseManagedEvidencePublicationTransaction,
  parseManagedEvidencePublicationTransactionDocument,
  renderManagedEvidencePublicationTransaction,
} from "./managed-evidence-publication-transaction.js";
import { createManagedEvidencePublicationTransactionResourceDeclaration } from "./managed-evidence-resource-catalog.js";
import { MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF } from "./managed-evidence-resource-paths.js";

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
  | "recovery-required"
  | "operation-failure";

/** Journal生命周期无法安全证明时的稳定、脱敏错误。 */
export class ManagedEvidencePublicationTransactionStoreError extends ModuleError<ManagedEvidencePublicationTransactionStoreErrorReason> {
  static override readonly code = "wakeflow-managed-evidence-publication-transaction-store";
}

const fail: Fail<ManagedEvidencePublicationTransactionStoreErrorReason> = failWith(
  ManagedEvidencePublicationTransactionStoreError,
);

const ISSUED_STORED_TRANSACTIONS = new WeakSet<object>();
const TRANSACTION_MAXIMUM_BYTES = parseByteCount(
  MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_MAXIMUM_BYTES,
);

function admitMutation(
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
  recipe: "exclusive-create" | "exact-retire",
): void {
  const declaration = createManagedEvidencePublicationTransactionResourceDeclaration(
    transaction.manifest.demandId,
  );
  try {
    admitWakeflowResourceOperation(declaration.processing, recipe);
  } catch (error: unknown) {
    if (error instanceof WakeflowResourceProcessingContractError) {
      fail("operation-failure", "$catalog", error);
    }
    throw error;
  }
}

async function journalNodeOrNull(
  root: RootedDirectory,
): Promise<Readonly<FileNodeSnapshot> | null> {
  try {
    const resource = await root.inspectResourceOrNull(
      MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF,
      "$transaction",
    );
    return resource?.node ?? null;
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root", error);
    throw error;
  }
}

function mapReadError(error: unknown): never {
  if (error instanceof StableFileReadError) {
    if (error.reason === "root-scope" || error.reason === "unsupported-platform") {
      fail("root-scope", "$root");
    }
    if (error.reason === "too-large") fail("capacity", "$transaction");
    fail("conflict", "$transaction");
  }
  if (error instanceof StrictTextFileError || error instanceof DeterministicJsonDocumentError) {
    fail("conflict", "$transaction");
  }
  throw error;
}

async function readStoredAtNode(
  root: RootedDirectory,
  expectedNode: Readonly<FileNodeSnapshot>,
  signal: AbortSignal | undefined,
): Promise<Readonly<StoredManagedEvidencePublicationTransaction>> {
  if (!isPrivateFile(expectedNode)) fail("conflict", "$transaction");
  let source: Awaited<ReturnType<typeof readDeterministicJsonFile>>;
  try {
    source = await readDeterministicJsonFile(root, MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF, {
      maximumBytes: TRANSACTION_MAXIMUM_BYTES,
      expectedNode,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    mapReadError(error);
  }
  let transaction: Readonly<ManagedEvidencePublicationTransaction>;
  try {
    transaction = parseManagedEvidencePublicationTransactionDocument(source.text);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidencePublicationTransactionError) {
      fail("conflict", "$transaction", error);
    }
    throw error;
  }
  const stored = Object.freeze({
    transaction,
    transactionDigest: computeManagedEvidencePublicationTransactionDigest(transaction),
    source,
  });
  ISSUED_STORED_TRANSACTIONS.add(stored);
  return stored;
}

function sameTransaction(
  left: Readonly<ManagedEvidencePublicationTransaction>,
  right: Readonly<ManagedEvidencePublicationTransaction>,
): boolean {
  return (
    renderManagedEvidencePublicationTransaction(left) ===
    renderManagedEvidencePublicationTransaction(right)
  );
}

/** 读取当前固定journal；严格absent返回null，非法或漂移资源失败关闭。 */
export async function loadManagedEvidencePublicationTransaction(
  root: RootedDirectory,
  options: ManagedEvidencePublicationTransactionStoreOptions = {},
): Promise<Readonly<StoredManagedEvidencePublicationTransaction> | null> {
  throwIfAborted(options.signal);
  const node = await journalNodeOrNull(root);
  return node === null ? null : readStoredAtNode(root, node, options.signal);
}

/** 读取并证明固定journal仍绑定exact Transaction与可选原始node。 */
export async function requireCurrentManagedEvidencePublicationTransaction(
  root: RootedDirectory,
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
  expectedNode?: Readonly<FileNodeSnapshot>,
  options: ManagedEvidencePublicationTransactionStoreOptions = {},
): Promise<Readonly<StoredManagedEvidencePublicationTransaction>> {
  throwIfAborted(options.signal);
  const stored = await loadManagedEvidencePublicationTransaction(
    root,
    options.signal === undefined ? undefined : { signal: options.signal },
  );
  if (
    stored === null ||
    stored.transactionDigest !== computeManagedEvidencePublicationTransactionDigest(transaction) ||
    !sameTransaction(stored.transaction, transaction) ||
    (expectedNode !== undefined && !sameFileNodeSnapshot(stored.source.node, expectedNode))
  ) {
    fail("conflict", "$transaction");
  }
  return stored;
}

function mapCreateError(error: DurableAtomicFileWriteError): never {
  if (error.reason === "root-scope") fail("root-scope", "$root");
  if (error.reason === "capacity") fail("capacity", "$transaction");
  if (error.reason === "target-exists") {
    fail("transaction-exists", "$transaction");
  }
  if (error.commitUncertain || error.reason === "stage-recovery-required") {
    fail("recovery-required", "$transaction");
  }
  fail("operation-failure", "$transaction", error);
}

/** 严格absent-only创建并同步完整journal；现存exact journal也必须走显式恢复。 */
export async function createManagedEvidencePublicationTransactionJournal(
  root: RootedDirectory,
  transactionValue: unknown,
  options: ManagedEvidencePublicationTransactionStoreOptions = {},
): Promise<Readonly<StoredManagedEvidencePublicationTransaction>> {
  throwIfAborted(options.signal);
  let transaction: Readonly<ManagedEvidencePublicationTransaction>;
  try {
    transaction = parseManagedEvidencePublicationTransaction(transactionValue);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidencePublicationTransactionError) {
      fail("input", "$transaction", error);
    }
    throw error;
  }
  admitMutation(transaction, "exclusive-create");
  const text = renderManagedEvidencePublicationTransaction(transaction);
  const bytes = encodeUtf8(text, "$transaction");
  if (bytes.byteLength > MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_MAXIMUM_BYTES) {
    fail("capacity", "$transaction");
  }
  let publication: Awaited<ReturnType<typeof createFileAtomically>>;
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
      fail("recovery-required", "$transaction", error);
    }
    throw error;
  }
  if (!sameTransaction(stored.transaction, transaction)) {
    fail("recovery-required", "$transaction");
  }
  return stored;
}

/** 只有本Store读证后签发、尚未退休的记录才持有退休能力；副本与已退休的记录不算。 */
function assertStoredCapability(
  stored: Readonly<StoredManagedEvidencePublicationTransaction>,
): void {
  if (!ISSUED_STORED_TRANSACTIONS.has(stored)) fail("input", "$stored");
}

/** 退役之前按原节点重读日志：根作用域原样抛，其余读不出都是与当前状态冲突；中止原样上抛。 */
async function readCurrentForRetirement(
  root: RootedDirectory,
  node: Readonly<FileNodeSnapshot>,
  signal: AbortSignal | undefined,
): Promise<Readonly<StoredManagedEvidencePublicationTransaction>> {
  try {
    return await readStoredAtNode(root, node, signal);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidencePublicationTransactionStoreError) {
      if (error.reason === "root-scope") throw error;
      fail("conflict", "$transaction", error);
    }
    throw error;
  }
}

/** 按节点精确删除日志文件；删不掉而又不是中止或根作用域的，一律需要恢复。 */
async function unlinkJournalExactly(
  root: RootedDirectory,
  expectedNode: Readonly<FileNodeSnapshot>,
  signal: AbortSignal | undefined,
): Promise<Readonly<ExactRegularFileUnlinkReceipt>> {
  try {
    return await unlinkRegularFileExactly(root, MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF, {
      expectedNode,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof ExactRegularFileUnlinkError) {
      if (error.reason === "root-scope") fail("root-scope", "$root", error);
      fail("recovery-required", "$transaction", error);
    }
    throw error;
  }
}

/** 只退休Store重新读证后的exact journal；缺失、替换或提交不确定均不伪造成功。 */
export async function retireManagedEvidencePublicationTransactionJournal(
  root: RootedDirectory,
  storedValue: Readonly<StoredManagedEvidencePublicationTransaction>,
  options: ManagedEvidencePublicationTransactionStoreOptions = {},
): Promise<Readonly<ManagedEvidencePublicationTransactionRetirementReceipt>> {
  assertStoredCapability(storedValue);
  throwIfAborted(options.signal);
  admitMutation(storedValue.transaction, "exact-retire");
  const current = await readCurrentForRetirement(root, storedValue.source.node, options.signal);
  if (
    current.transactionDigest !== storedValue.transactionDigest ||
    !sameFileNodeSnapshot(current.source.node, storedValue.source.node) ||
    !sameTransaction(current.transaction, storedValue.transaction)
  ) {
    fail("conflict", "$transaction");
  }
  const retirement = await unlinkJournalExactly(root, current.source.node, options.signal);
  ISSUED_STORED_TRANSACTIONS.delete(storedValue);
  return Object.freeze({
    transactionDigest: storedValue.transactionDigest,
    retirement,
  });
}
