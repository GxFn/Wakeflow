import { types } from "node:util";

import {
  readWakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
  type WakeflowConfigAuthoritySnapshot,
} from "../../../configuration/wakeflow-config-authority-snapshot.js";
import {
  createWakeflowDurableId,
  parseWakeflowDurableId,
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableId,
} from "../../../contracts/identity/wakeflow-durable-id.js";
import type { Sha256Digest } from "../../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../../foundation/data/passive-own-data.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../../foundation/filesystem/rooted-directory.js";
import {
  createUuidV4,
  UuidV4Error,
  type UuidV4Factory,
} from "../../../foundation/identity/uuid-v4.js";
import {
  parseUtcInstant,
  type UtcInstant,
} from "../../../foundation/time/utc-instant.js";
import {
  readUtcWallClock,
  UtcWallClockError,
  type UtcWallClock,
} from "../../../foundation/time/wall-clock.js";
import {
  createDemandAuthority,
  DemandAuthorityError,
  type DemandAuthority,
} from "../model/demand-authority.js";
import {
  createDemandIdentity,
  DemandIdentityError,
  type DemandExecutionPlacement,
  type DemandIdentity,
} from "../model/demand-identity.js";
import {
  createLedgerAuthorityMemberReference,
  LedgerAuthorityStore,
  LedgerAuthorityStoreError,
  type LedgerAuthorityMemberReference,
  type LoadedLedgerAuthorityRecord,
} from "../../ledger/ledger-authority-store.js";
import type { StoredTodoCollectionItem } from "../../todo/todo-collection-authority.js";
import {
  inspectTodoItems,
  TodoCollectionServiceError,
} from "../../todo/todo-collection-service.js";
import {
  parseTodoIntakeLineageReference,
  TodoIntakeLineageError,
  type TodoIntakeLineageReference,
} from "../../todo/todo-intake-lineage.js";
import {
  parseDemandEventSourcingPublicationPreviewRequest,
  DemandEventSourcingPublicationInputError,
  type DemandEventSourcingPublicationAuthorityMemberSelection,
  type DemandEventSourcingPublicationPreviewRequest,
} from "./demand-event-sourcing-publication-input.js";
import {
  computeDemandEventSourcingPublicationTransactionDigest,
  createDemandEventSourcingPublicationTransaction,
  DemandEventSourcingPublicationTransactionError,
  type DemandEventSourcingPublicationTransaction,
} from "./demand-event-sourcing-publication-transaction.js";
import {
  demandFinalRootRef,
  demandPublicationLockRef,
  demandPublicationStageRef,
  demandPublicationTransactionRef,
} from "./demand-publication-paths.js";

/**
 * Wakeflow Governance / Demand Event Sourcing Publication：零写Preview计划职责所有者。
 *
 * Service持有一次调用范围外已打开的Workspace根；每次Preview仍重新读取Config、TODO和
 * Ledger。调用方只选择上游事实，Service派生完整Identity、Authority、revision 1事务和
 * 摘要。既有Publication执行Service继续独占sidecar、stage、Demand根与TODO claim副作用。
 */

export interface DemandEventSourcingPublicationPreviewOptions {
  readonly clock?: UtcWallClock;
  readonly uuidFactory?: UuidV4Factory;
  readonly signal?: AbortSignal;
}

export interface DemandEventSourcingPublicationPreviewResult {
  /** 现有自包含Publication transaction就是Apply与Recovery共用的完整计划。 */
  readonly plan: Readonly<DemandEventSourcingPublicationTransaction>;
  readonly planDigest: Sha256Digest;
}

export type DemandEventSourcingPublicationPlanningServiceErrorReason =
  | "input"
  | "identity"
  | "time"
  | "config"
  | "todo"
  | "authority"
  | "conflict"
  | "root"
  | "plan"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Demand Event Sourcing publication planning input is invalid.",
  identity: "Demand Event Sourcing publication identity allocation failed.",
  time: "Demand Event Sourcing publication time allocation failed.",
  config: "Demand Event Sourcing publication Config authority is invalid.",
  todo: "Demand Event Sourcing publication TODO authority is invalid.",
  authority: "Demand Event Sourcing publication Ledger authority is invalid.",
  conflict: "Demand Event Sourcing publication identity is already occupied.",
  root: "Demand Event Sourcing publication root could not be held safely.",
  plan: "Demand Event Sourcing publication plan could not be closed.",
  aborted: "Demand Event Sourcing publication planning was aborted.",
  "operation-failure": "Demand Event Sourcing publication planning failed.",
} as const satisfies Readonly<
  Record<DemandEventSourcingPublicationPlanningServiceErrorReason, string>
>;

/** Preview无法从当前权威形成一份零写计划时返回的稳定、脱敏错误。 */
export class DemandEventSourcingPublicationPlanningServiceError extends Error {
  override readonly name = "DemandEventSourcingPublicationPlanningServiceError";
  readonly code =
    "wakeflow-demand-event-sourcing-publication-planning-service" as const;
  readonly reason: DemandEventSourcingPublicationPlanningServiceErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;

  constructor(
    reason: DemandEventSourcingPublicationPlanningServiceErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
  }
}

interface ParsedPreviewOptions {
  readonly clock: UtcWallClock | undefined;
  readonly uuidFactory: UuidV4Factory | undefined;
  readonly signal: AbortSignal | undefined;
}

interface PendingTodoSource {
  readonly item: Readonly<StoredTodoCollectionItem>;
  readonly lineage: Readonly<TodoIntakeLineageReference>;
  readonly collectionDigest: Sha256Digest;
}

interface SelectedAuthority {
  readonly references: readonly [
    Readonly<LedgerAuthorityMemberReference>,
    ...Readonly<LedgerAuthorityMemberReference>[],
  ];
  readonly referenceBySelection: ReadonlyMap<
    string,
    Readonly<LedgerAuthorityMemberReference>
  >;
  readonly confirmationDemandId: WakeflowDurableId<"demand"> | null;
}

const DRAFT_VALIDATION_DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_00000000-0000-4000-8000-000000000000",
  "demand",
);
const DRAFT_VALIDATION_INSTANT = parseUtcInstant("1970-01-01T00:00:00.000Z");

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
  reason: DemandEventSourcingPublicationPlanningServiceErrorReason,
  cause?: unknown,
): never {
  throw new DemandEventSourcingPublicationPlanningServiceError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
  );
}

function parseOptions(value: unknown): Readonly<ParsedPreviewOptions> {
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
    ) ||
    (record.clock !== undefined &&
      (typeof record.clock !== "function" || types.isProxy(record.clock))) ||
    (record.uuidFactory !== undefined &&
      (typeof record.uuidFactory !== "function" ||
        types.isProxy(record.uuidFactory))) ||
    (record.signal !== undefined &&
      (typeof record.signal !== "object" ||
        record.signal === null ||
        types.isProxy(record.signal) ||
        !(record.signal instanceof AbortSignal)))
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

async function readPendingTodo(
  root: RootedDirectory,
  request: Readonly<DemandEventSourcingPublicationPreviewRequest>,
  signal: AbortSignal | undefined,
): Promise<Readonly<PendingTodoSource>> {
  let snapshot;
  try {
    snapshot = await inspectTodoItems(root, signal);
  } catch (error: unknown) {
    if (error instanceof TodoCollectionServiceError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("todo", error);
    }
    throw error;
  }
  const item = snapshot.items.find(
    (candidate) => candidate.todoId === request.todoId,
  );
  if (item === undefined || item.state.status !== "pending-claim") {
    fail("todo");
  }
  let lineage;
  try {
    lineage = parseTodoIntakeLineageReference({
      artifactKind: "wakeflow-todo-intake-lineage",
      schemaVersion: 1,
      todoId: item.todoId,
      intakeRef: item.intakeSource.resourcePath,
      intakeDigest: item.intakeDigest,
    });
  } catch (error: unknown) {
    if (error instanceof TodoIntakeLineageError) fail("todo", error);
    throw error;
  }
  return Object.freeze({
    item,
    lineage,
    collectionDigest: snapshot.collection.collectionDigest,
  });
}

function selectionKey(
  value: Readonly<DemandEventSourcingPublicationAuthorityMemberSelection>,
): string {
  return `${value.recordId}\u0000${value.memberPath}`;
}

async function loadSelectedRecord(
  store: LedgerAuthorityStore,
  selection: Readonly<DemandEventSourcingPublicationAuthorityMemberSelection>,
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
  store: LedgerAuthorityStore,
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  request: Readonly<DemandEventSourcingPublicationPreviewRequest>,
  signal: AbortSignal | undefined,
): Promise<Readonly<SelectedAuthority>> {
  const loadedByRecordId = new Map<
    string,
    Readonly<LoadedLedgerAuthorityRecord>
  >();
  const references: LedgerAuthorityMemberReference[] = [];
  const referenceBySelection = new Map<
    string,
    Readonly<LedgerAuthorityMemberReference>
  >();
  let confirmationDemandId: WakeflowDurableId<"demand"> | null = null;

  for (const selection of request.authorityMembers) {
    let loaded = loadedByRecordId.get(selection.recordId);
    if (loaded === undefined) {
      loaded = await loadSelectedRecord(store, selection, signal);
      loadedByRecordId.set(selection.recordId, loaded);
      if (loaded.record.programId !== config.model.program.programId) {
        fail("authority");
      }
      if (loaded.record.artifactKind === "wakeflow-confirmation-record") {
        if (
          confirmationDemandId !== null &&
          confirmationDemandId !== loaded.record.demandId
        ) {
          fail("authority");
        }
        confirmationDemandId = loaded.record.demandId;
      }
    }
    let reference;
    try {
      reference = createLedgerAuthorityMemberReference(
        loaded,
        selection.memberPath,
      );
    } catch (error: unknown) {
      if (error instanceof LedgerAuthorityStoreError) {
        fail("authority", error);
      }
      throw error;
    }
    references.push(reference);
    referenceBySelection.set(selectionKey(selection), reference);
  }

  const first = references[0];
  if (first === undefined) fail("authority");
  const closedReferences: SelectedAuthority["references"] = Object.freeze([
    first,
    ...references.slice(1),
  ]);
  return Object.freeze({
    references: closedReferences,
    referenceBySelection,
    confirmationDemandId,
  });
}

function executionPlacement(
  request: Readonly<DemandEventSourcingPublicationPreviewRequest>,
  selected: Readonly<SelectedAuthority>,
): DemandExecutionPlacement {
  const placement = request.demand.executionPlacement;
  if (placement.mode === "main") return Object.freeze({ mode: "main" });
  const authorizationRef = selected.referenceBySelection.get(
    selectionKey(placement.authorizationMember),
  );
  if (
    authorizationRef === undefined ||
    authorizationRef.family !== "confirmation"
  ) {
    fail("authority");
  }
  return Object.freeze({
    mode: "isolated" as const,
    authorizationRef,
  });
}

function testingDecision(
  todo: Readonly<PendingTodoSource>,
  selected: Readonly<SelectedAuthority>,
) {
  const source = todo.item.intake.testingDecision;
  const environmentRef = selected.references.find(
    (reference) => reference.role === "test-environment",
  );
  return Object.freeze({
    mode: source.mode,
    summary: source.summary,
    environmentMemberRef:
      source.mode === "real-environment"
        ? (environmentRef?.memberRef ?? null)
        : null,
  });
}

function createIdentityAndAuthority(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  request: Readonly<DemandEventSourcingPublicationPreviewRequest>,
  todo: Readonly<PendingTodoSource>,
  selected: Readonly<SelectedAuthority>,
  demandId: WakeflowDurableId<"demand">,
  createdAt: UtcInstant,
): Readonly<{
  readonly identity: Readonly<DemandIdentity>;
  readonly authority: Readonly<DemandAuthority>;
}> {
  let identity;
  let authority;
  try {
    identity = createDemandIdentity(
      {
        programId: config.model.program.programId,
        demandId,
        title: request.demand.title,
        goal: request.demand.goal,
        completionDefinition: request.demand.completionDefinition,
        demandType: todo.item.intake.type,
        source: todo.lineage,
        executionPlacement: executionPlacement(request, selected),
      },
      { clock: () => createdAt },
    );
    authority = createDemandAuthority(identity, {
      authorityRefs: selected.references,
      testingDecision: testingDecision(todo, selected),
    });
  } catch (error: unknown) {
    if (
      error instanceof DemandIdentityError ||
      error instanceof DemandAuthorityError
    ) {
      fail("authority", error);
    }
    throw error;
  }
  return Object.freeze({ identity, authority });
}

function allocateId<
  Kind extends "demand" | "demand-event" | "demand-event-commit",
>(
  kind: Kind,
  factory: UuidV4Factory | undefined,
  seen: Set<string>,
): WakeflowDurableId<Kind> {
  let uuid;
  try {
    uuid = createUuidV4(factory);
  } catch (error: unknown) {
    if (error instanceof UuidV4Error) fail("identity", error);
    throw error;
  }
  if (seen.has(uuid)) fail("identity");
  seen.add(uuid);
  return createWakeflowDurableId(kind, uuid);
}

async function resourceExists(
  root: RootedDirectory,
  ref: ReturnType<typeof demandFinalRootRef>,
): Promise<boolean> {
  try {
    await root.inspectExistingResource(ref);
    return true;
  } catch (error: unknown) {
    if (
      error instanceof RootedDirectoryError &&
      error.reason === "resource-not-found"
    ) {
      return false;
    }
    if (error instanceof RootedDirectoryError) fail("root", error);
    throw error;
  }
}

async function assertDemandIdentityAvailable(
  root: RootedDirectory,
  demandId: WakeflowDurableId<"demand">,
): Promise<void> {
  for (const ref of [
    demandFinalRootRef(demandId),
    demandPublicationStageRef(demandId),
    demandPublicationTransactionRef(demandId),
    demandPublicationLockRef(demandId),
  ]) {
    if (await resourceExists(root, ref)) fail("conflict");
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

async function closeLedgerRoot(root: RootedDirectory): Promise<void> {
  try {
    await root.close();
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root", error);
    throw error;
  }
}

export class DemandEventSourcingPublicationPlanningService {
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

  /** 从当前Config、TODO与Ledger零写生成完整revision 1发布计划。 */
  async preview(
    requestValue: unknown,
    optionsValue: DemandEventSourcingPublicationPreviewOptions = {},
  ): Promise<Readonly<DemandEventSourcingPublicationPreviewResult>> {
    let request;
    let options;
    try {
      request = parseDemandEventSourcingPublicationPreviewRequest(requestValue);
      options = parseOptions(optionsValue);
      assertNotAborted(options.signal);
    } catch (error: unknown) {
      if (error instanceof DemandEventSourcingPublicationInputError) {
        fail("input", error);
      }
      throw error;
    }

    const config = await readConfig(this.#workspaceRoot, options.signal);
    const todo = await readPendingTodo(
      this.#workspaceRoot,
      request,
      options.signal,
    );
    const ledgerRoot = await openLedgerRoot(config);
    let result:
      Readonly<DemandEventSourcingPublicationPreviewResult> | undefined;
    let failure: unknown;
    try {
      const selected = await selectAuthority(
        new LedgerAuthorityStore(ledgerRoot),
        config,
        request,
        options.signal,
      );

      // 使用不发布的固定身份和时间先关闭全部role/testing/placement关系；已知冲突不消费外部Factory或Clock。
      createIdentityAndAuthority(
        config,
        request,
        todo,
        selected,
        selected.confirmationDemandId ?? DRAFT_VALIDATION_DEMAND_ID,
        DRAFT_VALIDATION_INSTANT,
      );

      assertNotAborted(options.signal);
      const seenUuids = new Set<string>();
      const demandId =
        selected.confirmationDemandId ??
        allocateId("demand", options.uuidFactory, seenUuids);
      if (selected.confirmationDemandId !== null) {
        seenUuids.add(parseWakeflowDurableId(demandId).uuid);
      }
      await assertDemandIdentityAvailable(this.#workspaceRoot, demandId);
      const eventId = allocateId(
        "demand-event",
        options.uuidFactory,
        seenUuids,
      );
      const commitId = allocateId(
        "demand-event-commit",
        options.uuidFactory,
        seenUuids,
      );
      const time = recordedAt(options.clock);
      const { identity, authority } = createIdentityAndAuthority(
        config,
        request,
        todo,
        selected,
        demandId,
        time,
      );
      let plan;
      try {
        plan = createDemandEventSourcingPublicationTransaction({
          identity,
          authority,
          eventId,
          commitId,
          recordedAt: time,
          expectedTodoStateDigest: todo.item.stateDigest,
          expectedTodoCollectionDigest: todo.collectionDigest,
        });
      } catch (error: unknown) {
        if (error instanceof DemandEventSourcingPublicationTransactionError) {
          fail("plan", error);
        }
        throw error;
      }
      result = Object.freeze({
        plan,
        planDigest:
          computeDemandEventSourcingPublicationTransactionDigest(plan),
      });
    } catch (error: unknown) {
      failure = error;
    }
    try {
      await closeLedgerRoot(ledgerRoot);
    } catch (error: unknown) {
      if (failure === undefined) failure = error;
    }
    if (failure !== undefined) throw failure;
    if (result === undefined) fail("operation-failure");
    return result;
  }
}
