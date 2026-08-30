import { types } from "node:util";

import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../../contracts/identity/wakeflow-durable-id.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../../foundation/data/passive-own-data.js";
import { RootedDirectory } from "../../../foundation/filesystem/rooted-directory.js";
import {
  computeTaskPackageDigest,
} from "../../tasking/task-package.js";

import {
  applyDemandEventStreamCommit,
  DemandEventStreamCommitError,
  type DemandEventStreamCommit,
  type PreparedDemandEventStreamCommit,
} from "./demand-event-stream-commit.js";
import type {
  DemandEventSourcingAggregate,
} from "./demand-event-sourcing-aggregate.js";
import type {
  TargetTaskPlannedUncommittedEvent,
} from "./demand-event-sourcing-event.js";
import type {
  DemandEventCommitSequence,
} from "./demand-event-stream-position.js";
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
import type {
  DemandEventSourcingStoredEvent,
} from "./demand-event-sourcing-stored-event.js";
import {
  upcastDemandEventSourcingStoredEvent,
  DemandEventSourcingUpcasterError,
} from "./demand-event-sourcing-upcaster.js";

/**
 * Wakeflow Governance / Demand Event Sourcing：聚合仓储。
 *
 * 正常加载选择最新可用的不可变快照，只打开它的锚定提交和后续事件流尾部；审计始终
 * 从提交 1 完整重放。仓储不会在加载过程中写入快照、不决定命令、不访问 Ledger 或
 * TODO，也不执行 Demand 根目录发布。
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

export interface LocatedTargetTaskPlannedEvent {
  readonly storedEvent: Readonly<DemandEventSourcingStoredEvent>;
  readonly event: Readonly<TargetTaskPlannedUncommittedEvent>;
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
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
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
    fail("input", "$options");
  }
  return record.signal as AbortSignal | undefined;
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

  constructor(root: RootedDirectory) {
    if (
      typeof root !== "object"
      || root === null
      || types.isProxy(root)
      || !(root instanceof RootedDirectory)
    ) {
      fail("input", "$root");
    }
    this.#eventStore = new DemandFileEventStore(root);
    this.#snapshotStore = new DemandFileEventSnapshotStore(root);
  }

  /** 正常读取；不存在事件流时返回 `null`，读取过程中绝不创建或修复快照。 */
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

  /** 从提交 1 开始完整验证摘要链、事件转换和每一步结果状态。 */
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

  /**
   * 完整审计事件流后，按不可变 TaskPackage 身份定位唯一规划事件。
   *
   * 本查询只为可重建投影提供权威来源；它不读取投影文件，也不把 Aggregate 摘要
   * 反向扩展成 TaskPackage 内容。
   */
  async findTargetTaskPlannedEvent(
    taskPackageIdValue: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<LocatedTargetTaskPlannedEvent> | null> {
    const signal = parseSignal(options);
    let taskPackageId: WakeflowDurableId<"task-package">;
    try {
      taskPackageId = parseWakeflowDurableIdOfKind(
        taskPackageIdValue,
        "task-package",
        "$taskPackageId",
      );
    } catch (error: unknown) {
      if (error instanceof WakeflowDurableIdError) {
        fail("input", "$taskPackageId");
      }
      throw error;
    }
    let stream;
    try {
      stream = await this.#eventStore.readCommits(
        signal === undefined ? undefined : { signal },
      );
    } catch (error: unknown) {
      mapStoreError(error);
    }
    if (stream.commits.length === 0) return null;
    const aggregate = replayCommits(null, stream.commits);
    let located: Readonly<LocatedTargetTaskPlannedEvent> | undefined;
    for (const commit of stream.commits) {
      for (const storedEvent of commit.events) {
        let event;
        try {
          event = upcastDemandEventSourcingStoredEvent(storedEvent);
        } catch (error: unknown) {
          if (error instanceof DemandEventSourcingUpcasterError) {
            fail("stream", "$events");
          }
          throw error;
        }
        if (
          event.eventType !== "tasking.target-task-planned"
          || event.data.taskPackage.taskPackageId !== taskPackageId
        ) {
          continue;
        }
        if (located !== undefined) fail("stream", "$events");
        located = Object.freeze({ storedEvent, event });
      }
    }
    if (located === undefined) return null;
    const taskPackage = located.event.data.taskPackage;
    const summary = aggregate.state.targetTasks.find(
      (entry) => entry.taskPackageId === taskPackageId,
    );
    if (
      summary === undefined
      || summary.targetTaskId !== taskPackage.targetTaskId
      || summary.taskPackageDigest !== computeTaskPackageDigest(taskPackage)
      || summary.repositoryId !== taskPackage.assignment.repositoryId
      || summary.windowId !== taskPackage.assignment.windowId
      || located.storedEvent.streamRevision > aggregate.streamRevision
    ) {
      fail("stream", "$events");
    }
    return located;
  }

  /** 仅为命令重试解析 `commitId`；普通加载不会因此扫描历史。 */
  async findCommitById(
    commitIdValue: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<DemandEventStreamCommit> | null> {
    const signal = parseSignal(options);
    let commitId: WakeflowDurableId<"demand-event-commit">;
    try {
      commitId = parseWakeflowDurableIdOfKind(
        commitIdValue,
        "demand-event-commit",
        "$commitId",
      );
    } catch (error: unknown) {
      if (error instanceof WakeflowDurableIdError) fail("input", "$commitId");
      throw error;
    }
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

  /** 持久追加一条已经由决策器和状态演进逻辑完整准备的不可变提交记录。 */
  async appendPreparedCommit(
    prepared: Readonly<PreparedDemandEventStreamCommit>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<DemandFileEventStoreAppendReceipt>> {
    const signal = parseSignal(options);
    return this.#eventStore.append(
      prepared,
      signal === undefined ? undefined : { signal },
    );
  }

  /** 显式发布当前聚合的不可变检查点；该操作不属于加载副作用。 */
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
