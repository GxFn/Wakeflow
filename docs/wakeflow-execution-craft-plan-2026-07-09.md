# Wakeflow 三角色手艺契约闭环 —— Design / Target / Test 的技能重构与证据门补齐

> 生成于 2026-07-09（v2 全局重写，取代同日 v1「target A+B」草案）。以代码为准。
> 本文是 Design 阶段的需求设计，待用户拍板 §13 决策后进入控制器 intake。文件引用 `path:line`
> 为撰写时近似锚点，实施以真实代码为准。驱动来源：用户 2026-07-09 提供的四条真实生产痛点。

---

## 实现进度（2026-07-09，随开发更新）

**全部五个 Phase 的机制已落地并全绿（全量 323/323，双 edition 字节平价 + 双 smoke + 并发回归通过）。** 本节为准;下方原始设计里 `block/warn` 等措辞以此处为准（P3/P4 实际采用 reminder-first）。

- **P1 W-Restructure** ✅:`wakeflow-target-craft` plugin 技能（双 edition,借鉴 Superpowers 执行半场）+ 源图解冻并登记 target-craft 角色。
- **P2 W-Target** ✅:`evidenceContract`/`craftEvidence`(schema + intake + dispatch 携带,排除幂等外)、**`reduce-results` craft 硬门 `craft-evidence-required`**(仅 completed 强制、blocked 豁免、守在 evidence-repair 之后)、MCP 透传、`skillAssistanceText` 开发窗口声明 craft 技能;6 个 craft 测试 + 修复 `state.taskPackages` 镜像 bug。
- **P3 W-Design** ✅:`testDecision` 记录(init/create-demand/MCP)+ 缺省时 **并排提醒(reminder-first —— 用户裁定不设硬门,与「不算分不设门」信条一致)**;demand-create 测试。
- **P4 W-Test** ✅:test card `strategySource`(intake/MCP/schema)+ 缺省时 **提醒**「临场方案未经 Design 决策,挑战路径依赖」(痛点 #2 可见化,非硬门);intake 测试。
- **P5 联动** ✅:prepare-dispatch 在 `reworkCount ≥ 2`(recurringProblem)时 **提醒**「停止点修、回根因/转 redesign」(痛点 #1「打回是修正机会」的机制触发;完整停法在 craft 技能里)。

**散文批量已落地 + 版本已 bump 0.8.0（2026-07-09）:**
- ✅ 模板包散文(双 edition,幂等脚本追加,diff 干净):Design/Test 记忆文件排他句、`requirement-design` 测试决策必产出、`test-strategy` 反路径依赖。
- ✅ plugin 记忆文件(CLAUDE.md/AGENTS.md)控制器排他句(只用 controller/governance,不用代码手艺技能)。
- ✅ 版本五处一致 bump 至 **`0.8.0`**(marketplace `metadata.version` 保持 1.0.0）。
- 唯一剩项:review-pack B2 软提醒是**代码**增强(非散文);reduce 硬门已覆盖 required kinds,B2 只 surface advisory kinds——可选,留后续。

---

## 0. 一句话定位

把「让 agent 更会思考」的能力,**统一成一个模式补齐到三种窗口角色**:

> **每个角色 = 一个手艺技能(A，教怎么想）+ 一个契约(B，把该留的证据/该做的决定固定下来)；
> 契约在角色交接时向下游流动,让「本该在上游做好的事」到了下游不会被忘、也无法被临时拍脑袋绕过。**

这不是给 target 打补丁。真实痛点分布在三个角色和它们的交接处,所以方案是**全局的**:补齐 target 缺失的
手艺腿、现代化已冻结的 Design/Test 技能、并把 Design→Test 的测试方案交接**焊死**。方法论内容借鉴
成熟方案(Superpowers 及其它)但落成 Wakeflow 原生技能 + 原生契约,**不安装任何外部框架**(避免与
控制器争夺方向盘)。

---

## 1. 真实生产痛点 → 需求映射（本需求的根据）

| # | 用户真实痛点 | 本质 | 归属工作线 |
| --- | --- | --- | --- |
| 1 | 开发子窗口(target)**不思考、被多次打回**;打回是很好的修正机会 | target 缺执行手艺(L3 留白);且「反复打回」信号未被结构化利用 | **W-Target** |
| 2 | Test 窗口面对需求的测试方案有**路径依赖,选了错误的测试方案** | Test 在临场即兴选策略,缺「先质疑方案是否配得上风险」的手艺 | **W-Test** |
| 3 | 测试方案本应在 **Design 阶段做好,但现在会忘、无提示**,要更严 | Design 出口门的「测试决策」是散文约定,未被机械强制 | **W-Design** |
| 4 | 多借鉴 Superpowers 等成熟 Skills;Design/Test 已支持 Skills,**看起来需要重构** | 现有 Design/Test 技能源图已冻结(2026-06-08),落后当前架构 | **W-Restructure** |

四条痛点不是四个孤立补丁,而是**同一个结构缺陷的四个切面**:手艺(思考)没有被系统地装进每个角色,
角色间的关键决定(尤其测试方案)在交接时会蒸发。

---

## 2. 全局洞察：一个模式，三个角色，一条脊椎

### 2.1 A+B 模式对三个角色都成立

| 角色 | 思考失效模式（真实痛点） | A：手艺技能（教怎么想） | B：契约（把成果固定下来） |
| --- | --- | --- | --- |
| **Design** | 忘了定测试方案 / 需求含糊即执行 | 澄清·选项·需求设计·切片·交接(已存在,需现代化) | **出口门**:客观存在门 + 主观提醒 |
| **Target** | 不思考、薄实现、反复打回 | 测试先行·系统化调试·写后自审·YAGNI·完成前自验(**全缺**) | **客观证据契约** + 手艺提醒 |
| **Test** | 路径依赖、选错测试方案 | 风险策略·调试分诊·回归设计·证据评审(已存在,需强化) | **test card 结构字段**(已存在)+ 策略来源 |

### 2.2 两种技能分发机制（按窗口归属选对落点 —— 已核实纠正）

Wakeflow 的手艺技能有**两条分发路径,由「窗口是否 Wakeflow 自有」决定**(已落地核实):

| 窗口 | 归属 | 工作目录(cwd) | 技能分发方式 |
| --- | --- | --- | --- |
| Design / Test | Wakeflow **自有**支撑窗口 | 独立目录(`Design/`、`Test/` 或 ledger 下) | setup 把 `window-support/{design,testing}/` 整包(CLAUDE.md + docs + skills)**realize 进该目录**;窗口 cwd 即该目录,天然发现技能 |
| 开发 / target | **外部产品仓库**(AppWindow/ServiceWindow/…) | 产品仓库自身 | 只被注入 marker **scope block** 进 CLAUDE.md,**不落 skills 目录**;真正可用的技能是 **plugin 技能**(如 `skills/wakeflow-target/SKILL.md`,开发窗口加载 Wakeflow 插件即可读) |

现状(`templates/wakeflow-template-bundle.json`):
- `window-support/design/skills/`:requirement-clarification / option-planning / requirement-design /
  work-slicing / design-handoff(5 个,~27KB)——能被 realize,因为 Design 窗口目录是 Wakeflow 自有的。
- `window-support/testing/skills/`:test-strategy / debugging-and-triage / regression-design /
  evidence-review / progressive-chain-validation(5 个,含 ~9.7KB 大技能 + 8 份 references)——同理。
- **target 手艺技能:不存在**——但正确落点**不是** `window-support/product/`。开发窗口是外部产品仓库,
  realize 不进去、cwd 也不对、它发现不了。target 手艺必须走 **plugin 技能**路径,和 `wakeflow-target`
  同源分发,随插件到达每个开发窗口。

> **架构结论(纠正上一版)**:「三角色都有手艺」是**概念对称**,但**分发机制本就不同**——Design/Test
> 走 window-support(realize 进自有目录),开发窗口走 **plugin 技能**(不碰外部仓库)。不应硬凑三个
> window-support 目录。

### 2.3 契约跨交接流动（解决痛点 2+3 的脊椎）

三个角色的 B 不是各自孤立的,而是**沿交接向下游流动**——上游的决定变成下游的输入契约:

```
Design ──[出口门:测试决策是必填项]──▶ 交接把「测试方案」带进 handoff
                                          │
控制器 intake ──把 Design 决定的测试方案写进 test card 的 strategySource
                                          │
Test ◀──[card 要求 strategySource]── 执行「被决定好的方案」,而不是临场即兴选一个错的
```

**这条脊椎一次解决两个痛点**:痛点 3(Design 不能忘——出口门把测试决策设为客观必填)+ 痛点 2
(Test 不能即兴——card 要求策略来源,缺来源即可见地标记为「未经 Design 决策的临场方案」)。

---

## 3. 现状盘点（对齐真实代码 —— Design 出口门要求项）

| 能力 | 现状 | 缺口 |
| --- | --- | --- |
| Design 手艺技能 | 存在,源图 `design-test-skill-realization-source-map.md` **明确标注已冻结**(2026-06-08),落后于 23 工具 MCP / redesign 裁决 / deliver-only Design / demand pod | 需对齐当前架构 + 刷新借鉴源 |
| Test 手艺技能 | 存在(含 progressive-chain-validation);源图同样冻结 | `test-strategy` 缺「反路径依赖」手艺;`testing-validation.md` 已登记待现代化(见 roadmap GAP) |
| target 手艺技能 | **无** | 全新创建 **plugin 技能** `wakeflow-target-craft`(随插件分发到每个开发窗口) |
| 证据门 | 存在:`reduce-results` 对证据 ref 逐个 `existsSync`、缺失 `evidence-repair-required` 硬失败;`completed` 结果必须带证据 | 缺「手艺证据」维度(测试过没过、范围、commit) |
| test card | 存在:`wakeflow_intake_test_card` 已有 question/object-boundary/self-check/scenario/success/failure/cannot-conclude/stop-condition 结构字段 | 缺 `strategySource`(指向 Design 的测试决策) |
| Design 出口门 | 存在但**是散文**:CLAUDE.md「Design 出口门…含 Test decision + Test Environment Spec」 | 未机械强制,会被忘(痛点 3) |
| 反复打回信号 | 存在:`reworkCount>=2 → recurringProblem`(`wakeflow-review-commands.mjs`) | 未与 target 手艺/契约联动,打回没转成结构化修正(痛点 1) |

---

## 4. 目标架构

```
手艺技能(A)分发 —— 按窗口归属两条路径:
  Design/Test（Wakeflow 自有目录）  window-support/{design,testing}/skills/   ← setup realize 进窗口目录（现代化/强化）
  开发/target（外部产品仓库）        plugins/*/skills/wakeflow-target-craft/    ← plugin 技能，随插件到达每个开发窗口（新增）
  · A_design → B_design = 出口门(客观必填 + 主观提醒)
  · A_target → B_target = 客观证据契约 + 手艺提醒
  · A_test   → B_test   = test card 结构字段 + strategySource

core（host-neutral，契约层）
├── task-package / target-result schema  ← +evidenceContract / +craftEvidence（additive）
├── reduce-results / review-pack         ← +手艺证据校验（客观硬门）/ +手艺提醒（软）
├── create-demand / 出口门检查            ← Design 测试决策客观存在门
└── intake-test-card                     ← +strategySource（Design 决策来源）

信号联动：reworkCount>=2 → recurringProblem → target 手艺技能的「停止点修、回根因/转 redesign」升级
```

**两条纪律贯穿全局**(见 §7):硬门只卡**客观事实**,主观质量只**提醒不算分不设门**;证据强度**诚实分级**。

---

## 5. 四条工作线

### W-Target —— 补齐执行手艺(痛点 1)

**A:新增 plugin 技能 `wakeflow-target-craft`**(与 `wakeflow-target` 同源、随插件到达每个开发窗口;
可带 `references/` 承载详细方法,如 `wakeflow-governance` 那样;dispatch prompt 以
`skill: skills/wakeflow-target-craft/SKILL.md` 引入;借鉴见 §6),至少:
- `test-first`(测试先行,RED→GREEN)、`systematic-debugging`(复现→定位→改→回归)、
  `self-review`(交付前按严重度自审)、`scope-discipline`(YAGNI,只做 designIntent 范围)、
  `verify-before-done`(typecheck/lint/测试跑一遍,产出即证据)。

**B:客观证据契约**(core,additive):
- task-package 增可选 `evidenceContract { version, required[], advisory[] }`;target-result 增 typed
  `craftEvidence[]`;`reduce-results`/`review-pack` 在契约在场时校验,缺 required 硬失败
  `craft-evidence-required`,契约缺省则**逐字节零行为变化**。
- 每条 `required` 带 `verify` 模式(§7.2 强度分级)。

**痛点 1 的结构化利用——把「反复打回」变修正机会**:
- `reworkCount>=2 → recurringProblem` 已存在。联动:达阈值时 target 手艺技能**升级指令**——
  「停止点修;回到根因重新推导;若是非 bug 的结果失配,发 redesign 信号(既有逃生门)」;
  且可让 `evidenceContract` 追加一项 `root-cause-note`(第 3 次派发起要求根因说明)。
- 这不新增裁决、不改锁键,只是让既有 `recurringProblem` 信号驱动手艺升级(附加提醒 + 可选证据项)。

### W-Test —— 反路径依赖 + 现代化(痛点 2)

**A:强化 `test-strategy` + 现代化 Test 技能**:
- `test-strategy` 增「**反路径依赖**」小节:动手前先问「这个方案是不是因为『上次这么做』而来?它配得上
  本次的风险和问题吗?」——先质疑方案再执行(借鉴 `senior-qa` 的 risk-first + ISTQB 风险测试)。
- 按当前架构现代化(retestCount、redesign、evidence 契约),`testing-validation.md` 一并重写
  (roadmap 已登记的欠账)。

**B:test card 增 `strategySource`**(core,additive `wakeflow_intake_test_card`):
- 指向 Design 的测试决策(requirement-design 的 testing decisions / test-strategy 产出)。
- 缺 `strategySource` → card 可见地标记「临场方案,未经 Design 决策」——不硬拦(留急用逃生),但在
  review/dispatch 输出并排提醒,把「即兴选错」从静默变可见(复用意图对齐的提醒模式)。

### W-Design —— 出口门焊死测试决策(痛点 3)

**核心:把 Design 出口门的「测试决策」从散文升级为客观存在门**(和「不设主观门」不冲突,见 §7.1):
- 在需求进入首次实现派发前,检查 requirement-design 的 **testing-decision 字段存在且非空**(需要真实
  场景 Test 时,还要 Test Environment Spec 存在)。缺失 → **block/warn**(客观存在检查,不判断方案好坏)。
- 落点:`create-demand` / Design 出口门检查脚本(与既有容量门、意图对齐提醒同一族)。方案**是否好**仍是
  Agent 判断(提醒),存在**与否**是机械门。
- A 侧:`requirement-design` 技能把 testing-decision 提为必产出小节(源图早有此意,只是未强制)。

### W-Restructure —— 解冻源图,按当前架构 + 新源重导(痛点 4)

- **解冻 `design-test-skill-realization-source-map.md`**:去掉 FROZEN 标注,按当前架构(23 工具、
  redesign、deliver-only Design、demand pod、evidence 契约)重导每个技能的角色边界与验收。
- **统一 craft+contract 模式**:三个角色的技能都按同一模板(name/description/source/role/workflow/
  allowed/forbidden/handoff/quality-bar/**对应的 B 契约**)组织,让「手艺 ↔ 契约」在每个角色内咬合。
- 保留源图的「删/改/并矩阵」与「角色完整性矩阵」——重构标准仍是**完整能力,不是更少文件**。

### 各窗口 Skill 边界声明（横切四条工作线，写进每个窗口的记忆文件）

原则:每个窗口的记忆文件(CLAUDE.md / AGENTS.md,双 edition)必须**显式声明「我用哪些技能」+「我不用
哪些技能」**——把边界从隐性约定变成写在盘上的规则。现状核实:Design/Test 已声明自己的技能(缺排他句),
开发窗口的 scope block 还没有手艺技能。

**边界矩阵:**

| 窗口 | 记忆文件 | 用的技能 | 不用的技能(排他) | 声明落点 | 现状 |
| --- | --- | --- | --- | --- | --- |
| 总控 Controller | plugin `CLAUDE.md`/`AGENTS.md` | `wakeflow-controller` + `wakeflow-governance` | 不用 Design/Test/target-craft(不写产品代码) | `## Skill And Rule Layers` | 有引用图,**缺排他句** |
| Design | `window-support/design/CLAUDE.md`(+AGENTS.md) | requirement-clarification / option-planning / requirement-design / work-slicing / design-handoff | 不用 Test 技能、不用 `wakeflow-target-craft` | `## Skill Routing`(已有 map) | 有 map,**缺排他句 + 出口门强调** |
| Test | `window-support/testing/CLAUDE.md`(+AGENTS.md) | test-strategy / debugging-and-triage / regression-design / evidence-review / progressive-chain-validation | 不用 Design 技能、不用 `wakeflow-target-craft` | `## Skill Routing`(已有 map) | 有 map,**缺排他句 + 反路径依赖/strategySource** |
| 开发子窗口 | 产品仓库 `CLAUDE.md`/`AGENTS.md` 的 scope block | `wakeflow-target`(协议)+ **`wakeflow-target-craft`(手艺,新)** | 不用 Design/Test 窗口内置技能 | `### Skill Assistance`(`skillAssistanceText()` 生成) | **只有协议,缺手艺技能声明** |

**要写进各记忆文件的确切内容(双 edition 镜像;host 专有词经 `hostProfile.texts`,不进 core 硬编码):**

1. **开发子窗口(核心新增)**——扩展 `core/scripts/wakeflow-setup.mjs` 的 `skillAssistanceText()`,给
   非 Design/非 Test 的产品窗口追加一行:「执行开发使用 plugin 手艺技能 `wakeflow-target-craft`
   (测试先行/系统化调试/写后自审/范围克制/完成前自验),按 dispatch 的 skill 指针引入,它教你攒下证据
   契约要求的证据;本窗口**不使用** Design/Test 窗口的内置技能。」
2. **Design 窗口**——`## Skill Routing` 末尾加:「Design **只用**上述 Design 技能;**不使用** Test 技能与
   `wakeflow-target-craft`。requirement-design 必须产出明确 testing decision——出口门客观必填,缺失则
   首次实现派发被拦。」
3. **Test 窗口**——`## Skill Routing` 末尾加:「Test **只用**上述 Test 技能;**不使用** Design 技能与
   `wakeflow-target-craft`。测试方案来源是 Design 决策(test card 的 `strategySource`);动手前先质疑方案
   是否配得上风险,不因『上次这么做』而路径依赖沿用。」
4. **总控**——plugin `## Skill And Rule Layers` 加:「总控**只用** `wakeflow-controller` +
   `wakeflow-governance`;**不使用**任何代码手艺技能——总控是验收权威,不写产品代码。」

**时序**:第 1 条(声明 `wakeflow-target-craft`)在 **P2** 随该技能落地一起写入(避免声明不存在的技能);
排他句 + Design/Test 强调随 **P1/P3/P4** 各自 wave 写入。每条 DoD 含「双 edition 记忆文件核对」。

---

## 6. 借鉴来源刷新（痛点 4 的联网调研结果）

**原则**:借鉴**方法内容**,落成 Wakeflow 原生技能,受 Wakeflow 契约约束;**不安装外部框架插件**。

| 角色 | 主要借鉴源（新增 / 保留） | 行业基准（保留） |
| --- | --- | --- |
| Design | Superpowers `brainstorming`/`writing-plans`;mattpocock `grill-me`/`to-prd`/`to-issues`;vadimcomanescu `feature-design-assistant`/`senior-architect` | ISO/IEC/IEEE 29148、INVEST、Double Diamond |
| Target(新) | Superpowers `test-driven-development`/`systematic-debugging`(root-cause-tracing、defense-in-depth)/`verification-before-completion`/`requesting-code-review`;mattpocock `tdd`/`diagnose` | 测试金字塔、Google code review |
| Test | vadimcomanescu `senior-qa`;Superpowers `systematic-debugging`;mattpocock `diagnose`;既有 `progressive-chain-validation` | ISTQB 风险测试、测试金字塔、SRE 症状/病因、Google/Mozilla flaky |

新调研补充:Superpowers 已成社区最大技能库(约 40.9k stars),其执行半场
(`test-driven-development`/`systematic-debugging`/`verification-before-completion`)成熟度高,是
**Target 手艺**最直接的蓝本;Antigravity Awesome Skills(1234+ 通用 `SKILL.md`)可作二次比对来源。
选取标准仍是源图的「保留不可替代的方法判断,而非确认下载过的技能名」。

---

## 7. 两条贯穿纪律

### 7.1 硬门只卡「客观事实」，主观质量只提醒、不算分、不设门

复用意图对齐 F1+F2 既定裁定(机制零分数零门禁,判断归 Agent)。对齐点:
- **客观存在/通过**是事实,可设硬门——「测试文件在不在、跑没跑过、typecheck/lint 干不干净、改动越没
  越界、commit 有没有、testing-decision 字段在不在」。这与既有证据门同源(`reduce-results` 本就对缺失
  证据硬失败)。
- **主观好坏**是判断,只走提醒——「代码写得好不好、测试方案选得对不对、是不是真 test-first」。附加式
  出现在 review/dispatch 输出,**不算分不设门**,判断归 Agent,要打回走既有 `rework`/`redesign`。

> 痛点 3 的「更严」= 客观存在门(测试决策在不在),**不是**主观质量门(测试决策好不好)。这样既满足
> 「更严」,又守住「不设主观门」。

### 7.2 证据强度诚实分级（沿用 readback 的诚实文化）

| verify 模式 | 证明了什么 | 何时用 |
| --- | --- | --- |
| `controller-rerun` | 控制器复跑,证「**确实**过」 | 控制器可安全自验的仓库(CLAUDE.md 授权的轻量检查) |
| `artifact-present` | target 声称过 + 留了输出,`existsSync` 校验工件在 | 控制器跑不动的仓库(**不因此新增窗口**,直接降级) |
| `self-attested` | 仅声明,入审计链不证真 | 无法从工件可靠证明的过程(如「是否真先写测试」) |

不新增窗口是硬约束——控制器跑不动的仓库降级 `artifact-present`,不上升为 Test 窗口。

---

## 8. 分阶段落地

| Phase | 工作线 | 内容 | 规模 | 完成定义（可证伪，摘要） |
| --- | --- | --- | --- | --- |
| **P1** | W-Restructure | 解冻源图 + 定统一 craft+contract 模板 + 立 `wakeflow-target-craft` plugin 技能骨架 | S | 源图去 FROZEN、模板确定;开发窗口能加载 craft 技能;smoke 不变 |
| **P2** | W-Target | product 手艺技能(A) + `evidenceContract`/`craftEvidence`(B) + reduce/review 校验 | M | 契约在场→校验可硬失败;缺省→零行为变化;并发/版本平价全绿 |
| **P3** | W-Design | 出口门 testing-decision 客观存在门 + `requirement-design` 提为必产出 | S | 缺测试决策→首派发前 block/warn;字段在→零摩擦;主观质量仍走提醒 |
| **P4** | W-Test | `test-strategy` 反路径依赖 + test card `strategySource` + testing-validation 现代化 | M | 缺 strategySource 的 card 可见标记;Test 技能对齐当前架构;真机路径依赖反例被拦提醒 |
| **P5** | 联动 | `recurringProblem` 驱动 target 手艺升级 + 可选 `root-cause-note` | S | reworkCount≥2 触发升级提醒;第 3 派发起要求根因说明(可配置) |

每 Phase 遵循 wave 纪律:core 只写 `core/`、散文双写;`npm test`(check:core 字节平价 + 双 smoke);
测试随 wave 落地;**版本五处一致 bump**(`test/wakeflow-version-parity.test.mjs`);真机验收留证。
建议目标版本 **0.8.0**(手艺闭环整体作为一个能力波)。

---

## 9. 非目标（红线）

1. **不新增窗口**(不做独立评审窗口;控制器跑不动的仓库降级 `artifact-present`)。
2. **不引入代码质量分、不设任何主观门**;主观质量只走提醒(复用「不算分不设门」)。
3. **不安装 Superpowers 等外部框架**——只借鉴内容,落成 Wakeflow 原生技能。
4. **additive-only**:不改 reducer 全量语义 / `decide-review` 裁决枚举 / 锁键 / targetTaskId 方案 /
   `sameTargetDescriptor`;权威工件保持 `additionalProperties:false`,信封用 `true` 扩展。
5. **不改并行模型**:需求内每仓一窗口一组合包、窗口自排序(用户裁定不动)。
6. **不把执行手艺塞进控制器判断**(控制器不当 linter)或 Design(Design 不写代码);手艺活在各自窗口。
7. **不删既有能力**:progressive-chain-validation 等重技能只强化不删(遵源图「完整能力」标准)。

---

## 10. Test 决策

- 本需求自身**默认不需要真实场景 Test 窗口**:契约校验落在控制器可自验的轻量检查 + 工件 `existsSync`;
  技能与门是散文/脚本改动,走控制器自校验 + dogfood。
- **Test Environment Spec**:仅当 P2 的 `controller-rerun` 项在某仓库实际跑不动时,为该仓库声明可跑
  环境;本需求接线不假定外部环境。
- 讽刺但正确的自证:本需求正是要修「测试决策会被忘」——所以**本需求自己的 requirement-design 必须
  带一节明确的 testing decision**(dogfood W-Design 的出口门)。

---

## 11. 真机验收（可证伪定义）

1. **W-Target**:派发带 craft 契约的真实任务 → 交付含失败测试 commit 早于实现、测试通过、self-review
   工件、diff 限定在 designIntent;控制器 `controller-rerun` 真复跑通过;**漏交测试 → 硬失败
   `craft-evidence-required` → rework**;doc-only 空契约零摩擦;旧式无契约任务逐字节零变化。
2. **W-Design**:构造一个需要 Test 但 requirement-design 未填 testing-decision 的需求 → 首次实现派发前
   **被出口门拦下**;补齐后放行;方案好坏不被机械判定(仅提醒)。
3. **W-Test**:构造一个「路径依赖错误方案」的 test card(无 strategySource)→ dispatch/review 输出
   **可见提醒「未经 Design 决策的临场方案」**;带 strategySource 的 card 零提醒。
4. **联动**:同一任务 reworkCount 打到 2 → target 手艺升级提醒出现;第 3 派发起要求 root-cause-note。
5. **W-Restructure**:源图去 FROZEN 后,每个技能能对上当前工具/裁决词汇;setup 展开三条 window-support
   腿;双 edition 技能核对一致。

---

## 12. 风险清单（含对策）

| 风险 | 对策 |
| --- | --- |
| 重构面过大,一次吞不下 | 五 Phase 切分,P1 先立模板与骨架;每 Phase 独立可交付、独立真机验收 |
| 契约膨胀成打卡表 | 硬门只卡客观二值事实 + `controller-rerun` 优先(证真不认自述);主观走提醒 |
| Design 出口门变「主观质量门」跑偏 | 严格限定为**字段存在门**(testing-decision 在不在),好坏仍归 Agent |
| Test `strategySource` 被硬拦阻断急用 | 缺来源**不硬拦**,只可见提醒(留逃生);真需要 Design 决策时走 redesign |
| 现有重技能(progressive-chain)被误删/削弱 | 遵源图「删/改/并矩阵」——删逻辑需列明理由,强化不删 |
| 双 edition 散文漂移 | 每 Phase DoD 含双 edition 技能核对;host 词不进技能 |
| `evidenceContract` 与既有 `evidenceRequired` 语义重叠 | P2 先厘清:`evidenceRequired`=产出物清单,`evidenceContract`=手艺证据 + verify 方式;必要时收敛一处 |
| 提醒疲劳 | 提醒严格条件化:仅相关字段在场才出现、一句话、缺省零痕迹 |

---

## 13. 待确认决策（Design 出口门 —— 请用户拍板）

1. **范围与节奏**:五个 Phase 一次立项分波推进,还是先做 W-Target + W-Design(直接止痛 1、3)、
   W-Test/W-Restructure 随后?建议:P1+P2+P3 先行一波(止血 + 立骨架),P4/P5 第二波。
2. **target 手艺技能落点**(已澄清:走 **plugin 技能**,不是 `window-support/product/`——开发窗口是外部
   产品仓库,realize 不进去):新建独立 plugin 技能 `wakeflow-target-craft`(建议,边界清、可被 dispatch
   选择性引入),还是并进现有 `wakeflow-target` 协议技能的一个小节 / `references`?
3. **Design 出口门严格度**:testing-decision 缺失是 **block(硬)** 还是 **warn(软)**?
   建议:需要真实场景 Test 的需求 → block;纯自验需求 → warn。
4. **硬门项**:target 的 `required` 默认含哪些?建议 `tests`+`change-scope` 硬门,`lint`/`typecheck`
   默认提醒、可按仓库升硬门;bug 类加「复现 + 回归测试」。
5. **Edition**:三条工作线的散文双写,还是 Claude 先行、Codex 随后?建议双写(手艺 host-neutral)。
6. **`evidenceContract` vs `evidenceRequired`**:并存还是收敛?建议 P2 并存、观察后再定收敛。

---

## 14. 一页总览

```
洞察   一个 A+B 模式 × 三个角色(Design/Target/Test)+ 契约跨交接流动
痛点   1 target 不思考多打回 · 2 Test 路径依赖选错方案 · 3 Design 忘定测试方案 · 4 技能需重构
架构   Design/Test 走 window-support(realize 进自有目录);开发窗口手艺走 plugin 技能 wakeflow-target-craft
脊椎   Design 出口门(测试决策必填)→ handoff → test card strategySource → Test 执行既定方案
纪律   硬门只卡客观事实 · 主观只提醒不算分不设门 · 证据强度诚实分级 · additive-only
借鉴   Superpowers 执行半场 + mattpocock/vadimcomanescu/senior-qa + ISO/INVEST/ISTQB/测试金字塔
落地   P1 重构骨架 → P2 target A+B → P3 Design 出口门 → P4 Test 反路径依赖 → P5 打回联动;目标 0.8.0
红线   不加窗口 · 不设主观门 · 不装外部框架 · 不改裁决/锁键 · 不删既有重技能
```
