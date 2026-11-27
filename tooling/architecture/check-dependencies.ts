import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import nodePath from "node:path";

/**
 * 执行 Wakeflow 新项目的 `dependency-cruiser` 架构边界检查。
 *
 * TypeScript 7.0 尚未公开编译器 API，因此 `dependency-cruiser` 显式使用 SWC 解析器。
 * 本入口不仅检查规则违例，还要求实际扫描到非零 TypeScript 模块和依赖，防止缺少
 * 兼容解析器时把“0 个模块”误报为成功。
 */

interface DependencyCruiseSummary {
  readonly error: number;
  readonly warn: number;
  readonly totalCruised: number;
  readonly totalDependenciesCruised: number;
  readonly violations: readonly unknown[];
  readonly optionsUsed: Readonly<Record<string, unknown>>;
}

interface DependencyCruiseModule {
  readonly source: string;
  readonly dependents: readonly string[];
}

interface DependencyCruiseReport {
  readonly modules: readonly DependencyCruiseModule[];
  readonly summary: DependencyCruiseSummary;
}

/**
 * 没有其他生产模块导入、但作为显式库入口或进程入口保留的源码。
 *
 * 新的仅测试可达模块必须先证明独立入口职责并加入此表；表中成员一旦获得生产
 * consumer，也必须从这里删除，避免测试把遗留实现伪装成运行时骨干。
 */
const ADMITTED_PRODUCTION_ROOTS: ReadonlySet<string> = new Set([
  "src/entrypoints/claude-code-wakeflow-mcp.ts",
  "src/entrypoints/codex-wakeflow-mcp.ts",
  "src/entrypoints/wakeflow-hook-observer.ts",
  // 宿主脚本的源文件：三个入口（tmux 助手、桌面助手、状态栏脚本）由 tooling/codegen/helper-assets.ts 装配成
  // 自包含脚本，运行时读的是生成模块；两份 .d.ts 是只给 checkJs 看的环境声明。
  "src/hosts/claude-code/assets/build-values.d.ts",
  "src/hosts/claude-code/assets/desktop.mjs",
  "src/hosts/claude-code/assets/helper-types.d.ts",
  "src/hosts/claude-code/assets/statusline.mjs",
  "src/hosts/claude-code/assets/tmux.mjs",
  "src/hosts/claude-code/claude-code-agent-text-profile.ts",
  "src/hosts/claude-code/claude-code-hook-fragment.ts",
  // 制品构建器动态读取的宿主 MCP 配置；不是运行时内部依赖。
  "src/hosts/claude-code/claude-code-mcp-configuration.ts",
  "src/hosts/codex/codex-agent-text-profile.ts",
  "src/hosts/codex/codex-hook-fragment.ts",
]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonNegativeInteger(record: Readonly<Record<string, unknown>>, field: string): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`dependency-cruiser summary field ${field} is invalid`);
  }
  return value;
}

function parseModule(value: unknown): DependencyCruiseModule {
  if (
    !isRecord(value) ||
    typeof value.source !== "string" ||
    !Array.isArray(value.dependents) ||
    value.dependents.some((entry) => typeof entry !== "string")
  ) {
    throw new Error("dependency-cruiser returned an invalid module");
  }
  return {
    source: value.source,
    dependents: value.dependents as readonly string[],
  };
}

function parseReport(value: unknown): DependencyCruiseReport {
  if (!isRecord(value) || !Array.isArray(value.modules) || !isRecord(value.summary)) {
    throw new Error("dependency-cruiser returned an invalid report envelope");
  }
  const summary = value.summary;
  if (!Array.isArray(summary.violations) || !isRecord(summary.optionsUsed)) {
    throw new Error("dependency-cruiser returned an invalid summary");
  }
  return {
    modules: value.modules.map(parseModule),
    summary: {
      error: readNonNegativeInteger(summary, "error"),
      warn: readNonNegativeInteger(summary, "warn"),
      totalCruised: readNonNegativeInteger(summary, "totalCruised"),
      totalDependenciesCruised: readNonNegativeInteger(summary, "totalDependenciesCruised"),
      violations: summary.violations,
      optionsUsed: summary.optionsUsed,
    },
  };
}

function admittedProductionRootCount(modules: readonly DependencyCruiseModule[]): number {
  const roots = modules
    .filter((module) => module.source.startsWith("src/"))
    .filter((module) => !module.dependents.some((dependent) => dependent.startsWith("src/")))
    .map((module) => module.source)
    .sort();
  const unadmitted = roots.filter((source) => !ADMITTED_PRODUCTION_ROOTS.has(source));
  if (unadmitted.length > 0) {
    fail(`unadmitted production roots: ${unadmitted.join(", ")}`);
  }
  const current = new Set(roots);
  const staleAdmissions = [...ADMITTED_PRODUCTION_ROOTS]
    .filter((source) => !current.has(source))
    .sort();
  if (staleAdmissions.length > 0) {
    fail(`stale production root admissions: ${staleAdmissions.join(", ")}`);
  }
  return roots.length;
}

interface LayerMap {
  readonly LAYER_IMPORTS: Readonly<Record<string, readonly string[] | null>>;
  readonly SLICE_LEVELS: Readonly<Record<string, readonly (readonly string[])[]>>;
}

/**
 * 层表与层级表必须与 `src/` 的实际目录一一对应（ADR-0013 补记二）：新的层或切片目录先进
 * `tooling/architecture/layer-map.cjs` 才能通过，表里点名的目录不存在同样失败。否则一个新切片
 * 不受任何层级规则约束，一条过期的表项也不会被发现（旧的放行清单就有两条指向不存在的文件）。
 */
function layerMapCoverage(repositoryRoot: string): number {
  const require = createRequire(import.meta.url);
  const map = require(
    nodePath.join(repositoryRoot, "tooling", "architecture", "layer-map.cjs"),
  ) as LayerMap;
  const entriesOf = (relative: string) =>
    readdirSync(nodePath.join(repositoryRoot, relative), { withFileTypes: true });
  const holdsSource = (relative: string): boolean =>
    entriesOf(relative).some((entry) =>
      entry.isDirectory()
        ? holdsSource(nodePath.join(relative, entry.name))
        : /\.(?:ts|mjs)$/u.test(entry.name),
    );
  const problems: string[] = [];
  const layers = entriesOf("src")
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const declaredLayers = Object.keys(map.LAYER_IMPORTS).sort();
  if (layers.join(",") !== declaredLayers.join(",")) {
    problems.push(
      `layers on disk [${layers.join(", ")}] differ from LAYER_IMPORTS [${declaredLayers.join(", ")}]`,
    );
  }
  let slices = 0;
  for (const [layer, levels] of Object.entries(map.SLICE_LEVELS)) {
    const entries = entriesOf(nodePath.join("src", layer));
    const onDisk = entries
      .filter(
        (entry) => entry.isDirectory() && holdsSource(nodePath.join("src", layer, entry.name)),
      )
      .map((entry) => entry.name)
      .concat(
        entries.some((entry) => entry.isFile() && entry.name.endsWith(".ts")) ? ["(root)"] : [],
      )
      .sort();
    const declared = levels.flat().slice().sort();
    if (new Set(declared).size !== declared.length)
      problems.push(`${layer}: a slice is listed twice`);
    if (onDisk.join(",") !== declared.join(",")) {
      problems.push(
        `${layer}: slices on disk [${onDisk.join(", ")}] differ from SLICE_LEVELS [${declared.join(", ")}]`,
      );
    }
    slices += declared.length;
  }
  if (problems.length > 0) fail(`layer map out of date: ${problems.join("; ")}`);
  return slices;
}

function fail(message: string): never {
  throw new Error(`Wakeflow dependency architecture check failed: ${message}`);
}

function run(): void {
  const repositoryRoot = process.cwd();
  const cli = nodePath.join(
    repositoryRoot,
    "node_modules",
    "dependency-cruiser",
    "bin",
    "dependency-cruise.mjs",
  );
  const result = spawnSync(
    process.execPath,
    [
      cli,
      "--config",
      ".dependency-cruiser.cjs",
      "--output-type",
      "json",
      "src",
      "tests",
      "tooling",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      shell: false,
      windowsHide: true,
    },
  );

  if (result.error !== undefined) fail("dependency-cruiser could not start");
  let decoded: unknown;
  try {
    decoded = JSON.parse(result.stdout) as unknown;
  } catch {
    fail("dependency-cruiser did not return JSON");
  }
  const report = parseReport(decoded);
  if (report.summary.optionsUsed.parser !== "swc") {
    fail("the configured parser is not SWC");
  }
  if (
    report.modules.length === 0 ||
    report.summary.totalCruised === 0 ||
    report.summary.totalDependenciesCruised === 0
  ) {
    fail("no TypeScript modules or dependencies were actually scanned");
  }
  if (
    result.status !== 0 ||
    report.summary.error > 0 ||
    report.summary.warn > 0 ||
    report.summary.violations.length > 0
  ) {
    fail("one or more dependency rules were violated");
  }
  const productionRoots = admittedProductionRootCount(report.modules);
  const levelledSlices = layerMapCoverage(repositoryRoot);

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      parser: "swc",
      modules: report.summary.totalCruised,
      dependencies: report.summary.totalDependenciesCruised,
      productionRoots,
      levelledSlices,
    })}\n`,
  );
}

run();
