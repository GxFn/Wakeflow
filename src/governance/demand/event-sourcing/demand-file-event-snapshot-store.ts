import { types } from "node:util";
import pLimit from "p-limit";

import type { Sha256Digest } from "../../../foundation/crypto/sha256.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
} from "../../../foundation/filesystem/durable-atomic-file-write.js";
import {
  recoverDurableAtomicFileStagesInDirectory,
  DurableAtomicFileStageRecoveryError,
  type DurableAtomicFileStageRecoveryReceipt,
} from "../../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import { readDeterministicJsonFile } from "../../../foundation/filesystem/deterministic-json-file.js";
import { StableFileReadError } from "../../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../../foundation/filesystem/strict-text-file.js";
import { DeterministicJsonDocumentError } from "../../../foundation/data/deterministic-json-document.js";
import {
  sameFileNodeSnapshot,
  type FileNodeSnapshot,
} from "../../../foundation/filesystem/file-node-snapshot.js";
import type { PortableResourcePath } from "../../../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
  type StableDirectoryReadResult,
} from "../../../foundation/filesystem/stable-directory-read.js";
import { parseByteCount } from "../../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../../foundation/text/utf8.js";
import {
  parseDemandEventStreamCommitFileName,
} from "./demand-event-stream-commit.js";
import type { DemandEventCommitSequence } from "./demand-event-sourcing-aggregate.js";
import {
  parseDemandEventSourcingSnapshot,
  parseDemandEventSourcingSnapshotDocument,
  computeDemandEventSourcingSnapshotDigest,
  renderDemandEventSourcingSnapshot,
  DemandEventSourcingSnapshotError,
  type DemandEventSourcingSnapshot,
} from "./demand-event-sourcing-snapshot.js";
import {
  demandEventSourcingSnapshotRef,
  DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF,
} from "./demand-event-sourcing-paths.js";
import {
  DEMAND_FILE_EVENT_STORE_DIRECTORY_MODE,
  DEMAND_FILE_EVENT_STORE_FILE_MODE,
} from "./demand-file-event-store.js";

/**
 * Wakeflow Governance / Demand Event Sourcing：不可变快照文件存储。
 *
 * 快照存储只观察、读取和不替换目标地发布按 `commitSequence` 命名的检查点。损坏快照
 * 是可以回退的观察结果，不会修改提交事件流；遇到未知资源、符号链接或错误权限位时，
 * 存储会保守拒绝。正常读取不修复、不覆盖或删除快照。
 */

export const DEMAND_FILE_EVENT_SNAPSHOT_MAXIMUM_FILES = 10_000;
export const DEMAND_FILE_EVENT_SNAPSHOT_MAXIMUM_BYTES = parseByteCount(
  4 * 1024 * 1024,
  "$demandEventSourcingSnapshot.maximumBytes",
);
const SNAPSHOT_READ_CONCURRENCY = 4;

export type DemandFileEventSnapshotObservation =
  | Readonly<{
      readonly status: "valid";
      readonly commitSequence: DemandEventCommitSequence;
      readonly snapshot: Readonly<DemandEventSourcingSnapshot>;
      readonly node: Readonly<FileNodeSnapshot>;
    }>
  | Readonly<{
      readonly status: "invalid";
      readonly commitSequence: DemandEventCommitSequence;
      readonly snapshot: null;
      readonly node: Readonly<FileNodeSnapshot>;
    }>;

export interface DemandFileEventSnapshotReadResult {
  readonly snapshots: readonly Readonly<DemandFileEventSnapshotObservation>[];
}

export interface DemandFileEventSnapshotPublishReceipt {
  readonly disposition: "published" | "idempotent";
  readonly commitSequence: DemandEventCommitSequence;
  readonly snapshotDigest: Sha256Digest;
}

export type DemandFileEventSnapshotStoreErrorReason =
  | "input"
  | "root-scope"
  | "not-initialized"
  | "node-policy"
  | "capacity"
  | "inventory"
  | "stream-changed"
  | "conflict"
  | "recovery-required"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  "input": "Demand Event Sourcing Snapshot Store input is invalid.",
  "root-scope": "Demand Event Sourcing Snapshot Store root changed.",
  "not-initialized": "Demand Event Sourcing snapshots directory is not initialized.",
  "node-policy": "Demand Event Sourcing snapshot resource violates private node policy.",
  "capacity": "Demand Event Sourcing snapshot inventory exceeds its capacity.",
  "inventory": "Demand Event Sourcing snapshot inventory contains an unknown resource.",
  "stream-changed": "Demand Event Sourcing snapshot inventory changed during observation.",
  "conflict": "Demand Event Sourcing snapshot sequence already contains different bytes.",
  "recovery-required": "Demand Event Sourcing snapshot publication stage requires recovery.",
  "aborted": "Demand Event Sourcing snapshot operation was aborted.",
  "operation-failure": "Demand Event Sourcing snapshot operation failed.",
} as const satisfies Readonly<Record<
  DemandFileEventSnapshotStoreErrorReason,
  string
>>;

export class DemandFileEventSnapshotStoreError extends Error {
  override readonly name = "DemandFileEventSnapshotStoreError";
  readonly code = "wakeflow-demand-file-event-snapshot-store" as const;
  readonly reason: DemandFileEventSnapshotStoreErrorReason;
  readonly path: string;

  constructor(reason: DemandFileEventSnapshotStoreErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: DemandFileEventSnapshotStoreErrorReason,
  path: string,
): never {
  throw new DemandFileEventSnapshotStoreError(reason, path);
}

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
}

function assertPrivateDirectory(node: Readonly<FileNodeSnapshot>): void {
  if (
    node.kind !== "directory"
    || node.permissionBits !== DEMAND_FILE_EVENT_STORE_DIRECTORY_MODE
  ) {
    fail("node-policy", "$snapshots");
  }
}

function assertPrivateFile(
  node: Readonly<FileNodeSnapshot>,
  path: string,
): void {
  if (
    node.kind !== "file"
    || node.permissionBits !== DEMAND_FILE_EVENT_STORE_FILE_MODE
    || node.linkCount !== 1n
  ) {
    fail("node-policy", path);
  }
}

function sameDirectoryRead(
  left: Readonly<StableDirectoryReadResult<PortableResourcePath>>,
  right: Readonly<StableDirectoryReadResult<PortableResourcePath>>,
): boolean {
  return sameFileNodeSnapshot(left.directoryNode, right.directoryNode)
    && left.entries.length === right.entries.length
    && left.entries.every((entry, index) => {
      const other = right.entries[index];
      return other !== undefined
        && entry.name === other.name
        && entry.resourcePath === other.resourcePath
        && sameFileNodeSnapshot(entry.node, other.node);
    });
}

async function readDirectory(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
  expectedNode?: Readonly<FileNodeSnapshot>,
): Promise<Readonly<StableDirectoryReadResult<PortableResourcePath>>> {
  try {
    const result = await readStableResourceDirectory(
      root,
      DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF,
      {
        maximumEntries: DEMAND_FILE_EVENT_SNAPSHOT_MAXIMUM_FILES + 64,
        ...(expectedNode === undefined ? {} : { expectedNode }),
        ...(signal === undefined ? {} : { signal }),
      },
    );
    assertPrivateDirectory(result.directoryNode);
    return result;
  } catch (error: unknown) {
    if (error instanceof DemandFileEventSnapshotStoreError) throw error;
    if (error instanceof StableDirectoryReadError) {
      if (error.reason === "not-found") fail("not-initialized", "$snapshots");
      if (error.reason === "too-many-entries") fail("capacity", "$snapshots");
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "root-scope") fail("root-scope", "$root");
      fail("stream-changed", "$snapshots");
    }
    throw error;
  }
}

async function readSnapshotAt(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  sequence: DemandEventCommitSequence,
  node: Readonly<FileNodeSnapshot>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandFileEventSnapshotObservation>> {
  assertPrivateFile(node, "$snapshot");
  try {
    const read = await readDeterministicJsonFile(root, resourcePath, {
      maximumBytes: DEMAND_FILE_EVENT_SNAPSHOT_MAXIMUM_BYTES,
      expectedNode: node,
      ...(signal === undefined ? {} : { signal }),
    });
    const snapshot = parseDemandEventSourcingSnapshotDocument(read.text);
    if (snapshot.commitSequence !== sequence) {
      return Object.freeze({
        status: "invalid",
        commitSequence: sequence,
        snapshot: null,
        node: read.node,
      });
    }
    return Object.freeze({
      status: "valid",
      commitSequence: sequence,
      snapshot,
      node: read.node,
    });
  } catch (error: unknown) {
    if (error instanceof DemandFileEventSnapshotStoreError) throw error;
    if (error instanceof DemandEventSourcingSnapshotError) {
      return Object.freeze({
        status: "invalid",
        commitSequence: sequence,
        snapshot: null,
        node,
      });
    }
    if (error instanceof StableFileReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (
        error.reason === "root-scope"
        || error.reason === "unsupported-platform"
      ) {
        fail("root-scope", "$root");
      }
      if (
        error.reason === "not-found"
        || error.reason === "expectation-changed"
        || error.reason === "source-changed"
      ) {
        fail("stream-changed", "$snapshots");
      }
      if (error.reason !== "too-large") {
        fail("operation-failure", "$snapshot");
      }
    } else if (
      !(error instanceof StrictTextFileError)
      && !(error instanceof DeterministicJsonDocumentError)
    ) {
      throw error;
    }
    // 可重建快照的容量、编码、文本或 JSON 损坏时，聚合仓储可以回退。
    return Object.freeze({
      status: "invalid",
      commitSequence: sequence,
      snapshot: null,
      node,
    });
  }
}

export class DemandFileEventSnapshotStore {
  readonly #root: RootedDirectory;

  constructor(root: RootedDirectory) {
    assertRoot(root);
    this.#root = root;
  }

  /** 稳定读取所有快照观察结果，并按 `commitSequence` 升序返回。 */
  async readSnapshots(
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<DemandFileEventSnapshotReadResult>> {
    if (
      options !== undefined
      && (
        typeof options !== "object"
        || options === null
        || types.isProxy(options)
        || Object.keys(options).some((key) => key !== "signal")
        || (options.signal !== undefined && !(options.signal instanceof AbortSignal))
      )
    ) {
      fail("input", "$options");
    }
    const signal = options?.signal;
    const before = await readDirectory(this.#root, signal);
    const snapshotEntries: Array<Readonly<{
      resourcePath: PortableResourcePath;
      sequence: DemandEventCommitSequence;
      node: Readonly<FileNodeSnapshot>;
    }>> = [];
    for (const [index, entry] of before.entries.entries()) {
      let parsed;
      try {
        parsed = parseDemandEventStreamCommitFileName(entry.name);
      } catch {
        fail("inventory", `$snapshots/${index}`);
      }
      snapshotEntries.push(Object.freeze({
        resourcePath: entry.resourcePath,
        sequence: parsed.commitSequence,
        node: entry.node,
      }));
    }
    if (snapshotEntries.length > DEMAND_FILE_EVENT_SNAPSHOT_MAXIMUM_FILES) {
      fail("capacity", "$snapshots");
    }
    const limit = pLimit(SNAPSHOT_READ_CONCURRENCY);
    const snapshots = await Promise.all(snapshotEntries.map((entry) => (
      limit(() => readSnapshotAt(
        this.#root,
        entry.resourcePath,
        entry.sequence,
        entry.node,
        signal,
      ))
    )));
    const after = await readDirectory(this.#root, signal, before.directoryNode);
    if (!sameDirectoryRead(before, after)) fail("stream-changed", "$snapshots");
    return Object.freeze({
      snapshots: Object.freeze(snapshots),
    });
  }

  /** 显式恢复快照父目录中不再活动的原子发布暂存文件。 */
  async recoverPublicationStages(
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<DurableAtomicFileStageRecoveryReceipt>> {
    if (
      options !== undefined
      && (
        typeof options !== "object"
        || options === null
        || types.isProxy(options)
        || Object.keys(options).some((key) => key !== "signal")
        || (options.signal !== undefined && !(options.signal instanceof AbortSignal))
      )
    ) {
      fail("input", "$options");
    }
    try {
      const receipt = await recoverDurableAtomicFileStagesInDirectory(
        this.#root,
        DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF,
        options,
      );
      if (
        receipt.activeStageCount !== 0
        || receipt.unknownStageCount !== 0
      ) {
        fail("recovery-required", "$snapshots");
      }
      return receipt;
    } catch (error: unknown) {
      if (error instanceof DemandFileEventSnapshotStoreError) throw error;
      if (error instanceof DurableAtomicFileStageRecoveryError) {
        if (error.reason === "aborted") fail("aborted", "$signal");
        fail("recovery-required", "$snapshots");
      }
      throw error;
    }
  }

  /** 按 `commitSequence` 不替换目标地发布一个可重建快照。 */
  async publish(
    snapshotValue: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<DemandFileEventSnapshotPublishReceipt>> {
    let snapshot: Readonly<DemandEventSourcingSnapshot>;
    try {
      snapshot = parseDemandEventSourcingSnapshot(snapshotValue);
    } catch (error: unknown) {
      if (error instanceof DemandEventSourcingSnapshotError) {
        fail("input", "$snapshot");
      }
      throw error;
    }
    if (
      options !== undefined
      && (
        typeof options !== "object"
        || options === null
        || types.isProxy(options)
        || Object.keys(options).some((key) => key !== "signal")
        || (options.signal !== undefined && !(options.signal instanceof AbortSignal))
      )
    ) {
      fail("input", "$options");
    }
    const signal = options?.signal;
    const ref = demandEventSourcingSnapshotRef(snapshot.commitSequence);
    const text = renderDemandEventSourcingSnapshot(snapshot);
    const bytes = encodeUtf8(text);
    try {
      await createFileAtomically(this.#root, ref, bytes, {
        mode: DEMAND_FILE_EVENT_STORE_FILE_MODE,
        ...(signal === undefined ? {} : { signal }),
      });
      return Object.freeze({
        disposition: "published",
        commitSequence: snapshot.commitSequence,
        snapshotDigest: computeDemandEventSourcingSnapshotDigest(snapshot),
      });
    } catch (error: unknown) {
      if (
        !(error instanceof DurableAtomicFileWriteError)
        || error.reason !== "target-exists"
      ) {
        if (
          error instanceof DurableAtomicFileWriteError
          && error.reason === "aborted"
        ) {
          fail("aborted", "$signal");
        }
        fail("operation-failure", "$snapshot");
      }
    }
    let resource;
    try {
      resource = await this.#root.inspectExistingResource(ref);
    } catch (error: unknown) {
      if (error instanceof RootedDirectoryError) fail("root-scope", "$root");
      throw error;
    }
    const existing = await readSnapshotAt(
      this.#root,
      ref,
      snapshot.commitSequence,
      resource.node,
      signal,
    );
    if (
      existing.status !== "valid"
      || renderDemandEventSourcingSnapshot(existing.snapshot) !== text
    ) {
      fail("conflict", "$snapshot");
    }
    return Object.freeze({
      disposition: "idempotent",
      commitSequence: snapshot.commitSequence,
      snapshotDigest: computeDemandEventSourcingSnapshotDigest(snapshot),
    });
  }
}
