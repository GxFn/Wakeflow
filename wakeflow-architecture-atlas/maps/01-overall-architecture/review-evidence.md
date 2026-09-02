---
diagramId: ts-overall-change-impact-d0
viewType: evidence
truthKind: in-progress-worktree
reviewDepth: L5
verifiedAt: 2026-09-02
snapshotObservedAt: 2026-09-02T00:01:58-07:00
baselineCommit: f7c005d73c11e29f284dbde1d7117193376c0ef6
sourceFingerprint: sha256:f35712210c24cc57638e7de42e8030fcccae7615ae9d25c5ae9a3630aa6b0669
audience:
  - maintainer
  - reviewer
documentationOwner: Wakeflow Source Maintenance
generatedBy: mixed
refreshTriggers:
  - src/**
  - tests/**
  - docs/wakeflow-typescript-file-review-ledger-2026-08-28.md
sourcePaths:
  - src/**
schemaPaths:
  - src/contracts/schemas/**
testPaths:
  - tests/**
---

# 总体架构：提交影响与审阅证据

> 本文绑定Demand Publication实现提交`f7c005d`及当前Managed Evidence Capture/Event/Resource/Record Plan工作树。目标任务或
> 脚本自述只是审阅输入；本文依据实际源码、Schema、测试和差异。

## D0：Demand Publication提交影响

```mermaid
flowchart LR
  accTitle: Wakeflow TypeScript治理骨干与Managed Evidence Capture Event工作树影响
  accDescr: 提交f7c005d已闭合第十八个Demand Publication工具；当前工作树新增真实evidence ID、Manifest、author-owned本地source selection、零写file/tree capture Planning、Event与Aggregate selector，但尚无资源Application或公共工具。Research、Redesign与Archive继续保持停止边界。

  subgraph BASELINE["① 已提交基线"]
    direction TB
    HEAD["[已提交] f7c005d\nDemand Publication Public"]
    SOURCE["[当前源码]\n375手写模块 + 103生成合同"]
  end

  subgraph PUBLIC["② 公共与宿主接缝"]
    direction TB
    MCP["[公共] 18个MCP工具\n双宿主固定同名集合"]
    PUBLICATION["[已实现][已验证] wakeflow_create_demand\npreview / apply / recover"]
    HOST["[执行平面] Agent执行宿主效果\nWakeflow只记录Intent/Claim/Observation"]
  end

  subgraph EVIDENCE["③ 机器验证"]
    direction TB
    ARCH["[通过] Architecture\n740模块 / 5182依赖 / 0违规"]
    SCHEMA["[通过] Schema\n103份 / 212 external refs"]
    TESTS["[局部通过] Evidence 23 + Retirement 7 + Candidate 2\n0 fail / 0 skip"]
    CANDIDATE["[候选] Codex 439 / Claude 444\nreleaseEligible=false"]
  end

  subgraph GAPS["④ 进行中与明确停止边界"]
    direction TB
    MANAGED_EVIDENCE["[进行中] Managed Evidence Capture + Event + Record Plan\n无Inventory / Application / MCP"]
    RESEARCH["[未实现] Research Completion"]
    REDESIGN["[未实现] Implementation Redesign"]
    ARCHIVE["[未实现] Evidence资源Application / Archive"]
  end

  HEAD -->|"E-D0-01 包含"| SOURCE
  SOURCE -->|"E-D0-02 组合"| MCP
  MCP -->|"E-D0-03 签发一次性Action"| HOST
  SOURCE -->|"E-D0-04 静态检查"| ARCH
  SOURCE -->|"E-D0-05 合同检查"| SCHEMA
  SOURCE -->|"E-D0-06 行为验证"| TESTS
  SOURCE -->|"E-D0-07 构建候选"| CANDIDATE
  SOURCE -->|"E-D0-12 首个业务模型"| MANAGED_EVIDENCE
  MCP -->|"E-D0-08 公开Demand创建"| PUBLICATION
  MCP -.->|"E-D0-09 显式blocker"| RESEARCH
  MCP -.->|"E-D0-10 显式blocker"| REDESIGN
  CANDIDATE -.->|"E-D0-11 生命周期后续缺口"| ARCHIVE
```

### 本图术语说明

| 图中术语 | 解释 |
| --- | --- |
| 已提交基线 | Git提交`f7c005d`中的Demand Publication源码、Schema、测试与Review记录 |
| 固定组合 | Codex与Claude Code各自绑定host facade，但共享同一18工具及宿主中立owner |
| Agent宿主效果 | Agent调用宿主API；Wakeflow不直接操作Codex/Claude窗口，只签发并记录有界事实 |
| 候选制品 | 可重建的TypeScript闭包；manifest明确`releaseEligible=false` |
| 停止边界 | 代码明确不支持的相邻能力，不允许从当前闭环推断为存在 |
| Managed Evidence Capture/Event/Record Plan | 从Config根稳定读取file/tree并零写生成Manifest/CAS计划；Event保存完整Manifest；record plan关闭Manifest文件字节与payload整树路径/mode/digest但不执行写入 |

## 当前规模

| 区域 | 当前值 |
| --- | ---: |
| 手写生产TypeScript | 375 |
| 生成TypeScript合同 | 103 |
| JSON Schema | 103 |
| 正式测试文件 | 232 |
| 公共MCP工具 | 18 |
| Architecture | 740模块 / 5182依赖 / 0违规 |
| 当前聚焦门 | Evidence 23 + Retirement 7 + Candidate 2；0 fail / 0 skip |
| 最近TypeScript完整门 | 948 pass / 0 fail / 0 cancelled / 0 skip；覆盖当前全部增量 |

## 边级证据

| 边编号 | 代码/差异证据 | 测试/审阅证据 |
| --- | --- | --- |
| `E-D0-01`–`E-D0-03` | `src/{foundation,workspace,governance,entrypoints}/`与双宿主composition roots | 公共MCP 18工具、双宿主一致性和真实纵切测试 |
| `E-D0-04` | 架构检查器读取当前源码图 | 740模块、5182依赖、0违规 |
| `E-D0-05` | 103份Schema与生成合同 | `schema:check`：212 external refs、生成输出一致 |
| `E-D0-06` | 232个测试文件 | `check:typescript`完整运行948项；0 fail / 0 cancelled / 0 skip |
| `E-D0-07` | 双宿主候选闭包与manifest | Codex 439、Claude Code 444个编译文件；仍不可发布 |
| `E-D0-08` | Demand Publication Public | authored input、Planning/Application、Schema、Coordinator与MCP | pending TODO→Demand→首个Route真实MCP测试 |
| `E-D0-09`–`E-D0-11` | Controller Route blocker与无Archive owner | 技术骨干核实文档与22项Route矩阵 |
| `E-D0-12` | Managed Evidence Capture/Event/Record Plan | Manifest/ID、source selection、稳定读取、Event/selector、Commit重放、资源目录、容量预留及完整record tree plan | Evidence聚焦测试 |

## 当前风险与结论

- 18工具已覆盖“pending TODO → Demand → Completion”；每一步仍由Agent按Route显式调用，不是公共Server自动编排。
- Agent Host Action不是持久权威，真实宿主效果仍必须由Agent最多执行一次并回传观察。
- Research Completion与Implementation Redesign仍为显式blocker，不允许绕过。
- Loaded Artifact transfer保持冻结，等待Evidence资源Application或Archive首个真实consumer复审。
- 当前Planning已消费Loaded Artifact identity与Stable File Read，Event已进入Demand事件族，但尚未消费transfer candidate/publication。
- 当前Evidence Capture/Event/Resource/Record Plan增量只通过聚焦门，尚未重跑完整TypeScript源清单；旧JS等价、双宿主plugin smoke与release gate也未运行。
