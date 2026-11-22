import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  lutimesSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  utimesSync,
} from "node:fs";
import path from "node:path";

/**
 * 快照扫点的拷贝器：把一个工作区的"快照集"同步地拷出、再原样摆回（`snapshot-sweep-process.ts` 在子进程里
 * 每次经过变更接缝之后调用拷出，测试进程按顺序摆回每一份）。
 *
 * 快照集是：工作区根下除 `.git` 与产品检出之外的全部名字——`.wakeflow-local` 与 `.wakeflow-active` 两棵树、
 * 根上的普通文件（配置、根上的锁与暂存、托管文本）、支持面目录（支持面记忆随配置一起改写，只摆回私有树会让
 * 配置与记忆对不上）——再加账本根的全部内容。产品检出按"自己带 `.git`"认，连同工作区自己的 `.git` 都不在
 * 集里，摆回时也不碰；账本根若就在工作区根下，只按账本拷一次。
 *
 * 拷贝保留权限位、访问与修改时间，以及集内的硬链接：同一个 inode 的两个名字拷出来仍是同一个 inode 的两个
 * 名字（暂存恢复按链接数 2 认"已链接、未退役"）。目录的权限与时间在它的成员都拷完之后再设，这样 0500 的
 * 目录也能先写进成员；工作区根与账本根这两个目录本身不拷不换，只记下并摆回它们自己的权限位与时间。
 * 只用同步的 `node:fs` 调用：拷出发生在被测进程的一次接缝调用之后、下一步之前。
 *
 * 不在快照集里的状态在各份快照之间共用：工作区的 `.git`（索引、引用、对象）与各产品检出（工作树与它们的
 * `.git`）。摆回不碰它们，所以前一份快照的跟进对它们做的改动会留给后一份快照。
 */

/** 快照集的两个根：工作区根（只取两棵私有树与根上的普通文件）与账本根（全部内容）。 */
export interface SnapshotSweepSet {
  readonly workspace: string;
  readonly ledger: string;
}

const MODE_MASK = 0o7777;

/** 一次拷贝里已经拷过的 inode：`dev:ino` → 第一个目标名字。 */
type LinkMap = Map<string, string>;

function inodeKey(node: { readonly dev: number; readonly ino: number }): string {
  return `${node.dev}:${node.ino}`;
}

function copyFileNode(source: string, destination: string, links: LinkMap): void {
  const node = lstatSync(source);
  if (node.nlink > 1) {
    const first = links.get(inodeKey(node));
    if (first !== undefined) {
      linkSync(first, destination);
      return;
    }
    links.set(inodeKey(node), destination);
  }
  copyFileSync(source, destination);
  chmodSync(destination, node.mode & MODE_MASK);
  utimesSync(destination, node.atime, node.mtime);
}

function copyNode(source: string, destination: string, links: LinkMap): void {
  const node = lstatSync(source);
  if (node.isDirectory()) {
    mkdirSync(destination, { mode: 0o700 });
    for (const name of readdirSync(source)) {
      copyNode(path.join(source, name), path.join(destination, name), links);
    }
    chmodSync(destination, node.mode & MODE_MASK);
    utimesSync(destination, node.atime, node.mtime);
    return;
  }
  if (node.isFile()) {
    copyFileNode(source, destination, links);
    return;
  }
  if (node.isSymbolicLink()) {
    symlinkSync(readlinkSync(source), destination);
    lutimesSync(destination, node.atime, node.mtime);
    return;
  }
  throw new Error(`Snapshot sweep cannot copy a special node: ${path.basename(source)}.`);
}

/** 工作区根下属于快照集的名字：不是 `.git`、不是账本根、不是自带 `.git` 的产品检出。 */
function workspaceMembers(workspace: string, ledger: string | null): readonly string[] {
  return readdirSync(workspace).filter((name) => {
    if (name === ".git") return false;
    const member = path.join(workspace, name);
    if (ledger !== null && member === ledger) return false;
    return !(lstatSync(member).isDirectory() && existsSync(path.join(member, ".git")));
  });
}

/** 把 `from` 根下属于快照集的名字拷到 `into` 根下；`into` 必须已经存在。 */
function copyWorkspaceMembers(
  from: string,
  into: string,
  ledger: string | null,
  links: LinkMap,
): void {
  for (const name of workspaceMembers(from, ledger)) {
    copyNode(path.join(from, name), path.join(into, name), links);
  }
}

function copyContents(from: string, into: string, links: LinkMap): void {
  for (const name of readdirSync(from)) {
    copyNode(path.join(from, name), path.join(into, name), links);
  }
}

/** 删除一棵树之前先把其中的目录放开到 0700：0500 的目录里删不掉成员。 */
function removeNode(target: string): void {
  const node = lstatSync(target, { throwIfNoEntry: false });
  if (node === undefined) return;
  if (node.isDirectory()) {
    chmodSync(target, 0o700);
    for (const name of readdirSync(target)) removeNode(path.join(target, name));
  }
  rmSync(target, { recursive: true, force: true });
}

/** 拷出一份快照到 `destination`（新建）：`workspace/` 与 `ledger/` 两个子目录，一张共用的链接表。 */
export function copySnapshotSweepSet(set: Readonly<SnapshotSweepSet>, destination: string): void {
  const links: LinkMap = new Map();
  const workspace = path.join(destination, "workspace");
  const ledger = path.join(destination, "ledger");
  mkdirSync(workspace, { recursive: true, mode: 0o700 });
  mkdirSync(ledger, { mode: 0o700 });
  copyWorkspaceMembers(set.workspace, workspace, set.ledger, links);
  if (existsSync(set.ledger)) {
    copyContents(set.ledger, ledger, links);
    copyRootAttributes(set.ledger, ledger);
  }
  copyRootAttributes(set.workspace, workspace);
}

/** 把一个根目录自己的权限位与时间照到另一个目录上（成员都摆好之后调用，否则写成员会改掉时间）。 */
function copyRootAttributes(from: string, onto: string): void {
  const root = lstatSync(from);
  chmodSync(onto, root.mode & MODE_MASK);
  utimesSync(onto, root.atime, root.mtime);
}

/**
 * 把快照 `snapshot` 原样摆回快照集：先删掉集里现有的名字（工作区根下的成员、账本根的内容），
 * 再按同样的规则拷回。工作区根与账本根这两个目录本身不换，最后对齐它们自己的权限位与时间
 * （先账本根、后工作区根：账本根在工作区根下时，对齐账本根不改工作区根的时间）。
 */
export function restoreSnapshotSweepSet(snapshot: string, set: Readonly<SnapshotSweepSet>): void {
  for (const name of workspaceMembers(set.workspace, set.ledger)) {
    removeNode(path.join(set.workspace, name));
  }
  for (const name of readdirSync(set.ledger)) removeNode(path.join(set.ledger, name));
  const links: LinkMap = new Map();
  copyWorkspaceMembers(path.join(snapshot, "workspace"), set.workspace, null, links);
  copyContents(path.join(snapshot, "ledger"), set.ledger, links);
  copyRootAttributes(path.join(snapshot, "ledger"), set.ledger);
  copyRootAttributes(path.join(snapshot, "workspace"), set.workspace);
}
