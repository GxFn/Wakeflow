/**
 * Wakeflow Foundation / Node：打开文件时一并取得内核咨询锁的两个标志（ADR-0033）。
 *
 * Node.js 的 `fs.constants` 不导出它们，这里按 macOS 的数值定义；别的平台为 null，调用方据此报"不支持"
 * 而不是带着一个含义不同的数值去打开文件（ADR-0021：只支持 macOS）。
 */
const DARWIN_ADVISORY_LOCK_FLAGS = Object.freeze({
    shared: 0x10,
    exclusive: 0x20,
});
/** 当前平台的两个标志；平台不提供时为 null。 */
export function advisoryLockFlagsOrNull() {
    return process.platform === "darwin" ? DARWIN_ADVISORY_LOCK_FLAGS : null;
}
