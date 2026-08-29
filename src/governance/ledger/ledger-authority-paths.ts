import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import type {
  ConfirmationRecord,
  LedgerAuthorityRecord,
  RequirementRecord,
} from "./ledger-authority-record.js";

/**
 * Wakeflow Governance / Ledger：`Requirement`、`Confirmation` 和精简发布意图记录的
 * 固定可移植路径词汇。
 *
 * 所有路径只从已经验证的类型化标识和成员路径派生。本模块不探测文件、不创建目录，
 * 也不把物理路径当作业务身份。
 */

export const LEDGER_REQUIREMENTS_ROOT_REF = parsePortableResourcePath(
  "requirements",
);
export const LEDGER_CONFIRMATIONS_ROOT_REF = parsePortableResourcePath(
  "confirmations",
);
export const LEDGER_TRANSACTIONS_ROOT_REF = parsePortableResourcePath(
  "transactions",
);
export type LedgerAuthorityFamily = "requirement" | "confirmation";
export type LedgerAuthorityRecordId =
  | WakeflowDurableId<"requirement">
  | WakeflowDurableId<"confirmation">;

export function ledgerAuthorityFamily(
  record: Readonly<LedgerAuthorityRecord>,
): LedgerAuthorityFamily {
  return record.artifactKind === "wakeflow-requirement-record"
    ? "requirement"
    : "confirmation";
}

export function ledgerAuthorityRecordId(
  record: Readonly<RequirementRecord>,
): WakeflowDurableId<"requirement">;
export function ledgerAuthorityRecordId(
  record: Readonly<ConfirmationRecord>,
): WakeflowDurableId<"confirmation">;
export function ledgerAuthorityRecordId(
  record: Readonly<LedgerAuthorityRecord>,
): LedgerAuthorityRecordId;
export function ledgerAuthorityRecordId(
  record: Readonly<LedgerAuthorityRecord>,
): LedgerAuthorityRecordId {
  return record.artifactKind === "wakeflow-requirement-record"
    ? record.requirementId
    : record.confirmationId;
}

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

export function confirmationRootRef(
  confirmationId: WakeflowDurableId<"confirmation">,
): PortableResourcePath {
  const id = parseWakeflowDurableIdOfKind(
    confirmationId,
    "confirmation",
    "$confirmationId",
  );
  return parsePortableResourcePath(`${LEDGER_CONFIRMATIONS_ROOT_REF}/${id}`);
}

export function ledgerAuthorityRootRef(
  record: Readonly<LedgerAuthorityRecord>,
): PortableResourcePath {
  return record.artifactKind === "wakeflow-requirement-record"
    ? requirementRootRef(record.requirementId)
    : confirmationRootRef(record.confirmationId);
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

function publicationRecordId(
  family: LedgerAuthorityFamily,
  recordId: unknown,
): LedgerAuthorityRecordId {
  return family === "requirement"
    ? parseWakeflowDurableIdOfKind(recordId, "requirement", "$recordId")
    : parseWakeflowDurableIdOfKind(recordId, "confirmation", "$recordId");
}

export function ledgerRecordPublicationIntentRefForIdentity(
  family: LedgerAuthorityFamily,
  recordIdValue: unknown,
): PortableResourcePath {
  const recordId = publicationRecordId(family, recordIdValue);
  return parsePortableResourcePath(
    `${LEDGER_TRANSACTIONS_ROOT_REF}/${recordId}.intent.json`,
  );
}

export function ledgerRecordPublicationLockRefForIdentity(
  family: LedgerAuthorityFamily,
  recordIdValue: unknown,
): PortableResourcePath {
  const recordId = publicationRecordId(family, recordIdValue);
  return parsePortableResourcePath(
    `${LEDGER_TRANSACTIONS_ROOT_REF}/${recordId}.lock`,
  );
}

export function ledgerRecordPublicationIntentRef(
  record: Readonly<LedgerAuthorityRecord>,
): PortableResourcePath {
  return ledgerRecordPublicationIntentRefForIdentity(
    ledgerAuthorityFamily(record),
    ledgerAuthorityRecordId(record),
  );
}

export function ledgerRecordPublicationLockRef(
  record: Readonly<LedgerAuthorityRecord>,
): PortableResourcePath {
  return ledgerRecordPublicationLockRefForIdentity(
    ledgerAuthorityFamily(record),
    ledgerAuthorityRecordId(record),
  );
}

/** 每个类型化记录标识只对应一个私有暂存路径；发布意图记录负责绑定目录树摘要。 */
export function ledgerRecordPublicationStageRef(
  record: Readonly<LedgerAuthorityRecord>,
): PortableResourcePath {
  return parsePortableResourcePath(
    `${LEDGER_TRANSACTIONS_ROOT_REF}/.${ledgerAuthorityRecordId(record)}.stage`,
  );
}
