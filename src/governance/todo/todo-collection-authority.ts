import { types } from "node:util";

import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { DeterministicJsonDocumentError } from "../../foundation/data/deterministic-json-document.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  scanBoundedResourceDirectoryTree,
  BoundedDirectoryTreeScanError,
  type BoundedDirectoryTreeEntry,
  type BoundedDirectoryTreeScanResult,
} from "../../foundation/filesystem/bounded-directory-tree-scan.js";
import {
  readDeterministicJsonFile,
  type DeterministicJsonFileResult,
} from "../../foundation/filesystem/deterministic-json-file.js";
import {
  sameFileNodeSnapshot,
  type FileNodeSnapshot,
} from "../../foundation/filesystem/file-node-snapshot.js";
import {
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
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
  type StrictTextFileResult,
} from "../../foundation/filesystem/strict-text-file.js";
import { parseByteCount, type ByteCount } from "../../foundation/numeric/byte-count.js";
import {
  renderTodoBoardProjection,
  type TodoBoardProjection,
} from "./todo-board-projection.js";
import {
  createTodoCollectionSnapshot,
  type TodoCollectionItem,
  type TodoCollectionSnapshot,
} from "./todo-collection.js";
import {
  parseTodoIntake,
  renderTodoIntake,
  TodoIntakeError,
} from "./todo-intake.js";
import {
  TODO_BOARD_PROJECTION_REF,
  TODO_COLLECTION_ROOT_REF,
  TODO_ITEMS_ROOT_REF,
  TODO_TRANSACTIONS_ROOT_REF,
  todoIntakeRef,
  todoItemStorageKey,
  todoStateRef,
  type TodoItemStorageKey,
} from "./todo-paths.js";
import {
  parseTodoState,
  renderTodoState,
  TodoStateError,
} from "./todo-state.js";

/**
 * Wakeflow Governance / TODO：TODO JSON aggregate 的只读物理 authority snapshot。
 *
 * 本文件有界扫描 `items/`，要求每个 storage-key directory 只包含 single-link 0600
 * `intake.json` 和 `state.json`，稳定读取并在第二次完整扫描中复验整棵 item tree。
 * `transactions/` 非空会阻断 normal authority；Markdown projection 仅返回
 * current/missing/stale 诊断，不参与 collection digest 或业务准入。
 */

export const TODO_AUTHORITY_FILE_MODE = 0o600;
export const TODO_AUTHORITY_DIRECTORY_MODE = 0o700;
export const TODO_INTAKE_MAXIMUM_BYTES = parseByteCount(256 * 1024);
export const TODO_STATE_MAXIMUM_BYTES = parseByteCount(128 * 1024);
export const TODO_PROJECTION_MAXIMUM_BYTES = parseByteCount(8 * 1024 * 1024);
export const TODO_ITEM_TREE_MAXIMUM_ENTRIES = 65_536 * 3;

export interface TodoAuthorityFileSource {
  readonly resourcePath: PortableResourcePath;
  readonly node: Readonly<FileNodeSnapshot>;
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
}

export interface StoredTodoCollectionItem extends TodoCollectionItem {
  readonly intakeSource: Readonly<TodoAuthorityFileSource>;
  readonly stateSource: Readonly<TodoAuthorityFileSource>;
}

export interface TodoProjectionObservation {
  readonly status: "current" | "missing" | "stale" | "unsafe";
  readonly expected: Readonly<TodoBoardProjection>;
  readonly source: Readonly<TodoAuthorityFileSource> | null;
}

export interface TodoCollectionAuthoritySnapshot {
  readonly collection: Readonly<TodoCollectionSnapshot>;
  readonly items: readonly Readonly<StoredTodoCollectionItem>[];
  readonly projection: Readonly<TodoProjectionObservation>;
}

export interface InspectTodoCollectionAuthorityOptions {
  readonly signal?: AbortSignal;
}

export type TodoCollectionAuthorityErrorReason =
  | "input"
  | "root-scope"
  | "not-initialized"
  | "recovery-required"
  | "tree-shape"
  | "source-policy"
  | "source-changed"
  | "encoding"
  | "record"
  | "aborted"
  | "inspection-failure";

const ERROR_MESSAGES = {
  "input": "TODO collection authority input is invalid.",
  "root-scope": "TODO collection could not establish its rooted scope.",
  "not-initialized": "TODO collection authority roots are not initialized.",
  "recovery-required": "TODO collection contains a pending transaction journal.",
  "tree-shape": "TODO collection item tree does not match its closed layout.",
  "source-policy": "TODO collection resource violates its physical node policy.",
  "source-changed": "TODO collection changed while it was inspected.",
  "encoding": "TODO collection record is not strict UTF-8 text.",
  "record": "TODO collection record is invalid or non-deterministic.",
  "aborted": "TODO collection inspection was aborted.",
  "inspection-failure": "TODO collection could not be inspected safely.",
} as const satisfies Readonly<Record<
  TodoCollectionAuthorityErrorReason,
  string
>>;

/** TODO collection 物理读取失败的稳定、脱敏错误。 */
export class TodoCollectionAuthorityError extends Error {
  override readonly name = "TodoCollectionAuthorityError";
  readonly code = "wakeflow-todo-collection-authority" as const;
  readonly reason: TodoCollectionAuthorityErrorReason;
  readonly path: string;

  constructor(reason: TodoCollectionAuthorityErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedOptions {
  readonly signal: AbortSignal | undefined;
}

interface ItemTreeGroup {
  readonly storageKey: TodoItemStorageKey;
  readonly directory: Readonly<BoundedDirectoryTreeEntry>;
  readonly intake: Readonly<BoundedDirectoryTreeEntry>;
  readonly state: Readonly<BoundedDirectoryTreeEntry>;
}

const STORAGE_KEY_PATTERN = /^item-[0-9a-f]{64}$/u;

function fail(
  reason: TodoCollectionAuthorityErrorReason,
  path: string,
): never {
  throw new TodoCollectionAuthorityError(reason, path);
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof value === "object"
    && value !== null
    && !types.isProxy(value)
    && value instanceof AbortSignal;
}

function parseOptions(value: unknown): Readonly<ParsedOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (Object.keys(record).some((key) => key !== "signal")) {
    fail("input", "$options");
  }
  if (record.signal !== undefined && !isAbortSignal(record.signal)) {
    fail("input", "$options/signal");
  }
  return Object.freeze({ signal: record.signal });
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

function currentUserId(): bigint | null {
  return typeof process.geteuid === "function"
    ? BigInt(process.geteuid())
    : null;
}

function assertPrivateNode(
  node: Readonly<FileNodeSnapshot>,
  kind: "file" | "directory",
  path: string,
): void {
  const expectedMode = kind === "file"
    ? TODO_AUTHORITY_FILE_MODE
    : TODO_AUTHORITY_DIRECTORY_MODE;
  if (
    node.kind !== kind
    || node.permissionBits !== expectedMode
    || (kind === "file" && node.linkCount !== 1n)
    || (currentUserId() !== null && node.userId !== currentUserId())
  ) {
    fail("source-policy", path);
  }
}

function mapTreeError(error: BoundedDirectoryTreeScanError): never {
  if (error.reason === "input") fail("input", error.path);
  if (error.reason === "not-found") fail("not-initialized", "$items");
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "source-changed") fail("source-changed", "$items");
  if (error.reason === "root-scope") fail("root-scope", "$root");
  if (
    error.reason === "entry-limit"
    || error.reason === "depth-limit"
    || error.reason === "entry-path"
    || error.reason === "symlink"
    || error.reason === "not-directory"
  ) {
    fail("tree-shape", "$items");
  }
  fail("inspection-failure", "$items");
}

async function scanItems(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<BoundedDirectoryTreeScanResult<PortableResourcePath>>> {
  try {
    return await scanBoundedResourceDirectoryTree(root, TODO_ITEMS_ROOT_REF, {
      maximumEntries: TODO_ITEM_TREE_MAXIMUM_ENTRIES,
      maximumDepth: 2,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof BoundedDirectoryTreeScanError) mapTreeError(error);
    throw error;
  }
}

function groupItemTree(
  tree: Readonly<BoundedDirectoryTreeScanResult<PortableResourcePath>>,
): readonly Readonly<ItemTreeGroup>[] {
  assertPrivateNode(tree.treeRootNode, "directory", "$items");
  const direct = tree.entries.filter((entry) => entry.depth === 1);
  const groups: ItemTreeGroup[] = [];
  for (const [index, directory] of direct.entries()) {
    if (
      directory.node.kind !== "directory"
      || !STORAGE_KEY_PATTERN.test(directory.name)
    ) {
      fail("tree-shape", `$items/${index}`);
    }
    assertPrivateNode(directory.node, "directory", `$items/${index}`);
    const children = tree.entries.filter(
      (entry) => entry.parentResourcePath === directory.resourcePath,
    );
    if (
      children.length !== 2
      || children[0]?.name !== "intake.json"
      || children[1]?.name !== "state.json"
      || children.some((entry) => entry.depth !== 2 || entry.node.kind !== "file")
    ) {
      fail("tree-shape", `$items/${index}`);
    }
    const intake = children[0];
    const state = children[1];
    if (intake === undefined || state === undefined) {
      fail("tree-shape", `$items/${index}`);
    }
    assertPrivateNode(intake.node, "file", `$items/${index}/intake`);
    assertPrivateNode(state.node, "file", `$items/${index}/state`);
    groups.push(Object.freeze({
      storageKey: directory.name as TodoItemStorageKey,
      directory,
      intake,
      state,
    }));
  }
  if (tree.entries.length !== groups.length * 3) fail("tree-shape", "$items");
  return Object.freeze(groups);
}

function mapFileReadError(error: StableFileReadError): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (
    error.reason === "expectation-changed"
    || error.reason === "source-changed"
  ) {
    fail("source-changed", "$items");
  }
  if (
    error.reason === "root-scope"
    || error.reason === "unsupported-platform"
  ) {
    fail("root-scope", "$root");
  }
  if (error.reason === "not-found") fail("source-changed", "$items");
  fail("inspection-failure", "$items");
}

function mapTextError(error: StrictTextFileError): never {
  if (error.reason === "utf8" || error.reason === "bom") {
    fail("encoding", "$items");
  }
  fail("record", "$items");
}

function mapJsonDocumentError(_error: DeterministicJsonDocumentError): never {
  fail("record", "$items");
}

async function readJsonRecordFile(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  maximumBytes: ByteCount,
  expectedNode: Readonly<FileNodeSnapshot>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DeterministicJsonFileResult>> {
  try {
    return await readDeterministicJsonFile(root, resourcePath, {
      maximumBytes,
      expectedNode,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) mapFileReadError(error);
    if (error instanceof StrictTextFileError) mapTextError(error);
    if (error instanceof DeterministicJsonDocumentError) {
      mapJsonDocumentError(error);
    }
    throw error;
  }
}

async function readProjectionFile(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<StrictTextFileResult>> {
  try {
    return await readStrictTextFile(root, TODO_BOARD_PROJECTION_REF, {
      maximumBytes: TODO_PROJECTION_MAXIMUM_BYTES,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) mapFileReadError(error);
    if (error instanceof StrictTextFileError) mapTextError(error);
    throw error;
  }
}

function sourceFrom(read: Readonly<StableFileSource>): Readonly<TodoAuthorityFileSource> {
  assertPrivateNode(read.node, "file", "$source");
  return Object.freeze({
    resourcePath: read.resourcePath,
    node: read.node,
    byteCount: read.byteCount,
    digest: read.digest,
  });
}

async function readStoredItem(
  root: RootedDirectory,
  group: Readonly<ItemTreeGroup>,
  signal: AbortSignal | undefined,
): Promise<Readonly<StoredTodoCollectionItem>> {
  const intakeRead = await readJsonRecordFile(
    root,
    group.intake.resourcePath,
    TODO_INTAKE_MAXIMUM_BYTES,
    group.intake.node,
    signal,
  );
  const stateRead = await readJsonRecordFile(
    root,
    group.state.resourcePath,
    TODO_STATE_MAXIMUM_BYTES,
    group.state.node,
    signal,
  );
  let intake;
  let state;
  try {
    intake = parseTodoIntake(intakeRead.value);
    state = parseTodoState(stateRead.value);
    if (
      renderTodoIntake(intake) !== intakeRead.text
      || renderTodoState(state) !== stateRead.text
    ) {
      fail("record", "$items");
    }
  } catch (error: unknown) {
    if (error instanceof TodoIntakeError || error instanceof TodoStateError) {
      fail("record", "$items");
    }
    throw error;
  }
  if (
    intake.todoId !== state.todoId
    || todoItemStorageKey(intake.todoId) !== group.storageKey
    || todoIntakeRef(intake.todoId) !== intakeRead.resourcePath
    || todoStateRef(intake.todoId) !== stateRead.resourcePath
  ) {
    fail("tree-shape", "$items");
  }
  const collectionItem = createTodoCollectionSnapshot([{ intake, state }]).items[0];
  if (collectionItem === undefined) fail("record", "$items");
  return Object.freeze({
    ...collectionItem,
    intakeSource: sourceFrom(intakeRead),
    stateSource: sourceFrom(stateRead),
  });
}

function sameTree(
  left: Readonly<BoundedDirectoryTreeScanResult<PortableResourcePath>>,
  right: Readonly<BoundedDirectoryTreeScanResult<PortableResourcePath>>,
): boolean {
  return left.entries.length === right.entries.length
    && sameFileNodeSnapshot(left.treeRootNode, right.treeRootNode)
    && left.entries.every((entry, index) => {
      const other = right.entries[index];
      return other !== undefined
        && entry.resourcePath === other.resourcePath
        && sameFileNodeSnapshot(entry.node, other.node);
    });
}

async function assertTransactionsEmpty(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    const directory = await readStableResourceDirectory(
      root,
      TODO_TRANSACTIONS_ROOT_REF,
      {
        maximumEntries: 1_024,
        ...(signal === undefined ? {} : { signal }),
      },
    );
    assertPrivateNode(directory.directoryNode, "directory", "$transactions");
    if (directory.entries.length !== 0) {
      fail("recovery-required", "$transactions");
    }
  } catch (error: unknown) {
    if (error instanceof TodoCollectionAuthorityError) throw error;
    if (error instanceof StableDirectoryReadError) {
      if (error.reason === "not-found") fail("not-initialized", "$transactions");
      if (error.reason === "too-many-entries") {
        fail("recovery-required", "$transactions");
      }
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "source-changed") fail("source-changed", "$transactions");
      if (error.reason === "root-scope") fail("root-scope", "$root");
      fail("inspection-failure", "$transactions");
    }
    throw error;
  }
}

async function assertCollectionRoot(root: RootedDirectory): Promise<void> {
  try {
    const resource = await root.inspectExistingResource(
      TODO_COLLECTION_ROOT_REF,
      "$todoRoot",
    );
    assertPrivateNode(resource.node, "directory", "$todoRoot");
  } catch (error: unknown) {
    if (error instanceof TodoCollectionAuthorityError) throw error;
    if (error instanceof RootedDirectoryError) {
      if (error.reason === "resource-not-found") {
        fail("not-initialized", "$todoRoot");
      }
      fail("root-scope", "$todoRoot");
    }
    throw error;
  }
}

async function observeProjection(
  root: RootedDirectory,
  items: readonly Readonly<StoredTodoCollectionItem>[],
  signal: AbortSignal | undefined,
): Promise<Readonly<TodoProjectionObservation>> {
  const pairs = items.map((item) => ({ intake: item.intake, state: item.state }));
  const expected = renderTodoBoardProjection(pairs);
  try {
    const read = await readProjectionFile(root, signal);
    const source = sourceFrom(read);
    return Object.freeze({
      status: read.text === expected.content ? "current" : "stale",
      expected,
      source,
    });
  } catch (error: unknown) {
    if (
      error instanceof TodoCollectionAuthorityError
    ) {
      if (error.reason === "aborted" || error.reason === "root-scope") {
        throw error;
      }
      try {
        await root.inspectExistingResource(TODO_BOARD_PROJECTION_REF);
      } catch (inspectionError: unknown) {
        if (
          inspectionError instanceof RootedDirectoryError
          && inspectionError.reason === "resource-not-found"
        ) {
          return Object.freeze({ status: "missing", expected, source: null });
        }
      }
      return Object.freeze({ status: "unsafe", expected, source: null });
    }
    throw error;
  }
}

async function inspectAuthority(
  root: RootedDirectory,
  parsed: Readonly<ParsedOptions>,
  requireCleanTransactions: boolean,
): Promise<Readonly<TodoCollectionAuthoritySnapshot>> {
  assertRoot(root);
  await assertCollectionRoot(root);
  if (requireCleanTransactions) {
    await assertTransactionsEmpty(root, parsed.signal);
  }
  const before = await scanItems(root, parsed.signal);
  const groups = groupItemTree(before);
  const stored: Readonly<StoredTodoCollectionItem>[] = [];
  for (const group of groups) {
    stored.push(await readStoredItem(root, group, parsed.signal));
  }
  const after = await scanItems(root, parsed.signal);
  if (!sameTree(before, after)) fail("source-changed", "$items");
  const collection = createTodoCollectionSnapshot(
    stored.map((item) => ({ intake: item.intake, state: item.state })),
  );
  const byId = new Map(stored.map((item) => [item.todoId, item]));
  const ordered = Object.freeze(collection.items.map((item) => {
    const physical = byId.get(item.todoId);
    if (physical === undefined) fail("source-changed", "$items");
    return physical;
  }));
  const projection = await observeProjection(root, ordered, parsed.signal);
  if (requireCleanTransactions) {
    // normal snapshot 在返回前再次确认检查期间没有留下 crash journal。
    await assertTransactionsEmpty(root, parsed.signal);
  }
  return Object.freeze({
    collection,
    items: ordered,
    projection,
  });
}

/** 读取无 pending transaction 的严格 TODO collection authority。 */
export async function inspectTodoCollectionAuthority(
  root: RootedDirectory,
  options?: InspectTodoCollectionAuthorityOptions,
): Promise<Readonly<TodoCollectionAuthoritySnapshot>> {
  return inspectAuthority(root, parseOptions(options), true);
}

/**
 * 只供持有 collection lock 的 transaction recovery 使用。
 *
 * 本入口仍严格读取完整 item authority，但允许 `transactions/` 中存在由 recovery
 * 另行精确准入的 journal/stage；普通 inspect/append/claim/archive 不得调用。
 */
export async function inspectTodoCollectionAuthorityForRecovery(
  root: RootedDirectory,
  options?: InspectTodoCollectionAuthorityOptions,
): Promise<Readonly<TodoCollectionAuthoritySnapshot>> {
  return inspectAuthority(root, parseOptions(options), false);
}
