---
diagramId: ts-tasking-runtime-t1
viewType: runtime-call-sequence
truthKind: current-code
reviewDepth: L4
verifiedAt: 2026-09-01
snapshotObservedAt: 2026-09-01T06:42:28-07:00
baselineCommit: d17602ed9931a1898f713c740752c54b94bd8086
sourceFingerprint: sha256:0eae581be2a350ceb3e1f4fe0c4db9b0d3659514142e39f8f05eb5c6f8780dbc
audience:
  - maintainer
  - reviewer
documentationOwner: Wakeflow Source Maintenance
generatedBy: manual
refreshTriggers:
  - src/governance/tasking/**
  - src/governance/demand/**
  - src/governance/testing/test-task-package.ts
  - src/governance/testing/test-task-planning-authority.ts
  - src/governance/testing/test-card.ts
  - src/governance/review/demand-post-acceptance-route.ts
  - src/governance/review/demand-result-review-snapshot.ts
  - src/governance/delivery/window-work-claim-store.ts
sourcePaths:
  - src/governance/tasking/**
  - src/governance/testing/test-task-package.ts
  - src/governance/testing/test-task-planning-authority.ts
  - src/governance/testing/test-card.ts
  - src/governance/review/demand-post-acceptance-route.ts
  - src/governance/review/demand-result-review-snapshot.ts
  - src/governance/delivery/window-work-claim-store.ts
schemaPaths:
  - src/contracts/schemas/governance/tasking/**
  - src/contracts/schemas/entrypoints/wakeflow-target-task-planning-request.schema.json
testPaths:
  - tests/governance/tasking/**
  - tests/governance/testing/test-task-planning-service*
---

# Tasking纵切：preview、apply与投影恢复

## T1：零写入preview与exact plan

```mermaid
sequenceDiagram
  accTitle: Target Task Planning零写入preview
  accDescr: 当前公共Coordinator只接受implementation wire请求。它打开Workspace根后调用Planning Service；Service解析authored输入，打开Config、Demand Root Authority和Ledger上下文，解析选择的Authority引用，分配TaskPackage、TargetTask、Commit和Event身份，创建不可变implementation TaskPackage和exact plan，并用真实Decider与Prepared Commit做转换和容量预检，最后只返回plan和planDigest。

  autonumber
  participant CLIENT as Controller/MCP implementation调用方
  participant PUBLIC as Public Coordinator
  participant SERVICE as Planning Service
  participant AUTH as Authority Context
  participant PACKAGE as TaskPackage owner
  participant DEMAND as Demand Decider/Commit

  CLIENT->>PUBLIC: E-T1-01 preview(root, demandId, authored task)
  PUBLIC->>PUBLIC: 领域重解析并打开RootedDirectory
  PUBLIC->>SERVICE: E-T1-02 preview(request)
  SERVICE->>AUTH: E-T1-03 打开Config、Demand根与Ledger根
  AUTH->>AUTH: 解析Authority引用并复验Config/拓扑

  SERVICE->>SERVICE: E-T1-04 分配4类系统ID
  SERVICE->>PACKAGE: E-T1-05 authored字段 + 当前权威创建implementation TaskPackage

  SERVICE->>SERVICE: E-T1-08 创建exact plan + planDigest
  SERVICE->>DEMAND: E-T1-09 纯decide target-task-planned Command
  DEMAND->>DEMAND: 准备Commit并渲染检查容量
  DEMAND-->>SERVICE: 预检成功（不签发append）
  SERVICE-->>PUBLIC: plan + planDigest
  PUBLIC-->>CLIENT: 脱敏ready preview
```

### 本图术语说明

| 图中术语 | 解释 |
| --- | --- |
| authored task | 不含协议头、系统ID、权威摘要和创建时间的Controller内容草稿 |
| 4类系统ID | `taskPackageId`、`targetTaskId`、`commitId`、`eventId` |
| Authority引用 | TaskPackage选中的Ledger authority member引用；由当前Demand Authority解析 |
| planDigest | exact plan的Canonical JSON SHA-256；apply拒绝任一字段变化 |
| 容量预检 | 渲染真实Prepared Commit并检查Event Store单Commit字节上限，仍保持零写入 |

### T1边级证据

| 边编号 | 代码位置 | 测试重点 |
| --- | --- | --- |
| `E-T1-01`、`E-T1-02` | Public Coordinator、Planning Input | wire后二次准入、私有根脱敏、取消和错误映射 |
| `E-T1-03` | Planning Authority | Config/Demand/Ledger根、Identity/Authority摘要、位置和引用 |
| `E-T1-04`、`E-T1-05` | Input/TaskPackage | implementation ID所有权、authored字段与权威字段分责 |
| `E-T1-08`、`E-T1-09` | Plan、Decider、Prepared Commit | plan确定性、阶段转换和容量上限 |

## T1B：公共test选择与owner派生边界

```mermaid
flowchart LR
  accTitle: Target Task Planning公共test选择与owner派生
  accDescr: Controller Route选择Test Task Planning后，公共Coordinator只接收workType test。Service加载TestCard、Review route、Config Test窗口和产品WorkClaim，复用Card预留targetTaskId并派生完整Test TaskPackage；调用方不能重写其assignment、objective、Authority或边界。

  ROUTE["[读模型] Test Task Planning frontier"]
  HARNESS["[测试] test-task-planning-service.test.ts\n聚焦验证"]
  SERVICE["[已实现][源码] TargetTaskPlanningService\ntest request分支"]
  AUTH["[已实现][源码] TestTaskPlanningAuthority\nTestCard / route / Config / WorkClaim"]
  PACKAGE["[已实现][源码] TestTaskPackage\n复用TestCard targetTaskId"]
  EVENT["[已实现] target-task-planned Event\n测试证明可提交"]
  PUBLIC["[已实现] 公共Planning工具\n最小workType:test选择"]

  ROUTE -->|"E-T1-13 准入最小test选择"| PUBLIC
  PUBLIC -->|"E-T1-06 调用Service"| SERVICE
  HARNESS -.->|"聚焦验证"| SERVICE
  SERVICE -->|"E-T1-07 加载Test权威"| AUTH
  AUTH -->|"E-T1-10 返回TestCard"| SERVICE
  SERVICE -->|"E-T1-11 派生"| PACKAGE
  PACKAGE -->|"E-T1-12 提交"| EVENT
```

### 本图术语说明

| 图中术语 | 解释 |
| --- | --- |
| 最小test选择 | 公共请求只携带`taskPackage.workType=test`，不携带完整Package字段 |
| Test Planning Authority | 从Review route、TestCard Event、Config Test窗口及产品WorkClaim组合准入test请求 |
| Test TaskPackage | 从TestCard确定性派生的`workType:test`变体；不是调用方自由编写的测试目标 |
| owner派生 | Service从当前TestCard与Route恢复全部执行合同字段 |

### T1B边级证据

| 边编号 | 代码位置 | 结论 |
| --- | --- | --- |
| `E-T1-06` | Public Coordinator与`TargetTaskPlanningService` | 公共最小test请求进入同一Service |
| `E-T1-07`、`E-T1-10` | `target-task-planning-service.ts`、`test-task-planning-authority.ts` | Service加载TestCard、route、Config与Claim并返回闭合来源 |
| `E-T1-11`、`E-T1-12` | `test-task-package.ts`、Service | 派生Package并提交规划Event |
| `E-T1-13` | 公共request Schema、Public Coordinator与Service | 公共路径允许最小test选择并拒绝调用方重写派生内容 |

## T2：apply、幂等Event与Projection收敛

```mermaid
sequenceDiagram
  accTitle: Target Task Planning apply和TaskPackage投影恢复
  accDescr: apply重新解析plan和planDigest，打开Demand根并按commitId检查已有Commit。若不存在，重新打开完整Authority Context，处理并发raced Commit，复验TaskPackage、Config和纯Decider，然后通过标准Command Handler追加事件。Event authority一旦current，Projection Store从唯一target-task-planned事件创建或复验0600确定文档；同一plan重试只收敛Event和projection。

  autonumber
  participant CLIENT as implementation公共调用方或test内部测试调用
  participant SERVICE as Planning Service
  participant AUTH as Authority Context
  participant REPO as Demand Repository
  participant HANDLER as Command Handler
  participant EVENT as target-task-planned Event
  participant PROJECTION as TaskPackage Projection Store

  CLIENT->>SERVICE: E-T2-01 apply(plan, planDigest)
  SERVICE->>SERVICE: E-T2-02 严格解析并重算planDigest
  SERVICE->>REPO: E-T2-03 打开Demand根并findCommitById

  alt Commit已存在
    SERVICE->>SERVICE: E-T2-04 比较commandDigest和expectedRevision
  else Commit不存在
    SERVICE->>AUTH: E-T2-05 重新打开Config/Demand/Ledger Authority Context
    SERVICE->>REPO: E-T2-06 再查raced Commit
    alt 仍不存在
      SERVICE->>AUTH: E-T2-07 复验TaskPackage/TestCard/拓扑和Config current
      SERVICE->>SERVICE: E-T2-08 修订仍相同时执行纯Decider预检
    else 并发已提交同计划
      REPO-->>SERVICE: idempotent已有Commit
    end
  end

  SERVICE->>HANDLER: E-T2-09 对同plan执行/收敛Command
  HANDLER->>EVENT: E-T2-14 追加或确认唯一规划Event
  EVENT-->>HANDLER: committed / idempotent
  HANDLER-->>SERVICE: committed/idempotent + current Aggregate
  SERVICE->>PROJECTION: E-T2-10 materialize(taskPackageId)
  PROJECTION->>REPO: E-T2-11 审计唯一target-task-planned Event
  REPO-->>PROJECTION: Event位置 + 完整TaskPackage
  PROJECTION->>PROJECTION: E-T2-12 创建/复验0600确定文档
  PROJECTION-->>SERVICE: created/current + digest/source
  SERVICE-->>CLIENT: E-T2-13 Event authority + Commit/Projection摘要
```

### 本图术语说明

| 图中术语 | 解释 |
| --- | --- |
| raced Commit | 第一次检查后、完整Authority Context打开期间由并发调用提交的同sequence事实 |
| `eventAuthority` | Service错误/结果对事件权威的判断：`unchanged / current / unknown` |
| exact Planning Command | 从plan唯一派生的`tasking.target-task-planned`命令；不读取新authored输入 |
| Event位置 | eventId、eventDigest与streamRevision；Projection只引用并审计，不复制Commit权威 |
| `created/current` | 投影本次创建，或已经与Event确定文档完全相同 |
| 收敛 | 重试不产生第二条Event或不同文件，只把缺失派生投影补齐到同一事实 |

### T2边级证据

| 边编号 | 代码位置 | 测试重点 |
| --- | --- | --- |
| `E-T2-01`–`E-T2-04` | `TargetTaskPlanningService.apply` | plan篡改、同commit不同command、已有Commit快速路径 |
| `E-T2-05`–`E-T2-08` | Planning Authority、纯Decider预检 | raced Commit、Config变化、TaskPackage/TestCard关系和revision冲突 |
| `E-T2-09`、`E-T2-14` | Command Handler/Event Store | 单次执行、committed/idempotent、eventAuthority current/unknown |
| `E-T2-10`–`E-T2-12` | TaskPackage Projection Store | 唯一Event、缺失时零写入、0600、确定文档和冲突 |
| `E-T2-13` | Service/Public Coordinator | 脱敏Commit/Projection摘要与资源ref |

## 停止边界

- preview返回的plan不是Event；只有apply经标准Command Handler追加后才形成权威事实。
- Projection失败不允许回滚已经current的Event；调用方根据eventAuthority决定恢复策略。
- 文件Projection是本地读取便利层，不是向目标窗口派发任务的宿主效果。
- T1B已由同一公共MCP Planning工具消费，并受Controller Route frontier约束。
- Tasking合同和Service已进入`d17602e`；后续变化必须刷新本文指纹。
