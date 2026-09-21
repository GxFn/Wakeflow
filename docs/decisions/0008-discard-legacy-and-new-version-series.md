# ADR-0008 丢弃历史版本、新版本序列与场景验收

> 状态：`accepted`
> 提出日期：2026-09-03
> 裁决日期：2026-09-03，用户确认四点并说明旧 JS 在新 TS 完成后删除、新 TS 是全新版本序列
> 基线提交：`c0098e2`
> 相关：[ADR-0006](./0006-legacy-capability-retention.md)、[ADR-0007](./0007-rebuild-mandate-and-bottom-up-flow.md)、[能力卡 1 Q9 与 Q10](../requirements/capabilities/01-workspace-and-configuration.md)、[plan §3、§8.1、§9、§11、§14](../plan/typescript-reimplementation-plan.md)

## 背景

能力卡 1 的讨论读出了旧 legacy 迁移的实际形态：它识别 Wakeflow 自己四个历史根家族、97 个发布边界，核心与宿主模块约 24.7k 唯一行，分类目录 3.3 MB 三份，fixture 语料 48 MB 7,129 个文件，179 项测试。生产路径只放行"config-only cohort"，即工作区里唯一的 legacy 工件是配置文件；任何 Demand、transport、Pod、注册表来源都返回 blocked。v3 配置从不由迁移代码推导，而由调用方提供完整模型与全部 identity mapping。

用户同时说明：配置是机器配置，没有用户手写内容，新建或更新都应基于工作区真实情况而不是旧配置；Wakeflow 的历史版本计划丢弃，后续只维护新 TS 项目与对应的新配置文件；旧 JS 项目在新 TS 完成后删除；新 TS 是全新的版本序列。

## 决定

1. **丢弃全部历史版本。** 新 TS 不识别、不迁移、不 upcast 任何历史布局或配置。fresh-initialize 在目标根内发现任何 Wakeflow 标记时只拒绝并列出，用户清理后再初始化。ADR-0006 中 legacy 迁移的条件项裁定为放弃。
2. **旧 JavaScript 实现从行为基线改为场景与需求证据。** 只有能力卡确认的场景、不变量与失败恢复语义必须在新体系实现；磁盘布局、文件名、事件形状、工具名称与信封都不要求等价。TSD-03 相应改写。
3. **E3 从"整体新旧对比"改为"能力覆盖与场景验收"。** 判定标准是能力映射矩阵每行有 owner 或放弃记录，加上按能力卡场景块在新体系上运行的端到端验收。取消旧新对照工具；P0 的骨架改为场景验收骨架。
4. **旧门退出 `npm test`。** 自本日起 `npm test` 只运行新 TS 门；旧的 `sync-core` 检查、双 validator、双 smoke、旧回归测试改为 `npm run test:legacy` 手动运行。旧代码只读保留到能力卡全部确认，E4 一次删除，不做部分删除。TSD-11 相应放宽。
5. **配置从 v1 起版且不兼容旧文件。** 新 schema `$id` 为 `urn:wakeflow:config:v1`，`schemaVersion` 从 1 开始，`kind` 保持 `WakeflowConfig`；代码中的 `v3` 字样在 L0 改名。配置只由 fresh-initialize 与 reconfigure 产生；物理产物永远由当前运行版本按描述符重新推导，reconcile 幂等重渲染。任何 TS 之前的工作区一律重新初始化。
6. **新 TS 是全新版本序列。** 首个新制品版本在 E4 从新序列起始，旧 0.9.x 序列终止；`release:check` 的五个版本源按新序列一致。插件名称与 marketplace 条目是否沿用在 E4 决定。

## 后果

- plan：TSD-03 与 TSD-11 改写，新增 TSD-16；§2 策略句、§8 协议第 6 步、§8.1 P0 与各层的对照措辞、§9 整节、§10.1 第 6 与第 8 项、§11 测试原则与门表、§13 E3 行、§14 第 4、7、9、15 项。
- `package.json`：`test` 只跑 `check:typescript`；新增 `test:legacy` 保留旧链。`CLAUDE.md` 与 `AGENTS.md` 的验证条款同步。
- 能力卡 1：Q9 裁定为放弃加拒绝规则，Q10 裁定为"配置只由两个入口产生、物理产物由当前版本重推导"，卡片进入 confirmed。
- 完成定义不再保留任何历史 fixture；E4 删除 `test/fixtures/legacy-origins`、三份分类目录与全部迁移模块。
- 能力卡后续各组不再为"旧实现等价"记录细节，只记录场景、不变量、宿主差异与新实现判断。

## 未决问题

两项已于 2026-09-20 E4 关闭（gate-log §13.101 D3、D4）：插件名沿用 `wakeflow`，两份 marketplace 条目沿用（描述与关键字按新工具面改写，去掉 `unattended`）；新版本序列起点 `1.0.0`，唯一输入 `assets/release/version.json`，五个版本源由 `release:check` 核对。
