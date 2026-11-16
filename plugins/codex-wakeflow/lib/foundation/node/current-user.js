/**
 * Wakeflow Foundation / Node：当前进程的有效用户（open-items L4）。
 *
 * 属主检查散在四十多个模块里，写法有三种：拿不到就放行的（`… : null`）、拿不到就按模块自己的错误失败的、
 * 以及直接内联在节点判断里的。三种说的是同一条策略——节点必须属于运行 Wakeflow 的这个用户，而没有
 * `geteuid` 的平台（Windows）核对不了属主。这里把"怎么问"写一次；"拿不到怎么办"仍由调用方用自己的
 * 错误类说。
 */
/** 有效用户标识；平台不提供 `geteuid` 时为 null（调用方据此不核对属主）。 */
export function currentUserIdOrNull() {
    return typeof process.geteuid === "function" ? BigInt(process.geteuid()) : null;
}
/**
 * 有效用户标识；平台不提供时调用 `onUnsupported`——它必须抛出调用方自己的错误。
 * Windows 上即使有同名函数也不认：那里的属主语义不同。
 */
export function requireCurrentUserId(onUnsupported) {
    if (process.platform === "win32" || typeof process.geteuid !== "function")
        onUnsupported();
    return BigInt(process.geteuid());
}
/** 这个属主不是当前用户；平台不提供 `geteuid` 时不核对，一律为 false。 */
export function ownedByAnotherUser(userId) {
    return typeof process.geteuid === "function" && userId !== BigInt(process.geteuid());
}
