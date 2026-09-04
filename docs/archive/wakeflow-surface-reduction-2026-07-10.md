# Wakeflow 表面积削减（2026-07-10）

对"功能基本完备"后的 Wakeflow 做过度设计与冗余审视（两条独立审计线 +
真机舰队使用体感），结论：核心循环不过度（状态机/锁/证据门在真机与并发
回归下每分复杂度都有回报），过度设计集中在**表面积**——同一能力多重入口、
无人使用的端点、同一事实多处落盘、双版手维护无守卫。按 删/并/结构 三波
落地，全程测试钉住、行为与输出形状不变。

## W1 删（6d38ef6）

- 死状态 `accepting`/`paused` 出 enum 与全部守卫（12→10 态）。二者是上轮
  审计的"预留状态"：`accepting` 只作 review 候选的 candidateState 词汇存续；
  `paused` 的"手工设置、无 reducer"逃生门被有审计事件的 `cancel-demand`
  取代——手改机器态不再是被认可的形状。
- `wakeflow-progress-log.mjs`：零运行时调用方，进度时间线由状态命令自带的
  progress-appends 写；route-fixtures 改断言自动时间线。
- claude-host `attach-window`（孤儿打印）与 `release-lock`（锁释放的第三
  重复制；正典是 `wakeflow_release_window_lock`）。
- demand-sequence 的 manifest 三件套 status/claim-next/sync-doc（907→420
  行）：零 MCP/skill/散文使用面；存活面是 TODO 板认领路径
  （create-demand/claim-todo），其覆盖在 demand-create 与
  lifecycle-record 测试。cli `sequence` 壳随之删除。
- 幽灵配置字段 `ideTestWindow`。

## W2 并（127c926）

- **配置单一事实源**：磁盘只留 `repositories[]`；四份平行窗口清单
  （dispatchWindows/requiredDispatchWindows/repoNames/repositoryRoles）由
  loadWorkspaceConfig 读时派生（含 repositoryRoles 的反向派生），显式旧值
  仍生效，setup 重生成时剥除遗留副本；window-runtime 的裸配置读者改走
  共享 loader（保持 overlay 优先）。
- **评审判据单源**：两个 ControllerReviewPack 构造器重复的 13 个 gate 键
  与逐字节相同的 intentCheck/craftCheck 建议文案，抽为
  `reviewAdvisories`/`sharedReviewGates`/`rawEvidenceRequiredFrom`
  三个共享构件，双构造器组合复用。

## W3 结构

- **孪生纳管**：六个两版逐字节相同却各自手维护的文件
  （wakeflow-target-craft/SKILL.md + governance 五个 references：
  design-test-skill-realization-source-map / phased-migration /
  skill-writing-style / testing-validation / todo-backlog）收编进 core，
  由 sync-core 分发（core 69→75 文件）——一次维护，`check:core`
  从此机器强制平价。
- **措辞分叉消除**：codex governance 的 "one combined task package" 统一为
  与 claude 一致的 "ONE combined task package"；词汇 lint 删除大小写分叉。

## 基于证据保留（审计判断的修订）

- **wakeflow-cli 壳子命令**：script-pipeline 参考把它当操作者命令索引在
  系统性教学（sync/loop/next-work/intake 全有指引）——有真实消费面。
- **DeliveryEnvelope 对 DispatchPacket 的字段复制**：信封是自包含传输契约
  ——`wakeflow-claude-host deliver --delivery-file` 单文件读取
  prompt/targetWindow 完成一步投递；引用化会把单文件传输拆成两文件装配，
  操作性劣化大于字段去重收益。复制是承重的（类比网络包内嵌头部），保留。
  同族的 ControllerReturnEnvelope 共享传输脊（record-delivery-run 同一
  函数接受两种 kind）同理保留。
- **pod 三组同名入口**：统一波的 `fleet.transport` 分流即正典化——
  claude 走 host 助手、codex 走 MCP 工具，工具描述已明示分工；core
  `wakeflow-pod` 是实现层。

## 待议（未做，规模到了再说）

- 散文单源生成（正典段落数据驱动，host-profile texts 模式扩展）：改一条
  规则仍需动约 7 个手维护文件，词汇 lint 钉住关键句；等下一次规则批量
  变更时评估是否值得建生成器。
- 文档投影扇出（同一状态 6 处投影、starter 13 表面）：瘦入口契约
  （`wakeflow:doc-contract: thin` 标记）已提供治理出口；starter 默认
  瘦化留给使用数据说话。
