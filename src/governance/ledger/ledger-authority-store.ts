import { types } from "node:util";

import type {
  WakeflowLedgerAuthorityMemberReference as MemberReferenceWire,
} from "../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import {
  WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
} from "../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import {
  computeSha256Digest,
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  DeterministicJsonDocumentError,
} from "../../foundation/data/deterministic-json-document.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import {
  recoverDurableAtomicFileStagesInDirectory,
  DurableAtomicFileStageRecoveryError,
} from "../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import {
  materializeDirectoryPath,
  DurableDirectoryMaterializationError,
} from "../../foundation/filesystem/durable-directory-materialization.js";
import {
  readDeterministicJsonFile,
  type DeterministicJsonFileResult,
} from "../../foundation/filesystem/deterministic-json-file.js";
import {
  unlinkRegularFileExactly,
  ExactRegularFileUnlinkError,
} from "../../foundation/filesystem/exact-regular-file-unlink.js";
import type {
  FileNodeSnapshot,
} from "../../foundation/filesystem/file-node-snapshot.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  inspectRootedExclusiveFileLock,
  retireRootedExclusiveFileLockResidue,
  RootedExclusiveFileLockError,
  withRootedExclusiveFileLock,
} from "../../foundation/filesystem/rooted-exclusive-file-lock.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
} from "../../foundation/filesystem/stable-directory-read.js";
import {
  readStableFile,
  StableFileReadError,
  type StableFileSource,
} from "../../foundation/filesystem/stable-file-read.js";
import {
  readStableResourceTree,
  StableResourceTreeReadError,
} from "../../foundation/filesystem/stable-resource-tree-read.js";
import {
  StrictTextFileError,
} from "../../foundation/filesystem/strict-text-file.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../foundation/identity/wakeflow-durable-id.js";
import {
  parseByteCount,
  type ByteCount,
} from "../../foundation/numeric/byte-count.js";
import {
  createRuntimeJsonSchemaValidator,
} from "../../foundation/schema/runtime-json-schema.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  computeLedgerAuthorityRecordDigest,
  parseLedgerAuthorityRecord,
  parseLedgerAuthorityRecordDocument,
  renderLedgerAuthorityRecord,
  LedgerAuthorityRecordError,
  type ConfirmationRecord,
  type LedgerAuthorityDocument,
  type LedgerAuthorityRecord,
  type RequirementRecord,
} from "./ledger-authority-record.js";
import {
  confirmationRootRef,
  ledgerAuthorityFamily,
  ledgerAuthorityMemberRef,
  ledgerAuthorityRecordId,
  ledgerAuthorityRecordRef,
  ledgerAuthorityRootRef,
  ledgerRecordPublicationRef,
  requirementRootRef,
  LEDGER_AUTHORITY_LOCK_REF,
  LEDGER_CONFIRMATIONS_ROOT_REF,
  LEDGER_REQUIREMENTS_ROOT_REF,
  LEDGER_TRANSACTIONS_ROOT_REF,
  type LedgerAuthorityFamily,
} from "./ledger-authority-paths.js";
import {
  assertLedgerRecordPublicationMatches,
  createLedgerRecordPublication,
  decodeLedgerRecordPublication,
  parseLedgerRecordPublicationDocument,
  renderLedgerRecordPublication,
  LedgerRecordPublicationError,
  type LedgerRecordPublication,
} from "./ledger-record-publication.js";

/**
 * Wakeflow Governance / Ledger：Requirement 与 Confirmation authority 的根作用域
 * immutable Store。
 *
 * Store 持有一个已经打开的 Ledger RootedDirectory，使用 Ledger 专属 lock 和短期
 * self-contained publication journal，把 member bytes 与 `record.json` 以 absent-only 方式发布；
 * record 永远最后创建，journal 永远最后退休。正常 load 在 transactions 非空时
 * fail closed；journal 自带 bounded exact bytes，可在调用方输入消失后继续 crash prefix。
 *
 * 本类不拥有 Demand Event Sourcing、Requirement/Confirmation 业务生成时机、全局
 * Ledger 索引或 archive。使用 class 是因为实例确实持有 root、容量与协调策略。
 */

export const LEDGER_AUTHORITY_DIRECTORY_MODE = 0o700;
export const LEDGER_AUTHORITY_FILE_MODE = 0o600;
export const LEDGER_AUTHORITY_LOCK_TIMEOUT_MILLISECONDS = 10_000;
export const LEDGER_AUTHORITY_RECORD_MAXIMUM_BYTES = parseByteCount(
  512 * 1024,
  "$ledger.recordMaximumBytes",
);
export const LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES = parseByteCount(
  4 * 1024 * 1024,
  "$ledger.memberMaximumBytes",
);
export const LEDGER_AUTHORITY_TREE_MAXIMUM_BYTES = parseByteCount(
  16 * 1024 * 1024,
  "$ledger.treeMaximumBytes",
);
export const LEDGER_PUBLICATION_MAXIMUM_BYTES = parseByteCount(
  32 * 1024 * 1024,
  "$ledger.publicationMaximumBytes",
);

const MEMBER_REFERENCE_ARTIFACT_KIND =
  "wakeflow-ledger-authority-member-reference" as const;
const MEMBER_REFERENCE_SCHEMA_VERSION = 1 as const;

export interface LedgerAuthorityMemberInput {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface LedgerAuthorityFileSource extends StableFileSource {}

export interface LoadedLedgerAuthorityDocument
  extends LedgerAuthorityDocument {
  readonly memberRef: PortableResourcePath;
  readonly source: Readonly<LedgerAuthorityFileSource>;
}

export interface LoadedLedgerAuthorityRecord<
  RecordType extends LedgerAuthorityRecord = LedgerAuthorityRecord,
> {
  readonly family: LedgerAuthorityFamily;
  readonly record: Readonly<RecordType>;
  readonly recordRootRef: PortableResourcePath;
  readonly recordRef: PortableResourcePath;
  readonly recordDigest: Sha256Digest;
  readonly recordSource: Readonly<LedgerAuthorityFileSource>;
  readonly documents: readonly Readonly<LoadedLedgerAuthorityDocument>[];
}

export interface LedgerAuthorityPublicationResult<
  RecordType extends LedgerAuthorityRecord = LedgerAuthorityRecord,
> {
  readonly created: boolean;
  readonly loaded: Readonly<LoadedLedgerAuthorityRecord<RecordType>>;
}

export interface LedgerAuthorityMemberReference {
  readonly artifactKind: typeof MEMBER_REFERENCE_ARTIFACT_KIND;
  readonly schemaVersion: typeof MEMBER_REFERENCE_SCHEMA_VERSION;
  readonly family: LedgerAuthorityFamily;
  readonly recordId:
    | WakeflowDurableId<"requirement">
    | WakeflowDurableId<"confirmation">;
  readonly recordRef: PortableResourcePath;
  readonly recordDigest: Sha256Digest;
  readonly memberPath: PortableResourcePath;
  readonly memberRef: PortableResourcePath;
  readonly memberDigest: Sha256Digest;
  readonly role: LedgerAuthorityDocument["role"];
  readonly mediaType: string;
}

export interface ResolvedLedgerAuthorityMember {
  readonly reference: Readonly<LedgerAuthorityMemberReference>;
  readonly loaded: Readonly<LoadedLedgerAuthorityRecord>;
  readonly document: Readonly<LoadedLedgerAuthorityDocument>;
  readonly bytes: Uint8Array;
  readonly source: Readonly<LedgerAuthorityFileSource>;
}

export interface InitializeLedgerAuthorityStoreOptions {
  readonly freshLedger: true;
  readonly signal?: AbortSignal;
}

export interface LedgerAuthorityStoreOptions {
  readonly signal?: AbortSignal;
}

export type LedgerAuthorityStoreErrorReason =
  | "input"
  | "root-scope"
  | "not-initialized"
  | "not-found"
  | "recovery-required"
  | "conflict"
  | "record"
  | "member"
  | "node-policy"
  | "capacity"
  | "lock-timeout"
  | "lock-unsafe"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  "input": "Ledger authority store input is invalid.",
  "root-scope": "Ledger authority root changed during the operation.",
  "not-initialized": "Ledger authority store has not been initialized.",
  "not-found": "Ledger authority record does not exist.",
  "recovery-required": "Ledger authority store contains a pending publication.",
  "conflict": "Ledger authority bytes conflict with an immutable identity.",
  "record": "Ledger authority record is invalid.",
  "member": "Ledger authority member inventory or bytes are invalid.",
  "node-policy": "Ledger authority resource violates its private node policy.",
  "capacity": "Ledger authority resource exceeds its bounded capacity.",
  "lock-timeout": "Ledger authority lock could not be acquired before its deadline.",
  "lock-unsafe": "Ledger authority lock resource is unsafe.",
  "aborted": "Ledger authority operation was aborted.",
  "operation-failure": "Ledger authority operation failed.",
} as const satisfies Readonly<Record<
  LedgerAuthorityStoreErrorReason,
  string
>>;

export class LedgerAuthorityStoreError extends Error {
  override readonly name = "LedgerAuthorityStoreError";
  readonly code = "wakeflow-ledger-authority-store" as const;
  readonly reason: LedgerAuthorityStoreErrorReason;
  readonly path: string;

  constructor(reason: LedgerAuthorityStoreErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

// ==================== 一、Store 输入、node policy 与 member bytes ====================

interface ParsedMemberInput {
  readonly path: PortableResourcePath;
  readonly bytes: Uint8Array;
  readonly digest: Sha256Digest;
}

interface ParsedOptions {
  readonly signal: AbortSignal | undefined;
}

const validateMemberReference =
  createRuntimeJsonSchemaValidator<MemberReferenceWire>(
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    [WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA, WAKEFLOW_SHA256_DIGEST_SCHEMA],
  );

function fail(reason: LedgerAuthorityStoreErrorReason, path: string): never {
  throw new LedgerAuthorityStoreError(reason, path);
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof value === "object"
    && value !== null
    && !types.isProxy(value)
    && value instanceof AbortSignal;
}

function parseOptions(value: unknown): Readonly<ParsedOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (Object.keys(record).some((key) => key !== "signal")) {
    fail("input", "$options");
  }
  if (record.signal !== undefined && !isAbortSignal(record.signal)) {
    fail("input", "$options/signal");
  }
  return Object.freeze({ signal: record.signal });
}

function assertNode(
  node: Readonly<FileNodeSnapshot>,
  kind: "file" | "directory",
  path: string,
): void {
  if (
    node.kind !== kind
    || node.permissionBits !== (
      kind === "file"
        ? LEDGER_AUTHORITY_FILE_MODE
        : LEDGER_AUTHORITY_DIRECTORY_MODE
    )
    || (kind === "file" && node.linkCount !== 1n)
  ) {
    fail("node-policy", path);
  }
}

function parseMemberInputs(
  value: unknown,
  record: Readonly<LedgerAuthorityRecord>,
): readonly Readonly<ParsedMemberInput>[] {
  let entries: readonly unknown[];
  try {
    entries = parseDenseArray(value, 32, "$members");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$members");
    throw error;
  }
  if (entries.length !== record.documents.length) fail("member", "$members");
  const parsed = entries.map((entry, index) => {
    let input: Readonly<Record<string, unknown>>;
    try {
      input = parsePlainRecord(entry, `$members/${index}`);
    } catch (error: unknown) {
      if (error instanceof PassiveOwnDataError) {
        fail("input", `$members/${index}`);
      }
      throw error;
    }
    const keys = Object.keys(input).sort();
    if (keys.length !== 2 || keys[0] !== "bytes" || keys[1] !== "path") {
      fail("input", `$members/${index}`);
    }
    let memberPath: PortableResourcePath;
    try {
      memberPath = parsePortableResourcePath(
        input.path,
        `$members/${index}/path`,
      );
    } catch (error: unknown) {
      if (error instanceof PortableResourcePathError) {
        fail("input", `$members/${index}/path`);
      }
      throw error;
    }
    if (
      !ArrayBuffer.isView(input.bytes)
      || !(input.bytes instanceof Uint8Array)
      || types.isProxy(input.bytes)
    ) {
      fail("input", `$members/${index}/bytes`);
    }
    if (input.bytes.byteLength > LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES) {
      fail("capacity", `$members/${index}/bytes`);
    }
    const bytes = new Uint8Array(input.bytes);
    return Object.freeze({
      path: memberPath,
      bytes,
      digest: computeSha256Digest(bytes, `$members/${index}/bytes`),
    });
  });
  const totalMemberBytes = parsed.reduce(
    (total, member) => total + member.bytes.byteLength,
    0,
  );
  const recordBytes = encodeUtf8(renderLedgerAuthorityRecord(record)).byteLength;
  if (
    totalMemberBytes + recordBytes
    > LEDGER_AUTHORITY_TREE_MAXIMUM_BYTES
  ) {
    fail("capacity", "$members");
  }
  for (const [index, document] of record.documents.entries()) {
    const member = parsed[index];
    if (
      member === undefined
      || member.path !== document.path
      || member.digest !== document.digest
    ) {
      fail("member", `$members/${index}`);
    }
  }
  return Object.freeze(parsed);
}

function fileSource(
  source: Readonly<StableFileSource>,
  path: string,
): Readonly<LedgerAuthorityFileSource> {
  assertNode(source.node, "file", path);
  return Object.freeze({
    resourcePath: source.resourcePath,
    node: source.node,
    byteCount: source.byteCount,
    digest: source.digest,
  });
}

function expectedResourcePaths(
  record: Readonly<LedgerAuthorityRecord>,
): ReadonlyMap<PortableResourcePath, "file" | "directory"> {
  const rootRef = ledgerAuthorityRootRef(record);
  const expected = new Map<PortableResourcePath, "file" | "directory">();
  expected.set(ledgerAuthorityRecordRef(record), "file");
  for (const document of record.documents) {
    const segments = document.path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      expected.set(
        parsePortableResourcePath(
          `${rootRef}/${segments.slice(0, index).join("/")}`,
        ),
        "directory",
      );
    }
    expected.set(ledgerAuthorityMemberRef(record, document.path), "file");
  }
  return expected;
}

// ==================== 二、Immutable record/member tree reader ====================

function mapTreeError(error: StableResourceTreeReadError): never {
  if (error.reason === "not-found") fail("not-found", "$record");
  if (
    error.reason === "entry-limit"
    || error.reason === "depth-limit"
    || error.reason === "file-count"
    || error.reason === "file-bytes"
    || error.reason === "total-bytes"
  ) {
    fail("capacity", "$record");
  }
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "root-scope") fail("root-scope", "$root");
  fail("conflict", "$record");
}

async function readRecordDocument(
  root: RootedDirectory,
  recordRef: PortableResourcePath,
  expectedNode: Readonly<FileNodeSnapshot>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DeterministicJsonFileResult>> {
  try {
    return await readDeterministicJsonFile(root, recordRef, {
      maximumBytes: LEDGER_AUTHORITY_RECORD_MAXIMUM_BYTES,
      expectedNode,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "root-scope") fail("root-scope", "$root");
      if (error.reason === "too-large") fail("capacity", "$record");
      fail("conflict", "$record");
    }
    if (
      error instanceof StrictTextFileError
      || error instanceof DeterministicJsonDocumentError
    ) {
      fail("record", "$record");
    }
    throw error;
  }
}

async function loadRecordAt(
  root: RootedDirectory,
  rootRef: PortableResourcePath,
  expectedFamily: LedgerAuthorityFamily,
  expectedId: string,
  signal: AbortSignal | undefined,
): Promise<Readonly<LoadedLedgerAuthorityRecord>> {
  let tree;
  try {
    tree = await readStableResourceTree(root, rootRef, {
      maximumEntries: 128,
      maximumDepth: 8,
      maximumFiles: 33,
      maximumFileBytes: LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES,
      maximumTotalBytes: LEDGER_AUTHORITY_TREE_MAXIMUM_BYTES,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableResourceTreeReadError) mapTreeError(error);
    throw error;
  }
  assertNode(tree.treeRootNode, "directory", "$recordRoot");
  const recordEntry = tree.entries.find(
    (entry) => entry.resourcePath === `${rootRef}/record.json`,
  );
  if (recordEntry === undefined || recordEntry.node.kind !== "file") {
    fail("conflict", "$record/record.json");
  }
  const read = await readRecordDocument(
    root,
    recordEntry.resourcePath,
    recordEntry.node,
    signal,
  );
  let record: Readonly<LedgerAuthorityRecord>;
  try {
    record = parseLedgerAuthorityRecordDocument(read.text);
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityRecordError) fail("record", "$record");
    throw error;
  }
  if (
    ledgerAuthorityFamily(record) !== expectedFamily
    || ledgerAuthorityRecordId(record) !== expectedId
    || ledgerAuthorityRootRef(record) !== rootRef
  ) {
    fail("conflict", "$record");
  }
  const expected = expectedResourcePaths(record);
  if (
    tree.entries.length !== expected.size
    || tree.entries.some((entry) => {
      const kind = expected.get(entry.resourcePath);
      return kind === undefined || entry.node.kind !== kind;
    })
  ) {
    fail("conflict", "$recordRoot");
  }
  for (const entry of tree.entries) {
    assertNode(
      entry.node,
      entry.node.kind === "directory" ? "directory" : "file",
      "$recordRoot",
    );
  }
  const fileByRef = new Map(tree.files.map((file) => [file.resourcePath, file]));
  const documents = record.documents.map((document) => {
    const memberRef = ledgerAuthorityMemberRef(record, document.path);
    const source = fileByRef.get(memberRef);
    if (source === undefined || source.digest !== document.digest) {
      fail("member", "$record/documents");
    }
    return Object.freeze({
      ...document,
      memberRef,
      source: fileSource(source, "$record/documents"),
    });
  });
  const recordSource = fileSource(read, "$record/record.json");
  return Object.freeze({
    family: expectedFamily,
    record,
    recordRootRef: rootRef,
    recordRef: recordSource.resourcePath,
    recordDigest: computeLedgerAuthorityRecordDigest(record),
    recordSource,
    documents: Object.freeze(documents),
  });
}

function parseReferencePath(value: unknown, path: string): PortableResourcePath {
  try {
    return parsePortableResourcePath(value, path);
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) fail("input", path);
    throw error;
  }
}

// ==================== 三、Portable member reference codec ====================

function parseReferenceDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("input", path);
    throw error;
  }
}

/** 解析并闭合一个可持久化 Ledger member reference。 */
export function parseLedgerAuthorityMemberReference(
  value: unknown,
): Readonly<LedgerAuthorityMemberReference> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$reference");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("input", error.path);
    throw error;
  }
  const result = validateMemberReference(json);
  if (!result.ok) fail("input", result.path);
  let recordId:
    | WakeflowDurableId<"requirement">
    | WakeflowDurableId<"confirmation">;
  try {
    recordId = result.value.family === "requirement"
      ? parseWakeflowDurableIdOfKind(
        result.value.recordId,
        "requirement",
        "$/recordId",
      )
      : parseWakeflowDurableIdOfKind(
        result.value.recordId,
        "confirmation",
        "$/recordId",
      );
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("input", "$/recordId");
    throw error;
  }
  const reference = Object.freeze({
    artifactKind: MEMBER_REFERENCE_ARTIFACT_KIND,
    schemaVersion: MEMBER_REFERENCE_SCHEMA_VERSION,
    family: result.value.family,
    recordId,
    recordRef: parseReferencePath(result.value.recordRef, "$/recordRef"),
    recordDigest: parseReferenceDigest(
      result.value.recordDigest,
      "$/recordDigest",
    ),
    memberPath: parseReferencePath(result.value.memberPath, "$/memberPath"),
    memberRef: parseReferencePath(result.value.memberRef, "$/memberRef"),
    memberDigest: parseReferenceDigest(
      result.value.memberDigest,
      "$/memberDigest",
    ),
    role: result.value.role,
    mediaType: result.value.mediaType,
  });
  const expectedRoot = reference.family === "requirement"
    ? requirementRootRef(
      reference.recordId as WakeflowDurableId<"requirement">,
    )
    : confirmationRootRef(
      reference.recordId as WakeflowDurableId<"confirmation">,
    );
  if (
    reference.recordRef !== `${expectedRoot}/record.json`
    || reference.memberRef !== `${expectedRoot}/${reference.memberPath}`
  ) {
    fail("input", "$reference");
  }
  return reference;
}

/** 从严格 loaded record 创建一个跨领域 member reference。 */
export function createLedgerAuthorityMemberReference(
  loaded: Readonly<LoadedLedgerAuthorityRecord>,
  memberPathValue: unknown,
): Readonly<LedgerAuthorityMemberReference> {
  const memberPath = parseReferencePath(memberPathValue, "$memberPath");
  const document = loaded.documents.find(
    (candidate) => candidate.path === memberPath,
  );
  if (document === undefined) fail("input", "$memberPath");
  return parseLedgerAuthorityMemberReference({
    artifactKind: MEMBER_REFERENCE_ARTIFACT_KIND,
    schemaVersion: MEMBER_REFERENCE_SCHEMA_VERSION,
    family: loaded.family,
    recordId: ledgerAuthorityRecordId(loaded.record),
    recordRef: loaded.recordRef,
    recordDigest: loaded.recordDigest,
    memberPath: document.path,
    memberRef: document.memberRef,
    memberDigest: document.digest,
    role: document.role,
    mediaType: document.mediaType,
  });
}

async function readTransactions(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
) {
  try {
    return await readStableResourceDirectory(
      root,
      LEDGER_TRANSACTIONS_ROOT_REF,
      {
        maximumEntries: 64,
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError) {
      if (error.reason === "not-found") fail("not-initialized", "$transactions");
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "root-scope") fail("root-scope", "$root");
      fail("conflict", "$transactions");
    }
    throw error;
  }
}

// ==================== 四、Publication journal 与 absent-only writes ====================

async function assertNoPendingPublication(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<void> {
  const transactions = await readTransactions(root, signal);
  assertNode(transactions.directoryNode, "directory", "$transactions");
  if (transactions.entries.length !== 0) {
    fail("recovery-required", "$transactions");
  }
}

async function recoverLedgerTransactionStages(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    const receipt = await recoverDurableAtomicFileStagesInDirectory(
      root,
      LEDGER_TRANSACTIONS_ROOT_REF,
      signal === undefined ? undefined : { signal },
    );
    if (
      receipt.activeStageCount !== 0
      || receipt.unknownStageCount !== 0
    ) {
      fail("recovery-required", "$transactions/stage");
    }
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityStoreError) throw error;
    if (error instanceof DurableAtomicFileStageRecoveryError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("recovery-required", "$transactions/stage");
    }
    throw error;
  }
}

async function readPublication(
  root: RootedDirectory,
  ref: PortableResourcePath,
  expectedNode: Readonly<FileNodeSnapshot>,
  signal: AbortSignal | undefined,
): Promise<Readonly<{
  publication: Readonly<LedgerRecordPublication>;
  source: Readonly<LedgerAuthorityFileSource>;
}>> {
  let read: Readonly<DeterministicJsonFileResult>;
  try {
    read = await readDeterministicJsonFile(root, ref, {
      maximumBytes: LEDGER_PUBLICATION_MAXIMUM_BYTES,
      expectedNode,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("conflict", "$transactions");
    }
    if (
      error instanceof StrictTextFileError
      || error instanceof DeterministicJsonDocumentError
    ) {
      fail("conflict", "$transactions");
    }
    throw error;
  }
  let publication: Readonly<LedgerRecordPublication>;
  try {
    publication = parseLedgerRecordPublicationDocument(read.text);
  } catch (error: unknown) {
    if (error instanceof LedgerRecordPublicationError) {
      fail("conflict", "$transactions");
    }
    throw error;
  }
  return Object.freeze({
    publication,
    source: fileSource(read, "$transactions"),
  });
}

async function resourceExists(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
): Promise<boolean> {
  try {
    await root.inspectExistingResource(resourcePath);
    return true;
  } catch (error: unknown) {
    if (
      error instanceof RootedDirectoryError
      && error.reason === "resource-not-found"
    ) {
      return false;
    }
    if (error instanceof RootedDirectoryError) fail("conflict", "$resource");
    throw error;
  }
}

async function ensureExactFile(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  bytes: Uint8Array,
  maximumBytes: ByteCount,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (!await resourceExists(root, resourcePath)) {
    try {
      await createFileAtomically(root, resourcePath, bytes, {
        mode: LEDGER_AUTHORITY_FILE_MODE,
        ...(signal === undefined ? {} : { signal }),
      });
      return;
    } catch (error: unknown) {
      if (error instanceof DurableAtomicFileWriteError) {
        if (error.reason === "aborted") fail("aborted", "$signal");
        if (error.reason === "target-exists") {
          // 并发 writer 仍须在下方按完整字节复验；Ledger lock 正常会阻止此路径。
        } else {
          fail("operation-failure", "$write");
        }
      } else {
        throw error;
      }
    }
  }
  let existing;
  try {
    existing = await readStableFile(root, resourcePath, {
      maximumBytes,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "too-large") fail("capacity", "$write");
      fail("conflict", "$write");
    }
    throw error;
  }
  assertNode(existing.node, "file", "$write");
  if (
    existing.digest !== computeSha256Digest(bytes)
    || existing.bytes.length !== bytes.length
    || existing.bytes.some((byte, index) => byte !== bytes[index])
  ) {
    fail("conflict", "$write");
  }
}

function parentPaths(memberPath: PortableResourcePath): readonly string[] {
  const segments = memberPath.split("/");
  return Object.freeze(segments.slice(0, -1).map((_, index) => (
    segments.slice(0, index + 1).join("/")
  )));
}

function mapLockError(error: RootedExclusiveFileLockError): never {
  if (error.reason === "timeout") fail("lock-timeout", "$lock");
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (
    error.reason === "unsafe-lock"
    || error.reason === "parent"
    || error.reason === "root-scope"
  ) {
    fail("lock-unsafe", "$lock");
  }
  fail("recovery-required", "$lock");
}

async function prepareLedgerPublicationLockRecovery(
  root: RootedDirectory,
  record: Readonly<LedgerAuthorityRecord>,
  signal: AbortSignal | undefined,
): Promise<void> {
  await recoverLedgerTransactionStages(root, signal);
  const transactions = await readTransactions(root, signal);
  const publicationRef = ledgerRecordPublicationRef(record);
  if (transactions.entries.length === 0) return;
  if (
    transactions.entries.length !== 1
    || transactions.entries[0]?.resourcePath !== publicationRef
    || transactions.entries[0].node.kind !== "file"
  ) {
    fail("recovery-required", "$transactions");
  }
  const journal = await readPublication(
    root,
    publicationRef,
    transactions.entries[0].node,
    signal,
  );
  try {
    assertLedgerRecordPublicationMatches(journal.publication, record);
  } catch (error: unknown) {
    if (error instanceof LedgerRecordPublicationError) {
      fail("conflict", "$transactions");
    }
    throw error;
  }
  let observation;
  try {
    observation = await inspectRootedExclusiveFileLock(
      root,
      LEDGER_AUTHORITY_LOCK_REF,
    );
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) {
      fail("recovery-required", "$lock");
    }
    throw error;
  }
  if (observation.status !== "held" || observation.ownerState !== "inactive") {
    return;
  }
  try {
    await retireRootedExclusiveFileLockResidue(
      root,
      LEDGER_AUTHORITY_LOCK_REF,
      observation,
    );
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) {
      fail("recovery-required", "$lock");
    }
    throw error;
  }
}

async function resolveLoadedMemberReference(
  root: RootedDirectory,
  loaded: Readonly<LoadedLedgerAuthorityRecord>,
  reference: Readonly<LedgerAuthorityMemberReference>,
  signal: AbortSignal | undefined,
): Promise<Readonly<ResolvedLedgerAuthorityMember>> {
  const document = loaded.documents.find(
    (candidate) => candidate.path === reference.memberPath,
  );
  if (
    loaded.recordRef !== reference.recordRef
    || loaded.recordDigest !== reference.recordDigest
    || document === undefined
    || document.memberRef !== reference.memberRef
    || document.digest !== reference.memberDigest
    || document.role !== reference.role
    || document.mediaType !== reference.mediaType
  ) {
    fail("conflict", "$reference");
  }
  let read;
  try {
    read = await readStableFile(root, document.memberRef, {
      maximumBytes: LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES,
      expectedNode: document.source.node,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("conflict", "$reference");
    }
    throw error;
  }
  if (read.digest !== reference.memberDigest) {
    fail("conflict", "$reference");
  }
  return Object.freeze({
    reference,
    loaded,
    document,
    bytes: new Uint8Array(read.bytes),
    source: fileSource(read, "$reference"),
  });
}

export class LedgerAuthorityStore {
  readonly #root: RootedDirectory;

  constructor(root: RootedDirectory) {
    if (
      typeof root !== "object"
      || root === null
      || types.isProxy(root)
      || !(root instanceof RootedDirectory)
    ) {
      fail("input", "$root");
    }
    this.#root = root;
  }

  /** fresh Ledger owner 使用的幂等私有目录初始化。 */
  async initialize(options: InitializeLedgerAuthorityStoreOptions): Promise<void> {
    let record: Readonly<Record<string, unknown>>;
    try {
      record = parsePlainRecord(options, "$options");
    } catch (error: unknown) {
      if (error instanceof PassiveOwnDataError) fail("input", "$options");
      throw error;
    }
    if (
      record.freshLedger !== true
      || Object.keys(record).some(
        (key) => key !== "freshLedger" && key !== "signal",
      )
      || (
        record.signal !== undefined
        && !isAbortSignal(record.signal)
      )
    ) {
      fail("input", "$options");
    }
    const signal = record.signal as AbortSignal | undefined;
    try {
      for (const resourcePath of [
        LEDGER_REQUIREMENTS_ROOT_REF,
        LEDGER_CONFIRMATIONS_ROOT_REF,
        LEDGER_TRANSACTIONS_ROOT_REF,
      ]) {
        await materializeDirectoryPath(this.#root, resourcePath, {
          mode: LEDGER_AUTHORITY_DIRECTORY_MODE,
          ...(signal === undefined ? {} : { signal }),
        });
      }
      await assertNoPendingPublication(this.#root, signal);
    } catch (error: unknown) {
      if (error instanceof LedgerAuthorityStoreError) throw error;
      if (error instanceof DurableDirectoryMaterializationError) {
        if (error.reason === "aborted") fail("aborted", "$signal");
        fail("operation-failure", "$initialize");
      }
      throw error;
    }
  }

  async #load(
    family: LedgerAuthorityFamily,
    recordId: string,
    signal: AbortSignal | undefined,
    allowPublication: boolean,
  ): Promise<Readonly<LoadedLedgerAuthorityRecord>> {
    if (!allowPublication) {
      await assertNoPendingPublication(this.#root, signal);
    }
    const rootRef = family === "requirement"
      ? requirementRootRef(
        parseWakeflowDurableIdOfKind(recordId, "requirement") as WakeflowDurableId<"requirement">,
      )
      : confirmationRootRef(
        parseWakeflowDurableIdOfKind(recordId, "confirmation") as WakeflowDurableId<"confirmation">,
      );
    return loadRecordAt(this.#root, rootRef, family, recordId, signal);
  }

  async loadRequirement(
    requirementIdValue: unknown,
    options?: LedgerAuthorityStoreOptions,
  ): Promise<Readonly<LoadedLedgerAuthorityRecord<RequirementRecord>>> {
    const parsed = parseOptions(options);
    let requirementId: WakeflowDurableId<"requirement">;
    try {
      requirementId = parseWakeflowDurableIdOfKind(
        requirementIdValue,
        "requirement",
        "$requirementId",
      );
    } catch (error: unknown) {
      if (error instanceof WakeflowDurableIdError) fail("input", "$requirementId");
      throw error;
    }
    return this.#load(
      "requirement",
      requirementId,
      parsed.signal,
      false,
    ) as Promise<Readonly<LoadedLedgerAuthorityRecord<RequirementRecord>>>;
  }

  async loadConfirmation(
    confirmationIdValue: unknown,
    options?: LedgerAuthorityStoreOptions,
  ): Promise<Readonly<LoadedLedgerAuthorityRecord<ConfirmationRecord>>> {
    const parsed = parseOptions(options);
    let confirmationId: WakeflowDurableId<"confirmation">;
    try {
      confirmationId = parseWakeflowDurableIdOfKind(
        confirmationIdValue,
        "confirmation",
        "$confirmationId",
      );
    } catch (error: unknown) {
      if (error instanceof WakeflowDurableIdError) fail("input", "$confirmationId");
      throw error;
    }
    return this.#load(
      "confirmation",
      confirmationId,
      parsed.signal,
      false,
    ) as Promise<Readonly<LoadedLedgerAuthorityRecord<ConfirmationRecord>>>;
  }

  /** 在 Ledger lock 下发布或幂等复用一份完整 immutable record/member tree。 */
  async publish<RecordType extends LedgerAuthorityRecord>(
    recordValue: RecordType,
    membersValue: readonly LedgerAuthorityMemberInput[],
    options?: LedgerAuthorityStoreOptions,
  ): Promise<Readonly<LedgerAuthorityPublicationResult<RecordType>>> {
    const parsed = parseOptions(options);
    let record: Readonly<LedgerAuthorityRecord>;
    try {
      record = parseLedgerAuthorityRecord(recordValue);
    } catch (error: unknown) {
      if (error instanceof LedgerAuthorityRecordError) fail("input", "$record");
      throw error;
    }
    const members = parseMemberInputs(membersValue, record);
    const publication = createLedgerRecordPublication(record, members);
    await prepareLedgerPublicationLockRecovery(
      this.#root,
      record,
      parsed.signal,
    );
    try {
      return await withRootedExclusiveFileLock(
        this.#root,
        LEDGER_AUTHORITY_LOCK_REF,
        async () => {
          const transactions = await readTransactions(this.#root, parsed.signal);
          const publicationRef = ledgerRecordPublicationRef(record);
          let journalSource: Readonly<LedgerAuthorityFileSource> | null = null;
          if (transactions.entries.length !== 0) {
            if (
              transactions.entries.length !== 1
              || transactions.entries[0]?.resourcePath !== publicationRef
              || transactions.entries[0].node.kind !== "file"
            ) {
              fail("recovery-required", "$transactions");
            }
            const loadedJournal = await readPublication(
              this.#root,
              publicationRef,
              transactions.entries[0].node,
              parsed.signal,
            );
            try {
              assertLedgerRecordPublicationMatches(
                loadedJournal.publication,
                record,
              );
            } catch (error: unknown) {
              if (error instanceof LedgerRecordPublicationError) {
                fail("conflict", "$transactions");
              }
              throw error;
            }
            journalSource = loadedJournal.source;
          } else {
            const finalExists = await resourceExists(
              this.#root,
              ledgerAuthorityRootRef(record),
            );
            if (finalExists) {
              const loaded = await this.#load(
                ledgerAuthorityFamily(record),
                ledgerAuthorityRecordId(record),
                parsed.signal,
                true,
              );
              if (
                loaded.recordDigest !== computeLedgerAuthorityRecordDigest(record)
                || loaded.documents.some((document, index) => (
                  document.digest !== members[index]?.digest
                ))
              ) {
                fail("conflict", "$record");
              }
              return Object.freeze({
                created: false,
                loaded,
              }) as Readonly<LedgerAuthorityPublicationResult<RecordType>>;
            }
            const created = await createFileAtomically(
              this.#root,
              publicationRef,
              encodeUtf8(renderLedgerRecordPublication(publication)),
              {
                mode: LEDGER_AUTHORITY_FILE_MODE,
                ...(parsed.signal === undefined
                  ? {}
                  : { signal: parsed.signal }),
              },
            );
            journalSource = fileSource(created, "$transactions");
          }

          const recordRootRef = ledgerAuthorityRootRef(record);
          await materializeDirectoryPath(this.#root, recordRootRef, {
            mode: LEDGER_AUTHORITY_DIRECTORY_MODE,
            ...(parsed.signal === undefined ? {} : { signal: parsed.signal }),
          });
          for (const member of members) {
            for (const parent of parentPaths(member.path)) {
              await materializeDirectoryPath(
                this.#root,
                parsePortableResourcePath(`${recordRootRef}/${parent}`),
                {
                  mode: LEDGER_AUTHORITY_DIRECTORY_MODE,
                  ...(parsed.signal === undefined
                    ? {}
                    : { signal: parsed.signal }),
                },
              );
            }
            await ensureExactFile(
              this.#root,
              ledgerAuthorityMemberRef(record, member.path),
              member.bytes,
              LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES,
              parsed.signal,
            );
          }
          await ensureExactFile(
            this.#root,
            ledgerAuthorityRecordRef(record),
            encodeUtf8(renderLedgerAuthorityRecord(record)),
            LEDGER_AUTHORITY_RECORD_MAXIMUM_BYTES,
            parsed.signal,
          );
          const loaded = await this.#load(
            ledgerAuthorityFamily(record),
            ledgerAuthorityRecordId(record),
            parsed.signal,
            true,
          );
          if (
            loaded.recordDigest !== publication.recordDigest
            || loaded.documents.some((document, index) => (
              document.digest !== publication.documents[index]?.digest
            ))
          ) {
            fail("conflict", "$record");
          }
          if (journalSource === null) fail("operation-failure", "$transactions");
          try {
            await unlinkRegularFileExactly(this.#root, publicationRef, {
              expectedNode: journalSource.node,
              ...(parsed.signal === undefined
                ? {}
                : { signal: parsed.signal }),
            });
          } catch (error: unknown) {
            if (error instanceof ExactRegularFileUnlinkError) {
              if (error.reason === "aborted") fail("aborted", "$signal");
              fail("recovery-required", "$transactions");
            }
            throw error;
          }
          return Object.freeze({
            created: true,
            loaded,
          }) as Readonly<LedgerAuthorityPublicationResult<RecordType>>;
        },
        {
          acquireTimeoutMilliseconds:
            LEDGER_AUTHORITY_LOCK_TIMEOUT_MILLISECONDS,
          ...(parsed.signal === undefined ? {} : { signal: parsed.signal }),
        },
      );
    } catch (error: unknown) {
      if (error instanceof LedgerAuthorityStoreError) throw error;
      if (error instanceof RootedExclusiveFileLockError) mapLockError(error);
      if (error instanceof DurableDirectoryMaterializationError) {
        if (error.reason === "aborted") fail("aborted", "$signal");
        fail("operation-failure", "$publish");
      }
      if (error instanceof DurableAtomicFileWriteError) {
        if (error.reason === "aborted") fail("aborted", "$signal");
        fail("operation-failure", "$publish");
      }
      throw error;
    }
  }

  /** 从唯一 self-contained journal 恢复 publication，不要求调用方重供 member bytes。 */
  async recoverPendingPublication(
    options?: LedgerAuthorityStoreOptions,
  ): Promise<Readonly<LedgerAuthorityPublicationResult>> {
    const parsed = parseOptions(options);
    await recoverLedgerTransactionStages(this.#root, parsed.signal);
    const transactions = await readTransactions(this.#root, parsed.signal);
    if (transactions.entries.length === 0) fail("not-found", "$transactions");
    if (
      transactions.entries.length !== 1
      || transactions.entries[0]?.node.kind !== "file"
    ) {
      fail("recovery-required", "$transactions");
    }
    const stored = await readPublication(
      this.#root,
      transactions.entries[0].resourcePath,
      transactions.entries[0].node,
      parsed.signal,
    );
    let decoded;
    try {
      decoded = decodeLedgerRecordPublication(stored.publication);
    } catch (error: unknown) {
      if (error instanceof LedgerRecordPublicationError) {
        fail("conflict", "$transactions");
      }
      throw error;
    }
    return this.publish(
      decoded.record,
      decoded.members,
      options,
    );
  }

  /** 解析 reference、重新加载 exact record，再读取同一 immutable member bytes。 */
  async resolveMemberReference(
    referenceValue: unknown,
    options?: LedgerAuthorityStoreOptions,
  ): Promise<Readonly<ResolvedLedgerAuthorityMember>> {
    const parsed = parseOptions(options);
    const reference = parseLedgerAuthorityMemberReference(referenceValue);
    const loaded = await this.#load(
      reference.family,
      reference.recordId,
      parsed.signal,
      false,
    );
    return resolveLoadedMemberReference(
      this.#root,
      loaded,
      reference,
      parsed.signal,
    );
  }

  /** 批量解析 references，同一 immutable Ledger record 在本次调用中只加载一次。 */
  async resolveMemberReferences(
    referencesValue: readonly unknown[],
    options?: LedgerAuthorityStoreOptions,
  ): Promise<readonly Readonly<ResolvedLedgerAuthorityMember>[]> {
    const parsed = parseOptions(options);
    let values: readonly unknown[];
    try {
      values = parseDenseArray(referencesValue, 32, "$references");
    } catch (error: unknown) {
      if (error instanceof PassiveOwnDataError) fail("input", "$references");
      throw error;
    }
    if (values.length === 0) fail("input", "$references");
    const references = values.map((value, index) => {
      try {
        return parseLedgerAuthorityMemberReference(value);
      } catch (error: unknown) {
        if (error instanceof LedgerAuthorityStoreError) {
          fail("input", `$/references/${index}`);
        }
        throw error;
      }
    });
    const loadedByRecord = new Map<string, Readonly<LoadedLedgerAuthorityRecord>>();
    const resolved: ResolvedLedgerAuthorityMember[] = [];
    for (const reference of references) {
      const key = `${reference.family}\u0000${reference.recordId}`;
      let loaded = loadedByRecord.get(key);
      if (loaded === undefined) {
        loaded = await this.#load(
          reference.family,
          reference.recordId,
          parsed.signal,
          false,
        );
        loadedByRecord.set(key, loaded);
      }
      resolved.push(await resolveLoadedMemberReference(
        this.#root,
        loaded,
        reference,
        parsed.signal,
      ));
    }
    return Object.freeze(resolved);
  }
}
