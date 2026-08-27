import { spawnSync } from "node:child_process";
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

interface DependencyCruiseReport {
  readonly modules: readonly unknown[];
  readonly summary: DependencyCruiseSummary;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonNegativeInteger(
  record: Readonly<Record<string, unknown>>,
  field: string,
): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`dependency-cruiser summary field ${field} is invalid`);
  }
  return value;
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
    modules: value.modules,
    summary: {
      error: readNonNegativeInteger(summary, "error"),
      warn: readNonNegativeInteger(summary, "warn"),
      totalCruised: readNonNegativeInteger(summary, "totalCruised"),
      totalDependenciesCruised: readNonNegativeInteger(
        summary,
        "totalDependenciesCruised",
      ),
      violations: summary.violations,
      optionsUsed: summary.optionsUsed,
    },
  };
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
  const result = spawnSync(process.execPath, [
    cli,
    "--config",
    ".dependency-cruiser.cjs",
    "--output-type",
    "json",
    "src",
    "tests",
    "tooling",
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });

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
    report.modules.length === 0
    || report.summary.totalCruised === 0
    || report.summary.totalDependenciesCruised === 0
  ) {
    fail("no TypeScript modules or dependencies were actually scanned");
  }
  if (
    result.status !== 0
    || report.summary.error > 0
    || report.summary.warn > 0
    || report.summary.violations.length > 0
  ) {
    fail("one or more dependency rules were violated");
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    parser: "swc",
    modules: report.summary.totalCruised,
    dependencies: report.summary.totalDependenciesCruised,
  })}\n`);
}

run();
