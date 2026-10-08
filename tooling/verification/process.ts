import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";

export interface ToolCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

export function npmCommand(args: readonly string[]): ToolCommand {
  const script = process.env.npm_execpath;
  if (script !== undefined) return { executable: process.execPath, args: [script, ...args] };
  return { executable: "npm", args };
}

export interface CommandSettlement {
  readonly status: "passed" | "failed" | "interrupted";
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly reason: "exit" | "spawn-failed" | "cancelled" | "timeout";
  readonly durationMs: number;
}

const OWNED_GROUPS = new Set<number>();

/**
 * 第二次 Ctrl-C：调用方要立刻退出时，先把本进程派生的进程组杀干净，不留下继续跑的
 * `npm test` 孤儿（gate-log §13.161 T7-F5）。
 */
export function terminateOwnedCommands(): void {
  for (const pid of OWNED_GROUPS) {
    try {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
          timeout: 5000,
          stdio: "ignore",
          shell: false,
          windowsHide: true,
        });
      } else {
        process.kill(-pid, "SIGKILL");
      }
    } catch {
      // The group is already gone.
    }
  }
  OWNED_GROUPS.clear();
}

/** Each command gets its own process group. Cancellation never targets unrelated processes. */
export async function runLoggedCommand(
  root: string,
  command: ToolCommand,
  logs: Readonly<{ stdout: string; stderr: string }>,
  options: Readonly<{ signal?: AbortSignal; timeoutMs: number; env: NodeJS.ProcessEnv }>,
): Promise<CommandSettlement> {
  const stdout = openSync(logs.stdout, "wx", 0o600);
  let stderr: number;
  try {
    stderr = openSync(logs.stderr, "wx", 0o600);
  } catch (error: unknown) {
    closeSync(stdout);
    throw error;
  }
  const started = performance.now();
  try {
    if (options.signal?.aborted === true)
      return {
        status: "interrupted",
        exitCode: null,
        signal: null,
        reason: "cancelled",
        durationMs: 0,
      };
    return await new Promise<CommandSettlement>((resolve) => {
      let reason: CommandSettlement["reason"] = "exit";
      let escalation: ReturnType<typeof setTimeout> | undefined;
      const child = spawn(command.executable, [...command.args], {
        cwd: root,
        env: options.env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", stdout, stderr],
      });
      if (child.pid !== undefined) OWNED_GROUPS.add(child.pid);
      const kill = (force: boolean) => {
        if (child.pid === undefined) return;
        if (process.platform === "win32") {
          spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
            timeout: 5000,
            stdio: "ignore",
            shell: false,
            windowsHide: true,
          });
        } else {
          try {
            process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
          } catch {
            child.kill(force ? "SIGKILL" : "SIGTERM");
          }
        }
      };
      const stop = (why: "cancelled" | "timeout") => {
        if (reason !== "exit") return;
        reason = why;
        kill(false);
        escalation = setTimeout(() => kill(true), 2000);
        escalation.unref();
      };
      const abort = () => stop("cancelled");
      options.signal?.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(() => stop("timeout"), options.timeoutMs);
      timeout.unref();
      child.once("error", () => {
        reason = "spawn-failed";
      });
      child.once("close", (exitCode, signal) => {
        // npm may exit before a descendant that ignored SIGTERM. Finish the owned group.
        if (reason === "cancelled" || reason === "timeout") kill(true);
        if (child.pid !== undefined) OWNED_GROUPS.delete(child.pid);
        clearTimeout(timeout);
        if (escalation !== undefined) clearTimeout(escalation);
        options.signal?.removeEventListener("abort", abort);
        resolve({
          status:
            reason === "cancelled" || reason === "timeout"
              ? "interrupted"
              : exitCode === 0 && reason === "exit"
                ? "passed"
                : "failed",
          exitCode,
          signal,
          reason,
          durationMs: Math.round(performance.now() - started),
        });
      });
      if (options.signal?.aborted === true) abort();
    });
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
}
