import type { KnipConfig } from "knip";

/**
 * 两道未用代码检查共用这一份入口与项目。`check:unused`（默认模式）把测试也算作使用方；
 * `check:unused:production`（`--production`）只认带 `!` 的生产入口与项目，列出只有测试在用的导出。
 * 生产模式下文件内的使用也不算，否则只为测试而导出、本文件里也用到的名字会混进来；默认模式照旧
 * 只豁免文件内使用的类型与接口。
 */
export default ({ production }: { readonly production?: boolean }): KnipConfig => ({
  ignoreExportsUsedInFile: production === true ? true : { interface: true, type: true },
  workspaces: {
    ".": {
      entry: [
        "src/entrypoints/codex-wakeflow-mcp.ts!",
        "src/entrypoints/claude-code-wakeflow-mcp.ts!",
        "src/entrypoints/wakeflow-hook-observer.ts!",
        "src/hosts/codex/codex-hook-fragment.ts!",
        "src/hosts/codex/codex-process-launch-profile.ts!",
        "src/hosts/claude-code/claude-code-hook-fragment.ts!",
        "src/hosts/claude-code/claude-code-mcp-configuration.ts!",
        "src/hosts/codex/codex-agent-text-profile.ts!",
        "src/hosts/claude-code/claude-code-agent-text-profile.ts!",
        "src/hosts/claude-code/assets/desktop.mjs!",
        "src/hosts/claude-code/assets/statusline.mjs!",
        "src/hosts/claude-code/assets/tmux.mjs!",
        "tooling/architecture/check-dependencies.ts!",
        "tooling/codegen/schema-types.ts!",
        "tooling/codegen/helper-assets.ts!",
        "tooling/codegen/refusal-reference.ts!",
        "tooling/testing/run-typescript-tests.ts!",
        "tooling/cli.ts!",
        "tooling/artifacts/build-plugin-artifacts.ts!",
        "tooling/artifacts/check-plugin-artifacts.ts!",
        "tooling/artifacts/inspect-local-installation.ts!",
        "tooling/artifacts/smoke-plugin-artifacts.ts!",
        "tooling/release/check-release-consistency.ts!",
        "tests/**/*.test.ts",
        "tests/**/*.manual.ts",
        "tests/scenarios/*.ts",
      ],
      project: ["src/**/*.ts!", "src/**/*.mjs!", "tooling/**/*.ts!", "tests/**/*.ts"],
      ignore: ["src/contracts/generated/**"],
      ignoreDependencies: ["@swc/core"],
      ignoreBinaries: ["mkfifo"],
    },
  },
  // 生产模式里有意留下、只有测试在调用的导出，一个文件一条理由（knip 只在根上读 ignoreIssues）。
  ignoreIssues:
    production === true
      ? {
          // observeGitAncestry：已审过、有测试的祖先查询，等 open-items K10 ② 接上。
          "src/foundation/git/git-commit-observation.ts": ["exports"],
          // readHostHookObservationsInterleaved：修剪与观察并发的测试缝（§13.97 D7c），要用本模块私有的读取路径。
          "src/kernel/hook-observations.ts": ["exports"],
        }
      : {},
});
