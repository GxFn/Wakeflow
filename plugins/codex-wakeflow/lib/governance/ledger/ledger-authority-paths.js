import { parsePortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
import { parseWakeflowDurableIdOfKind, } from "../../contracts/identity/wakeflow-durable-id.js";
/**
 * Wakeflow Governance / Ledger：需求包记录和精简发布意图记录的固定可移植路径词汇。
 *
 * 所有路径只从已经验证的类型化标识和成员路径派生。本模块不探测文件、不创建目录，
 * 也不把物理路径当作业务身份。
 */
export const LEDGER_REQUIREMENTS_ROOT_REF = parsePortableResourcePath("requirements");
export const LEDGER_TRANSACTIONS_ROOT_REF = parsePortableResourcePath("transactions");
/** 完成或取消的 Demand 归档包容器；包内布局由内核 layout 的 `demandArchiveRef` 给出。 */
export const LEDGER_ARCHIVES_ROOT_REF = parsePortableResourcePath("archives");
export const LEDGER_AUTHORITY_FAMILY = "requirement";
export function requirementRootRef(requirementId) {
    const id = parseWakeflowDurableIdOfKind(requirementId, "requirement", "$requirementId");
    return parsePortableResourcePath(`${LEDGER_REQUIREMENTS_ROOT_REF}/${id}`);
}
export function ledgerAuthorityRootRef(record) {
    return requirementRootRef(record.requirementId);
}
export function ledgerAuthorityRecordRef(record) {
    return parsePortableResourcePath(`${ledgerAuthorityRootRef(record)}/record.json`);
}
export function ledgerAuthorityMemberRef(record, memberPath) {
    return parsePortableResourcePath(`${ledgerAuthorityRootRef(record)}/${parsePortableResourcePath(memberPath)}`);
}
export function ledgerRecordPublicationIntentRefForIdentity(recordIdValue) {
    const recordId = parseWakeflowDurableIdOfKind(recordIdValue, "requirement", "$recordId");
    return parsePortableResourcePath(`${LEDGER_TRANSACTIONS_ROOT_REF}/${recordId}.intent.json`);
}
export function ledgerRecordPublicationLockRefForIdentity(recordIdValue) {
    const recordId = parseWakeflowDurableIdOfKind(recordIdValue, "requirement", "$recordId");
    return parsePortableResourcePath(`${LEDGER_TRANSACTIONS_ROOT_REF}/${recordId}.lock`);
}
export function ledgerRecordPublicationIntentRef(record) {
    return ledgerRecordPublicationIntentRefForIdentity(record.requirementId);
}
export function ledgerRecordPublicationLockRef(record) {
    return ledgerRecordPublicationLockRefForIdentity(record.requirementId);
}
/** 每个类型化记录标识只对应一个私有暂存路径；发布意图记录负责绑定目录树摘要。 */
export function ledgerRecordPublicationStageRef(record) {
    return parsePortableResourcePath(`${LEDGER_TRANSACTIONS_ROOT_REF}/.${record.requirementId}.stage`);
}
