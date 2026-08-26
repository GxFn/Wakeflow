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
 * Wakeflow Governance / Demand Event Sourcing：本地文件 Event Store 的路径词汇。
 *
 * `commits/` 只保存固定 commitSequence 的 immutable authority；`snapshots/` 只保存
 * 可删除 checkpoint；`append-candidates/` 只保存尚未成为 authority 的发布 source。
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

/** 固定 commitSequence 唯一对应一个 no-replace authority ref。 */
export function demandEventStreamCommitRef(
  sequence: DemandEventCommitSequence,
): PortableResourcePath {
  return parsePortableResourcePath(
    `${DEMAND_EVENT_STREAM_COMMITS_ROOT_REF}/${formatDemandEventStreamCommitFileName(
      sequence,
    )}`,
  );
}

/** 一个 append 尝试的私有、非权威 candidate ref。 */
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

/** 解析 candidate 名称中的 stream slot 与保守 process-owner identity。 */
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

/** immutable snapshot 只按其 anchor commitSequence 命名。 */
export function demandEventSourcingSnapshotRef(
  sequence: DemandEventCommitSequence,
): PortableResourcePath {
  return parsePortableResourcePath(
    `${DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF}/${formatDemandEventStreamCommitFileName(
      sequence,
    )}`,
  );
}
