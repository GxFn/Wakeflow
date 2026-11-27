/**
 * 组件级（第 1 级）：`settleObservedResourceEntry`——沿用一个"已经在盘面上"的目录项结果之前把它落盘
 * （1.4.1 段 1b）。
 *
 * 在 `fsync` 根上钉住：目标"在"与"不在"各恰好同步父目录一次，同步的是目标所在的那个目录；目标不是
 * 调用方看到的样子时一次都不同步、报 `observation-changed`；同步失败报 `durability-failure`；父目录
 * 打不开、已中止与非法输入各有自己的原因；每条路径上句柄恰好关闭一次。`none` 根只跳过 fsync 系统调用。
 * "不在"的目标连父目录都不在时，同步的是最近一个还在的上级目录（门里证据切片的一条 recover 测试查出来的：
 * 过期的证据事务从没物化过暂存目录，原来这里报父目录打不开，那条 recover 从此一直被拒）。
 */
import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import {
  DurableResourceEntrySettlementError,
  settleObservedResourceEntry,
} from "../../../src/foundation/filesystem/durable-resource-entry-settlement.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  RootedResourceParentHandle,
  RootedResourceParentHandleError,
} from "../../../src/foundation/filesystem/rooted-resource-parent-handle.js";
import { OperationAbortedError } from "../../../src/foundation/node/abort-signal.js";
import { countFsyncs } from "./fsync-count-probe.js";

const PRESENT = parsePortableResourcePath("records/present.json");
const ABSENT = parsePortableResourcePath("records/absent.json");
const ROOT_LEVEL = parsePortableResourcePath("config.json");

async function fixture(t: TestContext, durability: "fsync" | "none" = "fsync") {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-entry-settlement-")));
  mkdirSync(path.join(base, "records"));
  writeFileSync(path.join(base, "records", "present.json"), "{}\n");
  writeFileSync(path.join(base, "config.json"), "{}\n");
  const root = await RootedDirectory.open(base, "$root", { durability });
  t.after(async () => {
    await root.close();
    rmSync(base, { recursive: true, force: true });
  });
  return { base, root };
}

/** 记下父目录句柄的同步（同步的是哪个目标的父目录）与关闭次数；`failSync` 让同步抛错且不执行。 */
function recordParentHandle(t: TestContext, options: { failSync?: boolean } = {}) {
  const syncs: string[] = [];
  let closes = 0;
  const originalSync = RootedResourceParentHandle.prototype.sync;
  t.mock.method(
    RootedResourceParentHandle.prototype,
    "sync",
    async function (this: RootedResourceParentHandle, ...args: Parameters<typeof originalSync>) {
      syncs.push(this.resourceAbsolutePath);
      if (options.failSync === true) {
        throw new RootedResourceParentHandleError("sync-failure", "$test");
      }
      return originalSync.apply(this, args);
    },
  );
  const originalClose = RootedResourceParentHandle.prototype.close;
  t.mock.method(
    RootedResourceParentHandle.prototype,
    "close",
    async function (this: RootedResourceParentHandle) {
      closes += 1;
      return originalClose.apply(this);
    },
  );
  return { syncs, closes: () => closes };
}

async function reasonOf(
  action: () => Promise<unknown>,
): Promise<DurableResourceEntrySettlementError["reason"]> {
  try {
    await action();
  } catch (error: unknown) {
    ok(error instanceof DurableResourceEntrySettlementError);
    return error.reason;
  }
  throw new Error("Expected a settlement error.");
}

test("present 与 absent 各同步目标所在的目录恰好一次，句柄关闭一次", async (t) => {
  const f = await fixture(t);
  const recorded = recordParentHandle(t);
  equal(
    (await countFsyncs(() => settleObservedResourceEntry(f.root, PRESENT, "present"))).syncCount,
    1,
  );
  equal(
    (await countFsyncs(() => settleObservedResourceEntry(f.root, ABSENT, "absent"))).syncCount,
    1,
  );
  // 根一级的资源：父目录就是根。
  equal(
    (await countFsyncs(() => settleObservedResourceEntry(f.root, ROOT_LEVEL, "present"))).syncCount,
    1,
  );
  deepEqual(recorded.syncs, [
    path.join(f.base, "records", "present.json"),
    path.join(f.base, "records", "absent.json"),
    path.join(f.base, "config.json"),
  ]);
  equal(recorded.closes(), 3);
});

test("目标不是调用方看到的样子：不同步，报 observation-changed", async (t) => {
  const f = await fixture(t);
  const recorded = recordParentHandle(t);
  equal(
    await reasonOf(() => settleObservedResourceEntry(f.root, ABSENT, "present")),
    "observation-changed",
  );
  equal(
    await reasonOf(() => settleObservedResourceEntry(f.root, PRESENT, "absent")),
    "observation-changed",
  );
  // 名字还在，但已经是另一个节点。
  const expectedNode = (await f.root.inspectExistingResource(PRESENT)).node;
  unlinkSync(path.join(f.base, "records", "present.json"));
  writeFileSync(path.join(f.base, "records", "other.json"), "{}\n");
  writeFileSync(path.join(f.base, "records", "present.json"), "{}\n");
  equal(
    await reasonOf(() => settleObservedResourceEntry(f.root, PRESENT, "present", { expectedNode })),
    "observation-changed",
  );
  deepEqual(recorded.syncs, []);
  equal(recorded.closes(), 3);
  // 同一个节点时照常同步。
  const current = (await f.root.inspectExistingResource(PRESENT)).node;
  await settleObservedResourceEntry(f.root, PRESENT, "present", { expectedNode: current });
  equal(recorded.syncs.length, 1);
});

test("同步失败报 durability-failure，句柄仍然关闭一次", async (t) => {
  const f = await fixture(t);
  const recorded = recordParentHandle(t, { failSync: true });
  equal(
    await reasonOf(() => settleObservedResourceEntry(f.root, PRESENT, "present")),
    "durability-failure",
  );
  equal(recorded.syncs.length, 1);
  equal(recorded.closes(), 1);
});

test("absent 的目标连父目录都不在：同步最近一个还在的上级目录一次；present 的目标照旧是父目录打不开", async (t) => {
  const f = await fixture(t);
  const recorded = recordParentHandle(t);
  // 那一段路径从没建过：两层都不在，最近的还在的上级是根。
  await settleObservedResourceEntry(
    f.root,
    parsePortableResourcePath("missing/deeper/x.json"),
    "absent",
  );
  deepEqual(recorded.syncs, [path.join(f.base, "missing")]);
  equal(recorded.closes(), 1);
  // 只少最后一层：同步的是 `records/`。
  await settleObservedResourceEntry(
    f.root,
    parsePortableResourcePath("records/gone/x.json"),
    "absent",
  );
  deepEqual(recorded.syncs, [path.join(f.base, "missing"), path.join(f.base, "records", "gone")]);
  // 父目录的位置上是一个文件：不是"不在"，照旧打不开。
  equal(
    await reasonOf(() =>
      settleObservedResourceEntry(
        f.root,
        parsePortableResourcePath("config.json/x.json"),
        "absent",
      ),
    ),
    "parent-open-failure",
  );
  equal(
    await reasonOf(() =>
      settleObservedResourceEntry(f.root, parsePortableResourcePath("missing/x.json"), "present"),
    ),
    "parent-open-failure",
  );
  equal(recorded.syncs.length, 2);
});

test("父目录打不开、已中止与非法输入各有自己的原因，都不同步", async (t) => {
  const f = await fixture(t);
  const recorded = recordParentHandle(t);
  equal(
    await reasonOf(() =>
      settleObservedResourceEntry(f.root, parsePortableResourcePath("missing/x.json"), "present"),
    ),
    "parent-open-failure",
  );
  const aborted = new AbortController();
  aborted.abort();
  await rejects(
    () => settleObservedResourceEntry(f.root, PRESENT, "present", { signal: aborted.signal }),
    OperationAbortedError,
  );
  // `expectedNode` 只对 present 有意义。
  const node = (await f.root.inspectExistingResource(PRESENT)).node;
  equal(
    await reasonOf(() =>
      settleObservedResourceEntry(f.root, ABSENT, "absent", { expectedNode: node }),
    ),
    "input",
  );
  deepEqual(recorded.syncs, []);
});

test("none 根：核对照做、同步方法照常调用，只跳过 fsync 系统调用", async (t) => {
  const f = await fixture(t, "none");
  const recorded = recordParentHandle(t);
  equal(
    (await countFsyncs(() => settleObservedResourceEntry(f.root, PRESENT, "present"))).syncCount,
    0,
  );
  equal(recorded.syncs.length, 1);
  equal(
    await reasonOf(() => settleObservedResourceEntry(f.root, ABSENT, "present")),
    "observation-changed",
  );
});
