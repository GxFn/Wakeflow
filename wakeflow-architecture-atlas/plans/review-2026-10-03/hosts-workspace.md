# 配置、工作区、宿主与公共入口增量复核

核验日：2026-10-03。基线为本轮 `source-baseline.json`，不是 Git HEAD 差异。对所分配目录中相对 10 月 2 日已核验字节发生变化的 **23 个手写文件、8,795 行**重新全文语义审阅；Claude tmux 文件内嵌脚本逐段阅读，未仅以字符串摘要替代代码检查。逐文件职责、分支、效果、直接消费者、测试锚点与 SHA 见 [hosts-workspace-files.json](./hosts-workspace-files.json)。未改变的旧记录继承本轮基线明确匹配的 SHA，没有覆盖或改写 10 月 2 日证据。

另外对照了 8 份变更 agent-text、5 份变更 Schema 中与职责有关的字段和真实消费者，以及 ADR-0018、0019。Schema 和测试不计入上述 23 个手写文件数；未声称所有相关测试逐行穷尽审阅或执行。

## 当前实现事实

| 变化 | 真实边界与影响 |
| --- | --- |
| 当前配置 v2 | parseWakeflowConfig 严格拒绝 v1/v3；普通写作用域轻读同一当前版本词汇。reconfigure/reconcile/recover 是当前格式维护，没有升级动作、旧格式读取或停写确认参数。 |
| 工作区作用域接入维护 | 静态维护持关联 maintenance gate 后申请 exclusive，等待在途 shared 写者；存在事务残留时普通写者要求 recover。Demand runtime-recovery apply 显式独占；private-mode-convergence 仍逐节点 CAS，没有同一作用域包装。 |
| 窗口投影来源与登记锁一致 | refresh 在 shared 范围内读取 Config authority，binding store 锁内再次取得配置和完整 inventory，编译与发布同锁。skeleton 仅 no-replace 创建，target-exists 保留后来登记的文档。 |
| Codex 项目聊天 | launch.kind 为 project-thread，所有角色使用同一外层项目的 project/local。SessionStart 严格工作区根；executionRoot 独立来自配置根或已登记产品检出。 |
| 产品 worktree | 产品仓库 local HEAD 的 git worktree add 与聊天创建分开；Codex 登记要求显式绝对 worktree.executionRoot 及 Git 原文。Claude 继续从 SessionStart cwd 选检出，拒绝该额外覆盖。 |
| 宿主纯渲染端口 | 两个 entrypoint 分别注入 renderCodexWindowLaunchInstructions / renderClaudeCodeWindowLaunchInstructions；共享 endpoint 只提供领域事实，既不找项目也不创建会话。 |
| 进程 manifest 守卫 | 固定 beforeMutation 在非readonly、非preview、非inspect 的分派前重新核验同路径 manifest；缺失/改变拒绝 executor。源码测试无生成manifest时允许跳过。该守卫不核全部payload，也不辨认宿主选择的兄弟安装。 |
| 观察主体分离 | hook 的 observerManifestDigest 只证明观察器。窗口 runtime 仍 unverified，strict verify 计 unavailable；SessionStart/Stop 不证明目标常驻 MCP 或技能已重载。 |

## 保留的实现限制

- 项目归属由 Agent 通过宿主回读或直接 UI 确认，当前绑定 Schema 没有 projectId 字段；自动测试不证明桌面侧栏归属成功。
- Claude 非 fresh 的缺失 managed support root 仍在 planClaudeCodePortableSettingsComposition 被标记 support-root-missing，并由 planContribution 聚合为 blocked。共享层安排重建根不绕过该宿主停止点；本轮仅源码分支核对，未单独运行该场景。
- hook observer 的 unwrapHostPrompt 仍在共享 entrypoint 内按 Claude 做传输外壳特例；不能把“所有宿主区别都已迁到 hosts/”写成绝对事实。
- tmux TUI 检测仍依赖输入框、菜单与工作中文本形状；没有保留期内 prompt 记录，只能说明当前证据缺失。源码内部分 helper hint 仍使用较强的 never-held-conversation 措辞，图谱保留其证据边界。
- agent-text 中 statusLine 的 managed block 说法仍比实现宽泛：真实 owner 对 settings.local.json 的单键做条件更新，不是 Markdown 受管块协议。

## 测试证据与本轮执行范围

已核对实际断言：

- `tests/configuration/wakeflow-config.test.ts#parseWakeflowConfig`：拒绝非当前格式。
- `tests/capabilities/workspace/operation-scope.test.ts#executeCodexWakeflowMaintenance`：维护等待在途投影、旧版本不升级、配置已写后的中断保留阻断，recover 后再次放行。
- `tests/workspace/window-runtime/wakeflow-window-runtime-projection-maintenance.test.ts#refreshWakeflowWindowRuntimeProjections`：旧调用者配置不回写；双宿主 refresh/execute/skeleton 不覆盖并发注册。
- `tests/capabilities/endpoint/service.test.ts#executeWindowBindingRequest`：四类 Codex 角色均要求工作区根 SessionStart；子目录 hook 不能冒充项目聊天。
- `tests/capabilities/pod/service.test.ts#executeWindowBindingRequest`：真实一次性 Git 检出的 executionRoot、主检出拒绝及跨 Pod 占用。
- `tests/entrypoints/wakeflow-artifact-mutation-guard.test.ts#resolveWakeflowArtifactIdentity` / `#createWakeflowPublicMcpServer`：manifest 变更/缺失拒绝，preview 继续可用且 apply 在 executor 前停止。
- `tests/capabilities/observation/service.test.ts#assertArtifactIdentity`：即使新 hook 摘要与当前构建一致，目标 runtime 仍 unverified；自身磁盘摘要改变单独报错。
- `tests/artifacts/agent-text-live-guidance.test.ts#CODEX_AGENT_TEXT_PLACEHOLDERS`：项目/local、执行根、ready句柄、回读及含混创建处理文本。文本断言不代替实际宿主效果。

本子任务未另起 npm test、制品构建或真实宿主操作。根代理统一运行测试，交付记录应以其实际结果为准；本子任务只执行图谱结构核对。生产源码、测试、Schema、制品和 10 月 2 日记录均只读。

## 更新的阅读面

[03 维护总览](../../maps/03-configuration-workspace/README.md)、其导入与运行图，以及新增的 [作用域与配置基线](../../maps/03-configuration-workspace/operation-scope-and-config-baseline.md)；[09 宿主总览](../../maps/09-public-mcp-host-seams/README.md)、其导入/MCP/hook图，以及新增的 [项目聊天与执行根](../../maps/09-public-mcp-host-seams/project-chats-and-execution-roots.md)。新增四张图将作用域时序、投影发布、纯说明端口、Agent创建与程序登记分别表达。
