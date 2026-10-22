import { describe } from "node:test";
import { GIT_FIXTURE_ENVIRONMENT } from "../../support/git-fixture.js";
import { registerWorkflowMatrix } from "./workflow-matrix.fixture.js";

/**
 * 制品冒烟里的 lab 业务矩阵（§13.206 D2）：`dual-product` 与 `worktree` 各两个宿主，共四个实验，每个在仓库外
 * 启动已构建制品的 `mcp/server.mjs`、跑完业务链并封存清理。不是 `.test.ts`，所以不在 `npm test` 里；
 * `npm run smoke:artifacts` 以 `node --test` 运行本文件，CI 的 artifact 作业照跑。两个实验同时跑：
 * 它们互相只争 fsync，不共享任何目录。lab 在本进程里起 git，所以先把运行器给测试子进程的隔离 git 环境
 * 放进本进程（open-items D10）。
 */
for (const [key, value] of Object.entries(GIT_FIXTURE_ENVIRONMENT)) process.env[key] = value;

describe("lab business matrix against the built artifacts", { concurrency: 2 }, () => {
  registerWorkflowMatrix("codex", ["dual-product", "worktree"]);
  registerWorkflowMatrix("claude-code", ["dual-product", "worktree"]);
});
