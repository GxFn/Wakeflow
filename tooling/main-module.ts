import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Wakeflow Tooling：一个模块是否就是本进程的入口脚本。
 *
 * Node 按真实路径解析入口模块，但 `process.argv[1]` 保留调用时写的路径；经符号链接调用时两者
 * 不等，入口脚本就会在加载后什么都不做地以 0 退出——一次"通过"的空跑（gate-log §13.161）。
 * 所以两边都按真实路径比较，解析不了的路径退回规整后的字面值。
 */
export function isMainModule(moduleUrl: string): boolean {
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  return realPathOf(invoked) === realPathOf(fileURLToPath(moduleUrl));
}

function realPathOf(value: string): string {
  const resolved = path.resolve(value);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}
