# rc.5 候选代码图谱更新交付记录

本轮从 rc.4 工作树开始，逐分支追读最新实现，最终以 **1.1.0-rc.5 源码候选**闭合。目录保留起始 rc.4 名称；这不是已发布、已安装或已由真实宿主验收的版本。提交基线为 `d8fafff33919c728e3a9b91ec04aa50ec5e07f0c`。

## 阅读入口

- [当前 FigJam 总览](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=62-1743)，以及[新增回调状态图](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=76-2662)。
- [本地模块入口](../../maps/README.md)、[逐文件索引](../../maps/02-file-review-index.md)、[逐图核验台账](../../maps/01-diagram-review-ledger.md)。
- [验证来源](./validation-provenance.md)、[机器可读结果](./validation-results.json)、[FigJam 派生清单](./figjam-derivation.json)。

## 覆盖与内容

370 个手写文件（360 runtime、10 tooling）的语义记录与当前源码闭合。本轮完整重审 7 个实际变化文件，其余 363 个只在源码字节一致时递归继承已选中的历史记录；额外追读调用方、消费者和测试不重复计为全文件重审。95 Schema、95 generated、297 tests/fixtures/support 单独统计。

当前有 **76 份 maps 文档、100 张 Mermaid 图**。新增 5 页、10 图，明确以下分支与限制：

| 新增下钻 | 图谱回答的问题 |
| --- | --- |
| [内核隐私](../../maps/11-kernel/privacy-boundary.md) | CSI 与原文位置怎样映射；路径如何识别；UUID 前缀白名单和已知私有值检查各管什么。 |
| [需求摘要](../../maps/13-requirement/privacy-preview.md) | 路由语境过滤、每段扫描和64项诊断如何分开；为什么摘要必须由独立 privacyHit 决定。 |
| [证据内容与来源](../../maps/14-evidence/privacy-and-source-consistency.md) | 可解码文本、opaque、凭证的不同分支；preview、apply、物化与完整 stage 分别复验什么。 |
| [回调与评审](../../maps/07-review-rework-completion/callback-trust-and-review.md) | 不可信展示字段如何引用；acknowledged/landed/silent/pending 的优先级；inspect 的只读入口和停止点。 |
| [准入竞争与清理](../../maps/02-foundation/admission-races-and-recovery.md) | 正常竞争怎样重观测；许可何时交给外层 finally；清理失败为什么保留未知替换者。 |

另外按真实差异收敛 20 页交叉说明，清零 19 个来源漂移，纠正旧阻断结论、公共输出隐私边界和错误优先级的过度概括。不能把普通“主体错误优先”套在 lease 的 finally 上：许可清理失败会覆盖先前错误。

## 发现与修复闭环

以下生产修复由另一个开发线程完成。本图谱线程提供复现，随后独立检查最终代码、真实消费者与后态探针，没有越界改写生产代码。

| 发现 | 最终实现与独立复核 |
| --- | --- |
| 64项诊断挤掉隐私项，blocked 预览仍回显摘要 | `PackageAnalysis` 与 `PublishAssessment` 保存独立 privacyHit；五类输入新增回归。独立探针确认诊断仍饱和且不含隐私条目时，summary=null。 |
| 未知 UUID 前缀绕过白名单 | 完整前缀参与判定；合成已知/未知及空前缀用例复核通过。相邻字母、尾缀和任意秘密仍受词法识别范围限制。 |
| latch 释放失败后，已取得的许可失去外层释放责任 | acquire 成功立即保存 lease，再结算 latch。三种清理成功场景均可重入，两种未知替换场景保留原字节并要求恢复。 |
| 回调把 Git 提交对象显示为对象字符串 | 提交摘要使用 algorithm:value；SHA-1、SHA-256及中英文展示保真，原结果记录不改写。 |

前态失败证据与后态验证分开保存。具体依据见[隐私记录](./privacy-evidence.md)、[并发记录](./concurrency-review.md)及[回调记录](./callback-review.md)。

## 阅读器与校验器修复

证据表现在按阅读器使用的 GFM 语法识别。代码围栏内的示例、孤立竖线行不能冒充证据；转义竖线不再错移测试列，删除测试列也不能绕过 anchored 检查。对应回归先复现漏检，再验证修复。

阅读器从 index 的明确 reviewSnapshot 选择本轮记录，旧 rc.3 与 10月2日记录显示为历史，避免同一天不同快照混淆。全屏进出记忆阅读、全图或1:1模式并重新适配，按钮显示“退出全屏”。普通尺寸变化保留用户手动视角；换页清理观察器、事件、RAF与拖动状态，过期异步渲染不会装配旧图。

## 视觉与验证范围

FigJam 当前为 **17 个重点视图、160 个节点、158 条连线**，逐节点、端点和短标签核对通过，图侧逐条保存完整 E 条件，面板与总板无越界。重绘2张、新增5张，10张正典图源完全相同而保留；本轮检查8份最终面板截图，另外9份内容不变面板沿用已核验截图及摘要。修正了竞争重试边文字相撞和回调判断框截字。

旧 rc.3 完整画布保存于[折叠历史快照](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=68-1739)；两张被替换原图也保留原节点。历史载荷、截图及失败记录保持原字节。

100 张正典图已用 Mermaid 11.17.2 在真实浏览器中全部渲染通过。阅读器实测了进出全屏自动适配、手动视角跨尺寸保留、恢复自动适配、分支证据定位、多图页切换和返回首页清理；浏览器未记录应用错误。具体观察见 [reader-ui-verification.json](./reader-ui-verification.json)。

本线程独立复跑三组后态探针。开发线程的持久门日志记录 rc.5 根测试 **1244通过、0失败/取消/跳过**，含20个E2E，双宿主 smoke 和生成 MCP 夹具复验通过；本线程已核对命令脚本、版本及两份制品 manifest 的精确摘要，没有将其记为本线程重跑根门。原始根门 stdout 未收入本图谱，**rc.5 原生会话未验证**。

图谱 `npm run check` 全部通过：17项检查器回归、阅读器类型、76页结构与全部来源指纹、100图浏览器回执和 Vite 构建。最终875个来源文件摘要均匹配，`git diff --check` 通过；回执见 [validation-results.json](./validation-results.json)。Vite 仍有已有的大 chunk 提示，本轮未放宽阈值。全量静态通过不意味着每条测试断言都已逐行复审；未覆盖和继承限制仍保留在覆盖报告与边级证据中。

本轮工作限定在 architecture-atlas 与其 FigJam 派生面。工作树仍有未提交改动，生产源码与生成制品改动来自开发线程；本线程没有 commit、push、发布或缓存刷新。main 与本地 origin/main 同步；未以远程 fetch 验证服务器状态。
