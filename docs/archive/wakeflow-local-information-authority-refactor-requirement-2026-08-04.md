# Wakeflow 本地信息权威与文档配置重构需求

> 创建日期：2026-08-04
> 状态：阶段 0–5 实施与验收完成，纳入本次源代码提交，未发布
> 适用范围：Wakeflow `core/`、Codex/Claude Code 双插件生成物、相关测试与安装后工作区文案
> 原始需求依据：用户提供的《Wakeflow 本地信息归属、配置、状态与运行时重构分析》
> 核心原则：保留 Agent 的判断自由，用确定性的机器外壳保证信息归属、状态权威、路径推导和历史兼容不分叉。

## 1. 目标

Wakeflow 不更换状态存储，不新增文档审批状态机，也不为目录整齐而迁移历史证据。本需求只解决一个根因：

> 同一概念不得继续在配置、生成文案、Markdown、状态 JSON、模板和历史兼容代码中分别定义。

完成后应满足：

- 配置只表达用户意图；派生路径和职责集合由运行时确定性生成。
- 需求定义、活动状态、长期记录、职责窗口记录、宿主事实和归档各有唯一权威位置。
- `AGENTS.md` / `CLAUDE.md` 只保留身份、硬边界、状态权威和 Skill 路由；操作工艺继续由 Skills/reference 负责。
- `controller-events.jsonl` 记录状态迁移事实，`wakeflow-state.json` 是快照，Markdown/index/status 只能投影事实。
- 新写入遵循新语义；旧配置、旧需求引用和旧运行时结构可读、可解释，但不得重新成为新写入正典。

## 2. 已确认的真实问题

### 2.1 配置反规范化

当前配置同时保存用户输入和大量可推导字段。`repositories[]` 已描述窗口、路径、角色和模式，其他顶层字段又重复保存职责集合和派生路径。风险是多个副本独立漂移，而不是 JSON 文件本身较长。

### 2.2 文档归属缺少单一实现

文档目的地分别写在 setup、storage README、AGENTS/CLAUDE、Skills/reference、模板、配置和校验器中。已经出现 setup 将跨仓需求文档引导到职责窗口 ledger，而 ledger 规则要求需求设计进入共享 `requirement-designs/` 的真实冲突。

### 2.3 常驻规则文件承担了操作手册职责

根、Design、Test 的 AGENTS/CLAUDE 同时包含身份、状态机、Pod、transport、readback、测试工艺和历史兼容说明。它们独立落盘是合理的，但不能继续独立定义相同语义。

### 2.4 `.wakeflow-local` 混合不同寿命的数据

宿主 registry/receipt、进程锁、transport、target evidence、preserved 原件和旧 stream 兼容结构位于同一个宽泛命名空间。现有 storage class 只在说明和扫描投影中表达分类，还没有完全约束新写入布局与 retention。

### 2.5 状态投影可能绕过需求权威

需求权威未冻结时，人工草稿可能仍写着待确认，但状态投影却显示无 blocker、无待决策。Wakeflow 不应解析自由 Markdown 猜测状态；它应根据结构化 authority 是否冻结诚实显示 `draft-unfrozen` / pending confirmation。

### 2.6 历史兼容文案泄漏到当前操作面

Claude stream/worktree/derived overlay 可以继续作为兼容能力保留，但通用 README 和当前操作指引必须明确它们不是 0.9.x Pod 正典。当前 Pod worktree 继续由 Codex/Claude Code 宿主创建和管理。

## 3. 目标信息模型

| 信息类别 | 唯一权威 | 允许的投影或引用 | 禁止成为权威的位置 |
| --- | --- | --- | --- |
| 用户配置 | `wakeflow.config.json` | effective config / layout view | `.wakeflow-local` overlay、生成文案 |
| 需求目标与边界 | `wakeflow-ledger/requirement-designs/<key>/`；冻结后由 state root 的 `demand-authority.json` 钉住摘要 | task package 的 anchor 引用 | Design 草稿、职责窗口 ledger、progress 文案 |
| Goal / stage 决策 | `wakeflow-ledger/goal-stage-confirmation/` | workspace index / record map | 产品职责 ledger、runtime |
| 当前状态迁移 | `controller-events.jsonl` | `wakeflow-state.json` 快照 | progress、status、Agent 自述 |
| 当前状态展示 | `wakeflow-state.json` | progress/index/status/projection | 手工 Markdown 状态 |
| 工作区长期记录 | `wakeflow-ledger/workspace/` | workspace record map | 单个职责窗口 ledger |
| 职责窗口历史 | `wakeflow-ledger/<window>/` 或配置路径 | workspace record map | 需求定义目录 |
| 宿主事实 | `.wakeflow-local` 的 registry/receipt/binding | storage/status view | tracked docs |
| transport / evidence | `.wakeflow-local` 的受控运行时树 | trace/review projection | progress 自述 |
| 归档 | `wakeflow-ledger/workspace/archive/<month>/<key>/` | archive summary/map | 活动 current 根 |
| 操作工艺 | Skills/reference | prompt 的 Skill 路由 | AGENTS/CLAUDE 中的完整操作手册 |

设计草稿的提升链固定为：

```text
Design/docs/current/
  -> 用户确认 / Design handoff
wakeflow-ledger/requirement-designs/<demand-key>/
  -> controller intake / freeze
.wakeflow-active/current/<demand-key>/demand-authority.json
```

Controller 可以直接创建边界明确的需求，但必须从第二步开始，使用与 Design 相同的需求权威合同；不得把 Controller 自己的职责 ledger 当作需求定义目录。

## 4. 兼容与安全边界

- 不批量移动历史 requirement、ledger、archive 或 evidence 文件。
- 旧且可读的非正典 authority 引用只告警，不阻断现有需求；新冻结或重写时必须提升到正典位置。
- 不扫描自由 Markdown 推断 blocker、用户决策或验收状态。
- 不新增 `create-document` / `move-document` MCP 工具；机械路径选择由现有 setup、state、storage、verify 面完成。
- 不把状态迁移到 SQLite。
- 不复制 Git worktree 生命周期；物理 worktree 始终由宿主和 Git 原生能力拥有。
- 新写操作必须先有测试合同；任何物理 runtime 迁移均晚于逻辑分类稳定。
- `core/` 是双宿主共享正典，宿主专属兼容文案和工具留在对应插件接缝。

## 5. 分阶段实施

### 阶段 0：基线固化与偏差登记

工作：

- 保存本需求文档；
- 将阶段开始时的未提交实现按本需求重新分类；
- 明确哪些结果只是地基，不能提前宣称阶段完成。

验收：

- 每个阶段均有代码生产者、消费者、测试和兼容边界清单；
- 当前实现状态使用 `完成 / 部分完成 / 未开始 / 偏离`，不得用测试通过替代需求完成。

### 阶段 1：单一文档归属注册表

建立一个 host-neutral 内部注册表，至少表达：

- requirement authority；
- goal/stage record；
- workspace record；
- window record；
- active state；
- projection；
- host state；
- runtime handle；
- transport；
- evidence；
- preserved audit；
- archive。

以下消费者必须从注册表或同一个派生模型获取语义，不得各自重新写路径规则：

- setup 生成的 AGENTS/CLAUDE Document Destinations；
- Design 提升说明和 requirement starter；
- storage README 与 `wakeflow_view(scope=storage)`；
- demand-authority 放置检查；
- layout/verify 输出；
- 相关模板和语义回归测试。

验收：

- 给定同一配置与文档类别，所有入口返回同一目标目录、所有者和生命周期；
- 代码中不再存在“跨仓计划进入窗口 ledger”一类独立规则；
- 历史引用保持可读，非正典位置只产生结构化迁移警告；
- Codex/Claude Code 共享实现字节一致。

### 阶段 2：配置 v2 与确定性 effective layout

目标配置只保留真正用户输入，推荐正典结构：

```json
{
  "$schema": ".../wakeflow-config.schema.json",
  "schemaVersion": 2,
  "workspace": { "name": "ExampleWorkspace", "language": "zh" },
  "roles": { "controller": "ExampleWorkspace", "design": "Design", "test": "Test" },
  "storage": {
    "activeRoot": ".wakeflow-active",
    "localRoot": ".wakeflow-local",
    "ledgerRoot": "wakeflow-ledger"
  },
  "repositories": [],
  "hosts": {}
}
```

运行时从这些输入派生职责集合、window ledger、current/index/status/TODO/archive/requirement/goal-stage 路径。旧未标版本配置与 v1 继续兼容读取；新 setup 只写 v2；旧 local overlay 只读兼容并提示迁移。

验收：

- 删除任何派生字段不改变 effective layout；
- 同一配置在 Codex/Claude Code 得到字节稳定的 effective layout；
- schema 与运行时手写校验共同拒绝未知未来版本；
- storage/status view 能显示 durable input 与 effective layout 的差异；
- verify 能指出配置漂移，不把兼容回退静默当作新正典。

### 阶段 3：常驻文档瘦身与 Design 提升流程

根和职责窗口 AGENTS/CLAUDE 只保留：身份、仓库边界、状态权威、需求冻结门、Test 门、破坏性/发布门和 Skill 路由。Pod、transport、readback、archive 参数与完整命令顺序留在 Skills/reference。

AGENTS 与 CLAUDE 继续独立生成和维护，但共享同一个语义模型和语义测试，不通过互相引用减少内容。

验收：

- 新 Agent 只读对应常驻规则和一个匹配 Skill，可以回答“我是谁、先读什么、写哪里、何时停止”；
- 常驻文档不包含完整 transport/Pod 操作手册；
- Design 草稿、正典需求、冻结 authority、活动执行状态不混用；
- 既有个人约束和仓库专属规则在 managed block 更新时被保留。

### 阶段 4：状态诚实性与本地 runtime 逻辑分层

状态侧：

- authority 未冻结且 demand 非终态时，投影显示 `draft-unfrozen`，并列出结构化 pending confirmation；
- 冻结后显示 `frozen` 及 digest；
- 终态旧 demand 无 authority 时显示兼容状态，不伪造待决策；
- 不向 `wakeflow-state.json` 写入伪造的用户 decision，只在可再生 projection 中表达结构事实。

runtime 侧先统一逻辑分类与新写入所有权，再决定物理目录迁移。目标逻辑类别为 host state、runtime handles、transport、evidence、preserved。旧路径只读兼容并标注来源；不得一次移动既有 runtime 文件。

验收：

- init、render、status/index 对同一 authority 状态给出一致结论；
- storage map、README、prune/retention 对每类 runtime 给出一致所有者和删除语义；
- 当前 Pod 不再被通用文案描述为 Wakeflow-owned worktree；
- 历史 Claude stream 兼容能力继续通过静态、单元和 smoke 验证。

### 阶段 5：迁移、真实工作区验证与发布准备

- 只为新写入启用新正典；历史文件保留原路径和引用；
- 为真实工作区输出迁移建议与 warning，不自动搬迁；
- 在专用 WakeWorkspace 做 setup、需求创建、authority freeze、派发、回传、review、complete、archive 与 storage view 验证；
- 对 AlembicWorkspace 只做用户明确授权的配置/文案同步，不把产品仓库当 fixture；
- 完成双宿主同步、validate、smoke、全量测试和 `git diff --check`；
- 版本、提交、tag、推送、发布、缓存刷新保持为独立授权动作。

验收：

- 新工作区只生成正典 v2 配置和一致文案；
- 旧工作区兼容读取且迁移警告清楚；
- WakeWorkspace 完整主线闭环健康、归档后 idle；
- Claude Code 即使无法登录，也必须通过静态、单元、artifact validate 和 smoke；
- 未经单独授权不提交、不发布、不刷新缓存。

## 6. 当前实现基线（2026-08-04）

| 阶段 | 状态 | 已落地 | 未完成或偏差 |
| --- | --- | --- | --- |
| 0 | 完成 | 原问题、目标模型、兼容边界和阶段验收已写入本需求 | 后续每阶段仍需追加真实验收记录 |
| 1 | 完成 | document placement 注册表已覆盖需求、阶段、工作区、窗口、活动态、投影、宿主事实、runtime handle、transport、evidence、preserved 和 archive；setup、Design 提升、storage map/README、authority warning、layout/verify 与语义测试均接入 | 静态模板保留默认路径示例，但安装产物必须通过注册表参数化；历史引用继续只告警 |
| 2 | 完成 | setup 只写嵌套 v2 durable input；运行时统一派生 flat effective config；职责集合、角色表、叶子路径与保护前缀不再写回；status/storage 共用 durable-vs-effective 诊断视图；旧 flat/local overlay 只读兼容并告警；双宿主消费者已切换到 effective config | `storage.paths` 仅作为旧自定义叶子路径迁移的高级兼容入口保留；旧 Claude stream overlay 的停止写入归阶段 4 所有权收敛处理 |
| 3 | 完成 | 七项常驻语义由共享 rule model 生成；根、产品、Design、Test 的 AGENTS/CLAUDE 已瘦身；既有 managed block 外规则保留 | 宿主独立文件仍按设计分别落盘，但不再分别定义 Wakeflow 语义 |
| 4 | 完成 | authority 三态统一投影到 state root、workspace status/index；冻结文件完整性进入健康检查；runtime class 与新写入所有权收敛；当前 Pod 与历史 Claude stream 明确分离 | 不物理迁移历史 runtime；旧 Claude stream overlay 继续作为显式兼容 writer，不能成为当前 Pod 或 durable config 权威 |
| 5 | 完成 | WakeWorkspace v2 迁移、真实主线派发/回传/review/complete/archive、终态 runtime/storage 验证及最终双宿主全量门均通过 | 已纳入本次源代码提交，未发布、未刷新缓存；历史 local runtime 按兼容策略保留，不自动搬迁或删除 |

## 7. 阶段验收记录

后续每个阶段在这里追加：

- 实际改动文件；
- 生产者/消费者闭环；
- 聚焦测试与全量门；
- 与原需求的偏差及处理；
- 残余风险；
- 是否允许进入下一阶段。

测试通过只能证明实现未破坏已覆盖合同，不自动证明本阶段需求完成。

### 2026-08-04 — 阶段 1 完成

- 正典实现：`core/scripts/lib/wakeflow-document-placement.mjs`。
- 生产者/消费者：setup 访问卡、Design 草稿提升说明、starter ledger、窗口 ledger README、storage map、storage README、demand-authority readiness、layout 与 next-work warning。
- storage view 新增 effective `layout`，物理树记录同时带 category、class、owner 和 lifecycle；旧 Claude stream worktrees 归为 `legacy`。
- 非正典历史 authority 引用保持可读，只进入结构化 warnings，不改变 dispatch readiness。
- 聚焦测试：92/92。
- 仓库级门禁：Codex/Claude Code validate 与 smoke 通过，双方 MCP 31 tools；完整测试 588/588；core 92 个共享文件同步一致。
- 阶段偏差：没有把静态默认模板改造成第二套运行时注册表；真实 setup 输出统一由注册表参数化，模板默认示例由生成结果测试约束。
- 结论：允许进入阶段 2。

### 2026-08-04 — 阶段 2 完成

- 正典输入：`wakeflow.config.json` 改为 `$schema + schemaVersion + workspace + roles + storage + policy + repositories + hosts` 的嵌套 v2；schema 与 runtime hand checks 拒绝未知版本和 v2 中重新出现的派生旧字段。
- 唯一转换：`normalizeWorkspaceConfigInput()` 负责 durable v2 到 flat effective config，`workspaceConfigV2FromEffective()` 只序列化用户意图；setup 的 `nextConfig` 与 `nextEffectiveConfig` 明确分离。
- 确定性派生：window lists、role map、标准 current/index/status/TODO/archive/requirement/goal-stage 路径、Design/Test repo path 与 `protectedWorkspacePrefixes` 均从根和 repositories 生成。
- 可观察性：`workspaceConfigDiagnostics()` 成为 status/storage 共用的 durable input / effective layout 对照；check-layout/verify 对 legacy flat 与 local overlay 发出迁移 warning。
- 双宿主修复：全量测试发现 Claude host helper 仍直接读旧扁平 controller/design/test 字段；已统一接到 effective config，并保留 `set-unattended` 对 durable hosts 的原形写入。
- 兼容：未标版本与 v1 保持读取；旧 local overlay 仍可读且明确标记 compatibility-only；setup 不覆盖 overlay。
- 验证：Codex/Claude Code effective layout 字节稳定测试通过；双宿主 validate、smoke 与 31-tool MCP surface 通过；完整测试 590/590；core 92 个共享文件同步一致；`git diff --check` 通过。
- 残余：旧 Claude stream helper 仍能为显式 legacy stream-open/close 生成兼容 overlay；阶段 4 已把它限定为 stream-only writer，它不能参与当前 Pod 或 effective config 权威。
- 结论：允许进入阶段 3。

### 2026-08-04 — 阶段 3 完成

- 正典语义：`core/scripts/lib/wakeflow-rule-model.mjs` 统一定义身份、仓库边界、状态权威、需求冻结门、Test 门、破坏性/发布门和 Skill 路由七项语义 ID。
- 生成面：root workspace memory、产品职责访问卡、Design/Test 内部 memory 均从 rule model 生成；Codex 与 Claude Code 继续分别落盘 AGENTS/CLAUDE，但不再复制插件 bundle 中的大段角色操作手册。
- 分工边界：常驻规则只回答身份、权威、写入目的地、停止条件与 Skill 路由；controller-return、readback、Pod 和 archive 命令顺序仍由 Skills/reference 负责。
- 保留行为：setup 更新 managed block 时，原有 managed block 外的用户/仓库规则保持不变。
- 验证：阶段结束时完整测试 592/592；双宿主 validate、smoke 与 31-tool MCP surface 通过；core 共享文件同步一致。
- 结论：允许进入阶段 4。

### 2026-08-04 — 阶段 4 完成

- authority 结构事实：`demandAuthorityProjectionStatus()` 成为 init、render、active-demand inspection 和 workspace projection 的共同判断；非终态未冻结为 `draft-unfrozen`，冻结为 `frozen`，无 authority 的历史终态为 `legacy-terminal-unfrozen`。
- 诚实入口：workspace status/index 显示冻结 digest、待确认 demand 清单和历史终态兼容状态；未冻结不会被伪装成 corruption，也不会向 `wakeflow-state.json` 写入用户 decision。
- 完整性：frozen authority 的 ref、digest、文件类型和内容 hash 纳入只读 active-demand inspection；被篡改的 authority 会使 workspace/delivery health 降级。仅在 demand projection 声明 `synced` 时校验其 authority 切片，合法 stale projection 不被误报。
- 时序修复：首个 implementation package 冻结 authority 后立即刷新 workspace entry；demand progress 仍保持 `stale`，直到显式 render，避免把工作区入口留在错误的 pending 状态。
- runtime 所有权：storage map 统一显示 host state、runtime handles、transport、evidence、preserved；`wakeflow-next-work --write` 从已标记 legacy 的 `wakeflow-intake/` 改写到 `wakeflow-delivery/handles/`。旧路径只识别，不自动搬迁或删除。
- Pod/兼容：通用文案继续声明当前 Pod 使用宿主创建的 worktree；`.wakeflow-local/worktrees` 仅为 legacy Claude stream。18 项 Claude host/helper 测试保留通过。
- 验证：阶段聚焦 33/33；双宿主 validate、smoke 与 31-tool MCP surface 通过；完整测试 594/594；core 93 个共享文件同步一致；`git diff --check` 通过。
- 结论：允许进入阶段 5。

### 2026-08-04 — 阶段 5 完成

- 旧工作区迁移：WakeWorkspace 从旧 flat 配置写回嵌套 v2；effective layout 保持不变，显式 `PodFixture.managedAgents=false` 没有被默认值覆盖。由此发现并修复 setup 在迁移时丢失已有 unmanaged repository boundary 的问题。
- runtime 诊断：`.wakeflow-local/pod-reservations` 只作为 migration-only legacy tree 展示，不再被 storage map 误报为 unknown；新写入仍不使用该目录。
- 真实 authority 时序：需求初始化时 workspace entry 为 `draft-unfrozen`；首个 research task package 原子冻结 authority 后，workspace status 显示 `frozen` 和 digest，demand progress 保持 `stale` 直到显式 render。
- 真实提示词问题：派发预览发现 `demand-authority.json` 仍以 workspace-relative 路径进入目标提示词，目标仓库 cwd 下无法按“开始前读取”直接定位。现保留 portable `ref`，同时新增绝对 `resolvedRef`，提示词使用后者；回归测试覆盖职责仓库 cwd。
- 真实主线闭环：使用既有 WakeWorkspace / AlembicCore Codex 职责窗口完成一次只读 task package 派发。目标证据记录 host cwd、显式 repository `pwd -P`、branch、HEAD、父/仓库 AGENTS 边界与前后逐字节一致的 `git status --short`；总控独立复跑字段合同、cwd、branch、HEAD 和实时 status 后才 accept。
- transport 时序：目标派发与 controller-return 都由宿主接受，但单次有界读回当时未见新 turn，诚实记录为 `sent-unconfirmed`，没有重发。迟到 controller-return 在需求归档后到达时，控制窗口识别为过期 wakeup，只读确认归档终态且不重复写 review；归档 transport 历史未污染 live runtime。
- 归档与隐私：绝对路径在 portable archive 中被替换为 `<workspace-root>`，未脱敏原件进入 `.wakeflow-local/preserved/`；归档后 active demand 为 0，workspace status 为 `idle`，delivery runtime 为 `idle/healthy`，无 `.workspace-local`，storage unknown tree 为 0。
- 真实工作区门：`wakeflow-verify --with-runtime`、workspace docs、layout、repository residue、runtime residue 与 `git diff --check` 全部通过。产品仓库原有 dirty 状态保持不变，未作为 fixture 修改。
- 最终仓库门：core 93 个共享文件双插件同步一致；Codex/Claude Code validate、smoke 和 31-tool MCP surface 通过；完整测试 596/596；Claude Code 无需登录即可完成静态、单元、artifact validate 和 smoke 验证。
- 结论：本需求定义的阶段 0–5 已完成并纳入本次源代码提交。版本、tag、推送、发布和缓存刷新继续等待独立授权。
