import { randomUUID } from "node:crypto";
import {
  type BigIntStats,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/**
 * Wakeflow Tooling / Build lock：与 `tooling/build-lock.mjs` 同一份目录协议的进程内实现，供
 * `wf verify`、`wf handoff` 这类自己会派生 npm 命令的工具使用。
 *
 * 声明是 `mkdir .build/locks/build.lock`，目录里的 `owner.json` 写明持有者；持有者进程已退出的
 * 声明是陈旧的，由等待者回收：先在目录里独占创建 `reclaim` 标记，重读目录身份与 owner 原文仍与刚才的
 * 观察一致才把目录改名后删除，所以两个等待者读到同一个死 owner 时不会互删对方刚建立的活锁，标记已存在
 * 就等别人回收完（§13.161，open-items W24）。没有 `owner.json` 的目录先当作声明者正在写 owner 等待，
 * 满 OWNERLESS_STALE_MILLISECONDS 才按同样方式回收；写 owner 失败的声明者立刻撤掉自己的目录（W25）。
 * 活着的持有者则等待，直到预算用完报 `build-lock-busy`。子进程继承 `WAKEFLOW_BUILD_LOCK_TOKEN`，
 * 带同一令牌的嵌套调用直接重入，不会和自己死锁。
 */

export const BUILD_LOCK_RELATIVE = ".build/locks/build.lock";
export const BUILD_LOCK_TOKEN_VARIABLE = "WAKEFLOW_BUILD_LOCK_TOKEN";
const TIMEOUT_VARIABLE = "WAKEFLOW_BUILD_LOCK_TIMEOUT_SECONDS";
const POLL_MILLISECONDS = 500;
/**
 * 没有 `owner.json` 的声明目录满这个年龄仍无 owner，才视为声明者死在了 mkdir 与写 owner 之间；更年轻
 * 的当作"正在写 owner"等待。`tooling/build-lock.mjs` 用同一个值。
 */
const OWNERLESS_STALE_MILLISECONDS = 10_000;
const OWNER_FILE = "owner.json";
const RECLAIM_MARKER = "reclaim";

export class BuildLockError extends Error {
  override readonly name = "BuildLockError";
  readonly code: "build-lock-busy" | "build-lock-aborted";

  constructor(code: "build-lock-busy" | "build-lock-aborted") {
    super(code === "build-lock-busy" ? "The build lock stayed busy." : "Waiting was aborted.");
    this.code = code;
  }
}

interface BuildLockOwner {
  readonly pid: number;
  readonly token: string;
  readonly command: string;
}

/** 对一个已存在声明目录的一次观察：目录身份、距上次改动的年龄、`owner.json` 原文及其解析结果。 */
interface ClaimObservation {
  readonly ino: bigint;
  readonly ageMs: number;
  readonly ownerText: string | null;
  readonly owner: BuildLockOwner | null;
}

function errorCode(error: unknown): string | undefined {
  return error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

function parseOwner(text: string): BuildLockOwner | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    return {
      pid: typeof record.pid === "number" ? record.pid : Number.NaN,
      token: typeof record.token === "string" ? record.token : "",
      command: typeof record.command === "string" ? record.command : "",
    };
  } catch {
    return null;
  }
}

function statClaim(lockDirectory: string): BigIntStats | null {
  try {
    return statSync(lockDirectory, { bigint: true });
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

/** 目录已不存在，或 `owner.json` 读不了（别人的声明，等它释放）时返回 null。 */
function observeClaim(lockDirectory: string): ClaimObservation | null {
  const stat = statClaim(lockDirectory);
  if (stat === null) return null;
  let ownerText: string | null = null;
  try {
    ownerText = readFileSync(path.join(lockDirectory, OWNER_FILE), "utf8");
  } catch (error: unknown) {
    if (errorCode(error) !== "ENOENT") return null;
  }
  return {
    ino: stat.ino,
    ageMs: Date.now() - Number(stat.mtimeMs),
    ownerText,
    owner: ownerText === null ? null : parseOwner(ownerText),
  };
}

function ownerAlive(owner: BuildLockOwner): boolean {
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) return false;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error: unknown) {
    return errorCode(error) !== "ESRCH";
  }
}

function claimStale(claim: ClaimObservation): boolean {
  return claim.owner === null
    ? claim.ageMs > OWNERLESS_STALE_MILLISECONDS
    : !ownerAlive(claim.owner);
}

/**
 * 回收一个观察为陈旧的声明。返回 true 表示声明路径已空出，调用方应立即重试声明；false 表示继续等待：
 * 标记已存在说明别人正在回收，重读与观察不一致说明别人已回收并重新声明，撤回自己的标记就好。删除先把
 * 目录改名成唯一的同级名字再递归删除，递归删除就不会跨到一个刚被重新声明的目录上，也不会被等待者的
 * 标记打断。
 */
function reclaimStaleClaim(lockDirectory: string, observed: ClaimObservation): boolean {
  const marker = path.join(lockDirectory, RECLAIM_MARKER);
  const reclaimToken = randomUUID();
  try {
    writeFileSync(
      marker,
      `${JSON.stringify({ pid: process.pid, token: reclaimToken, startedAt: new Date().toISOString() })}\n`,
      { flag: "wx", mode: 0o600 },
    );
  } catch (error: unknown) {
    const code = errorCode(error);
    if (code === "EEXIST") return false;
    if (code === "ENOENT") return true;
    throw error;
  }
  const current = observeClaim(lockDirectory);
  if (
    current !== null &&
    current.ino === observed.ino &&
    current.ownerText === observed.ownerText
  ) {
    const retired = `${lockDirectory}.stale-${reclaimToken}`;
    try {
      renameSync(lockDirectory, retired);
    } catch (error: unknown) {
      if (errorCode(error) === "ENOENT") return true;
      throw error;
    }
    rmSync(retired, { recursive: true, force: true });
    return true;
  }
  try {
    if (parseOwner(readFileSync(marker, "utf8"))?.token === reclaimToken) {
      rmSync(marker, { force: true });
    }
  } catch {
    // 标记已随目录一起消失。
  }
  return false;
}

function timeoutMilliseconds(explicit: number | undefined): number {
  if (explicit !== undefined) return explicit;
  const raw = process.env[TIMEOUT_VARIABLE];
  const seconds = raw === undefined ? 3600 : Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error(`${TIMEOUT_VARIABLE} is invalid.`);
  return seconds * 1000;
}

export interface BuildLockOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/**
 * 持锁执行 `body`；`token` 应放进派生子进程的环境（`WAKEFLOW_BUILD_LOCK_TOKEN`），嵌套的
 * `npm run locked` 与 `wf` 命令据此重入。祖先已持锁时直接执行，不再声明。
 */
export async function withBuildLock<Result>(
  root: string,
  command: string,
  body: (token: string) => Promise<Result>,
  options: BuildLockOptions = {},
): Promise<Result> {
  const inherited = process.env[BUILD_LOCK_TOKEN_VARIABLE];
  const lockDirectory = path.join(root, ...BUILD_LOCK_RELATIVE.split("/"));
  mkdirSync(path.dirname(lockDirectory), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + timeoutMilliseconds(options.timeoutMs);
  // 每次声明都用新令牌：继承的令牌只用来识别"祖先已持有这个根的锁"，不能带进别的根的声明。
  const token = randomUUID();
  for (;;) {
    if (options.signal?.aborted === true) throw new BuildLockError("build-lock-aborted");
    try {
      mkdirSync(lockDirectory, { mode: 0o700 });
    } catch (error: unknown) {
      if (errorCode(error) !== "EEXIST") throw error;
      const claim = observeClaim(lockDirectory);
      if (claim !== null) {
        if (claim.owner !== null && inherited !== undefined && claim.owner.token === inherited) {
          return body(inherited);
        }
        if (claimStale(claim) && reclaimStaleClaim(lockDirectory, claim)) continue;
      }
      if (Date.now() >= deadline) throw new BuildLockError("build-lock-busy");
      await delay(POLL_MILLISECONDS);
      continue;
    }
    try {
      writeFileSync(
        path.join(lockDirectory, OWNER_FILE),
        `${JSON.stringify({ pid: process.pid, token, command, startedAt: new Date().toISOString() })}\n`,
        { mode: 0o600 },
      );
    } catch (error: unknown) {
      // 声明还没写上 owner 就失败了：撤掉自己刚建的目录，等待者才不会对着一个无主声明干等。
      try {
        rmSync(lockDirectory, { recursive: true, force: true });
      } catch {
        // 原错误优先。
      }
      throw error;
    }
    try {
      return await body(token);
    } finally {
      rmSync(lockDirectory, { recursive: true, force: true });
    }
  }
}
