# Wakeflow Symbol Unification Plan

状态：completed / breaking rename 已执行

## 用户真实目标

Wakeflow 是插件化的无人值守多窗口工作流能力，不应继续暴露旧仓库的文件名、skill 名或配置字段。用户希望统一 skill、JS、docs、配置、AGENTS 和模板中的符号，让每个入口都能从 Wakeflow 插件职责本身解释。

一句话完成定义：

> Wakeflow 仓库内的公开脚本、skill、schema/template 目录、MCP 工具说明、README、AGENTS、配置字段和测试入口统一使用 Wakeflow 语义；`controller`、`target`、`delivery`、`state root`、`dispatch group` 只作为协议角色保留。

## 已确认裁决

- 直接做 breaking rename，不保留旧公开脚本或 skill shim。
- 旧仓库代码另有备份，不需要为旧路径做兼容入口。
- 配置字段也进入统一范围：公开字段使用 `controllerWindow` / `wakeflowRepoDir`。

## 保留术语

- `controller`：协议角色，表示总控判断者。
- `target`：协议角色，表示执行窗口。
- `delivery envelope`：投递信封协议。
- `target result envelope`：执行窗口回填协议。
- `dispatch group`：多目标并行隔离键。
- `state root`：需求机器状态根。

这些术语不是旧产品名，可以保留在协议、schema、脚本参数和 AGENTS 规则中。

## 实施映射

### Scripts

| 旧入口 | 新入口 |
| --- | --- |
| `control-workspace-install.mjs` | `wakeflow-setup.mjs` |
| `workspace-control.mjs` | `wakeflow-cli.mjs` |
| `wakeflow-control.mjs` | `wakeflow-runtime.mjs` |
| `controller-state.mjs` | `wakeflow-state.mjs` |
| `control-intake.mjs` | `wakeflow-intake.mjs` |
| `codex-automation-loop.mjs` | `wakeflow-delivery.mjs` |
| `verify-control-center.mjs` | `wakeflow-verify.mjs` |
| `check-script-docs.mjs` | `wakeflow-check-scripts.mjs` |
| `check-workspace-boundary.mjs` | `wakeflow-check-boundary.mjs` |
| `check-workspace-current-layout.mjs` | `wakeflow-check-layout.mjs` |
| `check-runtime-residue.mjs` | `wakeflow-check-runtime.mjs` |
| `check-repository-residue.mjs` | `wakeflow-check-repository-residue.mjs` |
| `collect-repo-status.mjs` | `wakeflow-repo-status.mjs` |
| `archive-workspace-docs.mjs` | `wakeflow-archive-docs.mjs` |
| `archive-global-todo-board.mjs` | `wakeflow-archive-todo.mjs` |
| `generate-archive-topic-summaries.mjs` | `wakeflow-archive-summaries.mjs` |
| `compact-workspace-index.mjs` | `wakeflow-compact-index.mjs` |
| `next-control-work.mjs` | `wakeflow-next-work.mjs` |
| `render-progress-doc.mjs` | `wakeflow-render-progress.mjs` |
| `append-progress-log.mjs` | `wakeflow-progress-log.mjs` |
| `demand-sequence.mjs` | `wakeflow-demand-sequence.mjs` |
| `import-design-handoffs.mjs` | `wakeflow-import-design-handoffs.mjs` |
| `smoke.mjs` | `wakeflow-smoke.mjs` |
| `validate-repo.mjs` | `wakeflow-validate.mjs` |

### Skills

| 旧入口 | 新入口 |
| --- | --- |
| `control-workspace-governance` | `wakeflow-governance` |
| `codex-automation-controller` | `wakeflow-controller` |
| `codex-automation-target` | `wakeflow-target` |
| `progressive-chain-validation` | `wakeflow-progressive-validation` |

### Runtime Assets

| 旧入口 | 新入口 |
| --- | --- |
| `lib/control-runtime.mjs` | `lib/wakeflow-runtime.mjs` |
| `scripts/lib/workspace-config.mjs` | `scripts/lib/wakeflow-config.mjs` |
| `scripts/lib/status-machine.mjs` | `scripts/lib/wakeflow-status-machine.mjs` |
| `schemas/control-state-machine/` | `schemas/wakeflow-state-machine/` |
| `templates/control-state-machine/` | `templates/wakeflow-state-machine/` |
| `scripts/fixtures/control-state-machine/` | `scripts/fixtures/wakeflow-state-machine/` |

### Config

| 旧字段 | 新字段 |
| --- | --- |
| `controlWindow` | `controllerWindow` |
| `controlRepoDir` | `wakeflowRepoDir` |

## 验收清单

- `node scripts/wakeflow-check-scripts.mjs --json`
- `node scripts/wakeflow-validate.mjs`
- `node scripts/wakeflow-smoke.mjs`
- `npm test`
- `git diff --check`
- 旧公开符号残留扫描

## 验收结果

- 文件和目录已按映射重命名。
- 引用已按 Wakeflow 语义重写。
- 配置字段已切换为 `controllerWindow` / `wakeflowRepoDir`。
- JS 输出字段已从 `controlRoot` 切换为 `wakeflowRoot`。
- `package.json` 测试入口已切换为 `test:wakeflow`。
- `node scripts/wakeflow-check-scripts.mjs --json` 通过。
- `node scripts/wakeflow-validate.mjs` 通过。
- `node scripts/wakeflow-smoke.mjs` 通过。
- `npm test` 通过：93 个测试全部通过。
- `git diff --check` 通过。
- 旧公开符号扫描通过；仅保留合法的新职责名 `wakeflow-controller`，以及用于防回归的 `controlPlan` 不得出现断言。
