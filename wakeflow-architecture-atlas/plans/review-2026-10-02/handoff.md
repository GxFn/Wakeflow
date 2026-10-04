# 当前代码图谱重建交付记录

2026-10-02，基线提交 `d8fafff33919c728e3a9b91ec04aa50ec5e07f0c` 加已审阅的当前工作树。改动仅在 `wakeflow-architecture-atlas/`；根仓库的生产源码、测试、Schema、插件制品及其他既有未提交改动保持只读。

## 仓库职责

Wakeflow 源仓库负责两宿主插件的共享运行时、可移植合同、宿主适配、技能文本和确定性制品生成。能力切片调用对应领域 owner；事件、需求板、窗口绑定、工作声明、观察和物化投影各有明确权威边界。真实产品实施发生在目标检出，宿主发送由 Agent 调用宿主完成，Controller 独立做业务接受决定。

Architecture Atlas 负责解释这些已实现关系和已确认限制。静态 import、实际调用、持久状态恢复和 Agent 判断分别表达；图谱、阅读器和 FigJam 都不替代运行状态权威。

## 逐文件审阅与图谱范围

- 354 个手写运行时文件和 9 个工具文件：363 条唯一语义记录，每项含内容 SHA、职责、分支、效果和真实消费者/测试入口。最后核验无缺项、无重复、无来源漂移。
- 95 组 Schema/生成 TS、288 个测试/fixture/support 文件另行列明核验范围。生成物与测试清单不冒充逐行手写语义审阅。
- 17 个专题、64 份 maps 文档、77 张 Mermaid 图（含绘图标准示例）；59 份来源指纹全部当前。每条图边都有稳定编号和相邻证据；181 条精选直接导入、1,289 个源码/测试符号引用、505 个测试符号引用已核验，测试列无未说明的缺口。
- 根 `src/` 的晚变更 delivery/service、hook-observations，以及 tooling 测试并发解析均先重新阅读实际差异，再更新受影响结论与摘要。

[逐文件索引](../../maps/02-file-review-index.md) · [覆盖核验](./review-coverage.json) · [逐图台账](../../maps/01-diagram-review-ledger.md) · [问题导航](../../maps/README.md)。

## Figma 派生图

[当前合集](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=42-1099) 包含架构总览及 12 张模块图。13 个面板逐张截图检查；114 个逻辑节点、117 个显示节点、115 条连线与当前 Mermaid 对照通过。

箭头采用短标签，模块图下保留完整条件和本地 E 编号。投递图中的 accepted/rejected 结局重复显示以减少交叉，明确标注为 7 个逻辑节点、10 个显示节点。原有历史区保留，本轮被替换的排版进入“非当前”草稿区。

| 主题 | FigJam | 图像 | 本地来源 |
| --- | --- | --- | --- |
| 01 · 总体架构 | [架构入口](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=28-573) | [截图](../evidence/2026-10-02-figjam-architecture.png) | [本地正典](../../maps/01-overall-architecture/README.md) |
| 02 · 业务主线 | [图与条件](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=42-1102) | [截图](../evidence/2026-10-02-figjam-business.png) | [本地正典](../../maps/10-end-to-end-business-flow/README.md) |
| 03 · 维护分支 | [图与条件](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=42-1106) | [截图](../evidence/2026-10-02-figjam-maintenance.png) | [本地正典](../../maps/03-configuration-workspace/runtime-call-flow.md) |
| 04 · 事件提交 | [图与条件](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=42-1110) | [截图](../evidence/2026-10-02-figjam-event.png) | [本地正典](../../maps/04-governance-event-sourcing/runtime-call-flow.md) |
| 05 · 投递证据 | [图与条件](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=42-1114) | [截图](../evidence/2026-10-02-figjam-delivery.png) | [本地正典](../../maps/06-implementation-delivery-review/runtime-call-flow.md) |
| 06 · 评审与恢复 | [图与条件](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=42-1118) | [截图](../evidence/2026-10-02-figjam-review.png) | [本地正典](../../maps/07-review-rework-completion/runtime-call-flow.md) |
| 07 · 测试分类 | [图与条件](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=42-1122) | [截图](../evidence/2026-10-02-figjam-testing.png) | [本地正典](../../maps/08-real-environment-testing/runtime-call-flow.md) |
| 08 · Hook 读取 | [图与条件](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=42-1126) | [截图](../evidence/2026-10-02-figjam-hook.png) | [本地正典](../../maps/11-kernel/hook-history.md) |
| 09 · 证据发布 | [图与条件](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=42-1130) | [截图](../evidence/2026-10-02-figjam-publication.png) | [本地正典](../../maps/14-evidence/runtime-call-flow.md) |
| 10 · 证据恢复 | [图与条件](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=42-1134) | [截图](../evidence/2026-10-02-figjam-recovery.png) | [本地正典](../../maps/14-evidence/runtime-call-flow.md) |
| 11 · Pod 关闭 | [图与条件](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=42-1138) | [截图](../evidence/2026-10-02-figjam-pod.png) | [本地正典](../../maps/15-pod/runtime-call-flow.md) |
| 12 · 分域观察 | [图与条件](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=42-1142) | [截图](../evidence/2026-10-02-figjam-observation.png) | [本地正典](../../maps/16-observation/runtime-call-flow.md) |
| 13 · 制品与合同 | [图与条件](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=42-1146) | [截图](../evidence/2026-10-02-figjam-artifacts.png) | [本地正典](../../maps/17-artifacts-and-contracts/README.md) |

[派生清单与逐边缩写映射](./figjam-derivation.json) 保存精确图源摘要、面板定位、连线对照和截图路径。全部 77 张图与源码/测试表以本地为准，不声称已将所有图同步到 FigJam。

## 已确认的实现问题

1. **混合测试失败的授权冲突**：product-defect 与其他 fail 同时出现时，切片允许的产品修复映射与 service/codec 的全失败集合要求不一致，授权被 relation 拒绝。
2. **无成果的 research 取消受阻**：取消路径仍要求 research 的 document 证据，未产出文档时无法通过该门。
3. **等待用户决定时取消归约失败**：取消保留 awaitingDecision，终态解析却只允许它出现在 active，预检和提交可能不一致。

三项均有源码调用链与有界纯分支复现，不扩大为完整公共 MCP/真实宿主复现。发现已写入对应图的停止边界，本任务未修生产代码。[详细触发、证据与其他限制](../../maps/10-end-to-end-business-flow/review-evidence.md)。

## 验证与阅读器修复

| 层次 | 实际结果 |
| --- | --- |
| 根 `npm test` | 1,182 通过，0 失败、0 跳过；包含架构、类型、lint/format、knip、Schema 和制品检查。 |
| 晚变更聚焦 | delivery/hook 合跑 18 通过、1 个 240 秒超时；该大目录用例独立重跑 111 秒通过，首次超时保留。测试并发工具相关 9 项通过。 |
| 当前根静态门 | 三个晚变更后的类型、架构、lint/format、knip、Schema 和 build:check 均通过；既有 lint 提示保留。 |
| 双宿主制品 smoke | Codex 与 Claude 均通过一次性 stdio/hook/维护检查；不是登录宿主会话。 |
| 图谱独立门 | 13 个检查器回归、阅读器类型、当前来源、渲染回执和构建通过；Vite 保留大 chunk 提示。 |
| Mermaid | 浏览器实渲染 77/77，通过；初次 ID 冲突已修复，历史回执保留独立文件。 |
| FigJam | 13 张图节点与连线一致；12 张模块图的完整条件全部保留；分区无越界。 |
| 真实宿主 | 本轮未运行；不以自动化场景或 smoke 替代。 |

阅读器补充逐文件索引、已确认停止点、宿主和制品入口，支持嵌套审阅报告与打包 JSON/PNG/复现脚本。修复画布提前捕获指针导致连线点击失效的问题，并让阅读模式识别小写节点 ID。浏览器已实测搜索、报告导航、点选连线、证据跳转和阅读缩放。

完整命令、超时记录、复测和验证限定见[统一验证回执](./validation-results.json)；Mermaid 回执见[当前渲染记录](../evidence/current-mermaid-render.json)。

## 工作树与交付边界

检查时 main 相对本地 origin/main 为 ahead 0 / behind 0；没有刷新远端引用。工作树存在大量任务前已有及并行未提交改动。本任务没有 commit、push、tag、发布或刷新安装缓存，`git diff --check` 通过。
