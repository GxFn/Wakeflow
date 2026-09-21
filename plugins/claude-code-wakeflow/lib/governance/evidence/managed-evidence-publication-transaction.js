import { WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_SCHEMA } from "../../contracts/generated/governance/evidence/managed-evidence-publication-transaction.generated.js";
import { WAKEFLOW_LOADED_ARTIFACT_TREE_MANIFEST_SCHEMA } from "../../contracts/generated/foundation/loaded-artifact-tree-manifest.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import { WAKEFLOW_MANAGED_EVIDENCE_MANIFEST_SCHEMA } from "../../contracts/generated/governance/evidence/managed-evidence-manifest.generated.js";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { DeterministicJsonDocumentError, parseDeterministicJsonDocument, renderDeterministicJsonDocument, } from "../../foundation/data/deterministic-json-document.js";
import { JsonValueError, parseJsonValue, } from "../../foundation/data/json-value.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import { computeDemandEventSourcingCommandDigest, parseDemandEventSourcingCommand, DemandEventSourcingDecisionError, } from "../demand/event-sourcing/demand-event-sourcing-decider.js";
import { parseDemandEventStreamRevision, DemandEventStreamPositionError, } from "../demand/event-sourcing/demand-event-stream-position.js";
import { createManagedEvidenceCapturePlan, parseManagedEvidenceCapturePlan, ManagedEvidenceCapturePlanError, } from "./managed-evidence-capture-plan.js";
import { parseManagedEvidenceManifest, ManagedEvidenceManifestError, } from "./managed-evidence-manifest.js";
import { planManagedEvidenceRecordTree, ManagedEvidenceRecordTreePlanError, } from "./managed-evidence-record-tree-plan.js";
/**
 * Wakeflow Governance / Evidence：Managed Evidence跨资源发布的不可变事务合同。
 *
 * Transaction把一份已确认capture plan绑定到完整record tree，以及Demand Event
 * Sourcing的一次乐观追加。它只保存恢复所需且无法从Manifest完全推导的摘要、CAS
 * 预期与稳定ID；stage/final路径、完整record plan和Event command均由codec重建。
 *
 * 本文件不保存可变phase，不读取source，不创建journal/stage/final，不追加Event，
 * 也不决定Event前退休或Event后前向完成。物理状态由后续Inventory与Application观察。
 */
const MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_KIND = "wakeflow-managed-evidence-publication-transaction";
const MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_VERSION = 1;
/** Manifest上限之外为CAS、摘要、typed ID和确定性文档格式保留固定余量。 */
export const MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_MAXIMUM_BYTES = 2 * 1024 * 1024;
const ERROR_MESSAGES = {
    input: "Managed evidence publication transaction input is invalid.",
    json: "Managed evidence publication transaction is not passive JSON data.",
    schema: "Managed evidence publication transaction does not satisfy its Schema.",
    identifier: "Managed evidence publication transaction contains an invalid identity.",
    position: "Managed evidence publication transaction contains an invalid stream position.",
    digest: "Managed evidence publication transaction contains an invalid digest.",
    "capture-plan": "Managed evidence publication transaction contains an invalid capture plan.",
    manifest: "Managed evidence publication transaction contains an invalid Manifest.",
    "record-plan": "Managed evidence publication transaction cannot derive its record tree plan.",
    "event-sourcing": "Managed evidence publication transaction contains an invalid Event Sourcing append.",
    relation: "Managed evidence publication transaction fields do not describe one publication.",
    representation: "Managed evidence publication transaction bytes are not deterministic.",
};
/** Publication transaction准入或关系重建失败时的稳定、脱敏错误。 */
export class ManagedEvidencePublicationTransactionError extends Error {
    name = "ManagedEvidencePublicationTransactionError";
    code = "wakeflow-managed-evidence-publication-transaction";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const validateWire = createRuntimeJsonSchemaValidator(WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_SCHEMA, [
    WAKEFLOW_MANAGED_EVIDENCE_MANIFEST_SCHEMA,
    WAKEFLOW_LOADED_ARTIFACT_TREE_MANIFEST_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
]);
const CREATE_FIELDS = Object.freeze([
    "capturePlan",
    "commitId",
    "eventId",
]);
function fail(reason, path) {
    throw new ManagedEvidencePublicationTransactionError(reason, path);
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
function parseId(value, kind, path) {
    try {
        return parseWakeflowDurableIdOfKind(value, kind, path);
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("identifier", path);
        throw error;
    }
}
function parseManifest(value) {
    try {
        return parseManagedEvidenceManifest(value);
    }
    catch (error) {
        if (error instanceof ManagedEvidenceManifestError) {
            fail("manifest", "$/manifest");
        }
        throw error;
    }
}
function parseStreamRevision(value) {
    let revision;
    try {
        revision = parseDemandEventStreamRevision(value, "$/demandEventSourcingAppend/expectedStreamRevision");
    }
    catch (error) {
        if (error instanceof DemandEventStreamPositionError) {
            fail("position", "$/demandEventSourcingAppend/expectedStreamRevision");
        }
        throw error;
    }
    if (revision >= Number.MAX_SAFE_INTEGER) {
        fail("position", "$/demandEventSourcingAppend/expectedStreamRevision");
    }
    return revision;
}
function buildEventSourcingCommand(manifest, eventId) {
    try {
        const command = parseDemandEventSourcingCommand({
            commandType: "evidence.record-managed-evidence",
            commandVersion: 1,
            eventId,
            manifest,
        });
        if (command.commandType !== "evidence.record-managed-evidence") {
            fail("event-sourcing", "$/demandEventSourcingAppend");
        }
        return command;
    }
    catch (error) {
        if (error instanceof DemandEventSourcingDecisionError) {
            fail("event-sourcing", "$/demandEventSourcingAppend");
        }
        throw error;
    }
}
function deriveRecordTreePlan(manifest) {
    try {
        return planManagedEvidenceRecordTree(manifest);
    }
    catch (error) {
        if (error instanceof ManagedEvidenceRecordTreePlanError) {
            fail("record-plan", "$/manifest");
        }
        throw error;
    }
}
function capturePlanFromTransaction(transaction) {
    try {
        return createManagedEvidenceCapturePlan({
            configDigest: transaction.manifest.recordedBy.configDigest,
            expectedDemand: {
                streamRevision: transaction.demandEventSourcingAppend.expectedStreamRevision,
                stateDigest: transaction.demandEventSourcingAppend.expectedStateDigest,
                lastEventId: transaction.demandEventSourcingAppend.expectedLastEventId,
                lastEventDigest: transaction.demandEventSourcingAppend.expectedLastEventDigest,
            },
            manifest: transaction.manifest,
        });
    }
    catch (error) {
        if (error instanceof ManagedEvidenceCapturePlanError) {
            fail("relation", "$/capturePlanDigest");
        }
        throw error;
    }
}
function normalizeAppend(wire) {
    return Object.freeze({
        expectedStreamRevision: parseStreamRevision(wire.expectedStreamRevision),
        expectedStateDigest: parseDigest(wire.expectedStateDigest, "$/demandEventSourcingAppend/expectedStateDigest"),
        expectedLastEventId: parseId(wire.expectedLastEventId, "demand-event", "$/demandEventSourcingAppend/expectedLastEventId"),
        expectedLastEventDigest: parseDigest(wire.expectedLastEventDigest, "$/demandEventSourcingAppend/expectedLastEventDigest"),
        eventId: parseId(wire.eventId, "demand-event", "$/demandEventSourcingAppend/eventId"),
        commandDigest: parseDigest(wire.commandDigest, "$/demandEventSourcingAppend/commandDigest"),
        commitId: parseId(wire.commitId, "demand-event-commit", "$/demandEventSourcingAppend/commitId"),
    });
}
function assertRelations(transaction) {
    const append = transaction.demandEventSourcingAppend;
    const command = buildEventSourcingCommand(transaction.manifest, append.eventId);
    const recordTreePlan = deriveRecordTreePlan(transaction.manifest);
    const capturePlan = capturePlanFromTransaction(transaction);
    if (append.eventId === append.expectedLastEventId ||
        append.commandDigest !== computeDemandEventSourcingCommandDigest(command) ||
        transaction.recordTreePlanDigest !== recordTreePlan.planDigest ||
        transaction.capturePlanDigest !== capturePlan.planDigest) {
        fail("relation", "$transaction");
    }
}
/** 把任意JSON值解析为不可变、无phase的Managed Evidence发布恢复计划。 */
export function parseManagedEvidencePublicationTransaction(value) {
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
    const transaction = Object.freeze({
        artifactKind: MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_KIND,
        schemaVersion: MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_VERSION,
        capturePlanDigest: parseDigest(wire.capturePlanDigest, "$/capturePlanDigest"),
        manifest: parseManifest(wire.manifest),
        recordTreePlanDigest: parseDigest(wire.recordTreePlanDigest, "$/recordTreePlanDigest"),
        demandEventSourcingAppend: normalizeAppend(wire.demandEventSourcingAppend),
    });
    assertRelations(transaction);
    return transaction;
}
/** 从已确认capture plan和一次性Event/Commit ID生成完整持久事务。 */
export function createManagedEvidencePublicationTransaction(value) {
    let input;
    try {
        input = parsePlainRecord(value, "$input");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$input");
        throw error;
    }
    const actual = Object.keys(input).sort();
    if (actual.length !== CREATE_FIELDS.length ||
        actual.some((key, index) => key !== CREATE_FIELDS[index])) {
        fail("input", "$input");
    }
    let capturePlan;
    try {
        capturePlan = parseManagedEvidenceCapturePlan(input.capturePlan);
    }
    catch (error) {
        if (error instanceof ManagedEvidenceCapturePlanError) {
            fail("capture-plan", "$/capturePlan");
        }
        throw error;
    }
    const eventId = parseId(input.eventId, "demand-event", "$/eventId");
    const commitId = parseId(input.commitId, "demand-event-commit", "$/commitId");
    const command = buildEventSourcingCommand(capturePlan.manifest, eventId);
    const recordTreePlan = deriveRecordTreePlan(capturePlan.manifest);
    return parseManagedEvidencePublicationTransaction({
        artifactKind: MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_KIND,
        schemaVersion: MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_VERSION,
        capturePlanDigest: capturePlan.planDigest,
        manifest: capturePlan.manifest,
        recordTreePlanDigest: recordTreePlan.planDigest,
        demandEventSourcingAppend: {
            expectedStreamRevision: capturePlan.expectedDemand.streamRevision,
            expectedStateDigest: capturePlan.expectedDemand.stateDigest,
            expectedLastEventId: capturePlan.expectedDemand.lastEventId,
            expectedLastEventDigest: capturePlan.expectedDemand.lastEventDigest,
            eventId,
            commandDigest: computeDemandEventSourcingCommandDigest(command),
            commitId,
        },
    });
}
/** 从事务重建将交给Demand Command Handler的exact Event Sourcing命令。 */
export function deriveManagedEvidencePublicationEventSourcingCommand(value) {
    const transaction = parseManagedEvidencePublicationTransaction(value);
    return buildEventSourcingCommand(transaction.manifest, transaction.demandEventSourcingAppend.eventId);
}
/** 从事务中的单份Manifest重建exact stage/final record tree计划。 */
export function deriveManagedEvidencePublicationRecordTreePlan(value) {
    return deriveRecordTreePlan(parseManagedEvidencePublicationTransaction(value).manifest);
}
export function renderManagedEvidencePublicationTransaction(value) {
    return renderDeterministicJsonDocument(parseManagedEvidencePublicationTransaction(value), "$transaction");
}
export function parseManagedEvidencePublicationTransactionDocument(text) {
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
    const transaction = parseManagedEvidencePublicationTransaction(json);
    if (renderManagedEvidencePublicationTransaction(transaction) !== text) {
        fail("representation", "$transaction");
    }
    return transaction;
}
export function computeManagedEvidencePublicationTransactionDigest(value) {
    return computeCanonicalJsonSha256Digest(parseManagedEvidencePublicationTransaction(value), "$transaction");
}
