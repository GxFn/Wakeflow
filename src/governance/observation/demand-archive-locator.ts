import { parseSha256Digest, type Sha256Digest, Sha256Error } from "../../foundation/crypto/sha256.js";
import { DeterministicJsonDocumentError } from "../../foundation/data/deterministic-json-document.js";
import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
} from "../../foundation/filesystem/stable-directory-read.js";
import { StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { parseUtcInstant, type UtcInstant, UtcInstantError } from "../../foundation/time/utc-instant.js";
import { fail } from "../../kernel/error.js";
import { demandArchiveRef, demandArchivesRootRef } from "../../kernel/layout.js";

/**
 * Wakeflow Governance / Observation：已归档 Demand 的回执摘要（`wakeflow_status{demandId}`），
 * 也供 `archived-demand-observation.ts` 的归档观察使用。
 *
 * 只读归档清单里公开的几个字段（结局、时间、终态事件、清单摘要、pod），不解析整份清单；
 * 归档观察用 podId 做 unmergedAccepted 扫描（§13.130）。归档包本身由 demand 切片封装与读回。
 */

export interface LocatedDemandArchiveSummary {
  readonly demandId: string;
  readonly archiveRef: PortableResourcePath;
  readonly outcome: "completed" | "cancelled";
  readonly archivedAt: UtcInstant;
  readonly terminalEvent: Readonly<{ readonly eventId: string; readonly streamRevision: number }>;
  readonly manifestDigest: Sha256Digest;
  /** 归档时 Demand 所在的 pod（§13.130）；清单里没有合法值时为 null。 */
  readonly podId: string | null;
}

const ARCHIVE_NAME_PATTERN = /^[0-9]{10}$/u;
const POD_ID_PATTERN = /^pod_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAXIMUM_ARCHIVES_PER_DEMAND = 4096;
const MANIFEST_MAXIMUM_BYTES = parseByteCount(16 * 1024 * 1024, "$manifest.maximumBytes");
const EVENT_ID_PATTERN =
  /^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function signalOptions(signal: AbortSignal | undefined): { readonly signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

function record(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("precondition-failed", "archive-manifest", path);
  }
  return value as Readonly<Record<string, unknown>>;
}

function summarize(
  demandId: string,
  archiveRef: PortableResourcePath,
  value: unknown,
): Readonly<LocatedDemandArchiveSummary> {
  const manifest = record(value, "$archive/manifest");
  const terminal = record(manifest.terminalEvent, "$archive/manifest/terminalEvent");
  const outcome = manifest.outcome;
  if (outcome !== "completed" && outcome !== "cancelled") {
    fail("precondition-failed", "archive-manifest", "$archive/manifest/outcome");
  }
  if (typeof terminal.eventId !== "string" || !EVENT_ID_PATTERN.test(terminal.eventId)) {
    fail("precondition-failed", "archive-manifest", "$archive/manifest/terminalEvent/eventId");
  }
  if (!Number.isSafeInteger(terminal.streamRevision) || (terminal.streamRevision as number) < 2) {
    fail("precondition-failed", "archive-manifest", "$archive/manifest/terminalEvent/streamRevision");
  }
  let archivedAt: UtcInstant;
  let manifestDigest: Sha256Digest;
  try {
    archivedAt = parseUtcInstant(manifest.archivedAt, "$archive/manifest/archivedAt");
    manifestDigest = parseSha256Digest(manifest.manifestDigest, "$archive/manifest/manifestDigest");
  } catch (error: unknown) {
    if (error instanceof UtcInstantError || error instanceof Sha256Error) {
      fail("precondition-failed", "archive-manifest", "$archive/manifest", { cause: error });
    }
    throw error;
  }
  return Object.freeze({
    demandId,
    archiveRef,
    outcome,
    archivedAt,
    terminalEvent: Object.freeze({
      eventId: terminal.eventId,
      streamRevision: terminal.streamRevision as number,
    }),
    manifestDigest,
    podId:
      typeof manifest.podId === "string" && POD_ID_PATTERN.test(manifest.podId)
        ? manifest.podId
        : null,
  });
}

/**
 * 读回归档清单，读取失败与目录列举同形地编码：取消仍是 `io-failure`/`aborted`，
 * 其余读取与严格文本失败是 `io-failure`/`archive-manifest-<原因>`，
 * 结构坏掉的清单与 `summarize` 共用 `precondition-failed`/`archive-manifest`。
 * 基础层错误不是 WakeflowError，放任它逃逸会被外层收敛成 `unexpected`。
 */
async function readManifest(
  ledgerRoot: RootedDirectory,
  archiveRef: PortableResourcePath,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  try {
    const read = await readDeterministicJsonFile(
      ledgerRoot,
      parsePortableResourcePath(`${archiveRef}/manifest.json`, "$archive"),
      { maximumBytes: MANIFEST_MAXIMUM_BYTES, ...signalOptions(signal) },
    );
    return read.value;
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
      fail("io-failure", `archive-manifest-${error.reason}`, "$archive/manifest", { cause: error });
    }
    if (error instanceof StrictTextFileError) {
      fail("io-failure", `archive-manifest-${error.reason}`, "$archive/manifest", { cause: error });
    }
    if (error instanceof DeterministicJsonDocumentError) {
      fail("precondition-failed", "archive-manifest", "$archive/manifest", { cause: error });
    }
    throw error;
  }
}

/** 一个 Demand 最近的归档包（修订号最大者）的回执摘要；没有归档为 null。 */
export async function locateLatestDemandArchive(
  ledgerRoot: RootedDirectory,
  demandId: string,
  signal: AbortSignal | undefined,
): Promise<Readonly<LocatedDemandArchiveSummary> | null> {
  let listing: Awaited<ReturnType<typeof readStableResourceDirectory>>;
  try {
    listing = await readStableResourceDirectory(ledgerRoot, demandArchivesRootRef(demandId), {
      maximumEntries: MAXIMUM_ARCHIVES_PER_DEMAND,
      ...signalOptions(signal),
    });
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError && error.reason === "not-found") return null;
    if (error instanceof StableDirectoryReadError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
      fail("io-failure", `archive-list-${error.reason}`, "$archive", { cause: error });
    }
    throw error;
  }
  const latest = listing.entries
    .filter((entry) => entry.node.kind === "directory" && ARCHIVE_NAME_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (latest === undefined) return null;
  const archiveRef = demandArchiveRef(demandId, Number(latest));
  return summarize(demandId, archiveRef, await readManifest(ledgerRoot, archiveRef, signal));
}
