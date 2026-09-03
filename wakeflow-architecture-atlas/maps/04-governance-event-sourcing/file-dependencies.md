---
diagramId: ts-governance-demand-file-f4
viewType: file-dependency
truthKind: current-code
reviewDepth: L3
verifiedAt: 2026-09-03
snapshotObservedAt: 2026-09-03T03:13:56-07:00
baselineCommit: 08334ab9c1d8bd923966a976fdf7989bc56ac38c
sourceFingerprint: sha256:f9656e6bd5d30525b68d627c037b477fa2b8e11482175e1830705b7eb9f6796d
audience:
  - maintainer
  - reviewer
documentationOwner: Wakeflow Source Maintenance
generatedBy: mixed
refreshTriggers:
  - src/governance/demand/**
  - src/governance/evidence/**
  - src/contracts/generated/governance/demand/**
sourcePaths:
  - src/governance/demand/**
  - src/governance/evidence/**
  - src/contracts/generated/entrypoints/wakeflow-demand-publication-*.generated.ts
schemaPaths:
  - src/contracts/schemas/governance/demand/**
  - src/contracts/schemas/governance/evidence/**
  - src/contracts/schemas/entrypoints/wakeflow-demand-publication-*.schema.json
testPaths:
  - tests/governance/demand/**
  - tests/governance/evidence/**
  - tests/entrypoints/wakeflow-demand-publication-mcp.test.ts
---

# Governance：Demand事件溯源关键文件依赖

> 本图选取Demand 38个生产模块中的28个状态、命令、存储、快照、Publication物理事务和公共边界骨干文件，
> 并加入相邻Managed Evidence的Capture Plan、Transaction、Record Plan和Record Set Inventory。当前提交基线已经包含
> Transaction/Store/Stage/Final/Application/Recovery。A2-F1只改变Planning读取的TODO Intake字段与测试夹具顺序，
> A2整体又只改变相邻TODO Intake/State、Collection/Board、Transaction、Storage与Service；没有增加Demand模块或改变本图直接import边。

## F4：Demand事件溯源关键文件依赖

```mermaid
flowchart LR
  accTitle: Wakeflow Demand事件溯源关键文件导入关系
  accDescr: Decider、Command Handler、Commit、Repository、Snapshot与Upcaster保持既有Event Sourcing方向。Managed Evidence Application组合Store、Stage与Settlement；Record Set Inventory与Reading Service共同导入单记录Reader，后者依赖Manifest和Record Plan。只读Context继续导入Root Authority并允许Snapshot加tail。Public Coordinator仍只公开既有Demand能力。

  subgraph ROOTS["Demand模型"]
    IDENTITY["[源码][F-DMD-01]\ndemand-identity.ts"]
    AUTHORITY["[源码][F-DMD-02]\ndemand-authority.ts"]
    STATE["[已实现][F-DMD-03]\ndemand-aggregate-state.ts"]
    EVENT["[已实现][F-DMD-04]\ndemand-event-sourcing-event.ts"]
    OP_CONTEXT["[已实现][F-DMD-05]\ndemand-operation-authority-context.ts"]
  end

  subgraph EVIDENCE["Managed Evidence内部骨干"]
    EVIDENCE_MANIFEST["[进行中][F-EVD-01]\nmanaged-evidence-manifest.ts"]
    EVIDENCE_CAPTURE_SERVICE["[进行中][F-EVD-02]\nmanaged-evidence-capture-planning-service.ts"]
    EVIDENCE_CAPTURE_PLAN["[进行中][F-EVD-03]\nmanaged-evidence-capture-plan.ts"]
    EVIDENCE_RECORD_PLAN["[进行中][F-EVD-04]\nmanaged-evidence-record-tree-plan.ts"]
    EVIDENCE_TX["[进行中][F-EVD-05]\nmanaged-evidence-publication-transaction.ts"]
    EVIDENCE_INVENTORY["[进行中][F-EVD-06]\nmanaged-evidence-record-set-inventory.ts"]
    EVIDENCE_STORE["[进行中][F-EVD-07]\nmanaged-evidence-publication-transaction-store.ts"]
    EVIDENCE_PAYLOAD["[进行中][F-EVD-08]\nmanaged-evidence-publication-payload-materializer.ts"]
    EVIDENCE_STAGE["[进行中][F-EVD-09]\nmanaged-evidence-publication-stage-materializer.ts"]
    EVIDENCE_PUBLISHER["[进行中][F-EVD-10]\nmanaged-evidence-publication-record-publisher.ts"]
    EVIDENCE_SOURCE_ROOT["[进行中][F-EVD-11]\nmanaged-evidence-configured-source-root.ts"]
    EVIDENCE_APP["[进行中][F-EVD-12]\nmanaged-evidence-publication-application-service.ts"]
    EVIDENCE_SETTLEMENT["[进行中][F-EVD-13]\nmanaged-evidence-publication-transaction-settlement.ts"]
    EVIDENCE_READER["[进行中][F-EVD-14]\nmanaged-evidence-record-reader.ts"]
    EVIDENCE_READ_SERVICE["[进行中][F-EVD-15]\nmanaged-evidence-reading-service.ts"]
    EVIDENCE_PUBLIC_PLAN["[进行中][F-EVD-16]\nmanaged-evidence-publication-planning-service.ts"]
    EVIDENCE_PUBLIC_CONTRACT["[进行中][F-EVD-17]\nmanaged-evidence-public-contract.ts"]
    EVIDENCE_PUBLIC_COORD["[进行中][F-EVD-18]\nmanaged-evidence-public-coordinator.ts"]
  end

  subgraph SHARED_ENTRY["命令决策与Commit"]
    DECIDER["[已实现][F-ES-01]\ndemand-event-sourcing-decider.ts"]
    HANDLER["[已实现][F-ES-02]\ndemand-event-sourcing-command-handler.ts"]
    AGGREGATE["[源码][F-ES-03]\ndemand-event-sourcing-aggregate.ts"]
    COMMIT["[已实现][F-ES-04]\ndemand-event-stream-commit.ts"]
    STORED["[源码][F-ES-05]\ndemand-event-sourcing-stored-event.ts"]
  end

  subgraph DOMAIN["Repository与文件存储"]
    REPOSITORY["[已实现][F-ES-06]\ndemand-event-sourcing-repository.ts"]
    STORE["[已实现][F-ES-07]\ndemand-file-event-store.ts"]
    SNAPSTORE["[源码][F-ES-08]\ndemand-file-event-snapshot-store.ts"]
    ROOT_AUTH["[已实现][F-ES-09]\ndemand-event-sourcing-root-authority.ts"]
    INVENTORY["[已实现][F-ES-10]\ndemand-event-sourcing-root-inventory.ts"]
  end

  subgraph HOST_ENTRY["Snapshot与版本演进"]
    SNAPSHOT["[已实现][F-ES-11]\ndemand-event-sourcing-snapshot.ts"]
    UPCAST["[源码][F-ES-12]\ndemand-event-sourcing-upcaster.ts"]
    CODEC["[已实现][F-ES-13]\ndemand-event-sourcing-event-version-codec.ts"]
    PERSISTED["[源码][F-ES-14]\ndemand-event-sourcing-persisted-event-envelope.ts"]
  end

  subgraph HOST_IMPL["跨资源Publication"]
    PUB_INPUT["[源码][F-PUB-06]\ndemand-event-sourcing-publication-input.ts"]
    PUB_PLAN["[源码][F-PUB-07]\ndemand-event-sourcing-publication-planning-service.ts"]
    PUB_APP["[源码][F-PUB-08]\ndemand-event-sourcing-publication-application-service.ts"]
    PUB_SERVICE["[源码][F-PUB-01]\ndemand-event-sourcing-publication-service.ts"]
    PUB_TX["[源码][F-PUB-02]\ndemand-event-sourcing-publication-transaction.ts"]
    PUB_STAGE["[源码][F-PUB-03]\ndemand-event-sourcing-publication-stage.ts"]
    PUB_STORAGE["[源码][F-PUB-04]\ndemand-event-sourcing-publication-storage.ts"]
    PUB_TODO["[源码][F-PUB-05]\ndemand-event-sourcing-publication-todo.ts"]
    PUB_CONTRACT["[源码][F-PUB-09]\ndemand-publication-public-contract.ts"]
    PUB_COORD["[源码][F-PUB-10]\ndemand-publication-public-coordinator.ts"]
  end

  WIRE["[生成][F-GEN-04]\nDemand 25个Schema/生成合同"]
  REQUEST_WIRE["[生成][F-GEN-05]\nwakeflow-demand-publication-request.generated.ts"]
  RESULT_WIRE["[生成][F-GEN-06]\nwakeflow-demand-publication-result.generated.ts"]
  EVIDENCE_PUBLIC_WIRE["[生成][F-GEN-07]\nmanaged-evidence-publication request/result"]

  AUTHORITY -->|"E-F4-01 Identity关系"| IDENTITY
  STATE -->|"E-F4-02 Aggregate State Schema"| WIRE
  EVENT -->|"E-F4-03 事件数据Schema"| WIRE
  DECIDER -->|"E-F4-04 纯状态转换"| STATE
  DECIDER -->|"E-F4-05 权威/事件准入"| AUTHORITY
  DECIDER -->|"E-F4-06 创建未提交事件"| EVENT
  STATE -->|"E-F4-47 解析Manifest并投影selector"| EVIDENCE_MANIFEST
  EVENT -->|"E-F4-48 解析完整Manifest事件数据"| EVIDENCE_MANIFEST
  DECIDER -->|"E-F4-49 准入Evidence Command"| EVIDENCE_MANIFEST
  EVIDENCE_CAPTURE_SERVICE -->|"E-F4-50 创建零写plan"| EVIDENCE_CAPTURE_PLAN
  EVIDENCE_RECORD_PLAN -->|"E-F4-51 关闭Manifest与payload树"| EVIDENCE_MANIFEST
  EVIDENCE_TX -->|"E-F4-52 重验preview"| EVIDENCE_CAPTURE_PLAN
  EVIDENCE_TX -->|"E-F4-53 派生record tree"| EVIDENCE_RECORD_PLAN
  EVIDENCE_TX -->|"E-F4-54 派生Event Command"| DECIDER
  EVIDENCE_INVENTORY -->|"E-F4-55 解析固定journal"| EVIDENCE_TX
  EVIDENCE_STORE -->|"E-F4-59 解析exact Transaction"| EVIDENCE_TX
  EVIDENCE_INVENTORY -->|"E-F4-60 统一读取journal"| EVIDENCE_STORE
  EVIDENCE_STAGE -->|"E-F4-61 load exact journal"| EVIDENCE_STORE
  EVIDENCE_STAGE -->|"E-F4-62 委托payload复制"| EVIDENCE_PAYLOAD
  EVIDENCE_STAGE -->|"E-F4-63 派生完整stage plan"| EVIDENCE_RECORD_PLAN
  EVIDENCE_PAYLOAD -->|"E-F4-64 准入Manifest source"| EVIDENCE_TX
  EVIDENCE_PAYLOAD -->|"E-F4-65 绑定payload plan"| EVIDENCE_RECORD_PLAN
  EVIDENCE_PUBLISHER -->|"E-F4-66 require exact journal"| EVIDENCE_STORE
  EVIDENCE_PUBLISHER -->|"E-F4-67 派生final tree plan"| EVIDENCE_RECORD_PLAN
  EVIDENCE_PUBLISHER -->|"E-F4-68 解析Transaction"| EVIDENCE_TX
  EVIDENCE_CAPTURE_SERVICE -->|"E-F4-69 打开Config逻辑root"| EVIDENCE_SOURCE_ROOT
  EVIDENCE_APP -->|"E-F4-70 重验source placement"| EVIDENCE_SOURCE_ROOT
  EVIDENCE_APP -->|"E-F4-71 创建/读取journal"| EVIDENCE_STORE
  EVIDENCE_APP -->|"E-F4-72 物化完整stage"| EVIDENCE_STAGE
  EVIDENCE_APP -->|"E-F4-73 委托不可逆结算"| EVIDENCE_SETTLEMENT
  EVIDENCE_SETTLEMENT -->|"E-F4-74 解析Transaction"| EVIDENCE_TX
  EVIDENCE_SETTLEMENT -->|"E-F4-75 require/retire journal"| EVIDENCE_STORE
  EVIDENCE_SETTLEMENT -->|"E-F4-76 发布final"| EVIDENCE_PUBLISHER
  EVIDENCE_SETTLEMENT -->|"E-F4-77 追加Event"| HANDLER
  EVIDENCE_SETTLEMENT -->|"E-F4-78 查找Commit"| REPOSITORY
  EVIDENCE_SETTLEMENT -->|"E-F4-79 事务期/健康闭包"| ROOT_AUTH
  EVIDENCE_INVENTORY -->|"E-F4-80 复用record metadata"| EVIDENCE_READER
  EVIDENCE_READER -->|"E-F4-81 解析Manifest"| EVIDENCE_MANIFEST
  EVIDENCE_READER -->|"E-F4-82 重建record plan"| EVIDENCE_RECORD_PLAN
  EVIDENCE_READ_SERVICE -->|"E-F4-83 读取/验证record"| EVIDENCE_READER
  EVIDENCE_READ_SERVICE -->|"E-F4-84 对照Event-backed inventory"| EVIDENCE_INVENTORY
  EVIDENCE_READ_SERVICE -->|"E-F4-85 打开只读Authority"| OP_CONTEXT
  OP_CONTEXT -->|"E-F4-86 加载Root Authority"| ROOT_AUTH
  EVIDENCE_PUBLIC_PLAN -->|"E-F4-87 调用Capture Planning"| EVIDENCE_CAPTURE_SERVICE
  EVIDENCE_PUBLIC_PLAN -->|"E-F4-88 生成Transaction"| EVIDENCE_TX
  EVIDENCE_PUBLIC_CONTRACT -->|"E-F4-89 请求Schema"| EVIDENCE_PUBLIC_WIRE
  EVIDENCE_PUBLIC_COORD -->|"E-F4-90 preview"| EVIDENCE_PUBLIC_PLAN
  EVIDENCE_PUBLIC_COORD -->|"E-F4-91 apply/recover"| EVIDENCE_APP
  EVIDENCE_PUBLIC_COORD -->|"E-F4-92 解析公共请求"| EVIDENCE_PUBLIC_CONTRACT
  EVIDENCE_PUBLIC_COORD -->|"E-F4-93 结果Schema"| EVIDENCE_PUBLIC_WIRE
  HANDLER -->|"E-F4-07 决策"| DECIDER
  HANDLER -->|"E-F4-08 准备Commit"| COMMIT
  HANDLER -->|"E-F4-09 加载/追加"| REPOSITORY

  COMMIT -->|"E-F4-10 应用状态"| DECIDER
  COMMIT -->|"E-F4-11 Aggregate游标"| AGGREGATE
  COMMIT -->|"E-F4-12 未提交事件"| EVENT
  COMMIT -->|"E-F4-13 持久事件"| STORED
  COMMIT -->|"E-F4-14 版本演进"| UPCAST
  COMMIT -->|"E-F4-15 Commit Schema"| WIRE

  REPOSITORY -->|"E-F4-16 应用Commit"| COMMIT
  REPOSITORY -->|"E-F4-17 事件存储"| STORE
  REPOSITORY -->|"E-F4-18 Snapshot存储"| SNAPSTORE
  REPOSITORY -->|"E-F4-19 恢复Snapshot"| SNAPSHOT
  REPOSITORY -->|"E-F4-20 upcast历史事件"| UPCAST
  STORE -->|"E-F4-21 Commit文档"| COMMIT
  SNAPSTORE -->|"E-F4-22 Snapshot文档"| SNAPSHOT
  UPCAST -->|"E-F4-23 版本codec"| CODEC
  UPCAST -->|"E-F4-24 稳定事件封装"| PERSISTED
  ROOT_AUTH -->|"E-F4-25 完整根清单"| INVENTORY
  ROOT_AUTH -->|"E-F4-26 聚合重建"| REPOSITORY
  ROOT_AUTH -->|"E-F4-27 Identity/Authority闭合"| AUTHORITY
  ROOT_AUTH -->|"E-F4-28 revision 1验证"| STORE
  INVENTORY -->|"E-F4-58 分类Evidence record set"| EVIDENCE_INVENTORY

  PUB_SERVICE -->|"E-F4-29 自包含恢复计划"| PUB_TX
  PUB_SERVICE -->|"E-F4-30 暂存根与最终加载"| PUB_STAGE
  PUB_SERVICE -->|"E-F4-31 sidecar/lock存储"| PUB_STORAGE
  PUB_SERVICE -->|"E-F4-32 TODO claim/complete"| PUB_TODO
  PUB_STAGE -->|"E-F4-33 发布revision 1命令"| HANDLER
  PUB_STAGE -->|"E-F4-34 构造Repository"| REPOSITORY
  PUB_STAGE -->|"E-F4-35 最终根权威加载"| ROOT_AUTH
  PUB_STAGE -->|"E-F4-36 初始化Event/Snapshot Store"| STORE
  PUB_TX -->|"E-F4-37 Publication Schema"| WIRE
  PUB_PLAN -->|"E-F4-38 解析author-owned输入"| PUB_INPUT
  PUB_PLAN -->|"E-F4-39 创建完整计划"| PUB_TX
  PUB_APP -->|"E-F4-40 复验完整计划"| PUB_TX
  PUB_APP -->|"E-F4-41 委托物理事务"| PUB_SERVICE
  PUB_COORD -->|"E-F4-42 preview"| PUB_PLAN
  PUB_COORD -->|"E-F4-43 apply/recover"| PUB_APP
  PUB_COORD -->|"E-F4-44 解析公共请求"| PUB_CONTRACT
  PUB_CONTRACT -->|"E-F4-45 Request Schema"| REQUEST_WIRE
  PUB_COORD -->|"E-F4-46 Result Schema"| RESULT_WIRE
```

### 本图术语说明

| 图中术语 | 解释 |
| --- | --- |
| 未提交Event | 已由纯Decider确认发生、但尚无commitSequence/streamRevision的领域事实 |
| Stored Event | 绑定事件ID、修订位置、schemaVersion、数据和摘要的持久事件信封 |
| Persisted Event Envelope | 只解析跨版本稳定的位置、类型、原始数据和结果摘要，不提前解释事件家族语义 |
| Aggregate cursor | demandId、commitSequence、streamRevision、lastCommitDigest与当前state的组合 |
| Root Inventory | Demand根允许资源集合及节点策略的排他稳定清单；未知资源使根不健康 |
| Root Authority | Inventory、Identity、Authority、Ledger引用、revision 1和Aggregate的闭合事实 |
| upcast | 从历史schemaVersion逐步转换到当前归约器Event，不修改原Commit文件 |
| Publication sidecar | Demand根同级的immutable发布意图，支持跨TODO/目录发布前向恢复 |
| revision 1 | `publication.demand-published`初始Commit，只允许创建聚合初态 |

## 文件与符号映射

| 文件编号 | 文件/符号 | 状态 | 职责 |
| --- | --- | --- | --- |
| `F-DMD-01` | `model/demand-identity.ts` | 已实现 | Demand不可变身份与确定文档/摘要 |
| `F-DMD-02` | `model/demand-authority.ts#parse/create/admitDemandAuthority` | 已实现 | Identity、角色、测试模式、Ledger引用和位置关系闭合 |
| `F-DMD-03` | `model/demand-aggregate-state.ts` | 已实现 | 15个Event家族对应的纯状态转换和当前selector |
| `F-DMD-04` | `event-sourcing/demand-event-sourcing-event.ts#parseDemandUncommittedEvent` | 已实现 | 未提交事件严格联合，不含持久位置字段 |
| `F-DMD-05` | `demand-operation-authority-context.ts#openDemand*AuthorityContext` | 已实现 | mutation完整audit与Reader Snapshot + tail两种组合权威入口 |
| `F-ES-01` | `demand-event-sourcing-decider.ts#decide/evolve*` | 已实现 | Command准入、幂等摘要、纯事件决策与状态演进 |
| `F-ES-02` | `demand-event-sourcing-command-handler.ts#execute*Command` | 已实现 | 加载→决策→准备→按预期追加及重试冲突处理 |
| `F-ES-03` | `demand-event-sourcing-aggregate.ts#parse*Aggregate` | 已实现 | 聚合游标和state事实的防御性复验 |
| `F-ES-04` | `demand-event-stream-commit.ts#prepare/apply*Commit` | 已实现 | Commit计划、摘要链、事件范围与结果state绑定 |
| `F-ES-05` | `demand-event-sourcing-stored-event.ts` | 已实现 | 持久事件信封、表示和摘要 |
| `F-ES-06` | `demand-event-sourcing-repository.ts#DemandEventSourcingRepository` | 已实现 | snapshot-tail load、full audit、历史查询、append与snapshot发布 |
| `F-ES-07` | `demand-file-event-store.ts#DemandFileEventStore` | 已实现 | 固定sequence文件追加、候选恢复、读取和并发冲突 |
| `F-ES-08` | `demand-file-event-snapshot-store.ts#DemandFileEventSnapshotStore` | 已实现 | 不可变Snapshot读取、发布和有效/无效观察 |
| `F-ES-09` | `demand-event-sourcing-root-authority.ts#load*RootAuthority` | 已实现 | 健康根及Managed Evidence事务期根的Ledger、revision 1、Aggregate与物理集合闭合 |
| `F-ES-10` | `demand-event-sourcing-root-inventory.ts#inspect*RootInventory` | 已实现 | Demand根排他资源清单与节点策略 |
| `F-ES-11` | `demand-event-sourcing-snapshot.ts#create/restore*Snapshot` | 已实现 | 带版本不可变Snapshot和锚定Commit恢复 |
| `F-ES-12/13` | `demand-event-sourcing-{upcaster,event-version-codec}.ts` | 已实现 | 事件schemaVersion codec与相邻版本演进 |
| `F-ES-14` | `demand-event-sourcing-persisted-event-envelope.ts` | 已实现 | 跨事件版本稳定的持久化信封准入与摘要 |
| `F-EVD-01` | `evidence/managed-evidence-manifest.ts#parseManagedEvidenceManifest` | 进行中 | Event与final保存的完整Evidence内容/provenance事实；为final record预留payload容量 |
| `F-EVD-02/03` | `evidence/managed-evidence-capture-{planning-service,plan}.ts` | 进行中 | I/O Planning与纯preview合同分离；plan digest关闭Config、Event Stream预期与Manifest |
| `F-EVD-04` | `evidence/managed-evidence-record-tree-plan.ts#planManagedEvidenceRecordTree` | 进行中 | 从单份Manifest派生stage/final整树路径、mode、bytes和digest计划 |
| `F-EVD-05` | `evidence/managed-evidence-publication-transaction.ts` | 进行中 | 不含可变phase的恢复意图；重建Capture Plan、record tree与Event Command |
| `F-EVD-06` | `evidence/managed-evidence-record-set-inventory.ts` | 进行中 | 复用Record Reader加载healthy metadata；事务期分类journal-only、partial/complete stage或final |
| `F-EVD-07` | `evidence/managed-evidence-publication-transaction-store.ts` | 进行中 | 固定0600 journal的strict absent-only create、稳定load及Store-capability exact retire |
| `F-EVD-08` | `evidence/managed-evidence-publication-payload-materializer.ts` | 进行中 | file stable copy或tree前后identity+transfer candidate；不读取journal或写Manifest |
| `F-EVD-09` | `evidence/managed-evidence-publication-stage-materializer.ts` | 进行中 | exact journal、safe partial、Manifest-last、完整stage与提交后readback；不发布final/Event |
| `F-EVD-10` | `evidence/managed-evidence-publication-record-publisher.ts` | 进行中 | 完整stage→final同根durable rename、exact readback与幂等current；不读取Event或退休journal |
| `F-EVD-11` | `evidence/managed-evidence-configured-source-root.ts` | 进行中 | repository/support逻辑根到当前Config placement与real path的共用解析 |
| `F-EVD-12` | `evidence/managed-evidence-publication-application-service.ts` | 进行中 | Config/Demand/source准入、journal/stage与Apply/Recovery路线选择；不拥有公共协议 |
| `F-EVD-13` | `evidence/managed-evidence-publication-transaction-settlement.ts` | 进行中 | Event追加/查找、Event后final前向完成、Event前stale退休及journal-last健康闭包 |
| `F-EVD-14` | `evidence/managed-evidence-record-reader.ts` | 进行中 | Manifest capability、单完整member读取及exact整树验证；不解释Public披露 |
| `F-EVD-15` | `evidence/managed-evidence-reading-service.ts` | 进行中 | Event-backed inventory准入与deferred/member/complete内部读取结果 |
| `F-EVD-16` | `evidence/managed-evidence-publication-planning-service.ts` | 进行中 | Capture成功后分配Event/Commit ID并生成完整零写Transaction |
| `F-EVD-17` | `evidence/managed-evidence-public-contract.ts` | 进行中 | `wakeflow_record_evidence`三模式Request Schema重解析与容量 |
| `F-EVD-18` | `evidence/managed-evidence-public-coordinator.ts` | 进行中 | root隐私、模式路由、publication authority及metadata-only结果 |
| `F-PUB-01` | `publication-service.ts#publishDemandFromTodo/recoverDemandPublication` | 已实现 | TODO/Ledger准入、sidecar、锁和跨资源前向恢复 |
| `F-PUB-02` | `publication-transaction.ts#create*Transaction` | 已实现 | 不含可变阶段的自包含发布恢复计划 |
| `F-PUB-03` | `publication-stage.ts#materialize/publishDemandStage` | 已实现 | 暂存Demand根、revision 1、整体重命名和最终加载 |
| `F-PUB-04/05` | `publication-{storage,todo}.ts` | 已实现 | sidecar/锁资源与TODO claim/complete关系 |
| `F-GEN-04` | `contracts/{schemas,generated}/governance/demand/*` | 进行中 | 25个事件/状态/Commit/Snapshot/Authority合同，含Managed Evidence Recorded v1 |
| `F-PUB-06` | `demand-event-sourcing-publication-input.ts` | 已实现 | 只接收作者语义、typed TODO ID、位置与Ledger成员选择的关闭输入 |
| `F-PUB-07` | `demand-event-sourcing-publication-planning-service.ts` | 已实现 | 零写读取Config/TODO/Ledger并派生完整transaction与digest |
| `F-PUB-08` | `demand-event-sourcing-publication-application-service.ts` | 已实现 | exact plan/current authority复验、物理apply/recover委托与输出闭合 |
| `F-PUB-09/10` | `demand-publication-public-{contract,coordinator}.ts` | 已实现 | 公共Schema重解析、根隐私、模式路由、稳定回执与错误authority |
| `F-GEN-05/06` | `contracts/{schemas,generated}/entrypoints/wakeflow-demand-publication-*` | 已实现 | `wakeflow_create_demand`自包含Request/Result wire合同 |
| `F-GEN-07` | `contracts/{schemas,generated}/entrypoints/wakeflow-managed-evidence-publication-*` | 进行中 | 第19工具自包含Request/Result wire合同 |

## 原始依赖快照

| 范围 | 生产模块 | 当前全仓受检模块 | 当前全仓依赖 | 违规 |
| --- | ---: | ---: | ---: | ---: |
| Demand Event Sourcing + Publication | 38 + 21个相邻Evidence模块 | 823 | 5817 | 0 |

本图仍只选择Demand骨干；全量依赖数使用当前全仓SWC architecture gate，局部边以本图静态imports为准。

## 边级证据

| 边编号 | 范围 | 代码/测试证据 |
| --- | --- | --- |
| `E-F4-01`–`E-F4-15` | 模型、Decider、Handler与Commit | 直接imports；aggregate/decider/handler/commit测试 |
| `E-F4-16`–`E-F4-28` | Repository、Store、Snapshot、Upcast与Root Authority | 直接imports；repository/store/snapshot/upcast/inventory测试 |
| `E-F4-29`–`E-F4-37` | 跨资源Publication | service/stage/storage/todo直接imports；publication service/transaction测试 |
| `E-F4-38`–`E-F4-46` | Publication公共边界 | Input/Planning/Application/Contract/Coordinator直接imports；25项聚焦与真实MCP Route测试 |
| `E-F4-47`–`E-F4-49` | Managed Evidence Event边界 | Aggregate/Event/Decider直接导入Manifest；4项Event测试及真实Commit重放 |
| `E-F4-50`–`E-F4-55`、`E-F4-58`–`E-F4-68` | Managed Evidence Store/Stage/Final/Inventory边界 | Store→Transaction、Stage→Store/Payload/Plan、Publisher→Store/Plan/Transaction及Root Inventory→Record Set直接imports |
| `E-F4-69`–`E-F4-79` | Managed Evidence内部Application/Recovery | Configured Source Root被Planning/Application共用；Application→Store/Stage/Settlement；Settlement→Transaction/Store/Publisher/Handler/Repository/Root Authority |
| `E-F4-80`–`E-F4-86` | Managed Evidence按需Reader | Inventory→Reader共享metadata；Reading Service→Reader/Inventory/Read Context；Read Context→Root Authority；Reader切片55项 |
| `E-F4-87`–`E-F4-93` | Managed Evidence Public | Public Planning→Capture/Transaction；Coordinator→Planning/Application/Contract/Result wire；Evidence日常门11项，完整Public相关47项分层通过 |

## 停止边界

- 文件存在不等于调用方可绕过Command/Repository；公共写入必须经过真实owner。
- Repository的历史查询不是独立持久投影；它每次审计完整不可变流。
- Snapshot只加速正常load，不能替代Commit摘要链或audit。
- 公共调用方不能绕过Decider/Prepared Commit直接向文件Store写任意事件。
- `wakeflow_record_evidence`已公开metadata-only记录；内部Reader bytes仍不在Public Contract中。
- 当前Publication Planning读取`intake.demandType`和`testingDecision`，但尚未把caller Ledger selectors与`intake.authorityRefs`做精确相等复验；该缺口不应画成已关闭的import或调用边。
