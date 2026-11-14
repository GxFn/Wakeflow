import { execFile, execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { computeCanonicalJsonSha256Digest } from "../crypto/canonical-json-sha256.js";
import { readNodeSystemErrorCode } from "./node-system-error.js";
const execute = promisify(execFile);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
let boot;
let ownBirth;
async function command(file, args) {
    const result = await execute(file, [...args], {
        encoding: "utf8",
        timeout: 2_000,
        maxBuffer: 4096,
        env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LC_ALL: "C", TZ: "UTC" },
    });
    return result.stdout.trim();
}
async function bootIdentity() {
    try {
        const value = process.platform === "linux"
            ? (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim()
            : process.platform === "darwin"
                ? await command("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"])
                : "";
        return UUID.test(value) ? value.toLowerCase() : null;
    }
    catch {
        return null;
    }
}
async function readBirth(pid) {
    try {
        boot ??= bootIdentity();
        const bootId = await boot;
        // A failed read is not evidence: forget it so the next observation tries again (§13.161 F2).
        if (bootId === null) {
            boot = undefined;
            return null;
        }
        let started;
        if (process.platform === "linux") {
            const stat = await readFile(`/proc/${pid}/stat`, "utf8");
            if (stat.length > 8192 || !stat.startsWith(`${pid} (`))
                return null;
            started =
                stat
                    .slice(stat.lastIndexOf(")") + 2)
                    .trim()
                    .split(/\s+/u)[19] ?? "";
            if (!/^[0-9]+$/u.test(started))
                return null;
        }
        else if (process.platform === "darwin") {
            started = await command("/bin/ps", ["-p", String(pid), "-o", "lstart="]);
            if (!/^[A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+[0-9]{1,2}\s+[0-9]{2}:[0-9]{2}:[0-9]{2}\s+[0-9]{4}$/u.test(started))
                return null;
        }
        else {
            return null;
        }
        return computeCanonicalJsonSha256Digest({ platform: process.platform, bootId, pid, started });
    }
    catch {
        return null;
    }
}
/** Unknown platforms/permissions remain unknown; elapsed time is never death evidence. */
export async function observeProcessInstance(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0)
        throw new TypeError("Invalid process identifier.");
    let state = "active";
    try {
        process.kill(pid, 0);
    }
    catch (error) {
        if (readNodeSystemErrorCode(error) === "ESRCH")
            return Object.freeze({ state: "inactive", birthDigest: null });
        state = "unknown";
    }
    if (pid === process.pid && ownBirth === undefined)
        ownBirth = readBirth(pid);
    const birth = pid === process.pid ? ownBirth : readBirth(pid);
    const birthDigest = (await birth) ?? null;
    if (pid === process.pid && birthDigest === null)
        ownBirth = undefined;
    if (birthDigest === null && state === "active" && pid !== process.pid) {
        // The process may have exited between kill(0) and the birth read: confirm it is still there.
        try {
            process.kill(pid, 0);
        }
        catch (error) {
            if (readNodeSystemErrorCode(error) === "ESRCH")
                return Object.freeze({ state: "inactive", birthDigest: null });
            state = "unknown";
        }
    }
    return Object.freeze({ state, birthDigest });
}
/** A different positively observed birth proves the recorded process no longer exists. */
export function recordedProcessIsInactive(recordedBirth, current) {
    return (current.state === "inactive" ||
        (recordedBirth !== null &&
            current.birthDigest !== null &&
            recordedBirth !== current.birthDigest));
}
// 正在落盘的暂存只存在几毫秒；残留放了这么久才值得为它去问一次 `ps`。时间本身从不是死亡的证据，
// 它只决定要不要去取更强的证据，顺带让争用路径上看到别的进程的在途暂存时不必起子进程。
const PID_REUSE_CHECK_MINIMUM_AGE_MS = 60_000;
// `ps` 的启动时刻只到秒；再留一点余量。
const STARTED_AFTER_MARGIN_MS = 2_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOLDER_LINE = /^\s*([0-9]+)\s+[A-Z][a-z]{2}\s+([A-Z][a-z]{2})\s+([0-9]{1,2})\s+([0-9]{2}):([0-9]{2}):([0-9]{2})\s+([0-9]{4})$/u;
/** `ps -o uid=,lstart=` 的一行（TZ=UTC、LC_ALL=C）；不是这个形状为 null。 */
export function parseProcessHolderLine(line) {
    const match = HOLDER_LINE.exec(line.trim());
    if (match === null)
        return null;
    const month = MONTHS.indexOf(match[2] ?? "");
    const userId = Number(match[1]);
    if (month < 0 || !Number.isSafeInteger(userId))
        return null;
    const startedAtMs = Date.UTC(Number(match[7]), month, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
    return Number.isFinite(startedAtMs) ? Object.freeze({ userId, startedAtMs }) : null;
}
function readProcessHolderSync(pid) {
    if (process.platform !== "darwin" && process.platform !== "linux")
        return null;
    try {
        const output = execFileSync("ps", ["-p", String(pid), "-o", "uid=,lstart="], {
            encoding: "utf8",
            timeout: 2_000,
            maxBuffer: 4096,
            stdio: ["ignore", "pipe", "ignore"],
            env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LC_ALL: "C", TZ: "UTC" },
        });
        return parseProcessHolderLine(output);
    }
    catch {
        return null;
    }
}
/**
 * 只凭 pid 记下所有者的残留，它的所有者还在不在。`kill(pid, 0)` 一项答不了两种情况：pid 被别的进程重用
 * （答"在"，残留永远退不掉），以及那个进程属于别的用户（EPERM，答不出）。残留节点自己带着两项事实，足以
 * 证明"现在占着这个 pid 的进程不是它的创建者"：
 *
 * - 属主不同：残留是属主 A 的进程建的，现在占着这个 pid 的进程属于 B——不是同一个进程。
 * - 启动得更晚：创建者在最后一次写这个文件时必然已经在运行；现在占着这个 pid 的进程在那之后才启动
 *   ——不是同一个进程。
 *
 * 两项都要读一次 `ps`，所以只在 pid 确实有人占着、并且（发不了信号，或残留已经放了一分钟以上）时才读；
 * 读不出就维持原来的回答（能发信号为 active，否则 unknown）。没有节点事实时就是原来的 `kill(pid, 0)`。
 */
export function observePidOwnerSync(pid, node, options = {}) {
    if (!Number.isSafeInteger(pid) || pid <= 0)
        throw new TypeError("Invalid process identifier.");
    let signalable = true;
    try {
        process.kill(pid, 0);
    }
    catch (error) {
        if (readNodeSystemErrorCode(error) === "ESRCH")
            return "inactive";
        signalable = false;
    }
    const fallback = signalable ? "active" : "unknown";
    if (node === undefined)
        return fallback;
    const modifiedAtMs = Number(node.modifiedAtNanoseconds / 1000000n);
    const aged = (options.now ?? Date.now)() - modifiedAtMs >= PID_REUSE_CHECK_MINIMUM_AGE_MS;
    if (signalable && !aged)
        return fallback;
    const holder = (options.readHolder ?? readProcessHolderSync)(pid);
    if (holder === null)
        return fallback;
    if (BigInt(holder.userId) !== node.userId)
        return "inactive";
    return aged && holder.startedAtMs > modifiedAtMs + STARTED_AFTER_MARGIN_MS
        ? "inactive"
        : fallback;
}
