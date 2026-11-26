/**
 * Wakeflow Foundation / Node：打开文件时一并取得内核咨询锁的两个标志（ADR-0033）。
 *
 * Node.js 的 `fs.constants` 不导出它们，这里按 macOS 的数值定义；别的平台为 null，调用方据此报"不支持"
 * 而不是带着一个含义不同的数值去打开文件（ADR-0021：只支持 macOS）。
 */

interface AdvisoryLockFlags {
  /** `O_SHLOCK`：共享锁，与别的共享锁并存，与独占锁互斥。 */
  readonly shared: number;
  /** `O_EXLOCK`：独占锁，与任何别的锁互斥。 */
  readonly exclusive: number;
}

const DARWIN_ADVISORY_LOCK_FLAGS: Readonly<AdvisoryLockFlags> = Object.freeze({
  shared: 0x10,
  exclusive: 0x20,
});

/** 当前平台的两个标志；平台不提供时为 null。 */
export function advisoryLockFlagsOrNull(): Readonly<AdvisoryLockFlags> | null {
  return process.platform === "darwin" ? DARWIN_ADVISORY_LOCK_FLAGS : null;
}
