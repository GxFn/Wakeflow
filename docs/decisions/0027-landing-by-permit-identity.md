# ADR-0027 落地按许可身份判定，整段摘要降为完整性事实

> 状态：`accepted`
> 提出日期：2026-11-09
> 裁决日期：2026-11-09（用户按收敛方案 §4.1 的方向指示开始 1.3）
> 基线提交：`d8e89099`
> 相关：ADR-0012（投递与回调）、ADR-0025（双传输）、gate-log §13.223 / §13.227 / §13.232、open-items A3 / X25 / X27、`docs/reviews/2026-11-09-formal-first-demand-findings-and-convergence-plan.md` §4.1

## 背景

- 投递与回调是否落地，由目标会话的 `user-prompt-submit` hook 记录证明：记录里 prompt 的摘要等于许可的 `promptDigest`（§13.97 D3）。摘要覆盖整段文本，一个字符不同就不相等。
- 文本要经过宿主才到达会话，而宿主会改它。两周内三次：桌面 app 在接手后的第一回合把 system-reminder 拼在前面（L18，§13.223）；经工具参数转发时反斜杠转义被解码（X25，§13.227）；跨会话消息里的 `@` 被折成全角 `＠`（X27，§13.232）。每次都是摘要对不上、投递落入 indeterminate、现场排查一轮，再给摘要规则或渲染器补一条规避。
- indeterminate 之后的出路是 Controller 的显式解决：引用目标会话里那条摘要不同的记录、记为 accepted。文本要求它"不得重发、凭这条记录裁决"。这一步并不核对内容——Controller 看不到会话收到的文本——所以它只是把一个确定的事实（这条 prompt 到了那个会话）多绕了一轮人工。
- 目标技能已经规定任务包高于 prompt 的措辞：包是不可变的权威，prompt 只是带路。

## 问题

"这条 prompt 到了那个会话"与"到达的文本一字未改"是两件事，现在被一个摘要同时回答。前者是状态推进需要的事实，后者是值得知道的观察。把它们绑在一起，宿主每多一种改字的方式，Wakeflow 就多一次现场故障。

## 决定

1. **许可身份行。** 每条投递 prompt 与回调 prompt 的最后一行是 `- permitId: <id>`：投递是它的 `deliveryId`，回调是它的 `callbackId`（两者都是 `target-delivery_` 类型标识）。它由 Wakeflow 渲染，放在最后一行：文本被截断时它就不在了。
2. **观察器记录身份。** hook 观察器在解包宿主外壳之后，按行抽出 `- permitId:` 行里的标识（至多 4 个），记进 `user-prompt-submit` 记录的 `promptPermitIds`；同时记下摘要所覆盖文本的字符数 `promptCharacters`。记录仍然不含消息正文。目标报告的摘要等不可信文本在 prompt 里是单行 JSON 字面量，造不出一行以 `- permitId:` 开头的文本。
3. **落地判定。** 目标会话在许可签发之后的 `user-prompt-submit` 记录：
   - 摘要等于许可的 `promptDigest` → 已落地，证据种类 `hook-record`（文本完整）；
   - 否则 `promptPermitIds` 含该许可的标识 → 已落地，证据种类 `hook-record-identity`（文本被宿主改动）；
   - 都没有 → 与现在相同（Codex 的发送返回、indeterminate 与 Controller 的显式解决都不变）。
4. **完整性是事实，不是门。** `hook-record-identity` 与 `hook-record` 同样推进状态。Controller 在回报里告诉用户哪次投递的文本被宿主改动；目标照旧以任务包为准。不为它加阻塞、确认或重发。
5. **回调同一规则。** 回调的落地（评审单元的 `callbackLanding`、回调重发的静默判断）按摘要或身份认定；决定记录里的 `callbackLanding` 形状不变。
6. **助手与服务同一判定。** 两个助手（tmux 的 `deliver`、桌面的 `landing`）从许可的 prompt 文件读出身份行，按同样的两步查记录，输出里用 `match: "digest" | "identity"` 说明是哪一种。桌面的 `landing` 改为接收 `--prompt-ref`（仍接受只给 `--prompt-digest` 的旧用法，那时只按摘要）。
7. **向前兼容。** 没有 `promptPermitIds` 的旧记录只能按摘要匹配。`hook-record-identity` 是投递结局记录里新的证据种类取值：含它的 Demand 不能被 1.2 及更早的版本读取，与此前每次给持久记录加字段相同。

## 后果

- 宿主今后再以新的方式改动文本，投递与回调照常落地，结局记录如实标出"文本被改动"，由维护者事后查因；不再需要现场补规则才能继续。X27 的 `＠` 折回与 X25 的免转义渲染保留——它们让常见情况保持"文本完整"。
- Controller 的显式解决只剩真正不确定的情形：会话里既没有摘要相符、也没有带身份的记录。
- 接受语义变宽：一条带着许可标识、但文本被改动的 prompt 会被自动接受。此前这种情形由 Controller 不核对内容地手工接受，变化的是少了一轮人工，不是少了一道检查。
- 用户在目标窗口里手工粘贴投递 prompt（哪怕改过）也会被认作落地；这与摘要规则下原样粘贴被认作落地是同一性质。
- hook 记录多两个可选键；结局记录、聚合状态与两份公共结果 Schema 的证据种类枚举多一个取值；回调 prompt 多一行；投递 prompt 的派发记录多一行。

## 未决问题

- ~~`promptCharacters` 目前只进记录与助手输出，没有进公共工具结果；要不要让结局结果直接给出"许可多少字符、收到多少字符"。~~ **已定（1.3.0 批 2，gate-log §13.239）**：结局结果在引用了落地记录时给出 `landing: { permitCharacters, recordCharacters }`；只在结果里，不进已存的结局记录。
- 宿主若把一条消息拆成多次提交，身份行只在最后一段里：那时按现在的规则落地，前面几段的记录没有身份。尚未见过这种行为。
- Codex 的 `turn-complete` / 发送返回路径不经过这条规则；Codex 的真实会话验证仍待 E1。
