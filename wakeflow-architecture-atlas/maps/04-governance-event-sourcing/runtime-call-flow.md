---
diagramId: ts-governance-demand-runtime-e0
viewType: runtime-call-sequence
truthKind: current-code
reviewDepth: L4
verifiedAt: 2026-09-01
snapshotObservedAt: 2026-09-01T06:42:28-07:00
baselineCommit: d17602ed9931a1898f713c740752c54b94bd8086
sourceFingerprint: sha256:32f12350f4ac008d9710cd994ffc2a7e94dc23704c019f0ed8851eda32df4317
audience:
  - maintainer
  - reviewer
documentationOwner: Wakeflow Source Maintenance
generatedBy: manual
refreshTriggers:
  - src/governance/demand/event-sourcing/**
  - src/governance/demand/publication/**
sourcePaths:
  - src/governance/demand/**
testPaths:
  - tests/governance/demand/**
---

# Governance：Demand Command、Append、Load与Publication流程

## E0：业务Command决策与幂等追加

```mermaid
sequenceDiagram
  accTitle: Demand业务Command从纯决策到文件Event Store追加
  accDescr: Command Handler准入命令并计算commandDigest，Repository加载当前Aggregate。若expected revision过期，只为幂等重试按commitId查找历史；正常路径由纯Decider产生事件，Prepared Commit在内存中应用全部事件并绑定摘要链，再由Repository和File Event Store在固定sequence槽位追加候选并返回committed或idempotent。

  autonumber
  participant CALLER as 上层业务服务
  participant HANDLER as Command Handler
  participant REPO as Repository
  participant DECIDER as 纯Decider
  participant COMMIT as Prepared Commit
  participant STORE as File Event Store
  participant FILE as candidate/commit文件

  CALLER->>HANDLER: E-E0-01 command + commitId + expectedRevision
  HANDLER->>HANDLER: E-E0-02 严格准入并计算commandDigest
  HANDLER->>REPO: E-E0-03 load当前Aggregate
  REPO-->>HANDLER: null或Aggregate cursor/state

  alt expectedRevision与当前一致
    HANDLER->>DECIDER: E-E0-04 decide(currentState, command)
    DECIDER-->>HANDLER: 一个或多个未提交Event
    HANDLER->>COMMIT: E-E0-05 prepare(current, events, commandDigest)
    COMMIT->>COMMIT: 顺序应用Event并验证结果state/摘要链
    COMMIT-->>HANDLER: Prepared Commit + 新Aggregate
    HANDLER->>REPO: E-E0-06 appendPreparedCommit
    REPO->>STORE: E-E0-07 append(prepared)
    STORE->>FILE: E-E0-08 创建耐久candidate
    STORE->>FILE: E-E0-09 无替换硬链接到固定commitSequence槽位
    STORE->>FILE: E-E0-10 结算耐久性并退休candidate
    STORE-->>HANDLER: committed / idempotent receipt
  else expectedRevision过期
    HANDLER->>REPO: E-E0-11 按commitId有界查找历史
    alt 同commitId、commandDigest和expectedRevision
      REPO-->>HANDLER: 已有Commit
      HANDLER-->>CALLER: idempotent + 当前Aggregate
    else 未找到或绑定不同命令
      HANDLER-->>CALLER: concurrency/idempotency conflict
    end
  end
  HANDLER-->>CALLER: disposition + Commit + Aggregate
```

### 本图术语说明

| 图中术语 | 解释 |
| --- | --- |
| `expectedRevision` | 调用方基于其读取视图期望的当前逻辑事件修订号 |
| `commitId` | 一次业务命令追加的稳定幂等身份；同ID不能绑定不同命令 |
| Prepared Commit | 已完成纯事件应用、游标推进、摘要链和源前缀预期的追加能力 |
| fixed sequence槽位 | `commitSequence`对应的不替换文件名；并发方只能有一个Commit占据 |
| candidate | 进程/线程/token归属的耐久候选文件，用硬链接竞争Commit槽位 |
| idempotent | 同一Commit已存在且完整相同；不重新执行业务转换或写第二条事件 |

### E0边级证据

| 边编号 | 代码位置 | 测试重点 |
| --- | --- | --- |
| `E-E0-01`–`E-E0-03` | `demand-event-sourcing-command-handler.ts` | 输入、revision、commitId、取消和load错误 |
| `E-E0-04`、`E-E0-05` | Decider、Aggregate State、Commit | 阶段守卫、事件联合、multi-event、结果state和摘要 |
| `E-E0-06`–`E-E0-10` | Repository、File Event Store | Prepared capability、candidate、并发槽位、耐久性与残留恢复 |
| `E-E0-11` | Handler/Repository `findCommitById` | 只在过期预期时扫描、同ID同命令重试和冲突 |

## E1：Snapshot-tail加载、完整审计与快照发布

```mermaid
sequenceDiagram
  accTitle: Demand Repository正常加载完整审计与不可变快照
  accDescr: 正常load先读取全部Snapshot观察并按commitSequence倒序尝试有效项；每项只读取锚定Commit和tail，恢复Snapshot后重放tail。无可用Snapshot时从Commit 1完整重放。audit永远从Commit 1重放。读取不创建或修复Snapshot；显式publishSnapshot才根据已加载Aggregate创建并no-replace发布不可变快照。

  autonumber
  participant CALLER as 上层读取者
  participant REPO as Repository
  participant SNAPSTORE as Snapshot Store
  participant STORE as File Event Store
  participant SNAPSHOT as Snapshot模型
  participant REDUCER as Commit/Event归约器

  CALLER->>REPO: E-E1-01 load()
  REPO->>SNAPSTORE: E-E1-02 readSnapshots
  SNAPSTORE-->>REPO: valid/invalid观察（按sequence可排序）
  loop 从最新valid Snapshot向旧尝试
    REPO->>STORE: E-E1-03 readCommitsAfter(snapshot cursor)
    STORE-->>REPO: anchorCommit + tail
    REPO->>SNAPSHOT: E-E1-04 restore(snapshot, anchorCommit)
    REPO->>REDUCER: E-E1-05 顺序重放tail
    alt Snapshot和tail均闭合
      REPO-->>CALLER: Aggregate + snapshotStatus=used
    else Snapshot/锚点/流无效
      REPO->>REPO: 记录失败并尝试更旧Snapshot
    end
  end

  opt 没有可用Snapshot
    REPO->>STORE: E-E1-06 readCommits从1开始
    REPO->>REDUCER: E-E1-07 验证摘要链并完整重放
    REPO-->>CALLER: Aggregate + missing/invalid状态
  end

  CALLER->>REPO: E-E1-08 audit()
  REPO->>STORE: 始终从Commit 1读取
  REPO->>REDUCER: E-E1-09 完整重放每一步结果state
  REPO-->>CALLER: Audited Aggregate

  opt 调用方显式请求快照
    CALLER->>REPO: E-E1-10 publishSnapshot(loaded Aggregate)
    REPO->>SNAPSHOT: create(snapshot, anchorCommit)
    REPO->>SNAPSTORE: E-E1-11 no-replace发布不可变Snapshot
    SNAPSTORE-->>CALLER: published/current receipt
  end
```

### 本图术语说明

| 图中术语 | 解释 |
| --- | --- |
| Snapshot观察 | `valid`或`invalid`的文件读取结果；invalid不会在load中删除或覆盖 |
| anchorCommit | Snapshot声明的最后Commit，恢复时必须与摘要、sequence和revision完全一致 |
| Snapshot-tail | 从Snapshot恢复Aggregate游标后只重放锚点之后的Commit |
| `audit` | 明确从Commit 1验证整个摘要链、版本演进和每一步state的读取模式 |
| `snapshotStatus` | `used / missing / invalid`，解释正常load采用的路径，不是业务状态 |
| no-replace Snapshot | 由commitSequence命名的不可变文件；同一锚点只能有完全相同内容 |

### E1边级证据

| 边编号 | 代码位置 | 测试重点 |
| --- | --- | --- |
| `E-E1-01`–`E-E1-07` | `DemandEventSourcingRepository.load` | 多Snapshot顺序、无效fallback、tail cursor、空流和完整重放 |
| `E-E1-08`、`E-E1-09` | `Repository.audit`、`applyDemandEventStreamCommit` | 从1开始、摘要链、upcast和每步结果state |
| `E-E1-10`、`E-E1-11` | Snapshot模型/Store、Repository.publishSnapshot | anchor闭合、版本兼容摘要、不可变发布和并发幂等 |

## E2：从TODO发布Demand根及前向恢复

```mermaid
sequenceDiagram
  accTitle: 从已确认TODO跨资源发布Demand事件根
  accDescr: Publication Service先创建自包含transaction并完成Authority/Ledger和TODO准入，随后初始化同级流程存储并在Demand专属锁内确保sidecar。applyPublication恢复TODO状态，必要时物化暂存Demand根、初始化Event/Snapshot Store并通过Command Handler写revision 1，然后整体重命名到最终根。最终根存在后claim TODO、移除内部marker、完整加载根权威并退休sidecar。recover只凭demandId和sidecar前向完成。

  autonumber
  participant CALLER as 发布职责所有者
  participant SERVICE as Publication Service
  participant AUTH as Demand Authority + Ledger
  participant TODO as TODO权威
  participant SIDECAR as 同级transaction sidecar
  participant STAGE as 暂存Demand根
  participant ES as Event/Snapshot Store + Command Handler
  participant FINAL as 最终Demand根

  CALLER->>SERVICE: E-E2-01 publishDemandFromTodo(input)
  SERVICE->>SERVICE: E-E2-02 创建无可变阶段的完整transaction
  SERVICE->>AUTH: E-E2-03 admit Identity/Authority/Ledger关系
  SERVICE->>TODO: E-E2-04 检查pending item与collection/state digest
  SERVICE->>SIDECAR: E-E2-05 初始化流程目录并no-replace保存transaction
  SERVICE->>SERVICE: E-E2-06 取得Demand专属短锁
  SERVICE->>TODO: E-E2-07 恢复/读取当前TODO状态

  alt 最终Demand根尚不存在
    SERVICE->>STAGE: E-E2-08 物化私有目录、Identity、Authority与内部marker
    SERVICE->>ES: E-E2-09 初始化Event/Snapshot Store并执行publish Command
    ES-->>STAGE: revision 1 Commit与初始Aggregate
    SERVICE->>FINAL: E-E2-10 同根整体重命名stage
  end

  SERVICE->>FINAL: E-E2-11 复验内部marker与transaction一致
  SERVICE->>TODO: E-E2-12 claim/完成指定TODO item
  SERVICE->>FINAL: E-E2-13 退休内部marker并完整加载Root Authority
  SERVICE->>SIDECAR: E-E2-14 复验后退休sidecar
  SERVICE-->>CALLER: Demand根、TODO lineage与Loaded Authority

  opt 崩溃后恢复
    CALLER->>SERVICE: E-E2-15 recoverDemandPublication(demandId)
    SERVICE->>SIDECAR: 恢复stage并读取自包含transaction
    SERVICE->>SERVICE: 仅在sidecar证明同一流程时退休非活动锁
    SERVICE->>STAGE: 从已完成的最远事实继续前向applyPublication
  end
```

### 本图术语说明

| 图中术语 | 解释 |
| --- | --- |
| Publication transaction | Identity、Authority、TODO预期、revision 1 IDs与所有派生路径的自包含不可变计划 |
| 同级sidecar | 位于Demand最终根之外的流程意图；根尚未发布时仍可找到恢复依据 |
| 内部marker | 暂存/最终Demand根内的transaction副本，用来证明发布根与sidecar相同 |
| stage根 | 与最终根同一文件系统的完整私有候选目录，可整体重命名发布 |
| 前向恢复 | 根据sidecar、stage/final根和TODO当前事实继续，不删除已发布根倒退 |
| TODO lineage | 发布完成后TODO claim/完成产生的可验证来源关系 |

### E2边级证据

| 边编号 | 代码位置 | 测试重点 |
| --- | --- | --- |
| `E-E2-01`–`E-E2-07` | Publication service/transaction/storage/todo | Authority先于副作用、CAS、sidecar、锁和幂等重入 |
| `E-E2-08`–`E-E2-10` | `publication-stage.ts` | 私有节点策略、revision 1、整体rename和stage/final冲突 |
| `E-E2-11`–`E-E2-14` | `applyPublication` | marker、TODO claim、完整Root Authority加载和sidecar退休顺序 |
| `E-E2-15` | `recoverDemandPublication` | demandId查找、sidecar完整性、非活动锁与每个崩溃点前向恢复 |

## 停止边界

- 当前文件Event Store只在单进程内按canonical Demand root串行append；跨进程竞争靠固定槽位硬链接与冲突检测。
- Repository load不写Snapshot；Snapshot发布必须由显式上层策略触发。
- Publication流程锁只保护首次Demand根跨资源发布；普通Event append不取得该流程锁。
- 事件、聚合和消费者联合已进入`d17602e`；后续变化必须重新运行重放、Schema与指纹门。
