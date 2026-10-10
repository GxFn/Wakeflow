import os from "node:os";
/**
 * Wakeflow Foundation / Node：当前用户家目录。
 *
 * 宿主中立层把家目录只用作脱敏边界的一员（公共结果里永不出现它），本端口把 `node:os` 收在
 * foundation 里，内核与切片不再直接取得核心模块（§13.166 批次 1）。返回 Node 解析出的绝对路径；
 * 它不做存在性检查，也不规范化符号链接。
 */
export function currentUserHomeDirectory() {
    return os.homedir();
}
