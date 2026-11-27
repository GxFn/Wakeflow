import type { Sha256Digest } from "../../../foundation/crypto/sha256.js";
import { type Fail, failWith, ModuleError } from "../../../foundation/error/module-error.js";
import type { FileNodeSnapshot } from "../../../foundation/filesystem/file-node-snapshot.js";
import {
  isPrivateDirectory,
  isPrivateFile,
} from "../../../foundation/filesystem/private-node-policy.js";
import { parseByteCount } from "../../../foundation/numeric/byte-count.js";
import {
  type DemandEventStreamCommit,
  renderDemandEventStreamCommit,
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
  | "operation-failure";

export class DemandFileEventStoreError extends ModuleError<DemandFileEventStoreErrorReason> {
  static override readonly code = "wakeflow-demand-file-event-store";
}

export const failDemandFileEventStore: Fail<DemandFileEventStoreErrorReason> =
  failWith(DemandFileEventStoreError);

export function assertDemandFileEventStoreDirectory(
  node: Readonly<FileNodeSnapshot>,
  path: string,
): void {
  if (!isPrivateDirectory(node)) failDemandFileEventStore("node-policy", path);
}

export function assertDemandFileEventStoreFile(
  node: Readonly<FileNodeSnapshot>,
  path: string,
  admittedLinkCounts: readonly bigint[] = [1n],
): void {
  if (!isPrivateFile(node, admittedLinkCounts)) failDemandFileEventStore("node-policy", path);
}

export function sameDemandEventStreamCommit(
  left: Readonly<DemandEventStreamCommit>,
  right: Readonly<DemandEventStreamCommit>,
): boolean {
  return renderDemandEventStreamCommit(left) === renderDemandEventStreamCommit(right);
}
