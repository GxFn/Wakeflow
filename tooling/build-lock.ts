import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/**
 * Wakeflow Tooling / Build lock：与 `tooling/build-lock.mjs` 同一份目录协议的进程内实现，供
 * `wf verify`、`wf handoff` 这类自己会派生 npm 命令的工具使用。
 *
 * 声明是 `mkdir .build/locks/build.lock`，目录里的 `owner.json` 写明持有者；持有者进程已退出的
 * 声明是陈旧的，直接移除；活着的持有者则等待，直到预算用完报 `build-lock-busy`。子进程继承
 * `WAKEFLOW_BUILD_LOCK_TOKEN`，带同一令牌的嵌套调用直接重入，不会和自己死锁。
 */

export const BUILD_LOCK_RELATIVE = ".build/locks/build.lock";
export const BUILD_LOCK_TOKEN_VARIABLE = "WAKEFLOW_BUILD_LOCK_TOKEN";
const TIMEOUT_VARIABLE = "WAKEFLOW_BUILD_LOCK_TIMEOUT_SECONDS";
const POLL_MILLISECONDS = 500;

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

function readOwner(lockDirectory: string): BuildLockOwner | null {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(path.join(lockDirectory, "owner.json"), "utf8"),
    );
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

function ownerAlive(owner: BuildLockOwner): boolean {
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) return false;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error: unknown) {
    return !(
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
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
      if (
        !(error !== null && typeof error === "object" && "code" in error && error.code === "EEXIST")
      )
        throw error;
      const owner = readOwner(lockDirectory);
      if (owner !== null && inherited !== undefined && owner.token === inherited)
        return body(inherited);
      if (owner !== null && !ownerAlive(owner)) {
        rmSync(lockDirectory, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) throw new BuildLockError("build-lock-busy");
      await delay(POLL_MILLISECONDS);
      continue;
    }
    writeFileSync(
      path.join(lockDirectory, "owner.json"),
      `${JSON.stringify({ pid: process.pid, token, command, startedAt: new Date().toISOString() })}\n`,
      { mode: 0o600 },
    );
    try {
      return await body(token);
    } finally {
      rmSync(lockDirectory, { recursive: true, force: true });
    }
  }
}
