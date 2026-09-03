import { types } from "node:util";

import pLimit from "p-limit";

import type { WakeflowConfigAuthoritySnapshot } from "../../configuration/wakeflow-config-authority-snapshot.js";
import {
  createWakeflowDurableId,
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  sameFileNodeIdentity,
  type FileNodeSnapshot,
} from "../../foundation/filesystem/file-node-snapshot.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableFile,
  StableFileReadError,
} from "../../foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import { decodeUtf8, Utf8Error } from "../../foundation/text/utf8.js";
import {
  createUuidV4,
  UuidV4Error,
  type UuidV4Factory,
} from "../../foundation/identity/uuid-v4.js";
import type { UtcWallClock } from "../../foundation/time/wall-clock.js";
import {
  inspectLoadedArtifactTree,
  validateLoadedArtifactTreeManifest,
  LoadedArtifactTreeIdentityError,
  type LoadedArtifactTreeIdentity,
  type LoadedArtifactTreeManifest,
} from "../../foundation/artifact/loaded-artifact-tree-identity.js";
import {
  assertDemandOperationConfigCurrent,
  closeDemandOperationAuthorityContext,
  openDemandOperationAuthorityContext,
  DemandOperationAuthorityContextError,
  type DemandOperationAuthorityContext,
} from "../demand/demand-operation-authority-context.js";
import {
  loadDemandEventSourcingRootAuthority,
  DemandEventSourcingRootAuthorityError,
} from "../demand/event-sourcing/demand-event-sourcing-root-authority.js";
import { LedgerAuthorityStore } from "../ledger/ledger-authority-store.js";
import {
  createManagedEvidenceCapturePlan,
  ManagedEvidenceCapturePlanError,
  type ManagedEvidenceCaptureDemandExpectation,
  type ManagedEvidenceCapturePlan,
} from "./managed-evidence-capture-plan.js";
import {
  openConfiguredManagedEvidenceSourceRoot,
  ManagedEvidenceConfiguredSourceRootError,
} from "./managed-evidence-configured-source-root.js";
import {
  createManagedEvidenceManifest,
  MANAGED_EVIDENCE_PAYLOAD_LIMITS,
  type ManagedEvidenceManifest,
  ManagedEvidenceManifestError,
} from "./managed-evidence-manifest.js";
import {
  parseManagedEvidenceSourceSelection,
  ManagedEvidenceSourceSelectionError,
  type ManagedEvidenceSource,
  type ManagedEvidenceSourceSelection,
} from "./managed-evidence-source-selection.js";

/**
 * Wakeflow Governance / Evidence：本地managed source的零写capture Planning owner。
 *
 * Service重新读取Config与完整Demand Authority，解析逻辑source root，稳定观察实际
 * file/tree字节并派生opaque列表，最后生成完整Managed Evidence Manifest与Demand
 * CAS基线。Preview不创建Evidence目录、stage、Event或投影，也不执行宿主效果。
 */

export interface ManagedEvidenceCapturePlanningOptions {
  readonly clock?: UtcWallClock;
  readonly uuidFactory?: UuidV4Factory;
  readonly signal?: AbortSignal;
}

export type ManagedEvidenceCapturePlanningServiceErrorReason =
  | "input"
  | "config"
  | "demand"
  | "source-root"
  | "source"
  | "source-type"
  | "source-changed"
  | "capacity"
  | "opaque-content"
  | "identity"
  | "time"
  | "manifest"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Managed evidence capture planning input is invalid.",
  config: "Managed evidence capture planning Config is invalid.",
  demand: "Managed evidence capture planning Demand authority is invalid.",
  "source-root": "Managed evidence capture planning source root is invalid.",
  source: "Managed evidence capture planning source is unavailable or unsafe.",
  "source-type":
    "Managed evidence capture planning source type is inconsistent.",
  "source-changed":
    "Managed evidence capture planning source changed during observation.",
  capacity: "Managed evidence capture planning source exceeds its capacity.",
  "opaque-content":
    "Managed evidence capture planning rejected opaque content.",
  identity: "Managed evidence capture planning identity allocation failed.",
  time: "Managed evidence capture planning capture time failed.",
  manifest: "Managed evidence capture planning manifest is invalid.",
  aborted: "Managed evidence capture planning was aborted.",
  "operation-failure": "Managed evidence capture planning failed.",
} as const satisfies Readonly<
  Record<ManagedEvidenceCapturePlanningServiceErrorReason, string>
>;

export class ManagedEvidenceCapturePlanningServiceError extends Error {
  override readonly name = "ManagedEvidenceCapturePlanningServiceError";
  readonly code = "wakeflow-managed-evidence-capture-planning-service" as const;
  readonly reason: ManagedEvidenceCapturePlanningServiceErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;

  constructor(
    reason: ManagedEvidenceCapturePlanningServiceErrorReason,
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

interface CapturedSource {
  readonly identity: Readonly<LoadedArtifactTreeIdentity>;
  readonly opaqueFileRefs: readonly PortableResourcePath[];
}

const CONTENT_CLASSIFICATION_CONCURRENCY = 4;
const MAXIMUM_FILE_BYTES = parseByteCount(
  MANAGED_EVIDENCE_PAYLOAD_LIMITS.maxFileBytes,
);
const CAPTURED_FILE_REF = parsePortableResourcePath("content");
const NON_TEXT_CONTROL_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;

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
  reason: ManagedEvidenceCapturePlanningServiceErrorReason,
  cause?: unknown,
): never {
  throw new ManagedEvidenceCapturePlanningServiceError(
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

function parseDemandId(value: unknown): WakeflowDurableId<"demand"> {
  try {
    return parseWakeflowDurableIdOfKind(value, "demand", "$demandId");
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("input", error);
    throw error;
  }
}

function parseSelection(
  value: unknown,
): Readonly<ManagedEvidenceSourceSelection> {
  try {
    return parseManagedEvidenceSourceSelection(value);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceSourceSelectionError) {
      fail("input", error);
    }
    throw error;
  }
}

function rethrowPlanningError(error: unknown): never {
  if (error instanceof ManagedEvidenceCapturePlanningServiceError) throw error;
  if (error instanceof DemandOperationAuthorityContextError) {
    if (error.reason === "aborted") fail("aborted", error);
    if (error.reason === "config" || error.reason === "stale-config") {
      fail("config", error);
    }
    fail("demand", error);
  }
  if (error instanceof RootedDirectoryError) fail("source-root", error);
  if (error instanceof StableFileReadError) mapStableFileError(error);
  if (error instanceof LoadedArtifactTreeIdentityError) mapArtifactError(error);
  throw error;
}

function mapStableFileError(error: StableFileReadError): never {
  if (error.reason === "aborted") fail("aborted", error);
  if (error.reason === "too-large") fail("capacity", error);
  if (
    error.reason === "source-changed" ||
    error.reason === "expectation-changed"
  ) {
    fail("source-changed", error);
  }
  if (error.reason === "not-file") fail("source-type", error);
  fail("source", error);
}

function mapArtifactError(error: LoadedArtifactTreeIdentityError): never {
  if (error.reason === "aborted") fail("aborted", error);
  if (
    error.reason === "entry-limit" ||
    error.reason === "depth-limit" ||
    error.reason === "file-count" ||
    error.reason === "file-bytes" ||
    error.reason === "total-bytes" ||
    error.reason === "ref-bytes"
  ) {
    fail("capacity", error);
  }
  if (error.reason === "source-changed") fail("source-changed", error);
  if (error.reason === "empty-tree") fail("source", error);
  fail("source", error);
}

function isOpaque(bytes: Uint8Array): boolean {
  try {
    return NON_TEXT_CONTROL_PATTERN.test(decodeUtf8(bytes, "$content"));
  } catch (error: unknown) {
    if (error instanceof Utf8Error) return true;
    throw error;
  }
}

async function captureFile(
  root: RootedDirectory,
  source: Readonly<ManagedEvidenceSource>,
  expectedNode: Readonly<FileNodeSnapshot>,
  signal: AbortSignal | undefined,
): Promise<Readonly<CapturedSource>> {
  let read;
  try {
    read = await readStableFile(root, source.path, {
      maximumBytes: MAXIMUM_FILE_BYTES,
      expectedNode,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) mapStableFileError(error);
    throw error;
  }
  let manifest: Readonly<LoadedArtifactTreeManifest>;
  try {
    manifest = validateLoadedArtifactTreeManifest({
      artifactKind: "wakeflow-loaded-artifact-tree",
      fileCount: 1,
      files: [
        {
          bytes: read.byteCount,
          digest: read.digest,
          executable: (read.node.permissionBits & 0o111) !== 0,
          ref: CAPTURED_FILE_REF,
        },
      ],
      schemaVersion: 1,
      totalBytes: read.byteCount,
    });
  } catch (error: unknown) {
    if (error instanceof LoadedArtifactTreeIdentityError) {
      mapArtifactError(error);
    }
    throw error;
  }
  return Object.freeze({
    identity: Object.freeze({
      artifactDigest: computeCanonicalJsonSha256Digest(manifest),
      manifest,
    }),
    opaqueFileRefs: Object.freeze(
      isOpaque(read.bytes) ? [CAPTURED_FILE_REF] : [],
    ),
  });
}

async function openSelectedTreeRoot(
  sourceRoot: RootedDirectory,
  source: Readonly<ManagedEvidenceSource>,
  expectedNode: Readonly<FileNodeSnapshot>,
): Promise<RootedDirectory> {
  let observation;
  try {
    observation = await sourceRoot.inspectExistingResource(
      source.path,
      "$source",
    );
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("source", error);
    throw error;
  }
  if (
    observation.node.kind !== "directory" ||
    !sameFileNodeIdentity(observation.node, expectedNode)
  ) {
    fail("source-type");
  }
  let treeRoot: RootedDirectory | undefined;
  try {
    treeRoot = await RootedDirectory.open(observation.physicalPath, "$source");
    const current = await treeRoot.assertCurrent("$source");
    if (!sameFileNodeIdentity(expectedNode, current)) fail("source-changed");
    return treeRoot;
  } catch (error: unknown) {
    if (treeRoot !== undefined) {
      try {
        await treeRoot.close();
      } catch {
        // 首个打开或身份错误优先。
      }
    }
    if (error instanceof ManagedEvidenceCapturePlanningServiceError) {
      throw error;
    }
    if (error instanceof RootedDirectoryError) fail("source", error);
    throw error;
  }
}

async function inspectTreeIdentity(
  treeRoot: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<LoadedArtifactTreeIdentity>> {
  try {
    return await inspectLoadedArtifactTree(treeRoot, {
      limits: MANAGED_EVIDENCE_PAYLOAD_LIMITS,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof LoadedArtifactTreeIdentityError)
      mapArtifactError(error);
    throw error;
  }
}

async function classifyTreeFiles(
  treeRoot: RootedDirectory,
  identity: Readonly<LoadedArtifactTreeIdentity>,
  signal: AbortSignal | undefined,
): Promise<readonly PortableResourcePath[]> {
  const limit = pLimit(CONTENT_CLASSIFICATION_CONCURRENCY);
  const settled = await Promise.allSettled(
    identity.manifest.files.map((file) =>
      limit(async () => {
        let read;
        try {
          read = await readStableFile(treeRoot, file.ref, {
            maximumBytes: MAXIMUM_FILE_BYTES,
            ...(signal === undefined ? {} : { signal }),
          });
        } catch (error: unknown) {
          if (error instanceof StableFileReadError) mapStableFileError(error);
          throw error;
        }
        if (read.byteCount !== file.bytes || read.digest !== file.digest) {
          fail("source-changed");
        }
        return isOpaque(read.bytes) ? file.ref : null;
      }),
    ),
  );
  for (const result of settled) {
    if (result.status === "rejected") throw result.reason;
  }
  const classified = settled.map((result) =>
    result.status === "fulfilled" ? result.value : null,
  );
  return Object.freeze(
    classified.filter((entry): entry is PortableResourcePath => entry !== null),
  );
}

async function captureTree(
  sourceRoot: RootedDirectory,
  source: Readonly<ManagedEvidenceSource>,
  expectedNode: Readonly<FileNodeSnapshot>,
  signal: AbortSignal | undefined,
): Promise<Readonly<CapturedSource>> {
  const treeRoot = await openSelectedTreeRoot(sourceRoot, source, expectedNode);
  let result: Readonly<CapturedSource> | undefined;
  let failure: unknown;
  try {
    const first = await inspectTreeIdentity(treeRoot, signal);
    const opaqueFileRefs = await classifyTreeFiles(treeRoot, first, signal);
    const current = await inspectTreeIdentity(treeRoot, signal);
    if (current.artifactDigest !== first.artifactDigest) {
      fail("source-changed");
    }
    result = Object.freeze({ identity: current, opaqueFileRefs });
  } catch (error: unknown) {
    failure = error;
  }
  try {
    await treeRoot.close();
  } catch (error: unknown) {
    if (failure === undefined) failure = error;
  }
  if (failure !== undefined) throw failure;
  if (result === undefined) fail("operation-failure");
  return result;
}

async function captureSelectedSource(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  selection: Readonly<ManagedEvidenceSourceSelection>,
  signal: AbortSignal | undefined,
): Promise<Readonly<CapturedSource>> {
  let sourceRoot: RootedDirectory;
  try {
    sourceRoot = await openConfiguredManagedEvidenceSourceRoot(
      config,
      selection.source,
    );
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceConfiguredSourceRootError) {
      fail("source-root", error);
    }
    throw error;
  }
  let result: Readonly<CapturedSource> | undefined;
  let failure: unknown;
  try {
    let observation;
    try {
      observation = await sourceRoot.inspectExistingResource(
        selection.source.path,
        "$source",
      );
    } catch (error: unknown) {
      if (error instanceof RootedDirectoryError) fail("source", error);
      throw error;
    }
    if (observation.node.kind === "symbolic-link") fail("source");
    if (
      (selection.source.resourceType === "file") !==
      (observation.node.kind === "file")
    ) {
      if (
        selection.source.resourceType !== "tree" ||
        observation.node.kind !== "directory"
      ) {
        fail("source-type");
      }
    }
    result =
      selection.source.resourceType === "file"
        ? await captureFile(
            sourceRoot,
            selection.source,
            observation.node,
            signal,
          )
        : await captureTree(
            sourceRoot,
            selection.source,
            observation.node,
            signal,
          );
  } catch (error: unknown) {
    failure = error;
  }
  try {
    await sourceRoot.close();
  } catch (error: unknown) {
    if (failure === undefined) failure = error;
  }
  if (failure !== undefined) throw failure;
  if (result === undefined) fail("operation-failure");
  return result;
}

function demandExpectation(
  context: Readonly<DemandOperationAuthorityContext>,
): Readonly<ManagedEvidenceCaptureDemandExpectation> {
  return Object.freeze({
    streamRevision: context.loaded.aggregate.streamRevision,
    stateDigest: context.loaded.aggregate.stateDigest,
    lastEventId: context.loaded.aggregate.lastEvent.eventId,
    lastEventDigest: context.loaded.aggregate.lastEventDigest,
  });
}

async function assertAuthorityCurrent(
  workspaceRoot: RootedDirectory,
  context: Readonly<DemandOperationAuthorityContext>,
  expected: Readonly<ManagedEvidenceCaptureDemandExpectation>,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await assertDemandOperationConfigCurrent(
      workspaceRoot,
      context.config,
      signal,
    );
    const current = await loadDemandEventSourcingRootAuthority(
      context.demandRoot,
      new LedgerAuthorityStore(context.ledgerRoot),
      {
        audit: true,
        ...(signal === undefined ? {} : { signal }),
      },
    );
    if (
      current.authorityDigest !== context.loaded.authorityDigest ||
      current.aggregate.streamRevision !== expected.streamRevision ||
      current.aggregate.stateDigest !== expected.stateDigest ||
      current.aggregate.lastEvent.eventId !== expected.lastEventId ||
      current.aggregate.lastEventDigest !== expected.lastEventDigest
    ) {
      fail("demand");
    }
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceCapturePlanningServiceError) {
      throw error;
    }
    if (error instanceof DemandOperationAuthorityContextError) {
      if (error.reason === "aborted") fail("aborted", error);
      if (error.reason === "stale-config") fail("config", error);
      fail("demand", error);
    }
    if (error instanceof DemandEventSourcingRootAuthorityError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("demand", error);
    }
    throw error;
  }
}

function allocateEvidenceId(
  uuidFactory: UuidV4Factory | undefined,
): WakeflowDurableId<"evidence"> {
  try {
    return createWakeflowDurableId(
      "evidence",
      uuidFactory === undefined ? undefined : createUuidV4(uuidFactory),
    );
  } catch (error: unknown) {
    if (error instanceof UuidV4Error) fail("identity", error);
    throw error;
  }
}

export class ManagedEvidenceCapturePlanningService {
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

  /** 读取当前Authority与source，返回不含任何持久副作用的完整capture plan。 */
  async preview(
    demandIdValue: unknown,
    selectionValue: unknown,
    optionsValue: ManagedEvidenceCapturePlanningOptions = {},
  ): Promise<Readonly<ManagedEvidenceCapturePlan>> {
    const options = parseOptions(optionsValue);
    assertNotAborted(options.signal);
    const demandId = parseDemandId(demandIdValue);
    const selection = parseSelection(selectionValue);
    let context: Readonly<DemandOperationAuthorityContext> | undefined;
    let result: Readonly<ManagedEvidenceCapturePlan> | undefined;
    let failure: unknown;
    try {
      context = await openDemandOperationAuthorityContext(
        this.#workspaceRoot,
        demandId,
        options.signal,
      );
      if (
        context.loaded.aggregate.state.lifecycle !== "active" ||
        context.loaded.identity.programId !==
          context.config.model.program.programId
      ) {
        fail("demand");
      }
      const expectedDemand = demandExpectation(context);
      const captured = await captureSelectedSource(
        context.config,
        selection,
        options.signal,
      );
      if (
        captured.opaqueFileRefs.length > 0 &&
        selection.opaqueContentPolicy === "reject"
      ) {
        fail("opaque-content");
      }
      await assertAuthorityCurrent(
        this.#workspaceRoot,
        context,
        expectedDemand,
        options.signal,
      );
      let manifest: Readonly<ManagedEvidenceManifest>;
      try {
        manifest = createManagedEvidenceManifest(
          {
            evidenceId: allocateEvidenceId(options.uuidFactory),
            programId: context.loaded.identity.programId,
            demandId,
            demandAuthorityDigest: context.loaded.authorityDigest,
            evidenceType: selection.evidenceType,
            recordedBy: {
              windowId: context.config.indexes.controllerWindow.windowId,
              configDigest: context.config.configDigest,
            },
            source: selection.source,
            sensitivity: selection.sensitivity,
            payload: {
              artifactDigest: captured.identity.artifactDigest,
              treeManifest: captured.identity.manifest,
            },
            contentReview: {
              disposition:
                captured.opaqueFileRefs.length === 0
                  ? "not-required"
                  : "controller-confirmed",
              opaqueFileRefs: captured.opaqueFileRefs,
            },
          },
          options.clock === undefined ? {} : { clock: options.clock },
        );
      } catch (error: unknown) {
        if (error instanceof ManagedEvidenceManifestError) {
          if (error.reason === "time") fail("time", error);
          fail("manifest", error);
        }
        throw error;
      }
      try {
        result = createManagedEvidenceCapturePlan({
          configDigest: context.config.configDigest,
          expectedDemand,
          manifest,
        });
      } catch (error: unknown) {
        if (error instanceof ManagedEvidenceCapturePlanError) {
          fail("operation-failure", error);
        }
        throw error;
      }
    } catch (error: unknown) {
      failure = error;
    }
    if (context !== undefined) {
      try {
        await closeDemandOperationAuthorityContext(context);
      } catch (error: unknown) {
        if (failure === undefined) failure = error;
      }
    }
    if (failure !== undefined) rethrowPlanningError(failure);
    if (result === undefined) fail("operation-failure");
    return result;
  }
}
