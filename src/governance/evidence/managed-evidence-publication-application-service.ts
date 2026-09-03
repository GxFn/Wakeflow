import { types } from "node:util";

import {
  readWakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
  type WakeflowConfigAuthoritySnapshot,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import type { DirectoryTreeCandidateRetirementReceipt } from "../../foundation/filesystem/durable-directory-tree-candidate-retirement.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  assertDemandOperationConfigCurrent,
  closeDemandOperationAuthorityContext,
  openDemandOperationAuthorityContext,
  openDemandOperationRoot,
  DemandOperationAuthorityContextError,
  type DemandOperationAuthorityContext,
} from "../demand/demand-operation-authority-context.js";
import { type DemandEventSourcingAggregate } from "../demand/event-sourcing/demand-event-sourcing-aggregate.js";
import type { LoadedDemandEventSourcingRootAuthority } from "../demand/event-sourcing/demand-event-sourcing-root-authority.js";
import type { DemandEventStreamCommit } from "../demand/event-sourcing/demand-event-stream-commit.js";
import {
  openConfiguredManagedEvidenceSourceRoot,
  ManagedEvidenceConfiguredSourceRootError,
} from "./managed-evidence-configured-source-root.js";
import type { ManagedEvidencePublicationRecordResult } from "./managed-evidence-publication-record-publisher.js";
import {
  materializeManagedEvidencePublicationStage,
  ManagedEvidencePublicationStageMaterializationError,
} from "./managed-evidence-publication-stage-materializer.js";
import {
  createManagedEvidencePublicationTransactionJournal,
  loadManagedEvidencePublicationTransaction,
  ManagedEvidencePublicationTransactionStoreError,
  type StoredManagedEvidencePublicationTransaction,
} from "./managed-evidence-publication-transaction-store.js";
import {
  appendManagedEvidencePublicationEvent,
  completeManagedEvidencePublicationTransaction,
  findManagedEvidencePublicationCommit,
  loadCurrentManagedEvidencePublicationTransaction,
  loadManagedEvidencePublicationHealthyAuthority,
  loadManagedEvidencePublicationTransactionAuthority,
  retireStaleManagedEvidencePublicationTransaction,
  ManagedEvidencePublicationTransactionSettlementError,
} from "./managed-evidence-publication-transaction-settlement.js";
import {
  computeManagedEvidencePublicationTransactionDigest,
  parseManagedEvidencePublicationTransaction,
  ManagedEvidencePublicationTransactionError,
  type ManagedEvidencePublicationTransaction,
} from "./managed-evidence-publication-transaction.js";

/**
 * Wakeflow Governance / Evidence：Managed Evidence跨资源发布的Application/Recovery。
 *
 * 固定顺序为“journal → complete stage → Event append → final publish → 事务期闭包
 * → journal retire → healthy闭包”。Transaction不保存可变phase；恢复只观察exact
 * journal、record tree和Commit事实。Event提交前可以退休安全candidate，Event提交后
 * 只能前向完成，绝不重新读取source或回滚Event。
 *
 * 本Service仍位于公共协议之下：它不分配ID、不解释MCP输入，也不调用任何宿主能力。
 */

export interface ManagedEvidencePublicationApplicationOptions {
  readonly signal?: AbortSignal;
}

export interface ManagedEvidencePublicationCompletionResult {
  readonly disposition: "completed";
  readonly transaction: Readonly<ManagedEvidencePublicationTransaction>;
  readonly transactionDigest: Sha256Digest;
  readonly eventDisposition: "committed" | "idempotent" | "existing";
  readonly commit: Readonly<DemandEventStreamCommit>;
  readonly record: Readonly<ManagedEvidencePublicationRecordResult>;
  readonly loaded: Readonly<LoadedDemandEventSourcingRootAuthority>;
}

export interface ManagedEvidencePublicationRetirementResult {
  readonly disposition: "retired-stale";
  readonly transaction: Readonly<ManagedEvidencePublicationTransaction>;
  readonly transactionDigest: Sha256Digest;
  readonly candidateRetirement: Readonly<DirectoryTreeCandidateRetirementReceipt>;
  readonly loaded: Readonly<LoadedDemandEventSourcingRootAuthority>;
}

export interface ManagedEvidencePublicationHealthyResult {
  readonly disposition: "healthy";
  readonly loaded: Readonly<LoadedDemandEventSourcingRootAuthority>;
}

export type ManagedEvidencePublicationRecoveryResult =
  | Readonly<ManagedEvidencePublicationCompletionResult>
  | Readonly<ManagedEvidencePublicationRetirementResult>
  | Readonly<ManagedEvidencePublicationHealthyResult>;

export type ManagedEvidencePublicationEffectAuthority =
  | "unchanged"
  | "recoverable"
  | "current"
  | "unknown";

export type ManagedEvidencePublicationApplicationServiceErrorReason =
  | "input"
  | "transaction"
  | "config"
  | "demand"
  | "source-root"
  | "journal"
  | "stage"
  | "event-sourcing"
  | "final"
  | "closure"
  | "aborted"
  | "recovery-required"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Managed evidence publication application input is invalid.",
  transaction: "Managed evidence publication transaction is invalid.",
  config: "Managed evidence publication Config no longer matches its plan.",
  demand: "Managed evidence publication Demand no longer matches its plan.",
  "source-root": "Managed evidence publication source root is invalid.",
  journal: "Managed evidence publication journal is unavailable or conflicting.",
  stage: "Managed evidence publication stage could not be completed safely.",
  "event-sourcing": "Managed evidence publication Event append is invalid or conflicting.",
  final: "Managed evidence publication final record could not be completed safely.",
  closure: "Managed evidence publication could not prove its Demand root closure.",
  aborted: "Managed evidence publication application was aborted.",
  "recovery-required": "Managed evidence publication requires explicit recovery.",
  "operation-failure": "Managed evidence publication application failed.",
} as const satisfies Readonly<
  Record<ManagedEvidencePublicationApplicationServiceErrorReason, string>
>;

/** Application无法证明无副作用、可恢复或已完成状态时的稳定、脱敏错误。 */
export class ManagedEvidencePublicationApplicationServiceError extends Error {
  override readonly name = "ManagedEvidencePublicationApplicationServiceError";
  readonly code = "wakeflow-managed-evidence-publication-application-service" as const;
  readonly reason: ManagedEvidencePublicationApplicationServiceErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly publicationAuthority: ManagedEvidencePublicationEffectAuthority;

  constructor(
    reason: ManagedEvidencePublicationApplicationServiceErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    publicationAuthority: ManagedEvidencePublicationEffectAuthority = "unknown",
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
    this.publicationAuthority = publicationAuthority;
  }
}

interface ParsedOptions {
  readonly signal: AbortSignal | undefined;
}

interface RecoveryRoots {
  readonly config: Readonly<WakeflowConfigAuthoritySnapshot>;
  readonly demandRoot: RootedDirectory;
  readonly ledgerRoot: RootedDirectory;
}

function ownString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined &&
    Object.hasOwn(descriptor, "value") &&
    typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function fail(
  reason: ManagedEvidencePublicationApplicationServiceErrorReason,
  cause?: unknown,
): never {
  throw new ManagedEvidencePublicationApplicationServiceError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
  );
}

function parseOptions(value: unknown): Readonly<ParsedOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error);
    throw error;
  }
  if (
    Object.keys(record).some((key) => key !== "signal") ||
    (record.signal !== undefined &&
      (typeof record.signal !== "object" ||
        record.signal === null ||
        types.isProxy(record.signal) ||
        !(record.signal instanceof AbortSignal)))
  ) {
    fail("input");
  }
  return Object.freeze({ signal: record.signal as AbortSignal | undefined });
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted");
}

function parseApplyInput(
  transactionValue: unknown,
  transactionDigestValue: unknown,
): Readonly<{
  readonly transaction: Readonly<ManagedEvidencePublicationTransaction>;
  readonly transactionDigest: Sha256Digest;
}> {
  let transaction;
  let transactionDigest;
  try {
    transaction = parseManagedEvidencePublicationTransaction(transactionValue);
    transactionDigest = parseSha256Digest(
      transactionDigestValue,
      "$transactionDigest",
    );
  } catch (error: unknown) {
    if (
      error instanceof ManagedEvidencePublicationTransactionError ||
      error instanceof Sha256Error
    ) {
      fail("transaction", error);
    }
    throw error;
  }
  if (
    computeManagedEvidencePublicationTransactionDigest(transaction) !==
    transactionDigest
  ) {
    fail("transaction");
  }
  return Object.freeze({ transaction, transactionDigest });
}

function parseDemandId(value: unknown): WakeflowDurableId<"demand"> {
  try {
    return parseWakeflowDurableIdOfKind(value, "demand", "$demandId");
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("input", error);
    throw error;
  }
}

function sameExpectedAggregate(
  aggregate: Readonly<DemandEventSourcingAggregate>,
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
): boolean {
  const expected = transaction.demandEventSourcingAppend;
  return (
    aggregate.streamRevision === expected.expectedStreamRevision &&
    aggregate.stateDigest === expected.expectedStateDigest &&
    aggregate.lastEvent.eventId === expected.expectedLastEventId &&
    aggregate.lastEventDigest === expected.expectedLastEventDigest
  );
}

function sameConfigRelation(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
): boolean {
  const manifest = transaction.manifest;
  return (
    config.configDigest === manifest.recordedBy.configDigest &&
    config.model.program.programId === manifest.programId &&
    config.indexes.controllerWindow.windowId === manifest.recordedBy.windowId
  );
}

function assertConfigRelation(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
): void {
  if (!sameConfigRelation(config, transaction)) fail("config");
}

function assertHealthyBaseline(
  context: Readonly<DemandOperationAuthorityContext>,
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
): void {
  const manifest = transaction.manifest;
  assertConfigRelation(context.config, transaction);
  if (
    context.loaded.identity.programId !== manifest.programId ||
    context.loaded.identity.demandId !== manifest.demandId ||
    context.loaded.authorityDigest !== manifest.demandAuthorityDigest ||
    context.loaded.aggregate.state.lifecycle !== "active" ||
    !sameExpectedAggregate(context.loaded.aggregate, transaction)
  ) {
    fail("demand");
  }
}

function mapContextError(error: DemandOperationAuthorityContextError): never {
  if (error.reason === "aborted") fail("aborted", error);
  if (error.reason === "config" || error.reason === "stale-config") {
    fail("config", error);
  }
  if (error.reason === "root") fail("demand", error);
  fail("demand", error);
}

function mapStoreError(
  error: ManagedEvidencePublicationTransactionStoreError,
): never {
  if (error.reason === "aborted") fail("aborted", error);
  if (error.reason === "transaction-exists") fail("recovery-required", error);
  if (error.reason === "recovery-required") {
    fail("recovery-required", error);
  }
  fail("journal", error);
}

function settlementFailure(
  error: ManagedEvidencePublicationTransactionSettlementError,
): ManagedEvidencePublicationApplicationServiceError {
  return new ManagedEvidencePublicationApplicationServiceError(
    error.reason,
    error.code,
    error.reason,
  );
}

function contextualizeFailure(
  error: unknown,
  publicationAuthority: ManagedEvidencePublicationEffectAuthority,
): unknown {
  const mapped =
    error instanceof ManagedEvidencePublicationTransactionSettlementError
      ? settlementFailure(error)
      : error;
  if (mapped instanceof ManagedEvidencePublicationApplicationServiceError) {
    return new ManagedEvidencePublicationApplicationServiceError(
      mapped.reason,
      mapped.causeCode,
      mapped.causeReason,
      publicationAuthority,
    );
  }
  return mapped;
}

async function assertConfigCurrent(
  workspaceRoot: RootedDirectory,
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await assertDemandOperationConfigCurrent(workspaceRoot, config, signal);
  } catch (error: unknown) {
    if (error instanceof DemandOperationAuthorityContextError) {
      mapContextError(error);
    }
    throw error;
  }
}

async function openSourceRoot(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
): Promise<RootedDirectory> {
  try {
    return await openConfiguredManagedEvidenceSourceRoot(
      config,
      transaction.manifest.source,
    );
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceConfiguredSourceRootError) {
      fail("source-root", error);
    }
    throw error;
  }
}

async function closeSourceRoot(root: RootedDirectory): Promise<void> {
  try {
    await root.close();
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("source-root", error);
    throw error;
  }
}

async function materializeStage(
  sourceRoot: RootedDirectory,
  demandRoot: RootedDirectory,
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await materializeManagedEvidencePublicationStage(
      sourceRoot,
      demandRoot,
      transaction,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof ManagedEvidencePublicationStageMaterializationError) {
      if (error.reason === "aborted") fail("aborted", error);
      if (error.reason === "recovery-required") {
        fail("recovery-required", error);
      }
      fail("stage", error);
    }
    throw error;
  }
}

async function readConfig(
  workspaceRoot: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<WakeflowConfigAuthoritySnapshot>> {
  try {
    return await readWakeflowConfigAuthoritySnapshot(
      workspaceRoot,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthoritySnapshotError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("config", error);
    }
    throw error;
  }
}

async function openRecoveryRoots(
  workspaceRoot: RootedDirectory,
  demandId: WakeflowDurableId<"demand">,
  signal: AbortSignal | undefined,
): Promise<Readonly<RecoveryRoots>> {
  const config = await readConfig(workspaceRoot, signal);
  let ledgerRoot: RootedDirectory | undefined;
  let demandRoot: RootedDirectory | undefined;
  try {
    ledgerRoot = await RootedDirectory.open(config.ledgerRoot, "$ledgerRoot");
    if (ledgerRoot.absolutePath !== config.ledgerRoot) fail("config");
    demandRoot = await openDemandOperationRoot(workspaceRoot, demandId);
    return Object.freeze({ config, demandRoot, ledgerRoot });
  } catch (error: unknown) {
    if (demandRoot !== undefined) {
      try {
        await demandRoot.close();
      } catch {
        // 首个根关系错误优先。
      }
    }
    if (ledgerRoot !== undefined) {
      try {
        await ledgerRoot.close();
      } catch {
        // 首个根关系错误优先。
      }
    }
    if (error instanceof ManagedEvidencePublicationApplicationServiceError) {
      throw error;
    }
    if (error instanceof DemandOperationAuthorityContextError) {
      mapContextError(error);
    }
    if (error instanceof RootedDirectoryError) fail("demand", error);
    throw error;
  }
}

async function closeRecoveryRoots(
  roots: Readonly<RecoveryRoots>,
): Promise<void> {
  let failure: unknown;
  try {
    await roots.demandRoot.close();
  } catch (error: unknown) {
    failure = error;
  }
  try {
    await roots.ledgerRoot.close();
  } catch (error: unknown) {
    if (failure === undefined) failure = error;
  }
  if (failure !== undefined) fail("demand", failure);
}

export class ManagedEvidencePublicationApplicationService {
  readonly #workspaceRoot: RootedDirectory;

  constructor(workspaceRoot: RootedDirectory) {
    if (
      typeof workspaceRoot !== "object" ||
      workspaceRoot === null ||
      types.isProxy(workspaceRoot) ||
      !(workspaceRoot instanceof RootedDirectory)
    ) {
      fail("input");
    }
    this.#workspaceRoot = workspaceRoot;
  }

  /** 应用一份exact Transaction；现存journal始终转交显式recover。 */
  async apply(
    transactionValue: unknown,
    transactionDigestValue: unknown,
    optionsValue: ManagedEvidencePublicationApplicationOptions = {},
  ): Promise<Readonly<ManagedEvidencePublicationCompletionResult>> {
    const options = parseOptions(optionsValue);
    assertNotAborted(options.signal);
    const { transaction, transactionDigest } = parseApplyInput(
      transactionValue,
      transactionDigestValue,
    );
    let context: Readonly<DemandOperationAuthorityContext> | undefined;
    let sourceRoot: RootedDirectory | undefined;
    let result: Readonly<ManagedEvidencePublicationCompletionResult> | undefined;
    let publicationAuthority: ManagedEvidencePublicationEffectAuthority =
      "unchanged";
    let failure: unknown;
    try {
      try {
        context = await openDemandOperationAuthorityContext(
          this.#workspaceRoot,
          transaction.manifest.demandId,
          options.signal,
        );
      } catch (error: unknown) {
        if (error instanceof DemandOperationAuthorityContextError) {
          mapContextError(error);
        }
        throw error;
      }
      try {
        assertHealthyBaseline(context, transaction);
      } catch (error: unknown) {
        if (
          error instanceof ManagedEvidencePublicationApplicationServiceError &&
          (error.reason === "config" || error.reason === "demand")
        ) {
          const completion =
            await loadCurrentManagedEvidencePublicationTransaction(
              context.demandRoot,
              context.ledgerRoot,
              transaction,
              transactionDigest,
              options.signal,
            );
          result = Object.freeze({
            disposition: "completed" as const,
            transaction,
            transactionDigest,
            ...completion,
          });
          publicationAuthority = "current";
        } else {
          throw error;
        }
      }
      if (result === undefined) {
        await assertConfigCurrent(
          this.#workspaceRoot,
          context.config,
          options.signal,
        );
        sourceRoot = await openSourceRoot(context.config, transaction);
        let stored: Readonly<StoredManagedEvidencePublicationTransaction>;
        try {
          stored = await createManagedEvidencePublicationTransactionJournal(
            context.demandRoot,
            transaction,
            options.signal === undefined
              ? undefined
              : { signal: options.signal },
          );
        } catch (error: unknown) {
          if (error instanceof ManagedEvidencePublicationTransactionStoreError) {
            mapStoreError(error);
          }
          throw error;
        }
        publicationAuthority = "recoverable";
        if (stored.transactionDigest !== transactionDigest) fail("transaction");
        await materializeStage(
          sourceRoot,
          context.demandRoot,
          transaction,
          options.signal,
        );
        await closeSourceRoot(sourceRoot);
        sourceRoot = undefined;
        const event = await appendManagedEvidencePublicationEvent(
          context.demandRoot,
          transaction,
          options.signal,
        );
        const completion =
          await completeManagedEvidencePublicationTransaction(
            context.demandRoot,
            context.ledgerRoot,
            stored,
            event.disposition,
            options.signal,
          );
        result = Object.freeze({
          disposition: "completed" as const,
          transaction: stored.transaction,
          transactionDigest: stored.transactionDigest,
          ...completion,
        });
        publicationAuthority = "current";
      }
    } catch (error: unknown) {
      failure = contextualizeFailure(error, publicationAuthority);
    }
    if (sourceRoot !== undefined) {
      try {
        await closeSourceRoot(sourceRoot);
      } catch (error: unknown) {
        if (failure === undefined) {
          failure = contextualizeFailure(error, publicationAuthority);
        }
      }
    }
    if (context !== undefined) {
      try {
        await closeDemandOperationAuthorityContext(context);
      } catch (error: unknown) {
        if (failure === undefined) {
          failure = error instanceof DemandOperationAuthorityContextError
            ? new ManagedEvidencePublicationApplicationServiceError(
                error.reason === "aborted" ? "aborted" : "demand",
                error.code,
                error.reason,
                publicationAuthority,
              )
            : error;
        }
      }
    }
    if (failure !== undefined) throw failure;
    if (result === undefined) fail("operation-failure");
    return result;
  }

  /**
   * 恢复固定journal：目标Commit存在时前向完成；Commit缺失且CAS已过期时安全退休。
   */
  async recover(
    demandIdValue: unknown,
    optionsValue: ManagedEvidencePublicationApplicationOptions = {},
  ): Promise<Readonly<ManagedEvidencePublicationRecoveryResult>> {
    const options = parseOptions(optionsValue);
    assertNotAborted(options.signal);
    const demandId = parseDemandId(demandIdValue);
    let roots: Readonly<RecoveryRoots> | undefined;
    let sourceRoot: RootedDirectory | undefined;
    let result: Readonly<ManagedEvidencePublicationRecoveryResult> | undefined;
    let publicationAuthority: ManagedEvidencePublicationEffectAuthority =
      "unknown";
    let failure: unknown;
    try {
      roots = await openRecoveryRoots(
        this.#workspaceRoot,
        demandId,
        options.signal,
      );
      let stored: Readonly<StoredManagedEvidencePublicationTransaction> | null;
      try {
        stored = await loadManagedEvidencePublicationTransaction(
          roots.demandRoot,
          options.signal === undefined ? undefined : { signal: options.signal },
        );
      } catch (error: unknown) {
        if (error instanceof ManagedEvidencePublicationTransactionStoreError) {
          mapStoreError(error);
        }
        throw error;
      }
      if (stored === null) {
        await assertConfigCurrent(
          this.#workspaceRoot,
          roots.config,
          options.signal,
        );
        const loaded =
          await loadManagedEvidencePublicationHealthyAuthority(
            roots.demandRoot,
            roots.ledgerRoot,
            options.signal,
          );
        result = Object.freeze({
          disposition: "healthy" as const,
          loaded,
        });
        publicationAuthority = "current";
      } else {
        publicationAuthority = "recoverable";
        if (stored.transaction.manifest.demandId !== demandId) fail("journal");
        const authority =
          await loadManagedEvidencePublicationTransactionAuthority(
          roots.demandRoot,
          roots.ledgerRoot,
          options.signal,
        );
        if (
          authority.inventory.managedEvidence.publication
            ?.transactionDigest !== stored.transactionDigest
        ) {
          fail("closure");
        }
        await assertConfigCurrent(
          this.#workspaceRoot,
          roots.config,
          options.signal,
        );
        const existing = await findManagedEvidencePublicationCommit(
          roots.demandRoot,
          stored.transaction,
          options.signal,
        );
        const targetSelector = authority.aggregate.state.managedEvidence?.find(
          (selector) =>
            selector.evidenceId === stored.transaction.manifest.evidenceId,
        );
        const physicalState =
          authority.inventory.managedEvidence.publication?.physicalState;
        if (existing === null && targetSelector !== undefined) {
          // Event selector存在却找不到Transaction绑定的Commit，不能把stage当作可回滚事实。
          fail("recovery-required");
        }
        if (existing !== null) {
          const completion =
            await completeManagedEvidencePublicationTransaction(
            roots.demandRoot,
            roots.ledgerRoot,
            stored,
            "existing",
            options.signal,
          );
          result = Object.freeze({
            disposition: "completed" as const,
            transaction: stored.transaction,
            transactionDigest: stored.transactionDigest,
            ...completion,
          });
          publicationAuthority = "current";
        } else if (
          !sameExpectedAggregate(authority.aggregate, stored.transaction) ||
          (physicalState !== "stage-complete" &&
            !sameConfigRelation(roots.config, stored.transaction))
        ) {
          const retirement =
            await retireStaleManagedEvidencePublicationTransaction(
              roots.demandRoot,
              roots.ledgerRoot,
              stored,
              options.signal,
            );
          result = Object.freeze({
            disposition: "retired-stale" as const,
            transaction: stored.transaction,
            transactionDigest: stored.transactionDigest,
            ...retirement,
          });
          publicationAuthority = "unchanged";
        } else {
          if (physicalState !== "stage-complete") {
            sourceRoot = await openSourceRoot(
              roots.config,
              stored.transaction,
            );
            await materializeStage(
              sourceRoot,
              roots.demandRoot,
              stored.transaction,
              options.signal,
            );
            await closeSourceRoot(sourceRoot);
            sourceRoot = undefined;
          }
          const event = await appendManagedEvidencePublicationEvent(
            roots.demandRoot,
            stored.transaction,
            options.signal,
          );
          const completion =
            await completeManagedEvidencePublicationTransaction(
              roots.demandRoot,
              roots.ledgerRoot,
              stored,
              event.disposition,
              options.signal,
            );
          result = Object.freeze({
            disposition: "completed" as const,
            transaction: stored.transaction,
            transactionDigest: stored.transactionDigest,
            ...completion,
          });
          publicationAuthority = "current";
        }
      }
    } catch (error: unknown) {
      failure = contextualizeFailure(error, publicationAuthority);
    }
    if (sourceRoot !== undefined) {
      try {
        await closeSourceRoot(sourceRoot);
      } catch (error: unknown) {
        if (failure === undefined) {
          failure = contextualizeFailure(error, publicationAuthority);
        }
      }
    }
    if (roots !== undefined) {
      try {
        await closeRecoveryRoots(roots);
      } catch (error: unknown) {
        if (failure === undefined) {
          failure = contextualizeFailure(error, publicationAuthority);
        }
      }
    }
    if (failure !== undefined) throw failure;
    if (result === undefined) fail("operation-failure");
    return result;
  }
}
