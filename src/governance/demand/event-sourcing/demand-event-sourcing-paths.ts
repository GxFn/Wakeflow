import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../../foundation/filesystem/portable-resource-path.js";
import type { WakeflowDurableId } from "../../../foundation/identity/wakeflow-durable-id.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
} from "../../../foundation/identity/wakeflow-durable-id.js";
import { parseUuidV4, UuidV4Error } from "../../../foundation/identity/uuid-v4.js";
import {
  formatDemandEventStreamCommitFileName,
} from "./demand-event-stream-commit.js";
import {
  parseDemandEventCommitSequence,
  type DemandEventCommitSequence,
} from "./demand-event-sourcing-aggregate.js";

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

export interface DemandEventAppendCandidateAddress {
  readonly commitSequence: DemandEventCommitSequence;
  readonly commitId: WakeflowDurableId<"demand-event-commit">;
  readonly pid: number;
  readonly threadId: number;
  readonly token: string;
  readonly fileName: string;
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
  if (!/^[1-9][0-9]*-(?:0|[1-9][0-9]*)-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(ownerToken)) {
    throw new TypeError("Demand append candidate owner token is invalid.");
  }
  return parsePortableResourcePath(
    `${DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF}/${String(sequence).padStart(
      16,
      "0",
    )}__${commitId}__${ownerToken}.json`,
  );
}

/** 解析候选资源名称中的事件流槽位和保守进程持有者身份。 */
export function parseDemandEventAppendCandidateFileName(
  value: unknown,
): Readonly<DemandEventAppendCandidateAddress> {
  if (typeof value !== "string") {
    throw new TypeError("Demand append candidate filename is invalid.");
  }
  const match = APPEND_CANDIDATE_PATTERN.exec(value);
  const groups = match?.groups;
  if (groups === undefined) {
    throw new TypeError("Demand append candidate filename is invalid.");
  }
  const pid = Number(groups.pid);
  const candidateThreadId = Number(groups.threadId);
  if (
    !Number.isSafeInteger(pid)
    || pid <= 0
    || !Number.isSafeInteger(candidateThreadId)
    || candidateThreadId < 0
    || groups.sequence === undefined
    || groups.commitId === undefined
    || groups.token === undefined
  ) {
    throw new TypeError("Demand append candidate filename is invalid.");
  }
  let commitId: WakeflowDurableId<"demand-event-commit">;
  try {
    commitId = parseWakeflowDurableIdOfKind(
      groups.commitId,
      "demand-event-commit",
    );
    parseUuidV4(groups.token);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError || error instanceof UuidV4Error) {
      throw new TypeError("Demand append candidate filename is invalid.");
    }
    throw error;
  }
  return Object.freeze({
    commitSequence: parseDemandEventCommitSequence(Number(groups.sequence)),
    commitId,
    pid,
    threadId: candidateThreadId,
    token: `${pid}-${candidateThreadId}-${groups.token}`,
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
