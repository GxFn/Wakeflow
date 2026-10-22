import { spawnSync } from "node:child_process";

/**
 * 测试里起 git 的共享环境（open-items D10，§13.166）：不读全局与系统配置（签名、hooksPath、
 * 模板），钉住缺省分支与夹具身份，不弹终端提示。测试运行器已经给每个测试子进程同一份环境
 * （tooling/testing/run-typescript-tests.ts）；`runGit` 在此之上再显式带一次，只跑一次、失败即抛。
 */
export const GIT_FIXTURE_ENVIRONMENT: Readonly<Record<string, string>> = Object.freeze({
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "init.defaultBranch",
  GIT_CONFIG_VALUE_0: "main",
  GIT_AUTHOR_NAME: "Wakeflow Test",
  GIT_AUTHOR_EMAIL: "test@wakeflow.invalid",
  GIT_COMMITTER_NAME: "Wakeflow Test",
  GIT_COMMITTER_EMAIL: "test@wakeflow.invalid",
  GIT_TERMINAL_PROMPT: "0",
});

function gitEnvironment(): Record<string, string | undefined> {
  return { ...process.env, ...GIT_FIXTURE_ENVIRONMENT };
}

/** 在 `cwd` 跑一次 git；非零退出即抛出带 stderr 的错误，成功返回去掉首尾空白的 stdout。 */
export function runGit(cwd: string, ...args: readonly string[]): string {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    env: gitEnvironment(),
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${String(result.status)}): ${result.stderr}`);
  }
  return result.stdout.trim();
}
