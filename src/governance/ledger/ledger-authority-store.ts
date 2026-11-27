import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
} from "../../contracts/identity/wakeflow-durable-id.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  inspectLedgerAuthorityLayout,
  materializeLedgerAuthorityLayout,
} from "./ledger-authority-layout.js";
import {
  createLedgerAuthorityMemberReference,
  loadLedgerAuthorityRecord,
  parseLedgerAuthorityMemberReference,
  resolveLoadedLedgerAuthorityMemberReference,
} from "./ledger-authority-reader.js";
import type { RequirementRecord } from "./ledger-authority-record.js";
import {
  throwLedgerAuthorityStoreError as fail,
  type InitializeLedgerAuthorityStoreOptions,
  type LedgerAuthorityMemberInput,
  type LedgerAuthorityMemberReference,
  type LedgerAuthorityPublicationResult,
  type LedgerAuthorityStoreOptions,
  type LoadedLedgerAuthorityRecord,
  type ResolvedLedgerAuthorityMember,
} from "./ledger-authority-store-contract.js";
import { publishLedgerAuthorityRecord } from "./ledger-record-publisher.js";

const LEDGER_MEMBER_READ_CONCURRENCY = 8;

/**
 * Wakeflow Governance / Ledger：需求包权威记录的根作用域门面。
 *
 * 本类只持有已经打开的 Ledger `RootedDirectory`，并把具体职责委托给不可变记录
 * 读取器、成员引用编解码器和逐记录暂存发布职责所有者。正常读取不观察事务目录；
 * 一条记录的意图记录、暂存目录或锁文件不会阻断另一条已提交的权威记录。
 *
 * 本类不负责需求包的章节校验、看板认领状态、Demand 事件溯源、Ledger 投影或业务
 * 归档。长期记录目录树使用 `0755`、`0644` 权限位；短期事务资源使用 `0700`、
 * `0600` 权限位。
 */

export class LedgerAuthorityStore {
  readonly #root: RootedDirectory;

  constructor(root: RootedDirectory) {
    this.#root = root;
  }

  /** 为新 Ledger 幂等创建具有分层权限策略的基础目录。 */
  async initialize(options: InitializeLedgerAuthorityStoreOptions): Promise<void> {
    await materializeLedgerAuthorityLayout(this.#root, options.signal);
  }

  /** 只读观察 Ledger 固定容器；不会扫描或解释任何权威记录。 */
  async inspectLayout(options?: LedgerAuthorityStoreOptions) {
    return inspectLedgerAuthorityLayout(this.#root, options?.signal);
  }

  async loadRequirement(
    requirementIdValue: unknown,
    options?: LedgerAuthorityStoreOptions,
  ): Promise<Readonly<LoadedLedgerAuthorityRecord<RequirementRecord>>> {
    const signal = options?.signal;
    let requirementId: ReturnType<typeof parseWakeflowDurableIdOfKind>;
    try {
      requirementId = parseWakeflowDurableIdOfKind(
        requirementIdValue,
        "requirement",
        "$requirementId",
      );
    } catch (error: unknown) {
      if (error instanceof WakeflowDurableIdError) fail("input", "$requirementId", error);
      throw error;
    }
    return loadLedgerAuthorityRecord(this.#root, requirementId, signal);
  }

  /** 整体发布一条不可变记录目录树，或幂等复用完全一致的已有记录。 */
  async publish(
    recordValue: Readonly<RequirementRecord> | unknown,
    membersValue: readonly LedgerAuthorityMemberInput[],
    options?: LedgerAuthorityStoreOptions,
  ): Promise<Readonly<LedgerAuthorityPublicationResult<RequirementRecord>>> {
    return publishLedgerAuthorityRecord(this.#root, recordValue, membersValue, options?.signal);
  }

  async resolveMemberReference(
    reference: Readonly<LedgerAuthorityMemberReference>,
    options?: LedgerAuthorityStoreOptions,
  ): Promise<Readonly<ResolvedLedgerAuthorityMember>> {
    const signal = options?.signal;
    const loaded = await loadLedgerAuthorityRecord(this.#root, reference.recordId, signal);
    return resolveLoadedLedgerAuthorityMemberReference(this.#root, loaded, reference, signal);
  }

  /** 在一次批量解析中，同一不可变记录最多加载一次。 */
  async resolveMemberReferences(
    references: readonly Readonly<LedgerAuthorityMemberReference>[],
    options?: LedgerAuthorityStoreOptions,
  ): Promise<readonly Readonly<ResolvedLedgerAuthorityMember>[]> {
    const signal = options?.signal;
    const loadedByRecord = new Map<string, Readonly<LoadedLedgerAuthorityRecord>>();
    const prepared: Array<
      Readonly<{
        reference: Readonly<LedgerAuthorityMemberReference>;
        loaded: Readonly<LoadedLedgerAuthorityRecord>;
      }>
    > = [];
    for (const reference of references) {
      const key = reference.recordId;
      let loaded = loadedByRecord.get(key);
      if (loaded === undefined) {
        loaded = await loadLedgerAuthorityRecord(this.#root, reference.recordId, signal);
        loadedByRecord.set(key, loaded);
      }
      prepared.push(Object.freeze({ reference, loaded }));
    }
    const resolved: ResolvedLedgerAuthorityMember[] = [];
    for (let index = 0; index < prepared.length; index += LEDGER_MEMBER_READ_CONCURRENCY) {
      const settled = await Promise.allSettled(
        prepared
          .slice(index, index + LEDGER_MEMBER_READ_CONCURRENCY)
          .map(({ loaded, reference }) =>
            resolveLoadedLedgerAuthorityMemberReference(this.#root, loaded, reference, signal),
          ),
      );
      for (const result of settled) {
        if (result.status === "rejected") throw result.reason;
        resolved.push(result.value);
      }
    }
    return Object.freeze(resolved);
  }
}

export type {
  InitializeLedgerAuthorityStoreOptions,
  LedgerAuthorityMemberInput,
  LedgerAuthorityMemberReference,
  LedgerAuthorityPublicationResult,
  LedgerAuthorityStoreErrorReason,
  LedgerAuthorityStoreOptions,
  LoadedLedgerAuthorityRecord,
  ResolvedLedgerAuthorityMember,
} from "./ledger-authority-store-contract.js";
export { LedgerAuthorityStoreError } from "./ledger-authority-store-contract.js";
export { createLedgerAuthorityMemberReference, parseLedgerAuthorityMemberReference };
