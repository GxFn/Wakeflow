import { AsyncLocalStorage } from "node:async_hooks";
import { readDeterministicJsonFile } from "../foundation/filesystem/deterministic-json-file.js";
import { materializeDirectoryPath } from "../foundation/filesystem/durable-directory-materialization.js";
import { parsePortableResourcePath } from "../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectoryError,
  type RootedDirectory,
} from "../foundation/filesystem/rooted-directory.js";
import {
  inspectRootedExclusiveFileLock,
  RootedExclusiveFileLockError,
} from "../foundation/filesystem/rooted-exclusive-file-lock.js";
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
  WORKSPACE_MAINTENANCE_GATE_REF,
  WORKSPACE_MAINTENANCE_TRANSACTIONS_REF,
  WORKSPACE_OPERATION_SCOPES_REF,
  WAKEFLOW_CONFIG_SCHEMA_VERSION,
} from "./layout.js";

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

async function assertNoMaintenanceReservation(root: RootedDirectory): Promise<void> {
  const gate = await inspectRootedExclusiveFileLock(root, WORKSPACE_MAINTENANCE_GATE_REF);
  if (gate.status === "held") {
    fail(
      "concurrency-conflict",
      gate.ownerState === "active" ? "maintenance-busy" : "maintenance-recovery-required",
      "$workspace",
      { retryable: gate.ownerState === "active" },
    );
  }
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
    await materializeDirectoryPath(root, WORKSPACE_OPERATION_SCOPES_REF, {
      mode: 0o700,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    return;
  }
  await assertWriterProtocol(root, options.signal);
  try {
    await root.inspectExistingResource(WORKSPACE_OPERATION_SCOPES_REF, "$scope");
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
  if (error instanceof RootedReadWriteScopeError || error instanceof RootedExclusiveFileLockError) {
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
      WORKSPACE_OPERATION_SCOPES_REF,
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
