import { types } from "node:util";

import { DeterministicJsonDocumentError } from "../../foundation/data/deterministic-json-document.js";
import { canonicalizeJson } from "../../foundation/data/canonical-json.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import {
  recoverDurableAtomicFileStagesForTargets,
  DurableAtomicFileStageRecoveryError,
} from "../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import type { FileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  inspectRootedExclusiveFileLock,
  retireRootedExclusiveFileLockResidue,
  withRootedExclusiveFileLock,
  RootedExclusiveFileLockError,
} from "../../foundation/filesystem/rooted-exclusive-file-lock.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
} from "../../foundation/filesystem/stable-directory-read.js";
import { StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../foundation/filesystem/strict-text-file.js";
import type { UuidV4Factory } from "../../foundation/identity/uuid-v4.js";
import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  readUtcWallClock,
  UtcWallClockError,
  type UtcWallClock,
} from "../../foundation/time/wall-clock.js";
import type { UtcInstant } from "../../foundation/time/utc-instant.js";
import {
  createWakeflowWindowHostBinding,
  parseWakeflowWindowHostBindingDocument,
  renderWakeflowWindowHostBinding,
  WakeflowWindowHostBindingError,
  type WakeflowWindowHostBinding,
} from "./wakeflow-window-host-binding.js";
import {
  createWakeflowWindowHostBindingId,
  WakeflowWindowHostBindingIdError,
} from "./wakeflow-window-host-binding-id.js";
import type { WakeflowWorkspaceHostResourceProfile } from "../workspace-host-resource-profile.js";
import type {
  WakeflowWindowHostHandle,
  WakeflowWindowHostIdentityProfile,
} from "./wakeflow-window-host-identity-profile.js";
import { wakeflowWindowHostBindingRef } from "./wakeflow-window-runtime-paths.js";

/**
 * Wakeflow Workspace / Window Runtime：私有 Binding authority store。
 *
 * Store 只拥有专用锁、atomic stage 恢复、完整 inventory 读取与 0600 no-replace create。
 * 它不解释launch intent、不决定相同注册身份的幂等语义，也不更新projection。
 */

export interface WakeflowWindowHostBindingStoreOptions {
  readonly uuidFactory?: UuidV4Factory;
  readonly wallClock?: UtcWallClock;
  readonly signal?: AbortSignal;
  readonly acquireTimeoutMilliseconds?: number;
}

/** Binding inventory读取、锁定与恢复共同需要的最小Store authority。 */
export interface WakeflowWindowHostBindingStoreAuthority {
  readonly programId: WakeflowDurableId<"program">;
  readonly resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly identityProfile: Readonly<WakeflowWindowHostIdentityProfile>;
  readonly bindingRefs: readonly PortableResourcePath[];
  readonly bindingRootRef: PortableResourcePath;
  readonly lockRef: PortableResourcePath;
}

/** 首次注册写入在通用Store authority之外必须提供的创建事实。 */
export interface WakeflowWindowHostBindingCreateAuthority extends WakeflowWindowHostBindingStoreAuthority {
  readonly windowId: WakeflowDurableId<"window">;
  readonly bindingRef: PortableResourcePath;
  readonly launchIntentDigest: Sha256Digest;
  readonly handle: Readonly<WakeflowWindowHostHandle>;
  readonly observedAt: UtcInstant;
}

export interface InspectWakeflowWindowHostBindingInventoryOptions {
  readonly signal?: AbortSignal;
}

export interface WakeflowWindowHostBindingInventory {
  readonly bindings: readonly Readonly<WakeflowWindowHostBinding>[];
}

interface WakeflowWindowHostBindingStoreContext {
  readonly inventory: Readonly<WakeflowWindowHostBindingInventory>;
  readonly uuidFactory: UuidV4Factory | undefined;
  readonly wallClock: UtcWallClock | undefined;
  readonly signal: AbortSignal | undefined;
}

type WakeflowWindowHostBindingStoreErrorReason =
  | "input"
  | "layout"
  | "inventory"
  | "lock"
  | "recovery-required"
  | "aborted"
  | "time"
  | "binding-id"
  | "write";

const ERROR_MESSAGES = {
  input: "Window Host Binding store input is invalid.",
  layout: "Window Host Binding private layout is unavailable or unsafe.",
  inventory: "Window Host Binding inventory is invalid or changed.",
  lock: "Window Host Binding store lock could not be acquired safely.",
  "recovery-required": "Window Host Binding store requires explicit recovery.",
  aborted: "Window Host Binding store operation was aborted.",
  time: "Window Host Binding store clock could not be read safely.",
  "binding-id": "Window Host Binding ID could not be allocated safely.",
  write: "Window Host Binding authority could not be published safely.",
} as const satisfies Readonly<
  Record<WakeflowWindowHostBindingStoreErrorReason, string>
>;

/** Binding store 物理操作失败的稳定、脱敏错误。 */
export class WakeflowWindowHostBindingStoreError extends Error {
  override readonly name = "WakeflowWindowHostBindingStoreError";
  readonly code = "wakeflow-window-host-binding-store" as const;
  readonly reason: WakeflowWindowHostBindingStoreErrorReason;
  readonly path: string;
  readonly bindingAuthority: "unchanged" | "unknown";

  constructor(
    reason: WakeflowWindowHostBindingStoreErrorReason,
    path: string,
    bindingAuthority: "unchanged" | "unknown" = "unchanged",
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
    this.bindingAuthority = bindingAuthority;
  }
}

const MAXIMUM_BINDING_BYTES = parseByteCount(64 * 1024);

interface ParsedOptions {
  readonly uuidFactory: UuidV4Factory | undefined;
  readonly wallClock: UtcWallClock | undefined;
  readonly signal: AbortSignal | undefined;
  readonly acquireTimeoutMilliseconds: number | undefined;
}

function fail(
  reason: WakeflowWindowHostBindingStoreErrorReason,
  path: string,
  bindingAuthority: "unchanged" | "unknown" = "unchanged",
): never {
  throw new WakeflowWindowHostBindingStoreError(reason, path, bindingAuthority);
}

function parseOptions(value: unknown): Readonly<ParsedOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value ?? {}, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  const allowed = new Set([
    "acquireTimeoutMilliseconds",
    "signal",
    "uuidFactory",
    "wallClock",
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    fail("input", "$options");
  }
  for (const key of ["uuidFactory", "wallClock"] as const) {
    if (
      record[key] !== undefined &&
      (typeof record[key] !== "function" || types.isProxy(record[key]))
    ) {
      fail("input", `$options.${key}`);
    }
  }
  if (
    record.signal !== undefined &&
    (typeof record.signal !== "object" ||
      record.signal === null ||
      types.isProxy(record.signal) ||
      !(record.signal instanceof AbortSignal))
  ) {
    fail("input", "$options.signal");
  }
  if (
    record.acquireTimeoutMilliseconds !== undefined &&
    (typeof record.acquireTimeoutMilliseconds !== "number" ||
      !Number.isSafeInteger(record.acquireTimeoutMilliseconds) ||
      record.acquireTimeoutMilliseconds <= 0 ||
      record.acquireTimeoutMilliseconds > 300_000)
  ) {
    fail("input", "$options.acquireTimeoutMilliseconds");
  }
  return Object.freeze({
    uuidFactory: record.uuidFactory as UuidV4Factory | undefined,
    wallClock: record.wallClock as UtcWallClock | undefined,
    signal: record.signal as AbortSignal | undefined,
    acquireTimeoutMilliseconds: record.acquireTimeoutMilliseconds as
      number | undefined,
  });
}

function parseInspectOptions(
  value: unknown,
): Readonly<{ readonly signal: AbortSignal | undefined }> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value ?? {}, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
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
    fail("input", "$options");
  }
  return Object.freeze({
    signal: record.signal as AbortSignal | undefined,
  });
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted", "$signal");
}

function privateNode(
  node: Readonly<FileNodeSnapshot>,
  kind: "directory" | "file",
  path: string,
): void {
  const currentUserId =
    typeof process.geteuid === "function" ? BigInt(process.geteuid()) : null;
  if (
    node.kind !== kind ||
    node.permissionBits !== (kind === "directory" ? 0o700 : 0o600) ||
    (kind === "file" && node.linkCount !== 1n) ||
    (currentUserId !== null && node.userId !== currentUserId)
  ) {
    fail("layout", path);
  }
}

async function recoverStages(
  root: RootedDirectory,
  targets: readonly PortableResourcePath[],
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    const recovery = await recoverDurableAtomicFileStagesForTargets(
      root,
      targets,
      signal === undefined ? undefined : { signal },
    );
    if (recovery.activeStageCount !== 0 || recovery.unknownStageCount !== 0) {
      fail("recovery-required", "$stages");
    }
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostBindingStoreError) throw error;
    if (error instanceof DurableAtomicFileStageRecoveryError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("recovery-required", "$stages");
    }
    throw error;
  }
}

async function prepareStaleLockRecovery(
  root: RootedDirectory,
  authority: Readonly<WakeflowWindowHostBindingStoreAuthority>,
  signal: AbortSignal | undefined,
): Promise<void> {
  let lock;
  try {
    lock = await inspectRootedExclusiveFileLock(root, authority.lockRef);
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) fail("lock", "$lock");
    throw error;
  }
  if (lock.status === "absent") return;
  if (lock.ownerState !== "inactive") fail("lock", "$lock");
  await recoverStages(root, authority.bindingRefs, signal);
  try {
    await retireRootedExclusiveFileLockResidue(root, authority.lockRef, lock);
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) {
      fail("recovery-required", "$lock");
    }
    throw error;
  }
}

async function readInventory(
  root: RootedDirectory,
  authority: Readonly<WakeflowWindowHostBindingStoreAuthority>,
  signal: AbortSignal | undefined,
): Promise<Readonly<WakeflowWindowHostBindingInventory>> {
  let directory;
  try {
    directory = await readStableResourceDirectory(
      root,
      authority.bindingRootRef,
      {
        maximumEntries: authority.bindingRefs.length + 1,
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("layout", "$bindingRoot");
    }
    throw error;
  }
  privateNode(directory.directoryNode, "directory", "$bindingRoot");
  const expected = new Set(authority.bindingRefs);
  const bindings: Readonly<WakeflowWindowHostBinding>[] = [];
  for (const entry of directory.entries) {
    if (entry.resourcePath === authority.lockRef) {
      privateNode(entry.node, "file", "$lock");
      continue;
    }
    if (!expected.has(entry.resourcePath)) fail("inventory", "$inventory");
    privateNode(entry.node, "file", "$inventory");
    let read;
    try {
      read = await readDeterministicJsonFile(root, entry.resourcePath, {
        maximumBytes: MAXIMUM_BINDING_BYTES,
        expectedNode: entry.node,
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error: unknown) {
      if (error instanceof StableFileReadError && error.reason === "aborted") {
        fail("aborted", "$signal");
      }
      if (
        error instanceof StableFileReadError ||
        error instanceof StrictTextFileError ||
        error instanceof DeterministicJsonDocumentError
      ) {
        fail("inventory", "$inventory");
      }
      throw error;
    }
    let binding: Readonly<WakeflowWindowHostBinding>;
    try {
      binding = parseWakeflowWindowHostBindingDocument(
        read.text,
        authority.identityProfile,
      );
    } catch (error: unknown) {
      if (error instanceof WakeflowWindowHostBindingError) {
        fail("inventory", "$inventory");
      }
      throw error;
    }
    if (
      binding.programId !== authority.programId ||
      binding.hostId !== authority.resourceProfile.hostId ||
      wakeflowWindowHostBindingRef(
        authority.resourceProfile,
        binding.windowId,
      ) !== entry.resourcePath
    ) {
      fail("inventory", "$inventory");
    }
    bindings.push(binding);
  }
  const windowIds = new Set<WakeflowDurableId<"window">>();
  const bindingIds = new Set<string>();
  const handles = new Set<string>();
  for (const binding of bindings) {
    const handleKey = `${binding.handle.kind}\u0000${binding.handle.value}`;
    if (
      windowIds.has(binding.windowId) ||
      bindingIds.has(binding.bindingId) ||
      handles.has(handleKey)
    ) {
      fail("inventory", "$inventory");
    }
    windowIds.add(binding.windowId);
    bindingIds.add(binding.bindingId);
    handles.add(handleKey);
  }
  return Object.freeze({
    bindings: Object.freeze(bindings),
  });
}

function mapLockError(error: RootedExclusiveFileLockError): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "timeout") fail("lock", "$lock");
  if (
    error.reason === "unsafe-lock" ||
    error.reason === "parent" ||
    error.reason === "root-scope"
  ) {
    fail("lock", "$lock");
  }
  fail("recovery-required", "$lock");
}

async function assertInventoryLockAbsent(
  root: RootedDirectory,
  authority: Readonly<WakeflowWindowHostBindingStoreAuthority>,
): Promise<void> {
  try {
    const lock = await inspectRootedExclusiveFileLock(root, authority.lockRef);
    if (lock.status !== "absent") fail("lock", "$lock");
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostBindingStoreError) throw error;
    if (error instanceof RootedExclusiveFileLockError) fail("lock", "$lock");
    throw error;
  }
}

function sameInventory(
  left: Readonly<WakeflowWindowHostBindingInventory>,
  right: Readonly<WakeflowWindowHostBindingInventory>,
): boolean {
  return (
    canonicalizeJson(left, "$leftInventory") ===
    canonicalizeJson(right, "$rightInventory")
  );
}

/**
 * 零写入观察一份稳定的完整Binding inventory。
 *
 * 两次读取之间及结束时都要求mutation lock不存在；若一次完整注册恰好穿过观察窗口，
 * inventory差异会使本次读取失败关闭。该入口不创建锁、不恢复stage、不清理残留。
 */
export async function inspectWakeflowWindowHostBindingInventory(
  root: RootedDirectory,
  authority: Readonly<WakeflowWindowHostBindingStoreAuthority>,
  optionsValue: InspectWakeflowWindowHostBindingInventoryOptions = {},
): Promise<Readonly<WakeflowWindowHostBindingInventory>> {
  if (
    typeof root !== "object" ||
    root === null ||
    types.isProxy(root) ||
    !(root instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
  const { signal } = parseInspectOptions(optionsValue);
  assertNotAborted(signal);
  await assertInventoryLockAbsent(root, authority);
  const first = await readInventory(root, authority, signal);
  await assertInventoryLockAbsent(root, authority);
  const second = await readInventory(root, authority, signal);
  await assertInventoryLockAbsent(root, authority);
  if (!sameInventory(first, second)) fail("inventory", "$inventory");
  return second;
}

/** 在恢复后的专用锁内提供一份完整 Binding inventory。 */
export async function withWakeflowWindowHostBindingStore<Result>(
  root: RootedDirectory,
  authority: Readonly<WakeflowWindowHostBindingStoreAuthority>,
  optionsValue: WakeflowWindowHostBindingStoreOptions,
  operation: (
    context: Readonly<WakeflowWindowHostBindingStoreContext>,
  ) => Promise<Result>,
): Promise<Result> {
  if (
    typeof root !== "object" ||
    root === null ||
    types.isProxy(root) ||
    !(root instanceof RootedDirectory) ||
    typeof operation !== "function" ||
    types.isProxy(operation)
  ) {
    fail("input", "$store");
  }
  const options = parseOptions(optionsValue);
  assertNotAborted(options.signal);
  await prepareStaleLockRecovery(root, authority, options.signal);
  try {
    return await withRootedExclusiveFileLock(
      root,
      authority.lockRef,
      async () => {
        await recoverStages(root, authority.bindingRefs, options.signal);
        return operation(
          Object.freeze({
            inventory: await readInventory(root, authority, options.signal),
            uuidFactory: options.uuidFactory,
            wallClock: options.wallClock,
            signal: options.signal,
          }),
        );
      },
      {
        ...(options.acquireTimeoutMilliseconds === undefined
          ? {}
          : {
              acquireTimeoutMilliseconds: options.acquireTimeoutMilliseconds,
            }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostBindingStoreError) throw error;
    if (error instanceof RootedExclusiveFileLockError) mapLockError(error);
    throw error;
  }
}

/** 在已锁定 inventory 下 no-replace 创建一份新的 Binding authority。 */
export async function createWakeflowWindowHostBindingInStore(
  root: RootedDirectory,
  authority: Readonly<WakeflowWindowHostBindingCreateAuthority>,
  context: Readonly<WakeflowWindowHostBindingStoreContext>,
): Promise<Readonly<WakeflowWindowHostBinding>> {
  let registeredAt: UtcInstant;
  try {
    registeredAt =
      context.wallClock === undefined
        ? readUtcWallClock()
        : readUtcWallClock(context.wallClock);
  } catch (error: unknown) {
    if (error instanceof UtcWallClockError) fail("time", "$clock");
    throw error;
  }
  let binding: Readonly<WakeflowWindowHostBinding>;
  try {
    const allocatedBindingId = createWakeflowWindowHostBindingId(
      context.uuidFactory,
    );
    if (
      context.inventory.bindings.some(
        (entry) => entry.bindingId === allocatedBindingId,
      )
    ) {
      fail("binding-id", "$bindingId");
    }
    binding = createWakeflowWindowHostBinding(
      {
        programId: authority.programId,
        hostId: authority.resourceProfile.hostId,
        windowId: authority.windowId,
        bindingId: allocatedBindingId,
        handle: authority.handle,
        launchIntentDigest: authority.launchIntentDigest,
        observedAt: authority.observedAt,
        registeredAt,
      },
      authority.identityProfile,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostBindingIdError) {
      fail("binding-id", "$bindingId");
    }
    if (error instanceof WakeflowWindowHostBindingError) {
      if (error.reason === "time") fail("time", "$binding");
      fail("write", "$binding");
    }
    throw error;
  }
  try {
    await createFileAtomically(
      root,
      authority.bindingRef,
      encodeUtf8(
        renderWakeflowWindowHostBinding(binding, authority.identityProfile),
        "$binding",
      ),
      {
        mode: 0o600,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "stage-recovery-required") {
        fail("recovery-required", "$binding");
      }
      if (
        error.reason === "target-exists" ||
        error.reason === "commit-uncertain" ||
        error.reason === "durability-failure" ||
        error.reason === "stage-cleanup-failure" ||
        error.reason === "close-failure"
      ) {
        fail("write", "$binding", "unknown");
      }
      fail("write", "$binding");
    }
    throw error;
  }
  return binding;
}
