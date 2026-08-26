import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableId,
} from "../../foundation/identity/wakeflow-durable-id.js";
import type {
  ConfirmationRecord,
  LedgerAuthorityRecord,
  RequirementRecord,
} from "./ledger-authority-record.js";

/**
 * Wakeflow Governance / Ledger：Requirement、Confirmation 与 publication journal
 * 的固定 portable path vocabulary。
 *
 * 路径只从已验证 typed ID 和 member path 派生；本模块不探测文件、不创建目录，也
 * 不把 physical path 当作业务身份。
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
export const LEDGER_AUTHORITY_LOCK_REF = parsePortableResourcePath(
  "ledger-authority.lock",
);

export type LedgerAuthorityFamily = "requirement" | "confirmation";

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
): WakeflowDurableId<"requirement"> | WakeflowDurableId<"confirmation">;
export function ledgerAuthorityRecordId(
  record: Readonly<LedgerAuthorityRecord>,
): WakeflowDurableId<"requirement"> | WakeflowDurableId<"confirmation"> {
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

export function ledgerRecordPublicationRef(
  record: Readonly<LedgerAuthorityRecord>,
): PortableResourcePath {
  return parsePortableResourcePath(
    `${LEDGER_TRANSACTIONS_ROOT_REF}/${ledgerAuthorityFamily(record)}-${ledgerAuthorityRecordId(record)}.json`,
  );
}
