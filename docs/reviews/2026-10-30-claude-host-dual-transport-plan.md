# Claude 宿主双传输（tmux 与桌面）支持规划与开发设计（2026-10-30）

状态：active（用户 2026-10-30 裁定：tmux 与桌面两种窗口传输都是高优先级、长期并列维护，不存在取代或停维。本文是两种传输共同的规划权威；桌面侧的设计细节见[适配方案](./2026-10-29-claude-desktop-transport-design.md)，tmux 侧的实现在 `src/hosts/claude-code/`；问题分别登记在 open-items 的 Y 节（tmux）与 X 节（桌面））。

## 0. 原则（用户裁定）

1. **并列一等。** tmux 与 desktop 都是 `claude-code` 宿主的正式窗口传输。fresh-initialize 时按引导会话所处环境选择，两者都写进 README、技能与交接卡；文本不得把任一方称为旧方式、预览或过渡。
2. **同步演进。** 凡改动窗口传输层的六个点——launch 指令、助手资产、绑定观察、存活观察、维护资产集合、交接文本——或 Controller 的宿主动作流程，必须在同一批次于两种传输上落地；做不到时在 Y 或 X 节登记一条"传输差距"并写明恢复一致的批次。
3. **共享层无传输词。** `src/` 共享层只消费宿主 profile 提供的传输值，不出现对 "tmux" 或 "desktop" 的 ad hoc 判断，与现有的"共享层不判断宿主名"同形。
4. **验证对等。** 每种传输各有自己的组件测试、场景链卡与现场清单。自动化能力不对等的地方（桌面 app 无法无头启动）用"录制观察 + 现场清单"补齐，并作为已知差距登记，而不是默认接受。
5. **问题分册。** 两种传输的问题分别登记（Y、X）；与传输无关的问题留在原节并标注"传输无关"。

## 1. 架构：一个宿主、两种传输

- 配置：`hosts.claude-code.windowTransport: "tmux" | "desktop"`，每工作区一种。缺省 tmux，既有工作区行为不变；fresh-initialize 按环境写入；reconfigure 可切换（K2）。
- 宿主 profile 增加传输轴对象，承载：助手资产描述（文件名、子命令集合、允许规则）、launch 指令渲染器、定位子种类与存活观察类型、维护资产集合、交接卡文本键。共享层按 profile 值行事。tmux 的现有实现迁入同一轴作为第一个值，这是不改行为的重构，由 L19 回归核对。
- 模块地图：
  - 与传输无关（共享）：窗口绑定存储与身份、投递服务与落地规则、hook 观察器主体与记录、verify 各门、Demand 流程、技能文本主体。
  - tmux 专属（现有）：tmux 助手资产与发布操作、launch 指令的 tmux 分支、状态栏资产、观察器在 `$TMUX` 下的 `@wakeflow_state` 投影、登记 Schema 的 `tmux` 坐标与 `tmux-panes` 观察。
  - desktop 专属（新建）：desktop 助手资产与发布操作、launch 指令的 desktop 分支、登记 Schema 的 `desktop` 定位子与 `desktop-sessions` 观察、交接卡 desktop 值、维护资产集合。
  - 两者共用的新增：观察记录可选字段 `permissionMode` 与 `sessionTitle`（tmux 同样受益：mark 核对与模式证据）、launch intent 的 `sessionIdPolicy` 加 host-assigned 值、存活观察分类抽象（pane 行或会话行统一为 present-busy / present-idle / absent）。
- 文本：静态技能文本只说"按工具返回的 launch instructions 分步做"，分步由渲染器按传输给出；两种传输各一段等长概述。Controller 窗口参考现在卡在 400 行预算，先把 tmux 段的逐步细节移回工具返回值，腾出的篇幅给 desktop。

## 2. 能力对等矩阵

| 能力 | tmux（今天） | desktop（目标） | 差距与登记 |
| --- | --- | --- | --- |
| 开窗 | 助手 `launch` 在 pane 起 `claude`，等 session-start | `desktop.mjs launch`：`--bg` → `stop` → 伪终端 `--desktop --resume`（K1） | 首回合多一轮 ok（X 节裁定 3） |
| 登记 | 句柄 + tmux 坐标 | 句柄 + `desktop.sessionId`（K1） | X5 |
| 存活观察 | `panes` 读五个窗口选项 | `claude agents --json` 行（K1） | 无 |
| 投递 | 助手 `deliver` 粘贴并回读 | Controller `send_message`，返回值作 sendReturn（K1） | 忙碌窗口回合末送达（X12） |
| 落地证明 | hook user-prompt-submit 记录 | 同左，digest 相等已现场证实 | 无 |
| 回调 | 产品窗口 send-keys 到 Controller pane | 产品窗口 `SendMessage` 到 Controller 桌面 id（K1） | 无 |
| mark | tmux 窗口名 | `set_session_title`（K1） | 用户改过标题时弹确认（X13） |
| resume | 助手 `resume`，从未对话的会话不能续 | 不需要，发消息即续 | tmux：Y12 |
| relocate | 换 pane 后 CAS | 不适用（同 Codex） | 无 |
| replace / close | 助手 `close` + 重开 | `archive_session`（用户授权）+ 重开 | pod 打开期间不归档（X6） |
| pod 检出 | 助手准备 `.claude/worktrees/wakeflow-<pod>` | 同一检出作为 cwd，不用 `--worktree` | X6 |
| pod 容器 | 每 pod 一个 tmux 会话 | 每 pod 一个侧栏分组（Controller 用 `create_group` / `move_sessions` 投影，K2） | 无 |
| 状态投影 | 状态行 + `@wakeflow_state` | 侧栏原生标记，不发布状态行 | X14 |
| 信任与权限模式 | 每窗信任对话；`--permission-mode auto` 随启动 | 每目录一次信任与选 auto；模式证据来自 user-prompt-submit（K1/K2） | X4 |
| 制品更新换代 | Controller 就地重启自己，再按 status 的逐窗口路线 resume 或 close → launch → replace → mark；过期窗口让门失败 | app 自行重载；过期窗口在下一条消息时换代，只作 `windows-refresh-pending` 信息（ADR-0025 D10）；归档→取消归档可立即结束进程（E5） | Y2（W41，已修）、X20、X21（已修） |
| 首跑交接卡 | tmux 进入命令与每窗信任 | 侧栏分组、每目录信任与 auto、订阅登录 | X11 |
| 自动化测试 | lab 用真实 tmux 进程跑两种实验 | 录制观察 + 场景链卡；无法无头起 app | X9 |
| 现场清单 | L1–L16、L19、L21（含 L15） | L17、L18、L20 已做 | 两者每次 tag 前各回归一次窗口生命周期 |

## 3. 维护规则

- 批次：改到传输层的任一批次，提交信息点名两种传输；只落一侧时同一提交里登记差距项（Y 或 X）。
- 测试：组件测试按传输分目录放在 `tests/hosts/claude-code/` 下；场景链每种传输至少一张窗口生命周期卡；制品诚实性测试同时核对两种传输的文本与命令表。
- 现场：每次 tag 前，两种传输各走一遍窗口生命周期现场（开窗、投递、回调、关窗）；任一传输的回归都阻塞整个发布，不存在只发一侧的版本。
- 文本：README 与技能对两种传输用并列段落；交接卡按 profile 值渲染；任何"推荐用哪种"的措辞只能描述环境差异（有没有桌面 app、有没有 tmux），不能表达优劣。
- 这条规则同时写进 CLAUDE.md 与 AGENTS.md 的 Source Ownership。

## 4. 批次与顺序

- **T0（本文，已做）**：规划、对等矩阵、Y/X 分册、维护规则。
- **K1 桌面传输核心**（第 2 级门；已执行 2026-10-31，§13.222，门 run-u090Pi 1733/1733）：ADR-0025（双传输决定 + 桌面设计）、配置轴与 profile 传输对象（tmux 迁入，不改行为）、Schema `desktop` 与 `desktop-sessions`、`desktop.mjs`、launch 渲染器、维护资产集合、投递与回调文本、场景链桌面卡、文本压缩。
- **T1 tmux 维护批**（第 2 级门，与 K2 同一阶段执行 2026-11-02，§13.225）：W41 整批 stale 窗口的批处理建议与"从未对话不必 resume"；W38 首次 reconcile apply 无效的复现与修；W39 replace/relocate 缺字段的措辞；D11 pod 事务后的 `drifted` 噪音。W3/H3 仍等 L15。
- **K2 桌面生命周期与投影**（第 2 级门；已执行 2026-11-02，§13.225，与 T1 同一道门）：`permissionMode` / `sessionTitle` 进观察记录（两传输共用）、pod 分组、换代路径（先验归档/取消归档）、交接卡、detach 对应、reconfigure 切换传输。
- **L18 / L19**：桌面全流程现场（已通过 2026-11-01，§13.223）；tmux 全流程回归（与 L13 同形，核对 K1 重构无行为变化；已通过 2026-11-02，§13.224）。
- **L20 / L21 / L15**（已通过 2026-11-05，§13.226）：T1 + K2 之后两传输各一次"插件更新 → 认领到归档"回归，L15 取得多行草稿的真实渲染并修 W3；修 X21（桌面过期窗口由宿主在下一回合换代，ADR-0025 D10）、X22（私有模式收敛归 Controller）、Y14（`target-not-at-prompt` 文本统一）。桌面侧仍待用户在场的一轮：X18 引导会话路径、传输切换 apply、`permission-mode-mismatch` 的现场触发。
- **之后**：两份助手脚本共同的类型化与合同共享（Y5/D5 与 desktop.mjs 一起解决）、A3 版本检测、K2 观察转抄成本。

## 5. 问题分册摘要（权威在 open-items）

- tmux：Y1 输入框草稿判空（W3，等 L15）、Y2 制品更新后整批 stale 的探测成本（W41）、Y3 首次 reconcile apply 无效（W38）、Y4 replace/relocate 缺字段措辞（W39）、Y5 助手是无类型的 JS 字符串（D5）、Y6 屏幕抓取与 wrapper 剥离依赖未公开 UI 文本（A3）、Y7 窗口可改写 Controller 免提示运行的助手（F1，部分缓解）、Y8 长寿会话按旧技能文字行事（I9，部分）、Y9 pod 事务后 `drifted` 噪音（D11）、Y10 观察逐字转抄与 16 窗格上限（K2）、Y11 从未对话的会话不能 resume（设计限制）、Y12 tmux 服务器退出即全部窗口退出（固有）、Y13 每窗信任对话（固有）。
- desktop：X1–X8 已登记；新增 X9 无法无头自动化、X10 桌面工具面随版本变动与服务端开关、X11 订阅登录与伪终端前提、X12 忙碌会话回合末送达、X13 `set_session_title` 的确认行为待验、X14 状态行与 attention 投影无落点。

## 6. 决定记录

- 2026-10-30 用户：两种传输并列高优先级、长期维护，不存在取代；桌面四个决定点按推荐（适配方案第 11 节）。
