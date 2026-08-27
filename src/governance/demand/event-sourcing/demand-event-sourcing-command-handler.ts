import { types } from "node:util";

import type { Sha256Digest } from "../../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../../foundation/data/passive-own-data.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../../foundation/identity/wakeflow-durable-id.js";
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
import {
  DemandFileEventStoreError,
} from "./demand-file-event-store.js";

/**
 * Wakeflow Governance / Demand Event Sourcing：标准命令执行管线。
 *
 * 固定顺序为“加载 → 决策 → 演进并准备 → 按预期游标追加”。命令摘要只能从已准入
 * 命令计算；使用相同 `commitId` 重试时，处理程序会在再次执行领域转换前先解析已有
 * 提交记录。命令处理程序不接受持久化事件、不写入快照，也不执行外部副作用。
 */

export interface ExecuteDemandEventSourcingCommandOptions {
  readonly commitId: WakeflowDurableId<"demand-event-commit">;
  readonly expectedStreamRevision?: number;
  readonly signal?: AbortSignal;
}

export interface DemandEventSourcingCommandResult {
  readonly disposition: "committed" | "idempotent";
  readonly command: Readonly<DemandEventSourcingCommand>;
  readonly commandDigest: Sha256Digest;
  readonly commit: Readonly<DemandEventStreamCommit>;
  readonly aggregate: Readonly<DemandEventSourcingAggregate>;
}

export type DemandEventSourcingCommandHandlerErrorReason =
  | "input"
  | "idempotency-conflict"
  | "concurrency-conflict"
  | "decision-rejected"
  | "stream"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  "input": "Demand Event Sourcing Command Handler input is invalid.",
  "idempotency-conflict": "Demand Event Sourcing commitId is already bound to another command.",
  "concurrency-conflict": "Demand Event Sourcing command expected a stale stream revision.",
  "decision-rejected": "Demand Event Sourcing command is not admitted from current state.",
  "stream": "Demand Event Sourcing command cannot load or append its stream.",
  "aborted": "Demand Event Sourcing command was aborted before its next commit point.",
  "operation-failure": "Demand Event Sourcing command execution failed.",
} as const satisfies Readonly<Record<
  DemandEventSourcingCommandHandlerErrorReason,
  string
>>;

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
  "signal",
]);

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
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof DemandEventSourcingRepository)
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
    !Object.hasOwn(record, "commitId")
    || Object.keys(record).some((key) => !OPTION_FIELDS.has(key))
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
  if (
    expected !== undefined
    && (!Number.isSafeInteger(expected) || (expected as number) < 0)
  ) {
    fail("input", "$/expectedStreamRevision");
  }
  const signal = record.signal;
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    fail("input", "$/signal");
  }
  return Object.freeze({
    commitId,
    ...(expected === undefined
      ? {}
      : { expectedStreamRevision: expected as number }),
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

  let loaded;
  try {
    loaded = await repository.load(
      options.signal === undefined ? undefined : { signal: options.signal },
    );
  } catch (error: unknown) {
    mapRepositoryError(error);
  }
  const current = loaded?.aggregate ?? null;
  const currentRevision = current?.streamRevision ?? 0;
  if (
    options.expectedStreamRevision !== undefined
    && options.expectedStreamRevision !== currentRevision
  ) {
    // 正常新命令不扫描不可变前缀；只有过期预期可能表示重试，
    // 此时才按 `commitId` 执行有界历史查找。
    let existing: Readonly<DemandEventStreamCommit> | null;
    try {
      existing = await repository.findCommitById(
        options.commitId,
        options.signal === undefined ? undefined : { signal: options.signal },
      );
    } catch (error: unknown) {
      mapRepositoryError(error);
    }
    if (existing === null) {
      fail("concurrency-conflict", "$/expectedStreamRevision");
    }
    if (
      existing.commandDigest !== commandDigest
      || existing.expectedStreamRevision !== options.expectedStreamRevision
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
  return Object.freeze({
    disposition: receipt.disposition,
    command,
    commandDigest,
    commit: prepared.commit,
    aggregate: prepared.aggregate,
  });
}
