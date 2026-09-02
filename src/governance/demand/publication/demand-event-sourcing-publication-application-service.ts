import { types } from "node:util";

import {
  readWakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
  type WakeflowConfigAuthoritySnapshot,
} from "../../../configuration/wakeflow-config-authority-snapshot.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../../contracts/identity/wakeflow-durable-id.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../../foundation/crypto/sha256.js";
import { canonicalizeJson } from "../../../foundation/data/canonical-json.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../../foundation/data/passive-own-data.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../../foundation/filesystem/rooted-directory.js";
import {
  assertDemandOperationConfigCurrent,
  DemandOperationAuthorityContextError,
} from "../demand-operation-authority-context.js";
import { computeDemandEventStreamCommitDigest } from "../event-sourcing/demand-event-stream-commit.js";
import { LedgerAuthorityStore } from "../../ledger/ledger-authority-store.js";
import {
  computeDemandEventSourcingPublicationTransactionDigest,
  parseDemandEventSourcingPublicationTransaction,
  DemandEventSourcingPublicationTransactionError,
  type DemandEventSourcingPublicationTransaction,
} from "./demand-event-sourcing-publication-transaction.js";
import {
  publishDemandFromTodo,
  recoverDemandPublication,
  DemandEventSourcingPublicationServiceError,
  type DemandEventSourcingPublicationEffectAuthority,
  type DemandEventSourcingPublicationResult,
} from "./demand-event-sourcing-publication-service.js";
import { demandFinalRootRef } from "./demand-publication-paths.js";

/**
 * Wakeflow Governance / Demand Event Sourcing Publication：exact-plan Apply与Recovery门面。
 *
 * 本Service持有已打开的Workspace根，负责公共层以下的plan digest、当前Config/Ledger根、
 * 低层Publication执行调用和结果闭合。Planning Service继续只读生成计划；物理执行Service
 * 继续独占sidecar、stage、Demand根、锁和TODO claim。本层不复制这些状态机或恢复步骤。
 */

export interface DemandEventSourcingPublicationApplicationOptions {
  readonly signal?: AbortSignal;
}

export interface DemandEventSourcingPublicationApplyResult {
  readonly plan: Readonly<DemandEventSourcingPublicationTransaction>;
  readonly planDigest: Sha256Digest;
  readonly publication: Readonly<DemandEventSourcingPublicationResult>;
}

export interface DemandEventSourcingPublicationRecoveryResult {
  readonly publication: Readonly<DemandEventSourcingPublicationResult>;
}

export type DemandEventSourcingPublicationApplicationServiceErrorReason =
  | "input"
  | "plan"
  | "config"
  | "root"
  | "apply"
  | "recover"
  | "output"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Demand Event Sourcing publication application input is invalid.",
  plan: "Demand Event Sourcing publication application plan is invalid.",
  config: "Demand Event Sourcing publication application Config is invalid.",
  root: "Demand Event Sourcing publication application root is invalid.",
  apply: "Demand Event Sourcing publication apply failed.",
  recover: "Demand Event Sourcing publication recovery failed.",
  output: "Demand Event Sourcing publication result violated its boundary.",
  aborted: "Demand Event Sourcing publication application was aborted.",
  "operation-failure": "Demand Event Sourcing publication application failed.",
} as const satisfies Readonly<
  Record<DemandEventSourcingPublicationApplicationServiceErrorReason, string>
>;

/** Application边界失败时保留稳定原因和当前可证明的Publication authority。 */
export class DemandEventSourcingPublicationApplicationServiceError extends Error {
  override readonly name =
    "DemandEventSourcingPublicationApplicationServiceError";
  readonly code =
    "wakeflow-demand-event-sourcing-publication-application-service" as const;
  readonly reason: DemandEventSourcingPublicationApplicationServiceErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly publicationAuthority: DemandEventSourcingPublicationEffectAuthority;

  constructor(
    reason: DemandEventSourcingPublicationApplicationServiceErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    publicationAuthority: DemandEventSourcingPublicationEffectAuthority = "unknown",
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
    this.publicationAuthority = publicationAuthority;
  }
}

interface OpenApplicationAuthority {
  readonly config: Readonly<WakeflowConfigAuthoritySnapshot>;
  readonly ledgerRoot: RootedDirectory;
  readonly ledgerStore: LedgerAuthorityStore;
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
  reason: DemandEventSourcingPublicationApplicationServiceErrorReason,
  cause?: unknown,
  publicationAuthority: DemandEventSourcingPublicationEffectAuthority = "unknown",
): never {
  throw new DemandEventSourcingPublicationApplicationServiceError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    publicationAuthority,
  );
}

function parseOptions(
  value: unknown,
): Readonly<{ readonly signal: AbortSignal | undefined }> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      fail("input", error, "unchanged");
    }
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
    fail("input", undefined, "unchanged");
  }
  return Object.freeze({ signal: record.signal as AbortSignal | undefined });
}

function assertNotAborted(
  signal: AbortSignal | undefined,
  publicationAuthority: DemandEventSourcingPublicationEffectAuthority,
): void {
  if (signal?.aborted === true) {
    fail("aborted", undefined, publicationAuthority);
  }
}

function parseApplyPlan(
  planValue: unknown,
  planDigestValue: unknown,
): Readonly<{
  readonly plan: Readonly<DemandEventSourcingPublicationTransaction>;
  readonly planDigest: Sha256Digest;
}> {
  let plan;
  let planDigest;
  try {
    plan = parseDemandEventSourcingPublicationTransaction(planValue);
    planDigest = parseSha256Digest(planDigestValue, "$planDigest");
  } catch (error: unknown) {
    if (
      error instanceof DemandEventSourcingPublicationTransactionError ||
      error instanceof Sha256Error
    ) {
      fail("plan", error, "unchanged");
    }
    throw error;
  }
  if (
    computeDemandEventSourcingPublicationTransactionDigest(plan) !== planDigest
  ) {
    fail("plan", undefined, "unchanged");
  }
  return Object.freeze({ plan, planDigest });
}

function parseRecoveryDemandId(value: unknown): WakeflowDurableId<"demand"> {
  try {
    return parseWakeflowDurableIdOfKind(value, "demand", "$demandId");
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) {
      fail("input", error, "unchanged");
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
      if (error.reason === "root-scope") fail("root", error);
      fail("config", error);
    }
    throw error;
  }
}

async function openApplicationAuthority(
  workspaceRoot: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<OpenApplicationAuthority>> {
  const config = await readConfig(workspaceRoot, signal);
  let ledgerRoot;
  try {
    ledgerRoot = await RootedDirectory.open(config.ledgerRoot, "$ledgerRoot");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root", error);
    throw error;
  }
  if (ledgerRoot.absolutePath !== config.ledgerRoot) {
    try {
      await ledgerRoot.close();
    } catch {
      // 首个根关系错误优先。
    }
    fail("root");
  }
  return Object.freeze({
    config,
    ledgerRoot,
    ledgerStore: new LedgerAuthorityStore(ledgerRoot),
  });
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
      if (error.reason === "aborted") fail("aborted", error);
      if (error.reason === "root") fail("root", error);
      fail("config", error);
    }
    throw error;
  }
}

async function closeApplicationAuthority(
  authority: Readonly<OpenApplicationAuthority>,
  publicationAuthority: DemandEventSourcingPublicationEffectAuthority,
): Promise<void> {
  try {
    await authority.ledgerRoot.close();
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      fail("root", error, publicationAuthority);
    }
    throw error;
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left, "$left") === canonicalizeJson(right, "$right");
}

function assertPublicationMatchesPlan(
  publication: Readonly<DemandEventSourcingPublicationResult>,
  plan: Readonly<DemandEventSourcingPublicationTransaction>,
): void {
  const todo = publication.todo.item;
  if (
    publication.publicationAuthority !== "current" ||
    publication.demandId !== plan.demandId ||
    publication.rootRef !== plan.finalRootRef ||
    publication.loaded.identityDigest !== plan.identityDigest ||
    publication.loaded.authorityDigest !== plan.authorityDigest ||
    !sameJson(publication.loaded.identity, plan.identity) ||
    !sameJson(publication.loaded.authority, plan.authority) ||
    !sameJson(publication.loaded.firstCommit, plan.initialCommit) ||
    computeDemandEventStreamCommitDigest(publication.loaded.firstCommit) !==
      plan.initialCommitDigest ||
    !sameJson(publication.todo.lineageRef, plan.identity.source) ||
    todo.todoId !== plan.todoId ||
    todo.state.status !== "claimed" ||
    todo.state.previousStateDigest !== plan.expectedTodoStateDigest ||
    todo.state.mount === null ||
    todo.state.mount.demandId !== plan.demandId ||
    todo.state.mount.stateRootRef !== plan.finalRootRef ||
    todo.state.mount.identityDigest !== plan.identityDigest
  ) {
    fail("output", undefined, "current");
  }
}

function assertRecoveredPublication(
  publication: Readonly<DemandEventSourcingPublicationResult>,
  demandId: WakeflowDurableId<"demand">,
): void {
  const todo = publication.todo.item;
  if (
    publication.publicationAuthority !== "current" ||
    publication.demandId !== demandId ||
    publication.rootRef !== demandFinalRootRef(demandId) ||
    publication.loaded.identity.demandId !== demandId ||
    publication.loaded.authority.demandId !== demandId ||
    publication.loaded.firstCommit.demandId !== demandId ||
    publication.loaded.firstCommit.commitSequence !== 1 ||
    todo.state.status !== "claimed" ||
    todo.state.mount === null ||
    todo.state.mount.demandId !== demandId ||
    todo.state.mount.stateRootRef !== publication.rootRef ||
    todo.state.mount.identityDigest !== publication.loaded.identityDigest
  ) {
    fail("output", undefined, "current");
  }
}

function publicationInput(
  plan: Readonly<DemandEventSourcingPublicationTransaction>,
) {
  return Object.freeze({
    identity: plan.identity,
    authority: plan.authority,
    eventId: plan.initialCommand.eventId,
    commitId: plan.initialCommit.commitId,
    recordedAt: plan.initialCommand.recordedAt,
    expectedTodoStateDigest: plan.expectedTodoStateDigest,
    expectedTodoCollectionDigest: plan.expectedTodoCollectionDigest,
  });
}

export class DemandEventSourcingPublicationApplicationService {
  readonly #workspaceRoot: RootedDirectory;

  constructor(workspaceRoot: RootedDirectory) {
    if (
      typeof workspaceRoot !== "object" ||
      workspaceRoot === null ||
      types.isProxy(workspaceRoot) ||
      !(workspaceRoot instanceof RootedDirectory)
    ) {
      fail("input", undefined, "unchanged");
    }
    this.#workspaceRoot = workspaceRoot;
  }

  /** 复验并应用一份完整Preview计划；所有业务副作用仍委托既有执行Service。 */
  async apply(
    planValue: unknown,
    planDigestValue: unknown,
    optionsValue: DemandEventSourcingPublicationApplicationOptions = {},
  ): Promise<Readonly<DemandEventSourcingPublicationApplyResult>> {
    const options = parseOptions(optionsValue);
    assertNotAborted(options.signal, "unchanged");
    const { plan, planDigest } = parseApplyPlan(planValue, planDigestValue);
    let authority: Readonly<OpenApplicationAuthority> | undefined;
    let publicationAuthority: DemandEventSourcingPublicationEffectAuthority =
      "unknown";
    let result: Readonly<DemandEventSourcingPublicationApplyResult> | undefined;
    let failure: unknown;
    try {
      authority = await openApplicationAuthority(
        this.#workspaceRoot,
        options.signal,
      );
      if (
        authority.config.model.program.programId !== plan.identity.programId
      ) {
        fail("config");
      }
      await assertConfigCurrent(
        this.#workspaceRoot,
        authority.config,
        options.signal,
      );
      let publication;
      try {
        publication = await publishDemandFromTodo(
          this.#workspaceRoot,
          authority.ledgerStore,
          publicationInput(plan),
          options.signal === undefined ? undefined : { signal: options.signal },
        );
      } catch (error: unknown) {
        if (error instanceof DemandEventSourcingPublicationServiceError) {
          fail("apply", error, error.publicationAuthority);
        }
        throw error;
      }
      publicationAuthority = "current";
      assertPublicationMatchesPlan(publication, plan);
      result = Object.freeze({ plan, planDigest, publication });
    } catch (error: unknown) {
      if (
        error instanceof DemandEventSourcingPublicationApplicationServiceError
      ) {
        publicationAuthority = error.publicationAuthority;
      }
      failure = error;
    }
    if (authority !== undefined) {
      try {
        await closeApplicationAuthority(authority, publicationAuthority);
      } catch (error: unknown) {
        if (failure === undefined) failure = error;
      }
    }
    if (failure !== undefined) throw failure;
    if (result === undefined)
      fail("operation-failure", undefined, publicationAuthority);
    return result;
  }

  /** 按Demand ID打开当前Ledger并委托既有sidecar前向Recovery。 */
  async recover(
    demandIdValue: unknown,
    optionsValue: DemandEventSourcingPublicationApplicationOptions = {},
  ): Promise<Readonly<DemandEventSourcingPublicationRecoveryResult>> {
    const options = parseOptions(optionsValue);
    assertNotAborted(options.signal, "unchanged");
    const demandId = parseRecoveryDemandId(demandIdValue);
    let authority: Readonly<OpenApplicationAuthority> | undefined;
    let publicationAuthority: DemandEventSourcingPublicationEffectAuthority =
      "unknown";
    let result:
      Readonly<DemandEventSourcingPublicationRecoveryResult> | undefined;
    let failure: unknown;
    try {
      authority = await openApplicationAuthority(
        this.#workspaceRoot,
        options.signal,
      );
      await assertConfigCurrent(
        this.#workspaceRoot,
        authority.config,
        options.signal,
      );
      let publication;
      try {
        publication = await recoverDemandPublication(
          this.#workspaceRoot,
          authority.ledgerStore,
          demandId,
          options.signal === undefined ? undefined : { signal: options.signal },
        );
      } catch (error: unknown) {
        if (error instanceof DemandEventSourcingPublicationServiceError) {
          fail("recover", error, error.publicationAuthority);
        }
        throw error;
      }
      publicationAuthority = "current";
      assertRecoveredPublication(publication, demandId);
      result = Object.freeze({ publication });
    } catch (error: unknown) {
      if (
        error instanceof DemandEventSourcingPublicationApplicationServiceError
      ) {
        publicationAuthority = error.publicationAuthority;
      }
      failure = error;
    }
    if (authority !== undefined) {
      try {
        await closeApplicationAuthority(authority, publicationAuthority);
      } catch (error: unknown) {
        if (failure === undefined) failure = error;
      }
    }
    if (failure !== undefined) throw failure;
    if (result === undefined)
      fail("operation-failure", undefined, publicationAuthority);
    return result;
  }
}
