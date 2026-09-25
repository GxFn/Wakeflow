import { types } from "node:util";
import { parseSha256Digest, Sha256Error, } from "../../../foundation/crypto/sha256.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../../../foundation/data/passive-own-data.js";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../../contracts/identity/wakeflow-durable-id.js";
import { computeDemandEventSourcingCommandDigest, decideDemandEventSourcingCommand, parseDemandEventSourcingCommand, DemandEventSourcingDecisionError, } from "./demand-event-sourcing-decider.js";
import { prepareDemandEventStreamCommit, DemandEventStreamCommitError, } from "./demand-event-stream-commit.js";
import { DemandEventSourcingRepository, DemandEventSourcingRepositoryError, } from "./demand-event-sourcing-repository.js";
import { DemandFileEventStoreError } from "./demand-file-event-store.js";
const ERROR_MESSAGES = {
    input: "Demand Event Sourcing Command Handler input is invalid.",
    "idempotency-conflict": "Demand Event Sourcing commitId is already bound to another command.",
    "concurrency-conflict": "Demand Event Sourcing command expected a stale stream revision.",
    "decision-rejected": "Demand Event Sourcing command is not admitted from current state.",
    stream: "Demand Event Sourcing command cannot load or append its stream.",
    aborted: "Demand Event Sourcing command was aborted before its next commit point.",
};
export class DemandEventSourcingCommandHandlerError extends Error {
    name = "DemandEventSourcingCommandHandlerError";
    code = "wakeflow-demand-event-sourcing-command-handler";
    reason;
    path;
    constructor(reason, path) {
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
function fail(reason, path) {
    throw new DemandEventSourcingCommandHandlerError(reason, path);
}
function assertRepository(value) {
    if (typeof value !== "object" ||
        value === null ||
        types.isProxy(value) ||
        !(value instanceof DemandEventSourcingRepository)) {
        fail("input", "$repository");
    }
}
function parseOptions(value) {
    let record;
    try {
        record = parsePlainRecord(value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$options");
        throw error;
    }
    if (!Object.hasOwn(record, "commitId") ||
        !Object.hasOwn(record, "expectedStreamRevision") ||
        Object.keys(record).some((key) => !OPTION_FIELDS.has(key))) {
        fail("input", "$options");
    }
    let commitId;
    try {
        commitId = parseWakeflowDurableIdOfKind(record.commitId, "demand-event-commit", "$/commitId");
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("input", "$/commitId");
        throw error;
    }
    const expected = record.expectedStreamRevision;
    if (!Number.isSafeInteger(expected) || expected < 0) {
        fail("input", "$/expectedStreamRevision");
    }
    const signal = record.signal;
    if (signal !== undefined &&
        (types.isProxy(signal) || !(signal instanceof AbortSignal))) {
        fail("input", "$/signal");
    }
    let idempotency;
    if (record.idempotency !== undefined) {
        let bound;
        try {
            bound = parsePlainRecord(record.idempotency, "$/idempotency");
        }
        catch (error) {
            if (error instanceof PassiveOwnDataError)
                fail("input", "$/idempotency");
            throw error;
        }
        if (Object.keys(bound).sort().join(",") !== "key,requestDigest" ||
            typeof bound.key !== "string" ||
            !IDEMPOTENCY_KEY_PATTERN.test(bound.key)) {
            fail("input", "$/idempotency");
        }
        let requestDigest;
        try {
            requestDigest = parseSha256Digest(bound.requestDigest, "$/idempotency/requestDigest");
        }
        catch (error) {
            if (error instanceof Sha256Error)
                fail("input", "$/idempotency/requestDigest");
            throw error;
        }
        idempotency = Object.freeze({ key: bound.key, requestDigest });
    }
    return Object.freeze({
        commitId,
        expectedStreamRevision: expected,
        ...(idempotency === undefined ? {} : { idempotency }),
        ...(signal === undefined ? {} : { signal }),
    });
}
function mapRepositoryError(error) {
    if (error instanceof DemandEventSourcingRepositoryError) {
        if (error.reason === "aborted")
            fail("aborted", "$signal");
        fail("stream", "$repository");
    }
    if (error instanceof DemandFileEventStoreError) {
        if (error.reason === "aborted")
            fail("aborted", "$signal");
        if (error.reason === "concurrency-conflict") {
            fail("concurrency-conflict", "$commit");
        }
        if (error.reason === "append-identity-conflict") {
            fail("idempotency-conflict", error.path === "$commit/commitId" ? "$/commitId" : "$command/eventId");
        }
        fail("stream", "$eventStore");
    }
    throw error;
}
async function loadAggregateForCommand(repository, signal) {
    // 同Commit并发winner完成link到退休双链接candidate之间，reader可短暂
    // 保守报告stream。只对该错误最多三次完整重读；不等待、不宽松校验。
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            return await repository.load(signal === undefined ? undefined : { signal });
        }
        catch (error) {
            if (error instanceof DemandEventSourcingRepositoryError &&
                error.reason === "stream" &&
                attempt < 3) {
                continue;
            }
            mapRepositoryError(error);
        }
    }
    fail("stream", "$repository");
}
async function findCommitForCommand(repository, commitId, signal) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            return await repository.findCommitById(commitId, signal === undefined ? undefined : { signal });
        }
        catch (error) {
            if (error instanceof DemandEventSourcingRepositoryError &&
                error.reason === "stream" &&
                attempt < 3) {
                continue;
            }
            mapRepositoryError(error);
        }
    }
    fail("stream", "$repository");
}
/** 执行一条 Demand 命令；所有领域转换都在任何文件副作用之前完成。 */
export async function executeDemandEventSourcingCommand(repository, commandValue, optionsValue) {
    assertRepository(repository);
    const options = parseOptions(optionsValue);
    let command;
    try {
        command = parseDemandEventSourcingCommand(commandValue);
    }
    catch (error) {
        if (error instanceof DemandEventSourcingDecisionError) {
            fail("input", "$command");
        }
        throw error;
    }
    const commandDigest = computeDemandEventSourcingCommandDigest(command);
    if (options.signal?.aborted === true)
        fail("aborted", "$signal");
    if (options.idempotency !== undefined) {
        // 客户端键先于任何领域转换解析：同键同摘要即首次结果，同键异摘要即冲突。
        let bound;
        try {
            bound = await repository.findCommitByIdempotencyKey(options.idempotency.key, options.signal === undefined ? undefined : { signal: options.signal });
        }
        catch (error) {
            mapRepositoryError(error);
        }
        if (bound !== null) {
            if (bound.idempotency?.requestDigest !== options.idempotency.requestDigest) {
                fail("idempotency-conflict", "$/idempotency/key");
            }
            const current = await loadAggregateForCommand(repository, options.signal);
            if (current === null)
                fail("stream", "$repository");
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
        const existing = await findCommitForCommand(repository, options.commitId, options.signal);
        if (existing === null) {
            fail("concurrency-conflict", "$/expectedStreamRevision");
        }
        if (existing.commandDigest !== commandDigest ||
            existing.expectedStreamRevision !== options.expectedStreamRevision) {
            fail("idempotency-conflict", "$/commitId");
        }
        if (loaded === null)
            fail("stream", "$repository");
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
    }
    catch (error) {
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
    }
    catch (error) {
        if (error instanceof DemandEventStreamCommitError) {
            fail("decision-rejected", "$command");
        }
        throw error;
    }
    let receipt;
    try {
        receipt = await repository.appendPreparedCommit(prepared, options.signal === undefined ? undefined : { signal: options.signal });
    }
    catch (error) {
        mapRepositoryError(error);
    }
    let checkpoint = "unchanged";
    if (receipt.disposition === "committed") {
        try {
            await repository.refreshCheckpoints(prepared.aggregate, options.signal === undefined ? undefined : { signal: options.signal });
            checkpoint = "refreshed";
        }
        catch (error) {
            if (!(error instanceof DemandEventSourcingRepositoryError))
                throw error;
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
