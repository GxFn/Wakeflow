import { types } from "node:util";

import {
  computeWakeflowConfigV3Digest,
  parseWakeflowConfigV3,
  WakeflowConfigV3Error,
} from "../../configuration/wakeflow-config-v3.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
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
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
} from "../../foundation/filesystem/stable-directory-read.js";
import {
  StableFileReadError,
  type StableFileSource,
} from "../../foundation/filesystem/stable-file-read.js";
import {
  readStrictTextFile,
  StrictTextFileError,
} from "../../foundation/filesystem/strict-text-file.js";
import {
  TODO_EMPTY_BOARD_PROJECTION,
  TODO_EMPTY_COLLECTION_SNAPSHOT,
} from "../../governance/todo/todo-collection-initialization-authority.js";
import {
  inspectTodoItems,
  TodoCollectionServiceError,
} from "../../governance/todo/todo-collection-service.js";
import {
  assertWakeflowActiveLayoutCurrent,
  WakeflowActiveLayoutInspectionError,
} from "./wakeflow-active-layout-inspection.js";
import {
  WAKEFLOW_ACTIVE_CURRENT_ROOT_REF,
  WAKEFLOW_ACTIVE_ROOT_REF,
} from "./wakeflow-active-paths.js";
import {
  createWakeflowActiveWorkspaceFreshProjectionAuthority,
  WAKEFLOW_ACTIVE_WORKSPACE_PROJECTION_FILE_MODE,
  WAKEFLOW_ACTIVE_WORKSPACE_PROJECTION_MAXIMUM_BYTES,
  WakeflowActiveWorkspaceFreshProjectionAuthorityError,
  type WakeflowActiveWorkspaceFreshProjectionAuthority,
} from "./wakeflow-active-workspace-fresh-projection-authority.js";

/**
 * Wakeflow Workspace / Active：Fresh workspace两份投影的零写入inspection。
 *
 * Inspection先证明Active Layout、空TODO authority和Fresh namespace，再稳定读取两个
 * `0600`目标。只有缺失、exact current或带本owner marker的stale文件可以进入发布；
 * unknown entry、unmanaged bytes、symlink、hard link或mode漂移全部保持现场并失败。
 */

export type WakeflowActiveWorkspaceProjectionTargetStatus =
  | "missing"
  | "current"
  | "stale";

export interface WakeflowActiveWorkspaceProjectionTargetInspection {
  readonly resourcePath: PortableResourcePath;
  readonly status: WakeflowActiveWorkspaceProjectionTargetStatus;
  readonly source: Readonly<StableFileSource> | null;
  readonly currentDigest: Sha256Digest | null;
  readonly targetDigest: Sha256Digest;
}

export interface WakeflowActiveWorkspaceProjectionInspection {
  readonly kind: "WakeflowActiveWorkspaceProjectionInspection";
  readonly status: "current" | "publication-required";
  readonly authority:
    Readonly<WakeflowActiveWorkspaceFreshProjectionAuthority>;
  readonly todoCollectionDigest: Sha256Digest;
  readonly targets: readonly [
    Readonly<WakeflowActiveWorkspaceProjectionTargetInspection>,
    Readonly<WakeflowActiveWorkspaceProjectionTargetInspection>,
  ];
  readonly observationDigest: Sha256Digest;
}

export interface WakeflowActiveWorkspaceProjectionInspectionRequest {
  readonly desiredConfig: unknown;
  readonly expectedDesiredConfigDigest: Sha256Digest;
  readonly signal?: AbortSignal;
}

export type WakeflowActiveWorkspaceProjectionInspectionErrorReason =
  | "input"
  | "layout"
  | "todo"
  | "namespace"
  | "lock-present"
  | "target-policy"
  | "target-conflict"
  | "root-scope"
  | "aborted";

const ERROR_MESSAGES = {
  input: "Active workspace projection inspection input is invalid.",
  layout: "Active workspace projection requires the current Active Layout.",
  todo: "Active workspace projection requires the exact empty TODO authority.",
  namespace: "Active workspace projection Fresh namespace is not closed.",
  "lock-present": "Active workspace projection lock is already present.",
  "target-policy": "Active workspace projection target violates its node policy.",
  "target-conflict": "Active workspace projection target is not Wakeflow-managed.",
  "root-scope": "Active workspace projection inspection lost workspace scope.",
  aborted: "Active workspace projection inspection was aborted.",
} as const satisfies Readonly<Record<
  WakeflowActiveWorkspaceProjectionInspectionErrorReason,
  string
>>;

/** Active workspace projection inspection 失败的稳定、脱敏错误。 */
export class WakeflowActiveWorkspaceProjectionInspectionError extends Error {
  override readonly name = "WakeflowActiveWorkspaceProjectionInspectionError";
  readonly code = "wakeflow-active-workspace-projection-inspection" as const;
  readonly reason: WakeflowActiveWorkspaceProjectionInspectionErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowActiveWorkspaceProjectionInspectionErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedRequest {
  readonly desiredConfig: ReturnType<typeof parseWakeflowConfigV3>;
  readonly desiredConfigDigest: Sha256Digest;
  readonly signal: AbortSignal | undefined;
}

const MANAGED_MARKER =
  /<!-- wakeflow:active-workspace-projection:v1:sha256:[0-9a-f]{64} -->/u;

function fail(
  reason: WakeflowActiveWorkspaceProjectionInspectionErrorReason,
  path: string,
): never {
  throw new WakeflowActiveWorkspaceProjectionInspectionError(reason, path);
}

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("input", path);
    throw error;
  }
}

function parseRequest(value: unknown): Readonly<ParsedRequest> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$request");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error.path);
    throw error;
  }
  const expected = record.signal === undefined
    ? ["desiredConfig", "expectedDesiredConfigDigest"]
    : ["desiredConfig", "expectedDesiredConfigDigest", "signal"];
  if (
    Object.keys(record).sort().join("\u0000") !== expected.join("\u0000")
    || (
      record.signal !== undefined
      && (
        typeof record.signal !== "object"
        || record.signal === null
        || types.isProxy(record.signal)
        || !(record.signal instanceof AbortSignal)
      )
    )
  ) {
    fail("input", "$request");
  }
  let desiredConfig;
  try {
    desiredConfig = parseWakeflowConfigV3(record.desiredConfig);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigV3Error) fail("input", error.path);
    throw error;
  }
  const desiredConfigDigest = parseDigest(
    record.expectedDesiredConfigDigest,
    "$request.expectedDesiredConfigDigest",
  );
  if (computeWakeflowConfigV3Digest(desiredConfig) !== desiredConfigDigest) {
    fail("input", "$request.expectedDesiredConfigDigest");
  }
  return Object.freeze({
    desiredConfig,
    desiredConfigDigest,
    signal: record.signal as AbortSignal | undefined,
  });
}

function currentUserId(): bigint | null {
  return typeof process.geteuid === "function"
    ? BigInt(process.geteuid())
    : null;
}

async function assertFreshNamespace(
  root: RootedDirectory,
  allowLock: boolean,
  signal: AbortSignal | undefined,
): Promise<void> {
  let active;
  let current;
  try {
    [active, current] = await Promise.all([
      readStableResourceDirectory(root, WAKEFLOW_ACTIVE_ROOT_REF, {
        maximumEntries: 3,
        ...(signal === undefined ? {} : { signal }),
      }),
      readStableResourceDirectory(root, WAKEFLOW_ACTIVE_CURRENT_ROOT_REF, {
        maximumEntries: 2,
        ...(signal === undefined ? {} : { signal }),
      }),
    ]);
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "root-scope") fail("root-scope", "$root");
      fail("namespace", "$namespace");
    }
    throw error;
  }
  const activeAllowed = new Set([
    "current",
    "index.md",
    "projector.lock",
  ]);
  const currentAllowed = new Set(["todo", "workspace-current-status.md"]);
  if (
    active.entries.some((entry) => !activeAllowed.has(entry.name))
    || current.entries.some((entry) => !currentAllowed.has(entry.name))
  ) {
    fail("namespace", "$namespace");
  }
  const lock = active.entries.find((entry) => (
    entry.name === "projector.lock"
  ));
  if (!allowLock && lock !== undefined) fail("lock-present", "$lock");
}

async function assertEmptyTodo(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Sha256Digest> {
  let snapshot;
  try {
    snapshot = await inspectTodoItems(root, signal);
  } catch (error: unknown) {
    if (error instanceof TodoCollectionServiceError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("todo", "$todo");
    }
    throw error;
  }
  if (
    snapshot.collection.collectionDigest
      !== TODO_EMPTY_COLLECTION_SNAPSHOT.collectionDigest
    || snapshot.collection.itemCount !== 0
    || snapshot.collection.activeItemCount !== 0
    || snapshot.items.length !== 0
    || snapshot.projection.status !== "current"
    || snapshot.projection.source?.digest
      !== TODO_EMPTY_BOARD_PROJECTION.sourceDigest
  ) {
    fail("todo", "$todo");
  }
  return snapshot.collection.collectionDigest;
}

async function inspectTarget(
  root: RootedDirectory,
  expected: Readonly<
    WakeflowActiveWorkspaceFreshProjectionAuthority["files"][number]
  >,
  signal: AbortSignal | undefined,
): Promise<Readonly<WakeflowActiveWorkspaceProjectionTargetInspection>> {
  let read;
  try {
    read = await readStrictTextFile(root, expected.resourcePath, {
      maximumBytes: WAKEFLOW_ACTIVE_WORKSPACE_PROJECTION_MAXIMUM_BYTES,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (
      error instanceof StableFileReadError
      && error.reason === "not-found"
    ) {
      return Object.freeze({
        resourcePath: expected.resourcePath,
        status: "missing" as const,
        source: null,
        currentDigest: null,
        targetDigest: expected.digest,
      });
    }
    if (error instanceof StableFileReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "root-scope") fail("root-scope", "$root");
      fail("target-policy", `$target/${expected.resourcePath}`);
    }
    if (error instanceof StrictTextFileError) {
      fail("target-conflict", `$target/${expected.resourcePath}`);
    }
    throw error;
  }
  if (
    read.node.kind !== "file"
    || read.node.permissionBits !== WAKEFLOW_ACTIVE_WORKSPACE_PROJECTION_FILE_MODE
    || read.node.linkCount !== 1n
    || (currentUserId() !== null && read.node.userId !== currentUserId())
  ) {
    fail("target-policy", `$target/${expected.resourcePath}`);
  }
  const status = read.digest === expected.digest
    ? "current" as const
    : MANAGED_MARKER.test(read.text)
      ? "stale" as const
      : fail("target-conflict", `$target/${expected.resourcePath}`);
  return Object.freeze({
    resourcePath: expected.resourcePath,
    status,
    source: Object.freeze({
      resourcePath: read.resourcePath,
      node: read.node,
      byteCount: read.byteCount,
      digest: read.digest,
    }),
    currentDigest: read.digest,
    targetDigest: expected.digest,
  });
}

/** 执行Fresh workspace两份投影的零写入inspection。 */
export async function inspectWakeflowActiveWorkspaceProjection(
  rootValue: RootedDirectory,
  requestValue: WakeflowActiveWorkspaceProjectionInspectionRequest,
  options: { readonly allowLock?: boolean } = {},
): Promise<Readonly<WakeflowActiveWorkspaceProjectionInspection>> {
  let optionRecord: Readonly<Record<string, unknown>>;
  try {
    optionRecord = parsePlainRecord(options, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error.path);
    throw error;
  }
  if (
    typeof rootValue !== "object"
    || rootValue === null
    || types.isProxy(rootValue)
    || !(rootValue instanceof RootedDirectory)
    || Object.keys(optionRecord).some((key) => key !== "allowLock")
    || (
      optionRecord.allowLock !== undefined
      && typeof optionRecord.allowLock !== "boolean"
    )
  ) {
    fail("input", "$root");
  }
  const request = parseRequest(requestValue);
  if (request.signal?.aborted === true) fail("aborted", "$signal");
  try {
    await assertWakeflowActiveLayoutCurrent(rootValue, request.signal);
  } catch (error: unknown) {
    if (error instanceof WakeflowActiveLayoutInspectionError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "root-scope") fail("root-scope", "$root");
      fail("layout", "$layout");
    }
    throw error;
  }
  const todoCollectionDigest = await assertEmptyTodo(rootValue, request.signal);
  await assertFreshNamespace(
    rootValue,
    optionRecord.allowLock === true,
    request.signal,
  );
  let authority;
  try {
    authority = createWakeflowActiveWorkspaceFreshProjectionAuthority(
      request.desiredConfig,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowActiveWorkspaceFreshProjectionAuthorityError) {
      fail("input", error.path);
    }
    throw error;
  }
  const targets = Object.freeze(await Promise.all(authority.files.map(
    (entry) => inspectTarget(rootValue, entry, request.signal),
  ))) as WakeflowActiveWorkspaceProjectionInspection["targets"];
  const status = targets.every((entry) => entry.status === "current")
    ? "current" as const
    : "publication-required" as const;
  const basis = Object.freeze({
    kind: "WakeflowActiveWorkspaceProjectionInspection" as const,
    status,
    authorityDigest: authority.authorityDigest,
    todoCollectionDigest,
    targets: targets.map((entry) => ({
      resourcePath: entry.resourcePath,
      status: entry.status,
      currentDigest: entry.currentDigest,
      targetDigest: entry.targetDigest,
    })),
  });
  return Object.freeze({
    kind: basis.kind,
    status,
    authority,
    todoCollectionDigest,
    targets,
    observationDigest: computeCanonicalJsonSha256Digest(basis),
  });
}
