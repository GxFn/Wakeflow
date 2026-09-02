---
diagramId: ts-end-to-end-state-z1
viewType: state-recovery
truthKind: current-code
reviewDepth: L5
verifiedAt: 2026-09-01
snapshotObservedAt: 2026-09-01T20:05:05-07:00
baselineCommit: f7c005d73c11e29f284dbde1d7117193376c0ef6
sourceFingerprint: sha256:c287d7336c3e951b1366fd4a37638004d43ee0f60f1e359785ae2f5b2ae0fd38
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Source Maintenance
generatedBy: manual-composition
sourcePaths: [src/workspace/**, src/governance/**]
testPaths: [tests/workspace/**, tests/governance/**]
---

# 端到端异常、幂等与恢复路径

## Z1：业务状态与显式恢复

```mermaid
stateDiagram-v2
  accTitle: Wakeflow端到端业务状态与恢复分支
  accDescr: wakeflow_create_demand以零写preview和精确apply触发Publication，发布Demand根后claim TODO；中断时只有exact sidecar允许显式recover。implementation Delivery按accepted/rejected/indeterminate收敛。Test accept进入Completion，another创建rerun，blocked精确Resume；product-defect释放currentTestCard、保留历史Target并进入Remediation Authorization、原产品返工与新Test代际。Demand归档仍停止，Implementation Redesign保持显式blocker。

  state "① Demand 与规划" as PlanningPhase {
    state "pending-claim TODO" as PendingTodo
    state "Demand根/revision 1已发布\nTODO待claim" as DemandPublished
    state "Active Demand + TODO claimed" as ActiveDemand
    state "TaskPackage已规划" as TaskPlanned
  }

  state "② Delivery 与宿主效果" as DeliveryPhase {
    state "Delivery Intent已准备" as DeliveryPrepared
    state "Host Effect已Claim" as EffectClaimed
    state "效果accepted" as EffectAccepted
    state "效果rejected" as EffectRejected
    state "效果indeterminate" as EffectIndeterminate
  }

  state "③ Result 与 Review" as ReviewPhase {
    state "Result已记录" as ResultRecorded
    state "Implementation Review待决定" as ReviewReady
    state "Implementation Review blocked" as ReviewBlocked
    state "同TaskPackage返工" as Rework
    state "需要redesign" as Redesign
  }

  state "④ Accept 后路由" as FinishPhase {
    state "产品目标accepted" as ProductAccepted
    state "真实环境Testing" as Testing
    state "Test Result已记录" as TestResultRecorded
    state "[事件权威] Controller Test Review待决定" as TestReviewReady
    state "[已实现] test-accepted\nCompletion可消费" as TestAccepted
    state "[已实现] 另一Test attempt待准备" as AnotherTestAttempt
    state "[事件权威] test-product-defect历史\ncurrentTestCard已释放" as TestProductDefect
    state "[已实现] Test Review blocked" as TestReviewBlocked
    state "[事件权威] Remediation Authorization\n原产品Target返工" as ProductRemediation
    state "Demand completed" as DemandCompleted
    state "归档未实现" as ArchiveMissing
  }

  state "Demand cancelled" as DemandCancelled

  [*] --> PendingTodo: E-Z1-01 已确认需求进入TODO

  PendingTodo --> DemandPublished: E-Z1-02 wakeflow_create_demand apply + revision 1
  DemandPublished --> ActiveDemand: E-Z1-03 CAS claim TODO + finalize
  ActiveDemand --> TaskPlanned: E-Z1-04 target-task-planned
  TaskPlanned --> DeliveryPrepared: E-Z1-05 target-delivery-prepared
  DeliveryPrepared --> EffectClaimed: E-Z1-06 WorkClaim + claimed Event
  EffectClaimed --> EffectAccepted: E-Z1-07 observed accepted
  EffectClaimed --> EffectRejected: E-Z1-08 observed rejected
  EffectClaimed --> EffectIndeterminate: E-Z1-09 observed indeterminate
  EffectRejected --> DeliveryPrepared: E-Z1-10 显式rearm新generation
  EffectIndeterminate --> EffectIndeterminate: E-Z1-11 人工调查/禁止自动重试
  EffectAccepted --> ResultRecorded: E-Z1-12 target-result-recorded
  ResultRecorded --> ReviewReady: E-Z1-13 重建Review Snapshot
  ReviewReady --> ProductAccepted: E-Z1-14 accept
  ReviewReady --> Rework: E-Z1-15 rework
  Rework --> DeliveryPrepared: E-Z1-16 同一TaskPackage新attempt
  ReviewReady --> Redesign: E-Z1-17 redesign
  Redesign --> Redesign: E-Z1-18 当前Design/重规划owner未实现
  ReviewReady --> ReviewBlocked: E-Z1-19 blocked
  ReviewBlocked --> ReviewReady: E-Z1-20 精确resume Event
  ProductAccepted --> Testing: E-Z1-21 testing-required
  Testing --> TestResultRecorded: E-Z1-22 Test Result Event
  TestResultRecorded --> TestReviewReady: E-Z1-23 test-result-review-planning
  TestReviewReady --> TestAccepted: E-Z1-24 accept
  TestReviewReady --> AnotherTestAttempt: E-Z1-25 request-another-attempt
  TestReviewReady --> TestProductDefect: E-Z1-26 escalate-product-defect
  TestReviewReady --> TestReviewBlocked: E-Z1-27 blocked
  ProductAccepted --> DemandCompleted: E-Z1-28 controller-only completion-preflight + apply
  AnotherTestAttempt --> Testing: E-Z1-33 rerun Preparation追加新attempt
  TestAccepted --> DemandCompleted: E-Z1-34 real-environment completion-preflight + apply
  TestReviewBlocked --> TestReviewReady: E-Z1-35 精确Resume Event
  TestProductDefect --> ProductRemediation: E-Z1-36 Remediation Authorization Event
  ProductRemediation --> DeliveryPrepared: E-Z1-37 原TaskPackage产品返工
  ActiveDemand --> DemandCancelled: E-Z1-29 lifecycle cancel
  DemandCompleted --> ArchiveMissing: E-Z1-30 当前无归档owner
  DemandCompleted --> [*]: E-Z1-31 成功终态
  DemandCancelled --> [*]: E-Z1-32 取消终态
```

### 本图术语说明

| 术语 | 解释 |
| --- | --- |
| CAS claim | TODO集合与item摘要仍匹配时的条件claim |
| Publication authority | 发布失败后对exact transaction效果的最强证明；`recoverable`要求存在可重读且完全一致的sidecar |
| rearm | 仅对精确rejected效果尾部开放新宿主效果代际 |
| 人工调查 | indeterminate没有自动转换；需要外部证据和显式新命令 |
| 同TaskPackage新attempt | 保留原执行合同，只增加返工上下文和Delivery代际 |
| Controller Test Review | Test conclusion、Evidence充分性和四类Decision的独立Service/Event；不复用implementation判断矩阵 |
| Test completion closure | Test accept后Route携带Card、最终attempt、Result、Decision与Test窗口来源；Completion只投影mode并保留历史 |
| currentTestCard | 当前可规划/执行Test合同槽位；product-defect Target保留历史但不再占用该槽位 |
| lifecycle cancel | 已存在的取消Event终态；不是成功Completion或归档 |

### 本图边级证据索引

| 边编号 | 状态转换 | 主要下钻证据 |
| --- | --- | --- |
| `E-Z1-01` | 需求进入Pending TODO | TODO与需求入口合同 |
| `E-Z1-02` | pending-claim TODO → Demand根已发布 | 公共exact apply委托Publication stage创建Identity/Authority/revision 1并整体发布根 |
| `E-Z1-03` | Demand根已发布 → Active Demand + TODO claimed | Publication在根存在后CAS claim精确TODO并退休marker/sidecar |
| `E-Z1-04` | Active Demand → TaskPackage已规划 | [Tasking垂直切片](../05-tasking-slice/README.md) |
| `E-Z1-05` | TaskPackage已规划 → Delivery Intent已准备 | [实现投递主链](../06-implementation-delivery-review/README.md) |
| `E-Z1-06` | Delivery Intent已准备 → Host Effect已Claim | [Delivery准备与宿主动作](../06-implementation-delivery-review/runtime-call-flow.md) |
| `E-Z1-07` | Claim → accepted | 宿主效果Observation严格闭合 |
| `E-Z1-08` | Claim → rejected | 宿主效果Observation严格闭合 |
| `E-Z1-09` | Claim → indeterminate | 宿主效果Observation严格闭合 |
| `E-Z1-10` | rejected → 新Delivery代际 | [返工与blocked恢复](../07-review-rework-completion/runtime-call-flow.md) |
| `E-Z1-11` | indeterminate保持停止 | 禁止猜测效果结果和自动重试 |
| `E-Z1-12` | accepted → Result已记录 | [宿主观察与TargetResult](../06-implementation-delivery-review/runtime-call-flow.md) |
| `E-Z1-13` | Result已记录 → Review待决定 | 完整Event Stream重建Review Snapshot |
| `E-Z1-14` | Implementation Review → accepted | Controller Implementation Review Decision Event |
| `E-Z1-15` | Implementation Review → rework | Controller Implementation Review Decision Event |
| `E-Z1-16` | rework → 新Delivery attempt | 保留同一TaskPackage的Rework Context |
| `E-Z1-17` | Implementation Review → redesign | Controller Implementation Review Decision Event |
| `E-Z1-18` | redesign保持阻塞 | Controller Route暴露Design blocker；当前没有重规划owner |
| `E-Z1-19` | Review → blocked | blocked Review generation |
| `E-Z1-20` | blocked → Review待决定 | 精确Resume Event |
| `E-Z1-21` | accepted → Testing | Authority测试策略 |
| `E-Z1-22` | Testing → Test Result已记录 | [真实环境测试](../08-real-environment-testing/README.md) |
| `E-Z1-23` | Test Result → Test Review待决定 | `test-result-review-planning` route |
| `E-Z1-24` | Test Review → accepted | shared Decision Event与`test-accepted` route |
| `E-Z1-25` | Test Review → 另一attempt待准备 | `test-another-attempt-planning` route |
| `E-Z1-26` | Test Review → 产品缺陷升级 | `test-product-defect-escalated`选择Remediation owner |
| `E-Z1-27` | Test Review → blocked | `test-review-blocked`持久状态 |
| `E-Z1-28` | implementation accepted → Demand completed | controller-only [Completion preview/apply](../07-review-rework-completion/runtime-call-flow.md) |
| `E-Z1-29` | Active Demand → cancelled | lifecycle cancel Event |
| `E-Z1-30` | completed → 归档缺口 | 当前无归档owner、Schema或测试 |
| `E-Z1-31` | completed → 成功终态 | demand-completed Event |
| `E-Z1-32` | cancelled → 取消终态 | lifecycle cancel Event |
| `E-Z1-33` | another-attempt → Testing | rerun Preparation绑定直接前驱Result/Decision并追加新attempt与首份授权 |
| `E-Z1-34` | test-accepted → Demand completed | real-environment Completion复验Test closure/Test窗口Claim并保留Card/attempt lineage |
| `E-Z1-35` | Test blocked → Test Review待决定 | 共享Resume Service复验workType/Decision/Result并保留同一attempt |
| `E-Z1-36` | product-defect → Remediation | currentTestCard释放、历史Target保留；Authorization Event绑定失败检查与baseline |
| `E-Z1-37` | Remediation → 产品返工Delivery | 原产品Target进入`product-defect-rework-requested`并保持同一TaskPackage |

## 跨层恢复矩阵

| 失败点 | 已有权威 | 恢复入口 | 禁止行为 |
| --- | --- | --- | --- |
| Maintenance step中断 | intent + journal checkpoint | `recover(operationId)` | 重新使用旧preview直接执行 |
| Demand首次发布中断 | 同级exact publication sidecar | 公共`wakeflow_create_demand recover(demandId)`委托`recoverDemandPublication` | 把`unknown`当成安全重试，或删除已发布根倒退 |
| Event append候选残留 | candidate + 固定sequence槽位 | `recoverAppendCandidates` | 覆盖不同Commit |
| Snapshot损坏 | Commit/Event完整流 | load回退完整重放 | 在读取中静默修复历史 |
| TaskPackage投影缺失 | 唯一规划Event | Projection Store materialize | 调用方伪造投影文件 |
| Binding已写、projection失败 | 私有Binding current | 独立重建registered projection | 回滚Binding并重用handle |
| Host effect rejected | observed Event | 显式rearm | 自动重复Host Action |
| Host effect indeterminate | claimed/observed Event | 外部调查后显式决策 | 猜测失败并重试 |
| Review blocked | blocked Decision Event | 精确Resume Event | 绕过Resume提交下一决定 |
| Test accepted后Completion中断 | Test Decision Event + 带Test closure的`completion-preflight` | `DemandCompletionService.apply`同plan恢复 | 删除或改写TestCard/attempt历史 |
| 另一Test attempt准备中断 | `test-another-attempt-requested`状态 + rerun plan/commitId | `TestDeliveryPreparationService.apply`同plan恢复 | 在Review Service中提前创建attempt或重新选择setup语义 |
| 产品缺陷升级 | `test-product-defect`历史Target + currentTestCard absent | Remediation Service按同Decision/Route/affected targets幂等提交Authorization并进入产品返工 | 自动重开未授权Target或复用旧Card rerun |
| Test Review blocked | `test-review-blocked`状态 | 共享`ControllerTargetReviewResumeService`精确Resume | 不核对workType/Decision kind或消耗attempt |
| Completion apply重试 | completion commitId/Event | 同plan幂等apply | 重新生成Completion身份 |

## 全局幂等键

| 范围 | 幂等身份/预期 |
| --- | --- |
| Maintenance | operation ID + intent digest + journal successor |
| Demand Publication | 完整transaction digest + expected TODO collection/state digest + Demand/Event/Commit IDs |
| Demand Event | commitId + commandDigest + expected stream revision |
| Task/Delivery/Result/Review | 确定派生ID + source摘要 + generation |
| WorkClaim | claimId + window/target/intent/action绑定 |
| Projection | Event来源 + 确定文档摘要 |
| Completion | commitId + planDigest + Completion digest |

## 未实现边界

成功Completion之后没有归档状态、存储owner、Schema、测试或恢复入口。Research Completion和
Implementation Redesign也仍是明确缺口。Demand Publication Public已进入提交`f7c005d`，但尚未通过完整发布门；
图中停止节点不是未来实现设计。
