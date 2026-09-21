import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { parsePortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
/**
 * Wakeflow Governance / Evidence：Demand根内Managed Evidence资源的关闭路径词汇。
 *
 * 最终记录位于`artifacts/managed-evidence/<evidenceId>`，并固定包含`manifest.json`
 * 与`payload/`。同一Evidence的未发布stage使用隐藏且可逆解析的同父名称；Demand级
 * publication journal使用一个固定槽位，从路径层面禁止同一Demand并行存在两份
 * 跨资源Evidence事务。
 *
 * 本模块只负责typed ID与PortableResourcePath之间的双向词法映射，不读取目录、
 * 不判断stage/final是否存在，也不授予创建、发布、恢复或删除权限。
 */
export const MANAGED_EVIDENCE_ROOT_REF = parsePortableResourcePath("artifacts/managed-evidence");
export const MANAGED_EVIDENCE_MANIFEST_FILE_NAME = "manifest.json";
export const MANAGED_EVIDENCE_PAYLOAD_DIRECTORY_NAME = "payload";
export const MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_FILE_NAME = "managed-evidence-publication.json";
export const MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF = parsePortableResourcePath(`transactions/${MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_FILE_NAME}`);
const MANAGED_EVIDENCE_RECORD_DIRECTORY_PATTERN = /^(?<evidenceId>evidence_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
const MANAGED_EVIDENCE_STAGE_DIRECTORY_PATTERN = /^\.(?<evidenceId>evidence_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.wakeflow-stage$/u;
const ERROR_MESSAGES = {
    identifier: "Managed evidence resource identity is invalid.",
    "record-directory-name": "Managed evidence record directory name is invalid.",
    "stage-directory-name": "Managed evidence stage directory name is invalid.",
};
/** Managed Evidence资源路径无法形成唯一映射时的稳定错误。 */
export class ManagedEvidenceResourcePathError extends Error {
    name = "ManagedEvidenceResourcePathError";
    code = "wakeflow-managed-evidence-resource-path";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new ManagedEvidenceResourcePathError(reason, path);
}
function evidenceId(value, path) {
    try {
        return parseWakeflowDurableIdOfKind(value, "evidence", path);
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("identifier", path);
        throw error;
    }
}
function recordAddress(id) {
    const recordRootRef = parsePortableResourcePath(`${MANAGED_EVIDENCE_ROOT_REF}/${id}`);
    return Object.freeze({
        evidenceId: id,
        directoryName: id,
        recordRootRef,
        manifestRef: parsePortableResourcePath(`${recordRootRef}/${MANAGED_EVIDENCE_MANIFEST_FILE_NAME}`),
        payloadRootRef: parsePortableResourcePath(`${recordRootRef}/${MANAGED_EVIDENCE_PAYLOAD_DIRECTORY_NAME}`),
    });
}
/** 从Evidence身份派生最终记录根、Manifest与payload引用。 */
export function managedEvidenceRecordAddress(value) {
    return recordAddress(evidenceId(value, "$evidenceId"));
}
export function managedEvidenceRecordRootRef(value) {
    return managedEvidenceRecordAddress(value).recordRootRef;
}
export function managedEvidenceManifestRef(value) {
    return managedEvidenceRecordAddress(value).manifestRef;
}
export function managedEvidencePayloadRootRef(value) {
    return managedEvidenceRecordAddress(value).payloadRootRef;
}
/** 从Evidence身份派生唯一未发布stage引用。 */
export function managedEvidencePublicationStageRef(value) {
    const id = evidenceId(value, "$evidenceId");
    return parsePortableResourcePath(`${MANAGED_EVIDENCE_ROOT_REF}/.${id}.wakeflow-stage`);
}
/** 从最终记录目录名恢复Evidence身份及完整地址。 */
export function parseManagedEvidenceRecordDirectoryName(value) {
    if (typeof value !== "string") {
        fail("record-directory-name", "$directoryName");
    }
    const text = MANAGED_EVIDENCE_RECORD_DIRECTORY_PATTERN.exec(value)?.groups?.evidenceId;
    if (text === undefined) {
        fail("record-directory-name", "$directoryName");
    }
    let id;
    try {
        id = evidenceId(text, "$directoryName");
    }
    catch (error) {
        if (error instanceof ManagedEvidenceResourcePathError) {
            fail("record-directory-name", "$directoryName");
        }
        throw error;
    }
    const address = recordAddress(id);
    if (address.directoryName !== value) {
        fail("record-directory-name", "$directoryName");
    }
    return address;
}
/** 从隐藏stage目录名恢复Evidence身份及stage引用。 */
export function parseManagedEvidenceStageDirectoryName(value) {
    if (typeof value !== "string") {
        fail("stage-directory-name", "$directoryName");
    }
    const text = MANAGED_EVIDENCE_STAGE_DIRECTORY_PATTERN.exec(value)?.groups?.evidenceId;
    if (text === undefined) {
        fail("stage-directory-name", "$directoryName");
    }
    let id;
    try {
        id = evidenceId(text, "$directoryName");
    }
    catch (error) {
        if (error instanceof ManagedEvidenceResourcePathError) {
            fail("stage-directory-name", "$directoryName");
        }
        throw error;
    }
    const directoryName = `.${id}.wakeflow-stage`;
    if (directoryName !== value) {
        fail("stage-directory-name", "$directoryName");
    }
    return Object.freeze({
        evidenceId: id,
        directoryName,
        stageRootRef: managedEvidencePublicationStageRef(id),
    });
}
