---
diagramId: "ts-real-environment-testing-file-dependencies"
viewType: "file-dependency"
truthKind: "in-progress-worktree"
reviewDepth: "L4"
verifiedAt: "2026-10-03"
baselineCommit: "d8fafff33919c728e3a9b91ec04aa50ec5e07f0c"
sourceFingerprint: "sha256:6781b5808f01385a29c1bdea167a4d9b3aff4e52c617f60eb646fb214374fd46"
testEvidence: "anchored"
audience: ["maintainer", "reviewer"]
documentationOwner: "Wakeflow Architecture Atlas"
generatedBy: "manual-review"
sourcePaths: ["src/capabilities/delivery/service.ts", "src/capabilities/result-review/decide.ts", "src/capabilities/result-review/service.ts", "src/capabilities/tasking/service.ts", "src/governance/tasking/task-package.ts", "src/governance/testing/test-execution-attempt.ts"]
schemaPaths: []
testPaths: []
refreshTriggers: []
---

# 测试：规划、尝试与评审的文件责任

> 2026-10-03 当前工作树语义复核；含未提交实现。HEAD 只定位已提交基线，来源指纹覆盖本页实际引用的文件。图谱不拥有业务状态。本页仅声明静态导入，由 AST 核验；不把导入存在作为运行分支已覆盖的证明。

```mermaid
flowchart TB
  accTitle: 测试合同的精选直接导入
  accDescr: 图中连线仅表示当前 TypeScript 直接导入，不表示调用顺序或持久状态；完整路径与符号在表中定位。
  T["[源码] 任务规划服务"]
  D["[源码] 投递服务"]
  A["[源码] 测试 attempt 合同"]
  R["[源码] 结果评审服务"]
  Q["[源码] 评审纯决定"]
  P["[源码] 测试 TaskPackage"]
  T -->|"E-TST03-01 导入"| P
  D -->|"E-TST03-02 导入"| A
  A -->|"E-TST03-03 导入"| P
  R -->|"E-TST03-04 导入"| Q
  Q -->|"E-TST03-05 导入"| P
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| [代码] | 确定性服务、守卫或纯决定；失败会拒绝转换。 |
| [权威] | 持久事实；只能由指定写入者改变。 |
| [视图] | 由权威派生的可重建数据，不授权写入。 |

### 本图边级证据

| 编号 | 代码证据 | 测试证据 | 关系与边界 |
| --- | --- | --- | --- |
| E-TST03-01 | `src/capabilities/tasking/service.ts` | 未覆盖：此边仅声明静态 import，由 AST 核验；运行分支覆盖见相邻调用页。 | 导入 |
| E-TST03-02 | `src/capabilities/delivery/service.ts` | 未覆盖：此边仅声明静态 import，由 AST 核验；运行分支覆盖见相邻调用页。 | 导入 |
| E-TST03-03 | `src/governance/testing/test-execution-attempt.ts` | 未覆盖：此边仅声明静态 import，由 AST 核验；运行分支覆盖见相邻调用页。 | 导入 |
| E-TST03-04 | `src/capabilities/result-review/service.ts` | 未覆盖：此边仅声明静态 import，由 AST 核验；运行分支覆盖见相邻调用页。 | 导入 |
| E-TST03-05 | `src/capabilities/result-review/decide.ts` | 未覆盖：此边仅声明静态 import，由 AST 核验；运行分支覆盖见相邻调用页。 | 导入 |

| 节点 | 完整路径 | 主要符号 |
| --- | --- | --- |
| T | `src/capabilities/tasking/service.ts` | `executeTargetTaskPlanningPublicRequest` |
| D | `src/capabilities/delivery/service.ts` | `testAttemptFor` |
| A | `src/governance/testing/test-execution-attempt.ts` | `createRerunTestExecutionAttempt` |
| R | `src/capabilities/result-review/service.ts` | `executeTestReviewDecisionRequest` |
| Q | `src/capabilities/result-review/decide.ts` | `deriveTestDecisionBlockers` |
| P | `src/governance/tasking/task-package.ts` | `TestTaskPackage` |

折叠：test-result 报告与结果编解码、测试决定与修复授权、事件归约器。测试没有独立“自动执行器”文件：Agent 依技能执行环境动作，Wakeflow 负责冻结合同与验证回报。

## 继续阅读

[本专题总览](./README.md) · [文件导入](./file-dependencies.md) · [实际调用](./runtime-call-flow.md) · [逐文件审阅记录](../../plans/review-2026-10-03/demand-delivery.md) · [图谱入口](../README.md)
