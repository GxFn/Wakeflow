import { WAKEFLOW_DEMAND_EVENT_SOURCING_PUBLICATION_TRANSACTION_SCHEMA, } from "../../../contracts/generated/governance/demand/demand-event-sourcing-publication-transaction.generated.js";
import { WAKEFLOW_DEMAND_AUTHORITY_SCHEMA } from "../../../contracts/generated/governance/demand/demand-authority.generated.js";
import { WAKEFLOW_DEMAND_EVENT_STREAM_COMMIT_SCHEMA } from "../../../contracts/generated/governance/demand/demand-event-stream-commit.generated.js";
import { WAKEFLOW_DEMAND_EVENT_SOURCING_STORED_EVENT_SCHEMA } from "../../../contracts/generated/governance/demand/demand-event-sourcing-stored-event.generated.js";
import { WAKEFLOW_DEMAND_IDENTITY_SCHEMA } from "../../../contracts/generated/governance/demand/demand-identity.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_REQUIREMENT_LINEAGE_SCHEMA } from "../../../contracts/generated/governance/ledger/requirement-lineage.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../../contracts/generated/foundation/utc-instant.generated.js";
import { computeCanonicalJsonSha256Digest, } from "../../../foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest, Sha256Error, } from "../../../foundation/crypto/sha256.js";
import { DeterministicJsonDocumentError, parseDeterministicJsonDocument, renderDeterministicJsonDocument, } from "../../../foundation/data/deterministic-json-document.js";
import { JsonValueError, parseJsonValue, } from "../../../foundation/data/json-value.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../../../foundation/data/passive-own-data.js";
import { parsePortableResourcePath, PortableResourcePathError, } from "../../../foundation/filesystem/portable-resource-path.js";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../../contracts/identity/wakeflow-durable-id.js";
import { createRuntimeJsonSchemaValidator } from "../../../foundation/schema/runtime-json-schema.js";
import { computeDemandEventSourcingCommandDigest, decideDemandEventSourcingCommand, parseDemandEventSourcingCommand, DemandEventSourcingDecisionError, } from "../event-sourcing/demand-event-sourcing-decider.js";
import { computeDemandEventStreamCommitDigest, parseDemandEventStreamCommit, planDemandEventStreamCommit, DemandEventStreamCommitError, } from "../event-sourcing/demand-event-stream-commit.js";
import { computeDemandAuthorityDigest, parseDemandAuthority, DemandAuthorityError, } from "../model/demand-authority.js";
import { computeDemandIdentityDigest, parseDemandIdentity, DemandIdentityError, } from "../model/demand-identity.js";
import { demandFinalRootRef, demandPublicationStageRef, } from "./demand-publication-paths.js";
/**
 * Wakeflow Governance / Demand Event Sourcing Publication：跨资源恢复计划。
 *
 * 事务记录保存完整、不可变的身份/权威关系记录、看板认领前序摘要、初始命令，以及由同一
 * 决策器和状态演进逻辑得到的精确提交记录。快照是可重建缓存，不进入事务权威事实；
 * 恢复流程必须重新计算并验证命令与提交关系后，才能执行副作用。
 */
const DEMAND_EVENT_SOURCING_PUBLICATION_TRANSACTION_ARTIFACT_KIND = "wakeflow-demand-event-sourcing-publication-transaction";
const DEMAND_EVENT_SOURCING_PUBLICATION_TRANSACTION_SCHEMA_VERSION = 1;
const ERROR_MESSAGES = {
    "input": "Demand Event Sourcing publication transaction input is invalid.",
    "json": "Demand Event Sourcing publication transaction is not passive JSON data.",
    "schema": "Demand Event Sourcing publication transaction does not satisfy its Schema.",
    "identifier": "Demand Event Sourcing publication transaction contains an invalid identity.",
    "path": "Demand Event Sourcing publication transaction contains an invalid path.",
    "digest": "Demand Event Sourcing publication transaction contains an invalid digest.",
    "identity": "Demand Event Sourcing publication transaction contains an invalid Demand identity.",
    "authority": "Demand Event Sourcing publication transaction contains invalid authority.",
    "command": "Demand Event Sourcing publication transaction contains an invalid initial command.",
    "commit": "Demand Event Sourcing publication transaction contains an invalid initial commit.",
    "relation": "Demand Event Sourcing publication transaction fields do not form one publication.",
    "representation": "Demand Event Sourcing publication transaction bytes are not deterministic.",
};
export class DemandEventSourcingPublicationTransactionError extends Error {
    name = "DemandEventSourcingPublicationTransactionError";
    code = "wakeflow-demand-event-sourcing-publication-transaction";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const validateWire = createRuntimeJsonSchemaValidator(WAKEFLOW_DEMAND_EVENT_SOURCING_PUBLICATION_TRANSACTION_SCHEMA, [
    WAKEFLOW_DEMAND_AUTHORITY_SCHEMA,
    WAKEFLOW_DEMAND_EVENT_STREAM_COMMIT_SCHEMA,
    WAKEFLOW_DEMAND_EVENT_SOURCING_STORED_EVENT_SCHEMA,
    WAKEFLOW_DEMAND_IDENTITY_SCHEMA,
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_REQUIREMENT_LINEAGE_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
]);
const CREATE_FIELDS = Object.freeze([
    "authority",
    "commitId",
    "eventId",
    "expectedClaimStateDigest",
    "identity",
    "recordedAt",
]);
function fail(reason, path) {
    throw new DemandEventSourcingPublicationTransactionError(reason, path);
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
function parsePath(value, path) {
    try {
        return parsePortableResourcePath(value, path);
    }
    catch (error) {
        if (error instanceof PortableResourcePathError)
            fail("path", path);
        throw error;
    }
}
function sameCommit(left, right) {
    return computeDemandEventStreamCommitDigest(left)
        === computeDemandEventStreamCommitDigest(right);
}
export function parseDemandEventSourcingPublicationTransaction(value) {
    let json;
    try {
        json = parseJsonValue(value, "$transaction");
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
    let demandId;
    try {
        demandId = parseWakeflowDurableIdOfKind(wire.demandId, "demand", "$/demandId");
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError) {
            fail("identifier", "$/demandId");
        }
        throw error;
    }
    let requirementId;
    try {
        requirementId = parseWakeflowDurableIdOfKind(wire.requirementId, "requirement", "$/requirementId");
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError) {
            fail("identifier", "$/requirementId");
        }
        throw error;
    }
    let identity;
    try {
        identity = parseDemandIdentity(wire.identity);
    }
    catch (error) {
        if (error instanceof DemandIdentityError)
            fail("identity", "$/identity");
        throw error;
    }
    let authority;
    try {
        authority = parseDemandAuthority(wire.authority, identity);
    }
    catch (error) {
        if (error instanceof DemandAuthorityError)
            fail("authority", "$/authority");
        throw error;
    }
    let initialCommand;
    try {
        const command = parseDemandEventSourcingCommand(wire.initialCommand);
        if (command.commandType !== "publication.publish-demand") {
            fail("command", "$/initialCommand/commandType");
        }
        initialCommand = command;
    }
    catch (error) {
        if (error instanceof DemandEventSourcingDecisionError) {
            fail("command", "$/initialCommand");
        }
        throw error;
    }
    let initialCommit;
    try {
        initialCommit = parseDemandEventStreamCommit(wire.initialCommit);
    }
    catch (error) {
        if (error instanceof DemandEventStreamCommitError) {
            fail("commit", "$/initialCommit");
        }
        throw error;
    }
    const identityDigest = parseDigest(wire.identityDigest, "$/identityDigest");
    const authorityDigest = parseDigest(wire.authorityDigest, "$/authorityDigest");
    const initialCommandDigest = parseDigest(wire.initialCommandDigest, "$/initialCommandDigest");
    const initialCommitDigest = parseDigest(wire.initialCommitDigest, "$/initialCommitDigest");
    const expectedClaimStateDigest = parseDigest(wire.expectedClaimStateDigest, "$/expectedClaimStateDigest");
    const stageRef = parsePath(wire.stageRef, "$/stageRef");
    const finalRootRef = parsePath(wire.finalRootRef, "$/finalRootRef");
    let recomputed;
    try {
        recomputed = planDemandEventStreamCommit(null, {
            commitId: initialCommit.commitId,
            commandDigest: initialCommandDigest,
            events: decideDemandEventSourcingCommand(null, initialCommand),
        });
    }
    catch (error) {
        if (error instanceof DemandEventSourcingDecisionError
            || error instanceof DemandEventStreamCommitError) {
            fail("relation", "$transaction");
        }
        throw error;
    }
    if (identity.demandId !== demandId
        || authority.demandId !== demandId
        || identity.source.requirementId !== requirementId
        || stageRef !== demandPublicationStageRef(demandId)
        || finalRootRef !== demandFinalRootRef(demandId)
        || identityDigest !== computeDemandIdentityDigest(identity)
        || authorityDigest !== computeDemandAuthorityDigest(authority)
        || initialCommand.demandId !== demandId
        || initialCommand.identityDigest !== identityDigest
        || initialCommand.authorityDigest !== authorityDigest
        || initialCommandDigest !== computeDemandEventSourcingCommandDigest(initialCommand)
        || initialCommit.demandId !== demandId
        || initialCommit.commitSequence !== 1
        || initialCommit.expectedStreamRevision !== 0
        || initialCommitDigest !== computeDemandEventStreamCommitDigest(initialCommit)
        || !sameCommit(initialCommit, recomputed)) {
        fail("relation", "$transaction");
    }
    return Object.freeze({
        artifactKind: DEMAND_EVENT_SOURCING_PUBLICATION_TRANSACTION_ARTIFACT_KIND,
        schemaVersion: DEMAND_EVENT_SOURCING_PUBLICATION_TRANSACTION_SCHEMA_VERSION,
        demandId,
        requirementId,
        expectedClaimStateDigest,
        stageRef,
        finalRootRef,
        identity,
        identityDigest,
        authority,
        authorityDigest,
        initialCommand,
        initialCommandDigest,
        initialCommit,
        initialCommitDigest,
    });
}
/** 从已经确认的发布输入生成不含可变阶段的完整恢复计划。 */
export function createDemandEventSourcingPublicationTransaction(value) {
    let input;
    try {
        input = parsePlainRecord(value, "$input");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$input");
        throw error;
    }
    const keys = Object.keys(input).sort();
    if (keys.length !== CREATE_FIELDS.length
        || keys.some((key, index) => key !== CREATE_FIELDS[index])) {
        fail("input", "$input");
    }
    let identity;
    let authority;
    let commitId;
    try {
        identity = parseDemandIdentity(input.identity);
        authority = parseDemandAuthority(input.authority, identity);
        commitId = parseWakeflowDurableIdOfKind(input.commitId, "demand-event-commit", "$/commitId");
    }
    catch (error) {
        if (error instanceof DemandIdentityError
            || error instanceof DemandAuthorityError
            || error instanceof WakeflowDurableIdError) {
            fail("input", "$input");
        }
        throw error;
    }
    const identityDigest = computeDemandIdentityDigest(identity);
    const authorityDigest = computeDemandAuthorityDigest(authority);
    const expectedClaimStateDigest = parseDigest(input.expectedClaimStateDigest, "$/expectedClaimStateDigest");
    let initialCommand;
    try {
        const parsed = parseDemandEventSourcingCommand({
            commandType: "publication.publish-demand",
            commandVersion: 1,
            demandId: identity.demandId,
            eventId: input.eventId,
            recordedAt: input.recordedAt,
            identityDigest,
            authorityDigest,
        });
        if (parsed.commandType !== "publication.publish-demand") {
            fail("command", "$initialCommand");
        }
        initialCommand = parsed;
    }
    catch (error) {
        if (error instanceof DemandEventSourcingDecisionError) {
            fail("input", "$input");
        }
        throw error;
    }
    const initialCommandDigest = computeDemandEventSourcingCommandDigest(initialCommand);
    let initialCommit;
    try {
        initialCommit = planDemandEventStreamCommit(null, {
            commitId,
            commandDigest: initialCommandDigest,
            events: decideDemandEventSourcingCommand(null, initialCommand),
        });
    }
    catch (error) {
        if (error instanceof DemandEventSourcingDecisionError
            || error instanceof DemandEventStreamCommitError) {
            fail("commit", "$initialCommit");
        }
        throw error;
    }
    return parseDemandEventSourcingPublicationTransaction({
        artifactKind: DEMAND_EVENT_SOURCING_PUBLICATION_TRANSACTION_ARTIFACT_KIND,
        schemaVersion: DEMAND_EVENT_SOURCING_PUBLICATION_TRANSACTION_SCHEMA_VERSION,
        demandId: identity.demandId,
        requirementId: identity.source.requirementId,
        expectedClaimStateDigest,
        stageRef: demandPublicationStageRef(identity.demandId),
        finalRootRef: demandFinalRootRef(identity.demandId),
        identity,
        identityDigest,
        authority,
        authorityDigest,
        initialCommand,
        initialCommandDigest,
        initialCommit,
        initialCommitDigest: computeDemandEventStreamCommitDigest(initialCommit),
    });
}
export function renderDemandEventSourcingPublicationTransaction(value) {
    return renderDeterministicJsonDocument(parseDemandEventSourcingPublicationTransaction(value), "$transaction");
}
export function parseDemandEventSourcingPublicationTransactionDocument(text) {
    let json;
    try {
        json = parseDeterministicJsonDocument(text, "$transaction");
    }
    catch (error) {
        if (error instanceof DeterministicJsonDocumentError) {
            fail("representation", "$transaction");
        }
        throw error;
    }
    const transaction = parseDemandEventSourcingPublicationTransaction(json);
    if (renderDemandEventSourcingPublicationTransaction(transaction) !== text) {
        fail("representation", "$transaction");
    }
    return transaction;
}
export function computeDemandEventSourcingPublicationTransactionDigest(value) {
    return computeCanonicalJsonSha256Digest(parseDemandEventSourcingPublicationTransaction(value));
}
