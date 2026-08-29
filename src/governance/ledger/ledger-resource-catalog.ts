import { computeSha256Digest } from "../../foundation/crypto/sha256.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  parseWakeflowWorkspaceResourceDeclaration,
  type WakeflowWorkspaceResourceDeclaration,
} from "../../workspace/workspace-resource-declaration.js";
import {
  parseLedgerAuthorityRecord,
  type LedgerAuthorityRecord,
} from "./ledger-authority-record.js";
import {
  ledgerAuthorityMemberRef,
  ledgerAuthorityRecordId,
  ledgerAuthorityRecordRef,
  ledgerAuthorityRootRef,
  ledgerRecordPublicationIntentRef,
  ledgerRecordPublicationLockRef,
  LEDGER_CONFIRMATIONS_ROOT_REF,
  LEDGER_REQUIREMENTS_ROOT_REF,
  LEDGER_TRANSACTIONS_ROOT_REF,
} from "./ledger-authority-paths.js";

/**
 * Wakeflow Governance / Ledger：`Requirement`、`Confirmation` 职责所有者的资源目录。
 *
 * 静态目录登记可长期共享的分类根目录和运行时私有的事务根目录。具体记录工厂为一条
 * 已验证记录登记最终聚合目录、记录清单、成员事实、精简发布意图记录和逐记录锁。
 * 私有暂存目录只在单次 `exact-directory-publish` 操作期间作为源资源存在，其归属由
 * 发布意图记录和目录树摘要证明，因此不会重复登记为长期资源。
 */

function directoryDeclaration(
  declarationId: string,
  ownerId: string,
  relativePath: PortableResourcePath,
  durable: boolean,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  return parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId,
    family: "ledger",
    ownerId,
    scope: "host-neutral",
    placement: {
      root: { kind: "ledger" },
      relativePath,
    },
    tracking: durable
      ? { disposition: "tracked", privacy: "shareable" }
      : { disposition: "ignored", privacy: "runtime-private" },
    nodePolicy: {
      kind: "directory",
      mode: durable ? "0755" : "0700",
      symlinkPolicy: "reject",
      existingModePolicy: "observe-without-change",
    },
    processing: {
      kind: "directory-container",
      materializationRecipe: "materialize-directory",
      existingDirectoryPolicy: "observe-without-mode-change",
      collisionPolicy: "reject-non-directory",
      descendantAuthority: "separate-declaration-required",
      recoveryStrategy: "report-only",
    },
  });
}

function durableFactDeclaration(
  declarationId: string,
  relativePath: PortableResourcePath,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  return parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId,
    family: "ledger",
    ownerId: "ledger-authority",
    scope: "host-neutral",
    placement: {
      root: { kind: "ledger" },
      relativePath,
    },
    tracking: {
      disposition: "tracked",
      privacy: "shareable",
    },
    nodePolicy: {
      kind: "file",
      mode: "0644",
      linkPolicy: "single-link",
      executablePolicy: "forbidden",
    },
    processing: {
      kind: "resource",
      role: "immutable-fact",
      allowedMutationRecipes: ["exclusive-create"],
      recoveryStrategy: "exact-idempotent-retry",
    },
  });
}

function transactionDeclaration(
  declarationId: string,
  relativePath: PortableResourcePath,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  return parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId,
    family: "ledger",
    ownerId: "ledger-record-publication",
    scope: "host-neutral",
    placement: {
      root: { kind: "ledger" },
      relativePath,
    },
    tracking: {
      disposition: "ignored",
      privacy: "runtime-private",
    },
    nodePolicy: {
      kind: "file",
      mode: "0600",
      linkPolicy: "single-link",
      executablePolicy: "forbidden",
    },
    processing: {
      kind: "resource",
      role: "transaction-artifact",
      allowedMutationRecipes: [
        "exclusive-create",
        "exact-retire",
      ],
      recoveryStrategy: "owner-transaction-recovery",
    },
  });
}

const LEDGER_CONFIRMATIONS_ROOT_RESOURCE_DECLARATION =
  directoryDeclaration(
    "ledger.confirmations-root",
    "ledger-layout",
    LEDGER_CONFIRMATIONS_ROOT_REF,
    true,
  );

const LEDGER_REQUIREMENTS_ROOT_RESOURCE_DECLARATION =
  directoryDeclaration(
    "ledger.requirements-root",
    "ledger-layout",
    LEDGER_REQUIREMENTS_ROOT_REF,
    true,
  );

const LEDGER_TRANSACTIONS_ROOT_RESOURCE_DECLARATION =
  directoryDeclaration(
    "ledger.transactions-root",
    "ledger-record-publication",
    LEDGER_TRANSACTIONS_ROOT_REF,
    false,
  );

/** Ledger 职责所有者的确定性静态资源目录。 */
export const WAKEFLOW_LEDGER_STATIC_RESOURCE_CATALOG = Object.freeze([
  LEDGER_CONFIRMATIONS_ROOT_RESOURCE_DECLARATION,
  LEDGER_REQUIREMENTS_ROOT_RESOURCE_DECLARATION,
  LEDGER_TRANSACTIONS_ROOT_RESOURCE_DECLARATION,
]) satisfies readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];

function memberDeclarationId(
  record: Readonly<LedgerAuthorityRecord>,
  memberPath: PortableResourcePath,
): string {
  const digest = computeSha256Digest(encodeUtf8(
    `${ledgerAuthorityRecordId(record)}\u0000${memberPath}`,
  ));
  return `member-${digest.slice("sha256:".length)}`;
}

/**
 * 为一条已验证的 `Requirement` 或 `Confirmation` 生成具体资源目录。
 * 返回顺序固定为聚合根目录、记录清单、按记录顺序排列的成员、发布意图记录和锁文件。
 */
export function createLedgerAuthorityResourceCatalog(
  recordValue: unknown,
): readonly Readonly<WakeflowWorkspaceResourceDeclaration>[] {
  const record = parseLedgerAuthorityRecord(recordValue);
  const recordId = ledgerAuthorityRecordId(record);
  const prefix = `ledger.authority.${recordId}`;
  const root = parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: `${prefix}.root`,
    family: "ledger",
    ownerId: "ledger-authority",
    scope: "host-neutral",
    placement: {
      root: { kind: "ledger" },
      relativePath: ledgerAuthorityRootRef(record),
    },
    tracking: {
      disposition: "tracked",
      privacy: "shareable",
    },
    nodePolicy: {
      kind: "directory",
      mode: "0755",
      symlinkPolicy: "reject",
      existingModePolicy: "observe-without-change",
    },
    processing: {
      kind: "directory-container",
      materializationRecipe: "exact-directory-publish",
      existingDirectoryPolicy: "owner-validate-existing-target",
      collisionPolicy: "reject-unowned-target",
      descendantAuthority: "separate-declaration-required",
      recoveryStrategy: "owner-forward-recovery",
    },
  });
  const manifest = durableFactDeclaration(
    `${prefix}.record`,
    ledgerAuthorityRecordRef(record),
  );
  const members = record.documents.map((document) => durableFactDeclaration(
    `${prefix}.${memberDeclarationId(record, document.path)}`,
    ledgerAuthorityMemberRef(record, document.path),
  ));
  const intent = transactionDeclaration(
    `${prefix}.intent`,
    ledgerRecordPublicationIntentRef(record),
  );
  const lock = transactionDeclaration(
    `${prefix}.lock`,
    ledgerRecordPublicationLockRef(record),
  );
  return Object.freeze([
    root,
    manifest,
    ...members,
    intent,
    lock,
  ]);
}
