import pLimit from "p-limit";

import type { WakeflowConfigAuthoritySnapshot } from "../../configuration/wakeflow-config-authority-snapshot.js";
import type { WakeflowConfigRootPlacementEntry } from "../../configuration/wakeflow-config-root-placement.js";
import {
  computeSha256Digest,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import type { FileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableFileDigest,
  StableFileReadError,
} from "../../foundation/filesystem/stable-file-read.js";
import {
  readStrictTextFile,
  StrictTextFileError,
} from "../../foundation/filesystem/strict-text-file.js";
import type { ByteCount } from "../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  type LedgerAuthorityPublicationDocumentSelection,
  type LedgerAuthorityPublicationInput,
} from "./ledger-authority-publication-input.js";
import type { LedgerAuthorityDocumentRole } from "./ledger-authority-record.js";
import { LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES } from "./ledger-authority-storage-policy.js";

/**
 * Wakeflow Governance / Ledger：Publication Planning的Design Markdown source观察。
 *
 * 本模块只把当前Config唯一Design surface上的严格Markdown读取为path、size、digest和
 * 节点事实，并支持稍后按同一节点复验。它不分配业务身份、不创建Record/Plan，也不
 * 把Design source本身变成Ledger权威；最终发布仍必须重新读取并验证内容描述符。
 */

export interface LedgerAuthorityPublicationSourceDocument {
  readonly role: LedgerAuthorityDocumentRole;
  readonly path: PortableResourcePath;
  readonly node: Readonly<FileNodeSnapshot>;
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
}

export interface LedgerAuthorityPublicationSourceSnapshot {
  readonly designSurfaceId: LedgerAuthorityPublicationInput["designSurfaceId"];
  readonly documents: readonly [
    Readonly<LedgerAuthorityPublicationSourceDocument>,
    ...Readonly<LedgerAuthorityPublicationSourceDocument>[],
  ];
}

/** Store消费的内存成员；对象与数组冻结，bytes副本由直接调用方持有。 */
export interface LedgerAuthorityPublicationSourcePayloadMember {
  readonly path: PortableResourcePath;
  readonly bytes: Uint8Array;
}

export type LedgerAuthorityPublicationSourcePayload = readonly [
  Readonly<LedgerAuthorityPublicationSourcePayloadMember>,
  ...Readonly<LedgerAuthorityPublicationSourcePayloadMember>[],
];

export type LedgerAuthorityPublicationSourceErrorReason =
  | "input"
  | "source-root"
  | "source"
  | "source-profile"
  | "source-changed"
  | "capacity"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Ledger authority publication source observation input is invalid.",
  "source-root": "Ledger authority publication Design source root is invalid.",
  source: "Ledger authority publication source is unavailable or unsafe.",
  "source-profile": "Ledger authority publication source is not strict Markdown text.",
  "source-changed": "Ledger authority publication source changed during observation.",
  capacity: "Ledger authority publication source exceeds its bounded capacity.",
  aborted: "Ledger authority publication source observation was aborted.",
  "operation-failure": "Ledger authority publication source observation failed.",
} as const satisfies Readonly<Record<
  LedgerAuthorityPublicationSourceErrorReason,
  string
>>;

/** Design source无法形成或保持一组关闭内容描述符时的稳定错误。 */
export class LedgerAuthorityPublicationSourceError extends Error {
  override readonly name = "LedgerAuthorityPublicationSourceError";
  readonly code = "wakeflow-ledger-authority-publication-source" as const;
  readonly reason: LedgerAuthorityPublicationSourceErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;

  constructor(
    reason: LedgerAuthorityPublicationSourceErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
  }
}

const SOURCE_READ_CONCURRENCY = 4;

function ownString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined
    && Object.hasOwn(descriptor, "value")
    && typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function fail(
  reason: LedgerAuthorityPublicationSourceErrorReason,
  cause?: unknown,
): never {
  throw new LedgerAuthorityPublicationSourceError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
  );
}

function placementByKey(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  key: string,
): Readonly<WakeflowConfigRootPlacementEntry> | null {
  return config.placements.roots.find((entry) => entry.key === key) ?? null;
}

function designPlacement(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  input: Readonly<LedgerAuthorityPublicationInput>,
): Readonly<WakeflowConfigRootPlacementEntry> {
  const configuredDesignId = config.indexes.designWindow.root.surfaceId;
  const surface = config.indexes.surfaceById[input.designSurfaceId];
  if (
    input.designSurfaceId !== configuredDesignId
    || surface === undefined
    || surface.capability !== "design"
  ) {
    fail("source-root");
  }
  const placement = placementByKey(
    config,
    `support.${configuredDesignId}.root`,
  );
  if (
    placement === null
    || placement.state !== "present"
    || placement.realPath === null
  ) {
    fail("source-root");
  }
  return placement;
}

async function openDesignRoot(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  input: Readonly<LedgerAuthorityPublicationInput>,
): Promise<RootedDirectory> {
  const placement = designPlacement(config, input);
  let root: RootedDirectory | undefined;
  try {
    root = await RootedDirectory.open(placement.absolutePath, "$designRoot");
    if (root.absolutePath !== placement.realPath) fail("source-root");
    return root;
  } catch (error: unknown) {
    if (root !== undefined) {
      try {
        await root.close();
      } catch {
        // 首个根关系错误优先。
      }
    }
    if (error instanceof LedgerAuthorityPublicationSourceError) throw error;
    if (error instanceof RootedDirectoryError) fail("source-root", error);
    throw error;
  }
}

function mapStableReadError(error: StableFileReadError): never {
  if (error.reason === "aborted") fail("aborted", error);
  if (error.reason === "too-large") fail("capacity", error);
  if (
    error.reason === "source-changed"
    || error.reason === "expectation-changed"
  ) {
    fail("source-changed", error);
  }
  fail("source", error);
}

async function boundedMap<Input, Output>(
  values: readonly Input[],
  task: (value: Input, index: number) => Promise<Output>,
): Promise<readonly Output[]> {
  const limit = pLimit(SOURCE_READ_CONCURRENCY);
  const settled = await Promise.allSettled(
    values.map((value, index) => limit(() => task(value, index))),
  );
  const output: Output[] = [];
  for (const result of settled) {
    if (result.status === "rejected") throw result.reason;
    output.push(result.value);
  }
  return Object.freeze(output);
}

async function captureDocuments(
  root: RootedDirectory,
  documents: LedgerAuthorityPublicationInput["documents"],
  signal: AbortSignal | undefined,
): Promise<LedgerAuthorityPublicationSourceSnapshot["documents"]> {
  const selections = documents as readonly Readonly<
    LedgerAuthorityPublicationDocumentSelection<LedgerAuthorityDocumentRole>
  >[];
  const captured = await boundedMap<
    Readonly<LedgerAuthorityPublicationDocumentSelection<LedgerAuthorityDocumentRole>>,
    Readonly<LedgerAuthorityPublicationSourceDocument>
  >(selections, async (document) => {
    try {
      const read = await readStrictTextFile(root, document.path, {
        maximumBytes: LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES,
        ...(signal === undefined ? {} : { signal }),
      });
      return Object.freeze({
        role: document.role,
        path: document.path,
        node: read.node,
        byteCount: read.byteCount,
        digest: read.digest,
      });
    } catch (error: unknown) {
      if (error instanceof StableFileReadError) mapStableReadError(error);
      if (error instanceof StrictTextFileError) fail("source-profile", error);
      throw error;
    }
  });
  const first = captured[0];
  if (first === undefined) fail("operation-failure");
  return Object.freeze([first, ...captured.slice(1)]) as
    LedgerAuthorityPublicationSourceSnapshot["documents"];
}

async function revalidateDocuments(
  root: RootedDirectory,
  documents: LedgerAuthorityPublicationSourceSnapshot["documents"],
  signal: AbortSignal | undefined,
): Promise<void> {
  await boundedMap(documents, async (document) => {
    try {
      const current = await readStableFileDigest(root, document.path, {
        maximumBytes: LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES,
        expectedNode: document.node,
        ...(signal === undefined ? {} : { signal }),
      });
      if (
        current.byteCount !== document.byteCount
        || current.digest !== document.digest
      ) {
        fail("source-changed");
      }
    } catch (error: unknown) {
      if (error instanceof StableFileReadError) mapStableReadError(error);
      throw error;
    }
  });
}

function assertSnapshotRelation(
  input: Readonly<LedgerAuthorityPublicationInput>,
  snapshot: Readonly<LedgerAuthorityPublicationSourceSnapshot>,
): void {
  if (
    snapshot.designSurfaceId !== input.designSurfaceId
    || snapshot.documents.length !== input.documents.length
    || snapshot.documents.some((document, index) => {
      const selection = input.documents[index];
      return selection === undefined
        || document.role !== selection.role
        || document.path !== selection.path;
    })
  ) {
    fail("input");
  }
}

async function materializeDocuments(
  root: RootedDirectory,
  documents: LedgerAuthorityPublicationSourceSnapshot["documents"],
  signal: AbortSignal | undefined,
): Promise<LedgerAuthorityPublicationSourcePayload> {
  const materialized = await boundedMap<
    Readonly<LedgerAuthorityPublicationSourceDocument>,
    Readonly<LedgerAuthorityPublicationSourcePayloadMember>
  >(documents, async (document) => {
    try {
      const read = await readStrictTextFile(root, document.path, {
        maximumBytes: LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES,
        expectedNode: document.node,
        ...(signal === undefined ? {} : { signal }),
      });
      if (
        read.byteCount !== document.byteCount
        || read.digest !== document.digest
      ) {
        fail("source-changed");
      }
      const bytes = encodeUtf8(read.text);
      if (
        bytes.byteLength !== read.byteCount
        || computeSha256Digest(bytes) !== read.digest
      ) {
        fail("operation-failure");
      }
      return Object.freeze({ path: document.path, bytes });
    } catch (error: unknown) {
      if (error instanceof StableFileReadError) mapStableReadError(error);
      if (error instanceof StrictTextFileError) fail("source-profile", error);
      throw error;
    }
  });
  const first = materialized[0];
  if (first === undefined) fail("operation-failure");
  return Object.freeze([first, ...materialized.slice(1)]) as
    LedgerAuthorityPublicationSourcePayload;
}

async function withDesignRoot<Result>(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  input: Readonly<LedgerAuthorityPublicationInput>,
  operation: (root: RootedDirectory) => Promise<Result>,
): Promise<Result> {
  const root = await openDesignRoot(config, input);
  let result: Result;
  let completed = false;
  let failure: unknown;
  try {
    result = await operation(root);
    completed = true;
  } catch (error: unknown) {
    failure = error;
  }
  try {
    await root.close();
  } catch (error: unknown) {
    if (failure === undefined) failure = error;
  }
  if (failure !== undefined) {
    if (failure instanceof RootedDirectoryError) fail("source-root", failure);
    throw failure;
  }
  if (!completed) fail("operation-failure");
  return result!;
}

/** 首次严格读取全部已选择Markdown并签发有序内容描述符。 */
export async function captureLedgerAuthorityPublicationSource(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  input: Readonly<LedgerAuthorityPublicationInput>,
  signal: AbortSignal | undefined,
): Promise<Readonly<LedgerAuthorityPublicationSourceSnapshot>> {
  const documents = await withDesignRoot(
    config,
    input,
    (root) => captureDocuments(root, input.documents, signal),
  );
  return Object.freeze({
    designSurfaceId: input.designSurfaceId,
    documents,
  });
}

/** 重新打开Design根，按原节点、大小和摘要复验全部成员均未漂移。 */
export async function revalidateLedgerAuthorityPublicationSource(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  input: Readonly<LedgerAuthorityPublicationInput>,
  snapshot: Readonly<LedgerAuthorityPublicationSourceSnapshot>,
  signal: AbortSignal | undefined,
): Promise<void> {
  assertSnapshotRelation(input, snapshot);
  await withDesignRoot(config, input, (root) =>
    revalidateDocuments(root, snapshot.documents, signal));
}

/**
 * 重新打开Design根，以首次观察的节点约束取得exact成员字节。
 *
 * 返回值不缓存、不写盘；调用方若改写bytes，Store仍会按Record digest重新拒绝。
 */
export async function materializeLedgerAuthorityPublicationSourcePayload(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  input: Readonly<LedgerAuthorityPublicationInput>,
  snapshot: Readonly<LedgerAuthorityPublicationSourceSnapshot>,
  signal: AbortSignal | undefined,
): Promise<LedgerAuthorityPublicationSourcePayload> {
  assertSnapshotRelation(input, snapshot);
  return withDesignRoot(config, input, (root) =>
    materializeDocuments(root, snapshot.documents, signal));
}
