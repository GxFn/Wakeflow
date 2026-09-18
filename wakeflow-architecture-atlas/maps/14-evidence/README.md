---
diagramId: ts-evidence-readme
viewType: authority
truthKind: current-code
reviewDepth: L4
verifiedAt: 2026-09-18
baselineCommit: 1480271ecc8a6c17bb9042321644402bd6cbda56
sourceFingerprint: sha256:68b1d8197a6823c632e2d5c0fa418b3b15d452f1b628ba4f6065b11991c22125
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: manual-review
sourcePaths:
  - src/capabilities/evidence/*.ts
  - src/capabilities/evidence/service.ts
  - src/capabilities/result-review/*.ts
  - src/capabilities/result-review/service.ts
  - src/configuration/*.ts
  - src/contracts/generated/configuration/*.ts
  - src/contracts/generated/entrypoints/*.ts
  - src/contracts/generated/foundation/*.ts
  - src/contracts/generated/governance/delivery/*.ts
  - src/contracts/generated/governance/demand/*.ts
  - src/contracts/generated/governance/evidence/*.ts
  - src/contracts/generated/governance/ledger/*.ts
  - src/contracts/generated/governance/lifecycle/*.ts
  - src/contracts/generated/governance/result/*.ts
  - src/contracts/generated/governance/review/*.ts
  - src/contracts/generated/governance/tasking/*.ts
  - src/contracts/generated/governance/testing/*.ts
  - src/contracts/generated/identity/*.ts
  - src/contracts/generated/workspace/*.ts
  - src/contracts/identity/*.ts
  - src/contracts/vocabulary/*.ts
  - src/foundation/artifact/*.ts
  - src/foundation/crypto/*.ts
  - src/foundation/data/*.ts
  - src/foundation/event-sourcing/*.ts
  - src/foundation/filesystem/*.ts
  - src/foundation/git/*.ts
  - src/foundation/identity/*.ts
  - src/foundation/node/*.ts
  - src/foundation/numeric/*.ts
  - src/foundation/resource/*.ts
  - src/foundation/schema/*.ts
  - src/foundation/text/*.ts
  - src/foundation/time/*.ts
  - src/governance/controller/*.ts
  - src/governance/delivery/*.ts
  - src/governance/demand/*.ts
  - src/governance/demand/event-sourcing/*.ts
  - src/governance/demand/model/*.ts
  - src/governance/demand/publication/*.ts
  - src/governance/evidence/*.ts
  - src/governance/evidence/managed-evidence-capture-planning-service.ts
  - src/governance/evidence/managed-evidence-manifest.ts
  - src/governance/evidence/managed-evidence-publication-application-service.ts
  - src/governance/evidence/managed-evidence-publication-transaction-settlement.ts
  - src/governance/evidence/managed-evidence-source-selection.ts
  - src/governance/ledger/*.ts
  - src/governance/lifecycle/*.ts
  - src/governance/result/*.ts
  - src/governance/review/*.ts
  - src/governance/tasking/*.ts
  - src/governance/testing/*.ts
  - src/kernel/*.ts
  - src/kernel/event-stream/*.ts
  - src/workspace/*.ts
  - src/workspace/window-runtime/*.ts
schemaPaths:
  - src/contracts/schemas/configuration/wakeflow-config-v3.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-implementation-review-decision-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-implementation-review-decision-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-record-evidence-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-record-evidence-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-target-result-import-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-target-result-import-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-target-result-review-inspection-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-target-result-review-inspection-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-test-review-decision-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-test-review-decision-result.schema.json
  - src/contracts/schemas/foundation/directory-tree-candidate-plan.schema.json
  - src/contracts/schemas/foundation/git-object-id.schema.json
  - src/contracts/schemas/foundation/loaded-artifact-tree-manifest.schema.json
  - src/contracts/schemas/foundation/portable-resource-path.schema.json
  - src/contracts/schemas/foundation/sha256-digest.schema.json
  - src/contracts/schemas/foundation/utc-instant.schema.json
  - src/contracts/schemas/governance/delivery/delivery-envelope.schema.json
  - src/contracts/schemas/governance/delivery/delivery-outcome.schema.json
  - src/contracts/schemas/governance/delivery/delivery-rearm.schema.json
  - src/contracts/schemas/governance/demand/callback-reissued-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/controller-target-review-decided-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/decision-recorded-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/delivery-outcome-recorded-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/delivery-prepared-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/delivery-rearmed-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/demand-aggregate-state.schema.json
  - src/contracts/schemas/governance/demand/demand-authority.schema.json
  - src/contracts/schemas/governance/demand/demand-cancelled-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/demand-completed-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/demand-continued-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/demand-escalated-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/demand-event-sourcing-snapshot.schema.json
  - src/contracts/schemas/governance/demand/demand-event-sourcing-stored-event.schema.json
  - src/contracts/schemas/governance/demand/demand-event-stream-commit.schema.json
  - src/contracts/schemas/governance/demand/demand-identity.schema.json
  - src/contracts/schemas/governance/demand/demand-published-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/managed-evidence-recorded-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/product-defect-remediation-authorized-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/target-result-recorded-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/target-task-planned-event-data-v1.schema.json
  - src/contracts/schemas/governance/evidence/managed-evidence-manifest.schema.json
  - src/contracts/schemas/governance/evidence/managed-evidence-publication-transaction.schema.json
  - src/contracts/schemas/governance/ledger/ledger-authority-member-reference.schema.json
  - src/contracts/schemas/governance/ledger/ledger-record-publication-intent.schema.json
  - src/contracts/schemas/governance/ledger/requirement-lineage.schema.json
  - src/contracts/schemas/governance/ledger/requirement-record.schema.json
  - src/contracts/schemas/governance/lifecycle/demand-completion.schema.json
  - src/contracts/schemas/governance/result/implementation-target-result-report.schema.json
  - src/contracts/schemas/governance/result/target-result.schema.json
  - src/contracts/schemas/governance/result/test-target-result-report.schema.json
  - src/contracts/schemas/governance/review/controller-implementation-review-decision.schema.json
  - src/contracts/schemas/governance/review/controller-product-defect-remediation-authorization.schema.json
  - src/contracts/schemas/governance/review/controller-test-review-decision.schema.json
  - src/contracts/schemas/governance/tasking/task-package.schema.json
  - src/contracts/schemas/governance/testing/test-execution-attempt.schema.json
  - src/contracts/schemas/identity/wakeflow-durable-id-kind.schema.json
  - src/contracts/schemas/workspace/window-host-binding.schema.json
testPaths:
  - tests/capabilities/evidence/service.test.ts
  - tests/capabilities/result-review/service.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0012-flow-convergence-callback-calls-testing-redesign.md
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# 受管证据：来源、捕获、发布与读取

四类来源为 managed-path、observation、https link 和 commit。证据种类与来源绑定，结果导入只接受本 Demand 内可解析且摘要一致的受管定位符。

> 核验基线：`1480271`（L1 observation 第十片已落地，20 个公共工具、18 个一次性场景）。工作树另有并行未提交改动（宿主 hook 通道等），本图不描绘；来源指纹按当前工作树计算。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 受管证据从选择到结果消费

```mermaid
flowchart TB
  accTitle: 受管证据从选择到结果消费
  accDescr: 受管证据从选择到结果消费；箭头区分当前代码步骤、返回事实与明确的条件。
  select["来源选择和种类"]
  capture["稳定捕获与隐私决定"]
  plan["确定性身份与发布计划"]
  publish["journal 与 Manifest 绑定发布"]
  record["不可变 Evidence 记录"]
  review["Result 定位符解析"]
  select -->|"E-L1059-01 文件树或引用投影"| capture
  capture -->|"E-L1059-02 凭证拒绝，需确认项显式列出"| plan
  plan -->|"E-L1059-03 同选择摘要 apply"| publish
  publish -->|"E-L1059-04 事件、final 和 journal-last 结算"| record
  record -->|"E-L1059-05 读受管成员并核种类与摘要"| review
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| ledger | 长期不可变需求包与归档的存储根。 |
| commit | 一次不可变事件提交批；文件槽位以预期修订防止并发覆盖。 |
| CAS | 比较已观察的摘要/修订后提交；来源已改变则拒绝。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| select | `src/governance/evidence/managed-evidence-source-selection.ts` | 来源选择和种类 |
| capture | `src/governance/evidence/managed-evidence-capture-planning-service.ts` | 稳定捕获与隐私决定 |
| plan | `src/capabilities/evidence/service.ts` | 确定性身份与发布计划 |
| publish | `src/governance/evidence/managed-evidence-publication-application-service.ts` | journal 与 Manifest 绑定发布 |
| record | `src/governance/evidence/managed-evidence-manifest.ts` | 不可变 Evidence 记录 |
| review | `src/capabilities/result-review/service.ts` | Result 定位符解析 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1059-01 | `src/governance/evidence/managed-evidence-capture-planning-service.ts` | `tests/capabilities/evidence/service.test.ts` | 文件树或引用投影 |
| E-L1059-02 | `src/governance/evidence/managed-evidence-capture-planning-service.ts#deriveManagedEvidenceContentBlockers` | `tests/capabilities/evidence/service.test.ts` | 凭证拒绝，需确认项显式列出 |
| E-L1059-03 | `src/capabilities/evidence/service.ts#executeRecordEvidenceRequest` | `tests/capabilities/evidence/service.test.ts` | 同选择摘要 apply |
| E-L1059-04 | `src/governance/evidence/managed-evidence-publication-transaction-settlement.ts#completeManagedEvidencePublicationTransaction` | `tests/capabilities/evidence/service.test.ts` | 事件、final 和 journal-last 结算 |
| E-L1059-05 | `src/capabilities/result-review/service.ts#resolveEvidenceReference` | `tests/capabilities/result-review/service.test.ts` | 读受管成员并核种类与摘要 |

## 守卫、恢复与验证范围

链接和提交来源保存引用投影，不替调用者下载远端或认证远端事实。Pod worktree 来源由配置意图与受管回执定位；无法解析的结果定位符不能升级为有效证据。

涉及的测试与核验入口：

- `tests/capabilities/evidence/service.test.ts`。
- `tests/capabilities/result-review/service.test.ts`。

## 下钻与相关视图

- [文件直接导入](./file-dependencies.md)
- [运行调用与恢复](./runtime-call-flow.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
