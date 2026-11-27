import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { canonicalizeJson } from "../../foundation/data/canonical-json.js";
import { DeterministicJsonDocumentError } from "../../foundation/data/deterministic-json-document.js";
import { ModuleError } from "../../foundation/error/module-error.js";
import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import { hasDurableAtomicFileStagePrefix } from "../../foundation/filesystem/durable-atomic-file-stage-address.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import {
  isPrivateDirectory,
  isPrivateFile,
} from "../../foundation/filesystem/private-node-policy.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
} from "../../foundation/filesystem/stable-directory-read.js";
import { StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../foundation/filesystem/strict-text-file.js";
import type { UuidV4Factory } from "../../foundation/identity/uuid-v4.js";
import { throwIfAborted } from "../../foundation/node/abort-signal.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import type { UtcInstant } from "../../foundation/time/utc-instant.js";
import {
  readUtcWallClock,
  type UtcWallClock,
  UtcWallClockError,
} from "../../foundation/time/wall-clock.js";
import {
  settleStagesOfDeadWritersStrictly,
  withWorkspaceLockOrRefuse,
} from "../../kernel/workspace-locks.js";
import type { WakeflowWorkspaceHostResourceProfile } from "../workspace-host-resource-profile.js";
import {
  createWakeflowWindowHostBinding,
  parseWakeflowWindowHostBindingDocument,
  renderWakeflowWindowHostBinding,
  type WakeflowWindowHostBinding,
  WakeflowWindowHostBindingError,
  type WakeflowWindowHostBindingLaunch,
} from "./wakeflow-window-host-binding.js";
import {
  createWakeflowWindowHostBindingId,
  WakeflowWindowHostBindingIdError,
} from "./wakeflow-window-host-binding-id.js";
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
}

/** 首次注册写入在通用Store authority之外必须提供的创建事实。 */
export interface WakeflowWindowHostBindingCreateAuthority
  extends WakeflowWindowHostBindingStoreAuthority {
  readonly windowId: WakeflowDurableId<"window">;
  readonly bindingRef: PortableResourcePath;
  readonly launchIntentDigest: Sha256Digest;
  readonly handle: Readonly<WakeflowWindowHostHandle>;
  readonly observedAt: UtcInstant;
  /** 握手时的启动事实；不给就不记（见 Binding 记录的 `launch`）。 */
  readonly launch?: Readonly<WakeflowWindowHostBindingLaunch>;
}

export interface InspectWakeflowWindowHostBindingInventoryOptions {
  readonly signal?: AbortSignal;
}

export interface WakeflowWindowHostBindingInventory {
  readonly bindings: readonly Readonly<WakeflowWindowHostBinding>[];
}

export interface WakeflowWindowHostBindingStoreContext {
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
  | "time"
  | "binding-id"
  | "write";

/** Binding store 物理操作失败的稳定、脱敏错误。 */
export class WakeflowWindowHostBindingStoreError extends ModuleError<WakeflowWindowHostBindingStoreErrorReason> {
  static override readonly code = "wakeflow-window-host-binding-store";
  readonly bindingAuthority: "unchanged" | "unknown";

  constructor(
    reason: WakeflowWindowHostBindingStoreErrorReason,
    path: string,
    bindingAuthority: "unchanged" | "unknown" = "unchanged",
  ) {
    super(reason, path);
    this.bindingAuthority = bindingAuthority;
  }
}

const MAXIMUM_BINDING_BYTES = parseByteCount(64 * 1024);

function fail(
  reason: WakeflowWindowHostBindingStoreErrorReason,
  path: string,
  bindingAuthority: "unchanged" | "unknown" = "unchanged",
): never {
  throw new WakeflowWindowHostBindingStoreError(reason, path, bindingAuthority);
}

async function readInventory(
  root: RootedDirectory,
  authority: Readonly<WakeflowWindowHostBindingStoreAuthority>,
  signal: AbortSignal | undefined,
): Promise<Readonly<WakeflowWindowHostBindingInventory>> {
  let directory: Awaited<ReturnType<typeof readStableResourceDirectory>>;
  try {
    // 登记表的成员之外，最多还有一份登记文件的暂存和一个文件锁版本留下的登记锁。
    directory = await readStableResourceDirectory(root, authority.bindingRootRef, {
      maximumEntries: authority.bindingRefs.length + 2,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError) {
      fail("layout", "$bindingRoot");
    }
    throw error;
  }
  if (!isPrivateDirectory(directory.directoryNode)) fail("layout", "$bindingRoot");
  const expected = new Set(authority.bindingRefs);
  const bindings: Readonly<WakeflowWindowHostBinding>[] = [];
  for (const entry of directory.entries) {
    // 登记留下的原子暂存不是成员；清它们的是下一次登记。
    if (hasDurableAtomicFileStagePrefix(entry.name)) continue;
    // 文件锁版本（1.4.3 及之前）的登记被强杀后留下的锁文件也不是成员：它挡住登记表，就挡住了删掉它的
    // 那次维护（ADR-0033 决定 10）。与清理一起只活一个版本。
    if (entry.name === ".registration.lock") continue;
    if (!expected.has(entry.resourcePath)) fail("inventory", "$inventory");
    if (!isPrivateFile(entry.node)) fail("layout", "$inventory");
    let read: Awaited<ReturnType<typeof readDeterministicJsonFile>>;
    try {
      read = await readDeterministicJsonFile(root, entry.resourcePath, {
        maximumBytes: MAXIMUM_BINDING_BYTES,
        expectedNode: entry.node,
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error: unknown) {
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
      binding = parseWakeflowWindowHostBindingDocument(read.text, authority.identityProfile);
    } catch (error: unknown) {
      if (error instanceof WakeflowWindowHostBindingError) {
        fail("inventory", "$inventory");
      }
      throw error;
    }
    if (
      binding.programId !== authority.programId ||
      binding.hostId !== authority.resourceProfile.hostId ||
      wakeflowWindowHostBindingRef(authority.resourceProfile, binding.windowId) !==
        entry.resourcePath
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

function sameInventory(
  left: Readonly<WakeflowWindowHostBindingInventory>,
  right: Readonly<WakeflowWindowHostBindingInventory>,
): boolean {
  return canonicalizeJson(left, "$leftInventory") === canonicalizeJson(right, "$rightInventory");
}

/**
 * 零写入观察一份稳定的完整Binding inventory。
 *
 * 读两遍并比较：一次登记恰好穿过观察窗口时两遍不同，本次读取失败关闭。登记锁在不在不影响读（1.4.2）：
 * 以前锁在场就拒绝，而持有者死掉之后只有下一次登记才清它，这期间每一个只读的调用都失败。现在读到的
 * 是此刻盘面上的登记表——与一次正在进行的登记同时发生时，可能是它之前的样子。锁文件与属于登记的原子
 * 暂存不算登记表的成员。该入口不创建锁、不恢复stage、不清理残留。
 */
export async function inspectWakeflowWindowHostBindingInventory(
  root: RootedDirectory,
  authority: Readonly<WakeflowWindowHostBindingStoreAuthority>,
  { signal }: InspectWakeflowWindowHostBindingInventoryOptions = {},
): Promise<Readonly<WakeflowWindowHostBindingInventory>> {
  throwIfAborted(signal);
  const first = await readInventory(root, authority, signal);
  const second = await readInventory(root, authority, signal);
  if (!sameInventory(first, second)) fail("inventory", "$inventory");
  return second;
}

/** 在恢复后的专用锁内提供一份完整 Binding inventory。 */
export async function withWakeflowWindowHostBindingStore<Result>(
  root: RootedDirectory,
  authoritySource:
    | Readonly<WakeflowWindowHostBindingStoreAuthority>
    | (() => Promise<Readonly<WakeflowWindowHostBindingStoreAuthority>>),
  {
    uuidFactory,
    wallClock,
    signal,
    acquireTimeoutMilliseconds,
  }: WakeflowWindowHostBindingStoreOptions,
  operation: (context: Readonly<WakeflowWindowHostBindingStoreContext>) => Promise<Result>,
): Promise<Result> {
  throwIfAborted(signal);
  const authority =
    typeof authoritySource === "function" ? await authoritySource() : authoritySource;
  // 登记锁（ADR-0033）：两个宿主的登记共用一把；上一次登记留下的暂存在锁内先恢复（见下）。
  return withWorkspaceLockOrRefuse(
    root,
    "window-binding",
    async () => {
      const current = typeof authoritySource === "function" ? await authoritySource() : authority;
      if (
        current.bindingRootRef !== authority.bindingRootRef ||
        current.programId !== authority.programId ||
        current.resourceProfile.hostId !== authority.resourceProfile.hostId
      ) {
        fail("input", "$authority");
      }
      await settleStagesOfDeadWritersStrictly(root, current.bindingRefs, "closed", signal, () =>
        fail("recovery-required", "$stages"),
      );
      return operation(
        Object.freeze({
          inventory: await readInventory(root, current, signal),
          uuidFactory,
          wallClock,
          signal,
        }),
      );
    },
    () => fail("lock", "$lock"),
    {
      ...(acquireTimeoutMilliseconds === undefined ? {} : { acquireTimeoutMilliseconds }),
      ...(signal === undefined ? {} : { signal }),
    },
  );
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
      context.wallClock === undefined ? readUtcWallClock() : readUtcWallClock(context.wallClock);
  } catch (error: unknown) {
    if (error instanceof UtcWallClockError) fail("time", "$clock");
    throw error;
  }
  let binding: Readonly<WakeflowWindowHostBinding>;
  try {
    const allocatedBindingId = createWakeflowWindowHostBindingId(context.uuidFactory);
    if (context.inventory.bindings.some((entry) => entry.bindingId === allocatedBindingId)) {
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
        ...(authority.launch === undefined ? {} : { launch: authority.launch }),
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
      encodeUtf8(renderWakeflowWindowHostBinding(binding, authority.identityProfile), "$binding"),
      {
        mode: 0o600,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) {
      if (error.reason === "stage-recovery-required") {
        fail("recovery-required", "$binding");
      }
      if (error.reason === "target-exists" || error.commitUncertain) {
        fail("write", "$binding", "unknown");
      }
      fail("write", "$binding");
    }
    throw error;
  }
  return binding;
}
