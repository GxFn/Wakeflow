import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../../foundation/filesystem/portable-resource-path.js";
import type { WakeflowDurableId } from "../../../contracts/identity/wakeflow-durable-id.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
} from "../../../contracts/identity/wakeflow-durable-id.js";
import { parseUuidV4, UuidV4Error } from "../../../foundation/identity/uuid-v4.js";
import {
  parseDemandEventCommitSequence,
  DemandEventStreamPositionError,
  type DemandEventCommitSequence,
} from "./demand-event-stream-position.js";

/**
 * Wakeflow Governance / Demand Event Sourcing：本地文件事件存储的路径词汇。
 *
 * `commits/` 只保存提交序号固定的不可变权威提交记录；`snapshots/` 只保存可删除的
 * 检查点；`append-candidates/` 只保存尚未成为权威事实的追加候选资源。
 */

export const DEMAND_EVENT_SOURCING_ROOT_REF = parsePortableResourcePath(
  "event-sourcing",
);
export const DEMAND_EVENT_SOURCING_IDENTITY_REF = parsePortableResourcePath(
  "identity.json",
);
export const DEMAND_EVENT_SOURCING_AUTHORITY_REF = parsePortableResourcePath(
  "authority.json",
);
export const DEMAND_EVENT_SOURCING_ARTIFACTS_ROOT_REF =
  parsePortableResourcePath("artifacts");
export const DEMAND_EVENT_SOURCING_TRANSACTIONS_ROOT_REF =
  parsePortableResourcePath("transactions");
export const DEMAND_EVENT_STREAM_COMMITS_ROOT_REF = parsePortableResourcePath(
  "event-sourcing/commits",
);
export const DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF =
  parsePortableResourcePath("event-sourcing/snapshots");
export const DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF =
  parsePortableResourcePath("event-sourcing/append-candidates");

const APPEND_CANDIDATE_PATTERN =
  /^(?<sequence>[0-9]{16})__(?<commitId>demand-event-commit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})__(?<pid>[1-9][0-9]*)-(?<threadId>0|[1-9][0-9]*)-(?<token>[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/u;
const APPEND_OWNER_TOKEN_PATTERN =
  /^(?<pid>[1-9][0-9]*)-(?<threadId>0|[1-9][0-9]*)-(?<token>[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
const COMMIT_FILE_PATTERN = /^(?<sequence>[0-9]{16})\.json$/u;

export type DemandEventSourcingPathErrorReason =
  | "commit-file-name"
  | "append-candidate-file-name"
  | "append-owner-token"
  | "commit-identity";

const ERROR_MESSAGES = {
  "commit-file-name": "Demand event commit filename is invalid.",
  "append-candidate-file-name": "Demand append candidate filename is invalid.",
  "append-owner-token": "Demand append candidate owner token is invalid.",
  "commit-identity": "Demand append candidate commit identity is invalid.",
} as const satisfies Readonly<Record<
  DemandEventSourcingPathErrorReason,
  string
>>;

export class DemandEventSourcingPathError extends Error {
  override readonly name = "DemandEventSourcingPathError";
  readonly code = "wakeflow-demand-event-sourcing-path" as const;
  readonly reason: DemandEventSourcingPathErrorReason;
  readonly path: string;

  constructor(reason: DemandEventSourcingPathErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface AppendOwnerToken {
  readonly pid: number;
  readonly threadId: number;
  readonly uuid: string;
  readonly token: string;
}

function fail(
  reason: DemandEventSourcingPathErrorReason,
  path: string,
): never {
  throw new DemandEventSourcingPathError(reason, path);
}

function parseAppendOwnerToken(value: unknown): Readonly<AppendOwnerToken> {
  if (typeof value !== "string") fail("append-owner-token", "$ownerToken");
  const groups = APPEND_OWNER_TOKEN_PATTERN.exec(value)?.groups;
  const pid = Number(groups?.pid);
  const threadId = Number(groups?.threadId);
  const uuid = groups?.token;
  if (
    groups === undefined
    || !Number.isSafeInteger(pid)
    || pid <= 0
    || !Number.isSafeInteger(threadId)
    || threadId < 0
    || uuid === undefined
  ) {
    fail("append-owner-token", "$ownerToken");
  }
  try {
    parseUuidV4(uuid, "$ownerToken");
  } catch (error: unknown) {
    if (error instanceof UuidV4Error) {
      fail("append-owner-token", "$ownerToken");
    }
    throw error;
  }
  return Object.freeze({ pid, threadId, uuid, token: value });
}

export interface DemandEventAppendCandidateAddress {
  readonly commitSequence: DemandEventCommitSequence;
  readonly commitId: WakeflowDurableId<"demand-event-commit">;
  readonly pid: number;
  readonly threadId: number;
  readonly token: string;
  readonly fileName: string;
}

/** `commitSequence`对应的固定宽度文件名。 */
export function formatDemandEventStreamCommitFileName(value: unknown): string {
  const sequence = parseDemandEventCommitSequence(value);
  return `${String(sequence).padStart(16, "0")}.json`;
}

/** 从固定宽度文件名恢复物理提交槽位。 */
export function parseDemandEventStreamCommitFileName(
  value: unknown,
): Readonly<{
  readonly commitSequence: DemandEventCommitSequence;
  readonly fileName: string;
}> {
  if (typeof value !== "string") fail("commit-file-name", "$fileName");
  const sequenceText = COMMIT_FILE_PATTERN.exec(value)?.groups?.sequence;
  if (sequenceText === undefined) fail("commit-file-name", "$fileName");
  let commitSequence: DemandEventCommitSequence;
  try {
    commitSequence = parseDemandEventCommitSequence(
      Number(sequenceText),
      "$fileName",
    );
  } catch (error: unknown) {
    if (error instanceof DemandEventStreamPositionError) {
      fail("commit-file-name", "$fileName");
    }
    throw error;
  }
  if (formatDemandEventStreamCommitFileName(commitSequence) !== value) {
    fail("commit-file-name", "$fileName");
  }
  return Object.freeze({ commitSequence, fileName: value });
}

/** 固定 `commitSequence` 唯一对应一个不替换目标的权威引用。 */
export function demandEventStreamCommitRef(
  sequence: DemandEventCommitSequence,
): PortableResourcePath {
  return parsePortableResourcePath(
    `${DEMAND_EVENT_STREAM_COMMITS_ROOT_REF}/${formatDemandEventStreamCommitFileName(
      sequence,
    )}`,
  );
}

/** 一次追加尝试所使用的私有、非权威候选资源引用。 */
export function demandEventAppendCandidateRef(
  sequence: DemandEventCommitSequence,
  commitId: WakeflowDurableId<"demand-event-commit">,
  ownerToken: string,
): PortableResourcePath {
  const admittedSequence = parseDemandEventCommitSequence(sequence);
  let admittedCommitId: WakeflowDurableId<"demand-event-commit">;
  try {
    admittedCommitId = parseWakeflowDurableIdOfKind(
      commitId,
      "demand-event-commit",
      "$commitId",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) {
      fail("commit-identity", "$commitId");
    }
    throw error;
  }
  const owner = parseAppendOwnerToken(ownerToken);
  return parsePortableResourcePath(
    `${DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF}/${String(admittedSequence).padStart(
      16,
      "0",
    )}__${admittedCommitId}__${owner.token}.json`,
  );
}

/** 解析候选资源名称中的事件流槽位和保守进程持有者身份。 */
export function parseDemandEventAppendCandidateFileName(
  value: unknown,
): Readonly<DemandEventAppendCandidateAddress> {
  if (typeof value !== "string") {
    fail("append-candidate-file-name", "$fileName");
  }
  const match = APPEND_CANDIDATE_PATTERN.exec(value);
  const groups = match?.groups;
  if (groups === undefined) {
    fail("append-candidate-file-name", "$fileName");
  }
  if (
    groups.sequence === undefined
    || groups.commitId === undefined
    || groups.pid === undefined
    || groups.threadId === undefined
    || groups.token === undefined
  ) {
    fail("append-candidate-file-name", "$fileName");
  }
  let commitId: WakeflowDurableId<"demand-event-commit">;
  let commitSequence: DemandEventCommitSequence;
  let owner: Readonly<AppendOwnerToken>;
  try {
    commitId = parseWakeflowDurableIdOfKind(
      groups.commitId,
      "demand-event-commit",
    );
    commitSequence = parseDemandEventCommitSequence(Number(groups.sequence));
    owner = parseAppendOwnerToken(
      `${groups.pid}-${groups.threadId}-${groups.token}`,
    );
  } catch (error: unknown) {
    if (
      error instanceof WakeflowDurableIdError
      || error instanceof DemandEventStreamPositionError
      || error instanceof DemandEventSourcingPathError
    ) {
      fail("append-candidate-file-name", "$fileName");
    }
    throw error;
  }
  const canonical = `${String(commitSequence).padStart(16, "0")}__${commitId}__${owner.token}.json`;
  if (canonical !== value) fail("append-candidate-file-name", "$fileName");
  return Object.freeze({
    commitSequence,
    commitId,
    pid: owner.pid,
    threadId: owner.threadId,
    token: owner.token,
    fileName: value,
  });
}

/** 不可变快照只按其锚定提交的 `commitSequence` 命名。 */
export function demandEventSourcingSnapshotRef(
  sequence: DemandEventCommitSequence,
): PortableResourcePath {
  return parsePortableResourcePath(
    `${DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF}/${formatDemandEventStreamCommitFileName(
      sequence,
    )}`,
  );
}
