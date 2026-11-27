import { ownedByAnotherUser } from "../node/current-user.js";
import type { FileNodeSnapshot } from "./file-node-snapshot.js";

/**
 * Wakeflow Foundation / Filesystem：私有节点策略，写一次（1.4.5 batch 3）。
 *
 * Wakeflow 的私有状态是当前用户拥有的 0600 单链接文件和 0700 目录。这里只回答一个节点快照是否
 * 满足这条策略；不满足时用哪个错误、哪条路径失败，仍由调用方用自己的错误类说。属主按
 * `ownedByAnotherUser` 的口径核对：平台不提供 `geteuid` 时不核对。
 */

const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;
const SINGLE_LINK: readonly bigint[] = Object.freeze([1n]);

/** 普通文件、0600、当前用户拥有，链接数在 `allowedLinkCounts` 之内（默认恰好为 1）。 */
export function isPrivateFile(
  node: Readonly<FileNodeSnapshot>,
  allowedLinkCounts: readonly bigint[] = SINGLE_LINK,
): boolean {
  return (
    node.kind === "file" &&
    node.permissionBits === PRIVATE_FILE_MODE &&
    allowedLinkCounts.includes(node.linkCount) &&
    !ownedByAnotherUser(node.userId)
  );
}

/** 目录、0700、当前用户拥有。 */
export function isPrivateDirectory(node: Readonly<FileNodeSnapshot>): boolean {
  return (
    node.kind === "directory" &&
    node.permissionBits === PRIVATE_DIRECTORY_MODE &&
    !ownedByAnotherUser(node.userId)
  );
}
