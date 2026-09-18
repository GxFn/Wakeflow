/**
 * Wakeflow 依赖方向规则（ADR-0013 六层形状）。
 *
 * 层从低到高：foundation → contracts → kernel → capabilities（含过渡期的旧领域
 * configuration、workspace、governance）→ hosts → entrypoints。依赖只能向下；
 * 垂直切片之间互不引用；宿主实现互不引用；tests 与 tooling 不进入运行时。
 * "过渡"一节里的规则守住旧树内部的接缝，随 L1 各切片删除旧树时一并删除。
 */

const LEGACY_DOMAIN_ROOTS = "configuration|workspace|governance";
const HOST_NEUTRAL_RUNTIME = `^src/(?:${LEGACY_DOMAIN_ROOTS}|kernel|capabilities)/`;

const WORKSPACE_GOVERNANCE_COMPOSITION_SOURCES =
  "^src/workspace/(?:maintenance/(?:wakeflow-static-materialization-preview|wakeflow-static-materialization-step-executor)|(?:wakeflow-shared-coordination-layout|wakeflow-workspace-static-resource-matrix))\\.ts$";

const WORKSPACE_GOVERNANCE_COMPOSITION_TARGETS =
  "^src/governance/(?:delivery/window-work-claim-resource-catalog|demand/demand-resource-catalog|ledger/(?:ledger-authority-(?:layout|store|storage-policy)|ledger-resource-catalog))\\.ts$";

const GOVERNANCE_WORKSPACE_CONTRACT_TARGETS =
  "^src/workspace/(?:window-runtime/(?:wakeflow-agent-host-window-observation-authority|wakeflow-window-host-binding(?:-id|-store-authority|-store)?|wakeflow-window-host-identity-profile)|workspace-(?:host-resource-profile|resource-declaration|shared-runtime-resource-catalog))\\.ts$";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ---- 通用 -------------------------------------------------------------
    {
      name: "no-circular",
      severity: "error",
      comment: "运行时与测试模块不得形成循环依赖。",
      from: {},
      to: { circular: true },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment: "所有静态依赖都必须能按当前 TypeScript/Node 配置解析。",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "no-unlisted-production-dependency",
      severity: "error",
      comment: "生产源码不得依赖 package.json 未声明的包。",
      from: { path: "^src/" },
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
    },
    {
      name: "no-runtime-dev-dependency",
      severity: "error",
      comment: "生产运行时只能依赖 dependencies；类型依赖不进入制品。",
      from: { path: "^src/" },
      to: {
        dependencyTypes: ["npm-dev"],
        dependencyTypesNot: ["type-only"],
        pathNot: "^node_modules/@types/",
      },
    },
    {
      name: "no-runtime-to-development-or-legacy",
      severity: "error",
      comment: "新运行时不得反向依赖测试、tooling、旧源码或生成制品。",
      from: { path: "^src/" },
      to: { path: "^(?:tests|test|tooling|tools|core|plugins)/" },
    },
    {
      name: "no-new-tests-to-legacy-runtime",
      severity: "error",
      comment: "新测试可以使用固定 golden，但不得 import 旧 JS 实现。",
      from: { path: "^tests/" },
      to: { path: "^(?:core|plugins|test)/" },
    },

    // ---- 六层方向（ADR-0013）------------------------------------------------
    {
      name: "layer-foundation-depends-only-on-foundation",
      severity: "error",
      comment: "foundation 是最底层：只能依赖 foundation 自身与 foundation 的生成合同。",
      from: { path: "^src/foundation/" },
      to: {
        path: `^src/(?:contracts/(?:identity|vocabulary|generated/identity)|${LEGACY_DOMAIN_ROOTS}|kernel|capabilities|hosts|entrypoints)/`,
      },
    },
    {
      name: "layer-contracts-depend-only-on-foundation",
      severity: "error",
      comment: "contracts 是数据与词汇：只能依赖 foundation 与其他 contracts，不得取得内核、切片、领域、宿主或入口。",
      from: { path: "^src/contracts/" },
      to: { path: `^src/(?:${LEGACY_DOMAIN_ROOTS}|kernel|capabilities|hosts|entrypoints)/` },
    },
    {
      name: "layer-kernel-depends-only-on-foundation-and-contracts",
      severity: "error",
      comment: "kernel 是应用内核，只能依赖 foundation 与 contracts，不得取得任何切片、旧领域、宿主或入口能力。",
      from: { path: "^src/kernel/" },
      to: { path: `^src/(?:${LEGACY_DOMAIN_ROOTS}|capabilities|hosts|entrypoints)/` },
    },
    {
      name: "layer-capabilities-do-not-import-each-other",
      severity: "error",
      comment: "垂直切片之间不得互相引用；共享内容下沉到 kernel 或经 contracts 相遇。",
      from: { path: "^src/capabilities/([^/]+)/" },
      to: { path: "^src/capabilities/(?!$1/)[^/]+/" },
    },
    {
      name: "layer-host-neutral-runtime-does-not-import-hosts",
      severity: "error",
      comment: "切片与旧领域是宿主中立的：只依赖 profile 数据与端口，不得反向导入具体宿主实现。",
      from: { path: HOST_NEUTRAL_RUNTIME },
      to: { path: "^src/hosts/" },
    },
    {
      name: "layer-runtime-does-not-depend-on-entrypoints",
      severity: "error",
      comment: "composition root 只能位于 entrypoints；任何更低层不得反向取得入口能力。",
      from: { path: "^src/(?!entrypoints/)" },
      to: { path: "^src/entrypoints/" },
    },
    {
      name: "layer-hosts-do-not-import-each-other",
      severity: "error",
      comment: "Codex 与 Claude Code 宿主实现互不引用；共同部分下沉到 kernel 或切片。",
      from: { path: "^src/hosts/([^/]+)/" },
      to: { path: "^src/hosts/(?!$1/)[^/]+/" },
    },
    {
      name: "layer-domain-effects-use-foundation",
      severity: "error",
      comment: "宿主中立运行时不得绕过根作用域 filesystem 与封闭的系统进程 foundation。",
      from: { path: HOST_NEUTRAL_RUNTIME },
      to: { path: "^node:(?:fs(?:/promises)?|child_process)$" },
    },

    // ---- 过渡：旧树内部接缝（随 L1 删除旧树时一并删除）---------------------
    {
      name: "transitional-configuration-uses-only-workspace-resource-contract",
      severity: "error",
      comment: "Configuration 只可复用 Workspace 的纯资源声明合同，不能取得 Workspace 状态或执行能力。",
      from: { path: "^src/configuration/" },
      to: {
        path: "^src/workspace/",
        pathNot: "^src/workspace/workspace-resource-declaration\\.ts$",
      },
    },
    {
      name: "transitional-workspace-governance-composition-source-is-explicit",
      severity: "error",
      comment: "只有 Workspace 初始化与静态矩阵组合根可以取得 Governance owner 能力。",
      from: { path: "^src/workspace/", pathNot: WORKSPACE_GOVERNANCE_COMPOSITION_SOURCES },
      to: { path: "^src/governance/" },
    },
    {
      name: "transitional-workspace-governance-composition-target-is-explicit",
      severity: "error",
      comment: "Workspace 组合缝只能取得已列明的 Governance 布局、目录和初始化 owner。",
      from: { path: WORKSPACE_GOVERNANCE_COMPOSITION_SOURCES },
      to: { path: "^src/governance/", pathNot: WORKSPACE_GOVERNANCE_COMPOSITION_TARGETS },
    },
    {
      name: "transitional-governance-uses-only-workspace-contract-seams",
      severity: "error",
      comment: "Governance 只能取得 Workspace 布局、资源声明、宿主 Profile 和 Window 身份合同。",
      from: { path: "^src/governance/" },
      to: { path: "^src/workspace/", pathNot: GOVERNANCE_WORKSPACE_CONTRACT_TARGETS },
    },
  ],
  options: {
    parser: "swc",
    doNotFollow: {
      path: "node_modules",
      dependencyTypes: [
        "npm",
        "npm-dev",
        "npm-optional",
        "npm-peer",
        "npm-bundled",
        "npm-no-pkg",
        "npm-unknown",
      ],
    },
    includeOnly: ["^(?:src|tests|tooling)/"],
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "node", "default", "types"],
      extensions: [".ts", ".cts", ".mts", ".js", ".cjs", ".mjs", ".json"],
    },
  },
};
