import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { CallToolResult } from "@modelcontextprotocol/client";

/**
 * Wakeflow 场景验收骨架（plan §8.1 P0）。
 *
 * 场景清单来自 `docs/requirements/capabilities/` 各能力卡的场景块，判定对象是新体系
 * 在一次性工作区上的端到端行为，不与旧实现比较磁盘状态、文件路径或错误堆栈。每个场景
 * 的结论必须落在 plan §9 规定的四类之一：通过、有意放弃、待用户决定、新实现缺陷；尚未
 * 接线的场景记为 `not-run`，不能被算作通过。
 */

export type ScenarioVerdict =
  | "pass"
  | "intentionally-dropped"
  | "pending-user-decision"
  | "defect"
  | "not-run";

export interface ScenarioDefinition {
  /** `card-<能力组>/<场景 slug>`，与 docs/references/scenario-acceptance.md 一一对应。 */
  readonly scenarioId: string;
  readonly card: string;
  readonly title: string;
}

export interface ScenarioOutcome extends ScenarioDefinition {
  readonly verdict: ScenarioVerdict;
  readonly evidence: string;
}

/** 当前已接线的场景。新增场景先登记到文档清单，再在这里接线。 */
export const SCENARIO_CATALOG: readonly ScenarioDefinition[] = Object.freeze([
  {
    scenarioId: "card-01/fresh-initialize",
    card: "01-workspace-and-configuration",
    title: "一次性工作区上 preview 零写、apply 生成配置与固定协议根",
  },
  {
    scenarioId: "card-02/window-handshake",
    card: "02-window-endpoints",
    title: "inspect 给出启动意图与执行参数，Agent 回执经 hook 证据登记为私有绑定，重放幂等",
  },
  {
    scenarioId: "card-02/window-replace",
    card: "02-window-endpoints",
    title: "新握手以 CAS 替换旧绑定，旧代际退出投影，脱敏结果不含句柄与路径",
  },
  {
    scenarioId: "card-03/requirement-package",
    card: "03-requirement-entry-and-todo",
    title: "需求包 preview 摘要与章节校验，用户确认后一次调用发布即上板",
  },
  {
    scenarioId: "card-04/create-demand",
    card: "04-demand-lifecycle",
    title: "认领需求包即创建 Demand，看板置 claimed，Route 指向实现任务规划",
  },
  {
    scenarioId: "card-05/plan-implementation-task",
    card: "05-task-planning",
    title: "实现任务包 preview 零写、apply 提交且重放幂等，Route 前进到投递规划",
  },
  {
    scenarioId: "card-06/delivery-chain",
    card: "06-delivery-and-callback",
    title:
      "一次调用取得声明、追加信封并返回可移植许可，重放幂等；无落地证据的结局是 indeterminate 且保留声明",
  },
  {
    scenarioId: "card-06/ambiguous-resolution",
    card: "06-delivery-and-callback",
    title:
      "目标会话的 user-prompt-submit 记录到达后，再次记录结局即 accepted，Route 前进到结果导入",
  },
  {
    scenarioId: "card-05/test-contract",
    card: "05-task-planning",
    title:
      "实现接受后 Controller 撰写测试合同追加 test 任务包（发明的步骤引用与第二个未终结测试目标被拒），测试投递、逐步证据导入与测试审查接受后 Route 到完成预检",
  },
  {
    scenarioId: "card-08/complete-and-archive",
    card: "08-evidence-and-archive",
    title:
      "经公共工具投递、认领、回执、结果、评审后完成即归档：verify 门内嵌、一个事务、活动根删除、recover 幂等",
  },
  {
    scenarioId: "card-04/complete-and-continue",
    card: "04-demand-lifecycle",
    title: "continue 从归档重开并要求先规划，cancel 撤回需求包并再次归档，取消后不能 continue",
  },
]);

export interface ScenarioWorkspace {
  readonly fixtureRoot: string;
  readonly workspacePath: string;
  readonly productPath: string;
}

function gitInit(directory: string): void {
  const result = spawnSync("git", ["init", "--quiet"], {
    cwd: directory,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error("Scenario fixture cannot initialize Git.");
  }
}

/** 建立一次性工作区：工作区根与一个兄弟产品仓库，两者都是真实 Git 仓库。 */
export function createScenarioWorkspace(): ScenarioWorkspace {
  const fixtureRoot = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "wakeflow-scenario-acceptance-")),
  );
  const workspacePath = path.join(fixtureRoot, "Workspace");
  const productPath = path.join(fixtureRoot, "ProductA");
  mkdirSync(workspacePath, { mode: 0o755 });
  mkdirSync(productPath, { mode: 0o755 });
  gitInit(workspacePath);
  gitInit(productPath);
  return Object.freeze({ fixtureRoot, workspacePath, productPath });
}

export function cleanupScenarioWorkspace(workspace: ScenarioWorkspace): void {
  rmSync(workspace.fixtureRoot, { recursive: true, force: true });
}

/** 读取公共工具的唯一文本块，供失败时给出可读证据。 */
export function scenarioToolText(result: CallToolResult): string {
  const first = result.content[0];
  return first?.type === "text" ? first.text : "<no text content>";
}

/** 渲染场景报告；只含场景编号、结论与证据摘要，从不包含临时路径。 */
export function renderScenarioReport(outcomes: readonly ScenarioOutcome[]): string {
  const lines = [
    "| 场景 | 能力卡 | 结论 | 证据 |",
    "| --- | --- | --- | --- |",
    ...outcomes.map(
      (outcome) =>
        `| ${outcome.scenarioId} | ${outcome.card} | ${outcome.verdict} | ${outcome.evidence} |`,
    ),
  ];
  const counts = new Map<ScenarioVerdict, number>();
  for (const outcome of outcomes) {
    counts.set(outcome.verdict, (counts.get(outcome.verdict) ?? 0) + 1);
  }
  const summary = [...counts.entries()].map(([verdict, count]) => `${verdict}=${count}`).join(", ");
  return `${lines.join("\n")}\n\nsummary: ${summary}\n`;
}
