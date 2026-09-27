# 未决问题登记（open items）

状态：active。本表是项目未决问题、验证缺口与待裁决事项的唯一登记处；新发现追加到这里，关闭时写明提交与 gate-log 节。

来源：2026-09-26 只读深度分析（gate-log §13.132）。10 个分析角度各配独立复核，外加完整性检查补查的 3 个方向；134 条报告中 132 条经复核保留（95 条原样确认、37 条修正了表述或严重度），按同一根因合并为下列 13 个主题、106 项（§13.133 现场追加 8 项、§13.134 追加 3 项、§13.135 追加 6 项、§13.136 追加 1 项，现为 124 项）。编号与分析报告页一致（问题 A1…M4，待裁决 Q1…Q12）；“计划阶段”指 §13.132 的路线图。严重度按用户影响计：高 / 中 / 低。

## 待裁决（需要用户决定）

- **Q1** Codex 版本怎么定位：发布前必须跑通一次真实会话；还是先以 experimental 或 preview 标注发布；还是在验证前暂不发布 codex-wakeflow 产物。
- **Q2** 发布渠道和版本模型：只要 push 改动了 plugins/ 就 bump 补丁版本并打 tag；还是在开发分支上开发，main 只经过发布流程前进。另外，1.0.0 之前的构建是否改用 1.0.0-rc.N。
- **Q3** 1.0 之后的持久格式策略：v1 冻结，改动一律靠新版本号加 upcaster；还是改变事件溯源的设计，不再持久化派生状态摘要，只校验事件摘要。前者要长期保留旧 reducer。
- **Q4** 产品和 Test 窗口的权限怎么授予：启动时用 --allowedTools 或 --settings 注入；写进所有者管理的产品仓库；还是由 Controller 引导用户逐窗口批准一次。默认 permissionMode 是否作为 init 时的显式选择。（**已裁决 2026-09-26**：用 Claude Code 的 auto 权限模式——"就是用 auto 模式吧，不然很多权限需要人为确认"；配置的 permissionMode 增加 `auto` 并作为启动默认值。已实现于 §13.134：配置枚举为 auto | acceptEdits | bypassPermissions，Claude 宿主画像缺省 auto。）
- **Q5** 威胁模型的范围：是否把“被仓库内容注入的产品 Agent”当作对手来防。这决定调用者身份检查、--add-dir 的收窄、helper 完整性校验、hook 记录认证是否要做，以及做到什么程度。
- **Q6** bug 和 supplement 需求包是否必须有验收标准（§13.131 待裁决），以及发布时是否强制至少有一个列表项。
- **Q7** 后续工作由哪个机制负责：让 continue_demand 接受补充需求包；还是让 supplement 包带上父 Demand 或父需求的链接。升级后文档承诺的“补充包认领出口”是实现出来，还是改文档，说明实际路径是 record-decision 或取消后重新认领。
- **Q8** Demand 完成时，未被任何任务或测试覆盖的验收标准怎么处理：阻断完成，还是由 Controller 逐条豁免并记入归档。
- **Q9** v1 是否需要退出路径：删除或改动仓库和窗口，把仓库切出 managed-block，分离整个工作区。另外，managed-block 的默认值是否改为 owner-managed，托管块能否不带工作区专属的 id。
- **Q10** pod 能否只包含部分仓库，关闭后能否不拆除就认领下一个 Demand。/wakeflow:next 能否连续执行 Controller 自己负责的机械步骤。是否在 skill 里要求每个 Demand 使用一个新的 Controller 会话。
- **Q11** 平台范围怎么声明：仅支持 macOS 和 Linux 的本地文件系统，是否明确拒绝网络文件系统。Node 的 engines 范围是否放宽到 26。
- **Q12** 架构目标是重新定基线还是排期去做：ADR-0004 的 tools/list 小于 60 KB，ADR-0013 的 foundation 不超过 20 个文件和单一错误类型。约 2,100 行没有生产调用者的恢复模块，逐个决定接进恢复入口还是删除。

## 路线图

- **阶段 0**（S）阶段 0：先把基线立起来。新建 docs/references/open-items.md，把本次分析的全部条目登记进去。更正 §13.121 勘误和 §13.130 第 15 项。用脚本从当前产物刷新本地缓存，并核对 manifest 摘要。用 HEAD 对测试工作区的 7 份归档和活动根做一次只读回放，结果记入 gate-log。 理由：后续每一步都需要一个可追踪的清单，以及一个真实加载了当前代码的宿主。归档回放成本最低，又能直接回答当前 HEAD 还能不能读旧数据。
- **阶段 1**（M）阶段 1：修默认安装的主流程阻断。启动意图注入 --allowedTools 或 --settings；deliver 发送前检查对话框状态；只剔除会话级的 CLAUDE* 变量；preflight 报告 tmux、node、claude 的版本和路径。然后在 acceptEdits 下、产品仓库不带遗留内容的新工作区跑一次完整现场：包括一次 rework、一次 rearm、一次 blocked 后重新决策、continue 后再次完成、一个经 helper 创建并在锁定 checkout 下关闭的 pod。逐项核销 §13.130 的“未执行”清单。 理由：这是新用户第一次使用就会撞上的问题。当前的现场证据不能代表默认安装。
- **阶段 2**（M）阶段 2：处理崩溃与并发。已发布的 Demand 也要能从公开入口恢复残留的 append candidate；board 锁和 projector 锁在 owner 不活跃时自动退役；锁记录写入进程启动时间；把 MCP 的 abort 信号传到底层；SIGHUP 按 SIGTERM 处理；pod 加一把 pod 级锁；投影改为基于源 binding 做 CAS。再补一套子进程 SIGKILL 崩溃矩阵 harness，以及一个 hook 目录上限的回归测试，并改掉超出上限就整体失败的做法。 理由：这些残留一旦出现就会永久卡死 Demand，用户只能手动删文件。现有测试从来没有真正杀过进程。
- **阶段 3**（L）阶段 3：打 1.0 tag 前的格式和发布基线。写一份格式冻结和兼容策略的 ADR。golden 回放语料、托管文本历史渲染的摘要表、配置演进路径（upgrade 动作或类型化错误）都纳入 npm test。维护 intent 写入产物摘要。更新检测改为可比较先后的身份，并区分新旧方向。加 CI，按 macos 和 ubuntu 跑 npm test 和 smoke，打 tag 时跑 release:check。加入“产物字节变了，版本号必须变”的 gate。README 增加“更新”和“从 0.9.x 迁移”两节。修正许可文件和元数据。最后正式打 v1.0.x。 理由：发布之后，原地修改格式会让用户的数据变得不可读，并阻塞他们的工作区。版本号与字节脱钩会让用户停留在旧构建。这些必须在发布前解决。
- **阶段 4**（M）阶段 4：可诊断性。incident 记录加 incidentId；errno 投影到 causeCode；helper 的拒绝附带 stderr detail；把“无法检查”作为 unknown 这第三种状态；hook observer 失败时写下标记；Controller skill 写明遇到不透明失败时的规则，并附一张拒绝原因表；跑一遍“绝不出现 unexpected”的损坏输入扫描；MCP 启动器加进程守卫。 理由：阶段 1 到 3 的现场问题都要靠这些信息才能排查，也能让被引导的用户拿到一条可以转告的明确信息。
- **阶段 5**（M）阶段 5：安全边界。先写威胁模型 ADR。然后缩小 --add-dir 的范围；helper 运行前做摘要自检，或改为从插件缓存运行；回调文本标注为不可信，skill 里写明回调不能授权任何决策；非 Controller 的 binding 拒绝 Controller 专属工具；扩大凭证扫描范围，并在扫描前剥离 ANSI；status 和 verify 加入遗留内容观察；hook 记录改为链式或 HMAC。 理由：产品 Agent 会处理不受信任的仓库内容，而目前它能间接获得 Controller 的权限，还能伪造落地证明。
- **阶段 6**（M）阶段 6：Codex 版本。先在 README 和 marketplace 标注 experimental。准备好 codex CLI 后跑一次真实会话，把 hook payload 录成测试夹具。明确 host-send-return 摘要的定义，或者暂时禁用这条路径。加上 effort 映射。把 Claude 专属文本改成占位符，并加一个 gate 检查 Codex 产物里没有 Claude 词汇。 理由：产品的一半从来没有真实运行过，第一步就可能整体失败，而用户事先没有任何提示。
- **阶段 7**（M）阶段 7：补 Demand 流程的死角和引导体验。发布时要求至少一个验收标准列表项；确定后续工作由谁负责，并修正升级出口的文案或实现；完成时检查验收覆盖；补上 research 流程；在 skill 里教 indeterminate 的 resolution 出口；空闲状态引导用户去 Design 窗口；处理启动阶段的 tmux、git init 和已有会话；修正 target 与 test skill 之间的矛盾；指定证据存放位置。场景测试补齐失败修复闭环、嵌套仓库布局和 Claude 组合。 理由：这些都是用户照着文字操作时会走进的死路，或者是文档作出了承诺而代码没有实现的地方。
- **阶段 8**（M）阶段 8：运行成本。在 skill 里写入 Controller 会话轮换；inspect 和 status 改为默认只返回摘要；helper 按引用读取 prompt，并禁止读取事件文件；helper 支持批量操作，并按目标过滤观察结果；按角色只暴露对应的工具子集；实测 tools/list 大小，并收紧预算和结果上限。 理由：目前运行成本主要来自长期存在的 Controller 会话和被逐字转抄的观察结果，这直接影响每个 Demand 的耗时和费用。
- **阶段 9**（L）阶段 9：架构还债和退出路径。建一张统一的阶段转移表；按目录逐步解除 knip 和 Biome 的豁免；为无调用者的恢复模块决定接线还是删除；tmux helper 改成真实模块，并用 kernel writer 生成测试夹具；错误体系收敛到 ADR-0013 D；抽取共享的切片上下文；拆分巨石文件。按用户的决定实现 detach 或删除仓库和窗口；managed-block 的默认值和撤销；pod 关闭时清理分支；为 settings 规则记录所有权；统一 locator 布局。 理由：这些不会立刻阻断用户，但决定后续改动是否安全、能否被检查出来，也决定用户在停用时能否干净地退出。

## A. 默认安装下 Claude Code 宿主运行姿态：现场测试没有覆盖新用户的真实环境

高。每次现场测试都用 bypassPermissions，产品仓库里还留着旧 JS 插件的宽泛允许规则，所以默认 acceptEdits 下的权限提示、投递时 pane 所处状态、环境变量、Claude Code 版本和安装形态这几件事都没在真实环境里验证过。其中有几项一旦出问题就会让全新用户的主流程直接停住，而且用户和 Controller 都看不到原因。

- **A1** [高 / 缺陷] 产品窗口和 Test 窗口没有 Wakeflow MCP 和 helper 回调的允许规则。默认 acceptEdits 下，每次导入和回调都会停在一个没人看的权限提示上（计划阶段 1；状态：阶段 1 已修（§13.132）：助手启动与 resume 的每个会话带 `--allowedTools`（Wakeflow MCP 与按绝对路径调用的助手）；现场待验证）
  - 说明：target 和 test 的第 6 步要先调用 wakeflow_import_target_result，再用 helper deliver 回调 Controller。在全新工作区里，这两步在产品窗口都匹配不到允许规则，Test 窗口的 helper 调用也匹配不到。Claude Code 会在一个用户没盯着的 tmux 窗格里弹权限确认，Controller 只能看到回调迟迟不来。现场之所以从没遇到，主要是配置里设了 bypassPermissions，其次是遗留的宽规则。Claude Code 是否从 --add-dir 目录加载 settings 还没有实测，是推断。
  - 证据：src/hosts/claude-code/claude-code-portable-settings-transition.ts:46-56：helper 规则只写给 program 根，support surface 只拿到 MCP 规则；claude-code-portable-settings-composition.ts:244-256、:368-415：产品仓库根本不是 settings 管理根；claude-code-tmux-asset.ts:75-76：规则是相对路径 `Bash(node .wakeflow-local/.../tmux.mjs *)`；claude-code-agent-text-profile.ts:107-110 要求产品和 surface 窗口用绝对工作区根前缀调用，这条规则匹配不上；wakeflow-workspace-host-resource-profile.ts:43：默认 permissionMode acceptEdits；endpoint/service.ts:793-803 没有传 --allowedTools 或 --settings；WakeflowTestWorkspace/wakeflow.config.json:164：permissionMode bypassPermissions（现场没出现提示的主要原因）；5 个 Alembic*/.claude/settings.json 保留旧 JS 插件的 Bash(git|node|tmux *) 和 MCP 规则（次要原因）；shipped README 文本（agent-text-profile.ts:151-153）写 helper 运行“不会弹权限提示”，这只在根目录成立；gate-log §13.119 L3442 已登记此残留；§13.130 汇总表和 §13.131 都没有把它关闭
  - 建议：在启动意图里为 product、test、design 角色加上 `--allowedTools mcp__plugin_wakeflow_wakeflow "Bash(node <绝对工作区根>/.wakeflow-local/.../tmux.mjs *)"`（或等价的 --settings JSON），这样不用写进由所有者管理的仓库。然后在 acceptEdits、产品仓库没有 .claude/settings.json 的全新工作区里跑一遍现场循环，记下用户实际看到的每个提示，并把“产品仓库不带遗留规则”加进现场检查清单。另外改正 README 里“不会弹提示”的说法。
- **A2** [高 / 风险] helper deliver 不检查 pane 状态就粘贴并按 Enter，可能替用户批准一个挂着的权限对话框或选中菜单项（计划阶段 1；状态：阶段 1 已修（§13.132）：送前截屏，停在对话框或菜单时以 `target-not-at-prompt` 拒绝、什么都不发；现场补修（§13.133）：真实信任对话框的光标行 "❯ No, exit" 没有编号，输入框改为必须夹在两条边框线之间；输入框里已有文字也拒绝（`input-not-empty`），但 Claude Code 在回合结束后显示的暗色提示建议（SGR 2）不算，送前截屏带属性（`capture-pane -e`））
  - 说明：回调会在任意时刻打进 Controller，而 Controller 这时可能正停在自己的权限提示或 AskUserQuestion 上。遇到选择对话框时，粘贴的内容会被丢掉，随后的 Enter 会确认默认选项（通常是“Yes”）。helper 记录 attempt sent、landing pending，skill 又告诉 Controller pending 是窗口错了，于是真正的原因被误读，一次工具调用已经在用户不知情时被批准。这个机制是按 Claude Code 对话框的行为推断的，没有复现过，但代码路径是确定的。在默认 acceptEdits 下比现场的 bypass 配置更容易触发。
  - 证据：claude-code-tmux-asset.ts:1070-1101 commandDeliver：locateDeliveryPane 只核对进程、身份和 handle digest，粘贴之后（L1097）才 capture；claude-code-tmux-asset.ts:1028-1040：先 `paste-buffer -d -p`，紧接着无条件 `send-keys Enter`；同文件 nudge（L1155-1175）有忙碌和空输入框判断，deliver 没有；delivery-and-review.md:93-95 写着“回合进行中粘贴会被排队并立刻产生记录，所以 pending 通常说明窗口错了或死了”，gate-log 里没有任何现场证据支持这句话
  - 建议：粘贴前先 capture，只在 pane 尾部出现对话框或菜单形态时拒绝，报 `before-send: target-not-at-prompt`（failed-before-send，可以安全 re-arm）。不要拒绝忙碌状态，否则合法的回合中排队投递也会被挡掉。改正 skill 里关于 pending 的那句话。加一个 Notification hook（permission_prompt），把“等待用户”变成能观察到的状态。
- **A3** [高 / 风险] 不检测也不固定 Claude Code 版本，而 helper 的屏幕抓取和 hook observer 的 wrapper 剥离依赖未公开的 UI 文本和格式（计划阶段 1；状态：部分（§13.132）：preflight 报告 node / tmux / claude 版本；版本检测与固定仍开放）
  - 说明：原生 Claude Code 会自动更新，同一批窗口可能跑着不同版本。屏幕抓取失败多数是安全失败（pending 或 busy）。wrapper 格式一变就不同了：所有 UserPromptSubmit 摘要都对不上，所有投递和回调都变成 indeterminate，而 observer 只存了剥离后的摘要，事后查不出原因。
  - 证据：claude-code-tmux-asset.ts:130-138：PASTED_TEXT_INDICATOR、API_ERROR_PATTERN、BUSY_PATTERNS、INPUT_LINE_PATTERN 等，版本只出现在注释里（2.1.282 在 L130，2.1.281 在 L580）；tmux-asset.ts:705-718：preflight 打印 `claude --version`，但不和任何范围比较；wakeflow-hook-observer.ts:252-268：用正则剥离 `<pasted_content>` 和 `<\cross-session-message>`，L340 只保存剥离后的摘要；启动依赖 --session-id、--resume、--worktree、--effort、--permission-mode 和 CLAUDE_CODE_SESSION_ID（tmux-asset:913），都没有版本检查；tests/hosts/claude-code/claude-code-tmux-asset.test.ts:906-956 用的是手写屏幕夹具；§13.130 列出 nudged 路径和折叠粘贴 readback 未执行
  - 建议：在 host profile 里写明经过测试的 Claude Code 版本范围。launch、resume、preflight 时记录 `claude --version`，超出范围就警告；status 和 verify 按窗口显示宿主版本。prompt 以 '<' 开头却没匹配到已知 wrapper 时，记录一条不敏感的诊断（比如标签名）。每个测过的版本保存一份真实屏幕作为 golden 夹具。
- **A4** [中 / 缺陷] helper 启动 tmux 前删掉了全部 CLAUDE* 环境变量，新窗口因此丢失 CLAUDE_CONFIG_DIR、Bedrock/Vertex 和 OAuth 配置（计划阶段 1；状态：阶段 1 已修（§13.132）：CLAUDE* 变量只放行用户配置白名单，宿主注入的一律剥掉）
  - 说明：原意是不让引导会话的 CLAUDECODE、CLAUDE_CODE_SESSION_ID 漏进子会话，但按前缀过滤把用户配置也一起删了。依赖 CLAUDE_CONFIG_DIR 或 CLAUDE_CODE_USE_BEDROCK/VERTEX、CLAUDE_CODE_OAUTH_TOKEN 的用户，子窗口会悄悄换成另一个配置目录或登录身份，可能根本没装 Wakeflow 插件，于是永远不会注册，launch 一直 pending。
  - 证据：claude-code-tmux-asset.ts:299-306 hostEnvironment：`name.startsWith("CLAUDE")` 一律跳过；tmux-asset.ts:308-315：所有 spawn（包括 tmux new-session）都用这个环境；L785-794 只用 -e 补回 PATH；03f8acec（§13.117）引入；由 helper 启动的 tmux server 会把过滤后的环境作为全局环境，后续 new-window 都继承它
  - 建议：只剔除会话级标记（CLAUDECODE、CLAUDE_CODE_SESSION_ID、CLAUDE_CODE_ENTRYPOINT 之类），其余全部透传。加一个 helper 测试，断言 CLAUDE_CONFIG_DIR 能传到 tmux 命令里。
- **A5** [中 / 风险] pane 进程检查只认 comm 名为 claude 的原生安装，hook 默认调用 PATH 上的 node 且不检查版本（计划阶段 1；状态：开放）
  - 说明：用 npm 安装或包装过 claude 的用户，每次 deliver 都会因 wrong-process 被拒，尽管窗口是对的，对他们来说整个流程不可用。hook runner 看到的 node 如果缺失或版本太旧，hook 会静默失败，session-start 记录永远不会出现。
  - 证据：claude-code-tmux-asset.ts:593-609 claudeCommandFor 只认 ps comm basename 为 'claude'，退而求其次用 pane_current_command（L627），不符合就在 L1023 报 wrong-process；npm 安装和 node 包装脚本的 comm 是 'node'，只有 macOS 原生安装做过现场测试（§13.119 第 6 点）；hooks.json 直接调用 `node`，preflight（L705-718）不报告 node 的版本和路径；claudeBinary（L328-339）用启动时 PATH 上的 claude
  - 建议：preflight 报告 node 的版本和路径，并与 engines 范围比对。进程检查放宽为也接受命令行参数里带 Claude Code CLI 的 node 进程，或者改为依赖窗口选项加上绑定会话的 session-start 记录。README 列出支持的安装形态。
- **A6** [中 / 风险] 运行时没有 Node 版本守卫：Node 22 下失败发生在错误处理路径深处，Node 26 不在声明范围内（计划阶段 1；状态：开放）
  - 说明：PATH 上是 Node 22 的用户（nvm、从 GUI 启动的宿主）能启动 server，但第一次文件系统报错时就会在错误分类器里抛 TypeError，init 或维护会以一条误导性的消息失败。hook 按设计静默失败，所以落地证明的通道会直接消失。另一头，`<25` 把 Node 26 排除在外，却既没测过也没有明确拒绝。
  - 证据：src/foundation/node/node-system-error.ts:17-23,47 调用 `Error.isError`（Node 24 才提供），有 20 个 src 文件 import 它；plugins/*/.mcp.json 和 hooks.json 直接调用 `node`；grep 在 src 里找不到 process.versions 守卫；engines `>=24.19.0 <25`，宿主不强制执行；shipped README（assets/agent-text/README.md:54-59,79）只写“node 在 PATH 上”
  - 建议：在生成的 server.mjs 和 observe.mjs 开头加一段极小的版本检查，给出明确的“需要 Node >=24.19”提示后退出。shipped README 写明 Node 版本、git、tmux（Claude）和仅支持 POSIX。测试 Node 26 后决定是放宽范围还是明确钉住。
- **A7** [中 / 缺口] 看不到宿主阻塞状态（登录过期、用量上限、API 错误、等待权限），而 UserPromptSubmit 落地并不代表提示已经被处理（计划阶段 1；状态：开放）
  - 说明：UserPromptSubmit 在模型调用之前触发，所以向登录已过期或已到用量上限的窗口投递，也会记录为落地并被接受，但不会有任何工作发生，Demand 只能等一个永远不来的回调。status 分不清长回合和死回合，被引导的用户也不会被告知去某个窗口执行 /login 或点一下批准。
  - 证据：wakeflow-hook-observer.ts:120-125 HOST_EVENTS 只有 SessionStart、UserPromptSubmit、Stop、SessionEnd，没有 Notification hook；grep 在 src 里找不到 login 或 usage limit 的处理，只有 Controller SKILL.md:177-182 的描述；gate-log §13.128：pod Controller 在关闭中途遇到 'Login expired'，是维护者恰好在看才发现的；wakeflow-status-result.schema.json:805 的 lastObservation 只有 {event, recordedAt}；§13.130 第 14 行把 /login 本身判定为宿主边界，但这个判定不涉及让阻塞状态可观察
  - 建议：在 claude-code-hook-fragment.ts 订阅 Notification hook，记录只含类型、不含消息正文的 attention 观察。status 按窗口报告“等待用户：permission 或 idle-prompt”以及距上次观察的时长。Controller skill 教它把这些当作用户唯一要做的动作转告用户。
- **A8** [中 / 风险] worktree 启动后不核对 Claude Code 实际用的是不是 helper 准备好的 checkout（计划阶段 1；状态：开放）
  - 说明：如果 Claude Code 更新后改了 worktree 目录或分支命名，就会再建一个基于远端默认分支的 checkout。receipt 照样接受会话报告的 cwd，产品工作悄悄从一个不同于 local-head 承诺的基线开始，唯一的症状是后来的合并出乎意料。
  - 证据：claude-code-tmux-asset.ts:25-29、522-568：预先创建 `<repo>/.claude/worktrees/<name>` 和分支 worktree-<name>，依赖 Claude Code 的内部命名约定；tmux-asset.ts:872-906：启动后观察 hook.record.cwd（L889），但不和准备好的 checkout 比较，照样报 worktreePrepared: created；gate-log §13.128：裸 `claude --worktree` 从 origin/main 建出 checkout，而本地 main 落后 12-38 个提交，是碰巧才发现的
  - 建议：在 launch 里，prepared 不为 null 且 hook 记录存在时，比较 realpath(hook.record.cwd) 和 realpath(checkout)，不一致就报 `worktree-cwd-mismatch` 并停止，不进入注册。
- **A9** [低 / 风险] 助手的"工作中"识别与回读依赖 Claude Code 的屏幕文字：2.1.283 不再显示 "esc to interrupt"，回调的回读看不到折叠指示（计划阶段 1；状态：已修（§13.134、§13.135）：助手把 2.1.283 的计时行（"… (23s"）与 API 断连重试行（"Waiting for API response · will retry in …"，§13.135 现场）都认作工作中，nudge 与就地重启的闲置判断共用、扫整屏，加了真实屏幕回归；回调的屏幕回读仍只作参考（F13 未改））
  - 说明：2.1.283 的工作中状态是 "✢ Computing… (23s · ↓ 1.4k tokens · thinking with xhigh effort)"；助手 nudge 的 BUSY_PATTERNS 只认 "esc to interrupt"。nudge 仍安全只是因为 spinner 行成了最后一行对话。回调粘贴后 readback 一直 pending（hook 记录已证明落地）。
  - 证据：§13.133 现场（F3、F13）。
  - 建议：工作中识别改为"输入框上方最后一行含省略号的 spinner"这类结构判断，并在 preflight 报告 Claude Code 版本时提示未验证的版本；回读只作参考（已如此），但补一条 2.1.283 屏幕的回归。
- **A10** [中 / 缺陷] 账本在工作区之外（缺省的 `../wakeflow-ledger`）时，所有窗口的允许目录都不含它，读需求包就要权限确认（计划阶段 1；状态：已修（§13.134）：Claude 启动意图在账本位于工作区之外时给每个窗口加 `--add-dir <workspace root>/<账本>`，端点测试覆盖内外两种位置）
  - 说明：§13.133 现场里 Controller 读 landing.md 就停在权限确认上；§13.134 起投递提示词的阅读顺序让产品与 Test 窗口也去读 requirement.md 与 landing.md，问题会扩大到每个窗口。
  - 证据：§13.133 现场 F11；`src/capabilities/endpoint/service.ts` 的 `claudeAddDirArguments` 原来只加工作区根与挂载的 worktree。
  - 建议：（已做）按账本位置加目录；Codex 的沙箱可写目录另行确认。

## B. 并发、崩溃与长期运行：若干残留状态经公开入口无法恢复

高。设计把所有中断的多步操作都交给恢复逻辑处理，但至少三类崩溃残留（append candidate、board 锁、projector 锁）没有任何可达的公开恢复路径。锁的存活判断经不起 PID 复用，取消信号在生产中是死代码，pod 不变量和投影写入都依赖“先查后做”，hook 目录在持续使用后会触顶让整个系统失效。这些都没有杀进程测试覆盖。

- **B1** [高 / 缺陷] append 过程中崩溃留下的 candidate 会让 Demand 永久无法加载，公开工具都不能恢复它；SIGHUP（tmux kill-window）会直接杀死写到一半的 server（计划阶段 2；状态：开放）
  - 说明：产品窗口导入结果时，如果 server 在 candidate 写入之后、retire 之前被关（decommission、为刷新产物而 relaunch、宿主退出），此后这个 Demand 的 status、plan、review、complete、cancel 全部失败，而且报出的不是专门的 candidate 码。恢复函数写了也测了，但没有接到已发布的 Demand 上，唯一的出路是手工删 .wakeflow-active 里的文件。崩溃窗口只有毫秒级，但后果是一个永远无法完成或取消的 Demand。
  - 证据：demand-file-event-store.ts:622-654 写 candidate，:661 link，:711 retire；demand-event-sourcing-root-inventory.ts:368-373,426：append-candidates/ 非空就 assertEmpty 抛 tree-shape；appendCandidateCount 是字面量类型 0（:71,:561）；root-authority.ts:455-466 映射为 inventory；capabilities/demand/context.ts:219-231 让所有 Demand 命令以 precondition-failed/demand-authority-inventory 失败；recoverAppendCandidates 只有 publication-stage.ts:136（发布前）调用；observation decide.ts:435-437 的 'candidates:N' 永远到不了；wakeflow-mcp-stdio.ts:42-43 只处理 SIGINT 和 SIGTERM；helper close 用 kill-window（tmux-asset.ts:1238），会发 SIGHUP；跨进程 append 没有串行化（进程内队列 demand-file-event-store.ts:141-165），其他 server 在对端 create 到 retire 之间加载时会拿到不可重试的 precondition 错误
  - 建议：让已发布 Demand 也能走到残留 candidate 的恢复：加载时容忍并报告 candidate，owner 全部不活跃时在下一次 append 前执行 recoverAppendCandidates，或者在现有工具上加一个按 demandId 限定的 recover 模式。给 appendCandidateCount 一个真实类型，让 verify 码能触发。活进程持有的 candidate 改报可重试的 concurrency-conflict。SIGHUP 按 SIGTERM 处理。补一个回归测试：留下 candidate，要求有公开的恢复路径。
- **B2** [高 / 缺陷] requirement board claim 锁和 active projection 锁在崩溃后留下的残留没有退役路径（计划阶段 2；状态：开放）
  - 说明：持有需求 R 的 claim 锁的 server 如果死掉，之后 R 对应 Demand 的 complete、cancel 以及 Design 的 withdraw、activate 都会在 10 秒后以“可重试”冲突失败，而且永远不会恢复，Demand 无法归档。projector 锁残留则让每个窗口的每次变更都白等 10 秒，投影悄悄变旧，verify 指向维护，而 reconcile 的刷新又不做恢复，形成死循环。binding store 早就在入口处自动退役同类残留，这两把锁只是没接上。
  - 证据：rooted-exclusive-file-lock.ts:756-783 acquire 永远不打破锁（按设计，:76-81）；只有 retireRootedExclusiveFileLockResidue 的调用方能清理；该函数的调用方覆盖 config、gitignore、program instructions、binding store、maintenance、ledger、demand publication、projection，不包括 board/locks（requirement-board.ts:108-139，10 s 超时，retryable:true）；board 锁使用方：requirement/service.ts:717,740,798，demand/lifecycle.ts:779,1206（complete 和 cancel）；projector 锁：retireInactiveLock 只在 recovering===true 时运行（active-projection.ts:1368），唯一传 true 的是 fresh-initialize 恢复（step-executor.ts:507）；active-projection-refresh.ts:128-139 吞掉超时；maintain-workspace.ts:713 同样不带 recovering
  - 建议：两把锁都按 binding store 的方式处理：acquire 前检查锁，owner 不活跃就退役（同一父目录里做 stage 恢复），或者让 reconcile apply 和 status 传 recovering:true，并给 board 锁加一个 reconcile 步骤。在 status.maintenance 或 board-consistency gate 里显示被持有或 owner 不活跃的锁。owner 不活跃时的超时不再标记为 retryable。每把锁各写一个“死进程残留必须能经公开流程恢复”的测试。
- **B3** [高 / 风险] hook 观察目录的读取上限固定为 16384 条，保留期 30 天；超过后落地证明、窗口注册和 status 读取全部失败（计划阶段 2；状态：开放）
  - 说明：同一宿主的所有会话（主窗口加所有 pod）写同一个目录。30 天内平均每天超过约 546 条就会触顶：8 个主窗口加 8 窗口 pod 共 16 个会话，每个回合有 prompt 和 stop 记录，每次重启或 resume 还有 start 和 end 记录。一旦触顶，列目录在过滤之前就抛错，此后落地证明、注册、relocate、status 的 hook 域全部失效。记录都在保留期内，裁剪也救不回来。能否触发取决于持续使用的强度，目前还没有任何运行达到过。
  - 证据：src/kernel/hook-observations.ts:145 上限 16384，:151 保留 30 天；按年龄裁剪（:380-386），不按数量；hook-observations.ts:566-575 列目录时带上限，stable-directory-read.ts:458-459 超限抛 too-many-entries，不截断；同一上限也用在 endpoint/service.ts:491,502 和 workspace-observation.ts:260；WakeflowTestWorkspace 两天轻度测试产生 373 条（09-24 97 条，09-25 276 条）；验证者估算按当前速率 30 天约 5.6k 条，低于上限；上限和裁剪有单元测试（hook-observations.test.ts:242-273），但没有长期运行的实证
  - 建议：列目录量大时不要让读取失败：按时间序文件名只读最新 N 条（已有 since 过滤），或者按天分片目录，或者让保留同时按数量调整。加一个超过 16384 条的回归测试，外加约 1 万条记录的 soak 测试，量注册、落地查找、裁剪和 helper 轮询的延迟。
- **B4** [中 / 缺口] MCP 请求取消传不到运行时，整套 abort 信号管线在生产中是死代码（计划阶段 2；状态：开放）
  - 说明：用户按 Esc 或宿主超时后，server 继续把维护 apply、10 秒锁等待、整份投影渲染跑完，这时 Agent 可能已经发出下一个调用，两者在同一个 server 里交错执行。幂等和 CAS 让结果大体安全，但设计以协作式 abort 为前提，测试验证的行为产品实际上从来不会发生。
  - 证据：wakeflow-public-mcp-tool.ts:228-233 handler 是 `async (request) => ...`，丢掉了 SDK 第二个参数里的 AbortSignal；executor 签名是 (value: unknown) => Promise（:32），入口处从不传 options；grep 'signal' src/entrypoints 没有结果；数百个 aborted 分支（包括锁等待 rooted-exclusive-file-lock.ts:715-731）只有测试能走到；gate-log §13.128 多次记录 'Connection lost mid-response' 和用户中断
  - 建议：把 SDK handler 的 extra.signal 作为 options.signal 传给所有 executor，考虑加每次调用的硬截止时间。写一个入口测试：在慢锁等待期间发送 notifications/cancelled，期望得到 aborted 且没有写入。
- **B5** [中 / 风险] “每个 pod 只有一个活动 Demand”是先查后做，没有 pod 级锁，也与 pod close 存在竞争（计划阶段 2；状态：开放）
  - 说明：并行工具调用、响应丢失后的重试、两个会话同时充当 pod Controller，都可能让同一个 pod 出现两个活动 Demand（违反 ADR-0010 D3 和 ADR-0011 D7）。pod close 第一阶段也可能看到“没有活动 Demand”，把 pod 设为 closing，随后 Demand 仍然在这个 closing 的 pod 上发布。两种情况都能用 cancel_demand 收拾，但不变量本身没有被强制保证。
  - 证据：demand-event-sourcing-publication-service.ts:424-427 源码注释自己承认 apply 时的复查只是尽力而为，不是互斥，真正的保证需要 pod 级锁；demand-active-guard.ts:156 assertNoActiveDemand 不加锁扫描 board；发布按 demandId 加锁（:249-270），claim 锁按 requirement 加；create 用 command 打开时的配置快照读 pod.lifecycle（demand/service.ts:245-262）；pod close 在另一把锁下检查 activeDemandOnPod（pod/service.ts:310-321）；ADR 和 gate-log 残留都没有把它记为已接受的限制
  - 建议：加一把 pod 级锁（如 .wakeflow-active/pods/<podId>.lock），带 owner 不活跃自动退役，把 guard 加 claim 以及 pod close 第一阶段的检查加配置写入都包进去。用 worker threads 写一个双进程回归测试。
- **B6** [中 / 风险] 运行时变更和维护之间不串行；窗口投影从无锁读取渲染再写入，可能丢失更新；并发模型没有写进 ADR（计划阶段 2；状态：开放）
  - 说明：pod create 或 reconcile 读到 binding B1 之后，窗口 W 在 binding 锁下注册成 B2 并写出投影 P2，维护刷新随后用基于 B1 的 P1 覆盖了 P2。status 报 stale，reconcile 能修好。许多窗口同时注册、而 Controller 又在跑 pod 或配置事务时（§13.128 用脚本重启了 16 个窗口）很可能发生。更一般地说，正确性完全依赖逐资源的锁和 CAS，而这一点既没写成文档也没有测试。
  - 证据：WAKEFLOW_MAINTENANCE_GATE_REF 只在 src/workspace/maintenance 内被引用；旧实现所有运行时服务都走 withWakeflowRuntimeMutation（legacy wakeflow-workspace-mutation.mjs:3997）；legacy-alignment-ledger.md:238 标为 recut 并引用 ADR-0013，但 ADR-0013 没有并发模型；refreshWakeflowWindowRuntimeProjections（projection-maintenance.ts:207-256，pod/service.ts:516 调用）从无锁的 binding inventory（inspection.ts:244-252）渲染；publishWakeflowWindowRuntimeProjectionDocument（document.ts:141-157）只对刚读到的投影文件做 CAS，不比对它渲染所依据的 binding
  - 建议：用 ADR 写明并发模型（维护独占，还是按资源加锁）。投影刷新要么在 binding-store 锁下完成读、渲染、发布，要么以源 binding 摘要做 CAS，源已变化就跳过。加一个注册与 pod-create 刷新交错执行的测试。
- **B7** [中 / 风险] 锁 owner 的存活判断只用 kill(pid,0)，PID 复用或 EPERM 会让残留锁无法退役（计划阶段 2；状态：开放）
  - 说明：重启或断电后 PID 从小数开始重新分配，死掉的 server 的 pid 很容易落到一个活着的（常常是 root 的）进程上，结果读成 active 或 unknown，所有恢复路径都拒绝处理，用户只看到 owner-active，毫无线索。后果和“没有退役路径”一样，只是更少见。
  - 证据：rooted-exclusive-file-lock.ts:375-381 锁记录只有 pid、threadId、token，没有进程启动时间或 boot ID；observeOwnerState（:397-412）：kill 成功算 active，EPERM 算 unknown，退役要求 inactive（:566）；append candidate 用同一套逻辑（demand-file-event-store.ts:184-199）；维护 gate 残留 owner 为 unknown 时只报告、不可退役（core-layout-inspection.ts:402-409）
  - 建议：锁记录和 candidate、stage 名里加入 owner 进程启动时间（macOS 用 kern.proc sysctl，Linux 用 /proc/<pid>/stat）和 boot ID；pid 相同但启动时间不同就判为 inactive。遇到 EPERM 时比对记录的 uid 或启动时间，不直接返回 unknown。
- **B8** [中 / 风险] 中断的维护事务在插件解析、矩阵或计划代码变更之后无法恢复（计划阶段 2；状态：开放）
  - 说明：apply 被崩溃、断连或关窗口打断后，如果恢复前插件代码更新了，recover 会在解析或计划比对时失败。status 一直显示 recovery-required，skill 一直让 Controller 去 recover，唯一的出口是手工删事务文件，而这一点没有任何文字说明。这需要“中断”和“升级”两件事叠在一起，窗口较窄。
  - 证据：wakeflow-maintenance-execution-intent.ts:245-293：normalize() 用当前代码重跑 createWakeflowMaintenanceExecutionPlan，要求 planDigest 一致；0ef5defa 之后 parseSurfaces 调用 parseTmuxAsset(record.tmuxAsset)，遇到 undefined 失败，0ef5defa 之前写的 intent 已经无法解析；maintenance-execution-intent.schema.json 把 currentHostProfile 和 sharedPreview 只类型化为 object，schema:check 看不出漂移；SKILL.md:148-153 遇到 recovery-required 只让 Controller 去 recover；验证者更正：recovery 用的是 intent 内嵌的预览和 profile（recovery.ts:199-220），单纯的资产变更不会破坏恢复
  - 建议：让恢复不依赖当前代码：持久化已执行步骤和预期字节或摘要，前滚或回滚时不再重新推导；或者在 intent 里记录产物摘要，不一致时返回带引导放弃流程的类型化阻塞 `recovery-requires-original-artifact`。补一个用其他构建写的 intent 做恢复的回归测试。
- **B9** [中 / 缺口] 没有任何测试在操作中途真正杀死进程，崩溃恢复的结论都建立在人工构造的残留上（计划阶段 2；状态：开放）
  - 说明：设计把 stage、link、retire 或 lock、write、release 这类多步操作的中断都交给恢复逻辑，但从来没有端到端验证过真实被杀之后这些恢复能否从公开入口走到。现场测试遇到过 API 错误和登录过期，这些都不会杀死 MCP server。
  - 证据：tests 里没有 SIGKILL、子进程 .kill() 或 Worker 构造；锁残留测试用同线程伪造（rooted-exclusive-file-lock.test.ts:239-292）；gate-log §13.131 L3861 明确推迟了故障注入 seam；§13.130 唯一的现场故障注入是伪造 intent 文件；上面三类没有公开恢复路径的残留，正是杀进程矩阵能发现的问题
  - 建议：建一个崩溃矩阵 harness：以子进程启动真实 MCP server，在注入点（环境变量控制的暂停标记，或轮询 stage/candidate 文件）SIGKILL，断言 status 能指出问题，并且一次有文档的公开调用就能恢复到 idle。覆盖 append、board claim、projection、binding、ledger 证据、demand 发布、维护 apply、pod 事务。
- **B10** [低 / 风险] 锁释放失败时，已经成功提交的变更会被报成失败，锁也可能留在原地（计划阶段 2；状态：开放）
  - 说明：锁文件元数据漂移或瞬时 I/O 错误会让一次成功的 claim-state 写入以错误返回，Agent 重试时会碰到 CAS 失败或未释放的锁（board 锁本身又没有退役路径）。很少见，但违背了“要么有结果、要么什么都没发生”的约定。
  - 证据：withRootedExclusiveFileLock（:813-830）在 finally 里 release，没有 catch：release 抛错会丢掉成功结果，或者覆盖原本的操作错误；requirement-board.ts:132-137 把它映射成可重试的 concurrency-conflict
  - 建议：操作成功时照常返回结果，释放失败单独报告（警告加残留检查），或者至少标记为 committed-but-lock-residue，避免调用方盲目重试。
- **B11** [低 / 待决] 平台范围（Windows、网络文件系统）没有对用户声明，锁机制依赖 POSIX 的 pid、link 和权限语义（计划阶段 2；状态：开放）
  - 说明：在 NFS/SMB 上，或者工作区跨机器、跨容器共享时，kill(pid,0) 查的是错误的 PID 命名空间，远端还活着的持锁者会被当作 inactive 退役，或者反过来。Windows 会被早早拒绝，但用户文档没有写。需求文档还声称已经声明过。
  - 证据：plugins/*/package.json 没有 "os" 字段；README 里没有平台说明；docs/requirements/README.md:37 声称“制品与 README 明确声明不支持 Windows”，但实际没有；验证者更正：至少十个 geteuid helper 在 win32 下以 unsupported-platform 失败，fresh-initialize 第一次写配置时就能早早拒绝 Windows；网络文件系统只在源码注释里排除（rooted-exclusive-file-lock.ts:79），没有 statfs 检查
  - 建议：确定并写明支持的平台（macOS/Linux、本地文件系统），在两份 README 和 package.json 的 os 字段里声明，并修正 requirements/README.md:37。fresh-initialize 预览在非本地文件系统上以明确的码阻塞。
- **B12** [高 / 缺陷] 关窗时 session-end hook 被杀在原子写中途，留下的 `.wakeflow-atomic-…tmp` 让 hook 通道门永久失败（计划阶段 2；状态：已修（§13.134）：读取方不再把写入器自己的暂存文件（create、0600、链接数 1–2 的普通文件）计入 skipped；写入新记录后，比新记录早 10 分钟以上且属主进程已退出的暂存由同一条修剪路径退役；verify 级回归已加；形状不对的暂存另登记 B13）
  - 说明：助手 `close`（tmux kill-window）结束会话时，Claude Code 的 session-end hook 进程在原子创建的中途被杀，`observations/hooks/` 里留下一个暂存文件（内容是一条完整的 session-end 记录）。读取方把它算作无法识别的条目，`hooks.skipped=1`，verify 的 `host-hook-channel` 以 `claude-code:skipped-1` 失败，整体变 `degraded`；对账与观察者都不清理它，Controller 也无从知道原因。
  - 证据：§13.133 现场（刷新窗口时关掉的 AlembicCore）；`src/kernel/hook-observations.ts` 的 `listed.unrecognized` 计入 `skipped`。
  - 建议：把 `.wakeflow-atomic-*` 暂存文件从"无法识别"里分出来：超过一段时间的暂存残留由观察者或对账退役（它是 Wakeflow 自有私有目录里的中间文件），读取方不计入 skipped；另测一次"关窗时 hook 被杀"的回归。
- **B13** [中 / 缺陷] hook 目录里任一形状不对的 `.wakeflow-atomic-*` 条目会让之后所有 hook 写入失败（计划阶段 2；状态：开放，§13.134 复核发现）
  - 说明：写入器每次写前由基础层检查目标目录里全部暂存前缀条目；只要有一个是目录、符号链接、格式不对、权限位不对或属于别的用户，就以 `stage-recovery-required` 拒绝，hook 写入以 `io-failure/observation-write-stage-recovery-required` 失败，这个宿主的 hook 通道从此断掉，直到有人删掉那个条目。读取方会把它计入 skipped，verify 看得见，但没有恢复出口。
  - 证据：`src/foundation/filesystem/durable-atomic-file-stage-recovery.ts` 的 `collectStages` / `assertStageNode`；§13.134 B12 修复只豁免并退役写入器自己能留下的 create / 0600 暂存。
  - 建议：由基础层决定：hook 目录的写前恢复只看同一目标的暂存（记录名唯一），或由对账把形状不对的暂存列为可退役项并在 verify 里点名。

## C. 持久格式演进、版本与发布：1.0.0 还没发布，但不兼容已经在累积

高。1.0.0 从未打 tag，GitHub main 却已经是安装渠道。“1.0.0”这个版本号底下已经有多份字节不同、格式互不兼容的构建。持久数据没有 1.0 之后的兼容策略，事件的状态摘要把全部历史绑死在当前 reducer 上，也没有 golden 回放语料。托管文本和配置一有改动，已有工作区就会被阻塞而无路可走。升级检测只在同路径覆盖时有效，也没有 CI 把关。

- **C1** [高 / 缺陷] 1.0.0 从未打 tag，却已作为 main 安装渠道持续变更；同一版本号对应多份不同字节，安装缓存按版本号键控（计划阶段 3；状态：开放）
  - 说明：每次 push 到 main 实际上都是一次发布，但版本号一直不动。Claude Code 按 <marketplace>/<plugin>/<version> 缓存插件，09-20 之后从 GitHub 安装的用户很可能停在他们最初拿到的那份 1.0.0 上，包括没有 387 项评审修复的构建，而且收不到任何信号（按版本号键控时的更新行为属于推断）。README 描述的发布流程在 TS 系列里从未真正执行过。
  - 证据：assets/release/version.json 为 1.0.0，最后一次修改在 629e79c5（2026-09-20）；此后 plugins/ 有 29 次提交；git tag 最新为 v0.9.4；check-release-consistency.ts:296-302 要求 v<version> 指向 HEAD，所以 release:check 现在无法通过；README.md:95-96 让用户从 GxFn/Wakeflow 安装；HEAD == origin/main == 0ef5defa；installed_plugins.json 中 wakeflow@gxfn 为 1.0.0，缓存在 cache/gxfn/wakeflow/1.0.0，manifest 166f580c，仓库是 2075d916，两者都叫 1.0.0；gate-log §13.113 在无 upcaster 的情况下删除了配置字段；§13.131 原地放宽 v1 事件数据；runtime-artifact gate（observation/decide.ts:622-631）只比较 manifest 摘要；没有“字节变了版本就必须变”的检查
  - 建议：先选定渠道模型：要么每次改动 plugins/ 的 push 都 bump 补丁版本并打 tag，要么在开发分支开发、main 只通过发布流程前进；tag 之前的构建可以用 1.0.0-rc.N。在 gate 中加一条检查：plugins/ 与最近 v* tag 不同时，version.json 也必须不同。真正发布一次 v1.0.x，并把 release:check 实际跑通。
- **C2** [高 / 待决] 持久数据没有 1.0 之后的兼容策略，v1 格式一直在原地修改（计划阶段 3；状态：开放）
  - 说明：没有用户数据时，“直接改 v1”是合理的，但没有任何地方标明这条规则何时失效。所有持久读取器都是严格的（additionalProperties false、精确字段、const 1）。1.0.0 一旦发布，这个习惯会让真实用户的 Demand、配置和维护残留在升级后无法读取，而 ADR-0008 给出的唯一出路（重新初始化）会破坏正在进行的 Demand。作者确实有意识地保证旧形状事件能逐字节回放，但这份注意并没有写成政策。
  - 证据：ADR-0008 决定 1/5：配置从 v1 开始，不写 upcaster；卡片 01 第 93 行“不写任何旧版本读取器”；gate-log 2649/2669/2691“直接改 v1”；3295 删除配置字段后“只能重新初始化”；3856 原地放宽 lifecycle.demand-continued v1 数据；0ef5defa 给 host-profile surface 加了 tmuxAsset，并用 assertExactFields 解析；2457c961 把 managed-evidence manifest 读取路径的容量检查从 compact 改为 rendered 字节；01ecfcde..HEAD 期间真正收紧的持久 schema：target-result-recorded 的 bindingId pattern、两个 review decision 新增禁止控制字符（含 TAB）；只有 Demand 事件有 upcaster（demand-event-sourcing-upcaster.ts）；包含 schemaVersion const 1 的 schema 文件有 56 个；docs/decisions 里没有冻结或向后兼容的政策
  - 建议：在第一次打 tag 时生效一份 ADR：tag 之后 v1 线上格式冻结；增量改动要新的 eventVersion/schemaVersion 加 upcaster；删除字段要有能容忍旧字段的读取器；每种持久格式写明生产者和消费者，以及旧运行时能否读新数据。用一个 gate 把持久格式 schema 和手写的精确字段表与上一个发布 tag 做 diff 来执行。
- **C3** [高 / 风险] 每个事件存储的 resultingStateDigest 把全部历史绑死在当前 reducer 上，却没有 golden 回放语料来发现漂移（计划阶段 3；状态：开放）
  - 说明：任何改变已有事件序列所产出状态的改动（evolve 的 bug 修复、新增派生字段、默认值或排序变化），都会让已有 Demand 流以 relation 或 transition 失败。唯一安全的做法是给事件加可选字段。失败还不一致：形状不变的漂移下，变更可以从快照继续走，全量回放却失败，于是 Demand 能推进却完成不了。§13.131 的残留说明 continue 还没在现场用过，受影响的流暂时不存在，但这个机制对以后任何 evolve 改动都成立。
  - 证据：demand-event-sourcing-stored-event.ts:166 持久化 resultingStateDigest；aggregate.ts:215-217、demand-event-stream-commit.ts:584-595、file-event-store.ts:371、reader.ts:562、snapshot.ts:218/292 回放时逐事件重算并比对；demand-event-sourcing-state-version.ts:1-11 只有 state model v1，注释承诺会有历史 validator/migrator，但没有实现；gate-log §13.131 L3856：第 2 轮 reducer 修复会让已持久化的 continue 流无法读取，是独立评审发现的，不是测试；第 3 轮靠可选事件字段 historicalTestTargetIds 绕过；2457c961（+118/-73）和 0ef5defa（+79/-13）在已有真实流之后改动了 demand-aggregate-state.ts；tests 下没有非 .ts 夹具，没有 Demand 状态摘要 golden；场景测试总是用当前 reducer 新建流；全量回放驱动 verify 审计（demand-verify-gates.ts:110-116）、root-authority.ts:532、归档封存和归档读取
  - 建议：从测试工作区的真实流（包括 continue 过的和已归档的 Demand）脱敏后冻结成 golden 语料放进 tests/，在 npm test 中用当前 reducer 回放并比对最终摘要，覆盖全部 11+ 种事件类型。同时在 ADR 里定下演进方式：要么不再持久化派生状态摘要、只校验事件摘要，要么实现 state-version.ts 已经承诺的 v2 validator/migrator（旧 reducer 作为 vN 校验器保留，或者引入重新证明事件）。
- **C4** [中 / 未验证] 测试工作区里 7 份旧构建写的归档（95 个事件）从未被 HEAD 重放过（计划阶段 3；状态：已回放（§13.132）：发现 1 处不兼容（§13.121 D7 之前的评审决定使评审单元摘要不复现），已修；7 份归档 72/72 项通过）
  - 说明：两轮评审都在这些归档封存之后修改了聚合、decider 和事件解析。HEAD 能否逐字节重放它们目前未知。如果不能，continue_demand 会失败，主 pod 归档的问题要到 continue 或读取归档时才会暴露。这是现成、成本最低的真实数据兼容性检查。
  - 证据：只读扫描 WakeflowTestWorkspace/ledger/archives：7 份归档、95 个事件，全部是 (1,1,1)，覆盖 11 种事件类型；目录时间 09-24 至 09-25 01:43，早于 2457c961 和 0ef5defa；gate-log §13.131：本轮没有现场复验；归档读取经 demand-result-review-snapshot.ts:510-534 → repository.ts:482-486 → replayCommits 用当前 reducer 回放；验证者更正：读取失败不是静默的，archived-demand-observation 单独计为 unreadable，service.ts:798-805 显示为 archives:unreadable-N，但 status 只读 worktree-pod 的归档
  - 建议：下次现场之前，用 HEAD 对每份归档和活动根做一次只读回放（带 demandId 的 status 和 verify，或专门的回放脚本），结果记进 gate-log，随后把这些数据脱敏后作为上面提到的 golden 语料。
- **C5** [高 / 风险] 任何托管文本的渲染改动都会阻塞所有已安装的工作区：上一版渲染出的块会被当成未知的用户所有块（计划阶段 3；状态：开放）
  - 说明：工作区的 CLAUDE.md/AGENTS.md 块、.gitignore 块、Design/Test 记忆文件、产品仓库块都由 src 里的常量文本渲染。下一次发布只要改动任何一个渲染器里的一个字，所有已安装工作区的 reconcile 预览和 local-layout verify 都会报阻塞。skill 告诉 Controller 手改过的块永远不会被覆盖，所以用户只能手工删块，这恰恰是被引导的用户不应该需要做的事。测试用同一构建渲染再读回，发布前发现不了。
  - 证据：wakeflow-managed-text-authority-transition.ts:24-29、213-217：已有托管正文必须等于当前渲染，或等于传入的 currentTarget；各生产者只传当前构建的渲染：static-materialization-preview.ts:502、step-executor.ts:1068、program-instruction-inspection.ts:465、external-instruction-inspection.ts:336；support-memory-inspection.ts:74 同理；wakeflow-managed-text-envelope.ts:39：marker 摘要只证明自洽，不授予权限；gate-log §13.116 L3365 在现场遇到过（unknown-managed-body/unadmitted-source，阻塞归用户）；§13.120 D2 只修了跨宿主的情况；没有测试固定渲染摘要，CLAUDE.md 和发布规则里也没有保留旧渲染的要求
  - 建议：为每个托管组件维护一张带版本的历史渲染输出（或正文摘要）表，作为准入的 currentTargets 传入。加 golden 测试，固定每个渲染块在固定配置下的摘要，任何文本改动都要先把旧摘要加进准入集合才能通过。在 CLAUDE.md 的 Change Discipline 里写下这条规则。
- **C6** [高 / 风险] 插件更新检测只在同路径覆盖时有效：真正的版本升级后，server-outdated 不会触发，windows-stale 还会指错方向；维护也不检查产物是否最新（计划阶段 3；状态：开放）
  - 说明：版本升级后新构建装进新目录。旧 Controller 读自己的旧根，要么结果“相同”，要么文件缺失读成 null 被放行，总之永远不知道自己过期了。它还用自己的旧摘要去比新启动的窗口，把新窗口标成 stale，让用户去 resume 本来是对的窗口，而它自己可能执行 reconcile，把旧的 helper、statusline、settings 资产写回去。目前一直原地覆盖 1.0.0，所以还没触发；一旦按上一条修好版本号，就会立刻生效。
  - 证据：wakeflow-artifact-identity.ts:18-24,46-52：从进程自己的根重读 manifest；observation/decide.ts:627-639：只有 onDiskDigest 非空且不同才报 server-outdated，为 null 时放行；observation/service.ts:416-429：窗口产物状态只按相等判断（current/stale），不分新旧；缓存路径按版本分目录（gate-log 3427）；§13.127 只验证过原地修改 manifest；maintain-workspace.ts 没有产物新鲜度检查；“不要从过期 server 运行维护”只写在 workspace-and-windows.md:166-169；gate-log 3667：现场的 Controller 差点从过期 server 执行 reconcile
  - 建议：把检测锚定到已安装的产物，而不是进程自己的目录：manifest 和 hook 记录里写入可排序的身份（版本加构建序号或源提交），维护记录“最后物化的产物摘要”。区分“server 比窗口旧”和“窗口比 server 旧”，分别给出 nextActions。摘要不是最新的 server 拒绝维护 apply（类型化错误 server-outdated）。加一个新旧两个版本目录并存或旧目录被删的场景测试。
- **C7** [中 / 风险] 配置 schema 的任何改动都让工作区无路可走：reconcile/reconfigure 被阻塞，fresh-initialize 也被阻塞（计划阶段 3；状态：开放）
  - 说明：官方给出的补救办法（重新初始化）被 fresh-initialize 自己的拒绝规则挡住，唯一的出路是手工删除配置、.wakeflow-active、.wakeflow-local 和 ledger 根（包括归档和需求），board、活动 Demand、绑定和 pod 回执都会丢失。没有任何文字引导这个过程，违背了“由插件引导用户”的原则。发布后，第一次配置改动就会影响每一个用户。
  - 证据：wakeflow-config.schema.json:32-34：schemaVersion const 1，additionalProperties false；static-materialization-preview.ts:1152：配置无法解析时报 current-config-unavailable（currentSnapshot 返回 null，158-172）；fresh 被 fresh-config-present、fresh-active-not-absent、fresh-local-not-bootstrap-prefix（1143-1149）和 fresh-ledger-root-present（409）阻塞；gate-log 3295“只能重新初始化”；3746 没有配置时报 precondition-failed/config-authority
  - 建议：给配置自己的演进路径：对已删除字段宽容的读取器，或者一个按当前版本模型重写配置的 upgrade 维护动作。最低限度也要加类型化的 `config-version-unsupported` 错误，并提供保留 ledger 和活动根的 Controller 流程。
- **C8** [中 / 缺陷] 插件更新后的窗口刷新流程走不通：resume 拒绝仍在运行的 pane（locator-live），/mcp 重连也不能让 Controller 自己变成 current（计划阶段 3；状态：已修并经现场（§13.134、§13.135、§13.136）：Controller 先就地自重启（同一 pane 与会话、新参数、固定 prompt 自己续上），verify 后对账装上新助手，再对有过对话的 4 个窗口 `resume --in-place`、对从未对话的 3 个窗口得到 `resume-never-conversed` 后 close、launch、replace、mark，verify 15/15，全程无需用户操作；旧助手以 `argument-unknown` 拒绝时回退为用户 /mcp 一次（§13.135 现场按此走））
  - 说明：每次插件更新后，Controller 照着参考文档操作，每个窗口都会得到 locator-live，文本里没有安全的顺序（等空闲、close、resume、relocate、mark）。--force 会在同一个会话上再起一个进程。Controller 自己的窗口走 /mcp 重连后永远清不掉 stale，verify 始终达不到全部通过。这些刷新路径都没有由 Agent 按 shipped 文本实际执行过。
  - 证据：workspace-and-windows.md:165 对每个 stale 窗口套用 {{windowResume}}（claude-code-agent-text-profile.ts:72-76，这段文字是为进程已退出的情况写的）；claude-code-tmux-asset.ts:721-734：pane 仍在运行时 resume/launch 报 locator-live，除非加 --force；agent 文本里没有出现 locator-live；observation/service.ts:418-429 按 session-start 记录判断产物，/mcp 重连不会重写这条记录，Controller 一直是 stale，verify 一直报 windows-stale；文本也提供了“或 resume 会话”这个可行的替代（w&w:166-167）；§13.127 残留说 /mcp 重连能否切换代码未经验证；§13.130 是用外部脚本 live-130.mjs 刷新窗口的
  - 建议：在 windowResume 和参考文档里写出明确的刷新顺序：确认空闲（没有持有的 claim、没有进行中的回合）→ close → resume → relocate → mark；点名 locator-live，禁止对活会话用 --force。对 Controller 自己的窗口，要么把“正在服务的 MCP server 产物相同”视为 current，要么只教 resume。然后按 skill 文本在现场跑一遍。
- **C9** [中 / 缺口] 用户没有更新或升级流程，0.9.x 用户也不会被提前告知工作区会被拒绝（计划阶段 3；状态：开放）
  - 说明：老用户需要一整套步骤：更新 marketplace、更新插件、重启或 resume 每个窗口、重连 Controller 的 server、跑 status/verify。这些都没有面向用户写出来。0.9.x 用户更新后会被硬拒绝，没有迁移指引。
  - 证据：README.md:74-136 和 assets/agent-text/README.md 只讲安装和一次性信任；agent 文本里没有 plugin update 或 marketplace update；窗口刷新只写在 Controller 参考文档里（workspace-and-windows.md:156-169），而且依赖未经验证的 /mcp 重连；ADR-0008 D1：fresh-initialize 拒绝带旧标记的工作区；v0.9.4 用的是同一个名字 wakeflow@gxfn；README.md:254 只把这一点当作原则提了一句
  - 建议：两份 README 都加“更新”一节，写明宿主命令、Controller 接下来会引导什么、预期的 verify 状态。加一段简短的“从 0.9.x 过来”：先归档或清理旧的根，再重新初始化。
- **C10** [中 / 缺陷] 关于 Claude 插件从哪里运行的事实记录有误：server 跑在旧的版本化缓存里，最近两次评审提交从未在宿主中加载过（计划阶段 3；状态：已更正（§13.132）：三处 gate-log 原文加更正注；缓存随阶段 1 提交刷新）
  - 说明：团队实际做法已经把缓存当作起作用的那一份（§13.129 刷新过，§13.131 也承认没有现场复验），但勘误和第 15 项的推理本身是错的且没有更正。这意味着 2457c961（751 个文件）和 0ef5defa（134 个文件）从未在真实宿主中运行，也没有脚本化的“刷新并核对摘要”步骤。
  - 证据：gate-log L3477（§13.121 勘误）称目录型 marketplace 的 ${CLAUDE_PLUGIN_ROOT} 解析到源目录，所以不需要刷新缓存；ps 显示 `node <插件安装缓存>/wakeflow/<版本>/mcp/server.mjs`（2 个进程）；缓存 manifest 166f580c 是 §13.129 的构建；仓库为 2075d916；§13.130 的现场用的是外部拷贝 d8e0f584；§13.131 L3861 把缓存误写成 §13.130 的产物；§13.130 第 15 项基于这条勘误判断“只是开发布局的限制”；§13.129 其实显式刷新过缓存
  - 建议：更正 gate-log 勘误和卡片 10.6。在维护者流程里加一个脚本化的“刷新本地安装”步骤（卸载再安装，或 bump 版本后 update），并核对已安装 manifest 摘要等于 plugins/…/artifact-manifest.json，下次现场之前执行。
- **C11** [中 / 风险] 不同插件版本的窗口或克隆共享同一份严格存储，磁盘上不记录是哪个构建写的（计划阶段 3；状态：开放）
  - 说明：升级过程中，同一个事件存储、hook 目录和配置会被不同构建的窗口同时读写。旧窗口读到新数据只报通用错误，也不会提示去 resume；旧窗口写入时盖的是旧 reducer 算出的摘要，如果 reducer 不同，新构建就再也回放不了这条流，一个过期窗口能让一个 Demand 永久不可读。git 共享的 ledger 会把这种版本错位带到其他机器上。
  - 证据：每个会话的 MCP server 和 hook 从各自的插件根运行（workspace-and-windows.md:158-163）；target 窗口通过 import 追加事件；hook-observations.ts:157-172,288-295 要求精确字段集合，§13.127 手工放宽过一次；demand-event-stream-commit.ts:560-571：未知 eventType/version 会让整条流不可读；stored-event schema 只有 artifactKind，没有写入者版本或摘要字段；ledger 和 config 按设计由 git 跟踪（卡片 01 第 28 行），但测试工作区的 git 仓库还没有提交
  - 建议：每个 commit、归档 manifest、维护 intent 都盖上写入者的产物版本和摘要。比流中最新印记更旧的运行时拒绝写入（类型化错误 `artifact-older-than-stream`，owner 为 user，动作为 resume）；严格读取器遇到更新形状的数据时也映射成这个错误。README 写明支持哪些版本错位。
- **C12** [中 / 缺口] 没有 CI，也没有 pre-push 守卫：公开的 main 分支（即安装渠道）完全靠本地自律（计划阶段 3；状态：开放）
  - 说明：没有任何机制阻止一次 plugins/ 与 src 不同步、跳过 gate 或 smoke 失败的 push 进入 main。测试从未在 Linux 或干净机器上跑过，也没有对 vendored 运行时依赖（ajv、MCP SDK、zod）做审计。
  - 证据：仓库里没有 .github 或任何 CI 配置（只有 vendored node_modules 里有）；.git/hooks 只有 sample；gate 在一台 macOS 机器上本地运行，约 336 秒（gate-log §13.120 L3454）；smoke 按设计不在 npm test 内；1.x 系列从未通过 release:check
  - 建议：加一个最小的 GitHub Actions：Node 24、npm ci、npm test、npm run smoke:artifacts，在 ubuntu 和 macos 上对 push 到 main 运行；v* tag 上运行 release:check。可以再加 npm audit --omit=dev 和 dependabot。
- **C13** [低 / 债务] 发布元数据漂移：README/AGENTS.md 写六个占位符（实际九个），marketplace 的 metadata.version 不在检查范围内，manifest 没有源提交（计划阶段 3；状态：开放）
  - 说明：都是小事，但会削弱发布纪律：第一次 bump 时目录版本会悄悄漂移，已安装的产物也无法追溯到提交。
  - 证据：README.md:206、AGENTS.md:41 写“six placeholders”；grep 得到 9 个；CLAUDE.md 写九个；marketplace.json metadata.version 1.0.0 不在 check-release-consistency.ts:163 的五个来源里；artifact-manifest.json 没有 source commit 字段；CLAUDE.md 要求核对宿主将加载的确切版本和提交
  - 建议：修正两份文档；由 builder 从 version.json 派生 metadata.version，或者把它加进 release:check；在 manifest 里记录源提交（或 src/assets/tooling 的 tree hash），并在 wakeflow_status.runtime 中显示。
- **C14** [低 / 缺陷] vendored 依赖闭包删掉了 jsonc-parser 的 LICENSE.md，却带上了无关的 .github 文件（计划阶段 3；状态：开放）
  - 说明：MIT 许可要求随再分发的副本附带版权和许可声明，当前一个制品缺了一份。影响小，但确实是合规缺陷。
  - 证据：tooling/artifacts/plugin-dependency-closure.ts:26-33 EXCLUDED_EXTENSIONS 包含 .md；:223-224 只跳过点开头的文件，点开头的目录照样遍历；plugins/claude-code-wakeflow/node_modules/jsonc-parser 只剩 lib 和 package.json（Codex 制品不 vendor jsonc-parser，其他包都带 LICENSE）；每个制品带 7 个 .github 文件（fast-uri、json-schema-traverse）
  - 建议：无论扩展名如何，都保留 LICENSE*/LICENCE*/NOTICE*/COPYING*，跳过点开头的目录；在制品检查里断言每个 vendored 包都带许可文件（或者生成 THIRD_PARTY_NOTICES），然后重建。
- **C15** [低 / 缺口] 依赖字节直接从本地 node_modules 复制，没有按 lockfile 的 integrity 校验（计划阶段 3；状态：开放）
  - 说明：npm ci 之后被修改过的 node_modules（install script、本地调试时的改动）会原样进入提交的制品，build 和 build:check 都能通过。闭包很小且版本钉死，风险低，而且 integrity 数据已经现成。
  - 证据：plugin-dependency-closure.ts:183-190 只检查版本号和 sha512 字段是否存在，没有对字节做哈希校验；build:check 与同一份 node_modules 的新构建比较；只有 dev 依赖 @swc/core 带 install script；plugins/ 已提交，字节变化会出现在 git diff 里（部分缓解）
  - 建议：在 release:check 或 build:check 中按 lockfile 的 tarball integrity 校验每个复制的包（npm pack 重新取，或比对 cacache），或者在干净目录里用 npm ci --ignore-scripts 构建制品。
- **C16** [中 / 缺口] 插件更新后刷新窗口时，Controller 用 shell 循环批量调用助手、读插件实现找 server-outdated 的处理办法（计划阶段 3；状态：已修（§13.134）：SKILL.md 把 server-outdated / windows-stale 直接指到 "After a plugin update"，并写明每次 Bash 只调一次助手、参数写死、不用循环与变量）
  - 说明：刷新 7 个窗口时 Controller 把 close / launch 写成带变量的 for 循环（不匹配精确的助手 allow 规则，acceptEdits 下要确认）；看到 server-outdated 时先去 grep 插件目录与运行时代码。SKILL.md 没有把 server-outdated / windows-stale 直接导向 "After a plugin update"。
  - 证据：§13.133 现场（F5、F8）。
  - 建议：SKILL.md 把这两个码直接指到那一节；技能要求一次 Bash 只调一次助手，或助手提供批量刷新命令。
- **C17** [低 / 缺口] `runtime-artifact-outdated` 的 next 仍固定 owner 为 `user`，而 Claude Code 上 Controller 已能就地自重启（计划阶段 3；状态：开放，§13.134）
  - 说明：`observation/decide.ts` 的 `verifyNext` 与 status 的 nextActions 把 server-outdated 交给用户，注释也说只有用户能重连服务；§13.134 起 Claude 的 Controller 按技能用 `resume --in-place` 自己换代，只有旧助手时才需要用户 /mcp。技能文字已按宿主写对，next 的 owner 与注释是宿主中立代码里的过时说法。
  - 证据：`src/capabilities/observation/decide.ts` 的 `verifyNext`（`runtime-artifact-outdated` → owner `user`）。
  - 建议：owner 由宿主画像提供（Claude 为 controller，Codex 为 user），或改成中立的 owner 并把宿主差异只留在技能文字里。
- **C18** [低 / 缺口] relocate 接受当前意图摘要的观察，但绑定里记的仍是登记时的 `launchIntentDigest`（计划阶段 3；状态：开放，§13.135 现场）
  - 说明：§13.134 把 Claude 画像的缺省权限模式改成 auto，画像摘要进了意图摘要，所有窗口的意图摘要都变了；窗口按新意图 resume、relocate 之后，绑定里的来源摘要仍是旧值（现场 Design 为 `9a49…`，当前意图 `683d…`）。没有门比较它，只是历史值与实际启动参数对不上，审阅时会误读。
  - 证据：§13.135 现场 Controller 报告；`endpoint/decide.ts` 的 relocate 只核对观察摘要等于当前意图，不改绑定的 `source.launchIntentDigest`。
  - 建议：relocate 时把绑定的来源摘要更新为观察里的摘要（绑定 CAS 已在），或在 status 里把"绑定意图与当前意图不同"作为信息显示。

## D. 验证覆盖与现场证据的时效：gate 全绿证明的是源码，不是安装后的体验

高。最后一次完整现场运行早于约 400 项修复。自动化端到端只跑 Codex 组合，而现场只跑过 Claude。场景夹具的布局与真实布局不同，测试失败后的修复闭环和多数评审分支从未端到端运行。tmux helper 游离在静态 gate 之外，测试夹具是手写的。gate 本身又慢又对时序敏感。

- **D1** [高 / 未验证] §13.130 和 §13.131 改动的大量热路径从未在现场运行，测试工作区和插件缓存停留在旧构建上（计划阶段 1；状态：阶段 1 进行中（§13.132）：新建 WakeflowTestWorkspace2，缓存刷新后跑默认安装的现场全流程）
  - 说明：下一次真实 pod 会走一条从未遇到过真实 `claude --worktree` 会话的代码路径。rearm 路径到 §13.131 之前一直是坏的，说明没跑过的链路会把阻断流程的缺陷藏起来。已知限制：§13.131 之前写入的 continue 事件没有历史边界。
  - 证据：gate-log §13.131 L3861：本轮没有现场复验，窗口和缓存仍是旧产物（实际缓存是 §13.129 的 166f580c，仓库是 2075d916）；§13.131 改了热路径：prepare 在 claim 后重读 binding 并报 binding-changed、rearm→import 接受任意已记录的 claimDigest、三次 rearm 后重新 prepare、continue 检查 pod-unknown/pod-closing/research、helper close 无 marker 时 closeResult 为 unknown、historicalTestTargetIds；§13.130 L3830 未执行清单：nudge 的 nudged 路径、H1 折叠粘贴 readback、H4 worktree 自准备及其三种拒绝、O1 锁定 worktree 的建议、O2 已归档未合并分支、D9 现场加仓库、第 13 项（blocked 重新决策、continue_demand 重开、link/commit/observation 证据、controller-confirmed 评审）；§13.128 唯一一次真实 pod 用的是手工 `claude --worktree`；现在的 helper `launch --worktree` 只在桩 tmux/claude 加真实 git 下测过（claude-code-tmux-asset.test.ts:1004）；§13.131：continue 真实环境 Demand 之后永远无法再规划，这个问题直到评审才发现，1121 个测试都没拦住
  - 建议：刷新缓存、resume 或重启窗口，按固定清单跑一次脚本化现场：普通 Demand、一次故意的 rework、一次 rearm、一次 blocked 重新决策、complete→continue→再次 complete（真实环境类型）、一个 worktree pod 经 helper 创建并在 checkout 被锁定的情况下关闭。§13.130 未执行清单逐项标记为已验证或仍未验证；以后每次产物变更都带着 manifest 摘要记录一次现场。
- **D2** [中 / 缺口] 自动化端到端只在 Codex 组合上运行，现场只在 Claude Code 上运行（计划阶段 1；状态：开放）
  - 说明：真正没测到的是 Claude MCP 组合的端到端：投递时的 locator 检查、relocate、pod 中 tmux-session 的启动意图、Claude facade 下的评审和回调链路。这些分支里的回归能通过全部 gate，只会在下一次现场暴露。
  - 证据：tests/scenarios/wakeflow-scenario-acceptance.test.ts:39 只 import createCodexWakeflowMcpServer；delivery、result-review、evidence 的 service 测试里没有 Claude；claude-code-wakeflow-mcp.ts:94-124 的 Claude facade 只在 smoke（五个维护/观察动作）里端到端运行过；验证者更正：场景通过 hook 记录落地（test.ts:1264 断言 evidenceKind 'hook-record'），与 Claude 的机制相同；hook-observer 测试覆盖两个宿主，unwrapHostPrompt 有单测
  - 建议：让场景套件在两个宿主组合上参数化运行，至少 card-02、06、07、05/test-contract、10 两边都跑；Claude 一侧用 tmux locator 注册，并发送 Claude 形状、带 <pasted_content> 包装的 hook。在 scenario-acceptance.md 里写明每个场景验证的是哪个宿主。
- **D3** [中 / 缺口] 场景夹具把产品仓库放在工作区旁边，而真实布局把仓库嵌套在工作区根下面，这一类 bug 只在现场被发现过（计划阶段 1；状态：开放）
  - 说明：凡是对“仓库在根下”敏感的逻辑，比如路径隐私扫描、嵌套仓库的 .gitignore、hook observer 的放置位置、worktree 准入、5 个产品窗口的多仓库 pod，都只在用户不会用的布局下测过。发现的那一个 bug 修了，这一类问题没有覆盖。
  - 证据：wakeflow-scenario-acceptance.fixture.ts:171-182：Workspace 和 ProductA 是兄弟目录；真实测试工作区：5 个仓库嵌套在已 git 初始化的根下，worktree 位于 repo/.claude/worktrees/；gate-log §13.128 L3724：第一次真实 pod 的 5 个产品窗口全部注册失败，单元测试和场景测试都没发现；只补了 pod/service.test.ts:334-337 一个回归测试，而且放在 root/.wakeflow-test-worktrees；card-10 甚至断言投递 prompt 里是兄弟相对路径 `../Workspace/`
  - 建议：增加一个嵌套、多仓库的夹具变体（仓库在根下、worktree 在 repo/.claude/worktrees 下），至少让 pod、status/verify、delivery 场景在它上面运行。
- **D4** [中 / 缺口] 测试失败的修复闭环和多数评审分支从未通过公开工具端到端运行（计划阶段 1；状态：开放）
  - 说明：真实环境测试窗口的价值在于发现缺陷并推动修复，但“测试失败 → escalate{product-defect} → 授权 → 重新实现投递 → import → 带基线重测 → 接受 → 完成”从未作为一条链运行过。测试目标的代际、重测谱系、continue 之后的 historicalTestTargetIds、路由前沿在事件交互上可能有错，而任何切片测试都不会失败。§13.131 的 continue 缺陷就是这一类。
  - 证据：scenario-acceptance.md card-05/test-contract 只覆盖全部通过加 accept；card-07 escalate 的是实现，不是测试失败；场景测试里 request-another-attempt、product-defect、rejected-before-send、bug、research、supplement、taskPlanReview user 都是 0 次命中；这些分支只有切片测试：result-review/service.test.ts:677（flaky）、:803（product-defect）、:229（blocked）；现场 Demand 都只改了很小的文件（§13.126 一个 44 字节文件、未跟踪的冒烟文件），没有 commitExpectation commit，也没有多仓库 Demand；验证者更正：窗口 decommission 已由 card-10 覆盖
  - 建议：新增场景：rework 到 accept、rework 刹车（escalate、record-decision、替换）、预算内和超预算的 request-another-attempt、product-defect 修复加重测、blocked 后恢复、rejected-before-send 后 rearm、一个 bug Demand 和一个 research Demand。下次现场发布一个第一次实现故意让某个真实环境步骤失败的需求，并跑一个 commitExpectation: commit 的多仓库 Demand。
- **D5** [高 / 风险] Claude 投递路径依赖一段约 1,240 行、没有类型的 JS 字符串（tmux helper），它游离在静态 gate 之外，还复制了四份文件契约；测试用手写 JSON 和桩（计划阶段 1；状态：开放）
  - 说明：落地是由 helper 去匹配另一个进程写的 hook 记录来判定的。kernel 只要改了文件名、字段、摘要规范化或布局，helper 测试照样全绿，因为测试自己造的是旧形状，而真实投递会永远停在 pending 或 unavailable。改动最频繁的运行时代码，恰恰是静态检查最少的。
  - 证据：claude-code-tmux-asset.ts:79-1316 是 String.raw 形式的脚本，typecheck、Biome、knip 看到的只是一个字符串；hosts/ 本来也免于复杂度和格式检查；它是 2026-09-20 以来改动第二频繁的源文件（39 次提交中 8 次）；硬编码了布局（:95-98）、WakeflowConfig kind/version（:283）、'-user-prompt-submit-' 文件名（:1107）、sessionId/promptDigest 字段（:1112），sha256(prompt.trim())（:1122）复制了 kernel/prompt-digest.ts，但没有其长度和空值规则；window-bindings 路径定义了 4 次：window-runtime-paths.ts:24、hook-observer.ts:143、tmux-asset.ts:97、statusline-asset.ts:47；hook observer（827 行）用原生 node:fs 自己实现了工作区发现（:505-660）；claude-code-tmux-asset.test.ts:54-111 为 tmux/claude/git/ps 打桩，:269-303、:742-753 手写 locator、binding、hook JSON；没有测试把 helper 的 deliver 输出按 record-delivery-outcome request schema 校验；hook 观察记录和 locator 记录没有可移植 schema
  - 建议：把 helper 源码迁成真正的 .ts/.mjs 模块，参与类型检查和 lint，构建时再打包进产物；布局常量、文件名模式和摘要规则在构建时从 kernel/layout.ts 和 kernel/prompt-digest.ts 渲染出来。为 hook 观察和 locator 记录补可移植 schema。测试夹具改用 writeHostHookObservation 和 binding/locator store 生成。加一个契约测试，按 request schema 校验 helper 的 deliver/launch JSON。
- **D6** [低 / 缺口] artifact smoke 只覆盖五个维护/观察动作，Demand 链从未在构建后的产物上运行（计划阶段 1；状态：开放）
  - 说明：剩下的风险是 src 与构建后 lib/ 在运行时路径上的差异：投递和 hook 用到的 import.meta.url 产物身份、经产物启动器触发的 UserPromptSubmit、物化出来的 helper。
  - 证据：smoke-plugin-artifacts.ts:25-37、:365-520：工具列表、fresh-initialize、reconcile、status/verify、pod create 预览、一次 SessionStart hook；场景测试直接调用 src，不经过产物的 mcp/server.mjs；验证者更正：src 没有动态 import，工具列表已经会加载整个静态模块闭包；dependency-closure 测试另有校验
  - 建议：增加一个模式：通过 stdio 对每个构建产物的 MCP server 和 hook 启动器跑投递到完成的一个子集；在 smoke 里用假 tmux 运行 helper 的 preflight 和 panes。
- **D7** [低 / 未验证] 与时间相关的行为只用注入时钟验证：回调静默后的 rearm 从未在现场触发（计划阶段 1；状态：开放）
  - 说明：对永远到不了的回调，基于静默的 rearm 是唯一的恢复手段，但它在现实中从未触发过；一个月、8 个窗口使用量下 helper 线性扫描的延迟也是推算出来的。
  - 证据：scenario-acceptance.md card-06/wake-controller：10 分钟静默后重发、三次上限、重放，只在 result-review/service.test.ts:143 用注入时钟测试；helper 每次轮询都要线性扫描并解析所有 user-prompt-submit 和 session-start 记录（tmux-asset.ts:465-481、:1105-1115）
  - 建议：下一次现场里故意让一次回调静默超过 10 分钟，然后做一次 rearm；配合上面提到的约 1 万条记录的 soak 测试。
- **D8** [低 / 债务] 所谓 20 个端到端场景其实是一条链式脚本，验收文档也没写明它们验证的是哪个宿主（计划阶段 1；状态：开放）
  - 说明：前面一个场景失败会连锁掩盖后面所有场景，单个场景无法独立运行或推理。读者和 CLAUDE.md 所说的“二十个端到端场景”都会让人以为两个宿主都覆盖了。
  - 证据：test.ts:431-2600 里有大量“scenario ordering: X must run first”的抛错；card-09 在 card-10 之后的工作区上运行，card-08 依赖 card-05；scenario-acceptance.md 第 1-10 行只说“经公开 MCP 工具端到端”，没有提到 Codex 组合
  - 建议：在验收文档中写明宿主；在代价不大的地方，用共享 builder 让场景各自准备前置条件。
- **D9** [低 / 债务] 验证 gate 慢、对时序敏感，时长提示也陈旧（计划阶段 1；状态：开放）
  - 说明：5 到 11 分钟、带已知时序敏感用例的 gate 会促使大家只跑聚焦测试，而 continue 缺陷这类跨切面回归正是这样漏过去的。时长文件只是调度提示，不影响正确性。
  - 证据：tooling/testing/test-durations.json 测于 2026-09-18，224 个条目合计 1364 秒；246 个测试文件中有 22 个没有条目；§13.121 残留：机器负载高时连续三次超时，endpoint register/decommission 单个就要 31 秒；最慢的文件：场景验收 189 秒、result-review service 150 秒、maintenance transaction 126 秒
  - 建议：刷新时长文件，拆分或加速最慢的几个文件，把 endpoint 和 lock 测试里的墙钟等待改成注入时钟或显式的更长超时，并标注哪些测试对负载敏感。
- **D10** [低 / 风险] 测试会继承开发者的全局和系统 git 配置（计划阶段 1；状态：开放）
  - 说明：在全局开启 commit.gpgsign 或 core.hooksPath 的机器上，临时仓库的提交会失败或弹出提示，pod 和场景测试会因与 Wakeflow 无关的原因失败，也会挡住以后接入 CI。
  - 证据：9 个测试文件设置了 GIT_AUTHOR_* 和 GIT_COMMITTER_*，但没有设置 GIT_CONFIG_GLOBAL/GIT_CONFIG_NOSYSTEM（例如 pod/service.test.ts:44、scenario test:2561）；只有 check-release-consistency.test.ts:54-55 和 tmux asset 测试做了隔离
  - 建议：集中一个测试用的 git 环境 helper（GIT_CONFIG_GLOBAL=/dev/null、GIT_CONFIG_NOSYSTEM=1、作者和提交者身份），所有需要 spawn git 的测试都用它。

## E. Codex 版本从未在真实会话中运行过

高。产品的一半（codex-wakeflow 制品）只用合成的 hook 文件测试过。窗口注册、落地、回调所依赖的宿主事实全部取自文档，本机甚至没有 codex CLI。落地在没有 hook 记录时接受 Agent 自报的摘要，effort 值未映射，shipped 文本里还混着 Claude 专属的指令，而 README 和 marketplace 都没有任何 experimental 标记。

- **E1** [高 / 未验证] Codex 的全部宿主机制都是基于文档的假设，从未有过真实会话，制品却以 1.0.0 发布且没有任何警告（计划阶段 6；状态：开放）
  - 说明：注册需要 session_id 等于 handle 的 SessionStart 记录，落地需要带原始 prompt 的 UserPromptSubmit 记录。只要 Codex 的 thread id 和 session_id 不一致、插件 hook 没被加载、${PLUGIN_ROOT} 没展开，或者 hook 在更新后仍未被信任，任何 Codex 窗口都无法注册，整个流程卡在第一步，而所有场景测试照样通过。
  - 证据：gate-log §13.130 表第 16 行（L3801）：Codex 宿主全程没有真实会话测试，标为不做；§13.119、§13.122-§13.131 的残留中反复出现；L3379 本机没有 codex CLI；`which codex` 找不到；codex-hook-fragment.ts:3-20 假设 hooks/hooks.json 会被加载、${PLUGIN_ROOT} 会展开、async/timeout 键被接受、/hooks 按定义哈希信任；codex-agent-text-profile.ts:46-63 假设 Controller 知道自己的 thread id（没有给出获取方法）、存在 create_thread 和 set_thread_title、worktree 环境从 detached HEAD 开始；场景中 handle 值与 hook session_id 用的是同一个字符串（test.ts:588-595、2686-2694），thread id 等于 session_id 是构造出来的假设；hostTrustSteps（codex :80-86）没有说明：信任之前启动的线程不会有 session-start 记录；README.md:102 的 `npx codex-marketplace add ...` 从未执行过；§13.115 只用外部 stdio 脚本碰过 Codex MCP server；README.md、plugins/codex-wakeflow/README.md 和 manifest 都没有 experimental 标记；Codex 没有 resume/relocate 路径（§13.125 残留）
  - 建议：在跑通一次真实 Codex 会话（安装、/hooks 信任、init、Controller 自注册、一个产品窗口、一次落地的投递、回调、pod checkout、归档）之前，在 README、Codex README 和 marketplace 描述中把 Codex 标为 experimental/unverified，或者暂不发布。把真实 hook payload 录成夹具供测试回放；在 scenario-acceptance.md §3 增加 Codex 现场清单，逐条列出基于文档的假设。Codex 文本需要说明如何取得自己的 handle，以及“信任之后要新开线程”。
- **E2** [中 / 风险] Codex 在没有 hook 记录时接受 Agent 自报的 host-send-return 摘要作为落地证明，而 shipped 文本从未说明这个摘要怎么生成（计划阶段 6；状态：开放）
  - 说明：两种情况必有其一：要么 Controller 从不提供摘要，这条路径是死的，一切都依赖已信任的 hook；要么 Controller 随手哈希一个字符串，Wakeflow 就记下一条看起来像机器证据、实际是 Agent 自述的落地。这削弱了 CLAUDE.md 里“落地由宿主证据证明”的说法，而且在真实环境中从未验证。
  - 证据：capabilities/delivery/decide.ts:148-154：sendReturnProvesLanding 为真、attempt.status 为 sent、evidenceDigest 非空即 accepted，不与任何东西比对；:165-169 所有 host-thread 启动都会设这个标志；decide.ts:141 会优先采用匹配的 hook 记录，host-send-return 只是兜底；在 assets/agent-text 里 grep evidenceDigest 没有结果；Codex 的 DELIVERY_ACTION（:55-57）只写“保留 send 调用返回的内容”；delivery-outcome.schema.json 等处会记录 evidenceKind，但 status 和 review inspection 不显示落地依据；卡片 06（2026-09-04）接受了这个设计；delivery/service.test.ts:262 只按构造证明了它
  - 建议：在 Codex 占位符文本里明确摘要覆盖的内容（例如 send 返回值的规范 JSON 的 sha256）和计算方法，或者在真实 Codex 运行确认 send 的返回形态之前禁用这条路径。status 和 review inspection 显示落地依据（hook-record 还是 host-send-return），并在 status 和文档里把后者标为“Agent 自证”。
- **E3** [中 / 缺陷] 共享的 reasoningEffort 值 'max' 原样传给 Codex，Codex worktree 在 Test prompt 中生成 ../ 相对路径（计划阶段 6；状态：开放）
  - 说明：跨宿主共享的配置，或者照 schema 示例写 'controller': 'max' 的用户，会生成一个 Codex 不认识的 effort 值的启动意图。
  - 证据：wakeflow-config.schema.json $defs/reasoningEffort 枚举为 [medium, high, xhigh, max]，描述说“由宿主适配器映射”；endpoint/service.ts:818-820 不做映射，原样传给 Codex；'max' 是 Claude 的取值；service.ts:701-715 attachedWorktreeViews 对工作区根用 path.relative，根外的 Codex worktree 会得到 ../../.. 路径
  - 建议：在 host resource profile 里加每个宿主的 effort 映射，配置校验时拒绝宿主不支持的值；worktree 路径改用绝对路径或宿主中立的引用。
- **E4** [低 / 缺口] Codex 制品里混入 Claude 专属的操作文本，缺少对应的 Codex 指引，而且没有 gate 拦截（计划阶段 6；状态：开放）
  - 说明：Codex 的 Controller 读到的是它根本没有的 helper 和 pane 的流程，自己宿主上同类故障（回合被切断、server 过期）却没有任何指引。README 里对 Codex 用户说“attach tmux”则是真实的泄漏。
  - 证据：assets/agent-text/README.md:29“attach to tmux”原样进入 plugins/codex-wakeflow/README.md:29 和 README.zh-CN.md:24（“接管 tmux”）；codex delivery-and-review.md:90-124（helper deliver、nudge、API Error）和 workspace-and-windows.md:89、145-147、166-167 都带“On Claude Code”的限定，会造成困惑但不会误导；Codex profile（:46-72）没有“被切断回合的恢复”和“刷新自己的 server”这两项的 Codex 取值；hook-observer.ts:257-258 的 `if (hostId !== "claude-code")` 是临时的宿主判断，wrapper 表放在入口而不在 Claude profile 里；tests/artifacts/agent-text-honesty.test.ts 只检查工具、skill 和命令名
  - 建议：把 README 的用户动作短语和每段“On Claude Code…”都移进占位符（如 cutTurnRecovery、selfServerRefresh），并给出 Codex 的取值或“不适用”。把 CLAUDE_CODE_PROMPT_WRAPPERS 作为数据移进 Claude host profile。加一个制品测试：Codex 制品中出现 tmux、pane、helper、tmux.mjs、/login 等 Claude 专属词汇时，如果不在明确的“On Claude Code”句子里就失败。

## F. 安全与信任边界：多窗口共享同一权限，却没有写下来的威胁模型

高。产品窗口会处理不受信任的仓库内容，却能自动写入整个工作区根，包括 Controller 免提示执行的 helper。调用者身份不做校验，Controller 专属动作只靠 skill 文本约束。回调文本以用户轮次的身份进入 Controller。hook 记录这种“宿主证明”可以被伪造。凭证扫描漏掉了常见格式，而它是 git 跟踪的 ledger 前唯一的一道网。以上所有取舍都没有 ADR 可以对照。

- **F1** [高 / 风险] 产品和 Test 窗口对整个工作区根拥有自动接受的编辑权，可以改写 Controller 免提示运行的 tmux helper（计划阶段 5；状态：开放）
  - 说明：产品 Agent（包括被仓库内容注入的 Agent）可以在用户不知情时改写 tmux.mjs。Controller 下一次 deliver、launch 或 inspect 时，改写后的代码就在 Controller 自动允许的 Bash 规则下运行。同样的权限还能改 hook 记录、binding、配置和活动 Demand 文件。文件层写明的威胁模型与“处理不受信任内容的 Agent 共享同一权限”的设计不相符。
  - 证据：endpoint/service.ts:748-757：所有 placement 不为 '.' 的窗口都带 `--add-dir <工作区根>`；:790-805 加上 permissionMode acceptEdits；工作区根里有 .wakeflow-local（hook 记录、binding、helper）、.wakeflow-active（Demand 流、证据）、ledger/、wakeflow.config.json；现场 helper tmux.mjs 是用户自有的 0600 普通文件，根目录 settings.json 自动允许 `Bash(node .wakeflow-local/.../tmux.mjs *)`；只有 verify 的 host-settings-assets gate（observation/decide.ts:643-669）会检查 helper 是否被篡改，每次运行前不检查；rooted-directory.ts 头注释的威胁模型是“受信任的单用户工作区”，不防同权限的恶意进程
  - 建议：只给产品和 Test 窗口需要的访问：--add-dir 限定到 Test surface 或具体的 ledger/证据路径，或者设为只读。helper 每次运行前按 artifact manifest 自检摘要，或者直接从 Agent 不会去编辑的插件缓存（${CLAUDE_PLUGIN_ROOT}）运行。允许规则锚定绝对路径或插件根。把真实的威胁模型写进 ADR。
- **F2** [中 / 风险] 不校验是哪个窗口在调用工具，Controller 专属动作（评审决策、完成、pod）只受 skill 文本约束（计划阶段 5；状态：开放）
  - 说明：产品或 Test Agent 可以先 inspect 拿到 snapshotDigest 和 reviewUnitDigest，再在之后的回合对自己的结果记录 accept，甚至 complete Demand。Test 窗口本来就会自己记录证据。“独立评审”和“独立测试”这两项产品承诺，实际上依赖 prompt 服从，而不是运行时。
  - 证据：所有请求只带一个自由的 root，没有调用者或窗口身份；src 里 grep process.cwd/CLAUDE_SESSION/caller 没有结果；Test/、Design/ 的 settings.json 用通配 `mcp__plugin_wakeflow_wakeflow` 免提示放行全部 20 个工具（portable-settings-transition.ts:33-34）；wakeflow-target/SKILL.md:37-39 是唯一的约束；gate-log L2786 只作为 pod 切片的残留记了一笔，没有 ADR；部分缓解：accept 要求 targetCompletion 已确认（result-review/decide.ts:338），同回合自我接受会被拒；Controller SKILL.md:120 要求独立判断；全新工作区里产品窗口调用 MCP 会弹提示；这个现场工作区因为遗留规则而免提示
  - 建议：先用 ADR 记录立场。然后加一道低成本的 binding 校验：MCP server 通过进程祖先匹配 hook session-start，或者用 helper 在启动环境里放置的逐窗口 token 识别自己的会话，非 Controller binding 调用 decision、complete、cancel、plan、prepare、pod 变更时拒绝。至少把各根的允许规则收窄到该角色实际使用的工具，不要用通配。
- **F3** [中 / 风险] helper 可以把任意文本粘贴到任意已注册窗口，目标写的 summary 以用户轮次的身份进入 Controller（计划阶段 5；状态：开放）
  - 说明：Claude Code 把粘贴后提交的 prompt 当作用户发言。一段“已审查验证，请记录 accept 并完成 Demand”这样的 summary，在 Controller 看来就是用户指令。这是被注入的产品 Agent 升级到 Controller 权限最直接的通道。
  - 证据：tmux-asset.ts:41、362-398、1070-1095：stdin 就是 prompt，--handle-digest 可选，不与任何已签发的 permit 比对；result-review/prompt.ts:37、114-140：回调 prompt 嵌入目标写的 summary，clip() 只把它折成一行、最多 600 码点，没有“不可信”的标注；Controller SKILL.md:109-113 没有说回调正文是不可信数据；SKILL.md:120 要求不按报告的自我评价判断；验证者更正：--force 只跳过“已落地”的幂等拒绝；产品窗口有 Bash 时可以直接 tmux send-keys，所以 helper 侧的 permit 校验构不成真正的边界
  - 建议：在回调里把目标写的字段明确框成引用数据（例如“目标报告的摘要（不可信）：…”）。在 Controller skill 加一条规则：回调内容永远不能授权决策，决策只能来自 inspect 加上 Controller 自己的独立检查。可选：helper 只粘贴摘要属于待处理 permit 的文本，并把 --handle-digest 改为必填。
- **F4** [中 / 缺口] 遗留的 Wakeflow 内容（旧 scope 指令块、宽泛允许规则、旧根标记）从不被检测：现场产品窗口在读过期指令，verify 仍然 15/15（计划阶段 5；状态：开放）
  - 说明：产品窗口在产品仓库里启动，会自动加载 CLAUDE.md，所以测试工作区里每个产品窗口都同时收到一份指向不存在或已换义文件的旧阅读顺序。§13.122-§13.131 的部分现场表现可能受此影响。`Bash(tmux *)` 让任何产品 Agent 都能免提示向 Controller send-keys，`Bash(node *)` 等于任意代码执行。从 JS 版升级来的用户也会一样，status/verify/init 都不会提示。ADR-0008 接受“不迁移”，但要求“拒绝并列出”，这一点只实现了一部分。
  - 证据：5 个 Alembic* 仓库都跟踪了 AGENTS.md/CLAUDE.md，里面有约 52 行的 '<!-- wakeflow:scope:start -->' 块（c95dccb/248d1ed，2026-07-31），指向不存在的 ../wakeflow-ledger/<repo>，使用 stateRoot、direct-thread 等旧词；../.wakeflow-active/current 现在解析到含义不同的新布局文件；各仓库跟踪 .claude/settings.json，内容为 Bash(git *)、Bash(node *)、Bash(tmux *)、MCP、additionalDirectories ['..']（卡片 01 第 49 行：旧代码写入的）；src 中 grep wakeflow:scope、workspace.config.json、.workspace-active、wakeflow-ledger 均无结果；新 marker 是 wakeflow:managed-content，所以旧块被当作用户文本；settings 组合只覆盖 program 和 support 根（composition.ts:368-415），legacy-broad-permission-present（transition.ts:70,279-283）永远不会对产品仓库触发；ADR-0008:17 和卡片 01:41 要求 fresh-initialize 拒绝并列出旧标记，fresh 阻塞项（preview.ts:409、1143-1221）只检查当前这一套标记；gate-log §13.130 L3830：verify 15/15
  - 建议：在 status/verify 中加只读的 legacy-residue 观察（不写入产品仓库）：配置仓库指令文件里的 wakeflow:scope 等旧 marker、各仓库 .claude/settings*.json 里的宽规则和通配 MCP 规则、ADR-0008 列出的旧根标记，都作为用户所有的发现报告，并给出要删的确切行。补全 fresh-initialize 的拒绝清单。在清理或登记这些残留之前，测试工作区的产品窗口现场证据要打折看待，完成清理后在 acceptEdits 下重跑一次。
- **F5** [中 / 风险] hook 观察记录（落地、完成、会话身份的证明）没有任何认证，同用户进程都可以伪造（计划阶段 5；状态：开放）
  - 说明：遇到 landing-evidence-missing 时想“修一下”的 Agent，或者被注入的产品 Agent，可以写一条 user-prompt-submit 伪造落地，写一条 stop 越过 target-completion-pending（从而打开同回合自我接受的路径），或者写一条 session-start 支撑任意绑定。文档把它描述成宿主证明，实际完整性只取决于大家共享的文件权限。
  - 证据：hook-observations.ts:41-47、155-156：普通 JSON，0700/0600，没有 MAC、签名或链；delivery/decide.ts:136-141：绑定会话下任何 promptDigest 匹配的记录都会被接受；result-review/decide.ts:338：accept 需要 Stop 记录；writeHostHookObservation 从 shipped lib 导出；记录目录位于产品窗口以 acceptEdits 可编辑的 --add-dir 根里；CLAUDE.md 写道：落地由目标会话的 hook 观察记录证明
  - 建议：如实写明证明强度：宿主观察所得，不防篡改。低成本加固：hook observer 把每条记录的摘要追加到每个工作区一条的哈希链（或用存放在 Agent 不可写位置的密钥做 HMAC），读取方拒绝不在链上的记录；最低限度让 verify 标出比链更新或时间顺序不一致的记录。
- **F6** [中 / 缺陷] 凭证扫描漏掉常见的密钥格式，而它是证据归档进 git 跟踪的 ledger 之前唯一的隐私网（计划阶段 5；状态：开放）
  - 说明：测试输出和 .env 风格的日志通常以大写下划线的环境变量赋值、ghs_ 安装 token、bearer JWT 或连接 URL 的形式打印密钥，这些都扫不出来。它们一旦被记录为证据，Demand 完成时会原样拷进 git 跟踪的归档，一次普通的 commit/push 就公开了。卡片 08 Q1 依赖“凭证发现一律阻断”，但凭证的定义比证据里实际出现的格式窄得多。
  - 证据：kernel/privacy-scan.ts:50-53：provider 前缀只有 sk-、ghp_、gho_、github_pat_、xox[abp]-、AKIA、AIza；赋值规则要求关键字前有 `\b`，下划线之后匹配失败；用同样的正则在 python3 中复现，以下都没有命中：DATABASE_PASSWORD=…、GITHUB_TOKEN=ghs_…、aws_secret_access_key = …、Authorization: Bearer eyJ…、glpat-…、npm_…、postgres://admin:pass@db；demand/decide.ts:96-115：归档 payload gate 只拦截凭证类；archive.ts:202-219 只扫描 UTF-8 文件；现场归档里含 managed-evidence 的 payload 字节；测试工作区的 .gitignore 没有忽略 ledger/
  - 建议：放宽规则：关键字前允许 `(?:^|[^A-Za-z0-9])` 或 `[A-Z0-9_]*_` 前缀；加入 ghs_/ghu_/ghr_、glpat-、npm_、xoxe-、JWT、`Bearer <token>`、`scheme://user:pass@`。每种都加回归用例，并给归档 gate 加夹具测试。
- **F7** [中 / 缺口] 没有任何地方写下威胁模型，安全取舍散落在代码注释里各自决定（计划阶段 5；状态：开放）
  - 说明：不写明攻击者（诚实但会出错的 Agent、被注入的产品 Agent、其他本地用户）和受保护资产（事件流、落地证明、Controller 权限、跟踪的 ledger），审查者就无法判断本主题里的各项究竟是 bug 还是已接受的风险。逐文件审查也发现不了，因为每个文件相对于自己的局部假设都是对的。
  - 证据：在 docs/decisions 中 grep 威胁、threat、恶意、single-user、单用户、注入都没有结果；ADR-0001..0013 没有安全决策；隐含的模型互相冲突：rooted-directory.ts 是“受信任单用户工作区”，hook-observations.ts:41-47 称记录为“私有权威”，调用者身份交给 skill 文本（gate-log L2786），而产品 Agent 又在处理不受信任的内容
  - 建议：新增一份威胁模型 ADR：列出参与者、哪个窗口可以引起哪些状态转移、哪些证明防篡改、哪些只是宿主观察、什么永远不能进入跟踪的 ledger；然后把现有控制逐一对应上去，并列出已接受的残余风险。
- **F8** [低 / 风险] 带 ANSI 转义的证据被判为 opaque，整个跳过扫描（包括捕获阶段的凭证扫描）（计划阶段 5；状态：开放）
  - 说明：只要证据带颜色输出，捕获阶段的审查就整个被跳过，工作区以外的路径或会话 UUID 就可能进入归档。这是潜在的泄漏路径，现场归档目前是干净的。
  - 证据：managed-evidence-capture-planning-service.ts:199 NON_TEXT_CONTROL_PATTERN 包含 ESC；:360-363 判为 opaque，不产生任何 finding；opaque 和非凭证类 finding 只在 reject 模式下阻断（:412-433）；contentReview 的 controller-confirmed 由调用方自己选；验证者更正：工作区/ledger/仓库内的绝对路径进入归档是卡片 08 Q1 的既定决定；Claude Code 的 Bash 是非 TTY，多数测试运行器不会输出颜色；agent 文本里没有提到 controller-confirmed；归档 gate 会对 UTF-8 文本再扫一遍凭证
  - 建议：分类和扫描之前先剥掉 ANSI CSI/OSC 序列，只有真正的二进制才判为 opaque；有了调用者身份之后，controller-confirmed 要记录确认者，并拒绝非 Controller 的调用。
- **F9** [低 / 债务] 报告隐私扫描会误拒普通的 URL 路由和产品 UUID，却放过 file://、`key:/path` 和 Windows 路径（计划阶段 5；状态：开放）
  - 说明：Web 产品的报告经常引用 API 路由和实体 id，导入因此被拒，Agent 就学会转述证据，评审质量随之下降；而真正像泄漏的路径形式反而漏掉了。
  - 证据：result-review/service.ts:244-247 REPORT_PRIVACY_POLICY 没有允许的根，result-review/decide.ts:161-170 不做 SYSTEM_PATH 过滤（requirement/decide.ts:79-99 有）；用同样的正则复现：'/api/orders' 被标记，而 'file://<本机路径>'、'cwd:<本机路径>'、'$HOME/…'、'C:\\Users\\…' 不被标记；bare-uuid（privacy-scan.ts:56-57）拒绝所有不带 Wakeflow 前缀的 UUID
  - 建议：报告也使用 requirement 那套 SYSTEM_PATH 过滤，或者把配置的根加入允许列表；让 lookbehind 把 file:// 和 ':' 前缀视为路径起点，并加上盘符模式；把 bare-uuid 换成对已知私有标识（绑定的会话 id、hook 记录 id）的精确值检查。
- **F10** [中 / 缺陷] 测试窗口登记的证据，manifest 的 `recordedBy` 写成了 Controller 窗口（计划阶段 5；状态：已解释（§13.134）：recordedBy 按设计是登记权威（配置的 Controller 窗口与配置摘要），MCP 服务没有调用方身份；manifest Schema、record_evidence 工具说明与 Controller / Test 技能都写明了，由报告说明哪个窗口采集了什么）
  - 说明：测试窗口自己调用 record_evidence 登记了四条 test-output 证据，归档后的 manifest 里 recordedBy 是 Controller 窗口。证据归属不跟随实际登记的窗口，审阅时无从分辨谁采集了什么。
  - 证据：§13.133 现场，测试窗口与 Controller 各自发现。
  - 建议：按调用方窗口（或其 work claim / 绑定）写 recordedBy，并加回归；若归属是有意按 Demand 的 Controller 计，就在技能与 Schema 描述里写明。

## G. 可诊断性：失败发生后，用户、Controller 和维护者都拿不到原因

高。cause 链在 206 处被挂上然后丢弃，unexpected 信封里没有任何标识，errno 从不暴露。helper 丢弃 tmux 和 git 的 stderr。“无法检查”被报告成“不存在”，hook observer 失败时看不见。skill 对不透明失败也没有规则。错误体系新旧两套并存，由什么变成 unexpected 取决于结构上的偶然。

- **G1** [高 / 缺口] 没有任何诊断落点：206 处挂上的 cause 从来没人读，unexpected 信封里没有 id（计划阶段 4；状态：开放）
  - 说明：所有非 Wakeflow 错误到了 Controller 那里都是同样的两个 token，磁盘、stderr 和结果里都没留下消息、栈、errno 或 cause 链。两次原因不同的失败无法区分，同一调用的两次失败也无法关联。隐私边界靠的是彻底放弃诊断，而不是脱敏。用户想报 bug 只能交出整个包含私有产品数据的工作区，这恰恰是隐私设计要避免的。
  - 证据：kernel/error.ts:13 注释说原始异常只保存在 cause 上供本地诊断；`rg '\.cause\b' src` 只命中 error.ts:105 的构造函数；`rg '\{ cause' src` 有 206 处；wakeflow-public-mcp-tool.ts:95-98、116-133：固定 {wakeflow-unexpected, unexpected}，没有关联 id、时间戳或产物摘要；wakeflow-mcp-stdio.ts:12-22 的 onerror 忽略参数；src 里写 stderr 的只有 stdio 固定行和 hook-observer.ts:758；gate-log §13.131 L3854：blocker details 的 TypeError 和缺少末尾换行的 locator 都是补测试时顺带挖出来的；§13.125 L3625 需要 WAKEFLOW_DEBUG_EXIT=1 的调试窗口
  - 建议：在边界（failedToolResult 和 hook-observer main）写入有界的私有 incident 记录 `.wakeflow-local/runtime/incidents/<incidentId>.json`（0600，只保留最近约 50 条），内容包括 UTC 时间、工具、产物摘要、错误名/code/reason/path 链、Node errno、相对于产物根的栈帧、只含键的请求形状摘要；消息只在通过现有脱敏边界后才写入。信封里回显 details.incidentId，stderr 输出一行 `wakeflow: incident <id>`。把这个目录登记到 private-mode 普查和 local-layout 的预期条目里。
- **G2** [中 / 债务] 何时变成 unexpected 取决于结构上的偶然：新旧两套错误体系并存，182 个未收敛的旧 code 外泄，errno 和错误构造违规都坍缩成 unexpected（计划阶段 4；状态：开放）
  - 说明：可诊断的 code 和 unexpected 之间的界线，与调用方能否采取行动无关。每当底层出现新的失败模式，都要手工穿过“模块类 → 领域类 → capability 表 → WakeflowError”这一串映射，漏掉一环，aborted、busy、recovery-required 这类可恢复状态就会降级成 unexpected，Agent 也就失去恢复提示。这类转换代码也是 capability service 膨胀到两千行的主要原因之一。
  - 证据：ADR-0013 D：唯一的 WakeflowError 加封闭 code 表，“301 个错误类删除”；src 里仍有 188-192 个 `extends Error` 类、182 个不同的旧 readonly code；wakeflow-public-mcp-tool.ts:80-93 legacyErrorDetails 投影任何带 code 和 reason 的对象，注释说 L1 后退役；gate-log L2416 计划在 L1 末尾一次完成，但没有做；typed instanceof 转换 1,918 处，`reason === "aborted"` 333 处分布在 109 个文件；双重转换的例子：managed-evidence-capture-planning-service.ts:166/225-289 → capabilities/evidence/service.ts:129-240；Node errno 没有自己的 reason，于是变成 unexpected；kernel/error.ts:66-81 的 assertReason/assertPath 会在失败路径上抛 TypeError（§13.131 blocker 机制），336 个 fail() 用模板拼 reason/path；带 home 路径的已知错误会退回固定的 unexpected（error-envelope.test.ts:217-235）；公开信封没有 JSON Schema；约 185-192 个局部 fail* helper 不接受 cause，重新映射时就断了链
  - 建议：在边界完成 ADR-0013 D：旧错误映射到封闭 code（文件系统和 git 类映射为 io-failure，损坏的私有记录映射为 invalid-request，等等），旧 code 和 reason 放进 causeCode/causeReason；给信封加 JSON Schema 并测试。让 WakeflowError 在失败路径上的构造不抛异常（清洗，或者退回 reason malformed-error 并保留原始 cause）。底层从 foundation/filesystem 和 abort 路径开始直接抛 WakeflowError。局部 fail helper 加可选的 cause 参数。加一个测试：把每个导出的错误 reason 送进 capability 映射，出现 unexpected 就失败。
- **G3** [中 / 缺口] errno 从不暴露，尽管信封已经有 causeCode 字段，foundation 也已经有安全的 errno 读取器（计划阶段 4；状态：开放）
  - 说明：EACCES、ENOSPC 这样的 errno 是符合 details 值格式的短 token，不含路径也不含用户文本，暴露出来没有隐私代价。有了它，io-failure/demand-root-remove 就能变成用户可处理的信息：权限问题、磁盘满，或者文件被编辑器占用。
  - 证据：wakeflow-public-mcp-tool.ts:41-42 声明了 causeCode/causeReason，但 WakeflowError.toPublicDetails（error.ts:116-124）从不填写；demand/archive.ts:659-663：rm 失败变成 io-failure/demand-root-remove，EACCES、EBUSY、ENOTEMPTY 看起来完全一样；pod-worktree-receipts.ts:791-795 也是这样；`"operation-failure"` 有 137 处，例如 loaded-artifact-tree-transfer-publication.ts:290 不带 cause；node-system-error.ts:44 readNodeSystemErrorCode 已有约 20 个文件在用
  - 建议：在 toPublicDetails 或 failedToolResult 里沿 cause 链找到第一个 Node 系统错误，把它的 code 投影到 causeCode，第一个旧 code/reason 投影到 causeReason；给 137 处 operation-failure 映射补上 cause。在 Controller skill 加一句：`causeCode: E*` 指的是要告诉用户的操作系统错误。
- **G4** [中 / 缺口] Controller skill 没有处理不透明失败的规则，唯一的规则是“修好原因再调用”；retryable 也没教（计划阶段 4；状态：开放）
  - 说明：遇到 unexpected、io-failure 或旧的 wakeflow-<foundation> code 时，根本没有“原因”可修，唯一的指令会驱使 Agent 重试或瞎改文件。retryable 是判断能否安全重试的唯一机器信号，却从来没教给 Agent。
  - 证据：wakeflow-controller/SKILL.md:43-45“读返回内容、修原因、再调用”；:185-187 的停止条件不包括工具错误；`rg -i 'unexpected|io-failure|retryable|WakeflowMcpError' assets/agent-text` 没有结果；`retryable: true` 有 20 处；验证者更正：§13.131 之后 unexpected 已经少见；“宿主效果不可用”算一个部分出口；/mcp 重连只教给了 server 过期的场景
  - 建议：在 Controller skill 加一条短规则（Target/Test/Design 各加一行）：code 为 unexpected、io-failure 或不在封闭表内的信封不是拒绝；只有 retryable 为 true 或调用是幂等读取时才重试，而且最多一次；然后跑 status 和 verify，停下来，把工具名、code/reason 和 incidentId 告诉用户，不做任何编辑。再加一个“Wakeflow 工具 server 不可用或断开”的停止条件。
- **G5** [中 / 缺口] 133 个业务拒绝 reason 里有 128 个没出现在任何 agent 文本或工具描述中（计划阶段 4；状态：开放）
  - 说明：通用规则对显而易见的情况有效，但对某些情况会给出错误的本能反应。最危险的是中断后的 idempotency-mismatch：Agent 凭记忆重建请求时改了某个字段，得到 request-digest，于是“修复”成一个新 key，重放就可能变成第二次写入。stale snapshot 需要重新 inspect，而不是重试；claim 类拒绝不能去释放一个还活着的 claim。
  - 证据：对 src 只读扫描 precondition-failed/concurrency-conflict/idempotency-mismatch/not-found/capacity-exceeded 的 reason，共 133 个，128 个在 SKILL、reference、README、profile 里都不出现；request-digest、review-unit-stale、snapshot-stale、stream-advanced、fence-mismatch、window-claimed、claim-held、pod-busy、hook-evidence-missing、authority-reference-unknown 全部 0 命中；§13.128 pod Controller 就栽在最后一个上；验证者更正：信封不止 code/reason，还有 path、retryable、details、causeCode/causeReason、授权字段；“新 key 导致二次写入”是推断
  - 建议：在 Controller SKILL 或投递参考里加一张“你会遇到的拒绝”表，target/test 各加 3 到 4 行，按处理方式分组：重新 inspect 再重试（concurrency 类）、原样重放而不是换新 key（idempotency-mismatch）、等待或查看 status（claim-held、window-claimed、pod-busy）、上报用户（完整性故障）。对 concurrency 和 idempotency 类在信封里给机器可读的 remedy 提示。加一个静态测试：每个 Agent 可处理的 reason 要么有文档，要么被标为 internal。
- **G6** [中 / 缺口] tmux helper 捕获了 tmux 和 git 的 stderr 却丢掉；HelperFailure 以外的失败以 exit 2 加裸的 unexpected 退出（计划阶段 4；状态：开放）
  - 说明：对不懂 tmux 的用户来说，helper 是 Controller 执行所有宿主步骤的方式。tmux 或 git 失败时，唯一能说明原因的那一行（嵌套会话、没有 server、分支已被检出）被丢掉了，Controller 拿到的是一个没教过的 token，无法告诉用户该做什么。
  - 证据：claude-code-tmux-asset.ts:308-318 run() 返回 stderr，但全文件只在 :317 出现一次；refuse('worktree-add-failed', {branch, status})（:566）丢掉了 git 的原因；tmux-create-failed（:795）、worktree-list-failed（:544）、capture-failed（:1187）也一样；主 catch（:1306-1312）输出 reason 'unexpected' 并 exit 2；:883-885 把任何错误重新包装成 HelperFailure('unexpected')；36 个 refuse() reason 中只有 3 个出现在 agent 文本里（许多是自解释的参数错误）；statusline 资产（:80-187）的 catch 一律静默回退
  - 建议：helper 拒绝时附带有界的 detail：stderr 第一行，单行化，最多 200 字符，工作区根和 home 替换为占位符。unexpected 路径附带 error.name 和 errno。在 Claude profile 里教一条通用规则：遇到未知的 helper reason，就把 detail 转告用户然后停下。可选：helper 也写 incident 记录。
- **G7** [中 / 风险] “没能检查”被报告成“不存在”：任何 stat 错误都会让还在的 worktree 显示为 checkout-missing 或 prunable（计划阶段 4；状态：开放）
  - 说明：EACCES/EPERM（例如 macOS TCC 挡住了 Documents 子树）、ELOOP、EIO 都会被当成“checkout 已不在”，pod 关闭照样走到 close-complete 并退役 receipt，而 checkout 还在，最后留下一个孤儿 worktree。Wakeflow 本身不删 checkout，所以不会丢数据。这违背了 README 自己的承诺。触发条件是推断出来的，可能不常见。
  - 证据：kernel/pod-worktree-receipts.ts:800-811 worktreeCheckoutPresent：任何错误都 return false；repository-pointer-observation.ts:292-299 同样处理，结果喂给 :330 的 prunable；pod/service.ts:384-391、:663、:728、:753-755：false 映射为 checkout-missing，receipt 被退役，并放行 close-complete；assets/agent-text/README.md:88-90 承诺“无法检查”永远不会被报告成“没问题”；有 28 处 catch 后返回 null 或 false，分布在 9 个文件里（hook observer 占 13 处）
  - 建议：用 readNodeSystemErrorCode，只把 ENOENT/ENOTDIR 视为不存在，其他 errno 变成第三种状态 unknown：阻止 close-complete，并以 unavailable 加 causeCode 显示。其余 27 处 catch-to-null 按同样方式审一遍。
- **G8** [中 / 缺口] hook observer 的失败不可见：总是 exit 0，只写一个 stderr code，verify 只在宿主完全没有记录时才报警（计划阶段 4；状态：开放）
  - 说明：落地只能由 hook 记录证明，observer 写失败会表现为“投递看起来发了，却没有证据”。宿主是否会展示 exit 0 时的 stderr 没有验证过，推测在非 verbose 模式下看不到。Controller 针对静默的恢复流程，恰恰对 Wakeflow 本可以记下来的这个原因是盲的。
  - 证据：wakeflow-hook-observer.ts:742-767：失败映射为 internal，只写 'wakeflow-hook-observer: <code>'，exit 固定为 0；write-failed 不在任何地方持久化；observation/decide.ts:498-518 host-hook-channel gate 报 absent、records-0、unavailable、mode、skipped-N，看不到第一条记录之后的单次写失败；ADR-0009 L9：hook 总是 exit 0，stdout 为空
  - 建议：observer 已经找到工作区但写入失败时，在该工作区 .wakeflow-local/runtime/ 下追加一个很小的失败标记（时间、code、事件类型、哈希后的会话 id），沿用 incident id 方案；status/verify 显示 hook-failures:<n> 和最近一次的时间。宿主是否展示 stderr，在每个宿主上都标为未验证，直到现场确认。
- **G9** [中 / 缺口] 没有故障注入，也没有“绝不出现 unexpected”的全量扫描；§13.131 的两次逃逸都是偶然发现的（计划阶段 4；状态：开放）
  - 说明：1121 个测试证明了正常路径和列举出来的拒绝，但没有回答一个问题：20 个工具遇到私有记录被截断、带 CRLF、缺末尾换行、不可读、是目录或是符号链接时会怎样。§13.131 的两次逃逸正是这类输入造成的，每新增一种记录类型或 foundation 读取器，都可能再引入一个。
  - 证据：`rg -l 'EACCES|chmod\(.*0o000|ENOSPC|EMFILE' tests` 没有结果；已有的 chmod 测的是权限模式漂移；wakeflow-unexpected 只出现在两个测信封形状的测试里；约 16 个测试文件有各自模块的损坏测试（CRLF、截断、缺末尾换行），但没有跨工具的不变量
  - 建议：做一个表驱动的扫描：每个工具配一个夹具工作区 × 每种损坏方式（截断、去掉末尾换行、CRLF、BOM、在平台允许时 chmod 000、文件和目录互换、符号链接）× 每类私有记录，断言信封 code 在封闭表内、不是 unexpected、且没有写入。纳入 npm test。
- **G10** [低 / 风险] MCP 启动器没有进程级守卫，hook 启动器却有：server 崩溃会打印带绝对路径的完整栈，20 个工具静默消失（计划阶段 4；状态：开放）
  - 说明：两个启动器的隐私策略正好相反。import 失败（Node 版本不对、模块缺失）或 server 崩溃时，走的是 Node 默认处理器：栈带绝对路径，server 退出。Controller 只看到工具调用在宿主层面失败，没有任何 skill 文本覆盖这种情况。
  - 证据：plugins/claude-code-wakeflow/mcp/server.mjs 只有 import 和调用，没有 uncaughtException/unhandledRejection 守卫；hooks/observe.mjs:3-24 显式加了守卫；src 里只有 hook-observer.ts:778-779 注册了守卫；src 里没有发现浮动的 promise，这条路径今天是否会触发未经证实
  - 建议：统一策略：MCP 启动器也加守卫，写脱敏后的 incident 记录和一行带 incident id 的 stderr，然后以非零码退出。在 Controller 的停止条件里加上“Wakeflow 工具不可用”，告诉用户用 /mcp 重连或重启。
- **G11** [低 / 债务] 维护者的诊断工具（现场驱动脚本、调试开关）没有纳入版本管理，每次现场排查都从零开始（计划阶段 4；状态：开放）
  - 说明：每次真实环境验证都依赖一次性脚本，脚本本身的 bug 要在现场调试，经验也留不下来。对没验证过的 Codex 宿主，更是没有现成的驱动。
  - 证据：WAKEFLOW_DEBUG_EXIT=1 只出现在 gate-log（§13.125 L3625）；§13.130 L3830 用外部的 live-130.mjs 驱动；git ls-files 里没有 live-*；§13.128 L3734：维护者脚本把 `binding: {status: 'unregistered'}` 当成已绑定，发出了一次在 `$` 处被拒的 decommission；tooling/ 只有 architecture、artifacts、codegen、release、testing
  - 建议：在 tooling/ 下纳入一个只读诊断驱动（`npm run diagnose -- <workspace>`）：通过 stdio 对候选产物调用 status、verify、inspect，打印 incident 记录，路径脱敏。任何会修改状态的模式都放在显式开关后面，并且只用于指定的一次性工作区。
- **G12** [中 / 缺口] `record_evidence` 的 kind 与来源不符时只报 `invalid-request/selection`；`plan_target_task` 的 `selectedAuthorityMemberRefs` 要完整 ledger memberRef 路径，工具说明没写（计划阶段 4；状态：已修（§13.134）：kind 与来源不符拒绝为 `invalid-request` / `kind-source-mismatch` / `$request.selection.kind`，工具说明与 evidence.md 写明允许的组合；plan_target_task 说明写明 `requirements/<requirementId>/landing.md` 这样的完整 memberRef）
  - 说明：Controller 用 `transcript` 登记文件来源的证据被拒，只拿到 `invalid-request` 与 `selection`，不知道是 kind 与来源不匹配；规划时写裸文件名被拒为 `authority-reference-unknown`，说明里没有写要完整路径。两处都是靠试错过去的。
  - 证据：§13.133 现场，Controller 报告。
  - 建议：拒绝原因点名不匹配的字段与允许的组合；工具说明写明 memberRef 的形式并给一个例子。
- **G13** [低 / 缺口] 三处 Controller 靠猜的规则：rework 带 `blockingReasons` 只报 `record-schema` / `$request.decision`；re-arm 后提示词里仍是第 1 代的 generation 与 claimDigest；仓库已有验收过的 target 时只能 continuation、不能 replacement（计划阶段 4；状态：部分（§13.135、§13.136）：delivery-and-review.md 写明 lineage、re-arm 围栏、rework 的 `blockingReasons` 与另一次尝试的检查要求；决定记录的 Schema / 关系拒绝仍只报 `record-schema` / `record-relation` 与 `$request.decision`，不点名字段）
  - 说明：§13.135 现场 Controller 第一次记 rework 被拒后猜是 `blockingReasons` 所致（Schema 的 rework 分支要求 `maxItems: 0`、`requirementAlignment: aligned`）；re-arm 后担心导入会因旧围栏被拒（导入按设计接受同一投递更早一代的围栏）；按文字选 replacement 被拒为 `lineage-continuation-required`。
  - 证据：`controller-implementation-review-decision.schema.json` 的 if/then 分支；`result-review/service.ts` 的 `assertEarlierGenerationFence`；`tasking/decide.ts` 的 `deriveLineageBlockers`。
  - 建议：（文字已补）决定记录的 Schema 拒绝在 path 里点名出错的字段（例如 `$request.decision.blockingReasons`）。

## H. Demand 流程中的死角与产品语义缺口

中。好几条流程要到很晚才走不通，或者走进一个文档承诺了、代码却没有的出口：没有可用验收标准的需求包能发布却永远无法规划；后续工作被拆成两个各缺一半的机制；升级后说好的“补充包出口”不存在；完成时不检查验收标准覆盖；research 没有执行流程；indeterminate 投递的正式出口没有教给 Agent。

- **H1** [中 / 缺陷] 发布的需求包可能根本没有可用的验收标准（bug/supplement 不要求这一节，requirement 的这一节写成段落或表格也照样通过），对应的 Demand 永远无法规划（计划阶段 7；状态：开放）
  - 说明：用户确认了一页摘要，包发布了、被认领了，到规划时才失败。包是不可变的，又已经被认领，唯一的出路是取消 Demand（归档，撤回包）、让 Design 重新发布、再认领，白白走完一整个循环。bug 很可能是现实中最常见的类型。
  - 证据：contracts/vocabulary/requirement-sections.ts:94-102：bug 和 supplement 的必需节里没有 acceptance-criteria；requirement/decide.ts:150-157 只检查节正文非空；tasking/decide.ts:35-45 和 kernel/markdown-sections.ts:106-133 只把顶层列表项当作标准；task-package.schema.json:117-137 要求 implementation 的 acceptanceAnchors minItems 1；tasking/service.ts:338-345、:415 报 anchor-item-unknown；requirement/service.ts:738 的 supersedes 只撤回 pending/parked 包；gate-log §13.131 待裁决：bug/supplement 没有验收标准也能发布，到规划时才走不下去
  - 建议：在发布预览中，只要 acceptance-criteria 节按 parseMarkdownListItems 解析出零项就阻塞；在 ADR-0011 D3 修订中把 acceptance-criteria 加进 bug 和 supplement 的必需节；research 仍然豁免。
- **H2** [中 / 缺口] 后续工作被拆成两个各缺一半的机制：continue_demand 保留了历史但不能带入新的验收标准，supplement Demand 能带新标准却和之前的工作没有任何关联（计划阶段 7；状态：开放）
  - 说明：类型为 requirement-supplement 的 continue 带不进新标准，所以这个类型本身是自相矛盾的；supplement 包又没有和父 Demand 或分支的机器链接，从需求追溯到结果的链条在第一次后续工作时就断了。文档承诺的“带新验收标准、并挂在原工作上的补充”，两条路径都做不到。
  - 证据：wakeflow-demand-continuation-request.schema.json：continuation 只有 {kind: optimization|requirement-supplement|verified-bug, summary}，没有 requirementId；tasking/decide.ts:63-71、:230-238：anchor 必须带本 Demand 自己的包 recordDigest，并使用其中的 itemId；requirement publication packageInput 没有任何指向父 Demand 或父需求的字段；design requirement-package.md:48 把 supplement 描述为“对已完成工作的补充”；卡片 04 Q3 两条路径都保留；验证者更正：verified-bug 和 optimization 类型的 continue 可以合理地锚回原有标准，supplement Demand 自身的追溯是成立的
  - 建议：为后续工作确定唯一的负责机制：要么让 continue_demand 接受一个已发布的 supplement/bug requirementId，anchor 可以绑定到原记录和补充记录的并集；要么在 packageInput 加 `supplements: <demandId|requirementId>`，写进 Demand 身份和 status，并由路由建议基于父分支或父提交继续。选定的那条路径要补一个端到端场景。
- **H3** [中 / 缺陷] 升级（escalate）或阻塞之后，文档承诺的“补充包认领后退出”并不存在，rework 刹车的选项文本也在误导用户（计划阶段 7；状态：开放）
  - 说明：用户选了 Wakeflow 自己推荐的“重述需求”后，Design 发布的补充包在认领时会被 pod-busy 拒绝，awaiting-decision 也不会因为认领而清除。实际能走的路是 record-decision 或取消后重新认领，但 skill 没有写。pod 只是等用户回答（这是设计如此），而“补充包出口”这个承诺是假的。
  - 证据：docs/requirements/capabilities/04-demand-lifecycle.md:139 和 functions 文档 F8.5（:184）：awaiting-decision 可以因补充包被认领而退出；demand-aggregate-state.ts:2735-2743：只有匹配 escalationEventId 的 decision-recorded 才会清除 awaitingDecision；demand/decide.ts:234,279 和 demand-active-guard.ts:153：pod 上有活动 Demand 时 create_demand 报 pod-busy；decider.ts:1606-1610：rework 刹车的选项写着“需要 Design 提供补充需求包”；requirement/service.ts:738：已认领的包不能被 supersede；delivery-and-review.md:186-193 只提 record-decision
  - 建议：二选一：实现卡片 04 描述的出口（以升级中的 Demand 为父的补充包并入该 Demand，清除 awaitingDecision，并把它的标准加入 anchor 集合）；或者把升级选项文本、需求文档和 Controller skill 改成实际的路径（record-decision，或取消后重新认领）。补一个“升级 → 重述需求 → 恢复”的场景。
- **H4** [中 / 缺口] Demand 可以在大部分验收标准从未绑定到任何任务或测试步骤的情况下完成并归档（计划阶段 7；状态：开放）
  - 说明：验收标准是用户确认的“完成定义”。规划只检查 anchor 是否是真实存在的标准，accept 只检查 Controller 选的那些 anchor，完成时从不比较“已接受的 anchor 加通过的测试步骤”与包里全部标准的差集。只锚定 ac-1 的计划也能让一个有 ac-1..10 的 Demand 通过所有 gate 归档，归档里也不会留下缺口记录。
  - 证据：demand-verify-gates.ts 的 gate 集合中没有验收标准覆盖检查；result-review/decide.ts:298-310 只检查任务包自己声明的 anchor（anchor-evidence:uncovered）；验收标准只在 src/capabilities/tasking 里解析；验证者更正：§13.126 的现场中实现任务锚定了 ac-1..10，只是测试合同刻意不覆盖 ac-6..10，所以这个缺口是潜在的，还没实际发生过
  - 建议：从包记录中减去已接受的实现 anchor 和通过的测试步骤，得出未覆盖的标准，在 complete_demand 预览和 status 中显示；由用户决定是作为阻塞项，还是要求 Controller 逐条写明豁免并记入归档。在完成场景里加入这项检查。
- **H5** [中 / 缺口] research Demand 可以发布和认领，但 Controller 没有执行它的流程（计划阶段 7；状态：开放）
  - 说明：没有文字告诉 Agent 谁来做调研、文档写到哪里、要记录为 document 证据后零任务完成。研究也不能委派给产品窗口，因为投递需要带 anchor 的任务。用户提一个调研问题，Controller 会停在 research-evidence-missing，不知道下一步怎么走。
  - 证据：demand-controller-route.ts:596-618：没有任务的 research Demand 路由到 research-completion-required，在有 document 证据前被 research-evidence-missing 阻塞；demand-verify-gates.ts:174-182 需要 kind 为 document 的证据；research 不要求验收标准，所以没法规划任务（anchor minItems 1）；在 Controller skill 和 commands 中 grep research 没有结果；Design 的 requirement-package.md:55-58 却在推荐这个类型；没有 research 场景；§13.126 唯一的一个 research 包是占位，先搁置后撤回；research 也不能 continue（demand/decide.ts:229）
  - 建议：在 Controller skill 加 research 一节（谁来调研、产出放在 support surface 的哪个路径、记录为 document 证据、完成），或者允许不带 anchor 的 research 任务投递给产品或 Design 窗口。补一个从发布到完成的 research 场景。
- **H6** [中 / 缺口] 未落地的 indeterminate 投递，其正式出口 resolution 从未教给 Agent，而且文本前后矛盾（计划阶段 7；状态：开放）
  - 说明：文本把 Controller 引向“等证据”，而在 pane 错了或死了的情况下，证据永远不会来；再次记录只会一直得到 landing-evidence-missing，窗口 claim 也一直被占着。在 Claude 上重发可以作为部分出口，但 binding 错误、窗口死掉以及整个 Codex 情形，都需要那个没教过的 resolution。
  - 证据：capabilities/delivery/decide.ts:111-130、:136-159：当 prompt 从未到达窗口时，唯一的出口是 resolution{disposition: accepted|rejected-before-send, hookRecordId, rationale}；service.ts:1632-1645 超过静默阈值后报 landing-silence-exceeded；在 assets/agent-text 和两个 profile 中 grep resolution、landing-silence-exceeded 都没有结果；SKILL.md:102-105 和 delivery-and-review.md:88 说“indeterminate 从不重发”，而 Claude 的 RESEND_GUARD（profile:80-84）和 helper（tmux-asset.ts:1080-1085）允许在没有落地记录时重发；demand-controller-route.ts:277 把 host-effect-indeterminate 指向 target-result-import（等待目标方）；卡片 06 Q3 的设计有 card-06 ambiguous-resolution 场景覆盖
  - 建议：在 delivery-and-review.md 第 8 步加一段“解决 indeterminate 投递”：出现 landing-silence-exceeded，或 helper 显示 pane 已死或不对时，先用 panes/inspect 确认 prompt 不在目标会话里，然后记录 resolution rejected-before-send 并 re-arm；如果存在匹配的 user-prompt-submit 记录只是漏看了，就用 resolution accepted 加 hookRecordId。同时消除“从不重发”和 resendGuard 之间的矛盾。补一个按文本流程走的场景。
- **H7** [中 / 待决] 每个并行 Demand 都需要一个满配 pod（所有仓库、所有窗口），用完还必须关闭，并行工作代价高（计划阶段 7；状态：开放）
  - 说明：5 个仓库的工作区里，同时跑两个只涉及一个仓库的小 Demand，就要建 8 个窗口和 5 个 worktree，事后还要逐个处置 5 个分支（大多数根本没动过）。会话数翻倍也会让 hook 目录更快触顶。再加上一个 pod 一个 Demand、升级会卡住整个 pod，用户会被推向串行工作。
  - 证据：wakeflow-pod-request.schema.json createIntent 只有 {kind, name, idempotencyKey}，窗口集合由 Wakeflow 推导，每个仓库一个产品窗口加一个 worktree，外加 Controller、Design、Test；demand/decide.ts:234,279：每个 pod 只能有一个 Demand；gate-log §13.128：8 窗口 pod 意味着一台机器上 16 个 Claude 会话，启动和关闭各花十几分钟；§13.130 D9：只要存在 worktree pod，加仓库就在配置解析时被拒（configReason topology）
  - 建议：让用户决定 pod 的范围：createIntent 可以指定仓库，只生成这些仓库的产品窗口和 worktree；考虑让处置完毕的 pod 不拆除就认领下一个 Demand。把结论记入 ADR-0010。
- **H8** [低 / 待决] /wakeflow:next 的“做一步就停”规则让人工往返次数和 status 调用成倍增加（计划阶段 7；状态：开放）
  - 说明：这条规则让用户保有控制权，每一步都读最新状态，这是合理的。代价是每一步都要一次人工 prompt、一次约 9 KB 的 status、在大上下文上跑一到多轮。对纯机械的 Controller 自有序列，它只增加了延迟，没有增加决策点。
  - 证据：assets/agent-text/commands/next.md：第一个工具调用是 wakeflow_status，做完那一步就停；80580357：/wakeflow:next 调用 11 次，status 调用 27 次（约 231-258 KB）；gate-log L3667 的 74 分钟里包含维护者等待的时间；验证者更正：launch/register/mark 本来就在第 1 步里一起完成；只有 prepare（第 7 步）和 send 加 record（第 8 步）之间的分界把一段机械序列拆开了
  - 建议：这需要产品决定：是否允许 /wakeflow:next 连续执行多个 Controller 自有步骤，直到 owner 变化或需要用户决策为止。无论怎么定，都在命令文本里写明其中的取舍。
- **H9** [高 / 缺陷] 测试步骤以 environment 失败、记为 blocked 之后，条件解除也无路重跑：恢复后的审查单元仍只允许 blocked 与 escalate，Demand 原地打转（计划阶段 5；状态：已修并经现场（§13.135、§13.136）：恢复中的审查单元（blocked 之后以 `condition-cleared`，或用户已回答的 escalate 之后以 `decision-recorded`）里，environment 失败步骤可以按同一份冻结合同再来一次，容量、范围与连续 flaky 规则照旧；重跑的测试 prompt 点明只跑哪些步骤；现场第 2 次尝试只跑 ts-5 并通过、Demand 完成归档）
  - 说明：§13.135 现场：测试期间有人在 AlembicDashboard 放了一个文件，ts-5 以 environment 失败；Controller 记 blocked，用户删掉文件后，`request-another-attempt` 仍因 `classification:ts-5:environment` 被拒，唯一可记的是再 blocked 或 escalate。D7 规则只允许 harness-defect、flaky、missing-evidence 重跑。
  - 证据：`result-review/decide.ts` 的 `rerunBlockers`；`test-step-vocabulary.ts` 的 `RERUNNABLE_TEST_FAILURE_CLASSIFICATIONS`；聚合的恢复准入（`condition-cleared` 只接 blocked）本来就允许从 test-review-blocked 记任何决定。
  - 建议：（已做）见状态。
- **H10** [中 / 缺口] requirement-supplement 续接从不写回需求包：归档里的 requirement.md 仍是补充前的定义，补充内容只在续接事件摘要与任务包里（计划阶段 5；状态：开放，§13.135 现场；与 Q7 同一问题域）
  - 说明：§13.135 现场续接"在文件末尾加一行"：实现窗口、Test 与 Controller 都指出 requirement.md 仍写"只有一句话"，以后只看需求文档的人会以为结果与需求不符。
  - 证据：§13.135 现场；`wakeflow_continue_demand` 只追加续接事件，需求包成员不可变。
  - 建议：随 Q7 一并裁决：补充包作为新的需求包成员（或新包 supersedes 原包）进入归档，或者归档的 manifest 把续接摘要列为需求的一部分。

## I. 引导式体验与 Agent 文本：被引导的用户在关键时刻得不到指引

中。init 之后没有任何东西把用户带到 Design 窗口。启动阶段的 tmux 缺失、git init、已在 tmux 会话中这几种情况都没处理好。skill 之间有措辞矛盾，Controller 每次要读的文本偏长，Controller 自己的证据文件也没有指定位置。

- **I1** [中 / 缺口] init 完成后用户不会被引到 Design 窗口：空闲工作区上 status 给不出下一步，也没有文字说明怎么切换 tmux 窗口（计划阶段 7；状态：开放）
  - 说明：setup 刚结束是新用户最需要指引的时候，这时 /wakeflow:next 或 status 却报告“无事可做”。一个默认不懂 tmux 的用户，只能自己琢磨出第 2 步要去另一个 tmux 窗口、是哪一个、怎么切过去。
  - 证据：observation/decide.ts:59-126 只会从产物过期、维护、pod 注册、活动 Demand、待处理包中产生下一步；初始化后空 board 没有任何下一步；status 的 next-action owner 枚举没有 design；commands/next.md:20-21 只说“若下一步属于 Design 窗口，就说明”；唯一的导航提示是信任对话框用的 `Ctrl-b n`（claude-code-agent-text-profile.ts:93）；启动意图是不带角色 prompt 的 `claude`（endpoint/service.ts:792-803）；置顶记忆规则：只有用户能做的事，由 Controller 在需要的那一刻给出确切的命令
  - 建议：没有活动 Demand 也没有待处理包时，产生一个空闲状态的下一步（owner user，reason requirement-authoring，指向 Design 窗口）。Controller skill 说出 Design 窗口的名字和确切按键（在 helper 的 panes/mark 输出里加上窗口索引）。考虑给 Design 窗口一个简短的角色引导作为首条 prompt。
- **I2** [中 / 缺口] 启动阶段的引导缺口：缺 tmux 时不处理、让用户自己执行 git init、在已有 tmux 会话中启动时新窗口开到别的会话去（计划阶段 7；状态：开放）
  - 说明：每一项都把 shell 或 tmux 操作推给了用户，或者让用户卡住，违背了“用户只需要启动 claude 并运行插件命令”这条规则。缺 tmux 要到后面才以 tmux-create-failed 暴露；目录还不是 git 仓库这个阻塞，Controller 经用户确认后一条命令就能解决；熟悉 tmux、在 tmux 里启动的用户会看不到新开的窗口。
  - 证据：claude-code-tmux-asset.ts:704-716 的 preflight 报告了 tmux/claude 是否可用，但 WINDOW_BOOTSTRAP（profile:87-99）只读 insideTmux；shipped 插件 README 的安装节没写需要 tmux，只有仓库根的 README.md:82 写了；commands/init.md:18-19、README:62-64、workspace-and-windows.md:28-30 都让用户去运行 git init；tmux-asset.ts:292-296 从配置取会话名（默认 wakeflow），与当前所在会话无关；:788、:854 在那个会话里建窗口，只有新建会话时才打印 attach；§13.118 唯一一次现场 bootstrap 是在 tmux 外启动的
  - 建议：windowBootstrap 在 tmux 不可用时停下来，告诉用户对应平台的一条安装命令；让 Controller 经用户确认后自己运行 git init，并同步修改 init.md、README 和参考文档；insideTmux 为真但当前会话不是配置里的会话时，要么在当前会话建窗口，要么转告用户 `tmux switch-client -t <session>`。在现场测一次“在 tmux 内启动”的分支。
- **I3** [低 / 缺陷] target skill 绝对禁止记录证据，与“先读 target skill”的 test skill 互相矛盾（计划阶段 7；状态：开放）
  - 说明：谨慎的模型可能拒绝记录证据，然后导入没有证据的步骤被拒；也可能类推，在实现目标里也去记录证据。现场碰巧是好的，但依赖模型自己判断该信哪个 skill。
  - 证据：wakeflow-target/SKILL.md:37-38：禁止 Controller 动作，包括记录证据，没有例外；wakeflow-test/SKILL.md:15-18 让先读 target skill、说自己“只补充”，:46-50、70-73 却要求 wakeflow_record_evidence test-output；§13.126 把测试窗口记录证据定为有意的裁决，现场表现正确
  - 建议：把 target SKILL.md:37-38 改成“不记录证据（测试目标以 test-output 记录自己的步骤输出，见 test skill）”，并在 test skill 中写明它覆盖这一行。
- **I4** [低 / 债务] Controller 每次的阅读负担偏重：Claude 版把约 500 词的 tmux helper 细节放进了每次必读的 SKILL.md（计划阶段 7；状态：开放）
  - 说明：即使只是做一次评审决策，也要先读完完整的 helper 参考。信息密度过高，会增加同一文件里关键规则（resend guard、维护协议的取值）被略读的概率。skill 通常每个会话只加载一次，成本不算大。
  - 证据：渲染后的 Claude Controller SKILL.md 2,122 词，Codex 版 1,595 词；三个参考文档约 1,819、797、2,843 词；SKILL.md:22 要求在第一次工具调用前从头读到尾；第 1 步内联了 {{windowBootstrap}} 和 {{windowLaunch}}（约 20 行）；CLAUDE.md 要求 prompt 有优先级、保持轻量
  - 建议：SKILL.md 第 1 步只保留一句占位（“用宿主 helper 启动，见 references/workspace-and-windows.md”），把 windowLaunch 和 windowBootstrap 的正文移到参考文档；给 Controller SKILL 设词数预算，并在 agent-text 构建中检查。
- **I5** [低 / 缺口] Controller 自己采集的证据文件没有指定存放位置（计划阶段 7；状态：开放）
  - 说明：needs-review 是实现目标的默认路径，要求 Controller 为每个 anchor 记录自己的验证输出。没有指定位置，它要么把探测写进产品仓库（弄脏目标报告里的 checkout），要么临时建一个脚手架、隐私规则和清理都不认识的目录。这个残留被记了两次，一直没关。
  - 证据：evidence.md:19-25 列出了可接受的来源，却没说 Controller 自己的命令输出存在哪里；reconcile 脚手架只有 drafts/、harnesses/、fixtures/；Test skill 限制只能写 harnesses/ 和 fixtures/；§13.120、§13.121 残留（L3458、L3479）：Controller 的探测文件一再落到 Test/evidence/demand_*/
  - 建议：给 Test surface（或 Controller 自有的 surface）加一个 evidence/ 脚手架目录，和其他目录一样由 reconcile 维护；在 evidence.md 中写明 `<demandId>/` 约定，并规定不得把探测写进产品 checkout。
- **I6** [中 / 缺口] 引导会话在登记窗口之前被关闭，tmux 里的 Controller 无法接手登记（计划阶段 7；状态：已修（§13.134），待现场：助手 `launch` 对没有定位器、却带本程序与本窗口标识且在跑 claude 的窗口收养（`adopted: true`，不开新窗口），拒绝为 adopt-unproven / window-ambiguous / window-present-not-claude；引导文字写明 tmux 里的 Controller 怎么接手登记、被拒时引导用户做什么）
  - 说明：初始化的引导会话（tmux 之外）启动 8 个窗口后保存各窗口的启动观察，等用户接受信任对话框后才登记。用户接受完信任就关闭了引导会话，观察随会话丢失；tmux 里新开的 Controller 只能用 `self` 登记自己，其余窗口没有观察可登记，`launch` 又会开出重复窗口，`teardown` 在 tmux 里会连自己一起杀掉。唯一的出路是在 tmux 之外重开引导会话、`teardown` 后重做引导。
  - 证据：§13.133 现场；`claude-code-agent-text-profile.ts` 的 `WINDOW_BOOTSTRAP`（只在 tmux 之外的引导会话登记；重做引导要 `teardown`）；助手 `launch` 对没有定位器的逻辑窗口不检查已有窗口；窗口的 tmux 选项（`@wakeflow_window_id` 等）与进程参数里的 `--session-id` 足以重建观察。
  - 建议：助手 `launch` 发现同一程序、同一逻辑窗口、仍活着的 Wakeflow 窗口时，不开新窗口，而是从 tmux 选项、pane 坐标与 claude 进程的 `--session-id` 重建观察并标明 `adopted`，tmux 里的 Controller 就能直接登记；引导文字在交代"告诉我好了再关"之外，也写明关早了怎么办。
- **I7** [中 / 缺陷] 投递提示词的阅读顺序写错文档：`code-facts` / `landing-plan` 标在 `requirement.md` 后面，`landing.md` 不在列，`requirement.md` 是从产品窗口解析不到的裸路径（计划阶段 7；状态：已修并经现场（§13.134、§13.135）：阅读顺序逐文档列出 requirement.md 与 landing.md 从窗口可解析的完整路径（现场为 `../../wakeflow-ledger/requirements/<id>/…`），各自的节标在各自文档下；同时修了兄弟位置（`../X`）的窗口把工作区根算成 `../..` 的旧缺陷）
  - 说明：实现与测试两次投递都一样：提示词骨架的阅读顺序把 landing 里的两节写到 requirement.md 下面，漏了 landing.md 本身，而测试合同的环境依据恰恰在 landing.md；requirement.md 没有带 ledger 路径，产品窗口从自己的根目录找不到。目标 Agent 靠先读任务包 JSON 绕过去了。
  - 证据：§13.133 现场，Controller 两次报告；`src/capabilities/delivery/prompt.ts` 的阅读顺序渲染。
  - 建议：阅读顺序按文档列出 requirement.md 与 landing.md 两个完整的 ledger 路径，各自的节标在各自文档下；加一个渲染回归。
- **I8** [中 / 缺口] Test 技能没教怎么引用已登记的证据：第一次导入以"证据引用无法解析"被拒，测试窗口去读插件源码才找到 `artifacts/managed-evidence/<evidenceId>/payload/content` 加 sha256 的写法（计划阶段 7；状态：已修并经现场（§13.134、§13.135）：Test 与 Target 技能写明引用形式并给例子，现场两次测试导入都一次通过；导入拒绝按类别给 reason 并指向第一条出错的引用，`evidence-unresolved` 退役）
  - 说明：测试窗口登记了四条 test-output 证据，报告里按自己的理解引用，导入被拒；它翻插件实现找到定位器的格式后第二次才成功。被引导的 Agent 不该需要读实现。
  - 证据：§13.133 现场，测试窗口报告。
  - 建议：Test 与 Target 技能写明证据引用的确切形式（或由 record_evidence 的结果直接给出可复制的引用），并让导入的拒绝原因点名哪条引用、缺什么。
- **I9** [中 / 缺陷] 长寿会话按上下文里的旧技能文字行事：插件更新后 Controller 照旧流程刷新窗口、让用户开 tmux shell；Test 与 Controller 仍把 recordedBy 当缺陷报（计划阶段 7；状态：部分（§13.135）：`/wakeflow:status` 命令（每次从磁盘读）遇到 runtime-artifact 相关的码时要求重新加载 Controller 技能并按 "After a plugin update" 现在的写法做；就地自重启的固定 prompt 也要求先重新加载技能；产品与 Test 窗口仍只在下次加载技能时拿到新文字）
  - 说明：§13.135 现场：/mcp 重连后 Controller 没有再读参考，按旧文字关窗、resume、relocate，最后让用户 `/exit`、`Ctrl-b c` 开 shell 粘贴助手命令；用户点明"重新读一下 After a plugin update"后它才走就地自重启。技能正文在会话里只注入一次，resume 也保留旧对话。
  - 证据：§13.135 现场 L1、L2、L9。
  - 建议：（已做部分）状态命令与自重启 prompt；另可让 verify 的 next 在 runtime-artifact 帧上带"重新加载技能"的提示，或给产品与 Test 窗口的投递 prompt 加一句按磁盘上的技能执行。
- **I10** [低 / 缺陷] 投递提示词最多列 4 条验收锚点，多出来的静默略去（计划阶段 7；状态：已修（§13.135）：超出时列出"另有 N 条在任务包里"，中英两种语言，渲染回归已加）
  - 说明：§13.135 现场第 5 条锚点（其余仓库保持基线）不在提示词里；实现窗口靠先读任务包才补上。
  - 证据：`delivery/prompt.ts` 的 `MAXIMUM_ANCHORS = 4`。
  - 建议：（已做）
- **I11** [中 / 缺口] Controller 为找命令写法去读自己的 Claude Code 会话记录（`~/.claude/projects/<工作区>/<会话>.jsonl`）（计划阶段 7；状态：开放，§13.136 现场）
  - 说明：插件更新后处理从未对话过的窗口（close、launch、replace、mark）时，Controller 用 node 一行脚本翻自己的会话记录，找上一次怎么写这几条命令，而不是按技能文字做。那是宿主的私有记录，不在 Wakeflow 的任何面上。
  - 证据：§13.136 现场屏幕（"Finding the earlier close/launch/mark commands"）。
  - 建议：技能把 close、`launch --wait`、register（operation replace）与 mark 的确切调用写在一处并给一个完整例子；SKILL.md 写明不读宿主的会话记录。

## J. 占用与退出路径：进得去，出不来

中。工作区一旦建成，对某个仓库唯一被支持的配置变更是“添加”。不能删除或改动仓库、窗口，不能把 managed-block 切回，也不能分离工作区。managed-block 会把绑定特定工作区的阻塞性指令写进团队共享的受跟踪文件。pod 关闭后会留下分支和 exclude 行，settings 规则没有所有权记录，声明的宿主布局也和实际存储不一致。

- **J1** [中 / 缺口] 没有退出路径：用户无法通过插件对某个仓库或整个工作区停用 Wakeflow，reconfigure 不能删除或改动仓库和窗口，也没有文档列出需要清理什么（计划阶段 9；状态：开放）
  - 说明：想对某一个仓库停用 Wakeflow 的用户，找不到一条能让工作区保持有效的路；手工删掉托管块，reconcile 又会写回来。要完全离开，大部分痕迹都在可以整体删除的控制工作区目录里，但产品仓库里的 managed-block 和 pod 残留、根目录的 statusLine 等没有清单。真正要紧的缺口更窄一些：在运行中的工作区里，没有引导式的方法去掉一个仓库或窗口，或者把它切出 managed-block。
  - 证据：maintenance public request schema：除 fresh-initialize 外只有 reconcile 和需要完整 desiredConfig 的 reconfigure；static-materialization-preview.ts:198-240：报 reconfigure-repository-change-unsupported（包括 instructionManagement）、repository-removal-unsupported、window-removal-unsupported、layout-change-unsupported；workspace-and-windows.md:20-22、36-52：禁止手改配置，并记录这些拒绝；§13.130 表第 2 行把“删除与改动仍然拒绝”记为处置结论，而不是待用户决定；§13.124 D9（L3584）提议的“删除要等退役完成”没有实现；endpoint/decide.ts:181-205 的 decommission 只解绑，不改配置；removeWakeflowManagedTextEnvelope（managed-text-envelope.ts:531-535）只被自己的测试调用；在 agent-text 和 docs 中 grep uninstall、卸载、teardown 没有退出流程；旧实现支持删除仓库和窗口
  - 建议：先请用户决定 v1 是否需要删除和分离。如果需要，就实现 D9 第二步“先退役再删除”（复用 pod close-complete 的投影退役），并新增 detach-repository 和 detach-workspace 维护意图（preview/apply；只删除正文与已知渲染完全一致的 envelope；移除 Wakeflow 自己的允许规则和 statusLine；列出不会碰的东西：分支、worktree、ledger）。在此之前，README 加一节“停用 Wakeflow”，列出所有写入的位置和对应的引导命令。
- **J2** [中 / 风险] managed-block 会把绑定特定工作区的阻塞性指令写进团队共享的受跟踪文件；没有默认值，没有后果说明，也不可撤销（计划阶段 9；状态：开放）
  - 说明：一旦被提交，每个克隆都会带上这个块，包括根本没装 Wakeflow 的队友，他们普通的会话会被要求等待任务包。两个开发者把同一个仓库纳入各自的工作区时，会因为 programId 不同而互相把对方的块判为未知托管块，双双阻塞（这一点合理但未测试）。reconfigure 拒绝任何仓库变更，所以 init 时选错就是永久的。
  - 证据：wakeflow-external-instruction-body-authority.ts:230-255 以仓库根的 CLAUDE.md/AGENTS.md 为目标；约 360-410 行的正文嵌入 programId、repositoryId、windowIds；:397 写着“没有确切的任务包时只做身份对齐并等待”；:404 写着“插件不可用时只读并报告阻塞”；managed-text-authority-transition.ts:24-26：正文未知的有效 marker 视为冲突，不覆盖；recomposition.ts:30-34：新建的文件权限为 0644，会显示为未跟踪；fresh-config-selection.ts:316-320：instructionManagement 必填且没有默认值，只有 schema 的一行描述；init 参考（workspace-and-windows.md:80-85）只说要问用户；现场 5 个仓库都是 owner-managed，managed-block 只有 card-01 场景覆盖，从未在现场运行；块本身写明提交需要明确授权（:408）
  - 建议：让 owner-managed 成为默认值，init skill 用一句话说明提交后队友会看到这个块。把块的措辞限定为：没有 Wakeflow 绑定的会话忽略它，不要等待。受跟踪的块里不放工作区专属 id，或者改用被忽略或仅本地的文件（如 CLAUDE.local.md）。允许 reconfigure 把 managed-block 切回 owner-managed 并删除完全匹配的 envelope。在推荐它之前先在现场跑一次。
- **J3** [低 / 缺口] pod 关闭后，各产品仓库会留下分支、exclude 行和空的 worktree 目录，指引里不提分支，复用 pod 名时会被拒（计划阶段 9；状态：开放）
  - 说明：这些都是本地、未跟踪的元数据，不会影响队友。问题主要在分支：处置为 merged 后分支也不会被删，下次用同名 pod 时每个仓库都要问一遍删还是改名。README 的说法让用户对 Wakeflow 会动哪些东西有错误的认识。
  - 证据：claude-code-tmux-asset.ts:501-520 向 .git/info/exclude 追加 '.claude/worktrees/'；:552-563 创建 worktree-wakeflow-<pod> 分支，分支已存在但没有 checkout 时报 worktree-branch-exists；governance/pod/worktree-disposal.ts:14-20 只建议 unlock 和 remove；workspace-and-windows.md:208-218、commands/pod.md:19-23 都不提分支、exclude 行、空目录；现场 5 个仓库都还留着 exclude 行和空的 .claude/worktrees/；§13.128 的关闭流程执行了 branch -D；README.md:67-71 说除了 managed-block，Wakeflow 不会写产品仓库
  - 建议：扩充关闭指引：删除 checkout 后，对 merged 的建议 `git branch -d worktree-<name>`，对 abandoned 的先询问再 -D；空的 .claude/worktrees/ 可以删除；更正 README，列出 pod 期间的写入（checkout、分支、本地 exclude 行）。
- **J4** [低 / 债务] 修改 settings 时不记录哪些规则属于 Wakeflow：退役的规则会永久变成“用户规则”，statusLine 带着绝对路径（计划阶段 9；状态：开放）
  - 说明：只要以后 helper 换位置或规则收窄，旧规则就会永远留在共享 settings 里，并且仍然允许运行旧路径上的任何文件，规则集只增不减。卸载后允许规则和 statusLine 也留着。Controller 也没有办法把 legacy-broad 阻塞转成用户该做的确切修改。
  - 证据：claude-code-portable-settings-transition.ts:172-192 managedAllowEntries：不在当前规则集里的条目一律保留为用户条目；当前根规则是与运行时路径绑定的 helper 命令（tmux-asset.ts:69-76，03f8acec 引入）；现场 settings.local.json 的 statusLine 是 'node -- <绝对根>/.wakeflow-local/.../statusline.mjs'（claude-code-statusline-settings-operation.ts:240），工作区移动后失效，卸载插件后仍会运行；legacy-broad-permission-present 只出现在 settings-blocked 码里，agent 文本没有解释
  - 建议：维护一张 Wakeflow 曾写过的退役规则清单，reconcile 时删除完全匹配的条目；在 settings-blocked 的解释里点名 legacy-broad-permission-present，并给出要删的三行；把 statusLine 和允许规则的移除纳入退出意图。
- **J5** [低 / 缺陷] 声明的宿主布局与实际存储不一致：locator 目录声明了却没人用，真正使用的目录没声明，还保留着已删除功能的目录和从未产生的事件词汇（计划阶段 9；状态：开放）
  - 说明：verify、reconcile 和 D8 普查所依赖的布局权威，描述的是没人用的目录，却漏掉了真正存放 locator 记录的那个。三处各自维护 locator 路径，以后改其中一处，helper 和运行时就会悄悄不一致，孤儿报告也分不清真实残留和“声明了但没用”的目录。
  - 证据：workspace-host-resource-catalog.ts:259-340 声明了 operations/window-locators（:273-278）、keep-live/leases、activity-monitor、temp/prompts，src 里没有任何写入者；locator-store.ts:66-70、231-235 实际写 identity/window-locators；helper（tmux-asset.ts:96）另外硬编码了同一路径；现场 operations/window-locators 为 0 条，identity/window-locators 有 8 条；operations/keep-live 存在；卡片 10 L15 写 keep-live 整体删除，但两个 profile 都是 keepLive: true（L24）；kernel/hook-observations.ts:68,139 和 result-review/decide.ts:184-205 接受 'turn-complete'，observer 从不产生它；§13.117、§13.119 L3442 已记录，§13.130 表里没有
  - 建议：在 catalog 中声明 identity/window-locators，导出一个常量供 locator store 和 helper 共用；删除 operations/window-locators、keep-live 的声明和 keepLive 标志，以及 activityMonitor、temporaryPrompts 和 'turn-complete'，或者写明它们归哪个未来功能；让 reconcile 把遗留的空目录作为孤儿报告（只报告）。

## K. 上下文与运行成本：费用主要来自一个不轮换的长寿 Controller 会话

中。Wakeflow 自身的调用很便宜（每次 1 到 3 秒），真正的成本在模型回合上。一个 Controller 会话累积到约 95 万 token，读了 1.2 亿缓存 token，经历一次 4.5 分钟的压缩。宿主观察被模型逐字转抄。工具目录超出 ADR 预算却无人量测。精简结果从未实现，Controller 还要读内部事件文件来喂 prompt。

- **K1** [中 / 缺口] 主要运行成本来自长期存活的 Controller 会话，而 Wakeflow 没有任何限制或轮换它的机制（计划阶段 8；状态：开放）
  - 说明：Wakeflow 的状态是持久化、事件溯源的，每一步都从 status 开始，所以一个新的 Controller 会话可以接手任何 Demand。实际上一个会话跨了好几轮、好几个 Demand 和一个 pod 生命周期，之后每个回合都要重读 60 万到 90 万缓存 token。成本和延迟是实打实的；可靠性方面的论据弱，而且宿主会自动压缩。
  - 证据：transcript 80580357（Controller，09-24 23:03 至 09-25 18:26）：276 次调用，483,729 个输出 token，1.2149 亿缓存读取，峰值上下文 954,628；09-25 08:57 自动压缩 965,862 → 16,449，耗时 271,898 ms；第六轮 Demand（44 字节文件，74 分钟）：Controller 输出 148,147 token，产品窗口只有 5,293（约 2.3%）；各窗口首回合上下文只有 4 到 5 万 token，增长来自累积的历史；验证者更正：断连分别发生在 05:09、07:18、08:49 和压缩后的 08:59（此时上下文仅 72,852），与上下文大小的相关性很弱；assets/agent-text 里没有任何关于 compact、/clear 或会话轮换的内容
  - 建议：把 Controller 上下文的生命周期写进 skill 和命令：建议每个 Demand、每次 pod create/close 之后开一个新 Controller 会话（status 是权威，不会丢任何东西）；在 /wakeflow:next 和 status 里加一句“在任何步骤边界开新会话都是安全的”；Controller 跑了很多步之后主动提醒用户。每轮现场在 gate-log 里记录每个 Demand 的 token 数和回合数。
- **K2** [中 / 债务] 宿主观察经模型逐字转抄，pod create 和 close 每个窗口要花约一万个输出 token；16 窗格上限在第二个 pod 时会截断（计划阶段 8；状态：开放）
  - 说明：设计让 Wakeflow 不执行宿主效果，代价是 Agent 每个窗口要往返至少 4 次（inspect、launch、register、mark），把 helper 的 JSON 读进上下文再原样发进 MCP 请求。现在主窗口 8 个加一个 pod 8 个，正好是 16 窗格上限，再加一个 pod 观察就会被截断。
  - 证据：claude-code-agent-text-profile.ts:50-57、:101-106 要求逐字 register 和 record helper 的输出；relatedPanes（tmux-asset.ts:672-683）返回所有相关窗格，上限 MAX_PANES=16（:119）；commandClose（:1223、:1239）丢掉 truncated 标志；未列出的窗格按 missing 分类（pane-classification.ts:91）；6 次 decommission 请求从约 13.9 KB 降到 9.6 KB，平均 11,095 B；pod create：50 次调用、64,211 输出 token、26 分钟；pod close：56 次调用、84,629 输出 token、45 分钟（其中含压缩）；验证者更正：复制的观察只占每窗口约 3-4k token；§13.128 把十几分钟主要归因于窗口启动等待和注册；kill 决策用的是完整列表
  - 建议：让 helper 把关闭和存活观察过滤到目标窗口的窗格；增加批量命令（launch --pod、close --pod），把观察写到工作区文件里，register 接受文件引用加摘要或者批量窗口；在支持第二个 pod 之前提高或取消 16 窗格上限。之后按回合数、输出 token、分钟数重新测量。
- **K3** [中 / 缺口] ADR-0004 定的 <60 KB 工具目录目标没达到，20 个工具后没再量过，也没有强制执行；gate 仍然放行 128 KB（计划阶段 8；状态：开放）
  - 说明：一个已接受的 ADR 目标看起来像是在执行，其实没有，唯一的 gate 是目标的 2.1 倍，推迟它的注释也过时了。成本主要落在没有延迟加载的 Codex 上；Claude Code 是按需加载工具的。
  - 证据：ADR-0004:5,41 目标低于 60 KB；计划 TSD-13 把它列为 L0 退出条件；wakeflow-public-mcp-catalog.test.ts:196 INTERIM 预算 128 KiB；:311 的注释说“L1 之后复测”，而 L1 已经结束；最后一次测量是 18 个工具时 85,016 B（gate-log L2748）；20 个 request schema 压缩后共 77,343 B，加上描述等估计约 90 KB（约 2.6 万 token，估算值）；仅 $defs 去重省不到 60 KB；smoke 只检查工具名（smoke-plugin-artifacts.ts:365-374）
  - 建议：在 gate-log 记录当前 tools/list 的实测大小；要么分步把测试预算降向 60 KB，要么修订 ADR-0004，改为按宿主或按角色的预算；删除过时的“L1 复测”注释；在 smoke:artifacts 中加入大小断言。
- **K4** [中 / 缺口] 每个窗口都拿到全部 20 个工具，在没有延迟加载的 Codex 上，按角色给子集可以省掉大部分目录成本（计划阶段 8；状态：开放）
  - 说明：在 Codex 上，8 到 16 个窗口每次请求都要携带约 2.6 万 token 的定义，其中大部分是产品窗口和 Design 窗口不该调用的 Controller 专属工具。按角色给子集还能缩小非 Controller Agent 误调用的范围。实现上需要通过窗口启动环境把角色传给 server。
  - 证据：两个插件的 .mcp.json 都启动同一个不带角色参数的 wakeflow server；wakeflow-public-mcp-server.ts:26-45 无条件注册全部工具；ADR-0004 L17：Codex 目前没有延迟加载工具定义的机制；Claude 通过 ToolSearch 按需加载；各角色实际用到的工具数：Design 3、Target 2、Test 3、Controller 18；schema 字节数约 8.0/8.5/14.2/64.0 KB，全量 77.3 KB；8 窗口工作区在 Codex 上每一轮总量约从 700 KB 降到 150 KB（估算，未在真实 Codex 上验证）
  - 建议：让宿主启动意图传入角色（维护流程写入每个窗口启动参数的环境变量），server 只注册该角色的工具，Controller 和未知角色保留全量；在目录测试中按角色测量 tools/list；在有真实 Codex 会话之前，Codex 的数字都视为未验证。
- **K5** [中 / 缺口] 精简结果（response_format）计划了三次都没实现；每次 review inspection 都重发整个任务包（计划阶段 8；状态：开放）
  - 说明：单个结果不算大，但反复出现：status 是每次 /next 的第一步，inspect 每次决策约跑两遍，而且每次都重发 Controller 早已写过的约 15 KB。累计约 27 万 token 进入 Controller 的历史，是上下文增长的一大块来源。
  - 证据：docs/reviews/2026-09-04-flow-optimization-analysis.md:96、architecture-and-slice-design.md:58/72/133、gate-log L2405 都列了 response_format；L2462 推迟到 L1 之后就没再提；src 和 tests 中找不到；inspect_target_result_review 的请求只有 root、demandId、targetTaskId；inspect 21 次，平均 21.7 KB（最大 27.5 KB，其中 taskPackage 15.2 KB，是 Controller 自己在 plan 时写的）；status 55 次，平均 9.1 KB，其中 windows 占 7.1 KB
  - 建议：给 inspect_target_result_review 和 status 加 `detail: summary|full` 参数，默认 summary：任务包只给 id 和摘要，外加决策必须引用的 anchor；status 的 windows 只给计数和需要处理的窗口。在场景测试中为每个工具的结果大小加断言（例如 8 个窗口时 status 小于 4 KB）。
- **K6** [中 / 风险] 为了把 prompt 喂给 helper，Controller 去读内部事件溯源文件并手工计算摘要（计划阶段 8；状态：开放）
  - 说明：prepare_delivery 的结果里已经有 prompt 和 promptDigest，但要逐字节重发 5 到 8 KB（摘要必须对得上），既容易出错又费 token，于是 Agent 改去读 Wakeflow 的私有事件日志，跨过了 CLAUDE.md 要求分清的状态权威边界。摘要对不上、落地识别失败这类故障已经在实际中出现过。
  - 证据：claude-code-agent-text-profile.ts:102-103 让 Agent 把 permit 的 prompt 管道输入 helper deliver；helper 从 stdin 读取（tmux-asset.ts:1074）；现场 Controller 的 Bash 读取了 28 次 `.wakeflow-active/current/demand_*/event-sourcing/commits/*.json`（其中含诊断，所以是上限），提取 envelope.portablePrompt 并与 sha256 比对；80580357 在 04:41Z 和 04:54Z 仍然从 commit 文件中提取 prompt 来投递；26b8ecc1 在 19:32 至 20:09 排查过落地识别不到的问题；hashlib/shasum 的 Bash 调用按会话计为 24/18/11/6/6/1；没有任何文字禁止读取事件文件
  - 建议：让 helper 按引用取 prompt（`deliver --window <id> --delivery <deliveryId>`），通过受支持的只读路径读取已准备的 permit 并自行核对 promptDigest，Agent 不再重打或重算；skill 明确禁止读取事件溯源文件。
- **K7** [低 / 债务] 公开结果上限还是 24 MiB 的“过渡值”，它当初的前提（planRef）已经以另一种形式实现，这个上限对上下文大小起不到任何保护作用（计划阶段 8；状态：开放）
  - 说明：24 MiB 大约是 700 万 token，远超任何宿主的上下文，挡不住投影回归。注释指向的条件已经不存在，也就没人负责去降它。
  - 证据：kernel/limits.ts:17-21 的注释说 planRef 在 L1 落地后降到 4 MiB；publication-transaction.ts:18：planRef 就是原请求本身；ADR-0004:8 的落地记录已经更新；在 command-shell.ts:172 和 wakeflow-public-mcp-tool.ts:154 执行；只有 limits.test.ts:47 测试；现场最大的结果是 32,126 B
  - 建议：按各工具实测的最大值（verify、多 Demand 下的 status 等）设置按工具的预算，或者降到一个对上下文有意义的上限，并更新注释。
- **K8** [低 / 债务] 维护预览把计划步骤重复了一遍，而且经常被调用两次（计划阶段 8；状态：开放）
  - 说明：只在 init 或 reconfigure 时发生一次，占总成本很少，但说明投影同时携带了同一份计划的内部视图和共享视图。
  - 证据：fresh-initialize 预览 32,126 B：plan.steps 10,901 B（23 步），sharedPreview 约 5.9-6.5 KB（其中 17 步重复），hostContribution 4,799 B，launchIntents 7,459 B；同一个预览发了两次，之后 apply 12,725 B（只有一个 fresh-initialize 样本）；结果从未有过预算，只有 tools/list 的 schema 做过瘦身
  - 建议：步骤列表只返回一次，并标出哪些是共享步骤、哪些是宿主步骤；launchIntents 挪到真正使用它的 apply 结果或 register inspect 里。

## L. 架构与代码健康：检查只覆盖一小部分代码，同一条规则写了好几份

中。约 79% 的运行时代码行不受 knip、复杂度和格式检查。阶段转移规则至少写在四个地方，而且 capability 一侧用的是无类型字符串。约 2,100 行恢复模块没有生产调用者，服务样板在切片之间复制，最常改动的几个文件是巨石。宿主知识渗进了宿主中立层，架构目标和 ADR 与现状脱节。

- **L1** [高 / 债务] Target 阶段转移规则至少写在四个地方，capability 一侧用的是无类型字符串（计划阶段 9；状态：开放）
  - 说明：预览的阻塞项（decide）、聚合的转移守卫、计算 next 的路由、status，各自独立编码“阶段 X 允许做什么”。它们一旦不一致，用户就会进死路：status 说可以做，工具却拒绝，或者反过来。capability 用 string，改名或新增阶段时编译器不会报错。
  - 证据：capabilities/delivery/decide.ts:39-50：PREPARABLE_*_PHASES 为 readonly string[]，PrepareTargetView.phase 为 string（:182）；聚合用有类型的阶段联合（demand-aggregate-state.ts:154-280），prepareDeliveryInDemandAggregateState（:1670+）自己再检查一遍；demand-controller-route.ts:408-411、:469 单独推导 rearm 耗尽；demand-post-acceptance-route.ts 另有自己的视图；'test-another-attempt-requested' 出现在 8 个非生成文件中；capabilities 里有 31 处阶段字符串比较；frontier-matrix 测试不 import decide 或聚合守卫，所以验证不了它们是否一致；DELIVERY_REARM_LIMIT 倒是共用的常量；gate-log §13.131（L3843、L3856）：rearm 耗尽后无法重新 prepare、research 继续进入无法规划的阶段、post-acceptance 计入旧测试目标，好几个死路都属于这一类
  - 建议：在 governance/demand/model 或 contracts 中为每种工作类型建一张声明式转移表（阶段 → 允许的命令，附带 DELIVERY_REARM_LIMIT 这类限制），以聚合的阶段联合作为类型，decide 阻塞项、聚合守卫、路由前沿都从这张表派生；加一个性质测试：对每个可达状态，next 指向的工具都能通过对应的 decide 和聚合检查。
- **L2** [中 / 缺口] 约五分之四的运行时代码不受未使用代码、复杂度和格式检查（计划阶段 9；状态：开放）
  - 说明：CLAUDE.md 当作健康证明的 knip、复杂度上限和格式检查，只覆盖约 21% 的行。事件溯源的 reducer、维护事务、持久化的文件系统协议、tmux 资产都在检查之外，这就是不可达模块和超长函数能在“全绿”下存活的原因。
  - 证据：knip.json 忽略 src/contracts/generated、configuration、workspace、governance、foundation、hosts 以及 tests/governance|foundation；biome.json 对这些目录关闭了 formatter、noExcessiveCognitiveComplexity、noNonNullAssertion、useImportType；豁免目录共 103,347 行，全部手写 src 为 131,630 行；超过 150 行的 22 个函数全在豁免目录里（如 parseDemandEventSourcingCommand 531 行、previewWakeflowStaticMaterialization 474 行、parseTargetTasks 384 行），超过 100 行的有 67 个；L0.6 计划在 L1 期间逐个目录纳入检查（gate-log 约 2470 行、§13.74），但没有执行；hosts/ 在 b2ffca21 时已经被忽略；验证者更正：这些目录仍然跑 typecheck 和 Biome 推荐的 lint 规则
  - 建议：逐个目录解除豁免，先 hosts/ 和 configuration/，再 workspace/；暂时拆不动的函数放进按文件的允许清单并记录负责人；knip 一次性覆盖整个 src，把结果修掉或显式列入允许清单；在 gate-log 里写明覆盖比例，让“全绿”说清楚自己的范围。
- **L3** [中 / 债务] 约 2,100 行恢复和读取模块没有生产调用者，靠白名单和它们自己的测试维持存在（计划阶段 9；状态：开放）
  - 说明：要么这是没人用的平行恢复实现，白白增加维护负担；要么产品本该用到这些恢复路径却没接上，比如中断的 gitignore、程序指令、support memory 重组，或者只处于 prepared 阶段的维护日志，都没有公开的恢复入口。白名单把“不可达”变成了“已准入”，却不说明是哪一种。
  - 证据：tooling/architecture/check-dependencies.ts:36-52 ADMITTED_PRODUCTION_ROOTS 列出了 8 个非入口模块，共 2,144 行：config-authority-replacement-recovery（222）、prepared-maintenance-recovery（403）、orphan-gate-recovery（223）、gitignore-recomposition-recovery（196）、program-instruction-recomposition-recovery（192）、support-memory-recovery（71）、managed-evidence-reading-service（457）、loaded-artifact-tree-transfer-publication（380）；src 中这些模块在自身文件之外没有任何 importer；约 1,150 行测试在维持它们；实际使用的 recoverWakeflowMaintenanceExecutionTransaction（transaction.ts:1006-1068）自己调用 retireInactiveCorrelatedGate，不经过这些模块；该表自己的注释（:31-35）就警告过“用测试把遗留实现伪装成运行时骨干”
  - 建议：逐个模块决定：覆盖了现有恢复路径处理不了的中断状态的，接入 wakeflow_maintain_workspace recover，并补一个在该点中断的场景；其余的连同测试一起删除。ADMITTED_PRODUCTION_ROOTS 只保留进程入口和构建期的宿主 profile 与片段。
- **L4** [中 / 债务] 服务的样板代码在切片之间复制，kernel 的共享形状只被部分采用，事务机制有四种（计划阶段 9；状态：开放）
  - 说明：修一个 context 打开、abort 或所有权检查的问题，要在 5 到 20 份副本里逐一找、逐一改。四套 stage/commit/recover 协议意味着要分别推理和测试四组中断状态。§13.131 需要 18 个并行修复者，这是原因之一（推断）。
  - 证据：delivery/service.ts:277-300 的 mapContextError 与 result-review/service.ts:268-291 逐字节相同；appendCommand 的前 18 行相同；私有 helper 的重复次数：currentUserId 22、assertNotAborted 36、parseOptions 44、assertRoot 46、signalOptions 20、parseDigest 20、mapContextError 7；kernel/append-command.ts 只有 tasking、delivery、result-review 三处使用；demand/lifecycle.ts:378 有自己的 appendLifecycleEvent；事务机制：kernel/publication-transaction.ts（160 行）、governance 的 evidence 和 demand publication（合计 6,449 行）、maintenance execution transaction（1,154 行）；delivery/service.ts 2,072 行，引入 21 个 governance 模块；result-review 2,004 行，引入 28 个
  - 建议：把共享的切片上下文（打开、关闭、错误映射、append 加提交事件检查）抽到 kernel，所有 append 型切片都迁到 runAppendCommand；所有权和 abort 相关的 helper 放进 foundation；长期把 evidence、demand、maintenance 三种发布统一到一个 staged-transaction 原语上。
- **L5** [中 / 债务] 改动最频繁的维护文件和聚合文件是混合了多种动作的巨石（计划阶段 9；状态：开放）
  - 说明：新增一种维护动作或 Demand 事件，就要改 400 到 500 行函数的中间部分，还要同时改好几个文件里平行的 parse、decide、evolve 分支。复杂度检查又被关掉了，没有任何力量阻止它们继续变大。
  - 证据：previewWakeflowStaticMaterialization 是一个 474 行的函数（wakeflow-static-materialization-preview.ts:1081-1555），内联处理 fresh、reconcile、reconfigure 三种分支；该文件在 09-20 之后的 39 次提交中改了 7 次；step-executor 1,435 行；demand-aggregate-state.ts 3,139 行，55 个函数；decider 1,841 行；parseDemandUncommittedEvent 392 行；'delivery.delivery-prepared' 在 6 个非生成文件中出现 22 次；ADR-0013 B 要求在 contracts 中建事件词表，contracts/vocabulary 里没有
  - 建议：把预览拆成每个动作一个 planner，共享同一个被检视的状态输入；在 contracts 中建事件注册表（类型、数据 schema、parser、evolve handler），parse 和命令解析分支从注册表生成；按关注点拆分聚合文件（实现目标、测试尝试、投递、continue）。
- **L6** [中 / 债务] 宿主特定的传输知识落在宿主中立的切片里，Codex 宿主层几乎是空的（计划阶段 9；状态：开放）
  - 说明：architecture 检查能通过，是因为切片不 import src/hosts，但宿主知识通过 template.kind、observation kind、以宿主命名的配置键渗了进来。加一个宿主，或者让 Claude 不走 tmux，都得改 endpoint、delivery、observation 切片。值得继续跟踪的是 capability 切片里的 tmux locator 和窗格知识。
  - 证据：endpoint/service.ts:770-826 直接读取 model.hosts['claude-code'] 和 model.hosts.codex，硬编码 claude CLI 参数和 codex 的 create_thread/set_thread_title/codex-thread；:773 的注释却说不按宿主分支；capabilities 中的 pane-classification.ts（109 行）和 locator-store.ts 是 tmux 专用的；capabilities 中 tmux 约出现 62 到 99 次；src/hosts/codex 465 行，claude-code 5,024 行；dependency-cruiser 只检查 import，不检查知识；§13.131（L3861）已经把 model.hosts 按宿主键控和 worktree 处置表记为“有意接受的取舍”
  - 建议：把 locator 存储、窗格分类、启动指令渲染移到 host-profile 函数后面，capabilities 只保留中立的“启动意图 → 指令对象”契约；加一个架构测试，禁止 tmux、create_thread、codex-thread 字面量出现在 src/hosts 之外。
- **L7** [中 / 待决] L0 阶段没达成的架构目标一直悬着，ADR 描述的形状与代码不符（计划阶段 9；状态：开放）
  - 说明：文档写的目标架构和实际执行的规则互相冲突。governance 的去留其实已经定了，只是注释和规则名过时了；foundation 的收敛和错误统一则一直没人认领。
  - 证据：L0 退出 gate 表（gate-log 约 2476-2485 行）：foundation ≤ 20 个文件，实际 63 个且至今未变；append < 50 ms 被推迟；ADR-0013 D（单一错误类型）和 E（14 个 foundation 原语）没有实现；ADR-0013 未决问题（约 32 行，§13.101 F8）已经定下 governance/workspace/configuration 作为现有领域保留，但 .dependency-cruiser.cjs 的头注释（:4-7）和规则名（:131-163）仍写着“transitional、在 L1 与旧树一起删除”；tools/list 目标见上下文主题
  - 建议：请用户决定：是按现状重设 ADR-0013 和 ADR-0004 的基线（governance 作为永久领域层、现实的目录预算和 foundation 规模），还是给缺失的工作排期（request-schema 的 $defs 共享、foundation 收敛）；然后给 transitional 规则改名，并去掉预算测试里的 INTERIM。
- **L8** [低 / 债务] 生成的合同层体积大、重复多，而且比它所依据的 schema 更宽松（计划阶段 9；状态：开放）
  - 说明：每次改一个共享 schema 都会重新产出很多大文件，diff 很吵。开放的索引签名关掉了 TS 的多余属性检查，字段拼错也能编译通过，只能靠运行时的 AJV 兜住。
  - 证据：95 个 schema（24.8k 行 JSON）生成 22.6k 行 TS，1,313 个类型声明，其中 208 个名字重复（WakeflowSha256DigestText 48 次、DemandId 41 次）；controller-target-review-decided-event-data-v1.generated.ts 2,234 行；36 个文件里有 83 处 `[k: string]: unknown` 索引签名，即使 schema 设了 additionalProperties:false（因为 allOf 的缘故）
  - 建议：codegen 把共享 $defs 只生成一次，放在公共模块里供其他文件 import；对带 additionalProperties:false 的 allOf 做后处理，生成封闭的对象类型，或者加一个类型层面的测试，禁止封闭 schema 出现索引签名。

## M. 文档权威与残留跟踪：已知问题会从汇总里掉出去

中。残留项只以散文形式分散在 30 多个 gate-log 章节里，每次汇总都只从某一段章节里收集，更早的就掉了，权限和 locator 问题就是这样躲过了清理轮和全项目评审。计划、对齐台账、需求总览和已发布的 skill 里都有已过时或与代码不符的描述。

- **M1** [中 / 缺口] 没有统一的残留和决策登记：§13.130 的“全部残留”表不全，有一行说过头了，更早的残留和 ADR 未决问题没人跟踪（计划阶段 0；状态：已完成（§13.132）：本表）
  - 说明：“记录了但不做”和“等用户裁决”混在一起，每次汇总只看一个窗口内的章节，更早的就掉出去了。helper 权限和 locator 这两个 §13.119 的问题，就这样同时躲过了清理轮和全项目评审。
  - 证据：§13.130 表（L3786-3803）只从 §13.122-§13.129 收集；§13.119 的 locator 路径、helper 允许规则、pasted_content shell（L3442）都不在里面；§13.110 D1（prepare_delivery 预览，L3240“留待裁决”）一直没有裁决；§13.114 同宿主之外的 peer 投影残留（L3328）仍然开着：pod/service.ts:487-505 只退役 context.facade.resourceProfile；第 1 行称 D8 已经“有码无节点”地关闭，但 materialization-preview.ts:1005-1007 仍然输出不带 path 的 host-capability-layout-conflict；blocked 预览的 suggestedTool 为 null（maintain-workspace.ts:413、534-539）在 L3832 记为残留，但没有处理；ADR 未决问题：ADR-0002 L48（README 迁移表）、ADR-0004 L52（已存计划的保留归谁管）、ADR-0005 L58（10,000 次提交上限仍是常量，demand-file-event-store-contract.ts:23）、ADR-0012 L65（归档时是否固定已批准的基线）；docs/ 下没有登记文件
  - 建议：建一份唯一的残留和决策登记（例如 docs/references/open-items.md），字段包括 id、来源章节、状态（open / decided-won't-do / awaiting-user / unverified-live）、代码指针；要求每个 gate-log 章节都更新它，并用本次分析的全部结论作为初始内容。两个小项可以顺手修：drift 阻塞的预览把 suggestedTool 指向 wakeflow_maintain_workspace；layout 冲突仿照 D8 普查给出 path 区域。
- **M2** [低 / 债务] 权威文档把没完成的事标成已完成或者已经过时：plan §13/§14、旧版对齐台账、reconfigure 场景描述（计划阶段 0；状态：开放）
  - 说明：docs/README.md 把计划定为阶段和完成情况的权威，把参考文档定为对齐状态的权威。照着读的人，包括以后的 Agent，会以为旧版对齐没有缺口、Codex 的完成标准已经满足。
  - 证据：docs/plan/typescript-reimplementation-plan.md 最后修改于 db364f6b（09-21），§14 状态段落（L338）仍停在 09-20，没有反映 §13.115-§13.131（Claude 现场已完成、Codex 没有）；验证者更正：计划已经在 L12、L56、L231 把 WakeflowTestWorkspace 写为用户指定的替代，§14 第 10 项提到 WakeWorkspace 的问题较轻；legacy-alignment-ledger.md L9-22 仍写 gap: 0；第 53 行把 wakeflow-reconfigure.mjs 标为 covered，第 226 行说拓扑变更会被拒绝；§13.122-§13.131 被引用 0 次；scenario-acceptance.md card-01/reconfigure（L17）仍说拓扑变更被拒绝，但 D9 已经允许添加仓库；平台声明问题见并发主题
  - 建议：给 plan §13/§14 加一段带日期的更新，列出 Codex 尚未满足的项；在台账里加上第三轮（§13.122-§13.129）的移植和 D8/D9 的重新判定；更新 reconfigure 场景的描述。
- **M3** [低 / 债务] 需求总览和已发布的 Controller skill 描述了并不存在的行为（计划阶段 0；状态：开放）
  - 说明：总览是读者判断 Wakeflow 能做什么的唯一文档，它已经与 ADR-0011 到 0013 以及实现脱节。shipped 参考文档还把其中一个错误带给了真实的 Controller，让它去找一个工具会拒绝的 redesign 决策。§13.131 的逐文件评审审的是代码，不检查跨文档的一致性。
  - 证据：docs/requirements/wakeflow-functions-and-scenarios.md:3 自 09-04 起仍为草稿、等待确认，来源只到 ADR-0010；F9.3（L193）说清理会删除已关闭 pod 的 worktree，与 F3.5（L129“worktree 从不由 Wakeflow 删除”）和卡片 08 §8.4 矛盾；§3 分支列表（L91）有“评审 redesign 后”，代码只接受 accept|rework|blocked|escalate，src 里没有 redesign；已发布的 delivery-and-review.md:32 写着“After a redesign decision: a replacement package”，而替换实际上由可替换阶段里一个未关闭的目标触发（tasking/decide.ts:124-141）；§6 的 tmux 措辞（运行时不执行 tmux）仍然成立
  - 建议：按当前 ADR 和代码更新总览（F9.3、redesign 分支，以及前面 continue/supplement 语义定下来之后的相应内容），然后标为 active；把 delivery-and-review.md:32 改为“仓库的未关闭目标不在进行中时，规划替换”；扩展 agent-text honesty 测试，拒绝不在决策 schema 里的决策名。
- **M4** [低 / 债务] 生成产物的改动占据了提交历史的大半，架构图谱陈旧且不在 gate 内（计划阶段 0；状态：开放）
  - 说明：每个提交约一半的 diff 是生成出来的，影响审查和 blame。图谱自称规范地图，但落后于后来的功能。
  - 证据：2457c961：751 个文件、+8761/-5834，其中 plugins/ 占 389 个文件；01ecfcde 的 plugins/ 有 +2796（全部 +6823）；没有 .gitattributes；每次改动在两个制品里各出现一次，另有约 230 KB 的 manifest 重写；vendored node_modules（5.4/5.2 MB）也提交了；wakeflow-architecture-atlas 最后一次提交是 be7432f0（09-18），check:current（scripts/check-atlas.mjs:41）不在 npm test 里；验证者更正：它引用的 97 个 src 路径中 96 个仍然存在，只是缺少 09-18 之后的功能
  - 建议：在 .gitattributes 中把 plugins/ 标记为 linguist-generated 并设 -diff，制品重建和源码改动分开提交；刷新图谱并把 check:current 纳入 gate，或者在 docs/README.md 中标为归档。
