# 历史归档索引

> 状态：`active`
> 建立日期：2026-09-03
> 上位文档：[docs/README.md](../README.md)

本目录保存已完成使命或已被取代的文档。文件保留原名和原文，不再修改。它们是实现历史与需求裁定的证据，不是当前命令来源。归档文档之间的相对链接保持有效；指向现行文档的链接已在归档时改写。

## 1. 索引

| 文件 | 原始日期 | 类型 | 状态 | 被谁取代或后续 | 仍被引用 |
| --- | --- | --- | --- | --- | --- |
| [wakeflow-architecture-deep-dive-2026-07-02.md](./wakeflow-architecture-deep-dive-2026-07-02.md) | 2026-07-02 | 架构分析 | 历史分析 | 文中容量门、共享 Pod worktree 等结论已被 0.9.x Pod 设计取代 | 否 |
| [wakeflow-next-phase-roadmap-2026-07-02.md](./wakeflow-next-phase-roadmap-2026-07-02.md) | 2026-07-02 | 路线图 | 历史路线图 | stream 与容量门方案已废止 | 否 |
| [wakeflow-local-storage-clarity-plan-2026-07-04.md](./wakeflow-local-storage-clarity-plan-2026-07-04.md) | 2026-07-04 | 整理规划 | 已完成，0.7.9 | 本地信息权威重构需求 | 否 |
| [wakeflow-execution-craft-plan-2026-07-09.md](./wakeflow-execution-craft-plan-2026-07-09.md) | 2026-07-09 | 技能重构计划 | 已完成 | 现行 skills 文本 | 是：`core/skills/wakeflow-governance/references/design-test-skill-realization-source-map.md` |
| [wakeflow-surface-reduction-2026-07-10.md](./wakeflow-surface-reduction-2026-07-10.md) | 2026-07-10 | 表面削减记录 | 已完成 | 无 | 否 |
| [wakeflow-unified-multi-demand-plan-2026-07-10.md](./wakeflow-unified-multi-demand-plan-2026-07-10.md) | 2026-07-10 | 多需求方案 | 历史方案，已被取代 | 宿主管理的完整 Pod 需求设计 | 否 |
| [wakeflow-dual-edition-architecture-and-state-flow.md](./wakeflow-dual-edition-architecture-and-state-flow.md) | v0.7.8 | 架构快照 | 历史快照 | 现行代码与图谱子项目 | 是：根 README 提及为历史快照 |
| [wakeflow-dual-edition-architecture-and-state-flow.zh-CN.md](./wakeflow-dual-edition-architecture-and-state-flow.zh-CN.md) | v0.7.8 | 架构快照中文版 | 历史快照 | 同上 | 否 |
| [wakeflow-hardening-design-compliance-2026-07-30.md](./wakeflow-hardening-design-compliance-2026-07-30.md) | 2026-07-30 | 硬化审计与实现记录 | 0.8.18 历史记录 | 无 | 是：根 README |
| [wakeflow-host-managed-complete-pod-requirement-design-2026-07-31.md](./wakeflow-host-managed-complete-pod-requirement-design-2026-07-31.md) | 2026-07-31 | Pod 需求设计 | 0.9.3 旧体系 Pod 验收权威 | TS 侧取舍见 ADR-0006 | 是：根 README、requirements 索引、ADR-0006 |
| [wakeflow-local-information-authority-refactor-requirement-2026-08-04.md](./wakeflow-local-information-authority-refactor-requirement-2026-08-04.md) | 2026-08-04 | 重构需求 | 阶段 0 到 5 已完成 | 资源处理归一标准 | 是：requirements 索引 |
| [wakeflow-initialization-generated-files-requirement-2026-08-05.md](./wakeflow-initialization-generated-files-requirement-2026-08-05.md) | 2026-08-05 | 需求与实施基线 | D1 到 D41 已裁定；旧体系实现完成 | TS 重构须证明等价 | 是：plan E3、dual-artifact 需求、requirements 索引 |
| [wakeflow-initialization-v3-development-plan-2026-08-06.md](./wakeflow-initialization-v3-development-plan-2026-08-06.md) | 2026-08-06 | 开发实施基线 | M1A 到 M7A 完成，M7B deferred | 无 | 是：dual-artifact 需求 |
| [wakeflow-foundation-services-requirement-2026-08-11.md](./wakeflow-foundation-services-requirement-2026-08-11.md) | 2026-08-11 | 基础服务需求 | G0 完成；G1 候选被 TS 开发计划重新映射 | [plan/typescript-reimplementation-plan.md](../plan/typescript-reimplementation-plan.md) | 是：plan、dual-artifact 需求、resource-handling 标准 |
| [wakeflow-typescript-post-rh2-capability-rebaseline-2026-08-27.md](./wakeflow-typescript-post-rh2-capability-rebaseline-2026-08-27.md) | 2026-08-27 | 能力重新基线化审查 | 已被后续 Gate 取代 | technical-skeleton-review-gate，再被 consolidation-gate-log 取代 | 否 |
| [wakeflow-typescript-technical-skeleton-review-gate-2026-08-28.md](./wakeflow-typescript-technical-skeleton-review-gate-2026-08-28.md) | 2026-08-28 | 技术骨架核实门 | 已被取代 | [progress/consolidation-gate-log.md](../progress/consolidation-gate-log.md) | 是：progress/file-review-ledger.md、references 审计 |

## 2. 归档规则

- 移入时保留原文件名和正文；只在本索引登记。
- 若归档文档仍被现行文档引用，在"仍被引用"列写明引用者，并在 [requirements/README.md](../requirements/README.md) 中列出作为锚点的文档。
- 不在归档文档上继续追加内容。需要更新的结论写到现行文档或新 ADR。
