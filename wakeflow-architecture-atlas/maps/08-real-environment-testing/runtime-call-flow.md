---
diagramId: ts-real-testing-runtime-x1
viewType: runtime-call-sequence
truthKind: current-code
reviewDepth: L4
verifiedAt: 2026-09-01
snapshotObservedAt: 2026-09-01T20:05:05-07:00
baselineCommit: f7c005d73c11e29f284dbde1d7117193376c0ef6
sourceFingerprint: sha256:79e7a84af1b73a7d6d51bd50b4a10cc63b80b82aa4119206e2e780cce0d6cb6d
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Source Maintenance
generatedBy: manual
sourcePaths: [src/governance/testing/**, src/governance/tasking/**, src/governance/delivery/**, src/governance/result/**, src/governance/review/**, src/governance/lifecycle/**, src/entrypoints/**]
schemaPaths: [src/contracts/schemas/governance/testing/**, src/contracts/schemas/governance/tasking/**, src/contracts/schemas/governance/result/**, src/contracts/schemas/governance/review/**, src/contracts/schemas/governance/lifecycle/**, src/contracts/schemas/entrypoints/wakeflow-target-task-planning-request.schema.json]
testPaths: [tests/governance/testing/**, tests/governance/tasking/**, tests/governance/delivery/**, tests/governance/result/**, tests/governance/review/**, tests/governance/lifecycle/**, tests/entrypoints/**]
---

# 真实环境Testing：Card、Delivery与Result调用流

## X1：TestCard、Test TaskPackage与Delivery授权

```mermaid
sequenceDiagram
  accTitle: TestCard规划Test TaskPackage和Test Delivery授权
  accDescr: Controller按Route调用公共工具preview/apply创建TestCard事件。同一公共Task Planning工具从唯一Card事件派生Test TaskPackage。Test Delivery Preparation加载Card、Package和Config测试窗口：initial创建首个attempt，rerun绑定直接前驱Result与request-another-attempt Decision创建新attempt，replacement只为rejected当前attempt追加授权；随后提交prepared事件并物化Card与Dispatch Packet。

  autonumber
  participant CTRL as Controller / 公共MCP
  participant CARD as TestCard Planning
  participant REPO as Demand Repository
  participant TASK as Test Task Planning
  participant PREP as Test Delivery Preparation
  participant PACKET as Dispatch Projection Store

  CTRL->>CARD: E-X1-01 公共preview/apply authored TestCard
  CARD->>REPO: E-X1-02 提交test-card-created Event
  CTRL->>TASK: E-X1-03 最小workType:test选择
  TASK->>REPO: 定位唯一Card Event并提交target-task-planned
  CTRL->>PREP: E-X1-04 preview/apply Test Delivery
  PREP->>REPO: E-X1-05 加载Card/Package与当前attempt
  PREP->>PREP: initial / rerun新attempt，或replacement追加当前attempt授权
  PREP->>REPO: E-X1-06 提交test-delivery-prepared Event
  PREP->>PACKET: E-X1-07 从Event物化Card/Dispatch Packet
  PACKET-->>CTRL: created/current投影摘要
```

### 本图术语说明

| 术语 | 解释 |
| --- | --- |
| authored TestCard | Controller提供目标、setup、通过条件等内容；系统分配Card/Event身份 |
| initial attempt | TestCard的首个逻辑执行attempt，ordinal固定为1 |
| rerun attempt | 新attempt，ordinal连续且绑定直接前驱Result和Controller request-another-attempt Decision |
| environment setup | 按`reuse-existing / fresh-once / fresh-per-attempt`与attempt mode唯一派生的执行指令，不是环境已准备回执 |
| authorization generation | 同一attempt中追加的第N份Test Delivery授权，最大32；replacement必须有精确rejected来源 |

### X1边级证据

| 边编号 | 代码位置 | 核验结论 |
| --- | --- | --- |
| `E-X1-01`、`E-X1-02` | TestCard Public Coordinator/Planning Service | Route准入后提交Card Event |
| `E-X1-03` | Target Task Planning Public Coordinator/Test Planning Authority | 最小test选择由owner派生完整Package |
| `E-X1-04`–`E-X1-06` | Test Delivery Preparation Input/Authority/Service | 三种mode严格分离；rerun与replacement不能互换 |
| `E-X1-07` | Dispatch Projection Store | 只从Event历史物化Card和当前Packet |

## X2：Test Claim、真实执行与Result

```mermaid
sequenceDiagram
  accTitle: Test Dispatch Claim真实环境执行与Test Result
  accDescr: Test目标窗口从投影读取Dispatch Packet。Claim Authority从完整事件历史定位prepared Intent并闭合Card、Package、Attempt、Binding和新鲜窗口观察；通用Claim Service创建WorkClaim并提交claimed事件后生成Test Agent Host Action。Outcome记录accepted、indeterminate或rejected；accepted后Test Report经共享Result Import提交TargetResult，独立Test Review再提交shared Decision Event并派生四类route；rejected-before-effect可显式回到同attempt替代授权，indeterminate停止。

  autonumber
  participant TARGET as Test目标窗口
  participant PROJ as Dispatch Projection
  participant CLAIM as Test Claim Authority/Service
  participant AGENT as Agent/宿主
  participant OUTCOME as Outcome Service
  participant REPO as Demand Repository
  participant RESULT as Test Result Import
  participant REVIEW as Controller Test Review
  participant RESUME as Shared Review Resume
  participant REMEDIATION as Product Remediation

  TARGET->>PROJ: E-X2-01 读取Card与Dispatch Packet
  TARGET->>CLAIM: E-X2-02 packet + 新鲜窗口观察
  CLAIM->>REPO: E-X2-03 定位prepared Intent与当前Test阶段
  CLAIM->>CLAIM: 闭合Card/Package/Attempt/Binding并创建WorkClaim
  CLAIM->>REPO: E-X2-04 提交host-effect-claimed Event
  CLAIM-->>AGENT: E-X2-05 一次性Test Agent Host Action
  AGENT->>OUTCOME: E-X2-06 回传accepted/indeterminate/rejected观察
  OUTCOME->>REPO: E-X2-07 提交host-effect-observed Event
  alt accepted
    AGENT->>RESULT: E-X2-08 Test TargetResult Report + ordered step evidence
    RESULT->>REPO: E-X2-09 闭合Card/attempt/packet并提交shared Result Event
    RESULT->>CLAIM: E-X2-14 Result Event current后精确释放Claim
    REPO-->>REVIEW: E-X2-10 test-result-review-planning
    REVIEW->>REPO: E-X2-11 提交shared Test Decision Event
    REPO-->>TARGET: completion-preflight / another-attempt-planning / product-defect / blocked
    opt Test Decision为product-defect
      REVIEW->>REMEDIATION: E-X2-18 精确Decision/route/failed checks
      REMEDIATION->>REPO: E-X2-19 Authorization Event并重开产品Target
    end
    opt Test Decision为blocked
      TARGET->>RESUME: E-X2-16 引用精确Decision/Result/generation
      RESUME->>REPO: E-X2-17 提交Resume Event并回到test-result-reported
    end
  else rejected-before-effect + unavailable
    OUTCOME->>CLAIM: E-X2-15 observed Event current后精确释放Claim
    REPO-->>TARGET: E-X2-12 显式申请同attempt替代Delivery授权
  else indeterminate
    REPO-->>TARGET: E-X2-13 停止并保留Claim；禁止自动重发
  end
```

### 本图术语说明

| 术语 | 解释 |
| --- | --- |
| Test Agent Host Action | 从首次Claim Event生成、要求Agent执行真实测试环境动作的瞬时指令 |
| Test Result Report | 测试Agent输出；只有闭合Event来源后才成为TargetResult |
| 真实环境 | 实际宿主/工作区/依赖条件，不是纯单元测试模拟 |
| ordered step evidence | 与TestCard approved plan逐项同序、索引连续且文字一致的测试执行事实 |
| Test Decision | `accept / request-another-attempt / escalate-product-defect / blocked`；四类均有明确consumer |

### X2边级证据

| 边编号 | 代码位置 | 核验结论 |
| --- | --- | --- |
| `E-X2-01`–`E-X2-05` | Dispatch Projection、Test Claim Authority、共享Claim Service | Claim文件和claimed Event先于首次Action；没有公共dispatch入口 |
| `E-X2-06`、`E-X2-07` | 共享Outcome Service | accepted/indeterminate保留Claim，rejected Event current后授权释放 |
| `E-X2-08`–`E-X2-11`、`E-X2-14` | Test Report、共享Result Import与Test Review | Result Event current后释放Claim并进入独立Test Decision |
| `E-X2-12`、`E-X2-15` | rejected replacement | 释放Claim后只允许同attempt replacement authorization |
| `E-X2-13` | indeterminate | Claim保留且失败关闭 |
| `E-X2-16`、`E-X2-17` | Test blocked Resume | 共享Resume Service复验workType与精确Decision/Result，不消耗attempt或创建Delivery |
| `E-X2-18`、`E-X2-19` | Product Remediation Service | Test缺陷Decision映射到原产品Target并提交Authorization Event |

## 停止边界

Testing与公共入口已提交；本文不声明某次真实宿主测试已经实际执行。Agent仍负责一次性宿主效果，
Wakeflow公共工具负责Card/Task/Delivery/Result/Review/Remediation/Completion的确定性权威与路由。
