import { types } from "node:util";

import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import {
  unlinkRegularFileExactly,
  ExactRegularFileUnlinkError,
} from "./exact-regular-file-unlink.js";
import {
  sameFileNodeIdentity,
  sameFileNodeSnapshot,
  type FileNodeSnapshot,
} from "./file-node-snapshot.js";
import {
  computeDurableAtomicFileStageTargetDigest,
  hasDurableAtomicFileStagePrefix,
  parseDurableAtomicFileStageFileName,
  readDurableAtomicFileStageOwnerState,
  DurableAtomicFileStageAddressError,
  type DurableAtomicFileStageAddress,
} from "./durable-atomic-file-stage-address.js";
import {
  settleRegularFileDurability,
  DurableRegularFileSettlementError,
} from "./durable-regular-file-settlement.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  splitPortableResourcePath,
  type PortableResourcePath,
} from "./portable-resource-path.js";
import { RootedDirectory } from "./rooted-directory.js";
import {
  readStableResourceDirectory,
  readStableRootDirectory,
  StableDirectoryReadError,
  type StableDirectoryEntry,
  type StableDirectoryReadResult,
} from "./stable-directory-read.js";
import {
  readStableFileDigest,
  StableFileReadError,
} from "./stable-file-read.js";
import {
  DURABLE_ATOMIC_FILE_MAXIMUM_BYTES,
} from "./durable-atomic-file-write-contract.js";

/**
 * Wakeflow Foundation / Filesystem：自描述 atomic stage 的 bounded crash recovery。
 *
 * Recovery 只退休 owner 已确认 inactive 的 reserved stage。single-link stage 永远是
 * 非权威 candidate，可 exact rollback；create two-link stage 必须与名称绑定的 sibling
 * target 形成同 inode、同 snapshot、同 digest/mode 的完整 publication，先结算 target
 * durability，再退休 stage。active/unknown owner 只报告、不删除。
 */

export const DURABLE_ATOMIC_FILE_STAGE_MAXIMUM_ENTRIES = 100_000;
export const DURABLE_ATOMIC_FILE_STAGE_MAXIMUM_BYTES =
  DURABLE_ATOMIC_FILE_MAXIMUM_BYTES;

export interface DurableAtomicFileStageRecoveryOptions {
  readonly signal?: AbortSignal;
}

export interface DurableAtomicFileStageRecoveryReceipt {
  readonly observedStageCount: number;
  readonly retiredStageCount: number;
  readonly settledTargetCount: number;
  readonly activeStageCount: number;
  readonly unknownStageCount: number;
}

export type DurableAtomicFileStageRecoveryErrorReason =
  | "input"
  | "root-scope"
  | "directory"
  | "capacity"
  | "inventory"
  | "node-policy"
  | "target-conflict"
  | "busy"
  | "cleanup-required"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  "input": "Durable atomic file stage recovery input is invalid.",
  "root-scope": "Atomic file stage recovery lost its rooted scope.",
  "directory": "Atomic file stage recovery parent directory is unavailable.",
  "capacity": "Atomic file stage recovery inventory exceeds its bounded capacity.",
  "inventory": "Atomic file stage recovery found an invalid reserved stage name.",
  "node-policy": "Atomic file stage recovery found an unsafe stage node.",
  "target-conflict": "Atomic file stage recovery cannot prove its published target.",
  "busy": "Atomic file stage recovery inventory changed during observation.",
  "cleanup-required": "Atomic file stage recovery could not retire an exact stage.",
  "aborted": "Atomic file stage recovery was aborted before its next mutation.",
  "operation-failure": "Atomic file stage recovery failed.",
} as const satisfies Readonly<Record<
  DurableAtomicFileStageRecoveryErrorReason,
  string
>>;

export class DurableAtomicFileStageRecoveryError extends Error {
  override readonly name = "DurableAtomicFileStageRecoveryError";
  readonly code = "wakeflow-durable-atomic-file-stage-recovery" as const;
  readonly reason: DurableAtomicFileStageRecoveryErrorReason;
  readonly path: string;

  constructor(
    reason: DurableAtomicFileStageRecoveryErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedOptions {
  readonly signal: AbortSignal | undefined;
}

interface StageEntry {
  readonly address: Readonly<DurableAtomicFileStageAddress>;
  readonly entry: Readonly<StableDirectoryEntry>;
}

function fail(
  reason: DurableAtomicFileStageRecoveryErrorReason,
  path: string,
): never {
  throw new DurableAtomicFileStageRecoveryError(reason, path);
}

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
}

function parseOptions(value: unknown): Readonly<ParsedOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (
    Object.keys(record).some((key) => key !== "signal")
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
    fail("input", "$options");
  }
  return Object.freeze({ signal: record.signal as AbortSignal | undefined });
}

function assertCurrentOwner(node: Readonly<FileNodeSnapshot>, path: string): void {
  if (
    typeof process.geteuid === "function"
    && node.userId !== BigInt(process.geteuid())
  ) {
    fail("node-policy", path);
  }
}

function assertStageNode(
  stage: Readonly<StageEntry>,
  index: number,
): void {
  const { address, entry } = stage;
  if (
    entry.node.kind !== "file"
    || entry.node.byteCount > DURABLE_ATOMIC_FILE_STAGE_MAXIMUM_BYTES
    || (entry.node.permissionBits !== 0o600
      && entry.node.permissionBits !== address.mode)
    || (entry.node.linkCount !== 1n && entry.node.linkCount !== 2n)
    || (address.operation === "replace" && entry.node.linkCount !== 1n)
  ) {
    fail("node-policy", `$stages/${index}`);
  }
  assertCurrentOwner(entry.node, `$stages/${index}`);
}

function parseDirectoryRef(
  value: unknown,
): PortableResourcePath | null {
  if (value === null) return null;
  try {
    return parsePortableResourcePath(value, "$directoryResourcePath");
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) {
      fail("input", "$directoryResourcePath");
    }
    throw error;
  }
}

async function readDirectory(
  root: RootedDirectory,
  directoryResourcePath: PortableResourcePath | null,
  signal: AbortSignal | undefined,
): Promise<Readonly<StableDirectoryReadResult>> {
  try {
    const options = {
      maximumEntries: DURABLE_ATOMIC_FILE_STAGE_MAXIMUM_ENTRIES,
      ...(signal === undefined ? {} : { signal }),
    };
    return directoryResourcePath === null
      ? await readStableRootDirectory(root, options)
      : await readStableResourceDirectory(root, directoryResourcePath, options);
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "too-many-entries") fail("capacity", "$directory");
      if (error.reason === "root-scope") fail("root-scope", "$root");
      if (error.reason === "source-changed") fail("busy", "$directory");
      if (
        error.reason === "not-found"
        || error.reason === "symlink"
        || error.reason === "not-directory"
      ) {
        fail("directory", "$directory");
      }
      fail("operation-failure", "$directory");
    }
    throw error;
  }
}

function collectStages(
  directory: Readonly<StableDirectoryReadResult>,
): readonly Readonly<StageEntry>[] {
  const stages: StageEntry[] = [];
  for (const [index, entry] of directory.entries.entries()) {
    if (!hasDurableAtomicFileStagePrefix(entry.name)) continue;
    let address: Readonly<DurableAtomicFileStageAddress>;
    try {
      address = parseDurableAtomicFileStageFileName(entry.name);
    } catch (error: unknown) {
      if (error instanceof DurableAtomicFileStageAddressError) {
        fail("inventory", `$stages/${index}`);
      }
      throw error;
    }
    const stage = Object.freeze({ address, entry });
    assertStageNode(stage, index);
    stages.push(stage);
  }
  return Object.freeze(stages);
}

function targetForStage(
  directory: Readonly<StableDirectoryReadResult>,
  stage: Readonly<StageEntry>,
): Readonly<StableDirectoryEntry> {
  const matches = directory.entries.filter((entry) => (
    !hasDurableAtomicFileStagePrefix(entry.name)
    && computeDurableAtomicFileStageTargetDigest(entry.resourcePath)
      === stage.address.targetResourcePathDigest
  ));
  const target = matches[0];
  if (matches.length !== 1 || target === undefined) {
    fail("target-conflict", "$target");
  }
  return target;
}

async function assertPublishedTarget(
  root: RootedDirectory,
  stage: Readonly<StageEntry>,
  target: Readonly<StableDirectoryEntry>,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (
    target.node.kind !== "file"
    || target.node.permissionBits !== stage.address.mode
    || target.node.linkCount !== 2n
    || !sameFileNodeIdentity(stage.entry.node, target.node)
    || !sameFileNodeSnapshot(stage.entry.node, target.node)
  ) {
    fail("target-conflict", "$target");
  }
  assertCurrentOwner(target.node, "$target");
  let read;
  try {
    read = await readStableFileDigest(root, target.resourcePath, {
      maximumBytes: DURABLE_ATOMIC_FILE_STAGE_MAXIMUM_BYTES,
      expectedNode: target.node,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("target-conflict", "$target");
    }
    throw error;
  }
  if (read.digest !== stage.address.inputDigest) {
    fail("target-conflict", "$target");
  }
  try {
    await settleRegularFileDurability(root, target.resourcePath, {
      expectedNode: read.node,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof DurableRegularFileSettlementError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("target-conflict", "$target");
    }
    throw error;
  }
}

async function retireStage(
  root: RootedDirectory,
  stage: Readonly<StageEntry>,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await unlinkRegularFileExactly(root, stage.entry.resourcePath, {
      expectedNode: stage.entry.node,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof ExactRegularFileUnlinkError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("cleanup-required", "$stage");
    }
    throw error;
  }
}

/** 清理一个明确 parent 目录内所有安全、inactive 的自描述 atomic stages。 */
export async function recoverDurableAtomicFileStagesInDirectory(
  root: RootedDirectory,
  directoryResourcePathValue: PortableResourcePath | null,
  options?: DurableAtomicFileStageRecoveryOptions,
): Promise<Readonly<DurableAtomicFileStageRecoveryReceipt>> {
  assertRoot(root);
  const directoryResourcePath = parseDirectoryRef(directoryResourcePathValue);
  const { signal } = parseOptions(options);
  const directory = await readDirectory(root, directoryResourcePath, signal);
  const stages = collectStages(directory);
  let retiredStageCount = 0;
  let settledTargetCount = 0;
  let activeStageCount = 0;
  let unknownStageCount = 0;

  for (const stage of stages) {
    const ownerState = readDurableAtomicFileStageOwnerState(stage.address);
    if (ownerState === "active") {
      activeStageCount += 1;
      continue;
    }
    if (ownerState === "unknown") {
      unknownStageCount += 1;
      continue;
    }
    if (stage.entry.node.linkCount === 2n) {
      const target = targetForStage(directory, stage);
      await assertPublishedTarget(root, stage, target, signal);
      settledTargetCount += 1;
    }
    await retireStage(root, stage, signal);
    retiredStageCount += 1;
  }

  return Object.freeze({
    observedStageCount: stages.length,
    retiredStageCount,
    settledTargetCount,
    activeStageCount,
    unknownStageCount,
  });
}

/** 从 target portable ref 派生同 parent recovery scope。 */
export async function recoverDurableAtomicFileStagesInTargetParent(
  root: RootedDirectory,
  targetResourcePathValue: unknown,
  options?: DurableAtomicFileStageRecoveryOptions,
): Promise<Readonly<DurableAtomicFileStageRecoveryReceipt>> {
  let targetResourcePath: PortableResourcePath;
  try {
    targetResourcePath = parsePortableResourcePath(
      targetResourcePathValue,
      "$resourcePath",
    );
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) {
      fail("input", "$resourcePath");
    }
    throw error;
  }
  const segments = splitPortableResourcePath(targetResourcePath);
  const parent = segments.length === 1
    ? null
    : parsePortableResourcePath(segments.slice(0, -1).join("/"));
  return recoverDurableAtomicFileStagesInDirectory(root, parent, options);
}
