import { types } from "node:util";

import {
  readWakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
  type WakeflowConfigAuthoritySnapshot,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  createLedgerAuthorityMemberReference,
  LedgerAuthorityStore,
  LedgerAuthorityStoreError,
  type LedgerAuthorityMemberReference,
  type LoadedLedgerAuthorityRecord,
} from "../ledger/ledger-authority-store.js";
import type { StoredTodoCollectionItem } from "./todo-collection-authority.js";
import {
  appendTodoItem,
  inspectTodoItems,
  recoverTodoItemTransaction,
  TodoCollectionServiceError,
} from "./todo-collection-service.js";
import {
  computeTodoIntakePublicationPlanDigest,
  parseTodoIntakePublicationPlan,
  TodoIntakePublicationPlanError,
  type TodoIntakePublicationPlan,
} from "./todo-intake-publication-plan.js";
import {
  computeTodoIntakeDigest,
  type TodoIntake,
} from "./todo-intake.js";
import { todoTransactionRef } from "./todo-paths.js";
import {
  computeTodoStateDigest,
  createInitialTodoState,
} from "./todo-state.js";

/**
 * Wakeflow Governance / TODO：exact Intake计划的Apply与Recovery owner。
 *
 * Service复验Config和Ledger refs后，只委托现有Collection Service完成append或exact
 * transaction recovery。它不创建第二个journal、锁、stage或projection writer。
 */

export interface TodoIntakePublicationApplicationOptions {
  readonly signal?: AbortSignal;
}

export type TodoIntakePublicationEffectAuthority =
  | "unchanged"
  | "recoverable"
  | "current"
  | "unknown";

export type TodoIntakePublicationDisposition =
  | "published"
  | "recovered"
  | "current";

export interface TodoIntakePublicationApplicationResult {
  readonly operation: "apply" | "recover";
  readonly disposition: TodoIntakePublicationDisposition;
  readonly planDigest: Sha256Digest;
  readonly wroteAuthority: boolean;
  readonly item: Readonly<StoredTodoCollectionItem>;
  readonly collectionDigest: Sha256Digest;
}

export type TodoIntakePublicationApplicationServiceErrorReason =
  | "input"
  | "plan"
  | "config"
  | "authority"
  | "todo"
  | "conflict"
  | "not-found"
  | "aborted"
  | "recovery-required"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "TODO intake publication application input is invalid.",
  plan: "TODO intake publication plan or digest is invalid.",
  config: "TODO intake publication Config no longer matches its plan.",
  authority: "TODO intake publication Ledger authority no longer matches its plan.",
  todo: "TODO intake publication collection authority is invalid.",
  conflict: "TODO intake publication conflicts with current collection authority.",
  "not-found": "TODO intake publication has no exact recoverable operation.",
  aborted: "TODO intake publication application was aborted.",
  "recovery-required": "TODO intake publication requires explicit recovery.",
  "operation-failure": "TODO intake publication application failed.",
} as const satisfies Readonly<Record<
  TodoIntakePublicationApplicationServiceErrorReason,
  string
>>;

/** Application不能证明未变、可恢复或已完成状态时的稳定错误。 */
export class TodoIntakePublicationApplicationServiceError extends Error {
  override readonly name = "TodoIntakePublicationApplicationServiceError";
  readonly code = "wakeflow-todo-intake-publication-application-service" as const;
  readonly reason: TodoIntakePublicationApplicationServiceErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly publicationAuthority: TodoIntakePublicationEffectAuthority;

  constructor(
    reason: TodoIntakePublicationApplicationServiceErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    publicationAuthority: TodoIntakePublicationEffectAuthority = "unknown",
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

interface ExactPlan {
  readonly plan: Readonly<TodoIntakePublicationPlan>;
  readonly planDigest: Sha256Digest;
}

function ownString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined
    && Object.hasOwn(descriptor, "value")
    && typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function fail(
  reason: TodoIntakePublicationApplicationServiceErrorReason,
  cause?: unknown,
  publicationAuthority: TodoIntakePublicationEffectAuthority = "unknown",
): never {
  throw new TodoIntakePublicationApplicationServiceError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    publicationAuthority,
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
  return Object.freeze({ signal: record.signal as AbortSignal | undefined });
}

function parseExactPlan(
  planValue: unknown,
  digestValue: unknown,
): Readonly<ExactPlan> {
  let plan;
  let planDigest;
  try {
    plan = parseTodoIntakePublicationPlan(planValue);
    planDigest = parseSha256Digest(digestValue, "$planDigest");
  } catch (error: unknown) {
    if (
      error instanceof TodoIntakePublicationPlanError
      || error instanceof Sha256Error
    ) {
      fail("plan", error, "unchanged");
    }
    throw error;
  }
  if (computeTodoIntakePublicationPlanDigest(plan) !== planDigest) {
    fail("plan", undefined, "unchanged");
  }
  return Object.freeze({ plan, planDigest });
}

async function readConfig(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
  publicationAuthority: TodoIntakePublicationEffectAuthority = "unchanged",
): Promise<Readonly<WakeflowConfigAuthoritySnapshot>> {
  try {
    return await readWakeflowConfigAuthoritySnapshot(
      root,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthoritySnapshotError) {
      if (error.reason === "aborted") {
        fail("aborted", error, publicationAuthority);
      }
      fail("config", error, publicationAuthority);
    }
    throw error;
  }
}

function assertConfig(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  plan: Readonly<TodoIntakePublicationPlan>,
  publicationAuthority: TodoIntakePublicationEffectAuthority = "unchanged",
): void {
  const intake = plan.targetIntake;
  if (
    config.configDigest !== plan.configDigest
    || config.model.program.programId !== intake.programId
    || config.indexes.controllerWindow.windowId !== intake.controllerWindowId
    || config.indexes.windowById[intake.originWindowId] === undefined
  ) {
    fail("config", undefined, publicationAuthority);
  }
}

async function loadRecord(
  store: LedgerAuthorityStore,
  reference: Readonly<LedgerAuthorityMemberReference>,
  signal: AbortSignal | undefined,
): Promise<Readonly<LoadedLedgerAuthorityRecord>> {
  try {
    return reference.family === "requirement"
      ? await store.loadRequirement(
          reference.recordId,
          signal === undefined ? undefined : { signal },
        )
      : await store.loadConfirmation(
          reference.recordId,
          signal === undefined ? undefined : { signal },
        );
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityStoreError) {
      if (error.reason === "aborted") fail("aborted", error, "unchanged");
      fail("authority", error, "unchanged");
    }
    throw error;
  }
}

async function assertAuthorityCurrent(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  intake: Readonly<TodoIntake>,
  signal: AbortSignal | undefined,
): Promise<void> {
  let root: RootedDirectory;
  try {
    root = await RootedDirectory.open(config.ledgerRoot, "$ledgerRoot");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      fail("authority", error, "unchanged");
    }
    throw error;
  }
  let failure: unknown;
  try {
    const store = new LedgerAuthorityStore(root);
    const loaded = new Map<string, Readonly<LoadedLedgerAuthorityRecord>>();
    for (const expected of intake.authorityRefs) {
      let record = loaded.get(expected.recordId);
      if (record === undefined) {
        record = await loadRecord(store, expected, signal);
        loaded.set(expected.recordId, record);
        if (record.record.programId !== intake.programId) {
          fail("authority", undefined, "unchanged");
        }
      }
      let current;
      try {
        current = createLedgerAuthorityMemberReference(
          record,
          expected.memberPath,
        );
      } catch (error: unknown) {
        if (error instanceof LedgerAuthorityStoreError) {
          fail("authority", error, "unchanged");
        }
        throw error;
      }
      if (
        computeCanonicalJsonSha256Digest(current)
          !== computeCanonicalJsonSha256Digest(expected)
      ) {
        fail("authority", undefined, "unchanged");
      }
    }
  } catch (error: unknown) {
    failure = error;
  }
  try {
    await root.close();
  } catch (error: unknown) {
    if (failure === undefined) failure = error;
  }
  if (failure !== undefined) throw failure;
}

function expectedState(intake: Readonly<TodoIntake>) {
  return createInitialTodoState(intake);
}

function isExactItem(
  item: Readonly<StoredTodoCollectionItem>,
  plan: Readonly<TodoIntakePublicationPlan>,
): boolean {
  const state = expectedState(plan.targetIntake);
  return item.intakeDigest === computeTodoIntakeDigest(plan.targetIntake)
    && item.stateDigest === computeTodoStateDigest(state);
}

function draftFrom(intake: Readonly<TodoIntake>) {
  return {
    programId: intake.programId,
    todoId: intake.todoId,
    demandType: intake.demandType,
    priority: intake.priority,
    originWindowId: intake.originWindowId,
    controllerWindowId: intake.controllerWindowId,
    summary: intake.summary,
    intakeRationale: intake.intakeRationale,
    readiness: intake.readiness,
    autoClaim: intake.autoClaim,
    testingDecision: intake.testingDecision,
    authorityRefs: intake.authorityRefs,
  };
}

async function targetTransactionExists(
  root: RootedDirectory,
  intake: Readonly<TodoIntake>,
): Promise<boolean> {
  try {
    await root.inspectExistingResource(todoTransactionRef(intake.todoId));
    return true;
  } catch (error: unknown) {
    if (
      error instanceof RootedDirectoryError
      && error.reason === "resource-not-found"
    ) {
      return false;
    }
    return false;
  }
}

function applicationResult(
  operation: "apply" | "recover",
  disposition: TodoIntakePublicationDisposition,
  planDigest: Sha256Digest,
  wroteAuthority: boolean,
  item: Readonly<StoredTodoCollectionItem>,
  collectionDigest: Sha256Digest,
): Readonly<TodoIntakePublicationApplicationResult> {
  return Object.freeze({
    operation,
    disposition,
    planDigest,
    wroteAuthority,
    item,
    collectionDigest,
  });
}

export class TodoIntakePublicationApplicationService {
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

  async #prepare(
    planValue: unknown,
    digestValue: unknown,
    optionsValue: TodoIntakePublicationApplicationOptions,
  ) {
    const exact = parseExactPlan(planValue, digestValue);
    const options = parseOptions(optionsValue);
    const config = await readConfig(this.#workspaceRoot, options.signal);
    assertConfig(config, exact.plan);
    await assertAuthorityCurrent(
      config,
      exact.plan.targetIntake,
      options.signal,
    );
    const current = await readConfig(this.#workspaceRoot, options.signal);
    assertConfig(current, exact.plan);
    return Object.freeze({ ...exact, options });
  }

  /** exact plan首次append或已完成幂等观察。 */
  async apply(
    planValue: unknown,
    digestValue: unknown,
    optionsValue: TodoIntakePublicationApplicationOptions = {},
  ): Promise<Readonly<TodoIntakePublicationApplicationResult>> {
    const prepared = await this.#prepare(planValue, digestValue, optionsValue);
    let snapshot;
    try {
      snapshot = await inspectTodoItems(
        this.#workspaceRoot,
        prepared.options.signal,
      );
    } catch (error: unknown) {
      if (error instanceof TodoCollectionServiceError) {
        if (error.reason === "aborted") fail("aborted", error, "unchanged");
        const recoverable = await targetTransactionExists(
          this.#workspaceRoot,
          prepared.plan.targetIntake,
        );
        fail(
          recoverable ? "recovery-required" : "todo",
          error,
          recoverable ? "recoverable" : "unchanged",
        );
      }
      throw error;
    }
    const existing = snapshot.items.find(
      (item) => item.todoId === prepared.plan.targetIntake.todoId,
    );
    if (existing !== undefined) {
      if (!isExactItem(existing, prepared.plan)) {
        fail("conflict", undefined, "current");
      }
      return applicationResult(
        "apply",
        "current",
        prepared.planDigest,
        false,
        existing,
        snapshot.collection.collectionDigest,
      );
    }
    if (
      snapshot.collection.collectionDigest
        !== prepared.plan.expectedCollectionDigest
    ) {
      fail("conflict", undefined, "unchanged");
    }
    try {
      const result = await appendTodoItem(
        this.#workspaceRoot,
        draftFrom(prepared.plan.targetIntake),
        {
          expectedCollectionDigest: prepared.plan.expectedCollectionDigest,
          clock: () => prepared.plan.targetIntake.createdAt,
          ...(prepared.options.signal === undefined
            ? {}
            : { signal: prepared.options.signal }),
        },
      );
      if (result.operation !== "append" || !isExactItem(result.item, prepared.plan)) {
        fail("operation-failure", undefined, "current");
      }
      assertConfig(
        await readConfig(this.#workspaceRoot, prepared.options.signal, "current"),
        prepared.plan,
        "current",
      );
      return applicationResult(
        "apply",
        result.wroteAuthority ? "published" : "current",
        prepared.planDigest,
        result.wroteAuthority,
        result.item,
        result.snapshot.collection.collectionDigest,
      );
    } catch (error: unknown) {
      if (error instanceof TodoIntakePublicationApplicationServiceError) {
        throw error;
      }
      if (error instanceof TodoCollectionServiceError) {
        const recoverable = await targetTransactionExists(
          this.#workspaceRoot,
          prepared.plan.targetIntake,
        );
        if (error.reason === "aborted") {
          fail("aborted", error, recoverable ? "recoverable" : "unchanged");
        }
        fail(
          recoverable ? "recovery-required" : "operation-failure",
          error,
          recoverable ? "recoverable" : "unchanged",
        );
      }
      throw error;
    }
  }

  /** exact plan只恢复同TODO journal，或确认已经current。 */
  async recover(
    planValue: unknown,
    digestValue: unknown,
    optionsValue: TodoIntakePublicationApplicationOptions = {},
  ): Promise<Readonly<TodoIntakePublicationApplicationResult>> {
    const prepared = await this.#prepare(planValue, digestValue, optionsValue);
    try {
      const result = await recoverTodoItemTransaction(
        this.#workspaceRoot,
        prepared.plan.targetIntake.todoId,
        prepared.options.signal === undefined
          ? undefined
          : { signal: prepared.options.signal },
      );
      if (result.operation !== "append" || !isExactItem(result.item, prepared.plan)) {
        fail("conflict", undefined, "current");
      }
      assertConfig(
        await readConfig(this.#workspaceRoot, prepared.options.signal, "current"),
        prepared.plan,
        "current",
      );
      return applicationResult(
        "recover",
        result.wroteAuthority ? "recovered" : "current",
        prepared.planDigest,
        result.wroteAuthority,
        result.item,
        result.snapshot.collection.collectionDigest,
      );
    } catch (error: unknown) {
      if (error instanceof TodoIntakePublicationApplicationServiceError) {
        throw error;
      }
      if (error instanceof TodoCollectionServiceError) {
        if (error.reason === "aborted") fail("aborted", error, "recoverable");
        if (error.reason !== "not-found") {
          fail("operation-failure", error, "unknown");
        }
        try {
          const snapshot = await inspectTodoItems(
            this.#workspaceRoot,
            prepared.options.signal,
          );
          const item = snapshot.items.find(
            (entry) => entry.todoId === prepared.plan.targetIntake.todoId,
          );
          if (item === undefined) fail("not-found", error, "unchanged");
          if (!isExactItem(item, prepared.plan)) {
            fail("conflict", undefined, "current");
          }
          assertConfig(
            await readConfig(
              this.#workspaceRoot,
              prepared.options.signal,
              "current",
            ),
            prepared.plan,
            "current",
          );
          return applicationResult(
            "recover",
            "current",
            prepared.planDigest,
            false,
            item,
            snapshot.collection.collectionDigest,
          );
        } catch (inspectionError: unknown) {
          if (inspectionError instanceof TodoIntakePublicationApplicationServiceError) {
            throw inspectionError;
          }
          if (inspectionError instanceof TodoCollectionServiceError) {
            fail("todo", inspectionError, "unknown");
          }
          throw inspectionError;
        }
      }
      throw error;
    }
  }
}
