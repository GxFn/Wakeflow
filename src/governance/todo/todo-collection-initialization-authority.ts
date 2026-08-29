import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  renderTodoBoardProjection,
} from "./todo-board-projection.js";
import {
  createTodoCollectionSnapshot,
} from "./todo-collection.js";
import {
  WAKEFLOW_TODO_STATIC_RESOURCE_CATALOG,
} from "./todo-resource-catalog.js";

/**
 * Wakeflow Governance / TODO：Fresh Workspace 的空 TODO Collection 目标权威。
 *
 * 该权威只绑定静态资源策略、空集合摘要和由空集合确定性渲染的 Markdown 投影。
 * 它不表示一般 TODO 快照，也不能用于覆盖已有条目；Maintenance 仅可在 Fresh Active
 * 根内以它验证首次初始化及其崩溃重放结果。
 */

export const TODO_EMPTY_COLLECTION_SNAPSHOT = createTodoCollectionSnapshot([]);
export const TODO_EMPTY_BOARD_PROJECTION = renderTodoBoardProjection([]);

export const TODO_COLLECTION_INITIALIZATION_AUTHORITY_DIGEST: Sha256Digest =
  computeCanonicalJsonSha256Digest({
    kind: "WakeflowTodoCollectionInitializationAuthority",
    schemaVersion: 1,
    declarations: WAKEFLOW_TODO_STATIC_RESOURCE_CATALOG,
    collectionDigest: TODO_EMPTY_COLLECTION_SNAPSHOT.collectionDigest,
    projection: TODO_EMPTY_BOARD_PROJECTION,
  });
