import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { DeterministicJsonDocumentError } from "../../foundation/data/deterministic-json-document.js";
import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
  replaceFileAtomically,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  StableFileReadError,
  type StableFileSource,
} from "../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { fail } from "../../kernel/error.js";

/**
 * Wakeflow Workspace / Window Runtime：窗口运行投影文档的落盘与零写检查。
 *
 * 投影是派生数据：登记、替换、退役与对账都用当前权威重算一份确定性 JSON 文档并整体替换。
 * 本模块只认字节：磁盘文档与目标文档相同即 `current`，是合法确定性 JSON 但内容不同即
 * `stale`，不存在即 `missing`，读不出、不是普通文件或不是确定性 JSON 即 `unsafe`。
 * 谁来决定目标文档（未登记还是已登记）由调用方负责。
 */

export const WAKEFLOW_WINDOW_RUNTIME_PROJECTION_MAXIMUM_BYTES = parseByteCount(
  256 * 1024,
  "$projection.maximumBytes",
);
export const WAKEFLOW_WINDOW_RUNTIME_PROJECTION_FILE_MODE = 0o600;

export interface WakeflowWindowRuntimeProjectionDocumentTarget {
  readonly resourceRef: PortableResourcePath;
  readonly document: string;
  readonly documentDigest: Sha256Digest;
  readonly projectionDigest: Sha256Digest;
}

export interface WakeflowWindowRuntimeProjectionDocumentReceipt {
  readonly resourceRef: PortableResourcePath;
  readonly projectionDigest: Sha256Digest;
  readonly documentDigest: Sha256Digest;
  readonly disposition: "current" | "created" | "replaced";
}

export interface WakeflowWindowRuntimeProjectionDocumentInspection {
  readonly resourceRef: PortableResourcePath;
  readonly status: "current" | "stale" | "missing" | "unsafe";
  readonly currentDigest: Sha256Digest | null;
  readonly source: Readonly<StableFileSource> | null;
}

type CurrentDocument = Awaited<ReturnType<typeof readDeterministicJsonFile>>;

function sourceOf(current: CurrentDocument): Readonly<StableFileSource> {
  return Object.freeze({
    resourcePath: current.resourcePath,
    node: current.node,
    byteCount: current.byteCount,
    digest: current.digest,
  });
}

/** 零写判定磁盘上的投影文档相对目标文档的状态；任何读不稳的文档都是 `unsafe`。 */
export async function inspectWakeflowWindowRuntimeProjectionDocument(
  root: RootedDirectory,
  target: Readonly<WakeflowWindowRuntimeProjectionDocumentTarget>,
  signal: AbortSignal | undefined,
): Promise<Readonly<WakeflowWindowRuntimeProjectionDocumentInspection>> {
  let current: CurrentDocument;
  try {
    current = await readDeterministicJsonFile(root, target.resourceRef, {
      maximumBytes: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_MAXIMUM_BYTES,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal");
      if (error.reason === "not-found") {
        return Object.freeze({
          resourceRef: target.resourceRef,
          status: "missing" as const,
          currentDigest: null,
          source: null,
        });
      }
      if (error.reason === "root-scope" || error.reason === "input") {
        fail("io-failure", `projection-read-${error.reason}`, "$projection", { cause: error });
      }
    }
    if (
      error instanceof StableFileReadError
      || error instanceof StrictTextFileError
      || error instanceof DeterministicJsonDocumentError
    ) {
      return Object.freeze({
        resourceRef: target.resourceRef,
        status: "unsafe" as const,
        currentDigest: null,
        source: null,
      });
    }
    throw error;
  }
  return Object.freeze({
    resourceRef: target.resourceRef,
    status: current.text === target.document ? ("current" as const) : ("stale" as const),
    currentDigest: current.digest,
    source: sourceOf(current),
  });
}

/** 让磁盘上的投影文档等于目标文档；已相等则不写。 */
export async function publishWakeflowWindowRuntimeProjectionDocument(
  root: RootedDirectory,
  target: Readonly<WakeflowWindowRuntimeProjectionDocumentTarget>,
  signal: AbortSignal | undefined,
): Promise<Readonly<WakeflowWindowRuntimeProjectionDocumentReceipt>> {
  const options = signal === undefined ? {} : { signal };
  let current: CurrentDocument | null = null;
  try {
    current = await readDeterministicJsonFile(root, target.resourceRef, {
      maximumBytes: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_MAXIMUM_BYTES,
      ...options,
    });
  } catch (error: unknown) {
    if (!(error instanceof StableFileReadError && error.reason === "not-found")) {
      if (error instanceof StableFileReadError) {
        fail("io-failure", `projection-read-${error.reason}`, "$projection", { cause: error });
      }
      throw error;
    }
  }
  const bytes = encodeUtf8(target.document, "$projection");
  let disposition: WakeflowWindowRuntimeProjectionDocumentReceipt["disposition"] = "current";
  try {
    if (current === null) {
      await createFileAtomically(root, target.resourceRef, bytes, {
        mode: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_FILE_MODE,
        ...options,
      });
      disposition = "created";
    } else if (current.text !== target.document) {
      await replaceFileAtomically(root, target.resourceRef, bytes, {
        mode: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_FILE_MODE,
        expected: sourceOf(current),
        ...options,
      });
      disposition = "replaced";
    }
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) {
      fail("io-failure", `projection-write-${error.reason}`, "$projection", { cause: error });
    }
    throw error;
  }
  return Object.freeze({
    resourceRef: target.resourceRef,
    projectionDigest: target.projectionDigest,
    documentDigest: target.documentDigest,
    disposition,
  });
}
