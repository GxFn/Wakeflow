# 配置、工作区、宿主与入口：逐文件语义审阅

核验日期：2026-10-02。基线 HEAD：`d8fafff33919c728e3a9b91ec04aa50ec5e07f0c`。事实取自包含既有未提交改动的工作树，图页统一标记 `in-progress-worktree`。本分组没有修改运行时、测试、Schema、技能或生成插件。

### 覆盖与方法

[逐文件记录](./workspace-hosts-files.json) 是数组，共 **122 个手写 TS**：configuration 10、workspace 75、hosts 24、entrypoints 12、capabilities/workspace 1。每条含当前字节 SHA-256、职责、实际分支、效果/无效果边界、src 直接消费者、测试关联和发现。对应约 40,232 行源文件。

逐文件读了定义及全部运行语句。高复杂主干、hook observer、tmux/状态栏脚本字符串按原文分段阅读；其余长文件使用 SWC 去类型和注释但保留全部运行语句的视图辅助审阅，并回看接口合同。静态 import 提取只用于补全消费者与测试关联，不作为语义审阅替代。资产字符串内部函数不在 TypeScript AST 符号表内，因此图的源码定位使用导出的资产常量，并明确内部函数名称。

生成的合同没有当作手写源重复计数。核对了配置 v1、公共维护请求/结果、maintenance intent/journal、window-host-binding 的 Schema 与实际 parser/producer/consumer；generated 只作为 Schema 派生物和代码导入接线核验。未运行 Schema 生成，也未改 generated 文件。

测试核验分两档：

- 完整阅读公共维护主用例、Demand runtime recovery、公共 MCP cancellation、stdio shutdown、catalog-binding；核对 preview 零写、plan-drift、真实取消通知不在锁释放后提交、candidate/linked 崩溃后的公开恢复与幂等继续。
- 针对配置 CAS、private mode、维护事务、hook observer、Claude tmux、portable settings、受管正文读取测试输入/调用/断言。维护事务重点核对门后漂移、effect-before-checkpoint、intent-only、配置已写和 terminal-only；tmux 重点核对 once-send、输入框拒绝、adopt/resume、真实 local-HEAD Git 检出和不可读 hook 分片时不发送。其余测试文件的数组仅标记 AST 直接引用，不能据此声称完整测试覆盖。

本分组未运行根 npm test、smoke、登录宿主会话或真实窗口投递，以免与主协调者的统一验证冲突。图谱本地 source/import/symbol/edge/test/link/fingerprint 校验已执行：7页、11图、112条证据边，零错误；143条本组及补审源摘要与当前文件一致，git diff --check通过。Mermaid 实际浏览器渲染由主协调者统一执行。

### 代码事实与图谱更正

| 项目 | 当前实现 | 对图谱的影响 |
| --- | --- | --- |
| 配置 | `wakeflow-config.ts`、`wakeflow-config.schema.json`，schemaVersion 1，governance 是空对象 | 删除旧 config-v3 路径和“仍是v3”的表述。 |
| 三种维护工作 | 私有模式收敛 → reconcile 的 Demand 候选恢复 → 静态物化；前两种完成后再次 reconcile | 不把全部修复画成一个持久 maintenance journal 事务。 |
| 静态事务 | 外/内两次重算、短锁、intent、prepared/executing/terminal journal、config末位、精确退休 | 画出意图与检查点、affected 重放、intent-only 和 terminal-only；不画无依据自动回滚。 |
| 资源所有权 | 外部根只维护受管块；managed支撑面的指令是整文件；settings.local 是 statusLine 单键 | 区分保留用户块外字节、whole-file已知渲染、JSON键CAS三类写入。 |
| 公共 MCP | 20工具、固定executor集合、惰性Schema、SDK signal、canonical/脱敏/容量、stable errors | 新增公共运行调用图与真实直接导入图。 |
| 宿主效果 | Claude Agent运行助手；助手spawn tmux/claude/git；MCP本身不调这些效果 | 不使用“整个插件从不spawn”掩盖实际资产执行。 |
| hook | 声明拓扑定位；session-start扇出，其余先查绑定；字段独立退化 | hook记录与业务事件分开；有界发现不作全局不存在证明。 |
| 文本生成 | 每宿主9个占位符；Claude四命令、Codex无slash命令 | 删除旧六占位符及未接制品表述。 |

### 需要继续跟踪的实际限制

1. **Claude 缺失支撑面根的修复聚合受阻。** `src/workspace/maintenance/wakeflow-static-materialization-preview.ts#inspectSupportMemories` 可计划根重建；但 `src/hosts/claude-code/claude-code-portable-settings-composition.ts#planClaudeCodePortableSettingsComposition` 在非 fresh 且根缺失时加入 support-root-missing，令整个 host contribution blocked。现有维护目录修复主用例使用 Codex。这里记录源码可见差异，未独立执行复现，也没有顺手修改行为。
2. **宿主差异并非全在 hosts。** `src/entrypoints/wakeflow-hook-observer.ts#unwrapHostPrompt` 直接对 Claude pasted/cross-session wrapper 分支；它确实存在，架构图不能把理想边界写成完全已实现。
3. **两个窗口表示层不可混用。** workspace/window-runtime 旧 binding store 的持久合同仍 only-create；当前 endpoint 的 replace/relocate/decommission 由其他 kernel owner 承担。registered projection 仍保留 root-unobserved/preflight blocked，不能据此判定端点已可执行。
4. **宿主文本有一处描述粒度不准确。** Claude hostTrustSteps 把 settings.local.json 的 statusLine 写成“managed block”，实际 owner 实现是 JSON 单键 CAS；已在图上按代码讲清，未改技能源。
5. **TUI 与有界观察有外部限制。** tmux 的输入框/忙碌识别依赖 Claude 界面文本；resume-never-conversed 是保留期内没有 prompt 证据，不是完整历史证明；hook 工作区发现也有枚举预算。测试桩不能证明所有真实宿主版本可用。
6. **低层恢复入口不是公共动作。** prepared cancellation 与 orphan gate retirement 独立导出，但公共 recover 没有自动分派到它们。未将这些函数伪装成已开放MCP能力。

### 重建页面

- [03 工作区总览](../../maps/03-configuration-workspace/README.md)
- [03 直接文件依赖](../../maps/03-configuration-workspace/file-dependencies.md)
- [03 优先分支、事务恢复和配置CAS](../../maps/03-configuration-workspace/runtime-call-flow.md)
- [09 MCP与宿主总览](../../maps/09-public-mcp-host-seams/README.md)
- [09 直接文件依赖](../../maps/09-public-mcp-host-seams/file-dependencies.md)
- [09 MCP调用与取消](../../maps/09-public-mcp-host-seams/runtime-call-flow.md)
- [09 宿主创建/投递/hook握手](../../maps/09-public-mcp-host-seams/host-effect-handshake.md)

这些是本地 Markdown/Mermaid 正典；Figma 派生视图由主协调者同步。本分组未运行 Figma、未提交、未刷新已安装插件缓存。
