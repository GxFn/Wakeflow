import { types } from "node:util";
import { WAKEFLOW_DEMAND_EVENT_STREAM_COMMIT_SCHEMA } from "../../../contracts/generated/governance/demand/demand-event-stream-commit.generated.js";
import { WAKEFLOW_DEMAND_EVENT_SOURCING_STORED_EVENT_SCHEMA } from "../../../contracts/generated/governance/demand/demand-event-sourcing-stored-event.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../../contracts/generated/foundation/utc-instant.generated.js";
import { computeCanonicalJsonSha256Digest } from "../../../foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest, Sha256Error, } from "../../../foundation/crypto/sha256.js";
import { DeterministicJsonDocumentError, parseDeterministicJsonDocument, renderDeterministicJsonDocument, } from "../../../foundation/data/deterministic-json-document.js";
import { JsonValueError, parseJsonValue, } from "../../../foundation/data/json-value.js";
import { parseDenseArray, parsePlainRecord, PassiveOwnDataError, } from "../../../foundation/data/passive-own-data.js";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../../contracts/identity/wakeflow-durable-id.js";
import { createRuntimeJsonSchemaValidator } from "../../../foundation/schema/runtime-json-schema.js";
import { computeDemandAggregateStateDigest, } from "../model/demand-aggregate-state.js";
import { evolveDemandEventSourcingState, DemandEventSourcingDecisionError, } from "./demand-event-sourcing-decider.js";
import { parseDemandEventSourcingAggregate, DemandEventSourcingAggregateError, } from "./demand-event-sourcing-aggregate.js";
import { parseDemandUncommittedEvent, DemandEventSourcingEventError, } from "./demand-event-sourcing-event.js";
import { computeDemandEventSourcingStoredEventDigest, createDemandEventSourcingStoredEvent, parseDemandEventSourcingStoredEvent, DemandEventSourcingStoredEventError, } from "./demand-event-sourcing-stored-event.js";
import { upcastDemandEventSourcingStoredEvent, DemandEventSourcingUpcasterError, } from "./demand-event-sourcing-upcaster.js";
import { assertSupportedDemandEventSourcingStateModelVersion, DemandEventSourcingStateVersionError, } from "./demand-event-sourcing-state-version.js";
import { parseDemandEventCommitSequence, parseDemandEventStreamRevision, DemandEventStreamPositionError, } from "./demand-event-stream-position.js";
/**
 * Wakeflow Governance / Demand Event Sourcing：一次原子追加产生的不可变提交记录。
 *
 * `commitSequence` 是不替换目标的物理槽位；事件流修订号是提交中事件的逻辑位置。
 * 一条提交记录可以承载一个命令产生的多个事件，并通过 `previousCommitDigest` 串联历史。
 */
const DEMAND_EVENT_STREAM_COMMIT_ARTIFACT_KIND = "wakeflow-demand-event-stream-commit";
const DEMAND_EVENT_STREAM_COMMIT_SCHEMA_VERSION = 1;
const DEMAND_EVENT_STREAM_COMMIT_MAXIMUM_EVENTS = 64;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
function parseIdempotency(value, path) {
    if (value === undefined)
        return undefined;
    let record;
    try {
        record = parsePlainRecord(value, path);
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", path);
        throw error;
    }
    const keys = Object.keys(record).sort();
    if (keys.length !== 2 ||
        keys[0] !== "key" ||
        keys[1] !== "requestDigest" ||
        typeof record.key !== "string" ||
        !IDEMPOTENCY_KEY_PATTERN.test(record.key)) {
        fail("input", path);
    }
    return Object.freeze({
        key: record.key,
        requestDigest: parseDigest(record.requestDigest, `${path}/requestDigest`),
    });
}
const ERROR_MESSAGES = {
    input: "Demand Event Stream commit input is invalid.",
    json: "Demand Event Stream commit is not passive JSON data.",
    schema: "Demand Event Stream commit does not satisfy its Schema.",
    identifier: "Demand Event Stream commit contains an invalid identity.",
    position: "Demand Event Stream commit contains an invalid stream position.",
    digest: "Demand Event Stream commit contains an invalid digest.",
    event: "Demand Event Stream commit contains an invalid event.",
    aggregate: "Demand Event Stream commit requires a valid current aggregate.",
    relation: "Demand Event Stream commit fields do not form one append batch.",
    "event-version": "Demand Event Stream commit contains an unsupported event version.",
    "state-version": "Demand Event Stream commit contains an unsupported state-model version.",
    transition: "Demand Event Stream commit cannot be evolved from the current state.",
    representation: "Demand Event Stream commit bytes are not deterministic.",
};
export class DemandEventStreamCommitError extends Error {
    name = "DemandEventStreamCommitError";
    code = "wakeflow-demand-event-stream-commit";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const validateWire = createRuntimeJsonSchemaValidator(WAKEFLOW_DEMAND_EVENT_STREAM_COMMIT_SCHEMA, [
    WAKEFLOW_DEMAND_EVENT_SOURCING_STORED_EVENT_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
]);
const PREPARE_FIELDS = Object.freeze([
    "commandDigest",
    "commitId",
    "events",
]);
const PREPARE_OPTIONAL_FIELDS = Object.freeze(["idempotency"]);
const ISSUED_PREPARED_COMMITS = new WeakSet();
function fail(reason, path) {
    throw new DemandEventStreamCommitError(reason, path);
}
function parseDigest(value, path) {
    try {
        return parseSha256Digest(value, path);
    }
    catch (error) {
        if (error instanceof Sha256Error)
            fail("digest", path);
        throw error;
    }
}
function parseExpectedRevision(value, path) {
    if (!Number.isSafeInteger(value) || value < 0) {
        fail("position", path);
    }
    return value;
}
function parseCommitId(value, path) {
    try {
        return parseWakeflowDurableIdOfKind(value, "demand-event-commit", path);
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("identifier", path);
        throw error;
    }
}
function parseDemandId(value, path) {
    try {
        return parseWakeflowDurableIdOfKind(value, "demand", path);
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("identifier", path);
        throw error;
    }
}
/** 只验证提交记录自身的结构和序列关系，不替代归约器语义验证。 */
export function parseDemandEventStreamCommit(value) {
    let json;
    try {
        json = parseJsonValue(value, "$commit");
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("json", error.path);
        throw error;
    }
    const result = validateWire(json);
    if (!result.ok)
        fail("schema", result.path);
    const wire = result.value;
    const expectedStreamRevision = parseExpectedRevision(wire.expectedStreamRevision, "$/expectedStreamRevision");
    if (expectedStreamRevision > Number.MAX_SAFE_INTEGER - wire.events.length) {
        fail("position", "$/expectedStreamRevision");
    }
    let commitSequence;
    let firstStreamRevision;
    let lastStreamRevision;
    try {
        commitSequence = parseDemandEventCommitSequence(wire.commitSequence, "$/commitSequence");
        firstStreamRevision = parseDemandEventStreamRevision(wire.firstStreamRevision, "$/firstStreamRevision");
        lastStreamRevision = parseDemandEventStreamRevision(wire.lastStreamRevision, "$/lastStreamRevision");
    }
    catch (error) {
        if (error instanceof DemandEventStreamPositionError) {
            fail("position", error.path);
        }
        throw error;
    }
    const demandId = parseDemandId(wire.demandId, "$/demandId");
    const idempotency = parseIdempotency(wire.idempotency, "$/idempotency");
    const events = [];
    const eventIds = new Set();
    for (const [index, eventValue] of wire.events.entries()) {
        let event;
        try {
            event = parseDemandEventSourcingStoredEvent(eventValue);
        }
        catch (error) {
            if (error instanceof DemandEventSourcingStoredEventError) {
                fail("event", `$/events/${index}`);
            }
            throw error;
        }
        if (event.demandId !== demandId ||
            event.streamRevision !== firstStreamRevision + index ||
            eventIds.has(event.eventId)) {
            fail("relation", `$/events/${index}`);
        }
        eventIds.add(event.eventId);
        events.push(event);
    }
    if (firstStreamRevision !== expectedStreamRevision + 1 ||
        lastStreamRevision !== expectedStreamRevision + events.length ||
        (commitSequence === 1) !== (expectedStreamRevision === 0) ||
        (commitSequence === 1) !== (wire.previousCommitDigest === null)) {
        fail("relation", "$commit");
    }
    const first = events[0];
    if (first === undefined)
        fail("relation", "$/events");
    const frozenEvents = [first];
    frozenEvents.push(...events.slice(1));
    return Object.freeze({
        artifactKind: DEMAND_EVENT_STREAM_COMMIT_ARTIFACT_KIND,
        schemaVersion: DEMAND_EVENT_STREAM_COMMIT_SCHEMA_VERSION,
        commitId: parseCommitId(wire.commitId, "$/commitId"),
        demandId,
        commitSequence,
        commandDigest: parseDigest(wire.commandDigest, "$/commandDigest"),
        expectedStreamRevision,
        firstStreamRevision,
        lastStreamRevision,
        previousCommitDigest: wire.previousCommitDigest === null
            ? null
            : parseDigest(wire.previousCommitDigest, "$/previousCommitDigest"),
        events: Object.freeze(frozenEvents),
        ...(idempotency === undefined ? {} : { idempotency }),
    });
}
export function renderDemandEventStreamCommit(value) {
    return renderDeterministicJsonDocument(parseDemandEventStreamCommit(value), "$commit");
}
export function parseDemandEventStreamCommitDocument(text) {
    let json;
    try {
        json = parseDeterministicJsonDocument(text, "$commit");
    }
    catch (error) {
        if (error instanceof DeterministicJsonDocumentError) {
            fail("representation", "$commit");
        }
        throw error;
    }
    const commit = parseDemandEventStreamCommit(json);
    if (renderDemandEventStreamCommit(commit) !== text) {
        fail("representation", "$commit");
    }
    return commit;
}
export function computeDemandEventStreamCommitDigest(value) {
    return computeCanonicalJsonSha256Digest(parseDemandEventStreamCommit(value));
}
function parsePrepareInput(value) {
    let record;
    try {
        record = parsePlainRecord(value, "$input");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$input");
        throw error;
    }
    const keys = Object.keys(record)
        .filter((key) => !PREPARE_OPTIONAL_FIELDS.includes(key))
        .sort();
    if (keys.length !== PREPARE_FIELDS.length ||
        keys.some((key, index) => key !== PREPARE_FIELDS[index])) {
        fail("input", "$input");
    }
    const idempotency = parseIdempotency(record.idempotency, "$/idempotency");
    let values;
    try {
        values = parseDenseArray(record.events, DEMAND_EVENT_STREAM_COMMIT_MAXIMUM_EVENTS, "$/events");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$/events");
        throw error;
    }
    if (values.length === 0)
        fail("input", "$/events");
    const events = values.map((eventValue, index) => {
        try {
            return parseDemandUncommittedEvent(eventValue);
        }
        catch (error) {
            if (error instanceof DemandEventSourcingEventError) {
                fail("event", `$/events/${index}`);
            }
            throw error;
        }
    });
    return Object.freeze({
        commitId: parseCommitId(record.commitId, "$/commitId"),
        commandDigest: parseDigest(record.commandDigest, "$/commandDigest"),
        events: Object.freeze(events),
        idempotency,
    });
}
/**
 * 每类事件要么声明它绑定的流位置，要么显式声明不绑定；事件联合多出成员时这里编译不过。
 * 结果与回调的提交由追加命令的幂等键派生（ADR-0013 决定 C），不绑流位置；缺陷修复授权经决定
 * 传递绑定（决策器核对 `source.streamRevision` 等于决定的流位置加一）；其余事件的载荷不含流位置。
 */
function eventCommitBoundaryRevision(event) {
    switch (event.eventType) {
        case "lifecycle.demand-completed":
            return event.data.completion.observedState.streamRevision;
        // 围栏令牌的期望修订必须等于本次提交的期望修订：信封与新代际都绑定它们被追加时的流位置。
        case "delivery.delivery-prepared":
            return event.data.envelope.fence.expectedStreamRevision;
        case "delivery.delivery-rearmed":
            return event.data.rearm.fence.expectedStreamRevision;
        // 决定绑定它审查时的流位置。
        case "review.target-result-decided":
            return event.data.decision.reviewed.streamRevision;
        case "publication.demand-published":
        case "lifecycle.demand-cancelled":
        case "lifecycle.demand-escalated":
        case "lifecycle.decision-recorded":
        case "lifecycle.demand-continued":
        case "evidence.managed-evidence-recorded":
        case "tasking.target-task-planned":
        case "delivery.delivery-outcome-recorded":
        case "result.target-result-recorded":
        case "result.callback-reissued":
        case "review.product-defect-remediation-authorized":
            return null;
        default:
            return unhandledEvent(event);
    }
}
function unhandledEvent(_event) {
    fail("relation", "$/eventType");
}
/** 复验事件自身声明的提交边界，避免恢复身份与实际 Commit 脱节。 */
function assertEventCommitBoundary(event, expectedStreamRevision, path) {
    const bound = eventCommitBoundaryRevision(event);
    if (bound !== null && bound !== expectedStreamRevision)
        fail("relation", path);
}
/**
 * 把提交记录确定性应用到指定的当前聚合。
 *
 * 本函数在任何文件副作用前执行，也用于磁盘读取和完整审计；因此语义非法的
 * 候选资源不能先成为不可变提交记录，再由后置重放发现错误。
 */
export function applyDemandEventStreamCommit(currentValue, commitValue) {
    let current = null;
    if (currentValue !== null) {
        try {
            current = parseDemandEventSourcingAggregate(currentValue);
        }
        catch (error) {
            if (error instanceof DemandEventSourcingAggregateError) {
                fail("aggregate", "$aggregate");
            }
            throw error;
        }
    }
    const commit = parseDemandEventStreamCommit(commitValue);
    if ((current === null &&
        (commit.commitSequence !== 1 ||
            commit.expectedStreamRevision !== 0 ||
            commit.previousCommitDigest !== null)) ||
        (current !== null &&
            (commit.demandId !== current.demandId ||
                commit.commitSequence !== current.commitSequence + 1 ||
                commit.expectedStreamRevision !== current.streamRevision ||
                commit.previousCommitDigest !== current.lastCommitDigest))) {
        fail("relation", "$commit");
    }
    let state = current?.state ?? null;
    let lastEvent;
    for (const [index, storedEvent] of commit.events.entries()) {
        try {
            assertSupportedDemandEventSourcingStateModelVersion(storedEvent.resultingStateModelVersion, `$/events/${index}/resultingStateModelVersion`);
        }
        catch (error) {
            if (error instanceof DemandEventSourcingStateVersionError) {
                fail("state-version", `$/events/${index}/resultingStateModelVersion`);
            }
            throw error;
        }
        let currentEvent;
        try {
            currentEvent = upcastDemandEventSourcingStoredEvent(storedEvent);
        }
        catch (error) {
            if (error instanceof DemandEventSourcingUpcasterError) {
                fail("event-version", `$/events/${index}/eventVersion`);
            }
            throw error;
        }
        assertEventCommitBoundary(currentEvent, commit.expectedStreamRevision, `$/events/${index}`);
        let next;
        try {
            next = evolveDemandEventSourcingState(state, currentEvent);
        }
        catch (error) {
            if (error instanceof DemandEventSourcingDecisionError) {
                fail("transition", `$/events/${index}`);
            }
            throw error;
        }
        if (storedEvent.streamRevision !== commit.firstStreamRevision + index ||
            storedEvent.resultingStateDigest !==
                computeDemandAggregateStateDigest(next)) {
            fail("transition", `$/events/${index}`);
        }
        state = next;
        lastEvent = storedEvent;
    }
    if (state === null || lastEvent === undefined)
        fail("transition", "$/events");
    const lastCommitDigest = computeDemandEventStreamCommitDigest(commit);
    return parseDemandEventSourcingAggregate({
        demandId: commit.demandId,
        commitSequence: commit.commitSequence,
        streamRevision: commit.lastStreamRevision,
        lastCommitDigest,
        lastEvent,
        lastEventDigest: computeDemandEventSourcingStoredEventDigest(lastEvent),
        state,
        stateDigest: computeDemandAggregateStateDigest(state),
    });
}
/**
 * 只接纳本进程经过完整状态演进后签发的预备提交能力。
 *
 * 磁盘提交记录、恢复意图 JSON 或调用方自行构造的准备记录不能直接获得追加权限。
 * 签发结果还携带 `sourceExpectation`，供事件存储绑定指定物理尾部；进程重启后的
 * 恢复流程必须重新执行命令和决策准备。
 */
export function assertPreparedDemandEventStreamCommit(value) {
    if (typeof value !== "object" ||
        value === null ||
        types.isProxy(value) ||
        !Object.isFrozen(value) ||
        !ISSUED_PREPARED_COMMITS.has(value)) {
        fail("input", "$preparedCommit");
    }
}
function buildDemandEventStreamCommit(currentValue, inputValue) {
    let current = null;
    if (currentValue !== null) {
        try {
            current = parseDemandEventSourcingAggregate(currentValue);
        }
        catch (error) {
            if (error instanceof DemandEventSourcingAggregateError) {
                fail("aggregate", "$aggregate");
            }
            throw error;
        }
    }
    const input = parsePrepareInput(inputValue);
    const firstEvent = input.events[0];
    if (firstEvent === undefined)
        fail("input", "$/events");
    const expectedStreamRevision = current?.streamRevision ?? 0;
    if ((current !== null && current.commitSequence >= Number.MAX_SAFE_INTEGER) ||
        expectedStreamRevision > Number.MAX_SAFE_INTEGER - input.events.length) {
        fail("position", "$aggregate");
    }
    const commitSequence = (current?.commitSequence ?? 0) + 1;
    const demandId = current?.demandId ?? firstEvent.demandId;
    const eventIds = new Set();
    for (const [index, event] of input.events.entries()) {
        if (event.demandId !== demandId || eventIds.has(event.eventId)) {
            fail("relation", `$/events/${index}`);
        }
        eventIds.add(event.eventId);
    }
    let state = current?.state ?? null;
    const storedEvents = [];
    for (const [index, event] of input.events.entries()) {
        assertEventCommitBoundary(event, expectedStreamRevision, `$/events/${index}`);
        let next;
        try {
            next = evolveDemandEventSourcingState(state, event);
        }
        catch (error) {
            if (error instanceof DemandEventSourcingDecisionError) {
                fail("transition", `$/events/${index}`);
            }
            throw error;
        }
        storedEvents.push(createDemandEventSourcingStoredEvent(event, expectedStreamRevision + index + 1, next));
        state = next;
    }
    const commit = parseDemandEventStreamCommit({
        artifactKind: DEMAND_EVENT_STREAM_COMMIT_ARTIFACT_KIND,
        schemaVersion: DEMAND_EVENT_STREAM_COMMIT_SCHEMA_VERSION,
        commitId: input.commitId,
        demandId,
        commitSequence,
        commandDigest: input.commandDigest,
        expectedStreamRevision,
        firstStreamRevision: expectedStreamRevision + 1,
        lastStreamRevision: expectedStreamRevision + storedEvents.length,
        previousCommitDigest: current?.lastCommitDigest ?? null,
        events: storedEvents,
        ...(input.idempotency === undefined ? {} : { idempotency: input.idempotency }),
    });
    const aggregate = applyDemandEventStreamCommit(current, commit);
    const sourceExpectation = Object.freeze({
        lastEventDigest: current?.lastEventDigest ?? null,
        stateDigest: current?.stateDigest ?? null,
    });
    return Object.freeze({ commit, aggregate, sourceExpectation });
}
/** 纯计算一条Commit计划，不签发Event Store append capability。 */
export function planDemandEventStreamCommit(currentValue, inputValue) {
    return buildDemandEventStreamCommit(currentValue, inputValue).commit;
}
/** 根据当前聚合和一条命令产生的全部未提交事件签发完整追加能力。 */
export function prepareDemandEventStreamCommit(currentValue, inputValue) {
    const prepared = buildDemandEventStreamCommit(currentValue, inputValue);
    ISSUED_PREPARED_COMMITS.add(prepared);
    return prepared;
}
