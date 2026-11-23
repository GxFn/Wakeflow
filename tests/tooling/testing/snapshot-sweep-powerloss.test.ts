import { deepEqual, equal } from "node:assert/strict";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { copySnapshotSweepSnapshot } from "../../support/snapshot-sweep-copy.js";
import {
  generatePowerLossState,
  type PowerLossDirectorySync,
  type PowerLossPosition,
  type PowerLossSeamCall,
  powerLossPositions,
} from "../../support/snapshot-sweep-powerloss.js";

/**
 * 级别 4（维护者工具）目录下的一次性根用例：掉电盘面的生成（1.4.1 段 1b 的证明工具），不起子进程。每个用例
 * 在一棵活的小树上手工做几步"接缝调用"，每步之后拷一份快照、记下改的是哪个目录（真实的 inode），再手工
 * 记几次目录同步，然后核对生成出来的盘面：新建加链接在目录同步之前与之后；跨两个目录的改名只同步了源目录
 * （两个名字都不在）、只同步了目标目录（两个名字都在）与都没同步（改回去）；没同步的整树删除被放回；
 * 被删的暂存与它的目标仍是同一个 inode 的两个名字。
 */

function fixture(t: TestContext) {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-powerloss-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const live = path.join(base, "live");
  const snapshots = path.join(base, "snapshots");
  mkdirSync(path.join(live, "workspace"), { recursive: true });
  mkdirSync(path.join(live, "ledger"));
  mkdirSync(snapshots);
  const seam: PowerLossSeamCall[] = [];
  const syncs: PowerLossDirectorySync[] = [];
  let index = 0;
  let ordinal = 0;
  let states = 0;
  const abs = (entry: string) => path.join(live, "workspace", ...entry.split("/"));
  const label = (entry: string) => `workspace:${entry}`;
  return {
    abs,
    seam,
    syncs,
    /** 场景开始之前的样子（第 0 份）。 */
    baseline() {
      copySnapshotSweepSnapshot(live, path.join(snapshots, "0"));
    },
    /** 一次接缝调用：记下每个路径的父目录，做这一步，再拷一份快照。 */
    call(method: string, entries: readonly string[], action: () => void) {
      const dirs = entries.map((entry) => lstatSync(path.dirname(abs(entry))).ino);
      action();
      index += 1;
      ordinal = 0;
      seam.push({ index, method, paths: entries.map(label), dirs });
      copySnapshotSweepSnapshot(live, path.join(snapshots, String(index)));
    },
    /** 一次作用在快照集之外的接缝调用：盘面不变，日志里记 `outside:`，没有目录可记。 */
    outsideCall(method: string, name: string) {
      index += 1;
      ordinal = 0;
      seam.push({ index, method, paths: [`outside:${name}`], dirs: [null] });
      copySnapshotSweepSnapshot(live, path.join(snapshots, String(index)));
    },
    /** 一次目录同步。 */
    sync(directory: string) {
      ordinal += 1;
      syncs.push({ after: index, ordinal, ino: lstatSync(abs(directory)).ino });
    },
    /** 生成一个位置上的盘面，返回它的工作区目录。 */
    state(position: Readonly<PowerLossPosition>, durableThrough = 0) {
      states += 1;
      const destination = path.join(base, `state-${states}`);
      generatePowerLossState(snapshots, seam, position, destination, durableThrough);
      return path.join(destination, "workspace");
    },
    /** 什么都没被盖住时的位置（在第 `at` 次调用之后）。 */
    nothingCovered(at: number): PowerLossPosition {
      return { seam: at, sync: 0, label: `${at}~0`, covered: new Map() };
    },
    covering(at: number, directories: readonly string[]): PowerLossPosition {
      return {
        seam: at,
        sync: 1,
        label: `${at}~1`,
        covered: new Map(directories.map((directory) => [lstatSync(abs(directory)).ino, at])),
      };
    },
  };
}

test("新建、链接、删暂存：只有盖住了新变更的目录同步才出一份盘面，各自是那一刻落了盘的样子", (t) => {
  const f = fixture(t);
  mkdirSync(f.abs("d"));
  mkdirSync(f.abs("other"));
  f.baseline();
  f.call("openExclusive", ["d/.stage"], () => writeFileSync(f.abs("d/.stage"), "record\n"));
  f.sync("other"); // 别的目录：什么都没盖住
  f.call("link", ["d/.stage", "d/target"], () => linkSync(f.abs("d/.stage"), f.abs("d/target")));
  f.sync("d"); // 盖住新建与链接
  f.sync("d"); // 没有新的变更
  f.call("unlink", ["d/.stage"], () => unlinkSync(f.abs("d/.stage")));
  f.sync("d"); // 盖住删暂存
  const positions = powerLossPositions(f.seam, f.syncs);
  deepEqual(
    positions.map((position) => position.label),
    ["2~1", "3~1"],
  );
  const linked = f.state(positions[0] as PowerLossPosition);
  deepEqual(readdirSync(path.join(linked, "d")).sort(), [".stage", "target"]);
  equal(lstatSync(path.join(linked, "d", "target")).nlink, 2);
  const settled = f.state(positions[1] as PowerLossPosition);
  deepEqual(readdirSync(path.join(settled, "d")), ["target"]);
  // 三步都做完、却一次目录同步都没有：掉电之后回到开始之前。
  const lost = f.state(f.nothingCovered(3));
  deepEqual(readdirSync(path.join(lost, "d")), []);
  // 链接已经落盘、删暂存没有：暂存回来，与目标仍是同一个 inode 的两个名字。
  const resurrected = f.state({ ...(positions[0] as PowerLossPosition), seam: 3, label: "3~0" });
  deepEqual(readdirSync(path.join(resurrected, "d")).sort(), [".stage", "target"]);
  equal(
    lstatSync(path.join(resurrected, "d", ".stage")).ino,
    lstatSync(path.join(resurrected, "d", "target")).ino,
  );
  equal(lstatSync(path.join(resurrected, "d", "target")).nlink, 2);
});

test("跨两个目录的改名：两半各看各的父目录有没有同步", (t) => {
  const f = fixture(t);
  mkdirSync(f.abs("stages/x"), { recursive: true });
  mkdirSync(f.abs("current"));
  writeFileSync(f.abs("stages/x/identity.json"), "{}\n");
  f.baseline();
  f.call("rename", ["stages/x", "current/x"], () =>
    renameSync(f.abs("stages/x"), f.abs("current/x")),
  );
  const names = (workspace: string) => [
    existsSync(path.join(workspace, "stages", "x", "identity.json")),
    existsSync(path.join(workspace, "current", "x", "identity.json")),
  ];
  // 都没同步：改回去。
  deepEqual(names(f.state(f.nothingCovered(1))), [true, false]);
  // 只同步了源目录：旧名字的消失落了盘，新名字的出现没有——两个名字都不在。
  deepEqual(names(f.state(f.covering(1, ["stages"]))), [false, false]);
  // 只同步了目标目录：新名字在，旧名字也回来。
  deepEqual(names(f.state(f.covering(1, ["current"]))), [true, true]);
  // 两个都同步了：就是改名之后的样子。
  deepEqual(names(f.state(f.covering(1, ["stages", "current"]))), [false, true]);
});

test("没同步的整树删除被原样放回；同步过的不放回", (t) => {
  const f = fixture(t);
  mkdirSync(f.abs("current/d/sub"), { recursive: true });
  writeFileSync(f.abs("current/d/a.json"), "a\n");
  writeFileSync(f.abs("current/d/sub/b.json"), "b\n");
  f.baseline();
  f.call("removeTree", ["current/d"], () => rmSync(f.abs("current/d"), { recursive: true }));
  const back = f.state(f.nothingCovered(1));
  equal(readFileSync(path.join(back, "current", "d", "sub", "b.json"), "utf8"), "b\n");
  equal(readFileSync(path.join(back, "current", "d", "a.json"), "utf8"), "a\n");
  equal(existsSync(path.join(f.state(f.covering(1, ["current"])), "current", "d")), false);
});

test("没同步的新目录连同里面已经同步过的文件一起消失；集外的路径不撤销", (t) => {
  const f = fixture(t);
  mkdirSync(f.abs("current"));
  f.baseline();
  f.call("mkdir", ["current/lifecycle"], () => mkdirSync(f.abs("current/lifecycle")));
  f.call("openExclusive", ["current/lifecycle/journal.json"], () =>
    writeFileSync(f.abs("current/lifecycle/journal.json"), "{}\n"),
  );
  f.sync("current/lifecycle"); // 日志的名字落了盘，日志目录自己的名字没有
  f.outsideCall("openExclusive", "candidate");
  const positions = powerLossPositions(f.seam, f.syncs);
  deepEqual(
    positions.map((position) => position.label),
    ["2~1"],
  );
  const state = f.state({ ...(positions[0] as PowerLossPosition), seam: 3, label: "3~0" });
  equal(existsSync(path.join(state, "current", "lifecycle")), false);
  equal(existsSync(path.join(state, "current")), true);
});

test("之后有一次留下来的目录删除或改名：更早没同步的变更照现在的名字撤销，目录已经不在的就跳过", (t) => {
  // 目录里删了一个文件（没同步），接着整棵目录被删、并且这次删除落了盘：文件无处可放回，不报错。
  const removed = fixture(t);
  mkdirSync(removed.abs("current/D"), { recursive: true });
  writeFileSync(removed.abs("current/D/f.json"), "f\n");
  removed.baseline();
  removed.call("unlink", ["current/D/f.json"], () => unlinkSync(removed.abs("current/D/f.json")));
  removed.call("removeTree", ["current/D"], () =>
    rmSync(removed.abs("current/D"), { recursive: true }),
  );
  equal(
    existsSync(path.join(removed.state(removed.covering(2, ["current"])), "current", "D")),
    false,
  );

  // 同样的删除，之后目录被改名、改名落了盘：文件回到改了名的目录里。
  const renamed = fixture(t);
  mkdirSync(renamed.abs("current/D/snapshots"), { recursive: true });
  writeFileSync(renamed.abs("current/D/snapshots/0006.json"), "{}\n");
  renamed.baseline();
  renamed.call("unlink", ["current/D/snapshots/0006.json"], () =>
    unlinkSync(renamed.abs("current/D/snapshots/0006.json")),
  );
  renamed.call("rename", ["current/D", "current/.retire-D"], () =>
    renameSync(renamed.abs("current/D"), renamed.abs("current/.retire-D")),
  );
  const tombstone = path.join(renamed.state(renamed.covering(2, ["current"])), "current");
  deepEqual(readdirSync(tombstone), [".retire-D"]);
  equal(existsSync(path.join(tombstone, ".retire-D", "snapshots", "0006.json")), true);

  // 目录里新建了一个文件（没同步），接着目录被改名、改名落了盘：文件不该留在改了名的目录里。
  const restored = fixture(t);
  mkdirSync(restored.abs("current/.restore-x"), { recursive: true });
  restored.baseline();
  restored.call("openExclusive", ["current/.restore-x/a.json"], () =>
    writeFileSync(restored.abs("current/.restore-x/a.json"), "{}\n"),
  );
  restored.call("rename", ["current/.restore-x", "current/D"], () =>
    renameSync(restored.abs("current/.restore-x"), restored.abs("current/D")),
  );
  deepEqual(
    readdirSync(path.join(restored.state(restored.covering(2, ["current"])), "current", "D")),
    [],
  );
});

test("盖掉旧目标的改名、删空目录、铺垫当作已落盘，以及跨目录硬链接对这条局限", (t) => {
  // 改名盖掉了已有的目标，没同步：暂存回来，旧目标也回来。
  const replaced = fixture(t);
  mkdirSync(replaced.abs("d"));
  writeFileSync(replaced.abs("d/target"), "old\n");
  writeFileSync(replaced.abs("d/.stage"), "new\n");
  replaced.baseline();
  replaced.call("rename", ["d/.stage", "d/target"], () =>
    renameSync(replaced.abs("d/.stage"), replaced.abs("d/target")),
  );
  const back = path.join(replaced.state(replaced.nothingCovered(1)), "d");
  equal(readFileSync(path.join(back, "target"), "utf8"), "old\n");
  equal(readFileSync(path.join(back, ".stage"), "utf8"), "new\n");

  // 删掉的空目录，没同步：回来。
  const emptied = fixture(t);
  mkdirSync(emptied.abs("current/empty"), { recursive: true });
  emptied.baseline();
  emptied.call("rmdir", ["current/empty"], () => rmdirSync(emptied.abs("current/empty")));
  equal(existsSync(path.join(emptied.state(emptied.nothingCovered(1)), "current", "empty")), true);

  // 铺垫（第 1 次调用）当作已经落盘：不撤销，也不出盘面；之后的照常。
  const prepared = fixture(t);
  mkdirSync(prepared.abs("d"));
  prepared.baseline();
  prepared.call("openExclusive", ["d/setup"], () => writeFileSync(prepared.abs("d/setup"), "s\n"));
  prepared.sync("d");
  prepared.call("openExclusive", ["d/swept"], () => writeFileSync(prepared.abs("d/swept"), "w\n"));
  prepared.sync("d");
  deepEqual(
    powerLossPositions(prepared.seam, prepared.syncs, 1).map((position) => position.label),
    ["2~1"],
  );
  deepEqual(readdirSync(path.join(prepared.state(prepared.nothingCovered(2), 1), "d")), ["setup"]);

  // 局限：跨两个目录的硬链接对，放回的是一份独立的拷贝。
  const linked = fixture(t);
  mkdirSync(linked.abs("candidates"));
  mkdirSync(linked.abs("commits"));
  writeFileSync(linked.abs("candidates/c"), "commit\n");
  linkSync(linked.abs("candidates/c"), linked.abs("commits/c"));
  linked.baseline();
  linked.call("unlink", ["candidates/c"], () => unlinkSync(linked.abs("candidates/c")));
  const pair = linked.state(linked.nothingCovered(1));
  equal(readFileSync(path.join(pair, "candidates", "c"), "utf8"), "commit\n");
  equal(lstatSync(path.join(pair, "commits", "c")).nlink, 1);
});
