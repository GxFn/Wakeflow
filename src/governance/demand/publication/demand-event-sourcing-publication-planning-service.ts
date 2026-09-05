import { types } from "node:util";

import {
  readWakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
  type WakeflowConfigAuthoritySnapshot,
} from "../../../configuration/wakeflow-config-authority-snapshot.js";
import {
  createWakeflowDurableId,
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
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
import { WakeflowError } from "../../../kernel/error.js";
import {
  listRequirementClaimStates,
  readRequirementClaimState,
  type RequirementClaimState,
  type RequirementClaimStateSource,
} from "../../../kernel/requirement-board.js";
import {
  closeDemandOperationRoot,
  DemandOperationAuthorityContextError,
  openDemandOperationRoot,
} from "../demand-operation-authority-context.js";
import {
  DemandEventSourcingRepository,
  DemandEventSourcingRepositoryError,
} from "../event-sourcing/demand-event-sourcing-repository.js";
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
  parseRequirementLineageReference,
  RequirementLineageError,
  type RequirementLineageReference,
} from "../model/requirement-lineage.js";
import {
  createLedgerAuthorityMemberReference,
  LedgerAuthorityStore,
  LedgerAuthorityStoreError,
  type LedgerAuthorityMemberReference,
} from "../../ledger/ledger-authority-store.js";
import {
  parseDemandEventSourcingPublicationPreviewRequest,
  DemandEventSourcingPublicationInputError,
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
 * Service持有一次调用范围外已打开的Workspace根；每次Preview仍重新读取Config、看板认领
 * 状态和Ledger需求包记录。调用方只选择需求包并编写Demand语义，Service派生完整Identity、
 * Authority、revision 1事务和摘要：Demand类型与测试决定来自需求包记录头部，权威成员
 * 集合是记录的全部成员，来源谱系绑定记录引用与摘要（ADR-0011 D7）。总控同一时刻只允许
 * 一个活动Demand：看板上任一`claimed`包对应的Demand未到终态即拒绝。既有Publication执行
 * Service继续独占sidecar、stage、Demand根与看板认领副作用。
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
  | "board"
  | "active-demand-exists"
  | "isolated-placement-retired"
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
  board:
    "Demand Event Sourcing publication requirement package is not pending on the board.",
  "active-demand-exists":
    "Demand Event Sourcing publication is refused while another Demand is active.",
  "isolated-placement-retired":
    "Demand Event Sourcing publication no longer supports isolated execution placement.",
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

type LoadedRequirementPackage = Awaited<
  ReturnType<LedgerAuthorityStore["loadRequirement"]>
>;

interface PackageSource {
  readonly claim: Readonly<RequirementClaimStateSource>;
  readonly loaded: Readonly<LoadedRequirementPackage>;
  readonly lineage: Readonly<RequirementLineageReference>;
  readonly references: readonly [
    Readonly<LedgerAuthorityMemberReference>,
    ...Readonly<LedgerAuthorityMemberReference>[],
  ];
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

function mapBoardError(error: unknown): never {
  if (error instanceof WakeflowError) {
    if (error.reason.endsWith("-aborted")) fail("aborted", error);
    fail("board", error);
  }
  throw error;
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

/** 需求包必须以 `pending` 状态在看板上，其摘要就是计划里的认领前序。 */
async function readPendingClaim(
  root: RootedDirectory,
  request: Readonly<DemandEventSourcingPublicationPreviewRequest>,
  signal: AbortSignal | undefined,
): Promise<Readonly<RequirementClaimStateSource>> {
  let source: Readonly<RequirementClaimStateSource> | null;
  try {
    source = await readRequirementClaimState(root, request.requirementId, signal);
  } catch (error: unknown) {
    mapBoardError(error);
  }
  if (source === null || source.state.status !== "pending") fail("board");
  return source;
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

/** 一个已认领包对应的 Demand 根存在且聚合未到终态即为活动 Demand；根无法证明终态时同样视为活动。 */
async function demandIsActive(
  root: RootedDirectory,
  state: RequirementClaimState,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  if (state.claim === null) return false;
  let demandId: WakeflowDurableId<"demand">;
  try {
    demandId = parseWakeflowDurableIdOfKind(state.claim.demandId, "demand");
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("board", error);
    throw error;
  }
  if (!(await resourceExists(root, demandFinalRootRef(demandId)))) return false;
  let demandRoot: RootedDirectory;
  try {
    demandRoot = await openDemandOperationRoot(root, demandId);
  } catch (error: unknown) {
    if (error instanceof DemandOperationAuthorityContextError) return true;
    throw error;
  }
  let active = true;
  let failure: unknown;
  try {
    const loaded = await new DemandEventSourcingRepository(demandRoot).load(
      signal === undefined ? undefined : { signal },
    );
    if (loaded !== null) {
      const lifecycle = loaded.aggregate.state.lifecycle;
      active = lifecycle !== "completed" && lifecycle !== "cancelled";
    }
  } catch (error: unknown) {
    if (
      error instanceof DemandEventSourcingRepositoryError &&
      error.reason === "aborted"
    ) {
      failure = error;
    }
  }
  try {
    await closeDemandOperationRoot(demandRoot);
  } catch (error: unknown) {
    if (failure === undefined) failure = error;
  }
  if (failure !== undefined) {
    if (failure instanceof DemandEventSourcingRepositoryError) {
      fail("aborted", failure);
    }
    if (failure instanceof DemandOperationAuthorityContextError) {
      fail("root", failure);
    }
    throw failure;
  }
  return active;
}

/** ADR-0011 D7：总控已有活动 Demand 时拒绝再认领任何需求包。preview 与 apply 都检查。 */
export async function assertNoActiveDemand(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<void> {
  let states: readonly RequirementClaimState[];
  try {
    states = (await listRequirementClaimStates(root, signal)).states;
  } catch (error: unknown) {
    mapBoardError(error);
  }
  for (const state of states) {
    if (state.status !== "claimed") continue;
    if (await demandIsActive(root, state, signal)) fail("active-demand-exists");
  }
}

async function loadPackageRecord(
  store: LedgerAuthorityStore,
  requirementId: WakeflowDurableId<"requirement">,
  signal: AbortSignal | undefined,
): Promise<Readonly<LoadedRequirementPackage>> {
  try {
    return await store.loadRequirement(
      requirementId,
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

/** 需求包记录必须属于当前 Program 且与看板状态绑定同一记录摘要；全部成员进入权威闭包。 */
async function loadPackageSource(
  store: LedgerAuthorityStore,
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  claim: Readonly<RequirementClaimStateSource>,
  signal: AbortSignal | undefined,
): Promise<Readonly<PackageSource>> {
  const requirementId = parseWakeflowDurableIdOfKind(
    claim.state.requirementId,
    "requirement",
  );
  const loaded = await loadPackageRecord(store, requirementId, signal);
  if (loaded.record.programId !== config.model.program.programId) {
    fail("authority");
  }
  if (
    loaded.recordDigest !== claim.state.recordDigest ||
    loaded.record.programId !== claim.state.programId
  ) {
    fail("board");
  }
  let lineage: Readonly<RequirementLineageReference>;
  try {
    lineage = parseRequirementLineageReference({
      artifactKind: "wakeflow-requirement-lineage",
      schemaVersion: 1,
      requirementId,
      recordRef: loaded.recordRef,
      recordDigest: loaded.recordDigest,
    });
  } catch (error: unknown) {
    if (error instanceof RequirementLineageError) fail("authority", error);
    throw error;
  }
  const references: LedgerAuthorityMemberReference[] = [];
  for (const document of loaded.documents) {
    try {
      references.push(createLedgerAuthorityMemberReference(loaded, document.path));
    } catch (error: unknown) {
      if (error instanceof LedgerAuthorityStoreError) fail("authority", error);
      throw error;
    }
  }
  const first = references[0];
  if (first === undefined) fail("authority");
  const closedReferences: PackageSource["references"] = Object.freeze([
    first,
    ...references.slice(1),
  ]);
  return Object.freeze({ claim, loaded, lineage, references: closedReferences });
}

function executionPlacement(
  request: Readonly<DemandEventSourcingPublicationPreviewRequest>,
): DemandExecutionPlacement {
  if (request.demand.executionPlacement.mode !== "main") {
    // Confirmation 授权已随 ADR-0011 退役；隔离执行位置由 Pod 切片按 ADR-0010 接管。
    fail("isolated-placement-retired");
  }
  return Object.freeze({ mode: "main" });
}

function createIdentityAndAuthority(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  request: Readonly<DemandEventSourcingPublicationPreviewRequest>,
  source: Readonly<PackageSource>,
  demandId: WakeflowDurableId<"demand">,
  createdAt: UtcInstant,
): Readonly<{
  readonly identity: Readonly<DemandIdentity>;
  readonly authority: Readonly<DemandAuthority>;
}> {
  const record = source.loaded.record;
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
        demandType: record.demandType,
        source: source.lineage,
        executionPlacement: executionPlacement(request),
      },
      { clock: () => createdAt },
    );
    authority = createDemandAuthority(identity, {
      authorityRefs: source.references,
      testingDecision: {
        mode: record.testingDecision.mode,
        summary: record.testingDecision.summary,
        environmentMemberRef: null,
      },
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

  /** 从当前Config、看板与Ledger需求包零写生成完整revision 1发布计划。 */
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
    const claim = await readPendingClaim(
      this.#workspaceRoot,
      request,
      options.signal,
    );
    await assertNoActiveDemand(this.#workspaceRoot, options.signal);
    const ledgerRoot = await openLedgerRoot(config);
    let result:
      Readonly<DemandEventSourcingPublicationPreviewResult> | undefined;
    let failure: unknown;
    try {
      const source = await loadPackageSource(
        new LedgerAuthorityStore(ledgerRoot),
        config,
        claim,
        options.signal,
      );

      // 使用不发布的固定身份和时间先关闭全部role/testing/placement关系；已知冲突不消费外部Factory或Clock。
      createIdentityAndAuthority(
        config,
        request,
        source,
        DRAFT_VALIDATION_DEMAND_ID,
        DRAFT_VALIDATION_INSTANT,
      );

      assertNotAborted(options.signal);
      const seenUuids = new Set<string>();
      const demandId = allocateId("demand", options.uuidFactory, seenUuids);
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
        source,
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
          expectedClaimStateDigest: source.claim.digest,
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
