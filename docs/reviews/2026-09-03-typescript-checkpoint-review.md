# Wakeflow TypeScript 关键节点评估

> 状态：`accepted`，评估结论与第 8 节建设计划已经用户确认
> 评估日期：2026-09-03
> 基线提交：`c0098e2`，工作树干净
> 上位文档：[docs/plan/typescript-reimplementation-plan.md](../plan/typescript-reimplementation-plan.md)
> 裁决：[ADR-0002](../decisions/0002-public-tool-surface.md) 到 [ADR-0006](../decisions/0006-legacy-capability-retention.md) 于 2026-09-03 接受；第 8 节的 P0 到 P5 已回写为开发计划 §8.1，约束新增 TSD-12 到 TSD-15。此后以开发计划为权威，本文只作评估记录

本文记录在 `c0098e2` 节点对新 TypeScript 体系的架构与实现评估、对照旧 JavaScript 场景的方向缺口、业界实践对照和分阶段建设计划建议。度量方式：直接读码、脚本计数、实际运行。未运行的项目见第 9 节。

## 1. 结论

技术底座已经建成并且质量高，但当前路线在四个方向上偏离了"功能一致的架构升级"这个目标：

1. 公共面与旧 31 工具不兼容，且两份文档给出相反裁决；tools/list 载荷从 40 KB 涨到 330 KB。
2. 宿主效果层整体缺席，旧场景中用户获得价值的派发、观察、维持会话、回收资源没有落点。
3. 事件溯源读路径是 O(n)，快照只写一次，一次写命令读 5 遍事件流，测试墙钟接近旧体系。
4. 手写代码量已超过旧体系而覆盖功能更少，样板代码占比高，脱敏逻辑漂移。

建议在这个节点停止"再公开下一个工具"的推进方式，先裁决 ADR-0002 到 ADR-0006，再进入以收敛和对照为目标的阶段。

## 2. 当前状态

| 区域 | 文件 | 行数 | 说明 |
| --- | ---: | ---: | --- |
| foundation | 63 | 21,908 | 已冻结扩张，347 项测试 3.6 秒 |
| configuration | 10 | 3,355 | Config v3 权威快照与替换 |
| workspace | 81 | 27,669 | maintenance 22 文件是最大事务面 |
| governance | 213 | 84,709 | 占手写源码 60% |
| hosts | 11 | 2,130 | profile 数据与 settings 写入 |
| entrypoints | 34 | 2,680 | 23 工具，4 组注册文件 |
| schemas 与 generated | 114 与 114 | 28,345 与 13,427 | 215 个跨文件 `$ref` |
| tests | 262 | 64,424 | 1,023 项，全部真实临时目录 |
| 旧 core/ | 94 | 126,739 | 31 工具，零运行时依赖 |
| 旧 test/ | 116 | 89,694 | 1,821 项，386 秒 |

全量 TS 门：1,023 项通过，墙钟 6 分 07 秒，单测累计 2,037 秒，78 项单个超过 10 秒，最慢 48 秒。架构门 823 模块零违规。MCP 组合根热启动实测 1.9 秒，冷启动约 4.6 秒。开发计划完成定义 12 项：1 项是，5 项部分，6 项否。

## 3. 已经做对的部分

- 分层被三套机制机械化约束：dependency-cruiser 18 条规则、六个 TS 工程引用、制品构建静态闭包检查。
- foundation 持久化正确性高于旧体系：硬链接创建、rename 替换、文件与父目录 fsync、三次节点身份比对。
- JSON Schema 单一 wire 权威，codegen 两次生成逐字节比对。
- Demand 是唯一事件溯源聚合：纯函数 Decider、单原子 commit、固定 expectedStreamRevision 的 CAS、按 commitId 幂等重放。
- preview、apply、recover 三段式与脱敏错误信封贯穿 23 个工具，摘要在 apply 时重新推导。

## 4. 架构层问题

| 编号 | 问题 | 证据 | 级别 |
| --- | --- | --- | --- |
| A1 | 公共面不兼容，两份文档裁决相反 | 23 工具中 4 个与旧同名；plan TSD-03 与 gate §13.32 冲突 | P0 |
| A2 | tools/list 膨胀 8 倍 | 329,652 字节约 94,000 token，旧 39,782 字节；单工具 4.6 到 30.7 KB；apply 携带整 plan，嵌套 5 到 8 层 | P0 |
| A3 | 宿主效果层缺席且规则禁止在领域层补 | hosts 11 文件 2,130 行对旧约 13,000 行；src 唯一 child_process 在 git 观察；foundation 无进程端口 | P0 |
| A4 | 事件溯源读路径 O(n) | publishSnapshot 单一调用点；audit 上下文 19 文件对 read 上下文 2 文件；一次 apply 读 5 遍；append 约 600 加 50N 次系统调用、6 次 fsync；10,000 commit 硬墙 | P0 |
| A5 | 制品与切换路径未实现 | 构建器只出 4 类文件；缺 plugin.json、skills、commands、README、宿主记忆、脚本、assets；releaseEligible 字面量 false；输出围栏在 .build；6 of 8 恢复 owner 不在闭包；config interfaceLanguage 到 presentation.language 无迁移；插件 engines 仍 node 20 | P0 |
| A6 | 层边界白名单化，治理层内部无分层 | workspace 与 governance 双向白名单；治理内 290 条跨目录引用、8 对互依；94 个非 codec 文件引用 generated 类型，仅 1 个 codec | P1 |
| A7 | 测试策略与轻量化背离 | 10 个独立工作区 fixture；39 模块 9,713 行无直接测试，含事件存储 reader 的并发准入门 | P1 |
| A8 | 三份文档互为权威并漂移 | 已由 ADR-0001 处理 | P2 |

## 5. 代码实现问题

| 编号 | 问题 | 度量 | 级别 |
| --- | --- | --- | --- |
| C1 | 样板未下沉 | 301 错误类，306 消息表，43 份 assertRoot，30 份 isAbortSignal，40 份 assertNotAborted，55 份 parseOptions；治理层 11.2% 行在 catch 块 | P1 |
| C2 | 22 个公共协调器无共享内核 | 8,075 行，每个约 140 行结构相同，三方交叉 106 行逐字相同 | P1 |
| C3 | 脱敏漂移 | containsPrivateText 两种签名 13 份，containsText 8 份，privateBoundaryValid 1 份；私有值集合 3 种策略；结果上限 8 种取值 128 KiB 到 32 MiB | P0 |
| C4 | 聚合转换至少 4 次全量解析 | parseDemandAggregateState 在入口、出口、摘要、evolve 各一次；commit 准备双重 evolve | P1 |
| C5 | 15 事件词汇 5 文件手工重复 | Decider 两条 15 分支 if 链无 never 守卫；新增事件至少改 10 处；22 个 frontier 同样分散 | P1 |
| C6 | cancel-demand 完整但不可达 | 命令、事件、codec、转换齐全，无 service、工具或 blocker | P1 |
| C7 | commitId 两套来源 | 4 个 service 随机 UUID，target-result 前缀交换 eventId 与 commitId；uuidFrom 6 份 5 名 | P1 |
| C8 | 宿主适配器同构 | 12 对文件只差宿主名，8 个纯透传 | P2 |
| C9 | managed-integration 三件套重复 | 15 文件 6,386 行，约 900 行重复；support-memory 不用共享 marker 引擎 | P2 |
| C10 | 启动与工程门 | 110 个模块级 Ajv 实例；无 lint 与格式脚本；无文件大小与复杂度限制 | P2 |

命名不一致：outcome、observation、observed 三名一物；publication 在治理层四义；controller-* 对 target-result-*；delivery 与 dispatch 并存；领域术语 TODO 与注释标记冲突。

## 6. 对照旧场景的方向缺口

| 场景 | 旧能力 | TS 现状 | 判断 |
| --- | --- | --- | --- |
| 初始化、重配置、对账、恢复 | maintain_workspace、init 与 check 命令、setup 与 bootstrap | 三段式完整；recover 只达 maintenance；无 setup 入口 | 部分 |
| 窗口注册、替换、租约、释放 | register、replace、release、2 小时租约 | 只有 register | 缺席 |
| 派发与宿主效果 | prepare 与 record delivery；tmux paste 加信封复核与回读；thread 工具；transport-recover | 四步握手，执行交给 agent；无 transport 与回读证据 | 缺席，产品核心 |
| 活动观察、keep-live、无人值守 | activity monitor、prompt-temp、keep-live、unattended、activation scope | 三个布尔落地为空目录 | 缺席 |
| Pod 多需求并行 | 4 个工具，约 7,000 行 | 无 | 待决，ADR-0006 |
| TODO 板 | deliver、next_work、claim_next | intake_todo、inspect_todo；认领并入 create_demand；route 替代 next_work | 重切 |
| Demand 生命周期 | create、complete、cancel、continue、recover_state_transition | create、complete 公开；cancel 不可达；continue 无；recover 有意放弃 | 部分 |
| 任务与测试卡 | add_task、intake_test_card | plan_target_task、plan_test_card；isolated 有 blocker | 重切 |
| 结果、评审、返工 | 4 个工具 | 6 个工具，reduce 内部 | 重切 |
| 研究型需求与重设计 | demandType research；redesign lineage | not-implemented blocker | 缺席 |
| 证据 | record_evidence、隐私扫描 | record 公开；reader 不公开 | 部分 |
| 归档、保留、清理 | archive、storage_preserve、prune_runtime | 只有 TODO 条目归档 | 缺席 |
| 观察与校验 | status、view、verify | route 替代 status；view 放弃；verify 无 | 部分 |
| legacy 迁移 | bootstrap 与 migration | 无 | 待决 |
| skills、commands、templates、README | 插件静态资产 | 候选制品不产出 | 缺席 |

方向判断：TS 深耕的是控制器决策链，旧体系让用户获得价值的是决策链两端的宿主效果与运行维护。当前路线把两端留给以后；如果继续按"公开下一个工具"推进，决策链越精致，产品仍不能派发一次真实任务。

## 7. 业界实践对照

| 实践 | 来源 | 对 Wakeflow 的调整 |
| --- | --- | --- |
| 少量面向工作流的工具、扁平参数、可控响应长度 | Anthropic 工具设计指南；Microsoft Research 工具空间干扰；MCP 2025-11-25 规范 | outputSchema 去内联；apply 改 planRef 加摘要；description 压缩；检查类工具加 response_format 与分页 |
| Decider、可预测幂等键、快照是最后手段 | Oskar Dudycz；Kurrent | commitId 由命令内容派生；快照每次 apply 后刷新；Demand 完成后封流归档 |
| 文件与父目录都 fsync，rename 不等于持久 | Pillai 等 OSDI 2014 | foundation 已符合；可把一次命令内多文件写合并到一次父目录 fsync |
| 跨进程锁：续租式 stale 或显式恢复二选一 | proper-lockfile | 保持不自动破锁，前提是每个锁 owner 的 recover 入口对操作者可达 |
| Ajv 预编译独立校验器 | Ajv standalone；Fastify 经验 | codegen 阶段生成校验函数或共享实例惰性编译 |
| 依赖规则、死代码、复杂度三件套 | dependency-cruiser、eslint-plugin-boundaries、knip、cognitive-complexity | 增加 lint 边界规则守住 generated 只允许 codec 引用；knip 找不可达代码；复杂度上限 15 |
| 大爆炸重写风险靠早建的等价对照对冲 | Strangler Fig 文献；TSB 2018 案例 | 不改变最后原子切换，但把对照工具提前到 P0，每个纵切完成即跑 |

来源链接见附录。

## 8. 建设计划建议

先裁决 ADR-0002 到 ADR-0006 与已接受的 ADR-0001，再按六个阶段推进。周数为粗估。

| 阶段 | 目标 | 主要工作 | 退出门 |
| --- | --- | --- | --- |
| P0 冻结与对照基线，1 到 2 周 | 不新增业务能力 | 完成 ADR 裁决并回写计划；能力映射矩阵；等价对照工具骨架覆盖初始化、创建 Demand、规划任务三个场景 | 矩阵无空行；对照工具能运行并报告差异 |
| P1 收敛技术债，2 到 3 周 | 只做减法与提取 | 协调器共享内核；样板下沉 foundation；宿主入口工厂；事件与 frontier 表驱动加 never 守卫；lint 与格式门；knip；Ajv 预编译 | 协调器行数降 40%；治理 catch 行占比低于 5%；热启动低于 500 毫秒；tools/list 低于 60 KB |
| P2 事件溯源性能，1 到 2 周 | 读路径 O(1) 常态 | 快照刷新；默认读上下文；单次加载复用；转换边界一次解析；commitId 单一来源；reader 直接测试；cancel 接入或加 blocker | 一次写命令读一次事件流；100 commit 下 append 低于 50 毫秒；治理测试墙钟降一半 |
| P3 宿主效果层，3 到 4 周 | 补齐与旧场景差距最大的一层 | foundation 进程与 PTY 端口；Claude tmux transport 与回读；lifecycle、locator、activity、keep-live；Codex thread 门面；宿主 CLI；窗口替换与租约 | 真实 tmux 会话 smoke 通过一次投递加回读；对照工具覆盖派发 |
| P4 剩余业务，3 到 4 周 | 按 ADR-0006 裁剪 | continue 与 cancel；research 与 redesign；归档保留清理；证据读取；verify 入口；config 迁移 | route 无 not-implemented blocker；矩阵每行有 owner 或放弃记录 |
| P5 制品与切换，2 周 | 对应 E3 与 E4 | 构建器产出完整插件；releaseEligible 真实路径；插件 engines 升 node 24；全量对照；原子切换；删除旧体系 | 完成定义 12 项全部为是；WakeWorkspace 真实初始化、删除重建、重配置 |

P1 与 P2 不增加功能，但决定 P3 与 P4 每个能力要花多少代码。跳过它们直接进入 P3，宿主效果层会以同样的样板密度再增加两到三万行。

## 9. 未运行与未验证

- 双插件 validator 与 smoke、旧 JS 全量门、真实宿主会话均未运行。
- "6 of 8 恢复 owner 不在发布闭包"与"一次写命令读 5 遍"两条来自代码审计代理的报告；本文复核了调用点计数、快照唯一调用点、事件存储无锁、cancel 无调用方、脱敏实现计数、结果上限取值计数，与报告一致。

## 附录：外部来源

- Anthropic, Writing effective tools for AI agents. https://www.anthropic.com/engineering/writing-tools-for-agents
- Microsoft Research, Tool-space interference in the MCP era. https://www.microsoft.com/en-us/research/blog/tool-space-interference-in-the-mcp-era-designing-for-agent-compatibility-at-scale/
- MCP Specification 2025-11-25, Tools. https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- Oskar Dudycz, Straightforward Event Sourcing with TypeScript and NodeJS. https://event-driven.io/en/type_script_node_js_event_sourcing/
- Oskar Dudycz, Idempotent Command Handling. https://event-driven.io/en/idempotent_command_handling/
- Kurrent, Snapshots in Event Sourcing. https://kurrentdb.kurrent.io/blog/snapshots-in-event-sourcing
- Pillai et al., All File Systems Are Not Created Equal, OSDI 2014. https://www.usenix.org/system/files/conference/osdi14/osdi14-paper-pillai.pdf
- proper-lockfile. https://github.com/moxystudio/node-proper-lockfile
- Ajv, Standalone validation code. https://ajv.js.org/standalone.html
- eslint-plugin-boundaries. https://github.com/javierbrea/eslint-plugin-boundaries
- Claude Code plugins README. https://github.com/anthropics/claude-code/blob/main/plugins/README.md
