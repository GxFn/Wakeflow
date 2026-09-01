---
diagramId: ts-configuration-workspace-runtime-r0
viewType: runtime-call-sequence
truthKind: current-code
reviewDepth: L4
verifiedAt: 2026-09-01
snapshotObservedAt: 2026-09-01T06:42:28-07:00
baselineCommit: d17602ed9931a1898f713c740752c54b94bd8086
sourceFingerprint: sha256:b6dd57a06e70a41b33cb1e7e678e82b73fe85e97f93417b2ef4af42790377a27
audience:
  - maintainer
  - reviewer
documentationOwner: Wakeflow Source Maintenance
generatedBy: manual
refreshTriggers:
  - src/configuration/**
  - src/workspace/maintenance/**
  - src/workspace/window-runtime/**
sourcePaths:
  - src/configuration/**
  - src/workspace/maintenance/**
  - src/workspace/window-runtime/**
testPaths:
  - tests/configuration/**
  - tests/workspace/maintenance/**
  - tests/workspace/window-runtime/**
---

# Configuration 与 Workspace：Config、Maintenance与Binding运行时流程

> 三张图分别回答配置权威如何读取/替换、Maintenance如何从preview进入可恢复事务、以及私有
> Window Binding如何注册并派生脱敏投影。它们共享Foundation根作用域与原子能力，但状态权威互不替代。

## R0：Config权威读取、条件替换与恢复

```mermaid
sequenceDiagram
  accTitle: Wakeflow Config v3权威读取条件替换与恢复
  accDescr: Config snapshot稳定读取wakeflow.config.json并解析唯一v3模型和摘要；替换职责在Config专属短锁内重新读取当前权威，目标相同则幂等返回，否则使用完整稳定源预期原子替换；显式恢复先证明当前配置仍匹配调用方预期或目标，再处理非活动锁与stage残留。

  autonumber
  participant OWNER as Config职责所有者
  participant SNAPSHOT as readConfigAuthoritySnapshot
  participant MODEL as Config v3模型/文档
  participant LOCK as Config专属短锁
  participant REPLACE as replaceConfigAuthority
  participant ATOMIC as Foundation原子替换
  participant RECOVER as replacement recovery

  OWNER->>SNAPSHOT: E-R0-01 读取wakeflow.config.json
  SNAPSHOT->>MODEL: E-R0-02 严格文本 + deterministic JSON + parseWakeflowConfigV3
  MODEL-->>SNAPSHOT: model / indexes / configDigest / StableFileSource
  SNAPSHOT-->>OWNER: 单次操作范围Config snapshot

  OWNER->>REPLACE: E-R0-03 target Config + source snapshot
  REPLACE->>LOCK: E-R0-04 获取Config短锁
  LOCK->>SNAPSHOT: E-R0-05 锁内重新读取当前权威
  alt 当前摘要已等于目标摘要
    REPLACE-->>OWNER: current（零写入）
  else 当前仍匹配完整source预期
    REPLACE->>MODEL: E-R0-06 渲染唯一v3文档
    REPLACE->>ATOMIC: E-R0-07 replace(expected = current StableFileSource)
    ATOMIC-->>REPLACE: replaced + 最终节点/摘要
    REPLACE-->>OWNER: replaced
  else 当前已变化
    REPLACE-->>OWNER: conflict / stale source
  end

  opt 发现非活动锁或stage残留
    OWNER->>RECOVER: E-R0-08 expected source/target + recovery请求
    RECOVER->>SNAPSHOT: E-R0-09 证明当前Config仍是source或target
    RECOVER->>LOCK: E-R0-10 退休可证明非活动的旧锁
    RECOVER->>ATOMIC: E-R0-11 恢复目标相关stage
    RECOVER-->>OWNER: recovered / current / recovery-required
  end
```

### 本图术语说明

| 图中术语 | 解释 |
| --- | --- |
| Config snapshot | 模型、索引、语义摘要、确定文档和完整稳定文件源的冻结组合；返回后可能过期 |
| 唯一v3文档 | 从已验证模型按固定字段顺序渲染的 deterministic pretty JSON |
| Config专属短锁 | 只覆盖当前值检查和单次替换/恢复的RootedExclusiveFileLock，不是长期租约 |
| `current` | 当前权威已等于目标，未执行文件写入的幂等结果 |
| 完整source预期 | snapshot签发的路径、节点、字节数和摘要，用作原子替换CAS条件 |
| 非活动残留 | 可证明旧owner不再活动的lock/stage；证据不足时保持不动并要求恢复 |

### R0边级证据

| 边编号 | 代码位置 | 测试重点 |
| --- | --- | --- |
| `E-R0-01`、`E-R0-02` | `wakeflow-config-authority-snapshot.ts` | 缺失、权限、格式、Schema、关系、表示漂移与摘要 |
| `E-R0-03`–`E-R0-07` | `wakeflow-config-authority-replacement.ts` | 锁内重读、幂等、陈旧source、并发替换和原子发布 |
| `E-R0-08`–`E-R0-11` | `wakeflow-config-authority-replacement-recovery.ts` | source/target闭合、旧锁、stage恢复与不确定提交 |

## R1：Maintenance preview、apply与operation恢复

```mermaid
sequenceDiagram
  accTitle: Wakeflow Maintenance从零写入preview到可恢复transaction
  accDescr: 固定宿主facade接收公共请求；preview在RootedDirectory内读取current/desired Config并组合静态资源与宿主contribution，返回完整confirmation。apply重新准入confirmation和host profiles，transaction重新preview并比对plan摘要，创建operation ID、immutable intent和prepared journal，在唯一gate内逐step执行和checkpoint。recover只凭operation ID、磁盘记录与固定capability继续同一事务。

  autonumber
  participant CLIENT as MCP调用方
  participant PUBLIC as Maintenance公共协调器
  participant FACADE as 固定宿主facade
  participant PREVIEW as execution preview
  participant GATE as Maintenance gate
  participant TX as execution transaction
  participant INTENT as immutable intent store
  participant JOURNAL as checkpoint journal store
  participant STEP as 静态/宿主step owner

  CLIENT->>PUBLIC: E-R1-01 preview(root, action, desiredConfig?)
  PUBLIC->>FACADE: E-R1-02 preview(RootedDirectory, request)
  FACADE->>PREVIEW: E-R1-03 合并共享静态步骤与宿主contribution
  PREVIEW->>PREVIEW: 读取current/desired Config、Profile和资源矩阵
  PREVIEW-->>PUBLIC: ready/blocked plan + planDigest
  PUBLIC->>PUBLIC: E-R1-04 创建confirmation与可选launchIntentSet摘要
  PUBLIC-->>CLIENT: 零写入preview结果

  CLIENT->>PUBLIC: E-R1-05 apply(confirmation, confirmationDigest)
  PUBLIC->>PUBLIC: E-R1-06 复验canonical confirmation与固定host profiles
  PUBLIC->>FACADE: E-R1-07 apply(root, exact plan/request)
  FACADE->>TX: E-R1-08 executeTransaction
  TX->>PREVIEW: E-R1-09 重新派生plan并比较planDigest
  TX->>TX: E-R1-10 核对source/desired Config并分配operation ID
  TX->>INTENT: E-R1-11 no-replace发布exact intent
  TX->>JOURNAL: E-R1-12 no-replace发布prepared journal
  TX->>GATE: E-R1-13 取得operation唯一gate并再次重验

  loop 每个exact step
    TX->>JOURNAL: E-R1-14 checkpoint → affected
    TX->>STEP: E-R1-15 执行领域owner并读回
    STEP-->>TX: step receipt
    TX->>JOURNAL: E-R1-16 checkpoint → completed/next
  end
  TX->>JOURNAL: E-R1-17 terminalize
  TX-->>PUBLIC: completed/no-op/recovered receipts
  PUBLIC-->>CLIENT: 脱敏结果 + launch intents（不执行宿主效果）

  opt 进程重启或recovery-required
    CLIENT->>PUBLIC: E-R1-18 recover(root, operationId)
    PUBLIC->>FACADE: recover(root, operationId)
    FACADE->>TX: recoverTransaction
    TX->>INTENT: E-R1-19 读取并重建exact plan/request
    TX->>JOURNAL: E-R1-20 读取checkpoint并验证唯一事务前缀
    TX->>GATE: E-R1-21 退休相关非活动gate并取得同一operation gate
    TX->>STEP: 从稳定checkpoint继续或读回affected step
  end
```

### 本图术语说明

| 图中术语 | 解释 |
| --- | --- |
| 固定宿主facade | Codex或Claude Code入口提供的Host Profile、capability和preview/apply/recover函数集合 |
| shared static step | 所有宿主共享的Config、Active、Support、Managed、Host/Window布局物化步骤 |
| host contribution | 某宿主额外提供的静态设置或操作，必须合并进同一exact plan |
| `planDigest` | 对完整preview计划的语义摘要；apply前重新派生后必须完全一致 |
| launch intent | 返回给Agent/宿主执行的窗口启动意图；Maintenance本身不创建窗口 |
| prepared journal | intent已存在、尚未尝试第一个step的初始checkpoint |
| affected step | 已记录“即将尝试”但尚未写入稳定完成checkpoint的步骤，恢复时必须先读回 |
| 唯一事务前缀 | operation相关intent、journal和gate之外不存在无法解释的同operation资源 |

### R1边级证据

| 边编号 | 代码位置 | 测试重点 |
| --- | --- | --- |
| `E-R1-01`–`E-R1-04` | `maintenance-public-coordinator.ts`、`execution-preview.ts` | preview零写入、blocked/ready、Profile绑定、confirmation与launch摘要 |
| `E-R1-05`–`E-R1-10` | Public coordinator、Host execution、transaction | confirmation篡改、宿主错配、plan陈旧、Config变化和operation ID |
| `E-R1-11`–`E-R1-17` | intent/journal store、gate、step executor | no-replace、checkpoint单调性、并发gate、step读回和terminal结果 |
| `E-R1-18`–`E-R1-21` | `recoverWakeflowMaintenanceExecutionTransaction` | 只凭operation ID恢复、intent/journal不一致、affected step和orphan gate |

## R2：Window Host Binding注册与脱敏观察

```mermaid
sequenceDiagram
  accTitle: Wakeflow Window Host Binding首次注册和Agent观察闭合
  accDescr: 公共Binding协调器由固定宿主facade提供资源与身份Profile；registration authority准入Agent观察并派生私有Binding与未注册投影。Store在专属锁内恢复inventory，注册新Binding或幂等replay，然后独立发布registered projection。Binding成功后projection失败不会回滚私有权威。后续Agent观察必须与Binding、期望拓扑和Config逻辑根精确闭合，输出不含raw handle。

  autonumber
  participant AGENT as Agent/宿主观察
  participant PUBLIC as Binding公共协调器
  participant AUTH as registration authority
  participant STORE as 私有Binding store
  participant BINDING as 0600 Binding authority
  participant PROJECTION as registered projection
  participant OBS as Agent observation authority
  participant GOVERNANCE as Delivery / Testing消费者

  AGENT->>PUBLIC: E-R2-01 register(root, observation)
  PUBLIC->>AUTH: E-R2-02 固定Resource/Identity Profile后编译authority
  AUTH->>AUTH: 复验hostId、windowId、opaque handle与未注册投影
  PUBLIC->>STORE: E-R2-03 withBindingStore(authority)
  STORE->>STORE: 恢复stage/lock并读取完整inventory

  alt windowId已存在且身份完全相同
    STORE-->>PUBLIC: replay当前Binding
  else windowId不存在且handle未被占用
    STORE->>BINDING: E-R2-04 no-replace创建私有Binding
    BINDING-->>STORE: binding authority = current
  else ID或handle冲突
    STORE-->>PUBLIC: binding-conflict / handle-conflict
  end

  PUBLIC->>PROJECTION: E-R2-05 由当前Binding发布registered投影
  alt 投影不存在或仍为对应unregistered文档
    PROJECTION-->>PUBLIC: create/CAS replace后的脱敏projection
  else 投影含不相关内容
    PROJECTION-->>PUBLIC: projection-conflict；Binding保持current
  end
  PUBLIC-->>AGENT: registered/replayed + 脱敏projection；不返回raw handle

  GOVERNANCE->>OBS: E-R2-06 candidate observation + 当前Binding + desired topology
  OBS->>OBS: E-R2-07 闭合Host Profile、身份Profile、windowId与Config逻辑根
  OBS-->>GOVERNANCE: 脱敏AgentHostWindowObservationAuthority
```

### 本图术语说明

| 图中术语 | 解释 |
| --- | --- |
| opaque handle | 宿主用于再次定位窗口的私有不透明句柄；只写入0600 Binding，不进入投影或MCP结果 |
| registration authority | 把固定Profiles、Agent观察、windowId和未注册投影编译成闭合注册请求的内存事实 |
| Binding inventory | 当前宿主全部私有Binding的锁内一致视图，用于ID和handle唯一性判断 |
| replay | 相同windowId和注册身份已经存在时的幂等成功，不创建第二份Binding |
| unregistered projection | Fresh Window Runtime为尚未绑定宿主窗口的期望窗口创建的脱敏文档 |
| registered projection | 在unregistered文档基础上加入当前Binding脱敏事实后的派生文档 |
| observation authority | 候选Agent观察与当前私有Binding、Profile、期望窗口和Config根闭合后的治理输入 |

### R2边级证据

| 边编号 | 代码位置 | 测试重点 |
| --- | --- | --- |
| `E-R2-01`、`E-R2-02` | Public coordinator、`window-host-binding-registration-authority.ts` | Profile错配、观察结构、ID/handle准入和未注册投影绑定 |
| `E-R2-03`、`E-R2-04` | `window-host-binding-store.ts`、registration | 锁恢复、inventory、并发ID/handle冲突、no-replace与replay |
| `E-R2-05` | `window-runtime-registered-projection-publication.ts` | 只接受缺失或对应unregistered源、0600权限、CAS与失败不回滚Binding |
| `E-R2-06`、`E-R2-07` | `wakeflow-agent-host-window-observation-authority.ts` | 当前Binding、Host Profile、desired topology、逻辑根和脱敏handle fingerprint |

## 责任边界

- Configuration权威、Maintenance intent/journal、Window Binding和各投影分别拥有自己的写入与恢复边界。
- Public coordinator只返回脱敏结果；绝对路径、锁token、raw handle和异常栈不进入MCP结果。
- Maintenance launch intents与Agent observation authority都是执行平面输入，不会自行调用宿主API。
- Agent观察与共享协调布局已提交；后续路径变化仍必须刷新本文指纹。
