import { link, mkdir, open, rename, rm, rmdir, unlink } from "node:fs/promises";
/**
 * Wakeflow Foundation / Filesystem：改动目录项的唯一出口。
 *
 * `src` 里的运行时代码每一次可见的目录项变化——排他创建文件、建立硬链接、重命名、
 * 删除文件、创建目录、删除空目录、递归删除目录树——都经由本对象完成，唯一的例外见
 * 文末。每个成员只是 `node:fs/promises` 对应函数的直接转发：不增加行为、不映射错误、
 * 不记录日志，参数和返回值与原函数一致，调用顺序、错误处理和结算语义仍由各原语自己负责。
 * `tests/foundation/filesystem/filesystem-mutation.test.ts` 静态扫描 `src` 下全部 `.ts`
 * （`generated` 目录除外），拒绝绕过本出口的写法；发布到工作区的 `.mjs` 助手脚本在宿主
 * 的其他进程里运行，不在此列。
 *
 * 本出口存在的理由是测试：崩溃和中断测试通过替换本对象的成员，在每一次可见变化处
 * 观察调用序列或在指定位置停下，而不必依赖父目录同步等间接信号。因此本对象刻意不
 * 冻结；生产代码绝不重新赋值它的成员，只有测试可以临时替换并在结束时还原。
 *
 * 刻意不在本出口内的操作：文件内容写入（`handle.write`）和模式变更（`handle.chmod`）
 * 不改变目录项；读路径使用的非排他 `open` 也不经过这里。唯一绕过本出口的目录项变化是
 * `src/foundation/git` 在系统临时目录下建（`mkdtemp`）和删（递归 `rm`）Git 临时工作树，
 * 它位于任何工作区根之外；树里的文件（`.gitignore` 候选）仍经本出口创建，快照扫描把
 * 这些调用记为工作区之外的点（`outside:`）。
 */
export const filesystemMutation = {
    /** 以排他创建标志打开新文件；`flags` 由调用方给出含 `O_CREAT|O_EXCL` 的组合，本函数不检查、原样转发。 */
    async openExclusive(path, flags, mode) {
        return await open(path, flags, mode);
    },
    async link(existingPath, newPath) {
        await link(existingPath, newPath);
    },
    async rename(oldPath, newPath) {
        await rename(oldPath, newPath);
    },
    async unlink(path) {
        await unlink(path);
    },
    async mkdir(path, options) {
        await mkdir(path, options);
    },
    async rmdir(path) {
        await rmdir(path);
    },
    /** 递归删除整棵目录树，对应 `rm(path, { recursive: true, force: false })`。 */
    async removeTree(path) {
        await rm(path, { recursive: true, force: false });
    },
};
