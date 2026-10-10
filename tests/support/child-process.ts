import { existsSync, readFileSync } from "node:fs";

/**
 * 子进程 pid 文件（§13.166）：子进程用 `writeFileSync` 写自己的 pid，读者可能在文件已创建、内容还没
 * 写进去的瞬间看到空文件——`Number("")` 是 0，而 `process.kill(0, "SIGKILL")` 杀的是调用方所在的整个
 * 进程组（run-oen3rp 的完整门就是这样被 lab 测试的清理钩子整组杀掉的）。这里等到文件里出现一个正整数
 * 才返回，杀子进程时也绝不把 0、负数或 1 当成 pid。
 */
export async function waitForChildPid(file: string, timeoutMs = 5000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (existsSync(file)) {
      const text = readFileSync(file, "utf8").trim();
      if (/^[1-9][0-9]*$/u.test(text)) return Number(text);
    }
    if (Date.now() >= deadline) throw new Error(`child pid file was not written in time: ${file}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** 只向一个真实的子进程 pid 发信号；已回收的子进程静默，非法 pid 从不发送。 */
export function killChildProcess(pid: number, signal: NodeJS.Signals = "SIGKILL"): void {
  if (!Number.isSafeInteger(pid) || pid <= 1) return;
  try {
    process.kill(pid, signal);
  } catch {
    // 已经回收。
  }
}
