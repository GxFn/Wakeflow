---
diagramId: ts-delivery-review-runtime-d1
viewType: runtime-call-sequence
truthKind: current-code
reviewDepth: L4
verifiedAt: 2026-09-01
snapshotObservedAt: 2026-09-01T06:42:28-07:00
baselineCommit: d17602ed9931a1898f713c740752c54b94bd8086
sourceFingerprint: sha256:2aa76ec90d7e2b8ceb9212e45a53ea3f0f64f2916bbd610852a9862db2ff0ae0
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Source Maintenance
generatedBy: manual
sourcePaths:
  - src/governance/delivery/**
  - src/governance/result/**
  - src/governance/review/**
testPaths:
  - tests/governance/delivery/**
  - tests/governance/result/**
  - tests/governance/review/**
---

# 实现投递与审阅：准备、Claim、Result和Review调用流

## D1：Delivery准备与一次性宿主动作

```mermaid
sequenceDiagram
  accTitle: Target Delivery准备WorkClaim与一次性Agent Host Action
  accDescr: Preparation从TaskPackage事件和当前Binding创建并提交Delivery Intent。Claim Service要求新鲜Agent窗口观察与当前Binding闭合，在窗口无其他Claim时创建0600 WorkClaim并提交host-effect-claimed事件；只有首次提交回执才能生成一次性Agent Host Action，随后由Agent执行真实宿主发送。

  autonumber
  participant CTRL as Controller/服务
  participant PREP as Delivery Preparation
  participant REPO as Demand Repository
  participant BIND as Binding/观察权威
  participant CLAIM as Host Effect Claim Service
  participant STORE as WindowWorkClaim Store
  participant AGENT as Agent/宿主

  CTRL->>PREP: E-D1-01 preview/apply(TaskPackage, window, rework?)
  PREP->>REPO: E-D1-02 审计TaskPackage与当前Demand阶段
  PREP->>BIND: E-D1-03 闭合目标窗口Binding
  PREP->>PREP: 创建Target Delivery Intent与plan digest
  PREP->>REPO: E-D1-04 提交target-delivery-prepared Event

  AGENT->>CLAIM: E-D1-05 新鲜窗口观察 + prepared Intent
  CLAIM->>BIND: E-D1-06 闭合Binding/Profile/逻辑根
  CLAIM->>STORE: E-D1-07 检查窗口未占用并exclusive-create WorkClaim
  CLAIM->>REPO: E-D1-08 提交target-host-effect-claimed Event
  CLAIM->>AGENT: E-D1-09 从首次提交回执生成Agent Host Action
  AGENT->>AGENT: E-D1-10 执行真实宿主发送
```

### 本图术语说明

| 图中术语 | 解释 |
| --- | --- |
| prepared Intent | 尚未执行宿主效果、已绑定TaskPackage和目标窗口的不可变Delivery事实 |
| 新鲜观察 | 记录时间不超过固定5分钟且与当前Binding/逻辑根一致的Agent窗口观察 |
| exclusive-create | 目标窗口不存在当前Claim时才创建；不同Claim不能覆盖 |
| 一次性动作 | 只由首次committed Claim Event生成；idempotent重放不重复签发 |

### D1边级证据

| 边编号 | 代码位置 | 核验结论 |
| --- | --- | --- |
| `E-D1-01`–`E-D1-04` | Preparation Service/Authority、Intent与Demand Handler | preview/apply闭合TaskPackage和Binding后只追加prepared Event |
| `E-D1-05`、`E-D1-06` | Claim Input/Authority | 候选handle只用于当前观察准入，不进入Action或事件 |
| `E-D1-07`、`E-D1-08` | WorkClaim Store、Claim Service | Claim文件先于Event；中断后以Claim预分配ID前向完成 |
| `E-D1-09`、`E-D1-10` | Claim Service、Agent Host Action | 仅首次committed回执签发Action；Agent才执行宿主效果 |

## D2：宿主效果观察与TargetResult导入

```mermaid
sequenceDiagram
  accTitle: 宿主效果观察与TargetResult事件导入
  accDescr: Agent执行动作后向Outcome Service报告accepted、indeterminate或rejected观察。Service闭合Claim、Intent和当前Demand尾部并提交observed事件。rejected在事件current后精确释放Claim并可显式Rearm；indeterminate保留Claim并停止。只有accepted效果允许Result Import解析Agent Report、创建不可变TargetResult并提交result事件，随后精确释放Claim。

  autonumber
  participant AGENT as Agent
  participant OUTCOME as Outcome Service
  participant CLAIM as WorkClaim Store
  participant REPO as Demand Repository
  participant REARM as Rearm Service
  participant IMPORT as Result Import Service
  participant RESULT as TargetResult owner

  AGENT->>OUTCOME: E-D2-01 observation(action/claim/outcome)
  OUTCOME->>CLAIM: E-D2-02 读取精确WorkClaim与Intent来源
  OUTCOME->>REPO: E-D2-03 复验claimed尾部并提交observed Event
  alt accepted
    OUTCOME-->>AGENT: 当前效果已接受
    AGENT->>IMPORT: E-D2-04 提交implementation Report
    IMPORT->>REPO: E-D2-05 审计TaskPackage/Intent/Claim/accepted来源
    IMPORT->>RESULT: E-D2-06 Wakeflow补齐不可变TargetResult
    IMPORT->>REPO: E-D2-07 提交target-result-recorded Event
    IMPORT->>CLAIM: E-D2-09 Result Event current后精确释放Claim
  else rejected
    OUTCOME->>CLAIM: E-D2-10 observed Event current后精确释放Claim
    AGENT->>REARM: E-D2-08 显式rearm精确rejected尾部
    REARM->>REPO: 提交host-effect-rearmed Event
  else indeterminate
    OUTCOME-->>AGENT: 停止并保留Claim；禁止自动重试
  end
```

### 本图术语说明

| 图中术语 | 解释 |
| --- | --- |
| accepted | 宿主效果已被安全证明发生，可继续导入Result |
| rejected | 宿主明确拒绝且未产生目标效果，可由显式命令打开新generation |
| indeterminate | 结果未知，自动重试可能产生重复效果，因此失败关闭 |
| Wakeflow补齐 | 从事件权威加入IDs、摘要、TaskPackage/Intent/Claim/Effect来源，而非信任Report自报 |

### D2边级证据

| 边编号 | 代码位置 | 核验结论 |
| --- | --- | --- |
| `E-D2-01`–`E-D2-03` | Outcome Input/Authority/Service | observed Event先于后续Claim处置；不重新验证已漂移Binding |
| `E-D2-04`–`E-D2-07` | Implementation Report、Result Import与TargetResult | 仅accepted来源可首次创建Result Event |
| `E-D2-09` | Result Import、Claim release settlement | Result Event current后才释放accepted路径Claim |
| `E-D2-08`、`E-D2-10` | Outcome/Rearm Service | rejected observed Event后释放Claim，再由显式rearm打开新generation；indeterminate不释放 |

## D3：Controller Implementation Review决定、blocked恢复与接受后路由

```mermaid
sequenceDiagram
  accTitle: Controller Implementation TargetResult审阅决定与后续路由
  accDescr: Review Service从Repository一次完整审计构建当前Review Snapshot，Controller提交accept、rework、redesign或blocked决定。Service验证决定引用同一TargetResult和snapshot digest后提交Review Event。blocked决定必须由精确Resume Event恢复才能进入新generation；accepted后只读路由根据Demand Authority测试策略和所有Target状态选择Testing、Completion或阻塞原因。

  autonumber
  participant CTRL as Controller
  participant SNAP as Review Snapshot
  participant REPO as Demand Repository
  participant DECIDE as Implementation Decision Service
  participant RESUME as Resume Service
  participant ROUTE as Post-Acceptance Route

  CTRL->>SNAP: E-D3-01 读取当前Demand审阅视图
  SNAP->>REPO: E-D3-02 auditTargetResultHistory
  REPO-->>SNAP: TaskPackage/Result/Decision/Resume完整历史
  SNAP-->>CTRL: awaiting/reported/decided targets + snapshotDigest
  CTRL->>DECIDE: E-D3-03 decision + reviewed TargetResult/snapshot
  DECIDE->>SNAP: E-D3-04 重新读取并复验同generation
  DECIDE->>REPO: E-D3-05 提交target-result-decided Event

  alt blocked
    CTRL->>RESUME: E-D3-06 resume精确blocked Decision
    RESUME->>SNAP: 复验尚未恢复且仍是当前blocked generation
    RESUME->>REPO: E-D3-07 提交target-result-resumed Event
  else accepted
    CTRL->>ROUTE: E-D3-08 读取接受后路线
    ROUTE->>REPO: 完整Root Authority + 同修订Review Snapshot
    ROUTE-->>CTRL: testing / completion / blocked route
  end
```

### 本图术语说明

| 图中术语 | 解释 |
| --- | --- |
| snapshotDigest | 当前完整Review Snapshot的语义摘要；决定必须引用同一读取代际 |
| rework | 保持同一TaskPackage边界，对同一目标要求实现返工 |
| redesign | 当前TaskPackage边界不足，需要回到设计/规划owner |
| blocked | 缺少外部条件而暂停；不是拒绝、接受或自动完成 |
| post-acceptance route | 零写读模型，根据Authority testing mode和全体目标状态选择下一owner |

### D3边级证据

| 边编号 | 代码位置 | 核验结论 |
| --- | --- | --- |
| `E-D3-01`–`E-D3-05` | Review Snapshot与Implementation Decision Service | 决定前重新审计并绑定同一Result、generation和snapshot digest |
| `E-D3-06`、`E-D3-07` | Target Review Resume Service | 只有当前未恢复blocked generation可追加Resume Event |
| `E-D3-08` | Demand Post-Acceptance Route | accepted后只读选择下一owner，不执行Testing或Completion |

## 停止边界

- Delivery、Result与Review模块已提交；Product Remediation完整调用流在07/08文档包下钻。
- Agent宿主动作、Result Report与Controller决定分别由执行者输入，但只有对应Demand Event改变权威状态。
- 当前公共MCP分别暴露这些owner；跨阶段箭头仍是Event前置条件，不是Server自动串联调用。
- 本文未覆盖Demand完成终态和真实测试纵切，分别由后续07/08文档包下钻。
