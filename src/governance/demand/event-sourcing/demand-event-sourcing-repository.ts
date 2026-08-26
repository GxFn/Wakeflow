import { types } from "node:util";

import type { WakeflowDurableId } from "../../../foundation/identity/wakeflow-durable-id.js";

import {
  applyDemandEventStreamCommit,
  DemandEventStreamCommitError,
  type DemandEventStreamCommit,
  type PreparedDemandEventStreamCommit,
} from "./demand-event-stream-commit.js";
import type {
  DemandEventCommitSequence,
  DemandEventSourcingAggregate,
} from "./demand-event-sourcing-aggregate.js";
import {
  createDemandEventSourcingSnapshot,
  restoreDemandEventSourcingSnapshot,
  DemandEventSourcingSnapshotError,
} from "./demand-event-sourcing-snapshot.js";
import {
  DemandFileEventStore,
  DemandFileEventStoreError,
  type DemandFileEventStoreAppendReceipt,
} from "./demand-file-event-store.js";
import {
  DemandFileEventSnapshotStore,
  DemandFileEventSnapshotStoreError,
  type DemandFileEventSnapshotPublishReceipt,
} from "./demand-file-event-snapshot-store.js";

/**
 * Wakeflow Governance / Demand Event Sourcing：Aggregate Repository。
 *
 * 正常 load 选择最新可用 immutable snapshot，只打开其 anchor commit 与后续 tail；
 * audit 始终从 commit 1 完整 replay。Repository 不在 load 中写 snapshot，不决定
 * command、不访问 Ledger/TODO，也不执行 Demand root publication。
 */

export interface LoadedDemandEventSourcingAggregate {
  readonly aggregate: Readonly<DemandEventSourcingAggregate>;
  readonly snapshotStatus: "used" | "missing" | "invalid";
  readonly snapshotCommitSequence: DemandEventCommitSequence | null;
  readonly replayedCommitCount: number;
}

export interface AuditedDemandEventSourcingAggregate {
  readonly aggregate: Readonly<DemandEventSourcingAggregate>;
  readonly replayedCommitCount: number;
}

export type DemandEventSourcingRepositoryErrorReason =
  | "input"
  | "not-found"
  | "stream"
  | "snapshot"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  "input": "Demand Event Sourcing Repository input is invalid.",
  "not-found": "Demand Event Sourcing stream does not exist.",
  "stream": "Demand Event Sourcing stream cannot be rehydrated.",
  "snapshot": "Demand Event Sourcing snapshot cannot be published.",
  "aborted": "Demand Event Sourcing Repository operation was aborted.",
  "operation-failure": "Demand Event Sourcing Repository operation failed.",
} as const satisfies Readonly<Record<
  DemandEventSourcingRepositoryErrorReason,
  string
>>;

export class DemandEventSourcingRepositoryError extends Error {
  override readonly name = "DemandEventSourcingRepositoryError";
  readonly code = "wakeflow-demand-event-sourcing-repository" as const;
  readonly reason: DemandEventSourcingRepositoryErrorReason;
  readonly path: string;

  constructor(reason: DemandEventSourcingRepositoryErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: DemandEventSourcingRepositoryErrorReason,
  path: string,
): never {
  throw new DemandEventSourcingRepositoryError(reason, path);
}

function parseSignal(
  value: unknown,
): AbortSignal | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || Object.keys(value).some((key) => key !== "signal")
  ) {
    fail("input", "$options");
  }
  const signal = (value as { readonly signal?: unknown }).signal;
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    fail("input", "$options.signal");
  }
  return signal;
}

function replayCommits(
  initial: Readonly<DemandEventSourcingAggregate> | null,
  commits: readonly Readonly<DemandEventStreamCommit>[],
): Readonly<DemandEventSourcingAggregate> {
  let aggregate = initial;
  for (const [index, commit] of commits.entries()) {
    try {
      aggregate = applyDemandEventStreamCommit(aggregate, commit);
    } catch (error: unknown) {
      if (error instanceof DemandEventStreamCommitError) {
        fail("stream", `$commits/${index}`);
      }
      throw error;
    }
  }
  if (aggregate === null) fail("not-found", "$commits");
  return aggregate;
}

function mapStoreError(error: unknown): never {
  if (error instanceof DemandFileEventStoreError) {
    if (error.reason === "aborted") fail("aborted", "$signal");
    if (
      error.reason === "stream-invalid"
      || error.reason === "stream-changed"
      || error.reason === "node-policy"
      || error.reason === "capacity"
    ) {
      fail("stream", "$commits");
    }
    fail("operation-failure", "$eventStore");
  }
  if (error instanceof DemandFileEventSnapshotStoreError) {
    if (error.reason === "aborted") fail("aborted", "$signal");
    fail("operation-failure", "$snapshotStore");
  }
  throw error;
}

export class DemandEventSourcingRepository {
  readonly #eventStore: DemandFileEventStore;
  readonly #snapshotStore: DemandFileEventSnapshotStore;

  constructor(
    eventStore: DemandFileEventStore,
    snapshotStore: DemandFileEventSnapshotStore,
  ) {
    if (
      typeof eventStore !== "object"
      || eventStore === null
      || types.isProxy(eventStore)
      || !(eventStore instanceof DemandFileEventStore)
      || typeof snapshotStore !== "object"
      || snapshotStore === null
      || types.isProxy(snapshotStore)
      || !(snapshotStore instanceof DemandFileEventSnapshotStore)
    ) {
      fail("input", "$stores");
    }
    this.#eventStore = eventStore;
    this.#snapshotStore = snapshotStore;
  }

  /** 正常读取；无 stream 时返回 null，读取过程中绝不创建或修复 snapshot。 */
  async load(
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<LoadedDemandEventSourcingAggregate> | null> {
    const signal = parseSignal(options);
    let observations;
    try {
      observations = await this.#snapshotStore.readSnapshots(
        signal === undefined ? undefined : { signal },
      );
    } catch (error: unknown) {
      mapStoreError(error);
    }
    const valid = observations.snapshots
      .filter((entry) => entry.status === "valid")
      .sort((left, right) => right.commitSequence - left.commitSequence);
    let snapshotAttemptFailed = observations.snapshots.some(
      (entry) => entry.status === "invalid",
    );

    for (const observation of valid) {
      if (observation.status !== "valid") continue;
      try {
        const tail = await this.#eventStore.readCommitsAfter({
          commitSequence: observation.snapshot.commitSequence,
          streamRevision: observation.snapshot.streamRevision,
          lastCommitDigest: observation.snapshot.lastCommitDigest,
        }, signal === undefined ? undefined : { signal });
        let aggregate = restoreDemandEventSourcingSnapshot(
          observation.snapshot,
          tail.anchorCommit,
        );
        aggregate = replayCommits(aggregate, tail.commits);
        return Object.freeze({
          aggregate,
          snapshotStatus: "used" as const,
          snapshotCommitSequence: observation.snapshot.commitSequence,
          replayedCommitCount: tail.commits.length,
        });
      } catch (error: unknown) {
        if (error instanceof DemandEventSourcingSnapshotError) {
          snapshotAttemptFailed = true;
          continue;
        }
        if (
          error instanceof DemandFileEventStoreError
          && error.reason === "stream-invalid"
        ) {
          snapshotAttemptFailed = true;
          continue;
        }
        if (error instanceof DemandFileEventStoreError) mapStoreError(error);
        throw error;
      }
    }

    let stream;
    try {
      stream = await this.#eventStore.readCommits(
        signal === undefined ? undefined : { signal },
      );
    } catch (error: unknown) {
      mapStoreError(error);
    }
    if (stream.commits.length === 0) {
      if (observations.snapshots.length !== 0) fail("stream", "$snapshots");
      return null;
    }
    const aggregate = replayCommits(null, stream.commits);
    return Object.freeze({
      aggregate,
      snapshotStatus: snapshotAttemptFailed ? "invalid" as const : "missing" as const,
      snapshotCommitSequence: null,
      replayedCommitCount: stream.commits.length,
    });
  }

  /** 从 commit 1 完整验证 digest chain、event transitions 与 resulting states。 */
  async audit(
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<AuditedDemandEventSourcingAggregate>> {
    const signal = parseSignal(options);
    let stream;
    try {
      stream = await this.#eventStore.readCommits(
        signal === undefined ? undefined : { signal },
      );
    } catch (error: unknown) {
      mapStoreError(error);
    }
    if (stream.commits.length === 0) fail("not-found", "$commits");
    return Object.freeze({
      aggregate: replayCommits(null, stream.commits),
      replayedCommitCount: stream.commits.length,
    });
  }

  /** 仅为 command retry 解析 commitId；普通 load 不因此扫描历史。 */
  async findCommitById(
    commitId: WakeflowDurableId<"demand-event-commit">,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<DemandEventStreamCommit> | null> {
    const signal = parseSignal(options);
    let stream;
    try {
      stream = await this.#eventStore.readCommits(
        signal === undefined ? undefined : { signal },
      );
    } catch (error: unknown) {
      mapStoreError(error);
    }
    return stream.commits.find((commit) => commit.commitId === commitId) ?? null;
  }

  /** 持久 append 一个已由 Decider/evolve 完整准备的 immutable commit。 */
  async appendPreparedCommit(
    prepared: Readonly<PreparedDemandEventStreamCommit>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<DemandFileEventStoreAppendReceipt>> {
    const signal = parseSignal(options);
    try {
      return await this.#eventStore.append(
        prepared,
        signal === undefined ? undefined : { signal },
      );
    } catch (error: unknown) {
      if (error instanceof DemandFileEventStoreError) throw error;
      throw error;
    }
  }

  /** 显式发布当前 aggregate 的 immutable checkpoint；不属于 load 副作用。 */
  async publishSnapshot(
    aggregateValue: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<DemandFileEventSnapshotPublishReceipt>> {
    const signal = parseSignal(options);
    let snapshot;
    try {
      snapshot = createDemandEventSourcingSnapshot(aggregateValue);
    } catch (error: unknown) {
      if (error instanceof DemandEventSourcingSnapshotError) {
        fail("input", "$aggregate");
      }
      throw error;
    }
    try {
      return await this.#snapshotStore.publish(
        snapshot,
        signal === undefined ? undefined : { signal },
      );
    } catch (error: unknown) {
      if (error instanceof DemandFileEventSnapshotStoreError) {
        if (error.reason === "aborted") fail("aborted", "$signal");
        fail("snapshot", "$snapshot");
      }
      throw error;
    }
  }
}
