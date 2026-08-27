# Wakeflow TypeScript Post-RH-2 能力重新基线化审查

> 创建日期：2026-08-27
> 当前状态：`draft / NF-0-complete / INF-1-config-authority-lifecycle-complete / INF-2H-todo-resource-catalog-complete`
> Owner：Wakeflow Design
> 预期接收者：Wakeflow 用户与后续 Controller 规划
> 上位需求：[TypeScript 单一源码、双宿主制品与轻量测试需求](./wakeflow-typescript-dual-artifact-build-requirement-2026-08-24.md)
> 当前实施计划：[TypeScript 全新项目能力重构开发计划](./wakeflow-typescript-capability-reimplementation-development-plan-2026-08-25.md)
> 资源标准：[TypeScript 资源处理归一标准与收敛矩阵](./wakeflow-typescript-resource-handling-standard-2026-08-26.md)

> 本文是经用户明确要求留下的非权威 Design 审查草案。它记录代码与文档事实、
> 差异和候选切片，不因文件路径或 `draft` 状态取得需求、TODO、dispatch、acceptance、
> migration、release 或产品运行 authority。候选顺序必须经用户确认后才能回写上位计划。

<a id="rebaseline-purpose"></a>
## 1. 问题、目标与完成定义

### 1.1 问题

RH-1 与 RH-2 已经形成真实 TypeScript 垂直切片，但 RH-3～RH-6 仍主要按资源形态
粗分。最近的 Config 对照暴露出一个具体缺口：Config Schema、领域模型、文档 codec、
稳定 Authority Snapshot 和 placement admission 已经实现，而旧项目拥有的 fresh writer、
reconfigure owner、transition authority、maintenance composition 和 migration seam 没有被
准确安排到任何后续 RH 阶段。

若继续直接按早期编号开发，可能出现以下结果：

- 只根据旧文件名补 TS 模块，重新带入旧项目逐步叠加形成的复杂度；
- 只根据新 Foundation 能力补水平组件，形成没有真实 consumer 的 placeholder；
- 把 Config、Layout、Maintenance、Host 或 Demand 的相邻职责错误合并；
- 在 RH-6 或 E3 才发现缺失 writer、public entrypoint、host seam 或 recovery owner；
- 用“RH-2 implemented”误表示完整 Demand 产品能力已经覆盖。

### 1.2 用户确认的本轮目标

基于以下四类事实重新确认后续切片计划：

1. 当前旧项目的真实产品代码、入口、producer、consumer 和 effect；
2. 当前需求文档中的已确认产品合同、被替代结论和环境边界；
3. R1～R67 review 文档、review 方法、局部修复与基础候选处置过程；
4. 最近三次 TypeScript 开发提交、当前实现、测试证据和未覆盖范围。

### 1.3 本轮完成定义

本轮重新基线化完成需要：

- 为文档来源建立当前权威层级，不把历史方案当现行要求；
- 为旧 runtime 建立端到端能力、authority、producer/consumer 和 host seam 地图；
- 为当前 TS 建立已完成/部分完成/未开始矩阵；
- 记录旧事实与新资源标准之间的有意差异和未决差异；
- 形成按真实依赖排序的候选切片，而不是直接发布任务；
- 明确每个候选的 consumer、可观察结果、恢复边界和验证方式；
- 把仍需用户决定的顺序和边界标记为 HITL。

### 1.4 非目标与禁止捷径

- 本轮不修改产品代码、测试、Schema、插件制品或运行配置。
- 不把旧 JS 文件建立为逐文件迁移队列。
- 不把旧物理格式自动保留为新标准。
- 不创建 TODO、TaskPackage、dispatch、migration plan 或 release 记录。
- 不执行真实 WakeWorkspace、真实 Codex/Claude session、插件缓存或发布操作。
- 不把源码存在、测试存在、Schema 存在或插件打包存在等同于 production consumer 已接线。
- 不为保持 RH 编号表面稳定而隐藏真实依赖变化。

### 1.5 已确认的非业务建设策略

用户已确认后续先建设“机制驱动的非业务垂直切片”。这里的准确含义是：

- 非业务不等于无场景；每个切片仍需真实输入、effect、恢复、receipt和readback；
- Foundation不使用Demand、TODO、Review、Delivery、Pod等业务词汇；
- 旧业务只提供失败场景和验收约束，不决定Foundation API形状；
- 技术owner可以理解Config、Workspace、Managed Integration、Manifested Tree等资源职责，
  但不能决定业务acceptance、lifecycle或host effect结果；
- 不先造完整锁/事务/registry框架，而从多个非业务技术切片的共同事实反推最小共享合同。

后续工作改为五条明确轨道：

| 轨道 | 职责 | 当前状态 |
| --- | --- | --- |
| `FND-*` | 中立数据、路径、文件、时间、摘要、锁和mechanical effect | NF-0已完成；仅保留INF-3/4驱动的缺口 |
| `INF-*` | Config、Workspace Matrix、Managed Text、Manifested Tree、技术mutation/recovery | 下一阶段优先建设 |
| `DOM-*` | TODO、Demand、Tasking、Delivery、Review、Archive等业务能力 | RH-1/RH-2 Core已完成；暂缓新增业务事件 |
| `HOST-*` | Codex/Claude真实宿主ports与非对称effect | 尚未开始 |
| `REL-*` | public entrypoints、双制品、E3对比、E4迁移/切换 | 尚未开始 |

旧RH-1/RH-2继续作为历史实施identity；RH-3～RH-6不再作为必须保持编号的主序列。
新顺序由跨轨依赖图决定。

NF-0只允许审查、补充事实和确认边界。它的退出门是：每个现有Foundation能力都有
`complete | reinforce | consumer-needed | missing | reject`处置，所有missing项都有真实INF
consumer，且没有为了未来业务建立placeholder。

<a id="rebaseline-source-authority"></a>
## 2. 文档来源与权威分层

### 2.1 当前需求与实施权威

| 来源 | 当前职责 | 本轮使用方式 |
| --- | --- | --- |
| [初始化生成文件需求](./wakeflow-initialization-generated-files-requirement-2026-08-05.md) | D1～D41 产品合同、authority、目标树、迁移和环境边界 | 当前完整 v3 行为基线；物理形态允许被后续已确认资源标准修订 |
| [初始化 v3 开发基线](./wakeflow-initialization-v3-development-plan-2026-08-06.md) | M1A～M7A 实现落点、producer/consumer、测试与完成证据 | 识别当前旧实现的真实执行链和已知支持边界 |
| [全局基础服务需求](./wakeflow-foundation-services-requirement-2026-08-11.md) | R1～R67 review 事实、BFS-01～BFS-11 候选和抽象硬边界 | 提取跨模块事实；其 8 月 24 日状态需要与后续 TS 实现重新对账 |
| [TypeScript 需求](./wakeflow-typescript-dual-artifact-build-requirement-2026-08-24.md) | TS 单一手写源码、双生成制品、Schema 单向生成、轻量测试 | 新项目最终验收权威 |
| [TypeScript 开发计划](./wakeflow-typescript-capability-reimplementation-development-plan-2026-08-25.md) | E0～E4 阶段边界和当前进度 | 保留阶段门；后续切片顺序允许按本轮事实修订 |
| [资源处理标准](./wakeflow-typescript-resource-handling-standard-2026-08-26.md) | 资源 role、mutation recipe、RH-1/RH-2 和候选 RH-3～RH-6 | 新物理格式与机制收敛方向；早期后续编号不是绝对命令 |
| [宿主管理完整 Pod 需求](./wakeflow-host-managed-complete-pod-requirement-design-2026-07-31.md) | 主线优先、显式 Pod、宿主管理 worktree、双宿主真实差异 | 当前 Pod 产品合同与 host seam 基线 |

### 2.2 当前解释性与审计来源

| 来源 | 保留价值 | 限制 |
| --- | --- | --- |
| [本地信息权威重构需求](./wakeflow-local-information-authority-refactor-requirement-2026-08-04.md) | config/active/local/ledger/host 信息归属原则 | 其中 JSONL/Markdown 物理形态已被 TS 资源标准进一步收敛 |
| [硬化设计符合性审计](./wakeflow-hardening-design-compliance-2026-07-30.md) | identity、state、evidence、isolation、history 的机器门 | 部分 Pod 数量和 placement 已被 7 月 31 日 Pod 设计替代 |
| [执行手艺计划](./wakeflow-execution-craft-plan-2026-07-09.md) | Design/Target/Test 手艺与证据职责 | 不替代 runtime/state/authority 代码合同 |
| [表面积削减记录](./wakeflow-surface-reduction-2026-07-10.md) | 删除死状态、孤儿入口和重复事实的经验 | 只是当轮已执行收敛记录，不定义新 TS 模块结构 |

### 2.3 历史或被替代来源

以下文档只用于解释演进原因，不用于确认当前 Pod、容量、worktree 或公共表面：

- [架构深度解读](./wakeflow-architecture-deep-dive-2026-07-02.md)；
- [双版本架构与状态流](./wakeflow-dual-edition-architecture-and-state-flow.zh-CN.md)；
- [下一阶段路线图](./wakeflow-next-phase-roadmap-2026-07-02.md)；
- [多需求并行统一方案](./wakeflow-unified-multi-demand-plan-2026-07-10.md)；
- [本地存储清晰计划](./wakeflow-local-storage-clarity-plan-2026-07-04.md)。

这些来源中关于自动 isolated placement、全局 Design、Wakeflow 自建 worktree、数字 Pod
上限和旧公共工具数量的结论均不得回流新切片。

<a id="rebaseline-review-method"></a>
## 3. Review 方法与过程事实

### 3.1 既有 R1～R67 方法

全局基础服务 review 已建立并完成以下发现流程：

1. 从真实源码定义开始；
2. 反向搜索全部直接 caller、producer 和 consumer；
3. 交叉读取 Schema、writer、loader、host seam 和 focused test；
4. 构造 accessor、Proxy、hidden/Symbol、stale、TOCTOU、crash-prefix、容量和隐私反例；
5. 只修复范围明确的当前 bug，并把共同根因登记为 BFS 候选；
6. 不在 review 阶段提前创建 manager、registry、第二状态机或兼容 wrapper；
7. 使用中文职责导航记录已经实现的边界，不把注释写成未来设计；
8. 最终完成物理源码闭包、双宿主 parity、validator/smoke 和仓库级门。

R1～R67 的旧基线证据为：7910 个物理文件审计、482 份 MJS/CJS 语法检查、
1469 份 JSON、6 份 JSONL 共 58 条记录、6 个 shell launcher、零源码 symlink，
以及 1821 项旧仓库测试中的 1820 通过、1 个 Windows-only skip。该数字证明旧事实
发现面闭合，不证明新 TS 已经等价覆盖。

### 3.2 本轮采用的两轮方法

第一轮是全局闭包扫描：

- 建立需求、review、开发计划和历史文档的权威层级；
- 枚举当前 `core/`、公共入口、Schema、旧测试和双宿主 host-only 文件；
- 对旧 `core/scripts/lib`、MCP/CLI/setup/bootstrap 建立依赖图；
- 确认各能力的主要 authority、producer、consumer 与真实 effect owner。

第二轮是候选切片深读：

```text
公共入口
→ orchestration
→ domain owner
→ authority read
→ mutation/recovery
→ downstream consumer
→ focused / integration evidence
```

只有完整读取该链后，候选才能从 `discover` 进入待确认切片。只看到同名文件、export、
Schema 或测试文件不构成切片准入。

### 3.3 当前物理盘点

| 范围 | 当前事实 |
| --- | ---: |
| 旧 `core/scripts/lib` 共享模块 | 86 |
| 旧入口与核心依赖图 | 99 modules / 712 dependencies |
| 旧 portable Schema | 61 |
| 旧顶层测试 | 116 |
| Codex host-only 运行模块 | 6 |
| Claude Code host-only 运行模块 | 12 |
| 新 TS 手写 runtime 模块 | 110（Foundation 49、Configuration 9、Workspace 2、Governance 48、Codex Host 1、Claude Code Host 1） |
| 新 TS Schema / generated contracts | 24 / 24 |
| 新 TS 测试与 fixture builder 文件 | 82 |
| 最近完整 TS 门 | 205 modules / 1097 dependencies / 395 tests passed |

<a id="rebaseline-old-runtime"></a>
## 4. 旧项目真实运行模型

### 4.1 三个平面

当前旧项目不是单一状态机或单一文件服务，而是三个相互约束的平面：

| 平面 | 主要载体 | 职责 |
| --- | --- | --- |
| 判断平面 | Skills、AGENTS/CLAUDE memory、Controller/Design/Test/Target | 需求判断、执行方法、验收和人工决策 |
| 确定性合同平面 | records、services、orchestrations、MCP/CLI | identity、状态转换、证据闭包、幂等与公开错误 |
| 物理 effect 平面 | filesystem、workspace mutation、host adapters | 原子写入、锁、journal、恢复、宿主窗口和 transport effect |

新 TS 不能把判断平面写成状态机，也不能让 Foundation effect 层解释领域 acceptance。

### 4.2 公共入口与组合边界

当前正式入口包括：

- 31 项 MCP 工具的 `core/lib/wakeflow-mcp-tools.mjs`；
- `wakeflow-cli.mjs`；
- `wakeflow-setup.mjs`；
- explicit migration 的 `wakeflow-bootstrap.mjs`；
- Codex/Claude 各自的 host-only adapter/facade；
- validator、smoke、sync 和 release packaging 工具。

MCP 组合层区分三种权限面：

1. 普通 public-v3 domain operation；
2. fresh/reconfigure/reconcile maintenance；
3. Controller-owned evidence import。

三者都处理 root、context 和公开脱敏，但准入条件不同，不能合并为一个通用 dispatcher
或缓存 current workspace 的 service locator。

### 4.3 高扇入基础事实

旧运行图中主要高扇入模块为：

| 模块 | 旧内部 consumer 数 | 说明 |
| --- | ---: | --- |
| Canonical JSON | 72 | 几乎所有 record、plan、digest 和输入快照依赖 |
| Typed identifiers | 46 | 跨领域 durable identity 和 references |
| Config v3 model | 25 | topology、storage、host preference 和 public context |
| Workspace mutation | 24 | maintenance 与有界 runtime cross-owner effect |
| Host capability | 23 | shared capability contract 与 host applicability |
| Config snapshot | 19 | 每次操作的 workspace/config authority |
| Atomic write | 17 | 多个领域 owner 的单文件 visibility/CAS 基础 |
| Layout descriptor | 15 | initialize、maintenance、observability 和 migration |
| State/file locks | 15 | demand、projection、ledger、TODO 等局部协调 |

这些扇入只能用于确定审查优先级，不能从数量直接推导统一 API。

<a id="rebaseline-authority-map"></a>
## 5. 旧项目 Authority、Producer 与 Consumer 地图

| 能力域 | 主要 authority | 主要 producer | 主要 consumer | mutation/recovery |
| --- | --- | --- | --- | --- |
| Config | tracked `wakeflow.config.json` durable intent | fresh/reconfigure config owner | layout、maintenance、public runtime、delivery、window、host、observability | content-addressed stage、hard-link/rename、M3 participant、transition authority |
| Layout | config + host profile 编译的 descriptor | pure compiler | initialize、reconcile、observability、migration | 零写；owner-specific participant 执行 |
| TODO | `.wakeflow-active/current/global-todo-board.md` | TODO service、Demand publication、archive | Design intake、Controller claim、status | board lock、whole-file CAS、claim/archive recovery |
| Demand Core | identity、authority、state snapshot、JSONL transition audit | publication与五类 domain owner | delivery、review、lifecycle、Pod、archive、projection | state-root lock、journal、event→state、forward recovery |
| Demand Artifacts | immutable TaskPackage/TestCard/TargetResult/ReviewCandidate/Pod Design records | artifact service、Pod、result/review | delivery、Test、review、archive | demand state journal 内 create-only |
| Evidence | manifest + immutable payload tree | Controller evidence importer | state/review/archive | source scan、stage/tree publish、state journal recovery |
| Transport | group、packet、envelope immutable；run append-only | delivery/review orchestration | host send、result import、archive/retention | workspace gate、create/append、demand-root release participant |
| Window Binding | host-scoped current binding 与私有 handle | register/replace/decommission owner | delivery、lease、host lifecycle、Pod | workspace gate、exact replace/decommission |
| Window Lease | delivery coordination lease | delivery/lifecycle owner | send admission、result settlement、terminal transition | acquire/release、expired explicit recovery |
| Pod | demand logical state + immutable Pod evidence + binding | Pod service + host adapter | Controller/Design/Test/product routing、archive | demand journal、workspace gate、host receipt/recovery |
| Keep-live | per-run lease、process generation、control、manager lock | keep-live owner | automation/runtime host effect | reconcile、exact rollback/release；host effect在外层 |
| Ledger | requirement/confirmation/archive immutable record tree | promotion/confirmation/archive owners | Demand authority、navigation、archive | ledger lock、create-only stage、projection after authority |
| Active projections | Markdown navigation/status/progress | active projector | 人类、Agent、public views | projection lock或maintenance participant；非authority |
| Preservation | strict manifest + immutable payload hold | preservation owner | audit/release/migration/archive | workspace journal、publish/detach、explicit release |
| Business Archive | immutable archive record + detached current closure | archive service | ledger navigation、retention、history | Active双锁+demand lock、sidecar/tombstone、forward recovery |
| Managed integration | memory、gitignore、Claude settings/statusline | managed-content/support/host settings owners | installed host、repositories、support surfaces | inspect outside bytes、managed merge、M3 participant |
| Observability | 一次只读 owner facts 的签发组合 | observability composition | status/view/verify | 零写；不得由健康结论授权 repair/delete |
| Migration | classifier/inventory/plan/owner drain/phase composition | explicit bootstrap | one-time cutover | 唯一 M3 journal；normal runtime 不得 import |

<a id="rebaseline-critical-chains"></a>
## 6. 必须保留的端到端调用链

### 6.1 Workspace maintenance

```text
MCP/setup/CLI
→ maintenance coordinator
→ fresh | reconfigure | reconcile backbone
→ config/layout/local/support/managed/ledger/active/window/host owners
→ confirmed action composition
→ workspace mutation gate + journal
→ owner participant observe/prepare/commit/cleanup
→ terminal closure / recover
```

关键事实：三条 backbone 形状相似但 source admission、allowed owner、blocker 和 host
后果不同；旧 review 已明确拒绝抽成 base planner 或全局 Maintenance manager。

### 6.2 Demand 执行

```text
TODO / Controller publication
→ immutable Demand identity + authority
→ TaskPackage / TestCard
→ dispatch group + packet + envelope
→ window binding + lease
→ host send claim/effect/readback + delivery run
→ TargetResult import
→ ReviewCandidate
→ Controller decision
→ rework/redesign/accept
→ complete/cancel
→ BusinessArchive + transport retention
```

关键事实：旧实现把 state snapshot 与 JSONL event audit 共同维护；新 TS 已经确认改为完整
Demand Event Sourcing，因此后续不能逐字段移植旧 state reducer，而必须把同一业务事实重新
设计为 command、event、state evolution 和跨 owner effect。

### 6.3 Evidence 与 Archive

```text
configured external source
→ bounded/no-follow/privacy scan
→ manifested stage
→ immutable evidence tree publish
→ Demand event/state ref
→ result/review/completion closure
→ archive summary + ledger record
→ optional preservation / transport release
```

文件存在和 digest 只证明材料被记录且未变，不证明材料真实、测试通过或需求完成。

### 6.4 双宿主窗口与 Pod

```text
host-neutral launch intent
→ Codex project/worktree or Claude tmux/--worktree effect
→ host observation / final handle
→ binding
→ Claude locator（Claude-only）
→ Test access / delivery / close evidence
→ logical state acknowledgement
→ decommission
```

Codex archive 只能形成 manual-host-gate；Claude 可在 exact tmux identity 下形成 close +
bounded absence machine proof。不能为了共享接口伪造二者对称。

<a id="rebaseline-ts-progress"></a>
## 7. 最近 TypeScript 开发进度

### 7.1 提交历史

| Commit | 内容 | 规模 |
| --- | --- | ---: |
| `80c0c5c` | TypeScript Foundation baseline | 89 files / +21796 -110 |
| `42526bc` | Foundation 收敛、Config/Artifact、RH-1 TODO、RH-2 Demand/Ledger | 197 files / +38228 -2970 |
| `b49e3a5` | Event Sourcing version evolution | 32 files / +1581 -365 |

当前分支为 `main`，相对 `origin/main` ahead 3，工作树在本审查文档创建前为 clean。

### 7.2 已完成 Foundation

- passive own-data、dense array 与递归 frozen JSON value；
- RFC 8785 `canonicalize` 适配、deterministic pretty JSON；
- SHA-256、增量 hash、UTF-8、base64url；
- UUID v4、typed durable ID、UTC/wall/monotonic time、ByteCount；
- Ajv runtime Schema validation 和 Schema→TS 生成/漂移检查；
- portable path、RootedDirectory、node snapshot、exact resource/parent handle；
- stable file/directory/range/tree read 与 bounded scan；
- strict text / deterministic JSON file；
- atomic create/replace、directory materialization、candidate、link、settlement、rename、exact unlink；
- self-describing stage、durability recovery、rooted exclusive lock；
- Artifact Tree Identity；
- 通用 Event Sourcing version evolution Registry。

### 7.3 已完成消费者和垂直切片

| 区域 | 当前已实现 | 明确未完成 |
| --- | --- | --- |
| Config | v3 Schema/model、typed refs、deterministic renderer、authority snapshot、root placement、absent-only 0644 publication+readback、exact-source replacement、Config专属跨进程lock、inactive residue recovery | 完整workspace reconfigure、transition、diagnostics、runtime integration |
| Artifact | bounded stable tree identity、manifest、digest、executable bit、collision | release provenance、artifact build/host activation |
| RH-1 TODO | JSON intake/state authority、collection digest、append/claim/archive、lock/journal/recovery、Markdown projection | public/Design/MCP integration、最终 cutover |
| Ledger | Requirement/Confirmation immutable records、member refs、per-record compact-intent staged publication/recovery | archive family、four projections、full materialization/public integration |
| RH-2 Demand | identity/authority、publication/cancel events、append-commit store、repository、snapshot/audit、publication+TODO claim | task/delivery/result/review/complete/Pod/evidence/archive events与owners |
| Event versioning | stable envelope、per-family v1 codec、upcaster Registry、state version、snapshot compatibility digest | 真实 Demand v2 event/state migrator（当前没有 v2 合同） |

### 7.4 当前测试证据

INF-1完成后的最新 `npm run check:typescript` 证明：

- strict typecheck 通过；
- architecture gate 实际扫描 205 modules / 1097 dependencies；
- 395 项新 TS 测试全部通过；
- 24 份 Schema 与 generated contracts 无漂移；
- `git diff --check` 通过。

该结果不表示旧 1821 项 evidence 已被全部替换，也不表示双宿主 validator、smoke、
31-tool、真实 workspace 或插件安装已经由新 TS 覆盖。

### 7.5 NF-0 Foundation 聚焦基线

2026-08-27重新编译测试项目并执行全部Foundation测试：

```text
300 tests / 300 pass / 0 fail / 0 skip
```

生产依赖图确认大部分Foundation已有真实consumer。两个需要特别标记的零生产consumer是：

- `stable-file-range-read.ts`：只有Foundation测试；计划由INF-3 Managed Text接线；
- `loaded-artifact-tree-identity.ts`：只有Foundation测试；计划由INF-4 Manifested Tree
  或REL artifact build接线。

它们可以保留为已验证候选，但在真实consumer接线前不能表述为完整垂直能力。

### 7.6 Foundation处置矩阵

| 能力组 | 当前证据 | NF-0处置 | 后续门 |
| --- | --- | --- | --- |
| Passive own-data / JSON value | 41/26个生产依赖，完整零行为负向测试 | `complete` | 不扩展为StrictData class/manager |
| Canonical / deterministic JSON | RFC8785 golden、领域document consumer | `complete` | final packaging另处理standalone validator，不改变数据层 |
| SHA-256 / UTF-8 / base64url / ByteCount | NIST/golden/offset view/overflow证据 | `complete` | 领域容量继续由owner决定 |
| UUID / durable typed ID | 多领域consumer、跨kind vocabulary | `complete` | operation/temp/lock ID继续各自owner，不塞进durable vocabulary |
| UTC / wall / monotonic time | clock injection、deadline、calendar验证 | `complete` | lease/retention策略不下沉 |
| Runtime JSON Schema | 16个生产consumer、closed ref catalog | `complete-for-runtime` | Ajv standalone发布属于REL轨道 |
| Portable path / RootedDirectory / node snapshot | 45/37/34个生产依赖、handle/currentness/symlink证据 | `complete` | 保留Node无openat的已知本地信任边界 |
| Stable whole-file/digest read | Config/TODO/Ledger/Demand consumer | `complete` | 不为性能提供绕过准入的fast path |
| Stable directory/tree scan | Config placement、Ledger、Artifact consumer | `complete` | role/collision等政策继续由上层owner决定 |
| Stable positioned range read | 完整合同测试、零生产consumer | `consumer-needed` | INF-3接线后重新评估 |
| Strict text / deterministic JSON file | 多领域reader、representation负向测试 | `complete` | managed external text不得错误套用standalone profile |
| Atomic file create/replace | 5个生产consumer、file/parent sync、stage recovery | `complete` | replace仍要求领域协调，不内置隐藏全局queue |
| Directory materialization | 5个生产consumer、mode与collision证据 | `complete` | existing目录不自动chmod |
| Candidate/link/settlement | Demand Event Store真实提交点 | `complete` | 不升级为领域commit authority |
| Same-filesystem rename | TODO/Demand真实consumer、parent sync | `complete-same-filesystem` | EXDEV copy/verify属于INF-4，不塞进普通rename |
| Exact regular-file unlink | 6个生产consumer、exact inode/link证据 | `complete` | 不扩展为generic recursive cleanup |
| Rooted exclusive lock | TODO/Ledger/Demand真实consumer、async与crash residue测试 | `complete-local` | 不自动mtime stale、不承诺NFS/distributed lock |
| Artifact tree identity | 完整manifest/预算/collision测试、零生产consumer | `consumer-needed` | INF-4或REL接线 |
| Event version evolution | Demand codec真实consumer、synthetic v1→v3测试 | `complete` | 不扩展为通用domain event bus |
| Managed text inspect/recompose | 无实现；已有range read与atomic replace组成能力 | `missing-with-INF-3-consumer` | 先做真实whole-file+managed-block切片 |
| Manifested tree publish/move | 有stable tree、identity、same-FS rename；无EXDEV copy/verify/cleanup | `missing-with-INF-4-consumer` | 由manifest/source-target receipt驱动 |
| Resource role/recipe matrix | 只存在文档标准 | `INF-2-not-Foundation` | 不建立可执行FileManager |
| Multi-resource mutation/recovery | TODO/Ledger/Demand各有领域事务；无新通用内核 | `defer-until-INF-1/3/4` | 共同语义不足则明确reject |

### 7.7 明确拒绝或延后的Foundation候选

| 候选 | 处置 | 原因 |
| --- | --- | --- |
| 全局FileManager / storage backend adapter | `reject` | Wakeflow当前只有本地文件系统；真实多后端不存在 |
| current workspace singleton / registry | `reject` | 违反每次操作构造authority与lock内重验 |
| 通用业务事务manager | `reject` | Foundation不能解释owner、phase和terminal closure |
| mtime自动stale lock夺取 | `reject` | pathname compare-and-delete不安全；recovery必须有owner evidence |
| distributed/NFS lock承诺 | `reject` | 当前产品合同只覆盖可靠本地文件系统 |
| durable JSONL append | `reject-for-current-design` | Demand已改为immutable commit files；没有其他确认consumer |
| 原地变长byte-region写入 | `reject-for-INF-3` | managed text应重组完整bytes后exact replace |
| generic recursive delete / age-based cleanup | `reject` | tree removal必须由manifest、exact inventory和领域release gate授权 |
| Keyed in-process mutation queue作为正确性边界 | `defer` | 不能替代跨进程lock/CAS；仅在真实吞吐consumer出现时作为优化审查 |
| 预先建设Workspace Mutation复制版 | `defer` | 必须由INF-1/3/4共同恢复事实反推，不能复制旧M3 shape |

### 7.8 外部标准与TencentDB-Agent-Memory对照

本轮核对以下一手或项目原始来源：

- [Node.js 24 File System](https://nodejs.org/docs/latest-v24.x/api/fs.html)：Promise
  filesystem操作不自动同步或线程安全；`FileHandle.sync()`负责请求数据落盘；并发修改必须由
  上层协调。
- [npm/write-file-atomic](https://github.com/npm/write-file-atomic)：成熟实现使用临时文件、
  rename、fsync，并对同目标进程内写入排队；它不替代Wakeflow的跨进程authority lock、
  no-follow root和domain recovery。
- [proper-lockfile](https://github.com/moxystudio/node-proper-lockfile)：`mkdir`与mtime续租适合
  其网络文件系统目标，也明确承认手工删除/重建等compromised窗口；Wakeflow不采用mtime
  自动夺锁，保持可靠本地文件系统和exact owner recovery边界。
- [Open Group rename](https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html)
  与[fsync](https://pubs.opengroup.org/onlinepubs/009695399/functions/fsync.html)：rename只改变
  pathname，耐久结论仍需显式同步相关文件与目录。
- [openclaw/fs-safe](https://github.com/openclaw/fs-safe)：其cross-device staged copy与只删除
  已复制source entry的思路可供INF-4参考；按用户决定不引入该依赖，Wakeflow基于Node原生能力
  实现自己的manifest-bound contract。

TencentDB-Agent-Memory本地源码提供的正向参考是：

- Checkpoint把runner state与pipeline state按writer ownership拆开，避免整对象互相覆盖；
- per-file queue只解决单进程串行，跨节点时才因真实Redis consumer增加distributed lock；
- `IMetadataStore`只因SQLite/MongoDB两个真实后端和contract suite而存在；
- `CheckpointManager`、`MetadataStorePool`和`StatefulPipelineManager`使用class，是因为确实
  持有连接、队列、callbacks、状态或dispose生命周期；
- 注释重点解释owner、并发失败模式和不可混用边界，而非重复类型名称。

不采用的部分是：简单`tmp+rename`未同步parent、manifest fail-soft JSON读取、按时间命名
backup后best-effort递归删除。这些合同弱于Wakeflow当前authority、durability和exact cleanup要求。

### 7.9 NF-0结论

NF-0不建议新增“更多基础模块”作为下一步。现有Foundation已经足以开始INF-1 Config
Authority Lifecycle；新增Foundation只允许由以下两个已确认缺口驱动：

1. INF-3需要的managed text完整重组；
2. INF-4需要的manifested tree staged copy/publish/move/exact cleanup。

INF-5 mutation/recovery不是预定实现。只有INF-1、INF-3、INF-4出现至少两个语义相同、
不能由现有primitive直接组合的恢复骨架时才准入；否则保持领域技术owner本地组合。

<a id="rebaseline-plan-drift"></a>
## 8. 已确认的计划漂移与矛盾

### 8.1 Foundation 状态漂移

[全局基础服务需求](./wakeflow-foundation-services-requirement-2026-08-11.md)仍记录
`g1-pending`，因为其事实截止于 2026-08-24；2026-08-26 之后的新 TS 已实际实现
BFS-01、BFS-03、BFS-04、BFS-05 和 BFS-07 的多个底层组成部分。

这不意味着 11 个 BFS 全部完成。Workspace Authority Context、Record Codec、Public
Operation Context、Host Runtime Context、Diagnostic Issue 和 Packaging Contract 仍未闭合，
且已有 Foundation API 也必须继续由真实 consumer 验证。

### 8.2 RH-2 状态词歧义

资源标准中的 `RH-2 implemented` 表示 Demand Event Sourcing 骨干、publication/cancel、
Ledger/TODO closure 和文件存储恢复已经完成。它不表示旧 Demand 产品链中的 TaskPackage、
delivery、TargetResult、review、completion、Pod、evidence 和 archive 已经完成。

后续文档必须使用“RH-2 Core skeleton complete”或逐项 coverage，避免把 aggregate 内未来
业务 section 的零事实状态误报为完整功能覆盖。

### 8.3 Config 切片缺口

Config read-side 已实现；old Config Owner 和 transition authority 没有进入后续 RH 的明确
阶段。RH-3 当前定义为只读 Layout Matrix，E3 是验证阶段，都不能承担遗漏实现。

### 8.4 有意的物理 authority 变化

以下差异不是机械迁移缺口，而是已经确认的新标准：

- TODO：Markdown authority → JSON intake/state authority + Markdown projection；
- Demand：JSONL + mutable state 双写 → immutable append-commit Event Sourcing；
- standalone JSON：compact/pretty 并存 → deterministic pretty bytes，canonical 只作 semantic digest；
- normal runtime：不保留 legacy fallback 或双写；
- filesystem：领域 owner 复用 Rooted Foundation，不建立 FileManager。

这些差异仍需在 E3 证明业务语义、lineage、错误和恢复等价或属于已确认改进。

### 8.5 当前完全空缺的运行面

`src/hosts/codex/`、`src/hosts/claude-code/` 和 `src/entrypoints/` 当前只有 tsconfig，
没有运行代码。当前新 TS 也没有 Config Snapshot 的领域级 consumer、MCP/CLI/setup、
host adapter、artifact builder 或 committed plugin output。

<a id="rebaseline-delta-matrix"></a>
## 9. 剩余能力差异矩阵

| 能力簇 | 旧实现事实 | 当前 TS | 下一步性质 |
| --- | --- | --- | --- |
| Config mutation | fresh/reconfigure plan、stage、CAS、M3 recovery | 无 | 必须新增真实 owner；不能移植旧大文件 |
| Workspace authority context | 19个config snapshot consumer各自派生 | 只有 Config Snapshot | 需结合首个领域 consumer设计一次操作 context |
| Resource matrix | 122 Codex / 143 Claude layout entries | Config root placement only | 只读编译与双宿主 matrix gate |
| Maintenance transaction | global gate/journal/action composition | domain-local lock/journal primitives | 必须从多资源 consumer证明是否需要统一事务层 |
| Managed integration | memory/gitignore/Claude settings/statusline | 无 | exact-source-recompose + host seam |
| Active projections | 4类Markdown与双锁/maintenance路径 | TODO board projection only | 基于新 Event Store/TODO重建，不移植旧state shape |
| Demand artifacts | 6类 immutable record与service | 无 | 按首个 task/delivery consumer实现 |
| Window binding/lease | strict store、generation、exact lease | 无 | delivery与host的共同前置 |
| Transport/delivery | 4类record、store、plan/claim/outcome/rearm | 无 | 必须与TaskPackage、binding、lease形成纵切 |
| Result/review/lifecycle | result import、candidate、decision、complete/cancel | 只有cancel | 扩展同一Demand event stream |
| Evidence | strict manifest、tree scan/publish、privacy | 只有通用tree read/identity | manifested tree真实consumer |
| Ledger/archive | requirement/confirmation/archive+4投影 | requirement/confirmation | archive与projection另行切片 |
| Preservation/retention | audit hold、transport release | 无 | 必须由archive/evidence真实consumer驱动 |
| Pod | 9类record、state、host materialization | 无 | 依赖Demand artifacts、binding、host ports |
| Keep-live | records/service，host effect未完全接线 | 无 | 需先确认真实生产consumer |
| Public/observability | 31 tools、MCP/CLI/setup、status/view/verify | 无 | 等领域ports稳定后接入 |
| Host runtime | Codex 6、Claude 12 host-only modules | 无 | 保持非对称ports，真实host测试单列 |
| Migration | explicit bootstrap、classifier、owner drain、M3 composition | 无 | E4 one-time cutover；normal runtime零依赖 |
| Packaging | core sync +双validator/smoke/package | 只有TS compile/codegen/test | E3/E4 closed artifact build |

<a id="rebaseline-dependency-dag"></a>
## 10. 候选依赖图

用户已确认先建设非业务轨道。当前依赖方向修订为：

```text
NF-0 Foundation 完整性审查
│
├─ INF-1 Config Authority Lifecycle
│  └─ INF-2 Workspace Resource Matrix / Operation Authority Context
│     ├─ INF-3 Managed Integration Text
│     ├─ INF-4 Manifested Tree Lifecycle
│     └─ INF-5 从INF-1/3/4共同事实审查Mutation/Recovery收敛
│        └─ INF-6 Fresh/Static Workspace Materialization
│
├─ DOM Demand Artifact / Tasking Events
│  └─ Window Binding + Lease + Transport
│     └─ Delivery Events
│        └─ TargetResult + Review + Completion Events
│
├─ DOM Manifested Evidence Consumer
│  └─ Review/Completion evidence closure
│     └─ Business Archive + Preservation + Retention
│
├─ HOST Capability Ports
│  └─ Codex / Claude Binding, Transport, Lifecycle
│     └─ Pod + Keep-live
│
└─ REL Public Runtime / MCP / CLI / Observability
   └─ Dual Artifact Build + E3 comparison
      └─ E4 Migration / Cutover / Legacy removal
```

这些分支不是完全并行：Config/Context 被多数旧 owner 消费，Demand delivery 同时依赖
TaskPackage、binding、lease、transport 和 host port，Archive 又依赖最终完整业务闭包。

<a id="rebaseline-options"></a>
## 11. 下一阶段顺序选项

| 选项 | 顺序 | 优点 | 风险 | 当前建议 |
| --- | --- | --- | --- | --- |
| A | Config Mutation → Resource Matrix → 首个 Fresh/Managed consumer | 先闭合高扇入 authority writer，避免上层继续假定外部预写配置 | 若过早实现完整 reconfigure，可能猜测尚未建成的下游 owner | `confirmed direction`；只先做 Config 自身 mechanical owner |
| B | Resource Matrix → Config Mutation | 先获得完整 downstream resource/effect 图，再设计 reconfigure | 上层矩阵仍依赖没有新 writer 的外部配置；容易继续沿用旧 owner 假设 | 可行备选 |
| C | Config + Matrix + Maintenance 一次完成 | 表面上一次闭合 fresh/reconfigure | 范围过大，混合 authority、layout、transaction 与 managed effects，难以文件级review | 拒绝 |

已确认 A 的准确含义是：先完成 Config 自身的 fresh create、exact-source replace 和恢复，
不在该切片承诺完整 workspace reconfigure；后者必须等待 Matrix 和受影响 owner 的真实合同。

<a id="rebaseline-candidate-slices"></a>
## 12. 候选垂直切片

以下候选是 Design 建议，不是已确认任务或 TODO。

### Candidate 1：Config Authority Mutation Core（`complete`）

- Type：`HITL / implementation-complete`
- 用户价值或可独立审查结果：新 TS 可以从严格 model 创建一份 Config authority，随后由既有 Snapshot 重新读取；也可以在 exact source expectation 下替换并恢复中断。
- 建议 owner：Configuration。
- Blocked by：无；P1平台合同与C1协调/恢复合同已确认并实现。
- End-to-end change：`model → deterministic bytes → fresh create / exact replace → durability receipt → authority snapshot reload`。
- Named consumers：`readWakeflowConfigAuthoritySnapshot()`；Candidate 2 Resource Matrix；未来 maintenance runtime。
- Observable result：真实临时 workspace 中 fresh、idempotent、stale replace、crash-prefix recovery 均得到唯一结果。
- Acceptance criteria：不覆盖未知 target；不接受非canonical source；source/target digest与node expectation闭合；失败不泄露路径；无全局current-workspace对象。
- Validation：focused TS、真实临时目录、fault injection、full TS gate。
- Risks：照搬旧M3 participant；把完整cross-owner reconfigure提前塞入本切片。
- Why vertical：产生一份可被现有真实 reader重新接纳的 durable Config authority，而不是只新增writer接口。

#### INF-1待选平台策略

| 选项 | 合同 | 优点 | 风险 | 建议 |
| --- | --- | --- | --- | --- |
| P1 Reliable local POSIX | writer固定0644；source single-link、current-euid、exact mode；平台能力不足稳定拒绝 | 与旧Config owner及当前Rooted Foundation一致，authority最强 | Windows不获得虚假支持 | `confirmed / implemented` |
| P2 Portable safe-read | writer请求0644；reader只要求single-link/no-exec，不要求owner | 平台面较宽 | writer authority与普通safe read混淆，0666/foreign owner可能进入replace | 不推荐作为mutation合同 |
| P3 Host-specific policy adapter | 每宿主提供owner/mode policy | 可表达未来Windows ACL | 当前无Windows host consumer，会产生adapter placeholder | `defer` |

P1不表示声称抵抗同权限恶意进程或支持网络文件系统；它只冻结当前可靠本地POSIX
工作区的实现合同。若未来出现真实Windows consumer，再新增平台owner而不是放宽现有结论。

#### INF-1待选协调与恢复策略

| 选项 | 合同 | 优点 | 风险 | 建议 |
| --- | --- | --- | --- | --- |
| C1 Config专属短锁 + self-describing atomic stage | fresh使用OS no-replace；replace使用root内Config lock；stage由Foundation回滚/结算；恢复请求重带source/desired摘要 | 单资源边界小，无重复journal；可独立完成垂直切片 | lock固定ref与inactive residue准入必须严格设计 | `confirmed / implemented` |
| C2 Config intent journal + lock + stage | journal自包含source/desired/phase | 无原调用方时可识别计划 | 对单次rename commit重复持久状态，可能提前复制M3复杂度 | 仅在C1无法证明恢复时采用 |
| C3 等待通用Workspace Mutation | Config只做participant | 与未来多owner组合一致 | INF-1没有独立consumer闭环，并会诱导先复制旧M3 | 当前拒绝 |
| C4 只用进程内Keyed queue | 同进程replace串行 | 简单 | 不能处理多进程、crash residue或authority | 拒绝作为正确性边界 |

C1的lock ref已冻结为root级、Config owner独占的
`.wakeflow-config-authority.lock`。
它在正常完成后必须absent，crash residue只能在current target匹配已确认source或desired、atomic
stage inventory可解释且owner inactive时exact退休。不得根据mtime自动删除。

#### INF-1文件级候选顺序

1. `wakeflow-config-authority-publication.ts`：`complete`。absent-only deterministic Config
   create、P1 root/target owner与0644、Foundation durability receipt和Authority Snapshot
   exact node/source/config digest readback；不需要lock。RED先因公共入口不存在失败，GREEN
   为3项聚焦测试；相邻Config共16项通过，完整TS gate为388/388。
2. `wakeflow-config-authority-replacement-contract.ts`：`complete`。冻结P1 source
   expectation、desired/expected projection、Config lock参数、receipt和稳定错误语义。
3. `wakeflow-config-authority-replacement.ts`：`complete`。在Config专属锁内重读current
   authority，实现exact-source CAS replace、已达desired的无效果retry、stale/cross-root/
   program identity conflict以及commit-uncertain边界。
4. `wakeflow-config-authority-replacement-recovery.ts`：`complete`。仅在lock owner
   inactive、current为expected或desired，且全部stage都可由本次desired解释时exact退役残留；
   unknown、active或异质stage一律保留并报告`recovery-required`。

INF-1B以7项聚焦测试覆盖exact replace、retry、conflict、并发串行、
source policy和正反恢复路径；相邻Config共23项通过，完整TS gate为395/395。

每个文件实现后按既定节奏单独review，测试只新增对应TS聚焦证据。第一文件不得创建
workspace local root、resource matrix、maintenance plan或public entrypoint。

### Candidate 2：Workspace Resource Matrix And Operation Context

- Type：`HITL`
- 用户价值或可独立审查结果：给定 Config Snapshot 与一个明确 host capability profile，确定性得到完整资源 family/role/recipe/owner/recovery matrix，并证明双宿主零unknown、零multi-match、零illegal recipe。
- 建议 owner：Workspace/Layout host-neutral compiler；host profiles分别提供值。
- Blocked by：Candidate 1 或明确接受“只使用测试准备的strict config”；完整旧122/143项事实重映射。
- End-to-end change：`Config Snapshot + Host Profile → frozen matrix → query/validation → next owner consumption`。
- Named consumers：fresh/reconfigure/reconcile planning、observability、managed/static owner选择、artifact build matrix。
- Observable result：同一 config 的 shared matrix稳定，Codex/Claude仅在明确host-only表面不同。
- Acceptance criteria：不写文件、不缓存current workspace、不从path存在性推断authority、不让descriptor执行effect。
- Validation：双host table-driven matrix、旧122/143事实覆盖、架构门。
- Risks：复制旧layout descriptor字符串词汇；建立全局resource registry。
- Why vertical：下一批真实owner能直接消费矩阵选择自己的资源，而不是只定义types。

#### INF-2开发前事实审查

| 事实 | 对新设计的约束 |
| --- | --- |
| 旧descriptor在一个1073行文件中生成Codex 122项、Claude 143项；共有94项host-neutral，Claude多出的21项均来自settings/locator/activity/temp/assets | 122/143只作旧能力coverage golden，不作新runtime条目目标 |
| 旧descriptor同时编译路径、默认mode/tracking、owner、authority、lifecycle、host capability，并夹带物理placement admission | 新matrix只是纯、冻结的期望资源数据；placement继续由现有Config Root Placement所有，不effect |
| 新TS已把TODO收敛为JSON aggregate + Markdown projection，Demand收敛为File Event Store，Ledger路径改为`requirements/confirmations`，Config已有独立publication/replacement owner | 旧event path、JSONL/state/journal形状和owner字符串不得复制进新matrix |
| 旧layout digest绑定完host `realization`，即使该值不改变任何resource surface | 新host resource profile只投影影响资源形状的静态数据；live/runtime readiness留在HOST owner |
| Config同一资源已真实使用`exclusive-create`和`exact-source-replace`；TODO state也有创建与替换 | “每个资源只有一个mutation recipe”已被代码事实证伪；必须改为闭合allowed recipe set，具体operation每次只选一项 |
| 腾讯项目使用窄contract、隐藏concrete implementation、composition root显式装配；其`SourceFetcherRegistry`是为运行期协议扩展 | 借鉴窄合同和显式组合，不复制可变registry或“未来可插拔”空壳 |

#### INF-2待选组合架构

| 选项 | 结构 | 处置 |
| --- | --- | --- |
| M1 显式静态catalog组合 | Foundation拥有role/recipe机械合同；Config、TODO、Ledger、Demand和host分别拥有自己的声明；Workspace compiler显式组合、校验、排序和摘要 | `recommended`；无全局可变registry，路径词汇不脱离domain owner |
| M2 中央全量descriptor v2 | 在一个Workspace文件重写所有条目和字符串 | 拒绝；重现旧大文件、双路径authority和上层owner漂移 |
| M3 运行时registration/plugin map | domain/host在启动时register descriptor | 拒绝当前实现；顺序、完整性和重复注册变成运行时问题，当前没有第三宿主真实consumer |

M1中的catalog是导出的冻结数据与纯工厂，不是自动发现或全局状态。
Workspace compiler可以import明确的catalog，但catalog不得反向import compiler或持有
current workspace。

#### INF-2 recipe语义修订

建议把资源标准中的singular recipe改为两层：

1. resource declaration闭合该资源允许的normal recipe集和recovery strategy；
2. 每个真实operation plan必须且只能从允许集选择一个recipe，并由领域owner重验前置。

这不会把matrix升级为effect dispatcher；matrix只能拒绝不允许的计划，不能自动
选择或执行recipe。目录container继续独立为`materialize-directory`，不伪装成
第八种resource role。

#### INF-2建议文件级顺序

1. `src/foundation/resource/resource-processing-contract.ts`：`complete`。七种role、有限recipe、
   recovery strategy与container的discriminated union；纯函数、冻结数据、稳定错误。
   合法形状、被动严格准入与单operation recipe admission按三次RED→GREEN实现；
   3项新聚焦测试通过，typecheck通过，architecture gate为207 modules /
   1099 dependencies且零违规。本次按轻量节奏未运行全部TS测试。
2. `src/workspace/workspace-resource-declaration.ts`：`complete`。family、owner、scope、
   logical-root placement、tracking/privacy、node policy与processing contract；不引入
   Config physical placement、representation registry或filesystem effect。合法逻辑声明、严格嵌套准入与
   跨字段兼容性按三次RED→GREEN实现；3项新聚焦测试、typecheck和architecture
   gate 209 modules / 1104 dependencies通过，未运行全部TS测试。
3. `src/workspace/workspace-host-resource-profile.ts`：`complete`。只投影会改变matrix的
   宿主静态数据；从旧11个capability剪枝为8类resource surface，不保存realization/
   readiness、adapter、handle或effect；共享parser不按hostId固化capability。合法profile、
   closed passive data/path与跨字段关系按三次RED→GREEN实现；3项新聚焦测试、
   typecheck和architecture gate 211 modules / 1107 dependencies通过，未运行全部TS测试。
4. `src/hosts/codex/wakeflow-workspace-host-resource-profile.ts`：`complete`。精确投影
   `AGENTS.md`、runtime `codex`、identity/Pod/keep-live适用与locator/settings/statusline/
   activity/temp不适用；值由共享parser签发且零effect。聚焦测试先以模块缺失RED，
   随后发现旧Codex host project输出到`.build/hosts/codex`，与真实ESM import所需
   `.build/src/hosts/codex`不一致；修正镜像输出后1项新聚焦测试、typecheck和
   architecture gate 213 modules / 1109 dependencies通过，未运行全部TS测试。
5. `src/hosts/claude-code/wakeflow-workspace-host-resource-profile.ts`：`complete`。精确
   投影`CLAUDE.md`、runtime `claude-code`、八类resource surface全部适用、
   `.claude/settings.json`、`.claude/settings.local.json`和`statusline.mjs`；只提供经共享
   parser签发的冻结值，不导入locator/activity/settings/lifecycle实现。聚焦测试复现
   同类host outDir问题，修正为`.build/src/hosts/claude-code`后1项新聚焦测试、
   typecheck和architecture gate 215 modules / 1111 dependencies通过，未运行全部TS测试。
6. `src/configuration/wakeflow-config-resource-catalog.ts`：`complete`。只登记稳定可寻址的
   Config authority和Config专属lock，分别闭合tracked/shareable `0644` mutable snapshot
   与ignored/private `0600` transaction artifact；直接复用现有Config/lock ref。Foundation
   atomic stage是recipe的operation-scoped residue，不登记为全局pattern。1项新聚焦
   测试、typecheck和architecture gate 217 modules / 1119 dependencies通过，未运行
   全部TS测试。
7. Foundation directory processing refinement：`complete`。添加与`materialize-directory`
   互斥的`exact-directory-publish`，表达Owner验证关闭stage后在同一RootedDirectory
   内整体durable rename发布aggregate container；明确不拥有manifest、EXDEV fallback
   或通用stage cleanup。Resource Processing与Workspace Declaration共7项聚焦测试、
   typecheck和architecture gate 217 modules / 1119 dependencies通过，未运行全部
   TS测试。
8. `src/governance/todo/todo-resource-catalog.ts`：`complete`。静态catalog闭合collection/
   items/transactions三个`0700` roots、`0600` collection lock与board projection；
   `createTodoItemResourceCatalog(todoId)`使用完整SHA-256 storage key生成item root、
   intake、state和journal四项具体声明。Item root使用`exact-directory-publish`，
   intake/state/journal分别保持immutable fact、mutable snapshot和transaction artifact；
   append stage与Foundation atomic stages明确不进入catalog。2项新聚焦测试、typecheck
   和architecture gate 219 modules / 1129 dependencies通过，未运行全部TS测试。
9. Ledger staged publication与Resource Catalog：`complete`。新增Foundation关闭目录树
   计划/检查/candidate mutation与durable publication，使用最终mode建立private stage并
   以exact source node整体rename；Ledger改为per-record lock、compact metadata intent、
   complete-stage自主恢复与partial-stage exact input retry，reader不再因无关transaction
   residue全局阻断。durable authority固定`0755/0644`，transactions固定`0700/0600`；
   Catalog登记静态roots、per-record aggregate/manifest/members/intent/lock，stage保持
   operation-scoped。旧base64 full-payload journal Schema/codec/generated文件及旧恢复测试
   已删除。29项Foundation/Ledger/Demand相邻聚焦测试、6项Schema tooling测试、typecheck、
   schema check与architecture gate 235 modules / 1238 dependencies通过，未运行全部TS测试。
10. Demand Resource Catalog：待从publication与Event Sourcing path owner编译。
11. Managed Integration Resource Catalog：与后续首个managed text consumer一起闭合。
12. `src/workspace/wakeflow-workspace-resource-matrix.ts`：显式组合、唯一性/兼容性检查、
   deterministic order、shared/host digest与窄query。
13. 首个Operation Context只与INF-3的确认managed consumer一起实现；不先建空泛用context。

第一审阅单元只包含第1文件和对应聚焦测试，但它只是INF-2的组成部分。
计划验收锚点为：七种role与container形状完整；illegal role/recipe/recovery
组合fail closed；Config类资源可显式允许create+replace；一次operation不能同时选择
多个recipe；本文件零path、owner、host、Config和filesystem依赖。

### Candidate 3：Managed Integration Text First Consumer

- Type：`HITL`
- 用户价值或可独立审查结果：至少一个 whole-file memory 与一个 mixed-owned managed block 能在保留outside bytes的前提下稳定创建、更新和恢复。
- 建议 owner：Managed Integration Text domain owner + Foundation exact recompose primitive（仅在真实重复得到证明后）。
- Blocked by：Candidate 2 的role/recipe；确认首个consumer选择（program memory、repository memory、gitignore或Claude settings）。
- End-to-end change：`authority snapshot → inspect existing envelope → render owned content → exact-source recompose → recovery → consumer readback`。
- Named consumers：fresh/reconfigure/reconcile；installed host/repository instruction loading。
- Observable result：用户内容不丢失，owned block deterministic，stale/outside drift fail closed。
- Acceptance criteria：whole-file与managed-block不混淆；marker/owner digest闭合；不从Markdown反向生成业务authority。
- Validation：golden outside bytes、mixed newline/Unicode、duplicate marker、stale CAS、recovery。
- Risks：过早抽取generic text region；把Claude settings与普通Markdown伪装为同一领域策略。
- Why vertical：真实安装面可读取更新后的memory/settings，而不是只有区间工具。

### Candidate 4：Demand Task Artifact And Tasking Events

- Type：`HITL`
- 用户价值或可独立审查结果：从完整 Demand authority 创建第一份 immutable TaskPackage，并通过同一 Event Store 记录任务进入可投递状态。
- Dependencies：Resource/Config context；RH-2 Event Store；旧TaskPackage/authority事实深读。
- Named consumers：后续 Delivery slice。
- 关键边界：TaskPackage是immutable fact，event是状态事实；两者不能互相替代。

### Candidate 5：Window Binding + Lease + Transport Delivery

- Type：`HITL`
- 用户价值或可独立审查结果：一份TaskPackage可以绑定到exact窗口，取得lease，发布group/packet/envelope，签发一次send claim并记录run。
- Dependencies：Candidate 4、Host Capability port、Config topology。
- 关键边界：host effect不进入shared store；transport accepted不等于TargetResult或业务accept。

### Candidate 6：TargetResult + Review + Completion

- Type：`HITL`
- 用户价值或可独立审查结果：从delivery run导入TargetResult，形成ReviewCandidate，记录Controller决定并通过事件推进rework/redesign/accept/complete。
- Dependencies：Candidate 5；Test decision和evidence refs。
- 关键边界：Controller decision独立于candidate；Test不替Controller验收。

### Candidate 7：Manifested Evidence

- Type：`HITL`
- 用户价值或可独立审查结果：Controller从有界外部source导入一棵privacy-checked manifested tree，并由Demand event引用exact manifest/tree digest。
- Dependencies：Foundation tree identity；Demand event扩展。
- 关键边界：external source不要求Wakeflow owner；internal stage/final必须private exact owner。

### Candidate 8：Business Archive + Preservation + Retention

- Type：`HITL`
- 用户价值或可独立审查结果：完整终态Demand形成immutable archive closure，TODO与current脱离，transport只在archive gate后释放，必要原件进入strict preservation。
- Dependencies：Candidates 4～7、Ledger archive family、Pod close closure。
- 关键边界：archive不执行host close；preservation不按时间自动删除。

### Candidate 9：Host Runtime + Pod

- Type：`HITL`
- 用户价值或可独立审查结果：Codex/Claude各自执行真实binding/transport/lifecycle port，显式Pod由宿主创建worktree并完成两阶段验真。
- Dependencies：Window/Delivery、Demand artifacts、Host Capability、Resource Matrix。
- 关键边界：Codex manual-host-gate与Claude exact close不可伪对称；真实host测试单独授权。

### Candidate 10：Public Runtime、Observability And Entrypoints

- Type：`HITL`
- 用户价值或可独立审查结果：31项公共工具通过闭合typed route调用新domain owner，MCP/CLI/setup错误与输出脱敏，status/view/verify保持零写边界。
- Dependencies：对应domain ports稳定；不应作为空dispatcher先行。
- 关键边界：普通domain、maintenance、evidence三种context不合并。

### Candidate 11：Dual Artifact、E3 Comparison And E4 Cutover

- Type：`HITL`
- 用户价值或可独立审查结果：从TS单一源码生成两份closed插件，完成D1～D41/31-tool/双host新旧对比后原子切换并清理旧体系。
- Dependencies：全部功能切片。
- 关键边界：migration-only parser/fixture不进入normal runtime；build、commit、release、cache refresh分别授权。

<a id="rebaseline-testing"></a>
## 13. 测试与证据决定

### 13.1 本轮重新基线化

- Real-scenario Test required：`no`。
- 原因：本轮只读审查仓库并写Design草案，不改变运行行为。
- 充分证据：source inventory、dependency graph、需求/review锚点、最近TS gate和文档diff。
- 无效结论：旧测试数量不能证明新覆盖；新385项通过不能证明产品整体等价。

### 13.2 后续切片

每个候选必须依次提供：

1. compiler/architecture evidence；
2. Schema/codegen evidence；
3. domain invariant test；
4. temporary filesystem concurrency/crash/recovery test；
5. named consumer integration test；
6. full TS gate。

只有 Host Runtime、Public artifact、migration/cutover 等真实需要宿主或完整工作区的切片，
才进入另行确认的 WakeWorkspace/real-host Test Environment Spec。smoke不能冒充真实host。

<a id="rebaseline-risks"></a>
## 14. 风险与开放问题

### 14.1 已知风险

- 当前TS Foundation覆盖很广，后续可能发现某些API只适合现有consumer，不能继续泛化。
- 旧Workspace Mutation是成熟但复杂的跨owner内核；过早重建会把旧计划shape带入新架构。
- Demand完整Event Sourcing会把旧state/event双写关系重新表达，不能用字段数量估算工作量。
- Config/Host/Layout高扇入，任一错误边界会扩散到多数切片。
- 旧61 Schema与新24 Schema差额同时包含“尚未实现”和“目标物理格式已改变”，不能机械补齐。
- 当前没有host/entrypoint代码，任何“插件可运行”结论都是错误的。

### 14.2 待用户确认

1. INF-3首个managed consumer选择program memory、repository memory还是Claude settings；
2. INF-1/3/4完成后是否存在足够共同语义建设INF-5 mutation/recovery内核；证据不足时必须拒绝抽取。

<a id="rebaseline-decisions"></a>
## 15. 用户决定台账

| 问题 | 当前决定 | Owner | 依据 |
| --- | --- | --- | --- |
| 是否重新审查后续RH序列 | 已确认需要 | 用户 | 2026-08-27 对话 |
| 审查是否同时覆盖旧代码、需求、review过程和最近TS进度 | 已确认 | 用户 | 2026-08-27 对话 |
| 是否留下持久文档 | 已确认 | 用户 | 2026-08-27 对话 |
| 是否先做非业务Foundation与技术垂直切片 | 已确认 | 用户 | 2026-08-27 对话 |
| 是否采用FND/INF/DOM/HOST/REL分轨 | 已确认 | 用户 | 2026-08-27 对话 |
| 是否先执行NF-0完整性审查 | 已确认并完成 | 用户 | 本文§7.5～§7.9 |
| INF主顺序Config→Matrix→Managed/Tree | 已确认方向 | 用户 | 本文§10～§12；具体文件仍逐项review |
| Config切片不提前实现完整workspace reconfigure | 已确认 | 用户 | 本文§11～§12 |
| INF-1 P1/C1合同与文件顺序 | 已确认并完成 | 用户 | 本文§7.3、§12 |
| 是否新增Owner–Resource Capability Binding层 | 暂时待定，不进入当前计划或代码 | 用户 | 2026-08-27 对话；继续原Owner Catalog→Matrix顺序 |
| INF-2及后续切片具体API与文件顺序 | pending | 用户 | 每切片的代码事实与文件级review |
| 是否提交/交付本文 | 未授权 | 用户/Controller | 本文仍为draft |

<a id="rebaseline-sources"></a>
## 16. 主要源码事实入口

### 16.1 公共与维护

- `core/lib/wakeflow-mcp-tools.mjs`
- `core/scripts/wakeflow-cli.mjs`
- `core/scripts/wakeflow-setup.mjs`
- `core/scripts/wakeflow-bootstrap.mjs`
- `core/scripts/lib/wakeflow-public-v3-runtime.mjs`
- `core/scripts/lib/wakeflow-maintenance-coordinator.mjs`
- `core/scripts/lib/wakeflow-maintenance-action-runtime.mjs`
- `core/scripts/lib/wakeflow-maintenance-action-composition.mjs`
- `core/scripts/lib/wakeflow-workspace-mutation.mjs`

### 16.2 Config、Layout与Managed

- `core/scripts/lib/wakeflow-config-v3.mjs`
- `core/scripts/lib/wakeflow-config-v3-snapshot.mjs`
- `core/scripts/lib/wakeflow-config-v3-owner.mjs`
- `core/scripts/lib/wakeflow-config-v3-transition-authority.mjs`
- `core/scripts/lib/wakeflow-layout-descriptor.mjs`
- `core/scripts/lib/wakeflow-fresh-initialize.mjs`
- `core/scripts/lib/wakeflow-reconfigure.mjs`
- `core/scripts/lib/wakeflow-reconcile.mjs`
- `core/scripts/lib/wakeflow-managed-content.mjs`

### 16.3 Demand执行链

- `core/scripts/lib/wakeflow-demand-publication-service.mjs`
- `core/scripts/lib/wakeflow-demand-core-records.mjs`
- `core/scripts/lib/wakeflow-demand-state-service.mjs`
- `core/scripts/lib/wakeflow-demand-artifact-records.mjs`
- `core/scripts/lib/wakeflow-demand-artifact-service.mjs`
- `core/scripts/lib/wakeflow-delivery-orchestration.mjs`
- `core/scripts/lib/wakeflow-result-review-orchestration.mjs`
- `core/scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs`

### 16.4 Evidence、Ledger与Archive

- `core/scripts/lib/wakeflow-evidence-records.mjs`
- `core/scripts/lib/wakeflow-evidence-tree.mjs`
- `core/scripts/lib/wakeflow-evidence-importer.mjs`
- `core/scripts/lib/wakeflow-ledger-records.mjs`
- `core/scripts/lib/wakeflow-ledger-projector.mjs`
- `core/scripts/lib/wakeflow-preservation.mjs`
- `core/scripts/lib/wakeflow-business-archive-service.mjs`
- `core/scripts/lib/wakeflow-transport-retention.mjs`

### 16.5 Window、Pod与Host

- `core/scripts/lib/wakeflow-window-binding-service.mjs`
- `core/scripts/lib/wakeflow-window-lease-service.mjs`
- `core/scripts/lib/wakeflow-window-runtime-projector.mjs`
- `core/scripts/lib/wakeflow-pod-service.mjs`
- `core/scripts/lib/wakeflow-keep-live-service.mjs`
- `plugins/codex-wakeflow/scripts/lib/wakeflow-codex-pod-host.mjs`
- `plugins/codex-wakeflow/scripts/lib/wakeflow-codex-decommission.mjs`
- `plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-host.mjs`
- `plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-lifecycle.mjs`
- `plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-locator.mjs`
- `plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-transport.mjs`
- `plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-activity.mjs`
- `plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-settings.mjs`

### 16.6 当前TS入口

- `src/foundation/`
- `src/configuration/`
- `src/governance/todo/`
- `src/governance/ledger/`
- `src/governance/demand/`
- `tooling/codegen/schema-types.ts`
- `tooling/architecture/check-dependencies.ts`
- `tooling/testing/run-typescript-tests.ts`

<a id="rebaseline-readiness"></a>
## 17. Handoff Readiness

- Original plan confirmed：`yes`，TS单一源码与完整旧基线保留方向已确认。
- Design reconciled with verified code facts：`yes for baseline and confirmed non-business direction`。
- Landing intent and dependencies recorded：`yes for NF-0 and INF direction / exact APIs pending`。
- All user decisions answered：`no`，§14.2的技术边界仍待NF-0证据与用户确认。
- Testing decision complete：`yes for this review draft`。
- Non-goals and forbidden shortcuts recorded：`yes`。
- Ready for explicit delivery confirmation：`no`。

<a id="rebaseline-change-log"></a>
## 18. 更新记录

| 日期 | 更新 |
| --- | --- |
| 2026-08-27 | 建立Post-RH-2重新基线化草案；完成文档权威分层、旧runtime调用闭包、最近TS进度、差异矩阵、候选依赖图和首轮切片建议；等待用户确认顺序与粒度。 |
| 2026-08-27 | 用户确认机制驱动的非业务垂直切片方向；建立FND/INF/DOM/HOST/REL分轨，确认先执行NF-0，再按INF-1 Config、INF-2 Matrix、INF-3 Managed Text、INF-4 Manifested Tree推进，INF-5 mutation/recovery只有在共同事实充分时才准入。 |
| 2026-08-27 | 完成NF-0：300项Foundation测试通过；现有能力形成complete/reinforce/consumer-needed/missing/reject处置矩阵；对照Node 24、POSIX、成熟atomic/lock仓库及TencentDB-Agent-Memory；确认下一实现只需进入INF-1，等待P1/C1合同确认。 |
| 2026-08-27 | 用户确认P1+C1后完成INF-1A首文件：新增absent-only Config authority publication，以0644/current-user POSIX策略完成原子create、durability receipt和Snapshot readback；非法、超限、取消、现存任意target均在对应边界fail closed；完整TS gate 388/388通过。 |
| 2026-08-27 | 完成INF-1B与Config Authority Lifecycle：新增P1/C1 replacement contract、Config专属跨进程锁内exact-source replacement、无效果retry和严格inactive residue recovery；异质/未知残留fail closed且不自动删除；7项新聚焦测试、23项相邻Config测试及完整TS gate 395/395通过。 |
| 2026-08-27 | 进入INF-2开发前审查：完整读取旧layout descriptor、双宿主profile、代表性consumer、当前TS path owner与腾讯项目边界；对照TypeScript discriminated union/`satisfies`、JSON Schema closed union、Node path/mode、systemd declarative file metadata与Kubernetes field ownership；建议选择M1显式静态catalog组合，并把singular resource recipe修订为“闭合allowed set + 每operation唯一选择”，等待用户确认。 |
| 2026-08-27 | 用户确认M1与recipe语义修订后完成INF-2A首文件：新增Foundation Resource Processing Contract，以discriminated union闭合七种role和directory container，严格准入allowed recipe set/recovery strategy并保证单operation只选择一项recipe；三次RED→GREEN后3项新聚焦测试、typecheck和207 modules / 1099 dependencies架构门通过，未运行全部TS测试。 |
| 2026-08-27 | 完成INF-2B Workspace Resource Declaration：新增冻结纯数据声明，闭合12个family、窄owner/scope、logical root + portable relative placement、tracking/privacy、node policy与Foundation processing compatibility；不解析绝对路径、不引入host/codec registry或effect；三次RED→GREEN后3项新聚焦测试、typecheck和209 modules / 1104 dependencies架构门通过，未运行全部TS测试。 |
| 2026-08-27 | 完成INF-2C Host Resource Profile共享合同：从旧profile中只保留host identity/runtime directory/instruction file与8类matrix-shaping surface，删除realization/readiness、close/revoke/activation与adapter/handle/effect；共享parser不按hostId硬编码surface。自审根据真实Claude实现修正statusline语义：它由Node调用且mode为0600，profile只保存filename，不声明executable bit。3项新聚焦测试、typecheck和211 modules / 1107 dependencies架构门通过，未运行全部TS测试。 |
| 2026-08-27 | 完成INF-2D Codex Host Resource Profile：新增宿主自有冻结常量，精确保留`AGENTS.md`、Codex runtime directory与identity/Pod/keep-live资源表面，不声明realization或effect。聚焦测试进一步暴露host tsconfig输出没有镜像`src/hosts/codex`而导致编译绿、ESM运行失败；将outDir修正为`.build/src/hosts/codex`后，1项新聚焦测试、typecheck和213 modules / 1109 dependencies架构门通过，未运行全部TS测试。 |
| 2026-08-27 | 完成INF-2E Claude Code Host Resource Profile：新增宿主自有冻结常量，精确保留`CLAUDE.md`、Claude runtime directory、8类适用资源表面、双settings路径与statusline文件名，不导入宿主observer/writer/effect。聚焦测试复现并修正Claude host project的非镜像outDir；改为`.build/src/hosts/claude-code`后，1项新聚焦测试、typecheck和215 modules / 1111 dependencies架构门通过，未运行全部TS测试。 |
| 2026-08-27 | 用户将Owner–Resource Capability Binding方案暂时待定，未进入计划或代码；恢复Owner Catalog→Matrix原顺序。完成INF-2F Config Resource Catalog：只登记Config authority与Config专属lock，复用已有path refs并闭合mode/role/recipe；Foundation atomic stages保持operation-scoped且不复制为全局pattern。1项新聚焦测试、typecheck和217 modules / 1119 dependencies架构门通过，未运行全部TS测试。 |
| 2026-08-27 | 用户确认添加`exact-directory-publish`；完成INF-2G Foundation directory processing refinement。Directory container现以discriminated union区分静态逐段物化与Owner验证关闭stage后的同根durable rename发布，existing target/collision/recovery政策不可混用；新recipe不宣称manifest、跨文件系统或通用stage cleanup能力。Resource Processing与Workspace Declaration共7项聚焦测试、typecheck和217 modules / 1119 dependencies架构门通过，未运行全部TS测试。 |
| 2026-08-27 | 完成INF-2H TODO Resource Catalog：静态目录闭合collection/items/transactions roots、collection lock和board projection；per-item factory按真实TODO ID的SHA-256 storage key生成item root/intake/state/journal四项具体声明，并用`exact-directory-publish`表达初始aggregate关闭发布。Domain append stage和Foundation atomic stages继续作为operation-scoped residue，不进入全局catalog。2项新聚焦测试、typecheck和219 modules / 1129 dependencies架构门通过，未运行全部TS测试。 |
| 2026-08-27 | 完成Ledger staged publication重构与INF-2I Resource Catalog：对照POSIX/Node 24/Git/Nix/OSTree及TencentDB-Agent-Memory后，删除旧base64 full-payload journal、全局Ledger lock/read gate、直接final逐文件写入及对应旧测试；新增Foundation关闭目录树计划/partial retry/durable rename能力，Ledger采用per-record lock、compact intent、private final-mode stage与same-device整体发布，长期authority为0755/0644、transaction为0700/0600。Catalog闭合静态roots与per-record aggregate/facts/intent/lock，stage保持operation-scoped。29项相邻聚焦测试、6项Schema tooling测试、typecheck、schema check与235 modules / 1238 dependencies架构门通过，未运行全部TS测试。 |
