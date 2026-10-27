import { deepEqual, equal, notEqual, throws } from "node:assert/strict";
import { test } from "node:test";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { decideDemandEventSourcingCommand } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import {
  DemandEventSourcingPathError,
  demandEventAppendCandidateRef,
  formatDemandEventStreamCommitFileName,
  parseDemandEventAppendCandidateFileName,
  parseDemandEventStreamCommitFileName,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-paths.js";
import { computeDemandEventSourcingStoredEventDigest } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-stored-event.js";
import {
  applyDemandEventStreamCommit,
  assertPreparedDemandEventStreamCommit,
  computeDemandEventStreamCommitDigest,
  DemandEventStreamCommitError,
  parseDemandEventStreamCommit,
  parseDemandEventStreamCommitDocument,
  planDemandEventStreamCommit,
  prepareDemandEventStreamCommit,
  renderDemandEventStreamCommit,
} from "../../../src/governance/demand/event-sourcing/demand-event-stream-commit.js";
import {
  DemandEventStreamPositionError,
  parseDemandEventCommitSequence,
  parseDemandEventStreamRevision,
} from "../../../src/governance/demand/event-sourcing/demand-event-stream-position.js";

/**
 * Governance / Demand Event Sourcing 提交记录（ADR-0005），0 级（纯逻辑）测试：流位置与文件名词汇、
 * 一次 append 形成固定 commitSequence 的不可变提交、wire 往返，以及可选写者戳的持久化与摘要边界
 * （C11，1.2 计划 §3.6）。
 */

const DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_11111111-1111-4111-8111-111111111111",
  "demand",
);
const PUBLISHED_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_22222222-2222-4222-8222-222222222222",
  "demand-event",
);
const CANCELLED_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_33333333-3333-4333-8333-333333333333",
  "demand-event",
);
const FIRST_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_44444444-4444-4444-8444-444444444444",
  "demand-event-commit",
);
const SECOND_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_55555555-5555-4555-8555-555555555555",
  "demand-event-commit",
);
const PUBLISHED_AT = parseUtcInstant("2026-08-26T10:00:00.000Z");
const CANCELLED_AT = parseUtcInstant("2026-08-26T11:00:00.000Z");

test("Demand event positions and filenames use one closed vocabulary", () => {
  const sequence = parseDemandEventCommitSequence(1);
  equal(formatDemandEventStreamCommitFileName(sequence), "0000000000000001.json");
  equal(parseDemandEventStreamCommitFileName("0000000000000001.json").commitSequence, sequence);
  const ownerToken = `${process.pid}-0-66666666-6666-4666-8666-666666666666`;
  const candidateRef = demandEventAppendCandidateRef(sequence, FIRST_COMMIT_ID, ownerToken);
  const fileName = candidateRef.split("/").at(-1);
  if (fileName === undefined) throw new Error("Candidate filename is missing.");
  const candidate = parseDemandEventAppendCandidateFileName(fileName);
  equal(candidate.commitSequence, sequence);
  equal(candidate.commitId, FIRST_COMMIT_ID);
  equal(candidate.token, ownerToken);

  throws(
    () => parseDemandEventStreamRevision(0),
    (error: unknown) =>
      error instanceof DemandEventStreamPositionError && error.reason === "stream-revision",
  );
  throws(
    () =>
      demandEventAppendCandidateRef(
        sequence,
        FIRST_COMMIT_ID,
        `${Number.MAX_SAFE_INTEGER + 1}-0-66666666-6666-4666-8666-666666666666`,
      ),
    (error: unknown) =>
      error instanceof DemandEventSourcingPathError && error.reason === "append-owner-token",
  );
});
const IDENTITY_DIGEST = parseSha256Digest(`sha256:${"a".repeat(64)}`);
const AUTHORITY_DIGEST = parseSha256Digest(`sha256:${"b".repeat(64)}`);
const FIRST_COMMAND_DIGEST = parseSha256Digest(`sha256:${"c".repeat(64)}`);
const SECOND_COMMAND_DIGEST = parseSha256Digest(`sha256:${"d".repeat(64)}`);

test("一次 Demand Event Sourcing append 形成一个固定 commitSequence 的 immutable commit", () => {
  const published = decideDemandEventSourcingCommand(null, {
    commandType: "publication.publish-demand",
    commandVersion: 1,
    demandId: DEMAND_ID,
    eventId: PUBLISHED_EVENT_ID,
    recordedAt: PUBLISHED_AT,
    identityDigest: IDENTITY_DIGEST,
    authorityDigest: AUTHORITY_DIGEST,
  });
  const first = prepareDemandEventStreamCommit(null, {
    commitId: FIRST_COMMIT_ID,
    commandDigest: FIRST_COMMAND_DIGEST,
    events: published,
  });
  const unissuedPlan = planDemandEventStreamCommit(null, {
    commitId: FIRST_COMMIT_ID,
    commandDigest: FIRST_COMMAND_DIGEST,
    events: published,
  });
  throws(
    () => assertPreparedDemandEventStreamCommit(unissuedPlan),
    (error: unknown) => error instanceof DemandEventStreamCommitError && error.reason === "input",
  );
  throws(
    () =>
      prepareDemandEventStreamCommit(null, {
        commitId: FIRST_COMMIT_ID,
        commandDigest: FIRST_COMMAND_DIGEST,
        events: [published[0], published[0]],
      }),
    (error: unknown) =>
      error instanceof DemandEventStreamCommitError && error.reason === "relation",
  );

  equal(first.commit.commitSequence, 1);
  equal(first.commit.expectedStreamRevision, 0);
  equal(first.commit.firstStreamRevision, 1);
  equal(first.commit.lastStreamRevision, 1);
  equal(first.commit.previousCommitDigest, null);
  equal(first.commit.events[0]?.streamRevision, 1);
  equal(first.commit.events[0]?.eventVersion, 1);
  equal(first.commit.events[0]?.resultingStateModelVersion, 1);
  equal(Object.hasOwn(first.commit.events[0] ?? {}, "previousEvent"), false);
  equal(first.aggregate.state.lifecycle, "active");
  equal(first.sourceExpectation.lastEventDigest, null);
  equal(first.sourceExpectation.stateDigest, null);
  equal(Object.isFrozen(first.sourceExpectation), true);
  for (const [field, reason] of [
    ["eventVersion", "event-version"],
    ["resultingStateModelVersion", "state-version"],
  ] as const) {
    throws(
      () =>
        applyDemandEventStreamCommit(null, {
          ...first.commit,
          events: [{ ...first.commit.events[0], [field]: 2 }],
        }),
      (error: unknown) => error instanceof DemandEventStreamCommitError && error.reason === reason,
    );
  }

  const cancelled = decideDemandEventSourcingCommand(first.aggregate.state, {
    commandType: "lifecycle.cancel-demand",
    commandVersion: 1,
    demandId: DEMAND_ID,
    eventId: CANCELLED_EVENT_ID,
    recordedAt: CANCELLED_AT,
    reason: "用户终止该 Demand",
  });
  const second = prepareDemandEventStreamCommit(first.aggregate, {
    commitId: SECOND_COMMIT_ID,
    commandDigest: SECOND_COMMAND_DIGEST,
    events: cancelled,
  });

  equal(second.commit.commitSequence, 2);
  equal(second.commit.expectedStreamRevision, 1);
  equal(second.commit.firstStreamRevision, 2);
  equal(second.commit.previousCommitDigest, computeDemandEventStreamCommitDigest(first.commit));
  equal(second.aggregate.state.lifecycle, "cancelled");
  equal(second.aggregate.streamRevision, 2);
  equal(second.aggregate.commitSequence, 2);
  equal(second.aggregate.lastCommitDigest, computeDemandEventStreamCommitDigest(second.commit));
  equal(second.sourceExpectation.lastEventDigest, first.aggregate.lastEventDigest);
  equal(second.sourceExpectation.stateDigest, first.aggregate.stateDigest);

  const text = renderDemandEventStreamCommit(second.commit);
  deepEqual(parseDemandEventStreamCommitDocument(text), second.commit);
  throws(
    () =>
      prepareDemandEventStreamCommit(second.aggregate, {
        commitId: SECOND_COMMIT_ID,
        commandDigest: SECOND_COMMAND_DIGEST,
        events: cancelled,
      }),
    DemandEventStreamCommitError,
  );
});

const WRITER = Object.freeze({
  version: "1.2.0",
  manifestDigest: parseSha256Digest(`sha256:${"e".repeat(64)}`),
});
const OTHER_WRITER = Object.freeze({
  version: "1.3.0-rc.1",
  manifestDigest: parseSha256Digest(`sha256:${"f".repeat(64)}`),
});

test("提交记录的可选写者戳随提交持久化并进提交摘要链，不进事件数据摘要，旧记录缺席读回为 null（C11，计划 §3.6）", () => {
  const published = decideDemandEventSourcingCommand(null, {
    commandType: "publication.publish-demand",
    commandVersion: 1,
    demandId: DEMAND_ID,
    eventId: PUBLISHED_EVENT_ID,
    recordedAt: PUBLISHED_AT,
    identityDigest: IDENTITY_DIGEST,
    authorityDigest: AUTHORITY_DIGEST,
  });
  const input = Object.freeze({
    commitId: FIRST_COMMIT_ID,
    commandDigest: FIRST_COMMAND_DIGEST,
    events: published,
  });
  const unstamped = prepareDemandEventStreamCommit(null, input);
  const stamped = prepareDemandEventStreamCommit(null, { ...input, writer: WRITER });
  const restamped = planDemandEventStreamCommit(null, { ...input, writer: OTHER_WRITER });

  // 戳随提交；省略与 null 同义，读回时缺席。
  deepEqual(stamped.commit.writer, WRITER);
  equal(Object.hasOwn(unstamped.commit, "writer"), false);
  equal(unstamped.commit.writer ?? null, null);
  equal(
    Object.hasOwn(planDemandEventStreamCommit(null, { ...input, writer: null }), "writer"),
    false,
  );

  // 事件数据摘要与状态摘要不含戳：同一命令带不同戳得到相同的事件与状态。
  const unstampedEventDigest = computeDemandEventSourcingStoredEventDigest(
    unstamped.commit.events[0],
  );
  equal(
    computeDemandEventSourcingStoredEventDigest(stamped.commit.events[0]),
    unstampedEventDigest,
  );
  equal(computeDemandEventSourcingStoredEventDigest(restamped.events[0]), unstampedEventDigest);
  equal(
    stamped.commit.events[0].resultingStateDigest,
    unstamped.commit.events[0].resultingStateDigest,
  );
  equal(stamped.aggregate.lastEventDigest, unstamped.aggregate.lastEventDigest);
  equal(stamped.aggregate.stateDigest, unstamped.aggregate.stateDigest);
  // 提交摘要链覆盖戳。
  notEqual(
    computeDemandEventStreamCommitDigest(stamped.commit),
    computeDemandEventStreamCommitDigest(unstamped.commit),
  );
  equal(stamped.aggregate.lastCommitDigest, computeDemandEventStreamCommitDigest(stamped.commit));

  // wire 往返；盖戳之前写出的记录没有 writer 键，读回缺席。
  const text = renderDemandEventStreamCommit(stamped.commit);
  deepEqual((JSON.parse(text) as { writer?: unknown }).writer, {
    version: "1.2.0",
    manifestDigest: WRITER.manifestDigest,
  });
  deepEqual(parseDemandEventStreamCommitDocument(text), stamped.commit);
  const legacy = parseDemandEventStreamCommitDocument(
    renderDemandEventStreamCommit(unstamped.commit),
  );
  equal(Object.hasOwn(legacy, "writer"), false);

  // 后继提交可以带另一构建的戳；链按前一提交的完整摘要串联。
  const cancelled = decideDemandEventSourcingCommand(stamped.aggregate.state, {
    commandType: "lifecycle.cancel-demand",
    commandVersion: 1,
    demandId: DEMAND_ID,
    eventId: CANCELLED_EVENT_ID,
    recordedAt: CANCELLED_AT,
    reason: "用户终止该 Demand",
  });
  const second = prepareDemandEventStreamCommit(stamped.aggregate, {
    commitId: SECOND_COMMIT_ID,
    commandDigest: SECOND_COMMAND_DIGEST,
    events: cancelled,
    writer: OTHER_WRITER,
  });
  deepEqual(second.commit.writer, OTHER_WRITER);
  equal(second.commit.previousCommitDigest, computeDemandEventStreamCommitDigest(stamped.commit));
  equal(
    applyDemandEventStreamCommit(stamped.aggregate, second.commit).lastCommitDigest,
    computeDemandEventStreamCommitDigest(second.commit),
  );

  // 戳必须恰好是 {version: semver, manifestDigest}。
  for (const writer of [
    { version: "v1.2.0", manifestDigest: WRITER.manifestDigest },
    { version: "1.2", manifestDigest: WRITER.manifestDigest },
    { version: "1.2.0" },
    { version: "1.2.0", manifestDigest: WRITER.manifestDigest, extra: true },
    "1.2.0",
  ]) {
    throws(
      () => planDemandEventStreamCommit(null, { ...input, writer }),
      (error: unknown) => error instanceof DemandEventStreamCommitError && error.reason === "input",
    );
  }
  throws(
    () =>
      planDemandEventStreamCommit(null, {
        ...input,
        writer: { version: "1.2.0", manifestDigest: "sha256:zz" },
      }),
    (error: unknown) => error instanceof DemandEventStreamCommitError && error.reason === "digest",
  );
  // wire 上 null 不是缺席，缺子字段不过 Schema。
  for (const writer of [null, { version: "1.2.0" }]) {
    throws(
      () => parseDemandEventStreamCommit({ ...stamped.commit, writer }),
      (error: unknown) =>
        error instanceof DemandEventStreamCommitError && error.reason === "schema",
    );
  }
});
