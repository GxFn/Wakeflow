import { mkdtempSync, rmSync } from "node:fs";
import { open as openFileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * 观察一段写入真正发出了多少次 `fsync`。
 *
 * 持久化级别的唯一可观察差异就是这些系统调用有没有发生：字节、权限位、原子可见性与
 * 错误分类在两档之间必须完全一样。因此断言"跳过了同步"只能数调用，不能数时间。
 * 计数期间仍然转调原方法，被测代码走的还是同一条真实路径。
 *
 * `FileHandle` 没有公开构造器，只能从一个真实句柄取到原型；补丁是进程全局的，所以
 * 安装期间同一进程里不得有其他会发出 `fsync` 的工作（例如并发的子测试）同时运行，
 * 并且总在 `finally` 里还原。
 */

interface FileHandleSyncPrototype {
  sync: (this: unknown) => Promise<void>;
}

let cachedPrototype: FileHandleSyncPrototype | undefined;

async function fileHandleSyncPrototype(): Promise<FileHandleSyncPrototype> {
  if (cachedPrototype !== undefined) return cachedPrototype;
  const directory = mkdtempSync(path.join(os.tmpdir(), "wakeflow-fsync-probe-"));
  const probe = await openFileHandle(path.join(directory, "probe"), "w");
  const prototype = Object.getPrototypeOf(probe) as FileHandleSyncPrototype;
  await probe.close();
  rmSync(directory, { recursive: true, force: true });
  cachedPrototype = prototype;
  return prototype;
}

export interface CountedFsyncRun<Result> {
  readonly result: Result;
  readonly syncCount: number;
}

/** 执行 `run`，返回它的结果与期间发生的 `fsync` 次数。 */
export async function countFsyncs<Result>(
  run: () => Promise<Result>,
): Promise<Readonly<CountedFsyncRun<Result>>> {
  const prototype = await fileHandleSyncPrototype();
  const original = prototype.sync;
  let syncCount = 0;
  prototype.sync = async function countedSync(this: unknown): Promise<void> {
    syncCount += 1;
    return original.call(this);
  };
  try {
    const result = await run();
    return Object.freeze({ result, syncCount });
  } finally {
    prototype.sync = original;
  }
}
