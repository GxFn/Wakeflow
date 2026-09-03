import { types } from "node:util";

import {
  readWakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
  type WakeflowConfigAuthoritySnapshot,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import {
  createWakeflowDurableId,
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { computeSha256Digest, type Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  planDirectoryTreeCandidateFromFileDescriptors,
  DurableDirectoryTreeCandidateError,
  type DirectoryTreeCandidatePlanFile,
} from "../../foundation/filesystem/durable-directory-tree-candidate.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  createUuidV4,
  UuidV4Error,
  type UuidV4Factory,
} from "../../foundation/identity/uuid-v4.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { parseUtcInstant, type UtcInstant } from "../../foundation/time/utc-instant.js";
import {
  readUtcWallClock,
  UtcWallClockError,
  type UtcWallClock,
} from "../../foundation/time/wall-clock.js";
import {
  demandFinalRootRef,
  demandPublicationLockRef,
  demandPublicationStageRef,
  demandPublicationTransactionRef,
} from "../demand/publication/demand-publication-paths.js";
import {
  LEDGER_AUTHORITY_PUBLICATION_MEMBER_MEDIA_TYPE,
  LedgerAuthorityPublicationInputError,
  parseConfirmationAuthorityPublicationInput,
  parseRequirementAuthorityPublicationInput,
  type ConfirmationAuthorityPublicationInput,
  type LedgerAuthorityPublicationInput,
  type RequirementAuthorityPublicationInput,
} from "./ledger-authority-publication-input.js";
import {
  computeLedgerAuthorityPublicationPlanDigest,
  createLedgerAuthorityPublicationPlan,
  LedgerAuthorityPublicationPlanError,
  type LedgerAuthorityPublicationPlan,
} from "./ledger-authority-publication-plan.js";
import {
  createConfirmationRecord,
  createRequirementRecord,
  renderLedgerAuthorityRecord,
  LedgerAuthorityRecordError,
  type ConfirmationDocumentRole,
  type LedgerAuthorityRecord,
  type RequirementDocumentRole,
} from "./ledger-authority-record.js";
import {
  captureLedgerAuthorityPublicationSource,
  revalidateLedgerAuthorityPublicationSource,
  LedgerAuthorityPublicationSourceError,
  type LedgerAuthorityPublicationSourceSnapshot,
} from "./ledger-authority-publication-source.js";
import { LedgerAuthorityStore, LedgerAuthorityStoreError } from "./ledger-authority-store.js";
import {
  createLedgerRecordPublicationIntent,
  renderLedgerRecordPublicationIntent,
  LedgerRecordPublicationIntentError,
  type LedgerRecordPublicationIntent,
} from "./ledger-record-publication-intent.js";
import {
  LEDGER_AUTHORITY_MAXIMUM_TREE_DEPTH,
  LEDGER_AUTHORITY_MAXIMUM_TREE_ENTRIES,
  LEDGER_AUTHORITY_MAXIMUM_TREE_FILES,
  LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES,
  LEDGER_AUTHORITY_RECORD_MAXIMUM_BYTES,
  LEDGER_AUTHORITY_TREE_MAXIMUM_BYTES,
  LEDGER_DURABLE_DIRECTORY_MODE,
  LEDGER_DURABLE_FILE_MODE,
  LEDGER_PUBLICATION_INTENT_MAXIMUM_BYTES,
} from "./ledger-authority-storage-policy.js";

/**
 * Wakeflow Governance / Ledger：Design Markdown到不可变权威记录的零写Planning owner。
 *
 * Service每次重新读取当前Config，只接受其唯一Design窗口绑定的support surface；随后
 * 稳定读取严格Markdown，生成size/digest描述符，并在身份分配后再次按原节点与摘要
 * 复验全部成员。它只返回Record、compact Intent和Plan摘要，不创建Ledger stage、意图
 * 文件、最终目录或未来Demand根。Application必须重新读取并复验相同source描述符。
 */

export interface LedgerAuthorityPublicationPlanningOptions {
  readonly clock?: UtcWallClock;
  readonly uuidFactory?: UuidV4Factory;
  readonly signal?: AbortSignal;
}

export interface LedgerAuthorityPublicationPreviewResult {
  readonly plan: Readonly<LedgerAuthorityPublicationPlan>;
  readonly planDigest: Sha256Digest;
}

export type LedgerAuthorityPublicationPlanningServiceErrorReason =
  | "input"
  | "config"
  | "source-root"
  | "source"
  | "source-profile"
  | "source-changed"
  | "capacity"
  | "identity"
  | "time"
  | "ledger"
  | "conflict"
  | "plan"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Ledger authority publication planning input is invalid.",
  config: "Ledger authority publication planning Config authority is invalid.",
  "source-root": "Ledger authority publication Design source root is invalid.",
  source: "Ledger authority publication source is unavailable or unsafe.",
  "source-profile": "Ledger authority publication source is not strict Markdown text.",
  "source-changed": "Ledger authority publication source changed during planning.",
  capacity: "Ledger authority publication source exceeds its bounded capacity.",
  identity: "Ledger authority publication identity allocation failed.",
  time: "Ledger authority publication recording time failed.",
  ledger: "Ledger authority publication Ledger layout is unavailable or unsafe.",
  conflict: "Ledger authority publication identity is already occupied.",
  plan: "Ledger authority publication plan could not be closed.",
  aborted: "Ledger authority publication planning was aborted.",
  "operation-failure": "Ledger authority publication planning failed.",
} as const satisfies Readonly<Record<
  LedgerAuthorityPublicationPlanningServiceErrorReason,
  string
>>;

/** 零写Planning无法从当前Config和Design source形成关闭计划时的稳定错误。 */
export class LedgerAuthorityPublicationPlanningServiceError extends Error {
  override readonly name = "LedgerAuthorityPublicationPlanningServiceError";
  readonly code = "wakeflow-ledger-authority-publication-planning-service" as const;
  readonly reason: LedgerAuthorityPublicationPlanningServiceErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;

  constructor(
    reason: LedgerAuthorityPublicationPlanningServiceErrorReason,
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

type AllocatedAuthorityIdentity =
  | Readonly<{
      readonly family: "requirement";
      readonly requirementId: WakeflowDurableId<"requirement">;
    }>
  | Readonly<{
      readonly family: "confirmation";
      readonly confirmationId: WakeflowDurableId<"confirmation">;
      readonly demandId: WakeflowDurableId<"demand">;
    }>;

const DRAFT_VALIDATION_INSTANT = parseUtcInstant("1970-01-01T00:00:00.000Z");
const DRAFT_VALIDATION_REQUIREMENT_ID = parseWakeflowDurableIdOfKind(
  "requirement_00000000-0000-4000-8000-000000000001",
  "requirement",
);
const DRAFT_VALIDATION_CONFIRMATION_ID = parseWakeflowDurableIdOfKind(
  "confirmation_00000000-0000-4000-8000-000000000002",
  "confirmation",
);
const DRAFT_VALIDATION_DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_00000000-0000-4000-8000-000000000003",
  "demand",
);

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
  reason: LedgerAuthorityPublicationPlanningServiceErrorReason,
  cause?: unknown,
): never {
  throw new LedgerAuthorityPublicationPlanningServiceError(
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
      fail("config", error);
    }
    throw error;
  }
}

function mapSourceError(error: LedgerAuthorityPublicationSourceError): never {
  fail(error.reason, error);
}

async function captureSource(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  input: Readonly<LedgerAuthorityPublicationInput>,
  signal: AbortSignal | undefined,
): Promise<Readonly<LedgerAuthorityPublicationSourceSnapshot>> {
  try {
    return await captureLedgerAuthorityPublicationSource(
      config,
      input,
      signal,
    );
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityPublicationSourceError) {
      mapSourceError(error);
    }
    throw error;
  }
}

async function revalidateSource(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  input: Readonly<LedgerAuthorityPublicationInput>,
  source: Readonly<LedgerAuthorityPublicationSourceSnapshot>,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await revalidateLedgerAuthorityPublicationSource(
      config,
      input,
      source,
      signal,
    );
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityPublicationSourceError) {
      mapSourceError(error);
    }
    throw error;
  }
}

async function assertConfigCurrent(
  root: RootedDirectory,
  expected: Readonly<WakeflowConfigAuthoritySnapshot>,
  signal: AbortSignal | undefined,
): Promise<void> {
  const current = await readConfig(root, signal);
  if (
    current.workspaceRoot !== expected.workspaceRoot
    || current.configDigest !== expected.configDigest
    || current.source.digest !== expected.source.digest
    || current.ledgerRoot !== expected.ledgerRoot
  ) {
    fail("config");
  }
}

async function openLedgerRoot(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
): Promise<RootedDirectory> {
  const placement = config.placements.roots.find(
    (entry) => entry.key === "ledger.root",
  );
  if (
    placement === undefined
    || placement.state !== "present"
    || placement.realPath === null
  ) {
    fail("ledger");
  }
  let root: RootedDirectory | undefined;
  try {
    root = await RootedDirectory.open(placement.absolutePath, "$ledgerRoot");
    if (root.absolutePath !== placement.realPath) fail("ledger");
    return root;
  } catch (error: unknown) {
    if (root !== undefined) {
      try {
        await root.close();
      } catch {
        // 首个Ledger根关系错误优先。
      }
    }
    if (error instanceof LedgerAuthorityPublicationPlanningServiceError) {
      throw error;
    }
    if (error instanceof RootedDirectoryError) fail("ledger", error);
    throw error;
  }
}

async function assertLedgerLayoutCurrent(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    const layout = await new LedgerAuthorityStore(root).inspectLayout(
      signal === undefined ? undefined : { signal },
    );
    if (layout.status !== "current") fail("ledger");
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityPublicationPlanningServiceError) {
      throw error;
    }
    if (error instanceof LedgerAuthorityStoreError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("ledger", error);
    }
    throw error;
  }
}

function validationIdentity(
  family: LedgerAuthorityPublicationInput["family"],
): AllocatedAuthorityIdentity {
  return family === "requirement"
    ? Object.freeze({
        family: "requirement" as const,
        requirementId: DRAFT_VALIDATION_REQUIREMENT_ID,
      })
    : Object.freeze({
        family: "confirmation" as const,
        confirmationId: DRAFT_VALIDATION_CONFIRMATION_ID,
        demandId: DRAFT_VALIDATION_DEMAND_ID,
      });
}

function allocateTypedId<Kind extends "requirement" | "confirmation" | "demand">(
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

function allocateIdentity(
  family: LedgerAuthorityPublicationInput["family"],
  factory: UuidV4Factory | undefined,
): AllocatedAuthorityIdentity {
  const seen = new Set<string>();
  return family === "requirement"
    ? Object.freeze({
        family: "requirement" as const,
        requirementId: allocateTypedId("requirement", factory, seen),
      })
    : Object.freeze({
        family: "confirmation" as const,
        confirmationId: allocateTypedId("confirmation", factory, seen),
        demandId: allocateTypedId("demand", factory, seen),
      });
}

function createRecord(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  input: Readonly<LedgerAuthorityPublicationInput>,
  documents: LedgerAuthorityPublicationSourceSnapshot["documents"],
  identity: AllocatedAuthorityIdentity,
  recordedAt: UtcInstant,
): Readonly<LedgerAuthorityRecord> {
  const descriptors = documents.map((document) => Object.freeze({
    role: document.role,
    path: document.path,
    mediaType: LEDGER_AUTHORITY_PUBLICATION_MEMBER_MEDIA_TYPE,
    digest: document.digest,
  }));
  try {
    if (input.family === "requirement") {
      if (identity.family !== "requirement") fail("plan");
      return createRequirementRecord({
        requirementId: identity.requirementId,
        programId: config.model.program.programId,
        title: input.title,
        documents: descriptors as readonly Readonly<{
          readonly role: RequirementDocumentRole;
          readonly path: PortableResourcePath;
          readonly mediaType: string;
          readonly digest: Sha256Digest;
        }>[],
      }, { clock: () => recordedAt });
    }
    if (identity.family !== "confirmation") fail("plan");
    return createConfirmationRecord({
      confirmationId: identity.confirmationId,
      programId: config.model.program.programId,
      demandId: identity.demandId,
      title: input.title,
      documents: descriptors as readonly Readonly<{
        readonly role: ConfirmationDocumentRole;
        readonly path: PortableResourcePath;
        readonly mediaType: string;
        readonly digest: Sha256Digest;
      }>[],
    }, { clock: () => recordedAt });
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityRecordError) fail("plan", error);
    throw error;
  }
}

function createIntent(
  record: Readonly<LedgerAuthorityRecord>,
  documents: LedgerAuthorityPublicationSourceSnapshot["documents"],
  signal: AbortSignal | undefined,
): Readonly<LedgerRecordPublicationIntent> {
  const recordBytes = encodeUtf8(renderLedgerAuthorityRecord(record));
  if (recordBytes.byteLength > LEDGER_AUTHORITY_RECORD_MAXIMUM_BYTES) {
    fail("capacity");
  }
  const files: DirectoryTreeCandidatePlanFile[] = [{
    path: "record.json" as PortableResourcePath,
    byteCount: parseByteCount(recordBytes.byteLength),
    digest: computeSha256Digest(recordBytes),
    mode: LEDGER_DURABLE_FILE_MODE,
  }, ...documents.map((document) => ({
    path: document.path,
    byteCount: document.byteCount,
    digest: document.digest,
    mode: LEDGER_DURABLE_FILE_MODE,
  }))];
  files.sort((left, right) => (
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  ));
  try {
    const treePlan = planDirectoryTreeCandidateFromFileDescriptors(files, {
      directoryMode: LEDGER_DURABLE_DIRECTORY_MODE,
      maximumDepth: LEDGER_AUTHORITY_MAXIMUM_TREE_DEPTH,
      maximumEntries: LEDGER_AUTHORITY_MAXIMUM_TREE_ENTRIES,
      maximumFileBytes: LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES,
      maximumFiles: LEDGER_AUTHORITY_MAXIMUM_TREE_FILES,
      maximumTotalBytes: LEDGER_AUTHORITY_TREE_MAXIMUM_BYTES,
      ...(signal === undefined ? {} : { signal }),
    });
    const intent = createLedgerRecordPublicationIntent(record, treePlan);
    if (
      encodeUtf8(renderLedgerRecordPublicationIntent(intent)).byteLength
        > LEDGER_PUBLICATION_INTENT_MAXIMUM_BYTES
    ) {
      fail("capacity");
    }
    return intent;
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      if (error.reason === "aborted") fail("aborted", error);
      if (error.reason === "capacity") fail("capacity", error);
      fail("plan", error);
    }
    if (error instanceof LedgerRecordPublicationIntentError) {
      fail("plan", error);
    }
    throw error;
  }
}

function createPlan(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  input: Readonly<LedgerAuthorityPublicationInput>,
  documents: LedgerAuthorityPublicationSourceSnapshot["documents"],
  identity: AllocatedAuthorityIdentity,
  recordedAt: UtcInstant,
  signal: AbortSignal | undefined,
): Readonly<LedgerAuthorityPublicationPlan> {
  const record = createRecord(
    config,
    input,
    documents,
    identity,
    recordedAt,
  );
  const intent = createIntent(record, documents, signal);
  try {
    return createLedgerAuthorityPublicationPlan({
      configDigest: config.configDigest,
      designSurfaceId: input.designSurfaceId,
      intent,
    });
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityPublicationPlanError) {
      fail("plan", error);
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
    if (error instanceof RootedDirectoryError) fail(rootFailure, error);
    throw error;
  }
}

async function assertIdentityAvailable(
  workspaceRoot: RootedDirectory,
  ledgerRoot: RootedDirectory,
  intent: Readonly<LedgerRecordPublicationIntent>,
  identity: AllocatedAuthorityIdentity,
  signal: AbortSignal | undefined,
): Promise<void> {
  for (const ref of [
    intent.finalRootRef,
    intent.intentRef,
    intent.lockRef,
    intent.stageRef,
  ]) {
    assertNotAborted(signal);
    if (await resourceExists(ledgerRoot, ref, "ledger")) fail("conflict");
  }
  if (identity.family !== "confirmation") return;
  for (const ref of [
    demandFinalRootRef(identity.demandId),
    demandPublicationStageRef(identity.demandId),
    demandPublicationTransactionRef(identity.demandId),
    demandPublicationLockRef(identity.demandId),
  ]) {
    assertNotAborted(signal);
    if (await resourceExists(workspaceRoot, ref, "config")) fail("conflict");
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

export class LedgerAuthorityPublicationPlanningService {
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

  /** 从当前Design Markdown零写生成Requirement发布计划。 */
  async previewRequirement(
    inputValue: unknown,
    optionsValue: LedgerAuthorityPublicationPlanningOptions = {},
  ): Promise<Readonly<LedgerAuthorityPublicationPreviewResult>> {
    let input: Readonly<RequirementAuthorityPublicationInput>;
    try {
      input = parseRequirementAuthorityPublicationInput(inputValue);
    } catch (error: unknown) {
      if (error instanceof LedgerAuthorityPublicationInputError) {
        fail("input", error);
      }
      throw error;
    }
    return this.#preview(input, parseOptions(optionsValue));
  }

  /** 从当前Design Markdown零写生成Confirmation及未来Demand身份发布计划。 */
  async previewConfirmation(
    inputValue: unknown,
    optionsValue: LedgerAuthorityPublicationPlanningOptions = {},
  ): Promise<Readonly<LedgerAuthorityPublicationPreviewResult>> {
    let input: Readonly<ConfirmationAuthorityPublicationInput>;
    try {
      input = parseConfirmationAuthorityPublicationInput(inputValue);
    } catch (error: unknown) {
      if (error instanceof LedgerAuthorityPublicationInputError) {
        fail("input", error);
      }
      throw error;
    }
    return this.#preview(input, parseOptions(optionsValue));
  }

  async #preview(
    input: Readonly<LedgerAuthorityPublicationInput>,
    options: Readonly<ParsedOptions>,
  ): Promise<Readonly<LedgerAuthorityPublicationPreviewResult>> {
    assertNotAborted(options.signal);
    const config = await readConfig(this.#workspaceRoot, options.signal);
    const source = await captureSource(config, input, options.signal);
    const documents = source.documents;
    await assertConfigCurrent(
      this.#workspaceRoot,
      config,
      options.signal,
    );

    const ledgerRoot = await openLedgerRoot(config);
    let result: Readonly<LedgerAuthorityPublicationPreviewResult> | undefined;
    let failure: unknown;
    try {
      await assertLedgerLayoutCurrent(ledgerRoot, options.signal);

      // 先用固定身份和时间关闭record/tree/plan容量，已知输入错误不消费Factory或Clock。
      createPlan(
        config,
        input,
        documents,
        validationIdentity(input.family),
        DRAFT_VALIDATION_INSTANT,
        options.signal,
      );

      const identity = allocateIdentity(input.family, options.uuidFactory);
      const identityPlan = createPlan(
        config,
        input,
        documents,
        identity,
        DRAFT_VALIDATION_INSTANT,
        options.signal,
      );
      await assertIdentityAvailable(
        this.#workspaceRoot,
        ledgerRoot,
        identityPlan.intent,
        identity,
        options.signal,
      );

      // 第二遍只读取摘要并要求原节点不变，避免把跨时刻成员拼成一份可误用的Plan。
      await revalidateSource(config, input, source, options.signal);
      await assertConfigCurrent(
        this.#workspaceRoot,
        config,
        options.signal,
      );
      await ledgerRoot.assertCurrent("$ledgerRoot");
      await assertIdentityAvailable(
        this.#workspaceRoot,
        ledgerRoot,
        identityPlan.intent,
        identity,
        options.signal,
      );

      const plan = createPlan(
        config,
        input,
        documents,
        identity,
        recordedAt(options.clock),
        options.signal,
      );
      result = Object.freeze({
        plan,
        planDigest: computeLedgerAuthorityPublicationPlanDigest(plan),
      });
    } catch (error: unknown) {
      failure = error;
    }
    try {
      await ledgerRoot.close();
    } catch (error: unknown) {
      if (failure === undefined) failure = error;
    }
    if (failure !== undefined) {
      if (failure instanceof RootedDirectoryError) fail("ledger", failure);
      throw failure;
    }
    if (result === undefined) fail("operation-failure");
    return result;
  }
}
