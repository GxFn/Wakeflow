# 正式工作区第一个 Demand 的观察与收敛方案（2026-11-09）

> 性质：观察记录加设计提案；裁决与节奏见 ADR-0026，登记见 `docs/references/open-items.md`。
> 现场：用户的正式工作区（桌面传输，根仓库加五个 Alembic 产品仓库），第一个 Demand"五个仓库统一
> Node.js 24 工具链底线（最低 24.22.2）"。Design 与 Controller 用 Fable 5.1（Controller 为 Max 档），
> 产品窗口用默认模型。维护者只读观察：配置、绑定、hook 记录、账本、状态投影与各会话的本地记录。
> 宿主：Claude.app 4.23118.0，Claude Code 2.1.303；Wakeflow 1.2.0（`ecdd20fb`）。

## 1. 发现

编号为 open-items 的预留编号，登记时沿用。

| 编号 | 严重度 | 现象 | 根因 | 处置 |
| --- | --- | --- | --- | --- |
| X27 | 高 | 带 `@` 的投递与回调落地后摘要对不上许可（`landing` 给 `landed: false` 加 `latestPrompt`），`record_delivery_outcome` 判 indeterminate，Controller 以 resolution 接受，每次多一步；不带 `@` 的投递（Dashboard）摘要相符 | 桌面 app 把跨会话消息里的每个 `@`（U+0040）折成全角 `＠`（U+FF20）以阻止 @ 提及，两段文本唯一的差别；Controller 写的边界里有 `@types/node`。会话记录里还能看到块外的框架文字（引语一行与一段说明），但 hook 拿到的 prompt 没有它，不是成因 | 1.2.1：`computePromptDigest`（内核，许可与 hook 共用）在摘要前把 `＠` 折回 `@`，宿主折不折都相等；剥壳改为不锚定作为加固；用抓到的真实信封与 `@` 文本做测试 |
| X28 | 中 | 桌面传输下配置的 `modelByRole` 只在开窗时以 `claude --bg --model` 生效，能否跨过 app 接管没有验证；桌面参考没有提模型 | 开窗路径是 `--bg` 起会话、app 接管；权限模式当时就没跨过去（L17） | 下一次重开窗口时验证；验证前文本只说"未验证" |
| G14 | 中 | 改一个角色的模型（reconfigure）会让 8 个窗口都显示 `launchIntent: drifted`（只是信息，但误导人去重开） | `launchConfigDigest` 把整个 `hosts` 块加账本根算进每个窗口的 `intentDigest` | 1.2.2：按窗口角色解析后的启动参数（模型、思考档、权限模式、传输、tmux 名）算摘要；reconcile 对"公式变了但启动命令没变"的绑定一次性迁移已登记摘要，避免升级后全部 drifted |
| H11 | 低 | 目标第一次 `import_target_result` 报 `concurrency-conflict`（许可里的流版本 7，实际 9），重试即过 | Controller 在投递后记录结果事件推进了流版本，这是正常顺序 | 1.2.2 评估：导入对不触及本目标的追加容忍版本漂移，或许可不再让目标断言流版本；文本先写明重试 |
| I16 | 低 | Design 写的标题"测试决定"预览不认，多一轮预览 | 别名表只有"测试决策" | 1.2.1：加别名 |
| I17 | 低 | 看板只有一个 pending 包时 Controller 直接认领，用户以为会被问 | 技能文本"与用户一起选"在单包时被模型视为已选 | 1.2.1：文本定为单包直接认领并告知，多包与用户选 |
| I18 | 低 | 用户把产品窗口的会话恢复（session-start）当成"收到投递" | 窗口外观分不出恢复与落地 | 1.2.1：Controller 投递后点名窗口与时间 |
| I19 | 低 | 技能与参考把 Codex 的"发送返回即接受"写成通用规则 | 代码里 `sendReturnProvesLanding` 只对 Codex 为真 | 1.2.1：两处文本改为 Codex 限定 |
| I20 | 低 | 预览的"一页摘要"约两屏 | 摘要按合同引完成定义与非目标全文 | 观察，不改 |
| I21 | 中 | 每记录一次评审决定 Controller 就结束本轮，Plugin 已可投递却要用户再发 `/wakeflow:next` | `commands/next.md` 的停点规则（批 A，V3 / Q10）把"每次发送、每次决定"定为停点，单目标时不显，多目标时空等 | 1.2.1：用户裁决改为连续——决定与结局是步骤边界，重读状态、只要点名 Controller 就继续；停点只剩 owner 变化且无自有工作、用户决定点、阻塞 |
| X29 | 中 | Plugin 窗口先去跑 tmux 助手发回调（桌面工作区里没有），91 秒后自己改用 app 的 send_message | `deliveryAction` 取值以 tmux 助手的用法开头，传输选择只隐含在回传段里 | 1.2.1：目标与测试技能的回调步先按传输选路并写明桌面下无 tmux 助手（Controller 技能 14 KiB 预算已满，取值不动）；1.2.2：回调许可的 hostAction 带 transport 与桌面会话 id |
| G15 | 低 | Controller 自产的核对日志两次触发隐私扫描（npm / tsc 输出带绝对路径），改写后通过 | evidence 参考已要求先替换为 `<workspace root>`，Controller 漏做 | 1.2.2 评估：`record_evidence` 加按工作区根脱敏的选项 |

非缺陷的观察：

- Controller 用 Fable 5.1 Max 档，每次工具调用之间思考 30 到 120 秒：认领到第一次投递 17.6 分钟，规划 5 个目标用 9 分钟，评审 Core 的 10 个文件超过 8 分钟；L23 用 Opus 整个 Demand 6.6 分钟。工具调用本身都在 1 到 3 秒。建议：Design 用 Fable；Controller 用 Opus，或 Fable 的 High 档。
- Controller 一轮规划完全部 5 个目标并写了 R4 依赖（Core、Dashboard 无依赖；Agent、Plugin 依赖 Core；Alembic 依赖其余四个），与 landing 的顺序一致；桌面 app 的"同伴消息"框架没有让实现窗口（Opus）犹豫。
- Design 在 15 分钟里读完五个仓库，找出两处维护者简报里没有的门禁（Core 的 `toolchainFloor` 与 Core / Agent 的逐字相等断言、Plugin 的子模块），并替用户定了七条边界，都正确。

## 2. 1.2.1 批（本阶段，正式工作区的 Demand 归档后部署）

- 代码：内核摘要折回全角 `＠`（X27）；观察器剥壳不再锚定整条消息（加固）；"测试决定"别名（I16）。
- 文本：SKILL.md 四处（单包认领 I17、Codex 限定 I19、投递后点名 I18、决定不停 I21）；`commands/next.md` 的停点改为连续（I21）；目标与测试技能的回调步先按传输选路（X29）；`delivery-and-review.md` 的 accepted 条目 Codex 限定（I19）；`desktop-transport.md` Step 8 点名信封成因（X27）。两份参考仍在 400 行、技能在 200 行的预算内。
- 验证：第 0 级逐文件先过；Demand 归档后第 2 级门 run-IRqpZG 1756/1756、`smoke:artifacts` 4/4、`wf handoff` 通过（§13.233）。
- 发布：`release bump --version 1.2.1`，重建即部署；正式工作区的 Controller 在下一次 `/wakeflow:next` 走插件更新路径。这是第一次在真实工作区上从一个 tag 版本升到另一个，也是 C6 / V6"真实版本升级后的更新检测"的第一个现场，结果记入 gate-log。

## 3. 1.2.2 批（紧随）

- G14 摘要粒度与迁移；X28 验证；H11；G15。
- A3 的第一步（宿主漂移可诊断）：hook 记录加 `rawPromptDigest` 与 `promptWrapper`（none / pasted-content / cross-session-message），绑定记录宿主版本（Claude Code 与桌面 app，由助手 `preflight` 读出），`landing` 一并输出——下次宿主再改信封格式，一眼看出是外壳不认识，而不是文字被改。

## 4. 高严重度存量的收敛路线（1.3 起，每个主题一个阶段）

1. **宿主漂移可诊断**（A3 / Y6、G1）：制品声明测过的宿主版本，`wakeflow_status` 与 doctor 在版本不在集合里时提醒；`unexpected` 信封带 id 并指向本地诊断文件；Controller 文本告诉用户去哪里拿原因。
2. **助手类型化**（D5 / Y5）：tmux 与桌面两个助手从 JS 字符串资产改为 TypeScript 源，由制品构建器编译为 `.mjs`，落地记录形状与拒绝码与运行时共享合同，纯级测试覆盖；X27 这类剥壳规则随之只写一份。
3. **信任边界**（F1 / Y7）：写威胁模型 ADR；助手资产只读，Controller 每次调用前核字节（现已投递前核对）；产品窗口的 hook 与设置范围写清。
4. **持久格式**（C3、C6 / V6）：从正式工作区的归档抽取脱敏的 golden 回放语料，reducer 回放等价测试；1.2.0 → 1.2.1 的升级作为 C6 的现场证据。
5. **存活与就绪**（B14、X17）：X17 已由 K2 改为 `list_sessions` 观察，待一次现场后关闭；B14 的残余用正式工作区的真实记录核对。
6. **待关闭**：X6 已由 K1 落地（pod 以检出为 cwd），等一次桌面 pod 现场后关闭。
7. **Codex**（E1）保持 preview，直到有 Codex 的真实使用者。

## 5. 节奏

按 ADR-0026：每批一道门、一次部署、一次 tag 加 `release:check`；1.2.1 等 Demand 归档；1.2.2 为下一阶段；1.3 的主题按上面的顺序，先做"宿主漂移可诊断"，因为 X27 就是它要防的那一类。
