import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import type { LoadedArtifactTreeFile } from "../../foundation/artifact/loaded-artifact-tree-identity.js";
import { DeterministicJsonDocumentError } from "../../foundation/data/deterministic-json-document.js";
import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import {
  type FileNodeSnapshot,
  sameFileNodeSnapshot,
} from "../../foundation/filesystem/file-node-snapshot.js";
import {
  joinPortableResourcePath,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
  type StableDirectoryReadResult,
} from "../../foundation/filesystem/stable-directory-read.js";
import {
  readStableFile,
  StableFileReadError,
} from "../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../foundation/filesystem/strict-text-file.js";
import { throwIfAborted } from "../../foundation/node/abort-signal.js";
import { type ByteCount, parseByteCount } from "../../foundation/numeric/byte-count.js";
import {
  MANAGED_EVIDENCE_MANIFEST_MAXIMUM_BYTES,
  type ManagedEvidenceManifest,
  ManagedEvidenceManifestError,
  parseManagedEvidenceManifestDocument,
} from "./managed-evidence-manifest.js";
import {
  MANAGED_EVIDENCE_RECORD_DIRECTORY_MODE,
  MANAGED_EVIDENCE_RECORD_EXECUTABLE_FILE_MODE,
  MANAGED_EVIDENCE_RECORD_FILE_MODE,
  type ManagedEvidenceRecordTreePlan,
  ManagedEvidenceRecordTreePlanError,
  planManagedEvidenceRecordTree,
} from "./managed-evidence-record-tree-plan.js";
import {
  MANAGED_EVIDENCE_MANIFEST_FILE_NAME,
  MANAGED_EVIDENCE_PAYLOAD_DIRECTORY_NAME,
  ManagedEvidenceResourcePathError,
  managedEvidenceRecordAddress,
} from "./managed-evidence-resource-paths.js";

/**
 * Wakeflow Governance / Evidence：一份immutable final record的按需物理读取。
 *
 * Metadata读取只关闭record顶层与确定性Manifest，不散列全部payload。成员读取按
 * Manifest声明的路径、长度、SHA-256和mode验证一个完整文件；整树验证才遍历并散列
 * 全部payload。Manifest v1没有分块摘要，因此本模块不提供会伪装成独立可验证内容的
 * byte-range读取。
 *
 * 本模块不判断Demand Event selector、Program/Authority关系、调用面隐私或内容真实
 * 性；上层Reading Service必须先取得健康Demand Authority，再使用本模块签发的记录
 * capability。
 */

const MANIFEST_MAXIMUM_BYTES = parseByteCount(MANAGED_EVIDENCE_MANIFEST_MAXIMUM_BYTES);

export interface LoadedManagedEvidenceRecord {
  readonly manifest: Readonly<ManagedEvidenceManifest>;
  readonly recordTreePlan: Readonly<ManagedEvidenceRecordTreePlan>;
  readonly rootNode: Readonly<FileNodeSnapshot>;
  readonly manifestNode: Readonly<FileNodeSnapshot>;
  readonly payloadNode: Readonly<FileNodeSnapshot>;
}

export interface ManagedEvidencePayloadMemberReadResult {
  readonly record: Readonly<LoadedManagedEvidenceRecord>;
  readonly member: Readonly<LoadedArtifactTreeFile>;
  readonly opaque: boolean;
  /** 调用方拥有的可变防御副本。 */
  readonly bytes: Uint8Array;
  readonly payloadVerification: "member";
}

export interface LoadManagedEvidenceRecordOptions {
  readonly expectedRootNode?: Readonly<FileNodeSnapshot>;
  readonly signal?: AbortSignal;
}

export interface ReadManagedEvidencePayloadMemberOptions {
  readonly maximumBytes: ByteCount;
  readonly signal?: AbortSignal;
}

export type ManagedEvidenceRecordReaderErrorReason =
  | "input"
  | "root-scope"
  | "not-found"
  | "node-policy"
  | "record"
  | "manifest"
  | "member-not-found"
  | "capacity"
  | "content-mismatch"
  | "source-changed"
  | "operation-failure";

/** 单记录Manifest、成员或整树读取无法稳定证明时的脱敏错误。 */
export class ManagedEvidenceRecordReaderError extends ModuleError<ManagedEvidenceRecordReaderErrorReason> {
  static override readonly code = "wakeflow-managed-evidence-record-reader";
}

const fail: Fail<ManagedEvidenceRecordReaderErrorReason> = failWith(
  ManagedEvidenceRecordReaderError,
);

const ISSUED_RECORDS = new WeakSet<object>();

function currentUserId(): bigint | null {
  if (typeof process.geteuid !== "function") return null;
  try {
    return BigInt(process.geteuid());
  } catch (cause: unknown) {
    fail("operation-failure", "$user", cause);
  }
}

function assertPrivateDirectory(node: Readonly<FileNodeSnapshot>, path: string): void {
  const userId = currentUserId();
  if (
    node.kind !== "directory" ||
    node.permissionBits !== MANAGED_EVIDENCE_RECORD_DIRECTORY_MODE ||
    (userId !== null && node.userId !== userId)
  ) {
    fail("node-policy", path);
  }
}

function assertPrivateFile(node: Readonly<FileNodeSnapshot>, mode: number, path: string): void {
  const userId = currentUserId();
  if (
    node.kind !== "file" ||
    node.permissionBits !== mode ||
    node.linkCount !== 1n ||
    (userId !== null && node.userId !== userId)
  ) {
    fail("node-policy", path);
  }
}

function mapDirectoryError(error: StableDirectoryReadError): never {
  if (error.reason === "root-scope") fail("root-scope", "$root");
  if (error.reason === "not-found") fail("not-found", "$record");
  if (error.reason === "source-changed" || error.reason === "expectation-changed") {
    fail("source-changed", "$record");
  }
  if (
    error.reason === "symlink" ||
    error.reason === "not-directory" ||
    error.reason === "too-many-entries"
  ) {
    fail("record", "$record");
  }
  fail("operation-failure", "$record", error);
}

async function readRecordRoot(
  root: RootedDirectory,
  recordRootRef: PortableResourcePath,
  expectedNode: Readonly<FileNodeSnapshot> | undefined,
  signal: AbortSignal | undefined,
): Promise<Readonly<StableDirectoryReadResult<PortableResourcePath>>> {
  try {
    return await readStableResourceDirectory(root, recordRootRef, {
      maximumEntries: 2,
      ...(expectedNode === undefined ? {} : { expectedNode }),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError) mapDirectoryError(error);
    throw error;
  }
}

function exactRecordRoot(
  read: Readonly<StableDirectoryReadResult<PortableResourcePath>>,
): Readonly<{
  readonly manifestNode: Readonly<FileNodeSnapshot>;
  readonly payloadNode: Readonly<FileNodeSnapshot>;
}> {
  const manifest = read.entries[0];
  const payload = read.entries[1];
  if (
    read.entries.length !== 2 ||
    manifest?.name !== MANAGED_EVIDENCE_MANIFEST_FILE_NAME ||
    payload?.name !== MANAGED_EVIDENCE_PAYLOAD_DIRECTORY_NAME
  ) {
    fail("record", "$record");
  }
  assertPrivateDirectory(read.directoryNode, "$record");
  assertPrivateFile(manifest.node, MANAGED_EVIDENCE_RECORD_FILE_MODE, "$record/manifest");
  assertPrivateDirectory(payload.node, "$record/payload");
  return Object.freeze({
    manifestNode: manifest.node,
    payloadNode: payload.node,
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

function mapManifestReadError(error: unknown): never {
  if (error instanceof StableFileReadError) {
    if (error.reason === "root-scope") fail("root-scope", "$root");
    if (error.reason === "source-changed" || error.reason === "expectation-changed") {
      fail("source-changed", "$record/manifest");
    }
    fail("manifest", "$record/manifest");
  }
  if (error instanceof StrictTextFileError || error instanceof DeterministicJsonDocumentError) {
    fail("manifest", "$record/manifest");
  }
  throw error;
}

function issueRecord(value: LoadedManagedEvidenceRecord): Readonly<LoadedManagedEvidenceRecord> {
  const record = Object.freeze(value);
  ISSUED_RECORDS.add(record);
  return record;
}

/** 只有本Reader加载并签发的record才可读取成员；副本或调用方自建的record不算。 */
function assertRecordCapability(record: Readonly<LoadedManagedEvidenceRecord>): void {
  if (!ISSUED_RECORDS.has(record)) fail("input", "$record");
}

function sameRecord(
  left: Readonly<LoadedManagedEvidenceRecord>,
  right: Readonly<LoadedManagedEvidenceRecord>,
): boolean {
  return (
    left.manifest.manifestDigest === right.manifest.manifestDigest &&
    left.recordTreePlan.planDigest === right.recordTreePlan.planDigest &&
    sameFileNodeSnapshot(left.rootNode, right.rootNode) &&
    sameFileNodeSnapshot(left.manifestNode, right.manifestNode) &&
    sameFileNodeSnapshot(left.payloadNode, right.payloadNode)
  );
}

/** 稳定加载一份final record的Manifest与顶层节点；payload内容保持deferred。 */
export async function loadManagedEvidenceRecord(
  rootValue: RootedDirectory,
  evidenceId: WakeflowDurableId<"evidence">,
  options: LoadManagedEvidenceRecordOptions = {},
): Promise<Readonly<LoadedManagedEvidenceRecord>> {
  throwIfAborted(options.signal);
  let address: ReturnType<typeof managedEvidenceRecordAddress>;
  try {
    address = managedEvidenceRecordAddress(evidenceId);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceResourcePathError) {
      fail("input", "$evidenceId", error);
    }
    throw error;
  }
  const before = await readRecordRoot(
    rootValue,
    address.recordRootRef,
    options.expectedRootNode,
    options.signal,
  );
  const topLevel = exactRecordRoot(before);
  let read: Awaited<ReturnType<typeof readDeterministicJsonFile>>;
  try {
    read = await readDeterministicJsonFile(rootValue, address.manifestRef, {
      maximumBytes: MANIFEST_MAXIMUM_BYTES,
      expectedNode: topLevel.manifestNode,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error: unknown) {
    mapManifestReadError(error);
  }
  let manifest: Readonly<ManagedEvidenceManifest>;
  try {
    manifest = parseManagedEvidenceManifestDocument(read.text);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceManifestError) {
      fail("manifest", "$record/manifest", error);
    }
    throw error;
  }
  if (manifest.evidenceId !== evidenceId) {
    fail("manifest", "$record/manifest/evidenceId");
  }
  let recordTreePlan: Readonly<ManagedEvidenceRecordTreePlan>;
  try {
    recordTreePlan = planManagedEvidenceRecordTree(manifest);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceRecordTreePlanError) {
      fail("record", "$record/manifest", error);
    }
    throw error;
  }
  if (read.digest !== recordTreePlan.manifestDocumentDigest) {
    fail("manifest", "$record/manifest");
  }
  const after = await readRecordRoot(
    rootValue,
    address.recordRootRef,
    before.directoryNode,
    options.signal,
  );
  const afterTopLevel = exactRecordRoot(after);
  if (!sameDirectoryRead(before, after)) {
    fail("source-changed", "$record");
  }
  return issueRecord({
    manifest,
    recordTreePlan,
    rootNode: after.directoryNode,
    manifestNode: afterTopLevel.manifestNode,
    payloadNode: afterTopLevel.payloadNode,
  });
}

async function requireCurrentRecord(
  root: RootedDirectory,
  record: Readonly<LoadedManagedEvidenceRecord>,
  signal: AbortSignal | undefined,
): Promise<Readonly<LoadedManagedEvidenceRecord>> {
  const current = await loadManagedEvidenceRecord(root, record.manifest.evidenceId, {
    expectedRootNode: record.rootNode,
    ...(signal === undefined ? {} : { signal }),
  });
  if (!sameRecord(record, current)) fail("source-changed", "$record");
  return current;
}

function memberDescriptor(
  record: Readonly<LoadedManagedEvidenceRecord>,
  memberRef: PortableResourcePath,
): Readonly<LoadedArtifactTreeFile> {
  const descriptor = record.manifest.payload.treeManifest.files.find(
    (candidate) => candidate.ref === memberRef,
  );
  if (descriptor === undefined) fail("member-not-found", "$memberRef");
  return descriptor;
}

function mapMemberReadError(error: StableFileReadError): never {
  if (error.reason === "root-scope") fail("root-scope", "$root");
  if (error.reason === "too-large") fail("capacity", "$member");
  if (error.reason === "source-changed" || error.reason === "expectation-changed") {
    fail("source-changed", "$member");
  }
  if (error.reason === "not-found" || error.reason === "symlink" || error.reason === "not-file") {
    fail("content-mismatch", "$member");
  }
  fail("operation-failure", "$member", error);
}

/** 按Manifest descriptor读取并验证一个完整payload member。 */
export async function readManagedEvidencePayloadMember(
  rootValue: RootedDirectory,
  recordValue: Readonly<LoadedManagedEvidenceRecord>,
  memberRef: PortableResourcePath,
  options: ReadManagedEvidencePayloadMemberOptions,
): Promise<Readonly<ManagedEvidencePayloadMemberReadResult>> {
  assertRecordCapability(recordValue);
  throwIfAborted(options.signal);
  const before = await requireCurrentRecord(rootValue, recordValue, options.signal);
  const member = memberDescriptor(before, memberRef);
  if (member.bytes > options.maximumBytes) fail("capacity", "$member");
  const memberPath = joinPortableResourcePath(
    managedEvidenceRecordAddress(before.manifest.evidenceId).payloadRootRef,
    memberRef,
    "$memberPath",
  );
  let read: Awaited<ReturnType<typeof readStableFile>>;
  try {
    read = await readStableFile(rootValue, memberPath, {
      maximumBytes: options.maximumBytes,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) mapMemberReadError(error);
    throw error;
  }
  const expectedMode = member.executable
    ? MANAGED_EVIDENCE_RECORD_EXECUTABLE_FILE_MODE
    : MANAGED_EVIDENCE_RECORD_FILE_MODE;
  assertPrivateFile(read.node, expectedMode, "$member");
  if (read.byteCount !== member.bytes || read.digest !== member.digest) {
    fail("content-mismatch", "$member");
  }
  const current = await requireCurrentRecord(rootValue, before, options.signal);
  return Object.freeze({
    record: current,
    member,
    opaque: current.manifest.contentReview.opaqueFileRefs.includes(member.ref),
    bytes: read.bytes,
    payloadVerification: "member" as const,
  });
}
