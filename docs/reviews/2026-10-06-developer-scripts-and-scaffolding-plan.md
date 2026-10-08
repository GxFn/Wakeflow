# Wakeflow 开发便捷脚本与脚手架规划

> 状态：`accepted`
> 基线提交：`b03ab525`
> 建立日期：2026-10-06
> 上位文档：[开发文档系统](../README.md)、[开发测试与运行工具规划](./2026-10-03-development-and-operations-tooling-plan.md)
> 范围：日常开发、交接、发布准备与现场驱动的便捷脚本；不改变运行时合同，不新增公共 MCP 工具。

2026-10-03 的工具规划已经落地 verify、doctor、lab、fault、live、capture、ci 与 timings 八族命令，
覆盖"哪些字节经过哪些检查""安装与运行是否同一份""可重复的实验环境"三项基础能力。本文档从另一个
角度补缺：维护者（人和 Agent）每天重复敲的、每次会话结束就丢失的、靠记忆才能做对的那些小动作。
证据来自 §13.161 的复审会话本身——一个在同一棵树上并行工作的 Claude 会话把构建锁包装脚本重建了
两次、靠手工 grep 做交接前隐私检查、用猜的路径调用聚焦测试并得到一条不点名的错误、手工核对六处
版本源。第一批已实现的命令见[维护工具使用说明](../references/maintainer-tools.md) §13–§16。

## 1. 现状盘点

### 1.1 入口与分工

| 入口 | 职责 | 使用者 |
| --- | --- | --- |
| 根 `package.json` 24 个 npm 命令 | 编译、门（typecheck/架构/Biome/knip/测试/Schema/制品）、构建与检查制品、smoke、安装检查、发布门、`wf` | 维护者与 CI |
| `npm run wf -- …` | verify / doctor / lab / fault / live / capture / ci / timings，本批加 impact / handoff / release bump | 维护者 |
| `node tooling/build-lock.mjs`（`npm run locked`） | 仓库构建锁包装，本批新增 | 并行会话中的维护者与 Agent |
| 发货的 Claude tmux 助手（`claude-code-tmux-asset`） | preflight / launch / resume / self / panes / mark / deliver / nudge / close / teardown | 安装工作区里的 Controller |
| `wakeflow-architecture-atlas/` 的 `npm run check` | 图谱指纹、符号、链接、渲染 | 文档维护者 |
| 会话 scratchpad 里的临时脚本 | 粘贴提示到 pane、等待回合结束、读会话记录、对制品副本调用 MCP 工具、整批刷新窗口 | 过去由 Claude 会话即兴编写，随会话丢失 |

### 1.2 开发与使用方式

- **源码维护**：改 `src/`、`tooling/`、`tests/`，用聚焦测试迭代，`build:artifacts:committed` 重建制品，
  `npm test` 整门，`smoke:artifacts` 冒烟，`git diff --check` 与隐私检查后交接；版本号在六处文件一致，
  `release:check` 是提交后的严格门。
- **现场测试**：用户在 Codex 里驱动 WakeflowTestWorkspace3/5 与 lab 环境；Claude 会话驱动 Claude 宿主的
  可丢弃工作区，靠 tmux 助手和临时脚本粘贴提示、等待、读回。
- **安装使用**：用户只拿到插件制品，Claude 用 `/wakeflow:init|status|next|pod`，Codex 用自然语言；
  Controller 技能承担所有宿主操作，用户只做信任对话框等少数动作。

### 1.3 已有脚本的具体问题（本批已修）

| 问题 | 证据 | 修正 |
| --- | --- | --- |
| 同一树上并行的编译/测试/制品重建互相改写 `.build/`，只能靠会话里手写 `mkdir` 锁 | §13.161 两次重建包装脚本；并行门里 lab 实验超时 | `tooling/build-lock.mjs` + `npm run locked`；`wf verify` 与 `wf handoff` 自带同一把锁 |
| 聚焦测试只收精确文件路径，一个路径写错整个运行报一句不点名的错误 | `focused test source must be one current regular file` | 错误点名路径；接受 `tests/` 下的目录并展开 |
| 没有"改了什么就跑什么"的选择 | 每次手工列文件 | `--changed [--since REF]`（运行器）与 `wf impact tests`、`wf verify quick --changed` |
| 交接检查全靠记忆：空白、隐私 grep、制品新鲜度、文档指针、未跟踪文件 | CLAUDE.md 交接规则 | `wf handoff` 一条命令，只读 |
| 版本号分散在六处，只有提交后的 `release:check` 会发现不一致 | `assets/release/version.json` 与五个来源 | `wf release bump --version X [--apply]` 只改两处输入并列出待重建的生成文件 |
| `wf` 第二次 Ctrl-C 直接退出，派生的 `npm test` 进程组继续跑 | §13.161 T7-F5 | 第二次信号先 SIGKILL 自己的进程组再退出 130 |
| `test:tooling` 不编译就运行旧的编译产物 | 过期脚本 | 改为聚焦运行 `tests/codegen` |

## 2. 需要的脚本：按场景排序

P0 本批实现；P1 下一批；P2 有重复需求再做。每条都注明边界：它不拥有 Demand 状态，不代替宿主授权。

| 场景 | 命令 | 优先级 | 最小范围 | 边界 |
| --- | --- | --- | --- | --- |
| 并行会话共享一棵树 | `npm run locked -- <cmd>`；`wf verify`/`wf handoff` 内置 | P0（已实现） | mkdir 锁、陈旧声明回收、令牌重入、预算与 75 退出码 | 仅本仓库 `.build/`/`plugins/` 写者；不是跨仓库或跨机器的锁 |
| 改动后只跑相关测试 | `test:typescript:focused -- <dir|file>`、`--changed`、`wf impact tests` | P0（已实现） | 静态导入反向传播；Schema/agent-text/工具链改动建议整门 | 未选中的测试不算通过；动态装配与 `$ref` 不在图里 |
| 交接前检查 | `wf handoff [--no-artifacts]` | P0（已实现） | 空白、本机路径与凭证样式、`build:check`、文档指针、Git 概况 | 只读；内核隐私扫描仍是证据与归档的权威 |
| 版本准备 | `wf release bump --version X [--apply]` | P0（已实现） | 改版本输入与 marketplace 条目，列出待重建文件与后续步骤 | 不重建、不提交、不打 tag、不刷新缓存 |
| 对制品副本调用一个 MCP 工具 | `wf mcp call --candidate DIR --root WORKSPACE --tool NAME --input JSON` | P1 | 复用 `tooling/lab/mcp-session.ts` 的 stdio 会话，输出结构化返回与 stderr 类别 | 调用的是新进程，不证明既有聊天里的 MCP 身份；只对可丢弃工作区使用 |
| 刷新 Claude 安装缓存 | `wf cache refresh --host claude-code --yes` | P1 | `claude plugin uninstall/install` 两步 + `install:check` 核对加载字节 | 改用户宿主安装；只在用户明确要求时运行 |
| 驱动 Claude 现场窗口 | `wf claude turn --pane %N --prompt-file F`、`wf claude read --session ID` | P1 | 粘贴、等待回合结束标记、读会话记录；复用发货助手的 deliver/readback，不另造 tmux 管理器 | 读的是用户私有会话记录，只在用户授权的测试工作区使用 |
| 日志与文档脚手架 | `wf docs node --section 13.N --title …` | P2 | gate-log 小节骨架、docs/README 最新节点行、open-items 进展注记模板 | 不生成结论；内容仍由人写 |
| 回归用例骨架 | `wf scaffold test --for src/<path>.ts` | P2 | 按镜像路径生成 `tests/<path>.test.ts` 骨架（node:test、strict assert、夹具导入） | 生成内容不能自动通过；不碰 `src/contracts/generated/` 与 `plugins/` |
| 图谱漂移摘要 | `wf atlas drift` | P2 | 运行图谱 `check:current`，按专题汇总过期指纹并列出自基线以来变化的源文件 | 不改图谱；刷新仍按 §13.156 的方式人工复核 |
| 偶发失败分诊 | `wf test flaky --files F --runs N` | P2 | 同一文件重复运行，记录每次结果与耗时 | 不自动重试洗绿；结果只进私有回执 |
| 耗时表更新 | `wf timings apply --receipt R` | P2 | 把 `timings export` 的表写回 `tooling/testing/test-durations.json` | 新表是新的仓库输入，旧回执不再证明新字节 |

不做的事：通用工作流平台、第二套 Controller、业务代码生成器、给普通安装用户的无源码 CLI（后者
按 2026-10-03 规划另行评估，需要进入 `src/` 层并走生成闭包）。

## 3. 第一批设计

### 3.1 构建锁

声明是 `mkdir .build/locks/build.lock`，目录内 `owner.json` 记录 pid、令牌、命令与开始时间。持有者
进程已退出（`kill(pid, 0)` 得 ESRCH）的声明视为陈旧并移除；活着的持有者等待，每 30 秒在 stderr 报告
一次，预算 `WAKEFLOW_BUILD_LOCK_TIMEOUT_SECONDS`（缺省 3600 秒）用完后退出 75。子进程继承
`WAKEFLOW_BUILD_LOCK_TOKEN`，同令牌的嵌套调用直接重入。`tooling/build-lock.mjs` 是无需编译的包装
（`npm run locked -- <command>`），`tooling/build-lock.ts` 是同一协议的进程内实现，供 `wf verify` 与
`wf handoff` 的 `build:check` 使用。PID 复用导致的误判只会让等待变长，不会让两个写者同时进入。

### 3.2 受影响测试

`src/**`、`tests/**` 的 `.ts` 文件按相对导入说明符建立反向边；变更集为 `git diff --name-only <since>`
加未跟踪文件；从变更文件反向传播，落到 `.test.ts` 的入选，`reasons` 记录每个测试的第一条来源。
Schema/生成合同、agent-text 与宿主文本画像、工具链输入、架构规则、测试运行器/耗时表的改动，或
选择集超过 80 个文件，都给出 `fullGateRecommended` 与原因。运行器 `--changed` 在没有受影响测试时
如实说明并跳过，不制造空的"通过"；`wf verify quick --changed` 此时只跑静态检查并把 `selection`
写进回执。

### 3.3 交接检查

五项检查独立给出 passed / failed / unavailable：`git diff --check`（含 staged）；私有内容——新增行与
未跟踪文本文件里的本机家目录（当前用户名）、`/private/tmp/claude-`、`/var/folders/` 路径按失败，
凭证样式在 `tests/` 外按失败、在 `tests/` 内按 review；`build:check`（可 `--no-artifacts` 跳过，跳过时
该项 unavailable 但不阻止整体通过）；docs/README 的"最新节点"是否等于 gate-log 最后一节、
`docs/reviews` 与 `docs/references` 是否都被索引；Git 分支、修改/未跟踪计数、相对本地 origin/main 的
领先/落后。退出码沿用 wf 约定。

### 3.4 版本准备

只改 `assets/release/version.json` 与 Claude marketplace 的 `wakeflow` 条目，列出两个插件的
`package.json` 与清单当前版本并说明它们由 `build:artifacts:committed` 重新渲染；拒绝相同版本、
非发布序列与非法文本；`nextSteps` 明确重建、整门、提交、推送、打 tag、刷新缓存都是分开授权的动作。

## 4. 第二批（已实现，§13.163）与之后

1. `wf mcp call`：直接复用 `withLabMcp` 的会话与错误类别投影；`--root` 必须是真实目录，`root`
   不能写进参数；结果带制品身份与 `generated-stdio-new-process` 标记。
2. `wf cache refresh`：只在 `--yes` 下执行 `claude plugin uninstall/install`；前后核对缓存目录里的制品
   清单摘要并与已提交制品比较；Codex 按 unavailable。
3. `wf test flaky`、`wf atlas drift`、`wf scaffold test|node`、`wf timings apply`：按第 2 节的范围实现，
   各带未知输入、失败与清理责任的测试。
4. 第三批（§13.164）：`wf impact report` 按所有权规则分类变更集、判断是否要 `schema:build`/重建制品、
   并按顺序给出命令（2026-10-03 规划 §4.6 的 impact 第一版，静态图之外仍由整门兜底）；`wf scaffold
   requirement` 从 Design 技能参考的骨架生成 `drafts/<name>/` 的需求包草稿对（同一规划 §4.6 的
   Design 模板，不填确认、不发明锚点）。
5. `wf claude turn/read` 未实现，发现边界冲突：发货助手的 `deliver` 只接受 Wakeflow 投递许可，
   不能粘任意文本；另造 tmux 驱动与"不重建第二个 tmux 管理器"冲突。两个可选方案待裁决：给
   助手加一条仅供维护者的 `type` 子命令（随制品发货，需走生成闭包与隐私边界），或继续使用会话
   scratchpad 脚本并把它们固化进 `tests/support/`。

验收口径与 2026-10-03 规划一致：每批先交付端到端的小案例；工具不给自己开门——影响运行时或制品
的变更仍走重建、整门与 smoke；收益按"少了哪些手工步骤"记录，不以命令数量计。
