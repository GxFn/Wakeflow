# Wakeflow 维护工具使用说明

> 状态：`active`
> 基线提交：`04769897` 上持续迭代的维护工具；具体执行字节以对应回执为准
> 建立日期：2026-10-03
> 上位文档：[工具规划](../reviews/2026-10-03-development-and-operations-tooling-plan.md)

这些命令在 Wakeflow 源码仓库根目录执行，服务开发和维护。入口是 `npm run wf -- ...`；需要 stdout 只包含 JSON 时使用 `npm run --silent wf -- ...`。它们不属于已安装插件的二十个公共 MCP 工具，不创建聊天或侧栏项目、不安装或激活插件。`lab create` 仅在明确指定的新可丢弃根内，经公共 MCP 初始化合成工作区。

## 1. 执行验证

```sh
npm run wf -- verify quick --files tests/kernel/privacy-scan.test.ts --concurrency 4
npm run wf -- verify gate --concurrency 2
npm run wf -- verify artifact
```

| 档位 | 实际执行 | 范围 |
| --- | --- | --- |
| quick | typecheck、架构、lint、format、knip，加明确列出的聚焦测试 | 全仓静态检查和所选测试；不会自动选择相关测试 |
| gate | 现有 `npm test` | 完整源码门；没有替换或缩减既有测试清单 |
| artifact | `build:check`，然后 `smoke:artifacts` | 双制品完整性与合成环境冒烟，不是原生会话验收 |

验证不会隐式执行 `build:artifacts:committed` 来修复漂移。需要重建时仍明确运行原命令。

测试文件由官方 `node:test.run({files})` 接收既有耗时队列，保持每文件一个进程。Node 24 CLI会重新排序显式文件参数，因此本轮改用程序化入口；真实进程回归同时检查实际执行顺序与选择记录，终端和JSONL仍来自同一原生事件流。见[Node 24.19测试入口](https://nodejs.org/download/release/v24.19.0/docs/api/test.html#runoptions)。

并发度是文件 worker 数，仍复用既有调度器。整门示例从 2 worker 开始；4 worker 曾完成整门，但本轮同样出现准备阶段和慢场景超时，6 worker 也曾出现初始化超时（§13.153）。并发适用性必须随实际负载判断，不能仅凭一次通过就当作稳定上限。调整并发不改变用例、断言、fsync 或测试自己的超时；每轮结果分别保存。

每次创建一个私有 `.build/verification/run-…/` 目录，保存：

- `receipt.json`：运行档位、源码提交与输入指纹、锁文件/制品 manifest 摘要、运行器摘要、Node/平台、阶段命令和退出结果。
- 阶段 stdout/stderr：原始本地日志；回执记录相对引用、字节数和 SHA-256。
- `test-selection.json`：实际选择的源测试文件、编译入口摘要和并发度。
- `test-events.jsonl`：由 Node `TestsStream` 产生的封闭事件投影；保留文件级和总运行统计，不序列化 Error 对象或任意测试 stdout。

Node 对某些主动 abort 的文件级与汇总计数可能分类不同，因此两种统计都保留，不用终端输出推测取消数量。任何失败、取消、skip、todo、缺失必需结果或不完整事件流都不会得到绿色测试回执。运行器自身也有三道底线（§13.161）：Node 没有发出总汇总、汇总到的文件数与选中文件数不等、或执行了零个用例，都按失败退出；子进程不继承 `NODE_TEST_CONTEXT`，避免被外层 `node --test` 误当作子测试。

运行开始、结束分别读取验证输入指纹；源码提交或内容发生变化时，不给新字节背书。输入包含源代码、测试、tooling、assets、plugins、marketplace、`.github` 和根配置，忽略构建输出及独立文档/图谱。端点指纹不能排除期间修改后恢复，也不是抵抗同用户篡改的证明；需要更强隔离时应在独立受控检出运行。

quick 与 artifact 的每个阶段有 30 分钟外层期限，gate 阶段为 90 分钟（完整门在 2 worker 下约 50–60 分钟，§13.161）；都不改变用例自己的超时。SIGINT/SIGTERM 会中止受管命令并结算回执；POSIX 使用独立进程组清理本次子进程。进程被直接 SIGKILL 等情况可能留下 `running` 回执，该记录不能当作通过。日志与事件属于私有材料，保留在被忽略目录，不应直接提交或自动上传。

| 退出码 | 含义 |
| --- | --- |
| 0 | 请求范围内的检查通过；doctor 的通过不代表原生激活 |
| 1 | 检查或命令失败 |
| 2 | 参数/输入不可用、必需证据不足或输入变化 |
| 130 | 验证被取消或外层超时 |

## 2. 导出耗时建议表

```sh
npm run --silent wf -- timings export --receipt .build/verification/run-EXAMPLE/receipt.json
```

将 `run-EXAMPLE` 换成实际回执目录。命令只接受完整通过的 gate 回执，并重验事件摘要、当前源码指纹和完整测试清单；quick、失败、中断、旧输入或被改过的证据都拒绝。

输出的 `table` 是 `tooling/testing/test-durations.json` 的候选内容，不会自动覆盖跟踪文件。数值采用 Node 文件级 summary 的毫秒数并向上取整，不包含 worker 启动时间；它只是排程提示。修改耗时表是新的仓库输入，不能继续把旧回执视作新输入的整门证明。

## 3. 环境与制品诊断

```sh
npm run --silent wf -- doctor env
npm run --silent wf -- doctor artifact --candidate plugins/codex-wakeflow
npm run --silent wf -- doctor artifact --candidate plugins/codex-wakeflow --installed "<installed-plugin-root>"
```

环境诊断核对本次 CLI 的 Node 与仓库引擎声明，探测 npm/Git 版本；不读取或推断聊天内的宿主运行环境。缺失或不支持的声明报告 unavailable。

制品诊断复用现有逐文件校验，区分目录缺失、内容损坏、版本不同、同版本不同字节和完全一致。版本不同导致候选比对不通过，不等于已安装目录损坏。输出不含传入的本机路径、环境变量值或任意异常消息。

源码对齐应使用 `verify artifact`；doctor 不重新构建，因此明确返回 `sourceAlignment: not-checked`。也不会自动读取宿主私有数据库推断当前选择、hook 信任或激活状态。

安装目录规则（原先写在 Controller 技能参考里，§13.161 移到这里）：新构建装进新的版本目录，旧目录为仍在运行的进程和恢复保留；同一版本号对应不同字节不是更新路径。本地 `install:check` 预检只读，不预留或激活目标；安装者发布新目录，不覆盖已有版本。正在服务的 MCP 在自己的 manifest 变化或不可用时拒绝变更操作，读取与 preview 仍可用。

## 4. 比较已有运行观察

```sh
npm run --silent wf -- doctor artifact --candidate plugins/codex-wakeflow --installed "<installed-plugin-root>" --runtime-report "<saved-status.json>"
```

输入接受单个已解码 `WakeflowStatus` 或带 `structuredContent` 的对应 MCP 返回。仅提取允许的运行摘要、磁盘关系和格式合格的观测时间，其他字段不进入诊断输出。

结果始终标注 `source: imported-report`、`verified: false`、`activation: unverified`。它可以显示“安装字节相同，但所给报告的运行摘要不同”，不能证明报告来源、实时性、项目归属或目标会话的 MCP 身份。即使文件自称 verified 或摘要完全一致，也不会提升为原生验证通过；提供这种报告的诊断在没有其他失败时返回 unavailable。

工作区只读诊断可另起一个已核验的生成制品观察进程：

```sh
npm run --silent wf -- doctor workspace --root "<workspace-root>" --candidate plugins/codex-wakeflow
```

该入口只调用 `wakeflow_status` 与 `wakeflow_verify`，按字段允许列表输出维护协议、活动工作数量、窗口运行身份缺口、hook 通道数量和逐门 verdict。保留两次实际观测时间、各自配置摘要与截断数量；配置不一致、观察被截断或门 unavailable 时，不给绿色整体结果。摘要不复制窗口/会话 ID、原始证据、路径或任意错误详情，不产生业务写入。

`source: new-generated-stdio-observer` 只证明这次新观察进程；宿主选用的安装仍为 `not-observed`，原生验收与窗口关联仍为 `unverified`。注册窗口的 `window-runtime-unverified` 不会被新进程的正确 manifest 抵消。该命令提供有界概览；需要保留明确选取的原始材料时使用§12的doctor collect。

## 5. 可丢弃实验环境与业务场景

```sh
npm run --silent wf -- lab create --dir "<new-disposable-root>" --candidate plugins/codex-wakeflow
npm run --silent wf -- lab inspect --id lab-EXAMPLE
npm run --silent wf -- lab run --id lab-EXAMPLE
npm run --silent wf -- lab dispose --id lab-EXAMPLE --preview
npm run --silent wf -- lab dispose --id lab-EXAMPLE --plan-digest sha256:EXAMPLE
```

将占位符换成实际输入和返回值。创建位置必须是**尚不存在**的目录，其父目录已存在、采用真实路径且不含链接；不能放在源码仓库或其他 Git 仓库内部。当前提供一个固定 `dual-product` 预设：外层可丢弃根中有 `Workspace/`、`Alpha/`、`Beta/`、`ledger/` 与独立制品副本 `Artifact/`。前者包含 Design、Test 支持面。三个合成 Git 仓库有初始提交；没有真实产品或用户数据，也没有宿主聊天绑定。

本预设的外层可丢弃根是资源容器，**实际 Wakeflow 工作区根为其中的 `Workspace/`**。原生聊天应归属包含 `wakeflow.config.json` 的这个工作区项目，角色执行根则取宿主 profile 返回的配置位置；不得把资源容器或 Design/Test 目录误当成项目根。对于现有工作区，按其实际配置根匹配项目。本命令只建立文件，不登记任何项目，不创建聊天。

候选先通过已有逐文件制品校验，再复制到源码仓库之外；副本再次验摘要，使用当前 Node 和官方 SDK 启动 `mcp/server.mjs`。初始化执行 preview / planDigest / apply，配置和 ledger 不由脚本手写。回执标记 `synthetic`、`generated-stdio`、生产默认 `fsync`；创建成功不代表业务验收或原生宿主已激活。

`lab run --id` 运行只读 `readiness`：新 MCP 进程的制品摘要、idle 状态、工作区 verify、reconcile 零步与 no-op、pod 创建预览，以及整棵环境树无持久文件变化。它不发布需求、不发送消息、不完成 Demand，也不合成 hook。可以对同一未修改测试区反复执行，每次保留独立回执。

业务实验使用新的目录，不能携带已有 `--id`：

```sh
npm run --silent wf -- lab run --scenario single-product --dir "<new-single-root>" --candidate plugins/codex-wakeflow
npm run --silent wf -- lab run --scenario dual-product --dir "<new-dual-root>" --candidate plugins/codex-wakeflow
npm run --silent wf -- lab run --scenario worktree --dir "<new-worktree-root>" --candidate plugins/claude-code-wakeflow
```

| 场景 | 实际执行范围 |
| --- | --- |
| single-product | 一个合成产品、需求发布与认领、任务/投递/证据/回传/Controller 独立复算、完成归档和恢复幂等 |
| dual-product | 两个合成产品各自完成实现，再由独立 Test 合同执行两个步骤、生成各自证据并接受归档 |
| worktree | 两个真实 Git 产品 worktree 中执行双产品与 Test 链；归档后两阶段关闭 pod，退役合成绑定，移除已核对的本次输出，再以非 force Git 命令回收检出和临时分支 |

三个场景是固定算术夹具，产品代码由场景写入并由实际 Node 子进程执行；Controller 复算结果、核对证据字节后才在夹具中记录决定。它们不接受用户产品任务，不是通用自动 Controller。宿主身份、投递和结束观察由生成制品的 hook 入口合成，明确记录 `synthetic-generated-hooks`；没有创建原生聊天、tmux pane 或实际发送消息。实际原生验收始终 `unverified`。

每次业务实验完成前先保留严格 verify 的 `window-runtime-unverified` 结果，验证合成 hook 没有被升级为原生 MCP 关联；之后退役本次合成绑定，再要求清理后的工作区完整 verify 通过。前后两次检查不能混成“真实窗口全部通过”。

实验在新目录创建阶段一次运行，生成 MCP 进程确已退出后才固定资源清单。清单必须同时有匹配摘要的最终成功回执才能用于检查、续读或清理；如果最后回执发布失败，已经写出的中间清单也不能取得处置权限。失败或取消不产生可自动处置的授权，也不支持在原目录续跑或重扫收编；需要检查现场后在另一个新目录重做。成功结果返回的 lab ID 可使用同一 inspect、只读 readiness 与 preview/digest 清理。原生宿主的试验环境应另外建立，不能把外部 Agent 的写入纳入已冻结 lab 清单。

`.build/labs/lab-…/` 是私有运行证据目录，包含创建回执、资源清单、每次场景结果及清理回执。清单记录本次根的文件系统身份、相对路径、模式和内容摘要，配置摘要、Git HEAD / 分支 / worktree / status、制品版本与摘要。运行回执还保存工具模块摘要和 Node/平台。清单与创建回执包含本机路径；不要直接提交或上传。场景工具结果只保留公开结构化输出，MCP 错误只提取有界错误类别，不复制任意 stderr 或异常消息。

每次检查、运行和清理先验证完整清单，包含 `.git` 和制品内容。新增或缺失文件/空目录、HEAD 或分支变化、同字节文件替换、权限漂移、符号链接、硬链接与挂载越界都会拒绝。`inspect` 只读；它检查环境归属与 Git 事实，业务健康检查由 `run` 中的公共工具负责。

清理分两步：preview 返回绑定资源清单的摘要；apply 要求该摘要仍匹配并重新检查环境。删除逐文件、逐目录执行，不使用递归删除吞掉后来加入的文件；回执保留在环境之外。预览与拒绝不会修改测试区，但操作互斥会短暂写入私有报告目录。

场景失败或取消保留现场。stdio 连接的所有关闭请求共用一次等待，只有观察到实际关闭才结算；关闭无法核验时报告 `lab-mcp-shutdown-unverified` 并保留操作锁。创建未完成时不建立可自动清理的最终所有权清单，需要人工检查。删除中途失败会明确记录部分清理，不冒充完成。互斥锁只协调这些命令；不自动抢占遗留锁，不按 PID、目录前缀或年龄批量清理。锁已存在时命令以 `lab-operation-in-progress-or-interrupted` 拒绝（§13.161）：确认没有别的 lab 命令在跑后，手动删除该 lab 私有目录里的 `operation.lock` 再重试。成功结果不会被释放异常覆盖：释放失败另存为同目录的 `lock-anomaly-<uuid>.json`，操作失败时释放异常只记录不抛出。运行器模块摘要在首次需要时计算，缺失的编译模块只影响用到它的命令。使用环境时应停止其他写入，清单与逐项检查不是对抗同用户恶意竞争或篡改的安全隔离机制。

## 6. 固定故障回归矩阵

```sh
npm run --silent wf -- fault list
npm run --silent wf -- fault run --suite locks --concurrency 2
npm run --silent wf -- fault run --suite all --concurrency 2
```

| 测试族 | 当前选取 |
| --- | --- |
| locks | 排他锁、读写许可和 workspace operation scope；真实进程退出及许可释放异常 |
| recovery | 原子文件候选恢复、真实子进程追加中断、prepared maintenance 恢复 |
| privacy | 文本词法与白名单、公共需求预览的诊断截断和隐私隐藏 |
| delivery | 投递与评审决定、含非空 Git 对象的回调提示 |
| file-boundaries | 稳定文件/目录读取、严格文本字节边界 |

`fault list` 输出精确源文件清单和测试技术。`fault run` 委托 `verify quick`，保留静态门与所选文件、输入指纹、阶段日志和实际 Node 事件；没有自动重试，也没有扩大公共 MCP 的故障注入权限。它组织回归，不改变原断言、超时或持久化档位；功能夹具中的 `none` 与底层真实 fsync/进程试验仍按各测试原合同区分，不能把整个矩阵说成耐久性或真实权限验收。

privacy 组增加了基于 fast-check 的定向命令模型：添加合成凭证、CSI 格式、未知控制字符、扩展路径白名单、越界路径、未知 UUID 前缀和重置。模型只记住引入过哪类风险，不复制生产扫描器的正则或位置算法。默认 seed 为 `20261003`，200 条序列，每条最多 24 步；这是纯函数性质检查，不是崩溃或 fsync 试验。

```sh
WAKEFLOW_MODEL_SEED=123 WAKEFLOW_MODEL_RUNS=1000 npm run wf -- fault run --suite privacy --concurrency 2
```

运行次数范围为 1–1000，seed 为有符号 32 位整数；模型选项进入 verify 回执。失败时原始阶段日志保留 fast-check 的 seed、path、replayPath 与缩减样本，可通过 `WAKEFLOW_MODEL_PATH`、`WAKEFLOW_MODEL_REPLAY_PATH` 配合原 seed 重放。仅在需要重放时传入失败日志中的值，不从另一个模型借用。其他业务序列的生成试验仍待按收益增加。[fast-check 模型与重放](https://fast-check.dev/docs/advanced/model-based-testing/)

## 7. 原生项目聊天行动单与回执一致性

```sh
npm run --silent wf -- live plan --root "<workspace-root>" --candidate plugins/codex-wakeflow --projects "<saved-list-projects.json>" --host-id local
npm run --silent wf -- live attempt --id live-EXAMPLE --window window-EXAMPLE
npm run --silent wf -- live verify --id live-EXAMPLE --evidence "<collected-evidence.json>"
```

此批场景为 `project-bootstrap`：消费宿主 profile 已声明的 project/local、主工作区启动能力，当前对应 Codex；Claude 与产品 worktree 场景明确返回不支持，继续使用各自已有 helper / pod 流程。脚本不另写一套宿主启动规则、不调用 `codex exec`、不创建项目或聊天、不发送消息或信任 hooks。

`plan` 输入的项目文件可以是 `list_projects` 的完整 MCP 文本/结构化返回或解码对象。只按准确的工作区规范路径、hostId、local 项目类型匹配，要求恰好一个；标题相同、子目录项目、错误宿主和多重匹配都不能代替。项目清单是导入材料，Agent 在执行前仍应在实际宿主中确认它。

候选制品逐文件核验后，新 stdio 进程通过 status 和 binding inspect 读取当前窗口、绑定、claim 与 profile 的启动说明。规划前后比较配置字节和制品摘要；不更改业务文件。行动单与空证据模板存入 `.build/live/live-…/`，内容含私有根路径，不用于 CI 上传。稳定输入得到同一个计划标识；已经绑定的窗口只对账，不用这个工具替换或重复创建。

执行顺序：

1. 读取行动单中的 `project`、各窗口的 `instruction` 与现行角色技能；人类和宿主授权沿用真实会话规则，计划本身不授予授权。
2. 对已有绑定，找到既有宿主句柄并回读。对未绑定窗口，在实际宿主调用之前执行 `live attempt`，它会再读当前配置、制品、绑定和 claim，随后用独占创建及 fsync 留下尝试记录。
3. Agent 在已有授权范围内使用 profile 给出的正式宿主入口，把实际项目 ID 放入 target，保留创建请求和完整返回。`clientThreadId` 不能代替 ready `threadId`。不在这里由脚本代发初始或后续消息。
4. 观察真实 SessionStart、角色执行目录和 MCP 返回，按 Wakeflow 的既有注册协议完成 binding；业务验收仍由既有 review 工具负责。
5. 收集下表的观察，调用 `live verify` 核对字段一致性。出现缺失或含混创建返回时，先回读宿主并对账，不再次调用创建工具。

尝试键跨重复规划、标题和候选变化保持稳定；重复、部分或未知记录不会自动删除或放行重试。窗口绑定状态变化会改变计划摘要：`verify` 遇到计划摘要不同的尝试记录时把它们列在 `supersededAttempts`（在旧计划下准备过），不再因此退出 2（§13.161）。记录只证明“准备调用”，不证明已调用或已落地；它只约束遵循此维护流程的操作，不能阻止外部参与者绕开流程。脚本不拥有第二套 Demand 状态，也不代替宿主权限。

证据文档顶层为 `{ kind: "WakeflowLiveEvidence", schemaVersion: 1, planDigest, records: [...] }`。每个 record 对应一个 windowId，并带 `observedAt` 与 `declaredSource`（synthetic、host-tool-return、manual 或 imported）。下表是核验所需的观察投影，原始返回留在私有证据中；这些字段不是新的 Wakeflow 公共协议：

| 字段 | 必需关联 |
| --- | --- |
| creation（未绑定窗口） | 原创建 request.target 与 result 的 ready threadId、hostId；支持完整 MCP 包装；pending 不算 ready |
| membership | threadId、hostId、projectId、projectRoot，source 为 host-readback 或 user-ui-confirmation |
| sessionStart | threadId、cwd、event 为 SessionStart、观察器 artifactManifestDigest |
| execution | 同一 threadId 下真实 `pwd` 得到的 cwd；必须是该角色执行根 |
| binding | 公共 binding inspect 返回，核对 windowId、宿主、绑定标识与摘要、launchIntentDigest |
| runtime | threadId 及对应 status 返回，核对 runtime manifest 和磁盘关系 |

每个窗口只能有一条 record，角色不能复用同一个线程。报告保留观察声明时间、声明来源及 UI/宿主回读的区别，但所有文件输入的实际来源一律为 `imported-unverified`；自称 verified 无效。字段一致时 `consistency: passed`，整体仍是 `unavailable` / 退出 2；矛盾则 failed / 退出 1。窗口到 MCP 的可信关联仍为 unverified，不能把一次脚本观察器、人工 JSON 或 UI 确认提升为原生业务验收。

工作区/项目和检出的选择遵循宿主边界，具体工具参数以当前宿主工具及 Wakeflow profile 为准；官方文档同样把执行宿主、workspace 与 worktree 作为不同选择。[OpenAI 执行上下文说明](https://developers.openai.com/blog/mastering-codex-remote-for-engineering)

## 8. CI 与可分享验证摘要

`.github/workflows/verify.yml` 为 pull request、main push 和手动触发分别运行 `gate` / `artifact` × Ubuntu 24.04 / macOS 15，固定 Node 24.19.0、npm 11.17.0、2 个测试 worker。矩阵不隐藏失败；被后续提交取代的 pull request 运行会被取消，main 上的每次 push 都保留完整记录，作业外层期限 120 分钟（§13.161）。workflow 只给 contents: read，不保留 checkout 凭证；不调用原生聊天、发布或安装缓存操作。

三个 Action 固定完整 Git 提交，版本来源为 [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1)、[setup-node v7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0)、[upload-artifact v7.0.1](https://github.com/actions/upload-artifact/releases/tag/v7.0.1)。本地保存配置和静态验证不等于 GitHub 上已经运行成功；提交、推送与远端执行仍需分别完成。Windows 尚不纳入完整门矩阵，不通过 skip 将其说成支持。

```sh
npm run --silent wf -- ci export --summary "<verify-stdout-summary.json>"
npm run --silent wf -- ci verify --bundle "<exported-report-directory>"
```

export 仅接受标准验证 summary 指向的私有回执，重验测试事件摘要和统计，检查完整通过所需阶段、退出码与输入一致性。输出 `.build/ci/report-…/report.json` 和 `manifest.json`，只包含允许的版本/平台、时间、状态、摘要、计数、受限相对测试文件名，以及模型 seed/次数。原始命令、case 名、异常、日志、聊天句柄和任意环境字段不会被复制。失败结果也可导出，导出成功与验证通过是两个字段。

CI 即使失败也尝试导出，但只上传这两种文件，保留 14 天；原始 verification / live / lab 目录不上传。下载后用 `ci verify` 硬校验文件集合和 SHA-256，字节不符直接非零退出。摘要证明字节一致，不证明执行者或来源；bundle 校验始终注明 origin unverified，不能转成发布认证或原生通过。独立图谱仍维持自己的严格检查，本次没有把图谱接进根构建依赖。

## 9. 当前边界

尚不提供自动读取宿主选中版本、自动收集实时hook通道、无源码安装用户的独立doctor、完整原生投递/回传/worktree自动执行与验收或impact。§12已提供维护者明确选取文件的只读故障包；它不是通用现场收集器。工作区 doctor 已能通过新 stdio 进程汇总现有 status/verify；业务 lab 已覆盖固定合成场景。已有宿主工具继续负责原生操作；live 仍只覆盖项目聊天建立与对账的辅助流程。

本批在 macOS / Node 24.19 环境验证。Windows 的权限位表示与进程树终止分支尚未实机验证；不据此声明跨平台原生支持。没有修改插件版本或安装缓存，运行时及生成制品内容保持不变。

第一批验证结果见开发日志 §13.153；第二批见 §13.154，最终 4 worker 完整门 1274 项、270 份文件、二十场景及双宿主制品 smoke 通过；中断回执与关闭竞态修前失败证据分别保留。当时发现独立图谱 5 页来源漂移，后续补审见下文。

第三批见 §13.155：最终完整门 1280 项、273 份文件、二十场景和双宿主 smoke 通过；已有测试区只读对账、两进程尝试互斥、伪造来源拒绝、模型复验及实际摘要破坏检查通过。GitHub workflow 尚未远端执行，真实多窗口业务与 worktree 不因此获得通过结论。

图谱补审见 §13.156：完整复核 20 个新增工具与 1 个修改过的运行器，修正原 5 页漂移并新增 3 页、5 张维护工具图。105 张图实际浏览器渲染和独立图谱全门通过；本轮仅改变文档与图谱支持代码，根代码输入仍匹配第三批已完成的 1280 项门和双宿主 smoke，未将旧执行改记为新执行。阅读入口见[维护工具图谱](../../wakeflow-architecture-atlas/maps/17-artifacts-and-contracts/README.md)，证据与未闭合场景见[验证来源](../../wakeflow-architecture-atlas/plans/review-2026-10-03-maintainer-tools/validation-provenance.md)。

第四批见 §13.157：固定业务场景、封存回执/同字节替换保护、工作区诊断和真实派发顺序已实现；最终4 worker完整门1297项、276文件及双宿主smoke通过。两次旧派发接线的整门中断记录保留。后续 §13.158 已完成唯一外层项目下10聊天的main/worktree业务与资源回收；列表回读、窗口运行关联和回调hook的限制单独保留，不由清理后健康检查补足。

第五批见 §13.159：本页 §10–11 的测试捕获与导入回执已实现；16项聚焦和22项隔离历史材料检查通过。保留4 worker首轮失败/中断后，2 worker完整门1313项、279文件及双宿主smoke通过。并发敏感边界保留，未改运行时或缓存。

## 10. 冻结测试记录输入并执行单个步骤

```sh
npm run --silent wf -- capture prepare --input capture-selection.json
npm run --silent wf -- capture run --id capture-HASH --step ts-1
npm run --silent wf -- capture inspect --id capture-HASH
```

将 `capture-HASH` 换成 prepare 的返回值。这个维护者骨架保存既有合同和明确的命令，不生成断言，不确认需求，不制定测试重试，也不导入 Wakeflow evidence/result 或执行聊天动作。它不进入安装制品；只安装插件而没有Wakeflow开发仓库的用户不能直接运行这一入口。当前运行者是获授权的源码维护者，不应把跨仓库维护记录写入视作产品/Test窗口自动取得的新权限。

输入示例中的尖括号是占位值，必须替换成实际原生工具与 Git 观察；它不是可直接运行的示例：

```json
{
  "kind": "WakeflowTestCaptureSelection",
  "schemaVersion": 1,
  "root": "<workspace-root>",
  "taskPackageFile": "<frozen-task-package-file>",
  "envelopeFile": "<immutable-delivery-commit-or-envelope-file>",
  "envelopeDigest": "sha256:<digest-from-prepare-delivery>",
  "outputDirectory": "fixtures/example/capture",
  "implementations": [
    {
      "repositoryId": "repository_<id-from-package>",
      "checkout": "<assigned-checkout-relative-to-workspace>",
      "resultFile": "<implementation-target-result-or-raw-review-tool-return>",
      "commit": "<explicit-full-commit-listed-by-that-result>",
      "files": ["src/example.mjs"]
    }
  ],
  "commands": [
    {
      "stepId": "ts-1",
      "executable": "node",
      "args": ["harnesses/example/assert.mjs", "ts-1"],
      "inputFiles": ["harnesses/example/assert.mjs"],
      "timeoutMs": 60000,
      "outputBudgetBytes": 8388608
    }
  ]
}
```

`root` 相对 selection 文件解析，也可给绝对路径。task package、envelope、result 文件及checkout相对工作区根解析，也可给绝对路径。执行目录从任务包的Test窗口身份与当前配置的Test支持面解析；`outputDirectory` 和命令的 `inputFiles` 相对这个执行目录，argv则按普通进程cwd解释。输出不得离开Test执行根。stdio的stdin关闭；需要复杂输入时由调用方编写并冻结文件式harness。

当前版本要求所有implementationBaselines恰好各有一份输入，产品结果为committed且检出干净。`commit` 必须明确选择对应结果列出的完整提交，工具不猜哪一项代表要验收的落地。它核对repository/window/task/result/package身份及摘要、Git common dir、HEAD、分支、主检出或linked worktree的位置类型，以及所选已跟踪文件与该提交blob的实际字节。没有覆盖未列出的依赖、忽略文件或任意进程行为；未提交的实现基线暂不支持。

package、envelope和result复用当前 portable JSON Schema并检查摘要与关键来源关系。envelope可直接提供，也可从符合当前Schema的不可变commit中按精确envelopeDigest选择；不会从snapshot或自然语言prompt解析执行范围。重试还必须提供 `previousResultFile`：其结果/attempt身份和摘要须对应rerunSource，commands只能覆盖信封声明的重试步骤，不能包含上一结果已通过或未报告的步骤。每个逻辑尝试的序号不得超过冻结合同预算。初次尝试必须提供全部合同步骤的命令。

prepare在源码仓库的私有 `.build/capture/plans/` 复制原始文件和harness输入，最后写ready记录。后来删除或轮换原输入文件不会破坏这些冻结副本。run仍检查当前配置、产品与harness是否变化；文件替换、脏检出、摘要不符、未知计划文件或未完成封存均拒绝。执行采用参数数组及 `shell: false`，不解释shell字符，也不会自动运行下一步。命令继承当前维护进程的环境变量；计划没有固定可执行文件的全部字节、PATH解析或所有外部依赖，`captureRuntime`记录的是捕获器自身的Node/平台。

每次显式run在作用于进程前独占写入 `.build/capture/attempts/` 的稳定标记，键绑定工作区、目标、逻辑attempt和step；修改输出目录或重新prepare不能重新执行同一条已记录步骤。标记本身不证明命令运行过。run 先只读核对输出目录与 attempt 目录可以创建，再独占写标记，之后才建目录；第二个并发或重复的 run 以 `capture-attempt-already-recorded` 拒绝，不留下空目录（§13.161）。中断、部分文件和含糊结果保留，工具没有清除标记、自动重跑或接管未知目录的入口。Agent仍须遵守原合同的顺序与停止条件，由Controller决定下一次尝试。

步骤输出位于 `<Test-root>/<outputDirectory>/<test-attempt-id>/<step-id>/`，包含独立的 `stdout.log`、`stderr.log`、started与record JSON。流文件保留原始字节，元数据保留argv、cwd、执行退出、前后观察及摘要，既不修改原始失败，也不把日志转义嵌套多层；这些记录含本机绝对路径，和 lab/live 的私有目录一样不要提交或上传。默认命令期限60秒、输出预算8 MiB；期限最多10分钟、预算最多16 MiB。输出预算按周期与结束时检查，可能在检查间隔内超出；超限、中断或观察不完整均为非绿色，已写字节保留。该工具是观察与记录助手，不是文件系统/进程沙箱，不能限制任意调用方命令的副作用。

输入来自本地导入，不证明当前Demand、claim、绑定或Controller授权仍有效；调用方须用真实Wakeflow/宿主证据先确认这些事实。所有输出继续保留authorization未建立、testVerdict未评估及Controller未验收的边界。run的退出码0只表示该显式命令成功退出且记录检查完整；1表示命令失败；2表示中断、漂移或记录不可用。inspect只离线核对计划副本、标记及原始输出，不读取轮换快照或重新运行测试；缺少任何计划步骤的完成记录仍为unavailable。它的结果用 `readsWorkspaceState: false` 与 `readsStepOutputs: true` 说明读取范围：不碰工作区状态，但会读 Test 根下本次步骤输出。

## 11. 保存原生动作回执及准确的摘要约定

```sh
npm run --silent wf -- live receipt --request host-request.json --input host-return.json
```

输入分别是实际调用请求与完整工具返回的JSON文件；不要只提取 `structuredContent`，也不要把模拟返回标为真实宿主。命令逐字节保存两份输入到私有 `.build/live/receipts/`，并分别给出原始文件摘要和 `sha256(UTF-8 JSON.stringify(parsed complete tool return))` 摘要。后者保持解析后的属性顺序。调用方若约定按完整返回对象序列化取摘要，可选后者；若引用实际保存文件，则选前者。运行时的evidenceDigest本身不强制这两者中的某一种，记录时必须明确约定，不能混用。

它只记录所给数据：`recordedAt` 是本地记录时间，`reportedIsError` 只是输入声明，退出码0表示记录完成。即使输入自称verified或isError=false，也不会转成hostEffect成功、发送已落地或native acceptance通过。实际发送、落地判定、归档回读与人类UI确认仍分别保留并由原所有者处理。

这些记录可能包含私有prompt、路径、句柄或输出，不能直接当分享报告或CI摘要。原始字节不做静默脱敏；需要进入受管证据时仍走既有的privacy preview/apply与人工内容审查。

## 12. 保存只读故障包并导出独立摘要

```sh
npm run --silent wf -- doctor collect --root WORKSPACE --candidate ARTIFACT_DIR --files Test/observer.log .wakeflow-local/runtime/selected-record.json
npm run --silent wf -- doctor inspect --id diagnostic-UUID
npm run --silent wf -- doctor export --id diagnostic-UUID
npm run --silent wf -- doctor inspect --input .build/diagnostics/exports/summary-UUID.json
```

`diagnostic-UUID`使用collect返回的id，摘要路径使用export返回的file。将示例路径换成明确需要的文件；`--files`可省略。collect自动选取`wakeflow.config.json`和候选的`artifact-manifest.json`，其余仅接受工作区内的相对文件路径。最多32份额外文件，每份不超过4MiB，源副本总量不超过32MiB；观察记录另限8MiB。目录、符号链接、硬链接、越界路径、重复配置项和未知参数均不被当作可复制文件。附件复制不递归扫描或自动发现文件；status/verify内部仍沿用各自的只读检查和遍历规则。工具不自动读取宿主私有数据库、整个transcript、环境变量或任意stderr。

原始配置和附加文件逐字节保存，包括无效UTF8、损坏JSON和原始换行；它们不会为了便于分析而被改写。记录保存在源码仓库私有的`.build/diagnostics/bundles/`，必须位于被观察工作区之外。目录和文件以0700/0600创建，原路径、节点身份和私有内容只留在这里。不要把整个私有目录当分享包。

工作区探测仍复用既有status/verify，只启动一个新的生成stdio观察器。`probe.json`保存SDK结果的投影及部分失败记录，**不是原始传输字节或某个原生聊天的回执**。在后续观察失败时，已经核验过的候选清单信息仍保留；它不证明该原生聊天已加载候选。真实hook/宿主日志只能按明确文件选取，未选中的材料保持未采集。

| 操作或字段 | 能说明什么 | 不能说明什么 |
| --- | --- | --- |
| collect的status / exitCode | 本次诊断通过0、失败1、不可用2或中断130；选定材料缺失或变化时不能整体通过 | 已修复工作区、已激活插件或可以自动重启 |
| bundleSealed | 请求、记录、副本和最后seal已形成可复验包；失败诊断也可以封存 | 所有源文件都读取成功、工作区健康 |
| collection.coherent | 选定文件的前后节点/字节观察一致，且探测记录没有因预算被略去 | 全树事务快照，或期间从未发生又恢复的变化 |
| inspect的matched / exitCode 0 | 私有包或公开摘要的文件、格式、摘要及声明之间一致 | 诊断通过、来源已认证或原生验收通过；另看diagnosisStatus |
| export的exported | 生成一个独立的受限JSON文件 | 自动上传、授权分享原始材料或认证宿主效果 |

每次采集创建新目录，原包不覆盖。部分写入、缺失seal、未知成员、副本字节被改动和不一致的调用序列会阻止离线复验或导出；工具不会补写成功或自动清理它们。原工作区和候选之后被移除，也不影响完整私有包的离线核验。

分享摘要从字段和值类别的允许列表重建，不复制任意错误code、版本后缀、owner、窗口标识、路径或文件内容。未知门名归为`other`，细节留私有包；保留门状态、计数、候选摘要、两次观察时刻及明确的未验证来源。成功诊断还必须包含两次成功调用、候选信息和完整观察时间；重算自校验摘要不能让相互矛盾的字段组合通过。摘要没有签名，始终是`unverified-local-record`。

候选宿主必须由维护者按实际场景选择：Claude观察器用于按Codex初始化的环境时，宿主资产/布局可能正常地报告不匹配。不能据此自动改写配置。在私有树中，额外普通文件本身也未必是故障；明确的0600→0644权限漂移由运行时私有模式普查报告，采集器不调用收敛或修复。

本入口需要开发仓库，仍不解决无源码安装诊断、宿主选择和窗口MCP可信关联。耗时表已显式采用上一批完整门测得的279文件数据；它只调整派发顺序，新测试仍按未知项优先，所有用例、断言、fsync和超时保持原设置。

第六批结果见§13.160：19项quick、两种宿主的真实CLI正反场景、最终1326项完整门及双宿主smoke通过。2 worker已跑完测试但触达外层预算的回执保留；3 worker在原预算内完成整门。并发选择仍需依据负载，不能把一次通过当作稳定上限。
