---
diagramId: ts-governance-demand-runtime-e0
viewType: runtime-call-sequence
truthKind: current-code
reviewDepth: L4
verifiedAt: 2026-09-03
snapshotObservedAt: 2026-09-03T03:13:56-07:00
baselineCommit: 08334ab9c1d8bd923966a976fdf7989bc56ac38c
sourceFingerprint: sha256:0458a427b22590bb4451dd2d11e15154d27950aa133f048a794b906c37b352c8
audience:
  - maintainer
  - reviewer
documentationOwner: Wakeflow Source Maintenance
generatedBy: manual
refreshTriggers:
  - src/governance/demand/event-sourcing/**
  - src/governance/demand/publication/**
  - src/governance/evidence/**
sourcePaths:
  - src/governance/demand/**
  - src/governance/evidence/**
  - src/contracts/generated/entrypoints/wakeflow-demand-publication-*.generated.ts
schemaPaths:
  - src/contracts/schemas/entrypoints/wakeflow-demand-publication-*.schema.json
  - src/contracts/schemas/governance/evidence/**
testPaths:
  - tests/governance/demand/**
  - tests/governance/evidence/**
  - tests/entrypoints/wakeflow-demand-publication-mcp.test.ts
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

## E2：公共preview、精确应用与Demand根前向恢复

```mermaid
sequenceDiagram
  accTitle: 从公共preview到精确应用和Demand事件根前向恢复
  accDescr: MCP客户端先提交只含作者语义与Ledger成员选择的preview；Planning零写读取Config、Ledger-bound TODO和Ledger并返回完整transaction及摘要。客户端确认后以原plan和digest调用apply，Application复验当前权威并委托物理Publication Service。后者保存sidecar、发布包含revision 1的Demand根，再claim TODO；recover只凭demandId和exact sidecar前向完成。当前Planning尚未把调用方选择与Intake authorityRefs精确等同；公共层不复制物理状态机，也不执行宿主效果。

  autonumber
  participant CLIENT as MCP客户端/Controller
  participant PUBLIC as Public Coordinator
  participant PLANNING as Planning Service
  participant APPLICATION as Application Service
  participant SERVICE as Publication Service
  participant AUTH as Demand Authority + Ledger
  participant TODO as TODO权威
  participant SIDECAR as 同级transaction sidecar
  participant STAGE as 暂存Demand根
  participant ES as Event/Snapshot Store + Command Handler
  participant FINAL as 最终Demand根

  CLIENT->>PUBLIC: E-E2-16 preview authored Demand + TODO/Ledger选择
  PUBLIC->>PLANNING: E-E2-17 只读规划
  PLANNING->>AUTH: E-E2-18 读取Config与Ledger成员
  PLANNING->>TODO: E-E2-19 读取pending item与CAS摘要
  PLANNING-->>PUBLIC: 完整transaction + planDigest
  PUBLIC-->>CLIENT: 完整preview plan + planDigest
  CLIENT->>PUBLIC: E-E2-20 apply原plan + digest
  PUBLIC->>APPLICATION: E-E2-21 复验公共合同与根隐私
  APPLICATION->>SERVICE: E-E2-01 publishDemandFromTodo(derived input)
  SERVICE->>SERVICE: E-E2-02 重建并闭合完整transaction
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
  SERVICE-->>APPLICATION: Demand根、TODO lineage与Loaded Authority
  APPLICATION-->>PUBLIC: E-E2-22 current Publication回执
  PUBLIC-->>CLIENT: 不含机器路径或完整业务记录的稳定结果

  opt 崩溃后恢复
    CLIENT->>PUBLIC: E-E2-23 recover(demandId)
    PUBLIC->>APPLICATION: E-E2-24 打开当前Config/Ledger并请求恢复
    APPLICATION->>SERVICE: E-E2-15 recoverDemandPublication(demandId)
    SERVICE->>SIDECAR: 恢复stage并读取自包含transaction
    SERVICE->>SERVICE: 仅在sidecar证明同一流程时退休非活动锁
    SERVICE->>STAGE: 从已完成的最远事实继续前向applyPublication
  end
```

### 本图术语说明

| 图中术语 | 解释 |
| --- | --- |
| Publication transaction | Identity、Authority、TODO预期、revision 1 IDs与所有派生路径的自包含不可变计划 |
| authored Demand | 调用方拥有的title、goal、completion definition、执行位置、typed TODO选择与Ledger成员选择；不含系统派生Demand身份、时间、摘要或CAS；Ledger选择暂未由Intake引用唯一派生 |
| exact apply | 必须提交preview返回的完整plan及其digest；Application重新解析并复验当前Config/Ledger与输出闭合 |
| 同级sidecar | 位于Demand最终根之外的流程意图；根尚未发布时仍可找到恢复依据 |
| 内部marker | 暂存/最终Demand根内的transaction副本，用来证明发布根与sidecar相同 |
| stage根 | 与最终根同一文件系统的完整私有候选目录，可整体重命名发布 |
| 前向恢复 | 根据sidecar、stage/final根和TODO当前事实继续，不删除已发布根倒退 |
| TODO lineage | 发布完成后TODO claim/完成产生的可验证来源关系 |
| Publication authority | 失败时公开的最强可证效果：`unchanged / recoverable / current / unknown`；只有`recoverable`指示显式recover |

### E2边级证据

| 边编号 | 代码位置 | 测试重点 |
| --- | --- | --- |
| `E-E2-01`–`E-E2-07` | Publication service/transaction/storage/todo | Authority先于副作用、CAS、sidecar、锁和幂等重入 |
| `E-E2-08`–`E-E2-10` | `publication-stage.ts` | 私有节点策略、revision 1、整体rename和stage/final冲突 |
| `E-E2-11`–`E-E2-14` | `applyPublication` | marker、TODO claim、完整Root Authority加载和sidecar退休顺序 |
| `E-E2-15` | `recoverDemandPublication` | demandId查找、sidecar完整性、非活动锁与每个崩溃点前向恢复 |
| `E-E2-16`–`E-E2-21` | Public Contract/Coordinator、Input与Planning/Application Services | preview只有author-owned输入且零写；apply只接受exact plan/digest并复验当前权威 |
| `E-E2-22` | Application/Public Coordinator输出闭合 | Canonical JSON语义比较、commit digest与稳定脱敏回执 |
| `E-E2-23`、`E-E2-24` | Public recover与Application Service | recover只接受Demand ID，缺失或冲突sidecar失败关闭 |

## E3：Managed Evidence内部Application与恢复闭包

```mermaid
flowchart LR
  accTitle: Managed Evidence内部可恢复发布与按需读取
  accDescr: Capture Planning Service与Application共用Config逻辑source root解析；Application按journal、完整stage、Event、final和journal-last完成可恢复发布。健康Root Authority关闭Event selector与final关系。Reading Service提供三级内部读取。Public Planning从Capture结果生成完整Transaction，Coordinator路由preview、apply和recover并只投影metadata receipt；官方MCP注册wakeflow_record_evidence，但不公开Reader bytes。

  subgraph PLAN["① 零写计划"]
    PLAN_SERVICE["[代码] Capture Planning Service"]
    CAPTURE_PLAN["[计划] Capture Plan codec"]
    SOURCE_ROOT["[代码] Configured Source Root\n逻辑root → current real path"]
    TRANSACTION["[计划] Publication Transaction\n无可变phase"]
    RECORD_PLAN["[计划] Record Tree Plan"]
    COMMAND["[计划] Managed Evidence Event Command"]
  end

  subgraph INVENTORY["② 事务与文件只读分类"]
    ROOT_INVENTORY["[代码] Demand Root Inventory\n三类phase"]
    RECORD_SET["[代码] Record Set Inventory"]
    TX_STORE["[代码] Transaction Store\nstrict create / load / exact retire"]
    JOURNAL_TREE["[观察] journal / stage / final\nabsent或关闭状态"]
  end

  subgraph MATERIALIZE["③ Payload、Stage与Final物理owner"]
    PAYLOAD_MATERIALIZER["[代码] Payload Materializer\nfile稳定copy / tree前后identity"]
    STAGE_MATERIALIZER["[代码] Stage Materializer\njournal → safe partial → Manifest-last"]
    RECORD_PUBLISHER["[代码] Final Record Publisher\ncomplete stage → durable final / current"]
  end

  subgraph ORCHESTRATE["④ Application与不可逆结算"]
    APPLICATION["[代码] Publication Application\nApply / recover路线选择"]
    SETTLEMENT["[代码] Transaction Settlement\nEvent后前向 / Event前stale退休"]
    HANDLER["[代码] Command Handler"]
    RETIRE["[Foundation] Candidate Retirement"]
  end

  subgraph AUTHORITY["⑤ 事务期与健康态闭包"]
    ROOT_AUTHORITY["[代码] Demand Root Authority\ntransaction phase / healthy"]
    REPOSITORY["[权威] Repository重放Aggregate"]
    CLOSURE{"[守卫] selector / final / identity\n是否逐项一致"}
  end

  subgraph READ["⑥ Event-backed按需读取"]
    READ_CONTEXT["[代码] Demand Read Authority Context\nSnapshot + tail"]
    READ_SERVICE["[代码] Evidence Reading Service\n定位Event-backed record"]
    RECORD_READER["[代码] Record Reader\nManifest capability + 内容验证"]
    READ_RESULT["[结果] deferred / member / complete"]
  end

  subgraph PUBLIC_EVIDENCE["⑦ metadata-only公共记录"]
    PUBLIC_PLANNING["[代码] Publication Planning\nCapture + Event/Commit ID"]
    PUBLIC_COORD["[代码] Public Coordinator\npreview / apply / recover"]
    PUBLIC_SCHEMA["[Schema] Request / Result\nmetadata-only Apply/Recover"]
    MCP_TOOL["[公共] wakeflow_record_evidence"]
  end

  PLAN_SERVICE -->|"E-E3-01 创建"| CAPTURE_PLAN
  PLAN_SERVICE -->|"E-E3-22 解析逻辑source root"| SOURCE_ROOT
  TRANSACTION -->|"E-E3-02 重验preview"| CAPTURE_PLAN
  TRANSACTION -->|"E-E3-03 派生"| RECORD_PLAN
  TRANSACTION -->|"E-E3-04 派生"| COMMAND
  ROOT_INVENTORY -->|"E-E3-05 调用"| RECORD_SET
  RECORD_SET -->|"E-E3-06 分类stage/final"| JOURNAL_TREE
  ROOT_AUTHORITY -->|"E-E3-08 读取排他清单"| ROOT_INVENTORY
  ROOT_AUTHORITY -->|"E-E3-09 重放"| REPOSITORY
  ROOT_INVENTORY -->|"E-E3-10 final摘要集合"| CLOSURE
  REPOSITORY -->|"E-E3-11 Aggregate selector"| CLOSURE
  CLOSURE -->|"E-E3-12 一致才健康"| ROOT_AUTHORITY
  RECORD_SET -->|"E-E3-13 load固定journal"| TX_STORE
  TX_STORE -->|"E-E3-14 稳定读取并签发capability"| JOURNAL_TREE
  STAGE_MATERIALIZER -->|"E-E3-15 load exact journal"| TX_STORE
  STAGE_MATERIALIZER -->|"E-E3-16 委托source copy"| PAYLOAD_MATERIALIZER
  PAYLOAD_MATERIALIZER -->|"E-E3-17 按record plan物化payload"| RECORD_PLAN
  STAGE_MATERIALIZER -->|"E-E3-18 Manifest-last形成完整stage"| JOURNAL_TREE
  RECORD_PUBLISHER -->|"E-E3-19 require exact journal"| TX_STORE
  RECORD_PUBLISHER -->|"E-E3-20 按record plan发布"| RECORD_PLAN
  RECORD_PUBLISHER -->|"E-E3-21 stage→final或current"| JOURNAL_TREE
  APPLICATION -->|"E-E3-23 重验当前source placement"| SOURCE_ROOT
  APPLICATION -->|"E-E3-24 absent-only创建journal"| TX_STORE
  APPLICATION -->|"E-E3-25 物化或重用完整stage"| STAGE_MATERIALIZER
  APPLICATION -->|"E-E3-26 进入不可逆边界"| SETTLEMENT
  SETTLEMENT -->|"E-E3-27 exact Event append / lookup"| HANDLER
  HANDLER -->|"E-E3-28 乐观并发提交"| REPOSITORY
  SETTLEMENT -->|"E-E3-29 Event后发布final"| RECORD_PUBLISHER
  SETTLEMENT -->|"E-E3-30 Event前stale退休"| RETIRE
  SETTLEMENT -->|"E-E3-31 事务期与健康态复验"| ROOT_AUTHORITY
  SETTLEMENT -->|"E-E3-32 最后退休journal"| TX_STORE
  RECORD_SET -->|"E-E3-33 复用metadata loader"| RECORD_READER
  READ_SERVICE -->|"E-E3-34 打开只读Authority"| READ_CONTEXT
  READ_CONTEXT -->|"E-E3-35 Snapshot + tail闭包"| ROOT_AUTHORITY
  READ_SERVICE -->|"E-E3-36 读取指定record"| RECORD_READER
  RECORD_READER -->|"E-E3-37 重建exact plan"| RECORD_PLAN
  RECORD_READER -->|"E-E3-38 读取Manifest/member/tree"| JOURNAL_TREE
  RECORD_READER -->|"E-E3-39 签发分级证明"| READ_RESULT
  PUBLIC_PLANNING -->|"E-E3-40 调用零写capture"| PLAN_SERVICE
  PUBLIC_PLANNING -->|"E-E3-41 生成完整Transaction"| TRANSACTION
  PUBLIC_COORD -->|"E-E3-42 preview"| PUBLIC_PLANNING
  PUBLIC_COORD -->|"E-E3-43 apply / recover"| APPLICATION
  PUBLIC_COORD -->|"E-E3-44 重验并脱敏"| PUBLIC_SCHEMA
  MCP_TOOL -->|"E-E3-45 官方Server调用"| PUBLIC_COORD
```

### 本图术语说明

| 图中术语 | 解释 |
| --- | --- |
| Capture Plan codec | 只解析Config摘要、Event Stream预期、Manifest及plan digest的纯合同；不依赖Planning I/O Service |
| 无可变phase | Transaction不保存`prepared/executing/committed`字段；恢复阶段从journal、stage/final与Event Store事实观察 |
| 三类phase | `healthy`、`demand-publication`、`managed-evidence-publication`三个明确Root Inventory上下文 |
| Record Set Inventory | healthy路径关闭final Manifest与顶层、将历史payload复验标记为deferred；事务路径对当前stage/final执行完整record-plan分类 |
| Transaction Store | 固定0600单槽的strict create/load/exact retire owner；现存exact journal也不被普通create接管，retire只接受Store签发能力 |
| Payload Materializer | file来源执行stable streaming copy；tree来源在复制前后计算完整Loaded Artifact identity并保留executable mode |
| Stage Materializer | 只在exact journal下创建/补齐stage；完整payload可脱离变化source恢复，Manifest必须最后出现 |
| Final Record Publisher | 只把完整stage同根rename为不存在final；final已存在时只接受stage absent且整树exact，journal保持不变 |
| Configured Source Root | 把Manifest中的repository/support逻辑根闭合到当前Config entity、present placement与real path；不读取source内容 |
| Transaction Settlement | Application下的不可逆边界owner；Event提交后只能发布final并退休journal，Event缺失且基线过期时才可退休safe candidate |
| transaction phase | journal存在时的专用Root Authority模式；允许目标stage/final与Event selector处于被事务顺序明确解释的中间组合 |
| Read Authority Context | 只读消费使用普通Root Authority的Snapshot + tail路径；mutation上下文继续从Commit 1完整audit |
| deferred / member / complete | 分别表示只验证Manifest顶层、一个完整payload文件、整棵record tree；三者不能互相冒充 |
| Manifest capability | Record Reader进程内签发的WeakSet能力；structured clone不能取得成员或整树读取权限 |
| metadata-only receipt | Apply/Recover只返回typed ID、摘要与Event/Commit/Aggregate游标；不返回Manifest、source ref或payload bytes |
| Aggregate selector | Event重放得到的`evidenceId + manifestDigest + payloadArtifactDigest`最小当前状态 |
| 健康闭包 | 物理final的Manifest摘要集合与Event selector、Program/Demand/Authority身份全部一致；具体payload内容在Evidence读取时复验 |

### E3边级证据

| 边编号 | 代码位置 | 测试重点 |
| --- | --- | --- |
| `E-E3-01` | `managed-evidence-capture-planning-service.ts` → `managed-evidence-capture-plan.ts` | 既有file/tree preview保持零写且digest不变 |
| `E-E3-02`–`E-E3-04` | `managed-evidence-publication-transaction.ts` | capture/record/command三摘要轴分别替换均拒绝；deterministic document重读 |
| `E-E3-05` | `demand-event-sourcing-root-inventory.ts` → `managed-evidence-record-set-inventory.ts` | healthy、demand-publication与managed-evidence-publication严格分流 |
| `E-E3-06` | Record Set Inventory、Transaction codec与Foundation candidate inspection | journal-only、partial/complete stage、当前final payload漂移，以及healthy历史payload复验deferred |
| `E-E3-08`–`E-E3-12` | `demand-event-sourcing-root-authority.ts`、Root Inventory与Repository | 完整final但无Event及foreign Program Manifest均拒绝；真实Command Handler追加后audit加载通过 |
| `E-E3-13`、`E-E3-14` | Record Set Inventory与Transaction Store | Inventory复用Store load；Application/Settlement分别消费strict create/load/exact retire |
| `E-E3-15`–`E-E3-18` | Payload/Stage Materializer、Transaction Store、Record Plan与Foundation transfer/candidate | 5项测试覆盖file/tree、executable、safe partial、Manifest-last、journal缺失与source漂移 |
| `E-E3-19`–`E-E3-21` | Final Record Publisher、Store、Record Plan与Foundation directory publication | 3项测试覆盖真实rename、current、journal保留、缺失/不完整/双根及final漂移；Publisher不读取Event |
| `E-E3-22`、`E-E3-23` | Capture Planning/Application → Configured Source Root | Planning旧行为回归通过；Application重验当前Config placement后才读取source |
| `E-E3-24`–`E-E3-29` | Application、Settlement、Store、Stage、Command Handler与Publisher | 正常真实Apply严格执行journal→stage→Event→final并最终恢复healthy Root |
| `E-E3-30`–`E-E3-32` | Settlement、Candidate Retirement、Root Authority与Store | Event前CAS过期退休partial；Event前/后完整stage脱离source恢复；journal已退休重试返回healthy |
| `E-E3-33`–`E-E3-36` | Record Set Inventory、Reading Service、Read Context与Record Reader | Inventory删除重复Manifest loader；Reader先取得Event-backed healthy Authority |
| `E-E3-37`–`E-E3-39` | Record Reader、Record Plan与final tree | 容量、未知member、capability clone、opaque tree、无关/目标成员漂移及完整tree验证 |
| `E-E3-40`–`E-E3-45` | Publication Planning、Public Coordinator、Schema与MCP工具 | 四类恢复结果、Demand/plan绑定、recoverable错误、23工具双宿主与候选stdio测试 |

## 停止边界

- 当前文件Event Store只在单进程内按canonical Demand root串行append；跨进程竞争靠固定槽位硬链接与冲突检测。
- Repository load不写Snapshot；Snapshot发布必须由显式上层策略触发。
- Publication流程锁只保护首次Demand根跨资源发布；普通Event append不取得该流程锁。
- `evidence.record-managed-evidence`已经沿E3形成内部写入/读取闭包，并由`wakeflow_record_evidence`公开metadata-only记录。
- Manifest v1没有chunk/Merkle identity，不能把byte range描述为独立可验证Evidence内容。
- 公共入口分组没有改变Transaction、Event、恢复或Reader证明语义；当前完整门1023项全通过，Demand input反向依赖18文件/80项独立通过。
- A2已关闭TODO内部手动生命周期与Intake/State可达性；A4/A5已公开Inspection/Intake，A6已删除Demand独立Authority selectors。Auto Claim consumer仍缺失。
