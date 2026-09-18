# Wakeflow 开发文档系统

> 状态：`active`
> 建立日期：2026-09-03
> 决策记录：[ADR-0001 开发文档系统与权威顺序](./decisions/0001-documentation-system.md)

本目录是 Wakeflow 源码仓库的开发文档系统。它回答三个问题：当前的约束和阶段是什么、已经做过哪些决定、进度和证据在哪里。它不拥有运行时行为；运行时行为属于代码、Schema、测试和插件内置的指令与技能。

## 1. 权威顺序

同一问题在多处出现时，按下列顺序取权威。低位文档与高位冲突时以高位为准，并把低位改正。

| 顺序 | 权威 | 位置 | 说明 |
| --- | --- | --- | --- |
| 1 | 代码、Schema、测试 | `src/`、`tooling/`、`tests/`，旧基线 `core/`、`test/` | 运行时行为的唯一事实 |
| 2 | 仓库维护规则 | 根目录 `CLAUDE.md`、`AGENTS.md` | 范围、安全、源码归属、验证、发布纪律 |
| 3 | 开发计划 | [plan/](./plan/) | 阶段边界、已确认约束、完成定义 |
| 4 | 决策记录 | [decisions/](./decisions/) | 每个影响架构或范围的决定及其理由 |
| 5 | 需求锚点与标准 | [requirements/](./requirements/)、[standards/](./standards/) | 原始需求与跨模块统一标准 |
| 6 | 进度日志 | [progress/](./progress/) | 节点核实、审阅台账；记录事实，不做决策 |
| 7 | 评估与建议 | [reviews/](./reviews/) | 阶段评估、问题清单、计划建议；未经确认不具权威 |
| 8 | 参考与证据 | [references/](./references/) | 旧系统审计、外部对照 |
| 9 | 历史归档 | [archive/](./archive/) | 已完成或已被取代的文档，只作证据 |

## 2. 目录职责

```text
docs/
├── README.md              本文：系统总览、权威顺序、目录职责、状态词汇
├── plan/                  开发计划。同一时期只有一份现行计划
├── decisions/             架构决策记录（ADR）。编号递增，状态可追踪
├── requirements/          需求锚点。现行需求文档与归档锚点的索引
├── standards/             跨模块标准：资源处理、文档编写
├── progress/              进度日志：节点核实门、逐文件审阅台账
├── reviews/               评估与建议。按日期前缀命名
├── references/            参考与证据：旧 JS 场景审计等
└── archive/               历史归档。保留原文件名，不改内容，由索引登记
```

## 3. 现行文档

| 文档 | 职责 | 状态 |
| --- | --- | --- |
| [plan/typescript-reimplementation-plan.md](./plan/typescript-reimplementation-plan.md) | TypeScript 能力重构的阶段、约束 TSD-01 到 TSD-16、执行顺序 P0 与 L0 到 L3、完成定义 | E0 完成，E1/E2 进行中；P0 完成，ADR-0013 定了目标架构与切片顺序，进入 L0 基础做实 |
| [decisions/README.md](./decisions/README.md) | 决策索引 | ADR-0001 到 ADR-0013 已接受；ADR-0003 于 09-03 修订；ADR-0009 两处调整、ADR-0010 的 pod 模型、ADR-0011 需求包均于 09-04 确认 |
| [requirements/capabilities/](./requirements/capabilities/) | 能力卡，按能力组逐项确认的场景、不变量、宿主差异与实现判断 | 第 1 到 10 组全部已确认（2026-09-04） |
| [requirements/wakeflow-functions-and-scenarios.md](./requirements/wakeflow-functions-and-scenarios.md) | 自顶向下的功能与场景总览：定位、核心对象、主流程直线、F1 到 F11 功能清单、宿主差异、明确不做 | draft，待用户确认理解一致 |
| [requirements/typescript-dual-artifact-build.md](./requirements/typescript-dual-artifact-build.md) | 单一源码、双宿主制品、轻量测试需求 | 已确认 |
| [requirements/README.md](./requirements/README.md) | 需求锚点索引，含归档中仍被引用的 D1 到 D41 与 Pod 需求 | active |
| [standards/resource-handling-standard.md](./standards/resource-handling-standard.md) | 资源处理归一标准与收敛矩阵 | 已确认，RH-1 到 RH-3 已实现 |
| [standards/documentation-standard.md](./standards/documentation-standard.md) | 文档编写标准 | active |
| [progress/consolidation-gate-log.md](./progress/consolidation-gate-log.md) | 业务骨干核实门日志，第 13 节为当前结论 | active，最新节点 §13.64 |
| [progress/file-review-ledger.md](./progress/file-review-ledger.md) | 逐文件审阅台账 | active |
| [reviews/2026-09-03-typescript-checkpoint-review.md](./reviews/2026-09-03-typescript-checkpoint-review.md) | 关键节点架构与实现评估、缺口分析、建设计划建议 | 评估建议，待讨论 |
| [reviews/2026-09-04-flow-optimization-analysis.md](./reviews/2026-09-04-flow-optimization-analysis.md) | 回传、调用形状、完成留痕、测试记录对比、重设计边界的旧代码事实、业界对照与设计建议 | 评估建议，已由 ADR-0012 接受 |
| [reviews/2026-09-04-architecture-and-slice-design.md](./reviews/2026-09-04-architecture-and-slice-design.md) | 目标架构六层与端口、切片解剖、L0 基础能力收敛与新建、L1 十个切片、测试策略 | 评估建议，已由 ADR-0013 接受 |
| [reviews/2026-09-11-l1-source-walkthrough-findings.md](./reviews/2026-09-11-l1-source-walkthrough-findings.md) | L1 九个切片落地后的逐文件走读：四类同族问题、正确性缺口、纪律一致性、测试缺口、文档漂移与排序建议 | §8.1 档已落地（gate-log 13.93），§8.2 / §8.3 待裁决 |
| [references/legacy-js-scenario-closure-audit.md](./references/legacy-js-scenario-closure-audit.md) | 旧 JavaScript 产品全场景闭包审查 | 只读审计，E3 对比证据 |
| [references/capability-map.md](./references/capability-map.md) | 能力映射矩阵：31 项旧工具、内部能力、宿主差异、D1 到 D41 与 I3 逐行判定 | active，重切 16、缺席 11、放弃 4 |
| [references/scenario-acceptance.md](./references/scenario-acceptance.md) | 场景验收清单与骨架运行入口 `npm run scenario:acceptance` | active，3 个场景 pass |
| [archive/README.md](./archive/README.md) | 归档索引 | 16 份历史文档 |

## 4. 状态词汇

| 状态 | 含义 | 适用 |
| --- | --- | --- |
| `draft` | 起草中，内容可能大幅变化 | 任何文档 |
| `proposed` | 已成文的建议，等待用户裁决 | decisions、reviews |
| `accepted` | 用户已确认，进入执行 | decisions |
| `rejected` | 用户否决，保留理由 | decisions |
| `active` | 现行有效，持续维护 | plan、standards、progress |
| `superseded` | 已被另一文档取代，正文顶部指向替代者 | 任何文档，随后归档 |
| `archived` | 已归档，只作历史证据 | archive |

## 5. 生命周期规则

1. **新增**：先确定目录职责，再命名。目录表达类型，文件名表达主题，用小写 kebab-case；日期写在文档头部的状态区，`reviews/` 例外，以 `YYYY-MM-DD-` 前缀命名。
2. **决策**：任何改变阶段边界、已确认约束、公共合同形状、层边界或旧能力取舍的决定，先写 ADR 为 `proposed`，用户确认后改为 `accepted`，并回写到开发计划的约束表或阶段表。进度日志只记录"已按 ADR-xxxx 执行"，不在日志里做决策。
3. **进度**：每个核实节点在 `progress/` 追加一节，写明基线提交、运行过的门和未运行的项目。数字必须标注度量方式。
4. **取代**：文档被取代时，在正文顶部加一行指向替代者，状态改为 `superseded`，并在下一次整理时移入 `archive/`。
5. **归档**：移入 `archive/` 的文档保留原文件名，不修改正文，只在 [archive/README.md](./archive/README.md) 登记日期、类型、被谁取代、是否仍被引用。归档文档之间的相对链接保持有效；指向现行文档的链接在归档时更新。
6. **禁止**：不在文档里声称未实现的能力；不把 `progress/` 或 `reviews/` 当作命令来源；不把机器专有路径、令牌、私有会话标识写入文档。

## 6. 与其他文档位置的关系

- 根目录 `README.md` 与 `README.zh-CN.md` 面向使用者，只链接本系统中的现行文档或归档索引。
- `wakeflow-architecture-atlas/` 是独立的只读图谱子项目，以 `maps/` 为正典，刷新触发器引用本系统的 `progress/` 文档。
- 插件内的 `README`、`CLAUDE.md`、`AGENTS.md`、skills、commands 是产品输入和测试面，不属于本系统。
