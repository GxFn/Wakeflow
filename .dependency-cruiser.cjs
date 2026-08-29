/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
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
      to: {
        dependencyTypes: ["npm-no-pkg", "npm-unknown"],
      },
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
    {
      name: "foundation-does-not-depend-on-product-domains",
      severity: "error",
      comment: "foundation 只能向更低 foundation 或 foundation contracts 依赖。",
      from: { path: "^src/foundation/" },
      to: {
        path: "^src/(?:contracts/(?:identity|generated/identity)|configuration|workspace|windows|governance|demands|delivery|pods|archives|migration|observability|hosts|entrypoints)/",
      },
    },
    {
      name: "application-identity-contract-does-not-depend-on-domains",
      severity: "error",
      comment: "应用级身份合同只能依赖生成合同与 Foundation，不能反向取得领域状态。",
      from: { path: "^src/contracts/identity/" },
      to: {
        path: "^src/(?:configuration|workspace|windows|governance|demands|delivery|pods|archives|migration|observability|hosts|entrypoints)/",
      },
    },
    {
      name: "domain-filesystem-effects-use-foundation",
      severity: "error",
      comment: "host-neutral 领域代码不得绕过根作用域 filesystem foundation。",
      from: {
        path: "^src/(?:configuration|workspace|windows|governance|demands|delivery|pods|archives|migration|observability)/",
      },
      to: { path: "^node:fs(?:/promises)?$" },
    },
    {
      name: "domain-process-effects-use-foundation",
      severity: "error",
      comment: "host-neutral 领域代码不得绕过封闭的 foundation 系统进程能力。",
      from: {
        path: "^src/(?:configuration|workspace|windows|governance|demands|delivery|pods|archives|migration|observability)/",
      },
      to: { path: "^node:child_process$" },
    },
    {
      name: "host-neutral-runtime-does-not-import-host-implementations",
      severity: "error",
      comment: "宿主中立运行时只依赖端口与Profile数据，不得反向导入具体宿主实现。",
      from: {
        path: "^src/(?:configuration|workspace|windows|governance|demands|delivery|pods|archives|migration|observability)/",
      },
      to: { path: "^src/hosts/" },
    },
    {
      name: "runtime-does-not-depend-on-entrypoints",
      severity: "error",
      comment: "composition root只能位于entrypoints，普通运行时不得反向取得入口能力。",
      from: { path: "^src/(?!entrypoints/)" },
      to: { path: "^src/entrypoints/" },
    },
    {
      name: "codex-host-does-not-import-claude-code-host",
      severity: "error",
      comment: "Codex宿主实现不得取得Claude Code宿主能力。",
      from: { path: "^src/hosts/codex/" },
      to: { path: "^src/hosts/claude-code/" },
    },
    {
      name: "claude-code-host-does-not-import-codex-host",
      severity: "error",
      comment: "Claude Code宿主实现不得取得Codex宿主能力。",
      from: { path: "^src/hosts/claude-code/" },
      to: { path: "^src/hosts/codex/" },
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
    tsConfig: {
      fileName: "tsconfig.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "node", "default", "types"],
      extensions: [".ts", ".cts", ".mts", ".js", ".cjs", ".mjs", ".json"],
    },
  },
};
