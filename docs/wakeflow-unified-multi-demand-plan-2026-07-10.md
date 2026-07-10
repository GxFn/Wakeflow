# Wakeflow 多需求并行统一方案（2026-07-10）

前置：并行叙述全仓深挖完成（机制层 + docs/README + skills/templates/commands 三面）。
本文是执行计划：先定正典模型，再列机制与叙述的全部修正点，按波次落地。

## 0. 用户裁定（正典，不可动）

既有裁定（eae331e，2026-07-02）：

- 需求内每仓一窗口一组合任务包，窗口自排序，绝无同窗双派。
- 并行只存在于需求层（多活跃 demand）。
- worktree = 跨需求隔离，每 (repo, demand) 一个；绝非需求内并行派发。

本轮裁定（2026-07-10，四答）：

1. 套件组成：多开需求的一套窗口 = 专属总控 + 专属 Test + 各仓工作窗。
   **不含 Design**——Design 保持全局唯一，管全局 TODO 板。
2. worktree 绑定：**整套共用**——该需求所有窗口（含 Test）都在这需求
   自己的一套 worktree（每仓一个，分支 `<demandKey>/<id>`）上工作和验证；
   无每窗口单独 worktree。
3. 主需求形态：**保持不对称**——先占需求用主窗口套件 + 主检出（pod 0）；
   第 2..N 个需求各建一套窗口 + 一套 worktree；主检出是合并目标。
4. codex 深度：**机制补齐**——codex 版实现同款"每需求一套线程窗口 +
   一套 worktree"，两版行为对等。
5. 套内红线：一套总控窗口内不做任何其他并发逻辑（无波内并行、无窗口级
   并行、无同仓多流；"wave"一词现指按序执行波，与并行无关）。

## 1. 统一目标模型（一段话正典）

多需求同时跑 = 多套需求窗口组（demand pod）。每个多开的需求获得一套
自己的窗口组（专属总控 + 专属 Test + 每仓一个工作窗口）和一套自己的
worktree（每仓一个，分支 `<demandKey>/<id>`）；**整套窗口都在这套
worktree 上工作与验证**。主需求（pod 0）继续使用主窗口套件与主检出。
套内没有任何并发逻辑：每仓一窗口一组合任务包，窗口自排序。容量由
`maxActiveDemands`（默认 2）与 `maxStreamsPerRepo`（默认 2）钳制；
归档才释放容量；pod 间互不知晓；分支合并回主线人工评审、去中心化
（pending-merges 台账）。CC 与 codex 同一套逻辑：CC 以独立 tmux 会话
实现窗口组，codex 以线程组实现（create_thread cwd=worktree）；实现
细节不同，模型、容量、边界完全一致。

## 2. 机制修正（M 系）

已对齐、不动：core 容量机制（active-demands 扫描、init capacity-lock、
next-work 仪表盘、sequence claim 门）；CC streams（同 (repo,demand) 拒
第二窗、stream-close 证据保护、archive 拒开窗）；CC pods（pod-open/close/
list、控制器印章路由）；窗口投递锁；state-root/board/capacity/paste 锁；
序列清单内串行（测试钉死，属"有依赖需求链"语义）。

- **M1（CC，裁定②落地）**：`pod-open` 中 `Test__<pod>` 以
  internalTestPath 为 cwd 且无入口提示词（wakeflow-claude-host.mjs
  pod-open 的 launch 段）。修：为 Test__pod 生成入口提示词（身份 +
  demandKey + 本 pod worktree 路径清单 + 只在这套 worktree 上验证 +
  测试边界）；`buildPodControllerPrompt` 补"你的整套窗口（含 Test）
  共用本需求的一套 worktree"；核对 Test__pod 的证据根解析
  （state.mjs evidenceRepoRootForWindow 的 pod 后缀回退对 Test 卡
  证据是否正确落到 worktree）。
- **M2（codex，裁定④落地）**：
  a. `wakeflow-claude-stream.mjs`（实际已 host 中立：overlay、分支名、
     worktree 路径、上限，无 tmux 依赖）提升为 core
     `scripts/lib/wakeflow-stream-overlay.mjs`；`maxStreamsFor` 的
     `hosts["claude-code"].maxStreamsPerRepo` 键泛化为按当前宿主/顶层键。
  b. 统一控制器工具面：fleet/stream 能力走既有 host-profile 钩子模式
     （core 定义，宿主实现差异化）——claude 委托 claude-host
     pod-open/close；codex 执行 容量检查 + git worktree + overlay 写入，
     产出 windowLaunchPlan（create_thread cwd=worktree + entry-sync
     提示词 + wakeflow_register_window 模板）；关闭侧做 worktree 干净度
     检查 + pending-merges 记录 + overlay 移除 + 注销指引。
  c. codex host-profile `targetPolicy` 的 "do not create a worktree
     unless the user explicitly asks" 改写为"Wakeflow 管理的跨需求隔离
     worktree 除外"。
- **M3**：`wakeflow.config.example.json`（core + 两版）补
  `maxActiveDemands` 与 `hosts.*.maxStreamsPerRepo` 示例，注明默认值与
  含义（现在旋钮只活在代码默认值里，用户不可发现）。
- **M4（防回潮）**：deep-dive:120 声称的"'parallel stream' 禁词契约
  lint"实际不存在。修：实现真实散文禁词 lint（测试遍历双版 skills/
  templates/commands/CLAUDE.md/AGENTS.md 与 core 散文，拒绝
  "parallel stream"、"波内并行"、"同仓多 stream"等需求内并行旧词；
  放行历史文档 roadmap 的已废止段落与本计划的引用语境）。
- **M5（澄清）**：demand-sequence 帮助文本与 docs 补一句：序列清单 =
  有依赖的需求链（内部串行、归档后放行下一个）；跨需求并行发生在
  独立需求/序列之间，受容量钳制。

## 3. 叙述修正清单（N 系，逐条）

1. roadmap-2026-07-02:138 E-2 行触发条件仍写"需求内多 stream 用满后
   仍有跨需求并行诉求"——旧词残留，改为跨需求语义。
2. roadmap-2026-07-02:225 一页总览 "E系: 流式评审/多活跃demand/stream依赖"
   混列已消解项——标注 E-1/E-3 已随 §4.5 消解。
3. scripts/README.md:92（两版）"group-ready permits one pending/sent
   controller-return for the group wave"——"group wave"改为"dispatch
   group"。
4. codex AGENTS.md:196-201 pods 承诺——M2 落地后补齐 worktree/线程组
   实现细节，与 CC 段对齐（含裁定②"整套共用 worktree"半句）。
5. codex governance SKILL.md:117 "(Pod session tooling is Claude
   Code-edition; Codex pods = per-demand thread sets, symmetric landing
   pending.)"——兑现改写为对等能力描述。
6. codex stage-route-map:66-67 "(Isolation worktree windows are a
   Claude Code-edition capability…)"——改为双版能力 + codex 工具名。
7. codex controller SKILL.md 整章缺失 "One Window Per Repo Within A
   Demand" 与 "Demand Pods"（claude 版 232/254 行）——移植并按 codex
   宿主措辞（线程组、host 工具、launch plan）。
8. templates 两版 `todo-window-scheduling-policy.md` 的 "Parallel work
   is allowed when it:" 段——裁定前窗口级并行判据残留，重写为需求层
   模型（不同仓窗口各持组合包自然并行推进；跨需求并行走 pod；不存在
   窗口级并行派发决策）。
9. CC 侧 pods 各处补裁定②半句"整套（含 Test）共用该需求的一套
   worktree、Test 在 worktree 上验证"：controller SKILL Demand Pods 节、
   governance SKILL:141、CLAUDE.md Parallelism 段、README×2 pods 段、
   dual-edition §7.7 双语、deep-dive §4.12。
10. deep-dive:120 禁词 lint 句——M4 实现后该句成真（实现前不改文档，
    以 lint 落地为准）。
11. 正典句（§1）沉淀进 governance 参考（agents-rule-map 或架构参考），
    双版一致；明确 tmux 会话 vs 线程组 = 宿主实现细节。
12. 记忆更新：wakeflow-parallel-model-combined-package.md 补四项裁定。

## 4. 测试与验证

- 新增：pod-open Test 提示词/绑定测试；core stream-overlay 库测试
  （从 claude-stream 测试迁移共享）；codex fleet launch-plan 测试
  （headless）；禁词 lint 测试。
- 回归：多需求容量、序列串行、并发锁、双版字节平价（sync-core 覆盖的
  core 文件）、双 smoke。
- 全量 `node scripts/wakeflow-verify.mjs --with-script-tests`。

## 5. 波次

- W1：core 库提升（M2a）+ M3 config + M1 CC Test 绑定。
- W2：codex 机制补齐（M2b/M2c：工具面 + launch plan + close 侧）。
- W3：叙述统一批改（N1-N11，双版）+ M4 禁词 lint + M5 澄清。
- W4：全量验证 + 记忆更新（N12）+ 总结。

每波遵循 wave 纪律：机制先行、测试随波、散文随波、波尾 verify。

## 6. 落地记录（2026-07-10 执行完毕）

全部四波已落地，`npm test` 346/346 全绿（check:core 字节平价 + 双版
validate + 双 smoke + 全部脚本测试）。落点对照：

- M1：pod-open 为 `Test__<pod>` 生成入口提示词（身份 + worktree 路径清单 +
  只在 worktree 验证），控制器 pod 提示词新增整套共用 worktree 条款；提示词
  移到 --no-launch 之外（准备阶段产物齐全）。测试：wakeflow-claude-stream
  pod lifecycle 断言两份提示词。
- M2a：`wakeflow-claude-stream.mjs` → core `wakeflow-stream-overlay.mjs`
  （maxStreamsFor 按 hostProfile.runtime.hostDirName 泛化），并抽出共享守卫
  `streamOpenRefusal` / `addStreamWorktree` / `removeStreamWorktree` /
  `appendPendingMergeRow`，claude-host 改用之（规则两版按构造一致）。
- M2b：新增 host 中立 `core/scripts/wakeflow-pod.mjs`（open/close/list）+
  MCP 工具 `wakeflow_pod_open/close/list`；host-profile 新增 `fleet.transport`
  （codex: agent-tools —— windowPlan + create_thread cwd=worktree + 注册模板；
  claude: host-helper —— 只准备，claude-host pod-open 续开，close 指路
  pod-close，--neutral-only 可跑中立半段）。git allowlist 增补 `worktree`。
  测试：test/wakeflow-pod.test.mjs（5 项：codex 计划形态/幂等、一仓一窗拒绝
  与 pool 上限、close 门与台账、claude 传输分流、claude-host 续开组合）。
- M2c：codex targetPolicy 改为"绝不叠加 Codex 侧 worktree 层；cwd 即
  Wakeflow 隔离 worktree 时直接绑定"。
- M3：wakeflow.config.example.json 外显 maxActiveDemands + hosts.*.
  maxStreamsPerRepo。
- M4：`test/wakeflow-parallel-vocabulary-lint.test.mjs` 落地（禁
  "parallel stream/波内并行/同仓多 stream"于 core/plugins/test/tools/README，
  docs/ 历史豁免；并钉双版 CLAUDE/AGENTS/governance/controller 的正典句在场）。
  deep-dive:120 的禁词 lint 声称自此为真。
- M5：demand-sequence 帮助文本讲明"序列=有依赖需求链（内部串行、归档后放行
  下一个）；跨需求并行在序列之外，受容量钳制"。
- 真机验证（2026-07-10，WakeWorkspace 实舰队）：双需求并排全周期通过——
  pod 0（cc-craft-utils：自动认领→组合包→craft 执行→评审→归档）与
  demand pod（cc-pod-slug：pod 总控自主认领、隔离 worktree RED→GREEN、
  Test__pod 在 worktree 内独立冷复跑、stream-close→pending-merges→归档、
  pod-close 清扫），主检出零跨需求污染。测试中由 pod 总控上报两个运行时
  缺陷（wakeflow-pod 未入 runtime 白名单；pod 窗口注册 fail-closed），
  已修复并以回归钉死（1c8bd74，0.8.2）。
- N 系：roadmap E-1/E-2/E-3 行与 Phase 3 总览加结局标注；scripts/README
  "group wave"→"dispatch group"（双版）；codex AGENTS.md 派发节补两条正典
  bullet（原 wave 节压缩句删除）；codex governance:117 兑现改写；codex
  stage-route-map §S3/S6 + 工具表补 pod 工具与关闭次序；codex controller
  SKILL 移植 "One Window Per Repo" 与 "Demand Pods" 两章（codex 语汇）；
  templates 双版 todo-window-scheduling-policy "Parallel work" 段重写为需求层
  模型；CC 侧 CLAUDE.md / controller SKILL / governance SKILL /
  stage-route-map / 双 README / dual-edition §7.6-7.7（双语）/ deep-dive
  §4.12 全部补"整套（含 Test）共用一套 worktree"句；根 README 补 codex 版
  pods 平价段；codex 插件双语 README 新增 Demand Pods 章。
