import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import type { LedgerAuthorityRecord } from "./ledger-authority-record.js";

/**
 * Wakeflow Governance / Ledger：需求包记录和精简发布意图记录的固定可移植路径词汇。
 *
 * 所有路径只从已经验证的类型化标识和成员路径派生。本模块不探测文件、不创建目录，
 * 也不把物理路径当作业务身份。
 */

export const LEDGER_REQUIREMENTS_ROOT_REF = parsePortableResourcePath(
  "requirements",
);
export const LEDGER_TRANSACTIONS_ROOT_REF = parsePortableResourcePath(
  "transactions",
);
/** 完成或取消的 Demand 归档包容器；包内布局由内核 layout 的 `demandArchiveRef` 给出。 */
export const LEDGER_ARCHIVES_ROOT_REF = parsePortableResourcePath("archives");

/** Ledger 只剩需求包一个记录家族；字段保留在成员引用中供跨领域消费方判别。 */
export type LedgerAuthorityFamily = "requirement";
export const LEDGER_AUTHORITY_FAMILY: LedgerAuthorityFamily = "requirement";

export function requirementRootRef(
  requirementId: WakeflowDurableId<"requirement">,
): PortableResourcePath {
  const id = parseWakeflowDurableIdOfKind(
    requirementId,
    "requirement",
    "$requirementId",
  );
  return parsePortableResourcePath(`${LEDGER_REQUIREMENTS_ROOT_REF}/${id}`);
}

export function ledgerAuthorityRootRef(
  record: Readonly<LedgerAuthorityRecord>,
): PortableResourcePath {
  return requirementRootRef(record.requirementId);
}

export function ledgerAuthorityRecordRef(
  record: Readonly<LedgerAuthorityRecord>,
): PortableResourcePath {
  return parsePortableResourcePath(`${ledgerAuthorityRootRef(record)}/record.json`);
}

export function ledgerAuthorityMemberRef(
  record: Readonly<LedgerAuthorityRecord>,
  memberPath: PortableResourcePath,
): PortableResourcePath {
  return parsePortableResourcePath(
    `${ledgerAuthorityRootRef(record)}/${parsePortableResourcePath(memberPath)}`,
  );
}

export function ledgerRecordPublicationIntentRefForIdentity(
  recordIdValue: unknown,
): PortableResourcePath {
  const recordId = parseWakeflowDurableIdOfKind(
    recordIdValue,
    "requirement",
    "$recordId",
  );
  return parsePortableResourcePath(
    `${LEDGER_TRANSACTIONS_ROOT_REF}/${recordId}.intent.json`,
  );
}

export function ledgerRecordPublicationLockRefForIdentity(
  recordIdValue: unknown,
): PortableResourcePath {
  const recordId = parseWakeflowDurableIdOfKind(
    recordIdValue,
    "requirement",
    "$recordId",
  );
  return parsePortableResourcePath(
    `${LEDGER_TRANSACTIONS_ROOT_REF}/${recordId}.lock`,
  );
}

export function ledgerRecordPublicationIntentRef(
  record: Readonly<LedgerAuthorityRecord>,
): PortableResourcePath {
  return ledgerRecordPublicationIntentRefForIdentity(record.requirementId);
}

export function ledgerRecordPublicationLockRef(
  record: Readonly<LedgerAuthorityRecord>,
): PortableResourcePath {
  return ledgerRecordPublicationLockRefForIdentity(record.requirementId);
}

/** 每个类型化记录标识只对应一个私有暂存路径；发布意图记录负责绑定目录树摘要。 */
export function ledgerRecordPublicationStageRef(
  record: Readonly<LedgerAuthorityRecord>,
): PortableResourcePath {
  return parsePortableResourcePath(
    `${LEDGER_TRANSACTIONS_ROOT_REF}/.${record.requirementId}.stage`,
  );
}
