---
diagramId: ts-real-testing-x0
viewType: vertical-slice
truthKind: current-code
reviewDepth: L2
verifiedAt: 2026-09-01
snapshotObservedAt: 2026-09-01T06:42:28-07:00
baselineCommit: d17602ed9931a1898f713c740752c54b94bd8086
sourceFingerprint: sha256:7f70498f7256fe4cba57c95d0b89ad1c49297afa71d34cf3a0ed1dedef2f4604
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Source Maintenance
generatedBy: mixed
sourcePaths: [src/governance/testing/**, src/governance/tasking/**, src/governance/delivery/**, src/governance/result/**, src/governance/review/**, src/governance/lifecycle/**, src/entrypoints/**]
schemaPaths: [src/contracts/schemas/governance/testing/**, src/contracts/schemas/governance/tasking/**, src/contracts/schemas/governance/result/**, src/contracts/schemas/governance/review/**, src/contracts/schemas/governance/lifecycle/**, src/contracts/schemas/entrypoints/wakeflow-target-task-planning-request.schema.json]
testPaths: [tests/governance/testing/**, tests/governance/tasking/**, tests/governance/delivery/**, tests/governance/result/**, tests/governance/review/**, tests/governance/lifecycle/**, tests/entrypoints/**]
---

# 真实环境Testing纵切

> Testing 23个生产模块、5个Schema/生成合同及13个测试/fixture已进入`d17602e`。

## 当前结论

Testing从Review接受后路由开始。Controller先冻结TestCard，再由Tasking从TestCard确定性派生test
TaskPackage。Test Delivery Preparation可创建initial attempt、在`request-another-attempt`后创建rerun attempt，
或为明确rejected的当前attempt追加replacement authorization；随后从Event权威物化TestCard与Dispatch Packet投影。

Claim、宿主效果观察和Result导入复用Delivery/Result的权威边界，但Test来源必须额外闭合TestCard、
Test TaskPackage、attempt、授权Intent、Dispatch Packet和环境setup策略。`rejected-before-effect + unavailable`
只允许同一attempt的显式替代Delivery授权；`indeterminate`仍停止。Test Result进入独立Controller Test Review，
不能复用implementation的rework/redesign语义。

当前实现支持1–10条连续attempt lineage；rerun绑定直接前驱Result和`request-another-attempt` Decision。
Test accept进入Completion，blocked由共享Resume精确恢复。product-defect释放`currentTestCard`、保留历史Target，
Remediation Authorization重开原产品Target；修复accept后由TestCard Planning创建绑定旧Card/Decision/Authorization
的新retest代际。

公共MCP通过Route、TestCard Planning、最小Test Task Planning、Test Delivery、Claim/Outcome、Result Import、
Inspection/Test Decision、Remediation与Completion工具暴露该链；Server不会自动串联这些步骤，Agent按Route调用。

## X0：TestCard到真实测试Result

```mermaid
flowchart TB
  accTitle: 从Review路由到真实环境Test Result
  accDescr: Controller按Route创建currentTestCard，公共Task Planning从Card派生Test TaskPackage。Preparation支持initial、rerun和replacement。Test Review accept进入Completion，another-attempt回到rerun，blocked由共享Resume回到同一Result/attempt的新Review generation；product-defect进入Remediation、产品返工并在修复accept后创建新TestCard代际。

  subgraph CONTRACT["① 测试合同与任务"]
    direction LR
    ROUTE["[读模型] Post-Acceptance Route\ntesting-required"]
    CARD["[事件权威] immutable TestCard"]
    PACKAGE["[已实现] Test TaskPackage\n公共最小选择 / owner派生"]
    ATTEMPT["[事件权威] TestExecutionAttempt\ninitial / rerun，最多10次"]
  end

  subgraph AUTHORIZATION["② Delivery 授权与投影"]
    direction LR
    PREPARE["[已实现] Test Delivery Preparation"]
    INTENT["[事件权威] Test Delivery Intent\n有界追加授权"]
    PACKET["[投影] TestCard + Dispatch Packet"]
    REPLACE["[显式] 同一attempt替代Delivery授权\n仅rejected-before-effect + unavailable"]
  end

  subgraph EXECUTION["③ 真实环境执行"]
    direction LR
    CLAIM["[事件权威] Test WorkClaim/host-effect claim"]
    ACTION["[执行平面] Test Agent Host Action"]
    OUTCOME["[事件权威] host effect observed\naccepted / indeterminate / rejected"]
  end

  subgraph RESULT_FLOW["④ Result 与审阅"]
    direction LR
    REPORT["[输入] Test TargetResult Report"]
    RESULT["[事件权威] Test TargetResult"]
    REVIEW["[事件权威] Controller Test Review\n四类Decision Event"]
    REVIEW_ROUTE["[读模型] Test Review Route\naccepted / another-attempt / product-defect / blocked"]
    COMPLETION["[已实现] real-environment Completion\n保留Card与attempt lineage"]
    REMEDIATION["[事件权威] Product Remediation\n授权 / 产品返工 / retest来源"]
    BLOCK_RESUME["[已实现] 精确Test Resume\n同一Result / attempt"]
    EFFECT_STOP["[已实现] indeterminate停止\n保留Claim并禁止自动重发"]
  end

  ROUTE -->|"E-X0-01 创建测试合同"| CARD
  CARD -->|"E-X0-02 公共最小选择后确定性派生"| PACKAGE
  CARD -->|"E-X0-03 setupPolicy/maxAttempts"| PREPARE
  PACKAGE -->|"E-X0-04 授权准备"| PREPARE
  PREPARE -->|"E-X0-05 创建initial/rerun或复用当前attempt"| ATTEMPT
  PREPARE -->|"E-X0-06 test-delivery-prepared"| INTENT
  ATTEMPT -->|"E-X0-19 绑定attempt lineage"| INTENT
  INTENT -->|"E-X0-07 事件派生"| PACKET
  PACKET -->|"E-X0-08 目标窗口读取"| CLAIM
  CLAIM -->|"E-X0-09 一次性动作"| ACTION
  ACTION -->|"E-X0-10 真实环境执行"| OUTCOME
  OUTCOME -->|"E-X0-11 accepted"| REPORT
  OUTCOME -->|"E-X0-12 rejected-before-effect"| REPLACE
  REPLACE -->|"E-X0-13 同attempt新authorization"| PREPARE
  OUTCOME -.->|"E-X0-14 indeterminate停止"| EFFECT_STOP
  REPORT -->|"E-X0-15 shared Result Event"| RESULT
  RESULT -->|"E-X0-16 test-result-review-planning"| REVIEW
  REVIEW -->|"E-X0-17 提交Decision并派生route"| REVIEW_ROUTE
  REVIEW_ROUTE -->|"E-X0-18 accept + Test closure"| COMPLETION
  REVIEW_ROUTE -->|"E-X0-20 request-another-attempt"| PREPARE
  REVIEW_ROUTE -->|"E-X0-21 escalate-product-defect"| REMEDIATION
  REMEDIATION -->|"E-X0-24 产品修复accept后新Card代际"| CARD
  REVIEW_ROUTE -->|"E-X0-22 blocked"| BLOCK_RESUME
  BLOCK_RESUME -->|"E-X0-23 Resume Event后重新审阅"| REVIEW
```

### 本图术语说明

| 术语 | 解释 |
| --- | --- |
| TestCard | Controller冻结的真实环境测试合同，含目标、setup策略、通过条件和Authority来源 |
| logical attempt | 一轮逻辑测试执行；TestCard允许1–10次连续attempt，每次可包含最多32个追加型Delivery授权 |
| setup策略 | `reuse-existing / fresh-once / fresh-per-attempt`；每次attempt派生`reuse`或`prepare-fresh`指令，不是环境回执 |
| rerun | 新attempt，必须引用直接前驱attempt、TargetResult与Controller `request-another-attempt` Decision |
| Dispatch Packet | 由prepared Event、Intent、TaskPackage和TestCard派生的目标窗口读取快照 |
| 追加型授权 | 同一attempt的新授权不能改写之前Intent，只能追加新generation |
| 替代Delivery授权 | 明确rejected-before-effect且宿主不可用后，在同一Test attempt追加新Intent；不是自动重试或新attempt |
| Controller Test Review | 独立判断Evidence结论与充分性，提交accept、another-attempt、product-defect或blocked Decision Event |
| Test Review Route | `test-accepted / test-another-attempt-planning / test-product-defect-escalated / test-review-blocked`四类只读路由；四类均有consumer |
| product-defect retest | Remediation授权并接受产品修复后创建的新TestCard，绑定旧Card/Decision/Authorization |
| `currentTestCard` | 当前可规划/执行Test合同；product-defect后退出槽位，但历史Test Target继续保存原Card tuple |

## X0边级证据

| 边编号 | 实际关系 | 当前结论 |
| --- | --- | --- |
| `E-X0-01`–`E-X0-04` | TestCard与Test TaskPackage | 公共Card/Task工具按Route准入；test Package由owner派生 |
| `E-X0-03`、`E-X0-05`、`E-X0-06`、`E-X0-19` | Test Delivery Preparation三种mode | initial/rerun创建attempt；replacement只追加当前attempt授权 |
| `E-X0-07`–`E-X0-17` | Dispatch、Claim、Outcome、Result与Test Review | 各Service以Event前置条件连接；未由公共orchestrator直接串联 |
| `E-X0-18` | Test accept | 已由Completion Authority消费并保留Test lineage |
| `E-X0-20` | request-another-attempt | 已由Test Delivery Preparation `mode:rerun`消费 |
| `E-X0-21`、`E-X0-24` | product-defect与retest | 释放currentTestCard、保留历史Target，授权产品返工并在修复accept后创建新Card |
| `E-X0-22`、`E-X0-23` | Test blocked | 共享Resume Service复验workType/Decision/Result且不消耗attempt |

## 核验快照

| 项目 | 读取值 |
| --- | --- |
| 生产源码 | 23个Testing模块 |
| 当前全仓架构门 | 710模块、4967依赖、0违规；902项TypeScript测试通过 |
| 测试 | 9个正式测试、4个fixture |
| 合同 | 5个Schema、5个生成合同 |
| 提交状态 | Testing及相邻公共入口已进入`d17602e` |
| 来源指纹 | `7f70498f7256fe4cba57c95d0b89ad1c49297afa71d34cf3a0ed1dedef2f4604` |

## 关键边界

- TestCard Planning只创建Card Event，不创建Test TaskPackage。
- Test TaskPackage必须从已持久化TestCard确定性派生。
- Test Delivery授权绑定同一Card/Package/attempt，超过32条失败关闭。
- TestCard允许最多10次attempt；rerun ordinal连续且必须精确引用直接前驱Result/Decision。
- Dispatch Projection缺失时必须从Event历史重建，不能让目标窗口自造packet。
- 真实宿主效果仍遵循accepted/indeterminate/rejected停止规则。
- Test Result使用`workType: test`、ordered step evidence和精确Card/attempt/packet lineage。
- Test accept、another-attempt、blocked和product-defect均有真实consumer；Remediation后必须重新Test。
- Completion不修改或删除TestCard/attempt，Card保持不可变并由终态Aggregate保留。

## 下钻入口

- [Testing关键文件依赖](./file-dependencies.md)
- [Card、Delivery、Claim与Result调用流](./runtime-call-flow.md)
