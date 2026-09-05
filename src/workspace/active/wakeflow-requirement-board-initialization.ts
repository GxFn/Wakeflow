import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import {
  computeSha256Digest,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  REQUIREMENT_BOARD_INDEX_REF,
  REQUIREMENT_BOARD_ROOT_REF,
} from "../../kernel/layout.js";
import { renderRequirementBoardIndex } from "../../kernel/requirement-board.js";
import {
  parseWakeflowWorkspaceResourceDeclaration,
  type WakeflowWorkspaceResourceDeclaration,
} from "../workspace-resource-declaration.js";

/**
 * Wakeflow Workspace / Active：Fresh Workspace 的空需求看板目标权威与静态资源目录。
 *
 * 看板只有两个可以稳定寻址的静态资源：状态文件所在目录 `board/` 与由状态确定性
 * 重写的人读索引 `board/index.md`；各需求包的认领状态文件由内核 `requirement-board`
 * 按 `requirementId` 独占创建，不进入静态目录。本权威只绑定布局引用与空索引摘要，
 * 不表示一般看板快照，也不能用于覆盖已有认领状态；Maintenance 仅可在 Fresh Active
 * 根内以它验证首次初始化及其崩溃重放结果。
 */

export const REQUIREMENT_BOARD_RESOURCE_OWNER_ID = "requirement-board" as const;

const REQUIREMENT_BOARD_ROOT_RESOURCE_DECLARATION =
  parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: "active.board.root",
    family: "active",
    ownerId: REQUIREMENT_BOARD_RESOURCE_OWNER_ID,
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath: REQUIREMENT_BOARD_ROOT_REF,
    },
    tracking: {
      disposition: "ignored",
      privacy: "runtime-private",
    },
    nodePolicy: {
      kind: "directory",
      mode: "0700",
      symlinkPolicy: "reject",
      existingModePolicy: "observe-without-change",
    },
    processing: {
      kind: "directory-container",
      materializationRecipe: "materialize-directory",
      existingDirectoryPolicy: "observe-without-mode-change",
      collisionPolicy: "reject-non-directory",
      descendantAuthority: "separate-declaration-required",
      recoveryStrategy: "report-only",
    },
  });

const REQUIREMENT_BOARD_INDEX_RESOURCE_DECLARATION =
  parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: "active.board.index",
    family: "active",
    ownerId: REQUIREMENT_BOARD_RESOURCE_OWNER_ID,
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath: REQUIREMENT_BOARD_INDEX_REF,
    },
    tracking: {
      disposition: "ignored",
      privacy: "runtime-private",
    },
    nodePolicy: {
      kind: "file",
      mode: "0600",
      linkPolicy: "single-link",
      executablePolicy: "forbidden",
    },
    processing: {
      kind: "resource",
      role: "derived-projection",
      allowedMutationRecipes: ["deterministic-rewrite"],
      recoveryStrategy: "rebuild-from-authority",
    },
  });

/** 需求看板 owner 的确定性静态资源目录：目录与人读索引。 */
export const WAKEFLOW_REQUIREMENT_BOARD_STATIC_RESOURCE_CATALOG = Object.freeze([
  REQUIREMENT_BOARD_ROOT_RESOURCE_DECLARATION,
  REQUIREMENT_BOARD_INDEX_RESOURCE_DECLARATION,
]) satisfies readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];

/** 没有任何认领状态时的索引正文；Fresh 初始化写入的就是这一份。 */
export const REQUIREMENT_BOARD_EMPTY_INDEX = renderRequirementBoardIndex([]);

export const REQUIREMENT_BOARD_EMPTY_INDEX_DIGEST: Sha256Digest = computeSha256Digest(
  encodeUtf8(REQUIREMENT_BOARD_EMPTY_INDEX, "$boardIndex"),
  "$boardIndex",
);

export const REQUIREMENT_BOARD_INITIALIZATION_AUTHORITY_DIGEST: Sha256Digest =
  computeCanonicalJsonSha256Digest({
    kind: "WakeflowRequirementBoardInitializationAuthority",
    schemaVersion: 1,
    rootRef: REQUIREMENT_BOARD_ROOT_REF,
    indexRef: REQUIREMENT_BOARD_INDEX_REF,
    emptyIndexDigest: REQUIREMENT_BOARD_EMPTY_INDEX_DIGEST,
  });
