import { types } from "node:util";

import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  recoverDurableAtomicFileStagesForTargets,
  DurableAtomicFileStageRecoveryError,
} from "../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import {
  materializeDirectoryPath,
  DurableDirectoryMaterializationError,
} from "../../foundation/filesystem/durable-directory-materialization.js";
import type { FileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
} from "../../foundation/filesystem/stable-directory-read.js";
import {
  TODO_AUTHORITY_DIRECTORY_MODE,
  TODO_AUTHORITY_FILE_MODE,
  type TodoCollectionAuthoritySnapshot,
} from "./todo-collection-authority.js";
import {
  TODO_COLLECTION_INITIALIZATION_AUTHORITY_DIGEST,
  TODO_EMPTY_BOARD_PROJECTION,
  TODO_EMPTY_COLLECTION_SNAPSHOT,
} from "./todo-collection-initialization-authority.js";
import {
  initializeTodoCollection,
  TodoCollectionServiceError,
} from "./todo-collection-service.js";
import {
  TODO_BOARD_PROJECTION_REF,
  TODO_COLLECTION_ROOT_REF,
  TODO_ITEMS_ROOT_REF,
  TODO_TRANSACTIONS_ROOT_REF,
} from "./todo-paths.js";

/**
 * Wakeflow Governance / TODO：Fresh Active Layout 中空集合的严格初始化边界。
 *
 * 普通执行要求 TODO 根严格不存在。affected-step 恢复只接受空 items/transactions、
 * 可选的空集合投影及其 Foundation stage；发现条目、事务、锁或未知资源时保持现场并
 * 失败。实际目录与投影写入继续委托给 `todo-collection-service`。
 */

export interface FreshTodoCollectionInitializationOptions {
  readonly recoveringFreshCollection: boolean;
  readonly signal?: AbortSignal;
}

export interface FreshTodoCollectionInitializationResult {
  readonly disposition: "created" | "current";
  readonly authorityDigest: typeof TODO_COLLECTION_INITIALIZATION_AUTHORITY_DIGEST;
  readonly snapshot: Readonly<TodoCollectionAuthoritySnapshot>;
}

export type FreshTodoCollectionInitializationErrorReason =
  | "input"
  | "strict-absent"
  | "prefix-conflict"
  | "owner"
  | "root-scope"
  | "aborted";

const ERROR_MESSAGES = {
  input: "Fresh TODO collection initialization input is invalid.",
  "strict-absent": "Fresh TODO collection root already exists.",
  "prefix-conflict": "Fresh TODO collection recovery prefix is not exact and empty.",
  owner: "Fresh TODO collection owner failed to establish empty authority.",
  "root-scope": "Fresh TODO collection initialization lost workspace scope.",
  aborted: "Fresh TODO collection initialization was aborted.",
} as const satisfies Readonly<Record<
  FreshTodoCollectionInitializationErrorReason,
  string
>>;

/** Fresh TODO Collection 初始化失败的稳定、脱敏错误。 */
export class FreshTodoCollectionInitializationError extends Error {
  override readonly name = "FreshTodoCollectionInitializationError";
  readonly code = "wakeflow-fresh-todo-collection-initialization" as const;
  readonly reason: FreshTodoCollectionInitializationErrorReason;
  readonly path: string;

  constructor(
    reason: FreshTodoCollectionInitializationErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedOptions {
  readonly recoveringFreshCollection: boolean;
  readonly signal: AbortSignal | undefined;
}

function fail(
  reason: FreshTodoCollectionInitializationErrorReason,
  path: string,
): never {
  throw new FreshTodoCollectionInitializationError(reason, path);
}

function parseOptions(value: unknown): Readonly<ParsedOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (
    !Object.hasOwn(record, "recoveringFreshCollection")
    || Object.keys(record).some((key) => (
      key !== "recoveringFreshCollection" && key !== "signal"
    ))
    || typeof record.recoveringFreshCollection !== "boolean"
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
  return Object.freeze({
    recoveringFreshCollection: record.recoveringFreshCollection,
    signal: record.signal as AbortSignal | undefined,
  });
}

function currentUserId(): bigint | null {
  return typeof process.geteuid === "function"
    ? BigInt(process.geteuid())
    : null;
}

function assertPrivateNode(
  node: Readonly<FileNodeSnapshot>,
  kind: "directory" | "file",
  path: string,
): void {
  const expectedMode = kind === "directory"
    ? TODO_AUTHORITY_DIRECTORY_MODE
    : TODO_AUTHORITY_FILE_MODE;
  if (
    node.kind !== kind
    || node.permissionBits !== expectedMode
    || (kind === "file" && node.linkCount !== 1n)
    || (currentUserId() !== null && node.userId !== currentUserId())
  ) {
    fail("prefix-conflict", path);
  }
}

async function todoRootOrNull(root: RootedDirectory) {
  try {
    return await root.inspectExistingResource(TODO_COLLECTION_ROOT_REF);
  } catch (error: unknown) {
    if (
      error instanceof RootedDirectoryError
      && error.reason === "resource-not-found"
    ) return null;
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root");
    throw error;
  }
}

async function readDirectory(
  root: RootedDirectory,
  resourcePath: typeof TODO_COLLECTION_ROOT_REF,
  maximumEntries: number,
  signal: AbortSignal | undefined,
) {
  try {
    return await readStableResourceDirectory(root, resourcePath, {
      maximumEntries,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "root-scope") fail("root-scope", "$root");
      fail("prefix-conflict", `$prefix/${resourcePath}`);
    }
    throw error;
  }
}

async function assertRecoverableEmptyPrefix(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<void> {
  const todoRoot = await todoRootOrNull(root);
  if (todoRoot === null) fail("prefix-conflict", "$prefix/todo");
  assertPrivateNode(todoRoot.node, "directory", "$prefix/todo");
  try {
    const recovery = await recoverDurableAtomicFileStagesForTargets(
      root,
      [TODO_BOARD_PROJECTION_REF],
      signal === undefined ? undefined : { signal },
    );
    if (recovery.activeStageCount !== 0 || recovery.unknownStageCount !== 0) {
      fail("prefix-conflict", "$prefix/projection-stage");
    }
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileStageRecoveryError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "root-scope") fail("root-scope", "$root");
      fail("prefix-conflict", "$prefix/projection-stage");
    }
    throw error;
  }
  const directory = await readDirectory(
    root,
    TODO_COLLECTION_ROOT_REF,
    4,
    signal,
  );
  assertPrivateNode(directory.directoryNode, "directory", "$prefix/todo");
  if (directory.entries.some((entry) => (
    entry.name !== "items"
    && entry.name !== "transactions"
    && entry.name !== "global-todo-board.md"
  ))) {
    fail("prefix-conflict", "$prefix/todo");
  }
  for (const entry of directory.entries) {
    if (entry.name === "global-todo-board.md") {
      assertPrivateNode(entry.node, "file", "$prefix/projection");
      continue;
    }
    assertPrivateNode(entry.node, "directory", `$prefix/${entry.name}`);
    const resourcePath = entry.name === "items"
      ? TODO_ITEMS_ROOT_REF
      : TODO_TRANSACTIONS_ROOT_REF;
    const child = await readDirectory(root, resourcePath, 1, signal);
    if (child.entries.length !== 0) {
      fail("prefix-conflict", `$prefix/${entry.name}`);
    }
  }
}

async function materializeTodoRoot(
  root: RootedDirectory,
  requireCreated: boolean,
  signal: AbortSignal | undefined,
): Promise<"created" | "existing"> {
  try {
    const materialized = await materializeDirectoryPath(
      root,
      TODO_COLLECTION_ROOT_REF,
      {
        mode: TODO_AUTHORITY_DIRECTORY_MODE,
        ...(signal === undefined ? {} : { signal }),
      },
    );
    const target = materialized.segments.at(-1);
    if (
      target === undefined
      || (requireCreated && target.disposition !== "created")
    ) {
      fail("strict-absent", "$todoRoot");
    }
    assertPrivateNode(materialized.node, "directory", "$todoRoot");
    return target.disposition;
  } catch (error: unknown) {
    if (error instanceof FreshTodoCollectionInitializationError) throw error;
    if (error instanceof DurableDirectoryMaterializationError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "root-scope") fail("root-scope", "$root");
      fail("owner", "$todoRoot");
    }
    throw error;
  }
}

function assertEmptyAuthority(
  snapshot: Readonly<TodoCollectionAuthoritySnapshot>,
): void {
  if (
    snapshot.collection.collectionDigest
      !== TODO_EMPTY_COLLECTION_SNAPSHOT.collectionDigest
    || snapshot.collection.itemCount !== 0
    || snapshot.collection.activeItemCount !== 0
    || snapshot.items.length !== 0
    || snapshot.projection.status !== "current"
    || snapshot.projection.expected.sourceDigest
      !== TODO_EMPTY_BOARD_PROJECTION.sourceDigest
    || snapshot.projection.source?.digest
      !== TODO_EMPTY_BOARD_PROJECTION.sourceDigest
  ) {
    fail("owner", "$snapshot");
  }
}

/** 在 Fresh Active Layout 内独占建立空 TODO Collection，或恢复其 exact 空前缀。 */
export async function initializeFreshTodoCollection(
  rootValue: RootedDirectory,
  optionsValue: FreshTodoCollectionInitializationOptions,
): Promise<Readonly<FreshTodoCollectionInitializationResult>> {
  if (
    typeof rootValue !== "object"
    || rootValue === null
    || types.isProxy(rootValue)
    || !(rootValue instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
  const options = parseOptions(optionsValue);
  if (options.signal?.aborted === true) fail("aborted", "$signal");
  const existed = await todoRootOrNull(rootValue) !== null;
  if (existed && !options.recoveringFreshCollection) {
    fail("strict-absent", "$todoRoot");
  }
  if (existed) {
    await assertRecoverableEmptyPrefix(rootValue, options.signal);
  }
  const rootDisposition = await materializeTodoRoot(
    rootValue,
    !options.recoveringFreshCollection,
    options.signal,
  );
  let snapshot: Readonly<TodoCollectionAuthoritySnapshot>;
  try {
    snapshot = await initializeTodoCollection(rootValue, {
      freshWorkspace: true,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error: unknown) {
    if (error instanceof TodoCollectionServiceError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("owner", "$todoCollection");
    }
    throw error;
  }
  assertEmptyAuthority(snapshot);
  return Object.freeze({
    disposition: rootDisposition === "created" ? "created" : "current",
    authorityDigest: TODO_COLLECTION_INITIALIZATION_AUTHORITY_DIGEST,
    snapshot,
  });
}
