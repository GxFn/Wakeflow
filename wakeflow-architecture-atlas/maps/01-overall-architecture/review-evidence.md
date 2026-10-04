# 当前审阅范围与验证来源

**2026-10-03，1.1.0-rc.5 候选。** 提交基线为 `d8fafff3` 加已审阅的未提交实现。本轮从 rc.4 开始，因此目录保留 `review-2026-10-03-rc4` 名称；rc.3 与 Oct2 报告均属于历史。

| 范围 | 本轮方法 | 当前结论 |
| --- | --- | --- |
| 360 个运行时 + 10 个工具手写 TS | 7 个变更文件完整语义重审；363 个按实际选中旧记录的同字节 SHA 递归继承 | [370 条唯一记录](../02-file-review-index.md)，缺项、重复、非 semantic、来源漂移均为 0 |
| 95 Schema + 95 生成 TS | 独立库存、一一配对、读取相关合同及消费者；生成门执行来源另列 | 不重复计为手写语义重审，不声称全部逐行复审 |
| 297 tests/fixture/support | 当前 AST 复验定位，重点测试核对具体断言；旧断言不可继承的限制继续保留 | 1106 条带符号关联、582 条仅文件关联；不能由定位推断所有分支已测试 |
| 静态导入 | SWC AST 枚举 465 模块、3347 条仓库内直接关系，含 type-only | 不当作运行时调用顺序或副作用证据 |
| 76 份 maps、100 张 Mermaid | 本轮新增 5 页、10 图；逐边源码、测试范围与真实 GFM 证据表检查，100/100 浏览器实际渲染 | 渲染证明图可呈现，不替代业务路径执行 |
| 后态行为探针 | 本线程分支执行并由主代理独立复跑隐私、并发和回调三组探针 | 前态与后态分开保存，不改写失败证据 |
| 根 gate 与制品 smoke | 读取开发线程持久日志，并独立核对真实脚本链和候选 manifest 摘要 | 有当前候选对应的执行记录；不是本线程重跑根 gate |
| 原生宿主 | 日志中 rc.4 原生证据保留为历史 | rc.5 候选原生会话未验证；不能用 smoke 或 hook 摘要代替 |
| FigJam 17 个重点视图 | 160 节点、158 条边与当前源图对照；8 面板本轮截图、9 未变面板继承 rc.3 已检截图 | 派生阅读面，截图来源与继承范围单独记录 |

[覆盖报告](../../plans/review-2026-10-03-rc4/review-coverage.json)保留每条 ledgerPath、recordNumber、源摘要和最长两级继承路径。起始 5 个手写变化之外，修复又改变 requirement/service 与 result-review/decide 两个消费者，合计 7 个当前完整记录；其他交叉深读没有重复计为全量重审。

## 执行证据必须区分来源

本线程独立探针直接确认：诊断列表饱和仍不披露隐私摘要；未知 UUID 前缀不再漏检；latch 失败后 shared/exclusive 许可可清理重入，未知替换者保持；回调保留两种 Git 对象身份并区分目标完成与回调落地。纯函数与一次性 fixture 的边界见[验证来源](../../plans/review-2026-10-03-rc4/validation-provenance.md)。

开发日志 `docs/progress/consolidation-gate-log.md` §13.151 记录 rc.5：`npm test` 并发 6，**1244 pass、0 fail、0 cancelled、0 skipped**，包含 20 个端到端场景；测试阶段 636592 ms。静态门、Schema、build:check 与双宿主 smoke 均记录通过。当前 Codex/Claude manifest 原始字节摘要与该节完全一致。本线程没有再次执行这套根门，也未把其他线程总结或旧 rc.3 的 1217 项结果当作当前独立通过。

当前 100/100 图已完成[浏览器真实渲染](../../plans/evidence/current-mermaid-render.json)。FigJam 的 17 个重点视图已完成结构和语义对照，8 个面板保存本轮截图，另 9 个未变面板保留前轮已检截图作为继承证据；详见[派生清单](../../plans/review-2026-10-03-rc4/figjam-derivation.json)及[最终交付](../../plans/review-2026-10-03-rc4/handoff.md)。机械汇总、测试、渲染与视觉核验各有证据面，详见[机器可读来源](../../plans/review-2026-10-03-rc4/validation-provenance.json)。rc.5 未安装，原生会话、Windows、新 Claude 登录及新的原生 Pod 闭环没有本轮通过结论。

## 修复事实与不变边界

- 本轮四项修复及前轮三项 DD 修复分别列在[业务证据页](../10-end-to-end-business-flow/review-evidence.md)，不将不同轮次的执行结果混为一条通过声明。
- 隐私扫描仍是已知形式检测；controller-confirmed 不覆盖已识别凭证，无法解码载荷的 opaque 边界仍需明确判断。
- 回调字段是引用数据；发送、落地、目标完成、Controller 决定和用户批准不是同一事实。引用格式不构成宿主发送者认证。
- 获取预算不限制业务回调时长。latch 异常交接已修复，清理自身仍可失败；双失败时后一个清理错误可覆盖先前错误，未知替换者不能被删除。
- 当前格式的 reconcile/recover 有效；不提供旧工作区格式迁移。维护、共享/独占准入、领域锁和逐节点 CAS 保持各自职责。
- 本服务 manifest、同路径磁盘 manifest、hook 观察者和绑定窗口 MCP 属于不同主体。`unverified` 不得写成通过或已过期。
- `releaseEligible:true` 与候选身份均不能证明提交、标签、发布或安装；图谱线程仅修改 atlas。

[总体架构](./README.md) · [逐图台账](../01-diagram-review-ledger.md) · [业务主线](../10-end-to-end-business-flow/README.md) · [FigJam 当前入口](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=62-1743)。
