---
diagramId: ts-review-completion-runtime-l1
viewType: runtime-call-sequence
truthKind: current-code
reviewDepth: L4
verifiedAt: 2026-09-01
snapshotObservedAt: 2026-09-01T06:42:28-07:00
baselineCommit: d17602ed9931a1898f713c740752c54b94bd8086
sourceFingerprint: sha256:b2fb77d6e677dd47b85eb174a423068e70aa60354582822d1d4b1e5a942c79f1
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Source Maintenance
generatedBy: manual
sourcePaths: [src/governance/review/**, src/governance/lifecycle/**, src/governance/testing/**, src/governance/result/**, src/governance/delivery/**]
testPaths: [tests/governance/review/**, tests/governance/lifecycle/**, tests/governance/testing/**, tests/governance/result/**, tests/governance/delivery/**]
---

# Review返工、Resume与Completion调用流

## L1：rework与implementation/test blocked generation恢复

```mermaid
sequenceDiagram
  accTitle: Controller Review rework和blocked恢复
  accDescr: Controller从完整Review Snapshot向来源专用Decision Service提交决定。implementation rework被投影为有界Context并用于同一TaskPackage的新Delivery Intent；implementation或test blocked都由共享Resume Service重新读取Snapshot，精确复验workType、Decision、Result和generation，提交Resume Event后回到同一Result的新Review generation。Test Resume不消耗attempt或创建Delivery。

  autonumber
  participant CTRL as Controller
  participant SNAP as Review Snapshot
  participant DECIDE as 来源专用Decision Service
  participant REPO as Demand Repository
  participant PREP_AUTH as Delivery Preparation Authority
  participant REWORK as Rework Context
  participant DELIVERY as Delivery Preparation
  participant RESUME as Resume Service

  CTRL->>SNAP: E-L1-01 读取完整审阅视图
  CTRL->>DECIDE: E-L1-02 rework或blocked决定
  DECIDE->>SNAP: 复验TargetResult与snapshotDigest
  DECIDE->>REPO: E-L1-03 提交Decision Event
  alt rework
    DELIVERY->>PREP_AUTH: E-L1-04 从完整Event历史加载精确Decision/Result
    PREP_AUTH->>REWORK: E-L1-05 投影有界required corrections
    REWORK-->>DELIVERY: 同一TaskPackage的新Intent/generation输入
  else blocked
    CTRL->>RESUME: E-L1-06 精确blocked Decision引用
    RESUME->>SNAP: E-L1-07 复验尚未resume且仍为当前generation
    RESUME->>REPO: E-L1-08 提交Resume Event
    REPO-->>CTRL: 新Review generation可继续
  end
```

### 本图术语说明

| 术语 | 解释 |
| --- | --- |
| required corrections | 从Review决定提取、进入下一Delivery Intent的有界执行修正 |
| 同一TaskPackage | 返工不改变目标边界、acceptance anchors或权威引用 |
| blocked Decision引用 | decisionId、TargetResult和snapshot generation的精确组合 |
| workType闭合 | Resume要求Target phase、TaskPackage/Result workType与Implementation/Test Decision kind一致 |

### L1边级证据

| 边编号 | 代码位置 | 核验结论 |
| --- | --- | --- |
| `E-L1-01`–`E-L1-03` | Review Snapshot、Implementation Decision Service | 决定绑定当前Result与snapshot generation并提交Event |
| `E-L1-04`、`E-L1-05` | Target Delivery Preparation Authority、Rework Context | 后续Preparation从完整历史加载Decision/Result后才压缩返工输入；不是Controller直接调用Rework模块 |
| `E-L1-06`–`E-L1-08` | 共享Resume Service与Review Snapshot | 当前implementation/test blocked Decision尚未恢复时才允许追加Resume Event |

## L2：Demand Completion preview与apply

```mermaid
sequenceDiagram
  accTitle: Demand成功完成preview和幂等apply
  accDescr: Completion preview打开Demand操作Authority Context，加载带controller-only或real-environment testing closure的Post-Acceptance Route、Controller、claimed TODO和WindowWorkClaim事实；real-environment还检查Test窗口无Claim，并允许历史product-defect Test Targets与一个匹配currentTestCard的accepted当前Target并存。apply提交demand-completed；同Commit重试幂等，Aggregate保留全部Card与attempt lineage。

  autonumber
  participant CTRL as Controller
  participant SERVICE as Completion Service
  participant AUTH as Completion Authority
  participant ROUTE as Post-Acceptance Route
  participant TODO as TODO Authority
  participant CLAIMS as WorkClaim Store
  participant REPO as Demand Repository

  CTRL->>SERVICE: E-L2-01 preview(demandId)
  SERVICE->>AUTH: E-L2-02 打开Config/Demand/Ledger Context
  AUTH->>ROUTE: E-L2-03 读取completion-preflight route
  AUTH->>TODO: E-L2-04 验证精确claimed来源
  AUTH->>CLAIMS: E-L2-05 验证无当前WorkClaim
  AUTH-->>SERVICE: Controller/TODO/Route/testingMode闭合来源
  SERVICE->>SERVICE: E-L2-06 创建Completion + exact Plan + digest
  SERVICE->>REPO: 纯Decider/Prepared Commit预检（零写入）
  SERVICE-->>CTRL: plan + planDigest

  CTRL->>SERVICE: E-L2-07 apply(plan, digest)
  SERVICE->>REPO: E-L2-08 按commitId检查已有Commit
  alt 已有同Commit
    SERVICE-->>CTRL: already-completed
  else 尚未提交
    SERVICE->>AUTH: E-L2-09 重载Route/TODO/Claims/Config和current revision
    AUTH-->>SERVICE: 与plan完全一致
    SERVICE->>REPO: E-L2-10 执行demand-completed Command
    REPO-->>SERVICE: committed + completed Aggregate
    SERVICE-->>CTRL: completed / eventAuthority=current
  end
```

### 本图术语说明

| 术语 | 解释 |
| --- | --- |
| Demand操作Context | 当前Config、Demand Root Authority、Ledger根与Aggregate的组合 |
| completion-preflight | 路由读模型证明测试策略和全部目标已满足成功完成条件；real-environment携带已接受Test的精确closure |
| `already-completed` | 同一Completion Commit已存在的幂等apply结果 |
| eventAuthority | Completion Event是否`unchanged/current/unknown`的显式结果/错误状态 |

### L2边级证据

| 边编号 | 代码位置 | 核验结论 |
| --- | --- | --- |
| `E-L2-01`–`E-L2-05` | Completion Service/Authority、Post-Acceptance Route | controller-only检查产品窗口；real-environment额外检查Test窗口和Test closure |
| `E-L2-06` | Demand Completion/Plan、纯Decider | Completion只复制`testingMode`与Route/Review摘要，不复制完整Review closure |
| `E-L2-07`–`E-L2-10` | Completion Service与Demand Command Handler | apply重验、同Commit幂等和唯一completed Event |

## L3：产品缺陷授权、产品返工与新Test代际

```mermaid
sequenceDiagram
  accTitle: Product Defect Remediation授权返工与重新测试
  accDescr: Controller Test Review把充分产品缺陷记录为Decision Event。Remediation Service复验当前Route、TestCard baseline、失败检查和原产品Target，提交Authorization Event并把产品Target推进到product-defect-rework-requested。Delivery在原TaskPackage内修复，Controller重新accept后，TestCard Planning创建绑定旧Card、Test Decision和Authorization的新Card代际。

  autonumber
  participant CTRL as Controller
  participant TEST_REVIEW as Test Review Decision
  participant REMEDIATION as Remediation Service
  participant REPO as Demand Repository
  participant DELIVERY as Product Delivery
  participant IMPL_REVIEW as Implementation Review
  participant CARD as TestCard Planning

  CTRL->>TEST_REVIEW: E-L3-01 escalate-product-defect
  TEST_REVIEW->>REPO: E-L3-02 提交Test Decision Event
  CTRL->>REMEDIATION: E-L3-03 Decision + route digest + affected targets
  REMEDIATION->>REPO: E-L3-04 复验Card baseline与failed checks
  REMEDIATION->>REPO: E-L3-05 提交Remediation Authorization Event
  REPO-->>DELIVERY: E-L3-06 原Target进入product-defect-rework-requested
  DELIVERY->>REPO: E-L3-07 同一TaskPackage的新Delivery/Result
  CTRL->>IMPL_REVIEW: E-L3-08 独立复验并accept修复
  IMPL_REVIEW->>REPO: E-L3-09 提交Implementation Decision Event
  CTRL->>CARD: E-L3-10 创建product-defect-retest Card
```

### 本图术语说明

| 术语 | 解释 |
| --- | --- |
| affected targets | 旧TestCard implementation baselines中由失败检查精确定位的既有产品Target |
| Authorization Event | 绑定Test Decision、Route/Stream fence、原TaskPackage baseline和修复目标的不可变事实 |
| product-defect rework | 不创建新产品TaskPackage；在原边界内产生新的Delivery generation |
| product-defect-retest | 修复accepted后创建的新TestCard，显式引用旧Card、Test Decision与Authorization |

### L3边级证据

| 边编号 | 代码位置 | 核验结论 |
| --- | --- | --- |
| `E-L3-01`、`E-L3-02` | Controller Test Review Decision Service/Event | 只有充分且独立复验的产品缺陷Decision可进入授权 |
| `E-L3-03`–`E-L3-05` | Product Defect Remediation Service/Authorization | 精确route/stream CAS、failed-check映射、幂等Event提交 |
| `E-L3-06`、`E-L3-07` | Aggregate与Product Defect Delivery Context | 原Target重开，同一TaskPackage生成新Delivery |
| `E-L3-08`–`E-L3-10` | Implementation Review与TestCard Planning | 修复需重新accept，之后新Card冻结retest lineage |

## 停止边界

Completion只表示成功终态；取消路径不属于本文。real-environment完成保留TestCard、attempt、Result与Decision
摘要，不新增Card closed事件。TODO归档、BusinessArchive和宿主窗口关闭仍属于后续owner；Lifecycle文件已提交。
