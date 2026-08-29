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
      comment: "foundation 只能向更低 foundation/contracts 依赖。",
      from: { path: "^src/foundation/" },
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
