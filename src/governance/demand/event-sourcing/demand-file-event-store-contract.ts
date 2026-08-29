import { types } from "node:util";

import type { Sha256Digest } from "../../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../../foundation/data/passive-own-data.js";
import type { FileNodeSnapshot } from "../../../foundation/filesystem/file-node-snapshot.js";
import { parseByteCount } from "../../../foundation/numeric/byte-count.js";
import {
  renderDemandEventStreamCommit,
  type DemandEventStreamCommit,
} from "./demand-event-stream-commit.js";
import type {
  DemandEventCommitSequence,
  DemandEventStreamRevision,
} from "./demand-event-stream-position.js";

/** Demand 文件事件存储的容量、回执和稳定错误合同。 */

export const DEMAND_FILE_EVENT_STORE_DIRECTORY_MODE = 0o700;
export const DEMAND_FILE_EVENT_STORE_FILE_MODE = 0o600;
export const DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS = 10_000;
export const DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMIT_BYTES = parseByteCount(
  16 * 1024 * 1024,
  "$demandFileEventStore.maximumCommitBytes",
);
export const DEMAND_FILE_EVENT_STORE_MAXIMUM_TOTAL_BYTES = parseByteCount(
  64 * 1024 * 1024,
  "$demandFileEventStore.maximumTotalBytes",
);

export interface DemandFileEventStoreCursor {
  readonly commitSequence: DemandEventCommitSequence;
  readonly streamRevision: DemandEventStreamRevision;
  readonly lastCommitDigest: Sha256Digest;
}

export interface DemandFileEventStoreReadResult {
  readonly commits: readonly Readonly<DemandEventStreamCommit>[];
  readonly cursor: Readonly<DemandFileEventStoreCursor> | null;
}

export interface DemandFileEventStoreTailReadResult {
  readonly anchorCommit: Readonly<DemandEventStreamCommit>;
  readonly commits: readonly Readonly<DemandEventStreamCommit>[];
  readonly cursor: Readonly<DemandFileEventStoreCursor>;
}

export interface DemandFileEventStoreAppendReceipt {
  readonly disposition: "committed" | "idempotent";
  readonly commitSequence: DemandEventCommitSequence;
  readonly streamRevision: number;
  readonly commitDigest: Sha256Digest;
}

export interface DemandFileEventStoreCandidateRecoveryReceipt {
  readonly retiredCount: number;
  readonly committedResidueCount: number;
  readonly durabilitySettledCommitCount: number;
  readonly rolledBackCount: number;
  readonly loserCount: number;
}

export type DemandFileEventStoreErrorReason =
  | "input"
  | "root-scope"
  | "not-initialized"
  | "node-policy"
  | "capacity"
  | "stream-invalid"
  | "stream-changed"
  | "candidate-conflict"
  | "candidate-busy"
  | "concurrency-conflict"
  | "append-identity-conflict"
  | "append-provenance-conflict"
  | "commit-uncertain"
  | "cleanup-required"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  "input": "Demand File Event Store input is invalid.",
  "root-scope": "Demand File Event Store root changed during the operation.",
  "not-initialized": "Demand File Event Store directories are not initialized.",
  "node-policy": "Demand File Event Store resource violates its private node policy.",
  "capacity": "Demand File Event Store exceeds its bounded capacity.",
  "stream-invalid": "Demand File Event Store commit stream is invalid.",
  "stream-changed": "Demand File Event Store commit stream changed during observation.",
  "candidate-conflict": "Demand File Event Store append candidate differs from the requested commit.",
  "candidate-busy": "Demand File Event Store append candidate is already in progress.",
  "concurrency-conflict": "Demand File Event Store expected stream cursor is stale.",
  "append-identity-conflict": "Demand File Event Store append reuses an immutable commit or event identity.",
  "append-provenance-conflict": "Demand File Event Store prepared aggregate does not match the persisted stream tail.",
  "commit-uncertain": "Demand File Event Store commit point cannot be proven exact.",
  "cleanup-required": "Demand File Event Store committed but candidate retirement requires recovery.",
  "aborted": "Demand File Event Store operation was aborted before its next commit point.",
  "operation-failure": "Demand File Event Store operation failed.",
} as const satisfies Readonly<Record<DemandFileEventStoreErrorReason, string>>;

export class DemandFileEventStoreError extends Error {
  override readonly name = "DemandFileEventStoreError";
  readonly code = "wakeflow-demand-file-event-store" as const;
  readonly reason: DemandFileEventStoreErrorReason;
  readonly path: string;

  constructor(reason: DemandFileEventStoreErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface DemandFileEventStoreOptions {
  readonly signal: AbortSignal | undefined;
}

function currentUserId(): bigint | null {
  return typeof process.geteuid === "function"
    ? BigInt(process.geteuid())
    : null;
}

export function failDemandFileEventStore(
  reason: DemandFileEventStoreErrorReason,
  path: string,
): never {
  throw new DemandFileEventStoreError(reason, path);
}

export function parseDemandFileEventStoreOptions(
  value: unknown,
): Readonly<DemandFileEventStoreOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      failDemandFileEventStore("input", "$options");
    }
    throw error;
  }
  if (
    Object.keys(record).some((key) => key !== "signal")
    || (
      record.signal !== undefined
      && (
        typeof record.signal !== "object"
        || record.signal === null
        || types.isProxy(record.signal)
        || !(record.signal instanceof AbortSignal)
      )
    )
  ) {
    failDemandFileEventStore("input", "$options");
  }
  return Object.freeze({ signal: record.signal as AbortSignal | undefined });
}

export function assertDemandFileEventStoreDirectory(
  node: Readonly<FileNodeSnapshot>,
  path: string,
): void {
  if (
    node.kind !== "directory"
    || node.permissionBits !== DEMAND_FILE_EVENT_STORE_DIRECTORY_MODE
    || (currentUserId() !== null && node.userId !== currentUserId())
  ) {
    failDemandFileEventStore("node-policy", path);
  }
}

export function assertDemandFileEventStoreFile(
  node: Readonly<FileNodeSnapshot>,
  path: string,
  admittedLinkCounts: readonly bigint[] = [1n],
): void {
  if (
    node.kind !== "file"
    || node.permissionBits !== DEMAND_FILE_EVENT_STORE_FILE_MODE
    || !admittedLinkCounts.includes(node.linkCount)
    || (currentUserId() !== null && node.userId !== currentUserId())
  ) {
    failDemandFileEventStore("node-policy", path);
  }
}

export function sameDemandEventStreamCommit(
  left: Readonly<DemandEventStreamCommit>,
  right: Readonly<DemandEventStreamCommit>,
): boolean {
  return renderDemandEventStreamCommit(left)
    === renderDemandEventStreamCommit(right);
}
