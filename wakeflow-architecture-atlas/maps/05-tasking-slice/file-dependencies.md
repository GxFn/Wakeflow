---
diagramId: ts-tasking-file-f5
viewType: file-dependency
truthKind: current-code
reviewDepth: L3
verifiedAt: 2026-09-03
snapshotObservedAt: 2026-09-03T03:13:56-07:00
baselineCommit: 08334ab9c1d8bd923966a976fdf7989bc56ac38c
sourceFingerprint: sha256:e66e1da8f9545a6b92ba8137610010aea289734454b9ed1ae5f6e5ef46510e38
audience:
  - maintainer
  - reviewer
documentationOwner: Wakeflow Source Maintenance
generatedBy: mixed
refreshTriggers:
  - src/governance/tasking/**
  - src/governance/demand/**
  - src/governance/testing/test-task-package.ts
  - src/governance/testing/test-task-planning-authority.ts
  - src/governance/testing/test-card.ts
  - src/governance/review/demand-post-acceptance-route.ts
  - src/governance/review/demand-result-review-snapshot.ts
  - src/governance/delivery/window-work-claim-store.ts
sourcePaths:
  - src/governance/tasking/**
  - src/governance/testing/test-task-package.ts
  - src/governance/testing/test-task-planning-authority.ts
  - src/governance/testing/test-card.ts
  - src/governance/review/demand-post-acceptance-route.ts
  - src/governance/review/demand-result-review-snapshot.ts
  - src/governance/delivery/window-work-claim-store.ts
schemaPaths:
  - src/contracts/schemas/governance/tasking/**
  - src/contracts/schemas/entrypoints/wakeflow-target-task-planning-request.schema.json
testPaths:
  - tests/governance/tasking/**
  - tests/governance/testing/test-task-planning-service*
---

# Tasking纵切：关键文件导入依赖

## F5：Planning、TaskPackage与投影依赖

```mermaid
flowchart LR
  accTitle: Target Task Planning关键文件依赖
  accDescr: Public Coordinator导入判别式公共合同和Planning Service，Schema允许完整implementation输入或最小test选择；Service组合Authority Context、Plan、TaskPackage、Demand Repository和Projection Store，并通过Test Planning Authority从当前Card派生test Package。TaskPackage依赖生成Schema，Projection Store从唯一规划事件物化确定文档。

  subgraph ROOTS["公共入口与输入"]
    PUBLIC["[已实现][F-TSK-01]\ntarget-task-planning-public-coordinator.ts"]
    CONTRACT["[源码][F-TSK-02]\ntarget-task-planning-public-contract.ts"]
    INPUT["[已实现][F-TSK-03]\ntarget-task-planning-input.ts"]
  end

  subgraph SHARED_ENTRY["Planning编排与权威"]
    SERVICE["[已实现][F-TSK-04]\ntarget-task-planning-service.ts"]
    AUTH["[已实现][F-TSK-05]\ntarget-task-planning-authority.ts"]
  end

  subgraph DOMAIN["不可变计划与合同"]
    PLAN["[源码][F-TSK-06]\ntarget-task-planning-plan.ts"]
    PACKAGE["[已实现][F-TSK-07]\ntask-package.ts"]
  end

  subgraph HOST_ENTRY["事件派生投影"]
    PATHS["[源码][F-TSK-08]\ntask-package-projection-paths.ts"]
    PROJECTION["[源码][F-TSK-09]\ntask-package-projection-store.ts"]
  end

  subgraph HOST_IMPL["相邻权威"]
    CONFIG["[外部] Config Authority"]
    DEMAND["[外部] Demand Repository/Decider"]
    LEDGER["[外部] Ledger Authority"]
    TEST_AUTH["[源码][F-TST-01]\ntest-task-planning-authority.ts"]
    TEST_PACKAGE["[源码][F-TST-02]\ntest-task-package.ts"]
    TESTCARD["[源码][F-TST-03]\ntest-card.ts"]
  end

  WIRE["[生成][F-GEN-05]\ntask-package.generated.ts"]

  PUBLIC -->|"E-F5-01 解析wire请求"| CONTRACT
  PUBLIC -->|"E-F5-02 preview/apply"| SERVICE
  SERVICE -->|"E-F5-03 输入与ID分配"| INPUT
  SERVICE -->|"E-F5-04 打开权威Context"| AUTH
  SERVICE -->|"E-F5-05 创建exact plan"| PLAN
  SERVICE -->|"E-F5-06 创建/验证TaskPackage"| PACKAGE
  SERVICE -->|"E-F5-07 追加/查询规划Event"| DEMAND
  SERVICE -->|"E-F5-08 物化projection"| PROJECTION

  AUTH -->|"E-F5-09 Config时效性"| CONFIG
  AUTH -->|"E-F5-10 Demand根权威"| DEMAND
  AUTH -->|"E-F5-11 Ledger引用"| LEDGER
  SERVICE -->|"E-F5-12 Test路由与权威"| TEST_AUTH
  PLAN -->|"E-F5-13 完整TaskPackage"| PACKAGE
  PACKAGE -->|"E-F5-14 使用TaskPackage Schema"| WIRE
  PROJECTION -->|"E-F5-15 唯一规划Event"| DEMAND
  PROJECTION -->|"E-F5-16 确定文档/摘要"| PACKAGE
  PROJECTION -->|"E-F5-17 路径词汇"| PATHS
  SERVICE -->|"E-F5-18 创建Test TaskPackage"| TEST_PACKAGE
  TEST_AUTH -->|"E-F5-19 读取TestCard"| TESTCARD
  TEST_PACKAGE -->|"E-F5-20 读取TestCard"| TESTCARD
  TEST_PACKAGE -->|"E-F5-21 复用TaskPackage owner"| PACKAGE
```

### 本图术语说明

| 图中术语 | 解释 |
| --- | --- |
| wire请求 | MCP输入Schema准入后的公共preview/apply结构；领域仍重新解析和冻结 |
| Authority Context | Config、Demand Root Authority、Ledger root和当前物理根的组合 |
| exact plan | 固定所有系统ID、expected revision和完整TaskPackage的不可变preview结果 |
| 相邻权威 | Tasking只读取并引用的Config/Demand/Ledger/TestCard事实，不复制为自身权威 |
| Event派生投影 | 从唯一`target-task-planned`事件重建的0600文件，便于目标窗口读取 |

## 文件与符号映射

| 文件编号 | 文件/符号 | 状态 | 职责 |
| --- | --- | --- | --- |
| `F-TSK-01` | `target-task-planning-public-coordinator.ts#execute*PublicRequest` | 已实现 | 打开根、调用Service并脱敏preview/apply结果 |
| `F-TSK-02` | `target-task-planning-public-contract.ts` | 已实现 | 公共工具名、Schema版本和请求领域重解析 |
| `F-TSK-03` | `target-task-planning-input.ts` | 已实现 | authored输入、options、取消和4类系统ID分配 |
| `F-TSK-04` | `target-task-planning-service.ts#TargetTaskPlanningService` | 已实现 | preview/apply唯一编排职责 |
| `F-TSK-05` | `target-task-planning-authority.ts` | 已实现 | 打开Config/Demand/Ledger权威并复验引用/拓扑/Config current |
| `F-TSK-06` | `target-task-planning-plan.ts` | 已实现 | exact plan解析、创建和Canonical digest |
| `F-TSK-07` | `task-package.ts` | 已实现 | `workType`判别联合、TestCard tuple、确定文档和摘要 |
| `F-TSK-08` | `task-package-projection-paths.ts` | 已实现 | TaskPackage ID与唯一投影路径/文件名互转 |
| `F-TSK-09` | `task-package-projection-store.ts#TaskPackageProjectionStore` | 已实现 | 从事件审计并幂等物化/读取0600投影 |
| `F-TST-01` | `testing/test-task-planning-authority.ts` | 已实现 | 从Review route、TestCard、Config Test窗口及产品WorkClaim闭合test准入 |
| `F-TST-02` | `testing/test-task-package.ts` | 已实现 | 从TestCard确定性派生`test` TaskPackage并复验投影关系 |
| `F-TST-03` | `testing/test-card.ts` | 已实现 | TestCard严格合同、确定文档和摘要；由相邻Testing纵切拥有 |
| `F-GEN-05` | `contracts/generated/governance/tasking/task-package.generated.ts` | 已实现 | TaskPackage Schema生成类型与运行时常量 |

## 原始依赖快照

| 生产模块 | 聚焦闭包模块 | 依赖 | 违规 |
| ---: | ---: | ---: | ---: |
| 9 | 823 | 5817 | 0 |

## 边级证据

| 边编号 | 范围 | 证据 |
| --- | --- | --- |
| `E-F5-01`–`E-F5-08` | Public/Service内部组合 | Tasking模块直接imports；Planning Service与Public Coordinator测试 |
| `E-F5-09`–`E-F5-12` | Config/Demand/Ledger与Test Planning权威 | Authority模块与Test Planning来源加载；Service负例 |
| `E-F5-13`、`E-F5-14` | Plan/TaskPackage/Schema | plan与TaskPackage测试、schema:check |
| `E-F5-15`–`E-F5-17` | Event到文件投影 | Projection Store审计事件、路径、确定文档与幂等测试 |
| `E-F5-18`–`E-F5-21` | Service内部Test分支 | Service、Test Planning Authority、Test TaskPackage和TestCard直接imports；当前仅测试/fixture调用该分支 |

## 停止边界

- 本图只展示Tasking骨干；Demand、Ledger、TestCard和Foundation闭包在相邻文档包下钻。
- TaskPackage/Event是权威事实；projection缺失不允许调用方伪造文件补齐。
- 公共Coordinator与wire Schema允许两种workType，但test只接受最小选择并由owner派生完整内容。
- Tasking相关源码、Schema和测试已进入`d17602e`。
- A2-F1只调整测试fixture的前置权威顺序；本图Tasking生产文件的直接import声明已逐条复核，没有新增TODO依赖边。
