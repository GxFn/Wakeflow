import { types } from "node:util";

import {
  readWakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
  type WakeflowConfigAuthoritySnapshot,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  demandFinalRootRef,
  demandPublicationLockRef,
  demandPublicationStageRef,
  demandPublicationTransactionRef,
} from "../demand/publication/demand-publication-paths.js";
import {
  materializeLedgerAuthorityPublicationPayload,
  LedgerAuthorityPublicationPayloadMaterializationError,
} from "./ledger-authority-publication-payload-materializer.js";
import {
  computeLedgerAuthorityPublicationPlanDigest,
  parseLedgerAuthorityPublicationPlan,
  LedgerAuthorityPublicationPlanError,
  type LedgerAuthorityPublicationPlan,
} from "./ledger-authority-publication-plan.js";
import {
  computeLedgerAuthorityRecordDigest,
  renderLedgerAuthorityRecord,
} from "./ledger-authority-record.js";
import {
  createLedgerAuthorityMemberReference,
  LedgerAuthorityStore,
  LedgerAuthorityStoreError,
  type LedgerAuthorityMemberReference,
  type LedgerAuthorityPublicationResult,
  type LoadedLedgerAuthorityRecord,
} from "./ledger-authority-store.js";

/**
 * Wakeflow Governance / Ledger：exact Plan的Application与前向Recovery owner。
 *
 * Apply先由Payload Materializer取得Plan绑定的成员字节，再复验当前Config与Ledger根，
 * 最终只调用既有Store publish/exact recovery。Recover不读取Design source：完整stage或
 * post-rename final可前向完成，partial stage明确返回input-required。Service不创建第二
 * journal、phase、锁或恢复状态机，也不解释Public/MCP请求。
 */

export interface LedgerAuthorityPublicationApplicationOptions {
  readonly signal?: AbortSignal;
}

export type LedgerAuthorityPublicationEffectAuthority =
  | "unchanged"
  | "recoverable"
  | "current"
  | "unknown";

export type LedgerAuthorityPublicationApplicationDisposition =
  | "published"
  | "recovered"
  | "current";

export interface LedgerAuthorityPublicationApplicationResult {
  readonly operation: "apply" | "recover";
  readonly disposition: LedgerAuthorityPublicationApplicationDisposition;
  readonly planDigest: Sha256Digest;
  readonly wroteAuthority: boolean;
  readonly loaded: Readonly<LoadedLedgerAuthorityRecord>;
  readonly memberReferences: readonly [
    Readonly<LedgerAuthorityMemberReference>,
    ...Readonly<LedgerAuthorityMemberReference>[],
  ];
}

export type LedgerAuthorityPublicationApplicationServiceErrorReason =
  | "input"
  | "plan"
  | "config"
  | "source-root"
  | "source"
  | "source-profile"
  | "source-changed"
  | "capacity"
  | "ledger"
  | "conflict"
  | "not-found"
  | "input-required"
  | "aborted"
  | "recovery-required"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Ledger authority publication application input is invalid.",
  plan: "Ledger authority publication application plan or digest is invalid.",
  config: "Ledger authority publication Config no longer matches its plan.",
  "source-root": "Ledger authority publication Design source root is invalid.",
  source: "Ledger authority publication source is unavailable or unsafe.",
  "source-profile": "Ledger authority publication source is not strict Markdown text.",
  "source-changed": "Ledger authority publication source differs from its plan.",
  capacity: "Ledger authority publication exceeds its bounded capacity.",
  ledger: "Ledger authority publication Ledger root is unavailable or unsafe.",
  conflict: "Ledger authority publication conflicts with existing authority.",
  "not-found": "Ledger authority publication has no exact recoverable operation.",
  "input-required": "Ledger authority publication recovery requires exact source bytes.",
  aborted: "Ledger authority publication application was aborted.",
  "recovery-required": "Ledger authority publication requires explicit recovery.",
  "operation-failure": "Ledger authority publication application failed.",
} as const satisfies Readonly<Record<
  LedgerAuthorityPublicationApplicationServiceErrorReason,
  string
>>;

/** Application无法证明未变、可恢复或已完成状态时的稳定、脱敏错误。 */
export class LedgerAuthorityPublicationApplicationServiceError extends Error {
  override readonly name =
    "LedgerAuthorityPublicationApplicationServiceError";
  readonly code =
    "wakeflow-ledger-authority-publication-application-service" as const;
  readonly reason: LedgerAuthorityPublicationApplicationServiceErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly publicationAuthority: LedgerAuthorityPublicationEffectAuthority;

  constructor(
    reason: LedgerAuthorityPublicationApplicationServiceErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    publicationAuthority: LedgerAuthorityPublicationEffectAuthority =
      "unknown",
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

interface ExactPlanInput {
  readonly plan: Readonly<LedgerAuthorityPublicationPlan>;
  readonly planDigest: Sha256Digest;
}

interface ApplicationContext {
  readonly config: Readonly<WakeflowConfigAuthoritySnapshot>;
  readonly ledgerRoot: RootedDirectory;
  readonly store: LedgerAuthorityStore;
}

type ExactRecoveryObservation =
  | Readonly<{
      readonly status: "completed";
      readonly result: Readonly<LedgerAuthorityPublicationResult>;
    }>
  | Readonly<{ readonly status: "absent" }>
  | Readonly<{ readonly status: "input-required" }>;

function ownString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined
    && Object.hasOwn(descriptor, "value")
    && typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function applicationError(
  reason: LedgerAuthorityPublicationApplicationServiceErrorReason,
  cause: unknown,
  publicationAuthority: LedgerAuthorityPublicationEffectAuthority,
): LedgerAuthorityPublicationApplicationServiceError {
  return new LedgerAuthorityPublicationApplicationServiceError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    publicationAuthority,
  );
}

function fail(
  reason: LedgerAuthorityPublicationApplicationServiceErrorReason,
  cause?: unknown,
  publicationAuthority: LedgerAuthorityPublicationEffectAuthority = "unknown",
): never {
  throw applicationError(reason, cause, publicationAuthority);
}

function contextualizeFailure(
  error: unknown,
  publicationAuthority: LedgerAuthorityPublicationEffectAuthority,
): unknown {
  if (!(error instanceof LedgerAuthorityPublicationApplicationServiceError)) {
    return error;
  }
  const authority = error.publicationAuthority === "unchanged"
    ? publicationAuthority
    : error.publicationAuthority;
  return new LedgerAuthorityPublicationApplicationServiceError(
    error.reason,
    error.causeCode,
    error.causeReason,
    authority,
  );
}

function parseOptions(value: unknown): Readonly<ParsedOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error, "unchanged");
    throw error;
  }
  if (
    Object.keys(record).some((key) => key !== "signal")
    || (record.signal !== undefined
      && (typeof record.signal !== "object"
        || record.signal === null
        || types.isProxy(record.signal)
        || !(record.signal instanceof AbortSignal)))
  ) {
    fail("input", undefined, "unchanged");
  }
  return Object.freeze({
    signal: record.signal as AbortSignal | undefined,
  });
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted", undefined, "unchanged");
}

function parseExactPlan(
  planValue: unknown,
  planDigestValue: unknown,
): Readonly<ExactPlanInput> {
  let plan;
  let planDigest;
  try {
    plan = parseLedgerAuthorityPublicationPlan(planValue);
    planDigest = parseSha256Digest(planDigestValue, "$planDigest");
  } catch (error: unknown) {
    if (
      error instanceof LedgerAuthorityPublicationPlanError
      || error instanceof Sha256Error
    ) {
      fail("plan", error, "unchanged");
    }
    throw error;
  }
  if (computeLedgerAuthorityPublicationPlanDigest(plan) !== planDigest) {
    fail("plan", undefined, "unchanged");
  }
  return Object.freeze({ plan, planDigest });
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
      if (error.reason === "aborted") fail("aborted", error, "unchanged");
      fail("config", error, "unchanged");
    }
    throw error;
  }
}

function assertConfigMatchesPlan(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  plan: Readonly<LedgerAuthorityPublicationPlan>,
): void {
  if (
    config.configDigest !== plan.configDigest
    || config.model.program.programId !== plan.intent.record.programId
  ) {
    fail("config", undefined, "unchanged");
  }
}

async function assertConfigCurrent(
  workspaceRoot: RootedDirectory,
  expected: Readonly<WakeflowConfigAuthoritySnapshot>,
  plan: Readonly<LedgerAuthorityPublicationPlan>,
  signal: AbortSignal | undefined,
): Promise<void> {
  const current = await readConfig(workspaceRoot, signal);
  assertConfigMatchesPlan(current, plan);
  if (
    current.workspaceRoot !== expected.workspaceRoot
    || current.source.digest !== expected.source.digest
    || current.ledgerRoot !== expected.ledgerRoot
  ) {
    fail("config", undefined, "unchanged");
  }
}

async function openApplicationContext(
  workspaceRoot: RootedDirectory,
  plan: Readonly<LedgerAuthorityPublicationPlan>,
  signal: AbortSignal | undefined,
): Promise<Readonly<ApplicationContext>> {
  const config = await readConfig(workspaceRoot, signal);
  assertConfigMatchesPlan(config, plan);
  const placement = config.placements.roots.find(
    (entry) => entry.key === "ledger.root",
  );
  if (
    placement === undefined
    || placement.state !== "present"
    || placement.realPath === null
  ) {
    fail("ledger", undefined, "unchanged");
  }
  let ledgerRoot: RootedDirectory | undefined;
  try {
    ledgerRoot = await RootedDirectory.open(
      placement.absolutePath,
      "$ledgerRoot",
    );
    if (ledgerRoot.absolutePath !== placement.realPath) {
      fail("ledger", undefined, "unchanged");
    }
    const store = new LedgerAuthorityStore(ledgerRoot);
    const layout = await store.inspectLayout(
      signal === undefined ? undefined : { signal },
    );
    if (layout.status !== "current") fail("ledger", undefined, "unchanged");
    return Object.freeze({ config, ledgerRoot, store });
  } catch (error: unknown) {
    if (ledgerRoot !== undefined) {
      try {
        await ledgerRoot.close();
      } catch {
        // 首个Config、布局或根关系错误优先。
      }
    }
    if (error instanceof LedgerAuthorityPublicationApplicationServiceError) {
      throw error;
    }
    if (error instanceof LedgerAuthorityStoreError) {
      if (error.reason === "aborted") fail("aborted", error, "unchanged");
      fail("ledger", error, "unchanged");
    }
    if (error instanceof RootedDirectoryError) {
      fail("ledger", error, "unchanged");
    }
    throw error;
  }
}

async function closeApplicationContext(
  context: Readonly<ApplicationContext>,
  publicationAuthority: LedgerAuthorityPublicationEffectAuthority,
): Promise<void> {
  try {
    await context.ledgerRoot.close();
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      fail("ledger", error, publicationAuthority);
    }
    throw error;
  }
}

function mapPayloadError(
  error: LedgerAuthorityPublicationPayloadMaterializationError,
): never {
  if (error.reason === "input") fail("input", error, "unchanged");
  fail(error.reason, error, "unchanged");
}

function mappedStoreError(
  error: LedgerAuthorityStoreError,
  publicationAuthority: LedgerAuthorityPublicationEffectAuthority,
): LedgerAuthorityPublicationApplicationServiceError {
  if (error.reason === "aborted") {
    return applicationError("aborted", error, publicationAuthority);
  }
  if (error.reason === "root-scope") {
    return applicationError("ledger", error, publicationAuthority);
  }
  if (error.reason === "recovery-input-required") {
    return applicationError("input-required", error, "recoverable");
  }
  if (
    error.reason === "recovery-required"
    || error.reason === "lock-timeout"
    || error.reason === "lock-unsafe"
  ) {
    return applicationError("recovery-required", error, "recoverable");
  }
  if (error.reason === "not-found") {
    return applicationError("not-found", error, publicationAuthority);
  }
  if (error.reason === "capacity") {
    return applicationError("capacity", error, publicationAuthority);
  }
  if (error.reason === "input") {
    return applicationError("plan", error, publicationAuthority);
  }
  if (
    error.reason === "conflict"
    || error.reason === "record"
    || error.reason === "member"
    || error.reason === "node-policy"
  ) {
    return applicationError("conflict", error, publicationAuthority);
  }
  return applicationError("operation-failure", error, publicationAuthority);
}

async function observeExactRecovery(
  store: LedgerAuthorityStore,
  plan: Readonly<LedgerAuthorityPublicationPlan>,
  signal: AbortSignal | undefined,
): Promise<ExactRecoveryObservation> {
  try {
    const result = await store.recoverExactRecordPublication(
      plan.intent,
      signal === undefined ? undefined : { signal },
    );
    return Object.freeze({ status: "completed" as const, result });
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityStoreError) {
      if (error.reason === "not-found") {
        return Object.freeze({ status: "absent" as const });
      }
      if (error.reason === "recovery-input-required") {
        return Object.freeze({ status: "input-required" as const });
      }
      throw mappedStoreError(error, "unknown");
    }
    throw error;
  }
}

function treePlanFile(
  plan: Readonly<LedgerAuthorityPublicationPlan>,
  path: string,
) {
  return plan.intent.treePlan.files.find((file) => file.path === path) ?? null;
}

function assertLoadedMatchesPlan(
  loaded: Readonly<LoadedLedgerAuthorityRecord>,
  plan: Readonly<LedgerAuthorityPublicationPlan>,
): void {
  const expected = plan.intent.record;
  const recordPlan = treePlanFile(plan, "record.json");
  if (
    recordPlan === null
    || loaded.recordRootRef !== plan.intent.finalRootRef
    || loaded.recordDigest !== computeLedgerAuthorityRecordDigest(expected)
    || renderLedgerAuthorityRecord(loaded.record)
      !== renderLedgerAuthorityRecord(expected)
    || loaded.recordSource.digest !== recordPlan.digest
    || loaded.recordSource.byteCount !== recordPlan.byteCount
    || loaded.documents.length !== expected.documents.length
  ) {
    fail("conflict", undefined, "unchanged");
  }
  for (const [index, document] of loaded.documents.entries()) {
    const expectedDocument = expected.documents[index];
    if (expectedDocument === undefined) {
      fail("conflict", undefined, "unchanged");
    }
    const file = treePlanFile(plan, expectedDocument.path);
    if (
      file === null
      || document.path !== expectedDocument.path
      || document.role !== expectedDocument.role
      || document.mediaType !== expectedDocument.mediaType
      || document.digest !== expectedDocument.digest
      || document.source.digest !== file.digest
      || document.source.byteCount !== file.byteCount
    ) {
      fail("conflict", undefined, "unchanged");
    }
  }
}

async function loadCurrentRecord(
  store: LedgerAuthorityStore,
  plan: Readonly<LedgerAuthorityPublicationPlan>,
  signal: AbortSignal | undefined,
): Promise<Readonly<LoadedLedgerAuthorityRecord> | null> {
  try {
    const record = plan.intent.record;
    const loaded = record.artifactKind === "wakeflow-requirement-record"
      ? await store.loadRequirement(
          record.requirementId,
          signal === undefined ? undefined : { signal },
        )
      : await store.loadConfirmation(
          record.confirmationId,
          signal === undefined ? undefined : { signal },
        );
    assertLoadedMatchesPlan(loaded, plan);
    return loaded;
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityStoreError) {
      if (error.reason === "not-found") return null;
      throw mappedStoreError(error, "unchanged");
    }
    throw error;
  }
}

async function resourceExists(
  root: RootedDirectory,
  path: PortableResourcePath,
  rootFailure: "config" | "ledger",
): Promise<boolean> {
  try {
    await root.inspectExistingResource(path);
    return true;
  } catch (error: unknown) {
    if (
      error instanceof RootedDirectoryError
      && error.reason === "resource-not-found"
    ) {
      return false;
    }
    if (error instanceof RootedDirectoryError) {
      fail(rootFailure, error, "unchanged");
    }
    throw error;
  }
}

async function assertFutureDemandAvailable(
  workspaceRoot: RootedDirectory,
  plan: Readonly<LedgerAuthorityPublicationPlan>,
  signal: AbortSignal | undefined,
): Promise<void> {
  const record = plan.intent.record;
  if (record.artifactKind !== "wakeflow-confirmation-record") return;
  for (const ref of [
    demandFinalRootRef(record.demandId),
    demandPublicationStageRef(record.demandId),
    demandPublicationTransactionRef(record.demandId),
    demandPublicationLockRef(record.demandId),
  ]) {
    assertNotAborted(signal);
    if (await resourceExists(workspaceRoot, ref, "config")) {
      fail("conflict", undefined, "unchanged");
    }
  }
}

async function hasOrphanRecoveryResource(
  root: RootedDirectory,
  plan: Readonly<LedgerAuthorityPublicationPlan>,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  for (const ref of [
    plan.intent.finalRootRef,
    plan.intent.intentRef,
    plan.intent.stageRef,
    plan.intent.lockRef,
  ]) {
    assertNotAborted(signal);
    if (await resourceExists(root, ref, "ledger")) return true;
  }
  return false;
}

function memberReferences(
  loaded: Readonly<LoadedLedgerAuthorityRecord>,
): LedgerAuthorityPublicationApplicationResult["memberReferences"] {
  let references: readonly Readonly<LedgerAuthorityMemberReference>[];
  try {
    references = loaded.documents.map((document) =>
      createLedgerAuthorityMemberReference(loaded, document.path));
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityStoreError) {
      fail("operation-failure", error, "current");
    }
    throw error;
  }
  const first = references[0];
  if (first === undefined) fail("operation-failure", undefined, "current");
  return Object.freeze([first, ...references.slice(1)]) as
    LedgerAuthorityPublicationApplicationResult["memberReferences"];
}

function applicationResult(
  operation: "apply" | "recover",
  disposition: LedgerAuthorityPublicationApplicationDisposition,
  planDigest: Sha256Digest,
  result: Readonly<LedgerAuthorityPublicationResult>,
): Readonly<LedgerAuthorityPublicationApplicationResult> {
  return Object.freeze({
    operation,
    disposition,
    planDigest,
    wroteAuthority: result.wroteAuthority,
    loaded: result.loaded,
    memberReferences: memberReferences(result.loaded),
  });
}

function currentResult(
  operation: "apply" | "recover",
  planDigest: Sha256Digest,
  loaded: Readonly<LoadedLedgerAuthorityRecord>,
): Readonly<LedgerAuthorityPublicationApplicationResult> {
  return applicationResult(
    operation,
    "current",
    planDigest,
    Object.freeze({ wroteAuthority: false, loaded }),
  );
}

export class LedgerAuthorityPublicationApplicationService {
  readonly #workspaceRoot: RootedDirectory;

  constructor(workspaceRoot: RootedDirectory) {
    if (
      typeof workspaceRoot !== "object"
      || workspaceRoot === null
      || types.isProxy(workspaceRoot)
      || !(workspaceRoot instanceof RootedDirectory)
    ) {
      fail("input", undefined, "unchanged");
    }
    this.#workspaceRoot = workspaceRoot;
  }

  /** 应用exact Plan；existing exact intent始终前向恢复，不重新开始事务。 */
  async apply(
    planValue: unknown,
    planDigestValue: unknown,
    optionsValue: LedgerAuthorityPublicationApplicationOptions = {},
  ): Promise<Readonly<LedgerAuthorityPublicationApplicationResult>> {
    const options = parseOptions(optionsValue);
    assertNotAborted(options.signal);
    const { plan, planDigest } = parseExactPlan(planValue, planDigestValue);
    let payload;
    try {
      payload = await materializeLedgerAuthorityPublicationPayload(
        this.#workspaceRoot,
        plan,
        options.signal === undefined ? undefined : { signal: options.signal },
      );
    } catch (error: unknown) {
      if (
        error instanceof LedgerAuthorityPublicationPayloadMaterializationError
      ) {
        mapPayloadError(error);
      }
      throw error;
    }

    let context: Readonly<ApplicationContext> | undefined;
    let result: Readonly<LedgerAuthorityPublicationApplicationResult>
      | undefined;
    let publicationAuthority: LedgerAuthorityPublicationEffectAuthority =
      "unchanged";
    let failure: unknown;
    try {
      context = await openApplicationContext(
        this.#workspaceRoot,
        plan,
        options.signal,
      );
      await assertConfigCurrent(
        this.#workspaceRoot,
        context.config,
        plan,
        options.signal,
      );
      publicationAuthority = "unknown";
      const recovery = await observeExactRecovery(
        context.store,
        plan,
        options.signal,
      );
      if (recovery.status === "completed") {
        assertLoadedMatchesPlan(recovery.result.loaded, plan);
        publicationAuthority = "current";
        result = applicationResult(
          "apply",
          recovery.result.wroteAuthority ? "recovered" : "current",
          planDigest,
          recovery.result,
        );
      } else {
        const recovering = recovery.status === "input-required";
        publicationAuthority = recovering ? "recoverable" : "unchanged";
        if (!recovering) {
          const current = await loadCurrentRecord(
            context.store,
            plan,
            options.signal,
          );
          if (current !== null) {
            publicationAuthority = "current";
            result = currentResult("apply", planDigest, current);
          } else {
            await assertFutureDemandAvailable(
              this.#workspaceRoot,
              plan,
              options.signal,
            );
          }
        }
        if (result === undefined) {
          await assertConfigCurrent(
            this.#workspaceRoot,
            context.config,
            plan,
            options.signal,
          );
          publicationAuthority = recovering ? "recoverable" : "unknown";
          let stored;
          try {
            stored = await context.store.publish(
              plan.intent.record,
              payload,
              options.signal === undefined ? undefined : {
                signal: options.signal,
              },
            );
          } catch (error: unknown) {
            if (error instanceof LedgerAuthorityStoreError) {
              throw mappedStoreError(error, publicationAuthority);
            }
            throw error;
          }
          assertLoadedMatchesPlan(stored.loaded, plan);
          publicationAuthority = "current";
          result = applicationResult(
            "apply",
            stored.wroteAuthority
              ? (recovering ? "recovered" : "published")
              : "current",
            planDigest,
            stored,
          );
        }
      }
    } catch (error: unknown) {
      failure = contextualizeFailure(error, publicationAuthority);
    }
    if (context !== undefined) {
      try {
        await closeApplicationContext(context, publicationAuthority);
      } catch (error: unknown) {
        if (failure === undefined) {
          failure = contextualizeFailure(error, publicationAuthority);
        }
      }
    }
    if (failure !== undefined) throw failure;
    if (result === undefined) fail("operation-failure", undefined, "unknown");
    return result;
  }

  /** 不读取source地恢复exact Plan；partial stage明确要求调用方重新apply。 */
  async recover(
    planValue: unknown,
    planDigestValue: unknown,
    optionsValue: LedgerAuthorityPublicationApplicationOptions = {},
  ): Promise<Readonly<LedgerAuthorityPublicationApplicationResult>> {
    const options = parseOptions(optionsValue);
    assertNotAborted(options.signal);
    const { plan, planDigest } = parseExactPlan(planValue, planDigestValue);
    let context: Readonly<ApplicationContext> | undefined;
    let result: Readonly<LedgerAuthorityPublicationApplicationResult>
      | undefined;
    let publicationAuthority: LedgerAuthorityPublicationEffectAuthority =
      "unchanged";
    let failure: unknown;
    try {
      context = await openApplicationContext(
        this.#workspaceRoot,
        plan,
        options.signal,
      );
      await assertConfigCurrent(
        this.#workspaceRoot,
        context.config,
        plan,
        options.signal,
      );
      publicationAuthority = "unknown";
      const recovery = await observeExactRecovery(
        context.store,
        plan,
        options.signal,
      );
      if (recovery.status === "completed") {
        assertLoadedMatchesPlan(recovery.result.loaded, plan);
        publicationAuthority = "current";
        result = applicationResult(
          "recover",
          recovery.result.wroteAuthority ? "recovered" : "current",
          planDigest,
          recovery.result,
        );
      } else if (recovery.status === "input-required") {
        fail("input-required", undefined, "recoverable");
      } else {
        publicationAuthority = "unchanged";
        const current = await loadCurrentRecord(
          context.store,
          plan,
          options.signal,
        );
        if (current !== null) {
          publicationAuthority = "current";
          result = currentResult("recover", planDigest, current);
        } else if (await hasOrphanRecoveryResource(
          context.ledgerRoot,
          plan,
          options.signal,
        )) {
          fail("recovery-required", undefined, "unknown");
        } else {
          fail("not-found", undefined, "unchanged");
        }
      }
    } catch (error: unknown) {
      failure = contextualizeFailure(error, publicationAuthority);
    }
    if (context !== undefined) {
      try {
        await closeApplicationContext(context, publicationAuthority);
      } catch (error: unknown) {
        if (failure === undefined) {
          failure = contextualizeFailure(error, publicationAuthority);
        }
      }
    }
    if (failure !== undefined) throw failure;
    if (result === undefined) fail("operation-failure", undefined, "unknown");
    return result;
  }
}
