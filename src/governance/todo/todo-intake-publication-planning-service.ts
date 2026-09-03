import { types } from "node:util";

import {
  readWakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
  type WakeflowConfigAuthoritySnapshot,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import {
  createWakeflowDurableId,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  createUuidV4,
  parseUuidV4,
  UuidV4Error,
  type UuidV4Factory,
} from "../../foundation/identity/uuid-v4.js";
import { parseUtcInstant, type UtcInstant } from "../../foundation/time/utc-instant.js";
import {
  readUtcWallClock,
  UtcWallClockError,
  type UtcWallClock,
} from "../../foundation/time/wall-clock.js";
import {
  createLedgerAuthorityMemberReference,
  LedgerAuthorityStore,
  LedgerAuthorityStoreError,
  type LedgerAuthorityMemberReference,
  type LoadedLedgerAuthorityRecord,
} from "../ledger/ledger-authority-store.js";
import {
  inspectTodoItems,
  TodoCollectionServiceError,
} from "./todo-collection-service.js";
import {
  parseTodoIntakePublicationInput,
  TodoIntakePublicationInputError,
  type TodoIntakePublicationAuthorityMemberSelection,
  type TodoIntakePublicationInput,
} from "./todo-intake-publication-input.js";
import {
  computeTodoIntakePublicationPlanDigest,
  createTodoIntakePublicationPlan,
  TodoIntakePublicationPlanError,
  type TodoIntakePublicationPlan,
} from "./todo-intake-publication-plan.js";
import {
  createTodoIntake,
  TodoIntakeError,
  type TodoIntake,
} from "./todo-intake.js";

/**
 * Wakeflow Governance / TODO：从当前Config、Collection与Ledger零写生成Intake计划。
 *
 * Service派生Program、Controller、完整Ledger refs、TODO ID和时间。它不写Collection，
 * 不创建transaction，也不把来源窗口解释为调用认证。
 */

export interface TodoIntakePublicationPreviewOptions {
  readonly clock?: UtcWallClock;
  readonly uuidFactory?: UuidV4Factory;
  readonly signal?: AbortSignal;
}

export interface TodoIntakePublicationPreviewResult {
  readonly plan: Readonly<TodoIntakePublicationPlan>;
  readonly planDigest: Sha256Digest;
}

export type TodoIntakePublicationPlanningServiceErrorReason =
  | "input"
  | "config"
  | "todo"
  | "authority"
  | "identity"
  | "time"
  | "conflict"
  | "root"
  | "plan"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "TODO intake publication planning input is invalid.",
  config: "TODO intake publication Config authority is invalid.",
  todo: "TODO intake publication collection authority is invalid.",
  authority: "TODO intake publication Ledger authority is invalid.",
  identity: "TODO intake publication identity allocation failed.",
  time: "TODO intake publication time allocation failed.",
  conflict: "TODO intake publication source changed or identity is occupied.",
  root: "TODO intake publication root could not be held safely.",
  plan: "TODO intake publication plan could not be closed.",
  aborted: "TODO intake publication planning was aborted.",
  "operation-failure": "TODO intake publication planning failed.",
} as const satisfies Readonly<Record<
  TodoIntakePublicationPlanningServiceErrorReason,
  string
>>;

/** Preview不能从当前权威形成零写exact计划时的稳定错误。 */
export class TodoIntakePublicationPlanningServiceError extends Error {
  override readonly name = "TodoIntakePublicationPlanningServiceError";
  readonly code = "wakeflow-todo-intake-publication-planning-service" as const;
  readonly reason: TodoIntakePublicationPlanningServiceErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;

  constructor(
    reason: TodoIntakePublicationPlanningServiceErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
  }
}

interface ParsedOptions {
  readonly clock: UtcWallClock | undefined;
  readonly uuidFactory: UuidV4Factory | undefined;
  readonly signal: AbortSignal | undefined;
}

const DRAFT_TODO_ID = createWakeflowDurableId(
  "todo",
  parseUuidV4("00000000-0000-4000-8000-000000000000"),
);
const DRAFT_TIME = parseUtcInstant("1970-01-01T00:00:00.000Z");

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
  reason: TodoIntakePublicationPlanningServiceErrorReason,
  cause?: unknown,
): never {
  throw new TodoIntakePublicationPlanningServiceError(
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
    Object.keys(record).some(
      (key) => key !== "clock" && key !== "signal" && key !== "uuidFactory",
    )
    || (record.clock !== undefined
      && (typeof record.clock !== "function" || types.isProxy(record.clock)))
    || (record.uuidFactory !== undefined
      && (typeof record.uuidFactory !== "function"
        || types.isProxy(record.uuidFactory)))
    || (record.signal !== undefined
      && (typeof record.signal !== "object"
        || record.signal === null
        || types.isProxy(record.signal)
        || !(record.signal instanceof AbortSignal)))
  ) {
    fail("input");
  }
  return Object.freeze({
    clock: record.clock as UtcWallClock | undefined,
    uuidFactory: record.uuidFactory as UuidV4Factory | undefined,
    signal: record.signal as AbortSignal | undefined,
  });
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted");
}

async function readConfig(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<WakeflowConfigAuthoritySnapshot>> {
  try {
    return await readWakeflowConfigAuthoritySnapshot(
      root,
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

async function readCollection(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
) {
  try {
    return await inspectTodoItems(root, signal);
  } catch (error: unknown) {
    if (error instanceof TodoCollectionServiceError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("todo", error);
    }
    throw error;
  }
}

async function openLedgerRoot(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
): Promise<RootedDirectory> {
  try {
    return await RootedDirectory.open(config.ledgerRoot, "$ledgerRoot");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root", error);
    throw error;
  }
}

async function loadRecord(
  store: LedgerAuthorityStore,
  selection: Readonly<TodoIntakePublicationAuthorityMemberSelection>,
  signal: AbortSignal | undefined,
): Promise<Readonly<LoadedLedgerAuthorityRecord>> {
  try {
    return selection.recordId.startsWith("requirement_")
      ? await store.loadRequirement(
          selection.recordId,
          signal === undefined ? undefined : { signal },
        )
      : await store.loadConfirmation(
          selection.recordId,
          signal === undefined ? undefined : { signal },
        );
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityStoreError) {
      if (error.reason === "aborted") fail("aborted", error);
      if (error.reason === "root-scope") fail("root", error);
      fail("authority", error);
    }
    throw error;
  }
}

async function selectAuthority(
  root: RootedDirectory,
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  input: Readonly<TodoIntakePublicationInput>,
  signal: AbortSignal | undefined,
): Promise<readonly [
  Readonly<LedgerAuthorityMemberReference>,
  ...Readonly<LedgerAuthorityMemberReference>[],
]> {
  const store = new LedgerAuthorityStore(root);
  const records = new Map<string, Readonly<LoadedLedgerAuthorityRecord>>();
  const references: LedgerAuthorityMemberReference[] = [];
  for (const selection of input.authorityMembers) {
    let loaded = records.get(selection.recordId);
    if (loaded === undefined) {
      loaded = await loadRecord(store, selection, signal);
      records.set(selection.recordId, loaded);
      if (loaded.record.programId !== config.model.program.programId) {
        fail("authority");
      }
    }
    try {
      references.push(createLedgerAuthorityMemberReference(
        loaded,
        selection.memberPath,
      ));
    } catch (error: unknown) {
      if (error instanceof LedgerAuthorityStoreError) fail("authority", error);
      throw error;
    }
  }
  references.sort((left, right) =>
    left.memberRef < right.memberRef
      ? -1
      : left.memberRef > right.memberRef
        ? 1
        : 0);
  const first = references[0];
  if (first === undefined) fail("authority");
  const closed: [
    Readonly<LedgerAuthorityMemberReference>,
    ...Readonly<LedgerAuthorityMemberReference>[],
  ] = [first];
  closed.push(...references.slice(1));
  return Object.freeze(closed);
}

function intakeDraft(
  input: Readonly<TodoIntakePublicationInput>,
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  authorityRefs: readonly [
    Readonly<LedgerAuthorityMemberReference>,
    ...Readonly<LedgerAuthorityMemberReference>[],
  ],
  todoId: WakeflowDurableId<"todo">,
) {
  const environment = authorityRefs.filter(
    (reference) => reference.role === "test-environment",
  );
  return {
    programId: config.model.program.programId,
    todoId,
    demandType: input.demandType,
    priority: input.priority,
    originWindowId: input.originWindowId,
    controllerWindowId: config.indexes.controllerWindow.windowId,
    summary: input.summary,
    intakeRationale: input.intakeRationale,
    readiness: input.readiness,
    autoClaim: input.autoClaim,
    testingDecision: {
      mode: input.testingDecision.mode,
      summary: input.testingDecision.summary,
      environmentMemberRef: input.testingDecision.mode === "real-environment"
        ? environment[0]?.memberRef ?? null
        : null,
    },
    authorityRefs,
  };
}

function createIntake(
  input: Readonly<TodoIntakePublicationInput>,
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  authorityRefs: readonly [
    Readonly<LedgerAuthorityMemberReference>,
    ...Readonly<LedgerAuthorityMemberReference>[],
  ],
  todoId: WakeflowDurableId<"todo">,
  createdAt: UtcInstant,
): Readonly<TodoIntake> {
  try {
    return createTodoIntake(
      intakeDraft(input, config, authorityRefs, todoId),
      { clock: () => createdAt },
    );
  } catch (error: unknown) {
    if (error instanceof TodoIntakeError) fail("authority", error);
    throw error;
  }
}

function allocateTodoId(
  factory: UuidV4Factory | undefined,
): WakeflowDurableId<"todo"> {
  try {
    return createWakeflowDurableId("todo", createUuidV4(factory));
  } catch (error: unknown) {
    if (error instanceof UuidV4Error) fail("identity", error);
    throw error;
  }
}

function recordedAt(clock: UtcWallClock | undefined): UtcInstant {
  try {
    return readUtcWallClock(clock);
  } catch (error: unknown) {
    if (error instanceof UtcWallClockError) fail("time", error);
    throw error;
  }
}

function sameConfig(
  left: Readonly<WakeflowConfigAuthoritySnapshot>,
  right: Readonly<WakeflowConfigAuthoritySnapshot>,
): boolean {
  return left.configDigest === right.configDigest
    && left.source.digest === right.source.digest
    && left.workspaceRoot === right.workspaceRoot
    && left.ledgerRoot === right.ledgerRoot;
}

export class TodoIntakePublicationPlanningService {
  readonly #workspaceRoot: RootedDirectory;

  constructor(workspaceRoot: RootedDirectory) {
    if (
      typeof workspaceRoot !== "object"
      || workspaceRoot === null
      || types.isProxy(workspaceRoot)
      || !(workspaceRoot instanceof RootedDirectory)
    ) {
      fail("input");
    }
    this.#workspaceRoot = workspaceRoot;
  }

  /** 从当前三类权威生成一份零写、owner-derived Intake计划。 */
  async preview(
    inputValue: unknown,
    optionsValue: TodoIntakePublicationPreviewOptions = {},
  ): Promise<Readonly<TodoIntakePublicationPreviewResult>> {
    let input;
    let options;
    try {
      input = parseTodoIntakePublicationInput(inputValue);
      options = parseOptions(optionsValue);
      assertNotAborted(options.signal);
    } catch (error: unknown) {
      if (error instanceof TodoIntakePublicationInputError) {
        fail("input", error);
      }
      throw error;
    }
    const config = await readConfig(this.#workspaceRoot, options.signal);
    if (config.indexes.windowById[input.originWindowId] === undefined) {
      fail("config");
    }
    const collection = await readCollection(this.#workspaceRoot, options.signal);
    const ledgerRoot = await openLedgerRoot(config);
    let authorityRefs:
      readonly [
        Readonly<LedgerAuthorityMemberReference>,
        ...Readonly<LedgerAuthorityMemberReference>[],
      ] | undefined;
    let failure: unknown;
    try {
      authorityRefs = await selectAuthority(
        ledgerRoot,
        config,
        input,
        options.signal,
      );
      createIntake(input, config, authorityRefs, DRAFT_TODO_ID, DRAFT_TIME);
    } catch (error: unknown) {
      failure = error;
    }
    try {
      await ledgerRoot.close();
    } catch (error: unknown) {
      if (failure === undefined) failure = error;
    }
    if (failure !== undefined) throw failure;
    if (authorityRefs === undefined) fail("operation-failure");

    const [currentConfig, currentCollection] = await Promise.all([
      readConfig(this.#workspaceRoot, options.signal),
      readCollection(this.#workspaceRoot, options.signal),
    ]);
    if (
      !sameConfig(config, currentConfig)
      || currentCollection.collection.collectionDigest
        !== collection.collection.collectionDigest
    ) {
      fail("conflict");
    }
    assertNotAborted(options.signal);
    const todoId = allocateTodoId(options.uuidFactory);
    if (currentCollection.items.some((item) => item.todoId === todoId)) {
      fail("identity");
    }
    const targetIntake = createIntake(
      input,
      currentConfig,
      authorityRefs,
      todoId,
      recordedAt(options.clock),
    );
    let plan;
    try {
      plan = createTodoIntakePublicationPlan({
        configDigest: currentConfig.configDigest,
        expectedCollectionDigest: currentCollection.collection.collectionDigest,
        targetIntake,
      });
    } catch (error: unknown) {
      if (error instanceof TodoIntakePublicationPlanError) fail("plan", error);
      throw error;
    }
    return Object.freeze({
      plan,
      planDigest: computeTodoIntakePublicationPlanDigest(plan),
    });
  }
}
