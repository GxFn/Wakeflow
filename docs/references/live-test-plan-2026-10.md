# 现场测试计划：1.1.0 第一轮（Claude Code 宿主，macOS）

> 状态：`active`
> 建立日期：2026-10-19
> 上位文档：[docs/README.md](../README.md)
> 相关：ADR-0021（发布模型与平台范围）、[scenario-acceptance.md](./scenario-acceptance.md)（自动化场景的清单）、gate-log §13.176–§13.180

自动化已经覆盖的东西不在这里重跑：25 个公开工具场景在两个宿主上各 pass 一遍，lab 的三类可丢弃实验用真实 MCP 子进程跑完整业务链。现场要证明的是自动化碰不到的那一层：真实 Controller 读着出厂文本、用真实助手开窗口和投递、真实 hook 记录落地、真实 Agent 在产品仓库里干活。每一条都写明"看什么、哪里取证据、什么算过"。

## 1. 前提

1. **安装的插件就是这次构建。** 2026-10-19 时 Claude Code 装的还是 `wakeflow@gxfn 1.0.0`；`npm run --silent wf -- cache refresh --host claude-code --yes` 把 `plugins/claude-code-wakeflow`（版本 `1.1.0`）装进 Claude Code（卸载再安装两步，缓存目录 `~/.claude/plugins/cache/gxfn/wakeflow/1.1.0`）；装完用 `claude plugin list` 核对版本与来源。刷新缓存是独立动作，需要明确授权。**注意加载位置**（§13.183 F-L1-10）：本机的 `gxfn` marketplace 是指向这个检出的 `directory` 源，Claude Code 从检出的 `plugins/claude-code-wakeflow` 就地加载——每次 `build:artifacts:committed` 都会立刻换掉现场正在运行的插件字节（所有会话报 `runtime-artifact-outdated`，Controller 要走"After a plugin update"流程），卸载再安装只刷新缓存副本与登记版本。现场轮次里不想更新环境就不要重建（用 `smoke:candidate`），要更新就在重建后把它当成一次插件更新。
2. **测试工作区是新的，仓库是真的。** 用 `WakeflowTestWorkspace` 系列里尚不存在的目录（2026-10-19 起用 `WakeflowTestWorkspace7`），里面放五个 Alembic 系列仓库的克隆（`Alembic`、`AlembicAgent`、`AlembicCore`、`AlembicDashboard`、`AlembicPlugin`，来源 `https://github.com/GxFn/<repo>.git`），像 WakeflowTestWorkspace 一样做真实的多仓库调度：Controller、Design、Test 加五个产品窗口在 primary pod，账本在工作区内，仓库一律 owner-managed，语言 zh-Hans。这些测试环境可以随意删除重建；AlembicWorkspace 里的原仓库不碰。
3. **助手副本与文本同代。** 工作区已经存在时，先按 Controller 技能"After a plugin update"一节让维护重写 `.wakeflow-local/runtime` 里的助手副本；否则新文本会向旧助手传 `--prompt-ref`，被拒为 `argument-unknown`。新建的工作区不需要这一步。
4. **宿主前提。** macOS、Node 24.19+（<25）在 Claude Code 启动的 PATH 上、`git`、`tmux`；Claude Code 账号已登录。
5. **产品仓库里没有 0.9.x 残留。** 五个克隆带着旧插件写进去并提交的 `.claude/settings.json`（`Bash(git *)`、`Bash(node *)`、`Bash(tmux *)`、`..`）与 `wakeflow:scope` 块；`wakeflow_status` 的 `legacyResidue` 按仓库根列出它们。开窗之前删掉——信任对话框会把列出的预放行一并生效，Wakeflow 写过的根只应列出它自己的规则。2026-10-19 已在工作区 7 的五个克隆里删除（工作树改动，未提交回上游）。

## 2. 场景与通过标准

| # | 场景 | 做什么 | 看哪里 | 什么算过 |
| --- | --- | --- | --- | --- |
| L1 | 初始化与开窗 | 在工作区目录开 Claude Code，说"初始化一个 Wakeflow 工作区"；按 Controller 第 0/1 步走到所有窗口登记完 | `wakeflow_status`、`wakeflow_verify`、tmux 窗口列表 | `verify` 十五门全 pass；status 的 `windows[]` 全部 `registered`；第 1 步只按参考开窗，Controller 没有去读插件实现 |
| L2 | 需求包与 Demand（多仓库） | Design 窗口发布一个跨两个仓库（如 AlembicCore 与 AlembicDashboard）、两条验收标准的需求包；Controller 认领成 Demand，为每个仓库各规划一个实现目标 | `inspect_board`、`status --demandId` | 包上板为 `pending` → 认领后 Route 到 `implementation-delivery-planning` |
| L3 | **按引用投递（K6）** | Controller 准备投递后，用助手 `deliver --window … --handle-digest … --prompt-ref … --prompt-digest …` 发送 | Controller 的 Bash 调用、`record_delivery_outcome` 的 attempt/readback/landing、产品窗口的 `user-prompt-submit` 记录 | Controller **没有**把 prompt 从 stdin 重打，也没有读 `.wakeflow-active` 里的事件文件；`landing` 由 hook 记录证明；`promptRef` 指向的文件确实存在于 `artifacts/permits/delivery/` |
| L4 | 产品窗口实现与回传 | 产品窗口按任务包实现，导入结果，把回调按引用发回 Controller | `import_target_result` 的 `callback.permit.promptRef`、Controller 窗口的 hook 记录 | 回调落地（`callback.status: landed`），完成证据 `confirmed` |
| L5 | **摘要评审（K5）** | Controller 用 `wakeflow_inspect_target_result_review` 传 `detail: "summary"` 后记录 accept | 检查投影、决策结果 | summary 投影的 `snapshotDigest`/`reviewUnitDigest` 被决策接受；没有 `review-unit-stale` |
| L6 | 测试目标、重跑与修复闭环（D4） | real-environment 决策的 Demand：合同两步，第一次让一步 flaky 失败→重跑子集→通过；再来一次 product-defect→escalate 带修复授权→返工→复测 | 测试窗口的逐步记录、`allowedDecisions`、Route 前沿 | 与 `card-07/test-rerun`、`card-07/product-defect-remediation` 的自动化断言一致，但由真实测试窗口产生证据 |
| L7 | 静默回调重发（D7） | 让回调在 Controller 窗口静默超过阈值（比如先把窗口挂起），再 `rearm_delivery` 回调 | 回调代际、`landing` | 第二代落地；超过四代被拒；这是从未现场触发过的路径 |
| L8 | pod 开闭（多仓库） | 创建一个 worktree pod（五个仓库各一个 worktree），在 pod 里跑 L2–L5 的缩短版，归档 Demand，两阶段关闭 pod | `wakeflow_pod` 预览/应用、`git worktree list` | 关闭后 worktree 与临时分支回收，主检出不变 |
| L9 | 插件更新流程（C9/C16） | 在工作区存在的状态下再刷新一次缓存，按"After a plugin update"一节让 Controller 自己换代 | `status` 的 `server-outdated`/`windows-stale`、助手 `resume --in-place` | Controller 先告知再就地重启，其他窗口逐个换代，没有循环重启、没有读插件实现 |

L3、L5 是这一轮新增能力，L7 与 L6 的现场记录是登记 D7、D4 的关闭条件。

## 3. 要带回来的证据

- 每个场景的 `wakeflow_status` 与 `wakeflow_verify` 结果各一份（复制 JSON，不含私有路径就可以进 gate-log）。
- L3：Controller 调用助手的那条 Bash 命令原文与助手输出；`record_delivery_outcome` 的结果。
- L5：summary 投影的 `detail`、`reviewUnit.taskPackage` 形状与决策结果。
- L7：两代回调的 `issuedAt` 与落地记录 id。
- 失败时：`wakeflow_verify` 的失败门、相关窗口的最后一屏、`.wakeflow-local/runtime/hosts/claude-code/observations/` 里最近的 hook 记录文件名（不复制内容）。

## 4. 第一次尝试（2026-10-19，L1 未过）

L1 停在 fresh-initialize 的预览，五个发现（F-L1-1 到 F-L1-5，详见 gate-log §13.181）：selection 形状没地方学、拒绝不点名规则、问答表推荐 managed-block、兄弟 `wakeflow-ledger`（工作区 2 的现役账本）被当成遗留物、拒绝不带残留物种类。修复批落地后重跑 L1。环境侧：Claude Code 启动时自动升级到 2.1.303；用户的全局 `cc-status` hook 让每次工具调用多等 45 s 到 3.5 分钟，现场期间建议临时关掉。遗留物（旧测试工作区与它们的账本）由用户自己清理：Claude 在 auto 模式下不能移动或删除别的工作区的目录。

第二次（2026-10-19，`1b6a816f`，五个 Alembic 克隆）：§13.181 的修复都在现场成立，预览 `ready`，apply 完成，新会话 `self` 登记成功；停在第 1 步给 Design 开窗——助手拒绝 `intent-invalid/role`（F-L1-8：公共 inspect 结果的 `launchIntent` 不带 `role`，助手夹具却带着）。同批记下 F-L1-6（selection 形状进请求 Schema，编译器拒绝带 `details.at`）与 F-L1-7（第一次初始化后必经一次重启，I6 路径）。详见 gate-log §13.182。修复批落地并刷新缓存后，从"After a plugin update"一节换代助手副本，再从第 1 步继续。

第三次（2026-10-19 02:10–05:30，`86ae6708` 起、文本批次 `284c024a` 就地生效）：**L1–L9 全部通过**，详见 gate-log §13.185。L1 在插件更新流程里完成；L2–L6 用一个真实的跨 AlembicCore/AlembicDashboard 的 bug 走完（含 blocked → condition-cleared、测试重跑子集、flaky 判定与最后一次尝试的负载等待）；L8 用 pod `live` 开闭并在 pod 里跑了缩短版；L7 在第三个 Demand 上以"Controller 会话退出、回调发不出、静默窗口后 rearm 第二代落地"现场触发；L9 共三次换代。未覆盖：L6 的 product-defect → escalate → 返工闭环（没有真实缺陷，仍只有自动化 card-07）。

## 5. 结束条件与后续

- 全部场景按"什么算过"通过 → 打 `v1.1.0` tag、推送、`release:check` 真跑一次（各需授权，ADR-0021 规则 3），同时刷新图谱。**2026-10-19：条件已满足，等用户授权。**
- 任何一条失败 → 记进 gate-log 新节，修复后 bump 到 `1.1.1` 再来一轮；不在同一版本号下换字节（ADR-0021 规则 2）。
- 现场通过后再做的事：D5（助手迁成类型化模块）、L6/L4 重构、C6/C11 升级语义、F1/F2/F5 与 K4 的控制、J1/J4 退出路径。
