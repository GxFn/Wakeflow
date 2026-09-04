import { types } from "node:util";

import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../../foundation/data/passive-own-data.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../../contracts/identity/wakeflow-durable-id.js";
import {
  computeDemandEventSourcingCommandDigest,
  decideDemandEventSourcingCommand,
  parseDemandEventSourcingCommand,
  DemandEventSourcingDecisionError,
  type DemandEventSourcingCommand,
} from "./demand-event-sourcing-decider.js";
import {
  prepareDemandEventStreamCommit,
  DemandEventStreamCommitError,
  type DemandEventStreamCommit,
} from "./demand-event-stream-commit.js";
import type { DemandEventSourcingAggregate } from "./demand-event-sourcing-aggregate.js";
import {
  DemandEventSourcingRepository,
  DemandEventSourcingRepositoryError,
} from "./demand-event-sourcing-repository.js";
import { DemandFileEventStoreError } from "./demand-file-event-store.js";

/**
 * Wakeflow Governance / Demand Event Sourcing：标准命令执行管线。
 *
 * 固定顺序为“加载 → 决策 → 演进并准备 → 按预期游标追加 → 刷新快照”。命令摘要只能
 * 从已准入命令计算；使用相同 `commitId` 重试时，处理程序会在再次执行领域转换前先
 * 解析已有提交记录。快照按 ADR-0005 在每次成功追加后刷新，刷新失败不改变提交。
 */

export interface ExecuteDemandEventSourcingCommandOptions {
  readonly commitId: WakeflowDurableId<"demand-event-commit">;
  readonly expectedStreamRevision: number;
  /**
   * 客户端幂等绑定：同键同请求摘要的重试返回首次结果，同键不同摘要以
   * `idempotency-conflict` 拒绝。键随提交持久化并进入索引。
   */
  readonly idempotency?: Readonly<{
    readonly key: string;
    readonly requestDigest: Sha256Digest;
  }>;
  readonly signal?: AbortSignal;
}

export interface DemandEventSourcingCommandResult {
  readonly disposition: "committed" | "idempotent";
  readonly command: Readonly<DemandEventSourcingCommand>;
  readonly commandDigest: Sha256Digest;
  readonly commit: Readonly<DemandEventStreamCommit>;
  readonly aggregate: Readonly<DemandEventSourcingAggregate>;
  /** 提交后的快照刷新结果；快照是可重建缓存，`stale` 不影响提交有效性。 */
  readonly checkpoint: "refreshed" | "stale" | "unchanged";
}

export type DemandEventSourcingCommandHandlerErrorReason =
  | "input"
  | "idempotency-conflict"
  | "concurrency-conflict"
  | "decision-rejected"
  | "stream"
  | "aborted";

const ERROR_MESSAGES = {
  input: "Demand Event Sourcing Command Handler input is invalid.",
  "idempotency-conflict":
    "Demand Event Sourcing commitId is already bound to another command.",
  "concurrency-conflict":
    "Demand Event Sourcing command expected a stale stream revision.",
  "decision-rejected":
    "Demand Event Sourcing command is not admitted from current state.",
  stream: "Demand Event Sourcing command cannot load or append its stream.",
  aborted:
    "Demand Event Sourcing command was aborted before its next commit point.",
} as const satisfies Readonly<
  Record<DemandEventSourcingCommandHandlerErrorReason, string>
>;

export class DemandEventSourcingCommandHandlerError extends Error {
  override readonly name = "DemandEventSourcingCommandHandlerError";
  readonly code = "wakeflow-demand-event-sourcing-command-handler" as const;
  readonly reason: DemandEventSourcingCommandHandlerErrorReason;
  readonly path: string;

  constructor(
    reason: DemandEventSourcingCommandHandlerErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const OPTION_FIELDS = new Set([
  "commitId",
  "expectedStreamRevision",
  "idempotency",
  "signal",
]);
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;

function fail(
  reason: DemandEventSourcingCommandHandlerErrorReason,
  path: string,
): never {
  throw new DemandEventSourcingCommandHandlerError(reason, path);
}

function assertRepository(
  value: unknown,
): asserts value is DemandEventSourcingRepository {
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    !(value instanceof DemandEventSourcingRepository)
  ) {
    fail("input", "$repository");
  }
}

function parseOptions(
  value: unknown,
): Readonly<ExecuteDemandEventSourcingCommandOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (
    !Object.hasOwn(record, "commitId") ||
    !Object.hasOwn(record, "expectedStreamRevision") ||
    Object.keys(record).some((key) => !OPTION_FIELDS.has(key))
  ) {
    fail("input", "$options");
  }
  let commitId: WakeflowDurableId<"demand-event-commit">;
  try {
    commitId = parseWakeflowDurableIdOfKind(
      record.commitId,
      "demand-event-commit",
      "$/commitId",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("input", "$/commitId");
    throw error;
  }
  const expected = record.expectedStreamRevision;
  if (!Number.isSafeInteger(expected) || (expected as number) < 0) {
    fail("input", "$/expectedStreamRevision");
  }
  const signal = record.signal;
  if (
    signal !== undefined &&
    (types.isProxy(signal) || !(signal instanceof AbortSignal))
  ) {
    fail("input", "$/signal");
  }
  let idempotency: ExecuteDemandEventSourcingCommandOptions["idempotency"];
  if (record.idempotency !== undefined) {
    let bound: Readonly<Record<string, unknown>>;
    try {
      bound = parsePlainRecord(record.idempotency, "$/idempotency");
    } catch (error: unknown) {
      if (error instanceof PassiveOwnDataError) fail("input", "$/idempotency");
      throw error;
    }
    if (
      Object.keys(bound).sort().join(",") !== "key,requestDigest" ||
      typeof bound.key !== "string" ||
      !IDEMPOTENCY_KEY_PATTERN.test(bound.key)
    ) {
      fail("input", "$/idempotency");
    }
    let requestDigest: Sha256Digest;
    try {
      requestDigest = parseSha256Digest(bound.requestDigest, "$/idempotency/requestDigest");
    } catch (error: unknown) {
      if (error instanceof Sha256Error) fail("input", "$/idempotency/requestDigest");
      throw error;
    }
    idempotency = Object.freeze({ key: bound.key, requestDigest });
  }
  return Object.freeze({
    commitId,
    expectedStreamRevision: expected as number,
    ...(idempotency === undefined ? {} : { idempotency }),
    ...(signal === undefined ? {} : { signal }),
  });
}

function mapRepositoryError(error: unknown): never {
  if (error instanceof DemandEventSourcingRepositoryError) {
    if (error.reason === "aborted") fail("aborted", "$signal");
    fail("stream", "$repository");
  }
  if (error instanceof DemandFileEventStoreError) {
    if (error.reason === "aborted") fail("aborted", "$signal");
    if (error.reason === "concurrency-conflict") {
      fail("concurrency-conflict", "$commit");
    }
    if (error.reason === "append-identity-conflict") {
      fail(
        "idempotency-conflict",
        error.path === "$commit/commitId" ? "$/commitId" : "$command/eventId",
      );
    }
    fail("stream", "$eventStore");
  }
  throw error;
}

async function loadAggregateForCommand(
  repository: DemandEventSourcingRepository,
  signal: AbortSignal | undefined,
) {
  // 同Commit并发winner完成link到退休双链接candidate之间，reader可短暂
  // 保守报告stream。只对该错误最多三次完整重读；不等待、不宽松校验。
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await repository.load(
        signal === undefined ? undefined : { signal },
      );
    } catch (error: unknown) {
      if (
        error instanceof DemandEventSourcingRepositoryError &&
        error.reason === "stream" &&
        attempt < 3
      ) {
        continue;
      }
      mapRepositoryError(error);
    }
  }
  fail("stream", "$repository");
}

async function findCommitForCommand(
  repository: DemandEventSourcingRepository,
  commitId: WakeflowDurableId<"demand-event-commit">,
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandEventStreamCommit> | null> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await repository.findCommitById(
        commitId,
        signal === undefined ? undefined : { signal },
      );
    } catch (error: unknown) {
      if (
        error instanceof DemandEventSourcingRepositoryError &&
        error.reason === "stream" &&
        attempt < 3
      ) {
        continue;
      }
      mapRepositoryError(error);
    }
  }
  fail("stream", "$repository");
}

/** 执行一条 Demand 命令；所有领域转换都在任何文件副作用之前完成。 */
export async function executeDemandEventSourcingCommand(
  repository: DemandEventSourcingRepository,
  commandValue: unknown,
  optionsValue: ExecuteDemandEventSourcingCommandOptions,
): Promise<Readonly<DemandEventSourcingCommandResult>> {
  assertRepository(repository);
  const options = parseOptions(optionsValue);
  let command: Readonly<DemandEventSourcingCommand>;
  try {
    command = parseDemandEventSourcingCommand(commandValue);
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingDecisionError) {
      fail("input", "$command");
    }
    throw error;
  }
  const commandDigest = computeDemandEventSourcingCommandDigest(command);
  if (options.signal?.aborted === true) fail("aborted", "$signal");

  if (options.idempotency !== undefined) {
    // 客户端键先于任何领域转换解析：同键同摘要即首次结果，同键异摘要即冲突。
    let bound: Readonly<DemandEventStreamCommit> | null;
    try {
      bound = await repository.findCommitByIdempotencyKey(
        options.idempotency.key,
        options.signal === undefined ? undefined : { signal: options.signal },
      );
    } catch (error: unknown) {
      mapRepositoryError(error);
    }
    if (bound !== null) {
      if (bound.idempotency?.requestDigest !== options.idempotency.requestDigest) {
        fail("idempotency-conflict", "$/idempotency/key");
      }
      const current = await loadAggregateForCommand(repository, options.signal);
      if (current === null) fail("stream", "$repository");
      return Object.freeze({
        disposition: "idempotent",
        command,
        commandDigest,
        commit: bound,
        aggregate: current.aggregate,
        checkpoint: "unchanged",
      });
    }
  }

  const loaded = await loadAggregateForCommand(repository, options.signal);
  const current = loaded?.aggregate ?? null;
  const currentRevision = current?.streamRevision ?? 0;
  if (options.expectedStreamRevision !== currentRevision) {
    // 正常新命令不扫描不可变前缀；只有过期预期可能表示重试，
    // 此时才按 `commitId` 执行有界历史查找。
    const existing = await findCommitForCommand(
      repository,
      options.commitId,
      options.signal,
    );
    if (existing === null) {
      fail("concurrency-conflict", "$/expectedStreamRevision");
    }
    if (
      existing.commandDigest !== commandDigest ||
      existing.expectedStreamRevision !== options.expectedStreamRevision
    ) {
      fail("idempotency-conflict", "$/commitId");
    }
    if (loaded === null) fail("stream", "$repository");
    return Object.freeze({
      disposition: "idempotent",
      command,
      commandDigest,
      commit: existing,
      aggregate: loaded.aggregate,
      checkpoint: "unchanged",
    });
  }
  let events;
  try {
    events = decideDemandEventSourcingCommand(current?.state ?? null, command);
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingDecisionError) {
      fail("decision-rejected", "$command");
    }
    throw error;
  }
  let prepared;
  try {
    prepared = prepareDemandEventStreamCommit(current, {
      commitId: options.commitId,
      commandDigest,
      events,
      ...(options.idempotency === undefined
        ? {}
        : { idempotency: options.idempotency }),
    });
  } catch (error: unknown) {
    if (error instanceof DemandEventStreamCommitError) {
      fail("decision-rejected", "$command");
    }
    throw error;
  }
  let receipt;
  try {
    receipt = await repository.appendPreparedCommit(
      prepared,
      options.signal === undefined ? undefined : { signal: options.signal },
    );
  } catch (error: unknown) {
    mapRepositoryError(error);
  }
  let checkpoint: DemandEventSourcingCommandResult["checkpoint"] = "unchanged";
  if (receipt.disposition === "committed") {
    try {
      await repository.refreshCheckpoints(
        prepared.aggregate,
        options.signal === undefined ? undefined : { signal: options.signal },
      );
      checkpoint = "refreshed";
    } catch (error: unknown) {
      if (!(error instanceof DemandEventSourcingRepositoryError)) throw error;
      checkpoint = "stale";
    }
  }
  return Object.freeze({
    disposition: receipt.disposition,
    command,
    commandDigest,
    commit: prepared.commit,
    aggregate: prepared.aggregate,
    checkpoint,
  });
}
