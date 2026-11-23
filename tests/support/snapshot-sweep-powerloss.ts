import { linkSync, lstatSync, readdirSync, renameSync } from "node:fs";
import path from "node:path";

import {
  copySnapshotSweepNode,
  copySnapshotSweepSnapshot,
  removeSnapshotSweepNode,
} from "./snapshot-sweep-copy.js";

/**
 * 掉电盘面的生成（1.4.1 段 1b 的证明工具）。
 *
 * 快照扫点的子进程每经过一次变更接缝拷一份盘面，那是"进程在这一步之后被杀"的样子。掉电不同：没有被同步
 * 盖住的目录项变更可以丢。这里按子进程另外记下的两样东西——每次接缝调用改的是哪个目录（按 inode 记），
 * 以及每一次目录同步同步的是哪个目录——从第 k 份快照倒推出"到这一刻为止，没被同步盖住的目录项变更全部
 * 丢失"的盘面。
 *
 * 一次接缝调用 j 在目录 X 里做的变更，在某个时刻"被盖住"，是指 j 之后、那个时刻之前，有一次对 X 的同步。
 * 同一个目录里盖住是单调的：一次同步盖住这个目录里此前的全部变更。所以盘面只取决于"哪些变更被盖住"，
 * 只有当一次目录同步盖住了新的变更时才出现新的盘面：每一次这样的同步生成一份，记作 `k~s`（第 k 次接缝调用
 * 之后的第 s 次目录同步）。两次这样的同步之间的任何时刻掉电，得到的都是前一份。
 *
 * 做法：把第 k 份快照拷一份，从第 k 次接缝调用往回走到第 1 次，把每一处没被盖住的变更撤销——
 * - `openExclusive(p)`、`link(a, b)`、`mkdir(p)`：删掉新出现的名字（目录连同里面的东西：名字没了，里面的
 *   都够不着）；
 * - `unlink(p)`、`rmdir(p)`、`removeTree(p)`：从第 j-1 份快照把它拷回来；被删的文件在那份快照里若与一个仍在
 *   的兄弟名字是同一个 inode，就硬链接回去，链接数与名字对得上；
 * - `rename(a, b)`：两半各看各的目录。两半都没盖住：改回去。只有"b 出现"没盖住：删掉 b，两个名字都不在。
 *   只有"a 消失"没盖住：a 重新出现在 b 旁边（文件是硬链接，目录是一份拷贝）。
 *
 * 不做的（局限）：
 * - 每个时刻只生成一份：没被盖住的全部丢失。"这个目录的丢了、那个目录的没同步却留着"这样的子集不生成，
 *   只有改名的两半会因为两个父目录在不同时刻被同步而自然分开。子集靠设计阶段的逐步穷举。
 * - 内容不丢：从没同步过内容的文件保留它的字节。权限位与时间不回退。
 * - 整目录删除是一次接缝调用，删到一半的树不生成。
 * - 假定一个场景里 inode 号不被重用。第 0 份（场景开始之前）当作已经全部落盘；场景的前几次调用只是铺垫时，
 *   `durableThrough` 之前的接缝调用同样当作已经落盘，不撤销、也不出盘面。
 * - 快照集之外的路径（`outside:`）不撤销。
 * - 只有子进程那一趟不被打断的运行有记录。跟进与恢复调用在测试进程里跑、不落盘也不记录，所以"沿用一个
 *   结果之后去做不可逆的删除"那几处（都在重试与恢复路径上）不会出现在生成的盘面里：它们靠各自的顺序测试。
 * - 跨两个目录的硬链接对（追加候选与提交）放回时是两份独立的拷贝，不是同一个 inode 的两个名字；同一个
 *   目录里的才连回去。
 * - 跨目录的目录改名只有目的父目录被盖住、源父目录没有时，那个目录里更早的未落盘变更会留在新名字下面
 *   （按规则它们该丢）；父目录的 inode 记不到（null）的变更当作已经落盘。今天的产品走不到前一种：改名的
 *   原语先同步源父目录。
 * - 撤销按当时记下的路径做，再按此后留下来的目录改名换成现在的名字；它现在该在的目录已经被一次留下来的
 *   删除或改名带走时，这一处撤销跳过（名字没有容身之处）。目录被建出与移走时的 inode 不另记。
 */

/** 子进程记下的一次接缝调用：`dirs` 与 `paths` 对齐，是每个路径实参的父目录的 inode（集外为 null）。 */
export interface PowerLossSeamCall {
  readonly index: number;
  readonly method: string;
  readonly paths: readonly string[];
  readonly dirs?: readonly (number | null)[];
}

/** 子进程记下的一次目录同步：发生在第 `after` 次接缝调用之后，是那之后的第 `ordinal` 次，同步的是 `ino`。 */
export interface PowerLossDirectorySync {
  readonly after: number;
  readonly ordinal: number;
  readonly ino: number;
}

/** 一份掉电盘面的位置：第 `seam` 次接缝调用之后的第 `sync` 次目录同步刚做完。 */
export interface PowerLossPosition {
  readonly seam: number;
  readonly sync: number;
  readonly label: string;
  /** 到这个位置为止，每个目录（inode）被盖住到第几次接缝调用。 */
  readonly covered: ReadonlyMap<number, number>;
}

/** 只有整数序号的接缝调用改目录项；内容同步之后的那些点（带小数）不算。 */
function entryChanges(seam: readonly PowerLossSeamCall[]): readonly PowerLossSeamCall[] {
  return seam.filter((call) => Number.isInteger(call.index) && call.method !== "sync");
}

/** 一次调用改到的目录的 inode：改名是两个父目录，其余是最后一个路径实参（被改的那个名字）的父目录。 */
function changedDirectories(call: Readonly<PowerLossSeamCall>): readonly number[] {
  const dirs = call.dirs ?? [];
  const relevant = call.method === "rename" ? dirs : [dirs.at(-1) ?? null];
  return relevant.filter((ino): ino is number => typeof ino === "number");
}

/**
 * 会出现新盘面的位置，按发生的先后：一次目录同步只有盖住了新的变更才算。
 */
export function powerLossPositions(
  seam: readonly PowerLossSeamCall[],
  syncs: readonly PowerLossDirectorySync[],
  durableThrough = 0,
): readonly PowerLossPosition[] {
  const changes = entryChanges(seam).filter((call) => call.index > durableThrough);
  const covered = new Map<number, number>();
  const positions: PowerLossPosition[] = [];
  const ordered = [...syncs].sort((left, right) =>
    left.after !== right.after ? left.after - right.after : left.ordinal - right.ordinal,
  );
  for (const sync of ordered) {
    const through = covered.get(sync.ino) ?? 0;
    const effective = changes.some(
      (call) =>
        call.index > through &&
        call.index <= sync.after &&
        changedDirectories(call).includes(sync.ino),
    );
    covered.set(sync.ino, Math.max(through, sync.after));
    if (!effective || sync.after <= durableThrough) continue;
    positions.push({
      seam: sync.after,
      sync: sync.ordinal,
      label: `${sync.after}~${sync.ordinal}`,
      covered: new Map(covered),
    });
  }
  return positions;
}

function resolveLabeled(base: string, entry: string): string | null {
  const separator = entry.indexOf(":");
  const prefix = entry.slice(0, separator);
  const relative = entry.slice(separator + 1);
  if (prefix !== "workspace" && prefix !== "ledger") return null;
  return path.join(base, prefix, ...relative.split("/").filter((segment) => segment !== ""));
}

function exists(target: string): boolean {
  return lstatSync(target, { throwIfNoEntry: false }) !== undefined;
}

/**
 * 把一个当时记下的路径换成它在副本里现在的位置。`kept` 是往回走时已经路过、并且留下来了的目录改名（两半都
 * 被盖住），后发生的排在前面；按发生的先后依次套用，这次变更之后才改名的目录里的路径就跟着改了名。
 */
type Relocate = (entry: string) => string;

function relocator(kept: readonly Readonly<{ from: string; to: string }>[]): Relocate {
  return (entry) => {
    let current = entry;
    for (let index = kept.length - 1; index >= 0; index -= 1) {
      const { from, to } = kept[index] as { from: string; to: string };
      if (current === from) current = to;
      else if (current.startsWith(`${from}/`)) current = `${to}${current.slice(from.length)}`;
    }
    return current;
  };
}

/**
 * 把 `entry`（当时记下的路径）从第 `before` 份快照放回副本里它现在该在的位置 `placed`。文件在那份快照里若与
 * 同目录里一个仍在副本里、大小相同的兄弟名字是同一个 inode，就硬链接到那个兄弟；否则拷一份。已经在副本里
 * 就不动；它现在该在的那个目录已经不在了（后来的一次删除或改名留了下来）也不动：名字的容身之处没了。
 */
function putBack(
  snapshots: string,
  before: number,
  copy: string,
  entry: string,
  placed: string,
): void {
  const source = resolveLabeled(path.join(snapshots, String(before)), entry);
  const target = resolveLabeled(copy, placed);
  if (source === null || target === null || exists(target) || !exists(source)) return;
  if (!exists(path.dirname(target))) return;
  const node = lstatSync(source);
  if (node.isFile() && node.nlink > 1) {
    for (const name of readdirSync(path.dirname(source))) {
      const sibling = path.join(path.dirname(source), name);
      if (sibling === source || lstatSync(sibling).ino !== node.ino) continue;
      const twin = lstatSync(path.join(path.dirname(target), name), { throwIfNoEntry: false });
      if (twin?.isFile() === true && twin.size === node.size) {
        linkSync(path.join(path.dirname(target), name), target);
        return;
      }
    }
  }
  copySnapshotSweepNode(source, target);
}

/** 第 `j` 次调用在 `ino` 这个目录里的变更，到这个位置为止有没有被盖住。 */
function isCovered(position: Readonly<PowerLossPosition>, ino: number | null, j: number): boolean {
  // 集外的路径没有记目录：当作盖住了，不撤销。
  return ino === null || (position.covered.get(ino) ?? 0) >= j;
}

/** 一次改名的两半是不是都被盖住了（这次改名留下来）。 */
function renameKept(
  call: Readonly<PowerLossSeamCall>,
  position: Readonly<PowerLossPosition>,
): boolean {
  const [fromDir = null, toDir = null] = call.dirs ?? [];
  return isCovered(position, fromDir, call.index) && isCovered(position, toDir, call.index);
}

function undoRename(
  snapshots: string,
  copy: string,
  call: Readonly<PowerLossSeamCall>,
  position: Readonly<PowerLossPosition>,
  relocate: Relocate,
): void {
  const [from = "", to = ""] = call.paths;
  const [fromDir = null, toDir = null] = call.dirs ?? [];
  const source = resolveLabeled(copy, relocate(from));
  const target = resolveLabeled(copy, relocate(to));
  if (source === null || target === null) return;
  const removalCovered = isCovered(position, fromDir, call.index);
  const additionCovered = isCovered(position, toDir, call.index);
  if (removalCovered && additionCovered) return;
  if (!removalCovered && !additionCovered) {
    // 两半都丢：改回去；被这次改名盖掉的旧目标从前一份快照放回。
    if (exists(target) && !exists(source) && exists(path.dirname(source))) {
      renameSync(target, source);
    }
    putBack(snapshots, call.index - 1, copy, to, relocate(to));
    return;
  }
  if (!additionCovered) {
    // 只丢了"新名字出现"：两个名字都不在。
    removeSnapshotSweepNode(target);
    putBack(snapshots, call.index - 1, copy, to, relocate(to));
    return;
  }
  // 只丢了"旧名字消失"：旧名字重新出现在新名字旁边。
  if (exists(source) || !exists(target) || !exists(path.dirname(source))) return;
  if (lstatSync(target).isFile()) linkSync(target, source);
  else copySnapshotSweepNode(target, source);
}

function undoCall(
  snapshots: string,
  copy: string,
  call: Readonly<PowerLossSeamCall>,
  position: Readonly<PowerLossPosition>,
  relocate: Relocate,
): void {
  if (call.method === "rename") {
    undoRename(snapshots, copy, call, position, relocate);
    return;
  }
  const entry = call.paths.at(-1) ?? "";
  const directory = (call.dirs ?? []).at(-1) ?? null;
  if (isCovered(position, directory, call.index)) return;
  const target = resolveLabeled(copy, relocate(entry));
  if (target === null) return;
  if (call.method === "openExclusive" || call.method === "link" || call.method === "mkdir") {
    removeSnapshotSweepNode(target);
  } else if (call.method === "unlink" || call.method === "rmdir" || call.method === "removeTree") {
    putBack(snapshots, call.index - 1, copy, entry, relocate(entry));
  }
}

/**
 * 在 `destination`（新建）生成一个位置上的掉电盘面：第 `position.seam` 份快照的副本，撤销掉每一处没被盖住
 * 的目录项变更。`snapshots` 是子进程拷出快照的目录（第 i 份在 `<snapshots>/<i>`）。
 */
export function generatePowerLossState(
  snapshots: string,
  seam: readonly PowerLossSeamCall[],
  position: Readonly<PowerLossPosition>,
  destination: string,
  durableThrough = 0,
): void {
  copySnapshotSweepSnapshot(path.join(snapshots, String(position.seam)), destination);
  const changes = entryChanges(seam)
    .filter((call) => call.index > durableThrough && call.index <= position.seam)
    .sort((left, right) => right.index - left.index);
  // 往回走时路过的、留下来了的改名：更早的变更记下的路径要按它们换成现在的名字。
  const kept: { from: string; to: string }[] = [];
  for (const call of changes) {
    undoCall(snapshots, destination, call, position, relocator(kept));
    if (call.method === "rename" && renameKept(call, position)) {
      const [from = "", to = ""] = call.paths;
      kept.push({ from, to });
    }
  }
}
