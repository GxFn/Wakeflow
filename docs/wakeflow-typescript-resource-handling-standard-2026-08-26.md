# Wakeflow TypeScript 资源处理归一标准与收敛矩阵

> 创建日期：2026-08-26
> 当前状态：`confirmed-direction / RH-1-implemented / RH-2-implemented`
> 上位计划：[Wakeflow TypeScript 全新项目能力重构开发计划](./wakeflow-typescript-capability-reimplementation-development-plan-2026-08-25.md)
> 基础服务边界：[Wakeflow 全局基础服务需求](./wakeflow-foundation-services-requirement-2026-08-11.md)
> 用户决定：新 TypeScript 项目不把当前 JavaScript 文件形态视为标准；允许在保持产品能力与 authority 语义的前提下，收敛非必要的 Markdown authority、JSONL authority、重复 writer 和历史文件操作形态
> 实施边界：本文冻结目标标准和资源家族矩阵；不授权中途双写、兼容 wrapper、正式插件切换、旧文件删除、真实 workspace 迁移或 release

<a id="resource-standard-role"></a>
## 1. 文档职责与确认目标

本文为 Wakeflow 新 TypeScript 项目定义唯一资源处理标准。旧 `core/`、双插件制品、layout descriptor 和旧测试只用于确认产品事实、authority、失败与恢复需求，不自动取得新物理格式的决定权。

确认目标是：

1. 让每个本地资源都能唯一回答其 owner、authority role、representation、mutation recipe、coordination、recovery、mode 与 tracking；
2. 让全部领域 writer 复用有限的文件系统 primitive，而不是继续局部实现 `lstat/open/read/hash/write/rename/fsync`；
3. 取消不必要的 Markdown durable authority、JSONL durable authority和同类 standalone JSON 多种磁盘格式；
4. 保留 Config、Projection、Managed Integration Text 和 Manifested Tree 中确有产品价值的差异；
5. 不创建持有 current workspace、domain registry 或业务 transition 的 `FileManager`、storage adapter 或全局 service locator；
6. 通过真实垂直切片逐项落地标准，禁止先创建无 consumer 的通用 dispatcher。

本文所称“归一”同时包含两种动作：

- **机制统一**：稳定读取、exclusive create、exact source replace、tree publish、exact retire、lock/journal 的机械合同统一；
- **形态收敛**：把可由 deterministic JSON record、immutable event set 或 derived projection 表达的旧特殊文件形态改成标准形态。

<a id="resource-standard-non-goals"></a>
## 2. 非目标与硬边界

- 不把 filesystem primitive 升级为 domain authority。
- 不让 layout metadata 自动执行写入、恢复或清理。
- 不把 SQLite、MongoDB、对象存储或网络文件系统加入当前 runtime backend 抽象。
- 不把 host locator、raw handle、PID/process identity、socket 或真实 host effect 放入 host-neutral resource context。
- 不用 generic cleanup 根据文件名、mtime 或 PID 猜测 journal、stage、tombstone 可以删除。
- 不让 projection 缺失升级为业务 authority 丢失，也不让 projection 内容反向成为状态输入。
- 不把旧物理路径兼容分支带入 normal runtime；旧格式只由最终一次性 migration/cutover 解释。

<a id="resource-standard-layers"></a>
## 3. 标准分层

```text
Representation / Domain Codec
  解释内容、Schema、typed refs、跨字段关系和语义 digest
          ↓
Resource Role / Mutation Recipe
  决定是否可写、create/replace/publish、协调和恢复要求
          ↓
Filesystem Primitive
  执行 rooted admission、stable read、exact mutation、fsync 和 receipt
```

依赖方向只能向下。Filesystem primitive 不得 import layout、config、TODO、demand、host profile 或 public operation。

现有 `authority`、`owner`、`tracking`、`scope` 与 `createTiming` 继续描述产品职责；新的 resource role 和 mutation recipe 描述机械处理方式，两组字段正交，不能用其中一组反推另一组。

<a id="resource-standard-text"></a>
## 4. 统一文本与路径合同

Wakeflow 自有文本资源统一满足：

- well-formed UTF-8，拒绝 BOM、replacement character、lone surrogate 和隐式替换；
- NFC；
- LF-only；
- 恰好一个末尾 LF；
- 显式 byte、entry、depth 或 row 预算；
- stable read 返回 exact node、byte count、source digest；
- committed write 同步完整文件和 parent directory；
- 错误不回显绝对路径、原始内容、token、PID、handle 或系统异常 message。

路径分成四层，不合并：

1. portable resource ref：根内 canonical `/` 分段引用；
2. configured placement：允许明确的前导 `../` 指向 sibling root；
3. physical admission：逐段 no-follow、node identity、realpath、mode、owner 和容量；
4. write effect：在已准入 root/parent 下执行 exact mutation。

<a id="resource-standard-json"></a>
## 5. 唯一 standalone JSON 磁盘标准

所有 Wakeflow 自有 standalone JSON authority、record、receipt、journal、projection JSON 与 host-local JSON 统一使用：

```text
domain-validated model
→ fixed domain field order
→ JSON.stringify(value, null, 2)
→ one LF
```

并同时保存两种不同事实：

- `sourceDigest`：绑定磁盘 exact bytes；
- `semanticDigest`：绑定 RFC 8785 canonical JSON 语义。

约束：

- parser 必须先完成被动 JSON 数据准入和 Schema validation，再重建领域模型的固定字段顺序；
- writer 只能序列化领域 parser 签发的模型；
- reader 拒绝非 deterministic pretty representation，不自动重排或修复已有 authority；
- Schema 只拥有 portable structure/lexical contract；typed reference、集合关系、authority 与 state transition 继续由领域 owner 校验；
- compact canonical JSON 只用于 semantic digest、wire comparison 或显式协议，不再作为另一种普通 standalone 文件展示格式。

这使 `wakeflow.config.json` 不再是唯一 pretty JSON 特例，也消除 machine record 在 compact canonical 与 pretty JSON 之间的历史分裂。

<a id="resource-standard-roles"></a>
## 6. 七种资源角色

| Role | Authority 与 ownership | 标准 representation | Mutation recipe | Recovery |
| --- | --- | --- | --- | --- |
| `external-reference` | 外部 owner；Wakeflow 零写入 | 外部原格式 | `no-write` | 只报告 unsafe/missing，不修复 |
| `immutable-fact` | Wakeflow/domain whole-resource immutable authority | deterministic JSON；或显式 opaque document | `exclusive-create` | duplicate exact fact 幂等；冲突 fail closed |
| `mutable-snapshot` | 当前状态或可更新 singleton authority | deterministic JSON | `lock + exact-source-replace` | domain journal/reload 决定前向恢复 |
| `derived-projection` | 非 authority、可重建 view | Markdown 或 deterministic JSON | `deterministic-rewrite` | 从 authority 重建，不反向读取为状态 |
| `managed-integration-text` | external/mixed owner 或 host integration seam | strict managed text | `inspect-envelope + exact-source-recompose` | 只恢复 exact owned block/whole-file；保留 outside bytes |
| `manifested-tree` | manifest 绑定的完整文件树 | deterministic manifest JSON + opaque payload tree | `stage + verify + tree-publish/move` | manifest、inventory 与 source/target receipt 共同决定 |
| `transaction-artifact` | 某个 transaction owner 的 lock、journal、intent、stage、claim、tombstone | deterministic JSON、private stage 或 directory | `exclusive-create / exact-update / exact-retire` | 仅 owner 按 phase、node、digest 和 side-effect closure 恢复 |

目录本身不是第八种 authority role。目录是结构容器，统一使用 `materialize-directory`：

- 只创建缺失段；
- existing directory 只观察，不擅自 chmod；
- file/symlink/special collision fail closed；
- 创建后同步 parent；
- 子资源各自声明上述七种 role。

<a id="resource-standard-mutation"></a>
## 7. 有限 Mutation Recipe

| Recipe | 必要前置 | Commit | 成功证据 |
| --- | --- | --- | --- |
| `no-write` | stable read/inspection | 无 | frozen observation |
| `exclusive-create` | target absent、real parent、完整 bytes | private stage → no-replace publish | final node + source/semantic digest + parent sync |
| `exact-source-replace` | stable old resource path + node + byte count + source digest + domain lock | private stage → rename | complete old source、new node/digest、parent sync |
| `deterministic-rewrite` | validated authority snapshot + pure renderer | exact source replace | projection digest + authority basis digest |
| `exact-source-recompose` | stable complete old bytes + exact owned envelope | preserve outside → render owned component → exact source replace | outside digest + owned digest + final digest |
| `tree-publish/move` | bounded complete inventory + manifest + target admission | same-filesystem rename；跨设备显式 copy/verify/cleanup | source/target inventory、manifest、目录同步、残留结论 |
| `exact-retire` | exact owner receipt + expected node/digest/phase | unlink/rename exact target | pathname absent/detached、remaining link facts、parent sync |

`lock` 与 `journal` 是 recipe 的 coordination wrapper，不是另一种数据存储方式。Node 不提供 portable compare-and-unlink/renameat2/openat，任何 pathname-based 最终 effect 都不得被描述为恶意同权限进程下的 OS sandbox。

本机短锁统一使用 exclusive-create 的 deterministic record，owner identity 至少包含
PID、Worker thread ID 与不可预测 token。同一 process/thread 由进程内 active-token
集合判定 `active|inactive`；其他线程或进程只按 process existence 保守返回
`active|unknown`。不得根据 age/mtime 自动夺锁；只有领域 journal 已准入且 lock 的
record、digest、inode 与 inactive observation 全部仍 exact 时，才能执行 exact retire。

<a id="resource-standard-aggregate"></a>
## 8. 标准 Aggregate 目录语法

领域 aggregate 按真实需要选择槽位，不创建 placeholder：

```text
<aggregate-root>/
├── identity.json          # immutable-fact
├── authority.json         # immutable-fact，可选
├── state.json             # mutable-snapshot，可选；非 Event Sourced aggregate
├── event-sourcing/        # Event Sourced aggregate 可选
│   ├── commits/           # 一次 append 一个 immutable commit batch
│   ├── snapshots/         # 按 commitSequence 的 immutable derived checkpoint
│   └── append-candidates/ # 非权威 publication source；健康状态为空
├── artifacts/             # immutable-fact / manifested-tree，可选
├── transactions/          # transaction-artifact，可选
└── index.md               # derived-projection，可选
```

统一约束：

- identity 和 authority 创建后不可被普通 state writer 替换；
- 非 Event Sourced aggregate 的 current state 是唯一 mutable snapshot，不复制到 event、projection 或 host-local registry；
- Event Sourced aggregate 以 event stream 为可变状态唯一 authority，snapshot 只能是可删除、可重建的 checkpoint；
- history 使用一次 atomic append 一个 immutable commit JSON 文件；一个 commit 可以承载同一 command 产生的多个连续事件；
- `commitSequence` 形成物理 no-replace CAS 槽位，事件继续拥有逻辑 stream revision 与 typed event ID；
- commit continuity、previous commit digest、event upcasting 和 state reduction 由 aggregate owner 验证；
- Markdown 只作为 projection；
- transaction artifacts 不进入业务 history，也不被普通 tree scanner 当作完成事实。

<a id="resource-standard-todo"></a>
## 9. TODO Authority 收敛

目标布局：

```text
.wakeflow-active/current/todo/
├── items/
│   └── item-<sha256(todoId)>/
│       ├── intake.json
│       └── state.json
├── transactions/
└── global-todo-board.md
```

| Resource | Role | 说明 |
| --- | --- | --- |
| `intake.json` | `immutable-fact` | 原 13 列中的稳定 intake、owner、documents、auto-claim 与 testing decision |
| `state.json` | `mutable-snapshot` | pending/parked/claimed/blocked/observing/completed/cancelled/archived、mount、revision 与 previous digest |
| `transactions/*` | `transaction-artifact` | append/claim/archive 的 immutable expected/target plan 与 recovery evidence；不保存 mutable phase |
| `global-todo-board.md` | `derived-projection` | 确定性重建的人类/Agent 视图，不再是 durable authority |

collection digest 可以继续作为 `expectedBoardDigest`，但由 exact item inventory、intake/state semantic digest 和确定排序计算，不再等于 Markdown source digest。

公开 TODO ID 保持 opaque lexical identity；目录名使用完整 SHA-256 storage key，避免冒号等合法 ID 字符变成跨平台文件名问题，读取时必须用 `intake.todoId` 反向核对 key。

RH-1 已删除 Markdown row 反向 parser 与 Markdown authority service。Projection 只接受已验证 intake/state collection 并单向转义渲染，不定义第二套 TODO 输入协议。

<a id="resource-standard-demand"></a>
## 10. Demand Core 收敛

目标布局：

```text
<demand-root>/
├── identity.json
├── authority.json
├── event-sourcing/
│   ├── commits/
│   │   └── <16-digit-commit-sequence>.json
│   ├── snapshots/
│   │   └── <16-digit-anchor-commit-sequence>.json
│   └── append-candidates/
├── artifacts/
├── transactions/
└── index.md                 # 后续 derived projection，可选
```

收敛决定：

- `controller-events.jsonl` 不进入新标准；事件作为 immutable append-commit 中的关闭记录持久化；
- Demand Core 采用有界完整 Event Sourcing；immutable event stream 是可变业务状态的唯一 authority；
- command Owner 只产生不含 revision/predecessor/state digest 的过去式 uncommitted event；Command Handler 固定执行 `load → decide → evolve → expected-cursor append`；
- File Store 只接受当前进程经完整 evolve 签发的 prepared-commit capability；磁盘 commit、journal JSON 或自造对象不能直接取得 append authority；
- 固定 commitSequence 文件的 durable no-replace link 是业务提交点；candidate-only 明确回滚，target 已存在只能 exact idempotent 或 concurrency conflict；
- 该提交语义限定于 Wakeflow 支持的可靠本地文件系统；不把 Node `O_EXCL`/hard-link 行为扩张为 NFS 或其他共享网络文件系统上的分布式一致性；
- 当前 File Event Store 在读取 payload 前先执行 10,000 commits、16 MiB/commit 与 64 MiB/stream 的 metadata capacity gate；
- snapshot 按 commitSequence immutable 发布；正常 load 使用最新兼容 snapshot + tail，load 本身只读，显式 `audit()` 才从 commit 1 完整验证；
- `identity.json` 与 mandatory `authority.json` 是 immutable facts，普通 Demand 不存在 authority-pending publication；
- Event Sourcing 只应用于 Demand Aggregate；Tasking、Delivery、Result、Testing、Review、Lifecycle 与 Pod 作为同一 stream 的 Owner，不各建事件流；
- TODO、Config、Ledger、Transport、Evidence 内容与 Archive/Preservation 事务继续使用各自 immutable fact、snapshot、journal 或 projection，不因文件名含 event/history 就 Event Source；
- `schemaVersion` 版本化公共 event envelope，`eventType + eventVersion` 通过显式 upcaster registry 路由；历史 event 不原地修改；
- pure event append 不使用 stream lock 或 append journal；跨 TODO/Ledger/root 及独立 artifact 的 Owner 才保留 self-contained transaction；
- task package、target result、review candidate、test card、Pod request/handoff 是 immutable facts；
- evidence 是 manifested tree；
- Markdown 是 projection。

RH-2 当前只实现可验证骨干和两个真实事件：`publication.demand-published.v1`
创建 revision 1，`lifecycle.demand-cancelled.v1` 验证 revision 2 append。各业务
section 真实保持零事实，后续由对应 Owner 垂直切片逐项扩展，不预留 generic
extension bag、patch 或 callback registry。

<a id="resource-standard-modes"></a>
## 11. Mode、Tracking 与可执行位

| Scope | File | Directory |
| --- | --- | --- |
| tracked/shareable | `0644` | `0755` |
| ignored/runtime-private | `0600` | `0700` |

额外规则：

- 普通 authority、record、projection、journal、lock 和 manifest 不得带 executable bit；
- executable file 只允许显式 host asset/tooling artifact profile，并由 manifest 单独声明；
- existing directory 不因本次 materialization 被自动改 mode；
- source owner policy由部署平台合同决定；POSIX current-euid 检查不能伪装成 Windows ACL 证明；
- tracking 与 privacy 正交：tracked 文件仍不得包含 token、thread/session handle、PID、socket 或绝对本机路径。

<a id="resource-standard-family-matrix"></a>
## 12. 双宿主完整资源家族矩阵

当前 Codex layout 的 `122` 项、Claude Code layout 的 `143` 项可被以下 12 个互斥 family matcher 完整覆盖；Claude 多出的 `21` 项全部来自 host settings、locator、activity、temp 和 asset surface。该计数证明旧资源调查闭合，不表示旧 path 或 lifecycle 被新标准保留。

| Family | Codex | Claude | 当前 key 范围 | 新标准收敛 |
| --- | ---: | ---: | --- | --- |
| Workspace | 3 | 5 | `workspace.*` | config → mutable snapshot；memory/gitignore/settings → managed integration |
| Active | 6 | 6 | `active.*`、`event.active.*` | roots → containers；index/status/TODO board → projections；projector lock → transaction artifact |
| Local Core | 2 | 2 | `local.root`、`local.runtime` | private containers |
| Maintenance | 7 | 7 | `local.maintenance.*`、`event.maintenance.*` | journal/claim → transaction JSON；lock/stage → transaction artifact |
| Transport | 9 | 9 | `local.shared.transport.*`、`event.transport.*` | group/packet/envelope/run → immutable JSON facts；directories → containers |
| Coordination | 2 | 2 | `local.shared.coordination.*`、`event.coordination.*` | window lease → mutable snapshot；directory → container |
| Audit | 5 | 5 | `local.audit.*`、`event.audit.*` | preservation → manifested tree；manager lock → transaction artifact |
| Demand | 37 | 37 | `event.demand.*` | standard aggregate；JSONL/Markdown authority 收敛为 immutable events + projections |
| Host Runtime | 25 | 35 | `local.host.*`、`event.identity/pod/keep-live/host.*` | binding/locator/process/control → snapshots；receipts/events → immutable facts；assets → projection/managed integration；temp/locks → transaction artifacts |
| Ledger | 18 | 18 | `ledger.*`、`event.ledger.*` | requirement/confirmation/archive → immutable record or manifested tree；indexes → projections |
| Support | 7 | 13 | `support.*` | root/capability dirs → containers；memory/gitignore/settings → managed integration；draft/harness/fixture descendants由对应 surface owner 管理 |
| Repository | 1 | 4 | `repository.*` | root → external reference；gitignore/settings → only when explicitly authorized managed integration |

调查期 family matcher 固定如下；它们只证明旧 layout inventory 已被完整审阅，不作为新 path 兼容规则：

| Family | Exact matcher |
| --- | --- |
| Workspace | `^workspace\.` |
| Active | `^(?:active\.|event\.active\.)` |
| Local Core | `^local\.(?:root|runtime)$` |
| Maintenance | `^(?:local\.maintenance\.|event\.maintenance\.)` |
| Transport | `^(?:local\.shared\.transport\.|event\.transport\.)` |
| Coordination | `^(?:local\.shared\.coordination\.|event\.coordination\.)` |
| Audit | `^(?:local\.audit\.|event\.audit\.)` |
| Demand | `^event\.demand\.` |
| Host Runtime | `^(?:local\.host\.|event\.(?:identity|pod|keep-live|host)\.)` |
| Ledger | `^(?:ledger\.|event\.ledger\.)` |
| Support | `^support\.` |
| Repository | `^repository\.` |

完整性规则：

- 每个 layout key 必须命中且只命中一个 family；
- 每个 concrete file/tree 必须声明且只声明一个 resource role 和 mutation recipe；
- directory container 必须声明 child ownership，不得因 Wakeflow 创建目录就取得 descendants authority；
- host-neutral family 不得从 host-only key 或 path 反推宿主；
- unknown、multi-match 或 role/recipe 不相容均为 build-time error。

<a id="resource-standard-convergence"></a>
## 13. 当前形态的收敛处置

| 当前形态 | 目标处置 |
| --- | --- |
| compact canonical standalone JSON 与 pretty JSON 并存 | 收敛为 deterministic pretty JSON；canonical 仅作 semantic digest |
| TODO Markdown authority | 拆为 intake/state JSON authority + Markdown projection |
| controller event JSONL | 拆为 immutable event JSON collection |
| `event-fact` 同时表达多种物理写法 | 删除其 I/O 推断能力；由 resource role/recipe 明确处理 |
| 多个 owner 私有 `lstat/open/read/hash/write/rename/fsync` 骨架 | 迁移到 foundation primitives，领域保留 policy 和 error mapping |
| 多种 lock/stage/journal 文件名和局部清理规则 | 统一 transaction record vocabulary 与 physical stage primitive；具体恢复仍归 owner |
| Projection 与 authority 都用 whole-file rewrite | 共享 exact-source-replace primitive，但在 role、absence、recovery 和 consumer admission 上严格分开 |
| 可达的 generic append/region/file manager 设想 | 拒绝；只在真实 domain slice 中增加被证明必要的 primitive |

<a id="resource-standard-api-boundary"></a>
## 14. API 与 class/function 边界

- representation codec、role validation、path、digest、range、inventory、receipt comparison 使用纯函数；
- `RootedDirectory`、打开的 parent/resource handle、真实 host connection/pool 等持有可释放资源时使用 class；
- mutation recipe 使用命名清楚的 effect function，不使用 `execute(plan)` 万能 dispatcher；
- layout/resource descriptor 是冻结数据，不带写方法；
- domain owner 显式选择 primitive，并在自己的 lock/journal 内重读 authority；
- 不导出全局 current workspace、resource registry、storage backend 或可按字符串动态执行写入的 manager。

<a id="resource-standard-validation"></a>
## 15. 测试决定与证据矩阵

当前阶段不执行真实 WakeWorkspace 或 host session 测试。标准通过以下证据逐步落地：

1. foundation contract test：稳定读取、no-follow、node/digest、mode、容量、竞态、fsync、receipt；
2. recipe contract test：create、exact-source replace、projection、managed merge、tree publish、exact retire；
3. domain consumer test：至少一个真实 owner 使用该 recipe，证明 domain error、lock、journal 和 recovery 未被抽象削弱；
4. old baseline golden：只比较对外功能和语义事实，不冻结旧物理格式；
5. matrix gate：Codex/Claude concrete descriptor 均零 unknown、零 multi-match、零 illegal role/recipe；
6. architecture gate：domain 不直接 import `node:fs`，foundation 不反向依赖领域或 host；
7. cutover 前 Test：候选双制品、migration、disposable WakeWorkspace、crash recovery、全仓门。

无效结论：旧 Markdown/JSONL byte golden 不再用于证明新格式错误；只保留其中的业务字段、顺序、lineage、stale-expectation、恢复和公开结果不变量。

<a id="resource-standard-slices"></a>
## 16. 垂直实施顺序

### RH-1 TODO Intake Aggregate

状态：`implemented`（尚未进入插件 cutover）。

- 在同一切片中实现 resource role vocabulary 的首个真实 consumer；
- JSON intake + state authority、collection digest、claim/archive transaction、Markdown projection；
- 删除新 TS Markdown authority service 的最终 owner 地位，不建立双写；
- 验收 duplicate、stale expectation、并发、projection rebuild、claim/archive recovery。

### RH-2 Demand Core Aggregate

状态：`implemented`（尚未进入插件 cutover）。

- 新 Ledger Requirement/Confirmation authority Store 闭合 immutable publish、reload、member reference 与 exact resolution；
- Ledger publication journal 使用 canonical base64url 保存 bounded exact record/member bytes，可在没有原调用方输入时自主恢复；Demand Authority 只消费 Ledger 批量 canonical resolver，不重复实现 member closure；
- Demand identity 绑定 JSON TODO intake lineage；mandatory authority 解析完整 Ledger role/testing/placement closure，删除旧 `entryMode`；
- immutable append-commit collection 替代 JSONL，使用 typed `demand-event-commit` ID、连续 commitSequence、事件 revision 与 commit digest chain；
- pure Decider/evolve 生成 uncommitted events 与 `DemandAggregateState`；stored envelope 位置字段只由 Command Handler/Store 分配；
- File Event Store 以具名 durable candidate → fixed no-replace commit 建立提交点，不创建 stream lock 或 pure append journal；
- Repository 正常使用 immutable snapshot + tail，独立 audit 完整 replay；snapshot 损坏回退且普通 load 零写入；
- Demand Publication 使用 sidecar + in-root marker + durable stage rename + exact TODO claim，覆盖 sidecar-only、published-root 和 TODO transaction crash prefix；
- append candidate recovery 只回滚 inactive candidate-only 或清理已提交 exact linked pair；active/unknown owner 保留；
- 当前跨资源锁顺序固定为 per-demand publication lock → TODO collection lock；Event Store 使用 optimistic no-replace，不取得 stream lock；
- focused 新 TS 测试验收 commit gap/digest/transition、expected cursor、snapshot fast path/full audit、candidate crash prefix、Ledger conflict 与 publication closure。

### RH-3 Layout Resource Matrix

- config + supplied host profile 编译 new resource role/recipe descriptor；
- 双宿主 concrete matrix gate；
- 不执行写入，不缓存 current workspace。

### RH-4 Managed Integration Text

- program/repository/support memory、gitignore、settings；
- whole-file 与 managed-block 都复用同一 envelope/exact-source foundation；
- outside bytes、owner、marker digest 与 recovery 保持领域闭合。

### RH-5 Manifested Evidence/Archive Tree

- bounded inventory、manifest、same-filesystem publish、跨设备 fallback、exact source retirement；
- evidence、preservation、business archive 至少各一个真实 consumer。

### RH-6 Public/Host/Packaging Convergence

- public operation context、diagnostics/redaction、host runtime；
- Ajv standalone、双制品 builder、closed source/package manifest；
- 最终 migration/cutover 删除旧 physical authority 与 compatibility surface。

每个切片继续按单文件 review 节奏实施；不能把 RH-1～RH-6 变成一次性批量代码生成。

<a id="resource-standard-acceptance"></a>
## 17. 完成定义

本标准完成实施时必须同时满足：

1. 新 TS runtime 不存在 Markdown 或 JSONL durable authority；
2. 全部 standalone JSON 使用同一 deterministic pretty profile；
3. 每个 concrete resource 恰好一个 family、role、representation、recipe、owner 和 recovery policy；
4. 所有 write-capable domain 只通过 foundation primitives effect 文件系统；
5. projection、managed integration、manifested tree 与 external reference 的差异明确且不能互相冒充；
6. TODO、Demand、Transport、Window、Pod、Ledger、Evidence、Archive、Host Runtime 和 Tooling 全部进入矩阵；
7. 双宿主 matrix、validator、smoke、packaging、migration 和 disposable workspace 验证闭合；
8. 旧 runtime 与旧物理格式在整体切换后删除，没有 normal compatibility wrapper 或双写。

<a id="resource-standard-decisions"></a>
## 18. 已确认决定

| ID | 决定 | 状态 |
| --- | --- | --- |
| RHS-01 | 当前 JavaScript 文件形态只作为事实，不作为新标准 | `confirmed` |
| RHS-02 | 允许收敛非必要 Markdown authority、JSONL authority 和重复 writer | `confirmed` |
| RHS-03 | standalone JSON 统一 deterministic pretty bytes；RFC 8785 继续拥有 semantic digest | `confirmed` |
| RHS-04 | TODO 改为 JSON intake/state authority + Markdown projection | `confirmed` |
| RHS-05 | Demand events 改为一次 append 一个 immutable commit JSON；commit 内保留逐事件关闭记录，不保留 JSONL authority | `confirmed / revised-after-review` |
| RHS-06 | 不建立 FileManager、storage backend abstraction 或 current workspace registry | `confirmed` |
| RHS-07 | 标准按真实 consumer 垂直落地；RH-1 TODO Intake Aggregate 是首个切片 | `confirmed / RH-1-implemented` |
| RHS-08 | Demand Core 采用有界完整 Event Sourcing；event stream 是可变状态唯一 authority，snapshot 是 derived checkpoint | `confirmed / RH-2-implemented` |
| RHS-09 | Event Sourcing 仅用于 Demand Aggregate；其内部 Owner 共用一条 stream，其他资源按各自 role 处理 | `confirmed / RH-2-implemented` |
| RHS-10 | snapshot 是按 commitSequence 的 immutable optimization；load 使用 snapshot + tail 且零写入，显式 maintenance 发布，audit 完整 replay | `confirmed / revised-after-review / RH-2-implemented` |

<a id="resource-standard-sources"></a>
## 19. 主要事实来源

- [当前 layout descriptor](../core/scripts/lib/wakeflow-layout-descriptor.mjs)：旧资源 key、authority、lifecycle、owner、tracking、scope 与 create timing 的事实来源；Codex 当前得到 122 项，Claude Code 当前得到 143 项。
- [Codex host profile](../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs) 与 [Claude Code host profile](../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs)：21 项 host-only 差异的来源。
- [当前 TODO owner](../core/scripts/lib/wakeflow-todo-service.mjs)：Markdown authority、整板 CAS、claim/archive lineage 与 board lock 的旧行为基线。
- [当前 Demand records](../core/scripts/lib/wakeflow-demand-core-records.mjs) 与 [state transaction owner](../core/scripts/lib/wakeflow-demand-state-service.mjs)：JSONL validation、event/state relation、journal 顺序和整文件 event-log CAS 的旧行为基线。
- [当前 managed content owner](../core/scripts/lib/wakeflow-managed-content.mjs)：marker、outside bytes、managed block、whole-file、stage 与 recovery 不可被 generic text region 取代的证据。
- [新 Rooted filesystem](../src/foundation/filesystem/rooted-directory.ts)、[atomic file write](../src/foundation/filesystem/durable-atomic-file-write.ts) 与 [exclusive lock](../src/foundation/filesystem/rooted-exclusive-file-lock.ts)：已实现的底层 mechanical effect。
- [新 Config Authority Snapshot](../src/configuration/wakeflow-config-authority-snapshot.ts)、[Artifact Tree Identity](../src/foundation/artifact/loaded-artifact-tree-identity.ts)、[TODO authority reader](../src/governance/todo/todo-collection-authority.ts) 与 [TODO collection service](../src/governance/todo/todo-collection-service.ts)：首批真实 consumer。
- [Demand Decider](../src/governance/demand/event-sourcing/demand-event-sourcing-decider.ts)、[append commit](../src/governance/demand/event-sourcing/demand-event-stream-commit.ts)、[File Event Store](../src/governance/demand/event-sourcing/demand-file-event-store.ts)、[Repository](../src/governance/demand/event-sourcing/demand-event-sourcing-repository.ts) 与 [Publication process](../src/governance/demand/publication/demand-event-sourcing-publication-service.ts)：RH-2 command、event authority、snapshot-tail/full-audit、candidate recovery 和 TODO-backed publication 的实现。
- [Microsoft Event Sourcing pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)、[Kurrent stream/append semantics](https://docs.kurrent.io/getting-started/concepts)、[Axon snapshotting](https://docs.axoniq.io/axon-framework-reference/development/snapshotting/) 与 [Git immutable object/ref CAS](https://git-scm.com/docs/gitdatamodel.html)：本轮根本重设计的外部标准依据。
- [新 Ledger Authority Store](../src/governance/ledger/ledger-authority-store.ts) 与 [self-contained publication](../src/governance/ledger/ledger-record-publication.ts)：Demand mandatory Authority 的 Requirement/Confirmation immutable producer、批量 member resolver 与无调用方字节恢复。
