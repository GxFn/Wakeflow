import {
  RootedDirectory,
  type RootedDirectoryOpenOptions,
} from "../../src/foundation/filesystem/rooted-directory.js";
import { DISPOSABLE_ROOT_OPTIONS } from "./prepared-workspace.js";

let installed = false;

/**
 * 本测试进程里，省略 `durability` 打开的根一律按 `none` 打开（只跳过 fsync 系统调用；暂存、原子改名、
 * 权限位、CAS 与错误分类不变），显式 `{ durability: "fsync" }` 仍按 fsync。
 *
 * 为什么包装而不是改生产：组合根、内核、治理与能力层都不传这个选项，生产工作区永远是 fsync
 * （rooted-directory.ts）；一次性测试工作区付 fsync 只是在买没人兑现的保险（prepared-workspace.ts，
 * plan §11）。多个测试进程同时 fsync 还会互相排队——门里的场景链 589 秒，单独跑 319 秒，去掉 fsync
 * 289 秒（§13.205）。`RootedDirectory.open` 是唯一的构造入口，所以包装它一处就覆盖整个进程；每个
 * 文件一个进程，子进程（lab 实验、真实制品）不受影响。1–3 级测试文件在顶部调用一次（测试开发标准
 * §4）；测试耐久性本身的文件不调用。幂等。
 */
export function useDisposableDurability(): void {
  if (installed) return;
  installed = true;
  const open = RootedDirectory.open.bind(RootedDirectory);
  RootedDirectory.open = (
    value: unknown,
    errorPath?: string,
    options?: Readonly<RootedDirectoryOpenOptions>,
  ): Promise<RootedDirectory> =>
    open(value, errorPath, options?.durability === undefined ? DISPOSABLE_ROOT_OPTIONS : options);
}
