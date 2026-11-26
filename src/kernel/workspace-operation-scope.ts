import { AsyncLocalStorage } from "node:async_hooks";
import { readDeterministicJsonFile } from "../foundation/filesystem/deterministic-json-file.js";
import { KernelFileLockError } from "../foundation/filesystem/kernel-file-lock.js";
import { parsePortableResourcePath } from "../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectoryError,
  type RootedDirectory,
} from "../foundation/filesystem/rooted-directory.js";
import {
  withRootedReadWriteScope,
  RootedReadWriteScopeError,
  type RootedReadWriteMode,
} from "../foundation/filesystem/rooted-read-write-scope.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
} from "../foundation/filesystem/stable-directory-read.js";
import { parseByteCount } from "../foundation/numeric/byte-count.js";
import { fail, isWakeflowError } from "./error.js";
import { StableFileReadError } from "../foundation/filesystem/stable-file-read.js";
import { parsePlainRecord } from "../foundation/data/passive-own-data.js";
import {
  WORKSPACE_MAINTENANCE_TRANSACTIONS_REF,
  WAKEFLOW_CONFIG_SCHEMA_VERSION,
} from "./layout.js";
import {
  isWorkspaceLockHeld,
  materializeWorkspaceLocksRoot,
  WORKSPACE_LOCKS_ROOT_REF,
  workspaceLockRef,
} from "./workspace-locks.js";

interface ActiveScope {
  readonly root: RootedDirectory;
  readonly mode: RootedReadWriteMode;
  active: boolean;
}
const scopes = new AsyncLocalStorage<ActiveScope>();

export interface WorkspaceOperationScopeOptions {
  readonly signal?: AbortSignal;
  readonly acquireTimeoutMilliseconds?: number;
  /** Only the maintenance owner supplies this live guard, after its gate is held. */
  readonly maintenanceGuard?: () => Promise<void>;
}

/** Only the current workspace protocol can enter the writer admission boundary. */
async function assertWriterProtocol(root: RootedDirectory, signal?: AbortSignal): Promise<void> {
  try {
    const config = await readDeterministicJsonFile(
      root,
      parsePortableResourcePath("wakeflow.config.json"),
      {
        maximumBytes: parseByteCount(1024 * 1024),
        ...(signal === undefined ? {} : { signal }),
      },
    );
    const value = parsePlainRecord(config.value, "$config");
    if (value.kind !== "WakeflowConfig" || value.schemaVersion !== WAKEFLOW_CONFIG_SCHEMA_VERSION) {
      fail("precondition-failed", "writer-protocol-unsupported", "$config.schemaVersion");
    }
  } catch (error: unknown) {
    if (isWakeflowError(error)) throw error;
    if (error instanceof StableFileReadError && error.reason === "aborted")
      fail("io-failure", "aborted", "$signal");
    fail("precondition-failed", "config-authority", "$config", { cause: error });
  }
}

/**
 * 维护的保留条件：此刻有一次维护在跑（门被持有）就让调用方稍后重试；事务目录里留着意图就是上一次维护
 * 没有做完，要先恢复。门自己不留残留——持有者死掉时内核收走它（ADR-0033 决定 5）。
 */
async function assertNoMaintenanceReservation(root: RootedDirectory): Promise<void> {
  let busy: boolean;
  try {
    busy = await isWorkspaceLockHeld(root, "maintenance-gate");
  } catch (error: unknown) {
    if (error instanceof KernelFileLockError) {
      fail("io-failure", `maintenance-gate-${error.reason}`, "$workspace", { cause: error });
    }
    throw error;
  }
  if (busy) fail("concurrency-conflict", "maintenance-busy", "$workspace", { retryable: true });
  try {
    const entries = await readStableResourceDirectory(
      root,
      WORKSPACE_MAINTENANCE_TRANSACTIONS_REF,
      { maximumEntries: 1024 },
    );
    if (entries.entries.length > 0)
      fail("precondition-failed", "maintenance-recovery-required", "$workspace");
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError && error.reason === "not-found") return;
    throw error;
  }
}

async function prepareScope(
  root: RootedDirectory,
  mode: RootedReadWriteMode,
  options: WorkspaceOperationScopeOptions,
): Promise<void> {
  if (options.maintenanceGuard !== undefined) {
    if (mode !== "exclusive") fail("unexpected", "maintenance-scope-mode", "$workspace");
    await options.maintenanceGuard();
    await materializeWorkspaceLocksRoot(root, options.signal);
    return;
  }
  await assertWriterProtocol(root, options.signal);
  try {
    await root.inspectExistingResource(WORKSPACE_LOCKS_ROOT_REF, "$scope");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError && error.reason === "resource-not-found")
      fail("precondition-failed", "operation-scope-missing", "$workspace");
    throw error;
  }
}

function assertBorrowable(
  current: ActiveScope,
  root: RootedDirectory,
  mode: RootedReadWriteMode,
): void {
  if (current.root.absolutePath !== root.absolutePath)
    fail("precondition-failed", "operation-scope-root-mismatch", "$workspace");
  if (!current.active) fail("precondition-failed", "operation-scope-expired", "$workspace");
  if (mode === "exclusive" && current.mode !== "exclusive")
    fail("precondition-failed", "operation-scope-promotion", "$workspace");
}

function mapScopeError(error: unknown): never {
  if (error instanceof RootedReadWriteScopeError) {
    if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
    fail("concurrency-conflict", `operation-scope-${error.reason}`, "$workspace", {
      cause: error,
      retryable: error.reason === "timeout",
    });
  }
  throw error;
}

/** Scope encloses context loading and settlement. Nested owners borrow; they cannot promote. */
export async function withWorkspaceOperationScope<Result>(
  root: RootedDirectory,
  mode: RootedReadWriteMode,
  operation: () => Promise<Result>,
  options: WorkspaceOperationScopeOptions = {},
): Promise<Result> {
  if (options.signal?.aborted === true) fail("io-failure", "aborted", "$signal");
  const current = scopes.getStore();
  if (current !== undefined) {
    // 维护 gate 只能由最外层作用域持有：借用的作用域没有执行过 guard（§13.161 F8）。
    if (options.maintenanceGuard !== undefined)
      fail("unexpected", "maintenance-scope-borrowed", "$workspace");
    assertBorrowable(current, root, mode);
    await current.root.assertCurrent();
    await root.assertCurrent();
    assertBorrowable(current, root, mode);
    return operation();
  }
  await prepareScope(root, mode, options);
  const scope: ActiveScope = { root, mode, active: true };
  try {
    return await withRootedReadWriteScope(
      root,
      { gate: workspaceLockRef("operation-gate"), scope: workspaceLockRef("operation-scope") },
      mode,
      () =>
        scopes.run(scope, async () => {
          try {
            return await operation();
          } finally {
            scope.active = false;
          }
        }),
      {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(options.acquireTimeoutMilliseconds === undefined
          ? {}
          : { acquireTimeoutMilliseconds: options.acquireTimeoutMilliseconds }),
        beforeEnter: options.maintenanceGuard ?? (() => assertNoMaintenanceReservation(root)),
      },
    );
  } catch (error: unknown) {
    mapScopeError(error);
  } finally {
    scope.active = false;
  }
}
