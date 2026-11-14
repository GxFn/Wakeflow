import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
/**
 * Wakeflow Foundation / Node：一个路径所在卷的文件系统类型（open-items B11）。
 *
 * 锁、原子发布与私有模式依赖本地文件系统的 link、rename 与权限语义；平台范围是 macOS 的本地文件系统
 * （ADR-0021）。这里只回答"这个路径在什么类型的卷上"：macOS 上先用 `df -P` 找到挂载点，再从 `mount` 的
 * 清单里读那个挂载点的类型名。别的平台与读不出的情况都是 null——读不出不是证据，调用方不得因此拒绝。
 */
const execute = promisify(execFile);
const TYPE_NAME = /^[a-z0-9_.-]{1,32}$/u;
/** macOS 上的本地文件系统：APFS 与 HFS+。网络卷（nfs、smbfs、afpfs、webdav）与 FAT / exFAT 不在其列。 */
const LOCAL_FILESYSTEM_TYPES = Object.freeze(["apfs", "hfs"]);
export function isLocalFilesystemType(name) {
    return LOCAL_FILESYSTEM_TYPES.includes(name);
}
/** `df -P <path>` 的输出里那一行数据的挂载点（最后一列，可以带空格）；不是这个形状为 null。 */
export function parseDfMountPoint(output) {
    const line = output.trimEnd().split("\n").at(-1) ?? "";
    const match = /^.*?\s+[0-9]+\s+[0-9]+\s+-?[0-9]+\s+[0-9]+%\s+(\/.*)$/u.exec(line);
    return match?.[1] ?? null;
}
/** `mount` 的清单里某个挂载点的类型名（括号里的第一项，小写）；找不到为 null。 */
export function parseMountType(output, mountPoint) {
    for (const line of output.split("\n")) {
        const match = /^.+ on (\/.*) \(([^()]*)\)$/u.exec(line);
        if (match === null || match[1] !== mountPoint)
            continue;
        const name = (match[2] ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
        return TYPE_NAME.test(name) ? name : null;
    }
    return null;
}
/** 路径本身还不存在时（例如初始化之前的账本根）取最近的已存在祖先：卷的类型由它决定。 */
function nearestExistingPath(absolutePath) {
    let current = absolutePath;
    while (!existsSync(current)) {
        const parent = path.dirname(current);
        if (parent === current)
            break;
        current = parent;
    }
    return current;
}
async function command(file, args) {
    const result = await execute(file, [...args], {
        encoding: "utf8",
        timeout: 2_000,
        maxBuffer: 256 * 1024,
        env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LC_ALL: "C" },
    });
    return result.stdout;
}
/**
 * 读出 `absolutePath` 所在卷的文件系统类型名（小写）；路径还不存在时看它最近的已存在祖先。不是 macOS 或
 * 读不出时为 null。
 */
export async function readFilesystemTypeName(absolutePath) {
    if (process.platform !== "darwin")
        return null;
    try {
        const mountPoint = parseDfMountPoint(await command("/bin/df", ["-P", nearestExistingPath(absolutePath)]));
        return mountPoint === null
            ? null
            : parseMountType(await command("/sbin/mount", []), mountPoint);
    }
    catch {
        return null;
    }
}
