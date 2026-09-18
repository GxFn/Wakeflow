# 第十片 observation 的图谱更新

> 状态：图谱更新完成；验证结果见下表，未运行的门已逐项列出。
> 依据：代码基线 `1480271ecc8a6c17bb9042321644402bd6cbda56`（2026-09-18 核验）与该提交的实际源码、Schema 与测试文件。上一轮九片记录见 [九片更新记录](./l1-nine-slices-refresh.md)。

## 范围

新增 `maps/16-observation/`（专题总览、文件直接导入、三条运行调用链），并按新基线订正受影响的旧图：

| 文档 | 订正内容 |
| --- | --- |
| `maps/01-overall-architecture/README.md` | 停止节点“未实现：全局 observation”改为已登记的只读观察节点，`E-L1001-07` 重新指向 `executeStatusRequest`；目录 19 → 20 项，九片 → 十片 |
| `maps/09-public-mcp-host-seams/README.md` | 19 → 20 工具；新增只读边 `E-L1038-08`；补 Claude Code 两个状态栏维护操作；删除“status/verify 尚未公开”的结论 |
| `maps/11-kernel/README.md` | 新增内核 active-projection 节点与 `E-L1046-07`，写明锁内 CAS、整轮零写与页目录退休边界 |
| `maps/15-pod/README.md`、`runtime-call-flow.md` | `derivePodState` 随实现迁到 `src/governance/pod/pod-state.ts`；补 worktree 处置建议；全局 Pod 视图不再写成待 observation |
| `maps/07-review-rework-completion/file-dependencies.md`、`runtime-call-flow.md` | verify 门迁入 `src/governance/demand/demand-verify-gates.ts`，导入链与符号定位随之订正（新增 `E-L1030-17`） |
| `maps/03-configuration-workspace/README.md`、`maps/10-end-to-end-business-flow/*` | 去掉“observation 未开始”的停止表述；场景表补两条 card-09 |
| `maps/README.md`、`maps/01-diagram-review-ledger.md`、`README.md` | 基线、计数、索引与台账行 |

全部 46 份既有文档的基线说明、`baselineCommit`、`verifiedAt` 与来源指纹按新基线重算；已删除的 `src/workspace/active/*.ts` 与两个 controller-route Schema 从来源清单中移除。

## 关键语义变化

| 原图表达 | 本次按代码更新 |
| --- | --- |
| 目录尚无 status 与 verify | 两个只读工具已登记，公共目录 20 项 |
| 全局观察未开始 | `observeWorkspace` 逐域观察一次，失败隔离为 unavailable |
| 活动投影只有局部 | 内核 `active-projection` 渲染人读页面，变更后统一刷新 |
| `wakeflow_inspect_demand_route` | 随 `wakeflow_status{demandId}` 的 Route 段删除 |
| Pod ready 由能力层派生 | 派生函数移入治理层 `pod-state.ts`，能力层再导出 |
| 完成前 verify 只在 Demand 切片 | 门移入治理层，`wakeflow_verify{demandId}` 复用同一份 |

## 保留的实际限制

status 与 verify 只读：不追加事件、不改配置、不创建会话，也不代表 Controller 验收。活动投影是导航面，任一目标不安全时整轮零写，退休只针对每个文件都带标记的页目录。Claude 状态栏只核对了资产生成与两个维护操作的代码与单元测试，未在真实会话里观察过渲染结果。配置仍 v3；L2 真实宿主投递、L3/E4 制品切换仍未开始。

## 本轮交付与验证

| 项目 | 结果 |
| --- | --- |
| 图谱覆盖 | 51 份 maps 文档，72 张 Mermaid 图；16 个专题（`check:structure` 的必备专题清单同步加入 `16-observation`） |
| 来源核验 | `npm run check:current` 的结构、引用与链接检查全部通过：51 份文档、182 条 AST 直接导入、327 处符号引用、502 行邻接边证据、252 个链接；**来源指纹例外**——并行任务仍在改 `src/` 与 `tests/`，49 份指纹报漂移，本轮不刷新摘要值绕过门（见下文"证据锚点订正"一节与本表"图谱门"行） |
| 计数清点 | 公共登记表 20 项、`src/contracts/schemas` 95 份、场景登记 18 条，均按当前源码清点 |
| 根代码门 | 未运行。共享工作树里有其它任务的构建锁与未提交改动，本轮不跑根 `npm test`、场景套件与发布检查；`1480271` 自述的 880 项测试未在此复验 |
| 图谱门 | `npm run check` **退出码 1**：8 项检查器/阅读器回归（11 项测试全过）、阅读器类型检查、测试证据严格门、`check:diagrams` 72/72 回执复验与 Vite 构建都通过，唯一失败项是上面那 49 份来源指纹漂移；保留原有大型 chunk 警告，未放宽预算 |
| 实际渲染 | 应用内浏览器按锁定 Mermaid 11.17.2 打开本地验证页，实测渲染 72/72 全部 pass，并保存新回执；`check:diagrams` 按逐图源码摘要复验通过 |
| 未执行 | 真实宿主会话、状态栏实跑、L2 联合、新插件发布与切换 |

本轮检查结果留档：[图谱检查摘要](./evidence/l1-observation-validation.json) · [实际浏览器渲染回执](./evidence/l1-nine-slices-render.json)。阅读检查：新专题三页与被订正的四页在应用内浏览器打开，主路径、节点到证据定位、状态标签与下钻链接均已查看；依赖页的交互依赖图显示 13 个文件、17 条关系，与文件表一致。

## 工作树状态说明

核验时工作树含并行任务的未提交改动（宿主 hook 通道观察、提示摘要、配置 v3 增补等）。这些改动不在任何图中；图只描绘 `1480271` 已提交的实现。由于来源指纹按工作树内容计算，并行任务继续修改同一批文件时指纹会再次漂移，需要按实际差异重新核验，而不是只刷新摘要值。

## 追加一轮：测试证据锚点订正与测试列交叉校验

只读复核发现 `maps/16-observation/` 的“测试 / 核验”列存在两类假证据：同名推定与张冠李戴。检查器
当时只校验代码列的 `文件#符号`，测试列写什么都不查，所以绿灯掩盖了它们。

| 订正 | 事实 |
| --- | --- |
| `afterMutationRefresh`、`refreshActiveProjection`、`refreshActiveProjectionQuietly`、`buildActiveProjectionFacts`、`ActiveProjectionPublicationReceipt` | 五个符号在 `tests/` 下零出现；另有 `locateLatestDemandArchive`、`gateFacts` 同样零出现。按实情改为锚定真实跑到的测试，或标 `间接覆盖：` / `未覆盖：` |
| `E-L1069-02` | `WAKEFLOW_PUBLIC_MCP_EXECUTOR_FIELDS` 只在 `tests/entrypoints/wakeflow-public-mcp-catalog-binding.test.ts` 里被用到，路径改正 |
| `E-L1070-03` | `evaluateVerifyGates` 只被 `tests/governance/demand/demand-research-completion.test.ts` 引用，改锚该文件 |
| `E-L1071` 的 mutate 节点 | `afterMutationRefresh` 本基线有八个调用文件、十三个调用点；节点表写明 pod 切片只是代表，并列出全部八个文件 |
| `E-L1068-13`…`E-L1068-17` | 没有任何测试直接导入 `active-projection-facts.ts` 与 `active-projection-refresh.ts`，改标间接覆盖 |
| `E-L1071-07` | io-failure 被静默吞下这条路径当前没有任何用例，标 `未覆盖：` 并写明原因 |

检查器随之扩到测试列：`scripts/atlas-validation.mjs` 新增 `testIndex`（按 AST 索引测试文件真正用到的标识符，
注释里出现不算），`validateReferences` 对 `tests/…#symbol` 与 `src/…#symbol` 一视同仁，`validateTestEvidence`
按表头定位“测试”列并要求锚点或显式标记。文档在 frontmatter 声明 `testEvidence: anchored` 后强制执行，
未声明的文档把未锚定行计入报告的 `testEvidence.unanchored`。本轮结果：三份 observation 文档全部锚定，
47 处测试符号被交叉校验，全图谱 495 行证据里仍有 450 行只写测试文件名——这是尚未关上的缺口。

本轮检查：`node --test scripts/*.test.mjs` 11 项通过（新增 3 项）、阅读器类型检查通过、`check:diagrams`
72/72 通过（未改动任何 Mermaid 源码，沿用既有浏览器回执）、Vite 构建通过；`npm run check` 退出码 1，
唯一原因是并行任务继续修改 `src/` 与 `tests/` 导致 49 份来源指纹漂移，本轮不刷新摘要值。结果留档：
[锚点订正检查摘要](./evidence/l1-observation-test-anchors.json)。
