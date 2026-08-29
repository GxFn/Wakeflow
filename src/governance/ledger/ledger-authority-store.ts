import { types } from "node:util";

import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  RootedDirectory,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
} from "../../foundation/identity/wakeflow-durable-id.js";
import {
  createLedgerAuthorityMemberReference,
  loadLedgerAuthorityRecord,
  parseLedgerAuthorityMemberReference,
  resolveLoadedLedgerAuthorityMemberReference,
} from "./ledger-authority-reader.js";
import type {
  ConfirmationRecord,
  LedgerAuthorityRecord,
  RequirementRecord,
} from "./ledger-authority-record.js";
import {
  confirmationRootRef,
  requirementRootRef,
} from "./ledger-authority-paths.js";
import {
  isLedgerAbortSignal,
  parseLedgerAuthorityStoreOptions,
  throwLedgerAuthorityStoreError as fail,
  type InitializeLedgerAuthorityStoreOptions,
  type LedgerAuthorityMemberInput,
  type LedgerAuthorityMemberReference,
  type LedgerAuthorityPublicationResult,
  type LedgerAuthorityStoreOptions,
  type LoadedLedgerAuthorityRecord,
  type ResolvedLedgerAuthorityMember,
} from "./ledger-authority-store-contract.js";
import {
  inspectLedgerAuthorityLayout,
  materializeLedgerAuthorityLayout,
} from "./ledger-authority-layout.js";
import {
  recoverLedgerAuthorityRecordPublication,
} from "./ledger-record-publication-recovery.js";
import { publishLedgerAuthorityRecord } from "./ledger-record-publisher.js";

/**
 * Wakeflow Governance / Ledger：`Requirement` 与 `Confirmation` 权威记录的根作用域门面。
 *
 * 本类只持有已经打开的 Ledger `RootedDirectory`，并把具体职责委托给不可变记录
 * 读取器、成员引用编解码器和逐记录暂存发布职责所有者。正常读取不观察事务目录；
 * 一条记录的意图记录、暂存目录或锁文件不会阻断另一条已提交的权威记录。
 *
 * 本类不负责 Demand 事件溯源、`Requirement`/`Confirmation` 的业务生成时机、Ledger
 * 投影或业务归档。长期记录目录树使用 `0755`、`0644` 权限位；短期事务资源使用
 * `0700`、`0600` 权限位。
 */

function parseInitializeOptions(
  value: unknown,
): Readonly<{ readonly signal: AbortSignal | undefined }> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (
    record.freshLedger !== true
    || Object.keys(record).some(
      (key) => key !== "freshLedger" && key !== "signal",
    )
    || (!isLedgerAbortSignal(record.signal) && record.signal !== undefined)
  ) {
    fail("input", "$options");
  }
  return Object.freeze({ signal: record.signal });
}

function referenceRootRef(
  reference: Readonly<LedgerAuthorityMemberReference>,
) {
  return reference.family === "requirement"
    ? requirementRootRef(parseWakeflowDurableIdOfKind(
      reference.recordId,
      "requirement",
      "$reference/recordId",
    ))
    : confirmationRootRef(parseWakeflowDurableIdOfKind(
      reference.recordId,
      "confirmation",
      "$reference/recordId",
    ));
}

export class LedgerAuthorityStore {
  readonly #root: RootedDirectory;

  constructor(root: RootedDirectory) {
    if (
      typeof root !== "object"
      || root === null
      || types.isProxy(root)
      || !(root instanceof RootedDirectory)
    ) {
      fail("input", "$root");
    }
    this.#root = root;
  }

  /** 为新 Ledger 幂等创建具有分层权限策略的基础目录。 */
  async initialize(options: InitializeLedgerAuthorityStoreOptions): Promise<void> {
    const { signal } = parseInitializeOptions(options);
    await materializeLedgerAuthorityLayout(this.#root, signal);
  }

  /** 只读观察 Ledger 固定容器；不会扫描或解释任何权威记录。 */
  async inspectLayout(options?: LedgerAuthorityStoreOptions) {
    const { signal } = parseLedgerAuthorityStoreOptions(options);
    return inspectLedgerAuthorityLayout(this.#root, signal);
  }

  async loadRequirement(
    requirementIdValue: unknown,
    options?: LedgerAuthorityStoreOptions,
  ): Promise<Readonly<LoadedLedgerAuthorityRecord<RequirementRecord>>> {
    const { signal } = parseLedgerAuthorityStoreOptions(options);
    let requirementId;
    try {
      requirementId = parseWakeflowDurableIdOfKind(
        requirementIdValue,
        "requirement",
        "$requirementId",
      );
    } catch (error: unknown) {
      if (error instanceof WakeflowDurableIdError) fail("input", "$requirementId");
      throw error;
    }
    return loadLedgerAuthorityRecord(
      this.#root,
      requirementRootRef(requirementId),
      "requirement",
      requirementId,
      signal,
    ) as Promise<Readonly<LoadedLedgerAuthorityRecord<RequirementRecord>>>;
  }

  async loadConfirmation(
    confirmationIdValue: unknown,
    options?: LedgerAuthorityStoreOptions,
  ): Promise<Readonly<LoadedLedgerAuthorityRecord<ConfirmationRecord>>> {
    const { signal } = parseLedgerAuthorityStoreOptions(options);
    let confirmationId;
    try {
      confirmationId = parseWakeflowDurableIdOfKind(
        confirmationIdValue,
        "confirmation",
        "$confirmationId",
      );
    } catch (error: unknown) {
      if (error instanceof WakeflowDurableIdError) fail("input", "$confirmationId");
      throw error;
    }
    return loadLedgerAuthorityRecord(
      this.#root,
      confirmationRootRef(confirmationId),
      "confirmation",
      confirmationId,
      signal,
    ) as Promise<Readonly<LoadedLedgerAuthorityRecord<ConfirmationRecord>>>;
  }

  /** 整体发布一条不可变记录目录树，或幂等复用完全一致的已有记录。 */
  async publish<RecordType extends LedgerAuthorityRecord>(
    recordValue: RecordType,
    membersValue: readonly LedgerAuthorityMemberInput[],
    options?: LedgerAuthorityStoreOptions,
  ): Promise<Readonly<LedgerAuthorityPublicationResult<RecordType>>> {
    const { signal } = parseLedgerAuthorityStoreOptions(options);
    return publishLedgerAuthorityRecord(
      this.#root,
      recordValue,
      membersValue,
      signal,
    ) as Promise<Readonly<LedgerAuthorityPublicationResult<RecordType>>>;
  }

  /** 按类型化记录标识恢复由精简意图记录描述的发布操作。 */
  async recoverRecordPublication(
    recordIdValue: unknown,
    options?: LedgerAuthorityStoreOptions,
  ): Promise<Readonly<LedgerAuthorityPublicationResult>> {
    const { signal } = parseLedgerAuthorityStoreOptions(options);
    return recoverLedgerAuthorityRecordPublication(
      this.#root,
      recordIdValue,
      signal,
    );
  }

  async resolveMemberReference(
    referenceValue: unknown,
    options?: LedgerAuthorityStoreOptions,
  ): Promise<Readonly<ResolvedLedgerAuthorityMember>> {
    const { signal } = parseLedgerAuthorityStoreOptions(options);
    const reference = parseLedgerAuthorityMemberReference(referenceValue);
    const loaded = await loadLedgerAuthorityRecord(
      this.#root,
      referenceRootRef(reference),
      reference.family,
      reference.recordId,
      signal,
    );
    return resolveLoadedLedgerAuthorityMemberReference(
      this.#root,
      loaded,
      reference,
      signal,
    );
  }

  /** 在一次批量解析中，同一不可变记录最多加载一次。 */
  async resolveMemberReferences(
    referencesValue: readonly unknown[],
    options?: LedgerAuthorityStoreOptions,
  ): Promise<readonly Readonly<ResolvedLedgerAuthorityMember>[]> {
    const { signal } = parseLedgerAuthorityStoreOptions(options);
    let values: readonly unknown[];
    try {
      values = parseDenseArray(referencesValue, 32, "$references");
    } catch (error: unknown) {
      if (error instanceof PassiveOwnDataError) fail("input", "$references");
      throw error;
    }
    if (values.length === 0) fail("input", "$references");
    const references = values.map((value, index) => {
      try {
        return parseLedgerAuthorityMemberReference(value);
      } catch {
        fail("input", `$/references/${index}`);
      }
    });
    const loadedByRecord = new Map<string, Readonly<LoadedLedgerAuthorityRecord>>();
    const resolved: ResolvedLedgerAuthorityMember[] = [];
    for (const reference of references) {
      const key = `${reference.family}\u0000${reference.recordId}`;
      let loaded = loadedByRecord.get(key);
      if (loaded === undefined) {
        loaded = await loadLedgerAuthorityRecord(
          this.#root,
          referenceRootRef(reference),
          reference.family,
          reference.recordId,
          signal,
        );
        loadedByRecord.set(key, loaded);
      }
      resolved.push(await resolveLoadedLedgerAuthorityMemberReference(
        this.#root,
        loaded,
        reference,
        signal,
      ));
    }
    return Object.freeze(resolved);
  }
}

export {
  createLedgerAuthorityMemberReference,
  parseLedgerAuthorityMemberReference,
};
export { LedgerAuthorityStoreError } from "./ledger-authority-store-contract.js";
export type {
  InitializeLedgerAuthorityStoreOptions,
  LedgerAuthorityFileSource,
  LedgerAuthorityMemberInput,
  LedgerAuthorityMemberReference,
  LedgerAuthorityPublicationResult,
  LedgerAuthorityStoreErrorReason,
  LedgerAuthorityStoreOptions,
  LoadedLedgerAuthorityDocument,
  LoadedLedgerAuthorityRecord,
  ResolvedLedgerAuthorityMember,
} from "./ledger-authority-store-contract.js";
export {
  LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES,
  LEDGER_AUTHORITY_RECORD_MAXIMUM_BYTES,
  LEDGER_AUTHORITY_TREE_MAXIMUM_BYTES,
  LEDGER_DURABLE_DIRECTORY_MODE,
  LEDGER_DURABLE_FILE_MODE,
  LEDGER_PUBLICATION_INTENT_MAXIMUM_BYTES,
  LEDGER_RECORD_PUBLICATION_LOCK_TIMEOUT_MILLISECONDS,
  LEDGER_TRANSACTION_DIRECTORY_MODE,
  LEDGER_TRANSACTION_FILE_MODE,
} from "./ledger-authority-storage-policy.js";
