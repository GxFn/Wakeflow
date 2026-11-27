/**
 * Wakeflow 依赖方向规则（ADR-0013 决定 A 与补记二：九层）。
 *
 * 层从低到高：foundation → contracts → kernel → configuration → governance → workspace →
 * application → capabilities | hosts → entrypoints。每层一条"只引用这些层"的规则，由
 * `tooling/architecture/layer-map.cjs` 的表生成；contracts、foundation、governance、workspace、application
 * 内部再按层级表排序。共用的代码放在它的依赖允许的最低一层：内核只放机制与各层都读的数据表，
 * 领域代码放进拥有那个概念的最低切片。切片之间、宿主之间互不引用；tests 与 tooling 不进入运行时。
 */

const { LAYER_IMPORTS, SLICE_LEVELS } = require("./tooling/architecture/layer-map.cjs");

/** foundation 还可以读 contracts 的生成合同，只是不能读生成的 durable-id 词汇。 */
const FOUNDATION_TARGETS = "^src/(?:foundation/|contracts/generated/(?!identity/))";
const HOST_NEUTRAL_RUNTIME = "^src/(?:kernel|configuration|governance|workspace|application|capabilities)/";

function layerRules() {
  return Object.entries(LAYER_IMPORTS)
    .filter(([, imports]) => imports !== null)
    .map(([layer, imports]) => ({
      name: `layer-${layer}-imports-only-listed-layers`,
      severity: "error",
      comment: `${layer} 只引用 ${imports.join("、")}。`,
      from: { path: `^src/${layer}/` },
      to: {
        path: "^src/",
        pathNot: layer === "foundation" ? FOUNDATION_TARGETS : `^src/(?:${imports.join("|")})/`,
      },
    }));
}

function sliceDirectory(layer, slice) {
  return slice === "(root)" ? `src/${layer}/[^/]+$` : `src/${layer}/${slice}/`;
}

function sliceLevelRules() {
  return Object.entries(SLICE_LEVELS).flatMap(([layer, levels]) =>
    levels.flatMap((group, level) =>
      group.flatMap((slice) => {
        const sameOrHigher = levels
          .slice(level)
          .flat()
          .filter((other) => other !== slice);
        if (sameOrHigher.length === 0) return [];
        return [
          {
            name: `${layer}-${slice === "(root)" ? "root" : slice}-imports-only-lower-slices`,
            severity: "error",
            comment: `${layer} 第 ${level} 级：只引用更低层级的切片。`,
            from: { path: `^${sliceDirectory(layer, slice)}` },
            to: {
              path: `^(?:${sameOrHigher.map((other) => sliceDirectory(layer, other)).join("|")})`,
            },
          },
        ];
      }),
    ),
  );
}

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
      name: "runtime-does-not-import-development-code",
      severity: "error",
      comment: "运行时不得引用测试、tooling 或生成的制品。",
      from: { path: "^src/" },
      to: { path: "^(?:tests|tooling|plugins)/" },
    },
    {
      name: "tests-do-not-import-built-artifacts",
      severity: "error",
      comment: "测试可以读固定的 golden，但不得 import 已构建的制品。",
      from: { path: "^tests/" },
      to: { path: "^plugins/" },
    },

    // ---- 九层方向（ADR-0013 补记二）--------------------------------------------
    ...layerRules(),
    {
      name: "capabilities-do-not-import-each-other",
      severity: "error",
      comment:
        "能力切片之间不得互相引用；共用的代码放在它的依赖允许的最低一层（机制进 kernel，领域代码进拥有它的 governance 或 workspace 切片，跨两者的进 application）。",
      from: { path: "^src/capabilities/([^/]+)/" },
      to: { path: "^src/capabilities/(?!$1/)[^/]+/" },
    },
    {
      name: "hosts-do-not-import-each-other",
      severity: "error",
      comment: "Codex 与 Claude Code 宿主实现互不引用；共同部分放进 workspace 的端口与 profile 数据。",
      from: { path: "^src/hosts/([^/]+)/" },
      to: { path: "^src/hosts/(?!$1/)[^/]+/" },
    },
    ...sliceLevelRules(),
    {
      name: "domain-effects-use-foundation",
      severity: "error",
      comment:
        "宿主中立运行时不得绕过根作用域 filesystem、封闭的系统进程与用户环境 foundation 端口直接取得 Node 核心模块（§13.166）。",
      from: { path: HOST_NEUTRAL_RUNTIME },
      // dependency-cruiser 把 `node:fs/promises` 记为核心模块 `fs/promises`（无 `node:` 前缀），并且
      // 只有 includeOnly 放进图里的模块才参与规则；下面的 includeOnly 因此同时收下这四个核心模块。
      to: { dependencyTypes: ["core"], path: "^(?:fs|fs/promises|child_process|os)$" },
    },
    {
      name: "hook-observer-closure-stays-in-kernel",
      severity: "error",
      comment:
        "钩子观察器在每个宿主钩子事件上运行（gate-log §13.97 D1）：它的闭包只到 foundation、contracts 与 kernel；prompt-digest、hook-observations、incident 与制品身份因此留在内核。",
      from: { path: "^src/entrypoints/wakeflow-hook-observer\\.ts$" },
      to: {
        path: "^src/(?:configuration|governance|workspace|application|capabilities|hosts)/",
        reachable: true,
      },
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
    includeOnly: ["^(?:src|tests|tooling)/", "^(?:fs|fs/promises|child_process|os)$"],
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "node", "default", "types"],
      extensions: [".ts", ".cts", ".mts", ".js", ".cjs", ".mjs", ".json"],
    },
  },
};
