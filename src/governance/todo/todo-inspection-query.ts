import { Buffer } from "node:buffer";

import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  computeSha256Hex,
  parseSha256Digest,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  isTodoCollectionStatusActive,
  TODO_COLLECTION_MAXIMUM_ITEMS,
  type TodoCollectionItem,
  type TodoCollectionSnapshot,
} from "./todo-collection.js";
import type {
  TodoDemandType,
  TodoIntake,
  TodoPriority,
} from "./todo-intake.js";
import {
  parseTodoItemId,
  TodoItemIdError,
  type TodoItemId,
} from "./todo-item-id.js";
import type { TodoState, TodoStatus } from "./todo-state.js";

/**
 * Wakeflow Governance / TODO：已验证集合快照的纯查询与公共读模型投影。
 *
 * 本模块只解析list/item查询、规范化filter、生成一致分页token，并把内部Collection
 * Item投影为有界summary或单项业务详情。它不读取文件、Config或Markdown Board，
 * 不修复projection，不选择“下一项”，也不把查询结果解释为claim或其他mutation许可。
 */

const TODO_INSPECTION_LIST_KIND = "WakeflowTodoInspectionList" as const;
const TODO_INSPECTION_ITEM_KIND = "WakeflowTodoInspectionItem" as const;
const TODO_INSPECTION_SCHEMA_VERSION = 1 as const;
export const TODO_INSPECTION_DEFAULT_PAGE_SIZE = 20;
export const TODO_INSPECTION_MAXIMUM_PAGE_SIZE = 100;

const TODO_STATUSES = Object.freeze([
  "pending-claim",
  "parked",
  "claimed",
  "withdrawn",
  "archived",
] as const satisfies readonly TodoStatus[]);
const TODO_PRIORITIES = Object.freeze([
  "P0",
  "P1",
  "P2",
  "P3",
] as const satisfies readonly TodoPriority[]);
const TODO_DEMAND_TYPES = Object.freeze([
  "requirement",
  "bug",
  "supplement",
  "research",
] as const satisfies readonly TodoDemandType[]);

const LIST_QUERY_FIELDS = Object.freeze([
  "filter",
  "pageSize",
  "pageToken",
  "view",
] as const);
const ITEM_QUERY_FIELDS = Object.freeze(["todoId", "view"] as const);
const FILTER_FIELDS = Object.freeze([
  "autoClaim",
  "demandTypes",
  "originWindowId",
  "priorities",
  "statuses",
] as const);

const PAGE_TOKEN_MAGIC = Buffer.from([0x57, 0x46, 0x54, 0x49]);
const PAGE_TOKEN_VERSION = 1;
const PAGE_TOKEN_MAGIC_OFFSET = 0;
const PAGE_TOKEN_VERSION_OFFSET = 4;
const PAGE_TOKEN_COLLECTION_DIGEST_OFFSET = 5;
const PAGE_TOKEN_QUERY_DIGEST_OFFSET = 37;
const PAGE_TOKEN_NEXT_OFFSET_OFFSET = 69;
const PAGE_TOKEN_CHECKSUM_OFFSET = 73;
const PAGE_TOKEN_CHECKSUM_BYTES = 16;
const PAGE_TOKEN_BYTES = PAGE_TOKEN_CHECKSUM_OFFSET
  + PAGE_TOKEN_CHECKSUM_BYTES;
const PAGE_TOKEN_MAXIMUM_TEXT_LENGTH = 256;
const PAGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/u;

export interface TodoInspectionListFilter {
  readonly statuses: readonly TodoStatus[] | null;
  readonly priorities: readonly TodoPriority[] | null;
  readonly demandTypes: readonly TodoDemandType[] | null;
  readonly autoClaim: boolean | null;
  readonly originWindowId: WakeflowDurableId<"window"> | null;
}

export interface TodoInspectionListQuery {
  readonly view: "list";
  readonly filter: Readonly<TodoInspectionListFilter>;
  readonly pageSize: number;
  readonly pageToken: string | null;
}

export interface TodoInspectionItemQuery {
  readonly view: "item";
  readonly todoId: TodoItemId;
}

export type TodoInspectionQuery =
  | Readonly<TodoInspectionListQuery>
  | Readonly<TodoInspectionItemQuery>;

export interface TodoInspectionCollectionReference {
  readonly collectionDigest: Sha256Digest;
  readonly itemCount: number;
  readonly activeItemCount: number;
}

export interface TodoInspectionSummary {
  readonly todoId: TodoItemId;
  readonly createdAt: TodoIntake["createdAt"];
  readonly updatedAt: TodoState["updatedAt"];
  readonly status: TodoStatus;
  readonly revision: number;
  readonly demandType: TodoDemandType;
  readonly priority: TodoPriority;
  readonly originWindowId: WakeflowDurableId<"window">;
  readonly controllerWindowId: WakeflowDurableId<"window">;
  readonly summary: string;
  readonly parkedTrigger: string | null;
  readonly autoClaim: boolean;
  readonly testingMode: TodoIntake["testingDecision"]["mode"];
  readonly mountedDemandId: WakeflowDurableId<"demand"> | null;
  readonly intakeDigest: Sha256Digest;
  readonly stateDigest: Sha256Digest;
}

export interface TodoInspectionArchiveDetail {
  readonly archiveId: WakeflowDurableId<"archive">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly manifestDigest: Sha256Digest;
  readonly archivedAt: TodoState["updatedAt"];
}

export interface TodoInspectionStateDetail {
  readonly status: TodoStatus;
  readonly revision: number;
  readonly updatedAt: TodoState["updatedAt"];
  readonly mountedDemandId: WakeflowDurableId<"demand"> | null;
  readonly withdrawal: TodoState["withdrawal"];
  readonly archive: Readonly<TodoInspectionArchiveDetail> | null;
}

export interface TodoInspectionItemDetail {
  readonly todoId: TodoItemId;
  readonly intakeDigest: Sha256Digest;
  readonly stateDigest: Sha256Digest;
  readonly intake: Readonly<TodoIntake>;
  readonly state: Readonly<TodoInspectionStateDetail>;
}

export interface TodoInspectionListResult {
  readonly kind: typeof TODO_INSPECTION_LIST_KIND;
  readonly schemaVersion: typeof TODO_INSPECTION_SCHEMA_VERSION;
  readonly view: "list";
  readonly collection: Readonly<TodoInspectionCollectionReference>;
  readonly totalMatched: number;
  readonly items: readonly Readonly<TodoInspectionSummary>[];
  readonly nextPageToken: string;
}

export interface TodoInspectionItemResult {
  readonly kind: typeof TODO_INSPECTION_ITEM_KIND;
  readonly schemaVersion: typeof TODO_INSPECTION_SCHEMA_VERSION;
  readonly view: "item";
  readonly collection: Readonly<TodoInspectionCollectionReference>;
  readonly item: Readonly<TodoInspectionItemDetail>;
}

export type TodoInspectionResult =
  | Readonly<TodoInspectionListResult>
  | Readonly<TodoInspectionItemResult>;

export type TodoInspectionQueryErrorReason =
  | "input"
  | "identifier"
  | "page-size"
  | "page-token"
  | "page-token-mismatch"
  | "stale-page-token"
  | "not-found";

const ERROR_MESSAGES = {
  input: "TODO inspection query input is invalid.",
  identifier: "TODO inspection query contains an invalid typed identifier.",
  "page-size": "TODO inspection query page size is invalid.",
  "page-token": "TODO inspection query page token is invalid.",
  "page-token-mismatch":
    "TODO inspection query page token belongs to another filter.",
  "stale-page-token":
    "TODO inspection query page token belongs to another collection snapshot.",
  "not-found": "TODO inspection query item does not exist.",
} as const satisfies Readonly<Record<
  TodoInspectionQueryErrorReason,
  string
>>;

/** TODO查询无法形成关闭请求、连续分页或精确条目时的稳定错误。 */
export class TodoInspectionQueryError extends Error {
  override readonly name = "TodoInspectionQueryError";
  readonly code = "wakeflow-todo-inspection-query" as const;
  readonly reason: TodoInspectionQueryErrorReason;
  readonly path: string;

  constructor(reason: TodoInspectionQueryErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface DecodedPageToken {
  readonly collectionDigest: Sha256Digest;
  readonly queryDigest: Sha256Digest;
  readonly nextOffset: number;
}

function fail(
  reason: TodoInspectionQueryErrorReason,
  path: string,
): never {
  throw new TodoInspectionQueryError(reason, path);
}

function plainRecord(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  try {
    return parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", path);
    throw error;
  }
}

function assertFields(
  record: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): void {
  const keys = Object.keys(record);
  if (
    keys.some((key) => !allowed.includes(key))
    || required.some((key) => !Object.hasOwn(record, key))
  ) {
    fail("input", path);
  }
}

function parseEnumFilter<Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  path: string,
): readonly Value[] {
  let entries: readonly unknown[];
  try {
    entries = parseDenseArray(value, allowed.length, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", path);
    throw error;
  }
  if (entries.length === 0) fail("input", path);
  const order = new Map(allowed.map((entry, index) => [entry, index]));
  const seen = new Set<Value>();
  const parsed: Value[] = [];
  for (const [index, entry] of entries.entries()) {
    if (typeof entry !== "string" || !order.has(entry as Value)) {
      fail("input", `${path}/${index}`);
    }
    const admitted = entry as Value;
    if (seen.has(admitted)) fail("input", `${path}/${index}`);
    seen.add(admitted);
    parsed.push(admitted);
  }
  parsed.sort((left, right) =>
    (order.get(left) ?? Number.MAX_SAFE_INTEGER)
    - (order.get(right) ?? Number.MAX_SAFE_INTEGER));
  return Object.freeze(parsed);
}

function parseWindowId(
  value: unknown,
  path: string,
): WakeflowDurableId<"window"> {
  try {
    return parseWakeflowDurableIdOfKind(value, "window", path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
    throw error;
  }
}

function emptyFilter(): Readonly<TodoInspectionListFilter> {
  return Object.freeze({
    statuses: null,
    priorities: null,
    demandTypes: null,
    autoClaim: null,
    originWindowId: null,
  });
}

function parseFilter(value: unknown): Readonly<TodoInspectionListFilter> {
  const record = plainRecord(value, "$query/filter");
  assertFields(record, FILTER_FIELDS, [], "$query/filter");
  if (
    Object.hasOwn(record, "autoClaim")
    && typeof record.autoClaim !== "boolean"
  ) {
    fail("input", "$query/filter/autoClaim");
  }
  return Object.freeze({
    statuses: Object.hasOwn(record, "statuses")
      ? parseEnumFilter(record.statuses, TODO_STATUSES, "$query/filter/statuses")
      : null,
    priorities: Object.hasOwn(record, "priorities")
      ? parseEnumFilter(
          record.priorities,
          TODO_PRIORITIES,
          "$query/filter/priorities",
        )
      : null,
    demandTypes: Object.hasOwn(record, "demandTypes")
      ? parseEnumFilter(
          record.demandTypes,
          TODO_DEMAND_TYPES,
          "$query/filter/demandTypes",
        )
      : null,
    autoClaim: Object.hasOwn(record, "autoClaim")
      ? record.autoClaim as boolean
      : null,
    originWindowId: Object.hasOwn(record, "originWindowId")
      ? parseWindowId(record.originWindowId, "$query/filter/originWindowId")
      : null,
  });
}

function parsePageSize(value: unknown): number {
  if (value === 0) {
    return TODO_INSPECTION_DEFAULT_PAGE_SIZE;
  }
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail("page-size", "$query/pageSize");
  }
  return Math.min(value as number, TODO_INSPECTION_MAXIMUM_PAGE_SIZE);
}

function parsePageTokenText(value: unknown): string | null {
  if (value === "") return null;
  if (
    typeof value !== "string"
    || value.length > PAGE_TOKEN_MAXIMUM_TEXT_LENGTH
    || !PAGE_TOKEN_PATTERN.test(value)
  ) {
    fail("page-token", "$query/pageToken");
  }
  return value;
}

function parseTodoId(value: unknown): TodoItemId {
  try {
    return parseTodoItemId(value, "$query/todoId");
  } catch (error: unknown) {
    if (error instanceof TodoItemIdError) {
      fail("identifier", "$query/todoId");
    }
    throw error;
  }
}

/** 将list或item查询规范化为递归冻结、无物理根信息的领域请求。 */
export function parseTodoInspectionQuery(
  value: unknown,
): Readonly<TodoInspectionQuery> {
  const record = plainRecord(value, "$query");
  if (record.view === "list") {
    assertFields(record, LIST_QUERY_FIELDS, ["view"], "$query");
    return Object.freeze({
      view: "list",
      filter: Object.hasOwn(record, "filter")
        ? parseFilter(record.filter)
        : emptyFilter(),
      pageSize: Object.hasOwn(record, "pageSize")
        ? parsePageSize(record.pageSize)
        : TODO_INSPECTION_DEFAULT_PAGE_SIZE,
      pageToken: Object.hasOwn(record, "pageToken")
        ? parsePageTokenText(record.pageToken)
        : null,
    });
  }
  if (record.view === "item") {
    assertFields(record, ITEM_QUERY_FIELDS, ITEM_QUERY_FIELDS, "$query");
    return Object.freeze({
      view: "item",
      todoId: parseTodoId(record.todoId),
    });
  }
  fail("input", "$query/view");
}

function digestPayload(digest: Sha256Digest): Buffer {
  const admitted = parseSha256Digest(digest, "$pageTokenDigest");
  return Buffer.from(admitted.slice("sha256:".length), "hex");
}

function digestFromPayload(value: Uint8Array): Sha256Digest {
  return parseSha256Digest(
    `sha256:${Buffer.from(value).toString("hex")}`,
    "$pageTokenDigest",
  );
}

function pageTokenChecksum(value: Uint8Array): Buffer {
  return Buffer.from(
    computeSha256Hex(value, "$pageTokenChecksum").slice(
      0,
      PAGE_TOKEN_CHECKSUM_BYTES * 2,
    ),
    "hex",
  );
}

function encodePageToken(
  collectionDigest: Sha256Digest,
  queryDigest: Sha256Digest,
  nextOffset: number,
): string {
  if (
    !Number.isSafeInteger(nextOffset)
    || nextOffset <= 0
    || nextOffset > TODO_COLLECTION_MAXIMUM_ITEMS
  ) {
    fail("page-token", "$nextOffset");
  }
  const bytes = Buffer.alloc(PAGE_TOKEN_BYTES);
  PAGE_TOKEN_MAGIC.copy(bytes, PAGE_TOKEN_MAGIC_OFFSET);
  bytes.writeUInt8(PAGE_TOKEN_VERSION, PAGE_TOKEN_VERSION_OFFSET);
  digestPayload(collectionDigest).copy(
    bytes,
    PAGE_TOKEN_COLLECTION_DIGEST_OFFSET,
  );
  digestPayload(queryDigest).copy(bytes, PAGE_TOKEN_QUERY_DIGEST_OFFSET);
  bytes.writeUInt32BE(nextOffset, PAGE_TOKEN_NEXT_OFFSET_OFFSET);
  pageTokenChecksum(bytes.subarray(0, PAGE_TOKEN_CHECKSUM_OFFSET)).copy(
    bytes,
    PAGE_TOKEN_CHECKSUM_OFFSET,
  );
  return bytes.toString("base64url");
}

function decodePageToken(value: string): Readonly<DecodedPageToken> {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(value, "base64url");
  } catch {
    fail("page-token", "$query/pageToken");
  }
  if (
    bytes.length !== PAGE_TOKEN_BYTES
    || bytes.toString("base64url") !== value
    || !bytes.subarray(0, PAGE_TOKEN_MAGIC.length).equals(PAGE_TOKEN_MAGIC)
    || bytes.readUInt8(PAGE_TOKEN_VERSION_OFFSET) !== PAGE_TOKEN_VERSION
    || !pageTokenChecksum(
      bytes.subarray(0, PAGE_TOKEN_CHECKSUM_OFFSET),
    ).equals(bytes.subarray(PAGE_TOKEN_CHECKSUM_OFFSET))
  ) {
    fail("page-token", "$query/pageToken");
  }
  const nextOffset = bytes.readUInt32BE(PAGE_TOKEN_NEXT_OFFSET_OFFSET);
  if (nextOffset <= 0 || nextOffset > TODO_COLLECTION_MAXIMUM_ITEMS) {
    fail("page-token", "$query/pageToken");
  }
  return Object.freeze({
    collectionDigest: digestFromPayload(bytes.subarray(
      PAGE_TOKEN_COLLECTION_DIGEST_OFFSET,
      PAGE_TOKEN_QUERY_DIGEST_OFFSET,
    )),
    queryDigest: digestFromPayload(bytes.subarray(
      PAGE_TOKEN_QUERY_DIGEST_OFFSET,
      PAGE_TOKEN_NEXT_OFFSET_OFFSET,
    )),
    nextOffset,
  });
}

function listQueryDigest(
  filter: Readonly<TodoInspectionListFilter>,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest({
    kind: "wakeflow-todo-inspection-list-query",
    schemaVersion: TODO_INSPECTION_SCHEMA_VERSION,
    order: "created-at-ascending-then-todo-id-ascending",
    filter,
  });
}

function collectionReference(
  snapshot: Readonly<TodoCollectionSnapshot>,
): Readonly<TodoInspectionCollectionReference> {
  return Object.freeze({
    collectionDigest: snapshot.collectionDigest,
    itemCount: snapshot.itemCount,
    activeItemCount: snapshot.activeItemCount,
  });
}

function matchesFilter(
  item: Readonly<TodoCollectionItem>,
  filter: Readonly<TodoInspectionListFilter>,
): boolean {
  return (filter.statuses === null || filter.statuses.includes(item.state.status))
    && (filter.priorities === null
      || filter.priorities.includes(item.intake.priority))
    && (filter.demandTypes === null
      || filter.demandTypes.includes(item.intake.demandType))
    && (filter.autoClaim === null
      || filter.autoClaim === item.intake.autoClaim)
    && (filter.originWindowId === null
      || filter.originWindowId === item.intake.originWindowId);
}

function summaryFor(
  item: Readonly<TodoCollectionItem>,
): Readonly<TodoInspectionSummary> {
  return Object.freeze({
    todoId: item.todoId,
    createdAt: item.intake.createdAt,
    updatedAt: item.state.updatedAt,
    status: item.state.status,
    revision: item.state.revision,
    demandType: item.intake.demandType,
    priority: item.intake.priority,
    originWindowId: item.intake.originWindowId,
    controllerWindowId: item.intake.controllerWindowId,
    summary: item.intake.summary,
    parkedTrigger: item.state.status === "parked"
      && item.intake.readiness.status === "parked"
      ? item.intake.readiness.trigger
      : null,
    autoClaim: item.intake.autoClaim,
    testingMode: item.intake.testingDecision.mode,
    mountedDemandId: item.state.mount?.demandId ?? null,
    intakeDigest: item.intakeDigest,
    stateDigest: item.stateDigest,
  });
}

function itemDetailFor(
  item: Readonly<TodoCollectionItem>,
): Readonly<TodoInspectionItemDetail> {
  const archive = item.state.archive === null
    ? null
    : Object.freeze({
        archiveId: item.state.archive.archiveId,
        demandId: item.state.archive.demandId,
        manifestDigest: item.state.archive.manifestDigest,
        archivedAt: item.state.archive.archivedAt,
      });
  return Object.freeze({
    todoId: item.todoId,
    intakeDigest: item.intakeDigest,
    stateDigest: item.stateDigest,
    intake: item.intake,
    state: Object.freeze({
      status: item.state.status,
      revision: item.state.revision,
      updatedAt: item.state.updatedAt,
      mountedDemandId: item.state.mount?.demandId ?? null,
      withdrawal: item.state.withdrawal,
      archive,
    }),
  });
}

function assertSnapshotShape(
  snapshot: Readonly<TodoCollectionSnapshot>,
): void {
  if (
    snapshot.itemCount !== snapshot.items.length
    || snapshot.itemCount > TODO_COLLECTION_MAXIMUM_ITEMS
    || snapshot.activeItemCount !== snapshot.items.filter((item) =>
      isTodoCollectionStatusActive(item.state.status)).length
  ) {
    fail("input", "$snapshot");
  }
}

function executeListQuery(
  snapshot: Readonly<TodoCollectionSnapshot>,
  query: Readonly<TodoInspectionListQuery>,
): Readonly<TodoInspectionListResult> {
  const queryDigest = listQueryDigest(query.filter);
  let offset = 0;
  if (query.pageToken !== null) {
    const token = decodePageToken(query.pageToken);
    if (token.queryDigest !== queryDigest) {
      fail("page-token-mismatch", "$query/pageToken");
    }
    if (token.collectionDigest !== snapshot.collectionDigest) {
      fail("stale-page-token", "$query/pageToken");
    }
    offset = token.nextOffset;
  }
  const matched = snapshot.items.filter((item) =>
    matchesFilter(item, query.filter));
  if (offset > matched.length) fail("page-token", "$query/pageToken");
  const items = Object.freeze(
    matched.slice(offset, offset + query.pageSize).map(summaryFor),
  );
  const nextOffset = offset + items.length;
  return Object.freeze({
    kind: TODO_INSPECTION_LIST_KIND,
    schemaVersion: TODO_INSPECTION_SCHEMA_VERSION,
    view: "list",
    collection: collectionReference(snapshot),
    totalMatched: matched.length,
    items,
    nextPageToken: nextOffset < matched.length
      ? encodePageToken(snapshot.collectionDigest, queryDigest, nextOffset)
      : "",
  });
}

function executeItemQuery(
  snapshot: Readonly<TodoCollectionSnapshot>,
  query: Readonly<TodoInspectionItemQuery>,
): Readonly<TodoInspectionItemResult> {
  const item = snapshot.items.find((entry) => entry.todoId === query.todoId);
  if (item === undefined) fail("not-found", "$query/todoId");
  return Object.freeze({
    kind: TODO_INSPECTION_ITEM_KIND,
    schemaVersion: TODO_INSPECTION_SCHEMA_VERSION,
    view: "item",
    collection: collectionReference(snapshot),
    item: itemDetailFor(item),
  });
}

/**
 * 在同一已验证Collection Snapshot上执行一次只读查询。
 *
 * page token只绑定连续读取位置；任何后续mutation仍必须由自己的owner重新读取完整
 * Authority并取得CAS，不得把本结果或token当成写入许可。
 */
export function executeTodoInspectionQuery(
  snapshot: Readonly<TodoCollectionSnapshot>,
  query: Readonly<TodoInspectionQuery>,
): Readonly<TodoInspectionResult> {
  assertSnapshotShape(snapshot);
  return query.view === "list"
    ? executeListQuery(snapshot, query)
    : executeItemQuery(snapshot, query);
}
