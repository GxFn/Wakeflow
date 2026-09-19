# Wakeflow TypeScript 全新项目能力重构开发计划

> 原路径：`docs/wakeflow-typescript-capability-reimplementation-development-plan-2026-08-25.md`，2026-09-03 迁入开发文档系统；目录职责与权威顺序见 [docs/README.md](../README.md)。

> 创建日期：2026-08-25
> 当前状态：`engineering-foundation-complete / capability-model-in-progress / vertical-slices-in-progress`
> 需求权威：[TypeScript 单一源码、双宿主制品与轻量测试需求](../requirements/typescript-dual-artifact-build.md#ts-document-role)
> 产品行为基线：[初始化生成文件需求 D1-D41](../archive/wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-decision-register)、[D38 全局职责闭环](../archive/wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-d38-global-contract)、[初始化 v3 当前实现](../archive/wakeflow-initialization-v3-development-plan-2026-08-06.md#dev-progress)
> 基础服务边界：[全局基础服务需求](../archive/wakeflow-foundation-services-requirement-2026-08-11.md#foundation-document-role)、[review 与实施分界](../archive/wakeflow-foundation-services-requirement-2026-08-11.md#foundation-review-implementation-separation)
> 资源处理标准：[TypeScript 资源处理归一标准与收敛矩阵](../standards/resource-handling-standard.md)
> 决策记录：[docs/decisions/README.md](../decisions/README.md)；ADR-0002 到 ADR-0006 于 2026-09-03 接受并回写本文 §3、§7、§8.1、§9、§10、§13、§14
> 环境边界：源码只修改 Wakeflow 仓库；真实初始化验收只使用用户指定的可丢弃 `WakeWorkspace`；`AlembicWorkspace` 完全排除
> 授权边界：本文是开发上下文和阶段门，不因创建本文自动授权真实工作区操作、commit、version、tag、push、publish 或插件缓存刷新

<a id="ts-dev-document-role"></a>
## 1. 文档职责与最终目标

本文把已确认的 TypeScript 方向约束为一个**全新项目的能力重构过程**。它不是旧 JavaScript 文件到新 TypeScript 文件的迁移清单，也不把旧目录结构当作新架构输入。

最终目标是：

> 在 `src/`、`tooling/`、`tests/` 中按 Wakeflow 的功能能力与依赖层级重新实现完整产品；开发期间旧 JavaScript 实现、旧测试和双插件制品只读保留作为场景与需求证据；新项目全部完成后，通过能力覆盖与场景验收证明功能完整性，再原子切换源码与制品权威并删除旧体系。

本文负责：

1. 固化工程底座、能力设计、能力实现、整体对比和最终切换的阶段边界；
2. 为每个阶段写明真实代码核验、实现输入、证据、退出标准和停止条件；
3. 约束旧基线与新项目的物理隔离，防止逐文件复制、兼容 wrapper 或中途制品切换；
4. 指向需求锚点，确保重构不凭文件名或旧测试形状重新发明产品合同；
5. 记录已验证事实和开发进度，不把尚未确认的能力划分写成既定架构。

<a id="ts-dev-strategy-correction"></a>
## 2. 已确认的策略修正

2026-08-25 确认以下开发策略，并废止此前的逐文件迁移路线：

- 旧 `core/`、`tools/`、`test/` 和当前两个插件制品在新 TS 项目完成前保持原状；
- 新实现按功能区块和能力层级组织，不按旧文件名、旧目录或旧测试文件逐项搬迁；
- 开发过程中不为单个能力切换正式 artifact owner，也不删除“看起来已经替代”的旧文件；
- 不建立旧文件复制清单、`legacy-copy` source manifest 或 shadow-copy artifact builder；
- 旧代码用于场景与需求证据核验，不成为新项目的运行时依赖，也不是行为等价的基线；
- 全部新能力闭环后，先执行能力覆盖与场景验收，再把制品切换与旧体系删除作为单独阶段处理。

因此，旧实现不是待逐项消费的迁移队列，而是一份只读的场景与需求证据。文件数量和路径映射只可作为调查证据，不能成为架构或进度单位。

<a id="ts-dev-confirmed-constraints"></a>
## 3. 不再重新打开的约束

| 编号 | 已确认约束 | 开发含义 |
| --- | --- | --- |
| `TSD-01` | 全部手写 Node.js 代码最终使用 TypeScript | 生产、工具、测试均进入新体系；非代码资产和精确 allowlist fixture 除外 |
| `TSD-02` | 两个插件是 committed generated artifacts | 最终可直接安装，但不能继续承担手写源码职责 |
| `TSD-03` | 旧 JavaScript 实现是场景与需求证据，不是行为基线 | 只有能力卡确认的场景、不变量与失败恢复语义必须在新体系实现；磁盘布局、文件名、事件形状、工具名称与信封都不要求等价；authority 语义由能力卡逐项确认。2026-09-03 先按 [ADR-0002](../decisions/0002-public-tool-surface.md) 放宽公共面，再按 [ADR-0008](../decisions/0008-discard-legacy-and-new-version-series.md) 改为证据定位 |
| `TSD-04` | 测试同步轻量化 | 不一对一翻译旧测试；按能力不变量确定新的 evidence owner |
| `TSD-05` | JSON Schema 是 wire contract 权威 | TypeScript 类型和必要的运行时 validator 单向派生 |
| `TSD-07` | 仅 `WakeWorkspace` 可作真实初始化环境 | `AlembicWorkspace` 不读、不写、不扫描、不初始化 |
| `TSD-09` | 最低运行时升级为 Node 24 LTS | 不保留 Node 20 fallback；根和双插件最终同步升级 |
| `TSD-10` | 完全新建源码体系 | 使用 `src/`、`tooling/`、`tests/`，不在旧目录原地改后缀 |
| `TSD-11` | 旧代码只读保留到 E4 一次删除 | 旧 `core/`、`tools/`、`test/` 与两个插件制品不逐文件迁移或删除；自 2026-09-03 起旧门退出 `npm test`，以 `npm run test:legacy` 手动运行；能力卡全部确认后旧代码只剩阅读价值，E4 统一删除。按 [ADR-0008](../decisions/0008-discard-legacy-and-new-version-series.md) 修订 |
| `TSD-12` | 宿主写效果由 Agent 执行，Wakeflow 内建内容与验证 | 开线程、线程投递、开 worktree、创建窗口由 Agent 执行；Wakeflow 提供精确内容与每宿主的动作说明，准入 Agent 交回的 attempt 与回读证据，验证摘要与状态转换。不内建 transport 执行器，foundation 不增加进程或 PTY 端口；只读观察同样由 Agent 观察并交回证据；不重建执行型宿主 CLI，操作步骤写入 skills；keep-live 与 unattended 后台自动化先放弃，场景层再议。依据 [ADR-0003](../decisions/0003-host-effect-layer-ownership.md) 2026-09-03 修订与 [ADR-0007](../decisions/0007-rebuild-mandate-and-bottom-up-flow.md) |
| `TSD-13` | 公共工具目录有体积预算 | `tools/list` 总载荷低于 60 KB；outputSchema 不内联共享 `$defs`；apply 请求使用 `planRef` 加 `planDigest`，服务端重取并重新推导；description 只写一句工作流。JSON Schema 仍是 wire 权威。依据 [ADR-0004](../decisions/0004-mcp-tool-catalog-size.md) |
| `TSD-14` | Demand 事件流读路径为快照加尾部 | 快照是每次 apply 成功后刷新的可重建缓存；operation 上下文默认快照加尾部，全量 audit 只用于 verify 类入口；一次命令内只加载一次事件流；Demand 完成后封流归档随 Archive 能力落地。依据 [ADR-0005](../decisions/0005-demand-event-stream-read-path.md) |
| `TSD-15` | 旧能力取舍已裁定 | Pod 按 [ADR-0010](../decisions/0010-worktree-isolated-execution-and-converged-flow.md) 定为与 main 同型的完整窗口集加执行位置：main 是 `primary` 的 pod，一个 pod 同一时刻只推进一个 Demand，worktree 归产品窗口并由宿主原生能力创建，只有 main 的 Controller 创建与关闭 pod，不重建旧 11 段 Pod 状态机；`view` 放弃；`verify` 保留为公共只读入口；窗口替换与租约、continue 与 cancel、research 完成与实现重设计、archive、preserve、prune 保留；legacy 迁移放弃。依据 [ADR-0006](../decisions/0006-legacy-capability-retention.md) 与 ADR-0008 |
| `TSD-16` | 新 TS 是全新版本序列，配置从 v1 起版且不兼容旧文件 | 配置 schema `$id` 为 `urn:wakeflow:config:v1`，`schemaVersion` 从 1 开始，`kind` 保持 `WakeflowConfig`，代码去掉 `v3` 字样；不识别、不迁移、不 upcast 任何历史布局或配置，初始化遇到任何 Wakeflow 标记只拒绝并列出；配置只由 fresh-initialize 与 reconfigure 产生，物理产物永远由当前运行版本重新推导；首个新制品版本在 E4 从新序列起始，旧 0.9.x 序列终止。依据 [ADR-0008](../decisions/0008-discard-legacy-and-new-version-series.md) |

基础服务候选 BFS-01 到 BFS-11 已由本计划重新映射，原需求文档已归档。将代码放入新目录不自动批准新的 class、service、registry、DI container 或公共抽象；review 中发现的候选继续登记，待统一设计后实施。

<a id="ts-dev-reading-order"></a>
## 4. 每个能力阶段的真实代码阅读顺序

能力设计和实现开始前，按以下顺序读取：

1. 本文的当前阶段目标与退出门；
2. [TS 需求的已确认方向](../requirements/typescript-dual-artifact-build.md#ts-confirmed-direction)；
3. 对应 D1-D41 需求锚点与[当前需求覆盖入口](../requirements/typescript-dual-artifact-build.md#ts-current-requirement-coverage)；
4. 该能力在当前旧源码中的全部 producer、consumer、Schema、状态写入、入口和 host effect；
5. Codex / Claude Code 当前制品的真实差异和旧测试中的有效不变量；
6. 本阶段开始时的 Git 状态、工具链和可复现测试基线。

旧文件名只能帮助定位，不证明职责。状态 authority、evidence authority、host effect 和 agent judgment 必须分别确认。调查结果进入能力上下文或覆盖矩阵，不形成逐文件迁移台账。

<a id="ts-dev-old-new-boundary"></a>
## 5. 旧基线与新项目的物理边界

### 5.1 旧基线

在最终切换前：

- `core/` 继续是当前共享源码权威；
- `tools/` 与 `test/` 继续执行现有维护和回归职责；
- `plugins/codex-wakeflow/` 与 `plugins/claude-code-wakeflow/` 继续是当前正式制品；
- 根 `AGENTS.md` 的 `core/` 与 `sync-core` 规则对旧树的维护继续有效；旧 validator、smoke 与回归测试以 `npm run test:legacy` 手动运行，不再进入 `npm test`；
- 对旧基线的行为修复只有在用户另行要求时进行，不能夹带到 TS 重构中。

### 5.2 新项目

新项目只在以下边界内实现：

```text
src/                 # 新产品源码；按确认后的能力模型组织
tooling/             # 新构建、codegen、validation、release 源码
tests/               # 新测试；按能力与证据 owner 组织
.build/               # ignored 编译、生成和临时验证输出
tsconfig*.json        # project references 与共享编译约束
```

新项目必须满足：

- 不 import `core/`、旧 `tools/` 或插件内旧可执行代码；
- 不复制旧文件后只做语法或类型润色；
- 不用 wrapper 把旧实现包装成“新能力”；
- 不写入正式 `plugins/*`，直到整体切换阶段；
- 可以在独立临时输出中做差异测试，但临时输出不取得正式制品权威。

<a id="ts-dev-engineering-foundation"></a>
## 6. E0：新项目工程底座

### 6.1 目标

建立不依赖旧实现的 TypeScript 编译、Schema 类型派生和新测试执行底座。底座只证明工程工具可用，不决定领域能力架构。

### 6.2 保留内容

- Node `24.19.0`、npm `11.17.0` 与 `engine-strict` 开发声明；
- 精确锁定的 TypeScript、`@types/node@24`、Ajv 和 Schema-to-TypeScript generator；
- 根 solution 与 runtime、双 host、entrypoints、tooling、tests project references；
- `.build/` 隔离输出；
- Schema 类型生成/漂移检查的最小工具和 focused test；
- 现有 `npm test` 前增加新底座自检，但不改变旧测试和双宿主门的职责。

### 6.3 明确不属于底座

- 旧文件到新文件的路径映射；
- 旧源码复制型 artifact source manifest；
- shadow-copy artifact assembler；
- 按旧测试文件建立的迁移/删除台账；
- 任何正式插件制品切换或旧目录删除。

### 6.4 退出标准

- 新 project references 可在 Node 24 下干净编译；
- Schema 类型生成连续运行确定，漂移检查 fail closed；
- focused tooling test 通过；
- 当前 `core/`、`tools/`、`test/` 与 `plugins/*` 无行为改动；
- 根旧仓库门仍能运行，且新增底座不会篡改正式 artifact。

<a id="ts-dev-capability-design"></a>
## 7. E1：能力地图与能力等级设计

### 7.1 当前状态

本阶段正在按 consumer-driven 垂直切片建立。Data、Identity/Time/Crypto、Rooted Filesystem 的主要低层合同已经实现；Artifact Tree Identity、Config Authority Snapshot、RH-1 TODO Intake Aggregate 与 RH-2 Demand Core Aggregate 已成为真实 consumer。RH-2 经实现后审查已按标准 Event Sourcing 根本重构：pure Decider/Command Handler、一次 append 一个 immutable commit batch、fixed commitSequence optimistic CAS、snapshot + tail 正常加载、full audit、显式 upcaster、具名 candidate recovery 与 TODO-backed publication 已闭合；不再保留 stream lock、pure append journal、调用方构造 stored event 或 load-time snapshot write。下一切片必须继续从真实 consumer 与当前代码事实决定，不能把早期 RH-3 顺序当作绝对命令。

E1 全局退出门继续约束 public、host、artifact 和 cutover；但一个 bounded E2 垂直切片在自己的能力上下文、真实 consumer、依赖方向、authority 边界和验收证据已逐项确认后可以先行实施。该局部准入不能被解释为其余 D1–D41 或能力映射矩阵中的旧能力已经完成设计。

### 7.2 每个能力区块必须形成的上下文

| 内容 | 要求 |
| --- | --- |
| capability identity | 使用稳定、面向职责的标识，不沿用旧文件名 |
| responsibility | 明确拥有的状态、判断、转换或 effect；同时写清不拥有的职责 |
| requirement anchors | 指向 D1-D41、I3、D38 等真实产品合同 |
| inputs/outputs | 公共数据、命令、事件、receipt、projection 与稳定错误 |
| authority boundary | 区分状态 authority、证据 authority、host effect 和 agent judgment |
| dependency level | 说明依赖的低层能力与允许的上层 consumer，禁止循环或根 barrel 隐藏 |
| host seam | 明确 host-neutral contract 与 Codex/Claude 差异 |
| runtime validation | 外部输入、Schema、跨字段不变量和 TypeScript 类型各自负责什么 |
| evidence owner | compiler、codegen、domain、host、artifact、migration 或 workspace |
| old baseline probes | 为最终差异检查保留的旧入口、观察值和高风险测试，不是迁移文件清单 |

### 7.3 退出标准

- 能力区块覆盖当前全部产品职责而无明显重复 authority；
- 能力等级和依赖方向得到用户确认；
- D1-D41 与能力映射矩阵中的 31 项旧工具能力都能映射到能力 owner 或明确的放弃记录；
- host-specific 能力没有被布尔 host switch 塞入共享层；
- 基础服务候选与当前领域实现边界明确；
- 形成后续能力实现阶段的顺序，但不以旧文件顺序排序。

<a id="ts-dev-capability-implementation"></a>
## 8. E2：按能力重新实现

能力模型确认后，每个能力区块使用同一协议：

1. **核验事实**：阅读相关旧实现、全部真实 consumer、Schema、host seam 和高价值旧测试；
2. **冻结合同**：记录需求锚点、authority、输入输出、稳定错误和不可改变行为；
3. **独立实现**：只在新项目写 TypeScript，不 import、复制或包装旧实现；
4. **建立新证据**：只为真实运行时不变量写测试；类型和生成确定性由 compiler/codegen 负责；
5. **能力内验收**：运行 focused typecheck/test、host contract 和必要的故障/恢复场景；
6. **场景验收**：按能力卡的场景块在新体系的一次性工作区上运行端到端验收，不与旧实现比较磁盘状态、文件路径或错误堆栈；
7. **登记完成**：更新能力覆盖矩阵和差异说明，不修改正式 artifact，也不删除旧文件。

发现以下情况时停止当前能力实现并返回讨论：

- 产品合同、authority 或 host seam 存在真实歧义；
- 需要新增跨领域公共服务、全局 registry 或状态机；
- 场景验收失败无法判定是能力卡缺陷、需求变化还是新实现缺陷；
- 只有依赖旧模块或复制旧实现才能继续；
- 新证据无法覆盖能力卡中的高价值并发、恢复、权限或隔离不变量。

<a id="ts-dev-execution-order"></a>
### 8.1 执行顺序与阶段门（2026-09-03 起）

2026-09-03 节点评估（[reviews/2026-09-03-typescript-checkpoint-review.md](../reviews/2026-09-03-typescript-checkpoint-review.md)）确认技术底座已建成，但公共面、宿主效果边界、事件流读路径和样板密度四个方向需要先收敛。ADR-0002 到 ADR-0007 接受后，E1 与 E2 的剩余工作按 [ADR-0007](../decisions/0007-rebuild-mandate-and-bottom-up-flow.md) 的自底向上原则分为 P0 与 L0 到 L3 四层：先把文档设计更新到位，再做实底层基础能力，向上闭合功能垂类切片，向上联合业务场景，最后切换制品。P0 与 L0 到 L2 属于 E1 与 E2，L3 对应 E3 与 E4。每层的退出门是硬条件；债务代码与文件在每层内允许删除重写，守门规则见 §12。

| 层 | 目标 | 主要工作 | 允许删除重写的对象 | 退出门 |
| --- | --- | --- | --- | --- |
| P0 文档与场景验收基线 | 先更新文档设计，不新增业务能力 | 按能力逐项分析旧 JS 实现并与用户确认，形成 `docs/requirements/capabilities/` 下的能力卡与 `docs/references/capability-map.md` 能力映射矩阵，矩阵覆盖 31 项旧工具能力、宿主差异与 D1-D41，每行标注重切、缺席、放弃；建立场景验收骨架，以能力卡的场景块为清单在新体系的一次性工作区上运行端到端验收，先覆盖初始化、创建 Demand、规划任务；核实 P0 待确认事项 | 无 | 能力卡全部确认；矩阵无空行；场景验收骨架能运行三个场景并报告结果 |
| L0 基础做实 | 底层基础能力做实，落地 TSD-13、TSD-14 与 [ADR-0013](../decisions/0013-target-architecture-and-slice-plan.md) | 六层形状 foundation、contracts、kernel、capabilities、hosts、entrypoints；foundation 收敛到 14 个原语；kernel 新建 13 个模块：demand-stream、append-command、publication-transaction、idempotency-store、next-projection、privacy-scan 与 redaction 与 limits、error、config-authority、layout、hook-observations、work-claim、receipts、tool-registry（职责见 [reviews/2026-09-04-architecture-and-slice-design.md §3](../reviews/2026-09-04-architecture-and-slice-design.md)）；事件与前沿词汇表改为 contracts 数据表加 never 守卫；codegen 预编译校验器惰性加载；dependency-cruiser 改为六层方向规则加切片隔离；ESLint 或 Biome、Prettier、knip、复杂度上限 | 22 个协调器；301 个错误类与 306 张消息表；13 份脱敏签名与 8 种上限；43 份 assertRoot、30 份 isAbortSignal、40 份 assertNotAborted、55 份 parseOptions；filesystem 36 文件合并为 8；6 份 uuidFrom；event store reader 全量读路径；Decider 两条 if 链；重复的 catch 映射测试 | 协调器总行数降 40% 以上；治理层 catch 行占比低于 5%；一次写命令只读一次事件流；100 个 commit 下 append 低于 50 毫秒；组合根热启动低于 500 毫秒；`tools/list` 低于 60 KB；lint 门为绿；foundation 文件数不高于 20；kernel 每模块有直接测试 |
| L1 功能垂类切片 | 每个能力按 ADR-0013 的切片解剖闭合 | 十个切片按序：workspace、endpoint、requirement、demand、tasking、delivery、result-review、evidence、pod、observation；范围、工具、事件与删除对象见 [reviews/2026-09-04-architecture-and-slice-design.md §4](../reviews/2026-09-04-architecture-and-slice-design.md)；宿主差异只进 hosts profile 数据与 skills 文本（TSD-12）；配置 schema 按 TSD-16 从 v1 起版 | 各切片列出的被替代旧形状：window-runtime 21、managed-integration 13、ledger 20、todo 24、demand 38、lifecycle 6、controller 3、tasking 9、testing 23、delivery 31、result 11、review 27、evidence 21、active 7 文件 | 每片 decide 测试加一条场景验收通过，被替代物同一提交删除；十片完成后公共工具恰为 20 个 |
| L2 业务场景与联合 | 从初始化到归档的端到端场景跑通 | 第一项是 hook 观察脚本 `src/entrypoints/wakeflow-hook-observer.ts` 与两宿主的 hook 配置片段（2026-09-18 gate-log §13.94 D9 从 L3 提前，L3 只打包），状态**已实现、宿主未验证**（gate-log §13.97 定案、§13.98 实现记录）；场景联合：初始化、窗口、TODO、Demand、派发、结果、评审、完成、归档；场景验收全量运行；skills 与 commands 文本按新公共面重写，状态**已实现**（gate-log §13.99 定案：`assets/agent-text/` 一份源、每宿主一份文本取值表、`tests/artifacts/agent-text-honesty.test.ts` 诚实性门；旧制品树留到 L3 原子切换时删除）；Agent 执行的派发在两宿主完成一次投递并交回回读证据 | 无场景价值的旧测试 | Controller Route 不再返回任何 not-implemented blocker；矩阵每行都有 TS owner 或放弃记录；场景验收覆盖全部保留场景；两宿主各完成一次真实投递并交回 hook 证据（记未验证直到跑过）；治理测试墙钟低于 3 分钟 |
| L3 制品、对比与切换 | 对应 E3 与 E4 | 候选构建器产出完整插件：manifest、skills、commands、templates、README、宿主记忆、setup 与 validate 与 smoke 脚本、assets、marketplace 条目，两次构建逐字节一致；`releaseEligible` 有真实路径；插件 engines 升到 Node 24；全量场景验收；双 validator 与双 smoke 对候选制品运行；新版本序列起始；原子切换并删除旧体系与全部历史 fixture | 旧 `core/`、`tools/`、`test/` | 第 14 节完成定义全部满足 |

P0 必须核实并记录的事项：

- Agent 交回的回读证据形状在 Codex 与 Claude 两宿主是否统一，以及无真实宿主会话时 L2 场景验收的未执行标注方式（ADR-0003 修订）；
- plan 落盘后的保留与清理 owner（ADR-0004）；
- 10,000 commit 硬墙保留还是改为触发封流归档，以及快照刷新失败是否阻塞 apply（ADR-0005）。

<a id="ts-dev-comparison"></a>
## 9. E3：能力覆盖与场景验收

2026-09-03 按 [ADR-0008](../decisions/0008-discard-legacy-and-new-version-series.md) 从"整体新旧对比"改为"能力覆盖与场景验收"。旧实现不再作为对比对象；判定对象是能力映射矩阵与能力卡的场景块。

| 验收面 | 必须证明的内容 |
| --- | --- |
| 需求覆盖 | D1-D41、D38、I3 等锚点每条有新能力与新证据 owner，或有明确的放弃记录 |
| 能力映射矩阵 | 31 项旧工具能力逐行有新工具或内部 owner，或有明确的放弃记录；新工具的名称、输入 Schema、输出与稳定错误以新 Schema 为准（ADR-0002） |
| 场景验收 | 能力卡每个场景块在新体系的一次性工作区上端到端通过，验收清单由能力卡生成，不与旧实现比较 |
| Schema | `$id/$ref` 闭合，portable wire contract 无意外漂移；`tools/list` 总载荷低于 60 KB（TSD-13） |
| 状态与 authority | config、active、ledger、window、pod 执行位置、archive 等不变量按能力卡保持 |
| 双宿主 | 共享行为一致，Codex 与 Claude Code 在内容形状、证据形状、指令文本三处的真实差异保留（TSD-12） |
| 失败与恢复 | lock、atomic write、TOCTOU、journal、preview/apply/recover、idempotent rerun 按能力卡保持 |
| 安全与隔离 | path/symlink fence、redaction、tracked/ignored、host-private 信息边界保持 |
| 制品 | 两份候选 artifact 可独立构建、验证、smoke，且不依赖旧源码或 TS runtime loader |
| 测试 | 新 evidence owner 覆盖能力卡中的有效不变量，重复证据已删除 |
| 真实环境 | 经授权后在可丢弃 `WakeWorkspace` fresh initialize、删除重建、reconfigure/reconcile |

验收结论必须区分：通过、有意放弃、待用户决定、新实现缺陷。没有明确分类的项不能进入最终切换。

<a id="ts-dev-cutover"></a>
## 10. E4：整体制品切换与旧体系清理

本阶段必须在 E3 全部通过后单独执行，不与普通能力实现混合。

### 10.1 切换任务

1. 建立只接受新 TS 编译输出、Schema 派生输出和明确静态资产的 closed artifact manifest；
2. 在临时目录生成 Codex 与 Claude Code 完整制品，检查 missing、extra、conflict、cross-host contamination；
3. 连续两次生成 byte-for-byte 一致，并通过双 validator、双 smoke、能力映射矩阵和 package closure；
4. 原子更新两个 committed artifact；
5. 同步更新根 `AGENTS.md`、package scripts、README 和发布规则，使 `src/` 与新 build 成为唯一权威；
6. 删除旧 `core/`、旧 `tools/`、旧 `test/`、`sync-core` 路径和全部历史 fixture，不保留任何 legacy 语料；
7. 运行最终仓库门、`git diff --check` 和经授权的 `WakeWorkspace` 验收；
8. 首个新制品版本从新版本序列起始，旧 0.9.x 序列终止；`release:check` 的五个版本源按新序列一致（TSD-16）。

### 10.2 失败恢复

- 候选 artifact 构建失败：正式插件保持旧制品，不写入半份结果；
- 任一对比面未闭合：旧体系完整保留，不开始删除；
- 原子切换后的仓库门失败：修复新体系或恢复完整旧制品集合，不能混合两套正式 owner；
- 未获得 workspace/cache/release 授权：只完成仓库内可验证部分并明确报告，不扩大操作范围。

<a id="ts-dev-test-strategy"></a>
## 11. 轻量测试实施原则

- 不按 116 个旧顶层测试建立一对一迁移或删除计划；
- 旧测试只读保留到 E4，可用 `npm run test:legacy` 手动运行，不再进入 `npm test`，只作为不变量来源；
- 新测试按能力与 evidence owner 组织，不按旧源码路径组织；
- compiler 证明类型依赖、可穷尽分支和项目边界；
- codegen 证明 Schema 解析、派生确定性和漂移；
- domain test 证明状态转换、authority、失败与恢复；
- host contract 证明共享端口，host-only test 证明真实宿主差异；
- artifact test 只证明入口、文件闭包、安装形态和宿主接线；
- workspace test 只在明确授权的可丢弃环境证明真实初始化与维护；
- 删除旧测试前，必须先完成能力覆盖矩阵和场景验收，而不是凭新测试数量判断覆盖；
- 新测试始终轻量：共享一个配置基线 fixture 按需复制，替代各自建工作区的 fixture；单元测试用内存值不落盘；每个场景只保留一条端到端链；发现重复证据即删除；治理测试墙钟目标低于 3 分钟（ADR-0007）。
- 切片的 decide 测试用 given-when-then 表驱动，覆盖全部命令与拒绝，不落盘；每片一条场景验收经公共 MCP 在一次性工作区运行（`tests/scenarios/`），L2 只再加一条 14 步端到端；foundation 与 kernel 每模块一份直接测试，含并发准入（ADR-0013）。

目标反馈门：

| 门 | 职责 |
| --- | --- |
| `typecheck` | project references、strict flags、source boundary |
| `test:focus` | 当前能力的 exact compiled tests |
| `check:fast` | 全量 typecheck、Schema/codegen、shared domain、双 host contract |
| `build:check` | 最终阶段的双 artifact 临时重建与 committed diff |
| `npm test` | 新 TS 门：typecheck、架构规则、TS 测试、Schema 漂移检查 |
| `scenario:acceptance` | 场景验收骨架，聚焦运行 `tests/scenarios/` |
| `test:legacy` | 已退役的旧门：`sync-core` 检查、双 validator、双 smoke、旧回归测试；只手动运行，E4 删除 |
| `test:workspace` | 明确授权的 `WakeWorkspace` 初始化/维护验收 |
| `release:check` | 版本/tag/remote/clean-tree/package closure；仅发布流程使用 |

<a id="ts-dev-safety"></a>
## 12. 环境、安全与变更纪律

- 只修改 Wakeflow 源仓库，不修改 `AlembicWorkspace`；
- `WakeWorkspace` 仅在用户授权的验收阶段使用，可反复删除 Wakeflow 配置后重建；
- fixture、生成清单、错误输出和文档不得包含真实 token、thread/session ID、socket、PID 或机器私有路径；
- 不写插件缓存，不把当前安装态冒充新制品验证；
- 不提交、推送、发版或刷新缓存，除非用户分别明确授权；
- 保留已有及无关工作树修改；不使用 destructive Git 操作恢复；
- 共享旧代码在最终切换前仍按 `core/` + `sync-core` 规则维护，新项目不得让旧规则提前失效；
- 新项目中的债务代码与文件允许删除重写：替代实现的测试通过且对照场景通过后，在同一提交内删除被替代物；跨层或跨 owner 的删除先写 ADR（ADR-0007）；
- 架构重建的设计权属于实施者；两个以上后果不同的可行方案、改变已接受 ADR 或 TSD 约束、改变公共合同形状或层边界、删除旧能力，以及任何提交、推送、发布、缓存刷新，必须由用户确认（ADR-0007）。

<a id="ts-dev-progress"></a>
## 13. 当前进度

| 阶段 | 状态 | 当前事实 |
| --- | --- | --- |
| E0 工程底座 | `complete` | Node 24、TS project references、Schema codegen、架构门和轻量 TS 测试门已建立 |
| E1 能力地图与等级 | `in-progress` | BFS-01～BFS-11 已重新映射；资源处理归一标准已确认；2026-09-03 接受 ADR-0002 到 ADR-0008，形成 TSD-12 到 TSD-16；P0 能力卡讨论进行中，第 1 组工作区与配置已确认；下一步继续能力卡并建立场景验收骨架，不新增业务能力 |
| E2 能力重新实现 | `in-progress` | L0 基础做实与 L1 十个切片（workspace、endpoint、requirement、demand、tasking、delivery、result-review、evidence、pod、observation）已按 ADR-0013 闭合，2026-09-18 observation 切片 10 收口：公共工具恰为 20 个，wire Schema 95 份，Controller Route 不再返回 not-implemented blocker，被替代的旧形状随各切片同一提交删除（记录见 [consolidation-gate-log §13.75 到 §13.96](../progress/consolidation-gate-log.md)）；2026-09-11 源码走读的 §8.1 档已落地（gate-log §13.93）。下一步 L2：hook 观察脚本与两宿主 hook 配置片段先行，再做场景联合与 skills、commands 文本 |
| E3 能力覆盖与场景验收 | `in-progress` | 按 ADR-0008 从新旧对比改为能力覆盖与场景验收；场景验收骨架随每个纵切运行，2026-09-18 达 20 个场景全部 pass（[references/scenario-acceptance.md](../references/scenario-acceptance.md)）；能力映射矩阵 31 项旧工具无一"缺席"（重切或已落地 27、放弃 4）；旧实现只读保留，旧门已退出 `npm test` |
| E4 制品切换与清理 | `pending` | 未授权、未开始；候选构建器目前只产出编译闭包、`mcp/server.mjs`、`.mcp.json` 与 `package.json`，尚不能产出可安装插件，补齐工作列入 §8.1 的 P5 |

旧门最后一次记录：在 Node 24.19.0 下为 `1,821` 个测试（`1,820` 通过、`1` 跳过）。自 2026-09-03 起旧门不再进入 `npm test`，只作为不变量来源以 `test:legacy` 手动运行。

<a id="ts-dev-final-acceptance"></a>
## 14. 最终完成定义

本开发计划完成时必须同时满足：

1. Node 24 是根 package、双插件、类型、开发和验证的唯一最低基线；
2. `src/`、`tooling/`、`tests/` 是唯一手写代码体系；
3. 新实现按确认的能力区块和依赖层级组织，不是旧文件结构的 TypeScript 镜像；
4. 能力映射矩阵全部闭合：D1-D41 与 31 项旧工具能力每条有新 owner 或放弃记录，能力卡的场景验收全部通过；
5. 新测试按证据 owner 覆盖有效不变量，旧测试代码在对比通过后统一删除；
6. 旧 `core/`、旧 `tools/`、旧 `test/` 已删除，没有 `legacy/` 或 wrapper 代码副本；
7. 不保留任何历史 fixture 与 legacy 语料；
8. 两份插件由同一 shared compile 和各自 host overlay 确定性生成，每个产物路径只有一个新 owner；
9. 双 validator、双 smoke 对新制品通过，package closure 与完整仓库门通过；
10. `WakeWorkspace` 可 fresh initialize、删除后重建、reconfigure/reconcile；
11. `AlembicWorkspace` 零读取、零写入、零验证依赖；
12. 未执行的真实 host/session/release 操作明确报告，不由 smoke 或文档冒充；
13. 派发场景（TSD-12）在两个宿主由 Agent 完成一次投递并交回回读证据、Wakeflow 验证通过的端到端验收，或按第 12 项明确报告未执行；
14. `tools/list` 总载荷低于 60 KB，MCP 组合根热启动低于 500 毫秒（TSD-13 与 §8.1 L0 退出门）；
15. 插件版本号从新版本序列起始，`release:check` 的五个版本源一致（TSD-16）。

<a id="ts-dev-change-log"></a>
## 15. 更新记录

- 2026-08-25：创建开发计划，确认 Node 24、全新 `src/`/`tooling/`/`tests/`、TypeScript 单一手写源码、双宿主生成制品与轻量证据目标。
- 2026-08-25：修正为能力重构路线。旧源码、旧测试和旧制品作为完整可执行基线保留至新项目全部完成；废止逐文件迁移登记、`legacy-copy` source manifest、shadow-copy 装配、中途 artifact 切换和同批删除方案；E1 能力地图与能力等级确认前暂停领域实现。
- 2026-08-26：确认新 TS 项目的资源处理归一标准。当前 JavaScript 文件形态不再作为新物理合同；standalone JSON 统一 deterministic pretty bytes，TODO 改为 JSON intake/state authority + Markdown projection，Demand event 初始确定为 immutable JSON record collection，随后经 RH-2 根本审查进一步收敛为 atomic append-commit collection；不引入 FileManager、全资源 storage backend abstraction、JSONL authority 或 normal compatibility 双写。
- 2026-08-26：完成 RH-1 TODO Intake Aggregate。实现 immutable intake、revision state、collection digest、完整 BusinessArchive 授权回执、单向 Markdown projection、collection lock、immutable journal、append/claim/archive CAS 与 dead-owner recovery；删除新 TS Markdown authority 候选和反向 row parser，并在任何物理 effect 前执行 projection/record 容量检查。
- 2026-08-26：完成 RH-2 Demand Core Aggregate 的标准化重构。基于 Ledger/TODO closure，实现 pure Decider 与 Command Handler、typed/versioned stored event/upcaster、一次 append 一个 immutable commit batch、fixed commitSequence no-replace CAS、immutable snapshot + tail、full audit、inactive candidate recovery、revision-1 publication 及跨资源 sidecar/in-root marker/durable rename/exact TODO claim；Ledger journal 同步改为 bounded self-contained record/member bytes，并由批量 canonical resolver 统一 Demand member resolution；删除早期单事件文件、stream lock、pure append journal、全量 load 后改写 snapshot 和 raw materialize/append API；Event Sourcing 仍只用于 Demand Aggregate。
- 2026-09-03：建立开发文档系统（[ADR-0001](../decisions/0001-documentation-system.md)），本文迁入 `docs/plan/` 并成为唯一的阶段与约束权威；核实门日志改为进度记录职责；基础服务需求文档归档。
- 2026-09-03：用户确认 [ADR-0002](../decisions/0002-public-tool-surface.md) 到 [ADR-0006](../decisions/0006-legacy-capability-retention.md) 采用建议方案。回写内容：TSD-03 修订为"authority 语义不变，公共工具面按单一 owner 重切，等价性由能力映射矩阵证明"；新增 TSD-12 宿主效果层内建、TSD-13 工具目录体积预算、TSD-14 事件流快照加尾部读路径、TSD-15 旧能力取舍；§7 与 §9、§10 的 31-tool 对比面改为能力映射矩阵；新增 §8.1 执行顺序 P0 到 P5 及其退出门与 P0 待核实事项；§13 进度表记录 `c0098e2` 事实与已知偏离；§14 完成定义第 4、9 项改写并新增第 13、14 项。
- 2026-09-03：用户确认 [ADR-0007](../decisions/0007-rebuild-mandate-and-bottom-up-flow.md) 并修订 ADR-0003。TSD-12 改为"宿主写效果由 Agent 执行，Wakeflow 内建内容与验证"，不建进程端口，不重建执行型宿主 CLI，keep-live 与 unattended 先放弃；§8.1 由 P0 到 P5 改为 P0 加 L0 到 L3 的自底向上分层，增加允许删除重写的对象列；§11 增加测试轻量规则；§12 增加债务删除守门与设计权确认边界；§14 第 13 项改写。
- 2026-09-03：用户确认 [ADR-0008](../decisions/0008-discard-legacy-and-new-version-series.md)，丢弃全部历史版本，新 TS 为全新版本序列。TSD-03 改为"旧 JS 是场景与需求证据"，TSD-11 改为"只读保留到 E4 一次删除，旧门退出 `npm test`"，新增 TSD-16 配置从 v1 起版且不兼容旧文件；§9 整节改为能力覆盖与场景验收；§8.1 P0 骨架与各层措辞由对照改为场景验收；§10.1 第 6 项不保留 legacy 语料并新增第 8 项新版本序列；§11 旧测试改为 `test:legacy` 手动运行；§14 第 4、7、9 项改写并新增第 15 项。
- 2026-09-04：用户确认 [ADR-0009](../decisions/0009-execution-endpoint-and-host-effect-handshake.md)（执行端点与宿主效果握手；宿主 hook 证据通道与 Codex 证据策略两处调整待复核）与 [ADR-0010](../decisions/0010-worktree-isolated-execution-and-converged-flow.md)（pod 模型：main 是 `primary` 的 pod，一 pod 一时一 Demand，worktree 归产品窗口并由宿主原生能力创建，取消 Design 跨 pod 交接，只有 main 开关 pod）。回写内容：TSD-15 的 Pod 条款改为 pod 模型；L1 切片把"isolated 测试规划、隔离执行位置及其需求锚点"改为"pod 内测试规划、pod 创建与关闭"；§9 状态与 authority 行改为 pod 执行位置。能力卡 5 到 10 草稿完成，待逐组讨论。
- 2026-09-04：P0 收尾。能力卡第 1 到 10 组全部确认；建立 [references/capability-map.md](../references/capability-map.md)（31 项旧工具重切 16、缺席 11、放弃 4；D1 到 D41 与 I3 逐行判定）与 [references/scenario-acceptance.md](../references/scenario-acceptance.md)；场景验收骨架 `tests/scenarios/` 经公共 MCP 在一次性工作区运行初始化、创建 Demand、规划任务三个场景并通过，入口 `npm run scenario:acceptance`。P0 退出门满足，下一步进入 L0 基础做实。
- 2026-09-04：用户确认 [ADR-0011](../decisions/0011-requirement-package-as-single-handoff.md)：需求包成为唯一交接物，确认记录与 TODO 摄入取消，两份文档加必需章节，一个总控一次一个 Demand，同窗口多任务沿用任务包。能力卡 3、4、5 追加修订；能力映射矩阵与场景清单同步；L1 的需求入口切片按此重塑，TS 现有 `intake_todo` 与 `publish_confirmation` 列入删除重写。
- 2026-09-04：用户接受 [ADR-0012](../decisions/0012-flow-convergence-callback-calls-testing-redesign.md)（回传固定效果、三种调用形状、完成即归档、测试记录对比与失败分类、删除 redesign 改为 escalate）。回写：能力卡 4 到 7 追加修订节；能力映射矩阵行 1、7、8、10、12、13、20、21、30 更新，统计改为重切 15、缺席 12、放弃 4；功能与场景总览主流程第 7 到 13 步与 F5 到 F10 同步；场景清单四行重命名；L1 缺席项清单改写。下一步进入架构与切片设计。
- 2026-09-04：用户接受 [ADR-0013](../decisions/0013-target-architecture-and-slice-plan.md)：六层目标架构、切片解剖、三种调用形状的内核实现、单一错误模型、foundation 收敛、20 个公共工具、L1 十个切片顺序。回写：§8.1 L0 与 L1 两行改写；§11 增加 decide 测试与场景验收规则及 `scenario:acceptance` 门；能力映射矩阵新增 §1.1 新工具清单。P0 结束，进入 L0。
- 2026-09-18：L1 observation 切片 10 闭合，L1 十片完成（gate-log §13.94 到 §13.96）。回写：§8.1 L2 行把 hook 观察脚本与两宿主 hook 配置片段列为第一项（§13.94 D9，从 L3 提前）；§13 的 E2 与 E3 行改为当前事实；能力映射矩阵四行"缺席"改"重切"并写场景编号；场景清单 18 项；能力卡 9 追加修订节（Q1 不 spawn git、Q4 不设 verify 前置、Q6 两条维护操作、Q7 首版渲染范围、阈值不进配置）；ADR-0010 未决三项关闭；ADR-0009 与 ADR-0012 未决项追记。
